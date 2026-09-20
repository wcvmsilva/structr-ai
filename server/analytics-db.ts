/**
 * structr.ai — PHASE 4 Analytics Persistence
 *
 * Contract: docs/phase4-contract.md §6 (AN-001 … AN-004)
 *
 * Reads live tenant data and feeds `shared/analytics-aggregation-engine.ts`. Every query in this
 * module goes through `tenantWhere()` — a cross-tenant dashboard is not a reporting feature, it
 * is a data breach with charts.
 *
 * Snapshots exist for one reason: a month that has been closed must keep reporting the numbers
 * it closed with. Recomputing "last quarter" from live data after three change orders landed
 * produces a different past every time it is asked about.
 */

import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { nonHistoricalEstimateCondition } from "./historical-estimate-guard";
import {
  analyticsSnapshots,
  estimateDrafts,
  fieldTasks,
  projectCostActuals,
  projects,
  subcontractors,
  type AnalyticsSnapshot,
} from "../drizzle/schema";
import { recordAuditAsync } from "./audit-trail";
import { tenantWhere, withTenant } from "./tenant-scope";
import {
  aggregateFieldProgress,
  computeProfitHealth,
  rankSubcontractors,
  type FieldProgressRow,
  type ProfitHealthSummary,
  type ProjectMarginRow,
  type FieldProgressSummaryResult,
  type SubcontractorPerformanceRow,
  type SubcontractorScore,
} from "@shared/analytics-aggregation-engine";
import { toCents } from "@shared/actuals-variance-engine";
import { getCalibrationSummary } from "./calibration-db";
import { getAdjustmentSummary } from "./price-adjustment-db";
import { getEffectiveFloor } from "./tenant-settings-db";
import type { CommercialChannel } from "@shared/domain/phase2-taxonomy";
import type { GeoRiskClass } from "@shared/constants/profit-shield";

import { getExactEstimatePipeline } from "./estimate-aggregate-db";
import { buildExactDashboard, type ExactDashboardResult, type UnavailableRevenueForecast } from "@shared/analytics-exact-dashboard";
import { ANALYTICS_FORECAST_UNAVAILABLE_REASON, ANALYTICS_SNAPSHOT_HOLD_CODE } from "@shared/domain/taxonomy";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type AnalyticsErrorCode = "DB_UNAVAILABLE" | "SNAPSHOT_NOT_FOUND" | "TENANT_MISMATCH" | typeof ANALYTICS_SNAPSHOT_HOLD_CODE;

export class AnalyticsError extends Error {
  public readonly code: AnalyticsErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: AnalyticsErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AnalyticsError";
    this.code = code;
    this.details = details;
  }
}

function numOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ══════════════════════════════════════════════════════════════════════
// PIPELINE (AN-001)
// ══════════════════════════════════════════════════════════════════════

/**
 * Live commercial pipeline.
 *
 * Open leads and unsigned estimates are both opportunities, so both are read. A lead with an
 * estimate attached is counted at the estimate's stage, not the lead's, because that is where
 * the money actually is.
 */
export async function getPipeline(input: { tenantId: string; now?: Date }) {
  return getExactEstimatePipeline(input);
}

// ══════════════════════════════════════════════════════════════════════
// REVENUE FORECAST (AN-002)
// ══════════════════════════════════════════════════════════════════════

/** Opportunity data does not authorize execution revenue or an approved backlog. */
export async function getRevenueForecast(_input: {
  tenantId: string; monthCount?: number; now?: Date;
}): Promise<UnavailableRevenueForecast> {
  return { state: "unavailable", reason: ANALYTICS_FORECAST_UNAVAILABLE_REASON };
}

// ══════════════════════════════════════════════════════════════════════
// PROFIT HEALTH (AN-003)
// ══════════════════════════════════════════════════════════════════════

/**
 * Portfolio profit health against the floor that was enforced at approval.
 *
 * The floor is resolved per project through `getEffectiveFloor`, not read from a constant, so a
 * tenant that configured stricter floors is measured against its own rules.
 */
