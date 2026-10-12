/** Explicit local staging only. No import-time I/O, environment or cloud client.
 * Public source/pins identities never hash password or verifier material.
 */
import { lstat, realpath, open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { constants, type Stats } from "node:fs";
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { inspect } from "node:util";
import { z } from "zod";

const metadataSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid().refine(v => v === v.toLowerCase()),
    generationId: z.uuid().refine(v => v === v.toLowerCase()),
    fixtureOperationId: z.uuid().refine(v => v === v.toLowerCase()),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    sourcePinsSha256: z.string().regex(/^[0-9a-f]{64}$/),
    role: z.literal("structr_calculator_login_v1"),
    target: z
      .object({
        host: z.string().regex(/^db\.[a-z0-9]{1,63}\.supabase\.co$/),
        port: z.literal(5432),
        database: z.literal("postgres"),
        caSha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    executorPreview: z
      .object({
        teamId: z.string().regex(/^team_[A-Za-z0-9]{1,100}$/),
        projectId: z.string().regex(/^prj_[A-Za-z0-9]{1,100}$/),
        environment: z.literal("preview"),
      })
      .strict(),
  })
  .strict()
  .refine(
    v =>
      new Set([v.operationId, v.generationId, v.fixtureOperationId]).size === 3
  );
type ParsedMetadata = z.infer<typeof metadataSchema>;
export type CalculatorCredentialMetadata = Readonly<
  Omit<ParsedMetadata, "target" | "executorPreview">
> & {
  readonly target: Readonly<ParsedMetadata["target"]>;
  readonly executorPreview: Readonly<ParsedMetadata["executorPreview"]>;
};
export interface CalculatorCredentialArtifactPlan {
  readonly directory: string;
  readonly path: string;
  readonly metadata: CalculatorCredentialMetadata;
}
function reject(): never {
  throw new Error("CALCULATOR_CREDENTIAL_ARTIFACT_REJECTED");
}
function publicMetadata(value: unknown): CalculatorCredentialMetadata {
  const parsed = metadataSchema.safeParse(value);
  if (!parsed.success) reject();
  Object.freeze(parsed.data.target);
  Object.freeze(parsed.data.executorPreview);
  return Object.freeze(parsed.data);
}
async function privateDirectory(path: string) {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    (await realpath(path)) !== path
  )
    reject();
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o7777) !== 0o700
  )
    reject();
  return stat;
}
export async function planCalculatorCredentialArtifact(input: {
  readonly directory: string;
  readonly metadata: unknown;
}): Promise<CalculatorCredentialArtifactPlan> {
  try {
    const metadata = publicMetadata(input.metadata);
    await privateDirectory(input.directory);
    return Object.freeze({
      directory: input.directory,
      path: join(input.directory, `${metadata.generationId}.credential.json`),
      metadata,
    });
  } catch {
    reject();
  }
}

export interface CalculatorCredentialSecret {
  readonly password: string;
  readonly verifier: string;
}
export interface CalculatorCredentialArtifact {
  readonly metadata: CalculatorCredentialMetadata;
  readonly path: string;
  /** Deliberate authority boundary. Caller must keep material out of logs/returns.
   * Strings cannot be reliably erased by JavaScript; retain only as necessary.
   */
  withSecret<T>(
    callback: (secret: CalculatorCredentialSecret) => T | Promise<T>
  ): Promise<T>;
}
const MAX_BYTES = 8192;
const storedSchema = z
  .object({
    metadata: metadataSchema,
    password: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    verifier: z
      .string()
      .regex(
        /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=[:][A-Za-z0-9+/]{43}=$/
      ),
  })
  .strict();
