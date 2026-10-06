/**
 * A1 export preflight writer — strict `ExportAttemptSummary` response DTO (§9).
 * `server/internal-estimate-export-db.ts`'s `createExportAttempt` must parse its
 * return value through this schema before the final transaction's callback
 * resolves — no extra/competing field leaves the writer, and a failure here
 * aborts the whole transaction (no partially-accepted attempt).
 *
 * MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V2-QA-AND-CORRECTION.md item A: V2's
 * `superRefine` only checked four relations (outcome/status/availability/
 * artifact presence, issues non-empty). Nine invalid DTOs were accepted
 * (`dto-probe.mjs`/`dto-results.json`): ready without authority, ready with an
 * invalid validation.state, ready/matched with every total NULL, ready/matched
 * with a contradictory nonzero/negative difference, a preflight response
 * claiming status "downloaded" (only reachable later, via an actual delivery
 * action this writer never performs), an artifact generated AFTER checkedAt,
 * INTERNAL_APPROVAL_REQUIRED with authority supplied, INTERNAL_APPROVAL_REQUIRED
 * with the wrong blocked status, and a JSON artifact carrying a PDF
 * rendererVersion. This file now mirrors the SAME per-code rank/validationState/
 * reconciliationState/totals-class matrix `internal-estimate-export-engine.ts`'s
 * private `ISSUE_CLASS_RULE` and `exportManifestSchema`'s `superRefine` already
 * enforce on the manifest — extended with the STATUS mapping migration 0014
 * repairs — rather than inventing a second, divergent set of relations. That
 * module's schemas/constants are private and the module itself is off-limits to
 * edit under this contract's boundary; the table below is reproduced, not
 * imported, for exactly that reason.
 *
 * Reuses the SAME primitives/enums the already-accepted manifest engine uses
 * (`internalApprovalVersionPrimitives`, `EXPORT_*` taxonomy, the engine's own
 * exported `exportIssueOrderIsValid`) — never a second, competing vocabulary.
 */
import { z } from "zod";
import { InternalApprovalError, internalApprovalVersionPrimitives as p } from "./internal-estimate-approval-engine";
import {
  EXPORT_FORMATS, EXPORT_OUTCOMES, EXPORT_STATUSES, EXPORT_VALIDATION_STATES,
  EXPORT_RECONCILIATION_STATES, EXPORT_ISSUE_CODES, EXPORT_ISSUE_FIELDS, EXPORT_PROTOCOL as EP,
  type ExportFormat, type ExportIssueCode,
} from "./domain/taxonomy";
import { exportIssueOrderIsValid } from "./internal-estimate-export-engine";

// Mirrors internal-estimate-export-engine.ts's private lineKeySchema exactly —
// that module cannot be edited to export it under this contract's boundaries.
// Exported (MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 1): the
// history projection in server/jobtread-export-db.ts needs the SAME
// constraint on its own issues array — reused here rather than mirrored a
// third time.
export const lineKeySchema = z.string().regex(/^line:([1-9][0-9]{0,2}|1000)$/);
const authoritySchema = z.object({ approvalId: p.uuid, snapshotId: p.uuid, contentHash: p.hash }).strict().nullable();
const issueSchema = z.object({
  code: z.enum(EXPORT_ISSUE_CODES), lineKey: lineKeySchema.nullable(), field: z.enum(EXPORT_ISSUE_FIELDS).nullable(),
}).strict();
const issuesArraySchema = z.array(issueSchema).max(4002).superRefine((v, ctx) => {
  if (!exportIssueOrderIsValid(v)) ctx.addIssue({ code: "custom", path: ["issues"], message: "EXPORT_ATTEMPT_ISSUES_UNORDERED" });
});
const reconciliationSchema = z.object({
  state: z.enum(EXPORT_RECONCILIATION_STATES), approvedTotalMinor: p.minor.nullable(),
  exportedTotalMinor: p.minor.nullable(), differenceMinor: p.signedMinor.nullable(), estimatedCostMinor: p.minor.nullable(),
}).strict();
const validationSchema = z.object({
  state: z.enum(EXPORT_VALIDATION_STATES), issues: issuesArraySchema, reconciliation: reconciliationSchema,
}).strict();
const artifactSchema = z.object({
  artifactHash: p.hash, byteLength: z.number().int().min(1).max(10_485_760),
  rendererVersion: z.string().min(1), generatedAt: p.timestamp,
}).strict().nullable();

