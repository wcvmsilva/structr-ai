/**
 * structr.ai v9 — Estimate DB Helpers
 * Sprint 9: Estimate Draft Real Flow
 *
 * Provides:
 *   - createEstimateDraftFromCalculator(payload, userId) → transactional insert + audit
 *   - getEstimateDraftFull(id) → draft with parsed JSON fields
 *   - listEstimateDraftsPaginated(opts) → paginated list with filters
 *   - updateEstimateDraftStatus(id, status, userId) → status transition + audit
 *   - deleteEstimateDraft(id, userId) → soft delete (archive) + audit
 *   - getEstimateDraftStats() → summary counts by status/source
 *
 * All writes use audit logging via logAudit().
 * Assembly-based drafts use the Sprint 9 extended schema fields.
 */

import { eq, desc, and, sql, count } from "drizzle-orm";
import { getDb } from "./db";
import { logAudit } from "./audit";
import {
  estimateDrafts,
  type EstimateDraft,
  type EstimateDraftLineItem,
  type EstimateDraftAssemblySelection,
} from "../drizzle/schema";
import type { EstimateDraftPersistPayload } from "@shared/estimate-engine";
import { tenantFilter } from "./tenant-scope";
// PHASE 2 — channel margin floors + approved-version immutability
import {
  evaluateProfitShield,
  type ProfitShieldEvaluation,
} from "@shared/profit-shield-engine";

// ═══════════════════════════════════════════════════════════════════
// PHASE 2 — ERRORS
// ═══════════════════════════════════════════════════════════════════

export type EstimateGuardCode =
  | "ESTIMATE_VERSION_LOCKED"
  | "PROFIT_SHIELD_CHANNEL_FLOOR"
  | "SCOPE_NOT_APPROVED";

/** Raised when a governance gate blocks a write on an estimate draft. */
export class EstimateGuardError extends Error {
  public readonly code: EstimateGuardCode;
  public readonly details: Record<string, unknown>;

