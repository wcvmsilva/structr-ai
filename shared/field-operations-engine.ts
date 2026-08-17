/**
 * structr.ai — PHASE 3 Field Operations Engine
 *
 * PURE engine for the execution gate described in docs/phase3-contract.md §3 and §7.
 * Derived from the dossier (§3.5 — GC Clock capabilities move into the core) and the
 * P1 skill `gchi-field-operations-actuals`.
 *
 * Responsibilities:
 *   1. Field task state machine with executable preconditions (FO-001 … FO-006)
 *   2. Assignment validation (a task without a responsible party is not assigned)
 *   3. Schedule math: planned vs actual dates, lateness, duration
 *   4. Derivation of field tasks from approved change order line items (§7)
 *
 * No DB, no IO, no randomness (timestamps are injected by the caller).
 */

import {
  canTransitionFieldTask,
  FIELD_TASK_CLOSED_STATUSES,
  FIELD_TASK_OPEN_STATUSES,
  isFieldTaskOpen,
  MIN_BLOCK_REASON_LENGTH,
  normalizeAssigneeType,
  normalizeFieldTaskType,
  type FieldAssigneeType,
  type FieldTaskSource,
  type FieldTaskStatus,
  type FieldTaskType,
} from "./domain/phase3-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface FieldTaskAssignment {
  assigneeType: FieldAssigneeType | null;
  /** Subcontractor id when assigneeType is `subcontractor`. */
  subcontractorId?: string | null;
  /** Free-text crew or vendor name when there is no subcontractor row. */
  assigneeName?: string | null;
  /** Internal user responsible for the task. */
  assignedUserId?: string | null;
}

export interface FieldTaskSchedule {
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
}

export interface FieldTaskState extends FieldTaskSchedule {
  id?: string;
  status: FieldTaskStatus;
  taskType: FieldTaskType;
  assignment: FieldTaskAssignment;
  blockReason?: string | null;
}

export type FieldTaskRuleId =
  | "FO-001"
  | "FO-002"
  | "FO-003"
  | "FO-004"
  | "FO-005"
  | "FO-006";

export interface FieldTaskViolation {
  ruleId: FieldTaskRuleId;
  code:
    | "INVALID_TASK_TRANSITION"
    | "INVALID_ASSIGNMENT"
    | "MISSING_ACTUAL_DATE"
    | "VERIFIER_REQUIRED"
    | "BLOCK_REASON_REQUIRED"
    | "TERMINAL_STATE";
  message: string;
}

export interface TransitionRequest {
  to: FieldTaskStatus;
  /** Injected timestamp/date (ISO `YYYY-MM-DD`) used to fill actual dates. */
  today: string;
  assignment?: FieldTaskAssignment;
  blockReason?: string | null;
  /** User verifying a completed task — required for `verified` (FO-004). */
  verifiedBy?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
}

export interface TransitionResult {
  allowed: boolean;
  violations: FieldTaskViolation[];
  /** Patch to apply when `allowed` is true. Empty object when nothing else changes. */
  patch: {
    status: FieldTaskStatus;
    actualStartDate?: string | null;
    actualEndDate?: string | null;
    blockReason?: string | null;
    verifiedAt?: string | null;
    assigneeType?: FieldAssigneeType | null;
    subcontractorId?: string | null;
    assigneeName?: string | null;
    assignedUserId?: string | null;
  };
}

// ══════════════════════════════════════════════════════════════════════
// ASSIGNMENT (FO-002)
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate an assignment payload.
 *
 * A subcontractor assignment requires the subcontractor id: pointing at a company by name
 * is how duplicated vendor records start, and the performance metrics of Phase 3 depend on
 * a stable id. Crew, self-perform and vendor assignments require a name or a user.
 */
