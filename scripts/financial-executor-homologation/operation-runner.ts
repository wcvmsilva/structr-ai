/** One-shot administrative composition. Each invocation has one protected command,
 * a fresh nominal connection and no credential creation, retry or environment fallback.
 * Operational source admission is reviewed separately from the frozen source manifest.
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
const absolute = z
  .string()
  .refine(value => isAbsolute(value) && resolve(value) === value);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== "00000000-0000-0000-0000-000000000000");
const target = z
  .object({
    host: z.string().regex(/^db\.[a-z0-9]+\.supabase\.co$/),
    port: z.literal(5432),
    database: z.literal("postgres"),
    principal: z.literal("postgres"),
    caSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const common = {
  manifest: z.unknown(),
  adminSecretFile: absolute,
  caFile: absolute,
  target,
  admissionExpiresAt: z.iso.datetime(),
};
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("temp") }).strict(),
  z.object({ ...common, operation: z.literal("install") }).strict(),
  z.object({ ...common, operation: z.literal("recover-install") }).strict(),
  z.object({ ...common, operation: z.literal("preflight") }).strict(),
  z.object({ ...common, operation: z.literal("prepare") }).strict(),
  z
    .object({
      ...common,
      operation: z.literal("open"),
      credential: z.object({ receiptId: uuid, generationId: uuid }).strict(),
    })
    .strict(),
  z.object({ ...common, operation: z.literal("deactivate") }).strict(),
  z.object({ ...common, operation: z.literal("withdraw") }).strict(),
]);
const tempManifestSchema = z
  .object({
    version: z.literal("calculator-temp-containment-v1"),
    operationId: z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    expectedDatabase: z.literal("postgres"),
    expectedPrincipal: z.literal("postgres"),
  })
  .strict();
function reject(): never {
  throw new Error("CALCULATOR_OPERATION_COMMAND_REJECTED");
}
/** Validate phase authority and its entire domain manifest before opening transport.
 * Admission permits this new administrative process only; it does not extend the
 * business window or substitute for the helpers' database-clock checks.
 */
export async function parseCalculatorOperationCommand(
  value: unknown,
  nowMs = Date.now()
) {
  try {
    const command = commandSchema.parse(value),
      expires = Date.parse(command.admissionExpiresAt);
    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(expires) ||
      expires <= nowMs ||
      expires > nowMs + 15 * 60 * 1000
    )
      reject();
    if (command.operation === "temp")
      return {
        ...command,
        manifest: tempManifestSchema.parse(command.manifest),
      };
    if (
      command.operation === "install" ||
      command.operation === "recover-install"
    ) {
      const { parseCalculatorInstallManifest } = await import("./installer");
      return {
        ...command,
        manifest: parseCalculatorInstallManifest(command.manifest),
      };
    }
    if (command.operation === "preflight") {
      const { parseCalculatorHomologationManifest } = await import(
        "./contract"
      );
      const manifest = parseCalculatorHomologationManifest(command.manifest);
      if (
        manifest.expectedPrincipal !== command.target.principal ||
        manifest.expectedDatabase !== command.target.database
      )
        reject();
      return { ...command, manifest };
    }
    const { parseCalculatorCoordinationManifest } = await import(
      "./orchestration-contract"
    );
    const manifest = parseCalculatorCoordinationManifest(command.manifest);
    if (
      manifest.fixture.expectedPrincipal !== command.target.principal ||
      manifest.fixture.expectedDatabase !== command.target.database
    )
      reject();
    return { ...command, manifest };
  } catch {
    return reject();
  }
}
/** No secret values are accepted in the command. Its identity mapping is still
 * private and must be canonical, owner-only, single-link and stable during read.
 */
