/**
 * Negative cross-tenant tests for lead ACTIVITIES.
 *
 * `lead_activities` has no `tenant_id` column of its own — it inherits the tenant of its
 * parent lead. Before this fix, `leads.getActivities` and `leads.addActivity` passed the
 * caller-supplied `leadId` straight into an unscoped query inside `bypassRLS()` (which
 * runs as `postgres`, so no RLS policy applies either). Any authenticated user of any
 * tenant could read every activity on any lead — free-text notes, calls, emails — and
 * write activity records onto another tenant's lead.
 *
 * The guard mirrors `dealExistsInTenant()` in deal-db.ts: the parent lead is looked up
 * through `leadScopeWhere()` first, so a lead outside the caller's scope reads as absent.
 *
 * These are the negative cases:
 *   1. tenant A cannot read tenant B's lead activities;
 *   2. tenant A cannot add an activity to tenant B's lead.
 *
 * What is and is not proven: the suite has no live Postgres, so `getDb()` is faked and
 * the predicate is not executed by a database. Each case is therefore proven on two
 * complementary axes — behavioural (when the scoped parent lookup finds nothing, the
 * activity table is never read and never written) and predicate-level (that parent
 * lookup really is bound to the caller's tenant, so tenant B's lead could not have
 * matched). Row-level proof would need an integration harness this project lacks.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { leads, leadActivities } from "../drizzle/schema";
import type { LeadScope } from "./lead-access";

const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";
const USER_A = "10000000-0000-4000-8000-00000000000a";

/** A lead owned by tenant B — the row the caller from tenant A must not reach. */
const LEAD_OF_B = "40000000-0000-4000-8000-0000000000b1";

const scopeOfA: LeadScope = { userId: USER_A, tenantId: TENANT_A, via: "tenant" };

// ── Fake database handle ─────────────────────────────────────────────────────
// bypassRLS() wraps everything in db.transaction(tx => …) after SET LOCAL role,
// so the fake models the transaction handle:
//   tx.select({id}).from(leads).where(cond).limit(1)   → the scoped parent lookup
//   tx.select().from(leadActivities).where().orderBy() → the activity read
//   tx.insert(leadActivities).values().returning()     → the activity write

const dbState: {
  /** Rows the scoped parent lookup resolves to. Empty = the lead is out of scope. */
  parentLookupRows: unknown[];
  /** WHERE predicates captured per table. */
  wheres: Map<unknown, SQL[]>;
  activityRowsRead: number;
  activityInserts: number;
} = { parentLookupRows: [], wheres: new Map(), activityRowsRead: 0, activityInserts: 0 };

function recordWhere(table: unknown, condition: SQL | undefined) {
  if (!condition) return;
  const existing = dbState.wheres.get(table) ?? [];
  existing.push(condition);
  dbState.wheres.set(table, existing);
}

function createSelect() {
  let table: unknown = null;
  const chain: Record<string, unknown> = {};
  const self = (..._args: unknown[]) => chain;
  for (const method of ["orderBy", "limit", "offset", "groupBy"]) chain[method] = self;
  chain.from = (t: unknown) => {
    table = t;
    return chain;
  };
  chain.where = (condition: SQL | undefined) => {
    recordWhere(table, condition);
    return chain;
  };
  chain.then = (resolve: (rows: unknown[]) => unknown) => {
    if (table === leads) return resolve(dbState.parentLookupRows);
    if (table === leadActivities) {
      dbState.activityRowsRead += 1;
      return resolve([{ id: "act-1", description: "tenant B private note" }]);
    }
    return resolve([]);
  };
  return chain;
}

function createInsert(table: unknown) {
  const chain: Record<string, unknown> = {};
  chain.values = () => {
    if (table === leadActivities) dbState.activityInserts += 1;
    return chain;
  };
  chain.returning = async () => [{ id: "act-new" }];
  return chain;
}

const tx = {
  execute: async () => undefined,
  select: () => createSelect(),
  insert: (table: unknown) => createInsert(table),
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    transaction: async (fn: (handle: unknown) => unknown) => fn(tx),
    select: () => createSelect(),
    insert: (table: unknown) => createInsert(table),
  })),
  getRawClient: vi.fn(async () => null),
}));

const dialect = new PgDialect();

/** The predicate the scoped parent lookup handed to the driver. */
function parentLookupPredicate() {
  const captured = dbState.wheres.get(leads) ?? [];
  expect(captured.length).toBeGreaterThan(0);
  return dialect.sqlToQuery(captured[0]);
}

describe("Lead activities — cross-tenant access is refused", () => {
  beforeEach(() => {
    dbState.parentLookupRows = [];
    dbState.wheres = new Map();
    dbState.activityRowsRead = 0;
    dbState.activityInserts = 0;
    vi.clearAllMocks();
  });

  it("tenant A cannot read tenant B's lead activities", async () => {
    const { getLeadActivities } = await import("./lead-db");
    // The scoped parent lookup finds nothing: tenant B's lead is outside A's scope.
    dbState.parentLookupRows = [];

    const result = await getLeadActivities(LEAD_OF_B, scopeOfA);

    expect(result).toEqual([]);
    // The activity table must never be touched once the parent is out of scope.
    expect(dbState.activityRowsRead).toBe(0);
  });

  it("the parent lookup behind a read is bound to the caller's tenant", async () => {
    const { getLeadActivities } = await import("./lead-db");
    dbState.parentLookupRows = [];

    await getLeadActivities(LEAD_OF_B, scopeOfA);

    // Proves tenant B's lead could not have matched: the database was asked only
    // for leads belonging to tenant A.
    const { sql, params } = parentLookupPredicate();
    expect(sql).toContain("tenant_id");
    expect(params).toContain(TENANT_A);
    expect(params).not.toContain(TENANT_B);
  });

  it("tenant A cannot add an activity to tenant B's lead", async () => {
    const { addLeadActivity } = await import("./lead-db");
    dbState.parentLookupRows = [];

    await expect(
      addLeadActivity(
        { leadId: LEAD_OF_B, activityType: "note", description: "injected" },
        scopeOfA,
      ),
    ).rejects.toThrow("Lead not found");

    // Reported exactly like a missing lead, and nothing was written.
    expect(dbState.activityInserts).toBe(0);
  });

  it("the parent lookup behind a write is bound to the caller's tenant", async () => {
    const { addLeadActivity } = await import("./lead-db");
    dbState.parentLookupRows = [];

    await addLeadActivity(
      { leadId: LEAD_OF_B, activityType: "note", description: "injected" },
      scopeOfA,
    ).catch(() => undefined);

    const { sql, params } = parentLookupPredicate();
    expect(sql).toContain("tenant_id");
    expect(params).toContain(TENANT_A);
    expect(params).not.toContain(TENANT_B);
  });

  it("positive control: a lead inside the caller's scope still reads its activities", async () => {
    const { getLeadActivities } = await import("./lead-db");
    dbState.parentLookupRows = [{ id: "lead-of-a" }];

    const result = await getLeadActivities("lead-of-a", scopeOfA);

    expect(result).toHaveLength(1);
    expect(dbState.activityRowsRead).toBe(1);
  });

  it("positive control: a lead inside the caller's scope still accepts an activity", async () => {
    const { addLeadActivity } = await import("./lead-db");
    dbState.parentLookupRows = [{ id: "lead-of-a" }];

    await expect(
      addLeadActivity(
        { leadId: "lead-of-a", activityType: "note", description: "ok" },
        scopeOfA,
      ),
    ).resolves.toBe("act-new");

    expect(dbState.activityInserts).toBe(1);
  });
});
