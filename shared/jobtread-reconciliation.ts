/**
 * structr.ai — PHASE 2 JobTread Export Reconciliation
 *
 * PURE engine for the export gate described in docs/phase2-contract.md §8 and by
 * gchi-jobtread-integration-contract rules JIC-002, JIC-003, JIC-005, JIC-008 and JIC-014.
 *
 * Responsibilities:
 *   1. Integer-cent arithmetic (no binary floating point as reconciliation evidence)
 *   2. Reconcile Σ(Quantity × Unit Price) against the approved final_total_price
 *   3. Build the per-row cost-code manifest (cost code is governed, but is NOT a 10th column)
 *   4. Own the export state machine and its blocking states
 *
 * No DB, no IO.
 */

// ══════════════════════════════════════════════════════════════════════
// MONEY (integer cents)
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert a monetary value to integer cents.
 * Accepts strings (DB numeric columns) and numbers. Rounds half away from zero,
 * which matches how the operator reads a price on paper.
 */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  const scaled = numeric * 100;
  return scaled >= 0 ? Math.round(scaled) : -Math.round(Math.abs(scaled));
}

/** Convert integer cents back to a 2-decimal dollar number. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Format integer cents as a fixed 2-decimal string. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Multiply a quantity by a unit price expressed in cents, returning integer cents.
 *
 * The quantity may be fractional (12.5 SF), so the product is rounded to the cent
 * exactly once, at the line level. JIC-003 forbids intermediate rounding beyond the
 * currency scale, and rounding per line is what the CSV consumer will see.
 */
export function lineTotalCents(
  quantity: string | number | null | undefined,
  unitPrice: string | number | null | undefined,
): number {
  const qty = typeof quantity === "number" ? quantity : Number(String(quantity ?? 0));
  if (!Number.isFinite(qty)) return 0;
  const priceCents = toCents(unitPrice);
  const product = qty * priceCents;
  return product >= 0 ? Math.round(product) : -Math.round(Math.abs(product));
}

// ══════════════════════════════════════════════════════════════════════
// RECONCILIATION
// ══════════════════════════════════════════════════════════════════════

