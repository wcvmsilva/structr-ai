/**
 * structr.ai — PHASE 3 Actuals tRPC Router
 *
 * Procedures:
 *   - actuals.record            (protected) → book a real cost against the approved estimate
 *   - actuals.get               (protected) → one actual
 *   - actuals.list              (protected) → actuals of a project, filterable
 *   - actuals.approve           (protected, approve) → pending → approved
 *   - actuals.markPaid          (protected, approve) → approved → paid
 *   - actuals.reject            (protected, approve) → pending → rejected
 *   - actuals.void              (protected, approve) → → void
 *   - actuals.reviewVariance    (protected, approve) → register the variance review (CO-003)
 *   - actuals.delete            (protected, delete) → soft delete (pending only)
 *   - actuals.getVariance       (protected) → estimated vs actual per cost code
 *   - actuals.getBudget         (protected) → approved budget, committed cost, remaining
 *   - actuals.byCategory        (protected) → committed cost by category
 *   - actuals.pendingCount      (protected) → count of unapproved actuals
 *   - actuals.unreviewedVariance(protected) → critical variance awaiting review
 *   - actuals.categories        (protected) → category vocabulary
 *
 * Authorization: every procedure resolves the owning project and delegates to the Phase 1
 * project access guard. Approving, paying, rejecting and voiding require `approve`, since
 * they commit or release company money.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, tenantProcedure, router } from "./_core/trpc";
import { requireEntityAccess, requireProjectAccessTrpc } from "./project-access";
import {
  ActualsError,
  countPendingActuals,
  deleteActual,
  getActual,
  getActualsByCategory,
  getProjectBudget,
  getVarianceSnapshot,
  listActuals,
  listUnreviewedVarianceActuals,
  recordActual,
  reviewActualVariance,
  transitionActual,
} from "./actuals-db";
import {
  ACTUAL_COST_CATEGORIES,
  ACTUAL_STATUSES,
  VARIANCE_SEVERITIES,
} from "@shared/domain/phase3-taxonomy";
import { formatCents } from "@shared/actuals-variance-engine";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

/**
 * Money input.
 *
 * Cents are preferred; a dollar amount is accepted for operator-facing forms and converted
 * once, at the boundary. Both are never accepted together to keep the ledger unambiguous.
 */
const recordActualSchema = z
  .object({
    projectId: z.string().uuid(),
    costCodeId: z.string().uuid().nullish(),
    costCode: z.string().max(64).nullish(),
    costCodeName: z.string().max(255).nullish(),
    category: z.enum(ACTUAL_COST_CATEGORIES).optional(),
    description: z.string().max(2000).nullish(),
    amountCents: z.number().int().min(0).max(2_000_000_000).optional(),
    amount: z.number().min(0).max(20_000_000).optional(),
    estimatedAmountCents: z.number().int().min(0).max(2_000_000_000).nullish(),
    quantity: z.number().nonnegative().nullish(),
    unit: z.string().max(32).nullish(),
    laborHours: z.number().nonnegative().max(100000).nullish(),
    vendorName: z.string().max(255).nullish(),
    subcontractorId: z.string().uuid().nullish(),
    invoiceRef: z.string().max(128).nullish(),
    invoiceDate: isoDate.nullish(),
    dateIncurred: isoDate.nullish(),
    fieldTaskId: z.string().uuid().nullish(),
    estimateItemId: z.string().uuid().nullish(),
    assemblyId: z.string().uuid().nullish(),
    changeOrderId: z.string().uuid().nullish(),
    receiptUrl: z.string().url().max(2000).nullish(),
    notes: z.string().max(5000).nullish(),
  })
  .refine((v) => v.amountCents != null || v.amount != null, {
    message: "Provide the cost as amountCents (preferred) or amount.",
    path: ["amountCents"],
  })
  .refine((v) => !(v.amountCents != null && v.amount != null), {
    message: "Provide either amountCents or amount, not both — two sources of the same number drift.",
    path: ["amountCents"],
  })
  .refine((v) => !!v.costCodeId || !!(v.costCode && v.costCode.trim()), {
    message:
      "A cost code is required (AC-002). Uncoded cost cannot feed the price book and corrupts the next estimate.",
    path: ["costCode"],
  })
  .refine((v) => !!v.subcontractorId || !!(v.vendorName && v.vendorName.trim()), {
    message: "A payee is required (AC-005): either a subcontractor or a vendor name.",
    path: ["vendorName"],
  });

