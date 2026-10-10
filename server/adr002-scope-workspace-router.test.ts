import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const io = vi.hoisted(() => ({ rpc: vi.fn(), project: vi.fn(), intakes: vi.fn(), drafts: vi.fn(), access: vi.fn(), audit: vi.fn() }));
vi.mock("./authenticated-data-api", async original => ({ ...(await original<typeof import("./authenticated-data-api")>()), callAuthenticatedScopeWorkspaceRead: io.rpc }));
vi.mock("./project-db", async original => ({ ...(await original<typeof import("./project-db")>()), getProjectById: io.project }));
vi.mock("./intake-db", async original => ({ ...(await original<typeof import("./intake-db")>()), getIntakeFormsByProject: io.intakes }));
vi.mock("./scope-db", async original => ({ ...(await original<typeof import("./scope-db")>()), listScopeDraftsForProject: io.drafts }));
vi.mock("./project-access", async original => ({ ...(await original<typeof import("./project-access")>()), requireProjectAccessTrpc: io.access }));
vi.mock("./audit", async original => ({ ...(await original<typeof import("./audit")>()), logAudit: io.audit }));
import { scopeGenerationRouter } from "./scope-generation-router";
import { router } from "./_core/trpc";
import { AuthenticatedDataApiError } from "./authenticated-data-api";
const api = router({ scopeGeneration: scopeGenerationRouter });
const actorId = "a1000000-0000-4000-8000-000000000001";
const tenantId = "b1000000-0000-4000-8000-000000000001";
const projectId = "c1000000-0000-4000-8000-000000000001";
const intakeFormId = "d1000000-0000-4000-8000-000000000001";
const command = { projectId, intakeFormId };
function context(): TrpcContext {
  const profile = { id: actorId, tenantId, role: "user", isActive: true };
  return { req: { headers: { authorization: "Bearer e30.e30.synthetic" } }, res: {}, authProvider: "supabase", user: profile, tenantId,
    authenticatedDataApiSession: { version: "structr-authenticated-session-v1", profile, tenantId, permissions: { slugs: [], isPlatformAdmin: false } } } as unknown as TrpcContext;
}
function wire() {
  return { version: "structr-authenticated-scope-workspace-read-v1", context: { actorId, tenantId },
    project: { id: projectId, tenantId, name: "Synthetic project", projectType: "repair", channel: "direct", status: "intake", address: null, city: null, state: null, zipCode: null, county: null, zone: null },
    intake: { id: intakeFormId, tenantId, projectId, status: "draft", serviceType: "repair", area: "2", finishLevel: "standard", condition: null, channel: "direct", notes: null, createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" },
    scopes: { state: "notLoaded" }, catalog: { state: "notLoaded" } };
}
const invoke = (input: unknown = command, ctx = context()) => api.createCaller(ctx).scopeGeneration.loadWorkspace(input as never);
function noLegacy() { for (const key of ["project", "intakes", "drafts", "access", "audit"] as const) expect(io[key]).not.toHaveBeenCalled(); }
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
  for (const mock of Object.values(io)) mock.mockReset();
  io.rpc.mockResolvedValue(wire());
  io.project.mockResolvedValue({ id: projectId, name: "Legacy project", projectType: "repair", channel: "direct", status: "intake" });
  io.intakes.mockResolvedValue([]); io.drafts.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
describe("SWR-1 existing loadWorkspace integration", () => {
  it("returns only the authenticated project/intake pair and preserves Date values", async () => {
    const ctx = context(); const result = await invoke(command, ctx);
    expect(result).toMatchObject({ version: "structr-authenticated-scope-workspace-read-v1", project: { id: projectId }, intake: { id: intakeFormId, projectId, createdAt: new Date("2026-10-09T12:00:00.000Z") }, scopes: { state: "notLoaded" }, catalog: { state: "notLoaded" } });
    expect(result).not.toHaveProperty("readiness"); expect(result).not.toHaveProperty("scopeDrafts");
    expect(io.rpc).toHaveBeenCalledTimes(1); expect(io.rpc).toHaveBeenCalledWith(ctx.req, command); noLegacy();
  });
  it.each([
    { projectId }, { intakeFormId }, { ...command, actorId }, { ...command, tenantId },
    { ...command, projectId: projectId.toUpperCase() }, { ...command, intakeFormId: "00000000-0000-0000-0000-000000000000" },
    { ...command, intakeFormId: null }, { ...command, intakeFormId: 7 }, { ...command, includeDrafts: true },
  ])("refuses malformed or expanded command %j before RPC", async input => {
    await expect(invoke(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.rpc).not.toHaveBeenCalled(); noLegacy();
  });
  it("requires a user", async () => {
    await expect(invoke(command, { ...context(), user: null })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(io.rpc).not.toHaveBeenCalled(); noLegacy();
  });
  it("refuses accessor commands before observing their values", async () => {
    let observed = 0;
    const input = Object.defineProperty({ intakeFormId }, "projectId", {
      enumerable: true, get: () => { observed++; return projectId; },
    });
    await expect(invoke(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(observed).toBe(0); expect(io.rpc).not.toHaveBeenCalled(); noLegacy();
  });
  it.each(["tenant", "session", "inactive"])("refuses missing/inconsistent protected %s", async kind => {
    const ctx = context();
    if (kind === "tenant") ctx.tenantId = null;
    if (kind === "session") ctx.authenticatedDataApiSession = undefined;
    if (kind === "inactive") ctx.user!.isActive = false;
    await expect(invoke(command, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.rpc).not.toHaveBeenCalled(); noLegacy();
  });
  it.each([["unauthorized", "UNAUTHORIZED"], ["forbidden", "FORBIDDEN"], ["not_found", "NOT_FOUND"], ["invalid_request", "BAD_REQUEST"], ["unavailable", "INTERNAL_SERVER_ERROR"]] as const)("maps %s to sanitized %s", async (kind, code) => {
    io.rpc.mockRejectedValue(new AuthenticatedDataApiError(kind));
    await expect(invoke()).rejects.toMatchObject({ code }); noLegacy();
  });
  it("does not expose an unexpected provider exception or fall back", async () => {
    io.rpc.mockRejectedValue(new Error("Bearer private SQL relation leaked"));
    const error = await invoke().catch(error => error);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR"); expect(error.message).not.toMatch(/Bearer|private|SQL|relation|leaked/); expect(error.cause).toBeUndefined(); noLegacy();
  });
  it("refuses a different physical pair without displaying either half", async () => {
    const value = wire(); value.intake.projectId = "c1000000-0000-4000-8000-000000000002"; io.rpc.mockResolvedValue(value);
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); noLegacy();
  });
  it("retains the direct legacy workspace projection", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    expect(await invoke({ projectId })).toMatchObject({ project: { id: projectId, name: "Legacy project" }, intakeForms: [], scopeDrafts: [], latestDraft: null, readiness: { canGenerate: false } });
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.access).toHaveBeenCalledWith(projectId, actorId, "read");
    expect(io.project).toHaveBeenCalledWith(projectId); expect(io.intakes).toHaveBeenCalledWith(projectId); expect(io.drafts).toHaveBeenCalledWith(projectId);
  });
});
