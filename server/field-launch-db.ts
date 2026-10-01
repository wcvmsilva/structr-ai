/**
 * Sprint 21 — Field Launch Control DB Helpers
 *
 * Provides:
 *   - Feature flag management (get/set system settings)
 *   - Monitoring dashboard aggregations
 *   - Field feedback CRUD
 *   - Project actuals CRUD
 */

import { eq, and, or, desc, sql, count, gte, lte, isNotNull, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { tenantWhere, TenantScopeError, type TenantScopedTable } from "./tenant-scope";
import { nonHistoricalEstimateCondition } from "./historical-estimate-guard";
import {
  systemSettings,
  fieldFeedbackReports,
  projectActuals,
  estimateDrafts,
  auditLogs,
  geographicOverrides,
  projects,
  type SystemSetting,
  type InsertSystemSetting,
  type FieldFeedbackReport,
  type InsertFieldFeedbackReport,
  type ProjectActual,
  type InsertProjectActual,
} from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// 1. FEATURE FLAGS / SYSTEM SETTINGS
// ══════════════════════════════════════════════════════════════════════

const FIELD_LAUNCH_KEY = "field_launch_mode";

export async function getSystemSetting(key: string): Promise<SystemSetting | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, key))
    .limit(1);
  return row ?? null;
}

export async function setSystemSetting(
  key: string,
  value: any,
  description?: string
): Promise<SystemSetting> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getSystemSetting(key);
  if (existing) {
    await db
      .update(systemSettings)
      .set({
        settingValue: value,
        description: description ?? existing.description,
      })
      .where(eq(systemSettings.settingKey, key));
    return { ...existing, settingValue: value, description: description ?? existing.description };
  }

  const [result] = await db
    .insert(systemSettings)
    .values({
      settingKey: key,
      settingValue: value,
      description,
    })
    .returning();
  return result;
}

export async function isFieldLaunchEnabled(): Promise<boolean> {
  const setting = await getSystemSetting(FIELD_LAUNCH_KEY);
  return setting?.settingValue === "true" || setting?.settingValue === true;
}

export async function setFieldLaunchMode(enabled: boolean): Promise<SystemSetting> {
  return setSystemSetting(
    FIELD_LAUNCH_KEY,
    enabled ? "true" : "false",
    "Controls field launch monitoring, feedback capture, and additional audit logging"
  );
}

export async function listSystemSettings(): Promise<SystemSetting[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(systemSettings).orderBy(systemSettings.settingKey);
}

// ══════════════════════════════════════════════════════════════════════
// 2. MONITORING DASHBOARD AGGREGATIONS
// ══════════════════════════════════════════════════════════════════════

export interface MonitoringMetrics {
  totalEstimates: number;
  estimatesApproved: number;
  estimatesRejected: number;
  estimatesExported: number;
  pipelineErrors: number;
  overrideFrequency: number;
  csvValidationFailures: number;
  feedbackReports: number;
  highVarianceProjects: number;
  fieldLaunchEnabled: boolean;
}

/**
 * `tenantId` must come from a verified session/context (e.g. `ctx.tenantId` behind
 * `tenantProcedure`), never from client input. `tenantWhere()` throws `TenantScopeError`
 * if it is falsy, so a helper called directly (bypassing the router) still fails closed.
 *
 * `fieldFeedbackReports` carries no `tenant_id` column of its own, so its tenant-scoped
 * count joins through the tenant-bearing `projects` owner via `projectId`. That join
 * column is nullable; an INNER JOIN excludes rows with no reliable tenant attribution
 * rather than leaking them as tenant-global or guessing an owner.
 *
 * This dashboard's cut requires excluding tenant-NULL rows even while the app-wide
 * `TENANT_STRICT` rollout flag is off — `tenantWhere()`/`tenantFilter()` still fold a
 * legacy `tenant_id IS NULL` row into every tenant's transitional view (F15 / issue #10),
 * which is correct for most of the app but is exactly the leak this dashboard must not
 * have: a NULL-tenant `projects` row joined in would surface as visible to *every* caller
 * tenant, and an INNER JOIN to such a row does not make the underlying feedback row's
 * attribution any more reliable. `strictTenantWhere()` below scopes only these three
 * endpoints; it does not touch `TENANT_STRICT` or any other call site.
 * `estimate_drafts.tenant_id` is provisioned at insert time (`withTenant()`), so this is
 * not expected to change today's counts for that table — the risk it closes is the
 * `projects` join path.
 */
