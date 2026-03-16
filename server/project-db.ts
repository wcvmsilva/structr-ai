/**
 * structr.ai — Project Domain DB Helpers (Sprint 10)
 *
 * Provides:
 *   - createProject(data, userId)
 *   - getProjectById(id)
 *   - listProjects(opts)
 *   - updateProject(id, data, userId)
 *   - updateProjectStatus(id, status, userId)
 *   - deleteProject(id, userId)   → soft delete
 *   - getProjectsByClient(clientId)
 *   - getProjectStats()
 */

import { eq, and, isNull, desc, sql, like, or } from "drizzle-orm";
import { getDb } from "./db";
import { projects, type Project, type InsertProject } from "../drizzle/schema";
import { logAudit } from "./audit";
import { randomUUID } from "crypto";

// ── Types ──

export interface CreateProjectInput {
  name: string;
  clientId?: number | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zipCode?: string | null;
  region?: string | null;
  zone?: string | null;
  projectType?: "remodel" | "new_construction" | "repair" | "insurance_restoration" | "commercial_buildout" | "addition" | "exterior";
  channel?: "direct" | "insurance" | "commercial";
  notes?: string | null;
  assignedTo?: number | null;
}

export interface UpdateProjectInput {
  name?: string;
  clientId?: number | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zipCode?: string | null;
  region?: string | null;
  zone?: string | null;
  projectType?: "remodel" | "new_construction" | "repair" | "insurance_restoration" | "commercial_buildout" | "addition" | "exterior";
  channel?: "direct" | "insurance" | "commercial";
  estimatedValue?: string | null;
  actualCost?: string | null;
  grossProfit?: string | null;
  profitShieldMinPct?: string | null;
  notes?: string | null;
  assignedTo?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListProjectsOpts {
  search?: string;
  status?: string;
  channel?: string;
  clientId?: number;
  projectType?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

// ── Valid status transitions ──
const STATUS_TRANSITIONS: Record<string, string[]> = {
  intake: ["estimating", "cancelled"],
  estimating: ["review", "cancelled"],
  review: ["approved", "estimating", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: ["intake"],
};

// ── Helpers ──

export async function createProject(
  data: CreateProjectInput,
  userId?: number | null,
): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const uuid = randomUUID();

  const [result] = await db.insert(projects).values({
    uuid,
    name: data.name,
    clientId: data.clientId ?? null,
    clientName: data.clientName ?? null,
    clientEmail: data.clientEmail ?? null,
    clientPhone: data.clientPhone ?? null,
    address: data.address ?? null,
    city: data.city ?? "Charleston",
    county: data.county ?? null,
    state: data.state ?? "SC",
    zipCode: data.zipCode ?? null,
    region: data.region ?? null,
    zone: data.zone ?? null,
    projectType: data.projectType ?? "remodel",
    status: "intake",
    channel: data.channel ?? "direct",
    notes: data.notes ?? null,
    createdBy: userId ?? null,
    assignedTo: data.assignedTo ?? null,
  }).$returningId();

  const [project] = await db.select().from(projects).where(eq(projects.id, result.id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "project.create",
    tableName: "projects",
    recordId: project.id,
    before: null,
    after: project,
  }).catch(() => {});

  return project;
}

export async function getProjectById(id: number): Promise<Project | null> {
  const db = await getDb();
  if (!db) return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  return project ?? null;
}

export async function listProjects(opts?: ListProjectsOpts): Promise<{
  items: Project[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  if (!opts?.includeDeleted) {
    conditions.push(isNull(projects.deletedAt));
  }

  if (opts?.status) {
    conditions.push(eq(projects.status, opts.status as any));
  }

  if (opts?.channel) {
    conditions.push(eq(projects.channel, opts.channel as any));
  }

  if (opts?.clientId) {
    conditions.push(eq(projects.clientId, opts.clientId));
  }

  if (opts?.projectType) {
    conditions.push(eq(projects.projectType, opts.projectType as any));
  }

  if (opts?.search) {
    const term = `%${opts.search}%`;
    conditions.push(
      or(
        like(projects.name, term),
        like(projects.clientName, term),
        like(projects.address, term),
        like(projects.city, term),
      )!,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;

  return { items, total };
}

export async function updateProject(
  id: number,
  data: UpdateProjectInput,
  userId?: number | null,
): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!before) throw new Error(`Project ${id} not found`);
  if (before.deletedAt) throw new Error(`Project ${id} has been deleted`);

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.clientId !== undefined) updateData.clientId = data.clientId;
  if (data.clientName !== undefined) updateData.clientName = data.clientName;
  if (data.clientEmail !== undefined) updateData.clientEmail = data.clientEmail;
  if (data.clientPhone !== undefined) updateData.clientPhone = data.clientPhone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.county !== undefined) updateData.county = data.county;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.zipCode !== undefined) updateData.zipCode = data.zipCode;
  if (data.region !== undefined) updateData.region = data.region;
  if (data.zone !== undefined) updateData.zone = data.zone;
  if (data.projectType !== undefined) updateData.projectType = data.projectType;
  if (data.channel !== undefined) updateData.channel = data.channel;
  if (data.estimatedValue !== undefined) updateData.estimatedValue = data.estimatedValue;
  if (data.actualCost !== undefined) updateData.actualCost = data.actualCost;
  if (data.grossProfit !== undefined) updateData.grossProfit = data.grossProfit;
  if (data.profitShieldMinPct !== undefined) updateData.profitShieldMinPct = data.profitShieldMinPct;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;
  if (data.metadata !== undefined) updateData.metadata = data.metadata;
  updateData.updatedBy = userId ?? null;

