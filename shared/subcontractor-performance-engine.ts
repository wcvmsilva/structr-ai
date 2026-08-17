/**
 * structr.ai — PHASE 3 Subcontractor Performance Engine
 *
 * PURE engine for the subcontractor gate described in docs/phase3-contract.md §5.
 *
 * Responsibilities:
 *   1. Compliance state of licence and insurance, with an early-warning window (SC-001)
 *   2. Assignment eligibility: expired insurance blocks new work (SC-002)
 *   3. Derived performance metrics — on-time %, quality score, average cost variance (SC-003)
 *
 * Performance is DERIVED, never typed by a user: a rating that can be edited by hand is a
 * negotiation artefact, not a measurement.
 *
 * No DB, no IO. `today` is always injected.
 */

import {
  COMPLIANCE_STATES,
  DEFAULT_COMPLIANCE_WARNING_DAYS,
  isAssignableSubcontractorStatus,
  normalizeSubcontractorStatus,
  type ComplianceState,
  type SubcontractorStatus,
} from "./domain/phase3-taxonomy";
import { computeVariance } from "./actuals-variance-engine";

// ══════════════════════════════════════════════════════════════════════
// COMPLIANCE (SC-001)
// ══════════════════════════════════════════════════════════════════════

export interface ComplianceInput {
  licenseNumber?: string | null;
  licenseExpiry?: string | null;
  insuranceCarrier?: string | null;
  insuranceExpiry?: string | null;
  insuranceCoverageCents?: number | null;
  /** Injected date (`YYYY-MM-DD`). */
  today: string;
  /** Days before expiry that raise an `expiring` alert. Default 30. */
  warningDays?: number;
  /** Minimum general liability coverage required by the tenant, in cents. */
  requiredCoverageCents?: number | null;
}

export interface ComplianceDocument {
  kind: "license" | "insurance";
  state: ComplianceState;
  expiry: string | null;
  daysUntilExpiry: number | null;
  message: string;
}

