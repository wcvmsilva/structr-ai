/** Transaction boundaries for existing generic estimate edits, not approval authority. */
import { and, eq } from "drizzle-orm";
import {
  estimateDrafts,
  projects,
  tenants,
  profiles,
  estimateInternalApprovalSnapshots,
  estimateInternalApprovals,
  type EstimateDraft,
} from "../drizzle/schema";
import { INTERNAL_APPROVAL_SOURCES, INTERNAL_APPROVAL_STATUSES } from "../shared/domain/taxonomy";
import type { AuthTransaction } from "./auth-transaction";
import { requireProjectAccess, type ProjectPermission } from "./project-access";
import { withInternalApprovalTransaction } from "./internal-estimate-approval-db";
import { InternalApprovalAuditFailure } from "./internal-estimate-approval-errors";
import { assertNotHistoricalEstimateDraft } from "./historical-estimate-guard";
import { logAudit, type AuditLogParams } from "./audit";
import { EstimateGuardError } from "./estimate-guard-error";

function unresolved(): never {
  throw new EstimateGuardError(
    "ESTIMATE_CONTEXT_UNRESOLVED",
    "An active account, company and matching project are required to edit this estimate."
  );
}
function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value
    ) &&
    value !== "00000000-0000-0000-0000-000000000000"
  );
}

/** No active-client requirement: this operation never changes project/client identity. */
export async function withEstimateMutation<T>(
  id: string,
  userId: string,
  tenantId: string,
  permission: ProjectPermission,
  work: (tx: AuthTransaction, current: EstimateDraft) => Promise<T>
): Promise<T> {
  if (!validId(id) || !validId(userId) || !validId(tenantId)) unresolved();
  return withInternalApprovalTransaction(async tx => {
    const [locator] = await tx
      .select({ projectId: estimateDrafts.projectId })
      .from(estimateDrafts)
      .where(
        and(eq(estimateDrafts.id, id), eq(estimateDrafts.tenantId, tenantId))
      )
      .limit(1);
    if (!locator || !validId(locator.projectId)) unresolved();
    const [project] = await tx
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, locator.projectId), eq(projects.tenantId, tenantId))
      )
      .for("update");
    if (!project || project.tenantId !== tenantId || project.deletedAt !== null)
      unresolved();
    const [current] = await tx
      .select()
      .from(estimateDrafts)
      .where(
        and(eq(estimateDrafts.id, id), eq(estimateDrafts.tenantId, tenantId))
      )
      .for("update");
    if (
      !current ||
      current.tenantId !== tenantId ||
      current.projectId !== project.id
    )
      unresolved();
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for("share");
    const [profile] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .for("share");
    if (
      !tenant ||
      tenant.isActive !== true ||
      !profile ||
      profile.tenantId !== tenantId ||
      profile.isActive !== true
    )
      unresolved();
    await requireProjectAccess(project.id, userId, permission, {
      mode: "a1",
      transaction: tx,
      expectedTenantId: tenantId,
    });
    return work(tx, current);
  });
}

/** Any durable decision evidence locks generic financial/status edits, even with a forged status. */
export async function assertEstimateUndecided(
  tx: AuthTransaction,
  current: EstimateDraft
): Promise<void> {
  const [snapshot] = await tx
    .select({ id: estimateInternalApprovalSnapshots.id })
    .from(estimateInternalApprovalSnapshots)
    .where(eq(estimateInternalApprovalSnapshots.estimateDraftId, current.id))
    .limit(1)
    .for("share");
  const [approval] = await tx
    .select({ id: estimateInternalApprovals.id })
    .from(estimateInternalApprovals)
    .where(eq(estimateInternalApprovals.estimateDraftId, current.id))
    .limit(1)
    .for("share");
  if (
    snapshot ||
    approval ||
    INTERNAL_APPROVAL_STATUSES.some(status => current.status === status)
  ) {
    throw new EstimateGuardError(
      "ESTIMATE_VERSION_LOCKED",
      "A decided estimate cannot be changed through a generic status or financial edit."
    );
  }
}

/** Both derivation edges remain capture-only when any ancestor is historical. */
export async function assertEstimateNonHistoricalLineage(
  tx: AuthTransaction,
  current: EstimateDraft,
  options: { requireCalculatedSources?: boolean } = {},
): Promise<void> {
  const found = new Map<string, EstimateDraft>([[current.id, current]]);
  const complete = new Set<string>();
  async function visit(id: string, path: Set<string>): Promise<void> {
    if (!validId(id) || path.has(id)) unresolved();
    if (complete.has(id)) return;
    let row = found.get(id);
    if (!row) {
      if (found.size >= 1000) unresolved();
      const [parent] = await tx
        .select()
        .from(estimateDrafts)
        .where(eq(estimateDrafts.id, id))
        .limit(1);
      if (!parent) unresolved();
      row = parent;
      found.set(id, row);
    }
    if (
      row.tenantId !== current.tenantId ||
      row.projectId !== current.projectId ||
      row.clientId !== current.clientId
    )
      unresolved();
    await assertNotHistoricalEstimateDraft(
      tx,
      row,
      "change estimate status or financial content"
    );
    if (options.requireCalculatedSources && !INTERNAL_APPROVAL_SOURCES.some(source => source === row.source)) unresolved();
    if (
      (row.source === "version" && !row.supersedesId) ||
      (row.source === "change_order" && !row.changeOrderOf)
    )
      unresolved();
    const next = new Set(path);
    next.add(id);
    for (const parent of new Set([row.supersedesId, row.changeOrderOf]))
      if (parent) await visit(parent, next);
    complete.add(id);
  }
  await visit(current.id, new Set());
}

/** Audit errors, including transient SQLSTATEs, must never trigger business retries. */
export async function auditEstimateMutation(
  tx: AuthTransaction,
  params: AuditLogParams
): Promise<void> {
  try {
    if (!(await logAudit(params, tx)))
      throw new Error("Estimate audit returned no evidence");
  } catch (error) {
    throw new InternalApprovalAuditFailure(error);
  }
}
