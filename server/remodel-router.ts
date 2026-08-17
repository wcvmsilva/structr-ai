/**
 * structr.ai — Remodel Engine Router
 * Sprint 13: Remodel Workflow Coordinator
 *
 * tRPC procedures for:
 *   - Remodel template management (CRUD, seed)
 *   - Remodel workflow generation (scope draft → workflow → bundle)
 *   - Workflow preview (diagnostic mode)
 *
 * All template mutations require admin role.
 * Workflow generation requires authentication.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { normalizeServiceType, normalizeFinishLevel, normalizeChannel } from "@shared/domain/normalization";
import {
  createRemodelTemplate,
  getRemodelTemplateById,
  listRemodelTemplates,
  updateRemodelTemplate,
  deactivateRemodelTemplate,
  reactivateRemodelTemplate,
  seedRemodelTemplates,
  getRemodelTemplateCountByServiceType,
} from "./remodel-db";
import { getScopeDraftWithItems } from "./scope-db";
import { listAssemblies } from "./assembly-db";
import {
  generateRemodelWorkflow,
  previewRemodelWorkflow,
  type RemodelTemplateData,
} from "@shared/remodel-engine";
import type { ScopeItem, ScopeDraftOutput } from "@shared/scope-engine";
import { ALL_REMODEL_TEMPLATES } from "@shared/remodel-templates-seed";
import { getProjectById } from "./project-db";
import { listOverrideRules, getOverrideLogForDraft, writeOverrideLogEntries } from "./geo-override-db";
import {
  resolveOverrides,
  type OverrideRule,
  type ResolverInputItem,
  type AssemblyLookupEntry,
  type PreviousOverrideEntry,
} from "@shared/geo-override-engine";
import { logAudit } from "./audit";
import { requireEntityAccess } from "./project-access";

// ══════════════════════════════════════════════════════════════════════
// REMODEL ROUTER
// ══════════════════════════════════════════════════════════════════════

export const remodelRouter = router({

  // ══════════════════════════════════════════════════════════════════
  // REMODEL TEMPLATES — CRUD
  // ══════════════════════════════════════════════════════════════════

  /** List all remodel templates (optionally filtered) */
  listTemplates: protectedProcedure
    .input(z.object({
      serviceType: z.string().optional(),
      finishLevel: z.string().optional(),
      activeOnly: z.boolean().optional().default(true),
    }).optional())
    .query(async ({ input }) => {
      return listRemodelTemplates(input ?? {});
    }),

  /** Get a single remodel template by ID */
  getTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const template = await getRemodelTemplateById(input.id);
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Remodel template not found" });
      }
      return template;
    }),

  /** Get template counts by service type */
  templateStats: protectedProcedure
    .query(async () => {
      return getRemodelTemplateCountByServiceType();
    }),

  /** Create a new remodel template (admin only) */
  createTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      serviceType: z.enum([
        "kitchen_remodel", "bathroom_remodel", "roofing",
        "siding", "windows_doors", "deck_porch",
        "painting", "flooring", "exterior", "full_remodel",
      ]),
      finishLevel: z.enum(["standard", "premium", "luxury"]).optional(),
      zone: z.string().max(128).optional(),
      channel: z.enum(["direct", "insurance", "commercial"]).optional(),
      description: z.string().optional(),
      requiredScopeRules: z.array(z.object({
        ruleCode: z.string(),
        mandatory: z.boolean(),
      })).optional(),
      defaultAssemblies: z.array(z.string().uuid()).optional(),
      optionalAssemblies: z.array(z.string().uuid()).optional(),
      workflowSteps: z.array(z.object({
        order: z.number().int().positive(),
        code: z.string(),
        label: z.string(),
        assemblyIds: z.array(z.string().uuid()),
      })).optional(),
      typicalSqftRange: z.object({
        min: z.number().positive(),
        max: z.number().positive(),
      }).optional(),
      estimatedDuration: z.string().max(80).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const template = await createRemodelTemplate(
        {
          name: input.name,
          category: input.serviceType,
          serviceType: (normalizeServiceType(input.serviceType) ?? input.serviceType) as typeof input.serviceType,
          defaultFinishLevel: normalizeFinishLevel(input.finishLevel) ?? input.finishLevel ?? null,
          description: input.description ?? null,
          scopeJson: {
            zone: input.zone ?? null,
            channel: normalizeChannel(input.channel) ?? input.channel ?? null,
            requiredScopeRules: input.requiredScopeRules ?? null,
            defaultAssemblies: input.defaultAssemblies ?? null,
            optionalAssemblies: input.optionalAssemblies ?? null,
            workflowSteps: input.workflowSteps ?? null,
            typicalSqftRange: input.typicalSqftRange ?? null,
            estimatedDuration: input.estimatedDuration ?? null,
          },
        },
        ctx.user.id
      );
      if (!template) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create template" });
      }
      return template;
    }),

  /** Update a remodel template (admin only) */
  updateTemplate: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(255).optional(),
      finishLevel: z.enum(["standard", "premium", "luxury"]).nullable().optional(),
      zone: z.string().max(128).nullable().optional(),
      channel: z.enum(["direct", "insurance", "commercial"]).nullable().optional(),
      description: z.string().nullable().optional(),
      requiredScopeRules: z.array(z.object({
        ruleCode: z.string(),
        mandatory: z.boolean(),
      })).nullable().optional(),
      defaultAssemblies: z.array(z.string().uuid()).nullable().optional(),
      optionalAssemblies: z.array(z.string().uuid()).nullable().optional(),
      workflowSteps: z.array(z.object({
        order: z.number().int().positive(),
        code: z.string(),
        label: z.string(),
        assemblyIds: z.array(z.string().uuid()),
      })).nullable().optional(),
      typicalSqftRange: z.object({
        min: z.number().positive(),
        max: z.number().positive(),
      }).nullable().optional(),
      estimatedDuration: z.string().max(80).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const template = await updateRemodelTemplate(id, data, ctx.user.id);
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Remodel template not found" });
      }
      return template;
    }),

  /** Deactivate a remodel template (admin only) */
  deactivateTemplate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const template = await deactivateRemodelTemplate(input.id, ctx.user.id);
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Remodel template not found" });
      }
      return template;
    }),

  /** Reactivate a deactivated remodel template (admin only) */
  reactivateTemplate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const template = await reactivateRemodelTemplate(input.id, ctx.user.id);
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Remodel template not found" });
      }
      return template;
    }),

  /** Seed remodel templates from built-in seed data (admin only) */
  seedTemplates: adminProcedure
    .mutation(async ({ ctx }) => {
      type ServiceTypeEnum = "exterior" | "kitchen_remodel" | "bathroom_remodel" | "roofing" | "siding" | "windows_doors" | "deck_porch" | "painting" | "flooring" | "full_remodel";
      const seeds = ALL_REMODEL_TEMPLATES.map(t => ({
        name: t.name,
        category: t.serviceType,
        serviceType: t.serviceType as ServiceTypeEnum,
        defaultFinishLevel: ((t as any).finishLevel ?? null) as string | null,
        description: t.description ?? null,
        scopeJson: {
          zone: t.zone ?? null,
          channel: (t.channel ?? null) as string | null,
          requiredScopeRules: (t as any).requiredScopeRules ?? null,
          defaultAssemblies: (t as any).defaultAssemblies ?? null,
          optionalAssemblies: (t as any).optionalAssemblies ?? null,
          workflowSteps: (t as any).workflowSteps ?? null,
          typicalSqftRange: (t as any).typicalSqftRange ?? null,
          estimatedDuration: (t as any).estimatedDuration ?? null,
        },
      }));
      const results = await seedRemodelTemplates(seeds, ctx.user.id);
      return results;
    }),

  // ══════════════════════════════════════════════════════════════════
  // REMODEL WORKFLOW — GENERATION
  // ══════════════════════════════════════════════════════════════════

  /** Generate a remodel workflow from an approved scope draft */
  generateWorkflow: protectedProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "write");

      // 1. Load scope draft with items
      const draftData = await getScopeDraftWithItems(input.scopeDraftId);
      if (!draftData) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }
      const { draft, items: draftItems } = draftData;

      // 2. Build ScopeDraftOutput from DB records
      let scopeDraftOutput = buildScopeDraftOutput(draft, draftItems);

      // 3. Load assembly lookup
      const assemblyLookup = await buildAssemblyLookup();

      // ── Sprint 16: Geographic Override Resolution ──
      // Inject between scope draft load and remodel workflow generation.
      // If the project has a zone, resolve overrides and feed the resolved
      // scope into the remodel engine instead of the raw scope.
      let overrideResult = null;
      const project = await getProjectById(draft.projectId);
      const projectZone = project?.zone ?? "";

      if (projectZone && projectZone !== "unknown") {
        const rules = await listOverrideRules({ activeOnly: true });
        const engineRules: any[] = rules.map((r) => ({
          id: r.id, zone: r.zone, trade: r.trade, finishLevel: r.finishLevel,
          originalAssemblyId: r.originalAssemblyId, replacementAssemblyId: r.replacementAssemblyId,
          overrideType: r.overrideType, reasonTemplate: r.reasonTemplate, active: r.isActive,
        }));

        const previousLog = await getOverrideLogForDraft(input.scopeDraftId);
        const previouslyApplied: any[] = previousLog.map((e) => ({
          scopeDraftId: e.scopeDraftId, originalAssemblyId: e.originalAssemblyId,
          replacementAssemblyId: e.replacementAssemblyId, overrideType: e.overrideType,
        }));

        const engineLookup = new Map<string, AssemblyLookupEntry>();
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

        overrideResult = resolveOverrides(resolverItems, projectZone, engineRules, engineLookup, previouslyApplied);

        // If overrides were applied, rebuild the ScopeDraftOutput with resolved items
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
      }

      // 4. Load remodel templates
      const templates = await listRemodelTemplates({ activeOnly: true });
      const templateData: RemodelTemplateData[] = templates.map(mapTemplateToEngineData);

      // 5. Generate workflow (receives override-resolved scope)
      const workflow = generateRemodelWorkflow(scopeDraftOutput, templateData, assemblyLookup);

      return {
        ...workflow,
        overrideResult: overrideResult ? {
          hasOverrides: overrideResult.hasOverrides,
          stats: overrideResult.stats,
          warnings: overrideResult.warnings,
        } : null,
      };
    }),

  /** Preview a remodel workflow with diagnostic info (no persistence) */
  previewWorkflow: protectedProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
    }))
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "read");

      // 1. Load scope draft with items
      const draftData = await getScopeDraftWithItems(input.scopeDraftId);
      if (!draftData) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }
      const { draft, items: draftItems } = draftData;

      // 2. Build ScopeDraftOutput from DB records
      const scopeDraftOutput = buildScopeDraftOutput(draft, draftItems);

      // 3. Load remodel templates
      const templates = await listRemodelTemplates({ activeOnly: true });
      const templateData: RemodelTemplateData[] = templates.map(mapTemplateToEngineData);

      // 4. Load assembly lookup
      const assemblyLookup = await buildAssemblyLookup();

      // 5. Preview workflow
      const preview = previewRemodelWorkflow(scopeDraftOutput, templateData, assemblyLookup);

      return preview;
    }),
});

