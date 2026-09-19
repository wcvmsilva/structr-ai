/**
 * F5b caller regression controls (C01–C09).
 *
 * The routers, project-access guard, project create/update helpers, lead conversion,
 * and geo-context summary writer are REAL. Only the database transport, audit sink,
 * external geocoder, and assign/persist/refresh geo boundaries are substituted.
 * These controls prove caller contracts, not atomicity inside those geo helpers;
 * the companion F5b helper suites exercise that implementation directly.
 *
 * The driver models primary-key lookup and transactional commit visibility. It never
 * filters tenant ownership or permissions: the real access guard must reject the
 * foreign project and read-only member returned to it. This is not live SQL proof.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { GeocodeResult } from "./geo-geocoding";
import type { ZoneModifierSnapshot } from "@shared/geo-engine";

const TENANT = "a1000000-0000-4000-8000-000000000001";
const FOREIGN_TENANT = "a1000000-0000-4000-8000-000000000002";
const USER = "b1000000-0000-4000-8000-000000000001";
const OTHER_USER = "b1000000-0000-4000-8000-000000000002";
const PROJECT = "c1000000-0000-4000-8000-000000000001";
const ZONE = "d1000000-0000-4000-8000-000000000001";
const LEAD = "e1000000-0000-4000-8000-000000000001";
const CREATED_PROJECT = "f1000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;
type Write = { table: string; values: Row; inTransaction: boolean };
let committed: Store;
let pending: Store | null = null;
const writes: Write[] = [];
const reads: string[] = [];
const events: string[] = [];

function rowsFor(table: string): Row[] {
  const store = pending ?? committed;
  return store[table] ?? (store[table] = []);
}

/** Match only primary-key equality; tenant and permission decisions remain real. */
function primaryKeyMatches(row: Row, predicate?: SQL): boolean {
  if (!predicate) return true;
  const query = new PgDialect().sqlToQuery(predicate);
  const idEquality = /"[^"]+"\."id" = \$(\d+)/.exec(query.sql);
  return !idEquality || row.id === query.params[Number(idEquality[1]) - 1];
}

function selectRows(table: string, predicate?: SQL) {
  const result = () => structuredClone(rowsFor(table).filter(row => primaryKeyMatches(row, predicate)));
  return {
    where: (where: SQL) => selectRows(table, where),
    orderBy: () => selectRows(table, predicate),
    limit: async (count: number) => result().slice(0, count),
    then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
}

const driver = {
  select: () => ({
    from: (table: Table) => {
      const name = getTableName(table);
      reads.push(name);
      return selectRows(name);
    },
  }),
  insert: (table: Table) => ({
    values: (value: Row) => {
      const name = getTableName(table);
      const row = { id: CREATED_PROJECT, createdAt: new Date(), updatedAt: new Date(), ...structuredClone(value) };
      rowsFor(name).push(row);
      writes.push({ table: name, values: structuredClone(value), inTransaction: pending !== null });
      events.push(`insert:${name}`);
      return Object.assign(Promise.resolve([structuredClone(row)]), {
        returning: async () => [structuredClone(row)],
      });
    },
  }),
  update: (table: Table) => ({
    set: (value: Row) => ({
      where: async (predicate: SQL) => {
        const name = getTableName(table);
        const targets = rowsFor(name).filter(row => primaryKeyMatches(row, predicate));
        for (const row of targets) Object.assign(row, structuredClone(value));
        writes.push({ table: name, values: structuredClone(value), inTransaction: pending !== null });
        events.push(`update:${name}`);
        return structuredClone(targets);
      },
    }),
  }),
  transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
    if (pending) throw new Error("Unexpected nested transaction in caller fixture");
    pending = structuredClone(committed);
    events.push("transaction:begin");
    try {
      const result = await callback(driver);
      committed = pending;
      pending = null;
      events.push("transaction:commit");
      return result;
    } catch (error) {
      pending = null;
      events.push("transaction:rollback");
      throw error;
    }
  },
};

