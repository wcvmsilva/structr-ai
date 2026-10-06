/**
 * A1-READ-QUERIES-V2-TEST-COMPLETION-CONTRACT.md item 1 — router -> REAL helper
 * integration. Unlike `a1-read-queries-router.test.ts` (which mocks BOTH public
 * helpers to isolate router-only concerns), this file does NOT mock
 * `internal-estimate-approval-db.ts` at all: `getInternalApprovalReview` and
 * `getInternalApproval` reached through `estimateRouter.createCaller(...)` below are
 * the real exported functions, running their real transaction/lock/lineage logic.
 *
 * The in-memory `getDb()` driver (select/matches/rows/put) is copied from
 * `internal-estimate-approval-db.test.ts` — same technique, not a shared export,
 * since that file keeps it module-local. This is an IN-MEMORY, mocked database, never
 * a physical PostgreSQL run. `buildInternalApprovalReviewFromRows` (the adapter) is
 * also mocked exactly as that file mocks it, so this file does not need to re-satisfy
 * every geo/policy/tenant-settings row the full adapter reads — it is declared here,
 * not hidden, and is not evidence about the adapter's own correctness (already covered
 * elsewhere).
 *
 * `requireProjectAccess` is replaced with a SPY, not left real: it observes which
 * capability ("approve" vs "read"), actor, tenant, and transaction handle each call
 * used, and still grants access (synthetic-owner-equivalent) so the helper can proceed
 * far enough to prove the rest of the real chain. This spy does NOT prove the real
 * production access policy (ACL/RBAC) — only that THIS call reached authorization with
 * the right arguments, inside the one transaction the helper itself opened.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as s from "../drizzle/schema";
import {
  buildInternalApprovalReview,
  type ReviewResult,
} from "../shared/internal-estimate-approval-engine";
import { recordInternalEstimateApproval, revokeInternalEstimateApproval } from "./internal-estimate-approval-db";
import {
  makeInternalApprovalReviewInput,
  approvalIds as ids,
} from "./internal-estimate-approval-engine.fixtures";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), access: vi.fn(), adapter: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./project-access", async original => ({
  ...(await original<typeof import("./project-access")>()),
  requireProjectAccess: mocks.access,
}));
vi.mock("./internal-estimate-approval-adapter", () => ({
  buildInternalApprovalReviewFromRows: mocks.adapter,
}));

import { estimateRouter } from "./estimate-router";
import { ProjectAccessError } from "./project-access";
import type { TrpcContext } from "./_core/context";

type Row = Record<string, any>;
type Table = Parameters<typeof getTableName>[0];
const dialect = new PgDialect();
const uuidN = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OTHER_TENANT = "a9000000-0000-4000-8000-000000000001";
const at = new Date("2026-09-01T12:00:00.123Z");

let data: Map<Table, Row[]>, trace: string[], tx: any, db: any, review: ReviewResult;
const rows = (table: Table) => data.get(table) ?? [];
function put(table: Table, ...values: Row[]) {
  data.set(table, values);
}
function matches(table: Table, where: SQL | undefined, row: Row) {
  if (!where) return true;
  const { sql, params } = dialect.sqlToQuery(where),
    columns = getTableColumns(table),
    lookup = Object.fromEntries(Object.entries(columns).map(([key, value]) => [value.name, key]));
  for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g))
    if (row[lookup[match[1]]] !== params[Number(match[2]) - 1]) return false;
  return true;
}
function select(selection?: Record<string, any>) {
  let table: Table, where: SQL | undefined, limit: number | undefined, lock: string | undefined;
  const q: any = {
    from: (t: Table) => { table = t; return q; },
    where: (w: SQL) => { where = w; return q; },
    limit: (v: number) => { limit = v; return q; },
    orderBy: () => q,
    for: (v: string) => { lock = v; return q; },
    then: (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          trace.push(`read:${getTableName(table)}:${lock ?? "none"}`);
          let result = rows(table).filter(r => matches(table, where, r));
          if (limit !== undefined) result = result.slice(0, limit);
          if (selection) {
            const cols = getTableColumns(table);
            result = result.map(row =>
              Object.fromEntries(
                Object.entries(selection).map(([key, column]) => [
                  key,
                  row[Object.entries(cols).find(([, v]) => v === column)?.[0] ?? key],
                ]),
              ),
            );
          }
          return structuredClone(result);
        })
        .then(resolve, reject),
  };
  return q;
}
let seq = 100;
// A genuine, writable insert/update — needed ONLY so the one "active" fixture below
// can be set up via the REAL recordInternalEstimateApproval() writer (not the router;
// called directly, exactly as internal-estimate-approval-db.test.ts already does
// throughout, purely to produce a genuinely-created decision for the READ queries to
// then read back). The two read queries under test never call insert/update
// themselves — asserted per-test via a before/after call-count delta, not by making
// writes impossible outright.
function insertRow(table: Table) {
  return {
    values: (value: Row | Row[]) => {
      const run = async () => {
        trace.push(`insert:${getTableName(table)}`);
        const added = (Array.isArray(value) ? value : [value]).map(v => ({
          id: uuidN(seq++), createdAt: at, updatedAt: at, deletedAt: null, ...v,
        }));
        data.set(table, [...rows(table), ...structuredClone(added)]);
        return structuredClone(added);
      };
      return { returning: run, then: (resolve: any, reject: any) => run().then(resolve, reject) };
    },
  };
}
function updateRow(table: Table) {
  return {
    set: (value: Row) => {
      let where: SQL | undefined;
      const run = async () => {
        trace.push(`update:${getTableName(table)}`);
        const changed: Row[] = [];
        data.set(table, rows(table).map(row => {
          if (!matches(table, where, row)) return row;
          const next = { ...row, ...value };
          changed.push(next);
          return next;
        }));
        return structuredClone(changed);
      };
      const q: any = { where: (w: SQL) => { where = w; return q; }, returning: run, then: (resolve: any, reject: any) => run().then(resolve, reject) };
      return q;
    },
  };
}

function seedBaseRows(tenantId = ids.tenant) {
  put(s.estimateDrafts, {
    id: ids.draft, tenantId, projectId: ids.project, clientId: ids.client, createdBy: ids.actor,
    status: "draft", source: "assembly_calculator", version: 1, supersedesId: null, changeOrderOf: null,
    supersededBy: null, approvedBy: null, approvedAt: null, lockedAt: null,
    createdAt: at, updatedAt: at, notes: "Reviewed text", subtotalPrice: "100", subtotalCost: "40",
    finalTotalPrice: "100", discountAmount: "0", discountApplied: false, scopeDraftId: null,
  });
  put(s.projects, { id: ids.project, tenantId, clientId: ids.client, ownerUserId: ids.actor, deletedAt: null, zoneModifierSnapshot: { zoneId: ids.zone } });
  put(s.tenants, { id: tenantId, isActive: true });
  put(s.profiles, { id: ids.actor, tenantId, isActive: true, role: "user" });
  put(s.clients, { id: ids.client, tenantId, isActive: true, deletedAt: null });
  put(s.geoZones, { id: ids.zone, tenantId, isActive: true });
}

function context(tenantId = ids.tenant): TrpcContext {
  return { req: {} as any, res: {} as any, authProvider: "legacy", tenantId, user: { id: ids.actor, tenantId, role: "user", isActive: true } as any };
}

beforeEach(async () => {
  vi.clearAllMocks();
  data = new Map();
  trace = [];
  seedBaseRows();
  review = await buildInternalApprovalReview(makeInternalApprovalReviewInput());
  // `execute` stubs the one real SQL normalizer call (readValidatedRecord's
  // internal_approval_draft_matches_v1) to always match — same stub
  // internal-estimate-approval-db.test.ts already uses; it is not evidence about
  // that SQL function's own correctness, which is covered elsewhere.
  tx = { select: vi.fn(select), insert: vi.fn(insertRow), update: vi.fn(updateRow), execute: vi.fn(async () => [{ matches: true }]) };
  db = {
    transaction: vi.fn(async (work: any, options: any) => {
      trace.push("begin:" + options?.isolationLevel);
      try {
        const value = await work(tx);
        trace.push("commit");
        return value;
      } catch (error) {
        trace.push("rollback");
        throw error;
      }
    }),
  };
  mocks.getDb.mockResolvedValue(db);
  mocks.access.mockImplementation(async (projectId: string, userId: string, permission: string, options: any) => {
    trace.push(`authorize:${permission}`);
    return { projectId, tenantId: options?.expectedTenantId, via: "owner", permissions: ["read", "write", "approve"] };
  });
  mocks.adapter.mockImplementation(async () => {
    trace.push("adapt");
    return structuredClone(review);
  });
});

/** Snapshot insert/update call counts now; call the returned function after the query
 *  under test to assert NEITHER grew — delta-based so writer-based fixture setup
 *  (the "active" state test) can still use real insert/update beforehand. */
