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
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
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
  listRules: protectedProcedure
    .input(
      z.object({
        zone: z.string().optional(),
        trade: z.string().optional(),
        activeOnly: z.boolean().optional().default(true),
      }).optional()
    )
    .query(async ({ input }) => {
      return listOverrideRules(input ?? {});
    }),

  /** Get a single override rule by ID */
  getRule: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const rule = await getOverrideRuleById(input.id);
      if (!rule) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }
      return rule;
    }),

  /** Create a new override rule (admin only) */
  createRule: adminProcedure
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
  updateRule: adminProcedure
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
      const { id, ...data } = input;
      const existing = await getOverrideRuleById(id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }

      // Sprint 18: normalize at boundary
      const normalizedData = {
        ...data,
        ...(data.trade ? { trade: normalizeTrade(data.trade) ?? data.trade } : {}),
        ...(data.finishLevel !== undefined ? { finishLevel: normalizeFinishLevel(data.finishLevel) ?? data.finishLevel } : {}),
      };
      return updateOverrideRule(id, normalizedData, ctx.user.id.toString());
    }),

  /** Deactivate an override rule (admin only) */
  deactivateRule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await getOverrideRuleById(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }
      return deactivateOverrideRule(input.id, ctx.user.id.toString());
    }),

  /** Reactivate an override rule (admin only) */
  reactivateRule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await getOverrideRuleById(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Override rule not found" });
      }
      return reactivateOverrideRule(input.id, ctx.user.id.toString());
    }),

  // ══════════════════════════════════════════════════════════════════
  // OVERRIDE RESOLUTION
  // ══════════════════════════════════════════════════════════════════

  /** Resolve overrides for a scope draft — the main pipeline entry point */
  resolveForDraft: protectedProcedure
    .input(
      z.object({
        scopeDraftId: z.string().uuid(),
        projectZone: z.string().min(1),
        persistLog: z.boolean().optional().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
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
      const rules = await listOverrideRules({ activeOnly: true });
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

      // 6. Load previously applied overrides for idempotency
      const previousLog = await getOverrideLogForDraft(input.scopeDraftId);
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

      // 9. Persist override log entries (if requested and there are new overrides)
      if (input.persistLog && result.overrides.length > 0) {
        const newEntries = result.overrides
          .filter((o) => !o.skippedBecauseAlreadyApplied)
          .map((o) => ({
            scopeDraftId: input.scopeDraftId,
            originalAssemblyId: o.originalAssemblyId,
            replacementAssemblyId: o.replacementAssemblyId,
            zone: o.zone,
            overrideType: o.overrideType as "swap" | "add" | "warning_only",
            overrideReason: o.overrideReason,
          }));

        if (newEntries.length > 0) {
          await writeOverrideLogEntries(newEntries, ctx.user.id.toString());
        }
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
  previewForDraft: protectedProcedure
    .input(
      z.object({
        scopeDraftId: z.string().uuid(),
        projectZone: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
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

      const rules = await listOverrideRules({ activeOnly: true });
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

  /** Get override log for a scope draft */
  getLog: protectedProcedure
    .input(z.object({ scopeDraftId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getOverrideLogForDraft(input.scopeDraftId);
    }),

  /** Check if overrides have been applied to a scope draft */
  hasOverrides: protectedProcedure
    .input(z.object({ scopeDraftId: z.string().uuid() }))
    .query(async ({ input }) => {
      return hasOverridesApplied(input.scopeDraftId);
    }),

  /** Clear override log for a scope draft (reversal) */
  clearLog: adminProcedure
    .input(z.object({ scopeDraftId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return clearOverrideLogForDraft(input.scopeDraftId, ctx.user.id.toString());
    }),

  // ══════════════════════════════════════════════════════════════════
  // STATISTICS
  // ══════════════════════════════════════════════════════════════════

  /** Get override rule counts by zone */
  statsByZone: protectedProcedure.query(async () => {
    return getOverrideCountsByZone();
  }),

  // ══════════════════════════════════════════════════════════════════
  // SEED
  // ══════════════════════════════════════════════════════════════════

  /** Seed coastal override rules (admin only, idempotent) */
  seedCoastalRules: adminProcedure.mutation(async ({ ctx }) => {
    const { COASTAL_OVERRIDE_SEED_RULES, getSeedSummary } = await import("@shared/geo-override-seed");

    // Check if rules already exist to make this idempotent
    const existing = await listOverrideRules({ activeOnly: false });
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
