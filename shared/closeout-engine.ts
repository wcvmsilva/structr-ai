/**
 * structr.ai — PHASE 3 Closeout Engine
 *
 * PURE engine for the project closeout gate described in docs/phase3-contract.md §8.
 *
 * Responsibilities:
 *   1. Opening gate: no field task may still be open (CO-001)
 *   2. Checklist completeness for `ready_to_close` (CO-002)
 *   3. Closing gate: no pending actual and every critical variance reviewed (CO-003)
 *   4. Final variance report assembly (baseline vs change order, per cost code)
 *
 * No DB, no IO.
 */

import {
  canTransitionCloseout,
  CLOSEOUT_CHECKLIST_KEYS,
  CLOSEOUT_CHECKLIST_LABELS,
  CLIENT_SATISFACTION_MAX,
  CLIENT_SATISFACTION_MIN,
  FIELD_TASK_OPEN_STATUSES,
  type CloseoutChecklistKey,
  type CloseoutStatus,
  type FieldTaskStatus,
} from "./domain/phase3-taxonomy";
import {
  formatCents,
  type ProjectVarianceSnapshot,
  type CostCodeVariance,
} from "./actuals-variance-engine";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export type CloseoutRuleId = "CO-001" | "CO-002" | "CO-003" | "CO-004";

export interface CloseoutBlocker {
  ruleId: CloseoutRuleId;
  code:
    | "CLOSEOUT_BLOCKED_OPEN_TASKS"
    | "CLOSEOUT_CHECKLIST_INCOMPLETE"
    | "CLOSEOUT_PENDING_ACTUALS"
    | "CLOSEOUT_VARIANCE_UNREVIEWED"
    | "INVALID_CLOSEOUT_TRANSITION"
    | "NO_APPROVED_ESTIMATE"
    | "INVALID_SATISFACTION_SCORE";
  message: string;
  /** Machine-readable context so the UI can link to the offending records. */
  details?: Record<string, unknown>;
}

export interface CloseoutChecklistState {
  final_inspection_passed?: boolean | null;
  punch_list_complete?: boolean | null;
  lien_waivers_collected?: boolean | null;
  final_payment_received?: boolean | null;
  warranty_docs_delivered?: boolean | null;
  client_satisfaction_score?: number | null;
}

export interface CloseoutReadinessInput {
  /** Task statuses of the project (one entry per task). */
  taskStatuses: Array<{ id?: string; status: FieldTaskStatus; taskType?: string }>;
  /** True when the project has an approved estimate to close against. */
  hasApprovedEstimate: boolean;
}

export interface CloseoutReadiness {
  canOpen: boolean;
  blockers: CloseoutBlocker[];
  openTaskCount: number;
  openTaskIds: string[];
  totalTaskCount: number;
  /** Percentage of tasks no longer open, 1 decimal. */
  taskCompletionPct: number;
}

// ══════════════════════════════════════════════════════════════════════
// OPENING GATE (CO-001)
// ══════════════════════════════════════════════════════════════════════

/**
 * Evaluate whether a closeout may be opened.
 *
 * Rationale: opening closeout while work is open is how projects get "closed" on paper and
 * reopened in the field. The gate is deliberately mechanical — no override path, because
 * the operator can always cancel a task that will not be executed.
 */
