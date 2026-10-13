import { describe, expect, it } from "vitest";
import { parseCalculatorInstallManifest } from "../scripts/financial-executor-homologation/installer";
export const manifest = () => ({
  version: "calculator-install-v1",
  operationId: "d8300000-0000-4000-8000-000000000001",
  sourceCommit: "56a723770aa2a60b588b6d8ab37b96414c72d619",
  sourcePinsSha256:
    "8eb116952a6ffe5d8e08df6c790ec89bd23f30d6c7be307e31c2f40d8d3d5669",
  expectedDatabase: "postgres",
  expectedPrincipal: "postgres",
  tempContainmentAuditId: "d8300000-0000-4000-8000-000000000002",
  artifacts: {
    foundationSha256:
      "a74b4d933bafe92c23ddaf3d5aee3487ce0e2197b03d10ae434280a268294d54",
    lifecycleSha256:
      "87a09f22a4e433a75f2f01973b3ee903a0a1f9dd7ef0f0706860c5b8fe988c61",
  },
});
describe("Calculator installer manifest admission", () => {
  it("accepts the exact nominal source and independent TEMP receipt", () => {
    expect(parseCalculatorInstallManifest(manifest())).toEqual(manifest());
  });
  it.each([
    { expectedPrincipal: "supabase_admin" },
    { expectedDatabase: "production" },
    { sourcePinsSha256: "0".repeat(64) },
    { sourceCommit: "HEAD" },
    { operationId: "d8300000-0000-4000-8000-000000000002" },
    { operationId: "not-a-uuid" },
    { tempContainmentAuditId: null },
    { allowDrift: true },
  ])(
    "rejects a changed destination, unpinned source or ambiguous operation: %j",
    change => {
      expect(() =>
        parseCalculatorInstallManifest({ ...manifest(), ...change })
      ).toThrow("CALCULATOR_INSTALL_MANIFEST_INVALID");
    }
  );
  it("refuses a substituted SQL digest", () => {
    const value = manifest();
    value.artifacts.lifecycleSha256 = "0".repeat(64);
    expect(() => parseCalculatorInstallManifest(value)).toThrow(
      "CALCULATOR_INSTALL_MANIFEST_INVALID"
    );
  });
});
