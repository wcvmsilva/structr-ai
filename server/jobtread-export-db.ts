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
  EXPORT_ISSUE_CODES, EXPORT_ISSUE_FIELDS, EXPORT_AUTHORITY_ISSUE_CODES, EXPORT_PROTOCOL as EP,
  type ExportIssueCode,
} from "@shared/domain/taxonomy";
import { normalizeExportManifest, type ExportManifest } from "@shared/internal-estimate-export-engine";
import { InternalApprovalError, internalApprovalVersionPrimitives as p } from "../shared/internal-estimate-approval-engine";

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
/** Mirrors (never imports) the private per-code authority-nullability rule
 * `shared/internal-estimate-export-attempt.ts`'s own `AUTHORITY_NULL_CODES`
 * encodes: of the 8 authority-class issue codes, only `INTERNAL_APPROVAL_
 * REVOKED`/`ESTIMATE_SUPERSEDED` describe a decision that WAS usable (so still
 * carry its authority) — the other 6 "no usable decision ever existed" codes
 * carry NULL authority. */
const AUTHORITY_NULL_HISTORY_CODES: readonly string[] = EXPORT_AUTHORITY_ISSUE_CODES.filter(
  code => code !== "INTERNAL_APPROVAL_REVOKED" && code !== "ESTIMATE_SUPERSEDED",
);
const historyAuthoritySchema = z.object({ approvalId: p.uuid, snapshotId: p.uuid, contentHash: p.hash }).strict().nullable();
const historyIssueSchema = z.object({
  code: z.enum(EXPORT_ISSUE_CODES), lineKey: z.string().nullable(), field: z.enum(EXPORT_ISSUE_FIELDS).nullable(),
}).strict();
const historyReconciliationSchema = z.object({
  state: z.enum(EXPORT_RECONCILIATION_STATES), approvedTotalMinor: p.minor.nullable(),
  exportedTotalMinor: p.minor.nullable(), differenceMinor: p.signedMinor.nullable(), estimatedCostMinor: p.minor.nullable(),
}).strict();
const historyValidationSchema = z.object({
  version: z.literal(EP.validation), state: z.enum(EXPORT_VALIDATION_STATES),
  issues: z.array(historyIssueSchema), reconciliation: historyReconciliationSchema,
}).strict();
const historyArtifactSchema = z.object({
  artifactHash: p.hash, byteLength: z.number().int().min(1).max(10_485_760),
  rendererVersion: z.string().min(1), generatedAt: p.timestamp,
}).strict().nullable();
/** Mirrors (never imports) the private `RENDERER_VERSION_BY_FORMAT` map every
 * accepted writer already builds from the SAME public `EP` taxonomy constants
 * — MICHAEL-A1-EXPORT-SURFACE-V2-QA-AND-CORRECTION.md item 1.3: an artifact
 * claiming a renderer that doesn't belong to its own format (e.g. a PDF
 * renderer version on a JSON row) was previously accepted outright. */
const HISTORY_RENDERER_VERSION_BY_FORMAT: Record<string, string> = {
  pdf: EP.pdfRenderer, json: EP.jsonRenderer, printable: EP.printableRenderer, csv_jobtread: EP.csvRenderer,
};
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
  if (ready) {
    if (v.availability !== "requires_revalidation") fail("EXPORT_HISTORY_READY_AVAILABILITY_MISMATCH");
    if (v.artifact === null) fail("EXPORT_HISTORY_READY_WITHOUT_ARTIFACT");
    if (v.authority === null) fail("EXPORT_HISTORY_READY_WITHOUT_AUTHORITY");
    if (v.validation.issues.length !== 0) fail("EXPORT_HISTORY_READY_WITH_ISSUES");
    // QA V2 items 1.2/1.3: a ready/downloaded row can never carry an
    // unevaluated validation state, and its artifact's renderer must belong
    // to ITS OWN format — never another format's renderer.
    if (v.validation.state !== "valid") fail("EXPORT_HISTORY_READY_VALIDATION_NOT_VALID");
    if (v.artifact !== null && v.artifact.rendererVersion !== HISTORY_RENDERER_VERSION_BY_FORMAT[v.format]) {
      fail("EXPORT_HISTORY_RENDERER_VERSION_FORMAT_MISMATCH");
    }
  } else {
    if (v.availability !== "blocked") fail("EXPORT_HISTORY_BLOCKED_AVAILABILITY_MISMATCH");
    if (v.artifact !== null) fail("EXPORT_HISTORY_BLOCKED_WITH_ARTIFACT");
    if (v.validation.issues.length < 1) { fail("EXPORT_HISTORY_BLOCKED_WITHOUT_ISSUES"); return; }
    const authorityMustBeNull = AUTHORITY_NULL_HISTORY_CODES.includes(v.validation.issues[0].code);
    if ((v.authority === null) !== authorityMustBeNull) fail("EXPORT_HISTORY_AUTHORITY_NULLABILITY_MISMATCH");
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
  if (!manifestMatchesRow(manifest, row)) integrity();
  return { ...summary, manifest };
}
/** Identity correspondence between a parsed manifest and the row it claims
 * to belong to — never the full ready-only representation/authority
 * requirement `retainedManifestEvidenceValid` enforces (that function is
 * scoped to rows already known ready, and returns false outright for a
 * blocked manifest), so this covers both outcomes: the shared identity
 * fields always, the ready-only representation/authority fields only when
 * the manifest claims `outcome:"ready"`. */
function manifestMatchesRow(manifest: ExportManifest, row: JobtreadExport): boolean {
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
  if (manifest.outcome === "ready") {
    if (!manifest.representation) return false;
    if (manifest.representation.artifactHash !== row.artifactHash) return false;
    if (manifest.representation.byteLength !== row.artifactByteLength) return false;
    if (manifest.representation.rendererVersion !== row.rendererVersion) return false;
    if (manifest.representation.generatedAt !== (row.generatedAt ? row.generatedAt.toISOString() : null)) return false;
    if (!manifest.authority) return false;
    if (manifest.authority.approvalId !== row.internalApprovalId) return false;
    if (manifest.authority.snapshotId !== row.internalSnapshotId) return false;
    if (manifest.authority.contentHash !== row.approvedContentHash) return false;
  } else if (manifest.representation !== null) {
    return false;
  }
  return true;
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
