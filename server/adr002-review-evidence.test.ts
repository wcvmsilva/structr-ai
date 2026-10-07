import { describe, expect, it } from "vitest";
import { INTERNAL_APPROVAL_PROTOCOL as P } from "../shared/domain/taxonomy";
import { hashInternalApprovalCommand } from "../shared/internal-estimate-approval-engine";
import { buildAuthenticatedInternalApprovalReview } from "./authenticated-internal-approval-review";
import { buildInternalApprovalReviewFromRows } from "./internal-estimate-approval-adapter";
import { approvalContext, approvalRows } from "./internal-estimate-approval-adapter.fixtures";
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

async function recorded(state: "active" | "revoked" = "active") {
  const wire = authenticatedReviewEnvelope();
  const review = await buildInternalApprovalReviewFromRows(approvalRows(), approvalContext);
  const identity = { tenantId: ids.tenant, projectId: ids.project, clientId: ids.client, estimateDraftId: ids.draft,
    createdAt: approvedAt, updatedAt: approvedAt, deletedAt: null };
  const context = { actorId: ids.actor, tenantId: ids.tenant, projectId: ids.project, clientId: ids.client };
  const command = { id: ids.draft, requestId: ids.request, expectedDraftVersion: 1,
    expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
    confirmedCurrencyCode: P.currency, reason: "Synthetic internal approval" };
  const f = review.snapshot.financials;
  const snapshot = { ...identity, id: snapshotId, draftVersion: 1, contractVersion: P.snapshot,
    contentHash: review.contentHash, currencyCode: P.currency, currencyBasis: P.currencyBasis,
    subtotalPriceMinor: f.subtotalPriceMinor, discountMinor: f.discountMinor, finalPriceMinor: f.finalPriceMinor,
    estimatedCostMinor: f.estimatedCostMinor, policyVersion: P.evaluator, policyHash: review.policyHash,
    snapshotPayload: review.snapshot, policyEvaluation: review.evaluation, capturedBy: ids.actor };
  const approval = { ...identity, id: ids.approval, snapshotId, requestId: command.requestId,
    requestHash: await hashInternalApprovalCommand({ operation: "approve", context, command }),
    approvedBy: ids.actor, approvedAt, reason: command.reason, contractVersion: P.decision };
  wire.rows.draft.status = state === "active" ? "internally_approved" : "internal_approval_revoked";
  wire.rows.draft.approvedBy = ids.actor; wire.rows.draft.approvedAt = approvedAt; wire.rows.draft.lockedAt = approvedAt;
  wire.approvalEvidence = { snapshots: [snapshot], approvals: [approval], revocations: [],
    authors: [{ id: ids.actor, tenantId: ids.tenant }], sourceMatches: true };
  if (state === "revoked") {
    const revokeCommand = { id: ids.draft, approvalId: ids.approval, requestId: revokeRequestId,
      expectedContentHash: review.contentHash, reason: "Synthetic internal revocation" };
    wire.approvalEvidence.revocations = [{ ...identity, id: revocationId, createdAt: revokedAt, updatedAt: revokedAt,
      approvalId: ids.approval, requestId: revokeRequestId,
      requestHash: await hashInternalApprovalCommand({ operation: "revoke", context: { ...context, actorId: revokerId }, command: revokeCommand }),
      revokedBy: revokerId, revokedAt, reason: revokeCommand.reason, contractVersion: P.revocation }];
    wire.approvalEvidence.authors.push({ id: revokerId, tenantId: ids.tenant });
  }
  return wire;
}

