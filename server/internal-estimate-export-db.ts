/**
 * A1 export — new attempt (preflight) writer. A1-EXPORT-PREFLIGHT-WRITER-CONTRACT.md.
 *
 * Mirrors the accepted approval writer's transaction/lock/retry/audit pattern
 * (server/internal-estimate-approval-db.ts) by import+alias, never by copying it
 * under a new name. `lockInternalApprovalContext` itself cannot be reused for the
 * read permission this writer needs: it requires a present/coherent client BEFORE
 * authorizing anything, which would make the two export-specific "client missing/
 * incoherent" business diagnoses unreachable. The adapter below authorizes the
 * basic tenant/project/draft context first (reusing the real `requireProjectAccess`
 * chokepoint, no new role), and only classifies the client afterward. Once the
 * client is known coherent, `assertInternalApprovalCalculatedLineage` and
 * `readInternalApprovalRecord` are reused UNCHANGED — this module never re-derives
 * snapshot/decision validation.
 *
 * Preflight only: renders and persists a terminal attempt (ready or blocked), but
 * never returns bytes and never performs delivery/download/regeneration. Those are
 * separate, later contracts; `checkExportAuthorization`/the legacy export helpers
 * in server/jobtread-export-db.ts remain retained and untouched by this slice.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  estimateDrafts, projects, profiles, tenants, clients, jobtreadExports,
  type EstimateDraft, type InsertJobtreadExport,
} from "../drizzle/schema";
import {
  InternalApprovalError, type InternalApprovalSnapshot,
} from "../shared/internal-estimate-approval-engine";
import { HistoricalEstimateError } from "../shared/historical-estimate-engine";
import {
  normalizeExportManifest, checkExportManifestAgainstSnapshot,
  type ExportManifest, type ExportManifestCorrespondence,
} from "../shared/internal-estimate-export-engine";
import {
  renderExportJson, renderExportPrintable, ExportRendererError, type ExportRenderInput,
} from "../shared/internal-estimate-export-renderer";
import { renderExportPdf } from "../shared/internal-estimate-export-pdf-renderer";
import { renderExportCsv } from "../shared/internal-estimate-export-csv-renderer";
import {
  EXPORT_FORMATS, EXPORT_STATUSES, EXPORT_VALIDATION_ISSUE_CODES, EXPORT_PROTOCOL as EP,
  type ExportFormat, type ExportIssueCode,
} from "../shared/domain/taxonomy";
import { logAudit, type AuditLogParams } from "./audit";
import { requireProjectAccess } from "./project-access";
import type { AuthTransaction } from "./auth-transaction";
import {
  nonzeroUuid,
  withInternalApprovalTransaction as withExportAttemptTransaction,
  assertInternalApprovalCalculatedLineage,
  readInternalApprovalRecord,
  type LockedInternalApprovalContext,
  type InternalApprovalRead,
} from "./internal-estimate-approval-db";
import {
  InternalApprovalPersistenceError, InternalApprovalAuditFailure,
} from "./internal-estimate-approval-errors";
import {
  parseExportAttemptSummary, type ExportAttemptSummary as ExportAttemptSummaryType,
} from "../shared/internal-estimate-export-attempt";

// ── Input ─────────────────────────────────────────────────────────────────────
const createExportAttemptContextSchema = z.object({
  tenantId: nonzeroUuid, actorId: nonzeroUuid, projectId: nonzeroUuid, estimateDraftId: nonzeroUuid,
}).strict();
export const createExportAttemptInputSchema = z.object({
  context: createExportAttemptContextSchema, format: z.enum(EXPORT_FORMATS), attemptKind: z.literal("preflight"),
}).strict();
export type CreateExportAttemptInput = z.infer<typeof createExportAttemptInputSchema>;

// ── Output (§9 ExportAttemptSummary, A1 variant only — this writer never returns
// the legacy-union `outcome:'legacy'` shape). The real schema/parser lives in the
// shared module (decision #5, QA V2 item 5): inferred, not hand-declared, so this
// file's internal authority/artifact shapes can never silently drift from the one
// closed response DTO that actually leaves the writer. ──────────────────────────
export type ExportAttemptSummary = ExportAttemptSummaryType;
type ExportAttemptAuthoritySummary = NonNullable<ExportAttemptSummary["authority"]>;
type ExportAttemptArtifactSummary = NonNullable<ExportAttemptSummary["artifact"]>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID");
  return result.data;
}
function integrity(): never { throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR"); }

async function audit(tx: AuthTransaction, params: AuditLogParams): Promise<void> {
  try {
    if (!(await logAudit(params, tx))) throw new Error("Export preflight audit returned no evidence");
  } catch (error) {
    throw new InternalApprovalAuditFailure(error);
  }
}

// ── Authorized context, authority-free (§8: project FOR UPDATE -> draft FOR
// UPDATE -> requireProjectAccess, same order the core writer uses) ────────────
interface BasicExportContext {
  draft: EstimateDraft; project: LockedInternalApprovalContext["project"];
  tenant: LockedInternalApprovalContext["tenant"]; profile: LockedInternalApprovalContext["profile"];
  actorId: string; tenantId: string;
}
async function lockExportAttemptBasicContext(
  tx: AuthTransaction,
  input: { tenantId: string; actorId: string; projectId: string; estimateDraftId: string },
): Promise<BasicExportContext> {
  const [locator] = await tx.select({ projectId: estimateDrafts.projectId }).from(estimateDrafts)
    .where(and(eq(estimateDrafts.id, input.estimateDraftId), eq(estimateDrafts.tenantId, input.tenantId))).limit(1);
  if (!locator?.projectId) throw new InternalApprovalPersistenceError("NOT_FOUND");
  const [project] = await tx.select().from(projects)
    .where(and(eq(projects.id, locator.projectId), eq(projects.tenantId, input.tenantId))).for("update");
  // The caller-declared projectId must be the draft's REAL project, not merely a
  // project that resolves to the same tenant — a confused pairing is NOT_FOUND,
  // never a silent substitution of the caller's projectId.
  if (!project || project.id !== input.projectId) throw new InternalApprovalPersistenceError("NOT_FOUND");
  const [draft] = await tx.select().from(estimateDrafts)
    .where(and(eq(estimateDrafts.id, input.estimateDraftId), eq(estimateDrafts.tenantId, input.tenantId))).for("update");
  if (!draft || draft.projectId !== project.id) throw new InternalApprovalPersistenceError("NOT_FOUND");
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, input.tenantId)).for("share");
  const [profile] = await tx.select().from(profiles).where(eq(profiles.id, input.actorId)).for("share");
  if (!tenant || !tenant.isActive || !profile || profile.tenantId !== input.tenantId || !profile.isActive) {
    throw new InternalApprovalPersistenceError("FORBIDDEN");
  }
  await requireProjectAccess(project.id, input.actorId, "read", { mode: "a1", transaction: tx, expectedTenantId: input.tenantId });
  return { draft, project, tenant, profile, actorId: input.actorId, tenantId: input.tenantId };
}

type ClientResolution =
  | { kind: "missing" }
  | { kind: "mismatch" }
  | { kind: "coherent"; locked: LockedInternalApprovalContext };
/**
 * Authorizes the BASIC context before classifying a missing/incoherent client —
 * never the reverse. clientId=NULL is required for both outcomes below (§3.2):
 * never the contradictory UUID that was actually found/declared.
 */
