import { ExecutionAuthorityUnavailableError, executionAuthorityUnavailable } from "@shared/execution-authority";
import { LegacyEstimateOperationError } from "@shared/estimate-legacy-hold";
/**
 * structr.ai — PHASE 3 Field Operations tRPC Router
 *
 * Procedures:
 *   - fieldOperations.createTask          (protected) → held until execution authority exists
 *   - fieldOperations.getTask             (protected) → task + schedule assessment + history
 *   - fieldOperations.listTasks           (protected) → tasks of a project, filterable
 *   - fieldOperations.updateTask          (protected) → descriptive fields only
 *   - fieldOperations.assignTask          (protected) → assign to subcontractor or crew
 *   - fieldOperations.startTask           (protected) → assigned → in_progress
 *   - fieldOperations.completeTask        (protected) → in_progress → completed
 *   - fieldOperations.verifyTask          (protected) → completed → verified (terminal)
 *   - fieldOperations.blockTask           (protected) → → blocked with mandatory reason
 *   - fieldOperations.unblockTask         (protected) → blocked → assigned/in_progress
 *   - fieldOperations.cancelTask          (protected) → → cancelled (terminal)
 *   - fieldOperations.transitionTask      (protected) → generic transition
 *   - fieldOperations.deleteTask          (protected) → soft delete (pending/assigned only)
 *   - fieldOperations.getProgress         (protected) → progress + closeout readiness signal
 *   - fieldOperations.getStats            (protected) → progress, overdue, unassigned
 *   - fieldOperations.listTaskEvents      (protected) → transition history
 *   - fieldOperations.getBudgetEstimate   (protected) → explicit unavailable execution authority
 *   - fieldOperations.materializeChangeOrder (protected) → held legacy operational materialization
 *   - fieldOperations.taskTypes           (protected) → task type vocabulary
 *
 * Authorization: every procedure resolves the owning project and delegates to the Phase 1
 * project access guard. Verification requires `approve`, since accepting work is an
 * acceptance of cost.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { HistoricalEstimateError } from "@shared/historical-estimate-engine";
import { tenantProcedure, router } from "./_core/trpc";
import { requireEntityAccess, requireProjectAccessTrpc, ProjectAccessError } from "./project-access";
import {
  assignFieldTask,
  createFieldTask,
  deleteFieldTask,
  FieldOpsError,
  getFieldProgress,
  getFieldTask,
  getFieldTaskStats,
  getTaskSchedule,
  listFieldTaskEvents,
  listFieldTasks,
  materializeChangeOrderTasks,
  transitionFieldTask,
  updateFieldTask,
} from "./field-operations-db";
import {
  FIELD_ASSIGNEE_TYPES,
  FIELD_TASK_STATUSES,
  FIELD_TASK_TYPES,
  FIELD_TASK_TYPE_LABELS,
  FIELD_TASK_SOURCES,
  MIN_BLOCK_REASON_LENGTH,
} from "@shared/domain/phase3-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  taskType: z.enum(FIELD_TASK_TYPES),
  title: z.string().min(1).max(255),
  description: z.string().max(5000).nullish(),
  source: z.enum(FIELD_TASK_SOURCES).optional(),
  sequence: z.number().int().min(0).max(100000).optional(),
  costCodeId: z.string().uuid().nullish(),
  costCode: z.string().max(64).nullish(),
  assemblyId: z.string().uuid().nullish(),
  estimateItemId: z.string().uuid().nullish(),
  quantity: z.number().nonnegative().nullish(),
  unit: z.string().max(32).nullish(),
  budgetedCostCents: z.number().int().min(0).nullish(),
  plannedStartDate: isoDate.nullish(),
  plannedEndDate: isoDate.nullish(),
  plannedHours: z.number().nonnegative().max(100000).nullish(),
  requiresInspection: z.boolean().optional(),
  notes: z.string().max(5000).nullish(),
  assigneeType: z.enum(FIELD_ASSIGNEE_TYPES).nullish(),
  subcontractorId: z.string().uuid().nullish(),
  assigneeName: z.string().max(255).nullish(),
  assignedUserId: z.string().uuid().nullish(),
});

const listTasksSchema = z.object({
  projectId: z.string().uuid(),
  status: z.union([z.enum(FIELD_TASK_STATUSES), z.array(z.enum(FIELD_TASK_STATUSES))]).optional(),
  taskType: z.enum(FIELD_TASK_TYPES).optional(),
  subcontractorId: z.string().uuid().optional(),
  changeOrderId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

// ══════════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ══════════════════════════════════════════════════════════════════════

/** Map a FieldOpsError to the tRPC code the UI can act on. */
function toTrpcError(err: unknown): never {
  if (err instanceof ProjectAccessError) {
    throw new TRPCError({ code: err.code, message: err.message, cause: err });
  }
  if (err instanceof ExecutionAuthorityUnavailableError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message, cause: err });
  }
  if (err instanceof LegacyEstimateOperationError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message, cause: err });
  }
  if (err instanceof HistoricalEstimateError && err.code === "HISTORICAL_AUTHORITY_NOT_AVAILABLE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message, cause: err });
  }
  if (err instanceof FieldOpsError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      PROJECT_NOT_FOUND: "NOT_FOUND",
      TASK_NOT_FOUND: "NOT_FOUND",
      SUBCONTRACTOR_NOT_FOUND: "NOT_FOUND",
      NO_APPROVED_ESTIMATE: "PRECONDITION_FAILED",
      CHANGE_ORDER_NOT_APPROVED: "PRECONDITION_FAILED",
      SUBCONTRACTOR_NOT_ELIGIBLE: "PRECONDITION_FAILED",
      INVALID_TASK_TRANSITION: "CONFLICT",
      INVALID_TASK_TYPE: "BAD_REQUEST",
      INVALID_ASSIGNMENT: "BAD_REQUEST",
      BLOCK_REASON_REQUIRED: "BAD_REQUEST",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const fieldOperationsRouter = router({
  /** Task creation remains held even when a legacy/internal approval exists. */
  createTask: tenantProcedure
    .input(createTaskSchema)
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");

      try {
        return await createFieldTask({
          projectId: input.projectId,
          userId: ctx.user.id,
          tenantId: ctx.tenantId ?? null,
          taskType: input.taskType,
          title: input.title,
          description: input.description ?? null,
          source: input.source,
          sequence: input.sequence,
          costCodeId: input.costCodeId ?? null,
          costCode: input.costCode ?? null,
          assemblyId: input.assemblyId ?? null,
          estimateItemId: input.estimateItemId ?? null,
          quantity: input.quantity ?? null,
          unit: input.unit ?? null,
          budgetedCostCents: input.budgetedCostCents ?? null,
          plannedStartDate: input.plannedStartDate ?? null,
          plannedEndDate: input.plannedEndDate ?? null,
          plannedHours: input.plannedHours ?? null,
          requiresInspection: input.requiresInspection,
          notes: input.notes ?? null,
          assigneeType: input.assigneeType ?? null,
          subcontractorId: input.subcontractorId ?? null,
          assigneeName: input.assigneeName ?? null,
          assignedUserId: input.assignedUserId ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Task detail with schedule assessment and transition history. */
  getTask: tenantProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "read");

      const task = await getFieldTask(input.taskId);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Field task not found" });

      const [schedule, events] = await Promise.all([
        getTaskSchedule(input.taskId),
        listFieldTaskEvents(input.taskId),
      ]);

      return { task, schedule, events };
    }),

  listTasks: tenantProcedure
    .input(listTasksSchema)
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return listFieldTasks(input);
    }),

  updateTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(5000).nullish(),
        photosCount: z.number().int().min(0).optional(),
        notes: z.string().max(5000).nullish(),
      }).passthrough(), // Keep forbidden keys for the helper's whole-command refusal.
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "write");

      try {
        return await updateFieldTask({ ...input, userId: ctx.user.id });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Assignment is an operational action and remains unavailable in A1. */
  assignTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        assigneeType: z.enum(FIELD_ASSIGNEE_TYPES),
        subcontractorId: z.string().uuid().nullish(),
        assigneeName: z.string().max(255).nullish(),
        assignedUserId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "write");

      try {
        return await assignFieldTask({
          taskId: input.taskId,
          userId: ctx.user.id,
          assigneeType: input.assigneeType,
          subcontractorId: input.subcontractorId ?? null,
          assigneeName: input.assigneeName ?? null,
          assignedUserId: input.assignedUserId ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  startTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        actualStartDate: isoDate.nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "write");

      try {
        return await transitionFieldTask({
          taskId: input.taskId,
          userId: ctx.user.id,
          to: "in_progress",
          actualStartDate: input.actualStartDate ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  completeTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        actualEndDate: isoDate.nullish(),
        actualHours: z.number().nonnegative().max(100000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "write");

      try {
        return await transitionFieldTask({
          taskId: input.taskId,
          userId: ctx.user.id,
          to: "completed",
          actualEndDate: input.actualEndDate ?? null,
          actualHours: input.actualHours ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Verify completed work. Requires `approve` because verification is the moment the
   * company accepts the work — and therefore its cost.
   */
  verifyTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        verificationNotes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "approve");

      try {
        return await transitionFieldTask({
          taskId: input.taskId,
          userId: ctx.user.id,
          to: "verified",
          verificationNotes: input.verificationNotes ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Block a task. The reason is mandatory (FO-005) — "blocked" with no cause is noise. */
  blockTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        today: z.never().optional(), // Date injection belongs only to trusted helper tests.
        blockReason: z.string().min(MIN_BLOCK_REASON_LENGTH).max(2000),
      }).passthrough(),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "write");

      try {
        return await transitionFieldTask({
          ...input,
          userId: ctx.user.id,
          to: "blocked",
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  unblockTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        to: z.enum(["assigned", "in_progress"]).default("assigned"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "write");

      try {
        return await transitionFieldTask({
          taskId: input.taskId,
          userId: ctx.user.id,
          to: input.to,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  cancelTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        today: z.never().optional(), // Date injection belongs only to trusted helper tests.
        reason: z.string().max(2000).nullish(),
      }).passthrough(),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "write");

      try {
        const { reason, ...command } = input;
        return await transitionFieldTask({ ...command, userId: ctx.user.id, to: "cancelled", blockReason: reason });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Generic transition, for clients that drive the state machine directly. */
  transitionTask: tenantProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        today: z.never().optional(), // Date injection belongs only to trusted helper tests.
        to: z.enum(FIELD_TASK_STATUSES),
        blockReason: z.string().max(2000).nullish(),
      }).passthrough(),
    )
    .mutation(async ({ input, ctx }) => {
      // Verification is an approval-level act even through the generic entry point.
      const permission = input.to === "verified" ? "approve" : "write";
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, permission);

      try {
        return await transitionFieldTask({ ...input, userId: ctx.user.id });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  deleteTask: tenantProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "delete");

      try {
        return { deleted: await deleteFieldTask(input.taskId, ctx.user.id) };
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  getProgress: tenantProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getFieldProgress(input.projectId);
    }),

  getStats: tenantProcedure
    .input(z.object({ projectId: z.string().uuid(), today: isoDate.optional() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getFieldTaskStats(input.projectId, input.today);
    }),

  listTaskEvents: tenantProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("fieldTask", input.taskId, ctx.user.id, "read");
      return listFieldTaskEvents(input.taskId);
    }),

  /** Execution authority is unavailable; legacy approvals remain readable elsewhere. */
  getBudgetEstimate: tenantProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      return executionAuthorityUnavailable();
    }),

  /** Internal/legacy approval never materializes field work, including on replay. */
  materializeChangeOrder: tenantProcedure
    .input(z.object({ changeOrderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("estimateDraft", input.changeOrderId, ctx.user.id, "write");

      try {
        return await materializeChangeOrderTasks({
          changeOrderId: input.changeOrderId,
          userId: ctx.user.id,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Task type vocabulary for the UI. */
  taskTypes: tenantProcedure.query(async () =>
    FIELD_TASK_TYPES.map((type) => ({ value: type, label: FIELD_TASK_TYPE_LABELS[type] })),
  ),
});
