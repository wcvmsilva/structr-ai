/**
 * structr.ai Construction Brain — Remodel Engine
 * Sprint 13: Remodel Workflow Coordinator
 *
 * The Remodel Engine is a COORDINATOR, not a rule engine.
 * It does NOT:
 *   - Create new scope rules
 *   - Modify pricing
 *   - Calculate margin
 *   - Apply geographic modifiers
 *
 * It DOES:
 *   - Consume ScopeDraft output
 *   - Match remodel templates based on service_type + finish_level
 *   - Merge required assemblies with optional assemblies
 *   - Organize assemblies into workflow stages
 *   - Return ordered bundle structure compatible with structr.ai
 *
 * Flow: ScopeDraft → Remodel Engine → Bundle → Estimate Draft
 */

import type { ScopeDraftOutput, ScopeItem, BundleAssemblySelection } from "./scope-engine";
import type { WorkflowStep, RequiredScopeRuleRef } from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Standard workflow step codes in construction execution order */
export const WORKFLOW_STEP_CODES = [
  "protection",
  "demo",
  "structural",
  "framing",
  "mechanical",
  "rough_electrical",
  "rough_plumbing",
  "insulation",
  "waterproofing",
  "drywall",
  "prime_paint",
  "tile",
  "finish_carpentry",
  "finish_install",
  "fixtures",
  "paint",
  "flooring",
  "hardware",
  "cleanup",
  "final_inspection",
] as const;

export type WorkflowStepCode = (typeof WORKFLOW_STEP_CODES)[number];

/** Human-readable labels for workflow steps */
export const WORKFLOW_STEP_LABELS: Record<WorkflowStepCode, string> = {
  protection: "Site Protection & Prep",
  demo: "Demolition",
  structural: "Structural Work",
  framing: "Framing",
  mechanical: "Mechanical (HVAC)",
  rough_electrical: "Rough Electrical",
  rough_plumbing: "Rough Plumbing",
  insulation: "Insulation",
  waterproofing: "Waterproofing & Moisture Barrier",
  drywall: "Drywall",
  prime_paint: "Prime & Prep Paint",
  tile: "Tile & Stone",
  finish_carpentry: "Finish Carpentry & Trim",
  finish_install: "Finish Installation",
  fixtures: "Fixtures & Appliances",
  paint: "Final Paint",
  flooring: "Flooring",
  hardware: "Hardware & Accessories",
  cleanup: "Cleanup & Punch List",
  final_inspection: "Final Inspection",
};

/** Minimum confidence threshold for template matching */
export const MIN_TEMPLATE_CONFIDENCE = 0.3;

/** Maximum templates that can be applied to a single scope draft */
export const MAX_TEMPLATES_PER_DRAFT = 5;

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Remodel template data (from DB or seed) */
export interface RemodelTemplateData {
  id: string;
  name: string;
  serviceType: string;
  finishLevel: string | null;
  zone: string | null;
  channel: string | null;
  description: string | null;
  requiredScopeRules: RequiredScopeRuleRef[] | null;
  defaultAssemblies: string[] | null;
  optionalAssemblies: string[] | null;
  workflowSteps: WorkflowStep[] | null;
  typicalSqftRange: { min: number; max: number } | null;
  estimatedDuration: string | null;
  isActive: boolean;
}

/** Assembly reference for workflow organization */
export interface WorkflowAssemblyRef {
  assemblyId: string;
  assemblyCode: string;
  assemblyName: string;
  category: string;
  trade: string | null;
  quantity: number;
  unit: string;
  source: "scope" | "template_default" | "template_optional";
  ruleCode?: string;
}

/** A single workflow stage with its assemblies */
export interface WorkflowStage {
  order: number;
  code: string;
  label: string;
  assemblies: WorkflowAssemblyRef[];
  estimatedDuration?: string;
}

/** Template match result */
export interface TemplateMatchResult {
  template: RemodelTemplateData;
  matchScore: number; // 0.0 to 1.0
  matchedRuleCodes: string[];
  missingMandatoryRules: string[];
  matched: boolean;
}

/** Complete remodel workflow output */
export interface RemodelWorkflowOutput {
  /** Matched template (if any) */
  templateId: string | null;
  templateName: string | null;
  /** Ordered workflow stages with assemblies */
  stages: WorkflowStage[];
  /** All assemblies in execution order (flattened) */
  orderedAssemblies: WorkflowAssemblyRef[];
  /** Bundle-ready selections (compatible with structr.ai) */
  bundleSelections: BundleAssemblySelection[];
  /** Warnings and notes */
  warnings: string[];
  /** Metadata */
  metadata: {
    serviceType: string;
    finishLevel: string;
    templatesEvaluated: number;
    templatesMatched: number;
    scopeItemsProcessed: number;
    defaultAssembliesAdded: number;
    workflowStageCount: number;
    generatedAt: string;
  };
}