async function resolveExportClient(tx: AuthTransaction, basic: BasicExportContext): Promise<ClientResolution> {
  const { draft, project, tenant, profile, actorId, tenantId } = basic;
  if (!draft.clientId) return { kind: "missing" };
  if (draft.clientId !== project.clientId) return { kind: "mismatch" };
  const [client] = await tx.select().from(clients).where(eq(clients.id, draft.clientId)).for("share");
  if (!client || client.tenantId !== tenantId) return { kind: "mismatch" };
  return { kind: "coherent", locked: { draft, project, tenant, profile, client, actorId, tenantId } };
}

// ── Authority resolution — reuses the core's lineage guard and decision reader
// unchanged; only classifies what they already distinguish into export codes ──
type AuthorityCode =
  | "ESTIMATE_CLIENT_MISSING" | "ESTIMATE_CLIENT_CONTEXT_MISMATCH" | "HISTORICAL_AUTHORITY_NOT_AVAILABLE"
  | "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" | "INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED"
  | "INTERNAL_APPROVAL_REQUIRED" | "INTERNAL_APPROVAL_REVOKED" | "ESTIMATE_SUPERSEDED";
interface AuthorityBlocked {
  class: "blocked"; code: AuthorityCode; draft: EstimateDraft; clientId: string | null;
  authority: ExportAttemptAuthoritySummary | null; approvedTotalMinor: string | null; estimatedCostMinor: string | null;
}
interface AuthorityUsable {
  class: "usable"; draft: EstimateDraft; clientId: string;
  snapshot: InternalApprovalSnapshot; authority: ExportAttemptAuthoritySummary;
}
type AuthorityResult = AuthorityBlocked | AuthorityUsable;

