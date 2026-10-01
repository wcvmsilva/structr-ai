/**
 * A1 export manifest — pure grammar and non-SQL correspondence only. No persistence,
 * authority, renderer bytes or delivery command. See the three-tier split documented
 * at the top of `server/a1-export-manifest-engine.test.ts`:
 *   1. normalizeExportManifest            — structural parse of the closed envelope,
 *      including the FULL local state matrix of §§3.2/4/5.2 (authority presence,
 *      totals, reconciliation/validation state, client nullability, CSV-exclusive
 *      issue codes) derived purely from the manifest's own declared `outcome`,
 *      `format` and principal issue code — no database.
 *   2. checkExportManifestAgainstSnapshot — pure correspondence to a typed snapshot:
 *      actually COMPARES declared values to the snapshot (hash, totals, LineKeys,
 *      CSV rows/sums), returning match/mismatch/null (not applicable), never just the
 *      expected value alone. Gated solely on whether `manifest.authority` is itself
 *      non-null — no external flag parameter exists to suppress a comparison that's
 *      already derivable from the two arguments given.
 *   3. authority (existence/currency of a decision) is explicitly OUT of this module;
 *      it requires locks and a real database read, which this engine never performs
 *      and never accepts a substitute flag for.
 */
import { z } from "zod";
import {
  InternalApprovalError, internalApprovalVersionPrimitives as p,
  guardInternalApprovalJsonSchema as guarded, parseInternalApprovalData as parse,
  hashInternalApprovalContent, type InternalApprovalSnapshot,
} from "./internal-estimate-approval-engine";
import {
  EXPORT_FORMATS, EXPORT_ATTEMPT_KINDS, EXPORT_OUTCOMES, EXPORT_RECONCILIATION_STATES,
  EXPORT_VALIDATION_STATES, EXPORT_ISSUE_FIELDS, EXPORT_ISSUE_CODES, EXPORT_PROTOCOL as EP,
  EXPORT_CSV_HEADERS, EXPORT_MANIFEST_BYTE_LIMIT, INTERNAL_APPROVAL_CSV_COST_TYPES,
  INTERNAL_APPROVAL_CSV_UNITS, INTERNAL_APPROVAL_CSV_UNIT_SOURCES, INTERNAL_APPROVAL_CSV_CODE_SOURCES,
  INTERNAL_APPROVAL_PROTOCOL as AP, type ExportFormat, type ExportIssueCode,
} from "./domain/taxonomy";
import { VALID_COST_CODES } from "./domain/cost-codes";

function fail(code: "INTERNAL_APPROVAL_INPUT_INVALID" | "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" = "INTERNAL_APPROVAL_INPUT_INVALID"): never {
  throw new InternalApprovalError(code);
}
function issue(ctx: z.RefinementCtx, path: (string | number)[], code: "INTERNAL_APPROVAL_INPUT_INVALID" | "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" = "INTERNAL_APPROVAL_CONTENT_UNRESOLVED"): void {
  ctx.addIssue({ code: "custom", path, message: code, params: { approvalCode: code } });
}

// ── Primitives (§1) ─────────────────────────────────────────────────────────
const EXT_BY_FORMAT: Record<ExportFormat, string> = { pdf: "pdf", json: "json", printable: "html", csv_jobtread: "csv" };
export function buildExportFilename(draftId: string, exportId: string, format: ExportFormat): string {
  return `EST-${draftId}-${exportId}.${EXT_BY_FORMAT[format]}`;
}
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const filenameSchema = z.string().regex(new RegExp(`^EST-${UUID_RE}-${UUID_RE}\\.(pdf|json|html|csv)$`));
const lineKeySchema = z.string().regex(/^line:([1-9][0-9]{0,2}|1000)$/);
export function lineKeyOrdinal(lineKey: string): number { return Number(lineKey.slice(5)); }

// ── §4/§5.2 principal-issue-code matrix — pure, no snapshot/DB needed ──────
/** The six "no usable decision" codes: authority must be NULL; no totals at all. */
const AUTHORITY_NULL_CODES: readonly ExportIssueCode[] = [
  "INTERNAL_APPROVAL_REQUIRED", "INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED",
  "HISTORICAL_AUTHORITY_NOT_AVAILABLE", "ESTIMATE_CLIENT_MISSING", "ESTIMATE_CLIENT_CONTEXT_MISMATCH",
  "INTERNAL_APPROVAL_CONTENT_UNRESOLVED",
];
/**
 * The two codes clientId=NULL is tied to (§§3.2/4) — not merely permitted but
 * REQUIRED alongside them: a non-null UUID would be a contradictory client claim
 * recorded as if canonical, which §3.2 forbids outright.
 */
