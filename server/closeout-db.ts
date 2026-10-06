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
import { getDb } from "./db";
import { z } from "zod";
import { holdExecutionOperation } from "@shared/execution-authority";
import { EXECUTION_AUTHORITY_NOT_AVAILABLE } from "@shared/domain/taxonomy";
import {
  requireProjectAccess,
  ProjectAccessError,
  type ProjectPermission,
} from "./project-access";
import { assertScopedCalculatedEstimateLineage } from "./historical-estimate-guard";
import type { AuthTransaction } from "./auth-transaction";
import { projectCloseouts, type ProjectCloseout } from "../drizzle/schema";
import { logAudit } from "./audit";
import {
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
import { listFieldTasks } from "./field-operations-db";
import {
  countPendingActuals,
  listUnreviewedVarianceActuals,
} from "./actuals-db";

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

  constructor(
    code: CloseoutErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CloseoutError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// READINESS (CO-001)
// ══════════════════════════════════════════════════════════════════════

/** Evaluate whether closeout may be opened for a project. */
export async function getCloseoutReadiness(
  projectId: string
): Promise<CloseoutReadiness> {
  const { tasks } = await listFieldTasks({ projectId, limit: 1000 });
  const readiness = evaluateCloseoutReadiness({
    taskStatuses: tasks.map(t => ({
      id: t.id,
      status: (normalizeFieldTaskStatus(t.status) ??
        "pending") as FieldTaskStatus,
      taskType: t.taskType,
    })),
    hasApprovedEstimate: false,
  });
  return {
    ...readiness,
    canOpen: false,
    blockers: [
      authorityBlocker(),
      ...readiness.blockers.filter(
        blocker => blocker.code !== "NO_APPROVED_ESTIMATE"
      ),
    ],
  };
}

function authorityBlocker(): CloseoutBlocker {
  return {
    ruleId: "CO-004",
    code: EXECUTION_AUTHORITY_NOT_AVAILABLE,
    message:
      "Execution authorization is not available. Existing closeout facts remain available for review.",
  };
}

async function countOpenTasks(projectId: string): Promise<number> {
  const { tasks } = await listFieldTasks({ projectId, limit: 1000 });
  return tasks.filter(t =>
    isFieldTaskOpen(
      (normalizeFieldTaskStatus(t.status) ?? "pending") as FieldTaskStatus
    )
  ).length;
}

// ══════════════════════════════════════════════════════════════════════
// OPEN
// ══════════════════════════════════════════════════════════════════════

/** Load the closeout of a project, if any. */
export async function getCloseoutByProject(
  projectId: string
): Promise<ProjectCloseout | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(projectCloseouts)
    .where(
      and(
        eq(projectCloseouts.projectId, projectId),
        isNull(projectCloseouts.deletedAt)
      )
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
export async function openCloseout(
  input: OpenCloseoutInput
): Promise<ProjectCloseout> {
  const db = await getDb();
  if (!db) throw new CloseoutError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(
    async tx => {
      await requireProjectAccess(input.projectId, input.userId, "write", {
        mode: "a1",
        transaction: tx,
        expectedTenantId: input.tenantId,
      });
      return holdExecutionOperation("open closeout");
    },
    { isolationLevel: "serializable" }
  );
}

// ══════════════════════════════════════════════════════════════════════
// CHECKLIST (CO-002)
// ══════════════════════════════════════════════════════════════════════

export interface UpdateChecklistInput {
  tenantId: string;
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

const checklistFields = {
  finalInspectionPassed: z.boolean().optional(),
  finalInspectionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  punchListComplete: z.boolean().optional(),
  punchListItemCount: z.number().int().min(0).max(10000).optional(),
  lienWaiversCollected: z.boolean().optional(),
  lienWaiverCount: z.number().int().min(0).max(10000).optional(),
  finalPaymentReceived: z.boolean().optional(),
  finalPaymentCents: z.number().int().min(0).max(2_000_000_000).nullish(),
  finalPaymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  warrantyDocsDelivered: z.boolean().optional(),
  warrantyDocsRef: z.string().max(1000).nullish(),
  warrantyExpiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  clientSatisfactionScore: z.number().int().min(0).max(10).nullish(),
  clientFeedback: z.string().max(5000).nullish(),
  lessonsLearned: z.string().max(10000).nullish(),
  notes: z.string().max(5000).nullish(),
};
const checklistDataSchema = z.object(checklistFields).strict();

async function withCloseoutMutation<T>(
  input: { closeoutId: string; userId: string; tenantId: string },
  permission: ProjectPermission,
  mutate: (tx: AuthTransaction, before: ProjectCloseout) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new CloseoutError("DB_UNAVAILABLE", "Database not available");
  return db.transaction(
    async tx => {
      const [identity] = await tx
        .select()
        .from(projectCloseouts)
        .where(eq(projectCloseouts.id, input.closeoutId))
        .limit(1);
      if (!identity)
        throw new CloseoutError("CLOSEOUT_NOT_FOUND", "Closeout not found");
      await requireProjectAccess(identity.projectId, input.userId, permission, {
        mode: "a1",
        transaction: tx,
        expectedTenantId: input.tenantId,
      });
      const [before] = await tx
        .select()
        .from(projectCloseouts)
        .where(eq(projectCloseouts.id, input.closeoutId))
        .limit(1)
        .for("update");
      if (
        !before ||
        before.deletedAt ||
        before.projectId !== identity.projectId ||
        before.tenantId !== input.tenantId
      ) {
        throw new ProjectAccessError(
          "FORBIDDEN",
          "Closeout is unavailable for this project."
        );
      }
      await assertScopedCalculatedEstimateLineage(
        tx,
        before.budgetEstimateDraftId,
        {
          projectId: before.projectId,
          tenantId: input.tenantId,
          action: "mutate closeout",
          invalid: message => {
            throw new ProjectAccessError("FORBIDDEN", message);
          },
        }
      );
      return mutate(tx, before);
    },
    { isolationLevel: "serializable" }
  );
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
 * Records facts without asserting readiness or advancing execution.
 */
export async function updateCloseoutChecklist(
  input: UpdateChecklistInput
): Promise<{ closeout: ProjectCloseout; checklist: ChecklistEvaluation }> {
  return withCloseoutMutation(input, "write", async (tx, before) => {
    if (normalizeCloseoutStatus(before.status) === "closed")
      throw new CloseoutError(
        "CLOSEOUT_LOCKED",
        "Closed closeout evidence is immutable."
      );
    const {
      closeoutId: _id,
      userId: _user,
      tenantId: _tenant,
      ...data
    } = input;
    // Reject the entire mixed command, including explicit null, before writing factual notes.
    if (Object.keys(data).some(key => !Object.hasOwn(checklistFields, key)))
      return holdExecutionOperation(
        "change closeout authority through checklist"
      );
    const validated = checklistDataSchema.safeParse(data);
    if (!validated.success)
      throw new CloseoutError(
        "INVALID_CLOSEOUT_TRANSITION",
        "Invalid checklist facts.",
        { issues: validated.error.issues }
      );
    const facts = Object.fromEntries(
      Object.entries(validated.data).filter(([, value]) => value !== undefined)
    );
    const patch = {
      ...facts,
      ...(data.finalInspectionPassed === true
        ? { finalInspectionBy: input.userId }
        : {}),
      updatedBy: input.userId,
      updatedAt: new Date(),
    };
    const merged = { ...before, ...patch } as ProjectCloseout;
    const checklist = evaluateChecklist(checklistStateOf(merged));
    const persisted = {
      ...patch,
      checklistCompletionPct: String(checklist.completionPct),
    };
    await tx
      .update(projectCloseouts)
      .set(persisted)
      .where(eq(projectCloseouts.id, before.id));
    await logAudit(
      {
        userId: input.userId,
        action: "closeout.checklist_updated",
        tableName: "project_closeouts",
        recordId: before.id,
        before,
        after: { ...before, ...persisted },
      },
      tx
    );
    return { closeout: { ...before, ...persisted }, checklist };
  });
}

// ══════════════════════════════════════════════════════════════════════
// TRANSITIONS
// ══════════════════════════════════════════════════════════════════════

export interface TransitionCloseoutInput {
  tenantId: string;
  closeoutId: string;
  userId: string;
  to: CloseoutStatus | string;
}

/** Move a closeout to `in_progress` or `ready_to_close`. Closing uses `closeProject`. */
export async function transitionCloseout(
  input: TransitionCloseoutInput
): Promise<ProjectCloseout> {
  return withCloseoutMutation(
    input,
    input.to === "ready_to_close" ? "approve" : "write",
    async (tx, before) => {
      const allowed = ["closeoutId", "userId", "tenantId", "to"];
      if (
        Object.entries(input).some(
          ([key, value]) => value !== undefined && !allowed.includes(key)
        )
      )
        return holdExecutionOperation(
          "change operational values through closeout reduction"
        );
      const from = normalizeCloseoutStatus(before.status);
      const to = normalizeCloseoutStatus(input.to);
      if (!from || !to)
        throw new CloseoutError(
          "INVALID_CLOSEOUT_TRANSITION",
          "Invalid closeout status."
        );
      // Only existing risk reduction survives: blocking, or withdrawing readiness.
      if (
        to !== "blocked" &&
        !(from === "ready_to_close" && to === "in_progress")
      )
        return holdExecutionOperation(`transition closeout to ${to}`);
      const evaluation = evaluateCloseoutTransition(from, to);
      if (!evaluation.allowed)
        throw new CloseoutError(
          "INVALID_CLOSEOUT_TRANSITION",
          evaluation.blockers[0].message,
          { from, to }
        );
      const patch = {
        status: to,
        updatedBy: input.userId,
        updatedAt: new Date(),
      };
      await tx
        .update(projectCloseouts)
        .set(patch)
        .where(eq(projectCloseouts.id, before.id));
      await logAudit(
        {
          userId: input.userId,
          action: `closeout.${to}`,
          tableName: "project_closeouts",
          recordId: before.id,
          before,
          after: { ...before, ...patch },
        },
        tx
      );
      return { ...before, ...patch };
    }
  );
}

// ══════════════════════════════════════════════════════════════════════
// FINAL VARIANCE REPORT (§8)
// ══════════════════════════════════════════════════════════════════════

/** Build the final variance report of a project without persisting it. */
export async function buildProjectFinalReport(
  _projectId: string,
  _options: { generatedAt?: string } = {}
): Promise<FinalVarianceReport> {
  return holdExecutionOperation("build final closeout report");
}

export interface CloseProjectInput {
  tenantId: string;
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
 * A1 cannot authorize final close or generate a new financial snapshot.
 * Existing saved reports remain readable through the historical report endpoint.
 */
export async function closeProject(
  input: CloseProjectInput
): Promise<CloseProjectResult> {
  return withCloseoutMutation(input, "approve", async () =>
    holdExecutionOperation("close project")
  );
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
export async function getCloseoutStatus(
  projectId: string
): Promise<CloseoutStatusView> {
  const closeout = await getCloseoutByProject(projectId);
  const readiness = await getCloseoutReadiness(projectId);

  if (!closeout) {
    return {
      projectId,
      closeout: null,
      readiness,
      checklist: null,
      pendingActualCount: await countPendingActuals(projectId),
      unreviewedVarianceCount: (await listUnreviewedVarianceActuals(projectId))
        .length,
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
    unreviewedVarianceCostCodes: unreviewed.map(a => a.costCode ?? "UNCODED"),
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
    canClose: false,
    blockers: [authorityBlocker(), ...evaluation.blockers],
  };
}