vi.mock("./db", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  getDb: vi.fn(async () => driver),
}));
vi.mock("./audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("./geo-geocoding", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  geocodeAddress: vi.fn(),
  reverseGeocode: vi.fn(),
}));
vi.mock("./geo-db", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  assignZoneToProject: vi.fn(),
}));
vi.mock("./geo-integration", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  persistGeocodeResult: vi.fn(),
  refreshProjectGeocode: vi.fn(),
}));

import { router } from "./_core/trpc";
import { geoRouter } from "./geo-router";
import { projectRouter } from "./project-router";
import { leadRouter } from "./lead-router";
import { LeadConversionError, resolveProjectGeoContext } from "./lead-conversion";
import { assignZoneToProject } from "./geo-db";
import { persistGeocodeResult, refreshProjectGeocode } from "./geo-integration";
import { geocodeAddress, reverseGeocode } from "./geo-geocoding";
import { getDb } from "./db";
import { logAudit } from "./audit";

const callerRouter = router({ geo: geoRouter, project: projectRouter, leads: leadRouter });
function caller(tenantId: string | null = TENANT) {
  return callerRouter.createCaller({
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => undefined },
    user: { id: USER, role: "user", name: "F5b operator", tenantId },
    tenantId,
    authProvider: "legacy",
  } as never);
}

function geocode(): GeocodeResult {
  return {
    success: true,
    latitude: 32.8,
    longitude: -79.8,
    formattedAddress: "412 Palmetto Street, Charleston, SC 29403",
    confidence: "high",
    source: "google_maps",
    locationType: "ROOFTOP",
    placeId: "fixture-palmetto",
    distanceFromCenter: 8.2,
    withinServiceRadius: true,
    warning: null,
    addressComponents: [{ longName: "Charleston", shortName: "Charleston", types: ["locality"] }],
  };
}

function snapshot(): ZoneModifierSnapshot {
  return {
    zoneId: ZONE,
    zoneName: "Island Site",
    laborModifier: 1.1,
    logisticsModifier: 1.22,
    materialModifier: 1.15,
    contingencyPct: 8,
    minProfitShieldPct: 50,
    coastalExposureLevel: "extreme",
    capturedAt: "2026-09-14T12:00:00.000Z",
  };
}

function refreshResult(persisted = true): Awaited<ReturnType<typeof refreshProjectGeocode>> {
  return { success: true, geocode: geocode(), zoneSnapshot: snapshot(), zoneDetection: null,
    warnings: ["Confirm island access with the client."], persisted };
}

function seedLead() {
  committed.projects = [];
  committed.leads = [{
    id: LEAD, tenantId: TENANT, name: "Sarah Whitfield", email: "sarah@example.com",
    phone: "8435550142", address: "412 Palmetto Street", city: "Charleston", state: "SC",
    zip: "29403", projectType: "remodel", serviceType: null, clientType: "homeowner",
    commercialChannel: "premium", sourceChannel: "referral", source: "referral",
    sourceDetail: null, nextStep: "schedule_previsit", ownerUserId: USER,
    status: "qualified", convertedClientId: null, convertedProjectId: null,
  }];
}

