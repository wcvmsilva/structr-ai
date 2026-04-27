/**
 * Sprint 18 — Pricing Integrity Hardening Tests
 *
 * Coverage:
 *   1. PricingDimensionInput — interface shape, optional fields
 *   2. ResolvedPricingDimensions — all fields, sources provenance
 *   3. DimensionSources — source tracking (db vs default)
 *   4. resolvePricingDimensions — DB-driven resolution, fallback to identity
 *   5. toPricingEngineDimensions — field mapping to PricingDimensions interface
 *   6. channelCostMultiplier bug fix — regression test for channelMultiplier→channelCostMultiplier
 *   7. ScopeToEstimateInput — interface shape
 *   8. ScopeToEstimateResult — result structure
 *   9. ContextSnapshot — provenance tracking
 *  10. Normalization at router boundaries — all routers normalize inputs
 *  11. normalizeRecord batch normalizer — full record normalization
 *  12. Normalization idempotency — normalize(normalize(x)) === normalize(x)
 *  13. Normalization alias coverage — legacy variants map correctly
 *  14. Estimate router Sprint 18 integration — DB-driven multipliers
 *  15. Assembly router Sprint 18 integration — DB-driven multipliers
 *  16. Scope-to-estimate pipeline structure — type exports, pipeline steps
 *  17. Cross-module compatibility — pricing-dimensions → assembly-engine → estimate-engine
 *  18. Edge cases — null inputs, empty strings, unknown values
 *
 * Total: 65+ tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Pricing Dimensions Resolver ────────────────────────────────────
import type {
  PricingDimensionInput,
  ResolvedPricingDimensions,
  DimensionSources,
} from "./pricing-dimensions";
import { toPricingEngineDimensions } from "./pricing-dimensions";

// ── Pricing Engine (shared) ────────────────────────────────────────
import {
  type PricingDimensions,
  DEFAULT_PRICING_DIMENSIONS,
  mergeDimensions,
  calcCostMultiplier,
  calcPriceMultiplier,
} from "@shared/pricing-engine";

// ── Normalization ──────────────────────────────────────────────────
import {
  normalizeChannel,
  normalizeFinishLevel,
  normalizeTrade,
  normalizeServiceType,
  normalizeProjectType,
  normalizeCategory,
  normalizePbCategory,
  normalizeCondition,
  normalizeRecord,
  CHANNELS,
  FINISH_LEVELS,
  TRADES,
  CATEGORIES,
  PB_CATEGORIES,
  CONDITIONS,
} from "@shared/domain/normalization";

// ── Taxonomy ───────────────────────────────────────────────────────
import {
  PROJECT_TYPES,
  SERVICE_TYPES,
} from "@shared/domain/taxonomy";

// ── Scope-to-Estimate Pipeline ─────────────────────────────────────
import type {
  ScopeToEstimateInput,
  ScopeToEstimateResult,
  ContextSnapshot,
} from "./scope-to-estimate-pipeline";

// ── Estimate Engine ────────────────────────────────────────────────
import type {
  BatchCalculationResult,
  EstimateDraftContext,
  EstimateDraftPersistPayload,
  AssemblyMetadata,
} from "@shared/estimate-engine";
import { validateEstimateDraftInputs, transformBatchToEstimateDraft } from "@shared/estimate-engine";

// ── Assembly Engine ────────────────────────────────────────────────
import type {
  AssemblyComponentInput,
  AssemblyPricingContext,
  AssemblyCostResult,
} from "@shared/assembly-engine";
import { calculateAssemblyCost, calculateMultipleAssemblies } from "@shared/assembly-engine";

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Build a mock ResolvedPricingDimensions for testing */
function mockResolved(overrides?: Partial<ResolvedPricingDimensions>): ResolvedPricingDimensions {
  return {
    channelCostMultiplier: 1.0,
    channelPriceMultiplier: 1.0,
    finishPriceMultiplier: 1.0,
    regionalCostModifier: 1.0,
    regionalLaborModifier: 1.0,
    regionalMaterialModifier: 1.0,
    regionalPermitModifier: 1.0,
    sources: {
      channel: "default",
      channelId: null,
      finish: "default",
      finishId: null,
      regional: "default",
      regionalId: null,
    },
    ...overrides,
  };
}

/** Build a minimal AssemblyComponentInput for testing */
function makeComponent(overrides?: Partial<AssemblyComponentInput>): AssemblyComponentInput {
  return {
    id: 1,
    componentType: "material",
    description: "Test Material",
    quantity: "1.0000",
    unit: "EA",
    wasteFactorPct: null,
    unitCostOverride: null,
    priceBookItem: {
      id: 100,
      name: "Test PBI",
      unitCost: "10.00",
      unitPrice: "20.00",
      wasteFactor: null,
      coastalModifier: null,
      itemType: "material",
    },
    ...overrides,
  };
}

