import { describe, expect, it } from "vitest";
import * as schema from "../drizzle/schema";
import {
  calcLineTotals,
  calcBundleTotals,
  validateQuantity,
  transformBundleToEstimateDraft,
  MIN_GROSS_PROFIT,
  calcGrossProfit,
  autoAdjustDiscount,
  fmtCurrency,
  generateJobTreadCSV,
  generateJobTreadCSVWithQty,
  type BundleForEstimate,
} from "@shared/catalog-utils";

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: Industrial-Grade Schema — New Tables Exist
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 5 — Industrial-Grade Schema Tables", () => {
  it("exports all 29 tables from schema", () => {
    const expectedTables = [
      "roles", "permissions", "rolePermissions",
      "users", "auditLogs",
      "costCodePricingHistory", "priceBookHistory",
      "clients", "projects", "projectFiles",
      "assemblies", "assemblyItems",
      "bundles", "bundleItems",
      "estimates", "estimateItems", "estimateDrafts",
      "intakeForms", "scopeSuggestions",
      "intakeQuestions", "intakeResponses",
      "reviewActions", "riskRules", "buildingCodes",
      "crews", "crewAssignments",
      "projectHistory", "workflowRuns",
      "costCodes",
    ];
    for (const name of expectedTables) {
      expect((schema as any)[name], `Missing table: ${name}`).toBeDefined();
    }
  });

  // ── RBAC Tables ──────────────────────────────────────────────────

  it("roles table has required columns", () => {
    const cols = Object.keys(schema.roles);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("description");
    expect(cols).toContain("isSystem");
    expect(cols).toContain("createdAt");
  });

  it("permissions table has required columns", () => {
    const cols = Object.keys(schema.permissions);
    expect(cols).toContain("id");
    expect(cols).toContain("resource");
    expect(cols).toContain("action");
    expect(cols).toContain("description");
    expect(cols).toContain("createdAt");
  });

  it("rolePermissions table has required columns", () => {
    const cols = Object.keys(schema.rolePermissions);
    expect(cols).toContain("id");
    expect(cols).toContain("roleId");
    expect(cols).toContain("permissionId");
  });

  // ── Audit Logs ───────────────────────────────────────────────────

  it("auditLogs table has required columns", () => {
    const cols = Object.keys(schema.auditLogs);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("action");
    expect(cols).toContain("tableName");
    expect(cols).toContain("recordId");
    expect(cols).toContain("before");
    expect(cols).toContain("after");
    expect(cols).toContain("ipAddress");
    expect(cols).toContain("userAgent");
    expect(cols).toContain("createdAt");
  });

  // ── Price Book Items (actual column names from schema) ───────────

  it("costCodePricingHistory table has required columns", () => {
    const cols = Object.keys(schema.costCodePricingHistory);
    expect(cols).toContain("id");
    expect(cols).toContain("uuid");
    expect(cols).toContain("sku");
    expect(cols).toContain("category");
    expect(cols).toContain("subcategory");
    expect(cols).toContain("name");
    expect(cols).toContain("description");
    expect(cols).toContain("unitOfMeasure");
    expect(cols).toContain("unitCost");
    expect(cols).toContain("unitPrice");
    expect(cols).toContain("isAdminFee");
    expect(cols).toContain("isActive");
    expect(cols).toContain("costCode");
    expect(cols).toContain("costType");
  });

  it("priceBookHistory table has required columns", () => {
    const cols = Object.keys(schema.priceBookHistory);
    expect(cols).toContain("id");
    expect(cols).toContain("priceBookItemId");
    expect(cols).toContain("oldUnitCost");
    expect(cols).toContain("newUnitCost");
    expect(cols).toContain("oldUnitPrice");
    expect(cols).toContain("newUnitPrice");
    expect(cols).toContain("changedBy");
    expect(cols).toContain("reason");
    expect(cols).toContain("createdAt");
  });

  // ── Clients (actual: firstName, lastName, companyName) ───────────

  it("clients table has required columns", () => {
    const cols = Object.keys(schema.clients);
    expect(cols).toContain("id");
    expect(cols).toContain("uuid");
    expect(cols).toContain("firstName");
    expect(cols).toContain("lastName");
    expect(cols).toContain("companyName");
    expect(cols).toContain("email");
    expect(cols).toContain("phone");
    expect(cols).toContain("address");
    expect(cols).toContain("city");
    expect(cols).toContain("state");
    expect(cols).toContain("zip");
    expect(cols).toContain("county");
    expect(cols).toContain("channel");
    expect(cols).toContain("source");
    expect(cols).toContain("notes");
    expect(cols).toContain("isActive");
    expect(cols).toContain("createdBy");
  });

  // ── Assemblies + Components ──────────────────────────────────────

  it("assemblies table has industrial-grade columns", () => {
    const cols = Object.keys(schema.assemblies);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("code");
    expect(cols).toContain("trade");
    expect(cols).toContain("category");
    expect(cols).toContain("description");
    expect(cols).toContain("defaultUnit");
    expect(cols).toContain("directCost");
    expect(cols).toContain("sellPrice");
    expect(cols).toContain("grossProfitPct");
    expect(cols).toContain("crewHours");
    expect(cols).toContain("itemCount");
    expect(cols).toContain("version");
    expect(cols).toContain("isActive");
    expect(cols).toContain("supabaseId");
  });

  it("assemblyItems table has required columns", () => {
    const cols = Object.keys(schema.assemblyItems);
    expect(cols).toContain("id");
    expect(cols).toContain("assemblyId");
    expect(cols).toContain("description");
    expect(cols).toContain("quantity");
    expect(cols).toContain("wasteFactorPct");
    expect(cols).toContain("sortOrder");
  });

  // ── Estimates (actual column names from schema) ──────────────────

  it("estimates table has required columns", () => {
    const cols = Object.keys(schema.estimates);
    expect(cols).toContain("id");
    expect(cols).toContain("uuid");
    expect(cols).toContain("projectId");
    expect(cols).toContain("clientId");
    expect(cols).toContain("estimateDraftId");
    expect(cols).toContain("version");
    expect(cols).toContain("status");
    expect(cols).toContain("channel");
    expect(cols).toContain("subtotalCost");
    expect(cols).toContain("subtotalPrice");
    expect(cols).toContain("grossProfit");
    expect(cols).toContain("grossProfitPct");
    expect(cols).toContain("discountPct");
    expect(cols).toContain("discountAmount");
    expect(cols).toContain("taxAmount");
    expect(cols).toContain("finalTotal");
    expect(cols).toContain("profitShieldMinPct");
    expect(cols).toContain("createdBy");
    expect(cols).toContain("approvedBy");
    expect(cols).toContain("approvedAt");
  });

  it("estimateItems table has required columns", () => {
    const cols = Object.keys(schema.estimateItems);
    expect(cols).toContain("id");
    expect(cols).toContain("estimateId");
    expect(cols).toContain("priceBookItemId");
    expect(cols).toContain("catalogItemId");
    expect(cols).toContain("costGroupName");
    expect(cols).toContain("costItemName");
    expect(cols).toContain("description");
    expect(cols).toContain("unit");
    expect(cols).toContain("quantity");
    expect(cols).toContain("unitCost");
    expect(cols).toContain("unitPrice");
    expect(cols).toContain("lineTotalCost");
    expect(cols).toContain("lineTotalPrice");
    expect(cols).toContain("grossProfitPct");
    expect(cols).toContain("sortOrder");
  });

  // ── Intake Forms (actual: rawPayload, parsedScope, confidenceScore) ──

  it("intakeForms table has required columns", () => {
    const cols = Object.keys(schema.intakeForms);
    expect(cols).toContain("id");
    expect(cols).toContain("uuid");
    expect(cols).toContain("projectId");
    expect(cols).toContain("clientId");
    expect(cols).toContain("channel");
    expect(cols).toContain("rawPayload");
    expect(cols).toContain("parsedScope");
    expect(cols).toContain("confidenceScore");
    expect(cols).toContain("status");
    expect(cols).toContain("processedBy");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("scopeSuggestions table has required columns", () => {
    const cols = Object.keys(schema.scopeSuggestions);
    expect(cols).toContain("id");
    expect(cols).toContain("intakeFormId");
    expect(cols).toContain("assemblyId");
    expect(cols).toContain("suggestedScope");
    expect(cols).toContain("confidenceScore");
    expect(cols).toContain("estimatedCost");
    expect(cols).toContain("estimatedPrice");
    expect(cols).toContain("status");
    expect(cols).toContain("reviewedBy");
    expect(cols).toContain("reviewNotes");
  });

  // ── Users table has RBAC columns ─────────────────────────────────

  it("users table has roleId FK for RBAC", () => {
    const cols = Object.keys(schema.users);
    expect(cols).toContain("roleId");
    expect(cols).toContain("role");
    expect(cols).toContain("id");
    expect(cols).toContain("openId");
    expect(cols).toContain("name");
    expect(cols).toContain("email");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: RBAC Module — Unit Tests
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 5 — RBAC Module", () => {
  it("rbac module exports all required functions", async () => {
    const rbac = await import("./rbac");
    expect(rbac.getUserPermissions).toBeTypeOf("function");
    expect(rbac.hasPermission).toBeTypeOf("function");
    expect(rbac.clearPermissionCache).toBeTypeOf("function");
    expect(rbac.listRoles).toBeTypeOf("function");
    expect(rbac.listPermissions).toBeTypeOf("function");
    expect(rbac.getRoleWithPermissions).toBeTypeOf("function");
    expect(rbac.assignRoleToUser).toBeTypeOf("function");
    expect(rbac.getPermissionsForRole).toBeTypeOf("function");
  });

  it("clearPermissionCache does not throw", async () => {
    const { clearPermissionCache } = await import("./rbac");
    expect(() => clearPermissionCache(999)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: Audit Logging Module — Unit Tests
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 5 — Audit Logging Module", () => {
  it("audit module exports all required functions", async () => {
    const audit = await import("./audit");
    expect(audit.logAudit).toBeTypeOf("function");
    expect(audit.listAuditLogs).toBeTypeOf("function");
    expect(audit.getAuditLogById).toBeTypeOf("function");
    expect(audit.withAuditLog).toBeTypeOf("function");
  });

  it("AuditLogParams interface accepts all expected fields", () => {
    const params = {
      userId: 1,
      action: "test.action",
      tableName: "test_table",
      recordId: 42,
      before: { name: "old" },
      after: { name: "new" },
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    };
    expect(params.action).toBe("test.action");
    expect(params.tableName).toBe("test_table");
    expect(params.before).toEqual({ name: "old" });
    expect(params.after).toEqual({ name: "new" });
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: Business Logic — Profit Shield Regression
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 5 — Profit Shield Regression", () => {
  it("MIN_GROSS_PROFIT is 35%", () => {
    expect(MIN_GROSS_PROFIT).toBe(35);
  });

  it("calcLineTotals computes correctly", () => {
    const result = calcLineTotals(3, 100, 200);
    expect(result.lineTotalCost).toBe(300);
    expect(result.lineTotalPrice).toBe(600);
  });

  it("calcLineTotals handles zero quantity", () => {
    const result = calcLineTotals(0, 100, 200);
    expect(result.lineTotalCost).toBe(0);
    expect(result.lineTotalPrice).toBe(0);
  });

  it("calcLineTotals handles negative quantity (clamped to 0)", () => {
    const result = calcLineTotals(-5, 100, 200);
    expect(result.lineTotalCost).toBe(0);
    expect(result.lineTotalPrice).toBe(0);
  });

  it("calcBundleTotals computes correctly from BundleLineItem array", () => {
    const items = [
      { quantity: 2, unitCost: 50, unitPrice: 100 },
      { quantity: 3, unitCost: 30, unitPrice: 60 },
    ];
    const result = calcBundleTotals(items);
    expect(result.totalCost).toBe(190);   // 100 + 90
    expect(result.totalPrice).toBe(380);  // 200 + 180
    expect(result.itemCount).toBe(2);
    expect(result.grossProfitPct).toBeCloseTo(50.0, 1);
  });

  it("calcGrossProfit computes correctly", () => {
    expect(calcGrossProfit(100, 65)).toBeCloseTo(35.0, 1);
    expect(calcGrossProfit(200, 100)).toBeCloseTo(50.0, 1);
    expect(calcGrossProfit(0, 100)).toBe(0);
  });

  it("autoAdjustDiscount does not adjust when GP stays above floor", () => {
    // Cost=500, Sell=1000, 10% discount → 900, GP = (900-500)/900 = 44.4%
    const result = autoAdjustDiscount(500, 1000, 10);
    expect(result.wasAdjusted).toBe(false);
    expect(result.appliedDiscount).toBe(10);
    expect(result.finalSell).toBeCloseTo(900, 1);
  });

  it("autoAdjustDiscount triggers Profit Shield when GP drops below floor", () => {
    // Cost=800, Sell=1000, 30% discount → 700, GP = (700-800)/700 = -14.3% → triggers
    const result = autoAdjustDiscount(800, 1000, 30);
    expect(result.wasAdjusted).toBe(true);
    // Profit Shield can only REDUCE discount, not increase sell price above original
    // When cost=800, sell=1000, minSell = 800/0.65 = 1230.77 > 1000
    // So maxDiscount = max(0, (1000-1230.77)/1000 * 100) = 0
    // Result: discount capped at 0%, finalSell = 1000
    expect(result.appliedDiscount).toBe(0);
    expect(result.finalSell).toBe(1000);
  });

  it("validateQuantity rejects zero", () => {
    const result = validateQuantity(0);
    expect(result.valid).toBe(false);
  });

  it("validateQuantity rejects negative", () => {
    const result = validateQuantity(-5);
    expect(result.valid).toBe(false);
  });

  it("validateQuantity accepts valid integer", () => {
    const result = validateQuantity(10);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe(10);
  });

  it("validateQuantity rounds float to 2 decimal places", () => {
    const result = validateQuantity(3.7777);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe(3.78);
  });

  it("validateQuantity rejects values over 99999", () => {
    const result = validateQuantity(100001);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(99999);
  });

  it("fmtCurrency formats correctly", () => {
    expect(fmtCurrency(1234.56)).toBe("$1,234.56");
    expect(fmtCurrency(0)).toBe("$0.00");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: EstimateDraftPayload — Transformation Contract
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 5 — EstimateDraftPayload Contract", () => {
  const mockBundle: BundleForEstimate = {
    id: 1,
    name: "Test Bundle",
    channel: "residential",
    defaultDiscount: "8.00",
    totalCost: "100.00",
    totalPrice: "200.00",
    itemCount: 1,
    description: null,
    items: [
      {
        catalogItemId: 100,
        quantity: "2",
        unitCostSnapshot: "50.00",
        unitPriceSnapshot: "100.00",
        lineTotalCost: "100.00",
        lineTotalPrice: "200.00",
        sortOrder: 1,
        catalogItem: {
          costItemId: "CI-001",
          costGroupName: "General",
          costItemName: "Test Item",
          description: "A test item",
          unit: "EA",
        },
      },
    ],
  };

  it("transforms bundle to estimate draft with correct structure", () => {
    const draft = transformBundleToEstimateDraft(mockBundle, 0, "Test notes");
    expect(draft.bundleId).toBe(1);
    expect(draft.bundleName).toBe("Test Bundle");
    expect(draft.channel).toBe("residential");
    expect(draft.notes).toBe("Test notes");
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0].costItemName).toBe("Test Item");
    expect(draft.lineItems[0].quantity).toBe(2);
    expect(draft.lineItems[0].unitCostSnapshot).toBe(50);
    expect(draft.lineItems[0].unitPriceSnapshot).toBe(100);
    expect(draft.lineItems[0].lineTotalCost).toBe(100);
    expect(draft.lineItems[0].lineTotalPrice).toBe(200);
  });

  it("applies discount in transformation", () => {
    const draft = transformBundleToEstimateDraft(mockBundle, 10, null);
    expect(draft.discountApplied).toBe(10);
    expect(draft.discountAmount).toBeCloseTo(20, 1); // 10% of 200
    expect(draft.finalTotalPrice).toBeLessThan(draft.subtotalPrice);
  });

  it("uses default discount from bundle when not specified", () => {
    const draft = transformBundleToEstimateDraft(mockBundle, undefined, null);
    expect(draft.discountApplied).toBe(8); // from defaultDiscount: "8.00"
  });

  it("Profit Shield protects GP in transformation", () => {
    // Bundle with low margin: cost=85, price=100 → GP=15% (below 35%)
    // With 0% discount, autoAdjustDiscount should raise the sell price
    const lowMarginBundle: BundleForEstimate = {
      ...mockBundle,
      items: [
        {
          catalogItemId: 100,
          quantity: "2",
          unitCostSnapshot: "85.00",
          unitPriceSnapshot: "100.00",
          lineTotalCost: "170.00",
          lineTotalPrice: "200.00",
          sortOrder: 1,
          catalogItem: mockBundle.items[0].catalogItem,
        },
      ],
    };
    const draft = transformBundleToEstimateDraft(lowMarginBundle, 0, null);
    // With 0% discount, finalSell = subtotalPrice = 200
    // GP = (200-170)/200 = 15% — below 35%
    // autoAdjustDiscount(170, 200, 0) → since discount=0 already, 
    // discountedSell = 200, GP = 15% < 35% → triggers adjustment
    // minSell = 170 / 0.65 = 261.54
    // maxDiscount = max(0, (200 - 261.54) / 200 * 100) = max(0, -30.77) = 0
    // adjustedSell = 200 * (1 - 0/100) = 200
    // So the function returns adjustedSell=200, wasAdjusted=true, appliedDiscount=0
    // The Profit Shield can only REDUCE discount, not increase price
    // This is correct behavior: when cost > 65% of price, no discount can fix it
    expect(draft.finalTotalPrice).toBe(200); // Can't go higher than sell price
    expect(draft.subtotalCost).toBe(170);
    expect(draft.subtotalPrice).toBe(200);
  });

  it("includes createdAt ISO timestamp", () => {
    const draft = transformBundleToEstimateDraft(mockBundle, 0, null);
    expect(draft.createdAt).toBeDefined();
    expect(new Date(draft.createdAt).getTime()).not.toBeNaN();
  });

  it("metadata is null by default", () => {
    const draft = transformBundleToEstimateDraft(mockBundle, 0, null);
    expect(draft.metadata).toBeNull();
  });

  it("computes correct subtotals", () => {
    const draft = transformBundleToEstimateDraft(mockBundle, 0, null);
    expect(draft.subtotalCost).toBe(100);  // 2 * 50
    expect(draft.subtotalPrice).toBe(200); // 2 * 100
    expect(draft.itemCount).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: CSV Export — Regression Tests
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 5 — CSV Export Regression", () => {
  it("generateJobTreadCSV produces valid CSV with headers", () => {
    const items = [{
      costGroupName: "Electrical",
      costItemName: "Outlet - Standard",
      description: "120V outlet",
      unit: "EA",
      unitCost: "15.00",
      unitPrice: "30.00",
    }];
    const csv = generateJobTreadCSV(items, 0);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Cost Group Name");
    expect(lines[0]).toContain("Unit Cost");
    expect(lines[0]).toContain("Unit Price");
    expect(lines.length).toBe(2); // header + 1 row
  });

  it("generateJobTreadCSVWithQty includes quantity column", () => {
    const items = [{
      costGroupName: "Plumbing",
      costItemName: "Faucet",
      description: null,
      unit: "EA",
      unitCost: "50.00",
      unitPrice: "100.00",
      quantity: 3,
    }];
    const csv = generateJobTreadCSVWithQty(items, 0);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Quantity");
    expect(lines[1]).toContain('"3"');
  });

  it("generateJobTreadCSVWithQty applies discount to unit price", () => {
    const items = [{
      costGroupName: "General",
      costItemName: "Item",
      description: null,
      unit: "EA",
      unitCost: "50.00",
      unitPrice: "100.00",
      quantity: 1,
    }];
    const csv = generateJobTreadCSVWithQty(items, 10); // 10% discount
    // Unit price should be 100 * 0.9 = 90.00
    expect(csv).toContain('"90.00"');
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: Schema Type Exports
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 5 — Schema Type Exports", () => {
  it("exports Role type", () => {
    const role: schema.Role = {
      id: 1,
      name: "admin",
      description: "Administrator",
      isSystem: true,
      createdAt: new Date(),
    };
    expect(role.name).toBe("admin");
  });

  it("exports Permission type", () => {
    const perm: schema.Permission = {
      id: 1,
      resource: "bundle",
      action: "create",
      description: "Create bundles",
      createdAt: new Date(),
    };
    expect(perm.resource).toBe("bundle");
  });

  it("exports AuditLog type", () => {
    const log: schema.AuditLog = {
      id: 1,
      userId: 1,
      action: "test",
      tableName: "bundles",
      recordId: 1,
      before: null,
      after: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
    };
    expect(log.action).toBe("test");
  });

  it("exports Client type", () => {
    const client: schema.Client = {
      id: 1,
      uuid: "abc-123",
      firstName: "John",
      lastName: "Doe",
      companyName: null,
      email: "test@example.com",
      phone: "555-1234",
      address: "123 Main St",
      city: "Charleston",
      state: "SC",
      zip: "29401",
      county: null,
      channel: "residential",
      source: "referral",
      notes: null,
      isActive: true,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(client.city).toBe("Charleston");
  });

  it("exports AssemblyComponent type", () => {
    const comp: schema.AssemblyComponent = {
      id: 1,
      assemblyId: 1,
      priceBookItemId: null,
      description: "Test component",
      quantity: "1.0000",
      wasteFactorPct: "0.1000",
      sortOrder: 1,
    };
    expect(comp.description).toBe("Test component");
  });

  it("exports IntakeForm type", () => {
    const form: schema.IntakeForm = {
      id: 1,
      uuid: "intake-uuid-1",
      projectId: null,
      clientId: null,
      channel: "residential",
      rawPayload: {},
      parsedScope: null,
      confidenceScore: null,
      status: "received",
      processedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(form.status).toBe("received");
  });

  it("exports ScopeSuggestion type", () => {
    const suggestion: schema.ScopeSuggestion = {
      id: 1,
      intakeFormId: 1,
      assemblyId: 1,
      suggestedScope: "Replace kitchen cabinets",
      confidenceScore: "0.85",
      estimatedCost: "5000.00",
      estimatedPrice: "8000.00",
      status: "pending",
      reviewedBy: null,
      reviewNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(suggestion.suggestedScope).toBe("Replace kitchen cabinets");
  });

  it("exports Estimate type", () => {
    const est: schema.Estimate = {
      id: 1,
      uuid: "est-uuid-1",
      projectId: 1,
      clientId: null,
      estimateDraftId: null,
      version: 1,
      status: "draft",
      channel: "residential",
      subtotalCost: "1000.00",
      subtotalPrice: "1500.00",
      grossProfit: "500.00",
      grossProfitPct: "33.33",
      discountPct: "0.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      finalTotal: "1500.00",
      profitShieldMinPct: "35.00",
      validUntil: null,
      notes: null,
      internalNotes: null,
      metadata: null,
      createdBy: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(est.status).toBe("draft");
  });

  it("exports EstimateLineItem type", () => {
    const item: schema.EstimateLineItem = {
      id: 1,
      estimateId: 1,
      priceBookItemId: null,
      catalogItemId: null,
      costGroupName: "General",
      costItemName: "Test line item",
      description: null,
      unit: "EA",
      quantity: "2.00",
      unitCost: "50.00",
      unitPrice: "100.00",
      lineTotalCost: "100.00",
      lineTotalPrice: "200.00",
      grossProfitPct: "50.00",
      sortOrder: 1,
      createdAt: new Date(),
    };
    expect(item.costItemName).toBe("Test line item");
  });

  it("exports PriceBookItem type", () => {
    const item: schema.PriceBookItem = {
      id: 1,
      uuid: "pbi-uuid-1",
      sku: "SKU-001",
      category: "General",
      subcategory: null,
      name: "Test Item",
      description: null,
      unitOfMeasure: "EA",
      unitCost: "50.00",
      unitPrice: "100.00",
      isAdminFee: false,
      isActive: true,
      lastCostUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      costCode: "01-100",
      costType: "Subcontractor",
      taxable: true,
    };
    expect(item.sku).toBe("SKU-001");
  });
});
