/**
 * structr.ai — Project Access Guard (Phase 1)
 *
 * Single authorization chokepoint for every route that receives a projectId, or any
 * identifier that resolves to a project (drawingId, scopeDraftId, scopeSourceId,
 * estimateId, intakeFormId, rfiId, ...).
 *
 * Decision order (first match wins):
 *   1. project does not exist                       → 404 NOT_FOUND
 *   2. caller tenant NOT resolved                   → 403 FORBIDDEN  (B2, caller axis)
 *   3. caller tenant != project tenant              → 403 FORBIDDEN
 *   4. caller is platform admin                     → allow (inside the tenant only)
 *   5. caller is the project owner                  → allow
 *   6. caller has an active project_members row     → allow if role/permissions cover it
 *   7. caller holds the matching RBAC permission    → allow
 *   8. otherwise                                    → 403 FORBIDDEN
 *
 * B2 (Codex P1-1, second review). Steps 2 and 3 are new and deliberately sit ABOVE every
 * role, ownership and membership branch. Previously the admin branch returned full owner
 * permissions before any tenant comparison, so a platform admin was authorized on every
 * tenant's projects; and the isolation check that followed read
 *   `if (project.tenantId && user.tenantId && project.tenantId !== user.tenantId)`
 * which fails OPEN whenever either side is null — so a profile with no tenant passed it
 * for any project. Neither a role nor ownership nor project membership may substitute for
 * a resolved caller tenant, and none of them may cross a tenant boundary.
 *
 * `user.tenantId` here IS the trusted caller tenant, not a stand-in for it: since
 * `sdk.resolveTenantId()` returns `profile.tenantId ?? null`, the value this guard reads
 * from the profile row and the value `ctx.tenantId` carries are the same field of the same
 * row. That equivalence is load-bearing, so it is pinned by a test rather than assumed.
 *
 * The ROW axis is untouched: a legacy project with `tenant_id IS NULL` stays reachable
 * while TENANT_STRICT is off, exactly as `assertSameTenant()` already allows everywhere
 * else (F15 / issue #10).
 *
 * Fail-closed: when the database is unavailable the guard denies access instead of
 * silently allowing the request through.
 */

import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";
import { getDb } from "./db";
import { hasPermission } from "./rbac";
import { assertSameTenant } from "./tenant-scope";
import {
  projects,
  projectMembers,
  profiles,
  scopeDraftItems,
  projectDrawings,
  drawingRevisionSnapshots,
  scopeDrafts,
  scopeSources,
  rfiCandidates,
  intakeForms,
  estimates,
  estimateDrafts,
  estimateItems,
  projectFiles,
  projectActuals,
  // PHASE 3 — field execution entities resolve back to their project
  fieldTasks,
  projectCostActuals,
  dailyLogs,
  projectCloseouts,
  // PHASE 4 — learning entities resolve back to their project when project-scoped
  calibrationEvents,
  calibrationReports,
  scopeCompletenessScores,
  type ProjectPermission,
} from "../drizzle/schema";

export type { ProjectPermission };

/** Project roles ordered from most to least privileged. */
export const PROJECT_ROLE_PERMISSIONS: Record<string, ProjectPermission[]> = {
  owner: ["read", "write", "approve", "delete"],
  manager: ["read", "write", "approve", "delete"],
  estimator: ["read", "write", "approve"],
  field: ["read", "write"],
  viewer: ["read"],
};

/** RBAC fallback: tenant-wide permission that grants a project-level action. */
const RBAC_EQUIVALENT: Record<ProjectPermission, { resource: string; action: string }> = {
  read: { resource: "project", action: "read" },
  write: { resource: "project", action: "write" },
  approve: { resource: "project", action: "approve" },
  delete: { resource: "project", action: "delete" },
};

export type ProjectAccessResult = {
  projectId: string;
  tenantId: string | null;
  /** How access was granted. */
  via: "admin" | "owner" | "member" | "tenant_rbac";
  projectRole: string | null;
  permissions: ProjectPermission[];
};

export class ProjectAccessError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "ProjectAccessError";
  }
}

function toTrpcError(error: ProjectAccessError): TRPCError {
  return new TRPCError({ code: error.code, message: error.message });
}

function normalizePermissions(raw: unknown): ProjectPermission[] {
  if (!Array.isArray(raw)) return [];
  const allowed: ProjectPermission[] = ["read", "write", "approve", "delete"];
  return raw.filter((p): p is ProjectPermission =>
    typeof p === "string" && (allowed as string[]).includes(p),
  );
}

