import { describe, expect, it } from "vitest";
import { assertProductionTenantIsolation, isStrictTenantMode } from "./tenant-scope";

describe("production tenant isolation startup gate", () => {
  it.each([undefined, "", "false", "FALSE", "0", "1", "yes", " true "])(
    "refuses production with tenant switch %s instead of permitting legacy NULL rows",
    raw => {
      expect(() => assertProductionTenantIsolation({ NODE_ENV: "production", TENANT_STRICT: raw }))
        .toThrow("TENANT_STRICT=true is required in production");
      expect(isStrictTenantMode({ TENANT_STRICT: raw })).toBe(false);
    },
  );
  it.each(["true", "TRUE", "True"])("allows the canonical strict value %s", raw => {
    expect(() => assertProductionTenantIsolation({ NODE_ENV: "production", TENANT_STRICT: raw })).not.toThrow();
    expect(isStrictTenantMode({ TENANT_STRICT: raw })).toBe(true);
  });
  it.each(["development", "test", undefined])("keeps the controlled legacy mode in %s", environment => {
    expect(() => assertProductionTenantIsolation({ NODE_ENV: environment, TENANT_STRICT: "false" })).not.toThrow();
  });
  it("reports the missing safety switch without disclosing connection secrets", () => {
    const settings = { NODE_ENV: "production", TENANT_STRICT: "false", DATABASE_URL: "postgres://private:synthetic-secret@localhost/lab" };
    try { assertProductionTenantIsolation(settings); throw new Error("Expected refusal"); }
    catch (error) {
      expect((error as Error).message).toContain("TENANT_STRICT");
      expect((error as Error).message).not.toContain("synthetic-secret");
      expect((error as Error).message).not.toContain("postgres://");
    }
  });
});
