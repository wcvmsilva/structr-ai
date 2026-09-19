/**
 * structr.ai — PHASE 3 Closeout Persistence
 *
 * Persists the project closeout of docs/phase3-contract.md §8. Gate logic lives in
 * shared/closeout-engine.ts; this module stores, transitions, snapshots and audits.
 *
 * Invariants enforced here:
 *   CO-001  closeout cannot open while a field task is open
 *   CO-002  `ready_to_close` requires the full mandatory checklist
 *   CO-003  closing requires zero pending actuals and every critical variance reviewed
 *   §8      the final variance report is persisted, never recomputed after closing
 */

import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import {
  projectCloseouts,
  projects,
  type ProjectCloseout,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import {
  buildFinalVarianceReport,
  costCodesRequiringReview,
  evaluateChecklist,
  evaluateCloseoutReadiness,
  evaluateCloseoutTransition,
  evaluateFinalClose,
  type ChecklistEvaluation,
  type CloseoutBlocker,
  type CloseoutChecklistState,
  type CloseoutReadiness,
  type FinalVarianceReport,
} from "@shared/closeout-engine";
import {
  isFieldTaskOpen,
  normalizeCloseoutStatus,
  normalizeFieldTaskStatus,
  type CloseoutStatus,
  type FieldTaskStatus,
} from "@shared/domain/phase3-taxonomy";
import { toCents } from "@shared/actuals-variance-engine";
import { getProjectBudgetEstimate, listFieldTasks } from "./field-operations-db";
import {
  countPendingActuals,
  getVarianceSnapshot,
  listUnreviewedVarianceActuals,
} from "./actuals-db";
import { withTenant } from "./tenant-scope";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type CloseoutErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "CLOSEOUT_NOT_FOUND"
  | "CLOSEOUT_ALREADY_EXISTS"
  | "CLOSEOUT_BLOCKED_OPEN_TASKS"
  | "CLOSEOUT_CHECKLIST_INCOMPLETE"
  | "CLOSEOUT_PENDING_ACTUALS"
  | "CLOSEOUT_VARIANCE_UNREVIEWED"
  | "INVALID_CLOSEOUT_TRANSITION"
  | "CLOSEOUT_LOCKED"
  | "NO_APPROVED_ESTIMATE";

export class CloseoutError extends Error {
  public readonly code: CloseoutErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: CloseoutErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CloseoutError";
    this.code = code;
    this.details = details;
  }
}

function firstBlockerCode(blockers: CloseoutBlocker[]): CloseoutErrorCode {
  const code = blockers[0]?.code;
  switch (code) {
    case "CLOSEOUT_BLOCKED_OPEN_TASKS":
      return "CLOSEOUT_BLOCKED_OPEN_TASKS";
    case "CLOSEOUT_CHECKLIST_INCOMPLETE":
      return "CLOSEOUT_CHECKLIST_INCOMPLETE";
    case "CLOSEOUT_PENDING_ACTUALS":
      return "CLOSEOUT_PENDING_ACTUALS";
    case "CLOSEOUT_VARIANCE_UNREVIEWED":
      return "CLOSEOUT_VARIANCE_UNREVIEWED";
    case "NO_APPROVED_ESTIMATE":
      return "NO_APPROVED_ESTIMATE";
    default:
      return "INVALID_CLOSEOUT_TRANSITION";
  }
}

// ══════════════════════════════════════════════════════════════════════
// READINESS (CO-001)
// ══════════════════════════════════════════════════════════════════════

/** Evaluate whether closeout may be opened for a project. */
export async function getCloseoutReadiness(projectId: string): Promise<CloseoutReadiness> {
  const [{ tasks }, budget] = await Promise.all([
    listFieldTasks({ projectId, limit: 1000 }),
    getProjectBudgetEstimate(projectId),
  ]);

  return evaluateCloseoutReadiness({
    taskStatuses: tasks.map((t) => ({
      id: t.id,
      status: (normalizeFieldTaskStatus(t.status) ?? "pending") as FieldTaskStatus,
      taskType: t.taskType,
    })),
    hasApprovedEstimate: !!budget,
  });
}

