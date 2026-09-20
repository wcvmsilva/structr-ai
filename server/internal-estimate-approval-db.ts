/** A1 persistence. All decisions and their audit evidence commit together. */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  estimateDrafts,
  projects,
  profiles,
  tenants,
  clients,
  tenantSettings,
  geoZones,
  scopeDrafts,
  historicalEstimateImports,
  estimateInternalApprovalSnapshots as snapshots,
  estimateInternalApprovals as approvals,
  estimateInternalApprovalRevocations as revocations,
  type EstimateDraft,
  type EstimateInternalApprovalSnapshot,
  type EstimateInternalApproval,
  type EstimateInternalApprovalRevocation,
} from "../drizzle/schema";
import {
  InternalApprovalError,
  internalApproveCommandSchema,
  internalRevokeCommandSchema,
  assertInternalApprovalReviewMatch,
  hashInternalApprovalCommand,
  validateInternalApprovalSnapshotRecord,
  normalizeApprovalMinor,
  canonicalizeInternalApproval,
  type ReviewResult,
  type InternalApprovalSnapshot,
  type InternalApprovalPolicyEvaluation,
} from "../shared/internal-estimate-approval-engine";
import {
  INTERNAL_APPROVAL_PROTOCOL as P,
  INTERNAL_APPROVAL_SOURCES,
  INTERNAL_APPROVAL_STATUSES,
} from "../shared/domain/taxonomy";
import { assertHistoricalCaptureOnly } from "../shared/historical-estimate-engine";
import { getDb } from "./db";
import { logAudit, type AuditLogParams } from "./audit";
import { requireProjectAccess, type ProjectPermission } from "./project-access";
import type { AuthTransaction } from "./auth-transaction";
import {
  buildInternalApprovalReviewFromRows,
  type InternalApprovalRows,
} from "./internal-estimate-approval-adapter";
import {
  InternalApprovalPersistenceError,
  InternalApprovalAuditFailure,
} from "./internal-estimate-approval-errors";

// Core §1 UUID grammar, matching the engine's private validator. Zod's uuid()
// adds version/variant restrictions that the Core contract does not impose.
const nonzeroUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(
    value => value !== "00000000-0000-0000-0000-000000000000"
  );
const reviewCommandSchema = z
  .object({ id: nonzeroUuid, confirmedCurrencyCode: z.literal(P.currency) })
  .strict();
type ReviewCommand = z.infer<typeof reviewCommandSchema>;
export type ApproveCommand = z.infer<typeof internalApproveCommandSchema>;
export type RevokeCommand = z.infer<typeof internalRevokeCommandSchema>;
export interface ApproveResult {
  draftId: string;
  draftVersion: number;
  approvalId: string;
  snapshotId: string;
  contentHash: string;
  policyHash: string;
  approvedBy: string;
  approvedAt: string;
  state: "active" | "revoked";
  revocationId: string | null;
  replayed: boolean;
}
export interface RevokeResult {
  draftId: string;
  approvalId: string;
  revocationId: string;
  revokedBy: string;
  revokedAt: string;
  contentHash: string;
  replayed: boolean;
}
interface IdentityRead {
  id: string;
  tenantId: string;
  projectId: string;
  clientId: string;
  estimateDraftId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}
export interface SnapshotRead extends IdentityRead {
  draftVersion: number;
  contractVersion: typeof P.snapshot;
  contentHash: string;
  currencyCode: typeof P.currency;
  currencyBasis: typeof P.currencyBasis;
  subtotalPriceMinor: string;
  discountMinor: string;
  finalPriceMinor: string;
  estimatedCostMinor: string;
  policyVersion: typeof P.evaluator;
  policyHash: string;
  snapshotPayload: InternalApprovalSnapshot;
  policyEvaluation: InternalApprovalPolicyEvaluation;
  capturedBy: string;
}
export interface ApprovalRead extends IdentityRead {
  snapshotId: string;
  requestId: string;
  requestHash: string;
  approvedBy: string;
  approvedAt: string;
  reason: string;
  contractVersion: typeof P.decision;
}
export interface RevocationRead extends IdentityRead {
  approvalId: string;
  requestId: string;
  requestHash: string;
  revokedBy: string;
  revokedAt: string;
  reason: string;
  contractVersion: typeof P.revocation;
}
export type InternalApprovalRead =
  | { state: "none"; approval: null; snapshot: null; revocation: null }
  | {
      state: "active";
      approval: ApprovalRead;
      snapshot: SnapshotRead;
      revocation: null;
    }
  | {
      state: "revoked";
      approval: ApprovalRead;
      snapshot: SnapshotRead;
      revocation: RevocationRead;
    };
