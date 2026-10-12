import { describe, expect, it } from "vitest";
import * as receipt from "../scripts/financial-executor-homologation/credential-receipt";
export const fixtureManifest = () => ({
  version: "calculator-homologation-v1",
  operationId: "c8000000-0000-4000-8000-000000000001",
  sourceCommit: "a".repeat(40),
  expectedDatabase: "postgres",
  expectedPrincipal: "postgres",
  operator: {
    subject: "c9000000-0000-4000-8000-000000000001",
    actorId: "c9000000-0000-4000-8000-000000000002",
    tenantId: "c9000000-0000-4000-8000-000000000003",
  },
  window: {
    opensAt: "2026-10-12T12:00:00.000Z",
    closesAt: "2026-10-12T13:00:00.000Z",
  },
});
export const credentialManifest = (fixture = fixtureManifest()) => ({
  fixture,
  metadata: {
    version: 1,
    operationId: "c8100000-0000-4000-8000-000000000001",
    generationId: "c8100000-0000-4000-8000-000000000002",
    fixtureOperationId: fixture.operationId,
    sourceCommit: fixture.sourceCommit,
    sourcePinsSha256: "b".repeat(64),
    role: "structr_calculator_login_v1",
    target: {
      host: "db.synthetic.supabase.co",
      port: 5432,
      database: "postgres",
      caSha256: "c".repeat(64),
    },
    executorPreview: {
      teamId: "team_synthetic",
      projectId: "prj_synthetic",
      environment: "preview",
    },
  },
  expectedPreviousReceiptId: null,
  // Synthetic owned-lab acceptance only. This does not approve any hosted operation.
  nativeLogRisk: {
    policy: "postgres-native-scram-context-v1",
    accepted: true,
    approvalReference: "owned synthetic lab only",
    logAudience: ["owned laboratory operator"],
    retentionDescription: "owned cluster logs destroyed at lab teardown",
  },
});
describe("strict credential lifecycle authorization record", () => {
  it("binds the fixed role, source, synthetic fixture and explicit Preview destination", () => {
    const m = credentialManifest();
    expect(receipt.parseCalculatorCredentialManifest(m)).toEqual(m);
  });
  it.each([
    ["unknown envelope", (m: any) => ({ ...m, password: "not allowed" })],
    [
      "unknown risk",
      (m: any) => ({
        ...m,
        nativeLogRisk: { ...m.nativeLogRisk, waiveAudit: true },
      }),
    ],
    [
      "unaccepted risk",
      (m: any) => ({
        ...m,
        nativeLogRisk: { ...m.nativeLogRisk, accepted: false },
      }),
    ],
    [
      "wrong policy",
      (m: any) => ({
        ...m,
        nativeLogRisk: { ...m.nativeLogRisk, policy: "suppressed" },
      }),
    ],
    [
      "missing approval",
      (m: any) => ({
        ...m,
        nativeLogRisk: { ...m.nativeLogRisk, approvalReference: "" },
      }),
    ],
    [
      "missing audience",
      (m: any) => ({
        ...m,
        nativeLogRisk: { ...m.nativeLogRisk, logAudience: [] },
      }),
    ],
    [
      "empty audience",
      (m: any) => ({
        ...m,
        nativeLogRisk: { ...m.nativeLogRisk, logAudience: [""] },
      }),
    ],
    [
      "missing retention",
      (m: any) => ({
        ...m,
        nativeLogRisk: { ...m.nativeLogRisk, retentionDescription: "" },
      }),
    ],
    [
      "source mismatch",
      (m: any) => ({
        ...m,
        metadata: { ...m.metadata, sourceCommit: "f".repeat(40) },
      }),
    ],
    [
      "fixture mismatch",
      (m: any) => ({
        ...m,
        metadata: {
          ...m.metadata,
          fixtureOperationId: "c8100000-0000-4000-8000-000000000003",
        },
      }),
    ],
    [
      "ID collision",
      (m: any) => ({
        ...m,
        metadata: { ...m.metadata, generationId: m.fixture.operationId },
      }),
    ],
    [
      "operator collision",
      (m: any) => ({
        ...m,
        metadata: { ...m.metadata, generationId: m.fixture.operator.actorId },
      }),
    ],
    [
      "fixed fixture collision",
      (m: any) => ({
        ...m,
        metadata: {
          ...m.metadata,
          operationId: "c8300000-0000-4000-8000-000000000004",
        },
      }),
    ],
    [
      "wrong role",
      (m: any) => ({ ...m, metadata: { ...m.metadata, role: "postgres" } }),
    ],
    [
      "production",
      (m: any) => ({
        ...m,
        metadata: {
          ...m.metadata,
          executorPreview: {
            ...m.metadata.executorPreview,
            environment: "production",
          },
        },
      }),
    ],
    [
      "unknown destination",
      (m: any) => ({
        ...m,
        metadata: {
          ...m.metadata,
          target: { ...m.metadata.target, password: "unknown" },
        },
      }),
    ],
    [
      "unknown metadata",
      (m: any) => ({ ...m, metadata: { ...m.metadata, verifier: "unknown" } }),
    ],
    [
      "bad predecessor",
      (m: any) => ({ ...m, expectedPreviousReceiptId: "not-uuid" }),
    ],
    [
      "operation predecessor collision",
      (m: any) => ({ ...m, expectedPreviousReceiptId: m.metadata.operationId }),
    ],
  ])("rejects %s", (_, change) => {
    expect(() =>
      receipt.parseCalculatorCredentialManifest(change(credentialManifest()))
    ).toThrow("CALCULATOR_HOMOLOGATION_CREDENTIAL_MANIFEST_INVALID");
  });
});
import * as lifecycle from "../scripts/financial-executor-homologation/credential";
const safeLogging = () => ({
  statement: "ddl",
  audit: "none",
  statistics: "top",
  utility: "on",
  nested: "off",
  explain: "10000",
  explainSample: "1",
  duration: "off",
  minimum: "-1",
  sampleMinimum: "-1",
  errorParameters: "0",
  auditRole: "",
  auditParameters: "off",
});
describe("credential transport logging profile", () => {
  it("accepts only the observed bounded transport profile", () =>
    expect(() =>
      lifecycle.assertCalculatorCredentialLoggingProfile(safeLogging())
    ).not.toThrow());
  it.each([
    ["all statements", { statement: "all" }],
    ["mod statements", { statement: "mod" }],
    ["duration log", { duration: "on" }],
    ["duration threshold", { minimum: "0" }],
    ["duration sampling", { sampleMinimum: "100" }],
    ["error parameters", { errorParameters: "-1" }],
    ["audit writes", { audit: "write" }],
    ["audit role", { auditRole: "postgres" }],
    ["audit parameters", { auditParameters: "on" }],
    ["nested statement statistics", { statistics: "all" }],
    ["nested explain", { nested: "on" }],
    ["unbounded explain", { explain: "0" }],
  ])("rejects %s", (_, change) =>
    expect(() =>
      lifecycle.assertCalculatorCredentialLoggingProfile({
        ...safeLogging(),
        ...change,
      })
    ).toThrow("CREDENTIAL_LOGGING_PROFILE")
  );
});

