import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { financialPrincipalBindings,financialCalculatorFixtures,financialCalculatorRequests } from "../drizzle/schema";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startFinancialCalculatorBoundary, boundarySource } from "./test-support/financial-calculator-boundary";

const enabled=process.env.FINANCIAL_CALCULATOR_BOUNDARY_PHYSICAL==="1";
describe.skipIf(!enabled)("ADR-003 production boundary physical installation",()=>{
  let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>;
  beforeAll(async()=>{lab=await startFinancialCalculatorBoundary();},60000);
  afterAll(async()=>{if(lab)await lab.stop();},30000);
  it.each([
    ["PUBLIC table SELECT", "GRANT SELECT ON public.clients TO PUBLIC"],
    ["PUBLIC primitive EXECUTE", "GRANT EXECUTE ON FUNCTION public.internal_approval_check_lineage_v1(uuid) TO PUBLIC"],
    ["future function default", "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO authenticated"],
    ["future table default", "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC"],
    ["PUBLIC schema creation", "GRANT CREATE ON SCHEMA public TO PUBLIC"],
    ["unknown NULL-ACL definer", "CREATE FUNCTION public.boundary_drift() RETURNS int LANGUAGE sql SECURITY DEFINER RETURN 1"],
    ["cross-schema definer", "CREATE SCHEMA hostile; GRANT USAGE ON SCHEMA hostile TO PUBLIC; CREATE FUNCTION hostile.reader() RETURNS text LANGUAGE sql SECURITY DEFINER RETURN (SELECT notes FROM public.estimate_drafts LIMIT 1)"],
    ["extra evidence column", "ALTER TABLE public.estimate_internal_approvals ADD COLUMN hidden_evidence text"],
    ["removed evidence policy", "DROP POLICY adr002_snapshot_select ON public.estimate_internal_approval_snapshots"],
    ["restrictive evidence policy", "CREATE POLICY hostile_hide ON public.estimate_internal_approvals AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)"],
    ["SWR forbidden generic RLS", "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY"],
    ["privileged existing owner", "ALTER ROLE structr_review_owner_v1 BYPASSRLS"],
    ["transitive SET role", "CREATE ROLE hostile_reader NOLOGIN; CREATE ROLE hostile_link NOLOGIN; GRANT SELECT(notes) ON public.estimate_drafts TO hostile_reader; GRANT hostile_reader TO hostile_link WITH INHERIT FALSE,SET TRUE; GRANT hostile_link TO authenticated WITH INHERIT FALSE,SET TRUE"],
    ["membership inheritance override", "CREATE ROLE hostile_reader NOLOGIN; GRANT SELECT(notes) ON public.estimate_drafts TO hostile_reader; GRANT hostile_reader TO authenticated WITH INHERIT TRUE,SET FALSE"],
    ["reserved role collision", "CREATE ROLE structr_calculator_login_v1 NOLOGIN"],
    ["nominal constraint collision", "CREATE TABLE public.hostile_collision(id uuid); CREATE CONSTRAINT TRIGGER a1_draft_final AFTER INSERT ON public.hostile_collision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.internal_approval_check_final_v1()"],
    ["disabled shared trigger", "ALTER TABLE public.estimate_drafts DISABLE TRIGGER a1_draft_final"],
  ])("refuses %s without a partial installation",async(_name,drift)=>{
    await expect(lab.admin.begin(async tx=>{
      await tx.unsafe(drift);
      await tx.savepoint(async candidate=>{await candidate.unsafe(await boundarySource());});
      throw new Error("Installer accepted hostile drift");
    })).rejects.toMatchObject({code:"42501"});
    const [row]=await lab.admin`SELECT to_regnamespace('structr_financial') IS NOT NULL AS schema,
      to_regrole('structr_calculator_read_owner_v1') IS NOT NULL AS owner,
      to_regclass('public.uq_intake_financial_context') IS NOT NULL AS index`;
    expect(row).toEqual({schema:false,owner:false,index:false});
  });
  // Removing the installer preflight would let inherited PUBLIC column authority
  // reach the future login. The candidate must reject, never silently repair it.
  it("refuses PUBLIC column authority atomically without removing the hostile grant",async()=>{
    await lab.admin.unsafe("GRANT SELECT(notes) ON public.estimate_drafts TO PUBLIC");
    try {
      await expect(lab.install()).rejects.toMatchObject({code:"42501"});
      const [row]=await lab.admin`SELECT to_regnamespace('structr_financial') IS NOT NULL AS partial,
        has_column_privilege('app_denied','public.estimate_drafts','notes','SELECT') AS hostile`;
      expect(row).toEqual({partial:false,hostile:true});
    } finally {await lab.admin.unsafe("REVOKE SELECT(notes) ON public.estimate_drafts FROM PUBLIC");}
  });
  it("installs closed and all four entries refuse even the disposable real login",async()=>{
    expect(lab.migrations).toHaveLength(20);
    expect(lab.migrations.map(x=>Number(x.tag.slice(0,4)))).toEqual(Array.from({length:20},(_,i)=>i));
    await lab.install();
    const [roles]=await lab.admin`SELECT bool_and(NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) AS closed,
      bool_and(rolpassword IS NULL) AS passwordless FROM pg_authid WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')`;
    expect(roles).toEqual({closed:true,passwordless:true});
    const [rows]=await lab.admin`SELECT (SELECT count(*) FROM structr_financial.principal_bindings)::int AS bindings,(SELECT count(*) FROM structr_financial.calculator_fixtures)::int AS fixtures,(SELECT count(*) FROM structr_financial.calculator_requests)::int AS requests`;
    expect(rows).toEqual({bindings:0,fixtures:0,requests:0});
    const caller=await lab.connectLogin();
    for(const signature of ["calculator_context_v1('{}')","calculator_snapshot_v1('{}')","calculator_create_v1('{}','{}')","calculator_recover_v1('{}')"])
      await expect(caller.sql.unsafe(`SELECT structr_financial.${signature}`)).rejects.toMatchObject({code:"42501",message:"FINANCIAL_EXECUTOR_CLOSED"});
    for(const query of ["SELECT notes FROM public.estimate_drafts", "INSERT INTO public.audit_logs(action,table_name) VALUES('x','x')", "SELECT * FROM structr_financial.principal_bindings", "SET ROLE structr_calculator_write_owner_v1", "SELECT public.internal_approval_check_lineage_v1('00000000-0000-4000-8000-000000000001')", "CREATE SCHEMA hostile_caller", "CREATE TABLE public.hostile_caller(id int)"])
      await expect(caller.sql.unsafe(query)).rejects.toMatchObject({code:"42501"});
    await caller.sql.unsafe(`SET request.jwt.claims='{"sub":"forged"}'; SET app.tenant_id='forged'`);
    await expect(caller.sql.unsafe("SELECT structr_financial.calculator_context_v1('{}')")).rejects.toMatchObject({code:"42501",message:"FINANCIAL_EXECUTOR_CLOSED"});
  });

  it("matches ORM foreign keys, RLS, policy and column contracts to physical private storage",async()=>{
    for(const table of [financialPrincipalBindings,financialCalculatorFixtures,financialCalculatorRequests]) {
      const cfg=getTableConfig(table);
      const cols=await lab.admin`SELECT attname,attnotnull FROM pg_attribute WHERE attrelid=${`structr_financial.${cfg.name}`}::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`;
      expect(cols.map(x=>({name:x.attname,notNull:x.attnotnull}))).toEqual(cfg.columns.map(x=>({name:x.name,notNull:x.notNull})));
      const fks=await lab.admin`SELECT conname FROM pg_constraint WHERE conrelid=${`structr_financial.${cfg.name}`}::regclass AND contype='f' ORDER BY conname`;
      expect(fks.map(x=>x.conname)).toEqual(cfg.foreignKeys.map(x=>x.getName()).sort());
      const policies=await lab.admin`SELECT polname FROM pg_policy WHERE polrelid=${`structr_financial.${cfg.name}`}::regclass ORDER BY polname`;
      expect(policies.map(x=>x.polname)).toEqual(cfg.policies.map(x=>x.name).sort());
      const [rls]=await lab.admin`SELECT relrowsecurity FROM pg_class WHERE oid=${`structr_financial.${cfg.name}`}::regclass`;
      expect(rls.relrowsecurity).toBe(cfg.enableRLS);
    }
  });
  it("seed fixture keeps immutable evidence and rejects actor/tenant or pair substitution",async()=>{
    await lab.admin.begin(async tx=>{await tx.unsafe(await readFile(new URL("./test-support/financial-calculator-boundary/foundation-probe.sql",import.meta.url),"utf8"));});
    for(const query of ["UPDATE structr_financial.principal_bindings SET subject=gen_random_uuid()", "DELETE FROM structr_financial.principal_bindings", "UPDATE structr_financial.calculator_fixtures SET manifest='{}'", "DELETE FROM structr_financial.calculator_fixtures", "TRUNCATE structr_financial.calculator_requests"])
      await expect(lab.admin.unsafe(query)).rejects.toMatchObject({code:"23514"});
    await expect(lab.admin.unsafe("INSERT INTO structr_financial.calculator_fixtures SELECT gen_random_uuid(),binding_id,gen_random_uuid(),actor_id,project_id,gen_random_uuid(),client_id,manifest,manifest_hash,provenance_audit_id,created_at,updated_at,deleted_at FROM structr_financial.calculator_fixtures")).rejects.toMatchObject({code:"23503"});
    await expect(lab.admin.unsafe("INSERT INTO structr_financial.calculator_fixtures SELECT gen_random_uuid(),binding_id,tenant_id,actor_id,project_id,gen_random_uuid(),client_id,manifest,manifest_hash,provenance_audit_id,created_at,updated_at,deleted_at FROM structr_financial.calculator_fixtures")).rejects.toMatchObject({code:"23503"});
  });
  it("keeps the actual PG17 unflushed commit failure without leaking a draft or audit",async()=>{
    const caller=await lab.connectLogin();const id=randomUUID();let returned=false;
    await expect(caller.db.transaction(async tx=>{await tx.execute(sql`SELECT financial_boundary_probe.unflushed(${id}::uuid)`);returned=true;},{isolationLevel:"serializable"})).rejects.toMatchObject({code:"42501"});
    expect(returned).toBe(true);
    const [row]=await lab.admin`SELECT (SELECT count(*) FROM public.estimate_drafts WHERE id=${id})::int AS drafts,(SELECT count(*) FROM public.audit_logs WHERE record_id=${id})::int AS audits`;
    expect(row).toEqual({drafts:0,audits:0});
  });
  it.each(["IMMEDIATE","DEFERRED"])("flushes real guard under owner before returning to LOGIN with initial %s",async mode=>{
    const caller=await lab.connectLogin();const ids=[randomUUID(),randomUUID()];
    const snapshots=await caller.db.transaction(async tx=>{
      await tx.execute(sql`SELECT financial_boundary_probe.initial_mode(${mode==="IMMEDIATE"})`);
      const [before]=await tx.execute(sql`SELECT pg_backend_pid() AS pid,txid_current()::text AS txid`);
      const results=[];
      for(const id of ids){const [row]=await tx.execute(sql`SELECT financial_boundary_probe.write_draft(${id}::uuid) AS result`);results.push(row.result);}
      expect(results.map((x:any)=>({pid:x.pid,txid:x.txid}))).toEqual([before,before]);return results;
    },{isolationLevel:"serializable"});
    const [row]=await lab.admin`SELECT (SELECT count(*) FROM public.estimate_drafts WHERE id=ANY(${ids}::uuid[]))::int AS drafts,(SELECT count(*) FROM public.audit_logs WHERE record_id=ANY(${ids}::uuid[]))::int AS audits`;
    expect(row).toEqual({drafts:2,audits:2});expect(snapshots).toHaveLength(2);
  });
  it("savepoint rollback does not leak queued checks and commits only the surviving draft",async()=>{
    const caller=await lab.connectLogin();const aborted=randomUUID(),committed=randomUUID();
    await caller.db.transaction(async tx=>{
      await expect(tx.transaction(async save=>{await save.execute(sql`SELECT financial_boundary_probe.write_draft(${aborted}::uuid)`);throw new Error("Rollback probe");})).rejects.toThrow("Rollback probe");
      await tx.execute(sql`SELECT financial_boundary_probe.write_draft(${committed}::uuid)`);
    },{isolationLevel:"serializable"});
    const rows=await lab.admin`SELECT id FROM public.estimate_drafts WHERE id=ANY(${[aborted,committed]}::uuid[])`;expect(rows.map(x=>x.id)).toEqual([committed]);
  });
});
