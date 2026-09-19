/**
 * Actual operational entrypoint -> actual geo helper -> real private PostgreSQL.
 * Only configuration, the scoped import boundary, DB acquisition and audit sink
 * are substituted. No fake query results or production-source rewriting.
 *
 * Baseline-safe contrasts preload EVERY legacy name and SKU, so its incompatible
 * geo INSERT and unknown price INSERT schema cannot masquerade as security RED.
 * Exact-schema candidate cases complement those contrasts; their baseline schema
 * errors are compatibility failures, never tenant/atomicity evidence.
 */
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { geoZones, tenants, type GeoZone } from "../drizzle/schema";
import { startG3a3Postgres, type G3a3Connection, type G3a3Postgres } from "./test-support/g3a3-postgres";

const boundary = vi.hoisted(() => ({
  db: null as any, raw: null as any,
  audit: null as null | ((params: any) => Promise<unknown>),
  imports: [] as string[], unregisters: 0, closedAtUnregister: [] as boolean[],
  isClosed: (): boolean => false,
}));
vi.mock("./db", () => ({ getDb: async () => boundary.db, getRawClient: () => boundary.raw }));
vi.mock("./audit", () => ({ logAudit: (params: unknown) => {
  if (!boundary.audit) throw new Error("G3a3 audit boundary was not initialized");
  return boundary.audit(params);
} }));
vi.mock("dotenv", () => ({ default: { config: () => ({ parsed: {} }) } }));
vi.mock("postgres", () => ({ default: () => {
  if (!boundary.raw) throw new Error("G3a3 refuses any unowned PostgreSQL client");
  return boundary.raw;
} }));
vi.mock("tsx/esm/api", () => ({ register: () => {
  const unregister = async () => {
    boundary.unregisters++;
    boundary.closedAtUnregister.push(boundary.isClosed());
  };
  return Object.assign(unregister, { unregister, import: async (specifier: string, parent: string) => {
    const path = fileURLToPath(new URL(specifier, parent));
    boundary.imports.push(path);
    if (path === fileURLToPath(new URL("./db.ts", import.meta.url))) return import("./db");
    if (path === fileURLToPath(new URL("./geo-db.ts", import.meta.url))) return import("./geo-db");
    throw new Error(`G3a3 refuses unexpected scoped import: ${specifier}`);
  } });
} }));

const A = "a3000000-0000-4000-8000-000000000001";
const B = "a3000000-0000-4000-8000-000000000002";
const UNKNOWN = "a3000000-0000-4000-8000-000000000003";
const entryPath = fileURLToPath(new URL("../scripts/seed-geo-zones.mjs", import.meta.url));