const CLIENT_NULL_PERMITTING_CODES: readonly ExportIssueCode[] = ["ESTIMATE_CLIENT_MISSING", "ESTIMATE_CLIENT_CONTEXT_MISMATCH"];
/** §5.4: these codes are specific to the CSV representation and never justify blocking any other format. */
const CSV_EXCLUSIVE_CODES: readonly ExportIssueCode[] = [
  "CSV_CLASSIFICATION_NOT_REVIEWED", "CSV_TAXABLE_UNKNOWN", "CSV_UNIT_UNREPRESENTABLE", "CSV_RATE_UNREPRESENTABLE",
  "CSV_LINE_IDENTITY_INVALID", "CSV_COST_CODE_UNKNOWN", "CSV_COST_CODE_INVALID",
];
type TotalsClass = "none" | "approvedOnly" | "full";
interface IssueClassRule { rank: 0 | 1 | 2; validationState: (typeof EXPORT_VALIDATION_STATES)[number]; reconciliationState: (typeof EXPORT_RECONCILIATION_STATES)[number]; totals: TotalsClass }
const ISSUE_CLASS_RULE: Record<ExportIssueCode, IssueClassRule> = {
  INTERNAL_APPROVAL_REQUIRED: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none" },
  INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none" },
  HISTORICAL_AUTHORITY_NOT_AVAILABLE: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none" },
  ESTIMATE_CLIENT_MISSING: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none" },
  ESTIMATE_CLIENT_CONTEXT_MISMATCH: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none" },
  INTERNAL_APPROVAL_CONTENT_UNRESOLVED: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none" },
  INTERNAL_APPROVAL_REVOKED: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "approvedOnly" },
  ESTIMATE_SUPERSEDED: { rank: 0, validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "approvedOnly" },
  EXPORT_FORMAT_UNREPRESENTABLE: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  CSV_CLASSIFICATION_NOT_REVIEWED: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  CSV_TAXABLE_UNKNOWN: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  CSV_UNIT_UNREPRESENTABLE: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  CSV_RATE_UNREPRESENTABLE: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  CSV_LINE_IDENTITY_INVALID: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  CSV_COST_CODE_UNKNOWN: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  CSV_COST_CODE_INVALID: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  EXPORT_RENDERER_UNAVAILABLE: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  EXPORT_PAYLOAD_TOO_LARGE: { rank: 1, validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly" },
  EXPORT_RECONCILIATION_MISMATCH: { rank: 2, validationState: "invalid", reconciliationState: "mismatch", totals: "full" },
  EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED: { rank: 2, validationState: "invalid", reconciliationState: "unrepresentable", totals: "full" },
};

