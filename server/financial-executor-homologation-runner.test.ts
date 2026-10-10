import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  writeFile,
  chmod,
  symlink,
  rm,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCalculatorHomologationPlan } from "../scripts/financial-executor-homologation/runner";
const manifest = {
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
    opensAt: "2026-10-10T12:00:00.000Z",
    closesAt: "2026-10-10T12:30:00.000Z",
  },
};
describe("plan-only administrative runner", () => {
  let dir: string, file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "calculator-plan-"));
    file = join(dir, "manifest.json");
    await writeFile(file, JSON.stringify(manifest), { mode: 0o600 });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("produces a redacted fixed plan and makes no hosted/source attestation", async () => {
    const r = await runCalculatorHomologationPlan(["--plan", file]);
    expect(r).toMatchObject({
      status: "planned",
      hostedReady: false,
      sourceAttested: false,
    });
    expect(JSON.stringify(r)).not.toContain(manifest.operator.subject);
    expect(JSON.stringify(r)).not.toContain(manifest.operator.tenantId);
  });
  it.each([
    "--preflight",
    "--prepare",
    "--open",
    "--withdraw",
    "--execute",
    "--seed",
  ])("refuses execution flag %s", async flag => {
    await expect(runCalculatorHomologationPlan([flag, file])).rejects.toThrow(
      "PLAN_ONLY"
    );
  });
  it("refuses mixed plan and execution arguments", async () => {
    await expect(
      runCalculatorHomologationPlan(["--plan", file, "--open"])
    ).rejects.toThrow("PLAN_ONLY");
  });
  it("requires an absolute manifest path", async () => {
    await expect(
      runCalculatorHomologationPlan(["--plan", "manifest.json"])
    ).rejects.toThrow("PROTECTED_FILE");
  });
  it("refuses group-readable identity mapping", async () => {
    await chmod(file, 0o640);
    await expect(
      runCalculatorHomologationPlan(["--plan", file])
    ).rejects.toThrow("PROTECTED_FILE");
  });
  it("refuses symlinks", async () => {
    const link = join(dir, "link.json");
    await symlink(file, link);
    await expect(
      runCalculatorHomologationPlan(["--plan", link])
    ).rejects.toThrow("PROTECTED_FILE");
  });
  it("refuses directories", async () => {
    const folder = join(dir, "folder");
    await mkdir(folder);
    await expect(
      runCalculatorHomologationPlan(["--plan", folder])
    ).rejects.toThrow("PROTECTED_FILE");
  });
  it("refuses oversized files", async () => {
    await writeFile(file, " ".repeat(65537));
    await expect(
      runCalculatorHomologationPlan(["--plan", file])
    ).rejects.toThrow("PROTECTED_FILE");
  });
  it("does not surface malformed content or paths", async () => {
    await writeFile(file, "SECRET_TEST_SENTINEL");
    await expect(
      runCalculatorHomologationPlan(["--plan", file])
    ).rejects.toThrow(/^CALCULATOR_HOMOLOGATION_MANIFEST_INVALID$/);
  });
  it("refuses credentials as manifest fields", async () => {
    await writeFile(
      file,
      JSON.stringify({ ...manifest, password: "SECRET_TEST_SENTINEL" })
    );
    await expect(
      runCalculatorHomologationPlan(["--plan", file])
    ).rejects.toThrow(/^CALCULATOR_HOMOLOGATION_MANIFEST_INVALID$/);
  });
  it("does not fall back to environment configuration for a missing manifest", async () => {
    await expect(
      runCalculatorHomologationPlan(["--plan", join(dir, "absent.json")])
    ).rejects.toThrow(/^CALCULATOR_HOMOLOGATION_PROTECTED_FILE$/);
  });
});
