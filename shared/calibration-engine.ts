/**
 * structr.ai — PHASE 4 Calibration Engine (PURE)
 *
 * Turns finished work into measured findings about the estimating engine.
 *
 * Contract: docs/phase4-contract.md §2 (CL-001 … CL-006)
 *
 * Three rules govern everything in this file:
 *
 *   1. **Evidence, not authority.** Every function here returns a *finding*. A finding may
 *      carry a suggested adjustment, but nothing in this module can change a price. The only
 *      path to the price book is a `price_adjustments` row approved by a human (PA-002).
 *
 *   2. **Median over mean.** One catastrophic project must not reprice a cost code. The bias
 *      direction and the suggested adjustment are driven by the median deviation; the mean is
 *      reported alongside it so the operator can see when the two disagree — that gap *is*
 *      the signal that one job was an outlier.
 *
 *   3. **Damped and capped.** A proposal closes at most `ADJUSTMENT_DAMPING_FACTOR` of the
 *      observed gap and never exceeds `MAX_ADJUSTMENT_PCT`. A price book that chases the last
 *      project oscillates; one that moves 60% of the way converges.
 *
 * PURE module: no DB, no IO, no clock (timestamps arrive as arguments), no randomness.
 */

import {
  BIAS_CONSISTENCY_THRESHOLD,
  DEFAULT_BIAS_TOLERANCE_PCT,
  MIN_SAMPLES_FOR_CONFIDENCE,
  SAMPLE_SATURATION_COUNT,
  MAX_ADJUSTMENT_PCT,
  MIN_ADJUSTMENT_PCT,
  ADJUSTMENT_DAMPING_FACTOR,
  bandAllowsProposal,
  confidenceBandFor,
  type BiasDirection,
  type CalibrationEventType,
  type ConfidenceBand,
} from "./domain/phase4-taxonomy";
import { formatCents } from "./actuals-variance-engine";

// ══════════════════════════════════════════════════════════════════════
// NUMERIC HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Round to one decimal place, the precision the whole platform reports percentages in. */
export function round1(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/** Round to two decimal places, used for factors (e.g. a coastal multiplier). */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Arithmetic mean; empty input is 0, never NaN. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Median. Even-length input averages the two central values.
 * Preferred over the mean everywhere a decision is made (see rule 2 above).
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Population standard deviation; a single sample has zero dispersion, not NaN. */
export function stdDev(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / values.length);
}

/**
 * Deviation of an actual against an estimate, in percent.
 *
 * Returns null when there is no estimate to deviate from: a cost code with zero budget is
 * not "infinitely wrong on price", it is a scope failure and belongs to the scope engine.
 */
export function deviationPct(estimatedCents: number, actualCents: number): number | null {
  const estimated = Math.round(estimatedCents);
  if (estimated <= 0) return null;
  const actual = Math.round(actualCents);
  return round1(((actual - estimated) / estimated) * 100);
}

// ══════════════════════════════════════════════════════════════════════
// CONFIDENCE (CL-004)
// ══════════════════════════════════════════════════════════════════════

export interface ConfidenceResult {
  /** 0–100. */
  score: number;
  band: ConfidenceBand;
  sampleCount: number;
  /** Share of samples pointing in the dominant direction, 0–1. */
  consistency: number;
  /** Standard deviation of the sample deviations, percent. */
  dispersionPct: number;
  /** Human-readable reason the score is what it is. */
  rationale: string;
}

/**
 * Confidence in a finding, from three independent components:
 *
 *   - **volume** (50%): how many closed projects support it, saturating at 12. Three jobs is
 *     the minimum to say anything; twelve is where more data stops changing the answer.
 *   - **consistency** (30%): how often the samples agree on the direction. Five projects that
 *     alternate over and under carry no pricing signal at all.
 *   - **stability** (20%): inverse of dispersion. Deviations of 8/9/10% are actionable;
 *     deviations of 2/40/-15% averaging the same number are not.
 *
 * Below `MIN_SAMPLES_FOR_CONFIDENCE` the band is `insufficient` regardless of the score, so a
 * single spectacular overrun can never reach the proposal threshold.
 */
