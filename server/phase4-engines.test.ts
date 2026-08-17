/**
 * PHASE 4 — Pure engine tests
 *
 * Covers the non-negotiable controls introduced by controlled learning and multi-tenant
 * readiness. These tests have no database dependency: they exercise the decision layer that
 * every router and persistence module is required to respect.
 *
 * 1. Calibration: median bias, confidence, damping/capping, geo asymmetry, duration signal.
 * 2. Price adjustments: cap/noise validation, human approval gate, exact rollback.
 * 3. Scope completeness: money-weighted scope gaps and recurring checklist promotion.
 * 4. Tenant provisioning: mandatory flags, upward-only floors, onboarding operating gate.
 */

import { describe, expect, it } from "vitest";

import {
  computeAccuracyScore,
  detectBias,
  detectCostCodeBias,
  detectDurationBias,
  suggestAdjustment,
  validateGeoFactors,
} from "@shared/calibration-engine";
import {
  computeApplication,
  computeRollback,
  evaluateAdjustmentTransition,
  isAdjustmentAllowed,
  previewAdjustmentImpact,
  validateAdjustment,
  verifyRollbackIntegrity,
} from "@shared/price-adjustment-engine";
import {
  buildScopeChecklist,
  detectScopePatterns,
  scoreScopeCompleteness,
} from "@shared/scope-completeness-engine";
import {
  assertTenantCanOperate,
  buildTenantProvisionPlan,
  completeOnboardingStep,
  defaultFeatureFlags,
  evaluateOnboarding,
  resolveEffectiveFloor,
  resolveFeatureFlags,
  validateFlagRemoval,
  validateProfitShieldOverrides,
} from "@shared/tenant-provisioning-engine";
import {
  ADJUSTMENT_DAMPING_FACTOR,
  MAX_ADJUSTMENT_PCT,
  MIN_ADJUSTMENT_PCT,
  TENANT_ONBOARDING_BLOCKING_STEPS,
} from "@shared/domain/phase4-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// 1. LEARNING / CALIBRATION (CL-001 … CL-006)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 4 calibration engine", () => {
  it("CL1: uses the median, not a catastrophic outlier, to identify price bias", () => {
    const bias = detectBias([10, 10, 10, 500]);

    expect(bias.direction).toBe("underestimates");
    expect(bias.medianDeviationPct).toBe(10);
    expect(bias.meanDeviationPct).toBeGreaterThan(100);
    expect(bias.stdDevPct).toBeGreaterThan(200);
  });

  it("CL2: returns inconsistent instead of proposing a price change when direction flips", () => {
    const bias = detectBias([20, -20, 18, -18, 15]);
    const suggestion = suggestAdjustment({ bias, band: "high" });

    expect(bias.direction).toBe("inconsistent");
    expect(suggestion.adjustmentPct).toBe(0);
    expect(suggestion.rationale).toMatch(/scope or execution/i);
  });

  it("CL3: requires at least three closed samples before a price finding is actionable", () => {
    const findings = detectCostCodeBias(
      [
        { projectId: "p-1", costCode: "06-100", estimatedCents: 10_000, actualCents: 11_000 },
        { projectId: "p-2", costCode: "06-100", estimatedCents: 10_000, actualCents: 11_200 },
      ],
      { period: "quarter" },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence.band).toBe("insufficient");
    expect(findings[0].actionable).toBe(false);
    expect(findings[0].suggestion.adjustmentPct).toBe(0);
  });

  it("CL4: dampens and caps a strong cost-code finding before it becomes actionable", () => {
    const findings = detectCostCodeBias(
      [
        { projectId: "p-1", costCode: "06-200", estimatedCents: 10_000, actualCents: 20_000 },
        { projectId: "p-2", costCode: "06-200", estimatedCents: 10_000, actualCents: 19_000 },
        { projectId: "p-3", costCode: "06-200", estimatedCents: 10_000, actualCents: 21_000 },
        { projectId: "p-4", costCode: "06-200", estimatedCents: 10_000, actualCents: 20_000 },
        { projectId: "p-5", costCode: "06-200", estimatedCents: 10_000, actualCents: 20_000 },
        { projectId: "p-6", costCode: "06-200", estimatedCents: 10_000, actualCents: 19_000 },
      ],
      { period: "all_time" },
    );

    const finding = findings[0];
    expect(finding.bias.direction).toBe("underestimates");
    expect(finding.confidence.band).toMatch(/medium|high/);
    expect(finding.actionable).toBe(true);
    expect(finding.suggestion.capped).toBe(true);
    expect(finding.suggestion.adjustmentPct).toBe(MAX_ADJUSTMENT_PCT);
  });

  it("CL5: drops adjustments below the noise floor after damping", () => {
    const bias = detectBias([3, 3, 3, 3, 3, 3]);
    const suggestion = suggestAdjustment({ bias, band: "high" });

    expect(3 * ADJUSTMENT_DAMPING_FACTOR).toBeLessThan(MIN_ADJUSTMENT_PCT);
    expect(suggestion.belowNoiseFloor).toBe(true);
    expect(suggestion.adjustmentPct).toBe(0);
  });

  it("CL6: raises an unsafe coastal floor only after consistent realized shortfall", () => {
    const findings = validateGeoFactors([
      { projectId: "p-1", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 38 },
      { projectId: "p-2", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 37 },
      { projectId: "p-3", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 38 },
      { projectId: "p-4", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 38 },
      { projectId: "p-5", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 37 },
      { projectId: "p-6", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 38 },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].actionable).toBe(true);
    expect(findings[0].observedFactor).toBe(42);
    expect(findings[0].suggestedFactor).toBe(46);
  });

  it("CL7: never lowers a protective floor simply because recent jobs over-delivered", () => {
    const [finding] = validateGeoFactors([
      { projectId: "p-1", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 49 },
      { projectId: "p-2", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 48 },
      { projectId: "p-3", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 50 },
      { projectId: "p-4", geoRiskClass: "coastal", configuredFloorPct: 42, realizedGrossProfitPct: 49 },
    ]);

    expect(finding.actionable).toBe(false);
    expect(finding.suggestedFactor).toBe(42);
    expect(finding.recommendation).toMatch(/keep the floor/i);
  });

  it("CL8: reports duration in days and detects a trade that consistently runs long", () => {
    const [finding] = detectDurationBias([
      { projectId: "p-1", trade: "drywall", plannedDays: 4, actualDays: 6 },
      { projectId: "p-2", trade: "drywall", plannedDays: 4, actualDays: 6 },
      { projectId: "p-3", trade: "drywall", plannedDays: 4, actualDays: 5.5 },
      { projectId: "p-4", trade: "drywall", plannedDays: 4, actualDays: 6 },
    ]);

    expect(finding.eventType).toBe("duration_accuracy");
    expect(finding.bias.direction).toBe("underestimates");
    expect(finding.durationVarianceDays).toBeGreaterThan(0);
    expect(finding.recommendation).toMatch(/Plan drywall/i);
  });

  it("CL9: penalizes under-estimation harder than an equal over-estimation", () => {
    const overrun = computeAccuracyScore({
      totalEstimatedCents: 100_000,
      totalActualCents: 110_000,
    });
    const underrun = computeAccuracyScore({
      totalEstimatedCents: 100_000,
      totalActualCents: 90_000,
    });

    expect(overrun).toBeLessThan(underrun);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. PRICE ADJUSTMENTS (PA-001 … PA-005)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 4 price adjustment engine", () => {
  const target = {
    targetType: "cost_code" as const,
    costCodeId: "cc-framing",
    reason: "Six closed jobs show framing labor consistently over budget.",
  };

  it("PA1: blocks a change beyond the hard ±25% cap and warns on price noise", () => {
    const capViolations = validateAdjustment({ ...target, adjustmentPct: 26, source: "manual" });
    const noiseViolations = validateAdjustment({ ...target, adjustmentPct: 1.5, source: "manual" });

    expect(isAdjustmentAllowed(capViolations)).toBe(false);
    expect(capViolations.some(v => v.rule === "PA-001" && v.severity === "block")).toBe(true);
    expect(isAdjustmentAllowed(noiseViolations)).toBe(true);
    expect(noiseViolations.some(v => v.severity === "warn")).toBe(true);
  });

  it("PA2: rejects a machine proposal below the confidence threshold and duplicate live target", () => {
    const violations = validateAdjustment({
      ...target,
      adjustmentPct: 8,
      source: "calibration",
      confidenceBand: "low",
      hasLiveAdjustment: true,
    });

    expect(isAdjustmentAllowed(violations)).toBe(false);
    expect(violations.some(v => v.rule === "PA-002" && v.field === "confidenceBand")).toBe(true);
    expect(violations.some(v => v.rule === "PA-005")).toBe(true);
  });

  it("PA3: cannot apply without prior human approval and a rollback snapshot", () => {
    const direct = evaluateAdjustmentTransition({
      from: "proposed",
      to: "applied",
      actorId: "owner-1",
    });
    const approvedWithoutSnapshot = evaluateAdjustmentTransition({
      from: "approved",
      to: "applied",
      actorId: "owner-1",
    });

    expect(direct.allowed).toBe(false);
    expect(direct.violations.some(v => v.rule === "PA-002")).toBe(true);
    expect(approvedWithoutSnapshot.allowed).toBe(false);
    expect(approvedWithoutSnapshot.violations.some(v => v.rule === "PA-004")).toBe(true);
  });

  it("PA4: application moves integer-cent cost and sell price together, then rollback restores exactly", () => {
    const applied = computeApplication({
      targetType: "cost_code",
      targetId: "cc-framing",
      adjustmentPct: 12.5,
      currentUnitCostCents: 10_003,
      currentUnitPriceCents: 16_671,
      currentPricingHistoryId: "price-v4",
      capturedAt: "2026-08-13T00:00:00.000Z",
    });

    expect(applied.newUnitCostCents).toBe(Math.round(10_003 * 1.125));
    expect(applied.newUnitPriceCents).toBe(Math.round(16_671 * 1.125));

    const restored = computeRollback(applied.snapshot);
    expect(restored).toEqual({
      unitCostCents: 10_003,
      unitPriceCents: 16_671,
      factor: null,
      pricingHistoryId: "price-v4",
    });
    expect(
      verifyRollbackIntegrity({
        snapshot: applied.snapshot,
        restoredUnitCostCents: restored.unitCostCents,
      }),
    ).toEqual({ intact: true, issues: [] });
  });

  it("PA5: reports a rollback mismatch instead of pretending restored cents are correct", () => {
    const applied = computeApplication({
      targetType: "cost_code",
      targetId: "cc-trim",
      adjustmentPct: -7,
      currentUnitCostCents: 9_999,
      capturedAt: "2026-08-13T00:00:00.000Z",
    });

    const integrity = verifyRollbackIntegrity({
      snapshot: applied.snapshot,
      restoredUnitCostCents: 10_000,
    });

    expect(integrity.intact).toBe(false);
    expect(integrity.issues[0]).toMatch(/does not match/i);
  });

  it("PA6: preview quantifies dollars and margin points before approval", () => {
    const preview = previewAdjustmentImpact({
      adjustmentPct: 10,
      historicalVolumeCents: 250_000_00,
      representativeMarginPct: 42,
      costShareOfJob: 0.3,
      affectedEstimateCount: 14,
    });

    expect(preview.annualImpactCents).toBe(25_000_00);
    expect(preview.marginImpactPp).toBe(-1.7);
    expect(preview.affectedEstimateCount).toBe(14);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. SCOPE COMPLETENESS (SC4-001 … SC4-003)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 4 scope completeness engine", () => {
  it("SC1: calculates a money-weighted score and reports unplanned cost separately", () => {
    const result = scoreScopeCompleteness({
      projectId: "proj-bath-1",
      projectType: "bathroom_remodel",
      commercialChannel: "premium",
      planned: [
        { costCode: "06-100", costCodeName: "Framing", estimatedCents: 100_000 },
        { costCode: "09-300", costCodeName: "Tile", estimatedCents: 30_000 },
      ],
      executed: [
        { costCode: "06-100", actualCents: 100_000 },
        { costCode: "22-100", costCodeName: "Plumbing", actualCents: 20_000 },
      ],
    });

    expect(result.score).toBe(83.3);
    expect(result.verdict).toBe("material_gaps");
    expect(result.unplannedCostCents).toBe(20_000);
    expect(result.unexecutedCostCents).toBe(30_000);
    expect(result.missingItems[0].costCode).toBe("22-100");
  });

  it("SC2: credits work captured by an approved change order rather than penalizing it", () => {
    const result = scoreScopeCompleteness({
      projectId: "proj-bath-2",
      projectType: "bathroom_remodel",
      commercialChannel: "premium",
      planned: [{ costCode: "06-100", estimatedCents: 100_000 }],
      executed: [
        { costCode: "06-100", actualCents: 100_000 },
        { costCode: "22-100", actualCents: 20_000, fromChangeOrder: true },
      ],
    });

    expect(result.unplannedCostCents).toBe(20_000);
    expect(result.changeOrderCoveredCents).toBe(20_000);
    expect(result.score).toBe(100);
    expect(result.summary).toMatch(/caught and sold/i);
  });

  it("SC3: promotes a repeated omission only at both occurrence and frequency thresholds", () => {
    const patterns = detectScopePatterns([
      {
        projectId: "p-1",
        projectType: "bathroom_remodel",
        missingItems: [{ costCode: "22-100", actualCents: 16_000 }],
      },
      {
        projectId: "p-2",
        projectType: "bathroom_remodel",
        missingItems: [{ costCode: "22-100", actualCents: 18_000 }],
      },
      { projectId: "p-3", projectType: "bathroom_remodel", missingItems: [] },
      { projectId: "p-4", projectType: "bathroom_remodel", missingItems: [] },
      {
        projectId: "p-5",
        projectType: "kitchen_remodel",
        missingItems: [{ costCode: "22-100", actualCents: 22_000 }],
      },
    ]);

    const bathroom = patterns.find(p => p.projectType === "bathroom_remodel");
    const kitchen = patterns.find(p => p.projectType === "kitchen_remodel");

    expect(bathroom?.frequency).toBe(0.5);
    expect(bathroom?.occurrenceCount).toBe(2);
    expect(bathroom?.isRecurring).toBe(true);
    expect(kitchen?.isRecurring).toBe(false);

    const checklist = buildScopeChecklist(patterns, "bathroom_remodel");
    expect(checklist.items).toHaveLength(1);
    expect(checklist.summary).toMatch(/routinely missed/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. MULTI-TENANT PROVISIONING (MT-001 … MT-004)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 4 tenant provisioning engine", () => {
  it("MT1: re-adds mandatory feature flags and dependency closure while surfacing typos", () => {
    const result = resolveFeatureFlags(["price_adjustments", "not_a_real_module"]);

    expect(result.unknown).toEqual(["not_a_real_module"]);
    expect(result.flags).toContain("profit_shield");
    expect(result.flags).toContain("calibration");
    expect(result.flags).toContain("actuals_ledger");
    expect(result.violations.some(v => v.severity === "block")).toBe(true);
  });

  it("MT2: refuses to remove a mandatory module or a module that a live feature depends on", () => {
    const defaults = defaultFeatureFlags();
    const mandatory = validateFlagRemoval({ currentFlags: defaults, flagToRemove: "profit_shield" });
    const dependency = validateFlagRemoval({
      currentFlags: ["price_adjustments"],
      flagToRemove: "calibration",
    });

    expect(mandatory.some(v => v.severity === "block")).toBe(true);
    expect(dependency.some(v => v.message.includes("depends on calibration"))).toBe(true);
  });

  it("MT3: composes margin floors upward and rejects a weak coastal override", () => {
    const floor = resolveEffectiveFloor({
      channel: "premium",
      geoRiskClass: "coastal",
      tenantOverridePct: 20,
      tenantGeoOverridePct: 35,
    });

    expect(floor.floorPct).toBe(42);
    expect(floor.source).toBe("geo");
    expect(floor.overrideRejected).toBe(true);
    expect(floor.rationale).toMatch(/upward only/i);

    const warnings = validateProfitShieldOverrides({ premium: 20, trade: "bad" });
    expect(warnings.some(v => v.severity === "warn")).toBe(true);
    expect(warnings.some(v => v.severity === "block")).toBe(true);
  });

  it("MT4: blocks commercial operation until every blocking onboarding step is complete", () => {
    const initial = evaluateOnboarding({
      tenant_created: { completed: true, completedAt: "2026-08-13T00:00:00.000Z" },
    });

    expect(initial.canOperate).toBe(false);
    // tenant_created is already complete, so the first remaining blocking step is next.
    expect(initial.nextStep).toBe(initial.blockingSteps[0]);
    expect(assertTenantCanOperate({ tenant_created: { completed: true } }).length).toBeGreaterThan(0);

    let steps = { tenant_created: { completed: true } };
    for (const step of TENANT_ONBOARDING_BLOCKING_STEPS) {
      steps = completeOnboardingStep(steps, {
        step,
        completedAt: "2026-08-13T00:00:00.000Z",
        completedBy: "owner-1",
      }).steps as typeof steps;
    }

    const ready = evaluateOnboarding(steps);
    expect(ready.canOperate).toBe(true);
    expect(assertTenantCanOperate(steps)).toEqual([]);
  });

  it("MT5: a new demo tenant is intentionally incomplete and cannot auto-apply adjustments", () => {
    const plan = buildTenantProvisionPlan({
      tenantName: "Demo Coastal GC",
      slug: "Demo Coastal GC!",
      defaultGeoRiskClass: "coastal",
      isDemo: true,
      createdAt: "2026-08-13T00:00:00.000Z",
    });

    expect(plan.slug).toBe("demo-coastal-gc");
    expect(plan.settings.isDemo).toBe(true);
    expect(plan.settings.autoApplyAdjustments).toBe(false);
    expect(plan.onboarding.canOperate).toBe(false);
    expect(plan.effectiveFloors.premium.floorPct).toBe(42);
  });
});

/**
 * Meta-guard: the test file itself should make the cap visible. A future change that removes the
 * cap from taxonomy without updating the controls must fail this expectation during review.
 */
describe("PHASE 4 hard guard constants", () => {
  it("keeps the published one-step repricing cap at 25%", () => {
    expect(MAX_ADJUSTMENT_PCT).toBe(25);
  });
});

// Keep this direct import meaningful in case the taxonomy is later reorganized.
void ADJUSTMENT_DAMPING_FACTOR;
void MIN_ADJUSTMENT_PCT;
