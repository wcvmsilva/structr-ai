/**
 * structr.ai — PHASE 4 Calibration Persistence
 *
 * Contract: docs/phase4-contract.md §2 (CL-001 … CL-006)
 *
 * Turns a closed project into persisted evidence about the estimating engine. Decision logic
 * lives in `shared/calibration-engine.ts`; this module reads the ledger, writes findings and
 * audits the run.
 *
 * Invariants enforced here:
 *   CL-002  event lifecycle open → acknowledged → actioned, with dismissed/superseded
 *   CL-003  project-scoped events require a projectId; tenant-scoped events forbid it
 *   CL-005  `(tenant_id, finding_key)` is idempotent — recomputing updates, never duplicates
 *   CL-006  an `actioned` event may only be superseded, never reopened
 *
 * The calibration run is deliberately read-only with respect to prices. It writes
 * `calibration_events` and `calibration_reports` and stops there. Nothing in this file touches
 * `cost_codes` or `cost_code_pricing_history`: that requires an approved `price_adjustments`
 * row, which is `price-adjustment-db.ts`.
 */

import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import {
  calibrationEvents,
  calibrationReports,
  costCodes,
  geoZones,
  projectCloseouts,
  projects,
  type CalibrationEvent,
  type CalibrationReport,
} from "../drizzle/schema";
import { recordAuditAsync } from "./audit-trail";
import { tenantWhere, withTenant, assertSameTenant } from "./tenant-scope";
import {
  buildCalibrationReport,
  detectAssemblyDrift,
  detectCostCodeBias,
  detectDurationBias,
  validateGeoFactors,
  type CalibrationFinding,
  type CalibrationReportResult,
  type CostCodeSample,
  type DurationSample,
  type GeoSample,
} from "@shared/calibration-engine";
import {
  canTransitionCalibrationEvent,
  isCalibrationEventTerminal,
  normalizeCalibrationEventStatus,
  normalizeCalibrationEventType,
  type CalibrationEventStatus,
  type CalibrationEventType,
} from "@shared/domain/phase4-taxonomy";
import { getVarianceSnapshot } from "./actuals-db";
import { getCloseoutByProject } from "./closeout-db";
import { getProjectBudgetEstimate, listFieldTasks } from "./field-operations-db";
import { toCents } from "@shared/actuals-variance-engine";
import { getTenantSettings } from "./tenant-settings-db";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type CalibrationErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "EVENT_NOT_FOUND"
  | "REPORT_NOT_FOUND"
  | "PROJECT_NOT_CLOSED"
  | "NO_APPROVED_ESTIMATE"
  | "INVALID_EVENT_TYPE"
  | "INVALID_EVENT_TRANSITION"
  | "EVENT_TERMINAL"
  | "SCOPE_MISMATCH"
  | "TENANT_MISMATCH";

export class CalibrationError extends Error {
  public readonly code: CalibrationErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    code: CalibrationErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CalibrationError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// SAMPLE COLLECTION
// ══════════════════════════════════════════════════════════════════════

export interface ProjectCalibrationSamples {
  projectId: string;
  projectType: string | null;
  commercialChannel: string | null;
  geoRiskClass: string | null;
  closedAt: string | null;
  costCodeSamples: CostCodeSample[];
  durationSamples: DurationSample[];
  geoSamples: GeoSample[];
  totalEstimatedCents: number;
  totalActualCents: number;
  estimatedGrossProfitPct: number | null;
  realizedGrossProfitPct: number | null;
  closeoutId: string | null;
}

function numOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Collect one project's calibration samples from the ledger.
 *
 * The variance snapshot of Phase 3 is the single source: it already reconciles approved budget
 * (baseline + approved change orders) against committed actuals. Recomputing that reconciliation
 * here would let the two diverge, and the closeout report is what the client already saw.
 */
export async function collectProjectSamples(
  projectId: string,
): Promise<ProjectCalibrationSamples> {
  const db = await getDb();
  if (!db) throw new CalibrationError("DB_UNAVAILABLE", "Database not available.");

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new CalibrationError("PROJECT_NOT_FOUND", `Project ${projectId} not found.`, {
      projectId,
    });
  }

  const [snapshot, closeout, { tasks }, budget] = await Promise.all([
    getVarianceSnapshot(projectId),
    getCloseoutByProject(projectId),
    listFieldTasks({ projectId, limit: 1000 }),
    getProjectBudgetEstimate(projectId),
  ]);

  const closedAt = project.closedAt ? new Date(project.closedAt).toISOString() : null;

  // ── Price accuracy: one sample per cost code with a budget ────────
  const costCodeSamples: CostCodeSample[] = [];
  for (const line of snapshot.byCostCode) {
    // A code with no budget is a scope gap, not a pricing error (see calibration-engine).
    if (line.estimatedCents <= 0) continue;
    costCodeSamples.push({
      projectId,
      projectType: project.projectType ?? null,
      costCode: line.costCode,
      costCodeId: line.costCodeId ?? null,
      costCodeName: line.costCodeName ?? null,
      estimatedCents: line.estimatedCents,
      actualCents: line.actualCents,
      closedAt,
    });
  }

