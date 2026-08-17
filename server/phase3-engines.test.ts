/**
 * PHASE 3 — Pure engine tests
 *
 * Covers the decision layer that governs execution and real cost:
 *   1. Taxonomy: task types, state machines, normalizers (FO-001, AC-004, CO-004)
 *   2. Field operations: assignment, transitions, schedule math, progress, change orders
 *   3. Actuals: validation gates, integer-cent money, variance and budget math
 *   4. Subcontractors: compliance, assignment eligibility, derived performance
 *   5. Closeout: opening gate, checklist, closing gate, final variance report
 *
 * These engines are pure by contract, so every case below runs without a database.
 */
import { describe, it, expect } from "vitest";

import {
  ACTUAL_COMMITTED_STATUSES,
  ACTUAL_COST_CATEGORIES,
  ACTUAL_STATUSES,
  CLOSEOUT_CHECKLIST_KEYS,
  CLOSEOUT_CRITICAL_TASK_TYPES,
  CLOSEOUT_STATUSES,
  canTransitionActual,
  canTransitionCloseout,
  canTransitionFieldTask,
  COMPLIANCE_STATES,
  CRITICAL_VARIANCE_MULTIPLIER,
  DEFAULT_COMPLIANCE_WARNING_DAYS,
  DEFAULT_VARIANCE_THRESHOLD_PCT,
  FIELD_ASSIGNEE_TYPES,
  FIELD_TASK_CLOSED_STATUSES,
  FIELD_TASK_OPEN_STATUSES,
  FIELD_TASK_SOURCES,
  FIELD_TASK_STATUSES,
  FIELD_TASK_TYPE_LABELS,
  FIELD_TASK_TYPES,
  isActualCommitted,
  isAssignableSubcontractorStatus,
  isFieldTaskOpen,
  MIN_BLOCK_REASON_LENGTH,
  normalizeActualCostCategory,
  normalizeActualStatus,
  normalizeAssigneeType,
  normalizeCloseoutStatus,
  normalizeFieldTaskStatus,
  normalizeFieldTaskType,
  normalizeSubcontractorStatus,
  normalizeWeatherCondition,
  SUBCONTRACTOR_STATUSES,
  VARIANCE_SEVERITIES,
  WEATHER_CONDITIONS,
  WORK_STOPPING_WEATHER,
  type FieldTaskStatus,
} from "@shared/domain/phase3-taxonomy";

import {
  assessSchedule,
  changeOrderTaskKey,
  deriveFieldTasksFromChangeOrder,
  evaluateTransition,
  hasValidAssignment,
  inferTaskType,
  summarizeFieldProgress,
  validateAssignment,
  type FieldTaskState,
} from "@shared/field-operations-engine";

import {
  budgetLinesFromEstimateLineItems,
  buildVarianceSnapshot,
  computeProjectBudget,
  computeVariance,
  evaluateActualTransition,
  formatCents,
  fromCents,
  resolveActualStatus,
  resolveCostCategory,
  toCents,
  validateActual,
  type ActualInput,
  type ActualRecord,
  type BudgetLine,
} from "@shared/actuals-variance-engine";

import {
  assessCompliance,
  computePerformanceMetrics,
  evaluateAssignmentEligibility,
} from "@shared/subcontractor-performance-engine";

import {
  buildFinalVarianceReport,
  costCodesRequiringReview,
  evaluateChecklist,
  evaluateCloseoutReadiness,
  evaluateCloseoutTransition,
  evaluateFinalClose,
  type CloseoutChecklistState,
} from "@shared/closeout-engine";

// ══════════════════════════════════════════════════════════════════════
// FIXTURES
// ══════════════════════════════════════════════════════════════════════

const TODAY = "2026-03-10";

function task(overrides: Partial<FieldTaskState> = {}): FieldTaskState {
  return {
    id: "task-1",
    status: "pending",
    taskType: "framing",
    assignment: { assigneeType: null },
    ...overrides,
  };
}

const SUB_ASSIGNMENT = { assigneeType: "subcontractor" as const, subcontractorId: "sub-1" };

function actual(overrides: Partial<ActualRecord> = {}): ActualRecord {
  return {
    id: "actual-1",
    costCode: "06-100",
    amountCents: 100_00,
    status: "approved",
    ...overrides,
  };
}

function validActualInput(overrides: Partial<ActualInput> = {}): ActualInput {
  return {
    projectId: "proj-1",
    budgetEstimateDraftId: "est-1",
    costCode: "06-100",
    amountCents: 250_00,
    dateIncurred: TODAY,
    vendorName: "Lowes",
    ...overrides,
  };
}

const COMPLETE_CHECKLIST: CloseoutChecklistState = {
  final_inspection_passed: true,
  punch_list_complete: true,
  lien_waivers_collected: true,
  final_payment_received: true,
  warranty_docs_delivered: true,
  client_satisfaction_score: 9,
};

