/** Separate administrative CLI. Never import this entry point into the web runtime. */
import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { checkServerIdentity } from "node:tls";
import type { PeerCertificate } from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const projectRef = "wmspwegbqtzamkhxhusg";
const directHost = `db.${projectRef}.supabase.co`;
const repository = fileURLToPath(new URL("../", import.meta.url));
const runFile = promisify(execFile);
// Includes the complete local import graph used by the injected administrative paths,
// including its SQL renderer for receipt verification, and dependency resolution.
const sourceFiles = [
  "scripts/homolog-access-runner.ts",
  "scripts/homolog-access-bootstrap.ts",
  "scripts/homolog-access-bootstrap-sql.ts",
  "scripts/homolog-read-proof.ts",
  "server/audit.ts",
  "drizzle/schema.ts",
  "shared/domain/taxonomy.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];
const sourcePaths = [
  "scripts/homolog-access-*",
  "scripts/homolog-read-proof.*",
  "server/audit.*",
  "drizzle/schema.*",
  "shared/domain/taxonomy.*",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];
const configSchema = z
  .object({
    version: z.literal("structr-homolog-admin-connection-v1"),
    projectRef: z.literal(projectRef),
    host: z.literal(directHost),
    port: z.literal(5432),
    database: z.literal("postgres"),
    user: z.literal("postgres"),
    password: z.string().min(1).max(8192),
    caCertificate: z
      .string()
      .max(16384)
      .refine(value => {
        if (
          !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/.test(
            value
          )
        )
          return false;
        try {
          new X509Certificate(value);
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .strict();
class RunnerError extends Error {}
function fail(code: string): never {
  throw new RunnerError(code);
}

async function readInput(path: string, connection: boolean): Promise<unknown> {
  const limit = connection ? 32768 : 65536;
  const prefix = connection ? "HOMOLOG_CONNECTION_CONFIG" : "HOMOLOG_MANIFEST";
  let raw: string;
  try {
    // NONBLOCK allows us to reject a FIFO using fstat instead of waiting on it.
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size > limit ||
        (connection &&
          ((stat.mode & 0o077) !== 0 ||
            !process.getuid ||
            stat.uid !== process.getuid()))
      )
        fail(`${prefix}_UNREADABLE`);
      const buffer = Buffer.alloc(limit + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const next = await file.read(
          buffer,
          bytes,
          buffer.length - bytes,
          bytes
        );
        if (next.bytesRead === 0) break;
        bytes += next.bytesRead;
      }
      if (bytes > limit) fail(`${prefix}_UNREADABLE`);
      raw = buffer.subarray(0, bytes).toString("utf8");
    } finally {
      await file.close();
    }
  } catch {
    fail(`${prefix}_UNREADABLE`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${prefix}_INVALID`);
  }
}
async function verifySource(sourceCommit: string): Promise<void> {
  const git = async (args: string[]) => {
    const result = await runFile(
      "/usr/bin/git",
      ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
      {
        cwd: repository,
        timeout: 10000,
        maxBuffer: 65536,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      }
    );
    return result.stdout.trim();
  };
  try {
    if ((await git(["rev-parse", "HEAD"])) !== sourceCommit)
      fail("HOMOLOG_SOURCE_MISMATCH");
    await git(["ls-files", "--error-unmatch", "--", ...sourceFiles]);
    // Index flags such as assume-unchanged must not hide altered executable bytes.
    const actual = await git([
      "hash-object",
      "--no-filters",
      "--",
      ...sourceFiles,
    ]);
    const reviewed = await git([
      "rev-parse",
      ...sourceFiles.map(path => `HEAD:${path}`),
    ]);
    if (actual !== reviewed) fail("HOMOLOG_SOURCE_DIRTY");
    if (
      await git([
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
        "--",
        ...sourcePaths,
      ])
    )
      fail("HOMOLOG_SOURCE_DIRTY");
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    fail("HOMOLOG_SOURCE_UNVERIFIED");
  }
}

/** Fixed error allowlist: never relay driver, filesystem, input or Git diagnostics. */
export function homologRunnerErrorCode(error: unknown): string {
  const allowed = new Set([
    "HOMOLOG_RUNNER_USAGE",
    "HOMOLOG_RUNNER_FAILED",
    "HOMOLOG_SOURCE_MISMATCH",
    "HOMOLOG_SOURCE_DIRTY",
    "HOMOLOG_SOURCE_UNVERIFIED",
    "HOMOLOG_MANIFEST_UNREADABLE",
    "HOMOLOG_MANIFEST_INVALID",
    "HOMOLOG_CONNECTION_CONFIG_UNREADABLE",
    "HOMOLOG_CONNECTION_CONFIG_INVALID",
    "HOMOLOG_IDENTITY_COLLISION",
    "HOMOLOG_OPERATION_CONFLICT",
    "HOMOLOG_STATE_DRIFT",
    "HOMOLOG_BOOTSTRAP_FAILED",
    "HOMOLOG_READ_MANIFEST_INVALID",
    "HOMOLOG_READ_IDENTITY_CONFLICT",
    "HOMOLOG_READ_COLLISION",
    "HOMOLOG_READ_OPERATION_CONFLICT",
    "HOMOLOG_READ_STATE_DRIFT",
    "HOMOLOG_READ_WITHDRAWN",
    "HOMOLOG_READ_FAILED",
    "HOMOLOG_CYCLE_MANIFEST_INVALID",
    "HOMOLOG_CYCLE_OPERATION_CONFLICT",
    "HOMOLOG_CYCLE_STATE_DRIFT",
    "HOMOLOG_CYCLE_WITHDRAWN",
    "HOMOLOG_CYCLE_FAILED",
    "HOMOLOG_DATABASE_TARGET_REFUSED",
    "HOMOLOG_CONNECTION_CLOSE_FAILED",
  ]);
  return error instanceof Error && allowed.has(error.message)
    ? error.message
    : "HOMOLOG_RUNNER_FAILED";
}
export async function runHomologAccess(args: string[]) {
  if (
    args.length !== 3 ||
    ![
      "preflight",
      "apply",
      "read-proof-preflight",
      "read-proof-create",
      "read-proof-withdraw",
      "identity-cycle-preflight",
      "identity-cycle-reactivate",
      "identity-cycle-withdraw",
    ].includes(args[0])
  )
    fail("HOMOLOG_RUNNER_USAGE");
  const value = await readInput(args[1], false);
  const reference = z
    .object({ sourceCommit: z.string().regex(/^[0-9a-f]{40}$/) })
    .safeParse(value);
  if (!reference.success) fail("HOMOLOG_MANIFEST_INVALID");
  await verifySource(reference.data.sourceCommit);
  // Do not load the privileged local dependency graph before checking its source.
  let plan:
    | ReturnType<typeof import("./homolog-access-bootstrap").planHomologAccess>
    | ReturnType<typeof import("./homolog-read-proof").planHomologReadProof>
    | ReturnType<
        typeof import("./homolog-read-proof").planHomologIdentityCycle
      >;
  let execute: (db: PostgresJsDatabase) => Promise<typeof plan>;
  if (args[0].startsWith("identity-cycle-")) {
    const {
      parseHomologIdentityCycleManifest,
      planHomologIdentityCycle,
      reactivateHomologReadProofIdentities,
      withdrawHomologReadProofIdentities,
    } = await import("./homolog-read-proof");
    const manifest = parseHomologIdentityCycleManifest(value);
    plan = planHomologIdentityCycle(manifest);
    execute = db =>
      args[0] === "identity-cycle-withdraw"
        ? withdrawHomologReadProofIdentities(db, manifest)
        : reactivateHomologReadProofIdentities(db, manifest);
  } else if (args[0].startsWith("read-proof-")) {
    const {
      parseHomologReadProofManifest,
      planHomologReadProof,
      provisionHomologReadProof,
      withdrawHomologReadProof,
    } = await import("./homolog-read-proof");
    // The outer reference binds this executor. The nested identity manifest binds
    // historical bootstrap evidence and must retain its original source commit.
    const manifest = parseHomologReadProofManifest(value);
    plan = planHomologReadProof(manifest);
    execute = db =>
      args[0] === "read-proof-withdraw"
        ? withdrawHomologReadProof(db, manifest)
        : provisionHomologReadProof(db, manifest);
  } else {
    const {
      bootstrapHomologAccess,
      parseHomologAccessManifest,
      planHomologAccess,
    } = await import("./homolog-access-bootstrap");
    const manifest = parseHomologAccessManifest(value);
    plan = planHomologAccess(manifest);
    execute = db => bootstrapHomologAccess(db, manifest);
  }
  const config = configSchema.safeParse(await readInput(args[2], true));
  if (!config.success) fail("HOMOLOG_CONNECTION_CONFIG_INVALID");
  const summary = {
    ...plan,
    sourceCommit: reference.data.sourceCommit,
    projectRef,
    sourceVerified: true,
  };
  if (
    args[0] === "preflight" ||
    args[0] === "read-proof-preflight" ||
    args[0] === "identity-cycle-preflight"
  )
    return { ...summary, status: "preflight" };
  const result = await withVerifiedDatabase(config.data, execute);
  return {
    ...summary,
    ...result,
    databaseTargetVerified: true,
    targetVerification: "direct-host-verified-tls",
  };
}

async function withVerifiedDatabase<T>(
  connection: z.infer<typeof configSchema>,
  execute: (db: PostgresJsDatabase) => Promise<T>
): Promise<T> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  let client: ReturnType<typeof postgres> | undefined;
  try {
    const options = {
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      // Explicit options prevent postgres.js from inheriting PG* connection policy.
      max: 1,
      sslnegotiation: null,
      prepare: false,
      debug: false,
      fetch_types: false,
      idle_timeout: 0,
      connect_timeout: 10,
      max_lifetime: 0,
      max_pipeline: 1,
      backoff: false,
      keep_alive: 30,
      publications: "alltables",
      target_session_attrs: "read-write" as const,
      ssl: {
        rejectUnauthorized: true,
        servername: directHost,
        ...(connection.caCertificate ? { ca: connection.caCertificate } : {}),
        checkServerIdentity: (host: string, certificate: PeerCertificate) =>
          host === directHost
            ? checkServerIdentity(directHost, certificate)
            : new Error("HOMOLOG_DATABASE_TARGET_REFUSED"),
      },
      connection: {
        application_name: "structr-homolog-administrative-runner",
        TimeZone: "UTC",
        statement_timeout: 60000,
        lock_timeout: 10000,
        idle_in_transaction_session_timeout: 15000,
      },
      onnotice: () => undefined,
    };
    client = postgres(options);
    // TLS verifies the one configured direct hostname and its certificate chain.
    // Database identity/read-write checks supplement, rather than replace, that binding.
    const [identity] = await client`SELECT current_database() AS database,
      current_setting('transaction_read_only') AS read_only`;
    if (identity?.database !== "postgres" || identity?.read_only !== "off")
      fail("HOMOLOG_DATABASE_TARGET_REFUSED");
    return await execute(drizzle(client));
  } catch (error) {
    return fail(homologRunnerErrorCode(error));
  } finally {
    if (client) {
      try {
        await client.end({ timeout: 5 });
      } catch {
        fail("HOMOLOG_CONNECTION_CLOSE_FAILED");
      }
    }
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runHomologAccess(process.argv.slice(2))
    .then(result => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch(error => {
      process.stderr.write(`${homologRunnerErrorCode(error)}\n`);
      process.exitCode = 2;
    });
}