// ── Envelope pieces (§5.1/5.2/5.3) ─────────────────────────────────────────
const contextSchema = z.object({
  tenantId: p.uuid, projectId: p.uuid, clientId: p.uuid.nullable(), estimateDraftId: p.uuid,
  estimateVersion: p.version, requestedBy: p.uuid,
}).strict();
const authoritySchema = z.object({ approvalId: p.uuid, snapshotId: p.uuid, contentHash: p.hash }).strict().nullable();
const issueSchema = z.object({
  code: z.enum(EXPORT_ISSUE_CODES), lineKey: lineKeySchema.nullable(), field: z.enum(EXPORT_ISSUE_FIELDS).nullable(),
}).strict();
/** Pure §5.2 "Ordem": class precedence, then ascending LineKey ordinal, then field-table order. No duplicate triple. */
export function exportIssueOrderIsValid(issues: readonly { code: ExportIssueCode; lineKey: string | null; field: string | null }[]): boolean {
  const seen = new Set<string>();
  let previous: { rank: number; ordinal: number; fieldIndex: number } | null = null;
  for (const entry of issues) {
    const key = JSON.stringify([entry.code, entry.lineKey, entry.field]);
    if (seen.has(key)) return false;
    seen.add(key);
    const rank = ISSUE_CLASS_RULE[entry.code].rank;
    const ordinal = entry.lineKey === null ? -1 : lineKeyOrdinal(entry.lineKey);
    const fieldIndex = entry.field === null ? -1 : EXPORT_ISSUE_FIELDS.indexOf(entry.field as (typeof EXPORT_ISSUE_FIELDS)[number]);
    if (previous) {
      const current = { rank, ordinal, fieldIndex };
      if (current.rank < previous.rank) return false;
      if (current.rank === previous.rank) {
        if (current.ordinal < previous.ordinal) return false;
        if (current.ordinal === previous.ordinal && current.fieldIndex < previous.fieldIndex) return false;
      }
    }
    previous = { rank, ordinal, fieldIndex };
  }
  return true;
}
const issuesArraySchema = z.array(issueSchema).max(4002).superRefine((v, ctx) => {
  if (!exportIssueOrderIsValid(v)) issue(ctx, ["issues"]);
});
const reconciliationSchema = z.object({
  state: z.enum(EXPORT_RECONCILIATION_STATES), approvedTotalMinor: p.minor.nullable(),
  exportedTotalMinor: p.minor.nullable(), differenceMinor: p.signedMinor.nullable(), estimatedCostMinor: p.minor.nullable(),
}).strict();
const validationSchema = z.object({
  version: z.literal(EP.validation), state: z.enum(EXPORT_VALIDATION_STATES),
  issues: issuesArraySchema, reconciliation: reconciliationSchema,
}).strict();

// ── Representation (§5.3/§5.4) ─────────────────────────────────────────────
const pdfDetails = z.object({ layoutVersion: z.literal(EP.pdfLayout), pageCount: z.number().int().min(1).max(10000) }).strict();
const jsonDetails = z.object({ documentVersion: z.literal(EP.document), serialization: z.literal(EP.jsonSerialization) }).strict();
const printableDetails = z.object({ templateVersion: z.literal(EP.printableTemplate), escaping: z.literal(EP.printableEscaping), sandbox: z.literal(EP.printableSandbox) }).strict();
const usdTwoDecimal = z.string().regex(/^(0|[1-9][0-9]{0,13})\.[0-9]{2}$/);
const csvCostCodeSchema = z.string().refine(v => VALID_COST_CODES.includes(v));
/**
 * Recorded evidence copy fields must be rejected, not silently re-normalized, when
 * they diverge from their own canonical form. `p.label`/`p.text` legitimately
 * trim/CRLF-normalize fresh REVIEW input (the core's own rule, unchanged here); a
 * manifest row claiming to COPY an already-canonical persisted value must already BE
 * canonical, or the copy is wrong — reuse the schema's own bounds/Unicode validation
 * but require the transform to be a no-op (idempotent), never apply it silently.
 */
