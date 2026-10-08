import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const io = vi.hoisted(() => ({
  detail: vi.fn(),
  record: vi.fn(),
  detailRpc: vi.fn(),
  recordRpc: vi.fn(),
  audit: vi.fn(),
  resolve: vi.fn(),
  access: vi.fn(),
}));
vi.mock("./internal-estimate-approval-db", async original => ({
  ...(await original<typeof import("./internal-estimate-approval-db")>()),
  getInternalApproval: io.record,
}));
vi.mock("./estimate-db", async original => ({
  ...(await original<typeof import("./estimate-db")>()),
  getEstimateDraftFull: io.detail,
}));
vi.mock("./project-access", async original => ({
  ...(await original<typeof import("./project-access")>()),
  resolveProjectIdFor: io.resolve,
  requireProjectAccessTrpc: io.access,
}));
vi.mock("./audit", async original => ({
  ...(await original<typeof import("./audit")>()),
  logAudit: io.audit,
}));
vi.mock("./authenticated-data-api", async original => ({
  ...(await original<typeof import("./authenticated-data-api")>()),
  callAuthenticatedEstimateDraftRead: io.detailRpc,
  callAuthenticatedInternalApprovalRecord: io.recordRpc,
}));
import { appRouter } from "./routers";
import { AuthenticatedDataApiError } from "./authenticated-data-api";
import {
  approvalContext,
  approvalRows,
} from "./internal-estimate-approval-adapter.fixtures";
import {
  estimateReadEnvelope,
  approvalRecordEnvelope,
  recordedApprovalEnvelope,
} from "./adr002-minimum-read.fixtures";
const command = { id: approvalRows().draft.id };
function context(): TrpcContext {
  return {
    req: { headers: { authorization: "Bearer e30.e30.test" } } as any,
    res: {} as any,
    authProvider: "supabase",
    tenantId: approvalContext.tenantId,
    user: {
      id: approvalContext.actorId,
      tenantId: approvalContext.tenantId,
      isActive: true,
      role: "user",
    } as any,
  };
}
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  for (const mock of Object.values(io)) mock.mockReset();
  io.detail.mockResolvedValue({
    ...approvalRows().draft,
    historicalImportId: null,
  });
  io.record.mockResolvedValue({
    state: "none",
    approval: null,
    snapshot: null,
    revocation: null,
  });
  io.detailRpc.mockResolvedValue(estimateReadEnvelope());
  io.recordRpc.mockResolvedValue(approvalRecordEnvelope());
  io.audit.mockResolvedValue(undefined);
  io.resolve.mockResolvedValue(approvalRows().project.id);
  io.access.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());
describe.each(["getById", "getInternalApproval"] as const)(
  "ADR-002 existing estimate.%s route",
  path => {
    const invoke = (input: unknown = command, ctx = context()) =>
      appRouter.createCaller(ctx).estimate[path](input as any);
    const rpc = () => (path === "getById" ? io.detailRpc : io.recordRpc);
    const legacy = () => (path === "getById" ? io.detail : io.record);
    it("uses the authorized fixed RPC, without pool access or a second audit", async () => {
      const ctx = context(),
        value = await invoke(command, ctx);
      expect(value).toMatchObject(
        path === "getById"
          ? { id: command.id, subtotalPrice: "100.00" }
          : { state: "none" }
      );
      expect(rpc()).toHaveBeenCalledWith(ctx.req, command);
      expect(legacy()).not.toHaveBeenCalled();
      expect(io.resolve).not.toHaveBeenCalled();
      expect(io.access).not.toHaveBeenCalled();
      expect(io.audit).not.toHaveBeenCalled();
    });
    it("preserves the real direct-mode dispatch and general read audit", async () => {
      vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
      await invoke();
      expect(legacy()).toHaveBeenCalledTimes(1);
      expect(rpc()).not.toHaveBeenCalled();
      if (path === "getById") {
        expect(io.access).toHaveBeenCalledWith(
          approvalRows().project.id,
          approvalContext.actorId,
          "read"
        );
        expect(io.audit).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "estimate_viewed",
            recordId: command.id,
            userId: approvalContext.actorId,
          })
        );
      } else {
        expect(io.record).toHaveBeenCalledWith(
          command.id,
          approvalContext.actorId,
          approvalContext.tenantId
        );
        expect(io.audit).not.toHaveBeenCalled();
      }
    });
    it("requires authentication before dispatch", async () => {
      await expect(
        invoke(command, { ...context(), user: null })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(rpc()).not.toHaveBeenCalled();
    });
    it("requires resolved authenticated tenant before dispatch", async () => {
      await expect(
        invoke(command, { ...context(), tenantId: null })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(rpc()).not.toHaveBeenCalled();
    });
    it.each([
      ["unauthorized", "UNAUTHORIZED"],
      ["forbidden", "FORBIDDEN"],
      ["not_found", "NOT_FOUND"],
      ["invalid_request", "BAD_REQUEST"],
      ["conflict", "CONFLICT"],
      ["unavailable", "INTERNAL_SERVER_ERROR"],
    ] as const)("maps %s without SQL fallback", async (kind, code) => {
      rpc().mockRejectedValue(new AuthenticatedDataApiError(kind));
      await expect(invoke()).rejects.toMatchObject({ code });
      expect(legacy()).not.toHaveBeenCalled();
      expect(io.audit).not.toHaveBeenCalled();
    });
    it("rejects an envelope for another actor", async () => {
      const wire =
        path === "getById" ? estimateReadEnvelope() : approvalRecordEnvelope();
      wire.context.actorId = "a1000000-0000-4000-8000-000000000105";
      rpc().mockResolvedValue(wire);
      await expect(invoke()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      expect(legacy()).not.toHaveBeenCalled();
    });
  }
);
it("returns existing recorded approval without requiring approve or reopening a review", async () => {
  io.recordRpc.mockResolvedValue(
    approvalRecordEnvelope(await recordedApprovalEnvelope())
  );
  expect(
    await appRouter
      .createCaller(context())
      .estimate.getInternalApproval(command)
  ).toMatchObject({ state: "active" });
  expect(io.record).not.toHaveBeenCalled();
});
it("keeps general legacy audit best effort", async () => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
  io.audit.mockRejectedValue(new Error("synthetic unavailable"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      await appRouter.createCaller(context()).estimate.getById(command)
    ).toMatchObject({ id: command.id });
  } finally {
    error.mockRestore();
  }
});

it("preserves the general route's uppercase UUID acceptance", async () => {
  expect(
    await appRouter
      .createCaller(context())
      .estimate.getById({ id: command.id.toUpperCase() })
  ).toMatchObject({ id: command.id });
});
