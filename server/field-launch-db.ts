/**
 * Sprint 21 — Field Launch Control DB Helpers
 *
 * Provides:
 *   - Feature flag management (get/set system settings)
 *   - Monitoring dashboard aggregations
 *   - Field feedback CRUD
 *   - Project actuals CRUD + variance detection
 */

import { eq, and, desc, sql, count, gte, lte, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import {
  systemSettings,
  fieldFeedbackReports,
  projectActuals,
  estimateDrafts,
  auditLogs,
  systemIssueReports,
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
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return row ?? null;
}

export async function setSystemSetting(
  key: string,
  value: string,
  description?: string,
  updatedBy?: number
): Promise<SystemSetting> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getSystemSetting(key);
  if (existing) {
    await db
      .update(systemSettings)
      .set({ value, description: description ?? existing.description, updatedBy: updatedBy ?? existing.updatedBy })
      .where(eq(systemSettings.key, key));
    return { ...existing, value, updatedBy: updatedBy ?? existing.updatedBy };
  }

  const [result] = await db.insert(systemSettings).values({
    key,
    value,
    description,
    updatedBy,
  });
  return {
    id: result.insertId,
    key,
    value,
    description: description ?? null,
    updatedBy: updatedBy ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function isFieldLaunchEnabled(): Promise<boolean> {
  const setting = await getSystemSetting(FIELD_LAUNCH_KEY);
  return setting?.value === "true";
}

export async function setFieldLaunchMode(enabled: boolean, userId?: number): Promise<SystemSetting> {
  return setSystemSetting(
    FIELD_LAUNCH_KEY,
    enabled ? "true" : "false",
    "Controls field launch monitoring, feedback capture, and additional audit logging",
    userId
  );
}

export async function listSystemSettings(): Promise<SystemSetting[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(systemSettings).orderBy(systemSettings.key);
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

  // High variance projects
  const [varianceRow] = await db
    .select({ count: count() })
    .from(projectActuals)
    .where(eq(projectActuals.isHighVariance, true));
  const highVarianceProjects = varianceRow?.count ?? 0;

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
    highVarianceProjects,
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
  const [result] = await db.insert(fieldFeedbackReports).values(data);
  return {
    ...data,
    id: result.insertId,
    resolution: data.resolution ?? null,
    status: data.status ?? "open",
    resolvedBy: data.resolvedBy ?? null,
    resolvedAt: data.resolvedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as FieldFeedbackReport;
}

export async function listFieldFeedback(opts?: {
  projectId?: number;
  estimateId?: number;
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: FieldFeedbackReport[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.projectId) conditions.push(eq(fieldFeedbackReports.projectId, opts.projectId));
  if (opts?.estimateId) conditions.push(eq(fieldFeedbackReports.estimateId, opts.estimateId));
  if (opts?.status) conditions.push(eq(fieldFeedbackReports.status, opts.status as any));
  if (opts?.severity) conditions.push(eq(fieldFeedbackReports.severity, opts.severity as any));

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

export async function getFieldFeedbackById(id: number): Promise<FieldFeedbackReport | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(fieldFeedbackReports).where(eq(fieldFeedbackReports.id, id)).limit(1);
  return row ?? null;
}

export async function resolveFieldFeedback(
  id: number,
  resolution: string,
  resolvedBy: number
): Promise<FieldFeedbackReport | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(fieldFeedbackReports)
    .set({
      status: "resolved",
      resolution,
      resolvedBy,
      resolvedAt: new Date(),
    })
    .where(eq(fieldFeedbackReports.id, id));
  return getFieldFeedbackById(id);
}

export async function dismissFieldFeedback(id: number): Promise<void> {
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
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, open: 0, inReview: 0, resolved: 0, dismissed: 0, bySeverity: {}, byType: {} };

  const [totalRow] = await db.select({ count: count() }).from(fieldFeedbackReports);
  const statusRows = await db
    .select({ status: fieldFeedbackReports.status, count: count() })
    .from(fieldFeedbackReports)
    .groupBy(fieldFeedbackReports.status);
  const severityRows = await db
    .select({ severity: fieldFeedbackReports.severity, count: count() })
    .from(fieldFeedbackReports)
    .groupBy(fieldFeedbackReports.severity);
  const typeRows = await db
    .select({ issueType: fieldFeedbackReports.issueType, count: count() })
    .from(fieldFeedbackReports)
    .groupBy(fieldFeedbackReports.issueType);

  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = r.count;
  const bySeverity: Record<string, number> = {};
  for (const r of severityRows) bySeverity[r.severity] = r.count;
  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[r.issueType] = r.count;

  return {
    total: totalRow?.count ?? 0,
    open: statusMap.open ?? 0,
    inReview: statusMap.in_review ?? 0,
    resolved: statusMap.resolved ?? 0,
    dismissed: statusMap.dismissed ?? 0,
    bySeverity,
    byType,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 4. PROJECT ACTUALS + VARIANCE DETECTION
// ══════════════════════════════════════════════════════════════════════

const HIGH_VARIANCE_THRESHOLD = 0.20; // 20%

/**
 * Calculate variance percentage: |actual - estimated| / estimated
 * Returns 0 if estimated is 0 to avoid division by zero.
 */
export function calculateVariancePct(estimated: number, actual: number): number {
  if (estimated === 0) return actual === 0 ? 0 : 100;
  return Math.abs(actual - estimated) / Math.abs(estimated) * 100;
}

/**
 * Determine if variance exceeds the high-variance threshold (20%).
 */
export function isHighVarianceCheck(variancePct: number): boolean {
  return variancePct > HIGH_VARIANCE_THRESHOLD * 100;
}

export async function recordProjectActual(
  data: Omit<InsertProjectActual, "variancePct" | "varianceAmount" | "isHighVariance">
): Promise<ProjectActual> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const estCost = parseFloat(String(data.estimatedTotalCost ?? 0));
  const actCost = parseFloat(String(data.actualTotalCost ?? 0));
  const variancePct = calculateVariancePct(estCost, actCost);
  const varianceAmount = actCost - estCost;
  const isHigh = isHighVarianceCheck(variancePct);

  const [result] = await db.insert(projectActuals).values({
    ...data,
    variancePct: variancePct.toFixed(2),
    varianceAmount: varianceAmount.toFixed(2),
    isHighVariance: isHigh,
  } as any);

  return {
    ...data,
    id: result.insertId,
    variancePct: variancePct.toFixed(2),
    varianceAmount: varianceAmount.toFixed(2),
    isHighVariance: isHigh,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ProjectActual;
}

export async function listProjectActuals(opts?: {
  projectId?: number;
  estimateId?: number;
  highVarianceOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: ProjectActual[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.projectId) conditions.push(eq(projectActuals.projectId, opts.projectId));
  if (opts?.estimateId) conditions.push(eq(projectActuals.estimateDraftId, opts.estimateId));
  if (opts?.highVarianceOnly) conditions.push(eq(projectActuals.isHighVariance, true));

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

export async function getProjectActualById(id: number): Promise<ProjectActual | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(projectActuals).where(eq(projectActuals.id, id)).limit(1);
  return row ?? null;
}

export async function getVarianceSummary(projectId: number): Promise<{
  totalItems: number;
  highVarianceItems: number;
  totalEstimatedCost: number;
  totalActualCost: number;
  overallVariancePct: number;
  isHighVarianceProject: boolean;
}> {
  const db = await getDb();
  if (!db) return {
    totalItems: 0,
    highVarianceItems: 0,
    totalEstimatedCost: 0,
    totalActualCost: 0,
    overallVariancePct: 0,
    isHighVarianceProject: false,
  };

  const items = await db
    .select()
    .from(projectActuals)
    .where(eq(projectActuals.projectId, projectId));

  const totalItems = items.length;
  const highVarianceItems = items.filter((i) => i.isHighVariance).length;
  const totalEstimatedCost = items.reduce((sum, i) => sum + parseFloat(String(i.estimatedTotalCost ?? 0)), 0);
  const totalActualCost = items.reduce((sum, i) => sum + parseFloat(String(i.actualTotalCost ?? 0)), 0);
  const overallVariancePct = calculateVariancePct(totalEstimatedCost, totalActualCost);
  const isHighVarianceProject = isHighVarianceCheck(overallVariancePct);

  return {
    totalItems,
    highVarianceItems,
    totalEstimatedCost,
    totalActualCost,
    overallVariancePct,
    isHighVarianceProject,
  };
}
