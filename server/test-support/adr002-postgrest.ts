/** Opt-in owned PostgreSQL + real PostgREST laboratory. Never accepts a database URL. */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { startAppPrincipalPostgres } from "./app-principal-postgres";

export const ADR002_ISSUER = "https://adr002-lab.invalid/auth/v1";
const BINARY_SHA256 = "687feb850521f90bff189d1f140c33354c572b24e1e95ff586d7dd4beb245817";
const repository = fileURLToPath(new URL("../../", import.meta.url));
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

export type RpcResult = { status: number; body: any };
export type Adr002Postgrest = Awaited<ReturnType<typeof startAdr002Postgrest>>;

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((done, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", done);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing owned HTTP port");
  await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
  return address.port;
}

export async function startAdr002Postgrest(options: { applySchemaUsage?: boolean; applyMinimumReads?: boolean } = {}) {
  if (process.env.ADR002_PHYSICAL !== "1") throw new Error("Requires ADR002_PHYSICAL=1");
  if (options.applyMinimumReads && (process.env.ADR002_APPLY_BOUNDARY !== "1" || options.applySchemaUsage === false)) {
    throw new Error("Minimum reads require explicit boundary application and schema usage migration");
  }
  const binary = process.env.ADR002_POSTGREST_BIN;
  if (!binary || !binary.startsWith("/private/tmp/structr-adr002-postgrest-bin-")) {
    throw new Error("Requires the task-owned official PostgREST binary in /private/tmp");
  }
  if (process.platform !== "darwin" || process.arch !== "x64") {
    throw new Error("This reviewed PostgREST binary is macOS x86_64 only");
  }
  const digest = createHash("sha256").update(await readFile(binary)).digest("hex");
  if (digest !== BINARY_SHA256) throw new Error("PostgREST binary differs from reviewed v16.4 asset");
  // The private signing key remains only in this supervisor's memory. The service
  // receives a public JWK, never a signing secret. No verifier or HTTP mock exists.
  const keys = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(keys.publicKey)), alg: "ES256", kid: "adr002-es256", use: "sig" };
  const port = await freePort();
  const cluster = await startAppPrincipalPostgres(postgres);
  const sql = cluster.observer.sql;
  const socket = resolve(cluster.directory, "socket");
  const baseUrl = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  const supervisors: ReturnType<typeof postgres>[] = [];
  let serviceLog = "";
  let stopping: Promise<void> | undefined;
  const running = () => child?.pid !== undefined && child.exitCode === null && child.signalCode === null;
  const exitCleanup = () => { if (running()) child!.kill("SIGKILL"); };
  process.prependOnceListener("exit", exitCleanup);

  async function stop() {
    return stopping ??= (async () => {
      if (running()) {
        child!.kill("SIGTERM");
        for (let attempt = 0; running() && attempt < 50; attempt++) await wait(20);
        if (running()) {
          const exited = new Promise<void>(done => child!.once("exit", () => done()));
          child!.kill("SIGKILL");
          await exited;
        }
      }
      await Promise.allSettled(supervisors.map(client => client.end({ timeout: 1 })));
      await cluster.stop();
      process.off("exit", exitCleanup);
    })();
  }

  try {
    const [owned] = await sql`SELECT current_setting('app_principal_lab.nonce') AS nonce`;
    await sql.unsafe(`
      CREATE ROLE anon NOLOGIN NOBYPASSRLS;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE supabase_auth_admin NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT anon, authenticated TO authenticator WITH INHERIT FALSE, SET TRUE;
      CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY, aud varchar, role varchar,
        banned_until timestamptz, deleted_at timestamptz,
        is_anonymous boolean NOT NULL DEFAULT false
      );
      CREATE TABLE auth.sessions (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
        not_after timestamptz
      );
      ALTER TABLE auth.users OWNER TO supabase_auth_admin;
      ALTER TABLE auth.sessions OWNER TO supabase_auth_admin;
      ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON SCHEMA auth FROM PUBLIC;
    `);
    const journal = JSON.parse(await readFile(resolve(repository, "drizzle/meta/_journal.json"), "utf8"));
    const migrations: string[] = [];
    for (const entry of journal.entries as Array<{ tag: string }>) {
      if (Number(entry.tag.slice(0, 4)) > 14) continue;
      const source = await readFile(resolve(repository, "drizzle", `${entry.tag}.sql`), "utf8");
      await sql.begin(async tx => { await tx.unsafe(source); });
      migrations.push(entry.tag);
    }
    const boundary = resolve(repository, "drizzle/0015_authenticated_review_boundary.sql");
    const boundaryPresent = process.env.ADR002_APPLY_BOUNDARY === "1";
    if (boundaryPresent && !await access(boundary).then(() => true, () => false)) {
      throw new Error("Explicit boundary application requested, but approved migration 0015 is absent");
    }
    const boundarySource = boundaryPresent ? await readFile(boundary, "utf8") : null;
    let freshReplayPreflight: { code: string; message: string; objectsRolledBack: boolean } | null = null;
    if (boundarySource) {
      try {
        await sql.begin(async tx => {
          await tx.unsafe(boundarySource);
          throw new Error("Uncontained replay unexpectedly accepted migration 0015");
        });
      } catch (error: any) {
        if (error.code !== "42501" || !/^ADR002_BUSINESS_(FUNCTION|TABLE)_PREFLIGHT:/.test(error.message)) throw error;
        const [remaining] = await sql`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='structr_review_owner_v1')
          OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='structr_private') AS present`;
        if (remaining.present) throw new Error("Failed fresh replay did not roll back boundary objects");
        freshReplayPreflight = { code: error.code, message: error.message, objectsRolledBack: true };
      }
    }
    // Explicit contained-laboratory baseline, NOT evidence of legacy migration
    // preflight/containment. A separate unmodified replay must test that gate.
    await sql.unsafe(`
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, authenticator, service_role;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, authenticator, service_role;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, authenticator, service_role;
      -- Hosted containment also removes the initdb PUBLIC namespace default.
      -- Never grant namespace access here: migrations must supply it explicitly.
      REVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated, authenticator;
    `);
    const preflightDrift: Array<{ name: string; code: string; message: string }> = [];
    if (boundarySource) {
      for (const probe of [
        { name: "column grant", sql: "GRANT SELECT(notes) ON public.estimate_drafts TO authenticated", prefix: "ADR002_BUSINESS_TABLE_PREFLIGHT:" },
        { name: "switchable role", sql: "CREATE ROLE adr002_drift_reader NOLOGIN; GRANT SELECT(id) ON public.clients TO adr002_drift_reader; GRANT adr002_drift_reader TO authenticated WITH INHERIT FALSE,SET TRUE", prefix: "ADR002_BUSINESS_TABLE_PREFLIGHT:" },
        { name: "restrictive evidence policy", sql: "CREATE POLICY adr002_drift_restrictive ON public.historical_estimate_imports AS RESTRICTIVE FOR SELECT TO authenticated USING(false)", prefix: "ADR002_EVIDENCE_RLS_PREFLIGHT" },
        { name: "unknown executable function", sql: "CREATE FUNCTION public.adr002_drift_fn() RETURNS boolean LANGUAGE sql RETURN true", prefix: "ADR002_UNREVIEWED_FUNCTION_PREFLIGHT:" },
        { name: "unknown readable view", sql: "CREATE VIEW public.adr002_drift_view AS SELECT id FROM public.clients; GRANT SELECT ON public.adr002_drift_view TO authenticated", prefix: "ADR002_UNREVIEWED_RELATION_PREFLIGHT:" },
      ]) {
        try {
          await sql.begin(async tx => {
            await tx.unsafe(probe.sql);
            await tx.unsafe(boundarySource);
            throw new Error(`Preflight unexpectedly accepted ${probe.name}`);
          });
        } catch (error: any) {
          if (error.code !== "42501" || !error.message.startsWith(probe.prefix)) throw error;
          preflightDrift.push({ name: probe.name, code: error.code, message: error.message });
        }
      }
      const [drift] = await sql`SELECT
        has_column_privilege('authenticated','public.estimate_drafts','notes','SELECT') AS column_access,
        EXISTS(SELECT 1 FROM pg_roles WHERE rolname='adr002_drift_reader') AS role_present,
        EXISTS(SELECT 1 FROM pg_policy WHERE polname='adr002_drift_restrictive') AS policy_present,
        to_regprocedure('public.adr002_drift_fn()') IS NOT NULL AS function_present,
        to_regclass('public.adr002_drift_view') IS NOT NULL AS view_present`;
      if (Object.values(drift).some(Boolean)) throw new Error("Preflight drift transaction failed to roll back");
    }
    if (boundaryPresent) {
      await sql.begin(async tx => { await tx.unsafe(boundarySource!); });
      await sql`INSERT INTO structr_private.authenticated_boundary_config(id,issuer,audience)
        VALUES(true,${ADR002_ISSUER},'authenticated')`;
      migrations.push("0015_authenticated_review_boundary");
      if (options.applySchemaUsage !== false) {
        const usageSource = await readFile(resolve(repository, "drizzle/0016_authenticated_public_schema_usage.sql"), "utf8");
        await sql.begin(async tx => { await tx.unsafe(usageSource); });
        migrations.push("0016_authenticated_public_schema_usage");
      }
      if (options.applyMinimumReads) {
        const readSource = await readFile(resolve(repository, "drizzle/0017_authenticated_estimate_reads.sql"), "utf8");
        await sql.begin(async tx => { await tx.unsafe(readSource); });
        migrations.push("0017_authenticated_estimate_reads");
      }
    }
    const config = resolve(cluster.directory, "postgrest.conf");
    const settings = [
      `db-uri = ${JSON.stringify(`postgresql://authenticator@/postgres?host=${encodeURIComponent(socket)}&port=55443`)}`,
      'db-schemas = "public"', 'db-anon-role = "anon"', 'db-pool = 1',
      'db-prepared-statements = false', 'db-channel-enabled = false',
      `jwt-secret = ${JSON.stringify(JSON.stringify({ keys: [jwk] }))}`,
      'jwt-aud = "authenticated"', 'server-host = "127.0.0.1"', `server-port = ${port}`,
      'log-level = "warn"',
    ].join("\n");
    await writeFile(config, settings, { mode: 0o600 });
    child = spawn(binary, [config], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", DYLD_LIBRARY_PATH: "/usr/local/opt/postgresql@17/lib/postgresql" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", bytes => { serviceLog += bytes.toString(); });
    child.stderr?.on("data", bytes => { serviceLog += bytes.toString(); });
    let spawnError: Error | undefined;
    child.once("error", error => { spawnError = error; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      if (!running()) throw new Error(`PostgREST exited during startup: ${serviceLog}`);
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(250) });
        // A contained anonymous namespace can return 401 at the API root. This
        // still proves service readiness; authenticated RPC tests prove access.
        if (response.status === 200 || response.status === 401) { ready = true; break; }
      } catch { /* bounded service readiness only */ }
      await wait(50);
    }
    if (!ready) throw new Error(`PostgREST readiness failed: ${serviceLog}`);

    async function token(claims: Record<string, unknown> = {}, wrongKey = false) {
      const now = Math.floor(Date.now() / 1000);
      const key = wrongKey ? (await generateKeyPair("ES256")).privateKey : keys.privateKey;
      return new CompactSign(new TextEncoder().encode(JSON.stringify({
        iss: ADR002_ISSUER, aud: "authenticated", role: "authenticated",
        iat: now, nbf: now - 1, exp: now + 600, is_anonymous: false, ...claims,
      }))).setProtectedHeader({ alg: "ES256", kid: "adr002-es256", typ: "JWT" }).sign(key);
    }
    async function request(path: string, bearer: string | null, body?: unknown, method = "POST"): Promise<RpcResult> {
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Relative laboratory path required");
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12_000),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    async function connectSupervisor() {
      if (stopping) throw new Error("Owned laboratory is stopping");
      const client = postgres({ host: socket, port: 55443, database: "postgres", user: "app_principal_runner",
        password: randomUUID(), ssl: false, max: 1, prepare: false, onnotice: () => undefined,
        connection: { application_name: "adr002-owned-concurrency-supervisor", TimeZone: "UTC" } });
      supervisors.push(client);
      const [identity] = await client`SELECT current_setting('app_principal_lab.nonce') AS nonce,
        current_setting('data_directory') AS data, current_setting('listen_addresses') AS listeners,
        session_user AS role, inet_server_addr() AS host`;
      if (identity.nonce !== owned.nonce || identity.data !== resolve(cluster.directory, "data")
        || identity.listeners !== "" || identity.role !== "app_principal_runner" || identity.host !== null) {
        await client.end(); throw new Error("Concurrent supervisor did not reach the owned cluster");
      }
      return client;
    }
    return { sql, cluster, baseUrl, migrations, boundaryPresent, freshReplayPreflight, preflightDrift, token, request, stop, connectSupervisor,
      rpc: (name: string, bearer: string | null, body: unknown = {}) => request(`/rpc/${name}`, bearer, body),
      connectDenied: () => cluster.connect(`adr002-denied-${randomUUID()}`, "app_denied"),
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
