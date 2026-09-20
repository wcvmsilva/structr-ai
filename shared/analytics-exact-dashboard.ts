import type { DashboardInput } from "./analytics-aggregation-engine";
import type { AggregateReadResult, PipelineSummaryExactV1, UnavailableRevenueForecast } from "./estimate-aggregate-engine";
export type { UnavailableRevenueForecast } from "./estimate-aggregate-engine";
import { ANALYTICS_EXACT_DASHBOARD_VERSION } from "./domain/taxonomy";

export type ExactDashboardInput = Omit<DashboardInput, "pipeline" | "forecast"> & {
  pipeline: AggregateReadResult<PipelineSummaryExactV1>;
  forecast: UnavailableRevenueForecast;
};
export type ExactDashboardResult = ExactDashboardInput & {
  version: typeof ANALYTICS_EXACT_DASHBOARD_VERSION;
  consistency: "independent_components";
  priorityActions: string[];
  headline: string;
};
/** Independent factual components; neither this composition nor pipeline totals grant authority. */
export function buildExactDashboard(input: ExactDashboardInput): ExactDashboardResult {
  const actions: Array<{ weight: number; text: string }> = [];
  const { profitHealth, fieldProgress } = input;
  if (profitHealth.breaches.length) actions.push({ weight: 100,
    text: `${profitHealth.breaches.length} project(s) are below their enforced margin floor. Start with ${profitHealth.breaches[0].projectName ?? profitHealth.breaches[0].projectId} at ${profitHealth.breaches[0].realizedGrossProfitPct}%.` });
  if (fieldProgress.slippingProjects.length) actions.push({ weight: 80,
    text: `${fieldProgress.slippingProjects.length} project(s) are forecast past their planned end date, worst by ${fieldProgress.slippingProjects[0].slipDays} days.` });
  if (fieldProgress.blockedTasks > 0) actions.push({ weight: 70,
    text: `${fieldProgress.blockedTasks} field task(s) are blocked and stopping crews.` });
  if (input.pipeline.state === "available" && input.pipeline.data.stalledItems.length) actions.push({ weight: 60,
    text: `${input.pipeline.data.stalledItems.length} opportunit(ies) are stalled past twice the median cycle. Close them or kill them.` });
  if ((input.pendingAdjustmentCount ?? 0) > 0) actions.push({ weight: 50,
    text: `${input.pendingAdjustmentCount} price adjustment(s) are waiting on your approval; the price book is still using the old numbers until you decide.` });
  if ((input.openCalibrationCount ?? 0) > 0) actions.push({ weight: 40,
    text: `${input.openCalibrationCount} calibration finding(s) are open for review.` });
  if (profitHealth.watchList.length) actions.push({ weight: 30,
    text: `${profitHealth.watchList.length} project(s) are within a few points of their floor with no cushion left.` });
  const margin = profitHealth.portfolioGrossProfitPct === null
    ? "Portfolio margin unavailable" : `${profitHealth.portfolioGrossProfitPct}% portfolio margin`;
  return {
    version: ANALYTICS_EXACT_DASHBOARD_VERSION, consistency: "independent_components",
    generatedAt: input.generatedAt, pipeline: input.pipeline, forecast: input.forecast,
    profitHealth: input.profitHealth, fieldProgress: input.fieldProgress,
    subcontractors: [...input.subcontractors], openCalibrationCount: input.openCalibrationCount ?? 0,
    pendingAdjustmentCount: input.pendingAdjustmentCount ?? 0,
    priorityActions: actions.sort((a, b) => b.weight - a.weight).slice(0, 3).map(action => action.text),
    headline: `Forecast unavailable. ${margin}, ${fieldProgress.completionPct}% field completion.`,
  };
}
