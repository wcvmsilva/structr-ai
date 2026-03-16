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
  assemblyName: string,
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
    `Assembly "${assemblyName}" shows a consistent ${direction} pattern across ${sampleSize} projects. ` +
    `${dominantPct}% of instances ${direction === "overrun" ? "exceeded" : "came under"} estimates ` +
    `with an average variance of ${avgVariancePct.toFixed(1)}% ($${costDiff.toFixed(2)} per instance). ` +
    `Suggested multiplier adjustments aim to reduce this variance by calibrating waste, labor, and material factors.`
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
  const [result] = await db.insert(estimateVarianceEvents).values(data);
  return {
    ...data,
    id: result.insertId,
    varianceDirection: data.varianceDirection ?? "overrun",
    assemblyName: data.assemblyName ?? null,
    trade: data.trade ?? null,
    region: data.region ?? null,
    notes: data.notes ?? null,
    createdAt: new Date(),
  } as EstimateVarianceEvent;
}

export async function createVarianceEventsFromActuals(
  projectId: number,
  estimateId: number
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
        eq(projectActuals.estimateDraftId, estimateId)
      )
    );

  const events: EstimateVarianceEvent[] = [];
  for (const actual of actuals) {
    if (!actual.assemblyId) continue;

    const estCost = parseFloat(String(actual.estimatedTotalCost ?? 0));
    const actCost = parseFloat(String(actual.actualTotalCost ?? 0));
    const variancePct = calcVariancePct(estCost, actCost);
    const varianceAmount = actCost - estCost;
    const direction = getVarianceDirection(estCost, actCost);

    // Infer variance type from trade/category
    const varianceType = inferVarianceType(actual.trade, actual.category);

    const event = await createVarianceEvent({
      projectId,
      estimateId,
      assemblyId: actual.assemblyId,
      assemblyName: actual.assemblyName,
      estimatedCost: estCost.toFixed(2),
      actualCost: actCost.toFixed(2),
      variancePct: variancePct.toFixed(2),
      varianceAmount: varianceAmount.toFixed(2),
      varianceType,
      varianceDirection: direction,
      trade: actual.trade,
      region: actual.region,
    });
    events.push(event);
  }

  return events;
}

/**
 * Infer variance type from trade/category.
 * Falls back to "scope_variance" if no match.
 */
export function inferVarianceType(
  trade?: string | null,
  category?: string | null
): "labor_variance" | "material_variance" | "waste_variance" | "scope_variance" {
  const t = (trade ?? "").toLowerCase();
  const c = (category ?? "").toLowerCase();

  if (t.includes("labor") || t.includes("crew") || c.includes("labor")) return "labor_variance";
  if (t.includes("material") || t.includes("supply") || c.includes("material")) return "material_variance";
  if (t.includes("waste") || t.includes("disposal") || c.includes("waste") || c.includes("demo")) return "waste_variance";
  return "scope_variance";
}

