import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sqlAndSecrets = ["DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL", "DIRECT_URL", "PGHOST", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGHOSTADDR", "PGRST_DB_URI", "PGRST_JWT_SECRET", "SUPABASE_DB_PASSWORD", "VITE_SUPABASE_SERVICE_ROLE_KEY", "JWT_SECRET", "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"];
beforeEach(() => {
  vi.resetModules();
  for (const key of sqlAndSecrets) vi.stubEnv(key, undefined);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("AUTH_PROVIDER", "supabase");
  vi.stubEnv("SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK", "false");
  vi.stubEnv("TENANT_STRICT", "true");
  vi.stubEnv("SUPABASE_URL", "https://pilot-runtime.invalid");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_runtime_test");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("ADR-002 runtime credential boundary", () => {
  it("boots the restricted production mode without SQL or signing credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { ENV } = await import("./_core/env");
    expect(ENV.databaseMode).toBe("authenticated-data-api");
    expect(ENV.databaseUrl).toBe("");
    expect(ENV.cookieSecret).toBe("");
  });

  it.each(sqlAndSecrets)("refuses %s even in a test/development process", async name => {
    vi.stubEnv(name, "synthetic-sensitive-value-never-returned");
    await expect(import("./_core/env")).rejects.toThrow(/authenticated data API/i);
  });

  it("does not include a rejected credential value in the startup error", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://private-value-must-not-appear");
    const error = await import("./_core/env").then(() => null, error => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("private-value-must-not-appear");
  });

  it.each([
    ["AUTH_PROVIDER", "legacy"],
    ["SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK", "true"],
    ["TENANT_STRICT", "false"],
  ])("refuses incompatible %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    await expect(import("./_core/env")).rejects.toThrow(/authenticated data API/i);
  });

  it.each(["http://pilot-runtime.invalid", "https://user:password@pilot-runtime.invalid", "https://pilot-runtime.invalid/path", "https://pilot-runtime.invalid?key=value", "https://pilot-runtime.invalid#fragment", ""])("refuses unsafe service origin %s", async value => {
    vi.stubEnv("SUPABASE_URL", value);
    await expect(import("./_core/env")).rejects.toThrow(/authenticated data API/i);
  });

  it.each(["", "sb_secret_synthetic_forbidden", "eyJhbGciOiJIUzI1NiJ9.service-role.signature"])("refuses a nonpublishable API key", async value => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", value);
    await expect(import("./_core/env")).rejects.toThrow(/authenticated data API/i);
  });

  it("rejects unknown database mode instead of silently selecting SQL", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api-typo");
    await expect(import("./_core/env")).rejects.toThrow(/database mode/i);
  });

  it("retains the direct mode's production credential requirement", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    vi.stubEnv("NODE_ENV", "production");
    await expect(import("./_core/env")).rejects.toThrow(/DATABASE_URL, JWT_SECRET/);
  });

  it("loads procedure guards without triggering application startup validation", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    vi.stubEnv("NODE_ENV", "production");
    const { router, publicProcedure } = await import("./_core/trpc");
    const api = router({ isolated: publicProcedure.query(() => "isolated resolver") });
    expect(await api.createCaller({} as any).isolated()).toBe("isolated resolver");
  });

  it("refuses the global database accessor before a connection can be created", async () => {
    const { getDb } = await import("./db");
    await expect(getDb()).rejects.toThrow(/SQL access is disabled/i);
  });

  it("refuses the raw database accessor instead of returning an unbound handle", async () => {
    const { getRawClient } = await import("./db");
    expect(() => getRawClient()).toThrow(/SQL access is disabled/i);
  });

  it("creates the restricted application without a legacy cookie signing secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { createApplication } = await import("./_core/application");
    expect(() => createApplication()).not.toThrow();
  });
});
