import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmod,
  mkdtemp,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
  readFile,
  stat,
  link,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let afterFileRead: (() => Promise<void>) | undefined;
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const read = handle.read.bind(handle);
      handle.read = (async (...readArgs: any[]) => {
        const result = await (read as any)(...readArgs);
        if (afterFileRead) {
          const hook = afterFileRead;
          afterFileRead = undefined;
          await hook();
        }
        return result;
      }) as typeof handle.read;
      return handle;
    },
  };
});
import * as api from "../scripts/financial-executor-homologation/credential-artifact";
import { inspect } from "node:util";
const metadata = {
  version: 1 as const,
  operationId: "e510aca9-87ea-4b4c-8fc4-c3e49c0e7271",
  generationId: "290b23e1-e9af-4757-b7e1-156f65e09573",
  fixtureOperationId: "57b607bc-6bbd-4f13-950d-194b749b2d84",
  sourceCommit: "a".repeat(40),
  sourcePinsSha256: "b".repeat(64),
  role: "structr_calculator_login_v1" as const,
  target: {
    host: "db.syntheticref.supabase.co",
    port: 5432 as const,
    database: "postgres" as const,
    caSha256: "c".repeat(64),
  },
  executorPreview: {
    teamId: "team_synthetic",
    projectId: "prj_synthetic",
    environment: "preview" as const,
  },
};
let directory: string;
beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "calculator-artifact-test-"))
  );
  await chmod(directory, 0o700);
});
afterEach(async () => {
  afterFileRead = undefined;
  await rm(directory, { recursive: true, force: true });
});
const plan = (value: unknown = metadata, dir = directory) =>
  api.planCalculatorCredentialArtifact({ directory: dir, metadata: value });

describe("credential artifact plan", () => {
  it("binds an immutable generation and destination without creating any file", async () => {
    const actual = await plan();
    expect(actual?.metadata).toEqual(metadata);
    expect(actual?.path).toBe(
      join(directory, `${metadata.generationId}.credential.json`)
    );
    expect(Object.isFrozen(actual?.metadata.target)).toBe(true);
    expect(Object.isFrozen(actual?.metadata.executorPreview)).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });
  it.each([
    { password: "synthetic-should-never-appear" },
    {
      target: { ...metadata.target, host: `db.${"a".repeat(64)}.supabase.co` },
    },
    { generationId: metadata.operationId.toUpperCase() },
    { generationId: metadata.operationId },
    { fixtureOperationId: metadata.generationId },
    { role: "postgres" },
    { sourceCommit: "head" },
    { sourcePinsSha256: "" },
    {
      executorPreview: {
        ...metadata.executorPreview,
        environment: "production",
      },
    },
    { target: { ...metadata.target, host: "127.0.0.1" } },
    { target: { ...metadata.target, ssl: false } },
  ])("rejects invalid or unreviewed public metadata %#", async patch => {
    await expect(plan({ ...metadata, ...patch })).rejects.toThrow(
      /^CALCULATOR_CREDENTIAL_ARTIFACT_REJECTED$/
    );
    expect(await readdir(directory)).toEqual([]);
  });
  it.each([0o755, 0o770, 0o750])(
    "rejects nonprivate directory mode %s",
    async mode => {
      await chmod(directory, mode);
      await expect(plan()).rejects.toThrow("ARTIFACT_REJECTED");
    }
  );
  it("rejects a directory symlink", async () => {
    const alias = join(directory, "alias");
    await symlink(directory, alias);
    await expect(plan(metadata, alias)).rejects.toThrow("ARTIFACT_REJECTED");
  });
  it.each(["relative", "/private/tmp/../tmp"])(
    "rejects noncanonical directory %s",
    async dir => {
      await expect(plan(metadata, dir)).rejects.toThrow("ARTIFACT_REJECTED");
    }
  );
});

