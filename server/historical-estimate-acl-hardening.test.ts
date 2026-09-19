/** Opt-in physical proof in the root-owned, disposable h1_acl_test database.
 * Never reads DATABASE_URL. Owner access is fixture/DDL only; denial cases use
 * actual non-owner connections. This is not a production principal certificate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../drizzle/schema";

const configPath = process.env.H1_ACL_CONFIG;
const migrationPath = fileURLToPath(new URL("../drizzle/0006_historical_estimate_acl_hardening.sql", import.meta.url));
const baselinePath = fileURLToPath(new URL("../drizzle/0005_historical_estimate_capture.sql", import.meta.url));
const tables = ["historical_estimate_sources", "historical_estimate_source_lines", "historical_estimate_imports", "historical_estimate_import_lines"] as const;
const tableList = tables.map(name => `public.${name}`).join(", ");
const privileges = ["INSERT", "SELECT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const rollback = new Error("H1 ACL fixture rollback");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Connection = ReturnType<typeof postgres>;
type Transaction = postgres.TransactionSql;
type Queryable = Connection | Transaction;
type Config = { directory: string; dataDirectory: string; socketDirectory: string; database: string; ownerUser: string; apiUsers: string[]; port: number; sentinel: { table: string; nonce: string } };
let owner: Connection;
let clients: Connection[] = [];
let config: Config;
let migration = "";
let initialDefaults: unknown;
let unrelatedAcl: unknown;
let seededState: unknown;

async function applyMigration(db: Queryable) {
  for (const statement of migration.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean)) await db.unsafe(statement);
}

async function defaultAcls(db: Queryable) {
  return Array.from(await db.unsafe("select defaclrole::regrole::text as creator, defaclnamespace::regnamespace::text as namespace, defaclobjtype, defaclacl::text from pg_catalog.pg_default_acl order by 1,2,3"));
}

async function objectSecurity(db: Queryable) {
  return Array.from(await db.unsafe(`select c.relname, c.relacl::text, c.relrowsecurity,
    coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb) as columns,
    coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'type',t.tgtype,'enabled',t.tgenabled,'function',pg_get_functiondef(t.tgfoid)) order by t.tgname)
      from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),'[]'::jsonb) as triggers
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`, [tables.slice()]));
}

async function evidenceState(db: Queryable) {
  const result: Record<string, unknown> = {};
  for (const name of tables) result[name] = Array.from(await db.unsafe(`select tenant_id::text as tenant, count(*)::int as count, md5(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text)) as hash from public.${name} t group by tenant_id order by tenant_id`));
  return result;
}

// A successful destructive baseline is still rolled back: RED must never consume
// the shared fixture or be mistaken for a persistent change to a real database.
async function attempt(connection: Connection, statement: string) {
  let result: { ok: boolean; code?: string; constraint_name?: string } | undefined;
  try {
    await connection.begin(async tx => {
      try { await tx.unsafe(statement); result = { ok: true }; }
      catch (error) { result = { ok: false, code: (error as { code?: string }).code, constraint_name: (error as { constraint_name?: string }).constraint_name }; }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  return result;
}

async function temporarilyGrant(privilege: "TRUNCATE" | "SELECT", role: string, run: () => Promise<void>) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unexpected fixture role");
  const before = await objectSecurity(owner);
  const held = await owner`select c.relname, has_table_privilege(${role},c.oid,${privilege}) as allowed from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(${tables.slice()}::text[])`;
  await owner.unsafe(`GRANT ${privilege} ON ${tableList} TO "${role}"`);
  try { await run(); }
  finally {
    for (const row of held) if (!row.allowed) await owner.unsafe(`REVOKE ${privilege} ON public.${row.relname} FROM "${role}"`);
  }
  expect(await objectSecurity(owner)).toEqual(before);
}

async function seedTwoTenants() {
  const db = drizzle(owner);
  for (let tenant = 0; tenant < 2; tenant++) {
    const tenantId = randomUUID(), userId = randomUUID(), clientId = randomUUID(), projectId = randomUUID(), draftId = randomUUID(), sourceId = randomUUID(), lineId = randomUUID(), importId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(schema.tenants).values({ id: tenantId, name: "Synthetic H1 ACL tenant", slug: `h1-acl-${tenantId}` });
      await tx.insert(schema.profiles).values({ id: userId, tenantId, isActive: true, role: "user" });
      await tx.insert(schema.clients).values({ id: clientId, tenantId, name: "Synthetic ACL client" });
      await tx.insert(schema.projects).values({ id: projectId, tenantId, clientId, ownerUserId: userId, name: "Synthetic ACL project", projectType: "repair" });
      await tx.insert(schema.estimateDrafts).values({ id: draftId, tenantId, projectId, clientId, source: "historical_import", status: "draft", createdBy: userId });
      await tx.insert(schema.historicalEstimateSources).values({ id: sourceId, tenantId, projectId, clientId, requestId: randomUUID(), recordedBy: userId, requestHash: digest(randomUUID()), contentHash: digest(randomUUID()), contractVersion: "historical-source-v1", sourceKind: "manual_transcription", sourceLabel: "Synthetic ACL source", currencyCode: null, expectedLineCount: 1, rawTotals: { version: "historical-raw-totals-v1", subtotal: null, discount: null, tax: null, total: null, estimatedCost: null } });
      await tx.insert(schema.historicalEstimateSourceLines).values({ id: lineId, tenantId, sourceId, sourceLineKey: "row-1", ordinal: 0, description: "Synthetic ACL line", lineHash: digest(randomUUID()), rawValues: { version: "historical-raw-line-v1", quantity: null, unitPrice: null, unitEstimatedCost: null, linePrice: null, lineEstimatedCost: null, taxable: null, externalCode: null } });
      await tx.insert(schema.historicalEstimateImports).values({ id: importId, tenantId, projectId, clientId, sourceId, estimateDraftId: draftId, requestId: randomUUID(), recordedBy: userId, requestHash: digest(randomUUID()), selectionHash: digest(randomUUID()), contractVersion: "historical-selection-v1", revision: 1, reconciliationState: "unresolved", reconciliationFindings: { version: "historical-reconciliation-v1", state: "unresolved", sumPriceMinor: null, sumCostMinor: null, findings: [{ code: "unknown_currency", field: "currency" }] }, rawSelectedTotals: { version: "historical-raw-selected-v1", total: null, estimatedCost: null }, expectedLineCount: 1 });
      await tx.insert(schema.historicalEstimateImportLines).values({ tenantId, importId, sourceId, sourceLineId: lineId, position: 0 });
    });
  }
}

describe.skipIf(!configPath)("H1 ACL hardening on an owned PostgreSQL fixture", () => {
  beforeAll(async () => {
    config = JSON.parse(await readFile(configPath!, "utf8")) as Config;
    const directory = await realpath(config.directory);
    if (!/^\/private\/tmp\/structr-(?:a1|h1-acl)-[^/]+$/.test(directory) || directory !== resolve(config.directory) || config.database !== "h1_acl_test" || !Number.isInteger(config.port) || !/^[a-z_][a-z0-9_]*$/.test(config.ownerUser) || config.apiUsers.join(",") !== "anon,authenticated") throw new Error("Not the owned H1 ACL laboratory configuration");
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory + sep) || !socketDirectory.startsWith(directory + sep) || socketDirectory !== resolve(config.socketDirectory)) throw new Error("H1 ACL paths escape the owned laboratory");
    if (digest(await readFile(baselinePath, "utf8")) !== "1741d20d6b9aca3e90e447f9fb8023337a86038ac2cd05271a5fe35f316c5015") throw new Error("H1 baseline migration changed");
    const options = { host: socketDirectory, database: config.database, port: config.port, ssl: false as const, max: 1, prepare: false, onnotice: () => {} };
    owner = postgres({ ...options, username: config.ownerUser });
    const [identity] = await owner`select current_database() as database,current_user as username,current_setting('data_directory') as data_directory,current_setting('unix_socket_directories') as socket_directories,current_setting('listen_addresses') as listen_addresses,current_setting('port') as port,inet_server_addr() as server_address`;
    if (identity.database !== config.database || identity.username !== config.ownerUser || await realpath(identity.data_directory) !== dataDirectory || identity.socket_directories !== socketDirectory || identity.listen_addresses !== "" || Number(identity.port) !== config.port || identity.server_address !== null) throw new Error("H1 ACL server identity mismatch");
    if (config.sentinel?.table !== "_owned_lab_identity" || typeof config.sentinel.nonce !== "string" || config.sentinel.nonce.length < 16) throw new Error("H1 ACL sentinel configuration missing");
    const sentinels = await owner`select nonce from public._owned_lab_identity`;
    if (sentinels.length !== 1 || sentinels[0].nonce !== config.sentinel.nonce) throw new Error("H1 ACL sentinel mismatch");
    for (const role of config.apiUsers) {
      const connection = postgres({ ...options, username: role }); clients.push(connection);
      const [principal] = await connection`select current_user as username,session_user as session_username,current_database() as database,inet_server_addr() as server_address,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,
        exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relowner=r.oid) as owns_public,
        exists(select 1 from pg_catalog.pg_roles elevated where (elevated.rolsuper or elevated.rolbypassrls or elevated.rolcreaterole or elevated.rolcreatedb) and pg_has_role(r.oid,elevated.oid,'MEMBER')) as elevated_membership
        from pg_catalog.pg_roles r where r.rolname=current_user`;
      expect(principal).toMatchObject({ username: role, session_username: role, database: "h1_acl_test", server_address: null, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, owns_public: false, elevated_membership: false });
    }
    initialDefaults = await defaultAcls(owner);
    unrelatedAcl = Array.from(await owner`select c.relname,c.relacl::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not(c.relname=any(${tables.slice()}::text[])) order by c.relname`);
    await seedTwoTenants();
    seededState = await evidenceState(owner);
    // Before the migration exists, execute the same behavioral assertions against
    // 0005; a real authorization failure, not ENOENT, must supply the RED evidence.
    try { migration = await readFile(migrationPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (migration) await owner.begin(async tx => { await applyMigration(tx); });
  });
  afterAll(async () => { await Promise.all([owner?.end(), ...clients.map(connection => connection.end())]); });

  it.each(["anon", "authenticated"])("removes direct and PUBLIC table privileges from %s", async role => {
    const rows = [];
    for (const table of tables) for (const privilege of privileges) {
      const [row] = await owner`select has_table_privilege(${role},${`public.${table}`},${privilege}) as allowed`;
      rows.push({ table, privilege, allowed: row.allowed });
    }
    expect(rows.filter(row => row.allowed)).toEqual([]);
  });

  it.each([0, 1])("denies ordinary role %i truncation without requiring RLS or FK refusal", async index => {
    expect(await attempt(clients[index], "TRUNCATE public.historical_estimate_import_lines")).toMatchObject({ ok: false, code: "42501" });
    expect(await evidenceState(owner)).toEqual(seededState);
  });

  it.each([...tables.map(name => `TRUNCATE public.${name} CASCADE`), `TRUNCATE ${tableList}`, `TRUNCATE ${tableList} CASCADE`])("physically refuses %s even with a fixture-only TRUNCATE grant", async statement => {
    // A sibling trigger reached through CASCADE must not conceal an omitted
    // statement guard on another table in the immutable set.
    const guards = await owner`select c.relname, t.tgtype::int as kind, t.tgenabled, p.prosecdef from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid where n.nspname='public' and c.relname=any(${tables.slice()}::text[]) and (t.tgtype::int & 32)=32 and not t.tgisinternal order by c.relname`;
    expect(Array.from(guards)).toEqual(tables.slice().sort().map(relname => ({ relname, kind: 34, tgenabled: "O", prosecdef: false })));
    await temporarilyGrant("TRUNCATE", config.apiUsers[0], async () => {
      expect(await attempt(clients[0], statement)).toMatchObject({ ok: false, code: "23514", constraint_name: "historical_estimate_immutable" });
      expect(await evidenceState(owner)).toEqual(seededState);
    });
  });

  it.each(tables)("refuses an accidental owner truncation of %s while triggers remain active", async table => {
    expect(await attempt(owner, `TRUNCATE public.${table} CASCADE`)).toMatchObject({ ok: false, code: "23514", constraint_name: "historical_estimate_immutable" });
    expect(await evidenceState(owner)).toEqual(seededState);
  });

  it("retains RLS default-deny when SELECT is independently granted in the fixture", async () => {
    await temporarilyGrant("SELECT", config.apiUsers[0], async () => {
      for (const table of tables) expect(Array.from(await clients[0].unsafe(`select * from public.${table}`))).toEqual([]);
    });
    expect(await evidenceState(owner)).toEqual(seededState);
  });

  it.each(["UPDATE public.historical_estimate_import_lines SET position=position", "DELETE FROM public.historical_estimate_import_lines"])("preserves existing row immutability: %s", async statement => {
    expect(await attempt(owner, statement)).toMatchObject({ ok: false, code: "23514", constraint_name: "historical_estimate_immutable" });
    expect(await evidenceState(owner)).toEqual(seededState);
  });

  it("does not change unrelated table ACLs or creator default ACLs", async () => {
    expect(await defaultAcls(owner)).toEqual(initialDefaults);
    expect(Array.from(await owner`select c.relname,c.relacl::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not(c.relname=any(${tables.slice()}::text[])) order by c.relname`)).toEqual(unrelatedAcl);
  });

  it("can rerun hardening without changing evidence, effective denial or trigger definitions", async () => {
    const security = await objectSecurity(owner);
    await owner.begin(async tx => { await applyMigration(tx); });
    expect(await objectSecurity(owner)).toEqual(security);
    expect(await evidenceState(owner)).toEqual(seededState);
    expect(await attempt(clients[0], "TRUNCATE public.historical_estimate_import_lines")).toMatchObject({ ok: false, code: "42501" });
    await temporarilyGrant("TRUNCATE", config.apiUsers[0], async () => {
      expect(await attempt(clients[0], `TRUNCATE ${tableList}`)).toMatchObject({ ok: false, code: "23514", constraint_name: "historical_estimate_immutable" });
    });
  });

  it("removes PUBLIC grants rather than assuming they were absent", async () => {
    const before = await objectSecurity(owner);
    try {
      await owner.begin(async tx => {
        await tx.unsafe(`GRANT SELECT, TRUNCATE ON ${tableList} TO PUBLIC`);
        await applyMigration(tx);
        const [row] = await tx.unsafe("select has_table_privilege('anon','public.historical_estimate_import_lines','SELECT,TRUNCATE') as allowed");
        expect(row.allowed).toBe(false);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await objectSecurity(owner)).toEqual(before);
  });

  it.each([["inherited", true], ["assumable without inheritance", false]] as const)("refuses %s API grants and rolls back the whole migration attempt", async (_label, inherit) => {
    const original = await objectSecurity(owner);
    try {
      await owner.begin(async tx => {
        // Cluster-local, uncommitted fixture role; never visible to the A1 DB.
        // Remove baseline direct grants only inside this rollback to isolate the
        // membership path from the very default-ACL flaw under investigation.
        await tx.unsafe(`REVOKE ALL PRIVILEGES ON ${tableList} FROM PUBLIC, anon, authenticated`);
        await tx.unsafe("CREATE ROLE h1_acl_inherited NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS");
        await tx.unsafe(`GRANT h1_acl_inherited TO authenticated WITH INHERIT ${inherit ? "TRUE" : "FALSE"}, SET TRUE`);
        await tx.unsafe("GRANT TRUNCATE ON public.historical_estimate_import_lines TO h1_acl_inherited");
        const [inherited] = await tx.unsafe("select has_table_privilege('authenticated','public.historical_estimate_import_lines','TRUNCATE') as allowed");
        expect(inherited.allowed).toBe(inherit);
        const [assumable] = await tx.unsafe("select pg_has_role('authenticated','h1_acl_inherited','SET') as allowed");
        expect(assumable.allowed).toBe(true);
        // Remove only the new statement guards inside this outer rollback, so a
        // failed rerun must also undo newly created triggers, not only its REVOKE.
        const guards = await tx.unsafe("select t.tgname,c.relname from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and (t.tgtype::int & 32)=32 and not t.tgisinternal", [tables.slice()]);
        for (const guard of guards) await tx.unsafe(`DROP TRIGGER "${guard.tgname}" ON public.${guard.relname}`);
        const beforeAttempt = await objectSecurity(tx);
        await expect(tx.savepoint(async nested => { await applyMigration(nested); })).rejects.toMatchObject({ code: "23514", constraint_name: "historical_estimate_api_acl" });
        expect(await objectSecurity(tx)).toEqual(beforeAttempt);
        expect(await evidenceState(tx)).toEqual(seededState);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await objectSecurity(owner)).toEqual(original);
    expect(await owner`select rolname from pg_catalog.pg_roles where rolname='h1_acl_inherited'`).toHaveLength(0);
    expect(await evidenceState(owner)).toEqual(seededState);
  });

  it.each(["anon", "authenticated", "assumable"])("closes a column SELECT grant through %s without rewriting the role graph", async target => {
    const original = await objectSecurity(owner);
    try {
      await owner.begin(async tx => {
        const role = target === "assumable" ? "h1_acl_columns" : target;
        if (target === "assumable") {
          await tx.unsafe("CREATE ROLE h1_acl_columns NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS");
          await tx.unsafe("GRANT h1_acl_columns TO authenticated WITH INHERIT FALSE, SET TRUE");
        }
        await tx.unsafe(`GRANT SELECT (source_line_id) ON public.historical_estimate_import_lines TO "${role}"`);
        const [grants] = await tx.unsafe("select has_table_privilege($1,'public.historical_estimate_import_lines','SELECT') as whole_table, has_column_privilege($1,'public.historical_estimate_import_lines','source_line_id','SELECT') as column_only", [role]);
        expect(grants).toEqual({ whole_table: false, column_only: true });
        const beforeAttempt = await objectSecurity(tx);
        if (target === "assumable") {
          await expect(tx.savepoint(async nested => { await applyMigration(nested); })).rejects.toMatchObject({ code: "23514", constraint_name: "historical_estimate_api_acl" });
          expect(await objectSecurity(tx)).toEqual(beforeAttempt);
        } else {
          // PostgreSQL 17 REVOKE ALL on the table also removes this recipient's
          // column grant. Prove its removal instead of demanding a needless
          // refusal; grants on a separate reachable role must still fail closed.
          await applyMigration(tx);
          const [after] = await tx.unsafe("select has_table_privilege($1,'public.historical_estimate_import_lines','SELECT') as whole_table, has_column_privilege($1,'public.historical_estimate_import_lines','source_line_id','SELECT') as column_only", [role]);
          expect(after).toEqual({ whole_table: false, column_only: false });
        }
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await objectSecurity(owner)).toEqual(original);
    expect(await owner`select rolname from pg_catalog.pg_roles where rolname='h1_acl_columns'`).toHaveLength(0);
    expect(await evidenceState(owner)).toEqual(seededState);
  });
});
