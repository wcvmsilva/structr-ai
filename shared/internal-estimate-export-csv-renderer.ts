/**
 * A1-EXPORT-DATA-CONTRACT.md §7, A1-EXPORT-CSV-IMPLEMENTATION-CONTRACT.md —
 * pure JobTread CSV renderer over an approved snapshot. Same single-input
 * contract as the JSON/printable/PDF renderers: typed/validated snapshot
 * core + immutable metadata, caller-supplied authority. NEVER consults a
 * live catalog/draft/project/notes or current profile. No persistence, no
 * network, no Date.now/random/env. NEVER calls classifyCostType/
 * normalizeUnit/inferCostCode — consumes the already-frozen
 * `line.csvClassification` exclusively; reclassifying in the export path
 * is forbidden by the core contract.
 *
 * Unlike JSON/printable/PDF (single ExportRendererError, first failure
 * wins), CSV can have many lines with many simultaneous blocking reasons,
 * and the manifest's own grammar already models this as an ORDERED ARRAY
 * of issues (`exportIssueOrderIsValid`). Per the accepted decision,
 * `renderExportCsv` returns a discriminated result instead of throwing for
 * business refusals: `{outcome:'ready',...} | {outcome:'blocked',issues}`.
 * Structural failures (bad envelope, hash divergence, wrong rendererVersion,
 * crypto unavailable, payload too large) still throw the existing typed
 * errors from the shared gate — those are not business outcomes.
 */
import {
  InternalApprovalError, type InternalApprovalSnapshot,
} from "./internal-estimate-approval-engine";
import {
  parseAndAuthenticate, sha256HexOfBytes, assertWithinResponseLimit,
  type ExportRenderInput,
} from "./internal-estimate-export-renderer";
import {
  buildExportFilename, checkExportCsvRowAgainstLine, computeExactAmountMinor, type ExportManifest,
} from "./internal-estimate-export-engine";
import { EXPORT_PROTOCOL as EP, INTERNAL_APPROVAL_PROTOCOL as AP, EXPORT_CSV_HEADERS } from "./domain/taxonomy";
import { VALID_COST_CODES } from "./domain/cost-codes";

type CsvRepresentation = Extract<NonNullable<ExportManifest["representation"]>, { format: "csv_jobtread" }>;
type CsvIssue = ExportManifest["validation"]["issues"][number];
export type CsvRenderOutcome =
  | { outcome: "ready"; bytes: Uint8Array; representation: CsvRepresentation }
  | { outcome: "blocked"; issues: CsvIssue[] };

// ── Rate formatting — Decimal6 dollars -> exact two-decimal CSV string ─────
/**
 * `unitCostSnapshot`/`unitPriceSnapshot` are Decimal6 dollar strings (already
 * canonical: no leading zeros but "0", no trailing fractional zeros, scale
 * <=6), NOT Minor cents — `formatMinorAsUsd` does not apply here (wrong
 * scale entirely, not just the `$` prefix). NULL or a fraction with more
 * than two canonical decimal places is unrepresentable in the two-decimal
 * CSV column and returns null; otherwise the integer part is kept as-is and
 * the fraction is padded to exactly two digits. Pure string manipulation —
 * never Number, never rounding/division.
 */
function formatCsvRateFromDecimal6(value: string | null): string | null {
  if (value === null) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 2) return null;
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

// ── RFC-style CSV field/row serialization ──────────────────────────────────
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
// Derived from the already-accepted manifest's own row shape (csvRowSchema is
// private, but its inferred type reaches here structurally through the public
// ExportManifest/CsvRepresentation types) — never hand-duplicated as `string`,
// which would silently widen away the enum literals it actually requires.
type CsvRow = CsvRepresentation["details"]["rows"][number];
function serializeCsv(rows: readonly CsvRow[]): string {
  const header = EXPORT_CSV_HEADERS.map(csvField).join(",");
  const dataLines = rows.map(row => [
    row.costGroupName, row.costItemName, row.description, row.quantity, row.unit,
    row.unitCost, row.unitPrice, row.costType, row.taxable ? "True" : "False",
  ].map(csvField).join(","));
  return [header, ...dataLines].join("\r\n") + "\r\n";
}