function authoritySummaryFrom(read: Extract<InternalApprovalRead, { state: "active" } | { state: "revoked" }>): ExportAttemptAuthoritySummary {
  return { approvalId: read.approval.id, snapshotId: read.snapshot.id, contentHash: read.snapshot.contentHash };
}
function blockedAuthority(
  code: AuthorityCode, draft: EstimateDraft, clientId: string | null,
  decided?: Extract<InternalApprovalRead, { state: "active" } | { state: "revoked" }>,
): AuthorityBlocked {
  return {
    class: "blocked", code, draft, clientId,
    authority: decided ? authoritySummaryFrom(decided) : null,
    approvedTotalMinor: decided ? decided.snapshot.snapshotPayload.financials.finalPriceMinor : null,
    estimatedCostMinor: decided ? decided.snapshot.snapshotPayload.financials.estimatedCostMinor : null,
  };
}

async function resolveExportAuthority(tx: AuthTransaction, locked: LockedInternalApprovalContext): Promise<AuthorityResult> {
  try {
    await assertInternalApprovalCalculatedLineage(tx, locked);
  } catch (error) {
    if (error instanceof HistoricalEstimateError && error.code === "HISTORICAL_AUTHORITY_NOT_AVAILABLE") {
      return blockedAuthority("HISTORICAL_AUTHORITY_NOT_AVAILABLE", locked.draft, locked.client.id);
    }
    if (error instanceof InternalApprovalError && error.code === "INTERNAL_APPROVAL_CONTENT_UNRESOLVED") {
      return blockedAuthority("INTERNAL_APPROVAL_CONTENT_UNRESOLVED", locked.draft, locked.client.id);
    }
    throw error;
  }
  let existing: InternalApprovalRead;
  try {
    existing = await readInternalApprovalRecord(tx, locked);
  } catch (error) {
    // readInternalApprovalRecord wraps every non-crypto InternalApprovalError into
    // INTERNAL_APPROVAL_INTEGRITY_ERROR (its own strict boundary, unchanged here).
    // At the EXPORT boundary specifically, a persisted snapshot/decision that fails
    // its own self-check is a legitimate "no usable decision" outcome, not proof of
    // corruption requiring a hard abort — but ONLY at this exact call site. Crypto
    // failures (a different code) and anything else still propagate untouched.
    if (error instanceof InternalApprovalError && error.code === "INTERNAL_APPROVAL_INTEGRITY_ERROR") {
      return blockedAuthority("INTERNAL_APPROVAL_CONTENT_UNRESOLVED", locked.draft, locked.client.id);
    }
    throw error;
  }
  if (existing.state === "none") {
    const code = locked.draft.approvedBy || locked.draft.approvedAt
      ? "INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED" : "INTERNAL_APPROVAL_REQUIRED";
    return blockedAuthority(code, locked.draft, locked.client.id);
  }
  if (existing.state === "revoked") {
    return blockedAuthority("INTERNAL_APPROVAL_REVOKED", locked.draft, locked.client.id, existing);
  }
  if (locked.draft.supersededBy) {
    return blockedAuthority("ESTIMATE_SUPERSEDED", locked.draft, locked.client.id, existing);
  }
  return {
    class: "usable", draft: locked.draft, clientId: locked.client.id,
    snapshot: existing.snapshot.snapshotPayload, authority: authoritySummaryFrom(existing),
  };
}

async function readExportAuthority(
  tx: AuthTransaction, context: CreateExportAttemptInput["context"],
): Promise<AuthorityResult> {
  const basic = await lockExportAttemptBasicContext(tx, context);
  const resolution = await resolveExportClient(tx, basic);
  if (resolution.kind === "missing") return blockedAuthority("ESTIMATE_CLIENT_MISSING", basic.draft, null);
  if (resolution.kind === "mismatch") return blockedAuthority("ESTIMATE_CLIENT_CONTEXT_MISMATCH", basic.draft, null);
  return resolveExportAuthority(tx, resolution.locked);
}
function sameAuthority(a: ExportAttemptAuthoritySummary, b: ExportAttemptAuthoritySummary): boolean {
  return a.approvalId === b.approvalId && a.snapshotId === b.snapshotId && a.contentHash === b.contentHash;
}

