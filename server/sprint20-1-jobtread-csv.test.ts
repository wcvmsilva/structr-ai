/**
 * Sprint 20.1 — JobTread CSV Compliance Hardening Tests
 *
 * Covers:
 *   1. CSV Header Contract (deterministic column order)
 *   2. Cost Type Validation (7 allowed values)
 *   3. Unit Normalization (internal → JobTread canonical)
 *   4. Cost Code Validation (against master catalog)
 *   5. structr.ai Classification Rules (ported from classify_catalog.py)
 *   6. Row Generation & Assembly Mapping
 *   7. Strict Validation Report & Export Blocking
 *   8. CSV String Generation (BOM, escaping, encoding)
 *   9. Full Pipeline (generateJobTreadCsvExport)
 */
import { describe, it, expect } from "vitest";
import {
  JOBTREAD_CSV_HEADERS,
  VALID_COST_TYPES,
  VALID_UNITS,
  UNIT_NORMALIZATION_MAP,
  VALID_COST_CODES,
  classifyCostType,
  normalizeUnit,
  isValidCostCode,
  inferCostCode,
  isValidCostType,
  lineItemToCsvRow,
  assemblyToCsvRows,
  validateRow,
  validateCsvExport,
  generateCsvRows,
  generateCsvString,
  generateJobTreadCsvExport,
  type JobTreadCsvRow,
  type ValidCostType,
  type ValidUnit,
} from "./jobtread-csv-export";
import type {
  EstimateDraft,
  EstimateDraftLineItem,
  EstimateDraftAssemblySelection,
} from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function makeLineItem(overrides: Partial<EstimateDraftLineItem> = {}): EstimateDraftLineItem {
  return {
    catalogItemId: 1,
    costItemId: "CI-001",
    costGroupName: "Interior Finishes",
    costItemName: "Hardwood Flooring - Oak",
    description: "3/4\" solid oak hardwood flooring",
    unit: "SF",
    quantity: 500,
    unitCostSnapshot: 4.50,
    unitPriceSnapshot: 6.75,
    lineTotalCost: 2250,
    lineTotalPrice: 3375,
    grossProfitPct: 33.33,
    sortOrder: 1,
    assemblyId: undefined,
    assemblyName: undefined,
    componentType: undefined,
    priceBookItemId: null,
    wasteFactor: 0.10,
    adjustedUnitCost: 4.95,
    ...overrides,
  };
}

function makeAssembly(overrides: Partial<EstimateDraftAssemblySelection> = {}): EstimateDraftAssemblySelection {
  return {
    assemblyId: 100,
    assemblyName: "Kitchen Remodel Standard",
    category: "Interior Finishes",
    quantity: 1,
    unitCost: "5000.00",
    unitPrice: "7500.00",
    lineTotalCost: "5000.00",
    lineTotalPrice: "7500.00",
    grossProfitPct: "33.33",
    componentCount: 12,
    ...overrides,
  } as EstimateDraftAssemblySelection;
}

function makeDraft(overrides: Partial<EstimateDraft> = {}): EstimateDraft {
  return {
    id: 1,
    bundleName: "Test Bundle",
    status: "draft",
    source: "calculator",
    channel: "residential",
    region: "Charleston",
    finishLevel: "standard",
    pricingSchemaVersion: "2026.1",
    assemblySelections: [],
    lineItems: [],
    subtotalCost: "0.00",
    subtotalPrice: "0.00",
    grossProfit: "0.00",
    grossProfitPct: "0.00",
    discountApplied: "0.00",
    discountAmount: "0.00",
    finalTotalPrice: "0.00",
    notes: null,
    metadata: null,
    profitShieldPassed: true,
    contextSnapshot: null,
    scopeDraftId: null,
    createdBy: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    ...overrides,
  } as EstimateDraft;
}

