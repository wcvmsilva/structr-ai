/** Candidate only: owned PG17, non-superuser migration, effective ACLs and atomic rollback. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import postgres from "postgres";
import { startAppPrincipalPostgres, type AppPrincipalCluster } from "./test-support/app-principal-postgres";

const migrations = new URL("../drizzle/", import.meta.url);
const candidate = new URL("../docs/security/intake-formation/0018_authenticated_intake_formation.candidate.sql", import.meta.url);
const admin = "intake_formation_migration_admin";
const owner = "structr_intake_create_owner_v1";
const existingOwners = ["structr_review_owner_v1", "structr_estimate_read_owner_v1"];
const enabled = process.env.ADR002_PHYSICAL === "1" && process.env.ADR002_INTAKE_FORMATION === "1";

describe.skipIf(!enabled)("ADR002 candidate intake formation migration lifecycle", () => {
  let cluster: AppPrincipalCluster, source: string;
  const sql = () => cluster.observer.sql;

  // Include function bodies, policies, triggers and memberships: table ACL equality
  // alone cannot prove that a failed migration left the authorization boundary intact.
  async function catalog() {
    const [snapshot] = await sql()`SELECT jsonb_build_object(
      'relations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
        SELECT c.oid::regclass::text AS name,c.relowner::regrole::text AS owner,c.relacl::text AS acl,
          c.relrowsecurity,c.relforcerowsecurity,
          (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private')) x),
      'functions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
        SELECT p.oid::regprocedure::text AS name,p.proowner::regrole::text AS owner,p.proacl::text AS acl,pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','structr_private')) x),
      'schemas',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
        SELECT nspname AS name,nspowner::regrole::text AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname IN ('public','structr_private')) x),
      'roles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rolname) FROM (
        SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig FROM pg_roles) x),
      'memberships',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role,x.member,x.grantor) FROM (
        SELECT roleid::regrole::text AS role,member::regrole::text AS member,grantor::regrole::text AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members) x),
      'policies',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.relation,x.polname) FROM (
        SELECT polrelid::regclass::text AS relation,polname,polcmd,polpermissive,polroles,
          pg_get_expr(polqual,polrelid) AS using_expression,pg_get_expr(polwithcheck,polrelid) AS check_expression FROM pg_policy) x),
      'triggers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.relation,x.tgname) FROM (
        SELECT tgrelid::regclass::text AS relation,tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal) x),
      'constraints',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.relation,x.conname) FROM (
        SELECT conrelid::regclass::text AS relation,conname,convalidated,pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','structr_private')) x),
      'indexes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.indexname) FROM (
        SELECT indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','structr_private')) x)
    ) AS value`;
    return snapshot.value;
  }

  async function oldOwnerAuthority() {
    return sql()`SELECT 'column' AS kind,n.nspname||'.'||c.relname||'.'||a.attname AS object,
        acl.grantee::regrole::text AS grantee,acl.privilege_type AS privilege,acl.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE acl.grantee::regrole::text=ANY(${existingOwners})
      UNION ALL SELECT 'table',n.nspname||'.'||c.relname,acl.grantee::regrole::text,acl.privilege_type,acl.is_grantable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) acl
        WHERE acl.grantee::regrole::text=ANY(${existingOwners})
      UNION ALL SELECT 'function',p.oid::regprocedure::text,acl.grantee::regrole::text,acl.privilege_type,acl.is_grantable
        FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE acl.grantee::regrole::text=ANY(${existingOwners})
      UNION ALL SELECT 'owned function',p.oid::regprocedure::text,p.proowner::regrole::text,'OWNER',false
        FROM pg_proc p WHERE p.proowner::regrole::text=ANY(${existingOwners})
      UNION ALL SELECT 'schema',n.nspname,acl.grantee::regrole::text,acl.privilege_type,acl.is_grantable
        FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) acl WHERE acl.grantee::regrole::text=ANY(${existingOwners})
      ORDER BY 1,2,3,4`;
  }

  async function apiExecutables() {
    return sql()`SELECT r.rolname AS role,n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS routine
      FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE r.rolname IN ('anon','authenticated','authenticator') AND n.nspname IN ('public','structr_private')
        AND has_function_privilege(r.oid,p.oid,'EXECUTE') ORDER BY 1,2`;
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
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx <= 14)) {
      const migration = await readFile(new URL(`${entry.tag}.sql`, migrations), "utf8");
      await sql().begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${admin}`); await tx.unsafe(migration); });
    }
    // Explicit containment of the disposable legacy baseline, as in the 0017 suite.
    await sql().unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
      REVOKE USAGE ON SCHEMA public FROM PUBLIC,anon,authenticated,authenticator`);
    for (const tag of ["0015_authenticated_review_boundary", "0016_authenticated_public_schema_usage", "0017_authenticated_estimate_reads"]) {
      const migration = await readFile(new URL(`${tag}.sql`, migrations), "utf8");
      await sql().begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${admin}`); await tx.unsafe(migration); });
    }
    try { source = await readFile(candidate, "utf8"); }
    catch (error) {
      // Initial RED is an assertion that the absent proposal accepts unsafe drift,
      // never an ENOENT/setup failure. Other filesystem failures stay explicit.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      source = "";
    }
  }, 90_000);

  afterAll(async () => {
    if (!cluster) return;
    const directory = cluster.directory;
    await cluster.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("ADR002_INTAKE_FORMATION_MIGRATION_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 30_000);

  it.each([
    ["raw authenticated column access", "GRANT SELECT(form_data) ON public.intake_forms TO authenticated"],
    ["effective PUBLIC access", "GRANT SELECT(email) ON public.clients TO PUBLIC"],
    ["raw access through a SET-only role", "CREATE ROLE formation_drift NOLOGIN NOINHERIT; GRANT SELECT ON public.clients TO formation_drift; GRANT formation_drift TO authenticated WITH INHERIT FALSE,SET TRUE"],
    ["private namespace lookup", "GRANT USAGE ON SCHEMA structr_private TO authenticated"],
    ["an unknown readable view", "CREATE VIEW public.formation_drift AS SELECT id FROM public.clients; GRANT SELECT ON public.formation_drift TO authenticated"],
    ["an unknown PUBLIC-executable function", "CREATE FUNCTION public.formation_drift() RETURNS boolean LANGUAGE sql RETURN true"],
    ["restrictive replay RLS", "ALTER TABLE public.intake_forms ENABLE ROW LEVEL SECURITY; CREATE POLICY formation_drift ON public.intake_forms AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)"],
    ["restrictive protected configuration RLS", "CREATE POLICY formation_drift ON structr_private.authenticated_boundary_config AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)"],
    ["a missing intake primary key", "ALTER TABLE public.intake_forms DROP CONSTRAINT intake_forms_pkey CASCADE"],
    ["a deferred intake primary key", "ALTER TABLE public.intake_forms DROP CONSTRAINT intake_forms_pkey CASCADE; ALTER TABLE public.intake_forms ADD CONSTRAINT intake_forms_pkey PRIMARY KEY(id) DEFERRABLE INITIALLY DEFERRED"],
    ["a deferred business trigger", "CREATE FUNCTION public.formation_deferred_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; REVOKE ALL ON FUNCTION public.formation_deferred_probe() FROM PUBLIC; CREATE CONSTRAINT TRIGGER formation_deferred_probe AFTER INSERT ON public.audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.formation_deferred_probe()"],
    ["an unreviewed project default column", "ALTER TABLE public.projects ADD COLUMN formation_unreviewed_numeric numeric DEFAULT 42"],
    ["a missing unique authenticated identity", "DROP INDEX public.uq_profiles_external_open_id"],
    ["a missing unique RBAC role", "ALTER TABLE public.roles DROP CONSTRAINT roles_name_unique"],
    ["a missing unique RBAC permission", "DROP INDEX public.uq_permissions_resource_action"],
    ["a missing unique RBAC grant", "DROP INDEX public.uq_role_permissions_role_perm"],
    ["a missing provenance INSERT trigger", "DROP TRIGGER trg_reopen_provenance_insert ON public.projects"],
    ["a disabled provenance INSERT trigger", "ALTER TABLE public.projects DISABLE TRIGGER trg_reopen_provenance_insert"],
  ])("refuses %s without leaving any migration residue", async (_name, drift) => {
    const before = await catalog();
    await expect(sql().begin(async tx => {
      await tx.unsafe(drift);
      await tx.unsafe(`SET LOCAL ROLE ${admin}`);
      if (source) await tx.unsafe(source);
      throw new Error("Unsafe formation drift was accepted; force rollback of the negative probe");
    })).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/^INTAKE_FORMATION_/) });
    expect(await catalog()).toEqual(before);
  });

  it("rolls completed roles, grants, bodies and policies back on a final transaction failure", async () => {
    const before = await catalog();
    await expect(sql().begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${admin}`);
      if (source) await tx.unsafe(source);
      expect(await tx`SELECT to_regrole(${owner})::text AS owner,
        to_regprocedure('public.structr_intake_create_v1(text)') IS NOT NULL AS wrapper`)
        .toEqual([{ owner, wrapper: true }]);
      await tx.unsafe("DO $$ BEGIN RAISE EXCEPTION 'INTAKE_FORMATION_FINAL_ROLLBACK'; END $$");
    })).rejects.toMatchObject({ code: "P0001", message: "INTAKE_FORMATION_FINAL_ROLLBACK" });
    expect(await catalog()).toEqual(before);
  });

  it("installs as non-superuser with exact column authority, closed API tables and preserved prior owners", async () => {
    const priorAuthority = await oldOwnerAuthority();
    const priorApi = await apiExecutables();
    const priorTableOwners = await sql()`SELECT c.oid::regclass::text AS relation,c.relowner::regrole::text AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private') ORDER BY 1`;
    const projections = await sql()`SELECT c.relname,array_agg(a.attname::text ORDER BY a.attnum) AS columns
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('clients','projects','intake_forms','audit_logs') AND a.attnum>0 AND NOT a.attisdropped
      GROUP BY c.relname ORDER BY c.relname`;
    expect(projections.map(row => [row.relname,row.columns.length])).toEqual([
      ["audit_logs",10],["clients",21],["intake_forms",8],["projects",55],
    ]);
    await sql().begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${admin}`);
      expect(await tx`SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user`)
        .toEqual([{ rolsuper: false, rolcreaterole: true }]);
      if (source) await tx.unsafe(source);
      expect(await tx`SELECT rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
        FROM pg_roles WHERE rolname=${owner}`).toEqual([
        { rolcanlogin: false, rolinherit: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false },
      ]);
    });
    expect(await oldOwnerAuthority()).toEqual(priorAuthority);
    expect(await sql()`SELECT c.oid::regclass::text AS relation,c.relowner::regrole::text AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private') ORDER BY 1`).toEqual(priorTableOwners);

    for (const role of [...existingOwners,owner]) {
      expect(await sql()`SELECT pg_has_role(${admin},${role},'SET') AS can_set,pg_has_role(${admin},${role},'USAGE') AS inherits,
        has_schema_privilege(${role},'structr_private','CREATE') AS can_create,
        (SELECT count(*)::int FROM pg_class WHERE relowner=${role}::regrole) AS tables`)
        .toEqual([{ can_set: false, inherits: false, can_create: false, tables: 0 }]);
    }
    expect(await sql()`SELECT roleid::regrole::text FROM pg_auth_members WHERE member=${owner}::regrole`).toEqual([]);
    expect(await sql()`SELECT nspname FROM pg_namespace WHERE has_schema_privilege(${owner},oid,'CREATE')`).toEqual([]);

    const expected: string[] = [];
    const allow = (table: string, privilege: string, columns: string[]) => {
      expected.push(...columns.map(column => `${table}.${column}:${privilege}`));
    };
    for (const [table,columns] of Object.entries({
      "structr_private.authenticated_boundary_config": ["id","issuer","audience","deleted_at"],
      "public.profiles": ["id","tenant_id","external_open_id","role","is_active"],
      "public.tenants": ["id","is_active"], "public.roles": ["id","name"],
      "public.role_permissions": ["id","role_id","permission_id"], "public.permissions": ["id","resource","action"],
    })) { allow(table,"SELECT",columns); allow(table,"UPDATE",["id"]); }
    for (const row of projections) allow(`public.${row.relname}`,"SELECT",row.columns);
    allow("public.clients","INSERT",["tenant_id","name","email","phone","address","city","state","zip"]);
    allow("public.projects","INSERT",["tenant_id","owner_user_id","client_id","client_name","client_email","name","project_type","status","channel","address","city","county","state","zip"]);
    allow("public.intake_forms","INSERT",["id","tenant_id","lead_id","project_id","status","form_data"]);
    allow("public.intake_forms","UPDATE",["id"]);
    allow("public.audit_logs","INSERT",["user_id","action","table_name","record_id","old_values","new_values","ip_address","user_agent"]);
    const actual = await sql()`SELECT n.nspname||'.'||c.relname||'.'||a.attname||':'||acl.privilege_type AS permission,acl.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE acl.grantee=${owner}::regrole ORDER BY 1`;
    expect(actual.map(row => row.permission).sort()).toEqual(expected.sort());
    expect(actual.every(row => row.is_grantable === false)).toBe(true);
    expect(await sql()`SELECT c.oid::regclass::text AS relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','structr_private') AND c.relkind IN ('r','p','v','m','f')
        AND has_table_privilege(${owner},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`).toEqual([]);

    expect(await sql()`SELECT r.rolname,c.oid::regclass::text AS relation FROM pg_roles r CROSS JOIN pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN ('anon','authenticated','authenticator')
        AND n.nspname IN ('public','structr_private') AND c.relkind IN ('r','p','v','m','f')
        AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))`).toEqual([]);
    for (const api of ["anon","authenticated","authenticator"]) {
      expect(await sql()`SELECT has_schema_privilege(${api},'structr_private','USAGE,CREATE') AS private_access,
        pg_has_role(${api},${owner},'SET') AS can_set,pg_has_role(${api},${owner},'USAGE') AS inherits`)
        .toEqual([{ private_access: false, can_set: false, inherits: false }]);
    }
    const executableDelta = (await apiExecutables()).filter(row => !priorApi.some(prior => prior.role === row.role && prior.routine === row.routine));
    expect(executableDelta).toEqual([
      { role: "authenticated", routine: "public.structr_intake_create_v1(preimage text)" },
      { role: "authenticated", routine: "structr_private.intake_create_v1(preimage text)" },
    ]);
    expect(await apiExecutables()).toEqual(expect.arrayContaining(priorApi));
    const ownerExecutables = await sql()`SELECT n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' AS routine
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','structr_private')
        AND has_function_privilege(${owner},p.oid,'EXECUTE') ORDER BY 1`;
    expect(ownerExecutables.map(row => row.routine)).toEqual([
      "structr_private.intake_create_v1(text)", "structr_private.intake_preimage_v1(text)",
      "structr_private.intake_string_v1(jsonb, integer, boolean)", "structr_private.review_claims_v1()",
      "structr_private.review_permissions_v1(text)", "structr_private.review_projection_v1(jsonb, text[], text[])",
      "structr_private.review_uuid_v1(text)",
    ]);
    expect(await sql()`SELECT p.proname,p.prosecdef,p.provolatile,p.proowner::regrole::text AS owner,p.proconfig
      FROM pg_proc p WHERE p.oid IN ('public.structr_intake_create_v1(text)'::regprocedure,'structr_private.intake_create_v1(text)'::regprocedure)
      ORDER BY p.proname`).toEqual([
      { proname: "intake_create_v1", prosecdef: true, provolatile: "v", owner, proconfig: ["search_path=pg_catalog"] },
      { proname: "structr_intake_create_v1", prosecdef: false, provolatile: "v", owner: admin,
        proconfig: ["search_path=pg_catalog","default_transaction_isolation=serializable"] },
    ]);
    expect(await sql()`SELECT polcmd,polpermissive,pg_get_expr(polqual,polrelid) AS using_expression,
      pg_get_expr(polwithcheck,polrelid) AS check_expression FROM pg_policy
      WHERE polrelid='structr_private.authenticated_boundary_config'::regclass AND polroles=ARRAY[${owner}::regrole::oid] ORDER BY polcmd`)
      .toEqual([
        { polcmd: "r", polpermissive: true, using_expression: "true", check_expression: null },
        { polcmd: "w", polpermissive: true, using_expression: "true", check_expression: "false" },
      ]);
  });
});