async function countOpenTasks(projectId: string): Promise<number> {
  const { tasks } = await listFieldTasks({ projectId, limit: 1000 });
  return tasks.filter((t) =>
    isFieldTaskOpen((normalizeFieldTaskStatus(t.status) ?? "pending") as FieldTaskStatus),
  ).length;
}

// ══════════════════════════════════════════════════════════════════════
// OPEN
// ══════════════════════════════════════════════════════════════════════

/** Load the closeout of a project, if any. */
export async function getCloseoutByProject(
  projectId: string,
): Promise<ProjectCloseout | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(projectCloseouts)
    .where(
      and(eq(projectCloseouts.projectId, projectId), isNull(projectCloseouts.deletedAt)),
    )
    .limit(1);

  return row ?? null;
}

/** Load one closeout by id. */
export async function getCloseout(id: string): Promise<ProjectCloseout | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(projectCloseouts)
    .where(eq(projectCloseouts.id, id))
    .limit(1);

  return row ?? null;
}

export interface OpenCloseoutInput {
  projectId: string;
  userId: string;
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  notes?: string | null;
}

/**
 * Open the closeout of a project.
 *
 * The gate is checked here rather than at closing time on purpose: discovering that six
 * tasks were never verified at the moment the client asks for the final invoice is too late.
 */
export async function openCloseout(input: OpenCloseoutInput): Promise<ProjectCloseout> {
  const db = await getDb();
  if (!db) throw new CloseoutError("DB_UNAVAILABLE", "Database not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new CloseoutError("PROJECT_NOT_FOUND", `Project ${input.projectId} not found`);
  }

  const existing = await getCloseoutByProject(input.projectId);
  if (existing) {
    throw new CloseoutError(
      "CLOSEOUT_ALREADY_EXISTS",
      `Project ${input.projectId} already has a closeout (status "${existing.status}").`,
      { closeoutId: existing.id, status: existing.status },
    );
  }

  const readiness = await getCloseoutReadiness(input.projectId);
  if (!readiness.canOpen) {
    throw new CloseoutError(
      firstBlockerCode(readiness.blockers),
      readiness.blockers.map((b) => `[${b.ruleId}] ${b.message}`).join(" "),
      { blockers: readiness.blockers, readiness },
    );
  }

  const budget = await getProjectBudgetEstimate(input.projectId);
  const id = randomUUID();
  const now = new Date();

  const values = withTenant(
    {
      id,
      projectId: input.projectId,
      budgetEstimateDraftId: budget?.id ?? null,
      status: "open" as CloseoutStatus,
      notes: input.notes ?? null,
      approvedSellPriceCents: toCents(budget?.finalTotalPrice ?? budget?.subtotalPrice ?? 0),
      openedBy: input.userId,
      openedAt: now,
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    },
    input.tenantId,
  );

  await db.insert(projectCloseouts).values(values as never);

  await logAudit({
    userId: input.userId,
    action: "closeout.opened",
    tableName: "project_closeouts",
    recordId: id,
    before: null,
    after: {
      projectId: input.projectId,
      budgetEstimateDraftId: budget?.id ?? null,
      taskCompletionPct: readiness.taskCompletionPct,
      totalTaskCount: readiness.totalTaskCount,
    },
  }).catch(() => undefined);

  const created = await getCloseout(id);
  if (!created) {
    throw new CloseoutError("CLOSEOUT_NOT_FOUND", `Closeout ${id} could not be read back`);
  }
  return created;
}

// ══════════════════════════════════════════════════════════════════════
// CHECKLIST (CO-002)
// ══════════════════════════════════════════════════════════════════════

export interface UpdateChecklistInput {
  closeoutId: string;
  userId: string;
  finalInspectionPassed?: boolean;
  finalInspectionDate?: string | null;
  punchListComplete?: boolean;
  punchListItemCount?: number;
  lienWaiversCollected?: boolean;
  lienWaiverCount?: number;
  finalPaymentReceived?: boolean;
  finalPaymentCents?: number | null;
  finalPaymentDate?: string | null;
  warrantyDocsDelivered?: boolean;
  warrantyDocsRef?: string | null;
  warrantyExpiry?: string | null;
  clientSatisfactionScore?: number | null;
  clientFeedback?: string | null;
  lessonsLearned?: string | null;
  notes?: string | null;
}

