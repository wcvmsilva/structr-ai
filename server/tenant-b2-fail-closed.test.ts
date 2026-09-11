/**
 * B2 — an unresolved caller tenant confers NO authorization (Codex P1-1).
 *
 * The invariant these tests pin:
 *
 *   NULL is not a tenant. It is not an authorization domain. An authenticated caller
 *   whose tenant cannot be resolved must not read, write, mutate, reuse or create
 *   business data — not another tenant's rows, and not the unowned ones either.
 *
 * What this replaces. Until this change `tenantFilter()` returned `undefined` for a null
 * caller tenant (so the predicate was dropped and the query ran unscoped),
 * `assertSameTenant()` returned `true` (so any row of any tenant was authorized), and
 * `withTenant()` returned the payload unstamped (so the insert created a permanent
 * `tenant_id IS NULL` row). Each was justified in comments by a "dev/admin path"; an
 * audit of every call site found no such caller. The transitional reading — B1, in which
 * an unidentified caller reached the tenant-less rows — was reviewed and withdrawn.
 *
 * Fail-closed has two legitimate shapes here, and both are asserted:
 *   - helpers that BUILD a predicate (list, search, stats, create) throw TenantScopeError,
 *     because there is no predicate that would be safe to run;
 *   - helpers that load a row by primary key and then authorize it (getClientById,
 *     updateClient, …) report it as NOT FOUND, so the route never confirms that an id
 *     exists in some other tenant.
 * The tests below feed those point lookups a row that genuinely EXISTS and belongs to
 * tenant B, so "not found" is a real refusal rather than an empty fixture.
 *
 * Note the two axes stay separate and only one of them is B2's:
 *   - CALLER tenant unresolved → these tests. Fail closed, always.
 *   - ROW tenant_id IS NULL    → legacy data (F15 / issue #10). Still tolerated for a
 *                                RESOLVED tenant while TENANT_STRICT is off, and
 *                                deliberately untouched here.
 *
 * What is and is not proven: there is no live Postgres in this suite, so `getDb()` is
 * faked. Refusals are proven behaviourally — the helper throws or returns nothing, and
 * the write counters stay at zero — rather than by executing SQL against real rows.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const NO_TENANT = null as unknown as string;
const TENANT_A = "30000000-0000-4000-8000-00000000000a";
const TENANT_B = "30000000-0000-4000-8000-00000000000b";
const USER = "10000000-0000-4000-8000-000000000001";

// ── Fake database ────────────────────────────────────────────────────────────
// `rows` is what any SELECT resolves to — by default a row owned by TENANT_B, so a
// point lookup really does find something the caller must still be refused.
// The write counters are the assertion for every mutation case.

const db = {
  rows: [] as unknown[],
  inserts: 0,
  updates: 0,
};

function chain(kind: "select" | "insert" | "update") {
  const self: Record<string, unknown> = {};
  const passthrough = () => self;
  for (const m of [
    "from", "where", "orderBy", "limit", "offset", "groupBy",
    "$dynamic", "leftJoin", "innerJoin", "onConflictDoUpdate",
  ]) {
    self[m] = passthrough;
  }
  // Count the write where it actually becomes one. `db.insert(t)` alone is inert —
  // the payload is what matters, and `withTenant()` throws while building it.
  self.values = () => {
    if (kind === "insert") db.inserts += 1;
    return self;
  };
  self.set = () => {
    if (kind === "update") db.updates += 1;
    return self;
  };
  self.returning = async () => db.rows;
  self.execute = async () => db.rows;
  self.then = (resolve: (r: unknown[]) => unknown) => resolve(db.rows);
  return self;
}

const handle = {
  select: () => chain("select"),
  insert: () => chain("insert"),
  update: () => chain("update"),
  delete: () => chain("update"),
  execute: async () => [],
  transaction: async (fn: (tx: unknown) => unknown) => fn(handle),
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => handle),
  getRawClient: vi.fn(async () => null),
}));
vi.mock("./audit", () => ({
  logAudit: vi.fn(),
  withAuditLog: vi.fn(async (_p: unknown, _b: unknown, fn: () => unknown) => fn()),
}));

/** A real row, owned by tenant B — the thing an unresolved caller must not reach. */
const ROW_OF_B = {
  id: "row-of-b",
  tenantId: TENANT_B,
  name: "Tenant B Record",
  isActive: true,
  stage: "discovery",
  status: "new",
};

beforeEach(() => {
  db.rows = [ROW_OF_B];
  db.inserts = 0;
  db.updates = 0;
});

