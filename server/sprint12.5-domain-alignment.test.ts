/**
 * structr.ai — Sprint 12.5: Domain Alignment Tests
 * ═══════════════════════════════════════════════════════════════
 *
 * Targeted tests for the Sprint 12.5 domain alignment patch:
 *   1. Canonical taxonomy compliance — all scope rules use SERVICE_TYPES values
 *   2. Normalization alias coverage — legacy values resolve to canonical
 *   3. scopeVariant field integrity — present and correct on all rules
 *   4. Channel enum correctness — no 'residential' in scope rules
 *   5. Cross-module consistency — scope engine + normalization alignment
 *   6. Rule matching with canonical values — engine still matches correctly
 *   7. Assembly reference integrity — all IDs are positive integers
 *   8. Seed data structural validation — all rules have required fields
 */
import { describe, it, expect } from "vitest";
import {
  normalizeServiceType,
  normalizeChannel,
  normalizeFinishLevel,
  normalizeCondition,
} from "@shared/domain/normalization";
import {
  SERVICE_TYPES,
  type ServiceType,
} from "@shared/domain/taxonomy";
import {
  ALL_SCOPE_RULES,
  RULE_COUNTS,
  type ScopeRuleSeed,
} from "@shared/scope-rules-seed";
import {
  matchRule,
  matchRules,
  generateScopeDraft,
  evaluateQuantityFormula,
  buildFormulaContext,
  type ScopeRuleData,
  type ScopeIntakeData,
  type ScopeProjectContext,
  type ScopeAssemblyRef,
} from "@shared/scope-engine";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const CANONICAL_SERVICE_TYPES = new Set<string>(SERVICE_TYPES);

function makeRule(overrides: Partial<ScopeRuleData> = {}): ScopeRuleData {
  return {
    id: "1",
    ruleCode: "TEST-001",
    serviceType: "kitchen_remodel",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "100",
    quantityFormula: "1",
    reasonTemplate: "Test rule for {{service_type}}.",
    priority: 20,
    isActive: true,
    ...overrides,
  };
}

