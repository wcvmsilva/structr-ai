/**
 * structr.ai — PHASE 3 Actuals & Variance Engine
 *
 * PURE engine for the real-cost gate described in docs/phase3-contract.md §4.
 *
 * Responsibilities:
 *   1. Validate an actual before it can touch the ledger (AC-001 … AC-004)
 *   2. Integer-cent arithmetic — a float is never variance evidence
 *   3. Variance per cost code and per project, separating baseline from change order
 *   4. Threshold alerts with a configurable tolerance (default 10%)
 *   5. Budget math: approved baseline + approved change orders − committed cost
 *
 * No DB, no IO. Money is always integer cents.
 */

import {
  ACTUAL_COMMITTED_STATUSES,
  canTransitionActual,
  CRITICAL_VARIANCE_MULTIPLIER,
  DEFAULT_VARIANCE_THRESHOLD_PCT,
  isActualCommitted,
  normalizeActualCostCategory,
  normalizeActualStatus,
  VARIANCE_SEVERITIES_REQUIRING_REVIEW,
  type ActualCostCategory,
  type ActualStatus,
  type VarianceSeverity,
} from "./domain/phase3-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// MONEY (integer cents)
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert a monetary value to integer cents.
 * Mirrors `shared/jobtread-reconciliation.ts` on purpose: the export contract and the
 * cost ledger must round identically, or the same project will report two totals.
 */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const numeric =
    typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  const scaled = numeric * 100;
  return scaled >= 0 ? Math.round(scaled) : -Math.round(Math.abs(scaled));
}

/** Convert integer cents to a 2-decimal number. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Format integer cents as a fixed 2-decimal string. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ══════════════════════════════════════════════════════════════════════
// ACTUAL VALIDATION (AC-001 … AC-003)
// ══════════════════════════════════════════════════════════════════════

export type ActualRuleId = "AC-001" | "AC-002" | "AC-003" | "AC-004" | "AC-005";

export interface ActualViolation {
  ruleId: ActualRuleId;
  code:
    | "NO_APPROVED_ESTIMATE"
    | "COST_CODE_REQUIRED"
    | "INVALID_AMOUNT"
    | "INVALID_ACTUAL_TRANSITION"
    | "DATE_REQUIRED"
    | "VENDOR_REQUIRED";
  message: string;
}

export interface ActualInput {
  projectId: string;
  /** Approved estimate that serves as the budget baseline (AC-001). */
  budgetEstimateDraftId?: string | null;
  /** When present, the cost belongs to the change order scope, not the baseline. */
  changeOrderId?: string | null;
  costCodeId?: string | null;
  costCode?: string | null;
  description?: string | null;
  category?: ActualCostCategory | string | null;
  amountCents: number;
  estimatedAmountCents?: number | null;
  dateIncurred?: string | null;
  vendorName?: string | null;
  subcontractorId?: string | null;
  invoiceRef?: string | null;
  fieldTaskId?: string | null;
  estimateItemId?: string | null;
}

/**
 * Validate an actual before persistence.
 *
 * The two hard gates come straight from the parecer: an actual without an approved
 * estimate and without a cost code turns the learning layer into noise and can destroy the
 * price book downstream.
 */