type PresentApprovalRead = Exclude<InternalApprovalRead, { state: "none" }>;
export interface LockedInternalApprovalContext {
  draft: EstimateDraft;
  project: InternalApprovalRows["project"];
  tenant: InternalApprovalRows["tenant"];
  profile: InternalApprovalRows["profile"];
  client: InternalApprovalRows["client"];
  actorId: string;
  tenantId: string;
}

function integrity(): never {
  throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
}
function unresolved(): never {
  throw new InternalApprovalError("INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
}
function conflict(): never {
  throw new InternalApprovalPersistenceError(
    "INTERNAL_APPROVAL_REQUEST_CONFLICT"
  );
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID");
  return result.data;
}
function databaseCode(error: unknown): string | undefined {
  // Inspect the complete bounded cause chain before allowing a retry. A wrapper
  // SQLSTATE must never hide an audit failure, cycle, or unexplored inner cause.
  let current: unknown = error;
  let firstCode: string | undefined;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object") return firstCode;
    if (seen.has(current) || current instanceof InternalApprovalAuditFailure)
      return undefined;
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    if (firstCode === undefined && typeof value.code === "string")
      firstCode = value.code;
    current = value.cause;
  }
  return current && typeof current === "object" ? undefined : firstCode;
}
/** Retry the whole unit only; callbacks must have no effects outside this transaction. */
export async function withInternalApprovalTransaction<T>(
  work: (tx: AuthTransaction) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new InternalApprovalPersistenceError("INTERNAL_SERVER_ERROR");
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(work, { isolationLevel: "serializable" });
    } catch (error) {
      const code = databaseCode(error);
      if (attempt < 3 && (code === "40001" || code === "40P01")) continue;
      throw error;
    }
  }
}
async function audit(
  tx: AuthTransaction,
  params: AuditLogParams
): Promise<void> {
  try {
    if (!(await logAudit(params, tx)))
      throw new Error("Internal approval audit returned no evidence");
  } catch (error) {
    throw new InternalApprovalAuditFailure(error);
  }
}

/** Always resolves and authorizes within the transaction; no cached preflight confers authority. */
export async function lockInternalApprovalContext(
  tx: AuthTransaction,
  draftId: string,
  actorId: string,
  tenantId: string,
  permission: ProjectPermission
): Promise<LockedInternalApprovalContext> {
  parse(nonzeroUuid, draftId);
  parse(nonzeroUuid, actorId);
  parse(nonzeroUuid, tenantId);
  const [locator] = await tx
    .select({ projectId: estimateDrafts.projectId })
    .from(estimateDrafts)
    .where(
      and(eq(estimateDrafts.id, draftId), eq(estimateDrafts.tenantId, tenantId))
    )
    .limit(1);
  if (!locator?.projectId)
    throw new InternalApprovalPersistenceError("NOT_FOUND");
  const [project] = await tx
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, locator.projectId), eq(projects.tenantId, tenantId))
    )
    .for("update");
  if (!project) throw new InternalApprovalPersistenceError("NOT_FOUND");
  const [draft] = await tx
    .select()
    .from(estimateDrafts)
    .where(
      and(eq(estimateDrafts.id, draftId), eq(estimateDrafts.tenantId, tenantId))
    )
    .for("update");
  if (
    !draft ||
    draft.projectId !== project.id ||
    !draft.clientId ||
    draft.clientId !== project.clientId
  ) {
    throw new InternalApprovalPersistenceError("NOT_FOUND");
  }
  const [tenant] = await tx
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .for("share");
  const [profile] = await tx
    .select()
    .from(profiles)
    .where(eq(profiles.id, actorId))
    .for("share");
  const [client] = await tx
    .select()
    .from(clients)
    .where(eq(clients.id, draft.clientId))
    .for("share");
  if (
    !tenant ||
    !tenant.isActive ||
    !profile ||
    profile.tenantId !== tenantId ||
    !profile.isActive ||
    !client ||
    client.tenantId !== tenantId
  ) {
    throw new InternalApprovalPersistenceError("FORBIDDEN");
  }
  // Read preserves inactive-client evidence; write/replay/revoke require present active context.
  if (
    permission !== "read" &&
    (!client.isActive ||
      client.deletedAt !== null ||
      project.deletedAt !== null)
  ) {
    throw new InternalApprovalPersistenceError("FORBIDDEN");
  }
  await requireProjectAccess(project.id, actorId, permission, {
    mode: "a1",
    transaction: tx,
    expectedTenantId: tenantId,
  });
  return { draft, project, tenant, profile, client, actorId, tenantId };
}

