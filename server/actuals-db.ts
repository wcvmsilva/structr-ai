/**
 * structr.ai — PHASE 3 Actuals Persistence
 *
 * Persists the real-cost ledger of docs/phase3-contract.md §4. All arithmetic and judgment
 * live in shared/actuals-variance-engine.ts; this module stores, transitions, aggregates
 * and audits.
 *
 * Invariants enforced here:
 *   AC-001  an actual always points at an approved estimate (or an approved change order)
 *   AC-002  an actual always carries a cost code
 *   AC-003  amounts are non-negative integer cents
 *   AC-004  status flow pending → approved → paid, with rejected/void as exits
 *   §7      change-order cost is tracked separately from the baseline scope
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import {
  costCodes,
  estimateDrafts,
  fieldTasks,
  projectCostActuals,
  projects,
  type EstimateDraft,
  type EstimateDraftLineItem,
  type ProjectCostActual,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import {
  budgetLinesFromEstimateLineItems,
  buildVarianceSnapshot,
  computeProjectBudget,
  computeVariance,
  evaluateActualTransition,
  resolveActualStatus,
  resolveCostCategory,
  toCents,
  validateActual,
  type ActualInput,
  type ActualRecord,
  type BudgetLine,
  type ProjectBudget,
  type ProjectVarianceSnapshot,
} from "@shared/actuals-variance-engine";
import {
  DEFAULT_VARIANCE_THRESHOLD_PCT,
  isActualCommitted,
  type ActualStatus,
} from "@shared/domain/phase3-taxonomy";
import { getProjectBudgetEstimate, listApprovedChangeOrders } from "./field-operations-db";
import { withTenant } from "./tenant-scope";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type ActualsErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "ACTUAL_NOT_FOUND"
  | "NO_APPROVED_ESTIMATE"
  | "COST_CODE_REQUIRED"
  | "INVALID_AMOUNT"
  | "INVALID_ACTUAL_TRANSITION"
  | "ACTUAL_VALIDATION_FAILED"
  | "DUPLICATE_INVOICE"
  | "CHANGE_ORDER_NOT_APPROVED"
  | "TASK_NOT_FOUND";

export class ActualsError extends Error {
  public readonly code: ActualsErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: ActualsErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ActualsError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function todayIso(explicit?: string): string {
  return explicit ?? new Date().toISOString().slice(0, 10);
}

/** Read the project's variance tolerance, falling back to the contract default. */
export async function getProjectVarianceThreshold(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return DEFAULT_VARIANCE_THRESHOLD_PCT;

  const [row] = await db
    .select({ threshold: projects.varianceThresholdPct })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const parsed = row?.threshold != null ? Number(row.threshold) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VARIANCE_THRESHOLD_PCT;
}

/**
 * Find the estimated amount budgeted for a cost code in an approved estimate.
 * Used to snapshot the "planned" side of the actual at the moment it is recorded.
 */
function estimatedCentsForCostCode(
  estimate: EstimateDraft | null,
  costCode: string | null,
): number {
  if (!estimate || !costCode) return 0;

  const lineItems = (estimate.lineItems ?? []) as EstimateDraftLineItem[];
  const lines = budgetLinesFromEstimateLineItems(lineItems, { basis: "cost" });
  const match = lines.find((l) => l.costCode.toLowerCase() === costCode.toLowerCase());
  return match?.estimatedCents ?? 0;
}

// ══════════════════════════════════════════════════════════════════════
// CREATE (AC-001 … AC-003)
// ══════════════════════════════════════════════════════════════════════

export interface RecordActualInput {
  projectId: string;
  userId: string;
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  costCodeId?: string | null;
  costCode?: string | null;
  costCodeName?: string | null;
  category?: string | null;
  description?: string | null;
  /** Real cost. Provide either integer cents or a dollar amount. */
  amountCents?: number | null;
  amount?: number | string | null;
  /** Optional explicit planned amount; resolved from the estimate when omitted. */
  estimatedAmountCents?: number | null;
  quantity?: number | null;
  unit?: string | null;
  laborHours?: number | null;
  vendorName?: string | null;
  subcontractorId?: string | null;
  invoiceRef?: string | null;
  invoiceDate?: string | null;
  dateIncurred?: string | null;
  fieldTaskId?: string | null;
  estimateItemId?: string | null;
  assemblyId?: string | null;
  /** When present, the cost belongs to this approved change order. */
  changeOrderId?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
  status?: string | null;
  today?: string;
}

