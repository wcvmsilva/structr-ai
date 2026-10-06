/** C2-B exact read aggregates. No DB, clock, pricing or approval effects. */
import { buildEstimateDisplay, deriveEstimateProfit, type EstimateDisplayResult, type DisplayScalar } from "./estimate-display";
import { PIPELINE_STAGE_WEIGHTS } from "./analytics-aggregation-engine";
import { ESTIMATE_AGGREGATE_VERSIONS, ESTIMATE_AGGREGATE_PROTOCOL, ESTIMATE_AGGREGATE_REASONS,
  ESTIMATE_OPPORTUNITY_STATUSES, ANALYTICS_FORECAST_UNAVAILABLE_REASON } from "./domain/taxonomy";
import type {
  EstimateAggregateReason, EstimateAggregateReadUnavailableReason,
} from "./domain/taxonomy";

export type AggregateCoverage = { populationCount: number; knownCount: number; unknownCount: number };
export type AggregateDecimal =
  | { state: "known"; value: string; coverage: AggregateCoverage }
  | { state: "unavailable"; reasons: EstimateAggregateReason[]; coverage: AggregateCoverage };
export type AggregateReadResult<T> = { state: "available"; data: T }
  | { state: "unavailable"; reason: EstimateAggregateReadUnavailableReason };
/** Keep only financial scalars after C1 validates the full row and its collections. */
export type AggregateEstimateDisplay = Pick<Extract<EstimateDisplayResult, { state: "available" }>, "state" | "representation" | "summary">
  | Extract<EstimateDisplayResult, { state: "unavailable" }>;
export type EstimateAggregateRow = {
  id: string; status: string; source: string | null; region: string | null; commercialChannel: string | null;
  supersededBy: string | null; changeOrderOf: string | null; historical: boolean;
  ageDays: number | null; display: AggregateEstimateDisplay;
};
export type LeadOpportunityRow = {
  id: string; stage: string; commercialChannel: string | null; ageDays: number | null;
};
export type EstimateDraftStatsExactV1 = {
  version: typeof ESTIMATE_AGGREGATE_VERSIONS.stats; currencyConvention: typeof ESTIMATE_AGGREGATE_PROTOCOL.currencyConvention;
  population: typeof ESTIMATE_AGGREGATE_PROTOCOL.statsPopulation; total: number;
  byStatus: Record<string, number>; bySource: Record<string, number>;
  byRegion: Array<{ region: string | null; count: number }>;
  excludedHistoricalCount: number;
  draftFinancials: { population: typeof ESTIMATE_AGGREGATE_PROTOCOL.draftPopulation; count: number; totalFinalPrice: AggregateDecimal;
    margin: AggregateDecimal; marginBasis: typeof ESTIMATE_AGGREGATE_PROTOCOL.marginBasis };
};
export type PipelineStageWeight = { state: "known"; numerator: string; denominator: string; basis: typeof ESTIMATE_AGGREGATE_PROTOCOL.weightBasis }
  | { state: "unavailable"; reason: "UNKNOWN_STAGE_WEIGHT" };
export type PipelineGroupExactV1 = {
  key: string | null; totalCount: number; leadCount: number; estimateCount: number;
  grossEstimateValue: AggregateDecimal; weightedEstimateValue: AggregateDecimal;
};
export type PipelineSummaryExactV1 = {
  version: typeof ESTIMATE_AGGREGATE_VERSIONS.pipeline; currencyConvention: typeof ESTIMATE_AGGREGATE_PROTOCOL.currencyConvention; basis: typeof ESTIMATE_AGGREGATE_PROTOCOL.pipelineBasis;
  totalCount: number; leadCount: number; estimateCount: number;
  grossEstimateValue: AggregateDecimal; weightedEstimateValue: AggregateDecimal;
  byStage: Array<PipelineGroupExactV1 & { weight: PipelineStageWeight }>;
  byChannel: PipelineGroupExactV1[];
  outsideEstimatePopulationByStatus: Record<string, number>; excludedHistoricalCount: number;
  stalledItems: Array<{ kind: "lead" | "estimate"; id: string; stage: string; ageDays: number; estimateValue: AggregateDecimal | null }>;
  medianAgeDays: number | null;
};
export type UnavailableRevenueForecast = { state: "unavailable"; reason: typeof ANALYTICS_FORECAST_UNAVAILABLE_REASON };

