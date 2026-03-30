/**
 * structr.ai — Sprint 12: Scope Builder Engine Tests
 * ═══════════════════════════════════════════════════════════════
 *
 * Comprehensive test coverage for the deterministic Scope Builder Engine.
 *
 * Test sections:
 *   1. parseArea() — area string parsing
 *   2. buildFormulaContext() — formula context construction
 *   3. evaluateQuantityFormula() — quantity formula evaluation
 *   4. safeEvaluateArithmetic() — arithmetic parser
 *   5. matchRule() — single rule matching
 *   6. matchRules() — multi-rule matching + deduplication
 *   7. evaluateConditions() — condition JSON evaluation
 *   8. generateGeoWarnings() — geographic warning generation
 *   9. validateIntakeForScope() — intake validation
 *  10. generateScopeDraft() — full pipeline
 *  11. convertScopeToBundle() — bundle conversion
 *  12. Confidence scoring — item + draft confidence
 *  13. Reason template interpolation
 *  14. Seed data integrity
 *  15. Edge cases + regression guards
 */

import { describe, it, expect } from "vitest";
import {
  parseArea,
  buildFormulaContext,
  evaluateQuantityFormula,
  safeEvaluateArithmetic,
  matchRule,
  matchRules,
  evaluateConditions,
  generateGeoWarnings,
  validateIntakeForScope,
  generateScopeDraft,
  convertScopeToBundle,
  DEFAULT_WASTE_FACTOR,
  LUXURY_COMPLEXITY_MULTIPLIER,
  DEFAULT_AREA_SQFT,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
  COASTAL_WARNING_THRESHOLD,
  COASTAL_ZONES,
  type ScopeRuleData,
  type ScopeIntakeData,
  type ScopeProjectContext,
  type ScopeAssemblyRef,
  type FormulaContext,
  type ScopeDraftOutput,
} from "../shared/scope-engine";
import { ALL_SCOPE_RULES, RULE_COUNTS } from "../shared/scope-rules-seed";
import type { ScopeRuleCondition } from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ══════════════════════════════════════════════════════════════════════

/** Factory for a minimal scope rule */
function makeRule(overrides: Partial<ScopeRuleData> = {}): ScopeRuleData {
  return {
    id: 1,
    ruleCode: "TEST-001",
    serviceType: "kitchen_remodel",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: 30060,
    quantityFormula: "1",
    reasonTemplate: "Test rule for {{service_type}}.",
    priority: 100,
    active: true,
    ...overrides,
  };
}

/** Factory for intake data */
function makeIntake(overrides: Partial<ScopeIntakeData> = {}): ScopeIntakeData {
  return {
    serviceType: "kitchen_remodel",
    area: "200",
    finishLevel: "standard",
    condition: "full_gut",
    channel: "direct",
    notes: null,
    ...overrides,
  };
}