/** Both derivation edges matter. A bounded DAG traversal rejects cycles and absent/cross-context ancestors. */
export async function assertInternalApprovalCalculatedLineage(
  tx: AuthTransaction,
  context: LockedInternalApprovalContext
): Promise<void> {
  const discovered = new Map<string, EstimateDraft>([
    [context.draft.id, context.draft],
  ]);
  const complete = new Set<string>();
  const visit = async (id: string, path: Set<string>): Promise<void> => {
    if (path.has(id)) unresolved();
    if (complete.has(id)) return;
    let draft = discovered.get(id);
    if (!draft) {
      if (discovered.size >= 1000) unresolved();
      const [found] = await tx
        .select()
        .from(estimateDrafts)
        .where(eq(estimateDrafts.id, id))
        .limit(1);
      if (!found) unresolved();
      draft = found;
      discovered.set(id, draft);
    }
    assertHistoricalCaptureOnly(
      { source: draft.source, hasHistoricalImport: false },
      "internal approval"
    );
    if (
      draft.tenantId !== context.tenantId ||
      draft.projectId !== context.project.id ||
      draft.clientId !== context.client.id
    )
      unresolved();
    const next = new Set(path);
    next.add(id);
    for (const parent of new Set([draft.supersedesId, draft.changeOrderOf]))
      if (parent) await visit(parent, next);
    complete.add(id);
  };
  await visit(context.draft.id, new Set());
  const ids = [...discovered.keys()].sort();
  const imports = await tx
    .select({ id: historicalEstimateImports.id })
    .from(historicalEstimateImports)
    .where(inArray(historicalEstimateImports.estimateDraftId, ids))
    .orderBy(asc(historicalEstimateImports.id))
    .for("share");
  assertHistoricalCaptureOnly(
    { source: context.draft.source, hasHistoricalImport: imports.length > 0 },
    "internal approval"
  );
  for (const draft of discovered.values()) {
    if (
      !INTERNAL_APPROVAL_SOURCES.some(source => source === draft.source) ||
      (draft.source === "version" && !draft.supersedesId) ||
      (draft.source === "change_order" && !draft.changeOrderOf)
    )
      unresolved();
  }
  const additional = ids.filter(id => id !== context.draft.id);
  if (additional.length) {
    const locked = await tx
      .select()
      .from(estimateDrafts)
      .where(inArray(estimateDrafts.id, additional))
      .orderBy(asc(estimateDrafts.id))
      .for("share");
    if (locked.length !== additional.length) unresolved();
    // A concurrent change since the SERIALIZABLE snapshot causes a database serialization failure.
    for (const row of locked)
      if (
        row.tenantId !== context.tenantId ||
        row.projectId !== context.project.id ||
        row.clientId !== context.client.id
      )
        unresolved();
  }
}

async function buildCurrentReview(
  tx: AuthTransaction,
  context: LockedInternalApprovalContext,
  confirmedCurrencyCode: "USD"
): Promise<ReviewResult> {
  const [settings] = await tx
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, context.tenantId))
    .orderBy(asc(tenantSettings.id))
    .for("share");
  const rawZone = context.project.zoneModifierSnapshot;
  const zoneId =
    rawZone &&
    typeof rawZone === "object" &&
    !Array.isArray(rawZone) &&
    "zoneId" in rawZone
      ? rawZone.zoneId
      : null;
  const zone =
    typeof zoneId === "string" && nonzeroUuid.safeParse(zoneId).success
      ? ((
          await tx
            .select()
            .from(geoZones)
            .where(eq(geoZones.id, zoneId))
            .for("share")
        )[0] ?? null)
      : null;
  const scopeDraft = context.draft.scopeDraftId
    ? ((
        await tx
          .select()
          .from(scopeDrafts)
          .where(eq(scopeDrafts.id, context.draft.scopeDraftId))
          .for("share")
      )[0] ?? null)
    : null;
  return buildInternalApprovalReviewFromRows(
    {
      draft: context.draft,
      project: context.project,
      client: context.client,
      tenant: context.tenant,
      profile: context.profile,
      zone,
      settings: settings ?? null,
      scopeDraft,
    },
    {
      tenantId: context.tenantId,
      actorId: context.actorId,
      confirmedCurrencyCode,
    }
  );
}
function assertDraftEligible(draft: EstimateDraft): void {
  if (
    draft.status !== "draft" ||
    draft.supersededBy ||
    draft.approvedAt ||
    draft.approvedBy ||
    draft.lockedAt
  ) {
    throw new InternalApprovalPersistenceError(
      "INTERNAL_APPROVAL_ALREADY_DECIDED"
    );
  }
}

