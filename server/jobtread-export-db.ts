/** C2-A legacy export compatibility holds and contextual history only.
 * No legacy call admits a governed attempt or emits bytes. The positive Export
 * contract (immutable attempts, durable audit and authenticated bytes) is pending.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { estimateDrafts, jobtreadExports, tenants, type JobtreadExport } from "../drizzle/schema";
import type { CsvValidationReport } from "./jobtread-csv-export";
import type { ExportManifest, ExportState, ReconciliationResult } from "@shared/jobtread-reconciliation";
import { holdLegacyEstimateOperation, LEGACY_ESTIMATE_HOLD_MESSAGE } from "@shared/estimate-legacy-hold";
import { requireProjectAccess, ProjectAccessError } from "./project-access";
import type { AuthTransaction } from "./auth-transaction";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";

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
export type ExportHistorySummary = Pick<JobtreadExport, "id" | "estimateDraftId" | "projectId" | "estimateVersion" | "status" | "rowCount" | "createdAt" | "downloadedAt"> & { downloadUnavailable: true };
const historyColumns = {
  id: jobtreadExports.id, tenantId: jobtreadExports.tenantId, projectId: jobtreadExports.projectId,
  estimateDraftId: jobtreadExports.estimateDraftId, estimateVersion: jobtreadExports.estimateVersion,
  status: jobtreadExports.status, rowCount: jobtreadExports.rowCount,
  createdAt: jobtreadExports.createdAt, downloadedAt: jobtreadExports.downloadedAt,
};
type HistoryRow = ExportHistorySummary & { tenantId: string | null };
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
async function summarize(tx: AuthTransaction, row: Omit<HistoryRow, "downloadUnavailable">, context: ExportHistoryContext, projectId: string, estimateId?: string): Promise<ExportHistorySummary> {
  if (row.tenantId !== context.tenantId || row.projectId !== projectId || (estimateId && row.estimateDraftId !== estimateId)) return forbidden();
  const draft = await readDraftContext(tx, row.estimateDraftId, context);
  if (draft.projectId !== projectId) return forbidden();
  // Never spread a persisted row; historical manifest/report/URL are not a capability.
  return { id: row.id, estimateDraftId: row.estimateDraftId, projectId: row.projectId,
    estimateVersion: row.estimateVersion, status: row.status, rowCount: row.rowCount,
    createdAt: row.createdAt, downloadedAt: row.downloadedAt, downloadUnavailable: true };
}
export async function listExportsForEstimate(estimateDraftId: string, context: ExportHistoryContext): Promise<ExportHistorySummary[]> {
  return historyRead(context, async tx => {
    const draft = await readDraftContext(tx, estimateDraftId, context);
    await authorizeProject(tx, draft.projectId, context);
    const rows = await tx.select(historyColumns).from(jobtreadExports).where(eq(jobtreadExports.estimateDraftId, estimateDraftId)).orderBy(desc(jobtreadExports.createdAt));
    const result: ExportHistorySummary[] = [];
    for (const row of rows) result.push(await summarize(tx, row, context, draft.projectId, estimateDraftId));
    return result;
  });
}
export async function listExportsForProject(projectId: string, context: ExportHistoryContext): Promise<ExportHistorySummary[]> {
  return historyRead(context, async tx => {
    await authorizeProject(tx, projectId, context);
    const rows = await tx.select(historyColumns).from(jobtreadExports).where(eq(jobtreadExports.projectId, projectId)).orderBy(desc(jobtreadExports.createdAt));
    const result: ExportHistorySummary[] = [];
    for (const row of rows) result.push(await summarize(tx, row, context, projectId));
    return result;
  });
}
export async function getExportById(exportId: string, context: ExportHistoryContext): Promise<ExportHistorySummary | null> {
  return historyRead(context, async tx => {
    const [row] = await tx.select(historyColumns).from(jobtreadExports).where(eq(jobtreadExports.id, exportId)).limit(1);
    if (!row) return null;
    if (row.tenantId !== context.tenantId || !row.projectId) return forbidden();
    await authorizeProject(tx, row.projectId, context);
    return summarize(tx, row, context, row.projectId);
  });
}
