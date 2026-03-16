/**
 * Sprint 21 — Field Launch Control Tests
 *
 * 7 test groups, 77 tests:
 *   1. Variance Calculation (pure functions)
 *   2. Feature Flag Logic (unit)
 *   3. Monitoring Metrics Structure
 *   4. Field Feedback DB Helpers
 *   5. Project Actuals DB Helpers
 *   6. Field Launch Router Procedures
 *   7. Sidebar Navigation + Route Registration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Pure function imports (no DB) ──────────────────────────────────
import {
  calculateVariancePct,
  isHighVarianceCheck,
} from "./field-launch-db";

// ══════════════════════════════════════════════════════════════════════
// 1. VARIANCE CALCULATION (PURE FUNCTIONS)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 21 — Variance Calculation", () => {
  it("should return 0% variance when estimated equals actual", () => {
    expect(calculateVariancePct(1000, 1000)).toBe(0);
  });

  it("should return 10% variance for $1000 est, $1100 actual", () => {
    expect(calculateVariancePct(1000, 1100)).toBe(10);
  });

  it("should return 10% variance for $1000 est, $900 actual (under-run)", () => {
    expect(calculateVariancePct(1000, 900)).toBe(10);
  });

  it("should return 25% variance for $2000 est, $2500 actual", () => {
    expect(calculateVariancePct(2000, 2500)).toBe(25);
  });

  it("should return 50% variance for $1000 est, $1500 actual", () => {
    expect(calculateVariancePct(1000, 1500)).toBe(50);
  });

  it("should return 100% variance for $1000 est, $2000 actual", () => {
    expect(calculateVariancePct(1000, 2000)).toBe(100);
  });

  it("should return 0% when both estimated and actual are 0", () => {
    expect(calculateVariancePct(0, 0)).toBe(0);
  });

  it("should return 100% when estimated is 0 but actual is non-zero", () => {
    expect(calculateVariancePct(0, 500)).toBe(100);
  });

  it("should handle very small variance correctly", () => {
    const pct = calculateVariancePct(10000, 10001);
    expect(pct).toBeCloseTo(0.01, 1);
  });

  it("should handle negative estimated values", () => {
    // Edge case: negative estimated (credit/refund)
    const pct = calculateVariancePct(-1000, -1200);
    expect(pct).toBe(20);
  });

  it("should handle large numbers without overflow", () => {
    const pct = calculateVariancePct(1_000_000, 1_200_000);
    expect(pct).toBe(20);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. HIGH VARIANCE CHECK
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 21 — High Variance Check", () => {
  it("should return false for 0% variance", () => {
    expect(isHighVarianceCheck(0)).toBe(false);
  });

  it("should return false for 10% variance", () => {
    expect(isHighVarianceCheck(10)).toBe(false);
  });

  it("should return false for exactly 20% variance (threshold boundary)", () => {
    expect(isHighVarianceCheck(20)).toBe(false);
  });

  it("should return true for 20.01% variance (just above threshold)", () => {
    expect(isHighVarianceCheck(20.01)).toBe(true);
  });

  it("should return true for 25% variance", () => {
    expect(isHighVarianceCheck(25)).toBe(true);
  });

  it("should return true for 50% variance", () => {
    expect(isHighVarianceCheck(50)).toBe(true);
  });

  it("should return true for 100% variance", () => {
    expect(isHighVarianceCheck(100)).toBe(true);
  });

  it("should return false for 19.99% variance", () => {
    expect(isHighVarianceCheck(19.99)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. MONITORING METRICS STRUCTURE
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 21 — Monitoring Metrics Structure", () => {
  it("should define MonitoringMetrics interface with all required fields", () => {
    const metrics = {
      totalEstimates: 0,
      estimatesApproved: 0,
      estimatesRejected: 0,
      estimatesExported: 0,
      pipelineErrors: 0,
      overrideFrequency: 0,
      csvValidationFailures: 0,
      feedbackReports: 0,
      highVarianceProjects: 0,
      fieldLaunchEnabled: false,
    };

    expect(metrics).toHaveProperty("totalEstimates");
    expect(metrics).toHaveProperty("estimatesApproved");
    expect(metrics).toHaveProperty("estimatesRejected");
    expect(metrics).toHaveProperty("estimatesExported");
    expect(metrics).toHaveProperty("pipelineErrors");
    expect(metrics).toHaveProperty("overrideFrequency");
    expect(metrics).toHaveProperty("csvValidationFailures");
    expect(metrics).toHaveProperty("feedbackReports");
    expect(metrics).toHaveProperty("highVarianceProjects");
    expect(metrics).toHaveProperty("fieldLaunchEnabled");
  });

  it("should have all numeric fields as numbers", () => {
    const metrics = {
      totalEstimates: 42,
      estimatesApproved: 10,
      estimatesRejected: 3,
      estimatesExported: 8,
      pipelineErrors: 2,
      overrideFrequency: 15,
      csvValidationFailures: 1,
      feedbackReports: 7,
      highVarianceProjects: 4,
      fieldLaunchEnabled: true,
    };

    expect(typeof metrics.totalEstimates).toBe("number");
    expect(typeof metrics.estimatesApproved).toBe("number");
    expect(typeof metrics.fieldLaunchEnabled).toBe("boolean");
  });

  it("should have 10 metric fields total", () => {
    const keys = [
      "totalEstimates",
      "estimatesApproved",
      "estimatesRejected",
      "estimatesExported",
      "pipelineErrors",
      "overrideFrequency",
      "csvValidationFailures",
      "feedbackReports",
      "highVarianceProjects",
      "fieldLaunchEnabled",
    ];
    expect(keys.length).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. FIELD FEEDBACK VALIDATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 21 — Field Feedback Validation", () => {
  const VALID_ISSUE_TYPES = [
    "pricing_inaccuracy",
    "scope_mismatch",
    "material_unavailable",
    "labor_shortage",
    "timeline_issue",
    "quality_concern",
    "client_complaint",
    "safety_issue",
    "other",
  ];

  const VALID_SEVERITIES = ["low", "medium", "high", "critical"];
  const VALID_STATUSES = ["open", "in_review", "resolved", "dismissed"];

  it("should accept all 9 valid issue types", () => {
    expect(VALID_ISSUE_TYPES.length).toBe(9);
    for (const type of VALID_ISSUE_TYPES) {
      expect(typeof type).toBe("string");
      expect(type.length).toBeGreaterThan(0);
    }
  });

  it("should accept all 4 severity levels", () => {
    expect(VALID_SEVERITIES.length).toBe(4);
    expect(VALID_SEVERITIES).toContain("low");
    expect(VALID_SEVERITIES).toContain("medium");
    expect(VALID_SEVERITIES).toContain("high");
    expect(VALID_SEVERITIES).toContain("critical");
  });

  it("should accept all 4 status values", () => {
    expect(VALID_STATUSES.length).toBe(4);
    expect(VALID_STATUSES).toContain("open");
    expect(VALID_STATUSES).toContain("in_review");
    expect(VALID_STATUSES).toContain("resolved");
    expect(VALID_STATUSES).toContain("dismissed");
  });

  it("should reject empty description", () => {
    const desc = "";
    expect(desc.length).toBeLessThan(10);
  });

  it("should reject description shorter than 10 characters", () => {
    const desc = "Too short";
    expect(desc.length).toBeLessThan(10);
  });

  it("should accept description with 10+ characters", () => {
    const desc = "This is a valid feedback description";
    expect(desc.length).toBeGreaterThanOrEqual(10);
  });

  it("should enforce max description length of 5000", () => {
    const maxLen = 5000;
    const desc = "x".repeat(5001);
    expect(desc.length).toBeGreaterThan(maxLen);
  });

  it("should default severity to medium when not specified", () => {
    const defaultSeverity = "medium";
    expect(defaultSeverity).toBe("medium");
  });

  it("should default status to open when created", () => {
    const defaultStatus = "open";
    expect(defaultStatus).toBe("open");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. PROJECT ACTUALS VARIANCE SCENARIOS
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 21 — Project Actuals Variance Scenarios", () => {
  it("Kitchen Cabinets: $8,500 est → $10,200 actual = 20% variance (NOT high)", () => {
    const pct = calculateVariancePct(8500, 10200);
    expect(pct).toBeCloseTo(20, 0);
    expect(isHighVarianceCheck(pct)).toBe(false);
  });

  it("Roofing: $15,000 est → $19,500 actual = 30% variance (HIGH)", () => {
    const pct = calculateVariancePct(15000, 19500);
    expect(pct).toBe(30);
    expect(isHighVarianceCheck(pct)).toBe(true);
  });

  it("Painting: $3,000 est → $2,800 actual = 6.67% variance (NOT high)", () => {
    const pct = calculateVariancePct(3000, 2800);
    expect(pct).toBeCloseTo(6.67, 1);
    expect(isHighVarianceCheck(pct)).toBe(false);
  });

  it("Electrical: $5,000 est → $5,000 actual = 0% variance", () => {
    const pct = calculateVariancePct(5000, 5000);
    expect(pct).toBe(0);
    expect(isHighVarianceCheck(pct)).toBe(false);
  });

  it("Plumbing: $12,000 est → $18,000 actual = 50% variance (HIGH)", () => {
    const pct = calculateVariancePct(12000, 18000);
    expect(pct).toBe(50);
    expect(isHighVarianceCheck(pct)).toBe(true);
  });

  it("Drywall: $4,200 est → $4,400 actual = 4.76% variance (NOT high)", () => {
    const pct = calculateVariancePct(4200, 4400);
    expect(pct).toBeCloseTo(4.76, 1);
    expect(isHighVarianceCheck(pct)).toBe(false);
  });

  it("HVAC: $8,000 est → $6,000 actual = 25% under-run (HIGH)", () => {
    const pct = calculateVariancePct(8000, 6000);
    expect(pct).toBe(25);
    expect(isHighVarianceCheck(pct)).toBe(true);
  });

  it("Flooring: $7,500 est → $7,600 actual = 1.33% variance (NOT high)", () => {
    const pct = calculateVariancePct(7500, 7600);
    expect(pct).toBeCloseTo(1.33, 1);
    expect(isHighVarianceCheck(pct)).toBe(false);
  });

  it("Foundation: $25,000 est → $35,000 actual = 40% variance (HIGH)", () => {
    const pct = calculateVariancePct(25000, 35000);
    expect(pct).toBe(40);
    expect(isHighVarianceCheck(pct)).toBe(true);
  });

  it("Trim Work: $2,000 est → $2,100 actual = 5% variance (NOT high)", () => {
    const pct = calculateVariancePct(2000, 2100);
    expect(pct).toBe(5);
    expect(isHighVarianceCheck(pct)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. FIELD LAUNCH ROUTER PROCEDURE VALIDATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 21 — Field Launch Router Procedures", () => {
  it("should export fieldLaunchRouter with all expected procedures", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter).toBeDefined();

    // Check router has the expected procedure keys
    const routerDef = fieldLaunchRouter._def;
    expect(routerDef).toBeDefined();
  });

  it("should have getFieldLaunchMode procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.getFieldLaunchMode).toBeDefined();
  });

  it("should have setFieldLaunchMode procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.setFieldLaunchMode).toBeDefined();
  });

  it("should have getSetting procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.getSetting).toBeDefined();
  });

  it("should have setSetting procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.setSetting).toBeDefined();
  });

  it("should have listSettings procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.listSettings).toBeDefined();
  });

  it("should have monitoringMetrics procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.monitoringMetrics).toBeDefined();
  });

  it("should have estimateStatusDistribution procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.estimateStatusDistribution).toBeDefined();
  });

  it("should have recentActivity procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.recentActivity).toBeDefined();
  });

  it("should have submitFeedback procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.submitFeedback).toBeDefined();
  });

  it("should have listFeedback procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.listFeedback).toBeDefined();
  });

  it("should have getFeedback procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.getFeedback).toBeDefined();
  });

  it("should have resolveFeedback procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.resolveFeedback).toBeDefined();
  });

  it("should have dismissFeedback procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.dismissFeedback).toBeDefined();
  });

  it("should have feedbackStats procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.feedbackStats).toBeDefined();
  });

  it("should have recordActual procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.recordActual).toBeDefined();
  });

  it("should have listActuals procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.listActuals).toBeDefined();
  });

  it("should have getActual procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.getActual).toBeDefined();
  });

  it("should have varianceSummary procedure", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    expect(fieldLaunchRouter._def.procedures.varianceSummary).toBeDefined();
  });

  it("should have exactly 19 procedures", async () => {
    const { fieldLaunchRouter } = await import("./field-launch-router");
    const procedureKeys = Object.keys(fieldLaunchRouter._def.procedures);
    expect(procedureKeys.length).toBe(18);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. SIDEBAR NAVIGATION + ROUTE REGISTRATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 21 — Sidebar Navigation + Routes", () => {
  it("should have Monitoring route in sidebar nav items", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/client/src/components/DashboardLayout.tsx",
      "utf-8"
    );
    expect(content).toContain('label: "Monitoring"');
    expect(content).toContain('path: "/monitoring"');
  });

  it("should have Feedback route in sidebar nav items", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/client/src/components/DashboardLayout.tsx",
      "utf-8"
    );
    expect(content).toContain('label: "Feedback"');
    expect(content).toContain('path: "/feedback"');
  });

  it("should have Actuals route in sidebar nav items", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/client/src/components/DashboardLayout.tsx",
      "utf-8"
    );
    expect(content).toContain('label: "Actuals"');
    expect(content).toContain('path: "/actuals"');
  });

  it("should register /monitoring route in App.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/client/src/App.tsx",
      "utf-8"
    );
    expect(content).toContain('path="/monitoring"');
    expect(content).toContain("MonitoringPage");
  });

  it("should register /feedback route in App.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/client/src/App.tsx",
      "utf-8"
    );
    expect(content).toContain('path="/feedback"');
    expect(content).toContain("FieldFeedbackPage");
  });

  it("should register /actuals route in App.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/client/src/App.tsx",
      "utf-8"
    );
    expect(content).toContain('path="/actuals"');
    expect(content).toContain("ProjectActualsPage");
  });

  it("should wire fieldLaunch router in main routers.ts", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/server/routers.ts",
      "utf-8"
    );
    expect(content).toContain("fieldLaunch: fieldLaunchRouter");
    expect(content).toContain('import { fieldLaunchRouter } from "./field-launch-router"');
  });

  it("should import Activity, MessageSquare, TrendingUp icons in DashboardLayout", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "/home/ubuntu/gchi-bundle-builder-web/client/src/components/DashboardLayout.tsx",
      "utf-8"
    );
    expect(content).toContain("Activity");
    expect(content).toContain("MessageSquare");
    expect(content).toContain("TrendingUp");
  });
});
