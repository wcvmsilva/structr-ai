/** Real signed JWT → owned PostgREST → PostgreSQL. No hosted destination/config. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { startAdr002Postgrest, type Adr002Postgrest } from "./test-support/adr002-postgrest";
import { formationToken, seedFormationIdentity } from "./test-support/adr002-intake-formation-fixtures";
import { seedScopePair, seedScopeMembership, scopePhysicalSnapshot } from "./test-support/adr002-scope-workspace-fixtures";

const enabled = process.env.ADR002_PHYSICAL === "1" && process.env.ADR002_SCOPE_WORKSPACE === "1";
const rpc = "structr_scope_workspace_read_v1";
describe.skipIf(!enabled)("SWR-1 physical authenticated pair", () => {
  let lab: Adr002Postgrest;
  beforeAll(async () => {
    lab = await startAdr002Postgrest({ applyMinimumReads: true, applyIntakeFormation: true,
      scopeWorkspaceRead: process.env.ADR002_SCOPE_APPLY === "1" ? "candidate" : "baseline" });
  }, 90_000);
  afterAll(async () => {
    if (!lab) return;
    const directory = lab.cluster.directory;
    await lab.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("SWR1_OWNED_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 30_000);
  async function read(pair: Awaited<ReturnType<typeof seedScopePair>>, command: unknown = pair.command) {
    return lab.rpc(rpc, await formationToken(lab, pair.actor), { command });
  }
  async function denied(pair: Awaited<ReturnType<typeof seedScopePair>>, message = "FORBIDDEN", code = "42501") {
    const result = await read(pair); expect(result.status).not.toBe(200); expect(result.body).toMatchObject({ message, code });
  }

  it("physical projection returns only the exact known pair and notLoaded sentinels", async () => {
    const pair = await seedScopePair(lab);
    const response = await read(pair);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      version: "structr-authenticated-scope-workspace-read-v1", context: { actorId: pair.actor.id, tenantId: pair.actor.tenant },
      project: { id: pair.command.projectId, tenantId: pair.actor.tenant, name: "Synthetic scope pair", projectType: "repair", channel: "direct",
        status: "intake", address: "1 Synthetic Lane", city: "Charleston", state: "SC", zipCode: "29401", county: "Charleston", zone: "stored-zone" },
      intake: { id: pair.command.intakeFormId, tenantId: pair.actor.tenant, projectId: pair.command.projectId, status: "draft",
        serviceType: "repair", area: " 120 sqft ", finishLevel: "standard", condition: "existing", channel: "direct", notes: "Synthetic only",
        createdAt: "2026-10-09T01:02:03.123Z", updatedAt: "2026-10-09T02:03:04.987Z" },
      scopes: { state: "notLoaded" }, catalog: { state: "notLoaded" },
    });
  });
  it("repeated reads preserve all complete physical rows, audits, issuer and microseconds", async () => {
    const pair = await seedScopePair(lab); const before = await scopePhysicalSnapshot(lab);
    const first = await read(pair); expect(first.status).toBe(200); expect(await read(pair)).toEqual(first);
    expect(await scopePhysicalSnapshot(lab)).toEqual(before);
  });
  it.each([
    ["missing project", { intakeFormId: randomUUID() }], ["missing intake", { projectId: randomUUID() }],
    ["extra authority", { projectId: randomUUID(), intakeFormId: randomUUID(), tenantId: randomUUID() }],
    ["array", []], ["null", null], ["scalar", "pair"],
    ["wrong type", { projectId: 1, intakeFormId: randomUUID() }],
    ["NIL", { projectId: "00000000-0000-0000-0000-000000000000", intakeFormId: randomUUID() }],
    ["uppercase", { projectId: "ABCDEF01-1234-1234-1234-123456789012", intakeFormId: randomUUID() }],
    ["untrimmed", { projectId: ` ${randomUUID()}`, intakeFormId: randomUUID() }],
  ])("rejects command %s without lookup/coercion", async (_name, command) => {
    const pair = await seedScopePair(lab); const result = await read(pair, command);
    expect(result.body).toMatchObject({ code: "P0001", message: "SCOPE_WORKSPACE_INPUT_INVALID" });
  });
  it.each(["id", "tenantId", "projectId", "userId", "status", "createdAt", "updatedAt"])("refuses reserved metadata %s even if coincident", async key => {
    const pair = await seedScopePair(lab, undefined, { [key]: null });
    await denied(pair, "SCOPE_WORKSPACE_METADATA_INVALID", "P0001");
  });
  it.each([null, [], "text", 7, { area: 120 }, { notes: {} }, { serviceType: true }, { notes: "é".repeat(32769) }])("refuses malformed/oversize metadata %#", async metadata => {
    await denied(await seedScopePair(lab, undefined, metadata), "SCOPE_WORKSPACE_METADATA_INVALID", "P0001");
  });
  it("preserves null/absent strings and accepts exact UTF8 boundary without readiness/defaults", async () => {
    const pair = await seedScopePair(lab, undefined, { area: null, notes: "é".repeat(32768) });
    const result = await read(pair); expect(result.status).toBe(200);
    expect(result.body.intake).toMatchObject({ serviceType: null, area: null, finishLevel: null, condition: null, channel: null, notes: "é".repeat(32768) });
  });
  it("does not select another intake or leak cross-project intake", async () => {
    const pair = await seedScopePair(lab), other = await seedScopePair(lab, pair.actor);
    await denied({ ...pair, command: { ...pair.command, intakeFormId: other.command.intakeFormId } }, "NOT_FOUND", "P0002");
  });
  it.each(["project", "intake"])("returns sanitized NOT_FOUND for absent %s", async which => {
    const pair = await seedScopePair(lab); pair.command[which === "project" ? "projectId" : "intakeFormId"] = randomUUID();
    await denied(pair, "NOT_FOUND", "P0002");
  });
  it("does not let another tenant's admin use a known pair", async () => {
    const pair = await seedScopePair(lab); pair.actor = await seedFormationIdentity(lab, "admin"); await denied(pair);
  });
  it("same-tenant admin reads an otherwise unowned pair", async () => {
    const pair = await seedScopePair(lab); pair.actor = await seedFormationIdentity(lab, "admin", pair.actor.tenant);
    expect((await read(pair)).status).toBe(200);
  });
  it.each(["profile", "tenant", "deleted project", "intake tenant"])("rejects %s inconsistency", async which => {
    const pair = await seedScopePair(lab);
    if (which === "profile") await lab.sql`UPDATE public.profiles SET is_active=false WHERE id=${pair.actor.id}`;
    if (which === "tenant") await lab.sql`UPDATE public.tenants SET is_active=false WHERE id=${pair.actor.tenant}`;
    if (which === "deleted project") await lab.sql`UPDATE public.projects SET deleted_at=now() WHERE id=${pair.command.projectId}`;
    if (which === "intake tenant") { const other = await seedFormationIdentity(lab); await lab.sql`UPDATE public.intake_forms SET tenant_id=${other.tenant} WHERE id=${pair.command.intakeFormId}`; }
    await denied(pair, which === "deleted project" ? "NOT_FOUND" : "FORBIDDEN", which === "deleted project" ? "P0002" : "42501");
  });
  it.each(["owner", "manager", "estimator", "field", "viewer"])("active %s membership reads without global permission", async role => {
    const pair = await seedScopePair(lab); pair.actor = await seedFormationIdentity(lab, "user", pair.actor.tenant);
    await seedScopeMembership(lab, pair.actor, pair.command.projectId, { role }); expect((await read(pair)).status).toBe(200);
  });
  it("explicit read grants an otherwise unknown active project role", async () => {
    const pair = await seedScopePair(lab); pair.actor = await seedFormationIdentity(lab, "user", pair.actor.tenant);
    await seedScopeMembership(lab, pair.actor, pair.command.projectId, { role: "custom", permissions: ["read"] }); expect((await read(pair)).status).toBe(200);
  });
  it.each([false])("membership active=%s alone grants nothing", async active => {
    const pair = await seedScopePair(lab); pair.actor = await seedFormationIdentity(lab, "user", pair.actor.tenant);
    await seedScopeMembership(lab, pair.actor, pair.command.projectId, { active }); await denied(pair);
  });
  it("physical schema prevents a null active membership", async () => {
    const pair = await seedScopePair(lab);
    await expect(seedScopeMembership(lab, pair.actor, pair.command.projectId, { active: null })).rejects.toMatchObject({ code: "23502" });
  });
  async function grantGlobalRead(pair: Awaited<ReturnType<typeof seedScopePair>>) {
    const roleId = randomUUID(), roleName = `swr-${roleId}`;
    await lab.sql`INSERT INTO public.roles(id,name) VALUES(${roleId},${roleName})`;
    await lab.sql`UPDATE public.profiles SET role=${roleName} WHERE id=${pair.actor.id}`;
    await lab.sql`INSERT INTO public.permissions(resource,action) VALUES('project','read') ON CONFLICT(resource,action) DO NOTHING`;
    await lab.sql`INSERT INTO public.role_permissions(role_id,permission_id)
      SELECT ${roleId},id FROM public.permissions WHERE resource='project' AND action='read'`;
  }
  it.each(["absent", "inactive", "active without read"])("RBAC fallback with %s membership", async state => {
    const pair = await seedScopePair(lab); pair.actor = await seedFormationIdentity(lab, "user", pair.actor.tenant);
    await grantGlobalRead(pair);
    if (state !== "absent") await seedScopeMembership(lab, pair.actor, pair.command.projectId, { active: state !== "inactive", role: "custom", permissions: [] });
    if (state === "active without read") await denied(pair); else expect((await read(pair)).status).toBe(200);
  });
  it("physical uniqueness prevents duplicate membership even for the owner", async () => {
    const pair = await seedScopePair(lab);
    await seedScopeMembership(lab, pair.actor, pair.command.projectId);
    await expect(seedScopeMembership(lab, pair.actor, pair.command.projectId)).rejects.toMatchObject({ code: "23505" });
  });
  it.each(["infinity", "10000-01-01 00:00:00+00", "4000-01-01 00:00:00+00 BC"])("rejects non-wire timestamp %s", async timestamp => {
    const pair = await seedScopePair(lab); await lab.sql`UPDATE public.intake_forms SET created_at=${timestamp}::timestamptz WHERE id=${pair.command.intakeFormId}`;
    await denied(pair, "SCOPE_WORKSPACE_METADATA_INVALID", "P0001");
  });
  it.each([['projects','name'],['projects','project_type'],['projects','status'],['intake_forms','status']])("rejects essential NULL after drift %s.%s", async(table,column)=>{
    const pair=await seedScopePair(lab),id=table==='projects'?pair.command.projectId:pair.command.intakeFormId;
    await lab.sql.unsafe(`ALTER TABLE public.${table} ALTER COLUMN ${column} DROP NOT NULL`);
    try { await lab.sql.unsafe(`UPDATE public.${table} SET ${column}=NULL WHERE id=$1`,[id]);await denied(pair,'SCOPE_WORKSPACE_METADATA_INVALID','P0001'); }
    finally { await lab.sql.unsafe(`UPDATE public.${table} SET ${column}='fixture-restored' WHERE id=$1`,[id]);await lab.sql.unsafe(`ALTER TABLE public.${table} ALTER COLUMN ${column} SET NOT NULL`); }
  });
  async function waitForRpcLock() {
    for (let attempt=0; attempt<150; attempt++) {
      const [row] = await lab.sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='authenticator' AND wait_event_type='Lock') AS waiting`;
      if (row.waiting) return;
      await new Promise(done => setTimeout(done,20));
    }
    throw new Error("Protected RPC did not wait on the expected physical row lock");
  }
  it("concurrent withdrawal serializes and the same bearer is denied after commit", async () => {
    const pair=await seedScopePair(lab), bearer=await formationToken(lab,pair.actor), writer=await lab.connectSupervisor();
    let release!:()=>void, locked!:()=>void;
    const acquired=new Promise<void>(done=>{locked=done;}), unlock=new Promise<void>(done=>{release=done;});
    const changing=writer.begin(async tx=>{await tx`UPDATE public.profiles SET is_active=false WHERE id=${pair.actor.id}`;locked();await unlock;});
    await acquired;
    const pending=lab.rpc(rpc,bearer,{command:pair.command});
    try { await waitForRpcLock(); } finally { release(); await changing; }
    expect((await pending).body.code).toBe("40001");
    expect((await lab.rpc(rpc,bearer,{command:pair.command})).body).toMatchObject({code:"42501",message:"FORBIDDEN"});
  });
  it("rechecks token expiry after waiting on a business lock", async () => {
    const pair=await seedScopePair(lab), writer=await lab.connectSupervisor(), now=Math.floor(Date.now()/1000);
    const bearer=await formationToken(lab,pair.actor,{iat:now-1,exp:now+2});
    let release!:()=>void, locked!:()=>void;
    const acquired=new Promise<void>(done=>{locked=done;}), unlock=new Promise<void>(done=>{release=done;});
    const holding=writer.begin(async tx=>{await tx`SELECT id FROM public.projects WHERE id=${pair.command.projectId} FOR UPDATE`;locked();await unlock;});
    await acquired; const pending=lab.rpc(rpc,bearer,{command:pair.command});
    try { await waitForRpcLock(); await new Promise(done=>setTimeout(done,2100)); } finally { release(); await holding; }
    expect((await pending).body).toMatchObject({code:"42501",message:"FORBIDDEN"});
  },10000);
  it.each([{}, "read", ["READ"], ["read", 3], ["unexpected"]])("owner cannot bypass malformed membership permissions %#", async permissions => {
    const pair = await seedScopePair(lab); await seedScopeMembership(lab, pair.actor, pair.command.projectId, { permissions });
    await denied(pair, "SCOPE_WORKSPACE_METADATA_INVALID", "P0001");
  });
  it("owner cannot bypass contradictory membership tenant", async () => {
    const pair = await seedScopePair(lab), other = await seedFormationIdentity(lab);
    await seedScopeMembership(lab, pair.actor, pair.command.projectId, { tenant: other.tenant }); await denied(pair);
  });
  it("same valid bearer is refused after profile withdrawal and after pool reuse", async () => {
    const pair = await seedScopePair(lab), token = await formationToken(lab, pair.actor);
    expect((await lab.rpc(rpc, token, { command: pair.command })).status).toBe(200);
    await lab.sql`UPDATE public.profiles SET is_active=false WHERE id=${pair.actor.id}`;
    expect((await lab.rpc(rpc, token, { command: pair.command })).body).toMatchObject({ code: "42501", message: "FORBIDDEN" });
    const other = await seedScopePair(lab); expect((await read(other)).status).toBe(200);
    expect((await lab.rpc(rpc, token, { command: pair.command })).body.code).toBe("42501");
  });
  it.each([null, "wrong signature", "service_role", "expired", "wrong issuer"])("rejects nonprotected token %s", async kind => {
    const pair = await seedScopePair(lab), now = Math.floor(Date.now()/1000);
    const bearer = kind === null ? null : await lab.token({ sub: pair.actor.sub, session_id: pair.actor.session,
      ...(kind === "service_role" ? { role: "service_role" } : {}), ...(kind === "expired" ? { iat: now-60, exp: now-1 } : {}),
      ...(kind === "wrong issuer" ? { iss: "https://wrong.invalid" } : {}) }, kind === "wrong signature");
    expect((await lab.rpc(rpc, bearer, { command: pair.command })).status).not.toBe(200);
  });
  it("GET cannot execute the locked read", async () => {
    const pair = await seedScopePair(lab), bearer = await formationToken(lab, pair.actor);
    expect((await lab.request(`/rpc/${rpc}?command=${encodeURIComponent(JSON.stringify(pair.command))}`, bearer, undefined, "GET")).status).not.toBe(200);
  });
  it("raw-table access and the prior intake writer remain closed", async () => {
    const pair = await seedScopePair(lab), bearer = await formationToken(lab, pair.actor);
    for (const table of ["projects", "intake_forms", "project_members", "profiles", "roles", "audit_logs"]) {
      expect((await lab.request(`/${table}?select=*`, bearer, undefined, "GET")).status).not.toBe(200);
    }
    expect((await lab.rpc("structr_intake_create_v1", bearer, { preimage: "{}" })).status).not.toBe(200);
  });
});

describe.skipIf(!enabled)("SWR-1 non-superuser migration lifecycle", () => {
  let lab: Adr002Postgrest, source: string, closeSource: string, openSource: string;
  const admin="scope_workspace_migration_admin", owner="structr_scope_workspace_read_owner_v1";
  async function readCompanion(name:string) {
    try { return await readFile(new URL(`../docs/security/scope-workspace-read/${name}.sql`,import.meta.url),"utf8"); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error; return ""; }
  }
  beforeAll(async()=>{
    lab=await startAdr002Postgrest({applyMinimumReads:true,applyIntakeFormation:true,scopeWorkspaceRead:"baseline"});
    source=await readCompanion("candidate"); closeSource=await readCompanion("homolog-close"); openSource=await readCompanion("homolog-open");
    await lab.sql.unsafe(`CREATE ROLE ${admin} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT USAGE,CREATE ON SCHEMA public,structr_private TO ${admin} WITH GRANT OPTION;
      GRANT structr_review_owner_v1 TO ${admin} WITH ADMIN TRUE,INHERIT FALSE,SET FALSE`);
    // Fixture ownership only: a real CREATEROLE, NOBYPASSRLS migrator must supply
    // grants/policies itself. Superuser never substitutes for its candidate run.
    const tables=await lab.sql`SELECT format('ALTER TABLE %I.%I OWNER TO scope_workspace_migration_admin',n.nspname,c.relname) AS statement
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND (n.nspname='public' OR (n.nspname='structr_private' AND c.relname='authenticated_boundary_config'))`;
    for(const row of tables)await lab.sql.unsafe(row.statement);
  },90000);
  afterAll(async()=>{if(lab){const directory=lab.cluster.directory;await lab.stop();await expect(access(directory)).rejects.toMatchObject({code:"ENOENT"});}},30000);
  async function catalog() {
    const [row]=await lab.sql`SELECT jsonb_build_object(
      'relations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace,'structr_private'::regnamespace)),
      'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN
        (SELECT oid FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'structr_private'::regnamespace))),
      'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'structr_private'::regnamespace)),
      'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p),
      'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r),
      'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),
      'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN ('public','structr_private'))
    ) AS value`; return row.value;
  }
  const rollback=new Error("intentional owned candidate rollback");
  async function asMigrator(action:(tx:any)=>Promise<void>) {
    await expect(lab.sql.begin(async tx=>{await tx.unsafe(`SET LOCAL ROLE ${admin}`);await action(tx);throw rollback;})).rejects.toBe(rollback);
  }
  it("non-superuser installs closed, opens and closes without retaining owner authority",async()=>{
    const before=await catalog();
    await asMigrator(async tx=>{
      await tx.unsafe(source); if(closeSource)await tx.unsafe(closeSource);
      const [closed]=await tx`SELECT has_function_privilege('authenticated','public.structr_scope_workspace_read_v1(jsonb)','EXECUTE') AS wrapper,
        has_function_privilege('authenticated','structr_private.scope_workspace_read_v1(jsonb)','EXECUTE') AS implementation`;
      expect(closed).toMatchObject({wrapper:false,implementation:false});
      if(openSource)await tx.unsafe(openSource);
      const [opened]=await tx`SELECT has_function_privilege('authenticated','public.structr_scope_workspace_read_v1(jsonb)','EXECUTE') AS wrapper,
        has_function_privilege('authenticated','structr_private.scope_workspace_read_v1(jsonb)','EXECUTE') AS implementation,
        pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','SET') AS owner_set,
        pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','USAGE') AS owner_use`;
      expect(opened).toMatchObject({wrapper:true,implementation:true,owner_set:false,owner_use:false});
      if(closeSource)await tx.unsafe(closeSource);
      const [final]=await tx`SELECT has_function_privilege('authenticated','public.structr_scope_workspace_read_v1(jsonb)','EXECUTE') AS wrapper,
        has_function_privilege('authenticated','structr_private.scope_workspace_read_v1(jsonb)','EXECUTE') AS implementation`;
      expect(final).toMatchObject({wrapper:false,implementation:false});
    });
    expect(await catalog()).toEqual(before);
  });
  it("dedicated owner has only exact column read/lock authority and three shared helpers",async()=>{
    await asMigrator(async tx=>{
      const priorMembership=await tx`SELECT * FROM pg_auth_members WHERE member=current_user::regrole ORDER BY oid`;
      await tx.unsafe(source);
      const preservedMembership=await tx`SELECT * FROM pg_auth_members WHERE member=current_user::regrole AND roleid='structr_review_owner_v1'::regrole ORDER BY oid`;
      expect(Array.from(preservedMembership)).toEqual(Array.from(priorMembership));
      const [role]=await tx`SELECT rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=${owner}`;
      expect(Object.values(role)).toEqual([false,false,false,false,false,false,false]);
      const columns=await tx`SELECT n.nspname||'.'||c.relname AS relation,a.attname AS column,privilege AS privilege
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN (VALUES('SELECT'),('UPDATE'),('INSERT'),('REFERENCES')) p(privilege)
        WHERE n.nspname IN ('public','structr_private') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
          AND has_column_privilege(${owner},c.oid,a.attnum,privilege) ORDER BY 1,2,3`;
      const expected:Record<string,string[]>= {
        'structr_private.authenticated_boundary_config':['id','issuer','audience','deleted_at'],
        'public.profiles':['id','tenant_id','external_open_id','role','is_active'], 'public.tenants':['id','is_active'],
        'public.projects':['id','tenant_id','owner_user_id','deleted_at','name','project_type','channel','status','address','city','state','zip','county','zone'],
        'public.project_members':['id','tenant_id','project_id','user_id','project_role','permissions','is_active'],
        'public.roles':['id','name'],'public.role_permissions':['id','role_id','permission_id'],'public.permissions':['id','resource','action'],
        'public.intake_forms':['id','tenant_id','project_id','status','form_data','created_at','updated_at'],
      };
      const wanted=Object.entries(expected).flatMap(([relation,names])=>[...names.map(column=>({relation,column,privilege:'SELECT'})),{relation,column:'id',privilege:'UPDATE'}]);
      expect(Array.from(columns)).toEqual(wanted.sort((a,b)=>`${a.relation}.${a.column}.${a.privilege}`.localeCompare(`${b.relation}.${b.column}.${b.privilege}`)));
      const functions=await tx`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='structr_private' AND has_function_privilege(${owner},p.oid,'EXECUTE') ORDER BY p.proname`;
      expect(functions.map((r:any)=>r.proname)).toEqual(['review_claims_v1','review_permissions_v1','review_uuid_v1','scope_workspace_read_v1']);
      const [denied]=await tx`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','structr_private') AND c.relkind='r' AND has_table_privilege(${owner},c.oid,'INSERT,DELETE,TRUNCATE,TRIGGER')) AS broad_dml,
        EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator') AND
          (pg_has_role(r.oid,${owner},'SET') OR pg_has_role(r.oid,${owner},'USAGE') OR has_schema_privilege(r.oid,'structr_private','USAGE,CREATE'))) AS api_escalation`;
      expect(denied).toMatchObject({broad_dml:false,api_escalation:false});
    });
  });
  it.each([
    ['raw column',"GRANT SELECT(form_data) ON public.intake_forms TO authenticated"],
    ['PUBLIC data',"GRANT SELECT(id) ON public.projects TO PUBLIC"],
    ['SET-only bypass',"GRANT service_role TO authenticated WITH INHERIT FALSE,SET TRUE"],
    ['dispatcher inherited bypass',"GRANT service_role TO authenticator WITH INHERIT TRUE,SET TRUE"],
    ['dispatcher private owner',"GRANT structr_intake_create_owner_v1 TO authenticator WITH INHERIT FALSE,SET TRUE"],
    ['private schema',"GRANT USAGE ON SCHEMA structr_private TO authenticated"],
    ['unknown function',"CREATE FUNCTION public.swr_unreviewed() RETURNS boolean LANGUAGE sql RETURN true"],
    ['business RLS',"ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY"],
    ['restrictive config policy',"CREATE POLICY swr_hidden ON structr_private.authenticated_boundary_config AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)"],
    ['open IF1',"GRANT EXECUTE ON FUNCTION public.structr_intake_create_v1(text) TO authenticated"],
    ['missing identity uniqueness',"DROP INDEX public.uq_profiles_external_open_id"],
    ['preexisting self-granted helper owner',"SET LOCAL ROLE scope_workspace_migration_admin; GRANT structr_review_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE; RESET ROLE"],
    ['PUBLIC private function',"CREATE FUNCTION structr_private.swr_unreviewed() RETURNS boolean LANGUAGE sql RETURN true"],
    ['PUBLIC private column',"GRANT SELECT(issuer) ON structr_private.authenticated_boundary_config TO PUBLIC"],
  ])("rejects %s and rolls back every candidate object",async(_name,drift)=>{
    const before=await catalog();
    await expect(lab.sql.begin(async tx=>{await tx.unsafe(drift);await tx.unsafe(`SET LOCAL ROLE ${admin}`);await tx.unsafe(source);throw rollback;}))
      .rejects.toMatchObject({code:'42501',message:expect.stringMatching(/^SCOPE_WORKSPACE_/)});
    expect(await catalog()).toEqual(before);
  });
});
