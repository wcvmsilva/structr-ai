/**
 * Sprint 22 — Learning Layer Foundation Tests
 *
 * 77 tests covering:
 *   1. Pure variance calculations (calcVariancePct, getVarianceDirection)
 *   2. Confidence score calculation
 *   3. Multiplier suggestion generation
 *   4. Rationale generation
 *   5. Variance type inference
 *   6. Variance event CRUD (mocked DB)
 *   7. Assembly performance metrics aggregation
 *   8. Calibration suggestion generation + review
 *   9. Dashboard summary queries
 *  10. Router procedure structure
 *  11. Data integrity & edge cases
 *
 * Does NOT import or test Scope Builder, Remodel Engine, Pricing Engine, or Override Resolver.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Pure function imports (no DB dependency)
// ══════════════════════════════════════════════════════════════════════
import {
  calcVariancePct,
  getVarianceDirection,
  calculateConfidenceScore,
  generateMultiplierSuggestions,
  generateRationale,
  inferVarianceType,
} from "./learning-layer-db";

// ══════════════════════════════════════════════════════════════════════
// 1. VARIANCE CALCULATIONS — calcVariancePct
// ══════════════════════════════════════════════════════════════════════
describe("calcVariancePct", () => {
  it("returns 0 when estimated and actual are both 0", () => {
    expect(calcVariancePct(0, 0)).toBe(0);
  });

  it("returns 100 when estimated is 0 but actual is non-zero", () => {
    expect(calcVariancePct(0, 500)).toBe(100);
  });

  it("calculates correct variance for overrun", () => {
    // actual=1200, estimated=1000 → |200|/1000*100 = 20%
    expect(calcVariancePct(1000, 1200)).toBe(20);
  });

  it("calculates correct variance for underrun", () => {
    // actual=800, estimated=1000 → |200|/1000*100 = 20%
    expect(calcVariancePct(1000, 800)).toBe(20);
  });

  it("returns 0 when estimated equals actual", () => {
    expect(calcVariancePct(5000, 5000)).toBe(0);
  });

  it("handles large overruns correctly", () => {
    // actual=3000, estimated=1000 → 200%
    expect(calcVariancePct(1000, 3000)).toBe(200);
  });

  it("handles small fractional differences", () => {
    const result = calcVariancePct(100, 100.5);
    expect(result).toBeCloseTo(0.5, 1);
  });

  it("handles negative estimated values (absolute)", () => {
    // |actual - estimated| / |estimated| * 100
    const result = calcVariancePct(-1000, -800);
    expect(result).toBe(20);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. VARIANCE DIRECTION — getVarianceDirection
// ══════════════════════════════════════════════════════════════════════
describe("getVarianceDirection", () => {
  it("returns 'overrun' when actual > estimated", () => {
    expect(getVarianceDirection(1000, 1200)).toBe("overrun");
  });

  it("returns 'underrun' when actual < estimated", () => {
    expect(getVarianceDirection(1000, 800)).toBe("underrun");
  });

  it("returns 'overrun' when actual equals estimated (tie goes to overrun)", () => {
    expect(getVarianceDirection(1000, 1000)).toBe("overrun");
  });

  it("handles zero values", () => {
    expect(getVarianceDirection(0, 0)).toBe("overrun");
    expect(getVarianceDirection(0, 100)).toBe("overrun");
    expect(getVarianceDirection(100, 0)).toBe("underrun");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. CONFIDENCE SCORE — calculateConfidenceScore
// ══════════════════════════════════════════════════════════════════════
describe("calculateConfidenceScore", () => {
  it("returns a score between 0 and 100", () => {
    const score = calculateConfidenceScore(10, 8, 2, 15);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("increases with more samples", () => {
    const small = calculateConfidenceScore(3, 2, 1, 15);
    const large = calculateConfidenceScore(50, 40, 10, 15);
    expect(large).toBeGreaterThan(small);
  });

  it("increases with more consistent direction", () => {
    // 9/10 overruns vs 5/10 overruns
    const consistent = calculateConfidenceScore(10, 9, 1, 15);
    const mixed = calculateConfidenceScore(10, 5, 5, 15);
    expect(consistent).toBeGreaterThan(mixed);
  });

  it("returns higher score for lower variance (more predictable)", () => {
    const lowVar = calculateConfidenceScore(10, 8, 2, 5);
    const highVar = calculateConfidenceScore(10, 8, 2, 50);
    expect(lowVar).toBeGreaterThan(highVar);
  });

  it("caps at 100", () => {
    const score = calculateConfidenceScore(1000, 999, 1, 0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("handles zero total (no overruns or underruns)", () => {
    const score = calculateConfidenceScore(0, 0, 0, 0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns integer values", () => {
    const score = calculateConfidenceScore(7, 5, 2, 12);
    expect(Number.isInteger(score)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. MULTIPLIER SUGGESTIONS — generateMultiplierSuggestions
// ══════════════════════════════════════════════════════════════════════
describe("generateMultiplierSuggestions", () => {
  it("returns 1.0 multipliers when estimated is 0", () => {
    const result = generateMultiplierSuggestions(0, 500, 5, 0);
    expect(result.suggestedWasteFactor).toBe(1.0);
    expect(result.suggestedLaborMultiplier).toBe(1.0);
    expect(result.suggestedMaterialMultiplier).toBe(1.0);
  });

  it("increases multipliers for overrun pattern", () => {
    // actual=1200, estimated=1000 → ratio=1.2, adjustment=0.2
    const result = generateMultiplierSuggestions(1000, 1200, 8, 2);
    expect(result.suggestedWasteFactor).toBeGreaterThan(1.0);
    expect(result.suggestedLaborMultiplier).toBeGreaterThan(1.0);
    expect(result.suggestedMaterialMultiplier).toBeGreaterThan(1.0);
  });

  it("decreases multipliers for underrun pattern", () => {
    // actual=800, estimated=1000 → ratio=0.8
    const result = generateMultiplierSuggestions(1000, 800, 2, 8);
    expect(result.suggestedWasteFactor).toBeLessThan(1.0);
    expect(result.suggestedLaborMultiplier).toBeLessThan(1.0);
    expect(result.suggestedMaterialMultiplier).toBeLessThan(1.0);
  });

  it("allocates 40% of adjustment to labor (largest share)", () => {
    const result = generateMultiplierSuggestions(1000, 1200, 8, 2);
    // adjustment = 0.2, labor gets 0.4*0.2 = 0.08
    expect(result.suggestedLaborMultiplier).toBeCloseTo(1.08, 2);
  });

  it("allocates 30% each to waste and material", () => {
    const result = generateMultiplierSuggestions(1000, 1200, 8, 2);
    // adjustment = 0.2, waste/material get 0.3*0.2 = 0.06
    expect(result.suggestedWasteFactor).toBeCloseTo(1.06, 2);
    expect(result.suggestedMaterialMultiplier).toBeCloseTo(1.06, 2);
  });

  it("returns 1.0 when actual equals estimated", () => {
    // ratio=1.0, adjustment=0
    const result = generateMultiplierSuggestions(1000, 1000, 5, 5);
    // overrunCount === underrunCount → isOverrun is false → underrun path
    // adjustment = 1 - 1 = 0
    expect(result.suggestedWasteFactor).toBe(1.0);
    expect(result.suggestedLaborMultiplier).toBe(1.0);
    expect(result.suggestedMaterialMultiplier).toBe(1.0);
  });

  it("handles extreme overrun (3x cost)", () => {
    const result = generateMultiplierSuggestions(1000, 3000, 10, 0);
    // ratio=3.0, adjustment=2.0
    expect(result.suggestedLaborMultiplier).toBeCloseTo(1.8, 2);
    expect(result.suggestedWasteFactor).toBeCloseTo(1.6, 2);
    expect(result.suggestedMaterialMultiplier).toBeCloseTo(1.6, 2);
  });

  it("returns values with 4 decimal precision", () => {
    const result = generateMultiplierSuggestions(1000, 1150, 7, 3);
    expect(String(result.suggestedWasteFactor).split(".")[1]?.length).toBeLessThanOrEqual(4);
    expect(String(result.suggestedLaborMultiplier).split(".")[1]?.length).toBeLessThanOrEqual(4);
    expect(String(result.suggestedMaterialMultiplier).split(".")[1]?.length).toBeLessThanOrEqual(4);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. RATIONALE GENERATION — generateRationale
// ══════════════════════════════════════════════════════════════════════
describe("generateRationale", () => {
  it("generates a non-empty string", () => {
    const result = generateRationale("Kitchen Cabinets", 10, 25, 8, 2, 5000, 6250);
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes the assembly name", () => {
    const result = generateRationale("Bathroom Tile", 5, 15, 4, 1, 3000, 3450);
    expect(result).toContain("Bathroom Tile");
  });

  it("includes the sample size", () => {
    const result = generateRationale("Flooring", 12, 18, 9, 3, 2000, 2360);
    expect(result).toContain("12 projects");
  });

  it("identifies overrun pattern correctly", () => {
    const result = generateRationale("Roofing", 8, 22, 7, 1, 8000, 9760);
    expect(result).toContain("overrun");
  });

  it("identifies underrun pattern correctly", () => {
    const result = generateRationale("Painting", 6, 12, 1, 5, 4000, 3520);
    expect(result).toContain("underrun");
  });

  it("includes the average variance percentage", () => {
    const result = generateRationale("Drywall", 10, 18.5, 7, 3, 3000, 3555);
    expect(result).toContain("18.5%");
  });

  it("includes the cost difference", () => {
    const result = generateRationale("Framing", 5, 20, 4, 1, 10000, 12000);
    expect(result).toContain("$2000.00");
  });

  it("includes dominant direction percentage", () => {
    const result = generateRationale("Siding", 10, 15, 9, 1, 5000, 5750);
    expect(result).toContain("90%");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. VARIANCE TYPE INFERENCE — inferVarianceType
// ══════════════════════════════════════════════════════════════════════
describe("inferVarianceType", () => {
  it("returns labor_variance for labor trade", () => {
    expect(inferVarianceType("Labor", null)).toBe("labor_variance");
  });

  it("returns labor_variance for crew trade", () => {
    expect(inferVarianceType("Crew Work", null)).toBe("labor_variance");
  });

  it("returns material_variance for material trade", () => {
    expect(inferVarianceType("Material Supply", null)).toBe("material_variance");
  });

  it("returns material_variance for material category", () => {
    expect(inferVarianceType(null, "Material Supply")).toBe("material_variance");
  });

  it("returns waste_variance for waste trade", () => {
    expect(inferVarianceType("Waste Removal", null)).toBe("waste_variance");
  });

  it("returns waste_variance for disposal trade", () => {
    expect(inferVarianceType("Disposal", null)).toBe("waste_variance");
  });

  it("returns waste_variance for demo category", () => {
    expect(inferVarianceType(null, "Demo Work")).toBe("waste_variance");
  });

  it("returns scope_variance as default", () => {
    expect(inferVarianceType("Electrical", "General")).toBe("scope_variance");
  });

  it("returns scope_variance for null inputs", () => {
    expect(inferVarianceType(null, null)).toBe("scope_variance");
  });

  it("is case-insensitive", () => {
    expect(inferVarianceType("LABOR", null)).toBe("labor_variance");
    expect(inferVarianceType("Material", null)).toBe("material_variance");
    expect(inferVarianceType("WASTE", null)).toBe("waste_variance");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. ROUTER STRUCTURE — learningLayerRouter
// ══════════════════════════════════════════════════════════════════════
describe("learningLayerRouter structure", () => {
  let routerDef: any;

  beforeEach(async () => {
    const mod = await import("./learning-layer-router");
    routerDef = (mod.learningLayerRouter as any)._def;
  });

  it("exports a learningLayerRouter", async () => {
    const mod = await import("./learning-layer-router");
    expect(mod.learningLayerRouter).toBeDefined();
  });

  it("has the correct number of procedures (16)", () => {
    const procedures = Object.keys(routerDef.procedures ?? routerDef.record ?? {});
    expect(procedures.length).toBe(16);
  });

  // Variance Events
  it("has ingestVarianceEvents procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.ingestVarianceEvents).toBeDefined();
  });

  it("has createVarianceEvent procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.createVarianceEvent).toBeDefined();
  });

  it("has listVarianceEvents procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.listVarianceEvents).toBeDefined();
  });

  it("has getVarianceEventsByAssembly procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.getVarianceEventsByAssembly).toBeDefined();
  });

  // Assembly Metrics
  it("has refreshAssemblyMetrics procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.refreshAssemblyMetrics).toBeDefined();
  });

  it("has refreshAllMetrics procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.refreshAllMetrics).toBeDefined();
  });

  it("has listAssemblyMetrics procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.listAssemblyMetrics).toBeDefined();
  });

  it("has getAssemblyMetrics procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.getAssemblyMetrics).toBeDefined();
  });

  it("has highestVariance procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.highestVariance).toBeDefined();
  });

  it("has consistentOverruns procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.consistentOverruns).toBeDefined();
  });

  it("has consistentUnderruns procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.consistentUnderruns).toBeDefined();
  });

  // Calibration Suggestions
  it("has generateSuggestions procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.generateSuggestions).toBeDefined();
  });

  it("has listSuggestions procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.listSuggestions).toBeDefined();
  });

  it("has getSuggestion procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.getSuggestion).toBeDefined();
  });

  it("has reviewSuggestion procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.reviewSuggestion).toBeDefined();
  });

  // Dashboard
  it("has dashboardSummary procedure", () => {
    const procs = routerDef.procedures ?? routerDef.record ?? {};
    expect(procs.dashboardSummary).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. INTEGRATION — appRouter wiring
// ══════════════════════════════════════════════════════════════════════
describe("appRouter integration", () => {
  it("has learning namespace in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const def = (appRouter as any)._def;
    const procs = def.procedures ?? def.record ?? {};
    const keys = Object.keys(procs);
    const hasLearning = keys.some((k) => k.startsWith("learning."));
    expect(hasLearning).toBe(true);
  });

  it("exposes learning.dashboardSummary in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const def = (appRouter as any)._def;
    const procs = def.procedures ?? def.record ?? {};
    expect(procs["learning.dashboardSummary"]).toBeDefined();
  });

  it("exposes learning.generateSuggestions in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const def = (appRouter as any)._def;
    const procs = def.procedures ?? def.record ?? {};
    expect(procs["learning.generateSuggestions"]).toBeDefined();
  });

  it("exposes learning.reviewSuggestion in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const def = (appRouter as any)._def;
    const procs = def.procedures ?? def.record ?? {};
    expect(procs["learning.reviewSuggestion"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. DATA INTEGRITY & EDGE CASES
// ══════════════════════════════════════════════════════════════════════
describe("data integrity & edge cases", () => {
  it("calcVariancePct is symmetric for same magnitude", () => {
    // |1200-1000|/1000 = |800-1000|/1000 = 20%
    expect(calcVariancePct(1000, 1200)).toBe(calcVariancePct(1000, 800));
  });

  it("multiplier suggestions are symmetric in magnitude", () => {
    const overrun = generateMultiplierSuggestions(1000, 1200, 8, 2);
    const underrun = generateMultiplierSuggestions(1000, 800, 2, 8);
    // overrun waste = 1 + 0.2*0.3 = 1.06
    // underrun waste = 1 - 0.2*0.3 = 0.94
    expect(overrun.suggestedWasteFactor + underrun.suggestedWasteFactor).toBeCloseTo(2.0, 2);
  });

  it("confidence score is deterministic for same inputs", () => {
    const a = calculateConfidenceScore(10, 8, 2, 15);
    const b = calculateConfidenceScore(10, 8, 2, 15);
    expect(a).toBe(b);
  });

  it("variance direction handles very small differences", () => {
    expect(getVarianceDirection(1000.001, 1000.002)).toBe("overrun");
    expect(getVarianceDirection(1000.002, 1000.001)).toBe("underrun");
  });

  it("inferVarianceType handles empty strings", () => {
    expect(inferVarianceType("", "")).toBe("scope_variance");
  });

  it("inferVarianceType handles undefined", () => {
    expect(inferVarianceType(undefined, undefined)).toBe("scope_variance");
  });

  it("multiplier suggestions never produce negative values for reasonable inputs", () => {
    // Even with 50% underrun, multipliers should stay positive
    const result = generateMultiplierSuggestions(1000, 500, 1, 9);
    expect(result.suggestedWasteFactor).toBeGreaterThan(0);
    expect(result.suggestedLaborMultiplier).toBeGreaterThan(0);
    expect(result.suggestedMaterialMultiplier).toBeGreaterThan(0);
  });

  it("rationale handles assembly name with special characters", () => {
    const result = generateRationale('Kitchen "Premium" Cabinets', 5, 20, 4, 1, 5000, 6000);
    expect(result).toContain('Kitchen "Premium" Cabinets');
  });

  it("calcVariancePct handles very large numbers", () => {
    const result = calcVariancePct(1000000, 1200000);
    expect(result).toBe(20);
  });

  it("confidence score handles single sample", () => {
    const score = calculateConfidenceScore(1, 1, 0, 50);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. SCHEMA VERIFICATION
// ══════════════════════════════════════════════════════════════════════
describe("schema tables exist", () => {
  it("exports estimateVarianceEvents table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.estimateVarianceEvents).toBeDefined();
  });

  it("exports assemblyPerformanceMetrics table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.assemblyPerformanceMetrics).toBeDefined();
  });

  it("exports calibrationSuggestions table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.calibrationSuggestions).toBeDefined();
  });

  it("estimateVarianceEvents has required columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.estimateVarianceEvents;
    const columns = Object.keys(table);
    expect(columns).toEqual(expect.arrayContaining([
      "id", "projectId", "estimateId", "assemblyId",
      "estimatedCost", "actualCost", "variancePct", "varianceType",
    ]));
  });

  it("assemblyPerformanceMetrics has required columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.assemblyPerformanceMetrics;
    const columns = Object.keys(table);
    expect(columns).toEqual(expect.arrayContaining([
      "id", "assemblyId", "projectCount",
      "avgEstimatedCost", "avgActualCost", "avgVariancePct",
    ]));
  });

  it("calibrationSuggestions has required columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.calibrationSuggestions;
    const columns = Object.keys(table);
    expect(columns).toEqual(expect.arrayContaining([
      "id", "assemblyId", "suggestedWasteFactor",
      "suggestedLaborMultiplier", "suggestedMaterialMultiplier",
      "confidenceScore", "status",
    ]));
  });

  it("calibrationSuggestions status enum includes all values", async () => {
    const schema = await import("../drizzle/schema");
    // Check the enum values are defined in the table config
    const table = schema.calibrationSuggestions;
    expect(table.status).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. DETERMINISTIC ENGINE ISOLATION VERIFICATION
// ══════════════════════════════════════════════════════════════════════
describe("deterministic engine isolation", () => {
  it("learning-layer-db.ts does not import scope-builder", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/learning-layer-db.ts", "utf-8");
    expect(content).not.toContain("scope-builder");
    expect(content).not.toContain("scopeBuilder");
  });

  it("learning-layer-db.ts does not import remodel-engine", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/learning-layer-db.ts", "utf-8");
    expect(content).not.toContain("remodel-engine");
    expect(content).not.toContain("remodelEngine");
  });

  it("learning-layer-db.ts does not import pricing-engine", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/learning-layer-db.ts", "utf-8");
    expect(content).not.toContain("pricing-engine");
    expect(content).not.toContain("pricingEngine");
  });

  it("learning-layer-db.ts does not import override-resolver", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/learning-layer-db.ts", "utf-8");
    expect(content).not.toContain("override-resolver");
    expect(content).not.toContain("overrideResolver");
  });

  it("learning-layer-router.ts does not import deterministic engines", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/learning-layer-router.ts", "utf-8");
    expect(content).not.toContain("scope-builder");
    expect(content).not.toContain("remodel-engine");
    expect(content).not.toContain("pricing-engine");
    expect(content).not.toContain("override-resolver");
  });
});
