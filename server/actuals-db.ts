/**
 * structr.ai — PHASE 3 Actuals Persistence
 *
 * Preserves the real-cost ledger and existing reductive actions. A1 internal approval
 * does not authorize new cost capture, commitment, payment or budget comparisons.
 *
 * Existing ledger facts retain their original costs and status evidence. A1 holds
 * capture/approval/payment; only valid rejection, void, noncommitted soft delete and
 * variance annotations remain. Ledger refresh cannot infer an operational budget.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { holdExecutionOperation } from "@shared/execution-authority";
import {
  requireProjectAccess,
  ProjectAccessError,
  type ProjectPermission,
} from "./project-access";
import type { AuthTransaction } from "./auth-transaction";
import { assertScopedCalculatedEstimateLineage } from "./historical-estimate-guard";
import {
  costCodes,
  estimateDrafts,
  estimateItems,
  fieldTasks,
  assemblies,
  subcontractors,
  projectCostActuals,
  projects,
  type ProjectCostActual,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import { assertSameTenant } from "./tenant-scope";
import {
  evaluateActualTransition,
  formatCents,
  resolveActualStatus,
  type BudgetLine,
  type ProjectBudget,
  type ProjectVarianceSnapshot,
} from "@shared/actuals-variance-engine";
import {
  DEFAULT_VARIANCE_THRESHOLD_PCT,
  isActualCommitted,
  normalizeActualStatus,
  type ActualStatus,
} from "@shared/domain/phase3-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type ActualsErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "ACTUAL_NOT_FOUND"
  | "NO_APPROVED_ESTIMATE"
  | "COST_CODE_REQUIRED"
  | "INVALID_AMOUNT"
  | "INVALID_ACTUAL_TRANSITION"
  | "ACTUAL_VALIDATION_FAILED"
  | "DUPLICATE_INVOICE"
  | "CHANGE_ORDER_NOT_APPROVED"
  | "REFERENCE_NOT_AVAILABLE"
  | "TASK_NOT_FOUND";

export class ActualsError extends Error {
  public readonly code: ActualsErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    code: ActualsErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ActualsError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Read the project's variance tolerance, falling back to the contract default. */
export async function getProjectVarianceThreshold(
  projectId: string
): Promise<number> {
  const db = await getDb();
  if (!db) return DEFAULT_VARIANCE_THRESHOLD_PCT;

  const [row] = await db
    .select({ threshold: projects.varianceThresholdPct })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const parsed = row?.threshold != null ? Number(row.threshold) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_VARIANCE_THRESHOLD_PCT;
}

// ══════════════════════════════════════════════════════════════════════
// CREATE (AC-001 … AC-003)
// ══════════════════════════════════════════════════════════════════════

export interface RecordActualInput {
  projectId: string;
  userId: string;
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  costCodeId?: string | null;
  costCode?: string | null;
  costCodeName?: string | null;
  category?: string | null;
  description?: string | null;
  /** Real cost. Provide either integer cents or a dollar amount. */
  amountCents?: number | null;
  amount?: number | string | null;
  /** Legacy input accepted for compatibility; never used as budget authority. */
  estimatedAmountCents?: number | null;
  quantity?: number | null;
  unit?: string | null;
  laborHours?: number | null;
  vendorName?: string | null;
  subcontractorId?: string | null;
  invoiceRef?: string | null;
  invoiceDate?: string | null;
  dateIncurred?: string | null;
  fieldTaskId?: string | null;
  estimateItemId?: string | null;
  assemblyId?: string | null;
  /** When present, the cost belongs to this approved change order. */
  changeOrderId?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
  status?: string | null;
  today?: string;
}

/**
 * Record a real cost against a project.
 *
 * Current DeliveryActuals capture is unavailable until execution authority exists.
 */
