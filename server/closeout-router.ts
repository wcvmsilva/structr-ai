/**
 * structr.ai — PHASE 3 Closeout tRPC Router
 *
 * Procedures:
 *   - closeout.getReadiness    (protected) → can closeout open? what blocks it?
 *   - closeout.open            (protected) → open closeout (CO-001 gate)
 *   - closeout.get             (protected) → closeout + checklist + blockers
 *   - closeout.updateChecklist (protected) → update checklist items
 *   - closeout.markReady       (protected, approve) → → ready_to_close (CO-002 gate)
 *   - closeout.transition      (protected) → generic non-closing transition
 *   - closeout.close           (protected, approve) → close + snapshot final variance (CO-003)
 *   - closeout.getFinalReport  (protected) → final variance report (persisted if closed)
 *   - closeout.previewReport   (protected) → recomputed report, before closing
 *
 * Authorization: every procedure resolves the owning project and delegates to the Phase 1
 * project access guard. Marking ready and closing require `approve`: closing a project
 * finalizes the numbers that will feed the price book.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { requireEntityAccess, requireProjectAccessTrpc } from "./project-access";
import {
  buildProjectFinalReport,
  closeProject,
  CloseoutError,
  getCloseoutByProject,
  getCloseoutReadiness,
  getCloseoutStatus,
  openCloseout,
  transitionCloseout,
  updateCloseoutChecklist,
} from "./closeout-db";
import { CLOSEOUT_STATUSES } from "@shared/domain/phase3-taxonomy";
import { formatCents } from "@shared/actuals-variance-engine";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

// ══════════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ══════════════════════════════════════════════════════════════════════

/** Map a CloseoutError to the tRPC code the UI can act on. */
function toTrpcError(err: unknown): never {
  if (err instanceof CloseoutError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      PROJECT_NOT_FOUND: "NOT_FOUND",
      CLOSEOUT_NOT_FOUND: "NOT_FOUND",
      CLOSEOUT_ALREADY_EXISTS: "CONFLICT",
      CLOSEOUT_LOCKED: "CONFLICT",
      INVALID_CLOSEOUT_TRANSITION: "CONFLICT",
      CLOSEOUT_BLOCKED_OPEN_TASKS: "PRECONDITION_FAILED",
      CLOSEOUT_CHECKLIST_INCOMPLETE: "PRECONDITION_FAILED",
      CLOSEOUT_PENDING_ACTUALS: "PRECONDITION_FAILED",
      CLOSEOUT_VARIANCE_UNREVIEWED: "PRECONDITION_FAILED",
      NO_APPROVED_ESTIMATE: "PRECONDITION_FAILED",
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

export const closeoutRouter = router({
  /**
   * Can closeout be opened? Reported before the attempt so the operator sees the open
   * tasks instead of hitting a wall at the moment the client asks for the final invoice.
   */
  getReadiness: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getCloseoutReadiness(input.projectId);
    }),

  open: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");

      try {
        return await openCloseout({
          projectId: input.projectId,
          userId: ctx.user.id,
          tenantId: ctx.tenantId ?? null,
          notes: input.notes ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Full closeout status: record, checklist, counts and blockers. */
  get: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getCloseoutStatus(input.projectId);
    }),

  updateChecklist: protectedProcedure
    .input(
      z.object({
        closeoutId: z.string().uuid(),
        finalInspectionPassed: z.boolean().optional(),
        finalInspectionDate: isoDate.nullish(),
        punchListComplete: z.boolean().optional(),
        punchListItemCount: z.number().int().min(0).max(10000).optional(),
        lienWaiversCollected: z.boolean().optional(),
        lienWaiverCount: z.number().int().min(0).max(10000).optional(),
        finalPaymentReceived: z.boolean().optional(),
        finalPaymentCents: z.number().int().min(0).max(2_000_000_000).nullish(),
        finalPaymentDate: isoDate.nullish(),
        warrantyDocsDelivered: z.boolean().optional(),
        warrantyDocsRef: z.string().max(1000).nullish(),
        warrantyExpiry: isoDate.nullish(),
        clientSatisfactionScore: z.number().int().min(0).max(10).nullish(),
        clientFeedback: z.string().max(5000).nullish(),
        lessonsLearned: z.string().max(10000).nullish(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("closeout", input.closeoutId, ctx.user.id, "write");

      try {
        return await updateCloseoutChecklist({ ...input, userId: ctx.user.id });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Declare the checklist complete. Requires `approve`. */
  markReady: protectedProcedure
    .input(z.object({ closeoutId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("closeout", input.closeoutId, ctx.user.id, "approve");

      try {
        return await transitionCloseout({
          closeoutId: input.closeoutId,
          userId: ctx.user.id,
          to: "ready_to_close",
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Generic transition. Closing is rejected here on purpose — use `close`. */
  transition: protectedProcedure
    .input(
      z.object({
        closeoutId: z.string().uuid(),
        to: z.enum(CLOSEOUT_STATUSES),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const permission = input.to === "ready_to_close" ? "approve" : "write";
      await requireEntityAccess("closeout", input.closeoutId, ctx.user.id, permission);

      try {
        return await transitionCloseout({
          closeoutId: input.closeoutId,
          userId: ctx.user.id,
          to: input.to,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Close the project.
   * Blocked while any actual is pending or any critical variance is unreviewed (CO-003):
   * the final report must be a definitive number, not a snapshot that can still move.
   */
  close: protectedProcedure
    .input(
      z.object({
        closeoutId: z.string().uuid(),
        lessonsLearned: z.string().max(10000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("closeout", input.closeoutId, ctx.user.id, "approve");

      try {
        const result = await closeProject({
          closeoutId: input.closeoutId,
          userId: ctx.user.id,
          lessonsLearned: input.lessonsLearned ?? null,
        });

        return {
          closeout: result.closeout,
          report: result.report,
          formatted: {
            totalEstimated: formatCents(result.report.totalEstimatedCents),
            totalActual: formatCents(result.report.totalActualCents),
            variance: formatCents(result.report.varianceCents),
            realizedGrossProfit:
              result.report.realizedGrossProfitCents != null
                ? formatCents(result.report.realizedGrossProfitCents)
                : null,
          },
        };
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Final variance report.
   * Returns the persisted snapshot for a closed project and a live computation otherwise —
   * a closed project must keep the numbers it was closed with.
   */
  getFinalReport: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const closeout = await getCloseoutByProject(input.projectId);

      if (closeout?.status === "closed" && closeout.varianceReport) {
        return { source: "snapshot" as const, report: closeout.varianceReport, closeout };
      }

      const report = await buildProjectFinalReport(input.projectId);
      return { source: "live" as const, report, closeout };
    }),

  /** Recomputed report, for reviewing the numbers before closing. */
  previewReport: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const report = await buildProjectFinalReport(input.projectId);
      return {
        report,
        formatted: {
          totalEstimated: formatCents(report.totalEstimatedCents),
          totalActual: formatCents(report.totalActualCents),
          variance: formatCents(report.varianceCents),
        },
      };
    }),
});
