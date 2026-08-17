/**
 * structr.ai — PHASE 4 Analytics tRPC Router
 *
 * Procedures:
 *   - analytics.getDashboard      (protected) → the whole operator dashboard
 *   - analytics.getPipeline       (protected) → commercial pipeline (AN-001)
 *   - analytics.getForecast       (protected) → revenue forecast (AN-002)
 *   - analytics.getProfitHealth   (protected) → margin health vs floors (AN-003)
 *   - analytics.getFieldProgress  (protected) → schedule health (AN-004)
 *   - analytics.getSubcontractors (protected) → subcontractor leaderboard
 *   - analytics.saveSnapshot      (protected, admin) → freeze a period
 *   - analytics.getSnapshot       (protected) → read a frozen period
 *   - analytics.listSnapshots     (protected) → snapshot index
 *
 * Every procedure derives the tenant from `ctx.tenantId`. No procedure accepts a tenant
 * parameter: a dashboard that can be pointed at another tenant is not a dashboard.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  getDashboard,
  getFieldProgressAnalytics,
  getPipeline,
  getProfitHealth,
  getRevenueForecast,
  getSnapshot,
  getSubcontractorLeaderboard,
  listSnapshots,
  saveSnapshot,
} from "./analytics-db";
import { ANALYTICS_SNAPSHOT_TYPES } from "@shared/domain/phase4-taxonomy";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

function requireTenant(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant in session. Analytics are tenant-scoped.",
    });
  }
  return tenantId;
}

export const analyticsRouter = router({
  /** One call for the whole dashboard, so the UI does not fan out seven requests. */
  getDashboard: protectedProcedure
    .input(
      z
        .object({ monthCount: z.number().int().min(1).max(24).default(6) })
        .default({ monthCount: 6 }),
    )
    .query(async ({ input, ctx }) => {
      return getDashboard({
        tenantId: requireTenant(ctx.tenantId),
        monthCount: input.monthCount,
      });
    }),

  getPipeline: protectedProcedure.query(async ({ ctx }) => {
    return getPipeline({ tenantId: requireTenant(ctx.tenantId) });
  }),

  getForecast: protectedProcedure
    .input(
      z
        .object({ monthCount: z.number().int().min(1).max(24).default(6) })
        .default({ monthCount: 6 }),
    )
    .query(async ({ input, ctx }) => {
      return getRevenueForecast({
        tenantId: requireTenant(ctx.tenantId),
        monthCount: input.monthCount,
      });
    }),

  getProfitHealth: protectedProcedure
    .input(
      z
        .object({ from: isoDate.nullish(), to: isoDate.nullish() })
        .default({ from: null, to: null }),
    )
    .query(async ({ input, ctx }) => {
      return getProfitHealth({
        tenantId: requireTenant(ctx.tenantId),
        from: input.from ?? null,
        to: input.to ?? null,
      });
    }),

  getFieldProgress: protectedProcedure.query(async ({ ctx }) => {
    return getFieldProgressAnalytics({ tenantId: requireTenant(ctx.tenantId) });
  }),

  getSubcontractors: protectedProcedure.query(async ({ ctx }) => {
    return getSubcontractorLeaderboard({ tenantId: requireTenant(ctx.tenantId) });
  }),

  /**
   * Freeze an aggregation for a period.
   *
   * Admin-only because a frozen snapshot is what a closed month reports afterwards; overwriting
   * one silently rewrites history the company may already have acted on.
   */
  saveSnapshot: adminProcedure
    .input(
      z.object({
        snapshotType: z.enum(ANALYTICS_SNAPSHOT_TYPES),
        period: z.enum(["month", "quarter", "year", "all_time"]).default("month"),
        periodStart: isoDate.nullish(),
        periodEnd: isoDate.nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);

      // The payload is computed server-side rather than accepted from the client: a snapshot the
      // caller can dictate is not evidence of anything.
      const payload =
        input.snapshotType === "pipeline"
          ? await getPipeline({ tenantId })
          : input.snapshotType === "revenue_forecast"
            ? await getRevenueForecast({ tenantId })
            : input.snapshotType === "profit_health"
              ? await getProfitHealth({
                  tenantId,
                  from: input.periodStart ?? null,
                  to: input.periodEnd ?? null,
                })
              : input.snapshotType === "field_progress"
                ? await getFieldProgressAnalytics({ tenantId })
                : await getSubcontractorLeaderboard({ tenantId });

      return saveSnapshot({
        tenantId,
        snapshotType: input.snapshotType,
        period: input.period,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        payload,
        actorId: ctx.user.id,
      });
    }),

  getSnapshot: protectedProcedure
    .input(z.object({ snapshotKey: z.string().min(1).max(200) }))
    .query(async ({ input, ctx }) => {
      const snapshot = await getSnapshot({
        tenantId: requireTenant(ctx.tenantId),
        snapshotKey: input.snapshotKey,
      });

      if (!snapshot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found." });
      }

      return snapshot;
    }),

  listSnapshots: protectedProcedure
    .input(
      z
        .object({
          snapshotType: z.enum(ANALYTICS_SNAPSHOT_TYPES).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({ limit: 50 }),
    )
    .query(async ({ input, ctx }) => {
      return listSnapshots({
        tenantId: requireTenant(ctx.tenantId),
        snapshotType: input.snapshotType,
        limit: input.limit,
      });
    }),
});
