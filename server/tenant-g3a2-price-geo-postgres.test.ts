import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, getTableName } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { geoZones, priceAdjustments } from "../drizzle/schema";
import { applyAdjustment, approveAdjustment, proposeAdjustment, rollbackAdjustment } from "./price-adjustment-db";
import { computeApplication } from "../shared/price-adjustment-engine";
import { gate, startG3a2Postgres, type G3a2Postgres } from "./test-support/g3a2-postgres";

// Audit is a call/order spy only; these proofs do not claim audit-log persistence.
const boundary = vi.hoisted(() => ({ db: null as any, current: null as any, audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => boundary.current?.getStore() ?? boundary.db }));
vi.mock("./audit-trail", () => ({ recordAuditAsync: (entry: unknown) => boundary.audit(entry) }));
vi.mock("./tenant-settings-db", () => ({ getTenantSettings: async () => null }));
vi.mock("./actuals-db", () => ({ getVarianceSnapshot: vi.fn() }));
vi.mock("./closeout-db", () => ({ getCloseoutByProject: vi.fn() }));
vi.mock("./field-operations-db", () => ({ getProjectBudgetEstimate: vi.fn(), listFieldTasks: vi.fn() }));

// Only execution boundaries are instrumented. Queries, engines, transaction handles,
// rows and public helpers remain real. No fake result or SELECT-count barrier.
type Query = { kind: string; table: string; sql: string; inTx: boolean };
type Hooks = { before?: (q: Query) => Promise<void>; after?: (q: Query) => Promise<void>; beforeCommit?: () => Promise<void> };
function instrument(db: PostgresJsDatabase, hooks: Hooks): PostgresJsDatabase {
  function handle(raw: any, inTx: boolean): any {
    function builder(rawQuery: any, kind: string, table = ""): any {
      let execution: Promise<unknown> | undefined;
      const execute = () => execution ??= (async () => {
        const q = { kind, table, inTx, sql: rawQuery.toSQL?.().sql ?? "" };
        await hooks.before?.(q);
        const result = await rawQuery;
        await hooks.after?.(q);
        return result;
      })();
      return new Proxy(rawQuery, { get(target, key) {
        if (key === "then") return (yes: any, no: any) => execute().then(yes, no);
        if (key === "execute") return execute;
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        return (...args: any[]) => {
          const next = value.apply(target, args);
          const nextTable = key === "from" ? getTableName(args[0]) : table;
          return next && typeof next === "object" ? builder(next, kind, nextTable) : next;
        };
      } });
    }
    return new Proxy(raw, { get(target, key) {
      if (key === "transaction") return (callback: any, config: any) => target.transaction(async (tx: any) => {
        const result = await callback(handle(tx, true));
        await hooks.beforeCommit?.();
        return result;
      }, config);
      const value = Reflect.get(target, key, target);
      if (["select", "update", "insert"].includes(String(key))) return (...args: any[]) =>
        builder(value.apply(target, args), String(key), key === "select" ? "" : getTableName(args[0]));
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }
  return handle(db, false);
}

describe.skipIf(process.env.G3A2_POSTGRES !== "1")("G3a2 price geo — owned disposable PostgreSQL", () => {
  const tenantId = "a1000000-0000-4000-8000-000000000001";
  const foreign = "a1000000-0000-4000-8000-000000000002";
  const actorId = "b1000000-0000-4000-8000-000000000001";
  const current = new AsyncLocalStorage<PostgresJsDatabase>();
  let cluster: G3a2Postgres;
  beforeAll(async () => { cluster = await startG3a2Postgres(); boundary.current = current; }, 60_000);
  afterAll(async () => { await cluster?.stop(); }, 20_000);
  beforeEach(async () => {
    if (!cluster) throw new Error("Enabled PostgreSQL setup did not complete");
    await cluster.observer.sql.unsafe("DROP FUNCTION IF EXISTS g3a2_fault() CASCADE");
    await cluster.observer.sql.unsafe("TRUNCATE geo_zones, price_adjustments, projects, calibration_events, calibration_reports");
    boundary.db = cluster.first.db;
    boundary.audit.mockReset();
    vi.stubEnv("TENANT_STRICT", "false");
  });
  afterAll(() => vi.unstubAllEnvs());
  async function zone(owner: string | null = tenantId, factor: string | null = "42") {
    const [row] = await cluster.observer.db.insert(geoZones).values({ tenantId: owner, name: "Synthetic G3a2 zone", minProfitShieldPct: factor,
      description: "Commercial floor must survive", costMultiplier: "1.12", validatedFloorPct: "39", validationSampleCount: 3 }).returning();
    return row;
  }
  async function adjustment(geoZoneId: string, status = "approved", overrides: Record<string, unknown> = {}) {
    const snapshot = computeApplication({ targetType: "geo_factor", targetId: geoZoneId, adjustmentPct: 5, currentFactor: 42, capturedAt: "2026-09-14T12:00:00.000Z" }).snapshot;
    const [row] = await cluster.observer.db.insert(priceAdjustments).values({ tenantId, geoZoneId, targetType: "geo_factor", adjustmentPct: "5", reason: "Synthetic proof", status,
      proposedBy: actorId, approvedBy: actorId, approvedAt: new Date("2026-09-14T12:00:00Z"), rollbackSnapshot: status === "applied" ? snapshot : null, ...overrides } as any).returning();
    return row;
  }
  const apply = (id: string) => applyAdjustment({ tenantId, actorId, adjustmentId: id });
  const rollback = (id: string) => rollbackAdjustment({ tenantId, actorId, adjustmentId: id, reason: "Synthetic restoration" });
  async function outcome(operation: Promise<unknown>) {
    return operation.then(value => ({ value, error: undefined }), error => ({ error, value: undefined }));
  }
  async function persisted() {
    return { zones: await cluster.observer.db.select().from(geoZones).orderBy(geoZones.id), adjustments: await cluster.observer.db.select().from(priceAdjustments).orderBy(priceAdjustments.id) };
  }
  async function fault(table: "geo_zones" | "price_adjustments", body: string) {
    await cluster.observer.sql.unsafe(`CREATE FUNCTION g3a2_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} END $$`);
    await cluster.observer.sql.unsafe(`CREATE TRIGGER g3a2_fault BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION g3a2_fault()`);
  }
  async function blocked(blocker: number, waiter: number, settled: () => boolean = () => false) {
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      const [row] = await cluster.observer.sql<{ pids: number[] }[]>`SELECT pg_blocking_pids(${waiter}) AS pids`;
      if (row.pids.includes(blocker) || settled()) return row.pids;
      await delay(10);
    }
    throw new Error("Proof could not establish a lock wait or completed operation; timeout is not evidence");
  }

  it.each([["foreign", foreign], ["NULL-owned", null]] as const)("rejects %s geo proposal without persistence or audit", async (_label, owner) => {
    const z = await zone(owner); const before = await persisted();
    const result = await outcome(proposeAdjustment({ tenantId, actorId, targetType: "geo_factor", geoZoneId: z.id, adjustmentPct: 5, reason: "Synthetic isolation proof", source: "manual" }));
    const after = await persisted();
    expect(after).toEqual(before); expect(result.error).toMatchObject({ code: "TARGET_NOT_FOUND" }); expect(boundary.audit).not.toHaveBeenCalled();
  });
  it("proposes, approves, applies and restores its own zone with persisted snapshot", async () => {
    const z = await zone();
    const { adjustment: proposed } = await proposeAdjustment({ tenantId, actorId, targetType: "geo_factor", geoZoneId: z.id, adjustmentPct: 5, reason: "Synthetic isolation proof", source: "manual" });
    expect(proposed.id).toBeTruthy(); expect(proposed.status).toBe("proposed");
    await approveAdjustment({ tenantId, actorId, adjustmentId: proposed.id });
    await apply(proposed.id);
    let state = await persisted(); expect(Number(state.zones[0].minProfitShieldPct)).toBe(44.1);
    expect(state.adjustments[0].rollbackSnapshot).toMatchObject({ targetType: "geo_factor", targetId: z.id, previousFactor: 42 });
    await rollback(proposed.id); state = await persisted();
    expect(Number(state.zones[0].minProfitShieldPct)).toBe(42); expect(state.adjustments[0].status).toBe("rolled_back");
    expect(boundary.audit.mock.calls.map(([entry]) => entry.action)).toEqual(["price_adjustment.proposed", "price_adjustment.approved", "price_adjustment.applied", "price_adjustment.rolled_back"]);
  });
  for (const operation of ["apply", "rollback"] as const) {
    it.each([["foreign", foreign], ["NULL-owned", null], ["missing", "missing"]] as const)(`${operation} rejects %s zone and preserves both rows`, async (_label, owner) => {
      const z = owner === "missing" ? { id: randomUUID() } : await zone(owner);
      const a = await adjustment(z.id, operation === "apply" ? "approved" : "applied"); const before = await persisted();
      const result = await outcome((operation === "apply" ? apply : rollback)(a.id));
      const after = await persisted();
      expect(after).toEqual(before); expect(result.error).toMatchObject({ code: "TARGET_NOT_FOUND" }); expect(boundary.audit).not.toHaveBeenCalled();
    });
    it.each([
      ["suppressed zone update", "geo_zones", "RETURN NULL;"],
      ["suppressed adjustment update", "price_adjustments", "RETURN NULL;"],
      ["zone factor changed", "geo_zones", "NEW.min_profit_shield_pct := 99; RETURN NEW;"],
      ["zone timestamp changed", "geo_zones", "NEW.updated_at := '2001-01-01'::timestamptz; RETURN NEW;"],
      ["status changed", "price_adjustments", "NEW.status := 'rejected'; RETURN NEW;"],
      ["actor changed", "price_adjustments", `NEW.updated_by := '${foreign}'::uuid; RETURN NEW;`],
      ["snapshot changed", "price_adjustments", `NEW.rollback_snapshot := '{"targetType":"geo_factor","previousFactor":99}'::jsonb; RETURN NEW;`],
      ["second write changes zone", "price_adjustments", "UPDATE geo_zones SET min_profit_shield_pct = 98 WHERE id = NEW.geo_zone_id; RETURN NEW;"],
    ] as const)(`${operation} aborts both writes when %s`, async (_label, table, body) => {
      const z = await zone(tenantId, operation === "apply" ? "42" : "44.1");
      const a = await adjustment(z.id, operation === "apply" ? "approved" : "applied"); const before = await persisted();
      await fault(table, body);
      const result = await outcome((operation === "apply" ? apply : rollback)(a.id));
      const after = await persisted();
      expect(after).toEqual(before);
      expect(result.error).toMatchObject({ code: operation === "apply" ? "ADJUSTMENT_VALIDATION_FAILED" : "ROLLBACK_INTEGRITY_FAILED" });
      expect(boundary.audit).not.toHaveBeenCalled();
    });
  }
  it("rolls back both writes on an actual SQL error", async () => {
    const z = await zone(); const a = await adjustment(z.id); const before = await persisted();
    await fault("price_adjustments", "RAISE EXCEPTION 'g3a2 synthetic SQL fault';");
    await expect(apply(a.id)).rejects.toMatchObject({ cause: { code: "P0001", message: "g3a2 synthetic SQL fault" } });
    expect(await persisted()).toEqual(before); expect(boundary.audit).not.toHaveBeenCalled();
  });
  it("rolls back both writes on failure before effective COMMIT", async () => {
    const z = await zone(); const a = await adjustment(z.id); const before = await persisted();
    boundary.db = instrument(cluster.first.db, { beforeCommit: async () => { throw new Error("g3a2 before commit"); } });
    await expect(apply(a.id)).rejects.toThrow("g3a2 before commit");
    expect(await persisted()).toEqual(before); expect(boundary.audit).not.toHaveBeenCalled();
  });
  it("accepts semantically identical JSONB with different key ordering", async () => {
    const z = await zone(); const a = await adjustment(z.id);
    await fault("price_adjustments", "SELECT jsonb_object_agg(key, value ORDER BY key DESC) INTO NEW.rollback_snapshot FROM jsonb_each(NEW.rollback_snapshot); RETURN NEW;");
    await apply(a.id); const state = await persisted();
    expect(state.adjustments[0].status).toBe("applied"); expect(Number(state.zones[0].minProfitShieldPct)).toBe(44.1);
    expect(state.adjustments[0].rollbackSnapshot).toMatchObject({ targetId: z.id, previousFactor: 42 });
  });

  for (const same of [true, false]) it(`serializes ${same ? "the same adjustment" : "different adjustments for one zone"} with real lock evidence`, async () => {
    const z = await zone(); const a = await adjustment(z.id); const b = same ? a : await adjustment(z.id);
    const held = gate(); const release = gate(); let paused = false;
    const db = instrument(cluster.first.db, { after: async q => {
      if (!paused && q.kind === "update" && q.table === "geo_zones") { paused = true; held.open(); await release.promise; }
    } });
    const first = current.run(db, () => apply(a.id));
    await held.promise;
    let done = false;
    const second = current.run(cluster.second.db, () => apply(b.id)).then(value => ({ value }), error => ({ error })).finally(() => { done = true; });
    let pids: number[];
    try { pids = await blocked(cluster.first.pid, cluster.second.pid, () => done); } finally { release.open(); }
    await first; const result = await second; const state = await persisted();
    expect(pids!).toContain(cluster.first.pid);
    expect(result).toMatchObject({ error: { code: same ? "INVALID_ADJUSTMENT_TRANSITION" : "DUPLICATE_LIVE_ADJUSTMENT" } });
    expect(Number(state.zones[0].minProfitShieldPct)).toBe(44.1);
    expect(state.adjustments.filter(row => row.status === "applied")).toHaveLength(1);
    expect(boundary.audit.mock.calls.filter(([entry]) => entry.action === "price_adjustment.applied")).toHaveLength(1);
  });

  it("captures the zone value after waiting for its row lock", async () => {
    const z = await zone(); const a = await adjustment(z.id); const held = gate(); const release = gate();
    const owner = cluster.first.sql.begin(async tx => { await tx.unsafe("UPDATE geo_zones SET min_profit_shield_pct = 50 WHERE id = $1", [z.id]); held.open(); await release.promise; });
    await held.promise; let done = false;
    const operation = current.run(cluster.second.db, () => apply(a.id)).finally(() => { done = true; });
    let pids: number[];
    try { pids = await blocked(cluster.first.pid, cluster.second.pid, () => done); } finally { release.open(); }
    await owner; await operation; expect(pids!).toContain(cluster.first.pid);
    const state = await persisted(); expect(Number(state.zones[0].minProfitShieldPct)).toBe(52.5);
    expect(state.adjustments[0].rollbackSnapshot).toMatchObject({ previousFactor: 50 });
  });

  it("rereads the rollback snapshot after waiting for the adjustment lock", async () => {
    const z = await zone(tenantId, "44.1"); const a = await adjustment(z.id, "applied"); const held = gate(); const release = gate();
    const owner = cluster.first.sql.begin(async tx => { await tx.unsafe("UPDATE price_adjustments SET rollback_snapshot = jsonb_set(rollback_snapshot, '{previousFactor}', '50') WHERE id = $1", [a.id]); held.open(); await release.promise; });
    await held.promise; let done = false;
    const operation = current.run(cluster.second.db, () => rollback(a.id)).finally(() => { done = true; });
    let pids: number[];
    try { pids = await blocked(cluster.first.pid, cluster.second.pid, () => done); } finally { release.open(); }
    await owner; await operation; expect(pids!).toContain(cluster.first.pid);
    const state = await persisted(); expect(Number(state.zones[0].minProfitShieldPct)).toBe(50);
    expect(state.adjustments[0].status).toBe("rolled_back");
  });

  it.each(["owner", "zone id"] as const)("rejects an adjustment whose %s changes before lock acquisition", async change => {
    const z = await zone(); const other = await zone(foreign); const a = await adjustment(z.id); const before = await persisted();
    const held = gate(); const release = gate();
    const owner = cluster.first.sql.begin(async tx => {
      if (change === "owner") await tx.unsafe("UPDATE price_adjustments SET tenant_id = $1 WHERE id = $2", [foreign, a.id]);
      else await tx.unsafe("UPDATE price_adjustments SET geo_zone_id = $1 WHERE id = $2", [other.id, a.id]);
      held.open(); await release.promise;
    });
    await held.promise; let done = false;
    const operation = current.run(cluster.second.db, () => apply(a.id)).then(value => ({ value }), error => ({ error })).finally(() => { done = true; });
    let pids: number[];
    try { pids = await blocked(cluster.first.pid, cluster.second.pid, () => done); } finally { release.open(); }
    await owner; const result = await operation; const state = await persisted();
    expect(pids!).toContain(cluster.first.pid);
    expect(result).toMatchObject({ error: { code: change === "owner" ? "ADJUSTMENT_NOT_FOUND" : "TARGET_NOT_FOUND" } });
    expect(state.zones).toEqual(before.zones); expect(state.adjustments[0].status).toBe("approved");
    expect(state.adjustments[0].rollbackSnapshot).toBeNull(); expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("rejects stale duration dispatch after the target changes to a foreign geo zone", async () => {
    const z = await zone(foreign); const a = await adjustment(z.id, "approved", { targetType: "duration_factor", trade: "carpentry", geoZoneId: null });
    const held = gate(); const release = gate(); let paused = false;
    const db = instrument(cluster.first.db, { after: async q => {
      if (!paused && !q.inTx && q.kind === "select" && q.table === "price_adjustments" && !q.sql.includes("count(")) { paused = true; held.open(); await release.promise; }
    } });
    const operation = current.run(db, () => apply(a.id)).then(value => ({ value }), error => ({ error }));
    await held.promise;
    await cluster.observer.sql`UPDATE price_adjustments SET target_type = 'geo_factor', geo_zone_id = ${z.id}, trade = NULL WHERE id = ${a.id}`;
    const before = await persisted(); release.open(); const result = await operation; const after = await persisted();
    expect(after).toEqual(before); expect(result).toMatchObject({ error: { code: "INVALID_ADJUSTMENT_TRANSITION" } }); expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("serializes rollback behind an in-flight apply and restores the committed snapshot", async () => {
    const z = await zone(); const a = await adjustment(z.id); const held = gate(); const release = gate(); let paused = false;
    const db = instrument(cluster.first.db, { after: async q => {
      if (!paused && q.inTx && q.kind === "update" && q.table === "price_adjustments") { paused = true; held.open(); await release.promise; }
    } });
    const first = current.run(db, () => apply(a.id)); await held.promise; let done = false;
    const second = current.run(cluster.second.db, () => rollback(a.id)).then(value => ({ value }), error => ({ error })).finally(() => { done = true; });
    let pids: number[];
    try { pids = await blocked(cluster.first.pid, cluster.second.pid, () => done); } finally { release.open(); }
    await first; const result = await second; const state = await persisted();
    expect(pids!).toContain(cluster.first.pid); expect(result).toHaveProperty("value");
    expect(Number(state.zones[0].minProfitShieldPct)).toBe(42); expect(state.adjustments[0].status).toBe("rolled_back");
  });
});