  // ── Duration accuracy: planned vs actual per trade ────────────────
  const durationSamples: DurationSample[] = [];
  for (const task of tasks) {
    const plannedStart = task.plannedStartDate ? Date.parse(String(task.plannedStartDate)) : NaN;
    const plannedEnd = task.plannedEndDate ? Date.parse(String(task.plannedEndDate)) : NaN;
    const actualStart = task.actualStartDate ? Date.parse(String(task.actualStartDate)) : NaN;
    const actualEnd = task.actualEndDate ? Date.parse(String(task.actualEndDate)) : NaN;

    if (!Number.isFinite(plannedStart) || !Number.isFinite(plannedEnd)) continue;
    if (!Number.isFinite(actualStart) || !Number.isFinite(actualEnd)) continue;

    const plannedDays = Math.max(0, (plannedEnd - plannedStart) / 86_400_000);
    const actualDays = Math.max(0, (actualEnd - actualStart) / 86_400_000);
    if (plannedDays <= 0) continue;

    durationSamples.push({
      projectId,
      // `taskType` is the closest thing the field schema has to a trade; the duration finding
      // is grouped by it so the operator sees "drywall always takes 3 days longer".
      trade: task.taskType ?? "general",
      plannedDays,
      actualDays,
    });
  }

  // ── Geo factor validation: configured floor vs realized margin ────
  // Realized margin uses the sold price (the approved estimate) against committed cost. Using
  // the internal budget as the denominator would report a margin the company never sold.
  const contractCents = Math.round(
    toCents(budget?.finalTotalPrice ?? budget?.subtotalPrice ?? 0),
  );
  const committedCents = snapshot.totalActualCents;
  const realizedGrossProfitPct =
    contractCents > 0
      ? Math.round(((contractCents - committedCents) / contractCents) * 1000) / 10
      : null;

  const estimatedGrossProfitPct = numOrNull(budget?.grossProfitPct as never);

  const geoSamples: GeoSample[] = [];
  // The floor enforced at approval time, snapshotted on the estimate by Phase 2.
  const configuredFloorPct =
    numOrNull(budget?.profitShieldFloorPct as never) ??
    numOrNull(budget?.profitShieldMinPct as never);

  if (configuredFloorPct != null && realizedGrossProfitPct != null) {
    geoSamples.push({
      projectId,
      geoZoneId: null,
      geoZoneName: null,
      geoRiskClass: project.geoRiskClass ?? null,
      configuredFloorPct,
      realizedGrossProfitPct,
      estimatedGrossProfitPct,
    });
  }

  return {
    projectId,
    projectType: project.projectType ?? null,
    commercialChannel: (project.commercialChannel as string | null) ?? null,
    geoRiskClass: (project.geoRiskClass as string | null) ?? null,
    closedAt,
    costCodeSamples,
    durationSamples,
    geoSamples,
    totalEstimatedCents: snapshot.totalEstimatedCents,
    totalActualCents: snapshot.totalActualCents,
    estimatedGrossProfitPct,
    realizedGrossProfitPct,
    closeoutId: closeout?.id ?? null,
  };
}

// ══════════════════════════════════════════════════════════════════════
// EVENT PERSISTENCE (CL-005)
// ══════════════════════════════════════════════════════════════════════

export interface UpsertFindingInput {
  tenantId: string;
  projectId?: string | null;
  closeoutId?: string | null;
  budgetEstimateDraftId?: string | null;
  finding: CalibrationFinding;
  period?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  projectType?: string | null;
  commercialChannel?: string | null;
  geoRiskClass?: string | null;
  actorId?: string | null;
}

/**
 * Upsert a finding by `(tenant_id, finding_key)`.
 *
 * Recomputation is the normal case — every closeout re-measures the same cost codes with one
 * more data point. Inserting a new row each time would bury the operator in near-duplicates and
 * make "how many open findings do I have" meaningless.
 *
 * An `actioned` event is never overwritten (CL-006): the numbers that justified an approved price
 * change must stay exactly as they were when it was approved. Instead the fresh measurement
 * lands as a new event and the old one is marked superseded.
 */