/**
 * Record a real cost against a project.
 *
 * The budget baseline is resolved server-side (never accepted from the caller) and the
 * variance is snapshotted at insert time, so the ledger keeps what was known when the cost
 * was booked even if the estimate is later superseded.
 */
export async function recordActual(input: RecordActualInput): Promise<ProjectCostActual> {
  const db = await getDb();
  if (!db) throw new ActualsError("DB_UNAVAILABLE", "Database not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new ActualsError("PROJECT_NOT_FOUND", `Project ${input.projectId} not found`, {
      projectId: input.projectId,
    });
  }

  const budget = await getProjectBudgetEstimate(input.projectId);

  // A change order is its own budget authority; validate it explicitly.
  let changeOrder: EstimateDraft | null = null;
  if (input.changeOrderId) {
    const [row] = await db
      .select()
      .from(estimateDrafts)
      .where(eq(estimateDrafts.id, input.changeOrderId))
      .limit(1);

    if (!row || row.status !== "approved" || !row.changeOrderOf) {
      throw new ActualsError(
        "CHANGE_ORDER_NOT_APPROVED",
        `Change order ${input.changeOrderId} is not an approved change order; its cost cannot be tracked yet.`,
        { changeOrderId: input.changeOrderId, status: row?.status ?? null },
      );
    }
    changeOrder = row;
  }

  if (input.fieldTaskId) {
    const [task] = await db
      .select({ id: fieldTasks.id, projectId: fieldTasks.projectId })
      .from(fieldTasks)
      .where(eq(fieldTasks.id, input.fieldTaskId))
      .limit(1);

    if (!task || task.projectId !== input.projectId) {
      throw new ActualsError(
        "TASK_NOT_FOUND",
        `Field task ${input.fieldTaskId} does not belong to project ${input.projectId}.`,
      );
    }
  }

  // Resolve the textual cost code from the catalog when only the id was given: the
  // snapshot must survive a catalog rename.
  let costCode = input.costCode ?? null;
  let costCodeName = input.costCodeName ?? null;
  if (input.costCodeId) {
    const [code] = await db
      .select({ code: costCodes.code, name: costCodes.name })
      .from(costCodes)
      .where(eq(costCodes.id, input.costCodeId))
      .limit(1);
    if (code) {
      costCode = costCode ?? code.code;
      costCodeName = costCodeName ?? code.name;
    }
  }

  const amountCents =
    input.amountCents != null ? Math.round(input.amountCents) : toCents(input.amount ?? 0);

  const dateIncurred = input.dateIncurred ?? todayIso(input.today);
  const budgetSource = changeOrder ?? budget;

  const engineInput: ActualInput = {
    projectId: input.projectId,
    budgetEstimateDraftId: budgetSource?.id ?? null,
    changeOrderId: changeOrder?.id ?? null,
    costCodeId: input.costCodeId ?? null,
    costCode,
    description: input.description ?? null,
    category: input.category ?? null,
    amountCents,
    estimatedAmountCents: input.estimatedAmountCents ?? null,
    dateIncurred,
    vendorName: input.vendorName ?? null,
    subcontractorId: input.subcontractorId ?? null,
    invoiceRef: input.invoiceRef ?? null,
    fieldTaskId: input.fieldTaskId ?? null,
    estimateItemId: input.estimateItemId ?? null,
  };

  const violations = validateActual(engineInput);
  if (violations.length > 0) {
    const first = violations[0];
    const code: ActualsErrorCode =
      first.code === "NO_APPROVED_ESTIMATE"
        ? "NO_APPROVED_ESTIMATE"
        : first.code === "COST_CODE_REQUIRED"
          ? "COST_CODE_REQUIRED"
          : first.code === "INVALID_AMOUNT"
            ? "INVALID_AMOUNT"
            : "ACTUAL_VALIDATION_FAILED";
    throw new ActualsError(
      code,
      `Actual rejected: ${violations.map((v) => `[${v.ruleId}] ${v.message}`).join(" ")}`,
      { violations },
    );
  }

  // Duplicate invoice guard: the same vendor invoice must not be booked twice.
  if (input.invoiceRef && input.vendorName) {
    const dupes = await db
      .select({ id: projectCostActuals.id })
      .from(projectCostActuals)
      .where(
        and(
          eq(projectCostActuals.projectId, input.projectId),
          eq(projectCostActuals.vendorName, input.vendorName),
          eq(projectCostActuals.invoiceRef, input.invoiceRef),
          isNull(projectCostActuals.deletedAt),
        ),
      )
      .limit(1);

    if (dupes.length > 0) {
      throw new ActualsError(
        "DUPLICATE_INVOICE",
        `Invoice "${input.invoiceRef}" from ${input.vendorName} is already recorded on this project.`,
        { existingActualId: dupes[0].id },
      );
    }
  }

  const estimatedAmountCents =
    input.estimatedAmountCents != null
      ? Math.round(input.estimatedAmountCents)
      : estimatedCentsForCostCode(budgetSource, costCode);

  const threshold = await getProjectVarianceThreshold(input.projectId);
  const variance = computeVariance(estimatedAmountCents, amountCents, threshold);

  const id = randomUUID();
  const now = new Date();
  const tenantId = input.tenantId;
  const status = resolveActualStatus(input.status);

  const values = withTenant(
    {
      id,
      projectId: input.projectId,
      budgetEstimateDraftId: budget?.id ?? changeOrder?.id ?? null,
      changeOrderId: changeOrder?.id ?? null,
      fieldTaskId: input.fieldTaskId ?? null,
      estimateItemId: input.estimateItemId ?? null,
      assemblyId: input.assemblyId ?? null,
      costCodeId: input.costCodeId ?? null,
      costCode,
      costCodeName,
      category: resolveCostCategory(input.category),
      description: input.description ?? null,
      amountCents,
      estimatedAmountCents: estimatedAmountCents > 0 ? estimatedAmountCents : null,
      varianceCents: variance.varianceCents,
      variancePct: variance.variancePct != null ? String(variance.variancePct) : null,
      varianceSeverity: variance.severity,
      quantity: input.quantity != null ? String(input.quantity) : null,
      unit: input.unit ?? null,
      laborHours: input.laborHours != null ? String(input.laborHours) : null,
      vendorName: input.vendorName ?? null,
      subcontractorId: input.subcontractorId ?? null,
      invoiceRef: input.invoiceRef ?? null,
      invoiceDate: input.invoiceDate ?? null,
      dateIncurred,
      status,
      receiptUrl: input.receiptUrl ?? null,
      notes: input.notes ?? null,
      recordedBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    },
    tenantId,
  );

  await db.insert(projectCostActuals).values(values as never);

  await logAudit({
    userId: input.userId,
    action: "actual.recorded",
    tableName: "project_cost_actuals",
    recordId: id,
    before: null,
    after: {
      projectId: input.projectId,
      costCode,
      amountCents,
      estimatedAmountCents,
      varianceCents: variance.varianceCents,
      variancePct: variance.variancePct,
      severity: variance.severity,
      changeOrderId: changeOrder?.id ?? null,
      status,
    },
  }).catch(() => undefined);

  // A critical or unbudgeted cost is an operational event, not a row: log it separately so
  // it can be alerted on without scanning the whole ledger.
  if (variance.requiresReview) {
    await logAudit({
      userId: input.userId,
      action:
        variance.severity === "unbudgeted"
          ? "actual.unbudgeted_cost_detected"
          : "actual.high_variance_detected",
      tableName: "project_cost_actuals",
      recordId: id,
      before: null,
      after: {
        projectId: input.projectId,
        costCode,
        estimatedAmountCents,
        amountCents,
        variancePct: variance.variancePct,
        severity: variance.severity,
        thresholdPct: threshold,
      },
    }).catch(() => undefined);
  }

  await refreshProjectCommittedCost(input.projectId, input.userId);

  const created = await getActual(id);
  if (!created) throw new ActualsError("ACTUAL_NOT_FOUND", `Actual ${id} could not be read back`);
  return created;
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Load one actual. */
export async function getActual(id: string): Promise<ProjectCostActual | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(projectCostActuals)
    .where(eq(projectCostActuals.id, id))
    .limit(1);

  return row ?? null;
}