function checklistStateOf(row: ProjectCloseout): CloseoutChecklistState {
  return {
    final_inspection_passed: row.finalInspectionPassed,
    punch_list_complete: row.punchListComplete,
    lien_waivers_collected: row.lienWaiversCollected,
    final_payment_received: row.finalPaymentReceived,
    warranty_docs_delivered: row.warrantyDocsDelivered,
    client_satisfaction_score: row.clientSatisfactionScore,
  };
}

/**
 * Update the closeout checklist.
 *
 * Also advances `open → in_progress` on the first checked item, so the operator sees the
 * closeout moving without a separate "start" action.
 */
export async function updateCloseoutChecklist(
  input: UpdateChecklistInput,
): Promise<{ closeout: ProjectCloseout; checklist: ChecklistEvaluation }> {
  const db = await getDb();
  if (!db) throw new CloseoutError("DB_UNAVAILABLE", "Database not available");

  const before = await getCloseout(input.closeoutId);
  if (!before) {
    throw new CloseoutError("CLOSEOUT_NOT_FOUND", `Closeout ${input.closeoutId} not found`);
  }

  if (normalizeCloseoutStatus(before.status) === "closed") {
    throw new CloseoutError(
      "CLOSEOUT_LOCKED",
      `Closeout ${input.closeoutId} is closed and immutable. The final numbers are evidence of what the project actually cost.`,
    );
  }

  const patch: Record<string, unknown> = { updatedBy: input.userId, updatedAt: new Date() };

  if (input.finalInspectionPassed !== undefined) {
    patch.finalInspectionPassed = input.finalInspectionPassed;
    if (input.finalInspectionPassed) patch.finalInspectionBy = input.userId;
  }
  if (input.finalInspectionDate !== undefined) patch.finalInspectionDate = input.finalInspectionDate;
  if (input.punchListComplete !== undefined) patch.punchListComplete = input.punchListComplete;
  if (input.punchListItemCount !== undefined) patch.punchListItemCount = input.punchListItemCount;
  if (input.lienWaiversCollected !== undefined) patch.lienWaiversCollected = input.lienWaiversCollected;
  if (input.lienWaiverCount !== undefined) patch.lienWaiverCount = input.lienWaiverCount;
  if (input.finalPaymentReceived !== undefined) patch.finalPaymentReceived = input.finalPaymentReceived;
  if (input.finalPaymentCents !== undefined) patch.finalPaymentCents = input.finalPaymentCents;
  if (input.finalPaymentDate !== undefined) patch.finalPaymentDate = input.finalPaymentDate;
  if (input.warrantyDocsDelivered !== undefined) {
    patch.warrantyDocsDelivered = input.warrantyDocsDelivered;
  }
  if (input.warrantyDocsRef !== undefined) patch.warrantyDocsRef = input.warrantyDocsRef;
  if (input.warrantyExpiry !== undefined) patch.warrantyExpiry = input.warrantyExpiry;
  if (input.clientSatisfactionScore !== undefined) {
    patch.clientSatisfactionScore = input.clientSatisfactionScore;
  }
  if (input.clientFeedback !== undefined) patch.clientFeedback = input.clientFeedback;
  if (input.lessonsLearned !== undefined) patch.lessonsLearned = input.lessonsLearned;
  if (input.notes !== undefined) patch.notes = input.notes;

  const mergedState: CloseoutChecklistState = {
    ...checklistStateOf(before),
    ...(input.finalInspectionPassed !== undefined
      ? { final_inspection_passed: input.finalInspectionPassed }
      : {}),
    ...(input.punchListComplete !== undefined
      ? { punch_list_complete: input.punchListComplete }
      : {}),
    ...(input.lienWaiversCollected !== undefined
      ? { lien_waivers_collected: input.lienWaiversCollected }
      : {}),
    ...(input.finalPaymentReceived !== undefined
      ? { final_payment_received: input.finalPaymentReceived }
      : {}),
    ...(input.warrantyDocsDelivered !== undefined
      ? { warranty_docs_delivered: input.warrantyDocsDelivered }
      : {}),
    ...(input.clientSatisfactionScore !== undefined
      ? { client_satisfaction_score: input.clientSatisfactionScore }
      : {}),
  };

  const checklist = evaluateChecklist(mergedState);

  // An invalid satisfaction score is rejected; missing items are merely reported.
  const invalidScore = checklist.blockers.find((b) => b.code === "INVALID_SATISFACTION_SCORE");
  if (invalidScore) {
    throw new CloseoutError("INVALID_CLOSEOUT_TRANSITION", invalidScore.message, {
      blockers: [invalidScore],
    });
  }

  patch.checklistCompletionPct = String(checklist.completionPct);

  const currentStatus = normalizeCloseoutStatus(before.status) ?? "open";
  if (currentStatus === "open" && checklist.completedCount > 0) {
    patch.status = "in_progress";
  }

  await db
    .update(projectCloseouts)
    .set(patch as never)
    .where(eq(projectCloseouts.id, input.closeoutId));

  await logAudit({
    userId: input.userId,
    action: "closeout.checklist_updated",
    tableName: "project_closeouts",
    recordId: input.closeoutId,
    before: checklistStateOf(before),
    after: { ...patch, missing: checklist.missing.map((m) => m.key) },
  }).catch(() => undefined);

  const after = await getCloseout(input.closeoutId);
  return { closeout: after ?? before, checklist };
}

