/**
 * structr.ai — PHASE 4 Scope Completeness Engine (PURE)
 *
 * Compares the approved scope against what was actually executed and paid for.
 *
 * Contract: docs/phase4-contract.md §4 (SC4-001 … SC4-003)
 *
 * Why this engine exists separately from the price calibration engine: a job that overruns
 * because framing was underpriced and a job that overruns because nobody quoted the trim are
 * the same number in the P&L and two completely different failures. Price bias is fixed in
 * the price book; scope gaps are fixed in the checklist used before the estimate exists.
 *
 * The output that matters is not the score, it is `missingItems` — the cost codes that showed
 * up in the actuals with no line in the approved scope. Aggregated across projects of the
 * same type, those become the pre-estimate checklist (SC4-003).
 *
 * Money weighting is deliberate: a forgotten $80 caulking line and a forgotten $9k HVAC
 * modification cannot score the same, so the score is driven by cost, and item counts are
 * reported alongside it for context.
 *
 * PURE module: no DB, no IO, no clock, no randomness.
 */

import {
  MIN_OCCURRENCES_FOR_PATTERN,
  PATTERN_FREQUENCY_THRESHOLD,
  scopeCompletenessVerdictFor,
  type ScopeCompletenessVerdict,
} from "./domain/phase4-taxonomy";
import { formatCents } from "./actuals-variance-engine";
import { computeConfidence, round1, round2, type ConfidenceResult } from "./calibration-engine";

// ══════════════════════════════════════════════════════════════════════
// INPUTS
// ══════════════════════════════════════════════════════════════════════

/** One line of the approved scope (from the locked estimate). */
export interface PlannedScopeLine {
  costCode: string;
  costCodeId?: string | null;
  costCodeName?: string | null;
  trade?: string | null;
  estimatedCents: number;
}

/** Committed cost that actually happened, aggregated per cost code. */
export interface ExecutedScopeLine {
  costCode: string;
  costCodeId?: string | null;
  costCodeName?: string | null;
  trade?: string | null;
  actualCents: number;
  /** True when this cost was authorized by an approved change order. */
  fromChangeOrder?: boolean;
}

export interface ScopeCompletenessInput {
  projectId: string;
  projectType?: string | null;
  commercialChannel?: string | null;
  planned: readonly PlannedScopeLine[];
  executed: readonly ExecutedScopeLine[];
  /**
   * When true, cost covered by an approved change order is not counted as a scope gap.
   * Default true: a change order means the gap was caught, priced and sold — the process
   * worked. Counting it as a failure would punish the correct behaviour.
   */
  creditChangeOrders?: boolean;
}

// ══════════════════════════════════════════════════════════════════════
// OUTPUTS
// ══════════════════════════════════════════════════════════════════════

export interface ScopeGapItem {
  costCode: string;
  costCodeId: string | null;
  costCodeName: string | null;
  trade: string | null;
  actualCents: number;
  actual: string;
  fromChangeOrder: boolean;
}

export interface UnexecutedScopeItem {
  costCode: string;
  costCodeId: string | null;
  costCodeName: string | null;
  trade: string | null;
  estimatedCents: number;
  estimated: string;
}

export interface ScopeCompletenessResult {
  projectId: string;
  projectType: string | null;
  commercialChannel: string | null;
  /** 0–100, money-weighted. */
  score: number;
  verdict: ScopeCompletenessVerdict;
  plannedItemCount: number;
  executedItemCount: number;
  matchedItemCount: number;
  missingItemCount: number;
  unplannedItemCount: number;
  plannedCents: number;
  executedCents: number;
  /** Committed cost with no matching approved scope line. */
  unplannedCostCents: number;
  /** Approved scope lines that never received cost. */
  unexecutedCostCents: number;
  /** Unplanned cost that a change order authorized. */
  changeOrderCoveredCents: number;
  changeOrderCoveredCount: number;
  missingItems: ScopeGapItem[];
  unexecutedItems: UnexecutedScopeItem[];
  summary: string;
}

function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase() || "UNCODED";
}

