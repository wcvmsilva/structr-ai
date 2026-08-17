/**
 * structr.ai — PHASE 4 Analytics Aggregation Engine (PURE)
 *
 * The operator dashboard: pipeline, revenue forecast, profit health, field progress and
 * subcontractor performance, computed from rows that are already tenant-scoped by the caller.
 *
 * Contract: docs/phase4-contract.md §6 (AN-001 … AN-004)
 *
 * Two decisions shape every function here:
 *
 *   1. **Forecast is probability-weighted, never gross.** Summing every open estimate produces a
 *      number a GC will staff against and then miss. Each stage carries a conversion weight, and
 *      the gross figure is reported next to the weighted one so the gap is visible.
 *
 *   2. **Profit health measures realized margin against the enforced floor, not against the
 *      estimated margin.** An estimate that promised 40% and delivered 30% on a coastal job with a
 *      42% floor did not "miss by 10 points" — it broke the floor, which is the number that
 *      decides whether the company can absorb the next hurricane delay.
 *
 * PURE module: no DB, no IO, no clock (timestamps arrive as arguments), no randomness.
 */

import { formatCents } from "./actuals-variance-engine";
import { mean, median, round1, round2 } from "./calibration-engine";

// ══════════════════════════════════════════════════════════════════════
// PIPELINE (AN-001)
// ══════════════════════════════════════════════════════════════════════

/**
 * Probability weight per pipeline stage.
 *
 * Calibrated against the commercial reality the dossier describes rather than a generic CRM
 * curve: a signed contract is not 100% because coastal permitting still kills jobs, and a
 * pre-visit that has not produced an estimate is worth very little.
 */
export const PIPELINE_STAGE_WEIGHTS: Record<string, number> = {
  lead: 0.1,
  qualified: 0.2,
  previsit_scheduled: 0.3,
  previsit_complete: 0.4,
  estimate_draft: 0.5,
  estimate_sent: 0.6,
  negotiation: 0.7,
  verbal_commitment: 0.8,
  contract_signed: 0.9,
  in_production: 0.95,
};

export interface PipelineItem {
  id: string;
  stage: string;
  valueCents: number;
  projectType?: string | null;
  commercialChannel?: string | null;
  expectedCloseDate?: string | null;
  ageDays?: number | null;
}

export interface PipelineStageSummary {
  stage: string;
  weight: number;
  count: number;
  grossValueCents: number;
  weightedValueCents: number;
  grossValue: string;
  weightedValue: string;
}

export interface PipelineSummary {
  totalCount: number;
  grossValueCents: number;
  weightedValueCents: number;
  grossValue: string;
  weightedValue: string;
  byStage: PipelineStageSummary[];
  byChannel: Array<{ channel: string; count: number; weightedValueCents: number }>;
  /** Items sitting far longer than the median — the ones that quietly die. */
  stalledItems: PipelineItem[];
  medianAgeDays: number | null;
  summary: string;
}

/**
 * Aggregate the commercial pipeline.
 *
 * Stalled detection uses the median age times two rather than a fixed day count, because the
 * cycle length of a $15k repair and a $400k remodel are not comparable, but their *relative*
 * drift is.
 */
