/**
 * structr.ai — PHASE 4 Calibration tRPC Router
 *
 * Procedures:
 *   - calibration.runProject       (protected, approve) → calibrate one closed project
 *   - calibration.runTenant        (protected, admin)   → aggregate across a period
 *   - calibration.list             (protected)          → findings, tenant-scoped
 *   - calibration.get              (protected)          → one finding
 *   - calibration.acknowledge      (protected)          → mark as read
 *   - calibration.dismiss          (protected)          → reject with a reason
 *   - calibration.getReport        (protected)          → one report
 *   - calibration.listReports      (protected)          → reports, tenant-scoped
 *   - calibration.getProjectReport (protected)          → latest report of a project
 *   - calibration.getSummary       (protected)          → dashboard counts
 *
 * Authorization: project-scoped procedures resolve the owning project and delegate to the
 * Phase 1 guard. Tenant-scoped procedures are keyed on `ctx.tenantId` and never accept a
 * tenant id from the client — a tenant parameter on the wire is a tenant parameter an
 * attacker can change.
 *
 * Running calibration requires `approve`: its output is what proposes price changes.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { requireEntityAccess, requireProjectAccessTrpc } from "./project-access";
import {
  CalibrationError,
  getCalibrationEvent,
  getCalibrationReport,
  getCalibrationSummary,
  getLatestProjectReport,
  listCalibrationEvents,
  listCalibrationReports,
  runProjectCalibration,
  runTenantCalibration,
  transitionCalibrationEvent,
} from "./calibration-db";
import {
  CALIBRATION_EVENT_TYPES,
  CALIBRATION_PERIODS,
  CONFIDENCE_BANDS,
} from "@shared/domain/phase4-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

/** Resolve the caller's tenant, refusing rather than falling back to "all tenants". */
function requireTenant(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant in session. Calibration data is tenant-scoped and cannot be read without one.",
    });
  }
  return tenantId;
}

function toTrpcError(err: unknown): never {
  if (err instanceof CalibrationError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      PROJECT_NOT_FOUND: "NOT_FOUND",
      EVENT_NOT_FOUND: "NOT_FOUND",
      REPORT_NOT_FOUND: "NOT_FOUND",
      PROJECT_NOT_CLOSED: "PRECONDITION_FAILED",
      NO_APPROVED_ESTIMATE: "PRECONDITION_FAILED",
      INVALID_EVENT_TYPE: "BAD_REQUEST",
      INVALID_EVENT_TRANSITION: "CONFLICT",
      EVENT_TERMINAL: "CONFLICT",
      SCOPE_MISMATCH: "BAD_REQUEST",
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

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const calibrationRouter = router({
  /**
   * Calibrate one closed project.
   *
   * Requires `approve` rather than `write`: the findings produced here are the input to price
   * proposals, and the person who signs off on the numbers should be the person who generates
   * them.
   */
  runProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const access = await requireProjectAccessTrpc(input.projectId, ctx.user.id, "approve");

      try {
        return await runProjectCalibration({
          tenantId: requireTenant(access.tenantId ?? ctx.tenantId),
          projectId: input.projectId,
          actorId: ctx.user.id,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Aggregate calibration across a period.
   *
   * Admin-only: it rewrites the tenant-level view of every cost code's accuracy, and a
   * partially-scoped run would quietly replace the numbers the whole company reads.
   */
  runTenant: adminProcedure
    .input(
      z.object({
        period: z.enum(CALIBRATION_PERIODS).default("all_time"),
        periodStart: isoDate.nullish(),
        periodEnd: isoDate.nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await runTenantCalibration({
          tenantId: requireTenant(ctx.tenantId),
          period: input.period,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          actorId: ctx.user.id,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid().optional(),
        eventType: z.enum(CALIBRATION_EVENT_TYPES).optional(),
        status: z
          .enum(["open", "acknowledged", "actioned", "dismissed", "superseded"])
          .optional(),
        confidenceBand: z.enum(CONFIDENCE_BANDS).optional(),
        costCodeId: z.string().uuid().optional(),
        scope: z.enum(["project", "tenant"]).optional(),
        actionableOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      // A project filter narrows the query, so the project guard applies on top of the tenant one.
      if (input.projectId) {
        await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      }

      return listCalibrationEvents({
        tenantId: requireTenant(ctx.tenantId),
        projectId: input.projectId,
        eventType: input.eventType,
        status: input.status,
        confidenceBand: input.confidenceBand,
        costCodeId: input.costCodeId,
        scope: input.scope,
        actionableOnly: input.actionableOnly,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  get: protectedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      const event = await getCalibrationEvent(input.eventId);

      if (!event || event.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Calibration event not found." });
      }

      // Project-scoped findings still need the project guard: tenant membership alone does not
      // grant visibility into a project the caller was never added to.
      if (event.projectId) {
        await requireProjectAccessTrpc(event.projectId, ctx.user.id, "read");
      }

      return event;
    }),

  acknowledge: protectedProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      const event = await getCalibrationEvent(input.eventId);

      if (!event || event.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Calibration event not found." });
      }
      if (event.projectId) {
        await requireEntityAccess("calibrationEvent", input.eventId, ctx.user.id, "write");
      }

      try {
        return await transitionCalibrationEvent({
          eventId: input.eventId,
          toStatus: "acknowledged",
          actorId: ctx.user.id,
          notes: input.notes ?? null,
          tenantId,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Dismiss a finding. A reason is mandatory (see `transitionCalibrationEvent`). */
  dismiss: protectedProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        reason: z.string().min(10).max(5000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      const event = await getCalibrationEvent(input.eventId);

      if (!event || event.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Calibration event not found." });
      }
      if (event.projectId) {
        await requireEntityAccess("calibrationEvent", input.eventId, ctx.user.id, "approve");
      }

      try {
        return await transitionCalibrationEvent({
          eventId: input.eventId,
          toStatus: "dismissed",
          actorId: ctx.user.id,
          notes: input.reason,
          tenantId,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  getReport: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const tenantId = requireTenant(ctx.tenantId);
      const report = await getCalibrationReport(input.reportId);

      if (!report || report.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Calibration report not found." });
      }
      if (report.projectId) {
        await requireProjectAccessTrpc(report.projectId, ctx.user.id, "read");
      }

      return report;
    }),

  listReports: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid().optional(),
        scope: z.enum(["project", "tenant"]).optional(),
        limit: z.number().int().min(1).max(200).default(25),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.projectId) {
        await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      }

      return listCalibrationReports({
        tenantId: requireTenant(ctx.tenantId),
        projectId: input.projectId,
        scope: input.scope,
        limit: input.limit,
      });
    }),

  /** Latest report of a project — what the closeout screen shows after closing. */
  getProjectReport: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getLatestProjectReport(input.projectId);
    }),

  getSummary: protectedProcedure.query(async ({ ctx }) => {
    return getCalibrationSummary(requireTenant(ctx.tenantId));
  }),
});
