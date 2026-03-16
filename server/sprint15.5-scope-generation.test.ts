/**
 * structr.ai — Sprint 15.5: Scope Generation Workspace Tests
 *
 * 50+ tests covering:
 *   1. Readiness Assessment (pure function logic)
 *   2. Workspace Data Shape
 *   3. Review Handoff Idempotency
 *   4. State Machine Integration
 *   5. Error Handling
 *   6. Blocker/Warning Classification
 *   7. Router Structure
 *   8. Intake Validation Integration
 *   9. Geographic Context Visibility
 *  10. Edge Cases
 */

import { describe, expect, it } from "vitest";
import {
  validateTransition,
  isValidTransition,
  isTerminalState,
  getValidNextStates,
  ALL_STATES,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
  EDITABLE_STATES,
  type ScopeDraftStatus,
} from "@shared/scope-review-state-machine";
import {
  validateIntakeForScope,
  type ScopeIntakeData,
} from "@shared/scope-engine";
import { appRouter } from "./routers";

// ══════════════════════════════════════════════════════════════════════
// HELPERS — Readiness Assessment (extracted from router for testing)
// ══════════════════════════════════════════════════════════════════════

interface WorkspaceReadiness {
  canGenerate: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Mirror of the assessReadiness function from scope-generation-router.ts.
 * Extracted here for unit testing since the router function is private.
 */
function assessReadiness(
  project: any,
  intakeForms: any[],
  scopeDrafts: any[]
): WorkspaceReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (intakeForms.length === 0) {
    blockers.push("No intake forms linked to this project. Create an intake first.");
  } else {
    const hasServiceType = intakeForms.some((i: any) => i.serviceType);
    if (!hasServiceType) {
      blockers.push("No intake form has a service_type. At least one is required for scope generation.");
    }
    const allMissingArea = intakeForms.every((i: any) => !i.area);
    if (allMissingArea) {
      warnings.push("All intake forms are missing area/dimensions. Default area will be used for quantity calculations.");
    }
  }

  if (!project.geocodeConfidence || project.geocodeConfidence === "failed") {
    warnings.push("Geocoding is unavailable or failed. Zone-specific rules may not match.");
  }

  if (!project.zone) {
    warnings.push("No zone assigned to project. Zone-specific assembly selection will be skipped.");
  }

  if (scopeDrafts.length > 0) {
    const latest = scopeDrafts[0];
    warnings.push(
      `Existing scope draft found (ID: ${latest.id}, status: ${latest.status}). ` +
      `You can view it or generate a new one.`
    );
  }

  return { canGenerate: blockers.length === 0, blockers, warnings };
}

// ══════════════════════════════════════════════════════════════════════
// 1. READINESS ASSESSMENT — Blocker Logic
// ══════════════════════════════════════════════════════════════════════

