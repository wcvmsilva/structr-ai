import { describe, expect, it } from "vitest";
import { approvalRows, approvalContext } from "./internal-estimate-approval-adapter.fixtures";
import { buildAuthenticatedInternalApprovalReview } from "./authenticated-internal-approval-review";

import { authenticatedReviewEnvelope } from "./adr002-review.fixtures";
const command = () => ({ id: approvalRows().draft.id, confirmedCurrencyCode: "USD" as const });
const identity = () => ({ actorId: approvalContext.actorId, tenantId: approvalContext.tenantId });
async function outcome(raw: unknown, input: unknown = command(), expected: unknown = identity()) {
  try { return { ok: true, review: await buildAuthenticatedInternalApprovalReview(raw, input, expected) }; }
  catch (error) { return { ok: false, code: (error as {code?: string}).code }; }
}
describe("ADR-002 authenticated review envelope", () => {
  it("builds the existing financial review from the authorized wire snapshot", async () => {
    const result = await outcome(authenticatedReviewEnvelope());
    expect(result).toMatchObject({ ok: true, review: { snapshot: {
      identity: { tenantId: approvalContext.tenantId, projectId: approvalRows().project.id, estimateDraftId: command().id },
      financials: { subtotalPriceMinor: "10000", finalPriceMinor: "10000", estimatedCostMinor: "4000" },
    } } });
  });
  it("preserves the wire object while decoding typed timestamps", async () => {
    const raw = authenticatedReviewEnvelope(), before = JSON.stringify(raw);
    expect(await outcome(raw)).toMatchObject({ok: true});
    expect(JSON.stringify(raw)).toBe(before);
    expect(typeof raw.rows.draft.createdAt).toBe("string");
  });
  for (const [name, mutate] of [
    ["unknown protocol", (r: any) => { r.version = "unknown"; }],
    ["extra authority argument", (r: any) => { r.actorId = approvalContext.actorId; }],
    ["unrequested draft", (r: any) => { r.rows.draft.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }],
    ["different authenticated actor", (r: any) => { r.context.actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }],
    ["different authenticated tenant", (r: any) => { r.context.tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }],
    ["missing context", (r: any) => { delete r.context; }],
    ["missing source evidence", (r: any) => { delete r.approvalEvidence; }],
    ["unrequested project data", (r: any) => { r.rows.project.secret = "unexpected"; }],
    ["money converted to JSON number", (r: any) => { r.rows.draft.finalTotalPrice = 100; }],
    ["date converted to JSON number", (r: any) => { r.rows.draft.createdAt = 0; }],
    ["invalid typed timestamp", (r: any) => { r.rows.draft.createdAt = "2026-99-99T00:00:00.000Z"; }],
    ["absent nullable field", (r: any) => { delete r.rows.draft.bundleId; }],
    ["partial approval record", (r: any) => { r.approvalEvidence.approvals = [{}]; }],
    ["unexplained approved status", (r: any) => { r.rows.draft.status = "internally_approved"; }],
    ["unexplained revoked status", (r: any) => { r.rows.draft.status = "internal_approval_revoked"; }],
  ] as const) {
    it(`refuses ${name} before returning a review`, async () => {
      const raw = authenticatedReviewEnvelope(); mutate(raw);
      expect(await outcome(raw)).toEqual({ok: false, code: "INTERNAL_APPROVAL_INTEGRITY_ERROR"});
    });
  }
  it("rejects actor/tenant injected into the command", async () => {
    expect(await outcome(authenticatedReviewEnvelope(), {...command(), tenantId: approvalContext.tenantId}))
      .toEqual({ok:false, code:"INTERNAL_APPROVAL_INPUT_INVALID"});
  });
  it("retains policy evidence failure instead of synthesizing a geocode", async () => {
    const raw = authenticatedReviewEnvelope(); raw.rows.project.zoneModifierSnapshot.reviewEvidence.geocode.success = false;
    expect(await outcome(raw)).toEqual({ok:false, code:"POLICY_CONTEXT_UNRESOLVED"});
  });
  it("refuses an already locked draft even without recorded approval", async () => {
    const raw = authenticatedReviewEnvelope(); raw.rows.draft.lockedAt = "2026-09-01T12:00:00.000Z";
    expect(await outcome(raw)).toEqual({ok:false, code:"INTERNAL_APPROVAL_ALREADY_DECIDED"});
  });
});