function expectNoGeoOrWrites() {
  expect(writes).toEqual([]);
  expect(assignZoneToProject).not.toHaveBeenCalled();
  expect(persistGeocodeResult).not.toHaveBeenCalled();
  expect(refreshProjectGeocode).not.toHaveBeenCalled();
  expect(geocodeAddress).not.toHaveBeenCalled();
  expect(reverseGeocode).not.toHaveBeenCalled();
  expect(logAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  pending = null;
  writes.length = reads.length = events.length = 0;
  committed = {
    projects: [{ id: PROJECT, tenantId: TENANT, ownerUserId: USER, name: "Original project",
      address: "412 Palmetto Street", city: "Charleston", state: "SC", zip: "29403",
      deletedAt: null, status: "intake", geoWarnings: [], geoRiskClass: null }],
    profiles: [{ id: USER, tenantId: TENANT, role: "user", isActive: true }],
    project_members: [], tenants: [{ id: TENANT }], clients: [], leads: [],
    intake_forms: [], lead_activities: [],
    geo_zones: [{ id: ZONE, tenantId: TENANT, name: "Island Site", zoneName: "Island Site",
      county: "Charleston", zipCodes: ["29403"], centerLat: "32.8", centerLng: "-79.8",
      radiusMiles: "15", coastalExposureLevel: "extreme", logisticsComplexity: "complex",
      laborModifier: "1.1", logisticsModifier: "1.22", materialModifier: "1.15",
      contingencyPct: "8", minProfitShieldPct: "50", isActive: true,
      description: null, costMultiplier: "1", validatedFloorPct: null, validatedAt: null,
      validationSampleCount: 0, createdAt: new Date(), updatedAt: new Date() }],
  };
  vi.mocked(assignZoneToProject).mockReset().mockResolvedValue(true);
  vi.mocked(persistGeocodeResult).mockReset().mockResolvedValue(true);
  vi.mocked(refreshProjectGeocode).mockReset().mockResolvedValue(refreshResult());
  vi.mocked(geocodeAddress).mockReset().mockResolvedValue(geocode());
});

