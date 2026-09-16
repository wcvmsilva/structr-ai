/**
 * structr.ai Construction Brain — Geographic Override Router
 * Sprint 16: Coastal Override Resolver
 *
 * tRPC procedures for:
 *   - Override rule management (CRUD, activate/deactivate)
 *   - Override resolution (resolve overrides for a scope draft)
 *   - Override log queries (audit trail per scope draft)
 *   - Override statistics
 *
 * All rule mutations require admin role.
 * Resolution requires authentication.
 */

import { z } from "zod";
import { router, tenantProcedure, adminTenantProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { normalizeTrade, normalizeFinishLevel } from "@shared/domain/normalization";
import {
  listOverrideRules,
  getOverrideRuleById,
  createOverrideRule,
  updateOverrideRule,
  deactivateOverrideRule,
  reactivateOverrideRule,
  getOverrideLogForDraft,
  writeOverrideLogEntries,
  hasOverridesApplied,
  clearOverrideLogForDraft,
  getOverrideCountsByZone,
  type OverrideRulePatch,
  type OverrideLogWriteEntry,
} from "./geo-override-db";
import {
  resolveOverrides,
  validateOverrideRule,
  type OverrideRule,
  type ResolverInputItem,
  type AssemblyLookupEntry,
  type PreviousOverrideEntry,
} from "@shared/geo-override-engine";
import { getScopeDraftWithItems } from "./scope-db";
import { requireEntityAccess } from "./project-access";
import { getEffectiveItems } from "./scope-review-db";
import { listAssemblies } from "./assembly-db";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// GEO OVERRIDE ROUTER
// ══════════════════════════════════════════════════════════════════════

export const geoOverrideRouter = router({

  // ══════════════════════════════════════════════════════════════════
  // OVERRIDE RULES — CRUD
  // ══════════════════════════════════════════════════════════════════

  /** List override rules with optional filters */
  listRules: tenantProcedure
    .input(
      z.object({
        zone: z.string().optional(),
        trade: z.string().optional(),
        activeOnly: z.boolean().optional().default(true),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      return listOverrideRules(ctx.tenantId, {
        ...input,
        ...(input?.trade !== undefined ? { trade: normalizeTrade(input.trade) ?? input.trade } : {}),
      });
    }),

  /** Get a single override rule by ID */
  getRule: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const rule = await getOverrideRuleById(ctx.tenantId, input.id);
      if (!rule) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }
      return rule;
    }),

  /** Create a new override rule (admin only) */
  createRule: adminTenantProcedure
    .input(
      z.object({
        zone: z.string().min(1),
        trade: z.string().min(1),
        finishLevel: z.string().nullable().optional(),
        originalAssemblyId: z.string().uuid(),
        replacementAssemblyId: z.string().uuid(),
        overrideType: z.enum(["swap", "add", "warning_only"]),
        reasonTemplate: z.string().min(1),
        active: z.boolean().optional().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Validate rule
      const errors = validateOverrideRule(input as Partial<OverrideRule>);
      if (errors.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid override rule: ${errors.join(", ")}`,
        });
      }

      return createOverrideRule(
        ctx.tenantId,
        {
          zone: input.zone,
          trade: normalizeTrade(input.trade) ?? input.trade,
          finishLevel: normalizeFinishLevel(input.finishLevel) ?? input.finishLevel ?? null,
          originalAssemblyId: input.originalAssemblyId,
          replacementAssemblyId: input.replacementAssemblyId,
          overrideType: input.overrideType,
          reasonTemplate: input.reasonTemplate,
          isActive: input.active,
        },
        ctx.user.id.toString()
      );
    }),

  /** Update an override rule (admin only) */
  updateRule: adminTenantProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        zone: z.string().min(1).optional(),
        trade: z.string().min(1).optional(),
        finishLevel: z.string().nullable().optional(),
        originalAssemblyId: z.string().uuid().optional(),
        replacementAssemblyId: z.string().uuid().optional(),
        overrideType: z.enum(["swap", "add", "warning_only"]).optional(),
        reasonTemplate: z.string().min(1).optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, active, ...data } = input;
      const patch: OverrideRulePatch = {
        ...(data.zone !== undefined ? { zone: data.zone } : {}),
        ...(data.trade !== undefined ? { trade: normalizeTrade(data.trade) ?? data.trade } : {}),
        ...(data.finishLevel !== undefined ? { finishLevel: normalizeFinishLevel(data.finishLevel) ?? data.finishLevel } : {}),
        ...(data.originalAssemblyId !== undefined ? { originalAssemblyId: data.originalAssemblyId } : {}),
        ...(data.replacementAssemblyId !== undefined ? { replacementAssemblyId: data.replacementAssemblyId } : {}),
        ...(data.overrideType !== undefined ? { overrideType: data.overrideType } : {}),
        ...(data.reasonTemplate !== undefined ? { reasonTemplate: data.reasonTemplate } : {}),
        ...(active !== undefined ? { isActive: active } : {}),
      };
      const row = await updateOverrideRule(ctx.tenantId, id, patch, ctx.user.id.toString());
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }
      return row;
    }),

  /** Deactivate an override rule (admin only) */
  deactivateRule: adminTenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const success = await deactivateOverrideRule(ctx.tenantId, input.id, ctx.user.id.toString());
      if (!success) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }
      return success;
    }),

  /** Reactivate an override rule (admin only) */
  reactivateRule: adminTenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const success = await reactivateOverrideRule(ctx.tenantId, input.id, ctx.user.id.toString());
      if (!success) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }
      return success;
    }),

  // ══════════════════════════════════════════════════════════════════
  // OVERRIDE RESOLUTION
  // ══════════════════════════════════════════════════════════════════

  /** Resolve overrides for a scope draft — the main pipeline entry point */
  resolveForDraft: tenantProcedure
    .input(
      z.object({
        scopeDraftId: z.string().uuid(),
        projectZone: z.string().min(1),
        persistLog: z.boolean().optional().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "write");

      // 1. Load scope draft with items
      const draftData = await getScopeDraftWithItems(input.scopeDraftId);
      if (!draftData) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      // 2. Get effective items (with review deltas applied)
      const effectiveItems = await getEffectiveItems(input.scopeDraftId);

      // 3. Build assembly lookup
      const assemblyLookup = await buildAssemblyLookup();

      // 4. Convert effective items to resolver input format
      const resolverItems: any[] = effectiveItems.map((item) => {
        const aRef = assemblyLookup.get(item.assemblyId ?? "");
        return {
          assemblyId: item.assemblyId,
          assemblyName: aRef?.name ?? `Assembly #${item.assemblyId}`,
          trade: aRef?.trade ?? null,
          finishLevel: null, // Will be resolved from assembly data if needed
          quantity: Number(item.quantity) || 1,
          unit: item.unit ?? "EA",
          reason: item.reason ?? "",
          confidence: Number(item.confidence) || 0.5,
          sortOrder: item.sortOrder ?? 0,
        };
      });

      // 5. Load active override rules
      const rules = await listOverrideRules(ctx.tenantId, { activeOnly: true });
      const engineRules: any[] = rules.map((r) => ({
        id: r.id,
        zone: r.zone,
        trade: r.trade,
        finishLevel: r.finishLevel,
        originalAssemblyId: r.originalAssemblyId,
        replacementAssemblyId: r.replacementAssemblyId,
        overrideType: r.overrideType,
        reasonTemplate: r.reasonTemplate,
        active: r.isActive,
      }));

      // 6. Load previously applied overrides for idempotency.
      // The reader receives the permission this purpose already required: a principal
      // authorized to write is not asked for an additional read grant.
      const authority = { tenantId: ctx.tenantId, userId: ctx.user.id };
      const previousLog = await getOverrideLogForDraft(authority, input.scopeDraftId, "write");
      const previouslyApplied: PreviousOverrideEntry[] = previousLog.map((entry) => ({
        scopeDraftId: entry.scopeDraftId,
        originalAssemblyId: entry.originalAssemblyId ?? "",
        replacementAssemblyId: entry.replacementAssemblyId ?? "",
        overrideType: entry.overrideType ?? "",
      }));

      // 7. Build engine-compatible assembly lookup
      const engineLookup = new Map<string, AssemblyLookupEntry>();
      assemblyLookup.forEach((val, key) => {
        engineLookup.set(key, {
          id: key,
          name: val.name,
          code: val.code,
          trade: val.trade,
        });
      });

      // 8. Run the resolver engine
      const result = resolveOverrides(
        resolverItems,
        input.projectZone,
        engineRules,
        engineLookup,
        previouslyApplied
      );

      // 9. Persist the resolved occurrences.
      // The rule that produced each occurrence and the reason the engine actually
      // rendered are what get stored. Every non-skipped occurrence is kept, including
      // identical ones. The writer runs whenever persistence was requested — even with
      // no new entries — so the parents and the history snapshot are validated before
      // the resolution is declared complete.
      if (input.persistLog) {
        const entries: OverrideLogWriteEntry[] = result.overrides
          .filter((o) => !o.skippedBecauseAlreadyApplied)
          .map((o) => ({
            overrideId: o.ruleId,
            originalAssemblyId: o.originalAssemblyId,
            replacementAssemblyId: o.replacementAssemblyId,
            overrideType: o.overrideType,
            reason: o.overrideReason,
          }));

        await writeOverrideLogEntries(authority, input.scopeDraftId, {
          expectedProjectId: draftData.draft.projectId,
          expectedHistory: previousLog,
          expectedRules: rules,
          entries,
        });
      }

      // 10. Audit the resolution
      await logAudit({
        userId: null,
        action: "geo_override.resolve_complete",
        tableName: "scope_override_log",
        recordId: input.scopeDraftId,
        after: {
          zone: input.projectZone,
          hasOverrides: result.hasOverrides,
          stats: result.stats,
          operatorId: ctx.user.id.toString(),
        },
      });

      return result;
    }),

  /** Preview overrides without persisting (dry run) */
  previewForDraft: tenantProcedure
    .input(
      z.object({
        scopeDraftId: z.string().uuid(),
        projectZone: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "read");

      // Same as resolveForDraft but without persistence
      const draftData = await getScopeDraftWithItems(input.scopeDraftId);
      if (!draftData) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      const effectiveItems = await getEffectiveItems(input.scopeDraftId);
      const assemblyLookup = await buildAssemblyLookup();

      const resolverItems: any[] = effectiveItems.map((item) => {
        const aRef = assemblyLookup.get(item.assemblyId ?? "");
        return {
          assemblyId: item.assemblyId,
          assemblyName: aRef?.name ?? `Assembly #${item.assemblyId}`,
          trade: aRef?.trade ?? null,
          finishLevel: null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit ?? "EA",
          reason: item.reason ?? "",
          confidence: Number(item.confidence) || 0.5,
          sortOrder: item.sortOrder ?? 0,
        };
      });

      const rules = await listOverrideRules(ctx.tenantId, { activeOnly: true });
      const engineRules: any[] = rules.map((r) => ({
        id: r.id,
        zone: r.zone,
        trade: r.trade,
        finishLevel: r.finishLevel,
        originalAssemblyId: r.originalAssemblyId,
        replacementAssemblyId: r.replacementAssemblyId,
        overrideType: r.overrideType,
        reasonTemplate: r.reasonTemplate,
        active: r.isActive,
      }));

      const engineLookup = new Map<string, AssemblyLookupEntry>();
      assemblyLookup.forEach((val, key) => {
        engineLookup.set(key, {
          id: key,
          name: val.name,
          code: val.code,
          trade: val.trade,
        });
      });

      return resolveOverrides(resolverItems, input.projectZone, engineRules, engineLookup);
    }),

  // ══════════════════════════════════════════════════════════════════
  // OVERRIDE LOG — QUERIES
  // ══════════════════════════════════════════════════════════════════

  // The authority below is always the trusted request context. A tenant, user or role
  // present in the payload is never consulted. Each helper runs the parent guard and
  // the local parent policy itself, so no separate token is passed between them.

  /** Get override log for a scope draft */
  getLog: tenantProcedure
    .input(z.object({ scopeDraftId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOverrideLogForDraft(
        { tenantId: ctx.tenantId, userId: ctx.user.id },
        input.scopeDraftId,
        "read",
      );
    }),

  /** Check if overrides have been applied to a scope draft */
  hasOverrides: tenantProcedure
    .input(z.object({ scopeDraftId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return hasOverridesApplied(
        { tenantId: ctx.tenantId, userId: ctx.user.id },
        input.scopeDraftId,
      );
    }),

  /** Clear override log for a scope draft (reversal, admin within the tenant) */
  clearLog: adminTenantProcedure
    .input(z.object({ scopeDraftId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // The administrative restriction stays at the boundary; the helper still requires
      // the delete permission on the parent project.
      return clearOverrideLogForDraft(
        { tenantId: ctx.tenantId, userId: ctx.user.id },
        input.scopeDraftId,
      );
    }),

  // ══════════════════════════════════════════════════════════════════
  // STATISTICS
  // ══════════════════════════════════════════════════════════════════

  /** Get override rule counts by zone */
  statsByZone: tenantProcedure.query(async ({ ctx }) => {
    return getOverrideCountsByZone(ctx.tenantId);
  }),

  // ══════════════════════════════════════════════════════════════════
  // SEED
  // ══════════════════════════════════════════════════════════════════

  /** Seed coastal override rules (admin only, idempotent) */
  seedCoastalRules: adminTenantProcedure.mutation(async ({ ctx }) => {
    const { COASTAL_OVERRIDE_SEED_RULES, getSeedSummary } = await import("@shared/geo-override-seed");

    // Check if rules already exist to make this idempotent
    const existing = await listOverrideRules(ctx.tenantId, { activeOnly: false });
    if (existing.length > 0) {
      return {
        seeded: false,
        message: `${existing.length} override rules already exist. Clear existing rules before re-seeding.`,
        summary: getSeedSummary(),
      };
    }

    // Insert all seed rules
    let inserted = 0;
    for (const rule of COASTAL_OVERRIDE_SEED_RULES) {
      await createOverrideRule(
        ctx.tenantId,
        {
          zone: rule.zone,
          trade: rule.trade,
          finishLevel: rule.finishLevel,
          originalAssemblyId: rule.originalAssemblyId,
          replacementAssemblyId: rule.replacementAssemblyId,
          overrideType: rule.overrideType,
          reasonTemplate: rule.reasonTemplate,
          isActive: rule.active,
        },
        ctx.user.id.toString()
      );
      inserted++;
    }

    await logAudit({
      userId: null,
      action: "geo_override.seed_coastal_rules",
      tableName: "geographic_overrides",
      recordId: String(0),
      after: {
        inserted,
        operatorId: ctx.user.id.toString(),
        summary: getSeedSummary(),
      },
    });

    return {
      seeded: true,
      message: `Successfully seeded ${inserted} coastal override rules.`,
      summary: getSeedSummary(),
    };
  }),
});

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Build an assembly lookup map from the database.
 */
async function buildAssemblyLookup(): Promise<
  Map<string, { name: string; code: string; trade: string | null }>
> {
  const { items: dbAssemblies } = await listAssemblies({ activeOnly: true, limit: 2000 });
  const lookup = new Map<string, { name: string; code: string; trade: string | null }>();

  for (const a of dbAssemblies) {
    lookup.set(a.id, {
      name: a.name,
      code: a.code ?? "",
      trade: a.trade ?? null,
    });
  }

  return lookup;
}
