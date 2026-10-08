/** Decode only the bounded, authorized RPC snapshot; never accept client-supplied rows. */
import { z } from "zod";
import { ADR002_PROTOCOL } from "../shared/domain/taxonomy";
import { InternalApprovalError, type ReviewResult } from "../shared/internal-estimate-approval-engine";
import { buildInternalApprovalReviewFromRows, type InternalApprovalReviewRows } from "./internal-estimate-approval-adapter";
import { InternalApprovalPersistenceError } from "./internal-estimate-approval-errors";
import { nonzeroUuid as uuid, reviewCommandSchema, validateInternalApprovalRecordEvidence } from "./internal-estimate-approval-db";
import { assertPlainData } from "./project-geocode-review-evidence";

const text = z.string(), nullableText = text.nullable(), nullableUuid = uuid.nullable();
const integer = z.number().int().safe();
const timestamp = text.refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value).transform(value => new Date(value));
const nullableTimestamp = timestamp.nullable();
const json = z.unknown().refine(value => value !== undefined);
const identitySchema = z.object({actorId: uuid, tenantId: uuid}).strict();
const rowsSchema = z.object({
  draft: z.object({
    id: uuid, tenantId: uuid, projectId: uuid, clientId: uuid, version: integer.positive(),
    createdAt: timestamp, pricingSchemaVersion: nullableText, source: nullableText,
    estimateId: nullableUuid, intakeFormId: nullableUuid, bundleId: nullableUuid,
    supersedesId: nullableUuid, changeOrderOf: nullableUuid, bundleName: nullableText, notes: nullableText,
    subtotalPrice: nullableText, discountApplied: z.boolean().nullable(), discountAmount: nullableText,
    finalTotalPrice: nullableText, subtotalCost: nullableText, lineItems: json, assemblySelections: json,
    pricingSnapshot: json, draftData: json, commercialChannel: nullableText, channel: nullableText,
    zone: nullableText, finishLevel: nullableText, region: nullableText, trade: nullableText,
    coastalModifier: nullableText, scopeDraftId: nullableUuid, assemblyCount: integer.nullable(),
    status: text, supersededBy: nullableUuid, approvedAt: nullableTimestamp,
    approvedBy: nullableUuid, lockedAt: nullableTimestamp,
  }).strict(),
  project: z.object({
    id: uuid, tenantId: uuid, clientId: uuid, deletedAt: nullableTimestamp,
    commercialChannel: nullableText, channel: nullableText, geoRiskClass: nullableText,
    address: nullableText, city: nullableText, state: nullableText, zip: nullableText, county: nullableText,
    latitude: nullableText, longitude: nullableText, geocodedAt: nullableTimestamp,
    geocodeConfidence: nullableText, geocodeSource: nullableText, geocodedAddress: nullableText,
    zone: nullableText, zoneModifierSnapshot: json,
  }).strict(),
  client: z.object({id: uuid, tenantId: uuid, isActive: z.boolean(), deletedAt: nullableTimestamp}).strict(),
  tenant: z.object({id: uuid, isActive: z.boolean()}).strict(),
  profile: z.object({id: uuid, tenantId: uuid, isActive: z.boolean()}).strict(),
  zone: z.object({
    id: uuid, tenantId: uuid, isActive: z.boolean(), zoneName: nullableText, name: text,
    coastalExposureLevel: nullableText, costMultiplier: text, laborModifier: nullableText,
    materialModifier: nullableText, logisticsModifier: nullableText, contingencyPct: nullableText,
    minProfitShieldPct: nullableText,
  }).strict().nullable(),
  settings: z.object({id: uuid, tenantId: uuid, updatedAt: timestamp,
    profitShieldOverrides: json, geoFloorOverrides: json}).strict().nullable(),
  scopeDraft: z.object({id: uuid, projectId: uuid, tenantId: uuid}).strict().nullable(),
}).strict();
const recordIdentity = {
  id: uuid, tenantId: uuid, projectId: uuid, clientId: uuid, estimateDraftId: uuid,
  createdAt: timestamp, updatedAt: timestamp, deletedAt: nullableTimestamp,
};
const snapshotSchema = z.object({...recordIdentity,
  draftVersion: integer.positive(), contractVersion: text, contentHash: text, currencyCode: text,
  currencyBasis: text, subtotalPriceMinor: text, discountMinor: text, finalPriceMinor: text,
  estimatedCostMinor: text, policyVersion: text, policyHash: text, snapshotPayload: json,
  policyEvaluation: json, capturedBy: uuid,
}).strict();
const approvalSchema = z.object({...recordIdentity,
  snapshotId: uuid, requestId: uuid, requestHash: text, approvedBy: uuid, approvedAt: timestamp,
  reason: text, contractVersion: text,
}).strict();
const revocationSchema = z.object({...recordIdentity,
  approvalId: uuid, requestId: uuid, requestHash: text, revokedBy: uuid, revokedAt: timestamp,
  reason: text, contractVersion: text,
}).strict();
const approvalEvidenceSchema = z.object({
    snapshots: z.array(snapshotSchema).max(1), approvals: z.array(approvalSchema).max(1),
    revocations: z.array(revocationSchema).max(1),
    authors: z.array(z.object({id: uuid, tenantId: uuid}).strict()).max(3),
    sourceMatches: z.boolean().nullable(),
  }).strict();