export interface ListActualsOptions {
  projectId: string;
  status?: ActualStatus | ActualStatus[];
  costCode?: string;
  costCodeId?: string;
  subcontractorId?: string;
  fieldTaskId?: string;
  changeOrderId?: string;
  /** When true, only actuals from the original scope (no change order). */
  baselineOnly?: boolean;
  severity?: string;
  limit?: number;
  offset?: number;
}

/** List actuals of a project. */
export async function listActuals(
  opts: ListActualsOptions,
): Promise<{ actuals: ProjectCostActual[]; total: number }> {
  const db = await getDb();
  if (!db) return { actuals: [], total: 0 };

  const conditions = [
    eq(projectCostActuals.projectId, opts.projectId),
    isNull(projectCostActuals.deletedAt),
  ];

  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    if (statuses.length > 0) conditions.push(inArray(projectCostActuals.status, statuses));
  }
  if (opts.costCode) conditions.push(eq(projectCostActuals.costCode, opts.costCode));
  if (opts.costCodeId) conditions.push(eq(projectCostActuals.costCodeId, opts.costCodeId));
  if (opts.subcontractorId) {
    conditions.push(eq(projectCostActuals.subcontractorId, opts.subcontractorId));
  }
  if (opts.fieldTaskId) conditions.push(eq(projectCostActuals.fieldTaskId, opts.fieldTaskId));
  if (opts.changeOrderId) conditions.push(eq(projectCostActuals.changeOrderId, opts.changeOrderId));
  if (opts.baselineOnly) conditions.push(isNull(projectCostActuals.changeOrderId));
  if (opts.severity) conditions.push(eq(projectCostActuals.varianceSeverity, opts.severity));

  const rows = await db
    .select()
    .from(projectCostActuals)
    .where(and(...conditions))
    .orderBy(desc(projectCostActuals.dateIncurred), desc(projectCostActuals.createdAt))
    .limit(opts.limit ?? 500)
    .offset(opts.offset ?? 0);

  return { actuals: rows, total: rows.length };
}

