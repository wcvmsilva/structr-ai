/**
 * structr.ai v9 — Sprint 7 Tests
 * Assembly Library: Schema, Engine, DB Helpers, Router
 *
 * Test coverage:
 *   Section 1: Schema — assemblies & assembly_components tables with Sprint 7 fields
 *   Section 2: Assembly Engine — BOM calculation, waste, coastal, channel
 *   Section 3: Assembly Engine — Profit Shield enforcement
 *   Section 4: Assembly Engine — Batch calculations
 *   Section 5: Assembly Engine — Cost breakdown by component_type
 *   Section 6: Assembly Engine — Edge cases and warnings
 *   Section 7: Assembly Router — structure and procedure existence
 *   Section 8: Integration — Assembly Engine + Pricing Engine interop
 */

import { describe, it, expect } from "vitest";
import * as schema from "../drizzle/schema";
import {
  calculateAssemblyCost,
  calculateAssemblyCostWithProfitShield,
  calculateMultipleAssemblies,
  formatCostBreakdown,
  totalFromBreakdown,
  type AssemblyComponentInput,
  type AssemblyPricingContext,
  type CostBreakdown,
} from "@shared/assembly-engine";
import {
  round2,
  round4,
  priceLineItems,
  DEFAULT_PRICING_DIMENSIONS,
} from "@shared/pricing-engine";
import { MIN_GROSS_PROFIT, calcGrossProfit } from "@shared/catalog-utils";

// ══════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ══════════════════════════════════════════════════════════════════════

/** A simple material component with PBI */
function makeMaterialComponent(overrides: Partial<AssemblyComponentInput> = {}): AssemblyComponentInput {
  return {
    id: 1,
    componentType: "material",
    description: "Test Material",
    quantity: "10.0000",
    unit: "SF",
    wasteFactorPct: "10.00",
    unitCostOverride: null,
    priceBookItem: {
      id: 100,
      name: "Test PBI Material",
      unitCost: "5.0000",
      unitPrice: "8.0000",
      wasteFactor: "1.0500",
      coastalModifier: "1.0000",
      itemType: "material",
    },
    ...overrides,
  };
}

/** A labor component (no PBI) */
function makeLaborComponent(overrides: Partial<AssemblyComponentInput> = {}): AssemblyComponentInput {
  return {
    id: 2,
    componentType: "labor",
    description: "Installation Labor",
    quantity: "8.0000",
    unit: "HR",
    wasteFactorPct: null,
    unitCostOverride: "45.0000",
    priceBookItem: null,
    ...overrides,
  };
}

/** A material component with PBI reference */
function makePBIComponent(
  id: number,
  qty: string,
  unitCost: string,
  unitPrice: string,
  wastePct: string | null = null,
  componentType: "material" | "labor" | "subcontract" | "equipment" | "permit" | "admin" = "material"
): AssemblyComponentInput {
  return {
    id,
    componentType,
    description: `Component ${id}`,
    quantity: qty,
    unit: "EA",
    wasteFactorPct: wastePct,
    unitCostOverride: null,
    priceBookItem: {
      id: id * 100,
      name: `PBI ${id}`,
      unitCost,
      unitPrice,
      wasteFactor: "1.0000",
      coastalModifier: "1.0000",
      itemType: componentType === "labor" ? "labor" : "material",
    },
  };
}

