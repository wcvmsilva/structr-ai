import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router, protectedProcedure } from "./_core/trpc";
import { authRouter } from "./auth-router";
import type { TrpcContext } from "./_core/context";

const actorId = "a1000000-0000-4000-8000-000000000001";
const tenantId = "b1000000-0000-4000-8000-000000000001";
function context(): TrpcContext {
  const profile = { id: actorId, tenantId, role: "user", isActive: true };
  return { req: { headers: {} }, res: {}, authProvider: "supabase", user: profile, tenantId,
    authenticatedDataApiSession: { version: "structr-authenticated-session-v1", profile, tenantId,
      permissions: { slugs: [], isPlatformAdmin: false } } } as unknown as TrpcContext;
}
const api = router({
  auth: authRouter,
  scopeGeneration: router({
    loadWorkspace: protectedProcedure.query(() => "known pair"),
    checkReadiness: protectedProcedure.query(() => "readiness"),
    generateScope: protectedProcedure.mutation(() => "generated"),
    sendToReview: protectedProcedure.mutation(() => "submitted"),
  }),
  project: router({ list: protectedProcedure.query(() => "projects") }),
  intake: router({ create: protectedProcedure.mutation(() => "formed") }),
  assembly: router({ calculateBatch: protectedProcedure.query(() => "calculated") }),
});
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", undefined);
  vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("SWR-1 independent server admission", () => {
  it.each([undefined, "false", "TRUE", " true", "true ", "1", "yes"])("keeps read closed for flag %j", async flag => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", flag);
    await expect(api.createCaller(context()).scopeGeneration.loadWorkspace()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("admits only the named read with its exact flag", async () => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    expect(await api.createCaller(context()).scopeGeneration.loadWorkspace()).toBe("known pair");
  });
  it("intake formation being open does not open the read", async () => {
    vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", "true");
    await expect(api.createCaller(context()).scopeGeneration.loadWorkspace()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("opening the read does not open intake formation", async () => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    await expect(api.createCaller(context()).intake.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["project.list", "assembly.calculateBatch", "scopeGeneration.checkReadiness", "scopeGeneration.generateScope", "scopeGeneration.sendToReview"])("does not open %s", async path => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    const caller = api.createCaller(context());
    const [domain, operation] = path.split(".");
    await expect((caller as any)[domain][operation]()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not admit a mutation sharing the read path", async () => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    const wrong = router({ scopeGeneration: router({ loadWorkspace: protectedProcedure.mutation(() => "write") }) });
    await expect(wrong.createCaller(context()).scopeGeneration.loadWorkspace()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("still requires authentication when the read is admitted", async () => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    await expect(api.createCaller({ ...context(), user: null }).scopeGeneration.loadWorkspace()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("leaves direct mode dispatch unchanged", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    expect(await api.createCaller(context()).scopeGeneration.loadWorkspace()).toBe("known pair");
    expect(await api.createCaller(context()).assembly.calculateBatch()).toBe("calculated");
  });
});

describe("SWR-1 public presentation capability", () => {
  it("is false until the read is explicitly open", async () => {
    expect(await api.createCaller(context()).auth.session()).toMatchObject({ scopeWorkspaceReadEnabled: false });
  });
  it("is true for the read and consistent protected identity without enabling formation", async () => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    expect(await api.createCaller(context()).auth.session()).toMatchObject({ scopeWorkspaceReadEnabled: true, intakeFormationEnabled: false });
  });
  it.each(["absent", "inactive", "mismatched"])("does not advertise availability with %s identity", async kind => {
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    const ctx = context();
    if (kind === "absent") ctx.authenticatedDataApiSession = undefined;
    if (kind === "inactive") ctx.user!.isActive = false;
    if (kind === "mismatched") ctx.tenantId = "b1000000-0000-4000-8000-000000000002";
    expect(await api.createCaller(ctx).auth.session()).toMatchObject({ scopeWorkspaceReadEnabled: false });
  });
  it("is false in direct mode even with the flag set", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    vi.stubEnv("STRUCTR_SCOPE_WORKSPACE_READ_ENABLED", "true");
    expect(await api.createCaller(context()).auth.session()).toMatchObject({ scopeWorkspaceReadEnabled: false });
  });
});