import { startOwnedCredentialProcess } from "./test-support/calculator-credential-runner";
describe("one-shot credential failure boundary", () => {
  it.each(["ordinary", "async"])(
    "redacts %s driver errors and exits uncertain without a receipt",
    async mode => {
      const m = credentialManifest();
      const process = await startOwnedCredentialProcess(
        {
          operation: "recover",
          admissionExpiresAt: new Date(Date.now() + 60000).toISOString(),
          manifest: m,
          adminSecretFile: "/private/tmp/unused-admin",
          caFile: "/private/tmp/unused-ca",
        },
        { directory: "/private/tmp/unused-owned", nonce: "unused" },
        mode
      );
      const result = await process.completed;
      expect(result.code).toBe(70);
      expect(result.stdout).toBe('{"status":"uncertain"}\n');
      expect(result.stderr).toBe("");
      expect(JSON.stringify(result).includes("synthetic-password")).toBe(false);
      expect(JSON.stringify(result).includes("synthetic-verifier")).toBe(false);
    },
    10000
  );
});

// Omitting admission validation must admit the invalid commands; using fixture
// expiry must reject recovery of an expired pilot. Exercise the actual process.
describe("recovery process admission", () => {
  const owned = { directory: "/private/tmp/unused-owned", nonce: "unused" };
  const common = () => ({
    manifest: credentialManifest(),
    adminSecretFile: "/private/tmp/unused-admin",
    caFile: "/private/tmp/unused-ca",
  });
  it.each([
    ["missing", () => undefined],
    ["expired", () => new Date(Date.now() - 1000).toISOString()],
    ["too long", () => new Date(Date.now() + 16 * 60000).toISOString()],
    ["offset datetime", () => "2099-01-01T00:00:00+00:00"],
    ["date only", () => "2099-01-01"],
    ["invalid datetime", () => "not-a-time"],
  ])(
    "rejects %s recovery admission before connecting",
    async (_, expiry) => {
      const admissionExpiresAt = expiry();
      const child = await startOwnedCredentialProcess(
        {
          ...common(),
          operation: "recover",
          ...(admissionExpiresAt === undefined ? {} : { admissionExpiresAt }),
        },
        owned,
        "admission"
      );
      const result = await child.completed;
      expect(result).toEqual({
        code: 70,
        stdout: '{"status":"uncertain"}\n',
        stderr: "",
      });
    },
    10000
  );
  it("uses the short explicit admission for recovery independently of an expired fixture", async () => {
    const admissionExpiresAt = new Date(Date.now() + 60000).toISOString();
    const manifest = credentialManifest();
    manifest.fixture.window = {
      opensAt: new Date(Date.now() - 120000).toISOString(),
      closesAt: new Date(Date.now() - 60000).toISOString(),
    };
    const child = await startOwnedCredentialProcess(
      { ...common(), manifest, operation: "recover", admissionExpiresAt },
      owned,
      "admission"
    );
    const result = await child.completed;
    expect(result).toEqual({
      code: 70,
      stdout:
        JSON.stringify({ connectionAdmission: admissionExpiresAt }) +
        '\n{"status":"uncertain"}\n',
      stderr: "",
    });
  }, 10000);
  it.each(["provision", "replace"])(
    "rejects recovery admission on %s before connecting",
    async operation => {
      const manifest = credentialManifest(),
        directory = "/private/tmp/unused-artifact";
      const child = await startOwnedCredentialProcess(
        {
          ...common(),
          operation,
          artifactPlan: {
            directory,
            path: directory + "/unused.json",
            metadata: manifest.metadata,
          },
          admissionExpiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        owned,
        "admission"
      );
      expect(await child.completed).toEqual({
        code: 70,
        stdout: '{"status":"uncertain"}\n',
        stderr: "",
      });
    },
    10000
  );
});