// ══════════════════════════════════════════════════════════════════════
// TRANSITIONS
// ══════════════════════════════════════════════════════════════════════

export interface TransitionCloseoutInput {
  closeoutId: string;
  userId: string;
  to: CloseoutStatus | string;
}

/** Move a closeout to `in_progress` or `ready_to_close`. Closing uses `closeProject`. */
export async function transitionCloseout(
  input: TransitionCloseoutInput,
): Promise<ProjectCloseout> {
  const db = await getDb();
  if (!db) throw new CloseoutError("DB_UNAVAILABLE", "Database not available");

  const before = await getCloseout(input.closeoutId);
  if (!before) {
    throw new CloseoutError("CLOSEOUT_NOT_FOUND", `Closeout ${input.closeoutId} not found`);
  }

  const from = (normalizeCloseoutStatus(before.status) ?? "open") as CloseoutStatus;
  const to = normalizeCloseoutStatus(input.to);

  if (!to) {
    throw new CloseoutError(
      "INVALID_CLOSEOUT_TRANSITION",
      `"${input.to}" is not a valid closeout status.`,
    );
  }

  if (to === "closed") {
    throw new CloseoutError(
      "INVALID_CLOSEOUT_TRANSITION",
      "Closing a project goes through closeProject so the final variance report is snapshotted.",
    );
  }

  const evaluation = evaluateCloseoutTransition(from, to);
  if (!evaluation.allowed) {
    throw new CloseoutError(
      "INVALID_CLOSEOUT_TRANSITION",
      evaluation.blockers[0].message,
      { from, to },
    );
  }

  // `ready_to_close` asserts the checklist is complete (CO-002).
  if (to === "ready_to_close") {
    const checklist = evaluateChecklist(checklistStateOf(before));
    if (!checklist.complete) {
      throw new CloseoutError(
        "CLOSEOUT_CHECKLIST_INCOMPLETE",
        checklist.blockers.map((b) => b.message).join(" "),
        { missing: checklist.missing.map((m) => m.key) },
      );
    }
  }

  const now = new Date();
  const patch: Record<string, unknown> = {
    status: to,
    updatedBy: input.userId,
    updatedAt: now,
  };
  if (to === "ready_to_close") patch.readyAt = now;

  await db
    .update(projectCloseouts)
    .set(patch as never)
    .where(eq(projectCloseouts.id, input.closeoutId));

  await logAudit({
    userId: input.userId,
    action: `closeout.${to}`,
    tableName: "project_closeouts",
    recordId: input.closeoutId,
    before: { status: from },
    after: patch,
  }).catch(() => undefined);

  const after = await getCloseout(input.closeoutId);
  return after ?? before;
}

