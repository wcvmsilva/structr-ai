/**
 * JobTread CSV Export Module — Sprint 20.1
 *
 * Generates CSV exports fully compliant with the JobTread budget import format.
 * Implements:
 *   - Deterministic header contract (9 columns, exact order)
 *   - Cost Type validation (7 allowed values)
 *   - Unit normalization (internal → JobTread canonical)
 *   - Cost Code validation (against master catalog)
 *   - Strict validation report with export blocking
 *   - structr.ai classification rules via classify_catalog.py logic (ported to TS)
 *
 * DOES NOT implement JobTread API integration — CSV generation and validation only.
 */
import type {
  EstimateDraft,
  EstimateDraftLineItem,
  EstimateDraftAssemblySelection,
} from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS — JobTread Master Catalogs
// ══════════════════════════════════════════════════════════════════════

/** Exact header order for JobTread budget import CSV */
export const JOBTREAD_CSV_HEADERS = [
  "Cost Group Name",
  "Cost Item Name",
  "Description",
  "Quantity",
  "Unit",
  "Unit Cost",
  "Unit Price",
  "Cost Type",
  "Taxable",
] as const;

export type JobTreadCsvHeader = (typeof JOBTREAD_CSV_HEADERS)[number];

/** Allowed Cost Types — must match EXACTLY what is configured in JobTread account */
export const VALID_COST_TYPES = [
  "Allowance",
  "Equipment / Rental",
  "Labor",
  "Materials",
  "Other",
  "Permits / Fees",
  "Subcontractor",
] as const;

export type ValidCostType = (typeof VALID_COST_TYPES)[number];

/** Canonical JobTread units — must match EXACTLY what is configured in JobTread account */
export const VALID_UNITS = [
  "Each",
  "Hours",
  "Linear Feet",
  "Lump Sum",
  "Square Feet",
  "Squares",
  "Tons",
  "Cubic Yards",
  "Pounds",
  "Bags",
  "Boxes",
  "Bundles",
  "Gallons",
  "Pieces",
  "Rolls",
  "Sets",
  "Sheets",
] as const;

export type ValidUnit = (typeof VALID_UNITS)[number];

/**
 * Unit normalization map: internal abbreviations → JobTread canonical names.
 * Case-insensitive lookup is performed during normalization.
 */
export const UNIT_NORMALIZATION_MAP: Record<string, ValidUnit> = {
  // Standard abbreviations
  ea: "Each",
  each: "Each",
  hr: "Hours",
  hrs: "Hours",
  hour: "Hours",
  hours: "Hours",
  lf: "Linear Feet",
  "linear feet": "Linear Feet",
  "lin ft": "Linear Feet",
  "lin. ft.": "Linear Feet",
  ls: "Lump Sum",
  "lump sum": "Lump Sum",
  lumpsum: "Lump Sum",
  sf: "Square Feet",
  sqft: "Square Feet",
  "sq ft": "Square Feet",
  "square feet": "Square Feet",
  "sq. ft.": "Square Feet",
  sq: "Squares",
  squares: "Squares",
  square: "Squares",
  ton: "Tons",
  tons: "Tons",
  cy: "Cubic Yards",
  "cubic yards": "Cubic Yards",
  "cu yd": "Cubic Yards",
  "cu. yd.": "Cubic Yards",
  lb: "Pounds",
  lbs: "Pounds",
  pounds: "Pounds",
  pound: "Pounds",
  bag: "Bags",
  bags: "Bags",
  box: "Boxes",
  boxes: "Boxes",
  bx: "Boxes",
  bundle: "Bundles",
  bundles: "Bundles",
  bdl: "Bundles",
  gal: "Gallons",
  gallon: "Gallons",
  gallons: "Gallons",
  pc: "Pieces",
  pcs: "Pieces",
  piece: "Pieces",
  pieces: "Pieces",
  roll: "Rolls",
  rolls: "Rolls",
  rl: "Rolls",
  set: "Sets",
  sets: "Sets",
  sheet: "Sheets",
  sheets: "Sheets",
  sht: "Sheets",
};

/**
 * structr.ai Master Cost Codes — validated against the JobTread cost-codes catalog.
 * Each cost code is a string identifier used for backend accounting.
 * This list covers all standard structr.ai construction cost codes.
 */