export function validateAssignment(assignment: FieldTaskAssignment): FieldTaskViolation[] {
  const violations: FieldTaskViolation[] = [];
  const assigneeType = assignment.assigneeType
    ? normalizeAssigneeType(assignment.assigneeType)
    : null;

  if (!assigneeType) {
    violations.push({
      ruleId: "FO-002",
      code: "INVALID_ASSIGNMENT",
      message:
        "An assignment requires an assignee type (subcontractor, crew, self_perform or vendor).",
    });
    return violations;
  }

  if (assigneeType === "subcontractor") {
    if (!assignment.subcontractorId) {
      violations.push({
        ruleId: "FO-002",
        code: "INVALID_ASSIGNMENT",
        message:
          "A subcontractor assignment requires subcontractorId — performance tracking needs a stable company id, not a typed name.",
      });
    }
    return violations;
  }

  const hasResponsible =
    (assignment.assigneeName != null && String(assignment.assigneeName).trim() !== "") ||
    (assignment.assignedUserId != null && String(assignment.assignedUserId).trim() !== "");

  if (!hasResponsible) {
    violations.push({
      ruleId: "FO-002",
      code: "INVALID_ASSIGNMENT",
      message: `A "${assigneeType}" assignment requires an assignee name or an internal user id.`,
    });
  }

  return violations;
}

/** True when the task already has a valid responsible party. */
export function hasValidAssignment(assignment: FieldTaskAssignment): boolean {
  return validateAssignment(assignment).length === 0;
}

// ══════════════════════════════════════════════════════════════════════
// STATE MACHINE (FO-001 … FO-006)
// ══════════════════════════════════════════════════════════════════════

/**
 * Evaluate a state transition and produce the exact patch to persist.
 *
 * The engine fills the actual dates instead of trusting the caller to remember them:
 * a task that starts without `actual_start_date` makes on-time performance unmeasurable,
 * which is precisely the metric Phase 3 exists to produce.
 */
export function evaluateTransition(
  task: FieldTaskState,
  request: TransitionRequest,
): TransitionResult {
  const violations: FieldTaskViolation[] = [];
  const patch: TransitionResult["patch"] = { status: request.to };

  // Terminal states first: a verified or cancelled task is history, not a workflow.
  if (FIELD_TASK_CLOSED_STATUSES.includes(task.status) && task.status !== "completed") {
    violations.push({
      ruleId: "FO-006",
      code: "TERMINAL_STATE",
      message: `Task is "${task.status}", which is terminal. Create a new task instead of reopening a closed one.`,
    });
    return { allowed: false, violations, patch };
  }

  if (task.status === request.to) {
    violations.push({
      ruleId: "FO-006",
      code: "INVALID_TASK_TRANSITION",
      message: `Task is already "${task.status}".`,
    });
    return { allowed: false, violations, patch };
  }

  if (!canTransitionFieldTask(task.status, request.to)) {
    violations.push({
      ruleId: "FO-006",
      code: "INVALID_TASK_TRANSITION",
      message: `Transition "${task.status}" → "${request.to}" is not allowed by the field task state machine.`,
    });
    return { allowed: false, violations, patch };
  }

  const mergedAssignment: FieldTaskAssignment = {
    assigneeType: request.assignment?.assigneeType ?? task.assignment.assigneeType,
    subcontractorId:
      request.assignment?.subcontractorId ?? task.assignment.subcontractorId ?? null,
    assigneeName: request.assignment?.assigneeName ?? task.assignment.assigneeName ?? null,
    assignedUserId:
      request.assignment?.assignedUserId ?? task.assignment.assignedUserId ?? null,
  };

  switch (request.to) {
    case "assigned": {
      violations.push(...validateAssignment(mergedAssignment));
      break;
    }

    case "in_progress": {
      // Work in progress must have a responsible party: an anonymous task cannot be
      // measured, invoiced or held accountable.
      violations.push(...validateAssignment(mergedAssignment));
      const start = request.actualStartDate ?? task.actualStartDate ?? request.today;
      if (!start) {
        violations.push({
          ruleId: "FO-003",
          code: "MISSING_ACTUAL_DATE",
          message: "Starting a task requires an actual start date.",
        });
      } else {
        patch.actualStartDate = start;
      }
      break;
    }

    case "completed": {
      const start = request.actualStartDate ?? task.actualStartDate ?? request.today;
      const end = request.actualEndDate ?? task.actualEndDate ?? request.today;
      if (!end) {
        violations.push({
          ruleId: "FO-003",
          code: "MISSING_ACTUAL_DATE",
          message: "Completing a task requires an actual end date.",
        });
      } else {
        patch.actualEndDate = end;
        if (!task.actualStartDate) patch.actualStartDate = start;
      }
      break;
    }

    case "verified": {
      if (task.status !== "completed") {
        violations.push({
          ruleId: "FO-004",
          code: "INVALID_TASK_TRANSITION",
          message: "Only a completed task can be verified.",
        });
      }
      if (!request.verifiedBy) {
        violations.push({
          ruleId: "FO-004",
          code: "VERIFIER_REQUIRED",
          message:
            "Verification requires the verifying user — quality acceptance must have a name attached to it.",
        });
      } else {
        patch.verifiedAt = request.today;
      }
      break;
    }

    case "blocked": {
      const reason = request.blockReason ?? null;
      if (!reason || String(reason).trim().length < MIN_BLOCK_REASON_LENGTH) {
        violations.push({
          ruleId: "FO-005",
          code: "BLOCK_REASON_REQUIRED",
          message:
            "Blocking a task requires a reason of at least 5 characters — a blocked task without a cause cannot be unblocked by anyone else.",
        });
      } else {
        patch.blockReason = String(reason).trim();
      }
      break;
    }

    case "pending":
    case "cancelled":
    default:
      break;
  }

  // Leaving `blocked` clears the reason so the record does not carry a stale cause.
  if (task.status === "blocked" && request.to !== "blocked") {
    patch.blockReason = null;
  }

  if (request.assignment) {
    patch.assigneeType = mergedAssignment.assigneeType;
    patch.subcontractorId = mergedAssignment.subcontractorId ?? null;
    patch.assigneeName = mergedAssignment.assigneeName ?? null;
    patch.assignedUserId = mergedAssignment.assignedUserId ?? null;
  }

  return { allowed: violations.length === 0, violations, patch };
}