export async function recordActual(
  input: RecordActualInput
): Promise<ProjectCostActual> {
  const db = await getDb();
  if (!db) throw new ActualsError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(
    async tx => {
      await requireProjectAccess(input.projectId, input.userId, "write", {
        mode: "a1",
        transaction: tx,
        expectedTenantId: input.tenantId,
      });
      // Preserve existing reference isolation before applying the blanket execution hold.
      if (input.changeOrderId) {
        const [row] = await tx
          .select()
          .from(estimateDrafts)
          .where(eq(estimateDrafts.id, input.changeOrderId))
          .limit(1)
          .for("share");

        if (
          !row ||
          row.projectId !== input.projectId ||
          !assertSameTenant(row.tenantId, input.tenantId) ||
          row.status !== "approved" ||
          !row.approvedAt ||
          row.supersededBy ||
          !row.changeOrderOf
        ) {
          throw new ActualsError(
            "CHANGE_ORDER_NOT_APPROVED",
            "The change order is not an authorized approval for this project."
          );
        }
        const [parent] = await tx
          .select()
          .from(estimateDrafts)
          .where(eq(estimateDrafts.id, row.changeOrderOf))
          .limit(1)
          .for("share");
        if (
          !parent ||
          parent.projectId !== input.projectId ||
          !assertSameTenant(parent.tenantId, input.tenantId)
        ) {
          throw new ActualsError(
            "CHANGE_ORDER_NOT_APPROVED",
            "The change order has no authorized parent estimate for this project."
          );
        }
        await assertActualReference(
          tx,
          row.id,
          input.projectId,
          input.tenantId
        );
        await assertActualReference(
          tx,
          parent.id,
          input.projectId,
          input.tenantId
        );
      }

      if (input.fieldTaskId) {
        const [task] = await tx
          .select()
          .from(fieldTasks)
          .where(eq(fieldTasks.id, input.fieldTaskId))
          .limit(1)
          .for("share");

        if (
          !task ||
          task.projectId !== input.projectId ||
          task.deletedAt ||
          !assertSameTenant(task.tenantId, input.tenantId) ||
          (task.changeOrderId ?? null) !== (input.changeOrderId ?? null)
        ) {
          throw new ActualsError(
            "REFERENCE_NOT_AVAILABLE",
            "The field task is unavailable for this project and cost scope."
          );
        }
        await assertActualReference(
          tx,
          task.budgetEstimateDraftId,
          input.projectId,
          input.tenantId
        );
        await assertActualReference(
          tx,
          task.changeOrderId,
          input.projectId,
          input.tenantId
        );
      }

      if (input.estimateItemId) {
        const [item] = await tx
          .select()
          .from(estimateItems)
          .where(eq(estimateItems.id, input.estimateItemId))
          .limit(1)
          .for("share");
        if (
          !item ||
          item.projectId !== input.projectId ||
          !assertSameTenant(item.tenantId, input.tenantId)
        ) {
          throw new ActualsError(
            "REFERENCE_NOT_AVAILABLE",
            "The estimate item is unavailable for this project."
          );
        }
      }
      if (input.assemblyId) {
        const [assembly] = await tx
          .select()
          .from(assemblies)
          .where(eq(assemblies.id, input.assemblyId))
          .limit(1)
          .for("share");
        if (
          !assembly ||
          !assembly.isActive ||
          !assertSameTenant(assembly.tenantId, input.tenantId)
        ) {
          throw new ActualsError(
            "REFERENCE_NOT_AVAILABLE",
            "The assembly is unavailable for this tenant."
          );
        }
      }
      if (input.subcontractorId) {
        const [subcontractor] = await tx
          .select()
          .from(subcontractors)
          .where(eq(subcontractors.id, input.subcontractorId))
          .limit(1)
          .for("share");
        if (
          !subcontractor ||
          subcontractor.deletedAt ||
          !assertSameTenant(subcontractor.tenantId, input.tenantId)
        ) {
          throw new ActualsError(
            "REFERENCE_NOT_AVAILABLE",
            "The subcontractor is unavailable for this tenant."
          );
        }
      }

      // The caller cannot substitute a catalog ID from another tenant or code.
      const costCode = input.costCode?.trim() || null;
      if (input.costCodeId) {
        const [code] = await tx
          .select()
          .from(costCodes)
          .where(eq(costCodes.id, input.costCodeId))
          .limit(1)
          .for("share");
        if (
          !code ||
          !code.isActive ||
          !assertSameTenant(code.tenantId, input.tenantId) ||
          (costCode && costCode.toLowerCase() !== code.code.toLowerCase())
        ) {
          throw new ActualsError(
            "REFERENCE_NOT_AVAILABLE",
            "The cost code is unavailable or inconsistent with its catalog ID."
          );
        }
      }

      // Neither a legacy approval nor an internal estimate decision authorizes DeliveryActuals.
      return holdExecutionOperation("record actual");
    },
    { isolationLevel: "serializable" }
  );
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Load one actual. */
export async function getActual(id: string): Promise<ProjectCostActual | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(projectCostActuals)
    .where(eq(projectCostActuals.id, id))
    .limit(1);

  return row ?? null;
}

export interface ListActualsOptions {
  projectId: string;
  status?: ActualStatus | ActualStatus[];
  costCode?: string;
  costCodeId?: string;
  subcontractorId?: string;
  fieldTaskId?: string;
  changeOrderId?: string;
  /** When true, only actuals from the original scope (no change order). */
  baselineOnly?: boolean;
  severity?: string;
  limit?: number;
  offset?: number;
}

