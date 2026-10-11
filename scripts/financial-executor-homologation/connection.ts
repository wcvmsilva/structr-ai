/** Protected operational connection candidate. Importing this file performs no I/O.
 * A reviewed composition caller supplies pins, admission window and private file.
 * This administrative handle never enters the executor or web runtime.
 */
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { validatePinnedPostgresCa } from "../../shared/financial-executor-tls";

const target = z
  .object({
    host: z.string().regex(/^db\.[a-z0-9]+\.supabase\.co$/),
    port: z.literal(5432),
    database: z.literal("postgres"),
    caSha256: z.string().regex(/^[0-9a-f]{64}$/),
    principal: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  })
  .strict();
const credential = z
  .object({
    host: z.string(),
    port: z.literal(5432),
    database: z.literal("postgres"),
    username: z.string(),
    password: z
      .string()
      .min(1)
      .max(16384)
      .refine(v => !/[\u0000-\u001f\u007f]/.test(v)),
  })
  .strict();
export interface CalculatorAdminConnectionInput {
  readonly secretFile: string;
  /** Public reviewed CA artifact, independently pinned by exact PEM byte digest. */
  readonly caFile: string;
  readonly expected: z.infer<typeof target>;
  /** Admission guard only: it neither expires nor terminates existing sessions. */
  readonly expiresAt: string;
  readonly nowMs?: () => number;
}
export interface CalculatorAdminConnection {
  readonly database: PostgresJsDatabase;
  close(): Promise<void>;
}
export interface CalculatorAdminConnectionDependencies {
  /** External transport seam. Production defaults to the pinned postgres driver. */
  createClient?: (options: postgres.Options<{}>) => postgres.Sql<{}>;
}
function reject(): never {
  throw new Error("CALCULATOR_HOMOLOGATION_CONNECTION_REJECTED");
}
async function privateCredential(path: string) {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    (await realpath(path)) !== path
  )
    reject();
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const before = await handle.stat();
    const privateRegularFile = (stat: typeof before) =>
      stat.isFile() &&
      stat.uid === process.getuid?.() &&
      stat.nlink === 1 &&
      [0o400, 0o600].includes(stat.mode & 0o7777) &&
      stat.size >= 1 &&
      stat.size <= 65536;
    if (!privateRegularFile(before)) reject();
    const bytes = await handle.readFile();
    try {
      const after = await handle.stat(),
        named = await lstat(path);
      if (
        !privateRegularFile(after) ||
        !privateRegularFile(named) ||
        (await realpath(path)) !== path ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.dev !== named.dev ||
        before.ino !== named.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        before.size !== bytes.length
      )
        reject();
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const parsed = credential.safeParse(JSON.parse(source));
      if (!parsed.success) reject();
      return parsed.data;
    } finally {
      bytes.fill(0);
    }
  } finally {
    await handle.close();
  }
}

export async function openCalculatorAdminConnection(
  input: CalculatorAdminConnectionInput,
  dependencies: CalculatorAdminConnectionDependencies = {}
): Promise<CalculatorAdminConnection> {
  let client: postgres.Sql<{}> | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        if (client) await client.end({ timeout: 1 });
      } catch {
        reject();
      }
    })());
  try {
    const pins = target.safeParse(input.expected),
      expiry = z.string().datetime().safeParse(input.expiresAt);
    if (!pins.success || !expiry.success) reject();
    const nowMs = input.nowMs ?? Date.now;
    const validAdmission = () => {
      const now = nowMs();
      if (!Number.isFinite(now) || now >= Date.parse(expiry.data)) reject();
    };
    validAdmission();
    if (!isAbsolute(input.caFile)) reject();
    const ca = validatePinnedPostgresCa(
      await readFile(input.caFile, "utf8"),
      pins.data.caSha256
    );
    const secret = await privateCredential(input.secretFile);
    if (
      secret.host !== pins.data.host ||
      secret.port !== pins.data.port ||
      secret.database !== pins.data.database ||
      secret.username !== pins.data.principal
    )
      reject();
    const options: postgres.Options<{}> = {
      host: pins.data.host,
      port: pins.data.port,
      database: pins.data.database,
      username: pins.data.principal,
      ssl: Object.freeze({
        rejectUnauthorized: true,
        servername: pins.data.host,
        ca,
      }),
      max: 1,
      connect_timeout: 5,
      idle_timeout: 10,
      max_lifetime: 300,
      prepare: false,
      debug: false,
      fetch_types: false,
      target_session_attrs: "read-write",
      connection: {
        application_name: "structr-calculator-homologation-admin-v1",
        statement_timeout: 10000,
        lock_timeout: 3000,
        idle_in_transaction_session_timeout: 10000,
      },
      onnotice: () => {},
    };
    Object.defineProperty(options, "password", {
      value: secret.password,
      enumerable: false,
    });
    validAdmission();
    client = (dependencies.createClient ?? postgres)(options);
    // postgres.js copies password to `options.pass`. Preserve driver access while
    // preventing accidental JSON/inspection of the returned Drizzle handle.
    if (Object.hasOwn(client.options, "pass"))
      Object.defineProperty(client.options, "pass", {
        value: (client.options as unknown as { pass: string }).pass,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    const database = drizzle(client, { logger: false });
    const rows = await database.execute(
      sql`select session_user::text as "sessionUser", current_user::text as "currentUser", current_database() as database, current_setting('server_version_num') as "serverVersion", (select ssl from pg_catalog.pg_stat_ssl where pid = pg_backend_pid()) as tls`
    );
    const [actual] = rows as unknown as Array<{
      sessionUser: string;
      currentUser: string;
      database: string;
      serverVersion: string;
      tls: boolean;
    }>;
    if (
      rows.length !== 1 ||
      actual.sessionUser !== pins.data.principal ||
      actual.currentUser !== pins.data.principal ||
      actual.database !== pins.data.database ||
      actual.serverVersion !== "170011" ||
      actual.tls !== true
    )
      reject();
    validAdmission();
    return Object.freeze({ database, close });
  } catch {
    await close().catch(() => undefined);
    reject();
  }
}