// Hand-checked legacy expectations, independent of the current script/engine.
const expectedZones = [
  { name: "Barrier Island Premium", zoneName: "Barrier Island Premium", county: "Charleston",
    zipCodes: ["29455", "29439", "29482", "29451", "29438"], centerLat: 32.6083, centerLng: -79.9581,
    radiusMiles: 12, coastalExposureLevel: "extreme", logisticsComplexity: "extreme",
    laborModifier: 1.25, logisticsModifier: 1.4, materialModifier: 1.3, contingencyPct: 5, minProfitShieldPct: 50,
    description: "Barrier Island Premium — Charleston County. Coastal: extreme, Logistics: extreme. Includes Kiawah, Seabrook, Folly Beach, Isle of Palms, Sullivan's Island.", isActive: true },
  { name: "Charleston Coastal", zoneName: "Charleston Coastal", county: "Charleston",
    zipCodes: ["29412", "29422", "29492", "29464", "29403"], centerLat: 32.7546, centerLng: -79.9748,
    radiusMiles: 15, coastalExposureLevel: "high", logisticsComplexity: "complex",
    laborModifier: 1.15, logisticsModifier: 1.2, materialModifier: 1.15, contingencyPct: 3, minProfitShieldPct: 42,
    description: "Charleston Coastal — Charleston County. Coastal: high, Logistics: complex. Includes James Island, Mt. Pleasant, West Ashley coastal areas.", isActive: true },
  { name: "Charleston Metro", zoneName: "Charleston Metro", county: "Charleston",
    zipCodes: ["29407", "29414", "29418", "29405", "29406", "29409", "29401", "29403", "29464", "29466"], centerLat: 32.7765, centerLng: -79.9311,
    radiusMiles: 20, coastalExposureLevel: "moderate", logisticsComplexity: "standard",
    laborModifier: 1.05, logisticsModifier: 1, materialModifier: 1.05, contingencyPct: 0, minProfitShieldPct: 35,
    description: "Charleston Metro — Charleston County. Coastal: moderate, Logistics: standard. Default zone for Charleston area projects.", isActive: true },
  { name: "Summerville / Goose Creek", zoneName: "Summerville / Goose Creek", county: "Berkeley / Dorchester",
    zipCodes: ["29483", "29485", "29486", "29445", "29456", "29461", "29470", "29472"], centerLat: 33.0185, centerLng: -80.1756,
    radiusMiles: 18, coastalExposureLevel: "none", logisticsComplexity: "standard",
    laborModifier: 1, logisticsModifier: .95, materialModifier: 1, contingencyPct: 0, minProfitShieldPct: 32,
    description: "Summerville / Goose Creek — Berkeley/Dorchester County. Coastal: none, Logistics: standard. Inland suburban zone.", isActive: true },
  { name: "Outer Lowcountry", zoneName: "Outer Lowcountry", county: "Colleton / Dorchester",
    zipCodes: ["29488", "29474", "29477", "29479", "29481", "29440", "29426", "29431"], centerLat: 32.8954, centerLng: -80.3421,
    radiusMiles: 30, coastalExposureLevel: "low", logisticsComplexity: "moderate",
    laborModifier: 1.05, logisticsModifier: 1.05, materialModifier: 1, contingencyPct: 2, minProfitShieldPct: 35,
    description: "Outer Lowcountry — Colleton/Dorchester County. Coastal: low, Logistics: moderate. Rural and semi-rural areas.", isActive: true },
];
const legacySkus = ["EXT-SIDING-HARDI-CST", "EXT-WINDOW-IMPACT-CST", "EXT-DOOR-IMPACT-CST", "EXT-FLASH-COASTAL-CST",
  "ROOF-SHINGLE-WIND-CST", "ROOF-UNDERLAYMENT-CST", "FND-PILE-COASTAL-CST", "FND-CONCRETE-5000-CST",
  "FRM-HARDWARE-SS-CST", "ELEC-PANEL-COASTAL-CST", "PNT-EXTERIOR-MARINE-CST", "PLMB-PIPE-CPVC-CST"];

