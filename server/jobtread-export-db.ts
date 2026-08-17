/**
 * structr.ai — PHASE 2 JobTread Export Gate
 *
 * Implements the export contract of docs/phase2-contract.md §8 and the rules of the
 * gchi-jobtread-integration-contract skill.
 *
 * Pipeline (single authorization path — no bypass):
 *   requested → validating → reconciling → approved_for_download → downloaded
 *                      ↘ blocked_authorization / blocked_validation / blocked_reconciliation
 *
 * Guarantees:
 *   JIC-002  only an approved, non-superseded estimate can be exported
 *   JIC-003  Σ(Quantity × Unit Price) must equal the approved total, in integer cents
 *   JIC-005  cost codes are governed in a manifest, never as a 10th CSV column
 *   JIC-014  every attempt is recorded immutably, including blocked attempts
 */

import { createHash } from "crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  estimateDrafts,
  jobtreadExports,
  type EstimateDraft,
  type JobtreadExport,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import {
  generateCsvRows,
  generateCsvString,
  inferCostCode,
  isValidCostCode,
  validateCsvExport,
  type CsvValidationReport,
  type JobTreadCsvRow,
} from "./jobtread-csv-export";
import {
  buildExportManifest,
  canDownloadExport,
  canTransitionExport,
  isExportBlocked,
  JOBTREAD_CONTRACT_VERSION,
  reconcileExport,
  type ExportManifest,
  type ExportState,
  type ReconciliationResult,
} from "@shared/jobtread-reconciliation";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════
// AUTHORIZATION (JIC-002)
// ══════════════════════════════════════════════════════════════════════

export interface AuthorizationCheck {
  authorized: boolean;
  reason: string | null;
  draft: EstimateDraft | null;
}

/**
 * Check whether an estimate may be exported at all.
 * Being "approved" is necessary but not sufficient: a superseded approval and a change
 * order are both approved rows that must not be exported as the project budget.
 */
export async function checkExportAuthorization(
  estimateDraftId: string,
): Promise<AuthorizationCheck> {
  const db = await getDb();
  if (!db) throw new ExportError("DB_UNAVAILABLE", "Database not available");

  const [draft] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, estimateDraftId))
    .limit(1);

  if (!draft) {
    return {
      authorized: false,
      reason: `Estimate draft ${estimateDraftId} not found.`,
      draft: null,
    };
  }

  if (draft.status !== "approved") {
    return {
      authorized: false,
      reason: `Estimate draft ${draft.id} is "${draft.status}". Only an approved estimate can be exported to JobTread (JIC-002).`,
      draft,
    };
  }

  if (draft.supersededBy) {
    return {
      authorized: false,
      reason: `Estimate draft ${draft.id} was superseded by ${draft.supersededBy}. Export the current approved version instead (JIC-002).`,
      draft,
    };
  }

  if (draft.approvedAt == null) {
    return {
      authorized: false,
      reason: `Estimate draft ${draft.id} is marked approved but has no approval timestamp — approval evidence is incomplete.`,
      draft,
    };
  }

  return { authorized: true, reason: null, draft };
}

// ══════════════════════════════════════════════════════════════════════
// MANIFEST METADATA
// ══════════════════════════════════════════════════════════════════════

/**
 * Build the per-row governance metadata for the manifest.
 * Cost codes come from the line item when present and are inferred from the cost group
 * otherwise; either way the source is recorded so an unmapped code is visible.
 */
function buildRowMetadata(
  rows: JobTreadCsvRow[],
  draft: EstimateDraft,
): Parameters<typeof buildExportManifest>[0]["rowMetadata"] {
  const lineItems = (draft.lineItems ?? []) as Array<{
    costItemName?: string;
    costGroupName?: string;
    costCode?: string | null;
    catalogItemId?: string | null;
    assemblyId?: string | null;
  }>;

  return rows.map((row) => {
    const match = lineItems.find(
      (li) =>
        li.costItemName === row["Cost Item Name"] &&
        li.costGroupName === row["Cost Group Name"],
    );

    const explicitCode = match?.costCode ?? null;
    const inferred = inferCostCode(row["Cost Group Name"]);
    const costCode = explicitCode ?? inferred;

    return {
      costCode,
      costCodeSource: explicitCode
        ? ("line_item" as const)
        : inferred
          ? ("inferred" as const)
          : ("missing" as const),
      estimateLineItemId: match?.catalogItemId ?? null,
      assemblyId: match?.assemblyId ?? null,
      // An assembly summary row is produced when the assembly has no component line
      // items; the description carries the marker generated by assemblyToCsvRows.
      assemblySummaryFallback: row.Description.startsWith("Assembly: "),
    };
  });
}

