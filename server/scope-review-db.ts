/**
 * structr.ai — Scope Review DB Helpers
 * Sprint 14: Scope Review Workspace
 *
 * DB helpers for scope_review_deltas and scope_review_snapshots.
 * All mutations log to centralized audit trail.
 * Conversion rechecks the state transition inside its persistence transaction.
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  scopeReviewDeltas,
  scopeReviewSnapshots,
  scopeDrafts,
  scopeDraftItems,
  assemblies, bundles, bundleItems, profiles, projects,
  type ScopeReviewDelta,
  type InsertScopeReviewDelta,
  type ScopeReviewSnapshot,
  type InsertScopeReviewSnapshot,
  type ScopeDraft,
  type ScopeDraftItem,
  type SnapshotItem,
  type SnapshotDelta,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import { assertSameTenant } from "./tenant-scope";
import { safeParseFloat } from "../shared/utils/math";
import { validateTransition, type ScopeDraftStatus } from "../shared/scope-review-state-machine";

// ══════════════════════════════════════════════════════════════════════
// SCOPE REVIEW DELTAS — CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Apply a delta (remove or quantity adjustment) to a scope draft.
 * Does NOT mutate the original scope_draft_items.
 */
export async function createScopeReviewDelta(
  data: Omit<InsertScopeReviewDelta, "id" | "createdAt">,
  userId?: string
): Promise<ScopeReviewDelta | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(scopeReviewDeltas).values({
    ...data,
    createdBy: userId ?? data.createdBy ?? null,
  }).returning({ id: scopeReviewDeltas.id });

  const [delta] = await db
    .select()
    .from(scopeReviewDeltas)
    .where(eq(scopeReviewDeltas.id, result.id))
    .limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "scope_delta_applied",
    tableName: "scope_review_deltas",
    recordId: delta.id,
    after: delta,
  });

  return delta;
}

/**
 * Get all deltas for a scope draft.
 */
export async function getDeltasForDraft(
  scopeDraftId: string
): Promise<ScopeReviewDelta[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(scopeReviewDeltas)
    .where(eq(scopeReviewDeltas.scopeDraftId, scopeDraftId))
    .orderBy(desc(scopeReviewDeltas.createdAt));
}

/**
 * Get deltas for a specific assembly within a draft.
 */
export async function getDeltasForAssembly(
  scopeDraftId: string,
  assemblyId: string
): Promise<ScopeReviewDelta[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(scopeReviewDeltas)
    .where(
      and(
        eq(scopeReviewDeltas.scopeDraftId, scopeDraftId),
        eq(scopeReviewDeltas.assemblyId, assemblyId)
      )
    )
    .orderBy(desc(scopeReviewDeltas.createdAt));
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE DRAFT STATUS — Transition helpers
// ══════════════════════════════════════════════════════════════════════

/**
 * Transition a scope draft to a new status.
 * State machine validation is the caller's responsibility.
 */
export async function transitionDraftStatus(
  id: string,
  newStatus: "draft" | "under_review" | "approved" | "rejected" | "converted",
  userId?: string,
  /** PHASE 2 — mandatory context for a rejection. */
  reason?: string | null,
): Promise<ScopeDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [before] = await db
    .select()
    .from(scopeDrafts)
    .where(eq(scopeDrafts.id, id))
    .limit(1);
  if (!before) return null;

  // PHASE 2 — record WHO decided and WHEN. Without this, an approved scope has no
  // accountable owner, and the estimate downstream inherits an unattributed approval.
  const now = new Date();
  const updatePayload: Record<string, unknown> = { status: newStatus, updatedAt: now };

  if (newStatus === "approved") {
    updatePayload.approvedBy = userId ?? null;
    updatePayload.approvedAt = now;
  } else if (newStatus === "rejected") {
    updatePayload.rejectedBy = userId ?? null;
    updatePayload.rejectedAt = now;
    updatePayload.rejectionReason = reason ?? null;
  }

  await db
    .update(scopeDrafts)
    .set(updatePayload)
    .where(eq(scopeDrafts.id, id));

  const [after] = await db
    .select()
    .from(scopeDrafts)
    .where(eq(scopeDrafts.id, id))
    .limit(1);

  // Map status to audit action
  const auditActionMap: Record<string, string> = {
    under_review: "scope_review_started",
    approved: "scope_draft_approved",
    rejected: "scope_draft_rejected",
    converted: "scope_converted_to_bundle",
  };

  const auditAction = auditActionMap[newStatus] ?? "scope_draft.status_change";

  await logAudit({
    userId: userId ?? null,
    action: auditAction,
    tableName: "scope_drafts",
    recordId: id,
    before: { status: before.status },
    after: {
      status: newStatus,
      // PHASE 2 — approval accountability in the audit trail
      approvedBy: newStatus === "approved" ? (userId ?? null) : undefined,
      rejectedBy: newStatus === "rejected" ? (userId ?? null) : undefined,
      rejectionReason: newStatus === "rejected" ? (reason ?? null) : undefined,
      decidedAt: now.toISOString(),
    },
  });

  return after;
}