// ── Rendering (outside the final tx) ──────────────────────────────────────────
const RENDERER_VERSION_BY_FORMAT: Record<ExportFormat, string> = {
  pdf: EP.pdfRenderer, json: EP.jsonRenderer, printable: EP.printableRenderer, csv_jobtread: EP.csvRenderer,
};
type ExportIssue = ExportManifest["validation"]["issues"][number];
/** Closed, provably exhaustive mapping (decision #2): these are the ONLY three
 * ExportIssueCode values any of the four accepted renderers ever throw via
 * ExportRendererError. Any other code is a contract change this writer has not
 * been authorized for — it must abort loudly, never silently absorb it. */
function mapRendererError(error: ExportRendererError): ExportIssue[] {
  switch (error.code) {
    case "EXPORT_RENDERER_UNAVAILABLE": return [{ code: error.code, lineKey: null, field: "renderer" }];
    case "EXPORT_PAYLOAD_TOO_LARGE": return [{ code: error.code, lineKey: null, field: "bytes" }];
    case "EXPORT_FORMAT_UNREPRESENTABLE": return [{ code: error.code, lineKey: null, field: "format" }];
    default: throw error;
  }
}
type RenderedArtifact = { bytes: Uint8Array; representation: NonNullable<ExportManifest["representation"]> };
async function renderForFormat(format: ExportFormat, input: ExportRenderInput): Promise<RenderedArtifact | { issues: ExportIssue[] }> {
  // Decision #3 fix (QA V2 item 3): CSV's own plural discriminated-result return
  // (`outcome:'ready'|'blocked'`) covers its BUSINESS-level per-line issues, but
  // `renderExportCsv` reuses the SAME shared `assertWithinResponseLimit` helper as
  // the other three renderers and can still structurally THROW ExportRendererError
  // (EXPORT_PAYLOAD_TOO_LARGE) for the one failure mode its discriminated result
  // was never built to carry. One try/catch over all four formats — never a
  // CSV-only call sitting outside it — so that throw maps through the SAME closed
  // list as every other format, instead of escaping uncaught with no blocked
  // attempt/audit recorded at all.
  try {
    if (format === "csv_jobtread") {
      const outcome = await renderExportCsv(input);
      return outcome.outcome === "ready" ? { bytes: outcome.bytes, representation: outcome.representation } : { issues: outcome.issues };
    }
    return format === "pdf" ? await renderExportPdf(input)
      : format === "json" ? await renderExportJson(input)
      : await renderExportPrintable(input);
  } catch (error) {
    if (error instanceof ExportRendererError) return { issues: mapRendererError(error) };
    throw error;
  }
}
type RenderOutcome =
  | { outcome: "ready"; exportId: string; rendererVersion: string; generatedAt: string; generatedBy: string } & RenderedArtifact
  | { outcome: "blocked"; exportId: string; rendererVersion: string; generatedAt: string; generatedBy: string; issues: ExportIssue[] };

// ── Manifest / row assembly ────────────────────────────────────────────────────
/**
 * Mirrors `a1_export_issue_status_class_v1` (migration 0014; originally 0013)
 * exactly. V1 found the two rank-2 codes collapsed to the SAME status
 * ("blocked_reconciliation") under 0013's own function, disagreeing with Export
 * §5.2's prose table (EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED ->
 * "needs_exception_review") — a defect in the physical foundation, not a license
 * to diverge from the approved norm. Migration 0014 repairs the SQL function
 * itself (local-only; no deploy); this mirrors the REPAIRED function, restoring
 * agreement with the prose instead of conforming to the prior defect.
 */
