/**
 * structr.ai — PHASE 4 Price Adjustment Engine (PURE)
 *
 * The gate between what the system learned and what the company charges.
 *
 * Contract: docs/phase4-contract.md §3 (PA-001 … PA-005)
 *
 * The entire design of this module is defensive, for one reason: an estimating platform that
 * can reprice itself is an estimating platform that can quietly destroy a year of margin. So:
 *
 *   - PA-001: a single adjustment never exceeds ±25%, and anything under 2% is refused as noise.
 *   - PA-002: `applied` is reachable only from `approved`, and approval requires a named human.
 *   - PA-003: the lifecycle is a state machine, validated here and in the database.
 *   - PA-004: applying an adjustment produces a rollback snapshot capable of exact restoration.
 *   - PA-005: at most one live adjustment per target, so two adjustments cannot compound
 *     silently into a 40% move that neither approver intended.
 *
 * PURE module: no DB, no IO, no clock (timestamps arrive as arguments), no randomness.
 */

import {
  MAX_ADJUSTMENT_PCT,
  MIN_ADJUSTMENT_PCT,
  bandAllowsProposal,
  canTransitionPriceAdjustment,
  isPriceAdjustmentTerminal,
  normalizePriceAdjustmentStatus,
  type ConfidenceBand,
  type PriceAdjustmentStatus,
  type PriceAdjustmentTarget,
} from "./domain/phase4-taxonomy";
import { formatCents } from "./actuals-variance-engine";
import { round1, round2, type CalibrationFinding } from "./calibration-engine";

// ══════════════════════════════════════════════════════════════════════
// VIOLATIONS
// ══════════════════════════════════════════════════════════════════════

export type PriceAdjustmentRuleId =
  | "PA-001"
  | "PA-002"
  | "PA-003"
  | "PA-004"
  | "PA-005";

export interface PriceAdjustmentViolation {
  rule: PriceAdjustmentRuleId;
  field: string;
  message: string;
  severity: "block" | "warn";
}

// ══════════════════════════════════════════════════════════════════════
// PROPOSAL FROM A FINDING
// ══════════════════════════════════════════════════════════════════════

export interface AdjustmentProposal {
  targetType: PriceAdjustmentTarget;
  costCode: string | null;
  costCodeId: string | null;
  assemblyId: string | null;
  geoZoneId: string | null;
  trade: string | null;
  adjustmentPct: number;
  reason: string;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  sampleCount: number;
  /** Value observed before the change (unit cost in cents, or factor value). */
  previousValue: number | null;
  /** Value the proposal would set. */
  newValue: number | null;
  previousUnitCostCents: number | null;
  newUnitCostCents: number | null;
}

/**
 * Turn a calibration finding into a proposal, or refuse.
 *
 * Refusal is the common case and that is correct: most findings are not strong enough to move
 * a price, and returning `null` keeps the operator's approval queue meaningful rather than a
 * feed of low-confidence noise nobody reads.
 */
export function proposalFromFinding(
  finding: CalibrationFinding,
  options: {
    /** Current unit cost of the target in cents, when the target is a cost code/assembly. */
    currentUnitCostCents?: number | null;
    /** Current factor value, when the target is a geo or duration factor. */
    currentFactor?: number | null;
    maxAdjustmentPct?: number;
  } = {},
): AdjustmentProposal | null {
  if (!finding.actionable) return null;
  if (!bandAllowsProposal(finding.confidence.band)) return null;

  const pct = round1(finding.suggestion.adjustmentPct);
  if (pct === 0 || Math.abs(pct) < MIN_ADJUSTMENT_PCT) return null;

  const maxPct = Math.min(
    Math.abs(options.maxAdjustmentPct ?? MAX_ADJUSTMENT_PCT),
    MAX_ADJUSTMENT_PCT,
  );
  if (Math.abs(pct) > maxPct) return null;

  let targetType: PriceAdjustmentTarget;
  if (finding.eventType === "geo_factor_validation") targetType = "geo_factor";
  else if (finding.eventType === "duration_accuracy") targetType = "duration_factor";
  else if (finding.assemblyId) targetType = "assembly";
  else targetType = "cost_code";

  // Target identity must be present, or the database check `ck_price_adjustments_target_present`
  // would reject the row later. Failing here keeps the error close to the cause.
  if (targetType === "cost_code" && !finding.costCodeId) return null;
  if (targetType === "assembly" && !finding.assemblyId) return null;
  if (targetType === "geo_factor" && !finding.geoZoneId) return null;
  if (targetType === "duration_factor" && !finding.trade) return null;

  const currentCents =
    options.currentUnitCostCents != null ? Math.round(options.currentUnitCostCents) : null;
  const newCents =
    currentCents != null ? Math.round(currentCents * (1 + pct / 100)) : null;

  const currentFactor =
    options.currentFactor != null
      ? round2(options.currentFactor)
      : finding.observedFactor != null
        ? round2(finding.observedFactor)
        : null;
  const newFactor =
    targetType === "geo_factor" && finding.suggestedFactor != null
      ? round2(finding.suggestedFactor)
      : currentFactor != null
        ? round2(currentFactor * (1 + pct / 100))
        : null;

  return {
    targetType,
    costCode: finding.costCode ?? null,
    costCodeId: finding.costCodeId ?? null,
    assemblyId: finding.assemblyId ?? null,
    geoZoneId: finding.geoZoneId ?? null,
    trade: finding.trade ?? null,
    adjustmentPct: pct,
    reason: finding.recommendation,
    confidenceScore: finding.confidence.score,
    confidenceBand: finding.confidence.band,
    sampleCount: finding.confidence.sampleCount,
    previousValue:
      targetType === "cost_code" || targetType === "assembly" ? currentCents : currentFactor,
    newValue: targetType === "cost_code" || targetType === "assembly" ? newCents : newFactor,
    previousUnitCostCents: currentCents,
    newUnitCostCents: newCents,
  };
}