export async function getProfitHealth(input: {
  tenantId: string;
  from?: string | null;
  to?: string | null;
}): Promise<ProfitHealthSummary> {
  const db = await getDb();
  if (!db) return computeProfitHealth([]);

  const conditions: Array<SQL | undefined> = [isNull(projects.deletedAt)];
  if (input.from) conditions.push(gte(projects.createdAt, new Date(input.from)));
  if (input.to) conditions.push(lte(projects.createdAt, new Date(input.to)));

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectType: projects.projectType,
      commercialChannel: projects.commercialChannel,
      geoRiskClass: projects.geoRiskClass,
      approvedBudgetCents: projects.approvedBudgetCents,
      changeOrderBudgetCents: projects.changeOrderBudgetCents,
      committedCostCents: projects.committedCostCents,
      realizedGrossProfitPct: projects.realizedGrossProfitPct,
      status: projects.status,
    })
    .from(projects)
    .where(tenantWhere(projects, input.tenantId, ...conditions))
    .limit(1000);

  const marginRows: ProjectMarginRow[] = [];

  for (const row of rows) {
    const contract =
      Math.round(Number(row.approvedBudgetCents ?? 0)) +
      Math.round(Number(row.changeOrderBudgetCents ?? 0));
    if (contract <= 0) continue;

    const channel = (row.commercialChannel ?? "premium") as CommercialChannel;
    const floor = await getEffectiveFloor({
      tenantId: input.tenantId,
      channel,
      geoRiskClass: (row.geoRiskClass as GeoRiskClass | null) ?? null,
    }).catch(() => null);

    // Estimated margin from the approved estimate, when it exists.
    const [budget] = await db
      .select({ grossProfitPct: estimateDrafts.grossProfitPct })
      .from(estimateDrafts)
      .where(
        and(
          eq(estimateDrafts.projectId, row.id),
          eq(estimateDrafts.status, "approved"),
          isNull(estimateDrafts.supersededBy),
          isNull(estimateDrafts.changeOrderOf),
          nonHistoricalEstimateCondition(),
        ),
      )
      .orderBy(desc(estimateDrafts.version))
      .limit(1);

    marginRows.push({
      projectId: row.id,
      projectName: row.name,
      projectType: row.projectType,
      commercialChannel: row.commercialChannel,
      geoRiskClass: row.geoRiskClass,
      contractValueCents: contract,
      committedCostCents: Math.round(Number(row.committedCostCents ?? 0)),
      estimatedGrossProfitPct: numOrNull(budget?.grossProfitPct as never),
      enforcedFloorPct: floor?.floorPct ?? null,
      status: row.status,
    });
  }

  return computeProfitHealth(marginRows);
}

// ══════════════════════════════════════════════════════════════════════
// FIELD PROGRESS (AN-004)
// ══════════════════════════════════════════════════════════════════════

export async function getFieldProgressAnalytics(input: {
  tenantId: string;
  now?: Date;
}): Promise<FieldProgressSummaryResult> {
  const db = await getDb();
  if (!db) return aggregateFieldProgress([]);

  const now = input.now ?? new Date();

  const activeProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      endDate: projects.endDate,
    })
    .from(projects)
    .where(
      tenantWhere(
        projects,
        input.tenantId,
        isNull(projects.deletedAt),
        inArray(projects.status, ["active", "in_production", "field_active"]),
      ),
    )
    .limit(500);

  if (activeProjects.length === 0) return aggregateFieldProgress([]);

  const projectIds = activeProjects.map(p => p.id);

  const taskRows = await db
    .select({
      projectId: fieldTasks.projectId,
      status: fieldTasks.status,
      plannedEndDate: fieldTasks.plannedEndDate,
      actualEndDate: fieldTasks.actualEndDate,
    })
    .from(fieldTasks)
    .where(and(inArray(fieldTasks.projectId, projectIds), isNull(fieldTasks.deletedAt)))
    .limit(20000);

  const byProject = new Map<
    string,
    { total: number; completed: number; blocked: number; overdue: number; latestForecast: string | null }
  >();

  for (const task of taskRows) {
    if (!task.projectId) continue;
    const acc =
      byProject.get(task.projectId) ??
      { total: 0, completed: 0, blocked: 0, overdue: 0, latestForecast: null };

    acc.total += 1;
    if (task.status === "completed" || task.status === "verified") acc.completed += 1;
    if (task.status === "blocked") acc.blocked += 1;

    const plannedEnd = task.plannedEndDate ? String(task.plannedEndDate) : null;
    const isOpen = task.status !== "completed" && task.status !== "verified" && task.status !== "cancelled";
    if (isOpen && plannedEnd && Date.parse(plannedEnd) < now.getTime()) {
      acc.overdue += 1;
      // An open task past its planned end pushes the project's forecast to today at minimum.
      const forecast = now.toISOString().slice(0, 10);
      if (!acc.latestForecast || forecast > acc.latestForecast) acc.latestForecast = forecast;
    }
    if (plannedEnd && (!acc.latestForecast || plannedEnd > acc.latestForecast)) {
      acc.latestForecast = plannedEnd;
    }

    byProject.set(task.projectId, acc);
  }

  const rows: FieldProgressRow[] = activeProjects.map(p => {
    const acc = byProject.get(p.id) ?? {
      total: 0,
      completed: 0,
      blocked: 0,
      overdue: 0,
      latestForecast: null,
    };

    return {
      projectId: p.id,
      projectName: p.name,
      taskCount: acc.total,
      completedTaskCount: acc.completed,
      blockedTaskCount: acc.blocked,
      overdueTaskCount: acc.overdue,
      plannedEndDate: p.endDate ? String(p.endDate) : null,
      forecastEndDate: acc.latestForecast,
    };
  });

  return aggregateFieldProgress(rows);
}