  await db.update(projects).set(updateData).where(eq(projects.id, id));

  const [after] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "project.update",
    tableName: "projects",
    recordId: id,
    before,
    after,
  }).catch(() => {});

  return after;
}

export async function updateProjectStatus(
  id: number,
  newStatus: string,
  userId?: number | null,
): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) throw new Error(`Project ${id} not found`);
  if (project.deletedAt) throw new Error(`Project ${id} has been deleted`);

  const currentStatus = project.status;
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(", ") || "none"}`,
    );
  }

  await db
    .update(projects)
    .set({ status: newStatus as any, updatedBy: userId ?? null })
    .where(eq(projects.id, id));

  const [after] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "project.status_change",
    tableName: "projects",
    recordId: id,
    before: { status: currentStatus },
    after: { status: newStatus },
  }).catch(() => {});

  return after;
}

export async function deleteProject(
  id: number,
  userId?: number | null,
): Promise<{ success: true }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!before) throw new Error(`Project ${id} not found`);

  await db
    .update(projects)
    .set({ deletedAt: new Date(), updatedBy: userId ?? null })
    .where(eq(projects.id, id));

  logAudit({
    userId: userId ?? null,
    action: "project.delete",
    tableName: "projects",
    recordId: id,
    before,
    after: { deletedAt: new Date() },
  }).catch(() => {});

  return { success: true };
}

export async function getProjectsByClient(clientId: number): Promise<Project[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byType: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, byStatus: {}, byChannel: {}, byType: {} };

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(isNull(projects.deletedAt));

  const statusRows = await db
    .select({ status: projects.status, count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .groupBy(projects.status);

  const channelRows = await db
    .select({ channel: projects.channel, count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .groupBy(projects.channel);

  const typeRows = await db
    .select({ type: projects.projectType, count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .groupBy(projects.projectType);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const byChannel: Record<string, number> = {};
  for (const r of channelRows) byChannel[r.channel] = r.count;

  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[r.type ?? "unknown"] = r.count;

  return {
    total: totalResult?.count ?? 0,
    byStatus,
    byChannel,
    byType,
  };
}

/** Export valid status transitions for testing */
export { STATUS_TRANSITIONS };
