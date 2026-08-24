/**
 * G3a-1 — geo_zones tenant policy isolation.
 *
 * Before G3a-1 the entire geo surface was tenant-blind: `server/geo-db.ts` contained not a
 * single reference to `tenantId`, `geo-router.ts` read `ctx.tenantId` nowhere, and the five
 * project/lead consumers reached zone policy through an unscoped `loadActiveZonesForEngine()`.
 * Any authenticated caller -- including one with NO resolved tenant -- could read, edit,
 * deactivate, seed and consume another tenant's commercial geo policy: labour, material and
 * logistics modifiers, contingency, and the Profit Shield floor. When a tenant had no matching
 * zone, four separate paths fell back to the built-in CHARLESTON_ZONES constant and handed out
 * GCHI's modifiers and 42-50% floors instead.
 *
 * These tests drive the REAL routers and the REAL server/geo-db.ts helpers through
 * `appRouter.createCaller`. Only the postgres driver is faked.
 *
 * ── WHAT THE FAKE PROVES, AND WHAT IT DOES NOT ───────────────────────────────
 * The suite has no live Postgres (`server/env.test.ts` -- DATABASE_URL is unset under vitest),
 * so the driver is faked. The fake is deliberately PERMISSIVE: it applies no tenant filtering
 * and returns whatever row the test configured. A cross-tenant read that still yields "not
 * found" therefore proves the CODE refused the row, not that the fake hid it. Writes are proven
 * by counters -- an unauthorized request must leave inserts/updates untouched. Where isolation
 * rests on the emitted predicate, the predicate is serialized with `PgDialect` and asserted to
 * bind the caller's tenant, with no `IS NULL` arm.
 *
 * ── STRICT, NOT TRANSITIONAL ────────────────────────────────────────────────
 * Geo scoping is stricter than the bundle/F15 shape. A NULL-owned zone is unknown provenance:
 * not platform-global, not GCHI, not the caller's. Tests asserting that NULL-owned policy is
 * unreachable are LOAD-BEARING G3a-1 proof, not F15 documentation -- strict NULL exclusion is
 * itself the invariant this unit establishes. (Contrast: in `tenant-b2-bundles.test.ts` the
 * NULL-row block documents behaviour G1 deliberately did NOT change, and is not proof.)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { geoZones, projects } from "../drizzle/schema";

const TENANT_A = "a1000000-0000-4000-8000-00000000000a";
const TENANT_B = "a1000000-0000-4000-8000-00000000000b";
const USER_A = "b1000000-0000-4000-8000-00000000000a";
const PROJECT_A = "c1000000-0000-4000-8000-000000000001";
const ZONE_OF_A = "d1000000-0000-4000-8000-0000000000a1";
const ZONE_OF_B = "d1000000-0000-4000-8000-0000000000b1";
const ZONE_NULL = "d1000000-0000-4000-8000-00000000000f";
const NEW_ID = "e1000000-0000-4000-8000-000000000001";

/** Tenant B's commercial policy. Nothing in this object may reach tenant A. */
const zoneRowOfB = {
  id: ZONE_OF_B,
  tenantId: TENANT_B,
  name: "Tenant B Barrier Island",
  zoneName: "Tenant B Barrier Island",
  description: "tenant B commercial policy",
  county: "Charleston",
  zipCodes: ["29455"],
  centerLat: 32.6083,
  centerLng: -79.9581,
  radiusMiles: "12",
  coastalExposureLevel: "extreme",
  logisticsComplexity: "extreme",
  laborModifier: "1.25",
  logisticsModifier: "1.40",
  materialModifier: "1.30",
  contingencyPct: "5.0",
  minProfitShieldPct: "50.0",
  costMultiplier: "1.0",
  validatedFloorPct: null,
  validatedAt: null,
  validationSampleCount: 0,
  isActive: true,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const zoneRowOfA = {
  ...zoneRowOfB,
  id: ZONE_OF_A,
  tenantId: TENANT_A,
  name: "Tenant A Metro",
  zoneName: "Tenant A Metro",
  minProfitShieldPct: "35.0",
};

/** Legacy row of unknown provenance. Not global, not GCHI, not anybody's policy. */
const zoneRowNullOwned = {
  ...zoneRowOfB,
  id: ZONE_NULL,
  tenantId: null,
  name: "Legacy Unowned Zone",
  zoneName: "Legacy Unowned Zone",
};

const projectRowOfA = { id: PROJECT_A, tenantId: TENANT_A, zone: null, zoneModifierSnapshot: null,
  address: "1 Main St", city: "Charleston", state: "SC", zip: "29455", county: "Charleston", deletedAt: null };

// ── Permissive fake driver ───────────────────────────────────────────────────

type Op = { table: string; where?: SQL; values?: unknown; set?: unknown };

const driver = {
  selects: [] as Op[],
  inserts: [] as Op[],
  updates: [] as Op[],
  deletes: [] as Op[],
  rows: { geo_zones: [] as unknown[], projects: [] as unknown[], other: [] as unknown[] },
  /**
   * Optional per-call response queue, consumed in order before falling back to `rows`.
   * Needed where one request issues several reads of the same table that must differ —
   * e.g. create() does a duplicate-name check and then reads the new row back.
   */
  queue: { geo_zones: [] as unknown[][], projects: [] as unknown[][] },
};

function reset() {
  driver.selects = []; driver.inserts = []; driver.updates = []; driver.deletes = [];
  driver.rows = { geo_zones: [], projects: [], other: [] };
  driver.queue = { geo_zones: [], projects: [] };
}

function tableName(t: unknown): string {
  if (t === geoZones) return "geo_zones";
  if (t === projects) return "projects";
  return "other";
}

function businessWrites() {
  return driver.inserts.length + driver.updates.length + driver.deletes.length;
}

/** Writes touching geo_zones specifically. */
function geoWrites() {
  return [...driver.inserts, ...driver.updates, ...driver.deletes].filter(o => o.table === "geo_zones").length;
}

function makeChain(op: "select" | "insert" | "update" | "delete", table: string) {
  const state: Op = { table };
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => { state.table = tableName(t); return chain; };
  chain.where = (c: SQL | undefined) => { state.where = c; return chain; };
  chain.set = (v: unknown) => { state.set = v; return chain; };
  chain.values = (v: unknown) => { state.values = v; return chain; };
  for (const m of ["returning", "limit", "offset", "orderBy", "onConflictDoUpdate", "onConflictDoNothing"]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (rows: unknown[]) => unknown) => {
    if (op === "select") {
      driver.selects.push({ ...state });
      const qk = state.table as keyof typeof driver.queue;
      const queued = driver.queue[qk];
      if (queued && queued.length > 0) return resolve(queued.shift() as unknown[]);
      const key = state.table as keyof typeof driver.rows;
      return resolve((driver.rows[key] ?? []) as unknown[]);
    }
    if (op === "insert") {
      driver.inserts.push({ ...state });
      const vals = state.values;
      const rows = Array.isArray(vals) ? vals : [vals];
      return resolve(rows.map((v, i) => ({ id: i === 0 ? NEW_ID : `${NEW_ID}-${i}`, ...(v as object) })));
    }
    if (op === "update") { driver.updates.push({ ...state }); return resolve([]); }
    driver.deletes.push({ ...state });
    return resolve([]);
  };
  return chain;
}

const fakeDb = {
  select: () => makeChain("select", "other"),
  insert: (t: unknown) => makeChain("insert", tableName(t)),
  update: (t: unknown) => makeChain("update", tableName(t)),
  delete: (t: unknown) => makeChain("delete", tableName(t)),
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
};

process.env.DATABASE_URL = "postgres://fake/g3a";

vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, drizzle: vi.fn(() => fakeDb) };
});
vi.mock("./audit", () => ({
  logAudit: vi.fn(async () => undefined),
  withAuditLog: vi.fn(async (_m: unknown, fn: () => unknown) => fn()),
}));

