/**
 * structr.ai — Project Domain DB Helpers (Sprint 10)
 *
 * Provides:
 *   - createProject(data, actorId)                        — identity + payload barrier, own transaction
 *   - getProjectById(id)
 *   - listProjects(opts)
 *   - updateProject(id, data, actorId, tenantId)           — requireProjectAccess("write") + payload barrier, own transaction
 *   - updateProjectStatus(id, status, actorId, tenantId)   — requireProjectAccess("approve") + payload barrier, own transaction
 *   - deleteProject(id, userId)   → sets status to "cancelled" (unchanged in this slice)
 *   - getProjectsByClient(clientName)
 *   - getProjectStats()
 */

import { eq, and, desc, sql, like, or } from "drizzle-orm";
import { getDb } from "./db";
import { projects, tenants, profiles, type Project, type InsertProject } from "../drizzle/schema";
import { logAudit } from "./audit";
import { tenantFilter, tenantWhere } from "./tenant-scope";
import { requireProjectAccess, ProjectAccessError } from "./project-access";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";
import {
  assertNoOperationalProjectPayload,
  PROJECT_FORBIDDEN_OPERATIONAL_STATUSES,
  ProjectOperationBlockedError,
} from "@shared/project-operation-guard";

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

/**
 * The single check both updateProjectStatus and updateProject's embedded status field
 * consult — extracted so a status change cannot legally bypass it through either entry
 * point. Callers apply the operational-destination barrier (forbidden statuses) BEFORE
 * this: this function only judges whether a formation/cancellation destination is a legal
 * next hop from the current row, exactly as STATUS_TRANSITIONS already defines.
 */
export function assertValidStatusTransition(currentStatus: string, newStatus: string): void {
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(", ") || "none"}`,
    );
  }
}

// ── Helpers ──

export async function createProject(
  data: CreateProjectInput,
  actorId: string,
): Promise<Project> {
  // Identity is required and never taken from the payload: the router stamps
  // tenantId/ownerUserId from ctx.tenantId/ctx.user.id, never from client input. A
  // direct caller supplying its own pair is still checked below for tenant/actor
  // compatibility — a resolved identity, not an ACL over a project that doesn't exist yet.
  if (!actorId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  if (!data.tenantId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, isActive: tenants.isActive })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
      .for("share");
    const [actor] = await tx
      .select({ id: profiles.id, tenantId: profiles.tenantId, isActive: profiles.isActive })
      .from(profiles)
      .where(eq(profiles.id, actorId))
      .limit(1)
      .for("share");
    // Compatibility, not just presence: an actor whose OWN tenant differs from the
    // tenant this create call claims is refused, even though both values individually
    // "exist" — the input pair must actually match the server's own record of the actor.
    if (!tenant || tenant.isActive !== true || !actor || actor.isActive !== true || actor.tenantId !== data.tenantId) {
      throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
    }

    // Payload barrier runs after identity/authorization, before any write — a direct
    // caller cannot seed a new row already in an operational projection.
    assertNoOperationalProjectPayload(data as unknown as Record<string, unknown>);

    const [result] = await tx.insert(projects).values({
      tenantId: data.tenantId,
      ownerUserId: data.ownerUserId ?? actorId,
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

    const [project] = await tx.select().from(projects).where(eq(projects.id, result.id)).limit(1);

    const logged = await logAudit({
      userId: actorId,
      action: "project.create",
      tableName: "projects",
      recordId: project.id,
      before: null,
      after: project,
    }, tx);
    if (!logged) throw new Error("Audit insert failed for project.create");

    return project;
  });
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
  actorId: string,
  tenantId: string,
): Promise<Project> {
  if (!actorId || !tenantId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    // Authorization runs on the SAME handle that will mutate the row: it locks the
    // current row (`for("update")` inside requireProjectAccess) and confirms tenant
    // ownership before anything in this transaction is trusted, closing the gap where a
    // direct caller of this helper (bypassing the router's own guard) had no ACL at all.
    await requireProjectAccess(id, actorId, "write", { mode: "a1", transaction: tx, expectedTenantId: tenantId });

    // Payload barrier: whole-payload refusal, after authorization, before any write.
    assertNoOperationalProjectPayload(data as unknown as Record<string, unknown>);

    const [before] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!before) throw new ProjectAccessError("NOT_FOUND", "Project not found");

    // A status survives the operational-destination barrier above only if it is one of
    // the formation/cancellation values; it still must be a legal transition from the
    // CURRENT row — this is the second entry point into STATUS_TRANSITIONS that
    // updateProjectStatus already enforces, closed here so update() cannot bypass it.
    if (data.status !== undefined) {
      assertValidStatusTransition(before.status, data.status);
    }

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
    // estimatedTotal/actualTotal/variancePct/startDate/endDate are intentionally absent
    // here: assertNoOperationalProjectPayload() above already refused the whole payload
    // if any of them carried a defined value, so they are always undefined at this point.
    if (data.notes !== undefined) updateData.notes = data.notes;
    updateData.updatedAt = new Date();

    await tx.update(projects).set(updateData).where(eq(projects.id, id));

    const [after] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);

    const logged = await logAudit({
      userId: actorId,
      action: "project.update",
      tableName: "projects",
      recordId: id,
      before,
      after,
    }, tx);
    if (!logged) throw new Error("Audit insert failed for project.update");

    return after;
  });
}

export async function updateProjectStatus(
  id: string,
  newStatus: string,
  actorId: string,
  tenantId: string,
): Promise<Project> {
  if (!actorId || !tenantId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    await requireProjectAccess(id, actorId, "approve", { mode: "a1", transaction: tx, expectedTenantId: tenantId });

    // Operational-destination barrier: unconditional, even if the current row is
    // ALREADY at that status (a legacy "approved" row re-targeted at "approved" is still
    // refused — it must not be read as a no-op that bypasses the barrier).
    if ((PROJECT_FORBIDDEN_OPERATIONAL_STATUSES as readonly string[]).includes(newStatus)) {
      throw new ProjectOperationBlockedError("status");
    }

    const [project] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) throw new ProjectAccessError("NOT_FOUND", "Project not found");

    const currentStatus = project.status;
    assertValidStatusTransition(currentStatus, newStatus);

    await tx
      .update(projects)
      .set({ status: newStatus as any, updatedAt: new Date() })
      .where(eq(projects.id, id));

    const [after] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);

    const logged = await logAudit({
      userId: actorId,
      action: "project.status_change",
      tableName: "projects",
      recordId: id,
      before: { status: currentStatus },
      after: { status: newStatus },
    }, tx);
    if (!logged) throw new Error("Audit insert failed for project.status_change");

    return after;
  });
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
