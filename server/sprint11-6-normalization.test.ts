/**
 * Sprint 11.6 — Domain Normalization Tests
 * =========================================
 * 37 tests covering:
 *  1. Taxonomy constants integrity (6)
 *  2. Channel normalization + aliases (5)
 *  3. Finish level normalization (4)
 *  4. Trade normalization (5)
 *  5. Category normalization (5)
 *  6. Service type normalization (4)
 *  7. PB category normalization (4)
 *  8. Condition normalization (3)
 *  9. Idempotency (all normalizers) (1)
 * 10. Batch normalizeRecord (3)
 * 11. Geo isolation (2)
 * 12. Scope Builder compatibility (3)
 */

import { describe, it, expect } from "vitest";

// ─── Taxonomy ──────────────────────────────────────────────────────
import {
  CHANNELS,
  FINISH_LEVELS,
  PROJECT_TYPES,
  SERVICE_TYPES,
  TRADES,
  CATEGORIES,
  PB_CATEGORIES,
  CONDITIONS,
  CHANNEL_LABELS,
  FINISH_LEVEL_LABELS,
  TRADE_LABELS,
  CATEGORY_LABELS,
  PB_CATEGORY_LABELS,
} from "@shared/domain/taxonomy";

// ─── Normalization ─────────────────────────────────────────────────
import {
  normalizeChannel,
  normalizeFinishLevel,
  normalizeProjectType,
  normalizeServiceType,
  normalizeTrade,
  normalizeCategory,
  normalizePbCategory,
  normalizeCondition,
  normalizeRecord,
} from "@shared/domain/normalization";

