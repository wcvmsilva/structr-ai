/**
 * G3a-2 caller controls: routers, middleware and parent ownership lookups are real.
 * Final operations are spies; SQL isolation and transaction effects are proved in
 * the helper/PostgreSQL suites. This driver matches IDs only, never tenant/role.
 * These controls are expected to pass on the unchanged bcb50d3e baseline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";
import type { PriceAdjustment } from "../drizzle/schema";
import { buildCalibrationReport, validateGeoFactors } from "../shared/calibration-engine";
import { computeRollback, previewAdjustmentImpact } from "../shared/price-adjustment-engine";

const boundary = vi.hoisted(() => ({
  propose: vi.fn<typeof import("./price-adjustment-db").proposeAdjustment>(),
  apply: vi.fn<typeof import("./price-adjustment-db").applyAdjustment>(),
  rollback: vi.fn<typeof import("./price-adjustment-db").rollbackAdjustment>(),
  fromFindings: vi.fn<typeof import("./price-adjustment-db").proposeFromFindings>(),
  preview: vi.fn<typeof import("./price-adjustment-db").previewImpact>(),
  runTenant: vi.fn<typeof import("./calibration-db").runTenantCalibration>(),
}));

type Row = Record<string, unknown>;
const store: Record<string, Row[]> = {};
const reads: Array<{ table: string; sql: string; params: unknown[] }> = [];

const driver = {
  select: () => ({
    from: (table: Table) => ({
      where: (predicate: SQL) => ({
        limit: async (limit: number) => {
          const name = getTableName(table);
          if (!["price_adjustments", "calibration_reports"].includes(name)) {
            throw new Error("Unexpected caller DB table: " + name);
          }
          const query = new PgDialect().sqlToQuery(predicate);
          const idParameter = /"[^"]+"\."id" = \$(\d+)/.exec(query.sql);
          if (!idParameter) throw new Error("Caller fixture requires primary-key lookup.");
          reads.push({ table: name, sql: query.sql, params: query.params });
          const id = query.params[Number(idParameter[1]) - 1];
          return structuredClone((store[name] ?? []).filter(row => row.id === id).slice(0, limit));
        },
      }),
    }),
  }),
};

vi.mock("./db", () => ({ getDb: async () => driver }));
vi.mock("./audit", () => ({ logAudit: vi.fn() }));
vi.mock("./audit-trail", () => ({ recordAuditAsync: vi.fn() }));
vi.mock("./tenant-settings-db", () => ({ getTenantSettings: vi.fn(async () => null) }));
vi.mock("./actuals-db", () => ({ getVarianceSnapshot: vi.fn() }));
vi.mock("./closeout-db", () => ({ getCloseoutByProject: vi.fn() }));
vi.mock("./field-operations-db", () => ({
  getProjectBudgetEstimate: vi.fn(), listFieldTasks: vi.fn(),
}));
vi.mock("./price-adjustment-db", async importOriginal => {
  const actual = await importOriginal<typeof import("./price-adjustment-db")>();
  return {
    ...actual,
    proposeAdjustment: boundary.propose,
    applyAdjustment: boundary.apply,
    rollbackAdjustment: boundary.rollback,
    proposeFromFindings: boundary.fromFindings,
    previewImpact: boundary.preview,
  };
});
vi.mock("./calibration-db", async importOriginal => ({
  ...await importOriginal<typeof import("./calibration-db")>(),
  runTenantCalibration: boundary.runTenant,
}));

import { router } from "./_core/trpc";
import { priceAdjustmentRouter } from "./price-adjustment-router";
import { calibrationRouter } from "./calibration-router";
import { PriceAdjustmentError } from "./price-adjustment-db";

const TENANT = "a1000000-0000-4000-8000-000000000001";
const FOREIGN = "a1000000-0000-4000-8000-000000000002";
const ACTOR = "b1000000-0000-4000-8000-000000000001";
const ADJUSTMENT = "c1000000-0000-4000-8000-000000000001";
const REPORT = "d1000000-0000-4000-8000-000000000001";
const ZONE = "e1000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-14T20:00:00.000Z");
const REASON = "Approved synthetic caller control";
const api = router({ priceAdjustment: priceAdjustmentRouter, calibration: calibrationRouter });

function context(role: "admin" | "user" | null = "admin", tenantId: string | null = TENANT): TrpcContext {
  return {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    // Only authenticated identity/role are consumed by this caller boundary.
    user: role === null ? null : { id: ACTOR, role } as NonNullable<TrpcContext["user"]>,
    tenantId,
    authProvider: "legacy",
  };
}

function adjustmentRow(): PriceAdjustment {
  return {
    id: ADJUSTMENT, tenantId: TENANT, targetType: "geo_factor",
    costCodeId: null, costCode: null, assemblyId: null, geoZoneId: ZONE, trade: null,
    adjustmentPct: "5", previousValue: "42", newValue: "44.1",
    previousUnitCostCents: null, newUnitCostCents: null, reason: REASON,
    sourceCalibrationId: null, sourceReportId: null, source: "manual",
    confidenceScore: null, confidenceBand: null, sampleCount: 0, status: "approved",
    proposedBy: ACTOR, proposedAt: NOW, approvedBy: ACTOR, approvedAt: NOW,
    appliedBy: null, appliedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
    rolledBackBy: null, rolledBackAt: null, rollbackReason: null,
    appliedPricingHistoryId: null, rollbackSnapshot: null, effectiveFrom: null,
    expiresAt: null, notes: null, metadata: null, createdBy: ACTOR, updatedBy: ACTOR,
    deletedAt: null, createdAt: NOW, updatedAt: NOW,
  };
}

const proposalInput = {
  targetType: "geo_factor" as const, geoZoneId: ZONE, adjustmentPct: 5, reason: REASON,
};
const mutationNames = ["apply", "rollback", "fromRun", "runTenant"] as const;
type MutationName = typeof mutationNames[number];

function invoke(name: MutationName, ctx: TrpcContext) {
  const caller = api.createCaller(ctx);
  switch (name) {
    case "apply": return caller.priceAdjustment.applyToPriceBook({ adjustmentId: ADJUSTMENT });
    case "rollback": return caller.priceAdjustment.rollback({ adjustmentId: ADJUSTMENT, reason: REASON });
    case "fromRun": return caller.priceAdjustment.proposeFromRun({ reportId: REPORT });
    case "runTenant": return caller.calibration.runTenant({ period: "all_time" });
  }
}

function expectNoFinalOperation() {
  for (const spy of Object.values(boundary)) expect(spy).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  reads.length = 0;
  store.price_adjustments = [adjustmentRow()];
  store.calibration_reports = [{ id: REPORT, tenantId: TENANT, proposedAdjustments: [] }];
  boundary.propose.mockResolvedValue({ adjustment: adjustmentRow(), warnings: [] });
  boundary.apply.mockResolvedValue({
    adjustment: { ...adjustmentRow(), status: "applied" }, pricingHistoryId: null,
    previousUnitCostCents: null, newUnitCostCents: null, summary: "Synthetic delegated result",
  });
  boundary.rollback.mockResolvedValue({
    adjustment: { ...adjustmentRow(), status: "rolled_back" },
    restored: computeRollback({
      targetType: "geo_factor", targetId: ZONE, previousFactor: 42,
      previousUnitCostCents: null, previousUnitPriceCents: null,
      previousPricingHistoryId: null, capturedAt: NOW.toISOString(),
    }),
  });
  boundary.fromFindings.mockResolvedValue({
    created: [adjustmentRow()], proposals: [],
    skipped: [{ findingKey: "synthetic:skipped", reason: "Unauthorized zone" }],
  });
  boundary.preview.mockResolvedValue(previewAdjustmentImpact({
    adjustmentPct: 5, historicalVolumeCents: 100_000, affectedEstimateCount: 2,
  }));
  boundary.runTenant.mockResolvedValue({
    report: buildCalibrationReport({
      scope: "tenant", period: "all_time", generatedAt: NOW.toISOString(),
      projectCount: 0, totalEstimatedCents: 0, totalActualCents: 0, findings: [],
    }),
    reportId: REPORT, eventIds: [], findingCount: 0, actionableCount: 0, projectCount: 0,
  });
});

describe("G3a-2 real caller authorization and delegation", () => {
  it("propose accepts an authenticated non-admin and forwards trusted tenant and actor", async () => {
    const result = await api.createCaller(context("user")).priceAdjustment.propose(proposalInput);
    expect(result).toEqual(await boundary.propose.mock.results[0].value);
    expect(boundary.propose).toHaveBeenCalledTimes(1);
    expect(boundary.propose).toHaveBeenCalledWith({
      tenantId: TENANT, actorId: ACTOR, ...proposalInput, source: "manual",
      costCodeId: null, costCode: null, assemblyId: null, trade: null,
      effectiveFrom: null, notes: null,
    });
  });

  it.each([
    ["unauthenticated", null, TENANT, "UNAUTHORIZED"],
    ["unresolved tenant", "user", null, "FORBIDDEN"],
  ] as const)("propose rejects %s before delegation", async (_label, role, tenant, code) => {
    await expect(api.createCaller(context(role, tenant)).priceAdjustment.propose(proposalInput))
      .rejects.toMatchObject({ code });
    expectNoFinalOperation();
    expect(reads).toEqual([]);
  });

  it("propose discards client-supplied tenant and actor fields", async () => {
    const wireInput = { ...proposalInput, tenantId: FOREIGN, actorId: FOREIGN };
    await api.createCaller(context("user")).priceAdjustment.propose(wireInput);
    expect(boundary.propose).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, actorId: ACTOR,
    }));
  });

  describe.each(mutationNames)("%s admin boundary", name => {
    it.each([
      ["non-admin", "user", TENANT],
      ["unauthenticated", null, TENANT],
      ["admin without tenant", "admin", null],
    ] as const)("rejects %s before lookup or operation", async (_label, role, tenant) => {
      await expect(invoke(name, context(role, tenant))).rejects.toMatchObject({ code: "FORBIDDEN" });
      expectNoFinalOperation();
      expect(reads).toEqual([]);
    });
  });

  describe.each(["apply", "rollback"] as const)("%s parent ownership", name => {
    it.each([
      ["foreign", FOREIGN], ["NULL-owned", null], ["missing", undefined],
    ] as const)("rejects %s adjustment returned by permissive ID lookup", async (_label, owner) => {
      store.price_adjustments = owner === undefined ? [] : [{ ...adjustmentRow(), tenantId: owner }];
      await expect(invoke(name, context())).rejects.toMatchObject({
        code: "NOT_FOUND", message: "Price adjustment not found.",
      });
      expectNoFinalOperation();
      expect(reads.map(read => read.table)).toEqual(["price_adjustments"]);
    });

    it("forwards only the owned adjustment and trusted actor/tenant", async () => {
      const result = await invoke(name, context());
      const spy = name === "apply" ? boundary.apply : boundary.rollback;
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        adjustmentId: ADJUSTMENT, tenantId: TENANT, actorId: ACTOR,
      }));
      expect(result).toEqual(await spy.mock.results[0].value);
      expect(reads.map(read => read.table)).toEqual(["price_adjustments"]);
    });
  });

  it.each([
    ["foreign", FOREIGN], ["NULL-owned", null], ["missing", undefined],
  ] as const)("proposeFromRun rejects %s report through the real lookup", async (_label, owner) => {
    store.calibration_reports = owner === undefined ? [] : [{ id: REPORT, tenantId: owner }];
    await expect(invoke("fromRun", context())).rejects.toMatchObject({
      code: "NOT_FOUND", message: "Calibration report not found.",
    });
    expectNoFinalOperation();
    expect(reads.map(read => read.table)).toEqual(["calibration_reports"]);
  });

  it("an owned empty report retains the empty partial-result contract", async () => {
    await expect(invoke("fromRun", context())).resolves.toEqual({
      created: [], proposals: [], skipped: [],
    });
    expectNoFinalOperation();
  });

  it("an owned report delegates its findings and preserves mixed results", async () => {
    const findings = validateGeoFactors(Array.from({ length: 12 }, () => ({
      projectId: ADJUSTMENT, geoZoneId: ZONE, configuredFloorPct: 42, realizedGrossProfitPct: 38,
    })));
    expect(findings).toHaveLength(1);
    store.calibration_reports[0].proposedAdjustments = findings;
    const result = await invoke("fromRun", context());
    expect(boundary.fromFindings).toHaveBeenCalledTimes(1);
    expect(boundary.fromFindings).toHaveBeenCalledWith({
      tenantId: TENANT, actorId: ACTOR, sourceReportId: REPORT, findings,
    });
    expect(result).toEqual(await boundary.fromFindings.mock.results[0].value);
  });

  it.each([
    ["foreign", FOREIGN], ["NULL-owned", null], ["missing", undefined],
  ] as const)("preview rejects %s parent without delegating", async (_label, owner) => {
    store.price_adjustments = owner === undefined ? [] : [{ ...adjustmentRow(), tenantId: owner }];
    await expect(api.createCaller(context("user")).priceAdjustment.previewImpact({ adjustmentId: ADJUSTMENT }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expectNoFinalOperation();
  });

  it("preview forwards an owned adjustment and does not query zones at this boundary", async () => {
    const result = await api.createCaller(context("user")).priceAdjustment.previewImpact({
      adjustmentId: ADJUSTMENT, historicalVolumeCents: 100_000,
    });
    expect(boundary.preview).toHaveBeenCalledTimes(1);
    expect(boundary.preview).toHaveBeenCalledWith({
      adjustmentId: ADJUSTMENT, tenantId: TENANT, historicalVolumeCents: 100_000,
      representativeMarginPct: null, costShareOfJob: null,
    });
    expect(result).toEqual(await boundary.preview.mock.results[0].value);
    expect(reads.map(read => read.table)).toEqual(["price_adjustments"]);
  });

  it("runTenant forwards period bounds, trusted identity and the existing return", async () => {
    const result = await api.createCaller(context()).calibration.runTenant({
      period: "all_time", periodStart: "2026-08-01", periodEnd: "2026-08-31",
    });
    expect(boundary.runTenant).toHaveBeenCalledTimes(1);
    expect(boundary.runTenant).toHaveBeenCalledWith({
      tenantId: TENANT, actorId: ACTOR, period: "all_time",
      periodStart: "2026-08-01", periodEnd: "2026-08-31",
    });
    expect(result).toEqual(await boundary.runTenant.mock.results[0].value);
    expect(reads).toEqual([]);
  });

  it.each([
    ["TARGET_NOT_FOUND", "NOT_FOUND"],
    ["ADJUSTMENT_VALIDATION_FAILED", "BAD_REQUEST"],
    ["ROLLBACK_INTEGRITY_FAILED", "INTERNAL_SERVER_ERROR"],
    ["INVALID_ADJUSTMENT_TRANSITION", "CONFLICT"],
  ] as const)("preserves %s error mapping", async (source, expected) => {
    boundary.apply.mockRejectedValueOnce(new PriceAdjustmentError(source, "Synthetic failure"));
    await expect(invoke("apply", context())).rejects.toMatchObject({
      code: expected, message: "Synthetic failure",
    });
  });

  it("rejects an invalid zone UUID at the existing Zod boundary", async () => {
    await expect(api.createCaller(context()).priceAdjustment.propose({
      ...proposalInput, geoZoneId: "not-a-uuid",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectNoFinalOperation();
  });
});
