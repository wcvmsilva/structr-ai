/** MICHAEL-A1-DECISION-CYCLE-V2-QA-AND-CORRECTION.md items 2/3: freezeIntent
 * is the exact piece Michael's probes reproduced as broken (same requestId
 * reused across a different payload; a fresh review silently inheriting the
 * old reason). Pure unit coverage of the algorithm itself, independent of
 * React/TanStack — EstimateDetail.tsx is the integration, this is the unit.
 */
import { describe, expect, it } from "vitest";
import { freezeIntent, type DecisionIntentRef } from "../client/src/lib/decision-intent";

function sequentialIds() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("freezeIntent", () => {
  it("generates a fresh id on the very first call", () => {
    const ref: DecisionIntentRef<string> = { current: null };
    const id = freezeIntent(ref, "fp-1", "reason A", (a, b) => a === b, sequentialIds());
    expect(id).toBe("id-1");
    expect(ref.current).toEqual({ requestId: "id-1", reason: "reason A", fingerprint: "fp-1" });
  });

  it("reuses the same id on an identical resubmit — a true transport-error retry", () => {
    const ref: DecisionIntentRef<string> = { current: null };
    const generate = sequentialIds();
    const first = freezeIntent(ref, "fp-1", "reason A", (a, b) => a === b, generate);
    const second = freezeIntent(ref, "fp-1", "reason A", (a, b) => a === b, generate);
    expect(second).toBe(first);
  });

  it("generates a NEW id when the reason changes, even with the same fingerprint", () => {
    const ref: DecisionIntentRef<string> = { current: null };
    const generate = sequentialIds();
    const first = freezeIntent(ref, "fp-1", "reason A", (a, b) => a === b, generate);
    const second = freezeIntent(ref, "fp-1", "reason B (edited)", (a, b) => a === b, generate);
    expect(second).not.toBe(first);
  });

  it("generates a NEW id when the fingerprint changes, even with the same reason", () => {
    const ref: DecisionIntentRef<string> = { current: null };
    const generate = sequentialIds();
    const first = freezeIntent(ref, "fp-1", "reason A", (a, b) => a === b, generate);
    const second = freezeIntent(ref, "fp-2", "reason A", (a, b) => a === b, generate);
    expect(second).not.toBe(first);
  });

  it("a revoke-style compound fingerprint (approvalId:contentHash) distinguishes two decisions with the same hash", () => {
    // MICHAEL item 4: a fingerprint of contentHash alone cannot tell apart
    // two different approvals that happen to hash the same content.
    const ref: DecisionIntentRef<string> = { current: null };
    const generate = sequentialIds();
    const first = freezeIntent(ref, "approval-A:deadbeef", "revoke reason", (a, b) => a === b, generate);
    const second = freezeIntent(ref, "approval-B:deadbeef", "revoke reason", (a, b) => a === b, generate);
    expect(second).not.toBe(first);
  });

  it("three-call sequence: retry reuses, edit-then-retry gets a new id and then reuses that one", () => {
    const ref: DecisionIntentRef<string> = { current: null };
    const generate = sequentialIds();
    const a = freezeIntent(ref, "fp-1", "reason A", (a, b) => a === b, generate);
    const aRetry = freezeIntent(ref, "fp-1", "reason A", (a, b) => a === b, generate); // transport error, user just clicks again
    expect(aRetry).toBe(a);
    const b = freezeIntent(ref, "fp-1", "reason B", (a, b) => a === b, generate); // user edited the reason
    expect(b).not.toBe(a);
    const bRetry = freezeIntent(ref, "fp-1", "reason B", (a, b) => a === b, generate); // retries the edited one
    expect(bRetry).toBe(b);
  });
});
