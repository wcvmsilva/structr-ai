/** Foundational version persistence. No router is mounted by this module. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { estimateDrafts, scopeDrafts, type EstimateDraft } from "../drizzle/schema";
import { InternalApprovalError, internalApprovalVersionPrimitives } from "../shared/internal-estimate-approval-engine";
import {
  buildEstimateVersionPreviewV2, hashEstimateVersionCommandV2,
  normalizeEstimateCreateVersionCommand, normalizeEstimateVersionPreviewCommand,
  projectEstimateVersionDraftV2, type CreateVersionCommandV2,
  type VersionPreviewCommandV2, type VersionPreviewV2,
} from "../shared/estimate-version-engine";
import { ESTIMATE_VERSION_PROTOCOL_V2 } from "../shared/domain/taxonomy";
import type { AuthTransaction } from "./auth-transaction";
import {
  withInternalApprovalTransaction, lockInternalApprovalContext,
  assertInternalApprovalCalculatedLineage, readInternalApprovalRecord,
  loadInternalApprovalRows, type LockedInternalApprovalContext, type InternalApprovalRead,
} from "./internal-estimate-approval-db";
import { InternalApprovalAuditFailure, InternalApprovalPersistenceError } from "./internal-estimate-approval-errors";
import { buildEstimateVersionCopyFromRows } from "./internal-estimate-approval-adapter";
import { assertInternalEstimateReferences } from "./internal-estimate-reference-db";
import { auditEstimateMutation } from "./estimate-mutation-db";

export interface EstimateVersionCreateResultV2 {
  draftId: string;
  draftVersion: number;
  supersedesId: string;
  replayed: boolean;
}
function unresolved(): never { throw new InternalApprovalError("INTERNAL_APPROVAL_CONTENT_UNRESOLVED"); }
function integrity(): never { throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR"); }
function stale(): never { throw new InternalApprovalError("INTERNAL_APPROVAL_REVIEW_STALE"); }
function conflict(): never { throw new InternalApprovalPersistenceError("INTERNAL_APPROVAL_REQUEST_CONFLICT"); }
/** Only a fully inspected request-unique failure can be relabeled after rollback. */
function isRequestUniqueConflict(error: unknown): boolean {
  let current: unknown = error;
  let found = false;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth++) {
    if (current == null) return found;
    if (typeof current !== "object" || seen.has(current) || current instanceof InternalApprovalAuditFailure) return false;
    seen.add(current);
    const value = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (value.code !== undefined) {
      if (value.code !== "23505" || value.constraint_name !== "uq_ed_a1_version_request") return false;
      found = true;
    }
    current = value.cause;
  }
  return current == null && found;
}
function commandContext(context: LockedInternalApprovalContext) {
  return { tenantId: context.tenantId, actorId: context.actorId, projectId: context.project.id, clientId: context.client.id };
}

/** New-copy predicates are deliberately separate from permanent request replay. */
async function newCopyPreview(
  tx: AuthTransaction,
  context: LockedInternalApprovalContext,
  record: InternalApprovalRead,
  command: VersionPreviewCommandV2,
): Promise<VersionPreviewV2> {
  const draft = context.draft;
  if (draft.supersededBy !== null) unresolved();
  let preview: VersionPreviewV2;
  if (command.sourceKind === "current_draft") {
    if (record.state !== "none") stale();
    if (draft.status !== "draft" || draft.lockedAt || draft.approvedAt || draft.approvedBy) unresolved();
    const built = await buildEstimateVersionCopyFromRows(await loadInternalApprovalRows(tx, context), {
      tenantId: context.tenantId, actorId: context.actorId, confirmedCurrencyCode: command.confirmedCurrencyCode,
    });
    preview = await buildEstimateVersionPreviewV2({ command, content: built.content, sourceApprovalId: null, sourceApprovalState: null });
    if (preview.sourceContentHash !== built.contentHash) integrity();
  } else {
    if (record.state === "none") stale();
    preview = await buildEstimateVersionPreviewV2({ command, content: record.snapshot.snapshotPayload,
      sourceApprovalId: record.approval.id, sourceApprovalState: record.state });
    if (preview.sourceContentHash !== record.snapshot.contentHash) integrity();
    const scopeId = preview.content.scopeReference.scopeDraftId;
    if (scopeId !== null) {
      const scopes = await tx.select({ id: scopeDrafts.id, tenantId: scopeDrafts.tenantId, projectId: scopeDrafts.projectId })
        .from(scopeDrafts).where(eq(scopeDrafts.id, scopeId)).for("share");
      if (scopes.length !== 1 || scopes[0].id !== scopeId
        || scopes[0].tenantId !== context.tenantId || scopes[0].projectId !== context.project.id) unresolved();
    }
  }
  const identity = preview.content.identity;
  if (identity.tenantId !== context.tenantId || identity.projectId !== context.project.id
    || identity.clientId !== context.client.id || identity.estimateDraftId !== draft.id
    || identity.draftVersion !== draft.version) integrity();
  await assertInternalEstimateReferences(tx, preview.content.origin, commandContext(context));
  return preview;
}