/** Factory for project context */
function makeProject(overrides: Partial<ScopeProjectContext> = {}): ScopeProjectContext {
  return {
    projectType: "remodel",
    zone: "Charleston Metro",
    zipCode: "29407",
    channel: "direct",
    zoneModifierSnapshot: {
      zoneId: 2,
      zoneName: "Charleston Metro",
      laborModifier: 1.05,
      logisticsModifier: 1.0,
      materialModifier: 1.05,
      contingencyPct: 0.0,
      minProfitShieldPct: 35.0,
      coastalExposureLevel: "moderate",
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

/** Factory for assembly ref */
function makeAssembly(overrides: Partial<ScopeAssemblyRef> = {}): ScopeAssemblyRef {
  return {
    id: 30060,
    code: "KIT-DEMO-001",
    name: "Kitchen Demo — Full Gut",
    category: "kitchen",
    trade: "demolition",
    finishLevel: "standard",
    defaultUnit: "EA",
    coastalModifier: null,
    ...overrides,
  };
}

/** Factory for formula context */
function makeFormulaCtx(overrides: Partial<FormulaContext> = {}): FormulaContext {
  return {
    area: 200,
    rooms: 2,
    units: 14,
    length: 14.14,
    width: 14.14,
    height: 8,
    wasteFactor: 1.1,
    luxuryMultiplier: 1.0,
    ...overrides,
  };
}

/** Barrier Island snapshot for coastal tests */
const BARRIER_ISLAND_SNAPSHOT = {
  zoneId: 1,
  zoneName: "Barrier Island Premium",
  laborModifier: 1.25,
  logisticsModifier: 1.35,
  materialModifier: 1.20,
  contingencyPct: 5.0,
  minProfitShieldPct: 45.0,
  coastalExposureLevel: "extreme",
  capturedAt: "2026-01-01T00:00:00.000Z",
};

/** Charleston Coastal snapshot */
const COASTAL_SNAPSHOT = {
  zoneId: 3,
  zoneName: "Charleston Coastal",
  laborModifier: 1.15,
  logisticsModifier: 1.20,
  materialModifier: 1.15,
  contingencyPct: 3.0,
  minProfitShieldPct: 42.0,
  coastalExposureLevel: "high",
  capturedAt: "2026-01-01T00:00:00.000Z",
};

/** Summerville snapshot (inland) */
const SUMMERVILLE_SNAPSHOT = {
  zoneId: 4,
  zoneName: "Summerville / Goose Creek",
  laborModifier: 1.0,
  logisticsModifier: 1.0,
  materialModifier: 1.0,
  contingencyPct: 0.0,
  minProfitShieldPct: 35.0,
  coastalExposureLevel: "none",
  capturedAt: "2026-01-01T00:00:00.000Z",
};

// ══════════════════════════════════════════════════════════════════════
// 1. parseArea()
// ══════════════════════════════════════════════════════════════════════

describe("parseArea()", () => {
  it("returns DEFAULT_AREA_SQFT for null/undefined/empty", () => {
    expect(parseArea(null)).toBe(DEFAULT_AREA_SQFT);
    expect(parseArea(undefined)).toBe(DEFAULT_AREA_SQFT);
    expect(parseArea("")).toBe(DEFAULT_AREA_SQFT);
  });

  it("parses plain numeric strings", () => {
    expect(parseArea("200")).toBe(200);
    expect(parseArea("1500")).toBe(1500);
    expect(parseArea("0")).toBe(0);
  });

  it("parses numeric with unit suffix", () => {
    expect(parseArea("200 sqft")).toBe(200);
    expect(parseArea("350 sq ft")).toBe(350);
    expect(parseArea("100sqft")).toBe(100);
  });

  it("parses dimension format (LxW)", () => {
    expect(parseArea("10x20")).toBe(200);
    expect(parseArea("12 x 15")).toBe(180);
    expect(parseArea("10X20")).toBe(200);
    expect(parseArea("10×20")).toBe(200);
  });

  it("handles decimal values", () => {
    expect(parseArea("10.5x20")).toBe(210);
    expect(parseArea("15.5")).toBe(15.5);
  });

  it("returns DEFAULT_AREA_SQFT for non-numeric strings", () => {
    expect(parseArea("large kitchen")).toBe(DEFAULT_AREA_SQFT);
  });

  it("handles whitespace-padded input", () => {
    expect(parseArea("  200  ")).toBe(200);
    expect(parseArea("  10 x 20  ")).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. buildFormulaContext()
// ══════════════════════════════════════════════════════════════════════

describe("buildFormulaContext()", () => {
  it("builds context from intake with area", () => {
    const ctx = buildFormulaContext(makeIntake({ area: "200" }), makeProject());
    expect(ctx.area).toBe(200);
    expect(ctx.rooms).toBe(2); // ceil(200/150)
    expect(ctx.units).toBe(14); // ceil(200/15)
    expect(ctx.height).toBe(8);
    expect(ctx.wasteFactor).toBe(DEFAULT_WASTE_FACTOR);
    expect(ctx.luxuryMultiplier).toBe(1.0);
  });

  it("applies luxury multiplier for luxury finish level", () => {
    const ctx = buildFormulaContext(makeIntake({ finishLevel: "luxury" }), makeProject());
    expect(ctx.luxuryMultiplier).toBe(LUXURY_COMPLEXITY_MULTIPLIER);
  });

  it("does not apply luxury multiplier for standard/premium", () => {
    const ctxStd = buildFormulaContext(makeIntake({ finishLevel: "standard" }), makeProject());
    expect(ctxStd.luxuryMultiplier).toBe(1.0);

    const ctxPrm = buildFormulaContext(makeIntake({ finishLevel: "premium" }), makeProject());
    expect(ctxPrm.luxuryMultiplier).toBe(1.0);
  });

  it("uses custom waste factor when provided", () => {
    const ctx = buildFormulaContext(makeIntake(), makeProject(), 1.15);
    expect(ctx.wasteFactor).toBe(1.15);
  });

  it("uses DEFAULT_WASTE_FACTOR when waste factor not provided", () => {
    const ctx = buildFormulaContext(makeIntake(), makeProject());
    expect(ctx.wasteFactor).toBe(DEFAULT_WASTE_FACTOR);
  });

  it("uses default area when intake area is null", () => {
    const ctx = buildFormulaContext(makeIntake({ area: null }), makeProject());
    expect(ctx.area).toBe(DEFAULT_AREA_SQFT);
  });

  it("computes length/width as sqrt of area", () => {
    const ctx = buildFormulaContext(makeIntake({ area: "400" }), makeProject());
    expect(ctx.length).toBe(20);
    expect(ctx.width).toBe(20);
  });

  it("ensures minimum 1 room and 1 unit", () => {
    const ctx = buildFormulaContext(makeIntake({ area: "10" }), makeProject());
    expect(ctx.rooms).toBeGreaterThanOrEqual(1);
    expect(ctx.units).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. evaluateQuantityFormula()
// ══════════════════════════════════════════════════════════════════════

describe("evaluateQuantityFormula()", () => {
  const ctx = makeFormulaCtx({ area: 200, rooms: 2, units: 14, wasteFactor: 1.1, luxuryMultiplier: 1.0 });

  it("evaluates fixed quantity '1'", () => {
    expect(evaluateQuantityFormula("1", ctx)).toBe(1);
  });

  it("evaluates area-based formula", () => {
    expect(evaluateQuantityFormula("area / 100", ctx)).toBe(2);
  });

  it("evaluates area with waste factor", () => {
    const result = evaluateQuantityFormula("area * waste_factor", ctx);
    expect(result).toBeCloseTo(220); // 200 * 1.1
  });

  it("evaluates area with luxury multiplier", () => {
    const luxCtx = makeFormulaCtx({ area: 200, luxuryMultiplier: 1.15 });
    const result = evaluateQuantityFormula("area * luxury_multiplier", luxCtx);
    expect(result).toBeCloseTo(230); // 200 * 1.15
  });

  it("evaluates ceil() function", () => {
    expect(evaluateQuantityFormula("ceil(area / 40)", ctx)).toBe(5); // ceil(200/40) = 5
  });

  it("evaluates ceil() with luxury multiplier", () => {
    const luxCtx = makeFormulaCtx({ area: 200, luxuryMultiplier: 1.15 });
    const result = evaluateQuantityFormula("ceil(area / 40) * luxury_multiplier", luxCtx);
    expect(result).toBeCloseTo(5.75); // ceil(5) * 1.15 = 5.75
  });

  it("evaluates rooms variable", () => {
    expect(evaluateQuantityFormula("rooms", ctx)).toBe(2);
  });

  it("evaluates units variable", () => {
    expect(evaluateQuantityFormula("units", ctx)).toBe(14);
  });

  it("evaluates perimeter formula", () => {
    const sqCtx = makeFormulaCtx({ length: 10, width: 15 });
    const result = evaluateQuantityFormula("length * 2 + width * 2", sqCtx);
    expect(result).toBe(50);
  });

  it("evaluates floor() function", () => {
    expect(evaluateQuantityFormula("floor(area / 30)", ctx)).toBe(6); // floor(6.66) = 6
  });

  it("evaluates round() function", () => {
    expect(evaluateQuantityFormula("round(area / 30)", ctx)).toBe(7); // round(6.66) = 7
  });

  it("evaluates max() function", () => {
    expect(evaluateQuantityFormula("max(1, area / 100)", ctx)).toBe(2); // max(1, 2) = 2
    expect(evaluateQuantityFormula("max(5, area / 100)", ctx)).toBe(5); // max(5, 2) = 5
  });

  it("evaluates min() function", () => {
    expect(evaluateQuantityFormula("min(10, area / 100)", ctx)).toBe(2); // min(10, 2) = 2
    expect(evaluateQuantityFormula("min(1, area / 100)", ctx)).toBe(1); // min(1, 2) = 1
  });

  it("returns minimum quantity of 1 for zero/negative results", () => {
    expect(evaluateQuantityFormula("0", ctx)).toBe(1);
    expect(evaluateQuantityFormula("-5", ctx)).toBe(1);
  });

  it("returns 1 for empty/null formula", () => {
    expect(evaluateQuantityFormula("", ctx)).toBe(1);
  });

  it("evaluates complex combined formula", () => {
    const result = evaluateQuantityFormula("ceil(area / 100) * waste_factor", ctx);
    expect(result).toBeCloseTo(2.2); // ceil(2) * 1.1 = 2.2
  });

  it("evaluates height variable", () => {
    expect(evaluateQuantityFormula("height", ctx)).toBe(8);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. safeEvaluateArithmetic()
// ══════════════════════════════════════════════════════════════════════

describe("safeEvaluateArithmetic()", () => {
  it("evaluates basic addition", () => {
    expect(safeEvaluateArithmetic("2 + 3")).toBe(5);
  });

  it("evaluates basic subtraction", () => {
    expect(safeEvaluateArithmetic("10 - 3")).toBe(7);
  });

  it("evaluates multiplication", () => {
    expect(safeEvaluateArithmetic("4 * 5")).toBe(20);
  });

  it("evaluates division", () => {
    expect(safeEvaluateArithmetic("20 / 4")).toBe(5);
  });

  it("handles division by zero", () => {
    expect(safeEvaluateArithmetic("10 / 0")).toBe(1);
  });

  it("respects operator precedence", () => {
    expect(safeEvaluateArithmetic("2 + 3 * 4")).toBe(14);
  });

  it("handles parentheses", () => {
    expect(safeEvaluateArithmetic("(2 + 3) * 4")).toBe(20);
  });

  it("handles nested parentheses", () => {
    expect(safeEvaluateArithmetic("((2 + 3) * (4 + 1))")).toBe(25);
  });

  it("handles decimal numbers", () => {
    expect(safeEvaluateArithmetic("1.5 * 2")).toBe(3);
  });

  it("handles unary minus", () => {
    expect(safeEvaluateArithmetic("-5 + 10")).toBe(5);
  });

  it("returns 1 for invalid expressions", () => {
    expect(safeEvaluateArithmetic("abc")).toBe(1);
    expect(safeEvaluateArithmetic("2 + abc")).toBe(1);
  });

  it("handles whitespace", () => {
    expect(safeEvaluateArithmetic("  2  +  3  ")).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. matchRule() — Single Rule Matching
// ══════════════════════════════════════════════════════════════════════

describe("matchRule()", () => {
  it("matches when service type matches exactly", () => {
    const rule = makeRule({ serviceType: "kitchen_remodel" });
    const intake = makeIntake({ serviceType: "kitchen_remodel" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(true);
    expect(result.matchScore).toBeGreaterThanOrEqual(1);
  });

  it("rejects when service type does not match", () => {
    const rule = makeRule({ serviceType: "kitchen_remodel" });
    const intake = makeIntake({ serviceType: "bathroom_remodel" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(false);
    expect(result.matchScore).toBe(0);
  });

  it("increases score when finish level matches", () => {
    const ruleWithFinish = makeRule({ finishLevel: "standard" });
    const ruleNoFinish = makeRule({ finishLevel: null });
    const intake = makeIntake({ finishLevel: "standard" });

    const withFinish = matchRule(ruleWithFinish, intake, makeProject());
    const noFinish = matchRule(ruleNoFinish, intake, makeProject());

    expect(withFinish.matchScore).toBeGreaterThan(noFinish.matchScore);
  });

  it("rejects when finish level does not match", () => {
    const rule = makeRule({ finishLevel: "luxury" });
    const intake = makeIntake({ finishLevel: "standard" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("Finish level mismatch");
  });

  it("increases score when project type matches", () => {
    const rule = makeRule({ projectType: "remodel" });
    const intake = makeIntake();
    const project = makeProject({ projectType: "remodel" });

    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
    expect(result.matchScore).toBeGreaterThanOrEqual(2);
  });

  it("rejects when project type does not match", () => {
    const rule = makeRule({ projectType: "remodel" });
    const project = makeProject({ projectType: "new_construction" });
    const result = matchRule(rule, makeIntake(), project);

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("Project type mismatch");
  });

  it("increases score when channel matches", () => {
    const rule = makeRule({ channel: "direct" });
    const intake = makeIntake({ channel: "direct" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(true);
    expect(result.matchScore).toBeGreaterThanOrEqual(2);
  });

  it("rejects when channel does not match", () => {
    const rule = makeRule({ channel: "insurance" });
    const intake = makeIntake({ channel: "direct" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("Channel mismatch");
  });

  it("increases score significantly when zone matches", () => {
    const rule = makeRule({ zone: "Charleston Metro" });
    const project = makeProject({ zone: "Charleston Metro" });
    const result = matchRule(rule, makeIntake(), project);

    expect(result.matched).toBe(true);
    // Zone match adds 3 to score
    expect(result.matchScore).toBeGreaterThanOrEqual(4);
  });

  it("rejects when zone does not match", () => {
    const rule = makeRule({ zone: "Barrier Island Premium" });
    const project = makeProject({ zone: "Charleston Metro" });
    const result = matchRule(rule, makeIntake(), project);

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("Zone mismatch");
  });

  it("matches rule with condition_json (eq operator)", () => {
    const rule = makeRule({
      conditionJson: [{ field: "condition", op: "eq", value: "full_gut" }],
    });
    const intake = makeIntake({ condition: "full_gut" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(true);
  });

  it("rejects when condition_json fails", () => {
    const rule = makeRule({
      conditionJson: [{ field: "condition", op: "eq", value: "full_gut" }],
    });
    const intake = makeIntake({ condition: "partial" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("Condition failed");
  });

  it("skips inactive rules in matchRules", () => {
    const rule = makeRule({ active: false });
    const rules = [rule];
    const results = matchRules(rules, makeIntake(), makeProject());

    expect(results.length).toBe(0);
  });

  it("normalizes service type aliases for matching", () => {
    // "Kitchen Remodel" should normalize to "kitchen_remodel"
    const rule = makeRule({ serviceType: "kitchen_remodel" });
    const intake = makeIntake({ serviceType: "kitchen_remodel" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(true);
  });

  it("interpolates reason template with intake values", () => {
    const rule = makeRule({
      reasonTemplate: "{{service_type}} in {{zone}} at {{finish_level}} level.",
    });
    const intake = makeIntake({ serviceType: "kitchen_remodel", finishLevel: "standard" });
    const project = makeProject({ zone: "Charleston Metro" });
    const result = matchRule(rule, intake, project);

    expect(result.matched).toBe(true);
    expect(result.reason).toContain("Charleston Metro");
    expect(result.reason).toContain("standard");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. matchRules() — Multi-Rule Matching + Deduplication
// ══════════════════════════════════════════════════════════════════════

describe("matchRules()", () => {
  it("returns only matched rules", () => {
    const rules = [
      makeRule({ id: 1, serviceType: "kitchen_remodel" }),
      makeRule({ id: 2, serviceType: "bathroom_remodel", assemblyId: 30070 }),
      makeRule({ id: 3, serviceType: "kitchen_remodel", assemblyId: 30061 }),
    ];
    const intake = makeIntake({ serviceType: "kitchen_remodel" });
    const results = matchRules(rules, intake, makeProject());

    expect(results.length).toBe(2);
    expect(results.every(r => r.matched)).toBe(true);
  });

  it("sorts by priority (ascending) then matchScore (descending)", () => {
    const rules = [
      makeRule({ id: 1, priority: 50, assemblyId: 30060 }),
      makeRule({ id: 2, priority: 10, assemblyId: 30061 }),
      makeRule({ id: 3, priority: 50, finishLevel: "standard", assemblyId: 30062 }),
    ];
    const intake = makeIntake({ finishLevel: "standard" });
    const results = matchRules(rules, intake, makeProject());

    // Priority 10 should come first
    expect(results[0].rule.id).toBe(2);
  });

  it("deduplicates by assemblyId — keeps highest matchScore", () => {
    const rules = [
      makeRule({ id: 1, assemblyId: 30060, finishLevel: null, priority: 100 }),
      makeRule({ id: 2, assemblyId: 30060, finishLevel: "standard", priority: 100 }),
    ];
    const intake = makeIntake({ finishLevel: "standard" });
    const results = matchRules(rules, intake, makeProject());

    // Both match assemblyId 30060, but rule 2 has higher score (finish match)
    expect(results.length).toBe(1);
    expect(results[0].rule.id).toBe(2);
  });

  it("returns empty array when no rules match", () => {
    const rules = [
      makeRule({ serviceType: "roofing" }),
    ];
    const intake = makeIntake({ serviceType: "kitchen_remodel" });
    const results = matchRules(rules, intake, makeProject());

    expect(results.length).toBe(0);
  });

  it("filters out inactive rules", () => {
    const rules = [
      makeRule({ id: 1, active: true, assemblyId: 30060 }),
      makeRule({ id: 2, active: false, assemblyId: 30061 }),
    ];
    const results = matchRules(rules, makeIntake(), makeProject());

    expect(results.length).toBe(1);
    expect(results[0].rule.id).toBe(1);
  });

  it("handles multiple assemblies from same trade", () => {
    const rules = [
      makeRule({ id: 1, assemblyId: 30060, ruleCode: "KIT-DEMO" }),
      makeRule({ id: 2, assemblyId: 30061, ruleCode: "KIT-CAB" }),
      makeRule({ id: 3, assemblyId: 30063, ruleCode: "KIT-CTR" }),
    ];
    const results = matchRules(rules, makeIntake(), makeProject());

    expect(results.length).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. evaluateConditions()
// ══════════════════════════════════════════════════════════════════════

describe("evaluateConditions()", () => {
  it("passes when all conditions match (AND logic)", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "eq", value: "full_gut" },
      { field: "finish_level", op: "eq", value: "standard" },
    ];
    const result = evaluateConditions(conditions, makeIntake(), makeProject());

    expect(result.passed).toBe(true);
    expect(result.matchedCount).toBe(2);
  });

  it("fails when any condition fails (AND logic)", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "eq", value: "full_gut" },
      { field: "finish_level", op: "eq", value: "luxury" },
    ];
    const result = evaluateConditions(conditions, makeIntake({ finishLevel: "standard" }), makeProject());

    expect(result.passed).toBe(false);
    expect(result.failedField).toBe("finish_level");
  });

  it("handles 'neq' operator", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "neq", value: "new" },
    ];
    const result = evaluateConditions(conditions, makeIntake({ condition: "full_gut" }), makeProject());

    expect(result.passed).toBe(true);
  });

  it("handles 'in' operator", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "in", value: ["full_gut", "partial", "cosmetic"] },
    ];
    const result = evaluateConditions(conditions, makeIntake({ condition: "full_gut" }), makeProject());

    expect(result.passed).toBe(true);
  });

  it("fails 'in' operator when value not in list", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "in", value: ["partial", "cosmetic"] },
    ];
    const result = evaluateConditions(conditions, makeIntake({ condition: "full_gut" }), makeProject());

    expect(result.passed).toBe(false);
  });

  it("handles 'gte' operator for area", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "area", op: "gte", value: 100 },
    ];
    const result = evaluateConditions(conditions, makeIntake({ area: "200" }), makeProject());

    expect(result.passed).toBe(true);
  });

  it("handles 'lte' operator for area", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "area", op: "lte", value: 300 },
    ];
    const result = evaluateConditions(conditions, makeIntake({ area: "200" }), makeProject());

    expect(result.passed).toBe(true);
  });

  it("handles 'contains' operator", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "contains", value: "gut" },
    ];
    const result = evaluateConditions(conditions, makeIntake({ condition: "full_gut" }), makeProject());

    expect(result.passed).toBe(true);
  });

  it("handles null field value with 'neq' operator (returns true)", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "neq", value: "full_gut" },
    ];
    const result = evaluateConditions(conditions, makeIntake({ condition: undefined }), makeProject());

    expect(result.passed).toBe(true);
  });

  it("handles null field value with 'eq' operator (returns false)", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "condition", op: "eq", value: "full_gut" },
    ];
    const result = evaluateConditions(conditions, makeIntake({ condition: undefined }), makeProject());

    expect(result.passed).toBe(false);
  });

  it("resolves coastal_exposure from zone snapshot", () => {
    const conditions: ScopeRuleCondition[] = [
      { field: "coastal_exposure", op: "eq", value: "extreme" },
    ];
    const project = makeProject({ zoneModifierSnapshot: BARRIER_ISLAND_SNAPSHOT });
    const result = evaluateConditions(conditions, makeIntake(), project);

    expect(result.passed).toBe(true);
  });

  it("returns empty matchedCount for empty conditions", () => {
    const result = evaluateConditions([], makeIntake(), makeProject());
    expect(result.passed).toBe(true);
    expect(result.matchedCount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. generateGeoWarnings()
// ══════════════════════════════════════════════════════════════════════

describe("generateGeoWarnings()", () => {
  it("warns when no zone is assigned", () => {
    const project = makeProject({ zoneModifierSnapshot: null });
    const warnings = generateGeoWarnings(project, []);

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("No geographic zone assigned");
  });

  it("warns for Barrier Island Premium zone", () => {
    const project = makeProject({ zoneModifierSnapshot: BARRIER_ISLAND_SNAPSHOT });
    const assemblies = [makeAssembly()];
    const warnings = generateGeoWarnings(project, assemblies);

    // Should have coastal warning + zone-specific warning
    expect(warnings.some(w => w.includes("Barrier Island Premium"))).toBe(true);
    expect(warnings.some(w => w.includes("Coastal Hardening Logic"))).toBe(true);
  });

  it("warns for Charleston Coastal zone", () => {
    const project = makeProject({ zoneModifierSnapshot: COASTAL_SNAPSHOT });
    const assemblies = [makeAssembly()];
    const warnings = generateGeoWarnings(project, assemblies);

    expect(warnings.some(w => w.includes("Charleston Coastal"))).toBe(true);
  });

  it("warns when high coastal exposure but no coastal assemblies", () => {
    const project = makeProject({ zoneModifierSnapshot: COASTAL_SNAPSHOT });
    const assemblies = [makeAssembly({ coastalModifier: null })];
    const warnings = generateGeoWarnings(project, assemblies);

    expect(warnings.some(w => w.includes("Coastal-grade components recommended"))).toBe(true);
  });

  it("does not warn about coastal assemblies when they are present", () => {
    const project = makeProject({ zoneModifierSnapshot: COASTAL_SNAPSHOT });
    const assemblies = [makeAssembly({ coastalModifier: "1.25" })];
    const warnings = generateGeoWarnings(project, assemblies);

    expect(warnings.some(w => w.includes("Coastal-grade components recommended"))).toBe(false);
  });

  it("warns for elevated logistics complexity", () => {
    const project = makeProject({
      zoneModifierSnapshot: {
        ...BARRIER_ISLAND_SNAPSHOT,
        logisticsModifier: 1.35,
      },
    });
    const warnings = generateGeoWarnings(project, []);

    expect(warnings.some(w => w.includes("elevated logistics complexity"))).toBe(true);
  });

  it("warns for high contingency percentage", () => {
    const project = makeProject({
      zoneModifierSnapshot: {
        ...BARRIER_ISLAND_SNAPSHOT,
        contingencyPct: 5.0,
      },
    });
    const warnings = generateGeoWarnings(project, []);

    expect(warnings.some(w => w.includes("5% contingency"))).toBe(true);
  });

  it("does not warn for inland zones with low exposure", () => {
    const project = makeProject({ zoneModifierSnapshot: SUMMERVILLE_SNAPSHOT });
    const assemblies = [makeAssembly()];
    const warnings = generateGeoWarnings(project, assemblies);

    // Should NOT have coastal warnings
    expect(warnings.some(w => w.includes("Coastal-grade"))).toBe(false);
    expect(warnings.some(w => w.includes("Coastal Hardening"))).toBe(false);
  });

  it("does not warn about logistics when modifier is normal", () => {
    const project = makeProject({ zoneModifierSnapshot: SUMMERVILLE_SNAPSHOT });
    const warnings = generateGeoWarnings(project, []);

    expect(warnings.some(w => w.includes("logistics complexity"))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. validateIntakeForScope()
// ══════════════════════════════════════════════════════════════════════

describe("validateIntakeForScope()", () => {
  it("returns no warnings for complete intake", () => {
    const warnings = validateIntakeForScope(makeIntake());
    expect(warnings.length).toBe(0);
  });

  it("warns when service_type is missing", () => {
    const warnings = validateIntakeForScope(makeIntake({ serviceType: "" }));
    expect(warnings.some(w => w.includes("service_type"))).toBe(true);
  });

  it("warns when area is missing", () => {
    const warnings = validateIntakeForScope(makeIntake({ area: null }));
    expect(warnings.some(w => w.includes("area"))).toBe(true);
  });

  it("warns when finish_level is missing", () => {
    const warnings = validateIntakeForScope(makeIntake({ finishLevel: null }));
    expect(warnings.some(w => w.includes("finish_level"))).toBe(true);
  });

  it("warns when condition is missing", () => {
    const warnings = validateIntakeForScope(makeIntake({ condition: null }));
    expect(warnings.some(w => w.includes("condition"))).toBe(true);
  });

  it("returns 4 warnings when all fields are missing", () => {
    const warnings = validateIntakeForScope({
      serviceType: "",
      area: null,
      finishLevel: null,
      condition: null,
    });
    expect(warnings.length).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. generateScopeDraft() — Full Pipeline
// ══════════════════════════════════════════════════════════════════════

describe("generateScopeDraft()", () => {
  const assemblies: ScopeAssemblyRef[] = [
    makeAssembly({ id: 30060, code: "KIT-DEMO-001", name: "Kitchen Demo", category: "kitchen" }),
    makeAssembly({ id: 30061, code: "KIT-CAB-STD", name: "Cabinet Install Std", category: "kitchen" }),
    makeAssembly({ id: 30063, code: "KIT-CTR-LAM", name: "Countertop Laminate", category: "kitchen" }),
    makeAssembly({ id: 30065, code: "KIT-BSP-001", name: "Tile Backsplash", category: "kitchen" }),
    makeAssembly({ id: 30066, code: "KIT-SNK-001", name: "Kitchen Sink & Faucet", category: "kitchen" }),
  ];

  const rules: ScopeRuleData[] = [
    makeRule({
      id: 1,
      ruleCode: "KIT-DEMO-STD",
      serviceType: "kitchen_remodel",
      finishLevel: "standard",
      conditionJson: [{ field: "condition", op: "eq", value: "full_gut" }],
      assemblyId: 30060,
      quantityFormula: "1",
      reasonTemplate: "Full gut demo for {{service_type}}.",
      priority: 10,
    }),
    makeRule({
      id: 2,
      ruleCode: "KIT-CAB-STD",
      serviceType: "kitchen_remodel",
      finishLevel: "standard",
      assemblyId: 30061,
      quantityFormula: "ceil(area / 40)",
      reasonTemplate: "Standard cabinet install for {{service_type}}.",
      priority: 20,
    }),
    makeRule({
      id: 3,
      ruleCode: "KIT-CTR-STD",
      serviceType: "kitchen_remodel",
      finishLevel: "standard",
      assemblyId: 30063,
      quantityFormula: "ceil(area / 50)",
      reasonTemplate: "Laminate countertop for {{service_type}}.",
      priority: 25,
    }),
    makeRule({
      id: 4,
      ruleCode: "KIT-BSP-STD",
      serviceType: "kitchen_remodel",
      assemblyId: 30065,
      quantityFormula: "ceil(area / 60)",
      reasonTemplate: "Tile backsplash for {{service_type}}.",
      priority: 30,
    }),
    makeRule({
      id: 5,
      ruleCode: "KIT-SNK-STD",
      serviceType: "kitchen_remodel",
      assemblyId: 30066,
      quantityFormula: "1",
      reasonTemplate: "Sink replacement for {{service_type}}.",
      priority: 35,
    }),
  ];

  it("generates a complete scope draft with items", () => {
    const intake = makeIntake({ serviceType: "kitchen_remodel", area: "200", finishLevel: "standard", condition: "full_gut" });
    const project = makeProject();

    const draft = generateScopeDraft(intake, project, rules, assemblies);

    expect(draft.items.length).toBeGreaterThanOrEqual(4);
    expect(draft.metadata.rulesMatched).toBeGreaterThanOrEqual(4);
    expect(draft.metadata.intakeServiceType).toBe("kitchen_remodel");
    expect(draft.metadata.intakeFinishLevel).toBe("standard");
    expect(draft.confidence).toBeGreaterThan(0);
    expect(draft.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
  });

  it("calculates correct quantities for area-based formulas", () => {
    const intake = makeIntake({ area: "200", finishLevel: "standard", condition: "full_gut" });
    const draft = generateScopeDraft(intake, makeProject(), rules, assemblies);

    // KIT-DEMO: quantity = 1 (fixed)
    const demoItem = draft.items.find(i => i.ruleCode === "KIT-DEMO-STD");
    expect(demoItem?.quantity).toBe(1);

    // KIT-CAB: quantity = ceil(200/40) = 5
    const cabItem = draft.items.find(i => i.ruleCode === "KIT-CAB-STD");
    expect(cabItem?.quantity).toBe(5);

    // KIT-CTR: quantity = ceil(200/50) = 4
    const ctrItem = draft.items.find(i => i.ruleCode === "KIT-CTR-STD");
    expect(ctrItem?.quantity).toBe(4);
  });

  it("includes geographic warnings in output", () => {
    const intake = makeIntake();
    const project = makeProject({ zoneModifierSnapshot: null });
    const draft = generateScopeDraft(intake, project, rules, assemblies);

    expect(draft.warnings.some(w => w.includes("No geographic zone assigned"))).toBe(true);
  });

  it("includes intake validation warnings", () => {
    const intake = makeIntake({ area: null, finishLevel: null, condition: null });
    const draft = generateScopeDraft(intake, makeProject(), rules, assemblies);

    expect(draft.warnings.some(w => w.includes("area"))).toBe(true);
    expect(draft.warnings.some(w => w.includes("finish_level"))).toBe(true);
  });

  it("warns when no rules match", () => {
    const intake = makeIntake({ serviceType: "roofing" });
    const draft = generateScopeDraft(intake, makeProject(), rules, assemblies);

    expect(draft.items.length).toBe(0);
    expect(draft.warnings.some(w => w.includes("No scope rules matched"))).toBe(true);
    expect(draft.confidence).toBe(MIN_CONFIDENCE);
  });

  it("warns when rule references missing assembly", () => {
    const rulesWithMissing = [
      makeRule({ assemblyId: 99999, ruleCode: "MISSING" }),
    ];
    const draft = generateScopeDraft(makeIntake(), makeProject(), rulesWithMissing, assemblies);

    expect(draft.warnings.some(w => w.includes("assembly ID 99999"))).toBe(true);
  });

  it("assigns sequential sort order to items", () => {
    const intake = makeIntake({ finishLevel: "standard", condition: "full_gut" });
    const draft = generateScopeDraft(intake, makeProject(), rules, assemblies);

    for (let i = 0; i < draft.items.length; i++) {
      expect(draft.items[i].sortOrder).toBe(i + 1);
    }
  });

  it("includes metadata with generation timestamp", () => {
    const draft = generateScopeDraft(makeIntake(), makeProject(), rules, assemblies);

    expect(draft.metadata.generatedAt).toBeTruthy();
    expect(new Date(draft.metadata.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("differentiates Goose Creek vs Kiawah Island projects", () => {
    const gooseCreekProject = makeProject({
      zone: "Summerville / Goose Creek",
      zoneModifierSnapshot: SUMMERVILLE_SNAPSHOT,
    });
    const kiawahProject = makeProject({
      zone: "Barrier Island Premium",
      zoneModifierSnapshot: BARRIER_ISLAND_SNAPSHOT,
    });

    const intake = makeIntake({ finishLevel: "standard", condition: "full_gut" });

    const gooseCreekDraft = generateScopeDraft(intake, gooseCreekProject, rules, assemblies);
    const kiawahDraft = generateScopeDraft(intake, kiawahProject, rules, assemblies);

    // Kiawah should have coastal warnings, Goose Creek should not
    const kiawahCoastalWarnings = kiawahDraft.warnings.filter(w =>
      w.includes("Coastal") || w.includes("coastal")
    );
    const gooseCreekCoastalWarnings = gooseCreekDraft.warnings.filter(w =>
      w.includes("Coastal Hardening") || w.includes("Coastal-grade")
    );

    expect(kiawahCoastalWarnings.length).toBeGreaterThan(0);
    expect(gooseCreekCoastalWarnings.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. convertScopeToBundle()
// ══════════════════════════════════════════════════════════════════════

describe("convertScopeToBundle()", () => {
  it("converts scope draft items to bundle selections", () => {
    const draft: ScopeDraftOutput = {
      items: [
        {
          assemblyId: 30060,
          assemblyCode: "KIT-DEMO-001",
          assemblyName: "Kitchen Demo",
          category: "kitchen",
          trade: "demolition",
          quantity: 1,
          unit: "EA",
          reason: "Test",
          confidence: 0.85,
          ruleCode: "KIT-DEMO-STD",
          sortOrder: 1,
        },
        {
          assemblyId: 30061,
          assemblyCode: "KIT-CAB-STD",
          assemblyName: "Cabinet Install",
          category: "kitchen",
          trade: "carpentry",
          quantity: 5,
          unit: "EA",
          reason: "Test",
          confidence: 0.80,
          ruleCode: "KIT-CAB-STD",
          sortOrder: 2,
        },
      ],
      warnings: [],
      confidenceScore: 0.82,
      metadata: {
        rulesEvaluated: 5,
        rulesMatched: 2,
        assembliesSelected: 2,
        intakeServiceType: "kitchen_remodel",
        intakeFinishLevel: "standard",
        projectZone: "Charleston Metro",
        generatedAt: new Date().toISOString(),
      },
    };

    const selections = convertScopeToBundle(draft);

    expect(selections.length).toBe(2);
    expect(selections[0].assemblyId).toBe(30060);
    expect(selections[0].quantity).toBe(1);
    expect(selections[1].assemblyId).toBe(30061);
    expect(selections[1].quantity).toBe(5);
  });

  it("preserves assembly metadata in bundle selections", () => {
    const draft: ScopeDraftOutput = {
      items: [
        {
          assemblyId: 30060,
          assemblyCode: "KIT-DEMO-001",
          assemblyName: "Kitchen Demo",
          category: "kitchen",
          trade: "demolition",
          quantity: 1,
          unit: "EA",
          reason: "Test",
          confidence: 0.85,
          ruleCode: "KIT-DEMO-STD",
          sortOrder: 1,
        },
      ],
      warnings: [],
      confidenceScore: 0.85,
      metadata: {
        rulesEvaluated: 1,
        rulesMatched: 1,
        assembliesSelected: 1,
        intakeServiceType: "kitchen_remodel",
        intakeFinishLevel: "standard",
        projectZone: "Charleston Metro",
        generatedAt: new Date().toISOString(),
      },
    };

    const selections = convertScopeToBundle(draft);

    expect(selections[0].assemblyCode).toBe("KIT-DEMO-001");
    expect(selections[0].assemblyName).toBe("Kitchen Demo");
    expect(selections[0].category).toBe("kitchen");
    expect(selections[0].trade).toBe("demolition");
  });

  it("returns empty array for draft with no items", () => {
    const draft: ScopeDraftOutput = {
      items: [],
      warnings: ["No rules matched"],
      confidenceScore: MIN_CONFIDENCE,
      metadata: {
        rulesEvaluated: 0,
        rulesMatched: 0,
        assembliesSelected: 0,
        intakeServiceType: "kitchen_remodel",
        intakeFinishLevel: "standard",
        projectZone: "unknown",
        generatedAt: new Date().toISOString(),
      },
    };

    const selections = convertScopeToBundle(draft);
    expect(selections.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 12. Confidence Scoring
// ══════════════════════════════════════════════════════════════════════

describe("Confidence Scoring", () => {
  it("draft confidence is MIN_CONFIDENCE when no items", () => {
    const intake = makeIntake({ serviceType: "nonexistent_service" });
    const draft = generateScopeDraft(intake, makeProject(), [], []);

    expect(draft.confidence).toBe(MIN_CONFIDENCE);
  });

  it("confidence increases with more specific rule matches", () => {
    const genericRule = makeRule({
      id: 1,
      assemblyId: 30060,
      finishLevel: null,
      channel: null,
      zone: null,
    });
    const specificRule = makeRule({
      id: 2,
      assemblyId: 30061,
      finishLevel: "standard",
      channel: "direct",
      zone: "Charleston Metro",
    });

    const intake = makeIntake({ finishLevel: "standard", channel: "direct" });
    const project = makeProject({ zone: "Charleston Metro" });

    const genericResult = matchRule(genericRule, intake, project);
    const specificResult = matchRule(specificRule, intake, project);

    expect(specificResult.matchScore).toBeGreaterThan(genericResult.matchScore);
  });

  it("confidence never exceeds MAX_CONFIDENCE", () => {
    const rules = Array.from({ length: 20 }, (_, i) =>
      makeRule({
        id: i + 1,
        assemblyId: 30060 + i,
        finishLevel: "standard",
        channel: "direct",
        zone: "Charleston Metro",
        priority: 10 + i,
      })
    );
    const assemblies = rules.map(r =>
      makeAssembly({ id: r.assemblyId, code: `ASM-${r.id}` })
    );
    const intake = makeIntake({ finishLevel: "standard", channel: "direct" });
    const project = makeProject({ zone: "Charleston Metro" });

    const draft = generateScopeDraft(intake, project, rules, assemblies);

    expect(draft.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
    for (const item of draft.items) {
      expect(item.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
    }
  });

  it("confidence is higher with complete intake data", () => {
    const completeIntake = makeIntake({
      area: "200",
      finishLevel: "standard",
      condition: "full_gut",
      channel: "direct",
    });
    const incompleteIntake = makeIntake({
      area: null,
      finishLevel: null,
      condition: null,
      channel: null,
    });

    const rules = [makeRule({ assemblyId: 30060 })];
    const assemblies = [makeAssembly({ id: 30060 })];

    const completeDraft = generateScopeDraft(completeIntake, makeProject(), rules, assemblies);
    const incompleteDraft = generateScopeDraft(incompleteIntake, makeProject(), rules, assemblies);

    expect(completeDraft.confidence).toBeGreaterThan(incompleteDraft.confidence);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 13. Constants Verification
// ══════════════════════════════════════════════════════════════════════

describe("Constants", () => {
  it("DEFAULT_WASTE_FACTOR is 1.10", () => {
    expect(DEFAULT_WASTE_FACTOR).toBe(1.10);
  });

  it("LUXURY_COMPLEXITY_MULTIPLIER is 1.15", () => {
    expect(LUXURY_COMPLEXITY_MULTIPLIER).toBe(1.15);
  });

  it("DEFAULT_AREA_SQFT is 100", () => {
    expect(DEFAULT_AREA_SQFT).toBe(100);
  });

  it("MIN_CONFIDENCE is 0.30", () => {
    expect(MIN_CONFIDENCE).toBe(0.30);
  });

  it("MAX_CONFIDENCE is 1.00", () => {
    expect(MAX_CONFIDENCE).toBe(1.00);
  });

  it("COASTAL_WARNING_THRESHOLD is 'high'", () => {
    expect(COASTAL_WARNING_THRESHOLD).toBe("high");
  });

  it("COASTAL_ZONES includes Barrier Island Premium and Charleston Coastal", () => {
    expect(COASTAL_ZONES).toContain("Barrier Island Premium");
    expect(COASTAL_ZONES).toContain("Charleston Coastal");
    expect(COASTAL_ZONES.length).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 14. Seed Data Integrity
// ══════════════════════════════════════════════════════════════════════

describe("Scope Rules Seed Data", () => {
  it("has 62 total rules", () => {
    expect(ALL_SCOPE_RULES.length).toBe(62);
  });

  it("RULE_COUNTS total matches actual array length", () => {
    expect(RULE_COUNTS.total).toBe(ALL_SCOPE_RULES.length);
  });

  it("has rules for all 9 trade groups", () => {
    expect(RULE_COUNTS.kitchen).toBeGreaterThan(0);
    expect(RULE_COUNTS.bathroom).toBeGreaterThan(0);
    expect(RULE_COUNTS.roofing).toBeGreaterThan(0);
    expect(RULE_COUNTS.siding).toBeGreaterThan(0);
    expect(RULE_COUNTS.windowsDoors).toBeGreaterThan(0);
    expect(RULE_COUNTS.deck).toBeGreaterThan(0);
    expect(RULE_COUNTS.paint).toBeGreaterThan(0);
    expect(RULE_COUNTS.flooring).toBeGreaterThan(0);
    expect(RULE_COUNTS.exterior).toBeGreaterThan(0);
  });

  it("all rules have unique rule codes", () => {
    const codes = ALL_SCOPE_RULES.map(r => r.ruleCode);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it("all rules have valid service types", () => {
    const validServiceTypes = new Set([
      "kitchen_remodel", "bathroom_remodel", "roofing",
      "siding", "windows_doors", "deck_porch",
      "painting", "flooring", "exterior",
    ]);
    for (const rule of ALL_SCOPE_RULES) {
      expect(validServiceTypes.has(rule.serviceType)).toBe(true);
    }
  });

  it("all rules have valid priority values (1-999)", () => {
    for (const rule of ALL_SCOPE_RULES) {
      expect(rule.priority).toBeGreaterThanOrEqual(1);
      expect(rule.priority).toBeLessThanOrEqual(999);
    }
  });

  it("all rules have non-empty quantity formulas", () => {
    for (const rule of ALL_SCOPE_RULES) {
      expect(rule.quantityFormula.trim().length).toBeGreaterThan(0);
    }
  });

  it("all rules have non-empty reason templates", () => {
    for (const rule of ALL_SCOPE_RULES) {
      expect(rule.reasonTemplate.trim().length).toBeGreaterThan(0);
    }
  });

  it("all rules have positive assembly IDs", () => {
    for (const rule of ALL_SCOPE_RULES) {
      expect(rule.assemblyId).toBeGreaterThan(0);
    }
  });

  it("kitchen rules cover standard, premium, and luxury finish levels", () => {
    const kitchenRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "kitchen_remodel");
    const finishLevels = new Set(kitchenRules.map(r => r.finishLevel).filter(Boolean));
    expect(finishLevels.has("standard")).toBe(true);
    expect(finishLevels.has("premium")).toBe(true);
    expect(finishLevels.has("luxury")).toBe(true);
  });

  it("bathroom rules cover standard, premium, and luxury finish levels", () => {
    const bathRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "bathroom_remodel");
    const finishLevels = new Set(bathRules.map(r => r.finishLevel).filter(Boolean));
    expect(finishLevels.has("standard")).toBe(true);
    expect(finishLevels.has("premium")).toBe(true);
    expect(finishLevels.has("luxury")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 15. Edge Cases + Regression Guards
// ══════════════════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  it("handles empty rules array gracefully", () => {
    const draft = generateScopeDraft(makeIntake(), makeProject(), [], []);
    expect(draft.items.length).toBe(0);
    expect(draft.warnings.length).toBeGreaterThan(0);
  });

  it("handles empty assemblies array gracefully", () => {
    const rules = [makeRule()];
    const draft = generateScopeDraft(makeIntake(), makeProject(), rules, []);

    // Rule matches but assembly not found → warning
    expect(draft.warnings.some(w => w.includes("not found in the assembly library"))).toBe(true);
  });

  it("handles very large area values", () => {
    const ctx = makeFormulaCtx({ area: 100000 });
    const result = evaluateQuantityFormula("ceil(area / 100)", ctx);
    expect(result).toBe(1000);
  });

  it("handles very small area values", () => {
    const ctx = makeFormulaCtx({ area: 1 });
    const result = evaluateQuantityFormula("ceil(area / 100)", ctx);
    expect(result).toBe(1); // ceil(0.01) = 1
  });

  it("scope engine produces no pricing data (architecture rule)", () => {
    const rules = [makeRule({ assemblyId: 30060 })];
    const assemblies = [makeAssembly({ id: 30060 })];
    const draft = generateScopeDraft(makeIntake(), makeProject(), rules, assemblies);

    // ScopeItem should NOT have price/cost fields
    for (const item of draft.items) {
      expect((item as any).price).toBeUndefined();
      expect((item as any).cost).toBeUndefined();
      expect((item as any).total).toBeUndefined();
      expect((item as any).markup).toBeUndefined();
    }
  });

  it("scope engine does not apply Profit Shield (architecture rule)", () => {
    const rules = [makeRule({ assemblyId: 30060 })];
    const assemblies = [makeAssembly({ id: 30060 })];
    const draft = generateScopeDraft(makeIntake(), makeProject(), rules, assemblies);

    expect((draft as any).profitShield).toBeUndefined();
    expect((draft as any).grossProfit).toBeUndefined();
  });

  it("all matching uses canonical taxonomy (normalization)", () => {
    // "Kitchen Remodel" alias should normalize to "kitchen_remodel"
    const rule = makeRule({ serviceType: "kitchen_remodel" });
    const intake = makeIntake({ serviceType: "kitchen_remodel" });
    const result = matchRule(rule, intake, makeProject());

    expect(result.matched).toBe(true);
  });

  it("handles concurrent rules for same assembly with different conditions", () => {
    const rules = [
      makeRule({
        id: 1,
        assemblyId: 30060,
        conditionJson: [{ field: "condition", op: "eq", value: "full_gut" }],
        priority: 10,
      }),
      makeRule({
        id: 2,
        assemblyId: 30060,
        conditionJson: [{ field: "condition", op: "eq", value: "partial" }],
        priority: 10,
      }),
    ];

    // With full_gut condition, only rule 1 should match
    const intake = makeIntake({ condition: "full_gut" });
    const results = matchRules(rules, intake, makeProject());

    expect(results.length).toBe(1);
    expect(results[0].rule.id).toBe(1);
  });

  it("zone match from zoneModifierSnapshot when project.zone is null", () => {
    const rule = makeRule({ zone: "Charleston Metro" });
    const project = makeProject({
      zone: null,
      zoneModifierSnapshot: {
        zoneId: 2,
        zoneName: "Charleston Metro",
        laborModifier: 1.05,
        logisticsModifier: 1.0,
        materialModifier: 1.05,
        contingencyPct: 0.0,
        minProfitShieldPct: 35.0,
        coastalExposureLevel: "moderate",
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const result = matchRule(rule, makeIntake(), project);

    expect(result.matched).toBe(true);
  });

  it("channel falls back to project.channel when intake.channel is null", () => {
    const rule = makeRule({ channel: "direct" });
    const intake = makeIntake({ channel: undefined });
    const project = makeProject({ channel: "direct" });
    const result = matchRule(rule, intake, project);

    expect(result.matched).toBe(true);
  });

  it("waste factor map is applied per-assembly in generateScopeDraft", () => {
    const rules = [
      makeRule({ id: 1, assemblyId: 30060, quantityFormula: "area * waste_factor", priority: 10 }),
    ];
    const assemblies = [makeAssembly({ id: 30060 })];
    const wasteFactors = new Map([[30060, 1.20]]);

    const intake = makeIntake({ area: "100" });
    const draft = generateScopeDraft(intake, makeProject(), rules, assemblies, wasteFactors);

    // 100 * 1.20 = 120
    expect(draft.items[0]?.quantity).toBe(120);
  });

  it("default waste factor used when waste factor map is not provided", () => {
    const rules = [
      makeRule({ id: 1, assemblyId: 30060, quantityFormula: "area * waste_factor", priority: 10 }),
    ];
    const assemblies = [makeAssembly({ id: 30060 })];

    const intake = makeIntake({ area: "100" });
    const draft = generateScopeDraft(intake, makeProject(), rules, assemblies);

    // 100 * 1.10 (default) = 110
    expect(draft.items[0]?.quantity).toBeCloseTo(110);
  });
});
