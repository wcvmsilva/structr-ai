import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { calibrationEvents, calibrationReports, geoZones } from "../drizzle/schema";
import { runTenantCalibration } from "./calibration-db";
import type { CalibrationFinding, GeoSample } from "../shared/calibration-engine";
import { startG3a2Postgres, type G3a2Postgres } from "./test-support/g3a2-postgres";

const boundary = vi.hoisted(() => ({ db: null as any, findings: null as CalibrationFinding[] | null, audit: vi.fn(), realValidate: null as any }));
vi.mock("./db", () => ({ getDb: async () => boundary.db }));
vi.mock("./audit-trail", () => ({ recordAuditAsync: (entry: unknown) => boundary.audit(entry) }));
vi.mock("./tenant-settings-db", () => ({ getTenantSettings: async () => null }));
vi.mock("./actuals-db", () => ({ getVarianceSnapshot: vi.fn() }));
vi.mock("./closeout-db", () => ({ getCloseoutByProject: vi.fn() }));
vi.mock("./field-operations-db", () => ({ getProjectBudgetEstimate: vi.fn(), listFieldTasks: vi.fn() }));
vi.mock("@shared/calibration-engine", async importOriginal => {
  const real = await importOriginal<typeof import("../shared/calibration-engine")>();
  boundary.realValidate = real.validateGeoFactors;
  return { ...real, validateGeoFactors: (...args: Parameters<typeof real.validateGeoFactors>) => boundary.findings === null ? real.validateGeoFactors(...args) : structuredClone(boundary.findings) };
});