export async function readCalculatorOperationCommand(
  path: string,
  nowMs = Date.now()
) {
  try {
    if (
      !isAbsolute(path) ||
      resolve(path) !== path ||
      (await realpath(path)) !== path
    )
      reject();
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const buffer = Buffer.alloc(65537);
    try {
      const before = await file.stat();
      const privateFile = (stat: typeof before) =>
        stat.isFile() &&
        stat.uid === process.getuid?.() &&
        stat.nlink === 1 &&
        [0o400, 0o600].includes(stat.mode & 0o7777) &&
        stat.size > 0 &&
        stat.size <= 65536;
      if (!privateFile(before)) reject();
      let length = 0;
      while (length < buffer.length) {
        const part = await file.read(
          buffer,
          length,
          buffer.length - length,
          length
        );
        if (part.bytesRead === 0) break;
        length += part.bytesRead;
      }
      const after = await file.stat(),
        named = await lstat(path);
      if (
        !privateFile(after) ||
        !privateFile(named) ||
        before.size !== length ||
        [after, named].some(
          stat =>
            stat.dev !== before.dev ||
            stat.ino !== before.ino ||
            stat.size !== before.size ||
            stat.mtimeMs !== before.mtimeMs ||
            stat.ctimeMs !== before.ctimeMs
        ) ||
        (await realpath(path)) !== path
      )
        reject();
      return await parseCalculatorOperationCommand(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(0, length)
          )
        ),
        nowMs
      );
    } finally {
      buffer.fill(0);
      await file.close();
    }
  } catch {
    return reject();
  }
}
/** Trusted owned-process transport seam, unavailable to command JSON/argv/env. */
export interface CalculatorOperationProcessDependencies {
  openConnection?: (
    input: CalculatorAdminConnectionInput
  ) => Promise<CalculatorAdminConnection>;
}
type Command = Awaited<ReturnType<typeof parseCalculatorOperationCommand>>;
const pairedReceipts = z
  .object({ fixture: uuid.nullable(), rbac: uuid.nullable() })
  .strict();
const preparedReceipts = z.object({ fixture: uuid, rbac: uuid }).strict();
const failedCoordination = z.object({
  status: z.enum(["compensated", "cleanup_pending"]),
  receipts: pairedReceipts,
  rbacRestored: z.boolean(),
  hostedReady: z.literal(false),
});
/** Select only known public evidence. Never serialize full helper results, manifests,
 * database snapshots, exceptions, target paths or credential material. */
