/**
 * structr.ai — Draft Recovery DB Helpers (Sprint 20)
 *
 * Manages pipeline_partial_drafts: partial pipeline outputs saved when
 * the Scope → Estimate pipeline fails at any step. Allows retry or abandon.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  pipelinePartialDrafts,
  type PipelinePartialDraft,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// CREATE
// ══════════════════════════════════════════════════════════════════════

export interface CreatePartialDraftInput {
  scopeDraftId: string;
  userId: string;
  failedStep: string;
  errorCode: string;
  errorMessage: string;
  partialPayload?: Record<string, unknown> | null;
  contextSnapshot?: Record<string, unknown> | null;
}

/**
 * Save a partial draft when the pipeline fails.
 * Called from the pipeline's catch block.
 */
export async function createPartialDraft(
  input: CreatePartialDraftInput
): Promise<PipelinePartialDraft | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const [result] = await db.insert(pipelinePartialDrafts).values({
      scopeDraftId: input.scopeDraftId,
      userId: input.userId,
      failedStep: input.failedStep,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      partialPayload: input.partialPayload ?? null,
      contextSnapshot: input.contextSnapshot ?? null,
      retryCount: 0,
      maxRetries: 3,
      status: "pending",
    }).returning({ id: pipelinePartialDrafts.id });

    const [draft] = await db
      .select()
      .from(pipelinePartialDrafts)
      .where(eq(pipelinePartialDrafts.id, result.id))
      .limit(1);

    // Non-blocking audit
    logAudit({
      userId: input.userId,
      action: "partial_draft_created",
      tableName: "pipeline_partial_drafts",
      recordId: draft.id,
      before: null,
      after: {
        scopeDraftId: input.scopeDraftId,
        failedStep: input.failedStep,
        errorCode: input.errorCode,
      },
    }).catch((err) => console.error("[Audit] write failed:", err.message));

    return draft;
  } catch (err) {
    console.error("[DraftRecovery] Failed to create partial draft:", err);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/**
 * List partial drafts with optional filters.
 */
export async function listPartialDrafts(opts?: {
  scopeDraftId?: number;
  status?: "pending" | "retrying" | "recovered" | "abandoned";
  limit?: number;
  offset?: number;
}): Promise<{ items: PipelinePartialDraft[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.scopeDraftId) {
    conditions.push(eq(pipelinePartialDrafts.scopeDraftId, opts.scopeDraftId));
  }
  if (opts?.status) {
    conditions.push(eq(pipelinePartialDrafts.status, opts.status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(pipelinePartialDrafts)
      .where(where)
      .orderBy(desc(pipelinePartialDrafts.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(pipelinePartialDrafts)
      .where(where),
  ]);

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
}

/**
 * Get a single partial draft by ID.
 */
export async function getPartialDraftById(
  id: number
): Promise<PipelinePartialDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [draft] = await db
    .select()
    .from(pipelinePartialDrafts)
    .where(eq(pipelinePartialDrafts.id, id))
    .limit(1);

  return draft ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// UPDATE — Retry / Recover / Abandon
// ══════════════════════════════════════════════════════════════════════

/**
 * Mark a partial draft as "retrying" and increment retry count.
 * Returns null if max retries exceeded.
 */
export async function markPartialDraftRetrying(
  id: number,
  userId: string
): Promise<PipelinePartialDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [current] = await db
    .select()
    .from(pipelinePartialDrafts)
    .where(eq(pipelinePartialDrafts.id, id))
    .limit(1);

  if (!current) return null;

  // Check retry limit
  if (current.retryCount >= current.maxRetries) {
    return null; // Caller should abandon instead
  }

  // Only pending or retrying can be retried
  if (!["pending", "retrying"].includes(current.status)) {
    return null;
  }

  await db
    .update(pipelinePartialDrafts)
    .set({
      status: "retrying",
      retryCount: current.retryCount + 1,
    })
    .where(eq(pipelinePartialDrafts.id, id));

  const [updated] = await db
    .select()
    .from(pipelinePartialDrafts)
    .where(eq(pipelinePartialDrafts.id, id))
    .limit(1);

  logAudit({
    userId,
    action: "partial_draft_retry",
    tableName: "pipeline_partial_drafts",
    recordId: id,
    before: { retryCount: current.retryCount, status: current.status },
    after: { retryCount: updated.retryCount, status: updated.status },
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return updated;
}

/**
 * Mark a partial draft as "recovered" after a successful retry.
 */
export async function markPartialDraftRecovered(
  id: number,
  recoveredEstimateId: number,
  userId: string
): Promise<PipelinePartialDraft | null> {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(pipelinePartialDrafts)
    .set({
      status: "recovered",
      recoveredEstimateId,
      recoveredAt: new Date(),
    })
    .where(eq(pipelinePartialDrafts.id, id));

  const [updated] = await db
    .select()
    .from(pipelinePartialDrafts)
    .where(eq(pipelinePartialDrafts.id, id))
    .limit(1);

  logAudit({
    userId,
    action: "partial_draft_recovered",
    tableName: "pipeline_partial_drafts",
    recordId: id,
    before: null,
    after: {
      recoveredEstimateId,
      scopeDraftId: updated?.scopeDraftId,
    },
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return updated ?? null;
}

/**
 * Abandon a partial draft (give up on recovery).
 */
export async function abandonPartialDraft(
  id: number,
  userId: string
): Promise<PipelinePartialDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [current] = await db
    .select()
    .from(pipelinePartialDrafts)
    .where(eq(pipelinePartialDrafts.id, id))
    .limit(1);

  if (!current) return null;

  // Only pending or retrying can be abandoned
  if (!["pending", "retrying"].includes(current.status)) {
    return null;
  }

  await db
    .update(pipelinePartialDrafts)
    .set({ status: "abandoned" })
    .where(eq(pipelinePartialDrafts.id, id));

  const [updated] = await db
    .select()
    .from(pipelinePartialDrafts)
    .where(eq(pipelinePartialDrafts.id, id))
    .limit(1);

  logAudit({
    userId,
    action: "partial_draft_abandoned",
    tableName: "pipeline_partial_drafts",
    recordId: id,
    before: { status: current.status },
    after: { status: "abandoned" },
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return updated ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════

export interface PartialDraftStats {
  total: number;
  pending: number;
  retrying: number;
  recovered: number;
  abandoned: number;
  byErrorCode: Record<string, number>;
}

/**
 * Get stats for partial drafts.
 */
export async function getPartialDraftStats(): Promise<PartialDraftStats> {
  const db = await getDb();
  if (!db)
    return {
      total: 0,
      pending: 0,
      retrying: 0,
      recovered: 0,
      abandoned: 0,
      byErrorCode: {},
    };

  const [statusRows, errorRows] = await Promise.all([
    db
      .select({
        status: pipelinePartialDrafts.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(pipelinePartialDrafts)
      .groupBy(pipelinePartialDrafts.status),
    db
      .select({
        errorCode: pipelinePartialDrafts.errorCode,
        count: sql<number>`COUNT(*)`,
      })
      .from(pipelinePartialDrafts)
      .groupBy(pipelinePartialDrafts.errorCode),
  ]);

  const statusMap: Record<string, number> = {};
  let total = 0;
  for (const row of statusRows) {
    statusMap[row.status] = row.count;
    total += row.count;
  }

  const byErrorCode: Record<string, number> = {};
  for (const row of errorRows) {
    byErrorCode[row.errorCode] = row.count;
  }

  return {
    total,
    pending: statusMap["pending"] ?? 0,
    retrying: statusMap["retrying"] ?? 0,
    recovered: statusMap["recovered"] ?? 0,
    abandoned: statusMap["abandoned"] ?? 0,
    byErrorCode,
  };
}