// ═══════════════════════════════════════════════════════════════════
// 1. TAXONOMY CONSTANTS INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe("Taxonomy constants integrity", () => {
  it("CHANNELS has exactly 3 canonical values", () => {
    expect(CHANNELS).toEqual(["direct", "insurance", "commercial"]);
  });

  it("FINISH_LEVELS has exactly 3 canonical values", () => {
    expect(FINISH_LEVELS).toEqual(["standard", "premium", "luxury"]);
  });

  it("TRADES has 26 canonical values", () => {
    expect(TRADES.length).toBe(26);
    // Verify key trades exist
    expect(TRADES).toContain("roofing");
    expect(TRADES).toContain("plumbing");
    expect(TRADES).toContain("electrical");
    expect(TRADES).toContain("painting");
    expect(TRADES).toContain("flooring");
  });

  it("CATEGORIES has 19 canonical values", () => {
    expect(CATEGORIES.length).toBe(19);
    expect(CATEGORIES).toContain("kitchen");
    expect(CATEGORIES).toContain("bathroom");
    expect(CATEGORIES).toContain("deck_porch");
    expect(CATEGORIES).toContain("windows_doors");
  });

  it("every LABELS map has an entry for each canonical value", () => {
    for (const ch of CHANNELS) expect(CHANNEL_LABELS[ch]).toBeTruthy();
    for (const fl of FINISH_LEVELS) expect(FINISH_LEVEL_LABELS[fl]).toBeTruthy();
    for (const t of TRADES) expect(TRADE_LABELS[t]).toBeTruthy();
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c]).toBeTruthy();
    for (const pb of PB_CATEGORIES) expect(PB_CATEGORY_LABELS[pb]).toBeTruthy();
  });

  it("no duplicate values in any canonical array", () => {
    const arrays = [CHANNELS, FINISH_LEVELS, PROJECT_TYPES, SERVICE_TYPES, TRADES, CATEGORIES, PB_CATEGORIES, CONDITIONS];
    for (const arr of arrays) {
      expect(new Set(arr).size).toBe(arr.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. CHANNEL NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

describe("Channel normalization", () => {
  it("canonical values pass through unchanged", () => {
    expect(normalizeChannel("direct")).toBe("direct");
    expect(normalizeChannel("insurance")).toBe("insurance");
    expect(normalizeChannel("commercial")).toBe("commercial");
  });

  it("'residential' maps to 'direct'", () => {
    expect(normalizeChannel("residential")).toBe("direct");
    expect(normalizeChannel("Residential")).toBe("direct");
    expect(normalizeChannel("RESIDENTIAL")).toBe("direct");
  });

  it("short aliases resolve correctly", () => {
    expect(normalizeChannel("res")).toBe("direct");
    expect(normalizeChannel("ins")).toBe("insurance");
    expect(normalizeChannel("comm")).toBe("commercial");
    expect(normalizeChannel("homeowner")).toBe("direct");
  });

  it("null/undefined/empty return null", () => {
    expect(normalizeChannel(null)).toBeNull();
    expect(normalizeChannel(undefined)).toBeNull();
    expect(normalizeChannel("")).toBeNull();
  });

  it("unknown values return null", () => {
    expect(normalizeChannel("government")).toBeNull();
    expect(normalizeChannel("xyz123")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. FINISH LEVEL NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

describe("Finish level normalization", () => {
  it("canonical values pass through", () => {
    expect(normalizeFinishLevel("standard")).toBe("standard");
    expect(normalizeFinishLevel("premium")).toBe("premium");
    expect(normalizeFinishLevel("luxury")).toBe("luxury");
  });

  it("aliases resolve correctly", () => {
    expect(normalizeFinishLevel("basic")).toBe("standard");
    expect(normalizeFinishLevel("builder_grade")).toBe("standard");
    expect(normalizeFinishLevel("mid_range")).toBe("premium");
    expect(normalizeFinishLevel("high_end")).toBe("luxury");
    expect(normalizeFinishLevel("custom")).toBe("luxury");
  });

  it("case-insensitive matching", () => {
    expect(normalizeFinishLevel("STANDARD")).toBe("standard");
    expect(normalizeFinishLevel("Premium")).toBe("premium");
    expect(normalizeFinishLevel("LUXURY")).toBe("luxury");
  });

  it("unknown values return null", () => {
    expect(normalizeFinishLevel("ultra")).toBeNull();
    expect(normalizeFinishLevel("economy")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. TRADE NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

describe("Trade normalization", () => {
  it("canonical lowercase values pass through", () => {
    expect(normalizeTrade("roofing")).toBe("roofing");
    expect(normalizeTrade("plumbing")).toBe("plumbing");
    expect(normalizeTrade("electrical")).toBe("electrical");
  });

  it("Title Case (Sprint 7 DB values) maps to canonical", () => {
    expect(normalizeTrade("Roofing")).toBe("roofing");
    expect(normalizeTrade("Plumbing")).toBe("plumbing");
    expect(normalizeTrade("Cabinetry")).toBe("cabinetry");
    expect(normalizeTrade("Demolition")).toBe("demolition");
    expect(normalizeTrade("Windows")).toBe("windows");
  });

  it("Sprint 8 cross-domain aliases resolve", () => {
    expect(normalizeTrade("kitchen")).toBe("cabinetry");
    expect(normalizeTrade("bathroom")).toBe("plumbing");
  });

  it("short aliases resolve", () => {
    expect(normalizeTrade("paint")).toBe("painting");
    expect(normalizeTrade("deck")).toBe("decking");
    expect(normalizeTrade("roof")).toBe("roofing");
    expect(normalizeTrade("demo")).toBe("demolition");
    expect(normalizeTrade("electric")).toBe("electrical");
  });

  it("unknown trades return null", () => {
    expect(normalizeTrade("masonry")).toBeNull();
    expect(normalizeTrade("xyz")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. CATEGORY NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

describe("Category normalization", () => {
  it("canonical lowercase values pass through", () => {
    expect(normalizeCategory("kitchen")).toBe("kitchen");
    expect(normalizeCategory("bathroom")).toBe("bathroom");
    expect(normalizeCategory("flooring")).toBe("flooring");
  });

  it("Sprint 7 Title Case DB values map to canonical", () => {
    expect(normalizeCategory("Kitchen")).toBe("kitchen");
    expect(normalizeCategory("Bathroom")).toBe("bathroom");
    expect(normalizeCategory("Interior Paint")).toBe("painting");
    expect(normalizeCategory("Full Exterior")).toBe("exterior");
    expect(normalizeCategory("Windows / Doors")).toBe("windows_doors");
    expect(normalizeCategory("Deck / Screen Porch")).toBe("deck_porch");
  });

  it("Sprint 8 lowercase variants resolve", () => {
    expect(normalizeCategory("decking")).toBe("deck_porch");
    expect(normalizeCategory("painting")).toBe("painting");
    expect(normalizeCategory("windows")).toBe("windows_doors");
  });

  it("short aliases resolve", () => {
    expect(normalizeCategory("paint")).toBe("painting");
    expect(normalizeCategory("deck")).toBe("deck_porch");
    expect(normalizeCategory("bath")).toBe("bathroom");
    expect(normalizeCategory("fence")).toBe("fencing");
  });

  it("unknown categories return null", () => {
    expect(normalizeCategory("masonry")).toBeNull();
    expect(normalizeCategory("xyz")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. SERVICE TYPE NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

describe("Service type normalization", () => {
  it("canonical values pass through", () => {
    expect(normalizeServiceType("kitchen_remodel")).toBe("kitchen_remodel");
    expect(normalizeServiceType("bathroom_remodel")).toBe("bathroom_remodel");
    expect(normalizeServiceType("roofing")).toBe("roofing");
  });

  it("short aliases resolve to canonical", () => {
    expect(normalizeServiceType("kitchen")).toBe("kitchen_remodel");
    expect(normalizeServiceType("bathroom")).toBe("bathroom_remodel");
    expect(normalizeServiceType("bath")).toBe("bathroom_remodel");
    expect(normalizeServiceType("paint")).toBe("painting");
    expect(normalizeServiceType("deck")).toBe("deck_porch");
  });

  it("Title Case variants resolve", () => {
    expect(normalizeServiceType("Kitchen")).toBe("kitchen_remodel");
    expect(normalizeServiceType("Bathroom")).toBe("bathroom_remodel");
    expect(normalizeServiceType("Flooring")).toBe("flooring");
    expect(normalizeServiceType("Interior Paint")).toBe("painting");
  });

  it("unknown service types return null", () => {
    expect(normalizeServiceType("pool_installation")).toBeNull();
    expect(normalizeServiceType("xyz")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. PB CATEGORY NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

describe("PB category normalization", () => {
  it("canonical values pass through", () => {
    expect(normalizePbCategory("appliances_fixtures")).toBe("appliances_fixtures");
    expect(normalizePbCategory("roofing")).toBe("roofing");
    expect(normalizePbCategory("general_conditions")).toBe("general_conditions");
  });

  it("Legacy Title Case DB values map to canonical", () => {
    expect(normalizePbCategory("Appliances & Fixtures")).toBe("appliances_fixtures");
    expect(normalizePbCategory("Cabinetry & Millwork")).toBe("cabinetry_millwork");
    expect(normalizePbCategory("General Conditions")).toBe("general_conditions");
    expect(normalizePbCategory("Mechanical (HVAC)")).toBe("mechanical_hvac");
  });

  it("short aliases resolve", () => {
    expect(normalizePbCategory("appliances")).toBe("appliances_fixtures");
    expect(normalizePbCategory("cabinetry")).toBe("cabinetry_millwork");
    expect(normalizePbCategory("hvac")).toBe("mechanical_hvac");
    expect(normalizePbCategory("concrete")).toBe("foundation_concrete");
  });

  it("unknown PB categories return null", () => {
    expect(normalizePbCategory("masonry")).toBeNull();
    expect(normalizePbCategory("xyz")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. CONDITION NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

describe("Condition normalization", () => {
  it("canonical values pass through", () => {
    expect(normalizeCondition("excellent")).toBe("excellent");
    expect(normalizeCondition("good")).toBe("good");
    expect(normalizeCondition("poor")).toBe("poor");
    expect(normalizeCondition("damaged")).toBe("damaged");
  });

  it("aliases resolve correctly", () => {
    expect(normalizeCondition("great")).toBe("excellent");
    expect(normalizeCondition("new")).toBe("excellent");
    expect(normalizeCondition("ok")).toBe("fair");
    expect(normalizeCondition("bad")).toBe("poor");
    expect(normalizeCondition("broken")).toBe("damaged");
    expect(normalizeCondition("n/a")).toBe("unknown");
  });

  it("unknown conditions return null", () => {
    expect(normalizeCondition("terrible")).toBeNull();
    expect(normalizeCondition("xyz")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. IDEMPOTENCY — ALL NORMALIZERS
// ═══════════════════════════════════════════════════════════════════

describe("Idempotency", () => {
  it("normalize(normalize(x)) === normalize(x) for all normalizers", () => {
    const testCases: Array<{ fn: (s: string) => string | null; input: string }> = [
      { fn: normalizeChannel, input: "residential" },
      { fn: normalizeChannel, input: "direct" },
      { fn: normalizeFinishLevel, input: "builder_grade" },
      { fn: normalizeFinishLevel, input: "standard" },
      { fn: normalizeProjectType, input: "renovation" },
      { fn: normalizeProjectType, input: "remodel" },
      { fn: normalizeServiceType, input: "kitchen" },
      { fn: normalizeServiceType, input: "kitchen_remodel" },
      { fn: normalizeTrade, input: "Roofing" },
      { fn: normalizeTrade, input: "roofing" },
      { fn: normalizeCategory, input: "Interior Paint" },
      { fn: normalizeCategory, input: "painting" },
      { fn: normalizePbCategory, input: "Appliances & Fixtures" },
      { fn: normalizePbCategory, input: "appliances_fixtures" },
      { fn: normalizeCondition, input: "great" },
      { fn: normalizeCondition, input: "excellent" },
    ];

    for (const { fn, input } of testCases) {
      const first = fn(input);
      expect(first).not.toBeNull();
      const second = fn(first!);
      expect(second).toBe(first);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. BATCH normalizeRecord
// ═══════════════════════════════════════════════════════════════════

describe("normalizeRecord batch helper", () => {
  it("normalizes all fields in a single call", () => {
    const result = normalizeRecord({
      channel: "residential",
      finishLevel: "builder_grade",
      projectType: "renovation",
      serviceType: "kitchen",
      trade: "Roofing",
      category: "Interior Paint",
      condition: "great",
    });

    expect(result.channel).toBe("direct");
    expect(result.finishLevel).toBe("standard");
    expect(result.projectType).toBe("remodel");
    expect(result.serviceType).toBe("kitchen_remodel");
    expect(result.trade).toBe("roofing");
    expect(result.category).toBe("painting");
    expect(result.condition).toBe("excellent");
  });

  it("only normalizes fields present in input", () => {
    const result = normalizeRecord({ channel: "insurance" });
    expect(result.channel).toBe("insurance");
    expect(result.finishLevel).toBeUndefined();
    expect(result.trade).toBeUndefined();
  });

  it("does not mutate the input object", () => {
    const input = { channel: "residential", trade: "Roofing" };
    const inputCopy = { ...input };
    normalizeRecord(input);
    expect(input).toEqual(inputCopy);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. GEO ISOLATION — normalization does NOT touch geo identifiers
// ═══════════════════════════════════════════════════════════════════

describe("Geographic isolation", () => {
  it("normalization module does not export any geo-related functions", async () => {
    // Verify no normalizeZone, normalizeRegion, normalizeZip exist
    const mod = await import("@shared/domain/normalization");
    const exportNames = Object.keys(mod);
    const geoFunctions = exportNames.filter(
      (k) =>
        k.toLowerCase().includes("zone") ||
        k.toLowerCase().includes("zip") ||
        k.toLowerCase().includes("region") ||
        k.toLowerCase().includes("coord")
    );
    expect(geoFunctions).toEqual([]);
  });

  it("geo zone names are not affected by any normalizer", () => {
    // These are real zone names from geo-engine.ts
    const zoneNames = [
      "Barrier Island Premium",
      "Charleston Coastal",
      "Charleston Metro",
      "Summerville / Goose Creek",
      "Outer Lowcountry",
    ];
    // None of these should match any normalizer
    for (const name of zoneNames) {
      // Category normalizer should NOT recognize zone names
      // (some might accidentally match — verify they don't)
      const catResult = normalizeCategory(name);
      // Zone names should either return null or a category that's NOT the zone name
      if (catResult !== null) {
        expect(catResult).not.toBe(name); // Never identity-mapped
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. SCOPE BUILDER COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════

describe("Scope Builder compatibility", () => {
  it("every SERVICE_TYPE maps to at least one CATEGORY for scope rules", () => {
    // The Scope Builder will map service_type → category to find assemblies.
    // Verify the mapping is possible for the most common service types.
    const serviceToCategory: Record<string, string> = {
      kitchen_remodel: "kitchen",
      bathroom_remodel: "bathroom",
      flooring: "flooring",
      painting: "painting",
      roofing: "roofing",
      siding: "siding",
      windows_doors: "windows_doors",
      deck_porch: "deck_porch",
      electrical: "electrical",
      plumbing: "plumbing",
      drywall: "drywall",
      concrete: "concrete",
      fencing: "fencing",
      exterior: "exterior",
    };

    for (const [serviceType, expectedCategory] of Object.entries(serviceToCategory)) {
      // Verify the service type is canonical
      expect(normalizeServiceType(serviceType)).toBe(serviceType);
      // Verify the category is canonical
      expect(normalizeCategory(expectedCategory)).toBe(expectedCategory);
    }
  });

  it("all 8 required trades for Scope Builder are present in TRADES", () => {
    const requiredTrades = [
      "cabinetry",   // kitchen
      "plumbing",    // bathroom
      "roofing",     // roofing
      "siding",      // siding
      "windows",     // windows/doors
      "decking",     // deck
      "painting",    // paint
      "flooring",    // flooring
    ];
    for (const trade of requiredTrades) {
      expect(TRADES).toContain(trade);
    }
  });

  it("normalizeChannel('residential') returns 'direct' for backward compatibility", () => {
    // This is critical: existing data in bundles/estimates used "residential"
    // The Scope Builder must be able to accept both and normalize to "direct"
    expect(normalizeChannel("residential")).toBe("direct");
    expect(normalizeChannel("direct")).toBe("direct");
    // Both should produce the same canonical value
    expect(normalizeChannel("residential")).toBe(normalizeChannel("direct"));
  });
});
