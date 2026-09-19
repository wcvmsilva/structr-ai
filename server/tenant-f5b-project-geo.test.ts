/**
 * F5b pilot: the real project geo helpers must commit their locked before-read,
 * update and verified readback together, then write their existing audit events.
 * Only getDb and logAudit are replaced; no database or geocoding service is used.
 *
 * The database double models statement ownership, staging and commit/rollback.
 * Each handle has its own closures: a pooled-db statement inside a transaction
 * remains a pooled-db statement and cannot be mistaken for a transaction write.
 * Readback `matches` is an explicitly supplied database result, not a SQL evaluator;
 * PostgreSQL comparison/serialization semantics belong to the integration suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { projects, type Project } from "../drizzle/schema";
import type { ZoneModifierSnapshot } from "../shared/geo-engine";
import type { AuditLogParams } from "./audit";
import type { GeocodeResult } from "./geo-geocoding";
import { getDb } from "./db";
import { logAudit } from "./audit";
import { assignZoneToProject } from "./geo-db";
import { persistGeocodeResult } from "./geo-integration";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./audit", () => ({ logAudit: vi.fn() }));

const PROJECT_ID = "f5000000-0000-4000-8000-000000000001";
const USER_ID = "f5000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-14T16:30:00.000Z");
const OLD_SNAPSHOT: ZoneModifierSnapshot = {
  zoneId: "f5000000-0000-4000-8000-000000000003",
  zoneName: "Existing Metro",
  laborModifier: 1.05,
  logisticsModifier: 1.02,
  materialModifier: 1.03,
  contingencyPct: 3,
  minProfitShieldPct: 35,
  coastalExposureLevel: "low",
  capturedAt: "2026-09-01T12:00:00.000Z",
};
const NEW_SNAPSHOT: ZoneModifierSnapshot = {
  zoneId: "f5000000-0000-4000-8000-000000000004",
  zoneName: "New Coastal",
  laborModifier: 1.17,
  logisticsModifier: 1.09,
  materialModifier: 1.08,
  contingencyPct: 4,
  minProfitShieldPct: 42,
  coastalExposureLevel: "high",
  capturedAt: "2026-09-14T16:20:00.000Z",
};
const GEOCODE: GeocodeResult = {
  success: true,
  latitude: 32.7765,
  longitude: -79.9311,
  formattedAddress: "101 Test Street, Charleston, SC 29401",
  confidence: "high",
  source: "google_maps",
  locationType: "ROOFTOP",
  placeId: "test-place-id",
  distanceFromCenter: 1.5,
  withinServiceRadius: true,
  warning: null,
  addressComponents: [
    { longName: "Charleston", shortName: "Charleston", types: ["locality"] },
  ],
};

function projectRow(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    tenantId: "f5000000-0000-4000-8000-000000000005",
    name: "F5b project fixture",
    clientId: null,
    ownerUserId: USER_ID,
    clientName: null,
    clientEmail: null,
    address: "101 Test Street",
    city: "Charleston",
    state: "SC",
    zip: "29401",
    projectType: "remodel",
    channel: "premium",
    status: "estimate",
    leadId: null,
    jobtreadId: null,
    estimatedTotal: "45000.00",
    actualTotal: null,
    variancePct: null,
    startDate: null,
    endDate: null,
    notes: "Unrelated project fields must survive geo persistence",
    county: "Charleston",
    zone: "Existing Metro",
    region: "Charleston",
    finishLevel: "standard",
    pricingSchemaVersion: null,
    zoneModifierSnapshot: structuredClone(OLD_SNAPSHOT),
    geocodeConfidence: "low",
    geocodeSource: "zip_centroid",
    geocodedAddress: "Old geocoded address",
    geocodedAt: new Date("2026-09-01T10:00:00.000Z"),
    clientType: null,
    commercialChannel: null,
    sourceChannel: null,
    addressNormalized: "101 test street charleston sc 29401",
    latitude: "32.7000",
    longitude: "-79.9000",
    geoWarnings: ["Existing warning"],
    geoRiskClass: "existing-risk",
    updatedBy: null,
    varianceThresholdPct: "10",
    committedCostCents: 100000,
    approvedBudgetCents: null,
    changeOrderBudgetCents: 0,
    fieldStartedAt: null,
    fieldCompletedAt: null,
    closedAt: null,
    calibratedAt: null,
    scopeCompletenessScore: null,
    realizedGrossProfitPct: null,
    deletedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

type FailureOptions = {
  initialReadError?: Error;
  updateError?: Error;
  readbackError?: Error;
  readbackEmpty?: boolean;
  readbackMismatch?: boolean;
  commitError?: Error;
};
type Statement = {
  kind: "initial-read" | "update" | "readback";
  handle: Handle;
  table?: unknown;
  predicate?: SQL;
  selection?: Record<string, unknown>;
  limit?: number;
  lock?: string;
  payload?: Record<string, unknown>;
};
type Query = PromiseLike<unknown[]> & {
  from(table: unknown): Query;
  where(predicate: SQL): Query;
  limit(count: number): Query;
  for(strength: string): Query;
  set(payload: Record<string, unknown>): Query;
};
type Handle = {
  select(selection?: Record<string, unknown>): Query;
  update(table: unknown): Query;
  transaction<T>(fn: (tx: Handle) => Promise<T>): Promise<T>;
};
type View = { row: Project | null; writes: Statement[] };

function database(initial: Project | null = projectRow(), failures: FailureOptions = {}) {
  const committed: View = { row: structuredClone(initial), writes: [] };
  const statements: Statement[] = [];
  const timeline: string[] = [];
  const txHandles: Handle[] = [];
  const audits: Array<{
    payload: AuditLogParams;
    committedRow: Project | null;
    commitsSeen: number;
  }> = [];
  let selectCount = 0;
  let commits = 0;
  let rollbacks = 0;

  function makeHandle(view: View, isRoot: boolean): Handle {
    function query(kind: "select" | "update", selection?: Record<string, unknown>, table?: unknown): Query {
      const statement: Statement = { kind: "update", handle, selection, table };
      let execution: Promise<unknown[]> | undefined;
      const chain: Query = {
        from(value) { statement.table = value; return chain; },
        where(value) { statement.predicate = value; return chain; },
        limit(value) { statement.limit = value; return chain; },
        for(value) { statement.lock = value; return chain; },
        set(value) { statement.payload = structuredClone(value); return chain; },
        then(onFulfilled, onRejected) {
          execution ??= Promise.resolve().then(() => {
            statement.kind = kind === "update" ? "update" : selectCount++ === 0 ? "initial-read" : "readback";
            statements.push(statement);
            timeline.push(`${isRoot ? "root" : "tx"}:${statement.kind}`);
            if (statement.kind === "initial-read" && failures.initialReadError) throw failures.initialReadError;
            if (statement.kind === "readback" && failures.readbackError) throw failures.readbackError;
            if (kind === "update") {
              if (failures.updateError) throw failures.updateError;
              if (view.row) {
                view.row = { ...view.row, ...structuredClone(statement.payload) };
                view.writes.push(statement);
              }
              return [];
            }
            if (!view.row || (statement.kind === "readback" && failures.readbackEmpty)) return [];
            if (selection && "matches" in selection) {
              return [{ id: view.row.id, matches: !failures.readbackMismatch }];
            }
            return [structuredClone(view.row)];
          });
          return execution.then(onFulfilled, onRejected);
        },
      };
      return chain;
    }

    const handle: Handle = {
      select: selection => query("select", selection),
      update: table => query("update", undefined, table),
      async transaction(fn) {
        timeline.push("begin");
        const staged: View = { row: structuredClone(view.row), writes: [] };
        const tx = makeHandle(staged, false);
        txHandles.push(tx);
        try {
          const result = await fn(tx);
          // This failure models a server-rejected COMMIT known to have rolled back,
          // not an ambiguous lost connection whose commit outcome cannot be known.
          if (failures.commitError) throw failures.commitError;
          view.row = staged.row;
          view.writes.push(...staged.writes);
          commits += 1;
          timeline.push("commit");
          return result;
        } catch (error) {
          rollbacks += 1;
          timeline.push("rollback");
          throw error;
        }
      },
    };
    return handle;
  }

  const root = makeHandle(committed, true);
  return {
    root, committed, statements, timeline, txHandles, audits,
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
    recordAudit(payload: AuditLogParams) {
      timeline.push(`audit:${payload.action}`);
      audits.push({ payload: structuredClone(payload), committedRow: structuredClone(committed.row), commitsSeen: commits });
    },
  };
}

type Database = ReturnType<typeof database>;
function connect(db: Database, auditReturnsNull = false) {
  // The external connection seam is the only place the narrow fake needs a cast.
  vi.mocked(getDb).mockResolvedValue(db.root as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
  vi.mocked(logAudit).mockImplementation(async payload => {
    db.recordAudit(payload);
    if (auditReturnsNull) return null;
    return {
      id: "f5000000-0000-4000-8000-000000000006",
      userId: payload.userId ?? null,
      action: payload.action,
      tableName: payload.tableName,
      recordId: payload.recordId ?? null,
      oldValues: payload.before ?? null,
      newValues: payload.after ?? null,
      ipAddress: null,
      userAgent: null,
      createdAt: NOW,
    };
  });
}

const helperCases = [
  {
    name: "assignZoneToProject",
    run: () => assignZoneToProject(PROJECT_ID, structuredClone(NEW_SNAPSHOT), USER_ID),
    expectedPayload: { zone: "New Coastal", zoneModifierSnapshot: NEW_SNAPSHOT },
    expectedAudit: {
      userId: USER_ID,
      action: "project.assign_zone",
      tableName: "projects",
      recordId: PROJECT_ID,
      before: { zone: "Existing Metro", zoneModifierSnapshot: OLD_SNAPSHOT },
      after: { zone: "New Coastal", zoneModifierSnapshot: NEW_SNAPSHOT },
    },
  },
  {
    name: "persistGeocodeResult",
    run: () => persistGeocodeResult({ projectId: PROJECT_ID, geocode: structuredClone(GEOCODE), userId: USER_ID, zoneSnapshot: structuredClone(NEW_SNAPSHOT) }),
    expectedPayload: {
      latitude: "32.7765", longitude: "-79.9311", geocodeConfidence: "high",
      geocodeSource: "google_maps", geocodedAddress: "101 Test Street, Charleston, SC 29401",
      geocodedAt: NOW, updatedBy: USER_ID, zone: "New Coastal", zoneModifierSnapshot: NEW_SNAPSHOT,
    },
    expectedAudit: {
      userId: USER_ID,
      action: "project.geocode_resolved",
      tableName: "projects",
      recordId: PROJECT_ID,
      before: { latitude: "32.7000", longitude: "-79.9000", geocodeConfidence: "low", zone: "Existing Metro" },
      after: { latitude: 32.7765, longitude: -79.9311, geocodeConfidence: "high", geocodedAddress: "101 Test Street, Charleston, SC 29401", zone: "New Coastal" },
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe.each(helperCases)("F5b $name", helper => {
  it("H01 returns false without a database and emits no writes or audit", async () => {
    const db = database();
    connect(db);
    vi.mocked(getDb).mockResolvedValue(null);
    expect(await helper.run()).toBe(false);
    expect(db.statements).toEqual([]);
    expect(db.txHandles).toHaveLength(0);
    expect(db.audits).toEqual([]);
  });

  it("H02 returns false for a missing initial project without updating or auditing", async () => {
    const db = database(null);
    connect(db);
    expect(await helper.run()).toBe(false);
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read"]);
    expect(db.committed.writes).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("H03 uses one transaction handle for the locked before-read, update and verified readback", async () => {
    const db = database();
    connect(db);
    expect(await helper.run()).toBe(true);
    expect(db.txHandles).toHaveLength(1);
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read", "update", "readback"]);
    for (const statement of db.statements) {
      expect(statement.handle).toBe(db.txHandles[0]);
      expect(statement.handle).not.toBe(db.root);
      expect(statement.table).toBe(projects);
      expect(statement.predicate).toBeInstanceOf(SQL);
      const predicate = new PgDialect().sqlToQuery(statement.predicate!);
      expect(predicate.params).toEqual([PROJECT_ID]);
      expect(predicate.sql).toBe('"projects"."id" = $1');
    }
    expect(db.statements[0].lock).toBe("update");
    expect(db.statements[0].limit).toBe(1);
    expect(db.statements[2].selection?.id).toBe(projects.id);
    expect(db.statements[2].selection?.matches).toBeInstanceOf(SQL);
    expect(db.commits).toBe(1);
    expect(db.rollbacks).toBe(0);
  });

  it("H04 returns true with the intended fields durable before the original audit is emitted", async () => {
    const before = projectRow();
    const db = database(before);
    connect(db);
    expect(await helper.run()).toBe(true);
    expect(db.committed.row).toEqual({ ...before, ...helper.expectedPayload });
    expect(db.committed.writes).toHaveLength(1);
    expect(db.committed.writes[0].payload).toEqual(helper.expectedPayload);
    expect(db.audits[0]?.payload).toEqual(helper.expectedAudit);
    expect(db.audits.length).toBeGreaterThan(0);
    for (const audit of db.audits) {
      expect(audit.commitsSeen).toBe(1);
      expect(audit.committedRow).toEqual({ ...before, ...helper.expectedPayload });
    }
    expect(db.timeline.indexOf("commit")).toBeLessThan(db.timeline.findIndex(event => event.startsWith("audit:")));
  });

  it("H05 propagates an initial read error without changing the project or emitting audit", async () => {
    const error = new Error("injected initial read failure");
    const before = projectRow();
    const db = database(before, { initialReadError: error });
    connect(db);
    await expect(helper.run()).rejects.toBe(error);
    expect(db.committed.row).toEqual(before);
    expect(db.committed.writes).toEqual([]);
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read"]);
    expect(db.audits).toEqual([]);
  });

  it("H06 propagates an update error without durable changes or audit", async () => {
    const error = new Error("injected update failure");
    const before = projectRow();
    const db = database(before, { updateError: error });
    connect(db);
    await expect(helper.run()).rejects.toBe(error);
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read", "update"]);
    expect(db.committed.row).toEqual(before);
    expect(db.committed.writes).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("H07 rolls back an attempted update when the readback throws and emits no audit", async () => {
    const error = new Error("injected readback failure");
    const before = projectRow();
    const db = database(before, { readbackError: error });
    connect(db);
    await expect(helper.run()).rejects.toBe(error);
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read", "update", "readback"]);
    expect(db.committed.row).toEqual(before);
    expect(db.committed.writes).toEqual([]);
    expect(db.rollbacks).toBe(1);
    expect(db.commits).toBe(0);
    expect(db.audits).toEqual([]);
  });

  it("H08 rejects an empty readback and rolls back the attempted update without audit", async () => {
    const before = projectRow();
    const db = database(before, { readbackEmpty: true });
    connect(db);
    await expect(helper.run()).rejects.toThrow();
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read", "update", "readback"]);
    expect(db.committed.row).toEqual(before);
    expect(db.committed.writes).toEqual([]);
    expect(db.rollbacks).toBe(1);
    expect(db.audits).toEqual([]);
  });

  it("H09 rejects matches=false from the readback and rolls back without audit", async () => {
    const before = projectRow();
    const db = database(before, { readbackMismatch: true });
    connect(db);
    await expect(helper.run()).rejects.toThrow();
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read", "update", "readback"]);
    expect(db.committed.row).toEqual(before);
    expect(db.committed.writes).toEqual([]);
    expect(db.rollbacks).toBe(1);
    expect(db.audits).toEqual([]);
  });

  it("H10 propagates an explicit COMMIT rejection known rolled back and emits no audit", async () => {
    const error = new Error("injected server COMMIT rejection; transaction rolled back");
    const before = projectRow();
    const db = database(before, { commitError: error });
    connect(db);
    await expect(helper.run()).rejects.toBe(error);
    expect(db.statements.map(statement => statement.kind)).toEqual(["initial-read", "update", "readback"]);
    expect(db.committed.row).toEqual(before);
    expect(db.committed.writes).toEqual([]);
    expect(db.rollbacks).toBe(1);
    expect(db.commits).toBe(0);
    expect(db.audits).toEqual([]);
  });

  it("H11 keeps a committed business update when the audit sink returns null", async () => {
    const before = projectRow();
    const db = database(before);
    connect(db, true);
    expect(await helper.run()).toBe(true);
    expect(db.committed.row).toEqual({ ...before, ...helper.expectedPayload });
    expect(db.committed.writes).toHaveLength(1);
    expect(db.commits).toBe(1);
    expect(db.rollbacks).toBe(0);
    expect(db.audits[0]?.payload).toEqual(helper.expectedAudit);
    expect(db.audits.every(audit => audit.commitsSeen === 1)).toBe(true);
  });
});

describe("F5b persistGeocodeResult event and field compatibility", () => {
  it("G01 preserves zone and snapshot when a snapshot is omitted or explicitly null", async () => {
    for (const optionalSnapshot of [{}, { zoneSnapshot: null }]) {
      const db = database();
      connect(db);
      expect(await persistGeocodeResult({ projectId: PROJECT_ID, geocode: GEOCODE, ...optionalSnapshot })).toBe(true);
      expect(db.committed.row?.zone).toBe("Existing Metro");
      expect(db.committed.row?.zoneModifierSnapshot).toEqual(OLD_SNAPSHOT);
      expect(db.committed.writes[0].payload).toEqual({
        latitude: "32.7765", longitude: "-79.9311", geocodeConfidence: "high",
        geocodeSource: "google_maps", geocodedAddress: "101 Test Street, Charleston, SC 29401",
        geocodedAt: NOW, updatedBy: null,
      });
      expect(db.audits.map(audit => audit.payload.action)).toEqual(["project.geocode_resolved"]);
      expect(db.audits[0].payload.userId).toBeNull();
      expect(db.audits[0].payload.after).toEqual({
        latitude: 32.7765, longitude: -79.9311, geocodeConfidence: "high",
        geocodedAddress: "101 Test Street, Charleston, SC 29401", zone: "Existing Metro",
      });
    }
  });

  it("G02 emits zone_assigned for the first zone, retaining the null before snapshot", async () => {
    const db = database(projectRow({ zone: null, zoneModifierSnapshot: null }));
    connect(db);
    expect(await persistGeocodeResult({ projectId: PROJECT_ID, geocode: GEOCODE, userId: USER_ID, zoneSnapshot: NEW_SNAPSHOT })).toBe(true);
    expect(db.committed.row?.zoneModifierSnapshot).toEqual(NEW_SNAPSHOT);
    expect(db.audits.map(audit => audit.payload.action)).toEqual(["project.geocode_resolved", "project.zone_assigned"]);
    expect(db.audits[1].payload).toEqual({
      userId: USER_ID, action: "project.zone_assigned", tableName: "projects", recordId: PROJECT_ID,
      before: { zone: null, zoneModifierSnapshot: null },
      after: { zone: "New Coastal", zoneModifierSnapshot: NEW_SNAPSHOT },
    });
  });

  it("G03 emits zone_changed when the existing zone name changes", async () => {
    const db = database();
    connect(db);
    expect(await persistGeocodeResult({ projectId: PROJECT_ID, geocode: GEOCODE, userId: USER_ID, zoneSnapshot: NEW_SNAPSHOT })).toBe(true);
    expect(db.committed.row?.zone).toBe("New Coastal");
    expect(db.audits.map(audit => audit.payload.action)).toEqual(["project.geocode_resolved", "project.zone_changed"]);
    expect(db.audits[1].payload).toEqual({
      userId: USER_ID, action: "project.zone_changed", tableName: "projects", recordId: PROJECT_ID,
      before: { zone: "Existing Metro", zoneModifierSnapshot: OLD_SNAPSHOT },
      after: { zone: "New Coastal", zoneModifierSnapshot: NEW_SNAPSHOT },
    });
  });

  it("G04 persists changed snapshot values under the same zone name without a name-change event", async () => {
    const db = database();
    connect(db);
    const replacement = { ...NEW_SNAPSHOT, zoneName: "Existing Metro" };
    expect(await persistGeocodeResult({ projectId: PROJECT_ID, geocode: GEOCODE, zoneSnapshot: replacement })).toBe(true);
    expect(db.committed.row?.zone).toBe("Existing Metro");
    expect(db.committed.row?.zoneModifierSnapshot).toEqual(replacement);
    expect(db.audits.map(audit => audit.payload.action)).toEqual(["project.geocode_resolved"]);
  });

  it("G05 preserves failed-geocode null fields and the geocode_failed event", async () => {
    const db = database();
    connect(db);
    const failure: GeocodeResult = {
      success: false, latitude: null, longitude: null, formattedAddress: null,
      confidence: "failed", source: "google_maps", locationType: null, placeId: null,
      distanceFromCenter: null, withinServiceRadius: false, warning: "Address unavailable", addressComponents: null,
    };
    expect(await persistGeocodeResult({ projectId: PROJECT_ID, geocode: failure, userId: null })).toBe(true);
    expect(db.committed.writes[0].payload).toEqual({
      latitude: null, longitude: null, geocodeConfidence: "failed", geocodeSource: "google_maps",
      geocodedAddress: null, geocodedAt: null, updatedBy: null,
    });
    expect(db.committed.row).toEqual({ ...projectRow(),
      latitude: null, longitude: null, geocodeConfidence: "failed", geocodeSource: "google_maps",
      geocodedAddress: null, geocodedAt: null, updatedBy: null,
    });
    expect(db.audits.map(audit => audit.payload.action)).toEqual(["project.geocode_failed"]);
    expect(db.audits[0].payload).toEqual({
      userId: null, action: "project.geocode_failed", tableName: "projects", recordId: PROJECT_ID,
      before: { latitude: "32.7000", longitude: "-79.9000", geocodeConfidence: "low", zone: "Existing Metro" },
      after: { latitude: null, longitude: null, geocodeConfidence: "failed", geocodedAddress: null, zone: "Existing Metro" },
    });
  });
});