export async function upsertCalibrationFinding(
  input: UpsertFindingInput,
): Promise<CalibrationEvent> {
  const db = await getDb();
  if (!db) throw new CalibrationError("DB_UNAVAILABLE", "Database not available.");

  const { finding } = input;
  const eventType = normalizeCalibrationEventType(finding.eventType);
  if (!eventType) {
    throw new CalibrationError(
      "INVALID_EVENT_TYPE",
      `Calibration event type "${finding.eventType}" is outside the closed vocabulary.`,
      { eventType: finding.eventType },
    );
  }

  // CL-003: scope determines whether a project is required or forbidden.
  if (finding.scope === "project" && !input.projectId) {
    throw new CalibrationError(
      "SCOPE_MISMATCH",
      "A project-scoped calibration event requires a projectId.",
      { findingKey: finding.findingKey },
    );
  }
  if (finding.scope === "tenant" && input.projectId) {
    throw new CalibrationError(
      "SCOPE_MISMATCH",
      "A tenant-scoped calibration event must not carry a projectId; it aggregates several.",
      { findingKey: finding.findingKey },
    );
  }

  const values = {
    tenantId: input.tenantId,
    projectId: finding.scope === "project" ? (input.projectId ?? null) : null,
    closeoutId: input.closeoutId ?? null,
    budgetEstimateDraftId: input.budgetEstimateDraftId ?? null,
    eventType,
    scope: finding.scope,
    period: input.period ?? (finding.scope === "project" ? "project" : "all_time"),
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    costCodeId: finding.costCodeId ?? null,
    costCode: finding.costCode ?? null,
    assemblyId: finding.assemblyId ?? null,
    trade: finding.trade ?? null,
    geoZoneId: finding.geoZoneId ?? null,
    geoZoneName: finding.geoZoneName ?? null,
    geoRiskClass: finding.geoRiskClass ?? input.geoRiskClass ?? null,
    projectType: finding.projectType ?? input.projectType ?? null,
    commercialChannel: input.commercialChannel ?? null,
    findingKey: finding.findingKey,
    estimatedCents: finding.estimatedCents ?? null,
    actualCents: finding.actualCents ?? null,
    varianceCents: finding.varianceCents ?? null,
    variancePct: finding.variancePct != null ? String(finding.variancePct) : null,
    estimatedDurationDays:
      finding.estimatedDurationDays != null ? String(finding.estimatedDurationDays) : null,
    actualDurationDays:
      finding.actualDurationDays != null ? String(finding.actualDurationDays) : null,
    durationVarianceDays:
      finding.durationVarianceDays != null ? String(finding.durationVarianceDays) : null,
    observedFactor: finding.observedFactor != null ? String(finding.observedFactor) : null,
    suggestedFactor: finding.suggestedFactor != null ? String(finding.suggestedFactor) : null,
    biasDirection: finding.bias.direction,
    meanDeviationPct: String(finding.bias.meanDeviationPct),
    medianDeviationPct: String(finding.bias.medianDeviationPct),
    deviationStdDevPct: String(finding.confidence.dispersionPct),
    sampleCount: finding.confidence.sampleCount,
    overrunCount: finding.bias.overrunCount,
    underrunCount: finding.bias.underrunCount,
    confidenceScore: String(finding.confidence.score),
    confidenceBand: finding.confidence.band,
    suggestedAdjustmentPct: String(finding.suggestion.adjustmentPct),
    recommendation: finding.recommendation,
    rationale: finding.rationale,
    evidence: finding.evidence as never,
    updatedBy: input.actorId ?? null,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select()
    .from(calibrationEvents)
    .where(
      and(
        eq(calibrationEvents.tenantId, input.tenantId),
        eq(calibrationEvents.findingKey, finding.findingKey),
      ),
    )
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(calibrationEvents)
      .values(withTenant({ ...values, createdBy: input.actorId ?? null }, input.tenantId) as never)
      .returning();

    recordAuditAsync({
      tenantId: input.tenantId,
      userId: input.actorId ?? null,
      entityType: "calibration_event",
      entityId: created.id,
      entityKey: finding.findingKey,
      action: "calibration.event_created",
      projectId: created.projectId,
      before: null,
      after: created,
      amountCents: finding.varianceCents ?? null,
    });

    return created;
  }

  // CL-006: an actioned event is immutable evidence. Supersede it instead of rewriting it.
  if (existing.status === "actioned") {
    const [replacement] = await db
      .insert(calibrationEvents)
      .values(
        withTenant(
          {
            ...values,
            findingKey: `${finding.findingKey}@${Date.now()}`,
            createdBy: input.actorId ?? null,
          },
          input.tenantId,
        ) as never,
      )
      .returning();

    await db
      .update(calibrationEvents)
      .set({ status: "superseded", supersededBy: replacement.id, updatedAt: new Date() })
      .where(eq(calibrationEvents.id, existing.id));

    recordAuditAsync({
      tenantId: input.tenantId,
      userId: input.actorId ?? null,
      entityType: "calibration_event",
      entityId: existing.id,
      entityKey: finding.findingKey,
      action: "calibration.event_superseded",
      projectId: existing.projectId,
      before: existing,
      after: replacement,
      reason:
        "Finding recomputed with new evidence; the actioned event is preserved because it justified an approved price change.",
    });

    return replacement;
  }

  const [updated] = await db
    .update(calibrationEvents)
    .set(values as never)
    .where(eq(calibrationEvents.id, existing.id))
    .returning();

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId ?? null,
    entityType: "calibration_event",
    entityId: updated.id,
    entityKey: finding.findingKey,
    action: "calibration.event_updated",
    projectId: updated.projectId,
    before: existing,
    after: updated,
    amountCents: finding.varianceCents ?? null,
  });

  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// CALIBRATION RUN