export function validateActual(input: ActualInput): ActualViolation[] {
  const violations: ActualViolation[] = [];

  if (!input.budgetEstimateDraftId) {
    violations.push({
      ruleId: "AC-001",
      code: "NO_APPROVED_ESTIMATE",
      message:
        "An actual requires an approved estimate as its budget baseline. Approve the estimate (or the change order) before booking real cost against the project.",
    });
  }

  const hasCostCode =
    (input.costCodeId != null && String(input.costCodeId).trim() !== "") ||
    (input.costCode != null && String(input.costCode).trim() !== "");

  if (!hasCostCode) {
    violations.push({
      ruleId: "AC-002",
      code: "COST_CODE_REQUIRED",
      message:
        "An actual requires a cost code. Uncoded cost cannot be compared to the estimate and must not enter the ledger.",
    });
  }

  if (!Number.isFinite(input.amountCents) || !Number.isInteger(input.amountCents)) {
    violations.push({
      ruleId: "AC-003",
      code: "INVALID_AMOUNT",
      message: "Amount must be an integer number of cents.",
    });
  } else if (input.amountCents < 0) {
    violations.push({
      ruleId: "AC-003",
      code: "INVALID_AMOUNT",
      message:
        "Amount cannot be negative. A credit or refund is recorded as its own coded entry, not as a negative cost line.",
    });
  }

  if (!input.dateIncurred) {
    violations.push({
      ruleId: "AC-005",
      code: "DATE_REQUIRED",
      message: "An actual requires the date the cost was incurred.",
    });
  }

  const hasVendor =
    (input.vendorName != null && String(input.vendorName).trim() !== "") ||
    (input.subcontractorId != null && String(input.subcontractorId).trim() !== "");

  if (!hasVendor) {
    violations.push({
      ruleId: "AC-005",
      code: "VENDOR_REQUIRED",
      message:
        "An actual requires a vendor name or a subcontractor id — cost without a payee cannot be reconciled or audited.",
    });
  }

  return violations;
}

/** Evaluate a status transition of an actual (AC-004). */
export function evaluateActualTransition(
  from: ActualStatus,
  to: ActualStatus,
): { allowed: boolean; violations: ActualViolation[] } {
  if (from === to) {
    return {
      allowed: false,
      violations: [
        {
          ruleId: "AC-004",
          code: "INVALID_ACTUAL_TRANSITION",
          message: `Actual is already "${from}".`,
        },
      ],
    };
  }

  if (!canTransitionActual(from, to)) {
    return {
      allowed: false,
      violations: [
        {
          ruleId: "AC-004",
          code: "INVALID_ACTUAL_TRANSITION",
          message: `Transition "${from}" → "${to}" is not allowed. Allowed flow: pending → approved → paid, with rejected/void as terminal exits.`,
        },
      ],
    };
  }

  return { allowed: true, violations: [] };
}

/** Resolve the cost category from free-form input, defaulting to `other`. */
export function resolveCostCategory(
  value: string | null | undefined,
): ActualCostCategory {
  return normalizeActualCostCategory(value) ?? "other";
}

/** Resolve the actual status from free-form input, defaulting to `pending`. */
export function resolveActualStatus(value: string | null | undefined): ActualStatus {
  return normalizeActualStatus(value) ?? "pending";
}

// ══════════════════════════════════════════════════════════════════════
// VARIANCE (§4)
// ══════════════════════════════════════════════════════════════════════

export interface VarianceResult {
  estimatedCents: number;
  actualCents: number;
  varianceCents: number;
  /** Null when there is no budget to compare against (`unbudgeted`). */
  variancePct: number | null;
  severity: VarianceSeverity;
  thresholdPct: number;
  /** True when the severity demands review before closeout. */
  requiresReview: boolean;
}

/**
 * Compute variance from integer cents.
 *
 * `estimated = 0` with real cost is NOT infinite variance: it is a distinct condition
 * (`unbudgeted`) because the operator's action is different — the line did not exist in the
 * approved scope, so it needs a change order or a cost code correction, not a re-forecast.
 */
export function computeVariance(
  estimatedCents: number,
  actualCents: number,
  thresholdPct: number = DEFAULT_VARIANCE_THRESHOLD_PCT,
): VarianceResult {
  const estimated = Math.round(estimatedCents);
  const actual = Math.round(actualCents);
  const varianceCents = actual - estimated;
  const threshold = Math.abs(thresholdPct);

  if (estimated <= 0) {
    const severity: VarianceSeverity = actual > 0 ? "unbudgeted" : "ok";
    return {
      estimatedCents: estimated,
      actualCents: actual,
      varianceCents,
      variancePct: null,
      severity,
      thresholdPct: threshold,
      requiresReview: VARIANCE_SEVERITIES_REQUIRING_REVIEW.includes(severity),
    };
  }

  const variancePct = Math.round(((varianceCents / estimated) * 100 + Number.EPSILON) * 10) / 10;

  let severity: VarianceSeverity;
  if (variancePct <= -threshold) {
    severity = "under_budget";
  } else if (variancePct <= threshold) {
    severity = "ok";
  } else if (variancePct <= threshold * CRITICAL_VARIANCE_MULTIPLIER) {
    severity = "warning";
  } else {
    severity = "critical";
  }

  return {
    estimatedCents: estimated,
    actualCents: actual,
    varianceCents,
    variancePct,
    severity,
    thresholdPct: threshold,
    requiresReview: VARIANCE_SEVERITIES_REQUIRING_REVIEW.includes(severity),
  };
}

