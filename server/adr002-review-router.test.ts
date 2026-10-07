import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const io = vi.hoisted(() => ({legacy: vi.fn(), rpc: vi.fn()}));
vi.mock("./internal-estimate-approval-db", async original => ({
  ...(await original<typeof import("./internal-estimate-approval-db")>()), getInternalApprovalReview: io.legacy,
}));
vi.mock("./authenticated-data-api", async original => ({
  ...(await original<typeof import("./authenticated-data-api")>()), callAuthenticatedReview: io.rpc,
}));
import { appRouter } from "./routers";
import { AuthenticatedDataApiError } from "./authenticated-data-api";
import { approvalContext, approvalRows } from "./internal-estimate-approval-adapter.fixtures";
import { authenticatedReviewEnvelope } from "./adr002-review.fixtures";

const command = {id: approvalRows().draft.id, confirmedCurrencyCode: "USD" as const};
function context(): TrpcContext {
  return {req: {headers: {authorization: "Bearer e30.e30.test"}} as any, res: {} as any,
    authProvider: "supabase", tenantId: approvalContext.tenantId,
    user: {id: approvalContext.actorId, tenantId: approvalContext.tenantId, isActive: true, role: "user"} as any};
}
const invoke = (input: unknown = command, ctx = context()) =>
  appRouter.createCaller(ctx).estimate.getInternalApprovalReview(input as any);
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  io.legacy.mockReset().mockResolvedValue({unsafeLegacy: true});
  io.rpc.mockReset().mockResolvedValue(authenticatedReviewEnvelope());
});
afterEach(() => vi.unstubAllEnvs());
describe("ADR-002 existing review route", () => {
  it("uses the authenticated request and existing pure financial review, without SQL fallback", async () => {
    const ctx = context();
    expect(await invoke(command, ctx)).toMatchObject({snapshot: {financials: {finalPriceMinor: "10000"}}});
    expect(io.rpc).toHaveBeenCalledWith(ctx.req, command);
    expect(io.legacy).not.toHaveBeenCalled();
  });
  it("preserves the existing direct implementation in direct mode", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    expect(await invoke()).toEqual({unsafeLegacy: true});
    expect(io.legacy).toHaveBeenCalledWith(command, approvalContext.actorId, approvalContext.tenantId);
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it("refuses caller authority fields before dispatch", async () => {
    await expect(invoke({...command, tenantId: approvalContext.tenantId})).rejects.toMatchObject({code: "BAD_REQUEST"});
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.legacy).not.toHaveBeenCalled();
  });
  it("refuses missing authentication before dispatch", async () => {
    await expect(invoke(command, {...context(), user: null})).rejects.toMatchObject({code: "UNAUTHORIZED"});
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.legacy).not.toHaveBeenCalled();
  });
  for (const [kind, code] of [
    ["unauthorized", "UNAUTHORIZED"], ["forbidden", "FORBIDDEN"], ["not_found", "NOT_FOUND"],
    ["invalid_request", "BAD_REQUEST"], ["conflict", "CONFLICT"], ["unavailable", "INTERNAL_SERVER_ERROR"],
  ] as const) it(`maps ${kind} safely without retrying through SQL`, async () => {
    io.rpc.mockRejectedValue(new AuthenticatedDataApiError(kind));
    await expect(invoke()).rejects.toMatchObject({code});
    expect(io.legacy).not.toHaveBeenCalled();
  });
  for (const [applicationCode, code] of [
    ["INTERNAL_APPROVAL_INTEGRITY_ERROR", "INTERNAL_SERVER_ERROR"],
    ["INTERNAL_APPROVAL_CONTENT_UNRESOLVED", "PRECONDITION_FAILED"],
    ["POLICY_CONTEXT_UNRESOLVED", "PRECONDITION_FAILED"],
    ["INTERNAL_APPROVAL_ALREADY_DECIDED", "CONFLICT"],
    ["HISTORICAL_AUTHORITY_NOT_AVAILABLE", "PRECONDITION_FAILED"],
  ] as const) it(`preserves the bounded database failure ${applicationCode}`, async () => {
    io.rpc.mockRejectedValue(new AuthenticatedDataApiError("invalid_request", "P0001", applicationCode));
    await expect(invoke()).rejects.toMatchObject({code});
    expect(io.legacy).not.toHaveBeenCalled();
  });
  it("rejects a successful RPC response bound to a different actor", async () => {
    const raw = authenticatedReviewEnvelope(); raw.context.actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    io.rpc.mockResolvedValue(raw);
    await expect(invoke()).rejects.toMatchObject({code: "INTERNAL_SERVER_ERROR"});
    expect(io.legacy).not.toHaveBeenCalled();
  });
});