  constructor(code: EstimateGuardCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "EstimateGuardError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Guard the immutability of an approved estimate (docs/phase2-contract.md §7.3).
 *
 * An approved estimate is a commercial commitment. Editing it in place would silently
 * change what the client agreed to, so the only legitimate paths forward are a new
 * version or a change order. The DB trigger enforces the same rule; this check exists
 * so the API returns a precise, actionable error instead of a raw SQL exception.
 */
export function assertEstimateMutable(
  draft: Pick<EstimateDraft, "id" | "status" | "version">,
  operation: string,
): void {
  if (draft.status === "approved") {
    throw new EstimateGuardError(
      "ESTIMATE_VERSION_LOCKED",
      `Estimate draft ${draft.id} (v${draft.version}) is approved and immutable — "${operation}" is not allowed. Create a new version (estimate.createVersion) or an approved change order instead.`,
      { estimateDraftId: draft.id, version: draft.version, operation },
    );
  }
}

/**
 * Evaluate the Profit Shield for a stored draft, using its own snapshot as context.
 * Reads the persisted commercial channel and pricing snapshot so the evaluation matches
 * the conditions the estimate was priced under.
 */
export function evaluateDraftProfitShield(draft: EstimateDraft): ProfitShieldEvaluation {
  const snapshot = (draft.pricingSnapshot ?? {}) as {
    commercialChannel?: string | null;
    zone?: string | null;
    geoRiskClass?: string | null;
  };
  const draftData = (draft.draftData ?? {}) as {
    grossProfitPct?: number;
    commercialChannel?: string | null;
    zone?: string | null;
    geoRiskClass?: string | null;
  };

  // Prefer the stored money columns; fall back to the draftData snapshot for drafts
  // created before the Phase 2 columns existed.
  const subtotalCost = Number(draft.subtotalCost ?? 0);
  const finalPrice = Number(draft.finalTotalPrice ?? draft.subtotalPrice ?? 0);
  const computedPct =
    finalPrice > 0 ? ((finalPrice - subtotalCost) / finalPrice) * 100 : Number(draftData.grossProfitPct ?? 0);

  const riskClass = (snapshot.geoRiskClass ?? draftData.geoRiskClass ?? null) as
    | "inland"
    | "coastal"
    | "barrier_island"
    | null;

  return evaluateProfitShield(computedPct, {
    channel: draft.commercialChannel ?? snapshot.commercialChannel ?? draftData.commercialChannel ?? draft.channel,
    zone: snapshot.zone ?? draftData.zone ?? null,
    riskClass,
  });
}

// ══════════════════════════════════════════════════════════════════════
// CREATE — Assembly Calculator Flow
// ══════════════════════════════════════════════════════════════════════

/**
 * Create an estimate draft from the Bundle Calculator output.
 * Uses the Sprint 9 extended schema fields (region, finishLevel, assemblySelections, etc.).
 * Writes audit log on success.
 */
export async function createEstimateDraftFromCalculator(
  payload: EstimateDraftPersistPayload,
  userId: string
): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(estimateDrafts).values({
    // PHASE 1: stamp owning tenant when the caller provides it.
    tenantId: (payload as any).tenantId ?? null,
    bundleId: null, // Assembly-based drafts don't have a legacy bundle
    bundleName: payload.bundleName,
    channel: payload.channel,
    lineItems: payload.lineItems,
    subtotalCost: payload.subtotalCost,
    subtotalPrice: payload.subtotalPrice,
    grossProfit: payload.grossProfit,
    grossProfitPct: payload.grossProfitPct,
    discountApplied: false,
    discountAmount: "0.00",
    finalTotalPrice: payload.finalTotalPrice,
    notes: payload.notes,
    metadata: payload.metadata,
    status: "draft",
    createdBy: userId,
    // Sprint 9 fields
    region: payload.region,
    finishLevel: payload.finishLevel,
    projectId: payload.projectId ?? undefined as unknown as string,
    clientId: payload.clientId,
    assemblySelections: payload.assemblySelections,
    assemblyCount: payload.assemblyCount,
    profitShieldPassed: payload.profitShieldPassed,
    profitShieldMinPct: payload.profitShieldMinPct,
    source: "assembly_calculator",
    // Sprint 18.5: Estimate versioning
    pricingSchemaVersion: "1.0",
    // Sprint 19: Scope-to-estimate idempotency column
    scopeDraftId: (payload as any).scopeDraftId ?? null,
  }).returning({ id: estimateDrafts.id });

  const [draft] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, result.id))
    .limit(1);

  // Audit log (fire-and-forget)
  logAudit({
    userId,
    action: "estimate_draft.create",
    tableName: "estimate_drafts",
    recordId: draft.id,
    before: null,
    after: {
      id: draft.id,
      source: "assembly_calculator",
      pricingSchemaVersion: "1.0",
      region: payload.region,
      channel: payload.channel,
      finishLevel: payload.finishLevel,
      assemblyCount: payload.assemblyCount,
      subtotalCost: payload.subtotalCost,
      finalTotalPrice: payload.finalTotalPrice,
      profitShieldPassed: payload.profitShieldPassed,
    },
  }).catch((err) => console.error("[EstimateDB] Audit log failed:", err));

  return draft;
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/**
 * Get a single estimate draft by ID with all fields.
 */
export async function getEstimateDraftFull(
  id: string
): Promise<EstimateDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [draft] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  return draft ?? null;
}

/**
 * PHASE 1: return the creator of an estimate draft (used by the access guard for
 * calculator-only drafts that are not linked to a project).
 */
export async function getEstimateDraftOwner(id: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select({ createdBy: estimateDrafts.createdBy })
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  return row?.createdBy ?? null;
}

/**
 * List estimate drafts with pagination and filters.
 */