export function computeConfidence(input: {
  deviations: readonly number[];
  /** Tolerance below which a deviation counts as neutral rather than directional. */
  tolerancePct?: number;
}): ConfidenceResult {
  const deviations = input.deviations.filter(d => Number.isFinite(d));
  const tolerance = Math.abs(input.tolerancePct ?? DEFAULT_BIAS_TOLERANCE_PCT);
  const sampleCount = deviations.length;

  if (sampleCount === 0) {
    return {
      score: 0,
      band: "insufficient",
      sampleCount: 0,
      consistency: 0,
      dispersionPct: 0,
      rationale: "No closed samples available.",
    };
  }

  const over = deviations.filter(d => d > tolerance).length;
  const under = deviations.filter(d => d < -tolerance).length;
  const directional = over + under;
  const consistency = directional === 0 ? 0 : Math.max(over, under) / directional;

  const dispersionPct = round1(stdDev(deviations));

  const volumeComponent = Math.min(1, sampleCount / SAMPLE_SATURATION_COUNT) * 50;
  const consistencyComponent = consistency * 30;
  // Dispersion of 30 percentage points or more contributes nothing.
  const stabilityComponent = Math.max(0, 1 - dispersionPct / 30) * 20;

  const score = round1(volumeComponent + consistencyComponent + stabilityComponent);
  const band = confidenceBandFor(score, sampleCount);

  const rationale =
    sampleCount < MIN_SAMPLES_FOR_CONFIDENCE
      ? `Only ${sampleCount} closed sample(s); ${MIN_SAMPLES_FOR_CONFIDENCE} are required before a finding is actionable.`
      : `${sampleCount} samples, ${Math.round(consistency * 100)}% directional agreement, ${dispersionPct}pp dispersion.`;

  return { score, band, sampleCount, consistency, dispersionPct, rationale };
}

// ══════════════════════════════════════════════════════════════════════
// BIAS DETECTION (§2)
// ══════════════════════════════════════════════════════════════════════

export interface BiasResult {
  direction: BiasDirection;
  meanDeviationPct: number;
  medianDeviationPct: number;
  stdDevPct: number;
  sampleCount: number;
  overrunCount: number;
  underrunCount: number;
  consistency: number;
  tolerancePct: number;
}

/**
 * Classify the bias of a set of deviations.
 *
 * `inconsistent` is a first-class answer, not a failure: when direction flips project to
 * project, the driver is scope definition or field execution, and repricing the item would
 * hide the real problem. That is why it never produces a price proposal.
 */
export function detectBias(
  deviations: readonly number[],
  tolerancePct: number = DEFAULT_BIAS_TOLERANCE_PCT,
): BiasResult {
  const samples = deviations.filter(d => Number.isFinite(d));
  const tolerance = Math.abs(tolerancePct);
  const overrunCount = samples.filter(d => d > tolerance).length;
  const underrunCount = samples.filter(d => d < -tolerance).length;
  const directional = overrunCount + underrunCount;
  const consistency = directional === 0 ? 0 : Math.max(overrunCount, underrunCount) / directional;

  const med = round1(median(samples));
  const avg = round1(mean(samples));
  const dispersion = round1(stdDev(samples));

  let direction: BiasDirection;
  if (samples.length === 0) {
    direction = "accurate";
  } else if (Math.abs(med) <= tolerance && directional <= samples.length / 2) {
    direction = "accurate";
  } else if (directional === 0) {
    direction = "accurate";
  } else if (consistency < BIAS_CONSISTENCY_THRESHOLD) {
    direction = "inconsistent";
  } else if (overrunCount >= underrunCount) {
    // Actual above estimate: the estimate was too low.
    direction = "underestimates";
  } else {
    direction = "overestimates";
  }

  return {
    direction,
    meanDeviationPct: avg,
    medianDeviationPct: med,
    stdDevPct: dispersion,
    sampleCount: samples.length,
    overrunCount,
    underrunCount,
    consistency,
    tolerancePct: tolerance,
  };
}

// ══════════════════════════════════════════════════════════════════════
// SUGGESTED ADJUSTMENT (PA-001)
// ══════════════════════════════════════════════════════════════════════

export interface SuggestedAdjustment {
  /** Damped and capped percentage, sign carries the direction. Zero means "do nothing". */
  adjustmentPct: number;
  /** True when the raw deviation was clipped by `MAX_ADJUSTMENT_PCT`. */
  capped: boolean
  /** True when the magnitude is below `MIN_ADJUSTMENT_PCT` and therefore not worth proposing. */
  belowNoiseFloor: boolean;
  rawDeviationPct: number;
  rationale: string;
}

/**
 * Convert an observed bias into the adjustment the platform is willing to propose.
 *
 * Deliberately conservative: damping first, then cap, then a noise floor. A 3% observed
 * deviation damped to 1.8% is dropped entirely — repricing the book for that is churn.
 */