function instant(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    integrity();
  const timestamp = value.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp))
    integrity();
  return timestamp;
}
function uuid(value: unknown): string {
  const result = nonzeroUuid.safeParse(value);
  if (!result.success) integrity();
  return result.data;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) integrity();
  return value;
}
function sameContext(
  row: {
    tenantId: string;
    projectId: string;
    clientId: string;
    estimateDraftId: string;
  },
  context: LockedInternalApprovalContext
): void {
  if (
    row.tenantId !== context.tenantId ||
    row.projectId !== context.project.id ||
    row.clientId !== context.client.id ||
    row.estimateDraftId !== context.draft.id
  )
    integrity();
}
function identityRead(
  row:
    | EstimateInternalApprovalSnapshot
    | EstimateInternalApproval
    | EstimateInternalApprovalRevocation,
  context: LockedInternalApprovalContext
): IdentityRead {
  sameContext(row, context);
  const createdAt = instant(row.createdAt),
    updatedAt = instant(row.updatedAt);
  if (createdAt !== updatedAt || row.deletedAt !== null) integrity();
  return {
    id: uuid(row.id),
    tenantId: uuid(row.tenantId),
    projectId: uuid(row.projectId),
    clientId: uuid(row.clientId),
    estimateDraftId: uuid(row.estimateDraftId),
    createdAt,
    updatedAt,
    deletedAt: null,
  };
}
function commandContext(
  context: LockedInternalApprovalContext,
  actorId = context.actorId
) {
  return {
    tenantId: context.tenantId,
    actorId,
    projectId: context.project.id,
    clientId: context.client.id,
  };
}
function requirePresent(value: InternalApprovalRead): PresentApprovalRead {
  if (value.state === "none") integrity();
  return value;
}

/** Internal authorized reader for version/export wrappers; caller must use the locked context in this tx. */
export async function readInternalApprovalRecord(
  tx: AuthTransaction,
  context: LockedInternalApprovalContext
): Promise<InternalApprovalRead> {
  try {
    return await readValidatedRecord(tx, context);
  } catch (error) {
    if (
      error instanceof InternalApprovalError &&
      error.code !== "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE"
    )
      integrity();
    throw error;
  }
}

