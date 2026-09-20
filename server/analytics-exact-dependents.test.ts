import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { buildExactDashboard, type ExactDashboardInput } from "../shared/analytics-exact-dashboard";
import { aggregateFieldProgress, computeProfitHealth } from "../shared/analytics-aggregation-engine";

const io = vi.hoisted(() => ({ db: vi.fn(), audit: vi.fn(), calibration: vi.fn(), adjustments: vi.fn(), pipeline: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.db }));
vi.mock("./audit-trail", () => ({ recordAuditAsync: io.audit }));
vi.mock("./calibration-db", () => ({ getCalibrationSummary: io.calibration }));
vi.mock("./price-adjustment-db", () => ({ getAdjustmentSummary: io.adjustments }));
vi.mock("./estimate-aggregate-db", () => ({ getExactEstimatePipeline: io.pipeline }));
import { getDashboard, getPipeline, getRevenueForecast, getSnapshot, listSnapshots, saveSnapshot } from "./analytics-db";

const unavailable = { state: "unavailable", reason: "EXECUTION_AUTHORITY_NOT_AVAILABLE" } as const;
const emptyPipeline: Extract<ExactDashboardInput["pipeline"], { state: "available" }> = {
  state: "available", data: {
    version: "estimate-opportunity-pipeline-exact-v1", currencyConvention: "USD_display_only", basis: "opportunity_only",
    totalCount: 0, leadCount: 0, estimateCount: 0, excludedHistoricalCount: 0,
    grossEstimateValue: { state: "known", value: "0.00", coverage: { populationCount: 0, knownCount: 0, unknownCount: 0 } },
    weightedEstimateValue: { state: "known", value: "0.00", coverage: { populationCount: 0, knownCount: 0, unknownCount: 0 } },
    byStage: [], byChannel: [], outsideEstimatePopulationByStatus: {}, stalledItems: [], medianAgeDays: null,
  },
};
function input(): ExactDashboardInput {
  return {
    generatedAt: "2026-09-20T12:00:00Z", pipeline: structuredClone(emptyPipeline), forecast: unavailable,
    profitHealth: computeProfitHealth([]), fieldProgress: aggregateFieldProgress([]), subcontractors: [],
    openCalibrationCount: 2, pendingAdjustmentCount: 3,
  };
}
beforeEach(() => {
  vi.clearAllMocks(); io.db.mockResolvedValue(null); io.pipeline.mockResolvedValue(structuredClone(emptyPipeline));
  io.calibration.mockResolvedValue({ actionableCount: 2 }); io.adjustments.mockResolvedValue({ pendingApprovalCount: 3 });
});

describe("forecast has no execution authority", () => {
  it.each([1, 6, 24])("returns explicit unavailability for %i months without querying budget data", async monthCount => {
    expect(await getRevenueForecast({ tenantId: "tenant-a", monthCount })).toEqual(unavailable);
    expect(io.db).not.toHaveBeenCalled(); expect(io.pipeline).not.toHaveBeenCalled();
  });
  it("does not inspect supplied dates or other inputs to synthesize a forecast", async () => {
    const value = { tenantId: "tenant-a", get now(): Date { throw new Error("Do not read dates"); } };
    expect(await getRevenueForecast(value)).toEqual(unavailable); expect(io.db).not.toHaveBeenCalled();
  });
});

describe("existing pipeline delegates exact snapshot reads", () => {
  it("preserves exact strings beyond Number precision without reconstructing items", async () => {
    const response = structuredClone(emptyPipeline);
    if (response.data.grossEstimateValue.state !== "known") throw new Error("fixture");
    response.data.grossEstimateValue.value = "1999999999999999999.98";
    io.pipeline.mockResolvedValue(response); const now = new Date("2026-09-20T12:00:00Z");
    expect(await getPipeline({ tenantId: "tenant-a", now })).toBe(response);
    expect(io.pipeline).toHaveBeenCalledWith({ tenantId: "tenant-a", now }); expect(io.db).not.toHaveBeenCalled();
  });
  it.each(["DB_UNAVAILABLE", "INCOMPLETE_SCAN", "COUNT_OVERFLOW"])("preserves %s without fabricating an empty pipeline", async reason => {
    const response = { state: "unavailable", reason }; io.pipeline.mockResolvedValue(response);
    expect(await getPipeline({ tenantId: "tenant-a" })).toEqual(response);
  });
});