// The project half of these flows is already hardened (PHASE 1) and is not what this unit
// tests: it is allowed to pass so the ZONE check is the deciding factor.
vi.mock("./project-access", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireProjectAccessTrpc: vi.fn(async () => ({ projectId: PROJECT_A, role: "owner" })),
    requireEntityAccess: vi.fn(async () => undefined),
  };
});

// Geocoding is an external service and is NOT part of G3a-1. It is stubbed to succeed so the
// zone half of the pipeline is the only variable.
vi.mock("./geo-geocoding", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    geocodeAddress: vi.fn(async () => ({
      success: true, latitude: 32.6083, longitude: -79.9581, formattedAddress: "1 Main St",
      confidence: "high", source: "google_maps", locationType: "ROOFTOP", placeId: "x",
      distanceFromCenter: 5, withinServiceRadius: true, warning: null, addressComponents: null,
    })),
    reverseGeocode: vi.fn(async () => ({ success: true })),
  };
});

const { appRouter } = await import("./routers");
const { TENANT_UNRESOLVED_ERR_MSG } = await import("./_core/trpc");
const geoDb = await import("./geo-db");

function ctxFor(tenantId: string | null, role: "user" | "admin" = "user") {
  return {
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
    user: { id: USER_A, name: "Caller", role, tenantId },
    tenantId,
    authProvider: "legacy",
  } as never;
}

