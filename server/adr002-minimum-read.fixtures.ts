import { INTERNAL_APPROVAL_PROTOCOL as P } from "../shared/domain/taxonomy";
import { hashInternalApprovalCommand } from "../shared/internal-estimate-approval-engine";
import { buildInternalApprovalReviewFromRows } from "./internal-estimate-approval-adapter";
import {
  approvalContext,
  approvalRows,
} from "./internal-estimate-approval-adapter.fixtures";
import { approvalIds as ids } from "./internal-estimate-approval-engine.fixtures";
import { authenticatedReviewEnvelope } from "./adr002-review.fixtures";
// These are synthetic persisted records built with the real pure financial engine
// and SHA-256 implementation. No DB, RPC, hash or validator is mocked here.
const snapshotId = "a1000000-0000-4000-8000-000000000101";
const revocationId = "a1000000-0000-4000-8000-000000000102";
const revokeRequestId = "a1000000-0000-4000-8000-000000000103";
const revokerId = "a1000000-0000-4000-8000-000000000104";
const otherId = "a1000000-0000-4000-8000-000000000105";
const approvedAt = "2026-09-02T12:00:00.123Z";
const revokedAt = "2026-09-03T12:00:00.456Z";

export async function recordedApprovalEnvelope(
  state: "active" | "revoked" = "active"
) {
  const wire = authenticatedReviewEnvelope();
  const review = await buildInternalApprovalReviewFromRows(
    approvalRows(),
    approvalContext
  );
  const identity = {
    tenantId: ids.tenant,
    projectId: ids.project,
    clientId: ids.client,
    estimateDraftId: ids.draft,
    createdAt: approvedAt,
    updatedAt: approvedAt,
    deletedAt: null,
  };
  const context = {
    actorId: ids.actor,
    tenantId: ids.tenant,
    projectId: ids.project,
    clientId: ids.client,
  };
  const command = {
    id: ids.draft,
    requestId: ids.request,
    expectedDraftVersion: 1,
    expectedContentHash: review.contentHash,
    expectedPolicyHash: review.policyHash,
    confirmedCurrencyCode: P.currency,
    reason: "Synthetic internal approval",
  };
  const f = review.snapshot.financials;
  const snapshot = {
    ...identity,
    id: snapshotId,
    draftVersion: 1,
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
    capturedBy: ids.actor,
  };
  const approval = {
    ...identity,
    id: ids.approval,
    snapshotId,
    requestId: command.requestId,
    requestHash: await hashInternalApprovalCommand({
      operation: "approve",
      context,
      command,
    }),
    approvedBy: ids.actor,
    approvedAt,
    reason: command.reason,
    contractVersion: P.decision,
  };
  wire.rows.draft.status =
    state === "active" ? "internally_approved" : "internal_approval_revoked";
  wire.rows.draft.approvedBy = ids.actor;
  wire.rows.draft.approvedAt = approvedAt;
  wire.rows.draft.lockedAt = approvedAt;
  wire.approvalEvidence = {
    snapshots: [snapshot],
    approvals: [approval],
    revocations: [],
    authors: [{ id: ids.actor, tenantId: ids.tenant }],
    sourceMatches: true,
  };
  if (state === "revoked") {
    const revokeCommand = {
      id: ids.draft,
      approvalId: ids.approval,
      requestId: revokeRequestId,
      expectedContentHash: review.contentHash,
      reason: "Synthetic internal revocation",
    };
    wire.approvalEvidence.revocations = [
      {
        ...identity,
        id: revocationId,
        createdAt: revokedAt,
        updatedAt: revokedAt,
        approvalId: ids.approval,
        requestId: revokeRequestId,
        requestHash: await hashInternalApprovalCommand({
          operation: "revoke",
          context: { ...context, actorId: revokerId },
          command: revokeCommand,
        }),
        revokedBy: revokerId,
        revokedAt,
        reason: revokeCommand.reason,
        contractVersion: P.revocation,
      },
    ];
    wire.approvalEvidence.authors.push({ id: revokerId, tenantId: ids.tenant });
  }
  return wire;
}

export function estimateReadEnvelope(): any {
  return JSON.parse(
    JSON.stringify({
      version: "structr-authenticated-estimate-read-v1",
      context: { actorId: ids.actor, tenantId: ids.tenant },
      draft: approvalRows().draft,
      historicalImportId: null,
    })
  );
}
export function approvalRecordEnvelope(
  wire = authenticatedReviewEnvelope()
): any {
  const { draft, project, client, tenant, profile } = wire.rows;
  return {
    ...wire,
    version: "structr-authenticated-approval-record-v1",
    rows: { draft, project, client, tenant, profile },
  };
}
