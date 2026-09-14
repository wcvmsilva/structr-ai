import { execFile, spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { getTableColumns } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { projects } from "../../drizzle/schema";

const runFile = promisify(execFile);
const binDirectory = "/usr/local/opt/postgresql@17/bin";
const port = 55439; // Socket filename only: the server has listen_addresses=''.

export type F5bConnection = {
  sql: ReturnType<typeof postgres>;
  db: PostgresJsDatabase;
  pid: number;
};

export type F5bPostgres = {
  directory: string;
  first: F5bConnection;
  second: F5bConnection;
  observer: F5bConnection;
  stop: () => Promise<void>;
};

/**
 * Opt-in caller only. This function creates its own cluster; it cannot accept a URL,
 * existing data directory, host, password file, service name, or connection options.
 * No migration, application seed, or application database configuration is loaded.
 */
export async function startF5bPostgres(): Promise<F5bPostgres> {
  const inherited = Object.keys(process.env).filter(key =>
    /^PG/i.test(key) || /^(DATABASE_URL|POSTGRES_URL|POSTGRESQL_URL)$/i.test(key),
  );
  if (inherited.length) {
    throw new Error(`F5b refuses inherited database configuration: ${inherited.join(", ")}`);
  }
  for (const executable of ["initdb", "pg_ctl", "postgres"]) {
    await access(join(binDirectory, executable), constants.X_OK);
  }

  const directory = await mkdtemp("/private/tmp/structr-f5b-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  const log = join(directory, "postgres.log");
  const pidFile = join(data, "postmaster.pid");
  // This explicit allowlist also prevents libpq service/passfile and loader options
  // from reaching initdb/pg_ctl or the postgres server they launch.
  const childEnv = { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C", LC_ALL: "C" };
  const clients: Array<ReturnType<typeof postgres>> = [];
  let stopped = false;
  let stopping: Promise<void> | undefined;

  const emergencyCleanup = () => {
    if (stopped) return;
    if (existsSync(pidFile)) {
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
          throw new Error(`F5b could not stop its owned server; retained directory: ${directory}`);
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
      console.error("F5b PostgreSQL shutdown failed", error);
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
      ["-D", data, "-U", "f5b_runner", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--locale=C"],
      { env: childEnv, timeout: 30_000 });
    await runFile(join(binDirectory, "pg_ctl"), [
      "-D", data, "-l", log, "-o",
      `-k ${socket} -h '' -p ${port} -c unix_socket_permissions=0700 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000`,
      "-w", "-t", "15", "start",
    ], { env: childEnv, timeout: 18_000 });

    const connect = async (name: string): Promise<F5bConnection> => {
      const options: postgres.Options<{}> = {
        host: socket,
        port,
        database: "postgres",
        user: "f5b_runner",
        password: randomUUID(), // Nonempty, explicit: no inherited credential fallback.
        max: 1,
        ssl: false,
        prepare: false,
        connect_timeout: 2,
        idle_timeout: 0,
        max_lifetime: 0,
        target_session_attrs: "read-write",
        connection: { application_name: `f5b-${name}`, TimeZone: "UTC", statement_timeout: 5000, lock_timeout: 4000 },
        onnotice: () => undefined,
      };
      const client = postgres(options);
      clients.push(client);
      const [identity] = await client<{ pid: number; host: string | null; database: string; role: string }[]>`
        SELECT pg_backend_pid() AS pid, inet_server_addr()::text AS host,
          current_database() AS database, current_user AS role`;
      if (identity.host !== null || identity.database !== "postgres" || identity.role !== "f5b_runner") {
        throw new Error("F5b connection did not reach its owned Unix-socket cluster");
      }
      return { sql: client, db: drizzle(client), pid: identity.pid };
    };
    const first = await connect("first");
    const second = await connect("second");
    const observer = await connect("observer");

    // Real helper SELECTs read every projects column. Derive their PostgreSQL types
    // from the real schema, without creating unrelated tables or FK dependencies.
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const columns = Object.values(getTableColumns(projects));
    await observer.sql.unsafe(`CREATE TABLE projects (${columns.map(column =>
      `${quote(column.name)} ${column.getSQLType()}`,
    ).join(", ")})`);
    return { directory, first, second, observer, stop };
  } catch (error) {
    const detail = await readFile(log, "utf8").catch(() => "");
    try { await stop(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "F5b PostgreSQL startup and cleanup failed");
    }
    throw new Error(`F5b PostgreSQL setup failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

export function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

type QueryKind = "select" | "update";
export type F5bInstrumentation = {
  transactions: number;
  selects: number;
  updates: number;
};
type Hooks = {
  beforeSelect?: (handle: PostgresJsDatabase, state: F5bInstrumentation) => Promise<void>;
  afterSelect?: (handle: PostgresJsDatabase, state: F5bInstrumentation) => Promise<void>;
  afterUpdate?: (handle: PostgresJsDatabase, state: F5bInstrumentation) => Promise<void>;
};

/**
 * Instrument execution boundaries only: builders, returned rows, SQL, and transaction
 * ownership remain real. The same wrapper observes baseline autocommit execution so
 * a missing transaction fails an assertion instead of stranding a test barrier.
 */
export function instrumentF5bDatabase(db: PostgresJsDatabase, hooks: Hooks = {}) {
  const state: F5bInstrumentation = { transactions: 0, selects: 0, updates: 0 };
  function queryProxy(query: object, kind: QueryKind, handle: PostgresJsDatabase): object {
    let executed: Promise<unknown> | undefined;
    const execute = () => executed ??= (async () => {
      if (kind === "select") {
        state.selects++;
        await hooks.beforeSelect?.(handle, state);
      }
      const result = await query;
      if (kind === "select") await hooks.afterSelect?.(handle, state);
      else {
        state.updates++;
        await hooks.afterUpdate?.(handle, state);
      }
      return result;
    })();
    return new Proxy(query, {
      get(target, key) {
        if (key === "then") return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject);
        if (key === "execute") return execute;
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result && typeof result === "object" ? queryProxy(result, kind, handle) : result;
        };
      },
    });
  }
  function handleProxy(handle: PostgresJsDatabase): PostgresJsDatabase {
    return new Proxy(handle, {
      get(target, key) {
        if (key === "transaction") return (callback: (tx: PostgresJsDatabase) => Promise<unknown>) => {
          state.transactions++;
          return target.transaction(tx => callback(handleProxy(tx as unknown as PostgresJsDatabase)));
        };
        const value = Reflect.get(target, key, target);
        if (key === "select" || key === "update") return (...args: unknown[]) =>
          queryProxy(value.apply(target, args), key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  return { db: handleProxy(db), state };
}

/** Bounded observation returns evidence, never a timeout used as a passing assertion. */
export async function observeF5bBlocking(
  observer: F5bConnection,
  blocker: number,
  waiter: number,
  waiterFinishedReading: () => boolean,
): Promise<number[]> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const [row] = await observer.sql<{ pids: number[] }[]>`
      SELECT pg_blocking_pids(${waiter}) AS pids`;
    if (row.pids.includes(blocker) || waiterFinishedReading()) return row.pids;
    await delay(15);
  }
  return [];
}