export async function listEstimateDraftsPaginated(opts?: {
  createdBy?: string;
  status?: string;
  source?: "legacy_bundle" | "assembly_calculator" | "scope_draft";
  region?: string;
  limit?: number;
  offset?: number;
  /** PHASE 1: restrict results to a tenant. */
  tenantId?: string | null;
}): Promise<{ items: EstimateDraft[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  // PHASE 1: tenant isolation.
  const tenantCondition = tenantFilter(estimateDrafts, opts?.tenantId);
  if (tenantCondition) {
    conditions.push(tenantCondition);
  }
  if (opts?.createdBy) {
    conditions.push(eq(estimateDrafts.createdBy, opts.createdBy));
  }
  if (opts?.status) {
    conditions.push(
      eq(
        estimateDrafts.status,
        opts.status as "draft" | "sent_to_estimate" | "converted" | "archived"
      )
    );
  }
  if (opts?.source) {
    conditions.push(eq(estimateDrafts.source, opts.source));
  }
  if (opts?.region) {
    conditions.push(eq(estimateDrafts.region, opts.region));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count
  const countQuery = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(estimateDrafts);
  if (whereClause) {
    countQuery.where(whereClause);
  }
  const [countResult] = await countQuery;
  const total = countResult?.count ?? 0;

  // Paginated results
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(estimateDrafts)
    .orderBy(desc(estimateDrafts.updatedAt))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;

  return { items, total };
}

// ══════════════════════════════════════════════════════════════════════
// UPDATE
// ══════════════════════════════════════════════════════════════════════

/** Valid status transitions */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent_to_estimate", "archived", "approved", "rejected"],
  sent_to_estimate: ["converted", "archived", "draft", "approved", "rejected"],
  converted: ["archived"],
  archived: ["draft"], // allow re-opening
  approved: ["converted", "archived"],
  rejected: ["draft", "archived"], // allow re-opening rejected estimates
};

/**
 * Update the status of an estimate draft.
 * Validates the transition and writes audit log.
 */
export async function updateEstimateDraftStatus(
  id: string,
  newStatus: "draft" | "sent_to_estimate" | "converted" | "archived" | "approved" | "rejected",
  userId: string
): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get current draft
  const [current] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  if (!current) throw new Error(`Estimate draft ${id} not found`);

  // Validate transition
  const allowed = STATUS_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${current.status} → ${newStatus}. Allowed: ${allowed.join(", ")}`
    );
  }

  await db
    .update(estimateDrafts)
    .set({ status: newStatus })
    .where(eq(estimateDrafts.id, id));

  const [updated] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  // Audit log
  logAudit({
    userId,
    action: "estimate_draft.status_change",
    tableName: "estimate_drafts",
    recordId: id,
    before: { status: current.status },
    after: { status: newStatus },
  }).catch((err) => console.error("[EstimateDB] Audit log failed:", err));

  return updated;
}

/**
 * Update estimate draft notes.
 */
export async function updateEstimateDraftNotes(
  id: string,
  notes: string | null,
  userId: string
): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [current] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  if (!current) throw new Error(`Estimate draft ${id} not found`);

  await db
    .update(estimateDrafts)
    .set({ notes })
    .where(eq(estimateDrafts.id, id));

  const [updated] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  // Audit log
  logAudit({
    userId,
    action: "estimate_draft.update_notes",
    tableName: "estimate_drafts",
    recordId: id,
    before: { notes: current.notes },
    after: { notes },
  }).catch((err) => console.error("[EstimateDB] Audit log failed:", err));

  return updated;
}

/**
 * Apply a discount to an estimate draft.
 * Recalculates finalTotalPrice from subtotalPrice - discountAmount.
 */
export async function applyEstimateDraftDiscount(
  id: string,
  discountPct: number,
  userId: string
): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [current] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  if (!current) throw new Error(`Estimate draft ${id} not found`);

  // PHASE 2 — a discount changes the money on the estimate, so it is exactly the kind of
  // edit that must not touch an approved version.
  assertEstimateMutable(current, "applyDiscount");

  const subtotalPrice = parseFloat(current.subtotalPrice ?? "0");
  const discountAmount = Math.round(subtotalPrice * (discountPct / 100) * 100) / 100;
  const finalTotalPrice = Math.round((subtotalPrice - discountAmount) * 100) / 100;

  await db
    .update(estimateDrafts)
    .set({
      discountApplied: true,
      discountAmount: discountAmount.toFixed(2),
      finalTotalPrice: finalTotalPrice.toFixed(2),
    })
    .where(eq(estimateDrafts.id, id));

  const [updated] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  // Audit log
  logAudit({
    userId,
    action: "estimate_draft.apply_discount",
    tableName: "estimate_drafts",
    recordId: id,
    before: {
      discountApplied: current.discountApplied,
      discountAmount: current.discountAmount,
      finalTotalPrice: current.finalTotalPrice,
    },
    after: {
      discountApplied: discountPct.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      finalTotalPrice: finalTotalPrice.toFixed(2),
    },
  }).catch((err) => console.error("[EstimateDB] Audit log failed:", err));

  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// Sprint 20: QUICK ACTIONS (approve, reject)
// ══════════════════════════════════════════════════════════════════════

/**
 * Approve an estimate draft. Sets status to "approved" and records approver.
 * Valid from: draft, sent_to_estimate
 */
export async function approveEstimateDraft(
  id: string,
  userId: string
): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [current] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  if (!current) throw new Error(`Estimate draft ${id} not found`);

  const allowed = STATUS_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes("approved")) {
    throw new Error(
      `Invalid status transition: ${current.status} → approved. Allowed: ${allowed.join(", ")}`
    );
  }

  // PHASE 2 — the Profit Shield is a hard gate at approval. A draft may sit below the
  // floor while the operator reworks it, but it may never be approved below the floor.
  const shield = evaluateDraftProfitShield(current);
  if (shield.blocked) {
    throw new EstimateGuardError(
      "PROFIT_SHIELD_CHANNEL_FLOOR",
      `Approval blocked by Profit Shield: ${shield.violations.map((v) => v.message).join(" ")} Remediation: ${shield.remediation.join(" | ")}`,
      {
        estimateDraftId: id,
        channel: shield.channel,
        effectiveFloorPct: shield.effectiveFloorPct,
        actualPct: shield.actualPct,
        violations: shield.violations,
      },
    );
  }

  const now = new Date();
  await db
    .update(estimateDrafts)
    .set({
      status: "approved",
      approvedBy: userId,
      approvedAt: now,
      // PHASE 2 — lock the version and freeze the shield evaluation as approval evidence.
      lockedAt: now,
      profitShieldFloorPct: String(shield.effectiveFloorPct),
      profitShieldEvaluation: shield as unknown as Record<string, unknown>,
    })
    .where(eq(estimateDrafts.id, id));

  const [updated] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  logAudit({
    userId,
    action: "estimate_approved",
    tableName: "estimate_drafts",
    recordId: id,
    before: { status: current.status },
    after: {
      status: "approved",
      approvedBy: userId,
      bundleName: current.bundleName,
      finalTotalPrice: current.finalTotalPrice,
      pricingSchemaVersion: current.pricingSchemaVersion,
      // PHASE 2 — approval evidence
      version: current.version,
      lockedAt: now.toISOString(),
      commercialChannel: shield.channel,
      profitShieldFloorPct: shield.effectiveFloorPct,
      profitShieldActualPct: shield.actualPct,
      geoRiskClass: shield.riskClass,
    },
  }).catch((err) => console.error("[EstimateDB] Audit log failed:", err));

  // PHASE 3 — an approved change order becomes field work immediately (docs/phase3-contract.md §7).
  //
  // Called after approval rather than inside the same transaction on purpose: materialization
  // is idempotent by (project_id, source_key), so a failure here is recoverable by replaying
  // fieldOperations.materializeChangeOrder, while a failure inside the transaction would roll
  // back an approval the client already signed.
  if (current.changeOrderOf) {
    try {
      const { materializeChangeOrderTasks } = await import("./field-operations-db");
      await materializeChangeOrderTasks({ changeOrderId: id, userId });
    } catch (err) {
      // Never fail the approval because the work list could not be generated: the money is
      // approved, the tasks can be regenerated. The operator is told through the audit log.
      console.error("[EstimateDB] Change order materialization failed:", err);
      logAudit({
        userId,
        action: "estimate.change_order_materialization_failed",
        tableName: "estimate_drafts",
        recordId: id,
        before: null,
        after: {
          projectId: current.projectId,
          error: err instanceof Error ? err.message : String(err),
          remediation:
            "Replay fieldOperations.materializeChangeOrder for this change order; the operation is idempotent.",
        },
      }).catch(() => undefined);
    }
  }

  return updated;
}

/**
 * Reject an estimate draft with a reason. Sets status to "rejected".
 * Valid from: draft, sent_to_estimate
 */
export async function rejectEstimateDraft(
  id: string,
  userId: string,
  reason: string
): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [current] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  if (!current) throw new Error(`Estimate draft ${id} not found`);

  const allowed = STATUS_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes("rejected")) {
    throw new Error(
      `Invalid status transition: ${current.status} → rejected. Allowed: ${allowed.join(", ")}`
    );
  }

  await db
    .update(estimateDrafts)
    .set({
      status: "rejected",
      rejectedBy: userId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    })
    .where(eq(estimateDrafts.id, id));

  const [updated] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  logAudit({
    userId,
    action: "estimate_rejected",
    tableName: "estimate_drafts",
    recordId: id,
    before: { status: current.status },
    after: {
      status: "rejected",
      rejectedBy: userId,
      reason,
      bundleName: current.bundleName,
      finalTotalPrice: current.finalTotalPrice,
      pricingSchemaVersion: current.pricingSchemaVersion,
    },
  }).catch((err) => console.error("[EstimateDB] Audit log failed:", err));

  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// DELETE (soft — archive)
// ══════════════════════════════════════════════════════════════════════

/**
 * Soft-delete an estimate draft by setting status to "archived".
 */
export async function archiveEstimateDraft(
  id: string,
  userId: string
): Promise<EstimateDraft> {
  return updateEstimateDraftStatus(id, "archived", userId);
}

// ══════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════

export interface EstimateDraftStats {
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byRegion: Record<string, number>;
  avgGrossProfitPct: number;
  totalValue: number;
}

/**
 * Get summary statistics for estimate drafts.
 */
export async function getEstimateDraftStats(
  tenantId?: string | null,
): Promise<EstimateDraftStats> {
  const db = await getDb();
  if (!db)
    return {
      total: 0,
      byStatus: {},
      bySource: {},
      byRegion: {},
      avgGrossProfitPct: 0,
      totalValue: 0,
    };

  const scope = tenantFilter(estimateDrafts, tenantId);

  // Total count
  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(estimateDrafts)
    .where(scope);
  const total = totalResult?.count ?? 0;

  // By status
  const statusRows = await db
    .select({
      status: estimateDrafts.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(estimateDrafts)
    .where(scope)
    .groupBy(estimateDrafts.status);
  const byStatus: Record<string, number> = {};
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
  }

  // By source
  const sourceRows = await db
    .select({
      source: estimateDrafts.source,
      count: sql<number>`COUNT(*)`,
    })
    .from(estimateDrafts)
    .where(scope)
    .groupBy(estimateDrafts.source);
  const bySource: Record<string, number> = {};
  for (const row of sourceRows) {
    bySource[row.source ?? "unknown"] = row.count;
  }

  // By region
  const regionRows = await db
    .select({
      region: estimateDrafts.region,
      count: sql<number>`COUNT(*)`,
    })
    .from(estimateDrafts)
    .where(scope)
    .groupBy(estimateDrafts.region);
  const byRegion: Record<string, number> = {};
  for (const row of regionRows) {
    byRegion[row.region ?? "unset"] = row.count;
  }

  // Averages
  const [avgResult] = await db
    .select({
      avgGP: sql<number>`COALESCE(AVG(CAST(grossProfitPct AS DECIMAL(10,2))), 0)`,
      totalVal: sql<number>`COALESCE(SUM(CAST(finalTotalPrice AS DECIMAL(14,2))), 0)`,
    })
    .from(estimateDrafts)
    .where(
      scope
        ? and(scope, eq(estimateDrafts.status, "draft"))
        : eq(estimateDrafts.status, "draft"),
    );

  return {
    total,
    byStatus,
    bySource,
    byRegion,
    avgGrossProfitPct: Math.round((avgResult?.avgGP ?? 0) * 100) / 100,
    totalValue: Math.round((avgResult?.totalVal ?? 0) * 100) / 100,
  };
}