// ══════════════════════════════════════════════════════════════════════
// FINAL VARIANCE REPORT (§8)
// ══════════════════════════════════════════════════════════════════════

/** Build the final variance report of a project without persisting it. */
export async function buildProjectFinalReport(
  projectId: string,
  options: { generatedAt?: string } = {},
): Promise<FinalVarianceReport> {
  const [snapshot, budget] = await Promise.all([
    getVarianceSnapshot(projectId),
    getProjectBudgetEstimate(projectId),
  ]);

  const closeout = await getCloseoutByProject(projectId);
  const approvedSellPriceCents =
    closeout?.approvedSellPriceCents ??
    toCents(budget?.finalTotalPrice ?? budget?.subtotalPrice ?? 0);

  return buildFinalVarianceReport(snapshot, {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    approvedSellPriceCents: approvedSellPriceCents > 0 ? approvedSellPriceCents : null,
  });
}

export interface CloseProjectInput {
  closeoutId: string;
  userId: string;
  lessonsLearned?: string | null;
  generatedAt?: string;
}

export interface CloseProjectResult {
  closeout: ProjectCloseout;
  report: FinalVarianceReport;
}

/**
 * Close the project: verify the closing gate, snapshot the final variance report and lock.
 *
 * The report is persisted (not a view) because a closed job must keep the numbers it was
 * closed with — the price book keeps moving, the history must not.
 */
export async function closeProject(input: CloseProjectInput): Promise<CloseProjectResult> {
  const db = await getDb();
  if (!db) throw new CloseoutError("DB_UNAVAILABLE", "Database not available");

  const before = await getCloseout(input.closeoutId);
  if (!before) {
    throw new CloseoutError("CLOSEOUT_NOT_FOUND", `Closeout ${input.closeoutId} not found`);
  }

  const from = (normalizeCloseoutStatus(before.status) ?? "open") as CloseoutStatus;
  if (from === "closed") {
    throw new CloseoutError(
      "CLOSEOUT_LOCKED",
      `Closeout ${input.closeoutId} is already closed.`,
    );
  }

  const transition = evaluateCloseoutTransition(from, "closed");
  if (!transition.allowed) {
    throw new CloseoutError(
      "INVALID_CLOSEOUT_TRANSITION",
      transition.blockers[0].message,
      { from },
    );
  }

  const projectId = before.projectId;

  const [pendingActualCount, unreviewed, openTaskCount, snapshot] = await Promise.all([
    countPendingActuals(projectId),
    listUnreviewedVarianceActuals(projectId),
    countOpenTasks(projectId),
    getVarianceSnapshot(projectId),
  ]);

  // Two sources of "unreviewed variance": the per-actual review flag and the aggregated
  // per-cost-code snapshot. Both must be clear, because a cost code can breach tolerance
  // through the sum of individually acceptable entries.
  const unreviewedCodes = Array.from(
    new Set([
      ...unreviewed.map((a) => a.costCode ?? "UNCODED"),
      ...costCodesRequiringReview(snapshot).filter((code) =>
        // A snapshot-level breach only blocks when no actual on that code was reviewed.
        !snapshot.byCostCode.find((c) => c.costCode === code && !c.requiresReview),
      ),
    ]),
  );

  const evaluation = evaluateFinalClose({
    checklist: checklistStateOf(before),
    pendingActualCount,
    unreviewedVarianceCostCodes: unreviewedCodes,
    openTaskCount,
  });

  if (!evaluation.canClose) {
    throw new CloseoutError(
      firstBlockerCode(evaluation.blockers),
      evaluation.blockers.map((b) => `[${b.ruleId}] ${b.message}`).join(" "),
      { blockers: evaluation.blockers },
    );
  }

  const report = buildFinalVarianceReport(snapshot, {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    approvedSellPriceCents: before.approvedSellPriceCents,
  });

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(projectCloseouts)
      .set({
        status: "closed",
        baselineEstimatedCents: report.baselineEstimatedCents,
        changeOrderEstimatedCents: report.changeOrderEstimatedCents,
        totalEstimatedCents: report.totalEstimatedCents,
        baselineActualCents: report.baselineActualCents,
        changeOrderActualCents: report.changeOrderActualCents,
        totalActualCents: report.totalActualCents,
        finalVarianceCents: report.varianceCents,
        finalVariancePct: report.variancePct != null ? String(report.variancePct) : null,
        finalVarianceSeverity: report.severity,
        realizedGrossProfitCents: report.realizedGrossProfitCents,
        realizedGrossProfitPct:
          report.realizedGrossProfitPct != null ? String(report.realizedGrossProfitPct) : null,
        varianceReport: report,
        varianceThresholdPct: String(report.thresholdPct),
        checklistCompletionPct: String(evaluation.checklist.completionPct),
        blockers: [],
        lessonsLearned: input.lessonsLearned ?? before.lessonsLearned,
        closedBy: input.userId,
        closedAt: now,
        updatedBy: input.userId,
        updatedAt: now,
      } as never)
      .where(eq(projectCloseouts.id, input.closeoutId));

    await tx
      .update(projects)
      .set({
        status: "closed",
        closedAt: now,
        actualTotal: String((report.totalActualCents / 100).toFixed(2)),
        variancePct: report.variancePct != null ? String(report.variancePct) : null,
        updatedBy: input.userId,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));
  });

  await logAudit({
    userId: input.userId,
    action: "closeout.closed",
    tableName: "project_closeouts",
    recordId: input.closeoutId,
    before: { status: from },
    after: {
      projectId,
      totalEstimatedCents: report.totalEstimatedCents,
      totalActualCents: report.totalActualCents,
      varianceCents: report.varianceCents,
      variancePct: report.variancePct,
      severity: report.severity,
      realizedGrossProfitPct: report.realizedGrossProfitPct,
      summary: report.summary,
    },
  }).catch(() => undefined);

  const after = await getCloseout(input.closeoutId);
  return { closeout: after ?? before, report };
}

