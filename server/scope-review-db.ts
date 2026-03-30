/**
 * structr.ai — Scope Review DB Helpers
 * Sprint 14: Scope Review Workspace
 *
 * DB helpers for scope_review_deltas and scope_review_snapshots.
 * All mutations log to centralized audit trail.
 * State machine enforcement is NOT here — it lives in the router layer.
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  scopeReviewDeltas,
  scopeReviewSnapshots,
  scopeDrafts,
  scopeDraftItems,
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
  userId?: string
): Promise<ScopeDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [before] = await db
    .select()
    .from(scopeDrafts)
    .where(eq(scopeDrafts.id, id))
    .limit(1);
  if (!before) return null;

  await db
    .update(scopeDrafts)
    .set({ status: newStatus, updatedBy: userId ?? null })
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
    after: { status: newStatus },
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
    if (!latestDeltaByAssembly.has(delta.assemblyId)) {
      latestDeltaByAssembly.set(delta.assemblyId, delta);
    }
  }

  // Apply deltas
  const effectiveItems: ScopeDraftItem[] = [];
  for (const item of items) {
    const delta = latestDeltaByAssembly.get(item.assemblyId);

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
  userId?: string
): Promise<ScopeReviewSnapshot | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(scopeReviewSnapshots).values(data).returning({ id: scopeReviewSnapshots.id });

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
    assemblyName: assemblyNameLookup.get(item.assemblyId) ?? `Assembly #${item.assemblyId}`,
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