export async function listVarianceEvents(opts?: {
  projectId?: number;
  estimateId?: number;
  assemblyId?: number;
  varianceType?: string;
  varianceDirection?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: EstimateVarianceEvent[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.projectId) conditions.push(eq(estimateVarianceEvents.projectId, opts.projectId));
  if (opts?.estimateId) conditions.push(eq(estimateVarianceEvents.estimateId, opts.estimateId));
  if (opts?.assemblyId) conditions.push(eq(estimateVarianceEvents.assemblyId, opts.assemblyId));
  if (opts?.varianceType) conditions.push(eq(estimateVarianceEvents.varianceType, opts.varianceType as any));
  if (opts?.varianceDirection) conditions.push(eq(estimateVarianceEvents.varianceDirection, opts.varianceDirection as any));

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

export async function getVarianceEventsByAssembly(assemblyId: number): Promise<EstimateVarianceEvent[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(estimateVarianceEvents)
    .where(eq(estimateVarianceEvents.assemblyId, assemblyId))
    .orderBy(desc(estimateVarianceEvents.createdAt));
}

// ══════════════════════════════════════════════════════════════════════
// 2. ASSEMBLY PERFORMANCE METRICS — AGGREGATION PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Refresh assembly performance metrics by aggregating all variance events
 * for a given assembly. This is the core aggregation pipeline.
 */
export async function refreshAssemblyMetrics(assemblyId: number): Promise<AssemblyPerformanceMetric | null> {
  const db = await getDb();
  if (!db) return null;

  // Aggregate from variance events
  const events = await db
    .select()
    .from(estimateVarianceEvents)
    .where(eq(estimateVarianceEvents.assemblyId, assemblyId));

  if (events.length === 0) return null;

  const projectCount = new Set(events.map((e) => e.projectId)).size;
  const totalEstimatedCost = events.reduce((sum, e) => sum + parseFloat(String(e.estimatedCost)), 0);
  const totalActualCost = events.reduce((sum, e) => sum + parseFloat(String(e.actualCost)), 0);
  const avgEstimatedCost = totalEstimatedCost / events.length;
  const avgActualCost = totalActualCost / events.length;
  const avgVariancePct = events.reduce((sum, e) => sum + parseFloat(String(e.variancePct)), 0) / events.length;
  const overrunCount = events.filter((e) => e.varianceDirection === "overrun").length;
  const underrunCount = events.filter((e) => e.varianceDirection === "underrun").length;
  const highVarianceCount = events.filter((e) => parseFloat(String(e.variancePct)) > HIGH_VARIANCE_THRESHOLD).length;

  const assemblyName = events[0]?.assemblyName ?? null;

  // Upsert metrics
  const existing = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(eq(assemblyPerformanceMetrics.assemblyId, assemblyId))
    .limit(1);

  const metricsData = {
    assemblyId,
    assemblyName,
    projectCount,
    avgEstimatedQty: "0", // Will be populated when qty data flows through
    avgActualQty: "0",
    avgEstimatedCost: avgEstimatedCost.toFixed(2),
    avgActualCost: avgActualCost.toFixed(2),
    avgVariancePct: avgVariancePct.toFixed(2),
    totalEstimatedCost: totalEstimatedCost.toFixed(2),
    totalActualCost: totalActualCost.toFixed(2),
    overrunCount,
    underrunCount,
    highVarianceCount,
  };

  if (existing.length > 0) {
    await db
      .update(assemblyPerformanceMetrics)
      .set(metricsData)
      .where(eq(assemblyPerformanceMetrics.assemblyId, assemblyId));
    return { ...existing[0], ...metricsData, lastUpdated: new Date() } as AssemblyPerformanceMetric;
  } else {
    const [result] = await db.insert(assemblyPerformanceMetrics).values(metricsData as any);
    return {
      ...metricsData,
      id: result.insertId,
      lastUpdated: new Date(),
      createdAt: new Date(),
    } as unknown as AssemblyPerformanceMetric;
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
    .selectDistinct({ assemblyId: estimateVarianceEvents.assemblyId })
    .from(estimateVarianceEvents);

  let refreshed = 0;
  for (const row of rows) {
    await refreshAssemblyMetrics(row.assemblyId);
    refreshed++;
  }
  return refreshed;
}

export async function listAssemblyMetrics(opts?: {
  sortBy?: "variance" | "overruns" | "underruns" | "projects";
  limit?: number;
  offset?: number;
  highVarianceOnly?: boolean;
}): Promise<{ items: AssemblyPerformanceMetric[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.highVarianceOnly) {
    conditions.push(sql`${assemblyPerformanceMetrics.highVarianceCount} > 0`);
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: count() })
    .from(assemblyPerformanceMetrics)
    .where(whereClause);

  let orderByCol;
  switch (opts?.sortBy) {
    case "variance":
      orderByCol = desc(assemblyPerformanceMetrics.avgVariancePct);
      break;
    case "overruns":
      orderByCol = desc(assemblyPerformanceMetrics.overrunCount);
      break;
    case "underruns":
      orderByCol = desc(assemblyPerformanceMetrics.underrunCount);
      break;
    case "projects":
      orderByCol = desc(assemblyPerformanceMetrics.projectCount);
      break;
    default:
      orderByCol = desc(assemblyPerformanceMetrics.avgVariancePct);
  }

  const items = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(whereClause)
    .orderBy(orderByCol)
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total: totalRow?.count ?? 0 };
}

export async function getAssemblyMetricsById(assemblyId: number): Promise<AssemblyPerformanceMetric | null> {
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
    .orderBy(desc(assemblyPerformanceMetrics.avgVariancePct))
    .limit(limit);
}

/** Get assemblies with consistent overruns */
export async function getConsistentOverruns(limit: number = 10): Promise<AssemblyPerformanceMetric[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(sql`${assemblyPerformanceMetrics.overrunCount} > ${assemblyPerformanceMetrics.underrunCount}`)
    .orderBy(desc(assemblyPerformanceMetrics.overrunCount))
    .limit(limit);
}

/** Get assemblies with consistent underruns */
export async function getConsistentUnderruns(limit: number = 10): Promise<AssemblyPerformanceMetric[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(assemblyPerformanceMetrics)
    .where(sql`${assemblyPerformanceMetrics.underrunCount} > ${assemblyPerformanceMetrics.overrunCount}`)
    .orderBy(desc(assemblyPerformanceMetrics.underrunCount))
    .limit(limit);
}

// ══════════════════════════════════════════════════════════════════════
// 3. CALIBRATION SUGGESTIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate calibration suggestions for all assemblies with sufficient data.
 * Only generates for assemblies with >= MIN_SAMPLE_SIZE_FOR_SUGGESTION events.
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
    const avgVarPct = parseFloat(String(metric.avgVariancePct ?? 0));

    // Skip if variance is negligible
    if (avgVarPct < 5) continue;

    const multipliers = generateMultiplierSuggestions(
      avgEstCost,
      avgActCost,
      metric.overrunCount,
      metric.underrunCount
    );

    const confidence = calculateConfidenceScore(
      metric.projectCount,
      metric.overrunCount,
      metric.underrunCount,
      avgVarPct
    );

    const rationale = generateRationale(
      metric.assemblyName ?? `Assembly #${metric.assemblyId}`,
      metric.projectCount,
      avgVarPct,
      metric.overrunCount,
      metric.underrunCount,
      avgEstCost,
      avgActCost
    );

    // Check if a pending suggestion already exists for this assembly
    const [existing] = await db
      .select()
      .from(calibrationSuggestions)
      .where(
        and(
          eq(calibrationSuggestions.assemblyId, metric.assemblyId),
          eq(calibrationSuggestions.status, "pending")
        )
      )
      .limit(1);

    if (existing) {
      // Update existing pending suggestion
      await db
        .update(calibrationSuggestions)
        .set({
          suggestedWasteFactor: multipliers.suggestedWasteFactor.toFixed(4),
          suggestedLaborMultiplier: multipliers.suggestedLaborMultiplier.toFixed(4),
          suggestedMaterialMultiplier: multipliers.suggestedMaterialMultiplier.toFixed(4),
          confidenceScore: confidence.toFixed(2),
          sampleSize: metric.projectCount,
          avgVariancePct: avgVarPct.toFixed(2),
          rationale,
        })
        .where(eq(calibrationSuggestions.id, existing.id));

      suggestions.push({
        ...existing,
        suggestedWasteFactor: multipliers.suggestedWasteFactor.toFixed(4),
        suggestedLaborMultiplier: multipliers.suggestedLaborMultiplier.toFixed(4),
        suggestedMaterialMultiplier: multipliers.suggestedMaterialMultiplier.toFixed(4),
        confidenceScore: confidence.toFixed(2),
        sampleSize: metric.projectCount,
        avgVariancePct: avgVarPct.toFixed(2),
        rationale,
      } as CalibrationSuggestion);
    } else {
      // Create new suggestion
      const [result] = await db.insert(calibrationSuggestions).values({
        assemblyId: metric.assemblyId,
        assemblyName: metric.assemblyName,
        suggestedWasteFactor: multipliers.suggestedWasteFactor.toFixed(4),
        suggestedLaborMultiplier: multipliers.suggestedLaborMultiplier.toFixed(4),
        suggestedMaterialMultiplier: multipliers.suggestedMaterialMultiplier.toFixed(4),
        confidenceScore: confidence.toFixed(2),
        sampleSize: metric.projectCount,
        avgVariancePct: avgVarPct.toFixed(2),
        rationale,
        status: "pending",
      } as any);

      suggestions.push({
        id: result.insertId,
        assemblyId: metric.assemblyId,
        assemblyName: metric.assemblyName,
        suggestedWasteFactor: multipliers.suggestedWasteFactor.toFixed(4),
        suggestedLaborMultiplier: multipliers.suggestedLaborMultiplier.toFixed(4),
        suggestedMaterialMultiplier: multipliers.suggestedMaterialMultiplier.toFixed(4),
        confidenceScore: confidence.toFixed(2),
        sampleSize: metric.projectCount,
        avgVariancePct: avgVarPct.toFixed(2),
        rationale,
        status: "pending",
        currentWasteFactor: null,
        currentLaborMultiplier: null,
        currentMaterialMultiplier: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        generatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CalibrationSuggestion);
    }
  }

  return suggestions;
}

