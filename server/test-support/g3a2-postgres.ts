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
import postgres from "postgres";
import { projects, geoZones, priceAdjustments, calibrationEvents, calibrationReports } from "../../drizzle/schema";

const runFile = promisify(execFile);
const binDirectory = "/usr/local/opt/postgresql@17/bin";
const port = 55439; // Socket filename only: the server has listen_addresses=''.

export type G3a2Connection = {
  sql: ReturnType<typeof postgres>;
  db: PostgresJsDatabase;
  pid: number;
};

export type G3a2Postgres = {
  directory: string;
  first: G3a2Connection;
  second: G3a2Connection;
  observer: G3a2Connection;
  stop: () => Promise<void>;
};

/**
 * Opt-in caller only. This function creates its own cluster; it cannot accept a URL,
 * existing data directory, host, password file, service name, or connection options.
 * No migration, application seed, or application database configuration is loaded.
 */
export async function startG3a2Postgres(): Promise<G3a2Postgres> {
  if (process.env.G3A2_POSTGRES !== "1") throw new Error("G3a2 requires G3A2_POSTGRES=1");
  const inherited = Object.keys(process.env).filter(key =>
    /^PG/i.test(key) || /^(DATABASE_URL|POSTGRES_URL|POSTGRESQL_URL)$/i.test(key),
  );
  if (inherited.length) {
    throw new Error(`G3a2 refuses inherited database configuration: ${inherited.join(", ")}`);
  }
  for (const executable of ["initdb", "pg_ctl", "postgres"]) {
    await access(join(binDirectory, executable), constants.X_OK);
  }

  const directory = await mkdtemp("/private/tmp/structr-g3a2-pg-");
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
      throw new Error(`G3a2 cannot verify owned server; retained directory: ${directory}`);
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
          throw new Error(`G3a2 could not stop its owned server; retained directory: ${directory}`);
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
      console.error("G3a2 PostgreSQL shutdown failed", error);
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
      ["-D", data, "-U", "g3a2_runner", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--locale=C"],
      { env: childEnv, timeout: 30_000 });
    await runFile(join(binDirectory, "pg_ctl"), [
      "-D", data, "-l", log, "-o",
      `-k ${socket} -h '' -p ${port} -c unix_socket_permissions=0700 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000`,
      "-w", "-t", "15", "start",
    ], { env: childEnv, timeout: 18_000 });

    const connect = async (name: string): Promise<G3a2Connection> => {
      const options: postgres.Options<{}> = {
        host: socket,
        port,
        database: "postgres",
        user: "g3a2_runner",
        password: randomUUID(), // Nonempty, explicit: no inherited credential fallback.
        max: 1,
        ssl: false,
        prepare: false,
        connect_timeout: 2,
        idle_timeout: 0,
        max_lifetime: 0,
        target_session_attrs: "read-write",
        connection: { application_name: `g3a2-${name}`, TimeZone: "UTC", statement_timeout: 5000, lock_timeout: 4000 },
        onnotice: () => undefined,
      };
      const client = postgres(options);
      clients.push(client);
      const [identity] = await client<{ pid: number; host: string | null; database: string; role: string }[]>`
        SELECT pg_backend_pid() AS pid, inet_server_addr()::text AS host,
          current_database() AS database, current_user AS role`;
      if (identity.host !== null || identity.database !== "postgres" || identity.role !== "g3a2_runner") {
        throw new Error("G3a2 connection did not reach its owned Unix-socket cluster");
      }
      return { sql: client, db: drizzle(client), pid: identity.pid };
    };
    const first = await connect("first");
    const second = await connect("second");
    const observer = await connect("observer");

    if (new Set([first.pid, second.pid, observer.pid]).size !== 3) {
      throw new Error("G3a2 requires three independent backends");
    }
    // Exact columns, defaults, PKs and not-null constraints from these five real
    // schema objects. FKs and unrelated domains are deliberately omitted.
    for (const table of [geoZones, priceAdjustments, projects, calibrationEvents, calibrationReports]) {
      await observer.sql.unsafe(tableDDL(table));
    }
    await observer.sql.unsafe("CREATE UNIQUE INDEX uq_calibration_events_tenant_finding ON calibration_events (tenant_id, finding_key)");
    await observer.sql.unsafe("CREATE UNIQUE INDEX uq_calibration_reports_tenant_report ON calibration_reports (tenant_id, report_key)");
    return { directory, first, second, observer, stop };
  } catch (error) {
    const detail = await readFile(log, "utf8").catch(() => "");
    try { await stop(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "G3a2 PostgreSQL startup and cleanup failed");
    }
    throw new Error(`G3a2 PostgreSQL setup failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
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