// ── Phase 1 — collect EVERY known representability issue, per line ────────
/**
 * Checked in `EXPORT_ISSUE_FIELDS` order (unitCost, unitPrice, costType,
 * taxable, costCode) so lines built in snapshot order already yield a
 * correctly-ordered overall issues array with no extra sort needed —
 * verified directly against `exportIssueOrderIsValid` in tests.
 *
 * Rate and taxable are checked UNCONDITIONALLY, even when classification is
 * null — representability of the line's own stored fields does not depend
 * on whether classification has been reviewed. Cost-code diagnosis is
 * skipped when classification is null: there is no classification object to
 * read `costCodeSource` from, and the missing-classification issue already
 * covers that line; inventing a second, unsupported diagnosis would not be
 * a real fact about the data. This keeps the per-line maximum at four
 * issues either way (checked empirically against the 4-per-line schema
 * ceiling the contract documents), not a potential fifth.
 */
function phase1LineIssues(line: InternalApprovalSnapshot["lines"][number]): CsvIssue[] {
  const issues: CsvIssue[] = [];
  if (formatCsvRateFromDecimal6(line.unitCostSnapshot) === null) {
    issues.push({ code: "CSV_RATE_UNREPRESENTABLE", lineKey: line.lineKey, field: "unitCost" });
  }
  if (formatCsvRateFromDecimal6(line.unitPriceSnapshot) === null) {
    issues.push({ code: "CSV_RATE_UNREPRESENTABLE", lineKey: line.lineKey, field: "unitPrice" });
  }
  const csv = line.csvClassification;
  if (csv === null) {
    issues.push({ code: "CSV_CLASSIFICATION_NOT_REVIEWED", lineKey: line.lineKey, field: "costType" });
  }
  if (line.taxable === null) {
    issues.push({ code: "CSV_TAXABLE_UNKNOWN", lineKey: line.lineKey, field: "taxable" });
  }
  if (csv !== null) {
    // Core invariant: costCodeSource==='unknown' <=> costCode===null — checking
    // either side catches the same case; both never diverge for a validated line.
    if (csv.costCodeSource === "unknown" || csv.costCode === null) {
      issues.push({ code: "CSV_COST_CODE_UNKNOWN", lineKey: line.lineKey, field: "costCode" });
    } else if (!VALID_COST_CODES.includes(csv.costCode)) {
      issues.push({ code: "CSV_COST_CODE_INVALID", lineKey: line.lineKey, field: "costCode" });
    }
  }
  return issues;
}

function buildCsvRow(line: InternalApprovalSnapshot["lines"][number]): CsvRow {
  // Only called once phase 1 is clean for every line: csvClassification,
  // taxable and both rates are guaranteed non-null/representable here.
  const csv = line.csvClassification!;
  return {
    lineKey: line.lineKey, ordinal: line.ordinal, costGroupName: line.costGroupName, costItemName: line.costItemName,
    description: line.description ?? "", quantity: line.quantity, unit: csv.normalizedUnit,
    unitCost: formatCsvRateFromDecimal6(line.unitCostSnapshot)!, unitPrice: formatCsvRateFromDecimal6(line.unitPriceSnapshot)!,
    costType: csv.costType, taxable: line.taxable!, costCode: csv.costCode!, assemblyId: line.assemblyId,
    lineCostMinor: line.lineTotalCostMinor, linePriceMinor: line.lineTotalPriceMinor,
    costTypeSource: csv.costTypeSource, unitSource: csv.unitSource, costCodeSource: csv.costCodeSource,
  };
}

// ── Phase 2 — quantity x rate must reconcile to EACH line's own total ──────
/**
 * The core validates that line totals sum to the financials totals, but
 * never that an individual line's quantity x rate equals ITS OWN total —
 * that gap is exactly what the fixed 9-column CSV format cannot paper over
 * (it has no separate "calculated differently" column). A divergence here
 * is `EXPORT_FORMAT_UNREPRESENTABLE` (the format cannot represent this
 * line), never `EXPORT_RECONCILIATION_MISMATCH` (that code's own grammar
 * requires a non-zero NET price difference at the whole-export level, which
 * need not exist here — a cost-only divergence, or two lines' differences
 * that cancel at the total, are both still per-line unrepresentable).
 */
