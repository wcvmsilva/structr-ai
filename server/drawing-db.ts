/**
 * structr.ai — Drawing Intake DB Helpers
 * TakeOff V1: Project Drawings + Revision Snapshots
 *
 * CRUD operations for project_drawings and drawing_revision_snapshots.
 * All mutations log to audit trail.
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  projectDrawings,
  drawingRevisionSnapshots,
  type ProjectDrawing,
  type InsertProjectDrawing,
  type DrawingRevisionSnapshot,
  type InsertDrawingRevisionSnapshot,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// PROJECT DRAWINGS
// ══════════════════════════════════════════════════════════════════════

export async function createProjectDrawing(
  data: Omit<InsertProjectDrawing, "id" | "createdAt" | "updatedAt">,
  userId?: string
): Promise<ProjectDrawing | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(projectDrawings).values(data).returning();

  await logAudit({
    userId: userId ?? null,
    action: "drawing.upload",
    tableName: "project_drawings",
    recordId: result.id,
    after: { fileName: result.fileName, projectId: result.projectId, revisionLabel: result.revisionLabel },
  });

  return result;
}

export async function getProjectDrawingById(id: string): Promise<ProjectDrawing | null> {
  const db = await getDb();
  if (!db) return null;

  const [drawing] = await db.select().from(projectDrawings).where(eq(projectDrawings.id, id)).limit(1);
  return drawing ?? null;
}

export async function listDrawingsByProject(projectId: string): Promise<ProjectDrawing[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(projectDrawings)
    .where(eq(projectDrawings.projectId, projectId))
    .orderBy(desc(projectDrawings.createdAt));
}

export async function listActiveDrawingsByProject(projectId: string): Promise<ProjectDrawing[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(projectDrawings)
    .where(and(
      eq(projectDrawings.projectId, projectId),
      eq(projectDrawings.isActiveRevision, true),
    ))
    .orderBy(desc(projectDrawings.createdAt));
}

export async function setActiveRevision(
  projectId: string,
  drawingId: string,
  userId?: string
): Promise<ProjectDrawing | null> {
  const db = await getDb();
  if (!db) return null;

  const target = await getProjectDrawingById(drawingId);
  if (!target || target.projectId !== projectId) return null;

  // Deactivate ALL active drawings for this project, then activate the target.
  // This prevents multiple drawings from being active simultaneously.
  await db
    .update(projectDrawings)
    .set({ isActiveRevision: false, updatedAt: new Date() })
    .where(and(
      eq(projectDrawings.projectId, projectId),
      eq(projectDrawings.isActiveRevision, true),
    ));

  // Activate the target
  const [updated] = await db
    .update(projectDrawings)
    .set({ isActiveRevision: true, updatedAt: new Date() })
    .where(eq(projectDrawings.id, drawingId))
    .returning();

  await logAudit({
    userId: userId ?? null,
    action: "drawing.set_active_revision",
    tableName: "project_drawings",
    recordId: drawingId,
    after: { projectId, revisionLabel: updated.revisionLabel },
  });

  return updated;
}

export async function deleteProjectDrawing(id: string, userId?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const drawing = await getProjectDrawingById(id);
  if (!drawing) return false;

  await db.delete(projectDrawings).where(eq(projectDrawings.id, id));

  await logAudit({
    userId: userId ?? null,
    action: "drawing.delete",
    tableName: "project_drawings",
    recordId: id,
    before: { fileName: drawing.fileName, projectId: drawing.projectId },
  });

  return true;
}

// ══════════════════════════════════════════════════════════════════════
// DRAWING REVISION SNAPSHOTS
// ══════════════════════════════════════════════════════════════════════

export async function createRevisionSnapshot(
  data: Omit<InsertDrawingRevisionSnapshot, "id" | "createdAt">,
  userId?: string
): Promise<DrawingRevisionSnapshot | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(drawingRevisionSnapshots).values(data).returning();

  await logAudit({
    userId: userId ?? null,
    action: "drawing.create_snapshot",
    tableName: "drawing_revision_snapshots",
    recordId: result.id,
    after: { projectId: result.projectId, revisionLabel: result.revisionLabel },
  });

  return result;
}

export async function listRevisionSnapshots(projectId: string): Promise<DrawingRevisionSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(drawingRevisionSnapshots)
    .where(eq(drawingRevisionSnapshots.projectId, projectId))
    .orderBy(desc(drawingRevisionSnapshots.createdAt));
}