/** Input context for remodel generation */
export interface RemodelContext {
  serviceType: string;
  finishLevel: string;
  zone?: string | null;
  channel?: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// TEMPLATE MATCHING
// ══════════════════════════════════════════════════════════════════════

/**
 * Match a single remodel template against context and scope draft.
 * Returns a match result with score and missing rules.
 */
export function matchTemplate(
  template: RemodelTemplateData,
  context: RemodelContext,
  scopeRuleCodes: Set<string>
): TemplateMatchResult {
  // Must be active
  if (!template.isActive) {
    return {
      template,
      matchScore: 0,
      matchedRuleCodes: [],
      missingMandatoryRules: [],
      matched: false,
    };
  }

  // Service type must match
  if (template.serviceType !== context.serviceType) {
    return {
      template,
      matchScore: 0,
      matchedRuleCodes: [],
      missingMandatoryRules: [],
      matched: false,
    };
  }

  let score = 0.5; // Base score for service type match

  // Finish level match (bonus)
  if (template.finishLevel) {
    if (template.finishLevel === context.finishLevel) {
      score += 0.2;
    } else {
      score -= 0.1; // Penalty for mismatch (but don't disqualify)
    }
  }

  // Zone match (bonus)
  if (template.zone && context.zone) {
    if (template.zone === context.zone) {
      score += 0.1;
    }
  }

  // Channel match (bonus)
  if (template.channel && context.channel) {
    if (template.channel === context.channel) {
      score += 0.1;
    }
  }

  // Check required scope rules
  const matchedRuleCodes: string[] = [];
  const missingMandatoryRules: string[] = [];

  if (template.requiredScopeRules && template.requiredScopeRules.length > 0) {
    for (const ref of template.requiredScopeRules) {
      if (scopeRuleCodes.has(ref.ruleCode)) {
        matchedRuleCodes.push(ref.ruleCode);
      } else if (ref.mandatory) {
        missingMandatoryRules.push(ref.ruleCode);
      }
    }

    // If any mandatory rules are missing, template doesn't match
    if (missingMandatoryRules.length > 0) {
      return {
        template,
        matchScore: 0,
        matchedRuleCodes,
        missingMandatoryRules,
        matched: false,
      };
    }

    // Bonus for matched rules coverage
    const coverage = matchedRuleCodes.length / template.requiredScopeRules.length;
    score += coverage * 0.1;
  }

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  return {
    template,
    matchScore: score,
    matchedRuleCodes,
    missingMandatoryRules,
    matched: score >= MIN_TEMPLATE_CONFIDENCE,
  };
}

/**
 * Match all templates against context and scope draft.
 * Returns matched templates sorted by score (highest first).
 */
export function matchTemplates(
  templates: RemodelTemplateData[],
  context: RemodelContext,
  scopeRuleCodes: Set<string>
): TemplateMatchResult[] {
  const results = templates.map(t => matchTemplate(t, context, scopeRuleCodes));
  return results
    .filter(r => r.matched)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_TEMPLATES_PER_DRAFT);
}

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLY MERGING
// ══════════════════════════════════════════════════════════════════════

/**
 * Merge scope draft items with template default assemblies.
 * Scope items take priority; template defaults fill gaps.
 * Returns a deduplicated list of WorkflowAssemblyRef.
 */
export function mergeAssemblies(
  scopeItems: ScopeItem[],
  template: RemodelTemplateData | null,
  assemblyLookup: Map<string, { code: string; name: string; category: string; trade: string | null; unit: string }>
): WorkflowAssemblyRef[] {
  const merged: WorkflowAssemblyRef[] = [];
  const seenAssemblyIds = new Set<string>();

  // 1. Add scope items first (highest priority)
  for (const item of scopeItems) {
    if (!seenAssemblyIds.has(item.assemblyId)) {
      merged.push({
        assemblyId: item.assemblyId,
        assemblyCode: item.assemblyCode,
        assemblyName: item.assemblyName,
        category: item.category,
        trade: item.trade,
        quantity: item.quantity,
        unit: item.unit,
        source: "scope",
        ruleCode: item.ruleCode,
      });
      seenAssemblyIds.add(item.assemblyId);
    }
  }

  // 2. Add template default assemblies (fill gaps)
  if (template?.defaultAssemblies) {
    for (const assemblyId of template.defaultAssemblies) {
      if (!seenAssemblyIds.has(assemblyId)) {
        const ref = assemblyLookup.get(assemblyId);
        if (ref) {
          merged.push({
            assemblyId,
            assemblyCode: ref.code,
            assemblyName: ref.name,
            category: ref.category,
            trade: ref.trade,
            quantity: 1, // Default quantity for template assemblies
            unit: ref.unit,
            source: "template_default",
          });
          seenAssemblyIds.add(assemblyId);
        }
      }
    }
  }

  return merged;
}

