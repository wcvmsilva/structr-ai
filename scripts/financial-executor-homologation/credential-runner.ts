/** Fixed one-shot administrative entry. No credential values in argv, env or IPC.
 * Each invocation owns a fresh connection. A failed process is an uncertain result;
 * the operator invokes recovery separately and never automatically resends writes.
 */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  CalculatorAdminConnection,
  CalculatorAdminConnectionInput,
} from "./connection";
const absolute = z.string().refine(v => isAbsolute(v) && resolve(v) === v);
const artifactPlanSchema = z
  .object({ directory: absolute, path: absolute, metadata: z.unknown() })
  .strict();
const common = {
  manifest: z.unknown(),
  adminSecretFile: absolute,
  caFile: absolute,
};
const commandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...common,
      operation: z.literal("provision"),
      artifactPlan: artifactPlanSchema,
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("replace"),
      artifactPlan: artifactPlanSchema,
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("recover"),
      admissionExpiresAt: z.iso.datetime(),
    })
    .strict(),
]);
async function privateCommand(path: string) {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    (await realpath(path)) !== path
  )
    throw new Error();
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  const buffer = Buffer.alloc(65537);
  try {
    const before = await file.stat();
    const privateFile = (s: typeof before) =>
      s.isFile() &&
      s.uid === process.getuid?.() &&
      s.nlink === 1 &&
      [0o400, 0o600].includes(s.mode & 0o7777) &&
      s.size > 0 &&
      s.size <= 65536;
    if (!privateFile(before)) throw new Error();
    let length = 0;
    while (length < buffer.length) {
      const r = await file.read(buffer, length, buffer.length - length, length);
      if (r.bytesRead === 0) break;
      length += r.bytesRead;
    }
    const after = await file.stat(),
      named = await lstat(path);
    if (
      !privateFile(after) ||
      !privateFile(named) ||
      before.size !== length ||
      [after, named].some(
        s =>
          s.dev !== before.dev ||
          s.ino !== before.ino ||
          s.size !== before.size ||
          s.mtimeMs !== before.mtimeMs ||
          s.ctimeMs !== before.ctimeMs
      ) ||
      (await realpath(path)) !== path
    )
      throw new Error();
    return commandSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length)
        )
      )
    );
  } finally {
    buffer.fill(0);
    await file.close();
  }
}
/** Trusted external transport seam for owned physical proof, never selectable from
 * the CLI command, argv flag or environment. Production always uses pinned TLS. */
export interface CalculatorCredentialProcessDependencies {
  openConnection?: (
    input: CalculatorAdminConnectionInput
  ) => Promise<CalculatorAdminConnection>;
}
export async function runCalculatorCredentialProcess(
  commandFile: string,
  dependencies: CalculatorCredentialProcessDependencies = {}
): Promise<never> {
  // Install before loading any database module. Catching a Promise cannot contain
  // the driver's asynchronous fatal-socket exception. Never inspect its object.
  const uncertain = () => {
    process.stdout.write('{"status":"uncertain"}\n', () => process.exit(70));
  };
  process.stdout.on("error", () => process.exit(70));
  process.stderr.on("error", () => process.exit(70));
  process.on("uncaughtException", uncertain);
  process.on("unhandledRejection", uncertain);
  process.on("SIGINT", uncertain);
  process.on("SIGTERM", uncertain);
  const deadline = setTimeout(uncertain, 45000);
  try {
    const command = await privateCommand(commandFile);
    // Recovery is a short read admission independent of the historical pilot.
    // Mutating schemas reject this field and retain the original fixture expiry.
    if (command.operation === "recover") {
      const now = Date.now(),
        expires = Date.parse(command.admissionExpiresAt);
      if (
        !Number.isFinite(expires) ||
        expires <= now ||
        expires > now + 15 * 60 * 1000
      )
        throw new Error();
    }
    const { parseCalculatorCredentialManifest } = await import(
      "./credential-receipt"
    );
    const manifest = parseCalculatorCredentialManifest(command.manifest);
    let artifactPlan;
    if (command.operation !== "recover") {
      const { planCalculatorCredentialArtifact } = await import(
        "./credential-artifact"
      );
      const { canonical } = await import("./contract");
      artifactPlan = await planCalculatorCredentialArtifact({
        directory: command.artifactPlan.directory,
        metadata: manifest.metadata,
      });
      if (
        command.artifactPlan.path !== artifactPlan.path ||
        canonical(command.artifactPlan.metadata) !==
          canonical(manifest.metadata)
      )
        throw new Error();
    }
    const { openCalculatorAdminConnection } = await import("./connection");
    const connection = await (
      dependencies.openConnection ?? openCalculatorAdminConnection
    )({
      secretFile: command.adminSecretFile,
      caFile: command.caFile,
      expiresAt:
        command.operation === "recover"
          ? command.admissionExpiresAt
          : manifest.fixture.window.closesAt,
      expected: {
        ...manifest.metadata.target,
        principal: manifest.fixture.expectedPrincipal,
      },
    });
    let result;
    try {
      const lifecycle = await import("./credential");
      result =
        command.operation === "recover"
          ? await lifecycle.recoverCalculatorCredential(
              connection.database,
              manifest
            )
          : await (
              command.operation === "provision"
                ? lifecycle.provisionCalculatorCredential
                : lifecycle.replaceClosedCalculatorCredential
            )(connection.database, manifest, artifactPlan!);
    } finally {
      await connection.close();
    }
    const publicResult = z
      .discriminatedUnion("status", [
        z
          .object({
            status: z.literal("committed"),
            operationId: z.uuid(),
            generationId: z.uuid(),
            receiptId: z.uuid(),
          })
          .strict(),
        z
          .object({
            status: z.literal("not_observed"),
            operationId: z.uuid(),
            generationId: z.uuid(),
          })
          .strict(),
      ])
      .parse(result);
    clearTimeout(deadline);
    await new Promise<never>(() => {
      process.stdout.write(JSON.stringify(publicResult) + "\n", () =>
        process.exit(0)
      );
    });
    throw new Error();
  } catch {
    uncertain();
    return await new Promise<never>(() => {});
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Only one protected command-file path is accepted. No connection arguments,
  // secrets, alternate scripts, test switches or automatic repeat are available.
  if (process.argv.length !== 3) process.exit(70);
  await runCalculatorCredentialProcess(process.argv[2]);
}
