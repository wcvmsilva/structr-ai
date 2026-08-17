/**
 * structr.ai — Profit Shield Configuration
 *
 * Centralized profit margin thresholds used across all estimation engines.
 * ALL engines MUST reference these constants instead of hardcoding values.
 *
 * PHASE 2 adds the commercial-channel margin floors defined in the dossier (§3.1):
 * Premium/Homeowner 28%, Trade/Builder 18%, Capital/Investor 15% fee. Those floors
 * are combined with the pre-existing geographic floors by taking the MAXIMUM, so a
 * coastal Trade job is still protected by the coastal floor.
 */

import type { CommercialChannel } from "../domain/phase2-taxonomy";

export const PROFIT_SHIELD = {
  /** 35% — Absolute floor for overall bundle/estimate GP */
  GLOBAL_MIN_GP: 0.35,

  /** 28% — Per-assembly warning threshold (critically low) */
  INDIVIDUAL_WARNING_GP: 0.28,

  /** 42% — Minimum GP floor for coastal zones */
  COASTAL_MIN_GP: 0.42,

  /** 50% — Minimum GP floor for barrier island zones */
  BARRIER_ISLAND_MIN_GP: 0.50,
} as const;

/** Percentage versions (multiplied by 100) for display/comparison */
export const PROFIT_SHIELD_PCT = {
  GLOBAL_MIN_GP: PROFIT_SHIELD.GLOBAL_MIN_GP * 100,        // 35
  INDIVIDUAL_WARNING_GP: PROFIT_SHIELD.INDIVIDUAL_WARNING_GP * 100,  // 28
  COASTAL_MIN_GP: PROFIT_SHIELD.COASTAL_MIN_GP * 100,      // 42
  BARRIER_ISLAND_MIN_GP: PROFIT_SHIELD.BARRIER_ISLAND_MIN_GP * 100, // 50
} as const;

// ══════════════════════════════════════════════════════════════════════
// PHASE 2 — COMMERCIAL CHANNEL FLOORS (dossier §3.1)
// ══════════════════════════════════════════════════════════════════════

/**
 * Minimum acceptable margin per commercial channel, as a fraction.
 * `capital` is expressed as a minimum FEE rather than gross profit, but it is
 * enforced against the same computed margin figure so a single guard covers all three.
 */
export const CHANNEL_MIN_MARGIN: Record<CommercialChannel, number> = {
  premium: 0.28,
  trade: 0.18,
  capital: 0.15,
};

/** Percentage version of CHANNEL_MIN_MARGIN. */
export const CHANNEL_MIN_MARGIN_PCT: Record<CommercialChannel, number> = {
  premium: 28,
  trade: 18,
  capital: 15,
};

/** Nature of each channel floor — used in operator-facing messages. */
export const CHANNEL_FLOOR_KIND: Record<CommercialChannel, "gross_profit" | "fee"> = {
  premium: "gross_profit",
  trade: "gross_profit",
  capital: "fee",
};

/** Geographic risk classes that raise the effective floor. */
export type GeoRiskClass = "inland" | "coastal" | "barrier_island";

/** Percentage floor per geographic risk class. */
export const GEO_MIN_MARGIN_PCT: Record<GeoRiskClass, number> = {
  inland: 0,
  coastal: PROFIT_SHIELD_PCT.COASTAL_MIN_GP,
  barrier_island: PROFIT_SHIELD_PCT.BARRIER_ISLAND_MIN_GP,
};
