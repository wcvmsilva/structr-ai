/** Exact installed-boundary verification; read-only, never provisions or repairs. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { CATALOG_SHA256, LOGIN_ROLE, fail } from "./contract";
type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
async function query(
  tx: Pick<Tx, "execute">,
  q: SQL
): Promise<Record<string, any>[]> {
  return (await tx.execute(q)) as unknown as Record<string, any>[];
}
export async function assertCalculatorBoundary(tx: Tx): Promise<string> {
  const [version] = await query(
    tx,
    sql`SELECT current_setting('server_version_num') AS version`
  );
  if (version.version !== "170011") fail("VERSION");
  try {
    await tx.execute(
      sql.raw(
        await readFile(new URL("./preflight.sql", import.meta.url), "utf8")
      )
    );
  } catch {
    fail("PRIVILEGE_PREFLIGHT");
  }
  const unsafe = await query(
    tx,
    sql`SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') AND (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolconfig IS NOT NULL OR (r.rolname<>${LOGIN_ROLE} AND r.rolcanlogin))`
  );
  const members = await query(
    tx,
    sql`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') AND NOT(r.oid=m.roleid AND m.member='postgres'::regrole AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)`
  );
  if (unsafe.length || members.length) fail("ROLE_PREFLIGHT");
  const [roles] = await query(
    tx,
    sql`SELECT count(*)::int AS count FROM pg_roles WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')`
  );
  if (roles.count !== 3) fail("ROLE_PREFLIGHT");
  const excess = await query(
    tx,
    sql`SELECT 'relation' AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND NOT(n.nspname='extensions' AND c.relname IN ('pg_stat_statements','pg_stat_statements_info') AND NOT has_schema_privilege(${LOGIN_ROLE},n.oid,'USAGE')) AND ((c.relkind='S' AND has_sequence_privilege(${LOGIN_ROLE},c.oid,'SELECT,UPDATE,USAGE')) OR (c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(${LOGIN_ROLE},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(${LOGIN_ROLE},c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))) UNION ALL SELECT 'schema' FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(${LOGIN_ROLE},n.oid,'CREATE') UNION ALL SELECT 'database' WHERE has_database_privilege(${LOGIN_ROLE},current_database(),'CREATE,TEMPORARY') UNION ALL SELECT 'function' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(${LOGIN_ROLE},p.oid,'EXECUTE') AND (n.nspname IN ('public','structr_private','structr_financial') OR has_schema_privilege(${LOGIN_ROLE},n.oid,'USAGE')) AND p.oid<>ALL(ARRAY['structr_financial.calculator_context_v1(jsonb)'::regprocedure::oid,'structr_financial.calculator_snapshot_v1(jsonb)'::regprocedure::oid,'structr_financial.calculator_create_v1(jsonb,jsonb)'::regprocedure::oid,'structr_financial.calculator_recover_v1(jsonb)'::regprocedure::oid])`
  );
  if (excess.length) fail("PRIVILEGE_PREFLIGHT");
  await tx.execute(sql.raw("SET LOCAL search_path=pg_catalog"));
  const catalog = await query(
    tx,
    sql.raw(await readFile(new URL("./catalog.sql", import.meta.url), "utf8"))
  );
  const observed = createHash("sha256")
    .update(catalog.map(r => `${r.identity}:${r.sha256}`).join("\n"))
    .digest("hex");
  if (catalog.length !== 1108 || observed !== CATALOG_SHA256)
    fail("CATALOG_PREFLIGHT");
  await tx.execute(sql.raw("SET LOCAL search_path=pg_catalog,public,pg_temp"));
  return observed;
}

/** Only for the caller's audited administrative transaction, never a runtime path.
 * CREATEROLE's automatic ADMIN edges remain; transient self-granted owner rights
 * exist only around the fixed withdrawal operation and cannot survive this call.
 */
export async function withCalculatorOwnerMaintenance<T>(
  tx: Tx,
  operation: () => Promise<T>
): Promise<T> {
  const [identity] = await query(
    tx,
    sql`SELECT current_user AS principal,session_user AS session,r.rolsuper FROM pg_roles r WHERE r.rolname=current_user`
  );
  if (identity?.principal !== identity?.session) fail("MAINTENANCE_PRINCIPAL");
  if (identity.rolsuper) return operation(); // owned disposable laboratory only
  if (identity.principal !== "postgres") fail("MAINTENANCE_PRINCIPAL");
  const edges = () =>
    query(
      tx,
      sql`SELECT r.rolname,m.member::regrole::text AS member,m.grantor::regrole::text AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') ORDER BY r.rolname,m.member::regrole::text,m.grantor::regrole::text`
    );
  const before = await edges();
  if (
    before.length !== 3 ||
    new Set(before.map(r => r.rolname)).size !== 3 ||
    before.some(
      r =>
        r.member !== "postgres" ||
        !r.admin_option ||
        r.inherit_option ||
        r.set_option ||
        r.grantor === "postgres"
    )
  )
    fail("MAINTENANCE_MEMBERSHIP");
  await tx.execute(
    sql.raw(
      "GRANT structr_calculator_read_owner_v1,structr_calculator_write_owner_v1 TO postgres WITH INHERIT TRUE,SET FALSE"
    )
  );
  try {
    const during = await edges();
    const temporary = during.filter(r => r.grantor === "postgres");
    if (
      during.length !== 5 ||
      temporary.length !== 2 ||
      temporary.some(
        r =>
          r.member !== "postgres" ||
          r.rolname === "structr_calculator_login_v1" ||
          r.admin_option ||
          !r.inherit_option ||
          r.set_option
      )
    )
      fail("MAINTENANCE_MEMBERSHIP");
    return await operation();
  } finally {
    await tx.execute(
      sql.raw(
        "REVOKE structr_calculator_read_owner_v1,structr_calculator_write_owner_v1 FROM postgres GRANTED BY postgres"
      )
    );
    if (JSON.stringify(await edges()) !== JSON.stringify(before))
      fail("MAINTENANCE_MEMBERSHIP");
  }
}