// ══════════════════════════════════════════════════════════════════════
// STATUS VIEW
// ══════════════════════════════════════════════════════════════════════

export interface CloseoutStatusView {
  projectId: string;
  closeout: ProjectCloseout | null;
  readiness: CloseoutReadiness;
  checklist: ChecklistEvaluation | null;
  pendingActualCount: number;
  unreviewedVarianceCount: number;
  openTaskCount: number;
  canClose: boolean;
  blockers: CloseoutBlocker[];
}

/**
 * Full closeout status of a project: what exists, what is missing, what blocks closing.
 * This is the single call the closeout screen needs.
 */
export async function getCloseoutStatus(projectId: string): Promise<CloseoutStatusView> {
  const closeout = await getCloseoutByProject(projectId);
  const readiness = await getCloseoutReadiness(projectId);

  if (!closeout) {
    return {
      projectId,
      closeout: null,
      readiness,
      checklist: null,
      pendingActualCount: await countPendingActuals(projectId),
      unreviewedVarianceCount: (await listUnreviewedVarianceActuals(projectId)).length,
      openTaskCount: readiness.openTaskCount,
      canClose: false,
      blockers: readiness.blockers,
    };
  }

  const [pendingActualCount, unreviewed, openTaskCount] = await Promise.all([
    countPendingActuals(projectId),
    listUnreviewedVarianceActuals(projectId),
    countOpenTasks(projectId),
  ]);

  const evaluation = evaluateFinalClose({
    checklist: checklistStateOf(closeout),
    pendingActualCount,
    unreviewedVarianceCostCodes: unreviewed.map((a) => a.costCode ?? "UNCODED"),
    openTaskCount,
  });

  return {
    projectId,
    closeout,
    readiness,
    checklist: evaluation.checklist,
    pendingActualCount,
    unreviewedVarianceCount: unreviewed.length,
    openTaskCount,
    canClose: evaluation.canClose && normalizeCloseoutStatus(closeout.status) !== "closed",
    blockers: evaluation.blockers,
  };
}