// ══════════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ══════════════════════════════════════════════════════════════════════

/** Map an ActualsError to the tRPC code the UI can act on. */
function toTrpcError(err: unknown): never {
  if (err instanceof ActualsError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      PROJECT_NOT_FOUND: "NOT_FOUND",
      ACTUAL_NOT_FOUND: "NOT_FOUND",
      TASK_NOT_FOUND: "NOT_FOUND",
      NO_APPROVED_ESTIMATE: "PRECONDITION_FAILED",
      CHANGE_ORDER_NOT_APPROVED: "PRECONDITION_FAILED",
      INVALID_ACTUAL_TRANSITION: "CONFLICT",
      DUPLICATE_INVOICE: "CONFLICT",
      COST_CODE_REQUIRED: "BAD_REQUEST",
      INVALID_AMOUNT: "BAD_REQUEST",
      ACTUAL_VALIDATION_FAILED: "BAD_REQUEST",
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

export const actualsRouter = router({
  /**
   * Book a real cost.
   * Rejected without an approved estimate (AC-001) or a cost code (AC-002): those two
   * rules are what keep the actuals usable as price-book feedback instead of a cost dump.
   */
  record: tenantProcedure
    .input(recordActualSchema)
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");

      try {
        return await recordActual({
          projectId: input.projectId,
          userId: ctx.user.id,
          tenantId: ctx.tenantId,
          costCodeId: input.costCodeId ?? null,
          costCode: input.costCode ?? null,
          costCodeName: input.costCodeName ?? null,
          category: input.category ?? null,
          description: input.description ?? null,
          amountCents: input.amountCents ?? null,
          amount: input.amount ?? null,
          estimatedAmountCents: input.estimatedAmountCents ?? null,
          quantity: input.quantity ?? null,
          unit: input.unit ?? null,
          laborHours: input.laborHours ?? null,
          vendorName: input.vendorName ?? null,
          subcontractorId: input.subcontractorId ?? null,
          invoiceRef: input.invoiceRef ?? null,
          invoiceDate: input.invoiceDate ?? null,
          dateIncurred: input.dateIncurred ?? null,
          fieldTaskId: input.fieldTaskId ?? null,
          estimateItemId: input.estimateItemId ?? null,
          assemblyId: input.assemblyId ?? null,
          changeOrderId: input.changeOrderId ?? null,
          receiptUrl: input.receiptUrl ?? null,
          notes: input.notes ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  get: protectedProcedure
    .input(z.object({ actualId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("costActual", input.actualId, ctx.user.id, "read");

      const actual = await getActual(input.actualId);
      if (!actual) throw new TRPCError({ code: "NOT_FOUND", message: "Actual not found" });

      return {
        actual,
        formatted: {
          amount: formatCents(actual.amountCents),
          estimated: formatCents(actual.estimatedAmountCents ?? 0),
          variance: formatCents(actual.varianceCents ?? 0),
        },
      };
    }),

  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        status: z.union([z.enum(ACTUAL_STATUSES), z.array(z.enum(ACTUAL_STATUSES))]).optional(),
        costCode: z.string().max(64).optional(),
        costCodeId: z.string().uuid().optional(),
        subcontractorId: z.string().uuid().optional(),
        fieldTaskId: z.string().uuid().optional(),
        changeOrderId: z.string().uuid().optional(),
        baselineOnly: z.boolean().optional(),
        severity: z.enum(VARIANCE_SEVERITIES).optional(),
        limit: z.number().int().min(1).max(2000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return listActuals(input);
    }),

  /** Approve a cost. This is the moment the money is committed against the budget. */
  approve: protectedProcedure
    .input(z.object({ actualId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("costActual", input.actualId, ctx.user.id, "approve");

      try {
        return await transitionActual({
          actualId: input.actualId,
          userId: ctx.user.id,
          to: "approved",
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  markPaid: protectedProcedure
    .input(z.object({ actualId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("costActual", input.actualId, ctx.user.id, "approve");

      try {
        return await transitionActual({
          actualId: input.actualId,
          userId: ctx.user.id,
          to: "paid",
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  reject: protectedProcedure
    .input(
      z.object({
        actualId: z.string().uuid(),
        reason: z.string().min(5).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("costActual", input.actualId, ctx.user.id, "approve");

      try {
        return await transitionActual({
          actualId: input.actualId,
          userId: ctx.user.id,
          to: "rejected",
          reason: input.reason,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  void: protectedProcedure
    .input(
      z.object({
        actualId: z.string().uuid(),
        reason: z.string().min(5).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("costActual", input.actualId, ctx.user.id, "approve");

      try {
        return await transitionActual({
          actualId: input.actualId,
          userId: ctx.user.id,
          to: "void",
          reason: input.reason,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Register the human review of a critical or unbudgeted variance.
   * Closeout is blocked until every such cost has an explanation attached (CO-003).
   */
  reviewVariance: protectedProcedure
    .input(
      z.object({
        actualId: z.string().uuid(),
        varianceReason: z.string().min(10).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("costActual", input.actualId, ctx.user.id, "approve");

      try {
        return await reviewActualVariance({
          actualId: input.actualId,
          userId: ctx.user.id,
          varianceReason: input.varianceReason,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ actualId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("costActual", input.actualId, ctx.user.id, "delete");

      try {
        return { deleted: await deleteActual(input.actualId, ctx.user.id) };
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Estimated vs actual, per cost code, with severity and alerts. */
  getVariance: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const snapshot = await getVarianceSnapshot(input.projectId);
      return {
        ...snapshot,
        formatted: {
          totalEstimated: formatCents(snapshot.totalEstimatedCents),
          totalActual: formatCents(snapshot.totalActualCents),
          variance: formatCents(snapshot.varianceCents),
        },
      };
    }),

  /** Approved budget, committed cost and remaining budget. */
  getBudget: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const budget = await getProjectBudget(input.projectId);
      return {
        ...budget,
        formatted: {
          approvedBudget: formatCents(budget.totalBudgetCents),
          committed: formatCents(budget.committedCents),
          pending: formatCents(budget.pendingCents),
          available: formatCents(budget.availableCents),
        },
      };
    }),

  byCategory: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const rows = await getActualsByCategory(input.projectId);
      return rows.map((r) => ({ ...r, amount: formatCents(r.amountCents) }));
    }),

  pendingCount: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return { pendingCount: await countPendingActuals(input.projectId) };
    }),

  unreviewedVariance: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const rows = await listUnreviewedVarianceActuals(input.projectId);
      return rows.map((r) => ({
        id: r.id,
        costCode: r.costCode,
        description: r.description,
        amountCents: r.amountCents,
        amount: formatCents(r.amountCents),
        estimatedAmountCents: r.estimatedAmountCents,
        varianceCents: r.varianceCents,
        variancePct: r.variancePct != null ? Number(r.variancePct) : null,
        severity: r.varianceSeverity,
        status: r.status,
      }));
    }),

  /** Cost category vocabulary for the UI. */
  categories: protectedProcedure.query(async () =>
    ACTUAL_COST_CATEGORIES.map((category) => ({
      value: category,
      label: category
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    })),
  ),
});
