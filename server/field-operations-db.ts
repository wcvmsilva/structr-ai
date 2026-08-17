/**
 * structr.ai — PHASE 3 Field Operations Persistence
 *
 * Persists the field execution layer of docs/phase3-contract.md §3 and §7. All decision
 * logic lives in shared/field-operations-engine.ts; this module only stores, transitions,
 * reads and audits.
 *
 * Invariants enforced here:
 *   FO-001  a task can only exist for a project with an approved estimate
 *   FO-002  an assigned task always has a responsible party
 *   FO-003  actual dates are recorded on start and completion
 *   FO-004  verification records the verifying user
 *   FO-005  a blocked task always carries a reason
 *   FO-006  verified/cancelled are terminal
 *   §7      change-order tasks are idempotent by (project_id, source_key)
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import {
  estimateDrafts,
  fieldTaskEvents,
  fieldTasks,
  projects,
  subcontractors,
  type EstimateDraft,
  type EstimateDraftLineItem,
  type FieldTask,
  type FieldTaskEvent,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import {
  assessSchedule,
  changeOrderTaskKey,
  deriveFieldTasksFromChangeOrder,
  evaluateTransition,
  summarizeFieldProgress,
  validateAssignment,
  type FieldProgressSummary,
  type FieldTaskAssignment,
  type ScheduleAssessment,
} from "@shared/field-operations-engine";
import {
  normalizeFieldTaskStatus,
  normalizeFieldTaskType,
  normalizeAssigneeType,
  type FieldAssigneeType,
  type FieldTaskSource,
  type FieldTaskStatus,
  type FieldTaskType,
} from "@shared/domain/phase3-taxonomy";
import { assessCompliance, evaluateAssignmentEligibility } from "@shared/subcontractor-performance-engine";
import { toCents } from "@shared/actuals-variance-engine";
import { withTenant } from "./tenant-scope";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type FieldOpsErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "NO_APPROVED_ESTIMATE"
  | "INVALID_TASK_TYPE"
  | "INVALID_ASSIGNMENT"
  | "INVALID_TASK_TRANSITION"
  | "BLOCK_REASON_REQUIRED"
  | "SUBCONTRACTOR_NOT_FOUND"
  | "SUBCONTRACTOR_NOT_ELIGIBLE"
  | "CHANGE_ORDER_NOT_APPROVED";

export class FieldOpsError extends Error {
  public readonly code: FieldOpsErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: FieldOpsErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FieldOpsError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// APPROVED ESTIMATE RESOLUTION (FO-001)
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve the approved estimate that a project executes against.
 *
 * Deliberately excludes change orders and superseded approvals: the budget baseline is the
 * live approved version of the original scope, exactly like the JobTread export gate.
 */
export async function getProjectBudgetEstimate(
  projectId: string,
): Promise<EstimateDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(estimateDrafts)
    .where(
      and(
        eq(estimateDrafts.projectId, projectId),
        eq(estimateDrafts.status, "approved"),
        isNull(estimateDrafts.supersededBy),
        isNull(estimateDrafts.changeOrderOf),
      ),
    )
    .orderBy(desc(estimateDrafts.version));

  return rows[0] ?? null;
}

/** Approved change orders of a project, ordered by creation. */
export async function listApprovedChangeOrders(
  projectId: string,
): Promise<EstimateDraft[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(estimateDrafts)
    .where(and(eq(estimateDrafts.projectId, projectId), eq(estimateDrafts.status, "approved")))
    .orderBy(asc(estimateDrafts.version));

  return rows.filter((r) => !!r.changeOrderOf);
}

// ══════════════════════════════════════════════════════════════════════
// CREATE
// ══════════════════════════════════════════════════════════════════════