function requireCallerTenant(tenantId: string, operation: string): string {
  if (!tenantId) throw new TenantScopeError(operation);
  return tenantId;
}

function strictTenantWhere(
  table: TenantScopedTable,
  tenantId: string,
  ...conditions: Array<SQL | undefined>
): SQL {
  const id = requireCallerTenant(tenantId, "fieldLaunchMonitoring");
  const parts = [eq(table.tenantId, id), ...conditions].filter((c): c is SQL => c !== undefined);
  return parts.length === 1 ? parts[0] : and(...parts)!;
}

/**
 * `audit_logs` attribution — V3 (achado 4).
 *
 * V1/V2 scoped audit-derived counts by joining to the ACTING profile's current tenant
 * (`profiles` via `userId`). Michael's V2 QA showed that is not proof of the AUDITED
 * RESOURCE's tenant: `identity-db.ts`'s `COALESCE(profiles.tenant_id, EXCLUDED.tenant_id)`
 * only protects an already-set value from being overwritten — it does not make
 * `tenant_id` immutable from creation, so a profile created before tenant provisioning
 * (`tenant_id IS NULL`) can be filled in LATER, and "actor's current tenant" then stops
 * being proof of "actor's tenant when this event happened." Worse, several real writers
 * (`geo_override.create`/`geo_override.resolve`/`geo_override.clear`/
 * `geo_override.resolve_complete` in geo-override-db.ts / geo-override-router.ts) record
 * `userId: null` outright — actor-based attribution is structurally impossible for them,
 * which is why `overrideFrequency` and override-related `recentActivity` rows have never
 * actually surfaced under the old JOIN, for any tenant (an availability gap, not a leak).
 *
 * This resolves the resource's own tenant instead, via `tableName`/`recordId`, for the
 * writers this cut can cheaply and directly verify (confirmed by reading each writer, not
 * guessed):
 *   - tableName "estimate_drafts" → recordId is the draft's own id (e.g.
 *     `estimate.internal_approved` in internal-estimate-approval-db.ts). `estimateDrafts`
 *     already carries `tenant_id` directly.
 *   - tableName "geographic_overrides" → recordId is the override's own id for
 *     `geo_override.create` (geo-override-db.ts). Also carries `tenant_id` directly.
 *     Errata (Michael's V3 QA): `geo_override.seed_coastal_rules` (geo-override-router.ts)
 *     also logs tableName "geographic_overrides" but with `recordId: String(0)`, not a
 *     real override id — `audit_logs.record_id` is `uuid` (drizzle/schema.ts), so that
 *     literal never matches a real row here and this event is excluded like any other
 *     unresolved reference. Not the same writer as `geo_override.create`; not fixed here,
 *     since correcting that writer's recordId is a change to a writer outside this cut.
 *   - tableName "field_feedback_reports" → recordId is the report's own id
 *     (`field_feedback_submitted`/`resolved`/`dismissed` in field-launch-router.ts).
 *     Resolved via the same `projects` join already used for the `feedbackReports` count.
 *
 * `geo_override.resolve`/`clear`/`resolve_complete` also match the legacy `%override%`
 * filter but log tableName "scope_override_log" while `recordId` is actually the *scope
 * draft's* id, not a `scope_override_log` row's own id (an inconsistency found in the
 * writers, not invented here) — resolving that chain needs a second hop (scope draft →
 * project → tenant) this cut does not add. Those rows are excluded, matching their
 * existing (accidental) exclusion under the old `userId: null` actor-JOIN — not a new
 * coverage loss, but still an open gap, reported rather than silently patched.
 *
 * Every other `tableName`, or a `recordId` that does not resolve to a matching row of its
 * claimed type, is excluded: unverifiable attribution never falls back to guessing from
 * the actor, and never leaks in as tenant-global.
 */