// ══════════════════════════════════════════════════════════════════════
// 1. TAXONOMY
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 3 taxonomy: closed vocabularies", () => {
  it("T1: the field task vocabulary includes the core trades and the non-trade steps", () => {
    for (const type of [
      "demolition",
      "framing",
      "electrical",
      "plumbing",
      "roofing",
      "siding",
      "painting",
      "trim",
      "cleanup",
      "inspection",
    ]) {
      expect(FIELD_TASK_TYPES).toContain(type);
    }
  });

  it("T2: every task type has a human label", () => {
    for (const type of FIELD_TASK_TYPES) {
      expect(FIELD_TASK_TYPE_LABELS[type]).toBeTruthy();
    }
    expect(FIELD_TASK_TYPE_LABELS.punch_list).toBe("Punch List");
  });

  it("T3: the vocabularies have no duplicates", () => {
    for (const vocab of [
      FIELD_TASK_TYPES,
      FIELD_TASK_STATUSES,
      ACTUAL_STATUSES,
      ACTUAL_COST_CATEGORIES,
      SUBCONTRACTOR_STATUSES,
      CLOSEOUT_STATUSES,
      COMPLIANCE_STATES,
      VARIANCE_SEVERITIES,
      WEATHER_CONDITIONS,
      FIELD_ASSIGNEE_TYPES,
      FIELD_TASK_SOURCES,
    ]) {
      expect(new Set(vocab).size).toBe(vocab.length);
    }
  });

  it("T4: open and closed task statuses partition the status vocabulary", () => {
    const union = new Set<string>([...FIELD_TASK_OPEN_STATUSES, ...FIELD_TASK_CLOSED_STATUSES]);
    expect(union.size).toBe(FIELD_TASK_STATUSES.length);
    for (const status of FIELD_TASK_OPEN_STATUSES) {
      expect(FIELD_TASK_CLOSED_STATUSES).not.toContain(status);
    }
  });

  it("T5: normalizers map field aliases onto the canonical vocabulary", () => {
    expect(normalizeFieldTaskType("demo")).toBe("demolition");
    expect(normalizeFieldTaskType("SHEETROCK")).toBe("drywall");
    expect(normalizeFieldTaskType("hardie")).toBe("siding");
    expect(normalizeFieldTaskStatus("on_hold")).toBe("blocked");
    expect(normalizeFieldTaskStatus("done")).toBe("completed");
    expect(normalizeAssigneeType("sub")).toBe("subcontractor");
    expect(normalizeActualStatus("submitted")).toBe("pending");
    expect(normalizeActualStatus("settled")).toBe("paid");
    expect(normalizeActualCostCategory("labour")).toBe("labor");
    expect(normalizeSubcontractorStatus("archived")).toBe("archived");
    expect(normalizeWeatherCondition("showers")).toBe("rain");
    expect(normalizeWeatherCondition("thunderstorm")).toBe("storm");
    expect(normalizeCloseoutStatus("ready")).toBe("ready_to_close");
  });

  it("T6: an unknown token normalizes to null instead of a silent default", () => {
    expect(normalizeFieldTaskType("teleportation")).toBeNull();
    expect(normalizeFieldTaskStatus("quantum")).toBeNull();
    expect(normalizeActualStatus("maybe")).toBeNull();
  });

  it("T7: the field task state machine only allows the documented flow", () => {
    expect(canTransitionFieldTask("pending", "assigned")).toBe(true);
    expect(canTransitionFieldTask("assigned", "in_progress")).toBe(true);
    expect(canTransitionFieldTask("in_progress", "completed")).toBe(true);
    expect(canTransitionFieldTask("completed", "verified")).toBe(true);
    // Skipping states is what makes progress meaningless.
    expect(canTransitionFieldTask("pending", "completed")).toBe(false);
    expect(canTransitionFieldTask("pending", "verified")).toBe(false);
    // Verified is terminal.
    expect(canTransitionFieldTask("verified", "in_progress")).toBe(false);
    expect(canTransitionFieldTask("cancelled", "pending")).toBe(false);
  });

  it("T8: blocked is reachable from every live status and exits back into the flow", () => {
    for (const from of ["pending", "assigned", "in_progress"] as FieldTaskStatus[]) {
      expect(canTransitionFieldTask(from, "blocked")).toBe(true);
    }
    expect(canTransitionFieldTask("blocked", "assigned")).toBe(true);
    expect(canTransitionFieldTask("blocked", "in_progress")).toBe(true);
  });

  it("T9: the actual state machine commits money in one direction only", () => {
    expect(canTransitionActual("pending", "approved")).toBe(true);
    expect(canTransitionActual("approved", "paid")).toBe(true);
    expect(canTransitionActual("pending", "paid")).toBe(false);
    expect(canTransitionActual("paid", "pending")).toBe(false);
    expect(canTransitionActual("rejected", "approved")).toBe(false);
  });

  it("T10: only approved and paid count as committed cost", () => {
    expect(ACTUAL_COMMITTED_STATUSES).toEqual(["approved", "paid"]);
    expect(isActualCommitted("approved")).toBe(true);
    expect(isActualCommitted("paid")).toBe(true);
    expect(isActualCommitted("pending")).toBe(false);
    expect(isActualCommitted("rejected")).toBe(false);
  });

  it("T11: the closeout state machine ends at closed", () => {
    expect(canTransitionCloseout("open", "in_progress")).toBe(true);
    expect(canTransitionCloseout("in_progress", "ready_to_close")).toBe(true);
    expect(canTransitionCloseout("ready_to_close", "closed")).toBe(true);
    expect(canTransitionCloseout("closed", "open")).toBe(false);
    expect(canTransitionCloseout("open", "closed")).toBe(false);
  });

  it("T12: only active and probation subcontractors are assignable", () => {
    expect(isAssignableSubcontractorStatus("active")).toBe(true);
    expect(isAssignableSubcontractorStatus("probation")).toBe(true);
    expect(isAssignableSubcontractorStatus("suspended")).toBe(false);
    expect(isAssignableSubcontractorStatus("archived")).toBe(false);
  });

  it("T13: operational constants match the documented contract", () => {
    expect(DEFAULT_VARIANCE_THRESHOLD_PCT).toBe(10);
    expect(CRITICAL_VARIANCE_MULTIPLIER).toBe(2);
    expect(DEFAULT_COMPLIANCE_WARNING_DAYS).toBe(30);
    expect(MIN_BLOCK_REASON_LENGTH).toBe(5);
    expect(CLOSEOUT_CHECKLIST_KEYS.length).toBeGreaterThanOrEqual(5);
    expect(CLOSEOUT_CRITICAL_TASK_TYPES).toContain("inspection");
    expect(WORK_STOPPING_WEATHER.length).toBeGreaterThan(0);
  });

  it("T14: isFieldTaskOpen agrees with the open status list", () => {
    for (const status of FIELD_TASK_STATUSES) {
      expect(isFieldTaskOpen(status)).toBe(FIELD_TASK_OPEN_STATUSES.includes(status));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. FIELD OPERATIONS ENGINE
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 3 field operations: assignment (FO-002)", () => {
  it("F1: a subcontractor assignment requires a stable company id, not a typed name", () => {
    const violations = validateAssignment({
      assigneeType: "subcontractor",
      assigneeName: "Joe's Framing",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("INVALID_ASSIGNMENT");
    expect(violations[0].ruleId).toBe("FO-002");
  });

  it("F2: a subcontractor assignment with an id is valid", () => {
    expect(hasValidAssignment(SUB_ASSIGNMENT)).toBe(true);
  });

  it("F3: a crew assignment is valid with a name or an internal user", () => {
    expect(hasValidAssignment({ assigneeType: "crew", assigneeName: "Crew A" })).toBe(true);
    expect(hasValidAssignment({ assigneeType: "crew", assignedUserId: "user-9" })).toBe(true);
    expect(hasValidAssignment({ assigneeType: "crew" })).toBe(false);
  });

  it("F4: an assignment without a type is rejected", () => {
    const violations = validateAssignment({ assigneeType: null });
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/assignee type/i);
  });

  it("F5: assignee aliases are accepted", () => {
    expect(hasValidAssignment({ assigneeType: "sub" as never, subcontractorId: "sub-1" })).toBe(
      true,
    );
    expect(hasValidAssignment({ assigneeType: "in_house" as never, assigneeName: "Crew B" })).toBe(
      true,
    );
  });
});

describe("PHASE 3 field operations: state machine (FO-001 … FO-006)", () => {
  it("F6: pending → assigned requires a valid assignment", () => {
    const withoutAssignee = evaluateTransition(task(), { to: "assigned", today: TODAY });
    expect(withoutAssignee.allowed).toBe(false);
    expect(withoutAssignee.violations[0].code).toBe("INVALID_ASSIGNMENT");

    const withAssignee = evaluateTransition(task(), {
      to: "assigned",
      today: TODAY,
      assignment: SUB_ASSIGNMENT,
    });
    expect(withAssignee.allowed).toBe(true);
    expect(withAssignee.patch.subcontractorId).toBe("sub-1");
  });

  it("F7: starting a task stamps the actual start date automatically", () => {
    const result = evaluateTransition(
      task({ status: "assigned", assignment: SUB_ASSIGNMENT }),
      { to: "in_progress", today: TODAY },
    );
    expect(result.allowed).toBe(true);
    expect(result.patch.actualStartDate).toBe(TODAY);
  });

  it("F8: an explicit actual start date is preserved", () => {
    const result = evaluateTransition(
      task({ status: "assigned", assignment: SUB_ASSIGNMENT }),
      { to: "in_progress", today: TODAY, actualStartDate: "2026-03-02" },
    );
    expect(result.patch.actualStartDate).toBe("2026-03-02");
  });

  it("F9: completing a task stamps the actual end date", () => {
    const result = evaluateTransition(
      task({ status: "in_progress", assignment: SUB_ASSIGNMENT, actualStartDate: "2026-03-02" }),
      { to: "completed", today: TODAY },
    );
    expect(result.allowed).toBe(true);
    expect(result.patch.actualEndDate).toBe(TODAY);
  });

  it("F10: verification requires the verifying user (FO-004)", () => {
    const anonymous = evaluateTransition(
      task({ status: "completed", assignment: SUB_ASSIGNMENT }),
      { to: "verified", today: TODAY },
    );
    expect(anonymous.allowed).toBe(false);
    expect(anonymous.violations[0].code).toBe("VERIFIER_REQUIRED");

    const named = evaluateTransition(
      task({ status: "completed", assignment: SUB_ASSIGNMENT }),
      { to: "verified", today: TODAY, verifiedBy: "user-1" },
    );
    expect(named.allowed).toBe(true);
    expect(named.patch.verifiedAt).toBe(TODAY);
  });

  it("F11: blocking requires a reason of at least the shared minimum length (FO-005)", () => {
    const noReason = evaluateTransition(
      task({ status: "in_progress", assignment: SUB_ASSIGNMENT }),
      { to: "blocked", today: TODAY },
    );
    expect(noReason.allowed).toBe(false);
    expect(noReason.violations[0].code).toBe("BLOCK_REASON_REQUIRED");

    const tooShort = evaluateTransition(
      task({ status: "in_progress", assignment: SUB_ASSIGNMENT }),
      { to: "blocked", today: TODAY, blockReason: "wx" },
    );
    expect(tooShort.allowed).toBe(false);

    const valid = evaluateTransition(
      task({ status: "in_progress", assignment: SUB_ASSIGNMENT }),
      { to: "blocked", today: TODAY, blockReason: "Waiting on window delivery" },
    );
    expect(valid.allowed).toBe(true);
    expect(valid.patch.blockReason).toBe("Waiting on window delivery");
  });

  it("F12: leaving blocked clears the stale block reason", () => {
    const result = evaluateTransition(
      task({
        status: "blocked",
        assignment: SUB_ASSIGNMENT,
        blockReason: "Waiting on window delivery",
      }),
      { to: "in_progress", today: TODAY },
    );
    expect(result.allowed).toBe(true);
    expect(result.patch.blockReason).toBeNull();
  });

  it("F13: skipping states is rejected", () => {
    const result = evaluateTransition(task(), { to: "completed", today: TODAY });
    expect(result.allowed).toBe(false);
    expect(result.violations[0].code).toBe("INVALID_TASK_TRANSITION");
  });

  it("F14: a verified task is terminal (FO-006)", () => {
    const result = evaluateTransition(
      task({ status: "verified", assignment: SUB_ASSIGNMENT }),
      { to: "in_progress", today: TODAY },
    );
    expect(result.allowed).toBe(false);
    expect(result.violations[0].code).toBe("TERMINAL_STATE");
  });

  it("F15: a cancelled task cannot be reopened", () => {
    const result = evaluateTransition(task({ status: "cancelled" }), {
      to: "pending",
      today: TODAY,
    });
    expect(result.allowed).toBe(false);
    expect(result.violations[0].code).toBe("TERMINAL_STATE");
  });

  it("F16: transitioning to the current status is rejected as a no-op", () => {
    const result = evaluateTransition(task({ status: "in_progress" }), {
      to: "in_progress",
      today: TODAY,
    });
    expect(result.allowed).toBe(false);
    expect(result.violations[0].message).toMatch(/already/i);
  });

  it("F17: cancelling an open task is always allowed", () => {
    const result = evaluateTransition(task({ status: "in_progress" }), {
      to: "cancelled",
      today: TODAY,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("PHASE 3 field operations: schedule math", () => {
  it("F18: a task finished before the planned date is on time", () => {
    const assessment = assessSchedule(
      {
        status: "completed",
        plannedStartDate: "2026-03-01",
        plannedEndDate: "2026-03-05",
        actualStartDate: "2026-03-01",
        actualEndDate: "2026-03-04",
      },
      TODAY,
    );
    expect(assessment.onTime).toBe(true);
    expect(assessment.daysLate).toBe(-1);
    expect(assessment.plannedDurationDays).toBe(5);
    expect(assessment.actualDurationDays).toBe(4);
    expect(assessment.overdue).toBe(false);
  });

  it("F19: a task finished after the planned date reports the days late", () => {
    const assessment = assessSchedule(
      {
        status: "verified",
        plannedEndDate: "2026-03-05",
        actualEndDate: "2026-03-09",
      },
      TODAY,
    );
    expect(assessment.onTime).toBe(false);
    expect(assessment.daysLate).toBe(4);
  });

  it("F20: an open task past its planned end date is overdue", () => {
    const assessment = assessSchedule(
      { status: "in_progress", plannedEndDate: "2026-03-05" },
      TODAY,
    );
    expect(assessment.overdue).toBe(true);
    expect(assessment.onTime).toBeNull();
  });

  it("F21: a closed task is never reported as overdue", () => {
    const assessment = assessSchedule(
      { status: "verified", plannedEndDate: "2026-03-05" },
      TODAY,
    );
    expect(assessment.overdue).toBe(false);
  });

  it("F22: missing dates produce nulls instead of invented numbers", () => {
    const assessment = assessSchedule({ status: "pending" }, TODAY);
    expect(assessment.daysLate).toBeNull();
    expect(assessment.onTime).toBeNull();
    expect(assessment.plannedDurationDays).toBeNull();
    expect(assessment.actualDurationDays).toBeNull();
  });
});

describe("PHASE 3 field operations: project progress", () => {
  it("F23: progress counts open and closed tasks and names the blockers", () => {
    const summary = summarizeFieldProgress([
      { id: "t1", status: "verified" },
      { id: "t2", status: "completed" },
      { id: "t3", status: "in_progress" },
      { id: "t4", status: "blocked" },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.closedCount).toBe(2);
    expect(summary.openCount).toBe(2);
    expect(summary.completionPct).toBe(50);
    expect(summary.readyForCloseout).toBe(false);
    expect(summary.openTaskIds).toEqual(["t3", "t4"]);
  });

  it("F24: a project with every task closed is ready for closeout", () => {
    const summary = summarizeFieldProgress([
      { id: "t1", status: "verified" },
      { id: "t2", status: "cancelled" },
    ]);
    expect(summary.readyForCloseout).toBe(true);
    expect(summary.completionPct).toBe(100);
  });

  it("F25: an empty project is not ready for closeout — there is no execution evidence", () => {
    const summary = summarizeFieldProgress([]);
    expect(summary.total).toBe(0);
    expect(summary.readyForCloseout).toBe(false);
    expect(summary.completionPct).toBe(0);
  });
});

describe("PHASE 3 field operations: change order → field tasks (§7)", () => {
  it("F26: the task type is inferred from the most confident signal available", () => {
    expect(inferTaskType({ taskType: "roofing" })).toBe("roofing");
    expect(inferTaskType({ trade: "electrical" })).toBe("electrical");
    expect(inferTaskType({ costItemName: "Hardie siding install" })).toBe("siding");
    expect(inferTaskType({ costGroupName: "Demo" })).toBe("demolition");
    expect(inferTaskType({ description: "Replace rotten framing members" })).toBe("framing");
    expect(inferTaskType({ costItemName: "Miscellaneous allowance" })).toBe("other");
  });

  it("F27: each change order line becomes a field task tagged to the change order", () => {
    const derived = deriveFieldTasksFromChangeOrder("co-1", [
      { costItemName: "Framing repair", quantity: 12, unit: "LF", costCode: "06-100" },
      { costItemName: "Roof shingles", quantity: 20, unit: "SQ", costCode: "07-300" },
    ]);
    expect(derived).toHaveLength(2);
    expect(derived[0].source).toBe("change_order");
    expect(derived[0].taskType).toBe("framing");
    expect(derived[0].title).toBe("CO — Framing repair");
    expect(derived[0].quantity).toBe(12);
    expect(derived[1].taskType).toBe("roofing");
  });

  it("F28: identical lines get distinct keys so nothing is silently dropped", () => {
    const derived = deriveFieldTasksFromChangeOrder("co-1", [
      { costItemName: "Framing repair" },
      { costItemName: "Framing repair" },
      { costItemName: "Framing repair" },
    ]);
    expect(new Set(derived.map((d) => d.taskKey)).size).toBe(3);
  });

  it("F29: derivation is deterministic — replaying the same change order yields the same keys", () => {
    const lines = [{ costItemName: "Trim install" }, { costItemName: "Final clean" }];
    const first = deriveFieldTasksFromChangeOrder("co-9", lines);
    const second = deriveFieldTasksFromChangeOrder("co-9", lines);
    expect(first.map((d) => d.taskKey)).toEqual(second.map((d) => d.taskKey));
  });

  it("F30: the idempotency key namespaces the task under its change order", () => {
    expect(changeOrderTaskKey("co-1", "framing_framing_repair")).toBe(
      "co-1:framing_framing_repair",
    );
  });

  it("F31: a non-numeric quantity becomes null instead of NaN", () => {
    const derived = deriveFieldTasksFromChangeOrder("co-1", [
      { costItemName: "Painting", quantity: "allowance" },
    ]);
    expect(derived[0].quantity).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. ACTUALS AND VARIANCE ENGINE
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 3 actuals: money is integer cents", () => {
  it("A1: dollars convert to cents with correct rounding", () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents("1,234.56")).toBe(123456);
    expect(toCents("$1234.565")).toBe(123457);
    expect(toCents(null)).toBe(0);
    expect(toCents("")).toBe(0);
    expect(toCents("not a number")).toBe(0);
  });

  it("A2: negative values round away from zero symmetrically", () => {
    expect(toCents(-10.005)).toBe(-1001);
    expect(toCents(10.005)).toBe(1001);
  });

  it("A3: cents convert back and format with two decimals", () => {
    expect(fromCents(123456)).toBe(1234.56);
    expect(formatCents(123456)).toBe("1234.56");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-123456)).toBe("-1234.56");
    expect(formatCents(0)).toBe("0.00");
  });

  it("A4: a round trip through cents never loses a penny", () => {
    for (const value of [0.01, 19.99, 1234.56, 987654.32]) {
      expect(fromCents(toCents(value))).toBe(value);
    }
  });
});

describe("PHASE 3 actuals: validation gates (AC-001 … AC-005)", () => {
  it("A5: a complete actual passes validation", () => {
    expect(validateActual(validActualInput())).toEqual([]);
  });

  it("A6: an actual without an approved estimate is rejected (AC-001)", () => {
    const violations = validateActual(validActualInput({ budgetEstimateDraftId: null }));
    expect(violations.map((v) => v.code)).toContain("NO_APPROVED_ESTIMATE");
    expect(violations.find((v) => v.code === "NO_APPROVED_ESTIMATE")?.ruleId).toBe("AC-001");
  });

  it("A7: an uncoded actual is rejected — it would corrupt the price book (AC-002)", () => {
    const violations = validateActual(
      validActualInput({ costCode: null, costCodeId: null }),
    );
    expect(violations.map((v) => v.code)).toContain("COST_CODE_REQUIRED");
  });

  it("A8: a cost code id satisfies the coding requirement", () => {
    const violations = validateActual(
      validActualInput({ costCode: null, costCodeId: "cc-1" }),
    );
    expect(violations.map((v) => v.code)).not.toContain("COST_CODE_REQUIRED");
  });

  it("A9: a whitespace-only cost code does not satisfy the requirement", () => {
    const violations = validateActual(validActualInput({ costCode: "   " }));
    expect(violations.map((v) => v.code)).toContain("COST_CODE_REQUIRED");
  });

  it("A10: a non-integer or negative amount is rejected (AC-003)", () => {
    expect(validateActual(validActualInput({ amountCents: 100.5 })).map((v) => v.code)).toContain(
      "INVALID_AMOUNT",
    );
    const negative = validateActual(validActualInput({ amountCents: -100 }));
    expect(negative.map((v) => v.code)).toContain("INVALID_AMOUNT");
    expect(negative.find((v) => v.code === "INVALID_AMOUNT")?.message).toMatch(/credit or refund/i);
  });

  it("A11: a zero-cost entry is allowed — a no-charge item is still a real event", () => {
    expect(validateActual(validActualInput({ amountCents: 0 }))).toEqual([]);
  });

  it("A12: an actual without the date incurred is rejected", () => {
    expect(
      validateActual(validActualInput({ dateIncurred: null })).map((v) => v.code),
    ).toContain("DATE_REQUIRED");
  });

  it("A13: an actual without a payee is rejected (AC-005)", () => {
    const violations = validateActual(
      validActualInput({ vendorName: null, subcontractorId: null }),
    );
    expect(violations.map((v) => v.code)).toContain("VENDOR_REQUIRED");
  });

  it("A14: a subcontractor id satisfies the payee requirement", () => {
    const violations = validateActual(
      validActualInput({ vendorName: null, subcontractorId: "sub-1" }),
    );
    expect(violations.map((v) => v.code)).not.toContain("VENDOR_REQUIRED");
  });

  it("A15: an empty actual reports every violation at once instead of one at a time", () => {
    const violations = validateActual({
      projectId: "p",
      amountCents: -1,
    } as ActualInput);
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });

  it("A16: transitions follow pending → approved → paid", () => {
    expect(evaluateActualTransition("pending", "approved").allowed).toBe(true);
    expect(evaluateActualTransition("approved", "paid").allowed).toBe(true);
    const skip = evaluateActualTransition("pending", "paid");
    expect(skip.allowed).toBe(false);
    expect(skip.violations[0].ruleId).toBe("AC-004");
    expect(evaluateActualTransition("paid", "paid").allowed).toBe(false);
  });

  it("A17: category and status resolution default safely", () => {
    expect(resolveCostCategory("labor")).toBe("labor");
    expect(resolveCostCategory("nonsense")).toBe("other");
    expect(resolveActualStatus("approved")).toBe("approved");
    expect(resolveActualStatus("nonsense")).toBe("pending");
  });
});

describe("PHASE 3 actuals: variance math (§4)", () => {
  it("A18: cost within tolerance is ok and needs no review", () => {
    const variance = computeVariance(1000_00, 1050_00);
    expect(variance.variancePct).toBe(5);
    expect(variance.severity).toBe("ok");
    expect(variance.requiresReview).toBe(false);
  });

  it("A19: cost above tolerance but below the critical multiplier is a warning", () => {
    const variance = computeVariance(1000_00, 1150_00);
    expect(variance.variancePct).toBe(15);
    expect(variance.severity).toBe("warning");
  });

  it("A20: cost above twice the tolerance is critical and demands review", () => {
    const variance = computeVariance(1000_00, 1300_00);
    expect(variance.variancePct).toBe(30);
    expect(variance.severity).toBe("critical");
    expect(variance.requiresReview).toBe(true);
  });

  it("A21: the tolerance boundary is inclusive on the ok side", () => {
    expect(computeVariance(1000_00, 1100_00).severity).toBe("ok");
    expect(computeVariance(1000_00, 1200_00).severity).toBe("warning");
    // The critical band opens above 2x the tolerance; the percentage is rounded to 1 decimal,
    // so the first genuinely critical cent is the one that rounds past 20.0%.
    expect(computeVariance(1000_00, 1201_00).severity).toBe("critical");
  });

  it("A22: cost far below budget is reported as under_budget, not hidden as ok", () => {
    const variance = computeVariance(1000_00, 800_00);
    expect(variance.variancePct).toBe(-20);
    expect(variance.severity).toBe("under_budget");
  });

  it("A23: real cost with no budget line is unbudgeted, not infinite variance", () => {
    const variance = computeVariance(0, 500_00);
    expect(variance.severity).toBe("unbudgeted");
    expect(variance.variancePct).toBeNull();
    expect(variance.requiresReview).toBe(true);
    expect(variance.varianceCents).toBe(500_00);
  });

  it("A24: no budget and no cost is ok", () => {
    const variance = computeVariance(0, 0);
    expect(variance.severity).toBe("ok");
    expect(variance.requiresReview).toBe(false);
  });

  it("A25: the threshold is configurable per tenant tolerance", () => {
    expect(computeVariance(1000_00, 1050_00, 3).severity).toBe("warning");
    expect(computeVariance(1000_00, 1050_00, 20).severity).toBe("ok");
  });
});

describe("PHASE 3 actuals: project variance snapshot", () => {
  const budgetLines: BudgetLine[] = [
    { costCode: "06-100", costCodeName: "Framing", estimatedCents: 10_000_00 },
    { costCode: "07-300", costCodeName: "Roofing", estimatedCents: 8_000_00 },
    { costCode: "09-900", costCodeName: "Painting", estimatedCents: 3_000_00, fromChangeOrder: true },
  ];

  it("A26: only committed actuals move the variance; pending is reported separately", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      actual({ costCode: "06-100", amountCents: 9_500_00, status: "paid" }),
      actual({ id: "a2", costCode: "07-300", amountCents: 2_000_00, status: "pending" }),
    ]);
    expect(snapshot.baselineActualCents).toBe(9_500_00);
    expect(snapshot.pendingActualCents).toBe(2_000_00);
    expect(snapshot.committedCount).toBe(1);
    expect(snapshot.actualCount).toBe(2);
  });

  it("A27: baseline and change order money are never merged", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      actual({ costCode: "06-100", amountCents: 12_000_00 }),
      actual({ id: "a2", costCode: "09-900", amountCents: 2_800_00, changeOrderId: "co-1" }),
    ]);
    expect(snapshot.baselineEstimatedCents).toBe(18_000_00);
    expect(snapshot.changeOrderEstimatedCents).toBe(3_000_00);
    expect(snapshot.totalEstimatedCents).toBe(21_000_00);
    expect(snapshot.baselineActualCents).toBe(12_000_00);
    expect(snapshot.changeOrderActualCents).toBe(2_800_00);
    expect(snapshot.totalActualCents).toBe(14_800_00);
  });

  it("A28: an overrun on a cost code raises an alert naming the code", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      actual({ costCode: "06-100", amountCents: 14_000_00 }),
    ]);
    const framing = snapshot.byCostCode.find((c) => c.costCode === "06-100");
    expect(framing?.severity).toBe("critical");
    expect(snapshot.requiresReview).toBe(true);
    expect(snapshot.alerts.some((a) => a.costCode === "06-100")).toBe(true);
  });

  it("A29: cost booked on an unbudgeted code is surfaced, not absorbed", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      actual({ costCode: "99-999", amountCents: 1_500_00 }),
    ]);
    const rogue = snapshot.byCostCode.find((c) => c.costCode === "99-999");
    expect(rogue?.severity).toBe("unbudgeted");
    expect(snapshot.alerts.some((a) => a.severity === "unbudgeted")).toBe(true);
  });

  it("A30: alerts are ordered by operational urgency", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      actual({ costCode: "06-100", amountCents: 14_000_00 }),
      actual({ id: "a2", costCode: "99-999", amountCents: 500_00 }),
      actual({ id: "a3", costCode: "07-300", amountCents: 9_000_00 }),
    ]);
    expect(snapshot.alerts[0].severity).toBe("critical");
  });

  it("A31: remaining budget goes negative on an overrun instead of clamping at zero", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      actual({ costCode: "06-100", amountCents: 25_000_00 }),
    ]);
    expect(snapshot.remainingBudgetCents).toBeLessThan(0);
    // Project-level severity is measured against the whole approved budget, so a single
    // blown cost code can be a project-level warning. The cost code itself is critical.
    expect(snapshot.severity).toBe("warning");
    expect(snapshot.byCostCode.find((c) => c.costCode === "06-100")?.severity).toBe("critical");
    expect(snapshot.requiresReview).toBe(true);
  });

  it("A32: an uncoded actual is bucketed as UNCODED rather than dropped", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      { amountCents: 400_00, status: "approved" } as ActualRecord,
    ]);
    expect(snapshot.byCostCode.some((c) => c.costCode === "UNCODED")).toBe(true);
  });

  it("A33: an empty project produces a zeroed snapshot instead of throwing", () => {
    const snapshot = buildVarianceSnapshot([], []);
    expect(snapshot.totalEstimatedCents).toBe(0);
    expect(snapshot.totalActualCents).toBe(0);
    expect(snapshot.severity).toBe("ok");
    expect(snapshot.byCostCode).toEqual([]);
  });

  it("A34: rejected and void actuals never touch the numbers", () => {
    const snapshot = buildVarianceSnapshot(budgetLines, [
      actual({ costCode: "06-100", amountCents: 5_000_00, status: "rejected" }),
      actual({ id: "a2", costCode: "06-100", amountCents: 5_000_00, status: "void" }),
    ]);
    expect(snapshot.totalActualCents).toBe(0);
    expect(snapshot.pendingActualCents).toBe(0);
  });
});