function statusForCode(code: ExportIssueCode): (typeof EXPORT_STATUSES)[number] {
  if (code === "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED") return "needs_exception_review";
  if (code === "EXPORT_RECONCILIATION_MISMATCH") return "blocked_reconciliation";
  if ((EXPORT_VALIDATION_ISSUE_CODES as readonly ExportIssueCode[]).includes(code)) return "blocked_validation";
  return "blocked_authorization";
}
function skillFor(format: ExportFormat): { skillId: string; skillVersion: string } {
  return format === "csv_jobtread"
    ? { skillId: "gchi-jobtread-integration-contract", skillVersion: "1.0.0" }
    : { skillId: "structr-internal-estimate-export", skillVersion: "1.0.0" };
}
function assertCorrespondence(c: ExportManifestCorrespondence): void {
  if (!c.contextMatches) integrity();
  if (c.unknownLineKeys.length > 0) integrity();
  if (c.lineKeysMatchSnapshotExactly === false) integrity();
  if (c.contentHashMatches === false) integrity();
  if (c.approvedTotalMatches === false) integrity();
  if (c.estimatedCostMatches === false) integrity();
  if (c.csv) {
    if (!c.csv.sumCostMatches || !c.csv.sumPriceMatches) integrity();
    for (const row of c.csv.rows) {
      if (row.lineMissing || !row.identityMatches || !row.classificationMatches || !row.rateExact || !row.amountsExact) integrity();
    }
  }
}
/** Sum of the snapshot's own per-line totals — reused ONLY for the one reachable
 * "full totals" blocked code (EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED), whose
 * CSV outcome never returns these sums itself (renderExportCsv returns only
 * issues on that path). Pure BigInt addition of values the core already froze. */
function sumSnapshotTotals(snapshot: InternalApprovalSnapshot): { exportedTotalMinor: string; differenceMinor: string } {
  const sumPrice = snapshot.lines.reduce((total, line) => total + BigInt(line.lineTotalPriceMinor), 0n);
  const approved = BigInt(snapshot.financials.finalPriceMinor);
  return { exportedTotalMinor: sumPrice.toString(), differenceMinor: (sumPrice - approved).toString() };
}

async function insertAndAudit(tx: AuthTransaction, row: InsertJobtreadExport): Promise<void> {
  const [inserted] = await tx.insert(jobtreadExports).values(row).returning({ id: jobtreadExports.id });
  if (!inserted) integrity();
  const manifest = row.manifest as ExportManifest;
  await audit(tx, {
    userId: row.requestedBy ?? null, action: "estimate.export_preflight", tableName: "jobtread_exports", recordId: row.id as string,
    before: null,
    after: {
      tenantId: row.tenantId, projectId: row.projectId, estimateDraftId: row.estimateDraftId,
      format: row.artifactFormat, attemptKind: row.attemptKind, outcome: manifest.outcome, status: row.status,
      artifactHash: row.artifactHash, byteLength: row.artifactByteLength, rendererVersion: row.rendererVersion,
      checkedAt: manifest.checkedAt, delivered: false,
    },
  });
}
/**
 * Builds the final §9 response AND parses it through the closed strict schema
 * (decision #5, QA V2 item 5) — never passes `manifest.validation` through
 * wholesale, which would silently leak the internal manifest's own `version`
 * field into the "closed" response (the exact gap the strict parse exists to
 * catch). A parse failure here throws INSIDE the caller's transaction, aborting
 * it atomically — no attempt is ever partially accepted.
 */
function summaryFrom(manifest: ExportManifest, status: (typeof EXPORT_STATUSES)[number], estimateDraftId: string): ExportAttemptSummary {
  return parseExportAttemptSummary({
    exportId: manifest.exportId, estimateId: estimateDraftId, format: manifest.format, kind: "preflight",
    outcome: manifest.outcome, status, checkedAt: manifest.checkedAt, authority: manifest.authority,
    validation: {
      state: manifest.validation.state, issues: manifest.validation.issues, reconciliation: manifest.validation.reconciliation,
    },
    artifact: manifest.representation ? {
      artifactHash: manifest.representation.artifactHash, byteLength: manifest.representation.byteLength,
      rendererVersion: manifest.representation.rendererVersion, generatedAt: manifest.representation.generatedAt,
    } : null,
    availability: manifest.outcome === "ready" ? "requires_revalidation" : "blocked",
  });
}

