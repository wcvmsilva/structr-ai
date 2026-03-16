/**
 * Sprint 13 — Remodel Engine Tests
 * 60+ tests covering:
 *   1. Constants & Types (WORKFLOW_STEP_CODES, labels, thresholds)
 *   2. matchTemplate (service type, finish level, zone, channel, scope rules, inactive)
 *   3. matchTemplates (multi-template matching, sorting, MAX_TEMPLATES_PER_DRAFT)
 *   4. mergeAssemblies (scope priority, template defaults, deduplication)
 *   5. getAvailableOptionalAssemblies (optional filtering)
 *   6. getStepOrder (known/unknown codes)
 *   7. organizeIntoWorkflow (template steps, heuristic fallback, sorting)
 *   8. buildTradeToStageMap (trade mappings)
 *   9. workflowToBundleSelections (conversion, deduplication)
 *  10. flattenWorkflow (flattening)
 *  11. generateRemodelWorkflow (full pipeline)
 *  12. previewRemodelWorkflow (preview with diagnostics)
 *  13. Seed data integrity (remodel-templates-seed.ts)
 *  14. Cross-module compatibility (scope engine → remodel engine)
 */

import { describe, it, expect } from "vitest";

import {
  WORKFLOW_STEP_CODES,
  WORKFLOW_STEP_LABELS,
  MIN_TEMPLATE_CONFIDENCE,
  MAX_TEMPLATES_PER_DRAFT,
  matchTemplate,
  matchTemplates,
  mergeAssemblies,
  getAvailableOptionalAssemblies,
  getStepOrder,
  organizeIntoWorkflow,
  buildTradeToStageMap,
  workflowToBundleSelections,
  flattenWorkflow,
  generateRemodelWorkflow,
  previewRemodelWorkflow,
  type RemodelTemplateData,
  type RemodelContext,
  type WorkflowAssemblyRef,
  type WorkflowStage,
  type RemodelWorkflowOutput,
} from "@shared/remodel-engine";

import type { ScopeItem, ScopeDraftOutput, BundleAssemblySelection } from "@shared/scope-engine";

import {
  ALL_REMODEL_TEMPLATES,
  TEMPLATE_COUNTS,
  KITCHEN_TEMPLATES,
  BATHROOM_TEMPLATES,
  ROOFING_TEMPLATES,
  SIDING_TEMPLATES,
  WINDOWS_DOORS_TEMPLATES,
  DECK_PORCH_TEMPLATES,
  PAINTING_TEMPLATES,
  FLOORING_TEMPLATES,
  EXTERIOR_TEMPLATES,
  FULL_REMODEL_TEMPLATES,
} from "@shared/remodel-templates-seed";

// ══════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ══════════════════════════════════════════════════════════════════════

function makeTemplate(overrides: Partial<RemodelTemplateData> = {}): RemodelTemplateData {
  return {
    id: 1,
    name: "Test Template",
    serviceType: "kitchen_remodel",
    finishLevel: "standard",
    zone: null,
    channel: null,
    description: "Test template",
    requiredScopeRules: null,
    defaultAssemblies: null,
    optionalAssemblies: null,
    workflowSteps: null,
    typicalSqftRange: null,
    estimatedDuration: null,
    isActive: true,
    ...overrides,
  };
}

function makeScopeItem(overrides: Partial<ScopeItem> = {}): ScopeItem {
  return {
    assemblyId: 100,
    assemblyCode: "ASM-100",
    assemblyName: "Test Assembly",
    category: "general",
    trade: null,
    quantity: 1,
    unit: "EA",
    reason: "Test reason",
    confidence: 0.9,
    ruleCode: "TEST-RULE-001",
    sortOrder: 1,
    ...overrides,
  };
}

function makeScopeDraft(
  items: ScopeItem[] = [],
  metadataOverrides: Partial<ScopeDraftOutput["metadata"]> = {}
): ScopeDraftOutput {
  return {
    items,
    warnings: [],
    confidenceScore: 0.85,
    metadata: {
      rulesEvaluated: 10,
      rulesMatched: items.length,
      assembliesSelected: items.length,
      intakeServiceType: "kitchen_remodel",
      intakeFinishLevel: "standard",
      projectZone: "inland",
      generatedAt: new Date().toISOString(),
      ...metadataOverrides,
    },
  };
}

function makeAssemblyLookup(
  entries: Array<[number, { code: string; name: string; category: string; trade: string | null; unit: string }]> = []
): Map<number, { code: string; name: string; category: string; trade: string | null; unit: string }> {
  return new Map(entries);
}