export function evaluateCloseoutReadiness(input: CloseoutReadinessInput): CloseoutReadiness {
  const blockers: CloseoutBlocker[] = [];

  const openTasks = input.taskStatuses.filter((t) =>
    FIELD_TASK_OPEN_STATUSES.includes(t.status),
  );
  const openTaskIds = openTasks.map((t) => t.id).filter((id): id is string => !!id);
  const total = input.taskStatuses.length;
  const closed = total - openTasks.length;
  const taskCompletionPct = total === 0 ? 0 : Math.round((closed / total) * 1000) / 10;

  if (!input.hasApprovedEstimate) {
    blockers.push({
      ruleId: "CO-004",
      code: "NO_APPROVED_ESTIMATE",
      message:
        "Closeout requires an approved estimate as the financial baseline — without it there is nothing to compare the real cost against.",
    });
  }

  if (total === 0) {
    blockers.push({
      ruleId: "CO-001",
      code: "CLOSEOUT_BLOCKED_OPEN_TASKS",
      message:
        "The project has no field task on record. Closing a project with no execution history leaves the actuals unexplained.",
      details: { totalTaskCount: 0 },
    });
  } else if (openTasks.length > 0) {
    blockers.push({
      ruleId: "CO-001",
      code: "CLOSEOUT_BLOCKED_OPEN_TASKS",
      message: `${openTasks.length} field task(s) are still open. Complete, verify or cancel them before opening closeout.`,
      details: { openTaskCount: openTasks.length, openTaskIds },
    });
  }

  return {
    canOpen: blockers.length === 0,
    blockers,
    openTaskCount: openTasks.length,
    openTaskIds,
    totalTaskCount: total,
    taskCompletionPct,
  };
}

// ══════════════════════════════════════════════════════════════════════
// CHECKLIST (CO-002)
// ══════════════════════════════════════════════════════════════════════

export interface ChecklistEvaluation {
  complete: boolean;
  completedCount: number;
  requiredCount: number;
  /** Percentage of required items satisfied, 1 decimal. */
  completionPct: number;
  missing: Array<{ key: CloseoutChecklistKey; label: string }>;
  blockers: CloseoutBlocker[];
}

/** Evaluate the mandatory closeout checklist. */
export function evaluateChecklist(state: CloseoutChecklistState): ChecklistEvaluation {
  const missing: Array<{ key: CloseoutChecklistKey; label: string }> = [];

  for (const key of CLOSEOUT_CHECKLIST_KEYS) {
    if (state[key] !== true) {
      missing.push({ key, label: CLOSEOUT_CHECKLIST_LABELS[key] });
    }
  }

  const requiredCount = CLOSEOUT_CHECKLIST_KEYS.length;
  const completedCount = requiredCount - missing.length;
  const blockers: CloseoutBlocker[] = [];

  if (missing.length > 0) {
    blockers.push({
      ruleId: "CO-002",
      code: "CLOSEOUT_CHECKLIST_INCOMPLETE",
      message: `Closeout checklist is incomplete: ${missing.map((m) => m.label).join(", ")}.`,
      details: { missing: missing.map((m) => m.key) },
    });
  }

  const score = state.client_satisfaction_score;
  if (
    score != null &&
    (!Number.isFinite(score) || score < CLIENT_SATISFACTION_MIN || score > CLIENT_SATISFACTION_MAX)
  ) {
    blockers.push({
      ruleId: "CO-002",
      code: "INVALID_SATISFACTION_SCORE",
      message: `Client satisfaction score must be between ${CLIENT_SATISFACTION_MIN} and ${CLIENT_SATISFACTION_MAX}.`,
      details: { score },
    });
  }

  return {
    complete: missing.length === 0,
    completedCount,
    requiredCount,
    completionPct: Math.round((completedCount / requiredCount) * 1000) / 10,
    missing,
    blockers,
  };
}

// ══════════════════════════════════════════════════════════════════════
// CLOSING GATE (CO-003)
// ══════════════════════════════════════════════════════════════════════

export interface FinalCloseInput {
  checklist: CloseoutChecklistState;
  /** Count of actuals still in `pending`. */
  pendingActualCount: number;
  /** Cost codes with critical/unbudgeted variance that were not reviewed. */
  unreviewedVarianceCostCodes: string[];
  /** Open tasks at closing time (a task may have been created after opening). */
  openTaskCount: number;
}

export interface FinalCloseEvaluation {
  canClose: boolean;
  blockers: CloseoutBlocker[];
  checklist: ChecklistEvaluation;
}

