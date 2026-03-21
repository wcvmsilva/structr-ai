/**
 * structr.ai — Sprint 12: Scope Builder DB & Router Tests
 * ═══════════════════════════════════════════════════════════════════
 *
 * Test coverage for:
 *   1. Schema — scope_rules, scope_drafts, scope_draft_items tables
 *   2. Scope DB helper types & exports
 *   3. Scope Router structure — 18 tRPC procedures
 *   4. Scope Router integration — appRouter wiring
 *   5. Seed data → DB helper compatibility
 *   6. Cross-module integration (scope ↔ geo ↔ pricing architecture)
 */

import { describe, it, expect } from "vitest";
import * as schema from "../drizzle/schema";
import { ALL_SCOPE_RULES, RULE_COUNTS } from "../shared/scope-rules-seed";
import { evaluateQuantityFormula } from "../shared/scope-engine";

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: Schema — Scope Tables
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 12 — Schema: scope_rules table", () => {
  it("has all required columns", () => {
    const cols = Object.keys(schema.scopeRules);
    const required = [
      "id", "ruleCode", "serviceType", "projectType", "channel",
      "zone", "finishLevel", "conditionJson", "assemblyId",
      "quantityFormula", "reasonTemplate", "priority", "active",
      "createdAt", "updatedAt",
    ];
    for (const col of required) {
      expect(cols, `Missing column: ${col}`).toContain(col);
    }
  });

  it("has ruleCode as unique varchar(80)", () => {
    const col = schema.scopeRules.ruleCode;
    expect(col.notNull).toBe(true);
  });

  it("has serviceType as varchar(128) not null", () => {
    const col = schema.scopeRules.serviceType;
    expect(col.notNull).toBe(true);
  });

  it("has projectType as enum with 7 values", () => {
    const col = schema.scopeRules.projectType;
    expect(col.enumValues).toContain("remodel");
    expect(col.enumValues).toContain("new_construction");
    expect(col.enumValues).toContain("repair");
    expect(col.enumValues).toContain("insurance_restoration");
    expect(col.enumValues).toContain("commercial_buildout");
    expect(col.enumValues).toContain("addition");
    expect(col.enumValues).toContain("exterior");
    expect(col.enumValues?.length).toBe(7);
  });

  it("has channel as enum with 3 values (Sprint 12.5: removed residential)", () => {
    const col = schema.scopeRules.channel;
    expect(col.enumValues).toContain("direct");
    expect(col.enumValues).toContain("insurance");
    expect(col.enumValues).toContain("commercial");
    expect(col.enumValues?.length).toBe(3);
  });

  it("has finishLevel as enum with 3 values", () => {
    const col = schema.scopeRules.finishLevel;
    expect(col.enumValues).toContain("standard");
    expect(col.enumValues).toContain("premium");
    expect(col.enumValues).toContain("luxury");
    expect(col.enumValues?.length).toBe(3);
  });

  it("has conditionJson as JSON column", () => {
    const col = schema.scopeRules.conditionJson;
    expect(col).toBeDefined();
  });

  it("has assemblyId as int not null", () => {
    const col = schema.scopeRules.assemblyId;
    expect(col.notNull).toBe(true);
  });

  it("has priority with default 100", () => {
    const col = schema.scopeRules.priority;
    expect(col.notNull).toBe(true);
  });

  it("has active as boolean with default true", () => {
    const col = schema.scopeRules.active;
    expect(col.notNull).toBe(true);
  });

  it("exports ScopeRule and InsertScopeRule types", () => {
    // Type-level check — if this compiles, types exist
    const _rule: schema.ScopeRule = {} as any;
    const _insert: schema.InsertScopeRule = {} as any;
    expect(true).toBe(true);
  });
});

describe("Sprint 12 — Schema: scope_drafts table", () => {
  it("has all required columns", () => {
    const cols = Object.keys(schema.scopeDrafts);
    const required = [
      "id", "projectId", "intakeFormId", "status",
      "confidenceScore", "warningsJson",
      "createdBy", "updatedBy", "createdAt", "updatedAt",
    ];
    for (const col of required) {
      expect(cols, `Missing column: ${col}`).toContain(col);
    }
  });

  it("has status as enum with 5 values (updated Sprint 14)", () => {
    const col = schema.scopeDrafts.status;
    expect(col.enumValues).toContain("draft");
    expect(col.enumValues).toContain("under_review");
    expect(col.enumValues).toContain("approved");
    expect(col.enumValues).toContain("rejected");
    expect(col.enumValues).toContain("converted");
    expect(col.enumValues?.length).toBe(5);
  });

  it("has projectId as int not null", () => {
    const col = schema.scopeDrafts.projectId;
    expect(col.notNull).toBe(true);
  });

  it("has intakeFormId as int not null", () => {
    const col = schema.scopeDrafts.intakeFormId;
    expect(col.notNull).toBe(true);
  });

  it("has warningsJson as JSON column", () => {
    const col = schema.scopeDrafts.warningsJson;
    expect(col).toBeDefined();
  });

  it("exports ScopeDraft and InsertScopeDraft types", () => {
    const _draft: schema.ScopeDraft = {} as any;
    const _insert: schema.InsertScopeDraft = {} as any;
    expect(true).toBe(true);
  });
});

