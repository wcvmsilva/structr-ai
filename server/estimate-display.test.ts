/** Pure read presentation. Synthetic values; no DB, HTTP, policy or execution authority. */
import { describe, expect, it, vi } from "vitest";
import {
  buildEstimateDisplay as build, formatEstimateMoney as money,
  formatEstimateQuantity as quantity, formatEstimateUnitRate as rate,
  formatEstimatePercent as percent, deriveEstimateProfit as profit,
  deriveEstimateDiscountRatio as discount, type DisplayScalar,
} from "../shared/estimate-display";

const id = (n: number) => `d6100000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const known = (value: string): DisplayScalar => ({ state: "known", value });
const missing: DisplayScalar = { state: "unavailable", reason: "missing" };
const maxMoney = "999999999999999999.99";
function v2() {
  return {
    id: id(1), tenantId: id(2), projectId: id(3), clientId: id(4), createdBy: id(5), supersedesId: id(6),
    source: "version", status: "draft", version: 2, a1VersionRequestId: id(7), a1VersionRequestHash: "a".repeat(64),
    subtotalPrice: "100.00", subtotalCost: "40.00", discountAmount: "0.00", finalTotalPrice: "100.00", discountApplied: false,
    grossProfit: "60.00", grossProfitPct: "60.00", zone: null as string | null, assemblyCount: 1 as number | null,
    pricingSchemaVersion: null as string | null, scopeDraftId: null as string | null, metadata: null,
    pricingSnapshot: { channel: "direct", finishLevel: "standard", region: "synthetic", zone: null as string | null,
      trade: null, coastalModifier: null, commercialChannel: "premium", geoRiskClass: null },
    lineItems: [{ costGroupName: "Synthetic group", costItemName: "Synthetic line", description: null as string | null,
      quantity: "2", unit: "EA" as string | null, unitCostSnapshot: "20" as string | null, unitPriceSnapshot: "50" as string | null,
      lineTotalCost: "40.00", lineTotalPrice: "100.00", assemblyId: id(8) as string | null,
      costCode: "12-100" as string | null, taxable: null as boolean | null }],
    assemblySelections: [{ assemblyId: id(8), assemblyName: "Synthetic assembly", assemblyCode: null as string | null,
      category: null as string | null, quantity: "2", unitCost: "20" as string | null, unitPrice: "50" as string | null,
      extendedCost: "40.00" as string | null, extendedPrice: "100.00" as string | null }],
  };
}
function legacy(extra: Record<string, unknown> = {}) {
  return { subtotalPrice: "100.00", subtotalCost: "40.00", discountAmount: "0.00", finalTotalPrice: "100.00",
    lineItems: [], assemblySelections: [], ...extra };
}
function available(input: unknown) {
  const result = build(input);
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("Expected display data");
  return result;
}
function rows<T>(collection: { state: "known"; rows: T[] } | { state: "unavailable"; reason: string }): T[] {
  expect(collection.state).toBe("known");
  if (collection.state !== "known") throw new Error("Expected known rows");
  return collection.rows;
}

describe("representation discrimination without inherited authority", () => {
  it.each([{}, { a1VersionRequestId: null, a1VersionRequestHash: null }])("keeps explicit legacy form %#", marker => {
    const view = available(legacy({ source: "version", ...marker }));
    expect(view.representation).toBe("legacy"); expect(view.percentPlaces).toBe(1);
    expect(view.provenance).toEqual({ state: "unavailable", reason: "legacy_context" });
  });
  it("reads a coherent v2 and does not manufacture approval fields", () => {
    const view = available(v2());
    expect(view.representation).toBe("v2"); expect(view.percentPlaces).toBe(2);
    expect(Object.keys(view).sort()).toEqual(["lines", "percentPlaces", "provenance", "representation", "selections", "state", "summary"]);
    expect(view.summary.grossProfit).toEqual(known("60.00"));
    expect(view.summary.grossProfitPct).toEqual(known("60.00"));
  });
  it.each([
    { a1VersionRequestId: id(7) }, { a1VersionRequestHash: "a".repeat(64) },
    { a1VersionRequestId: null }, { a1VersionRequestId: undefined, a1VersionRequestHash: undefined },
    { a1VersionRequestId: null, a1VersionRequestHash: "a".repeat(64) },
    { a1VersionRequestId: id(7), a1VersionRequestHash: null },
    { a1VersionRequestId: "00000000-0000-0000-0000-000000000000", a1VersionRequestHash: "a".repeat(64) },
    { a1VersionRequestId: id(7), a1VersionRequestHash: "A".repeat(64) },
  ])("never treats partial/malformed marker %# as legacy", marker => {
    expect(build(legacy(marker))).toMatchObject({ state: "unavailable", reason: "invalid_version_projection" });
  });
  it("does not use a valid marker with another source as v2", () => {
    expect(build({ ...v2(), source: "assembly_calculator" })).toMatchObject({ state: "unavailable", reason: "invalid_version_projection" });
  });
  it.each(["internally_approved", "internal_approval_revoked", "archived", "rejected"])("reads later %s state without granting authority", status => {
    const view = available({ ...v2(), status, approvedAt: new Date(), lockedAt: new Date(), supersededBy: id(9) });
    expect(view.summary.finalTotalPrice).toEqual(known("100.00"));
    expect(view).not.toHaveProperty("approved"); expect(view).not.toHaveProperty("authorized");
  });
  it.each([{ source: "historical_import" }, { historicalImportId: id(9) }])("preserves historical dispatch %#", signal => {
    expect(build({ ...v2(), ...signal })).toMatchObject({ state: "unavailable", reason: "historical_capture" });
  });
});

describe("v2 closed projection, nulls and current financials", () => {
  it("uses current final/cost after a discount, ignoring stale stored GP", () => {
    const input = { ...v2(), discountApplied: true, discountAmount: "20.00", finalTotalPrice: "80.00", grossProfit: "999.00", grossProfitPct: "99.00" };
    const view = available(input);
    expect(view.summary.grossProfit).toEqual(known("40.00"));
    expect(view.summary.grossProfitPct).toEqual(known("50.00"));
    expect(percent(view.summary.discountRatioPct)).toBe("20.0%");
  });
  it("reads final zero as money while its margin remains undefined", () => {
    const view = available({ ...v2(), discountApplied: true, discountAmount: "100.00", finalTotalPrice: "0.00" });
    expect(money(view.summary.finalTotalPrice)).toBe("$0.00");
    expect(money(view.summary.grossProfit)).toBe("-$40.00");
    expect(view.summary.grossProfitPct).toEqual({ state: "unavailable", reason: "undefined_ratio" });
  });
  it("allows explicit true with zero discount", () => {
    expect(available({ ...v2(), discountApplied: true }).summary.discountRatioPct).toEqual(known("0.0"));
  });
  it("retains unknown rates, taxability and selection totals without extension", () => {
    const input = v2(); Object.assign(input.lineItems[0], { unit: null, unitCostSnapshot: null, unitPriceSnapshot: null, taxable: null });
    Object.assign(input.assemblySelections[0], { extendedCost: null, extendedPrice: null });
    const view = available(input), line = rows(view.lines)[0], selection = rows(view.selections)[0];
    expect(line.unit).toBeNull(); expect(line.taxable).toBeNull();
    expect(line.unitCost).toEqual(missing); expect(line.totalCost).toEqual(known("40.00"));
    expect(selection.totalCost).toEqual(missing); expect(selection.totalPrice).toEqual(missing);
    expect(money(selection.grossProfit)).toBe("Unavailable");
  });
  it("preserves decimal6 quantities and all rate digits", () => {
    const input = v2(); input.lineItems[0].quantity = "99999999999999.999999"; input.lineItems[0].unitPriceSnapshot = "0.000001";
    const line = rows(available(input).lines)[0];
    expect(quantity(line.quantity)).toBe("99999999999999.999999"); expect(rate(line.unitPrice)).toBe("$0.000001");
    expect(money(line.totalPrice)).toBe("$100.00"); // Explicit total, never quantity × rate.
  });
  it("keeps maximum money without a lost cent", () => {
    const input = v2(); input.subtotalPrice = maxMoney; input.finalTotalPrice = maxMoney; input.lineItems[0].lineTotalPrice = maxMoney;
    const view = available(input);
    expect(money(view.summary.finalTotalPrice)).toBe("$999,999,999,999,999,999.99");
  });
  it("keeps duplicate rows in their original order without grouping", () => {
    const input = v2(); input.lineItems = [input.lineItems[0], { ...input.lineItems[0], description: "Second occurrence" }];
    input.subtotalCost = "80.00"; input.subtotalPrice = "200.00"; input.finalTotalPrice = "200.00";
    input.assemblySelections.push({ ...input.assemblySelections[0] }); input.assemblyCount = 2;
    const view = available(input);
    expect(rows(view.lines).map(line => line.description)).toEqual([null, "Second occurrence"]);
    expect(rows(view.selections)).toHaveLength(2);
  });
  it("shows only actual stored context with null schema/scope, without defaults", () => {
    const input = v2(); input.assemblyCount = null;
    const view = available(input);
    expect(view.provenance).toEqual({ state: "known", source: "stored_pricing_snapshot", pricing: input.pricingSnapshot, pricingSchemaVersion: null, scopeDraftId: null });
    expect(JSON.stringify(view)).not.toContain("1.0");
  });
  it.each([
    (x: any) => { x.lineItems[0].grossProfitPct = 60; },
    (x: any) => { delete x.lineItems[0].taxable; },
    (x: any) => { x.lineItems[0].quantity = 2; },
    (x: any) => { x.lineItems[0].unitPriceSnapshot = "0.0000001"; },
    (x: any) => { x.lineItems[0].lineTotalCost = "39.99"; },
    (x: any) => { x.lineItems[0].lineTotalPrice = "1e2"; },
    (x: any) => { x.lineItems = []; },
    (x: any) => { x.assemblySelections[0].stage = "invented"; },
    (x: any) => { delete x.assemblySelections[0].extendedCost; },
    (x: any) => { x.assemblyCount = 0; },
    (x: any) => { x.zone = "different"; },
    (x: any) => { x.pricingSnapshot.extra = true; },
    (x: any) => { delete x.pricingSnapshot.trade; },
    (x: any) => { x.pricingSnapshot.commercialChannel = "insurance"; },
    (x: any) => { x.subtotalPrice = 100; },
    (x: any) => { x.discountAmount = "10.00"; },
    (x: any) => { x.finalTotalPrice = "99.00"; },
    (x: any) => { x.clientId = null; },
    (x: any) => { x.supersedesId = x.id; },
    (x: any) => { x.scopeDraftId = "invalid"; },
  ])("refuses malformed v2 projection %# as a unit", change => {
    const input = v2(); change(input);
    expect(build(input)).toMatchObject({ state: "unavailable", representation: "v2", reason: "invalid_version_projection" });
  });
});

describe("explicit legacy compatibility without invented values", () => {
  it("parses complete exponent strings and computes the stored discount ratio", () => {
    const view = available(legacy({ subtotalPrice: " 1.5e3 ", discountAmount: "3e2", finalTotalPrice: "1.2e3", subtotalCost: "9e2" }));
    expect(money(view.summary.finalTotalPrice)).toBe("$1,200.00");
    expect(percent(view.summary.discountRatioPct)).toBe("20.0%");
    expect(percent(view.summary.grossProfitPct)).toBe("25.0%");
  });
  it.each([[0, "$0.00"], [-0, "$0.00"], [".5", "$0.50"], ["1.", "$1.00"], ["-2.5e1", "-$25.00"], ["0.290", "$0.29"], [0.29, "$0.29"]])("displays exact observed legacy amount %s", (value, expected) => {
    expect(money(available(legacy({ subtotalCost: value })).summary.subtotalCost)).toBe(expected);
  });
  it.each([null, undefined, "", "0x10", "12oops", "Infinity", Infinity, NaN, true, 0.001, "0.001", 90071992547409.9, 1e21, "1e351", "1e-351", "9".repeat(129)])("keeps unknown/ambiguous legacy money %# unavailable", value => {
    const view = available(legacy({ subtotalCost: value }));
    expect(money(view.summary.subtotalCost)).toBe("Unavailable");
    expect(money(view.summary.grossProfit)).toBe("Unavailable");
  });
  it("does not throw away the exact string corresponding to an unsafe number", () => {
    expect(money(available(legacy({ subtotalCost: "90071992547409.90" })).summary.subtotalCost)).toBe("$90,071,992,547,409.90");
  });
  it("does not synthesize missing item or selection cost from quantity and rate", () => {
    const view = available(legacy({ lineItems: [{ costItemName: "Line", quantity: 2, unitCostSnapshot: 20, lineTotalPrice: 100 }],
      assemblySelections: [{ assemblyName: "Assembly", quantity: 2, unitCost: 20, extendedPrice: 100 }] }));
    for (const row of [rows(view.lines)[0], rows(view.selections)[0]]) {
      expect(row.totalCost).toEqual(missing); expect(percent(row.grossProfitPct)).toBe("Unavailable");
    }
  });
  it("keeps empty collections distinct from missing or invalid collections", () => {
    expect(available(legacy()).lines).toEqual({ state: "known", rows: [] });
    const absent = available({ subtotalPrice: "1", subtotalCost: "0" });
    expect(absent.lines).toEqual({ state: "unavailable", reason: "missing" });
    expect(available(legacy({ assemblySelections: [null] })).selections).toEqual({ state: "unavailable", reason: "invalid" });
  });
  it("rejects a sparse legacy array even when an extra key replaces the missing index", () => {
    const lines = [{ costItemName: "Missing slot" }, { costItemName: "Kept slot" }];
    delete lines[0]; Object.defineProperty(lines, "extra", { value: "not an index", enumerable: true });
    expect(available(legacy({ lineItems: lines })).lines).toEqual({ state: "unavailable", reason: "invalid" });
  });
  it("reads zero and signed legacy quantities explicitly", () => {
    const view = available(legacy({ lineItems: [{ quantity: 0, unitPriceSnapshot: 0 }, { quantity: "-2.5e1", unitPriceSnapshot: "1.234567" }] }));
    const items = rows(view.lines);
    expect(quantity(items[0].quantity)).toBe("0"); expect(rate(items[0].unitPrice)).toBe("$0.00");
    expect(quantity(items[1].quantity)).toBe("-25"); expect(rate(items[1].unitPrice)).toBe("$1.234567");
  });
  it("derives legacy negative GP from current operands instead of old GP", () => {
    const view = available(legacy({ finalTotalPrice: "100.00", subtotalCost: "102.50", grossProfit: "500", grossProfitPct: "50" }));
    expect(money(view.summary.grossProfit)).toBe("-$2.50"); expect(percent(view.summary.grossProfitPct)).toBe("-2.5%");
  });
});

describe("exact arithmetic and defensive formatters", () => {
  it.each([
    ["0.32", "0.31", 2, "0.01", "3.13"], ["0.32", "0.33", 2, "-0.01", "-3.13"],
    ["0.03", "0.01", 2, "0.02", "66.67"], ["100.00", "100.00", 1, "0.00", "0.0"],
    ["100.00", "98.75", 1, "1.25", "1.3"], ["100.00", "101.25", 1, "-1.25", "-1.3"],
    ["100.00", "98.76", 1, "1.24", "1.2"], ["0.32", "0.31", 1, "0.01", "3.1"],
  ] as const)("derives GP %s/%s directly at %s places", (price, cost, places, amount, pct) => {
    expect(profit(known(price), known(cost), places)).toEqual({ amount: known(amount), percent: known(pct) });
  });
  it("does not double-round a ratio just below the one-place halfway point", () => {
    expect(discount(known("1.25"), known("100.10"))).toEqual(known("1.2"));
    expect(profit(known("100.10"), known("98.85"), 1).percent).toEqual(known("1.2"));
  });
  it.each([["0.00", "0.00"], ["1.00", "0.00"], ["-1.00", "100.00"], ["101.00", "100.00"]])("does not invent discount ratio for %s/%s", (amount, total) => {
    expect(discount(known(amount), known(total))).toEqual({ state: "unavailable", reason: "undefined_ratio" });
  });
  it("keeps absolute zero-price profit while its percentage is undefined", () => {
    expect(profit(known("0.00"), known("5.00"), 2)).toEqual({ amount: known("-5.00"), percent: { state: "unavailable", reason: "undefined_ratio" } });
    expect(profit(missing, known("5.00"), 2).amount.state).toBe("unavailable");
  });
  it("formats the full 21-minor-digit derived legacy difference", () => {
    const result = profit(known(maxMoney), known(`-${maxMoney}`), 2);
    expect(result.amount).toEqual(known("1999999999999999999.98"));
    expect(money(result.amount)).toBe("$1,999,999,999,999,999,999.98");
    expect(percent(result.percent)).toBe("200.00%");
  });
  it("does not clamp or lose an extreme derived percentage", () => {
    const result = profit(known("0.01"), known(`-${maxMoney}`), 2);
    expect(percent(result.percent)).toBe("10000000000000000000000.00%");
  });
  it.each(["12oops", "NaN", "1e3", "", "01.00", "-0.00", "2000000000000000000.00"])("does not format malformed known money %s", value => {
    expect(money(known(value))).toBe("Unavailable");
  });
  it("does not use the wider GP result domain as a wider input domain", () => {
    expect(profit(known("1999999999999999999.98"), known("0.00"), 2).amount.state).toBe("unavailable");
  });
  it("keeps exact rate digits and pads only known zeros", () => {
    expect(rate(known("1.2"))).toBe("$1.20"); expect(rate(known("1.234567"))).toBe("$1.234567");
    expect(rate(known("0.000001"))).toBe("$0.000001"); expect(quantity(known("99999999999999.999999"))).toBe("99999999999999.999999");
    expect(rate(known("1.2345678"))).toBe("Unavailable"); expect(quantity(known("100000000000000"))).toBe("Unavailable");
  });
  it("formats unavailable scalars consistently", () => {
    for (const formatter of [money, rate, quantity, percent]) expect(formatter(missing)).toBe("Unavailable");
  });
});

describe("safe read boundary with no mutation or coercion", () => {
  it("does not mutate the source or read unrelated columns", () => {
    const input = v2(), before = structuredClone(input), getter = vi.fn(() => { throw new Error("Unexpected read"); });
    Object.defineProperty(input, "unrelated", { get: getter });
    available(input); expect(getter).not.toHaveBeenCalled();
    expect(Object.fromEntries(Object.entries(input))).toEqual(before);
  });
  it("rejects a consumed getter without invoking it", () => {
    const input = v2(), getter = vi.fn(() => "100.00");
    Object.defineProperty(input, "subtotalPrice", { enumerable: true, get: getter });
    expect(build(input).state).toBe("unavailable"); expect(getter).not.toHaveBeenCalled();
  });
  it.each([null, [], new Date(), Object.create({ subtotalPrice: "1" })])("does not coerce non-plain input %#", input => {
    expect(build(input)).toMatchObject({ state: "unavailable", reason: "invalid_input" });
  });
  it.each([
    (x: any) => { delete x.lineItems[0]; },
    (x: any) => { Object.setPrototypeOf(x.lineItems[0], { quantity: "2" }); },
    (x: any) => { x.lineItems[0][Symbol("hidden")] = "value"; },
    (x: any) => { x.lineItems[0].cycle = x.lineItems[0]; },
    (x: any) => { class CustomArray extends Array {} Object.setPrototypeOf(x.lineItems, CustomArray.prototype); },
  ])("refuses unsafe nested projection %#", mutate => {
    const input = v2(); mutate(input); expect(build(input)).toMatchObject({ state: "unavailable", reason: "invalid_version_projection" });
  });
  it("does not invoke legacy scalar coercion hooks", () => {
    const hook = vi.fn(() => "100.00"), value = { toString: hook, valueOf: hook };
    expect(money(available(legacy({ subtotalCost: value })).summary.subtotalCost)).toBe("Unavailable");
    expect(hook).not.toHaveBeenCalled();
  });
});