async function readValidatedRecord(
  tx: AuthTransaction,
  context: LockedInternalApprovalContext
): Promise<InternalApprovalRead> {
  const draftId = context.draft.id;
  // Do not tenant-filter away a corrupt contextual link: IDs are globally unique, then every identity is checked.
  const snapshotRows = await tx
    .select()
    .from(snapshots)
    .where(eq(snapshots.estimateDraftId, draftId))
    .orderBy(asc(snapshots.id))
    .for("share");
  const approvalRows = await tx
    .select()
    .from(approvals)
    .where(eq(approvals.estimateDraftId, draftId))
    .orderBy(asc(approvals.id))
    .for("share");
  const revokeRows = await tx
    .select()
    .from(revocations)
    .where(eq(revocations.estimateDraftId, draftId))
    .orderBy(asc(revocations.id))
    .for("share");
  if (
    snapshotRows.length === 0 &&
    approvalRows.length === 0 &&
    revokeRows.length === 0
  ) {
    if (
      INTERNAL_APPROVAL_STATUSES.some(status => status === context.draft.status)
    )
      integrity();
    return { state: "none", approval: null, snapshot: null, revocation: null };
  }
  if (
    snapshotRows.length !== 1 ||
    approvalRows.length !== 1 ||
    revokeRows.length > 1
  )
    integrity();
  await assertInternalApprovalCalculatedLineage(tx, context);
  const snapshotRow = snapshotRows[0],
    approvalRow = approvalRows[0],
    revokeRow = revokeRows[0];
  const snapshotIdentity = identityRead(snapshotRow, context),
    approvalIdentity = identityRead(approvalRow, context);
  const checked = await validateInternalApprovalSnapshotRecord({
    snapshot: snapshotRow.snapshotPayload,
    evaluation: snapshotRow.policyEvaluation,
    expectedContentHash: snapshotRow.contentHash,
    expectedPolicyHash: snapshotRow.policyHash,
  });
  const { snapshot, evaluation } = checked,
    f = snapshot.financials;
  if (
    canonicalizeInternalApproval(snapshotRow.snapshotPayload) !==
      canonicalizeInternalApproval(snapshot) ||
    canonicalizeInternalApproval(snapshotRow.policyEvaluation) !==
      canonicalizeInternalApproval(evaluation)
  )
    integrity();
  // The frozen SQL normalizer compares the original draft source without consulting present geo/policy.
  const sourceMatch = await tx.execute<{ matches: boolean | null }>(sql`
    SELECT public.internal_approval_draft_matches_v1(d, ${JSON.stringify(snapshot)}::jsonb, false) AS matches
    FROM public.estimate_drafts d WHERE d.id = ${draftId}::uuid AND d.tenant_id = ${context.tenantId}::uuid
  `);
  if (sourceMatch.length !== 1 || sourceMatch[0]?.matches !== true) integrity();
  if (
    snapshot.identity.tenantId !== context.tenantId ||
    snapshot.identity.projectId !== context.project.id ||
    snapshot.identity.clientId !== context.client.id ||
    snapshot.identity.estimateDraftId !== draftId ||
    snapshot.identity.draftVersion !== context.draft.version ||
    snapshotRow.draftVersion !== context.draft.version ||
    snapshotRow.contractVersion !== P.snapshot ||
    snapshotRow.currencyCode !== P.currency ||
    snapshotRow.currencyBasis !== P.currencyBasis ||
    snapshotRow.policyVersion !== P.evaluator ||
    !evaluation.passed ||
    snapshotRow.subtotalPriceMinor !== f.subtotalPriceMinor ||
    snapshotRow.discountMinor !== f.discountMinor ||
    snapshotRow.finalPriceMinor !== f.finalPriceMinor ||
    snapshotRow.estimatedCostMinor !== f.estimatedCostMinor ||
    snapshotRow.capturedBy !== approvalRow.approvedBy ||
    approvalRow.snapshotId !== snapshotRow.id ||
    approvalRow.contractVersion !== P.decision ||
    instant(approvalRow.approvedAt) !== approvalIdentity.createdAt ||
    snapshotIdentity.createdAt !== approvalIdentity.createdAt ||
    context.draft.approvedBy !== approvalRow.approvedBy ||
    instant(context.draft.approvedAt) !== approvalIdentity.createdAt ||
    instant(context.draft.lockedAt) !== approvalIdentity.createdAt ||
    context.draft.status !==
      (revokeRow ? "internal_approval_revoked" : "internally_approved")
  )
    integrity();
  try {
    if (
      normalizeApprovalMinor(context.draft.subtotalPrice) !==
        f.subtotalPriceMinor ||
      normalizeApprovalMinor(context.draft.discountAmount) !==
        f.discountMinor ||
      normalizeApprovalMinor(context.draft.finalTotalPrice) !==
        f.finalPriceMinor ||
      normalizeApprovalMinor(context.draft.subtotalCost) !==
        f.estimatedCostMinor ||
      context.draft.discountApplied !== f.discountApplied
    )
      integrity();
  } catch {
    integrity();
  }
  const originalCommand = internalApproveCommandSchema.safeParse({
    id: draftId,
    requestId: approvalRow.requestId,
    expectedDraftVersion: snapshotRow.draftVersion,
    expectedContentHash: checked.contentHash,
    expectedPolicyHash: checked.policyHash,
    confirmedCurrencyCode: P.currency,
    reason: approvalRow.reason,
  });
  if (
    !originalCommand.success ||
    originalCommand.data.reason !== approvalRow.reason ||
    (await hashInternalApprovalCommand({
      operation: "approve",
      context: commandContext(context, approvalRow.approvedBy),
      command: originalCommand.data,
    })) !== approvalRow.requestHash
  )
    integrity();
  const authors = [
    ...new Set([
      snapshotRow.capturedBy,
      approvalRow.approvedBy,
      ...(revokeRow ? [revokeRow.revokedBy] : []),
    ]),
  ].sort();
  const authorRows = await tx
    .select({ id: profiles.id, tenantId: profiles.tenantId })
    .from(profiles)
    .where(inArray(profiles.id, authors))
    .orderBy(asc(profiles.id))
    .for("share");
  if (
    authorRows.length !== authors.length ||
    authorRows.some(author => author.tenantId !== context.tenantId)
  )
    integrity();
  const snapshotRead: SnapshotRead = {
    ...snapshotIdentity,
    draftVersion: snapshotRow.draftVersion,
    contractVersion: P.snapshot,
    contentHash: checked.contentHash,
    currencyCode: P.currency,
    currencyBasis: P.currencyBasis,
    subtotalPriceMinor: f.subtotalPriceMinor,
    discountMinor: f.discountMinor,
    finalPriceMinor: f.finalPriceMinor,
    estimatedCostMinor: f.estimatedCostMinor,
    policyVersion: P.evaluator,
    policyHash: checked.policyHash,
    snapshotPayload: snapshot,
    policyEvaluation: evaluation,
    capturedBy: uuid(snapshotRow.capturedBy),
  };
  const approvalRead: ApprovalRead = {
    ...approvalIdentity,
    snapshotId: uuid(approvalRow.snapshotId),
    requestId: uuid(approvalRow.requestId),
    requestHash: hash(approvalRow.requestHash),
    approvedBy: uuid(approvalRow.approvedBy),
    approvedAt: instant(approvalRow.approvedAt),
    reason: approvalRow.reason,
    contractVersion: P.decision,
  };
  if (!revokeRow)
    return {
      state: "active",
      approval: approvalRead,
      snapshot: snapshotRead,
      revocation: null,
    };
  const revokeIdentity = identityRead(revokeRow, context);
  if (
    revokeRow.contractVersion !== P.revocation ||
    revokeRow.approvalId !== approvalRow.id ||
    instant(revokeRow.revokedAt) !== revokeIdentity.createdAt ||
    revokeRow.revokedAt.getTime() < approvalRow.approvedAt.getTime()
  )
    integrity();
  const originalRevoke = internalRevokeCommandSchema.safeParse({
    id: draftId,
    approvalId: approvalRow.id,
    requestId: revokeRow.requestId,
    expectedContentHash: checked.contentHash,
    reason: revokeRow.reason,
  });
  if (
    !originalRevoke.success ||
    originalRevoke.data.reason !== revokeRow.reason ||
    (await hashInternalApprovalCommand({
      operation: "revoke",
      context: commandContext(context, revokeRow.revokedBy),
      command: originalRevoke.data,
    })) !== revokeRow.requestHash
  )
    integrity();
  return {
    state: "revoked",
    approval: approvalRead,
    snapshot: snapshotRead,
    revocation: {
      ...revokeIdentity,
      approvalId: uuid(revokeRow.approvalId),
      requestId: uuid(revokeRow.requestId),
      requestHash: hash(revokeRow.requestHash),
      revokedBy: uuid(revokeRow.revokedBy),
      revokedAt: instant(revokeRow.revokedAt),
      reason: revokeRow.reason,
      contractVersion: P.revocation,
    },
  };
}