// ══════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Map a DB RemodelTemplate record to the engine's RemodelTemplateData interface.
 */
function mapTemplateToEngineData(t: NonNullable<Awaited<ReturnType<typeof getRemodelTemplateById>>>): RemodelTemplateData {
  const scope = (t.scopeJson ?? {}) as Record<string, any>;
  return {
    id: t.id,
    name: t.name,
    serviceType: t.serviceType ?? t.category,
    finishLevel: t.defaultFinishLevel ?? null,
    zone: scope.zone ?? null,
    channel: scope.channel ?? null,
    description: t.description,
    requiredScopeRules: scope.requiredScopeRules ?? null,
    defaultAssemblies: scope.defaultAssemblies ?? null,
    optionalAssemblies: scope.optionalAssemblies ?? null,
    workflowSteps: scope.workflowSteps ?? null,
    typicalSqftRange: scope.typicalSqftRange ?? null,
    estimatedDuration: scope.estimatedDuration ?? null,
    isActive: t.isActive,
  };
}

/**
 * Build a ScopeDraftOutput from DB draft + items records.
 * Reconstructs the structure expected by the Remodel Engine.
 *
 * Note: The scope_drafts table stores warnings in `warningsJson` and does NOT
 * have a `metadata` column. We reconstruct metadata from the draft's items
 * and the draft's own fields. The scope_draft_items table does NOT store
 * assemblyName or ruleCode — those are resolved from the assembly lookup.
 */
