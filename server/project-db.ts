/**
 * structr.ai — Project Domain DB Helpers (Sprint 10)
 *
 * Provides:
 *   - createProject(data, actorId, tenantId)               — identity + payload barrier, own SERIALIZABLE transaction
 *   - getProjectById(id)
 *   - listProjects(opts)
 *   - updateProject(id, data, actorId, tenantId)           — requireProjectAccess("write") + payload barrier, own SERIALIZABLE transaction
 *   - updateProjectStatus(id, status, actorId, tenantId)   — requireProjectAccess("approve") + payload barrier, own SERIALIZABLE transaction
 *   - deleteProject(id, actorId, tenantId) — requireProjectAccess("delete") + transition check, own SERIALIZABLE transaction; cancellation, not removal
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
  ProjectStatusTransitionInvalidError,
  ProjectReopenNotVerifiedError,
} from "@shared/project-operation-guard";

// ── Types ──

export interface CreateProjectInput {
  // V2 correction: tenantId/ownerUserId are trusted CONTEXT, not business payload — they
  // are now separate, required parameters of createProject() itself (never read from this
  // object), so a direct caller cannot smuggle either one through `data`.
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
  // `unknown`, not a status literal union: on the default/public path ANY defined value is
  // refused; on the explicit, trusted allowFormationStatus:true path it is checked against
  // CREATE_ALLOWED_FORMATION_STATUSES, not against this type — the type must accept
  // whatever a direct caller (or the router's recognized-but-never-validated schema field)
  // sends, malformed values included.
  status?: unknown;
  leadId?: string | null;
  jobtreadId?: string | null;
  notes?: string | null;
}

/**
 * The exact historical formation/progression states the ORIGINAL baseline (81d227eb)
 * accepted at create — never a new public route, only reachable via createProject()'s
 * explicit, trusted, non-payload-derived `allowFormationStatus` option. "cancelled" is
 * deliberately excluded: it is not formation, and is out of scope for this adjustment.
 */
const CREATE_ALLOWED_FORMATION_STATUSES = ["estimate", "intake", "estimating", "review"] as const;

/**
 * Validates a status against the fixed create-time allowed set — the create-side
 * equivalent of assertValidStatusTransition() for update, except there is no "current row"
 * to check a transition against: membership in CREATE_ALLOWED_FORMATION_STATUSES is the
 * whole rule. Only ever called after assertNoOperationalProjectPayload() has already
 * cleared the four forbidden operational destinations.
 */