function approvedResult(
  value: PresentApprovalRead,
  replayed: boolean
): ApproveResult {
  return {
    draftId: value.approval.estimateDraftId,
    draftVersion: value.snapshot.draftVersion,
    approvalId: value.approval.id,
    snapshotId: value.snapshot.id,
    contentHash: value.snapshot.contentHash,
    policyHash: value.snapshot.policyHash,
    approvedBy: value.approval.approvedBy,
    approvedAt: value.approval.approvedAt,
    state: value.state,
    revocationId: value.revocation?.id ?? null,
    replayed,
  };
}
function revokedResult(
  value: Extract<InternalApprovalRead, { state: "revoked" }>,
  replayed: boolean
): RevokeResult {
  return {
    draftId: value.approval.estimateDraftId,
    approvalId: value.approval.id,
    revocationId: value.revocation.id,
    revokedBy: value.revocation.revokedBy,
    revokedAt: value.revocation.revokedAt,
    contentHash: value.snapshot.contentHash,
    replayed,
  };
}

export async function getInternalApprovalReview(
  command: ReviewCommand,
  actorId: string,
  tenantId: string
): Promise<ReviewResult> {
  const input = parse(reviewCommandSchema, command);
  return withInternalApprovalTransaction(async tx => {
    const context = await lockInternalApprovalContext(
      tx,
      input.id,
      actorId,
      tenantId,
      "approve"
    );
    await assertInternalApprovalCalculatedLineage(tx, context);
    if ((await readInternalApprovalRecord(tx, context)).state !== "none")
      throw new InternalApprovalPersistenceError(
        "INTERNAL_APPROVAL_ALREADY_DECIDED"
      );
    assertDraftEligible(context.draft);
    return buildCurrentReview(tx, context, input.confirmedCurrencyCode);
  });
}