function trackNoWrites() {
  const before = { insert: tx.insert.mock.calls.length, update: tx.update.mock.calls.length };
  return () => {
    expect(tx.insert.mock.calls.length).toBe(before.insert);
    expect(tx.update.mock.calls.length).toBe(before.update);
  };
}

describe("getInternalApprovalReview — through the REAL router and REAL helper", () => {
  const invoke = (ctx = context()) => estimateRouter.createCaller(ctx).getInternalApprovalReview({ id: ids.draft, confirmedCurrencyCode: "USD" });

  it("produces the real ReviewResult by actually locking/validating the draft under its own transaction, with no write", async () => {
    const checkNoWrites = trackNoWrites();
    const result = await invoke();
    expect(result).toEqual(review);
    expect(trace[0]).toBe("begin:serializable");
    expect(trace.at(-1)).toBe("commit");
    checkNoWrites();
  });

  it("requests the APPROVE capability specifically, with the trusted actor/tenant and the SAME transaction handle the selects ran on", async () => {
    await invoke();
    expect(mocks.access).toHaveBeenCalledTimes(1);
    const [projectId, userId, permission, options] = mocks.access.mock.calls[0];
    expect({ projectId, userId, permission }).toEqual({ projectId: ids.project, userId: ids.actor, permission: "approve" });
    expect(options.expectedTenantId).toBe(ids.tenant);
    expect(options.transaction).toBe(tx);
  });

  it("refuses a draft belonging to a different tenant with the real transactional lock (NOT_FOUND), before authorization is ever reached", async () => {
    const checkNoWrites = trackNoWrites();
    await expect(invoke(context(OTHER_TENANT))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.access).not.toHaveBeenCalled();
    checkNoWrites();
  });
});