const envelopeSchema = z.object({
  version: z.literal(ADR002_PROTOCOL.review), context: identitySchema, rows: rowsSchema,
  approvalEvidence: approvalEvidenceSchema,
}).strict();
function integrity(): never { throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR"); }

export async function buildAuthenticatedInternalApprovalReview(
  raw: unknown, command: unknown, expectedIdentity: unknown,
): Promise<ReviewResult> {
  try { assertPlainData(command); } catch { throw new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID"); }
  const input = reviewCommandSchema.safeParse(command);
  if (!input.success) throw new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID");
  try { assertPlainData(raw); assertPlainData(expectedIdentity); } catch { integrity(); }
  const expected = identitySchema.safeParse(expectedIdentity), parsed = envelopeSchema.safeParse(raw);
  if (!expected.success || !parsed.success) integrity();
  const {context, rows, approvalEvidence: evidence} = parsed.data;
  if (context.actorId !== expected.data.actorId || context.tenantId !== expected.data.tenantId
    || rows.draft.id !== input.data.id || rows.profile.id !== context.actorId
    || rows.tenant.id !== context.tenantId || !rows.tenant.isActive || !rows.profile.isActive
    || [rows.draft, rows.project, rows.client, rows.profile, rows.zone, rows.settings, rows.scopeDraft]
      .some(row => row !== null && row.tenantId !== context.tenantId)
    || rows.draft.projectId !== rows.project.id || rows.draft.clientId !== rows.client.id
    || rows.project.clientId !== rows.client.id) integrity();
  if (evidence.snapshots.length === 0 && evidence.approvals.length === 0 && evidence.revocations.length === 0
    && (evidence.sourceMatches !== null || evidence.authors.length !== 0)) integrity();
  let state;
  try {
    state = await validateInternalApprovalRecordEvidence({...context, ...rows}, {
      snapshotRows: evidence.snapshots, approvalRows: evidence.approvals, revokeRows: evidence.revocations,
    }, {
      // The RPC validates lineage before returning any business data. It is not reconstructed
      // from a caller-provided claim or from another HTTP request.
      validateLineage: async () => {},
      sourceMatches: async () => evidence.sourceMatches === true,
      loadAuthors: async ids => {
        if (evidence.authors.length !== ids.length || new Set(evidence.authors.map(a => a.id)).size !== ids.length
          || evidence.authors.some(a => !ids.includes(a.id))) integrity();
        return evidence.authors;
      },
    });
  } catch (error) {
    if (error instanceof InternalApprovalError && error.code === "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE") throw error;
    integrity();
  }
  const d = rows.draft;
  if (state.state !== "none" || d.status !== "draft" || d.supersededBy !== null
    || d.approvedAt !== null || d.approvedBy !== null || d.lockedAt !== null)
    throw new InternalApprovalPersistenceError("INTERNAL_APPROVAL_ALREADY_DECIDED");
  // Financial math and policy checks remain the existing pure implementation.
  return buildInternalApprovalReviewFromRows(rows satisfies InternalApprovalReviewRows, {
    ...context, confirmedCurrencyCode: input.data.confirmedCurrencyCode,
  });
}

// Shared wire grammar; record reads apply their own capability-specific invariants.
export { timestamp as authenticatedTimestampSchema, identitySchema as authenticatedIdentitySchema,
  rowsSchema as authenticatedReviewRowsSchema, approvalEvidenceSchema };