/** List actuals of a project. */
export async function listActuals(
  opts: ListActualsOptions
): Promise<{ actuals: ProjectCostActual[]; total: number }> {
  const db = await getDb();
  if (!db) return { actuals: [], total: 0 };

  const conditions = [
    eq(projectCostActuals.projectId, opts.projectId),
    isNull(projectCostActuals.deletedAt),
  ];

  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    if (statuses.length > 0)
      conditions.push(inArray(projectCostActuals.status, statuses));
  }
  if (opts.costCode)
    conditions.push(eq(projectCostActuals.costCode, opts.costCode));
  if (opts.costCodeId)
    conditions.push(eq(projectCostActuals.costCodeId, opts.costCodeId));
  if (opts.subcontractorId) {
    conditions.push(
      eq(projectCostActuals.subcontractorId, opts.subcontractorId)
    );
  }
  if (opts.fieldTaskId)
    conditions.push(eq(projectCostActuals.fieldTaskId, opts.fieldTaskId));
  if (opts.changeOrderId)
    conditions.push(eq(projectCostActuals.changeOrderId, opts.changeOrderId));
  if (opts.baselineOnly)
    conditions.push(isNull(projectCostActuals.changeOrderId));
  if (opts.severity)
    conditions.push(eq(projectCostActuals.varianceSeverity, opts.severity));

  const rows = await db
    .select()
    .from(projectCostActuals)
    .where(and(...conditions))
    .orderBy(
      desc(projectCostActuals.dateIncurred),
      desc(projectCostActuals.createdAt)
    )
    .limit(opts.limit ?? 500)
    .offset(opts.offset ?? 0);

  return { actuals: rows, total: rows.length };
}

/** Actuals booked against a subcontractor across projects (performance input). */
export async function listActualsForSubcontractor(
  subcontractorId: string,
  limit = 1000
): Promise<ProjectCostActual[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.subcontractorId, subcontractorId),
        isNull(projectCostActuals.deletedAt)
      )
    )
    .orderBy(desc(projectCostActuals.dateIncurred))
    .limit(limit);
}

// ══════════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS (AC-004)
// ══════════════════════════════════════════════════════════════════════

export interface TransitionActualInput {
  tenantId: string;
  actualId: string;
  userId: string;
  to: ActualStatus | string;
  reason?: string | null;
}

async function assertActualReference(
  tx: AuthTransaction,
  draftId: string | null | undefined,
  projectId: string,
  tenantId: string
): Promise<void> {
  return assertScopedCalculatedEstimateLineage(tx, draftId, {
    projectId,
    tenantId,
    action: "mutate actual",
    invalid: message => {
      throw new ActualsError("REFERENCE_NOT_AVAILABLE", message);
    },
  });
}

/** Lock project before ledger row and revalidate identity under the writer's ACL snapshot. */
async function withActualMutation<T>(
  input: { actualId: string; userId: string; tenantId: string },
  permission: ProjectPermission,
  mutate: (tx: AuthTransaction, before: ProjectCostActual) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new ActualsError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(
    async tx => {
      const [identity] = await tx
        .select()
        .from(projectCostActuals)
        .where(eq(projectCostActuals.id, input.actualId))
        .limit(1);
      if (!identity)
        throw new ActualsError("ACTUAL_NOT_FOUND", "Actual not found");
      await requireProjectAccess(identity.projectId, input.userId, permission, {
        mode: "a1",
        transaction: tx,
        expectedTenantId: input.tenantId,
      });
      const [before] = await tx
        .select()
        .from(projectCostActuals)
        .where(eq(projectCostActuals.id, input.actualId))
        .limit(1)
        .for("update");
      if (
        !before ||
        before.deletedAt ||
        before.projectId !== identity.projectId ||
        before.tenantId !== input.tenantId
      ) {
        throw new ProjectAccessError(
          "FORBIDDEN",
          "Actual is unavailable for this project."
        );
      }
      await assertActualReference(
        tx,
        before.budgetEstimateDraftId,
        before.projectId,
        input.tenantId
      );
      await assertActualReference(
        tx,
        before.changeOrderId,
        before.projectId,
        input.tenantId
      );
      return mutate(tx, before);
    },
    { isolationLevel: "serializable" }
  );
}

function assertActualMutationFields(
  input: object,
  allowed: readonly string[]
): void {
  if (
    Object.entries(input).some(
      ([key, value]) => value !== undefined && !allowed.includes(key)
    )
  ) {
    holdExecutionOperation(
      "change operational values through an actual reduction or note"
    );
  }
}

