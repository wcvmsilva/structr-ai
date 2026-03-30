import type { Deal } from "../drizzle/schema";
import type { DealStage } from "../shared/domain/taxonomy";

/** Extended deal type for pipeline calculations — includes fields not yet in schema */
type DealExt = Deal & {
  probability?: number | null;
  estimateId?: string | null;
  serviceTypes?: string | null;
  channel?: string | null;
};

export function calculateWeightedPipeline(deals: Pick<DealExt, "stage" | "value" | "probability">[]) {
  let total = 0;
  const byStage: Record<string, number> = {};

  for (const deal of deals) {
    const val = parseFloat(deal.value as any) || 0;
    const prob = ((deal.probability as number) ?? 0) / 100;
    const weighted = val * prob;

    total += weighted;
    if (deal.stage) {
      if (!byStage[deal.stage]) byStage[deal.stage] = 0;
      byStage[deal.stage] += weighted;
    }
  }

  return { total, byStage };
}

export function calculateWinProbability(deal: Pick<DealExt, "stage" | "value" | "serviceTypes" | "channel">, _historicalDeals: any[] = []) {
  if (deal.stage === "won") return 100;
  if (deal.stage === "lost") return 0;

  let prob = 0;
  switch (deal.stage) {
    case "discovery": prob = 10; break;
    case "site_visit": prob = 20; break;
    case "estimating": prob = 50; break;
    case "proposal_sent": prob = 60; break;
    case "negotiation": prob = 80; break;
    default: prob = 0;
  }

  // Adjustments based on high-close-rate trades
  const svc = typeof deal.serviceTypes === "string" ? deal.serviceTypes : "";
  if (svc.includes("kitchen")) prob += 15;
  if (svc.includes("bathroom")) prob += 10;
  if (svc.includes("remodel")) prob += 5;
  if (deal.channel === "insurance") prob += 10;

  return Math.min(prob, 99);
}

export function forecastRevenue(deals: Partial<DealExt>[], _period: "monthly" | "quarterly") {
  let expected = 0;
  let best = 0;
  let worst = 0;

  for (const deal of deals) {
    const val = parseFloat(deal.value as any) || 0;
    const prob = (deal.probability ?? 0) / 100;

    expected += val * prob;
    best += val;

    if (deal.probability && deal.probability > 80) {
      worst += val;
    }
  }

  return { expected, best, worst };
}

export function suggestNextAction(deal: Partial<DealExt>) {
  if (deal.stage === "discovery") return { action: "Schedule site visit", reason: "Gather requirements", urgency: "medium" };
  if (deal.stage === "site_visit") return { action: "Perform site measurement", reason: "Prepare for estimate", urgency: "high" };
  if (deal.stage === "estimating" && deal.estimateId) return { action: "Send proposal", reason: "Estimate completed", urgency: "medium" };
  if (deal.stage === "proposal_sent") return { action: "Follow up on proposal", reason: "Wait for client response", urgency: "medium" };
  if (deal.stage === "negotiation") return { action: "Follow up / Close deal", reason: "Deal is at final stage", urgency: "high" };
  if (deal.stage === "won") return { action: "Onboard client", reason: "Project kicks off soon", urgency: "high" };
  if (deal.stage === "lost") return { action: "Archive deal", reason: "Deal lost", urgency: "low" };
  return { action: "None", reason: "None", urgency: "low" };
}

export function detectStaleDeal(deal: Partial<DealExt>, lastActivityDate?: Date) {
  if (deal.stage === "won" || deal.stage === "lost") {
    return { isStale: false, daysSinceLastActivity: 0 };
  }

  const effectiveDate = lastActivityDate || deal.updatedAt;
  if (!effectiveDate) return { isStale: false, daysSinceLastActivity: 0 };

  const daysSince = Math.round((new Date().getTime() - new Date(effectiveDate).getTime()) / (1000 * 3600 * 24));
  return { isStale: daysSince >= 14, daysSinceLastActivity: daysSince };
}

const STAGE_ORDER: DealStage[] = ["discovery", "site_visit", "estimating", "proposal_sent", "negotiation", "won"];

export function validateStageTransition(from: DealStage | undefined | null, to: DealStage) {
  if (to === "lost") return true; 
  if (from === "won") return false;
  if (from === "lost") return false;

  if (!from) return true; // new deal can start anywhere
  
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);

  if (toIdx === -1 || fromIdx === -1) return false;

  return toIdx > fromIdx;
}