// ══════════════════════════════════════════════════════════════════════
// SCHEDULE MATH
// ══════════════════════════════════════════════════════════════════════

export interface ScheduleAssessment {
  /** Days between planned and actual end. Positive means late. */
  daysLate: number | null;
  /** True when the task finished on or before the planned end date. */
  onTime: boolean | null;
  /** Actual duration in days (inclusive of the start day). */
  actualDurationDays: number | null;
  /** Planned duration in days (inclusive of the start day). */
  plannedDurationDays: number | null;
  /** True when the task is past its planned end and still open. */
  overdue: boolean;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Assess a task's schedule performance.
 * `today` is injected so the assessment is deterministic and testable.
 */
export function assessSchedule(
  task: Pick<FieldTaskState, "status"> & FieldTaskSchedule,
  today: string,
): ScheduleAssessment {
  const plannedStart = parseDate(task.plannedStartDate);
  const plannedEnd = parseDate(task.plannedEndDate);
  const actualStart = parseDate(task.actualStartDate);
  const actualEnd = parseDate(task.actualEndDate);
  const now = parseDate(today);

  const plannedDurationDays =
    plannedStart && plannedEnd ? diffDays(plannedStart, plannedEnd) + 1 : null;
  const actualDurationDays =
    actualStart && actualEnd ? diffDays(actualStart, actualEnd) + 1 : null;

  let daysLate: number | null = null;
  let onTime: boolean | null = null;
  if (plannedEnd && actualEnd) {
    daysLate = diffDays(plannedEnd, actualEnd);
    onTime = daysLate <= 0;
  }

  const overdue =
    isFieldTaskOpen(task.status) && !!plannedEnd && !!now && diffDays(plannedEnd, now) > 0;

  return { daysLate, onTime, actualDurationDays, plannedDurationDays, overdue };
}

// ══════════════════════════════════════════════════════════════════════
// PROJECT-LEVEL PROGRESS
// ══════════════════════════════════════════════════════════════════════

export interface FieldProgressSummary {
  total: number;
  byStatus: Record<FieldTaskStatus, number>;
  openCount: number;
  closedCount: number;
  verifiedCount: number;
  blockedCount: number;
  /** Percentage of tasks in a closed status, 1 decimal. */
  completionPct: number;
  /** True when no task is open — the closeout gate of CO-001. */
  readyForCloseout: boolean;
  /** Task ids still open, so the UI can name the blockers instead of hiding them. */
  openTaskIds: string[];
}

/** Aggregate task statuses into the progress signal used by closeout and dashboards. */
export function summarizeFieldProgress(
  tasks: Array<Pick<FieldTaskState, "id" | "status">>,
): FieldProgressSummary {
  const byStatus = {
    pending: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    verified: 0,
    blocked: 0,
    cancelled: 0,
  } as Record<FieldTaskStatus, number>;

  const openTaskIds: string[] = [];

  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    if (isFieldTaskOpen(task.status) && task.id) openTaskIds.push(task.id);
  }