function canonicalCopy(schema: z.ZodType<string>): z.ZodType<string> {
  return z.string().superRefine((v, ctx) => {
    const result = schema.safeParse(v);
    if (!result.success || result.data !== v) issue(ctx, []);
  }) as unknown as z.ZodType<string>;
}
const canonicalLabel = canonicalCopy(p.label);
const canonicalDescription = canonicalCopy(p.text(0, 5000, false));
const csvRowSchema = z.object({
  lineKey: lineKeySchema, ordinal: p.ordinal, costGroupName: canonicalLabel, costItemName: canonicalLabel,
  description: canonicalDescription, quantity: p.positiveDecimal, unit: z.enum(INTERNAL_APPROVAL_CSV_UNITS),
  unitCost: usdTwoDecimal, unitPrice: usdTwoDecimal, costType: z.enum(INTERNAL_APPROVAL_CSV_COST_TYPES),
  taxable: z.boolean(), costCode: csvCostCodeSchema.nullable(), assemblyId: p.uuid.nullable(),
  lineCostMinor: p.minor, linePriceMinor: p.minor, costTypeSource: z.literal(AP.costTypeSource),
  unitSource: z.enum(INTERNAL_APPROVAL_CSV_UNIT_SOURCES), costCodeSource: z.enum(INTERNAL_APPROVAL_CSV_CODE_SOURCES),
}).strict().superRefine((v, ctx) => {
  if (v.lineKey !== `line:${v.ordinal}`) issue(ctx, ["lineKey"]);
  // A ready CSV row never carries unreviewed/unknown classification — §5.4: unknown
  // code/classification/taxable must block ready CSV before a row like this exists.
  // Since "unknown" is the only source value permitting a null costCode, banning it
  // also makes costCode===null unreachable for a ready row — enforce both directly.
  if (v.costCodeSource === INTERNAL_APPROVAL_CSV_CODE_SOURCES[2] || v.costCode === null) issue(ctx, ["costCodeSource"]);
});
const csvHeadersSchema = z.tuple(EXPORT_CSV_HEADERS.map(h => z.literal(h)) as unknown as [z.ZodLiteral<string>, ...z.ZodLiteral<string>[]]);
const csvDetails = z.object({
  contractVersion: z.literal(EP.csvContract), classificationVersion: z.literal(AP.classification),
  headers: csvHeadersSchema, delimiter: z.literal(","), lineEnding: z.literal("CRLF"),
  utf8Bom: z.literal(false), rows: z.array(csvRowSchema).min(1).max(1000),
}).strict().superRefine((v, ctx) => {
  v.rows.forEach((row, i) => { if (row.ordinal !== i + 1) issue(ctx, ["rows", i, "ordinal"]); });
});
const representationCommon = { generatedAt: p.timestamp, generatedBy: p.uuid, filename: filenameSchema, artifactHash: p.hash, byteLength: z.number().int().min(1).max(10_485_760) };
const representationSchema = z.discriminatedUnion("format", [
  z.object({ ...representationCommon, format: z.literal("pdf"), rendererVersion: z.literal(EP.pdfRenderer), mimeType: z.literal("application/pdf"), encoding: z.literal("base64"), details: pdfDetails }).strict(),
  z.object({ ...representationCommon, format: z.literal("json"), rendererVersion: z.literal(EP.jsonRenderer), mimeType: z.literal("application/json"), encoding: z.literal("utf8"), details: jsonDetails }).strict(),
  z.object({ ...representationCommon, format: z.literal("printable"), rendererVersion: z.literal(EP.printableRenderer), mimeType: z.literal("text/html"), encoding: z.literal("utf8"), details: printableDetails }).strict(),
  z.object({ ...representationCommon, format: z.literal("csv_jobtread"), rendererVersion: z.literal(EP.csvRenderer), mimeType: z.literal("text/csv"), encoding: z.literal("utf8"), details: csvDetails }).strict(),
]).superRefine((v, ctx) => {
  const expectedExt = EXT_BY_FORMAT[v.format];
  if (!v.filename.endsWith(`.${expectedExt}`)) issue(ctx, ["filename"]);
});

