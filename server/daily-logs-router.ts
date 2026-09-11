/**
 * structr.ai — PHASE 3 Daily Log tRPC Router
 *
 * Procedures:
 *   - dailyLogs.create           (protected) → file the log of a day (one per day, DL-001)
 *   - dailyLogs.get              (protected) → one log
 *   - dailyLogs.getByDate        (protected) → the log of a specific date
 *   - dailyLogs.list             (protected) → logs of a project, date-filterable
 *   - dailyLogs.update           (protected) → correct an existing log
 *   - dailyLogs.delete           (protected, delete) → soft delete
 *   - dailyLogs.getSummary       (protected) → coverage, crew days, delays, incidents
 *   - dailyLogs.openSafetyIncidents (protected) → unresolved safety incidents
 *   - dailyLogs.weatherOptions   (protected) → weather vocabulary
 *
 * Authorization: every procedure resolves the owning project and delegates to the Phase 1
 * project access guard. The daily log is `write`-level: the field files it, the office reads it.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, tenantProcedure, router } from "./_core/trpc";
import { requireEntityAccess, requireProjectAccessTrpc } from "./project-access";
import {
  countDailyLogs,
  createDailyLog,
  DailyLogError,
  deleteDailyLog,
  getDailyLog,
  getDailyLogByDate,
  getDailyLogSummary,
  listDailyLogs,
  listOpenSafetyIncidents,
  updateDailyLog,
} from "./daily-log-db";
import { WEATHER_CONDITIONS } from "@shared/domain/phase3-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

const logFieldsSchema = {
  weather: z.enum(WEATHER_CONDITIONS).nullish(),
  temperatureF: z.number().int().min(-60).max(140).nullish(),
  weatherDelay: z.boolean().optional(),
  crewCount: z.number().int().min(0).max(500).optional(),
  subcontractorsOnSite: z.array(z.string().max(255)).max(50).nullish(),
  workPerformed: z.string().max(10000).nullish(),
  issues: z.string().max(5000).nullish(),
  delays: z.string().max(5000).nullish(),
  delayHours: z.number().min(0).max(24).nullish(),
  materialsDelivered: z.string().max(5000).nullish(),
  visitors: z.string().max(2000).nullish(),
  inspectionsToday: z.string().max(2000).nullish(),
  photosCount: z.number().int().min(0).max(1000).optional(),
  photoUrls: z.array(z.string().url().max(2000)).max(200).nullish(),
  safetyIncidents: z.number().int().min(0).max(100).optional(),
  safetyIncidentDetails: z.string().max(10000).nullish(),
  safetyIncidentResolved: z.boolean().optional(),
  laborHoursTotal: z.number().min(0).max(10000).nullish(),
  notes: z.string().max(10000).nullish(),
};

// ══════════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ══════════════════════════════════════════════════════════════════════

/** Map a DailyLogError to the tRPC code the UI can act on. */
function toTrpcError(err: unknown): never {
  if (err instanceof DailyLogError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      PROJECT_NOT_FOUND: "NOT_FOUND",
      LOG_NOT_FOUND: "NOT_FOUND",
      DUPLICATE_LOG: "CONFLICT",
      SAFETY_DETAIL_REQUIRED: "BAD_REQUEST",
      DELAY_DETAIL_REQUIRED: "BAD_REQUEST",
      INVALID_LOG_DATE: "BAD_REQUEST",
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

export const dailyLogsRouter = router({
  /**
   * File the daily log.
   * A second log for the same date is rejected (DL-001): two versions of one day cannot both
   * be used as evidence, and the one that gets quoted in a dispute is the one that hurts.
   */
  create: tenantProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        logDate: isoDate.nullish(),
        gpsLatitude: z.number().min(-90).max(90).nullish(),
        gpsLongitude: z.number().min(-180).max(180).nullish(),
        ...logFieldsSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");

      try {
        return await createDailyLog({
          ...input,
          logDate: input.logDate ?? null,
          userId: ctx.user.id,
          tenantId: ctx.tenantId,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  get: protectedProcedure
    .input(z.object({ logId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("dailyLog", input.logId, ctx.user.id, "read");

      const log = await getDailyLog(input.logId);
      if (!log) throw new TRPCError({ code: "NOT_FOUND", message: "Daily log not found" });
      return log;
    }),

  getByDate: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), logDate: isoDate }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getDailyLogByDate(input.projectId, input.logDate);
    }),

  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const result = await listDailyLogs(input);
      return { ...result, projectTotal: await countDailyLogs(input.projectId) };
    }),

  update: protectedProcedure
    .input(z.object({ logId: z.string().uuid(), ...logFieldsSchema }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("dailyLog", input.logId, ctx.user.id, "write");

      try {
        return await updateDailyLog({ ...input, userId: ctx.user.id });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ logId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("dailyLog", input.logId, ctx.user.id, "delete");

      try {
        return { deleted: await deleteDailyLog(input.logId, ctx.user.id) };
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Coverage summary. `missingDays` is the number that matters: days inside the project span
   * with no log are days the builder cannot account for in a delay or backcharge dispute.
   */
  getSummary: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getDailyLogSummary(input.projectId);
    }),

  openSafetyIncidents: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return listOpenSafetyIncidents(input.projectId);
    }),

  /** Weather vocabulary for the UI. */
  weatherOptions: protectedProcedure.query(async () =>
    WEATHER_CONDITIONS.map((w) => ({
      value: w,
      label: w
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    })),
  ),
});