// ══════════════════════════════════════════════════════════════════════
// SNAPSHOT BY COST CODE AND BY PROJECT
// ══════════════════════════════════════════════════════════════════════

export interface ActualRecord {
  id?: string;
  costCodeId?: string | null;
  costCode?: string | null;
  costCodeName?: string | null;
  category?: ActualCostCategory | string | null;
  amountCents: number;
  estimatedAmountCents?: number | null;
  status: ActualStatus;
  changeOrderId?: string | null;
  subcontractorId?: string | null;
}

export interface BudgetLine {
  costCodeId?: string | null;
  costCode: string;
  costCodeName?: string | null;
  estimatedCents: number;
  /** True when the budget line comes from a change order rather than the baseline. */
  fromChangeOrder?: boolean;
}

export interface CostCodeVariance extends VarianceResult {
  costCode: string;
  costCodeId: string | null;
  costCodeName: string | null;
  /** Committed cost coming from the original scope. */
  baselineActualCents: number;
  /** Committed cost coming from approved change orders. */
  changeOrderActualCents: number;
  /** Cost still pending approval, reported but not counted as committed. */
  pendingActualCents: number;
  actualCount: number;
}

export interface VarianceAlert {
  costCode: string;
  severity: VarianceSeverity;
  estimatedCents: number;
  actualCents: number;
  varianceCents: number;
  variancePct: number | null;
  message: string;
}

export interface ProjectVarianceSnapshot {
  thresholdPct: number;
  /** Baseline budget: approved estimate only. */
  baselineEstimatedCents: number;
  /** Additional budget from approved change orders. */
  changeOrderEstimatedCents: number;
  /** baseline + change orders. */
  totalEstimatedCents: number;
  /** Committed cost against the baseline scope. */
  baselineActualCents: number;
  /** Committed cost against change order scope. */
  changeOrderActualCents: number;
  totalActualCents: number;
  pendingActualCents: number;
  varianceCents: number;
  variancePct: number | null;
  severity: VarianceSeverity;
  /** Remaining budget: total estimated − committed cost. Negative means overrun. */
  remainingBudgetCents: number;
  byCostCode: CostCodeVariance[];
  alerts: VarianceAlert[];
  requiresReview: boolean;
  actualCount: number;
  committedCount: number;
}

function costCodeKey(
  row: { costCodeId?: string | null; costCode?: string | null },
): string {
  return (
    (row.costCode && String(row.costCode).trim()) ||
    (row.costCodeId && String(row.costCodeId)) ||
    "UNCODED"
  );
}

/**
 * Build the full variance snapshot of a project.
 *
 * Two invariants matter operationally:
 *   1. only committed actuals (approved/paid) move the variance — pending cost is shown
 *      separately so nobody reacts to an invoice that may still be rejected;
 *   2. baseline and change order money are never merged, so an overrun on the original
 *      scope can never be hidden behind additional scope the client already paid for.
 */
