/**
 * structr.ai — PHASE 4 Price Adjustment tRPC Router
 *
 * Procedures:
 *   - priceAdjustment.propose         (protected, approve) → create a proposal
 *   - priceAdjustment.proposeFromRun  (protected, admin)   → proposals from a calibration report
 *   - priceAdjustment.list            (protected)          → adjustments, tenant-scoped
 *   - priceAdjustment.get             (protected)          → adjustment + source finding
 *   - priceAdjustment.previewImpact   (protected)          → money impact before approving
 *   - priceAdjustment.approve         (protected, admin)   → human approval (PA-002)
 *   - priceAdjustment.reject          (protected, admin)   → reject with reason
 *   - priceAdjustment.applyToPriceBook (protected, admin)  → write the price book (PA-004)
 *   - priceAdjustment.rollback        (protected, admin)   → exact restoration
 *   - priceAdjustment.getSummary      (protected)          → dashboard counts
 *
 * Authorization: approving, applying and rolling back are `adminProcedure`. These are the only
 * procedures in the platform that change what every future estimate charges, so they are held
 * to the highest bar available rather than to project-level `approve`.
 *
 * There is deliberately no `applyAll` / `approveAll` procedure. Bulk-approving repricing is how
 * a price book moves 15% in an afternoon with nobody able to say which finding justified it.
 *
 * Naming note: the write procedure is `applyToPriceBook`, not `apply`. tRPC v11 reserves `apply`
 * (it collides with `Function.prototype.apply` on the router proxy) and a router declaring it
 * throws at construction time, taking the whole `appRouter` down with it.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  applyAdjustment,
  approveAdjustment,
  getAdjustment,
  getAdjustmentSummary,
  getAdjustmentWithSource,
  listAdjustments,
  previewImpact,
  PriceAdjustmentError,
  proposeAdjustment,
  proposeFromFindings,
  rejectAdjustment,
  rollbackAdjustment,
} from "./price-adjustment-db";
import { getCalibrationReport } from "./calibration-db";
import {
  MAX_ADJUSTMENT_PCT,
  PRICE_ADJUSTMENT_TARGETS,
} from "@shared/domain/phase4-taxonomy";
import type { CalibrationFinding } from "@shared/calibration-engine";

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

function requireTenant(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant in session. Price adjustments are tenant-scoped.",
    });
  }
  return tenantId;
}

function toTrpcError(err: unknown): never {
  if (err instanceof PriceAdjustmentError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      ADJUSTMENT_NOT_FOUND: "NOT_FOUND",
      TARGET_NOT_FOUND: "NOT_FOUND",
      ADJUSTMENT_VALIDATION_FAILED: "BAD_REQUEST",
      ADJUSTMENT_CAP_EXCEEDED: "BAD_REQUEST",
      ADJUSTMENT_NOT_APPROVED: "PRECONDITION_FAILED",
      MISSING_ROLLBACK_SNAPSHOT: "PRECONDITION_FAILED",
      ROLLBACK_INTEGRITY_FAILED: "INTERNAL_SERVER_ERROR",
      INVALID_ADJUSTMENT_TRANSITION: "CONFLICT",
      ADJUSTMENT_TERMINAL: "CONFLICT",
      DUPLICATE_LIVE_ADJUSTMENT: "CONFLICT",
      AUTO_APPLY_FORBIDDEN: "FORBIDDEN",
      TENANT_MISMATCH: "FORBIDDEN",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

/** Load an adjustment and confirm it belongs to the caller's tenant. */
async function requireOwnAdjustment(
  adjustmentId: string,
  tenantId: string,
): Promise<void> {
  const adjustment = await getAdjustment(adjustmentId);
  if (!adjustment || adjustment.tenantId !== tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Price adjustment not found." });
  }
}

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const priceAdjustmentRouter = router({
  /**
   * Create a proposal manually.
   *
   * Manual proposals exist because an operator sometimes knows something the data does not yet:
   * a supplier announced a 9% increase effective next month. The engine flags them as
   * unsupported by evidence, and they still require the same approval path.
   */
  propose: protectedProcedure
    .input(
      z.object({
        targetType: z.enum(PRICE_ADJUSTMENT_TARGETS),
        costCodeId: z.string().uuid().nullish(),
        costCode: z.string().max(50).nullish(),
        assemblyId: z.string().uuid().nullish(),
        geoZoneId: z.string().uuid().nullish(),
        trade: z.string().max(100).nullish(),
        adjustmentPct: z
          .number()
          .min(-MAX_ADJUSTMENT_PCT)
          .max(MAX_ADJUSTMENT_PCT),
        reason: z.string().min(10).max(5000),
        effectiveFrom: isoDate.nullish(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await proposeAdjustment({
          tenantId: requireTenant(ctx.tenantId),
          targetType: input.targetType,
          costCodeId: input.costCodeId ?? null,
          costCode: input.costCode ?? null,
          assemblyId: input.assemblyId ?? null,
          geoZoneId: input.geoZoneId ?? null,
          trade: input.trade ?? null,
          adjustmentPct: input.adjustmentPct,
          reason: input.reason,
          actorId: ctx.user.id,
          source: "manual",
          effectiveFrom: input.effectiveFrom ?? null,
          notes: input.notes ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Turn the actionable findings of a calibration report into proposals.
   *
   * Returns both what was created and what was skipped, with the reason for each skip.
   */
  proposeFromRun: adminProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      const report = await getCalibrationReport(input.reportId);

      if (!report || report.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Calibration report not found." });
      }

      const findings = (report.proposedAdjustments ?? []) as CalibrationFinding[];
      if (!Array.isArray(findings) || findings.length === 0) {
        return { created: [], proposals: [], skipped: [] };
      }

      try {
        return await proposeFromFindings({
          tenantId,
          findings,
          actorId: ctx.user.id,
          sourceReportId: input.reportId,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  list: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["proposed", "approved", "applied", "rejected", "rolled_back"])
          .optional(),
        targetType: z.enum(PRICE_ADJUSTMENT_TARGETS).optional(),
        costCodeId: z.string().uuid().optional(),
        pendingOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      return listAdjustments({
        tenantId: requireTenant(ctx.tenantId),
        status: input.status,
        targetType: input.targetType,
        costCodeId: input.costCodeId,
        pendingOnly: input.pendingOnly,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  get: protectedProcedure
    .input(z.object({ adjustmentId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      const result = await getAdjustmentWithSource(input.adjustmentId);

      if (!result || result.adjustment.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Price adjustment not found." });
      }

      return result;
    }),

  /** Money impact of a proposal, so the decision is made in dollars rather than percent. */
  previewImpact: protectedProcedure
    .input(
      z.object({
        adjustmentId: z.string().uuid(),
        historicalVolumeCents: z.number().int().min(0).optional(),
        representativeMarginPct: z.number().min(0).max(100).nullish(),
        costShareOfJob: z.number().min(0).max(1).nullish(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      await requireOwnAdjustment(input.adjustmentId, tenantId);

      try {
        return await previewImpact({
          adjustmentId: input.adjustmentId,
          tenantId,
          historicalVolumeCents: input.historicalVolumeCents,
          representativeMarginPct: input.representativeMarginPct ?? null,
          costShareOfJob: input.costShareOfJob ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** PA-002: the named human approval. Approval alone changes no price. */
  approve: adminProcedure
    .input(
      z.object({
        adjustmentId: z.string().uuid(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      await requireOwnAdjustment(input.adjustmentId, tenantId);

      try {
        return await approveAdjustment({
          adjustmentId: input.adjustmentId,
          actorId: ctx.user.id,
          tenantId,
          notes: input.notes ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  reject: adminProcedure
    .input(
      z.object({
        adjustmentId: z.string().uuid(),
        reason: z.string().min(10).max(5000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      await requireOwnAdjustment(input.adjustmentId, tenantId);

      try {
        return await rejectAdjustment({
          adjustmentId: input.adjustmentId,
          actorId: ctx.user.id,
          reason: input.reason,
          tenantId,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Write the approved adjustment into the price book.
   *
   * Separate from `approve` on purpose: an owner can approve a change today and schedule the
   * price move for the start of next month, without the price book silently drifting between
   * the two moments.
   */
  applyToPriceBook: adminProcedure
    .input(
      z.object({
        adjustmentId: z.string().uuid(),
        effectiveDate: isoDate.nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      await requireOwnAdjustment(input.adjustmentId, tenantId);

      try {
        return await applyAdjustment({
          adjustmentId: input.adjustmentId,
          actorId: ctx.user.id,
          tenantId,
          effectiveDate: input.effectiveDate ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** PA-004: restore the exact previous price from the snapshot captured on apply. */
  rollback: adminProcedure
    .input(
      z.object({
        adjustmentId: z.string().uuid(),
        reason: z.string().min(10).max(5000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      await requireOwnAdjustment(input.adjustmentId, tenantId);

      try {
        return await rollbackAdjustment({
          adjustmentId: input.adjustmentId,
          actorId: ctx.user.id,
          reason: input.reason,
          tenantId,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  getSummary: protectedProcedure.query(async ({ ctx }) => {
    return getAdjustmentSummary(requireTenant(ctx.tenantId));
  }),
});