export async function listCalibrationSuggestions(opts?: {
  status?: string;
  assemblyId?: number;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}): Promise<{ items: CalibrationSuggestion[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];
  if (opts?.status) conditions.push(eq(calibrationSuggestions.status, opts.status as any));
  if (opts?.assemblyId) conditions.push(eq(calibrationSuggestions.assemblyId, opts.assemblyId));
  if (opts?.minConfidence) {
    conditions.push(gte(calibrationSuggestions.confidenceScore, opts.minConfidence.toFixed(2)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: count() })
    .from(calibrationSuggestions)
    .where(whereClause);

  const items = await db
    .select()
    .from(calibrationSuggestions)
    .where(whereClause)
    .orderBy(desc(calibrationSuggestions.confidenceScore))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { items, total: totalRow?.count ?? 0 };
}

export async function reviewCalibrationSuggestion(
  id: number,
  status: "reviewed" | "accepted" | "rejected",
  reviewedBy: number,
  reviewNotes?: string
): Promise<CalibrationSuggestion | null> {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(calibrationSuggestions)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes ?? null,
    })
    .where(eq(calibrationSuggestions.id, id));

  const [updated] = await db
    .select()
    .from(calibrationSuggestions)
    .where(eq(calibrationSuggestions.id, id))
    .limit(1);

  return updated ?? null;
}

