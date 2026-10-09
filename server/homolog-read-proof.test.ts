import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseHomologReadProofManifest,
  planHomologReadProof,
} from "../scripts/homolog-read-proof";

const root = fileURLToPath(new URL("../", import.meta.url));
const entry = fileURLToPath(
  new URL("../scripts/homolog-read-proof.ts", import.meta.url)
);
const directories: string[] = [];
function manifest() {
  const operationId = randomUUID();
  return {
    version: "structr-homolog-read-proof-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    operationId,
    withdrawalOperationId: randomUUID(),
    sourceCommit: "b".repeat(40),
    identity: {
      version: "structr-homolog-identities-v1",
      projectRef: "wmspwegbqtzamkhxhusg",
      operationId: randomUUID(),
      sourceCommit: "a".repeat(40),
      tenants: {
        A: { id: randomUUID(), slug: `homolog-access-a-${operationId}` },
        B: { id: randomUUID(), slug: `homolog-access-b-${operationId}` },
      },
      profiles: {
        A1: {
          id: randomUUID(),
          providerSubject: randomUUID(),
          tenant: "A",
          role: "user",
        },
        A2: {
          id: randomUUID(),
          providerSubject: randomUUID(),
          tenant: "A",
          role: "user",
        },
        B1: {
          id: randomUUID(),
          providerSubject: randomUUID(),
          tenant: "B",
          role: "user",
        },
      },
    },
    fixture: {
      clientId: randomUUID(),
      projectId: randomUUID(),
      draftId: randomUUID(),
      membershipId: randomUUID(),
    },
  };
}
async function input(value: unknown) {
  const dir = await mkdtemp("/private/tmp/structr-read-proof-input-");
  directories.push(dir);
  const path = join(dir, "manifest.json");
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
function invoke(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production" },
  });
}
afterAll(async () => {
  for (const dir of directories)
    await rm(dir, { recursive: true, force: true });
});

