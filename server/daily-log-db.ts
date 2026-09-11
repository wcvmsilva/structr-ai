/**
 * structr.ai — PHASE 3 Daily Log Persistence
 *
 * Persists the field daily report of docs/phase3-contract.md §6.
 *
 * Invariants enforced here:
 *   DL-001  one log per project per day (upsert, never a second version of the same day)
 *   DL-002  a safety incident must be described
 *   DL-003  a weather delay must name the affected work
 *
 * The daily log is the evidence layer of the whole phase: a delay claim, a backcharge or an
 * insurance dispute is won or lost by whether the day was recorded, not by whether it was
 * remembered.
 */

import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import { dailyLogs, projects, type DailyLog } from "../drizzle/schema";
import { logAudit } from "./audit";
import {
  normalizeWeatherCondition,
  type WeatherCondition,
} from "@shared/domain/phase3-taxonomy";
import { withTenant } from "./tenant-scope";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type DailyLogErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "LOG_NOT_FOUND"
  | "DUPLICATE_LOG"
  | "SAFETY_DETAIL_REQUIRED"
  | "DELAY_DETAIL_REQUIRED"
  | "INVALID_LOG_DATE";

export class DailyLogError extends Error {
  public readonly code: DailyLogErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: DailyLogErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DailyLogError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION (DL-002, DL-003)
// ══════════════════════════════════════════════════════════════════════

export interface DailyLogPayload {
  logDate?: string | null;
  weather?: string | null;
  temperatureF?: number | null;
  weatherDelay?: boolean;
  crewCount?: number;
  subcontractorsOnSite?: string[] | null;
  workPerformed?: string | null;
  issues?: string | null;
  delays?: string | null;
  delayHours?: number | null;
  materialsDelivered?: string | null;
  visitors?: string | null;
  inspectionsToday?: string | null;
  photosCount?: number;
  photoUrls?: string[] | null;
  safetyIncidents?: number;
  safetyIncidentDetails?: string | null;
  safetyIncidentResolved?: boolean;
  laborHoursTotal?: number | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  notes?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a daily log payload.
 *
 * Returns violations instead of throwing so the router can report every problem at once —
 * a superintendent filling the log on a phone at 6pm should not get one error per submit.
 */
export function validateDailyLog(payload: DailyLogPayload): Array<{
  code: DailyLogErrorCode;
  ruleId: "DL-001" | "DL-002" | "DL-003";
  message: string;
}> {
  const violations: Array<{
    code: DailyLogErrorCode;
    ruleId: "DL-001" | "DL-002" | "DL-003";
    message: string;
  }> = [];

  if (payload.logDate != null && !ISO_DATE.test(payload.logDate)) {
    violations.push({
      code: "INVALID_LOG_DATE",
      ruleId: "DL-001",
      message: `logDate must be an ISO date (YYYY-MM-DD), received "${payload.logDate}".`,
    });
  }

  const incidents = payload.safetyIncidents ?? 0;
  if (
    incidents > 0 &&
    (!payload.safetyIncidentDetails || payload.safetyIncidentDetails.trim().length < 10)
  ) {
    violations.push({
      code: "SAFETY_DETAIL_REQUIRED",
      ruleId: "DL-002",
      message:
        "A reported safety incident must be described (minimum 10 characters). An incident count with no narrative is not a usable record.",
    });
  }

  if (payload.weatherDelay === true && (!payload.delays || payload.delays.trim().length < 5)) {
    violations.push({
      code: "DELAY_DETAIL_REQUIRED",
      ruleId: "DL-003",
      message:
        "A weather delay must name the work that stopped — otherwise the delay cannot support a schedule claim.",
    });
  }

  return violations;
}

// ══════════════════════════════════════════════════════════════════════
// CREATE / UPSERT (DL-001)
// ══════════════════════════════════════════════════════════════════════

export interface UpsertDailyLogInput extends DailyLogPayload {
  projectId: string;
  userId: string;
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  today?: string;
}

function todayIso(explicit?: string): string {
  return explicit ?? new Date().toISOString().slice(0, 10);
}

function buildValues(payload: DailyLogPayload, weather: WeatherCondition | null) {
  return {
    weather,
    temperatureF: payload.temperatureF ?? null,
    weatherDelay: payload.weatherDelay ?? false,
    crewCount: payload.crewCount ?? 0,
    subcontractorsOnSite: payload.subcontractorsOnSite ?? null,
    workPerformed: payload.workPerformed ?? null,
    issues: payload.issues ?? null,
    delays: payload.delays ?? null,
    delayHours: payload.delayHours != null ? String(payload.delayHours) : null,
    materialsDelivered: payload.materialsDelivered ?? null,
    visitors: payload.visitors ?? null,
    inspectionsToday: payload.inspectionsToday ?? null,
    photosCount: payload.photosCount ?? (payload.photoUrls?.length ?? 0),
    photoUrls: payload.photoUrls ?? null,
    safetyIncidents: payload.safetyIncidents ?? 0,
    safetyIncidentDetails: payload.safetyIncidentDetails ?? null,
    safetyIncidentResolved: payload.safetyIncidentResolved ?? false,
    laborHoursTotal: payload.laborHoursTotal != null ? String(payload.laborHoursTotal) : null,
    gpsLatitude: payload.gpsLatitude != null ? String(payload.gpsLatitude) : null,
    gpsLongitude: payload.gpsLongitude != null ? String(payload.gpsLongitude) : null,
    notes: payload.notes ?? null,
  };
}

/**
 * Create the daily log of a project for a date.
 *
 * Rejects a second log for the same day: the fix for "I forgot something" is to update the
 * existing log (which leaves an audit trail), not to file a competing version of the day.
 */
export async function createDailyLog(input: UpsertDailyLogInput): Promise<DailyLog> {
  const db = await getDb();
  if (!db) throw new DailyLogError("DB_UNAVAILABLE", "Database not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new DailyLogError("PROJECT_NOT_FOUND", `Project ${input.projectId} not found`);
  }

  const logDate = input.logDate ?? todayIso(input.today);
  const violations = validateDailyLog({ ...input, logDate });
  if (violations.length > 0) {
    const first = violations[0];
    throw new DailyLogError(
      first.code,
      `Daily log rejected: ${violations.map((v) => `[${v.ruleId}] ${v.message}`).join(" ")}`,
      { violations },
    );
  }

  const existing = await getDailyLogByDate(input.projectId, logDate);
  if (existing) {
    throw new DailyLogError(
      "DUPLICATE_LOG",
      `A daily log for ${logDate} already exists on this project. Update it instead of filing a second version of the same day (DL-001).`,
      { existingLogId: existing.id, logDate },
    );
  }

  const id = randomUUID();
  const now = new Date();
  const weather = input.weather ? normalizeWeatherCondition(input.weather) : null;

  const values = withTenant(
    {
      id,
      projectId: input.projectId,
      logDate,
      ...buildValues(input, weather),
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    },
    input.tenantId,
  );

  await db.insert(dailyLogs).values(values as never);

  await logAudit({
    userId: input.userId,
    action: "daily_log.created",
    tableName: "daily_logs",
    recordId: id,
    before: null,
    after: {
      projectId: input.projectId,
      logDate,
      crewCount: values.crewCount,
      safetyIncidents: values.safetyIncidents,
      weatherDelay: values.weatherDelay,
    },
  }).catch(() => undefined);

  // A safety incident is escalated on its own so it is not buried inside a daily report.
  if ((input.safetyIncidents ?? 0) > 0) {
    await logAudit({
      userId: input.userId,
      action: "daily_log.safety_incident_reported",
      tableName: "daily_logs",
      recordId: id,
      before: null,
      after: {
        projectId: input.projectId,
        logDate,
        safetyIncidents: input.safetyIncidents,
        details: input.safetyIncidentDetails,
        resolved: input.safetyIncidentResolved ?? false,
      },
    }).catch(() => undefined);
  }

  const created = await getDailyLog(id);
  if (!created) throw new DailyLogError("LOG_NOT_FOUND", `Daily log ${id} could not be read back`);
  return created;
}

export interface UpdateDailyLogInput extends DailyLogPayload {
  logId: string;
  userId: string;
}

/** Update an existing daily log. */
export async function updateDailyLog(input: UpdateDailyLogInput): Promise<DailyLog> {
  const db = await getDb();
  if (!db) throw new DailyLogError("DB_UNAVAILABLE", "Database not available");

  const before = await getDailyLog(input.logId);
  if (!before) throw new DailyLogError("LOG_NOT_FOUND", `Daily log ${input.logId} not found`);

  // Validate against the merged state, not just the patch: partial updates must not be able
  // to leave the row in a state the create path would have rejected.
  const merged: DailyLogPayload = {
    logDate: before.logDate,
    weatherDelay: input.weatherDelay ?? before.weatherDelay,
    delays: input.delays !== undefined ? input.delays : before.delays,
    safetyIncidents: input.safetyIncidents ?? before.safetyIncidents,
    safetyIncidentDetails:
      input.safetyIncidentDetails !== undefined
        ? input.safetyIncidentDetails
        : before.safetyIncidentDetails,
  };

  const violations = validateDailyLog(merged);
  if (violations.length > 0) {
    const first = violations[0];
    throw new DailyLogError(
      first.code,
      `Daily log rejected: ${violations.map((v) => `[${v.ruleId}] ${v.message}`).join(" ")}`,
      { violations },
    );
  }

  const patch: Record<string, unknown> = { updatedBy: input.userId, updatedAt: new Date() };

  if (input.weather !== undefined) {
    patch.weather = input.weather ? normalizeWeatherCondition(input.weather) : null;
  }
  if (input.temperatureF !== undefined) patch.temperatureF = input.temperatureF;
  if (input.weatherDelay !== undefined) patch.weatherDelay = input.weatherDelay;
  if (input.crewCount !== undefined) patch.crewCount = input.crewCount;
  if (input.subcontractorsOnSite !== undefined) patch.subcontractorsOnSite = input.subcontractorsOnSite;
  if (input.workPerformed !== undefined) patch.workPerformed = input.workPerformed;
  if (input.issues !== undefined) patch.issues = input.issues;
  if (input.delays !== undefined) patch.delays = input.delays;
  if (input.delayHours !== undefined) {
    patch.delayHours = input.delayHours != null ? String(input.delayHours) : null;
  }
  if (input.materialsDelivered !== undefined) patch.materialsDelivered = input.materialsDelivered;
  if (input.visitors !== undefined) patch.visitors = input.visitors;
  if (input.inspectionsToday !== undefined) patch.inspectionsToday = input.inspectionsToday;
  if (input.photoUrls !== undefined) {
    patch.photoUrls = input.photoUrls;
    patch.photosCount = input.photosCount ?? input.photoUrls?.length ?? 0;
  } else if (input.photosCount !== undefined) {
    patch.photosCount = input.photosCount;
  }
  if (input.safetyIncidents !== undefined) patch.safetyIncidents = input.safetyIncidents;
  if (input.safetyIncidentDetails !== undefined) {
    patch.safetyIncidentDetails = input.safetyIncidentDetails;
  }
  if (input.safetyIncidentResolved !== undefined) {
    patch.safetyIncidentResolved = input.safetyIncidentResolved;
  }
  if (input.laborHoursTotal !== undefined) {
    patch.laborHoursTotal = input.laborHoursTotal != null ? String(input.laborHoursTotal) : null;
  }
  if (input.notes !== undefined) patch.notes = input.notes;

  await db.update(dailyLogs).set(patch as never).where(eq(dailyLogs.id, input.logId));

  await logAudit({
    userId: input.userId,
    action: "daily_log.updated",
    tableName: "daily_logs",
    recordId: input.logId,
    before,
    after: patch,
  }).catch(() => undefined);

  const after = await getDailyLog(input.logId);
  return after ?? before;
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Load one daily log. */
export async function getDailyLog(id: string): Promise<DailyLog | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select().from(dailyLogs).where(eq(dailyLogs.id, id)).limit(1);
  return row ?? null;
}

/** Load the log of a project for a specific date. */
export async function getDailyLogByDate(
  projectId: string,
  logDate: string,
): Promise<DailyLog | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(dailyLogs)
    .where(
      and(
        eq(dailyLogs.projectId, projectId),
        eq(dailyLogs.logDate, logDate),
        isNull(dailyLogs.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

export interface ListDailyLogsOptions {
  projectId: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** List daily logs of a project, most recent first. */
export async function listDailyLogs(
  opts: ListDailyLogsOptions,
): Promise<{ logs: DailyLog[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };

  const conditions = [eq(dailyLogs.projectId, opts.projectId), isNull(dailyLogs.deletedAt)];
  if (opts.from) conditions.push(gte(dailyLogs.logDate, opts.from));
  if (opts.to) conditions.push(lte(dailyLogs.logDate, opts.to));

  const rows = await db
    .select()
    .from(dailyLogs)
    .where(and(...conditions))
    .orderBy(desc(dailyLogs.logDate))
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);

  return { logs: rows, total: rows.length };
}

/** Soft delete a daily log. */
export async function deleteDailyLog(logId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new DailyLogError("DB_UNAVAILABLE", "Database not available");

  const before = await getDailyLog(logId);
  if (!before) throw new DailyLogError("LOG_NOT_FOUND", `Daily log ${logId} not found`);

  const now = new Date();
  await db
    .update(dailyLogs)
    .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
    .where(eq(dailyLogs.id, logId));

  await logAudit({
    userId,
    action: "daily_log.deleted",
    tableName: "daily_logs",
    recordId: logId,
    before,
    after: { deletedAt: now },
  }).catch(() => undefined);

  return true;
}

// ══════════════════════════════════════════════════════════════════════
// AGGREGATION
// ══════════════════════════════════════════════════════════════════════

export interface DailyLogSummary {
  projectId: string;
  logCount: number;
  firstLogDate: string | null;
  lastLogDate: string | null;
  /** Calendar days between the first and last log, inclusive. */
  spanDays: number;
  /** Days in the span with no log — the evidence gap. */
  missingDays: number;
  totalCrewDays: number;
  totalLaborHours: number;
  weatherDelayDays: number;
  totalDelayHours: number;
  safetyIncidentCount: number;
  unresolvedSafetyIncidents: number;
  totalPhotos: number;
}

/**
 * Summarize the daily log coverage of a project.
 *
 * `missingDays` is the number that matters: a project with 40 logs across a 90-day span has
 * 50 days it cannot account for, and every one of those is a dispute the builder loses.
 */
export async function getDailyLogSummary(projectId: string): Promise<DailyLogSummary> {
  const { logs } = await listDailyLogs({ projectId, limit: 2000 });

  if (logs.length === 0) {
    return {
      projectId,
      logCount: 0,
      firstLogDate: null,
      lastLogDate: null,
      spanDays: 0,
      missingDays: 0,
      totalCrewDays: 0,
      totalLaborHours: 0,
      weatherDelayDays: 0,
      totalDelayHours: 0,
      safetyIncidentCount: 0,
      unresolvedSafetyIncidents: 0,
      totalPhotos: 0,
    };
  }

  const dates = logs.map((l) => l.logDate).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const spanDays =
    Math.round(
      (new Date(`${last}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;

  let totalCrewDays = 0;
  let totalLaborHours = 0;
  let weatherDelayDays = 0;
  let totalDelayHours = 0;
  let safetyIncidentCount = 0;
  let unresolvedSafetyIncidents = 0;
  let totalPhotos = 0;

  for (const log of logs) {
    totalCrewDays += log.crewCount ?? 0;
    totalLaborHours += log.laborHoursTotal != null ? Number(log.laborHoursTotal) : 0;
    if (log.weatherDelay) weatherDelayDays += 1;
    totalDelayHours += log.delayHours != null ? Number(log.delayHours) : 0;
    safetyIncidentCount += log.safetyIncidents ?? 0;
    if ((log.safetyIncidents ?? 0) > 0 && !log.safetyIncidentResolved) {
      unresolvedSafetyIncidents += log.safetyIncidents ?? 0;
    }
    totalPhotos += log.photosCount ?? 0;
  }

  return {
    projectId,
    logCount: logs.length,
    firstLogDate: first,
    lastLogDate: last,
    spanDays,
    missingDays: Math.max(0, spanDays - logs.length),
    totalCrewDays,
    totalLaborHours: Math.round(totalLaborHours * 10) / 10,
    weatherDelayDays,
    totalDelayHours: Math.round(totalDelayHours * 10) / 10,
    safetyIncidentCount,
    unresolvedSafetyIncidents,
    totalPhotos,
  };
}

/** Count logs of a project, computed in SQL. */
export async function countDailyLogs(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(dailyLogs)
    .where(and(eq(dailyLogs.projectId, projectId), isNull(dailyLogs.deletedAt)));

  return Number(rows[0]?.count ?? 0);
}

/** Logs reporting an unresolved safety incident, oldest first. */
export async function listOpenSafetyIncidents(projectId: string): Promise<DailyLog[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(dailyLogs)
    .where(
      and(
        eq(dailyLogs.projectId, projectId),
        eq(dailyLogs.safetyIncidentResolved, false),
        sql`${dailyLogs.safetyIncidents} > 0`,
        isNull(dailyLogs.deletedAt),
      ),
    )
    .orderBy(asc(dailyLogs.logDate));
}