export function buildVarianceSnapshot(
  budgetLines: BudgetLine[],
  actuals: ActualRecord[],
  thresholdPct: number = DEFAULT_VARIANCE_THRESHOLD_PCT,
): ProjectVarianceSnapshot {
  const threshold = Math.abs(thresholdPct);

  interface Bucket {
    costCode: string;
    costCodeId: string | null;
    costCodeName: string | null;
    estimatedCents: number;
    baselineActualCents: number;
    changeOrderActualCents: number;
    pendingActualCents: number;
    actualCount: number;
  }

  const buckets = new Map<string, Bucket>();

  const ensureBucket = (
    key: string,
    costCodeId: string | null,
    costCodeName: string | null,
  ): Bucket => {
    const existing = buckets.get(key);
    if (existing) {
      if (!existing.costCodeId && costCodeId) existing.costCodeId = costCodeId;
      if (!existing.costCodeName && costCodeName) existing.costCodeName = costCodeName;
      return existing;
    }
    const created: Bucket = {
      costCode: key,
      costCodeId,
      costCodeName,
      estimatedCents: 0,
      baselineActualCents: 0,
      changeOrderActualCents: 0,
      pendingActualCents: 0,
      actualCount: 0,
    };
    buckets.set(key, created);
    return created;
  };

  let baselineEstimatedCents = 0;
  let changeOrderEstimatedCents = 0;

  for (const line of budgetLines) {
    const key = costCodeKey(line);
    const bucket = ensureBucket(key, line.costCodeId ?? null, line.costCodeName ?? null);
    const cents = Math.round(line.estimatedCents);
    bucket.estimatedCents += cents;
    if (line.fromChangeOrder) changeOrderEstimatedCents += cents;
    else baselineEstimatedCents += cents;
  }

  let baselineActualCents = 0;
  let changeOrderActualCents = 0;
  let pendingActualCents = 0;
  let committedCount = 0;

  for (const actual of actuals) {
    const key = costCodeKey(actual);
    const bucket = ensureBucket(key, actual.costCodeId ?? null, actual.costCodeName ?? null);
    const cents = Math.round(actual.amountCents);
    bucket.actualCount += 1;

    if (isActualCommitted(actual.status)) {
      committedCount += 1;
      if (actual.changeOrderId) {
        bucket.changeOrderActualCents += cents;
        changeOrderActualCents += cents;
      } else {
        bucket.baselineActualCents += cents;
        baselineActualCents += cents;
      }
    } else if (actual.status === "pending") {
      bucket.pendingActualCents += cents;
      pendingActualCents += cents;
    }
  }

  const byCostCode: CostCodeVariance[] = [];
  const alerts: VarianceAlert[] = [];

  for (const bucket of Array.from(buckets.values())) {
    const actualCents = bucket.baselineActualCents + bucket.changeOrderActualCents;
    const variance = computeVariance(bucket.estimatedCents, actualCents, threshold);

    const row: CostCodeVariance = {
      ...variance,
      costCode: bucket.costCode,
      costCodeId: bucket.costCodeId,
      costCodeName: bucket.costCodeName,
      baselineActualCents: bucket.baselineActualCents,
      changeOrderActualCents: bucket.changeOrderActualCents,
      pendingActualCents: bucket.pendingActualCents,
      actualCount: bucket.actualCount,
    };
    byCostCode.push(row);

    if (variance.severity === "warning" || variance.severity === "critical") {
      alerts.push({
        costCode: bucket.costCode,
        severity: variance.severity,
        estimatedCents: variance.estimatedCents,
        actualCents: variance.actualCents,
        varianceCents: variance.varianceCents,
        variancePct: variance.variancePct,
        message: `Cost code ${bucket.costCode} is ${variance.variancePct}% over the approved budget (estimated ${formatCents(variance.estimatedCents)}, actual ${formatCents(variance.actualCents)}), above the ${threshold}% tolerance.`,
      });
    } else if (variance.severity === "unbudgeted") {
      alerts.push({
        costCode: bucket.costCode,
        severity: "unbudgeted",
        estimatedCents: variance.estimatedCents,
        actualCents: variance.actualCents,
        varianceCents: variance.varianceCents,
        variancePct: null,
        message: `Cost code ${bucket.costCode} carries ${formatCents(variance.actualCents)} of real cost with no approved budget line. Book it under an existing cost code or raise a change order.`,
      });
    }
  }

  byCostCode.sort((a, b) => b.varianceCents - a.varianceCents);
  alerts.sort((a, b) => {
    const rank: Record<VarianceSeverity, number> = {
      critical: 0,
      unbudgeted: 1,
      warning: 2,
      ok: 3,
      under_budget: 4,
    };
    return rank[a.severity] - rank[b.severity] || b.varianceCents - a.varianceCents;
  });

  const totalEstimatedCents = baselineEstimatedCents + changeOrderEstimatedCents;
  const totalActualCents = baselineActualCents + changeOrderActualCents;
  const total = computeVariance(totalEstimatedCents, totalActualCents, threshold);

  return {
    thresholdPct: threshold,
    baselineEstimatedCents,
    changeOrderEstimatedCents,
    totalEstimatedCents,
    baselineActualCents,
    changeOrderActualCents,
    totalActualCents,
    pendingActualCents,
    varianceCents: total.varianceCents,
    variancePct: total.variancePct,
    severity: total.severity,
    remainingBudgetCents: totalEstimatedCents - totalActualCents,
    byCostCode,
    alerts,
    requiresReview: byCostCode.some((c) => c.requiresReview),
    actualCount: actuals.length,
    committedCount,
  };
}