/** Move an actual through its lifecycle. */
export async function transitionActual(
  input: TransitionActualInput
): Promise<ProjectCostActual> {
  return withActualMutation(input, "approve", async (tx, before) => {
    assertActualMutationFields(input, [
      "actualId",
      "userId",
      "tenantId",
      "to",
      "reason",
    ]);
    const from = normalizeActualStatus(before.status);
    const to = normalizeActualStatus(input.to);
    if (!from || !to)
      throw new ActualsError(
        "INVALID_ACTUAL_TRANSITION",
        "Invalid actual status."
      );
    if (to !== "rejected" && to !== "void")
      return holdExecutionOperation(`mark actual ${to}`);
    const evaluation = evaluateActualTransition(from, to);
    if (!evaluation.allowed)
      throw new ActualsError(
        "INVALID_ACTUAL_TRANSITION",
        evaluation.violations[0].message,
        { from, to }
      );
    if (
      !input.reason ||
      input.reason.trim().length < 5 ||
      input.reason.length > 2000
    ) {
      throw new ActualsError(
        "ACTUAL_VALIDATION_FAILED",
        "A reason between 5 and 2000 characters is required."
      );
    }
    const now = new Date();
    const patch = {
      status: to,
      updatedBy: input.userId,
      updatedAt: now,
      ...(to === "rejected"
        ? {
            rejectedBy: input.userId,
            rejectedAt: now,
            rejectionReason: input.reason,
          }
        : { voidReason: input.reason }),
    };
    await tx
      .update(projectCostActuals)
      .set(patch)
      .where(eq(projectCostActuals.id, before.id));
    await logAudit(
      {
        userId: input.userId,
        action: `actual.${to}`,
        tableName: "project_cost_actuals",
        recordId: before.id,
        before,
        after: { ...before, ...patch },
      },
      tx
    );
    await refreshCommittedLedger(
      tx,
      before.projectId,
      input.userId,
      input.tenantId
    );
    return { ...before, ...patch };
  });
}

/** Register the human review of a critical/unbudgeted variance (CO-003). */
export async function reviewActualVariance(input: {
  actualId: string;
  userId: string;
  tenantId: string;
  varianceReason: string;
}): Promise<ProjectCostActual> {
  return withActualMutation(input, "approve", async (tx, before) => {
    assertActualMutationFields(input, [
      "actualId",
      "userId",
      "tenantId",
      "varianceReason",
    ]);
    if (
      !input.varianceReason ||
      input.varianceReason.trim().length < 10 ||
      input.varianceReason.length > 2000
    ) {
      throw new ActualsError(
        "ACTUAL_VALIDATION_FAILED",
        "A variance note between 10 and 2000 characters is required."
      );
    }
    const now = new Date();
    const patch = {
      varianceReviewed: true,
      varianceReviewedBy: input.userId,
      varianceReviewedAt: now,
      varianceReason: input.varianceReason,
      updatedBy: input.userId,
      updatedAt: now,
    };
    await tx
      .update(projectCostActuals)
      .set(patch)
      .where(eq(projectCostActuals.id, before.id));
    await logAudit(
      {
        userId: input.userId,
        action: "actual.variance_reviewed",
        tableName: "project_cost_actuals",
        recordId: before.id,
        before,
        after: { ...before, ...patch },
      },
      tx
    );
    return { ...before, ...patch };
  });
}

/** Soft delete an actual. Committed cost must be voided, never erased. */
export async function deleteActual(
  actualId: string,
  userId: string,
  tenantId: string
): Promise<boolean> {
  return withActualMutation(
    { actualId, userId, tenantId },
    "delete",
    async (tx, before) => {
      const status = normalizeActualStatus(before.status);
      if (!status)
        throw new ActualsError(
          "INVALID_ACTUAL_TRANSITION",
          "Unknown actual state requires reconciliation before deletion."
        );
      if (isActualCommitted(status))
        throw new ActualsError(
          "INVALID_ACTUAL_TRANSITION",
          "Committed cost cannot be deleted; use an allowed void transition.",
          { status }
        );
      const patch = {
        deletedAt: new Date(),
        updatedBy: userId,
        updatedAt: new Date(),
      };
      await tx
        .update(projectCostActuals)
        .set(patch)
        .where(eq(projectCostActuals.id, before.id));
      await logAudit(
        {
          userId,
          action: "actual.deleted",
          tableName: "project_cost_actuals",
          recordId: before.id,
          before,
          after: { ...before, ...patch },
        },
        tx
      );
      await refreshCommittedLedger(tx, before.projectId, userId, tenantId);
      return true;
    }
  );
}

