/**
 * structr.ai — Pricing Dimensions Resolver
 * Sprint 18: Pricing Integrity Hardening
 *
 * Centralized DB-driven multiplier resolution.
 * Replaces ALL hardcoded channel/finish/regional multipliers
 * that were previously scattered across assembly-router.ts and estimate-router.ts.
 *
 * Single source of truth: channel_multipliers, finish_levels, regional_modifiers tables.
 *
 * Usage:
 *   const dims = await resolvePricingDimensions({ channel, finishLevel, region, trade });
 *   // dims.channelCostMultiplier, dims.channelPriceMultiplier,
 *   // dims.finishPriceMultiplier, dims.regionalCostModifier, etc.
 */

import {
  getChannelMultiplier,
  getFinishLevel,
  listRegionalModifiers,
} from "./pricing-db";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface PricingDimensionInput {
  channel?: "direct" | "insurance" | "commercial" | null;
  finishLevel?: "standard" | "premium" | "luxury" | null;
  region?: string | null;
  trade?: string | null;
}

export interface ResolvedPricingDimensions {
  /** Applied to cost calculations for the channel */
  channelCostMultiplier: number;
  /** Applied to price calculations for the channel */
  channelPriceMultiplier: number;
  /** Applied to price calculations for the finish level */
  finishPriceMultiplier: number;
  /** Applied to overall cost for the region */
  regionalCostModifier: number;
  /** Applied to labor costs for the region */
  regionalLaborModifier: number;
  /** Applied to material costs for the region */
  regionalMaterialModifier: number;
  /** Applied to permit costs for the region */
  regionalPermitModifier: number;
  /** Coastal modifier from geographic context (pass-through, not resolved here) */
  coastalModifier?: number;
  /** Provenance: where each value came from */
  sources: DimensionSources;
}

export interface DimensionSources {
  channel: "db" | "default";
  channelId: string | null;
  finish: "db" | "default";
  finishId: string | null;
  regional: "db" | "default";
  regionalId: string | null;
}

/** Fallback values — all 1.0 (identity multipliers) */
const IDENTITY: Omit<ResolvedPricingDimensions, "sources"> = {
  channelCostMultiplier: 1.0,
  channelPriceMultiplier: 1.0,
  finishPriceMultiplier: 1.0,
  regionalCostModifier: 1.0,
  regionalLaborModifier: 1.0,
  regionalMaterialModifier: 1.0,
  regionalPermitModifier: 1.0,
};

// ══════════════════════════════════════════════════════════════════════
// RESOLVER
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve all pricing dimensions from the database.
 *
 * Falls back to 1.0 (identity) for any dimension not found in DB.
 * Never throws — returns defaults on DB failure.
 *
 * @param input - channel, finishLevel, region, trade (all optional)
 * @param auditContext - optional context for audit logging
 * @returns Fully resolved pricing dimensions with provenance
 */
export async function resolvePricingDimensions(
  input: PricingDimensionInput,
  auditContext?: { userId?: string; projectId?: string; scopeDraftId?: string }
): Promise<ResolvedPricingDimensions> {
  const sources: DimensionSources = {
    channel: "default",
    channelId: null,
    finish: "default",
    finishId: null,
    regional: "default",
    regionalId: null,
  };

  const result = { ...IDENTITY };

  // ── Channel Multiplier ──────────────────────────────────────────
  if (input.channel && input.channel !== "direct") {
    try {
      const cm = await getChannelMultiplier(input.channel);
      if (cm) {
        result.channelCostMultiplier = parseFloat(cm.multiplier);
        result.channelPriceMultiplier = parseFloat(cm.multiplier);
        sources.channel = "db";
        sources.channelId = cm.id;
      }
    } catch {
      // Fallback to identity — logged below
    }
  }

  // ── Finish Level ────────────────────────────────────────────────
  if (input.finishLevel && input.finishLevel !== "standard") {
    try {
      const fl = await getFinishLevel(input.finishLevel, input.trade ?? undefined);
      if (fl) {
        result.finishPriceMultiplier = parseFloat(fl.multiplier);
        sources.finish = "db";
        sources.finishId = fl.id;
      }
    } catch {
      // Fallback to identity
    }
  }

  // ── Regional Modifier ──────────────────────────────────────────
  if (input.region) {
    try {
      const allModifiers = await listRegionalModifiers(true);
      const regionMods = allModifiers.filter(m => m.region === input.region);
      if (regionMods.length > 0) {
        for (const mod of regionMods) {
          const val = parseFloat(mod.multiplier);
          switch (mod.category) {
            case "cost":
              result.regionalCostModifier = val;
              break;
            case "labor":
              result.regionalLaborModifier = val;
              break;
            case "material":
              result.regionalMaterialModifier = val;
              break;
            case "permit":
              result.regionalPermitModifier = val;
              break;
          }
        }
        sources.regional = "db";
        sources.regionalId = regionMods[0].id;
      }
    } catch {
      // Fallback to identity
    }
  }

  // ── Audit ──────────────────────────────────────────────────────
  if (auditContext) {
    try {
      await logAudit({
        tableName: "pricing_dimensions",
        recordId: auditContext.projectId ?? auditContext.scopeDraftId ?? "",
        action: "pricing_multiplier_lookup",
        userId: auditContext.userId ?? null,
        after: {
          input: {
            channel: input.channel ?? null,
            finishLevel: input.finishLevel ?? null,
            region: input.region ?? null,
            trade: input.trade ?? null,
          },
          resolved: {
            channelCostMultiplier: result.channelCostMultiplier,
            channelPriceMultiplier: result.channelPriceMultiplier,
            finishPriceMultiplier: result.finishPriceMultiplier,
            regionalCostModifier: result.regionalCostModifier,
          },
          sources,
        },
      });
    } catch {
      // Audit failure is non-blocking
    }
  }

  return { ...result, sources };
}

/**
 * Build the dimensions object expected by the assembly-engine's calculateAssemblyCost.
 *
 * Maps resolved DB values to the engine's expected field names.
 */
export function toPricingEngineDimensions(
  resolved: ResolvedPricingDimensions,
  geoDimensions?: {
    regionalLaborModifier?: number;
    regionalMaterialModifier?: number;
    regionalCostModifier?: number;
    coastalModifier?: number;
  }
): Record<string, number> {
  return {
    channelCostMultiplier: resolved.channelCostMultiplier,
    channelPriceMultiplier: resolved.channelPriceMultiplier,
    finishMultiplier: resolved.finishPriceMultiplier,
    regionalCostModifier: geoDimensions?.regionalCostModifier ?? resolved.regionalCostModifier,
    regionalLaborModifier: geoDimensions?.regionalLaborModifier ?? resolved.regionalLaborModifier,
    regionalMaterialModifier: geoDimensions?.regionalMaterialModifier ?? resolved.regionalMaterialModifier,
    ...(geoDimensions?.coastalModifier != null ? { coastalModifier: geoDimensions.coastalModifier } : {}),
  };
}
