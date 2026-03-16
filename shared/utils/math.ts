/**
 * shared/utils/math.ts — Canonical rounding utilities for structr.ai Construction Brain
 *
 * ALL cost, pricing, and modifier calculations MUST use these functions.
 * Do NOT define local rounding helpers in other modules.
 *
 * round2 — financial precision (dollars & cents, percentages)
 * round4 — intermediate precision (multipliers, unit rates, cost-per-sqft)
 */

/** Round to 2 decimal places (financial precision). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round to 4 decimal places (intermediate calculation precision). */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
