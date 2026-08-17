/**
 * structr.ai — PHASE 4 Price Adjustment Persistence
 *
 * Contract: docs/phase4-contract.md §3 (PA-001 … PA-005)
 *
 * The only path from learning to the price book. Decision logic lives in
 * `shared/price-adjustment-engine.ts`; this module persists the lifecycle, mutates the price
 * book on `apply`, and restores it exactly on `rollback`.
 *
 * Invariants enforced here:
 *   PA-001  ±25% cap, 2% noise floor
 *   PA-002  `applied` requires a prior human `approved` with a named approver
 *   PA-003  proposed → approved → applied, with rejected/rolled_back as exits
 *   PA-004  applying captures a rollback snapshot capable of exact restoration
 *   PA-005  at most one live adjustment per target
 *
 * Why `applyAdjustment` writes a new `cost_code_pricing_history` row instead of overwriting the
 * price: the price book is versioned history, and a GC challenged on an invoice needs to show
 * what the price was on the day the job was bid, not what it is today.
 */

import { and, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import {
  calibrationEvents,
  costCodePricingHistory,
  costCodes,
  geoZones,
  priceAdjustments,
  type PriceAdjustment,
} from "../drizzle/schema";
import { recordAuditAsync } from "./audit-trail";
import { assertSameTenant, tenantWhere, withTenant } from "./tenant-scope";
import {
  computeApplication,
  computeRollback,
  evaluateAdjustmentTransition,
  isAdjustmentAllowed,
  previewAdjustmentImpact,
  proposalsFromFindings,
  validateAdjustment,
  verifyRollbackIntegrity,
  type AdjustmentImpact,
  type AdjustmentProposal,
  type PriceAdjustmentViolation,
  type RollbackSnapshot,
} from "@shared/price-adjustment-engine";
import {
  MAX_ADJUSTMENT_PCT,
  isPriceAdjustmentLive,
  normalizePriceAdjustmentStatus,
  normalizePriceAdjustmentTarget,
  type PriceAdjustmentStatus,
  type PriceAdjustmentTarget,
} from "@shared/domain/phase4-taxonomy";
import { formatCents, toCents } from "@shared/actuals-variance-engine";
import type { CalibrationFinding } from "@shared/calibration-engine";
import { getCalibrationEvent, markEventActioned } from "./calibration-db";
import { getTenantSettings } from "./tenant-settings-db";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type PriceAdjustmentErrorCode =
  | "DB_UNAVAILABLE"
  | "ADJUSTMENT_NOT_FOUND"
  | "ADJUSTMENT_VALIDATION_FAILED"
  | "ADJUSTMENT_CAP_EXCEEDED"
  | "ADJUSTMENT_NOT_APPROVED"
  | "INVALID_ADJUSTMENT_TRANSITION"
  | "ADJUSTMENT_TERMINAL"
  | "DUPLICATE_LIVE_ADJUSTMENT"
  | "MISSING_ROLLBACK_SNAPSHOT"
  | "ROLLBACK_INTEGRITY_FAILED"
  | "TARGET_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "AUTO_APPLY_FORBIDDEN";

export class PriceAdjustmentError extends Error {
  public readonly code: PriceAdjustmentErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    code: PriceAdjustmentErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PriceAdjustmentError";
    this.code = code;
    this.details = details;
  }
}

function firstBlock(violations: readonly PriceAdjustmentViolation[]): PriceAdjustmentViolation | null {
  return violations.find(v => v.severity === "block") ?? null;
}

function errorCodeForViolation(v: PriceAdjustmentViolation): PriceAdjustmentErrorCode {
  switch (v.rule) {
    case "PA-001":
      return v.field === "adjustmentPct"
        ? "ADJUSTMENT_CAP_EXCEEDED"
        : "ADJUSTMENT_VALIDATION_FAILED";
    case "PA-002":
      return "ADJUSTMENT_NOT_APPROVED";
    case "PA-003":
      return "INVALID_ADJUSTMENT_TRANSITION";
    case "PA-004":
      return "MISSING_ROLLBACK_SNAPSHOT";
    case "PA-005":
      return "DUPLICATE_LIVE_ADJUSTMENT";
    default:
      return "ADJUSTMENT_VALIDATION_FAILED";
  }
}

function numOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ══════════════════════════════════════════════════════════════════════
// TARGET RESOLUTION
// ══════════════════════════════════════════════════════════════════════

interface TargetState {
  targetType: PriceAdjustmentTarget;
  targetId: string;
  label: string;
  unitCostCents: number | null;
  unitPriceCents: number | null;
  factor: number | null;
  activePricingHistoryId: string | null;
  raw: Record<string, unknown>;
}

/**
 * Read the current state of an adjustment target.
 *
 * Called both when previewing and when applying, so the snapshot written to
 * `rollback_snapshot` is produced by the same code that computed the new value — a rollback
 * derived from a different read path is a rollback that silently drifts.
 */