/**
 * Build proposals for a batch of findings, respecting PA-005.
 *
 * When several findings point at the same target, only the highest-confidence one becomes a
 * proposal. Stacking two adjustments on the same cost code is how a 12% correction silently
 * becomes 25%.
 */
export function proposalsFromFindings(
  findings: readonly CalibrationFinding[],
  options: {
    currentUnitCostByTarget?: Record<string, number>;
    currentFactorByTarget?: Record<string, number>;
    maxAdjustmentPct?: number;
    /** Targets that already have a live adjustment; they are skipped entirely (PA-005). */
    targetsWithLiveAdjustment?: readonly string[];
  } = {},
): AdjustmentProposal[] {
  const live = new Set((options.targetsWithLiveAdjustment ?? []).map(t => t.toLowerCase()));
  const best = new Map<string, { proposal: AdjustmentProposal; score: number }>();

  for (const finding of findings) {
    const targetKey = (
      finding.costCodeId ??
      finding.assemblyId ??
      finding.geoZoneId ??
      finding.trade ??
      ""
    ).toLowerCase();
    if (!targetKey || live.has(targetKey)) continue;

    const proposal = proposalFromFinding(finding, {
      currentUnitCostCents: options.currentUnitCostByTarget?.[targetKey] ?? null,
      currentFactor: options.currentFactorByTarget?.[targetKey] ?? null,
      maxAdjustmentPct: options.maxAdjustmentPct,
    });
    if (!proposal) continue;

    const existing = best.get(targetKey);
    if (!existing || proposal.confidenceScore > existing.score) {
      best.set(targetKey, { proposal, score: proposal.confidenceScore });
    }
  }

  return Array.from(best.values())
    .map(v => v.proposal)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION (PA-001, PA-002, PA-004, PA-005)
// ══════════════════════════════════════════════════════════════════════

export interface AdjustmentValidationInput {
  targetType: PriceAdjustmentTarget;
  costCodeId?: string | null;
  assemblyId?: string | null;
  geoZoneId?: string | null;
  trade?: string | null;
  adjustmentPct: number;
  reason?: string | null;
  status?: PriceAdjustmentStatus;
  approvedBy?: string | null;
  confidenceBand?: ConfidenceBand | null;
  sampleCount?: number | null;
  rollbackSnapshot?: unknown;
  /** True when another adjustment is already live on this target. */
  hasLiveAdjustment?: boolean;
  maxAdjustmentPct?: number;
  /** Manual entries bypass the confidence gate but never the cap. */
  source?: "calibration" | "manual" | "import";
}

/**
 * Validate an adjustment before it is written.
 *
 * `block` violations must stop the operation; `warn` violations are shown to the operator and
 * recorded. The cap is always a block, including for manual entries: a human who wants a 40%
 * move must do it as two deliberate steps, and the second one will show up in the audit trail
 * next to the first.
 */
export function validateAdjustment(
  input: AdjustmentValidationInput,
): PriceAdjustmentViolation[] {
  const violations: PriceAdjustmentViolation[] = [];
  const maxPct = Math.min(
    Math.abs(input.maxAdjustmentPct ?? MAX_ADJUSTMENT_PCT),
    MAX_ADJUSTMENT_PCT,
  );
  const pct = Number(input.adjustmentPct);

  if (!Number.isFinite(pct)) {
    violations.push({
      rule: "PA-001",
      field: "adjustmentPct",
      message: "Adjustment percentage must be a finite number.",
      severity: "block",
    });
  } else {
    if (Math.abs(pct) > maxPct) {
      violations.push({
        rule: "PA-001",
        field: "adjustmentPct",
        message: `Adjustment of ${pct}% exceeds the ${maxPct}% cap. Split it into deliberate steps or correct the underlying cost data.`,
        severity: "block",
      });
    }
    if (pct === 0) {
      violations.push({
        rule: "PA-001",
        field: "adjustmentPct",
        message: "A zero-percent adjustment changes nothing.",
        severity: "block",
      });
    } else if (Math.abs(pct) < MIN_ADJUSTMENT_PCT) {
      violations.push({
        rule: "PA-001",
        field: "adjustmentPct",
        message: `Adjustment of ${pct}% is below the ${MIN_ADJUSTMENT_PCT}% noise floor; the price book should not churn for this.`,
        severity: "warn",
      });
    }
  }

  if (!input.reason || String(input.reason).trim().length < 8) {
    violations.push({
      rule: "PA-002",
      field: "reason",
      message: "A price change requires a reason a future reader can act on.",
      severity: "block",
    });
  }

  // Target identity
  const targetMissing =
    (input.targetType === "cost_code" && !input.costCodeId) ||
    (input.targetType === "assembly" && !input.assemblyId) ||
    (input.targetType === "geo_factor" && !input.geoZoneId) ||
    (input.targetType === "duration_factor" && !input.trade);
  if (targetMissing) {
    violations.push({
      rule: "PA-001",
      field: "targetType",
      message: `Target of type ${input.targetType} is not identified.`,
      severity: "block",
    });
  }

  // PA-005: one live adjustment per target
  if (input.hasLiveAdjustment) {
    violations.push({
      rule: "PA-005",
      field: "status",
      message:
        "This target already has a live adjustment. Roll it back before applying another, so corrections cannot compound silently.",
      severity: "block",
    });
  }

  // PA-002: approval identity
  const status = input.status ?? "proposed";
  if ((status === "approved" || status === "applied") && !input.approvedBy) {
    violations.push({
      rule: "PA-002",
      field: "approvedBy",
      message: "An approved adjustment must name the person who approved it.",
      severity: "block",
    });
  }

  // PA-004: rollback snapshot
  if (status === "applied" && (input.rollbackSnapshot == null)) {
    violations.push({
      rule: "PA-004",
      field: "rollbackSnapshot",
      message: "An applied adjustment must carry a rollback snapshot.",
      severity: "block",
    });
  }

  // Confidence gate applies to machine-generated proposals only.
  if ((input.source ?? "calibration") === "calibration") {
    if (input.confidenceBand && !bandAllowsProposal(input.confidenceBand)) {
      violations.push({
        rule: "PA-002",
        field: "confidenceBand",
        message: `Confidence band ${input.confidenceBand} is too weak for an automated proposal. Enter it manually with a reason if the field says otherwise.`,
        severity: "block",
      });
    }
  }

  return violations;
}

/** True when no `block` violation is present. */
export function isAdjustmentAllowed(violations: readonly PriceAdjustmentViolation[]): boolean {
  return !violations.some(v => v.severity === "block");
}

// ══════════════════════════════════════════════════════════════════════
// TRANSITIONS (PA-003)
// ══════════════════════════════════════════════════════════════════════

export interface TransitionEvaluation {
  allowed: boolean;
  from: PriceAdjustmentStatus;
  to: PriceAdjustmentStatus;
  violations: PriceAdjustmentViolation[];
}

/**
 * Evaluate a lifecycle transition.
 *
 * Mirrors the database trigger `structr_guard_price_adjustment_transition` on purpose: the
 * database is the last line of defence, but the operator deserves an explanation, not a
 * Postgres exception.
 */
export function evaluateAdjustmentTransition(input: {
  from: PriceAdjustmentStatus;
  to: PriceAdjustmentStatus;
  actorId?: string | null;
  rollbackSnapshot?: unknown;
  reason?: string | null;
}): TransitionEvaluation {
  const violations: PriceAdjustmentViolation[] = [];
  const { from, to } = input;

  if (isPriceAdjustmentTerminal(from)) {
    violations.push({
      rule: "PA-003",
      field: "status",
      message: `Adjustment is ${from} and cannot change. Propose a new one instead.`,
      severity: "block",
    });
  } else if (!canTransitionPriceAdjustment(from, to)) {
    violations.push({
      rule: "PA-003",
      field: "status",
      message: `Illegal transition ${from} → ${to}.`,
      severity: "block",
    });
  }

  if (to === "applied") {
    if (from !== "approved") {
      violations.push({
        rule: "PA-002",
        field: "status",
        message:
          "An adjustment can only be applied after explicit human approval. This is the guard that keeps the learning layer from repricing the company by itself.",
        severity: "block",
      });
    }
    if (input.rollbackSnapshot == null) {
      violations.push({
        rule: "PA-004",
        field: "rollbackSnapshot",
        message: "Applying an adjustment requires a rollback snapshot of the current price.",
        severity: "block",
      });
    }
  }

  if ((to === "approved" || to === "applied" || to === "rolled_back") && !input.actorId) {
    violations.push({
      rule: "PA-002",
      field: "actorId",
      message: `Transition to ${to} must be attributable to a person.`,
      severity: "block",
    });
  }

  if ((to === "rejected" || to === "rolled_back") && !input.reason) {
    violations.push({
      rule: "PA-002",
      field: "reason",
      message: `A ${to} decision requires a reason.`,
      severity: "block",
    });
  }

  return {
    allowed: !violations.some(v => v.severity === "block"),
    from,
    to,
    violations,
  };
}

/** Coerce arbitrary input to a known status, defaulting to `proposed`. */
export function resolveAdjustmentStatus(
  value: string | null | undefined,
): PriceAdjustmentStatus {
  return normalizePriceAdjustmentStatus(value) ?? "proposed";
}

// ══════════════════════════════════════════════════════════════════════
// APPLICATION AND ROLLBACK (PA-004)
// ══════════════════════════════════════════════════════════════════════

export interface RollbackSnapshot {
  targetType: PriceAdjustmentTarget;
  targetId: string;
  /** Unit cost before the change, in cents. */
  previousUnitCostCents: number | null;
  previousUnitPriceCents: number | null;
  /** Factor value before the change (geo floor, duration multiplier). */
  previousFactor: number | null;
  /** Pricing history row that was active before the change, if any. */
  previousPricingHistoryId: string | null;
  capturedAt: string;
  /** Free-form copy of the row as it was, for forensic comparison. */
  raw?: Record<string, unknown>;
}

/**
 * Compute the applied values and the snapshot needed to undo them.
 *
 * Deliberately returns both halves together: an implementation that computes the new price in
 * one place and the rollback data in another will eventually apply a change it cannot revert.
 */
export function computeApplication(input: {
  targetType: PriceAdjustmentTarget;
  targetId: string;
  adjustmentPct: number;
  currentUnitCostCents?: number | null;
  currentUnitPriceCents?: number | null;
  currentFactor?: number | null;
  currentPricingHistoryId?: string | null;
  capturedAt: string;
  raw?: Record<string, unknown>;
}): {
  newUnitCostCents: number | null;
  newUnitPriceCents: number | null;
  newFactor: number | null;
  snapshot: RollbackSnapshot;
} {
  const pct = Number(input.adjustmentPct);
  const factor = 1 + pct / 100;

  const currentCost =
    input.currentUnitCostCents != null ? Math.round(input.currentUnitCostCents) : null;
  const currentPrice =
    input.currentUnitPriceCents != null ? Math.round(input.currentUnitPriceCents) : null;
  const currentFactorValue =
    input.currentFactor != null ? round2(input.currentFactor) : null;

  return {
    newUnitCostCents: currentCost != null ? Math.round(currentCost * factor) : null,
    // The sell price moves with the cost so the configured margin is preserved: adjusting cost
    // without price would silently eat the margin the Profit Shield is defending.
    newUnitPriceCents: currentPrice != null ? Math.round(currentPrice * factor) : null,
    newFactor: currentFactorValue != null ? round2(currentFactorValue * factor) : null,
    snapshot: {
      targetType: input.targetType,
      targetId: input.targetId,
      previousUnitCostCents: currentCost,
      previousUnitPriceCents: currentPrice,
      previousFactor: currentFactorValue,
      previousPricingHistoryId: input.currentPricingHistoryId ?? null,
      capturedAt: input.capturedAt,
      raw: input.raw,
    },
  };
}

/**
 * Derive the values to restore from a snapshot.
 * Restoration is exact — it does not re-derive by inverting the percentage, because rounding
 * an inverse percentage does not always return the original integer cent value.
 */
export function computeRollback(snapshot: RollbackSnapshot): {
  unitCostCents: number | null;
  unitPriceCents: number | null;
  factor: number | null;
  pricingHistoryId: string | null;
} {
  return {
    unitCostCents: snapshot.previousUnitCostCents,
    unitPriceCents: snapshot.previousUnitPriceCents,
    factor: snapshot.previousFactor,
    pricingHistoryId: snapshot.previousPricingHistoryId,
  };
}

/** Verify that a rollback would restore the exact previous state. */
export function verifyRollbackIntegrity(input: {
  snapshot: RollbackSnapshot;
  restoredUnitCostCents?: number | null;
  restoredFactor?: number | null;
}): { intact: boolean; issues: string[] } {
  const issues: string[] = [];
  const { snapshot } = input;

  if (snapshot.previousUnitCostCents != null) {
    if (input.restoredUnitCostCents == null) {
      issues.push("Snapshot carries a unit cost but nothing was restored.");
    } else if (Math.round(input.restoredUnitCostCents) !== snapshot.previousUnitCostCents) {
      issues.push(
        `Restored unit cost ${formatCents(Math.round(input.restoredUnitCostCents))} does not match the snapshot ${formatCents(snapshot.previousUnitCostCents)}.`,
      );
    }
  }

  if (snapshot.previousFactor != null) {
    if (input.restoredFactor == null) {
      issues.push("Snapshot carries a factor but nothing was restored.");
    } else if (round2(input.restoredFactor) !== round2(snapshot.previousFactor)) {
      issues.push(
        `Restored factor ${round2(input.restoredFactor)} does not match the snapshot ${round2(snapshot.previousFactor)}.`,
      );
    }
  }

  return { intact: issues.length === 0, issues };
}

// ══════════════════════════════════════════════════════════════════════
// IMPACT PREVIEW
// ══════════════════════════════════════════════════════════════════════

export interface AdjustmentImpact {
  adjustmentPct: number
  /** Annualized money impact based on historical volume of the target. */
  annualImpactCents: number;
  annualImpact: string;
  /** Change in the margin percentage of a representative estimate, in points. */
  marginImpactPp: number | null;
  /** Estimates that would price differently if this were applied. */
  affectedEstimateCount: number;
  summary: string;
}

/**
 * Preview the impact of an adjustment before approval.
 *
 * Approving a percentage is abstract; approving "this adds $18,400 a year to what we charge
 * for framing labor" is a decision. The margin figure is expressed in points because that is
 * the unit the Profit Shield floors are written in.
 */
export function previewAdjustmentImpact(input: {
  adjustmentPct: number;
  /** Historical cost volume of this target over the reference window, in cents. */
  historicalVolumeCents: number;
  /** Estimated gross margin of a representative job as a percentage, if known. */
  representativeMarginPct?: number | null;
  /** Share of a representative job's cost that this target represents, 0–1. */
  costShareOfJob?: number | null;
  affectedEstimateCount?: number;
}): AdjustmentImpact {
  const pct = Number(input.adjustmentPct);
  const volume = Math.round(input.historicalVolumeCents);
  const annualImpactCents = Math.round(volume * (pct / 100));

  let marginImpactPp: number | null = null;
  if (input.representativeMarginPct != null && input.costShareOfJob != null) {
    // Raising a cost that is `share` of the job by `pct` moves margin down by roughly
    // share × pct × (1 − margin), because the sell price is held constant in this preview.
    const share = Math.max(0, Math.min(1, input.costShareOfJob));
    const margin = input.representativeMarginPct / 100;
    marginImpactPp = round1(-share * pct * (1 - margin));
  }

  const direction = pct > 0 ? "increase" : "reduce";
  const summary =
    `A ${Math.abs(pct)}% ${direction} on this target changes roughly ${formatCents(Math.abs(annualImpactCents))} of annual volume` +
    (marginImpactPp != null
      ? `, moving the margin of a representative job by ${marginImpactPp}pp if the sell price is held.`
      : ".");

  return {
    adjustmentPct: round1(pct),
    annualImpactCents,
    annualImpact: formatCents(annualImpactCents),
    marginImpactPp,
    affectedEstimateCount: input.affectedEstimateCount ?? 0,
    summary,
  };
}
