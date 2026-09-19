import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

it("keeps connection configuration internal without writing it to test output", async () => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "postgres://fixture:private-example@localhost/synthetic");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { ENV } = await import("./_core/env");
  expect(ENV.databaseUrl).toBe("postgres://fixture:private-example@localhost/synthetic");
  expect(log).not.toHaveBeenCalled();
});

it("refuses an incomplete normal startup without including a connection value in the error", async () => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AUTH_PROVIDER", "supabase");
  vi.stubEnv("DATABASE_URL", "postgres://fixture:private-example@localhost/synthetic");
  vi.stubEnv("JWT_SECRET", "");
  await expect(import("./_core/env")).rejects.toThrow("Missing required environment variables: JWT_SECRET");
});