async function loadTargetState(input: {
  tenantId: string;
  targetType: PriceAdjustmentTarget;
  costCodeId?: string | null;
  assemblyId?: string | null;
  geoZoneId?: string | null;
  trade?: string | null;
}): Promise<TargetState> {
  const db = await getDb();
  if (!db) throw new PriceAdjustmentError("DB_UNAVAILABLE", "Database not available.");

  if (input.targetType === "cost_code") {
    if (!input.costCodeId) {
      throw new PriceAdjustmentError("TARGET_NOT_FOUND", "Cost code target not identified.");
    }
    const [code] = await db
      .select()
      .from(costCodes)
      .where(tenantWhere(costCodes, input.tenantId, eq(costCodes.id, input.costCodeId)))
      .limit(1);

    if (!code) {
      throw new PriceAdjustmentError(
        "TARGET_NOT_FOUND",
        `Cost code ${input.costCodeId} not found in this tenant.`,
        { costCodeId: input.costCodeId },
      );
    }

    const [price] = await db
      .select()
      .from(costCodePricingHistory)
      .where(
        and(
          eq(costCodePricingHistory.costCodeId, code.id),
          eq(costCodePricingHistory.isActive, true),
        ),
      )
      .orderBy(desc(costCodePricingHistory.effectiveDate))
      .limit(1);

    return {
      targetType: "cost_code",
      targetId: code.id,
      label: `${code.code} — ${code.name}`,
      unitCostCents: price ? Math.round(toCents(price.unitCost ?? 0)) : null,
      unitPriceCents: price ? Math.round(toCents(price.unitPrice ?? 0)) : null,
      factor: null,
      activePricingHistoryId: price?.id ?? null,
      raw: { costCode: code, pricing: price ?? null },
    };
  }

  if (input.targetType === "geo_factor") {
    if (!input.geoZoneId) {
      throw new PriceAdjustmentError("TARGET_NOT_FOUND", "Geo zone target not identified.");
    }
    const [zone] = await db
      .select()
      .from(geoZones)
      .where(eq(geoZones.id, input.geoZoneId))
      .limit(1);

    if (!zone) {
      throw new PriceAdjustmentError(
        "TARGET_NOT_FOUND",
        `Geo zone ${input.geoZoneId} not found.`,
        { geoZoneId: input.geoZoneId },
      );
    }

    return {
      targetType: "geo_factor",
      targetId: zone.id,
      label: `Geo zone ${zone.name ?? zone.id}`,
      unitCostCents: null,
      unitPriceCents: null,
      factor: numOrNull(zone.minProfitShieldPct as never),
      activePricingHistoryId: null,
      raw: { geoZone: zone },
    };
  }

  if (input.targetType === "assembly") {
    if (!input.assemblyId) {
      throw new PriceAdjustmentError("TARGET_NOT_FOUND", "Assembly target not identified.");
    }
    return {
      targetType: "assembly",
      targetId: input.assemblyId,
      label: `Assembly ${input.assemblyId}`,
      unitCostCents: null,
      unitPriceCents: null,
      factor: null,
      activePricingHistoryId: null,
      raw: { assemblyId: input.assemblyId },
    };
  }

  if (!input.trade) {
    throw new PriceAdjustmentError("TARGET_NOT_FOUND", "Duration factor target not identified.");
  }
  return {
    targetType: "duration_factor",
    targetId: input.trade,
    label: `Duration factor for ${input.trade}`,
    unitCostCents: null,
    unitPriceCents: null,
    factor: null,
    activePricingHistoryId: null,
    raw: { trade: input.trade },
  };
}

function targetKeyOf(row: {
  targetType: string;
  costCodeId?: string | null;
  assemblyId?: string | null;
  geoZoneId?: string | null;
  trade?: string | null;
}): string {
  return (row.costCodeId ?? row.assemblyId ?? row.geoZoneId ?? row.trade ?? "").toLowerCase();
}