function validateReplayIdentity(
  child: EstimateDraft,
  context: LockedInternalApprovalContext,
  command: CreateVersionCommandV2,
  requestHash: string,
): void {
  if (!internalApprovalVersionPrimitives.uuid.safeParse(child.id).success
    || !internalApprovalVersionPrimitives.version.safeParse(child.version).success
    || child.version <= context.draft.version
    || child.tenantId !== context.tenantId || child.projectId !== context.project.id
    || child.clientId !== context.client.id || child.createdBy !== context.actorId
    || child.source !== "version" || child.supersedesId !== context.draft.id
    || child.id === context.draft.id || context.draft.supersededBy !== child.id
    || context.draft.version !== command.expectedSourceVersion
    || child.a1VersionRequestId !== command.requestId || child.a1VersionRequestHash !== requestHash) conflict();
}

export async function getEstimateVersionPreviewV2(
  command: unknown, actorId: string, tenantId: string,
): Promise<VersionPreviewV2> {
  const input = normalizeEstimateVersionPreviewCommand(command);
  return withInternalApprovalTransaction(async tx => {
    const context = await lockInternalApprovalContext(tx, input.sourceDraftId, actorId, tenantId, "write");
    await assertInternalApprovalCalculatedLineage(tx, context);
    const record = await readInternalApprovalRecord(tx, context);
    return newCopyPreview(tx, context, record, input);
  });
}

export async function createEstimateVersionV2(
  command: unknown, actorId: string, tenantId: string,
): Promise<EstimateVersionCreateResultV2> {
  const input = normalizeEstimateCreateVersionCommand(command);
  return withInternalApprovalTransaction(async tx => {
    const context = await lockInternalApprovalContext(tx, input.sourceDraftId, actorId, tenantId, "write");
    await assertInternalApprovalCalculatedLineage(tx, context);
    const auth = commandContext(context);
    const requestHash = await hashEstimateVersionCommandV2({ context: auth, command: input });
    // Revalidate original evidence if present; this reader never reconstructs current policy/geo.
    const record = await readInternalApprovalRecord(tx, context);
    const existing = await tx.select().from(estimateDrafts).where(and(
      eq(estimateDrafts.tenantId, tenantId), eq(estimateDrafts.a1VersionRequestId, input.requestId),
    )).for("update");
    if (existing.length > 1) integrity();
    if (existing.length === 1) {
      const child = existing[0];
      validateReplayIdentity(child, context, input, requestHash);
      await assertInternalApprovalCalculatedLineage(tx, { ...context, draft: child });
      return { draftId: child.id, draftVersion: child.version, supersedesId: context.draft.id, replayed: true };
    }

    const previewInput = normalizeEstimateVersionPreviewCommand({
      version: ESTIMATE_VERSION_PROTOCOL_V2.previewCommand, sourceKind: input.sourceKind,
      sourceDraftId: input.sourceDraftId, confirmedCurrencyCode: input.confirmedCurrencyCode,
    });
    const preview = await newCopyPreview(tx, context, record, previewInput);
    if (preview.sourceVersion !== input.expectedSourceVersion || preview.sourceContentHash !== input.expectedSourceContentHash) stale();
    const [maximum] = await tx.select({ version: sql<number | null>`max(${estimateDrafts.version})` })
      .from(estimateDrafts).where(and(eq(estimateDrafts.tenantId, tenantId), eq(estimateDrafts.projectId, context.project.id)));
    if (!maximum || typeof maximum.version !== "number" || !Number.isInteger(maximum.version)
      || maximum.version < context.draft.version || maximum.version >= 2147483647) unresolved();
    const projection = await projectEstimateVersionDraftV2({ preview, command: input, context: auth,
      allocation: { id: randomUUID(), version: maximum.version + 1, timestamp: new Date().toISOString() } });
    if (projection.a1VersionRequestHash !== requestHash) integrity();
    // The projector is the closed 54-column whitelist. JSON is bound explicitly so
    // exact string money is not cast to the old Number-based line/selection DTOs.
    const [child] = await tx.insert(estimateDrafts).values({
      ...projection,
      lineItems: sql`${JSON.stringify(projection.lineItems)}::jsonb`,
      assemblySelections: sql`${JSON.stringify(projection.assemblySelections)}::jsonb`,
      pricingSnapshot: sql`${JSON.stringify(projection.pricingSnapshot)}::jsonb`,
    }).returning();
    if (!child || child.id !== projection.id || child.version !== projection.version
      || child.supersedesId !== context.draft.id || child.a1VersionRequestHash !== requestHash) integrity();

    const before = { supersededBy: context.draft.supersededBy, updatedAt: context.draft.updatedAt };
    const [parent] = await tx.update(estimateDrafts).set({ supersededBy: child.id, updatedAt: projection.createdAt })
      .where(and(eq(estimateDrafts.id, context.draft.id), eq(estimateDrafts.tenantId, tenantId)))
      .returning({ id: estimateDrafts.id, supersededBy: estimateDrafts.supersededBy });
    if (!parent || parent.id !== context.draft.id || parent.supersededBy !== child.id) integrity();
    await auditEstimateMutation(tx, { userId: actorId, action: "estimate.version_created", tableName: "estimate_drafts",
      recordId: context.draft.id, before,
      after: { ...auth, supersededBy: child.id, draftVersion: child.version, requestId: input.requestId,
        requestHash, sourceContentHash: preview.sourceContentHash, createdAt: projection.createdAt.toISOString() },
    });
    return { draftId: child.id, draftVersion: child.version, supersedesId: context.draft.id, replayed: false };
  }).catch(error => {
    if (isRequestUniqueConflict(error)) conflict();
    throw error;
  });
}