export interface CreateFieldTaskInput {
  projectId: string;
  userId: string;
  tenantId?: string | null;
  taskType: string;
  title: string;
  description?: string | null;
  source?: FieldTaskSource;
  sequence?: number;
  costCodeId?: string | null;
  costCode?: string | null;
  assemblyId?: string | null;
  estimateItemId?: string | null;
  quantity?: number | null;
  unit?: string | null;
  budgetedCostCents?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  plannedHours?: number | null;
  requiresInspection?: boolean;
  notes?: string | null;
  changeOrderId?: string | null;
  sourceKey?: string | null;
  /** Optional immediate assignment. */
  assigneeType?: string | null;
  subcontractorId?: string | null;
  assigneeName?: string | null;
  assignedUserId?: string | null;
  /** Injected date for deterministic tests. */
  today?: string;
}

function todayIso(explicit?: string): string {
  return explicit ?? new Date().toISOString().slice(0, 10);
}

/**
 * Create a field task.
 *
 * The approved estimate is resolved server-side and stamped on the row: trusting a
 * client-declared budget id would let field work point at an estimate the client never
 * approved.
 */
export async function createFieldTask(input: CreateFieldTaskInput): Promise<FieldTask> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new FieldOpsError("PROJECT_NOT_FOUND", `Project ${input.projectId} not found`, {
      projectId: input.projectId,
    });
  }

  const taskType = normalizeFieldTaskType(input.taskType);
  if (!taskType) {
    throw new FieldOpsError(
      "INVALID_TASK_TYPE",
      `"${input.taskType}" is not a known field task type.`,
      { taskType: input.taskType },
    );
  }

  const budget = await getProjectBudgetEstimate(input.projectId);
  if (!budget) {
    throw new FieldOpsError(
      "NO_APPROVED_ESTIMATE",
      `Project ${input.projectId} has no approved estimate. Field work cannot start against unapproved money (FO-001).`,
      { projectId: input.projectId },
    );
  }

  // Optional immediate assignment goes through the same rules as `assignFieldTask`.
  let assignment: FieldTaskAssignment | null = null;
  if (input.assigneeType) {
    assignment = {
      assigneeType: normalizeAssigneeType(input.assigneeType),
      subcontractorId: input.subcontractorId ?? null,
      assigneeName: input.assigneeName ?? null,
      assignedUserId: input.assignedUserId ?? null,
    };
    const violations = validateAssignment(assignment);
    if (violations.length > 0) {
      throw new FieldOpsError("INVALID_ASSIGNMENT", violations[0].message, { violations });
    }
    if (assignment.subcontractorId) {
      await assertSubcontractorEligible(assignment.subcontractorId, todayIso(input.today));
    }
  }

  const now = new Date();
  const id = randomUUID();
  const tenantId = input.tenantId ?? project.tenantId ?? null;

  const values = withTenant(
    {
      id,
      projectId: input.projectId,
      budgetEstimateDraftId: budget.id,
      changeOrderId: input.changeOrderId ?? null,
      sourceKey: input.sourceKey ?? null,
      source: input.source ?? (input.changeOrderId ? "change_order" : "manual"),
      taskType,
      title: input.title,
      description: input.description ?? null,
      status: (assignment ? "assigned" : "pending") as FieldTaskStatus,
      sequence: input.sequence ?? 0,
      costCodeId: input.costCodeId ?? null,
      costCode: input.costCode ?? null,
      assemblyId: input.assemblyId ?? null,
      estimateItemId: input.estimateItemId ?? null,
      quantity: input.quantity != null ? String(input.quantity) : null,
      unit: input.unit ?? null,
      budgetedCostCents: input.budgetedCostCents ?? null,
      assigneeType: assignment?.assigneeType ?? null,
      subcontractorId: assignment?.subcontractorId ?? null,
      assigneeName: assignment?.assigneeName ?? null,
      assignedUserId: assignment?.assignedUserId ?? null,
      assignedAt: assignment ? now : null,
      assignedBy: assignment ? input.userId : null,
      plannedStartDate: input.plannedStartDate ?? null,
      plannedEndDate: input.plannedEndDate ?? null,
      plannedHours: input.plannedHours != null ? String(input.plannedHours) : null,
      requiresInspection: input.requiresInspection ?? false,
      notes: input.notes ?? null,
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    },
    tenantId,
  );

  await db.transaction(async (tx) => {
    await tx.insert(fieldTasks).values(values as never);

    await tx.insert(fieldTaskEvents).values(
      withTenant(
        {
          id: randomUUID(),
          projectId: input.projectId,
          fieldTaskId: id,
          fromStatus: null,
          toStatus: values.status as string,
          reason: "task created",
          actorId: input.userId,
          payload: { taskType, source: values.source, budgetEstimateDraftId: budget.id },
          createdAt: now,
        },
        tenantId,
      ) as never,
    );

    // The project enters field execution the first time a task exists.
    if (!project.fieldStartedAt) {
      await tx
        .update(projects)
        .set({ fieldStartedAt: now, updatedBy: input.userId, updatedAt: now })
        .where(eq(projects.id, input.projectId));
    }
  });

  await logAudit({
    userId: input.userId,
    action: "field_task.created",
    tableName: "field_tasks",
    recordId: id,
    before: null,
    after: {
      projectId: input.projectId,
      taskType,
      status: values.status,
      budgetEstimateDraftId: budget.id,
      changeOrderId: input.changeOrderId ?? null,
      source: values.source,
    },
  }).catch(() => undefined);

  const created = await getFieldTask(id);
  if (!created) throw new FieldOpsError("TASK_NOT_FOUND", `Task ${id} could not be read back`);
  return created;
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Load a single field task. */
export async function getFieldTask(id: string): Promise<FieldTask | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select().from(fieldTasks).where(eq(fieldTasks.id, id)).limit(1);
  return row ?? null;
}

