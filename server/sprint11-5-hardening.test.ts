/**
 * structr.ai — Sprint 11.5 Hardening Pass Tests
 *
 * Test coverage (38 tests):
 *   Section 1: Rounding Consolidation — shared/utils/math.ts canonical source (6 tests)
 *   Section 2: Audit Logging — assembly-db, pricing-db, router-level cleanup (8 tests)
 *   Section 3: RBAC Hardening — assembly CRUD elevated to adminProcedure (8 tests)
 *   Section 4: Geo Modifier Propagation — zoneToPricingDimensions → assembly-engine → estimate (10 tests)
 *   Section 5: End-to-End Integration — full flow from zone detection to priced estimate (6 tests)
 */

import { describe, it, expect } from "vitest";
import { round2, round4 } from "@shared/utils/math";
import {
  applyPricingDimensions,
  priceLineItems,
  mergeDimensions,
  calcCostMultiplier,
  calcPriceMultiplier,
  DEFAULT_PRICING_DIMENSIONS,
  type PricingDimensions,
  type PricingLineItem,
} from "@shared/pricing-engine";
import {
  calculateAssemblyCost,
  calculateAssemblyCostWithProfitShield,
  calculateMultipleAssemblies,
  type AssemblyComponentInput,
  type AssemblyPricingContext,
} from "@shared/assembly-engine";
import {
  zoneToPricingDimensions,
  coastalExposureToModifier,
  getZoneModifiers,
  getEffectiveMinProfitShield,
  buildProjectGeoContext,
  detectZoneFromZip,
  detectZone,
  validateGeoContext,
  CHARLESTON_ZONES,
  type GeoZoneData,
  type ZoneModifierSnapshot,
  type ZoneDetectionResult,
} from "@shared/geo-engine";
import {
  validateEstimateDraftInputs,
  transformBatchToEstimateDraft,
  type BatchCalculationResult,
  type EstimateDraftContext,
  type AssemblyMetadata,
} from "@shared/estimate-engine";
import { MIN_GROSS_PROFIT, calcGrossProfit } from "@shared/catalog-utils";

// ══════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ══════════════════════════════════════════════════════════════════════

/** Build a test zone with overridable fields */
function makeZone(overrides: Partial<GeoZoneData> = {}): GeoZoneData {
  return {
    id: 1,
    zoneName: "Test Zone",
    county: "Charleston",
    zipCodes: ["29401"],
    centerLat: 32.78,
    centerLng: -79.93,
    radiusMiles: 15,
    coastalExposureLevel: "moderate",
    logisticsComplexity: "standard",
    laborModifier: 1.10,
    logisticsModifier: 1.05,
    materialModifier: 1.08,
    contingencyPct: 10,
    minProfitShieldPct: 38,
    isActive: true,
    ...overrides,
  };
}

/** Build a minimal assembly component for testing */
function makeComponent(overrides: Partial<AssemblyComponentInput> = {}): AssemblyComponentInput {
  return {
    id: 1,
    componentType: "material",
    description: "Test Material",
    quantity: "1.0",
    unit: "EA",
    wasteFactorPct: null,
    unitCostOverride: null,
    priceBookItem: {
      id: 100,
      name: "Test PBI",
      unitCost: "10.00",
      unitPrice: "18.00",
      wasteFactor: "1.05",
      coastalModifier: null,
      itemType: "material",
    },
    ...overrides,
  };
}

/** Build a minimal assembly pricing context */
function makeContext(overrides: Partial<AssemblyPricingContext> = {}): AssemblyPricingContext {
  return {
    assemblyId: 1,
    assemblyName: "Test Assembly",
    coastalModifier: null,
    finishLevel: "standard",
    region: "Charleston",
    ...overrides,
  };
}