export const VALID_COST_CODES: string[] = [
  // General Conditions
  "01-100", "01-200", "01-300", "01-400", "01-500", "01-600", "01-700", "01-800",
  // Site Work & Excavation
  "02-100", "02-200", "02-300", "02-400", "02-500", "02-600", "02-700",
  // Foundation & Concrete
  "03-100", "03-200", "03-300", "03-400", "03-500", "03-600",
  // Framing & Structural
  "04-100", "04-200", "04-300", "04-400", "04-500", "04-600", "04-700",
  // Exterior Envelope
  "05-100", "05-200", "05-300", "05-400", "05-500", "05-600",
  // Roofing
  "06-100", "06-200", "06-300", "06-400", "06-500",
  // Doors & Windows
  "07-100", "07-200", "07-300", "07-400", "07-500",
  // Insulation & Air Sealing
  "08-100", "08-200", "08-300", "08-400",
  // Drywall & Plaster
  "09-100", "09-200", "09-300", "09-400",
  // Interior Finishes
  "10-100", "10-200", "10-300", "10-400", "10-500",
  // Flooring
  "11-100", "11-200", "11-300", "11-400", "11-500",
  // Cabinetry & Millwork
  "12-100", "12-200", "12-300", "12-400",
  // Painting & Wall Covering
  "13-100", "13-200", "13-300",
  // Appliances & Fixtures
  "14-100", "14-200", "14-300",
  // Plumbing
  "15-100", "15-200", "15-300", "15-400", "15-500",
  // Mechanical (HVAC)
  "16-100", "16-200", "16-300", "16-400", "16-500",
  // Electrical
  "17-100", "17-200", "17-300", "17-400", "17-500", "17-600",
  // Landscaping & Hardscape
  "18-100", "18-200", "18-300", "18-400",
  // Exterior Improvements
  "19-100", "19-200", "19-300", "19-400", "19-500",
  // Permits & Fees
  "20-100", "20-200", "20-300", "20-400",
  // Cleanup & Final
  "21-100", "21-200", "21-300",
  // Specialty / Coastal
  "22-100", "22-200", "22-300", "22-400",
];

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** A single row in the JobTread CSV export */
export interface JobTreadCsvRow {
  "Cost Group Name": string;
  "Cost Item Name": string;
  Description: string;
  Quantity: string;
  Unit: string;
  "Unit Cost": string;
  "Unit Price": string;
  "Cost Type": string;
  Taxable: string;
}

/** Validation error for a single row */
export interface CsvValidationError {
  rowIndex: number;
  field: string;
  value: string;
  error: string;
  costItemName: string;
  costGroupName: string;
}

/** Validation report returned before CSV download */
export interface CsvValidationReport {
  isValid: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: CsvValidationError[];
  rows: JobTreadCsvRow[];
  summary: {
    costTypeDistribution: Record<string, number>;
    unitDistribution: Record<string, number>;
    totalCost: number;
    totalPrice: number;
  };
}

// ══════════════════════════════════════════════════════════════════════
// COST TYPE CLASSIFICATION (ported from classify_catalog.py)
// ══════════════════════════════════════════════════════════════════════

/**
 * Classify a line item into the correct structr.ai Cost Type.
 * Mirrors the priority-based classification logic from classify_catalog.py.
 */