export interface ListFieldTasksOptions {
  projectId: string;
  status?: FieldTaskStatus | FieldTaskStatus[];
  taskType?: FieldTaskType;
  subcontractorId?: string;
  changeOrderId?: string;
  limit?: number;
  offset?: number;
}

/** List the field tasks of a project. */
export async function listFieldTasks(
  opts: ListFieldTasksOptions,
): Promise<{ tasks: FieldTask[]; total: number }> {
  const db = await getDb();
  if (!db) return { tasks: [], total: 0 };

  const conditions = [eq(fieldTasks.projectId, opts.projectId), isNull(fieldTasks.deletedAt)];

  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    if (statuses.length > 0) conditions.push(inArray(fieldTasks.status, statuses));
  }
  if (opts.taskType) conditions.push(eq(fieldTasks.taskType, opts.taskType));
  if (opts.subcontractorId) conditions.push(eq(fieldTasks.subcontractorId, opts.subcontractorId));
  if (opts.changeOrderId) conditions.push(eq(fieldTasks.changeOrderId, opts.changeOrderId));

  const where = and(...conditions);

  const rows = await db
    .select()
    .from(fieldTasks)
    .where(where)
    .orderBy(asc(fieldTasks.sequence), asc(fieldTasks.createdAt))
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);

  return { tasks: rows, total: rows.length };
}

/** Transition history of a task. */
export async function listFieldTaskEvents(taskId: string): Promise<FieldTaskEvent[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(fieldTaskEvents)
    .where(eq(fieldTaskEvents.fieldTaskId, taskId))
    .orderBy(asc(fieldTaskEvents.createdAt));
}

/** Field progress of a project, including the closeout readiness signal. */
export async function getFieldProgress(projectId: string): Promise<FieldProgressSummary> {
  const { tasks } = await listFieldTasks({ projectId, limit: 1000 });
  return summarizeFieldProgress(
    tasks.map((t) => ({
      id: t.id,
      status: (normalizeFieldTaskStatus(t.status) ?? "pending") as FieldTaskStatus,
    })),
  );
}

