/**
 * structr.ai Construction Brain — Workflow Visualization Router
 * Sprint 17: Remodel Workflow Visualization
 *
 * Dedicated read-only router for the workflow visualization workspace.
 * Aggregates data from:
 *   - Remodel Engine (previewWorkflow)
 *   - Geographic Override (getOverrideLog)
 *   - Scope Draft (getScopeDraftWithItems)
 *   - Project (getProjectById)
 *
 * NON-NEGOTIABLE:
 *   - Does NOT introduce new business logic
 *   - Does NOT alter Remodel Engine behavior
 *   - Does NOT reconstruct workflow logic
 *   - Read-only — no mutations
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getScopeDraftWithItems, listScopeDraftsForProject } from "./scope-db";
import { getProjectById } from "./project-db";
import { getOverrideLogForDraft } from "./geo-override-db";
import { listRemodelTemplates } from "./remodel-db";
import { listAssemblies } from "./assembly-db";
import {
  generateRemodelWorkflow,
  type RemodelTemplateData,
  type WorkflowStage,
  type WorkflowAssemblyRef,
  type RemodelWorkflowOutput,
} from "@shared/remodel-engine";
import type { ScopeItem, ScopeDraftOutput } from "@shared/scope-engine";
import {
  resolveOverrides,
  type OverrideRule,
  type ResolverInputItem,
  type AssemblyLookupEntry,
  type PreviousOverrideEntry,
} from "@shared/geo-override-engine";
import { listOverrideRules } from "./geo-override-db";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Override info for a single assembly in the visualization */
export interface AssemblyOverrideInfo {
  originalAssemblyId: number;
  replacementAssemblyId: number;
  overrideType: string;
  overrideReason: string;
  zone: string;
}

/** Enriched stage for visualization */
export interface VisualizationStage {
  order: number;
  code: string;
  label: string;
  assemblies: VisualizationAssembly[];
  estimatedDuration?: string;
}

/** Enriched assembly for visualization */
export interface VisualizationAssembly {
  assemblyId: string;
  assemblyCode: string;
  assemblyName: string;
  category: string;
  trade: string | null;
  quantity: number;
  unit: string;
  source: string;
  ruleCode?: string;
  override: AssemblyOverrideInfo | null;
}

