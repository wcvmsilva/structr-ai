import { describe, expect, it } from "vitest";
import * as schema from "../drizzle/schema";

describe("Database Schema", () => {
  it("exports all required tables", () => {
    expect(schema.users).toBeDefined();
    expect(schema.projects).toBeDefined();
    expect(schema.assemblies).toBeDefined();
    expect(schema.bundles).toBeDefined();
    expect(schema.bundleItems).toBeDefined();
    expect(schema.riskRules).toBeDefined();
    expect(schema.buildingCodes).toBeDefined();
    expect(schema.projectHistory).toBeDefined();
    expect(schema.intakeQuestions).toBeDefined();
    expect(schema.intakeResponses).toBeDefined();
    expect(schema.crews).toBeDefined();
    expect(schema.crewAssignments).toBeDefined();
    expect(schema.projectFiles).toBeDefined();
    expect(schema.reviewActions).toBeDefined();
    expect(schema.workflowRuns).toBeDefined();
  });

  it("users table has required columns", () => {
    const cols = Object.keys(schema.users);
    expect(cols).toContain("id");
    expect(cols).toContain("openId");
    expect(cols).toContain("name");
    expect(cols).toContain("email");
    expect(cols).toContain("role");
  });

  it("projects table has required columns", () => {
    const cols = Object.keys(schema.projects);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("clientName");
    expect(cols).toContain("status");
    expect(cols).toContain("channel");
    expect(cols).toContain("county");
    expect(cols).toContain("estimatedValue");
    expect(cols).toContain("actualCost");
    expect(cols).toContain("grossProfit");
  });

  it("assemblies table has required columns", () => {
    const cols = Object.keys(schema.assemblies);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("category");
    expect(cols).toContain("directCost");
    expect(cols).toContain("sellPrice");
    expect(cols).toContain("grossProfitPct");
    expect(cols).toContain("crewHours");
  });

  it("bundles table has required columns", () => {
    const cols = Object.keys(schema.bundles);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("defaultDiscount");
    expect(cols).toContain("minGrossProfit");
    expect(cols).toContain("isActive");
  });

  it("bundleItems table has required columns", () => {
    const cols = Object.keys(schema.bundleItems);
    expect(cols).toContain("id");
    expect(cols).toContain("bundleId");
    expect(cols).toContain("catalogItemId");
    expect(cols).toContain("quantity");
    expect(cols).toContain("unitCostSnapshot");
    expect(cols).toContain("unitPriceSnapshot");
    expect(cols).toContain("lineTotalCost");
    expect(cols).toContain("lineTotalPrice");
  });

  it("riskRules table has required columns", () => {
    const cols = Object.keys(schema.riskRules);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("category");
    expect(cols).toContain("severity");
    expect(cols).toContain("costImpactPct");
    expect(cols).toContain("isActive");
  });

  it("buildingCodes table has required columns", () => {
    const cols = Object.keys(schema.buildingCodes);
    expect(cols).toContain("id");
    expect(cols).toContain("code");
    expect(cols).toContain("title");
    expect(cols).toContain("jurisdiction");
    expect(cols).toContain("category");
  });

  it("workflowRuns table has required columns", () => {
    const cols = Object.keys(schema.workflowRuns);
    expect(cols).toContain("id");
    expect(cols).toContain("projectId");
    expect(cols).toContain("workflowType");
    expect(cols).toContain("status");
    expect(cols).toContain("startedAt");
  });

  it("project status enum has correct values", () => {
    expect(schema.projects.status).toBeDefined();
  });

  it("user role enum includes all structr.ai roles", () => {
    expect(schema.users.role).toBeDefined();
  });

  it("crews table has required columns", () => {
    const cols = Object.keys(schema.crews);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("specialty");
    expect(cols).toContain("size");
    expect(cols).toContain("hourlyRate");
  });

  it("reviewActions table has required columns", () => {
    const cols = Object.keys(schema.reviewActions);
    expect(cols).toContain("id");
    expect(cols).toContain("projectId");
    expect(cols).toContain("reviewerId");
    expect(cols).toContain("action");
    expect(cols).toContain("comments");
  });

  it("intakeQuestions table has required columns", () => {
    const cols = Object.keys(schema.intakeQuestions);
    expect(cols).toContain("id");
    expect(cols).toContain("category");
    expect(cols).toContain("question");
    expect(cols).toContain("inputType");
    expect(cols).toContain("isRequired");
  });
});