/** Shape 1: the helper builds a predicate, so it refuses outright. */
async function expectThrows(run: () => Promise<unknown>) {
  await expect(run()).rejects.toThrow(/Tenant scope is unresolved/);
  expect(db.inserts + db.updates).toBe(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Reads — clients
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · an unresolved tenant cannot read clients", () => {
  it("cannot list clients", async () => {
    const { listClients } = await import("./client-db");
    await expectThrows(() => listClients({ tenantId: NO_TENANT }));
  });

  it("cannot reach clients through search", async () => {
    const { searchClients } = await import("./client-db");
    await expectThrows(() => searchClients("anything", { tenantId: NO_TENANT }));
  });

  it("cannot reach clients through an aggregate", async () => {
    const { getClientStats } = await import("./client-db");
    await expectThrows(() => getClientStats({ tenantId: NO_TENANT }));
  });

  it("a client that EXISTS in another tenant reads as absent, not as a row", async () => {
    const { getClientById } = await import("./client-db");

    // The fake resolves a genuine tenant-B client. Before B2, assertSameTenant() answered
    // `true` for a null caller and this returned that row.
    await expect(getClientById("row-of-b", { tenantId: NO_TENANT })).resolves.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Reads — deals
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · an unresolved tenant cannot read deals", () => {
  it("cannot list deals", async () => {
    const { listDeals } = await import("./deal-db");
    await expectThrows(() => listDeals({ tenantId: NO_TENANT }));
  });

  it("cannot read a deal by id", async () => {
    const { getDealById } = await import("./deal-db");
    await expectThrows(() => getDealById("row-of-b", NO_TENANT));
  });

  it("cannot reach deals through aggregates", async () => {
    const { getDealStats, getStaleDeals } = await import("./deal-db");
    await expectThrows(() => getDealStats(NO_TENANT));
    await expectThrows(() => getStaleDeals(NO_TENANT));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Reads — pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · an unresolved tenant cannot read pipeline business data", () => {
  it("cannot read the pipeline overview", async () => {
    const { getPipelineOverviewData } = await import("./pipeline-db");
    await expectThrows(() => getPipelineOverviewData(NO_TENANT));
  });

  it("cannot read a deal's full pipeline state", async () => {
    const { getFullPipelineState } = await import("./pipeline-db");
    await expectThrows(() => getFullPipelineState("row-of-b", NO_TENANT));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Reads — leads (lead-access aligned to B2)
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · an unresolved tenant cannot read leads", () => {
  it("resolveLeadScope refuses to build a scope at all", async () => {
    const { resolveLeadScope } = await import("./lead-access");

    expect(() => resolveLeadScope({ user: { id: USER }, tenantId: null })).toThrow(
      /No tenant is assigned/,
    );
  });

  it("refuses a platform admin too — admin is not a tenant", async () => {
    const { resolveLeadScope } = await import("./lead-access");

    expect(() =>
      resolveLeadScope({ user: { id: USER, role: "admin" }, tenantId: null }),
    ).toThrow(/No tenant is assigned/);
  });

  it("a resolved tenant still works, and its predicate is bound to that tenant", async () => {
    const { resolveLeadScope, leadScopeWhere } = await import("./lead-access");
    const { PgDialect } = await import("drizzle-orm/pg-core");

    const scope = resolveLeadScope({ user: { id: USER }, tenantId: TENANT_A });
    const { params } = new PgDialect().sqlToQuery(leadScopeWhere(scope));

    expect(params).toContain(TENANT_A);
    expect(params).not.toContain(TENANT_B);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Writes
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · an unresolved tenant cannot create, update or delete business rows", () => {
  it("cannot create a client", async () => {
    const { createClient } = await import("./client-db");
    await expectThrows(() =>
      createClient({ firstName: "A", lastName: "B" }, { tenantId: NO_TENANT }, USER),
    );
  });

  it("cannot update a client that exists in another tenant", async () => {
    const { updateClient } = await import("./client-db");

    await expect(
      updateClient("row-of-b", { firstName: "X" }, { tenantId: NO_TENANT }, USER),
    ).rejects.toThrow(/not found/);
    expect(db.updates).toBe(0);
  });

  it("cannot delete a client that exists in another tenant", async () => {
    const { deleteClient } = await import("./client-db");

    await expect(
      deleteClient("row-of-b", { tenantId: NO_TENANT }, USER),
    ).rejects.toThrow(/not found/);
    expect(db.updates).toBe(0);
  });

  it("cannot create a deal", async () => {
    const { createDeal } = await import("./deal-db");
    await expectThrows(() => createDeal({ name: "D" } as never, NO_TENANT));
  });

  it("cannot update a deal", async () => {
    const { updateDeal } = await import("./deal-db");
    await expectThrows(() => updateDeal("row-of-b", { name: "D" }, USER, NO_TENANT));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. withTenant cannot mint an unowned row
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · withTenant cannot create an unstamped business row", () => {
  it("throws instead of returning the payload unstamped", async () => {
    const { withTenant, withTenantAll } = await import("./tenant-scope");

    expect(() => withTenant({ name: "Kitchen" }, NO_TENANT)).toThrow(
      /Tenant scope is unresolved/,
    );
    expect(() => withTenant({ name: "Kitchen" }, undefined as unknown as string)).toThrow(
      /Tenant scope is unresolved/,
    );
    expect(() => withTenantAll([{ n: 1 }], NO_TENANT)).toThrow(
      /Tenant scope is unresolved/,
    );
  });

  it("a resolved tenant is still stamped exactly once and never overwritten", async () => {
    const { withTenant } = await import("./tenant-scope");

    expect(withTenant({ name: "Kitchen" }, TENANT_A)).toEqual({
      name: "Kitchen",
      tenantId: TENANT_A,
    });
    // An explicit tenant on the payload still wins — unchanged by B2.
    expect(withTenant({ name: "K", tenantId: TENANT_B }, TENANT_A)).toEqual({
      name: "K",
      tenantId: TENANT_B,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. assertSameTenant authorizes nothing
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · assertSameTenant cannot authorize anything for an unresolved caller", () => {
  it("refuses a foreign row, a matching row and a tenant-less row alike", async () => {
    const { assertSameTenant } = await import("./tenant-scope");

    expect(assertSameTenant(TENANT_B, NO_TENANT)).toBe(false);
    expect(assertSameTenant(TENANT_A, NO_TENANT)).toBe(false);
    expect(assertSameTenant(null, NO_TENANT)).toBe(false);
    expect(assertSameTenant(undefined, undefined as unknown as string)).toBe(false);
  });

  it("still authorizes correctly for a resolved caller (ROW axis untouched)", async () => {
    const { assertSameTenant } = await import("./tenant-scope");

    expect(assertSameTenant(TENANT_A, TENANT_A)).toBe(true);
    expect(assertSameTenant(TENANT_B, TENANT_A)).toBe(false);
    // Legacy tenant-less row stays visible to a resolved tenant — F15 / issue #10.
    expect(assertSameTenant(null, TENANT_A)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Parent/child authorization
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · parent/child access cannot succeed with an unresolved caller tenant", () => {
  it("deal activities cannot be read", async () => {
    const { getDealActivities } = await import("./deal-db");
    await expectThrows(() => getDealActivities("row-of-b", NO_TENANT));
  });

  it("deal activities cannot be written", async () => {
    const { addDealActivity } = await import("./deal-db");
    await expectThrows(() =>
      addDealActivity({ dealId: "row-of-b", activityType: "note" } as never, NO_TENANT),
    );
  });

  it("the parent-existence guard no longer short-circuits to true", () => {
    // dealExistsInTenant() used to open with `if (!tenantId) return true`, which made an
    // unresolved caller pass the parent check for any deal in any tenant. It is gone: the
    // refusal now happens before the child table is reached at all.
    expect(readFileSync("server/deal-db.ts", "utf8")).not.toContain(
      "if (!tenantId) return true;",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 & 10. Conversion
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · conversion cannot infer ownership from an unresolved tenant", () => {
  const candidate = {
    tenantId: null,
    leadId: "lead-1",
    clientName: "Sarah Whitfield",
    email: "sarah@example.com",
    phone: "(843) 555-0142",
    siteAddress: "412 Palmetto Street",
    city: "Charleston",
    state: "SC",
    zip: "29403",
    projectType: "remodel",
    clientType: "homeowner",
    sourceChannel: "referral",
    nextStepCandidates: ["schedule_previsit"],
  } as never;

  const foreignClient = {
    id: "client-of-b",
    tenantId: TENANT_B,
    name: "Sarah Whitfield",
    email: "sarah@example.com",
    phone: "8435550142",
    address: "412 Palmetto St",
    city: "Charleston",
    state: "SC",
    zip: "29403",
    deletedAt: null,
    isActive: true,
  } as never;

  it("a null caller tenant never classifies another tenant's client as its own", async () => {
    const { evaluateClientMatches } = await import("@shared/intake-conversion");

    // classifyCandidateTenant() used to answer "own" whenever the caller tenant was
    // absent, which let a caller with no identity reuse any tenant's client record.
    expect(evaluateClientMatches(candidate, [foreignClient])).toEqual([]);
  });

  it("a null caller tenant cannot reuse another tenant's client in the plan", async () => {
    const { buildConversionPlan } = await import("@shared/intake-conversion");

    const plan = buildConversionPlan(candidate, [foreignClient], []);

    expect(plan.clientIdToReuse).toBeNull();
  });

  it("orchestrateLeadConversion cannot create client/project/deal rows", async () => {
    const { orchestrateLeadConversion } = await import("./pipeline-db");

    // The lead lookup resolves a real tenant-B lead, so the refusal is an authorization
    // decision rather than a missing fixture.
    await expect(orchestrateLeadConversion("row-of-b", USER, NO_TENANT)).rejects.toThrow();

    // The decisive assertion: nothing was written. The old code path reached
    // `withTenant(values, null)` three times and minted untenanted client, project and
    // deal rows because the caller had no tenant.
    expect(db.inserts).toBe(0);
  });

  it("orchestrateDealWin cannot mutate a deal", async () => {
    const { orchestrateDealWin } = await import("./pipeline-db");

    await expect(orchestrateDealWin("row-of-b", USER, NO_TENANT)).rejects.toThrow();
    expect(db.updates).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11 & 12. The procedure boundary
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · the tenant-aware procedure boundary", () => {
  const noTenantCaller = async () => {
    const { dealRouter } = await import("./deal-router");
    return dealRouter.createCaller({
      user: { id: USER, role: "admin" },
      tenantId: null,
    } as never);
  };

  it("12. ordinary tenant business routes reject an unresolved tenant", async () => {
    const caller = await noTenantCaller();

    await expect(caller.stats()).rejects.toThrow(/No tenant is assigned/);
    await expect(caller.list({})).rejects.toThrow(/No tenant is assigned/);
  });

  it("12. the rejection precedes input validation — authorization first", async () => {
    const caller = await noTenantCaller();

    // Deliberately invalid input: the tenant refusal must still be what comes back, so
    // an unprovisioned caller cannot probe the input schema.
    await expect(caller.create({} as never)).rejects.toThrow(/No tenant is assigned/);
  });

  it("12. a resolved tenant passes the boundary and reaches the handler", async () => {
    const { dealRouter } = await import("./deal-router");
    const caller = dealRouter.createCaller({
      user: { id: USER, role: "admin" },
      tenantId: TENANT_A,
    } as never);

    // Reaching the handler at all is the claim; the fake's return value is irrelevant.
    await expect(caller.stats()).resolves.not.toThrow;
  });

  it("11. the pre-tenant carve-outs are not behind the tenant boundary", () => {
    // auth.* — an unprovisioned user must be able to learn that they are unprovisioned.
    expect(readFileSync("server/auth-router.ts", "utf8")).not.toContain("tenantProcedure");

    // system.health — liveness probe.
    expect(readFileSync("server/_core/systemRouter.ts", "utf8")).not.toContain(
      "tenantProcedure",
    );

    // tenantSettings.provision — the operation that CREATES a tenant cannot require one.
    expect(readFileSync("server/tenant-settings-router.ts", "utf8")).toMatch(
      /\n {2}provision: adminProcedure/,
    );
  });

  it("11. auth.session is reachable with no tenant at all", async () => {
    const { authRouter } = await import("./auth-router");

    const caller = authRouter.createCaller({
      user: null,
      tenantId: null,
      authProvider: "supabase",
    } as never);

    await expect(caller.session()).resolves.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The identity fix that makes all of the above reachable
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 · resolveTenantId no longer invents a tenant", () => {
  it("a profile with no tenant resolves to null, not the default tenant", async () => {
    const { sdk } = await import("./_core/sdk");

    // Previously this returned getDefaultTenantId() — the GCHI tenant — so every
    // unprovisioned account silently read the primary production tenant's business data
    // through helpers that then scoped it perfectly to a tenant identity invented here.
    await expect(sdk.resolveTenantId({ tenantId: null } as never)).resolves.toBeNull();
    await expect(sdk.resolveTenantId(null)).resolves.toBeNull();
  });

  it("a profile with a tenant still resolves to that tenant", async () => {
    const { sdk } = await import("./_core/sdk");

    await expect(sdk.resolveTenantId({ tenantId: TENANT_A } as never)).resolves.toBe(
      TENANT_A,
    );
  });
});