function permissionsForRole(role: string | null | undefined): ProjectPermission[] {
  if (!role) return [];
  return PROJECT_ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Core guard. Throws `ProjectAccessError` (mapped to TRPCError by
 * `requireProjectAccessTrpc`) when access must be denied.
 */
export async function requireProjectAccess(
  projectId: string | null | undefined,
  userId: string | null | undefined,
  permission: ProjectPermission = "read",
): Promise<ProjectAccessResult> {
  if (!projectId) {
    throw new ProjectAccessError("BAD_REQUEST", "projectId is required");
  }
  if (!userId) {
    throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  }

  const db = await getDb();
  if (!db) {
    // Fail closed: no database means no way to prove authorization.
    throw new ProjectAccessError("FORBIDDEN", "Authorization store unavailable");
  }

  const [project] = await db
    .select({
      id: projects.id,
      tenantId: projects.tenantId,
      ownerUserId: projects.ownerUserId,
      deletedAt: projects.deletedAt,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new ProjectAccessError("NOT_FOUND", "Project not found");
  }

  const [user] = await db
    .select({
      id: profiles.id,
      tenantId: profiles.tenantId,
      role: profiles.role,
      isActive: profiles.isActive,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!user || user.isActive === false) {
    throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  }

  // 2. B2 caller axis: no resolved caller tenant, no business authorization.
  // A role is not a tenant; this runs before admin, owner and membership are consulted.
  if (!user.tenantId) {
    throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  }

  // 3. Tenant equality, required of EVERY caller including platform admins.
  // assertSameTenant() is the same primitive the data layer uses: false for a mismatch,
  // and (ROW axis, F15) true for a legacy tenant-less project while TENANT_STRICT is off.
  if (!assertSameTenant(project.tenantId, user.tenantId)) {
    throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  }

  // 4. Platform admin — now necessarily inside the caller's own tenant.
  if (user.role === "admin") {
    return {
      projectId: project.id,
      tenantId: project.tenantId,
      via: "admin",
      projectRole: "owner",
      permissions: PROJECT_ROLE_PERMISSIONS.owner,
    };
  }

  // 5. Project owner
  if (project.ownerUserId && project.ownerUserId === user.id) {
    return {
      projectId: project.id,
      tenantId: project.tenantId,
      via: "owner",
      projectRole: "owner",
      permissions: PROJECT_ROLE_PERMISSIONS.owner,
    };
  }

  // 6. Explicit membership
  const [membership] = await db
    .select({
      projectRole: projectMembers.projectRole,
      permissions: projectMembers.permissions,
      isActive: projectMembers.isActive,
    })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.userId, user.id),
      ),
    )
    .limit(1);

  if (membership && membership.isActive !== false) {
    const granted = new Set<ProjectPermission>([
      ...permissionsForRole(membership.projectRole),
      ...normalizePermissions(membership.permissions),
    ]);

    if (granted.has(permission)) {
      return {
        projectId: project.id,
        tenantId: project.tenantId,
        via: "member",
        projectRole: membership.projectRole,
        permissions: Array.from(granted),
      };
    }

    throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  }

  // 7. Tenant-wide RBAC permission
  const sameTenant =
    !!project.tenantId && !!user.tenantId && project.tenantId === user.tenantId;

  if (sameTenant) {
    const equivalent = RBAC_EQUIVALENT[permission];
    const allowed = await hasPermission(
      user.id,
      equivalent.resource,
      equivalent.action,
    );

    if (allowed) {
      return {
        projectId: project.id,
        tenantId: project.tenantId,
        via: "tenant_rbac",
        projectRole: null,
        permissions: [permission],
      };
    }
  }

  throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
}

/** tRPC-friendly wrapper: converts ProjectAccessError into TRPCError. */
export async function requireProjectAccessTrpc(
  projectId: string | null | undefined,
  userId: string | null | undefined,
  permission: ProjectPermission = "read",
): Promise<ProjectAccessResult> {
  try {
    return await requireProjectAccess(projectId, userId, permission);
  } catch (error) {
    if (error instanceof ProjectAccessError) throw toTrpcError(error);
    throw error;
  }
}

/**
 * Resolve the parent scope draft of a scope_draft_item.
 * Used by routes that receive an item id instead of the draft id.
 */
export async function getScopeDraftIdForItem(
  itemId: string | null | undefined,
): Promise<string | null> {
  if (!itemId) return null;

  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select({ scopeDraftId: scopeDraftItems.scopeDraftId })
    .from(scopeDraftItems)
    .where(eq(scopeDraftItems.id, itemId))
    .limit(1);

  return row?.scopeDraftId ?? null;
}

/** Non-throwing variant for conditional UI/logic. */
export async function canAccessProject(
  projectId: string | null | undefined,
  userId: string | null | undefined,
  permission: ProjectPermission = "read",
): Promise<boolean> {
  try {
    await requireProjectAccess(projectId, userId, permission);
    return true;
  } catch {
    return false;
  }
}

// ── Entity → projectId resolvers ─────────────────────────────────────
//
// Routes frequently receive a child identifier instead of a projectId. Each
// resolver maps that identifier back to its owning project so the same guard
// can be applied uniformly.

type ResolverTable =
  | "drawing"
  | "drawingRevision"
  | "scopeDraft"
  | "scopeSource"
  | "rfi"
  | "intakeForm"
  | "estimate"
  | "estimateDraft"
  | "estimateItem"
  | "projectFile"
  | "projectActual"
  // PHASE 3
  | "fieldTask"
  | "costActual"
  | "dailyLog"
  | "closeout"
  // PHASE 4
  | "calibrationEvent"
  | "calibrationReport"
  | "scopeCompleteness";

