/**
 * Stable tRPC API -> real reader -> real PostgreSQL -> real resolution engines.
 * Only DB acquisition, parent/draft/catalog dependencies and log/audit sinks are
 * substituted. No tenant filtering is implemented by a double. External FKs and
 * RLS are absent from the existing disposable harness, so neither is certified.
 * RED selects same-api cases; candidate-contract cases are GREEN-only evidence.
 */
import { existsSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { geographicOverrides, type InsertGeographicOverride } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { startG2PointPostgres, type G2PointConnection, type G2PointPostgres } from "./test-support/g2-1-postgres";

const boundary = vi.hoisted(() => ({
  db: null as PostgresJsDatabase | null, acquisitions: 0, acquisitionError: false,
  audit: vi.fn(), logRead: vi.fn(), logWrite: vi.fn(), draft: vi.fn(),
  items: vi.fn(), assemblies: vi.fn(), project: vi.fn(), templates: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: async () => {
  boundary.acquisitions++;
  if (boundary.acquisitionError) throw new Error("SYNTHETIC_PRIVATE_CONNECTION_DETAIL");
  return boundary.db;
} }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));
vi.mock("./project-access", () => ({ requireEntityAccess: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./scope-db", () => ({ getScopeDraftWithItems: boundary.draft }));
vi.mock("./scope-review-db", () => ({ getEffectiveItems: boundary.items }));
vi.mock("./assembly-db", () => ({ listAssemblies: boundary.assemblies }));
vi.mock("./project-db", () => ({ getProjectById: boundary.project }));
vi.mock("./remodel-db", () => ({ listRemodelTemplates: boundary.templates }));
vi.mock("./geo-override-db", async original => ({
  ...await original<typeof import("./geo-override-db")>(),
  getOverrideLogForDraft: boundary.logRead, writeOverrideLogEntries: boundary.logWrite,
}));
vi.mock("dotenv", () => ({ default: { config: () => ({ parsed: {} }) } }));
vi.mock("postgres", () => ({ default: () => { throw new Error("Unowned PostgreSQL connection refused"); } }));

const id = (n: number) => `a2300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1), B = id(2), USER = id(3), ZONE = id(4), DRAFT = id(5), PROJECT = id(6);
const ORIGINAL = id(7), REPLACEMENT = id(8), FOREIGN_REPLACEMENT = id(9);
const [A1, A2, A3, A4, A5, B1, LEGACY] = [10, 11, 12, 13, 14, 20, 30].map(id);
const safeMessage = "Geographic override rules are unavailable";
type Readers = {
  listOverrideRules(tenant: unknown, opts?: { zoneId?: string; zone?: string; trade?: string; activeOnly?: boolean }): Promise<Array<{ id: string; overrideType: string; tenantId: string | null }>>;
  getOverrideCountsByZoneId(tenant: unknown): Promise<Array<{ zoneId: string | null; count: number }>>;
  getOverrideCountsByZone(tenant: unknown): Promise<Array<{ zoneId: string | null; count: number }>>;
};
function context(): TrpcContext {
  return {
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    user: { id: USER, tenantId: A, externalOpenId: "g2-reads-admin", email: null,
      loginMethod: null, fullName: "Synthetic admin", companyName: null, role: "admin", isActive: true,
      lastSignedIn: null, createdAt: new Date(0), updatedAt: new Date(0) },
    tenantId: A, authProvider: "legacy",
  };
}

describe.skipIf(process.env.G2_RULE_READS_POSTGRES !== "1")("G2 rule readers — owned PostgreSQL", () => {
  let cluster: G2PointPostgres, application: G2PointConnection;
  let geo: typeof import("./geo-override-router")["geoOverrideRouter"];
  let remodel: typeof import("./remodel-router")["remodelRouter"];
  let helpers: Readers;
  let before: unknown;
  beforeAll(async () => {
    const real = await vi.importActual<{ default: typeof postgres }>("postgres");
    cluster = await startG2PointPostgres(real.default);
    application = await cluster.connect("rule-reads");
    expect(application.pid).not.toBe(cluster.observer.pid);
    geo = (await import("./geo-override-router")).geoOverrideRouter;
    remodel = (await import("./remodel-router")).remodelRouter;
    helpers = await import("./geo-override-db") as unknown as Readers;
  }, 60_000);
  afterAll(async () => {
    await cluster?.stop();
    if (cluster) expect(existsSync(cluster.directory)).toBe(false);
  }, 20_000);
  beforeEach(async () => {
    vi.clearAllMocks();
    await cluster.observer.sql.unsafe("TRUNCATE geographic_overrides");
    const common = { zone: "coastal", trade: "electrical", finishLevel: null,
      originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT,
      overrideType: "swap", reasonTemplate: "Synthetic own override", isActive: true } as const;
    await cluster.observer.db.insert(geographicOverrides).values([
      { ...common, id: A1, tenantId: A, zoneId: ZONE },
      { ...common, id: A2, tenantId: A, zoneId: ZONE, zone: "inland", trade: "plumbing", overrideType: "add" },
      { ...common, id: A3, tenantId: A, isActive: false },
      { ...common, id: A4, tenantId: A, trade: "plumbing", overrideType: "warning_only" },
      { ...common, id: A5, tenantId: A, zone: "", trade: "", overrideType: "warning_only" },
      { ...common, id: B1, tenantId: B, zoneId: ZONE, replacementAssemblyId: FOREIGN_REPLACEMENT, overrideType: "add" },
      { ...common, id: LEGACY, tenantId: null, zoneId: ZONE, replacementAssemblyId: FOREIGN_REPLACEMENT, overrideType: "add" },
    ] satisfies InsertGeographicOverride[]);
    boundary.db = application.db; boundary.acquisitions = 0; boundary.acquisitionError = false;
    boundary.audit.mockResolvedValue({ id: id(50) }); boundary.logRead.mockResolvedValue([]);
    boundary.logWrite.mockResolvedValue([]);
    const item = { assemblyId: ORIGINAL, quantity: "2", unit: "EA", reason: "Synthetic scope", confidence: "0.90", sortOrder: 0 };
    boundary.items.mockResolvedValue([item]);
    boundary.draft.mockResolvedValue({ draft: { id: DRAFT, projectId: PROJECT, status: "approved",
      confidence: "0.90", warningsJson: [], createdAt: new Date(0) }, items: [item] });
    boundary.assemblies.mockResolvedValue({ items: [ORIGINAL, REPLACEMENT, FOREIGN_REPLACEMENT].map((assemblyId, i) => ({
      id: assemblyId, name: `Synthetic assembly ${i}`, code: `S${i}`, trade: "electrical", category: "electrical", defaultUnitId: null,
    })) });
    boundary.project.mockResolvedValue({ id: PROJECT, tenantId: A, zone: "coastal" });
    boundary.templates.mockResolvedValue([]);
    application.queries.length = 0;
    before = await rows();
  });
  afterEach(async test => {
    if (cluster && before) {
      const after = await rows();
      console.info("G2_READ_PROOF " + JSON.stringify({ name: test.task.name, before, after,
        queries: application.queries, acquisitions: boundary.acquisitions,
        audits: boundary.audit.mock.calls, logWrites: boundary.logWrite.mock.calls }));
      expect(after).toEqual(before);
      expect(boundary.logWrite).not.toHaveBeenCalled();
    }
    vi.unstubAllEnvs(); boundary.db = null;
  });
  async function rows() { return Array.from(await cluster.observer.sql`SELECT * FROM geographic_overrides ORDER BY id`); }
  const ids = (values: Array<{ id: string }>) => values.map(row => row.id).sort();
  function caller() { return geo.createCaller(context()); }
  function assertTenantQuery() {
    expect(application.queries.some(q => q.sql.includes('"tenant_id" =') && q.parameters.includes(A))).toBe(true);
    expect(application.queries.every(q => !/\b(?:insert|update|delete)\b/i.test(q.sql))).toBe(true);
  }

  describe("same-api", () => {
    for (const strict of ["false", "true"]) {
      it(`admin list excludes B/NULL with strict=${strict}`, async () => {
        vi.stubEnv("TENANT_STRICT", strict);
        expect(ids(await caller().listRules())).toEqual([A1, A2, A4, A5].sort());
        assertTenantQuery(); expect(boundary.audit).not.toHaveBeenCalled();
      });
      it(`activeOnly=false includes only own inactive with strict=${strict}`, async () => {
        vi.stubEnv("TENANT_STRICT", strict);
        expect(ids(await caller().listRules({ activeOnly: false }))).toEqual([A1, A2, A3, A4, A5].sort());
      });
      it(`aggregate excludes B/NULL before grouping with strict=${strict}`, async () => {
        vi.stubEnv("TENANT_STRICT", strict);
        const result = await caller().statsByZone();
        // Numeric conversion here isolates ownership from the separate driver-type case.
        expect(result.map(row => [row.zoneId, Number(row.count)]).sort()).toEqual([[null, 2], [ZONE, 2]].sort());
        assertTenantQuery();
      });
    }
    it("COUNT has actual number values from the PostgreSQL driver", async () => {
      expect((await caller().statsByZone()).every(row => typeof row.count === "number")).toBe(true);
    });
    it("zone and normalized trade combine by exact AND", async () => {
      expect(ids(await caller().listRules({ zone: "coastal", trade: "Electrical" }))).toEqual([A1]);
    });
    it("present empty zone and trade are real filters", async () => {
      expect(ids(await caller().listRules({ zone: "", trade: "" }))).toEqual([A5]);
    });
    it("zone and unknown trade are literal, not wildcard searches", async () => {
      expect(await caller().listRules({ zone: "coast%", trade: "unknown-trade" })).toEqual([]);
    });
    it("order remains overrideType ascending without specifying tied order", async () => {
      const result = await caller().listRules();
      expect(result.map(row => row.overrideType)).toEqual(["add", "swap", "warning_only", "warning_only"]);
    });
    it("unknown payload tenant cannot change trusted context", async () => {
      const payload = { tenantId: B, activeOnly: true };
      expect(ids(await caller().listRules(payload))).toEqual([A1, A2, A4, A5].sort());
    });
    it("tenant with no rows has legitimate empty list and aggregate", async () => {
      const ctx = context(); ctx.tenantId = id(999);
      expect(await geo.createCaller(ctx).listRules()).toEqual([]);
      expect(await geo.createCaller(ctx).statsByZone()).toEqual([]);
    });
    for (const endpoint of ["listRules", "statsByZone"] as const) {
      it(`${endpoint} missing tenant fails before acquisition`, async () => {
        const ctx = Object.assign(context(), { tenantId: undefined });
        await expect(geo.createCaller(ctx)[endpoint]()).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(boundary.acquisitions).toBe(0);
      });
      it(`${endpoint} anonymous fails before acquisition`, async () => {
        const ctx = context(); ctx.user = null;
        await expect(geo.createCaller(ctx)[endpoint]()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect(boundary.acquisitions).toBe(0);
      });
      for (const fault of ["absent", "acquisition", "query"] as const) it(`${endpoint} ${fault} failure is a safe error, never empty`, async () => {
        if (fault === "absent") boundary.db = null;
        if (fault === "acquisition") boundary.acquisitionError = true;
        if (fault === "query") await cluster.observer.sql.unsafe("ALTER TABLE geographic_overrides RENAME TO unavailable_rules");
        try {
          const error = await geo.createCaller(context())[endpoint]().then(() => null, error => error);
          expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: safeMessage });
          expect(error.cause?.message).toBe(safeMessage);
          expect(error.cause?.cause).toBeUndefined();
        } finally {
          if (fault === "query") await cluster.observer.sql.unsafe("ALTER TABLE unavailable_rules RENAME TO geographic_overrides");
        }
      });
    }
    for (const mode of ["preview", "resolve", "remodel"] as const) {
      it(`${mode} real engines exclude B/NULL from output and rulesEvaluated`, async () => {
        // Isolate one own matching swap and two foreign matching additions.
        await cluster.observer.sql`DELETE FROM geographic_overrides WHERE id IN (${A2}::uuid, ${A3}::uuid, ${A4}::uuid, ${A5}::uuid)`;
        before = await rows();
        const result = mode === "preview"
          ? await caller().previewForDraft({ scopeDraftId: DRAFT, projectZone: "coastal" })
          : mode === "resolve"
          ? await caller().resolveForDraft({ scopeDraftId: DRAFT, projectZone: "coastal", persistLog: false })
          : await remodel.createCaller(context()).generateWorkflow({ scopeDraftId: DRAFT });
        if ("resolvedItems" in result) {
          expect(result.resolvedItems.map(row => [row.assemblyId, row.quantity])).toEqual([[REPLACEMENT, 2]]);
          expect(result.stats).toMatchObject({ rulesEvaluated: 1, rulesMatched: 1, swapsApplied: 1 });
        } else {
          expect(result.orderedAssemblies.map(row => [row.assemblyId, row.quantity])).toEqual([[REPLACEMENT, 2]]);
          expect(result.overrideResult?.stats).toMatchObject({ rulesEvaluated: 1, rulesMatched: 1, swapsApplied: 1 });
        }
        expect(boundary.audit).toHaveBeenCalledTimes(mode === "resolve" ? 1 : 0);
        if (mode === "resolve") expect(boundary.audit.mock.calls[0][0].after.stats.rulesEvaluated).toBe(1);
        assertTenantQuery();
      });
      it(`${mode} unavailable reader stops before history, writes and success audit`, async () => {
        boundary.db = null;
        const result = mode === "preview" ? caller().previewForDraft({ scopeDraftId: DRAFT, projectZone: "coastal" })
          : mode === "resolve" ? caller().resolveForDraft({ scopeDraftId: DRAFT, projectZone: "coastal", persistLog: false })
          : remodel.createCaller(context()).generateWorkflow({ scopeDraftId: DRAFT });
        await expect(result).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: safeMessage });
        expect(boundary.logRead).not.toHaveBeenCalled(); expect(boundary.templates).not.toHaveBeenCalled();
        expect(boundary.audit).not.toHaveBeenCalled();
      });
    }
  });

  describe("candidate-contract", () => {
    for (const name of ["listOverrideRules", "getOverrideCountsByZoneId", "getOverrideCountsByZone"] as const) {
      for (const tenant of [undefined, null, "", "   ", 42]) it(`${name} refuses invalid tenant ${String(tenant)} before DB`, async () => {
        await expect(helpers[name](tenant)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
        expect(boundary.acquisitions).toBe(0);
      });
    }
    it("internal zoneId intersects zone/trade and retains inactive option", async () => {
      expect(ids(await helpers.listOverrideRules(A.toUpperCase(), { zoneId: ZONE, zone: "coastal", trade: "electrical", activeOnly: false }))).toEqual([A1]);
      expect(ids(await helpers.listOverrideRules(A, { zoneId: "", activeOnly: false }))).toEqual([A1, A2, A3, A4, A5].sort());
    });
    it("count alias shares the required tenant and count ordering", async () => {
      await cluster.observer.sql`UPDATE geographic_overrides SET zone_id = ${ZONE}::uuid WHERE id = ${A4}::uuid`;
      before = await rows();
      expect(await helpers.getOverrideCountsByZoneId(A.toUpperCase())).toEqual([{ zoneId: ZONE, count: 3 }, { zoneId: null, count: 1 }]);
      expect(await helpers.getOverrideCountsByZone(A)).toEqual([{ zoneId: ZONE, count: 3 }, { zoneId: null, count: 1 }]);
    });
  });
});