// ══════════════════════════════════════════════════════════════════════
// BUDGET (§7 — change order recomposes available budget)
// ══════════════════════════════════════════════════════════════════════

export interface ProjectBudget {
  baselineCents: number;
  changeOrderCents: number;
  totalBudgetCents: number;
  committedCents: number;
  pendingCents: number;
  availableCents: number;
  /** Percentage of the budget already committed, 1 decimal. */
  consumedPct: number | null;
  overBudget: boolean;
}

/**
 * Compute the available budget of a project.
 * Approved change orders increase the budget; only committed actuals consume it.
 */
export function computeProjectBudget(
  baselineCents: number,
  approvedChangeOrderCents: number,
  actuals: Array<Pick<ActualRecord, "amountCents" | "status">>,
): ProjectBudget {
  const baseline = Math.round(baselineCents);
  const changeOrders = Math.round(approvedChangeOrderCents);
  const totalBudgetCents = baseline + changeOrders;

  let committedCents = 0;
  let pendingCents = 0;
  for (const actual of actuals) {
    const cents = Math.round(actual.amountCents);
    if (ACTUAL_COMMITTED_STATUSES.includes(actual.status)) committedCents += cents;
    else if (actual.status === "pending") pendingCents += cents;
  }

  const consumedPct =
    totalBudgetCents > 0
      ? Math.round((committedCents / totalBudgetCents) * 1000) / 10
      : null;

  return {
    baselineCents: baseline,
    changeOrderCents: changeOrders,
    totalBudgetCents,
    committedCents,
    pendingCents,
    availableCents: totalBudgetCents - committedCents,
    consumedPct,
    overBudget: committedCents > totalBudgetCents,
  };
}

/**
 * Extract budget lines (in cents, by cost code) from estimate line items.
 * Used to build the baseline and the change order budget from persisted JSONB line items.
 */
export function budgetLinesFromEstimateLineItems(
  lineItems: Array<{
    costCode?: string | null;
    costGroupName?: string | null;
    costItemName?: string | null;
    quantity?: number | string | null;
    unitCostSnapshot?: number | string | null;
    unitPriceSnapshot?: number | string | null;
    lineTotalCost?: number | string | null;
  }>,
  options: { fromChangeOrder?: boolean; basis?: "cost" | "price" } = {},
): BudgetLine[] {
  const basis = options.basis ?? "cost";
  const grouped = new Map<string, BudgetLine>();

  for (const item of lineItems) {
    const code =
      (item.costCode && String(item.costCode).trim()) ||
      (item.costGroupName && String(item.costGroupName).trim()) ||
      "UNCODED";

    let cents: number;
    if (basis === "cost" && item.lineTotalCost != null) {
      cents = toCents(item.lineTotalCost);
    } else {
      const qty = Number(item.quantity ?? 0);
      const unit =
        basis === "cost"
          ? toCents(item.unitCostSnapshot ?? 0)
          : toCents(item.unitPriceSnapshot ?? 0);
      const product = (Number.isFinite(qty) ? qty : 0) * unit;
      cents = product >= 0 ? Math.round(product) : -Math.round(Math.abs(product));
    }

    const existing = grouped.get(code);
    if (existing) {
      existing.estimatedCents += cents;
    } else {
      grouped.set(code, {
        costCode: code,
        costCodeName: item.costItemName ? String(item.costItemName) : null,
        estimatedCents: cents,
        fromChangeOrder: options.fromChangeOrder ?? false,
      });
    }
  }

  return Array.from(grouped.values());
}