/** Schedule assessment of a single task. */
export async function getTaskSchedule(
  taskId: string,
  today?: string,
): Promise<ScheduleAssessment | null> {
  const task = await getFieldTask(taskId);
  if (!task) return null;

  return assessSchedule(
    {
      status: (normalizeFieldTaskStatus(task.status) ?? "pending") as FieldTaskStatus,
      plannedStartDate: task.plannedStartDate,
      plannedEndDate: task.plannedEndDate,
      actualStartDate: task.actualStartDate,
      actualEndDate: task.actualEndDate,
    },
    todayIso(today),
  );
}

// ══════════════════════════════════════════════════════════════════════
// UPDATE — non-status fields
// ══════════════════════════════════════════════════════════════════════

export interface UpdateFieldTaskInput {
  taskId: string;
  userId: string;
  title?: string;
  description?: string | null;
  taskType?: string;
  sequence?: number;
  costCodeId?: string | null;
  costCode?: string | null;
  quantity?: number | null;
  unit?: string | null;
  budgetedCostCents?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  plannedHours?: number | null;
  actualHours?: number | null;
  requiresInspection?: boolean;
  photosCount?: number;
  notes?: string | null;
}

/** Update the descriptive/planning fields of a task. Status changes go through `transitionFieldTask`. */
export async function updateFieldTask(input: UpdateFieldTaskInput): Promise<FieldTask> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");

  const before = await getFieldTask(input.taskId);
  if (!before) {
    throw new FieldOpsError("TASK_NOT_FOUND", `Field task ${input.taskId} not found`);
  }

  const status = normalizeFieldTaskStatus(before.status);
  if (status === "verified" || status === "cancelled") {
    throw new FieldOpsError(
      "INVALID_TASK_TRANSITION",
      `Task ${input.taskId} is ${status} and immutable (FO-006).`,
      { status },
    );
  }

  const patch: Record<string, unknown> = { updatedBy: input.userId, updatedAt: new Date() };

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.taskType !== undefined) {
    const normalized = normalizeFieldTaskType(input.taskType);
    if (!normalized) {
      throw new FieldOpsError("INVALID_TASK_TYPE", `"${input.taskType}" is not a known field task type.`);
    }
    patch.taskType = normalized;
  }
  if (input.sequence !== undefined) patch.sequence = input.sequence;
  if (input.costCodeId !== undefined) patch.costCodeId = input.costCodeId;
  if (input.costCode !== undefined) patch.costCode = input.costCode;
  if (input.quantity !== undefined) patch.quantity = input.quantity != null ? String(input.quantity) : null;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.budgetedCostCents !== undefined) patch.budgetedCostCents = input.budgetedCostCents;
  if (input.plannedStartDate !== undefined) patch.plannedStartDate = input.plannedStartDate;
  if (input.plannedEndDate !== undefined) patch.plannedEndDate = input.plannedEndDate;
  if (input.plannedHours !== undefined) patch.plannedHours = input.plannedHours != null ? String(input.plannedHours) : null;
  if (input.actualHours !== undefined) patch.actualHours = input.actualHours != null ? String(input.actualHours) : null;
  if (input.requiresInspection !== undefined) patch.requiresInspection = input.requiresInspection;
  if (input.photosCount !== undefined) patch.photosCount = input.photosCount;
  if (input.notes !== undefined) patch.notes = input.notes;

  await db.update(fieldTasks).set(patch as never).where(eq(fieldTasks.id, input.taskId));

  await logAudit({
    userId: input.userId,
    action: "field_task.updated",
    tableName: "field_tasks",
    recordId: input.taskId,
    before,
    after: patch,
  }).catch(() => undefined);

  const after = await getFieldTask(input.taskId);
  return after ?? before;
}

// ══════════════════════════════════════════════════════════════════════
// ASSIGNMENT (FO-002)
// ══════════════════════════════════════════════════════════════════════