function publicResult(command: Command, result: unknown) {
  const operationId =
    "fixture" in command.manifest
      ? command.manifest.fixture.operationId
      : command.manifest.operationId;
  let evidence: { status: string; [key: string]: unknown };
  switch (command.operation) {
    case "temp":
      evidence = { status: "committed", receiptId: uuid.parse(result) };
      break;
    case "install": {
      const parsed = z
        .object({
          status: z.literal("committed"),
          operationId: uuid,
          receiptId: uuid,
        })
        .parse(result);
      if (parsed.operationId !== operationId) reject();
      evidence = parsed;
      break;
    }
    case "recover-install": {
      const parsed = z
        .discriminatedUnion("status", [
          z.object({ status: z.literal("not_observed"), operationId: uuid }),
          z.object({
            status: z.literal("committed"),
            operationId: uuid,
            receiptId: uuid,
            currentMatchesInstalledSnapshot: z.boolean(),
          }),
        ])
        .parse(result);
      if (parsed.operationId !== operationId) reject();
      evidence = parsed;
      break;
    }
    case "preflight": {
      const parsed = z
        .object({
          status: z.literal("preflight_passed"),
          operationId: uuid,
          hostedReady: z.literal(false),
        })
        .parse(result);
      if (parsed.operationId !== operationId) reject();
      evidence = parsed;
      break;
    }
    case "prepare":
      evidence = z
        .union([
          z.object({
            status: z.literal("prepared"),
            receipts: preparedReceipts,
            hostedReady: z.literal(false),
          }),
          failedCoordination,
        ])
        .parse(result);
      break;
    case "open":
      evidence = z
        .union([
          z.object({
            status: z.literal("opened"),
            receipts: preparedReceipts,
            openReceiptId: uuid,
            hostedReady: z.literal(false),
          }),
          failedCoordination,
        ])
        .parse(result);
      break;
    case "deactivate":
      evidence = z
        .object({
          status: z.literal("deactivated"),
          receiptId: uuid,
          receipts: preparedReceipts,
          bindingTerminal: z.literal(true),
          hostedReady: z.literal(false),
        })
        .parse(result);
      break;
    case "withdraw":
      evidence = z
        .object({
          status: z.enum(["withdrawn", "cleanup_pending"]),
          receipts: pairedReceipts,
          rbacRestored: z.boolean(),
          hostedReady: z.literal(false),
          financial: z
            .object({
              status: z.enum(["withdrawn", "cleanup_pending"]),
              receiptId: uuid,
              bindingTerminal: z.literal(true),
              loginClosed: z.literal(true),
              remainingSessions: z.number().int().nonnegative().nullable(),
              cleanupReason: z
                .enum([
                  "sessions_remaining",
                  "session_identity_unavailable",
                  "session_cleanup_failed",
                ])
                .nullable(),
            })
            .nullable(),
        })
        .parse(result);
      break;
  }
  return { operation: command.operation, operationId, ...evidence };
}
async function performOperation(
  connection: CalculatorAdminConnection,
  command: Command
) {
  switch (command.operation) {
    case "temp":
      return (
        await import("./temp-containment")
      ).applyCalculatorDatabaseTempContainment(
        connection.database,
        command.manifest.operationId
      );
    case "install":
      return (await import("./installer")).installCalculatorBoundary(
        connection.database,
        command.manifest
      );
    case "recover-install":
      return (await import("./installer")).recoverCalculatorBoundaryInstall(
        connection.database,
        command.manifest
      );
    case "preflight":
      return (await import("./admin")).preflightCalculatorHomologation(
        connection.database,
        command.manifest
      );
    case "prepare":
      return (await import("./orchestration")).prepareCalculatorPilot(
        connection.database,
        command.manifest
      );
    case "open":
      return (await import("./orchestration")).openCalculatorPilot(
        connection.database,
        command.manifest,
        command.credential
      );
    case "deactivate":
      return (await import("./orchestration")).deactivateCalculatorPilot(
        connection.database,
        command.manifest
      );
    case "withdraw":
      return (await import("./orchestration")).withdrawCalculatorPilot(
        connection.database,
        command.manifest
      );
  }
}
export async function runCalculatorOperationProcess(
  commandFile: string,
  dependencies: CalculatorOperationProcessDependencies = {}
): Promise<never> {
  let connection: CalculatorAdminConnection | undefined,
    closePromise: Promise<void> | undefined,
    exiting = false;
  const close = () =>
    connection ? (closePromise ??= connection.close()) : Promise.resolve();
  const forever = () => new Promise<never>(() => {});
  const uncertain = async (): Promise<never> => {
    if (exiting) return await forever();
    exiting = true;
    clearTimeout(deadline);
    // An unusable socket must not prevent termination or print its exception.
    setTimeout(() => process.exit(70), 2500);
    try {
      await close();
    } catch {
      /* still uncertain; never emit underlying errors */
    }
    return await new Promise<never>(() =>
      process.stdout.write('{"status":"uncertain"}\n', () => process.exit(70))
    );
  };
  // These guards precede every dynamic database import, including manifest helpers.
  process.stdout.on("error", () => process.exit(70));
  process.stderr.on("error", () => process.exit(70));
  process.on("uncaughtException", () => {
    void uncertain();
  });
  process.on("unhandledRejection", () => {
    void uncertain();
  });
  process.on("SIGINT", () => {
    void uncertain();
  });
  process.on("SIGTERM", () => {
    void uncertain();
  });
  const deadline = setTimeout(() => {
    void uncertain();
  }, 45000);
  try {
    const command = await readCalculatorOperationCommand(commandFile);
    const { openCalculatorAdminConnection } = await import("./connection");
    if (exiting) return await forever();
    connection = await (
      dependencies.openConnection ?? openCalculatorAdminConnection
    )({
      secretFile: command.adminSecretFile,
      caFile: command.caFile,
      expected: command.target,
      expiresAt: command.admissionExpiresAt,
    });
    if (exiting) {
      await close();
      return await forever();
    }
    let result: unknown;
    try {
      result = await performOperation(connection, command);
    } finally {
      await close();
    }
    if (exiting) return await forever();
    const output = publicResult(command, result);
    const status = output.status;
    const code =
      status === "cleanup_pending" || status === "compensated" ? 2 : 0;
    clearTimeout(deadline);
    exiting = true;
    return await new Promise<never>(() =>
      process.stdout.write(JSON.stringify(output) + "\n", () =>
        process.exit(code)
      )
    );
  } catch {
    return await uncertain();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    process.stdout.write('{"status":"uncertain"}\n', () => process.exit(70));
  else await runCalculatorOperationProcess(process.argv[2]);
}