/**
 * Get optional assemblies from template that are NOT already in the merged list.
 */
export function getAvailableOptionalAssemblies(
  mergedAssemblyIds: Set<string>,
  template: RemodelTemplateData | null,
  assemblyLookup: Map<string, { code: string; name: string; category: string; trade: string | null; unit: string }>
): WorkflowAssemblyRef[] {
  if (!template?.optionalAssemblies) return [];

  const optionals: WorkflowAssemblyRef[] = [];
  for (const assemblyId of template.optionalAssemblies) {
    if (!mergedAssemblyIds.has(assemblyId)) {
      const ref = assemblyLookup.get(assemblyId);
      if (ref) {
        optionals.push({
          assemblyId,
          assemblyCode: ref.code,
          assemblyName: ref.name,
          category: ref.category,
          trade: ref.trade,
          quantity: 1,
          unit: ref.unit,
          source: "template_optional",
        });
      }
    }
  }
  return optionals;
}

// ══════════════════════════════════════════════════════════════════════
// WORKFLOW ORDERING
// ══════════════════════════════════════════════════════════════════════

/**
 * Get the execution order index for a workflow step code.
 * Returns a high number for unknown codes to place them at the end.
 */
export function getStepOrder(code: string): number {
  const idx = WORKFLOW_STEP_CODES.indexOf(code as WorkflowStepCode);
  return idx >= 0 ? idx : WORKFLOW_STEP_CODES.length + 1;
}

/**
 * Assign assemblies to workflow steps based on template definition.
 * Assemblies not assigned to any step go to a "general" stage.
 */
export function organizeIntoWorkflow(
  assemblies: WorkflowAssemblyRef[],
  template: RemodelTemplateData | null
): WorkflowStage[] {
  const stages: WorkflowStage[] = [];
  const assignedIds = new Set<string>();

  // 1. If template has workflow steps, use them
  if (template?.workflowSteps && template.workflowSteps.length > 0) {
    // Sort steps by order
    const sortedSteps = [...template.workflowSteps].sort((a, b) => a.order - b.order);

    for (const step of sortedSteps) {
      const stepAssemblies: WorkflowAssemblyRef[] = [];

      // Find assemblies assigned to this step
      for (const assemblyId of (step.assemblyIds ?? [])) {
        const assembly = assemblies.find(a => a.assemblyId === assemblyId);
        if (assembly) {
          stepAssemblies.push(assembly);
          assignedIds.add(assemblyId);
        }
      }

      // Only add stage if it has assemblies
      if (stepAssemblies.length > 0) {
        stages.push({
          order: step.order,
          code: step.code,
          label: step.label || WORKFLOW_STEP_LABELS[step.code as WorkflowStepCode] || step.code,
          assemblies: stepAssemblies,
        });
      }
    }
  }

  // 2. Assign unassigned assemblies using trade-based heuristics
  const unassigned = assemblies.filter(a => !assignedIds.has(a.assemblyId));
  if (unassigned.length > 0) {
    const tradeStageMap = buildTradeToStageMap();
    const stageMap = new Map<string, WorkflowAssemblyRef[]>();

    for (const assembly of unassigned) {
      const stageCode = tradeStageMap.get(assembly.trade?.toLowerCase() ?? "") ??
                        tradeStageMap.get(assembly.category?.toLowerCase() ?? "") ??
                        "finish_install";
      if (!stageMap.has(stageCode)) {
        stageMap.set(stageCode, []);
      }
      stageMap.get(stageCode)!.push(assembly);
    }

    // Convert to stages and merge with existing
    for (const [code, stageAssemblies] of Array.from(stageMap.entries())) {
      const existingStage = stages.find(s => s.code === code);
      if (existingStage) {
        existingStage.assemblies.push(...stageAssemblies);
      } else {
        stages.push({
          order: getStepOrder(code),
          code,
          label: WORKFLOW_STEP_LABELS[code as WorkflowStepCode] || code,
          assemblies: stageAssemblies,
        });
      }
    }
  }

  // 3. Sort stages by execution order
  stages.sort((a, b) => getStepOrder(a.code) - getStepOrder(b.code));

  // 4. Re-number orders sequentially
  stages.forEach((stage, idx) => {
    stage.order = idx + 1;
  });

  return stages;
}