// ══════════════════════════════════════════════════════════════════════

export interface RunCalibrationInput {
  tenantId: string;
  projectId: string;
  actorId?: string | null;
  /** Skip the "project must be closed" guard. Used by backfills, never by the UI. */
  allowOpenProject?: boolean;
}

export interface RunCalibrationResult {
  report: CalibrationReportResult;
  reportId: string | null;
  eventIds: string[];
  findingCount: number;
  actionableCount: number;
}

/**
 * Run calibration for one closed project.
 *
 * Gated on the project being closed on purpose: mid-flight actuals are incomplete by
 * definition, and calibrating on them would teach the price book that every job underruns.
 */
export async function runProjectCalibration(
  input: RunCalibrationInput,
): Promise<RunCalibrationResult> {
  const db = await getDb();
  if (!db) throw new CalibrationError("DB_UNAVAILABLE", "Database not available.");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new CalibrationError("PROJECT_NOT_FOUND", `Project ${input.projectId} not found.`, {
      projectId: input.projectId,
    });
  }
  if (!assertSameTenant(project.tenantId, input.tenantId)) {
    throw new CalibrationError("TENANT_MISMATCH", "Project belongs to another tenant.", {
      projectId: input.projectId,
    });
  }

  const closeout = await getCloseoutByProject(input.projectId);
  const isClosed = project.status === "closed" || closeout?.status === "closed";
  if (!isClosed && !input.allowOpenProject) {
    throw new CalibrationError(
      "PROJECT_NOT_CLOSED",
      "Calibration runs after closeout. Mid-flight actuals are incomplete and would teach the price book that every job underruns.",
      { projectId: input.projectId, projectStatus: project.status },
    );
  }

  const settings = await getTenantSettings(input.tenantId);
  const tolerancePct = numOrNull(settings?.biasTolerancePct as never) ?? undefined;
  const maxAdjustmentPct = numOrNull(settings?.maxAdjustmentPct as never) ?? undefined;

  const samples = await collectProjectSamples(input.projectId);

  const findings: CalibrationFinding[] = [
    ...detectCostCodeBias(samples.costCodeSamples, {
      tolerancePct,
      maxAdjustmentPct,
      period: "project",
    }),
    ...detectDurationBias(samples.durationSamples, { period: "project" }),
    ...validateGeoFactors(samples.geoSamples, { period: "project" }),
  ];

  const generatedAt = new Date();
  const report = buildCalibrationReport({
    scope: "project",
    period: "project",
    periodStart: null,
    periodEnd: null,
    generatedAt: generatedAt.toISOString(),
    projectCount: 1,
    totalEstimatedCents: samples.totalEstimatedCents,
    totalActualCents: samples.totalActualCents,
    estimatedGrossProfitPct: samples.estimatedGrossProfitPct,
    realizedGrossProfitPct: samples.realizedGrossProfitPct,
    findings,
  });

  const eventIds: string[] = [];
  for (const finding of findings) {
    const event = await upsertCalibrationFinding({
      tenantId: input.tenantId,
      projectId: input.projectId,
      closeoutId: samples.closeoutId,
      finding,
      period: "project",
      projectType: samples.projectType,
      commercialChannel: samples.commercialChannel,
      geoRiskClass: samples.geoRiskClass,
      actorId: input.actorId ?? null,
    });
    eventIds.push(event.id);
  }

  const reportId = await persistCalibrationReport({
    tenantId: input.tenantId,
    projectId: input.projectId,
    closeoutId: closeout?.id ?? null,
    report,
    generatedBy: input.actorId ?? null,
    generatedAt,
    // Project-scoped key so re-running the same project overwrites its own report.
    reportKey: `project:${input.projectId}`,
  });

  // Stamp the project so dashboards can see the learning happened without a join.
  await db
    .update(projects)
    .set({
      calibratedAt: generatedAt,
      realizedGrossProfitPct:
        samples.realizedGrossProfitPct != null ? String(samples.realizedGrossProfitPct) : null,
      updatedAt: generatedAt,
    })
    .where(eq(projects.id, input.projectId));

  // Attribute the evidence to each cost code so the price book shows how well-supported it is.
  await bumpCostCodeSampleCounts(
    input.tenantId,
    findings
      .filter(f => f.eventType === "price_accuracy" && f.costCodeId)
      .map(f => f.costCodeId as string),
  );

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId ?? null,
    entityType: "calibration_report",
    entityId: reportId,
    entityKey: `project:${input.projectId}`,
    action: "calibration.report_generated",
    projectId: input.projectId,
    before: null,
    after: { accuracyScore: report.accuracyScore, eventCount: report.eventCount },
    amountCents: report.totalVarianceCents,
    reason: report.summary,
  });

  return {
    report,
    reportId,
    eventIds,
    findingCount: findings.length,
    actionableCount: report.actionableFindings.length,
  };
}