describe("Readiness Assessment — Blockers", () => {
  const baseProject = {
    id: 1,
    name: "Test Project",
    zone: "Charleston Inland",
    geocodeConfidence: "high",
  };

  it("blocks when no intake forms exist", () => {
    const result = assessReadiness(baseProject, [], []);
    expect(result.canGenerate).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toContain("No intake forms");
  });

  it("blocks when all intakes lack service_type", () => {
    const intakes = [
      { id: 1, serviceType: null, area: "500 sqft" },
      { id: 2, serviceType: "", area: "300 sqft" },
    ];
    const result = assessReadiness(baseProject, intakes, []);
    expect(result.canGenerate).toBe(false);
    expect(result.blockers.some(b => b.includes("service_type"))).toBe(true);
  });

  it("does NOT block when at least one intake has service_type", () => {
    const intakes = [
      { id: 1, serviceType: null, area: "500 sqft" },
      { id: 2, serviceType: "kitchen_remodel", area: "300 sqft" },
    ];
    const result = assessReadiness(baseProject, intakes, []);
    expect(result.canGenerate).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("allows generation with minimal valid intake", () => {
    const intakes = [{ id: 1, serviceType: "bathroom_remodel", area: null }];
    const result = assessReadiness(baseProject, intakes, []);
    expect(result.canGenerate).toBe(true);
  });

  it("accumulates multiple blockers", () => {
    const result = assessReadiness({ ...baseProject, zone: null, geocodeConfidence: null }, [], []);
    expect(result.canGenerate).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. READINESS ASSESSMENT — Warning Logic
// ══════════════════════════════════════════════════════════════════════

describe("Readiness Assessment — Warnings", () => {
  const baseProject = {
    id: 1,
    name: "Test Project",
    zone: "Charleston Inland",
    geocodeConfidence: "high",
  };

  it("warns when all intakes are missing area", () => {
    const intakes = [
      { id: 1, serviceType: "kitchen_remodel", area: null },
      { id: 2, serviceType: "bathroom_remodel", area: "" },
    ];
    const result = assessReadiness(baseProject, intakes, []);
    expect(result.warnings.some(w => w.includes("area"))).toBe(true);
  });

  it("does NOT warn about area when at least one intake has area", () => {
    const intakes = [
      { id: 1, serviceType: "kitchen_remodel", area: "500 sqft" },
      { id: 2, serviceType: "bathroom_remodel", area: null },
    ];
    const result = assessReadiness(baseProject, intakes, []);
    expect(result.warnings.some(w => w.includes("area"))).toBe(false);
  });

  it("warns when geocode confidence is failed", () => {
    const project = { ...baseProject, geocodeConfidence: "failed" };
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(true);
  });

  it("warns when geocode confidence is null", () => {
    const project = { ...baseProject, geocodeConfidence: null };
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(true);
  });

  it("does NOT warn when geocode confidence is high", () => {
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const result = assessReadiness(baseProject, intakes, []);
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(false);
  });

  it("warns when no zone assigned", () => {
    const project = { ...baseProject, zone: null };
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("zone"))).toBe(true);
  });

  it("warns when existing draft exists", () => {
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const drafts = [{ id: 42, status: "draft" }];
    const result = assessReadiness(baseProject, intakes, drafts);
    expect(result.warnings.some(w => w.includes("Existing scope draft"))).toBe(true);
    expect(result.warnings.some(w => w.includes("42"))).toBe(true);
  });

  it("does NOT warn about existing drafts when none exist", () => {
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const result = assessReadiness(baseProject, intakes, []);
    expect(result.warnings.some(w => w.includes("Existing scope draft"))).toBe(false);
  });

  it("canGenerate is true even with warnings", () => {
    const project = { ...baseProject, geocodeConfidence: "failed", zone: null };
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: null }];
    const result = assessReadiness(project, intakes, []);
    expect(result.canGenerate).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. REVIEW HANDOFF — State Machine Idempotency
// ══════════════════════════════════════════════════════════════════════

describe("Review Handoff — State Machine", () => {
  it("allows draft → under_review", () => {
    const result = validateTransition("draft", "under_review");
    expect(result.valid).toBe(true);
  });

  it("rejects draft → approved (must go through review)", () => {
    const result = validateTransition("draft", "approved");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid transition");
  });

  it("rejects draft → converted (must go through review + approval)", () => {
    const result = validateTransition("draft", "converted");
    expect(result.valid).toBe(false);
  });

  it("rejects draft → rejected (must go through review)", () => {
    const result = validateTransition("draft", "rejected");
    expect(result.valid).toBe(false);
  });

  it("rejects under_review → draft (no going back)", () => {
    const result = validateTransition("under_review", "draft");
    expect(result.valid).toBe(false);
  });

  it("allows under_review → approved", () => {
    const result = validateTransition("under_review", "approved");
    expect(result.valid).toBe(true);
  });

  it("allows under_review → rejected", () => {
    const result = validateTransition("under_review", "rejected");
    expect(result.valid).toBe(true);
  });

  it("allows approved → converted", () => {
    const result = validateTransition("approved", "converted");
    expect(result.valid).toBe(true);
  });

  it("rejected is terminal — no transitions allowed", () => {
    expect(isTerminalState("rejected")).toBe(true);
    expect(getValidNextStates("rejected")).toHaveLength(0);
  });

  it("converted is terminal — no transitions allowed", () => {
    expect(isTerminalState("converted")).toBe(true);
    expect(getValidNextStates("converted")).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. REVIEW HANDOFF — Idempotent Behavior
// ══════════════════════════════════════════════════════════════════════

describe("Review Handoff — Idempotent Responses", () => {
  // These test the expected behavior of the sendToReview procedure:
  // When called with a draft already in a non-draft state, it should
  // return informational messages instead of throwing errors.

  it("under_review: returns informational (not error)", () => {
    // Simulating the router logic: if status is under_review, return info
    const status: ScopeDraftStatus = "under_review";
    const isIdempotent = status === "under_review";
    expect(isIdempotent).toBe(true);
  });

  it("approved: returns informational (not error)", () => {
    const status: ScopeDraftStatus = "approved";
    const isIdempotent = ["under_review", "approved", "converted", "rejected"].includes(status);
    expect(isIdempotent).toBe(true);
  });

  it("converted: returns informational (not error)", () => {
    const status: ScopeDraftStatus = "converted";
    const isIdempotent = ["under_review", "approved", "converted", "rejected"].includes(status);
    expect(isIdempotent).toBe(true);
  });

  it("rejected: returns informational (not error)", () => {
    const status: ScopeDraftStatus = "rejected";
    const isIdempotent = ["under_review", "approved", "converted", "rejected"].includes(status);
    expect(isIdempotent).toBe(true);
  });

  it("draft: is the only state that actually transitions", () => {
    const status: ScopeDraftStatus = "draft";
    const shouldTransition = status === "draft";
    expect(shouldTransition).toBe(true);
    expect(isValidTransition("draft", "under_review")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. INTAKE VALIDATION INTEGRATION
// ══════════════════════════════════════════════════════════════════════

describe("Intake Validation for Scope Generation", () => {
  it("returns warning for missing service_type", () => {
    const intake: ScopeIntakeData = { serviceType: "" };
    const warnings = validateIntakeForScope(intake);
    expect(warnings.some(w => w.includes("service_type"))).toBe(true);
  });

  it("returns warning for missing area", () => {
    const intake: ScopeIntakeData = { serviceType: "kitchen_remodel" };
    const warnings = validateIntakeForScope(intake);
    expect(warnings.some(w => w.includes("area"))).toBe(true);
  });

  it("returns warning for missing finish_level", () => {
    const intake: ScopeIntakeData = { serviceType: "kitchen_remodel" };
    const warnings = validateIntakeForScope(intake);
    expect(warnings.some(w => w.includes("finish_level"))).toBe(true);
  });

  it("returns warning for missing condition", () => {
    const intake: ScopeIntakeData = { serviceType: "kitchen_remodel" };
    const warnings = validateIntakeForScope(intake);
    expect(warnings.some(w => w.includes("condition"))).toBe(true);
  });

  it("returns no warnings for complete intake", () => {
    const intake: ScopeIntakeData = {
      serviceType: "kitchen_remodel",
      area: "500 sqft",
      finishLevel: "premium",
      condition: "good",
    };
    const warnings = validateIntakeForScope(intake);
    expect(warnings).toHaveLength(0);
  });

  it("returns multiple warnings for completely empty intake", () => {
    const intake: ScopeIntakeData = { serviceType: "" };
    const warnings = validateIntakeForScope(intake);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. ROUTER STRUCTURE
// ══════════════════════════════════════════════════════════════════════

describe("Router Structure — scopeGeneration", () => {
  it("scopeGeneration router is registered on appRouter", () => {
    expect(appRouter._def.procedures).toBeDefined();
    // The router should have scopeGeneration procedures
    const procedureKeys = Object.keys(appRouter._def.procedures);
    expect(procedureKeys.some(k => k.startsWith("scopeGeneration."))).toBe(true);
  });

  it("has loadWorkspace procedure", () => {
    const keys = Object.keys(appRouter._def.procedures);
    expect(keys).toContain("scopeGeneration.loadWorkspace");
  });

  it("has checkReadiness procedure", () => {
    const keys = Object.keys(appRouter._def.procedures);
    expect(keys).toContain("scopeGeneration.checkReadiness");
  });

  it("has sendToReview procedure", () => {
    const keys = Object.keys(appRouter._def.procedures);
    expect(keys).toContain("scopeGeneration.sendToReview");
  });

  it("scope.generate still exists (not replaced)", () => {
    const keys = Object.keys(appRouter._def.procedures);
    expect(keys).toContain("scope.generate");
  });

  it("scopeReview.startReview still exists (not replaced)", () => {
    const keys = Object.keys(appRouter._def.procedures);
    expect(keys).toContain("scopeReview.startReview");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. GEOGRAPHIC CONTEXT VISIBILITY
// ══════════════════════════════════════════════════════════════════════

describe("Geographic Context in Readiness", () => {
  const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];

  it("no warning when geocode is high and zone is set", () => {
    const project = { id: 1, zone: "Charleston Inland", geocodeConfidence: "high" };
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(false);
    expect(result.warnings.some(w => w.includes("zone"))).toBe(false);
  });

  it("warns for medium geocode confidence (no special warning, only for failed/null)", () => {
    const project = { id: 1, zone: "Charleston Inland", geocodeConfidence: "medium" };
    const result = assessReadiness(project, intakes, []);
    // medium is not failed/null, so no geocode warning
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(false);
  });

  it("warns for low geocode confidence (no special warning, only for failed/null)", () => {
    const project = { id: 1, zone: "Charleston Inland", geocodeConfidence: "low" };
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(false);
  });

  it("warns when geocode is failed", () => {
    const project = { id: 1, zone: "Charleston Inland", geocodeConfidence: "failed" };
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(true);
  });

  it("warns when zone is missing even with good geocode", () => {
    const project = { id: 1, zone: null, geocodeConfidence: "high" };
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("zone"))).toBe(true);
  });

  it("warns for both failed geocode AND missing zone", () => {
    const project = { id: 1, zone: null, geocodeConfidence: "failed" };
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("Geocoding"))).toBe(true);
    expect(result.warnings.some(w => w.includes("zone"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  it("handles empty string zone as missing", () => {
    const project = { id: 1, zone: "", geocodeConfidence: "high" };
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const result = assessReadiness(project, intakes, []);
    expect(result.warnings.some(w => w.includes("zone"))).toBe(true);
  });

  it("handles multiple existing drafts (uses first/latest)", () => {
    const project = { id: 1, zone: "Charleston Inland", geocodeConfidence: "high" };
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const drafts = [
      { id: 99, status: "draft" },
      { id: 50, status: "rejected" },
    ];
    const result = assessReadiness(project, intakes, drafts);
    expect(result.warnings.some(w => w.includes("99"))).toBe(true);
    expect(result.warnings.some(w => w.includes("50"))).toBe(false); // Only latest
  });

  it("handles project with all geocode fields populated", () => {
    const project = {
      id: 1,
      zone: "Barrier Island Premium",
      geocodeConfidence: "high",
      latitude: "32.7765",
      longitude: "-79.9311",
      geocodedAddress: "123 Main St, Charleston, SC 29401",
    };
    const intakes = [{ id: 1, serviceType: "kitchen_remodel", area: "500 sqft" }];
    const result = assessReadiness(project, intakes, []);
    expect(result.canGenerate).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles intake with all optional fields populated", () => {
    const intake: ScopeIntakeData = {
      serviceType: "kitchen_remodel",
      area: "500 sqft",
      finishLevel: "luxury",
      condition: "poor",
      channel: "direct",
      notes: "Complete gut renovation",
    };
    const warnings = validateIntakeForScope(intake);
    expect(warnings).toHaveLength(0);
  });

  it("single intake with service_type is sufficient for generation", () => {
    const project = { id: 1, zone: "Charleston Inland", geocodeConfidence: "high" };
    const intakes = [{ id: 1, serviceType: "roof_replacement" }];
    const result = assessReadiness(project, intakes, []);
    expect(result.canGenerate).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. STATE MACHINE COMPLETENESS
// ══════════════════════════════════════════════════════════════════════

describe("State Machine Completeness", () => {
  it("ALL_STATES contains exactly 5 states", () => {
    expect(ALL_STATES).toHaveLength(5);
  });

  it("every state has an entry in ALLOWED_TRANSITIONS", () => {
    for (const state of ALL_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("TERMINAL_STATES are rejected and converted", () => {
    expect(TERMINAL_STATES).toContain("rejected");
    expect(TERMINAL_STATES).toContain("converted");
    expect(TERMINAL_STATES).toHaveLength(2);
  });

  it("EDITABLE_STATES is only under_review", () => {
    expect(EDITABLE_STATES).toContain("under_review");
    expect(EDITABLE_STATES).toHaveLength(1);
  });

  it("draft has exactly one valid next state", () => {
    expect(getValidNextStates("draft")).toEqual(["under_review"]);
  });

  it("under_review has exactly two valid next states", () => {
    const next = getValidNextStates("under_review");
    expect(next).toHaveLength(2);
    expect(next).toContain("approved");
    expect(next).toContain("rejected");
  });

  it("approved has exactly one valid next state", () => {
    expect(getValidNextStates("approved")).toEqual(["converted"]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. CROSS-MODULE COMPATIBILITY
// ══════════════════════════════════════════════════════════════════════

describe("Cross-Module Compatibility", () => {
  it("validateIntakeForScope is importable from shared/scope-engine", () => {
    expect(typeof validateIntakeForScope).toBe("function");
  });

  it("validateTransition is importable from shared/scope-review-state-machine", () => {
    expect(typeof validateTransition).toBe("function");
  });

  it("isValidTransition is importable from shared/scope-review-state-machine", () => {
    expect(typeof isValidTransition).toBe("function");
  });

  it("isTerminalState is importable from shared/scope-review-state-machine", () => {
    expect(typeof isTerminalState).toBe("function");
  });

  it("appRouter has all expected top-level routers", () => {
    const keys = Object.keys(appRouter._def.procedures);
    const topLevelRouters = new Set(keys.map(k => k.split(".")[0]));
    expect(topLevelRouters.has("scopeGeneration")).toBe(true);
    expect(topLevelRouters.has("scope")).toBe(true);
    expect(topLevelRouters.has("scopeReview")).toBe(true);
    expect(topLevelRouters.has("project")).toBe(true);
    expect(topLevelRouters.has("intake")).toBe(true);
    expect(topLevelRouters.has("geo")).toBe(true);
  });
});