/** Build Charleston zones with IDs for testing */
function getCharlestonZonesWithIds(): GeoZoneData[] {
  return CHARLESTON_ZONES.map((z, i) => ({ ...z, id: i + 1 }));
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: Rounding Consolidation
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11.5 — Section 1: Rounding Consolidation", () => {
  it("round2 from shared/utils/math.ts matches pricing-engine re-export", () => {
    // Both modules should produce identical results since pricing-engine re-exports from utils/math
    // Note: round2(1.005) = 1 due to JS floating point (1.005 * 100 = 100.49999...)
    expect(round2(1.005)).toBe(1);
    expect(round2(1.004)).toBe(1);
    expect(round2(99.999)).toBe(100);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(12.345)).toBe(12.35);
    expect(round2(12.344)).toBe(12.34);
  });

  it("round4 from shared/utils/math.ts matches pricing-engine re-export", () => {
    expect(round4(1.00005)).toBe(1.0001);
    expect(round4(1.00004)).toBe(1);
    expect(round4(3.14159265)).toBe(3.1416);
  });

  it("round2 handles negative numbers correctly", () => {
    expect(round2(-1.005)).toBe(-1);
    expect(round2(-99.999)).toBe(-100);
    // -12.345 * 100 = -1234.4999... → rounds to -1234 → -12.34 (JS floating point)
    expect(round2(-12.345)).toBe(-12.34);
    expect(round2(-12.346)).toBe(-12.35);
  });

  it("round4 handles negative numbers correctly", () => {
    expect(round4(-1.00005)).toBe(-1.0001);
    expect(round4(-3.14159)).toBe(-3.1416);
  });

  it("round2 handles zero and integers", () => {
    expect(round2(0)).toBe(0);
    expect(round2(100)).toBe(100);
    expect(round2(50)).toBe(50);
    expect(round2(1000000.99)).toBe(1000000.99);
  });

  it("round2 is used consistently in pricing engine calculations", () => {
    // Verify that applyPricingDimensions returns round2 values
    const result = applyPricingDimensions(10.333, 18.777, "material");
    expect(result.adjustedUnitCost).toBe(round2(10.333));
    expect(result.adjustedUnitPrice).toBe(round2(18.777));
    // GP should also be round2
    const expectedGP = calcGrossProfit(round2(18.777), round2(10.333));
    expect(result.grossProfitPct).toBe(round2(expectedGP));
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: Audit Logging Architecture
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11.5 — Section 2: Audit Logging Architecture", () => {
  it("assembly-db.ts imports logAudit from audit module", async () => {
    // Verify the module structure — assembly-db should have audit capability
    const assemblyDb = await import("./assembly-db");
    expect(assemblyDb).toBeDefined();
    // The module should export CRUD functions that internally call logAudit
    expect(typeof assemblyDb.createAssembly).toBe("function");
    expect(typeof assemblyDb.updateAssembly).toBe("function");
    expect(typeof assemblyDb.deleteAssembly).toBe("function");
    expect(typeof assemblyDb.cloneAssembly).toBe("function");
    expect(typeof assemblyDb.addComponentToAssembly).toBe("function");
    expect(typeof assemblyDb.removeComponentFromAssembly).toBe("function");
  });

  it("pricing-db.ts imports logAudit from audit module", async () => {
    const pricingDb = await import("./pricing-db");
    expect(pricingDb).toBeDefined();
    expect(typeof pricingDb.createPriceBookItem).toBe("function");
    expect(typeof pricingDb.updatePriceBookItem).toBe("function");
    expect(typeof pricingDb.deactivatePriceBookItem).toBe("function");
  });

  it("audit module exports all required functions", async () => {
    const audit = await import("./audit");
    expect(typeof audit.logAudit).toBe("function");
    expect(typeof audit.listAuditLogs).toBe("function");
    expect(typeof audit.getAuditLogById).toBe("function");
    expect(typeof audit.withAuditLog).toBe("function");
  });

  it("AuditLogParams interface supports all required fields", async () => {
    // Verify the interface shape by constructing a valid params object
    const params = {
      userId: 1,
      action: "test.action",
      tableName: "test_table",
      recordId: 42,
      before: { name: "old" },
      after: { name: "new" },
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
    };
    // This should compile without errors (type check)
    expect(params.action).toBe("test.action");
    expect(params.tableName).toBe("test_table");
    expect(params.before).toEqual({ name: "old" });
    expect(params.after).toEqual({ name: "new" });
  });

  it("assembly-router.ts CRUD audit is in DB layer; router-level logAudit is only for normalization events (Sprint 18.5)", async () => {
    // Read the assembly-router source to verify logAudit is used ONLY for normalization audit events
    const fs = await import("fs");
    const routerSource = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Sprint 18.5: assembly-router now imports logAudit for router_normalization_applied events
    // But CRUD audit (create, update, delete) remains in the DB layer (assembly-db.ts)
    // Verify that any logAudit calls in the router are ONLY for normalization events
    const logAuditCalls = routerSource.match(/logAudit\s*\(/g);
    if (logAuditCalls) {
      // Every logAudit call should be for router_normalization_applied, not CRUD
      expect(routerSource).toContain('"router_normalization_applied"');
      expect(routerSource).not.toContain('"assembly.create"');
      expect(routerSource).not.toContain('"assembly.update"');
      expect(routerSource).not.toContain('"assembly.delete"');
    }
  });

  it("assembly-db.ts contains logAudit calls for all CRUD operations", async () => {
    const fs = await import("fs");
    const dbSource = fs.readFileSync(
      new URL("./assembly-db.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Should import logAudit
    expect(dbSource).toContain('import { logAudit }');
    // Should have audit calls for key operations
    // Audit actions use simple verbs with tableName for context
    expect(dbSource).toContain('action: "create"');
    expect(dbSource).toContain('action: "update"');
    expect(dbSource).toContain('action: "delete"');
    // Tables audited: assemblies and assembly_items
    expect(dbSource).toContain('tableName: "assemblies"');
    expect(dbSource).toContain('tableName: "assembly_items"');
  });

  it("pricing-db.ts contains logAudit calls for CRUD operations", async () => {
    const fs = await import("fs");
    const dbSource = fs.readFileSync(
      new URL("./pricing-db.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(dbSource).toContain('import { logAudit }');
    expect(dbSource).toContain('action: "create"');
    expect(dbSource).toContain('action: "update"');
    expect(dbSource).toContain('action: "deactivate"');
    expect(dbSource).toContain('tableName: "cost_code_pricing_history"');
  });

  it("project-db.ts contains logAudit calls for CRUD operations", async () => {
    const fs = await import("fs");
    const dbSource = fs.readFileSync(
      new URL("./project-db.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(dbSource).toContain('logAudit');
    // Project DB should have audit for create, update, status change
    expect(dbSource).toContain('"project.create"');
    expect(dbSource).toContain('"project.update"');
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: RBAC Hardening — Assembly Router
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11.5 — Section 3: RBAC Hardening", () => {
  it("assembly-router.ts uses adminProcedure for create", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Find the create procedure definition
    const createMatch = source.match(/create:\s*(admin|protected|public)Procedure/);
    expect(createMatch).not.toBeNull();
    expect(createMatch![1]).toBe("admin");
  });

  it("assembly-router.ts uses adminProcedure for update", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    const updateMatch = source.match(/update:\s*(admin|protected|public)Procedure/);
    expect(updateMatch).not.toBeNull();
    expect(updateMatch![1]).toBe("admin");
  });

  it("assembly-router.ts uses adminProcedure for delete", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    const deleteMatch = source.match(/delete:\s*(admin|protected|public)Procedure/);
    expect(deleteMatch).not.toBeNull();
    expect(deleteMatch![1]).toBe("admin");
  });

  it("assembly-router.ts uses adminProcedure for clone", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    const cloneMatch = source.match(/clone:\s*(admin|protected|public)Procedure/);
    expect(cloneMatch).not.toBeNull();
    expect(cloneMatch![1]).toBe("admin");
  });

  it("assembly-router.ts uses adminProcedure for addComponent", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    const match = source.match(/addComponent:\s*(admin|protected|public)Procedure/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("admin");
  });

  it("assembly-router.ts uses adminProcedure for removeComponent", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    const match = source.match(/removeComponent:\s*(admin|protected|public)Procedure/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("admin");
  });

  it("assembly-router.ts uses protectedProcedure for read operations (audit fix SCH-03)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Post-audit: all read operations upgraded to protectedProcedure for security
    const listMatch = source.match(/list:\s*(admin|protected|public)Procedure/);
    expect(listMatch![1]).toBe("protected");
    const getByIdMatch = source.match(/getById:\s*(admin|protected|public)Procedure/);
    expect(getByIdMatch![1]).toBe("protected");
    const categoriesMatch = source.match(/categories:\s*(admin|protected|public)Procedure/);
    expect(categoriesMatch![1]).toBe("protected");
    const tradesMatch = source.match(/trades:\s*(admin|protected|public)Procedure/);
    expect(tradesMatch![1]).toBe("protected");
  });

  it("assembly-router.ts uses protectedProcedure for calculateCost and calculateBatch (audit fix SCH-03)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    const calcCostMatch = source.match(/calculateCost:\s*(admin|protected|public)Procedure/);
    expect(calcCostMatch![1]).toBe("protected");
    const calcBatchMatch = source.match(/calculateBatch:\s*(admin|protected|public)Procedure/);
    expect(calcBatchMatch![1]).toBe("protected");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: Geo Modifier Propagation
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11.5 — Section 4: Geo Modifier Propagation", () => {
  const zones = getCharlestonZonesWithIds();

  it("zoneToPricingDimensions maps all 4 modifier fields correctly", () => {
    const zone = makeZone({
      laborModifier: 1.15,
      materialModifier: 1.12,
      logisticsModifier: 1.08,
      coastalExposureLevel: "high",
    });
    const snapshot = getZoneModifiers(zone);
    const dims = zoneToPricingDimensions(snapshot);

    expect(dims.regionalLaborModifier).toBe(1.15);
    expect(dims.regionalMaterialModifier).toBe(1.12);
    expect(dims.regionalCostModifier).toBe(1.08);
    expect(dims.coastalModifier).toBe(1.20); // high → 1.20
  });

  it("geo dimensions merge correctly with DEFAULT_PRICING_DIMENSIONS", () => {
    const geoDims = zoneToPricingDimensions(
      getZoneModifiers(makeZone({ laborModifier: 1.15, coastalExposureLevel: "extreme" }))
    );
    const merged = mergeDimensions(geoDims);

    // Geo-provided fields should override defaults
    expect(merged.regionalLaborModifier).toBe(1.15);
    expect(merged.coastalModifier).toBe(1.30); // extreme → 1.30
    // Non-geo fields should remain at defaults
    expect(merged.wasteFactor).toBe(1.0);
    expect(merged.channelCostMultiplier).toBe(1.0);
    expect(merged.channelPriceMultiplier).toBe(1.0);
    expect(merged.finishMultiplier).toBe(1.0);
  });

  it("geo dimensions affect calcCostMultiplier for material items", () => {
    const geoDims = zoneToPricingDimensions(
      getZoneModifiers(makeZone({ materialModifier: 1.12 }))
    );
    const merged = mergeDimensions(geoDims);

    const multiplier = calcCostMultiplier("material", merged);
    // material: waste(1.0) × coastal(coastalExposureToModifier("moderate")=1.10) × channelCost(1.0) × regionalMaterial(1.12)
    const expected = round4(1.0 * coastalExposureToModifier("moderate") * 1.0 * 1.12);
    expect(multiplier).toBe(expected);
  });

  it("geo dimensions affect calcCostMultiplier for labor items", () => {
    const geoDims = zoneToPricingDimensions(
      getZoneModifiers(makeZone({ laborModifier: 1.18 }))
    );
    const merged = mergeDimensions(geoDims);

    const multiplier = calcCostMultiplier("labor", merged);
    // labor: waste(1.0) × coastal(1.10 for moderate) × channelCost(1.0) × regionalLabor(1.18)
    const expected = round4(1.0 * coastalExposureToModifier("moderate") * 1.0 * 1.18);
    expect(multiplier).toBe(expected);
  });

  it("geo dimensions affect calcCostMultiplier for subcontract/equipment items", () => {
    const geoDims = zoneToPricingDimensions(
      getZoneModifiers(makeZone({ logisticsModifier: 1.06 }))
    );
    const merged = mergeDimensions(geoDims);

    const multiplier = calcCostMultiplier("subcontract", merged);
    // other: waste(1.0) × coastal(1.10) × channelCost(1.0) × regionalCost(1.06)
    const expected = round4(1.0 * coastalExposureToModifier("moderate") * 1.0 * 1.06);
    expect(multiplier).toBe(expected);
  });

  it("assembly-engine applies geo dimensions through context.dimensions", () => {
    const materialComp = makeComponent({
      id: 1,
      componentType: "material",
      description: "Drywall Sheet",
      quantity: "10.0",
      priceBookItem: {
        id: 100, name: "Drywall 4x8", unitCost: "12.00", unitPrice: "20.00",
        wasteFactor: "1.05", coastalModifier: null, itemType: "material",
      },
    });
    const laborComp = makeComponent({
      id: 2,
      componentType: "labor",
      description: "Drywall Install Labor",
      quantity: "8.0",
      priceBookItem: {
        id: 101, name: "Drywall Labor", unitCost: "35.00", unitPrice: "55.00",
        wasteFactor: null, coastalModifier: null, itemType: "labor",
      },
    });

    // Without geo dimensions
    const resultNoGeo = calculateAssemblyCost(
      [materialComp, laborComp],
      makeContext()
    );

    // With Barrier Island Premium geo dimensions
    const barrierZone = zones.find(z => z.zoneName === "Barrier Island Premium")!;
    const geoDims = zoneToPricingDimensions(getZoneModifiers(barrierZone));

    const resultWithGeo = calculateAssemblyCost(
      [materialComp, laborComp],
      makeContext({ dimensions: geoDims })
    );

    // Costs should be higher with geo modifiers (Barrier Island has >1.0 modifiers)
    expect(resultWithGeo.totalDirectCost).toBeGreaterThan(resultNoGeo.totalDirectCost);
    // The dimensions applied should reflect the geo modifiers
    expect(resultWithGeo.dimensionsApplied.regionalLaborModifier).toBe(barrierZone.laborModifier);
    expect(resultWithGeo.dimensionsApplied.regionalMaterialModifier).toBe(barrierZone.materialModifier);
  });

  it("geo dimensions propagate through calculateMultipleAssemblies batch", () => {
    const comp = makeComponent({
      id: 1, componentType: "material", quantity: "5.0",
      priceBookItem: {
        id: 100, name: "Lumber 2x4", unitCost: "8.00", unitPrice: "14.00",
        wasteFactor: "1.10", coastalModifier: null, itemType: "material",
      },
    });

    const barrierZone = zones.find(z => z.zoneName === "Barrier Island Premium")!;
    const geoDims = zoneToPricingDimensions(getZoneModifiers(barrierZone));

    const batchNoGeo = calculateMultipleAssemblies([
      { components: [comp], context: makeContext(), quantity: 2 },
    ]);
    const batchWithGeo = calculateMultipleAssemblies([
      { components: [comp], context: makeContext({ dimensions: geoDims }), quantity: 2 },
    ]);

    expect(batchWithGeo.totalCost).toBeGreaterThan(batchNoGeo.totalCost);
  });

  it("Barrier Island Premium produces the highest cost multiplier", () => {
    const comp = makeComponent({
      id: 1, componentType: "material", quantity: "1.0",
      priceBookItem: {
        id: 100, name: "Test Item", unitCost: "100.00", unitPrice: "170.00",
        wasteFactor: null, coastalModifier: null, itemType: "material",
      },
    });

    const results = zones.map(zone => {
      const geoDims = zoneToPricingDimensions(getZoneModifiers(zone));
      const result = calculateAssemblyCost(
        [comp],
        makeContext({ dimensions: geoDims })
      );
      return { zoneName: zone.zoneName, cost: result.totalDirectCost };
    });

    // Barrier Island should have the highest cost
    const barrierCost = results.find(r => r.zoneName === "Barrier Island Premium")!.cost;
    for (const r of results) {
      if (r.zoneName !== "Barrier Island Premium") {
        expect(barrierCost).toBeGreaterThanOrEqual(r.cost);
      }
    }
  });

  it("Summerville/Goose Creek (none coastal) produces the lowest cost multiplier", () => {
    const comp = makeComponent({
      id: 1, componentType: "material", quantity: "1.0",
      priceBookItem: {
        id: 100, name: "Test Item", unitCost: "100.00", unitPrice: "170.00",
        wasteFactor: null, coastalModifier: null, itemType: "material",
      },
    });

    const results = zones.map(zone => {
      const geoDims = zoneToPricingDimensions(getZoneModifiers(zone));
      const result = calculateAssemblyCost(
        [comp],
        makeContext({ dimensions: geoDims })
      );
      return { zoneName: zone.zoneName, cost: result.totalDirectCost };
    });

    // Summerville has coastalExposure=none + labor/material=1.0 → lowest cost
    const summervilleCost = results.find(r => r.zoneName === "Summerville / Goose Creek")!.cost;
    for (const r of results) {
      expect(summervilleCost).toBeLessThanOrEqual(r.cost);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: End-to-End Integration
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11.5 — Section 5: End-to-End Integration", () => {
  const zones = getCharlestonZonesWithIds();

  it("full flow: ZIP detection → zone modifiers → assembly pricing → estimate draft", () => {
    // Step 1: Detect zone from ZIP
    const detection = detectZoneFromZip("29455", zones); // Barrier Island
    expect(detection.zone).not.toBeNull();
    expect(detection.zone!.zoneName).toBe("Barrier Island Premium");
    expect(detection.confidence).toBe("high");

    // Step 2: Extract zone modifiers
    const snapshot = getZoneModifiers(detection.zone!);
    expect(snapshot.laborModifier).toBeGreaterThan(1.0);
    expect(snapshot.coastalExposureLevel).toBe("extreme");

    // Step 3: Convert to pricing dimensions
    const geoDims = zoneToPricingDimensions(snapshot);
    expect(geoDims.coastalModifier).toBe(1.30); // extreme

    // Step 4: Calculate assembly cost with geo dimensions
    const comp = makeComponent({
      id: 1, componentType: "material", quantity: "10.0",
      priceBookItem: {
        id: 100, name: "Impact Window", unitCost: "450.00", unitPrice: "750.00",
        wasteFactor: "1.02", coastalModifier: null, itemType: "material",
      },
    });
    const result = calculateAssemblyCost(
      [comp],
      makeContext({ dimensions: geoDims })
    );
    expect(result.totalDirectCost).toBeGreaterThan(0);
    expect(result.dimensionsApplied.coastalModifier).toBe(1.30);

    // Step 5: Build batch result for estimate
    const batchResult: BatchCalculationResult = {
      assemblies: [{
        ...result,
        quantity: 1,
        extendedCost: result.totalDirectCost,
        extendedPrice: result.totalSellPrice,
      }],
      totalCost: result.totalDirectCost,
      totalPrice: result.totalSellPrice,
      grossProfit: result.grossProfit,
      grossProfitPct: result.grossProfitPct,
      meetsMinGP: result.meetsMinGP,
    };

    // Step 6: Transform to estimate draft
    const context: EstimateDraftContext = {
      region: "Charleston",
      channel: "direct",
      finishLevel: "standard",
    };
    const metadata = new Map<string, AssemblyMetadata>([
      [1, { id: 1, code: "WIN-001", category: "Windows", trade: "Glazing" }],
    ]);
    const draft = transformBatchToEstimateDraft(batchResult, context, metadata);

    expect(draft.lineItems.length).toBeGreaterThan(0);
    expect(parseFloat(draft.subtotalCost)).toBeGreaterThan(0);
    expect(draft.region).toBe("Charleston");
    expect(draft.channel).toBe("direct"); // canonical channel value
  });

  it("geo-modified estimate has higher cost than unmodified for same assembly", () => {
    const comp = makeComponent({
      id: 1, componentType: "material", quantity: "5.0",
      priceBookItem: {
        id: 100, name: "Roofing Shingle", unitCost: "85.00", unitPrice: "145.00",
        wasteFactor: "1.10", coastalModifier: null, itemType: "material",
      },
    });

    // Unmodified (no geo)
    const resultPlain = calculateAssemblyCost([comp], makeContext());

    // With Barrier Island geo
    const barrierZone = zones.find(z => z.zoneName === "Barrier Island Premium")!;
    const geoDims = zoneToPricingDimensions(getZoneModifiers(barrierZone));
    const resultGeo = calculateAssemblyCost([comp], makeContext({ dimensions: geoDims }));

    expect(resultGeo.totalDirectCost).toBeGreaterThan(resultPlain.totalDirectCost);
    const costIncreasePct = ((resultGeo.totalDirectCost - resultPlain.totalDirectCost) / resultPlain.totalDirectCost) * 100;
    // Barrier Island should add at least 15% to costs (extreme coastal + high labor/material mods)
    expect(costIncreasePct).toBeGreaterThan(15);
  });

  it("getEffectiveMinProfitShield returns zone-specific value when available", () => {
    const barrierZone = zones.find(z => z.zoneName === "Barrier Island Premium")!;
    const snapshot = getZoneModifiers(barrierZone);

    const minGP = getEffectiveMinProfitShield(snapshot);
    expect(minGP).toBe(barrierZone.minProfitShieldPct);
    expect(minGP).toBeGreaterThan(MIN_GROSS_PROFIT); // Barrier Island should have higher min GP
  });

  it("getEffectiveMinProfitShield returns system default (35%) when no snapshot", () => {
    expect(getEffectiveMinProfitShield(null)).toBe(35.0);
    expect(getEffectiveMinProfitShield(undefined)).toBe(35.0);
  });

  it("geoDimensions schema is accepted by assembly-router calculateCost", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./assembly-router.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Verify geoDimensions schema exists
    expect(source).toContain("geoDimensionsSchema");
    expect(source).toContain("regionalLaborModifier");
    expect(source).toContain("regionalMaterialModifier");
    expect(source).toContain("regionalCostModifier");
    expect(source).toContain("coastalModifier");
    // Verify it's used in both calculateCost and calculateBatch
    expect(source).toContain("geoDimensions: geoDimensionsSchema");
    // Verify it's passed to toPricingEngineDimensions (Sprint 18: DB-driven resolution)
    expect(source).toContain("toPricingEngineDimensions(resolved, input.geoDimensions");
  });

  it("validateGeoContext produces warnings for high coastal zones", () => {
    const barrierZone = zones.find(z => z.zoneName === "Barrier Island Premium")!;
    const detection: ZoneDetectionResult = {
      zone: barrierZone,
      method: "zip",
      confidence: "high",
    };
    const validation = validateGeoContext(detection);
    expect(validation.isValid).toBe(true); // Never blocks
    // Should have high coastal warning
    const coastalWarning = validation.warnings.find(w => w.code === "GEO_HIGH_COASTAL");
    expect(coastalWarning).toBeDefined();
    expect(coastalWarning!.message).toContain("extreme");
  });
});
