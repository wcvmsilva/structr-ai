/**
 * structr.ai — PHASE 2 Profit Shield Engine (commercial channel floors)
 *
 * PURE evaluation of the margin floor described in docs/phase2-contract.md §7.
 *
 * Floors:
 *   Premium / Homeowner  → 28% gross profit
 *   Trade / Builder      → 18% gross profit
 *   Capital / Investor   → 15% minimum fee
 *
 * Geographic floors (coastal 42%, barrier island 50%) remain in force and are combined
 * with the channel floor by MAXIMUM: the most protective floor wins.
 *
 * The engine NEVER mutates an estimate and never recalculates prices. It answers one
 * question: given a margin and a context, is this allowed, and if not, what should the
 * operator do about it.
 */

import {
  CHANNEL_FLOOR_KIND,
  CHANNEL_MIN_MARGIN_PCT,
  GEO_MIN_MARGIN_PCT,
  PROFIT_SHIELD_PCT,
  type GeoRiskClass,
} from "./constants/profit-shield";
import {
  COMMERCIAL_CHANNEL_LABELS,
  normalizeCommercialChannel,
  PRICING_TO_COMMERCIAL_CHANNEL,
  type CommercialChannel,
} from "./domain/phase2-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export type ProfitShieldSeverity = "ok" | "warning" | "violation";

export interface ProfitShieldContext {
  /** Commercial channel. Accepts aliases and legacy pricing channels. */
  channel: string | null | undefined;
  /** Zone name, used to infer geographic risk when riskClass is absent. */
  zone?: string | null;
  /** Explicit geographic risk class (overrides zone inference). */
  riskClass?: GeoRiskClass | null;
  /** Optional per-assembly margins, evaluated against the individual warning floor. */
  assemblyMargins?: Array<{ assemblyId: string; assemblyName: string; grossProfitPct: number }>;
}

export interface ProfitShieldViolation {
  code:
    | "CHANNEL_FLOOR"
    | "GEO_FLOOR"
    | "GLOBAL_FLOOR"
    | "ASSEMBLY_WARNING"
    | "UNKNOWN_CHANNEL";
  severity: ProfitShieldSeverity;
  message: string;
  /** Floor that was violated (percentage). Null for informational codes. */
  floorPct: number | null;
  actualPct: number;
}

export interface ProfitShieldEvaluation {
  /** Resolved commercial channel (null when it could not be resolved). */
  channel: CommercialChannel | null;
  /** Floor coming from the commercial channel. */
  channelFloorPct: number | null;
  /** Floor coming from geographic risk. */
  geoFloorPct: number;
  /** Resolved geographic risk class. */
  riskClass: GeoRiskClass;
  /** The floor actually enforced: max(channel, geo). */
  effectiveFloorPct: number;
  /** Margin evaluated. */
  actualPct: number;
  /** Nature of the channel floor (gross profit vs fee). */
  floorKind: "gross_profit" | "fee" | null;
  /** True when the margin satisfies every blocking floor. */
  passed: boolean;
  /** True when approval/export must be blocked. */
  blocked: boolean;
  violations: ProfitShieldViolation[];
  warnings: ProfitShieldViolation[];
  /** Operator-facing remediation options (scope, value, payment terms). */
  remediation: string[];
}

// ══════════════════════════════════════════════════════════════════════
// GEO RISK INFERENCE
// ══════════════════════════════════════════════════════════════════════

/**
 * Infer geographic risk from a zone name.
 * Barrier island names in the Charleston market are checked first because they are a
 * subset of "coastal" and carry the highest floor.
 */
export function inferGeoRiskClass(zone: string | null | undefined): GeoRiskClass {
  if (!zone) return "inland";
  const value = String(zone).toLowerCase();

  if (
    /barrier|isle of palms|sullivan|folly|kiawah|seabrook|edisto|dewees|capers|island/.test(value)
  ) {
    return "barrier_island";
  }

  if (/coastal|beach|waterfront|marsh|tidal|harbor|creek|sound|peninsula/.test(value)) {
    return "coastal";
  }

  return "inland";
}

// ══════════════════════════════════════════════════════════════════════
// CHANNEL RESOLUTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve a commercial channel from any accepted representation:
 * commercial channel, alias, or legacy pricing channel.
 */
