/** ADR-002 partial-read UI reservation: auth.session gains a presentation-only
 * descriptor (`estimateReadOnly`) computed strictly from `isAuthenticatedDataApiMode()`,
 * never from the auth provider. This is not an authorization signal — the
 * allowlist in server/_core/trpc.ts remains the only authority. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./_core/trpc";
import { authRouter } from "./auth-router";
import type { TrpcContext } from "./_core/context";

function context(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: { headers: {} },
    res: {},
    user: null,
    tenantId: null,
    authProvider: "supabase",
    ...overrides,
  } as TrpcContext;
}

async function session(ctx: TrpcContext) {
  return router({ auth: authRouter }).createCaller(ctx).auth.session();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ADR-002 partial-read UI: auth.session estimateReadOnly descriptor", () => {
  it("is true when the authenticated Data API boundary is active", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
    expect((await session(context())).estimateReadOnly).toBe(true);
  });

  it("is false in the existing direct database mode", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    expect((await session(context())).estimateReadOnly).toBe(false);
  });

  it("is computed from the database mode, never from the auth provider", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
    const supabase = await session(context({ authProvider: "supabase" }));
    const legacy = await session(context({ authProvider: "legacy" }));
    expect(supabase.estimateReadOnly).toBe(true);
    expect(legacy.estimateReadOnly).toBe(true);
  });

  it("does not depend on whether a user is authenticated", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
    const anonymous = await session(context({ user: null }));
    expect(anonymous.estimateReadOnly).toBe(true);
  });

  it("leaves every other session field unchanged", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    const result = await session(context({ authProvider: "legacy" }));
    expect(result).toMatchObject({ provider: "legacy", authenticated: false, supabase: null });
  });
});