const fixturePassword = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
// Python stdlib independent reference: bytes(range(32)) base64url password,
// bytes(range(16)) salt; hashlib.pbkdf2_hmac + hmac + hashlib.sha256, 4096.
const fixtureVerifier =
  "SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$NvkXWq0wYSynbqqkiTVAFyAbEz7zso9wu6kmOGu5o8k=:TpSLdfD8sJyJE7l/5BmoE+d7g2Y4LdbG0ttHEN36WIo=";
const stage = api.stageCalculatorCredentialArtifact;
const read = api.readCalculatorCredentialArtifact;
async function reference(p: any, patch = {}) {
  await writeFile(
    p.path,
    JSON.stringify({
      metadata,
      password: fixturePassword,
      verifier: fixtureVerifier,
      ...patch,
    }),
    { mode: 0o600 }
  );
}

describe("private staged credential generation", () => {
  it("durably stages one private file and hides generated material from all ordinary inspection", async () => {
    const p = await plan();
    const artifact = await stage(p);
    expect(artifact?.metadata).toEqual(metadata);
    expect((await stat(p.path)).mode & 0o7777).toBe(0o600);
    const stored = JSON.parse(await readFile(p.path, "utf8"));
    expect(Buffer.from(stored.password, "base64url")).toHaveLength(32);
    expect(
      Buffer.from(stored.verifier.split(":")[1].split("$")[0], "base64")
    ).toHaveLength(16);
    expect(stored.verifier).toMatch(/^SCRAM-SHA-256\$4096:/);
    for (const value of [
      JSON.stringify(artifact),
      inspect(artifact, { depth: 10, showHidden: true }),
    ]) {
      expect(value).not.toContain(stored.password);
      expect(value).not.toContain(stored.verifier);
    }
    expect(JSON.stringify(artifact)).not.toMatch(/password|verifier|digest/i);
    expect(
      await artifact.withSecret((secret: any) => secret.password.length)
    ).toBe(43);
    await artifact.withSecret((secret: any) => {
      expect(inspect(secret, { showHidden: true })).not.toContain(
        stored.password
      );
      expect(JSON.stringify(secret)).not.toContain(stored.verifier);
    });
  });
  it("refuses overwriting an existing generation and preserves its bytes", async () => {
    const p = await plan();
    await reference(p);
    const before = await readFile(p.path);
    await expect(stage(p)).rejects.toThrow("ARTIFACT_REJECTED");
    expect(await readFile(p.path)).toEqual(before);
  });
  it("rejects a symlink at the intended generation without changing the target", async () => {
    const p = await plan();
    const other = join(directory, "other");
    await writeFile(other, "untouched");
    await symlink(other, p.path);
    await expect(stage(p)).rejects.toThrow("ARTIFACT_REJECTED");
    expect(await readFile(other, "utf8")).toBe("untouched");
  });
  it("revalidates a changed directory before generating", async () => {
    const p = await plan();
    await chmod(directory, 0o755);
    await expect(stage(p)).rejects.toThrow("ARTIFACT_REJECTED");
    expect(await readdir(directory)).toEqual([]);
  });
  it("rejects an invented artifact filename rather than staging outside the generation", async () => {
    const p = await plan();
    await expect(
      stage({ ...p, path: join(directory, "foreign") })
    ).rejects.toThrow("ARTIFACT_REJECTED");
    expect(await readdir(directory)).toEqual([]);
  });
  it("generates different passwords and salts for separate generations", async () => {
    const p = await plan();
    expect(await stage(p)).not.toBeNull();
    const q = await plan({
      ...metadata,
      generationId: "ab51d6d4-fcf8-4f4b-b309-d2bdb94a8c3d",
    });
    expect(await stage(q)).not.toBeNull();
    const a = JSON.parse(await readFile(p.path, "utf8")),
      b = JSON.parse(await readFile(q.path, "utf8"));
    expect(a.password).not.toEqual(b.password);
    expect(a.verifier.split("$")[1]).not.toEqual(b.verifier.split("$")[1]);
  });
});