/** Complete visualization workspace data */
export interface WorkflowVisualizationData {
  project: {
    id: number;
    name: string;
    zone: string | null;
    channel: string | null;
    geocodeConfidence: string | null;
  };
  scopeDraft: {
    id: number;
    status: string;
    confidenceScore: string | null;
    itemCount: number;
  };
  workflow: {
    templateId: number | null;
    templateName: string | null;
    stages: VisualizationStage[];
    totalAssemblies: number;
    stageCount: number;
    metadata: RemodelWorkflowOutput["metadata"];
  };
  warnings: string[];
  overrideSummary: {
    hasOverrides: boolean;
    totalOverrides: number;
    swapCount: number;
    addCount: number;
    warningCount: number;
  };
}

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const workflowVisualizationRouter = router({

  // ────────────────────────────────────────────────────────────────────
  // 1. LOAD VISUALIZATION — single call to hydrate the entire workspace
  // ────────────────────────────────────────────────────────────────────
  loadVisualization: protectedProcedure
    .input(z.object({
      scopeDraftId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      // 1. Load scope draft with items
      const draftData = await getScopeDraftWithItems(input.scopeDraftId);
      if (!draftData) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }
      const { draft, items: draftItems } = draftData;

      // 2. Load project
      const project = await getProjectById(draft.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      // 3. Build assembly lookup
      const assemblyLookup = await buildAssemblyLookup();

      // 4. Build ScopeDraftOutput from DB records
      let scopeDraftOutput = buildScopeDraftOutput(draft, draftItems, assemblyLookup);

      // 5. Load override log for cross-reference
      const overrideLog = await getOverrideLogForDraft(input.scopeDraftId);

      // Build override map: replacementAssemblyId → override info
      const overrideMap = new Map<number, AssemblyOverrideInfo>();
      for (const entry of overrideLog) {
        overrideMap.set(entry.replacementAssemblyId, {
          originalAssemblyId: entry.originalAssemblyId,
          replacementAssemblyId: entry.replacementAssemblyId,
          overrideType: entry.overrideType,
          overrideReason: entry.overrideReason,
          zone: entry.zone,
        });
        // Also map original → override for swap visibility
        if (entry.overrideType === "swap") {
          overrideMap.set(entry.originalAssemblyId, {
            originalAssemblyId: entry.originalAssemblyId,
            replacementAssemblyId: entry.replacementAssemblyId,
            overrideType: entry.overrideType,
            overrideReason: entry.overrideReason,
            zone: entry.zone,
          });
        }
      }

      // 6. Apply geographic overrides to scope (same as remodel-router)
      const projectZone = project.zone ?? "";
      let overrideWarnings: string[] = [];
      let overrideStats = { swapsApplied: 0, additionsApplied: 0, warningsGenerated: 0, skippedAlreadyApplied: 0 };

      if (projectZone && projectZone !== "unknown") {
        const rules = await listOverrideRules({ activeOnly: true });
        const engineRules: OverrideRule[] = rules.map((r) => ({
          id: r.id, zone: r.zone, trade: r.trade, finishLevel: r.finishLevel,
          originalAssemblyId: r.originalAssemblyId, replacementAssemblyId: r.replacementAssemblyId,
          overrideType: r.overrideType, reasonTemplate: r.reasonTemplate, active: r.active,
        }));

        const previousLog = overrideLog;
        const previouslyApplied: PreviousOverrideEntry[] = previousLog.map((e) => ({
          scopeDraftId: e.scopeDraftId, originalAssemblyId: e.originalAssemblyId,
          replacementAssemblyId: e.replacementAssemblyId, overrideType: e.overrideType,
        }));

        const engineLookup = new Map<number, AssemblyLookupEntry>();
        assemblyLookup.forEach((val, key) => {
          engineLookup.set(key, { id: key, name: val.name, code: val.code, trade: val.trade ?? null });
        });

        const resolverItems: ResolverInputItem[] = scopeDraftOutput.items.map((item) => ({
          assemblyId: item.assemblyId, assemblyName: item.assemblyName,
          trade: item.trade, finishLevel: null,
          quantity: item.quantity, unit: item.unit,
          reason: item.reason, confidence: item.confidence,
          sortOrder: item.sortOrder,
        }));

        const overrideResult = resolveOverrides(resolverItems, projectZone, engineRules, engineLookup, previouslyApplied);

        if (overrideResult.hasOverrides) {
          scopeDraftOutput = {
            ...scopeDraftOutput,
            items: overrideResult.resolvedItems.map((ri) => ({
              assemblyId: ri.assemblyId,
              assemblyCode: assemblyLookup.get(ri.assemblyId)?.code ?? "",
              assemblyName: ri.assemblyName,
              category: assemblyLookup.get(ri.assemblyId)?.category ?? "",
              trade: ri.trade,
              quantity: ri.quantity,
              unit: ri.unit,
              reason: ri.overrideReason ?? ri.reason,
              ruleCode: "",
              confidence: ri.confidence,
              sortOrder: ri.sortOrder,
            })),
            warnings: [
              ...scopeDraftOutput.warnings,
              ...overrideResult.warnings,
            ],
          };
        }

        overrideWarnings = overrideResult.warnings;
        overrideStats = {
          swapsApplied: overrideResult.stats.swapsApplied,
          additionsApplied: overrideResult.stats.additionsApplied,
          warningsGenerated: overrideResult.stats.warningsGenerated,
          skippedAlreadyApplied: overrideResult.stats.skippedAlreadyApplied,
        };
      }

      // 7. Load remodel templates
      const templates = await listRemodelTemplates({ activeOnly: true });
      const templateData: RemodelTemplateData[] = templates.map(mapTemplateToEngineData);

      // 8. Generate workflow
      const workflow = generateRemodelWorkflow(scopeDraftOutput, templateData, assemblyLookup);

      // 9. Enrich stages with override info
      const enrichedStages: VisualizationStage[] = workflow.stages.map(stage => ({
        order: stage.order,
        code: stage.code,
        label: stage.label,
        estimatedDuration: stage.estimatedDuration,
        assemblies: stage.assemblies.map(a => ({
          assemblyId: a.assemblyId,
          assemblyCode: a.assemblyCode,
          assemblyName: a.assemblyName,
          category: a.category,
          trade: a.trade,
          quantity: a.quantity,
          unit: a.unit,
          source: a.source,
          ruleCode: a.ruleCode,
          override: overrideMap.get(a.assemblyId) ?? null,
        })),
      }));

      // 10. Collect all warnings
      const allWarnings = [
        ...workflow.warnings,
        ...overrideWarnings,
      ];

      // 11. Build response
      const result: WorkflowVisualizationData = {
        project: {
          id: project.id,
          name: project.name,
          zone: project.zone,
          channel: project.channel,
          geocodeConfidence: project.geocodeConfidence,
        },
        scopeDraft: {
          id: draft.id,
          status: draft.status,
          confidenceScore: draft.confidence,
          itemCount: draftItems.length,
        },
        workflow: {
          templateId: workflow.templateId,
          templateName: workflow.templateName,
          stages: enrichedStages,
          totalAssemblies: workflow.orderedAssemblies.length,
          stageCount: enrichedStages.length,
          metadata: workflow.metadata,
        },
        warnings: allWarnings,
        overrideSummary: {
          hasOverrides: overrideLog.length > 0 || overrideStats.swapsApplied > 0 || overrideStats.additionsApplied > 0,
          totalOverrides: overrideLog.length,
          swapCount: overrideStats.swapsApplied,
          addCount: overrideStats.additionsApplied,
          warningCount: overrideStats.warningsGenerated,
        },
      };

      return result;
    }),

  // ────────────────────────────────────────────────────────────────────
  // 2. LIST AVAILABLE DRAFTS — for the draft selector
  // ────────────────────────────────────────────────────────────────────
  listDraftsForProject: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const drafts = await listScopeDraftsForProject(input.projectId);
      return drafts.map(d => ({
        id: d.id,
        intakeFormId: d.intakeFormId,
        status: d.status,
        confidenceScore: d.confidence,
        createdAt: d.createdAt,
      }));
    }),
});

