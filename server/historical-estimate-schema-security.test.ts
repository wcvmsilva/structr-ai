import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../drizzle/schema";
import { schemaForLabDdl, withHistoricalLabPrerequisites } from "./test-support/ed-pilot-lab";
import { startAppPrincipalPostgres, type AppPrincipalCluster } from "./test-support/app-principal-postgres";

const tables = [schema.historicalEstimateSources, schema.historicalEstimateSourceLines, schema.historicalEstimateImports, schema.historicalEstimateImportLines];
const migrationFile = fileURLToPath(new URL("../drizzle/0005_historical_estimate_capture.sql", import.meta.url));
const approvalMigrationFile = fileURLToPath(new URL("../drizzle/0007_internal_estimate_approval_core.sql", import.meta.url));

describe("H1 schema security and laboratory generation", () => {
  let generated: string[];
  let historical: string, approval: string;
  beforeAll(async () => {
    // Load the generator and build the shared DDL fixture once. Cold dependency
    // loading belongs to bounded setup, not either prerequisite-order assertion.
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    generated = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schemaForLabDdl(schema)));
    [historical, approval] = await Promise.all([
      readFile(migrationFile, "utf8"), readFile(approvalMigrationFile, "utf8"),
    ]);
  }, 30_000);
  it.each(tables.map(table => [getTableConfig(table).name, table] as const))("keeps %s RLS closed except for the dedicated read/lock witness policies", (name, table) => {
    const config = getTableConfig(table);
    expect(config.enableRLS).toBe(true);
    const dialect = new PgDialect();
    expect(config.policies.map(policy => ({ name: policy.name, command: policy.for,
      role: (policy.to as { name: string }).name, mode: policy.as ?? "permissive",
      using: policy.using ? dialect.sqlToQuery(policy.using).sql : null,
      check: policy.withCheck ? dialect.sqlToQuery(policy.withCheck).sql : null,
    }))).toEqual(name === "historical_estimate_imports" ? [
      { name: "adr002_h1_select", command: "select", role: "structr_review_owner_v1", mode: "permissive", using: "true", check: null },
      { name: "adr002_h1_lock", command: "update", role: "structr_review_owner_v1", mode: "permissive", using: "true", check: "false" },
      { name: "adr002_h1_select_read_v1", command: "select", role: "structr_estimate_read_owner_v1", mode: "permissive", using: "true", check: null },
      { name: "adr002_h1_lock_read_v1", command: "update", role: "structr_estimate_read_owner_v1", mode: "permissive", using: "true", check: "false" },
    ] : []);
  });
  it("mirrors IF-1's two owner-only configuration policies without an UPDATE check grant", () => {
    const config = getTableConfig(schema.authenticatedBoundaryConfig);
    const dialect = new PgDialect();
    expect(config.enableRLS).toBe(true);
    expect(config.policies.filter(policy => (policy.to as { name: string }).name === "structr_intake_create_owner_v1")
      .map(policy => ({ name: policy.name, command: policy.for, mode: policy.as ?? "permissive",
        using: policy.using ? dialect.sqlToQuery(policy.using).sql : null,
        check: policy.withCheck ? dialect.sqlToQuery(policy.withCheck).sql : null,
      }))).toEqual([
        { name: "intake_formation_config_select", command: "select", mode: "permissive", using: "true", check: null },
        { name: "intake_formation_config_lock", command: "update", mode: "permissive", using: "true", check: "false" },
      ]);
  });
  it("mirrors only SWR-1 configuration read and lock policies for its dedicated existing owner", () => {
    const config = getTableConfig(schema.authenticatedBoundaryConfig);
    const dialect = new PgDialect();
    expect(config.enableRLS).toBe(true);
    expect(config.policies.filter(policy => (policy.to as { name: string }).name === "structr_scope_workspace_read_owner_v1")
      .map(policy => ({ name: policy.name, command: policy.for, mode: policy.as ?? "permissive",
        using: policy.using ? dialect.sqlToQuery(policy.using).sql : null,
        check: policy.withCheck ? dialect.sqlToQuery(policy.withCheck).sql : null,
      }))).toEqual([
        { name: "scope_workspace_config_select", command: "select", mode: "permissive", using: "true", check: null },
        { name: "scope_workspace_config_lock", command: "update", mode: "permissive", using: "true", check: "false" },
      ]);
  });
  it("prepares the required pure function before generated constraints use it", () => {
    const plan = withHistoricalLabPrerequisites(generated, historical, approval);
    const definition = plan.findIndex(statement => /CREATE FUNCTION public\.historical_estimate_valid_reconciliation/.test(statement));
    const constraint = plan.findIndex(statement => /CONSTRAINT "hei_findings"/.test(statement));
    expect(definition).toBeGreaterThanOrEqual(0);
    expect(constraint).toBeGreaterThan(definition);
    expect(plan.filter(statement => /CREATE TABLE/.test(statement))).toEqual(generated.filter(statement => /CREATE TABLE/.test(statement)));
    expect(plan.some(statement => /CREATE (?:CONSTRAINT )?TRIGGER|CREATE ROLE|\bGRANT\b|\bREVOKE\b/.test(statement))).toBe(false);
    // Preserve the exact policies emitted by the current schema; the prerequisite
    // extractor must not import additional migration security or role creation.
    const policies = generated.filter(statement => /^CREATE POLICY/.test(statement));
    expect(policies).toHaveLength(18);
    expect(plan.filter(statement => /^CREATE POLICY/.test(statement))).toEqual(policies);
  });
  it("builds composite unique anchors before foreign keys reference them", () => {
    const plan = withHistoricalLabPrerequisites(generated, historical, approval);
    for (const [index, foreignKey] of [["uq_projects_historical_identity", "hes_project_fk"], ["uq_hes_context", "hei_source_fk"], ["uq_hei_context", "hei_prior_fk"]]) {
      const anchorPosition = plan.findIndex(statement => statement.startsWith("CREATE UNIQUE INDEX") && statement.includes(index));
      const constraintPosition = plan.findIndex(statement => statement.startsWith("ALTER TABLE") && statement.includes(foreignKey));
      expect(anchorPosition).toBeGreaterThanOrEqual(0);
      expect(constraintPosition).toBeGreaterThan(anchorPosition);
    }
    expect(plan.filter(statement => statement.startsWith("ALTER TABLE") && statement.includes("FOREIGN KEY"))).toEqual(generated.filter(statement => statement.startsWith("ALTER TABLE") && statement.includes("FOREIGN KEY")));
  });
  it("does not install unrelated migration statements in a lab without the constraint", () => {
    expect(withHistoricalLabPrerequisites(["SELECT 1"], "CREATE TABLE unrelated (id int);")).toEqual(["SELECT 1"]);
  });
  it("fails closed if the canonical prerequisite is absent or duplicated", async () => {
    const referenced = ['CHECK (public.historical_estimate_valid_reconciliation(report, state))'];
    expect(() => withHistoricalLabPrerequisites(referenced, "")).toThrow();
    const migration = await readFile(migrationFile, "utf8");
    expect(() => withHistoricalLabPrerequisites(referenced, migration + "\n--> statement-breakpoint\n" + migration)).toThrow();
  });
});