function assertValidInitialStatus(status: unknown): void {
  if (typeof status !== "string" || !(CREATE_ALLOWED_FORMATION_STATUSES as readonly string[]).includes(status)) {
    throw new ProjectStatusTransitionInvalidError(
      `Invalid initial status: ${String(status)}. Allowed: ${CREATE_ALLOWED_FORMATION_STATUSES.join(", ")}`,
    );
  }
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
  // `unknown`: a legitimate formation/cancellation value is validated by
  // assertValidStatusTransition() AFTER the operational-destination barrier, not by this
  // type — an operationally-forbidden or malformed value must still reach the barrier
  // rather than fail a type check the caller never sees.
  status?: unknown;
  leadId?: string | null;
  jobtreadId?: string | null;
  // `unknown`, not `string | null`: these eight are recognized ONLY so a defined value of
  // any shape is refused by assertNoOperationalProjectPayload() — never applied, so their
  // type must never imply a validated, writable value. provenanceState is computed by
  // the database's own triggers (drizzle/0012_project_reopen_provenance.sql) — the
  // backend never assigns it, even on the trusted allowFormationStatus path.
  estimatedTotal?: unknown;
  actualTotal?: unknown;
  variancePct?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  approvedBudgetCents?: unknown;
  changeOrderBudgetCents?: unknown;
  provenanceState?: unknown;
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
export function assertValidStatusTransition(currentStatus: string, newStatus: unknown): void {
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  // A non-string survives the operational-destination barrier (which only recognizes the
  // four forbidden string literals) but is still not a legal transition target of any kind.
  // Thrown as a distinct typed error (not a bare Error) so the router can classify this as
  // BAD_REQUEST rather than letting it fall through to a generic INTERNAL_SERVER_ERROR —
  // this is a client input problem, never revealed until AFTER authorization has run.
  if (typeof newStatus !== "string" || !allowed.includes(newStatus)) {
    throw new ProjectStatusTransitionInvalidError(
      `Invalid status transition: ${currentStatus} → ${String(newStatus)}. Allowed: ${allowed.join(", ") || "none"}`,
    );
  }
}

// ── Helpers ──

export async function createProject(
  data: CreateProjectInput,
  actorId: string,
  tenantId: string,
  // V4 correction: mirrors updateProject()'s trusted, non-payload-derived option — the
  // ORIGINAL baseline (81d227eb) and the initial implementation contract always intended
  // to preserve create-time formation/progression, not forbid it outright. Default false
  // (the public router's own call shape: 3 arguments, never a 4th) refuses ANY defined
  // status, same as before. Explicit true (a future trusted internal caller only) allows
  // EXACTLY CREATE_ALLOWED_FORMATION_STATUSES — never derived from the request body.
  options?: { allowFormationStatus?: boolean },
): Promise<Project> {
  // Identity is required and never taken from the payload: tenantId/actorId are the
  // router's trusted ctx.tenantId/ctx.user.id, passed as their own parameters — `data`
  // has no tenantId/ownerUserId field at all, so there is nothing in the business payload
  // for even a direct caller to smuggle either one through.
  if (!actorId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  if (!tenantId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allowFormationStatus = options?.allowFormationStatus ?? false;

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, isActive: tenants.isActive })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
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
    if (!tenant || tenant.isActive !== true || !actor || actor.isActive !== true || actor.tenantId !== tenantId) {
      throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
    }

    // Payload barrier runs after identity/authorization, before any write. The four
    // operational destinations are always refused here regardless of allowFormationStatus;
    // when it is false (the public route's own call shape) ANY defined status is refused —
    // there is no current row for create to check a transition against, so "allowed" is
    // this call's own explicit choice, never the payload's.
    assertNoOperationalProjectPayload(data as unknown as Record<string, unknown>, { allowFormationStatus });
    // A status only survives the barrier above at all when allowFormationStatus was
    // explicitly requested AND the value is not one of the four forbidden destinations —
    // it still must be one of the exact historical formation states, never "cancelled"
    // and never an unrecognized value, even under the trusted option.
    if (allowFormationStatus && data.status !== undefined) {
      assertValidInitialStatus(data.status);
    }

    const [result] = await tx.insert(projects).values({
      tenantId,
      // Owner is ALWAYS the verified actor — never read from data, so a direct caller
      // cannot assign a different (possibly cross-tenant) owner via the payload.
      ownerUserId: actorId,
      clientId: data.clientId ?? null,
      name: data.name,
      clientName: data.clientName ?? null,
      clientEmail: data.clientEmail ?? null,
      address: data.address ?? null,
      city: data.city ?? "Goose Creek",
      state: data.state ?? "SC",
      zip: data.zip ?? null,
      projectType: data.projectType ?? "remodel",
      status: (allowFormationStatus && data.status !== undefined ? data.status : "intake") as any,
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
  }, { isolationLevel: "serializable" });
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

/**
 * The database's own mandatory reopen-formation gate (drizzle/0012_project_reopen_
 * provenance.sql) raises SQLSTATE 23514 with constraint_name
 * 'project_reopen_formation_not_verified' FROM THE projects TABLE SPECIFICALLY. Mirrors
 * server/estimate-version-v2-db.ts's isRequestUniqueConflict (NOT modified — this is a
 * separate, specific matcher for a different constraint): walks a depth-limited `cause`
 * chain, relabels ONLY when `code`, `constraint_name`, AND `table_name` all match EXACTLY.
 * The third field exists specifically so a DIFFERENT real error (e.g. logAudit's own
 * INSERT into audit_logs failing with some unrelated 23514/constraint pair, or ANY error
 * that happens to carry a coincidentally-matching code+constraint from a table other than
 * projects) can never be misclassified as this specific refusal — the driver's own
 * PostgresError already carries table_name on every real constraint violation, so this
 * costs nothing extra to check. A cycle, excessive depth, an unrelated SQLSTATE/
 * constraint/table, a serialization failure (40001), or an audit failure (no `.code` at
 * all, or a `.code` from a different table) all fall through unmatched — never
 * reclassified by message text alone.
 */
// Exported ONLY for direct unit testing of its depth/cycle/mismatch robustness
// (server/project-db-reopen-mapper.test.ts) — a real Postgres error's cause chain never
// naturally cycles or exceeds this depth, so those specific defensive branches are
// impractical to exercise through real execution and are tested directly instead.
export function isReopenFormationViolation(error: unknown): boolean {
  let current: unknown = error;
  let found = false;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth++) {
    if (current == null) return found;
    if (typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    const value = current as { code?: unknown; constraint_name?: unknown; table_name?: unknown; cause?: unknown };
    if (value.code !== undefined) {
      if (
        value.code !== "23514" ||
        value.constraint_name !== "project_reopen_formation_not_verified" ||
        value.table_name !== "projects"
      ) return false;
      found = true;
    }
    current = value.cause;
  }
  return current == null && found;
}

export async function updateProject(
  id: string,
  data: UpdateProjectInput,
  actorId: string,
  tenantId: string,
  // V3 correction: `allowFormationStatus` is a TRUSTED, non-payload-derived option — never
  // set by project-router.ts's public `update` mutation (which always gets the safe
  // default: ANY defined status is refused wholesale, formation/cancellation included).
  // The capability to perform a legitimate formation transition through this helper is
  // preserved for a future trusted internal caller that explicitly opts in — it is not
  // published on the generic, write-permission-only public route, which would let an
  // actor with "write" but not "approve" reach transitions the dedicated, approve-gated
  // updateProjectStatus() correctly denies them.
  options?: { allowFormationStatus?: boolean },
): Promise<Project> {
  if (!actorId || !tenantId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allowFormationStatus = options?.allowFormationStatus ?? false;

  // Caught OUTSIDE db.transaction(...), never inside the callback: the transaction has
  // already rejected and rolled back by the time this catch runs. Only the exact
  // reopen-formation SQLSTATE+constraint is relabeled; everything else (audit failures,
  // unrelated constraints, 40001 serialization conflicts) rethrows unchanged.
  try {
    return await db.transaction(async (tx) => {
    // Authorization runs on the SAME handle that will mutate the row: it locks the
    // current row (`for("update")` inside requireProjectAccess) and confirms tenant
    // ownership before anything in this transaction is trusted, closing the gap where a
    // direct caller of this helper (bypassing the router's own guard) had no ACL at all.
    await requireProjectAccess(id, actorId, "write", { mode: "a1", transaction: tx, expectedTenantId: tenantId });

    // Payload barrier: whole-payload refusal, after authorization, before any write.
    assertNoOperationalProjectPayload(data as unknown as Record<string, unknown>, { allowFormationStatus });

    const [before] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!before) throw new ProjectAccessError("NOT_FOUND", "Project not found");

    // A status only survives the barrier above at all when allowFormationStatus was
    // explicitly requested AND the value is not one of the four forbidden destinations —
    // it still must be a legal transition from the CURRENT row, exactly what
    // updateProjectStatus's own STATUS_TRANSITIONS check already enforces.
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
    }, { isolationLevel: "serializable" });
  } catch (error) {
    if (isReopenFormationViolation(error)) throw new ProjectReopenNotVerifiedError();
    throw error;
  }
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

  try {
    return await db.transaction(async (tx) => {
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
    }, { isolationLevel: "serializable" });
  } catch (error) {
    if (isReopenFormationViolation(error)) throw new ProjectReopenNotVerifiedError();
    throw error;
  }
}

/**
 * "Delete" is cancellation, not removal or invisibility — projects has no deletedAt
 * semantics for this operation (the column exists and is already honored as a hard block
 * by requireProjectAccess's transactional mode; this helper never writes it, since that
 * would be a different, unauthorized behavior change, not a correction of this one).
 */
export async function deleteProject(
  id: string,
  actorId: string,
  tenantId: string,
): Promise<{ success: true }> {
  if (!actorId || !tenantId) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    await requireProjectAccess(id, actorId, "delete", { mode: "a1", transaction: tx, expectedTenantId: tenantId });

    const [before] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!before) throw new ProjectAccessError("NOT_FOUND", "Project not found");

    // Idempotent: cancelling an already-cancelled project is a successful no-op, not a
    // transition attempt — STATUS_TRANSITIONS has no "cancelled → cancelled" edge, and
    // treating this as an error (or as a fresh mutation/audit event) would either break a
    // legitimate repeat request or fabricate a transition that never happened. No new
    // requestId/replay mechanism is introduced; the check is a plain state comparison.
    if (before.status === "cancelled") {
      return { success: true };
    }

    // Same typed error as update/updateStatus for the same class of problem: `completed`
    // has no legal exit (STATUS_TRANSITIONS.completed = []) and an unrecognized status is
    // rejected identically — both AFTER authorization has already run.
    assertValidStatusTransition(before.status, "cancelled");

    await tx.update(projects).set({ status: "cancelled", updatedAt: new Date() }).where(eq(projects.id, id));

    const [after] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);

    const logged = await logAudit({
      userId: actorId,
      action: "project.delete",
      tableName: "projects",
      recordId: id,
      before,
      after,
    }, tx);
    if (!logged) throw new Error("Audit insert failed for project.delete");

    return { success: true };
  }, { isolationLevel: "serializable" });
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