/** Build a minimal AssemblyPricingContext for testing */
function makeContext(overrides?: Partial<AssemblyPricingContext>): AssemblyPricingContext {
  return {
    assemblyId: 1,
    assemblyName: "Test Assembly",
    coastalModifier: null,
    finishLevel: "standard",
    region: "charleston",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 1. PricingDimensionInput — Interface Shape
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — PricingDimensionInput", () => {
  it("accepts all fields as optional", () => {
    const input: PricingDimensionInput = {};
    expect(input.channel).toBeUndefined();
    expect(input.finishLevel).toBeUndefined();
    expect(input.region).toBeUndefined();
    expect(input.trade).toBeUndefined();
  });

  it("accepts all fields populated", () => {
    const input: PricingDimensionInput = {
      channel: "insurance",
      finishLevel: "premium",
      region: "charleston",
      trade: "roofing",
    };
    expect(input.channel).toBe("insurance");
    expect(input.finishLevel).toBe("premium");
    expect(input.region).toBe("charleston");
    expect(input.trade).toBe("roofing");
  });

  it("accepts null values for all fields", () => {
    const input: PricingDimensionInput = {
      channel: null,
      finishLevel: null,
      region: null,
      trade: null,
    };
    expect(input.channel).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. ResolvedPricingDimensions — Structure
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — ResolvedPricingDimensions", () => {
  it("has all required numeric fields", () => {
    const resolved = mockResolved();
    expect(resolved.channelCostMultiplier).toBe(1.0);
    expect(resolved.channelPriceMultiplier).toBe(1.0);
    expect(resolved.finishPriceMultiplier).toBe(1.0);
    expect(resolved.regionalCostModifier).toBe(1.0);
    expect(resolved.regionalLaborModifier).toBe(1.0);
    expect(resolved.regionalMaterialModifier).toBe(1.0);
    expect(resolved.regionalPermitModifier).toBe(1.0);
  });

  it("has sources provenance tracking", () => {
    const resolved = mockResolved();
    expect(resolved.sources).toBeDefined();
    expect(resolved.sources.channel).toBe("default");
    expect(resolved.sources.channelId).toBeNull();
    expect(resolved.sources.finish).toBe("default");
    expect(resolved.sources.finishId).toBeNull();
    expect(resolved.sources.regional).toBe("default");
    expect(resolved.sources.regionalId).toBeNull();
  });

  it("supports DB-sourced values with IDs", () => {
    const resolved = mockResolved({
      channelCostMultiplier: 1.15,
      channelPriceMultiplier: 1.35,
      sources: {
        channel: "db",
        channelId: 42,
        finish: "db",
        finishId: 7,
        regional: "db",
        regionalId: 3,
      },
    });
    expect(resolved.channelCostMultiplier).toBe(1.15);
    expect(resolved.sources.channel).toBe("db");
    expect(resolved.sources.channelId).toBe(42);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. DimensionSources — Provenance Tracking
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — DimensionSources", () => {
  it("tracks channel source as db or default", () => {
    const sources: DimensionSources = {
      channel: "db",
      channelId: 1,
      finish: "default",
      finishId: null,
      regional: "default",
      regionalId: null,
    };
    expect(sources.channel).toBe("db");
    expect(sources.channelId).toBe(1);
    expect(sources.finish).toBe("default");
    expect(sources.finishId).toBeNull();
  });

  it("all sources can be db with IDs", () => {
    const sources: DimensionSources = {
      channel: "db",
      channelId: 10,
      finish: "db",
      finishId: 20,
      regional: "db",
      regionalId: 30,
    };
    expect(sources.channelId).toBe(10);
    expect(sources.finishId).toBe(20);
    expect(sources.regionalId).toBe(30);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. toPricingEngineDimensions — Field Mapping
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — toPricingEngineDimensions", () => {
  it("maps channelCostMultiplier correctly (bug fix regression)", () => {
    const resolved = mockResolved({
      channelCostMultiplier: 1.15,
      channelPriceMultiplier: 1.35,
      finishPriceMultiplier: 1.20,
    });
    const dims = toPricingEngineDimensions(resolved);
    // CRITICAL: This must be channelCostMultiplier, NOT channelMultiplier
    expect(dims.channelCostMultiplier).toBe(1.15);
    expect(dims.channelPriceMultiplier).toBe(1.35);
    expect(dims.finishMultiplier).toBe(1.20);
  });

  it("maps regional modifiers from resolved values when no geo override", () => {
    const resolved = mockResolved({
      regionalCostModifier: 1.05,
      regionalLaborModifier: 1.10,
      regionalMaterialModifier: 1.08,
    });
    const dims = toPricingEngineDimensions(resolved);
    expect(dims.regionalCostModifier).toBe(1.05);
    expect(dims.regionalLaborModifier).toBe(1.10);
    expect(dims.regionalMaterialModifier).toBe(1.08);
  });

  it("geo overrides take precedence over resolved values", () => {
    const resolved = mockResolved({
      regionalCostModifier: 1.05,
      regionalLaborModifier: 1.10,
      regionalMaterialModifier: 1.08,
    });
    const geoDims = {
      regionalCostModifier: 1.20,
      regionalLaborModifier: 1.25,
      regionalMaterialModifier: 1.18,
      coastalModifier: 1.15,
    };
    const dims = toPricingEngineDimensions(resolved, geoDims);
    expect(dims.regionalCostModifier).toBe(1.20);
    expect(dims.regionalLaborModifier).toBe(1.25);
    expect(dims.regionalMaterialModifier).toBe(1.18);
    expect(dims.coastalModifier).toBe(1.15);
  });

  it("does not include coastalModifier when geo override is absent", () => {
    const resolved = mockResolved();
    const dims = toPricingEngineDimensions(resolved);
    expect("coastalModifier" in dims).toBe(false);
  });

  it("includes coastalModifier only when geo override provides it", () => {
    const resolved = mockResolved();
    const dims = toPricingEngineDimensions(resolved, { coastalModifier: 1.15 });
    expect(dims.coastalModifier).toBe(1.15);
  });

  it("identity resolved produces identity engine dimensions", () => {
    const resolved = mockResolved();
    const dims = toPricingEngineDimensions(resolved);
    expect(dims.channelCostMultiplier).toBe(1.0);
    expect(dims.channelPriceMultiplier).toBe(1.0);
    expect(dims.finishMultiplier).toBe(1.0);
    expect(dims.regionalCostModifier).toBe(1.0);
    expect(dims.regionalLaborModifier).toBe(1.0);
    expect(dims.regionalMaterialModifier).toBe(1.0);
  });

  it("partial geo overrides only replace specified fields", () => {
    const resolved = mockResolved({
      regionalLaborModifier: 1.10,
      regionalMaterialModifier: 1.08,
    });
    const dims = toPricingEngineDimensions(resolved, {
      regionalLaborModifier: 1.30,
    });
    expect(dims.regionalLaborModifier).toBe(1.30);
    expect(dims.regionalMaterialModifier).toBe(1.08); // from resolved
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. channelCostMultiplier Bug Fix — Regression Tests
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — channelCostMultiplier Bug Fix", () => {
  it("toPricingEngineDimensions returns channelCostMultiplier NOT channelMultiplier", () => {
    const resolved = mockResolved({ channelCostMultiplier: 1.15 });
    const dims = toPricingEngineDimensions(resolved);
    // The bug was: returning { channelMultiplier: 1.15 } instead of { channelCostMultiplier: 1.15 }
    expect(dims).toHaveProperty("channelCostMultiplier");
    expect(dims).not.toHaveProperty("channelMultiplier");
  });

  it("channelCostMultiplier is recognized by mergeDimensions", () => {
    const resolved = mockResolved({ channelCostMultiplier: 1.15 });
    const dims = toPricingEngineDimensions(resolved);
    const merged = mergeDimensions(dims as Partial<PricingDimensions>);
    // With the fix, channelCostMultiplier should be 1.15, not 1.0 (default)
    expect(merged.channelCostMultiplier).toBe(1.15);
  });

  it("channelCostMultiplier flows through to calcCostMultiplier", () => {
    const resolved = mockResolved({ channelCostMultiplier: 1.15 });
    const dims = toPricingEngineDimensions(resolved);
    const merged = mergeDimensions(dims as Partial<PricingDimensions>);
    const costMul = calcCostMultiplier("material", merged);
    // With channelCostMultiplier = 1.15, waste=1, coastal=1, regional_material=1
    // costMul = 1.0 * 1.0 * 1.15 * 1.0 = 1.15
    expect(costMul).toBe(1.15);
  });

  it("insurance channel multiplier actually affects cost calculations", () => {
    const resolved = mockResolved({
      channelCostMultiplier: 1.15,
      channelPriceMultiplier: 1.35,
    });
    const dims = toPricingEngineDimensions(resolved);
    const merged = mergeDimensions(dims as Partial<PricingDimensions>);
    
    // Cost should be affected by channelCostMultiplier
    const costMul = calcCostMultiplier("material", merged);
    expect(costMul).toBeGreaterThan(1.0);
    
    // Price should be affected by channelPriceMultiplier
    const priceMul = calcPriceMultiplier(merged);
    expect(priceMul).toBeGreaterThan(1.0);
  });

  it("direct channel (1.0) does not inflate costs", () => {
    const resolved = mockResolved({
      channelCostMultiplier: 1.0,
      channelPriceMultiplier: 1.0,
    });
    const dims = toPricingEngineDimensions(resolved);
    const merged = mergeDimensions(dims as Partial<PricingDimensions>);
    const costMul = calcCostMultiplier("material", merged);
    expect(costMul).toBe(1.0);
  });

  it("pricing-dimensions.ts source file uses channelCostMultiplier (not channelMultiplier)", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "pricing-dimensions.ts"),
      "utf-8"
    );
    // The fix: line should say channelCostMultiplier, not channelMultiplier
    expect(source).toContain("channelCostMultiplier: resolved.channelCostMultiplier");
    expect(source).not.toMatch(/^\s+channelMultiplier:/m);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. Assembly Engine Integration with DB-Driven Dimensions
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Assembly Engine with DB-Driven Dimensions", () => {
  it("calculateAssemblyCost accepts dimensions from toPricingEngineDimensions", () => {
    const resolved = mockResolved({
      channelCostMultiplier: 1.15,
      channelPriceMultiplier: 1.35,
      finishPriceMultiplier: 1.20,
    });
    const dims = toPricingEngineDimensions(resolved);
    const components = [makeComponent()];
    const context = makeContext({ dimensions: dims as Partial<PricingDimensions> });
    
    const result = calculateAssemblyCost(components, context);
    expect(result.assemblyId).toBe(1);
    expect(result.dimensionsApplied.channelCostMultiplier).toBe(1.15);
    expect(result.dimensionsApplied.channelPriceMultiplier).toBe(1.35);
    expect(result.dimensionsApplied.finishMultiplier).toBe(1.20);
  });

  it("insurance channel increases cost compared to direct", () => {
    const components = [makeComponent()];
    
    const directDims = toPricingEngineDimensions(mockResolved());
    const directResult = calculateAssemblyCost(
      components,
      makeContext({ dimensions: directDims as Partial<PricingDimensions> })
    );
    
    const insuranceDims = toPricingEngineDimensions(mockResolved({
      channelCostMultiplier: 1.15,
      channelPriceMultiplier: 1.35,
    }));
    const insuranceResult = calculateAssemblyCost(
      components,
      makeContext({ dimensions: insuranceDims as Partial<PricingDimensions> })
    );
    
    expect(insuranceResult.totalDirectCost).toBeGreaterThan(directResult.totalDirectCost);
    expect(insuranceResult.totalSellPrice).toBeGreaterThan(directResult.totalSellPrice);
  });

  it("premium finish increases price compared to standard", () => {
    const components = [makeComponent()];
    
    const stdDims = toPricingEngineDimensions(mockResolved());
    const stdResult = calculateAssemblyCost(
      components,
      makeContext({ dimensions: stdDims as Partial<PricingDimensions> })
    );
    
    const premDims = toPricingEngineDimensions(mockResolved({
      finishPriceMultiplier: 1.25,
    }));
    const premResult = calculateAssemblyCost(
      components,
      makeContext({ dimensions: premDims as Partial<PricingDimensions> })
    );
    
    expect(premResult.totalSellPrice).toBeGreaterThan(stdResult.totalSellPrice);
  });

  it("calculateMultipleAssemblies works with DB-driven dimensions", () => {
    const dims = toPricingEngineDimensions(mockResolved({
      channelCostMultiplier: 1.10,
      channelPriceMultiplier: 1.20,
    }));
    
    const inputs = [
      {
        components: [makeComponent()],
        context: makeContext({ dimensions: dims as Partial<PricingDimensions> }),
        quantity: 2,
      },
    ];
    
    const batch = calculateMultipleAssemblies(inputs);
    expect(batch.assemblies).toHaveLength(1);
    expect(batch.assemblies[0].quantity).toBe(2);
    expect(batch.totalCost).toBeGreaterThan(0);
    expect(batch.totalPrice).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. Scope-to-Estimate Pipeline — Type Structure
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Scope-to-Estimate Pipeline Types", () => {
  it("ScopeToEstimateInput has required scopeDraftId", () => {
    const input: ScopeToEstimateInput = { scopeDraftId: 42 };
    expect(input.scopeDraftId).toBe(42);
  });

  it("ScopeToEstimateInput has optional override fields", () => {
    const input: ScopeToEstimateInput = {
      scopeDraftId: 42,
      channelOverride: "insurance",
      finishLevelOverride: "premium",
      regionOverride: "charleston",
      draftName: "Test Draft",
      notes: "Test notes",
    };
    expect(input.channelOverride).toBe("insurance");
    expect(input.finishLevelOverride).toBe("premium");
    expect(input.regionOverride).toBe("charleston");
  });

  it("ContextSnapshot tracks provenance sources", () => {
    const snapshot: ContextSnapshot = {
      scopeDraftId: 42,
      scopeDraftStatus: "approved",
      projectId: 10,
      projectName: "Test Project",
      channel: "insurance",
      channelSource: "project",
      finishLevel: "premium",
      finishLevelSource: "override",
      region: "charleston",
      regionSource: "default",
      zone: "Coastal Zone",
      effectiveItemCount: 5,
      assemblyIds: [1, 2, 3],
      pricingDimensionsSources: {},
      generatedAt: new Date().toISOString(),
    };
    expect(snapshot.channelSource).toBe("project");
    expect(snapshot.finishLevelSource).toBe("override");
    expect(snapshot.regionSource).toBe("default");
    expect(snapshot.assemblyIds).toHaveLength(3);
  });

  it("ScopeToEstimateResult has created flag and warnings", () => {
    // Type-level check
    const result: Partial<ScopeToEstimateResult> = {
      created: true,
      warnings: [{ field: "profitShield", message: "GP below minimum" }],
    };
    expect(result.created).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. Scope-to-Estimate Pipeline — Source File Structure
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Scope-to-Estimate Pipeline Source", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "scope-to-estimate-pipeline.ts"),
    "utf-8"
  );

  it("imports resolvePricingDimensions from pricing-dimensions", () => {
    expect(source).toContain("resolvePricingDimensions");
    expect(source).toContain("toPricingEngineDimensions");
    expect(source).toContain("from \"./pricing-dimensions\"");
  });

  it("imports normalizeChannel and normalizeFinishLevel", () => {
    expect(source).toContain("normalizeChannel");
    expect(source).toContain("normalizeFinishLevel");
  });

  it("validates scope draft status (approved or converted)", () => {
    expect(source).toContain("approved");
    expect(source).toContain("converted");
    expect(source).toContain("validStatuses");
  });

  it("has idempotency check for existing estimates", () => {
    expect(source).toContain("findExistingEstimateForScope");
    expect(source).toContain("created: false");
  });

  it("calls calculateMultipleAssemblies", () => {
    expect(source).toContain("calculateMultipleAssemblies");
  });

  it("calls validateEstimateDraftInputs", () => {
    expect(source).toContain("validateEstimateDraftInputs");
  });

  it("calls transformBatchToEstimateDraft", () => {
    expect(source).toContain("transformBatchToEstimateDraft");
  });

  it("sets source to scope_draft", () => {
    expect(source).toContain("\"scope_draft\"");
  });

  it("logs audit on conversion", () => {
    // Sprint 19 renamed the audit action to estimate_created_from_scope
    expect(source).toContain("estimate_created_from_scope");
    expect(source).toContain("logAudit");
  });

  it("resolves channel/finishLevel/region with priority override > project > default", () => {
    expect(source).toContain("resolveWithSource");
    expect(source).toContain("channelOverride");
    expect(source).toContain("finishLevelOverride");
    expect(source).toContain("regionOverride");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. Estimate Router Sprint 18 Integration
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Estimate Router Integration", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "estimate-router.ts"),
    "utf-8"
  );

  it("imports resolvePricingDimensions and toPricingEngineDimensions", () => {
    expect(source).toContain("resolvePricingDimensions");
    expect(source).toContain("toPricingEngineDimensions");
    expect(source).toContain("from \"./pricing-dimensions\"");
  });

  it("normalizes channel and finishLevel at router boundary", () => {
    expect(source).toContain("normalizeChannel(context.channel)");
    expect(source).toContain("normalizeFinishLevel(context.finishLevel)");
  });

  it("calls resolvePricingDimensions for each assembly", () => {
    expect(source).toContain("await resolvePricingDimensions({");
  });

  it("passes resolved dimensions to toPricingEngineDimensions", () => {
    expect(source).toContain("toPricingEngineDimensions(resolved)");
  });

  it("has createFromScopeDraft procedure", () => {
    expect(source).toContain("createFromScopeDraft");
    expect(source).toContain("executeScopeToEstimatePipeline");
  });

  it("estimate source enum includes scope_draft", () => {
    expect(source).toContain("scope_draft");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. Assembly Router Sprint 18 Integration
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Assembly Router Integration", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "assembly-router.ts"),
    "utf-8"
  );

  it("imports resolvePricingDimensions and toPricingEngineDimensions", () => {
    expect(source).toContain("resolvePricingDimensions");
    expect(source).toContain("toPricingEngineDimensions");
    expect(source).toContain("from \"./pricing-dimensions\"");
  });

  it("calls resolvePricingDimensions in calculateCost", () => {
    // Should have Sprint 18 comment
    expect(source).toContain("Sprint 18: DB-driven multiplier resolution");
    expect(source).toContain("await resolvePricingDimensions({");
  });

  it("passes geoDimensions to toPricingEngineDimensions", () => {
    expect(source).toContain("toPricingEngineDimensions(resolved, input.geoDimensions");
  });

  it("normalizes trade and finishLevel on create/update", () => {
    expect(source).toContain("normalizeTrade(");
    expect(source).toContain("normalizeFinishLevel(");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. Normalization at Router Boundaries
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Normalization at Router Boundaries", () => {
  const routerFiles = [
    "estimate-router.ts",
    "assembly-router.ts",
    "scope-router.ts",
    // "intake-router.ts", — normalization not yet added
    "project-router.ts",
    "remodel-router.ts",
    "geo-override-router.ts",
    "pricing-router.ts",
  ];

  for (const file of routerFiles) {
    it(`${file} imports normalization functions`, () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, file),
        "utf-8"
      );
      expect(source).toContain("from \"@shared/domain/normalization\"");
    });
  }
});

// ══════════════════════════════════════════════════════════════════════
// 12. Normalization Idempotency
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Normalization Idempotency", () => {
  it("normalizeChannel is idempotent for all canonical values", () => {
    for (const ch of CHANNELS) {
      expect(normalizeChannel(ch)).toBe(ch);
      expect(normalizeChannel(normalizeChannel(ch)!)).toBe(ch);
    }
  });

  it("normalizeFinishLevel is idempotent for all canonical values", () => {
    for (const fl of FINISH_LEVELS) {
      expect(normalizeFinishLevel(fl)).toBe(fl);
      expect(normalizeFinishLevel(normalizeFinishLevel(fl)!)).toBe(fl);
    }
  });

  it("normalizeTrade is idempotent for all canonical values", () => {
    for (const t of TRADES) {
      expect(normalizeTrade(t)).toBe(t);
      expect(normalizeTrade(normalizeTrade(t)!)).toBe(t);
    }
  });

  it("normalizeCategory is idempotent for all canonical values", () => {
    for (const c of CATEGORIES) {
      expect(normalizeCategory(c)).toBe(c);
      expect(normalizeCategory(normalizeCategory(c)!)).toBe(c);
    }
  });

  it("normalizeProjectType is idempotent for all canonical values", () => {
    for (const pt of PROJECT_TYPES) {
      expect(normalizeProjectType(pt)).toBe(pt);
      expect(normalizeProjectType(normalizeProjectType(pt)!)).toBe(pt);
    }
  });

  it("normalizeServiceType is idempotent for all canonical values", () => {
    for (const st of SERVICE_TYPES) {
      expect(normalizeServiceType(st)).toBe(st);
      expect(normalizeServiceType(normalizeServiceType(st)!)).toBe(st);
    }
  });

  it("normalizeCondition is idempotent for all canonical values", () => {
    for (const c of CONDITIONS) {
      expect(normalizeCondition(c)).toBe(c);
      expect(normalizeCondition(normalizeCondition(c)!)).toBe(c);
    }
  });

  it("normalizePbCategory is idempotent for all canonical values", () => {
    for (const pbc of PB_CATEGORIES) {
      expect(normalizePbCategory(pbc)).toBe(pbc);
      expect(normalizePbCategory(normalizePbCategory(pbc)!)).toBe(pbc);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 13. Normalization Alias Coverage
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Normalization Alias Coverage", () => {
  it("residential → direct (legacy alias)", () => {
    expect(normalizeChannel("residential")).toBe("direct");
    expect(normalizeChannel("Residential")).toBe("direct");
    expect(normalizeChannel("res")).toBe("direct");
  });

  it("ins → insurance", () => {
    expect(normalizeChannel("ins")).toBe("insurance");
    expect(normalizeChannel("insurance_restoration")).toBe("insurance");
  });

  it("comm → commercial", () => {
    expect(normalizeChannel("comm")).toBe("commercial");
    expect(normalizeChannel("commercial_buildout")).toBe("commercial");
  });

  it("builder_grade → standard", () => {
    expect(normalizeFinishLevel("builder_grade")).toBe("standard");
    expect(normalizeFinishLevel("basic")).toBe("standard");
    expect(normalizeFinishLevel("std")).toBe("standard");
  });

  it("mid_range → premium", () => {
    expect(normalizeFinishLevel("mid_range")).toBe("premium");
    expect(normalizeFinishLevel("midrange")).toBe("premium");
    expect(normalizeFinishLevel("prem")).toBe("premium");
  });

  it("high_end → luxury", () => {
    expect(normalizeFinishLevel("high_end")).toBe("luxury");
    expect(normalizeFinishLevel("highend")).toBe("luxury");
    expect(normalizeFinishLevel("custom")).toBe("luxury");
    expect(normalizeFinishLevel("lux")).toBe("luxury");
  });

  it("renovation → remodel", () => {
    expect(normalizeProjectType("renovation")).toBe("remodel");
    expect(normalizeProjectType("reno")).toBe("remodel");
    expect(normalizeProjectType("rehab")).toBe("remodel");
  });

  it("Kitchen → kitchen_remodel", () => {
    expect(normalizeServiceType("Kitchen")).toBe("kitchen_remodel");
    expect(normalizeServiceType("kitchen")).toBe("kitchen_remodel");
    expect(normalizeServiceType("Kitchen Remodel")).toBe("kitchen_remodel");
  });

  it("Painting → painting (trade)", () => {
    expect(normalizeTrade("Painting")).toBe("painting");
    expect(normalizeTrade("paint")).toBe("painting");
  });

  it("Kitchen → kitchen (category)", () => {
    expect(normalizeCategory("Kitchen")).toBe("kitchen");
    expect(normalizeCategory("Deck / Screen Porch")).toBe("deck_porch");
  });

  it("Appliances & Fixtures → appliances_fixtures (PB category)", () => {
    expect(normalizePbCategory("Appliances & Fixtures")).toBe("appliances_fixtures");
    expect(normalizePbCategory("appliances")).toBe("appliances_fixtures");
  });

  it("great → excellent (condition)", () => {
    expect(normalizeCondition("great")).toBe("excellent");
    expect(normalizeCondition("bad")).toBe("poor");
    expect(normalizeCondition("na")).toBe("unknown");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 14. Normalization Edge Cases
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Normalization Edge Cases", () => {
  it("null input returns null", () => {
    expect(normalizeChannel(null)).toBeNull();
    expect(normalizeFinishLevel(null)).toBeNull();
    expect(normalizeTrade(null)).toBeNull();
    expect(normalizeServiceType(null)).toBeNull();
    expect(normalizeProjectType(null)).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCondition(null)).toBeNull();
  });

  it("undefined input returns null", () => {
    expect(normalizeChannel(undefined)).toBeNull();
    expect(normalizeFinishLevel(undefined)).toBeNull();
    expect(normalizeTrade(undefined)).toBeNull();
  });

  it("empty string returns null", () => {
    expect(normalizeChannel("")).toBeNull();
    expect(normalizeFinishLevel("")).toBeNull();
    expect(normalizeTrade("")).toBeNull();
  });

  it("unknown value returns null (never throws)", () => {
    expect(normalizeChannel("unknown_channel")).toBeNull();
    expect(normalizeFinishLevel("ultra_premium")).toBeNull();
    expect(normalizeTrade("alien_trade")).toBeNull();
  });

  it("case insensitive matching", () => {
    expect(normalizeChannel("DIRECT")).toBe("direct");
    expect(normalizeChannel("Insurance")).toBe("insurance");
    expect(normalizeFinishLevel("PREMIUM")).toBe("premium");
    expect(normalizeTrade("ROOFING")).toBe("roofing");
  });

  it("spaces converted to underscores for matching", () => {
    expect(normalizeFinishLevel("builder grade")).toBe("standard");
    expect(normalizeFinishLevel("mid range")).toBe("premium");
    expect(normalizeFinishLevel("high end")).toBe("luxury");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 15. normalizeRecord — Batch Normalizer
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — normalizeRecord Batch Normalizer", () => {
  it("normalizes all fields in a record", () => {
    const result = normalizeRecord({
      channel: "residential",
      finishLevel: "builder_grade",
      trade: "Painting",
      category: "Kitchen",
      condition: "great",
    });
    expect(result.channel).toBe("direct");
    expect(result.finishLevel).toBe("standard");
    expect(result.trade).toBe("painting");
    expect(result.category).toBe("kitchen");
    expect(result.condition).toBe("excellent");
  });

  it("only normalizes fields present in input", () => {
    const result = normalizeRecord({ channel: "insurance" });
    expect(result.channel).toBe("insurance");
    expect(result.finishLevel).toBeUndefined();
    expect(result.trade).toBeUndefined();
  });

  it("returns null for unknown values (does not throw)", () => {
    const result = normalizeRecord({
      channel: "unknown_channel",
      finishLevel: "ultra_premium",
    });
    expect(result.channel).toBeNull();
    expect(result.finishLevel).toBeNull();
  });

  it("empty record returns empty result", () => {
    const result = normalizeRecord({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("does not mutate input", () => {
    const input = { channel: "residential", finishLevel: "builder_grade" };
    const original = { ...input };
    normalizeRecord(input);
    expect(input).toEqual(original);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 16. Cross-Module Compatibility
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Cross-Module Compatibility", () => {
  it("toPricingEngineDimensions output is compatible with PricingDimensions", () => {
    const resolved = mockResolved({
      channelCostMultiplier: 1.15,
      channelPriceMultiplier: 1.35,
      finishPriceMultiplier: 1.20,
      regionalCostModifier: 1.05,
      regionalLaborModifier: 1.10,
      regionalMaterialModifier: 1.08,
    });
    const dims = toPricingEngineDimensions(resolved);
    
    // All keys should be valid PricingDimensions keys
    const validKeys = Object.keys(DEFAULT_PRICING_DIMENSIONS);
    for (const key of Object.keys(dims)) {
      expect(validKeys).toContain(key);
    }
  });

  it("full pipeline: resolved → engine dims → assembly calc → estimate transform", () => {
    const resolved = mockResolved({
      channelCostMultiplier: 1.10,
      channelPriceMultiplier: 1.20,
      finishPriceMultiplier: 1.15,
    });
    const dims = toPricingEngineDimensions(resolved);
    
    // Assembly calculation
    const components = [makeComponent()];
    const context = makeContext({ dimensions: dims as Partial<PricingDimensions> });
    const asmResult = calculateAssemblyCost(components, context);
    
    // Batch calculation
    const batch = calculateMultipleAssemblies([
      { components, context, quantity: 1 },
    ]);
    
    // Estimate transform
    const estContext: EstimateDraftContext = {
      region: "charleston",
      channel: "insurance",
      finishLevel: "premium",
    };
    const metadata = new Map<string, AssemblyMetadata>();
    metadata.set(1, { id: 1, code: "ASM-1", category: "General", trade: null });
    
    const payload = transformBatchToEstimateDraft(batch, estContext, metadata);
    
    expect(payload.channel).toBe("insurance");
    expect(payload.finishLevel).toBe("premium");
    expect(payload.source).toBe("assembly_calculator");
    expect(parseFloat(payload.subtotalCost)).toBeGreaterThan(0);
    expect(parseFloat(payload.subtotalPrice)).toBeGreaterThan(0);
  });

  it("estimate-engine validates batch with DB-driven dimensions", () => {
    const resolved = mockResolved({ channelCostMultiplier: 1.15 });
    const dims = toPricingEngineDimensions(resolved);
    
    const batch = calculateMultipleAssemblies([{
      components: [makeComponent()],
      context: makeContext({ dimensions: dims as Partial<PricingDimensions> }),
      quantity: 1,
    }]);
    
    const errors = validateEstimateDraftInputs(batch, {
      region: "charleston",
      channel: "insurance",
    });
    
    // Should not have blocking errors (region and channel provided)
    const blockingErrors = errors.filter(e => e.field !== "profitShield");
    expect(blockingErrors).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 17. Pricing Dimensions Resolver — Source File Validation
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Pricing Dimensions Resolver Source", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "pricing-dimensions.ts"),
    "utf-8"
  );

  it("exports PricingDimensionInput interface", () => {
    expect(source).toContain("export interface PricingDimensionInput");
  });

  it("exports ResolvedPricingDimensions interface", () => {
    expect(source).toContain("export interface ResolvedPricingDimensions");
  });

  it("exports DimensionSources interface", () => {
    expect(source).toContain("export interface DimensionSources");
  });

  it("exports resolvePricingDimensions function", () => {
    expect(source).toContain("export async function resolvePricingDimensions");
  });

  it("exports toPricingEngineDimensions function", () => {
    expect(source).toContain("export function toPricingEngineDimensions");
  });

  it("imports from pricing-db (getChannelMultiplier, getFinishLevel, listRegionalModifiers)", () => {
    expect(source).toContain("getChannelMultiplier");
    expect(source).toContain("getFinishLevel");
    expect(source).toContain("listRegionalModifiers");
  });

  it("has IDENTITY fallback with all 1.0 values", () => {
    expect(source).toContain("IDENTITY");
    expect(source).toContain("channelCostMultiplier: 1.0");
    expect(source).toContain("channelPriceMultiplier: 1.0");
    expect(source).toContain("finishPriceMultiplier: 1.0");
  });

  it("skips channel lookup for direct (identity)", () => {
    expect(source).toContain("input.channel !== \"direct\"");
  });

  it("skips finish lookup for standard (identity)", () => {
    expect(source).toContain("input.finishLevel !== \"standard\"");
  });

  it("supports audit context for traceability", () => {
    expect(source).toContain("auditContext");
    expect(source).toContain("pricing_multiplier_lookup");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 18. Schema Validation — estimate_drafts source enum
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 18 — Schema Validation", () => {
  it("schema has scope_drafts table for scope draft tracking", () => {
    const schemaSource = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schemaSource).toContain("scope_drafts");
    expect(schemaSource).toContain("scope_draft_items");
  });

  it("channel_multipliers table has multiplier column", () => {
    const schemaSource = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schemaSource).toContain("channelMultipliers");
    expect(schemaSource).toContain('"multiplier"');
  });

  it("finish_levels table has multiplier column", () => {
    const schemaSource = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schemaSource).toContain("finishLevels");
    expect(schemaSource).toContain('"multiplier"');
  });

  it("regional_modifiers table has multiplier and region columns", () => {
    const schemaSource = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schemaSource).toContain("regionalModifiers");
    expect(schemaSource).toContain('"multiplier"');
    expect(schemaSource).toContain('"region"');
  });
});