function verifier(password: string, salt: Buffer): string {
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const client = createHmac("sha256", salted).update("Client Key").digest();
  const stored = createHash("sha256").update(client).digest();
  const server = createHmac("sha256", salted).update("Server Key").digest();
  try {
    return `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored.toString("base64")}:${server.toString("base64")}`;
  } finally {
    salted.fill(0);
    client.fill(0);
    stored.fill(0);
    server.fill(0);
  }
}
function privateFile(s: Stats): boolean {
  return (
    s.isFile() &&
    s.uid === process.getuid?.() &&
    s.nlink === 1 &&
    (s.mode & 0o7777) === 0o600 &&
    s.size >= 1 &&
    s.size <= MAX_BYTES
  );
}
function sameInode(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
function sameFile(a: Stats, b: Stats): boolean {
  return (
    sameInode(a, b) &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
async function validatedPlan(input: CalculatorCredentialArtifactPlan) {
  const p = await planCalculatorCredentialArtifact({
    directory: input.directory,
    metadata: input.metadata,
  });
  if (
    p.path !== input.path ||
    Object.keys(input).sort().join(",") !== "directory,metadata,path"
  )
    reject();
  return p;
}
function wrap(
  p: CalculatorCredentialArtifactPlan,
  password: string,
  hash: string
): CalculatorCredentialArtifact {
  const secret = Object.freeze(
    Object.defineProperties(
      {},
      {
        password: { value: password },
        verifier: { value: hash },
        toJSON: { value: () => "[REDACTED]" },
        [inspect.custom]: {
          value: () => "CalculatorCredentialSecret [REDACTED]",
        },
      }
    )
  ) as CalculatorCredentialSecret;
  return Object.freeze({
    metadata: p.metadata,
    path: p.path,
    async withSecret<T>(
      callback: (s: CalculatorCredentialSecret) => T | Promise<T>
    ): Promise<T> {
      try {
        return await callback(secret);
      } catch {
        reject();
      }
    },
    toJSON: () => ({ metadata: p.metadata, path: p.path }),
    [inspect.custom]: () => ({ metadata: p.metadata, path: p.path }),
  });
}
/** Reads exactly one bounded, stable, private generation; never environment. */
export async function readCalculatorCredentialArtifact(
  input: CalculatorCredentialArtifactPlan
): Promise<CalculatorCredentialArtifact> {
  try {
    const p = await validatedPlan(input),
      parent = await privateDirectory(p.directory);
    if ((await realpath(p.path)) !== p.path) reject();
    const handle = await open(
      p.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    try {
      const before = await handle.stat();
      if (!privateFile(before)) reject();
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(
          bytes,
          length,
          bytes.length - length,
          length
        );
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      const after = await handle.stat(),
        named = await lstat(p.path);
      if (
        !privateFile(after) ||
        !privateFile(named) ||
        !sameFile(before, after) ||
        !sameFile(before, named) ||
        before.size !== length ||
        (await realpath(p.path)) !== p.path ||
        !sameInode(parent, await privateDirectory(p.directory))
      )
        reject();
      const parsed = storedSchema.safeParse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, length)
          )
        )
      );
      if (!parsed.success) reject();
      const data = parsed.data;
      if (
        JSON.stringify(publicMetadata(data.metadata)) !==
        JSON.stringify(p.metadata)
      )
        reject();
      const passwordBytes = Buffer.from(data.password, "base64url"),
        saltText = data.verifier.split("$")[1].split(":")[1],
        salt = Buffer.from(saltText, "base64");
      try {
        if (
          passwordBytes.length !== 32 ||
          passwordBytes.toString("base64url") !== data.password ||
          salt.length !== 16 ||
          salt.toString("base64") !== saltText
        )
          reject();
        const calculated = Buffer.from(verifier(data.password, salt)),
          received = Buffer.from(data.verifier);
        try {
          if (
            calculated.length !== received.length ||
            !timingSafeEqual(calculated, received)
          )
            reject();
        } finally {
          calculated.fill(0);
          received.fill(0);
        }
        return wrap(p, data.password, data.verifier);
      } finally {
        passwordBytes.fill(0);
        salt.fill(0);
      }
    } finally {
      bytes.fill(0);
      await handle.close();
    }
  } catch {
    reject();
  }
}
/** Call only at the explicitly approved generation step. Exclusive write is
 * synced before returning and before any caller can perform database work.
 * Failed/uncertain stages are preserved: never delete or blindly overwrite.
 */
export async function stageCalculatorCredentialArtifact(
  input: CalculatorCredentialArtifactPlan
): Promise<CalculatorCredentialArtifact> {
  try {
    const p = await validatedPlan(input),
      parent = await privateDirectory(p.directory);
    const handle = await open(
      p.path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600
    );
    try {
      const created = await handle.stat(),
        named = await lstat(p.path);
      if (
        !created.isFile() ||
        created.uid !== process.getuid?.() ||
        created.nlink !== 1 ||
        (created.mode & 0o7777) !== 0o600 ||
        !sameInode(created, named) ||
        (await realpath(p.path)) !== p.path ||
        !sameInode(parent, await privateDirectory(p.directory))
      )
        reject();
      const random = randomBytes(32),
        salt = randomBytes(16);
      let bytes: Buffer | undefined;
      try {
        const password = random.toString("base64url");
        bytes = Buffer.from(
          JSON.stringify({
            metadata: p.metadata,
            password,
            verifier: verifier(password, salt),
          }) + "\n"
        );
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        random.fill(0);
        salt.fill(0);
        bytes?.fill(0);
      }
      const after = await handle.stat(),
        current = await lstat(p.path);
      if (
        !privateFile(after) ||
        !privateFile(current) ||
        !sameInode(created, after) ||
        !sameFile(after, current) ||
        (await realpath(p.path)) !== p.path ||
        !sameInode(parent, await privateDirectory(p.directory))
      )
        reject();
      const dir = await open(
        p.directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      try {
        if (!sameInode(parent, await dir.stat())) reject();
        await dir.sync();
      } finally {
        await dir.close();
      }
      const artifact = await readCalculatorCredentialArtifact(p);
      if (
        !sameFile(after, await lstat(p.path)) ||
        !sameInode(parent, await privateDirectory(p.directory))
      )
        reject();
      return artifact;
    } finally {
      await handle.close();
    }
  } catch {
    reject();
  }
}