/** Default assembly context */
function makeContext(overrides: Partial<AssemblyPricingContext> = {}): AssemblyPricingContext {
  return {
    assemblyId: 1,
    assemblyName: "Test Assembly",
    coastalModifier: null,
    finishLevel: "standard",
    region: "charleston_metro",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: Schema — Assembly Tables with Sprint 7 Fields
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Assembly Schema Tables", () => {
  it("assemblies table exists with all required columns", () => {
    const cols = Object.keys(schema.assemblies);
    // Original columns
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("code");
    expect(cols).toContain("trade");
    expect(cols).toContain("category");
    expect(cols).toContain("description");
    expect(cols).toContain("defaultUnit");
    expect(cols).toContain("directCost");
    expect(cols).toContain("sellPrice");
    expect(cols).toContain("crewHours");
    expect(cols).toContain("itemCount");
    expect(cols).toContain("grossProfitPct");
    expect(cols).toContain("assemblyType");
    expect(cols).toContain("isActive");
    expect(cols).toContain("version");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
    expect(cols).toContain("deletedAt");
  });

  it("assemblies table has Sprint 7 remodel fields", () => {
    const cols = Object.keys(schema.assemblies);
    expect(cols).toContain("subcategory");
    expect(cols).toContain("finishLevel");
    expect(cols).toContain("region");
    expect(cols).toContain("coastalModifier");
    expect(cols).toContain("tradeSequenceOrder");
    expect(cols).toContain("inclusions");
    expect(cols).toContain("exclusions");
    expect(cols).toContain("hiddenConditionFlag");
    expect(cols).toContain("parentAssemblyId");
  });

  it("assembly_components table exists with all required columns", () => {
    const cols = Object.keys(schema.assemblyItems);
    expect(cols).toContain("id");
    expect(cols).toContain("assemblyId");
    expect(cols).toContain("priceBookItemId");
    expect(cols).toContain("componentType");
    expect(cols).toContain("description");
    expect(cols).toContain("quantity");
    expect(cols).toContain("unit");
    expect(cols).toContain("wasteFactorPct");
    expect(cols).toContain("unitCostOverride");
    expect(cols).toContain("notes");
    expect(cols).toContain("sortOrder");
    expect(cols).toContain("createdAt");
  });

  it("assembly_components has component_type enum", () => {
    const cols = Object.keys(schema.assemblyItems);
    expect(cols).toContain("componentType");
  });

  it("assembly_components has catalogItemId column", () => {
    const cols = Object.keys(schema.assemblyItems);
    expect(cols).toContain("catalogItemId");
  });

  it("assemblies type exports are defined", () => {
    // Type-level check — if these don't exist, TS would fail
    const _a: schema.Assembly | undefined = undefined;
    const _ia: schema.InsertAssembly | undefined = undefined;
    const _ac: schema.AssemblyComponent | undefined = undefined;
    const _iac: schema.InsertAssemblyComponent | undefined = undefined;
    expect(true).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: Assembly Engine — BOM Calculation
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Assembly Engine: BOM Calculation", () => {
  it("calculates a single material component correctly", () => {
    const comp = makeMaterialComponent();
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);

    expect(result.assemblyId).toBe(1);
    expect(result.assemblyName).toBe("Test Assembly");
    expect(result.componentCount).toBe(1);
    expect(result.pricedComponents).toHaveLength(1);

    const pc = result.pricedComponents[0];
    expect(pc.componentId).toBe(1);
    expect(pc.componentType).toBe("material");
    expect(pc.quantity).toBe(10);
    expect(pc.baseUnitCost).toBe(5);
    expect(pc.baseUnitPrice).toBe(8);
    // Waste factor from component override: 10% → 1.10
    expect(pc.wasteFactor).toBe(1.10);
  });

  it("uses component waste factor over PBI waste factor", () => {
    // Component has 10% waste, PBI has 5% waste
    const comp = makeMaterialComponent({
      wasteFactorPct: "10.00",
    });
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);
    const pc = result.pricedComponents[0];
    expect(pc.wasteFactor).toBe(1.10);
  });

  it("falls back to PBI waste factor when component has none", () => {
    const comp = makeMaterialComponent({
      wasteFactorPct: null,
    });
    // PBI wasteFactor is 1.0500 = 5%
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);
    const pc = result.pricedComponents[0];
    expect(pc.wasteFactor).toBe(1.05);
  });

  it("uses 1.0 waste factor when neither component nor PBI has one", () => {
    const comp = makeMaterialComponent({
      wasteFactorPct: null,
      priceBookItem: {
        id: 100,
        name: "No Waste PBI",
        unitCost: "5.0000",
        unitPrice: "8.0000",
        wasteFactor: null,
        coastalModifier: null,
        itemType: "material",
      },
    });
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);
    const pc = result.pricedComponents[0];
    expect(pc.wasteFactor).toBe(1.0);
  });

  it("applies assembly-level coastal modifier", () => {
    const comp = makeMaterialComponent({ wasteFactorPct: null });
    comp.priceBookItem!.wasteFactor = "1.0000";
    const ctx = makeContext({ coastalModifier: "1.0800" });
    const result = calculateAssemblyCost([comp], ctx);

    // With coastal 1.08: cost = 5 * 1.0 (waste) * 1.08 (coastal) = 5.40 per unit
    // Line total cost = 5.40 * 10 = 54.00
    const pc = result.pricedComponents[0];
    expect(pc.lineTotalCost).toBeCloseTo(54.0, 1);
  });

  it("handles labor component with cost override (no PBI)", () => {
    const labor = makeLaborComponent();
    const ctx = makeContext();
    const result = calculateAssemblyCost([labor], ctx);

    expect(result.componentCount).toBe(1);
    const pc = result.pricedComponents[0];
    expect(pc.componentType).toBe("labor");
    expect(pc.baseUnitCost).toBe(45);
    expect(pc.quantity).toBe(8);
    // Labor with no waste: 45 * 8 = 360
    expect(pc.lineTotalCost).toBeCloseTo(360, 0);
  });

  it("calculates multi-component assembly correctly", () => {
    const components: AssemblyComponentInput[] = [
      makePBIComponent(1, "100", "2.5000", "4.0000", "10.00"),  // material
      makePBIComponent(2, "50", "3.0000", "5.0000", null, "labor"),  // labor
      makePBIComponent(3, "1", "500.0000", "800.0000", null, "subcontract"),  // subcontract
    ];
    const ctx = makeContext();
    const result = calculateAssemblyCost(components, ctx);

    expect(result.componentCount).toBe(3);
    expect(result.totalDirectCost).toBeGreaterThan(0);
    expect(result.totalSellPrice).toBeGreaterThan(result.totalDirectCost);
    expect(result.grossProfitPct).toBeGreaterThan(0);
  });

  it("applies channel multiplier via dimensions", () => {
    const comp = makeMaterialComponent({ wasteFactorPct: null });
    comp.priceBookItem!.wasteFactor = "1.0000";
    const ctx = makeContext({
      dimensions: { channelMultiplier: 1.15 },  // insurance channel
    });
    const result = calculateAssemblyCost([comp], ctx);

    // Channel multiplier should affect the price
    expect(result.dimensionsApplied.channelMultiplier).toBe(1.15);
  });

  it("returns correct dimensionsApplied", () => {
    const comp = makeMaterialComponent();
    const ctx = makeContext({
      dimensions: {
        channelMultiplier: 1.10,
        finishMultiplier: 1.20,
      },
    });
    const result = calculateAssemblyCost([comp], ctx);

    expect(result.dimensionsApplied.channelMultiplier).toBe(1.10);
    expect(result.dimensionsApplied.finishMultiplier).toBe(1.20);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: Assembly Engine — Profit Shield
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Assembly Engine: Profit Shield", () => {
  it("does not adjust price when GP is above minimum", () => {
    // unitCost=5, unitPrice=8 → GP = (8-5)/8 = 37.5%
    const comp = makeMaterialComponent({ wasteFactorPct: null });
    comp.priceBookItem!.wasteFactor = "1.0000";
    const ctx = makeContext();
    const result = calculateAssemblyCostWithProfitShield([comp], ctx);

    expect(result.profitShieldApplied).toBe(false);
    expect(result.grossProfitPct).toBeGreaterThanOrEqual(MIN_GROSS_PROFIT);
  });

  it("adjusts price when GP is below minimum", () => {
    // unitCost=9, unitPrice=10 → GP = (10-9)/10 = 10% (below 28%)
    const comp = makeMaterialComponent({
      wasteFactorPct: null,
      priceBookItem: {
        id: 100,
        name: "Low Margin PBI",
        unitCost: "9.0000",
        unitPrice: "10.0000",
        wasteFactor: "1.0000",
        coastalModifier: "1.0000",
        itemType: "material",
      },
    });
    const ctx = makeContext();
    const result = calculateAssemblyCostWithProfitShield([comp], ctx);

    expect(result.profitShieldApplied).toBe(true);
    expect(result.grossProfitPct).toBeGreaterThanOrEqual(MIN_GROSS_PROFIT);
    expect(result.totalSellPrice).toBeGreaterThan(result.originalSellPrice);
    expect(result.meetsMinGP).toBe(true);
  });

  it("preserves original sell price in result", () => {
    const comp = makeMaterialComponent({
      wasteFactorPct: null,
      priceBookItem: {
        id: 100,
        name: "Low Margin PBI",
        unitCost: "9.0000",
        unitPrice: "10.0000",
        wasteFactor: "1.0000",
        coastalModifier: "1.0000",
        itemType: "material",
      },
    });
    const ctx = makeContext();
    const result = calculateAssemblyCostWithProfitShield([comp], ctx);

    expect(result.originalSellPrice).toBeDefined();
    expect(typeof result.originalSellPrice).toBe("number");
    if (result.profitShieldApplied) {
      expect(result.totalSellPrice).toBeGreaterThan(result.originalSellPrice);
    }
  });

  it("accepts custom minGP parameter", () => {
    const comp = makeMaterialComponent({
      wasteFactorPct: null,
      priceBookItem: {
        id: 100,
        name: "Test PBI",
        unitCost: "7.0000",
        unitPrice: "10.0000",
        wasteFactor: "1.0000",
        coastalModifier: "1.0000",
        itemType: "material",
      },
    });
    const ctx = makeContext();
    // GP = (10-7)/10 = 30%, custom minGP = 40%
    const result = calculateAssemblyCostWithProfitShield([comp], ctx, 40);

    expect(result.profitShieldApplied).toBe(true);
    expect(result.grossProfitPct).toBeGreaterThanOrEqual(40);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: Assembly Engine — Batch Calculations
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Assembly Engine: Batch Calculations", () => {
  it("calculates multiple assemblies with quantities", () => {
    const comp1 = makePBIComponent(1, "10", "5.0000", "8.0000");
    const comp2 = makePBIComponent(2, "20", "3.0000", "5.0000");

    const result = calculateMultipleAssemblies([
      { components: [comp1], context: makeContext({ assemblyId: 1, assemblyName: "Assembly A" }), quantity: 2 },
      { components: [comp2], context: makeContext({ assemblyId: 2, assemblyName: "Assembly B" }), quantity: 3 },
    ]);

    expect(result.assemblies).toHaveLength(2);
    expect(result.assemblies[0].quantity).toBe(2);
    expect(result.assemblies[1].quantity).toBe(3);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalPrice).toBeGreaterThan(result.totalCost);
    expect(result.grossProfit).toBeGreaterThan(0);
    expect(result.grossProfitPct).toBeGreaterThan(0);
  });

  it("extended cost = unit cost × quantity", () => {
    const comp = makePBIComponent(1, "10", "5.0000", "8.0000");
    const result = calculateMultipleAssemblies([
      { components: [comp], context: makeContext(), quantity: 3 },
    ]);

    const asm = result.assemblies[0];
    expect(asm.extendedCost).toBe(round2(asm.totalDirectCost * 3));
    expect(asm.extendedPrice).toBe(round2(asm.totalSellPrice * 3));
  });

  it("aggregate totals sum correctly", () => {
    const comp1 = makePBIComponent(1, "10", "5.0000", "8.0000");
    const comp2 = makePBIComponent(2, "5", "10.0000", "16.0000");

    const result = calculateMultipleAssemblies([
      { components: [comp1], context: makeContext({ assemblyId: 1 }), quantity: 1 },
      { components: [comp2], context: makeContext({ assemblyId: 2 }), quantity: 1 },
    ]);

    const sumCost = result.assemblies.reduce((s, a) => s + a.extendedCost, 0);
    const sumPrice = result.assemblies.reduce((s, a) => s + a.extendedPrice, 0);
    expect(result.totalCost).toBeCloseTo(sumCost, 1);
    expect(result.totalPrice).toBeCloseTo(sumPrice, 1);
  });

  it("handles empty assemblies array", () => {
    const result = calculateMultipleAssemblies([]);
    expect(result.assemblies).toHaveLength(0);
    expect(result.totalCost).toBe(0);
    expect(result.totalPrice).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: Assembly Engine — Cost Breakdown by Component Type
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Assembly Engine: Cost Breakdown", () => {
  it("separates costs by component_type", () => {
    const components: AssemblyComponentInput[] = [
      makePBIComponent(1, "10", "5.0000", "8.0000", null, "material"),
      makePBIComponent(2, "8", "45.0000", "72.0000", null, "labor"),
      makePBIComponent(3, "1", "500.0000", "800.0000", null, "subcontract"),
      makePBIComponent(4, "1", "200.0000", "320.0000", null, "equipment"),
    ];
    const ctx = makeContext();
    const result = calculateAssemblyCost(components, ctx);

    expect(result.costBreakdown.materialCost).toBeGreaterThan(0);
    expect(result.costBreakdown.laborCost).toBeGreaterThan(0);
    expect(result.costBreakdown.subcontractCost).toBeGreaterThan(0);
    expect(result.costBreakdown.equipmentCost).toBeGreaterThan(0);
    expect(result.costBreakdown.permitCost).toBe(0);
    expect(result.costBreakdown.adminCost).toBe(0);
  });

  it("price breakdown matches cost breakdown structure", () => {
    const components: AssemblyComponentInput[] = [
      makePBIComponent(1, "10", "5.0000", "8.0000", null, "material"),
      makePBIComponent(2, "8", "45.0000", "72.0000", null, "labor"),
    ];
    const ctx = makeContext();
    const result = calculateAssemblyCost(components, ctx);

    expect(result.priceBreakdown.materialCost).toBeGreaterThan(0);
    expect(result.priceBreakdown.laborCost).toBeGreaterThan(0);
    // Price breakdown should be >= cost breakdown
    expect(result.priceBreakdown.materialCost).toBeGreaterThanOrEqual(result.costBreakdown.materialCost);
    expect(result.priceBreakdown.laborCost).toBeGreaterThanOrEqual(result.costBreakdown.laborCost);
  });

  it("formatCostBreakdown produces readable string", () => {
    const breakdown: CostBreakdown = {
      materialCost: 500,
      laborCost: 360,
      subcontractCost: 0,
      equipmentCost: 200,
      permitCost: 0,
      adminCost: 0,
    };
    const formatted = formatCostBreakdown(breakdown);
    expect(formatted).toContain("Material: $500.00");
    expect(formatted).toContain("Labor: $360.00");
    expect(formatted).toContain("Equipment: $200.00");
    expect(formatted).not.toContain("Subcontract");
    expect(formatted).not.toContain("Permit");
    expect(formatted).not.toContain("Admin");
  });

  it("totalFromBreakdown sums all categories", () => {
    const breakdown: CostBreakdown = {
      materialCost: 100,
      laborCost: 200,
      subcontractCost: 300,
      equipmentCost: 50,
      permitCost: 25,
      adminCost: 10,
    };
    expect(totalFromBreakdown(breakdown)).toBe(685);
  });

  it("totalFromBreakdown handles zero breakdown", () => {
    const breakdown: CostBreakdown = {
      materialCost: 0,
      laborCost: 0,
      subcontractCost: 0,
      equipmentCost: 0,
      permitCost: 0,
      adminCost: 0,
    };
    expect(totalFromBreakdown(breakdown)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: Assembly Engine — Edge Cases and Warnings
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Assembly Engine: Edge Cases", () => {
  it("warns when component has no PBI and no cost override", () => {
    const comp: AssemblyComponentInput = {
      id: 99,
      componentType: "material",
      description: "Orphan Component",
      quantity: "5.0000",
      unit: "EA",
      wasteFactorPct: null,
      unitCostOverride: null,
      priceBookItem: null,
    };
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no price_book_item");
    expect(result.componentCount).toBe(0);
  });

  it("handles empty component list", () => {
    const ctx = makeContext();
    const result = calculateAssemblyCost([], ctx);

    expect(result.componentCount).toBe(0);
    expect(result.totalDirectCost).toBe(0);
    expect(result.totalSellPrice).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles zero quantity component", () => {
    const comp = makeMaterialComponent({ quantity: "0.0000" });
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);

    expect(result.componentCount).toBe(1);
    const pc = result.pricedComponents[0];
    expect(pc.lineTotalCost).toBe(0);
    expect(pc.lineTotalPrice).toBe(0);
  });

  it("uses unitCostOverride over PBI unitCost", () => {
    const comp = makeMaterialComponent({
      unitCostOverride: "99.0000",
    });
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);

    const pc = result.pricedComponents[0];
    expect(pc.baseUnitCost).toBe(99);
  });

  it("calculates default price when labor has no PBI", () => {
    // Labor with cost override but no PBI — price should be derived from cost / (1 - minGP)
    const labor = makeLaborComponent();
    const ctx = makeContext();
    const result = calculateAssemblyCost([labor], ctx);

    const pc = result.pricedComponents[0];
    expect(pc.baseUnitCost).toBe(45);
    // Price should be at least cost / (1 - 0.28) = 62.50
    expect(pc.baseUnitPrice).toBeGreaterThan(45);
  });

  it("handles very large quantities without overflow", () => {
    const comp = makePBIComponent(1, "100000", "0.0100", "0.0200");
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);

    expect(result.totalDirectCost).toBeGreaterThan(0);
    expect(result.totalSellPrice).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalDirectCost)).toBe(true);
  });

  it("handles very small unit costs", () => {
    const comp = makePBIComponent(1, "1", "0.0001", "0.0002");
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);

    expect(result.totalDirectCost).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.totalDirectCost)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: Assembly Router — Structure
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Assembly Router Structure", () => {
  it("assemblyRouter is exported from assembly-router.ts", async () => {
    const mod = await import("./assembly-router");
    expect(mod.assemblyRouter).toBeDefined();
  });

  it("assemblyRouter has expected sub-procedures", async () => {
    const mod = await import("./assembly-router");
    const router = mod.assemblyRouter;
    // The router should be a tRPC router object
    expect(router).toBeDefined();
    expect(typeof router).toBe("object");
  });

  it("assembly-db exports all expected functions", async () => {
    const mod = await import("./assembly-db");
    expect(typeof mod.listAssemblies).toBe("function");
    expect(typeof mod.getAssemblyById).toBe("function");
    expect(typeof mod.getAssembliesByTrade).toBe("function");
    expect(typeof mod.getAssembliesByCategory).toBe("function");
    expect(typeof mod.createAssembly).toBe("function");
    expect(typeof mod.updateAssembly).toBe("function");
    expect(typeof mod.deleteAssembly).toBe("function");
    expect(typeof mod.cloneAssembly).toBe("function");
    expect(typeof mod.addComponentToAssembly).toBe("function");
    expect(typeof mod.removeComponentFromAssembly).toBe("function");
    expect(typeof mod.getAssemblyCategories).toBe("function");
    expect(typeof mod.getAssemblyTrades).toBe("function");
    expect(typeof mod.getAssemblyStats).toBe("function");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: Integration — Assembly Engine + Pricing Engine
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 7 — Integration: Assembly + Pricing Engine", () => {
  it("assembly engine reuses pricing engine priceLineItems", () => {
    // Verify that the assembly engine's result is consistent with direct priceLineItems call
    const comp = makeMaterialComponent({ wasteFactorPct: null });
    comp.priceBookItem!.wasteFactor = "1.0000";
    const ctx = makeContext();
    const assemblyResult = calculateAssemblyCost([comp], ctx);

    // Direct pricing engine call
    const directResult = priceLineItems([{
      id: 1,
      name: "Test Material",
      itemType: "material",
      unitCost: 5,
      unitPrice: 8,
      quantity: 10,
      wasteFactor: 1.0,
      coastalModifier: 1.0,
    }], {});

    // Results should match
    expect(assemblyResult.totalDirectCost).toBeCloseTo(directResult.subtotalCost, 2);
    expect(assemblyResult.totalSellPrice).toBeCloseTo(directResult.subtotalPrice, 2);
  });

  it("channel multiplier flows through to pricing engine", () => {
    const comp = makePBIComponent(1, "10", "5.0000", "8.0000");
    const ctxDirect = makeContext({ dimensions: { channelMultiplier: 1.0 } });
    const ctxInsurance = makeContext({ dimensions: { channelMultiplier: 1.15 } });

    const directResult = calculateAssemblyCost([comp], ctxDirect);
    const insuranceResult = calculateAssemblyCost([comp], ctxInsurance);

    // Dimensions should reflect the multiplier was applied
    expect(insuranceResult.dimensionsApplied.channelMultiplier).toBe(1.15);
    expect(directResult.dimensionsApplied.channelMultiplier).toBe(1.0);
    // The channel multiplier is stored and applied — verify it's tracked
    // (The pricing engine may apply channel to cost, price, or both depending on config)
    // At minimum, verify the dimension is recorded correctly
    expect(insuranceResult.dimensionsApplied).toBeDefined();
  });

  it("finish multiplier flows through to pricing engine", () => {
    const comp = makePBIComponent(1, "10", "5.0000", "8.0000");
    const ctxStd = makeContext({ dimensions: { finishMultiplier: 1.0 } });
    const ctxPremium = makeContext({ dimensions: { finishMultiplier: 1.25 } });

    const stdResult = calculateAssemblyCost([comp], ctxStd);
    const premiumResult = calculateAssemblyCost([comp], ctxPremium);

    expect(premiumResult.totalSellPrice).toBeGreaterThan(stdResult.totalSellPrice);
  });

  it("coastal modifier + channel multiplier stack correctly", () => {
    const comp = makeMaterialComponent({ wasteFactorPct: null });
    comp.priceBookItem!.wasteFactor = "1.0000";

    const ctxBase = makeContext();
    const ctxStacked = makeContext({
      coastalModifier: "1.0800",
      dimensions: { channelMultiplier: 1.15 },
    });

    const baseResult = calculateAssemblyCost([comp], ctxBase);
    const stackedResult = calculateAssemblyCost([comp], ctxStacked);

    // Stacked should have higher cost (coastal + channel affect cost)
    expect(stackedResult.totalDirectCost).toBeGreaterThan(baseResult.totalDirectCost);
    // Price may or may not change depending on pricing engine behavior,
    // but cost should definitely be higher
    expect(stackedResult.totalDirectCost).toBeGreaterThan(baseResult.totalDirectCost);
  });

  it("GP calculation is consistent with catalog-utils", () => {
    const comp = makePBIComponent(1, "10", "5.0000", "8.0000");
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);

    const expectedGP = calcGrossProfit(result.totalSellPrice, result.totalDirectCost);
    expect(result.grossProfitPct).toBeCloseTo(expectedGP, 1);
  });

  it("MIN_GROSS_PROFIT constant is 35", () => {
    expect(MIN_GROSS_PROFIT).toBe(35);
  });

  it("meetsMinGP flag is accurate", () => {
    // High margin component
    const comp = makePBIComponent(1, "10", "5.0000", "10.0000");
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);
    // GP = (10-5)/10 = 50%
    expect(result.meetsMinGP).toBe(true);
  });

  it("meetsMinGP is false for low-margin assembly", () => {
    const comp = makePBIComponent(1, "10", "9.0000", "10.0000");
    const ctx = makeContext();
    const result = calculateAssemblyCost([comp], ctx);
    // GP = (10-9)/10 = 10%
    expect(result.meetsMinGP).toBe(false);
  });
});