export interface ComplianceAssessment {
  license: ComplianceDocument;
  insurance: ComplianceDocument;
  /** Worst state across documents. */
  overall: ComplianceState;
  /** True when nothing is expired or missing. */
  compliant: boolean;
  alerts: string[];
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function assessDocument(
  kind: "license" | "insurance",
  identifier: string | null | undefined,
  expiry: string | null | undefined,
  today: Date,
  warningDays: number,
): ComplianceDocument {
  const label = kind === "license" ? "License" : "Insurance";

  if (!identifier || String(identifier).trim() === "") {
    return {
      kind,
      state: "missing",
      expiry: expiry ?? null,
      daysUntilExpiry: null,
      message: `${label} is not on file.`,
    };
  }

  const expiryDate = parseDate(expiry);
  if (!expiryDate) {
    return {
      kind,
      state: "missing",
      expiry: null,
      daysUntilExpiry: null,
      message: `${label} has no expiry date on file — treat as unverified.`,
    };
  }

  const daysUntilExpiry = daysBetween(today, expiryDate);

  if (daysUntilExpiry < 0) {
    return {
      kind,
      state: "expired",
      expiry: expiry ?? null,
      daysUntilExpiry,
      message: `${label} expired ${Math.abs(daysUntilExpiry)} day(s) ago.`,
    };
  }

  if (daysUntilExpiry <= warningDays) {
    return {
      kind,
      state: "expiring",
      expiry: expiry ?? null,
      daysUntilExpiry,
      message: `${label} expires in ${daysUntilExpiry} day(s).`,
    };
  }

  return {
    kind,
    state: "compliant",
    expiry: expiry ?? null,
    daysUntilExpiry,
    message: `${label} valid for ${daysUntilExpiry} more day(s).`,
  };
}

const COMPLIANCE_RANK: Record<ComplianceState, number> = {
  expired: 0,
  missing: 1,
  expiring: 2,
  compliant: 3,
};

/** Assess licence and insurance compliance of a subcontractor. */
export function assessCompliance(input: ComplianceInput): ComplianceAssessment {
  const today = parseDate(input.today) ?? new Date(0);
  const warningDays = input.warningDays ?? DEFAULT_COMPLIANCE_WARNING_DAYS;

  const license = assessDocument(
    "license",
    input.licenseNumber,
    input.licenseExpiry,
    today,
    warningDays,
  );
  const insurance = assessDocument(
    "insurance",
    input.insuranceCarrier,
    input.insuranceExpiry,
    today,
    warningDays,
  );

  const overall = [license.state, insurance.state].reduce<ComplianceState>(
    (worst, state) => (COMPLIANCE_RANK[state] < COMPLIANCE_RANK[worst] ? state : worst),
    "compliant",
  );

  const alerts: string[] = [];
  for (const doc of [license, insurance]) {
    if (doc.state !== "compliant") alerts.push(doc.message);
  }

  if (
    input.requiredCoverageCents != null &&
    input.requiredCoverageCents > 0 &&
    (input.insuranceCoverageCents ?? 0) < input.requiredCoverageCents
  ) {
    alerts.push(
      `Insurance coverage below the required minimum (${input.insuranceCoverageCents ?? 0} < ${input.requiredCoverageCents} cents).`,
    );
  }

  return {
    license,
    insurance,
    overall,
    compliant: overall === "compliant" || overall === "expiring",
    alerts,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ELIGIBILITY (SC-002)
// ══════════════════════════════════════════════════════════════════════

export interface EligibilityResult {
  eligible: boolean;
  /** Reasons that block the assignment. Empty when eligible. */
  blockers: string[];
  /** Non-blocking findings the operator should still see. */
  warnings: string[];
  complianceState: ComplianceState;
}

/**
 * Decide whether a subcontractor may receive a new field task.
 *
 * Expired insurance is a hard block: assigning uninsured work in a coastal residential
 * market transfers the entire liability to the GC. An expiring document is a warning,
 * because the crew still needs to be scheduled while the paperwork is renewed.
 */
export function evaluateAssignmentEligibility(input: {
  status: SubcontractorStatus | string | null | undefined;
  compliance: ComplianceAssessment;
  /** When true, missing documents also block (strict tenant policy). */
  strict?: boolean;
}): EligibilityResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const status = normalizeSubcontractorStatus(input.status ?? null);
  if (!status) {
    blockers.push("Subcontractor status is unknown or invalid.");
  } else if (!isAssignableSubcontractorStatus(status)) {
    blockers.push(
      `Subcontractor status is "${status}" and cannot receive new assignments. Reinstate the company first.`,
    );
  } else if (status === "probation") {
    warnings.push("Subcontractor is on probation — assignment allowed with supervision.");
  }

  if (input.compliance.insurance.state === "expired") {
    blockers.push(input.compliance.insurance.message);
  } else if (input.compliance.insurance.state === "missing") {
    if (input.strict) blockers.push(input.compliance.insurance.message);
    else warnings.push(input.compliance.insurance.message);
  } else if (input.compliance.insurance.state === "expiring") {
    warnings.push(input.compliance.insurance.message);
  }

  if (input.compliance.license.state === "expired") {
    blockers.push(input.compliance.license.message);
  } else if (input.compliance.license.state !== "compliant") {
    if (input.strict && input.compliance.license.state === "missing") {
      blockers.push(input.compliance.license.message);
    } else {
      warnings.push(input.compliance.license.message);
    }
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    complianceState: input.compliance.overall,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PERFORMANCE (SC-003)
// ══════════════════════════════════════════════════════════════════════

export interface PerformanceTaskInput {
  status: string;
  plannedEndDate?: string | null;
  actualEndDate?: string | null;
  /** Number of times the task was reopened or blocked after completion. */
  reworkCount?: number | null;
}

export interface PerformanceActualInput {
  estimatedAmountCents?: number | null;
  amountCents: number;
  status: string;
}

export interface PerformanceMetrics {
  /** Completed tasks with both planned and actual end dates. */
  measuredTaskCount: number;
  completedTaskCount: number;
  verifiedTaskCount: number;
  /** Percentage of measured tasks finished on or before the planned date, 1 decimal. */
  onTimePct: number | null;
  /** Average days late across measured tasks (negative means early), 1 decimal. */
  avgDaysLate: number | null;
  /** 0–100 quality score derived from verification rate and rework. */
  qualityScore: number | null;
  /** Average cost variance percentage across committed actuals, 1 decimal. */
  costVarianceAvgPct: number | null
  ;
  /** Committed cost booked against this subcontractor, in cents. */
  committedCostCents: number;
  /** 0–5 composite rating derived from the metrics above. */
  derivedRating: number | null;
  /** Concise findings for the operator. */
  signals: string[];
}

function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Compute derived performance metrics for a subcontractor.
 *
 * Deliberate choices:
 *   - only completed/verified tasks count for punctuality; an open task is not a failure yet;
 *   - quality is verification rate penalised by rework, because a task that had to be
 *     redone was not "done" the first time;
 *   - cost variance uses committed actuals only, so a disputed invoice does not damage a
 *     vendor's record before it is approved.
 */
export function computePerformanceMetrics(
  tasks: PerformanceTaskInput[],
  actuals: PerformanceActualInput[],
): PerformanceMetrics {
  const closed = tasks.filter((t) => t.status === "completed" || t.status === "verified");
  const verified = tasks.filter((t) => t.status === "verified");

  const measured = closed.filter(
    (t) => parseDay(t.plannedEndDate) != null && parseDay(t.actualEndDate) != null,
  );

  let onTimeCount = 0;
  let totalDaysLate = 0;
  for (const task of measured) {
    const planned = parseDay(task.plannedEndDate)!;
    const actual = parseDay(task.actualEndDate)!;
    const daysLate = Math.round((actual.getTime() - planned.getTime()) / 86_400_000);
    totalDaysLate += daysLate;
    if (daysLate <= 0) onTimeCount += 1;
  }

  const onTimePct =
    measured.length > 0 ? Math.round((onTimeCount / measured.length) * 1000) / 10 : null;
  const avgDaysLate =
    measured.length > 0 ? Math.round((totalDaysLate / measured.length) * 10) / 10 : null;

  const reworkTotal = tasks.reduce((sum, t) => sum + (t.reworkCount ?? 0), 0);
  let qualityScore: number | null = null;
  if (closed.length > 0) {
    const verificationRate = verified.length / closed.length;
    const reworkPenalty = Math.min(1, reworkTotal / closed.length);
    qualityScore = Math.round(Math.max(0, verificationRate * 100 - reworkPenalty * 40) * 10) / 10;
  }

  const committed = actuals.filter((a) => a.status === "approved" || a.status === "paid");
  const committedCostCents = committed.reduce((sum, a) => sum + Math.round(a.amountCents), 0);

  const comparable = committed.filter(
    (a) => a.estimatedAmountCents != null && Math.round(a.estimatedAmountCents) > 0,
  );
  let costVarianceAvgPct: number | null = null;
  if (comparable.length > 0) {
    const sum = comparable.reduce((acc, a) => {
      const variance = computeVariance(Math.round(a.estimatedAmountCents!), Math.round(a.amountCents));
      return acc + (variance.variancePct ?? 0);
    }, 0);
    costVarianceAvgPct = Math.round((sum / comparable.length) * 10) / 10;
  }

  // Composite rating: punctuality and quality carry the weight; cost overrun subtracts.
  let derivedRating: number | null = null;
  if (onTimePct != null || qualityScore != null) {
    const punctuality = (onTimePct ?? 0) / 100;
    const quality = (qualityScore ?? 0) / 100;
    const costPenalty =
      costVarianceAvgPct != null && costVarianceAvgPct > 0
        ? Math.min(1, costVarianceAvgPct / 50)
        : 0;
    const composite = punctuality * 0.45 + quality * 0.45 - costPenalty * 0.1;
    derivedRating = Math.round(Math.max(0, Math.min(1, composite)) * 5 * 10) / 10;
  }

  const signals: string[] = [];
  if (onTimePct != null && onTimePct < 70) {
    signals.push(`On-time performance is ${onTimePct}% across ${measured.length} measured task(s).`);
  }
  if (avgDaysLate != null && avgDaysLate > 2) {
    signals.push(`Average completion is ${avgDaysLate} day(s) behind the planned date.`);
  }
  if (qualityScore != null && qualityScore < 70) {
    signals.push(`Quality score is ${qualityScore}/100 (verification rate and rework).`);
  }
  if (costVarianceAvgPct != null && costVarianceAvgPct > 10) {
    signals.push(`Average cost variance is +${costVarianceAvgPct}% against the estimated amounts.`);
  }
  if (measured.length === 0 && closed.length > 0) {
    signals.push("Tasks were completed without planned dates — punctuality cannot be measured.");
  }

  return {
    measuredTaskCount: measured.length,
    completedTaskCount: closed.length,
    verifiedTaskCount: verified.length,
    onTimePct,
    avgDaysLate,
    qualityScore,
    costVarianceAvgPct,
    committedCostCents,
    derivedRating,
    signals,
  };
}

/** All compliance states, re-exported for router validation. */
export { COMPLIANCE_STATES };