/** Actuals booked against a subcontractor across projects (performance input). */
export async function listActualsForSubcontractor(
  subcontractorId: string,
  limit = 1000,
): Promise<ProjectCostActual[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.subcontractorId, subcontractorId),
        isNull(projectCostActuals.deletedAt),
      ),
    )
    .orderBy(desc(projectCostActuals.dateIncurred))
    .limit(limit);
}

// ══════════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS (AC-004)
// ══════════════════════════════════════════════════════════════════════

export interface TransitionActualInput {
  actualId: string;
  userId: string;
  to: ActualStatus | string;
  reason?: string | null;
}

/** Move an actual through its lifecycle. */
export async function transitionActual(
  input: TransitionActualInput,
): Promise<ProjectCostActual> {
  const db = await getDb();
  if (!db) throw new ActualsError("DB_UNAVAILABLE", "Database not available");

  const before = await getActual(input.actualId);
  if (!before) {
    throw new ActualsError("ACTUAL_NOT_FOUND", `Actual ${input.actualId} not found`);
  }

  const from = resolveActualStatus(before.status);
  const to = resolveActualStatus(input.to);

  const evaluation = evaluateActualTransition(from, to);
  if (!evaluation.allowed) {
    throw new ActualsError("INVALID_ACTUAL_TRANSITION", evaluation.violations[0].message, {
      from,
      to,
      violations: evaluation.violations,
    });
  }

  // Approving cost commits money: the baseline must exist (AC-001 at commit time too).
  if (to === "approved" && !before.budgetEstimateDraftId && !before.changeOrderId) {
    throw new ActualsError(
      "NO_APPROVED_ESTIMATE",
      `Actual ${input.actualId} has no approved estimate baseline and cannot be approved.`,
    );
  }

  const now = new Date();
  const patch: Record<string, unknown> = { status: to, updatedBy: input.userId, updatedAt: now };

  if (to === "approved") {
    patch.approvedBy = input.userId;
    patch.approvedAt = now;
  }
  if (to === "paid") {
    patch.paidBy = input.userId;
    patch.paidAt = now;
  }
  if (to === "rejected") {
    patch.rejectedBy = input.userId;
    patch.rejectedAt = now;
    patch.rejectionReason = input.reason ?? null;
  }
  if (to === "void") {
    patch.voidReason = input.reason ?? null;
  }

  await db
    .update(projectCostActuals)
    .set(patch as never)
    .where(eq(projectCostActuals.id, input.actualId));

  await logAudit({
    userId: input.userId,
    action: `actual.${to}`,
    tableName: "project_cost_actuals",
    recordId: input.actualId,
    before: { status: from, amountCents: before.amountCents },
    after: patch,
  }).catch(() => undefined);

  await refreshProjectCommittedCost(before.projectId, input.userId);

  const after = await getActual(input.actualId);
  return after ?? before;
}

