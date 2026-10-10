import { describe, expect, it } from "vitest";
import { getAuthenticatedDataApiConfig } from "./_core/database-mode";
const env = { STRUCTR_DATABASE_MODE: "authenticated-data-api", AUTH_PROVIDER: "supabase", TENANT_STRICT: "true", SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic" };
describe("ADR-003 credential isolation", () => {
  it.each(["false", "true"])("refuses the executor SQL secret in web environment with calculator gate %s", enabled => {
    expect(() => getAuthenticatedDataApiConfig({ ...env, STRUCTR_FINANCIAL_CALCULATOR_ENABLED: enabled, FINANCIAL_EXECUTOR_DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5432/synthetic" })).toThrow("Invalid authenticated data API runtime configuration");
  });
});
