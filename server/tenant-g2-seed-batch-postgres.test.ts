/** Opt-in owned Unix-socket lab; no application DB configuration, external FKs or RLS. */
import { existsSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { geographicOverrides, type GeographicOverride } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { startG2PointPostgres, type G2PointConnection, type G2PointPostgres } from "./test-support/g2-1-postgres";

const boundary = vi.hoisted(() => ({ db: null as PostgresJsDatabase | null, audit: vi.fn() }));
const seed = vi.hoisted(() => ({
  rules: ["first", "reject-second"].map(reasonTemplate => ({
    zone: "Charleston Coastal", trade: "electrical", finishLevel: null,
    originalAssemblyId: "e2610000-0000-4000-8000-000000000001",
    replacementAssemblyId: "e2610000-0000-4000-8000-000000000002",
    overrideType: "swap", reasonTemplate, active: true,
  })),
}));
vi.mock("./db", () => ({ getDb: async () => boundary.db }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));
vi.mock("../shared/geo-override-seed", () => ({
  COASTAL_OVERRIDE_SEED_RULES: seed.rules, getSeedSummary: () => ({ totalRules: 2 }),
}));
vi.mock("dotenv", () => ({ default: { config: () => ({ parsed: {} }) } }));
vi.mock("postgres", () => ({ default: () => { throw new Error("Seed lab refuses unowned PostgreSQL"); } }));

const A = "a2610000-0000-4000-8000-000000000001";
const B = "a2610000-0000-4000-8000-000000000002";
const ACTOR = "b2610000-0000-4000-8000-000000000001";
const context: TrpcContext = {
  req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId: A,
  user: { id: ACTOR, role: "admin", tenantId: A } as NonNullable<TrpcContext["user"]>,
};

describe.skipIf(process.env.G2_1_POSTGRES !== "1")("coastal seed batch · owned disposable PostgreSQL", () => {
  let cluster: G2PointPostgres;
  let application: G2PointConnection;
  let caller: ReturnType<typeof import("./geo-override-router")["geoOverrideRouter"]["createCaller"]>;
  let auditedStates: GeographicOverride[][];
  const rows = () => cluster.observer.db.select().from(geographicOverrides).orderBy(geographicOverrides.id);

  beforeAll(async () => {
    const real = await vi.importActual<{ default: typeof postgres }>("postgres");
    cluster = await startG2PointPostgres(real.default);
    application = await cluster.connect("seed-batch");
    expect(application.pid).not.toBe(cluster.observer.pid);
    caller = (await import("./geo-override-router")).geoOverrideRouter.createCaller(context);
  }, 60_000);
  afterAll(async () => {
    boundary.db = null;
    await cluster?.stop();
    if (cluster) expect(existsSync(cluster.directory)).toBe(false);
  }, 20_000);
  beforeEach(async () => {
    await cluster.observer.sql.unsafe("ALTER TABLE geographic_overrides DROP CONSTRAINT IF EXISTS synthetic_seed_failure");
    await cluster.observer.sql.unsafe("TRUNCATE geographic_overrides");
    await cluster.observer.db.insert(geographicOverrides).values([
      { ...seed.rules[0], tenantId: B, reasonTemplate: "Foreign sentinel" },
      { ...seed.rules[0], tenantId: null, reasonTemplate: "NULL sentinel" },
    ]);
    boundary.db = application.db;
    application.queries.length = 0;
    auditedStates = [];
    boundary.audit.mockReset().mockImplementation(async () => { auditedStates.push(await rows()); return null; });
  });

  it("reaches a real second-insert constraint failure and leaves observer state unchanged", async () => {
    await cluster.observer.sql.unsafe("ALTER TABLE geographic_overrides ADD CONSTRAINT synthetic_seed_failure CHECK (reason_template <> 'reject-second')");
    const initial = await rows();
    const failure = await caller.seedCoastalRules().then(() => null, error => error);
    expect(failure).toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause: { cause: { code: "23514" } } });
    expect(application.queries.filter(query => /^insert into/i.test(query.sql))).toHaveLength(2);
    expect(application.queries.filter(query => /^begin\b/i.test(query.sql))).toHaveLength(1);
    expect(application.queries.some(query => /^rollback\b/i.test(query.sql))).toBe(true);
    expect(application.queries.some(query => /^commit\b/i.test(query.sql))).toBe(false);
    expect(await rows()).toEqual(initial);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("commits both verified rows together before every audit is visible through the observer", async () => {
    const initial = await rows();
    await expect(caller.seedCoastalRules()).resolves.toEqual({
      seeded: true, message: "Successfully seeded 2 coastal override rules.", summary: { totalRules: 2 },
    });
    const committed = await rows();
    expect(committed.filter(value => value.tenantId !== A)).toEqual(initial);
    expect(committed.filter(value => value.tenantId === A)).toHaveLength(2);
    expect(auditedStates).toEqual([committed, committed, committed]);
    expect(application.queries.filter(query => /^begin\b/i.test(query.sql))).toHaveLength(1);
    expect(application.queries.filter(query => /^commit\b/i.test(query.sql))).toHaveLength(1);
  });

  it("skips an inactive own rule without writing or auditing", async () => {
    await cluster.observer.db.insert(geographicOverrides).values({ ...seed.rules[0], tenantId: A, isActive: false });
    const initial = await rows();
    await expect(caller.seedCoastalRules()).resolves.toEqual({
      seeded: false, message: "1 override rules already exist. Clear existing rules before re-seeding.", summary: { totalRules: 2 },
    });
    expect(await rows()).toEqual(initial);
    expect(application.queries.some(query => /^insert into/i.test(query.sql))).toBe(false);
    expect(boundary.audit).not.toHaveBeenCalled();
  });
});