export interface ReconciliationLine {
  /** 1-based CSV row number (row 1 is the first data row, not the header). */
  csvRowNumber: number;
  costGroupName: string;
  costItemName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export type ReconciliationStatus =
  | "reconciled"
  | "blocked_reconciliation"
  | "needs_exception_review";

export interface ReconciliationResult {
  status: ReconciliationStatus;
  approvedTotalCents: number;
  exportedTotalCents: number;
  differenceCents: number;
  /** Dollar-formatted mirrors for reports and templates. */
  approvedTotal: string;
  exportedTotal: string;
  difference: string;
  lines: ReconciliationLine[];
  /** Lines that contribute most to the difference (largest absolute totals first). */
  suspectLines: ReconciliationLine[];
  message: string;
}

export interface ReconciliationInput {
  /** CSV rows already generated and structurally valid. */
  rows: Array<{
    "Cost Group Name": string;
    "Cost Item Name": string;
    Quantity: string;
    "Unit Price": string;
  }>;
  /** Approved commercial total of the estimate version. */
  approvedTotal: string | number | null | undefined;
  /**
   * Known commercial adjustments not represented as CSV lines
   * (discount, lump sum, allowance handling, payment rule).
   * When present and they explain the difference, the result is `needs_exception_review`.
   */
  declaredAdjustments?: Array<{ kind: string; amount: string | number; reason?: string }>;
}

/**
 * Reconcile exported CSV lines against the approved total (JIC-003).
 *
 * Zero tolerance: any non-zero difference blocks the download. When the caller declared
 * commercial adjustments that exactly explain the gap, the status becomes
 * `needs_exception_review` instead, because that path requires a new version or an
 * approved change order rather than a silent CSV edit.
 */
export function reconcileExport(input: ReconciliationInput): ReconciliationResult {
  const lines: ReconciliationLine[] = input.rows.map((row, index) => {
    const quantity = Number(row.Quantity);
    return {
      csvRowNumber: index + 1,
      costGroupName: row["Cost Group Name"],
      costItemName: row["Cost Item Name"],
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitPriceCents: toCents(row["Unit Price"]),
      lineTotalCents: lineTotalCents(row.Quantity, row["Unit Price"]),
    };
  });

  const exportedTotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const approvedTotalCents = toCents(input.approvedTotal);
  const differenceCents = exportedTotalCents - approvedTotalCents;

  const adjustmentsCents = (input.declaredAdjustments ?? []).reduce(
    (sum, adjustment) => sum + Math.abs(toCents(adjustment.amount)),
    0,
  );

  const suspectLines = [...lines]
    .sort((a, b) => Math.abs(b.lineTotalCents) - Math.abs(a.lineTotalCents))
    .slice(0, 5);

  if (differenceCents === 0) {
    return {
      status: "reconciled",
      approvedTotalCents,
      exportedTotalCents,
      differenceCents,
      approvedTotal: formatCents(approvedTotalCents),
      exportedTotal: formatCents(exportedTotalCents),
      difference: formatCents(0),
      lines,
      suspectLines: [],
      message: `Exported total ${formatCents(exportedTotalCents)} matches the approved total exactly.`,
    };
  }

  if (adjustmentsCents > 0 && adjustmentsCents === Math.abs(differenceCents)) {
    return {
      status: "needs_exception_review",
      approvedTotalCents,
      exportedTotalCents,
      differenceCents,
      approvedTotal: formatCents(approvedTotalCents),
      exportedTotal: formatCents(exportedTotalCents),
      difference: formatCents(differenceCents),
      lines,
      suspectLines,
      message: `Difference of ${formatCents(differenceCents)} is fully explained by declared commercial adjustments (${(input.declaredAdjustments ?? []).map((a) => a.kind).join(", ")}). Resolve with a new estimate version or an approved change order — manual CSV edits are prohibited (JIC-003).`,
    };
  }

  return {
    status: "blocked_reconciliation",
    approvedTotalCents,
    exportedTotalCents,
    differenceCents,
    approvedTotal: formatCents(approvedTotalCents),
    exportedTotal: formatCents(exportedTotalCents),
    difference: formatCents(differenceCents),
    lines,
    suspectLines,
    message: `Exported total ${formatCents(exportedTotalCents)} differs from approved total ${formatCents(approvedTotalCents)} by ${formatCents(differenceCents)}. Download blocked (JIC-003).`,
  };
}

// ══════════════════════════════════════════════════════════════════════
// MANIFEST (cost code governance without a 10th CSV column — JIC-005)
// ══════════════════════════════════════════════════════════════════════

export interface ManifestRow {
  csvRowNumber: number;
  costGroupName: string;
  costItemName: string;
  costType: string;
  unit: string;
  quantity: number;
  unitCostCents: number;
  unitPriceCents: number;
  lineTotalCents: number;
  costCode: string | null;
  costCodeSource: "line_item" | "inferred" | "override" | "missing";
  estimateLineItemId: string | null;
  assemblyId: string | null;
  /** True when the row is an assembly summary fallback instead of components (JIC-008). */
  assemblySummaryFallback: boolean;
}

export interface ExportManifest {
  contractVersion: string;
  skillId: string;
  skillVersion: string;
  estimateDraftId: string;
  estimateVersion: number;
  projectId: string | null;
  tenantId: string | null;
  rowCount: number;
  rows: ManifestRow[];
  totals: {
    exportedTotalCents: number;
    approvedTotalCents: number;
    differenceCents: number;
  };
  costCodeIssues: Array<{ csvRowNumber: number; costCode: string | null; issue: string }>;
  assemblyFallbackRows: number[];
  generatedAt: string;
}

export interface ManifestInput {
  estimateDraftId: string;
  estimateVersion: number;
  projectId: string | null;
  tenantId: string | null;
  rows: Array<{
    "Cost Group Name": string;
    "Cost Item Name": string;
    Quantity: string;
    Unit: string;
    "Unit Cost": string;
    "Unit Price": string;
    "Cost Type": string;
  }>;
  /** Per-row governance metadata, aligned by index with `rows`. */
  rowMetadata?: Array<{
    costCode?: string | null;
    costCodeSource?: ManifestRow["costCodeSource"];
    estimateLineItemId?: string | null;
    assemblyId?: string | null;
    assemblySummaryFallback?: boolean;
  }>;
  reconciliation: ReconciliationResult;
  /** Cost code validator injected by the caller (keeps this module pure). */
  isValidCostCode?: (code: string) => boolean;
  generatedAt?: string;
}

export const JOBTREAD_CONTRACT_VERSION = "csv-v1.0";
export const JOBTREAD_SKILL_ID = "gchi-jobtread-integration-contract";
export const JOBTREAD_SKILL_VERSION = "1.0.0";

/** Build the export manifest, including per-row cost-code mapping and fallback flags. */
export function buildExportManifest(input: ManifestInput): ExportManifest {
  const costCodeIssues: ExportManifest["costCodeIssues"] = [];
  const assemblyFallbackRows: number[] = [];

  const rows: ManifestRow[] = input.rows.map((row, index) => {
    const meta = input.rowMetadata?.[index] ?? {};
    const csvRowNumber = index + 1;
    const costCode = meta.costCode ?? null;
    const costCodeSource = meta.costCodeSource ?? (costCode ? "inferred" : "missing");

    if (!costCode) {
      costCodeIssues.push({
        csvRowNumber,
        costCode: null,
        issue: "cost_code_unmapped",
      });
    } else if (input.isValidCostCode && !input.isValidCostCode(costCode)) {
      costCodeIssues.push({
        csvRowNumber,
        costCode,
        issue: "cost_code_invalid",
      });
    }

    if (meta.assemblySummaryFallback) assemblyFallbackRows.push(csvRowNumber);

    const quantity = Number(row.Quantity);

    return {
      csvRowNumber,
      costGroupName: row["Cost Group Name"],
      costItemName: row["Cost Item Name"],
      costType: row["Cost Type"],
      unit: row.Unit,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitCostCents: toCents(row["Unit Cost"]),
      unitPriceCents: toCents(row["Unit Price"]),
      lineTotalCents: lineTotalCents(row.Quantity, row["Unit Price"]),
      costCode,
      costCodeSource,
      estimateLineItemId: meta.estimateLineItemId ?? null,
      assemblyId: meta.assemblyId ?? null,
      assemblySummaryFallback: meta.assemblySummaryFallback ?? false,
    };
  });

  return {
    contractVersion: JOBTREAD_CONTRACT_VERSION,
    skillId: JOBTREAD_SKILL_ID,
    skillVersion: JOBTREAD_SKILL_VERSION,
    estimateDraftId: input.estimateDraftId,
    estimateVersion: input.estimateVersion,
    projectId: input.projectId,
    tenantId: input.tenantId,
    rowCount: rows.length,
    rows,
    totals: {
      exportedTotalCents: input.reconciliation.exportedTotalCents,
      approvedTotalCents: input.reconciliation.approvedTotalCents,
      differenceCents: input.reconciliation.differenceCents,
    },
    costCodeIssues,
    assemblyFallbackRows,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════
// EXPORT STATE MACHINE (JIC workflow)
// ══════════════════════════════════════════════════════════════════════

export const EXPORT_STATES = [
  "requested",
  "validating",
  "reconciling",
  "needs_exception_review",
  "approved_for_download",
  "downloaded",
  "blocked_validation",
  "blocked_reconciliation",
  "blocked_authorization",
  "cancelled",
  "expired",
] as const;

export type ExportState = (typeof EXPORT_STATES)[number];

const EXPORT_TRANSITIONS: Record<ExportState, readonly ExportState[]> = {
  requested: ["validating", "blocked_authorization", "cancelled"],
  validating: ["reconciling", "blocked_validation", "blocked_authorization", "cancelled"],
  reconciling: [
    "approved_for_download",
    "blocked_reconciliation",
    "needs_exception_review",
    "cancelled",
  ],
  needs_exception_review: ["validating", "cancelled"],
  approved_for_download: ["downloaded", "expired", "cancelled"],
  downloaded: [],
  blocked_validation: [],
  blocked_reconciliation: [],
  blocked_authorization: [],
  cancelled: [],
  expired: [],
};

/** States in which no file may be produced or downloaded. */
export const EXPORT_BLOCKING_STATES: readonly ExportState[] = [
  "blocked_validation",
  "blocked_reconciliation",
  "blocked_authorization",
  "needs_exception_review",
  "cancelled",
  "expired",
] as const;

export function canTransitionExport(from: ExportState, to: ExportState): boolean {
  return (EXPORT_TRANSITIONS[from] ?? []).includes(to);
}

export function isExportBlocked(state: ExportState): boolean {
  return EXPORT_BLOCKING_STATES.includes(state);
}

/** True only when the CSV payload may be returned to the caller. */
export function canDownloadExport(state: ExportState): boolean {
  return state === "approved_for_download" || state === "downloaded";
}