// Mirrors internal-estimate-export-engine.ts's private ISSUE_CLASS_RULE
// (rank/validationState/reconciliationState/totals, 0013) EXTENDED with the
// STATUS each class maps to after migration 0014's repair (item 1 of V2):
// rank 0 -> blocked_authorization; rank 1 -> blocked_validation; rank 2 splits
// into blocked_reconciliation (EXPORT_RECONCILIATION_MISMATCH) and
// needs_exception_review (EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED) — the
// SAME split server/internal-estimate-export-db.ts's statusForCode mirrors
// from drizzle/0014_a1_export_issue_status_class_fix.sql.
export type TotalsClass = "none" | "approvedOnly" | "full";
export type AttemptStatus = (typeof EXPORT_STATUSES)[number];
export interface IssueClassRule { validationState: (typeof EXPORT_VALIDATION_STATES)[number]; reconciliationState: (typeof EXPORT_RECONCILIATION_STATES)[number]; totals: TotalsClass; status: AttemptStatus }
// Exported (V3 frente 1): the history projection needs the SAME per-code
// validationState/reconciliationState/totals/status matrix this writer's own
// response schema already enforces — importing it here means history can
// never drift into a second, more permissive table.
export const ISSUE_CLASS_RULE: Record<ExportIssueCode, IssueClassRule> = {
  INTERNAL_APPROVAL_REQUIRED: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none", status: "blocked_authorization" },
  INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none", status: "blocked_authorization" },
  HISTORICAL_AUTHORITY_NOT_AVAILABLE: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none", status: "blocked_authorization" },
  ESTIMATE_CLIENT_MISSING: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none", status: "blocked_authorization" },
  ESTIMATE_CLIENT_CONTEXT_MISMATCH: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none", status: "blocked_authorization" },
  INTERNAL_APPROVAL_CONTENT_UNRESOLVED: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "none", status: "blocked_authorization" },
  INTERNAL_APPROVAL_REVOKED: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "approvedOnly", status: "blocked_authorization" },
  ESTIMATE_SUPERSEDED: { validationState: "not_evaluated", reconciliationState: "not_evaluated", totals: "approvedOnly", status: "blocked_authorization" },
  EXPORT_FORMAT_UNREPRESENTABLE: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  CSV_CLASSIFICATION_NOT_REVIEWED: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  CSV_TAXABLE_UNKNOWN: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  CSV_UNIT_UNREPRESENTABLE: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  CSV_RATE_UNREPRESENTABLE: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  CSV_LINE_IDENTITY_INVALID: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  CSV_COST_CODE_UNKNOWN: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  CSV_COST_CODE_INVALID: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  EXPORT_RENDERER_UNAVAILABLE: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  EXPORT_PAYLOAD_TOO_LARGE: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "approvedOnly", status: "blocked_validation" },
  EXPORT_RECONCILIATION_MISMATCH: { validationState: "invalid", reconciliationState: "mismatch", totals: "full", status: "blocked_reconciliation" },
  EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED: { validationState: "invalid", reconciliationState: "unrepresentable", totals: "full", status: "needs_exception_review" },
};
// The six "no usable decision" codes: authority must be NULL; no totals at all.
// Exported (V3 frente 1) for the same reason as ISSUE_CLASS_RULE above.
export const AUTHORITY_NULL_CODES: readonly ExportIssueCode[] = [
  "INTERNAL_APPROVAL_REQUIRED", "INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED",
  "HISTORICAL_AUTHORITY_NOT_AVAILABLE", "ESTIMATE_CLIENT_MISSING", "ESTIMATE_CLIENT_CONTEXT_MISMATCH",
  "INTERNAL_APPROVAL_CONTENT_UNRESOLVED",
];
// MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V3-QA-SUPPLEMENT.md item 1: mirrors
// internal-estimate-export-engine.ts:253's §5.4 relation exactly — these seven
// codes are specific to the CSV representation and never justify blocking any
// OTHER format, whether principal (issues[0]) or anywhere else in the array.
// `CSV_EXCLUSIVE_CODES` itself is private there too; reproduced, not imported.
export const CSV_EXCLUSIVE_CODES: readonly ExportIssueCode[] = [
  "CSV_CLASSIFICATION_NOT_REVIEWED", "CSV_TAXABLE_UNKNOWN", "CSV_UNIT_UNREPRESENTABLE", "CSV_RATE_UNREPRESENTABLE",
  "CSV_LINE_IDENTITY_INVALID", "CSV_COST_CODE_UNKNOWN", "CSV_COST_CODE_INVALID",
];
// Mirrors the writer's own RENDERER_VERSION_BY_FORMAT (server/internal-estimate-
// export-db.ts) — built directly from the already-public EP taxonomy constants,
// no boundary issue reusing these (unlike the engine's private schemas above).
// Exported (V3 frente 1) for the same reason as ISSUE_CLASS_RULE above.
export const RENDERER_VERSION_BY_FORMAT: Record<ExportFormat, string> = {
  pdf: EP.pdfRenderer, json: EP.jsonRenderer, printable: EP.printableRenderer, csv_jobtread: EP.csvRenderer,
};
export function minorValue(value: string | null): bigint | null { return value === null ? null : BigInt(value); }

