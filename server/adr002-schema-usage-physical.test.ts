/** Regression for hosted 42501: wrapper EXECUTE alone cannot resolve public. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { startAdr002Postgrest, type Adr002Postgrest, type RpcResult } from "./test-support/adr002-postgrest";
import { seedAdr002Identity, type LabIdentity } from "./test-support/adr002-fixtures";

describe.skipIf(process.env.ADR002_PHYSICAL !== "1")("ADR002 hardened public namespace", () => {
  let lab: Adr002Postgrest;
  let identity: LabIdentity;
  let migration: string;
  let beforeResult: RpcResult;
  let beforeAcl: unknown[];
  let beforeObjects: unknown[];
  let beforeRoutines: unknown[];
  let beforePolicies: unknown[];
  const tenant = randomUUID();
  const bearer = () => lab.token({ sub: identity.sub, session_id: identity.session });
  const schemaAcl = () => lab.sql`SELECT grantee::regrole::text AS grantee,privilege_type,is_grantable
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl)
    WHERE n.nspname='public' ORDER BY grantee::regrole::text,privilege_type`;
  const objectAcl = () => lab.sql`SELECT n.nspname,c.relname,c.relacl::text AS acl,
    (SELECT jsonb_agg(jsonb_build_object('name',attname,'acl',attacl::text) ORDER BY attnum)
      FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','structr_private','auth') ORDER BY n.nspname,c.relname`;
  const routines = () => lab.sql`SELECT p.oid::regprocedure::text AS signature,p.proacl::text AS acl,
    pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','structr_private') AND p.prokind='f' ORDER BY p.oid`;
  const policies = () => lab.sql`SELECT polrelid::regclass::text AS relation,polname,polcmd,polpermissive,
    polroles::text AS roles,pg_get_expr(polqual,polrelid) AS using_expr,pg_get_expr(polwithcheck,polrelid) AS check_expr
    FROM pg_policy ORDER BY polrelid,polname`;
  beforeAll(async () => {
    if (process.env.ADR002_APPLY_BOUNDARY !== "1") throw new Error("Schema regression requires ADR002_APPLY_BOUNDARY=1");
    lab = await startAdr002Postgrest({ applySchemaUsage: false });
    await lab.sql`INSERT INTO public.tenants(id,name,slug,is_active)
      VALUES(${tenant},'Synthetic schema regression',${`schema-${tenant}`},true)`;
    identity = await seedAdr002Identity(lab, tenant);
    migration = await readFile(new URL('../drizzle/0016_authenticated_public_schema_usage.sql', import.meta.url), 'utf8');
    beforeAcl = await schemaAcl();
    beforeObjects = await objectAcl();
    beforeRoutines = await routines(); beforePolicies = await policies();
    beforeResult = await lab.rpc("structr_authenticated_session_v1", await bearer());
    await lab.sql.begin(async tx => { await tx.unsafe(migration); });
  }, 60_000);
  afterAll(async () => {
    if (!lab) return;
    const directory = lab.cluster.directory;
    await lab.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("ADR002_SCHEMA_USAGE_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 30_000);

  it("resolves a valid ES256 subject through HTTP after explicit namespace migration", async () => {
    expect(await lab.rpc("structr_authenticated_session_v1", await bearer())).toMatchObject({
      status: 200, body: { version: "structr-authenticated-session-v1", tenantId: tenant,
        profile: { id: identity.id, externalOpenId: identity.sub, tenantId: tenant, role: "user" },
        permissions: { isPlatformAdmin: false } },
    });
  });
  it("reproduces the hosted namespace error before 0016 despite the existing wrapper EXECUTE", async () => {
    expect(beforeResult).toEqual({ status: 403, body: {
      code: "42501", message: "permission denied for schema public", details: null, hint: null,
    } });
    expect(beforeAcl).not.toContainEqual(expect.objectContaining({ grantee: 'authenticated' }));
    expect(await lab.sql`SELECT has_function_privilege('authenticated',
      'public.structr_authenticated_session_v1()','EXECUTE') AS allowed`).toEqual([{ allowed: true }]);
  });
  it("adds exactly one non-grantable public USAGE ACL and changes no table or column ACL", async () => {
    const after = await schemaAcl();
    expect(after.filter(row => row.grantee === 'authenticated')).toEqual([
      { grantee: 'authenticated', privilege_type: 'USAGE', is_grantable: false },
    ]);
    expect(after.filter(row => row.grantee !== 'authenticated')).toEqual(beforeAcl);
    expect(await objectAcl()).toEqual(beforeObjects);
    expect(await routines()).toEqual(beforeRoutines);
    expect(await policies()).toEqual(beforePolicies);
  });
  it("leaves anonymous and authenticator namespaces closed and every API CREATE/private privilege absent", async () => {
    expect(await lab.sql`SELECT rolname,has_schema_privilege(oid,'public','USAGE') AS public_usage,
      has_schema_privilege(oid,'public','CREATE') AS public_create,
      has_schema_privilege(oid,'structr_private','USAGE,CREATE') AS private_access,
      has_schema_privilege(oid,'auth','USAGE,CREATE') AS auth_access
      FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator') ORDER BY rolname`).toEqual([
      { rolname:'anon',public_usage:false,public_create:false,private_access:false,auth_access:false },
      { rolname:'authenticated',public_usage:true,public_create:false,private_access:false,auth_access:false },
      { rolname:'authenticator',public_usage:false,public_create:false,private_access:false,auth_access:false },
    ]);
  });
  it("keeps anonymous HTTP outside the public namespace", async () => {
    expect(await lab.rpc('structr_authenticated_session_v1', null)).toMatchObject({ status:401,
      body:{code:'42501',message:'permission denied for schema public'} });
  });
  it("authenticated HTTP still cannot read raw profiles after resolving the namespace", async () => {
    expect(await lab.request('/profiles?select=id',await bearer(),undefined,'GET')).toMatchObject({
      status:403,body:{code:'42501',message:'permission denied for table profiles'},
    });
  });
  it("keeps the private helper unexposed through HTTP", async () => {
    expect(await lab.rpc('authenticated_session_v1',await bearer())).toMatchObject({
      status:404,body:{code:'PGRST202'},
    });
  });
  it("authenticated SQL cannot resolve the private helper despite its bound-wrapper EXECUTE grant", async () => {
    await expect(lab.sql.begin(async tx => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx.unsafe('SELECT structr_private.authenticated_session_v1()');
    })).rejects.toMatchObject({code:'42501',message:'permission denied for schema structr_private'});
  });
  it("authenticated cannot create objects in public", async () => {
    await expect(lab.sql.begin(async tx => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await tx.unsafe('CREATE TABLE public.adr002_namespace_unwanted(id int)');
    })).rejects.toMatchObject({code:'42501',message:'permission denied for schema public'});
    expect(await lab.sql`SELECT to_regclass('public.adr002_namespace_unwanted') AS unwanted`).toEqual([{unwanted:null}]);
  });
  it("the review wrapper reaches domain authorization instead of failing schema lookup", async () => {
    expect(await lab.rpc('structr_internal_approval_review_v1',await bearer(),
      {command:{id:randomUUID(),confirmedCurrencyCode:'USD'}})).toMatchObject({
      status:400,body:{code:'P0001',message:'NOT_FOUND'},
    });
  });
  it.each([
    {name:'raw table SELECT', sql:'GRANT SELECT ON public.profiles TO authenticated', prefix:'ADR002_NAMESPACE_RELATION_PREFLIGHT'},
    {name:'column UPDATE', sql:'GRANT UPDATE(full_name) ON public.profiles TO authenticated', prefix:'ADR002_NAMESPACE_RELATION_PREFLIGHT'},
    {name:'sequence access', sql:'CREATE SEQUENCE public.adr002_namespace_seq; GRANT USAGE ON SEQUENCE public.adr002_namespace_seq TO authenticated', prefix:'ADR002_NAMESPACE_SEQUENCE_PREFLIGHT'},
    {name:'unreviewed executable', sql:'CREATE FUNCTION public.adr002_namespace_fn() RETURNS boolean LANGUAGE sql RETURN true', prefix:'ADR002_NAMESPACE_FUNCTION_PREFLIGHT'},
    {name:'public CREATE', sql:'GRANT CREATE ON SCHEMA public TO authenticated', prefix:'ADR002_NAMESPACE_ROLE_PREFLIGHT'},
    {name:'private namespace', sql:'GRANT USAGE ON SCHEMA structr_private TO authenticated', prefix:'ADR002_NAMESPACE_ROLE_PREFLIGHT'},
    {name:'anonymous public USAGE', sql:'GRANT USAGE ON SCHEMA public TO anon', prefix:'ADR002_NAMESPACE_ROLE_PREFLIGHT'},
    {name:'PUBLIC namespace default', sql:'GRANT USAGE ON SCHEMA public TO PUBLIC', prefix:'ADR002_NAMESPACE_ROLE_PREFLIGHT'},
    {name:'inherited table access', sql:'CREATE ROLE adr002_namespace_reader NOLOGIN; GRANT SELECT ON public.profiles TO adr002_namespace_reader; GRANT adr002_namespace_reader TO authenticated WITH INHERIT TRUE, SET FALSE', prefix:'ADR002_NAMESPACE_RELATION_PREFLIGHT'},
    {name:'switchable table reader', sql:'CREATE ROLE adr002_namespace_reader NOLOGIN; GRANT SELECT ON public.profiles TO adr002_namespace_reader; GRANT adr002_namespace_reader TO authenticated WITH INHERIT FALSE, SET TRUE', prefix:'ADR002_NAMESPACE_RELATION_PREFLIGHT'},
    {name:'switchable private owner', sql:'GRANT structr_review_owner_v1 TO authenticated WITH INHERIT FALSE,SET TRUE', prefix:'ADR002_NAMESPACE_ROLE_PREFLIGHT'},
    {name:'privileged API role', sql:'ALTER ROLE authenticated BYPASSRLS', prefix:'ADR002_NAMESPACE_ROLE_PREFLIGHT'},
    {name:'authenticator inheritance', sql:'ALTER ROLE authenticator INHERIT', prefix:'ADR002_NAMESPACE_ROLE_PREFLIGHT'},
    {name:'missing wrapper EXECUTE', sql:'REVOKE EXECUTE ON FUNCTION public.structr_authenticated_session_v1() FROM authenticated', prefix:'ADR002_NAMESPACE_WRAPPER_PREFLIGHT'},
    {name:'anonymous wrapper EXECUTE', sql:'GRANT EXECUTE ON FUNCTION public.structr_authenticated_session_v1() TO anon', prefix:'ADR002_NAMESPACE_FUNCTION_PREFLIGHT'},
  ])("refuses $name before opening lookup and rolls the transaction back", async ({sql,prefix}) => {
    const before = await schemaAcl(), objects = await objectAcl();
    await expect(lab.sql.begin(async tx => {
      await tx.unsafe('REVOKE USAGE ON SCHEMA public FROM authenticated');
      await tx.unsafe(sql);
      await tx.unsafe(migration);
      throw new Error('Dangerous drift was accepted');
    })).rejects.toMatchObject({code:'42501',message:expect.stringContaining(prefix)});
    expect(await schemaAcl()).toEqual(before);
    expect(await objectAcl()).toEqual(objects);
  });
  it("rolls back the namespace grant if a later statement in the migration transaction fails", async () => {
    await lab.sql.unsafe('REVOKE USAGE ON SCHEMA public FROM authenticated');
    try {
      await expect(lab.sql.begin(async tx => {
        await tx.unsafe(migration);
        await tx.unsafe("DO $$ BEGIN RAISE EXCEPTION 'NAMESPACE_TEST_ROLLBACK'; END $$");
      })).rejects.toMatchObject({code:'P0001',message:'NAMESPACE_TEST_ROLLBACK'});
      expect(await lab.sql`SELECT has_schema_privilege('authenticated','public','USAGE') AS allowed`).toEqual([{allowed:false}]);
    } finally { await lab.sql.begin(async tx => { await tx.unsafe(migration); }); }
  });
  it("reapplying the correction changes no ACL and preserves the valid HTTP session", async () => {
    const before = await schemaAcl(), objects = await objectAcl();
    await lab.sql.begin(async tx => { await tx.unsafe(migration); });
    expect(await schemaAcl()).toEqual(before); expect(await objectAcl()).toEqual(objects);
    expect((await lab.rpc('structr_authenticated_session_v1',await bearer())).status).toBe(200);
  });
  it("applies as a non-superuser holding only public USAGE WITH GRANT OPTION", async () => {
    const before = await schemaAcl();
    await expect(lab.sql.begin(async tx => {
      await tx.unsafe('CREATE ROLE adr002_namespace_migrator NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS');
      await tx.unsafe('GRANT USAGE ON SCHEMA public TO adr002_namespace_migrator WITH GRANT OPTION');
      await tx.unsafe('REVOKE USAGE ON SCHEMA public FROM authenticated');
      await tx.unsafe('SET LOCAL ROLE adr002_namespace_migrator');
      await tx.unsafe(migration);
      expect(await tx`SELECT current_user AS executor,rolsuper,rolcreaterole,rolbypassrls,
        has_schema_privilege('authenticated','public','USAGE') AS allowed
        FROM pg_roles WHERE rolname=current_user`).toEqual([{executor:'adr002_namespace_migrator',
          rolsuper:false,rolcreaterole:false,rolbypassrls:false,allowed:true}]);
      throw new Error('NON_SUPERUSER_PROOF_ROLLBACK');
    })).rejects.toThrow('NON_SUPERUSER_PROOF_ROLLBACK');
    expect(await schemaAcl()).toEqual(before);
  });
  it("refuses a principal without schema grant authority even when replay already has USAGE", async () => {
    const before = await schemaAcl();
    await expect(lab.sql.begin(async tx => {
      await tx.unsafe('CREATE ROLE adr002_namespace_unprivileged NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS');
      await tx.unsafe('GRANT USAGE ON SCHEMA public TO adr002_namespace_unprivileged');
      await tx.unsafe('SET LOCAL ROLE adr002_namespace_unprivileged');
      await tx.unsafe(migration);
      throw new Error('Unprivileged migration principal was accepted');
    })).rejects.toMatchObject({code:'42501',message:'ADR002_NAMESPACE_EXECUTOR_PREFLIGHT'});
    expect(await schemaAcl()).toEqual(before);
  });
});
