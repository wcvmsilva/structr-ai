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
    ] : []);
  });
  it("prepares the required pure function before generated constraints use it", async () => {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const generated = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schemaForLabDdl(schema)));
    const plan = withHistoricalLabPrerequisites(generated, await readFile(migrationFile, "utf8"), await readFile(approvalMigrationFile, "utf8"));
    const definition = plan.findIndex(statement => /CREATE FUNCTION public\.historical_estimate_valid_reconciliation/.test(statement));
    const constraint = plan.findIndex(statement => /CONSTRAINT "hei_findings"/.test(statement));
    expect(definition).toBeGreaterThanOrEqual(0);
    expect(constraint).toBeGreaterThan(definition);
    expect(plan.filter(statement => /CREATE TABLE/.test(statement))).toEqual(generated.filter(statement => /CREATE TABLE/.test(statement)));
    expect(plan.some(statement => /CREATE (?:CONSTRAINT )?TRIGGER|CREATE ROLE|\bGRANT\b|\bREVOKE\b/.test(statement))).toBe(false);
    // Preserve the exact policies emitted by the current schema; the prerequisite
    // extractor must not import additional migration security or role creation.
    const policies = generated.filter(statement => /^CREATE POLICY/.test(statement));
    expect(policies).toHaveLength(10);
    expect(plan.filter(statement => /^CREATE POLICY/.test(statement))).toEqual(policies);
  });
  it("builds composite unique anchors before foreign keys reference them", async () => {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const generated = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schemaForLabDdl(schema)));
    const plan = withHistoricalLabPrerequisites(generated, await readFile(migrationFile, "utf8"), await readFile(approvalMigrationFile, "utf8"));
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
  it("applies the complete generated schema with an explicit unprivileged role prerequisite and separate schema counts", async () => {
    const plan = withHistoricalLabPrerequisites(generated, historical, approval, { prepareExistingReviewRoleForOwnedLab: true });
    await expect(cluster.observer.sql.begin(async tx => {
      for (const statement of plan) await tx.unsafe(statement);
    })).resolves.toBeUndefined();
    const actual = await cluster.observer.sql`SELECT table_schema AS schema,count(*)::int AS count FROM information_schema.tables
      WHERE table_schema IN ('public','structr_private') AND table_type='BASE TABLE' GROUP BY table_schema ORDER BY table_schema`;
    expect(actual.map(row => ({ ...row }))).toEqual([{ schema: "public", count: 90 }, { schema: "structr_private", count: 1 }]);
    const [role] = await cluster.observer.sql`SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
      FROM pg_roles WHERE rolname='structr_review_owner_v1'`;
    expect({ ...role }).toEqual({ rolcanlogin: false, rolinherit: false, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolreplication: false, rolbypassrls: false });
    const [state] = await cluster.observer.sql`SELECT
      (SELECT count(*)::int FROM pg_policy) AS policies,
      (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
      (SELECT count(*)::int FROM structr_private.authenticated_boundary_config) AS issuer_rows,
      (SELECT count(*)::int FROM pg_auth_members WHERE roleid='structr_review_owner_v1'::regrole OR member='structr_review_owner_v1'::regrole) AS memberships,
      (SELECT count(*)::int FROM pg_class WHERE relowner='structr_review_owner_v1'::regrole) AS owned_relations`;
    expect({ ...state }).toEqual({ policies: 10, triggers: 0, issuer_rows: 0, memberships: 0, owned_relations: 0 });
    await expect(cluster.observer.sql.begin(async tx => {
      await tx`SET LOCAL ROLE structr_review_owner_v1`;
      await tx`SELECT id FROM public.historical_estimate_imports`;
    })).rejects.toMatchObject({ code: "42501" });
    await expect(cluster.observer.sql.begin(async tx => {
      await tx`SET LOCAL ROLE structr_review_owner_v1`;
      await tx`UPDATE public.historical_estimate_imports SET id=id`;
    })).rejects.toMatchObject({ code: "42501" });
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
