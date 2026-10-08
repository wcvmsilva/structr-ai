/** Decode an authorized READ snapshot and validate persisted A1 evidence, without a new review. */
import { z } from "zod";
import { ADR002_PROTOCOL } from "../shared/domain/taxonomy";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import {
  getInternalApprovalInputSchema,
  validateInternalApprovalRecordEvidence,
  type InternalApprovalRead,
} from "./internal-estimate-approval-db";
import {
  authenticatedIdentitySchema,
  authenticatedReviewRowsSchema,
  approvalEvidenceSchema,
} from "./authenticated-internal-approval-review";
import { assertPlainData } from "./project-geocode-review-evidence";

const rowsSchema = authenticatedReviewRowsSchema
  .pick({
    draft: true,
    project: true,
    client: true,
    tenant: true,
    profile: true,
  })
  .extend({
    // Without A1 evidence, the legacy read returns none even for a historical/old draft.
    draft: authenticatedReviewRowsSchema.shape.draft.extend({
      version: z.number().int().safe(),
    }),
    client: authenticatedReviewRowsSchema.shape.client.extend({
      isActive: z.boolean().nullable(),
    }),
  })
  .strict();
const envelopeSchema = z
  .object({
    version: z.literal(ADR002_PROTOCOL.approvalRecord),
    context: authenticatedIdentitySchema,
    rows: rowsSchema,
    approvalEvidence: approvalEvidenceSchema,
  })
  .strict();
function integrity(): never {
  throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
}

export async function buildAuthenticatedInternalApprovalRecord(
  raw: unknown,
  command: unknown,
  expectedIdentity: unknown
): Promise<InternalApprovalRead> {
  try {
    assertPlainData(command);
  } catch {
    throw new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID");
  }
  const input = getInternalApprovalInputSchema.safeParse(command);
  if (!input.success)
    throw new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID");
  try {
    assertPlainData(raw);
    assertPlainData(expectedIdentity);
  } catch {
    integrity();
  }
  const expected = authenticatedIdentitySchema.safeParse(expectedIdentity),
    parsed = envelopeSchema.safeParse(raw);
  if (!expected.success || !parsed.success) integrity();
  const { context, rows, approvalEvidence: evidence } = parsed.data;
  if (
    context.actorId !== expected.data.actorId ||
    context.tenantId !== expected.data.tenantId ||
    rows.draft.id !== input.data.id ||
    rows.profile.id !== context.actorId ||
    rows.tenant.id !== context.tenantId ||
    !rows.tenant.isActive ||
    !rows.profile.isActive ||
    [rows.draft, rows.project, rows.client, rows.profile].some(
      row => row.tenantId !== context.tenantId
    ) ||
    rows.draft.projectId !== rows.project.id ||
    rows.draft.clientId !== rows.client.id ||
    rows.project.clientId !== rows.client.id ||
    rows.project.deletedAt !== null
  )
    integrity();
  if (
    evidence.snapshots.length === 0 &&
    evidence.approvals.length === 0 &&
    evidence.revocations.length === 0 &&
    (evidence.sourceMatches !== null || evidence.authors.length !== 0)
  )
    integrity();
  try {
    return await validateInternalApprovalRecordEvidence(
      { ...context, ...rows },
      {
        snapshotRows: evidence.snapshots,
        approvalRows: evidence.approvals,
        revokeRows: evidence.revocations,
      },
      {
        // The same RPC transaction checks lineage and captures the source verdict.
        validateLineage: async () => {},
        sourceMatches: async () => evidence.sourceMatches === true,
        loadAuthors: async ids => {
          if (
            evidence.authors.length !== ids.length ||
            new Set(evidence.authors.map(a => a.id)).size !== ids.length ||
            evidence.authors.some(a => !ids.includes(a.id))
          )
            integrity();
          return evidence.authors;
        },
      }
    );
  } catch (error) {
    if (
      error instanceof InternalApprovalError &&
      error.code === "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE"
    )
      throw error;
    integrity();
  }
}