/** Ensure the subcontractor exists and may receive work (SC-002). */
async function assertSubcontractorEligible(subcontractorId: string, today: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");

  const [sub] = await db
    .select()
    .from(subcontractors)
    .where(eq(subcontractors.id, subcontractorId))
    .limit(1);

  if (!sub) {
    throw new FieldOpsError("SUBCONTRACTOR_NOT_FOUND", `Subcontractor ${subcontractorId} not found`);
  }

  const compliance = assessCompliance({
    licenseNumber: sub.licenseNumber,
    licenseExpiry: sub.licenseExpiry,
    insuranceCarrier: sub.insuranceCarrier,
    insuranceExpiry: sub.insuranceExpiry,
    insuranceCoverageCents: sub.insuranceCoverageCents,
    today,
  });

  const eligibility = evaluateAssignmentEligibility({
    status: sub.status,
    compliance,
    strict: String(process.env.SUBCONTRACTOR_STRICT ?? "").toLowerCase() === "true",
  });

  if (!eligibility.eligible) {
    throw new FieldOpsError(
      "SUBCONTRACTOR_NOT_ELIGIBLE",
      `Subcontractor ${sub.name} cannot receive this task: ${eligibility.blockers.join(" ")}`,
      { blockers: eligibility.blockers, warnings: eligibility.warnings },
    );
  }
}

export interface AssignFieldTaskInput {
  taskId: string;
  userId: string;
  assigneeType: string;
  subcontractorId?: string | null;
  assigneeName?: string | null;
  assignedUserId?: string | null;
  today?: string;
}

/** Assign a task to a subcontractor or crew and move it to `assigned`. */
export async function assignFieldTask(input: AssignFieldTaskInput): Promise<FieldTask> {
  const assignment: FieldTaskAssignment = {
    assigneeType: normalizeAssigneeType(input.assigneeType),
    subcontractorId: input.subcontractorId ?? null,
    assigneeName: input.assigneeName ?? null,
    assignedUserId: input.assignedUserId ?? null,
  };

  const violations = validateAssignment(assignment);
  if (violations.length > 0) {
    throw new FieldOpsError("INVALID_ASSIGNMENT", violations[0].message, { violations });
  }

  if (assignment.subcontractorId) {
    await assertSubcontractorEligible(assignment.subcontractorId, todayIso(input.today));
  }

  return transitionFieldTask({
    taskId: input.taskId,
    userId: input.userId,
    to: "assigned",
    assignment,
    today: input.today,
  });
}

// ══════════════════════════════════════════════════════════════════════
// STATE TRANSITIONS (FO-001 … FO-006)
// ══════════════════════════════════════════════════════════════════════

export interface TransitionFieldTaskInput {
  taskId: string;
  userId: string;
  to: FieldTaskStatus | string;
  assignment?: FieldTaskAssignment;
  blockReason?: string | null;
  verificationNotes?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  actualHours?: number | null;
  today?: string;
}

/**
 * Transition a field task and record the event.
 *
 * The engine decides; this function persists the resulting patch and appends the event.
 * Both happen in the same transaction so history can never disagree with the row.
 */