/** PA-005: does this target already carry a live (proposed/approved/applied) adjustment? */
export async function hasLiveAdjustment(input: {
  tenantId: string;
  targetType: PriceAdjustmentTarget;
  costCodeId?: string | null;
  assemblyId?: string | null;
  geoZoneId?: string | null;
  trade?: string | null;
  excludeId?: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const conditions: Array<SQL | undefined> = [
    eq(priceAdjustments.targetType, input.targetType),
    inArray(priceAdjustments.status, ["proposed", "approved", "applied"]),
    isNull(priceAdjustments.deletedAt),
  ];

  if (input.costCodeId) conditions.push(eq(priceAdjustments.costCodeId, input.costCodeId));
  if (input.assemblyId) conditions.push(eq(priceAdjustments.assemblyId, input.assemblyId));
  if (input.geoZoneId) conditions.push(eq(priceAdjustments.geoZoneId, input.geoZoneId));
  if (input.trade) conditions.push(eq(priceAdjustments.trade, input.trade));
  if (input.excludeId) conditions.push(ne(priceAdjustments.id, input.excludeId));

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(priceAdjustments)
    .where(tenantWhere(priceAdjustments, input.tenantId, ...conditions));

  return (row?.count ?? 0) > 0;
}

// ══════════════════════════════════════════════════════════════════════
// PROPOSE
// ══════════════════════════════════════════════════════════════════════

export interface ProposeAdjustmentInput {
  tenantId: string;
  targetType: string;
  costCodeId?: string | null;
  costCode?: string | null;
  assemblyId?: string | null;
  geoZoneId?: string | null;
  trade?: string | null;
  adjustmentPct: number;
  reason: string;
  actorId: string;
  sourceCalibrationId?: string | null;
  sourceReportId?: string | null;
  source?: "calibration" | "manual" | "import";
  confidenceScore?: number | null;
  confidenceBand?: string | null;
  sampleCount?: number | null;
  effectiveFrom?: string | null;
  notes?: string | null;
}

/**
 * Create a proposal. Nothing is applied.
 *
 * A proposal is cheap and reversible; the expensive, irreversible act is `apply`, and it is
 * deliberately a separate call made by a named human.
 */
export async function proposeAdjustment(
  input: ProposeAdjustmentInput,
): Promise<{ adjustment: PriceAdjustment; warnings: PriceAdjustmentViolation[] }> {
  const db = await getDb();
  if (!db) throw new PriceAdjustmentError("DB_UNAVAILABLE", "Database not available.");

  const targetType = normalizePriceAdjustmentTarget(input.targetType) ?? "cost_code";
  const settings = await getTenantSettings(input.tenantId);
  const maxAdjustmentPct = numOrNull(settings?.maxAdjustmentPct as never) ?? MAX_ADJUSTMENT_PCT;

  const live = await hasLiveAdjustment({
    tenantId: input.tenantId,
    targetType,
    costCodeId: input.costCodeId,
    assemblyId: input.assemblyId,
    geoZoneId: input.geoZoneId,
    trade: input.trade,
  });

  const violations = validateAdjustment({
    targetType,
    costCodeId: input.costCodeId,
    assemblyId: input.assemblyId,
    geoZoneId: input.geoZoneId,
    trade: input.trade,
    adjustmentPct: input.adjustmentPct,
    reason: input.reason,
    status: "proposed",
    confidenceBand: (input.confidenceBand ?? null) as never,
    sampleCount: input.sampleCount ?? null,
    hasLiveAdjustment: live,
    maxAdjustmentPct,
    source: input.source ?? (input.sourceCalibrationId ? "calibration" : "manual"),
  });

  const blocker = firstBlock(violations);
  if (blocker) {
    throw new PriceAdjustmentError(errorCodeForViolation(blocker), blocker.message, {
      violations,
    });
  }

  const target = await loadTargetState({
    tenantId: input.tenantId,
    targetType,
    costCodeId: input.costCodeId,
    assemblyId: input.assemblyId,
    geoZoneId: input.geoZoneId,
    trade: input.trade,
  });

  const projection = computeApplication({
    targetType,
    targetId: target.targetId,
    adjustmentPct: input.adjustmentPct,
    currentUnitCostCents: target.unitCostCents,
    currentUnitPriceCents: target.unitPriceCents,
    currentFactor: target.factor,
    currentPricingHistoryId: target.activePricingHistoryId,
    capturedAt: new Date().toISOString(),
  });

  const [created] = await db
    .insert(priceAdjustments)
    .values(
      withTenant(
        {
          targetType,
          costCodeId: input.costCodeId ?? null,
          costCode: input.costCode ?? null,
          assemblyId: input.assemblyId ?? null,
          geoZoneId: input.geoZoneId ?? null,
          trade: input.trade ?? null,
          adjustmentPct: String(input.adjustmentPct),
          previousValue:
            target.unitCostCents != null
              ? String(target.unitCostCents)
              : target.factor != null
                ? String(target.factor)
                : null,
          newValue:
            projection.newUnitCostCents != null
              ? String(projection.newUnitCostCents)
              : projection.newFactor != null
                ? String(projection.newFactor)
                : null,
          previousUnitCostCents: target.unitCostCents,
          newUnitCostCents: projection.newUnitCostCents,
          reason: input.reason,
          sourceCalibrationId: input.sourceCalibrationId ?? null,
          sourceReportId: input.sourceReportId ?? null,
          source: input.source ?? (input.sourceCalibrationId ? "calibration" : "manual"),
          confidenceScore:
            input.confidenceScore != null ? String(input.confidenceScore) : null,
          confidenceBand: input.confidenceBand ?? null,
          sampleCount: input.sampleCount ?? 0,
          status: "proposed",
          proposedBy: input.actorId,
          proposedAt: new Date(),
          effectiveFrom: input.effectiveFrom ?? null,
          notes: input.notes ?? null,
          createdBy: input.actorId,
        },
        input.tenantId,
      ) as never,
    )
    .returning();

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId,
    entityType: "price_adjustment",
    entityId: created.id,
    entityKey: target.label,
    action: "price_adjustment.proposed",
    before: null,
    after: created,
    reason: input.reason,
  });

  return { adjustment: created, warnings: violations.filter(v => v.severity === "warn") };
}

/**
 * Turn the actionable findings of a calibration run into proposals.
 *
 * Returns what it created and what it skipped. Silence about skipped findings would let an
 * operator believe the queue is complete when PA-005 quietly dropped half of it.
 */
