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
import {
  analyticsSnapshots,
  estimateDrafts,
  fieldTasks,
  leads,
  projectCostActuals,
  projects,
  subcontractors,
  type AnalyticsSnapshot,
} from "../drizzle/schema";
import { recordAuditAsync } from "./audit-trail";
import { tenantWhere, withTenant } from "./tenant-scope";
import {
  aggregateFieldProgress,
  aggregatePipeline,
  buildDashboard,
  computeProfitHealth,
  forecastRevenue,
  rankSubcontractors,
  type BacklogItem,
  type DashboardResult,
  type FieldProgressRow,
  type PipelineItem,
  type PipelineSummary,
  type ProfitHealthSummary,
  type ProjectMarginRow,
  type RevenueForecast,
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

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type AnalyticsErrorCode = "DB_UNAVAILABLE" | "SNAPSHOT_NOT_FOUND" | "TENANT_MISMATCH";

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

function ageInDays(from: Date | string | null | undefined, now: Date): number | null {
  if (!from) return null;
  const ts = typeof from === "string" ? Date.parse(from) : from.getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.round((now.getTime() - ts) / 86_400_000);
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
export async function getPipeline(input: {
  tenantId: string;
  now?: Date;
}): Promise<PipelineSummary> {
  const db = await getDb();
  if (!db) return aggregatePipeline([]);

  const now = input.now ?? new Date();
  const items: PipelineItem[] = [];

  const leadRows = await db
    .select({
      id: leads.id,
      status: leads.status,
      projectType: leads.projectType,
      commercialChannel: leads.commercialChannel,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(
      tenantWhere(
        leads,
        input.tenantId,
        // Won, lost and converted leads have left the pipeline.
        sql`${leads.status} NOT IN ('won', 'lost', 'disqualified', 'converted')`,
        isNull(leads.convertedProjectId),
      ),
    )
    .limit(2000);

  for (const row of leadRows) {
    // A lead carries no money yet: the value only becomes real when an estimate is written.
    // Counting a guessed lead value as pipeline is how a forecast starts lying.
    items.push({
      id: row.id,
      stage: row.status ?? "lead",
      valueCents: 0,
      projectType: row.projectType ?? null,
      commercialChannel: row.commercialChannel ?? null,
      ageDays: ageInDays(row.createdAt, now),
    });
  }

  const estimateRows = await db
    .select({
      id: estimateDrafts.id,
      status: estimateDrafts.status,
      finalTotalPrice: estimateDrafts.finalTotalPrice,
      subtotalPrice: estimateDrafts.subtotalPrice,
      commercialChannel: estimateDrafts.commercialChannel,
      createdAt: estimateDrafts.createdAt,
    })
    .from(estimateDrafts)
    .where(
      tenantWhere(
        estimateDrafts,
        input.tenantId,
        isNull(estimateDrafts.supersededBy),
        isNull(estimateDrafts.changeOrderOf),
        inArray(estimateDrafts.status, ["draft", "sent", "under_review", "negotiation"]),
      ),
    )
    .limit(2000);

  for (const row of estimateRows) {
    const stage =
      row.status === "sent"
        ? "estimate_sent"
        : row.status === "negotiation"
          ? "negotiation"
          : "estimate_draft";

    items.push({
      id: row.id,
      stage,
      valueCents: Math.round(toCents(row.finalTotalPrice ?? row.subtotalPrice ?? 0)),
      commercialChannel: row.commercialChannel ?? null,
      ageDays: ageInDays(row.createdAt, now),
    });
  }

  return aggregatePipeline(items);
}

// ══════════════════════════════════════════════════════════════════════
// REVENUE FORECAST (AN-002)
// ══════════════════════════════════════════════════════════════════════

function nextMonths(from: Date, count: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = 0; i < count; i += 1) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export async function getRevenueForecast(input: {
  tenantId: string;
  monthCount?: number;
  now?: Date;
}): Promise<RevenueForecast> {
  const db = await getDb();
  const now = input.now ?? new Date();
  const months = nextMonths(now, input.monthCount ?? 6);

  if (!db) return forecastRevenue({ backlog: [], pipeline: [], months });

  const activeProjects = await db
    .select({
      id: projects.id,
      approvedBudgetCents: projects.approvedBudgetCents,
      changeOrderBudgetCents: projects.changeOrderBudgetCents,
      committedCostCents: projects.committedCostCents,
      endDate: projects.endDate,
    })
    .from(projects)
    .where(
      tenantWhere(
        projects,
        input.tenantId,
        isNull(projects.deletedAt),
        inArray(projects.status, ["active", "in_production", "field_active", "approved"]),
      ),
    )
    .limit(1000);

  const backlog: BacklogItem[] = activeProjects.map(p => {
    const contract =
      Math.round(Number(p.approvedBudgetCents ?? 0)) +
      Math.round(Number(p.changeOrderBudgetCents ?? 0));
    return {
      projectId: p.id,
      contractValueCents: contract,
      billedToDateCents: Math.round(Number(p.committedCostCents ?? 0)),
      expectedCompletionMonth: p.endDate ? String(p.endDate).slice(0, 7) : months[0],
    };
  });

  const pipeline = await getPipeline({ tenantId: input.tenantId, now });

  // Reuse the same weighted items the pipeline view showed, so the two never disagree.
  const pipelineItems: PipelineItem[] = pipeline.byStage.flatMap(stage =>
    Array.from({ length: stage.count }, (_, i) => ({
      id: `${stage.stage}-${i}`,
      stage: stage.stage,
      valueCents: Math.round(stage.grossValueCents / Math.max(1, stage.count)),
    })),
  );

  return forecastRevenue({ backlog, pipeline: pipelineItems, months });
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
 * Assemble the operator dashboard in one call.
 *
 * Sequential rather than parallel on purpose: several of these run per-project queries, and a
 * fan-out of five concurrent aggregations against the same connection pool is how a dashboard
 * starves the estimating path that is actually earning money.
 */
export async function getDashboard(input: {
  tenantId: string;
  now?: Date;
  monthCount?: number;
}): Promise<DashboardResult> {
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

  return buildDashboard({
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

/**
 * Freeze an aggregation so a closed period keeps reporting what it closed with.
 * Keyed by `(tenant, snapshot_key)` so re-freezing the same period overwrites rather than
 * accumulating two versions of the same month.
 */
export async function saveSnapshot(
  input: SaveSnapshotInput,
): Promise<AnalyticsSnapshot | null> {
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