describe.skipIf(process.env.G3A3_POSTGRES !== "1")("G3a3 operational seed — owned disposable PostgreSQL", () => {
  let cluster: G3a3Postgres;
  let sequence = 0;
  let latest: G3a3Connection | undefined;
  let audits: Array<{ params: any; visible: GeoZone[] }> = [];

  beforeAll(async () => {
    const real = await vi.importActual<{ default: typeof postgres }>("postgres");
    cluster = await startG3a3Postgres(real.default);
  }, 60_000);
  afterAll(async () => {
    await cluster?.stop();
    if (cluster) expect(existsSync(cluster.directory)).toBe(false);
    vi.unstubAllEnvs();
  }, 20_000);
  beforeEach(async () => {
    if (!cluster) throw new Error("Enabled private PostgreSQL setup did not complete");
    await cluster.observer.sql.unsafe("DROP FUNCTION IF EXISTS g3a3_fault() CASCADE");
    await cluster.observer.sql.unsafe("TRUNCATE geo_zones, tenants, price_book_items");
    await cluster.observer.db.insert(tenants).values([
      { id: A, name: "Synthetic A", slug: "proof-a" }, { id: B, name: "Synthetic B", slug: "gchi" },
    ]);
    for (const sku of legacySkus) await cluster.observer.sql.unsafe("INSERT INTO price_book_items (sku) VALUES ($1)", [sku]);
    boundary.db = null; boundary.raw = null; boundary.imports = []; boundary.unregisters = 0;
    boundary.closedAtUnregister = []; boundary.isClosed = () => false;
    latest = undefined; audits = [];
    boundary.audit = async params => {
      audits.push({ params: structuredClone(params), visible: await rows() });
      return { id: "b3000000-0000-4000-8000-000000000001" };
    };
  });
  afterEach(async () => {
    if (latest && !latest.ended) await latest.sql.end({ timeout: 1 });
    boundary.raw = null; boundary.db = null; boundary.audit = null;
    vi.unstubAllEnvs();
  });

  async function rows() { return cluster.observer.db.select().from(geoZones).orderBy(geoZones.id); }
  async function fixtures(owner: string | null) {
    const created = await cluster.observer.db.insert(geoZones).values(expectedZones.map((zone, i) => ({
      name: `Existing fixture ${i}`, zoneName: zone.zoneName, tenantId: owner,
      description: `Preserve existing row ${i}`, zipCodes: ["99999"], laborModifier: "9.9", minProfitShieldPct: "88",
    }))).returning();
    return created.sort((a, b) => a.id.localeCompare(b.id));
  }
  async function invoke(owner = A) {
    vi.resetModules();
    const connection = await cluster.connect(`invocation-${++sequence}`);
    expect(connection.pid).not.toBe(cluster.observer.pid);
    latest = connection; boundary.db = connection.db; boundary.raw = connection.sql;
    boundary.isClosed = () => connection.ended;
    vi.stubEnv("DATABASE_URL", "postgres://g3a3-unusable.invalid/controlled-boundary-only");
    vi.stubEnv("SEED_TENANT_ID", owner);
    vi.stubEnv("DEV_TENANT_ID", B);
    const argv = process.argv; const exitCode = process.exitCode;
    process.argv = [process.execPath, entryPath]; process.exitCode = 0;
    let error: unknown;
    try {
      // A variable avoids inventing a declaration for the JS operational module.
      const entry = "../scripts/seed-geo-zones.mjs";
      await import(entry);
    } catch (caught) { error = caught; }
    const result = { error, exitCode: Number(process.exitCode ?? 0), connection };
    process.argv = argv; process.exitCode = exitCode;
    return result;
  }
  function success(result: Awaited<ReturnType<typeof invoke>>) {
    expect(result.error, "entrypoint must complete; schema/setup errors are not security evidence").toBeUndefined();
    expect(result.exitCode).toBe(0);
  }
  function refused(result: Awaited<ReturnType<typeof invoke>>) {
    expect(Boolean(result.error) || result.exitCode !== 0).toBe(true);
  }
  function noPriceQueries(connection: G3a3Connection) {
    expect(connection.queries.filter(query => /price_book_items/i.test(query.sql))).toEqual([]);
  }
  async function fault(body: string) {
    await cluster.observer.sql.unsafe(`CREATE FUNCTION g3a3_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} END $$`);
    await cluster.observer.sql.unsafe("CREATE TRIGGER g3a3_fault BEFORE INSERT ON geo_zones FOR EACH ROW EXECUTE FUNCTION g3a3_fault()");
  }
  function policy(row: GeoZone) {
    return { name: row.name, zoneName: row.zoneName, county: row.county, description: row.description, zipCodes: row.zipCodes,
      centerLat: row.centerLat, centerLng: row.centerLng, radiusMiles: Number(row.radiusMiles),
      coastalExposureLevel: row.coastalExposureLevel, logisticsComplexity: row.logisticsComplexity,
      laborModifier: Number(row.laborModifier), logisticsModifier: Number(row.logisticsModifier), materialModifier: Number(row.materialModifier),
      contingencyPct: Number(row.contingencyPct), minProfitShieldPct: Number(row.minProfitShieldPct), isActive: row.isActive };
  }

  it.each([["B", B], ["NULL", null]] as const)("contrast: A receives all five despite matching names under %s", async (_label, owner) => {
    const before = await fixtures(owner);
    const result = await invoke(); success(result);
    const after = await rows();
    expect(after.filter(row => row.tenantId !== A)).toEqual(before);
    expect(after.filter(row => row.tenantId === A)).toHaveLength(5);
  });

  it("contrast: successful own-name repeat performs zero pricebook queries", async () => {
    const before = await fixtures(A); const result = await invoke(); success(result);
    expect(await rows()).toEqual(before);
    noPriceQueries(result.connection);
  });

  it("control: existing own rows and sentinel SKUs remain unchanged on successful repeat", async () => {
    const before = await fixtures(A);
    const prices = await cluster.observer.sql.unsafe("SELECT * FROM price_book_items ORDER BY sku");
    const result = await invoke(); success(result);
    expect(await rows()).toEqual(before);
    expect(await cluster.observer.sql.unsafe("SELECT * FROM price_book_items ORDER BY sku")).toEqual(prices);
    expect(audits).toEqual([]);
    expect(result.connection.ended).toBe(true);
    expect(result.connection.endCalls).toBe(1);
  });

  it("contrast: nonexistent tenant is refused even with every name already present", async () => {
    const before = await fixtures(B); const result = await invoke(UNKNOWN);
    expect(await rows()).toEqual(before); expect(audits).toEqual([]);
    refused(result);
  });

  it("exact schema: persists all approved values, explicit ownership, name and text arrays", async () => {
    const result = await invoke(); success(result);
    const after = await rows(); expect(after).toHaveLength(5);
    for (const expected of expectedZones) {
      const row = after.find(row => row.zoneName === expected.zoneName)!;
      expect(policy(row)).toEqual(expected); expect(row.tenantId).toBe(A);
      expect(row.costMultiplier).toBe("1.0"); expect(row.createdAt).toBeInstanceOf(Date);
    }
    const typed = await cluster.observer.sql<{ kind: string }[]>`SELECT pg_typeof(zip_codes)::text AS kind FROM geo_zones`;
    expect(typed.map(row => row.kind)).toEqual(Array(5).fill("text[]"));
    noPriceQueries(result.connection);
  });

  it("exact schema: serial second invocation preserves IDs and emits no additional audits", async () => {
    success(await invoke()); const before = await rows(); expect(audits).toHaveLength(5);
    success(await invoke()); expect(await rows()).toEqual(before); expect(audits).toHaveLength(5);
  });

  it("exact schema: mixed own, foreign and NULL names create only missing own rows", async () => {
    await fixtures(B); await fixtures(null);
    const [own] = await cluster.observer.db.insert(geoZones).values({ tenantId: A, name: "Keep this name", zoneName: expectedZones[0].zoneName, description: "Do not overwrite" }).returning();
    const before = await rows(); success(await invoke()); const after = await rows();
    expect(after.filter(row => row.tenantId === A)).toHaveLength(5);
    expect(after.find(row => row.id === own.id)).toEqual(own);
    expect(after.filter(row => row.tenantId !== A)).toEqual(before.filter(row => row.tenantId !== A));
    expect(audits).toHaveLength(4);
  });

  it("exact schema: third INSERT SQL failure rolls back the complete batch and emits no audit", async () => {
    await fault("IF NEW.zone_name = 'Charleston Metro' THEN RAISE EXCEPTION 'G3A3_THIRD_INSERT_FAILURE'; END IF; RETURN NEW;");
    const before = await rows(); const result = await invoke(); refused(result);
    expect(result.connection.queries.filter(query => /^insert into "geo_zones"/i.test(query.sql))).toHaveLength(3);
    expect(await rows()).toEqual(before); expect(audits).toEqual([]);
    expect(result.connection.ended).toBe(true); expect(result.connection.endCalls).toBe(1);
  });

  it.each([["foreign", B], ["NULL", null]] as const)("exact schema: %s owner rewrite fails readback and rolls back every new row", async (_label, owner) => {
    await fault(`IF NEW.zone_name = 'Charleston Metro' THEN NEW.tenant_id := ${owner ? `'${owner}'::uuid` : "NULL"}; END IF; RETURN NEW;`);
    const before = await rows(); const result = await invoke(); refused(result);
    expect(result.connection.queries.filter(query => /^insert into "geo_zones"/i.test(query.sql))).toHaveLength(3);
    expect(await rows()).toEqual(before); expect(audits).toEqual([]);
  });

  it("exact schema: suppressed third INSERT produces failed readback and full rollback", async () => {
    await fault("IF NEW.zone_name = 'Charleston Metro' THEN RETURN NULL; END IF; RETURN NEW;");
    const result = await invoke(); refused(result);
    expect(result.connection.queries.filter(query => /^insert into "geo_zones"/i.test(query.sql))).toHaveLength(3);
    expect(await rows()).toEqual([]); expect(audits).toEqual([]);
  });

  it.each([["foreign", B], ["NULL", null]] as const)("exact schema: final INSERT's %s reassignment of an earlier row rolls back the full batch", async (_label, owner) => {
    await fault(`IF NEW.zone_name = 'Outer Lowcountry' THEN UPDATE geo_zones SET tenant_id = ${owner ? `'${owner}'::uuid` : "NULL"} WHERE zone_name = 'Barrier Island Premium' AND tenant_id = '${A}'::uuid; END IF; RETURN NEW;`);
    const result = await invoke(); refused(result);
    expect(result.connection.queries.filter(query => /^insert into "geo_zones"/i.test(query.sql))).toHaveLength(5);
    expect(await rows()).toEqual([]); expect(audits).toEqual([]);
  });

  it("exact schema: each audit observes the committed full batch and correct owned snapshot", async () => {
    const result = await invoke(); success(result); const persisted = await rows();
    expect(audits).toHaveLength(5);
    expect(new Set(audits.map(audit => audit.params.recordId)).size).toBe(5);
    for (const audit of audits) {
      expect(audit.visible).toEqual(persisted);
      expect(audit.params).toMatchObject({ action: "geo_zone.create", tableName: "geo_zones", userId: null });
      expect(audit.params.after).toEqual(persisted.find(row => row.id === audit.params.recordId));
      expect(audit.params.after.tenantId).toBe(A);
    }
    expect(result.connection.ended).toBe(true); expect(result.connection.endCalls).toBe(1);
    expect(boundary.unregisters).toBe(1); expect(boundary.closedAtUnregister).toEqual([true]);
  });

  it("exact schema: unconfirmed audit leaves committed zones and signals failure", async () => {
    boundary.audit = async params => { audits.push({ params: structuredClone(params), visible: await rows() }); return null; };
    const result = await invoke(); refused(result);
    expect(await rows()).toHaveLength(5); expect(audits).toHaveLength(5);
    expect(result.connection.ended).toBe(true); expect(boundary.closedAtUnregister).toEqual([true]);
  });

  it("exact schema: throwing audit cannot undo committed zones and still closes the client", async () => {
    boundary.audit = async () => { throw new Error("G3A3_AUDIT_SINK_FAILURE"); };
    const result = await invoke(); refused(result);
    expect(await rows()).toHaveLength(5); expect(result.connection.ended).toBe(true);
    expect(boundary.closedAtUnregister).toEqual([true]);
  });
});
