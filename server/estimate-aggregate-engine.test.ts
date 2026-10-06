/** C2-B pure complete-population aggregates. Synthetic facts, no authority or IO. */
import { afterEach, describe, expect, it } from "vitest";
import { buildEstimateDisplay } from "../shared/estimate-display";
import { PIPELINE_STAGE_WEIGHTS } from "../shared/analytics-aggregation-engine";
import {
  prepareEstimateAggregateRow as prepare, aggregateEstimateStats as stats,
  aggregateEstimateOpportunityPipeline as pipeline, formatEstimateAggregateMoney as money,
  checkedAggregateCount, EstimateAggregateError,
  type AggregateDecimal, type AggregateReadResult, type EstimateAggregateRow,
  type LeadOpportunityRow,
} from "../shared/estimate-aggregate-engine";

const id = (n: number) => `d6200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const max = "999999999999999999.99";
const coverage = (populationCount: number, knownCount = populationCount) => ({ populationCount, knownCount, unknownCount: populationCount - knownCount });
const known = (value: string, count: number): AggregateDecimal => ({ state: "known", value, coverage: coverage(count) });
const unknown = (reasons: string[], count: number, knownCount: number) => ({ state: "unavailable", reasons, coverage: coverage(count, knownCount) });
function data<T>(result: AggregateReadResult<T>): T {
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("Expected complete aggregate data");
  return result.data;
}
function legacy(patch: Record<string, unknown> = {}) {
  return { id: id(1), status: "draft", source: "assembly_calculator", region: "Synthetic", commercialChannel: "premium",
    supersededBy: null, changeOrderOf: null, a1VersionRequestId: null, a1VersionRequestHash: null,
    subtotalPrice: "100.00", subtotalCost: "40.00", discountAmount: "0.00", finalTotalPrice: "100.00",
    grossProfitPct: "99.99", lineItems: [], assemblySelections: [], ...patch };
}
function v2() {
  return { ...legacy(), tenantId: id(2), projectId: id(3), clientId: id(4), createdBy: id(5), supersedesId: id(6),
    source: "version", version: 2, a1VersionRequestId: id(7), a1VersionRequestHash: "a".repeat(64), discountApplied: false,
    zone: null, assemblyCount: 1, pricingSchemaVersion: null, scopeDraftId: null,
    pricingSnapshot: { channel: "direct", finishLevel: "standard", region: "Reviewed region", zone: null,
      trade: null, coastalModifier: null, commercialChannel: "trade", geoRiskClass: null },
    lineItems: [{ costGroupName: "Synthetic group", costItemName: "Synthetic line", description: null,
      quantity: "2", unit: "EA", unitCostSnapshot: "20", unitPriceSnapshot: "50", lineTotalCost: "40.00", lineTotalPrice: "100.00",
      assemblyId: id(8), costCode: "SYN-01", taxable: null }],
    assemblySelections: [{ assemblyId: id(8), assemblyName: "Synthetic assembly", assemblyCode: null, category: null,
      quantity: "2", unitCost: "20", unitPrice: "50", extendedCost: "40.00", extendedPrice: "100.00" }],
  };
}
/** Classified-row fixture tests aggregation independently from the new row adapter. */
function row(patch: Record<string, unknown> = {}, facts: Partial<EstimateAggregateRow> = {}): EstimateAggregateRow {
  const source = legacy(patch);
  return { id: String(source.id), status: String(source.status), source: source.source as string | null,
    region: source.region as string | null, commercialChannel: source.commercialChannel as string | null,
    supersededBy: source.supersededBy as string | null, changeOrderOf: source.changeOrderOf as string | null,
    historical: false, ageDays: null, display: buildEstimateDisplay(source), ...facts };
}
function lead(patch: Partial<LeadOpportunityRow> = {}): LeadOpportunityRow {
  return { id: id(20), stage: "qualified", commercialChannel: "premium", ageDays: null, ...patch };
}
const originalWeights = { ...PIPELINE_STAGE_WEIGHTS };
afterEach(() => { for (const key of Object.keys(PIPELINE_STAGE_WEIGHTS)) delete PIPELINE_STAGE_WEIGHTS[key]; Object.assign(PIPELINE_STAGE_WEIGHTS, originalWeights); });

describe("complete C1 row preparation", () => {
  it.each([{}, { a1VersionRequestId: null, a1VersionRequestHash: null }])("retains legacy money and raw grouping %#", markers => {
    const value = legacy(markers); const before = structuredClone(value);
    const result = prepare(value, { historicalImportId: null, ageDays: 4 });
    expect(result).toMatchObject({ id: id(1), status: "draft", source: "assembly_calculator", region: "Synthetic", commercialChannel: "premium", historical: false, ageDays: 4 });
    expect(result.display).toMatchObject({ state: "available", representation: "legacy", summary: { finalTotalPrice: { state: "known", value: "100.00" } } });
    expect(value).toEqual(before);
  });
  it("uses the validated v2 commercial channel and region, not flattened alternatives", () => {
    const result = prepare(v2(), { historicalImportId: null, ageDays: null });
    expect(result).toMatchObject({ region: "Reviewed region", commercialChannel: "trade", historical: false });
    expect(result.display).toMatchObject({ state: "available", representation: "v2" });
  });
  it("does not retain line/selection payload after complete C1 validation", () => {
    const input = v2(); const before = structuredClone(input);
    const result = prepare(input, { historicalImportId: null, ageDays: null });
    expect(result.display.state).toBe("available");
    expect(Object.keys(result.display).sort()).toEqual(["representation", "state", "summary"]);
    expect(result.display).toMatchObject({ summary: { finalTotalPrice: { state: "known", value: "100.00" } } });
    expect(result).toMatchObject({ region: "Reviewed region", commercialChannel: "trade" });
    expect(input).toEqual(before);
  });
  it("validates complete line payload before producing a compact financial projection", () => {
    const input = v2(); input.lineItems[0].lineTotalPrice = "99.99";
    const result = prepare(input, { historicalImportId: null, ageDays: null });
    expect(result.display).toMatchObject({ state: "unavailable", reason: "invalid_version_projection" });
    expect(result).toMatchObject({ region: null, commercialChannel: null });
  });
  it("preserves explicit null v2 grouping without a flattened fallback", () => {
    const value = v2(); Object.assign(value.pricingSnapshot, { region: null, commercialChannel: null });
    expect(prepare(value, { historicalImportId: null, ageDays: null })).toMatchObject({ region: null, commercialChannel: null });
  });
  it.each([
    { a1VersionRequestId: id(7), a1VersionRequestHash: null }, { a1VersionRequestId: null, a1VersionRequestHash: "a".repeat(64) },
    { a1VersionRequestId: undefined, a1VersionRequestHash: undefined },
  ])("keeps malformed v2 counted but its display and grouping unresolved %#", markers => {
    const result = prepare(legacy({ ...markers, source: "version" }), { historicalImportId: null, ageDays: null });
    expect(result).toMatchObject({ id: id(1), status: "draft", historical: false, region: null, commercialChannel: null,
      display: { state: "unavailable", reason: "invalid_version_projection" } });
  });
  it.each([
    ["source", "historical_import", null], ["link", "assembly_calculator", id(9)], ["both", "historical_import", id(9)],
  ])("marks %s historical without interpreting money", (_, source, historicalImportId) => {
    const result = prepare(legacy({ source, finalTotalPrice: "private-not-money" }), { historicalImportId, ageDays: 1 });
    expect(result.historical).toBe(true);
    expect(result.display).toMatchObject({ state: "unavailable", reason: "historical_capture" });
    expect(JSON.stringify(result.display)).not.toContain("private-not-money");
  });
  it("retains exact decimal exponents through the C1 legacy parser", () => {
    const result = prepare(legacy({ finalTotalPrice: "1.5e3", subtotalCost: "3e2" }), { historicalImportId: null, ageDays: null });
    expect(result.display).toMatchObject({ summary: { finalTotalPrice: { value: "1500.00" }, subtotalCost: { value: "300.00" } } });
  });
});

describe("exact estimate statistics", () => {
  it("distinguishes a complete empty population from an unavailable read", () => {
    const result = data(stats([]));
    expect(result).toEqual({ version: "estimate-draft-stats-exact-v1", currencyConvention: "USD_display_only", population: "all_nonhistorical_records",
      total: 0, byStatus: {}, bySource: {}, byRegion: [], excludedHistoricalCount: 0,
      draftFinancials: { population: "status_draft", count: 0, totalFinalPrice: known("0.00", 0), margin: unknown(["UNDEFINED_RATIO"], 0, 0), marginBasis: "mean_displayed_current_gp_2dp" } });
  });
  it("sums two maximum stored amounts without losing their final cent", () => {
    const result = data(stats([row({ finalTotalPrice: max }), row({ finalTotalPrice: max })]));
    expect(result.draftFinancials.totalFinalPrice).toEqual(known("1999999999999999999.98", 2));
  });
  it("preserves signed cancellation exactly", () => {
    expect(data(stats([row({ finalTotalPrice: max }), row({ finalTotalPrice: "-999999999999999999.98" })])).draftFinancials.totalFinalPrice).toEqual(known("0.01", 2));
  });
  it.each([100, "1e2", " 100.00 ", "100.00"])("preserves supported legacy scalar %s", finalTotalPrice => {
    expect(data(stats([row({ finalTotalPrice })])).draftFinancials.totalFinalPrice).toEqual(known("100.00", 1));
  });
  it("does not trust stored GP or use the one-decimal legacy display margin", () => {
    const result = data(stats([row({ finalTotalPrice: "3.00", subtotalCost: "2.00", grossProfitPct: "99.99" })]));
    expect(result.draftFinancials.margin).toEqual(known("33.33", 1));
  });
  it("uses the ratified two rounding steps rather than a portfolio ratio", () => {
    const result = data(stats([row({ finalTotalPrice: "3.00", subtotalCost: "2.00" }), row({ finalTotalPrice: "100.00", subtotalCost: "50.00" })]));
    expect(result.draftFinancials.margin).toEqual(known("41.67", 2));
    expect(result.draftFinancials.marginBasis).toBe("mean_displayed_current_gp_2dp");
  });
  it.each([
    ["0.01", "200.00", "0.01"], ["-0.01", "200.00", "-0.01"],
  ])("rounds the individual signed %s profit midpoint away from zero", (profit, price, expected) => {
    const cost = profit === "0.01" ? "199.99" : "200.01";
    expect(data(stats([row({ finalTotalPrice: price, subtotalCost: cost })])).draftFinancials.margin).toEqual(known(expected, 1));
  });
  it.each([["1.00", "0.99", "0.50"], ["1.00", "1.01", "-0.50"]])("rounds signed mean from %s/%s without Math.round bias", (price, cost, expected) => {
    expect(data(stats([row({ finalTotalPrice: price, subtotalCost: cost }), row({ finalTotalPrice: "100.00", subtotalCost: "100.00" })])).draftFinancials.margin).toEqual(known(expected, 2));
  });
  it("rounds the mean half-hundredth away from zero", () => {
    expect(data(stats([row({ finalTotalPrice: "200.00", subtotalCost: "200.01" }), row({ finalTotalPrice: "1.00", subtotalCost: "1.00" })])).draftFinancials.margin).toEqual(known("-0.01", 2));
  });
  it.each([[null, "MISSING_VALUE"], [undefined, "MISSING_VALUE"], ["broken", "INVALID_VALUE"], [NaN, "INVALID_VALUE"], ["1.001", "INVALID_VALUE"]])("marks final=%s unknown without excluding it", (finalTotalPrice, reason) => {
    const result = data(stats([row(), row({ finalTotalPrice, subtotalPrice: "999.00" })]));
    expect(result.total).toBe(2); expect(result.draftFinancials.count).toBe(2);
    expect(result.draftFinancials.totalFinalPrice).toEqual(unknown([reason], 2, 1));
    expect(result.draftFinancials.margin).toEqual(unknown([reason], 2, 1));
  });
  it("missing cost affects the margin but not the known final total", () => {
    const result = data(stats([row(), row({ subtotalCost: null })]));
    expect(result.draftFinancials.totalFinalPrice).toEqual(known("200.00", 2));
    expect(result.draftFinancials.margin).toEqual(unknown(["MISSING_VALUE"], 2, 1));
  });
  it.each(["0.00", "-1.00"])("keeps %s as known money and rejects its undefined margin", finalTotalPrice => {
    const result = data(stats([row({ finalTotalPrice })]));
    expect(result.draftFinancials.totalFinalPrice).toEqual(known(finalTotalPrice, 1));
    expect(result.draftFinancials.margin).toEqual(unknown(["UNDEFINED_RATIO"], 1, 0));
  });
  it("deduplicates unknown reasons in canonical order with full coverage", () => {
    const result = data(stats([row({ finalTotalPrice: "bad" }), row({ finalTotalPrice: null }), row({ finalTotalPrice: "bad" }), row()]));
    expect(result.draftFinancials.totalFinalPrice).toEqual(unknown(["MISSING_VALUE", "INVALID_VALUE"], 4, 1));
  });
  it("counts malformed v2 while making only its dependent money unknown", () => {
    const bad = prepare(legacy({ a1VersionRequestId: id(7), a1VersionRequestHash: null }), { historicalImportId: null, ageDays: null });
    const result = data(stats([row(), bad]));
    expect(result.total).toBe(2); expect(result.byRegion).toContainEqual({ region: null, count: 1 });
    expect(result.draftFinancials.totalFinalPrice).toEqual(unknown(["INVALID_VERSION_PROJECTION"], 2, 1));
  });
  it("counts all nonhistorical statuses and sums only raw draft status, including superseded draft", () => {
    const records = [row(), row({ status: "archived" }), row({ status: "internally_approved" }), row({ status: "internal_approval_revoked" }), row({ supersededBy: id(12), finalTotalPrice: "7.00" }), row({}, { historical: true })];
    const result = data(stats(records));
    expect(result.total).toBe(5); expect(result.excludedHistoricalCount).toBe(1);
    expect(result.byStatus).toEqual({ draft: 2, archived: 1, internally_approved: 1, internal_approval_revoked: 1 });
    expect(result.draftFinancials.totalFinalPrice).toEqual(known("107.00", 2));
  });
  it("keeps unknown region and nullable legacy source as explicit groups", () => {
    const result = data(stats([row({ source: null, region: null }), row({ source: null, region: "" })]));
    expect(result.bySource).toEqual({ unknown: 2 });
    expect(result.byRegion).toContainEqual({ region: null, count: 1 });
    expect(result.byRegion).toContainEqual({ region: "", count: 1 });
  });
  it("does not let stored prototype keys alter count maps", () => {
    const result = data(stats([row({ status: "__proto__", source: "constructor" }), row({ status: "constructor", source: "__proto__" })]));
    expect(Object.hasOwn(result.byStatus, "__proto__")).toBe(true); expect(result.byStatus["__proto__"]).toBe(1);
    expect(Object.hasOwn(result.bySource, "__proto__")).toBe(true); expect(result.bySource.constructor).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result)).byStatus["__proto__"]).toBe(1);
  });
});

describe("exact opportunity populations and weights", () => {
  it("has a known empty money population with no invented lead prices", () => {
    const result = data(pipeline({ estimates: [], leads: [lead(), lead({ id: id(21) })] }));
    expect(result).toMatchObject({ version: "estimate-opportunity-pipeline-exact-v1", currencyConvention: "USD_display_only", basis: "opportunity_only", totalCount: 2, leadCount: 2, estimateCount: 0 });
    expect(result.grossEstimateValue).toEqual(known("0.00", 0)); expect(result.weightedEstimateValue).toEqual(known("0.00", 0));
    expect(result.byStage[0]).toMatchObject({ key: "qualified", totalCount: 2, leadCount: 2, estimateCount: 0, grossEstimateValue: known("0.00", 0) });
  });
  it.each([["draft", "estimate_draft", "50"], ["under_review", "estimate_draft", "50"], ["sent", "estimate_sent", "60"], ["negotiation", "negotiation", "70"]])("maps existing estimate status %s to %s", (status, stage, amount) => {
    const result = data(pipeline({ estimates: [row({ status })], leads: [] }));
    expect(result.weightedEstimateValue).toEqual(known(`${amount}.00`, 1));
    expect(result.byStage[0]).toMatchObject({ key: stage, weight: { state: "known", numerator: amount, denominator: "100", basis: "existing_stage_policy" } });
  });
  it.each([["0.01", "0.01"], ["-0.01", "-0.01"], ["0.03", "0.02"], ["-0.03", "-0.02"], ["0.02", "0.01"], ["-0.02", "-0.01"]])("rounds %s at one-half per item to %s", (value, weighted) => {
    const result = data(pipeline({ estimates: [row({ finalTotalPrice: value })], leads: [] }));
    expect(result.grossEstimateValue).toEqual(known(value, 1)); expect(result.weightedEstimateValue).toEqual(known(weighted, 1));
  });
  it("sums rounded contributions rather than rounding the stage total", () => {
    const result = data(pipeline({ estimates: [row({ finalTotalPrice: "0.01" }), row({ finalTotalPrice: "0.01" })], leads: [] }));
    expect(result.weightedEstimateValue).toEqual(known("0.02", 2));
    expect(result.byStage[0].weightedEstimateValue).toEqual(known("0.02", 2));
  });
  it("does not fall back to a stage probability when its policy weight is absent", () => {
    delete PIPELINE_STAGE_WEIGHTS.estimate_draft;
    const result = data(pipeline({ estimates: [row(), row({ status: "sent" })], leads: [] }));
    expect(result.grossEstimateValue).toEqual(known("200.00", 2));
    expect(result.weightedEstimateValue).toEqual(unknown(["UNKNOWN_STAGE_WEIGHT"], 2, 1));
    expect(result.byStage.find(stage => stage.key === "estimate_draft")?.weight).toEqual({ state: "unavailable", reason: "UNKNOWN_STAGE_WEIGHT" });
  });
  it("does not let an unknown volume-only stage poison weighted estimate money", () => {
    const result = data(pipeline({ estimates: [row()], leads: [lead({ stage: "custom_stage" })] }));
    expect(result.weightedEstimateValue).toEqual(known("50.00", 1));
    expect(result.byStage.find(stage => stage.key === "custom_stage")?.weight).toEqual({ state: "unavailable", reason: "UNKNOWN_STAGE_WEIGHT" });
  });
  it.each(["approved", "sent_to_estimate", "internally_approved", "internal_approval_revoked", "rejected", "archived"])("reports %s only outside the opportunity value population", status => {
    const result = data(pipeline({ estimates: [row({ status })], leads: [] }));
    expect(result.totalCount).toBe(0); expect(result.outsideEstimatePopulationByStatus).toEqual({ [status]: 1 });
    expect(result.grossEstimateValue).toEqual(known("0.00", 0));
    expect(result).not.toHaveProperty("approvedBudgetCents"); expect(result).not.toHaveProperty("authorized");
  });
  it.each([{ supersededBy: id(12) }, { changeOrderOf: id(12) }])("preserves current/non-CO selection without losing excluded counts %#", patch => {
    const result = data(pipeline({ estimates: [row(patch)], leads: [] }));
    expect(result.estimateCount).toBe(0); expect(result.outsideEstimatePopulationByStatus).toEqual({ draft: 1 });
  });
  it("accounts for historical once without classifying it as an opportunity or outside status", () => {
    const result = data(pipeline({ estimates: [row({ status: "approved" }, { historical: true })], leads: [] }));
    expect(result.excludedHistoricalCount).toBe(1); expect(result.outsideEstimatePopulationByStatus).toEqual({}); expect(result.totalCount).toBe(0);
  });
  it("propagates missing final to both monetary components without subtotal fallback", () => {
    const result = data(pipeline({ estimates: [row(), row({ finalTotalPrice: null, subtotalPrice: "1000.00" })], leads: [] }));
    expect(result.estimateCount).toBe(2); expect(result.grossEstimateValue).toEqual(unknown(["MISSING_VALUE"], 2, 1));
    expect(result.weightedEstimateValue).toEqual(unknown(["MISSING_VALUE"], 2, 1));
  });
  it("groups known amounts and unknown channels without loss", () => {
    const result = data(pipeline({ estimates: [row(), row({ status: "sent", commercialChannel: null, finalTotalPrice: "40.00" })], leads: [lead()] }));
    expect(result.grossEstimateValue).toEqual(known("140.00", 2)); expect(result.weightedEstimateValue).toEqual(known("74.00", 2));
    expect(result.byChannel).toContainEqual({ key: null, totalCount: 1, leadCount: 0, estimateCount: 1, grossEstimateValue: known("40.00", 1), weightedEstimateValue: known("24.00", 1) });
    expect(result.byChannel.find(group => group.key === "premium")).toMatchObject({ totalCount: 2, leadCount: 1, estimateCount: 1, grossEstimateValue: known("100.00", 1), weightedEstimateValue: known("50.00", 1) });
  });
  it("preserves current stage/channel normalization without unsafe object keys", () => {
    const result = data(pipeline({ estimates: [row({ commercialChannel: " __PROTO__ " })], leads: [lead({ stage: " QUALIFIED ", commercialChannel: " TRADE " })] }));
    expect(result.byStage.map(group => group.key)).toContain("qualified");
    expect(result.byChannel.map(group => group.key)).toEqual(expect.arrayContaining(["__proto__", "trade"]));
  });
  it("uses age facts and distinguishes stalled volume from estimate value", () => {
    const result = data(pipeline({ estimates: [row({}, { ageDays: 2 }), row({ id: id(2) }, { ageDays: 30 })],
      leads: [lead({ ageDays: 1 }), lead({ id: id(21), ageDays: 50 }), lead({ id: id(22), ageDays: null })] }));
    expect(result.medianAgeDays).toBe(16);
    expect(result.stalledItems).toEqual([{ kind: "lead", id: id(21), stage: "qualified", ageDays: 50, estimateValue: null }]);
  });
  it("stalled estimate uses exact component value instead of numeric cents", () => {
    const result = data(pipeline({ estimates: [row({}, { ageDays: 1 }), row({ id: id(2), finalTotalPrice: max }, { ageDays: 50 }), row({ id: id(3) }, { ageDays: 2 })], leads: [] }));
    expect(result.stalledItems).toEqual([{ kind: "estimate", id: id(2), stage: "estimate_draft", ageDays: 50, estimateValue: known(max, 1) }]);
    expect(JSON.stringify(result)).not.toContain("valueCents");
  });
});

describe("safe exact transport and aggregate formatting", () => {
  it.each([[0, 0], [3, 4], [Number.MAX_SAFE_INTEGER, 0]])("adds safe count facts %s + %s", (a, b) => {
    expect(checkedAggregateCount(a, b)).toBe(a + b);
  });
  it.each([[Number.MAX_SAFE_INTEGER, 1], [NaN, 0], [Infinity, 0], [-1, 2], [0.5, 1]])("refuses invalid/overflow count facts %s + %s", (a, b) => {
    expect(() => checkedAggregateCount(a, b)).toThrow(expect.objectContaining({ code: "COUNT_OVERFLOW" }));
  });
  it("does not expose private values in count failure", () => {
    expect(new EstimateAggregateError("COUNT_OVERFLOW").message).toBe("Aggregate counts are unavailable.");
  });
  it.each([
    ["0.00", 0, "$0.00"], ["1999999999999999999.98", 2, "$1,999,999,999,999,999,999.98"],
    ["-1999999999999999999.98", 2, "-$1,999,999,999,999,999,999.98"],
    ["9007199254740990999909928007452590.09", Number.MAX_SAFE_INTEGER, "$9,007,199,254,740,990,999,909,928,007,452,590.09"],
  ])("formats aggregate %s without the stored-row bound", (value, count, expected) => {
    expect(money(known(value, count))).toBe(expected);
  });
  it.each(["-0.00", "1e3", "1.0", "1.000", "+1.00", "01.00", " 1.00 ", "10000000000000000000000000000000000.00"])("rejects noncanonical or overflow aggregate %s", value => {
    expect(money(known(value, Number.MAX_SAFE_INTEGER))).toBe("Unavailable");
  });
  it("rejects a known monetary value greater than its complete population can contain", () => {
    expect(money(known("1.00", 0))).toBe("Unavailable");
    expect(money(known("1000000000000000000.00", 1))).toBe("Unavailable");
  });
  it("does not print a partial value from an unavailable component", () => {
    expect(money({ state: "unavailable", reasons: ["MISSING_VALUE"], coverage: coverage(2, 1) })).toBe("Unavailable");
  });
  it("rejects coverage that silently omits an unknown contributor", () => {
    expect(money({ state: "known", value: "100.00", coverage: coverage(2, 1) })).toBe("Unavailable");
  });
  it("keeps exact known transport JSON-safe and omits numeric monetary aliases", () => {
    const result = data(pipeline({ estimates: [row({ finalTotalPrice: max })], leads: [] }));
    const transported = JSON.parse(JSON.stringify(result));
    expect(transported.grossEstimateValue.value).toBe(max);
    expect(transported).not.toHaveProperty("grossValueCents"); expect(transported).not.toHaveProperty("weightedValueCents");
  });
});