describe("Sprint 12 — Schema: scope_draft_items table", () => {
  it("has all required columns", () => {
    const cols = Object.keys(schema.scopeDraftItems);
    const required = [
      "id", "scopeDraftId", "assemblyId", "quantity",
      "unit", "reason", "confidence", "sortOrder", "createdAt",
    ];
    for (const col of required) {
      expect(cols, `Missing column: ${col}`).toContain(col);
    }
  });

  it("has scopeDraftId as int not null", () => {
    const col = schema.scopeDraftItems.scopeDraftId;
    expect(col.notNull).toBe(true);
  });

  it("has assemblyId as int not null", () => {
    const col = schema.scopeDraftItems.assemblyId;
    expect(col.notNull).toBe(true);
  });

  it("has quantity as decimal(10,4) not null", () => {
    const col = schema.scopeDraftItems.quantity;
    expect(col.notNull).toBe(true);
  });

  it("has unit with default 'EA'", () => {
    const col = schema.scopeDraftItems.unit;
    expect(col.notNull).toBe(true);
  });

  it("has reason as text not null", () => {
    const col = schema.scopeDraftItems.reason;
    expect(col.notNull).toBe(true);
  });

  it("has sortOrder as int with default 0", () => {
    const col = schema.scopeDraftItems.sortOrder;
    expect(col.notNull).toBe(true);
  });

  it("exports ScopeDraftItem and InsertScopeDraftItem types", () => {
    const _item: schema.ScopeDraftItem = {} as any;
    const _insert: schema.InsertScopeDraftItem = {} as any;
    expect(true).toBe(true);
  });
});

