/**
 * Sprint 22 — Learning Layer Router
 *
 * Separate analytics pipeline — does NOT modify deterministic engines.
 * Provides tRPC procedures for variance events, assembly metrics,
 * calibration suggestions, and the learning dashboard.
 */

import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import {
  // Variance events
  createVarianceEvent,
  createVarianceEventsFromActuals,
  listVarianceEvents,
  getVarianceEventsByAssembly,
  // Assembly metrics
  refreshAssemblyMetrics,
  refreshAllAssemblyMetrics,
  listAssemblyMetrics,
  getAssemblyMetricsById,
  getHighestVarianceAssemblies,
  getConsistentOverruns,
  getConsistentUnderruns,
  // Calibration suggestions
  generateCalibrationSuggestions,
  listCalibrationSuggestions,
  reviewCalibrationSuggestion,
  getCalibrationSuggestionById,
  // Dashboard
  getLearningDashboardSummary,
} from "./learning-layer-db";

export const learningLayerRouter = router({
  // ══════════════════════════════════════════════════════════
  // VARIANCE EVENTS
  // ══════════════════════════════════════════════════════════

  /** Ingest variance events from project actuals */
  ingestVarianceEvents: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      estimateId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const events = await createVarianceEventsFromActuals(input.projectId, input.estimateId);
      logAudit({
        userId: ctx.user.id,
        action: "learning.variance_events_ingested",
        tableName: "estimate_variance_events",
        recordId: input.estimateId,
        before: null,
        after: { projectId: input.projectId, eventsCreated: events.length },
      });
      return { eventsCreated: events.length, events };
    }),

  /** Create a single variance event manually */
  createVarianceEvent: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      estimateId: z.string().uuid(),
      assemblyId: z.string().uuid(),
      assemblyName: z.string().optional(),
      estimatedCost: z.string(),
      actualCost: z.string(),
      variancePct: z.string(),
      varianceAmount: z.string(),
      varianceType: z.enum(["labor_variance", "material_variance", "waste_variance", "scope_variance"]),
      varianceDirection: z.enum(["overrun", "underrun"]).optional(),
      trade: z.string().optional(),
      region: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const event = await createVarianceEvent({
        projectId: input.projectId,
        estimateItemId: input.estimateId,
        costCodeId: input.assemblyId,
        eventType: input.varianceType,
        estimatedValue: input.estimatedCost,
        actualValue: input.actualCost,
        variancePct: input.variancePct,
        notes: input.notes,
      });
      logAudit({
        userId: ctx.user.id,
        action: "learning.variance_event_created",
        tableName: "estimate_variance_events",
        recordId: event.id,
        before: null,
        after: event,
      });
      return event;
    }),

  /** List variance events with filters */
  listVarianceEvents: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid().optional(),
      estimateId: z.string().uuid().optional(),
      assemblyId: z.string().uuid().optional(),
      varianceType: z.string().optional(),
      varianceDirection: z.string().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(({ input }) => listVarianceEvents(input ?? undefined)),

  /** Get all variance events for a specific assembly */
  getVarianceEventsByAssembly: protectedProcedure
    .input(z.object({ assemblyId: z.string().uuid() }))
    .query(({ input }) => getVarianceEventsByAssembly(input.assemblyId)),

  // ══════════════════════════════════════════════════════════
  // ASSEMBLY PERFORMANCE METRICS
  // ══════════════════════════════════════════════════════════

  /** Refresh metrics for a single assembly */
  refreshAssemblyMetrics: protectedProcedure
    .input(z.object({ assemblyId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const metrics = await refreshAssemblyMetrics(input.assemblyId);
      logAudit({
        userId: ctx.user.id,
        action: "learning.assembly_metrics_refreshed",
        tableName: "assembly_performance_metrics",
        recordId: input.assemblyId,
        before: null,
        after: metrics,
      });
      return metrics;
    }),

  /** Refresh metrics for ALL assemblies (batch job) */
  refreshAllMetrics: protectedProcedure
    .mutation(async ({ ctx }) => {
      const count = await refreshAllAssemblyMetrics();
      logAudit({
        userId: ctx.user.id,
        action: "learning.all_metrics_refreshed",
        tableName: "assembly_performance_metrics",
        recordId: String(0),
        before: null,
        after: { assembliesRefreshed: count },
      });
      return { assembliesRefreshed: count };
    }),

  /** List assembly metrics with sorting */
  listAssemblyMetrics: protectedProcedure
    .input(z.object({
      sortBy: z.enum(["variance", "overruns", "underruns", "projects"]).optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
      highVarianceOnly: z.boolean().optional(),
    }).optional())
    .query(({ input }) => listAssemblyMetrics(input ?? undefined)),

  /** Get metrics for a single assembly */
  getAssemblyMetrics: protectedProcedure
    .input(z.object({ assemblyId: z.string().uuid() }))
    .query(({ input }) => getAssemblyMetricsById(input.assemblyId)),

  /** Get assemblies with highest variance */
  highestVariance: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .query(({ input }) => getHighestVarianceAssemblies(input?.limit ?? 10)),

  /** Get assemblies with consistent overruns */
  consistentOverruns: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .query(({ input }) => getConsistentOverruns(input?.limit ?? 10)),

  /** Get assemblies with consistent underruns */
  consistentUnderruns: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .query(({ input }) => getConsistentUnderruns(input?.limit ?? 10)),

  // ══════════════════════════════════════════════════════════
  // CALIBRATION SUGGESTIONS
  // ══════════════════════════════════════════════════════════

  /** Generate calibration suggestions from performance metrics */
  generateSuggestions: protectedProcedure
    .mutation(async ({ ctx }) => {
      const suggestions = await generateCalibrationSuggestions();
      logAudit({
        userId: ctx.user.id,
        action: "learning.suggestions_generated",
        tableName: "calibration_suggestions",
        recordId: String(0),
        before: null,
        after: { suggestionsGenerated: suggestions.length },
      });
      return { suggestionsGenerated: suggestions.length, suggestions };
    }),

  /** List calibration suggestions with filters */
  listSuggestions: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      assemblyId: z.string().uuid().optional(),
      minConfidence: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(({ input }) => listCalibrationSuggestions(input ?? undefined)),

  /** Get a single calibration suggestion */
  getSuggestion: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const suggestion = await getCalibrationSuggestionById(String(input.id));
      if (!suggestion) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Calibration suggestion ${input.id} not found` });
      }
      return suggestion;
    }),

  /** Review a calibration suggestion (accept/reject/review) */
  reviewSuggestion: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(["reviewed", "accepted", "rejected"]),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getCalibrationSuggestionById(input.id);
      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Calibration suggestion ${input.id} not found` });
      }
      const updated = await reviewCalibrationSuggestion(
        input.id,
        input.status,
        input.reviewNotes
      );
      logAudit({
        userId: ctx.user.id,
        action: `learning.suggestion_${input.status}`,
        tableName: "calibration_suggestions",
        recordId: input.id,
        before,
        after: updated,
      });
      return updated;
    }),

  // ══════════════════════════════════════════════════════════
  // LEARNING DASHBOARD
  // ══════════════════════════════════════════════════════════

  /** Get learning dashboard summary */
  dashboardSummary: protectedProcedure
    .query(() => getLearningDashboardSummary()),
});
