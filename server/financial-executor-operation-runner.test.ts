/** Real parser/files/process behavior: no hosted connections or runtime secrets. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  parseCalculatorOperationCommand,
  readCalculatorOperationCommand,
} from "../scripts/financial-executor-homologation/operation-runner";
vi.setConfig({ testTimeout: 60000 });
const now = Date.parse("2026-10-13T16:00:00.000Z");
const fixture = {
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
    opensAt: "2026-10-13T15:30:00.000Z",
    closesAt: "2026-10-13T17:00:00.000Z",
  },
};
const rbac = {
  ...fixture,
  version: "calculator-homologation-rbac-v1",
  operationId: "c8000000-0000-4000-8000-000000000002",
  operator: { ...fixture.operator, originalRole: "user" },
  nominalRole: "calculator_pilot_operator_v1",
  permissionMode: "create-absent",
  ids: {
    permission: "c8310000-0000-4000-8000-000000000001",
    role: "c8310000-0000-4000-8000-000000000002",
    edge: "c8310000-0000-4000-8000-000000000003",
  },
};
const base = {
  adminSecretFile: "/private/admin.json",
  caFile: "/private/reviewed-ca.pem",
  admissionExpiresAt: "2026-10-13T16:10:00.000Z",
  target: {
    host: "db.synthetic.supabase.co",
    port: 5432,
    database: "postgres",
    principal: "postgres",
    caSha256: "b".repeat(64),
  },
};
const preflight = () => ({
  ...base,
  operation: "preflight",
  manifest: structuredClone(fixture),
});
const paired = (operation = "prepare") => ({
  ...base,
  operation,
  manifest: { fixture: structuredClone(fixture), rbac: structuredClone(rbac) },
});
const reference = {
  receiptId: "c8400000-0000-4000-8000-000000000001",
  generationId: "c8400000-0000-4000-8000-000000000002",
};
const temp = () => ({
  ...base,
  operation: "temp",
  manifest: {
    version: "calculator-temp-containment-v1",
    operationId: "c8500000-0000-4000-8000-000000000001",
    sourceCommit: "a".repeat(40),
    expectedDatabase: "postgres",
    expectedPrincipal: "postgres",
  },
});
const rejected = /CALCULATOR_OPERATION_COMMAND_REJECTED/;
describe("operational command authority and phase parsing", () => {
  it("preserves the exact preflight target and fixture without adding secret material", async () => {
    const result = await parseCalculatorOperationCommand(preflight(), now);
    expect(result).toEqual(preflight());
  });
  it("keeps TEMP source/operation identity for the audit-bound caller", async () => {
    expect(await parseCalculatorOperationCommand(temp(), now)).toEqual(temp());
  });
  it.each(["prepare", "deactivate", "withdraw"])(
    "accepts paired %s only after both manifests reconcile",
    async operation => {
      expect(
        await parseCalculatorOperationCommand(paired(operation), now)
      ).toEqual(paired(operation));
    }
  );
  it("requires and preserves the exact receipt plus generation when opening", async () => {
    const command = { ...paired("open"), credential: reference };
    expect(await parseCalculatorOperationCommand(command, now)).toEqual(
      command
    );
  });
  it("admits withdrawal separately after the historical business window expired", async () => {
    const command = paired("withdraw");
    command.manifest.fixture.window = {
      opensAt: "2026-10-12T15:30:00.000Z",
      closesAt: "2026-10-12T17:00:00.000Z",
    };
    command.manifest.rbac.window = command.manifest.fixture.window;
    expect(
      (await parseCalculatorOperationCommand(command, now)).operation
    ).toBe("withdraw");
  });
  it.each([
    ["unknown action", () => ({ ...preflight(), operation: "execute-sql" })],
    ["credential value", () => ({ ...preflight(), password: "SENTINEL" })],
    [
      "runtime secret creation",
      () => ({ ...preflight(), operation: "provision" }),
    ],
    ["missing open reference", () => paired("open")],
    [
      "implicit latest reference",
      () => ({ ...paired("open"), credential: { latest: true } }),
    ],
    [
      "missing generation",
      () => ({
        ...paired("open"),
        credential: { receiptId: reference.receiptId },
      }),
    ],
    [
      "reference on other phase",
      () => ({ ...preflight(), credential: reference }),
    ],
    [
      "wide admin principal",
      () => ({
        ...preflight(),
        target: { ...base.target, principal: "supabase_admin" },
      }),
    ],
    [
      "pooler target",
      () => ({
        ...preflight(),
        target: { ...base.target, host: "aws-0-pooler.supabase.com" },
      }),
    ],
    [
      "unbounded admin admission",
      () => ({
        ...preflight(),
        admissionExpiresAt: "2026-10-13T16:15:00.001Z",
      }),
    ],
    [
      "expired admin admission",
      () => ({
        ...preflight(),
        admissionExpiresAt: "2026-10-13T16:00:00.000Z",
      }),
    ],
    ["nonfinite time", () => ({ ...preflight(), admissionExpiresAt: "NaN" })],
    [
      "relative secret path",
      () => ({ ...preflight(), adminSecretFile: "admin.json" }),
    ],
    [
      "noncanonical secret path",
      () => ({
        ...preflight(),
        adminSecretFile: "/private/../private/admin.json",
      }),
    ],
    [
      "target override",
      () => ({
        ...preflight(),
        target: { ...base.target, password: "SENTINEL" },
      }),
    ],
    [
      "manifest principal mismatch",
      () => ({
        ...preflight(),
        manifest: { ...fixture, expectedPrincipal: "other" },
      }),
    ],
    [
      "manifest extra mutation",
      () => ({ ...preflight(), manifest: { ...fixture, sql: "DELETE" } }),
    ],
    [
      "paired source mismatch",
      () => ({
        ...paired(),
        manifest: { fixture, rbac: { ...rbac, sourceCommit: "c".repeat(40) } },
      }),
    ],
    [
      "paired operator mismatch",
      () => ({
        ...paired(),
        manifest: {
          fixture,
          rbac: {
            ...rbac,
            operator: {
              ...rbac.operator,
              actorId: "d9000000-0000-4000-8000-000000000005",
            },
          },
        },
      }),
    ],
    [
      "TEMP missing source",
      () => ({
        ...temp(),
        manifest: { ...temp().manifest, sourceCommit: undefined },
      }),
    ],
  ])(
    "rejects %s before any transport can be selected",
    async (_label, make) => {
      await expect(
        parseCalculatorOperationCommand(make(), now)
      ).rejects.toThrow(rejected);
    }
  );
});
describe("protected operational command file", () => {
  let dir: string, file: string;
  beforeEach(async () => {
    dir = await mkdtemp(
      join(await realpath(tmpdir()), "calculator-operation-")
    );
    file = join(dir, "command.json");
    await writeFile(file, JSON.stringify(preflight()), { mode: 0o600 });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("reads a private canonical command and accepts owner-read-only mode", async () => {
    expect(await readCalculatorOperationCommand(file, now)).toEqual(
      preflight()
    );
    await chmod(file, 0o400);
    expect(await readCalculatorOperationCommand(file, now)).toEqual(
      preflight()
    );
  });
  it.each([0o640, 0o644, 0o700, 0o660])(
    "refuses unsafe mode %s",
    async mode => {
      await chmod(file, mode);
      await expect(readCalculatorOperationCommand(file, now)).rejects.toThrow(
        rejected
      );
    }
  );
  it("rejects symlink and hardlink commands", async () => {
    const alias = join(dir, "alias.json"),
      hard = join(dir, "hard.json");
    await symlink(file, alias);
    await expect(readCalculatorOperationCommand(alias, now)).rejects.toThrow(
      rejected
    );
    await link(file, hard);
    await expect(readCalculatorOperationCommand(file, now)).rejects.toThrow(
      rejected
    );
  });
  it("rejects directories and relative or nonnormalized command paths", async () => {
    await expect(readCalculatorOperationCommand(dir, now)).rejects.toThrow(
      rejected
    );
    await expect(
      readCalculatorOperationCommand("command.json", now)
    ).rejects.toThrow(rejected);
    await expect(
      readCalculatorOperationCommand(
        dir + "/../" + dir.split("/").at(-1) + "/command.json",
        now
      )
    ).rejects.toThrow(rejected);
  });
  it.each(["", " ".repeat(65537), "SENTINEL_PASSWORD", Buffer.from([0xff])])(
    "rejects bounded malformed command bytes without content disclosure",
    async content => {
      await writeFile(file, content);
      await expect(readCalculatorOperationCommand(file, now)).rejects.toThrow(
        /^CALCULATOR_OPERATION_COMMAND_REJECTED$/
      );
    }
  );
});

describe("one-shot operational process containment", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(await realpath(tmpdir()), "calculator-process-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function child(
    command: unknown,
    mode: string,
    direct = false,
    argsExtra: string[] = [],
    owned?: { directory: string; temp: string }
  ) {
    const commandFile = join(dir, "command.json"),
      events = join(dir, "events.jsonl");
    await writeFile(commandFile, JSON.stringify(command), { mode: 0o600 });
    const script = fileURLToPath(
      new URL(
        direct
          ? "../scripts/financial-executor-homologation/operation-runner.ts"
          : "./test-support/calculator-operation-process.ts",
        import.meta.url
      )
    );
    const run = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        commandFile,
        ...(direct
          ? argsExtra
          : [events, mode, ...(owned ? [owned.directory, "owned-proof"] : [])]),
      ],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          PATH: "/usr/bin:/bin",
          NODE_ENV: "test",
          ...(owned ? { TMPDIR: owned.temp } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stdout = "",
      stderr = "";
    run.stdout.on("data", data => {
      stdout += data;
    });
    run.stderr.on("data", data => {
      stderr += data;
    });
    const code = await new Promise<number | null>(resolve => {
      const timer = setTimeout(() => run.kill("SIGKILL"), 50000);
      run.once("close", value => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    const evidence = await readFile(events, "utf8").catch(() => "");
    return {
      code,
      stdout,
      stderr,
      evidence: evidence.trim()
        ? evidence
            .trim()
            .split("\n")
            .map(line => JSON.parse(line))
        : [],
    };
  }
  const fresh = () => ({
    ...preflight(),
    admissionExpiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  it("rejects unsafe phase authority before opening a connection", async () => {
    const result = await child({ ...fresh(), operation: "open" }, "ordinary");
    expect(result).toEqual({
      code: 70,
      stdout: '{"status":"uncertain"}\n',
      stderr: "",
      evidence: [],
    });
  });
  it.each(["ordinary", "async", "signal"])(
    "contains %s transport failure without exposing any driver data",
    async mode => {
      const command = fresh();
      const result = await child(command, mode);
      expect(result).toMatchObject({
        code: 70,
        stdout: '{"status":"uncertain"}\n',
        stderr: "",
      });
      expect(result.evidence).toEqual([
        {
          phase: "connection",
          expiresAt: command.admissionExpiresAt,
          expected: base.target,
        },
      ]);
    }
  );
  it("closes a connection resolving after termination without starting a transaction", async () => {
    const result = await child(fresh(), "resolve-after-signal");
    expect(result).toMatchObject({
      code: 70,
      stdout: '{"status":"uncertain"}\n',
      stderr: "",
    });
    expect(result.evidence.map(item => item.phase)).toEqual([
      "connection",
      "close",
    ]);
  });
  it.each(["transaction", "close"])(
    "closes after %s failure before reporting uncertainty",
    async mode => {
      const result = await child(fresh(), mode);
      expect(result).toMatchObject({
        code: 70,
        stdout: '{"status":"uncertain"}\n',
        stderr: "",
      });
      expect(result.evidence.map(item => item.phase)).toEqual([
        "connection",
        "transaction",
        "close",
      ]);
    }
  );
  it("admits only an owned fixture under the child's canonical custom temporary root", async () => {
    const custom = join(dir, "custom-temp"),
      ownedDirectory = join(custom, "structr-app-principal-pg-owned-proof");
    await mkdir(custom);
    await mkdir(ownedDirectory);
    const result = await child(fresh(), "owned-admission", false, [], {
      directory: ownedDirectory,
      temp: custom,
    });
    expect(result).toMatchObject({
      code: 70,
      stdout: '{"status":"uncertain"}\n',
      stderr: "",
    });
    expect(result.evidence.map(item => item.phase)).toEqual([
      "connection",
      "owned-admission",
    ]);
  });
  it("production entry does not accept alternate transport flags", async () => {
    const result = await child(fresh(), "unused", true, ["--physical"]);
    expect(result).toEqual({
      code: 70,
      stdout: '{"status":"uncertain"}\n',
      stderr: "",
      evidence: [],
    });
  });
  it("production entry refuses nonexistent protected secrets with sanitized output", async () => {
    const result = await child(fresh(), "unused", true);
    expect(result).toEqual({
      code: 70,
      stdout: '{"status":"uncertain"}\n',
      stderr: "",
      evidence: [],
    });
  });
});