// ══════════════════════════════════════════════════════════════════════
// BUDGET + VARIANCE AGGREGATION
// ══════════════════════════════════════════════════════════════════════

/** No legacy estimate or internal decision supplies operational budget authority. */
export async function getProjectBudgetLines(
  _projectId: string
): Promise<BudgetLine[]> {
  return holdExecutionOperation("getProjectBudgetLines");
}

/**
 * Build the variance snapshot of a project.
 *
 * The internal signature is retained; callers must translate the typed availability error.
 */
export async function getVarianceSnapshot(
  _projectId: string
): Promise<ProjectVarianceSnapshot> {
  return holdExecutionOperation("getVarianceSnapshot");
}

/** Compute the project's available budget. */
export async function getProjectBudget(
  _projectId: string
): Promise<ProjectBudget> {
  return holdExecutionOperation("getProjectBudget");
}

/** Persist the project's committed cost so dashboards do not need to aggregate on read. */
export async function refreshProjectCommittedCost(
  projectId: string,
  userId: string,
  tenantId: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new ActualsError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(
    async tx => {
      await requireProjectAccess(projectId, userId, "approve", {
        mode: "a1",
        transaction: tx,
        expectedTenantId: tenantId,
      });
      return refreshCommittedLedger(tx, projectId, userId, tenantId);
    },
    { isolationLevel: "serializable" }
  );
}

async function refreshCommittedLedger(
  tx: AuthTransaction,
  projectId: string,
  userId: string,
  tenantId: string
): Promise<number> {
  const [before] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!before || before.deletedAt || before.tenantId !== tenantId)
    throw new ProjectAccessError("FORBIDDEN", "Project unavailable.");
  // No page limit: the cache reflects all committed, nondeleted ledger facts.
  const actuals = await tx
    .select()
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.projectId, projectId),
        isNull(projectCostActuals.deletedAt)
      )
    );
  if (actuals.some(row => row.tenantId !== tenantId))
    throw new ProjectAccessError(
      "FORBIDDEN",
      "Ledger tenant identity is inconsistent."
    );
  let committedCents = 0;
  for (const row of actuals) {
    const status = normalizeActualStatus(row.status);
    if (!status)
      throw new ActualsError(
        "ACTUAL_VALIDATION_FAILED",
        "Ledger contains an unknown status and requires reconciliation."
      );
    if (isActualCommitted(status)) committedCents += row.amountCents;
  }
  const patch = {
    committedCostCents: committedCents,
    actualTotal: formatCents(committedCents),
    variancePct: null,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await tx.update(projects).set(patch).where(eq(projects.id, projectId));
  await logAudit(
    {
      userId,
      action: "project.actuals_refreshed",
      tableName: "projects",
      recordId: projectId,
      before: {
        committedCostCents: before.committedCostCents,
        actualTotal: before.actualTotal,
        variancePct: before.variancePct,
      },
      after: {
        committedCostCents: patch.committedCostCents,
        actualTotal: patch.actualTotal,
        variancePct: null,
      },
    },
    tx
  );
  return committedCents;
}

/** Count of actuals still pending approval — a closeout blocker (CO-003). */
export async function countPendingActuals(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.projectId, projectId),
        eq(projectCostActuals.status, "pending"),
        isNull(projectCostActuals.deletedAt)
      )
    );

  return Number(rows[0]?.count ?? 0);
}

/** Committed actuals whose variance requires review and has not been reviewed (CO-003). */
export async function listUnreviewedVarianceActuals(
  projectId: string
): Promise<ProjectCostActual[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.projectId, projectId),
        eq(projectCostActuals.varianceReviewed, false),
        inArray(projectCostActuals.varianceSeverity, [
          "critical",
          "unbudgeted",
        ]),
        isNull(projectCostActuals.deletedAt)
      )
    )
    .orderBy(asc(projectCostActuals.createdAt));

  return rows.filter(r => isActualCommitted(resolveActualStatus(r.status)));
}

/** Cost totals grouped by category, for the field cost dashboard. */
export async function getActualsByCategory(
  projectId: string
): Promise<Array<{ category: string; amountCents: number; count: number }>> {
  const { actuals } = await listActuals({ projectId, limit: 2000 });
  const grouped = new Map<string, { amountCents: number; count: number }>();

  for (const actual of actuals) {
    if (!isActualCommitted(resolveActualStatus(actual.status))) continue;
    const key = actual.category ?? "other";
    const bucket = grouped.get(key) ?? { amountCents: 0, count: 0 };
    bucket.amountCents += actual.amountCents;
    bucket.count += 1;
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amountCents - a.amountCents);
}
