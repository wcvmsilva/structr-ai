/**
 * structr.ai — RFI Candidates DB Helpers
 * TakeOff V1: Items needing clarification before scope finalization
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  rfiCandidates,
  type RfiCandidate,
  type InsertRfiCandidate,
} from "../drizzle/schema";
import { logAudit } from "./audit";

export async function createRfiCandidate(
  data: Omit<InsertRfiCandidate, "id" | "createdAt" | "updatedAt">,
  userId?: string
): Promise<RfiCandidate | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(rfiCandidates).values(data).returning();

  await logAudit({
    userId: userId ?? null,
    action: "rfi.create",
    tableName: "rfi_candidates",
    recordId: result.id,
    after: { projectId: result.projectId, category: result.category, question: result.question },
  });

  return result;
}

export async function getRfiCandidateById(id: string): Promise<RfiCandidate | null> {
  const db = await getDb();
  if (!db) return null;

  const [rfi] = await db.select().from(rfiCandidates).where(eq(rfiCandidates.id, id)).limit(1);
  return rfi ?? null;
}

export async function listRfiCandidatesByProject(projectId: string): Promise<RfiCandidate[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(rfiCandidates)
    .where(eq(rfiCandidates.projectId, projectId))
    .orderBy(desc(rfiCandidates.createdAt));
}

export async function listRfiCandidatesByScopeSource(scopeSourceId: string): Promise<RfiCandidate[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(rfiCandidates)
    .where(eq(rfiCandidates.scopeSourceId, scopeSourceId))
    .orderBy(desc(rfiCandidates.createdAt));
}

export async function listOpenRfisByProject(projectId: string): Promise<RfiCandidate[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(rfiCandidates)
    .where(and(
      eq(rfiCandidates.projectId, projectId),
      eq(rfiCandidates.status, "open"),
    ))
    .orderBy(desc(rfiCandidates.createdAt));
}

export async function listOpenRfisByScopeSource(scopeSourceId: string): Promise<RfiCandidate[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(rfiCandidates)
    .where(and(
      eq(rfiCandidates.scopeSourceId, scopeSourceId),
      eq(rfiCandidates.status, "open"),
    ))
    .orderBy(desc(rfiCandidates.createdAt));
}

export async function resolveRfiCandidate(
  id: string,
  resolution: string,
  userId: string
): Promise<RfiCandidate | null> {
  const db = await getDb();
  if (!db) return null;

  const [updated] = await db
    .update(rfiCandidates)
    .set({
      resolution,
      resolvedBy: userId,
      resolvedAt: new Date(),
      status: "resolved",
      updatedAt: new Date(),
    })
    .where(eq(rfiCandidates.id, id))
    .returning();

  await logAudit({
    userId,
    action: "rfi.resolve",
    tableName: "rfi_candidates",
    recordId: id,
    after: { resolution, status: "resolved" },
  });

  return updated ?? null;
}

export async function dismissRfiCandidate(
  id: string,
  userId: string
): Promise<RfiCandidate | null> {
  const db = await getDb();
  if (!db) return null;

  const [updated] = await db
    .update(rfiCandidates)
    .set({
      status: "dismissed",
      resolvedBy: userId,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(rfiCandidates.id, id))
    .returning();

  await logAudit({
    userId,
    action: "rfi.dismiss",
    tableName: "rfi_candidates",
    recordId: id,
    after: { status: "dismissed" },
  });

  return updated ?? null;
}

export async function promoteRfiCandidate(
  id: string,
  userId: string
): Promise<RfiCandidate | null> {
  const db = await getDb();
  if (!db) return null;

  const [updated] = await db
    .update(rfiCandidates)
    .set({
      status: "promoted",
      updatedAt: new Date(),
    })
    .where(eq(rfiCandidates.id, id))
    .returning();

  await logAudit({
    userId,
    action: "rfi.promote",
    tableName: "rfi_candidates",
    recordId: id,
    after: { status: "promoted" },
  });

  return updated ?? null;
}