export function aggregatePipeline(
  items: readonly PipelineItem[],
  options: { stallMultiplier?: number } = {},
): PipelineSummary {
  const stallMultiplier = options.stallMultiplier ?? 2;

  let grossValueCents = 0;
  let weightedValueCents = 0;

  const stageMap = new Map<string, { count: number; gross: number; weighted: number }>();
  const channelMap = new Map<string, { count: number; weighted: number }>();
  const ages: number[] = [];

  for (const item of items) {
    const stage = (item.stage ?? "lead").trim().toLowerCase();
    const weight = PIPELINE_STAGE_WEIGHTS[stage] ?? 0.1;
    const gross = Math.round(item.valueCents);
    const weighted = Math.round(gross * weight);

    grossValueCents += gross;
    weightedValueCents += weighted;

    const s = stageMap.get(stage) ?? { count: 0, gross: 0, weighted: 0 };
    s.count += 1;
    s.gross += gross;
    s.weighted += weighted;
    stageMap.set(stage, s);

    const channel = (item.commercialChannel ?? "unknown").trim().toLowerCase();
    const c = channelMap.get(channel) ?? { count: 0, weighted: 0 };
    c.count += 1;
    c.weighted += weighted;
    channelMap.set(channel, c);

    if (item.ageDays != null && Number.isFinite(item.ageDays)) ages.push(item.ageDays);
  }

  const medianAgeDays = ages.length ? round1(median(ages)) : null;
  const stallThreshold = medianAgeDays != null ? medianAgeDays * stallMultiplier : null;
  const stalledItems =
    stallThreshold != null
      ? items
          .filter(i => i.ageDays != null && i.ageDays > stallThreshold)
          .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
      : [];

  const byStage: PipelineStageSummary[] = Array.from(stageMap.entries())
    .map(([stage, v]) => ({
      stage,
      weight: PIPELINE_STAGE_WEIGHTS[stage] ?? 0.1,
      count: v.count,
      grossValueCents: v.gross,
      weightedValueCents: v.weighted,
      grossValue: formatCents(v.gross),
      weightedValue: formatCents(v.weighted),
    }))
    .sort((a, b) => b.weight - a.weight);

  const byChannel = Array.from(channelMap.entries())
    .map(([channel, v]) => ({ channel, count: v.count, weightedValueCents: v.weighted }))
    .sort((a, b) => b.weightedValueCents - a.weightedValueCents);

  const summary =
    items.length === 0
      ? "Pipeline is empty."
      : `${items.length} open opportunit(ies) worth ${formatCents(grossValueCents)} gross, ${formatCents(weightedValueCents)} probability-weighted.` +
        (stalledItems.length
          ? ` ${stalledItems.length} item(s) are past twice the median age of ${medianAgeDays} days and need a decision or a close.`
          : "");

  return {
    totalCount: items.length,
    grossValueCents,
    weightedValueCents,
    grossValue: formatCents(grossValueCents),
    weightedValue: formatCents(weightedValueCents),
    byStage,
    byChannel,
    stalledItems,
    medianAgeDays,
    summary,
  };
}

// ══════════════════════════════════════════════════════════════════════
// REVENUE FORECAST (AN-002)
// ══════════════════════════════════════════════════════════════════════

export interface BacklogItem {
  projectId: string;
  contractValueCents: number;
  /** Committed cost to date, used to infer progress. */
  billedToDateCents?: number | null;
  /** Percent complete, 0–100, when the field reports it directly. */
  percentComplete?: number | null;
  expectedCompletionMonth?: string | null;
}

export interface RevenueForecastMonth {
  month: string;
  backlogRevenueCents: number;
  pipelineRevenueCents: number;
  totalRevenueCents: number;
  totalRevenue: string;
}

export interface RevenueForecast {
  backlogCents: number;
  /** Backlog not yet earned: contract value minus what has been billed. */
  unearnedBacklogCents: number;
  weightedPipelineCents: number;
  totalForecastCents: number;
  totalForecast: string;
  byMonth: RevenueForecastMonth[];
  summary: string;
}

/**
 * Forecast revenue from signed backlog plus weighted pipeline.
 *
 * Backlog and pipeline are never merged into one number without also being shown separately:
 * backlog is money already sold, pipeline is money that might arrive, and a GC deciding whether
 * to hire a crew needs to know which is which.
 */