describe("getInternalApproval — through the REAL router and REAL helper", () => {
  const invoke = (ctx = context()) => estimateRouter.createCaller(ctx).getInternalApproval({ id: ids.draft });

  it("returns the real 'none' state when no decision has ever been recorded", async () => {
    const checkNoWrites = trackNoWrites();
    await expect(invoke()).resolves.toEqual({ state: "none", approval: null, snapshot: null, revocation: null });
    checkNoWrites();
  });

  it("returns the real 'active' state read back from a decision the REAL writer genuinely recorded — not a hand-fabricated projection", async () => {
    // Fixture setup only: calls the real recordInternalEstimateApproval() DIRECTLY
    // (bypassing the router entirely, same technique internal-estimate-approval-db.test.ts
    // already uses throughout) so the snapshot/approval rows below are exactly what
    // that real writer produces, not hand-typed to match the reader's expectations.
    await recordInternalEstimateApproval(
      {
        id: ids.draft, requestId: ids.request, expectedDraftVersion: 1,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Synthetic human review",
      },
      ids.actor, ids.tenant,
    );
    const checkNoWrites = trackNoWrites();
    const result = await invoke();
    checkNoWrites();
    expect(result.state).toBe("active");
    expect(result.approval?.approvedBy).toBe(ids.actor);
    expect(result.snapshot?.contentHash).toBe(review.contentHash);
    expect(result.revocation).toBeNull();
  });

  it("returns the real 'revoked' state after a real approve+revoke in fixture setup — original evidence and the matching revocation, no new write/audit, no reactivation", async () => {
    // Fixture setup only: both the approval AND its revocation are produced by calling
    // the real writers DIRECTLY (same technique as the 'active' test above, and the
    // same revokeCommand() shape internal-estimate-approval-db.test.ts:183/642 uses) —
    // never through the router, never a second activation surface.
    const approved = await recordInternalEstimateApproval(
      {
        id: ids.draft, requestId: ids.request, expectedDraftVersion: 1,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Synthetic human review",
      },
      ids.actor, ids.tenant,
    );
    const revoked = await revokeInternalEstimateApproval(
      {
        id: ids.draft, approvalId: approved.approvalId, requestId: uuidN(950),
        expectedContentHash: review.contentHash, reason: "Synthetic human revocation",
      },
      ids.actor, ids.tenant,
    );
    const checkNoWrites = trackNoWrites();
    const result = await invoke();
    checkNoWrites();
    expect(result.state).toBe("revoked");
    expect(result.approval?.id).toBe(approved.approvalId);
    expect(result.approval?.approvedBy).toBe(ids.actor);
    expect(result.snapshot?.contentHash).toBe(review.contentHash);
    expect(result.revocation?.id).toBe(revoked.revocationId);
    expect(result.revocation?.approvalId).toBe(approved.approvalId);
  });

  it("requests the READ capability specifically, with the trusted actor/tenant and the SAME transaction handle the selects ran on", async () => {
    await invoke();
    expect(mocks.access).toHaveBeenCalledTimes(1);
    const [projectId, userId, permission, options] = mocks.access.mock.calls[0];
    expect({ projectId, userId, permission }).toEqual({ projectId: ids.project, userId: ids.actor, permission: "read" });
    expect(options.expectedTenantId).toBe(ids.tenant);
    expect(options.transaction).toBe(tx);
  });

  it("refuses a draft belonging to a different tenant with the real transactional lock (NOT_FOUND), before authorization is ever reached", async () => {
    const checkNoWrites = trackNoWrites();
    await expect(invoke(context(OTHER_TENANT))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.access).not.toHaveBeenCalled();
    checkNoWrites();
  });
});

describe.each([
  { name: "getInternalApprovalReview", invoke: (ctx: TrpcContext) => estimateRouter.createCaller(ctx).getInternalApprovalReview({ id: ids.draft, confirmedCurrencyCode: "USD" }) },
  { name: "getInternalApproval", invoke: (ctx: TrpcContext) => estimateRouter.createCaller(ctx).getInternalApproval({ id: ids.draft }) },
])("$name — a FORBIDDEN denial from requireProjectAccess aborts the transaction cleanly", ({ invoke }) => {
  it("propagates FORBIDDEN exactly, with a valid actor/tenant/resource otherwise, rolls the transaction back, and performs no write/audit", async () => {
    mocks.access.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Access changed since preview"));
    const checkNoWrites = trackNoWrites();
    await expect(invoke(context())).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access changed since preview" });
    expect(trace.at(-1)).toBe("rollback");
    checkNoWrites();
  });
});
