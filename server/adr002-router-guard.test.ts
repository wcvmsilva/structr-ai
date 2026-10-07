import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router, publicProcedure, protectedProcedure, tenantProcedure, adminProcedure, adminTenantProcedure } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";

const user = { id: "10000000-0000-4000-8000-000000000001", tenantId: "20000000-0000-4000-8000-000000000001", role: "admin", isActive: true };
function context(): TrpcContext {
  return { user, tenantId: user.tenantId, authProvider: "supabase", req: { headers: {} }, res: {} } as TrpcContext;
}
beforeEach(() => { vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe.each([
  ["public", publicProcedure], ["protected", protectedProcedure], ["tenant", tenantProcedure],
  ["admin", adminProcedure], ["adminTenant", adminTenantProcedure],
] as const)("ADR-002 %s procedure boundary", (_name, base) => {
  it("blocks an unrelated read before its resolver reveals data", async () => {
    const api = router({ unrelated: base.query(() => ({ privateData: "must-not-return" })) });
    await expect(api.createCaller(context()).unrelated()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("blocks an unrelated mutation before any resolver side effect", async () => {
    let changed = false;
    const api = router({ unrelated: base.mutation(() => { changed = true; return true; }) });
    await expect(api.createCaller(context()).unrelated()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(changed).toBe(false);
  });
});

describe("ADR-002 named path allowlist", () => {
  const api = router({
    auth: router({ me: publicProcedure.query(() => "self"), session: publicProcedure.query(() => "descriptor"), logout: publicProcedure.mutation(() => "not-real-revocation"), sessionMetadata: publicProcedure.query(() => "private") }),
    estimate: router({ getInternalApprovalReview: tenantProcedure.query(() => "review"), approveEstimate: adminProcedure.mutation(() => "approved"), exportJSON: protectedProcedure.query(() => "bytes") }),
    tenantSettings: router({ provision: publicProcedure.mutation(() => "provisioned") }),
    system: router({ health: publicProcedure.query(() => "state") }),
  });
  it.each([
    ["approval", (caller: ReturnType<typeof api.createCaller>) => caller.estimate.approveEstimate()],
    ["export", (caller: ReturnType<typeof api.createCaller>) => caller.estimate.exportJSON()],
    ["cookie-only logout", (caller: ReturnType<typeof api.createCaller>) => caller.auth.logout()],
    ["tenant provisioning", (caller: ReturnType<typeof api.createCaller>) => caller.tenantSettings.provision()],
    ["unreviewed health endpoint", (caller: ReturnType<typeof api.createCaller>) => caller.system.health()],
  ] as const)("blocks %s even for an authenticated administrator", async (_name, invoke) => {
    await expect(invoke(api.createCaller(context()))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("retains the existing auth.me path", async () => { expect(await api.createCaller(context()).auth.me()).toBe("self"); });
  it("retains the existing auth.session path", async () => { expect(await api.createCaller(context()).auth.session()).toBe("descriptor"); });
  it("retains only the existing A1 review path", async () => { expect(await api.createCaller(context()).estimate.getInternalApprovalReview()).toBe("review"); });
  it("does not treat a path prefix as an allowed procedure", async () => {
    await expect(api.createCaller(context()).auth.sessionMetadata()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("still requires an authenticated user for the allowed review", async () => {
    await expect(api.createCaller({ ...context(), user: null }).estimate.getInternalApprovalReview()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("still requires a tenant for the allowed review", async () => {
    await expect(api.createCaller({ ...context(), tenantId: null }).estimate.getInternalApprovalReview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not change direct-mode paths", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    expect(await api.createCaller(context()).estimate.approveEstimate()).toBe("approved");
  });
  it("does not authorize a mutation merely because its name matches an allowed read", async () => {
    let changed = false;
    const renamed = router({ auth: router({ me: publicProcedure.mutation(() => { changed = true; }) }) });
    await expect(renamed.createCaller(context()).auth.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(changed).toBe(false);
  });
});