export function classifyCostType(
  costGroupName: string,
  costItemName: string,
  unitCost: number,
  unitPrice: number
): ValidCostType {
  const nl = costItemName.toLowerCase();
  const gl = costGroupName.toLowerCase();

  // --- Priority 1: Permits / Fees ---
  const permitKw = [
    "permit", "zoning", "survey", "engineering", "plan review",
    "impact fee", "stormwater", "elevation certificate", "hoa review",
    "historic review", "septic permit", "well permit", "tap fee",
    "inspection report", "certification", "compliance report",
    "flood zone", "geotechnical", "compaction testing",
    "coastal zone", "wind mitigation", "fortified cert",
  ];
  if (permitKw.some((k) => nl.includes(k))) return "Permits / Fees";

  // --- Priority 2: Equipment / Rental ---
  const equipKw = [
    "dumpster", "portable toilet", "scaffolding", "crane",
    "temporary power", "temporary fencing", "equipment rental",
    "tool rental", "generator rental", "lift rental", "temporary water",
  ];
  if (equipKw.some((k) => nl.includes(k))) return "Equipment / Rental";

  // --- Priority 3: $0 cost items ---
  if (unitCost === 0 && unitPrice > 0) {
    const subZero = [
      "hvac", "system", "service -", "underground", "pool",
      "spa", "generator", "land clearing", "demolition - full",
      "tear-off", "rough wiring", "rough plumbing", "rough-in",
      "ductwork", "air handler", "duct seal", "duct leakage",
      "manual j", "load calc", "blower door", "staking",
    ];
    if (subZero.some((k) => nl.includes(k))) return "Subcontractor";

    const feeZero = ["report", "certificate", "review", "determination"];
    if (feeZero.some((k) => nl.includes(k))) return "Permits / Fees";

    const otherZero = ["insurance", "warranty", "bond"];
    if (otherZero.some((k) => nl.includes(k))) return "Other";

    return "Labor";
  }

  // --- Priority 4: Group-based Subcontractor ---
  if (gl === "foundation & concrete") return "Subcontractor";
  if (gl === "painting & wall covering") return "Subcontractor";

  if (gl === "framing & structural") {
    const matKw = [
      "simpson", "hurricane", "hold-down", "joist hanger",
      "strap", "anchor bolt", "bracket", "nail", "screw", "adhesive", "bolt",
    ];
    return matKw.some((k) => nl.includes(k)) ? "Materials" : "Subcontractor";
  }

  if (gl === "roofing") {
    const matKw = [
      "nail", "fastener", "screw", "underlayment", "ice",
      "drip edge", "flashing", "ridge vent", "boot", "sealant", "adhesive",
    ];
    return matKw.some((k) => nl.includes(k)) ? "Materials" : "Subcontractor";
  }

  if (gl === "site work & excavation") {
    const matKw = [
      "silt fence", "erosion", "straw", "geotextile", "gravel",
      "fill dirt", "topsoil", "concrete washout",
    ];
    return matKw.some((k) => nl.includes(k)) ? "Materials" : "Subcontractor";
  }

  if (gl === "mechanical (hvac)") {
    const matKw = ["condensate", "dryer vent", "exhaust fan", "range hood", "condenser pad"];
    return matKw.some((k) => nl.includes(k)) ? "Materials" : "Subcontractor";
  }

  if (gl === "electrical") {
    const subKw = [
      "service", "panel", "sub panel", "rough wiring", "generator",
      "transfer switch", "lightning", "security system", "ev charger",
    ];
    return subKw.some((k) => nl.includes(k)) ? "Subcontractor" : "Materials";
  }

  if (gl === "plumbing") {
    const subKw = [
      "rough plumbing", "supply line", "drain line", "vent pipe",
      "gas piping", "irrigation", "backflow", "whole-house water",
    ];
    return subKw.some((k) => nl.includes(k)) ? "Subcontractor" : "Materials";
  }

  if (gl === "insulation & air sealing") {
    const subKw = ["spray foam", "blown-in"];
    return subKw.some((k) => nl.includes(k)) ? "Subcontractor" : "Materials";
  }

  if (gl === "exterior improvements") {
    const matKw = [
      "screw", "bolt", "nail", "hanger", "hurricane", "hold-down",
      "post base", "fastener", "simpson", "lumber", "plywood", "rebar", "pipe", "pile wrap",
    ];
    if (matKw.some((k) => nl.includes(k))) return "Materials";
    const subKw = [
      "pool", "spa", "saltwater", "framing", "boards", "railing",
      "stairs", "screen", "pergola", "patio", "outdoor kitchen",
      "fireplace", "fire pit", "deck",
    ];
    return subKw.some((k) => nl.includes(k)) ? "Subcontractor" : "Materials";
  }

  if (gl === "landscaping & hardscape") {
    const matKw = ["lighting", "controller"];
    return matKw.some((k) => nl.includes(k)) ? "Materials" : "Subcontractor";
  }

  if (gl === "exterior envelope") {
    const subKw = ["painting", "caulking"];
    return subKw.some((k) => nl.includes(k)) ? "Subcontractor" : "Materials";
  }

  // --- Priority 5: Allowance ---
  if (gl === "appliances & fixtures") return "Allowance";

  // --- Priority 6: Materials-default groups ---
  if (gl === "interior finishes" || gl === "cabinetry & millwork") return "Materials";
  if (gl === "doors & windows") {
    return ["installation", "flashing"].some((k) => nl.includes(k)) ? "Labor" : "Materials";
  }
  if (gl === "drywall & plaster") {
    return ["repair", "tear out"].some((k) => nl.includes(k)) ? "Labor" : "Materials";
  }
  if (gl === "flooring") {
    return nl.includes("refinish") ? "Labor" : "Materials";
  }

  // --- Priority 7: General Conditions ---
  if (gl === "general conditions") {
    if (["dumpster", "portable toilet", "scaffolding", "temporary"].some((k) => nl.includes(k))) {
      return "Equipment / Rental";
    }
    return "Other";
  }

  // --- Fallback ---
  return unitCost > 0 ? "Materials" : "Labor";
}