// ══════════════════════════════════════════════════════════════════════
// SUBCONTRACTOR LEADERBOARD
// ══════════════════════════════════════════════════════════════════════

export async function getSubcontractorLeaderboard(input: {
  tenantId: string;
}): Promise<SubcontractorScore[]> {
  const db = await getDb();
  if (!db) return [];

  const subs = await db
    .select({
      id: subcontractors.id,
      name: subcontractors.name,
      trade: subcontractors.trade,
    })
    .from(subcontractors)
    .where(tenantWhere(subcontractors, input.tenantId, isNull(subcontractors.deletedAt)))
    .limit(500);

  if (subs.length === 0) return [];

  const subIds = subs.map(s => s.id);

  const paidRows = await db
    .select({
      subcontractorId: projectCostActuals.subcontractorId,
      projectId: projectCostActuals.projectId,
      amountCents: projectCostActuals.amountCents,
      estimatedAmountCents: projectCostActuals.estimatedAmountCents,
    })
    .from(projectCostActuals)
    .where(
      and(
        inArray(projectCostActuals.subcontractorId, subIds),
        inArray(projectCostActuals.status, ["committed", "paid"]),
        isNull(projectCostActuals.deletedAt),
      ),
    )
    .limit(20000);

  const taskRows = await db
    .select({
      subcontractorId: fieldTasks.subcontractorId,
      status: fieldTasks.status,
      plannedEndDate: fieldTasks.plannedEndDate,
      actualEndDate: fieldTasks.actualEndDate,
    })
    .from(fieldTasks)
    .where(
      and(inArray(fieldTasks.subcontractorId, subIds), isNull(fieldTasks.deletedAt)),
    )
    .limit(20000);

  const perfBySub = new Map<string, SubcontractorPerformanceRow>();
  for (const s of subs) {
    perfBySub.set(s.id, {
      subcontractorId: s.id,
      name: s.name ?? "Unnamed",
      trade: s.trade ?? null,
      projectCount: 0,
      totalPaidCents: 0,
      onTimeTaskCount: 0,
      totalTaskCount: 0,
      costDeviations: [],
    });
  }

  const projectsBySub = new Map<string, Set<string>>();
  const deviationsBySub = new Map<string, number[]>();

  for (const row of paidRows) {
    if (!row.subcontractorId) continue;
    const perf = perfBySub.get(row.subcontractorId);
    if (!perf) continue;

    perf.totalPaidCents += Math.round(Number(row.amountCents ?? 0));

    if (row.projectId) {
      const set = projectsBySub.get(row.subcontractorId) ?? new Set<string>();
      set.add(row.projectId);
      projectsBySub.set(row.subcontractorId, set);
    }

    const estimated = Math.round(Number(row.estimatedAmountCents ?? 0));
    if (estimated > 0) {
      const actual = Math.round(Number(row.amountCents ?? 0));
      const dev = ((actual - estimated) / estimated) * 100;
      const list = deviationsBySub.get(row.subcontractorId) ?? [];
      list.push(dev);
      deviationsBySub.set(row.subcontractorId, list);
    }
  }

  for (const task of taskRows) {
    if (!task.subcontractorId) continue;
    const perf = perfBySub.get(task.subcontractorId);
    if (!perf) continue;

    const isDone = task.status === "completed" || task.status === "verified";
    if (!isDone) continue;

    perf.totalTaskCount += 1;

    const planned = task.plannedEndDate ? Date.parse(String(task.plannedEndDate)) : NaN;
    const actual = task.actualEndDate ? Date.parse(String(task.actualEndDate)) : NaN;
    if (Number.isFinite(planned) && Number.isFinite(actual) && actual <= planned) {
      perf.onTimeTaskCount += 1;
    }
  }

  const rows: SubcontractorPerformanceRow[] = Array.from(perfBySub.values()).map(perf => ({
    ...perf,
    projectCount: projectsBySub.get(perf.subcontractorId)?.size ?? 0,
    costDeviations: deviationsBySub.get(perf.subcontractorId) ?? [],
  }));

  return rankSubcontractors(rows.filter(r => r.totalPaidCents > 0 || r.totalTaskCount > 0));
}

// ══════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════

/**
 * Assemble independent components in one response, not a single global snapshot.
 * The exact pipeline owns its one complete read snapshot; other factual components retain their contracts.
 *
 * Sequential rather than parallel on purpose: several of these run per-project queries, and a
 * fan-out of five concurrent aggregations against the same connection pool is how a dashboard
 * starves the estimating path that is actually earning money.
 */
