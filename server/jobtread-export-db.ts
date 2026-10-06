/** C2-A legacy export compatibility holds and contextual history only.
 * No legacy call admits a governed attempt or emits bytes. The positive Export
 * contract (immutable attempts, durable audit and authenticated bytes) is pending.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { estimateDrafts, jobtreadExports, tenants, type JobtreadExport } from "../drizzle/schema";
import type { CsvValidationReport } from "./jobtread-csv-export";
import type { ExportState, ReconciliationResult } from "@shared/jobtread-reconciliation";
import { holdLegacyEstimateOperation } from "@shared/estimate-legacy-hold";
import { requireProjectAccess, ProjectAccessError } from "./project-access";
import type { AuthTransaction } from "./auth-transaction";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";
import {
  EXPORT_FORMATS, EXPORT_ATTEMPT_KINDS, EXPORT_VALIDATION_STATES, EXPORT_RECONCILIATION_STATES,
  EXPORT_ISSUE_CODES, EXPORT_ISSUE_FIELDS, EXPORT_STATUSES, EXPORT_PROTOCOL as EP,
} from "@shared/domain/taxonomy";
import { normalizeExportManifest, exportIssueOrderIsValid, type ExportManifest } from "@shared/internal-estimate-export-engine";
import { InternalApprovalError, internalApprovalVersionPrimitives as p } from "../shared/internal-estimate-approval-engine";
/**
 * MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 1: the preflight
 * writer's own closed response schema (`shared/internal-estimate-export-
 * attempt.ts`) already enforces the FULL per-code validationState/
 * reconciliationState/totals-class/status/arithmetic/CSV-exclusivity matrix
 * `A1-EXPORT-DATA-CONTRACT.md` §§4–5/9 requires — history was reproducing only
 * a thin slice of it. Rather than mirror the whole table a THIRD time (the
 * module already mirrors it once from the engine's private original), these
 * are now IMPORTED — a minimal, additive export from that already-accepted
 * module (no behavior change there: see its own regression run in the V4
 * report) — so history can never drift into a second, more permissive table.
 */
import {
  lineKeySchema, ISSUE_CLASS_RULE, AUTHORITY_NULL_CODES, CSV_EXCLUSIVE_CODES, RENDERER_VERSION_BY_FORMAT, minorValue,
  type IssueClassRule,
} from "@shared/internal-estimate-export-attempt";

export type ExportErrorCode =
  | "DB_UNAVAILABLE"
  | "ESTIMATE_NOT_FOUND"
  | "EXPORT_NOT_FOUND"
  | "ESTIMATE_NOT_APPROVED"
  | "ESTIMATE_SUPERSEDED"
  | "VALIDATION_FAILED"
  | "RECONCILIATION_FAILED"
  | "EXPORT_BLOCKED"
  | "INVALID_TRANSITION";