async function persistBlockedAuthority(
  tx: AuthTransaction, input: CreateExportAttemptInput, phase: AuthorityBlocked, checkedAt: string, checkedAtDate: Date,
  exportId: string,
): Promise<ExportAttemptSummary> {
  const issues: ExportIssue[] = [{ code: phase.code, lineKey: null, field: null }];
  const status = statusForCode(phase.code);
  const manifest = normalizeExportManifest({
    version: EP.manifest, format: input.format, attemptKind: "preflight", outcome: "blocked", exportId,
    context: {
      tenantId: input.context.tenantId, projectId: phase.draft.projectId, clientId: phase.clientId,
      estimateDraftId: phase.draft.id, estimateVersion: phase.draft.version, requestedBy: input.context.actorId,
    },
    authority: phase.authority, checkedAt, lineKeys: [],
    validation: {
      version: EP.validation, state: "not_evaluated", issues,
      reconciliation: { state: "not_evaluated", approvedTotalMinor: phase.approvedTotalMinor, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: phase.estimatedCostMinor },
    },
    representation: null,
  });
  const { skillId, skillVersion } = skillFor(input.format);
  const row: InsertJobtreadExport = {
    id: exportId, tenantId: input.context.tenantId, projectId: phase.draft.projectId, estimateDraftId: phase.draft.id,
    estimateVersion: phase.draft.version, contractVersion: EP.manifest, status, blockReason: phase.code, rowCount: 0,
    approvedTotalCents: phase.approvedTotalMinor, exportedTotalCents: null, differenceCents: null,
    reconciliationStatus: "not_evaluated", csvHash: null, manifest, validationReport: manifest.validation,
    skillId, skillVersion, requestedBy: input.context.actorId, downloadedBy: null, downloadedAt: null,
    createdAt: checkedAtDate, updatedAt: checkedAtDate,
    artifactContractVersion: EP.manifest, artifactFormat: input.format, attemptKind: "preflight",
    clientId: phase.clientId, internalApprovalId: phase.authority?.approvalId ?? null,
    internalSnapshotId: phase.authority?.snapshotId ?? null, approvedContentHash: phase.authority?.contentHash ?? null,
    artifactHash: null, rendererVersion: null, generatedAt: null, artifactByteLength: null, checkedAt: checkedAtDate,
  };
  await insertAndAudit(tx, row);
  return summaryFrom(manifest, status, phase.draft.id);
}

async function persistBlockedValidation(
  tx: AuthTransaction, input: CreateExportAttemptInput, phase: AuthorityUsable,
  rendered: Extract<RenderOutcome, { outcome: "blocked" }>, checkedAt: string, checkedAtDate: Date,
): Promise<ExportAttemptSummary> {
  const issues = rendered.issues;
  const principal = issues[0].code;
  const status = statusForCode(principal);
  const f = phase.snapshot.financials;
  const full = principal === "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED";
  const totals = full ? sumSnapshotTotals(phase.snapshot) : { exportedTotalMinor: null as string | null, differenceMinor: null as string | null };
  const manifest = normalizeExportManifest({
    version: EP.manifest, format: input.format, attemptKind: "preflight", outcome: "blocked", exportId: rendered.exportId,
    context: {
      tenantId: input.context.tenantId, projectId: phase.draft.projectId, clientId: phase.clientId,
      estimateDraftId: phase.draft.id, estimateVersion: phase.draft.version, requestedBy: input.context.actorId,
    },
    authority: phase.authority, checkedAt, lineKeys: [],
    validation: {
      version: EP.validation, state: "invalid", issues,
      reconciliation: { state: "unrepresentable", approvedTotalMinor: f.finalPriceMinor, exportedTotalMinor: totals.exportedTotalMinor, differenceMinor: totals.differenceMinor, estimatedCostMinor: f.estimatedCostMinor },
    },
    representation: null,
  });
  const correspondence = await checkExportManifestAgainstSnapshot(manifest, phase.snapshot);
  assertCorrespondence(correspondence);
  const { skillId, skillVersion } = skillFor(input.format);
  const row: InsertJobtreadExport = {
    id: rendered.exportId, tenantId: input.context.tenantId, projectId: phase.draft.projectId,
    estimateDraftId: phase.draft.id, estimateVersion: phase.draft.version, contractVersion: EP.manifest,
    status, blockReason: principal, rowCount: 0,
    approvedTotalCents: f.finalPriceMinor, exportedTotalCents: totals.exportedTotalMinor, differenceCents: totals.differenceMinor,
    reconciliationStatus: "unrepresentable", csvHash: null, manifest, validationReport: manifest.validation,
    skillId, skillVersion, requestedBy: input.context.actorId, downloadedBy: null, downloadedAt: null,
    createdAt: checkedAtDate, updatedAt: checkedAtDate,
    artifactContractVersion: EP.manifest, artifactFormat: input.format, attemptKind: "preflight",
    clientId: phase.clientId, internalApprovalId: phase.authority.approvalId, internalSnapshotId: phase.authority.snapshotId,
    approvedContentHash: phase.authority.contentHash, artifactHash: null, rendererVersion: null, generatedAt: null,
    artifactByteLength: null, checkedAt: checkedAtDate,
  };
  await insertAndAudit(tx, row);
  return summaryFrom(manifest, status, phase.draft.id);
}