describe("F5b caller contracts — controlled geo helper boundary, real callers", () => {
  it("C01a: geo.assignToProject returns the authorized zone snapshot on helper success", async () => {
    const result = await caller().geo.assignToProject({ projectId: PROJECT, zoneId: ZONE });
    expect(result).toMatchObject({ success: true, snapshot: {
      zoneId: ZONE, zoneName: "Island Site", coastalExposureLevel: "extreme",
      laborModifier: 1.1, logisticsModifier: 1.22, materialModifier: 1.15,
      contingencyPct: 8, minProfitShieldPct: 50,
    } });
    expect(assignZoneToProject).toHaveBeenCalledTimes(1);
    expect(assignZoneToProject).toHaveBeenCalledWith(PROJECT, result.snapshot, USER);
  });

  it("C01b: geo.assignToProject maps a false assignment to NOT_FOUND instead of success", async () => {
    vi.mocked(assignZoneToProject).mockResolvedValue(false);
    await expect(caller().geo.assignToProject({ projectId: PROJECT, zoneId: ZONE }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found" });
    expect(assignZoneToProject).toHaveBeenCalledTimes(1);
  });

  it("C02a: project.geocode returns geocode, zone, warnings and confirmed persistence", async () => {
    await expect(caller().project.geocode({ id: PROJECT })).resolves.toEqual({
      success: true, persisted: true,
      geocode: { latitude: 32.8, longitude: -79.8,
        formattedAddress: "412 Palmetto Street, Charleston, SC 29403",
        confidence: "high", source: "google_maps", distanceFromCenter: 8.2, withinServiceRadius: true },
      zone: { name: "Island Site", coastalExposure: "extreme" },
      warnings: ["Confirm island access with the client."],
    });
    expect(refreshProjectGeocode).toHaveBeenCalledTimes(1);
    expect(refreshProjectGeocode).toHaveBeenCalledWith(TENANT, PROJECT, USER);
  });

  it("C02b: project.geocode preserves persisted:false without claiming a durable result", async () => {
    vi.mocked(refreshProjectGeocode).mockResolvedValue(refreshResult(false));
    await expect(caller().project.geocode({ id: PROJECT })).resolves.toMatchObject({
      success: true, persisted: false, zone: { name: "Island Site", coastalExposure: "extreme" },
    });
    expect(writes).toEqual([]);
  });

  it("C02c: project.geocode surfaces thrown persistence failure instead of a success response", async () => {
    const failure = new Error("Geocode update rejected");
    vi.mocked(refreshProjectGeocode).mockRejectedValue(failure);
    await expect(caller().project.geocode({ id: PROJECT })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR", message: "Geocode update rejected", cause: failure,
    });
    expect(writes).toEqual([]);
  });

  it("C03: leads.refreshGeoContext maps a thrown helper error and never writes later warnings", async () => {
    vi.mocked(refreshProjectGeocode).mockRejectedValue(
      new LeadConversionError("DB_UNAVAILABLE", "Geo persistence store unavailable"),
    );
    await expect(caller().leads.refreshGeoContext({ projectId: PROJECT })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR", message: "Geo persistence store unavailable",
    });
    expect(refreshProjectGeocode).toHaveBeenCalledTimes(1);
    expect(refreshProjectGeocode).toHaveBeenCalledWith(TENANT, PROJECT, USER);
    expect(writes).toEqual([]);
    expect(committed.projects[0]).toMatchObject({ geoWarnings: [], geoRiskClass: null });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("C04 existing limit: persisted:false still writes the separate geo summary; this is not atomic context", async () => {
    vi.mocked(refreshProjectGeocode).mockResolvedValue(refreshResult(false));
    const summary = await resolveProjectGeoContext(TENANT, PROJECT, USER);
    expect(summary).toMatchObject({ zoneName: "Island Site", riskClass: "barrier_island",
      codes: ["geo.barrier_island_exposure", "geo.high_cost_multiplier"], reliable: true,
      zoneMinProfitShieldPct: 50 });
    expect(committed.projects[0]).toMatchObject({ geoRiskClass: "barrier_island", updatedBy: USER });
    expect((committed.projects[0].geoWarnings as Array<{ code: string }>).map(item => item.code))
      .toEqual(["geo.barrier_island_exposure", "geo.high_cost_multiplier"]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: "projects", inTransaction: false });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "project.geo_context_resolved", recordId: PROJECT,
    }));
  });

  it("C05: project.create preserves the real created project after post-create geo persistence fails", async () => {
    committed.projects = [];
    vi.mocked(persistGeocodeResult).mockRejectedValue(new Error("Geo snapshot rejected"));
    const created = await caller().project.create({ name: "Palmetto remodel", projectType: "remodel",
      address: "412 Palmetto Street", city: "Charleston", state: "SC", zip: "29403" });
    expect(created).toMatchObject({ id: CREATED_PROJECT, name: "Palmetto remodel", tenantId: TENANT,
      ownerUserId: USER, status: "intake", address: "412 Palmetto Street" });
    expect(committed.projects).toEqual([created]);
    expect(geocodeAddress).toHaveBeenCalledTimes(1);
    expect(geocodeAddress).toHaveBeenCalledWith({ address: "412 Palmetto Street",
      city: "Charleston", state: "SC", zipCode: "29403" });
    expect(persistGeocodeResult).toHaveBeenCalledWith(expect.objectContaining({ projectId: CREATED_PROJECT,
      userId: USER, geocode: expect.objectContaining({ latitude: 32.8, longitude: -79.8 }) }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "project.create", recordId: CREATED_PROJECT }));
  });

  it("C06: project.update keeps its principal mutation when address re-geocoding throws", async () => {
    vi.mocked(refreshProjectGeocode).mockRejectedValue(new Error("Geo snapshot rejected"));
    const updated = await caller().project.update({ id: PROJECT,
      data: { name: "Updated remodel", address: "500 Palmetto Street" } });
    expect(updated).toMatchObject({ id: PROJECT, name: "Updated remodel", address: "500 Palmetto Street" });
    expect(committed.projects[0]).toEqual(updated);
    expect(writes).toHaveLength(1);
    expect(refreshProjectGeocode).toHaveBeenCalledTimes(1);
    expect(refreshProjectGeocode).toHaveBeenCalledWith(TENANT, PROJECT, USER);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "project.update", recordId: PROJECT }));
  });

  it("C07: real lead conversion commits its linked records before geo failure and returns IDs with a warning", async () => {
    seedLead();
    let visibleAtGeo: Store | undefined;
    vi.mocked(refreshProjectGeocode).mockImplementation(async () => {
      events.push("geo:failure");
      visibleAtGeo = structuredClone(committed);
      throw new Error("Geo snapshot rejected");
    });
    const result = await caller().leads.convertToProject({ id: LEAD });
    expect(result).toMatchObject({ created: true, clientReused: false, geoContext: null });
    expect(result.clientId).toEqual(expect.any(String));
    expect(result.projectId).toEqual(expect.any(String));
    expect(result.intakeFormId).toEqual(expect.any(String));
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Geo snapshot rejected")]));
    expect(visibleAtGeo?.clients).toHaveLength(1);
    expect(visibleAtGeo?.projects).toHaveLength(1);
    expect(visibleAtGeo?.intake_forms).toHaveLength(1);
    expect(visibleAtGeo?.clients[0]).toMatchObject({ id: result.clientId, tenantId: TENANT });
    expect(visibleAtGeo?.projects[0]).toMatchObject({ id: result.projectId, clientId: result.clientId, tenantId: TENANT });
    expect(visibleAtGeo?.intake_forms[0]).toMatchObject({ id: result.intakeFormId, projectId: result.projectId });
    expect(visibleAtGeo?.leads[0]).toMatchObject({ status: "converted",
      convertedClientId: result.clientId, convertedProjectId: result.projectId });
    expect(committed).toEqual(visibleAtGeo);
    expect(events.indexOf("transaction:commit")).toBeLessThan(events.indexOf("geo:failure"));
    expect(events.filter(event => event === "transaction:commit")).toHaveLength(1);
    expect(writes).toHaveLength(5);
    expect(writes.every(write => write.inTransaction)).toBe(true);
    expect(refreshProjectGeocode).toHaveBeenCalledTimes(1);
    expect(refreshProjectGeocode).toHaveBeenCalledWith(TENANT, result.projectId, USER);
  });

  it("C08: resolveGeo:false completes real conversion without entering any geocoder boundary", async () => {
    seedLead();
    const result = await caller().leads.convertToProject({ id: LEAD, resolveGeo: false });
    expect(result).toMatchObject({ created: true, geoContext: null });
    expect(committed.leads[0]).toMatchObject({ status: "converted", convertedProjectId: result.projectId });
    expect(committed.projects).toHaveLength(1);
    expect(committed.projects[0]).toMatchObject({ id: result.projectId, clientId: result.clientId });
    expect(refreshProjectGeocode).not.toHaveBeenCalled();
    expect(persistGeocodeResult).not.toHaveBeenCalled();
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(reverseGeocode).not.toHaveBeenCalled();
    expect(writes.filter(write => "geoWarnings" in write.values)).toEqual([]);
  });
});

