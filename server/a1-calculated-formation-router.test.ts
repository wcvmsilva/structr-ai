import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({ persist: vi.fn(), access: vi.fn(), audit: vi.fn() }));
vi.mock("./estimate-db", async importOriginal => ({ ...await importOriginal<typeof import("./estimate-db")>(), createEstimateDraftFromCalculator: io.persist }));
vi.mock("./project-access", async importOriginal => ({ ...await importOriginal<typeof import("./project-access")>(), requireProjectAccessTrpc: io.access }));
vi.mock("./project-db", () => ({ getProjectById: vi.fn(async () => ({ id: "10000000-0000-4000-8000-000000000003", deletedAt: null })) }));
vi.mock("./assembly-db", () => ({ getAssemblyById: vi.fn(async () => ({ id: "10000000-0000-4000-8000-000000000004", isActive: true, components: [], name: "Synthetic", region: "charleston_sc" })) }));
vi.mock("./pricing-dimensions", () => ({ resolvePricingDimensions: vi.fn(async () => ({})), toPricingEngineDimensions: vi.fn(() => ({})) }));
vi.mock("@shared/assembly-engine", async importOriginal => ({ ...await importOriginal<typeof import("@shared/assembly-engine")>(), calculateMultipleAssemblies: vi.fn(() => ({ assemblies: [], totalCost: 1500, totalPrice: 3600, grossProfitPct: 58.333333 })) }));
vi.mock("@shared/estimate-engine", async importOriginal => ({ ...await importOriginal<typeof import("@shared/estimate-engine")>(), validateEstimateDraftInputs: vi.fn(() => []), transformBatchToEstimateDraft: vi.fn((_result, context) => ({ ...context, subtotalCost: "1500.00", finalTotalPrice: "3600.00" })) }));
vi.mock("./audit", () => ({ logAudit: io.audit }));
import { estimateRouter } from "./estimate-router";
import { EstimateGuardError } from "./estimate-db";
import { ProjectAccessError } from "./project-access";

const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const USER = id(1), TENANT = id(2), PROJECT = id(3), ASSEMBLY = id(4);
const input = () => ({ selections: [{ assemblyId: ASSEMBLY, quantity: 1 }], context: { projectId: PROJECT, region: "charleston_sc", channel: "direct" as const, finishLevel: "standard" as const } });
const caller = (tenantId: string | null = TENANT, loggedIn = true) => estimateRouter.createCaller({ tenantId, user: loggedIn ? { id: USER, role: "user" } : null } as TrpcContext);

beforeEach(() => {
  vi.clearAllMocks(); io.access.mockResolvedValue({ projectId: PROJECT, tenantId: TENANT });
  io.persist.mockResolvedValue({ id: id(5), bundleName: "Synthetic", finalTotalPrice: "3600.00" });
  io.audit.mockResolvedValue({ id: id(6) });
});

describe("A1 calculator trusted boundary", () => {
  it("passes authenticated actor and tenant separately to existing persistence", async () => {
    await caller().createFromCalculator(input());
    expect(io.persist).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT, subtotalCost: "1500.00", finalTotalPrice: "3600.00" }), USER, TENANT);
  });
  it("does not accept browser tenant or actor as authority", async () => {
    const request = { ...input(), tenantId: id(99), context: { ...input().context, tenantId: id(99), actorId: id(98) } };
    await caller().createFromCalculator(request);
    expect(io.persist).toHaveBeenCalledWith(expect.not.objectContaining({ tenantId: id(99) }), USER, TENANT);
  });
  it("requires login before calculator or persistence", async () => {
    await expect(caller(TENANT, false).createFromCalculator(input())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(io.persist).not.toHaveBeenCalled();
  });
  it("requires a resolved server tenant", async () => {
    await expect(caller(null).createFromCalculator(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.persist).not.toHaveBeenCalled();
  });
  it("does not continue after project access denial", async () => {
    io.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    await expect(caller().createFromCalculator(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.persist).not.toHaveBeenCalled();
  });
  it("returns an actionable formation error rather than a server fault", async () => {
    io.persist.mockRejectedValue(new EstimateGuardError("ESTIMATE_CONTEXT_UNRESOLVED", "Link the project to its active client."));
    await expect(caller().createFromCalculator(input())).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Link the project to its active client." });
  });
  it("reports permission withdrawn after preflight as forbidden", async () => {
    io.persist.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Project access withdrawn."));
    await expect(caller().createFromCalculator(input())).rejects.toMatchObject({ code: "FORBIDDEN", message: "Project access withdrawn." });
    expect(io.access).toHaveBeenCalledWith(PROJECT, USER, "write");
    expect(io.audit).not.toHaveBeenCalled();
  });
  it("validates IDs at the boundary", async () => {
    await expect(caller().createFromCalculator({ ...input(), context: { ...input().context, projectId: "invalid" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.persist).not.toHaveBeenCalled();
  });
});
