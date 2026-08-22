/**
 * structr.ai — Project Domain DB Helpers (Sprint 10)
 *
 * Provides:
 *   - createProject(data, userId)
 *   - getProjectById(id)
 *   - listProjects(opts)
 *   - updateProject(id, data, userId)
 *   - updateProjectStatus(id, status, userId)
 *   - deleteProject(id, userId)   → sets status to "cancelled"
 *   - getProjectsByClient(clientName)
 *   - getProjectStats()
 */

import { eq, and, desc, sql, like, or } from "drizzle-orm";
import { getDb } from "./db";
import { projects, type Project, type InsertProject } from "../drizzle/schema";
import { logAudit } from "./audit";
import { tenantFilter, tenantWhere } from "./tenant-scope";

// ── Types ──

export interface CreateProjectInput {
  /** PHASE 1: owning tenant. Defaults to the caller's tenant (ctx.tenantId). */
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  /** PHASE 1: project owner — always granted full project access. */
  ownerUserId?: string | null;
  clientId?: string | null;
  name: string;
  clientName?: string | null;
  clientEmail?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  projectType: "remodel" | "new_construction" | "repair" | "insurance_restoration" | "commercial_buildout" | "addition" | "exterior";
  channel?: "direct" | "insurance" | "commercial" | "premium";
  status?: "estimate" | "intake" | "estimating" | "review" | "approved" | "in_progress" | "completed" | "cancelled";
  leadId?: string | null;
  jobtreadId?: string | null;
  notes?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  clientName?: string | null;
  clientEmail?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  projectType?: "remodel" | "new_construction" | "repair" | "insurance_restoration" | "commercial_buildout" | "addition" | "exterior";
  channel?: "direct" | "insurance" | "commercial" | "premium";
  status?: "estimate" | "intake" | "estimating" | "review" | "approved" | "in_progress" | "completed" | "cancelled";
  leadId?: string | null;
  jobtreadId?: string | null;
  estimatedTotal?: string | null;
  actualTotal?: string | null;
  variancePct?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export interface ListProjectsOpts {
  search?: string;
  status?: string;
  channel?: string;
  clientName?: string;
  projectType?: string;
  limit?: number;
  offset?: number;
  /** PHASE 1: restrict results to a tenant. */
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
}

// ── Valid status transitions ──
const STATUS_TRANSITIONS: Record<string, string[]> = {
  estimate: ["intake", "cancelled"],
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
  userId?: string | null,
): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(projects).values({
    tenantId: data.tenantId ?? null,
    ownerUserId: data.ownerUserId ?? userId ?? null,
    clientId: data.clientId ?? null,
    name: data.name,
    clientName: data.clientName ?? null,
    clientEmail: data.clientEmail ?? null,
    address: data.address ?? null,
    city: data.city ?? "Goose Creek",
    state: data.state ?? "SC",
    zip: data.zip ?? null,
    projectType: data.projectType ?? "remodel",
    status: data.status ?? "intake",
    channel: data.channel ?? "premium",
    leadId: data.leadId ?? null,
    jobtreadId: data.jobtreadId ?? null,
    notes: data.notes ?? null,
  }).returning({ id: projects.id });

  const [project] = await db.select().from(projects).where(eq(projects.id, result.id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "project.create",
    tableName: "projects",
    recordId: project.id,
    before: null,
    after: project,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return project;
}

export async function getProjectById(id: string): Promise<Project | null> {
  const db = await getDb();
  if (!db) return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  return project ?? null;
}

export async function listProjects(opts: ListProjectsOpts): Promise<{
  items: Project[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  // PHASE 1: tenant isolation applied before any domain filter.
  const tenantCondition = tenantFilter(projects, opts.tenantId);
  if (tenantCondition) {
    conditions.push(tenantCondition);
  }

  if (opts?.status) {
    conditions.push(eq(projects.status, opts.status as any));
  }

  if (opts?.channel) {
    conditions.push(eq(projects.channel, opts.channel as any));
  }

  if (opts?.clientName) {
    conditions.push(like(projects.clientName, `%${opts.clientName}%`));
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
  id: string,
  data: UpdateProjectInput,
  userId?: string | null,
): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!before) throw new Error(`Project ${id} not found`);

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.clientName !== undefined) updateData.clientName = data.clientName;
  if (data.clientEmail !== undefined) updateData.clientEmail = data.clientEmail;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.zip !== undefined) updateData.zip = data.zip;
  if (data.projectType !== undefined) updateData.projectType = data.projectType;
  if (data.channel !== undefined) updateData.channel = data.channel;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.leadId !== undefined) updateData.leadId = data.leadId;
  if (data.jobtreadId !== undefined) updateData.jobtreadId = data.jobtreadId;
  if (data.estimatedTotal !== undefined) updateData.estimatedTotal = data.estimatedTotal;
  if (data.actualTotal !== undefined) updateData.actualTotal = data.actualTotal;
  if (data.variancePct !== undefined) updateData.variancePct = data.variancePct;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.endDate !== undefined) updateData.endDate = data.endDate;
  if (data.notes !== undefined) updateData.notes = data.notes;
  updateData.updatedAt = new Date();

  await db.update(projects).set(updateData).where(eq(projects.id, id));

  const [after] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "project.update",
    tableName: "projects",
    recordId: id,
    before,
    after,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return after;
}

export async function updateProjectStatus(
  id: string,
  newStatus: string,
  userId?: string | null,
): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) throw new Error(`Project ${id} not found`);

  const currentStatus = project.status;
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(", ") || "none"}`,
    );
  }

  await db
    .update(projects)
    .set({ status: newStatus as any, updatedAt: new Date() })
    .where(eq(projects.id, id));

  const [after] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "project.status_change",
    tableName: "projects",
    recordId: id,
    before: { status: currentStatus },
    after: { status: newStatus },
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return after;
}

export async function deleteProject(
  id: string,
  userId?: string | null,
): Promise<{ success: true }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!before) throw new Error(`Project ${id} not found`);

  // Since no soft delete column exists, update status to "cancelled"
  await db
    .update(projects)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(projects.id, id));

  logAudit({
    userId: userId ?? null,
    action: "project.delete",
    tableName: "projects",
    recordId: id,
    before,
    after: { status: "cancelled" },
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return { success: true };
}

export async function getProjectsByClient(
  clientName: string,
  tenantId: string,
): Promise<Project[]> {
  const db = await getDb();
  if (!db) return [];

  const where = tenantWhere(
    projects,
    tenantId,
    like(projects.clientName, `%${clientName}%`),
  );

  return db
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.createdAt));
}

export async function getProjectStats(tenantId: string): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byType: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, byStatus: {}, byChannel: {}, byType: {} };

  const scope = tenantFilter(projects, tenantId);

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(scope);

  const statusRows = await db
    .select({ status: projects.status, count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(scope)
    .groupBy(projects.status);

  const channelRows = await db
    .select({ channel: projects.channel, count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(scope)
    .groupBy(projects.channel);

  const typeRows = await db
    .select({ type: projects.projectType, count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(scope)
    .groupBy(projects.projectType);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const byChannel: Record<string, number> = {};
  for (const r of channelRows) if (r.channel) byChannel[r.channel] = r.count;

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
