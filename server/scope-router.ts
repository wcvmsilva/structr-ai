/**
 * structr.ai — Scope Builder Router
 * Sprint 12: Deterministic Scope Generation
 *
 * tRPC procedures for:
 *   - Scope rule management (CRUD, seed)
 *   - Scope draft generation (intake → scope)
 *   - Scope draft lifecycle (review, approve, convert)
 *   - Bundle conversion (scope → bundle)
 *
 * All mutations require admin role.
 * Scope generation requires authentication.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createScopeRule,
  getScopeRuleById,
  getScopeRuleByCode,
  listScopeRules,
  loadActiveRulesForEngine,
  updateScopeRule,
  deactivateScopeRule,
  reactivateScopeRule,
  getScopeRuleStats,
  createScopeDraft,
  getScopeDraftById,
  listScopeDraftsForProject,
  updateScopeDraftStatus,
  addScopeDraftItems,
  getScopeDraftItems,
  removeScopeDraftItem,
  clearScopeDraftItems,
  getScopeDraftWithItems,
  seedScopeRules,
} from "./scope-db";
import { getIntakeFormById } from "./intake-db";
import { normalizeServiceType, normalizeFinishLevel, normalizeCondition, normalizeChannel, normalizeProjectType } from "@shared/domain/normalization";
import { getProjectById } from "./project-db";
import { listAssemblies } from "./assembly-db";
import {
  generateScopeDraft,
  convertScopeToBundle,
  validateIntakeForScope,
  type ScopeRuleData,
  type ScopeIntakeData,
  type ScopeProjectContext,
  type ScopeAssemblyRef,
} from "@shared/scope-engine";
import { ALL_SCOPE_RULES, type ScopeRuleSeed } from "@shared/scope-rules-seed";

// ══════════════════════════════════════════════════════════════════════
// SCOPE ROUTER
// ══════════════════════════════════════════════════════════════════════

export const scopeRouter = router({
  // ══════════════════════════════════════════════════════════════════
  // SCOPE RULES — CRUD
  // ══════════════════════════════════════════════════════════════════

  /** List scope rules with optional filters */
  listRules: protectedProcedure
    .input(z.object({
      serviceType: z.string().optional(),
      finishLevel: z.string().optional(),
      zone: z.string().optional(),
      channel: z.string().optional(),
      activeOnly: z.boolean().optional().default(true),
    }).optional())
    .query(async ({ input }) => {
      return await listScopeRules({
        serviceType: input?.serviceType,
        finishLevel: input?.finishLevel,
        zone: input?.zone,
        channel: input?.channel,
        activeOnly: input?.activeOnly,
      });
    }),

  /** Get a scope rule by ID */
  getRuleById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rule = await getScopeRuleById(input.id);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Scope rule not found" });
      return rule;
    }),

  /** Get a scope rule by code */
  getRuleByCode: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      const rule = await getScopeRuleByCode(input.code);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Scope rule not found" });
      return rule;
    }),

  /** Create a new scope rule (admin only) */
  createRule: adminProcedure
    .input(z.object({
      ruleCode: z.string().min(1).max(80),
      serviceType: z.string().min(1).max(128),
      projectType: z.enum([
        "remodel", "new_construction", "repair", "insurance_restoration",
        "commercial_buildout", "addition", "exterior"
      ]).optional().nullable(),
      channel: z.enum(["direct", "insurance", "commercial"]).optional().nullable(),
      zone: z.string().max(128).optional().nullable(),
      finishLevel: z.enum(["standard", "premium", "luxury"]).optional().nullable(),
      conditionJson: z.array(z.object({
        field: z.string(),
        op: z.enum(["eq", "neq", "in", "gte", "lte", "contains"]),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      })).optional().nullable(),
      assemblyId: z.number().int().positive(),
      quantityFormula: z.string().min(1).max(255),
      reasonTemplate: z.string().min(1).max(512),
      priority: z.number().int().min(1).max(999).optional().default(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const rule = await createScopeRule(input, ctx.user.id);
      if (!rule) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create scope rule" });
      return rule;
    }),

  /** Update a scope rule (admin only) */
  updateRule: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      serviceType: z.string().min(1).max(128).optional(),
      projectType: z.enum([
        "remodel", "new_construction", "repair", "insurance_restoration",
        "commercial_buildout", "addition", "exterior"
      ]).optional().nullable(),
      channel: z.enum(["direct", "insurance", "commercial"]).optional().nullable(),
      zone: z.string().max(128).optional().nullable(),
      finishLevel: z.enum(["standard", "premium", "luxury"]).optional().nullable(),
      conditionJson: z.array(z.object({
        field: z.string(),
        op: z.enum(["eq", "neq", "in", "gte", "lte", "contains"]),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      })).optional().nullable(),
      assemblyId: z.number().int().positive().optional(),
      quantityFormula: z.string().min(1).max(255).optional(),
      reasonTemplate: z.string().min(1).max(512).optional(),
      priority: z.number().int().min(1).max(999).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const rule = await updateScopeRule(id, data, ctx.user.id);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Scope rule not found" });
      return rule;
    }),

  /** Deactivate a scope rule (admin only) */
  deactivateRule: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const success = await deactivateScopeRule(input.id, ctx.user.id);
      if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Scope rule not found" });
      return { success: true };
    }),

  /** Reactivate a scope rule (admin only) */
  reactivateRule: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const success = await reactivateScopeRule(input.id, ctx.user.id);
      if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Scope rule not found" });
      return { success: true };
    }),

  /** Get scope rule statistics */
  ruleStats: protectedProcedure.query(async () => {
    return await getScopeRuleStats();
  }),

  /** Seed scope rules from the built-in rule set (admin only) */
  seedRules: adminProcedure.mutation(async ({ ctx }) => {
    const created = await seedScopeRules(ALL_SCOPE_RULES as any[], ctx.user.id);
    return { created, total: ALL_SCOPE_RULES.length };
  }),

  // ══════════════════════════════════════════════════════════════════
  // SCOPE GENERATION — The Core Pipeline
  // ══════════════════════════════════════════════════════════════════

  /**
   * Generate a scope draft from an intake form.
   *
   * Pipeline:
   *   1. Load intake form data
   *   2. Load project context (zone, channel)
   *   3. Load active scope rules
   *   4. Load assembly library
   *   5. Run deterministic scope engine
   *   6. Persist scope draft + items
   *   7. Return ScopeDraftOutput
   */
  generate: protectedProcedure
    .input(z.object({
      intakeFormId: z.number().int().positive(),
      projectId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Load intake form
      const intake = await getIntakeFormById(input.intakeFormId);
      if (!intake) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Intake form not found" });
      }

      // 2. Load project context
      const project = await getProjectById(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      // 3. Load active scope rules
      const dbRules = await loadActiveRulesForEngine();
      const rules: ScopeRuleData[] = dbRules.map(r => ({
        id: r.id,
        ruleCode: r.ruleCode,
        serviceType: r.serviceType,
        projectType: r.projectType,
        channel: r.channel,
        zone: r.zone,
        finishLevel: r.finishLevel,
        conditionJson: r.conditionJson,
        assemblyId: r.assemblyId,
        quantityFormula: r.quantityFormula,
        reasonTemplate: r.reasonTemplate,
        priority: r.priority,
        active: r.active,
      }));

      // 4. Load assembly library
      const { items: dbAssemblies } = await listAssemblies({ activeOnly: true, limit: 1000 });
      const assemblies: ScopeAssemblyRef[] = dbAssemblies.map(a => ({
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category ?? "",
        trade: a.trade,
        finishLevel: a.finishLevel,
        defaultUnit: a.defaultUnit ?? "EA",
        coastalModifier: a.coastalModifier,
      }));

      // 5. Build intake data for engine (Sprint 18: normalize at boundary)
      const intakeData: ScopeIntakeData = {
        serviceType: normalizeServiceType(intake.serviceType) ?? intake.serviceType ?? "",
        area: intake.area,
        finishLevel: normalizeFinishLevel(intake.finishLevel) ?? intake.finishLevel,
        condition: normalizeCondition(intake.condition) ?? intake.condition,
        channel: normalizeChannel(intake.channel) ?? intake.channel,
        notes: intake.notes,
      };

      // 6. Build project context for engine
      const zoneSnapshot = project.zoneModifierSnapshot
        ? (typeof project.zoneModifierSnapshot === "string"
            ? JSON.parse(project.zoneModifierSnapshot)
            : project.zoneModifierSnapshot)
        : null;

      const projectContext: ScopeProjectContext = {
        projectType: project.projectType,
        zone: project.zone,
        zipCode: project.zipCode,
        channel: project.channel,
        zoneModifierSnapshot: zoneSnapshot,
      };

      // 7. Run the deterministic scope engine
      const draftOutput = generateScopeDraft(intakeData, projectContext, rules, assemblies);

      // 8. Persist scope draft
      const draft = await createScopeDraft({
        projectId: input.projectId,
        intakeFormId: input.intakeFormId,
        status: "draft",
        confidenceScore: String(draftOutput.confidenceScore),
        warningsJson: draftOutput.warnings,
        createdBy: ctx.user.id,
      }, ctx.user.id);

      if (!draft) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create scope draft" });
      }

      // 9. Persist scope draft items
      if (draftOutput.items.length > 0) {
        const itemsToInsert = draftOutput.items.map(item => ({
          scopeDraftId: draft.id,
          assemblyId: item.assemblyId,
          quantity: String(item.quantity),
          unit: item.unit,
          reason: item.reason,
          confidence: String(item.confidence),
          sortOrder: item.sortOrder,
        }));
        await addScopeDraftItems(itemsToInsert);
      }

      return {
        draftId: draft.id,
        ...draftOutput,
      };
    }),

  /**
   * Preview scope generation without persisting.
   * Useful for "what-if" analysis before committing.
   */
  preview: protectedProcedure
    .input(z.object({
      serviceType: z.string().min(1),
      area: z.string().optional().nullable(),
      finishLevel: z.enum(["standard", "premium", "luxury"]).optional().nullable(),
      condition: z.string().optional().nullable(),
      channel: z.enum(["direct", "insurance", "commercial"]).optional().nullable(),
      projectType: z.enum([
        "remodel", "new_construction", "repair", "insurance_restoration",
        "commercial_buildout", "addition", "exterior"
      ]).optional().nullable(),
      zone: z.string().optional().nullable(),
      zipCode: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      // Load active rules
      const dbRules = await loadActiveRulesForEngine();
      const rules: ScopeRuleData[] = dbRules.map(r => ({
        id: r.id,
        ruleCode: r.ruleCode,
        serviceType: r.serviceType,
        projectType: r.projectType,
        channel: r.channel,
        zone: r.zone,
        finishLevel: r.finishLevel,
        conditionJson: r.conditionJson,
        assemblyId: r.assemblyId,
        quantityFormula: r.quantityFormula,
        reasonTemplate: r.reasonTemplate,
        priority: r.priority,
        active: r.active,
      }));

      // Load assembly library
      const { items: dbAssemblies } = await listAssemblies({ activeOnly: true, limit: 1000 });
      const assemblies: ScopeAssemblyRef[] = dbAssemblies.map(a => ({
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category ?? "",
        trade: a.trade,
        finishLevel: a.finishLevel,
        defaultUnit: a.defaultUnit ?? "EA",
        coastalModifier: a.coastalModifier,
      }));

      // Build intake data (Sprint 18: normalize at boundary)
      const intakeData: ScopeIntakeData = {
        serviceType: normalizeServiceType(input.serviceType) ?? input.serviceType,
        area: input.area,
        finishLevel: normalizeFinishLevel(input.finishLevel) ?? input.finishLevel,
        condition: normalizeCondition(input.condition) ?? input.condition,
        channel: normalizeChannel(input.channel) ?? input.channel,
      };

      // Build project context (Sprint 18: normalize at boundary)
      const projectContext: ScopeProjectContext = {
        projectType: normalizeProjectType(input.projectType) ?? input.projectType,
        zone: input.zone,
        zipCode: input.zipCode,
        channel: normalizeChannel(input.channel) ?? input.channel,
      };

      // Run engine (no persistence)
      return generateScopeDraft(intakeData, projectContext, rules, assemblies);
    }),

  // ══════════════════════════════════════════════════════════════════
  // SCOPE DRAFTS — LIFECYCLE
  // ══════════════════════════════════════════════════════════════════

  /** Get a scope draft with items */
  getDraft: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const result = await getScopeDraftWithItems(input.id);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      return result;
    }),

  /** List scope drafts for a project */
  listDrafts: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return await listScopeDraftsForProject(input.projectId);
    }),

  /** Update scope draft status */
  updateDraftStatus: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["draft", "under_review", "approved", "rejected", "converted"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const draft = await updateScopeDraftStatus(input.id, input.status, ctx.user.id);
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      return draft;
    }),

  /** Remove a single item from a scope draft */
  removeDraftItem: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const success = await removeScopeDraftItem(input.id, ctx.user.id);
      if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft item not found" });
      return { success: true };
    }),

  /** Regenerate a scope draft (clear items and re-run engine) */
  regenerate: protectedProcedure
    .input(z.object({
      draftId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Get existing draft
      const existing = await getScopeDraftById(input.draftId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });

      // Clear existing items
      await clearScopeDraftItems(input.draftId, ctx.user.id);

      // Load intake form
      const intake = await getIntakeFormById(existing.intakeFormId);
      if (!intake) throw new TRPCError({ code: "NOT_FOUND", message: "Intake form not found" });

      // Load project
      const project = await getProjectById(existing.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      // Load rules and assemblies
      const dbRules = await loadActiveRulesForEngine();
      const rules: ScopeRuleData[] = dbRules.map(r => ({
        id: r.id,
        ruleCode: r.ruleCode,
        serviceType: r.serviceType,
        projectType: r.projectType,
        channel: r.channel,
        zone: r.zone,
        finishLevel: r.finishLevel,
        conditionJson: r.conditionJson,
        assemblyId: r.assemblyId,
        quantityFormula: r.quantityFormula,
        reasonTemplate: r.reasonTemplate,
        priority: r.priority,
        active: r.active,
      }));

      const { items: dbAssemblies } = await listAssemblies({ activeOnly: true, limit: 1000 });
      const assemblies: ScopeAssemblyRef[] = dbAssemblies.map(a => ({
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category ?? "",
        trade: a.trade,
        finishLevel: a.finishLevel,
        defaultUnit: a.defaultUnit ?? "EA",
        coastalModifier: a.coastalModifier,
      }));

      const intakeData: ScopeIntakeData = {
        serviceType: intake.serviceType ?? "",
        area: intake.area,
        finishLevel: intake.finishLevel,
        condition: intake.condition,
        channel: intake.channel,
        notes: intake.notes,
      };

      const zoneSnapshot = project.zoneModifierSnapshot
        ? (typeof project.zoneModifierSnapshot === "string"
            ? JSON.parse(project.zoneModifierSnapshot)
            : project.zoneModifierSnapshot)
        : null;

      const projectContext: ScopeProjectContext = {
        projectType: project.projectType,
        zone: project.zone,
        zipCode: project.zipCode,
        channel: project.channel,
        zoneModifierSnapshot: zoneSnapshot,
      };

      // Re-run engine
      const draftOutput = generateScopeDraft(intakeData, projectContext, rules, assemblies);

      // Update draft metadata
      await updateScopeDraftStatus(input.draftId, "draft", ctx.user.id);

      // Persist new items
      if (draftOutput.items.length > 0) {
        const itemsToInsert = draftOutput.items.map(item => ({
          scopeDraftId: input.draftId,
          assemblyId: item.assemblyId,
          quantity: String(item.quantity),
          unit: item.unit,
          reason: item.reason,
          confidence: String(item.confidence),
          sortOrder: item.sortOrder,
        }));
        await addScopeDraftItems(itemsToInsert);
      }

      return {
        draftId: input.draftId,
        ...draftOutput,
      };
    }),

  // ══════════════════════════════════════════════════════════════════
  // BUNDLE CONVERSION
  // ══════════════════════════════════════════════════════════════════

  /** Convert a scope draft to bundle-ready assembly selections */
  convertToBundle: protectedProcedure
    .input(z.object({ draftId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const result = await getScopeDraftWithItems(input.draftId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });

      // Build a minimal ScopeDraftOutput for conversion
      const draftOutput = {
        items: result.items.map((item, idx) => ({
          assemblyId: item.assemblyId,
          assemblyCode: "", // Will be enriched below
          assemblyName: "",
          category: "",
          trade: null as string | null,
          quantity: parseFloat(item.quantity),
          unit: item.unit,
          reason: item.reason,
          confidence: parseFloat(item.confidence),
          ruleCode: "",
          sortOrder: item.sortOrder,
        })),
        warnings: result.draft.warningsJson ?? [],
        confidenceScore: parseFloat(result.draft.confidenceScore ?? "0"),
        metadata: {
          rulesEvaluated: 0,
          rulesMatched: 0,
          assembliesSelected: result.items.length,
          intakeServiceType: "",
          intakeFinishLevel: "",
          projectZone: "",
          generatedAt: new Date().toISOString(),
        },
      };

      // Enrich with assembly data
      const { items: dbAssemblies } = await listAssemblies({ activeOnly: true, limit: 1000 });
      const assemblyMap = new Map(dbAssemblies.map(a => [a.id, a]));

      for (const item of draftOutput.items) {
        const assembly = assemblyMap.get(item.assemblyId);
        if (assembly) {
          item.assemblyCode = assembly.code;
          item.assemblyName = assembly.name;
          item.category = assembly.category ?? "";
          item.trade = assembly.trade;
        }
      }

      const bundleSelections = convertScopeToBundle(draftOutput);

      // Mark draft as converted
      await updateScopeDraftStatus(input.draftId, "converted", ctx.user.id);

      return {
        bundleSelections,
        draftId: input.draftId,
        itemCount: bundleSelections.length,
      };
    }),

  // ══════════════════════════════════════════════════════════════════
  // VALIDATION
  // ══════════════════════════════════════════════════════════════════

  /** Validate intake data for scope generation (preview warnings) */
  validateIntake: protectedProcedure
    .input(z.object({
      serviceType: z.string().optional().nullable(),
      area: z.string().optional().nullable(),
      finishLevel: z.string().optional().nullable(),
      condition: z.string().optional().nullable(),
      channel: z.string().optional().nullable(),
    }))
    .query(({ input }) => {
      // Sprint 18: normalize at boundary
      const warnings = validateIntakeForScope({
        serviceType: normalizeServiceType(input.serviceType) ?? input.serviceType ?? "",
        area: input.area,
        finishLevel: normalizeFinishLevel(input.finishLevel) ?? input.finishLevel,
        condition: normalizeCondition(input.condition) ?? input.condition,
        channel: normalizeChannel(input.channel) ?? input.channel,
      });
      return { warnings, isValid: warnings.length === 0 };
    }),
});
