import { execFile, spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

const runFile = promisify(execFile);
const binDirectory = "/usr/local/opt/postgresql@17/bin";
const port = 55441; // Socket filename only: the server has listen_addresses=''.

// Module-private provenance: a caller cannot satisfy this guard with a fabricated
// postgres client, even one that would report lab-like settings after a query.
export type ProfileAclProvenance = Readonly<{ directory: string; socket: string; nonce: string }>;
const ownedConnections = new WeakMap<ReturnType<typeof postgres>, ProfileAclProvenance>();

export function assertOwnedProfileAclConnection(sql: ReturnType<typeof postgres>): ProfileAclProvenance {
  const owned = ownedConnections.get(sql);
  if (!owned) {
    throw new Error("Profile ACL lab refuses a client not created by its owned harness");
  }
  if (sql.options.host.length !== 1 || sql.options.host[0] !== owned.socket ||
      sql.options.port.length !== 1 || sql.options.port[0] !== port ||
      sql.options.database !== "postgres" || sql.options.ssl !== false) {
    throw new Error("Profile ACL lab connection options no longer match its owned cluster");
  }
  return owned;
}

export type ProfileAclConnection = {
  sql: ReturnType<typeof postgres>;
  db: PostgresJsDatabase;
  pid: number;
};

export type ProfileAclCluster = {
  directory: string;
  observer: ProfileAclConnection;
  connect: (name: string, role?: "authenticator" | "postgres" | "service_role") => Promise<ProfileAclConnection>;
  stop: () => Promise<void>;
};

/**
 * Opt-in caller only. This function creates its own cluster; it cannot accept a URL,
 * existing data directory, host, password file, service name, or connection options.
 * No migration, application seed, or application database configuration is loaded.
 */
export async function startProfileAclPostgres(factory: typeof postgres): Promise<ProfileAclCluster> {
  if (process.env.PROFILE_ACL_LAB !== "1") throw new Error("Profile ACL lab requires PROFILE_ACL_LAB=1");
  const inherited = Object.keys(process.env).filter(key =>
    /^PG/i.test(key) || /^(?:(?:.*_)?(?:DATABASE|POSTGRES|POSTGRESQL|DB)_URL(?:_.*)?|SUPABASE_DB_URL)$/i.test(key),
  );
  if (inherited.length) {
    throw new Error(`Profile ACL lab refuses inherited database configuration: ${inherited.join(", ")}`);
  }
  for (const executable of ["initdb", "pg_ctl", "postgres"]) {
    await access(join(binDirectory, executable), constants.X_OK);
  }

  const directory = await mkdtemp("/private/tmp/structr-profile-acl-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  const nonce = randomUUID();
  const provenance = Object.freeze({ directory, socket, nonce });
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
      throw new Error(`Profile ACL lab cannot verify owned server; retained directory: ${directory}`);
    }
  };

  const emergencyCleanup = () => {
    if (stopped) return;
    clients.forEach(client => ownedConnections.delete(client));
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
          throw new Error(`Profile ACL lab could not stop its owned server; retained directory: ${directory}`);
        }
      }
    }
    rmSync(directory, { recursive: true, force: true });
    stopped = true;
  };

  const stop = (): Promise<void> => stopping ??= (async () => {
    try {
      clients.forEach(client => ownedConnections.delete(client));
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
      console.error("Profile ACL lab PostgreSQL shutdown failed", error);
      process.exit(1);
    });
  };
  const onInterrupt = () => signalCleanup(130);
  const onTerminate = () => signalCleanup(143);
  process.once("exit", emergencyCleanup);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    await chmod(directory, 0o700);
    await mkdir(socket, { mode: 0o700 });
    await runFile(join(binDirectory, "initdb"),
      ["-D", data, "-U", "profile_acl_runner", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--locale=C"],
      { env: childEnv, timeout: 30_000 });
    await runFile(join(binDirectory, "pg_ctl"), [
      "-D", data, "-l", log, "-o",
      `-k ${socket} -h '' -p ${port} -c unix_socket_permissions=0700 -c profile_acl_lab.nonce=${nonce} -c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000`,
      "-w", "-t", "15", "start",
    ], { env: childEnv, timeout: 18_000 });

    const connectOwned = async (
      name: string,
      role: "profile_acl_runner" | "authenticator" | "postgres" | "service_role",
    ): Promise<ProfileAclConnection> => {
      if (stopped || stopping) throw new Error("Profile ACL lab cluster is stopping or stopped");
      const options: postgres.Options<{}> = {
        host: socket,
        port,
        database: "postgres",
        user: role,
        password: randomUUID(), // Nonempty, explicit: no inherited credential fallback.
        max: 1,
        ssl: false,
        prepare: false,
        connect_timeout: 2,
        idle_timeout: 0,
        max_lifetime: 0,
        target_session_attrs: "read-write",
        connection: { application_name: `profile-acl-${name}`, TimeZone: "UTC", statement_timeout: 5000, lock_timeout: 4000 },
        onnotice: () => undefined,
      };
      const client = factory(options);
      clients.push(client);
      const [identity] = await client<{
        pid: number; host: string | null; database: string; role: string;
        session_role: string; nonce: string; port: string; listeners: string;
      }[]>`
        SELECT pg_backend_pid() AS pid, inet_server_addr()::text AS host,
          current_database() AS database, current_user AS role, session_user AS session_role,
          current_setting('profile_acl_lab.nonce', true) AS nonce,
          current_setting('port') AS port, current_setting('listen_addresses') AS listeners`;
      if (!identity || identity.host !== null || identity.database !== "postgres" ||
          identity.role !== role || identity.session_role !== role || identity.nonce !== nonce ||
          client.options.host.length !== 1 || client.options.host[0] !== socket ||
          client.options.port.length !== 1 || client.options.port[0] !== port ||
          client.options.database !== "postgres" || client.options.user !== role || client.options.ssl !== false ||
          identity.port !== String(port) || identity.listeners !== "") {
        await client.end({ timeout: 1 });
        throw new Error("Profile ACL lab connection did not reach its owned Unix-socket cluster and role");
      }
      if (role !== "profile_acl_runner") ownedConnections.set(client, provenance);
      return { sql: client, db: drizzle(client), pid: identity.pid };
    };
    const bootstrap = await connectOwned("bootstrap", "profile_acl_runner");
    const [owned] = await bootstrap.sql<{ directory: string; sockets: string }[]>`
      SELECT current_setting('data_directory') AS directory,
        current_setting('unix_socket_directories') AS sockets`;
    if (owned.directory !== data || owned.sockets !== socket) {
      throw new Error("Profile ACL lab data/socket directory mismatch");
    }
    // These are isolated synthetic roles. In particular service_role LOGIN enables
    // an independent BYPASSRLS positive control; production service_role is NOLOGIN.
    await bootstrap.sql.unsafe(`
      CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE service_role LOGIN NOSUPERUSER BYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS;
      GRANT anon, authenticated, service_role TO authenticator;
      ALTER DATABASE postgres OWNER TO postgres;
      ALTER SCHEMA public OWNER TO postgres;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    `);
    await bootstrap.sql.end({ timeout: 1 });
    const connect = (name: string, role: "authenticator" | "postgres" | "service_role" = "authenticator") => {
      // Enforce the API at runtime too: callers cannot choose the bootstrap account.
      if (!["authenticator", "postgres", "service_role"].includes(role)) {
        return Promise.reject(new Error("Profile ACL lab refuses an unsupported connection role"));
      }
      return connectOwned(name, role);
    };
    // Owner observer initializes/resets the fixture. A separate service_role
    // connection provides the non-owner bypass control without ownership grants.
    const observer = await connect("observer", "postgres");
    return { directory, observer, connect, stop };
  } catch (error) {
    const detail = await readFile(log, "utf8").catch(() => "");
    try { await stop(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Profile ACL lab PostgreSQL startup and cleanup failed");
    }
    throw new Error(`Profile ACL lab PostgreSQL setup failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}