export async function transitionFieldTask(
  input: TransitionFieldTaskInput,
): Promise<FieldTask> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");

  const before = await getFieldTask(input.taskId);
  if (!before) {
    throw new FieldOpsError("TASK_NOT_FOUND", `Field task ${input.taskId} not found`);
  }

  const to = normalizeFieldTaskStatus(input.to);
  if (!to) {
    throw new FieldOpsError(
      "INVALID_TASK_TRANSITION",
      `"${input.to}" is not a valid field task status.`,
      { to: input.to },
    );
  }

  const today = todayIso(input.today);
  const currentStatus = (normalizeFieldTaskStatus(before.status) ?? "pending") as FieldTaskStatus;

  const result = evaluateTransition(
    {
      id: before.id,
      status: currentStatus,
      taskType: (normalizeFieldTaskType(before.taskType) ?? "other") as FieldTaskType,
      assignment: {
        assigneeType: (before.assigneeType
          ? normalizeAssigneeType(before.assigneeType)
          : null) as FieldAssigneeType | null,
        subcontractorId: before.subcontractorId,
        assigneeName: before.assigneeName,
        assignedUserId: before.assignedUserId,
      },
      plannedStartDate: before.plannedStartDate,
      plannedEndDate: before.plannedEndDate,
      actualStartDate: before.actualStartDate,
      actualEndDate: before.actualEndDate,
      blockReason: before.blockReason,
    },
    {
      to,
      today,
      assignment: input.assignment,
      blockReason: input.blockReason ?? null,
      verifiedBy: to === "verified" ? input.userId : null,
      actualStartDate: input.actualStartDate ?? null,
      actualEndDate: input.actualEndDate ?? null,
    },
  );

  if (!result.allowed) {
    const first = result.violations[0];
    const code: FieldOpsErrorCode =
      first.code === "INVALID_ASSIGNMENT"
        ? "INVALID_ASSIGNMENT"
        : first.code === "BLOCK_REASON_REQUIRED"
          ? "BLOCK_REASON_REQUIRED"
          : "INVALID_TASK_TRANSITION";
    throw new FieldOpsError(code, first.message, { violations: result.violations });
  }

  const now = new Date();
  const patch: Record<string, unknown> = {
    status: result.patch.status,
    updatedBy: input.userId,
    updatedAt: now,
  };

  if (result.patch.actualStartDate !== undefined) patch.actualStartDate = result.patch.actualStartDate;
  if (result.patch.actualEndDate !== undefined) patch.actualEndDate = result.patch.actualEndDate;
  if (result.patch.blockReason !== undefined) patch.blockReason = result.patch.blockReason;
  if (result.patch.assigneeType !== undefined) patch.assigneeType = result.patch.assigneeType;
  if (result.patch.subcontractorId !== undefined) patch.subcontractorId = result.patch.subcontractorId;
  if (result.patch.assigneeName !== undefined) patch.assigneeName = result.patch.assigneeName;
  if (result.patch.assignedUserId !== undefined) patch.assignedUserId = result.patch.assignedUserId;
  if (input.actualHours != null) patch.actualHours = String(input.actualHours);

  if (to === "assigned") {
    patch.assignedAt = now;
    patch.assignedBy = input.userId;
  }
  if (to === "blocked") patch.blockedAt = now;
  if (to === "verified") {
    patch.verifiedBy = input.userId;
    patch.verifiedAt = now;
    if (input.verificationNotes !== undefined) patch.verificationNotes = input.verificationNotes;
  }
  // Returning to work after completion is rework, and rework is a quality signal.
  if (currentStatus === "completed" && to === "in_progress") {
    patch.reworkCount = (before.reworkCount ?? 0) + 1;
  }

  await db.transaction(async (tx) => {
    await tx.update(fieldTasks).set(patch as never).where(eq(fieldTasks.id, input.taskId));

    await tx.insert(fieldTaskEvents).values(
      withTenant(
        {
          id: randomUUID(),
          projectId: before.projectId,
          fieldTaskId: before.id,
          fromStatus: currentStatus,
          toStatus: to,
          reason: input.blockReason ?? input.verificationNotes ?? null,
          actorId: input.userId,
          payload: { patch, today },
          createdAt: now,
        },
        before.tenantId,
      ) as never,
    );
  });

  await logAudit({
    userId: input.userId,
    action: `field_task.${to}`,
    tableName: "field_tasks",
    recordId: input.taskId,
    before: { status: currentStatus },
    after: patch,
  }).catch(() => undefined);

  // When the last open task closes, stamp the project's field completion.
  if (to === "completed" || to === "verified" || to === "cancelled") {
    const progress = await getFieldProgress(before.projectId);
    if (progress.readyForCloseout) {
      await db
        .update(projects)
        .set({ fieldCompletedAt: now, updatedBy: input.userId, updatedAt: now })
        .where(eq(projects.id, before.projectId));
    }
  }

  const after = await getFieldTask(input.taskId);
  return after ?? before;
}