const callerA = () => appRouter.createCaller(ctxFor(TENANT_A));
const adminA = () => appRouter.createCaller(ctxFor(TENANT_A, "admin"));
const unresolved = () => appRouter.createCaller(ctxFor(null));
const unresolvedAdmin = () => appRouter.createCaller(ctxFor(null, "admin"));

function predicateSql(where: SQL | undefined): string {
  if (!where) return "";
  const q = new PgDialect().sqlToQuery(where);
  return `${q.sql} :: ${JSON.stringify(q.params)}`;
}

/** Every commercial-policy field that must never cross a tenant boundary. */
const POLICY_FIELDS = [
  "laborModifier", "materialModifier", "logisticsModifier", "logisticsComplexity",
  "contingencyPct", "minProfitShieldPct", "costMultiplier",
  "validatedFloorPct", "validatedAt", "validationSampleCount",
];

beforeEach(() => { reset(); });

// ═════════════════════════════════════════════════════════════════════════════
// 1. CALLER AXIS
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · an unresolved caller tenant grants zero geo policy access", () => {
  const invocations: Array<[string, (c: ReturnType<typeof unresolved>) => Promise<unknown>]> = [
    ["geo.list", c => c.geo.list({})],
    ["geo.getById", c => c.geo.getById({ id: ZONE_OF_A })],
    ["geo.getByName", c => c.geo.getByName({ name: "Tenant A Metro" })],
    ["geo.detectFromZip", c => c.geo.detectFromZip({ zipCode: "29455" })],
    ["geo.detectFromCoords", c => c.geo.detectFromCoords({ lat: 32.6, lng: -79.9 })],
    ["geo.assignToProject", c => c.geo.assignToProject({ projectId: PROJECT_A, zoneId: ZONE_OF_A })],
    ["geo.getProjectZone", c => c.geo.getProjectZone({ projectId: PROJECT_A })],
    ["geo.stats", c => c.geo.stats()],
    ["geo.charlestonZones", c => c.geo.charlestonZones()],
    ["geo.geocodeAddress", c => c.geo.geocodeAddress({ address: "1 Main St" })],
    ["geo.reverseGeocode", c => c.geo.reverseGeocode({ lat: 32.6, lng: -79.9 })],
    ["geo.geocodeAndDetectZone", c => c.geo.geocodeAndDetectZone({ address: "1 Main St" })],
    ["geo.checkServiceRadius", c => c.geo.checkServiceRadius({ lat: 32.6, lng: -79.9 })],
    ["project.geocode", c => c.project.geocode({ id: PROJECT_A })],
    ["leads.refreshGeoContext", c => c.leads.refreshGeoContext({ projectId: PROJECT_A })],
  ];

  for (const [name, invoke] of invocations) {
    it(`rejects ${name} and performs no business write`, async () => {
      driver.rows.geo_zones = [zoneRowOfA];
      driver.rows.projects = [projectRowOfA];
      await expect(invoke(unresolved())).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
      expect(businessWrites()).toBe(0);
    });
  }

  it("rejects the five admin geo mutations for an unresolved admin — role is not a tenant", async () => {
    driver.rows.geo_zones = [zoneRowOfA];
    const c = unresolvedAdmin();
    await expect(c.geo.create({ zoneName: "X", county: "Charleston" })).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    await expect(c.geo.update({ id: ZONE_OF_A, data: { laborModifier: 2 } })).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    await expect(c.geo.deactivate({ id: ZONE_OF_A })).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    await expect(c.geo.reactivate({ id: ZONE_OF_A })).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    await expect(c.geo.seedCharleston()).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    expect(businessWrites()).toBe(0);
  });

  it("performs no business read either — the boundary is before the helper", async () => {
    driver.rows.geo_zones = [zoneRowOfA];
    await expect(unresolved().geo.list({})).rejects.toThrow();
    expect(driver.selects).toHaveLength(0);
  });

  it("the data layer refuses an unresolved tenant even if a route forgets the boundary", async () => {
    await expect(geoDb.listGeoZones(null as never)).rejects.toThrow(/unresolved/i);
    await expect(geoDb.getGeoZoneById("" as never, ZONE_OF_A)).rejects.toThrow(/unresolved/i);
    await expect(geoDb.loadActiveZonesForEngine(undefined as never)).rejects.toThrow(/unresolved/i);
    expect(businessWrites()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. EXPLICIT ROW AXIS — tenant A vs tenant B
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · a resolved tenant cannot reach an explicitly foreign zone", () => {
  beforeEach(() => {
    // The fake hands back tenant B's row for every lookup. Anything that still fails,
    // failed because the code refused it.
    driver.rows.geo_zones = [zoneRowOfB];
    driver.rows.projects = [projectRowOfA];
  });

  it("geo.getById does not return it", async () => {
    await expect(callerA().geo.getById({ id: ZONE_OF_B })).rejects.toThrow(/not found/i);
  });

  it("geo.getByName does not return it", async () => {
    await expect(callerA().geo.getByName({ name: "Tenant B Barrier Island" })).rejects.toThrow(/not found/i);
  });

  it("geo.update cannot rewrite its commercial policy — zero geo writes", async () => {
    await expect(
      adminA().geo.update({ id: ZONE_OF_B, data: { minProfitShieldPct: 10 } }),
    ).rejects.toThrow(/not found/i);
    expect(geoWrites()).toBe(0);
  });

  it("geo.deactivate cannot disable it — zero geo writes", async () => {
    await expect(adminA().geo.deactivate({ id: ZONE_OF_B })).rejects.toThrow(/not found/i);
    expect(geoWrites()).toBe(0);
  });

  it("geo.reactivate cannot re-enable it — zero geo writes", async () => {
    await expect(adminA().geo.reactivate({ id: ZONE_OF_B })).rejects.toThrow(/not found/i);
    expect(geoWrites()).toBe(0);
  });

  it("a cross-tenant ADMIN is refused exactly like a plain user", async () => {
    await expect(adminA().geo.update({ id: ZONE_OF_B, data: { laborModifier: 3 } })).rejects.toThrow(/not found/i);
    await expect(adminA().geo.deactivate({ id: ZONE_OF_B })).rejects.toThrow(/not found/i);
    expect(businessWrites()).toBe(0);
  });

  it("detection never returns another tenant's modifiers", async () => {
    const zip = await callerA().geo.detectFromZip({ zipCode: "29455" });
    expect(zip.found).toBe(false);
    expect(zip.modifiers).toBeNull();
    const coords = await callerA().geo.detectFromCoords({ lat: 32.6083, lng: -79.9581 });
    expect(coords.found).toBe(false);
    expect(coords.modifiers).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. NULL-OWNED ROWS — LOAD-BEARING, because strict exclusion IS the G3a invariant
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · a NULL-owned zone is unknown provenance and is not tenant policy", () => {
  beforeEach(() => {
    driver.rows.geo_zones = [zoneRowNullOwned];
    driver.rows.projects = [projectRowOfA];
  });

  it("is NOT readable by a resolved tenant — it is not 'the current tenant's'", async () => {
    await expect(callerA().geo.getById({ id: ZONE_NULL })).rejects.toThrow(/not found/i);
  });

  it("is NOT treated as platform-global reference — detection ignores it", async () => {
    const detected = await callerA().geo.detectFromZip({ zipCode: "29455" });
    expect(detected.found).toBe(false);
    expect(detected.modifiers).toBeNull();
  });

  it("is NOT mutable by a resolved tenant — zero geo writes", async () => {
    await expect(adminA().geo.update({ id: ZONE_NULL, data: { laborModifier: 2 } })).rejects.toThrow(/not found/i);
    expect(geoWrites()).toBe(0);
  });

  it("assertGeoZoneTenant refuses a NULL row for every tenant — NULL is not GCHI", () => {
    expect(geoDb.assertGeoZoneTenant(null, TENANT_A)).toBe(false);
    expect(geoDb.assertGeoZoneTenant(null, TENANT_B)).toBe(false);
    expect(geoDb.assertGeoZoneTenant(undefined, TENANT_A)).toBe(false);
    expect(geoDb.assertGeoZoneTenant(TENANT_A, TENANT_A)).toBe(true);
  });

  it("the geo predicate carries NO transitional IS NULL arm (unlike the bundle domain)", async () => {
    await callerA().geo.list({});
    const select = driver.selects.find(s => s.table === "geo_zones");
    const sql = predicateSql(select!.where);
    expect(sql).toContain(TENANT_A);
    expect(sql.toLowerCase()).not.toContain("is null");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. LIST / STATS PREDICATES
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · list and stats are tenant-scoped", () => {
  it("list binds the caller tenant and never a foreign tenant", async () => {
    driver.rows.geo_zones = [zoneRowOfA];
    await callerA().geo.list({ includeInactive: false });
    const sql = predicateSql(driver.selects.find(s => s.table === "geo_zones")!.where);
    expect(sql).toContain(TENANT_A);
    expect(sql).not.toContain(TENANT_B);
    expect(sql).toContain("tenant_id");
  });

  it("list keeps the tenant predicate when includeInactive is set", async () => {
    driver.rows.geo_zones = [zoneRowOfA];
    await callerA().geo.list({ includeInactive: true });
    expect(predicateSql(driver.selects.find(s => s.table === "geo_zones")!.where)).toContain(TENANT_A);
  });

  it("stats no longer aggregates across tenants", async () => {
    driver.rows.geo_zones = [zoneRowOfA];
    await callerA().geo.stats();
    const sql = predicateSql(driver.selects.find(s => s.table === "geo_zones")!.where);
    expect(sql).toContain(TENANT_A);
    expect(sql).toContain("tenant_id");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. FINAL MUTATION PREDICATES (rule-F5)
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · every final geo write carries the tenant predicate", () => {
  beforeEach(() => { driver.rows.geo_zones = [zoneRowOfA]; });

  it("update's UPDATE ... WHERE binds tenant_id, not just the id", async () => {
    await adminA().geo.update({ id: ZONE_OF_A, data: { laborModifier: 1.1 } });
    const upd = driver.updates.find(u => u.table === "geo_zones");
    expect(upd).toBeDefined();
    const sql = predicateSql(upd!.where);
    expect(sql).toContain("tenant_id");
    expect(sql).toContain(TENANT_A);
  });

  it("deactivate's UPDATE ... WHERE binds tenant_id", async () => {
    await adminA().geo.deactivate({ id: ZONE_OF_A });
    const sql = predicateSql(driver.updates.find(u => u.table === "geo_zones")!.where);
    expect(sql).toContain("tenant_id");
    expect(sql).toContain(TENANT_A);
  });

  it("reactivate's UPDATE ... WHERE binds tenant_id", async () => {
    await adminA().geo.reactivate({ id: ZONE_OF_A });
    const sql = predicateSql(driver.updates.find(u => u.table === "geo_zones")!.where);
    expect(sql).toContain("tenant_id");
    expect(sql).toContain(TENANT_A);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. CREATE / SEED OWNERSHIP
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · created and seeded zones are owned by the caller's tenant", () => {
  it("create stamps ctx.tenantId", async () => {
    // 1st read = tenant-scoped duplicate check (none), 2nd read = scoped read-back.
    driver.queue.geo_zones = [[], [{ ...zoneRowOfA, id: NEW_ID, zoneName: "A Zone" }]];
    await adminA().geo.create({ zoneName: "A Zone", county: "Charleston" });
    const ins = driver.inserts.find(i => i.table === "geo_zones");
    expect(ins).toBeDefined();
    expect((ins!.values as { tenantId?: string }).tenantId).toBe(TENANT_A);
  });

  it("create never writes a NULL-owned zone", async () => {
    driver.queue.geo_zones = [[], [{ ...zoneRowOfA, id: NEW_ID, zoneName: "A Zone" }]];
    await adminA().geo.create({ zoneName: "A Zone", county: "Charleston" });
    const values = driver.inserts[0].values as { tenantId?: string | null };
    expect(values.tenantId).toBeTruthy();
  });

  it("create ignores a caller-supplied tenantId — ownership comes from context only", async () => {
    driver.queue.geo_zones = [[], [{ ...zoneRowOfA, id: NEW_ID, zoneName: "Injected" }]];
    await adminA().geo.create({ zoneName: "Injected", county: "Charleston", tenantId: TENANT_B } as never);
    expect((driver.inserts[0].values as { tenantId?: string }).tenantId).toBe(TENANT_A);
  });

  it("the duplicate-name check is tenant-scoped, so it cannot become an existence oracle", async () => {
    driver.queue.geo_zones = [[], [{ ...zoneRowOfA, id: NEW_ID, zoneName: "Shared Name" }]];
    await adminA().geo.create({ zoneName: "Shared Name", county: "Charleston" });
    const lookup = driver.selects.find(s => s.table === "geo_zones");
    const sql = predicateSql(lookup!.where);
    expect(sql).toContain(TENANT_A);
    expect(sql).toContain("tenant_id");
  });

  it("seedCharleston stamps the admin's own tenant on every created zone", async () => {
    // 5 zones x (dup-check, read-back). rows[] stays empty so dup checks find nothing.
    driver.queue.geo_zones = Array.from({ length: 5 }).flatMap(() => [
      [] as unknown[],
      [{ ...zoneRowOfA, id: NEW_ID }] as unknown[],
    ]);
    await adminA().geo.seedCharleston();
    const geoInserts = driver.inserts.filter(i => i.table === "geo_zones");
    expect(geoInserts.length).toBeGreaterThan(0);
    for (const ins of geoInserts) {
      expect((ins.values as { tenantId?: string }).tenantId).toBe(TENANT_A);
    }
  });

  it("seedCharleston's existence check is tenant-scoped — a foreign zone of the same name does not block it", async () => {
    // Tenant B owns every Charleston zone name. Tenant A must still get its own.
    driver.rows.geo_zones = [{ ...zoneRowOfB, zoneName: "Charleston Metro" }];
    await adminA().geo.seedCharleston();
    const geoInserts = driver.inserts.filter(i => i.table === "geo_zones");
    expect(geoInserts.length).toBeGreaterThan(0);
    for (const ins of geoInserts) {
      expect((ins.values as { tenantId?: string }).tenantId).toBe(TENANT_A);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. PROJECT / LEAD SNAPSHOT CONTAMINATION
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · no project snapshot can be populated from another tenant's policy", () => {
  beforeEach(() => {
    driver.rows.geo_zones = [zoneRowOfB];   // only tenant B has a zone
    driver.rows.projects = [projectRowOfA];
  });

  it("geo.assignToProject refuses a foreign zoneId — zero project writes", async () => {
    await expect(
      callerA().geo.assignToProject({ projectId: PROJECT_A, zoneId: ZONE_OF_B }),
    ).rejects.toThrow(/not found/i);
    expect(driver.updates.filter(u => u.table === "projects")).toHaveLength(0);
  });

  it("geo.assignToProject by ZIP no longer falls back to the built-in Charleston policy", async () => {
    await expect(
      callerA().geo.assignToProject({ projectId: PROJECT_A, zipCode: "29455" }),
    ).rejects.toThrow(/no zone found/i);
    expect(driver.updates.filter(u => u.table === "projects")).toHaveLength(0);
  });

  it("project.geocode writes no foreign zone into the snapshot", async () => {
    await callerA().project.geocode({ id: PROJECT_A });
    for (const upd of driver.updates.filter(u => u.table === "projects")) {
      const set = upd.set as Record<string, unknown>;
      expect(set.zone ?? null).toBeNull();
      expect(set.zoneModifierSnapshot ?? null).toBeNull();
    }
  });

  it("leads.refreshGeoContext writes no foreign zone into the snapshot", async () => {
    await callerA().leads.refreshGeoContext({ projectId: PROJECT_A });
    for (const upd of driver.updates.filter(u => u.table === "projects")) {
      const set = upd.set as Record<string, unknown>;
      expect(set.zone ?? null).toBeNull();
      expect(set.zoneModifierSnapshot ?? null).toBeNull();
    }
  });

  it("the zone read behind project geocoding binds the caller's tenant", async () => {
    await callerA().project.geocode({ id: PROJECT_A });
    const zoneSelect = driver.selects.find(s => s.table === "geo_zones");
    expect(zoneSelect).toBeDefined();
    const sql = predicateSql(zoneSelect!.where);
    expect(sql).toContain(TENANT_A);
    expect(sql).not.toContain(TENANT_B);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. CHARLESTON_ZONES COMMERCIAL FALLBACK REMOVED
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · GCHI commercial policy is no longer a global fallback", () => {
  beforeEach(() => {
    driver.rows.geo_zones = [];   // the caller tenant has NO configured policy
    driver.rows.projects = [projectRowOfA];
  });

  it("detectFromZip returns no zone instead of Charleston modifiers", async () => {
    const r = await callerA().geo.detectFromZip({ zipCode: "29455" });
    expect(r.found).toBe(false);
    expect(r.zone).toBeNull();
    expect(r.modifiers).toBeNull();
  });

  it("detectFromCoords returns no zone instead of Charleston modifiers", async () => {
    const r = await callerA().geo.detectFromCoords({ lat: 32.6083, lng: -79.9581 });
    expect(r.found).toBe(false);
    expect(r.modifiers).toBeNull();
  });

  it("geocodeAndDetectZone yields a null zone rather than a built-in profit floor", async () => {
    const r = await callerA().geo.geocodeAndDetectZone({ address: "1 Main St", zipCode: "29455" });
    expect(r.zone).toBeNull();
  });

  it("no barrier-island profit floor (50%) leaks through any detection path", async () => {
    const zip = await callerA().geo.detectFromZip({ zipCode: "29455" });
    const coords = await callerA().geo.detectFromCoords({ lat: 32.6083, lng: -79.9581 });
    const pipeline = await callerA().geo.geocodeAndDetectZone({ address: "1 Main St" });
    const blob = JSON.stringify({ zip, coords, pipeline });
    expect(blob).not.toContain("50");
    expect(blob).not.toContain("1.25");
    expect(blob).not.toContain("1.4");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. REFERENCE-ONLY PROJECTION (DECISION-1)
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · geo.charlestonZones is reference-only", () => {
  it("exposes no commercial tenant-policy field", async () => {
    const zones = await callerA().geo.charlestonZones();
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      for (const field of POLICY_FIELDS) {
        expect(z).not.toHaveProperty(field);
      }
      expect(z).not.toHaveProperty("modifiers");
    }
  });

  it("excludes the two fields that could not be cleanly classified as reference", async () => {
    const zones = await callerA().geo.charlestonZones();
    for (const z of zones) {
      expect(z).not.toHaveProperty("radiusMiles");
      expect(z).not.toHaveProperty("coastalExposureLevel");
    }
  });

  it("still returns genuine reference geography", async () => {
    const [z] = await callerA().geo.charlestonZones();
    expect(z.zoneName).toBeTruthy();
    expect(z.county).toBeTruthy();
    expect(Array.isArray(z.zipCodes)).toBe(true);
    expect(typeof z.centerLat).toBe("number");
  });

  it("no profit floor or modifier value appears anywhere in the response", async () => {
    const blob = JSON.stringify(await callerA().geo.charlestonZones());
    expect(blob).not.toContain("50");
    expect(blob).not.toContain("1.25");
    expect(blob).not.toContain("minProfitShield");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. NON-DISCLOSURE
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · foreign and nonexistent zones are indistinguishable", () => {
  async function errorFor(rows: unknown[], invoke: (c: ReturnType<typeof callerA>) => Promise<unknown>) {
    reset();
    driver.rows.geo_zones = rows as never[];
    driver.rows.projects = [projectRowOfA];
    return await invoke(adminA()).then(() => null).catch(e => e as { code?: unknown; message?: string });
  }

  const idRoutes: Array<[string, (c: ReturnType<typeof callerA>) => Promise<unknown>]> = [
    ["geo.getById", c => c.geo.getById({ id: ZONE_OF_B })],
    ["geo.update", c => c.geo.update({ id: ZONE_OF_B, data: { laborModifier: 2 } })],
    ["geo.deactivate", c => c.geo.deactivate({ id: ZONE_OF_B })],
    ["geo.reactivate", c => c.geo.reactivate({ id: ZONE_OF_B })],
    ["geo.assignToProject", c => c.geo.assignToProject({ projectId: PROJECT_A, zoneId: ZONE_OF_B })],
  ];

  for (const [name, invoke] of idRoutes) {
    it(`${name}: foreign id and nonexistent id produce the same code and message`, async () => {
      const foreign = await errorFor([zoneRowOfB], invoke);
      const missing = await errorFor([], invoke);
      expect(foreign).toBeTruthy();
      expect(missing).toBeTruthy();
      expect((foreign as { code?: unknown }).code).toBe((missing as { code?: unknown }).code);
      expect((foreign as { message?: string }).message).toBe((missing as { message?: string }).message);
    });
  }

  it("a NULL-owned id is also indistinguishable from a nonexistent one", async () => {
    const nullOwned = await errorFor([zoneRowNullOwned], c => c.geo.getById({ id: ZONE_NULL }));
    const missing = await errorFor([], c => c.geo.getById({ id: ZONE_NULL }));
    expect((nullOwned as { message?: string }).message).toBe((missing as { message?: string }).message);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. POSITIVE / REGRESSION CONTROLS — same-tenant behaviour is unchanged
// ═════════════════════════════════════════════════════════════════════════════

describe("G3a-1 · same-tenant geo operations still work", () => {
  beforeEach(() => {
    driver.rows.geo_zones = [zoneRowOfA];
    driver.rows.projects = [projectRowOfA];
  });

  it("getById returns the caller's own zone", async () => {
    const z = await callerA().geo.getById({ id: ZONE_OF_A });
    expect(z.id).toBe(ZONE_OF_A);
  });

  it("getByName returns the caller's own zone", async () => {
    const z = await callerA().geo.getByName({ name: "Tenant A Metro" });
    expect(z.tenantId).toBe(TENANT_A);
  });

  it("list returns rows", async () => {
    expect((await callerA().geo.list({})).length).toBe(1);
  });

  it("detectFromZip still matches the caller's own zone with its modifiers", async () => {
    const r = await callerA().geo.detectFromZip({ zipCode: "29455" });
    expect(r.found).toBe(true);
    expect(r.modifiers).not.toBeNull();
  });

  it("update still edits the caller's own zone", async () => {
    await adminA().geo.update({ id: ZONE_OF_A, data: { laborModifier: 1.05 } });
    expect(driver.updates.filter(u => u.table === "geo_zones")).toHaveLength(1);
  });

  it("deactivate and reactivate still work on the caller's own zone", async () => {
    await expect(adminA().geo.deactivate({ id: ZONE_OF_A })).resolves.toEqual({ success: true });
    reset();
    driver.rows.geo_zones = [zoneRowOfA];
    await expect(adminA().geo.reactivate({ id: ZONE_OF_A })).resolves.toEqual({ success: true });
  });

  it("assignToProject still assigns the caller's own zone", async () => {
    await expect(
      callerA().geo.assignToProject({ projectId: PROJECT_A, zoneId: ZONE_OF_A }),
    ).resolves.toMatchObject({ success: true });
    expect(driver.updates.filter(u => u.table === "projects")).toHaveLength(1);
  });

  it("stats still returns a shape", async () => {
    const s = await callerA().geo.stats();
    expect(s).toHaveProperty("totalZones");
  });

  it("reference geocoding remains available to a resolved tenant", async () => {
    const r = await callerA().geo.geocodeAddress({ address: "1 Main St" });
    expect(r.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. PRODUCT-BOUNDARY / DOCUMENTATION CONTROLS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * These record deliberate G3a-1 BOUNDARIES. They are not isolation proof and must never be
 * cited as such: each documents something this unit chose not to solve.
 */
describe("BOUNDARY (documentation, not G3a-1 proof) · deferred behaviour", () => {
  it("reactivate on a nonexistent zone now fails instead of reporting success", async () => {
    // Documents the rule-F2 defect G3a-1 repaired in passing: the old helper issued the
    // UPDATE with no existence check, returned true, and audited a row it never touched.
    driver.rows.geo_zones = [];
    await expect(adminA().geo.reactivate({ id: ZONE_OF_A })).rejects.toThrow(/not found/i);
    expect(geoWrites()).toBe(0);
  });

  it("checkServiceRadius still answers from the hard-coded GCHI operating centre — DEFERRED to G3b", async () => {
    // DECISION-3 is NOT solved by G3a-1. The service radius remains GCHI operating policy in
    // server/geo-geocoding.ts, which is outside this unit's approved file set. G3a-1 only
    // gates the route behind a resolved tenant; it does not make the radius tenant-specific,
    // and no reference-axis isolation is claimed.
    const r = await callerA().geo.checkServiceRadius({ lat: 32.7765, lng: -79.9311 });
    expect(r).toHaveProperty("withinRadius");
    expect(r).toHaveProperty("distanceMiles");
  });

  it("historical project snapshots are left untouched by this unit", async () => {
    // A project that already carries a snapshot keeps it; G3a-1 prevents NEW cross-tenant
    // snapshots and performs no historical cleanup.
    driver.rows.geo_zones = [];
    driver.rows.projects = [{ ...projectRowOfA, zone: "Legacy Zone", zoneModifierSnapshot: { zoneName: "Legacy Zone" } }];
    const snap = await callerA().geo.getProjectZone({ projectId: PROJECT_A });
    expect(snap.snapshot).not.toBeNull();
  });
});