function phase2RowIssues(row: CsvRow): CsvIssue[] {
  const issues: CsvIssue[] = [];
  if (computeExactAmountMinor(row.quantity, row.unitCost) !== BigInt(row.lineCostMinor)) {
    issues.push({ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: row.lineKey, field: "lineCost" });
  }
  if (computeExactAmountMinor(row.quantity, row.unitPrice) !== BigInt(row.linePriceMinor)) {
    issues.push({ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: row.lineKey, field: "linePrice" });
  }
  return issues;
}
export async function renderExportCsv(value: ExportRenderInput): Promise<CsvRenderOutcome> {
  const input = await parseAndAuthenticate(value, EP.csvRenderer);
  const snapshot = input.snapshot;

  const phase1Issues = snapshot.lines.flatMap(phase1LineIssues);
  if (phase1Issues.length > 0) return { outcome: "blocked", issues: phase1Issues };

  const rows = snapshot.lines.map(buildCsvRow);

  const phase2Issues = rows.flatMap(phase2RowIssues);
  if (phase2Issues.length > 0) return { outcome: "blocked", issues: phase2Issues };

  // Defensive internal-consistency check, reusing the already-accepted
  // correspondence engine: a mismatch here would be a BUG in this module's
  // own construction (phases 1-2 already guarantee representability and
  // per-line extension), never a user-facing business diagnosis — fails
  // closed with the existing integrity error, no partial content.
  for (const row of rows) {
    const correspondence = checkExportCsvRowAgainstLine(row, snapshot);
    if (correspondence.lineMissing || !correspondence.identityMatches || !correspondence.classificationMatches
      || !correspondence.rateExact || !correspondence.amountsExact) {
      throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
    }
  }

  // Phase 3 — whole-export reconciliation. A discount makes the 9 columns
  // (which sum to the undiscounted subtotal) unable to represent the
  // approved final price — the ONLY issue returned when this applies,
  // because phases 1-2 already passed clean by this point.
  const f = snapshot.financials;
  if (f.discountApplied || f.discountMinor !== "0") {
    return { outcome: "blocked", issues: [{ code: "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED", lineKey: null, field: "discount" }] };
  }
  const sumCostMinor = rows.reduce((total, row) => total + BigInt(row.lineCostMinor), 0n);
  const sumPriceMinor = rows.reduce((total, row) => total + BigInt(row.linePriceMinor), 0n);
  if (sumCostMinor !== BigInt(f.estimatedCostMinor) || sumPriceMinor !== BigInt(f.finalPriceMinor)) {
    // The core already guarantees sums of explicit line totals equal the
    // financials totals; divergence here can only be this module's own bug.
    throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
  }

  const text = serializeCsv(rows);
  const bytes = new TextEncoder().encode(text);
  assertWithinResponseLimit(bytes.length);
  const artifactHash = await sha256HexOfBytes(bytes);
  const representation: CsvRepresentation = {
    format: "csv_jobtread", rendererVersion: EP.csvRenderer, mimeType: "text/csv", encoding: "utf8",
    generatedAt: input.generatedAt, generatedBy: input.generatedBy,
    filename: buildExportFilename(input.snapshot.identity.estimateDraftId, input.exportId, "csv_jobtread"),
    artifactHash, byteLength: bytes.length,
    details: {
      contractVersion: EP.csvContract, classificationVersion: AP.classification,
      // `csvHeadersSchema`'s z.tuple(array.map(...)) infers as a zero-length
      // tuple at the TYPE level (a pre-existing zod/TS quirk on the private
      // schema this module can't touch) despite validating 9 elements at
      // runtime — narrow cast isolated to this one field only.
      headers: [...EXPORT_CSV_HEADERS] as unknown as CsvRepresentation["details"]["headers"],
      delimiter: ",", lineEnding: "CRLF", utf8Bom: false,
      rows,
    },
  };
  return { outcome: "ready", bytes, representation };
}