describe.skipIf(process.env.G3A2_POSTGRES !== "1")("G3a2 calibration geo — owned disposable PostgreSQL", () => {
  const tenantId = "a1000000-0000-4000-8000-000000000001";
  const foreign = "a1000000-0000-4000-8000-000000000002";
  const actorId = "b1000000-0000-4000-8000-000000000001";
  let cluster: G3a2Postgres;
  beforeAll(async () => { cluster = await startG3a2Postgres(); }, 60_000);
  afterAll(async () => { await cluster?.stop(); vi.unstubAllEnvs(); }, 20_000);
  beforeEach(async () => {
    if (!cluster) throw new Error("Enabled PostgreSQL setup did not complete");
    await cluster.observer.sql.unsafe("DROP FUNCTION IF EXISTS g3a2_calibration_fault() CASCADE");
    await cluster.observer.sql.unsafe("TRUNCATE geo_zones, price_adjustments, projects, calibration_events, calibration_reports");
    boundary.db = cluster.first.db; boundary.findings = null; boundary.audit.mockReset();
    vi.stubEnv("TENANT_STRICT", "false");
  });
  async function zone(owner: string | null = tenantId) {
    const [row] = await cluster.observer.db.insert(geoZones).values({ tenantId: owner, name: "Synthetic calibration zone", minProfitShieldPct: "42",
      costMultiplier: "1.15", laborModifier: "1.2", materialModifier: "1.3", contingencyPct: "8", validatedFloorPct: "39", validatedAt: new Date("2025-01-01T00:00:00Z"), validationSampleCount: 3,
      description: "Preserve configured commercial fields", boundaryGeojson: { type: "Polygon", coordinates: [] }, zipCodes: ["29401"] }).returning();
    return row;
  }
  // These twelve pieces of evidence are SYNTHETIC engine inputs, not projects
  // collected from the fixture. Real projects remains empty throughout this suite.
  function findings(geoZoneId: string | null): CalibrationFinding[] {
    const samples: GeoSample[] = Array.from({ length: 12 }, () => ({ projectId: randomUUID(), geoZoneId, geoZoneName: "Synthetic calibration zone", configuredFloorPct: 42, realizedGrossProfitPct: 38 }));
    return boundary.realValidate(samples, { period: "all_time" });
  }
  async function run(expectedCount: number) {
    const result = await runTenantCalibration({ tenantId, actorId, period: "all_time" });
    expect(result.projectCount).toBe(0); expect(result.findingCount).toBe(expectedCount); expect(result.reportId).toBeTruthy();
    const [report] = await cluster.observer.db.select().from(calibrationReports).where(eq(calibrationReports.id, result.reportId!));
    expect(report.tenantId).toBe(tenantId); expect(report.projectCount).toBe(0); expect(report.eventCount).toBe(expectedCount);
    const events = await cluster.observer.db.select().from(calibrationEvents);
    expect(events).toHaveLength(expectedCount); expect(events.every(event => event.tenantId === tenantId)).toBe(true);
    expect(boundary.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId, action: "calibration.report_generated" }));
    return result;
  }
  async function readZone(id: string) { return (await cluster.observer.db.select().from(geoZones).where(eq(geoZones.id, id)))[0]; }
  function commercial(row: Awaited<ReturnType<typeof zone>>) {
    const { validatedFloorPct, validatedAt, validationSampleCount, ...rest } = row; return rest;
  }

  it("persists its own report and records observed floor for its own zone", async () => {
    const z = await zone(); boundary.findings = findings(z.id); await run(1);
    const after = await readZone(z.id);
    expect(Number(after.validatedFloorPct)).toBe(boundary.findings[0].suggestedFactor);
    expect(after.validationSampleCount).toBe(12); expect(after.validatedAt!.getTime()).toBeGreaterThan(z.validatedAt!.getTime());
  });
  it.each([["foreign", foreign], ["NULL-owned", null]] as const)("preserves %s zone byte for byte while persisting its own report", async (_label, owner) => {
    const z = await zone(owner); boundary.findings = findings(z.id); await run(1);
    expect(await readZone(z.id)).toEqual(z);
  });
  it("persists report and event for an absent zone without creating that zone", async () => {
    boundary.findings = findings(randomUUID()); await run(1);
    expect(await cluster.observer.db.select().from(geoZones)).toEqual([]);
  });
  it("persists a finding without geo id and leaves zones unchanged", async () => {
    const z = await zone(); boundary.findings = findings(null); await run(1); expect(await readZone(z.id)).toEqual(z);
  });
  it("continues to the second owned zone after the first real SQL update fails", async () => {
    const first = await zone(); const second = await zone(); boundary.findings = [...findings(first.id), ...findings(second.id)];
    await cluster.observer.sql.unsafe(`CREATE FUNCTION g3a2_calibration_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${first.id}'::uuid THEN RAISE EXCEPTION 'g3a2 item failure'; END IF; RETURN NEW; END $$`);
    await cluster.observer.sql.unsafe("CREATE TRIGGER g3a2_calibration_fault BEFORE UPDATE ON geo_zones FOR EACH ROW EXECUTE FUNCTION g3a2_calibration_fault()");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try { await run(2); expect(errors).toHaveBeenCalled(); } finally { errors.mockRestore(); }
    expect(await readZone(first.id)).toEqual(first);
    const after = await readZone(second.id); expect(after.validationSampleCount).toBe(12); expect(Number(after.validatedFloorPct)).toBe(boundary.findings[1].suggestedFactor);
  });
  it("skips a foreign item and still updates the following owned zone", async () => {
    const first = await zone(foreign); const second = await zone(); boundary.findings = [...findings(first.id), ...findings(second.id)];
    await run(2); expect(await readZone(first.id)).toEqual(first);
    const after = await readZone(second.id); expect(after.validationSampleCount).toBe(12); expect(Number(after.validatedFloorPct)).toBe(boundary.findings[1].suggestedFactor);
  });
  it("preserves the configured protective floor and every commercial field", async () => {
    const z = await zone(); boundary.findings = findings(z.id); await run(1);
    const after = await readZone(z.id); expect(commercial(after)).toEqual(commercial(z));
    expect(Number(after.minProfitShieldPct)).toBe(42); expect(after.validationSampleCount).toBe(12);
  });
  it("runs the actual engine with empty projects and emits no latent geo findings", async () => {
    const z = await zone(); boundary.findings = null; await run(0); expect(await readZone(z.id)).toEqual(z);
  });
});