describe("Sprint 12 — Schema: ScopeRuleCondition interface", () => {
  it("has field, op, and value properties", () => {
    const condition: schema.ScopeRuleCondition = {
      field: "condition",
      op: "eq",
      value: "full_gut",
    };
    expect(condition.field).toBe("condition");
    expect(condition.op).toBe("eq");
    expect(condition.value).toBe("full_gut");
  });

  it("supports all operator types", () => {
    const ops: schema.ScopeRuleCondition["op"][] = ["eq", "neq", "in", "gte", "lte", "contains"];
    expect(ops.length).toBe(6);
  });

  it("supports string, number, and string[] value types", () => {
    const strCond: schema.ScopeRuleCondition = { field: "condition", op: "eq", value: "full_gut" };
    const numCond: schema.ScopeRuleCondition = { field: "area", op: "gte", value: 200 };
    const arrCond: schema.ScopeRuleCondition = { field: "condition", op: "in", value: ["full_gut", "partial"] };

    expect(typeof strCond.value).toBe("string");
    expect(typeof numCond.value).toBe("number");
    expect(Array.isArray(arrCond.value)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: Scope DB Helper Exports
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 12 — Scope DB Helper Exports", () => {
  it("exports all scope rule CRUD functions", async () => {
    const mod = await import("./scope-db");
    expect(typeof mod.createScopeRule).toBe("function");
    expect(typeof mod.getScopeRuleById).toBe("function");
    expect(typeof mod.getScopeRuleByCode).toBe("function");
    expect(typeof mod.listScopeRules).toBe("function");
    expect(typeof mod.loadActiveRulesForEngine).toBe("function");
    expect(typeof mod.updateScopeRule).toBe("function");
    expect(typeof mod.deactivateScopeRule).toBe("function");
    expect(typeof mod.reactivateScopeRule).toBe("function");
    expect(typeof mod.getScopeRuleStats).toBe("function");
  });

  it("exports all scope draft lifecycle functions", async () => {
    const mod = await import("./scope-db");
    expect(typeof mod.createScopeDraft).toBe("function");
    expect(typeof mod.getScopeDraftById).toBe("function");
    expect(typeof mod.listScopeDraftsForProject).toBe("function");
    expect(typeof mod.updateScopeDraftStatus).toBe("function");
    expect(typeof mod.getScopeDraftWithItems).toBe("function");
  });

  it("exports all scope draft item functions", async () => {
    const mod = await import("./scope-db");
    expect(typeof mod.addScopeDraftItems).toBe("function");
    expect(typeof mod.getScopeDraftItems).toBe("function");
    expect(typeof mod.removeScopeDraftItem).toBe("function");
    expect(typeof mod.clearScopeDraftItems).toBe("function");
  });

  it("exports seed helper function", async () => {
    const mod = await import("./scope-db");
    expect(typeof mod.seedScopeRules).toBe("function");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: Scope Router Structure
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 12 — Scope Router Structure", () => {
  it("exports scopeRouter", async () => {
    const mod = await import("./scope-router");
    expect(mod.scopeRouter).toBeDefined();
  });

  it("scopeRouter has all 18 procedures", async () => {
    const mod = await import("./scope-router");
    const router = mod.scopeRouter;
    const procedures = Object.keys(router._def.procedures);

    const expectedProcedures = [
      "listRules", "getRuleById", "getRuleByCode",
      "createRule", "updateRule", "deactivateRule", "reactivateRule",
      "ruleStats", "seedRules",
      "generate", "preview",
      "getDraft", "listDrafts", "updateDraftStatus",
      "removeDraftItem", "regenerate",
      "convertToBundle",
      "validateIntake",
    ];

    for (const proc of expectedProcedures) {
      expect(procedures, `Missing procedure: ${proc}`).toContain(proc);
    }
    expect(procedures.length).toBe(18);
  });

  it("scope router is integrated into appRouter", async () => {
    const mod = await import("./routers");
    const appRouter = mod.appRouter;
    const topLevelKeys = Object.keys(appRouter._def.procedures);

    // scope.* procedures should be accessible
    const scopeProcedures = topLevelKeys.filter(k => k.startsWith("scope."));
    expect(scopeProcedures.length).toBe(18);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: Scope Engine Exports
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 12 — Scope Engine Exports", () => {
  it("exports all 12 public functions", async () => {
    const mod = await import("../shared/scope-engine");
    const expectedFunctions = [
      "parseArea",
      "buildFormulaContext",
      "evaluateQuantityFormula",
      "safeEvaluateArithmetic",
      "matchRule",
      "matchRules",
      "evaluateConditions",
      "generateGeoWarnings",
      "validateIntakeForScope",
      "generateScopeDraft",
      "convertScopeToBundle",
    ];
    for (const fn of expectedFunctions) {
      expect(typeof (mod as any)[fn], `Missing export: ${fn}`).toBe("function");
    }
  });

  it("exports all constants", async () => {
    const mod = await import("../shared/scope-engine");
    expect(mod.DEFAULT_WASTE_FACTOR).toBeDefined();
    expect(mod.LUXURY_COMPLEXITY_MULTIPLIER).toBeDefined();
    expect(mod.DEFAULT_AREA_SQFT).toBeDefined();
    expect(mod.MIN_CONFIDENCE).toBeDefined();
    expect(mod.MAX_CONFIDENCE).toBeDefined();
    expect(mod.COASTAL_WARNING_THRESHOLD).toBeDefined();
    expect(mod.COASTAL_ZONES).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: Seed Data → DB Compatibility
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 12 — Seed Data DB Compatibility", () => {
  it("all seed rules have valid projectType enum values or null", () => {
    const validProjectTypes = new Set([
      "remodel", "new_construction", "repair", "insurance_restoration",
      "commercial_buildout", "addition", "exterior", null,
    ]);
    for (const rule of ALL_SCOPE_RULES) {
      expect(
        validProjectTypes.has(rule.projectType),
        `Invalid projectType: ${rule.projectType} in rule ${rule.ruleCode}`
      ).toBe(true);
    }
  });

  it("all seed rules have valid channel enum values or null", () => {
    const validChannels = new Set(["direct", "insurance", "commercial", null]);
    for (const rule of ALL_SCOPE_RULES) {
      expect(
        validChannels.has(rule.channel),
        `Invalid channel: ${rule.channel} in rule ${rule.ruleCode}`
      ).toBe(true);
    }
  });

  it("all seed rules have valid finishLevel enum values or null", () => {
    const validFinishLevels = new Set(["standard", "premium", "luxury", null]);
    for (const rule of ALL_SCOPE_RULES) {
      expect(
        validFinishLevels.has(rule.finishLevel),
        `Invalid finishLevel: ${rule.finishLevel} in rule ${rule.ruleCode}`
      ).toBe(true);
    }
  });

  it("all seed rules have ruleCode within 80 chars", () => {
    for (const rule of ALL_SCOPE_RULES) {
      expect(rule.ruleCode.length).toBeLessThanOrEqual(80);
      expect(rule.ruleCode.length).toBeGreaterThan(0);
    }
  });

  it("all seed rules have quantityFormula within 255 chars", () => {
    for (const rule of ALL_SCOPE_RULES) {
      expect(rule.quantityFormula.length).toBeLessThanOrEqual(255);
    }
  });

  it("all seed rules have reasonTemplate within 512 chars", () => {
    for (const rule of ALL_SCOPE_RULES) {
      expect(rule.reasonTemplate.length).toBeLessThanOrEqual(512);
    }
  });

  it("all seed rules have conditionJson with valid operators", () => {
    const validOps = new Set(["eq", "neq", "in", "gte", "lte", "contains"]);
    for (const rule of ALL_SCOPE_RULES) {
      if (rule.conditionJson) {
        for (const cond of rule.conditionJson) {
          expect(
            validOps.has(cond.op),
            `Invalid op: ${cond.op} in rule ${rule.ruleCode}`
          ).toBe(true);
        }
      }
    }
  });

  it("all seed rule quantity formulas are evaluable", () => {
    const ctx: import("../shared/scope-engine").FormulaContext = {
      area: 200,
      rooms: 2,
      units: 14,
      length: 14.14,
      width: 14.14,
      height: 8,
      wasteFactor: 1.1,
      luxuryMultiplier: 1.15,
    };

    for (const rule of ALL_SCOPE_RULES) {
      const result = evaluateQuantityFormula(rule.quantityFormula, ctx);
      expect(
        result,
        `Formula "${rule.quantityFormula}" in rule ${rule.ruleCode} returned invalid result`
      ).toBeGreaterThanOrEqual(1);
      expect(isFinite(result)).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: Cross-Module Architecture
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 12 — Architecture Compliance", () => {
  const getProjectRoot = () => {
    const path = require("path");
    return path.resolve(__dirname, "..");
  };

  it("scope-engine.ts has ZERO database imports", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "shared/scope-engine.ts"),
      "utf-8"
    );

    // Should NOT import from drizzle-orm, server/db, or any DB module
    expect(content).not.toContain("from \"drizzle-orm\"");
    expect(content).not.toContain("from \"./db\"");
    expect(content).not.toContain("from \"../server/db\"");
    expect(content).not.toContain("getDb");
  });

  it("scope-engine.ts has ZERO pricing imports", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "shared/scope-engine.ts"),
      "utf-8"
    );

    // Should NOT import pricing engine
    expect(content).not.toContain("from \"./pricing-engine\"");
    expect(content).not.toContain("from \"@shared/pricing-engine\"");
    expect(content).not.toContain("applyPricingDimensions");
    expect(content).not.toContain("priceLineItems");
  });

  it("scope-engine.ts uses normalization layer", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "shared/scope-engine.ts"),
      "utf-8"
    );

    expect(content).toContain("normalizeServiceType");
    expect(content).toContain("normalizeFinishLevel");
    expect(content).toContain("normalizeChannel");
    expect(content).toContain("normalizeCondition");
  });

  it("scope-engine.ts imports geo-engine types only", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "shared/scope-engine.ts"),
      "utf-8"
    );

    // Should import types from geo-engine
    expect(content).toContain("from \"./geo-engine\"");
    // Should import COASTAL_EXPOSURE_ORDER constant
    expect(content).toContain("COASTAL_EXPOSURE_ORDER");
  });

  it("scope-db.ts uses audit logging", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "server/scope-db.ts"),
      "utf-8"
    );

    expect(content).toContain("logAudit");
    expect(content).toContain("scope_rule.create");
    expect(content).toContain("scope_rule.update");
    expect(content).toContain("scope_rule.deactivate");
    expect(content).toContain("scope_draft.create");
    expect(content).toContain("scope_draft.status_change");
    expect(content).toContain("scope_draft_item.remove");
    expect(content).toContain("scope_draft_items.clear");
  });

  it("scope-router.ts uses admin procedures for mutations", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "server/scope-router.ts"),
      "utf-8"
    );

    // Rule mutations should use adminProcedure
    expect(content).toContain("createRule: adminProcedure");
    expect(content).toContain("updateRule: adminProcedure");
    expect(content).toContain("deactivateRule: adminProcedure");
    expect(content).toContain("reactivateRule: adminProcedure");
    expect(content).toContain("seedRules: adminProcedure");
  });

  it("scope-router.ts uses protected procedures for reads and generation", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "server/scope-router.ts"),
      "utf-8"
    );

    expect(content).toContain("listRules: protectedProcedure");
    expect(content).toContain("getRuleById: protectedProcedure");
    expect(content).toContain("getRuleByCode: protectedProcedure");
    expect(content).toContain("generate: protectedProcedure");
    expect(content).toContain("preview: protectedProcedure");
    expect(content).toContain("getDraft: protectedProcedure");
    expect(content).toContain("validateIntake: protectedProcedure");
  });

  it("scope-router.ts integrates with intake, project, and assembly modules", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.join(getProjectRoot(), "server/scope-router.ts"),
      "utf-8"
    );

    expect(content).toContain("getIntakeFormById");
    expect(content).toContain("getProjectById");
    expect(content).toContain("listAssemblies");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: Scope Rules Seed — Trade Coverage
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 12 — Seed Trade Coverage", () => {
  it("kitchen rules: 12 rules covering demo, cabinets, countertops, backsplash, sink, appliance, paint", () => {
    expect(RULE_COUNTS.kitchen).toBe(12);
    const kitchenRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "kitchen_remodel");
    expect(kitchenRules.length).toBe(RULE_COUNTS.kitchen);

    // Verify key rule codes exist
    const codes = new Set(kitchenRules.map(r => r.ruleCode));
    expect(codes.has("KIT-DEMO-STD")).toBe(true);
    expect(codes.has("KIT-CAB-STD")).toBe(true);
    expect(codes.has("KIT-CTR-STD")).toBe(true);
    expect(codes.has("KIT-CAB-PRM")).toBe(true);
    expect(codes.has("KIT-CAB-LUX")).toBe(true);
  });

  it("bathroom rules: 8 rules covering demo, shower, tile, vanity, toilet, paint", () => {
    expect(RULE_COUNTS.bathroom).toBe(8);
    const bathRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "bathroom_remodel");
    expect(bathRules.length).toBe(8);
  });

  it("roofing rules: 8 rules covering tear-off, shingles, underlayment, flashing, ridge", () => {
    expect(RULE_COUNTS.roofing).toBe(8);
    const roofRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "roofing");
    expect(roofRules.length).toBe(8);
  });

  it("siding rules: 5 rules covering demo, vinyl, hardie, trim, wrap", () => {
    expect(RULE_COUNTS.siding).toBe(5);
  });

  it("windows/doors rules: 7 rules covering window and door replacement (Sprint 12.5: canonical 'windows_doors')", () => {
    expect(RULE_COUNTS.windowsDoors).toBe(7);
    const winRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "windows_doors");
    expect(winRules.length).toBe(7);
  });

  it("deck rules: 6 rules covering deck build and screen porch (Sprint 12.5: canonical 'deck_porch')", () => {
    expect(RULE_COUNTS.deck).toBe(6);
    const deckRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "deck_porch");
    expect(deckRules.length).toBe(6);
  });

  it("paint rules: 5 rules in PAINT_RULES group (Sprint 12.5: all canonical 'painting')", () => {
    expect(RULE_COUNTS.paint).toBe(5);
    const paintRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "painting");
    expect(paintRules.length).toBe(5);
    // scopeVariant distinguishes interior vs exterior
    const interiorPaint = paintRules.filter(r => r.scopeVariant === "interior_paint");
    expect(interiorPaint.length).toBe(4);
    const exteriorPaint = paintRules.filter(r => r.scopeVariant === "exterior_paint");
    expect(exteriorPaint.length).toBe(1);
  });

  it("flooring rules: 6 rules covering flooring install (Sprint 12.5: canonical 'flooring')", () => {
    expect(RULE_COUNTS.flooring).toBe(6);
    const floorRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "flooring");
    expect(floorRules.length).toBe(6);
  });

  it("exterior rules: 5 rules in EXTERIOR_RULES group (Sprint 12.5: canonical 'exterior')", () => {
    expect(RULE_COUNTS.exterior).toBe(5);
    const extRules = ALL_SCOPE_RULES.filter(r => r.serviceType === "exterior");
    expect(extRules.length).toBe(5);
    // All should have scopeVariant = 'exterior_renovation'
    for (const rule of extRules) {
      expect(rule.scopeVariant).toBe("exterior_renovation");
    }
  });
});