export function suggestAdjustment(input: {
  bias: BiasResult;
  band: ConfidenceBand;
  maxAdjustmentPct?: number;
}): SuggestedAdjustment {
  const { bias, band } = input;
  const maxPct = Math.min(Math.abs(input.maxAdjustmentPct ?? MAX_ADJUSTMENT_PCT), MAX_ADJUSTMENT_PCT);
  const raw = bias.medianDeviationPct;

  if (bias.direction === "accurate") {
    return {
      adjustmentPct: 0,
      capped: false,
      belowNoiseFloor: true,
      rawDeviationPct: raw,
      rationale: "Deviation is within tolerance; the price book is already right.",
    };
  }

  if (bias.direction === "inconsistent") {
    return {
      adjustmentPct: 0,
      capped: false,
      belowNoiseFloor: true,
      rawDeviationPct: raw,
      rationale:
        "Direction flips between projects: this is a scope or execution problem, not a price problem. Repricing would hide it.",
    };
  }

  if (!bandAllowsProposal(band)) {
    return {
      adjustmentPct: 0,
      capped: false,
      belowNoiseFloor: true,
      rawDeviationPct: raw,
      rationale: `Confidence band is ${band}; evidence is too weak to move a price.`,
    };
  }

  const damped = raw * ADJUSTMENT_DAMPING_FACTOR;
  const capped = Math.abs(damped) > maxPct;
  const bounded = capped ? Math.sign(damped) * maxPct : damped;
  const adjustmentPct = round1(bounded);
  const belowNoiseFloor = Math.abs(adjustmentPct) < MIN_ADJUSTMENT_PCT;

  const rationale = belowNoiseFloor
    ? `Damped adjustment of ${adjustmentPct}% is below the ${MIN_ADJUSTMENT_PCT}% noise floor; no change proposed.`
    : capped
      ? `Observed median deviation of ${raw}% capped at the platform limit of ${maxPct}%. Review the underlying jobs before applying.`
      : `Median deviation of ${raw}% damped by ${Math.round(ADJUSTMENT_DAMPING_FACTOR * 100)}% to converge instead of oscillate.`;

  return {
    adjustmentPct: belowNoiseFloor ? 0 : adjustmentPct,
    capped,
    belowNoiseFloor,
    rawDeviationPct: raw,
    rationale,
  };
}

// ══════════════════════════════════════════════════════════════════════
// SAMPLE INPUTS
// ══════════════════════════════════════════════════════════════════════

/** One closed project's outcome for one cost code. */
export interface CostCodeSample {
  projectId: string;
  projectType?: string | null;
  costCode: string;
  costCodeId?: string | null;
  costCodeName?: string | null;
  estimatedCents: number;
  actualCents: number;
  closedAt?: string | null;
}

/** One closed project's outcome for one assembly. */
export interface AssemblySample {
  projectId: string;
  assemblyId: string;
  assemblyName?: string | null;
  estimatedCents: number;
  actualCents: number;
}

/** One closed task/trade duration outcome. */
export interface DurationSample {
  projectId: string;
  trade: string;
  plannedDays: number;
  actualDays: number;
}

/** One closed project's realized margin in a geographic zone. */
export interface GeoSample {
  projectId: string;
  geoZoneId?: string | null;
  geoZoneName?: string | null;
  geoRiskClass?: string | null;
  /** Margin floor configured at the time of the estimate, percent. */
  configuredFloorPct: number;
  /** Margin the job actually delivered, percent. */
  realizedGrossProfitPct: number;
  estimatedGrossProfitPct?: number | null;
}

// ══════════════════════════════════════════════════════════════════════
// FINDINGS
// ══════════════════════════════════════════════════════════════════════

export interface CalibrationFinding {
  eventType: CalibrationEventType;
  /** Stable idempotency key: `{type}:{scope}:{target}:{period}` (CL-005). */
  findingKey: string;
  scope: "project" | "tenant";
  costCode?: string | null;
  costCodeId?: string | null;
  costCodeName?: string | null;
  assemblyId?: string | null;
  trade?: string | null;
  geoZoneId?: string | null;
  geoZoneName?: string | null;
  geoRiskClass?: string | null;
  projectType?: string | null;
  estimatedCents?: number | null;
  actualCents?: number | null;
  varianceCents?: number | null;
  variancePct?: number | null;
  estimatedDurationDays?: number | null;
  actualDurationDays?: number | null;
  durationVarianceDays?: number | null;
  observedFactor?: number | null;
  suggestedFactor?: number | null;
  bias: BiasResult;
  confidence: ConfidenceResult;
  suggestion: SuggestedAdjustment;
  /** True when this finding is strong enough to become a proposed price adjustment. */
  actionable: boolean;
  recommendation: string;
  rationale: string;
  evidence: {
    projectIds: string[];
    deviations: number[];
    samples: Array<Record<string, unknown>>;
  };
}

