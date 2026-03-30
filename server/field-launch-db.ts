/**
 * Sprint 21 — Field Launch Control DB Helpers
 *
 * Provides:
 *   - Feature flag management (get/set system settings)
 *   - Monitoring dashboard aggregations
 *   - Field feedback CRUD
 *   - Project actuals CRUD
 */

import { eq, and, desc, sql, count, gte, lte, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import {
  systemSettings,
  fieldFeedbackReports,
  projectActuals,
  estimateDrafts,
  auditLogs,
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

export async function getMonitoringMetrics(): Promise<MonitoringMetrics> {
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

  // Total estimates
  const [totalRow] = await db
    .select({ count: count() })
    .from(estimateDrafts);
  const totalEstimates = totalRow?.count ?? 0;

  // Approved estimates
  const [approvedRow] = await db
    .select({ count: count() })
    .from(estimateDrafts)
    .where(eq(estimateDrafts.status, "approved"));
  const estimatesApproved = approvedRow?.count ?? 0;

  // Rejected estimates
  const [rejectedRow] = await db
    .select({ count: count() })
    .from(estimateDrafts)
    .where(eq(estimateDrafts.status, "rejected"));
  const estimatesRejected = rejectedRow?.count ?? 0;

  // Exported estimates (count audit logs with export actions)
  const [exportedRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(
      sql`${auditLogs.action} LIKE 'estimate.export%'`
    );
  const estimatesExported = exportedRow?.count ?? 0;

  // Pipeline errors (count audit logs with pipeline_error action)
  const [pipelineRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(eq(auditLogs.action, "estimate.pipeline_error"));
  const pipelineErrors = pipelineRow?.count ?? 0;

  // Override frequency (count audit logs with override actions)
  const [overrideRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(
      sql`${auditLogs.action} LIKE '%override%'`
    );
  const overrideFrequency = overrideRow?.count ?? 0;

  // CSV validation failures (count audit logs with csv validation failures)
  const [csvRow] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(eq(auditLogs.action, "estimate.csv_validation_failed"));
  const csvValidationFailures = csvRow?.count ?? 0;

  // Feedback reports
  const [feedbackRow] = await db
    .select({ count: count() })
    .from(fieldFeedbackReports);
  const feedbackReports = feedbackRow?.count ?? 0;

  // Field launch mode
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

/** Get estimate status distribution for dashboard chart */
export async function getEstimateStatusDistribution(): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({
      status: estimateDrafts.status,
      count: count(),
    })
    .from(estimateDrafts)
    .groupBy(estimateDrafts.status);
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}

/** Get recent audit activity for dashboard feed */
export async function getRecentAuditActivity(limit: number = 20): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(auditLogs)
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

export async function listProjectActuals(opts?: {
  projectId?: string;
  estimateItemId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ProjectActual[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.projectId) conditions.push(eq(projectActuals.projectId, opts.projectId));
  if (opts?.estimateItemId) conditions.push(eq(projectActuals.estimateItemId, opts.estimateItemId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
