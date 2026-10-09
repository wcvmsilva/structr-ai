import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { rootCertificates } from "node:tls";

const repository = fileURLToPath(new URL("../", import.meta.url));
const sourceFiles = [
  "scripts/homolog-access-runner.ts",
  "scripts/homolog-access-bootstrap.ts",
  "scripts/homolog-access-bootstrap-sql.ts",
  "server/audit.ts",
  "drizzle/schema.ts",
  "shared/domain/taxonomy.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];
const cleanEnv = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  NODE_ENV: "production",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
let directory: string, fixture: string, commit: string;
function git(args: string[]) {
  const result = spawnSync(
    "/usr/bin/git",
    ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
    {
      cwd: fixture,
      encoding: "utf8",
      env: cleanEnv,
      timeout: 10_000,
    }
  );
  if (result.status !== 0)
    throw new Error(`Fixture Git failed: ${result.status}`);
  return result.stdout.trim();
}
function manifest() {
  const operationId = randomUUID();
  return {
    version: "structr-homolog-identities-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    sourceCommit: commit,
    operationId,
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
  };
}
function configuration() {
  return {
    version: "structr-homolog-admin-connection-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    host: "db.wmspwegbqtzamkhxhusg.supabase.co",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: "test-secret-never-print",
  };
}
async function input(value: unknown, raw = false) {
  const path = join(directory, `${randomUUID()}.json`);
  await writeFile(path, raw ? String(value) : JSON.stringify(value), {
    mode: 0o600,
  });
  return path;
}
function invoke(args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(fixture, "scripts/homolog-access-runner.ts"),
      ...args,
    ],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 15_000,
      env: { ...cleanEnv, ...env },
    }
  );
}
async function preflight(
  value: unknown = manifest(),
  config: unknown = configuration()
) {
  return invoke(["preflight", await input(value), await input(config)]);
}
function failure(result: ReturnType<typeof invoke>, code: string) {
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(`${code}\n`);
  expect(result.stderr).not.toContain("test-secret-never-print");
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "structr-homolog-runner-test-"));
  directory = await realpath(directory);
  fixture = join(directory, "repository");
  await mkdir(fixture);
  for (const file of sourceFiles) {
    await mkdir(dirname(join(fixture, file)), { recursive: true });
    await copyFile(join(repository, file), join(fixture, file));
  }
  await symlink(
    join(repository, "node_modules"),
    join(fixture, "node_modules")
  );
  git(["init", "--quiet"]);
  git(["add", "--", ...sourceFiles]);
  git([
    "-c",
    "user.name=Runner Fixture",
    "-c",
    "user.email=runner@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "test fixture",
  ]);
  commit = git(["rev-parse", "HEAD"]);
}, 20_000);
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("homolog administrative runner CLI", { timeout: 20000 }, () => {
  it.each([
    [],
    ["secret-argument"],
    ["apply"],
    ["preflight", "one"],
    ["sql", "one", "two"],
    ["preflight", "one", "two", "secret"],
  ])("refuses invalid arguments before reading a path: %j", (...args) => {
    failure(invoke(args), "HOMOLOG_RUNNER_USAGE");
  });
  it("preflights reviewed source and direct target without claiming connection or Auth evidence", async () => {
    const value = manifest(),
      result = await preflight(value);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      status: "preflight",
      operationId: value.operationId,
      sourceCommit: commit,
      projectRef: "wmspwegbqtzamkhxhusg",
      tenants: 2,
      profiles: 3,
      sourceVerified: true,
      databaseTargetVerified: false,
      authVerified: false,
    });
    expect(summary.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "authVerified",
        "databaseTargetVerified",
        "manifestHash",
        "operationId",
        "profiles",
        "projectRef",
        "sourceCommit",
        "sourceVerified",
        "status",
        "tenants",
      ].sort()
    );
    expect(result.stdout).not.toContain(value.profiles.A1.providerSubject);
    expect(result.stdout).not.toContain("test-secret-never-print");
  });
  it("ignores ambient database URLs and never loads an environment file", async () => {
    await writeFile(join(fixture, ".env"), "DATABASE_URL=never-read-this\n", {
      mode: 0o600,
    });
    const result = invoke(
      ["preflight", await input(manifest()), await input(configuration())],
      {
        DATABASE_URL:
          "postgres://wrong-user:ambient-secret@wrong-project.invalid/postgres",
        PGHOST: "wrong-project.invalid",
        PGPASSWORD: "ambient-secret",
        PGUSER: "wrong-user",
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("ambient-secret");
    expect(result.stdout + result.stderr).not.toContain("never-read-this");
  });
  it("accepts a bounded public CA certificate while retaining a fixed TLS policy", async () => {
    const result = await preflight(manifest(), {
      ...configuration(),
      caCertificate: rootCertificates[0],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("BEGIN CERTIFICATE");
  });
  it.each([
    ["foreign project", { projectRef: "other-project" }],
    ["foreign host", { host: "db.other-project.supabase.co" }],
    [
      "hostname suffix",
      { host: "db.wmspwegbqtzamkhxhusg.supabase.co.attacker.invalid" },
    ],
    [
      "pooler",
      {
        host: "aws-0-us-east-1.pooler.supabase.com",
        user: "postgres.wmspwegbqtzamkhxhusg",
      },
    ],
    ["host list", { host: ["db.wmspwegbqtzamkhxhusg.supabase.co"] }],
    ["multihost", { host: "db.wmspwegbqtzamkhxhusg.supabase.co,elsewhere" }],
    ["socket", { host: join(tmpdir(), "socket") }],
    ["wrong port", { port: 6543 }],
    ["string port", { port: "5432" }],
    ["wrong database", { database: "other" }],
    ["wrong user", { user: "service_role" }],
    ["blank password", { password: "" }],
    ["oversized password", { password: "x".repeat(8193) }],
    ["TLS disabled", { ssl: false }],
    ["verification disabled", { rejectUnauthorized: false }],
    ["URI override", { url: "postgres://secret" }],
    ["connection override", { connection: { role: "postgres" } }],
    ["invalid CA", { caCertificate: "not a certificate" }],
    [
      "private key as CA",
      {
        caCertificate:
          "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
      },
    ],
    [
      "trailing CA payload",
      { caCertificate: `${rootCertificates[0]}\nsecret-extra` },
    ],
  ])(
    "refuses %s before opening any database connection",
    async (_label, patch) => {
      failure(
        await preflight(manifest(), {
          ...configuration(),
          ...(patch as object),
        }),
        "HOMOLOG_CONNECTION_CONFIG_INVALID"
      );
    }
  );
  it("refuses a manifest for another project", async () => {
    failure(
      await preflight({ ...manifest(), projectRef: "elsewhere" }),
      "HOMOLOG_MANIFEST_INVALID"
    );
  });
  it("refuses a source reference that is not the executing HEAD", async () => {
    failure(
      await preflight({ ...manifest(), sourceCommit: "a".repeat(40) }),
      "HOMOLOG_SOURCE_MISMATCH"
    );
  });
  it.each(sourceFiles)(
    "refuses changes in the administrative dependency %s",
    async file => {
      const path = join(fixture, file),
        original = await readFile(path);
      // Whitespace is a valid change for TS, JSON and YAML, so imported code still runs.
      await writeFile(path, Buffer.concat([original, Buffer.from("\n")]));
      try {
        failure(await preflight(), "HOMOLOG_SOURCE_DIRTY");
      } finally {
        await writeFile(path, original);
      }
    }
  );
  it("refuses staged changes in privileged source", async () => {
    const file = "server/audit.ts",
      original = await readFile(join(fixture, file));
    await writeFile(
      join(fixture, file),
      Buffer.concat([original, Buffer.from("\n")])
    );
    git(["add", "--", file]);
    try {
      failure(await preflight(), "HOMOLOG_SOURCE_DIRTY");
    } finally {
      git(["restore", "--staged", "--worktree", "--", file]);
    }
  });
  it("refuses untracked code that could shadow a privileged import", async () => {
    const path = join(fixture, "server/audit.js");
    await writeFile(path, "export const logAudit = () => {};\n");
    try {
      failure(await preflight(), "HOMOLOG_SOURCE_DIRTY");
    } finally {
      await rm(path);
    }
  });
  it("refuses ignored code that could shadow a privileged import", async () => {
    const ignore = join(fixture, ".gitignore"),
      shadow = join(fixture, "server/audit.js");
    await writeFile(ignore, "server/audit.js\n");
    await writeFile(shadow, "export const logAudit = () => {};\n");
    try {
      failure(await preflight(), "HOMOLOG_SOURCE_DIRTY");
    } finally {
      await rm(shadow);
      await rm(ignore);
    }
  });
  it("compares actual source bytes even when Git is told to assume the file unchanged", async () => {
    const file = "server/audit.ts",
      path = join(fixture, file),
      original = await readFile(path);
    git(["update-index", "--assume-unchanged", "--", file]);
    await writeFile(path, Buffer.concat([original, Buffer.from("\n")]));
    try {
      failure(await preflight(), "HOMOLOG_SOURCE_DIRTY");
    } finally {
      await writeFile(path, original);
      git(["update-index", "--no-assume-unchanged", "--", file]);
    }
  });
  it("allows unrelated documentation changes", async () => {
    await writeFile(join(fixture, "notes.md"), "unrelated working notes");
    const result = await preflight();
    expect(result.status, result.stderr).toBe(0);
  });
  it.each(["manifest", "connection"])(
    "refuses a missing %s without exposing its path",
    async kind => {
      const value = await input(manifest()),
        config = await input(configuration()),
        missing = join(directory, "private-path-secret");
      failure(
        invoke([
          "preflight",
          kind === "manifest" ? missing : value,
          kind === "connection" ? missing : config,
        ]),
        kind === "manifest"
          ? "HOMOLOG_MANIFEST_UNREADABLE"
          : "HOMOLOG_CONNECTION_CONFIG_UNREADABLE"
      );
    }
  );
  it.each(["manifest", "connection"])(
    "refuses malformed JSON in the %s without echoing input",
    async kind => {
      const value = await input(manifest()),
        config = await input(configuration()),
        malformed = await input("test-secret-never-print", true);
      failure(
        invoke([
          "preflight",
          kind === "manifest" ? malformed : value,
          kind === "connection" ? malformed : config,
        ]),
        kind === "manifest"
          ? "HOMOLOG_MANIFEST_INVALID"
          : "HOMOLOG_CONNECTION_CONFIG_INVALID"
      );
    }
  );
  it.each(["manifest", "connection"])(
    "refuses a symbolic link for the %s",
    async kind => {
      const value = await input(manifest()),
        config = await input(configuration()),
        link = join(directory, randomUUID());
      await symlink(kind === "manifest" ? value : config, link);
      failure(
        invoke([
          "preflight",
          kind === "manifest" ? link : value,
          kind === "connection" ? link : config,
        ]),
        kind === "manifest"
          ? "HOMOLOG_MANIFEST_UNREADABLE"
          : "HOMOLOG_CONNECTION_CONFIG_UNREADABLE"
      );
    }
  );
  it.each(["manifest", "connection"])("refuses an oversized %s", async kind => {
    const value = await input(manifest()),
      config = await input(configuration()),
      large = await input(
        " ".repeat(kind === "manifest" ? 65537 : 32769),
        true
      );
    failure(
      invoke([
        "preflight",
        kind === "manifest" ? large : value,
        kind === "connection" ? large : config,
      ]),
      kind === "manifest"
        ? "HOMOLOG_MANIFEST_UNREADABLE"
        : "HOMOLOG_CONNECTION_CONFIG_UNREADABLE"
    );
  });
  it("refuses a group-readable connection file", async () => {
    const config = await input(configuration());
    await chmod(config, 0o640);
    failure(
      invoke(["preflight", await input(manifest()), config]),
      "HOMOLOG_CONNECTION_CONFIG_UNREADABLE"
    );
  });
  it("refuses a connection directory", async () => {
    failure(
      invoke(["preflight", await input(manifest()), directory]),
      "HOMOLOG_CONNECTION_CONFIG_UNREADABLE"
    );
  });
  it("refuses a connection FIFO without waiting for a writer", async () => {
    const fifo = join(directory, randomUUID());
    expect(spawnSync("/usr/bin/mkfifo", [fifo]).status).toBe(0);
    failure(
      invoke(["preflight", await input(manifest()), fifo]),
      "HOMOLOG_CONNECTION_CONFIG_UNREADABLE"
    );
  });
});