function auditResourceTenantMatch(tenantId: string): SQL {
  const id = requireCallerTenant(tenantId, "fieldLaunchAuditAttribution");
  return or(
    and(eq(auditLogs.tableName, "estimate_drafts"), eq(estimateDrafts.tenantId, id)),
    and(eq(auditLogs.tableName, "geographic_overrides"), eq(geographicOverrides.tenantId, id)),
    and(eq(auditLogs.tableName, "field_feedback_reports"), eq(projects.tenantId, id)),
  )!;
}

export async function getMonitoringMetrics(tenantId: string): Promise<MonitoringMetrics> {
  requireCallerTenant(tenantId, "getMonitoringMetrics");
  const db = await getDb();
  if (!db) {
    return {
      totalEstimates: 0,
      estimatesApproved: 0,
      estimatesRejected: 0,
      estimatesExported: 0,
      pipelineErrors: 0,
      overrideFrequency: 0,
      csvValidationFailures: 0,
      feedbackReports: 0,
      highVarianceProjects: 0,
      fieldLaunchEnabled: false,
    };
  }

  // Total estimates — historical capture must not inflate this operational count either
  // (consolidation/20260921's 897d25f4 finding, ported here for the tenant-scoped signature).
  const [totalRow] = await db
    .select({ count: count() })
    .from(estimateDrafts)
    .where(strictTenantWhere(estimateDrafts, tenantId, nonHistoricalEstimateCondition()));
  const totalEstimates = totalRow?.count ?? 0;

  // Approved estimates
  const [approvedRow] = await db
    .select({ count: count() })
    .from(estimateDrafts)
    .where(strictTenantWhere(estimateDrafts, tenantId, eq(estimateDrafts.status, "approved"), nonHistoricalEstimateCondition()));
  const estimatesApproved = approvedRow?.count ?? 0;

  // Rejected estimates — same historical exclusion as approved, applied here too.
  const [rejectedRow] = await db
    .select({ count: count() })
    .from(estimateDrafts)
    .where(strictTenantWhere(estimateDrafts, tenantId, eq(estimateDrafts.status, "rejected"), nonHistoricalEstimateCondition()));
  const estimatesRejected = rejectedRow?.count ?? 0;

  // Exported estimates (count audit logs with export actions, scoped via the audited resource's own tenant)
  const [exportedRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .leftJoin(estimateDrafts, eq(auditLogs.recordId, estimateDrafts.id))
    .leftJoin(geographicOverrides, eq(auditLogs.recordId, geographicOverrides.id))
    .leftJoin(fieldFeedbackReports, eq(auditLogs.recordId, fieldFeedbackReports.id))
    .leftJoin(projects, eq(projects.id, fieldFeedbackReports.projectId))
    .where(and(sql`${auditLogs.action} LIKE 'estimate.export%'`, auditResourceTenantMatch(tenantId)));
  const estimatesExported = exportedRow?.count ?? 0;

  // Pipeline errors (count audit logs with pipeline_error action, scoped via the audited resource's own tenant)
  const [pipelineRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .leftJoin(estimateDrafts, eq(auditLogs.recordId, estimateDrafts.id))
    .leftJoin(geographicOverrides, eq(auditLogs.recordId, geographicOverrides.id))
    .leftJoin(fieldFeedbackReports, eq(auditLogs.recordId, fieldFeedbackReports.id))
    .leftJoin(projects, eq(projects.id, fieldFeedbackReports.projectId))
    .where(and(eq(auditLogs.action, "estimate.pipeline_error"), auditResourceTenantMatch(tenantId)));
  const pipelineErrors = pipelineRow?.count ?? 0;

  // Override frequency (count audit logs with override actions, scoped via the audited resource's own tenant)
  const [overrideRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .leftJoin(estimateDrafts, eq(auditLogs.recordId, estimateDrafts.id))
    .leftJoin(geographicOverrides, eq(auditLogs.recordId, geographicOverrides.id))
    .leftJoin(fieldFeedbackReports, eq(auditLogs.recordId, fieldFeedbackReports.id))
    .leftJoin(projects, eq(projects.id, fieldFeedbackReports.projectId))
    .where(and(sql`${auditLogs.action} LIKE '%override%'`, auditResourceTenantMatch(tenantId)));
  const overrideFrequency = overrideRow?.count ?? 0;

  // CSV validation failures (count audit logs with csv validation failures, scoped via the audited resource's own tenant)
  const [csvRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .leftJoin(estimateDrafts, eq(auditLogs.recordId, estimateDrafts.id))
    .leftJoin(geographicOverrides, eq(auditLogs.recordId, geographicOverrides.id))
    .leftJoin(fieldFeedbackReports, eq(auditLogs.recordId, fieldFeedbackReports.id))
    .leftJoin(projects, eq(projects.id, fieldFeedbackReports.projectId))
    .where(and(eq(auditLogs.action, "estimate.csv_validation_failed"), auditResourceTenantMatch(tenantId)));
  const csvValidationFailures = csvRow?.count ?? 0;

  // Feedback reports (scoped via the linked project's tenant)
  const [feedbackRow] = await db
    .select({ count: count() })
    .from(fieldFeedbackReports)
    .innerJoin(projects, eq(projects.id, fieldFeedbackReports.projectId))
    .where(strictTenantWhere(projects, tenantId));
  const feedbackReports = feedbackRow?.count ?? 0;

  // Field launch mode is a single global operational flag, not tenant data — intentionally unscoped.
  const fieldLaunchEnabled = await isFieldLaunchEnabled();

  return {
    totalEstimates,
    estimatesApproved,
    estimatesRejected,
    estimatesExported,
    pipelineErrors,
    overrideFrequency,
    csvValidationFailures,
    feedbackReports,
    highVarianceProjects: 0, // TODO: count from projectActuals with isHighVariance
    fieldLaunchEnabled,
  };
}

/** Get estimate status distribution for dashboard chart — excludes historical capture, like
 * every other monitoring aggregate above (897d25f4's intent, ported to this signature). */
export async function getEstimateStatusDistribution(tenantId: string): Promise<Record<string, number>> {
  requireCallerTenant(tenantId, "getEstimateStatusDistribution");
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({
      status: estimateDrafts.status,
      count: count(),
    })
    .from(estimateDrafts)
    .where(strictTenantWhere(estimateDrafts, tenantId, nonHistoricalEstimateCondition()))
    .groupBy(estimateDrafts.status);
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}

/** Get recent audit activity for dashboard feed, scoped via the audited resource's own tenant — see `auditResourceTenantMatch()`. */
export async function getRecentAuditActivity(tenantId: string, limit: number = 20): Promise<any[]> {
  requireCallerTenant(tenantId, "getRecentAuditActivity");
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: auditLogs.id, userId: auditLogs.userId, action: auditLogs.action, tableName: auditLogs.tableName,
      recordId: auditLogs.recordId, oldValues: auditLogs.oldValues, newValues: auditLogs.newValues,
      ipAddress: auditLogs.ipAddress, userAgent: auditLogs.userAgent, createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(estimateDrafts, eq(auditLogs.recordId, estimateDrafts.id))
    .leftJoin(geographicOverrides, eq(auditLogs.recordId, geographicOverrides.id))
    .leftJoin(fieldFeedbackReports, eq(auditLogs.recordId, fieldFeedbackReports.id))
    .leftJoin(projects, eq(projects.id, fieldFeedbackReports.projectId))
    .where(auditResourceTenantMatch(tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

// ══════════════════════════════════════════════════════════════════════
// 3. FIELD FEEDBACK REPORTS
// ══════════════════════════════════════════════════════════════════════

export async function createFieldFeedback(
  data: InsertFieldFeedbackReport
): Promise<FieldFeedbackReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db
    .insert(fieldFeedbackReports)
    .values(data)
    .returning();
  return result;
}

export async function listFieldFeedback(opts?: {
  projectId?: string;
  status?: string;
  feedbackType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: FieldFeedbackReport[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.projectId) conditions.push(eq(fieldFeedbackReports.projectId, opts.projectId));
  if (opts?.status) conditions.push(eq(fieldFeedbackReports.status, opts.status as any));
  if (opts?.feedbackType) conditions.push(eq(fieldFeedbackReports.feedbackType, opts.feedbackType));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: count() })
    .from(fieldFeedbackReports)
    .where(whereClause);

  const items = await db
    .select()
    .from(fieldFeedbackReports)
    .where(whereClause)
    .orderBy(desc(fieldFeedbackReports.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total: totalRow?.count ?? 0 };
}

export async function getFieldFeedbackById(id: string): Promise<FieldFeedbackReport | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(fieldFeedbackReports)
    .where(eq(fieldFeedbackReports.id, id))
    .limit(1);
  return row ?? null;
}

export async function updateFieldFeedbackStatus(
  id: string,
  status: "open" | "in_review" | "resolved" | "dismissed"
): Promise<FieldFeedbackReport | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(fieldFeedbackReports)
    .set({ status })
    .where(eq(fieldFeedbackReports.id, id));
  return getFieldFeedbackById(id);
}

export async function dismissFieldFeedback(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(fieldFeedbackReports)
    .set({ status: "dismissed" })
    .where(eq(fieldFeedbackReports.id, id));
}

export async function getFieldFeedbackStats(): Promise<{
  total: number;
  open: number;
  inReview: number;
  resolved: number;
  dismissed: number;
  byFeedbackType: Record<string, number>;
  byIssueCategory: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) {
    return {
      total: 0,
      open: 0,
      inReview: 0,
      resolved: 0,
      dismissed: 0,
      byFeedbackType: {},
      byIssueCategory: {},
    };
  }

  const [totalRow] = await db.select({ count: count() }).from(fieldFeedbackReports);

  const statusRows = await db
    .select({ status: fieldFeedbackReports.status, count: count() })
    .from(fieldFeedbackReports)
    .groupBy(fieldFeedbackReports.status);

  const feedbackTypeRows = await db
    .select({ feedbackType: fieldFeedbackReports.feedbackType, count: count() })
    .from(fieldFeedbackReports)
    .groupBy(fieldFeedbackReports.feedbackType);

  const issueCategoryRows = await db
    .select({ issueCategory: fieldFeedbackReports.issueCategory, count: count() })
    .from(fieldFeedbackReports)
    .groupBy(fieldFeedbackReports.issueCategory);

  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = r.count;

  const byFeedbackType: Record<string, number> = {};
  for (const r of feedbackTypeRows) {
    if (r.feedbackType) byFeedbackType[r.feedbackType] = r.count;
  }

  const byIssueCategory: Record<string, number> = {};
  for (const r of issueCategoryRows) {
    if (r.issueCategory) byIssueCategory[r.issueCategory] = r.count;
  }

  return {
    total: totalRow?.count ?? 0,
    open: statusMap.open ?? 0,
    inReview: statusMap.in_review ?? 0,
    resolved: statusMap.resolved ?? 0,
    dismissed: statusMap.dismissed ?? 0,
    byFeedbackType,
    byIssueCategory,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 4. PROJECT ACTUALS
// ══════════════════════════════════════════════════════════════════════

export async function recordProjectActual(
  data: InsertProjectActual
): Promise<ProjectActual> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .insert(projectActuals)
    .values(data)
    .returning();

  return result;
}

/**
 * List project cost actuals.
 *
 * B2 (Codex P1-1, route inventory). `tenantId` is REQUIRED and `opts` is no longer
 * optional. Previously every filter was optional, so omitting `projectId` produced
 * `whereClause = undefined` and this helper executed `SELECT * FROM project_actuals` —
 * every tenant's cost data — reachable from `fieldLaunch.listActuals`, whose guard only
 * ran when `projectId` happened to be supplied. A caller must never be able to widen a
 * query by omitting an optional identifier.
 *
 * The tenant predicate is built with `tenantWhere()`, so it is always present and the
 * `whereClause = undefined` path no longer exists. The ROW axis is unchanged: legacy
 * `tenant_id IS NULL` rows remain visible while TENANT_STRICT is off (F15 / issue #10).
 */
export async function listProjectActuals(opts: {
  /** Trusted resolved caller tenant. Non-nullable — supplied by the route boundary. */
  tenantId: string;
  projectId?: string;
  estimateItemId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ProjectActual[]; total: number }> {
  const conditions = [];
  if (opts.projectId) conditions.push(eq(projectActuals.projectId, opts.projectId));
  if (opts.estimateItemId) conditions.push(eq(projectActuals.estimateItemId, opts.estimateItemId));

  // Always a predicate, and built BEFORE the database check so an unscoped call fails
  // closed even when the database is unavailable — availability must never decide
  // authorization.
  const whereClause = tenantWhere(projectActuals, opts.tenantId, ...conditions);

  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const [totalRow] = await db
    .select({ count: count() })
    .from(projectActuals)
    .where(whereClause);

  const items = await db
    .select()
    .from(projectActuals)
    .where(whereClause)
    .orderBy(desc(projectActuals.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total: totalRow?.count ?? 0 };
}

export async function getProjectActualById(id: string): Promise<ProjectActual | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(projectActuals)
    .where(eq(projectActuals.id, id))
    .limit(1);
  return row ?? null;
}

export async function getProjectActualsSummary(projectId: string): Promise<{
  totalItems: number;
  totalActualQuantity: number;
  totalActualCost: number;
  totalLaborHours: number;
}> {
  const db = await getDb();
  if (!db) {
    return {
      totalItems: 0,
      totalActualQuantity: 0,
      totalActualCost: 0,
      totalLaborHours: 0,
    };
  }

  const items = await db
    .select()
    .from(projectActuals)
    .where(eq(projectActuals.projectId, projectId));

  const totalItems = items.length;
  const totalActualQuantity = items.reduce((sum, i) => sum + parseFloat(String(i.actualQuantity ?? 0)), 0);
  const totalActualCost = items.reduce((sum, i) => sum + parseFloat(String(i.actualCost ?? 0)), 0);
  const totalLaborHours = items.reduce((sum, i) => sum + parseFloat(String(i.actualLaborHours ?? 0)), 0);

  return {
    totalItems,
    totalActualQuantity,
    totalActualCost,
    totalLaborHours,
  };
}

// ══════════════════════════════════════════════════════════════════════
// COMPATIBILITY ALIASES (old function names for router compatibility)
// ══════════════════════════════════════════════════════════════════════

/** Alias for updateFieldFeedbackStatus — old routers import as resolveFieldFeedback */
export async function resolveFieldFeedback(
  id: string,
  resolution: string,
  _resolvedBy: string
): Promise<FieldFeedbackReport | null> {
  return updateFieldFeedbackStatus(id, "resolved");
}

/** Alias for getProjectActualsSummary — old routers import as getVarianceSummary */
export async function getVarianceSummary(projectId: string) {
  const summary = await getProjectActualsSummary(projectId);
  return {
    ...summary,
    highVarianceItems: 0,
    overallVariancePct: 0,
    isHighVarianceProject: false,
    totalEstimatedCost: 0,
  };
}
