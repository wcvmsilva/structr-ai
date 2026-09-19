/**
 * Actual tRPC caller -> actual CRUD helpers -> owned, disposable PostgreSQL.
 * Only DB acquisition and the audit sink are substituted. External FKs/RLS are
 * omitted by the harness; this proves the named rule operations, not all G2/G4.
 * Stable API cases run unchanged on bf9 and the candidate. Direct helper cases
 * are explicitly candidate-only because their argument contract changes.
 */
import { existsSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { geographicOverrides, type GeographicOverride, type InsertGeographicOverride } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { startG2PointPostgres, type G2PointConnection, type G2PointPostgres } from "./test-support/g2-1-postgres";

const boundary = vi.hoisted(() => ({
  db: null as PostgresJsDatabase | null,
  acquisitions: 0,
  audit: null as null | ((params: unknown) => Promise<unknown>),
}));
vi.mock("./db", () => ({ getDb: async () => { boundary.acquisitions++; return boundary.db; } }));
vi.mock("./audit", () => ({ logAudit: (params: unknown) => {
  if (!boundary.audit) throw new Error("G2-1 audit boundary not initialized");
  return boundary.audit(params);
} }));
vi.mock("dotenv", () => ({ default: { config: () => ({ parsed: {} }) } }));
vi.mock("postgres", () => ({ default: () => { throw new Error("G2-1 refuses an unowned PostgreSQL connection"); } }));

const A = "a2000000-0000-4000-8000-000000000001";
const B = "a2000000-0000-4000-8000-000000000002";
const USER_A = "a2000000-0000-4000-8000-000000000003";
const RULE_A = "a2000000-0000-4000-8000-000000000010";
const RULE_B = "a2000000-0000-4000-8000-000000000020";
const RULE_NULL = "a2000000-0000-4000-8000-000000000030";
const MISSING = "a2000000-0000-4000-8000-000000000099";
const ORIGINAL = "a2000000-0000-4000-8000-000000000040";
const REPLACEMENT = "a2000000-0000-4000-8000-000000000050";
const createInput = {
  zone: "coastal", trade: "electrical", finishLevel: null,
  originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT,
  overrideType: "swap" as const, reasonTemplate: "Own rule", active: true,
};
const createData = { ...createInput, isActive: true };
const pointOperations = ["get", "update", "deactivate", "reactivate"] as const;
type Point = typeof pointOperations[number];
type Write = Exclude<Point, "get"> | "create";
type Outcome = { value: unknown; error: { name?: string; message?: string; code?: string } | null };
type AuditParams = { action: string; tableName: string; recordId: string; userId: unknown;
  before?: GeographicOverride; after: GeographicOverride & { operatorId: string } };
// Used only by the candidate-only direct contract cases. Runtime exports already
// exist on the baseline; no new runtime export/import is fabricated for RED.
type CandidateHelpers = {
  getOverrideRuleById(tenantId: unknown, id: string): Promise<GeographicOverride | null>;
  createOverrideRule(tenantId: unknown, data: Record<string, unknown>, operatorId: string): Promise<GeographicOverride>;
  updateOverrideRule(tenantId: unknown, id: string, data: Record<string, unknown>, operatorId: string): Promise<GeographicOverride | null>;
  deactivateOverrideRule(tenantId: unknown, id: string, operatorId: string): Promise<boolean>;
  reactivateOverrideRule(tenantId: unknown, id: string, operatorId: string): Promise<boolean>;
};

function context(): TrpcContext {
  return {
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
    user: { id: USER_A, tenantId: A, externalOpenId: "g2point-admin", email: null,
      loginMethod: null, fullName: "Synthetic admin", companyName: null, role: "admin", isActive: true,
      lastSignedIn: null, createdAt: new Date(0), updatedAt: new Date(0) },
    tenantId: A, authProvider: "legacy",
  };
}

describe.skipIf(process.env.G2_1_POSTGRES !== "1")("G2-1 CRUD — owned disposable PostgreSQL", () => {
  let cluster: G2PointPostgres;
  let application: G2PointConnection;
  let caller: ReturnType<typeof import("./geo-override-router")["geoOverrideRouter"]["createCaller"]>;
  let helpers: CandidateHelpers;
  let audits: Array<{ params: AuditParams; visible: GeographicOverride[]; queriesAtCall: G2PointConnection["queries"] }>;
  let evidence: { name: string; before?: unknown; after?: unknown; outcomes: Outcome[] };

  beforeAll(async () => {
    const real = await vi.importActual<{ default: typeof postgres }>("postgres");
    cluster = await startG2PointPostgres(real.default);
    application = await cluster.connect("application");
    expect(application.pid).not.toBe(cluster.observer.pid);
    const router = await import("./geo-override-router");
    caller = router.geoOverrideRouter.createCaller(context());
    helpers = await import("./geo-override-db") as unknown as CandidateHelpers;
  }, 60_000);
  afterAll(async () => {
    await cluster?.stop();
    if (cluster) expect(existsSync(cluster.directory)).toBe(false);
  }, 20_000);
  beforeEach(async test => {
    await cluster.observer.sql.unsafe("DROP FUNCTION IF EXISTS g2point_fault() CASCADE");
    await cluster.observer.sql.unsafe("TRUNCATE geographic_overrides");
    await cluster.observer.db.insert(geographicOverrides).values([
      { ...createData, id: RULE_A, tenantId: A },
      { ...createData, id: RULE_B, tenantId: B, reasonTemplate: "Other tenant rule" },
      { ...createData, id: RULE_NULL, tenantId: null, reasonTemplate: "Legacy rule" },
    ] satisfies InsertGeographicOverride[]);
    boundary.db = application.db; boundary.acquisitions = 0;
    audits = []; application.queries.length = 0;
    evidence = { name: test.task.name, before: await rawRows(), outcomes: [] };
    boundary.audit = async params => {
      audits.push({ params: structuredClone(params) as AuditParams, visible: await rows(),
        queriesAtCall: structuredClone(application.queries) });
      return { id: "a2000000-0000-4000-8000-000000000060" };
    };
  });
  afterEach(async () => {
    if (cluster && evidence) {
      evidence.after = await rawRows();
      // Opt-in evidence is emitted for successful and failed cases alike, including
      // effects that happened before an assertion failed on the previous HEAD.
      if (process.env.G2_1_TRACE === "1") console.info("G2_1_PROOF " + JSON.stringify({
        ...evidence, queries: application.queries, audits,
      }));
    }
    boundary.audit = null; boundary.db = null;
    vi.unstubAllEnvs();
  });

  async function rows() { return cluster.observer.db.select().from(geographicOverrides).orderBy(geographicOverrides.id); }
  async function rawRows() { return Array.from(await cluster.observer.sql`SELECT * FROM geographic_overrides ORDER BY id`); }
  async function outcome(promise: Promise<unknown>): Promise<Outcome> {
    const result = await promise.then(value => ({ value, error: null }), caught => ({ value: null,
      error: { name: caught?.name, code: caught?.code, message: caught?.message } }));
    evidence.outcomes.push(result);
    return result;
  }
  async function invoke(operation: Point, id = RULE_A) {
    if (operation === "get") return caller.getRule({ id });
    if (operation === "update") return caller.updateRule({ id, reasonTemplate: "Unauthorized change" });
    if (operation === "deactivate") return caller.deactivateRule({ id });
    return caller.reactivateRule({ id });
  }
  async function prepare(operation: Point | Write, id = RULE_A) {
    if (operation === "reactivate") await cluster.observer.sql`UPDATE geographic_overrides SET is_active = false WHERE id = ${id}::uuid`;
    evidence.before = await rawRows();
  }
  function expectUnavailable(result: Outcome) {
    expect(result.value).toBeNull();
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toBe("Override rule not found");
    expect(audits).toHaveLength(0);
  }
  async function fault(event: "INSERT" | "UPDATE", timing: "BEFORE" | "AFTER", body: string) {
    await cluster.observer.sql.unsafe(`CREATE FUNCTION g2point_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF; ${body} END $$`);
    await cluster.observer.sql.unsafe(`CREATE TRIGGER g2point_trigger ${timing} ${event}
      ON geographic_overrides FOR EACH ROW EXECUTE FUNCTION g2point_fault()`);
  }
  function expectTransactionRolledBack() {
    expect(application.queries.some(query => /^begin\b/i.test(query.sql))).toBe(true);
    expect(application.queries.some(query => /^rollback\b/i.test(query.sql))).toBe(true);
    expect(application.queries.some(query => /^commit\b/i.test(query.sql))).toBe(false);
  }

  describe("same-api — tenant security contrasts", () => {
    // 16 cases: four points x foreign/NULL x both global strict modes.
    for (const strict of ["false", "true"]) for (const [owner, id] of [["B", RULE_B], ["NULL", RULE_NULL]]) {
      for (const operation of pointOperations) it(`${operation} denies ${owner}; TENANT_STRICT=${strict}`, async () => {
        vi.stubEnv("TENANT_STRICT", strict);
        await prepare(operation, id);
        const before = await rawRows();
        const result = await outcome(invoke(operation, id));
        const after = await rawRows();
        if (operation === "get") expect(result.value).toBeNull();
        expect(after).toEqual(before);
        expectUnavailable(result);
      });
    }
    // Four baseline control cases: already absent is NOT_FOUND in the old API.
    for (const operation of pointOperations) it(`${operation} missing ID is unavailable`, async () => {
      const before = await rawRows();
      const result = await outcome(invoke(operation, MISSING));
      expect(await rawRows()).toEqual(before);
      expectUnavailable(result);
    });
    it("create→get→update→deactivate→reactivate stamps A and preserves the own cycle", async () => {
      const created = await caller.createRule(createInput);
      const [stored] = await cluster.observer.sql`SELECT tenant_id, reason_template, is_active
        FROM geographic_overrides WHERE id = ${created.id}::uuid`;
      // Record the old global cycle before asserting the stamp, so baseline NULL
      // remains a valid tenant RED and compatibility success is also observable.
      expect((await caller.getRule({ id: created.id })).id).toBe(created.id);
      await caller.updateRule({ id: created.id, reasonTemplate: "Own revised rule" });
      expect((await caller.getRule({ id: created.id })).reasonTemplate).toBe("Own revised rule");
      await caller.deactivateRule({ id: created.id });
      expect((await caller.getRule({ id: created.id })).isActive).toBe(false);
      await caller.reactivateRule({ id: created.id });
      expect((await caller.getRule({ id: created.id })).isActive).toBe(true);
      evidence.outcomes.push({ value: { id: created.id, stored, cycleCompleted: true }, error: null });
      expect(stored.tenant_id).toBe(A);
      expect(audits.map(item => item.params.action)).toEqual([
        "geo_override.create", "geo_override.update", "geo_override.deactivate", "geo_override.reactivate",
      ]);
      expect(audits[0].params.before).toBeUndefined();
      for (const [index, audit] of audits.entries()) {
        expect(audit.params).toMatchObject({ tableName: "geographic_overrides", recordId: created.id, userId: null,
          after: { id: created.id, tenantId: A, operatorId: USER_A } });
        if (index > 0) expect(audit.params.before).toEqual(audits[index - 1].visible.find(row => row.id === created.id));
        expect(audit.params.after).toEqual({ ...audit.visible.find(row => row.id === created.id), operatorId: USER_A });
        expect(audit.queriesAtCall.at(-1)?.sql).toMatch(/^commit\b/i);
      }
    });
  });

  describe("candidate-only — direct helper contracts", () => {
    for (const name of ["getOverrideRuleById", "createOverrideRule", "updateOverrideRule", "deactivateOverrideRule", "reactivateOverrideRule"] as const) {
      it(`${name} rejects invalid tenant before acquiring DB`, async () => {
        for (const tenant of [undefined, null, "", "   ", 42]) {
          const call = name === "createOverrideRule" ? helpers[name](tenant, createData, USER_A)
            : name === "updateOverrideRule" ? helpers[name](tenant, RULE_A, { reasonTemplate: "Bad" }, USER_A)
            : name === "getOverrideRuleById" ? helpers[name](tenant, RULE_A) : helpers[name](tenant, RULE_A, USER_A);
          const result = await outcome(call);
          expect(result.error?.name).toBe("TenantScopeError");
        }
        expect(boundary.acquisitions).toBe(0);
        expect(application.queries).toHaveLength(0);
        expect(await rawRows()).toEqual(evidence.before);
        expect(audits).toHaveLength(0);
      });
    }
    for (const operation of ["create", "update"] as const) for (const tenantId of [B, null]) {
      it(`${operation} ignores forged tenant ${tenantId === null ? "NULL" : "B"}, ID and timestamps`, async () => {
        const forged = { tenantId, id: MISSING, createdAt: new Date(0), updatedAt: new Date(0), active: false };
        const original = (await rows()).find(row => row.id === RULE_A)!;
        const result = operation === "create"
          ? await helpers.createOverrideRule(A, { ...createData, ...forged }, USER_A)
          : await helpers.updateOverrideRule(A, RULE_A, { reasonTemplate: "Allowed change", ...forged }, USER_A);
        expect(result).not.toBeNull();
        expect(result!.tenantId).toBe(A);
        expect(result!.id).not.toBe(MISSING);
        const stored = (await rows()).find(row => row.id === result!.id)!;
        expect(stored).toEqual(result);
        expect(stored.createdAt.getTime()).not.toBe(0);
        expect(stored.updatedAt.getTime()).not.toBe(0);
        expect(stored.isActive).toBe(true);
        if (operation === "update") {
          expect(stored.id).toBe(RULE_A);
          expect(stored.createdAt).toEqual(original.createdAt);
          expect(stored.updatedAt).toEqual(original.updatedAt);
        }
        expect(audits).toHaveLength(1);
      });
    }
  });

  describe("same-api — PostgreSQL mutation and rollback oracles", () => {
    for (const operation of ["update", "deactivate", "reactivate"] as const) {
      it(`${operation} rejects a BEFORE UPDATE RETURN NULL zero-row write`, async () => {
        await prepare(operation);
        await fault("UPDATE", "BEFORE", "RETURN NULL;");
        const before = await rawRows();
        const result = await outcome(invoke(operation));
        expect(await rawRows()).toEqual(before);
        expectUnavailable(result);
        expectTransactionRolledBack();
        expect(application.queries.some(query => /^update\b/i.test(query.sql))).toBe(true);
      });
    }
    for (const operation of ["update", "create"] as const) for (const sabotage of ["owner B", "owner NULL", "DELETE"] as const) {
      it(`${operation} rolls back after ${sabotage} invalidates readback`, async () => {
        const body = sabotage === "DELETE" ? "DELETE FROM geographic_overrides WHERE id = NEW.id; RETURN NEW;"
          : `UPDATE geographic_overrides SET tenant_id = ${sabotage === "owner B" ? `'${B}'::uuid` : "NULL"} WHERE id = NEW.id; RETURN NEW;`;
        await fault(operation === "create" ? "INSERT" : "UPDATE", "AFTER", body);
        const before = await rawRows();
        const result = await outcome(operation === "create" ? caller.createRule(createInput) : invoke("update"));
        expect(await rawRows()).toEqual(before);
        expect(result.error).not.toBeNull();
        if (operation === "update") expectUnavailable(result);
        else { expect(result.error?.code).toBe("INTERNAL_SERVER_ERROR"); expect(audits).toHaveLength(0); }
        expectTransactionRolledBack();
        expect(application.queries.some(query => new RegExp(`^${operation === "create" ? "insert" : "update"}\\b`, "i").test(query.sql))).toBe(true);
      });
    }
    for (const operation of ["create", "update", "deactivate", "reactivate"] as const) {
      it(`${operation} preserves committed business result when awaited audit sink returns NULL`, async () => {
        await prepare(operation);
        const sink = boundary.audit!;
        let signalStarted!: () => void;
        let release!: () => void;
        const started = new Promise<void>(resolve => { signalStarted = resolve; });
        const released = new Promise<void>(resolve => { release = resolve; });
        boundary.audit = async params => { await sink(params); signalStarted(); await released; return null; };
        let settled = false;
        const pending = outcome(operation === "create" ? caller.createRule(createInput) : invoke(operation))
          .then(result => { settled = true; return result; });
        let result!: Outcome;
        try {
          // A caller that fails before reaching the sink must not leave this test
          // waiting forever. Cleanup also joins the caller after failed assertions.
          const first = await Promise.race([
            started.then(() => "sink-started" as const),
            pending.then(() => "caller-settled" as const),
          ]);
          expect(first).toBe("sink-started");
          expect(settled).toBe(false);
          expect(audits).toHaveLength(1);
          expect(audits[0].queriesAtCall.at(-1)?.sql).toMatch(/^commit\b/i);
          const observed = audits[0].visible.find(row => row.id === audits[0].params.recordId)!;
          expect(observed.tenantId).toBe(A);
          if (operation === "update") expect(observed.reasonTemplate).toBe("Unauthorized change");
          if (operation === "deactivate" || operation === "reactivate") expect(observed.isActive).toBe(operation === "reactivate");
          expect(audits[0].params.after).toEqual({ ...observed, operatorId: USER_A });
        } finally {
          release();
          result = await pending;
        }
        expect(result.error).toBeNull();
        if (operation === "deactivate" || operation === "reactivate") expect(result.value).toBe(true);
        else expect(result.value).toMatchObject({ tenantId: A });
        expect(await rows()).toEqual(audits[0].visible);
      });
    }
    it("update audit throw propagates after business commit without retroactive rollback", async () => {
      const sink = boundary.audit!;
      boundary.audit = async params => { await sink(params); throw new Error("g2point audit sink failure"); };
      const result = await outcome(caller.updateRule({ id: RULE_A, reasonTemplate: "Committed despite audit throw" }));
      expect(result.error?.message).toContain("g2point audit sink failure");
      expect((await rows()).find(row => row.id === RULE_A)?.reasonTemplate).toBe("Committed despite audit throw");
      expect(audits).toHaveLength(1);
      expect(audits[0].queriesAtCall.at(-1)?.sql).toMatch(/^commit\b/i);
      expect(application.queries.some(query => /^rollback\b/i.test(query.sql))).toBe(false);
    });
    for (const [owner, id] of [["A", RULE_A], ["B", RULE_B]]) it(`empty patch for ${owner} performs no mutation or audit`, async () => {
      const before = await rawRows();
      const result = await outcome(caller.updateRule({ id }));
      expect(await rawRows()).toEqual(before);
      expect(audits).toHaveLength(0);
      expect(application.queries.some(query => /^update\b/i.test(query.sql))).toBe(false);
      if (owner === "A") { expect(result.error).toBeNull(); expect(result.value).toMatchObject({ id: RULE_A, tenantId: A }); }
      else expectUnavailable(result);
    });
    for (const operation of ["get", "update"] as const) it(`${operation} accepts uppercase UUID as the same PostgreSQL identity`, async () => {
      const { geoOverrideRouter } = await import("./geo-override-router");
      const uppercaseCaller = geoOverrideRouter.createCaller({ ...context(), tenantId: A.toUpperCase() });
      const id = RULE_A.toUpperCase();
      const result = await outcome(operation === "get" ? uppercaseCaller.getRule({ id })
        : uppercaseCaller.updateRule({ id, reasonTemplate: "Unauthorized change" }));
      expect(result.error).toBeNull();
      expect(result.value).toMatchObject({ id: RULE_A, tenantId: A });
      if (operation === "update") {
        expect((await rows()).find(row => row.id === RULE_A)?.reasonTemplate).toBe("Unauthorized change");
        expect(audits).toHaveLength(1);
      } else expect(audits).toHaveLength(0);
    });
    for (const operation of ["create", "update"] as const) it(`${operation} propagates unexpected SQL error and undoes statement effects`, async () => {
      await fault(operation === "create" ? "INSERT" : "UPDATE", "AFTER", "RAISE EXCEPTION 'g2point unexpected SQL failure';");
      const before = await rawRows();
      const result = await outcome(operation === "create" ? caller.createRule(createInput) : invoke("update"));
      expect(result.error?.code).toBe("INTERNAL_SERVER_ERROR");
      expect(result.error?.message).toContain("Failed query");
      expect(await rawRows()).toEqual(before);
      expect(audits).toHaveLength(0);
      expectTransactionRolledBack();
    });
  });
});
