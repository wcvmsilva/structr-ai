/**
 * A1-VERSION-PREVIEW-IMPLEMENTATION-CONTRACT.md — router-level tests for the new
 * query `estimate.getEstimateVersionPreview`.
 *
 * Scope deliberately excludes what `estimate-version-v2-db.test.ts` already covers
 * (via its own in-memory `getDb()`/`requireProjectAccess`/adapter mocks: write
 * authorization, locks, lineage, recorded-evidence branches, legacy-status refusal,
 * stale/undecided-mismatch handling, scope revalidation, H1 linkage). This file
 * proves what is genuinely NEW at the router boundary: tenantProcedure resolves
 * auth/tenant BEFORE the helper runs; the input shape is the real exported
 * discriminated-union schema, strict (no forged/extra keys, no id-only alternative,
 * no actor/tenant/requestId in the payload); the trusted ctx.user.id/ctx.tenantId —
 * never anything from the payload — are what reach the helper; the router returns
 * the helper's result unchanged; and errors from the real helper/engine/access layers
 * map to safe, version-preview-appropriate tRPC codes WITHOUT the approval-review
 * mapper's "approval review"-flavored fallback message (deliberately a separate
 * mapper from `mapInternalApprovalReadError`, per the contract decision).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("./estimate-version-v2-db", async original => ({
  ...(await original<typeof import("./estimate-version-v2-db")>()),
  getEstimateVersionPreviewV2: io.preview,
}));
import { estimateRouter } from "./estimate-router";
import { ProjectAccessError } from "./project-access";
import { HistoricalEstimateError } from "@shared/historical-estimate-engine";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import { InternalApprovalPersistenceError, InternalApprovalAuditFailure } from "./internal-estimate-approval-errors";

const T = "a2000000-0000-4000-8000-000000000001";
const U = "a2000000-0000-4000-8000-000000000002";
const D = "a2000000-0000-4000-8000-000000000003";
const OTHER_T = "a2000000-0000-4000-8000-00000000000f";

function context(): TrpcContext {
  return {
    req: {} as any,
    res: {} as any,
    authProvider: "legacy",
    tenantId: T,
    user: { id: U, tenantId: T, role: "user", isActive: true } as any,
  };
}

const currentDraftInput = { version: "estimate-version-preview-command-v2", sourceKind: "current_draft", sourceDraftId: D, confirmedCurrencyCode: "USD" };
const recordedInput = { version: "estimate-version-preview-command-v2", sourceKind: "recorded_a1", sourceDraftId: D, confirmedCurrencyCode: null };
const PREVIEW_RESULT = { version: "estimate-version-preview-v2", sourceKind: "current_draft", sourceDraftId: D, sourceVersion: 1, sourceContentHash: "a".repeat(64), sourceApprovalId: null, sourceApprovalState: null, confirmedCurrencyCode: "USD", content: { id: "synthetic" } };

beforeEach(() => {
  io.preview.mockReset();
  io.preview.mockResolvedValue(PREVIEW_RESULT);
});

describe("estimate.getEstimateVersionPreview", () => {
  const invoke = (ctx = context(), input: any = currentDraftInput) =>
    estimateRouter.createCaller(ctx).getEstimateVersionPreview(input);

  it("delegates to the real preview helper with the trusted actor/tenant for the current_draft branch, returning its result unchanged", async () => {
    await expect(invoke()).resolves.toEqual(PREVIEW_RESULT);
    expect(io.preview).toHaveBeenCalledWith(currentDraftInput, U, T);
  });

  it("delegates to the real preview helper with the trusted actor/tenant for the recorded_a1 branch", async () => {
    await invoke(context(), recordedInput);
    expect(io.preview).toHaveBeenCalledWith(recordedInput, U, T);
  });

  it("requires authentication before the helper runs", async () => {
    const ctx = context();
    ctx.user = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it("requires a resolved tenant before the helper runs", async () => {
    const ctx = context();
    ctx.tenantId = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it("refuses a forged tenantId/actorId/requestId outright — the strict shape has no room for them, so only ctx can ever reach the helper", async () => {
    await expect(invoke(context(), { ...currentDraftInput, tenantId: OTHER_T, userId: OTHER_T, requestId: D })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it.each([
    { ...currentDraftInput, extra: "forged" },
    { ...currentDraftInput, id: D }, // the id-only alternative shape is refused, not accepted as a synonym
  ])("rejects an extraneous key before the helper runs: %j", async input => {
    await expect(invoke(context(), input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it("rejects the wrong command version literal", async () => {
    await expect(invoke(context(), { ...currentDraftInput, version: "estimate-version-command-v2" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-uuid",
    "A2000000-0000-4000-8000-000000000003", // uppercase — Core grammar is lowercase-only
    "00000000-0000-0000-0000-000000000000", // all-zero sentinel refused
    `${D}-extra`,
  ])("rejects an invalid sourceDraftId before the helper runs: %s", async sourceDraftId => {
    await expect(invoke(context(), { ...currentDraftInput, sourceDraftId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it.each([
    { ...currentDraftInput, confirmedCurrencyCode: null }, // current_draft requires the literal 'USD'
    { ...currentDraftInput, confirmedCurrencyCode: "usd" },
    { ...recordedInput, confirmedCurrencyCode: "USD" }, // recorded_a1 requires null, not a currency confirmation
    { version: currentDraftInput.version, sourceKind: "legacy_bundle", sourceDraftId: D, confirmedCurrencyCode: "USD" },
  ])("rejects a currency/sourceKind combination outside the exact discriminated union: %j", async input => {
    await expect(invoke(context(), input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it("rejects a missing sourceDraftId or sourceKind", async () => {
    await expect(invoke(context(), { version: currentDraftInput.version, confirmedCurrencyCode: "USD" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(invoke(context(), { version: currentDraftInput.version, sourceDraftId: D } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.preview).not.toHaveBeenCalled();
  });

  it("returns the recorded_a1 branch's approval id/state exactly as the helper produced them, without reshaping", async () => {
    const revoked = { ...PREVIEW_RESULT, sourceKind: "recorded_a1", sourceApprovalId: D, sourceApprovalState: "revoked", confirmedCurrencyCode: null };
    io.preview.mockResolvedValue(revoked);
    await expect(invoke(context(), recordedInput)).resolves.toEqual(revoked);
  });

  it("preserves a typed NOT_FOUND from the transactional lock without leaking data", async () => {
    io.preview.mockRejectedValue(new InternalApprovalPersistenceError("NOT_FOUND"));
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND", message: "This estimate is not available to your account." });
  });

  it("preserves a typed FORBIDDEN from the transactional lock without leaking data", async () => {
    io.preview.mockRejectedValue(new InternalApprovalPersistenceError("FORBIDDEN"));
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "This estimate is not available to your account." });
  });

  it("maps invalid engine input to BAD_REQUEST", async () => {
    io.preview.mockRejectedValue(new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID"));
    await expect(invoke()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each(["INTERNAL_APPROVAL_CONTENT_UNRESOLVED", "POLICY_CONTEXT_UNRESOLVED"] as const)(
    "maps unresolved content/policy context (%s) to PRECONDITION_FAILED",
    async code => {
      io.preview.mockRejectedValue(new InternalApprovalError(code));
      await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    },
  );

  it("maps a stale preview (sourceKind/draft mismatch with current decision state) to a conflict, worded about version state", async () => {
    io.preview.mockRejectedValue(new InternalApprovalError("INTERNAL_APPROVAL_REVIEW_STALE"));
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT", message: "This estimate's version state changed. Refresh and try again." });
  });

  it.each(["INTERNAL_APPROVAL_INTEGRITY_ERROR", "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE"] as const)(
    "maps an integrity/crypto failure (%s) to a safe internal error, worded about version preview and not leaking its own message",
    async code => {
      io.preview.mockRejectedValue(new InternalApprovalError(code));
      await expect(invoke()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "This estimate's version preview could not be completed. Please try again.",
      });
    },
  );

  it("never exposes an audit backend failure or its cause, even though this read never audits itself", async () => {
    io.preview.mockRejectedValue(new InternalApprovalAuditFailure(new Error("synthetic-private-database-detail")));
    const result = invoke();
    await expect(result).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await result.catch(err => {
      expect(JSON.stringify(err)).not.toContain("synthetic-private-database-detail");
    });
  });

  it("preserves a changed transactional access denial from requireProjectAccess", async () => {
    io.preview.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Access changed since preview"));
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access changed since preview" });
  });

  it("maps the H1 historical guard through the same mapper used elsewhere, not a bespoke message", async () => {
    io.preview.mockRejectedValue(new HistoricalEstimateError("HISTORICAL_SOURCE_IMMUTABLE", "Historical capture is immutable"));
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("does NOT reuse mapInternalApprovalReadError's approval-review-flavored fallback message for an unmapped internal failure", async () => {
    io.preview.mockRejectedValue(new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR"));
    await expect(invoke()).rejects.not.toMatchObject({ message: "This estimate's approval review could not be completed. Please try again." });
  });
});