/**
 * Evaluate whether a closeout may transition to `closed`.
 *
 * A pending actual blocks closing because an unapproved invoice is unresolved money: the
 * final variance report would be a snapshot of a number that can still change.
 */
export function evaluateFinalClose(input: FinalCloseInput): FinalCloseEvaluation {
  const checklist = evaluateChecklist(input.checklist);
  const blockers: CloseoutBlocker[] = [...checklist.blockers];

  if (input.openTaskCount > 0) {
    blockers.push({
      ruleId: "CO-001",
      code: "CLOSEOUT_BLOCKED_OPEN_TASKS",
      message: `${input.openTaskCount} field task(s) reopened or were created after closeout started. Resolve them before closing.`,
      details: { openTaskCount: input.openTaskCount },
    });
  }

  if (input.pendingActualCount > 0) {
    blockers.push({
      ruleId: "CO-003",
      code: "CLOSEOUT_PENDING_ACTUALS",
      message: `${input.pendingActualCount} actual(s) are still pending approval. Approve, reject or void them so the final variance is definitive.`,
      details: { pendingActualCount: input.pendingActualCount },
    });
  }

  if (input.unreviewedVarianceCostCodes.length > 0) {
    blockers.push({
      ruleId: "CO-003",
      code: "CLOSEOUT_VARIANCE_UNREVIEWED",
      message: `Critical or unbudgeted variance was not reviewed on cost code(s): ${input.unreviewedVarianceCostCodes.join(", ")}.`,
      details: { costCodes: input.unreviewedVarianceCostCodes },
    });
  }

  return { canClose: blockers.length === 0, blockers, checklist };
}

/** Evaluate a closeout state transition. */
export function evaluateCloseoutTransition(
  from: CloseoutStatus,
  to: CloseoutStatus,
): { allowed: boolean; blockers: CloseoutBlocker[] } {
  if (from === to) {
    return {
      allowed: false,
      blockers: [
        {
          ruleId: "CO-004",
          code: "INVALID_CLOSEOUT_TRANSITION",
          message: `Closeout is already "${from}".`,
        },
      ],
    };
  }

  if (!canTransitionCloseout(from, to)) {
    return {
      allowed: false,
      blockers: [
        {
          ruleId: "CO-004",
          code: "INVALID_CLOSEOUT_TRANSITION",
          message: `Transition "${from}" → "${to}" is not allowed. Flow: blocked → open → in_progress → ready_to_close → closed.`,
        },
      ],
    };
  }

  return { allowed: true, blockers: [] };
}

// ══════════════════════════════════════════════════════════════════════
// FINAL VARIANCE REPORT
// ══════════════════════════════════════════════════════════════════════

export interface FinalVarianceReportLine {
  costCode: string;
  costCodeName: string | null;
  estimatedCents: number;
  actualCents: number;
  baselineActualCents: number;
  changeOrderActualCents: number;
  varianceCents: number;
  variancePct: number | null;
  severity: string;
  /** Human-readable money, so the persisted snapshot is readable without conversion. */
  estimated: string;
  actual: string;
  variance: string;
}

export interface FinalVarianceReport {
  generatedAt: string;
  thresholdPct: number;
  baselineEstimatedCents: number;
  changeOrderEstimatedCents: number;
  totalEstimatedCents: number;
  baselineActualCents: number;
  changeOrderActualCents: number;
  totalActualCents: number;
  varianceCents: number;
  variancePct: number | null;
  severity: string;
  /** Realized gross profit against the approved sell price, when provided. */
  approvedSellPriceCents: number | null;
  realizedGrossProfitCents: number | null;
  realizedGrossProfitPct: number | null;
  lines: FinalVarianceReportLine[];
  /** Cost codes above tolerance, ordered by absolute impact. */
  topOverruns: FinalVarianceReportLine[];
  alerts: string[];
  /** One-paragraph operator summary. */
  summary: string;
}