function makeValidRow(overrides: Partial<JobTreadCsvRow> = {}): JobTreadCsvRow {
  return {
    "Cost Group Name": "Interior Finishes",
    "Cost Item Name": "Hardwood Flooring - Oak",
    Description: "3/4\" solid oak hardwood",
    Quantity: "500",
    Unit: "Square Feet",
    "Unit Cost": "4.50",
    "Unit Price": "6.75",
    "Cost Type": "Materials",
    Taxable: "True",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 1. CSV HEADER CONTRACT
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — CSV Header Contract", () => {
  it("should have exactly 9 headers", () => {
    expect(JOBTREAD_CSV_HEADERS).toHaveLength(9);
  });

  it("should have deterministic header order", () => {
    expect(JOBTREAD_CSV_HEADERS).toEqual([
      "Cost Group Name",
      "Cost Item Name",
      "Description",
      "Quantity",
      "Unit",
      "Unit Cost",
      "Unit Price",
      "Cost Type",
      "Taxable",
    ]);
  });

  it("should produce CSV with headers in exact order", () => {
    const row = makeValidRow();
    const csv = generateCsvString([row]);
    const headerLine = csv.replace("\uFEFF", "").split("\n")[0];
    expect(headerLine).toBe(
      "Cost Group Name,Cost Item Name,Description,Quantity,Unit,Unit Cost,Unit Price,Cost Type,Taxable"
    );
  });

  it("should include BOM in CSV output", () => {
    const csv = generateCsvString([makeValidRow()]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("should end CSV with newline", () => {
    const csv = generateCsvString([makeValidRow()]);
    expect(csv.endsWith("\n")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. COST TYPE VALIDATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — Cost Type Validation", () => {
  it("should have exactly 7 valid cost types", () => {
    expect(VALID_COST_TYPES).toHaveLength(7);
  });

  it("should accept all valid cost types", () => {
    for (const ct of VALID_COST_TYPES) {
      expect(isValidCostType(ct)).toBe(true);
    }
  });

  it("should reject invalid cost types", () => {
    expect(isValidCostType("Material")).toBe(false);
    expect(isValidCostType("labour")).toBe(false);
    expect(isValidCostType("Sub")).toBe(false);
    expect(isValidCostType("")).toBe(false);
  });

  it("should reject cost type with wrong casing", () => {
    expect(isValidCostType("materials")).toBe(false);
    expect(isValidCostType("LABOR")).toBe(false);
    expect(isValidCostType("equipment / rental")).toBe(false);
  });

  it("should validate row with invalid cost type", () => {
    const row = makeValidRow({ "Cost Type": "InvalidType" });
    const errors = validateRow(row, 0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe("Cost Type");
    expect(errors[0].error).toContain("Invalid Cost Type");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. UNIT NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — Unit Normalization", () => {
  it("should normalize EA to Each", () => {
    expect(normalizeUnit("EA")).toBe("Each");
    expect(normalizeUnit("ea")).toBe("Each");
    expect(normalizeUnit("Each")).toBe("Each");
  });

  it("should normalize HR to Hours", () => {
    expect(normalizeUnit("HR")).toBe("Hours");
    expect(normalizeUnit("hrs")).toBe("Hours");
    expect(normalizeUnit("hour")).toBe("Hours");
  });

  it("should normalize LF to Linear Feet", () => {
    expect(normalizeUnit("LF")).toBe("Linear Feet");
    expect(normalizeUnit("lf")).toBe("Linear Feet");
    expect(normalizeUnit("lin ft")).toBe("Linear Feet");
  });

  it("should normalize LS to Lump Sum", () => {
    expect(normalizeUnit("LS")).toBe("Lump Sum");
    expect(normalizeUnit("lump sum")).toBe("Lump Sum");
  });

  it("should normalize SF to Square Feet", () => {
    expect(normalizeUnit("SF")).toBe("Square Feet");
    expect(normalizeUnit("sqft")).toBe("Square Feet");
    expect(normalizeUnit("sq ft")).toBe("Square Feet");
  });

  it("should normalize SQ to Squares", () => {
    expect(normalizeUnit("SQ")).toBe("Squares");
    expect(normalizeUnit("square")).toBe("Squares");
  });

  it("should normalize TON to Tons", () => {
    expect(normalizeUnit("ton")).toBe("Tons");
    expect(normalizeUnit("tons")).toBe("Tons");
  });

  it("should normalize CY to Cubic Yards", () => {
    expect(normalizeUnit("CY")).toBe("Cubic Yards");
    expect(normalizeUnit("cu yd")).toBe("Cubic Yards");
  });

  it("should normalize Wellington's expanded units", () => {
    expect(normalizeUnit("bag")).toBe("Bags");
    expect(normalizeUnit("box")).toBe("Boxes");
    expect(normalizeUnit("bundle")).toBe("Bundles");
    expect(normalizeUnit("roll")).toBe("Rolls");
    expect(normalizeUnit("set")).toBe("Sets");
    expect(normalizeUnit("sheet")).toBe("Sheets");
    expect(normalizeUnit("piece")).toBe("Pieces");
  });

  it("should return null for unmapped units", () => {
    expect(normalizeUnit("FURLONGS")).toBeNull();
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit("xyz")).toBeNull();
  });

  it("should validate row with invalid unit", () => {
    const row = makeValidRow({ Unit: "FURLONGS" });
    const errors = validateRow(row, 0);
    expect(errors.some((e) => e.field === "Unit")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. COST CODE VALIDATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — Cost Code Validation", () => {
  it("should accept valid cost codes", () => {
    expect(isValidCostCode("01-100")).toBe(true);
    expect(isValidCostCode("03-200")).toBe(true);
    expect(isValidCostCode("17-500")).toBe(true);
    expect(isValidCostCode("22-400")).toBe(true);
  });

  it("should reject invalid cost codes", () => {
    expect(isValidCostCode("99-999")).toBe(false);
    expect(isValidCostCode("ABC")).toBe(false);
    expect(isValidCostCode("")).toBe(false);
  });

  it("should infer cost code from group name", () => {
    expect(inferCostCode("Foundation & Concrete")).toBe("03-100");
    expect(inferCostCode("Electrical")).toBe("17-100");
    expect(inferCostCode("Roofing")).toBe("06-100");
    expect(inferCostCode("Plumbing")).toBe("15-100");
  });

  it("should return null for unknown group", () => {
    expect(inferCostCode("Unknown Group")).toBeNull();
  });

  it("should have cost codes for all major divisions", () => {
    // Verify at least 20 divisions are covered
    const divisions = new Set(VALID_COST_CODES.map((c) => c.split("-")[0]));
    expect(divisions.size).toBeGreaterThanOrEqual(20);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. structr.ai CLASSIFICATION RULES
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — structr.ai Classification Rules", () => {
  // Priority 1: Permits / Fees
  it("should classify permit items as Permits / Fees", () => {
    expect(classifyCostType("General Conditions", "Building Permit", 500, 500)).toBe("Permits / Fees");
    expect(classifyCostType("General Conditions", "Zoning Review", 200, 200)).toBe("Permits / Fees");
    expect(classifyCostType("General Conditions", "Engineering Report", 800, 800)).toBe("Permits / Fees");
    expect(classifyCostType("General Conditions", "Elevation Certificate", 350, 350)).toBe("Permits / Fees");
  });

  // Priority 2: Equipment / Rental
  it("should classify equipment items as Equipment / Rental", () => {
    expect(classifyCostType("General Conditions", "30yd Dumpster", 450, 600)).toBe("Equipment / Rental");
    expect(classifyCostType("General Conditions", "Scaffolding Rental", 200, 300)).toBe("Equipment / Rental");
    expect(classifyCostType("General Conditions", "Portable Toilet", 150, 200)).toBe("Equipment / Rental");
  });

  // Priority 3: $0 cost items
  it("should classify $0 cost labor items as Labor", () => {
    expect(classifyCostType("Interior Finishes", "Cleanup", 0, 500)).toBe("Labor");
    expect(classifyCostType("Interior Finishes", "Demolition", 0, 800)).toBe("Labor");
  });

  it("should classify $0 cost specialty trades as Subcontractor", () => {
    expect(classifyCostType("Mechanical (HVAC)", "HVAC System Install", 0, 5000)).toBe("Subcontractor");
    expect(classifyCostType("Plumbing", "Rough Plumbing", 0, 3000)).toBe("Subcontractor");
  });

  it("should classify $0 cost reports as Permits / Fees", () => {
    expect(classifyCostType("General Conditions", "Compliance Report", 0, 200)).toBe("Permits / Fees");
    expect(classifyCostType("General Conditions", "Inspection Certificate", 0, 150)).toBe("Permits / Fees");
  });

  it("should classify $0 cost insurance as Other", () => {
    expect(classifyCostType("General Conditions", "Builder's Insurance", 0, 1200)).toBe("Other");
    expect(classifyCostType("General Conditions", "Performance Bond", 0, 800)).toBe("Other");
  });

  // Priority 4: Group-based Subcontractor
  it("should classify Foundation & Concrete as Subcontractor", () => {
    expect(classifyCostType("Foundation & Concrete", "Slab Pour", 2000, 3000)).toBe("Subcontractor");
  });

  it("should classify Painting & Wall Covering as Subcontractor", () => {
    expect(classifyCostType("Painting & Wall Covering", "Interior Paint", 1500, 2500)).toBe("Subcontractor");
  });

  it("should classify Framing hardware as Materials", () => {
    expect(classifyCostType("Framing & Structural", "Simpson Hurricane Tie", 2, 3)).toBe("Materials");
    expect(classifyCostType("Framing & Structural", "Joist Hanger", 3, 5)).toBe("Materials");
  });

  it("should classify Framing labor as Subcontractor", () => {
    expect(classifyCostType("Framing & Structural", "Wall Framing", 2000, 3500)).toBe("Subcontractor");
  });

  it("should classify Roofing materials vs labor correctly", () => {
    expect(classifyCostType("Roofing", "Underlayment", 50, 75)).toBe("Materials");
    expect(classifyCostType("Roofing", "Drip Edge", 30, 45)).toBe("Materials");
    expect(classifyCostType("Roofing", "Shingle Installation", 3000, 5000)).toBe("Subcontractor");
  });

  // Priority 5: Allowance
  it("should classify Appliances & Fixtures as Allowance", () => {
    expect(classifyCostType("Appliances & Fixtures", "Dishwasher", 600, 800)).toBe("Allowance");
    expect(classifyCostType("Appliances & Fixtures", "Range Hood", 400, 600)).toBe("Allowance");
  });

  // Priority 6: Materials-default groups
  it("should classify Interior Finishes as Materials", () => {
    expect(classifyCostType("Interior Finishes", "Crown Molding", 5, 8)).toBe("Materials");
  });

  it("should classify Flooring refinish as Labor", () => {
    expect(classifyCostType("Flooring", "Hardwood Refinish", 3, 5)).toBe("Labor");
  });

  it("should classify Flooring materials as Materials", () => {
    expect(classifyCostType("Flooring", "Vinyl Plank", 3, 5)).toBe("Materials");
  });

  // Priority 7: General Conditions
  it("should classify General Conditions admin as Other", () => {
    // $0 cost + unitPrice > 0 → Priority 3 kicks in first → "management" not in sub/fee/other zero keywords → Labor
    // But with cost > 0, it goes to Priority 7 → Other
    expect(classifyCostType("General Conditions", "Project Management", 100, 2000)).toBe("Other");
  });

  // Fallback
  it("should use fallback classification", () => {
    expect(classifyCostType("Unknown Group", "Unknown Item", 10, 15)).toBe("Materials");
    // unitCost=0, unitPrice=0 → does NOT trigger Priority 3 ($0 cost requires unitPrice > 0)
    // Falls through to fallback: unitCost=0 → Labor
    expect(classifyCostType("Unknown Group", "Unknown Item", 0, 0)).toBe("Labor");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. ROW GENERATION & ASSEMBLY MAPPING
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — Row Generation", () => {
  it("should convert line item to CSV row with correct fields", () => {
    const item = makeLineItem();
    const row = lineItemToCsvRow(item);
    expect(row["Cost Group Name"]).toBe("Interior Finishes");
    expect(row["Cost Item Name"]).toBe("Hardwood Flooring - Oak");
    expect(row.Quantity).toBe("500");
    expect(row.Unit).toBe("Square Feet"); // SF → Square Feet
    expect(row["Unit Cost"]).toBe("4.50");
    expect(row["Unit Price"]).toBe("6.75");
    expect(row["Cost Type"]).toBe("Materials");
    expect(row.Taxable).toBe("True");
  });

  it("should normalize unit in CSV row", () => {
    const item = makeLineItem({ unit: "LF" });
    const row = lineItemToCsvRow(item);
    expect(row.Unit).toBe("Linear Feet");
  });

  it("should classify cost type in CSV row", () => {
    const item = makeLineItem({
      costGroupName: "Foundation & Concrete",
      costItemName: "Slab Pour",
    });
    const row = lineItemToCsvRow(item);
    expect(row["Cost Type"]).toBe("Subcontractor");
  });

  it("should handle assembly with component line items", () => {
    const assembly = makeAssembly({ assemblyId: 100 });
    const lineItems = [
      makeLineItem({ assemblyId: 100, catalogItemId: 1, costItemName: "Cabinet Base" }),
      makeLineItem({ assemblyId: 100, catalogItemId: 2, costItemName: "Countertop" }),
    ];
    const rows = assemblyToCsvRows(assembly, lineItems);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Cost Item Name"]).toBe("Cabinet Base");
    expect(rows[1]["Cost Item Name"]).toBe("Countertop");
  });

  it("should create summary row for assembly without line items", () => {
    const assembly = makeAssembly();
    const rows = assemblyToCsvRows(assembly, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Cost Item Name"]).toBe("Kitchen Remodel Standard");
    expect(rows[0].Description).toContain("Assembly:");
    expect(rows[0].Unit).toBe("Each");
  });

  it("should generate rows from draft with both assemblies and standalone items", () => {
    const draft = makeDraft({
      assemblySelections: [makeAssembly({ assemblyId: 100 })] as any,
      lineItems: [
        makeLineItem({ assemblyId: 100, catalogItemId: 1 }),
        makeLineItem({ assemblyId: undefined, catalogItemId: 2, costItemName: "Standalone Item" }),
      ] as any,
    });
    const rows = generateCsvRows(draft);
    // 1 from assembly + 1 standalone
    expect(rows).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. STRICT VALIDATION REPORT & EXPORT BLOCKING
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — Strict Validation Report", () => {
  it("should pass validation for valid rows", () => {
    const rows = [makeValidRow(), makeValidRow({ "Cost Item Name": "Another Item" })];
    const report = validateCsvExport(rows);
    expect(report.isValid).toBe(true);
    expect(report.totalRows).toBe(2);
    expect(report.validRows).toBe(2);
    expect(report.invalidRows).toBe(0);
    expect(report.errors).toHaveLength(0);
  });

  it("should fail validation for invalid cost type", () => {
    const rows = [makeValidRow({ "Cost Type": "InvalidType" })];
    const report = validateCsvExport(rows);
    expect(report.isValid).toBe(false);
    expect(report.invalidRows).toBe(1);
    expect(report.errors[0].field).toBe("Cost Type");
  });

  it("should fail validation for invalid unit", () => {
    const rows = [makeValidRow({ Unit: "FURLONGS" })];
    const report = validateCsvExport(rows);
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.field === "Unit")).toBe(true);
  });

  it("should fail validation for missing required fields", () => {
    const rows = [makeValidRow({ "Cost Group Name": "", "Cost Item Name": "" })];
    const report = validateCsvExport(rows);
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.field === "Cost Group Name")).toBe(true);
    expect(report.errors.some((e) => e.field === "Cost Item Name")).toBe(true);
  });

  it("should fail validation for invalid quantity", () => {
    const rows = [makeValidRow({ Quantity: "abc" })];
    const report = validateCsvExport(rows);
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.field === "Quantity")).toBe(true);
  });

  it("should fail validation for invalid Taxable value", () => {
    const rows = [makeValidRow({ Taxable: "Yes" })];
    const report = validateCsvExport(rows);
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.field === "Taxable")).toBe(true);
  });

  it("should track cost type distribution", () => {
    const rows = [
      makeValidRow({ "Cost Type": "Materials" }),
      makeValidRow({ "Cost Type": "Materials", "Cost Item Name": "Item 2" }),
      makeValidRow({ "Cost Type": "Labor", "Cost Item Name": "Item 3" }),
    ];
    const report = validateCsvExport(rows);
    expect(report.summary.costTypeDistribution.Materials).toBe(2);
    expect(report.summary.costTypeDistribution.Labor).toBe(1);
  });

  it("should track unit distribution", () => {
    const rows = [
      makeValidRow({ Unit: "Square Feet" }),
      makeValidRow({ Unit: "Each", "Cost Item Name": "Item 2" }),
    ];
    const report = validateCsvExport(rows);
    expect(report.summary.unitDistribution["Square Feet"]).toBe(1);
    expect(report.summary.unitDistribution.Each).toBe(1);
  });

  it("should calculate total cost and price", () => {
    const rows = [
      makeValidRow({ Quantity: "10", "Unit Cost": "5.00", "Unit Price": "7.50" }),
      makeValidRow({ Quantity: "20", "Unit Cost": "3.00", "Unit Price": "4.50", "Cost Item Name": "Item 2" }),
    ];
    const report = validateCsvExport(rows);
    expect(report.summary.totalCost).toBe(110); // 10*5 + 20*3
    expect(report.summary.totalPrice).toBe(165); // 10*7.5 + 20*4.5
  });

  it("should count unique invalid rows (not total errors)", () => {
    // A row with 2 errors should count as 1 invalid row
    const rows = [makeValidRow({ "Cost Group Name": "", "Cost Item Name": "" })];
    const report = validateCsvExport(rows);
    expect(report.invalidRows).toBe(1);
    expect(report.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. CSV STRING GENERATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — CSV String Generation", () => {
  it("should escape values with commas", () => {
    const row = makeValidRow({ Description: "Item A, Item B" });
    const csv = generateCsvString([row]);
    expect(csv).toContain('"Item A, Item B"');
  });

  it("should escape values with quotes", () => {
    const row = makeValidRow({ Description: '3/4" hardwood' });
    const csv = generateCsvString([row]);
    expect(csv).toContain('"3/4"" hardwood"');
  });

  it("should escape values with newlines", () => {
    const row = makeValidRow({ Description: "Line 1\nLine 2" });
    const csv = generateCsvString([row]);
    expect(csv).toContain('"Line 1\nLine 2"');
  });

  it("should produce deterministic output for same input", () => {
    const rows = [makeValidRow(), makeValidRow({ "Cost Item Name": "Item 2" })];
    const csv1 = generateCsvString(rows);
    const csv2 = generateCsvString(rows);
    expect(csv1).toBe(csv2);
  });

  it("should handle empty rows array", () => {
    const csv = generateCsvString([]);
    const lines = csv.replace("\uFEFF", "").trim().split("\n");
    expect(lines).toHaveLength(1); // header only
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. FULL PIPELINE
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — Full Pipeline (generateJobTreadCsvExport)", () => {
  it("should return valid report with csvString for valid draft", () => {
    const draft = makeDraft({
      lineItems: [
        makeLineItem({ assemblyId: undefined }),
      ] as any,
    });
    const result = generateJobTreadCsvExport(draft, 1);
    expect(result.isValid).toBe(true);
    expect(result.csvString).toBeDefined();
    expect(result.totalRows).toBe(1);
  });

  it("should return invalid report without csvString for invalid draft", () => {
    const draft = makeDraft({
      lineItems: [
        makeLineItem({ assemblyId: undefined, unit: "INVALID_UNIT_XYZ", costGroupName: "" }),
      ] as any,
    });
    const result = generateJobTreadCsvExport(draft, 1);
    expect(result.isValid).toBe(false);
    expect(result.csvString).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should handle draft with no line items", () => {
    const draft = makeDraft();
    const result = generateJobTreadCsvExport(draft, 1);
    expect(result.isValid).toBe(true);
    expect(result.totalRows).toBe(0);
  });

  it("should handle draft with assemblies and line items", () => {
    const draft = makeDraft({
      assemblySelections: [makeAssembly({ assemblyId: 100 })] as any,
      lineItems: [
        makeLineItem({ assemblyId: 100, catalogItemId: 1 }),
        makeLineItem({ assemblyId: 100, catalogItemId: 2, costItemName: "Countertop" }),
        makeLineItem({ assemblyId: undefined, catalogItemId: 3, costItemName: "Standalone" }),
      ] as any,
    });
    const result = generateJobTreadCsvExport(draft, 1);
    expect(result.totalRows).toBe(3); // 2 from assembly + 1 standalone
  });

  it("should produce CSV with correct column count per row", () => {
    const draft = makeDraft({
      lineItems: [makeLineItem({ assemblyId: undefined })] as any,
    });
    const result = generateJobTreadCsvExport(draft, 1);
    expect(result.csvString).toBeDefined();
    const lines = result.csvString!.replace("\uFEFF", "").trim().split("\n");
    // Header + 1 data row
    expect(lines).toHaveLength(2);
    // Each line should have 9 columns (8 commas)
    const headerCols = lines[0].split(",").length;
    expect(headerCols).toBe(9);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. EDGE CASES & DETERMINISM
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20.1 — Edge Cases & Determinism", () => {
  it("should handle line items with string unitCostSnapshot", () => {
    const item = makeLineItem({ unitCostSnapshot: "4.50" as any, unitPriceSnapshot: "6.75" as any });
    const row = lineItemToCsvRow(item);
    expect(row["Unit Cost"]).toBe("4.50");
    expect(row["Unit Price"]).toBe("6.75");
  });

  it("should handle null/undefined description", () => {
    const item = makeLineItem({ description: null });
    const row = lineItemToCsvRow(item);
    expect(row.Description).toBe("");
  });

  it("should handle assembly with string cost values", () => {
    const assembly = makeAssembly({ unitCost: "1234.56", unitPrice: "1851.84" });
    const rows = assemblyToCsvRows(assembly, []);
    expect(rows[0]["Unit Cost"]).toBe("1234.56");
    expect(rows[0]["Unit Price"]).toBe("1851.84");
  });

  it("should produce same classification for same inputs (deterministic)", () => {
    const ct1 = classifyCostType("Roofing", "Shingle Installation", 3000, 5000);
    const ct2 = classifyCostType("Roofing", "Shingle Installation", 3000, 5000);
    expect(ct1).toBe(ct2);
    expect(ct1).toBe("Subcontractor");
  });

  it("should validate all VALID_UNITS are in normalization map values", () => {
    const normalizedValues = new Set(Object.values(UNIT_NORMALIZATION_MAP));
    for (const unit of VALID_UNITS) {
      expect(normalizedValues.has(unit)).toBe(true);
    }
  });

  it("should handle Electrical group classification correctly", () => {
    expect(classifyCostType("Electrical", "200A Service Panel", 500, 800)).toBe("Subcontractor");
    expect(classifyCostType("Electrical", "LED Recessed Light", 25, 40)).toBe("Materials");
    expect(classifyCostType("Electrical", "EV Charger Install", 800, 1200)).toBe("Subcontractor");
  });

  it("should handle Plumbing group classification correctly", () => {
    expect(classifyCostType("Plumbing", "Rough Plumbing - Kitchen", 0, 2500)).toBe("Subcontractor");
    expect(classifyCostType("Plumbing", "Kitchen Faucet", 150, 250)).toBe("Materials");
    expect(classifyCostType("Plumbing", "Gas Piping", 500, 800)).toBe("Subcontractor");
  });

  it("should handle Insulation group classification correctly", () => {
    // $0 cost + unitPrice > 0 → Priority 3 kicks in, but "spray foam" not in sub_zero list → Labor
    // With cost > 0, it goes to group-based: Insulation & Air Sealing → spray foam → Subcontractor
    expect(classifyCostType("Insulation & Air Sealing", "Spray Foam - Closed Cell", 100, 3000)).toBe("Subcontractor");
    expect(classifyCostType("Insulation & Air Sealing", "R-30 Batts", 1.50, 2.50)).toBe("Materials");
  });
});
