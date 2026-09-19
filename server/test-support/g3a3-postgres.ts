import { execFile, spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { getTableColumns, getTableName, sql, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { tenants, geoZones } from "../../drizzle/schema";

const runFile = promisify(execFile);
const binDirectory = "/usr/local/opt/postgresql@17/bin";
const port = 55439; // Socket filename only: the server has listen_addresses=''.

export type G3a3Connection = {
  sql: ReturnType<typeof postgres>;
  db: PostgresJsDatabase;
  pid: number;
  queries: Array<{ sql: string; parameters: unknown[] }>;
  endCalls: number;
  ended: boolean;
};

export type G3a3Postgres = {
  directory: string;
  observer: G3a3Connection;
  connect: (name: string) => Promise<G3a3Connection>;
  stop: () => Promise<void>;
};

/**
 * Opt-in caller only. This function creates its own cluster; it cannot accept a URL,
 * existing data directory, host, password file, service name, or connection options.
 * No migration, application seed, or application database configuration is loaded.
 */
export async function startG3a3Postgres(factory: typeof postgres): Promise<G3a3Postgres> {
  if (process.env.G3A3_POSTGRES !== "1") throw new Error("G3a3 requires G3A3_POSTGRES=1");
  const inherited = Object.keys(process.env).filter(key =>
    /^PG/i.test(key) || /^(DATABASE_URL|POSTGRES_URL|POSTGRESQL_URL)$/i.test(key),
  );
  if (inherited.length) {
    throw new Error(`G3a3 refuses inherited database configuration: ${inherited.join(", ")}`);
  }
  for (const executable of ["initdb", "pg_ctl", "postgres"]) {
    await access(join(binDirectory, executable), constants.X_OK);
  }

  const directory = await mkdtemp("/private/tmp/structr-g3a3-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  const log = join(directory, "postgres.log");
  const pidFile = join(data, "postmaster.pid");
  // This explicit allowlist also prevents libpq service/passfile and loader options
  // from reaching initdb/pg_ctl or the postgres server they launch.
  const childEnv = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
  const clients: Array<ReturnType<typeof postgres>> = [];
  let stopped = false;
  let stopping: Promise<void> | undefined;

  const assertOwnedPidFile = () => {
    const [pid, ownedData] = readFileSync(pidFile, "utf8").split("\n");
    if (ownedData !== data || !/^\d+$/.test(pid)) {
      throw new Error(`G3a3 cannot verify owned server; retained directory: ${directory}`);
    }
  };

  const emergencyCleanup = () => {
    if (stopped) return;
    if (existsSync(pidFile)) {
      assertOwnedPidFile();
      const result = spawnSync(join(binDirectory, "pg_ctl"),
        ["-D", data, "-m", "immediate", "-w", "-t", "10", "stop"],
        { env: childEnv, timeout: 12_000, stdio: "ignore" });
      if (result.status !== 0 && existsSync(pidFile)) {
        // Never signal an unverified PID or remove a still-running data directory.
        const [pid, ownedData] = readFileSync(pidFile, "utf8").split("\n");
        if (ownedData === data && /^\d+$/.test(pid)) {
          try { process.kill(Number(pid), "SIGQUIT"); } catch { /* already exited */ }
          for (let attempt = 0; attempt < 30 && existsSync(pidFile); attempt++) {
            spawnSync("/bin/sleep", ["0.1"], { env: childEnv, timeout: 1_000, stdio: "ignore" });
          }
        }
        if (existsSync(pidFile)) {
          throw new Error(`G3a3 could not stop its owned server; retained directory: ${directory}`);
        }
      }
    }
    rmSync(directory, { recursive: true, force: true });
    stopped = true;
  };

  const stop = (): Promise<void> => stopping ??= (async () => {
    try {
      await Promise.allSettled(clients.map(client => client.end({ timeout: 1 })));
      if (existsSync(pidFile)) {
        assertOwnedPidFile();
        await runFile(join(binDirectory, "pg_ctl"),
          ["-D", data, "-m", "immediate", "-w", "-t", "10", "stop"],
          { env: childEnv, timeout: 12_000 });
      }
      await rm(directory, { recursive: true, force: true });
      stopped = true;
    } finally {
      if (!stopped) emergencyCleanup();
      process.off("exit", emergencyCleanup);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
    }
  })();

  const signalCleanup = (exitCode: number) => {
    void stop().then(() => process.exit(exitCode), error => {
      console.error("G3a3 PostgreSQL shutdown failed", error);
      process.exit(1);
    });
  };
  const onInterrupt = () => signalCleanup(130);
  const onTerminate = () => signalCleanup(143);
  process.once("exit", emergencyCleanup);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    await mkdir(socket, { mode: 0o700 });
    await runFile(join(binDirectory, "initdb"),
      ["-D", data, "-U", "g3a3_runner", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--locale=C"],
      { env: childEnv, timeout: 30_000 });
    await runFile(join(binDirectory, "pg_ctl"), [
      "-D", data, "-l", log, "-o",
      `-k ${socket} -h '' -p ${port} -c unix_socket_permissions=0700 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000`,
      "-w", "-t", "15", "start",
    ], { env: childEnv, timeout: 18_000 });

    const connect = async (name: string): Promise<G3a3Connection> => {
      const queries: G3a3Connection["queries"] = [];
      const options: postgres.Options<{}> = {
        host: socket,
        port,
        database: "postgres",
        user: "g3a3_runner",
        password: randomUUID(), // Nonempty, explicit: no inherited credential fallback.
        max: 1,
        ssl: false,
        prepare: false,
        connect_timeout: 2,
        idle_timeout: 0,
        max_lifetime: 0,
        target_session_attrs: "read-write",
        connection: { application_name: `g3a3-${name}`, TimeZone: "UTC", statement_timeout: 5000, lock_timeout: 4000 },
        onnotice: () => undefined,
        debug: (_connection, query, parameters) => { queries.push({ sql: query, parameters: Array.from(parameters) }); },
      };
      const client = factory(options);
      clients.push(client);
      const [identity] = await client<{ pid: number; host: string | null; database: string; role: string }[]>`
        SELECT pg_backend_pid() AS pid, inet_server_addr()::text AS host,
          current_database() AS database, current_user AS role`;
      if (identity.host !== null || identity.database !== "postgres" || identity.role !== "g3a3_runner") {
        throw new Error("G3a3 connection did not reach its owned Unix-socket cluster");
      }
      const state = { queries, endCalls: 0, ended: false };
      const observed = new Proxy(client, { get(target, key) {
        if (key === "end") return async (...args: Parameters<typeof client.end>) => {
          state.endCalls++;
          await target.end(...args);
          state.ended = true;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      queries.length = 0;
      return Object.assign(state, { sql: observed, db: drizzle(observed), pid: identity.pid });
    };
    const observer = await connect("observer");
    // Exact geo/tenant columns, defaults, PKs and NOT NULL constraints. No migrations,
    // unrelated tables, deployment FKs or RLS. The absent tenant/name unique geo index
    // is intentional: no concurrent-deduplication claim is made.
    for (const table of [tenants, geoZones]) {
      await observer.sql.unsafe(tableDDL(table));
    }
    // Synthetic sentinel only. All legacy SKUs are preloaded by tests so baseline
    // SELECTs succeed without claiming knowledge of an operational price schema.
    await observer.sql.unsafe("CREATE TABLE price_book_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text NOT NULL)");
    return { directory, observer, connect, stop };
  } catch (error) {
    const detail = await readFile(log, "utf8").catch(() => "");
    try { await stop(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "G3a3 PostgreSQL startup and cleanup failed");
    }
    throw new Error(`G3a3 PostgreSQL setup failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

function tableDDL(table: Table): string {
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const dialect = new PgDialect();
  const columns = Object.values(getTableColumns(table)).map(column => {
    if (column.defaultFn) throw new Error("Unsupported runtime default: " + column.name);
    const definition = [quote(column.name), column.getSQLType(), column.primary ? "PRIMARY KEY" : "", column.notNull ? "NOT NULL" : ""];
    if (column.default !== undefined) {
      const compiled = dialect.sqlToQuery(sql`${column.default}`.inlineParams());
      if (compiled.params.length !== 0) throw new Error("Unresolved fixture default: " + column.name);
      definition.push("DEFAULT " + compiled.sql);
    }
    return definition.filter(Boolean).join(" ");
  });
  return "CREATE TABLE " + quote(getTableName(table)) + " (" + columns.join(", ") + ")";
}