  const total = tasks.length;
  const openCount = FIELD_TASK_OPEN_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);
  const closedCount = FIELD_TASK_CLOSED_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);
  const completionPct = total === 0 ? 0 : Math.round((closedCount / total) * 1000) / 10;

  return {
    total,
    byStatus,
    openCount,
    closedCount,
    verifiedCount: byStatus.verified,
    blockedCount: byStatus.blocked,
    completionPct,
    // An empty project is not "ready": there is nothing proving the work happened.
    readyForCloseout: total > 0 && openCount === 0,
    openTaskIds,
  };
}

// ══════════════════════════════════════════════════════════════════════
// CHANGE ORDER → FIELD TASKS (§7)
// ══════════════════════════════════════════════════════════════════════

export interface ChangeOrderLineInput {
  costGroupName?: string | null;
  costItemName?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  costCode?: string | null;
  trade?: string | null;
  taskType?: string | null;
}

export interface DerivedFieldTask {
  /** Stable key used for idempotency: `(change_order_id, task_key)`. */
  taskKey: string;
  taskType: FieldTaskType;
  title: string;
  description: string | null;
  source: FieldTaskSource;
  costCode: string | null;
  quantity: number | null;
  unit: string | null;
}

/** Slugify a label into a stable task key fragment. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Infer the task type of a change order line.
 * Order of confidence: explicit taskType → trade → cost item name → cost group → generic.
 */
export function inferTaskType(line: ChangeOrderLineInput): FieldTaskType {
  const candidates = [line.taskType, line.trade, line.costItemName, line.costGroupName];
  for (const candidate of candidates) {
    const normalized = normalizeFieldTaskType(candidate ?? null);
    if (normalized) return normalized;
  }

  // Second pass: look for a known trade word inside the free text.
  const haystack = `${line.costItemName ?? ""} ${line.costGroupName ?? ""} ${line.description ?? ""}`
    .toLowerCase();
  const wordMatches = haystack.match(/[a-z]+/g) ?? [];
  for (const word of wordMatches) {
    const normalized = normalizeFieldTaskType(word);
    if (normalized) return normalized;
  }

  return "other";
}

/**
 * Derive the field tasks that an approved change order must create.
 *
 * Deduplicated by task key: reprocessing the same approved change order is a normal
 * operational event (retry, replay, second approval read) and must not double the work
 * list. The caller persists only the keys it does not already have.
 */
export function deriveFieldTasksFromChangeOrder(
  changeOrderId: string,
  lines: ChangeOrderLineInput[],
): DerivedFieldTask[] {
  const seen = new Set<string>();
  const derived: DerivedFieldTask[] = [];

  lines.forEach((line, index) => {
    const taskType = inferTaskType(line);
    const label =
      (line.costItemName && String(line.costItemName).trim()) ||
      (line.costGroupName && String(line.costGroupName).trim()) ||
      (line.description && String(line.description).trim()) ||
      `${taskType} work`;

    const base = slugify(`${taskType}_${label}`) || `line_${index + 1}`;
    let taskKey = base;
    let suffix = 2;
    while (seen.has(taskKey)) {
      taskKey = `${base}_${suffix++}`;
    }
    seen.add(taskKey);

    const quantityRaw = line.quantity == null ? null : Number(line.quantity);
    const quantity =
      quantityRaw != null && Number.isFinite(quantityRaw) ? quantityRaw : null;

    derived.push({
      taskKey,
      taskType,
      title: `CO — ${label}`,
      description: line.description ? String(line.description) : null,
      source: "change_order",
      costCode: line.costCode ?? null,
      quantity,
      unit: line.unit ?? null,
    });
  });

  return derived;
}

/** Compose the deterministic idempotency key of a change-order-derived task. */
export function changeOrderTaskKey(changeOrderId: string, taskKey: string): string {
  return `${changeOrderId}:${taskKey}`;
}