export async function resolveProjectIdFor(
  entity: ResolverTable,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;

  const db = await getDb();
  if (!db) return null;

  const pick = async <T extends { projectId: string | null }>(
    rows: Promise<T[]>,
  ): Promise<string | null> => {
    const [row] = await rows;
    return row?.projectId ?? null;
  };

  switch (entity) {
    case "drawing":
      return pick(
        db
          .select({ projectId: projectDrawings.projectId })
          .from(projectDrawings)
          .where(eq(projectDrawings.id, id))
          .limit(1),
      );
    case "drawingRevision":
      return pick(
        db
          .select({ projectId: drawingRevisionSnapshots.projectId })
          .from(drawingRevisionSnapshots)
          .where(eq(drawingRevisionSnapshots.id, id))
          .limit(1),
      );
    case "scopeDraft":
      return pick(
        db
          .select({ projectId: scopeDrafts.projectId })
          .from(scopeDrafts)
          .where(eq(scopeDrafts.id, id))
          .limit(1),
      );
    case "scopeSource":
      return pick(
        db
          .select({ projectId: scopeSources.projectId })
          .from(scopeSources)
          .where(eq(scopeSources.id, id))
          .limit(1),
      );
    case "rfi":
      return pick(
        db
          .select({ projectId: rfiCandidates.projectId })
          .from(rfiCandidates)
          .where(eq(rfiCandidates.id, id))
          .limit(1),
      );
    case "intakeForm":
      return pick(
        db
          .select({ projectId: intakeForms.projectId })
          .from(intakeForms)
          .where(eq(intakeForms.id, id))
          .limit(1),
      );
    case "estimate":
      return pick(
        db
          .select({ projectId: estimates.projectId })
          .from(estimates)
          .where(eq(estimates.id, id))
          .limit(1),
      );
    case "estimateDraft":
      return pick(
        db
          .select({ projectId: estimateDrafts.projectId })
          .from(estimateDrafts)
          .where(eq(estimateDrafts.id, id))
          .limit(1),
      );
    case "estimateItem":
      return pick(
        db
          .select({ projectId: estimateItems.projectId })
          .from(estimateItems)
          .where(eq(estimateItems.id, id))
          .limit(1),
      );
    case "projectFile":
      return pick(
        db
          .select({ projectId: projectFiles.projectId })
          .from(projectFiles)
          .where(eq(projectFiles.id, id))
          .limit(1),
      );
    case "projectActual":
      return pick(
        db
          .select({ projectId: projectActuals.projectId })
          .from(projectActuals)
          .where(eq(projectActuals.id, id))
          .limit(1),
      );
    // ── PHASE 3 ──────────────────────────────────────────────────────
    case "fieldTask":
      return pick(
        db
          .select({ projectId: fieldTasks.projectId })
          .from(fieldTasks)
          .where(eq(fieldTasks.id, id))
          .limit(1),
      );
    case "costActual":
      return pick(
        db
          .select({ projectId: projectCostActuals.projectId })
          .from(projectCostActuals)
          .where(eq(projectCostActuals.id, id))
          .limit(1),
      );
    case "dailyLog":
      return pick(
        db
          .select({ projectId: dailyLogs.projectId })
          .from(dailyLogs)
          .where(eq(dailyLogs.id, id))
          .limit(1),
      );
    case "closeout":
      return pick(
        db
          .select({ projectId: projectCloseouts.projectId })
          .from(projectCloseouts)
          .where(eq(projectCloseouts.id, id))
          .limit(1),
      );
    // ── PHASE 4 ──────────────────────────────────────────────────────
    //
    // A tenant-scoped calibration event has no project (CL-003) and therefore no project
    // guard: `pick` returns null and `requireEntityAccess` reports NOT_FOUND. Tenant-level
    // findings are read through `calibration.list`, which is guarded by tenant instead.
    case "calibrationEvent":
      return pick(
        db
          .select({ projectId: calibrationEvents.projectId })
          .from(calibrationEvents)
          .where(eq(calibrationEvents.id, id))
          .limit(1),
      );
    case "calibrationReport":
      return pick(
        db
          .select({ projectId: calibrationReports.projectId })
          .from(calibrationReports)
          .where(eq(calibrationReports.id, id))
          .limit(1),
      );
    case "scopeCompleteness":
      return pick(
        db
          .select({ projectId: scopeCompletenessScores.projectId })
          .from(scopeCompletenessScores)
          .where(eq(scopeCompletenessScores.id, id))
          .limit(1),
      );
    default:
      return null;
  }
}

/**
 * Guard for child entities: resolve the owning project, then enforce access.
 * A missing/unknown child id is reported as NOT_FOUND, never as "allowed".
 */
export async function requireEntityAccess(
  entity: ResolverTable,
  entityId: string | null | undefined,
  userId: string | null | undefined,
  permission: ProjectPermission = "read",
): Promise<ProjectAccessResult> {
  if (!entityId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${entity} id is required` });
  }

  const projectId = await resolveProjectIdFor(entity, entityId);

  if (!projectId) {
    throw new TRPCError({ code: "NOT_FOUND", message: `${entity} not found` });
  }

  return requireProjectAccessTrpc(projectId, userId, permission);
}