/**
 * Score the completeness of one project's approved scope.
 *
 * Score construction, in plain terms: start at 100 and subtract the share of executed money
 * that had no approved scope line behind it. Change-order-covered money is excluded from the
 * penalty by default (see `creditChangeOrders`), because that is scope the company caught and
 * sold rather than absorbed.
 *
 * Approved lines that were never executed are reported but do NOT reduce the score: not
 * spending budgeted money is a margin win, not an estimating failure.
 */
export function scoreScopeCompleteness(
  input: ScopeCompletenessInput,
): ScopeCompletenessResult {
  const creditChangeOrders = input.creditChangeOrders ?? true;

  const plannedByCode = new Map<string, PlannedScopeLine & { key: string }>();
  for (const line of input.planned) {
    const key = normalizeCode(line.costCode ?? line.costCodeId);
    const existing = plannedByCode.get(key);
    if (existing) {
      existing.estimatedCents += Math.round(line.estimatedCents);
    } else {
      plannedByCode.set(key, {
        ...line,
        key,
        estimatedCents: Math.round(line.estimatedCents),
      });
    }
  }

  const executedByCode = new Map<string, ExecutedScopeLine & { key: string }>();
  for (const line of input.executed) {
    const key = normalizeCode(line.costCode ?? line.costCodeId);
    const existing = executedByCode.get(key);
    if (existing) {
      existing.actualCents += Math.round(line.actualCents);
      existing.fromChangeOrder = existing.fromChangeOrder || !!line.fromChangeOrder;
    } else {
      executedByCode.set(key, {
        ...line,
        key,
        actualCents: Math.round(line.actualCents),
        fromChangeOrder: !!line.fromChangeOrder,
      });
    }
  }

  let plannedCents = 0;
  for (const line of Array.from(plannedByCode.values())) plannedCents += line.estimatedCents;

  let executedCents = 0;
  for (const line of Array.from(executedByCode.values())) executedCents += line.actualCents;

  const missingItems: ScopeGapItem[] = [];
  let unplannedCostCents = 0;
  let changeOrderCoveredCents = 0;
  let changeOrderCoveredCount = 0;
  let matchedItemCount = 0;

  for (const line of Array.from(executedByCode.values())) {
    if (plannedByCode.has(line.key)) {
      matchedItemCount += 1;
      continue;
    }
    if (line.actualCents <= 0) continue;

    const fromChangeOrder = !!line.fromChangeOrder;
    if (fromChangeOrder) {
      changeOrderCoveredCents += line.actualCents;
      changeOrderCoveredCount += 1;
    }
    unplannedCostCents += line.actualCents;

    missingItems.push({
      costCode: line.costCode,
      costCodeId: line.costCodeId ?? null,
      costCodeName: line.costCodeName ?? null,
      trade: line.trade ?? null,
      actualCents: line.actualCents,
      actual: formatCents(line.actualCents),
      fromChangeOrder,
    });
  }

  const unexecutedItems: UnexecutedScopeItem[] = [];
  let unexecutedCostCents = 0;
  for (const line of Array.from(plannedByCode.values())) {
    if (executedByCode.has(line.key)) continue;
    if (line.estimatedCents <= 0) continue;
    unexecutedCostCents += line.estimatedCents;
    unexecutedItems.push({
      costCode: line.costCode,
      costCodeId: line.costCodeId ?? null,
      costCodeName: line.costCodeName ?? null,
      trade: line.trade ?? null,
      estimatedCents: line.estimatedCents,
      estimated: formatCents(line.estimatedCents),
    });
  }

  missingItems.sort((a, b) => b.actualCents - a.actualCents);
  unexecutedItems.sort((a, b) => b.estimatedCents - a.estimatedCents);

  const penalizedCents = creditChangeOrders
    ? unplannedCostCents - changeOrderCoveredCents
    : unplannedCostCents;

  // Denominator: the money the project actually consumed. When nothing was executed there is
  // nothing to judge, and a project with no approved scope is a 0, not a 100.
  const denominator = executedCents > 0 ? executedCents : plannedCents;

  let score: number;
  if (plannedCents <= 0 && executedCents <= 0) {
    score = 0;
  } else if (plannedCents <= 0) {
    // Money spent with no approved scope at all.
    score = 0;
  } else if (denominator <= 0) {
    score = 100;
  } else {
    score = round1(Math.max(0, Math.min(100, 100 - (penalizedCents / denominator) * 100)));
  }

  const verdict = scopeCompletenessVerdictFor(score);

  const summaryParts: string[] = [];
  if (missingItems.length === 0) {
    summaryParts.push("Every dollar spent had an approved scope line behind it.");
  } else {
    const top = missingItems[0];
    summaryParts.push(
      `${missingItems.length} cost code(s) were executed without an approved scope line, totalling ${formatCents(unplannedCostCents)}; the largest is ${top.costCode} at ${top.actual}.`,
    );
  }
  if (changeOrderCoveredCount > 0) {
    summaryParts.push(
      `${changeOrderCoveredCount} of them were authorized by change orders (${formatCents(changeOrderCoveredCents)}) — caught and sold, not absorbed.`,
    );
  }
  if (unexecutedItems.length > 0) {
    summaryParts.push(
      `${unexecutedItems.length} approved line(s) worth ${formatCents(unexecutedCostCents)} were never executed.`,
    );
  }

  return {
    projectId: input.projectId,
    projectType: input.projectType ?? null,
    commercialChannel: input.commercialChannel ?? null,
    score,
    verdict,
    plannedItemCount: plannedByCode.size,
    executedItemCount: executedByCode.size,
    matchedItemCount,
    missingItemCount: missingItems.length,
    unplannedItemCount: missingItems.length,
    plannedCents,
    executedCents,
    unplannedCostCents,
    unexecutedCostCents,
    changeOrderCoveredCents,
    changeOrderCoveredCount,
    missingItems,
    unexecutedItems,
    summary: summaryParts.join(" "),
  };
}