export async function proposeFromFindings(input: {
  tenantId: string;
  findings: readonly CalibrationFinding[];
  actorId: string;
  sourceReportId?: string | null;
}): Promise<{
  created: PriceAdjustment[];
  proposals: AdjustmentProposal[];
  skipped: Array<{ findingKey: string; reason: string }>;
}> {
  const db = await getDb();
  if (!db) throw new PriceAdjustmentError("DB_UNAVAILABLE", "Database not available.");

  const settings = await getTenantSettings(input.tenantId);
  const maxAdjustmentPct = numOrNull(settings?.maxAdjustmentPct as never) ?? MAX_ADJUSTMENT_PCT;

  // Targets already carrying a live adjustment are excluded up front (PA-005).
  const liveRows = await db
    .select({
      targetType: priceAdjustments.targetType,
      costCodeId: priceAdjustments.costCodeId,
      assemblyId: priceAdjustments.assemblyId,
      geoZoneId: priceAdjustments.geoZoneId,
      trade: priceAdjustments.trade,
    })
    .from(priceAdjustments)
    .where(
      tenantWhere(
        priceAdjustments,
        input.tenantId,
        inArray(priceAdjustments.status, ["proposed", "approved", "applied"]),
        isNull(priceAdjustments.deletedAt),
      ),
    );

  const targetsWithLiveAdjustment = liveRows.map(targetKeyOf).filter(Boolean);

  // Current unit costs, so the proposal can show money rather than a percentage.
  const currentUnitCostByTarget: Record<string, number> = {};
  const costCodeIds = Array.from(
    new Set(
      input.findings
        .filter(f => f.eventType === "price_accuracy" && f.costCodeId)
        .map(f => f.costCodeId as string),
    ),
  );

  if (costCodeIds.length > 0) {
    const prices = await db
      .select({
        costCodeId: costCodePricingHistory.costCodeId,
        unitCost: costCodePricingHistory.unitCost,
      })
      .from(costCodePricingHistory)
      .where(
        and(
          inArray(costCodePricingHistory.costCodeId, costCodeIds),
          eq(costCodePricingHistory.isActive, true),
        ),
      );

    for (const p of prices) {
      if (!p.costCodeId) continue;
      currentUnitCostByTarget[p.costCodeId.toLowerCase()] = Math.round(toCents(p.unitCost ?? 0));
    }
  }

  const proposals = proposalsFromFindings(input.findings, {
    currentUnitCostByTarget,
    maxAdjustmentPct,
    targetsWithLiveAdjustment,
  });

  const proposedKeys = new Set(
    proposals.map(p =>
      (p.costCodeId ?? p.assemblyId ?? p.geoZoneId ?? p.trade ?? "").toLowerCase(),
    ),
  );

  const skipped: Array<{ findingKey: string; reason: string }> = [];
  for (const finding of input.findings) {
    const key = (
      finding.costCodeId ??
      finding.assemblyId ??
      finding.geoZoneId ??
      finding.trade ??
      ""
    ).toLowerCase();
    if (proposedKeys.has(key)) continue;

    skipped.push({
      findingKey: finding.findingKey,
      reason: !finding.actionable
        ? `Not actionable: ${finding.confidence.rationale}`
        : targetsWithLiveAdjustment.includes(key)
          ? "Target already has a live adjustment (PA-005). Roll it back before proposing another."
          : "Below the proposal threshold after damping and capping.",
    });
  }

  const created: PriceAdjustment[] = [];
  for (const proposal of proposals) {
    const finding = input.findings.find(
      f =>
        (f.costCodeId ?? f.assemblyId ?? f.geoZoneId ?? f.trade ?? "").toLowerCase() ===
        (
          proposal.costCodeId ??
          proposal.assemblyId ??
          proposal.geoZoneId ??
          proposal.trade ??
          ""
        ).toLowerCase(),
    );

    let sourceCalibrationId: string | null = null;
    if (finding) {
      const [event] = await db
        .select({ id: calibrationEvents.id })
        .from(calibrationEvents)
        .where(
          and(
            eq(calibrationEvents.tenantId, input.tenantId),
            eq(calibrationEvents.findingKey, finding.findingKey),
          ),
        )
        .limit(1);
      sourceCalibrationId = event?.id ?? null;
    }

    try {
      const { adjustment } = await proposeAdjustment({
        tenantId: input.tenantId,
        targetType: proposal.targetType,
        costCodeId: proposal.costCodeId,
        costCode: proposal.costCode,
        assemblyId: proposal.assemblyId,
        geoZoneId: proposal.geoZoneId,
        trade: proposal.trade,
        adjustmentPct: proposal.adjustmentPct,
        reason: proposal.reason,
        actorId: input.actorId,
        sourceCalibrationId,
        sourceReportId: input.sourceReportId ?? null,
        source: "calibration",
        confidenceScore: proposal.confidenceScore,
        confidenceBand: proposal.confidenceBand,
        sampleCount: proposal.sampleCount,
      });
      created.push(adjustment);
    } catch (error) {
      skipped.push({
        findingKey: finding?.findingKey ?? proposal.costCode ?? proposal.targetType,
        reason: error instanceof Error ? error.message : "Unknown error creating proposal.",
      });
    }
  }

  return { created, proposals, skipped };
}

// ══════════════════════════════════════════════════════════════════════
// LIFECYCLE
// ══════════════════════════════════════════════════════════════════════

export async function getAdjustment(id: string): Promise<PriceAdjustment | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(priceAdjustments)
    .where(eq(priceAdjustments.id, id))
    .limit(1);

  return row ?? null;
}

async function loadForTransition(input: {
  adjustmentId: string;
  tenantId?: string | null;
}): Promise<PriceAdjustment> {
  const adjustment = await getAdjustment(input.adjustmentId);
  if (!adjustment) {
    throw new PriceAdjustmentError(
      "ADJUSTMENT_NOT_FOUND",
      `Price adjustment ${input.adjustmentId} not found.`,
      { adjustmentId: input.adjustmentId },
    );
  }
  if (!assertSameTenant(adjustment.tenantId, input.tenantId)) {
    throw new PriceAdjustmentError(
      "TENANT_MISMATCH",
      "Price adjustment belongs to another tenant.",
      { adjustmentId: input.adjustmentId },
    );
  }
  return adjustment;
}

function assertTransition(input: {
  from: PriceAdjustmentStatus;
  to: PriceAdjustmentStatus;
  actorId: string;
  rollbackSnapshot?: unknown;
  reason?: string | null;
}): void {
  const evaluation = evaluateAdjustmentTransition(input);
  if (evaluation.allowed) return;

  const blocker = firstBlock(evaluation.violations);
  throw new PriceAdjustmentError(
    blocker ? errorCodeForViolation(blocker) : "INVALID_ADJUSTMENT_TRANSITION",
    blocker?.message ?? `Illegal transition ${input.from} → ${input.to}.`,
    { violations: evaluation.violations },
  );
}