// ── Envelope (§5.1) ──────────────────────────────────────────────────────────
const envelopeBase = z.object({
  version: z.literal(EP.manifest), format: z.enum(EXPORT_FORMATS), attemptKind: z.enum(EXPORT_ATTEMPT_KINDS),
  outcome: z.enum(EXPORT_OUTCOMES), exportId: p.uuid, context: contextSchema, authority: authoritySchema,
  checkedAt: p.timestamp, lineKeys: z.array(lineKeySchema).max(1000), validation: validationSchema,
  representation: representationSchema.nullable(),
}).strict();
function minorValue(value: string | null): bigint | null { return value === null ? null : BigInt(value); }
export const exportManifestSchema = guarded(envelopeBase.superRefine((v, ctx) => {
  const ready = v.outcome === "ready";
  const principal = v.validation.issues[0]?.code ?? null;
  const rule: IssueClassRule | null = ready
    ? { rank: 0, validationState: "valid", reconciliationState: "matched", totals: "full" }
    : principal !== null ? ISSUE_CLASS_RULE[principal] : null;

  if (ready) {
    if (v.representation === null) issue(ctx, ["representation"]);
    if (v.lineKeys.length < 1) issue(ctx, ["lineKeys"]);
    if (v.validation.issues.length !== 0) issue(ctx, ["validation", "issues"]);
    if (v.authority === null) issue(ctx, ["authority"]);
    if (v.representation !== null && v.representation.format !== v.format) issue(ctx, ["representation", "format"]);
  } else {
    if (v.representation !== null) issue(ctx, ["representation"]);
    if (v.lineKeys.length !== 0) issue(ctx, ["lineKeys"]);
    if (v.validation.issues.length < 1) issue(ctx, ["validation", "issues"]);
  }
  if (rule) {
    if (v.validation.state !== rule.validationState) issue(ctx, ["validation", "state"]);
    if (v.validation.reconciliation.state !== rule.reconciliationState) issue(ctx, ["validation", "reconciliation", "state"]);
    const r = v.validation.reconciliation;
    const approvedNN = rule.totals !== "none", exportedNN = rule.totals === "full";
    if ((r.approvedTotalMinor !== null) !== approvedNN) issue(ctx, ["validation", "reconciliation", "approvedTotalMinor"]);
    if ((r.estimatedCostMinor !== null) !== approvedNN) issue(ctx, ["validation", "reconciliation", "estimatedCostMinor"]);
    if ((r.exportedTotalMinor !== null) !== exportedNN) issue(ctx, ["validation", "reconciliation", "exportedTotalMinor"]);
    if ((r.differenceMinor !== null) !== exportedNN) issue(ctx, ["validation", "reconciliation", "differenceMinor"]);
    if (exportedNN && r.approvedTotalMinor !== null && r.exportedTotalMinor !== null && r.differenceMinor !== null) {
      const expectedDifference = minorValue(r.exportedTotalMinor)! - minorValue(r.approvedTotalMinor)!;
      if (expectedDifference !== BigInt(r.differenceMinor)) issue(ctx, ["validation", "reconciliation", "differenceMinor"]);
      // "mismatch" declares a divergence; a real zero difference contradicts the
      // code's own meaning (§4). EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED is exempt:
      // an adjustment can be unrepresentable with no net difference at all.
      if (principal === "EXPORT_RECONCILIATION_MISMATCH" && r.differenceMinor === "0") issue(ctx, ["validation", "reconciliation", "differenceMinor"]);
    }
    if (ready && r.approvedTotalMinor !== null && r.exportedTotalMinor !== null) {
      if (r.approvedTotalMinor !== r.exportedTotalMinor || BigInt(r.approvedTotalMinor) <= 0n) issue(ctx, ["validation", "reconciliation", "approvedTotalMinor"]);
    }
    const authorityMustBeNull = !ready && principal !== null && AUTHORITY_NULL_CODES.includes(principal);
    if ((v.authority === null) !== authorityMustBeNull) issue(ctx, ["authority"]);
  }
  const distinctLineKeys = new Set(v.lineKeys);
  if (distinctLineKeys.size !== v.lineKeys.length) issue(ctx, ["lineKeys"]);
  v.lineKeys.forEach((key, i) => { if (lineKeyOrdinal(key) !== i + 1) issue(ctx, ["lineKeys", i]); });
  // §3.2: NULL is REQUIRED exactly when one of the two client codes is principal,
  // and FORBIDDEN otherwise — never a non-null UUID recorded as if canonical
  // alongside a code that says the client is missing or context-mismatched.
  const clientNullRequired = principal !== null && CLIENT_NULL_PERMITTING_CODES.includes(principal);
  if ((v.context.clientId === null) !== clientNullRequired) issue(ctx, ["context", "clientId"]);
  // §5.4: a CSV-exclusive issue code — anywhere in the array, not only the
  // principal — never justifies blocking a non-CSV format.
  if (v.format !== "csv_jobtread" && v.validation.issues.some(entry => CSV_EXCLUSIVE_CODES.includes(entry.code))) {
    issue(ctx, ["format"]);
  }
  if (v.representation !== null) {
    if (v.representation.generatedAt > v.checkedAt) issue(ctx, ["representation", "generatedAt"]);
    if (v.representation.generatedBy !== v.context.requestedBy) issue(ctx, ["representation", "generatedBy"]);
    if (v.representation.filename !== buildExportFilename(v.context.estimateDraftId, v.exportId, v.representation.format)) issue(ctx, ["representation", "filename"]);
    if (v.representation.format === "csv_jobtread" && v.representation.details.rows.length !== v.lineKeys.length) {
      issue(ctx, ["representation", "details", "rows"]);
    }
  }
}));
export type ExportManifest = z.infer<typeof exportManifestSchema>;
export function normalizeExportManifest(value: unknown): ExportManifest {
  return parse(exportManifestSchema, value);
}