describe("exact dashboard composition", () => {
  it("retains exact pipeline and unavailable forecast without numeric adapters", () => {
    const source = input(); const result = buildExactDashboard(source);
    expect(result).toMatchObject({ version: "analytics-dashboard-exact-v1", consistency: "independent_components", pipeline: source.pipeline, forecast: unavailable });
    expect(result.headline).toContain("Forecast unavailable"); expect(result.headline).not.toContain("0 forecast revenue");
  });
  it("keeps independent calibration and adjustment facts visible", () => {
    const result = buildExactDashboard(input());
    expect(result.priorityActions.some(x => x.includes("3 price adjustment"))).toBe(true);
    expect(result.priorityActions.some(x => x.includes("2 calibration"))).toBe(true);
  });
  it.each(["DB_UNAVAILABLE", "INCOMPLETE_SCAN", "COUNT_OVERFLOW"])("composes factual components when pipeline is %s", reason => {
    const source = input(); source.pipeline = { state: "unavailable", reason } as ExactDashboardInput["pipeline"];
    const result = buildExactDashboard(source); expect(result.pipeline).toEqual(source.pipeline);
    expect(result.priorityActions).toHaveLength(2); expect(result.fieldProgress).toEqual(source.fieldProgress);
    expect(result.headline).toContain("Forecast unavailable");
  });
  it("does not present an undefined margin as zero", () => {
    const source = input(); source.profitHealth.portfolioGrossProfitPct = null;
    expect(buildExactDashboard(source).headline).toContain("Portfolio margin unavailable");
  });
  it("keeps stalled opportunity counts as facts without assigning revenue", () => {
    const source = input(); if (source.pipeline.state !== "available") throw new Error("fixture");
    source.pipeline.data.stalledItems = [{ kind: "lead", id: "lead-a", stage: "new", ageDays: 40, estimateValue: null }];
    const result = buildExactDashboard(source);
    expect(result.priorityActions[0]).toContain("1 opportunit"); expect(result.forecast).toEqual(unavailable);
  });
  it("preserves zero known margin and field completion", () => {
    const source = input(); source.profitHealth.portfolioGrossProfitPct = 0; source.fieldProgress.completionPct = 0;
    const result = buildExactDashboard(source); expect(result.headline).toContain("0% portfolio margin"); expect(result.headline).toContain("0% field completion");
  });
  it("does not copy unknown caller fields or obsolete monetary aliases into the DTO", () => {
    const source = Object.assign(input(), { totalValue: 123, obsoletePrivateData: "not a dashboard field" });
    const result = buildExactDashboard(source);
    expect(result).not.toHaveProperty("totalValue"); expect(result).not.toHaveProperty("obsoletePrivateData");
  });
  it("actual server composition returns the new DTO and independent facts", async () => {
    const result = await getDashboard({ tenantId: "tenant-a", now: new Date("2026-09-20T12:00:00Z") });
    expect(result).toMatchObject({ version: "analytics-dashboard-exact-v1", pipeline: emptyPipeline, forecast: unavailable, openCalibrationCount: 2, pendingAdjustmentCount: 3 });
    expect(io.pipeline).toHaveBeenCalledTimes(1); expect(io.calibration).toHaveBeenCalledWith("tenant-a"); expect(io.adjustments).toHaveBeenCalledWith("tenant-a");
  });
});

describe("new pipeline snapshot writes are unavailable; existing history survives", () => {
  it.each(["pipeline", "revenue_forecast"])("direct %s writer refuses before inspecting payload, connection or audit", async snapshotType => {
    const value = { tenantId: "tenant-a", snapshotType, get payload(): unknown { throw new Error("Do not inspect payload"); } };
    await expect(saveSnapshot(value)).rejects.toMatchObject({ code: "SNAPSHOT_WRITE_NOT_AVAILABLE" });
    expect(io.db).not.toHaveBeenCalled(); expect(io.audit).not.toHaveBeenCalled();
  });
  it.each(["pipeline", "revenue_forecast"])("repeated %s write cannot replace a previously closed period", async snapshotType => {
    const db = { select: vi.fn(), update: vi.fn(), insert: vi.fn() }; io.db.mockResolvedValue(db);
    for (let i = 0; i < 2; i++) await expect(saveSnapshot({ tenantId: "tenant-a", snapshotType, periodStart: "2026-09-01", payload: { totalValue: 10 } })).rejects.toMatchObject({ code: "SNAPSHOT_WRITE_NOT_AVAILABLE" });
    expect(db.select).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("preserves legacy snapshot read and list payloads without reinterpreting their values", async () => {
    const row = { id: "snapshot-a", tenantId: "tenant-a", snapshotType: "pipeline", payload: { totalValueCents: 123, rows: ["legacy"] } };
    const q = { where: vi.fn(() => q), orderBy: vi.fn(() => q), limit: vi.fn(async () => [row]) };
    io.db.mockResolvedValue({ select: () => ({ from: (table: Table) => { expect(getTableName(table)).toBe("analytics_snapshots"); return q; } }) });
    expect(await getSnapshot({ tenantId: "tenant-a", snapshotKey: "pipeline:month:2026-09-01:-" })).toBe(row);
    expect(await listSnapshots({ tenantId: "tenant-a" })).toEqual([row]); expect(io.audit).not.toHaveBeenCalled();
  });
});
