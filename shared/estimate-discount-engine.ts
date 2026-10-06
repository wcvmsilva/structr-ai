import type { EstimateDiscountErrorCode } from "./domain/taxonomy";
import { normalizeApprovalMinor } from "./internal-estimate-approval-engine";

export class EstimateDiscountError extends Error {
  constructor(public readonly code: EstimateDiscountErrorCode) {
    super(code);
    this.name = "EstimateDiscountError";
  }
}

/** Interpret the received Number's shortest decimal text without rounding its scale. */
export function normalizeEstimateDiscountPercent(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 50) {
    throw new EstimateDiscountError("ESTIMATE_DISCOUNT_PERCENT_INVALID");
  }
  const [coefficient, exponent] = String(value).split("e");
  if (exponent === undefined) return coefficient;

  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction;
  // The exponent is an integer position, never a money value. Finite inputs in
  // 0..50 bound it to -324..1 and also bound the expanded string's allocation.
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function money(minor: bigint): string {
  const text = minor.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

export function calculateEstimateDraftDiscount(subtotal: unknown, percent: unknown): {
  discountPct: string;
  discountAmount: string;
  finalTotalPrice: string;
} {
  const discountPct = normalizeEstimateDiscountPercent(percent);
  let subtotalMinor: bigint;
  try {
    subtotalMinor = BigInt(normalizeApprovalMinor(subtotal));
  } catch {
    throw new EstimateDiscountError("ESTIMATE_DISCOUNT_SUBTOTAL_INVALID");
  }

  const [whole, fraction = ""] = discountPct.split(".");
  const numerator = BigInt(whole + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  // Round only the discount: for nonnegative minor units, an exact half cent
  // rounds upward. Deriving the final by subtraction preserves every cent.
  const discountMinor = (subtotalMinor * numerator + 50n * denominator) / (100n * denominator);
  return {
    discountPct,
    discountAmount: money(discountMinor),
    finalTotalPrice: money(subtotalMinor - discountMinor),
  };
}
