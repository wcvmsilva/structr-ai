/**
 * structr.ai — PHASE 3 Field Operations Persistence
 *
 * A1 retains existing field records while execution authority is unavailable.
 * New tasks, assignment, execution promotions and operational budgets are held.
 * Authorized descriptive edits, valid blocking/cancellation and deletion of unstarted
 * work preserve existing facts, H1 lineage, state-machine rules and durable audit.
 * Every retained mutation authorizes and locks project -> task on its own transaction;
 * task/event/audit writes commit together without changing project milestones.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import { assertNotHistoricalEstimateDraft } from "./historical-estimate-guard";
import {
  estimateDrafts,
  fieldTaskEvents,
  fieldTasks,
  projects,
  type EstimateDraft,
  type FieldTask,
  type FieldTaskEvent,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import { requireProjectAccess, ProjectAccessError } from "./project-access";
import type { AuthTransaction } from "./auth-transaction";
import { holdExecutionOperation } from "@shared/execution-authority";
import {
  assessSchedule,
  evaluateTransition,
  summarizeFieldProgress,
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
  MIN_BLOCK_REASON_LENGTH,
} from "@shared/domain/phase3-taxonomy";
import { holdLegacyEstimateOperation } from "@shared/estimate-legacy-hold";

/**
 * TENANT MODEL — ROW INHERITANCE, APPLIED AFTER AUTHORIZATION.
 *
 * CORRECTION (Codex P1-1, second review). An earlier version of this note claimed the
 * tenant boundary here was already enforced because "the tenant-aware procedure boundary
 * still rejects an unresolved caller before any of it runs." That was NOT true when it was
 * written: every field-operations route sat on `protectedProcedure`, and the shared guard
 * `requireProjectAccess()` neither required a resolved caller tenant nor compared it to the
 * project's before granting admin/owner/member access. The comment asserted a boundary the
 * code did not enforce. It does now, and the claim below is the enforced one.
 *
 * Required order, in this sequence:
 *   1. resolved caller tenant            — `tenantProcedure` on the route
 *   2. authorize caller against the parent project's tenant, with strict equality
 *                                        — `requireProjectAccess` / `requireEntityAccess`
 *   3. only then inherit the child row's tenant from its parent
 *
 * Retained task mutations require a resolved tenant that agrees across actor, project
 * and task. Event tenantId is inherited from that authorized task. A legacy null tenant
 * is unresolved for these writers; reads retain their existing access contract. Creation
 * is always held, so no fallback tenant is persisted and no new field row is generated.
 */


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

/** Legacy/internal approval does not resolve an execution budget in A1. */
export async function getProjectBudgetEstimate(
  projectId: string,
): Promise<EstimateDraft | null> {
  return holdExecutionOperation("resolve field execution budget");
}

/**
 * A persisted calculated label is insufficient when its origin is historical.
 * Existing writers permit CO-on-CO and version chains, so inspect both edges.
 * 128 distinct rows is a defensive work bound, not a claimed business depth:
 * cycles, missing identities or larger graphs require reconciliation and fail closed.
 */
const MAX_FIELD_ESTIMATE_LINEAGE_NODES = 128;
async function assertCalculatedFieldLineage(
  db: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">, root: EstimateDraft,
): Promise<void> {
  const loaded = new Map<string, EstimateDraft>([[root.id, root]]);
  const active = new Set<string>(), verified = new Set<string>();
  const pending: { row: EstimateDraft; exiting: boolean }[] = [{ row: root, exiting: false }];
  let inspected = 0;
  while (pending.length) {
    const frame = pending.pop()!;
    const row = frame.row;
    if (frame.exiting) { active.delete(row.id); verified.add(row.id); continue; }
    if (verified.has(row.id)) continue;
    if (active.has(row.id) || inspected >= MAX_FIELD_ESTIMATE_LINEAGE_NODES) {
      throw new FieldOpsError("CHANGE_ORDER_NOT_APPROVED", "Estimate ancestry requires reconciliation before field use (cycle or inspection limit).");
    }
    inspected++;
    if (row.projectId !== root.projectId || row.tenantId !== root.tenantId) {
      throw new FieldOpsError("CHANGE_ORDER_NOT_APPROVED", "Estimate ancestry belongs to a different project or tenant.");
    }
    await assertNotHistoricalEstimateDraft(db, row, "use change-order ancestry for field work or budget");
    active.add(row.id);
    pending.push({ row, exiting: true });
    const references = new Set([row.changeOrderOf, row.supersedesId].filter((id): id is string => !!id));
    for (const id of references) {
      let ancestor = loaded.get(id);
      if (!ancestor) {
        const [saved] = await db.select().from(estimateDrafts).where(eq(estimateDrafts.id, id)).limit(1);
        if (!saved) throw new FieldOpsError("CHANGE_ORDER_NOT_APPROVED", "An estimate ancestor is missing; field use requires reconciliation.");
        ancestor = saved; loaded.set(id, ancestor);
      }
      pending.push({ row: ancestor, exiting: false });
    }
  }
}

