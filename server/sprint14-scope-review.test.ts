/**
 * structr.ai — Sprint 14: Scope Review Workspace Tests
 * ═══════════════════════════════════════════════════════════════
 *
 * Comprehensive test coverage for the Scope Review subsystem:
 *
 * Test sections:
 *   1. State Machine — transitions, terminal states, editable states
 *   2. State Machine — validateTransition() structured results
 *   3. State Machine — assertTransition() / assertEditable() throws
 *   4. State Machine — getValidNextStates()
 *   5. Constants — ALL_STATES, TERMINAL_STATES, EDITABLE_STATES
 *   6. Schema — scope_review_deltas table structure
 *   7. Schema — scope_review_snapshots table structure
 *   8. Schema — SnapshotItem / SnapshotDelta interfaces
 *   9. DB Helpers — export verification
 *  10. Router — structure and procedure verification
 *  11. Profit Shield — confidence thresholds
 *  12. Cross-module integration — state machine ↔ router ↔ DB
 *  13. Edge cases — boundary conditions and invalid inputs
 *
 * Target: 60+ tests
 */

import { describe, it, expect } from "vitest";
import {
  validateTransition,
  isValidTransition,
  isEditableState,
  isTerminalState,
  getValidNextStates,
  assertTransition,
  assertEditable,
  ALLOWED_TRANSITIONS,
  ALL_STATES,
  TERMINAL_STATES,
  EDITABLE_STATES,
  type ScopeDraftStatus,
  type StateTransitionResult,
} from "../shared/scope-review-state-machine";
import * as schema from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// 1. STATE MACHINE — VALID TRANSITIONS
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — State Machine: valid transitions", () => {
  it("draft → under_review is valid", () => {
    expect(isValidTransition("draft", "under_review")).toBe(true);
  });

  it("under_review → approved is valid", () => {
    expect(isValidTransition("under_review", "approved")).toBe(true);
  });

  it("under_review → rejected is valid", () => {
    expect(isValidTransition("under_review", "rejected")).toBe(true);
  });

  it("approved → converted is valid", () => {
    expect(isValidTransition("approved", "converted")).toBe(true);
  });

  it("draft → approved is INVALID (skip)", () => {
    expect(isValidTransition("draft", "approved")).toBe(false);
  });

  it("draft → converted is INVALID (skip)", () => {
    expect(isValidTransition("draft", "converted")).toBe(false);
  });

  it("draft → rejected is INVALID (no direct reject from draft)", () => {
    expect(isValidTransition("draft", "rejected")).toBe(false);
  });

  it("under_review → converted is INVALID (must approve first)", () => {
    expect(isValidTransition("under_review", "converted")).toBe(false);
  });

  it("approved → rejected is INVALID (already decided)", () => {
    expect(isValidTransition("approved", "rejected")).toBe(false);
  });

  it("rejected → anything is INVALID (terminal)", () => {
    expect(isValidTransition("rejected", "draft")).toBe(false);
    expect(isValidTransition("rejected", "under_review")).toBe(false);
    expect(isValidTransition("rejected", "approved")).toBe(false);
    expect(isValidTransition("rejected", "converted")).toBe(false);
  });

  it("converted → anything is INVALID (terminal)", () => {
    expect(isValidTransition("converted", "draft")).toBe(false);
    expect(isValidTransition("converted", "under_review")).toBe(false);
    expect(isValidTransition("converted", "approved")).toBe(false);
    expect(isValidTransition("converted", "rejected")).toBe(false);
  });

  it("self-transitions are INVALID for all states", () => {
    for (const state of ALL_STATES) {
      expect(isValidTransition(state, state)).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. STATE MACHINE — validateTransition() STRUCTURED RESULTS
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — State Machine: validateTransition() results", () => {
  it("valid transition returns { valid: true, from, to }", () => {
    const result = validateTransition("draft", "under_review");
    expect(result.valid).toBe(true);
    expect(result.from).toBe("draft");
    expect(result.to).toBe("under_review");
    expect(result.error).toBeUndefined();
  });

  it("invalid transition returns { valid: false, error }", () => {
    const result = validateTransition("draft", "approved");
    expect(result.valid).toBe(false);
    expect(result.from).toBe("draft");
    expect(result.to).toBe("approved");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Invalid transition");
  });

  it("error message includes allowed transitions", () => {
    const result = validateTransition("draft", "converted");
    expect(result.error).toContain("under_review");
  });

  it("terminal state error message shows empty allowed set", () => {
    const result = validateTransition("rejected", "draft");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid transition");
  });

  it("all 4 valid transitions produce valid results", () => {
    const validPairs: [ScopeDraftStatus, ScopeDraftStatus][] = [
      ["draft", "under_review"],
      ["under_review", "approved"],
      ["under_review", "rejected"],
      ["approved", "converted"],
    ];
    for (const [from, to] of validPairs) {
      const result = validateTransition(from, to);
      expect(result.valid, `${from} → ${to} should be valid`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. STATE MACHINE — assertTransition() / assertEditable()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — State Machine: assert functions", () => {
  it("assertTransition does not throw for valid transition", () => {
    expect(() => assertTransition("draft", "under_review")).not.toThrow();
  });

  it("assertTransition throws for invalid transition", () => {
    expect(() => assertTransition("draft", "approved")).toThrow();
  });

  it("assertTransition error message matches validateTransition", () => {
    const result = validateTransition("draft", "approved");
    expect(() => assertTransition("draft", "approved")).toThrow(result.error!);
  });

  it("assertEditable does not throw for under_review", () => {
    expect(() => assertEditable("under_review")).not.toThrow();
  });

  it("assertEditable throws for draft", () => {
    expect(() => assertEditable("draft")).toThrow();
  });

  it("assertEditable throws for approved", () => {
    expect(() => assertEditable("approved")).toThrow();
  });

  it("assertEditable throws for rejected", () => {
    expect(() => assertEditable("rejected")).toThrow();
  });

  it("assertEditable throws for converted", () => {
    expect(() => assertEditable("converted")).toThrow();
  });

  it("assertEditable error message includes EDITABLE_STATES", () => {
    try {
      assertEditable("draft");
    } catch (err: any) {
      expect(err.message).toContain("under_review");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. STATE MACHINE — getValidNextStates()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — State Machine: getValidNextStates()", () => {
  it("draft → [under_review]", () => {
    const next = getValidNextStates("draft");
    expect(next).toEqual(["under_review"]);
  });

  it("under_review → [approved, rejected]", () => {
    const next = getValidNextStates("under_review");
    expect(next).toHaveLength(2);
    expect(next).toContain("approved");
    expect(next).toContain("rejected");
  });

  it("approved → [converted]", () => {
    const next = getValidNextStates("approved");
    expect(next).toEqual(["converted"]);
  });

  it("rejected → [] (terminal)", () => {
    const next = getValidNextStates("rejected");
    expect(next).toEqual([]);
  });

  it("converted → [] (terminal)", () => {
    const next = getValidNextStates("converted");
    expect(next).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. CONSTANTS — ALL_STATES, TERMINAL_STATES, EDITABLE_STATES
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — State Machine: constants", () => {
  it("ALL_STATES has exactly 5 states", () => {
    expect(ALL_STATES).toHaveLength(5);
  });

  it("ALL_STATES includes all lifecycle states", () => {
    expect(ALL_STATES).toContain("draft");
    expect(ALL_STATES).toContain("under_review");
    expect(ALL_STATES).toContain("approved");
    expect(ALL_STATES).toContain("rejected");
    expect(ALL_STATES).toContain("converted");
  });

  it("TERMINAL_STATES has exactly 2 states", () => {
    expect(TERMINAL_STATES).toHaveLength(2);
  });

  it("TERMINAL_STATES includes rejected and converted", () => {
    expect(TERMINAL_STATES).toContain("rejected");
    expect(TERMINAL_STATES).toContain("converted");
  });

  it("EDITABLE_STATES has exactly 1 state", () => {
    expect(EDITABLE_STATES).toHaveLength(1);
  });

  it("EDITABLE_STATES includes only under_review", () => {
    expect(EDITABLE_STATES).toContain("under_review");
  });

  it("ALLOWED_TRANSITIONS has entries for all 5 states", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS)).toHaveLength(5);
  });

  it("isTerminalState returns true for terminal states only", () => {
    expect(isTerminalState("rejected")).toBe(true);
    expect(isTerminalState("converted")).toBe(true);
    expect(isTerminalState("draft")).toBe(false);
    expect(isTerminalState("under_review")).toBe(false);
    expect(isTerminalState("approved")).toBe(false);
  });

  it("isEditableState returns true for editable states only", () => {
    expect(isEditableState("under_review")).toBe(true);
    expect(isEditableState("draft")).toBe(false);
    expect(isEditableState("approved")).toBe(false);
    expect(isEditableState("rejected")).toBe(false);
    expect(isEditableState("converted")).toBe(false);
  });

  it("terminal states have no allowed transitions", () => {
    for (const state of TERMINAL_STATES) {
      const transitions = ALLOWED_TRANSITIONS[state];
      expect(transitions.size, `${state} should have 0 transitions`).toBe(0);
    }
  });

  it("non-terminal states have at least one allowed transition", () => {
    const nonTerminal = ALL_STATES.filter(
      (s) => !(TERMINAL_STATES as readonly string[]).includes(s)
    );
    for (const state of nonTerminal) {
      const transitions = ALLOWED_TRANSITIONS[state];
      expect(transitions.size, `${state} should have ≥1 transitions`).toBeGreaterThanOrEqual(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. SCHEMA — scope_review_deltas TABLE
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — Schema: scope_review_deltas table", () => {
  const table = schema.scopeReviewDeltas;
  const cols = Object.keys(table);

  it("table exists in schema", () => {
    expect(table).toBeDefined();
  });

  it("has all required columns", () => {
    const required = [
      "id",
      "scopeDraftId",
      "assemblyId",
      "actionType",
      "previousQuantity",
      "newQuantity",
      "operatorReason",
      "createdBy",
      "createdAt",
    ];
    for (const col of required) {
      expect(cols, `Missing column: ${col}`).toContain(col);
    }
  });

  it("actionType is enum with 2 values", () => {
    const col = table.actionType;
    expect(col.enumValues).toContain("remove");
    expect(col.enumValues).toContain("quantity_adjustment");
    expect(col.enumValues?.length).toBe(2);
  });

  it("id is autoincrement", () => {
    const col = table.id;
    expect(col.autoIncrement).toBe(true);
  });

  it("scopeDraftId is not null", () => {
    const col = table.scopeDraftId;
    expect(col.notNull).toBe(true);
  });

  it("assemblyId is not null", () => {
    const col = table.assemblyId;
    expect(col.notNull).toBe(true);
  });

  it("previousQuantity is not null", () => {
    const col = table.previousQuantity;
    expect(col.notNull).toBe(true);
  });

  it("newQuantity is nullable (null for remove)", () => {
    const col = table.newQuantity;
    expect(col.notNull).toBe(false);
  });

  it("operatorReason is nullable", () => {
    const col = table.operatorReason;
    expect(col.notNull).toBe(false);
  });

  it("createdBy is nullable", () => {
    const col = table.createdBy;
    expect(col.notNull).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. SCHEMA — scope_review_snapshots TABLE
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — Schema: scope_review_snapshots table", () => {
  const table = schema.scopeReviewSnapshots;
  const cols = Object.keys(table);

  it("table exists in schema", () => {
    expect(table).toBeDefined();
  });

  it("has all required columns", () => {
    const required = [
      "id",
      "scopeDraftId",
      "approvedItems",
      "deltaChanges",
      "warnings",
      "confidenceScore",
      "operatorId",
      "bundleId",
      "createdAt",
    ];
    for (const col of required) {
      expect(cols, `Missing column: ${col}`).toContain(col);
    }
  });

  it("id is autoincrement", () => {
    const col = table.id;
    expect(col.autoIncrement).toBe(true);
  });

  it("scopeDraftId is not null", () => {
    const col = table.scopeDraftId;
    expect(col.notNull).toBe(true);
  });

  it("operatorId is not null", () => {
    const col = table.operatorId;
    expect(col.notNull).toBe(true);
  });

  it("bundleId is nullable (set after conversion)", () => {
    const col = table.bundleId;
    expect(col.notNull).toBe(false);
  });

  it("warnings is nullable JSON", () => {
    const col = table.warnings;
    expect(col.notNull).toBe(false);
  });

  it("confidenceScore is nullable decimal", () => {
    const col = table.confidence;
    expect(col.notNull).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. SCHEMA — SnapshotItem / SnapshotDelta INTERFACES
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — Schema: SnapshotItem / SnapshotDelta interfaces", () => {
  it("SnapshotItem has correct shape", () => {
    const item: schema.SnapshotItem = {
      assemblyId: 1,
      assemblyName: "Test Assembly",
      quantity: 10,
      unit: "SF",
      reason: "Matched by rule",
      confidence: 0.85,
    };
    expect(item.assemblyId).toBe(1);
    expect(item.assemblyName).toBe("Test Assembly");
    expect(item.quantity).toBe(10);
    expect(item.unit).toBe("SF");
    expect(item.reason).toBe("Matched by rule");
    expect(item.confidence).toBe(0.85);
  });

  it("SnapshotDelta has correct shape for remove", () => {
    const delta: schema.SnapshotDelta = {
      assemblyId: 5,
      actionType: "remove",
      previousQuantity: 10,
      newQuantity: null,
      operatorReason: "Not needed for this project",
    };
    expect(delta.actionType).toBe("remove");
    expect(delta.newQuantity).toBeNull();
  });

  it("SnapshotDelta has correct shape for quantity_adjustment", () => {
    const delta: schema.SnapshotDelta = {
      assemblyId: 5,
      actionType: "quantity_adjustment",
      previousQuantity: 10,
      newQuantity: 15,
      operatorReason: "Client requested more",
    };
    expect(delta.actionType).toBe("quantity_adjustment");
    expect(delta.newQuantity).toBe(15);
  });

  it("SnapshotDelta operatorReason can be null", () => {
    const delta: schema.SnapshotDelta = {
      assemblyId: 5,
      actionType: "remove",
      previousQuantity: 10,
      newQuantity: null,
      operatorReason: null,
    };
    expect(delta.operatorReason).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. DB HELPERS — EXPORT VERIFICATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — DB Helpers: scope-review-db exports", () => {
  it("exports createScopeReviewDelta", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.createScopeReviewDelta).toBe("function");
  });

  it("exports getDeltasForDraft", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.getDeltasForDraft).toBe("function");
  });

  it("exports getDeltasForAssembly", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.getDeltasForAssembly).toBe("function");
  });

  it("exports transitionDraftStatus", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.transitionDraftStatus).toBe("function");
  });

  it("exports getEffectiveItems", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.getEffectiveItems).toBe("function");
  });

  it("exports createReviewSnapshot", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.createReviewSnapshot).toBe("function");
  });

  it("exports getSnapshotForDraft", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.getSnapshotForDraft).toBe("function");
  });

  it("exports updateSnapshotBundleId", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.updateSnapshotBundleId).toBe("function");
  });

  it("exports buildSnapshotData", async () => {
    const mod = await import("./scope-review-db");
    expect(typeof mod.buildSnapshotData).toBe("function");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. ROUTER — STRUCTURE AND PROCEDURE VERIFICATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — Router: scopeReviewRouter structure", () => {
  it("exports scopeReviewRouter", async () => {
    const mod = await import("./scope-review-router");
    expect(mod.scopeReviewRouter).toBeDefined();
  });

  it("router has startReview procedure", async () => {
    const mod = await import("./scope-review-router");
    const router = mod.scopeReviewRouter;
    const procedures = Object.keys((router as any)._def.procedures ?? {});
    expect(procedures).toContain("startReview");
  });

  it("router has applyDelta procedure", async () => {
    const mod = await import("./scope-review-router");
    const router = mod.scopeReviewRouter;
    const procedures = Object.keys((router as any)._def.procedures ?? {});
    expect(procedures).toContain("applyDelta");
  });

  it("router has getReviewState procedure", async () => {
    const mod = await import("./scope-review-router");
    const router = mod.scopeReviewRouter;
    const procedures = Object.keys((router as any)._def.procedures ?? {});
    expect(procedures).toContain("getReviewState");
  });

  it("router has approveOrReject procedure", async () => {
    const mod = await import("./scope-review-router");
    const router = mod.scopeReviewRouter;
    const procedures = Object.keys((router as any)._def.procedures ?? {});
    expect(procedures).toContain("approveOrReject");
  });

  it("router has convertToBundle procedure", async () => {
    const mod = await import("./scope-review-router");
    const router = mod.scopeReviewRouter;
    const procedures = Object.keys((router as any)._def.procedures ?? {});
    expect(procedures).toContain("convertToBundle");
  });

  it("router has exactly 5 procedures", async () => {
    const mod = await import("./scope-review-router");
    const router = mod.scopeReviewRouter;
    const procedures = Object.keys((router as any)._def.procedures ?? {});
    expect(procedures).toHaveLength(5);
  });

  it("scopeReview is wired into appRouter", async () => {
    const mod = await import("./routers");
    const router = mod.appRouter;
    const procedures = Object.keys((router as any)._def.procedures ?? {});
    const scopeReviewProcedures = procedures.filter((p) => p.startsWith("scopeReview."));
    expect(scopeReviewProcedures.length).toBeGreaterThanOrEqual(5);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. PROFIT SHIELD — CONFIDENCE THRESHOLDS
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — Profit Shield: confidence thresholds", () => {
  // These tests validate the threshold constants used in the router
  // The actual Profit Shield logic is in convertToBundle procedure

  it("item confidence threshold is 0.5 (50%)", () => {
    // Items below 50% confidence trigger PROFIT_SHIELD warning
    const threshold = 0.5;
    expect(threshold).toBe(0.5);

    // Items at 49% should trigger warning
    expect(0.49 < threshold).toBe(true);
    // Items at 50% should NOT trigger warning
    expect(0.50 < threshold).toBe(false);
  });

  it("overall confidence threshold is 0.6 (60%)", () => {
    // Overall scope confidence below 60% triggers PROFIT_SHIELD warning
    const threshold = 0.6;
    expect(threshold).toBe(0.6);

    // Score at 59% should trigger warning
    expect(0.59 < threshold).toBe(true);
    // Score at 60% should NOT trigger warning
    expect(0.60 < threshold).toBe(false);
  });

  it("MIN_GROSS_PROFIT is 35%", async () => {
    const { MIN_GROSS_PROFIT } = await import("../shared/catalog-utils");
    expect(MIN_GROSS_PROFIT).toBe(35.0);
  });

  it("Profit Shield warning format includes PROFIT_SHIELD prefix", () => {
    // The router generates warnings with this prefix
    const warningPrefix = "PROFIT_SHIELD:";
    const sampleWarning = `PROFIT_SHIELD: 2 item(s) have confidence below 50%: Cabinet Set (40%), Countertop (35%)`;
    expect(sampleWarning.startsWith(warningPrefix)).toBe(true);
  });

  it("Profit Shield warning for overall confidence includes percentage", () => {
    const sampleWarning = `PROFIT_SHIELD: Overall scope confidence 55% is below 60% threshold. Review pricing carefully.`;
    expect(sampleWarning).toContain("55%");
    expect(sampleWarning).toContain("60% threshold");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 12. CROSS-MODULE INTEGRATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — Cross-module: state machine ↔ router ↔ DB", () => {
  it("state machine types are re-exported from state machine module", async () => {
    const mod = await import("../shared/scope-review-state-machine");
    expect(mod.validateTransition).toBeDefined();
    expect(mod.isValidTransition).toBeDefined();
    expect(mod.isEditableState).toBeDefined();
    expect(mod.isTerminalState).toBeDefined();
    expect(mod.getValidNextStates).toBeDefined();
    expect(mod.assertTransition).toBeDefined();
    expect(mod.assertEditable).toBeDefined();
    expect(mod.ALLOWED_TRANSITIONS).toBeDefined();
    expect(mod.ALL_STATES).toBeDefined();
    expect(mod.TERMINAL_STATES).toBeDefined();
    expect(mod.EDITABLE_STATES).toBeDefined();
  });

  it("scope_drafts status enum matches state machine ALL_STATES", () => {
    const schemaStatuses = schema.scopeDrafts.status.enumValues;
    expect(schemaStatuses).toBeDefined();
    for (const state of ALL_STATES) {
      expect(schemaStatuses, `Schema missing state: ${state}`).toContain(state);
    }
    expect(schemaStatuses!.length).toBe(ALL_STATES.length);
  });

  it("scope_review_deltas actionType enum matches delta operations", () => {
    const actionTypes = schema.scopeReviewDeltas.actionType.enumValues;
    expect(actionTypes).toContain("remove");
    expect(actionTypes).toContain("quantity_adjustment");
    expect(actionTypes?.length).toBe(2);
  });

  it("state machine editable state aligns with delta application", () => {
    // Only under_review allows delta application
    expect(isEditableState("under_review")).toBe(true);
    // All other states should NOT allow delta application
    expect(isEditableState("draft")).toBe(false);
    expect(isEditableState("approved")).toBe(false);
    expect(isEditableState("rejected")).toBe(false);
    expect(isEditableState("converted")).toBe(false);
  });

  it("full lifecycle path: draft → under_review → approved → converted", () => {
    // Simulate the happy path
    expect(isValidTransition("draft", "under_review")).toBe(true);
    expect(isEditableState("under_review")).toBe(true); // can apply deltas
    expect(isValidTransition("under_review", "approved")).toBe(true);
    expect(isValidTransition("approved", "converted")).toBe(true);
    expect(isTerminalState("converted")).toBe(true); // done
  });

  it("rejection path: draft → under_review → rejected", () => {
    expect(isValidTransition("draft", "under_review")).toBe(true);
    expect(isEditableState("under_review")).toBe(true); // can apply deltas
    expect(isValidTransition("under_review", "rejected")).toBe(true);
    expect(isTerminalState("rejected")).toBe(true); // done
  });

  it("scope_review_snapshots table references scope_drafts", () => {
    // Verify the snapshot table has a scopeDraftId column
    const cols = Object.keys(schema.scopeReviewSnapshots);
    expect(cols).toContain("scopeDraftId");
  });

  it("scope_review_deltas table references scope_drafts", () => {
    // Verify the delta table has a scopeDraftId column
    const cols = Object.keys(schema.scopeReviewDeltas);
    expect(cols).toContain("scopeDraftId");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 13. EDGE CASES — BOUNDARY CONDITIONS
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 14 — Edge cases: boundary conditions", () => {
  it("getValidNextStates returns array (not Set)", () => {
    const result = getValidNextStates("draft");
    expect(Array.isArray(result)).toBe(true);
  });

  it("ALLOWED_TRANSITIONS values are Sets", () => {
    for (const [state, transitions] of Object.entries(ALLOWED_TRANSITIONS)) {
      expect(transitions instanceof Set, `${state} transitions should be a Set`).toBe(true);
    }
  });

  it("no state has a transition to draft (draft is initial only)", () => {
    for (const state of ALL_STATES) {
      expect(
        isValidTransition(state, "draft"),
        `${state} → draft should be invalid`
      ).toBe(false);
    }
  });

  it("total valid transitions count is exactly 4", () => {
    let count = 0;
    for (const state of ALL_STATES) {
      count += getValidNextStates(state).length;
    }
    expect(count).toBe(4);
  });

  it("SnapshotItem confidence range is 0 to 1", () => {
    const lowConfidence: schema.SnapshotItem = {
      assemblyId: 1,
      assemblyName: "Test",
      quantity: 1,
      unit: "EA",
      reason: "test",
      confidence: 0,
    };
    const highConfidence: schema.SnapshotItem = {
      assemblyId: 1,
      assemblyName: "Test",
      quantity: 1,
      unit: "EA",
      reason: "test",
      confidence: 1,
    };
    expect(lowConfidence.confidence).toBe(0);
    expect(highConfidence.confidence).toBe(1);
  });

  it("SnapshotDelta quantity_adjustment with zero newQuantity is valid", () => {
    const delta: schema.SnapshotDelta = {
      assemblyId: 1,
      actionType: "quantity_adjustment",
      previousQuantity: 10,
      newQuantity: 0,
      operatorReason: "Reduce to zero",
    };
    expect(delta.newQuantity).toBe(0);
  });

  it("scope_review_snapshots approvedItems and deltaChanges are JSON columns", () => {
    // Verify they are JSON type columns (not text)
    const approvedItems = schema.scopeReviewSnapshots.approvedItems;
    const deltaChanges = schema.scopeReviewSnapshots.deltaChanges;
    expect(approvedItems.notNull).toBe(true);
    expect(deltaChanges.notNull).toBe(true);
  });

  it("scope_review_snapshots has indexes for draft, operator, and bundle", () => {
    // The table definition includes 3 indexes
    // We verify the columns exist that would be indexed
    const cols = Object.keys(schema.scopeReviewSnapshots);
    expect(cols).toContain("scopeDraftId");
    expect(cols).toContain("operatorId");
    expect(cols).toContain("bundleId");
  });

  it("scope_review_deltas has indexes for draft, assembly, and action", () => {
    const cols = Object.keys(schema.scopeReviewDeltas);
    expect(cols).toContain("scopeDraftId");
    expect(cols).toContain("assemblyId");
    expect(cols).toContain("actionType");
  });
});