describe("F5b C09 — real tenant middleware and real project write guard", () => {
  const endpoints = [
    ["geo.assignToProject", (c: ReturnType<typeof caller>) => c.geo.assignToProject({ projectId: PROJECT, zoneId: ZONE })],
    ["project.geocode", (c: ReturnType<typeof caller>) => c.project.geocode({ id: PROJECT })],
    ["leads.refreshGeoContext", (c: ReturnType<typeof caller>) => c.leads.refreshGeoContext({ projectId: PROJECT })],
  ] as const;

  for (const [name, invoke] of endpoints) {
    it(`${name}: unresolved tenant rejects before database access or external geo work`, async () => {
      committed.profiles[0].tenantId = null;
      await expect(invoke(caller(null))).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getDb).not.toHaveBeenCalled();
      expect(reads).toEqual([]);
      expectNoGeoOrWrites();
    });

    it(`${name}: the real guard rejects a foreign project even when the caller owns it`, async () => {
      committed.projects[0].tenantId = FOREIGN_TENANT;
      const before = structuredClone(committed);
      await expect(invoke(caller())).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(reads).toEqual(["projects", "profiles"]);
      expect(committed).toEqual(before);
      expectNoGeoOrWrites();
    });

    it(`${name}: a read-only project member cannot write or trigger external geo work`, async () => {
      committed.projects[0].ownerUserId = OTHER_USER;
      committed.project_members = [{ projectId: PROJECT, userId: USER,
        projectRole: "viewer", permissions: ["read"], isActive: true }];
      const before = structuredClone(committed);
      await expect(invoke(caller())).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(reads).toEqual(["projects", "profiles", "project_members"]);
      expect(committed).toEqual(before);
      expectNoGeoOrWrites();
    });
  }
});