// ── Correspondence to a typed snapshot (§6, non-SQL) ───────────────────────
/**
 * Exact quantity×rate extension in minor units (cents), half-away-from-zero at the
 * cent — §7's explicit rounding rule. `quantity` is a non-negative Decimal6 string
 * (PositiveDecimal6 grammar: no sign); `rateTwoDecimal` is a non-negative two-decimal
 * USD string (`usdTwoDecimal` grammar: no sign). Exact rational math via BigInt —
 * never Number/float.
 */
export function computeExactAmountMinor(quantity: string, rateTwoDecimal: string): bigint {
  const [qWhole, qFraction = ""] = quantity.split(".");
  const qScale = qFraction.length;
  const quantityNumerator = BigInt(qWhole + qFraction);
  const [rWhole, rFraction = "00"] = rateTwoDecimal.split(".");
  const rateCentsNumerator = BigInt(rWhole + rFraction);
  // (quantity * 10^qScale) * (rate * 100) / 10^qScale = quantity * rate * 100 = cents.
  const numerator = quantityNumerator * rateCentsNumerator;
  const denominator = 10n ** BigInt(qScale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  return 2n * remainder >= denominator ? quotient + 1n : quotient;
}
export interface ExportManifestCorrespondence {
  contextMatches: boolean;
  unknownLineKeys: string[];
  lineKeysMatchSnapshotExactly: boolean | null;
  contentHashMatches: boolean | null;
  approvedTotalMatches: boolean | null;
  estimatedCostMatches: boolean | null;
  csv: CsvManifestCorrespondence | null;
}
export async function checkExportManifestAgainstSnapshot(
  manifest: ExportManifest,
  snapshot: InternalApprovalSnapshot,
): Promise<ExportManifestCorrespondence> {
  const identity = snapshot.identity;
  const contextMatches = manifest.context.tenantId === identity.tenantId
    && manifest.context.projectId === identity.projectId
    && manifest.context.clientId === identity.clientId
    && manifest.context.estimateDraftId === identity.estimateDraftId
    && manifest.context.estimateVersion === identity.draftVersion;
  const snapshotLineKeys = new Set(snapshot.lines.map(line => line.lineKey));
  const referencedLineKeys = [
    ...manifest.lineKeys,
    ...manifest.validation.issues.map(entry => entry.lineKey).filter((key): key is string => key !== null),
  ];
  const unknownLineKeys = Array.from(new Set(referencedLineKeys.filter(key => !snapshotLineKeys.has(key))));
  // Only "ready" declares a lineKeys sequence at all (§4); blocked is always [] by
  // norm — comparing it against the snapshot's full line list would flag every
  // legitimate blocked-with-known-decision manifest as a false mismatch. Not
  // applicable there, not a silent pass: null, distinct from both true and false.
  const snapshotOrder = snapshot.lines.map(line => line.lineKey);
  const lineKeysMatchSnapshotExactly = manifest.outcome === "ready"
    ? manifest.lineKeys.length === snapshotOrder.length && manifest.lineKeys.every((key, i) => key === snapshotOrder[i])
    : null;

  // Gated ONLY on the manifest's OWN declared authority — never an external flag.
  // Both arguments are already in hand; a caller cannot opt out of a comparison its
  // own arguments make derivable (MICHAEL-A1-EXPORT-MANIFEST-V2-QA-AND-CORRECTION.md
  // group 2). Whether that authority is itself current/real is a separate, DB-backed
  // question this engine never answers.
  const authorityPresent = manifest.authority !== null;
  const contentHashMatches = authorityPresent ? manifest.authority!.contentHash === await hashInternalApprovalContent(snapshot) : null;
  const approvedTotalMatches = authorityPresent ? manifest.validation.reconciliation.approvedTotalMinor === snapshot.financials.finalPriceMinor : null;
  const estimatedCostMatches = authorityPresent ? manifest.validation.reconciliation.estimatedCostMinor === snapshot.financials.estimatedCostMinor : null;

  const csv = manifest.representation?.format === "csv_jobtread"
    ? checkExportCsvAgainstSnapshot(manifest.representation.details.rows, snapshot, manifest.validation.reconciliation)
    : null;

  return { contextMatches, unknownLineKeys, lineKeysMatchSnapshotExactly, contentHashMatches, approvedTotalMatches, estimatedCostMatches, csv };
}

/** Pure per-row CSV correspondence to its matching snapshot line. No snapshot-wide totals here. */
export interface CsvRowCorrespondence { lineKey: string; lineMissing: boolean; identityMatches: boolean; classificationMatches: boolean; rateExact: boolean; amountsExact: boolean }
export function checkExportCsvRowAgainstLine(
  row: z.infer<typeof csvRowSchema>,
  snapshot: InternalApprovalSnapshot,
): CsvRowCorrespondence {
  const line = snapshot.lines.find(candidate => candidate.lineKey === row.lineKey);
  if (!line) return { lineKey: row.lineKey, lineMissing: true, identityMatches: false, classificationMatches: false, rateExact: false, amountsExact: false };
  const expectedDescription = line.description ?? "";
  const identityMatches = line.costGroupName === row.costGroupName && line.costItemName === row.costItemName
    && expectedDescription === row.description && line.quantity === row.quantity && line.assemblyId === row.assemblyId
    && line.taxable === row.taxable && line.lineTotalCostMinor === row.lineCostMinor && line.lineTotalPriceMinor === row.linePriceMinor;
  const csv = line.csvClassification;
  const classificationMatches = csv !== null
    && csv.costType === row.costType && csv.normalizedUnit === row.unit
    && csv.costCode === row.costCode && csv.unitSource === row.unitSource && csv.costCodeSource === row.costCodeSource;
  const exactTwoDecimal = (snapshotValue: string | null, candidate: string): boolean => {
    if (snapshotValue === null) return false;
    const [whole, fraction = ""] = snapshotValue.split(".");
    if (fraction.length > 2) return false;
    return `${whole}.${fraction.padEnd(2, "0")}` === candidate;
  };
  const rateExact = exactTwoDecimal(line.unitCostSnapshot, row.unitCost) && exactTwoDecimal(line.unitPriceSnapshot, row.unitPrice);
  // §6.4/§7: the REPRESENTED quantity×rate must reconcile to the REPRESENTED total —
  // not merely "both copied from the snapshot," which the snapshot itself never
  // cross-validates (MICHAEL-A1-EXPORT-MANIFEST-V2-QA-AND-CORRECTION.md group 1).
  const amountsExact = computeExactAmountMinor(row.quantity, row.unitCost) === BigInt(row.lineCostMinor)
    && computeExactAmountMinor(row.quantity, row.unitPrice) === BigInt(row.linePriceMinor);
  return { lineKey: row.lineKey, lineMissing: false, identityMatches, classificationMatches, rateExact, amountsExact };
}

/** Composed CSV-wide correspondence: every row, the represented sums, and whether a
 *  discount (which CSV's 9 columns have no way to represent) is being hidden. */
export interface CsvManifestCorrespondence { rows: CsvRowCorrespondence[]; sumCostMatches: boolean; sumPriceMatches: boolean; discountRepresentable: boolean }
function checkExportCsvAgainstSnapshot(
  rows: readonly z.infer<typeof csvRowSchema>[],
  snapshot: InternalApprovalSnapshot,
  reconciliation: { exportedTotalMinor: string | null; estimatedCostMinor: string | null },
): CsvManifestCorrespondence {
  const rowResults = rows.map(row => checkExportCsvRowAgainstLine(row, snapshot));
  const sumCost = rows.reduce((total, row) => total + BigInt(row.lineCostMinor), 0n);
  const sumPrice = rows.reduce((total, row) => total + BigInt(row.linePriceMinor), 0n);
  const sumCostMatches = reconciliation.estimatedCostMinor !== null && sumCost === BigInt(reconciliation.estimatedCostMinor);
  const sumPriceMatches = reconciliation.exportedTotalMinor !== null && sumPrice === BigInt(reconciliation.exportedTotalMinor);
  const discountRepresentable = !snapshot.financials.discountApplied && snapshot.financials.discountMinor === "0";
  return { rows: rowResults, sumCostMatches, sumPriceMatches, discountRepresentable };
}

export const EXPORT_MANIFEST_BYTE_LIMIT_CONSTANT = EXPORT_MANIFEST_BYTE_LIMIT;
