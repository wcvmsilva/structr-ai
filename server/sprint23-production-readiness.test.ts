/**
 * Sprint 23 — Production Readiness Tests
 * Tests for bug fixes introduced in Sprint 23.
 */
import { describe, it, expect } from "vitest";
import {
  resolveOverrides,
  matchOverrideRules,
  type OverrideRule,
  type ResolverInputItem,
  type AssemblyLookupEntry,
} from "../shared/geo-override-engine";
import { safeParseFloat } from "../shared/utils/math";
import { PROFIT_SHIELD, PROFIT_SHIELD_PCT } from "../shared/constants/profit-shield";

// ═══════════════════════════════════════════════════════════════════
// 3.1 — Geo Override: Duplicate Swap Prevention
// ═══════════════════════════════════════════════════════════════════

describe("Sprint 23 — Geo Override Duplicate Swap Prevention", () => {
  const testItem: ResolverInputItem = {
    assemblyId: 100,
    assemblyName: "Standard Roofing Shingles",
    trade: "Roofing",
    finishLevel: "standard",
    quantity: 10,
    unit: "sq",
    reason: "Roof area",
    confidence: 0.95,
    sortOrder: 1,
  };

  const swapRule1: OverrideRule = {
    id: 1,
    zone: "IOP/Sullivans",
    trade: "Roofing",
    finishLevel: null,
    originalAssemblyId: 100,
    replacementAssemblyId: 200,
    overrideType: "swap",
    reasonTemplate: "Coastal upgrade: {original} → {replacement} in {zone}",
    active: true,
  };

  const swapRule2: OverrideRule = {
    id: 2,
    zone: "IOP/Sullivans",
    trade: "Roofing",
    finishLevel: null,
    originalAssemblyId: 100,
    replacementAssemblyId: 300,
    overrideType: "swap",
    reasonTemplate: "Hurricane upgrade: {original} → {replacement} in {zone}",
    active: true,
  };

  const assemblyLookup = new Map<string, AssemblyLookupEntry>([
    [100, { id: 100, name: "Standard Roofing Shingles", code: "ROOF-STD", trade: "Roofing" }],
    [200, { id: 200, name: "Impact-Resistant Shingles", code: "ROOF-IMP", trade: "Roofing" }],
    [300, { id: 300, name: "Hurricane-Grade Shingles", code: "ROOF-HUR", trade: "Roofing" }],
  ]);

  it("should produce only 1 resolved item when 2 swap rules match the same item", () => {
    const result = resolveOverrides(
      [testItem],
      "IOP/Sullivans",
      [swapRule1, swapRule2],
      assemblyLookup,
      []
    );

    // Only the first swap should be applied — no duplicate
    expect(result.resolvedItems).toHaveLength(1);
    expect(result.resolvedItems[0].assemblyId).toBe(200); // First swap wins
    expect(result.resolvedItems[0].overrideType).toBe("swap");
    expect(result.resolvedItems[0].overriddenFrom).toBe(100);
    expect(result.stats.swapsApplied).toBe(1);
  });

  it("should not include original item when swap is applied", () => {
    const result = resolveOverrides(
      [testItem],
      "IOP/Sullivans",
      [swapRule1],
      assemblyLookup,
      []
    );

    // Original item should NOT appear in resolved items
    const originalInResult = result.resolvedItems.some(
      (item) => item.assemblyId === 100
    );
    expect(originalInResult).toBe(false);
    expect(result.resolvedItems).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3.3 — Profit Shield Constants
// ═══════════════════════════════════════════════════════════════════

describe("Sprint 23 — Profit Shield Constants", () => {
  it("should have correct percentage values", () => {
    expect(PROFIT_SHIELD_PCT.GLOBAL_MIN_GP).toBe(35);
    expect(PROFIT_SHIELD_PCT.INDIVIDUAL_WARNING_GP).toBeCloseTo(28, 5);
    expect(PROFIT_SHIELD_PCT.COASTAL_MIN_GP).toBe(42);
    expect(PROFIT_SHIELD_PCT.BARRIER_ISLAND_MIN_GP).toBe(50);
  });

  it("should have correct decimal values", () => {
    expect(PROFIT_SHIELD.GLOBAL_MIN_GP).toBe(0.35);
    expect(PROFIT_SHIELD.INDIVIDUAL_WARNING_GP).toBe(0.28);
    expect(PROFIT_SHIELD.COASTAL_MIN_GP).toBe(0.42);
    expect(PROFIT_SHIELD.BARRIER_ISLAND_MIN_GP).toBe(0.50);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3.4 — safeParseFloat Validation
// ═══════════════════════════════════════════════════════════════════

describe("Sprint 23 — safeParseFloat Validation", () => {
  it("should parse valid numeric strings", () => {
    expect(safeParseFloat("123.45", "test")).toBe(123.45);
    expect(safeParseFloat("0", "test")).toBe(0);
    expect(safeParseFloat("-50.5", "test")).toBe(-50.5);
  });

  it("should pass through numbers", () => {
    expect(safeParseFloat(123.45, "test")).toBe(123.45);
    expect(safeParseFloat(0, "test")).toBe(0);
  });

  it("should throw on NaN values", () => {
    expect(() => safeParseFloat("not-a-number", "unitCost")).toThrow(
      'Invalid numeric value for unitCost: "not-a-number"'
    );
    expect(() => safeParseFloat("", "unitPrice")).toThrow(
      'Invalid numeric value for unitPrice: ""'
    );
  });
});
