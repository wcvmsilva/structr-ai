import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({ status: vi.fn(), notes: vi.fn(), discount: vi.fn(), reject: vi.fn(), archive: vi.fn(), access: vi.fn(), resolve: vi.fn(), create: vi.fn(), bundle: vi.fn(), audit: vi.fn(), pipeline: vi.fn(), scopeAccess: vi.fn(), partial: vi.fn(), retrying: vi.fn(), recovered: vi.fn(), createPartial: vi.fn() }));
vi.mock("./estimate-db", async original => ({ ...await original<typeof import("./estimate-db")>(),
  updateEstimateDraftStatus: io.status, updateEstimateDraftNotes: io.notes, applyEstimateDraftDiscount: io.discount,
  rejectEstimateDraft: io.reject, archiveEstimateDraft: io.archive,
}));
vi.mock("./project-access", async original => ({ ...await original<typeof import("./project-access")>(), requireProjectAccessTrpc: io.access, resolveProjectIdFor: io.resolve }));
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(), createEstimateDraft: io.create, getBundleById: io.bundle }));
vi.mock("./audit", () => ({ logAudit: io.audit }));
vi.mock("./scope-to-estimate-pipeline", async original => ({ ...await original<typeof import("./scope-to-estimate-pipeline")>(), executeScopeToEstimatePipeline: io.pipeline }));
vi.mock("./geo-override-db", async original => ({ ...await original<typeof import("./geo-override-db")>(), requireScopeOverrideLogAccess: io.scopeAccess }));
vi.mock("./draft-recovery-db", async original => ({ ...await original<typeof import("./draft-recovery-db")>(), getPartialDraftById: io.partial, markPartialDraftRetrying: io.retrying, markPartialDraftRecovered: io.recovered, createPartialDraft: io.createPartial }));
import { estimateRouter } from "./estimate-router";
import { estimateLegacyRouter } from "./estimate-legacy-router";
import { EstimateGuardError } from "./estimate-guard-error";
import { InternalApprovalAuditFailure, InternalApprovalPersistenceError } from "./internal-estimate-approval-errors";
import { ProjectAccessError } from "./project-access";