// ══════════════════════════════════════════════════════════════════════
// UNIT NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize an internal unit to a JobTread canonical unit.
 * Returns the canonical unit name or null if no valid mapping exists.
 */
export function normalizeUnit(internalUnit: string): ValidUnit | null {
  if (!internalUnit || internalUnit.trim() === "") return null;

  const key = internalUnit.trim().toLowerCase();

  // Direct lookup
  if (key in UNIT_NORMALIZATION_MAP) {
    return UNIT_NORMALIZATION_MAP[key];
  }

  // Check if it's already a valid canonical unit (case-insensitive)
  const canonicalMatch = VALID_UNITS.find(
    (u) => u.toLowerCase() === key
  );
  if (canonicalMatch) return canonicalMatch;

  return null;
}

// ══════════════════════════════════════════════════════════════════════
// COST CODE VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a cost code against the structr.ai master cost code catalog.
 * Returns true if the cost code is recognized.
 */
export function isValidCostCode(costCode: string): boolean {
  if (!costCode || costCode.trim() === "") return false;
  return VALID_COST_CODES.includes(costCode.trim());
}

/**
 * Infer a cost code from the cost group name.
 * Uses the group-to-division mapping to generate a default cost code.
 */
export function inferCostCode(costGroupName: string): string | null {
  const gl = costGroupName.toLowerCase();
  const groupToCode: Record<string, string> = {
    "general conditions": "01-100",
    "site work & excavation": "02-100",
    "foundation & concrete": "03-100",
    "framing & structural": "04-100",
    "exterior envelope": "05-100",
    "roofing": "06-100",
    "doors & windows": "07-100",
    "insulation & air sealing": "08-100",
    "drywall & plaster": "09-100",
    "interior finishes": "10-100",
    "flooring": "11-100",
    "cabinetry & millwork": "12-100",
    "painting & wall covering": "13-100",
    "appliances & fixtures": "14-100",
    "plumbing": "15-100",
    "mechanical (hvac)": "16-100",
    "electrical": "17-100",
    "landscaping & hardscape": "18-100",
    "exterior improvements": "19-100",
    "permits & fees": "20-100",
    "cleanup & final": "21-100",
    "specialty / coastal": "22-100",
  };
  return groupToCode[gl] ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// COST TYPE VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a cost type against the allowed JobTread cost types.
 */
export function isValidCostType(costType: string): costType is ValidCostType {
  return (VALID_COST_TYPES as readonly string[]).includes(costType);
}

// ══════════════════════════════════════════════════════════════════════
// CSV ROW GENERATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert a single EstimateDraftLineItem to a JobTread CSV row.
 * Applies classification, normalization, and validation.
 */
export function lineItemToCsvRow(
  item: EstimateDraftLineItem,
  costCodeOverride?: string
): JobTreadCsvRow {
  const unitCost = typeof item.unitCostSnapshot === "string"
    ? parseFloat(item.unitCostSnapshot)
    : Number(item.unitCostSnapshot ?? 0);
  const unitPrice = typeof item.unitPriceSnapshot === "string"
    ? parseFloat(item.unitPriceSnapshot)
    : Number(item.unitPriceSnapshot ?? 0);

  // Classify cost type using structr.ai rules
  const costType = classifyCostType(
    item.costGroupName,
    item.costItemName,
    unitCost,
    unitPrice
  );

  // Normalize unit
  const normalizedUnit = normalizeUnit(item.unit) ?? item.unit;

  // Infer cost code if not provided
  const costCode = costCodeOverride ?? inferCostCode(item.costGroupName) ?? "";

  return {
    "Cost Group Name": item.costGroupName,
    "Cost Item Name": item.costItemName,
    Description: item.description ?? "",
    Quantity: String(item.quantity),
    Unit: normalizedUnit,
    "Unit Cost": unitCost.toFixed(2),
    "Unit Price": unitPrice.toFixed(2),
    "Cost Type": costType,
    Taxable: "True",
  };
}

/**
 * Convert an EstimateDraftAssemblySelection's component items to CSV rows.
 * If the assembly has no line items, creates a single summary row.
 */
export function assemblyToCsvRows(
  assembly: EstimateDraftAssemblySelection,
  lineItems: EstimateDraftLineItem[]
): JobTreadCsvRow[] {
  // Find line items that belong to this assembly
  const assemblyItems = lineItems.filter(
    (li) => li.assemblyId === assembly.assemblyId
  );

  if (assemblyItems.length > 0) {
    return assemblyItems.map((item) => lineItemToCsvRow(item));
  }

  // Fallback: create a summary row for the assembly
  const unitCost = typeof assembly.unitCost === "string"
    ? parseFloat(assembly.unitCost)
    : Number(assembly.unitCost ?? 0);
  const unitPrice = typeof assembly.unitPrice === "string"
    ? parseFloat(assembly.unitPrice)
    : Number(assembly.unitPrice ?? 0);

  const costType = classifyCostType(
    assembly.category,
    assembly.assemblyName,
    unitCost,
    unitPrice
  );

  return [
    {
      "Cost Group Name": assembly.category,
      "Cost Item Name": assembly.assemblyName,
      Description: `Assembly: ${assembly.assemblyName} (${assembly.componentCount ?? 0} components)`,
      Quantity: String(assembly.quantity),
      Unit: "Each",
      "Unit Cost": unitCost.toFixed(2),
      "Unit Price": unitPrice.toFixed(2),
      "Cost Type": costType,
      Taxable: "True",
    },
  ];
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a single CSV row against all JobTread compliance rules.
 * Returns an array of validation errors (empty if valid).
 */
export function validateRow(
  row: JobTreadCsvRow,
  rowIndex: number
): CsvValidationError[] {
  const errors: CsvValidationError[] = [];
  const base = {
    rowIndex,
    costItemName: row["Cost Item Name"],
    costGroupName: row["Cost Group Name"],
  };

  // Required fields
  if (!row["Cost Group Name"]?.trim()) {
    errors.push({ ...base, field: "Cost Group Name", value: row["Cost Group Name"], error: "Cost Group Name is required" });
  }
  if (!row["Cost Item Name"]?.trim()) {
    errors.push({ ...base, field: "Cost Item Name", value: row["Cost Item Name"], error: "Cost Item Name is required" });
  }
  if (!row.Quantity?.trim() || isNaN(Number(row.Quantity))) {
    errors.push({ ...base, field: "Quantity", value: row.Quantity, error: "Quantity must be a valid number" });
  }

  // Cost Type validation
  if (!isValidCostType(row["Cost Type"])) {
    errors.push({
      ...base,
      field: "Cost Type",
      value: row["Cost Type"],
      error: `Invalid Cost Type "${row["Cost Type"]}". Allowed: ${VALID_COST_TYPES.join(", ")}`,
    });
  }

  // Unit validation
  const normalizedUnit = normalizeUnit(row.Unit);
  if (!normalizedUnit) {
    errors.push({
      ...base,
      field: "Unit",
      value: row.Unit,
      error: `Invalid Unit "${row.Unit}". No mapping to JobTread canonical units. Allowed: ${VALID_UNITS.join(", ")}`,
    });
  }

  // Unit Cost / Unit Price validation
  if (isNaN(Number(row["Unit Cost"]))) {
    errors.push({ ...base, field: "Unit Cost", value: row["Unit Cost"], error: "Unit Cost must be a valid number" });
  }
  if (isNaN(Number(row["Unit Price"]))) {
    errors.push({ ...base, field: "Unit Price", value: row["Unit Price"], error: "Unit Price must be a valid number" });
  }

  // Taxable validation
  if (row.Taxable !== "True" && row.Taxable !== "False") {
    errors.push({ ...base, field: "Taxable", value: row.Taxable, error: 'Taxable must be "True" or "False"' });
  }

  return errors;
}

/**
 * Run strict validation on all CSV rows.
 * Returns a full validation report with valid/invalid counts and error list.
 */
export function validateCsvExport(rows: JobTreadCsvRow[]): CsvValidationReport {
  const allErrors: CsvValidationError[] = [];
  const costTypeDistribution: Record<string, number> = {};
  const unitDistribution: Record<string, number> = {};
  let totalCost = 0;
  let totalPrice = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowErrors = validateRow(row, i);
    allErrors.push(...rowErrors);

    // Track distributions
    const ct = row["Cost Type"];
    costTypeDistribution[ct] = (costTypeDistribution[ct] ?? 0) + 1;
    const unit = row.Unit;
    unitDistribution[unit] = (unitDistribution[unit] ?? 0) + 1;

    // Track totals
    const qty = Number(row.Quantity) || 0;
    totalCost += qty * (Number(row["Unit Cost"]) || 0);
    totalPrice += qty * (Number(row["Unit Price"]) || 0);
  }

  const invalidRowIndices = new Set(allErrors.map((e) => e.rowIndex));

  return {
    isValid: allErrors.length === 0,
    totalRows: rows.length,
    validRows: rows.length - invalidRowIndices.size,
    invalidRows: invalidRowIndices.size,
    errors: allErrors,
    rows,
    summary: {
      costTypeDistribution,
      unitDistribution,
      totalCost: Math.round(totalCost * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// CSV GENERATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate all CSV rows from an estimate draft.
 * Processes both line items and assembly selections.
 */
export function generateCsvRows(draft: EstimateDraft): JobTreadCsvRow[] {
  const lineItems = (draft.lineItems ?? []) as EstimateDraftLineItem[];
  const assemblies = (draft.assemblySelections ?? []) as EstimateDraftAssemblySelection[];

  // Track which line items are already covered by assemblies
  const assemblyItemIds = new Set<number>();

  const rows: JobTreadCsvRow[] = [];

  // Process assemblies first (they may reference line items)
  for (const assembly of assemblies) {
    const assemblyRows = assemblyToCsvRows(assembly, lineItems);
    rows.push(...assemblyRows);

    // Mark line items as covered
    for (const li of lineItems) {
      if (li.assemblyId === assembly.assemblyId) {
        assemblyItemIds.add(li.catalogItemId);
      }
    }
  }

  // Process remaining line items not covered by assemblies
  for (const item of lineItems) {
    if (!assemblyItemIds.has(item.catalogItemId)) {
      rows.push(lineItemToCsvRow(item));
    }
  }

  return rows;
}

/**
 * Generate the CSV string from validated rows.
 * Uses the exact JobTread header order.
 * Encoding: UTF-8 with BOM for proper character handling.
 */
export function generateCsvString(rows: JobTreadCsvRow[]): string {
  const BOM = "\uFEFF";
  const header = JOBTREAD_CSV_HEADERS.join(",");

  const dataRows = rows.map((row) => {
    return JOBTREAD_CSV_HEADERS.map((col) => {
      const value = row[col] ?? "";
      // Escape values containing commas, quotes, or newlines
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(",");
  });

  return BOM + [header, ...dataRows].join("\n") + "\n";
}

/**
 * Full CSV export pipeline:
 * 1. Generate rows from estimate draft
 * 2. Run strict validation
 * 3. Return validation report (CSV string only if valid)
 */
export function generateJobTreadCsvExport(
  draft: EstimateDraft,
  userId: string
): CsvValidationReport & { csvString?: string } {
  const rows = generateCsvRows(draft);
  const report = validateCsvExport(rows);

  if (report.isValid) {
    return {
      ...report,
      csvString: generateCsvString(rows),
    };
  }

  return report;
}