export const exportAttemptSummarySchema = z.object({
  exportId: p.uuid, estimateId: p.uuid, format: z.enum(EXPORT_FORMATS), kind: z.literal("preflight"),
  outcome: z.enum(EXPORT_OUTCOMES), status: z.enum(EXPORT_STATUSES), checkedAt: p.timestamp,
  authority: authoritySchema, validation: validationSchema, artifact: artifactSchema,
  availability: z.enum(["requires_revalidation", "blocked"]),
}).strict().superRefine((v, ctx) => {
  function fail(path: (string | number)[], message: string): void {
    ctx.addIssue({ code: "custom", path, message });
  }
  const ready = v.outcome === "ready";
  const principal = v.validation.issues[0]?.code ?? null;
  const rule: IssueClassRule | null = ready
    ? { validationState: "valid", reconciliationState: "matched", totals: "full", status: "approved_for_download" }
    : principal !== null ? ISSUE_CLASS_RULE[principal] : null;

  if (ready) {
    // Decision #5 fix (item A.5): this writer never produces "downloaded" — that
    // status is only reachable later, via an actual delivery/download action
    // this preflight slice does not perform. A ready attempt from THIS writer
    // is always exactly "approved_for_download", not the broader union.
    if (v.status !== "approved_for_download") fail(["status"], "EXPORT_ATTEMPT_READY_STATUS_NOT_APPROVED_FOR_DOWNLOAD");
    if (v.availability !== "requires_revalidation") fail(["availability"], "EXPORT_ATTEMPT_OUTCOME_AVAILABILITY_MISMATCH");
    if (v.artifact === null) fail(["artifact"], "EXPORT_ATTEMPT_OUTCOME_ARTIFACT_MISMATCH");
    if (v.validation.issues.length !== 0) fail(["validation", "issues"], "EXPORT_ATTEMPT_READY_WITH_ISSUES");
    if (v.authority === null) fail(["authority"], "EXPORT_ATTEMPT_READY_WITHOUT_AUTHORITY");
  } else {
    if (v.availability !== "blocked") fail(["availability"], "EXPORT_ATTEMPT_OUTCOME_AVAILABILITY_MISMATCH");
    if (v.artifact !== null) fail(["artifact"], "EXPORT_ATTEMPT_OUTCOME_ARTIFACT_MISMATCH");
    if (v.validation.issues.length < 1) fail(["validation", "issues"], "EXPORT_ATTEMPT_BLOCKED_WITHOUT_ISSUES");
  }
  if (rule) {
    if (v.validation.state !== rule.validationState) fail(["validation", "state"], "EXPORT_ATTEMPT_VALIDATION_STATE_MISMATCH");
    if (v.validation.reconciliation.state !== rule.reconciliationState) fail(["validation", "reconciliation", "state"], "EXPORT_ATTEMPT_RECONCILIATION_STATE_MISMATCH");
    // Decision #8 fix (item A.8): status must agree with the PRINCIPAL issue's
    // own class (ready already checked separately above, exactly once).
    if (!ready && v.status !== rule.status) fail(["status"], "EXPORT_ATTEMPT_STATUS_CLASS_MISMATCH");
    const r = v.validation.reconciliation;
    const approvedNN = rule.totals !== "none", exportedNN = rule.totals === "full";
    if ((r.approvedTotalMinor !== null) !== approvedNN) fail(["validation", "reconciliation", "approvedTotalMinor"], "EXPORT_ATTEMPT_TOTALS_CLASS_MISMATCH");
    if ((r.estimatedCostMinor !== null) !== approvedNN) fail(["validation", "reconciliation", "estimatedCostMinor"], "EXPORT_ATTEMPT_TOTALS_CLASS_MISMATCH");
    if ((r.exportedTotalMinor !== null) !== exportedNN) fail(["validation", "reconciliation", "exportedTotalMinor"], "EXPORT_ATTEMPT_TOTALS_CLASS_MISMATCH");
    if ((r.differenceMinor !== null) !== exportedNN) fail(["validation", "reconciliation", "differenceMinor"], "EXPORT_ATTEMPT_TOTALS_CLASS_MISMATCH");
    if (exportedNN && r.approvedTotalMinor !== null && r.exportedTotalMinor !== null && r.differenceMinor !== null) {
      // Decision #4 fix (item A.4): exact arithmetic, never just a sign check —
      // differenceMinor must equal exportedTotalMinor - approvedTotalMinor
      // precisely (BigInt, no float), in BOTH directions.
      const expectedDifference = minorValue(r.exportedTotalMinor)! - minorValue(r.approvedTotalMinor)!;
      if (expectedDifference !== BigInt(r.differenceMinor)) fail(["validation", "reconciliation", "differenceMinor"], "EXPORT_ATTEMPT_DIFFERENCE_ARITHMETIC_MISMATCH");
      if (principal === "EXPORT_RECONCILIATION_MISMATCH" && r.differenceMinor === "0") fail(["validation", "reconciliation", "differenceMinor"], "EXPORT_ATTEMPT_MISMATCH_WITH_ZERO_DIFFERENCE");
    }
    if (ready && r.approvedTotalMinor !== null && r.exportedTotalMinor !== null) {
      if (r.approvedTotalMinor !== r.exportedTotalMinor || BigInt(r.approvedTotalMinor) <= 0n) fail(["validation", "reconciliation", "approvedTotalMinor"], "EXPORT_ATTEMPT_READY_TOTALS_MISMATCH");
    }
    // Decision #7 fix (item A.7): authority must be NULL for exactly the six
    // "no usable decision" codes, and non-null for every other blocked code.
    const authorityMustBeNull = !ready && principal !== null && AUTHORITY_NULL_CODES.includes(principal);
    if ((v.authority === null) !== authorityMustBeNull) fail(["authority"], "EXPORT_ATTEMPT_AUTHORITY_NULLABILITY_MISMATCH");
  }
  if (v.artifact !== null) {
    // Decision #6 fix (item A.6): an artifact may never claim to have been
    // generated after the moment its own attempt was checked.
    if (v.artifact.generatedAt > v.checkedAt) fail(["artifact", "generatedAt"], "EXPORT_ATTEMPT_GENERATED_AFTER_CHECKED");
    // Decision #9 fix (item A.9): rendererVersion must match the format's own
    // renderer, never a different format's literal version string.
    if (v.artifact.rendererVersion !== RENDERER_VERSION_BY_FORMAT[v.format]) fail(["artifact", "rendererVersion"], "EXPORT_ATTEMPT_RENDERER_VERSION_FORMAT_MISMATCH");
  }
  // §5.4 (item 1 of the V3 supplement): a CSV-exclusive issue code anywhere in
  // the array — not only the principal — never justifies blocking a non-CSV
  // format.
  if (v.format !== "csv_jobtread" && v.validation.issues.some(entry => CSV_EXCLUSIVE_CODES.includes(entry.code))) {
    fail(["format"], "EXPORT_ATTEMPT_CSV_EXCLUSIVE_CODE_ON_NON_CSV_FORMAT");
  }
});
export type ExportAttemptSummary = z.infer<typeof exportAttemptSummarySchema>;

/** Throws INTERNAL_APPROVAL_INTEGRITY_ERROR — the writer's own invariant-failure
 * vocabulary — never a bespoke error type, and never a user-input-shaped code: a
 * failure here is this module's own construction being wrong, not caller input. */
export function parseExportAttemptSummary(value: unknown): ExportAttemptSummary {
  const result = exportAttemptSummarySchema.safeParse(value);
  if (!result.success) throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
  return result.data;
}