function buildFindingKey(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map(p => (p == null || p === "" ? "-" : String(p).trim().toLowerCase().replace(/\s+/g, "_")))
    .join(":");
}

// ══════════════════════════════════════════════════════════════════════
// PRICE ACCURACY (CL-001: price_accuracy)
// ══════════════════════════════════════════════════════════════════════

/**
 * Detect price bias per cost code across closed projects.
 *
 * Samples with no budget are excluded from the price signal on purpose: an unbudgeted cost
 * code is a *scope* miss, and counting it here would inflate the price of an item that was
 * priced correctly whenever it was actually included.
 */
export function detectCostCodeBias(
  samples: readonly CostCodeSample[],
  options: {
    tolerancePct?: number;
    maxAdjustmentPct?: number;
    period?: string;
  } = {},
): CalibrationFinding[] {
  const tolerance = options.tolerancePct ?? DEFAULT_BIAS_TOLERANCE_PCT;
  const period = options.period ?? "all_time";

  const groups = new Map<string, CostCodeSample[]>();
  for (const s of samples) {
    const key = s.costCode?.trim() || s.costCodeId || "UNCODED";
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const findings: CalibrationFinding[] = [];

  for (const [costCode, group] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const usable = group.filter(s => Math.round(s.estimatedCents) > 0);
    if (usable.length === 0) continue;

    const deviations: number[] = [];
    let estimatedTotal = 0;
    let actualTotal = 0;
    for (const s of usable) {
      const dev = deviationPct(s.estimatedCents, s.actualCents);
      if (dev != null) deviations.push(dev);
      estimatedTotal += Math.round(s.estimatedCents);
      actualTotal += Math.round(s.actualCents);
    }

    const bias = detectBias(deviations, tolerance);
    const confidence = computeConfidence({ deviations, tolerancePct: tolerance });
    const suggestion = suggestAdjustment({
      bias,
      band: confidence.band,
      maxAdjustmentPct: options.maxAdjustmentPct,
    });

    const actionable = suggestion.adjustmentPct !== 0;
    const varianceCents = actualTotal - estimatedTotal;

    const recommendation = actionable
      ? bias.direction === "underestimates"
        ? `Raise the unit cost of ${costCode} by ${Math.abs(suggestion.adjustmentPct)}%: it came in over budget on ${bias.overrunCount} of ${bias.sampleCount} closed jobs (${formatCents(varianceCents)} total).`
        : `Lower the unit cost of ${costCode} by ${Math.abs(suggestion.adjustmentPct)}%: it is consistently priced above what the work actually costs, which loses bids.`
      : bias.direction === "inconsistent"
        ? `Review the scope definition of ${costCode} before touching its price: the deviation has no consistent direction.`
        : `No action on ${costCode}.`;

    findings.push({
      eventType: "price_accuracy",
      findingKey: buildFindingKey(["price_accuracy", "tenant", costCode, period]),
      scope: "tenant",
      costCode,
      costCodeId: usable[0].costCodeId ?? null,
      costCodeName: usable[0].costCodeName ?? null,
      projectType: null,
      estimatedCents: estimatedTotal,
      actualCents: actualTotal,
      varianceCents,
      variancePct: deviationPct(estimatedTotal, actualTotal),
      bias,
      confidence,
      suggestion,
      actionable,
      recommendation,
      rationale: `${confidence.rationale} ${suggestion.rationale}`,
      evidence: {
        projectIds: usable.map(s => s.projectId),
        deviations,
        samples: usable.map(s => ({
          projectId: s.projectId,
          estimatedCents: Math.round(s.estimatedCents),
          actualCents: Math.round(s.actualCents),
          deviationPct: deviationPct(s.estimatedCents, s.actualCents),
        })),
      },
    });
  }

  return findings;
}

/**
 * Assemblies that need a price review.
 *
 * Assemblies are reported separately from cost codes because the remedy is different: a
 * biased assembly usually means a wrong *quantity formula*, not a wrong unit price, so the
 * recommendation points at the composition, not at the price book.
 */
export function detectAssemblyDrift(
  samples: readonly AssemblySample[],
  options: { tolerancePct?: number; maxAdjustmentPct?: number; period?: string } = {},
): CalibrationFinding[] {
  const tolerance = options.tolerancePct ?? DEFAULT_BIAS_TOLERANCE_PCT;
  const period = options.period ?? "all_time";

  const groups = new Map<string, AssemblySample[]>();
  for (const s of samples) {
    const bucket = groups.get(s.assemblyId);
    if (bucket) bucket.push(s);
    else groups.set(s.assemblyId, [s]);
  }

  const findings: CalibrationFinding[] = [];

  for (const [assemblyId, group] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const usable = group.filter(s => Math.round(s.estimatedCents) > 0);
    if (usable.length === 0) continue;

    const deviations: number[] = [];
    let estimatedTotal = 0;
    let actualTotal = 0;
    for (const s of usable) {
      const dev = deviationPct(s.estimatedCents, s.actualCents);
      if (dev != null) deviations.push(dev);
      estimatedTotal += Math.round(s.estimatedCents);
      actualTotal += Math.round(s.actualCents);
    }

    const bias = detectBias(deviations, tolerance);
    const confidence = computeConfidence({ deviations, tolerancePct: tolerance });
    const suggestion = suggestAdjustment({
      bias,
      band: confidence.band,
      maxAdjustmentPct: options.maxAdjustmentPct,
    });
    const actionable = suggestion.adjustmentPct !== 0;
    const label = usable[0].assemblyName ?? assemblyId;

    findings.push({
      eventType: "price_accuracy",
      findingKey: buildFindingKey(["price_accuracy", "tenant", `assembly_${assemblyId}`, period]),
      scope: "tenant",
      assemblyId,
      costCode: null,
      estimatedCents: estimatedTotal,
      actualCents: actualTotal,
      varianceCents: actualTotal - estimatedTotal,
      variancePct: deviationPct(estimatedTotal, actualTotal),
      bias,
      confidence,
      suggestion,
      actionable,
      recommendation: actionable
        ? `Review assembly "${label}": median deviation ${bias.medianDeviationPct}% across ${bias.sampleCount} closed jobs. Check the quantity formula before adjusting unit prices — an assembly that is always short is usually missing a component, not underpriced.`
        : `No action on assembly "${label}".`,
      rationale: `${confidence.rationale} ${suggestion.rationale}`,
      evidence: {
        projectIds: usable.map(s => s.projectId),
        deviations,
        samples: usable.map(s => ({
          projectId: s.projectId,
          assemblyId: s.assemblyId,
          estimatedCents: Math.round(s.estimatedCents),
          actualCents: Math.round(s.actualCents),
          deviationPct: deviationPct(s.estimatedCents, s.actualCents),
        })),
      },
    });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════
// DURATION ACCURACY (CL-001: duration_accuracy)
// ══════════════════════════════════════════════════════════════════════

/**
 * Planned vs real duration, per trade.
 *
 * Duration bias is reported in days *and* percent because both matter differently: a trade
 * that always runs 2 days long breaks the schedule of every following trade regardless of
 * whether that is 10% or 60% of its own duration.
 */
export function detectDurationBias(
  samples: readonly DurationSample[],
  options: { tolerancePct?: number; period?: string } = {},
): CalibrationFinding[] {
  const tolerance = options.tolerancePct ?? DEFAULT_BIAS_TOLERANCE_PCT;
  const period = options.period ?? "all_time";

  const groups = new Map<string, DurationSample[]>();
  for (const s of samples) {
    const key = s.trade?.trim().toLowerCase() || "general";
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const findings: CalibrationFinding[] = [];

  for (const [trade, group] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const usable = group.filter(s => Number.isFinite(s.plannedDays) && s.plannedDays > 0);
    if (usable.length === 0) continue;

    const deviations: number[] = [];
    let plannedTotal = 0;
    let actualTotal = 0;
    for (const s of usable) {
      deviations.push(round1(((s.actualDays - s.plannedDays) / s.plannedDays) * 100));
      plannedTotal += s.plannedDays;
      actualTotal += s.actualDays;
    }

    const bias = detectBias(deviations, tolerance);
    const confidence = computeConfidence({ deviations, tolerancePct: tolerance });
    // Duration findings never adjust money directly; they adjust the schedule factor.
    const suggestion = suggestAdjustment({ bias, band: confidence.band });
    const medianPlanned = median(usable.map(s => s.plannedDays));
    const medianActual = median(usable.map(s => s.actualDays));
    const dayGap = round1(medianActual - medianPlanned);

    findings.push({
      eventType: "duration_accuracy",
      findingKey: buildFindingKey(["duration_accuracy", "tenant", trade, period]),
      scope: "tenant",
      trade,
      estimatedDurationDays: round1(plannedTotal),
      actualDurationDays: round1(actualTotal),
      durationVarianceDays: round1(actualTotal - plannedTotal),
      observedFactor: round2(medianPlanned),
      suggestedFactor: suggestion.adjustmentPct === 0 ? round2(medianPlanned) : round2(medianActual),
      bias,
      confidence,
      suggestion,
      actionable: suggestion.adjustmentPct !== 0,
      recommendation:
        suggestion.adjustmentPct !== 0
          ? bias.direction === "underestimates"
            ? `Plan ${trade} for ${round1(medianActual)} days instead of ${round1(medianPlanned)} (median gap ${dayGap > 0 ? "+" : ""}${dayGap} days). Every trade scheduled after it inherits this slip.`
            : `${trade} finishes ahead of plan by a median of ${Math.abs(dayGap)} days; tighten the schedule to free crew capacity.`
          : `Duration planning for ${trade} is within tolerance.`,
      rationale: `${confidence.rationale} ${suggestion.rationale}`,
      evidence: {
        projectIds: usable.map(s => s.projectId),
        deviations,
        samples: usable.map(s => ({
          projectId: s.projectId,
          trade: s.trade,
          plannedDays: s.plannedDays,
          actualDays: s.actualDays,
          deviationPct: round1(((s.actualDays - s.plannedDays) / s.plannedDays) * 100),
        })),
      },
    });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════
// GEO FACTOR VALIDATION (CL-001: geo_factor_validation)
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a configured geographic margin floor against realized margin.
 *
 * This is the finding the dossier asks for by name: if coastal work is configured at a 42%
 * floor but consistently delivers 38%, the floor is not protecting anything. The suggested
 * floor is the configured floor plus the median shortfall — raising the floor to what the
 * zone actually costs, not to the best job observed.
 *
 * Note the asymmetry, and it is intentional: a zone that *over*-delivers margin does NOT get
 * its floor lowered automatically. Lowering a protective floor on the strength of a few good
 * jobs is exactly how a coastal GC discovers a hurricane-season overrun with no cushion.
 */
export function validateGeoFactors(
  samples: readonly GeoSample[],
  options: { tolerancePct?: number; period?: string } = {},
): CalibrationFinding[] {
  const tolerance = options.tolerancePct ?? DEFAULT_BIAS_TOLERANCE_PCT;
  const period = options.period ?? "all_time";

  const groups = new Map<string, GeoSample[]>();
  for (const s of samples) {
    const key = s.geoZoneId || s.geoZoneName?.trim().toLowerCase() || s.geoRiskClass || "unzoned";
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const findings: CalibrationFinding[] = [];

  for (const [key, group] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const usable = group.filter(s => Number.isFinite(s.realizedGrossProfitPct));
    if (usable.length === 0) continue;

    // Deviation here is the *shortfall against the floor*, in percentage points, expressed
    // as a percentage of the floor so it composes with the shared bias machinery.
    const deviations: number[] = [];
    for (const s of usable) {
      const floor = s.configuredFloorPct;
      if (!Number.isFinite(floor) || floor <= 0) continue;
      deviations.push(round1(((floor - s.realizedGrossProfitPct) / floor) * 100));
    }
    if (deviations.length === 0) continue;

    const bias = detectBias(deviations, tolerance);
    const confidence = computeConfidence({ deviations, tolerancePct: tolerance });

    const configuredFloor = round1(median(usable.map(s => s.configuredFloorPct)));
    const realizedMedian = round1(median(usable.map(s => s.realizedGrossProfitPct)));
    const shortfallPp = round1(configuredFloor - realizedMedian);

    // A floor is only raised, never lowered, by automated evidence.
    const shouldRaise =
      shortfallPp > 0 &&
      bias.direction === "underestimates" &&
      bandAllowsProposal(confidence.band);

    const suggestedFloor = shouldRaise
      ? round1(Math.min(configuredFloor + shortfallPp, configuredFloor + MAX_ADJUSTMENT_PCT))
      : configuredFloor;

    const suggestion: SuggestedAdjustment = shouldRaise
      ? {
          adjustmentPct: round1(Math.min(shortfallPp, MAX_ADJUSTMENT_PCT)),
          capped: shortfallPp > MAX_ADJUSTMENT_PCT,
          belowNoiseFloor: shortfallPp < MIN_ADJUSTMENT_PCT,
          rawDeviationPct: shortfallPp,
          rationale: `Realized margin sits ${shortfallPp}pp below the configured floor across ${bias.sampleCount} closed jobs.`,
        }
      : {
          adjustmentPct: 0,
          capped: false,
          belowNoiseFloor: true,
          rawDeviationPct: shortfallPp,
          rationale:
            shortfallPp <= 0
              ? "Zone is delivering at or above its floor. Floors are never lowered automatically — the cushion is the point."
              : `Confidence band is ${confidence.band}; not enough evidence to move a protective floor.`,
        };

    const zoneLabel = usable[0].geoZoneName ?? usable[0].geoRiskClass ?? key;

    findings.push({
      eventType: "geo_factor_validation",
      findingKey: buildFindingKey(["geo_factor_validation", "tenant", key, period]),
      scope: "tenant",
      geoZoneId: usable[0].geoZoneId ?? null,
      geoZoneName: usable[0].geoZoneName ?? null,
      geoRiskClass: usable[0].geoRiskClass ?? null,
      observedFactor: configuredFloor,
      suggestedFactor: suggestedFloor,
      bias,
      confidence,
      suggestion,
      actionable: shouldRaise && suggestion.adjustmentPct !== 0,
      recommendation: shouldRaise
        ? `Raise the ${zoneLabel} margin floor from ${configuredFloor}% to ${suggestedFloor}%: realized margin has a median of ${realizedMedian}% across ${bias.sampleCount} closed jobs, so the current floor is not protecting the work.`
        : shortfallPp <= 0
          ? `${zoneLabel} is delivering ${realizedMedian}% against a ${configuredFloor}% floor. Keep the floor as configured.`
          : `${zoneLabel} shows a ${shortfallPp}pp shortfall but confidence is ${confidence.band}. Collect more closed jobs before moving the floor.`,
      rationale: `${confidence.rationale} ${suggestion.rationale}`,
      evidence: {
        projectIds: usable.map(s => s.projectId),
        deviations,
        samples: usable.map(s => ({
          projectId: s.projectId,
          configuredFloorPct: s.configuredFloorPct,
          realizedGrossProfitPct: s.realizedGrossProfitPct,
          estimatedGrossProfitPct: s.estimatedGrossProfitPct ?? null,
          shortfallPp: round1(s.configuredFloorPct - s.realizedGrossProfitPct),
        })),
      },
    });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════
// ACCURACY SCORE AND REPORT ASSEMBLY
// ══════════════════════════════════════════════════════════════════════

/**
 * Overall accuracy score of the estimating engine, 0–100.
 *
 * Money-weighted, and asymmetric on purpose: under-estimating is penalised twice as hard as
 * over-estimating by the same percentage, because one destroys realized margin and the other
 * only costs a bid that can be re-quoted.
 */
export function computeAccuracyScore(input: {
  totalEstimatedCents: number;
  totalActualCents: number;
  costCodeDeviations?: readonly number[];
}): number {
  const estimated = Math.round(input.totalEstimatedCents);
  if (estimated <= 0) return 0;

  const actual = Math.round(input.totalActualCents);
  const topLevelDev = ((actual - estimated) / estimated) * 100;
  const penalty = topLevelDev > 0 ? topLevelDev * 2 : Math.abs(topLevelDev);

  const spread = input.costCodeDeviations?.length
    ? mean(input.costCodeDeviations.map(d => Math.abs(d)))
    : Math.abs(topLevelDev);

  // 70% weight on the money outcome, 30% on per-code discipline.
  const score = 100 - (penalty * 0.7 + spread * 0.3);
  return round1(Math.max(0, Math.min(100, score)));
}

export interface CalibrationReportInput {
  scope: "project" | "tenant";
  period: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  generatedAt: string;
  projectCount: number;
  totalEstimatedCents: number;
  totalActualCents: number;
  estimatedGrossProfitPct?: number | null;
  realizedGrossProfitPct?: number | null;
  scopeCompletenessScore?: number | null;
  findings: readonly CalibrationFinding[];
}

export interface CalibrationReportResult {
  reportKey: string;
  scope: "project" | "tenant";
  period: string;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string;
  projectCount: number;
  eventCount: number;
  totalEstimatedCents: number;
  totalActualCents: number;
  totalVarianceCents: number;
  totalVariancePct: number | null;
  meanAbsDeviationPct: number;
  accuracyScore: number;
  durationAccuracyPct: number | null;
  estimatedGrossProfitPct: number | null;
  realizedGrossProfitPct: number | null;
  scopeCompletenessScore: number | null;
  biasedCostCodes: CalibrationFinding[];
  assembliesNeedingReview: CalibrationFinding[];
  geoFactorFindings: CalibrationFinding[];
  durationFindings: CalibrationFinding[];
  /** Findings strong enough to become proposals, ordered by money impact. */
  actionableFindings: CalibrationFinding[];
  summary: string;
}

/**
 * Assemble the persisted calibration report.
 *
 * Ordering is by absolute money impact rather than by percentage: a 40% overrun on a $600
 * cost code is a curiosity, an 8% overrun on a $180k framing package is the reason the year
 * missed its number.
 */
export function buildCalibrationReport(
  input: CalibrationReportInput,
): CalibrationReportResult {
  const findings = [...input.findings];
  const byImpact = (a: CalibrationFinding, b: CalibrationFinding) =>
    Math.abs(b.varianceCents ?? 0) - Math.abs(a.varianceCents ?? 0);

  const priceFindings = findings.filter(
    f => f.eventType === "price_accuracy" && !f.assemblyId,
  );
  const assemblyFindings = findings.filter(
    f => f.eventType === "price_accuracy" && !!f.assemblyId,
  );
  const geoFindings = findings.filter(f => f.eventType === "geo_factor_validation");
  const durationFindings = findings.filter(f => f.eventType === "duration_accuracy");

  const biasedCostCodes = priceFindings
    .filter(f => f.bias.direction === "underestimates" || f.bias.direction === "overestimates")
    .sort(byImpact);

  const allDeviations = findings.flatMap(f => f.evidence.deviations);
  const meanAbsDeviationPct = round1(mean(allDeviations.map(d => Math.abs(d))));

  const totalVarianceCents =
    Math.round(input.totalActualCents) - Math.round(input.totalEstimatedCents);
  const totalVariancePct = deviationPct(input.totalEstimatedCents, input.totalActualCents);

  const accuracyScore = computeAccuracyScore({
    totalEstimatedCents: input.totalEstimatedCents,
    totalActualCents: input.totalActualCents,
    costCodeDeviations: priceFindings.map(f => f.bias.medianDeviationPct),
  });

  const durationAccuracyPct = durationFindings.length
    ? round1(
        100 -
          mean(
            durationFindings.map(f => Math.abs(f.bias.medianDeviationPct)),
          ),
      )
    : null;

  const actionableFindings = findings.filter(f => f.actionable).sort(byImpact);

  const headline =
    totalVariancePct == null
      ? "No approved budget in the period, so estimating accuracy cannot be measured."
      : totalVariancePct > 0
        ? `Work came in ${totalVariancePct}% over the approved budget (${formatCents(totalVarianceCents)}).`
        : `Work came in ${Math.abs(totalVariancePct)}% under the approved budget (${formatCents(Math.abs(totalVarianceCents))}).`;

  const biasLine = biasedCostCodes.length
    ? ` ${biasedCostCodes.length} cost code(s) show a consistent bias, led by ${biasedCostCodes[0].costCode} (${biasedCostCodes[0].bias.medianDeviationPct}% median).`
    : " No cost code shows a consistent pricing bias.";

  const actionLine = actionableFindings.length
    ? ` ${actionableFindings.length} finding(s) are strong enough to propose a price adjustment; each still requires human approval before it touches the price book.`
    : " No finding is strong enough to propose a price change yet.";

  const marginLine =
    input.realizedGrossProfitPct != null
      ? ` Realized gross profit: ${round1(input.realizedGrossProfitPct)}%${
          input.estimatedGrossProfitPct != null
            ? ` against ${round1(input.estimatedGrossProfitPct)}% estimated`
            : ""
        }.`
      : "";

  return {
    reportKey: buildFindingKey([
      "report",
      input.scope,
      input.period,
      input.periodStart ?? "-",
      input.periodEnd ?? "-",
    ]),
    scope: input.scope,
    period: input.period,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    generatedAt: input.generatedAt,
    projectCount: input.projectCount,
    eventCount: findings.length,
    totalEstimatedCents: Math.round(input.totalEstimatedCents),
    totalActualCents: Math.round(input.totalActualCents),
    totalVarianceCents,
    totalVariancePct,
    meanAbsDeviationPct,
    accuracyScore,
    durationAccuracyPct,
    estimatedGrossProfitPct:
      input.estimatedGrossProfitPct != null ? round1(input.estimatedGrossProfitPct) : null,
    realizedGrossProfitPct:
      input.realizedGrossProfitPct != null ? round1(input.realizedGrossProfitPct) : null,
    scopeCompletenessScore:
      input.scopeCompletenessScore != null ? round1(input.scopeCompletenessScore) : null,
    biasedCostCodes,
    assembliesNeedingReview: assemblyFindings.filter(f => f.actionable).sort(byImpact),
    geoFactorFindings: geoFindings,
    durationFindings,
    actionableFindings,
    summary: `${headline}${biasLine}${actionLine}${marginLine}`,
  };
}