export async function recordInternalEstimateApproval(
  command: ApproveCommand,
  actorId: string,
  tenantId: string
): Promise<ApproveResult> {
  const input = parse(internalApproveCommandSchema, command);
  try {
    return await withInternalApprovalTransaction(async tx => {
      const context = await lockInternalApprovalContext(
        tx,
        input.id,
        actorId,
        tenantId,
        "approve"
      );
      await assertInternalApprovalCalculatedLineage(tx, context);
      const requestHash = await hashInternalApprovalCommand({
        operation: "approve",
        context: commandContext(context),
        command: input,
      });
      const [existingRequest] = await tx
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.tenantId, tenantId),
            eq(approvals.requestId, input.requestId)
          )
        )
        .for("share");
      if (
        existingRequest &&
        (existingRequest.estimateDraftId !== input.id ||
          existingRequest.projectId !== context.project.id ||
          existingRequest.clientId !== context.client.id ||
          existingRequest.approvedBy !== actorId ||
          existingRequest.requestHash !== requestHash)
      )
        conflict();
      const existing = await readInternalApprovalRecord(tx, context);
      if (existingRequest) {
        if (
          existing.state === "none" ||
          existing.approval.id !== existingRequest.id
        )
          integrity();
        return approvedResult(existing, true);
      }
      if (existing.state !== "none")
        throw new InternalApprovalPersistenceError(
          "INTERNAL_APPROVAL_ALREADY_DECIDED"
        );
      assertDraftEligible(context.draft);
      const review = await buildCurrentReview(
        tx,
        context,
        input.confirmedCurrencyCode
      );
      assertInternalApprovalReviewMatch({
        review,
        expectedDraftVersion: input.expectedDraftVersion,
        expectedContentHash: input.expectedContentHash,
        expectedPolicyHash: input.expectedPolicyHash,
      });
      if (!review.evaluation.passed)
        throw new InternalApprovalPersistenceError(
          "PROFIT_SHIELD_CHANNEL_FLOOR"
        );
      const before = structuredClone(context.draft),
        now = new Date(),
        identity = {
          tenantId,
          projectId: context.project.id,
          clientId: context.client.id,
          estimateDraftId: input.id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
      const [updated] = await tx
        .update(estimateDrafts)
        .set({
          status: "internally_approved",
          approvedBy: actorId,
          approvedAt: now,
          lockedAt: now,
          updatedAt: now,
          profitShieldEvaluation: review.evaluation,
          profitShieldPassed: true,
          profitShieldMinPct: review.evaluation.effectiveFloorPct,
          profitShieldFloorPct: review.evaluation.effectiveFloorPct,
        })
        .where(eq(estimateDrafts.id, input.id))
        .returning();
      if (!updated) integrity();
      const f = review.snapshot.financials;
      const [snapshot] = await tx
        .insert(snapshots)
        .values({
          ...identity,
          draftVersion: review.snapshot.identity.draftVersion,
          contractVersion: P.snapshot,
          contentHash: review.contentHash,
          currencyCode: P.currency,
          currencyBasis: P.currencyBasis,
          subtotalPriceMinor: f.subtotalPriceMinor,
          discountMinor: f.discountMinor,
          finalPriceMinor: f.finalPriceMinor,
          estimatedCostMinor: f.estimatedCostMinor,
          policyVersion: P.evaluator,
          policyHash: review.policyHash,
          snapshotPayload: review.snapshot,
          policyEvaluation: review.evaluation,
          capturedBy: actorId,
        })
        .returning();
      if (!snapshot) integrity();
      const [approval] = await tx
        .insert(approvals)
        .values({
          ...identity,
          snapshotId: snapshot.id,
          requestId: input.requestId,
          requestHash,
          approvedBy: actorId,
          approvedAt: now,
          reason: input.reason,
          contractVersion: P.decision,
        })
        .returning();
      if (!approval) integrity();
      await audit(tx, {
        userId: actorId,
        action: "estimate.internal_approved",
        tableName: "estimate_drafts",
        recordId: input.id,
        before,
        after: {
          tenantId,
          projectId: context.project.id,
          clientId: context.client.id,
          draftVersion: updated.version,
          status: updated.status,
          approvalId: approval.id,
          snapshotId: snapshot.id,
          contentHash: review.contentHash,
          policyHash: review.policyHash,
          approvedBy: actorId,
          approvedAt: now.toISOString(),
        },
      });
      return approvedResult(
        requirePresent(
          await readInternalApprovalRecord(tx, { ...context, draft: updated })
        ),
        false
      );
    });
  } catch (error) {
    if (
      !(error instanceof InternalApprovalAuditFailure) &&
      databaseCode(error) === "23505"
    )
      conflict();
    throw error;
  }
}