describe("stable protected artifact read", () => {
  it("accepts an independently calculated SCRAM reference and exposes it only deliberately", async () => {
    const p = await plan();
    await reference(p);
    const artifact = await read(p);
    expect(artifact?.metadata).toEqual(metadata);
    expect(await artifact.withSecret((s: any) => s.password)).toBe(
      fixturePassword
    );
    expect(await artifact.withSecret((s: any) => s.verifier)).toBe(
      fixtureVerifier
    );
  });
  it("sanitizes synchronous and asynchronous callback errors without secret causes", async () => {
    const p = await plan();
    await reference(p);
    const a = await read(p);
    expect(a).not.toBeNull();
    for (const callback of [
      () => {
        throw new Error(fixturePassword);
      },
      async () => {
        throw new Error(fixtureVerifier);
      },
    ]) {
      const error = await a.withSecret(callback).catch((e: any) => e);
      expect(error.message).toBe("CALCULATOR_CREDENTIAL_ARTIFACT_REJECTED");
      expect(error.cause).toBeUndefined();
      expect(inspect(error)).not.toContain(fixturePassword);
      expect(inspect(error)).not.toContain(fixtureVerifier);
    }
  });
  it.each([0o644, 0o640, 0o400, 0o700])(
    "rejects a credential file with mode %s",
    async mode => {
      const p = await plan();
      await reference(p);
      await chmod(p.path, mode);
      await expect(read(p)).rejects.toThrow("ARTIFACT_REJECTED");
    }
  );
  it("rejects a hardlinked credential file", async () => {
    const p = await plan();
    await reference(p);
    await link(p.path, join(directory, "copy"));
    await expect(read(p)).rejects.toThrow("ARTIFACT_REJECTED");
  });
  it("rejects a symlink substituted for a credential file", async () => {
    const p = await plan();
    await reference(p);
    const other = join(directory, "other");
    await rename(p.path, other);
    await symlink(other, p.path);
    await expect(read(p)).rejects.toThrow("ARTIFACT_REJECTED");
  });
  it.each([
    { password: "A".repeat(43) },
    { verifier: fixtureVerifier.replace("4096", "4097") },
    { verifier: fixtureVerifier.replace("$Nvk", "$Avk") },
    { unexpected: "field" },
    {
      metadata: {
        ...metadata,
        operationId: "ab51d6d4-fcf8-4f4b-b309-d2bdb94a8c3d",
      },
    },
    {
      metadata: {
        ...metadata,
        executorPreview: {
          ...metadata.executorPreview,
          projectId: "prj_foreign",
        },
      },
    },
    {
      metadata: {
        ...metadata,
        target: { ...metadata.target, caSha256: "d".repeat(64) },
      },
    },
  ])("rejects mismatched material or metadata %#", async patch => {
    const p = await plan();
    await reference(p, patch);
    await expect(read(p)).rejects.toThrow(
      /^CALCULATOR_CREDENTIAL_ARTIFACT_REJECTED$/
    );
  });
  it.each(["", "{", "[]", "null", "x".repeat(8193)])(
    "rejects malformed or oversized bytes %#",
    async value => {
      const p = await plan();
      await writeFile(p.path, value, { mode: 0o600 });
      await expect(read(p)).rejects.toThrow("ARTIFACT_REJECTED");
    }
  );
  it("rejects replacement after opening even if replacement bytes are valid", async () => {
    const p = await plan();
    await reference(p);
    afterFileRead = async () => {
      await rename(p.path, join(directory, "old"));
      await reference(p);
    };
    await expect(read(p)).rejects.toThrow("ARTIFACT_REJECTED");
  });
  it("rejects in-place change while a file is being read", async () => {
    const p = await plan();
    await reference(p);
    afterFileRead = async () => {
      await writeFile(p.path, "x".repeat(8193));
    };
    await expect(read(p)).rejects.toThrow("ARTIFACT_REJECTED");
  });
  it("does not fall back to inherited environment for missing artifacts", async () => {
    const p = await plan();
    vi.stubEnv("PGPASSWORD", fixturePassword);
    try {
      await expect(read(p)).rejects.toThrow("ARTIFACT_REJECTED");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