// ══════════════════════════════════════════════════════════════════════
// EFFECTIVE ITEMS — Apply deltas to original items
// ══════════════════════════════════════════════════════════════════════

/**
 * Compute the effective item list by applying all deltas to the original items.
 * Returns items with adjusted quantities and removed items filtered out.
 */
export async function getEffectiveItems(
  scopeDraftId: string
): Promise<ScopeDraftItem[]> {
  const db = await getDb();
  if (!db) return [];

  // Get original items
  const items = await db
    .select()
    .from(scopeDraftItems)
    .where(eq(scopeDraftItems.scopeDraftId, scopeDraftId))
    .orderBy(scopeDraftItems.sortOrder);

  // Get all deltas
  const deltas = await getDeltasForDraft(scopeDraftId);

  if (deltas.length === 0) return items;

  // Build a map of the latest delta per assembly
  // Deltas are ordered by createdAt desc, so first one is latest
  const latestDeltaByAssembly = new Map<string, ScopeReviewDelta>();
  for (const delta of deltas) {
    if (!latestDeltaByAssembly.has(delta.assemblyId ?? "")) {
      latestDeltaByAssembly.set(delta.assemblyId ?? "", delta);
    }
  }

  // Apply deltas
  const effectiveItems: ScopeDraftItem[] = [];
  for (const item of items) {
    const delta = latestDeltaByAssembly.get(item.assemblyId ?? "");

    if (!delta) {
      effectiveItems.push(item);
      continue;
    }

    if (delta.actionType === "remove") {
      // Skip removed items
      continue;
    }

    if (delta.actionType === "quantity_adjustment" && delta.newQuantity !== null) {
      // Apply quantity adjustment
      effectiveItems.push({
        ...item,
        quantity: delta.newQuantity,
      });
    } else {
      effectiveItems.push(item);
    }
  }

  return effectiveItems;
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE REVIEW SNAPSHOTS — Persistence
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a review snapshot at conversion time.
 * Captures the approved items, delta changes, and operator info.
 */
export async function createReviewSnapshot(
  data: Omit<InsertScopeReviewSnapshot, "id" | "createdAt">,
  userId?: string,
  /** PHASE 2 — the decision this snapshot records ("approved" | "rejected" | "converted"). */
  decision?: string | null,
): Promise<ScopeReviewSnapshot | null> {
  const db = await getDb();
  if (!db) return null;

  // PHASE 2 — the snapshot is the evidence of what was approved, so it must name the
  // approver and count the deltas it accepted. Values already present in `data` win.
  const deltaCount = Array.isArray(data.deltaChanges)
    ? (data.deltaChanges as SnapshotDelta[]).length
    : 0;

  const payload: Omit<InsertScopeReviewSnapshot, "id" | "createdAt"> = {
    ...data,
    approvedBy: data.approvedBy ?? userId ?? null,
    approvedAt: data.approvedAt ?? new Date(),
    decision: data.decision ?? decision ?? "approved",
    deltaCount: data.deltaCount ?? deltaCount,
  };

  const [result] = await db.insert(scopeReviewSnapshots).values(payload).returning({ id: scopeReviewSnapshots.id });

  const [snapshot] = await db
    .select()
    .from(scopeReviewSnapshots)
    .where(eq(scopeReviewSnapshots.id, result.id))
    .limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "scope_review_snapshot.create",
    tableName: "scope_review_snapshots",
    recordId: snapshot.id,
    after: {
      scopeDraftId: snapshot.scopeDraftId,
      itemCount: (snapshot.approvedItems as SnapshotItem[]).length,
      deltaCount: (snapshot.deltaChanges as SnapshotDelta[]).length,
      bundleId: snapshot.bundleId,
      // PHASE 2 — approval accountability
      approvedBy: snapshot.approvedBy,
      approvedAt: snapshot.approvedAt,
      decision: snapshot.decision,
    },
  });

  return snapshot;
}