export async function getCalibrationSuggestionById(id: number): Promise<CalibrationSuggestion | null> {
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
  totalAssembliesTracked: number;
  totalCalibrationSuggestions: number;
  pendingSuggestions: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
  avgSystemVariance: number;
  highestVarianceAssembly: string | null;
  mostOverrunAssembly: string | null;
  mostUnderrunAssembly: string | null;
}

export async function getLearningDashboardSummary(): Promise<LearningDashboardSummary> {
  const db = await getDb();
  if (!db) {
    return {
      totalVarianceEvents: 0,
      totalAssembliesTracked: 0,
      totalCalibrationSuggestions: 0,
      pendingSuggestions: 0,
      acceptedSuggestions: 0,
      rejectedSuggestions: 0,
      avgSystemVariance: 0,
      highestVarianceAssembly: null,
      mostOverrunAssembly: null,
      mostUnderrunAssembly: null,
    };
  }

  const [eventsRow] = await db.select({ count: count() }).from(estimateVarianceEvents);
  const [assembliesRow] = await db.select({ count: count() }).from(assemblyPerformanceMetrics);
  const [suggestionsRow] = await db.select({ count: count() }).from(calibrationSuggestions);

  const statusRows = await db
    .select({ status: calibrationSuggestions.status, count: count() })
    .from(calibrationSuggestions)
    .groupBy(calibrationSuggestions.status);
  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = r.count;

  // Average system-wide variance
  const [avgRow] = await db
    .select({ avg: sql<string>`COALESCE(AVG(${assemblyPerformanceMetrics.avgVariancePct}), 0)` })
    .from(assemblyPerformanceMetrics);

  // Top variance/overrun/underrun assemblies
  const [topVariance] = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .orderBy(desc(assemblyPerformanceMetrics.avgVariancePct))
    .limit(1);
  const [topOverrun] = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .orderBy(desc(assemblyPerformanceMetrics.overrunCount))
    .limit(1);
  const [topUnderrun] = await db
    .select()
    .from(assemblyPerformanceMetrics)
    .orderBy(desc(assemblyPerformanceMetrics.underrunCount))
    .limit(1);

  return {
    totalVarianceEvents: eventsRow?.count ?? 0,
    totalAssembliesTracked: assembliesRow?.count ?? 0,
    totalCalibrationSuggestions: suggestionsRow?.count ?? 0,
    pendingSuggestions: statusMap.pending ?? 0,
    acceptedSuggestions: statusMap.accepted ?? 0,
    rejectedSuggestions: statusMap.rejected ?? 0,
    avgSystemVariance: parseFloat(String(avgRow?.avg ?? 0)),
    highestVarianceAssembly: topVariance?.assemblyName ?? null,
    mostOverrunAssembly: topOverrun?.assemblyName ?? null,
    mostUnderrunAssembly: topUnderrun?.assemblyName ?? null,
  };
}
