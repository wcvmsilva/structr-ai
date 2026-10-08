/** Real owned PG17: non-superuser table owner, effective ACL preflight and atomic rollback. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import postgres from "postgres";
import { startAppPrincipalPostgres, type AppPrincipalCluster } from "./test-support/app-principal-postgres";

const migrations = new URL("../drizzle/", import.meta.url);
const admin = "minimum_read_migration_admin";
describe.skipIf(process.env.ADR002_PHYSICAL !== "1")("ADR002 minimum-read migration lifecycle", () => {
  let cluster: AppPrincipalCluster, source: string;
  const sql = () => cluster.observer.sql;
  async function catalog() {
    return sql()`SELECT c.oid::regclass::text AS relation,c.relowner::regrole::text AS owner,c.relacl::text AS acl,
      (SELECT jsonb_agg(jsonb_build_object('name',attname,'acl',attacl::text) ORDER BY attnum)
        FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped) AS columns
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private') ORDER BY c.oid`;
  }
  beforeAll(async () => {
    if (process.env.ADR002_APPLY_BOUNDARY !== "1") throw new Error("Explicit owned boundary application required");
    cluster = await startAppPrincipalPostgres(postgres);
    await sql().unsafe(`CREATE ROLE ${admin} NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN NOBYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT anon,authenticated TO authenticator WITH INHERIT FALSE,SET TRUE;
      GRANT USAGE,CREATE ON SCHEMA public TO ${admin} WITH GRANT OPTION;
      GRANT CREATE ON DATABASE postgres TO ${admin}`);
    const journal = JSON.parse(await readFile(new URL("meta/_journal.json", migrations), "utf8"));
    for (const entry of journal.entries.filter((e: {idx:number}) => e.idx <= 14)) {
      const text = await readFile(new URL(`${entry.tag}.sql`, migrations), "utf8");
      await sql().begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${admin}`); await tx.unsafe(text); });
    }
    // Explicit laboratory containment; not a claim of unmodified legacy replay.
    await sql().unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
      REVOKE USAGE ON SCHEMA public FROM PUBLIC,anon,authenticated,authenticator`);
    for (const tag of ["0015_authenticated_review_boundary", "0016_authenticated_public_schema_usage"]) {
      const text = await readFile(new URL(`${tag}.sql`, migrations), "utf8");
      await sql().begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${admin}`); await tx.unsafe(text); });
    }
    source = await readFile(new URL("0017_authenticated_estimate_reads.sql", migrations), "utf8");
  }, 90_000);
  afterAll(async () => {
    if (!cluster) return;
    const directory = cluster.directory; await cluster.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("ADR002_MINIMUM_READ_MIGRATION_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 30_000);
  it.each([
    ["raw column access", "GRANT SELECT(notes) ON public.estimate_drafts TO authenticated", "ADR002_READ_RELATION_PREFLIGHT"],
    ["unknown executable function", "CREATE FUNCTION public.minimum_drift() RETURNS boolean LANGUAGE sql RETURN true", "ADR002_READ_FUNCTION_PREFLIGHT"],
    ["unknown readable view", "CREATE VIEW public.minimum_drift AS SELECT id FROM public.profiles; GRANT SELECT ON public.minimum_drift TO authenticated", "ADR002_READ_RELATION_PREFLIGHT"],
    ["private lookup access", "GRANT USAGE ON SCHEMA structr_private TO authenticated", "ADR002_READ_ROLE_PREFLIGHT"],
    ["restrictive historical policy", "CREATE POLICY minimum_drift ON public.historical_estimate_imports AS RESTRICTIVE FOR SELECT TO authenticated USING(false)", "ADR002_READ_RLS_PREFLIGHT"],
    ["restrictive config policy", "CREATE POLICY minimum_drift ON structr_private.authenticated_boundary_config AS RESTRICTIVE FOR SELECT TO authenticated USING(false)", "ADR002_READ_RLS_PREFLIGHT"],
    ["missing UPDATE WITH CHECK", "DROP POLICY adr002_h1_lock ON public.historical_estimate_imports; CREATE POLICY adr002_h1_lock ON public.historical_estimate_imports FOR UPDATE TO structr_review_owner_v1 USING(true)", "ADR002_READ_RLS_PREFLIGHT"],
    ["missing SELECT USING", "DROP POLICY adr002_h1_select ON public.historical_estimate_imports; CREATE POLICY adr002_h1_select ON public.historical_estimate_imports FOR SELECT TO structr_review_owner_v1", "ADR002_READ_RLS_PREFLIGHT"],
    ["two SELECT policies instead of SELECT and UPDATE", "DROP POLICY adr002_h1_lock ON public.historical_estimate_imports; CREATE POLICY adr002_h1_lock ON public.historical_estimate_imports FOR SELECT TO structr_review_owner_v1 USING(true)", "ADR002_READ_RLS_PREFLIGHT"],
  ])("refuses %s and rolls all attempted changes back", async (_name, drift, message) => {
    const before = await catalog();
    await expect(sql().begin(async tx => {
      await tx.unsafe(drift); await tx.unsafe(`SET LOCAL ROLE ${admin}`); await tx.unsafe(source);
      throw new Error("Unsafe drift was accepted; force rollback of this negative probe");
    })).rejects.toMatchObject({ code: "42501", message });
    expect(await catalog()).toEqual(before);
    expect(await sql()`SELECT to_regrole('structr_estimate_read_owner_v1') AS owner,
      to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)') AS wrapper`).toEqual([{ owner: null, wrapper: null }]);
  });
  it("rolls back the entire completed migration after a final transaction failure", async () => {
    const before = await catalog();
    await expect(sql().begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${admin}`); await tx.unsafe(source);
      await tx.unsafe("DO $$ BEGIN RAISE EXCEPTION 'MINIMUM_READS_ROLLBACK'; END $$");
    })).rejects.toMatchObject({ code: "P0001", message: "MINIMUM_READS_ROLLBACK" });
    expect(await catalog()).toEqual(before);
    expect(await sql()`SELECT to_regrole('structr_estimate_read_owner_v1') AS owner,
      (SELECT count(*)::int FROM pg_policy WHERE polname LIKE '%_read_v1') AS policies`).toEqual([{ owner: null, policies: 0 }]);
  });
  it("installs as non-superuser and preserves existing owner grants while withdrawing temporary authority", async () => {
    const grants = () => sql()`SELECT c.oid::regclass::text AS relation,a.attname,acl.privilege_type
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid CROSS JOIN LATERAL aclexplode(a.attacl) acl
      WHERE acl.grantee='structr_review_owner_v1'::regrole ORDER BY c.oid,a.attname,acl.privilege_type`;
    const before = await grants();
    await sql().begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${admin}`);
      expect(await tx`SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user`)
        .toEqual([{ rolsuper: false, rolcreaterole: true }]);
      await tx.unsafe(source);
    });
    expect(await grants()).toEqual(before);
    expect(await sql()`SELECT rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
      FROM pg_roles WHERE rolname='structr_estimate_read_owner_v1'`).toEqual([
      { rolcanlogin: false, rolinherit: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false },
    ]);
    for (const owner of ["structr_review_owner_v1", "structr_estimate_read_owner_v1"]) {
      expect(await sql()`SELECT pg_has_role(${admin},${owner},'SET') AS can_set,pg_has_role(${admin},${owner},'USAGE') AS inherits,
        has_schema_privilege(${owner},'structr_private','CREATE') AS can_create,
        (SELECT count(*)::int FROM pg_class WHERE relowner=${owner}::regrole) AS tables`)
        .toEqual([{ can_set: false, inherits: false, can_create: false, tables: 0 }]);
    }
    expect(await sql()`SELECT count(*)::int AS policies FROM pg_policy WHERE polname LIKE '%_read_v1'`).toEqual([{ policies: 4 }]);
  });
});