// ══════════════════════════════════════════════════════════════════════
// EXPORT ATTEMPT
// ══════════════════════════════════════════════════════════════════════

/**
 * Run a full export attempt.
 *
 * Every attempt is persisted, including blocked ones: a blocked export is operational
 * evidence that something upstream is wrong, and hiding it would remove the signal.
 * The CSV payload is only returned when the attempt reaches `approved_for_download`.
 */
export async function requestJobTreadExport(
  input: RequestExportInput,
): Promise<ExportAttemptResult> {
  const db = await getDb();
  if (!db) throw new ExportError("DB_UNAVAILABLE", "Database not available");

  // ── State: requested → authorization ──────────────────────────────
  const auth = await checkExportAuthorization(input.estimateDraftId);

  if (!auth.draft) {
    throw new ExportError(
      "ESTIMATE_NOT_FOUND",
      `Estimate draft ${input.estimateDraftId} not found`,
      { estimateDraftId: input.estimateDraftId },
    );
  }

  const draft = auth.draft;

  if (!auth.authorized) {
    const record = await persistAttempt({
      draft,
      tenantId: input.tenantId ?? draft.tenantId ?? null,
      userId: input.userId,
      status: "blocked_authorization",
      blockReason: auth.reason,
      validation: null,
      reconciliation: null,
      manifest: null,
      csvHash: null,
    });

    throw new ExportError("ESTIMATE_NOT_APPROVED", auth.reason ?? "Export not authorized", {
      estimateDraftId: draft.id,
      exportId: record.id,
      status: record.status,
    });
  }

  // ── State: validating ─────────────────────────────────────────────
  const rows = generateCsvRows(draft);
  const validation = validateCsvExport(rows);
  const rowMetadata = buildRowMetadata(rows, draft);

  if (!validation.isValid) {
    const reconciliation = reconcileExport({
      rows,
      approvedTotal: draft.finalTotalPrice,
      declaredAdjustments: input.declaredAdjustments,
    });
    const manifest = buildExportManifest({
      estimateDraftId: draft.id,
      estimateVersion: draft.version,
      projectId: draft.projectId,
      tenantId: input.tenantId ?? draft.tenantId ?? null,
      rows,
      rowMetadata,
      reconciliation,
      isValidCostCode,
    });

    const blockReason = `${validation.invalidRows} of ${validation.totalRows} row(s) failed JobTread validation: ${validation.errors
      .slice(0, 5)
      .map((e) => `row ${e.rowIndex + 1} ${e.field}: ${e.error}`)
      .join("; ")}${validation.errors.length > 5 ? ` (+${validation.errors.length - 5} more)` : ""}`;

    const record = await persistAttempt({
      draft,
      tenantId: input.tenantId ?? draft.tenantId ?? null,
      userId: input.userId,
      status: "blocked_validation",
      blockReason,
      validation,
      reconciliation,
      manifest,
      csvHash: null,
    });

    return {
      exportId: record.id,
      status: "blocked_validation",
      canDownload: false,
      blockReason,
      validation,
      reconciliation,
      manifest,
      csvHash: null,
      rowCount: rows.length,
    };
  }

  // ── State: reconciling ────────────────────────────────────────────
  const reconciliation = reconcileExport({
    rows,
    approvedTotal: draft.finalTotalPrice,
    declaredAdjustments: input.declaredAdjustments,
  });

  const manifest = buildExportManifest({
    estimateDraftId: draft.id,
    estimateVersion: draft.version,
    projectId: draft.projectId,
    tenantId: input.tenantId ?? draft.tenantId ?? null,
    rows,
    rowMetadata,
    reconciliation,
    isValidCostCode,
  });

  if (reconciliation.status !== "reconciled") {
    const status: ExportState =
      reconciliation.status === "needs_exception_review"
        ? "needs_exception_review"
        : "blocked_reconciliation";

    const record = await persistAttempt({
      draft,
      tenantId: input.tenantId ?? draft.tenantId ?? null,
      userId: input.userId,
      status,
      blockReason: reconciliation.message,
      validation,
      reconciliation,
      manifest,
      csvHash: null,
    });

    return {
      exportId: record.id,
      status,
      canDownload: false,
      blockReason: reconciliation.message,
      validation,
      reconciliation,
      manifest,
      csvHash: null,
      rowCount: rows.length,
    };
  }

  // ── State: approved_for_download ──────────────────────────────────
  const csvString = generateCsvString(rows);
  const csvHash = createHash("sha256").update(csvString).digest("hex");

  const record = await persistAttempt({
    draft,
    tenantId: input.tenantId ?? draft.tenantId ?? null,
    userId: input.userId,
    status: "approved_for_download",
    blockReason: null,
    validation,
    reconciliation,
    manifest,
    csvHash,
  });

  return {
    exportId: record.id,
    status: "approved_for_download",
    canDownload: true,
    blockReason: null,
    validation,
    reconciliation,
    manifest,
    csvString,
    csvHash,
    rowCount: rows.length,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ══════════════════════════════════════════════════════════════════════

interface PersistAttemptInput {
  draft: EstimateDraft;
  tenantId: string | null;
  userId: string;
  status: ExportState;
  blockReason: string | null;
  validation: CsvValidationReport | null;
  reconciliation: ReconciliationResult | null;
  manifest: ExportManifest | null;
  csvHash: string | null;
}

/** Insert the export attempt row and audit it. Attempts are never updated in place. */
async function persistAttempt(input: PersistAttemptInput): Promise<JobtreadExport> {
  const db = await getDb();
  if (!db) throw new ExportError("DB_UNAVAILABLE", "Database not available");

  const [record] = await db
    .insert(jobtreadExports)
    .values({
      tenantId: input.tenantId,
      projectId: input.draft.projectId,
      estimateDraftId: input.draft.id,
      estimateVersion: input.draft.version,
      contractVersion: JOBTREAD_CONTRACT_VERSION,
      status: input.status,
      blockReason: input.blockReason,
      rowCount: input.manifest?.rowCount ?? 0,
      approvedTotalCents: input.reconciliation?.approvedTotalCents ?? null,
      exportedTotalCents: input.reconciliation?.exportedTotalCents ?? null,
      differenceCents: input.reconciliation?.differenceCents ?? null,
      reconciliationStatus: input.reconciliation?.status ?? null,
      csvHash: input.csvHash,
      manifest: input.manifest as unknown as Record<string, unknown> | null,
      validationReport: input.validation
        ? ({
            isValid: input.validation.isValid,
            totalRows: input.validation.totalRows,
            validRows: input.validation.validRows,
            invalidRows: input.validation.invalidRows,
            errors: input.validation.errors,
            summary: input.validation.summary,
          } as unknown as Record<string, unknown>)
        : null,
      requestedBy: input.userId,
    })
    .returning();

  await logAudit({
    userId: input.userId,
    action: isExportBlocked(input.status)
      ? "jobtread.export_blocked"
      : "jobtread.export_approved",
    tableName: "jobtread_exports",
    recordId: record.id,
    before: {
      estimateDraftId: input.draft.id,
      estimateVersion: input.draft.version,
      estimateStatus: input.draft.status,
      approvedTotal: input.draft.finalTotalPrice,
    },
    after: {
      status: input.status,
      blockReason: input.blockReason,
      rowCount: input.manifest?.rowCount ?? 0,
      reconciliationStatus: input.reconciliation?.status ?? null,
      differenceCents: input.reconciliation?.differenceCents ?? null,
      costCodeIssues: input.manifest?.costCodeIssues.length ?? 0,
      csvHash: input.csvHash,
      contractVersion: JOBTREAD_CONTRACT_VERSION,
    },
  }).catch(() => undefined);

  return record;
}

// ══════════════════════════════════════════════════════════════════════
// DOWNLOAD
// ══════════════════════════════════════════════════════════════════════

/**
 * Return the CSV payload for an approved export attempt and mark it downloaded.
 *
 * The CSV is regenerated from the estimate rather than stored, and the hash is compared
 * against the approved attempt. A hash mismatch means the estimate changed after
 * approval, which must block the download instead of shipping a stale file.
 */
export async function downloadJobTreadExport(
  exportId: string,
  userId: string,
): Promise<{ csvString: string; export: JobtreadExport; filename: string }> {
  const db = await getDb();
  if (!db) throw new ExportError("DB_UNAVAILABLE", "Database not available");

  const [record] = await db
    .select()
    .from(jobtreadExports)
    .where(eq(jobtreadExports.id, exportId))
    .limit(1);

  if (!record) {
    throw new ExportError("EXPORT_NOT_FOUND", `Export ${exportId} not found`, { exportId });
  }

  if (!canDownloadExport(record.status as ExportState)) {
    throw new ExportError(
      "EXPORT_BLOCKED",
      `Export ${exportId} is "${record.status}" and cannot be downloaded. ${record.blockReason ?? ""}`.trim(),
      { exportId, status: record.status, blockReason: record.blockReason },
    );
  }

  if (!record.estimateDraftId) {
    throw new ExportError("ESTIMATE_NOT_FOUND", `Export ${exportId} has no estimate reference`, {
      exportId,
    });
  }

  const [draft] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, record.estimateDraftId))
    .limit(1);

  if (!draft) {
    throw new ExportError(
      "ESTIMATE_NOT_FOUND",
      `Estimate draft ${record.estimateDraftId} no longer exists`,
      { exportId },
    );
  }

  const rows = generateCsvRows(draft);
  const csvString = generateCsvString(rows);
  const csvHash = createHash("sha256").update(csvString).digest("hex");

  if (record.csvHash && record.csvHash !== csvHash) {
    throw new ExportError(
      "RECONCILIATION_FAILED",
      `Estimate content changed after this export was approved (hash mismatch). Request a new export so validation and reconciliation run against the current numbers.`,
      { exportId, expectedHash: record.csvHash, actualHash: csvHash },
    );
  }

  const now = new Date();
  if (canTransitionExport(record.status as ExportState, "downloaded")) {
    await db
      .update(jobtreadExports)
      .set({ status: "downloaded", downloadedBy: userId, downloadedAt: now, updatedAt: now })
      .where(eq(jobtreadExports.id, exportId));
  }

  await logAudit({
    userId,
    action: "jobtread.export_downloaded",
    tableName: "jobtread_exports",
    recordId: exportId,
    before: { status: record.status },
    after: {
      status: "downloaded",
      csvHash,
      rowCount: rows.length,
      estimateDraftId: draft.id,
      estimateVersion: draft.version,
    },
  }).catch(() => undefined);

  const [updated] = await db
    .select()
    .from(jobtreadExports)
    .where(eq(jobtreadExports.id, exportId))
    .limit(1);

  const filename = `jobtread-budget-${draft.projectId ?? "project"}-v${draft.version}.csv`;

  return { csvString, export: updated ?? record, filename };
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** List export attempts for an estimate draft, newest first. */
export async function listExportsForEstimate(
  estimateDraftId: string,
): Promise<JobtreadExport[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jobtreadExports)
    .where(eq(jobtreadExports.estimateDraftId, estimateDraftId))
    .orderBy(desc(jobtreadExports.createdAt));
}

/** List export attempts for a project, newest first. */
export async function listExportsForProject(projectId: string): Promise<JobtreadExport[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jobtreadExports)
    .where(eq(jobtreadExports.projectId, projectId))
    .orderBy(desc(jobtreadExports.createdAt));
}

/** Read a single export attempt. */
export async function getExportById(exportId: string): Promise<JobtreadExport | null> {
  const db = await getDb();
  if (!db) return null;
  const [record] = await db
    .select()
    .from(jobtreadExports)
    .where(eq(jobtreadExports.id, exportId))
    .limit(1);
  return record ?? null;
}