/** Soft delete a task. Only allowed while the work has not started. */
export async function deleteFieldTask(taskId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");

  const before = await getFieldTask(taskId);
  if (!before) throw new FieldOpsError("TASK_NOT_FOUND", `Field task ${taskId} not found`);

  const status = normalizeFieldTaskStatus(before.status);
  if (status !== "pending" && status !== "assigned") {
    throw new FieldOpsError(
      "INVALID_TASK_TRANSITION",
      `Task ${taskId} is ${status}; cancel it instead of deleting so the execution history is preserved.`,
      { status },
    );
  }

  const now = new Date();
  await db
    .update(fieldTasks)
    .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
    .where(eq(fieldTasks.id, taskId));

  await logAudit({
    userId,
    action: "field_task.deleted",
    tableName: "field_tasks",
    recordId: taskId,
    before,
    after: { deletedAt: now },
  }).catch(() => undefined);

  return true;
}

// ══════════════════════════════════════════════════════════════════════
// CHANGE ORDER → FIELD TASKS (§7)
// ══════════════════════════════════════════════════════════════════════

export interface MaterializeChangeOrderResult {
  changeOrderId: string;
  projectId: string;
  created: FieldTask[];
  /** Source keys that already existed — proof the operation is idempotent. */
  skippedKeys: string[];
  addedBudgetCents: number;
}

/**
 * Materialize an approved change order into field tasks and recompose the project budget.
 *
 * Idempotent by `(project_id, source_key)`: replaying an approval is a normal event
 * (webhook retry, double click, reconciliation job) and must never duplicate the work list.
 */
export async function materializeChangeOrderTasks(input: {
  changeOrderId: string;
  userId: string;
  today?: string;
}): Promise<MaterializeChangeOrderResult> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");

  const [changeOrder] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, input.changeOrderId))
    .limit(1);

  if (!changeOrder) {
    throw new FieldOpsError(
      "CHANGE_ORDER_NOT_APPROVED",
      `Change order ${input.changeOrderId} not found`,
    );
  }

  if (changeOrder.status !== "approved") {
    throw new FieldOpsError(
      "CHANGE_ORDER_NOT_APPROVED",
      `Change order ${input.changeOrderId} is "${changeOrder.status}". Only an approved change order can generate field work.`,
      { status: changeOrder.status },
    );
  }

  if (!changeOrder.changeOrderOf) {
    throw new FieldOpsError(
      "CHANGE_ORDER_NOT_APPROVED",
      `Estimate ${input.changeOrderId} is not a change order (change_order_of is null).`,
    );
  }

  const budget = await getProjectBudgetEstimate(changeOrder.projectId);
  if (!budget) {
    throw new FieldOpsError(
      "NO_APPROVED_ESTIMATE",
      `Project ${changeOrder.projectId} has no approved baseline estimate.`,
    );
  }

  const lineItems = (changeOrder.lineItems ?? []) as EstimateDraftLineItem[];
  const derived = deriveFieldTasksFromChangeOrder(
    changeOrder.id,
    lineItems.map((li) => ({
      costGroupName: li.costGroupName,
      costItemName: li.costItemName,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      costCode: li.costCode ?? null,
    })),
  );

  const existing = await db
    .select({ sourceKey: fieldTasks.sourceKey })
    .from(fieldTasks)
    .where(
      and(
        eq(fieldTasks.projectId, changeOrder.projectId),
        eq(fieldTasks.changeOrderId, changeOrder.id),
      ),
    );

  const existingKeys = new Set(
    existing.map((e) => e.sourceKey).filter((k): k is string => !!k),
  );

  const created: FieldTask[] = [];
  const skippedKeys: string[] = [];

  for (const [index, task] of Array.from(derived.entries())) {
    const sourceKey = changeOrderTaskKey(changeOrder.id, task.taskKey);
    if (existingKeys.has(sourceKey)) {
      skippedKeys.push(sourceKey);
      continue;
    }

    const lineItem = lineItems[index];
    const budgetedCostCents =
      lineItem != null
        ? Math.round(Number(lineItem.quantity ?? 0) * toCents(lineItem.unitCostSnapshot ?? 0))
        : null;

    const row = await createFieldTask({
      projectId: changeOrder.projectId,
      userId: input.userId,
      tenantId: changeOrder.tenantId,
      taskType: task.taskType,
      title: task.title,
      description: task.description,
      source: "change_order",
      sequence: 1000 + index,
      costCode: task.costCode,
      quantity: task.quantity,
      unit: task.unit,
      budgetedCostCents,
      changeOrderId: changeOrder.id,
      sourceKey,
      today: input.today,
    });
    created.push(row);
  }

  // Recompose the available budget: baseline + Σ approved change orders.
  const changeOrders = await listApprovedChangeOrders(changeOrder.projectId);
  const changeOrderBudgetCents = changeOrders.reduce(
    (sum, co) => sum + toCents(co.finalTotalPrice ?? co.subtotalPrice ?? 0),
    0,
  );
  const baselineCents = toCents(budget.finalTotalPrice ?? budget.subtotalPrice ?? 0);
  const now = new Date();

  await db
    .update(projects)
    .set({
      approvedBudgetCents: baselineCents,
      changeOrderBudgetCents,
      updatedBy: input.userId,
      updatedAt: now,
    })
    .where(eq(projects.id, changeOrder.projectId));

  await logAudit({
    userId: input.userId,
    action: "field_task.change_order_materialized",
    tableName: "field_tasks",
    recordId: changeOrder.id,
    before: { existingTasks: existingKeys.size },
    after: {
      projectId: changeOrder.projectId,
      createdTasks: created.length,
      skippedKeys,
      baselineCents,
      changeOrderBudgetCents,
    },
  }).catch(() => undefined);

  return {
    changeOrderId: changeOrder.id,
    projectId: changeOrder.projectId,
    created,
    skippedKeys,
    addedBudgetCents: toCents(changeOrder.finalTotalPrice ?? changeOrder.subtotalPrice ?? 0),
  };
}

