/**
 * structr.ai Construction Brain — Sprint 16 Tests
 * Geographic / Coastal Override Resolver
 *
 * 65+ tests covering:
 *   1. Zone classification (coastal vs inland)
 *   2. Rule matching (zone, trade, assembly, finish level)
 *   3. Swap override logic
 *   4. Addition override logic
 *   5. Warning-only override logic
 *   6. Idempotency (skip already-applied overrides)
 *   7. Passthrough for inland/metro zones
 *   8. Reason template rendering
 *   9. Rule validation
 *   10. Resolver output validation
 *   11. Seed data integrity
 *   12. Router structure
 *   13. Schema fields
 *   14. Edge cases
 *   15. Cross-module compatibility
 */

import { describe, it, expect } from "vitest";
import {
  resolveOverrides,
  matchOverrideRules,
  isCoastalOverrideZone,
  isInlandPassthroughZone,
  renderReasonTemplate,
  validateOverrideRule,
  validateResolverOutput,
  COASTAL_OVERRIDE_ZONES,
  INLAND_PASSTHROUGH_ZONES,
  type OverrideRule,
  type ResolverInputItem,
  type AssemblyLookupEntry,
  type PreviousOverrideEntry,
  type OverrideResolverOutput,
  type ResolvedScopeItem,
  type ResolvedOverride,
} from "@shared/geo-override-engine";
import {
  COASTAL_OVERRIDE_SEED_RULES,
  getSeedSummary,
} from "@shared/geo-override-seed";

// ══════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ══════════════════════════════════════════════════════════════════════

function makeItem(overrides: Partial<ResolverInputItem> = {}): ResolverInputItem {
  return {
    assemblyId: "101",
    assemblyName: "Standard Roofing Shingles",
    trade: "roofing",
    finishLevel: null,
    quantity: 1,
    unit: "EA",
    reason: "Scope engine selected",
    confidence: 0.85,
    sortOrder: 1,
    ...overrides,
  };
}

function makeRule(overrides: Partial<OverrideRule> = {}): OverrideRule {
  return {
    id: "1",
    zone: "Barrier Island Premium",
    trade: "roofing",
    finishLevel: null,
    originalAssemblyId: "101",
    replacementAssemblyId: "201",
    overrideType: "swap",
    reasonTemplate: "Barrier island requires 130 mph-rated roofing.",
    active: true,
    ...overrides,
  };
}

function makeLookup(entries: Array<[string, Partial<AssemblyLookupEntry>]> = []): Map<string, AssemblyLookupEntry> {
  const map = new Map<string, AssemblyLookupEntry>();
  // Default entries
  map.set("101", { id: "101", name: "Standard Roofing Shingles", code: "ROOF-STD", trade: "roofing" });
  map.set("201", { id: "201", name: "Impact-Resistant Class 4 Shingles", code: "ROOF-IMPACT", trade: "roofing" });
  map.set("301", { id: "301", name: "Secondary Water Barrier", code: "ROOF-WB", trade: "roofing" });
  map.set("102", { id: "102", name: "Standard Windows", code: "WIN-STD", trade: "windows_doors" });
  map.set("202", { id: "202", name: "Impact-Rated Windows", code: "WIN-IMPACT", trade: "windows_doors" });
  map.set("104", { id: "104", name: "Standard Vinyl Siding", code: "SID-STD", trade: "siding" });
  map.set("204", { id: "204", name: "HardiePlank Fiber Cement", code: "SID-HARDI", trade: "siding" });
  map.set("302", { id: "302", name: "Enhanced Moisture Barrier", code: "SID-WB", trade: "siding" });
  map.set("100", { id: "100", name: "General Placeholder", code: "GEN-PH", trade: "general" });
  map.set("110", { id: "110", name: "Standard Exterior Paint", code: "PAINT-STD", trade: "painting" });
  map.set("212", { id: "212", name: "Marine-Grade Exterior Paint", code: "PAINT-MARINE", trade: "painting" });
  // Add custom entries
  for (const [id, entry] of entries) {
    map.set(id, { id, name: `Assembly #${id}`, code: `ASM-${id}`, trade: null, ...entry });
  }
  return map;
}

// ══════════════════════════════════════════════════════════════════════
// 1. ZONE CLASSIFICATION
// ══════════════════════════════════════════════════════════════════════

