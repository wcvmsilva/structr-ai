import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publicAndRequiredEnv = [
  "NODE_ENV", "CSP_MODE", "CSP_REPORT_URI", "SUPABASE_URL", "VITE_SUPABASE_URL",
  "AUTH_PROVIDER", "DATABASE_URL", "JWT_SECRET", "OAUTH_SERVER_URL", "OWNER_OPEN_ID",
] as const;

beforeEach(() => {
  vi.resetModules();
  for (const name of publicAndRequiredEnv) vi.stubEnv(name, undefined);
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("CSP configuration before application credentials are available", () => {
  it("imports without credentials and supplies the production report-only policy", async () => {
    await expect(import("./_core/csp").then(csp => csp.buildHelmetCspOption())).resolves.toEqual({
      useDefaults: false,
      reportOnly: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'", "blob:"],
        frameAncestors: ["'none'"],
        workerSrc: ["'self'", "blob:"],
        formAction: ["'self'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
    });
  });

  it.each(["development", undefined])("enforces Vite-compatible defaults for NODE_ENV=%s", async nodeEnv => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    const csp = await import("./_core/csp");
    expect(csp.buildHelmetCspOption()).toMatchObject({ useDefaults: false, reportOnly: false });
    const directives = csp.buildCspDirectives();
    expect(directives.scriptSrc).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    expect(directives.connectSrc).toEqual(["'self'", "https:", "ws:", "wss:", "http://localhost:*", "http://127.0.0.1:*"]);
    expect(directives).not.toHaveProperty("upgradeInsecureRequests");
    expect(csp.describeCspMode()).toBe("enforced");
  });

  it("enforces without development relaxations in the test environment", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const csp = await import("./_core/csp");
    expect(csp.buildHelmetCspOption()).toMatchObject({ reportOnly: false });
    expect(csp.buildCspDirectives().scriptSrc).toEqual(["'self'"]);
    expect(csp.buildCspDirectives().upgradeInsecureRequests).toEqual([]);
  });

  it.each([
    ["production", true, "report-only (violations logged, nothing blocked)"],
    ["development", false, "enforced"],
  ] as const)("falls back for an invalid mode in %s", async (nodeEnv, reportOnly, description) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("CSP_MODE", "invalid");
    const csp = await import("./_core/csp");
    expect(csp.buildHelmetCspOption()).toMatchObject({ reportOnly });
    expect(csp.describeCspMode()).toBe(description);
  });

  it.each([
    [" ENFORCE ", false, "enforced"],
    [" REPORT-ONLY ", true, "report-only (violations logged, nothing blocked)"],
  ] as const)("normalizes explicit mode %s", async (mode, reportOnly, description) => {
    vi.stubEnv("CSP_MODE", mode);
    const csp = await import("./_core/csp");
    expect(csp.buildHelmetCspOption()).toMatchObject({ useDefaults: false, reportOnly });
    expect(csp.describeCspMode()).toBe(description);
  });

  it("disables CSP only for an explicit off mode and reports that state", async () => {
    vi.stubEnv("CSP_MODE", " OFF ");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const csp = await import("./_core/csp");
    expect(csp.buildHelmetCspOption()).toBe(false);
    expect(csp.describeCspMode()).toBe("disabled");
  });

  it("uses the configured report endpoint", async () => {
    vi.stubEnv("CSP_REPORT_URI", "/csp-report");
    const csp = await import("./_core/csp");
    expect(csp.buildCspDirectives().reportUri).toEqual(["/csp-report"]);
  });

  it.each([
    [" https://server.example.test/// ", "https://browser.example.test", ["'self'", "https:", "https://server.example.test", "wss://server.example.test"]],
    [undefined, " https://browser.example.test/ ", ["'self'", "https:", "https://browser.example.test", "wss://browser.example.test"]],
    ["", "https://browser.example.test", ["'self'", "https:"]],
  ] as const)("preserves Supabase origin precedence for server URL %s", async (serverUrl, browserUrl, expected) => {
    vi.stubEnv("SUPABASE_URL", serverUrl);
    vi.stubEnv("VITE_SUPABASE_URL", browserUrl);
    const csp = await import("./_core/csp");
    expect(csp.buildCspDirectives().connectSrc).toEqual(expected);
  });

  it("keeps explicit directive options ahead of environment defaults", async () => {
    vi.stubEnv("CSP_REPORT_URI", "/default-report");
    vi.stubEnv("SUPABASE_URL", "https://default.example.test");
    const csp = await import("./_core/csp");
    const directives = csp.buildCspDirectives({ isDevelopment: true, reportUri: "", supabaseUrl: "https://override.example.test" });
    expect(directives).not.toHaveProperty("reportUri");
    expect(directives).not.toHaveProperty("upgradeInsecureRequests");
    expect(directives.connectSrc).toEqual(["'self'", "https:", "https://override.example.test", "wss://override.example.test", "ws:", "wss:", "http://localhost:*", "http://127.0.0.1:*"]);
  });
});

describe("application environment validation remains mandatory", () => {
  it("still rejects both missing base credentials in production", async () => {
    await expect(import("./_core/env")).rejects.toThrow("Missing required environment variables: DATABASE_URL, JWT_SECRET");
  });

  it.each(["DATABASE_URL", "JWT_SECRET"])("still rejects missing %s independently", async missing => {
    vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/synthetic");
    vi.stubEnv("JWT_SECRET", "synthetic-secret");
    vi.stubEnv(missing, undefined);
    await expect(import("./_core/env")).rejects.toThrow(`Missing required environment variables: ${missing}`);
  });

  it("still rejects missing Supabase configuration after base credentials are supplied", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/synthetic");
    vi.stubEnv("JWT_SECRET", "synthetic-secret");
    await expect(import("./_core/env")).rejects.toThrow("AUTH_PROVIDER=supabase requires SUPABASE_URL");
  });

  it("still requires the legacy OAuth configuration when that provider is selected", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/synthetic");
    vi.stubEnv("JWT_SECRET", "synthetic-secret");
    vi.stubEnv("AUTH_PROVIDER", "legacy");
    await expect(import("./_core/env")).rejects.toThrow("Missing required environment variables: OAUTH_SERVER_URL, OWNER_OPEN_ID");
  });

  it("keeps ENV and CSP consistent when configuration is complete", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://fixture.invalid/synthetic");
    vi.stubEnv("JWT_SECRET", "synthetic-secret");
    vi.stubEnv("SUPABASE_URL", " https://configured.example.test/// ");
    vi.stubEnv("CSP_MODE", " ENFORCE ");
    vi.stubEnv("CSP_REPORT_URI", "/configured-report");
    const { ENV } = await import("./_core/env");
    const csp = await import("./_core/csp");
    expect(ENV).toMatchObject({ nodeEnv: "production", isProduction: true, isDevelopment: false, cspMode: "enforce", cspReportUri: "/configured-report", supabaseUrl: "https://configured.example.test" });
    expect(csp.buildHelmetCspOption()).toMatchObject({ reportOnly: false, directives: { reportUri: ["/configured-report"], connectSrc: ["'self'", "https:", "https://configured.example.test", "wss://configured.example.test"] } });
  });
});