/** Operational change-order budget is unavailable without execution authority. */
export async function listApprovedChangeOrders(
  projectId: string,
): Promise<EstimateDraft[]> {
  return holdExecutionOperation("resolve operational change-order budget");
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

/** Authorize the current project and preserve H1 reference refusal, then hold creation. */
export async function createFieldTask(input: CreateFieldTaskInput): Promise<FieldTask> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(async tx => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new FieldOpsError("PROJECT_NOT_FOUND", "Project not found");
    const tenantId = project.tenantId ?? input.tenantId ?? null;
    await requireProjectAccess(input.projectId, input.userId, "write", {
      mode: "a1", transaction: tx, expectedTenantId: tenantId ?? "",
    });
    if (input.tenantId !== undefined && input.tenantId !== project.tenantId) {
      throw new ProjectAccessError("FORBIDDEN", "Caller tenant does not match the project.");
    }
    await assertFieldEstimateReferences(tx, { projectId: project.id, tenantId: project.tenantId, changeOrderId: input.changeOrderId });
    return holdExecutionOperation("create field task");
  }, { isolationLevel: "serializable" });
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

/** Resolve references after ACL, retaining H1 detection through both lineage edges. */
async function assertFieldEstimateReferences(
  tx: AuthTransaction,
  task: { projectId: string; tenantId: string | null; budgetEstimateDraftId?: string | null; changeOrderId?: string | null },
): Promise<void> {
  for (const reference of new Set([task.budgetEstimateDraftId, task.changeOrderId])) {
    if (!reference) continue;
    const [draft] = await tx.select().from(estimateDrafts).where(eq(estimateDrafts.id, reference)).limit(1).for("share");
    if (!draft || draft.projectId !== task.projectId || draft.tenantId !== task.tenantId) {
      throw new FieldOpsError("CHANGE_ORDER_NOT_APPROVED", "Field estimate reference requires reconciliation.");
    }
    await assertCalculatedFieldLineage(tx, draft);
  }
}

async function authorizedFieldTask(tx: AuthTransaction, taskId: string, userId: string, permission: "write" | "approve" | "delete"): Promise<FieldTask> {
  const [locator] = await tx.select().from(fieldTasks).where(eq(fieldTasks.id, taskId)).limit(1);
  if (!locator) throw new FieldOpsError("TASK_NOT_FOUND", "Field task not found");
  await requireProjectAccess(locator.projectId, userId, permission, {
    mode: "a1", transaction: tx, expectedTenantId: locator.tenantId ?? "",
  });
  const [task] = await tx.select().from(fieldTasks).where(eq(fieldTasks.id, taskId)).limit(1).for("update");
  if (!task || task.deletedAt || task.projectId !== locator.projectId || task.tenantId !== locator.tenantId) {
    throw new ProjectAccessError("FORBIDDEN", "Field task is unavailable.");
  }
  await assertFieldEstimateReferences(tx, task);
  return task;
}

/** Defined unknown or operational keys, including null, refuse the whole command. */
function assertDescriptiveCommand(input: object, allowed: readonly string[], operation: string): void {
  if (Object.entries(input).some(([key, value]) => value !== undefined && !allowed.includes(key))) {
    holdExecutionOperation(operation);
  }
}