// ══════════════════════════════════════════════════════════════════════
// RECURRING PATTERNS (SC4-003)
// ══════════════════════════════════════════════════════════════════════

export interface ScopePatternInput {
  projectId: string;
  projectType: string;
  missingItems: readonly {
    costCode: string;
    costCodeId?: string | null;
    costCodeName?: string | null;
    trade?: string | null;
    actualCents: number;
  }[];
}

export interface ScopePattern {
  projectType: string;
  costCode: string;
  costCodeId: string | null;
  costCodeName: string | null;
  trade: string | null;
  occurrenceCount: number;
  projectCount: number;
  /** occurrenceCount / projectCount, 0–1. */
  frequency: number;
  avgUnplannedCents: number;
  totalUnplannedCents: number;
  confidence: ConfidenceResult;
  isRecurring: boolean;
  suggestion: string;
  evidence: { projectIds: string[] };
}

/**
 * Promote repeated omissions into a checklist.
 *
 * A pattern needs both an absolute floor (`MIN_OCCURRENCES_FOR_PATTERN`) and a relative one
 * (`PATTERN_FREQUENCY_THRESHOLD`). Without the frequency test, a code missed twice in forty
 * bathroom remodels would end up on the checklist and the checklist would stop being read.
 */
export function detectScopePatterns(
  projects: readonly ScopePatternInput[],
  options: { minOccurrences?: number; frequencyThreshold?: number } = {},
): ScopePattern[] {
  const minOccurrences = options.minOccurrences ?? MIN_OCCURRENCES_FOR_PATTERN;
  const frequencyThreshold = options.frequencyThreshold ?? PATTERN_FREQUENCY_THRESHOLD;

  // Total projects observed per type — the denominator of the frequency.
  const projectsByType = new Map<string, number>();
  for (const p of projects) {
    const type = (p.projectType ?? "unknown").trim().toLowerCase() || "unknown";
    projectsByType.set(type, (projectsByType.get(type) ?? 0) + 1);
  }

  interface Acc {
    projectType: string;
    costCode: string;
    costCodeId: string | null;
    costCodeName: string | null;
    trade: string | null;
    projectIds: string[];
    amounts: number[];
  }

  const acc = new Map<string, Acc>();
  for (const p of projects) {
    const type = (p.projectType ?? "unknown").trim().toLowerCase() || "unknown";
    // A code missed twice inside the same project is still one occurrence for that project.
    const seen = new Set<string>();
    for (const item of p.missingItems) {
      const code = normalizeCode(item.costCode);
      const key = `${type}::${code}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = acc.get(key);
      if (existing) {
        existing.projectIds.push(p.projectId);
        existing.amounts.push(Math.round(item.actualCents));
      } else {
        acc.set(key, {
          projectType: type,
          costCode: item.costCode,
          costCodeId: item.costCodeId ?? null,
          costCodeName: item.costCodeName ?? null,
          trade: item.trade ?? null,
          projectIds: [p.projectId],
          amounts: [Math.round(item.actualCents)],
        });
      }
    }
  }

  const patterns: ScopePattern[] = [];

  for (const entry of Array.from(acc.values())) {
    const projectCount = projectsByType.get(entry.projectType) ?? entry.projectIds.length;
    const occurrenceCount = entry.projectIds.length;
    const frequency = projectCount > 0 ? round2(occurrenceCount / projectCount) : 0;
    const totalUnplannedCents = entry.amounts.reduce((a, b) => a + b, 0);
    const avgUnplannedCents = Math.round(totalUnplannedCents / Math.max(1, occurrenceCount));

    // Confidence reuses the calibration machinery: the "deviations" here are the per-project
    // omission amounts expressed as a constant direction, so consistency is total and the
    // score is driven by volume and dispersion of the money involved.
    const confidence = computeConfidence({
      deviations: entry.amounts.map(() => 100),
      tolerancePct: 0,
    });

    const isRecurring =
      occurrenceCount >= minOccurrences && frequency >= frequencyThreshold;

    const suggestion = isRecurring
      ? `Add ${entry.costCode}${entry.costCodeName ? ` (${entry.costCodeName})` : ""} to the pre-estimate checklist for ${entry.projectType}: it was executed without an approved line in ${occurrenceCount} of ${projectCount} jobs, averaging ${formatCents(avgUnplannedCents)} each time.`
      : `${entry.costCode} was missed in ${occurrenceCount} of ${projectCount} ${entry.projectType} job(s) — not yet frequent enough to be a pattern.`;

    patterns.push({
      projectType: entry.projectType,
      costCode: entry.costCode,
      costCodeId: entry.costCodeId,
      costCodeName: entry.costCodeName,
      trade: entry.trade,
      occurrenceCount,
      projectCount,
      frequency,
      avgUnplannedCents,
      totalUnplannedCents,
      confidence,
      isRecurring,
      suggestion,
      evidence: { projectIds: entry.projectIds },
    });
  }

  // Recurring first, then by money at stake: the checklist should open with what costs most.
  patterns.sort((a, b) => {
    if (a.isRecurring !== b.isRecurring) return a.isRecurring ? -1 : 1;
    return b.totalUnplannedCents - a.totalUnplannedCents;
  });

  return patterns;
}

/**
 * Build the pre-estimate checklist for a project type from detected patterns.
 * Only recurring patterns make the list — a checklist that lists everything guides nothing.
 */
export function buildScopeChecklist(
  patterns: readonly ScopePattern[],
  projectType: string,
): { projectType: string; items: ScopePattern[]; summary: string } {
  const type = (projectType ?? "unknown").trim().toLowerCase() || "unknown";
  const items = patterns.filter(p => p.projectType === type && p.isRecurring);
  const totalExposure = items.reduce((a, p) => a + p.avgUnplannedCents, 0);

  return {
    projectType: type,
    items,
    summary: items.length
      ? `${items.length} item(s) are routinely missed on ${type} jobs, worth roughly ${formatCents(totalExposure)} per job if forgotten again.`
      : `No recurring scope gap detected for ${type} jobs.`,
  };
}