// ══════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════

function buildScopeDraftOutput(
  draft: any,
  items: any[],
  assemblyLookup: Map<number, { code: string; name: string; category: string; trade: string | null; unit: string }>
): ScopeDraftOutput {
  const warnings = Array.isArray(draft.warningsJson) ? draft.warningsJson : [];

  const scopeItems: ScopeItem[] = items.map(item => {
    const aRef = assemblyLookup.get(item.assemblyId);
    return {
      assemblyId: item.assemblyId,
      assemblyCode: aRef?.code ?? "",
      assemblyName: aRef?.name ?? "",
      category: aRef?.category ?? "",
      trade: aRef?.trade ?? null,
      quantity: Number(item.quantity) || 1,
      unit: item.unit ?? "EA",
      reason: item.reason ?? "",
      ruleCode: "",
      confidence: Number(item.confidence) || 0.5,
      sortOrder: item.sortOrder ?? 0,
    };
  });

  return {
    items: scopeItems,
    warnings,
    confidenceScore: Number(draft.confidence) || 0,
    metadata: {
      intakeServiceType: "",
      intakeFinishLevel: "standard",
      projectZone: "unknown",
      rulesEvaluated: 0,
      rulesMatched: scopeItems.length,
      assembliesSelected: scopeItems.length,
      generatedAt: draft.createdAt?.toISOString() ?? new Date().toISOString(),
    },
  };
}

function mapTemplateToEngineData(t: any): RemodelTemplateData {
  return {
    id: t.id,
    name: t.name,
    serviceType: t.serviceType,
    finishLevel: t.finishLevel,
    zone: t.zone,
    channel: t.channel,
    description: t.description,
    requiredScopeRules: t.requiredScopeRules ?? null,
    defaultAssemblies: t.defaultAssemblies ?? null,
    optionalAssemblies: t.optionalAssemblies ?? null,
    workflowSteps: t.workflowSteps ?? null,
    typicalSqftRange: t.typicalSqftRange ?? null,
    estimatedDuration: t.estimatedDuration,
    isActive: t.isActive,
  };
}

async function buildAssemblyLookup(): Promise<
  Map<number, { code: string; name: string; category: string; trade: string | null; unit: string }>
> {
  const { items: dbAssemblies } = await listAssemblies({ activeOnly: true, limit: 2000 });
  const lookup = new Map<number, { code: string; name: string; category: string; trade: string | null; unit: string }>();

  for (const a of dbAssemblies) {
    lookup.set(a.id, {
      code: a.code,
      name: a.name,
      category: a.category ?? "",
      trade: a.trade ?? null,
      unit: a.defaultUnit ?? "EA",
    });
  }

  return lookup;
}