export async function getDashboard(input: {
  tenantId: string;
  now?: Date;
  monthCount?: number;
}): Promise<ExactDashboardResult> {
  const now = input.now ?? new Date();

  const pipeline = await getPipeline({ tenantId: input.tenantId, now });
  const forecast = await getRevenueForecast({
    tenantId: input.tenantId,
    monthCount: input.monthCount,
    now,
  });
  const profitHealth = await getProfitHealth({ tenantId: input.tenantId });
  const fieldProgress = await getFieldProgressAnalytics({ tenantId: input.tenantId, now });
  const subcontractors = await getSubcontractorLeaderboard({ tenantId: input.tenantId });
  const calibration = await getCalibrationSummary(input.tenantId);
  const adjustments = await getAdjustmentSummary(input.tenantId);

  return buildExactDashboard({
    generatedAt: now.toISOString(),
    pipeline,
    forecast,
    profitHealth,
    fieldProgress,
    subcontractors,
    openCalibrationCount: calibration.actionableCount,
    pendingAdjustmentCount: adjustments.pendingApprovalCount,
  });
}

// ══════════════════════════════════════════════════════════════════════
// SNAPSHOTS
// ══════════════════════════════════════════════════════════════════════

export interface SaveSnapshotInput {
  tenantId: string;
  snapshotType: string;
  period?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  payload: unknown;
  actorId?: string | null;
}

/** A held write is rejected before calculation/persistence; this is not an admitted attempt. */
export function assertAnalyticsSnapshotWritable(snapshotType: string): void {
  if (snapshotType === "pipeline" || snapshotType === "revenue_forecast") {
    throw new AnalyticsError(ANALYTICS_SNAPSHOT_HOLD_CODE, "New pipeline and forecast snapshots are temporarily unavailable.");
  }
}

/**
 * Freeze an aggregation so a closed period keeps reporting what it closed with.
 * Keyed by `(tenant, snapshot_key)` so re-freezing the same period overwrites rather than
 * accumulating two versions of the same month.
 */
export async function saveSnapshot(
  input: SaveSnapshotInput,
): Promise<AnalyticsSnapshot | null> {
  assertAnalyticsSnapshotWritable(input.snapshotType);
  const db = await getDb();
  if (!db) return null;

  const period = input.period ?? "month";
  const snapshotKey = `${input.snapshotType}:${period}:${input.periodStart ?? "-"}:${input.periodEnd ?? "-"}`;
  const now = new Date();

  const values = {
    tenantId: input.tenantId,
    snapshotType: input.snapshotType,
    period,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    snapshotKey,
    payload: input.payload as never,
    generatedBy: input.actorId ?? null,
    generatedAt: now,
    updatedAt: now,
  };

  const [existing] = await db
    .select({ id: analyticsSnapshots.id })
    .from(analyticsSnapshots)
    .where(
      and(
        eq(analyticsSnapshots.tenantId, input.tenantId),
        eq(analyticsSnapshots.snapshotKey, snapshotKey),
      ),
    )
    .limit(1);

  let snapshot: AnalyticsSnapshot | null;
  if (existing) {
    const [updated] = await db
      .update(analyticsSnapshots)
      .set(values as never)
      .where(eq(analyticsSnapshots.id, existing.id))
      .returning();
    snapshot = updated ?? null;
  } else {
    const [created] = await db
      .insert(analyticsSnapshots)
      .values(withTenant(values, input.tenantId) as never)
      .returning();
    snapshot = created ?? null;
  }

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId ?? null,
    entityType: "analytics_snapshot",
    entityId: snapshot?.id ?? null,
    entityKey: snapshotKey,
    action: "analytics.snapshot_created",
    before: null,
    after: { snapshotType: input.snapshotType, period, snapshotKey },
  });

  return snapshot;
}

export async function getSnapshot(input: {
  tenantId: string;
  snapshotKey: string;
}): Promise<AnalyticsSnapshot | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(analyticsSnapshots)
    .where(
      tenantWhere(
        analyticsSnapshots,
        input.tenantId,
        eq(analyticsSnapshots.snapshotKey, input.snapshotKey),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function listSnapshots(input: {
  tenantId: string;
  snapshotType?: string;
  limit?: number;
}): Promise<AnalyticsSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions: Array<SQL | undefined> = [];
  if (input.snapshotType) {
    conditions.push(eq(analyticsSnapshots.snapshotType, input.snapshotType));
  }

  return db
    .select()
    .from(analyticsSnapshots)
    .where(tenantWhere(analyticsSnapshots, input.tenantId, ...conditions))
    .orderBy(desc(analyticsSnapshots.generatedAt))
    .limit(Math.min(input.limit ?? 50, 200));
}