/**
 * Get the review snapshot for a scope draft.
 */
export async function getSnapshotForDraft(
  scopeDraftId: string
): Promise<ScopeReviewSnapshot | null> {
  const db = await getDb();
  if (!db) return null;

  const [snapshot] = await db
    .select()
    .from(scopeReviewSnapshots)
    .where(eq(scopeReviewSnapshots.scopeDraftId, scopeDraftId))
    .limit(1);

  return snapshot ?? null;
}

/**
 * Update snapshot with bundle ID after successful conversion.
 */
export async function updateSnapshotBundleId(
  snapshotId: string,
  bundleId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(scopeReviewSnapshots)
    .set({ bundleId })
    .where(eq(scopeReviewSnapshots.id, snapshotId));

  return true;
}

// ══════════════════════════════════════════════════════════════════════
// SNAPSHOT BUILDER — Assemble snapshot data from draft + deltas
// ══════════════════════════════════════════════════════════════════════

/**
 * Build snapshot data from a scope draft and its deltas.
 * Used before persisting the snapshot.
 */
export async function buildSnapshotData(
  scopeDraftId: string,
  assemblyNameLookup: Map<string, string>
): Promise<{
  approvedItems: SnapshotItem[];
  deltaChanges: SnapshotDelta[];
  warnings: string[];
  confidenceScore: string | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  // Get the draft
  const [draft] = await db
    .select()
    .from(scopeDrafts)
    .where(eq(scopeDrafts.id, scopeDraftId))
    .limit(1);
  if (!draft) return null;

  // Get effective items (with deltas applied)
  const effectiveItems = await getEffectiveItems(scopeDraftId);

  // Get all deltas
  const deltas = await getDeltasForDraft(scopeDraftId);

  // Build snapshot items
  const approvedItems: SnapshotItem[] = effectiveItems.map((item) => ({
    assemblyId: item.assemblyId,
    assemblyName: assemblyNameLookup.get(item.assemblyId ?? "") ?? `Assembly #${item.assemblyId}`,
    quantity: Number(item.quantity),
    unit: item.unit,
    reason: item.reason,
    confidence: Number(item.confidence),
  }));

  // Build delta changes
  const deltaChanges: SnapshotDelta[] = deltas.map((d) => ({
    assemblyId: d.assemblyId,
    actionType: d.actionType,
    previousQuantity: Number(d.previousQuantity),
    newQuantity: d.newQuantity !== null ? Number(d.newQuantity) : null,
    operatorReason: d.operatorReason,
  }));

  return {
    approvedItems,
    deltaChanges,
    warnings: (draft.warningsJson as string[]) ?? [],
    confidenceScore: draft.confidence,
  };
}


export class ScopeReviewConversionError extends Error {
  constructor(public readonly code: "BAD_REQUEST" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INTERNAL_SERVER_ERROR", message: string) {
    super(message);
    this.name = "ScopeReviewConversionError";
  }
}

