/**
 * Sprint 21 — Field Launch Control Router
 *
 * tRPC procedures for:
 *   - Feature flag management
 *   - Monitoring dashboard
 *   - Field feedback CRUD
 *   - Project actuals + variance detection
 */

import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import {
  // Feature flags
  getSystemSetting,
  setSystemSetting,
  isFieldLaunchEnabled,
  setFieldLaunchMode,
  listSystemSettings,
  // Monitoring
  getMonitoringMetrics,
  getEstimateStatusDistribution,
  getRecentAuditActivity,
  // Field feedback
  createFieldFeedback,
  listFieldFeedback,
  getFieldFeedbackById,
  resolveFieldFeedback,
  dismissFieldFeedback,
  getFieldFeedbackStats,
  // Project actuals
  recordProjectActual,
  listProjectActuals,
  getProjectActualById,
  getVarianceSummary,
} from "./field-launch-db";

export const fieldLaunchRouter = router({
  // ══════════════════════════════════════════════════════════════
  // FEATURE FLAGS
  // ══════════════════════════════════════════════════════════════

  getFieldLaunchMode: protectedProcedure.query(async () => {
    return { enabled: await isFieldLaunchEnabled() };
  }),

  setFieldLaunchMode: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const before = await isFieldLaunchEnabled();
      const result = await setFieldLaunchMode(input.enabled, ctx.user.id);
      logAudit({
        userId: ctx.user.id,
        action: "field_launch_mode_enabled",
        tableName: "system_settings",
        recordId: result.id,
        before: { enabled: before },
        after: { enabled: input.enabled },
      });
      return { enabled: input.enabled };
    }),

  getSetting: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      return getSystemSetting(input.key);
    }),

  setSetting: adminProcedure
    .input(z.object({
      key: z.string().min(1).max(128),
      value: z.string(),
      description: z.string().max(512).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getSystemSetting(input.key);
      const result = await setSystemSetting(input.key, input.value, input.description, ctx.user.id);
      logAudit({
        userId: ctx.user.id,
        action: "system_setting_changed",
        tableName: "system_settings",
        recordId: result.id,
        before,
        after: result,
      });
      return result;
    }),

  listSettings: protectedProcedure.query(async () => {
    return listSystemSettings();
  }),

  // ══════════════════════════════════════════════════════════════
  // MONITORING DASHBOARD
  // ══════════════════════════════════════════════════════════════

  monitoringMetrics: protectedProcedure.query(async () => {
    return getMonitoringMetrics();
  }),

  estimateStatusDistribution: protectedProcedure.query(async () => {
    return getEstimateStatusDistribution();
  }),

  recentActivity: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      return getRecentAuditActivity(input?.limit ?? 20);
    }),

  // ══════════════════════════════════════════════════════════════
  // FIELD FEEDBACK
  // ══════════════════════════════════════════════════════════════

  submitFeedback: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid().optional(),
      estimateId: z.string().uuid().optional(),
      issueType: z.enum([
        "pricing_inaccuracy",
        "scope_mismatch",
        "material_unavailable",
        "labor_shortage",
        "timeline_issue",
        "quality_concern",
        "client_complaint",
        "safety_issue",
        "other",
      ]),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      description: z.string().min(10, "Description must be at least 10 characters").max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      const report = await createFieldFeedback({
        ...input,
        projectId: input.projectId ?? null,
        estimateId: input.estimateId ?? null,
        userId: ctx.user.id,
      });
      logAudit({
        userId: ctx.user.id,
        action: "field_feedback_submitted",
        tableName: "field_feedback_reports",
        recordId: report.id,
        before: null,
        after: report,
      });
      return report;
    }),

  listFeedback: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid().optional(),
      estimateId: z.string().uuid().optional(),
      status: z.enum(["open", "in_review", "resolved", "dismissed"]).optional(),
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return listFieldFeedback(input ?? undefined);
    }),

  getFeedback: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const report = await getFieldFeedbackById(input.id);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Feedback report not found" });
      return report;
    }),

  resolveFeedback: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      resolution: z.string().min(1).max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getFieldFeedbackById(input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Feedback report not found" });
      const result = await resolveFieldFeedback(input.id, input.resolution, ctx.user.id);
      logAudit({
        userId: ctx.user.id,
        action: "field_feedback_resolved",
        tableName: "field_feedback_reports",
        recordId: input.id,
        before,
        after: result,
      });
      return result;
    }),

  dismissFeedback: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const before = await getFieldFeedbackById(input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Feedback report not found" });
      await dismissFieldFeedback(input.id);
      logAudit({
        userId: ctx.user.id,
        action: "field_feedback_dismissed",
        tableName: "field_feedback_reports",
        recordId: input.id,
        before,
        after: { ...before, status: "dismissed" },
      });
      return { success: true };
    }),

  feedbackStats: protectedProcedure.query(async () => {
    return getFieldFeedbackStats();
  }),

  // ══════════════════════════════════════════════════════════════
  // PROJECT ACTUALS + VARIANCE
  // ══════════════════════════════════════════════════════════════

  recordActual: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      estimateId: z.string().uuid().optional(),
      assemblyId: z.string().uuid().optional(),
      assemblyName: z.string().max(255).optional(),
      lineItemDescription: z.string().max(512).optional(),
      unit: z.string().max(32).optional(),
      estimatedQty: z.number().min(0).optional(),
      actualQty: z.number().min(0).optional(),
      estimatedUnitCost: z.number().min(0).optional(),
      actualUnitCost: z.number().min(0).optional(),
      estimatedTotalCost: z.number().min(0),
      actualTotalCost: z.number().min(0),
      varianceReason: z.string().max(2000).optional(),
      trade: z.string().max(128).optional(),
      category: z.string().max(128).optional(),
      region: z.string().max(128).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actual = await recordProjectActual({
        projectId: input.projectId,
        estimateDraftId: input.estimateId ?? null,
        assemblyId: input.assemblyId ?? null,
        assemblyName: input.assemblyName ?? null,
        lineItemDescription: input.lineItemDescription ?? null,
        unit: input.unit ?? null,
        estimatedQty: input.estimatedQty?.toString() ?? "0",
        actualQty: input.actualQty?.toString() ?? "0",
        estimatedUnitCost: input.estimatedUnitCost?.toString() ?? null,
        actualUnitCost: input.actualUnitCost?.toString() ?? null,
        estimatedTotalCost: input.estimatedTotalCost.toFixed(2),
        actualTotalCost: input.actualTotalCost.toFixed(2),
        varianceReason: input.varianceReason ?? null,
        trade: input.trade ?? null,
        category: input.category ?? null,
        region: input.region ?? null,
        recordedBy: ctx.user.id,
      } as any);

      // Log audit
      logAudit({
        userId: ctx.user.id,
        action: "actuals_recorded",
        tableName: "project_actuals",
        recordId: actual.id,
        before: null,
        after: actual,
      });

      // Check for high variance and log alert
      if (actual.isHighVariance) {
        logAudit({
          userId: ctx.user.id,
          action: "high_variance_detected",
          tableName: "project_actuals",
          recordId: actual.id,
          before: null,
          after: {
            projectId: input.projectId,
            estimatedCost: input.estimatedTotalCost,
            actualCost: input.actualTotalCost,
            variancePct: actual.variancePct,
          },
        });
      }

      return actual;
    }),

  listActuals: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid().optional(),
      estimateId: z.string().uuid().optional(),
      highVarianceOnly: z.boolean().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return listProjectActuals(input ?? undefined);
    }),

  getActual: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const actual = await getProjectActualById(input.id);
      if (!actual) throw new TRPCError({ code: "NOT_FOUND", message: "Project actual not found" });
      return actual;
    }),

  varianceSummary: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVarianceSummary(input.projectId);
    }),
});