function buildScopeDraftOutput(
  draft: import("../drizzle/schema").ScopeDraft,
  items: import("../drizzle/schema").ScopeDraftItem[],
  assemblyLookup?: Map<string, { code: string; name: string; category: string; trade: string | null; unit: string }>
): ScopeDraftOutput {
  const warnings = Array.isArray(draft.warningsJson) ? draft.warningsJson : [];

  const scopeItems: any[] = items.map(item => {
    const aid = item.assemblyId ?? "";
    const aRef = assemblyLookup?.get(aid);
    return {
      assemblyId: aid,
      assemblyCode: aRef?.code ?? "",
      assemblyName: aRef?.name ?? "",
      category: aRef?.category ?? "",
      trade: aRef?.trade ?? null,
      quantity: Number(item.quantity) || 1,
      unit: item.unit ?? "EA",
      reason: item.reason ?? "",
      ruleCode: "", // Not stored in scope_draft_items; rule traceability is in the reason text
      confidence: Number(item.confidence) || 0.5,
      sortOrder: item.sortOrder ?? 0,
    };
  });

  return {
    items: scopeItems,
    warnings,
    confidenceScore: Number(draft.confidence) || 0,
    metadata: {
      intakeServiceType: "", // Will be resolved by the caller from intake form
      intakeFinishLevel: "standard",
      projectZone: "unknown",
      rulesEvaluated: 0,
      rulesMatched: scopeItems.length,
      assembliesSelected: scopeItems.length,
      generatedAt: draft.createdAt?.toISOString() ?? new Date().toISOString(),
    },
  };
}

/**
 * Build an assembly lookup map from the database.
 */
async function buildAssemblyLookup(): Promise<
  Map<string, { code: string; name: string; category: string; trade: string | null; unit: string }>
> {
  const { items: dbAssemblies } = await listAssemblies({ activeOnly: true, limit: 2000 });
  const lookup = new Map<string, { code: string; name: string; category: string; trade: string | null; unit: string }>();

  for (const a of dbAssemblies) {
    lookup.set(a.id, {
      code: a.code ?? "",
      name: a.name,
      category: a.category ?? "",
      trade: a.trade ?? null,
      unit: a.defaultUnitId ?? "EA",
    });
  }

  return lookup;
}