/**
 * Build a mapping from trade/category names to workflow step codes.
 * Used as a heuristic when template doesn't specify workflow assignments.
 */
export function buildTradeToStageMap(): Map<string, string> {
  const map = new Map<string, string>();

  // Demolition trades
  map.set("demolition", "demo");
  map.set("demo", "demo");
  map.set("tear-off", "demo");
  map.set("removal", "demo");

  // Structural
  map.set("structural", "structural");
  map.set("foundation", "structural");
  map.set("concrete", "structural");

  // Framing
  map.set("framing", "framing");
  map.set("carpentry", "framing");
  map.set("lumber", "framing");

  // Mechanical
  map.set("hvac", "mechanical");
  map.set("mechanical", "mechanical");

  // Electrical
  map.set("electrical", "rough_electrical");
  map.set("wiring", "rough_electrical");

  // Plumbing
  map.set("plumbing", "rough_plumbing");
  map.set("piping", "rough_plumbing");

  // Insulation
  map.set("insulation", "insulation");

  // Waterproofing
  map.set("waterproofing", "waterproofing");
  map.set("moisture", "waterproofing");
  map.set("vapor barrier", "waterproofing");
  map.set("flashing", "waterproofing");

  // Drywall
  map.set("drywall", "drywall");
  map.set("sheetrock", "drywall");

  // Tile
  map.set("tile", "tile");
  map.set("backsplash", "tile");
  map.set("stone", "tile");

  // Finish carpentry
  map.set("trim", "finish_carpentry");
  map.set("molding", "finish_carpentry");
  map.set("crown", "finish_carpentry");
  map.set("baseboard", "finish_carpentry");
  map.set("casing", "finish_carpentry");

  // Finish install
  map.set("cabinets", "finish_install");
  map.set("countertops", "finish_install");
  map.set("vanity", "finish_install");
  map.set("installation", "finish_install");

  // Fixtures
  map.set("fixtures", "fixtures");
  map.set("appliances", "fixtures");
  map.set("lighting", "fixtures");
  map.set("faucet", "fixtures");
  map.set("sink", "fixtures");
  map.set("toilet", "fixtures");
  map.set("shower", "fixtures");

  // Paint
  map.set("paint", "paint");
  map.set("painting", "paint");
  map.set("primer", "prime_paint");
  map.set("prep paint", "prime_paint");

  // Flooring
  map.set("flooring", "flooring");
  map.set("hardwood", "flooring");
  map.set("lvp", "flooring");
  map.set("carpet", "flooring");
  map.set("vinyl", "flooring");

  // Hardware
  map.set("hardware", "hardware");
  map.set("accessories", "hardware");
  map.set("knobs", "hardware");
  map.set("pulls", "hardware");

  // Roofing (maps to structural for remodel context)
  map.set("roofing", "structural");
  map.set("shingles", "structural");
  map.set("underlayment", "waterproofing");
  map.set("ridge", "structural");

  // Siding
  map.set("siding", "finish_install");
  map.set("wrap", "waterproofing");

  // Windows/Doors
  map.set("windows", "finish_install");
  map.set("doors", "finish_install");

  // Deck
  map.set("decking", "framing");
  map.set("deck", "framing");
  map.set("railing", "finish_carpentry");
  map.set("screen", "finish_install");

  // Cleanup
  map.set("cleanup", "cleanup");
  map.set("disposal", "cleanup");
  map.set("dumpster", "demo");
  map.set("haul-off", "cleanup");

  // Protection
  map.set("protection", "protection");
  map.set("dust barrier", "protection");

  return map;
}

// ══════════════════════════════════════════════════════════════════════
// BUNDLE OUTPUT
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert workflow stages to a flat list of BundleAssemblySelection.
 * Maintains execution order from workflow stages.
 */
export function workflowToBundleSelections(
  stages: WorkflowStage[]
): BundleAssemblySelection[] {
  const selections: BundleAssemblySelection[] = [];
  const seen = new Set<string>();

  for (const stage of stages) {
    for (const assembly of stage.assemblies) {
      if (!seen.has(assembly.assemblyId)) {
        selections.push({
          assemblyId: assembly.assemblyId,
          assemblyName: assembly.assemblyName,
          assemblyCode: assembly.assemblyCode,
          category: assembly.category,
          trade: assembly.trade,
          quantity: assembly.quantity,
        });
        seen.add(assembly.assemblyId);
      }
    }
  }

  return selections;
}

/**
 * Flatten workflow stages into an ordered list of assemblies.
 */