async function persistReady(
  tx: AuthTransaction, input: CreateExportAttemptInput, phase: AuthorityUsable,
  rendered: Extract<RenderOutcome, { outcome: "ready" }>, checkedAt: string, checkedAtDate: Date,
): Promise<ExportAttemptSummary> {
  const f = phase.snapshot.financials;
  const lineKeys = phase.snapshot.lines.map(line => line.lineKey);
  const manifest = normalizeExportManifest({
    version: EP.manifest, format: input.format, attemptKind: "preflight", outcome: "ready", exportId: rendered.exportId,
    context: {
      tenantId: input.context.tenantId, projectId: phase.draft.projectId, clientId: phase.clientId,
      estimateDraftId: phase.draft.id, estimateVersion: phase.draft.version, requestedBy: input.context.actorId,
    },
    authority: phase.authority, checkedAt, lineKeys,
    validation: {
      version: EP.validation, state: "valid", issues: [],
      reconciliation: { state: "matched", approvedTotalMinor: f.finalPriceMinor, exportedTotalMinor: f.finalPriceMinor, differenceMinor: "0", estimatedCostMinor: f.estimatedCostMinor },
    },
    representation: rendered.representation,
  });
  const correspondence = await checkExportManifestAgainstSnapshot(manifest, phase.snapshot);
  assertCorrespondence(correspondence);
  const { skillId, skillVersion } = skillFor(input.format);
  const row: InsertJobtreadExport = {
    id: rendered.exportId, tenantId: input.context.tenantId, projectId: phase.draft.projectId,
    estimateDraftId: phase.draft.id, estimateVersion: phase.draft.version, contractVersion: EP.manifest,
    status: "approved_for_download", blockReason: null, rowCount: lineKeys.length,
    approvedTotalCents: f.finalPriceMinor, exportedTotalCents: f.finalPriceMinor, differenceCents: "0",
    reconciliationStatus: "matched", csvHash: input.format === "csv_jobtread" ? rendered.representation.artifactHash : null,
    manifest, validationReport: manifest.validation, skillId, skillVersion,
    requestedBy: input.context.actorId, downloadedBy: null, downloadedAt: null,
    createdAt: checkedAtDate, updatedAt: checkedAtDate,
    artifactContractVersion: EP.manifest, artifactFormat: input.format, attemptKind: "preflight",
    clientId: phase.clientId, internalApprovalId: phase.authority.approvalId, internalSnapshotId: phase.authority.snapshotId,
    approvedContentHash: phase.authority.contentHash, artifactHash: rendered.representation.artifactHash,
    rendererVersion: rendered.rendererVersion, generatedAt: new Date(rendered.generatedAt),
    artifactByteLength: rendered.representation.byteLength, checkedAt: checkedAtDate,
  };
  await insertAndAudit(tx, row);
  return summaryFrom(manifest, "approved_for_download", phase.draft.id);
}

