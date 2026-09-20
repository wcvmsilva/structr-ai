/**
 * structr.ai v9 — Estimate DB Helpers
 * Sprint 9: Estimate Draft Real Flow
 *
 * Provides:
 *   - createEstimateDraftFromCalculator(payload, userId, tenantId) → transactional insert + audit
 *   - getEstimateDraftFull(id) → draft with parsed JSON fields
 *   - listEstimateDraftsPaginated(opts) → paginated list with filters
 *   - updateEstimateDraftStatus(id, status, userId, tenantId) → status transition + audit
 *   - deleteEstimateDraft(id, userId) → soft delete (archive) + audit
 *   - getEstimateDraftStats() → summary counts by status/source
 *
 * All writes use audit logging via logAudit().
 * Assembly-based drafts use the Sprint 9 extended schema fields.
 */

import { eq, desc, and, sql, count } from "drizzle-orm";
import { getDb } from "./db";
import { assertNotHistoricalEstimateDraft, getHistoricalImportId, isHistoricalEstimateDraft, nonHistoricalEstimateCondition } from "./historical-estimate-guard";
import { logAudit } from "./audit";
import { holdLegacyEstimateOperation } from "@shared/estimate-legacy-hold";
import { requireProjectAccess } from "./project-access";
import {
  estimateDrafts,
  projects,
  profiles,
  tenants,
  clients,
  type EstimateDraft,
  type EstimateDraftLineItem,
  type EstimateDraftAssemblySelection,
} from "../drizzle/schema";
import type { EstimateDraftPersistPayload } from "@shared/estimate-engine";
import { tenantFilter } from "./tenant-scope";
import { getExactEstimateStats } from "./estimate-aggregate-db";
import type { AggregateReadResult, EstimateDraftStatsExactV1 } from "@shared/estimate-aggregate-engine";
// PHASE 2 — channel margin floors + approved-version immutability
import {
  evaluateProfitShield,
  type ProfitShieldEvaluation,
} from "@shared/profit-shield-engine";

// ═══════════════════════════════════════════════════════════════════
// PHASE 2 — ERRORS
// ═══════════════════════════════════════════════════════════════════

import { EstimateGuardError } from "./estimate-guard-error";
export { EstimateGuardError, type EstimateGuardCode } from "./estimate-guard-error";
import { INTERNAL_APPROVAL_STATUSES } from "../shared/domain/taxonomy";
import { calculateEstimateDraftDiscount, normalizeEstimateDiscountPercent } from "../shared/estimate-discount-engine";
import {
  withEstimateMutation, assertEstimateUndecided, assertEstimateNonHistoricalLineage,
  auditEstimateMutation,
} from "./estimate-mutation-db";

/**
 * Recognize locked status labels for callers holding an estimate row.
 * A1 is an internal decision, not client acceptance or execution authority.
 * Generic database mutations also inspect relational decision evidence in their
 * transaction; this pure convenience guard cannot establish that evidence.
 */
