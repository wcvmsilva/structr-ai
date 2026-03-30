/**
 * Sprint 22 — Learning Layer Foundation DB Helpers
 *
 * Separate analytics pipeline that reads from project_actuals and estimates.
 * Does NOT modify Scope Builder, Remodel Engine, Pricing Engine, or Override Resolver.
 *
 * Provides:
 *   1. Variance Event ingestion + queries
 *   2. Assembly Performance Metrics aggregation
 *   3. Calibration Suggestion generation + review workflow
 */

import { eq, and, desc, asc, sql, count, gte, lte, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import {
  estimateVarianceEvents,
  assemblyPerformanceMetrics,
  calibrationSuggestions,
  projectActuals,
  type EstimateVarianceEvent,
  type InsertEstimateVarianceEvent,
  type AssemblyPerformanceMetric,
  type InsertAssemblyPerformanceMetric,
  type CalibrationSuggestion,
  type InsertCalibrationSuggestion,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS (no DB — testable without mocks)
// ══════════════════════════════════════════════════════════════════════

const HIGH_VARIANCE_THRESHOLD = 20; // 20%
const MIN_SAMPLE_SIZE_FOR_SUGGESTION = 3;

/**
 * Calculate variance percentage: |actual - estimated| / estimated * 100
 * Returns 0 if estimated is 0 and actual is 0, 100 if estimated is 0 but actual is non-zero.
 */
export function calcVariancePct(estimated: number, actual: number): number {
  if (estimated === 0) return actual === 0 ? 0 : 100;
  return Math.abs(actual - estimated) / Math.abs(estimated) * 100;
}

/**
 * Determine variance direction: overrun (actual > estimated) or underrun (actual < estimated)
 */
export function getVarianceDirection(estimated: number, actual: number): "overrun" | "underrun" {
  return actual >= estimated ? "overrun" : "underrun";
}

/**
 * Calculate confidence score based on sample size and variance consistency.
 * Range: 0-100
 *   - More samples = higher base confidence
 *   - More consistent direction = higher confidence
 *   - Lower coefficient of variation = higher confidence
 */
export function calculateConfidenceScore(
  sampleSize: number,
  overrunCount: number,
  underrunCount: number,
  avgVariancePct: number
): number {
  // Base confidence from sample size (logarithmic scale, caps at ~60)
  const sampleScore = Math.min(60, Math.log2(sampleSize + 1) * 15);

  // Direction consistency (0-25): how consistently does it overrun or underrun?
  const total = overrunCount + underrunCount;
  const dominantDirection = Math.max(overrunCount, underrunCount);
  const directionScore = total > 0 ? (dominantDirection / total) * 25 : 0;

  // Variance magnitude penalty (0-15): lower avg variance = more predictable
  const variancePenalty = Math.max(0, 15 - avgVariancePct * 0.3);

  return Math.min(100, Math.round(sampleScore + directionScore + variancePenalty));
}

/**
 * Generate suggested multiplier adjustments based on performance data.
 * Returns suggested factors that would bring estimates closer to actuals.
 */
export function generateMultiplierSuggestions(
  avgEstimatedCost: number,
  avgActualCost: number,
  overrunCount: number,
  underrunCount: number
): {
  suggestedWasteFactor: number;
  suggestedLaborMultiplier: number;
  suggestedMaterialMultiplier: number;
} {
  if (avgEstimatedCost === 0) {
    return {
      suggestedWasteFactor: 1.0,
      suggestedLaborMultiplier: 1.0,
      suggestedMaterialMultiplier: 1.0,
    };
  }

  const ratio = avgActualCost / avgEstimatedCost;
  const isOverrun = overrunCount > underrunCount;

  // Split the adjustment across factors based on direction
  if (isOverrun) {
    // Actual costs are higher — increase factors
    const adjustment = ratio - 1;
    return {
      suggestedWasteFactor: parseFloat((1 + adjustment * 0.3).toFixed(4)),
      suggestedLaborMultiplier: parseFloat((1 + adjustment * 0.4).toFixed(4)),
      suggestedMaterialMultiplier: parseFloat((1 + adjustment * 0.3).toFixed(4)),
    };
  } else {
    // Actual costs are lower — decrease factors
    const adjustment = 1 - ratio;
    return {
      suggestedWasteFactor: parseFloat((1 - adjustment * 0.3).toFixed(4)),
      suggestedLaborMultiplier: parseFloat((1 - adjustment * 0.4).toFixed(4)),
      suggestedMaterialMultiplier: parseFloat((1 - adjustment * 0.3).toFixed(4)),
    };
  }
}

/**
 * Generate a human-readable rationale for a calibration suggestion.
 */
export function generateRationale(
  issueDescription: string,
  sampleSize: number,
  avgVariancePct: number,
  overrunCount: number,
  underrunCount: number,
  avgEstimatedCost: number,
  avgActualCost: number
): string {
  const direction = overrunCount > underrunCount ? "overrun" : "underrun";
  const dominantPct = Math.round(
    (Math.max(overrunCount, underrunCount) / (overrunCount + underrunCount)) * 100
  );
  const costDiff = Math.abs(avgActualCost - avgEstimatedCost);

  return (
    `Issue "${issueDescription}" shows a consistent ${direction} pattern across ${sampleSize} projects. ` +
    `${dominantPct}% of instances ${direction === "overrun" ? "exceeded" : "came under"} estimates ` +
    `with an average variance of ${avgVariancePct.toFixed(1)}% ($${costDiff.toFixed(2)} per instance). ` +
    `Suggested adjustments aim to reduce this variance by calibrating estimation factors.`
  );
}

// ══════════════════════════════════════════════════════════════════════
// 1. VARIANCE EVENTS
// ══════════════════════════════════════════════════════════════════════

export async function createVarianceEvent(
  data: InsertEstimateVarianceEvent
): Promise<EstimateVarianceEvent> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .insert(estimateVarianceEvents)
    .values(data)
    .returning();

  return result as EstimateVarianceEvent;
}

export async function createVarianceEventsFromActuals(
  projectId: string,
  estimateItemId: string
): Promise<EstimateVarianceEvent[]> {
  const db = await getDb();
  if (!db) return [];

  // Read actuals for this project+estimate
  const actuals = await db
    .select()
    .from(projectActuals)
    .where(
      and(
        eq(projectActuals.projectId, projectId),
        eq(projectActuals.estimateItemId, estimateItemId)
      )
    );

  const events: EstimateVarianceEvent[] = [];
  for (const actual of actuals) {
    if (!actual.costCodeId) continue;

    const estCost = parseFloat(String(actual.actualCost ?? 0));
    const actCost = parseFloat(String(actual.actualCost ?? 0));
    const variancePct = calcVariancePct(estCost, actCost);

    const event = await createVarianceEvent({
      projectId,
      estimateItemId,
      costCodeId: actual.costCodeId,
      eventType: "actual_recorded",
      estimatedValue: estCost,
      actualValue: actCost,
      variancePct,
      notes: actual.notes,
    });
    events.push(event);
  }

  return events;
}

export async function listVarianceEvents(opts?: {
  projectId?: string;
  estimateItemId?: string;
  costCodeId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: EstimateVarianceEvent[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.projectId) conditions.push(eq(estimateVarianceEvents.projectId, opts.projectId));
  if (opts?.estimateItemId) conditions.push(eq(estimateVarianceEvents.estimateItemId, opts.estimateItemId));
  if (opts?.costCodeId) conditions.push(eq(estimateVarianceEvents.costCodeId, opts.costCodeId));
  if (opts?.eventType) conditions.push(eq(estimateVarianceEvents.eventType, opts.eventType));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(estimateVarianceEvents).where(whereClause);
  const items = await db
    .select()
    .from(estimateVarianceEvents)
    .where(whereClause)
    .orderBy(desc(estimateVarianceEvents.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total: totalRow?.count ?? 0 };
}

export async function getVarianceEventsByCostCode(costCodeId: string): Promise<EstimateVarianceEvent[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(estimateVarianceEvents)
    .where(eq(estimateVarianceEvents.costCodeId, costCodeId))
    .orderBy(desc(estimateVarianceEvents.createdAt));
}

// ══════════════════════════════════════════════════════════════════════
// 2. ASSEMBLY PERFORMANCE METRICS — AGGREGATION PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Refresh assembly performance metrics by aggregating all variance events
 * for a given assembly. This is the core aggregation pipeline.
 */
export async function refreshAssemblyMetrics(assemblyId: string): Promise<AssemblyPerformanceMetric | null> {
  const db = await getDb();
  if (!db) return null;

  // Aggregate from variance events with this assembly (costCodeId maps to assembly context)
  const events = await db
    .select()
    .from(estimateVarianceEvents)
    .where(eq(estimateVarianceEvents.costCodeId, assemblyId));

  if (events.length === 0) return null;

  const projectCount = new Set(events.map((e) => e.projectId)).size;
  const totalEstimatedValue = events.reduce((sum, e) => sum + parseFloat(String(e.estimatedValue ?? 0)), 0);
  const totalActualValue = events.reduce((sum, e) => sum + parseFloat(String(e.actualValue ?? 0)), 0);
  const avgEstimatedCost = totalEstimatedValue / events.length;
  const avgActualCost = totalActualValue / events.length;

  // Upsert metrics
  const existing = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(eq(assemblyPerformanceMetrics.assemblyId, assemblyId))
    .limit(1);

  const metricsData: InsertAssemblyPerformanceMetric = {
    assemblyId,
    projectCount,
    avgActualCost,
    avgEstimatedCost,
    costVariancePercent: calcVariancePct(avgEstimatedCost, avgActualCost),
    lastUpdated: new Date(),
  };

  if (existing.length > 0) {
    await db
      .update(assemblyPerformanceMetrics)
      .set(metricsData)
      .where(eq(assemblyPerformanceMetrics.assemblyId, assemblyId));
    return { ...existing[0], ...metricsData } as AssemblyPerformanceMetric;
  } else {
    const [result] = await db
      .insert(assemblyPerformanceMetrics)
      .values(metricsData)
      .returning();
    return result as AssemblyPerformanceMetric;
  }
}

/**
 * Refresh metrics for ALL assemblies that have variance events.
 * Called as a batch job or after bulk actuals import.
 */
export async function refreshAllAssemblyMetrics(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get distinct assembly IDs from variance events
  const rows = await db
    .selectDistinct({ costCodeId: estimateVarianceEvents.costCodeId })
    .from(estimateVarianceEvents);

  let refreshed = 0;
  for (const row of rows) {
    if (row.costCodeId) {
      await refreshAssemblyMetrics(row.costCodeId);
      refreshed++;
    }
  }
  return refreshed;
}

export async function listAssemblyMetrics(opts?: {
  sortBy?: "variance" | "overruns" | "underruns" | "projects";
  limit?: number;
  offset?: number;
}): Promise<{ items: AssemblyPerformanceMetric[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const [totalRow] = await db
    .select({ count: count() })
    .from(assemblyPerformanceMetrics);

  let orderByCol;
  switch (opts?.sortBy) {
    case "variance":
      orderByCol = desc(assemblyPerformanceMetrics.costVariancePercent);
      break;
    case "projects":
      orderByCol = desc(assemblyPerformanceMetrics.projectCount);
      break;
    default:
      orderByCol = desc(assemblyPerformanceMetrics.costVariancePercent);
  }

  const items = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .orderBy(orderByCol)
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total: totalRow?.count ?? 0 };
}

export async function getAssemblyMetricsById(assemblyId: string): Promise<AssemblyPerformanceMetric | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(eq(assemblyPerformanceMetrics.assemblyId, assemblyId))
    .limit(1);
  return row ?? null;
}

/** Get assemblies with highest variance (top N) */
export async function getHighestVarianceAssemblies(limit: number = 10): Promise<AssemblyPerformanceMetric[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(assemblyPerformanceMetrics)
    .orderBy(desc(assemblyPerformanceMetrics.costVariancePercent))
    .limit(limit);
}

// ══════════════════════════════════════════════════════════════════════
// 3. CALIBRATION SUGGESTIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate calibration suggestions for all cost codes with sufficient data.
 * Only generates for cost codes with >= MIN_SAMPLE_SIZE_FOR_SUGGESTION events.
 */
export async function generateCalibrationSuggestions(): Promise<CalibrationSuggestion[]> {
  const db = await getDb();
  if (!db) return [];

  // Get all metrics with enough samples
  const metrics = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(gte(assemblyPerformanceMetrics.projectCount, MIN_SAMPLE_SIZE_FOR_SUGGESTION));

  const suggestions: CalibrationSuggestion[] = [];

  for (const metric of metrics) {
    const avgEstCost = parseFloat(String(metric.avgEstimatedCost ?? 0));
    const avgActCost = parseFloat(String(metric.avgActualCost ?? 0));
    const avgVarPct = parseFloat(String(metric.costVariancePercent ?? 0));

    // Skip if variance is negligible
    if (avgVarPct < 5) continue;

    const rationale = generateRationale(
      `Cost Code ${metric.assemblyId}`,
      metric.projectCount,
      avgVarPct,
      0, // overrunCount — not available in schema
      0, // underrunCount — not available in schema
      avgEstCost,
      avgActCost
    );

    // Check if a pending suggestion already exists for this cost code
    const [existing] = await db
      .select()
      .from(calibrationSuggestions)
      .where(
        and(
          eq(calibrationSuggestions.costCodeId, metric.assemblyId),
          eq(calibrationSuggestions.status, "pending")
        )
      )
      .limit(1);

    if (existing) {
      // Update existing pending suggestion
      await db
        .update(calibrationSuggestions)
        .set({
          currentValue: avgEstCost,
          suggestedValue: avgActCost,
          reasoning: rationale,
          updatedAt: new Date(),
        })
        .where(eq(calibrationSuggestions.id, existing.id));

      suggestions.push({
        ...existing,
        currentValue: avgEstCost,
        suggestedValue: avgActCost,
        reasoning: rationale,
        updatedAt: new Date(),
      } as CalibrationSuggestion);
    } else {
      // Create new suggestion
      const [result] = await db
        .insert(calibrationSuggestions)
        .values({
          costCodeId: metric.assemblyId,
          issueName: `Variance in Cost Code ${metric.assemblyId}`,
          currentValue: avgEstCost,
          suggestedValue: avgActCost,
          reasoning: rationale,
          status: "pending",
        })
        .returning();

      suggestions.push(result as CalibrationSuggestion);
    }
  }

  return suggestions;
}

export async function listCalibrationSuggestions(opts?: {
  status?: string;
  costCodeId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: CalibrationSuggestion[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.status) conditions.push(eq(calibrationSuggestions.status, opts.status));
  if (opts?.costCodeId) conditions.push(eq(calibrationSuggestions.costCodeId, opts.costCodeId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: count() })
    .from(calibrationSuggestions)
    .where(whereClause);

  const items = await db
    .select()
    .from(calibrationSuggestions)
    .where(whereClause)
    .orderBy(desc(calibrationSuggestions.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total: totalRow?.count ?? 0 };
}

export async function reviewCalibrationSuggestion(
  id: string,
  status: "pending" | "reviewed" | "accepted" | "rejected",
  reviewNotes?: string
): Promise<CalibrationSuggestion | null> {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(calibrationSuggestions)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(calibrationSuggestions.id, id));

  const [updated] = await db
    .select()
    .from(calibrationSuggestions)
    .where(eq(calibrationSuggestions.id, id))
    .limit(1);

  return updated ?? null;
}

export async function getCalibrationSuggestionById(id: string): Promise<CalibrationSuggestion | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(calibrationSuggestions)
    .where(eq(calibrationSuggestions.id, id))
    .limit(1);
  return row ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// 4. LEARNING DASHBOARD QUERIES
// ══════════════════════════════════════════════════════════════════════

export interface LearningDashboardSummary {
  totalVarianceEvents: number;
  totalCostCodesTracked: number;
  totalCalibrationSuggestions: number;
  pendingSuggestions: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
  avgSystemVariance: number;
  highestVarianceCostCode: string | null;
}

export async function getLearningDashboardSummary(): Promise<LearningDashboardSummary> {
  const db = await getDb();
  if (!db) {
    return {
      totalVarianceEvents: 0,
      totalCostCodesTracked: 0,
      totalCalibrationSuggestions: 0,
      pendingSuggestions: 0,
      acceptedSuggestions: 0,
      rejectedSuggestions: 0,
      avgSystemVariance: 0,
      highestVarianceCostCode: null,
    };
  }

  const [eventsRow] = await db.select({ count: count() }).from(estimateVarianceEvents);
  const [metricsRow] = await db.select({ count: count() }).from(assemblyPerformanceMetrics);
  const [suggestionsRow] = await db.select({ count: count() }).from(calibrationSuggestions);

  const statusRows = await db
    .select({ status: calibrationSuggestions.status, count: count() })
    .from(calibrationSuggestions)
    .groupBy(calibrationSuggestions.status);
  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = r.count;

  // Average system-wide variance
  const [avgRow] = await db
    .select({ avg: sql<string>`COALESCE(AVG(${assemblyPerformanceMetrics.costVariancePercent}), 0)` })
    .from(assemblyPerformanceMetrics);

  // Top variance cost code
  const [topVariance] = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .orderBy(desc(assemblyPerformanceMetrics.costVariancePercent))
    .limit(1);

  return {
    totalVarianceEvents: eventsRow?.count ?? 0,
    totalCostCodesTracked: metricsRow?.count ?? 0,
    totalCalibrationSuggestions: suggestionsRow?.count ?? 0,
    pendingSuggestions: statusMap.pending ?? 0,
    acceptedSuggestions: statusMap.accepted ?? 0,
    rejectedSuggestions: statusMap.rejected ?? 0,
    avgSystemVariance: parseFloat(String(avgRow?.avg ?? 0)),
    highestVarianceCostCode: topVariance?.assemblyId ?? null,
  };
}

// ══════════════════════════════════════════════════════════════════════
// COMPATIBILITY ALIASES (old function names for router compatibility)
// ══════════════════════════════════════════════════════════════════════

/** Alias: old routers import getVarianceEventsByAssembly */
export const getVarianceEventsByAssembly = getVarianceEventsByCostCode;

/** Alias: old routers import getConsistentOverruns */
export async function getConsistentOverruns(limit: number = 10): Promise<AssemblyPerformanceMetric[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(sql`CAST(${assemblyPerformanceMetrics.costVariancePercent} AS NUMERIC) > 0`)
    .orderBy(desc(assemblyPerformanceMetrics.costVariancePercent))
    .limit(limit);
}

/** Alias: old routers import getConsistentUnderruns */
export async function getConsistentUnderruns(limit: number = 10): Promise<AssemblyPerformanceMetric[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(sql`CAST(${assemblyPerformanceMetrics.costVariancePercent} AS NUMERIC) < 0`)
    .orderBy(asc(assemblyPerformanceMetrics.costVariancePercent))
    .limit(limit);
}
