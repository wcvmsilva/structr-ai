import { describe, expect, it, vi } from "vitest";
import {
  EstimateDiscountError,
  calculateEstimateDraftDiscount,
  normalizeEstimateDiscountPercent,
} from "../shared/estimate-discount-engine";

function expectDiscountError(run: () => unknown, code: string) {
  let failure: unknown;
  try { run(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(EstimateDiscountError);
  expect(failure).toMatchObject({ name: "EstimateDiscountError", code });
}

describe("exact discount percentage representation", () => {
  it.each([
    [0, "0"],
    [-0, "0"],
    [50, "50"],
    [12.34, "12.34"],
    [0.1, "0.1"],
    [0.30000000000000004, "0.30000000000000004"],
    [49.99999999999999, "49.99999999999999"],
    [0.000001, "0.000001"],
    [1e-7, "0.0000001"],
    [1.23456789e-7, "0.000000123456789"],
    [1e-100, `0.${"0".repeat(99)}1`],
    [1e-323, `0.${"0".repeat(322)}1`],
    [Number.MIN_VALUE, `0.${"0".repeat(323)}5`],
  ] as const)("preserves the shortest round-trip value %s as %s", (input, expected) => {
    expect(normalizeEstimateDiscountPercent(input)).toBe(expected);
  });

  it.each([
    undefined, null, true, false, "5", "0", "NaN", "", [], {},
    1n, new Number(5), Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, -Number.MIN_VALUE, -0.1, -1,
    50.00000000000001, 51, Number.MAX_VALUE,
  ])("rejects invalid percentage case %# consistently at both entry points", input => {
    expectDiscountError(() => normalizeEstimateDiscountPercent(input), "ESTIMATE_DISCOUNT_PERCENT_INVALID");
    expectDiscountError(() => calculateEstimateDraftDiscount("100.00", input), "ESTIMATE_DISCOUNT_PERCENT_INVALID");
  });

  it("does not call user-provided coercion while rejecting a percentage", () => {
    const valueOf = vi.fn(() => 5);
    const toString = vi.fn(() => "5");
    expectDiscountError(() => normalizeEstimateDiscountPercent({ valueOf, toString }), "ESTIMATE_DISCOUNT_PERCENT_INVALID");
    expect(valueOf).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });
});

describe("exact discount calculation in minor units", () => {
  it.each([
    ["100.00", 10, "10", "10.00", "90.00"],
    ["100", 0.1, "0.1", "0.10", "99.90"],
    ["000100.0", 12.5, "12.5", "12.50", "87.50"],
    ["0000.00", 50, "50", "0.00", "0.00"],
    ["0", Number.MIN_VALUE, `0.${"0".repeat(323)}5`, "0.00", "0.00"],
    ["0.01", 0, "0", "0.00", "0.01"],
    ["0.01", 50, "50", "0.01", "0.00"],
    ["0.03", 50, "50", "0.02", "0.01"],
    ["0.06", 25, "25", "0.02", "0.04"],
    ["0.02", 24.999999999999996, "24.999999999999996", "0.00", "0.02"],
    ["0.02", 25, "25", "0.01", "0.01"],
    ["0.02", 25.000000000000004, "25.000000000000004", "0.01", "0.01"],
    ["0.03", 16.666666666666664, "16.666666666666664", "0.00", "0.03"],
    ["0.03", 16.666666666666668, "16.666666666666668", "0.01", "0.02"],
    ["100000000000000000.01", 0, "0", "0.00", "100000000000000000.01"],
    ["999999999999999999.99", -0, "0", "0.00", "999999999999999999.99"],
    ["999999999999999999.99", 50, "50", "500000000000000000.00", "499999999999999999.99"],
    ["999999999999999999.99", 25, "25", "250000000000000000.00", "749999999999999999.99"],
    ["123456789012345678.91", 12.5, "12.5", "15432098626543209.86", "108024690385802469.05"],
    ["999999999999999999.99", 1e-7, "0.0000001", "1000000000.00", "999999998999999999.99"],
    ["999999999999999999.99", Number.MIN_VALUE, `0.${"0".repeat(323)}5`, "0.00", "999999999999999999.99"],
    ["100000000000000000.00", 0.30000000000000004, "0.30000000000000004", "300000000000000.04", "99699999999999999.96"],
  ] as const)("calculates %s at %s%% without discarding cents", (subtotal, percent, discountPct, discountAmount, finalTotalPrice) => {
    expect(calculateEstimateDraftDiscount(subtotal, percent)).toEqual({ discountPct, discountAmount, finalTotalPrice });
  });

  it("subtracts the rounded discount instead of separately rounding the final price", () => {
    // One cent split at 50% cannot round both outputs upward.
    expect(calculateEstimateDraftDiscount("0.01", 50)).toEqual({ discountPct: "50", discountAmount: "0.01", finalTotalPrice: "0.00" });
  });

  it.each([
    ["0.00", 0n], ["0.01", 1n], ["0.03", 3n], ["1.99", 199n],
    ["100.00", 10000n], ["90071992547409.93", 9007199254740993n],
    ["100000000000000000.01", 10000000000000000001n],
    ["999999999999999999.99", 99999999999999999999n],
  ] as const)("conserves the entire subtotal %s across percentages", (subtotal, expectedMinor) => {
    for (const percent of [0, Number.MIN_VALUE, 1e-100, 1e-7, 0.1, 0.30000000000000004, 12.5, 24.999999999999996, 25, 25.000000000000004, 49.99999999999999, 50]) {
      const result = calculateEstimateDraftDiscount(subtotal, percent);
      expect(result.discountAmount).toMatch(/^(0|[1-9]\d*)\.\d{2}$/);
      expect(result.finalTotalPrice).toMatch(/^(0|[1-9]\d*)\.\d{2}$/);
      const discount = BigInt(result.discountAmount.replace(".", ""));
      const final = BigInt(result.finalTotalPrice.replace(".", ""));
      expect(discount + final).toBe(expectedMinor);
      expect(discount >= 0n && final >= 0n).toBe(true);
      expect(discount <= (expectedMinor + 1n) / 2n).toBe(true);
    }
  });
});

describe("stored subtotal validation", () => {
  it.each([
    undefined, null, 0, 100, 1n, true, [], {}, "", " ", " 1.00", "1.00 ",
    "+1", "-0", "-1", "1e2", "Infinity", "NaN", "1,00", ".5", "1.",
    "1.001", "1.000", "1000000000000000000", "9999999999999999999.99",
    `${"0".repeat(65)}1.00`,
  ])("rejects missing or invalid stored subtotal case %# instead of substituting zero", subtotal => {
    expectDiscountError(() => calculateEstimateDraftDiscount(subtotal, 5), "ESTIMATE_DISCOUNT_SUBTOTAL_INVALID");
  });

  it("does not coerce stored objects or expose their private text through the error", () => {
    const privateText = "synthetic-private-subtotal";
    const toString = vi.fn(() => privateText);
    expectDiscountError(() => calculateEstimateDraftDiscount({ toString }, 5), "ESTIMATE_DISCOUNT_SUBTOTAL_INVALID");
    expect(toString).not.toHaveBeenCalled();
    let failure: unknown;
    try { calculateEstimateDraftDiscount(privateText, 5); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(EstimateDiscountError);
    expect((failure as Error).message).not.toContain(privateText);
  });
});