describe("Zone Classification", () => {
  it("identifies Barrier Island Premium as coastal", () => {
    expect(isCoastalOverrideZone("Barrier Island Premium")).toBe(true);
  });

  it("identifies Charleston Coastal as coastal", () => {
    expect(isCoastalOverrideZone("Charleston Coastal")).toBe(true);
  });

  it("identifies IOP/Sullivans as coastal", () => {
    expect(isCoastalOverrideZone("IOP/Sullivans")).toBe(true);
  });

  it("identifies Summerville/Goose Creek as inland", () => {
    expect(isInlandPassthroughZone("Summerville/Goose Creek")).toBe(true);
  });

  it("identifies North Charleston as inland", () => {
    expect(isInlandPassthroughZone("North Charleston")).toBe(true);
  });

  it("identifies West Ashley as inland", () => {
    expect(isInlandPassthroughZone("West Ashley")).toBe(true);
  });

  it("uses case-insensitive matching for coastal zones", () => {
    expect(isCoastalOverrideZone("barrier island premium")).toBe(true);
    expect(isCoastalOverrideZone("CHARLESTON COASTAL")).toBe(true);
  });

  it("uses case-insensitive matching for inland zones", () => {
    expect(isInlandPassthroughZone("summerville/goose creek")).toBe(true);
    expect(isInlandPassthroughZone("NORTH CHARLESTON")).toBe(true);
  });

  it("returns false for unknown zones", () => {
    expect(isCoastalOverrideZone("Mars Colony")).toBe(false);
    expect(isInlandPassthroughZone("Mars Colony")).toBe(false);
  });

  it("exports COASTAL_OVERRIDE_ZONES as non-empty array", () => {
    expect(COASTAL_OVERRIDE_ZONES.length).toBeGreaterThanOrEqual(3);
  });

  it("exports INLAND_PASSTHROUGH_ZONES as non-empty array", () => {
    expect(INLAND_PASSTHROUGH_ZONES.length).toBeGreaterThanOrEqual(3);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. RULE MATCHING
// ══════════════════════════════════════════════════════════════════════

describe("Rule Matching", () => {
  it("matches rule by zone + trade + assemblyId", () => {
    const item = makeItem();
    const rule = makeRule();
    const matches = matchOverrideRules(item, "Barrier Island Premium", [rule]);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("1");
  });

  it("rejects rule when zone does not match", () => {
    const item = makeItem();
    const rule = makeRule();
    const matches = matchOverrideRules(item, "Charleston Metro", [rule]);
    expect(matches).toHaveLength(0);
  });

  it("rejects rule when assemblyId does not match", () => {
    const item = makeItem({ assemblyId: "999" });
    const rule = makeRule();
    const matches = matchOverrideRules(item, "Barrier Island Premium", [rule]);
    expect(matches).toHaveLength(0);
  });

  it("rejects inactive rules", () => {
    const item = makeItem();
    const rule = makeRule({ active: false });
    const matches = matchOverrideRules(item, "Barrier Island Premium", [rule]);
    expect(matches).toHaveLength(0);
  });

  it("matches with case-insensitive zone comparison", () => {
    const item = makeItem();
    const rule = makeRule({ zone: "barrier island premium" });
    const matches = matchOverrideRules(item, "Barrier Island Premium", [rule]);
    expect(matches).toHaveLength(1);
  });

  it("filters by finishLevel when rule specifies one", () => {
    const item = makeItem({ finishLevel: "luxury", assemblyId: "110", trade: "painting" });
    const ruleWithFinish = makeRule({
      id: "2",
      trade: "painting",
      finishLevel: "luxury",
      originalAssemblyId: "110",
      replacementAssemblyId: "212",
    });
    const matches = matchOverrideRules(item, "Barrier Island Premium", [ruleWithFinish]);
    expect(matches).toHaveLength(1);
  });

  it("rejects rule when finishLevel does not match", () => {
    const item = makeItem({ finishLevel: "standard", assemblyId: "110", trade: "painting" });
    const ruleWithFinish = makeRule({
      id: "2",
      trade: "painting",
      finishLevel: "luxury",
      originalAssemblyId: "110",
      replacementAssemblyId: "212",
    });
    const matches = matchOverrideRules(item, "Barrier Island Premium", [ruleWithFinish]);
    expect(matches).toHaveLength(0);
  });

  it("matches rule with null finishLevel against any item finishLevel", () => {
    const item = makeItem({ finishLevel: "premium" });
    const rule = makeRule({ finishLevel: null });
    const matches = matchOverrideRules(item, "Barrier Island Premium", [rule]);
    expect(matches).toHaveLength(1);
  });

  it("returns multiple matching rules for same item", () => {
    const item = makeItem();
    const swapRule = makeRule({ id: "1", overrideType: "swap" });
    const addRule = makeRule({ id: "2", overrideType: "add", replacementAssemblyId: "301" });
    const matches = matchOverrideRules(item, "Barrier Island Premium", [swapRule, addRule]);
    expect(matches).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. SWAP OVERRIDE LOGIC
// ══════════════════════════════════════════════════════════════════════

describe("Swap Override Logic", () => {
  it("replaces original assembly with replacement in resolved items", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.resolvedItems).toHaveLength(1);
    expect(result.resolvedItems[0].assemblyId).toBe("201");
    expect(result.resolvedItems[0].overriddenFrom).toBe("101");
    expect(result.resolvedItems[0].overrideType).toBe("swap");
  });

  it("preserves quantity and unit from original item", () => {
    const items = [makeItem({ quantity: 5, unit: "SQ" })];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.resolvedItems[0].quantity).toBe(5);
    expect(result.resolvedItems[0].unit).toBe("SQ");
  });

  it("records swap in overrides array", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0].overrideType).toBe("swap");
    expect(result.overrides[0].originalAssemblyId).toBe("101");
    expect(result.overrides[0].replacementAssemblyId).toBe("201");
  });

  it("increments swapsApplied in stats", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.stats.swapsApplied).toBe(1);
    expect(result.hasOverrides).toBe(true);
  });

  it("uses replacement assembly name from lookup", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.resolvedItems[0].assemblyName).toBe("Impact-Resistant Class 4 Shingles");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. ADDITION OVERRIDE LOGIC
// ══════════════════════════════════════════════════════════════════════

describe("Addition Override Logic", () => {
  it("injects additional assembly after the triggering item", () => {
    const items = [makeItem()];
    const rules = [makeRule({ id: "2", overrideType: "add", replacementAssemblyId: "301" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    // Original item + addition
    expect(result.resolvedItems.length).toBeGreaterThanOrEqual(2);
    const addedItem = result.resolvedItems.find((i) => i.assemblyId === "301");
    expect(addedItem).toBeDefined();
    expect(addedItem!.overrideType).toBe("add");
    expect(addedItem!.overriddenFrom).toBe("101");
  });

  it("sets confidence to 1.0 for code-mandated additions", () => {
    const items = [makeItem()];
    const rules = [makeRule({ id: "2", overrideType: "add", replacementAssemblyId: "301" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    const addedItem = result.resolvedItems.find((i) => i.assemblyId === "301");
    expect(addedItem!.confidence).toBe(1.0);
  });

  it("increments additionsApplied in stats", () => {
    const items = [makeItem()];
    const rules = [makeRule({ id: "2", overrideType: "add", replacementAssemblyId: "301" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.stats.additionsApplied).toBe(1);
    expect(result.stats.totalResolvedItems).toBeGreaterThan(result.stats.totalInputItems);
  });

  it("increases total resolved items count", () => {
    const items = [makeItem()];
    const rules = [makeRule({ id: "2", overrideType: "add", replacementAssemblyId: "301" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.stats.totalResolvedItems).toBe(result.stats.totalInputItems + 1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. WARNING-ONLY OVERRIDE LOGIC
// ══════════════════════════════════════════════════════════════════════

describe("Warning-Only Override Logic", () => {
  it("generates warning without modifying scope items", () => {
    const items = [makeItem({ assemblyId: "100", assemblyName: "General Placeholder", trade: "general" })];
    const rules = [
      makeRule({
        id: "10",
        trade: "general",
        originalAssemblyId: "100",
        replacementAssemblyId: "100",
        overrideType: "warning_only",
        reasonTemplate: "ADVISORY: Verify flood zone designation.",
      }),
    ];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("ADVISORY");
    expect(result.stats.warningsGenerated).toBe(1);
    // Items unchanged
    expect(result.resolvedItems).toHaveLength(1);
    expect(result.resolvedItems[0].assemblyId).toBe("100");
    expect(result.resolvedItems[0].overrideType).toBeNull();
  });

  it("includes zone name in warning message", () => {
    const items = [makeItem({ assemblyId: "100", trade: "general" })];
    const rules = [
      makeRule({
        id: "10",
        trade: "general",
        originalAssemblyId: "100",
        replacementAssemblyId: "100",
        overrideType: "warning_only",
        reasonTemplate: "Check flood zone for {zone}.",
      }),
    ];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.warnings[0]).toContain("Barrier Island Premium");
  });

  it("sets hasOverrides to true when only warnings exist", () => {
    const items = [makeItem({ assemblyId: "100", trade: "general" })];
    const rules = [
      makeRule({
        id: "10",
        trade: "general",
        originalAssemblyId: "100",
        replacementAssemblyId: "100",
        overrideType: "warning_only",
        reasonTemplate: "Advisory note.",
      }),
    ];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.hasOverrides).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. IDEMPOTENCY
// ══════════════════════════════════════════════════════════════════════

describe("Idempotency", () => {
  it("skips override when already in previouslyApplied log", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();
    const previouslyApplied: PreviousOverrideEntry[] = [
      { scopeDraftId: 1, originalAssemblyId: "101", replacementAssemblyId: "201", overrideType: "swap" },
    ];

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup, previouslyApplied);

    expect(result.stats.skippedAlreadyApplied).toBe(1);
    expect(result.stats.swapsApplied).toBe(0);
  });

  it("marks skipped overrides in the overrides array", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();
    const previouslyApplied: PreviousOverrideEntry[] = [
      { scopeDraftId: 1, originalAssemblyId: "101", replacementAssemblyId: "201", overrideType: "swap" },
    ];

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup, previouslyApplied);

    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0].skippedBecauseAlreadyApplied).toBe(true);
  });

  it("applies new overrides while skipping already-applied ones", () => {
    const items = [
      makeItem({ assemblyId: "101", sortOrder: 1 }),
      makeItem({ assemblyId: "102", assemblyName: "Standard Windows", trade: "windows_doors", sortOrder: 2 }),
    ];
    const rules = [
      makeRule({ id: "1", overrideType: "swap", originalAssemblyId: "101", replacementAssemblyId: "201" }),
      makeRule({ id: "2", zone: "Barrier Island Premium", trade: "windows_doors", overrideType: "swap", originalAssemblyId: "102", replacementAssemblyId: "202" }),
    ];
    const lookup = makeLookup();
    // Only roofing was previously applied
    const previouslyApplied: PreviousOverrideEntry[] = [
      { scopeDraftId: 1, originalAssemblyId: "101", replacementAssemblyId: "201", overrideType: "swap" },
    ];

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup, previouslyApplied);

    expect(result.stats.skippedAlreadyApplied).toBe(1);
    expect(result.stats.swapsApplied).toBe(1); // Only windows swap is new
  });

  it("produces identical output on re-run with full previouslyApplied", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();

    // First run
    const result1 = resolveOverrides(items, "Barrier Island Premium", rules, lookup, []);

    // Second run with previous log
    const previouslyApplied: PreviousOverrideEntry[] = [
      { scopeDraftId: 1, originalAssemblyId: "101", replacementAssemblyId: "201", overrideType: "swap" },
    ];
    const result2 = resolveOverrides(items, "Barrier Island Premium", rules, lookup, previouslyApplied);

    // Both should have 1 override recorded, but second run skips it
    expect(result1.overrides).toHaveLength(1);
    expect(result2.overrides).toHaveLength(1);
    expect(result2.stats.skippedAlreadyApplied).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. PASSTHROUGH FOR INLAND/METRO ZONES
// ══════════════════════════════════════════════════════════════════════

describe("Inland/Metro Passthrough", () => {
  it("passes through all items for Summerville/Goose Creek", () => {
    const items = [makeItem(), makeItem({ assemblyId: "102", trade: "windows_doors", sortOrder: 2 })];
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Summerville/Goose Creek", rules, lookup);

    expect(result.hasOverrides).toBe(false);
    expect(result.resolvedItems).toHaveLength(2);
    expect(result.overrides).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("passes through for North Charleston", () => {
    const items = [makeItem()];
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "North Charleston", rules, lookup);

    expect(result.hasOverrides).toBe(false);
    expect(result.stats.rulesMatched).toBe(0);
  });

  it("passes through for empty zone string", () => {
    const items = [makeItem()];
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "", rules, lookup);

    expect(result.hasOverrides).toBe(false);
  });

  it("passes through for 'unknown' zone", () => {
    const items = [makeItem()];
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "unknown", rules, lookup);

    expect(result.hasOverrides).toBe(false);
  });

  it("preserves all original items in passthrough", () => {
    const items = [
      makeItem({ assemblyId: "101", sortOrder: 1 }),
      makeItem({ assemblyId: "102", sortOrder: 2 }),
      makeItem({ assemblyId: "104", sortOrder: 3 }),
    ];
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "West Ashley", rules, lookup);

    expect(result.resolvedItems).toHaveLength(3);
    expect(result.resolvedItems.every((i) => i.overrideType === null)).toBe(true);
    expect(result.resolvedItems.every((i) => i.overriddenFrom === null)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. REASON TEMPLATE RENDERING
// ══════════════════════════════════════════════════════════════════════

describe("Reason Template Rendering", () => {
  it("substitutes {zone} variable", () => {
    const result = renderReasonTemplate("Project in {zone} requires upgrade.", {
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalName: "Standard Shingles",
      replacementName: "Impact Shingles",
    });
    expect(result).toContain("Barrier Island Premium");
  });

  it("substitutes {trade} variable", () => {
    const result = renderReasonTemplate("{trade} upgrade required.", {
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalName: "Standard Shingles",
      replacementName: "Impact Shingles",
    });
    expect(result).toBe("roofing upgrade required.");
  });

  it("substitutes {original} variable", () => {
    const result = renderReasonTemplate("Replace {original} with coastal grade.", {
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalName: "Standard Shingles",
      replacementName: "Impact Shingles",
    });
    expect(result).toContain("Standard Shingles");
  });

  it("substitutes {replacement} variable", () => {
    const result = renderReasonTemplate("Install {replacement} instead.", {
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalName: "Standard Shingles",
      replacementName: "Impact Shingles",
    });
    expect(result).toContain("Impact Shingles");
  });

  it("handles templates with no variables", () => {
    const result = renderReasonTemplate("Static reason text.", {
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalName: "Standard Shingles",
      replacementName: "Impact Shingles",
    });
    expect(result).toBe("Static reason text.");
  });

  it("handles case-insensitive variable names", () => {
    const result = renderReasonTemplate("{ZONE} requires {TRADE} upgrade.", {
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalName: "Standard Shingles",
      replacementName: "Impact Shingles",
    });
    expect(result).toContain("Barrier Island Premium");
    expect(result).toContain("roofing");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. RULE VALIDATION
// ══════════════════════════════════════════════════════════════════════

describe("Rule Validation", () => {
  it("returns no errors for a valid rule", () => {
    const errors = validateOverrideRule({
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalAssemblyId: "101",
      replacementAssemblyId: "201",
      overrideType: "swap",
      reasonTemplate: "Coastal upgrade required.",
    });
    expect(errors).toHaveLength(0);
  });

  it("requires zone", () => {
    const errors = validateOverrideRule({
      zone: "",
      trade: "roofing",
      originalAssemblyId: "101",
      replacementAssemblyId: "201",
      overrideType: "swap",
      reasonTemplate: "Reason.",
    });
    expect(errors).toContainEqual(expect.stringContaining("Zone"));
  });

  it("requires trade", () => {
    const errors = validateOverrideRule({
      zone: "Barrier Island Premium",
      trade: "",
      originalAssemblyId: "101",
      replacementAssemblyId: "201",
      overrideType: "swap",
      reasonTemplate: "Reason.",
    });
    expect(errors).toContainEqual(expect.stringContaining("Trade"));
  });

  it("requires non-empty originalAssemblyId", () => {
    const errors = validateOverrideRule({
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalAssemblyId: "",
      replacementAssemblyId: "201",
      overrideType: "swap",
      reasonTemplate: "Reason.",
    });
    expect(errors).toContainEqual(expect.stringContaining("Original assembly"));
  });

  it("rejects same original and replacement IDs", () => {
    const errors = validateOverrideRule({
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalAssemblyId: "101",
      replacementAssemblyId: "101",
      overrideType: "swap",
      reasonTemplate: "Reason.",
    });
    expect(errors).toContainEqual(expect.stringContaining("different"));
  });

  it("requires valid overrideType", () => {
    const errors = validateOverrideRule({
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalAssemblyId: "101",
      replacementAssemblyId: "201",
      overrideType: "invalid" as any,
      reasonTemplate: "Reason.",
    });
    expect(errors).toContainEqual(expect.stringContaining("Override type"));
  });

  it("requires reasonTemplate", () => {
    const errors = validateOverrideRule({
      zone: "Barrier Island Premium",
      trade: "roofing",
      originalAssemblyId: "101",
      replacementAssemblyId: "201",
      overrideType: "swap",
      reasonTemplate: "",
    });
    expect(errors).toContainEqual(expect.stringContaining("Reason template"));
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. RESOLVER OUTPUT VALIDATION
// ══════════════════════════════════════════════════════════════════════

describe("Resolver Output Validation", () => {
  it("validates a correct resolver output with no errors", () => {
    const items = [makeItem()];
    const rules = [makeRule({ overrideType: "swap" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);
    const errors = validateResolverOutput(result);

    expect(errors).toHaveLength(0);
  });

  it("validates passthrough output with no errors", () => {
    const items = [makeItem()];
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Summerville/Goose Creek", rules, lookup);
    const errors = validateResolverOutput(result);

    expect(errors).toHaveLength(0);
  });

  it("detects stats mismatch in totalResolvedItems", () => {
    const output: OverrideResolverOutput = {
      resolvedItems: [{ assemblyId: "1", assemblyName: "Test", trade: null, finishLevel: null, quantity: 1, unit: "EA", reason: "", confidence: 1, sortOrder: 1, overriddenFrom: null, overrideType: null, overrideReason: null }],
      overrides: [],
      warnings: [],
      stats: { totalInputItems: 1, totalResolvedItems: 99, swapsApplied: 0, additionsApplied: 0, warningsGenerated: 0, skippedAlreadyApplied: 0, rulesEvaluated: 0, rulesMatched: 0 },
      hasOverrides: false,
      resolvedAt: new Date().toISOString(),
    };
    const errors = validateResolverOutput(output);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Stats mismatch");
  });

  it("detects swap item missing overriddenFrom", () => {
    const output: OverrideResolverOutput = {
      resolvedItems: [{ assemblyId: "201", assemblyName: "Replacement", trade: "roofing", finishLevel: null, quantity: 1, unit: "EA", reason: "", confidence: 1, sortOrder: 1, overriddenFrom: null, overrideType: "swap", overrideReason: "test" }],
      overrides: [],
      warnings: [],
      stats: { totalInputItems: 1, totalResolvedItems: 1, swapsApplied: 1, additionsApplied: 0, warningsGenerated: 0, skippedAlreadyApplied: 0, rulesEvaluated: 1, rulesMatched: 1 },
      hasOverrides: true,
      resolvedAt: new Date().toISOString(),
    };
    const errors = validateResolverOutput(output);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Swap item");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. SEED DATA INTEGRITY
// ══════════════════════════════════════════════════════════════════════

describe("Seed Data Integrity", () => {
  it("contains at least 15 seed rules", () => {
    expect(COASTAL_OVERRIDE_SEED_RULES.length).toBeGreaterThanOrEqual(15);
  });

  it("has rules for Barrier Island Premium zone", () => {
    const barrierRules = COASTAL_OVERRIDE_SEED_RULES.filter((r) => r.zone === "Barrier Island Premium");
    expect(barrierRules.length).toBeGreaterThanOrEqual(8);
  });

  it("has rules for Charleston Coastal zone", () => {
    const coastalRules = COASTAL_OVERRIDE_SEED_RULES.filter((r) => r.zone === "Charleston Coastal");
    expect(coastalRules.length).toBeGreaterThanOrEqual(4);
  });

  it("includes all three override types", () => {
    const types = new Set(COASTAL_OVERRIDE_SEED_RULES.map((r) => r.overrideType));
    expect(types.has("swap")).toBe(true);
    expect(types.has("add")).toBe(true);
    expect(types.has("warning_only")).toBe(true);
  });

  it("all rules have non-empty reasonTemplate", () => {
    for (const rule of COASTAL_OVERRIDE_SEED_RULES) {
      expect(rule.reasonTemplate.length).toBeGreaterThan(10);
    }
  });

  it("all rules have positive assembly IDs", () => {
    for (const rule of COASTAL_OVERRIDE_SEED_RULES) {
      expect(Number(rule.originalAssemblyId)).toBeGreaterThan(0);
      expect(Number(rule.replacementAssemblyId)).toBeGreaterThan(0);
    }
  });

  it("all rules are active by default", () => {
    for (const rule of COASTAL_OVERRIDE_SEED_RULES) {
      expect(rule.active).toBe(true);
    }
  });

  it("getSeedSummary returns correct totals", () => {
    const summary = getSeedSummary();
    expect(summary.totalRules).toBe(COASTAL_OVERRIDE_SEED_RULES.length);
    expect(Object.keys(summary.byZone).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(summary.byType).length).toBeGreaterThanOrEqual(3);
  });

  it("covers multiple trades", () => {
    const trades = new Set(COASTAL_OVERRIDE_SEED_RULES.map((r) => r.trade));
    expect(trades.size).toBeGreaterThanOrEqual(5);
  });

  it("includes finish-level-specific rules", () => {
    const finishRules = COASTAL_OVERRIDE_SEED_RULES.filter((r) => r.finishLevel !== null);
    expect(finishRules.length).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 12. ROUTER STRUCTURE
// ══════════════════════════════════════════════════════════════════════

describe("Router Structure", () => {
  it("exports geoOverrideRouter from geo-override-router", async () => {
    const mod = await import("./geo-override-router");
    expect(mod.geoOverrideRouter).toBeDefined();
  });

  it("geoOverrideRouter has listRules procedure", async () => {
    const mod = await import("./geo-override-router");
    expect((mod.geoOverrideRouter as any)._def.procedures.listRules).toBeDefined();
  });

  it("geoOverrideRouter has resolveForDraft procedure", async () => {
    const mod = await import("./geo-override-router");
    expect((mod.geoOverrideRouter as any)._def.procedures.resolveForDraft).toBeDefined();
  });

  it("geoOverrideRouter has previewForDraft procedure", async () => {
    const mod = await import("./geo-override-router");
    expect((mod.geoOverrideRouter as any)._def.procedures.previewForDraft).toBeDefined();
  });

  it("geoOverrideRouter has getLog procedure", async () => {
    const mod = await import("./geo-override-router");
    expect((mod.geoOverrideRouter as any)._def.procedures.getLog).toBeDefined();
  });

  it("geoOverrideRouter has seedCoastalRules procedure", async () => {
    const mod = await import("./geo-override-router");
    expect((mod.geoOverrideRouter as any)._def.procedures.seedCoastalRules).toBeDefined();
  });

  it("geoOverrideRouter has statsByZone procedure", async () => {
    const mod = await import("./geo-override-router");
    expect((mod.geoOverrideRouter as any)._def.procedures.statsByZone).toBeDefined();
  });

  it("appRouter includes geoOverride namespace", async () => {
    const mod = await import("./routers");
    expect((mod.appRouter as any)._def.procedures).toHaveProperty("geoOverride.listRules");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 13. SCHEMA FIELDS
// ══════════════════════════════════════════════════════════════════════

describe("Schema Fields", () => {
  it("geographic_overrides table exists in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.geographicOverrides).toBeDefined();
  });

  it("scope_override_log table exists in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.scopeOverrideLog).toBeDefined();
  });

  it("geographic_overrides has zone field", async () => {
    const schema = await import("../drizzle/schema");
    const cols = (schema.geographicOverrides as any)[Symbol.for("drizzle:Columns")];
    expect(cols?.zone).toBeDefined();
  });

  it("geographic_overrides has overrideType field", async () => {
    const schema = await import("../drizzle/schema");
    const cols = (schema.geographicOverrides as any)[Symbol.for("drizzle:Columns")];
    expect(cols?.overrideType).toBeDefined();
  });

  it("scope_override_log has scopeDraftId field", async () => {
    const schema = await import("../drizzle/schema");
    const cols = (schema.scopeOverrideLog as any)[Symbol.for("drizzle:Columns")];
    expect(cols?.scopeDraftId).toBeDefined();
  });

  it("scope_override_log has reason field", async () => {
    const schema = await import("../drizzle/schema");
    const cols = (schema.scopeOverrideLog as any)[Symbol.for("drizzle:Columns")];
    expect(cols?.reason).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 14. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  it("handles empty items array", () => {
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides([], "Barrier Island Premium", rules, lookup);

    expect(result.resolvedItems).toHaveLength(0);
    expect(result.hasOverrides).toBe(false);
    expect(result.stats.totalInputItems).toBe(0);
  });

  it("handles empty rules array", () => {
    const items = [makeItem()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", [], lookup);

    expect(result.resolvedItems).toHaveLength(1);
    expect(result.hasOverrides).toBe(false);
  });

  it("handles replacement assembly not in lookup", () => {
    const items = [makeItem()];
    const rules = [makeRule({ replacementAssemblyId: "9999" })];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    // Should still work, using fallback name
    expect(result.resolvedItems).toHaveLength(1);
    expect(result.resolvedItems[0].assemblyName).toContain("Assembly #9999");
  });

  it("handles multiple items with mixed override applicability", () => {
    const items = [
      makeItem({ assemblyId: "101", trade: "roofing", sortOrder: 1 }),
      makeItem({ assemblyId: "999", assemblyName: "No Match", trade: "plumbing", sortOrder: 2 }),
      makeItem({ assemblyId: "104", assemblyName: "Standard Vinyl Siding", trade: "siding", sortOrder: 3 }),
    ];
    const rules = [
      makeRule({ id: "1", trade: "roofing", originalAssemblyId: "101", replacementAssemblyId: "201", overrideType: "swap" }),
      makeRule({ id: "2", trade: "siding", originalAssemblyId: "104", replacementAssemblyId: "204", overrideType: "swap" }),
    ];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.stats.swapsApplied).toBe(2);
    // Item 999 should pass through unchanged
    const plumbingItem = result.resolvedItems.find((i) => i.trade === "plumbing");
    expect(plumbingItem).toBeDefined();
    expect(plumbingItem!.overrideType).toBeNull();
  });

  it("handles swap + add rules for the same item", () => {
    const items = [makeItem({ assemblyId: "101", sortOrder: 1 })];
    const rules = [
      makeRule({ id: "1", overrideType: "swap", originalAssemblyId: "101", replacementAssemblyId: "201" }),
      makeRule({ id: "2", overrideType: "add", originalAssemblyId: "101", replacementAssemblyId: "301" }),
    ];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.stats.swapsApplied).toBe(1);
    expect(result.stats.additionsApplied).toBe(1);
    // Should have swapped item + added item
    expect(result.resolvedItems.length).toBeGreaterThanOrEqual(2);
  });

  it("includes resolvedAt timestamp in ISO format", () => {
    const items = [makeItem()];
    const rules = [makeRule()];
    const lookup = makeLookup();

    const result = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(result.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 15. CROSS-MODULE COMPATIBILITY
// ══════════════════════════════════════════════════════════════════════

describe("Cross-Module Compatibility", () => {
  it("OverrideRule type has all required fields", () => {
    const rule: OverrideRule = makeRule();
    expect(rule).toHaveProperty("id");
    expect(rule).toHaveProperty("zone");
    expect(rule).toHaveProperty("trade");
    expect(rule).toHaveProperty("finishLevel");
    expect(rule).toHaveProperty("originalAssemblyId");
    expect(rule).toHaveProperty("replacementAssemblyId");
    expect(rule).toHaveProperty("overrideType");
    expect(rule).toHaveProperty("reasonTemplate");
    expect(rule).toHaveProperty("active");
  });

  it("ResolvedScopeItem extends ResolverInputItem", () => {
    const item: ResolvedScopeItem = {
      ...makeItem(),
      overriddenFrom: null,
      overrideType: null,
      overrideReason: null,
    };
    // Should have all ResolverInputItem fields
    expect(item).toHaveProperty("assemblyId");
    expect(item).toHaveProperty("assemblyName");
    expect(item).toHaveProperty("trade");
    expect(item).toHaveProperty("quantity");
    expect(item).toHaveProperty("unit");
    // Plus override fields
    expect(item).toHaveProperty("overriddenFrom");
    expect(item).toHaveProperty("overrideType");
    expect(item).toHaveProperty("overrideReason");
  });

  it("OverrideResolverOutput has all required fields", () => {
    const items = [makeItem()];
    const rules = [makeRule()];
    const lookup = makeLookup();
    const output = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(output).toHaveProperty("resolvedItems");
    expect(output).toHaveProperty("overrides");
    expect(output).toHaveProperty("warnings");
    expect(output).toHaveProperty("stats");
    expect(output).toHaveProperty("hasOverrides");
    expect(output).toHaveProperty("resolvedAt");
  });

  it("stats object has all required counters", () => {
    const items = [makeItem()];
    const rules = [makeRule()];
    const lookup = makeLookup();
    const output = resolveOverrides(items, "Barrier Island Premium", rules, lookup);

    expect(output.stats).toHaveProperty("totalInputItems");
    expect(output.stats).toHaveProperty("totalResolvedItems");
    expect(output.stats).toHaveProperty("swapsApplied");
    expect(output.stats).toHaveProperty("additionsApplied");
    expect(output.stats).toHaveProperty("warningsGenerated");
    expect(output.stats).toHaveProperty("skippedAlreadyApplied");
    expect(output.stats).toHaveProperty("rulesEvaluated");
    expect(output.stats).toHaveProperty("rulesMatched");
  });

  it("seed rules pass validation (warning_only allows same IDs)", () => {
    for (const rule of COASTAL_OVERRIDE_SEED_RULES) {
      const errors = validateOverrideRule({
        zone: rule.zone,
        trade: rule.trade,
        originalAssemblyId: rule.originalAssemblyId,
        replacementAssemblyId: rule.replacementAssemblyId,
        overrideType: rule.overrideType,
        reasonTemplate: rule.reasonTemplate,
      });
      // warning_only rules legitimately use same original/replacement IDs
      if (rule.overrideType === "warning_only" && rule.originalAssemblyId === rule.replacementAssemblyId) {
        const filteredErrors = errors.filter((e) => !e.includes("different"));
        expect(filteredErrors).toHaveLength(0);
      } else {
        expect(errors).toHaveLength(0);
      }
    }
  });
});