async function bumpCostCodeSampleCounts(
  tenantId: string,
  costCodeIds: readonly string[],
): Promise<void> {
  if (costCodeIds.length === 0) return;
  const db = await getDb();
  if (!db) return;

  const unique = Array.from(new Set(costCodeIds));
  try {
    await db
      .update(costCodes)
      .set({
        calibrationSampleCount: sql`COALESCE(${costCodes.calibrationSampleCount}, 0) + 1`,
      })
      .where(
        tenantWhere(costCodes, tenantId, inArray(costCodes.id, unique)),
      );
  } catch (error) {
    // Non-fatal: the counter is a UI hint, not an invariant.
    console.error("[Calibration] Failed to bump cost code sample counts:", error);
  }
}

// ══════════════════════════════════════════════════════════════════════
// TENANT-LEVEL CALIBRATION
// ══════════════════════════════════════════════════════════════════════

export interface RunTenantCalibrationInput {
  tenantId: string;
  /** Inclusive ISO dates bounding the closed projects to include. */
  periodStart?: string | null;
  periodEnd?: string | null;
  period?: string;
  actorId?: string | null;
  minProjects?: number;
}

/**
 * Aggregate calibration across every closed project of a tenant in a period.
 *
 * This is where the signal actually lives. A single project produces one deviation per cost
 * code, which is an anecdote; twelve closed projects produce a distribution, which is a price.
 */
export async function runTenantCalibration(
  input: RunTenantCalibrationInput,
): Promise<RunCalibrationResult & { projectCount: number }> {
  const db = await getDb();
  if (!db) throw new CalibrationError("DB_UNAVAILABLE", "Database not available.");

  const conditions: Array<SQL | undefined> = [
    eq(projects.status, "closed"),
    isNull(projects.deletedAt),
  ];
  if (input.periodStart) conditions.push(gte(projects.closedAt, new Date(input.periodStart)));
  if (input.periodEnd) conditions.push(lte(projects.closedAt, new Date(input.periodEnd)));

  const closed = await db
    .select({ id: projects.id })
    .from(projects)
    .where(tenantWhere(projects, input.tenantId, ...conditions))
    .orderBy(desc(projects.closedAt))
    .limit(500);

  const settings = await getTenantSettings(input.tenantId);
  const tolerancePct = numOrNull(settings?.biasTolerancePct as never) ?? undefined;
  const maxAdjustmentPct = numOrNull(settings?.maxAdjustmentPct as never) ?? undefined;

  const allCostCodeSamples: CostCodeSample[] = [];
  const allDurationSamples: DurationSample[] = [];
  const allGeoSamples: GeoSample[] = [];
  let totalEstimatedCents = 0;
  let totalActualCents = 0;
  const realizedMargins: number[] = [];
  const estimatedMargins: number[] = [];

  for (const row of closed) {
    try {
      const samples = await collectProjectSamples(row.id);
      allCostCodeSamples.push(...samples.costCodeSamples);
      allDurationSamples.push(...samples.durationSamples);
      allGeoSamples.push(...samples.geoSamples);
      totalEstimatedCents += samples.totalEstimatedCents;
      totalActualCents += samples.totalActualCents;
      if (samples.realizedGrossProfitPct != null) {
        realizedMargins.push(samples.realizedGrossProfitPct);
      }
      if (samples.estimatedGrossProfitPct != null) {
        estimatedMargins.push(samples.estimatedGrossProfitPct);
      }
    } catch (error) {
      // One unreadable project must not abort the whole period's calibration.
      console.error(`[Calibration] Skipped project ${row.id}:`, error);
    }
  }

  const period = input.period ?? "all_time";

  const findings: CalibrationFinding[] = [
    ...detectCostCodeBias(allCostCodeSamples, {
      tolerancePct,
      maxAdjustmentPct,
      period,
    }),
    ...detectDurationBias(allDurationSamples, { period }),
    ...validateGeoFactors(allGeoSamples, { period }),
  ].map(f => ({ ...f, scope: "tenant" as const }));

  const avg = (values: number[]): number | null =>
    values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

  const generatedAt = new Date();
  const report = buildCalibrationReport({
    scope: "tenant",
    period,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    generatedAt: generatedAt.toISOString(),
    projectCount: closed.length,
    totalEstimatedCents,
    totalActualCents,
    estimatedGrossProfitPct: avg(estimatedMargins),
    realizedGrossProfitPct: avg(realizedMargins),
    findings,
  });

  const eventIds: string[] = [];
  for (const finding of findings) {
    const event = await upsertCalibrationFinding({
      tenantId: input.tenantId,
      projectId: null,
      finding,
      period,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      actorId: input.actorId ?? null,
    });
    eventIds.push(event.id);
  }

  const reportId = await persistCalibrationReport({
    tenantId: input.tenantId,
    projectId: null,
    closeoutId: null,
    report,
    generatedBy: input.actorId ?? null,
    generatedAt,
    reportKey: `tenant:${period}:${input.periodStart ?? "-"}:${input.periodEnd ?? "-"}`,
  });

  await validateGeoZoneFloors(input.tenantId, findings);

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId ?? null,
    entityType: "calibration_report",
    entityId: reportId,
    entityKey: `tenant:${period}`,
    action: "calibration.report_generated",
    before: null,
    after: {
      accuracyScore: report.accuracyScore,
      projectCount: closed.length,
      eventCount: report.eventCount,
    },
    amountCents: report.totalVarianceCents,
    reason: report.summary,
  });

  return {
    report,
    reportId,
    eventIds,
    findingCount: findings.length,
    actionableCount: report.actionableFindings.length,
    projectCount: closed.length,
  };
}

