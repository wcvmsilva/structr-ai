/** Disposable prerequisite fixture only; not a production installer/preflight. */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { startAppPrincipalPostgres } from "./app-principal-postgres";

export async function startFinancialCalculatorProbe() {
  if (process.env.FINANCIAL_CALCULATOR_PHYSICAL !== "1")
    throw new Error("Physical probe requires explicit opt-in");
  const cluster = await startAppPrincipalPostgres(postgres);
  const admin = cluster.observer.sql;
  try {
    const [version] =
      await admin`SELECT current_setting('server_version_num') AS version`;
    if (version.version !== "170011")
      throw new Error("This proof requires PostgreSQL 17.11");
    await admin.unsafe(
      "CREATE ROLE anon NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN BYPASSRLS"
    );
    const journal = JSON.parse(
      await readFile(
        new URL("../../drizzle/meta/_journal.json", import.meta.url),
        "utf8"
      )
    );
    const migrations: Array<{ tag: string; sha256: string }> = [];
    for (const { tag } of journal.entries as Array<{ tag: string }>) {
      if (Number(tag.slice(0, 4)) > 14) continue;
      const source = await readFile(
        new URL(`../../drizzle/${tag}.sql`, import.meta.url),
        "utf8"
      );
      await admin.begin(async tx => {
        await tx.unsafe(source);
      });
      migrations.push({
        tag,
        sha256: createHash("sha256").update(source).digest("hex"),
      });
    }
    // Explicit laboratory containment, never evidence that a hosted preflight works.
    await admin.unsafe(`
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,app_runtime,app_denied,anon,authenticated,service_role;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,app_runtime,app_denied,anon,authenticated,service_role;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,app_runtime,app_denied,anon,authenticated,service_role;
      CREATE ROLE financial_probe_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE SCHEMA financial_calculator_probe;
      REVOKE ALL ON SCHEMA financial_calculator_probe FROM PUBLIC;
      GRANT USAGE ON SCHEMA public,financial_calculator_probe TO financial_probe_owner,app_runtime;
      CREATE TABLE financial_calculator_probe.binding(login name PRIMARY KEY,tenant uuid,actor uuid,client uuid,project uuid);
      GRANT SELECT ON financial_calculator_probe.binding TO financial_probe_owner;
      GRANT INSERT(id,tenant_id,project_id,client_id,created_by,status,source,version) ON public.estimate_drafts TO financial_probe_owner;
      GRANT UPDATE(id) ON public.estimate_drafts TO financial_probe_owner;
    `);
    const evidenceTables = [
      "estimate_drafts",
      "estimate_internal_approval_snapshots",
      "estimate_internal_approvals",
      "estimate_internal_approval_revocations",
    ];
    const columns: Record<string, string[]> = {};
    for (const table of evidenceTables) {
      const rows =
        await admin`SELECT attname FROM pg_attribute WHERE attrelid=${`public.${table}`}::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`;
      columns[table] = rows.map(row => row.attname);
      // Column enumeration is derived for this test only, not a deployable grant manifest.
      await admin.unsafe(
        `GRANT SELECT(${columns[table].map(name => '"' + name.replaceAll('"', '""') + '"').join(",")}) ON public.${table} TO financial_probe_owner`
      );
      if (table !== "estimate_drafts")
        await admin.unsafe(
          `CREATE POLICY financial_probe_read ON public.${table} FOR SELECT TO financial_probe_owner USING(true)`
        );
    }
    const context = {
      tenant: randomUUID(),
      actor: randomUUID(),
      client: randomUUID(),
      project: randomUUID(),
    };
    await admin`INSERT INTO public.tenants(id,name,slug) VALUES(${context.tenant},'Synthetic financial probe',${context.tenant})`;
    await admin`INSERT INTO public.profiles(id,tenant_id,full_name) VALUES(${context.actor},${context.tenant},'Synthetic operator')`;
    await admin`INSERT INTO public.clients(id,tenant_id,name) VALUES(${context.client},${context.tenant},'Synthetic client')`;
    await admin`INSERT INTO public.projects(id,tenant_id,client_id,name,project_type) VALUES(${context.project},${context.tenant},${context.client},'Synthetic project','repair')`;
    await admin`INSERT INTO financial_calculator_probe.binding VALUES('app_runtime',${context.tenant},${context.actor},${context.client},${context.project})`;
    await admin.unsafe(
      await readFile(
        new URL("./financial-calculator/probe.sql", import.meta.url),
        "utf8"
      )
    );
    const caller = await cluster.connect("financial-calculator-real-login");
    const roles =
      await admin`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole,rolreplication
      FROM pg_roles WHERE rolname IN ('app_runtime','financial_probe_owner') ORDER BY rolname`;
    const privileges =
      await admin`SELECT c.relname,c.relrowsecurity,c.relowner::regrole::text AS owner,c.relacl::text AS table_acl,
      has_table_privilege('app_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS caller_table,
      has_any_column_privilege('app_runtime',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') AS caller_column,
      (SELECT jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl::text) ORDER BY a.attnum)
       FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS column_acls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('estimate_drafts','estimate_internal_approval_snapshots','estimate_internal_approvals','estimate_internal_approval_revocations') ORDER BY c.relname`;
    const trigger =
      await admin`SELECT tgname,pg_get_triggerdef(oid) AS definition,tgfoid::regprocedure::text AS routine
      FROM pg_trigger WHERE tgrelid='public.estimate_drafts'::regclass AND tgname='a1_draft_final'`;
    console.log(
      "FINANCIAL_PROBE_PRIVILEGES",
      JSON.stringify({ roles, privileges, trigger })
    );
    console.log(
      "FINANCIAL_PROBE_BASELINE",
      JSON.stringify({
        directory: cluster.directory,
        version: version.version,
        migrations,
        columns,
        callerPid: caller.pid,
        observerPid: cluster.observer.pid,
      })
    );
    return { cluster, admin, caller, context, columns };
  } catch (error) {
    await cluster.stop();
    throw error;
  }
}