async function result(wire: unknown) {
  try { return { ok: true, value: await buildAuthenticatedInternalApprovalReview(wire,
    { id: ids.draft, confirmedCurrencyCode: P.currency }, { actorId: ids.actor, tenantId: ids.tenant }) }; }
  catch (error) { return { ok: false, code: (error as {code?: string}).code }; }
}
const decided = { ok: false, code: "INTERNAL_APPROVAL_ALREADY_DECIDED" };
const corrupt = { ok: false, code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" };

describe("ADR-002 recorded A1 evidence through the wire decoder", () => {
  it.each(["active", "revoked"] as const)("recognizes a cryptographically valid %s record before refusing another review", async state => {
    const wire = await recorded(state), before = JSON.stringify(wire);
    expect(await result(wire)).toEqual(decided);
    expect(JSON.stringify(wire)).toBe(before);
  });
  it("uses the frozen approved policy when current geo evidence has changed", async () => {
    const wire = await recorded(); wire.rows.project.geocodeConfidence = "low"; wire.rows.project.zoneModifierSnapshot = null; wire.rows.zone = null;
    expect(await result(wire)).toEqual(decided);
  });
  it("accepts the same historical author once when capture and decision belong to that author", async () => {
    const wire = await recorded(); expect(wire.approvalEvidence.authors).toHaveLength(1);
    expect(await result(wire)).toEqual(decided);
  });
  it("accepts two distinct valid authors without relying on SQL row order", async () => {
    const wire = await recorded("revoked"); wire.approvalEvidence.authors.reverse();
    expect(await result(wire)).toEqual(decided);
  });

  const activeCorruptions: [string, (wire: any) => void][] = [
    ["content digest", w => { w.approvalEvidence.snapshots[0].contentHash = "0".repeat(64); }],
    ["policy digest", w => { w.approvalEvidence.snapshots[0].policyHash = "0".repeat(64); }],
    ["snapshot financial payload", w => { w.approvalEvidence.snapshots[0].snapshotPayload.financials.finalPriceMinor = "9999"; }],
    ["frozen evaluation", w => { w.approvalEvidence.snapshots[0].policyEvaluation.passed = false; }],
    ["approval request digest", w => { w.approvalEvidence.approvals[0].requestHash = "0".repeat(64); }],
    ["approval request nonce", w => { w.approvalEvidence.approvals[0].requestId = otherId; }],
    ["approval reason with unchanged digest", w => { w.approvalEvidence.approvals[0].reason = "Altered approval reason"; }],
    ["unbound snapshot", w => { w.approvalEvidence.approvals[0].snapshotId = otherId; }],
    ["snapshot minor-unit projection", w => { w.approvalEvidence.snapshots[0].estimatedCostMinor = "3999"; }],
    ["snapshot version projection", w => { w.approvalEvidence.snapshots[0].draftVersion = 2; }],
    ["source mismatch", w => { w.approvalEvidence.sourceMatches = false; }],
    ["missing source verdict", w => { w.approvalEvidence.sourceMatches = null; }],
    ["cross-tenant snapshot", w => { w.approvalEvidence.snapshots[0].tenantId = otherId; }],
    ["cross-project approval", w => { w.approvalEvidence.approvals[0].projectId = otherId; }],
    ["mutated immutable record", w => { w.approvalEvidence.snapshots[0].updatedAt = revokedAt; }],
    ["soft-deleted approval", w => { w.approvalEvidence.approvals[0].deletedAt = revokedAt; }],
    ["missing author", w => { w.approvalEvidence.authors = []; }],
    ["duplicate author", w => { w.approvalEvidence.authors.push({ ...w.approvalEvidence.authors[0] }); }],
    ["substituted author", w => { w.approvalEvidence.authors[0].id = otherId; }],
    ["author from another tenant", w => { w.approvalEvidence.authors[0].tenantId = otherId; }],
    ["extra author", w => { w.approvalEvidence.authors.push({ id: otherId, tenantId: ids.tenant }); }],
    ["different capture actor", w => { w.approvalEvidence.snapshots[0].capturedBy = otherId; }],
    ["inconsistent active status", w => { w.rows.draft.status = "draft"; }],
    ["current financial mismatch", w => { w.rows.draft.subtotalCost = "41.00"; }],
    ["unexplained current approver", w => { w.rows.draft.approvedBy = otherId; }],
    ["mismatched lock instant", w => { w.rows.draft.lockedAt = revokedAt; }],
    ["duplicate approval", w => { w.approvalEvidence.approvals.push({ ...w.approvalEvidence.approvals[0] }); }],
    ["orphan snapshot", w => { w.approvalEvidence.approvals = []; }],
  ];
  it.each(activeCorruptions)("reports integrity failure for %s, rather than an ordinary decided draft", async (_name, mutate) => {
    const wire = await recorded(); mutate(wire); expect(await result(wire)).toEqual(corrupt);
  });

  it.each([
    ["request digest", (w: any) => { w.approvalEvidence.revocations[0].requestHash = "0".repeat(64); }],
    ["author", (w: any) => { w.approvalEvidence.revocations[0].revokedBy = otherId; }],
    ["reason", (w: any) => { w.approvalEvidence.revocations[0].reason = "Altered revocation"; }],
    ["approval link", (w: any) => { w.approvalEvidence.revocations[0].approvalId = otherId; }],
    ["timestamp before approval", (w: any) => { const earlier = "2026-09-01T00:00:00.000Z"; Object.assign(w.approvalEvidence.revocations[0], { revokedAt: earlier, createdAt: earlier, updatedAt: earlier }); }],
    ["current status", (w: any) => { w.rows.draft.status = "internally_approved"; }],
    ["missing author row", (w: any) => { w.approvalEvidence.authors.pop(); }],
    ["wrong contract", (w: any) => { w.approvalEvidence.revocations[0].contractVersion = P.decision; }],
  ] as const)("rejects a corrupted revocation %s", async (_name, mutate) => {
    const wire = await recorded("revoked"); mutate(wire); expect(await result(wire)).toEqual(corrupt);
  });
});