/** Register the human review of a critical/unbudgeted variance (CO-003). */
export async function reviewActualVariance(input: {
  actualId: string;
  userId: string;
  varianceReason: string;
}): Promise<ProjectCostActual> {
  const db = await getDb();
  if (!db) throw new ActualsError("DB_UNAVAILABLE", "Database not available");

  const before = await getActual(input.actualId);
  if (!before) {
    throw new ActualsError("ACTUAL_NOT_FOUND", `Actual ${input.actualId} not found`);
  }

  const now = new Date();
  await db
    .update(projectCostActuals)
    .set({
      varianceReviewed: true,
      varianceReviewedBy: input.userId,
      varianceReviewedAt: now,
      varianceReason: input.varianceReason,
      updatedBy: input.userId,
      updatedAt: now,
    })
    .where(eq(projectCostActuals.id, input.actualId));

  await logAudit({
    userId: input.userId,
    action: "actual.variance_reviewed",
    tableName: "project_cost_actuals",
    recordId: input.actualId,
    before: { varianceReviewed: before.varianceReviewed },
    after: { varianceReviewed: true, varianceReason: input.varianceReason },
  }).catch(() => undefined);

  const after = await getActual(input.actualId);
  return after ?? before;
}

/** Soft delete an actual. Committed cost must be voided, never erased. */
export async function deleteActual(actualId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new ActualsError("DB_UNAVAILABLE", "Database not available");

  const before = await getActual(actualId);
  if (!before) throw new ActualsError("ACTUAL_NOT_FOUND", `Actual ${actualId} not found`);

  const status = resolveActualStatus(before.status);
  if (isActualCommitted(status)) {
    throw new ActualsError(
      "INVALID_ACTUAL_TRANSITION",
      `Actual ${actualId} is ${status}; void it instead of deleting so the cost history stays auditable.`,
      { status },
    );
  }

  const now = new Date();
  await db
    .update(projectCostActuals)
    .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
    .where(eq(projectCostActuals.id, actualId));

  await logAudit({
    userId,
    action: "actual.deleted",
    tableName: "project_cost_actuals",
    recordId: actualId,
    before,
    after: { deletedAt: now },
  }).catch(() => undefined);

  await refreshProjectCommittedCost(before.projectId, userId);
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// BUDGET + VARIANCE AGGREGATION
// ══════════════════════════════════════════════════════════════════════

/** Build the budget lines of a project: approved baseline + approved change orders. */
export async function getProjectBudgetLines(projectId: string): Promise<BudgetLine[]> {
  const baseline = await getProjectBudgetEstimate(projectId);
  const changeOrders = await listApprovedChangeOrders(projectId);

  const lines: BudgetLine[] = [];

  if (baseline) {
    lines.push(
      ...budgetLinesFromEstimateLineItems(
        (baseline.lineItems ?? []) as EstimateDraftLineItem[],
        { basis: "cost", fromChangeOrder: false },
      ),
    );
  }

  for (const co of changeOrders) {
    lines.push(
      ...budgetLinesFromEstimateLineItems(
        (co.lineItems ?? []) as EstimateDraftLineItem[],
        { basis: "cost", fromChangeOrder: true },
      ),
    );
  }

  return lines;
}

function toActualRecord(row: ProjectCostActual): ActualRecord {
  return {
    id: row.id,
    costCodeId: row.costCodeId,
    costCode: row.costCode,
    costCodeName: row.costCodeName,
    category: row.category,
    amountCents: row.amountCents,
    estimatedAmountCents: row.estimatedAmountCents,
    status: resolveActualStatus(row.status),
    changeOrderId: row.changeOrderId,
    subcontractorId: row.subcontractorId,
  };
}

/**
 * Build the variance snapshot of a project.
 *
 * Budget lines come from the approved estimate and approved change orders; the actuals come
 * from the ledger. Nothing is inferred and nothing is recalculated from prices.
 */
export async function getVarianceSnapshot(
  projectId: string,
): Promise<ProjectVarianceSnapshot> {
  const [budgetLines, { actuals }, threshold] = await Promise.all([
    getProjectBudgetLines(projectId),
    listActuals({ projectId, limit: 2000 }),
    getProjectVarianceThreshold(projectId),
  ]);

  return buildVarianceSnapshot(budgetLines, actuals.map(toActualRecord), threshold);
}

/** Compute the project's available budget. */
export async function getProjectBudget(projectId: string): Promise<ProjectBudget> {
  const baseline = await getProjectBudgetEstimate(projectId);
  const changeOrders = await listApprovedChangeOrders(projectId);
  const { actuals } = await listActuals({ projectId, limit: 2000 });

  const baselineCents = toCents(baseline?.finalTotalPrice ?? baseline?.subtotalPrice ?? 0);
  const changeOrderCents = changeOrders.reduce(
    (sum, co) => sum + toCents(co.finalTotalPrice ?? co.subtotalPrice ?? 0),
    0,
  );

  return computeProjectBudget(
    baselineCents,
    changeOrderCents,
    actuals.map((a) => ({ amountCents: a.amountCents, status: resolveActualStatus(a.status) })),
  );
}

/** Persist the project's committed cost so dashboards do not need to aggregate on read. */
export async function refreshProjectCommittedCost(
  projectId: string,
  userId?: string,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const { actuals } = await listActuals({ projectId, limit: 2000 });
  const committedCents = actuals
    .filter((a) => isActualCommitted(resolveActualStatus(a.status)))
    .reduce((sum, a) => sum + a.amountCents, 0);

  const snapshotThreshold = await getProjectVarianceThreshold(projectId);
  const budgetLines = await getProjectBudgetLines(projectId);
  const snapshot = buildVarianceSnapshot(budgetLines, actuals.map(toActualRecord), snapshotThreshold);

  const now = new Date();
  await db
    .update(projects)
    .set({
      committedCostCents: committedCents,
      actualTotal: String((committedCents / 100).toFixed(2)),
      variancePct: snapshot.variancePct != null ? String(snapshot.variancePct) : null,
      updatedBy: userId ?? null,
      updatedAt: now,
    })
    .where(eq(projects.id, projectId));

  return committedCents;
}

/** Count of actuals still pending approval — a closeout blocker (CO-003). */
export async function countPendingActuals(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.projectId, projectId),
        eq(projectCostActuals.status, "pending"),
        isNull(projectCostActuals.deletedAt),
      ),
    );

  return Number(rows[0]?.count ?? 0);
}

/** Committed actuals whose variance requires review and has not been reviewed (CO-003). */
export async function listUnreviewedVarianceActuals(
  projectId: string,
): Promise<ProjectCostActual[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.projectId, projectId),
        eq(projectCostActuals.varianceReviewed, false),
        inArray(projectCostActuals.varianceSeverity, ["critical", "unbudgeted"]),
        isNull(projectCostActuals.deletedAt),
      ),
    )
    .orderBy(asc(projectCostActuals.createdAt));

  return rows.filter((r) => isActualCommitted(resolveActualStatus(r.status)));
}

/** Cost totals grouped by category, for the field cost dashboard. */
export async function getActualsByCategory(
  projectId: string,
): Promise<Array<{ category: string; amountCents: number; count: number }>> {
  const { actuals } = await listActuals({ projectId, limit: 2000 });
  const grouped = new Map<string, { amountCents: number; count: number }>();

  for (const actual of actuals) {
    if (!isActualCommitted(resolveActualStatus(actual.status))) continue;
    const key = actual.category ?? "other";
    const bucket = grouped.get(key) ?? { amountCents: 0, count: 0 };
    bucket.amountCents += actual.amountCents;
    bucket.count += 1;
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amountCents - a.amountCents);
}