describe("PHASE 3 actuals: budget math (§7)", () => {
  it("A35: an approved change order increases the available budget", () => {
    const budget = computeProjectBudget(100_000_00, 15_000_00, [
      { amountCents: 40_000_00, status: "approved" },
      { amountCents: 5_000_00, status: "pending" },
    ]);
    expect(budget.totalBudgetCents).toBe(115_000_00);
    expect(budget.committedCents).toBe(40_000_00);
    expect(budget.pendingCents).toBe(5_000_00);
    expect(budget.availableCents).toBe(75_000_00);
    expect(budget.consumedPct).toBeCloseTo(34.8, 1);
    expect(budget.overBudget).toBe(false);
  });

  it("A36: committing more than the budget flags the overrun", () => {
    const budget = computeProjectBudget(10_000_00, 0, [
      { amountCents: 12_000_00, status: "paid" },
    ]);
    expect(budget.overBudget).toBe(true);
    expect(budget.availableCents).toBe(-2_000_00);
  });

  it("A37: a project with no budget reports a null consumption percentage", () => {
    const budget = computeProjectBudget(0, 0, []);
    expect(budget.consumedPct).toBeNull();
  });

  it("A38: budget lines are extracted from estimate line items by cost code", () => {
    const lines = budgetLinesFromEstimateLineItems([
      { costCode: "06-100", costItemName: "Framing", quantity: 10, unitCostSnapshot: 25 },
      { costCode: "06-100", costItemName: "Blocking", lineTotalCost: 150 },
      { costCode: "07-300", costItemName: "Shingles", lineTotalCost: 2000 },
    ]);
    const framing = lines.find((l) => l.costCode === "06-100");
    expect(framing?.estimatedCents).toBe(400_00);
    expect(lines.find((l) => l.costCode === "07-300")?.estimatedCents).toBe(2_000_00);
  });

  it("A39: change order line items are tagged as change order budget", () => {
    const lines = budgetLinesFromEstimateLineItems(
      [{ costCode: "09-900", lineTotalCost: 1200 }],
      { fromChangeOrder: true },
    );
    expect(lines[0].fromChangeOrder).toBe(true);
    expect(lines[0].estimatedCents).toBe(1_200_00);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. SUBCONTRACTOR ENGINE
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 3 subcontractors: compliance (SC-001)", () => {
  const base = {
    licenseNumber: "SC-12345",
    licenseExpiry: "2027-01-01",
    insuranceCarrier: "State Farm",
    insuranceExpiry: "2027-01-01",
    insuranceCoverageCents: 2_000_000_00,
    today: TODAY,
  };

  it("S1: current documents are compliant", () => {
    const assessment = assessCompliance(base);
    expect(assessment.overall).toBe("compliant");
    expect(assessment.compliant).toBe(true);
    expect(assessment.alerts).toEqual([]);
  });

  it("S2: a document expiring inside the warning window is flagged", () => {
    const assessment = assessCompliance({ ...base, insuranceExpiry: "2026-03-25" });
    expect(assessment.insurance.state).toBe("expiring");
    expect(assessment.insurance.daysUntilExpiry).toBe(15);
    expect(assessment.overall).toBe("expiring");
    expect(assessment.alerts).toHaveLength(1);
  });

  it("S3: an expired document is not compliant", () => {
    const assessment = assessCompliance({ ...base, insuranceExpiry: "2026-02-01" });
    expect(assessment.insurance.state).toBe("expired");
    expect(assessment.compliant).toBe(false);
    expect(assessment.insurance.message).toMatch(/expired/i);
  });

  it("S4: a missing document is distinguished from an expired one", () => {
    const assessment = assessCompliance({ ...base, licenseNumber: null });
    expect(assessment.license.state).toBe("missing");
    expect(assessment.overall).toBe("missing");
  });

  it("S5: a document without an expiry date is treated as unverified", () => {
    const assessment = assessCompliance({ ...base, insuranceExpiry: null });
    expect(assessment.insurance.state).toBe("missing");
    expect(assessment.insurance.message).toMatch(/unverified/i);
  });

  it("S6: the overall state is the worst of the documents", () => {
    const assessment = assessCompliance({
      ...base,
      licenseExpiry: "2026-03-20",
      insuranceExpiry: "2026-01-01",
    });
    expect(assessment.overall).toBe("expired");
  });

  it("S7: coverage below the tenant minimum raises an alert", () => {
    const assessment = assessCompliance({
      ...base,
      insuranceCoverageCents: 500_000_00,
      requiredCoverageCents: 1_000_000_00,
    });
    expect(assessment.alerts.some((a) => /coverage below/i.test(a))).toBe(true);
  });

  it("S8: the warning window is configurable", () => {
    const assessment = assessCompliance({ ...base, insuranceExpiry: "2026-04-20", warningDays: 60 });
    expect(assessment.insurance.state).toBe("expiring");
  });
});

describe("PHASE 3 subcontractors: assignment eligibility (SC-002)", () => {
  const compliant = assessCompliance({
    licenseNumber: "SC-1",
    licenseExpiry: "2027-01-01",
    insuranceCarrier: "State Farm",
    insuranceExpiry: "2027-01-01",
    today: TODAY,
  });

  const expiredInsurance = assessCompliance({
    licenseNumber: "SC-1",
    licenseExpiry: "2027-01-01",
    insuranceCarrier: "State Farm",
    insuranceExpiry: "2026-01-01",
    today: TODAY,
  });

  it("S9: an active, compliant company is eligible", () => {
    const result = evaluateAssignmentEligibility({ status: "active", compliance: compliant });
    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("S10: expired insurance is a hard block — uninsured work transfers the liability", () => {
    const result = evaluateAssignmentEligibility({
      status: "active",
      compliance: expiredInsurance,
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers.some((b) => /insurance expired/i.test(b))).toBe(true);
  });

  it("S11: a suspended company cannot receive new work", () => {
    const result = evaluateAssignmentEligibility({ status: "suspended", compliance: compliant });
    expect(result.eligible).toBe(false);
    expect(result.blockers[0]).toMatch(/cannot receive new assignments/i);
  });

  it("S12: probation allows assignment but warns the operator", () => {
    const result = evaluateAssignmentEligibility({ status: "probation", compliance: compliant });
    expect(result.eligible).toBe(true);
    expect(result.warnings.some((w) => /probation/i.test(w))).toBe(true);
  });

  it("S13: expiring insurance warns without stopping the schedule", () => {
    const expiring = assessCompliance({
      licenseNumber: "SC-1",
      licenseExpiry: "2027-01-01",
      insuranceCarrier: "State Farm",
      insuranceExpiry: "2026-03-20",
      today: TODAY,
    });
    const result = evaluateAssignmentEligibility({ status: "active", compliance: expiring });
    expect(result.eligible).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("S14: strict mode escalates missing documents to blockers", () => {
    const missing = assessCompliance({ today: TODAY });
    const lenient = evaluateAssignmentEligibility({ status: "active", compliance: missing });
    const strict = evaluateAssignmentEligibility({
      status: "active",
      compliance: missing,
      strict: true,
    });
    expect(lenient.eligible).toBe(true);
    expect(strict.eligible).toBe(false);
  });

  it("S15: an unknown status is blocked rather than assumed active", () => {
    const result = evaluateAssignmentEligibility({ status: "whatever", compliance: compliant });
    expect(result.eligible).toBe(false);
  });
});

describe("PHASE 3 subcontractors: performance (SC-003)", () => {
  it("S16: punctuality is measured only on tasks with both dates", () => {
    const metrics = computePerformanceMetrics(
      [
        { status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-01" },
        { status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-05" },
        { status: "completed", plannedEndDate: null, actualEndDate: "2026-03-02" },
        { status: "in_progress" },
      ],
      [],
    );
    expect(metrics.measuredTaskCount).toBe(2);
    expect(metrics.onTimePct).toBe(50);
    expect(metrics.avgDaysLate).toBe(2);
  });

  it("S17: quality is the verification rate penalised by rework", () => {
    const clean = computePerformanceMetrics(
      [
        { status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-01" },
        { status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-01" },
      ],
      [],
    );
    expect(clean.qualityScore).toBe(100);

    const withRework = computePerformanceMetrics(
      [
        { status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-01", reworkCount: 1 },
        { status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-01" },
      ],
      [],
    );
    expect(withRework.qualityScore).toBeLessThan(100);
  });

  it("S18: cost variance uses committed actuals only", () => {
    const metrics = computePerformanceMetrics(
      [{ status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-01" }],
      [
        { estimatedAmountCents: 1_000_00, amountCents: 1_200_00, status: "paid" },
        { estimatedAmountCents: 1_000_00, amountCents: 5_000_00, status: "pending" },
      ],
    );
    expect(metrics.costVarianceAvgPct).toBe(20);
    expect(metrics.committedCostCents).toBe(1_200_00);
  });

  it("S19: a strong record produces a high derived rating", () => {
    const metrics = computePerformanceMetrics(
      [
        { status: "verified", plannedEndDate: "2026-03-01", actualEndDate: "2026-02-28" },
        { status: "verified", plannedEndDate: "2026-03-05", actualEndDate: "2026-03-05" },
      ],
      [{ estimatedAmountCents: 1_000_00, amountCents: 980_00, status: "paid" }],
    );
    expect(metrics.derivedRating).toBeGreaterThanOrEqual(4.5);
    expect(metrics.signals).toEqual([]);
  });

  it("S20: a poor record produces signals the operator can act on", () => {
    const metrics = computePerformanceMetrics(
      [
        { status: "completed", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-12", reworkCount: 2 },
        { status: "completed", plannedEndDate: "2026-03-01", actualEndDate: "2026-03-10" },
      ],
      [{ estimatedAmountCents: 1_000_00, amountCents: 1_400_00, status: "approved" }],
    );
    expect(metrics.onTimePct).toBe(0);
    expect(metrics.derivedRating).toBeLessThan(2);
    expect(metrics.signals.length).toBeGreaterThanOrEqual(3);
  });

  it("S21: a company with no history reports nulls instead of a flattering zero", () => {
    const metrics = computePerformanceMetrics([], []);
    expect(metrics.onTimePct).toBeNull();
    expect(metrics.qualityScore).toBeNull();
    expect(metrics.derivedRating).toBeNull();
    expect(metrics.committedCostCents).toBe(0);
  });

  it("S22: completed work with no planned dates says so instead of implying punctuality", () => {
    const metrics = computePerformanceMetrics(
      [{ status: "completed", actualEndDate: "2026-03-01" }],
      [],
    );
    expect(metrics.onTimePct).toBeNull();
    expect(metrics.signals.some((s) => /without planned dates/i.test(s))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. CLOSEOUT ENGINE
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 3 closeout: opening gate (CO-001)", () => {
  it("C1: closeout opens when every task is closed and an estimate is approved", () => {
    const readiness = evaluateCloseoutReadiness({
      taskStatuses: [
        { id: "t1", status: "verified" },
        { id: "t2", status: "cancelled" },
      ],
      hasApprovedEstimate: true,
    });
    expect(readiness.canOpen).toBe(true);
    expect(readiness.taskCompletionPct).toBe(100);
  });

  it("C2: an open task blocks closeout and is named in the blocker details", () => {
    const readiness = evaluateCloseoutReadiness({
      taskStatuses: [
        { id: "t1", status: "verified" },
        { id: "t2", status: "in_progress" },
      ],
      hasApprovedEstimate: true,
    });
    expect(readiness.canOpen).toBe(false);
    expect(readiness.openTaskCount).toBe(1);
    expect(readiness.openTaskIds).toEqual(["t2"]);
    expect(readiness.blockers[0].code).toBe("CLOSEOUT_BLOCKED_OPEN_TASKS");
  });

  it("C3: a blocked task also blocks closeout", () => {
    const readiness = evaluateCloseoutReadiness({
      taskStatuses: [{ id: "t1", status: "blocked" }],
      hasApprovedEstimate: true,
    });
    expect(readiness.canOpen).toBe(false);
  });

  it("C4: a project with no task cannot be closed — there is no execution evidence", () => {
    const readiness = evaluateCloseoutReadiness({
      taskStatuses: [],
      hasApprovedEstimate: true,
    });
    expect(readiness.canOpen).toBe(false);
    expect(readiness.blockers[0].details).toMatchObject({ totalTaskCount: 0 });
  });

  it("C5: closeout requires an approved estimate as the financial baseline", () => {
    const readiness = evaluateCloseoutReadiness({
      taskStatuses: [{ id: "t1", status: "verified" }],
      hasApprovedEstimate: false,
    });
    expect(readiness.canOpen).toBe(false);
    expect(readiness.blockers.map((b) => b.code)).toContain("NO_APPROVED_ESTIMATE");
  });
});

describe("PHASE 3 closeout: checklist (CO-002)", () => {
  it("C6: a complete checklist reports 100% and no blocker", () => {
    const checklist = evaluateChecklist(COMPLETE_CHECKLIST);
    expect(checklist.complete).toBe(true);
    expect(checklist.completionPct).toBe(100);
    expect(checklist.blockers).toEqual([]);
  });

  it("C7: an empty checklist names every missing item", () => {
    const checklist = evaluateChecklist({});
    expect(checklist.complete).toBe(false);
    expect(checklist.completedCount).toBe(0);
    expect(checklist.missing).toHaveLength(checklist.requiredCount);
    expect(checklist.blockers[0].code).toBe("CLOSEOUT_CHECKLIST_INCOMPLETE");
  });

  it("C8: a partial checklist reports partial completion", () => {
    const checklist = evaluateChecklist({
      final_inspection_passed: true,
      punch_list_complete: true,
    });
    expect(checklist.complete).toBe(false);
    expect(checklist.completedCount).toBe(2);
    expect(checklist.completionPct).toBeGreaterThan(0);
    expect(checklist.completionPct).toBeLessThan(100);
  });

  it("C9: the satisfaction score is only accepted inside its range", () => {
    const invalid = evaluateChecklist({ ...COMPLETE_CHECKLIST, client_satisfaction_score: 12 });
    expect(invalid.blockers.some((b) => b.code === "INVALID_SATISFACTION_SCORE")).toBe(true);
    const zero = evaluateChecklist({ ...COMPLETE_CHECKLIST, client_satisfaction_score: 0 });
    expect(zero.blockers.some((b) => b.code === "INVALID_SATISFACTION_SCORE")).toBe(false);
  });

  it("C10: a false item is treated as missing, not as answered", () => {
    const checklist = evaluateChecklist({
      ...COMPLETE_CHECKLIST,
      lien_waivers_collected: false,
    });
    expect(checklist.complete).toBe(false);
    expect(checklist.missing.map((m) => m.key)).toContain("lien_waivers_collected");
  });
});

describe("PHASE 3 closeout: closing gate (CO-003)", () => {
  it("C11: closing succeeds when the checklist is complete and the ledger is settled", () => {
    const evaluation = evaluateFinalClose({
      checklist: COMPLETE_CHECKLIST,
      pendingActualCount: 0,
      unreviewedVarianceCostCodes: [],
      openTaskCount: 0,
    });
    expect(evaluation.canClose).toBe(true);
    expect(evaluation.blockers).toEqual([]);
  });

  it("C12: a pending actual blocks closing — the final number could still move", () => {
    const evaluation = evaluateFinalClose({
      checklist: COMPLETE_CHECKLIST,
      pendingActualCount: 3,
      unreviewedVarianceCostCodes: [],
      openTaskCount: 0,
    });
    expect(evaluation.canClose).toBe(false);
    expect(evaluation.blockers[0].code).toBe("CLOSEOUT_PENDING_ACTUALS");
    expect(evaluation.blockers[0].details).toMatchObject({ pendingActualCount: 3 });
  });

  it("C13: unreviewed critical variance blocks closing and names the cost codes", () => {
    const evaluation = evaluateFinalClose({
      checklist: COMPLETE_CHECKLIST,
      pendingActualCount: 0,
      unreviewedVarianceCostCodes: ["06-100", "07-300"],
      openTaskCount: 0,
    });
    expect(evaluation.canClose).toBe(false);
    const blocker = evaluation.blockers.find((b) => b.code === "CLOSEOUT_VARIANCE_UNREVIEWED");
    expect(blocker?.message).toContain("06-100");
  });

  it("C14: a task reopened after closeout started blocks closing", () => {
    const evaluation = evaluateFinalClose({
      checklist: COMPLETE_CHECKLIST,
      pendingActualCount: 0,
      unreviewedVarianceCostCodes: [],
      openTaskCount: 1,
    });
    expect(evaluation.canClose).toBe(false);
    expect(evaluation.blockers[0].code).toBe("CLOSEOUT_BLOCKED_OPEN_TASKS");
  });

  it("C15: every blocker is reported at once so the operator sees the full list", () => {
    const evaluation = evaluateFinalClose({
      checklist: {},
      pendingActualCount: 2,
      unreviewedVarianceCostCodes: ["06-100"],
      openTaskCount: 1,
    });
    expect(evaluation.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it("C16: closeout transitions follow the documented flow", () => {
    expect(evaluateCloseoutTransition("open", "in_progress").allowed).toBe(true);
    expect(evaluateCloseoutTransition("in_progress", "ready_to_close").allowed).toBe(true);
    expect(evaluateCloseoutTransition("open", "closed").allowed).toBe(false);
    expect(evaluateCloseoutTransition("closed", "in_progress").allowed).toBe(false);
    expect(evaluateCloseoutTransition("open", "open").allowed).toBe(false);
  });
});

describe("PHASE 3 closeout: final variance report", () => {
  const snapshot = buildVarianceSnapshot(
    [
      { costCode: "06-100", costCodeName: "Framing", estimatedCents: 10_000_00 },
      { costCode: "07-300", costCodeName: "Roofing", estimatedCents: 8_000_00 },
      { costCode: "09-900", estimatedCents: 3_000_00, fromChangeOrder: true },
    ],
    [
      actual({ costCode: "06-100", amountCents: 13_000_00 }),
      actual({ id: "a2", costCode: "07-300", amountCents: 7_500_00 }),
      actual({ id: "a3", costCode: "09-900", amountCents: 3_100_00, changeOrderId: "co-1" }),
    ],
  );

  it("C17: the report carries the full estimated vs actual picture", () => {
    const report = buildFinalVarianceReport(snapshot, { generatedAt: "2026-03-10T12:00:00.000Z" });
    expect(report.totalEstimatedCents).toBe(21_000_00);
    expect(report.totalActualCents).toBe(23_600_00);
    expect(report.varianceCents).toBe(2_600_00);
    expect(report.baselineActualCents).toBe(20_500_00);
    expect(report.changeOrderActualCents).toBe(3_100_00);
    expect(report.generatedAt).toBe("2026-03-10T12:00:00.000Z");
  });

  it("C18: overruns are ranked so the biggest loss is first", () => {
    const report = buildFinalVarianceReport(snapshot, { generatedAt: TODAY });
    expect(report.topOverruns[0].costCode).toBe("06-100");
    expect(report.topOverruns[0].variance).toBe("3000.00");
  });

  it("C19: realized gross profit is computed against the approved sell price", () => {
    const report = buildFinalVarianceReport(snapshot, {
      generatedAt: TODAY,
      approvedSellPriceCents: 30_000_00,
    });
    expect(report.realizedGrossProfitCents).toBe(6_400_00);
    expect(report.realizedGrossProfitPct).toBeCloseTo(21.3, 1);
    expect(report.summary).toMatch(/Realized gross profit/);
  });

  it("C20: without a sell price the profit fields are null instead of zero", () => {
    const report = buildFinalVarianceReport(snapshot, { generatedAt: TODAY });
    expect(report.realizedGrossProfitCents).toBeNull();
    expect(report.realizedGrossProfitPct).toBeNull();
  });

  it("C21: the summary states the direction of the variance in plain language", () => {
    const report = buildFinalVarianceReport(snapshot, { generatedAt: TODAY });
    expect(report.summary).toMatch(/over the approved budget/);
    expect(report.summary).toContain("Largest overrun");
  });

  it("C22: money is pre-formatted so the persisted snapshot reads without conversion", () => {
    const report = buildFinalVarianceReport(snapshot, { generatedAt: TODAY });
    const framing = report.lines.find((l) => l.costCode === "06-100");
    expect(framing?.estimated).toBe("10000.00");
    expect(framing?.actual).toBe("13000.00");
  });

  it("C23: the cost codes demanding review are extracted from the snapshot", () => {
    const codes = costCodesRequiringReview(snapshot);
    expect(codes).toContain("06-100");
    expect(codes).not.toContain("07-300");
  });

  it("C24: an under-budget project reports the variance as under, not as a loss", () => {
    const under = buildVarianceSnapshot(
      [{ costCode: "06-100", estimatedCents: 10_000_00 }],
      [actual({ costCode: "06-100", amountCents: 8_000_00 })],
    );
    const report = buildFinalVarianceReport(under, { generatedAt: TODAY });
    expect(report.varianceCents).toBe(-2_000_00);
    expect(report.summary).toMatch(/under the approved budget/);
    expect(report.topOverruns).toEqual([]);
  });
});