/** Persist the reviewed selection, its bundle and audit as one atomic conversion. */
export async function convertApprovedScopeToBundle(scopeDraftId: string, tenantId: string, userId: string) {
  if (!tenantId || !userId) throw new ScopeReviewConversionError("FORBIDDEN", "A resolved tenant and operator are required");
  const db = await getDb();
  if (!db) throw new ScopeReviewConversionError("INTERNAL_SERVER_ERROR", "Database not available");
  return db.transaction(async tx => {
    // Serialize conversion attempts on this scope before reading its decision/items.
    const [draft] = await tx.select().from(scopeDrafts).where(eq(scopeDrafts.id, scopeDraftId)).limit(1).for("update");
    if (!draft) throw new ScopeReviewConversionError("NOT_FOUND", "Scope draft not found");
    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, userId)).limit(1).for("share");
    const [project] = await tx.select().from(projects).where(eq(projects.id, draft.projectId)).limit(1).for("share");
    if (!profile?.tenantId || profile.tenantId !== tenantId || profile.isActive === false || profile.role !== "admin" ||
        !project || project.deletedAt || !assertSameTenant(project.tenantId, tenantId) || !assertSameTenant(draft.tenantId, tenantId)) {
      throw new ScopeReviewConversionError("FORBIDDEN", "Scope conversion is not authorized for this tenant");
    }
    const transition = validateTransition(draft.status as ScopeDraftStatus, "converted");
    if (!transition.valid) throw new ScopeReviewConversionError("BAD_REQUEST", transition.error ?? "Only approved scope drafts can be converted");
    if (!draft.approvedBy || !draft.approvedAt) throw new ScopeReviewConversionError("BAD_REQUEST", "Scope approval evidence is incomplete");
    const [existing] = await tx.select().from(scopeReviewSnapshots).where(eq(scopeReviewSnapshots.scopeDraftId, scopeDraftId)).limit(1);
    if (existing) throw new ScopeReviewConversionError("CONFLICT", "A review snapshot already exists; reconcile it before conversion");

    const items = await tx.select().from(scopeDraftItems).where(eq(scopeDraftItems.scopeDraftId, scopeDraftId)).orderBy(scopeDraftItems.sortOrder, scopeDraftItems.id);
    const deltas = await tx.select().from(scopeReviewDeltas).where(eq(scopeReviewDeltas.scopeDraftId, scopeDraftId)).orderBy(desc(scopeReviewDeltas.createdAt), desc(scopeReviewDeltas.id));
    const latest = new Map<string, ScopeReviewDelta>();
    for (const delta of deltas) if (delta.assemblyId && !latest.has(delta.assemblyId)) latest.set(delta.assemblyId, delta);
    const approvedItems: Array<{ assemblyId: string; assemblyName: string; quantity: number; unit: string | null; reason: string | null; confidence: number }> = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.assemblyId) throw new ScopeReviewConversionError("BAD_REQUEST", "Approved item has no assembly identity");
      const delta = latest.get(item.assemblyId);
      if (delta?.actionType === "remove") continue;
      if (seen.has(item.assemblyId)) throw new ScopeReviewConversionError("BAD_REQUEST", "Approved items contain a duplicate assembly; review quantities explicitly");
      seen.add(item.assemblyId);
      const rawQuantity = delta?.actionType === "quantity_adjustment" ? delta.newQuantity : item.quantity;
      if (typeof rawQuantity !== "string" || !/^\d+(?:\.\d+)?$/.test(rawQuantity)) throw new ScopeReviewConversionError("BAD_REQUEST", "Approved item quantity must be a positive finite decimal");
      const quantity = safeParseFloat(rawQuantity, "approved scope quantity");
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) throw new ScopeReviewConversionError("BAD_REQUEST", "Approved item quantity must be a positive finite decimal");
      const [assembly] = await tx.select().from(assemblies).where(eq(assemblies.id, item.assemblyId)).limit(1).for("share");
      if (!assembly || !assembly.isActive || !assertSameTenant(assembly.tenantId, tenantId)) throw new ScopeReviewConversionError("BAD_REQUEST", "An approved assembly is missing, inactive or unavailable to this tenant");
      approvedItems.push({ assemblyId: assembly.id, assemblyName: assembly.name, quantity, unit: item.unit, reason: item.reason, confidence: Number(item.confidence) });
    }
    if (!approvedItems.length) throw new ScopeReviewConversionError("BAD_REQUEST", "Approved scope has no effective assemblies to convert");
    const deltaChanges = deltas.map(delta => ({ assemblyId: delta.assemblyId, actionType: delta.actionType, previousQuantity: Number(delta.previousQuantity), newQuantity: delta.newQuantity !== null ? Number(delta.newQuantity) : null, operatorReason: delta.operatorReason }));
    const profitShieldWarnings: string[] = [];
    const lowConfidence = approvedItems.filter(item => item.confidence < 0.5);
    if (lowConfidence.length) profitShieldWarnings.push(`PROFIT_SHIELD: ${lowConfidence.length} item(s) have confidence below 50%: ` + lowConfidence.map(item => `${item.assemblyName} (${(item.confidence * 100).toFixed(0)}%)`).join(", "));
    const confidence = draft.confidence !== null ? Number(draft.confidence) : null;
    if (confidence !== null && confidence < 0.6) profitShieldWarnings.push(`PROFIT_SHIELD: Overall scope confidence ${(confidence * 100).toFixed(0)}% is below 60% threshold. Review pricing carefully.`);
    const warnings = [...(Array.isArray(draft.warningsJson) ? draft.warningsJson.filter((warning): warning is string => typeof warning === "string") : []), ...profitShieldWarnings];

    const [bundle] = await tx.insert(bundles).values({
      tenantId, name: `Scope ${draft.id}`, description: `Reviewed scope for project ${draft.projectId}`,
      category: draft.serviceType ?? "general", bundleDiscount: "0", region: project.region ?? "unspecified",
      notes: "Created from an approved scope snapshot. Quantities are preserved; prices and commercial approval are evaluated separately.",
    }).returning();
    if (!bundle) throw new Error("Bundle insert returned no row");
    await tx.insert(bundleItems).values(approvedItems.map((item, index) => ({ bundleId: bundle.id, assemblyId: item.assemblyId, quantity: String(item.quantity), isOptional: false, sortOrder: index }))).returning();
    const [snapshot] = await tx.insert(scopeReviewSnapshots).values({
      scopeDraftId: draft.id, approvedItems, deltaChanges, bundleId: bundle.id,
      snapshotData: { warnings: warnings.length ? warnings : null, operatorId: userId, projectId: draft.projectId },
      approvedBy: draft.approvedBy, approvedAt: draft.approvedAt, decision: "converted", deltaCount: deltaChanges.length,
    }).returning();
    if (!snapshot) throw new Error("Snapshot insert returned no row");
    const [updated] = await tx.update(scopeDrafts).set({ status: "converted", updatedAt: new Date() }).where(and(eq(scopeDrafts.id, draft.id), eq(scopeDrafts.status, "approved"))).returning();
    if (!updated) throw new ScopeReviewConversionError("CONFLICT", "Scope approval changed before conversion");
    await logAudit({ userId, action: "scope_converted_to_bundle", tableName: "scope_drafts", recordId: draft.id,
      before: { status: draft.status }, after: { status: "converted", bundleId: bundle.id, snapshotId: snapshot.id, projectId: draft.projectId, approvedBy: draft.approvedBy, approvedAt: draft.approvedAt, approvedItemCount: approvedItems.length, deltaCount: deltaChanges.length },
    }, tx);
    return { id: updated.id, status: "converted" as const, bundleId: bundle.id, snapshotId: snapshot.id, approvedItemCount: approvedItems.length, deltaCount: deltaChanges.length, warnings, profitShieldWarnings, profitShieldPassed: profitShieldWarnings.length === 0,
      message: profitShieldWarnings.length ? `Scope draft converted with ${profitShieldWarnings.length} Profit Shield warning(s). Review before estimate generation.` : "Scope draft converted. Bundle and review snapshot persisted.", validNextStates: [], };
  });
}