const T = "a8800000-0000-4000-8000-000000000001";
const U = "a8800000-0000-4000-8000-000000000002";
const P = "a8800000-0000-4000-8000-000000000003";
const D = "a8800000-0000-4000-8000-000000000004";
const B = "a8800000-0000-4000-8000-000000000005";
function context(): TrpcContext {
  return { req: {} as any, res: {} as any, authProvider: "legacy", tenantId: T,
    user: { id: U, tenantId: T, role: "user", isActive: true } as any };
}
const cases = [
  { name: "updateStatus", fn: io.status, input: { id: D, status: "draft" }, args: [D, "draft", U, T], permission: "approve" },
  { name: "updateNotes", fn: io.notes, input: { id: D, notes: "Operational note" }, args: [D, "Operational note", U, T], permission: "write" },
  { name: "applyDiscount", fn: io.discount, input: { id: D, discountPct: 5 }, args: [D, 5, U, T], permission: "approve" },
  { name: "rejectEstimate", fn: io.reject, input: { id: D, reason: "Needs revision" }, args: [D, U, "Needs revision", T], permission: "approve" },
  { name: "archive", fn: io.archive, input: { id: D }, args: [D, U, T], permission: "delete" },
];
beforeEach(() => {
  for (const fn of Object.values(io)) fn.mockReset();
  io.resolve.mockResolvedValue(P); io.access.mockResolvedValue({ projectId: P, tenantId: T, via: "owner" });
  for (const c of cases) c.fn.mockResolvedValue({ id: D, status: "draft" });
  io.partial.mockResolvedValue({ id: B, scopeDraftId: D, userId: U, status: "failed" });
  io.retrying.mockResolvedValue({ id: B, status: "retrying" });
  io.scopeAccess.mockResolvedValue({ projectId: P, tenantId: T });
  io.create.mockResolvedValue({ id: D, status: "draft" });
  io.bundle.mockResolvedValue({ id: B, name: "Synthetic bundle", items: [{ id: B, quantity: 1 }] });
});
describe.each(cases)("generic route $name", c => {
  const invoke = (ctx = context(), input: any = c.input) => (estimateRouter.createCaller(ctx) as any)[c.name](input);
  it("passes trusted tenant and actor instead of browser-supplied identity", async () => {
    await expect(invoke(context(), { ...c.input, tenantId: B, userId: B })).resolves.toMatchObject({ id: D });
    expect(c.fn).toHaveBeenCalledWith(...c.args);
    expect(io.access).toHaveBeenCalledWith(P, U, c.permission);
  });
  it("refuses unresolved tenant before calling the writer", async () => {
    const ctx = context(); ctx.tenantId = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(c.fn).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    const ctx = context(); ctx.user = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(c.fn).not.toHaveBeenCalled(); expect(io.access).not.toHaveBeenCalled();
  });
  it("validates input before the writer", async () => {
    await expect(invoke(context(), { ...c.input, id: "invalid" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(c.fn).not.toHaveBeenCalled();
  });
  it("does not dispatch after the project preflight fails", async () => {
    io.access.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Synthetic denial"));
    await expect(invoke()).rejects.toThrow("Synthetic denial"); expect(c.fn).not.toHaveBeenCalled();
  });
  it("maps a durable decision lock to a conflict", async () => {
    c.fn.mockRejectedValue(new EstimateGuardError("ESTIMATE_VERSION_LOCKED", "This decision is immutable"));
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT", message: "This decision is immutable" });
  });
  it("maps changed transactional authorization to forbidden", async () => {
    c.fn.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Access changed"));
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access changed" });
  });
  it("does not expose an audit backend failure to the operator", async () => {
    c.fn.mockRejectedValue(new InternalApprovalAuditFailure(new Error("synthetic-private-database-detail")));
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "The estimate change could not be saved. Please try again." });
  });
  it.each(["Invalid status transition: synthetic-private-detail", "synthetic-private-table not found"])("does not classify audit text as a legacy business error: %s", async detail => {
    c.fn.mockRejectedValue(new InternalApprovalAuditFailure(new Error(detail)));
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "The estimate change could not be saved. Please try again." });
  });
  it("maps exhausted transaction retries to an actionable conflict", async () => {
    c.fn.mockRejectedValue(new InternalApprovalPersistenceError("INTERNAL_APPROVAL_REQUEST_CONFLICT"));
    await expect(invoke()).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
describe("legacy bundle formation", () => {
  const invoke = (ctx = context()) => estimateLegacyRouter.createCaller(ctx).sendBundleToEstimate({ bundleId: B, projectId: P });
  it("passes the trusted tenant and creator to the atomic writer", async () => {
    await invoke(); expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, tenantId: T, createdBy: U, source: "bundle_legacy" }));
    expect(io.bundle).toHaveBeenCalledWith(T, B);
  });
  it("relies on the writer's durable audit without launching an independent audit", async () => {
    await invoke(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("does not expose audit failures", async () => {
    io.create.mockRejectedValue(new InternalApprovalAuditFailure(new Error("synthetic-private-database-detail")));
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "The estimate change could not be saved. Please try again." });
  });
  it("maps incomplete context to a useful precondition error", async () => {
    io.create.mockRejectedValue(new EstimateGuardError("ESTIMATE_CONTEXT_UNRESOLVED", "Select an active project"));
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("does not call the writer without a tenant", async () => {
    const ctx = context(); ctx.tenantId = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(io.create).not.toHaveBeenCalled();
  });
});

describe.each(["createFromScopeDraft", "retryPartialDraft"])("scope formation errors via %s", name => {
  const invoke = () => name === "createFromScopeDraft"
    ? estimateRouter.createCaller(context()).createFromScopeDraft({ scopeDraftId: D })
    : estimateRouter.createCaller(context()).retryPartialDraft({ id: B });
  it("does not expose transactional audit details or save them as a recovery payload", async () => {
    io.pipeline.mockRejectedValue(new InternalApprovalAuditFailure(new Error("synthetic-private-table not found")));
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "The estimate change could not be saved. Please try again." });
    expect(io.createPartial).not.toHaveBeenCalled(); expect(io.recovered).not.toHaveBeenCalled();
  });
  it("preserves a permission denial from the transactional writer", async () => {
    io.pipeline.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Access changed"));
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access changed" });
    expect(io.createPartial).not.toHaveBeenCalled(); expect(io.recovered).not.toHaveBeenCalled();
  });
});
