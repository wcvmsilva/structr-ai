/**
 * A1-READ-QUERIES-IMPLEMENTATION-CONTRACT.md — router-level tests for the two new
 * queries `estimate.getInternalApprovalReview` and `estimate.getInternalApproval`.
 *
 * Scope deliberately excludes what `internal-estimate-approval-db.test.ts` already
 * covers physically (isolation, locks, exact money/hash fields, replay). This file
 * proves what is genuinely NEW at the router boundary: tenantProcedure resolves
 * auth/tenant BEFORE either helper runs; the input shape is strict (no forged/extra
 * keys, no loose UUID/currency grammar); the trusted ctx.user.id/ctx.tenantId — never
 * anything from the payload — are what reach the helper; the router calls the exact
 * helper the query name promises (review -> "approve" capability helper, read ->
 * "read" capability helper) and returns its result unchanged; and errors from the real
 * helper/engine/access layers map to safe, query-appropriate tRPC codes without a
 * mutation-flavored message and without leaking audit/database detail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({ review: vi.fn(), read: vi.fn() }));
vi.mock("./internal-estimate-approval-db", async original => ({
  ...(await original<typeof import("./internal-estimate-approval-db")>()),
  getInternalApprovalReview: io.review,
  getInternalApproval: io.read,
}));
import { estimateRouter } from "./estimate-router";
import { ProjectAccessError } from "./project-access";
import { HistoricalEstimateError } from "@shared/historical-estimate-engine";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import { InternalApprovalPersistenceError, InternalApprovalAuditFailure } from "./internal-estimate-approval-errors";

const T = "a1000000-0000-4000-8000-000000000001";
const U = "a1000000-0000-4000-8000-000000000002";
const D = "a1000000-0000-4000-8000-000000000003";
const OTHER_T = "a1000000-0000-4000-8000-00000000000f";

function context(): TrpcContext {
  return {
    req: {} as any,
    res: {} as any,
    authProvider: "legacy",
    tenantId: T,
    user: { id: U, tenantId: T, role: "user", isActive: true } as any,
  };
}

const REVIEW_RESULT = { snapshot: { id: D }, contentHash: "a".repeat(64), policyHash: "b".repeat(64), evaluation: { passed: true } };
const READ_RESULT = { state: "none" as const, approval: null, snapshot: null, revocation: null };

beforeEach(() => {
  io.review.mockReset();
  io.read.mockReset();
  io.review.mockResolvedValue(REVIEW_RESULT);
  io.read.mockResolvedValue(READ_RESULT);
});

describe("estimate.getInternalApprovalReview", () => {
  const invoke = (ctx = context(), input: any = { id: D, confirmedCurrencyCode: "USD" }) =>
    estimateRouter.createCaller(ctx).getInternalApprovalReview(input);

  it("delegates to the real review helper with the trusted actor/tenant, returning its result unchanged", async () => {
    await expect(invoke()).resolves.toEqual(REVIEW_RESULT);
    expect(io.review).toHaveBeenCalledWith({ id: D, confirmedCurrencyCode: "USD" }, U, T);
    expect(io.read).not.toHaveBeenCalled();
  });

  it("requires authentication before the helper runs", async () => {
    const ctx = context();
    ctx.user = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(io.review).not.toHaveBeenCalled();
  });

  it("requires a resolved tenant before the helper runs", async () => {
    const ctx = context();
    ctx.tenantId = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.review).not.toHaveBeenCalled();
  });

  it("refuses a forged tenantId/actorId outright — the strict shape has no room for them, so only ctx can ever reach the helper", async () => {
    await expect(invoke(context(), { id: D, confirmedCurrencyCode: "USD", tenantId: OTHER_T, userId: OTHER_T })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.review).not.toHaveBeenCalled();
  });

  it.each([
    { id: D, confirmedCurrencyCode: "USD", extra: "forged" },
    { id: D, confirmedCurrencyCode: "USD", approvalId: D },
  ])("rejects an extraneous key before the helper runs: %j", async input => {
    await expect(invoke(context(), input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.review).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-uuid",
    "A1000000-0000-4000-8000-000000000003", // uppercase — Core grammar is lowercase-only
    "00000000-0000-0000-0000-000000000000", // all-zero sentinel refused
    `${D}-extra`,
  ])("rejects an invalid id before the helper runs: %s", async id => {
    await expect(invoke(context(), { id, confirmedCurrencyCode: "USD" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.review).not.toHaveBeenCalled();
  });

  it.each(["usd", "EUR", "", null, undefined])("rejects anything other than the literal confirmed USD currency: %s", async currency => {
    await expect(invoke(context(), { id: D, confirmedCurrencyCode: currency })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.review).not.toHaveBeenCalled();
  });

  it("rejects a missing id or missing currency confirmation", async () => {
    await expect(invoke(context(), { confirmedCurrencyCode: "USD" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(invoke(context(), { id: D } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.review).not.toHaveBeenCalled();
  });

  it("preserves a typed NOT_FOUND from the transactional lock without leaking data", async () => {
    io.review.mockRejectedValue(new InternalApprovalPersistenceError("NOT_FOUND"));
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND", message: "This estimate is not available to your account." });
  });

  it("preserves a typed FORBIDDEN from the transactional lock without leaking data", async () => {
    io.review.mockRejectedValue(new InternalApprovalPersistenceError("FORBIDDEN"));
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "This estimate is not available to your account." });
  });

  it("maps an already-decided draft to a conflict, not a silent review", async () => {
    io.review.mockRejectedValue(new InternalApprovalPersistenceError("INTERNAL_APPROVAL_ALREADY_DECIDED"));
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps an exhausted transactional retry to a conflict", async () => {
    io.review.mockRejectedValue(new InternalApprovalPersistenceError("INTERNAL_APPROVAL_REQUEST_CONFLICT"));
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps invalid engine input to BAD_REQUEST", async () => {
    io.review.mockRejectedValue(new InternalApprovalError("INTERNAL_APPROVAL_INPUT_INVALID"));
    await expect(invoke()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each(["INTERNAL_APPROVAL_CONTENT_UNRESOLVED", "POLICY_CONTEXT_UNRESOLVED"] as const)(
    "maps unresolved content/policy context (%s) to PRECONDITION_FAILED",
    async code => {
      io.review.mockRejectedValue(new InternalApprovalError(code));
      await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    },
  );

  it("maps a stale review to a conflict", async () => {
    io.review.mockRejectedValue(new InternalApprovalError("INTERNAL_APPROVAL_REVIEW_STALE"));
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each(["INTERNAL_APPROVAL_INTEGRITY_ERROR", "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE"] as const)(
    "maps an integrity/crypto failure (%s) to a safe internal error, without its own message leaking", async code => {
      io.review.mockRejectedValue(new InternalApprovalError(code));
      await expect(invoke()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "This estimate's approval review could not be completed. Please try again.",
      });
    },
  );

  it("never exposes an audit backend failure or its cause", async () => {
    io.review.mockRejectedValue(new InternalApprovalAuditFailure(new Error("synthetic-private-database-detail")));
    const result = invoke();
    await expect(result).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await result.catch(err => {
      expect(JSON.stringify(err)).not.toContain("synthetic-private-database-detail");
    });
  });

  it("preserves a changed transactional access denial from requireProjectAccess", async () => {
    io.review.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Access changed since preview"));
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access changed since preview" });
  });

  it("maps the H1 historical guard through the same mapper used elsewhere, not a bespoke message", async () => {
    io.review.mockRejectedValue(new HistoricalEstimateError("HISTORICAL_SOURCE_IMMUTABLE", "Historical capture is immutable"));
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("estimate.getInternalApproval", () => {
  const invoke = (ctx = context(), input: any = { id: D }) =>
    estimateRouter.createCaller(ctx).getInternalApproval(input);

  it("delegates to the real read helper with the trusted actor/tenant, returning its result unchanged", async () => {
    await expect(invoke()).resolves.toEqual(READ_RESULT);
    expect(io.read).toHaveBeenCalledWith(D, U, T);
    expect(io.review).not.toHaveBeenCalled();
  });

  it("requires authentication before the helper runs", async () => {
    const ctx = context();
    ctx.user = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(io.read).not.toHaveBeenCalled();
  });

  it("requires a resolved tenant before the helper runs", async () => {
    const ctx = context();
    ctx.tenantId = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.read).not.toHaveBeenCalled();
  });

  it("refuses a forged tenantId/actorId outright — the strict shape has no room for them, so only ctx can ever reach the helper", async () => {
    await expect(invoke(context(), { id: D, tenantId: OTHER_T, userId: OTHER_T })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.read).not.toHaveBeenCalled();
  });

  it.each([
    { id: D, confirmedCurrencyCode: "USD" }, // review-only key rejected here
    { id: D, approvalId: D },
  ])("rejects an extraneous key before the helper runs: %j", async input => {
    await expect(invoke(context(), input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.read).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-uuid",
    "A1000000-0000-4000-8000-000000000003",
    "00000000-0000-0000-0000-000000000000",
  ])("rejects an invalid id before the helper runs: %s", async id => {
    await expect(invoke(context(), { id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.read).not.toHaveBeenCalled();
  });

  it("returns the typed none/active/revoked union exactly as the helper produced it, without reshaping", async () => {
    const active = { state: "active" as const, approval: { id: "x" }, snapshot: { id: "y" }, revocation: null };
    io.read.mockResolvedValue(active);
    await expect(invoke()).resolves.toEqual(active);
  });

  it("preserves a typed NOT_FOUND without leaking data", async () => {
    io.read.mockRejectedValue(new InternalApprovalPersistenceError("NOT_FOUND"));
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND", message: "This estimate is not available to your account." });
  });

  it("preserves a typed FORBIDDEN without leaking data", async () => {
    io.read.mockRejectedValue(new InternalApprovalPersistenceError("FORBIDDEN"));
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "This estimate is not available to your account." });
  });

  it("maps an integrity failure to a safe internal error without its own message leaking", async () => {
    io.read.mockRejectedValue(new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR"));
    await expect(invoke()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "This estimate's approval review could not be completed. Please try again.",
    });
  });

  it("never exposes an audit backend failure or its cause", async () => {
    io.read.mockRejectedValue(new InternalApprovalAuditFailure(new Error("synthetic-private-database-detail")));
    const result = invoke();
    await expect(result).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await result.catch(err => {
      expect(JSON.stringify(err)).not.toContain("synthetic-private-database-detail");
    });
  });
});

describe("neither read query mutates or reaches the held legacy approval path", () => {
  it("getInternalApprovalReview never calls the read helper and vice versa (approve vs read stay distinct helpers)", async () => {
    await estimateRouter.createCaller(context()).getInternalApprovalReview({ id: D, confirmedCurrencyCode: "USD" });
    expect(io.read).not.toHaveBeenCalled();
    io.review.mockClear();
    await estimateRouter.createCaller(context()).getInternalApproval({ id: D });
    expect(io.review).not.toHaveBeenCalled();
  });

  it("the legacy id-only approveEstimate mutation is still present and callable, unaffected by this change", async () => {
    // Regression smoke test only: full coverage of this held mutation is pre-existing
    // and out of this contract's scope. This merely confirms the new read queries did
    // not alter, remove, or silently reroute it.
    const caller = estimateRouter.createCaller(context()) as Record<string, unknown>;
    expect(typeof caller.approveEstimate).toBe("function");
    expect(typeof caller.getInternalApprovalReview).toBe("function");
    expect(typeof caller.getInternalApproval).toBe("function");
  });
});
