/** C2-A legacy export compatibility holds and contextual history only.
 * No legacy call admits a governed attempt or emits bytes. The positive Export
 * contract (immutable attempts, durable audit and authenticated bytes) is pending.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { estimateDrafts, jobtreadExports, tenants, type JobtreadExport } from "../drizzle/schema";
import type { CsvValidationReport } from "./jobtread-csv-export";
import type { ExportState, ReconciliationResult } from "@shared/jobtread-reconciliation";
import { holdLegacyEstimateOperation, LEGACY_ESTIMATE_HOLD_MESSAGE } from "@shared/estimate-legacy-hold";
import { requireProjectAccess, ProjectAccessError } from "./project-access";
import type { AuthTransaction } from "./auth-transaction";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";
import type { ExportFormat } from "@shared/domain/taxonomy";
import { normalizeExportManifest, type ExportManifest } from "@shared/internal-estimate-export-engine";

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

export interface AuthorizationCheck { authorized: false; reason: string; }
/** No context or draft is returned: even previously approved legacy calls are held. */
export async function checkExportAuthorization(_estimateDraftId: string): Promise<AuthorizationCheck> {
  return { authorized: false, reason: LEGACY_ESTIMATE_HOLD_MESSAGE };
}
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
 */
export type ExportHistoryOutcome = "ready" | "blocked" | "legacy";
export type ExportHistoryAvailability = "requires_revalidation" | "blocked" | "legacy_reconciliation_required";
export interface ExportHistorySummary {
  exportId: string; estimateId: string; projectId: string;
  format: ExportFormat | null; kind: "preflight" | "delivery" | null;
  outcome: ExportHistoryOutcome; status: string; checkedAt: string | null;
  authority: { approvalId: string; snapshotId: string; contentHash: string } | null;
  validation: { state: string; issues: unknown[]; reconciliation: Record<string, unknown> } | null;
  artifact: { artifactHash: string; byteLength: number; rendererVersion: string; generatedAt: string } | null;
  availability: ExportHistoryAvailability;
}
export type ExportAttemptDetail = ExportHistorySummary & { manifest: ExportManifest | null };

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
/** Builds the closed summary from an already-authorized row — never spreads the
 * row, never leaks the raw manifest/validationReport object (list callers get this
 * only; the fuller `detailOf` below adds the parsed manifest for the detail route). */
export function summaryOf(row: JobtreadExport): ExportHistorySummary {
  if (!row.artifactContractVersion) {
    // Legacy row — no A1 writer ever produced it. §9: format/kind/checkedAt/
    // authority/validation/artifact are NULL only in this explicit variant.
    return {
      exportId: row.id, estimateId: row.estimateDraftId!, projectId: row.projectId!,
      format: null, kind: null, outcome: "legacy", status: row.status, checkedAt: null,
      authority: null, validation: null, artifact: null, availability: "legacy_reconciliation_required",
    };
  }
  const outcome = a1Outcome(row.status);
  const validation = row.validationReport as { state: string; issues: unknown[]; reconciliation: Record<string, unknown> } | null;
  return {
    exportId: row.id, estimateId: row.estimateDraftId!, projectId: row.projectId!,
    format: row.artifactFormat as ExportFormat, kind: row.attemptKind as "preflight" | "delivery",
    outcome, status: row.status, checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    authority: row.internalApprovalId && row.internalSnapshotId && row.approvedContentHash
      ? { approvalId: row.internalApprovalId, snapshotId: row.internalSnapshotId, contentHash: row.approvedContentHash }
      : null,
    validation,
    artifact: outcome === "ready" && row.artifactHash && row.artifactByteLength != null && row.rendererVersion && row.generatedAt
      ? { artifactHash: row.artifactHash, byteLength: row.artifactByteLength, rendererVersion: row.rendererVersion, generatedAt: row.generatedAt.toISOString() }
      : null,
    availability: a1Availability(outcome),
  };
}
/** Detail adds ONLY the already-validated, re-parsed manifest (never the raw DB
 * JSON value) — §9's "leitura do detalhe A1 expõe o manifest fechado após
 * autorização". A manifest that fails its own closed grammar is treated as absent
 * rather than surfaced malformed; the row's own summary fields are unaffected. */
export function detailOf(row: JobtreadExport): ExportAttemptDetail {
  const summary = summaryOf(row);
  if (!row.artifactContractVersion) return { ...summary, manifest: null };
  let manifest: ExportManifest | null = null;
  try { manifest = normalizeExportManifest(row.manifest); } catch { manifest = null; }
  return { ...summary, manifest };
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