describe.skipIf(process.env.APP_PRINCIPAL_LAB !== "1" || process.env.H1_GENERATED_SCHEMA_LAB !== "1")("H1 current generated schema in an owned PostgreSQL (not migration/RPC authority)", () => {
  let cluster: AppPrincipalCluster;
  let generated: string[];
  let historical: string, approval: string;
  beforeAll(async () => {
    cluster = await startAppPrincipalPostgres(postgres);
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    generated = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schemaForLabDdl(schema)));
    historical = await readFile(migrationFile, "utf8"); approval = await readFile(approvalMigrationFile, "utf8");
  }, 60_000);
  afterAll(async () => {
    if (!cluster) return;
    const directory = cluster.directory;
    await cluster.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("H1_GENERATED_SCHEMA_LAB_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 20_000);
  it("refuses policy creation without the explicitly prepared existing role and rolls all DDL back", async () => {
    const plan = withHistoricalLabPrerequisites(generated, historical, approval);
    await expect(cluster.observer.sql.begin(async tx => {
      for (const statement of plan) await tx.unsafe(statement);
    })).rejects.toMatchObject({ code: "42704", message: 'role "structr_review_owner_v1" does not exist' });
    const [remaining] = await cluster.observer.sql`SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema IN ('public','structr_private') AND table_type='BASE TABLE'`;
    expect(remaining.count).toBe(0);
  });
  it("applies the complete generated schema with four explicit unprivileged role prerequisites and separate schema counts", async () => {
    const plan = withHistoricalLabPrerequisites(generated, historical, approval, { prepareExistingReviewRoleForOwnedLab: true });
    // The old prerequisite prepares only the review owner. The current schema
    // also references the distinct 0017 read, 0018 formation and 0019 workspace owners; role
    // creation alone grants no table, function or schema authority.
    await expect(cluster.observer.sql.begin(async tx => {
      for (const statement of plan) await tx.unsafe(statement);
    })).rejects.toMatchObject({ code: "42704", message: 'role "structr_estimate_read_owner_v1" does not exist' });
    const [rolledBack] = await cluster.observer.sql`SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema IN ('public','structr_private') AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('structr_review_owner_v1','structr_estimate_read_owner_v1','structr_intake_create_owner_v1','structr_scope_workspace_read_owner_v1')) AS roles`;
    expect({ ...rolledBack }).toEqual({ tables: 0, roles: 0 });
    await expect(cluster.observer.sql.begin(async tx => {
      await tx.unsafe("CREATE ROLE structr_estimate_read_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      for (const statement of plan) await tx.unsafe(statement);
    })).rejects.toMatchObject({ code: "42704", message: 'role "structr_intake_create_owner_v1" does not exist' });
    const [formationRolledBack] = await cluster.observer.sql`SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema IN ('public','structr_private') AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('structr_review_owner_v1','structr_estimate_read_owner_v1','structr_intake_create_owner_v1','structr_scope_workspace_read_owner_v1')) AS roles`;
    expect({ ...formationRolledBack }).toEqual({ tables: 0, roles: 0 });
    await expect(cluster.observer.sql.begin(async tx => {
      await tx.unsafe("CREATE ROLE structr_estimate_read_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      await tx.unsafe("CREATE ROLE structr_intake_create_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      for (const statement of plan) await tx.unsafe(statement);
    })).rejects.toMatchObject({ code: "42704", message: 'role "structr_scope_workspace_read_owner_v1" does not exist' });
    const [workspaceRolledBack] = await cluster.observer.sql`SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema IN ('public','structr_private') AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('structr_review_owner_v1','structr_estimate_read_owner_v1','structr_intake_create_owner_v1','structr_scope_workspace_read_owner_v1')) AS roles`;
    expect({ ...workspaceRolledBack }).toEqual({ tables: 0, roles: 0 });
    await expect(cluster.observer.sql.begin(async tx => {
      await tx.unsafe("CREATE ROLE structr_estimate_read_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      await tx.unsafe("CREATE ROLE structr_intake_create_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      await tx.unsafe("CREATE ROLE structr_scope_workspace_read_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      for (const statement of plan) await tx.unsafe(statement);
    })).resolves.toBeUndefined();
    const actual = await cluster.observer.sql`SELECT table_schema AS schema,count(*)::int AS count FROM information_schema.tables
      WHERE table_schema IN ('public','structr_private') AND table_type='BASE TABLE' GROUP BY table_schema ORDER BY table_schema`;
    expect(actual.map(row => ({ ...row }))).toEqual([{ schema: "public", count: 90 }, { schema: "structr_private", count: 1 }]);
    const roles = await cluster.observer.sql`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
      FROM pg_roles WHERE rolname IN ('structr_review_owner_v1','structr_estimate_read_owner_v1','structr_intake_create_owner_v1','structr_scope_workspace_read_owner_v1') ORDER BY rolname`;
    expect(roles.map(row => ({ ...row }))).toEqual(["structr_estimate_read_owner_v1", "structr_intake_create_owner_v1", "structr_review_owner_v1", "structr_scope_workspace_read_owner_v1"].map(rolname => ({
      rolname, rolcanlogin: false, rolinherit: false, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolreplication: false, rolbypassrls: false })));
    const [state] = await cluster.observer.sql`SELECT
      (SELECT count(*)::int FROM pg_policy) AS policies,
      (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
      (SELECT count(*)::int FROM structr_private.authenticated_boundary_config) AS issuer_rows,
      (SELECT count(*)::int FROM pg_auth_members WHERE roleid IN ('structr_review_owner_v1'::regrole,'structr_estimate_read_owner_v1'::regrole,'structr_intake_create_owner_v1'::regrole,'structr_scope_workspace_read_owner_v1'::regrole)
        OR member IN ('structr_review_owner_v1'::regrole,'structr_estimate_read_owner_v1'::regrole,'structr_intake_create_owner_v1'::regrole,'structr_scope_workspace_read_owner_v1'::regrole)) AS memberships,
      (SELECT count(*)::int FROM pg_class WHERE relowner IN ('structr_review_owner_v1'::regrole,'structr_estimate_read_owner_v1'::regrole,'structr_intake_create_owner_v1'::regrole,'structr_scope_workspace_read_owner_v1'::regrole)) AS owned_relations`;
    expect({ ...state }).toEqual({ policies: 18, triggers: 0, issuer_rows: 0, memberships: 0, owned_relations: 0 });
    const expectedPolicies = [
      ["structr_private", "authenticated_boundary_config", "adr002_config", "structr_review_owner_v1", ""],
      ["structr_private", "authenticated_boundary_config", "adr002_config", "structr_estimate_read_owner_v1", "_read_v1"],
      ["structr_private", "authenticated_boundary_config", "intake_formation_config", "structr_intake_create_owner_v1", ""],
      ["structr_private", "authenticated_boundary_config", "scope_workspace_config", "structr_scope_workspace_read_owner_v1", ""],
      ["public", "historical_estimate_imports", "adr002_h1", "structr_review_owner_v1", ""],
      ["public", "historical_estimate_imports", "adr002_h1", "structr_estimate_read_owner_v1", "_read_v1"],
      ["public", "estimate_internal_approval_snapshots", "adr002_snapshot", "structr_review_owner_v1", ""],
      ["public", "estimate_internal_approvals", "adr002_approval", "structr_review_owner_v1", ""],
      ["public", "estimate_internal_approval_revocations", "adr002_revocation", "structr_review_owner_v1", ""],
    ].flatMap(([schemaName, tableName, prefix, owner, suffix]) => [
      { schema_name: schemaName, table_name: tableName, name: `${prefix}_select${suffix}`, command: "r", permissive: true,
        roles: [owner], using_expr: "true", check_expr: null },
      { schema_name: schemaName, table_name: tableName, name: `${prefix}_lock${suffix}`, command: "w", permissive: true,
        roles: [owner], using_expr: "true", check_expr: "false" },
    ]).sort((a,b) => a.name.localeCompare(b.name));
    const policies = await cluster.observer.sql`SELECT n.nspname AS schema_name,c.relname AS table_name,p.polname AS name,
      p.polcmd::text AS command,p.polpermissive AS permissive,
      ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid=ANY(p.polroles) ORDER BY r.rolname) AS roles,
      pg_get_expr(p.polqual,p.polrelid) AS using_expr,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expr
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY p.polname`;
    expect(policies.map(row => ({ ...row }))).toEqual(expectedPolicies);
    for (const role of ["structr_review_owner_v1", "structr_estimate_read_owner_v1", "structr_intake_create_owner_v1", "structr_scope_workspace_read_owner_v1"]) {
      await expect(cluster.observer.sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT id FROM public.historical_estimate_imports`;
      })).rejects.toMatchObject({ code: "42501" });
      await expect(cluster.observer.sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT id FROM structr_private.authenticated_boundary_config`;
      })).rejects.toMatchObject({ code: "42501" });
      await expect(cluster.observer.sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`UPDATE public.historical_estimate_imports SET id=id`;
      })).rejects.toMatchObject({ code: "42501" });
    }
  });
});

const physicalConfig = process.env.H1_PHYSICAL_CONFIG;
let raw: ReturnType<typeof postgres> | undefined;
// This external opt-in fixture replays the historical H1 boundary (0005/0006),
// before ADR-002. Current ORM/0015 policies are proved in the suites above and
// adr002-review-record-physical.test.ts; do not require them in this baseline.
describe.skipIf(!physicalConfig)("Historical H1 physical RLS metadata (before ADR-002; not owner/BYPASSRLS enforcement)", () => {
  beforeAll(async () => {
    const config = JSON.parse(await readFile(physicalConfig!, "utf8")) as {directory:string;dataDirectory:string;socketDirectory:string;database:string;user:string;port:number};
    const directory = await realpath(config.directory);
    if (!/^\/private\/tmp\/structr-h1-[^/]+$/.test(directory) || directory !== resolve(config.directory) || config.database !== "h1_test" || config.user !== "h1_lab" || !Number.isInteger(config.port)) throw new Error("Not an owned H1 laboratory");
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory + sep) || !socketDirectory.startsWith(directory + sep) || socketDirectory !== resolve(config.socketDirectory)) throw new Error("H1 paths escape owned directory");
    raw = postgres({host:socketDirectory,database:config.database,username:config.user,port:config.port,ssl:false,max:1,prepare:false});
    const [identity] = await raw`select current_database() as database,current_user as username,current_setting('data_directory') as data_directory,current_setting('unix_socket_directories') as socket_directories,current_setting('listen_addresses') as listen_addresses,current_setting('port') as port,inet_server_addr() as server_address`;
    if (identity.database !== config.database || identity.username !== config.user || await realpath(identity.data_directory) !== dataDirectory || identity.socket_directories !== socketDirectory || identity.listen_addresses !== "" || Number(identity.port) !== config.port || identity.server_address !== null) throw new Error("H1 server identity mismatch");
  });
  afterAll(async () => { await raw?.end(); });
  it("records historical RLS with zero policies on all four H1 tables", async () => {
    const rows = await raw!`select c.relname,c.relrowsecurity,(select count(*)::int from pg_catalog.pg_policy p where p.polrelid=c.oid) as policy_count from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('historical_estimate_sources','historical_estimate_source_lines','historical_estimate_imports','historical_estimate_import_lines') order by c.relname`;
    expect(rows).toHaveLength(4);
    expect(rows.map(row => ({...row}))).toEqual(tables.map(table => ({relname:getTableConfig(table).name,relrowsecurity:true,
      policy_count:0})).sort((a,b)=>a.relname.localeCompare(b.relname)));
  });
});
