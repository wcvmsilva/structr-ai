/**
 * structr.ai — Scope Source DB Helpers
 * TakeOff V1: Unified scope input layer
 *
 * CRUD for scope_sources table. Scope sources normalize inputs from
 * manual entry, drawing uploads, or hybrid combinations into a
 * pipeline-ready payload that feeds scope_drafts.
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  scopeSources,
  type ScopeSource,
  type InsertScopeSource,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// SCOPE SOURCES
// ══════════════════════════════════════════════════════════════════════

export async function createScopeSource(
  data: Omit<InsertScopeSource, "id" | "createdAt" | "updatedAt">,
  userId?: string
): Promise<ScopeSource | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(scopeSources).values(data).returning();

  await logAudit({
    userId: userId ?? null,
    action: "scope_source.create",
    tableName: "scope_sources",
    recordId: result.id,
    after: { projectId: result.projectId, sourceType: result.sourceType },
  });

  return result;
}

export async function getScopeSourceById(id: string): Promise<ScopeSource | null> {
  const db = await getDb();
  if (!db) return null;

  const [source] = await db.select().from(scopeSources).where(eq(scopeSources.id, id)).limit(1);
  return source ?? null;
}

export async function listScopeSourcesByProject(projectId: string): Promise<ScopeSource[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(scopeSources)
    .where(eq(scopeSources.projectId, projectId))
    .orderBy(desc(scopeSources.createdAt));
}

export async function getActiveScopeSource(projectId: string): Promise<ScopeSource | null> {
  const db = await getDb();
  if (!db) return null;

  const [source] = await db
    .select()
    .from(scopeSources)
    .where(and(
      eq(scopeSources.projectId, projectId),
      eq(scopeSources.isActive, true),
    ))
    .orderBy(desc(scopeSources.createdAt))
    .limit(1);

  return source ?? null;
}

export async function updateScopeSource(
  id: string,
  data: Partial<Pick<InsertScopeSource, "payloadJson" | "confidenceSummaryJson" | "assemblyCandidates" | "assumptions" | "reviewStatus" | "isActive" | "scopeDraftId">>,
  userId?: string
): Promise<ScopeSource | null> {
  const db = await getDb();
  if (!db) return null;

  const before = await getScopeSourceById(id);
  if (!before) return null;

  const [updated] = await db
    .update(scopeSources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(scopeSources.id, id))
    .returning();

  await logAudit({
    userId: userId ?? null,
    action: "scope_source.update",
    tableName: "scope_sources",
    recordId: id,
    before: { reviewStatus: before.reviewStatus, isActive: before.isActive },
    after: { reviewStatus: updated.reviewStatus, isActive: updated.isActive },
  });

  return updated;
}

export async function updateScopeSourceReviewStatus(
  id: string,
  reviewStatus: string,
  userId?: string
): Promise<ScopeSource | null> {
  return updateScopeSource(id, { reviewStatus }, userId);
}

export async function linkScopeSourceToDraft(
  id: string,
  scopeDraftId: string,
  userId?: string
): Promise<ScopeSource | null> {
  return updateScopeSource(id, { scopeDraftId }, userId);
}