export class EstimateAggregateError extends Error {
  constructor(readonly code: EstimateAggregateReadUnavailableReason) {
    super(code === "COUNT_OVERFLOW" ? "Aggregate counts are unavailable."
      : code === "DB_UNAVAILABLE" ? "Aggregate storage is unavailable." : "Aggregate scan is incomplete.");
    this.name = "EstimateAggregateError";
  }
}

const MAX_ROW_MINOR = 10n ** 20n - 1n;
const MAX_AGGREGATE_MINOR = BigInt(Number.MAX_SAFE_INTEGER) * MAX_ROW_MINOR;
const abs = (value: bigint) => value < 0n ? -value : value;
function fixed2(value: bigint): string {
  const digits = abs(value).toString().padStart(3, "0");
  return `${value < 0n ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
function parseFixed(value: unknown, maximum: bigint): bigint | null {
  if (typeof value !== "string" || value.length > 40 || !/^-?(0|[1-9]\d*)\.\d{2}$/.test(value)) return null;
  const result = BigInt(value.replace(".", ""));
  return abs(result) <= maximum && !(result === 0n && value.startsWith("-")) ? result : null;
}
function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const magnitude = abs(numerator);
  const rounded = magnitude / denominator + (2n * (magnitude % denominator) >= denominator ? 1n : 0n);
  return numerator < 0n ? -rounded : rounded;
}
function own(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Invalid aggregate row.");
  return descriptor.value;
}
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function nullableText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new TypeError("Invalid aggregate row.");
  return value;
}
function finiteAge(value: number | null): number | null { return value !== null && Number.isFinite(value) ? value : null; }

/** Receives full selected rows; contextual historical evidence is supplied by the tenant-scoped reader. */
export function prepareEstimateAggregateRow(
  draft: unknown, context: { historicalImportId: string | null; ageDays: number | null },
): EstimateAggregateRow {
  if (!plain(draft)) throw new TypeError("Invalid aggregate row.");
  const id = own(draft, "id"), status = own(draft, "status");
  if (typeof id !== "string" || typeof status !== "string") throw new TypeError("Invalid aggregate row.");
  const source = nullableText(own(draft, "source"));
  const historicalImportId = nullableText(context.historicalImportId) ?? nullableText(own(draft, "historicalImportId"));
  // Copy descriptors, never evaluate unrelated accessors or strip version markers for C1.
  const contextual = historicalImportId === null ? draft : Object.create(Object.getPrototypeOf(draft), {
    ...Object.getOwnPropertyDescriptors(draft),
    historicalImportId: { value: historicalImportId, enumerable: true, configurable: true },
  });
  const display = buildEstimateDisplay(contextual);
  const legacy = display.state === "available" && display.representation === "legacy";
  const pricing = display.state === "available" && display.provenance.state === "known" ? display.provenance.pricing : null;
  return {
    id, status, source, supersededBy: nullableText(own(draft, "supersededBy")), changeOrderOf: nullableText(own(draft, "changeOrderOf")),
    historical: source === "historical_import" || historicalImportId !== null,
    region: legacy ? nullableText(own(draft, "region")) : pricing?.region ?? null,
    commercialChannel: legacy ? nullableText(own(draft, "commercialChannel")) : pricing?.commercialChannel ?? null,
    ageDays: finiteAge(context.ageDays), display: display.state === "available"
      ? { state: display.state, representation: display.representation, summary: display.summary } : display,
  };
}

export function checkedAggregateCount(...counts: number[]): number {
  let sum = 0;
  for (const value of counts) {
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - sum) throw new EstimateAggregateError("COUNT_OVERFLOW");
    sum += value;
  }
  return sum;
}
type Contribution = { amount: bigint } | { reasons: EstimateAggregateReason[] };
type Sum = { amount: bigint; count: number; known: number; reasons: Set<EstimateAggregateReason> };
const newSum = (): Sum => ({ amount: 0n, count: 0, known: 0, reasons: new Set() });
function add(sum: Sum, value: Contribution): void {
  sum.count = checkedAggregateCount(sum.count, 1);
  if ("amount" in value) { sum.known = checkedAggregateCount(sum.known, 1); sum.amount += value.amount; }
  else for (const reason of value.reasons) sum.reasons.add(reason);
}
function component(sum: Sum, mean = false): AggregateDecimal {
  const coverage = { populationCount: sum.count, knownCount: sum.known, unknownCount: sum.count - sum.known };
  if (sum.reasons.size > 0) return { state: "unavailable", reasons: ESTIMATE_AGGREGATE_REASONS.filter(reason => sum.reasons.has(reason)), coverage };
  if (mean && sum.count === 0) return { state: "unavailable", reasons: ["UNDEFINED_RATIO"], coverage };
  return { state: "known", value: fixed2(mean ? roundRatio(sum.amount, BigInt(sum.count)) : sum.amount), coverage };
}
function scalarContribution(value: DisplayScalar, maximum = MAX_ROW_MINOR): Contribution {
  if (value.state === "unavailable") return { reasons: [value.reason === "missing" ? "MISSING_VALUE" : value.reason === "undefined_ratio" ? "UNDEFINED_RATIO" : "INVALID_VALUE"] };
  const amount = parseFixed(value.value, maximum);
  return amount === null ? { reasons: ["INVALID_VALUE"] } : { amount };
}
function missingDisplay(display: AggregateEstimateDisplay): Contribution {
  return { reasons: [display.state === "unavailable" && display.reason === "invalid_version_projection" ? "INVALID_VERSION_PROJECTION" : "INVALID_VALUE"] };
}
function finalPrice(row: EstimateAggregateRow): Contribution {
  return row.display.state === "available" ? scalarContribution(row.display.summary.finalTotalPrice) : missingDisplay(row.display);
}
function currentMargin(row: EstimateAggregateRow): Contribution {
  if (row.display.state !== "available") return missingDisplay(row.display);
  const { finalTotalPrice, subtotalCost } = row.display.summary;
  // Deliberate rounding #1: every row's current GP is rounded to2 before the unweighted mean.
  return scalarContribution(deriveEstimateProfit(finalTotalPrice, subtotalCost, 2).percent, 10n ** 24n);
}
function countKey(map: Map<string, number>, key: string): void { map.set(key, checkedAggregateCount(map.get(key) ?? 0, 1)); }
function readResult<T>(compute: () => T): AggregateReadResult<T> {
  try { return { state: "available", data: compute() }; }
  catch (error) {
    if (error instanceof EstimateAggregateError && error.code === "COUNT_OVERFLOW") return { state: "unavailable", reason: "COUNT_OVERFLOW" };
    throw error;
  }
}
export function aggregateEstimateStats(rows: readonly EstimateAggregateRow[]): AggregateReadResult<EstimateDraftStatsExactV1> {
  return readResult(() => {
    let total = 0, excludedHistoricalCount = 0;
    const statuses = new Map<string, number>(), sources = new Map<string, number>(), regions = new Map<string | null, number>();
    const prices = newSum(), margins = newSum();
    for (const row of rows) {
      if (row.historical) { excludedHistoricalCount = checkedAggregateCount(excludedHistoricalCount, 1); continue; }
      total = checkedAggregateCount(total, 1); countKey(statuses, row.status); countKey(sources, row.source ?? "unknown");
      regions.set(row.region, checkedAggregateCount(regions.get(row.region) ?? 0, 1));
      if (row.status === "draft") { add(prices, finalPrice(row)); add(margins, currentMargin(row)); }
    }
    return {
      version: ESTIMATE_AGGREGATE_VERSIONS.stats, currencyConvention: ESTIMATE_AGGREGATE_PROTOCOL.currencyConvention,
      population: ESTIMATE_AGGREGATE_PROTOCOL.statsPopulation, total,
      byStatus: Object.fromEntries(statuses), bySource: Object.fromEntries(sources),
      byRegion: Array.from(regions, ([region, count]) => ({ region, count })), excludedHistoricalCount,
      draftFinancials: { population: ESTIMATE_AGGREGATE_PROTOCOL.draftPopulation, count: prices.count,
        totalFinalPrice: component(prices), margin: component(margins, true), marginBasis: ESTIMATE_AGGREGATE_PROTOCOL.marginBasis },
    };
  });
}

/** Existing finite decimal policy values become exact ratios; no default probability exists. */
function stageWeight(stage: string): PipelineStageWeight {
  const value = Object.hasOwn(PIPELINE_STAGE_WEIGHTS, stage) ? PIPELINE_STAGE_WEIGHTS[stage] : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return { state: "unavailable", reason: "UNKNOWN_STAGE_WEIGHT" };
  const [coefficient, exponentText = "0"] = String(value).split(/[eE]/);
  const [whole, fraction = ""] = coefficient.split(".");
  const places = fraction.length - Number(exponentText), scale = Math.max(2, places);
  const numerator = BigInt(whole + fraction) * 10n ** BigInt(scale - places);
  return { state: "known", numerator: numerator.toString(), denominator: (10n ** BigInt(scale)).toString(), basis: ESTIMATE_AGGREGATE_PROTOCOL.weightBasis };
}
function weightContribution(gross: Contribution, weight: PipelineStageWeight): Contribution {
  if ("reasons" in gross) return weight.state === "known" ? gross : { reasons: [...gross.reasons, "UNKNOWN_STAGE_WEIGHT"] };
  return weight.state === "known" ? { amount: roundRatio(gross.amount * BigInt(weight.numerator), BigInt(weight.denominator)) }
    : { reasons: ["UNKNOWN_STAGE_WEIGHT"] };
}
type Group = { key: string | null; leadCount: number; estimateCount: number; gross: Sum; weighted: Sum };
const newGroup = (key: string | null): Group => ({ key, leadCount: 0, estimateCount: 0, gross: newSum(), weighted: newSum() });
function addGroup(group: Group, kind: "lead" | "estimate", gross: Contribution | null, weighted: Contribution | null): void {
  if (kind === "lead") group.leadCount = checkedAggregateCount(group.leadCount, 1);
  else {
    if (gross === null || weighted === null) throw new TypeError("Missing estimate contribution.");
    group.estimateCount = checkedAggregateCount(group.estimateCount, 1); add(group.gross, gross); add(group.weighted, weighted);
  }
}
function groupView(group: Group): PipelineGroupExactV1 {
  return { key: group.key, totalCount: checkedAggregateCount(group.leadCount, group.estimateCount), leadCount: group.leadCount,
    estimateCount: group.estimateCount, grossEstimateValue: component(group.gross), weightedEstimateValue: component(group.weighted) };
}
function normalizedKey(value: string | null): string | null { return value === null ? null : value.trim().toLowerCase(); }
const eligibleStatuses = new Set<string>(ESTIMATE_OPPORTUNITY_STATUSES);
export function aggregateEstimateOpportunityPipeline(input: {
  estimates: readonly EstimateAggregateRow[]; leads: readonly LeadOpportunityRow[];
}): AggregateReadResult<PipelineSummaryExactV1> {
  return readResult(() => {
    const global = newGroup(null), stages = new Map<string, Group>(), channels = new Map<string | null, Group>();
    const stageWeights = new Map<string, PipelineStageWeight>(), outside = new Map<string, number>();
    const aged: PipelineSummaryExactV1["stalledItems"] = [];
    let excludedHistoricalCount = 0;
    function accept(kind: "lead" | "estimate", id: string, stage: string, channel: string | null, age: number | null, gross: Contribution | null) {
      const key = normalizedKey(stage)!;
      const weight = stageWeights.get(key) ?? stageWeight(key); stageWeights.set(key, weight);
      const weighted = gross === null ? null : weightContribution(gross, weight);
      const byStage = stages.get(key) ?? newGroup(key); stages.set(key, byStage);
      const channelKey = normalizedKey(channel), byChannel = channels.get(channelKey) ?? newGroup(channelKey); channels.set(channelKey, byChannel);
      for (const group of [global, byStage, byChannel]) addGroup(group, kind, gross, weighted);
      const ageDays = finiteAge(age);
      if (ageDays !== null) {
        const one = newSum(); if (kind === "estimate" && gross !== null) add(one, gross);
        aged.push({ kind, id, stage: key, ageDays, estimateValue: kind === "lead" ? null : component(one) });
      }
    }
    for (const lead of input.leads) accept("lead", lead.id, lead.stage, lead.commercialChannel, lead.ageDays, null);
    for (const row of input.estimates) {
      if (row.historical) { excludedHistoricalCount = checkedAggregateCount(excludedHistoricalCount, 1); continue; }
      if (row.supersededBy !== null || row.changeOrderOf !== null || !eligibleStatuses.has(row.status)) { countKey(outside, row.status); continue; }
      const stage = row.status === "sent" ? "estimate_sent" : row.status === "negotiation" ? "negotiation" : "estimate_draft";
      accept("estimate", row.id, stage, row.commercialChannel, row.ageDays, finalPrice(row));
    }
    const ages = aged.map(item => item.ageDays).sort((a, b) => a - b), middle = Math.floor(ages.length / 2);
    const median = ages.length === 0 ? null : ages.length % 2 ? ages[middle] : ages[middle - 1] / 2 + ages[middle] / 2;
    const medianAgeDays = median === null ? null : Math.round(median * 10) / 10;
    const stalledItems = medianAgeDays === null ? [] : aged.filter(item => item.ageDays > medianAgeDays * 2).sort((a, b) => b.ageDays - a.ageDays);
    const byStage = Array.from(stages, ([key, group]) => ({ ...groupView(group), weight: stageWeights.get(key)! })).sort((a, b) => {
      if (a.weight.state === "unavailable") return b.weight.state === "unavailable" ? 0 : 1;
      if (b.weight.state === "unavailable") return -1;
      const difference = BigInt(b.weight.numerator) * BigInt(a.weight.denominator) - BigInt(a.weight.numerator) * BigInt(b.weight.denominator);
      return difference < 0n ? -1 : difference > 0n ? 1 : 0;
    });
    const byChannel = Array.from(channels.values(), groupView).sort((a, b) => {
      const av = a.weightedEstimateValue, bv = b.weightedEstimateValue;
      if (av.state === "unavailable") return bv.state === "unavailable" ? 0 : 1;
      if (bv.state === "unavailable") return -1;
      const difference = parseFixed(bv.value, MAX_AGGREGATE_MINOR)! - parseFixed(av.value, MAX_AGGREGATE_MINOR)!;
      return difference < 0n ? -1 : difference > 0n ? 1 : 0;
    });
    const total = groupView(global);
    return { version: ESTIMATE_AGGREGATE_VERSIONS.pipeline, currencyConvention: ESTIMATE_AGGREGATE_PROTOCOL.currencyConvention,
      basis: ESTIMATE_AGGREGATE_PROTOCOL.pipelineBasis, totalCount: total.totalCount, leadCount: total.leadCount, estimateCount: total.estimateCount,
      grossEstimateValue: total.grossEstimateValue, weightedEstimateValue: total.weightedEstimateValue,
      byStage, byChannel, outsideEstimatePopulationByStatus: Object.fromEntries(outside), excludedHistoricalCount, stalledItems, medianAgeDays };
  });
}

/** Formatter for aggregate money only, preserving its wider domain and complete coverage. */
export function formatEstimateAggregateMoney(component: AggregateDecimal): string {
  try {
    if (!plain(component) || own(component, "state") !== "known") return "Unavailable";
    const c = own(component, "coverage");
    if (!plain(c)) return "Unavailable";
    const population = own(c, "populationCount"), known = own(c, "knownCount"), unknown = own(c, "unknownCount");
    if (typeof population !== "number" || typeof known !== "number" || typeof unknown !== "number"
      || checkedAggregateCount(known, unknown) !== population || unknown !== 0) return "Unavailable";
    const amount = parseFixed(own(component, "value"), BigInt(population) * MAX_ROW_MINOR);
    if (amount === null || abs(amount) > MAX_AGGREGATE_MINOR) return "Unavailable";
    const canonical = fixed2(abs(amount)), [whole, fraction] = canonical.split(".");
    return `${amount < 0n ? "-$" : "$"}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
  } catch { return "Unavailable"; }
}