// ── Entry point ─────────────────────────────────────────────────────────────
export async function createExportAttempt(rawInput: unknown): Promise<ExportAttemptSummary> {
  const input = parse(createExportAttemptInputSchema, rawInput);

  // Phase 1 — short authorized read, outside any rendering. Determines whether a
  // usable decision exists at all; never renders when it does not.
  const phase1 = await withExportAttemptTransaction(tx => readExportAuthority(tx, input.context));

  // Decision #4 fix (QA V2 item 4): exportId AND every other render-metadata field
  // are fixed exactly ONCE here — before phase 2's retryable callback even starts
  // — and reused for every outcome and every retry attempt of phase 2. Generating
  // a fresh randomUUID() inside the phase-2 callback (V1's bug) would mint a NEW
  // id on every `withInternalApprovalTransaction` retry (it re-executes the WHOLE
  // callback on a 40001/40P01), breaking identity across retries for exactly the
  // attempts that need it most: the ones that never get to render at all.
  const exportId = randomUUID();
  const rendererVersion = RENDERER_VERSION_BY_FORMAT[input.format];
  const generatedAt = new Date().toISOString();
  const generatedBy = input.context.actorId;

  let rendered: RenderOutcome | null = null;
  if (phase1.class === "usable") {
    const result = await renderForFormat(input.format, {
      snapshot: phase1.snapshot, authority: phase1.authority, exportId, rendererVersion, generatedAt, generatedBy,
    });
    rendered = "issues" in result
      ? { outcome: "blocked", exportId, rendererVersion, generatedAt, generatedBy, issues: result.issues }
      : { outcome: "ready", exportId, rendererVersion, generatedAt, generatedBy, bytes: result.bytes, representation: result.representation };
  }

  // Phase 2 — final SERIALIZABLE tx with the core's own retry helper (import+alias,
  // decision #1): reacquire locks, reread identity/permission/decision/revocation/
  // supersession, then persist the one terminal row + its audit, atomically.
  return withExportAttemptTransaction(async tx => {
    const phase2 = await readExportAuthority(tx, input.context);
    const checkedAtDate = new Date();
    const checkedAt = checkedAtDate.toISOString();

    // Decision #B fix (QA V2 item B): compare authority IDENTITY uniformly
    // across phases, regardless of which side was usable/blocked. V2 only
    // compared identity when phase 1 was usable — a blocked phase 1 (e.g. no
    // decision yet) accepted ANY phase-2 blocked diagnosis unconditionally,
    // including one that now carries a REAL, non-null authority (a decision
    // that was born AND already revoked/superseded between the two phases).
    // That is just as invalid a transition as a usable decision disappearing:
    // the decision's identity changed between phases, even though phase 2
    // never saw it as usable. `AuthorityUsable.authority` and
    // `AuthorityBlocked.authority` share the same field/shape — comparing them
    // directly needs no branching on `.class`.
    const phase1Authority = phase1.authority;
    const phase2Authority = phase2.authority;
    const sameIdentity = phase1Authority === null
      ? phase2Authority === null
      : phase2Authority !== null && sameAuthority(phase1Authority, phase2Authority);

    if (phase1.class === "usable") {
      if (phase2.class === "usable") {
        // The world outside this tx produced bytes against a SPECIFIC decision. If
        // the reread no longer agrees it is the SAME decision, that preparation is
        // invalid: refuse with a typed conflict, never render inside this tx and
        // never reuse a stale diagnosis/artifact (§8).
        if (!sameIdentity) throw new InternalApprovalPersistenceError("INTERNAL_APPROVAL_REQUEST_CONFLICT");
        return rendered!.outcome === "blocked"
          ? persistBlockedValidation(tx, input, phase2, rendered as Extract<RenderOutcome, { outcome: "blocked" }>, checkedAt, checkedAtDate)
          : persistReady(tx, input, phase2, rendered as Extract<RenderOutcome, { outcome: "ready" }>, checkedAt, checkedAtDate);
      }
      // Phase 2 is now blocked. Same identity (only possible for
      // INTERNAL_APPROVAL_REVOKED/ESTIMATE_SUPERSEDED, the only two blocked
      // codes that ever carry a non-null authority) means the SAME prepared
      // decision was revoked/superseded between the two phases — preserve that
      // preparation's identity by recording the canonical block (phase2's own
      // authority/totals), discarding the stale rendered bytes. Any OTHER
      // transition still refuses as a conflict.
      if (sameIdentity) return persistBlockedAuthority(tx, input, phase2, checkedAt, checkedAtDate, exportId);
      throw new InternalApprovalPersistenceError("INTERNAL_APPROVAL_REQUEST_CONFLICT");
    }
    // Phase 1 found no usable decision (nothing was rendered). A decision that
    // appeared since must NOT be rendered inside this tx — refuse as a conflict,
    // the same rule as above, just in the opposite direction. A blocked-to-
    // blocked transition persists phase 2's OWN fresh diagnosis below ONLY when
    // the identity didn't change (the SAME absence, still absent, possibly a
    // different code describing it); an identity change — including a BRAND
    // NEW decision that was already revoked/superseded by the time phase 2
    // looked — is still a conflict, never phase 2's diagnosis persisted as if
    // nothing happened.
    if (phase2.class === "usable" || !sameIdentity) {
      throw new InternalApprovalPersistenceError("INTERNAL_APPROVAL_REQUEST_CONFLICT");
    }
    return persistBlockedAuthority(tx, input, phase2, checkedAt, checkedAtDate, exportId);
  });
}