describe("administrative read-proof private manifest", () => {
  it("plans exactly four business creations and five identity withdrawals without claiming verified Auth or a database destination", () => {
    const m = manifest();
    expect(parseHomologReadProofManifest(m)).toEqual(m);
    expect(planHomologReadProof(m)).toMatchObject({
      status: "planned",
      operationId: m.operationId,
      withdrawalOperationId: m.withdrawalOperationId,
      createRows: 4,
      createAudits: 5,
      withdrawRows: 5,
      withdrawAudits: 6,
      authVerified: false,
      databaseTargetVerified: false,
    });
    const output = JSON.stringify(planHomologReadProof(m));
    for (const profile of Object.values(m.identity.profiles))
      expect(output).not.toContain(profile.providerSubject);
    expect(output).not.toContain(m.fixture.clientId);
  });
  it("hashes key-order-equivalent input identically", () => {
    const m = manifest();
    expect(
      planHomologReadProof(Object.fromEntries(Object.entries(m).reverse()))
        .manifestHash
    ).toBe(planHomologReadProof(m).manifestHash);
  });
  it.each(["draft", "subject", "source", "withdrawal"])(
    "binds the %s into the replay digest",
    kind => {
      const m = manifest(),
        changed = structuredClone(m);
      if (kind === "draft") changed.fixture.draftId = randomUUID();
      if (kind === "subject")
        changed.identity.profiles.A2.providerSubject = randomUUID();
      if (kind === "source") changed.sourceCommit = "c".repeat(40);
      if (kind === "withdrawal") changed.withdrawalOperationId = randomUUID();
      expect(planHomologReadProof(changed).manifestHash).not.toBe(
        planHomologReadProof(m).manifestHash
      );
    }
  );
  it.each([
    [
      "production",
      (m: any) => {
        m.projectRef = "xoqhxpqsfxpdiwyuvhdd";
      },
    ],
    [
      "nested foreign project",
      (m: any) => {
        m.identity.projectRef = "xoqhxpqsfxpdiwyuvhdd";
      },
    ],
    [
      "secret",
      (m: any) => {
        m.password = "SECRET_SENTINEL";
      },
    ],
    [
      "arbitrary fixture data",
      (m: any) => {
        m.fixture.price = 100;
      },
    ],
    [
      "operator override",
      (m: any) => {
        m.protectedOperator = randomUUID();
      },
    ],
    [
      "admin role",
      (m: any) => {
        m.identity.profiles.A1.role = "admin";
      },
    ],
    [
      "cross-tenant viewer",
      (m: any) => {
        m.identity.profiles.A2.tenant = "B";
      },
    ],
    [
      "ordinary tenant slug",
      (m: any) => {
        m.identity.tenants.A.slug = "gchi";
      },
    ],
    [
      "duplicate fixture ID",
      (m: any) => {
        m.fixture.projectId = m.fixture.clientId;
      },
    ],
    [
      "fixture equals real subject",
      (m: any) => {
        m.fixture.draftId = m.identity.profiles.A1.providerSubject;
      },
    ],
    [
      "fixture equals profile",
      (m: any) => {
        m.fixture.membershipId = m.identity.profiles.A2.id;
      },
    ],
    [
      "operation equals tenant",
      (m: any) => {
        m.operationId = m.identity.tenants.B.id;
      },
    ],
    [
      "withdrawal equals create",
      (m: any) => {
        m.withdrawalOperationId = m.operationId;
      },
    ],
    [
      "withdrawal equals bootstrap",
      (m: any) => {
        m.withdrawalOperationId = m.identity.operationId;
      },
    ],
    [
      "zero UUID",
      (m: any) => {
        m.fixture.clientId = "00000000-0000-0000-0000-000000000000";
      },
    ],
    [
      "missing membership",
      (m: any) => {
        delete m.fixture.membershipId;
      },
    ],
    [
      "invalid source",
      (m: any) => {
        m.sourceCommit = "main";
      },
    ],
  ])("rejects %s without disclosing input", (_label, mutate) => {
    const m = manifest();
    mutate(m);
    expect(() => planHomologReadProof(m)).toThrow(
      "HOMOLOG_READ_MANIFEST_INVALID"
    );
  });
});

describe("offline read-proof CLI", () => {
  it.each(["validate", "plan"])(
    "runs %s without a database configuration and leaves the manifest untouched",
    async mode => {
      const m = manifest(),
        path = await input(m),
        result = invoke([mode, path]);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: mode === "plan" ? "planned" : "valid",
        createRows: 4,
      });
      expect(result.stdout).not.toContain(
        m.identity.profiles.A1.providerSubject
      );
      expect(await readFile(path, "utf8")).toBe(JSON.stringify(m));
    }
  );
  it("refuses apply without reading a supplied path", () => {
    const result = invoke(["apply", "/private/SECRET_SENTINEL.json"]);
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("HOMOLOG_READ_CLI_USAGE");
  });
  it("sanitizes unreadable-file errors", () => {
    const result = invoke(["plan", "/private/SECRET_SENTINEL.json"]);
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("HOMOLOG_READ_MANIFEST_UNREADABLE");
  });
  it("refuses symlink manifests", async () => {
    const path = await input(manifest()),
      link = `${path}.link`;
    await symlink(path, link);
    const result = invoke(["plan", link]);
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("HOMOLOG_READ_MANIFEST_UNREADABLE");
  });
  it("refuses oversized input before parsing it", async () => {
    const path = await input("x".repeat(65_537)),
      result = invoke(["plan", path]);
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("HOMOLOG_READ_MANIFEST_UNREADABLE");
  });
  it("never prints rejected credentials or validation diagnostics", async () => {
    const result = invoke([
      "plan",
      await input({ ...manifest(), password: "SECRET_SENTINEL" }),
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("HOMOLOG_READ_MANIFEST_INVALID");
    expect(result.stdout).toBe("");
  });
});