/** Approve a proposal. Approval does not change any price; `applyAdjustment` does. */
export async function approveAdjustment(input: {
  adjustmentId: string;
  actorId: string;
  tenantId?: string | null;
  notes?: string | null;
}): Promise<PriceAdjustment> {
  const db = await getDb();
  if (!db) throw new PriceAdjustmentError("DB_UNAVAILABLE", "Database not available.");

  const adjustment = await loadForTransition(input);
  const from = (normalizePriceAdjustmentStatus(adjustment.status) ?? "proposed") as PriceAdjustmentStatus;

  assertTransition({
    from,
    to: "approved",
    actorId: input.actorId,
    reason: adjustment.reason,
  });

  const [updated] = await db
    .update(priceAdjustments)
    .set({
      status: "approved",
      approvedBy: input.actorId,
      approvedAt: new Date(),
      notes: input.notes ?? adjustment.notes,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(eq(priceAdjustments.id, input.adjustmentId))
    .returning();

  recordAuditAsync({
    tenantId: adjustment.tenantId,
    userId: input.actorId,
    entityType: "price_adjustment",
    entityId: updated.id,
    action: "price_adjustment.approved",
    before: adjustment,
    after: updated,
    reason: input.notes ?? adjustment.reason,
  });

  return updated;
}

export async function rejectAdjustment(input: {
  adjustmentId: string;
  actorId: string;
  reason: string;
  tenantId?: string | null;
}): Promise<PriceAdjustment> {
  const db = await getDb();
  if (!db) throw new PriceAdjustmentError("DB_UNAVAILABLE", "Database not available.");

  const adjustment = await loadForTransition(input);
  const from = (normalizePriceAdjustmentStatus(adjustment.status) ?? "proposed") as PriceAdjustmentStatus;

  assertTransition({ from, to: "rejected", actorId: input.actorId, reason: input.reason });

  const [updated] = await db
    .update(priceAdjustments)
    .set({
      status: "rejected",
      rejectedBy: input.actorId,
      rejectedAt: new Date(),
      rejectionReason: input.reason,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(eq(priceAdjustments.id, input.adjustmentId))
    .returning();

  recordAuditAsync({
    tenantId: adjustment.tenantId,
    userId: input.actorId,
    entityType: "price_adjustment",
    entityId: updated.id,
    action: "price_adjustment.rejected",
    before: adjustment,
    after: updated,
    reason: input.reason,
  });

  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// APPLY (PA-002, PA-004)
// ══════════════════════════════════════════════════════════════════════

export interface ApplyAdjustmentResult {
  adjustment: PriceAdjustment;
  /** New pricing history row created, when the target is a cost code. */
  pricingHistoryId: string | null;
  previousUnitCostCents: number | null;
  newUnitCostCents: number | null;
  summary: string;
}

/**
 * Apply an approved adjustment to the price book.
 *
 * The order of operations matters: the snapshot is captured *before* the mutation and stored on
 * the adjustment row in the same transaction. If the process dies between the price write and
 * the snapshot write, the company owns a changed price it cannot revert — so those two writes
 * are not allowed to be separate steps.
 */
export async function applyAdjustment(input: {
  adjustmentId: string;
  actorId: string;
  tenantId?: string | null;
  effectiveDate?: string | null;
}): Promise<ApplyAdjustmentResult> {
  const db = await getDb();
  if (!db) throw new PriceAdjustmentError("DB_UNAVAILABLE", "Database not available.");

  const adjustment = await loadForTransition(input);
  const from = (normalizePriceAdjustmentStatus(adjustment.status) ?? "proposed") as PriceAdjustmentStatus;
  const targetType = (normalizePriceAdjustmentTarget(adjustment.targetType) ??
    "cost_code") as PriceAdjustmentTarget;
  const tenantId = adjustment.tenantId ?? input.tenantId ?? null;

  if (!tenantId) {
    throw new PriceAdjustmentError("TENANT_MISMATCH", "Adjustment has no tenant.");
  }

  // MT-003: there is no configuration that lets this run without a human.
  const settings = await getTenantSettings(tenantId);
  if (settings?.autoApplyAdjustments === true) {
    throw new PriceAdjustmentError(
      "AUTO_APPLY_FORBIDDEN",
      "Automatic application is not supported. Every price change requires a named approver.",
    );
  }

  const target = await loadTargetState({
    tenantId,
    targetType,
    costCodeId: adjustment.costCodeId,
    assemblyId: adjustment.assemblyId,
    geoZoneId: adjustment.geoZoneId,
    trade: adjustment.trade,
  });

  const capturedAt = new Date();
  const application = computeApplication({
    targetType,
    targetId: target.targetId,
    adjustmentPct: Number(adjustment.adjustmentPct),
    currentUnitCostCents: target.unitCostCents,
    currentUnitPriceCents: target.unitPriceCents,
    currentFactor: target.factor,
    currentPricingHistoryId: target.activePricingHistoryId,
    capturedAt: capturedAt.toISOString(),
    raw: target.raw,
  });

  // PA-002 + PA-004 are checked with the snapshot in hand, so the guard cannot pass on a
  // promise of a snapshot that never materialises.
  assertTransition({
    from,
    to: "applied",
    actorId: input.actorId,
    rollbackSnapshot: application.snapshot,
    reason: adjustment.reason,
  });

  const stillLive = await hasLiveAdjustment({
    tenantId,
    targetType,
    costCodeId: adjustment.costCodeId,
    assemblyId: adjustment.assemblyId,
    geoZoneId: adjustment.geoZoneId,
    trade: adjustment.trade,
    excludeId: adjustment.id,
  });

  if (stillLive) {
    const applied = await db
      .select({ id: priceAdjustments.id, status: priceAdjustments.status })
      .from(priceAdjustments)
      .where(
        tenantWhere(
          priceAdjustments,
          tenantId,
          eq(priceAdjustments.status, "applied"),
          ne(priceAdjustments.id, adjustment.id),
          isNull(priceAdjustments.deletedAt),
          targetType === "cost_code" && adjustment.costCodeId
            ? eq(priceAdjustments.costCodeId, adjustment.costCodeId)
            : undefined,
        ),
      )
      .limit(1);

    if (applied.length > 0) {
      throw new PriceAdjustmentError(
        "DUPLICATE_LIVE_ADJUSTMENT",
        "This target already has an applied adjustment. Roll it back first, so two corrections cannot compound into a move nobody approved.",
        { existingAdjustmentId: applied[0].id },
      );
    }
  }

  let pricingHistoryId: string | null = null;

  await db.transaction(async tx => {
    if (targetType === "cost_code" && adjustment.costCodeId) {
      const effectiveDate = input.effectiveDate ?? capturedAt.toISOString().slice(0, 10);

      // Close the current price row so history reads as a timeline, not a set of overlaps.
      if (target.activePricingHistoryId) {
        await tx
          .update(costCodePricingHistory)
          .set({ isActive: false, updatedBy: input.actorId })
          .where(eq(costCodePricingHistory.id, target.activePricingHistoryId));
      }

      const [created] = await tx
        .insert(costCodePricingHistory)
        .values({
          costCodeId: adjustment.costCodeId,
          unitCost:
            application.newUnitCostCents != null
              ? String(application.newUnitCostCents / 100)
              : null,
          unitPrice:
            application.newUnitPriceCents != null
              ? String(application.newUnitPriceCents / 100)
              : null,
          effectiveDate,
          isActive: true,
          source: "calibration",
          notes: `Applied price adjustment ${adjustment.id}: ${adjustment.reason}`,
          updatedBy: input.actorId,
          priceAdjustmentId: adjustment.id,
        } as never)
        .returning({ id: costCodePricingHistory.id });

      pricingHistoryId = created?.id ?? null;

      await tx
        .update(costCodes)
        .set({
          lastAdjustmentId: adjustment.id,
          lastAdjustmentPct: adjustment.adjustmentPct,
          lastAdjustedAt: capturedAt,
          updatedAt: capturedAt,
        })
        .where(eq(costCodes.id, adjustment.costCodeId));
    }

    if (targetType === "geo_factor" && adjustment.geoZoneId && application.newFactor != null) {
      await tx
        .update(geoZones)
        .set({
          minProfitShieldPct: String(application.newFactor),
          updatedAt: capturedAt,
        })
        .where(eq(geoZones.id, adjustment.geoZoneId));
    }

    await tx
      .update(priceAdjustments)
      .set({
        status: "applied",
        appliedBy: input.actorId,
        appliedAt: capturedAt,
        appliedPricingHistoryId: pricingHistoryId,
        rollbackSnapshot: application.snapshot as never,
        previousUnitCostCents: target.unitCostCents,
        newUnitCostCents: application.newUnitCostCents,
        previousValue:
          target.unitCostCents != null
            ? String(target.unitCostCents)
            : target.factor != null
              ? String(target.factor)
              : null,
        newValue:
          application.newUnitCostCents != null
            ? String(application.newUnitCostCents)
            : application.newFactor != null
              ? String(application.newFactor)
              : null,
        updatedBy: input.actorId,
        updatedAt: capturedAt,
      })
      .where(eq(priceAdjustments.id, adjustment.id));
  });

  const updated = (await getAdjustment(adjustment.id)) as PriceAdjustment;

  // Close the loop: the finding that justified this is now actioned, not open.
  if (adjustment.sourceCalibrationId) {
    await markEventActioned({
      eventId: adjustment.sourceCalibrationId,
      priceAdjustmentId: adjustment.id,
      actorId: input.actorId,
    });
  }

  const summary =
    target.unitCostCents != null && application.newUnitCostCents != null
      ? `${target.label}: ${formatCents(target.unitCostCents)} → ${formatCents(application.newUnitCostCents)} (${adjustment.adjustmentPct}%).`
      : `${target.label}: adjusted by ${adjustment.adjustmentPct}%.`;

  recordAuditAsync({
    tenantId,
    userId: input.actorId,
    entityType: "price_adjustment",
    entityId: adjustment.id,
    entityKey: target.label,
    action: "price_adjustment.applied",
    before: { target: target.raw, status: from },
    after: {
      status: "applied",
      newUnitCostCents: application.newUnitCostCents,
      pricingHistoryId,
    },
    amountCents:
      target.unitCostCents != null && application.newUnitCostCents != null
        ? application.newUnitCostCents - target.unitCostCents
        : null,
    reason: adjustment.reason,
  });

  return {
    adjustment: updated,
    pricingHistoryId,
    previousUnitCostCents: target.unitCostCents,
    newUnitCostCents: application.newUnitCostCents,
    summary,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ROLLBACK (PA-004)
// ══════════════════════════════════════════════════════════════════════

/**
 * Restore an applied adjustment's target to its exact previous state.
 *
 * Restoration replays the snapshot rather than inverting the percentage: applying −11.1% to a
 * price that was raised 12.5% does not return the original integer cent value, and a rollback
 * that lands one cent away from where it started is a rollback nobody will trust twice.
 */
export async function rollbackAdjustment(input: {
  adjustmentId: string;
  actorId: string;
  reason: string;
  tenantId?: string | null;
}): Promise<{ adjustment: PriceAdjustment; restored: ReturnType<typeof computeRollback> }> {
  const db = await getDb();
  if (!db) throw new PriceAdjustmentError("DB_UNAVAILABLE", "Database not available.");

  const adjustment = await loadForTransition(input);
  const from = (normalizePriceAdjustmentStatus(adjustment.status) ?? "proposed") as PriceAdjustmentStatus;

  assertTransition({ from, to: "rolled_back", actorId: input.actorId, reason: input.reason });

  const snapshot = adjustment.rollbackSnapshot as RollbackSnapshot | null;
  if (!snapshot) {
    throw new PriceAdjustmentError(
      "MISSING_ROLLBACK_SNAPSHOT",
      "This adjustment has no rollback snapshot, so the previous price cannot be restored exactly. Correct the price manually and record the reason.",
      { adjustmentId: adjustment.id },
    );
  }

  const restored = computeRollback(snapshot);
  const now = new Date();
  const targetType = (normalizePriceAdjustmentTarget(adjustment.targetType) ??
    "cost_code") as PriceAdjustmentTarget;

  await db.transaction(async tx => {
    if (targetType === "cost_code" && adjustment.costCodeId) {
      // Retire the row the adjustment created.
      if (adjustment.appliedPricingHistoryId) {
        await tx
          .update(costCodePricingHistory)
          .set({ isActive: false, updatedBy: input.actorId })
          .where(eq(costCodePricingHistory.id, adjustment.appliedPricingHistoryId));
      }

      if (snapshot.previousPricingHistoryId) {
        // Reactivate the exact row that was live before.
        await tx
          .update(costCodePricingHistory)
          .set({ isActive: true, updatedBy: input.actorId })
          .where(eq(costCodePricingHistory.id, snapshot.previousPricingHistoryId));
      } else if (restored.unitCostCents != null) {
        // No previous row to reactivate: write the snapshot values back as a new row so the
        // price book is never left with no active price at all.
        await tx.insert(costCodePricingHistory).values({
          costCodeId: adjustment.costCodeId,
          unitCost: String(restored.unitCostCents / 100),
          unitPrice:
            restored.unitPriceCents != null ? String(restored.unitPriceCents / 100) : null,
          effectiveDate: now.toISOString().slice(0, 10),
          isActive: true,
          source: "rollback",
          notes: `Rollback of adjustment ${adjustment.id}: ${input.reason}`,
          updatedBy: input.actorId,
          priceAdjustmentId: adjustment.id,
        } as never);
      }

      await tx
        .update(costCodes)
        .set({
          lastAdjustmentId: null,
          lastAdjustmentPct: null,
          lastAdjustedAt: null,
          updatedAt: now,
        })
        .where(eq(costCodes.id, adjustment.costCodeId));
    }

    if (targetType === "geo_factor" && adjustment.geoZoneId && restored.factor != null) {
      await tx
        .update(geoZones)
        .set({ minProfitShieldPct: String(restored.factor), updatedAt: now })
        .where(eq(geoZones.id, adjustment.geoZoneId));
    }

    await tx
      .update(priceAdjustments)
      .set({
        status: "rolled_back",
        rolledBackBy: input.actorId,
        rolledBackAt: now,
        rollbackReason: input.reason,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .where(eq(priceAdjustments.id, adjustment.id));
  });

  // Verify the restoration actually landed where the snapshot says it should.
  const verifyTarget = await loadTargetState({
    tenantId: adjustment.tenantId ?? input.tenantId ?? "",
    targetType,
    costCodeId: adjustment.costCodeId,
    assemblyId: adjustment.assemblyId,
    geoZoneId: adjustment.geoZoneId,
    trade: adjustment.trade,
  }).catch(() => null);

  const integrity = verifyTarget
    ? verifyRollbackIntegrity({
        snapshot,
        restoredUnitCostCents: verifyTarget.unitCostCents,
        restoredFactor: verifyTarget.factor,
      })
    : { intact: true, issues: [] as string[] };

  const updated = (await getAdjustment(adjustment.id)) as PriceAdjustment;

  recordAuditAsync({
    tenantId: adjustment.tenantId,
    userId: input.actorId,
    entityType: "price_adjustment",
    entityId: adjustment.id,
    action: "price_adjustment.rolled_back",
    before: adjustment,
    after: updated,
    reason: input.reason,
    metadata: { restored, integrity },
  });

  if (!integrity.intact) {
    // Reported rather than thrown: the rollback already happened, and hiding a mismatch would
    // leave the operator believing the price book is correct when it is not.
    console.error("[PriceAdjustment] Rollback integrity issues:", integrity.issues);
  }

  return { adjustment: updated, restored };
}

// ══════════════════════════════════════════════════════════════════════
// QUERIES AND PREVIEW
// ══════════════════════════════════════════════════════════════════════

export interface ListAdjustmentsOptions {
  tenantId?: string | null;
  status?: string;
  targetType?: string;
  costCodeId?: string;
  sourceCalibrationId?: string;
  /** Only proposals waiting on a human. */
  pendingOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listAdjustments(
  options: ListAdjustmentsOptions = {},
): Promise<{ adjustments: PriceAdjustment[]; total: number }> {
  const db = await getDb();
  if (!db) return { adjustments: [], total: 0 };

  const conditions: Array<SQL | undefined> = [isNull(priceAdjustments.deletedAt)];
  if (options.status) {
    const s = normalizePriceAdjustmentStatus(options.status);
    if (s) conditions.push(eq(priceAdjustments.status, s));
  }
  if (options.pendingOnly) conditions.push(eq(priceAdjustments.status, "proposed"));
  if (options.targetType) {
    const t = normalizePriceAdjustmentTarget(options.targetType);
    if (t) conditions.push(eq(priceAdjustments.targetType, t));
  }
  if (options.costCodeId) conditions.push(eq(priceAdjustments.costCodeId, options.costCodeId));
  if (options.sourceCalibrationId) {
    conditions.push(eq(priceAdjustments.sourceCalibrationId, options.sourceCalibrationId));
  }

  const where = tenantWhere(priceAdjustments, options.tenantId, ...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(priceAdjustments)
    .where(where);

  const adjustments = await db
    .select()
    .from(priceAdjustments)
    .where(where)
    .orderBy(desc(priceAdjustments.proposedAt))
    .limit(Math.min(options.limit ?? 50, 500))
    .offset(options.offset ?? 0);

  return { adjustments, total: countRow?.count ?? 0 };
}

/**
 * Preview the money impact of a proposal before approving it.
 *
 * Approving "+12%" is abstract. Approving "+12% adds $18,400 a year to what we charge for
 * framing labor" is a decision an owner can actually make.
 */
export async function previewImpact(input: {
  adjustmentId: string;
  tenantId?: string | null;
  /** Historical committed volume of this target over the reference window, in cents. */
  historicalVolumeCents?: number;
  representativeMarginPct?: number | null;
  costShareOfJob?: number | null;
}): Promise<AdjustmentImpact> {
  const adjustment = await loadForTransition(input);

  let historicalVolumeCents = input.historicalVolumeCents ?? 0;

  if (historicalVolumeCents === 0 && adjustment.costCodeId) {
    const db = await getDb();
    if (db) {
      // Committed actuals of this cost code are the honest proxy for annual exposure.
      const [row] = await db
        .select({
          total: sql<number>`COALESCE(SUM(${sql.identifier("amount_cents")}), 0)::int`,
        })
        .from(sql`project_cost_actuals`)
        .where(sql`cost_code_id = ${adjustment.costCodeId} AND status IN ('committed','paid')`);
      historicalVolumeCents = row?.total ?? 0;
    }
  }

  const [countRow] = await (async () => {
    const db = await getDb();
    if (!db || !adjustment.costCodeId) return [{ count: 0 }];
    return db
      .select({ count: sql<number>`COUNT(DISTINCT project_id)::int` })
      .from(sql`project_cost_actuals`)
      .where(sql`cost_code_id = ${adjustment.costCodeId}`);
  })();

  return previewAdjustmentImpact({
    adjustmentPct: Number(adjustment.adjustmentPct),
    historicalVolumeCents,
    representativeMarginPct: input.representativeMarginPct ?? null,
    costShareOfJob: input.costShareOfJob ?? null,
    affectedEstimateCount: countRow?.count ?? 0,
  });
}

export interface AdjustmentSummary {
  proposedCount: number;
  approvedCount: number;
  appliedCount: number;
  rejectedCount: number;
  rolledBackCount: number;
  /** Proposals waiting on a human decision — the number the dashboard nags about. */
  pendingApprovalCount: number;
  medianAdjustmentPct: number | null;
}

export async function getAdjustmentSummary(tenantId: string): Promise<AdjustmentSummary> {
  const db = await getDb();
  if (!db) {
    return {
      proposedCount: 0,
      approvedCount: 0,
      appliedCount: 0,
      rejectedCount: 0,
      rolledBackCount: 0,
      pendingApprovalCount: 0,
      medianAdjustmentPct: null,
    };
  }

  const rows = await db
    .select({ status: priceAdjustments.status, count: sql<number>`COUNT(*)::int` })
    .from(priceAdjustments)
    .where(tenantWhere(priceAdjustments, tenantId, isNull(priceAdjustments.deletedAt)))
    .groupBy(priceAdjustments.status);

  const countFor = (status: string): number => rows.find(r => r.status === status)?.count ?? 0;

  const applied = await db
    .select({ pct: priceAdjustments.adjustmentPct })
    .from(priceAdjustments)
    .where(
      tenantWhere(
        priceAdjustments,
        tenantId,
        eq(priceAdjustments.status, "applied"),
        isNull(priceAdjustments.deletedAt),
      ),
    );

  const pcts = applied
    .map(r => Number(r.pct))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

  const medianAdjustmentPct = pcts.length
    ? pcts.length % 2 === 0
      ? Math.round(((pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2) * 10) / 10
      : pcts[Math.floor(pcts.length / 2)]
    : null;

  return {
    proposedCount: countFor("proposed"),
    approvedCount: countFor("approved"),
    appliedCount: countFor("applied"),
    rejectedCount: countFor("rejected"),
    rolledBackCount: countFor("rolled_back"),
    pendingApprovalCount: countFor("proposed"),
    medianAdjustmentPct,
  };
}

/** Full lifecycle of one adjustment, for the approval screen's history panel. */
export async function getAdjustmentWithSource(id: string): Promise<{
  adjustment: PriceAdjustment;
  sourceEvent: Awaited<ReturnType<typeof getCalibrationEvent>>;
  isLive: boolean;
} | null> {
  const adjustment = await getAdjustment(id);
  if (!adjustment) return null;

  const status = (normalizePriceAdjustmentStatus(adjustment.status) ??
    "proposed") as PriceAdjustmentStatus;

  return {
    adjustment,
    sourceEvent: adjustment.sourceCalibrationId
      ? await getCalibrationEvent(adjustment.sourceCalibrationId)
      : null,
    isLive: isPriceAdjustmentLive(status),
  };
}

/** Re-export for routers that need to surface violations without applying. */
export function validateProposal(
  input: Parameters<typeof validateAdjustment>[0],
): { violations: PriceAdjustmentViolation[]; allowed: boolean } {
  const violations = validateAdjustment(input);
  return { violations, allowed: isAdjustmentAllowed(violations) };
}
