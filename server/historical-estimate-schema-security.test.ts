import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../drizzle/schema";
import { schemaForLabDdl, withHistoricalLabPrerequisites } from "./test-support/ed-pilot-lab";

const tables = [schema.historicalEstimateSources, schema.historicalEstimateSourceLines, schema.historicalEstimateImports, schema.historicalEstimateImportLines];
const migrationFile = fileURLToPath(new URL("../drizzle/0005_historical_estimate_capture.sql", import.meta.url));

describe("H1 schema security and laboratory generation", () => {
  it.each(tables.map(table => [getTableConfig(table).name, table] as const))("enables RLS without policies on %s", (_name, table) => {
    const config = getTableConfig(table);
    expect(config.enableRLS).toBe(true);
    expect(config.policies).toEqual([]);
  });
  it("prepares the required pure function before generated constraints use it", async () => {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const generated = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schemaForLabDdl(schema)));
    const plan = withHistoricalLabPrerequisites(generated, await readFile(migrationFile, "utf8"));
    const definition = plan.findIndex(statement => /CREATE FUNCTION public\.historical_estimate_valid_reconciliation/.test(statement));
    const constraint = plan.findIndex(statement => /CONSTRAINT "hei_findings"/.test(statement));
    expect(definition).toBeGreaterThanOrEqual(0);
    expect(constraint).toBeGreaterThan(definition);
    expect(plan.filter(statement => /CREATE TABLE/.test(statement))).toEqual(generated.filter(statement => /CREATE TABLE/.test(statement)));
    expect(plan.some(statement => /CREATE TRIGGER|CREATE CONSTRAINT TRIGGER|CREATE POLICY|GRANT /.test(statement))).toBe(false);
  });
  it("builds composite unique anchors before foreign keys reference them", async () => {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const generated = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schemaForLabDdl(schema)));
    const plan = withHistoricalLabPrerequisites(generated, await readFile(migrationFile, "utf8"));
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

const physicalConfig = process.env.H1_PHYSICAL_CONFIG;
let raw: ReturnType<typeof postgres> | undefined;
describe.skipIf(!physicalConfig)("H1 physical RLS metadata (not owner/BYPASSRLS enforcement)", () => {
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
  it("records RLS enabled and no permissive policies on all four new tables", async () => {
    const rows = await raw!`select c.relname,c.relrowsecurity,(select count(*)::int from pg_catalog.pg_policy p where p.polrelid=c.oid) as policy_count from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('historical_estimate_sources','historical_estimate_source_lines','historical_estimate_imports','historical_estimate_import_lines') order by c.relname`;
    expect(rows).toHaveLength(4);
    expect(rows.map(row => ({...row}))).toEqual(tables.map(table => ({relname:getTableConfig(table).name,relrowsecurity:true,policy_count:0})).sort((a,b)=>a.relname.localeCompare(b.relname)));
  });
});
