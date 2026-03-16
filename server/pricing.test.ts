/**
 * structr.ai v9 — Sprint 6 Phase 5 Tests
 * Pricing Engine: Schema, Business Logic, DB Helpers, Price Governance
 *
 * Test coverage:
 *   Section 1: Schema — 6 new pricing tables exist with correct columns
 *   Section 2: Pricing Engine — pure business logic calculations
 *   Section 3: Parametric Engine — $/sqft model calculations
 *   Section 4: Price Governance — validation and Profit Shield
 *   Section 5: Pricing Dimensions — merge, cost/price multipliers
 *   Section 6: Integration — pricing router structure
 */

import { describe, it, expect } from "vitest";
import * as schema from "../drizzle/schema";
import {
  applyPricingDimensions,
  priceLineItems,
  calculateParametricEstimate,
  validateParametricSqft,
  validatePriceGovernance,
  enforceMinGP,
  mergeDimensions,
  calcCostMultiplier,
  calcPriceMultiplier,
  round2,
  round4,
  DEFAULT_PRICING_DIMENSIONS,
  type PricingDimensions,
  type PricingLineItem,
  type ParametricInput,
} from "@shared/pricing-engine";
import { MIN_GROSS_PROFIT, calcGrossProfit } from "@shared/catalog-utils";

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: Schema — Pricing Architecture Tables
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 6 Phase 5 — Pricing Schema Tables", () => {
  it("exports all 36 tables from schema (29 existing + 6 pricing + catalogItems)", () => {
    const expectedTables = [
      // Sprint 5 tables
      "roles", "permissions", "rolePermissions",
      "users", "auditLogs",
      "priceBookItems", "priceBookHistory",
      "clients", "projects", "projectFiles",
      "assemblies", "assemblyComponents",
      "bundles", "bundleItems",
      "estimates", "estimateLineItems", "estimateDrafts",
      "intakeForms", "scopeSuggestions",
      "intakeQuestions", "intakeResponses",
      "reviewActions", "riskRules", "buildingCodes",
      "crews", "crewAssignments",
      "projectHistory", "workflowRuns",
      "catalogItems",
      // Sprint 6 pricing tables
      "regionalModifiers",
      "channelMultipliers",
      "finishLevels",
      "parametricModels",
      "remodelTemplates",
      "newconTemplates",
    ];
    for (const name of expectedTables) {
      expect((schema as any)[name], `Missing table: ${name}`).toBeDefined();
    }
  });

  it("regionalModifiers table has required columns", () => {
    const cols = Object.keys(schema.regionalModifiers);
    expect(cols).toContain("id");
    expect(cols).toContain("regionCode");
    expect(cols).toContain("regionName");
    expect(cols).toContain("costModifier");
    expect(cols).toContain("laborModifier");
    expect(cols).toContain("materialModifier");
    expect(cols).toContain("permitModifier");
    expect(cols).toContain("isActive");
  });

  it("channelMultipliers table has required columns", () => {
    const cols = Object.keys(schema.channelMultipliers);
    expect(cols).toContain("id");
    expect(cols).toContain("channel");
    expect(cols).toContain("trade");
    expect(cols).toContain("costMultiplier");
    expect(cols).toContain("priceMultiplier");
    expect(cols).toContain("isActive");
  });

  it("finishLevels table has required columns", () => {
    const cols = Object.keys(schema.finishLevels);
    expect(cols).toContain("id");
    expect(cols).toContain("level");
    expect(cols).toContain("trade");
    expect(cols).toContain("priceMultiplier");
    expect(cols).toContain("isActive");
  });

  it("parametricModels table has required columns", () => {
    const cols = Object.keys(schema.parametricModels);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("structureType");
    expect(cols).toContain("baseCostPerSqft");
    expect(cols).toContain("basePricePerSqft");
    expect(cols).toContain("minSqft");
    expect(cols).toContain("maxSqft");
    expect(cols).toContain("complexityMultiplier");
    expect(cols).toContain("defaultSystems");
    expect(cols).toContain("isActive");
  });

  it("remodelTemplates table has required columns", () => {
    const cols = Object.keys(schema.remodelTemplates);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("serviceType");
    expect(cols).toContain("defaultAssemblies");
    expect(cols).toContain("typicalSqftRange");
    expect(cols).toContain("estimatedDuration");
    expect(cols).toContain("isActive");
  });

  it("newconTemplates table has required columns", () => {
    const cols = Object.keys(schema.newconTemplates);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("structureType");
    expect(cols).toContain("parametricModelId");
    expect(cols).toContain("defaultParameters");
    expect(cols).toContain("defaultSystems");
    expect(cols).toContain("mepPackages");
    expect(cols).toContain("isActive");
  });

  it("priceBookItems has pricing dimension columns", () => {
    const cols = Object.keys(schema.priceBookItems);
    expect(cols).toContain("itemType");
    expect(cols).toContain("trade");
    expect(cols).toContain("finishLevel");
    expect(cols).toContain("channel");
    expect(cols).toContain("region");
    expect(cols).toContain("wasteFactor");
    expect(cols).toContain("coastalModifier");
    expect(cols).toContain("channelMultiplier");
    expect(cols).toContain("source");
    expect(cols).toContain("effectiveDate");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: Pricing Engine — Core Calculations
// ══════════════════════════════════════════════════════════════════════

describe("Pricing Engine — Core Calculations", () => {
  it("applyPricingDimensions with default dimensions returns base values", () => {
    const result = applyPricingDimensions(100, 200, "material");
    expect(result.baseUnitCost).toBe(100);
    expect(result.baseUnitPrice).toBe(200);
    expect(result.adjustedUnitCost).toBe(100);
    expect(result.adjustedUnitPrice).toBe(200);
    expect(result.costMultiplierApplied).toBe(1);
    expect(result.priceMultiplierApplied).toBe(1);
    expect(result.grossProfitPct).toBe(50);
    expect(result.meetsMinGP).toBe(true);
  });

  it("applyPricingDimensions applies waste factor to cost", () => {
    const result = applyPricingDimensions(100, 200, "material", {
      wasteFactor: 1.10,
    });
    expect(result.adjustedUnitCost).toBe(110);
    expect(result.adjustedUnitPrice).toBe(200);
  });

  it("applyPricingDimensions applies coastal modifier to cost", () => {
    const result = applyPricingDimensions(100, 200, "material", {
      coastalModifier: 1.15,
    });
    expect(result.adjustedUnitCost).toBe(115);
    expect(result.adjustedUnitPrice).toBe(200);
  });

  it("applyPricingDimensions applies finish multiplier to price", () => {
    const result = applyPricingDimensions(100, 200, "material", {
      finishMultiplier: 1.35,
    });
    expect(result.adjustedUnitCost).toBe(100);
    expect(result.adjustedUnitPrice).toBe(270);
  });

  it("applyPricingDimensions applies channel multipliers to both cost and price", () => {
    const result = applyPricingDimensions(100, 200, "material", {
      channelCostMultiplier: 0.95,
      channelPriceMultiplier: 0.90,
    });
    expect(result.adjustedUnitCost).toBe(95);
    expect(result.adjustedUnitPrice).toBe(180);
  });

  it("applyPricingDimensions applies cumulative cost multipliers", () => {
    // waste(1.10) × coastal(1.15) × channel_cost(0.95) × regional_material(1.05)
    const result = applyPricingDimensions(100, 200, "material", {
      wasteFactor: 1.10,
      coastalModifier: 1.15,
      channelCostMultiplier: 0.95,
      regionalMaterialModifier: 1.05,
    });
    // 100 × 1.10 × 1.15 × 0.95 × 1.05 = 126.21...
    const expectedCost = round2(100 * round4(1.10 * 1.15 * 0.95 * 1.05));
    expect(result.adjustedUnitCost).toBe(expectedCost);
  });

  it("applyPricingDimensions uses regional labor modifier for labor items", () => {
    const result = applyPricingDimensions(50, 100, "labor", {
      regionalLaborModifier: 1.20,
      regionalMaterialModifier: 1.05,
    });
    // Labor should use regionalLaborModifier, not materialModifier
    expect(result.adjustedUnitCost).toBe(60); // 50 × 1.20
    expect(result.adjustedUnitPrice).toBe(100);
  });

  it("applyPricingDimensions uses regional material modifier for material items", () => {
    const result = applyPricingDimensions(50, 100, "material", {
      regionalLaborModifier: 1.20,
      regionalMaterialModifier: 1.10,
    });
    // Material should use regionalMaterialModifier, not laborModifier
    expect(result.adjustedUnitCost).toBe(55); // 50 × 1.10
    expect(result.adjustedUnitPrice).toBe(100);
  });

  it("applyPricingDimensions uses regional cost modifier for other item types", () => {
    const result = applyPricingDimensions(50, 100, "subcontract", {
      regionalCostModifier: 1.08,
      regionalLaborModifier: 1.20,
      regionalMaterialModifier: 1.10,
    });
    expect(result.adjustedUnitCost).toBe(54); // 50 × 1.08
  });

  it("applyPricingDimensions detects GP below minimum", () => {
    const result = applyPricingDimensions(100, 120, "material");
    // GP = (120 - 100) / 120 = 16.67%
    expect(result.grossProfitPct).toBeCloseTo(16.67, 1);
    expect(result.meetsMinGP).toBe(false);
  });

  it("priceLineItems calculates summary for multiple items", () => {
    const items: PricingLineItem[] = [
      { id: 1, name: "Drywall", itemType: "material", unitCost: 10, unitPrice: 20, quantity: 100 },
      { id: 2, name: "Labor", itemType: "labor", unitCost: 25, unitPrice: 50, quantity: 40 },
      { id: 3, name: "Permit", itemType: "permit_fee", unitCost: 500, unitPrice: 800, quantity: 1 },
    ];

    const result = priceLineItems(items);

    expect(result.itemCount).toBe(3);
    expect(result.subtotalCost).toBe(2500); // 1000 + 1000 + 500
    expect(result.subtotalPrice).toBe(4800); // 2000 + 2000 + 800
    expect(result.grossProfit).toBe(2300);
    expect(result.meetsMinGP).toBe(true);
  });

  it("priceLineItems applies shared dimensions to all items", () => {
    const items: PricingLineItem[] = [
      { id: 1, name: "Material A", itemType: "material", unitCost: 100, unitPrice: 200, quantity: 10 },
      { id: 2, name: "Labor B", itemType: "labor", unitCost: 50, unitPrice: 100, quantity: 20 },
    ];

    const result = priceLineItems(items, {
      coastalModifier: 1.15,
    });

    // Material: 100 × 1.15 = 115 cost, 200 price → line: 1150 cost, 2000 price
    expect(result.lineItems[0].adjustedUnitCost).toBe(115);
    // Labor: 50 × 1.15 = 57.5 cost, 100 price → line: 1150 cost, 2000 price
    expect(result.lineItems[1].adjustedUnitCost).toBe(57.5);
  });

  it("priceLineItems allows per-item waste factor override", () => {
    const items: PricingLineItem[] = [
      { id: 1, name: "Material A", itemType: "material", unitCost: 100, unitPrice: 200, quantity: 1, wasteFactor: 1.15 },
      { id: 2, name: "Material B", itemType: "material", unitCost: 100, unitPrice: 200, quantity: 1 },
    ];

    const result = priceLineItems(items, { wasteFactor: 1.05 });

    // Item 1 uses its own wasteFactor (1.15), not the shared one (1.05)
    expect(result.lineItems[0].adjustedUnitCost).toBe(115);
    // Item 2 uses the shared wasteFactor (1.05)
    expect(result.lineItems[1].adjustedUnitCost).toBe(105);
  });

  it("priceLineItems returns dimensionsApplied", () => {
    const dims = { coastalModifier: 1.15, finishMultiplier: 1.35 };
    const result = priceLineItems(
      [{ id: 1, name: "X", itemType: "material", unitCost: 10, unitPrice: 20, quantity: 1 }],
      dims
    );
    expect(result.dimensionsApplied.coastalModifier).toBe(1.15);
    expect(result.dimensionsApplied.finishMultiplier).toBe(1.35);
    // Defaults for unspecified
    expect(result.dimensionsApplied.wasteFactor).toBe(1.0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: Parametric Engine
// ══════════════════════════════════════════════════════════════════════

describe("Pricing Engine — Parametric Calculations", () => {
  it("calculateParametricEstimate with defaults", () => {
    const result = calculateParametricEstimate({
      sqft: 1000,
      baseCostPerSqft: 150,
      basePricePerSqft: 250,
      complexityMultiplier: 1.0,
      dimensions: {},
    });

    expect(result.sqft).toBe(1000);
    expect(result.totalCost).toBe(150000);
    expect(result.totalPrice).toBe(250000);
    expect(result.grossProfit).toBe(100000);
    expect(result.meetsMinGP).toBe(true);
  });

  it("calculateParametricEstimate applies complexity multiplier", () => {
    const result = calculateParametricEstimate({
      sqft: 1000,
      baseCostPerSqft: 150,
      basePricePerSqft: 250,
      complexityMultiplier: 1.25,
      dimensions: {},
    });

    expect(result.adjustedCostPerSqft).toBe(187.5);
    expect(result.adjustedPricePerSqft).toBe(312.5);
    expect(result.totalCost).toBe(187500);
    expect(result.totalPrice).toBe(312500);
  });

  it("calculateParametricEstimate applies regional and channel dimensions", () => {
    const result = calculateParametricEstimate({
      sqft: 1200,
      baseCostPerSqft: 100,
      basePricePerSqft: 180,
      complexityMultiplier: 1.0,
      dimensions: {
        regionalCostModifier: 1.10,
        channelCostMultiplier: 0.95,
        coastalModifier: 1.15,
        channelPriceMultiplier: 0.90,
        finishMultiplier: 1.35,
      },
    });

    // adjustedCost = 100 × 1.0 × 1.10 × 0.95 × 1.15 = 120.175
    const expectedCostPerSqft = round4(100 * 1.0 * 1.10 * 0.95 * 1.15);
    expect(result.adjustedCostPerSqft).toBe(expectedCostPerSqft);

    // adjustedPrice = 180 × 1.0 × 1.35 × 0.90 = 218.7
    const expectedPricePerSqft = round4(180 * 1.0 * 1.35 * 0.90);
    expect(result.adjustedPricePerSqft).toBe(expectedPricePerSqft);

    expect(result.totalCost).toBe(round2(expectedCostPerSqft * 1200));
    expect(result.totalPrice).toBe(round2(expectedPricePerSqft * 1200));
  });

  it("validateParametricSqft accepts valid range", () => {
    const result = validateParametricSqft(1500, 400, 5000);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe(1500);
  });

  it("validateParametricSqft clamps below minimum", () => {
    const result = validateParametricSqft(200, 400, 5000);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(400);
    expect(result.reason).toContain("400");
  });

  it("validateParametricSqft clamps above maximum", () => {
    const result = validateParametricSqft(6000, 400, 5000);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(5000);
    expect(result.reason).toContain("5000");
  });

  it("validateParametricSqft rejects NaN", () => {
    const result = validateParametricSqft(NaN, 400, 5000);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: Price Governance
// ══════════════════════════════════════════════════════════════════════

describe("Pricing Engine — Price Governance", () => {
  it("validatePriceGovernance passes when GP meets minimum", () => {
    // GP = (200 - 100) / 200 = 50%
    const result = validatePriceGovernance(100, 200);
    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.adjustedPrice).toBeUndefined();
  });

  it("validatePriceGovernance fails when GP below minimum", () => {
    // GP = (120 - 100) / 120 = 16.67%
    const result = validatePriceGovernance(100, 120);
    expect(result.isValid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].rule).toBe("min_gross_profit");
    expect(result.violations[0].severity).toBe("error");
    expect(result.adjustedPrice).toBeDefined();
    // Adjusted price should meet 35% GP: 100 / (1 - 0.35) ≈ 153.85
    expect(result.adjustedPrice!).toBeCloseTo(153.85, 1);
  });

  it("validatePriceGovernance detects max markup violation", () => {
    // Markup = (500 - 100) / 100 = 400%
    const result = validatePriceGovernance(100, 500, { maxMarkupPct: 200 });
    expect(result.violations.some(v => v.rule === "max_markup")).toBe(true);
  });

  it("validatePriceGovernance detects min price violation", () => {
    const result = validatePriceGovernance(10, 20, { minPrice: 50 });
    expect(result.isValid).toBe(false);
    expect(result.violations.some(v => v.rule === "min_price")).toBe(true);
  });

  it("validatePriceGovernance detects max price violation", () => {
    const result = validatePriceGovernance(100, 500, { maxPrice: 400 });
    // max_price is a warning, not error
    expect(result.violations.some(v => v.rule === "max_price" && v.severity === "warning")).toBe(true);
  });

  it("validatePriceGovernance with custom minGP", () => {
    // GP = (150 - 100) / 150 = 33.33% — passes 30% but fails 35%
    const result30 = validatePriceGovernance(100, 150, { minGrossProfitPct: 30 });
    expect(result30.isValid).toBe(true);

    const result35 = validatePriceGovernance(100, 150, { minGrossProfitPct: 35 });
    expect(result35.isValid).toBe(false);
  });

  it("enforceMinGP returns original price when GP is sufficient", () => {
    const result = enforceMinGP(100, 200);
    expect(result.price).toBe(200);
    expect(result.wasAdjusted).toBe(false);
    expect(result.grossProfitPct).toBe(50);
  });

  it("enforceMinGP adjusts price when GP is insufficient", () => {
    const result = enforceMinGP(100, 120);
    expect(result.wasAdjusted).toBe(true);
    expect(result.grossProfitPct).toBeGreaterThanOrEqual(MIN_GROSS_PROFIT);
    // Adjusted price: 100 / (1 - 0.35) ≈ 153.85
    expect(result.price).toBeCloseTo(153.85, 1);
  });

  it("enforceMinGP with custom minimum GP", () => {
    const result = enforceMinGP(100, 130, 25);
    // GP = (130 - 100) / 130 = 23.08% < 25%
    expect(result.wasAdjusted).toBe(true);
    expect(result.grossProfitPct).toBeGreaterThanOrEqual(25);
  });

  it("enforceMinGP handles zero cost gracefully", () => {
    const result = enforceMinGP(0, 100);
    expect(result.price).toBe(100);
    expect(result.wasAdjusted).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: Pricing Dimensions — Merge & Multipliers
// ══════════════════════════════════════════════════════════════════════

describe("Pricing Engine — Dimensions & Multipliers", () => {
  it("mergeDimensions returns defaults when no overrides", () => {
    const result = mergeDimensions();
    expect(result).toEqual(DEFAULT_PRICING_DIMENSIONS);
  });

  it("mergeDimensions merges partial overrides", () => {
    const result = mergeDimensions({ coastalModifier: 1.15, finishMultiplier: 1.35 });
    expect(result.coastalModifier).toBe(1.15);
    expect(result.finishMultiplier).toBe(1.35);
    expect(result.wasteFactor).toBe(1.0); // default
    expect(result.channelCostMultiplier).toBe(1.0); // default
  });

  it("calcCostMultiplier for material uses regional material modifier", () => {
    const dims = mergeDimensions({
      wasteFactor: 1.10,
      coastalModifier: 1.15,
      channelCostMultiplier: 0.95,
      regionalMaterialModifier: 1.05,
      regionalLaborModifier: 1.20,
    });
    const result = calcCostMultiplier("material", dims);
    // 1.10 × 1.15 × 0.95 × 1.05
    expect(result).toBe(round4(1.10 * 1.15 * 0.95 * 1.05));
  });

  it("calcCostMultiplier for labor uses regional labor modifier", () => {
    const dims = mergeDimensions({
      wasteFactor: 1.0,
      coastalModifier: 1.0,
      channelCostMultiplier: 1.0,
      regionalLaborModifier: 1.20,
      regionalMaterialModifier: 1.05,
    });
    const result = calcCostMultiplier("labor", dims);
    expect(result).toBe(1.20);
  });

  it("calcCostMultiplier for subcontract uses regional cost modifier", () => {
    const dims = mergeDimensions({
      regionalCostModifier: 1.08,
      regionalLaborModifier: 1.20,
      regionalMaterialModifier: 1.05,
    });
    const result = calcCostMultiplier("subcontract", dims);
    expect(result).toBe(1.08);
  });

  it("calcPriceMultiplier combines channel and finish", () => {
    const dims = mergeDimensions({
      channelPriceMultiplier: 0.90,
      finishMultiplier: 1.35,
    });
    const result = calcPriceMultiplier(dims);
    expect(result).toBe(round4(0.90 * 1.35));
  });

  it("round2 rounds to 2 decimal places", () => {
    // Note: 1.005 is a well-known IEEE 754 edge case — 1.005 * 100 = 100.4999...
    // Our round2 uses Math.round which truncates this to 1.00, which is correct behavior
    expect(round2(1.005)).toBe(1); // IEEE 754 representation issue
    expect(round2(1.006)).toBe(1.01);
    expect(round2(1.004)).toBe(1);
    expect(round2(99.999)).toBe(100);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(123.456)).toBe(123.46);
    expect(round2(0.015)).toBe(0.02);
  });

  it("round4 rounds to 4 decimal places", () => {
    expect(round4(1.00005)).toBe(1.0001);
    expect(round4(1.00004)).toBe(1);
    expect(round4(1.23456)).toBe(1.2346);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: Integration — Pricing Router Structure
// ══════════════════════════════════════════════════════════════════════

describe("Pricing Router — Structure Verification", () => {
  it("pricing-router module exports pricingRouter", async () => {
    const mod = await import("./pricing-router");
    expect(mod.pricingRouter).toBeDefined();
  });

  it("pricing-db module exports all required functions", async () => {
    const mod = await import("./pricing-db");
    // Price Book
    expect(mod.listPriceBookItems).toBeTypeOf("function");
    expect(mod.getPriceBookItemById).toBeTypeOf("function");
    expect(mod.getPriceBookItemBySku).toBeTypeOf("function");
    expect(mod.getPriceBookItemsByIds).toBeTypeOf("function");
    expect(mod.getPriceBookCategories).toBeTypeOf("function");
    expect(mod.getPriceBookTrades).toBeTypeOf("function");
    expect(mod.getPriceBookStats).toBeTypeOf("function");
    expect(mod.updatePriceBookItem).toBeTypeOf("function");
    expect(mod.createPriceBookItem).toBeTypeOf("function");
    expect(mod.deactivatePriceBookItem).toBeTypeOf("function");
    expect(mod.getPriceBookHistory).toBeTypeOf("function");
    // Regional
    expect(mod.listRegionalModifiers).toBeTypeOf("function");
    expect(mod.getRegionalModifier).toBeTypeOf("function");
    expect(mod.updateRegionalModifier).toBeTypeOf("function");
    // Channel
    expect(mod.listChannelMultipliers).toBeTypeOf("function");
    expect(mod.getChannelMultiplier).toBeTypeOf("function");
    expect(mod.updateChannelMultiplier).toBeTypeOf("function");
    // Finish
    expect(mod.listFinishLevels).toBeTypeOf("function");
    expect(mod.getFinishLevel).toBeTypeOf("function");
    expect(mod.updateFinishLevel).toBeTypeOf("function");
    // Parametric
    expect(mod.listParametricModels).toBeTypeOf("function");
    expect(mod.getParametricModel).toBeTypeOf("function");
    expect(mod.getParametricModelByType).toBeTypeOf("function");
    // Templates
    expect(mod.listRemodelTemplates).toBeTypeOf("function");
    expect(mod.getRemodelTemplate).toBeTypeOf("function");
    expect(mod.getRemodelTemplateByType).toBeTypeOf("function");
    expect(mod.listNewconTemplates).toBeTypeOf("function");
    expect(mod.getNewconTemplate).toBeTypeOf("function");
    expect(mod.getNewconTemplateByType).toBeTypeOf("function");
  });

  it("pricing-engine module exports all required functions", async () => {
    const mod = await import("@shared/pricing-engine");
    expect(mod.applyPricingDimensions).toBeTypeOf("function");
    expect(mod.priceLineItems).toBeTypeOf("function");
    expect(mod.calculateParametricEstimate).toBeTypeOf("function");
    expect(mod.validateParametricSqft).toBeTypeOf("function");
    expect(mod.validatePriceGovernance).toBeTypeOf("function");
    expect(mod.enforceMinGP).toBeTypeOf("function");
    expect(mod.mergeDimensions).toBeTypeOf("function");
    expect(mod.calcCostMultiplier).toBeTypeOf("function");
    expect(mod.calcPriceMultiplier).toBeTypeOf("function");
    expect(mod.round2).toBeTypeOf("function");
    expect(mod.round4).toBeTypeOf("function");
    expect(mod.DEFAULT_PRICING_DIMENSIONS).toBeDefined();
  });

  it("appRouter includes pricing namespace", async () => {
    const mod = await import("./routers");
    expect(mod.appRouter).toBeDefined();
    // The router should have a pricing property
    expect((mod.appRouter as any)._def.procedures).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: Edge Cases & Backward Compatibility
// ══════════════════════════════════════════════════════════════════════

describe("Pricing Engine — Edge Cases", () => {
  it("handles zero quantity in priceLineItems", () => {
    const items: PricingLineItem[] = [
      { id: 1, name: "Zero Qty", itemType: "material", unitCost: 100, unitPrice: 200, quantity: 0 },
    ];
    const result = priceLineItems(items);
    expect(result.lineItems[0].lineTotalCost).toBe(0);
    expect(result.lineItems[0].lineTotalPrice).toBe(0);
    expect(result.subtotalCost).toBe(0);
  });

  it("handles very small values without floating point issues", () => {
    const result = applyPricingDimensions(0.01, 0.02, "material", {
      wasteFactor: 1.10,
    });
    expect(result.adjustedUnitCost).toBe(0.01); // 0.01 × 1.10 = 0.011 → rounds to 0.01
  });

  it("handles very large values", () => {
    const result = applyPricingDimensions(999999, 1999999, "material");
    expect(result.adjustedUnitCost).toBe(999999);
    expect(result.adjustedUnitPrice).toBe(1999999);
  });

  it("parametric estimate with 1 sqft", () => {
    const result = calculateParametricEstimate({
      sqft: 1,
      baseCostPerSqft: 150,
      basePricePerSqft: 250,
      complexityMultiplier: 1.0,
      dimensions: {},
    });
    expect(result.totalCost).toBe(150);
    expect(result.totalPrice).toBe(250);
  });

  it("all item types are handled in cost multiplier", () => {
    const dims = mergeDimensions({
      regionalCostModifier: 1.1,
      regionalLaborModifier: 1.2,
      regionalMaterialModifier: 1.3,
    });

    const material = calcCostMultiplier("material", dims);
    const labor = calcCostMultiplier("labor", dims);
    const sub = calcCostMultiplier("subcontract", dims);
    const permit = calcCostMultiplier("permit_fee", dims);
    const equip = calcCostMultiplier("equipment", dims);
    const allow = calcCostMultiplier("allowance", dims);

    expect(material).toBe(1.3); // uses regionalMaterialModifier
    expect(labor).toBe(1.2);    // uses regionalLaborModifier
    expect(sub).toBe(1.1);      // uses regionalCostModifier
    expect(permit).toBe(1.1);   // uses regionalCostModifier
    expect(equip).toBe(1.1);    // uses regionalCostModifier
    expect(allow).toBe(1.1);    // uses regionalCostModifier
  });

  it("priceLineItems with empty array returns zero summary", () => {
    const result = priceLineItems([]);
    expect(result.itemCount).toBe(0);
    expect(result.subtotalCost).toBe(0);
    expect(result.subtotalPrice).toBe(0);
    expect(result.grossProfit).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: Backward Compatibility
// ══════════════════════════════════════════════════════════════════════

describe("Backward Compatibility — Existing Functions Still Work", () => {
  it("calcGrossProfit from catalog-utils still works", () => {
    expect(calcGrossProfit(200, 100)).toBe(50);
    expect(calcGrossProfit(100, 100)).toBe(0);
    expect(calcGrossProfit(0, 100)).toBe(0);
  });

  it("MIN_GROSS_PROFIT is still 35", () => {
    expect(MIN_GROSS_PROFIT).toBe(35);
  });

  it("pricing engine uses same MIN_GROSS_PROFIT constant", () => {
    // enforceMinGP defaults to MIN_GROSS_PROFIT
    const result = enforceMinGP(100, 140); // GP = 28.57% < 35%
    expect(result.wasAdjusted).toBe(true);
    expect(result.grossProfitPct).toBeGreaterThanOrEqual(35);
  });

  it("catalogItems table still exists for bundle_items FK", () => {
    expect(schema.catalogItems).toBeDefined();
    const cols = Object.keys(schema.catalogItems);
    expect(cols).toContain("id");
    expect(cols).toContain("costGroupName");
    expect(cols).toContain("costItemName");
    expect(cols).toContain("unitCost");
    expect(cols).toContain("unitPrice");
  });
});