export function forecastRevenue(input: {
  backlog: readonly BacklogItem[];
  pipeline: readonly PipelineItem[];
  /** Months to project, in `YYYY-MM` form, in order. */
  months: readonly string[];
}): RevenueForecast {
  let backlogCents = 0;
  let unearnedBacklogCents = 0;

  const backlogByMonth = new Map<string, number>();

  for (const item of input.backlog) {
    const contract = Math.round(item.contractValueCents);
    backlogCents += contract;

    const billed = item.billedToDateCents != null ? Math.round(item.billedToDateCents) : 0;
    const pctComplete =
      item.percentComplete != null
        ? Math.max(0, Math.min(100, item.percentComplete))
        : contract > 0
          ? Math.max(0, Math.min(100, (billed / contract) * 100))
          : 0;

    const unearned = Math.max(0, contract - Math.round(contract * (pctComplete / 100)));
    unearnedBacklogCents += unearned;

    const month = item.expectedCompletionMonth ?? input.months[0] ?? "unscheduled";
    backlogByMonth.set(month, (backlogByMonth.get(month) ?? 0) + unearned);
  }

  const pipelineSummary = aggregatePipeline(input.pipeline);
  const weightedPipelineCents = pipelineSummary.weightedValueCents;

  const pipelineByMonth = new Map<string, number>();
  for (const item of input.pipeline) {
    const stage = (item.stage ?? "lead").trim().toLowerCase();
    const weight = PIPELINE_STAGE_WEIGHTS[stage] ?? 0.1;
    const weighted = Math.round(Math.round(item.valueCents) * weight);
    const month =
      item.expectedCloseDate?.slice(0, 7) ??
      input.months[Math.min(1, Math.max(0, input.months.length - 1))] ??
      "unscheduled";
    pipelineByMonth.set(month, (pipelineByMonth.get(month) ?? 0) + weighted);
  }

  const byMonth: RevenueForecastMonth[] = input.months.map(month => {
    const backlogRevenueCents = backlogByMonth.get(month) ?? 0;
    const pipelineRevenueCents = pipelineByMonth.get(month) ?? 0;
    const totalRevenueCents = backlogRevenueCents + pipelineRevenueCents;
    return {
      month,
      backlogRevenueCents,
      pipelineRevenueCents,
      totalRevenueCents,
      totalRevenue: formatCents(totalRevenueCents),
    };
  });

  const totalForecastCents = unearnedBacklogCents + weightedPipelineCents;

  return {
    backlogCents,
    unearnedBacklogCents,
    weightedPipelineCents,
    totalForecastCents,
    totalForecast: formatCents(totalForecastCents),
    byMonth,
    summary:
      `Forecast ${formatCents(totalForecastCents)}: ${formatCents(unearnedBacklogCents)} unearned backlog (already sold) plus ${formatCents(weightedPipelineCents)} probability-weighted pipeline. ` +
      `Total signed backlog is ${formatCents(backlogCents)}.`,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PROFIT HEALTH (AN-003)
// ══════════════════════════════════════════════════════════════════════

export interface ProjectMarginRow {
  projectId: string;
  projectName?: string | null;
  projectType?: string | null;
  commercialChannel?: string | null;
  geoRiskClass?: string | null;
  contractValueCents: number;
  committedCostCents: number;
  estimatedGrossProfitPct?: number | null;
  /** Floor enforced when the estimate was approved, percent. */
  enforcedFloorPct?: number | null;
  status?: string | null;
}

export interface ProjectMarginResult {
  projectId: string;
  projectName: string | null;
  contractValueCents: number;
  committedCostCents: number;
  realizedGrossProfitCents: number;
  realizedGrossProfitPct: number | null;
  estimatedGrossProfitPct: number | null;
  /** Points of margin lost between estimate and reality. Negative means gained. */
  marginErosionPp: number | null;
  enforcedFloorPct: number | null;
  /** True when realized margin fell below the floor that was enforced at approval. */
  belowFloor: boolean;
  severity: "ok" | "watch" | "breach";
}

export interface ProfitHealthSummary {
  projectCount: number;
  totalContractCents: number;
  totalCostCents: number
  totalGrossProfitCents: number;
  portfolioGrossProfitPct: number | null;
  medianProjectGrossProfitPct: number | null;
  /** Projects whose realized margin broke the enforced floor. */
  breaches: ProjectMarginResult[];
  watchList: ProjectMarginResult[];
  byChannel: Array<{ channel: string; projectCount: number; grossProfitPct: number | null }>;
  byGeoRiskClass: Array<{ geoRiskClass: string; projectCount: number; grossProfitPct: number | null }>;
  medianMarginErosionPp: number | null;
  summary: string;
}

function grossProfitPct(contractCents: number, costCents: number): number | null {
  const contract = Math.round(contractCents);
  if (contract <= 0) return null;
  return round1(((contract - Math.round(costCents)) / contract) * 100);
}

/**
 * Portfolio profit health.
 *
 * `watch` is the band between the floor and the floor plus 3 points: a job at 43% against a 42%
 * floor has not broken anything, but it has no cushion left, and on coastal work the cushion is
 * what absorbs a weather delay or a failed inspection.
 */
export function computeProfitHealth(
  rows: readonly ProjectMarginRow[],
  options: { watchBandPp?: number } = {},
): ProfitHealthSummary {
  const watchBand = options.watchBandPp ?? 3;

  let totalContractCents = 0;
  let totalCostCents = 0;

  const results: ProjectMarginResult[] = [];
  const channelMap = new Map<string, { contract: number; cost: number; count: number }>();
  const geoMap = new Map<string, { contract: number; cost: number; count: number }>();
  const erosions: number[] = [];
  const projectMargins: number[] = [];

  for (const row of rows) {
    const contract = Math.round(row.contractValueCents);
    const cost = Math.round(row.committedCostCents);
    totalContractCents += contract;
    totalCostCents += cost;

    const realizedPct = grossProfitPct(contract, cost);
    if (realizedPct != null) projectMargins.push(realizedPct);

    const erosion =
      realizedPct != null && row.estimatedGrossProfitPct != null
        ? round1(row.estimatedGrossProfitPct - realizedPct)
        : null;
    if (erosion != null) erosions.push(erosion);

    const floor = row.enforcedFloorPct ?? null;
    const belowFloor = floor != null && realizedPct != null && realizedPct < floor;
    const severity: ProjectMarginResult["severity"] = belowFloor
      ? "breach"
      : floor != null && realizedPct != null && realizedPct < floor + watchBand
        ? "watch"
        : "ok";

    results.push({
      projectId: row.projectId,
      projectName: row.projectName ?? null,
      contractValueCents: contract,
      committedCostCents: cost,
      realizedGrossProfitCents: contract - cost,
      realizedGrossProfitPct: realizedPct,
      estimatedGrossProfitPct: row.estimatedGrossProfitPct ?? null,
      marginErosionPp: erosion,
      enforcedFloorPct: floor,
      belowFloor,
      severity,
    });

    const channel = (row.commercialChannel ?? "unknown").trim().toLowerCase();
    const c = channelMap.get(channel) ?? { contract: 0, cost: 0, count: 0 };
    c.contract += contract;
    c.cost += cost;
    c.count += 1;
    channelMap.set(channel, c);

    const geo = (row.geoRiskClass ?? "unknown").trim().toLowerCase();
    const g = geoMap.get(geo) ?? { contract: 0, cost: 0, count: 0 };
    g.contract += contract;
    g.cost += cost;
    g.count += 1;
    geoMap.set(geo, g);
  }

  const breaches = results
    .filter(r => r.severity === "breach")
    .sort((a, b) => (a.realizedGrossProfitPct ?? 0) - (b.realizedGrossProfitPct ?? 0));
  const watchList = results
    .filter(r => r.severity === "watch")
    .sort((a, b) => (a.realizedGrossProfitPct ?? 0) - (b.realizedGrossProfitPct ?? 0));

  const portfolioGrossProfitPct = grossProfitPct(totalContractCents, totalCostCents);

  const summaryParts: string[] = [];
  if (rows.length === 0) {
    summaryParts.push("No projects in the period.");
  } else {
    summaryParts.push(
      `${rows.length} project(s), ${formatCents(totalContractCents - totalCostCents)} gross profit at ${portfolioGrossProfitPct ?? 0}% portfolio margin.`,
    );
    if (breaches.length) {
      summaryParts.push(
        `${breaches.length} project(s) broke their enforced margin floor, worst at ${breaches[0].realizedGrossProfitPct}% against a ${breaches[0].enforcedFloorPct}% floor.`,
      );
    }
    if (watchList.length) {
      summaryParts.push(`${watchList.length} project(s) are within ${watchBand}pp of their floor and have no cushion left.`);
    }
  }

  return {
    projectCount: rows.length,
    totalContractCents,
    totalCostCents,
    totalGrossProfitCents: totalContractCents - totalCostCents,
    portfolioGrossProfitPct,
    medianProjectGrossProfitPct: projectMargins.length ? round1(median(projectMargins)) : null,
    breaches,
    watchList,
    byChannel: Array.from(channelMap.entries())
      .map(([channel, v]) => ({
        channel,
        projectCount: v.count,
        grossProfitPct: grossProfitPct(v.contract, v.cost),
      }))
      .sort((a, b) => (a.grossProfitPct ?? 0) - (b.grossProfitPct ?? 0)),
    byGeoRiskClass: Array.from(geoMap.entries())
      .map(([geoRiskClass, v]) => ({
        geoRiskClass,
        projectCount: v.count,
        grossProfitPct: grossProfitPct(v.contract, v.cost),
      }))
      .sort((a, b) => (a.grossProfitPct ?? 0) - (b.grossProfitPct ?? 0)),
    medianMarginErosionPp: erosions.length ? round1(median(erosions)) : null,
    summary: summaryParts.join(" "),
  };
}

// ══════════════════════════════════════════════════════════════════════
// FIELD PROGRESS (AN-004)
// ══════════════════════════════════════════════════════════════════════

export interface FieldProgressRow {
  projectId: string;
  projectName?: string | null;
  taskCount: number;
  completedTaskCount: number;
  blockedTaskCount?: number | null;
  overdueTaskCount?: number | null;
  plannedEndDate?: string | null;
  forecastEndDate?: string | null;
  weatherDelayDays?: number | null;
  safetyIncidentCount?: number | null;
}

export interface FieldProgressSummaryResult {
  projectCount: number;
  totalTasks: number;
  completedTasks: number;
  completionPct: number;
  blockedTasks: number;
  overdueTasks: number;
  weatherDelayDays: number;
  safetyIncidents: number;
  /** Projects whose forecast end date is past the planned end date. */
  slippingProjects: Array<{ projectId: string; projectName: string | null; slipDays: number }>;
  summary: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Aggregate field execution across active projects.
 *
 * Slip is computed from forecast vs planned end date rather than from task counts, because a
 * project can be 80% complete on tasks and still miss by three weeks if the remaining 20% is
 * the inspection sequence.
 */
export function aggregateFieldProgress(
  rows: readonly FieldProgressRow[],
): FieldProgressSummaryResult {
  let totalTasks = 0;
  let completedTasks = 0;
  let blockedTasks = 0;
  let overdueTasks = 0;
  let weatherDelayDays = 0;
  let safetyIncidents = 0;

  const slippingProjects: FieldProgressSummaryResult["slippingProjects"] = [];

  for (const row of rows) {
    totalTasks += row.taskCount;
    completedTasks += row.completedTaskCount;
    blockedTasks += row.blockedTaskCount ?? 0;
    overdueTasks += row.overdueTaskCount ?? 0;
    weatherDelayDays += row.weatherDelayDays ?? 0;
    safetyIncidents += row.safetyIncidentCount ?? 0;

    if (row.plannedEndDate && row.forecastEndDate) {
      const slip = daysBetween(row.plannedEndDate, row.forecastEndDate);
      if (slip > 0) {
        slippingProjects.push({
          projectId: row.projectId,
          projectName: row.projectName ?? null,
          slipDays: slip,
        });
      }
    }
  }

  slippingProjects.sort((a, b) => b.slipDays - a.slipDays);

  const completionPct = totalTasks > 0 ? round1((completedTasks / totalTasks) * 100) : 0;

  const summaryParts = [
    `${rows.length} active project(s), ${completionPct}% of ${totalTasks} tasks complete.`,
  ];
  if (blockedTasks > 0) summaryParts.push(`${blockedTasks} task(s) blocked.`);
  if (slippingProjects.length) {
    summaryParts.push(
      `${slippingProjects.length} project(s) forecast past their planned end date, worst by ${slippingProjects[0].slipDays} days.`,
    );
  }
  if (safetyIncidents > 0) summaryParts.push(`${safetyIncidents} safety incident(s) recorded.`);

  return {
    projectCount: rows.length,
    totalTasks,
    completedTasks,
    completionPct,
    blockedTasks,
    overdueTasks,
    weatherDelayDays: round1(weatherDelayDays),
    safetyIncidents,
    slippingProjects,
    summary: summaryParts.join(" "),
  };
}

// ══════════════════════════════════════════════════════════════════════
// SUBCONTRACTOR LEADERBOARD
// ══════════════════════════════════════════════════════════════════════

export interface SubcontractorPerformanceRow {
  subcontractorId: string;
  name: string;
  trade?: string | null;
  projectCount: number;
  totalPaidCents: number;
  /** Tasks completed on or before the planned finish date. */
  onTimeTaskCount: number;
  totalTaskCount: number;
  /** Cost variance against the awarded amount, percent, per project. */
  costDeviations?: readonly number[];
  reworkCount?: number | null;
  safetyIncidentCount?: number | null;
}

export interface SubcontractorScore {
  subcontractorId: string;
  name: string;
  trade: string | null;
  projectCount: number;
  totalPaidCents: number;
  totalPaid: string;
  onTimePct: number | null;
  medianCostDeviationPct: number | null;
  reworkRate: number | null;
  safetyIncidentCount: number;
  /** 0–100 composite. */
  score: number;
  rank: number;
  verdict: "preferred" | "reliable" | "monitor" | "avoid";
  rationale: string;
}

/**
 * Rank subcontractors on a composite score.
 *
 * Weights: schedule 35, cost discipline 35, rework 20, safety 10. Cost and schedule dominate
 * because those are what a GC pays for; safety is weighted lower only because a single incident
 * applies a hard penalty on top, rather than being averaged away.
 *
 * A sub with fewer than two projects gets `monitor` regardless of score: one good job is not a
 * track record, and promoting a sub to preferred on a single data point is how a schedule breaks.
 */
export function rankSubcontractors(
  rows: readonly SubcontractorPerformanceRow[],
): SubcontractorScore[] {
  const scored: SubcontractorScore[] = rows.map(row => {
    const onTimePct =
      row.totalTaskCount > 0 ? round1((row.onTimeTaskCount / row.totalTaskCount) * 100) : null;

    const deviations = (row.costDeviations ?? []).filter(d => Number.isFinite(d));
    const medianCostDeviationPct = deviations.length ? round1(median(deviations)) : null;

    const reworkRate =
      row.totalTaskCount > 0 && row.reworkCount != null
        ? round2(row.reworkCount / row.totalTaskCount)
        : null;

    const safetyIncidentCount = row.safetyIncidentCount ?? 0;

    const scheduleComponent = onTimePct != null ? (onTimePct / 100) * 35 : 17.5;
    // Only overruns are penalised: a sub who comes in under the awarded amount is not a problem.
    const costPenalty =
      medianCostDeviationPct != null && medianCostDeviationPct > 0
        ? Math.min(1, medianCostDeviationPct / 20)
        : 0;
    const costComponent = (1 - costPenalty) * 35;
    const reworkComponent = reworkRate != null ? Math.max(0, 1 - reworkRate * 4) * 20 : 10;
    const safetyComponent = safetyIncidentCount === 0 ? 10 : Math.max(0, 10 - safetyIncidentCount * 5);

    const score = round1(
      Math.max(
        0,
        Math.min(100, scheduleComponent + costComponent + reworkComponent + safetyComponent),
      ),
    );

    let verdict: SubcontractorScore["verdict"];
    if (row.projectCount < 2) verdict = "monitor";
    else if (safetyIncidentCount > 1 || score < 50) verdict = "avoid";
    else if (score >= 80) verdict = "preferred";
    else if (score >= 65) verdict = "reliable";
    else verdict = "monitor";

    const rationale =
      row.projectCount < 2
        ? `Only ${row.projectCount} project on record — not enough history to promote.`
        : `${onTimePct ?? 0}% on time, median cost deviation ${medianCostDeviationPct ?? 0}%, ${safetyIncidentCount} safety incident(s).`;

    return {
      subcontractorId: row.subcontractorId,
      name: row.name,
      trade: row.trade ?? null,
      projectCount: row.projectCount,
      totalPaidCents: Math.round(row.totalPaidCents),
      totalPaid: formatCents(Math.round(row.totalPaidCents)),
      onTimePct,
      medianCostDeviationPct,
      reworkRate,
      safetyIncidentCount,
      score,
      rank: 0,
      verdict,
      rationale,
    };
  });

  scored.sort((a, b) => b.score - a.score || b.totalPaidCents - a.totalPaidCents);
  scored.forEach((s, i) => {
    s.rank = i + 1;
  });

  return scored;
}

// ══════════════════════════════════════════════════════════════════════
// DASHBOARD ASSEMBLY
// ══════════════════════════════════════════════════════════════════════

export interface DashboardInput {
  generatedAt: string;
  pipeline: PipelineSummary;
  forecast: RevenueForecast;
  profitHealth: ProfitHealthSummary;
  fieldProgress: FieldProgressSummaryResult;
  subcontractors: readonly SubcontractorScore[];
  /** Open calibration findings that are actionable. */
  openCalibrationCount?: number;
  pendingAdjustmentCount?: number;
}

export interface DashboardResult extends Omit<DashboardInput, "subcontractors"> {
  subcontractors: SubcontractorScore[];
  /** The three things the operator should deal with today, in order. */
  priorityActions: string[];
  headline: string;
}

/**
 * Assemble the operator dashboard.
 *
 * `priorityActions` is capped at three on purpose. A dashboard that lists twelve problems gets
 * treated as a report; three ordered actions get treated as a day. Margin breaches always come
 * first: they are the only item on this list that is already costing money.
 */
export function buildDashboard(input: DashboardInput): DashboardResult {
  const actions: Array<{ weight: number; text: string }> = [];

  if (input.profitHealth.breaches.length) {
    actions.push({
      weight: 100,
      text: `${input.profitHealth.breaches.length} project(s) are below their enforced margin floor. Start with ${input.profitHealth.breaches[0].projectName ?? input.profitHealth.breaches[0].projectId} at ${input.profitHealth.breaches[0].realizedGrossProfitPct}%.`,
    });
  }
  if (input.fieldProgress.slippingProjects.length) {
    actions.push({
      weight: 80,
      text: `${input.fieldProgress.slippingProjects.length} project(s) are forecast past their planned end date, worst by ${input.fieldProgress.slippingProjects[0].slipDays} days.`,
    });
  }
  if (input.fieldProgress.blockedTasks > 0) {
    actions.push({
      weight: 70,
      text: `${input.fieldProgress.blockedTasks} field task(s) are blocked and stopping crews.`,
    });
  }
  if (input.pipeline.stalledItems.length) {
    actions.push({
      weight: 60,
      text: `${input.pipeline.stalledItems.length} opportunit(ies) are stalled past twice the median cycle. Close them or kill them.`,
    });
  }
  if ((input.pendingAdjustmentCount ?? 0) > 0) {
    actions.push({
      weight: 50,
      text: `${input.pendingAdjustmentCount} price adjustment(s) are waiting on your approval; the price book is still using the old numbers until you decide.`,
    });
  }
  if ((input.openCalibrationCount ?? 0) > 0) {
    actions.push({
      weight: 40,
      text: `${input.openCalibrationCount} calibration finding(s) are open for review.`,
    });
  }
  if (input.profitHealth.watchList.length) {
    actions.push({
      weight: 30,
      text: `${input.profitHealth.watchList.length} project(s) are within a few points of their floor with no cushion left.`,
    });
  }

  const priorityActions = actions
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(a => a.text);

  const headline =
    `${input.forecast.totalForecast} forecast revenue, ` +
    `${input.profitHealth.portfolioGrossProfitPct ?? 0}% portfolio margin, ` +
    `${input.fieldProgress.completionPct}% field completion.`;

  return {
    generatedAt: input.generatedAt,
    pipeline: input.pipeline,
    forecast: input.forecast,
    profitHealth: input.profitHealth,
    fieldProgress: input.fieldProgress,
    subcontractors: [...input.subcontractors],
    openCalibrationCount: input.openCalibrationCount ?? 0,
    pendingAdjustmentCount: input.pendingAdjustmentCount ?? 0,
    priorityActions,
    headline,
  };
}

/** Average helper re-exported for dashboards that need a simple mean of percentages. */
export function averagePct(values: readonly number[]): number {
  return round1(mean(values));
}