/**
 * Record what a geographic zone actually delivered, next to what it was configured to require.
 *
 * Only the observed value is written — the configured floor is never changed here. Lowering a
 * protective floor because a few jobs went well is how a coastal GC discovers a hurricane-season
 * overrun with no cushion left.
 */
async function validateGeoZoneFloors(
  tenantId: string,
  findings: readonly CalibrationFinding[],
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const geoFindings = findings.filter(
    f => f.eventType === "geo_factor_validation" && f.geoZoneId,
  );

  for (const finding of geoFindings) {
    try {
      await db
        .update(geoZones)
        .set({
          validatedFloorPct:
            finding.suggestedFactor != null ? String(finding.suggestedFactor) : null,
          validatedAt: new Date(),
          validationSampleCount: finding.confidence.sampleCount,
        })
        .where(eq(geoZones.id, finding.geoZoneId as string));
    } catch (error) {
      console.error("[Calibration] Failed to record geo zone validation:", error);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// REPORT PERSISTENCE
// ══════════════════════════════════════════════════════════════════════

async function persistCalibrationReport(input: {
  tenantId: string;
  projectId: string | null;
  closeoutId: string | null;
  report: CalibrationReportResult;
  generatedBy: string | null;
  generatedAt: Date;
  reportKey: string;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const { report } = input;

  const values = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    closeoutId: input.closeoutId,
    scope: report.scope,
    period: report.period,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    reportKey: input.reportKey,
    projectCount: report.projectCount,
    eventCount: report.eventCount,
    totalEstimatedCents: report.totalEstimatedCents,
    totalActualCents: report.totalActualCents,
    totalVarianceCents: report.totalVarianceCents,
    totalVariancePct: report.totalVariancePct != null ? String(report.totalVariancePct) : null,
    meanAbsDeviationPct: String(report.meanAbsDeviationPct),
    accuracyScore: String(report.accuracyScore),
    scopeCompletenessScore:
      report.scopeCompletenessScore != null ? String(report.scopeCompletenessScore) : null,
    durationAccuracyPct:
      report.durationAccuracyPct != null ? String(report.durationAccuracyPct) : null,
    realizedGrossProfitPct:
      report.realizedGrossProfitPct != null ? String(report.realizedGrossProfitPct) : null,
    estimatedGrossProfitPct:
      report.estimatedGrossProfitPct != null ? String(report.estimatedGrossProfitPct) : null,
    biasedCostCodes: report.biasedCostCodes as never,
    assembliesNeedingReview: report.assembliesNeedingReview as never,
    geoFactorFindings: report.geoFactorFindings as never,
    durationFindings: report.durationFindings as never,
    proposedAdjustments: report.actionableFindings as never,
    reportSnapshot: report as never,
    summary: report.summary,
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
    updatedAt: input.generatedAt,
  };

  const [existing] = await db
    .select({ id: calibrationReports.id })
    .from(calibrationReports)
    .where(
      and(
        eq(calibrationReports.tenantId, input.tenantId),
        eq(calibrationReports.reportKey, input.reportKey),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(calibrationReports)
      .set(values as never)
      .where(eq(calibrationReports.id, existing.id))
      .returning({ id: calibrationReports.id });
    return updated?.id ?? existing.id;
  }

  const [created] = await db
    .insert(calibrationReports)
    .values(values as never)
    .returning({ id: calibrationReports.id });

  return created?.id ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// QUERIES
// ══════════════════════════════════════════════════════════════════════

export interface ListCalibrationEventsOptions {
  tenantId?: string | null;
  projectId?: string;
  eventType?: string;
  status?: string;
  confidenceBand?: string;
  costCodeId?: string;
  scope?: "project" | "tenant";
  /** Only findings strong enough to propose a price change. */
  actionableOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listCalibrationEvents(
  options: ListCalibrationEventsOptions = {},
): Promise<{ events: CalibrationEvent[]; total: number }> {
  const db = await getDb();
  if (!db) return { events: [], total: 0 };

  const conditions: Array<SQL | undefined> = [isNull(calibrationEvents.deletedAt)];
  if (options.projectId) conditions.push(eq(calibrationEvents.projectId, options.projectId));
  if (options.eventType) {
    const t = normalizeCalibrationEventType(options.eventType);
    if (t) conditions.push(eq(calibrationEvents.eventType, t));
  }
  if (options.status) {
    const s = normalizeCalibrationEventStatus(options.status);
    if (s) conditions.push(eq(calibrationEvents.status, s));
  }
  if (options.confidenceBand) {
    conditions.push(eq(calibrationEvents.confidenceBand, options.confidenceBand));
  }
  if (options.costCodeId) conditions.push(eq(calibrationEvents.costCodeId, options.costCodeId));
  if (options.scope) conditions.push(eq(calibrationEvents.scope, options.scope));
  if (options.actionableOnly) {
    conditions.push(inArray(calibrationEvents.confidenceBand, ["high", "medium"]));
  }

  const where = tenantWhere(calibrationEvents, options.tenantId, ...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(calibrationEvents)
    .where(where);

  const events = await db
    .select()
    .from(calibrationEvents)
    .where(where)
    .orderBy(desc(calibrationEvents.createdAt))
    .limit(Math.min(options.limit ?? 50, 500))
    .offset(options.offset ?? 0);

  return { events, total: countRow?.count ?? 0 };
}

export async function getCalibrationEvent(
  eventId: string,
): Promise<CalibrationEvent | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(calibrationEvents)
    .where(eq(calibrationEvents.id, eventId))
    .limit(1);

  return row ?? null;
}

export async function getCalibrationReport(
  reportId: string,
): Promise<CalibrationReport | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(calibrationReports)
    .where(eq(calibrationReports.id, reportId))
    .limit(1);

  return row ?? null;
}

export async function listCalibrationReports(options: {
  tenantId?: string | null;
  projectId?: string;
  scope?: "project" | "tenant";
  limit?: number;
}): Promise<CalibrationReport[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions: Array<SQL | undefined> = [isNull(calibrationReports.deletedAt)];
  if (options.projectId) conditions.push(eq(calibrationReports.projectId, options.projectId));
  if (options.scope) conditions.push(eq(calibrationReports.scope, options.scope));

  return db
    .select()
    .from(calibrationReports)
    .where(tenantWhere(calibrationReports, options.tenantId, ...conditions))
    .orderBy(desc(calibrationReports.generatedAt))
    .limit(Math.min(options.limit ?? 25, 200));
}

/** Latest report for a project, which is what the closeout screen shows. */
export async function getLatestProjectReport(
  projectId: string,
): Promise<CalibrationReport | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(calibrationReports)
    .where(
      and(eq(calibrationReports.projectId, projectId), isNull(calibrationReports.deletedAt)),
    )
    .orderBy(desc(calibrationReports.generatedAt))
    .limit(1);

  return row ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// EVENT LIFECYCLE (CL-002, CL-006)
// ══════════════════════════════════════════════════════════════════════

export interface TransitionEventInput {
  eventId: string;
  toStatus: string;
  actorId: string;
  notes?: string | null;
  tenantId?: string | null;
}

/**
 * Move a calibration event through its lifecycle.
 *
 * `acknowledged` means a human read it; `actioned` means it produced an approved price change;
 * `dismissed` means it was judged wrong or irrelevant and requires a reason. Dismissing without
 * a reason is what turns a review queue into noise nobody trusts.
 */
export async function transitionCalibrationEvent(
  input: TransitionEventInput,
): Promise<CalibrationEvent> {
  const db = await getDb();
  if (!db) throw new CalibrationError("DB_UNAVAILABLE", "Database not available.");

  const event = await getCalibrationEvent(input.eventId);
  if (!event) {
    throw new CalibrationError("EVENT_NOT_FOUND", `Calibration event ${input.eventId} not found.`, {
      eventId: input.eventId,
    });
  }
  if (!assertSameTenant(event.tenantId, input.tenantId)) {
    throw new CalibrationError("TENANT_MISMATCH", "Calibration event belongs to another tenant.", {
      eventId: input.eventId,
    });
  }

  const from = (normalizeCalibrationEventStatus(event.status) ?? "open") as CalibrationEventStatus;
  const to = normalizeCalibrationEventStatus(input.toStatus);

  if (!to) {
    throw new CalibrationError(
      "INVALID_EVENT_TRANSITION",
      `Unknown calibration event status "${input.toStatus}".`,
      { toStatus: input.toStatus },
    );
  }

  if (isCalibrationEventTerminal(from) && from !== "actioned") {
    throw new CalibrationError(
      "EVENT_TERMINAL",
      `Calibration event is ${from} and cannot change.`,
      { eventId: input.eventId, from },
    );
  }

  if (!canTransitionCalibrationEvent(from, to)) {
    throw new CalibrationError(
      "INVALID_EVENT_TRANSITION",
      `Illegal calibration event transition ${from} → ${to}.`,
      { from, to },
    );
  }

  if (to === "dismissed" && !input.notes) {
    throw new CalibrationError(
      "INVALID_EVENT_TRANSITION",
      "Dismissing a finding requires a reason, otherwise the review queue stops meaning anything.",
      { eventId: input.eventId },
    );
  }

  const [updated] = await db
    .update(calibrationEvents)
    .set({
      status: to,
      reviewedBy: input.actorId,
      reviewedAt: new Date(),
      reviewNotes: input.notes ?? event.reviewNotes,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(eq(calibrationEvents.id, input.eventId))
    .returning();

  recordAuditAsync({
    tenantId: event.tenantId,
    userId: input.actorId,
    entityType: "calibration_event",
    entityId: updated.id,
    entityKey: event.findingKey,
    action:
      to === "dismissed"
        ? "calibration.event_dismissed"
        : to === "acknowledged"
          ? "calibration.event_acknowledged"
          : "calibration.event_updated",
    projectId: event.projectId,
    before: event,
    after: updated,
    reason: input.notes ?? null,
  });

  return updated;
}

/** Mark an event as having produced an approved adjustment (called by price-adjustment-db). */
export async function markEventActioned(input: {
  eventId: string;
  priceAdjustmentId: string;
  actorId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const event = await getCalibrationEvent(input.eventId);
  if (!event) return;

  await db
    .update(calibrationEvents)
    .set({
      status: "actioned",
      priceAdjustmentId: input.priceAdjustmentId,
      reviewedBy: input.actorId,
      reviewedAt: new Date(),
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(eq(calibrationEvents.id, input.eventId));

  recordAuditAsync({
    tenantId: event.tenantId,
    userId: input.actorId,
    entityType: "calibration_event",
    entityId: input.eventId,
    entityKey: event.findingKey,
    action: "calibration.event_actioned",
    projectId: event.projectId,
    before: event,
    after: { status: "actioned", priceAdjustmentId: input.priceAdjustmentId },
  });
}

// ══════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════

export interface CalibrationSummary {
  openCount: number;
  acknowledgedCount: number;
  actionedCount: number;
  dismissedCount: number;
  actionableCount: number;
  byEventType: Array<{ eventType: string; count: number }>;
  latestReportAt: string | null;
  latestAccuracyScore: number | null;
}

/** Counts for the calibration dashboard card. */
export async function getCalibrationSummary(
  tenantId: string,
): Promise<CalibrationSummary> {
  const db = await getDb();
  if (!db) {
    return {
      openCount: 0,
      acknowledgedCount: 0,
      actionedCount: 0,
      dismissedCount: 0,
      actionableCount: 0,
      byEventType: [],
      latestReportAt: null,
      latestAccuracyScore: null,
    };
  }

  const base = tenantWhere(calibrationEvents, tenantId, isNull(calibrationEvents.deletedAt));

  const byStatus = await db
    .select({ status: calibrationEvents.status, count: sql<number>`COUNT(*)::int` })
    .from(calibrationEvents)
    .where(base)
    .groupBy(calibrationEvents.status);

  const byEventType = await db
    .select({ eventType: calibrationEvents.eventType, count: sql<number>`COUNT(*)::int` })
    .from(calibrationEvents)
    .where(base)
    .groupBy(calibrationEvents.eventType);

  const [actionable] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(calibrationEvents)
    .where(
      tenantWhere(
        calibrationEvents,
        tenantId,
        isNull(calibrationEvents.deletedAt),
        eq(calibrationEvents.status, "open"),
        inArray(calibrationEvents.confidenceBand, ["high", "medium"]),
      ),
    );

  const [latestReport] = await db
    .select({
      generatedAt: calibrationReports.generatedAt,
      accuracyScore: calibrationReports.accuracyScore,
    })
    .from(calibrationReports)
    .where(tenantWhere(calibrationReports, tenantId, isNull(calibrationReports.deletedAt)))
    .orderBy(desc(calibrationReports.generatedAt))
    .limit(1);

  const countFor = (status: string): number =>
    byStatus.find(r => r.status === status)?.count ?? 0;

  return {
    openCount: countFor("open"),
    acknowledgedCount: countFor("acknowledged"),
    actionedCount: countFor("actioned"),
    dismissedCount: countFor("dismissed"),
    actionableCount: actionable?.count ?? 0,
    byEventType: byEventType.map(r => ({ eventType: r.eventType, count: r.count })),
    latestReportAt: latestReport?.generatedAt
      ? new Date(latestReport.generatedAt).toISOString()
      : null,
    latestAccuracyScore: numOrNull(latestReport?.accuracyScore as never),
  };
}

/** Exported for the router's error mapping. */
export function isCalibrationEventType(value: string): value is CalibrationEventType {
  return normalizeCalibrationEventType(value) !== null;
}