function makeIntake(overrides: Partial<ScopeIntakeData> = {}): ScopeIntakeData {
  return {
    serviceType: "kitchen_remodel",
    area: "200 sq ft",
    finishLevel: "standard",
    condition: null,
    channel: "direct",
    notes: null,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ScopeProjectContext> = {}): ScopeProjectContext {
  return {
    projectType: "remodel",
    zone: "North Charleston",
    zipCode: "29405",
    channel: "direct",
    zoneModifierSnapshot: null,
    ...overrides,
  };
}

function makeAssembly(overrides: Partial<ScopeAssemblyRef> = {}): ScopeAssemblyRef {
  return {
    id: "100",
    code: "TEST-ASM-001",
    name: "Test Assembly",
    category: "general",
    trade: "general",
    finishLevel: "standard",
    defaultUnit: "EA",
    coastalModifier: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. CANONICAL TAXONOMY COMPLIANCE
// ═══════════════════════════════════════════════════════════════

describe("Sprint 12.5 — Canonical Taxonomy Compliance", () => {
  it("all scope rules use canonical SERVICE_TYPES values", () => {
    const violations: string[] = [];
    for (const rule of ALL_SCOPE_RULES) {
      if (!CANONICAL_SERVICE_TYPES.has(rule.serviceType)) {
        violations.push(`${rule.ruleCode}: serviceType="${rule.serviceType}" is not canonical`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no rule uses legacy 'roof_replacement' — must be 'roofing'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "roof_replacement");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'window_replacement' — must be 'windows_doors'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "window_replacement");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'door_replacement' — must be 'windows_doors'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "door_replacement");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'deck_build' — must be 'deck_porch'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "deck_build");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'screen_porch' as serviceType — must be 'deck_porch'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "screen_porch");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'interior_paint' — must be 'painting'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "interior_paint");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'exterior_paint' — must be 'painting'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "exterior_paint");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'flooring_install' — must be 'flooring'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "flooring_install");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'siding_replacement' — must be 'siding'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "siding_replacement");
    expect(legacyRules).toHaveLength(0);
  });

  it("no rule uses legacy 'exterior_renovation' — must be 'exterior'", () => {
    const legacyRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "exterior_renovation");
    expect(legacyRules).toHaveLength(0);
  });

  it("all 9 canonical trade groups are represented", () => {
    const tradeGroups = new Set(ALL_SCOPE_RULES.map(r => r.serviceType));
    expect(tradeGroups.has("kitchen_remodel")).toBe(true);
    expect(tradeGroups.has("bathroom_remodel")).toBe(true);
    expect(tradeGroups.has("roofing")).toBe(true);
    expect(tradeGroups.has("siding")).toBe(true);
    expect(tradeGroups.has("windows_doors")).toBe(true);
    expect(tradeGroups.has("deck_porch")).toBe(true);
    expect(tradeGroups.has("painting")).toBe(true);
    expect(tradeGroups.has("flooring")).toBe(true);
    expect(tradeGroups.has("exterior")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. NORMALIZATION ALIAS COVERAGE
// ═══════════════════════════════════════════════════════════════

describe("Sprint 12.5 — Normalization Alias Coverage", () => {
  it("'roof_replacement' normalizes to 'roofing'", () => {
    expect(normalizeServiceType("roof_replacement")).toBe("roofing");
  });

  it("'window_replacement' normalizes to 'windows_doors'", () => {
    expect(normalizeServiceType("window_replacement")).toBe("windows_doors");
  });

  it("'door_replacement' normalizes to 'windows_doors'", () => {
    expect(normalizeServiceType("door_replacement")).toBe("windows_doors");
  });

  it("'deck_build' normalizes to 'deck_porch'", () => {
    expect(normalizeServiceType("deck_build")).toBe("deck_porch");
  });

  it("'screen_porch' normalizes to 'deck_porch'", () => {
    expect(normalizeServiceType("screen_porch")).toBe("deck_porch");
  });

  it("'interior_paint' normalizes to 'painting'", () => {
    expect(normalizeServiceType("interior_paint")).toBe("painting");
  });

  it("'exterior_paint' normalizes to 'painting'", () => {
    expect(normalizeServiceType("exterior_paint")).toBe("painting");
  });

  it("'flooring_install' normalizes to 'flooring'", () => {
    expect(normalizeServiceType("flooring_install")).toBe("flooring");
  });

  it("'siding_replacement' normalizes to 'siding'", () => {
    expect(normalizeServiceType("siding_replacement")).toBe("siding");
  });

  it("'exterior_renovation' normalizes to 'exterior'", () => {
    expect(normalizeServiceType("exterior_renovation")).toBe("exterior");
  });

  it("canonical values normalize to themselves", () => {
    expect(normalizeServiceType("kitchen_remodel")).toBe("kitchen_remodel");
    expect(normalizeServiceType("bathroom_remodel")).toBe("bathroom_remodel");
    expect(normalizeServiceType("roofing")).toBe("roofing");
    expect(normalizeServiceType("siding")).toBe("siding");
    expect(normalizeServiceType("windows_doors")).toBe("windows_doors");
    expect(normalizeServiceType("deck_porch")).toBe("deck_porch");
    expect(normalizeServiceType("painting")).toBe("painting");
    expect(normalizeServiceType("flooring")).toBe("flooring");
    expect(normalizeServiceType("exterior")).toBe("exterior");
  });

  it("channel 'residential' is NOT a valid canonical channel", () => {
    // 'residential' was removed from the channel enum
    // normalizeChannel should return undefined for it
    const result = normalizeChannel("residential");
    // It should either be undefined or map to something else
    // The key point is it's not in the schema enum anymore
    expect(["direct", "insurance", "commercial", undefined]).toContain(result);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. SCOPE VARIANT FIELD INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("Sprint 12.5 — scopeVariant Field Integrity", () => {
  it("all scope rules have scopeVariant property defined", () => {
    const missing = ALL_SCOPE_RULES.filter(r => !("scopeVariant" in r));
    expect(missing).toHaveLength(0);
  });

  it("roofing rules have scopeVariant = 'roof_replacement'", () => {
    const roofingRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "roofing");
    expect(roofingRules.length).toBeGreaterThan(0);
    for (const rule of roofingRules) {
      expect(rule.scopeVariant).toBe("roof_replacement");
    }
  });

  it("siding rules have scopeVariant = 'siding_replacement'", () => {
    const sidingRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "siding");
    expect(sidingRules.length).toBeGreaterThan(0);
    for (const rule of sidingRules) {
      expect(rule.scopeVariant).toBe("siding_replacement");
    }
  });

  it("windows_doors rules have scopeVariant of 'window_replacement' or 'door_replacement'", () => {
    const wdRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "windows_doors");
    expect(wdRules.length).toBeGreaterThan(0);
    for (const rule of wdRules) {
      expect(["window_replacement", "door_replacement"]).toContain(rule.scopeVariant);
    }
  });

  it("deck_porch rules have scopeVariant of 'deck_build' or 'screen_porch'", () => {
    const deckRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "deck_porch");
    expect(deckRules.length).toBeGreaterThan(0);
    for (const rule of deckRules) {
      expect(["deck_build", "screen_porch"]).toContain(rule.scopeVariant);
    }
  });

  it("painting rules have scopeVariant of 'interior_paint' or 'exterior_paint'", () => {
    const paintRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "painting");
    expect(paintRules.length).toBeGreaterThan(0);
    for (const rule of paintRules) {
      expect(["interior_paint", "exterior_paint"]).toContain(rule.scopeVariant);
    }
  });

  it("flooring rules have scopeVariant = 'flooring_install'", () => {
    const flooringRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "flooring");
    expect(flooringRules.length).toBeGreaterThan(0);
    for (const rule of flooringRules) {
      expect(rule.scopeVariant).toBe("flooring_install");
    }
  });

  it("exterior rules have scopeVariant = 'exterior_renovation'", () => {
    const exteriorRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "exterior");
    expect(exteriorRules.length).toBeGreaterThan(0);
    for (const rule of exteriorRules) {
      expect(rule.scopeVariant).toBe("exterior_renovation");
    }
  });

  it("kitchen_remodel rules have scopeVariant = null (no sub-classification needed)", () => {
    const kitchenRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "kitchen_remodel");
    expect(kitchenRules.length).toBeGreaterThan(0);
    for (const rule of kitchenRules) {
      expect(rule.scopeVariant).toBeNull();
    }
  });

  it("bathroom_remodel rules have scopeVariant = null (no sub-classification needed)", () => {
    const bathRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "bathroom_remodel");
    expect(bathRules.length).toBeGreaterThan(0);
    for (const rule of bathRules) {
      expect(rule.scopeVariant).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. CHANNEL ENUM CORRECTNESS
// ═══════════════════════════════════════════════════════════════

describe("Sprint 12.5 — Channel Enum Correctness", () => {
  it("no scope rule uses 'residential' as channel", () => {
    const violations = ALL_SCOPE_RULES.filter(r => r.channel === "residential");
    expect(violations).toHaveLength(0);
  });

  it("all non-null channels are in the canonical set", () => {
    const validChannels = new Set(["direct", "insurance", "commercial"]);
    const violations: string[] = [];
    for (const rule of ALL_SCOPE_RULES) {
      if (rule.channel !== null && !validChannels.has(rule.channel)) {
        violations.push(`${rule.ruleCode}: channel="${rule.channel}"`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. CROSS-MODULE CONSISTENCY
// ═══════════════════════════════════════════════════════════════

describe("Sprint 12.5 — Cross-Module Consistency", () => {
  it("scope engine matchRule works with canonical 'roofing' serviceType", () => {
    const rule = makeRule({ serviceType: "roofing", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "roofing", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works when intake uses legacy 'roof_replacement' (normalization)", () => {
    const rule = makeRule({ serviceType: "roofing", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "roof_replacement", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works with canonical 'painting' serviceType", () => {
    const rule = makeRule({ serviceType: "painting", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "painting", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works when intake uses legacy 'interior_paint' (normalization)", () => {
    const rule = makeRule({ serviceType: "painting", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "interior_paint", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works with canonical 'windows_doors' serviceType", () => {
    const rule = makeRule({ serviceType: "windows_doors" });
    const intake = makeIntake({ serviceType: "windows_doors" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works when intake uses legacy 'window_replacement' (normalization)", () => {
    const rule = makeRule({ serviceType: "windows_doors" });
    const intake = makeIntake({ serviceType: "window_replacement" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works with canonical 'deck_porch' serviceType", () => {
    const rule = makeRule({ serviceType: "deck_porch" });
    const intake = makeIntake({ serviceType: "deck_porch" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works when intake uses legacy 'deck_build' (normalization)", () => {
    const rule = makeRule({ serviceType: "deck_porch" });
    const intake = makeIntake({ serviceType: "deck_build" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works with canonical 'flooring' serviceType", () => {
    const rule = makeRule({ serviceType: "flooring", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "flooring", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works when intake uses legacy 'flooring_install' (normalization)", () => {
    const rule = makeRule({ serviceType: "flooring", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "flooring_install", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works with canonical 'siding' serviceType", () => {
    const rule = makeRule({ serviceType: "siding", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "siding", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works when intake uses legacy 'siding_replacement' (normalization)", () => {
    const rule = makeRule({ serviceType: "siding", finishLevel: "standard" });
    const intake = makeIntake({ serviceType: "siding_replacement", finishLevel: "standard" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works with canonical 'exterior' serviceType", () => {
    const rule = makeRule({ serviceType: "exterior" });
    const intake = makeIntake({ serviceType: "exterior" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });

  it("scope engine matchRule works when intake uses legacy 'exterior_renovation' (normalization)", () => {
    const rule = makeRule({ serviceType: "exterior" });
    const intake = makeIntake({ serviceType: "exterior_renovation" });
    const project = makeProject();
    const result = matchRule(rule, intake, project);
    expect(result.matched).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. SEED DATA STRUCTURAL VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("Sprint 12.5 — Seed Data Structural Validation", () => {
  it("total rule count is 62", () => {
    expect(ALL_SCOPE_RULES.length).toBe(62);
    expect(RULE_COUNTS.total).toBe(62);
  });

  it("all rules have non-empty ruleCode", () => {
    const invalid = ALL_SCOPE_RULES.filter(r => !r.ruleCode || r.ruleCode.trim() === "");
    expect(invalid).toHaveLength(0);
  });

  it("all rules have unique ruleCode", () => {
    const codes = ALL_SCOPE_RULES.map(r => r.ruleCode);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it("all rules have positive assemblyId", () => {
    const invalid = ALL_SCOPE_RULES.filter(r => !r.assemblyId || Number(r.assemblyId) <= 0);
    expect(invalid).toHaveLength(0);
  });

  it("all rules have non-empty quantityFormula", () => {
    const invalid = ALL_SCOPE_RULES.filter(r => !r.quantityFormula || r.quantityFormula.trim() === "");
    expect(invalid).toHaveLength(0);
  });

  it("all rules have non-empty reasonTemplate", () => {
    const invalid = ALL_SCOPE_RULES.filter(r => !r.reasonTemplate || r.reasonTemplate.trim() === "");
    expect(invalid).toHaveLength(0);
  });

  it("all rules have priority between 1 and 999", () => {
    const invalid = ALL_SCOPE_RULES.filter(r => r.priority < 1 || r.priority > 999);
    expect(invalid).toHaveLength(0);
  });

  it("all finishLevel values are valid when not null", () => {
    const validLevels = new Set(["standard", "premium", "luxury"]);
    const invalid = ALL_SCOPE_RULES.filter(
      r => r.finishLevel !== null && !validLevels.has(r.finishLevel)
    );
    expect(invalid).toHaveLength(0);
  });

  it("all projectType values are valid when not null", () => {
    const validTypes = new Set([
      "remodel", "new_construction", "repair", "insurance_restoration",
      "commercial_buildout", "addition", "exterior"
    ]);
    const invalid = ALL_SCOPE_RULES.filter(
      r => r.projectType !== null && !validTypes.has(r.projectType)
    );
    expect(invalid).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. FULL PIPELINE WITH CANONICAL VALUES
// ═══════════════════════════════════════════════════════════════

describe("Sprint 12.5 — Full Pipeline with Canonical Values", () => {
  it("generateScopeDraft produces items when rules use canonical 'roofing'", () => {
    const rules: ScopeRuleData[] = [
      makeRule({
        id: "1", ruleCode: "ROF-TEST-1", serviceType: "roofing",
        finishLevel: "standard", assemblyId: "30082",
        quantityFormula: "ceil(area / 100) * waste_factor",
        reasonTemplate: "Roofing for {{service_type}}.",
        priority: 20,
      }),
    ];
    const assemblies: ScopeAssemblyRef[] = [
      makeAssembly({ id: "30082", code: "ROF-SHG-STD", name: "Standard Shingles" }),
    ];
    const intake = makeIntake({ serviceType: "roofing", area: "2000 sq ft", finishLevel: "standard" });
    const project = makeProject();
    const result = generateScopeDraft(intake, project, rules, assemblies);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].assemblyId).toBe("30082");
  });

  it("generateScopeDraft produces items when intake uses legacy 'roof_replacement' but rules use canonical 'roofing'", () => {
    const rules: ScopeRuleData[] = [
      makeRule({
        id: "1", ruleCode: "ROF-TEST-2", serviceType: "roofing",
        finishLevel: "standard", assemblyId: "30082",
        quantityFormula: "1",
        reasonTemplate: "Roofing for {{service_type}}.",
        priority: 20,
      }),
    ];
    const assemblies: ScopeAssemblyRef[] = [
      makeAssembly({ id: "30082", code: "ROF-SHG-STD", name: "Standard Shingles" }),
    ];
    // Intake uses legacy value — engine should normalize and match
    const intake = makeIntake({ serviceType: "roof_replacement", finishLevel: "standard" });
    const project = makeProject();
    const result = generateScopeDraft(intake, project, rules, assemblies);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("generateScopeDraft produces items when intake uses legacy 'exterior_paint' but rules use canonical 'painting'", () => {
    const rules: ScopeRuleData[] = [
      makeRule({
        id: "1", ruleCode: "PNT-TEST-1", serviceType: "painting",
        finishLevel: null, assemblyId: "30103",
        quantityFormula: "1",
        reasonTemplate: "Painting for {{service_type}}.",
        priority: 20,
      }),
    ];
    const assemblies: ScopeAssemblyRef[] = [
      makeAssembly({ id: "30103", code: "EXT-PNT-001", name: "Exterior Paint" }),
    ];
    const intake = makeIntake({ serviceType: "exterior_paint", finishLevel: null });
    const project = makeProject();
    const result = generateScopeDraft(intake, project, rules, assemblies);
    expect(result.items.length).toBeGreaterThan(0);
  });
});