export function flattenWorkflow(stages: WorkflowStage[]): WorkflowAssemblyRef[] {
  const flat: WorkflowAssemblyRef[] = [];
  for (const stage of stages) {
    flat.push(...stage.assemblies);
  }
  return flat;
}

// ══════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate a remodel workflow from a scope draft.
 *
 * Pipeline:
 *   1. Extract context from scope draft metadata
 *   2. Match remodel templates
 *   3. Merge scope assemblies with template defaults
 *   4. Organize into workflow stages
 *   5. Convert to bundle-ready output
 *
 * This function is the SINGLE ENTRY POINT for the Remodel Engine.
 * It does NOT modify pricing, scope rules, or geographic modifiers.
 */
export function generateRemodelWorkflow(
  scopeDraft: ScopeDraftOutput,
  templates: RemodelTemplateData[],
  assemblyLookup: Map<string, { code: string; name: string; category: string; trade: string | null; unit: string }>
): RemodelWorkflowOutput {
  const warnings: string[] = [];

  // 1. Extract context
  const context: RemodelContext = {
    serviceType: scopeDraft.metadata.intakeServiceType,
    finishLevel: scopeDraft.metadata.intakeFinishLevel || "standard",
    zone: scopeDraft.metadata.projectZone !== "unknown" ? scopeDraft.metadata.projectZone : null,
  };

  // 2. Collect scope rule codes from draft items
  const scopeRuleCodes = new Set<string>();
  for (const item of scopeDraft.items) {
    if (item.ruleCode) {
      scopeRuleCodes.add(item.ruleCode);
    }
  }

  // 3. Match templates
  const matchResults = matchTemplates(templates, context, scopeRuleCodes);
  const bestMatch = matchResults.length > 0 ? matchResults[0] : null;

  if (!bestMatch) {
    warnings.push(
      `No remodel template matched for service_type='${context.serviceType}', finish_level='${context.finishLevel}'. Using heuristic workflow ordering.`
    );
  }

  // 4. Merge assemblies
  const mergedAssemblies = mergeAssemblies(
    scopeDraft.items,
    bestMatch?.template ?? null,
    assemblyLookup
  );

  // Count template defaults added
  const defaultAssembliesAdded = mergedAssemblies.filter(
    a => a.source === "template_default"
  ).length;

  if (defaultAssembliesAdded > 0) {
    warnings.push(
      `Added ${defaultAssembliesAdded} default assembly(ies) from template '${bestMatch?.template.name}'.`
    );
  }

  // 5. Organize into workflow
  const stages = organizeIntoWorkflow(
    mergedAssemblies,
    bestMatch?.template ?? null
  );

  if (stages.length === 0) {
    warnings.push("No workflow stages generated. Scope draft may be empty.");
  }

  // 6. Convert to bundle selections
  const bundleSelections = workflowToBundleSelections(stages);
  const orderedAssemblies = flattenWorkflow(stages);

  // 7. Build output
  return {
    templateId: bestMatch?.template.id?.toString() ?? null,
    templateName: bestMatch?.template.name ?? null,
    stages,
    orderedAssemblies,
    bundleSelections,
    warnings,
    metadata: {
      serviceType: context.serviceType,
      finishLevel: context.finishLevel,
      templatesEvaluated: templates.length,
      templatesMatched: matchResults.length,
      scopeItemsProcessed: scopeDraft.items.length,
      defaultAssembliesAdded,
      workflowStageCount: stages.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Preview a remodel workflow without persisting.
 * Same as generateRemodelWorkflow but returns additional diagnostic info.
 */
export function previewRemodelWorkflow(
  scopeDraft: ScopeDraftOutput,
  templates: RemodelTemplateData[],
  assemblyLookup: Map<string, { code: string; name: string; category: string; trade: string | null; unit: string }>
): RemodelWorkflowOutput & { templateMatches: TemplateMatchResult[] } {
  const context: RemodelContext = {
    serviceType: scopeDraft.metadata.intakeServiceType,
    finishLevel: scopeDraft.metadata.intakeFinishLevel || "standard",
    zone: scopeDraft.metadata.projectZone !== "unknown" ? scopeDraft.metadata.projectZone : null,
  };

  const scopeRuleCodes = new Set<string>();
  for (const item of scopeDraft.items) {
    if (item.ruleCode) {
      scopeRuleCodes.add(item.ruleCode);
    }
  }

  const templateMatches = templates.map(t => matchTemplate(t, context, scopeRuleCodes));
  const workflow = generateRemodelWorkflow(scopeDraft, templates, assemblyLookup);

  return {
    ...workflow,
    templateMatches,
  };
}
