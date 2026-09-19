/**
 * G3a-2 calibration geo isolation.
 *
 * The injected findings in the first group deliberately reach a latent private writer through
 * the real runTenantCalibration orchestration. They are not evidence that the normal producer
 * currently emits a writable zone id. buildCalibrationReport, upsertCalibrationFinding,
 * persistCalibrationReport, and the audit trail remain real; only validateGeoFactors is
 * substituted to expose the writer boundary.
 *
 * The fake database adds no tenant policy of its own. It applies the SQL predicate emitted by
 * production, so an id-only UPDATE can mutate a foreign or NULL-owned row and the test catches
 * that effect. A separate producer test delegates the validator mock to the real engine and
 * proves that today's collected samples carry null zone ids and therefore do not write a zone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  auditLog,
  calibrationEvents,
  calibrationReports,
  geoZones,
  projects,
  tenantSettings,
} from "../drizzle/schema";
import type { CalibrationFinding } from "@shared/calibration-engine";

const TENANT_A = "a2000000-0000-4000-8000-00000000000a";
const TENANT_B = "a2000000-0000-4000-8000-00000000000b";
const ACTOR_A = "b2000000-0000-4000-8000-00000000000a";
const PROJECT_A = "c2000000-0000-4000-8000-000000000001";
const ZONE_A = "d2000000-0000-4000-8000-00000000000a";
const ZONE_B = "d2000000-0000-4000-8000-00000000000b";
const ZONE_NULL = "d2000000-0000-4000-8000-00000000000f";

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;
type UpdateRecord = {
  table: string;
  values: Row;
  where?: SQL;
  affected: number;
  failed: boolean;
};

const engineState = vi.hoisted(() => ({
  findings: [] as CalibrationFinding[],
  useRealValidator: false,
}));

const collectorState = vi.hoisted(() => ({
  snapshot: {
    byCostCode: [] as Row[],
    totalEstimatedCents: 0,
    totalActualCents: 0,
  },
  closeout: null as Row | null,
  tasks: [] as Row[],
  budget: null as Row | null,
}));

vi.mock("@shared/calibration-engine", async importOriginal => {
  const actual = await importOriginal<typeof import("@shared/calibration-engine")>();
  return {
    ...actual,
    validateGeoFactors: vi.fn((samples, options) =>
      engineState.useRealValidator
        ? actual.validateGeoFactors(samples, options)
        : structuredClone(engineState.findings),
    ),
  };
});

vi.mock("./actuals-db", () => ({
  getVarianceSnapshot: vi.fn(async () => structuredClone(collectorState.snapshot)),
}));
vi.mock("./closeout-db", () => ({
  getCloseoutByProject: vi.fn(async () => structuredClone(collectorState.closeout)),
}));
vi.mock("./field-operations-db", () => ({
  listFieldTasks: vi.fn(async () => ({ tasks: structuredClone(collectorState.tasks), total: collectorState.tasks.length })),
  getProjectBudgetEstimate: vi.fn(async () => structuredClone(collectorState.budget)),
}));

let store: Store;
let updates: UpdateRecord[];
let geoUpdateAttempt = 0;
let failGeoUpdateAttempts: Set<number>;
let nextId = 1;

function tableName(table: unknown): string {
  return getTableName(table as Table);
}

function paramFor(query: ReturnType<PgDialect["sqlToQuery"]>, column: string): unknown {
  const match = new RegExp(`"[^"]+"\\."${column}" = \\$(\\d+)`).exec(query.sql);
  return match ? query.params[Number(match[1]) - 1] : undefined;
}

function matches(row: Row, where?: SQL): boolean {
  if (!where) return true;
  const query = new PgDialect().sqlToQuery(where);
  const mappings: Array<[string, string]> = [
    ["id", "id"],
    ["tenant_id", "tenantId"],
    ["status", "status"],
    ["finding_key", "findingKey"],
    ["report_key", "reportKey"],
  ];

  for (const [column, property] of mappings) {
    const expected = paramFor(query, column);
    if (expected === undefined) continue;
    if (property === "tenantId" && row[property] == null && query.sql.includes('"tenant_id" is null')) {
      continue;
    }
    if (row[property] !== expected) return false;
  }
  if (query.sql.includes('"deleted_at" is null') && row.deletedAt != null) return false;
  return true;
}

function rowsFor(table: string): Row[] {
  return store[table] ?? (store[table] = []);
}

type Query = PromiseLike<Row[]> & {
  from(table: unknown): Query;
  where(predicate: SQL): Query;
  orderBy(...values: unknown[]): Query;
  limit(count: number): Query;
  offset(count: number): Query;
  values(values: Row | Row[]): Query;
  set(values: Row): Query;
  returning(selection?: Row): Query;
};

function query(kind: "select" | "insert" | "update", initialTable = "other"): Query {
  const state: { table: string; where?: SQL; values?: Row | Row[]; limit?: number } = {
    table: initialTable,
  };
  let execution: Promise<Row[]> | undefined;
  const chain: Query = {
    from(table) { state.table = tableName(table); return chain; },
    where(predicate) { state.where = predicate; return chain; },
    orderBy() { return chain; },
    limit(count) { state.limit = count; return chain; },
    offset() { return chain; },
    values(values) { state.values = values; return chain; },
    set(values) { state.values = values; return chain; },
    returning() { return chain; },
    then(resolve, reject) {
      execution ??= Promise.resolve().then(() => {
        if (kind === "select") {
          const found = rowsFor(state.table).filter(row => matches(row, state.where));
          return structuredClone(state.limit == null ? found : found.slice(0, state.limit));
        }

        if (kind === "insert") {
          const incoming = Array.isArray(state.values) ? state.values : [state.values ?? {}];
          const created = incoming.map(values => ({
            id: `${state.table}-${nextId++}`,
            status: state.table === "calibration_events" ? "open" : undefined,
            createdAt: new Date("2026-09-14T12:00:00.000Z"),
            updatedAt: new Date("2026-09-14T12:00:00.000Z"),
            ...structuredClone(values),
          }));
          rowsFor(state.table).push(...created);
          return structuredClone(created);
        }

        const values = structuredClone((state.values ?? {}) as Row);
        const candidates = rowsFor(state.table).filter(row => matches(row, state.where));
        if (state.table === "geo_zones") {
          geoUpdateAttempt += 1;
          if (failGeoUpdateAttempts.has(geoUpdateAttempt)) {
            updates.push({ table: state.table, values, where: state.where, affected: 0, failed: true });
            throw new Error(`injected geo UPDATE failure #${geoUpdateAttempt}`);
          }
        }
        for (const row of candidates) Object.assign(row, values);
        updates.push({
          table: state.table,
          values,
          where: state.where,
          affected: candidates.length,
          failed: false,
        });
        return structuredClone(candidates);
      });
      return execution.then(resolve, reject);
    },
  };
  return chain;
}

const fakeDb = {
  select: () => query("select"),
  insert: (table: unknown) => query("insert", tableName(table)),
  update: (table: unknown) => query("update", tableName(table)),
};

vi.mock("./db", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  getDb: vi.fn(async () => fakeDb),
}));

const { collectProjectSamples, runTenantCalibration } = await import("./calibration-db");

function zoneRow(overrides: Row = {}): Row {
  return {
    id: ZONE_A,
    tenantId: TENANT_A,
    name: "Tenant A Coastal",
    zoneName: "Tenant A Coastal",
    description: "commercial policy must survive calibration",
    boundaryGeojson: { type: "Polygon", coordinates: [] },
    costMultiplier: "1.08",
    county: "Charleston",
    zipCodes: ["29401"],
    centerLat: 32.78,
    centerLng: -79.93,
    radiusMiles: "20",
    coastalExposureLevel: "high",
    laborModifier: "1.17",
    materialModifier: "1.09",
    logisticsModifier: "1.11",
    logisticsComplexity: "high",
    contingencyPct: "4.0",
    minProfitShieldPct: "42.0",
    isActive: true,
    validatedFloorPct: "41.0",
    validatedAt: new Date("2026-08-01T00:00:00.000Z"),
    validationSampleCount: 4,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function geoFinding(geoZoneId: string | null = ZONE_A, key = `geo:${geoZoneId ?? "none"}`): CalibrationFinding {
  return {
    eventType: "geo_factor_validation",
    findingKey: key,
    scope: "tenant",
    geoZoneId,
    geoZoneName: "Observed Coastal",
    geoRiskClass: "coastal",
    observedFactor: 42,
    suggestedFactor: 45.5,
    bias: {
      direction: "underestimates",
      meanDeviationPct: 8.3,
      medianDeviationPct: 8.3,
      stdDevPct: 0,
      sampleCount: 6,
      overrunCount: 6,
      underrunCount: 0,
      consistency: 1,
      tolerancePct: 5,
    },
    confidence: {
      score: 82,
      band: "high",
      sampleCount: 6,
      consistency: 1,
      dispersionPct: 0,
      rationale: "Six consistent closed jobs.",
    },
    suggestion: {
      adjustmentPct: 3.5,
      capped: false,
      belowNoiseFloor: false,
      rawDeviationPct: 3.5,
      rationale: "Observed margin is below the configured floor.",
    },
    actionable: true,
    recommendation: "Review the observed geo floor.",
    rationale: "Calibration evidence only; no producer activation.",
    evidence: { projectIds: [], deviations: [8.3], samples: [] },
  };
}

function durationFinding(): CalibrationFinding {
  return {
    ...geoFinding(null, "duration:general"),
    eventType: "duration_accuracy",
    geoZoneId: ZONE_A,
    trade: "general",
    estimatedDurationDays: 10,
    actualDurationDays: 12,
    durationVarianceDays: 2,
  };
}

function geoUpdates(): UpdateRecord[] {
  return updates.filter(update => update.table === "geo_zones");
}

async function run(findings: CalibrationFinding[], tenantId = TENANT_A) {
  engineState.findings = structuredClone(findings);
  engineState.useRealValidator = false;
  return runTenantCalibration({ tenantId, actorId: ACTOR_A, period: "g3a2-proof" });
}

async function expectReportAudit(): Promise<void> {
  await vi.waitFor(() => {
    expect(rowsFor("audit_log").some(row => row.action === "calibration.report_generated")).toBe(true);
  });
}

beforeEach(() => {
  store = {
    projects: [],
    tenant_settings: [],
    calibration_events: [],
    calibration_reports: [],
    geo_zones: [],
    audit_log: [],
  };
  updates = [];
  geoUpdateAttempt = 0;
  failGeoUpdateAttempts = new Set();
  nextId = 1;
  engineState.findings = [];
  engineState.useRealValidator = false;
  collectorState.snapshot = { byCostCode: [], totalEstimatedCents: 0, totalActualCents: 0 };
  collectorState.closeout = null;
  collectorState.tasks = [];
  collectorState.budget = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("G3a-2 · latent calibration writer is strictly tenant scoped", () => {
  it("1. updates a caller-owned zone with exactly the three observational fields", async () => {
    store.geo_zones = [zoneRow()];

    const result = await run([geoFinding()]);

    expect(result.findingCount).toBe(1);
    expect(geoUpdates()).toHaveLength(1);
    expect(Object.keys(geoUpdates()[0].values).sort()).toEqual([
      "validatedAt",
      "validatedFloorPct",
      "validationSampleCount",
    ]);
    expect(store.geo_zones[0]).toMatchObject({
      validatedFloorPct: "45.5",
      validationSampleCount: 6,
    });
    expect(store.geo_zones[0].validatedAt).toBeInstanceOf(Date);
  });

  it("2. preserves a foreign zone while persisting the caller's event, report, and report audit", async () => {
    store.geo_zones = [zoneRow({ id: ZONE_B, tenantId: TENANT_B, validatedFloorPct: "49.0" })];

    const result = await run([geoFinding(ZONE_B)]);

    expect(store.geo_zones[0].validatedFloorPct).toBe("49.0");
    expect(geoUpdates()[0].affected).toBe(0);
    expect(store.calibration_events).toHaveLength(1);
    expect(store.calibration_events[0]).toMatchObject({ tenantId: TENANT_A, geoZoneId: ZONE_B });
    expect(store.calibration_reports).toHaveLength(1);
    expect(result.reportId).toBe(store.calibration_reports[0].id);
    await expectReportAudit();
  });

  it("3. preserves a NULL-owned zone while the caller's report workflow completes", async () => {
    store.geo_zones = [zoneRow({ id: ZONE_NULL, tenantId: null, validatedFloorPct: "37.0" })];

    const result = await run([geoFinding(ZONE_NULL)]);

    expect(store.geo_zones[0].validatedFloorPct).toBe("37.0");
    expect(geoUpdates()[0].affected).toBe(0);
    expect(result.eventIds).toHaveLength(1);
    expect(store.calibration_reports).toHaveLength(1);
    await expectReportAudit();
  });

  it("4. treats an absent zone as a best-effort miss and still returns the report", async () => {
    const result = await run([geoFinding(ZONE_A)]);

    expect(geoUpdates()).toHaveLength(1);
    expect(geoUpdates()[0].affected).toBe(0);
    expect(result.findingCount).toBe(1);
    expect(store.calibration_events).toHaveLength(1);
    expect(store.calibration_reports).toHaveLength(1);
  });

  it("5. does not attempt a zone UPDATE for a geo finding without an id", async () => {
    store.geo_zones = [zoneRow()];

    const result = await run([geoFinding(null)]);

    expect(geoUpdates()).toHaveLength(0);
    expect(result.report.geoFactorFindings).toHaveLength(1);
    expect(store.geo_zones[0].validatedFloorPct).toBe("41.0");
  });

  it("6. does not attempt a zone UPDATE for a non-geo finding", async () => {
    store.geo_zones = [zoneRow()];

    const result = await run([durationFinding()]);

    expect(geoUpdates()).toHaveLength(0);
    expect(result.report.durationFindings).toHaveLength(1);
    expect(store.geo_zones[0].validatedFloorPct).toBe("41.0");
  });

  it("7. continues after the first geo UPDATE throws and records the second owned finding", async () => {
    store.geo_zones = [zoneRow({ id: ZONE_A, validatedFloorPct: "40.0" })];
    failGeoUpdateAttempts.add(1);

    const result = await run([
      geoFinding("d2000000-0000-4000-8000-000000000099", "geo:first-fails"),
      geoFinding(ZONE_A, "geo:second-succeeds"),
    ]);

    expect(result.eventIds).toHaveLength(2);
    expect(geoUpdates()).toHaveLength(2);
    expect(geoUpdates().map(update => update.failed)).toEqual([true, false]);
    expect(store.geo_zones[0].validatedFloorPct).toBe("45.5");
    expect(store.calibration_reports).toHaveLength(1);
  });

  it("8. ignores a foreign finding then updates a later caller-owned zone", async () => {
    store.geo_zones = [
      zoneRow({ id: ZONE_B, tenantId: TENANT_B, validatedFloorPct: "49.0" }),
      zoneRow({ id: ZONE_A, tenantId: TENANT_A, validatedFloorPct: "40.0" }),
    ];

    await run([
      geoFinding(ZONE_B, "geo:foreign-first"),
      geoFinding(ZONE_A, "geo:owned-second"),
    ]);

    expect(store.geo_zones[0].validatedFloorPct).toBe("49.0");
    expect(store.geo_zones[1].validatedFloorPct).toBe("45.5");
    expect(geoUpdates().map(update => update.affected)).toEqual([0, 1]);
  });

  it("9. rejects an unresolved tenant before reading or writing calibration data", async () => {
    store.geo_zones = [zoneRow()];

    await expect(run([geoFinding()], "")).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });

    expect(geoUpdates()).toHaveLength(0);
    expect(store.calibration_events).toHaveLength(0);
    expect(store.calibration_reports).toHaveLength(0);
    expect(store.audit_log).toHaveLength(0);
  });

  it("10. the real producer emits a null zone id and a normal tenant run performs no zone UPDATE", async () => {
    store.projects = [{
      id: PROJECT_A,
      tenantId: TENANT_A,
      name: "Closed coastal project",
      projectType: "remodel",
      commercialChannel: "premium",
      geoRiskClass: "coastal",
      status: "closed",
      closedAt: new Date("2026-09-01T00:00:00.000Z"),
      deletedAt: null,
    }];
    store.geo_zones = [zoneRow()];
    collectorState.snapshot = {
      byCostCode: [],
      totalEstimatedCents: 7_000_000,
      totalActualCents: 6_000_000,
    };
    collectorState.budget = {
      id: "estimate-1",
      finalTotalPrice: "100000.00",
      subtotalPrice: "90000.00",
      grossProfitPct: "44.0",
      profitShieldFloorPct: "42.0",
    };

    const samples = await collectProjectSamples(PROJECT_A);
    const realEngine = await vi.importActual<typeof import("@shared/calibration-engine")>(
      "@shared/calibration-engine",
    );
    const producerFindings = realEngine.validateGeoFactors(samples.geoSamples, { period: "g3a2-proof" });

    expect(samples.totalActualCents).toBeGreaterThan(0);
    expect(samples.geoSamples).toEqual([
      expect.objectContaining({ geoZoneId: null, geoZoneName: null, configuredFloorPct: 42 }),
    ]);
    expect(producerFindings).toHaveLength(1);
    expect(producerFindings[0].geoZoneId).toBeNull();

    engineState.useRealValidator = true;
    const result = await runTenantCalibration({
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      period: "g3a2-proof",
    });

    expect(result.report.geoFactorFindings).toHaveLength(1);
    expect(result.report.geoFactorFindings[0].geoZoneId).toBeNull();
    expect(geoUpdates()).toHaveLength(0);
    expect(store.geo_zones[0].validatedFloorPct).toBe("41.0");
  });

  it("11. binds both caller tenant and zone id in the final UPDATE predicate", async () => {
    store.geo_zones = [zoneRow()];

    await run([geoFinding()]);

    const compiled = new PgDialect().sqlToQuery(geoUpdates()[0].where!);
    expect(compiled.sql).toContain('"geo_zones"."tenant_id" =');
    expect(compiled.sql).toContain('"geo_zones"."id" =');
    expect(compiled.sql).not.toContain("is null");
    expect(compiled.params).toEqual([TENANT_A, ZONE_A]);
  });

  it("12. preserves every commercial and identity field on an owned zone", async () => {
    const before = zoneRow();
    store.geo_zones = [structuredClone(before)];

    await run([geoFinding()]);

    const after = store.geo_zones[0];
    const observational = new Set(["validatedFloorPct", "validatedAt", "validationSampleCount"]);
    for (const [field, value] of Object.entries(before)) {
      if (!observational.has(field)) expect(after[field]).toEqual(value);
    }
    expect(after.minProfitShieldPct).toBe("42.0");
    expect(after.laborModifier).toBe("1.17");
    expect(after.materialModifier).toBe("1.09");
    expect(after.logisticsModifier).toBe("1.11");
  });
});