export class ExportError extends Error {
  public readonly code: ExportErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: ExportErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ExportError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface RequestExportInput {
  estimateDraftId: string;
  userId: string;
  tenantId?: string | null;
  /**
   * Commercial adjustments known to the caller that are not CSV lines
   * (discount, lump sum). Declaring them turns a hard reconciliation block into an
   * explicit exception review instead of a silent mismatch.
   */
  declaredAdjustments?: Array<{ kind: string; amount: string | number; reason?: string }>;
}

export interface ExportAttemptResult {
  exportId: string;
  status: ExportState;
  canDownload: boolean;
  blockReason: string | null;
  validation: CsvValidationReport;
  reconciliation: ReconciliationResult;
  manifest: ExportManifest;
  /** Present only when the attempt reached `approved_for_download`. */
  csvString?: string;
  csvHash: string | null;
  rowCount: number;
}

/**
 * MICHAEL-A1-EXPORT-SURFACE-V2-QA-AND-CORRECTION.md item 2: this is the
 * ORIGINAL public entry point Export§9/the integration contract names —
 * renaming a NEW function in `internal-estimate-export-db.ts` to the same
 * literal identifier did not modify what THIS module exports under that
 * name, so a caller importing it from here (its historical home) still saw
 * the old unconditional-false stub while the router (importing from the
 * other module) saw the real thing — two competing answers to the same
 * question. Delegates to the one real, already-accepted resolution instead
 * of a second implementation: same authenticated-context/optional-tx
 * contract, same no-write/no-nested-transaction guarantee.
 */
export { checkExportAuthorization, type ExportAuthorizationCheck } from "./internal-estimate-export-db";

export async function requestJobTreadExport(_input: RequestExportInput): Promise<ExportAttemptResult> {
  return holdLegacyEstimateOperation("export");
}
export async function downloadJobTreadExport(_exportId: string, _userId: string): Promise<{ csvString: string; export: JobtreadExport; filename: string }> {
  return holdLegacyEstimateOperation("download");
}

/** Construct only from authenticated server context, never a command payload. */
export interface ExportHistoryContext { actorId: string; tenantId: string; }

/**
 * A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md — Export§9's `ExportAttemptSummary`
 * is the PREFLIGHT WRITER's own closed response DTO (`shared/internal-estimate-
 * export-attempt.ts`, `kind: z.literal("preflight")` only) — it cannot represent
 * a `kind:"delivery"` row or the explicit legacy variant history must surface,
 * so this is a second, narrower-purpose summary for history/detail specifically,
 * never a competing policy: every A1 field below is read directly off columns
 * the already-accepted writers themselves wrote (never re-derived), and the
 * legacy branch never fabricates a format/kind/authority that was never written.
 *
 * MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md item 2: the V1 shape was a
 * bare TypeScript interface with no runtime validation — a corrupted row (an
 * unknown/empty `artifactContractVersion`, extra nested keys smuggled into
 * `validationReport`) silently became a "successfully" projected summary, or
 * was wrongly reclassified as legacy. `exportHistorySummarySchema` below is a
 * CLOSED, strict Zod parser — exactly the 11 contract fields, no `projectId`
 * (that was never one of Export§9's eleven keys), every nested object/array
 * `.strict()`, and a `superRefine` enforcing the SAME ready/blocked/legacy
 * coherence (status↔outcome↔availability↔artifact↔authority↔validation.issues)
 * the writers' own closed response schema enforces — reproduced here, not
 * imported, because `shared/internal-estimate-export-attempt.ts`'s version is
 * deliberately scoped to the preflight writer's own `kind:"preflight"`/
 * `status:"approved_for_download"`-only response and cannot represent a
 * `kind:"delivery"`/`status:"downloaded"` row or the legacy variant history
 * must also surface.
 */
const KNOWN_ARTIFACT_CONTRACT_VERSION = EP.manifest;
const historyAuthoritySchema = z.object({ approvalId: p.uuid, snapshotId: p.uuid, contentHash: p.hash }).strict().nullable();
const historyIssueSchema = z.object({
  code: z.enum(EXPORT_ISSUE_CODES), lineKey: lineKeySchema.nullable(), field: z.enum(EXPORT_ISSUE_FIELDS).nullable(),
}).strict();
// Same bound/ordering discipline as the writer's own issuesArraySchema
// (shared/internal-estimate-export-attempt.ts) — reused via the imported
// exportIssueOrderIsValid, never a second ordering rule.
const historyIssuesArraySchema = z.array(historyIssueSchema).max(4002).superRefine((v, ctx) => {
  if (!exportIssueOrderIsValid(v)) ctx.addIssue({ code: "custom", path: ["issues"], message: "EXPORT_HISTORY_ISSUES_UNORDERED" });
});
const historyReconciliationSchema = z.object({
  state: z.enum(EXPORT_RECONCILIATION_STATES), approvedTotalMinor: p.minor.nullable(),
  exportedTotalMinor: p.minor.nullable(), differenceMinor: p.signedMinor.nullable(), estimatedCostMinor: p.minor.nullable(),
}).strict();
const historyValidationSchema = z.object({
  version: z.literal(EP.validation), state: z.enum(EXPORT_VALIDATION_STATES),
  issues: historyIssuesArraySchema, reconciliation: historyReconciliationSchema,
}).strict();
const historyArtifactSchema = z.object({
  artifactHash: p.hash, byteLength: z.number().int().min(1).max(10_485_760),
  rendererVersion: z.string().min(1), generatedAt: p.timestamp,
}).strict().nullable();
/**
 * MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 1: the V2 schema
 * only checked a handful of ready/blocked relations by hand. The 16-case
 * matrix QA proved it still accepted: every reconciliation total NULL on a
 * ready row; a wrong reconciliation/validation state; a nonzero difference
 * on a ready row; an artifact generated after checkedAt; an unknown or
 * wrong-class blocked status; a malformed/unordered/oversized issues array;
 * a CSV-exclusive code blocking a non-CSV format; and totals present on an
 * authority-blocked row. This superRefine now applies the SAME per-code
 * `ISSUE_CLASS_RULE` (validationState/reconciliationState/totals-class/
 * status/exact BigInt arithmetic/authority-nullability) the writer's own
 * `exportAttemptSummarySchema` enforces — imported, not re-derived — plus the
 * same CSV-exclusivity and renderer/format checks, applied uniformly to BOTH
 * ready and blocked (the writer's schema is preflight/ready-literal-status-
 * only; history additionally accepts `status:"downloaded"` for a ready
 * delivery/redownload row, and `kind:"delivery"`).
 */
const exportHistorySummarySchema = z.object({
  exportId: p.uuid, estimateId: p.uuid, format: z.enum(EXPORT_FORMATS).nullable(),
  kind: z.enum(EXPORT_ATTEMPT_KINDS).nullable(), outcome: z.enum(["ready", "blocked", "legacy"]),
  status: z.string().min(1), checkedAt: p.timestamp.nullable(), authority: historyAuthoritySchema,
  validation: historyValidationSchema.nullable(), artifact: historyArtifactSchema,
  availability: z.enum(["requires_revalidation", "blocked", "legacy_reconciliation_required"]),
}).strict().superRefine((v, ctx) => {
  function fail(message: string): void { ctx.addIssue({ code: "custom", message }); }
  if (v.outcome === "legacy") {
    if (v.format !== null || v.kind !== null || v.checkedAt !== null || v.authority !== null || v.validation !== null || v.artifact !== null) {
      fail("EXPORT_HISTORY_LEGACY_FIELD_NOT_NULL");
    }
    if (v.availability !== "legacy_reconciliation_required") fail("EXPORT_HISTORY_LEGACY_AVAILABILITY_MISMATCH");
    return;
  }
  if (v.format === null || v.kind === null || v.checkedAt === null || v.validation === null) {
    fail("EXPORT_HISTORY_A1_REQUIRED_FIELD_NULL");
    return;
  }
  const ready = v.outcome === "ready";
  const principal = v.validation.issues[0]?.code ?? null;
  const rule: IssueClassRule | null = ready
    ? { validationState: "valid", reconciliationState: "matched", totals: "full", status: "approved_for_download" }
    : principal !== null ? ISSUE_CLASS_RULE[principal] : null;

  if (ready) {
    if (v.availability !== "requires_revalidation") fail("EXPORT_HISTORY_READY_AVAILABILITY_MISMATCH");
    if (v.artifact === null) fail("EXPORT_HISTORY_READY_WITHOUT_ARTIFACT");
    if (v.validation.issues.length !== 0) fail("EXPORT_HISTORY_READY_WITH_ISSUES");
    // History (unlike the preflight-only writer schema) legitimately sees
    // "downloaded" too, for a delivered/redownloaded ready row.
    if (v.status !== "approved_for_download" && v.status !== "downloaded") fail("EXPORT_HISTORY_READY_STATUS_UNKNOWN");
  } else {
    if (v.availability !== "blocked") fail("EXPORT_HISTORY_BLOCKED_AVAILABILITY_MISMATCH");
    if (v.artifact !== null) fail("EXPORT_HISTORY_BLOCKED_WITH_ARTIFACT");
    if (v.validation.issues.length < 1) { fail("EXPORT_HISTORY_BLOCKED_WITHOUT_ISSUES"); return; }
    if (!EXPORT_STATUSES.includes(v.status as (typeof EXPORT_STATUSES)[number])) fail("EXPORT_HISTORY_BLOCKED_STATUS_UNKNOWN");
  }
  if (rule) {
    if (v.validation.state !== rule.validationState) fail("EXPORT_HISTORY_VALIDATION_STATE_MISMATCH");
    if (v.validation.reconciliation.state !== rule.reconciliationState) fail("EXPORT_HISTORY_RECONCILIATION_STATE_MISMATCH");
    if (!ready && v.status !== rule.status) fail("EXPORT_HISTORY_STATUS_CLASS_MISMATCH");
    const r = v.validation.reconciliation;
    const approvedNN = rule.totals !== "none", exportedNN = rule.totals === "full";
    if ((r.approvedTotalMinor !== null) !== approvedNN) fail("EXPORT_HISTORY_TOTALS_CLASS_MISMATCH");
    if ((r.estimatedCostMinor !== null) !== approvedNN) fail("EXPORT_HISTORY_TOTALS_CLASS_MISMATCH");
    if ((r.exportedTotalMinor !== null) !== exportedNN) fail("EXPORT_HISTORY_TOTALS_CLASS_MISMATCH");
    if ((r.differenceMinor !== null) !== exportedNN) fail("EXPORT_HISTORY_TOTALS_CLASS_MISMATCH");
    if (exportedNN && r.approvedTotalMinor !== null && r.exportedTotalMinor !== null && r.differenceMinor !== null) {
      // Exact BigInt arithmetic, never just a sign check — mirrors the writer.
      const expectedDifference = minorValue(r.exportedTotalMinor)! - minorValue(r.approvedTotalMinor)!;
      if (expectedDifference !== BigInt(r.differenceMinor)) fail("EXPORT_HISTORY_DIFFERENCE_ARITHMETIC_MISMATCH");
      if (!ready && principal === "EXPORT_RECONCILIATION_MISMATCH" && r.differenceMinor === "0") fail("EXPORT_HISTORY_MISMATCH_WITH_ZERO_DIFFERENCE");
    }
    if (ready && r.approvedTotalMinor !== null && r.exportedTotalMinor !== null) {
      if (r.approvedTotalMinor !== r.exportedTotalMinor || BigInt(r.approvedTotalMinor) <= 0n) fail("EXPORT_HISTORY_READY_TOTALS_MISMATCH");
    }
    const authorityMustBeNull = !ready && principal !== null && AUTHORITY_NULL_CODES.includes(principal);
    if ((v.authority === null) !== authorityMustBeNull) fail("EXPORT_HISTORY_AUTHORITY_NULLABILITY_MISMATCH");
  }
  if (v.artifact !== null) {
    // QA V2 item 1.3 + V3: renderer must belong to its own format, and an
    // artifact may never claim to have been generated AFTER its own attempt
    // was checked.
    if (v.artifact.rendererVersion !== RENDERER_VERSION_BY_FORMAT[v.format]) fail("EXPORT_HISTORY_RENDERER_VERSION_FORMAT_MISMATCH");
    if (v.artifact.generatedAt > v.checkedAt) fail("EXPORT_HISTORY_GENERATED_AFTER_CHECKED");
  }
  // A CSV-exclusive issue code anywhere in the array never justifies blocking
  // a non-CSV format.
  if (v.format !== "csv_jobtread" && v.validation.issues.some(entry => CSV_EXCLUSIVE_CODES.includes(entry.code))) {
    fail("EXPORT_HISTORY_CSV_EXCLUSIVE_CODE_ON_NON_CSV_FORMAT");
  }
});
export type ExportHistorySummary = z.infer<typeof exportHistorySummarySchema>;
export type ExportAttemptDetail = ExportHistorySummary & { manifest: ExportManifest | null };

function integrity(): never { throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR"); }
const forbidden = (): never => { throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG); };
async function historyRead<T>(context: ExportHistoryContext, read: (tx: AuthTransaction) => Promise<T>): Promise<T> {
  if (!context?.actorId || !context?.tenantId) return forbidden();
  const db = await getDb();
  if (!db) throw new ExportError("DB_UNAVAILABLE", "Export history is unavailable.");
  return db.transaction(async tx => {
    const [tenant] = await tx.select({ id: tenants.id, isActive: tenants.isActive }).from(tenants)
      .where(eq(tenants.id, context.tenantId)).limit(1).for("share");
    if (!tenant || tenant.isActive !== true) return forbidden();
    return read(tx);
  }, { isolationLevel: "serializable" });
}
async function authorizeProject(tx: AuthTransaction, projectId: string | null, context: ExportHistoryContext) {
  if (!projectId) return forbidden();
  await requireProjectAccess(projectId, context.actorId, "read", { mode: "a1", transaction: tx, expectedTenantId: context.tenantId });
}
async function readDraftContext(tx: AuthTransaction, id: string | null, context: ExportHistoryContext) {
  if (!id) return forbidden();
  const [draft] = await tx.select({ id: estimateDrafts.id, projectId: estimateDrafts.projectId, tenantId: estimateDrafts.tenantId })
    .from(estimateDrafts).where(eq(estimateDrafts.id, id)).limit(1);
  if (!draft || draft.tenantId !== context.tenantId || !draft.projectId) return forbidden();
  return draft;
}
/** `status === 'approved_for_download' | 'downloaded'` is the ONLY A1 "ready" class
 * (the same binary the writers' own `statusForCode`/`summaryFrom` use) — everything
 * else persisted by the three writers is a blocked status (blocked_authorization/
 * blocked_validation/blocked_reconciliation/needs_exception_review). */
function a1Outcome(status: string): "ready" | "blocked" {
  return status === "approved_for_download" || status === "downloaded" ? "ready" : "blocked";
}
function a1Availability(outcome: "ready" | "blocked"): "requires_revalidation" | "blocked" {
  return outcome === "ready" ? "requires_revalidation" : "blocked";
}
/**
 * Builds the closed summary from an already-authorized row — never spreads the
 * row, never leaks the raw manifest/validationReport object (list callers get
 * this only; `detailOf` below adds the parsed manifest for the detail route).
 *
 * Only a genuine `NULL` `artifactContractVersion` classifies as legacy; an
 * empty string or any other unrecognized marker is a real integrity failure
 * (thrown), never silently reclassified as legacy (QA #2) — reclassifying
 * would hide exactly the kind of corruption this projection exists to catch.
 * The candidate object is then parsed through the closed schema above, so a
 * structurally-invalid row (extra nested validation metadata, an incoherent
 * ready/blocked/legacy combination) throws too, instead of leaving the
 * router to return it as a successful response.
 */
export function summaryOf(row: JobtreadExport): ExportHistorySummary {
  // `== null` on purpose: a genuinely absent column reads as `undefined` on a
  // hand-built/mocked row object (vs. a real DB NULL, always `null` through
  // the driver) — both mean "no A1 marker", never "treat undefined as some
  // other unknown marker and fail integrity on an otherwise-legitimate legacy row".
  if (row.artifactContractVersion != null && row.artifactContractVersion !== KNOWN_ARTIFACT_CONTRACT_VERSION) integrity();
  // QA V2 item 1.1: a NULL marker with any other A1-only column still
  // populated is not a legitimate legacy row — it's an inconsistency (the
  // physical `ck_jte_a1_all_or_none` CHECK should never let this happen, but
  // this projection is read-time defense in depth, the same discipline
  // `retainedManifestEvidenceValid` already applies for download — and never
  // silently reclassifies it as a clean legacy read).
  if (row.artifactContractVersion == null) {
    const a1OnlyColumns = [
      row.attemptKind, row.artifactFormat, row.clientId, row.internalApprovalId, row.internalSnapshotId,
      row.approvedContentHash, row.artifactHash, row.rendererVersion, row.generatedAt, row.artifactByteLength, row.checkedAt,
    ];
    if (a1OnlyColumns.some(value => value != null)) integrity();
  } else {
    // MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 1 ("colunas
    // ocultadas"): on a genuine A1 row, the candidate-building code below
    // collapses authority/artifact to `null` whenever ANY of their own
    // columns is missing — which silently hides a PARTIALLY populated set
    // (corruption) behind the same shape as a legitimately absent one. Catch
    // that here, at the raw column level, before any collapsing happens.
    const authorityColumns = [row.internalApprovalId, row.internalSnapshotId, row.approvedContentHash];
    const authorityAllNull = authorityColumns.every(value => value == null);
    const authorityAllPresent = authorityColumns.every(value => value != null);
    if (!authorityAllNull && !authorityAllPresent) integrity();
    if (a1Outcome(row.status) === "blocked") {
      const artifactColumns = [row.artifactHash, row.rendererVersion, row.generatedAt, row.artifactByteLength];
      if (artifactColumns.some(value => value != null)) integrity();
    }
  }

  const candidate = row.artifactContractVersion == null
    ? {
      exportId: row.id, estimateId: row.estimateDraftId, format: null, kind: null, outcome: "legacy" as const,
      status: row.status, checkedAt: null, authority: null, validation: null, artifact: null,
      availability: "legacy_reconciliation_required" as const,
    }
    : (() => {
      const outcome = a1Outcome(row.status);
      return {
        exportId: row.id, estimateId: row.estimateDraftId, format: row.artifactFormat, kind: row.attemptKind,
        outcome, status: row.status, checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
        authority: row.internalApprovalId && row.internalSnapshotId && row.approvedContentHash
          ? { approvalId: row.internalApprovalId, snapshotId: row.internalSnapshotId, contentHash: row.approvedContentHash }
          : null,
        validation: row.validationReport,
        artifact: outcome === "ready" && row.artifactHash && row.artifactByteLength != null && row.rendererVersion && row.generatedAt
          ? { artifactHash: row.artifactHash, byteLength: row.artifactByteLength, rendererVersion: row.rendererVersion, generatedAt: row.generatedAt.toISOString() }
          : null,
        availability: a1Availability(outcome),
      };
    })();
  const result = exportHistorySummarySchema.safeParse(candidate);
  if (!result.success) integrity();
  return result.data;
}
/** Detail adds ONLY the already-validated, re-parsed manifest (never the raw DB
 * JSON value) — §9's "leitura do detalhe A1 expõe o manifest fechado após
 * autorização". A manifest that fails its own closed grammar is a real
 * integrity failure — propagated as a typed error, never silently degraded to
 * a "successful" ready/downloaded detail with `manifest:null` (QA #2's exact
 * counter-proof: corruption must never present as success). */
export function detailOf(row: JobtreadExport): ExportAttemptDetail {
  const summary = summaryOf(row);
  if (row.artifactContractVersion == null) return { ...summary, manifest: null };
  const manifest = normalizeExportManifest(row.manifest);
  // QA V2 item 1.4: each manifest in isolation can be perfectly well-formed
  // (its OWN grammar is satisfied) while belonging to a DIFFERENT export
  // entirely — `normalizeExportManifest` alone never catches that, it only
  // validates shape. Cross-check manifest identity against the ROW it is
  // attached to, the same discipline `retainedManifestEvidenceValid`
  // (internal-estimate-export-db.ts, the download writer) already applies —
  // reproduced here, not imported, to avoid reopening that accepted writer
  // file for this surface-layer projection.
  if (!manifestMatchesRow(manifest, row, summary.validation!)) integrity(); // never null here: legacy already returned above
  return { ...summary, manifest };
}
/** Identity correspondence between a parsed manifest and the row it claims
 * to belong to — never the full ready-only representation/authority
 * requirement `retainedManifestEvidenceValid` enforces (that function is
 * scoped to rows already known ready, and returns false outright for a
 * blocked manifest), so this covers both outcomes: the shared identity
 * fields always, the ready-only representation fields only when the
 * manifest claims `outcome:"ready"`.
 *
 * MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 1 ("espelhos"):
 * V2 only cross-checked authority for a READY manifest — a BLOCKED manifest
 * (e.g. INTERNAL_APPROVAL_REVOKED/ESTIMATE_SUPERSEDED, the two codes that DO
 * carry authority while blocked) could claim a DIFFERENT authority than the
 * row's own columns and pass unnoticed. Authority correspondence now applies
 * whenever the manifest claims one, regardless of outcome. V2 also never
 * cross-checked `validationReport` (row) against `manifest.validation` — two
 * independently-coherent representations of the SAME outcome that were never
 * reconciled against each other; `validationMirrorsManifest` closes that. */
function manifestMatchesRow(manifest: ExportManifest, row: JobtreadExport, validation: NonNullable<ExportHistorySummary["validation"]>): boolean {
  if (manifest.exportId !== row.id) return false;
  if (manifest.format !== row.artifactFormat) return false;
  if (manifest.attemptKind !== row.attemptKind) return false;
  if (manifest.version !== row.artifactContractVersion) return false;
  if (manifest.checkedAt !== (row.checkedAt ? row.checkedAt.toISOString() : null)) return false;
  if (manifest.context.tenantId !== row.tenantId) return false;
  if (manifest.context.projectId !== row.projectId) return false;
  if (manifest.context.clientId !== row.clientId) return false;
  if (manifest.context.estimateDraftId !== row.estimateDraftId) return false;
  if (manifest.context.estimateVersion !== row.estimateVersion) return false;
  if (manifest.context.requestedBy !== row.requestedBy) return false;
  if (!validationMirrorsManifest(validation, manifest.validation)) return false;
  if (manifest.authority !== null) {
    if (manifest.authority.approvalId !== row.internalApprovalId) return false;
    if (manifest.authority.snapshotId !== row.internalSnapshotId) return false;
    if (manifest.authority.contentHash !== row.approvedContentHash) return false;
  } else if (row.internalApprovalId !== null || row.internalSnapshotId !== null || row.approvedContentHash !== null) {
    return false;
  }
  if (manifest.outcome === "ready") {
    if (!manifest.representation) return false;
    if (manifest.representation.artifactHash !== row.artifactHash) return false;
    if (manifest.representation.byteLength !== row.artifactByteLength) return false;
    if (manifest.representation.rendererVersion !== row.rendererVersion) return false;
    if (manifest.representation.generatedAt !== (row.generatedAt ? row.generatedAt.toISOString() : null)) return false;
  } else if (manifest.representation !== null) {
    return false;
  }
  return true;
}
/** `row.validationReport` (the raw, independently-persisted column `summaryOf`
 * already parsed into `validation`) and `manifest.validation` (embedded in
 * the separately-persisted manifest JSON) must describe the SAME outcome —
 * each can be internally coherent on its own and still diverge from the
 * other. Issue order is compared positionally: both arrays already pass
 * `exportIssueOrderIsValid` individually, so a same-length, same-order,
 * same-content comparison is exact, not a false mismatch risk. */
function validationMirrorsManifest(rowValidation: NonNullable<ExportHistorySummary["validation"]>, manifestValidation: ExportManifest["validation"]): boolean {
  if (rowValidation.state !== manifestValidation.state) return false;
  const r = rowValidation.reconciliation, m = manifestValidation.reconciliation;
  if (r.state !== m.state) return false;
  if (r.approvedTotalMinor !== m.approvedTotalMinor) return false;
  if (r.exportedTotalMinor !== m.exportedTotalMinor) return false;
  if (r.differenceMinor !== m.differenceMinor) return false;
  if (r.estimatedCostMinor !== m.estimatedCostMinor) return false;
  if (rowValidation.issues.length !== manifestValidation.issues.length) return false;
  return rowValidation.issues.every((issue, i) => {
    const other = manifestValidation.issues[i];
    return issue.code === other.code && issue.lineKey === other.lineKey && issue.field === other.field;
  });
}
async function summarize(tx: AuthTransaction, row: JobtreadExport, context: ExportHistoryContext, projectId: string, estimateId?: string): Promise<ExportHistorySummary> {
  if (row.tenantId !== context.tenantId || row.projectId !== projectId || (estimateId && row.estimateDraftId !== estimateId)) return forbidden();
  const draft = await readDraftContext(tx, row.estimateDraftId, context);
  if (draft.projectId !== projectId) return forbidden();
  return summaryOf(row);
}
export async function listExportsForEstimate(estimateDraftId: string, context: ExportHistoryContext): Promise<ExportHistorySummary[]> {
  return historyRead(context, async tx => {
    const draft = await readDraftContext(tx, estimateDraftId, context);
    await authorizeProject(tx, draft.projectId, context);
    const rows = await tx.select().from(jobtreadExports).where(eq(jobtreadExports.estimateDraftId, estimateDraftId)).orderBy(desc(jobtreadExports.createdAt));
    const result: ExportHistorySummary[] = [];
    for (const row of rows) result.push(await summarize(tx, row, context, draft.projectId, estimateDraftId));
    return result;
  });
}
export async function listExportsForProject(projectId: string, context: ExportHistoryContext): Promise<ExportHistorySummary[]> {
  return historyRead(context, async tx => {
    await authorizeProject(tx, projectId, context);
    const rows = await tx.select().from(jobtreadExports).where(eq(jobtreadExports.projectId, projectId)).orderBy(desc(jobtreadExports.createdAt));
    const result: ExportHistorySummary[] = [];
    for (const row of rows) result.push(await summarize(tx, row, context, projectId));
    return result;
  });
}
/** Detail: same access gate as the list helpers, but returns the fuller
 * `ExportAttemptDetail` (summary + parsed manifest for A1 rows) — never content/
 * bytes/URL, per §9. */
export async function getExportById(exportId: string, context: ExportHistoryContext): Promise<ExportAttemptDetail | null> {
  return historyRead(context, async tx => {
    const [row] = await tx.select().from(jobtreadExports).where(eq(jobtreadExports.id, exportId)).limit(1);
    if (!row) return null;
    if (row.tenantId !== context.tenantId || !row.projectId) return forbidden();
    await authorizeProject(tx, row.projectId, context);
    const draft = await readDraftContext(tx, row.estimateDraftId, context);
    if (draft.projectId !== row.projectId) return forbidden();
    return detailOf(row);
  });
}