export function assertEstimateMutable(
  draft: Pick<EstimateDraft, "id" | "status" | "version">,
  operation: string,
): void {
  if (draft.status === "approved" || INTERNAL_APPROVAL_STATUSES.some(status => draft.status === status)) {
    throw new EstimateGuardError(
      "ESTIMATE_VERSION_LOCKED",
      `Estimate draft ${draft.id} (v${draft.version}) is decided and immutable — "${operation}" is not allowed. Create a new version (estimate.createVersion) for further review.`,
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
  userId: string,
  tenantId: string,
): Promise<EstimateDraft> {
  function unresolved(message: string): never {
    throw new EstimateGuardError("ESTIMATE_CONTEXT_UNRESOLVED", message);
  }
  const validId = (value: unknown): value is string => typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    && value !== "00000000-0000-0000-0000-000000000000";
  if (!validId(userId) || !validId(tenantId)) unresolved("An active account and company are required.");
  // The physical estimate_drafts.project_id is NOT NULL. Do not manufacture a
  // project or silently persist an unlinked estimate through an undefined cast.
  if (!validId(payload.projectId)) unresolved("Select a project before saving the calculated estimate.");
  const projectId = payload.projectId;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [project] = await tx.select().from(projects)
      .where(eq(projects.id, projectId)).limit(1).for("update");
    if (!project || project.id !== projectId || project.deletedAt || project.tenantId !== tenantId) {
      unresolved("Select an active project belonging to your company.");
    }
    const [tenant] = await tx.select().from(tenants)
      .where(eq(tenants.id, tenantId)).limit(1).for("share");
    const [profile] = await tx.select().from(profiles)
      .where(eq(profiles.id, userId)).limit(1).for("share");
    if (!tenant || tenant.id !== tenantId || !tenant.isActive || !profile
      || profile.id !== userId || !profile.isActive || profile.tenantId !== tenantId) {
      unresolved("An active account and company are required.");
    }
    await requireProjectAccess(projectId, userId, "write", {
      mode: "a1", transaction: tx, expectedTenantId: tenantId,
    });

    const clientId = project.clientId;
    if (payload.clientId != null && payload.clientId !== clientId) {
      unresolved("Use the client linked to this project.");
    }
    if (clientId !== null) {
      if (!validId(clientId)) unresolved("Link the project to its active client.");
      const [client] = await tx.select().from(clients)
        .where(eq(clients.id, clientId)).limit(1).for("share");
      if (!client || client.id !== clientId || !client.isActive || client.deletedAt || client.tenantId !== tenantId) {
        unresolved("Link the project to an active client belonging to your company.");
      }
    }
    // A project without a client may retain an incomplete draft. The A1 adapter
    // rejects that missing identity; saving a draft creates no approval authority.
    const [draft] = await tx.insert(estimateDrafts).values({
    tenantId,
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
    projectId,
    clientId,
    assemblySelections: payload.assemblySelections,
    assemblyCount: payload.assemblyCount,
    profitShieldPassed: payload.profitShieldPassed,
    profitShieldMinPct: payload.profitShieldMinPct,
    source: "assembly_calculator",
    // Sprint 18.5: Estimate versioning
    pricingSchemaVersion: "1.0",
    // Sprint 19: Scope-to-estimate idempotency column
    scopeDraftId: null,
  }).returning();
  if (!draft) throw new Error("Calculated estimate insert returned no row");

  const audit = await logAudit({
    userId,
    action: "estimate_draft.create",
    tableName: "estimate_drafts",
    recordId: draft.id,
    before: null,
    after: {
      id: draft.id,
      tenantId,
      projectId,
      clientId,
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
  }, tx);
  if (!audit) throw new Error("Calculated estimate audit returned no row");

  return draft;
  }, { isolationLevel: "serializable" });
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/**
 * Get a single estimate draft by ID with all fields.
 */
export async function getEstimateDraftFull(
  id: string
): Promise<(EstimateDraft & { historicalImportId: string | null }) | null> {
  const db = await getDb();
  if (!db) return null;

  const [draft] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, id))
    .limit(1);

  return draft ? { ...draft, historicalImportId: await getHistoricalImportId(db, draft.id) } : null;
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
export async function listEstimateDraftsPaginated(opts: {
  createdBy?: string;
  status?: string;
  source?: "legacy_bundle" | "assembly_calculator" | "scope_draft";
  region?: string;
  limit?: number;
  offset?: number;
  /** PHASE 1: restrict results to a tenant. */
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
}): Promise<{ items: EstimateDraft[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [nonHistoricalEstimateCondition()];
  // PHASE 1: tenant isolation.
  const tenantCondition = tenantFilter(estimateDrafts, opts.tenantId);
  if (tenantCondition) {
    conditions.push(tenantCondition);
  }
  if (opts.createdBy) {
    conditions.push(eq(estimateDrafts.createdBy, opts.createdBy));
  }
  if (opts.status) {
    conditions.push(
      eq(
        estimateDrafts.status,
        opts.status as "draft" | "sent_to_estimate" | "converted" | "archived"
      )
    );
  }
  if (opts.source) {
    conditions.push(eq(estimateDrafts.source, opts.source));
  }
  if (opts.region) {
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
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

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
  userId: string,
  tenantId: string,
): Promise<EstimateDraft> {
  return changeEstimateDraftStatus(id, newStatus, userId, tenantId, "approve");
}

async function changeEstimateDraftStatus(
  id: string, newStatus: string, userId: string, tenantId: string, permission: "approve" | "delete",
): Promise<EstimateDraft> {
  // A generic status assignment never confers or revokes approval authority.
  if (newStatus === "approved" || INTERNAL_APPROVAL_STATUSES.some(status => status === newStatus)) {
    throw new EstimateGuardError(
      "ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION",
      "Use estimate.approveEstimate to approve an estimate with the required policy checks and approval evidence.",
      { estimateDraftId: id, requestedStatus: newStatus },
    );
  }
  return withEstimateMutation(id, userId, tenantId, permission, async (tx, current) => {
    await assertEstimateUndecided(tx, current);
    if (await isHistoricalEstimateDraft(tx, current)) {
      if (current.status === "draft" && newStatus === "draft") return current;
      if (newStatus !== "archived") await assertNotHistoricalEstimateDraft(tx, current, `set status to ${newStatus}`);
    }
    if (newStatus !== "archived") await assertEstimateNonHistoricalLineage(tx, current);
    const allowed = STATUS_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(newStatus)) throw new Error(`Invalid status transition: ${current.status} → ${newStatus}. Allowed: ${allowed.join(", ")}`);
    const [updated] = await tx.update(estimateDrafts).set({ status: newStatus }).where(eq(estimateDrafts.id, id)).returning();
    if (!updated) throw new Error("Estimate mutation returned no row");
    await auditEstimateMutation(tx, {
      userId, action: "estimate_draft.status_change", tableName: "estimate_drafts", recordId: id,
      before: { status: current.status }, after: { status: newStatus },
    });
    return updated;
  });
}

/** Operational notes do not alter the immutable reviewedNotes in an A1 snapshot. */
export async function updateEstimateDraftNotes(
  id: string, notes: string | null, userId: string, tenantId: string,
): Promise<EstimateDraft> {
  return withEstimateMutation(id, userId, tenantId, "write", async (tx, current) => {
    const [updated] = await tx.update(estimateDrafts).set({ notes }).where(eq(estimateDrafts.id, id)).returning();
    if (!updated) throw new Error("Estimate mutation returned no row");
    await auditEstimateMutation(tx, {
      userId, action: "estimate_draft.update_notes", tableName: "estimate_drafts", recordId: id,
      before: { notes: current.notes }, after: { notes },
    });
    return updated;
  });
}

/** Exact cents; only undecided calculated drafts may change, within the existing transaction. */
export async function applyEstimateDraftDiscount(
  id: string, discountPct: number, userId: string, tenantId: string,
): Promise<EstimateDraft> {
  normalizeEstimateDiscountPercent(discountPct);
  return withEstimateMutation(id, userId, tenantId, "approve", async (tx, current) => {
    await assertEstimateUndecided(tx, current);
    await assertEstimateNonHistoricalLineage(tx, current, { requireCalculatedSources: true });
    if (current.status !== "draft" || current.lockedAt || current.supersededBy) {
      throw new EstimateGuardError("ESTIMATE_VERSION_LOCKED", "Only an unlocked, current calculated draft can receive a discount.");
    }
    assertEstimateMutable(current, "applyDiscount");
    const exact = calculateEstimateDraftDiscount(current.subtotalPrice, discountPct);
    const { discountAmount, finalTotalPrice } = exact;
    const [updated] = await tx.update(estimateDrafts).set({
      discountApplied: true, discountAmount, finalTotalPrice,
    }).where(eq(estimateDrafts.id, id)).returning();
    if (!updated) throw new Error("Estimate mutation returned no row");
    await auditEstimateMutation(tx, {
      userId, action: "estimate_draft.apply_discount", tableName: "estimate_drafts", recordId: id,
      before: { discountApplied: current.discountApplied, discountAmount: current.discountAmount, finalTotalPrice: current.finalTotalPrice },
      after: { discountApplied: true, discountPct: exact.discountPct, discountAmount, finalTotalPrice },
    });
    return updated;
  });
}

// ══════════════════════════════════════════════════════════════════════
// Sprint 20: QUICK ACTIONS (approve, reject)
// ══════════════════════════════════════════════════════════════════════

/** The old id-only approval cannot create an internal or commercial decision. */
export async function approveEstimateDraft(
  id: string,
  userId: string
): Promise<EstimateDraft> {
  return holdLegacyEstimateOperation("approval");
}

/**
 * Reject an estimate draft with a reason. Sets status to "rejected".
 * Valid from: draft, sent_to_estimate
 */
export async function rejectEstimateDraft(
  id: string, userId: string, reason: string, tenantId: string,
): Promise<EstimateDraft> {
  return withEstimateMutation(id, userId, tenantId, "approve", async (tx, current) => {
    await assertEstimateUndecided(tx, current);
    await assertEstimateNonHistoricalLineage(tx, current);
    const allowed = STATUS_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes("rejected")) throw new Error(`Invalid status transition: ${current.status} → rejected. Allowed: ${allowed.join(", ")}`);
    const [updated] = await tx.update(estimateDrafts).set({
      status: "rejected", rejectedBy: userId, rejectedAt: new Date(), rejectionReason: reason,
    }).where(eq(estimateDrafts.id, id)).returning();
    if (!updated) throw new Error("Estimate mutation returned no row");
    await auditEstimateMutation(tx, {
      userId, action: "estimate_rejected", tableName: "estimate_drafts", recordId: id,
      before: { status: current.status },
      after: { status: "rejected", rejectedBy: userId, reason, bundleName: current.bundleName,
        finalTotalPrice: current.finalTotalPrice, pricingSchemaVersion: current.pricingSchemaVersion },
    });
    return updated;
  });
}

// ══════════════════════════════════════════════════════════════════════
// DELETE (soft — archive)
// ══════════════════════════════════════════════════════════════════════

/**
 * Soft-delete an estimate draft by setting status to "archived".
 */
export async function archiveEstimateDraft(
  id: string, userId: string, tenantId: string,
): Promise<EstimateDraft> {
  return changeEstimateDraftStatus(id, "archived", userId, tenantId, "delete");
}

// ══════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════

export type EstimateDraftStats = AggregateReadResult<EstimateDraftStatsExactV1>;

/**
 * Complete exact summary in one read snapshot. This is a deliberate versioned
 * transport replacement; monetary number aliases are no longer returned.
 */
export async function getEstimateDraftStats(
  tenantId: string,
): Promise<EstimateDraftStats> {
  return getExactEstimateStats(tenantId);
}