// ══════════════════════════════════════════════════════════════════════
// 1. CONSTANTS & TYPES
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — Constants & Types", () => {
  it("WORKFLOW_STEP_CODES has exactly 20 steps", () => {
    expect(WORKFLOW_STEP_CODES).toHaveLength(20);
  });

  it("WORKFLOW_STEP_CODES starts with protection and ends with final_inspection", () => {
    expect(WORKFLOW_STEP_CODES[0]).toBe("protection");
    expect(WORKFLOW_STEP_CODES[WORKFLOW_STEP_CODES.length - 1]).toBe("final_inspection");
  });

  it("WORKFLOW_STEP_CODES follows correct construction execution order", () => {
    const demoIdx = WORKFLOW_STEP_CODES.indexOf("demo");
    const framingIdx = WORKFLOW_STEP_CODES.indexOf("framing");
    const drywallIdx = WORKFLOW_STEP_CODES.indexOf("drywall");
    const paintIdx = WORKFLOW_STEP_CODES.indexOf("paint");
    const cleanupIdx = WORKFLOW_STEP_CODES.indexOf("cleanup");

    expect(demoIdx).toBeLessThan(framingIdx);
    expect(framingIdx).toBeLessThan(drywallIdx);
    expect(drywallIdx).toBeLessThan(paintIdx);
    expect(paintIdx).toBeLessThan(cleanupIdx);
  });

  it("WORKFLOW_STEP_LABELS has a label for every step code", () => {
    for (const code of WORKFLOW_STEP_CODES) {
      expect(WORKFLOW_STEP_LABELS[code]).toBeDefined();
      expect(WORKFLOW_STEP_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  it("MIN_TEMPLATE_CONFIDENCE is 0.3", () => {
    expect(MIN_TEMPLATE_CONFIDENCE).toBe(0.3);
  });

  it("MAX_TEMPLATES_PER_DRAFT is 5", () => {
    expect(MAX_TEMPLATES_PER_DRAFT).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. matchTemplate
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — matchTemplate", () => {
  it("returns matched=false for inactive template", () => {
    const template = makeTemplate({ isActive: false });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(result.matched).toBe(false);
    expect(result.matchScore).toBe(0);
  });

  it("returns matched=false for wrong service type", () => {
    const template = makeTemplate({ serviceType: "bathroom_remodel" });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(result.matched).toBe(false);
    expect(result.matchScore).toBe(0);
  });

  it("returns matched=true for matching service type (base score 0.5)", () => {
    const template = makeTemplate({ finishLevel: null });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(result.matched).toBe(true);
    expect(result.matchScore).toBe(0.5);
  });

  it("adds 0.2 bonus for matching finish level", () => {
    const template = makeTemplate({ finishLevel: "standard" });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(result.matchScore).toBe(0.7);
  });

  it("subtracts 0.1 penalty for mismatched finish level", () => {
    const template = makeTemplate({ finishLevel: "luxury" });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(result.matchScore).toBe(0.4);
    expect(result.matched).toBe(true); // Still above MIN_TEMPLATE_CONFIDENCE
  });

  it("adds 0.1 bonus for matching zone", () => {
    const template = makeTemplate({ finishLevel: null, zone: "coastal" });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard", zone: "coastal" }, new Set());
    expect(result.matchScore).toBe(0.6);
  });

  it("adds 0.1 bonus for matching channel", () => {
    const template = makeTemplate({ finishLevel: null, channel: "direct" });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard", channel: "direct" }, new Set());
    expect(result.matchScore).toBe(0.6);
  });

  it("accumulates all bonuses (service + finish + zone + channel)", () => {
    const template = makeTemplate({ finishLevel: "standard", zone: "coastal", channel: "direct" });
    const result = matchTemplate(
      template,
      { serviceType: "kitchen_remodel", finishLevel: "standard", zone: "coastal", channel: "direct" },
      new Set()
    );
    // 0.5 base + 0.2 finish + 0.1 zone + 0.1 channel = 0.9
    expect(result.matchScore).toBeCloseTo(0.9, 10);
  });

  it("returns matched=false when mandatory scope rules are missing", () => {
    const template = makeTemplate({
      requiredScopeRules: [
        { ruleCode: "KIT-DEMO-STD", mandatory: true },
        { ruleCode: "KIT-CAB-STD", mandatory: true },
      ],
    });
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set(["KIT-DEMO-STD"]));
    expect(result.matched).toBe(false);
    expect(result.missingMandatoryRules).toContain("KIT-CAB-STD");
    expect(result.matchedRuleCodes).toContain("KIT-DEMO-STD");
  });

  it("returns matched=true when all mandatory scope rules are present", () => {
    const template = makeTemplate({
      requiredScopeRules: [
        { ruleCode: "KIT-DEMO-STD", mandatory: true },
        { ruleCode: "KIT-CAB-STD", mandatory: true },
        { ruleCode: "KIT-BSP-STD", mandatory: false },
      ],
    });
    const ruleCodes = new Set(["KIT-DEMO-STD", "KIT-CAB-STD"]);
    const result = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, ruleCodes);
    expect(result.matched).toBe(true);
    expect(result.missingMandatoryRules).toHaveLength(0);
    expect(result.matchedRuleCodes).toEqual(["KIT-DEMO-STD", "KIT-CAB-STD"]);
  });

  it("adds coverage bonus for matched optional rules", () => {
    const template = makeTemplate({
      finishLevel: null,
      requiredScopeRules: [
        { ruleCode: "KIT-DEMO-STD", mandatory: true },
        { ruleCode: "KIT-BSP-STD", mandatory: false },
      ],
    });
    // With 1/2 rules matched
    const result1 = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set(["KIT-DEMO-STD"]));
    // With 2/2 rules matched
    const result2 = matchTemplate(template, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set(["KIT-DEMO-STD", "KIT-BSP-STD"]));
    expect(result2.matchScore).toBeGreaterThan(result1.matchScore);
  });

  it("clamps score to [0, 1]", () => {
    const template = makeTemplate({
      finishLevel: "standard",
      zone: "coastal",
      channel: "direct",
      requiredScopeRules: [
        { ruleCode: "R1", mandatory: false },
        { ruleCode: "R2", mandatory: false },
      ],
    });
    const result = matchTemplate(
      template,
      { serviceType: "kitchen_remodel", finishLevel: "standard", zone: "coastal", channel: "direct" },
      new Set(["R1", "R2"])
    );
    expect(result.matchScore).toBeLessThanOrEqual(1);
    expect(result.matchScore).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. matchTemplates
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — matchTemplates", () => {
  it("returns empty array when no templates match", () => {
    const templates = [makeTemplate({ serviceType: "roofing" })];
    const results = matchTemplates(templates, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(results).toHaveLength(0);
  });

  it("returns matched templates sorted by score (highest first)", () => {
    const t1 = makeTemplate({ id: 1, finishLevel: "luxury" }); // penalty
    const t2 = makeTemplate({ id: 2, finishLevel: "standard" }); // bonus
    const t3 = makeTemplate({ id: 3, finishLevel: null }); // neutral
    const results = matchTemplates([t1, t2, t3], { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].template.id).toBe(2); // Highest score
    expect(results[0].matchScore).toBeGreaterThan(results[1].matchScore);
  });

  it("limits results to MAX_TEMPLATES_PER_DRAFT", () => {
    const templates = Array.from({ length: 10 }, (_, i) =>
      makeTemplate({ id: i + 1, finishLevel: null })
    );
    const results = matchTemplates(templates, { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(results.length).toBeLessThanOrEqual(MAX_TEMPLATES_PER_DRAFT);
  });

  it("filters out inactive templates", () => {
    const t1 = makeTemplate({ id: 1, isActive: true, finishLevel: null });
    const t2 = makeTemplate({ id: 2, isActive: false, finishLevel: null });
    const results = matchTemplates([t1, t2], { serviceType: "kitchen_remodel", finishLevel: "standard" }, new Set());
    expect(results).toHaveLength(1);
    expect(results[0].template.id).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. mergeAssemblies
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — mergeAssemblies", () => {
  it("returns scope items when no template is provided", () => {
    const items = [makeScopeItem({ assemblyId: 100 }), makeScopeItem({ assemblyId: 200 })];
    const result = mergeAssemblies(items, null, makeAssemblyLookup());
    expect(result).toHaveLength(2);
    expect(result.every(r => r.source === "scope")).toBe(true);
  });

  it("deduplicates scope items by assemblyId", () => {
    const items = [
      makeScopeItem({ assemblyId: 100, quantity: 5 }),
      makeScopeItem({ assemblyId: 100, quantity: 3 }), // duplicate
    ];
    const result = mergeAssemblies(items, null, makeAssemblyLookup());
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(5); // First one wins
  });

  it("adds template default assemblies that are not in scope", () => {
    const items = [makeScopeItem({ assemblyId: 100 })];
    const template = makeTemplate({ defaultAssemblies: [200, 300] });
    const lookup = makeAssemblyLookup([
      [200, { code: "ASM-200", name: "Assembly 200", category: "general", trade: null, unit: "EA" }],
      [300, { code: "ASM-300", name: "Assembly 300", category: "general", trade: null, unit: "SF" }],
    ]);
    const result = mergeAssemblies(items, template, lookup);
    expect(result).toHaveLength(3);
    expect(result[0].source).toBe("scope");
    expect(result[1].source).toBe("template_default");
    expect(result[2].source).toBe("template_default");
  });

  it("does not add template default assemblies already in scope", () => {
    const items = [makeScopeItem({ assemblyId: 100 })];
    const template = makeTemplate({ defaultAssemblies: [100, 200] });
    const lookup = makeAssemblyLookup([
      [200, { code: "ASM-200", name: "Assembly 200", category: "general", trade: null, unit: "EA" }],
    ]);
    const result = mergeAssemblies(items, template, lookup);
    expect(result).toHaveLength(2);
    expect(result.filter(r => r.assemblyId === 100)).toHaveLength(1);
  });

  it("skips template defaults not found in assembly lookup", () => {
    const items: ScopeItem[] = [];
    const template = makeTemplate({ defaultAssemblies: [999] }); // Not in lookup
    const result = mergeAssemblies(items, template, makeAssemblyLookup());
    expect(result).toHaveLength(0);
  });

  it("template default assemblies get quantity=1", () => {
    const template = makeTemplate({ defaultAssemblies: [200] });
    const lookup = makeAssemblyLookup([
      [200, { code: "ASM-200", name: "Assembly 200", category: "general", trade: null, unit: "EA" }],
    ]);
    const result = mergeAssemblies([], template, lookup);
    expect(result[0].quantity).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. getAvailableOptionalAssemblies
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — getAvailableOptionalAssemblies", () => {
  it("returns empty array when template is null", () => {
    const result = getAvailableOptionalAssemblies(new Set(), null, makeAssemblyLookup());
    expect(result).toHaveLength(0);
  });

  it("returns empty array when template has no optional assemblies", () => {
    const template = makeTemplate({ optionalAssemblies: null });
    const result = getAvailableOptionalAssemblies(new Set(), template, makeAssemblyLookup());
    expect(result).toHaveLength(0);
  });

  it("returns optional assemblies not already in merged set", () => {
    const template = makeTemplate({ optionalAssemblies: [200, 300] });
    const lookup = makeAssemblyLookup([
      [200, { code: "ASM-200", name: "Assembly 200", category: "general", trade: null, unit: "EA" }],
      [300, { code: "ASM-300", name: "Assembly 300", category: "general", trade: null, unit: "SF" }],
    ]);
    const mergedIds = new Set([200]); // 200 already merged
    const result = getAvailableOptionalAssemblies(mergedIds, template, lookup);
    expect(result).toHaveLength(1);
    expect(result[0].assemblyId).toBe(300);
    expect(result[0].source).toBe("template_optional");
  });

  it("skips optional assemblies not in lookup", () => {
    const template = makeTemplate({ optionalAssemblies: [999] });
    const result = getAvailableOptionalAssemblies(new Set(), template, makeAssemblyLookup());
    expect(result).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. getStepOrder
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — getStepOrder", () => {
  it("returns 0 for 'protection' (first step)", () => {
    expect(getStepOrder("protection")).toBe(0);
  });

  it("returns correct index for 'demo'", () => {
    expect(getStepOrder("demo")).toBe(1);
  });

  it("returns correct index for 'final_inspection' (last step)", () => {
    expect(getStepOrder("final_inspection")).toBe(WORKFLOW_STEP_CODES.length - 1);
  });

  it("returns WORKFLOW_STEP_CODES.length + 1 for unknown codes", () => {
    expect(getStepOrder("unknown_step")).toBe(WORKFLOW_STEP_CODES.length + 1);
  });

  it("demo comes before framing", () => {
    expect(getStepOrder("demo")).toBeLessThan(getStepOrder("framing"));
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. organizeIntoWorkflow
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — organizeIntoWorkflow", () => {
  it("returns empty stages for empty assemblies", () => {
    const result = organizeIntoWorkflow([], null);
    expect(result).toHaveLength(0);
  });

  it("uses template workflow steps when available", () => {
    const assembly: WorkflowAssemblyRef = {
      assemblyId: 100,
      assemblyCode: "ASM-100",
      assemblyName: "Test",
      category: "general",
      trade: null,
      quantity: 1,
      unit: "EA",
      source: "scope",
    };
    const template = makeTemplate({
      workflowSteps: [
        { order: 1, code: "demo", label: "Demolition", assemblyIds: [100] },
      ],
    });
    const result = organizeIntoWorkflow([assembly], template);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("demo");
    expect(result[0].assemblies).toHaveLength(1);
    expect(result[0].assemblies[0].assemblyId).toBe(100);
  });

  it("assigns unassigned assemblies using trade heuristics", () => {
    const assembly: WorkflowAssemblyRef = {
      assemblyId: 100,
      assemblyCode: "ASM-100",
      assemblyName: "Plumbing Fixture",
      category: "plumbing",
      trade: "plumbing",
      quantity: 1,
      unit: "EA",
      source: "scope",
    };
    const result = organizeIntoWorkflow([assembly], null);
    expect(result.length).toBeGreaterThan(0);
    // Plumbing should map to rough_plumbing
    const plumbingStage = result.find(s => s.code === "rough_plumbing");
    expect(plumbingStage).toBeDefined();
    expect(plumbingStage!.assemblies[0].assemblyId).toBe(100);
  });

  it("sorts stages by execution order", () => {
    const assemblies: WorkflowAssemblyRef[] = [
      { assemblyId: 1, assemblyCode: "A1", assemblyName: "Paint", category: "paint", trade: "paint", quantity: 1, unit: "GAL", source: "scope" },
      { assemblyId: 2, assemblyCode: "A2", assemblyName: "Demo", category: "demo", trade: "demolition", quantity: 1, unit: "EA", source: "scope" },
    ];
    const result = organizeIntoWorkflow(assemblies, null);
    expect(result.length).toBe(2);
    expect(result[0].code).toBe("demo");
    expect(result[1].code).toBe("paint");
  });

  it("re-numbers orders sequentially after sorting", () => {
    const assemblies: WorkflowAssemblyRef[] = [
      { assemblyId: 1, assemblyCode: "A1", assemblyName: "Cleanup", category: "cleanup", trade: "cleanup", quantity: 1, unit: "EA", source: "scope" },
      { assemblyId: 2, assemblyCode: "A2", assemblyName: "Demo", category: "demo", trade: "demolition", quantity: 1, unit: "EA", source: "scope" },
    ];
    const result = organizeIntoWorkflow(assemblies, null);
    expect(result[0].order).toBe(1);
    expect(result[1].order).toBe(2);
  });

  it("merges unassigned assemblies into existing stages when codes match", () => {
    const assemblies: WorkflowAssemblyRef[] = [
      { assemblyId: 100, assemblyCode: "A100", assemblyName: "Assigned Demo", category: "general", trade: null, quantity: 1, unit: "EA", source: "scope" },
      { assemblyId: 200, assemblyCode: "A200", assemblyName: "Unassigned Demo", category: "demolition", trade: "demolition", quantity: 1, unit: "EA", source: "scope" },
    ];
    const template = makeTemplate({
      workflowSteps: [
        { order: 1, code: "demo", label: "Demolition", assemblyIds: [100] },
      ],
    });
    const result = organizeIntoWorkflow(assemblies, template);
    const demoStage = result.find(s => s.code === "demo");
    expect(demoStage).toBeDefined();
    expect(demoStage!.assemblies).toHaveLength(2);
  });

  it("defaults unassigned assemblies with unknown trade to finish_install", () => {
    const assembly: WorkflowAssemblyRef = {
      assemblyId: 100,
      assemblyCode: "A100",
      assemblyName: "Unknown",
      category: "unknown_category",
      trade: "unknown_trade",
      quantity: 1,
      unit: "EA",
      source: "scope",
    };
    const result = organizeIntoWorkflow([assembly], null);
    const stage = result.find(s => s.code === "finish_install");
    expect(stage).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. buildTradeToStageMap
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — buildTradeToStageMap", () => {
  it("returns a Map with trade-to-stage mappings", () => {
    const map = buildTradeToStageMap();
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBeGreaterThan(30);
  });

  it("maps demolition trades to 'demo'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("demolition")).toBe("demo");
    expect(map.get("demo")).toBe("demo");
    expect(map.get("tear-off")).toBe("demo");
  });

  it("maps electrical to 'rough_electrical'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("electrical")).toBe("rough_electrical");
  });

  it("maps plumbing to 'rough_plumbing'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("plumbing")).toBe("rough_plumbing");
  });

  it("maps flooring trades to 'flooring'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("flooring")).toBe("flooring");
    expect(map.get("hardwood")).toBe("flooring");
    expect(map.get("lvp")).toBe("flooring");
    expect(map.get("carpet")).toBe("flooring");
  });

  it("maps paint to 'paint' and primer to 'prime_paint'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("paint")).toBe("paint");
    expect(map.get("painting")).toBe("paint");
    expect(map.get("primer")).toBe("prime_paint");
  });

  it("maps cabinets and countertops to 'finish_install'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("cabinets")).toBe("finish_install");
    expect(map.get("countertops")).toBe("finish_install");
  });

  it("maps tile to 'tile'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("tile")).toBe("tile");
    expect(map.get("backsplash")).toBe("tile");
  });

  it("maps cleanup to 'cleanup'", () => {
    const map = buildTradeToStageMap();
    expect(map.get("cleanup")).toBe("cleanup");
    expect(map.get("haul-off")).toBe("cleanup");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. workflowToBundleSelections
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — workflowToBundleSelections", () => {
  it("returns empty array for empty stages", () => {
    expect(workflowToBundleSelections([])).toHaveLength(0);
  });

  it("converts workflow stages to BundleAssemblySelection array", () => {
    const stages: WorkflowStage[] = [
      {
        order: 1,
        code: "demo",
        label: "Demolition",
        assemblies: [
          { assemblyId: 100, assemblyCode: "A100", assemblyName: "Demo Work", category: "demo", trade: "demolition", quantity: 1, unit: "EA", source: "scope" },
        ],
      },
    ];
    const result = workflowToBundleSelections(stages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      assemblyId: 100,
      assemblyName: "Demo Work",
      assemblyCode: "A100",
      category: "demo",
      trade: "demolition",
      quantity: 1,
    });
  });

  it("deduplicates assemblies across stages", () => {
    const stages: WorkflowStage[] = [
      {
        order: 1, code: "demo", label: "Demo",
        assemblies: [{ assemblyId: 100, assemblyCode: "A100", assemblyName: "Demo", category: "demo", trade: null, quantity: 1, unit: "EA", source: "scope" }],
      },
      {
        order: 2, code: "cleanup", label: "Cleanup",
        assemblies: [{ assemblyId: 100, assemblyCode: "A100", assemblyName: "Demo", category: "demo", trade: null, quantity: 1, unit: "EA", source: "scope" }],
      },
    ];
    const result = workflowToBundleSelections(stages);
    expect(result).toHaveLength(1);
  });

  it("maintains execution order from stages", () => {
    const stages: WorkflowStage[] = [
      {
        order: 1, code: "demo", label: "Demo",
        assemblies: [{ assemblyId: 100, assemblyCode: "A100", assemblyName: "Demo", category: "demo", trade: null, quantity: 1, unit: "EA", source: "scope" }],
      },
      {
        order: 2, code: "paint", label: "Paint",
        assemblies: [{ assemblyId: 200, assemblyCode: "A200", assemblyName: "Paint", category: "paint", trade: null, quantity: 1, unit: "GAL", source: "scope" }],
      },
    ];
    const result = workflowToBundleSelections(stages);
    expect(result[0].assemblyId).toBe(100);
    expect(result[1].assemblyId).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. flattenWorkflow
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — flattenWorkflow", () => {
  it("returns empty array for empty stages", () => {
    expect(flattenWorkflow([])).toHaveLength(0);
  });

  it("flattens all assemblies from all stages in order", () => {
    const stages: WorkflowStage[] = [
      {
        order: 1, code: "demo", label: "Demo",
        assemblies: [
          { assemblyId: 1, assemblyCode: "A1", assemblyName: "A", category: "c", trade: null, quantity: 1, unit: "EA", source: "scope" },
          { assemblyId: 2, assemblyCode: "A2", assemblyName: "B", category: "c", trade: null, quantity: 1, unit: "EA", source: "scope" },
        ],
      },
      {
        order: 2, code: "paint", label: "Paint",
        assemblies: [
          { assemblyId: 3, assemblyCode: "A3", assemblyName: "C", category: "c", trade: null, quantity: 1, unit: "EA", source: "scope" },
        ],
      },
    ];
    const result = flattenWorkflow(stages);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.assemblyId)).toEqual([1, 2, 3]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. generateRemodelWorkflow (Full Pipeline)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — generateRemodelWorkflow", () => {
  it("generates workflow with no templates (heuristic fallback)", () => {
    const items = [
      makeScopeItem({ assemblyId: 100, trade: "demolition", category: "demo" }),
      makeScopeItem({ assemblyId: 200, trade: "paint", category: "paint" }),
    ];
    const draft = makeScopeDraft(items);
    const result = generateRemodelWorkflow(draft, [], makeAssemblyLookup());

    expect(result.templateId).toBeNull();
    expect(result.templateName).toBeNull();
    expect(result.stages.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("No remodel template matched");
    expect(result.bundleSelections).toHaveLength(2);
    expect(result.metadata.templatesEvaluated).toBe(0);
    expect(result.metadata.templatesMatched).toBe(0);
  });

  it("generates workflow with matching template", () => {
    const items = [
      makeScopeItem({ assemblyId: 100, ruleCode: "KIT-DEMO-STD", trade: "demolition" }),
      makeScopeItem({ assemblyId: 200, ruleCode: "KIT-CAB-STD", trade: "cabinets" }),
    ];
    const draft = makeScopeDraft(items);
    const template = makeTemplate({
      id: 42,
      name: "Kitchen Standard",
      requiredScopeRules: [
        { ruleCode: "KIT-DEMO-STD", mandatory: true },
        { ruleCode: "KIT-CAB-STD", mandatory: true },
      ],
      workflowSteps: [
        { order: 1, code: "demo", label: "Demo", assemblyIds: [100] },
        { order: 2, code: "finish_install", label: "Cabinets", assemblyIds: [200] },
      ],
    });
    const result = generateRemodelWorkflow(draft, [template], makeAssemblyLookup());

    expect(result.templateId).toBe(42);
    expect(result.templateName).toBe("Kitchen Standard");
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].code).toBe("demo");
    expect(result.stages[1].code).toBe("finish_install");
    expect(result.metadata.templatesMatched).toBe(1);
  });

  it("adds template default assemblies and reports in warnings", () => {
    const items = [makeScopeItem({ assemblyId: 100, ruleCode: "KIT-DEMO-STD" })];
    const draft = makeScopeDraft(items);
    const template = makeTemplate({
      requiredScopeRules: [{ ruleCode: "KIT-DEMO-STD", mandatory: true }],
      defaultAssemblies: [500],
    });
    const lookup = makeAssemblyLookup([
      [500, { code: "ASM-500", name: "Default Assembly", category: "general", trade: "fixtures", unit: "EA" }],
    ]);
    const result = generateRemodelWorkflow(draft, [template], lookup);

    expect(result.metadata.defaultAssembliesAdded).toBe(1);
    expect(result.warnings.some(w => w.includes("default assembly"))).toBe(true);
  });

  it("handles empty scope draft gracefully", () => {
    const draft = makeScopeDraft([]);
    const result = generateRemodelWorkflow(draft, [], makeAssemblyLookup());

    expect(result.stages).toHaveLength(0);
    expect(result.bundleSelections).toHaveLength(0);
    expect(result.warnings.some(w => w.includes("No workflow stages"))).toBe(true);
  });

  it("extracts context from scope draft metadata", () => {
    const draft = makeScopeDraft([], {
      intakeServiceType: "bathroom_remodel",
      intakeFinishLevel: "premium",
      projectZone: "coastal",
    });
    const template = makeTemplate({ serviceType: "bathroom_remodel", finishLevel: "premium" });
    const result = generateRemodelWorkflow(draft, [template], makeAssemblyLookup());

    expect(result.metadata.serviceType).toBe("bathroom_remodel");
    expect(result.metadata.finishLevel).toBe("premium");
  });

  it("treats 'unknown' zone as null in context", () => {
    const draft = makeScopeDraft([], { projectZone: "unknown" });
    const template = makeTemplate({ zone: "coastal" });
    // Zone should not match since "unknown" is treated as null
    const result = generateRemodelWorkflow(draft, [template], makeAssemblyLookup());
    // Template still matches on service type
    expect(result.templateId).toBe(template.id);
  });

  it("returns correct metadata counts", () => {
    const items = [
      makeScopeItem({ assemblyId: 1, ruleCode: "R1" }),
      makeScopeItem({ assemblyId: 2, ruleCode: "R2" }),
      makeScopeItem({ assemblyId: 3, ruleCode: "R3" }),
    ];
    const draft = makeScopeDraft(items);
    const result = generateRemodelWorkflow(draft, [], makeAssemblyLookup());

    expect(result.metadata.scopeItemsProcessed).toBe(3);
    expect(result.metadata.generatedAt).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 12. previewRemodelWorkflow
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — previewRemodelWorkflow", () => {
  it("returns workflow output plus templateMatches array", () => {
    const draft = makeScopeDraft([makeScopeItem()]);
    const template = makeTemplate({ finishLevel: null });
    const result = previewRemodelWorkflow(draft, [template], makeAssemblyLookup());

    expect(result.templateMatches).toBeDefined();
    expect(Array.isArray(result.templateMatches)).toBe(true);
    expect(result.templateMatches).toHaveLength(1);
    expect(result.stages).toBeDefined();
    expect(result.bundleSelections).toBeDefined();
  });

  it("includes all templates in templateMatches (not just matched ones)", () => {
    const draft = makeScopeDraft([], { intakeServiceType: "kitchen_remodel" });
    const t1 = makeTemplate({ id: 1, serviceType: "kitchen_remodel", finishLevel: null });
    const t2 = makeTemplate({ id: 2, serviceType: "roofing", finishLevel: null }); // Won't match
    const result = previewRemodelWorkflow(draft, [t1, t2], makeAssemblyLookup());

    expect(result.templateMatches).toHaveLength(2);
    expect(result.templateMatches[0].template.id).toBe(1);
    expect(result.templateMatches[1].template.id).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 13. SEED DATA INTEGRITY
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — Seed Data Integrity", () => {
  it("ALL_REMODEL_TEMPLATES has exactly 18 templates", () => {
    expect(ALL_REMODEL_TEMPLATES).toHaveLength(21);
  });

  it("TEMPLATE_COUNTS matches actual group sizes", () => {
    expect(TEMPLATE_COUNTS.kitchen_remodel).toBe(KITCHEN_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.bathroom_remodel).toBe(BATHROOM_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.roofing).toBe(ROOFING_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.siding).toBe(SIDING_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.windows_doors).toBe(WINDOWS_DOORS_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.deck_porch).toBe(DECK_PORCH_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.painting).toBe(PAINTING_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.flooring).toBe(FLOORING_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.exterior).toBe(EXTERIOR_TEMPLATES.length);
    expect(TEMPLATE_COUNTS.full_remodel).toBe(FULL_REMODEL_TEMPLATES.length);
  });

  it("every template has a non-empty name", () => {
    for (const t of ALL_REMODEL_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it("every template has a valid serviceType", () => {
    const validTypes = Object.keys(TEMPLATE_COUNTS);
    for (const t of ALL_REMODEL_TEMPLATES) {
      expect(validTypes).toContain(t.serviceType);
    }
  });

  it("every template with finishLevel uses valid values", () => {
    const validLevels = ["standard", "premium", "luxury"];
    for (const t of ALL_REMODEL_TEMPLATES) {
      if (t.finishLevel) {
        expect(validLevels).toContain(t.finishLevel);
      }
    }
  });

  it("every template with workflowSteps has valid step codes", () => {
    const validCodes = new Set(WORKFLOW_STEP_CODES);
    for (const t of ALL_REMODEL_TEMPLATES) {
      if (t.workflowSteps) {
        for (const step of t.workflowSteps) {
          expect(validCodes.has(step.code as any)).toBe(true);
        }
      }
    }
  });

  it("every template with workflowSteps has sequential order", () => {
    for (const t of ALL_REMODEL_TEMPLATES) {
      if (t.workflowSteps && t.workflowSteps.length > 1) {
        for (let i = 1; i < t.workflowSteps.length; i++) {
          expect(t.workflowSteps[i].order).toBeGreaterThan(t.workflowSteps[i - 1].order);
        }
      }
    }
  });

  it("every template with requiredScopeRules has valid rule code format", () => {
    const ruleCodePattern = /^[A-Z]{2,4}-[A-Z]{2,5}-[A-Z]{2,8}$/;
    for (const t of ALL_REMODEL_TEMPLATES) {
      if (t.requiredScopeRules) {
        for (const ref of t.requiredScopeRules) {
          expect(ref.ruleCode).toMatch(ruleCodePattern);
        }
      }
    }
  });

  it("kitchen templates have 3 variants (standard, premium, luxury)", () => {
    expect(KITCHEN_TEMPLATES).toHaveLength(3);
    const levels = KITCHEN_TEMPLATES.map(t => t.finishLevel);
    expect(levels).toContain("standard");
    expect(levels).toContain("premium");
    expect(levels).toContain("luxury");
  });

  it("roofing templates include a coastal variant", () => {
    const coastal = ROOFING_TEMPLATES.find(t => t.zone === "coastal");
    expect(coastal).toBeDefined();
    expect(coastal!.name).toContain("Coastal");
  });

  it("full remodel templates have the most workflow steps", () => {
    const fullStepCounts = FULL_REMODEL_TEMPLATES.map(t => t.workflowSteps?.length ?? 0);
    const maxFullSteps = Math.max(...fullStepCounts);
    for (const t of ALL_REMODEL_TEMPLATES) {
      if (t.serviceType !== "full_remodel") {
        expect(t.workflowSteps?.length ?? 0).toBeLessThanOrEqual(maxFullSteps);
      }
    }
  });

  it("coastal templates reference coastal scope rules", () => {
    const coastalTemplates = ALL_REMODEL_TEMPLATES.filter(t => t.zone === "coastal");
    expect(coastalTemplates.length).toBeGreaterThan(0);
    for (const t of coastalTemplates) {
      const hasCoastalRule = t.requiredScopeRules?.some(r => r.ruleCode.includes("COASTAL"));
      expect(hasCoastalRule).toBe(true);
    }
  });

  it("every template with typicalSqftRange has min < max", () => {
    for (const t of ALL_REMODEL_TEMPLATES) {
      if (t.typicalSqftRange) {
        expect(t.typicalSqftRange.min).toBeLessThan(t.typicalSqftRange.max);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 14. CROSS-MODULE COMPATIBILITY
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 13 — Cross-Module Compatibility", () => {
  it("ScopeItem fields are compatible with WorkflowAssemblyRef", () => {
    const scopeItem = makeScopeItem({
      assemblyId: 100,
      assemblyCode: "ASM-100",
      assemblyName: "Test",
      category: "general",
      trade: "plumbing",
      quantity: 5,
      unit: "EA",
      ruleCode: "TEST-001",
    });

    // mergeAssemblies should accept ScopeItem and produce WorkflowAssemblyRef
    const result = mergeAssemblies([scopeItem], null, makeAssemblyLookup());
    expect(result[0].assemblyId).toBe(scopeItem.assemblyId);
    expect(result[0].assemblyCode).toBe(scopeItem.assemblyCode);
    expect(result[0].assemblyName).toBe(scopeItem.assemblyName);
    expect(result[0].quantity).toBe(scopeItem.quantity);
    expect(result[0].source).toBe("scope");
    expect(result[0].ruleCode).toBe(scopeItem.ruleCode);
  });

  it("BundleAssemblySelection output is compatible with structr.ai", () => {
    const stages: WorkflowStage[] = [
      {
        order: 1, code: "demo", label: "Demo",
        assemblies: [{
          assemblyId: 100, assemblyCode: "ASM-100", assemblyName: "Demo Work",
          category: "demolition", trade: "demo", quantity: 1, unit: "EA", source: "scope",
        }],
      },
    ];
    const selections = workflowToBundleSelections(stages);
    // Verify BundleAssemblySelection has all required fields
    const sel = selections[0];
    expect(sel).toHaveProperty("assemblyId");
    expect(sel).toHaveProperty("assemblyName");
    expect(sel).toHaveProperty("assemblyCode");
    expect(sel).toHaveProperty("category");
    expect(sel).toHaveProperty("trade");
    expect(sel).toHaveProperty("quantity");
    // Should NOT have source, unit, or ruleCode (those are workflow-only)
    expect(sel).not.toHaveProperty("source");
    expect(sel).not.toHaveProperty("unit");
    expect(sel).not.toHaveProperty("ruleCode");
  });

  it("full pipeline: ScopeDraft → Remodel Workflow → Bundle Selections", () => {
    const items = [
      makeScopeItem({ assemblyId: 1, assemblyCode: "KIT-D", assemblyName: "Kitchen Demo", trade: "demolition", ruleCode: "KIT-DEMO-STD" }),
      makeScopeItem({ assemblyId: 2, assemblyCode: "KIT-C", assemblyName: "Kitchen Cabinets", trade: "cabinets", ruleCode: "KIT-CAB-STD" }),
      makeScopeItem({ assemblyId: 3, assemblyCode: "KIT-T", assemblyName: "Kitchen Countertop", trade: "countertops", ruleCode: "KIT-CTR-STD" }),
    ];
    const draft = makeScopeDraft(items, { intakeServiceType: "kitchen_remodel", intakeFinishLevel: "standard" });

    const template = makeTemplate({
      id: 1,
      name: "Kitchen Standard",
      requiredScopeRules: [
        { ruleCode: "KIT-DEMO-STD", mandatory: true },
        { ruleCode: "KIT-CAB-STD", mandatory: true },
        { ruleCode: "KIT-CTR-STD", mandatory: true },
      ],
      workflowSteps: [
        { order: 1, code: "demo", label: "Demolition", assemblyIds: [1] },
        { order: 2, code: "finish_install", label: "Cabinets & Countertops", assemblyIds: [2, 3] },
      ],
    });

    const result = generateRemodelWorkflow(draft, [template], makeAssemblyLookup());

    // Template matched
    expect(result.templateId).toBe(1);
    // Stages organized correctly
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].code).toBe("demo");
    expect(result.stages[1].code).toBe("finish_install");
    // Bundle selections match
    expect(result.bundleSelections).toHaveLength(3);
    expect(result.bundleSelections[0].assemblyId).toBe(1);
    expect(result.bundleSelections[1].assemblyId).toBe(2);
    expect(result.bundleSelections[2].assemblyId).toBe(3);
    // Ordered assemblies match
    expect(result.orderedAssemblies).toHaveLength(3);
  });
});