function toReportLine(row: CostCodeVariance): FinalVarianceReportLine {
  return {
    costCode: row.costCode,
    costCodeName: row.costCodeName,
    estimatedCents: row.estimatedCents,
    actualCents: row.actualCents,
    baselineActualCents: row.baselineActualCents,
    changeOrderActualCents: row.changeOrderActualCents,
    varianceCents: row.varianceCents,
    variancePct: row.variancePct,
    severity: row.severity,
    estimated: formatCents(row.estimatedCents),
    actual: formatCents(row.actualCents),
    variance: formatCents(row.varianceCents),
  };
}

/**
 * Build the final variance report from a variance snapshot.
 *
 * The report is persisted as the closeout snapshot: recalculating it on every read would
 * make the closed project's numbers drift as the price book evolves.
 */
export function buildFinalVarianceReport(
  snapshot: ProjectVarianceSnapshot,
  options: { generatedAt: string; approvedSellPriceCents?: number | null },
): FinalVarianceReport {
  const lines = snapshot.byCostCode.map(toReportLine);
  const topOverruns = lines
    .filter((l) => l.varianceCents > 0)
    .sort((a, b) => b.varianceCents - a.varianceCents)
    .slice(0, 10);

  const sell = options.approvedSellPriceCents ?? null;
  const realizedGrossProfitCents = sell != null ? sell - snapshot.totalActualCents : null;
  const realizedGrossProfitPct =
    sell != null && sell > 0
      ? Math.round((((sell - snapshot.totalActualCents) / sell) * 100 + Number.EPSILON) * 10) / 10
      : null;

  const direction =
    snapshot.varianceCents > 0 ? "over" : snapshot.varianceCents < 0 ? "under" : "on";
  const pctText = snapshot.variancePct == null ? "n/a" : `${Math.abs(snapshot.variancePct)}%`;

  const summaryParts = [
    `Final cost landed ${formatCents(Math.abs(snapshot.varianceCents))} ${direction} the approved budget (${pctText}).`,
    `Baseline budget ${formatCents(snapshot.baselineEstimatedCents)} plus ${formatCents(snapshot.changeOrderEstimatedCents)} of approved change orders, against ${formatCents(snapshot.totalActualCents)} of committed cost.`,
  ];
  if (realizedGrossProfitPct != null) {
    summaryParts.push(
      `Realized gross profit ${formatCents(realizedGrossProfitCents ?? 0)} (${realizedGrossProfitPct}%).`,
    );
  }
  if (topOverruns.length > 0) {
    summaryParts.push(
      `Largest overrun: ${topOverruns[0].costCode} at ${formatCents(topOverruns[0].varianceCents)}.`,
    );
  }

  return {
    generatedAt: options.generatedAt,
    thresholdPct: snapshot.thresholdPct,
    baselineEstimatedCents: snapshot.baselineEstimatedCents,
    changeOrderEstimatedCents: snapshot.changeOrderEstimatedCents,
    totalEstimatedCents: snapshot.totalEstimatedCents,
    baselineActualCents: snapshot.baselineActualCents,
    changeOrderActualCents: snapshot.changeOrderActualCents,
    totalActualCents: snapshot.totalActualCents,
    varianceCents: snapshot.varianceCents,
    variancePct: snapshot.variancePct,
    severity: snapshot.severity,
    approvedSellPriceCents: sell,
    realizedGrossProfitCents,
    realizedGrossProfitPct,
    lines,
    topOverruns,
    alerts: snapshot.alerts.map((a) => a.message),
    summary: summaryParts.join(" "),
  };
}

/** Cost codes whose variance demands review before the project can be closed. */
export function costCodesRequiringReview(snapshot: ProjectVarianceSnapshot): string[] {
  return snapshot.byCostCode.filter((c) => c.requiresReview).map((c) => c.costCode);
}