export async function revokeInternalEstimateApproval(
  command: RevokeCommand,
  actorId: string,
  tenantId: string
): Promise<RevokeResult> {
  const input = parse(internalRevokeCommandSchema, command);
  try {
    return await withInternalApprovalTransaction(async tx => {
      const context = await lockInternalApprovalContext(
        tx,
        input.id,
        actorId,
        tenantId,
        "approve"
      );
      await assertInternalApprovalCalculatedLineage(tx, context);
      const requestHash = await hashInternalApprovalCommand({
        operation: "revoke",
        context: commandContext(context),
        command: input,
      });
      const [existingRequest] = await tx
        .select()
        .from(revocations)
        .where(
          and(
            eq(revocations.tenantId, tenantId),
            eq(revocations.requestId, input.requestId)
          )
        )
        .for("share");
      if (
        existingRequest &&
        (existingRequest.estimateDraftId !== input.id ||
          existingRequest.projectId !== context.project.id ||
          existingRequest.clientId !== context.client.id ||
          existingRequest.revokedBy !== actorId ||
          existingRequest.requestHash !== requestHash)
      )
        conflict();
      const existing = await readInternalApprovalRecord(tx, context);
      if (existing.state === "none")
        throw new InternalApprovalPersistenceError("NOT_FOUND");
      if (
        existing.approval.id !== input.approvalId ||
        existing.snapshot.contentHash !== input.expectedContentHash
      )
        conflict();
      if (existingRequest) {
        if (
          existing.state !== "revoked" ||
          existing.revocation.id !== existingRequest.id
        )
          integrity();
        return revokedResult(existing, true);
      }
      if (existing.state === "revoked")
        throw new InternalApprovalPersistenceError(
          "INTERNAL_APPROVAL_ALREADY_DECIDED"
        );
      const before = structuredClone(context.draft),
        now = new Date();
      const [updated] = await tx
        .update(estimateDrafts)
        .set({ status: "internal_approval_revoked", updatedAt: now })
        .where(eq(estimateDrafts.id, input.id))
        .returning();
      if (!updated) integrity();
      const [revocation] = await tx
        .insert(revocations)
        .values({
          tenantId,
          projectId: context.project.id,
          clientId: context.client.id,
          estimateDraftId: input.id,
          approvalId: existing.approval.id,
          requestId: input.requestId,
          requestHash,
          revokedBy: actorId,
          revokedAt: now,
          reason: input.reason,
          contractVersion: P.revocation,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .returning();
      if (!revocation) integrity();
      await audit(tx, {
        userId: actorId,
        action: "estimate.internal_approval_revoked",
        tableName: "estimate_drafts",
        recordId: input.id,
        before,
        after: {
          tenantId,
          projectId: context.project.id,
          clientId: context.client.id,
          status: updated.status,
          approvalId: existing.approval.id,
          revocationId: revocation.id,
          contentHash: existing.snapshot.contentHash,
          revokedBy: actorId,
          revokedAt: now.toISOString(),
        },
      });
      const result = await readInternalApprovalRecord(tx, {
        ...context,
        draft: updated,
      });
      if (result.state !== "revoked") integrity();
      return revokedResult(result, false);
    });
  } catch (error) {
    if (
      !(error instanceof InternalApprovalAuditFailure) &&
      databaseCode(error) === "23505"
    )
      conflict();
    throw error;
  }
}

export async function getInternalApproval(
  id: string,
  actorId: string,
  tenantId: string
): Promise<InternalApprovalRead> {
  return withInternalApprovalTransaction(async tx => {
    const context = await lockInternalApprovalContext(
      tx,
      id,
      actorId,
      tenantId,
      "read"
    );
    return readInternalApprovalRecord(tx, context);
  });
}
