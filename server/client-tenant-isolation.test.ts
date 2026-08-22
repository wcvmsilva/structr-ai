/**
 * Negative cross-tenant tests for the CRM client domain (F2/F8/F10 family).
 *
 * Before the tenant scoping landed, `client-db.ts` never referenced the caller's
 * tenant: `getClientById` was a bare primary-key lookup and `listClients` filtered
 * on `isActive` alone. Any authenticated user of any tenant could read and list
 * every other tenant's client records.
 *
 * These are the negative cases — they assert what a caller must NOT be able to do:
 *   1. tenant A cannot read a client belonging to tenant B;
 *   2. tenant A cannot list tenant B's clients.
 *
 * Each negative has a positive control beside it, so a test that passes because the
 * whole data layer is broken would be caught.
 *
 * What is and is not proven here: the repository's suite has no live Postgres (see
 * `server/env.test.ts` — `DATABASE_URL` is unset under vitest), so `getDb()` is faked.
 * The read case is fully behavioural: the fake returns tenant B's row and the function
 * under test must still yield null. The list case asserts the WHERE predicate handed
 * to the driver binds the caller's tenant and never the other tenant's — i.e. the
 * database is asked only for tenant A's rows. Row-level proof against a real Postgres
 * would need an integration harness this project does not have.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";

const CLIENT_OF_B = {
  id: "30000000-0000-4000-8000-0000000000b1",
  name: "Tenant B Customer",
  email: "owner@tenant-b.example",
  tenantId: TENANT_B,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const CLIENT_OF_A = {
  ...CLIENT_OF_B,
  id: "30000000-0000-4000-8000-0000000000a1",
  name: "Tenant A Customer",
  email: "owner@tenant-a.example",
  tenantId: TENANT_A,
};

// ── Fake database handle ─────────────────────────────────────────────────────
// Mirrors just enough of the drizzle builder for the two functions under test:
//   select().from(clients).where(cond).limit(1)                       → point lookup
//   select({count}).from(clients).where(cond)                         → list count
//   select().from(clients).orderBy().limit().offset().where(cond)     → list page
// Every `where()` condition is recorded so a test can inspect the real predicate.

const dbState: {
  rows: unknown[];
  wheres: SQL[];
} = { rows: [], wheres: [] };

function createSelect() {
  const chain: Record<string, unknown> = {};
  const self = (..._args: unknown[]) => chain;
  for (const method of ["from", "orderBy", "limit", "offset", "innerJoin", "leftJoin", "set", "values", "returning"]) {
    chain[method] = self;
  }
  chain.where = (condition: SQL | undefined) => {
    if (condition) dbState.wheres.push(condition);
    return chain;
  };
  // Thenable: awaiting the builder resolves to the configured rows.
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(dbState.rows);
  return chain;
}

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    select: () => createSelect(),
    insert: () => createSelect(),
    update: () => createSelect(),
    delete: () => createSelect(),
  })),
  getRawClient: vi.fn(async () => null),
}));

vi.mock("./audit", () => ({
  logAudit: vi.fn(async () => undefined),
  withAuditLog: vi.fn(async (_meta: unknown, fn: () => unknown) => fn()),
}));

const dialect = new PgDialect();

/** Render a recorded predicate to the SQL text and bound parameters the driver sees. */
function render(condition: SQL) {
  const query = dialect.sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
}

describe("Client domain — cross-tenant reads are refused", () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.wheres = [];
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.TENANT_STRICT;
  });

  it("tenant A cannot read a client belonging to tenant B", async () => {
    const { getClientById } = await import("./client-db");
    // The point lookup is by primary key, so the driver does hand back B's row —
    // the tenant decision has to happen before the caller ever sees it.
    dbState.rows = [CLIENT_OF_B];

    const result = await getClientById(CLIENT_OF_B.id, { tenantId: TENANT_A });

    expect(result).toBeNull();
  });

  it("tenant A cannot read tenant B's client under TENANT_STRICT either", async () => {
    process.env.TENANT_STRICT = "true";
    const { getClientById } = await import("./client-db");
    dbState.rows = [CLIENT_OF_B];

    expect(await getClientById(CLIENT_OF_B.id, { tenantId: TENANT_A })).toBeNull();
  });

  it("positive control: tenant A still reads its own client", async () => {
    const { getClientById } = await import("./client-db");
    dbState.rows = [CLIENT_OF_A];

    const result = await getClientById(CLIENT_OF_A.id, { tenantId: TENANT_A });

    expect(result).toMatchObject({ id: CLIENT_OF_A.id, tenantId: TENANT_A });
  });

  it("tenant A cannot update a client belonging to tenant B", async () => {
    const { updateClient } = await import("./client-db");
    dbState.rows = [CLIENT_OF_B];

    // Reported exactly like a missing record — no existence oracle across tenants.
    await expect(
      updateClient(CLIENT_OF_B.id, { notes: "tampered" }, { tenantId: TENANT_A }),
    ).rejects.toThrow(`Client ${CLIENT_OF_B.id} not found`);
  });
});

describe("Client domain — cross-tenant listing is refused", () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.wheres = [];
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.TENANT_STRICT;
  });

  it("tenant A cannot list tenant B's clients — every query is bound to tenant A", async () => {
    const { listClients } = await import("./client-db");

    await listClients({ tenantId: TENANT_A });

    // Both the count and the page query must carry the predicate; if either were
    // unscoped, a total or a row set spanning tenants would reach the caller.
    expect(dbState.wheres).toHaveLength(2);
    for (const condition of dbState.wheres) {
      const { sql, params } = render(condition);
      expect(sql).toContain("tenant_id");
      expect(params).toContain(TENANT_A);
      expect(params).not.toContain(TENANT_B);
    }
  });

  it("tenant A's search cannot reach tenant B's clients", async () => {
    const { searchClients } = await import("./client-db");

    await searchClients("tenant-b", { tenantId: TENANT_A });

    expect(dbState.wheres.length).toBeGreaterThan(0);
    for (const condition of dbState.wheres) {
      const { sql, params } = render(condition);
      expect(sql).toContain("tenant_id");
      expect(params).toContain(TENANT_A);
      expect(params).not.toContain(TENANT_B);
    }
  });

  it("the search term cannot smuggle rows past the tenant predicate", async () => {
    const { listClients } = await import("./client-db");

    // A search that matches everything must still be ANDed with the tenant clause.
    await listClients({ tenantId: TENANT_A }, { search: "%" });

    for (const condition of dbState.wheres) {
      const { sql, params } = render(condition);
      expect(sql).toContain("tenant_id");
      expect(params).toContain(TENANT_A);
    }
  });

  // HISTORY: this case previously read "positive control: an unresolved tenant keeps
  // today's unscoped behaviour" and asserted the emitted predicate contained NO tenant_id
  // — it pinned the vulnerability as intended behaviour, and its comment described the
  // unscoped read as a transitional posture deliberately kept. Codex P1-1 rejected that
  // reasoning: the "caller whose tenant cannot be resolved" it protected was a caller an
  // audit of every call site could not find, and NULL was being treated as an
  // authorization domain. The posture is withdrawn, not softened.
  it("negative control: an unresolved tenant is refused, not served unscoped", async () => {
    const { listClients } = await import("./client-db");

    await expect(
      listClients({ tenantId: null as unknown as string }),
    ).rejects.toThrow(/Tenant scope is unresolved/);

    // And nothing reached the database: no predicate was built at all.
    expect(dbState.wheres).toHaveLength(0);
  });
});
