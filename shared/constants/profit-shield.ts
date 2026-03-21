/**
 * structr.ai — Profit Shield Configuration
 *
 * Centralized profit margin thresholds used across all estimation engines.
 * ALL engines MUST reference these constants instead of hardcoding values.
 */

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