// ══════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════

export interface FieldTaskStats {
  projectId: string;
  progress: FieldProgressSummary;
  overdueCount: number;
  overdueTaskIds: string[];
  unassignedCount: number;
}

/** Operational snapshot used by the field dashboard. */
export async function getFieldTaskStats(
  projectId: string,
  today?: string,
): Promise<FieldTaskStats> {
  const { tasks } = await listFieldTasks({ projectId, limit: 1000 });
  const day = todayIso(today);

  const progress = summarizeFieldProgress(
    tasks.map((t) => ({
      id: t.id,
      status: (normalizeFieldTaskStatus(t.status) ?? "pending") as FieldTaskStatus,
    })),
  );

  const overdueTaskIds: string[] = [];
  let unassignedCount = 0;

  for (const task of tasks) {
    const status = (normalizeFieldTaskStatus(task.status) ?? "pending") as FieldTaskStatus;
    const schedule = assessSchedule(
      {
        status,
        plannedStartDate: task.plannedStartDate,
        plannedEndDate: task.plannedEndDate,
        actualStartDate: task.actualStartDate,
        actualEndDate: task.actualEndDate,
      },
      day,
    );
    if (schedule.overdue) overdueTaskIds.push(task.id);
    if (!task.assigneeType && (status === "pending" || status === "blocked")) unassignedCount += 1;
  }

  return {
    projectId,
    progress,
    overdueCount: overdueTaskIds.length,
    overdueTaskIds,
    unassignedCount,
  };
}

/** Count of tasks by status for a project, computed in SQL. */
export async function countTasksByStatus(
  projectId: string,
): Promise<Array<{ status: string; count: number }>> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ status: fieldTasks.status, count: sql<number>`COUNT(*)` })
    .from(fieldTasks)
    .where(and(eq(fieldTasks.projectId, projectId), isNull(fieldTasks.deletedAt)))
    .groupBy(fieldTasks.status);

  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}