export function resolveCommercialChannel(
  channel: string | null | undefined,
): CommercialChannel | null {
  const direct = normalizeCommercialChannel(channel);
  if (direct) return direct;

  const legacy = String(channel ?? "").trim().toLowerCase();
  if (legacy === "direct" || legacy === "insurance" || legacy === "commercial") {
    return PRICING_TO_COMMERCIAL_CHANNEL[legacy];
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════
// EVALUATION
// ══════════════════════════════════════════════════════════════════════

function buildRemediation(
  channel: CommercialChannel | null,
  gapPct: number,
): string[] {
  const label = channel ? COMMERCIAL_CHANNEL_LABELS[channel] : "this channel";
  return [
    `Reduce scope or substitute assemblies to recover ${gapPct.toFixed(1)} percentage points of margin.`,
    `Increase price to meet the ${label} floor, or document an approved exception with the reason.`,
    "Change payment terms (deposit, milestone schedule, allowance handling) so cash exposure matches the reduced margin.",
  ];
}

/**
 * Evaluate a margin against the Profit Shield.
 *
 * @param grossProfitPct margin in percentage points (e.g. 24.5 for 24.5%)
 */
export function evaluateProfitShield(
  grossProfitPct: number,
  context: ProfitShieldContext,
): ProfitShieldEvaluation {
  const actualPct = Number.isFinite(grossProfitPct) ? grossProfitPct : 0;
  const channel = resolveCommercialChannel(context.channel);
  const riskClass = context.riskClass ?? inferGeoRiskClass(context.zone);

  const channelFloorPct = channel ? CHANNEL_MIN_MARGIN_PCT[channel] : null;
  const geoFloorPct = GEO_MIN_MARGIN_PCT[riskClass];
  const floorKind = channel ? CHANNEL_FLOOR_KIND[channel] : null;

  const violations: ProfitShieldViolation[] = [];
  const warnings: ProfitShieldViolation[] = [];

  // An unresolved channel is a governance failure, not a free pass: fall back to the
  // most protective channel floor so nothing is approved by accident.
  const enforcedChannelFloor = channelFloorPct ?? CHANNEL_MIN_MARGIN_PCT.premium;
  if (!channel) {
    violations.push({
      code: "UNKNOWN_CHANNEL",
      severity: "violation",
      message: `Commercial channel "${context.channel ?? "null"}" could not be resolved. Applying the most protective floor (${CHANNEL_MIN_MARGIN_PCT.premium}%) until the channel is corrected.`,
      floorPct: CHANNEL_MIN_MARGIN_PCT.premium,
      actualPct,
    });
  }

  const effectiveFloorPct = Math.max(enforcedChannelFloor, geoFloorPct);

  if (channel && actualPct < enforcedChannelFloor) {
    violations.push({
      code: "CHANNEL_FLOOR",
      severity: "violation",
      message: `${COMMERCIAL_CHANNEL_LABELS[channel]} ${floorKind === "fee" ? "fee" : "gross profit"} ${actualPct.toFixed(1)}% is below the ${enforcedChannelFloor}% floor.`,
      floorPct: enforcedChannelFloor,
      actualPct,
    });
  }

  if (geoFloorPct > 0 && actualPct < geoFloorPct) {
    violations.push({
      code: "GEO_FLOOR",
      severity: "violation",
      message: `Gross profit ${actualPct.toFixed(1)}% is below the ${riskClass.replace(/_/g, " ")} floor of ${geoFloorPct}%.`,
      floorPct: geoFloorPct,
      actualPct,
    });
  }

  // The historic global floor stays as a warning so existing behaviour is preserved
  // without turning every sub-35% job into a hard block for Trade/Capital channels.
  if (actualPct < PROFIT_SHIELD_PCT.GLOBAL_MIN_GP && actualPct >= effectiveFloorPct) {
    warnings.push({
      code: "GLOBAL_FLOOR",
      severity: "warning",
      message: `Gross profit ${actualPct.toFixed(1)}% is below the historical global target of ${PROFIT_SHIELD_PCT.GLOBAL_MIN_GP}% but satisfies the enforced floor of ${effectiveFloorPct}%.`,
      floorPct: PROFIT_SHIELD_PCT.GLOBAL_MIN_GP,
      actualPct,
    });
  }

  for (const assembly of context.assemblyMargins ?? []) {
    if (assembly.grossProfitPct < PROFIT_SHIELD_PCT.INDIVIDUAL_WARNING_GP) {
      warnings.push({
        code: "ASSEMBLY_WARNING",
        severity: "warning",
        message: `Assembly ${assembly.assemblyName} GP ${assembly.grossProfitPct.toFixed(1)}% is critically low (< ${PROFIT_SHIELD_PCT.INDIVIDUAL_WARNING_GP}%).`,
        floorPct: PROFIT_SHIELD_PCT.INDIVIDUAL_WARNING_GP,
        actualPct: assembly.grossProfitPct,
      });
    }
  }

  const blocked = violations.length > 0;
  const gapPct = Math.max(0, effectiveFloorPct - actualPct);

  return {
    channel,
    channelFloorPct,
    geoFloorPct,
    riskClass,
    effectiveFloorPct,
    actualPct,
    floorKind,
    passed: !blocked,
    blocked,
    violations,
    warnings,
    remediation: blocked ? buildRemediation(channel, gapPct) : [],
  };
}

/**
 * Convenience guard used by routers before approving an estimate.
 * @throws Error with a deterministic prefix when the shield blocks the operation.
 */
export function assertProfitShield(
  grossProfitPct: number,
  context: ProfitShieldContext,
): ProfitShieldEvaluation {
  const evaluation = evaluateProfitShield(grossProfitPct, context);
  if (evaluation.blocked) {
    throw new Error(
      `PROFIT_SHIELD_CHANNEL_FLOOR: ${evaluation.violations.map((v) => v.message).join(" ")} Remediation: ${evaluation.remediation.join(" | ")}`,
    );
  }
  return evaluation;
}