async function auditFieldMutation(tx: AuthTransaction, userId: string, action: string, before: FieldTask, after: FieldTask): Promise<void> {
  const logged = await logAudit({ userId, action, tableName: "field_tasks", recordId: before.id, before, after }, tx);
  if (!logged) throw new Error(`Audit insert failed for ${action}`);
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

/** Only descriptive fields remain writable; planning and execution payloads are held. */
export async function updateFieldTask(input: UpdateFieldTaskInput): Promise<FieldTask> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(async tx => {
    const before = await authorizedFieldTask(tx, input.taskId, input.userId, "write");
    assertDescriptiveCommand(input, ["taskId", "userId", "title", "description", "notes", "photosCount"], "update field planning or execution");
    const status = normalizeFieldTaskStatus(before.status);
    if (status === "verified" || status === "cancelled") {
      throw new FieldOpsError("INVALID_TASK_TRANSITION", `Task is ${status} and immutable (FO-006).`, { status });
    }
    const patch: Record<string, unknown> = { updatedBy: input.userId, updatedAt: new Date() };
    for (const key of ["title", "description", "notes", "photosCount"] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    const [after] = await tx.update(fieldTasks).set(patch).where(eq(fieldTasks.id, input.taskId)).returning();
    await auditFieldMutation(tx, input.userId, "field_task.updated", before, after);
    return after;
  }, { isolationLevel: "serializable" });
}

// ══════════════════════════════════════════════════════════════════════
// ASSIGNMENT (FO-002)
// ══════════════════════════════════════════════════════════════════════

export interface AssignFieldTaskInput {
  taskId: string;
  userId: string;
  assigneeType: string;
  subcontractorId?: string | null;
  assigneeName?: string | null;
  assignedUserId?: string | null;
  today?: string;
}

/** Assignment is unavailable until execution authority has its own producer. */
export async function assignFieldTask(input: AssignFieldTaskInput): Promise<FieldTask> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(async tx => {
    await authorizedFieldTask(tx, input.taskId, input.userId, "write");
    return holdExecutionOperation("assign field task");
  }, { isolationLevel: "serializable" });
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
  return db.transaction(async tx => {
    const before = await authorizedFieldTask(tx, input.taskId, input.userId, normalizeFieldTaskStatus(input.to) === "verified" ? "approve" : "write");
    const to = normalizeFieldTaskStatus(input.to);
    if (!to) throw new FieldOpsError("INVALID_TASK_TRANSITION", "Invalid field task status.");
    if (to !== "blocked" && to !== "cancelled") holdExecutionOperation("promote field task execution");
    assertDescriptiveCommand(input, ["taskId", "userId", "to", "blockReason", "today"], "modify field execution during risk reduction");
    const reason = typeof input.blockReason === "string" ? input.blockReason.trim() : "";
    if (reason.length < MIN_BLOCK_REASON_LENGTH) {
      throw new FieldOpsError("BLOCK_REASON_REQUIRED", `A reason of at least ${MIN_BLOCK_REASON_LENGTH} characters is required.`);
    }
    const currentStatus = normalizeFieldTaskStatus(before.status);
    if (!currentStatus) throw new FieldOpsError("INVALID_TASK_TRANSITION", "Current task status requires reconciliation.");
    const today = todayIso(input.today);
    const result = evaluateTransition({
      id: before.id, status: currentStatus,
      taskType: (normalizeFieldTaskType(before.taskType) ?? "other") as FieldTaskType,
      assignment: { assigneeType: normalizeAssigneeType(before.assigneeType) as FieldAssigneeType | null,
        subcontractorId: before.subcontractorId, assigneeName: before.assigneeName, assignedUserId: before.assignedUserId },
      plannedStartDate: before.plannedStartDate, plannedEndDate: before.plannedEndDate,
      actualStartDate: before.actualStartDate, actualEndDate: before.actualEndDate, blockReason: before.blockReason,
    }, { to, today, blockReason: reason });
    if (!result.allowed) {
      const first = result.violations[0];
      throw new FieldOpsError(first.code === "BLOCK_REASON_REQUIRED" ? "BLOCK_REASON_REQUIRED" : "INVALID_TASK_TRANSITION", first.message, { violations: result.violations });
    }
    const now = new Date();
    // Only the risk-reduction state and reason may change; existing assignment, hours,
    // actual dates and project milestones remain facts, never generated authority.
    const patch = { status: to, blockReason: reason, ...(to === "blocked" ? { blockedAt: now } : {}), updatedBy: input.userId, updatedAt: now };
    const [after] = await tx.update(fieldTasks).set(patch).where(eq(fieldTasks.id, input.taskId)).returning();
    await tx.insert(fieldTaskEvents).values({ id: randomUUID(), projectId: before.projectId, fieldTaskId: before.id,
      fromStatus: currentStatus, toStatus: to, reason, actorId: input.userId, payload: { patch, today }, createdAt: now,
      tenantId: before.tenantId });
    await auditFieldMutation(tx, input.userId, `field_task.${to}`, before, after);
    return after;
  }, { isolationLevel: "serializable" });
}

/** Soft delete a task. Only allowed while the work has not started. */
export async function deleteFieldTask(taskId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new FieldOpsError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(async tx => {
    const before = await authorizedFieldTask(tx, taskId, userId, "delete");
    const events = await tx.select().from(fieldTaskEvents).where(eq(fieldTaskEvents.fieldTaskId, taskId));
    const status = normalizeFieldTaskStatus(before.status);
    const started = before.actualStartDate != null || before.actualEndDate != null || before.actualHours != null
      || before.verifiedAt != null || before.verifiedBy != null || (before.reworkCount ?? 0) > 0
      || events.some(event => [event.fromStatus, event.toStatus].some(status => status != null && ["in_progress", "completed", "verified"].includes(status)));
    if ((status !== "pending" && status !== "assigned") || started) {
      throw new FieldOpsError("INVALID_TASK_TRANSITION", "Started work must be cancelled instead of deleted so its execution history is preserved.");
    }
    const now = new Date();
    const [after] = await tx.update(fieldTasks).set({ deletedAt: now, updatedBy: userId, updatedAt: now }).where(eq(fieldTasks.id, taskId)).returning();
    await auditFieldMutation(tx, userId, "field_task.deleted", before, after);
    return true;
  }, { isolationLevel: "serializable" });
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

/** Legacy approval is not authority to create field work or an execution budget. */
export async function materializeChangeOrderTasks(input: {
  changeOrderId: string;
  userId: string;
  today?: string;
}): Promise<MaterializeChangeOrderResult> {
  return holdLegacyEstimateOperation("materialize_change_order");
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
