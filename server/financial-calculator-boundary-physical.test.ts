import { buildCalculatorResult, hashCalculatorCanonical } from "../shared/financial-calculator-engine";
import { readFile,writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { financialPrincipalBindings,financialCalculatorFixtures,financialCalculatorRequests } from "../drizzle/schema";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startFinancialCalculatorBoundary, boundarySource, setupCalculatorLifecycleFixture } from "./test-support/financial-calculator-boundary";

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

describe.skipIf(!enabled)("ADR-003 production calculator lifecycle",()=>{
 let lab:Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>,fixture:Awaited<ReturnType<typeof setupCalculatorLifecycleFixture>>,caller:Awaited<ReturnType<Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>["connectLogin"]>>;
 beforeAll(async()=>{lab=await startFinancialCalculatorBoundary();await lab.install();await lab.admin.begin(async tx=>{await tx.unsafe(await readFile(new URL("../drizzle/0021_financial_calculator_lifecycle.sql",import.meta.url),"utf8"));});if(process.env.FINANCIAL_CALCULATOR_CAPTURE_LIFECYCLE==='1'){
   const query=(await readFile(new URL('./test-support/financial-calculator-boundary/catalog.sql',import.meta.url),'utf8')).replaceAll("('public','structr_private')","('public','structr_private','structr_financial')");
   const catalog=await lab.admin.begin(async tx=>{await tx.unsafe('SET LOCAL search_path=pg_catalog');return tx.unsafe(query);});await writeFile('/private/tmp/calculator-lifecycle-installed-catalog.json',JSON.stringify(catalog,null,2));
 }fixture=await setupCalculatorLifecycleFixture(lab);caller=await lab.connectLogin();},60000);
 afterAll(async()=>{if(lab)await lab.stop();},30000);
 it("loads protected A/B/C sources from the fixed operator's real transaction",async()=>{
   const result=await caller.db.transaction(async tx=>{const [row]=await tx.execute(sql`SELECT structr_financial.calculator_snapshot_v1(${JSON.stringify(fixture.command)}::jsonb) AS result`);return row.result as any;},{isolationLevel:"serializable"});
   expect(result.binding.subject).toBe(fixture.ids.subject);expect(result.snapshot.prices.map((x:any)=>[x.unitCost,x.unitPrice])).toEqual([["40.00","100.00"],["60.00","90.00"],["0.01","0.01"]]);
 });
 async function snapshot(tx:any,command=fixture.command){const [row]=await tx.execute(sql`SELECT structr_financial.calculator_snapshot_v1(${JSON.stringify(command)}::jsonb) AS result`);return row.result as any;}
 async function create(tx:any,selection=fixture.command.assemblies,requestId=randomUUID()){
   const command={...fixture.command,assemblies:selection};const acquired=await snapshot(tx,command);const calculation=await buildCalculatorResult(acquired.snapshot,command);
   const save={...command,operation:"calculator.create",requestId,expectedSourceHash:calculation.sourceHash,expectedCalculationHash:calculation.calculationHash};
   const commandHash=await hashCalculatorCanonical(save);
   const [row]=await tx.execute(sql`SELECT structr_financial.calculator_create_v1(${JSON.stringify(save)}::jsonb,${JSON.stringify({calculation,commandHash})}::jsonb) AS result`);
   return {envelope:row.result as any,save,calculation};
 }
 it("rejects READ COMMITTED before protected sources",async()=>{
   await expect(caller.db.transaction(tx=>snapshot(tx))).rejects.toMatchObject({cause:{code:"42501",message:"FINANCIAL_EXECUTOR_TRANSACTION_INVALID"}});
 });
 it("exposes only minimal fixture choices to a financial creator",async()=>{
   const envelope=await caller.db.transaction(async tx=>{const [row]=await tx.execute(sql`SELECT structr_financial.calculator_context_v1(${JSON.stringify(fixture.contextCommand)}::jsonb) AS result`);return row.result as any;},{isolationLevel:"serializable"});
   expect(envelope.options).toEqual([{assemblyId:fixture.ids.a,name:"A",unit:"EA"},{assemblyId:fixture.ids.b,name:"B",unit:"EA"},{assemblyId:fixture.ids.c,name:"C",unit:"EA"}]);
   expect(Object.keys(envelope).sort()).toEqual(["binding","clientId","contractVersion","intakeFormId","options","projectId","transaction"].sort());
 });
 it.each([
   ["inactive profile","UPDATE public.profiles SET is_active=false","UPDATE public.profiles SET is_active=true","FORBIDDEN"],
   ["inactive tenant","UPDATE public.tenants SET is_active=false WHERE slug='calculator-lifecycle'","UPDATE public.tenants SET is_active=true WHERE slug='calculator-lifecycle'","FORBIDDEN"],
   ["revoked creation permission","DELETE FROM public.role_permissions WHERE permission_id='c3000000-0000-4000-8000-000000000016'","INSERT INTO public.role_permissions(role_id,permission_id) VALUES('c3000000-0000-4000-8000-000000000015','c3000000-0000-4000-8000-000000000016')","FORBIDDEN"],
   ["inactive unit","UPDATE public.units SET is_active=false WHERE id='c3000000-0000-4000-8000-000000000009'","UPDATE public.units SET is_active=true WHERE id='c3000000-0000-4000-8000-000000000009'","CALCULATOR_SOURCE_INACTIVE"],
   ["unsupported BOM override","UPDATE public.assembly_items SET unit_cost_override=0 WHERE id='c3000000-0000-4000-8000-000000000301'","UPDATE public.assembly_items SET unit_cost_override=NULL WHERE id='c3000000-0000-4000-8000-000000000301'","CALCULATOR_OVERRIDE_UNSUPPORTED"],
   ["unproven geo context","UPDATE public.projects SET geocode_confidence='low' WHERE id='c3000000-0000-4000-8000-000000000004'","UPDATE public.projects SET geocode_confidence='high' WHERE id='c3000000-0000-4000-8000-000000000004'","CALCULATOR_POLICY_INVALID"],
 ])("refuses %s from current locked source data",async(_name,change,restore,code)=>{
   await lab.admin.unsafe(change);try{await expect(caller.db.transaction(tx=>snapshot(tx),{isolationLevel:"serializable"})).rejects.toMatchObject({cause:{message:code}});}finally{await lab.admin.unsafe(restore);}
 });
 it("rejects a second eligible price instead of silently choosing a row",async()=>{
   const id=randomUUID();await lab.admin`INSERT INTO public.cost_code_pricing_history(id,cost_code_id,unit_id,unit_cost,unit_price,source,effective_date,is_active) SELECT ${id},cost_code_id,unit_id,unit_cost,unit_price,source,effective_date,is_active FROM public.cost_code_pricing_history WHERE id='c3000000-0000-4000-8000-000000000401'`;
   try{await expect(caller.db.transaction(tx=>snapshot(tx),{isolationLevel:"serializable"})).rejects.toMatchObject({cause:{message:"CALCULATOR_PRICE_AMBIGUOUS"}});}finally{await lab.admin`DELETE FROM public.cost_code_pricing_history WHERE id=${id}`;}
 });
 it.each([["a","4000","10000"],["b","6000","9000"],["c","1","1"]])("persists %s cents, complete audit and immutable receipt in one real transaction",async(key,cost,price)=>{
   const saved=await caller.db.transaction(tx=>create(tx,[{assemblyId:fixture.ids[key as 'a'|'b'|'c'],quantity:1}]),{isolationLevel:"serializable"});
   const r=saved.envelope.receipt;
   expect(saved.calculation.financials).toMatchObject({costMinor:cost,priceMinor:price});expect(r.draft).toMatchObject({source:"assembly_calculator",status:"draft",tenant_id:fixture.ids.tenant,created_by:fixture.ids.actor});
   expect(r.audit).toMatchObject({user_id:fixture.ids.actor,action:"estimate_draft.create",table_name:"estimate_drafts",record_id:r.draftId,old_values:null});expect(r.audit.new_values.draft).toEqual(r.draft);
   const [persisted]=await lab.admin`SELECT (SELECT to_jsonb(d) FROM public.estimate_drafts d WHERE id=${r.draftId}) AS draft,(SELECT count(*) FROM structr_financial.calculator_requests WHERE draft_id=${r.draftId})::int AS receipts`;
   expect(persisted).toEqual({draft:r.draft,receipts:1});
   await expect(lab.admin`UPDATE structr_financial.calculator_requests SET receipt='{}' WHERE draft_id=${r.draftId}`).rejects.toMatchObject({code:"23514"});
 });
 it("recovers exact replay after a price change with no second draft or audit",async()=>{
   const saved=await caller.db.transaction(tx=>create(tx),{isolationLevel:"serializable"});const id=saved.envelope.receipt.draftId;
   await lab.admin`UPDATE public.cost_code_pricing_history SET unit_price=101 WHERE id='c3000000-0000-4000-8000-000000000401'`;
   try{
     const result=await caller.db.transaction(async tx=>{const [row]=await tx.execute(sql`SELECT structr_financial.calculator_recover_v1(${JSON.stringify(saved.save)}::jsonb) AS result`);return row.result as any;},{isolationLevel:"serializable"});
     expect(result.receipt).toEqual(saved.envelope.receipt);expect(result.currentDraft.id).toBe(id);
     const [rows]=await lab.admin`SELECT count(*)::int AS audits FROM public.audit_logs WHERE record_id=${id} AND action='estimate_draft.create'`;expect(rows.audits).toBe(1);
   }finally{await lab.admin`UPDATE public.cost_code_pricing_history SET unit_price=100 WHERE id='c3000000-0000-4000-8000-000000000401'`;}
 });
 it("rejects the same request ID with altered quantity",async()=>{
   const saved=await caller.db.transaction(tx=>create(tx),{isolationLevel:"serializable"});const changed={...saved.save,assemblies:[{assemblyId:fixture.ids.a,quantity:2}]};
   await expect(caller.db.transaction(async tx=>{await tx.execute(sql`SELECT structr_financial.calculator_recover_v1(${JSON.stringify(changed)}::jsonb)`);},{isolationLevel:"serializable"})).rejects.toMatchObject({cause:{message:"FINANCIAL_EXECUTOR_REQUEST_CONFLICT"}});
 });
 it("rolls draft and audit back when the surrounding transaction fails after receipt",async()=>{
   let draftId='';await expect(caller.db.transaction(async tx=>{const result=await create(tx);draftId=result.envelope.receipt.draftId;throw new Error("after receipt");},{isolationLevel:"serializable"})).rejects.toThrow("after receipt");
   const [count]=await lab.admin`SELECT (SELECT count(*) FROM public.estimate_drafts WHERE id=${draftId})::int AS drafts,(SELECT count(*) FROM public.audit_logs WHERE record_id=${draftId})::int AS audits,(SELECT count(*) FROM structr_financial.calculator_requests WHERE draft_id=${draftId})::int AS requests`;
   expect(count).toEqual({drafts:0,audits:0,requests:0});
 });

 it("persists a legitimate tiny nonzero margin with identical cross-language hash",async()=>{
   const [old]=await lab.admin`SELECT to_jsonb(p) AS row FROM public.cost_code_pricing_history p WHERE id='c3000000-0000-4000-8000-000000000401'`;
   await lab.admin`UPDATE public.cost_code_pricing_history SET unit_cost=9999999.99,unit_price=10000000 WHERE id='c3000000-0000-4000-8000-000000000401'`;
   try{const saved=await caller.db.transaction(tx=>create(tx),{isolationLevel:'serializable'});expect(saved.calculation.financials.grossProfitPct).toBe(0);expect(saved.envelope.receipt.calculationHash).toBe(saved.calculation.calculationHash);}finally{await restoreRow('cost_code_pricing_history',old.row,false);}
 });

 it("rejects an assembly outside the audited fixture",async()=>{
   const before=await counts();await expect(caller.db.transaction(tx=>snapshot(tx,{...fixture.command,assemblies:[{assemblyId:randomUUID(),quantity:1}]}),{isolationLevel:'serializable'})).rejects.toMatchObject({cause:{message:'CALCULATOR_MANIFEST_INVALID'}});expect(await counts()).toEqual(before);
 });

 it("keeps protected source hashes stable across caller timezone settings",async()=>{
   const acquire=()=>caller.db.transaction(async tx=>{const got=await snapshot(tx);return buildCalculatorResult(got.snapshot,fixture.command);},{isolationLevel:'serializable'});
   const initial=await acquire();await caller.sql.unsafe("SET timezone='Pacific/Honolulu'");try{expect((await acquire()).sourceHash).toBe(initial.sourceHash);}finally{await caller.sql.unsafe("SET timezone='UTC'");}
 });

 async function counts(){const [row]=await lab.admin`SELECT (SELECT count(*) FROM public.estimate_drafts)::int AS drafts,(SELECT count(*) FROM public.audit_logs WHERE action='estimate_draft.create')::int AS audits,(SELECT count(*) FROM structr_financial.calculator_requests)::int AS requests`;return row;}
 async function restoreRow(table:string,row:any,deleted:boolean){
   if(deleted) await lab.admin.unsafe(`INSERT INTO public.${table} SELECT (jsonb_populate_record(NULL::public.${table},$1::jsonb)).*`,[JSON.stringify(row)]);
   else await lab.admin.unsafe(`UPDATE public.${table} t SET ${Object.keys(row).map(k=>`${k}=r.${k}`).join(',')} FROM jsonb_populate_record(NULL::public.${table},$1::jsonb) r WHERE t.id=r.id`,[JSON.stringify(row)]);
 }
 it.each([
   ["missing price","cost_code_pricing_history",401,"DELETE","CALCULATOR_PRICE_MISSING"],
   ["expired price","cost_code_pricing_history",401,"expiration_date='2026-10-02'","CALCULATOR_PRICE_NOT_EFFECTIVE"],
   ["future price","cost_code_pricing_history",401,"effective_date='2099-01-01'","CALCULATOR_PRICE_NOT_EFFECTIVE"],
   ["inactive price","cost_code_pricing_history",401,"is_active=false","CALCULATOR_SOURCE_INACTIVE"],
   ["wrong price unit","cost_code_pricing_history",401,"unit_id='c3000000-0000-4000-8000-000000000099'","CALCULATOR_SOURCE_INCOMPATIBLE"],
   ["absent BOM","assembly_items",301,"DELETE","CALCULATOR_SOURCE_MISSING"],
   ["unscoped code","cost_codes",201,"tenant_id=NULL","CALCULATOR_SOURCE_TENANT_MISMATCH"],
   ["foreign code","cost_codes",201,"tenant_id='c3000000-0000-4000-8000-000000000098'","CALCULATOR_SOURCE_TENANT_MISMATCH"],
   ["inactive assembly","assemblies",101,"is_active=false","CALCULATOR_SOURCE_INACTIVE"],
   ["inactive type","cost_types",10,"is_active=false","CALCULATOR_SOURCE_INACTIVE"],
   ["different explicit type","cost_types",10,"name='Unclassified'","CALCULATOR_SOURCE_INCOMPATIBLE"],
   ["mismatched BOM type","assembly_items",301,"component_type='labor'","CALCULATOR_SOURCE_INCOMPATIBLE"],
   ["unclassified unit","assembly_items",301,"unit_id='c3000000-0000-4000-8000-000000000099'","CALCULATOR_SOURCE_INCOMPATIBLE"],
   ["unsupported assembly dimension","assemblies",101,"coastal_modifier=1.25","CALCULATOR_CONTEXT_UNSUPPORTED"],
   ["inactive client","clients",6,"is_active=false","FORBIDDEN"],
   ["wrong timezone","tenants",1,"timezone='UTC'","FORBIDDEN"],
 ] as const)("physically refuses %s without writing",async(_name,table,n,change,code)=>{
   await lab.admin`INSERT INTO public.units(id,name,abbreviation,is_active) VALUES('c3000000-0000-4000-8000-000000000099','Other','ZZ',true) ON CONFLICT DO NOTHING`;
   await lab.admin`INSERT INTO public.tenants(id,name,slug) VALUES('c3000000-0000-4000-8000-000000000098','Other tenant','other-tenant') ON CONFLICT DO NOTHING`;
   const id=`c3000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
   const [old]=await lab.admin.unsafe(`SELECT to_jsonb(t) AS row FROM public.${table} t WHERE id=$1`,[id]);const before=await counts();
   await lab.admin.unsafe(change==='DELETE'?`DELETE FROM public.${table} WHERE id=$1`:`UPDATE public.${table} SET ${change} WHERE id=$1`,[id]);
   try{await expect(caller.db.transaction(tx=>snapshot(tx),{isolationLevel:'serializable'})).rejects.toMatchObject({cause:{message:code}});expect(await counts()).toEqual(before);}finally{await restoreRow(table,old.row,change==='DELETE');}
 });
 it("changes protected policy revision and persisted effective floor",async()=>{
   const initial=await caller.db.transaction(tx=>snapshot(tx),{isolationLevel:'serializable'});
   await lab.admin`UPDATE public.tenant_settings SET geo_floor_overrides='{"coastal":43}',updated_at=now() WHERE tenant_id=${fixture.ids.tenant}`;
   try{
     const altered=await caller.db.transaction(tx=>snapshot(tx),{isolationLevel:'serializable'});expect(altered.snapshot.policyContext.floors.effectiveFloorPct).toBe('43');
     expect((await buildCalculatorResult(initial.snapshot,fixture.command)).sourceHash).not.toBe((await buildCalculatorResult(altered.snapshot,fixture.command)).sourceHash);
     const saved=await caller.db.transaction(tx=>create(tx),{isolationLevel:'serializable'});expect(saved.envelope.receipt.draft.profit_shield_floor_pct).toBe(43);
   }finally{await lab.admin`UPDATE public.tenant_settings SET geo_floor_overrides='{}',updated_at='2026-10-01T12:00:00Z' WHERE tenant_id=${fixture.ids.tenant}`;}
 });
 it.each([
   ['price',"UPDATE public.cost_code_pricing_history SET unit_price=102 WHERE id='c3000000-0000-4000-8000-000000000401'","UPDATE public.cost_code_pricing_history SET unit_price=100 WHERE id='c3000000-0000-4000-8000-000000000401'"],
   ['BOM',"UPDATE public.assembly_items SET default_qty_per_unit=2 WHERE id='c3000000-0000-4000-8000-000000000301'","UPDATE public.assembly_items SET default_qty_per_unit=1 WHERE id='c3000000-0000-4000-8000-000000000301'"],
   ['authority',"UPDATE public.profiles SET is_active=false WHERE id='c3000000-0000-4000-8000-000000000002'","UPDATE public.profiles SET is_active=true WHERE id='c3000000-0000-4000-8000-000000000002'"],
 ] as const)("serializes an actual concurrent %s change before retry",async(kind,change,restore)=>{
   const probe=await lab.connectLogin();let release!:()=>void,ready!:()=>void;const readyPromise=new Promise<void>(resolve=>ready=resolve),hold=new Promise<void>(resolve=>release=resolve);
   const mutation=lab.admin.begin(async tx=>{await tx.unsafe(change);ready();await hold;});await readyPromise;
   const read=caller.db.transaction(tx=>snapshot(tx),{isolationLevel:'serializable'}).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
   try{
     let blocked=false;for(let n=0;n<100&&!blocked;n++){const [row]=await probe.sql`SELECT cardinality(pg_blocking_pids(${caller.pid}))>0 AS blocked`;blocked=row.blocked;if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));}
     expect(blocked).toBe(true);release();await mutation;const first=await read;expect(first.error).toMatchObject({cause:{code:'40001'}});
     if(kind==='authority')await expect(caller.db.transaction(tx=>snapshot(tx),{isolationLevel:'serializable'})).rejects.toMatchObject({cause:{message:'FORBIDDEN'}});
     else{const current=await caller.db.transaction(tx=>snapshot(tx),{isolationLevel:'serializable'});if(kind==='price')expect(current.snapshot.prices[0].unitPrice).toBe('102');else expect(current.snapshot.assemblies[0].components[0].quantity).toBe('2');}
   }finally{release();await mutation;await read;await lab.admin.unsafe(restore);}
 });
 it.each([
   ['suppressed audit','audit_logs','BEFORE',"IF NEW.action='estimate_draft.create' THEN RETURN NULL;END IF;RETURN NEW;"],
   ['changed audit','audit_logs','BEFORE',"IF NEW.action='estimate_draft.create' THEN NEW.new_values='{}';END IF;RETURN NEW;"],
   ['duplicate audit','audit_logs','AFTER',"IF NEW.action='estimate_draft.create' AND pg_trigger_depth()=1 THEN INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values,created_at) VALUES(NEW.user_id,NEW.action,NEW.table_name,NEW.record_id,NEW.old_values,NEW.new_values,NEW.created_at);END IF;RETURN NEW;"],
   ['changed physical draft','estimate_drafts','BEFORE',"NEW.subtotal_cost=NEW.subtotal_cost+1;RETURN NEW;"],
   ['suppressed request','structr_financial.calculator_requests','BEFORE',"RETURN NULL;"],
   ['failure after request','structr_financial.calculator_requests','AFTER',"RAISE EXCEPTION 'TEST_AFTER_REQUEST';"],
 ] as const)("rolls back all three writes after %s",async(_name,rawTable,timing,body)=>{
   const table=rawTable.includes('.')?rawTable:`public.${rawTable}`,before=await counts();
   await lab.admin.unsafe(`CREATE FUNCTION public.calculator_test_fault() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$ BEGIN ${body} END $body$; REVOKE ALL ON FUNCTION public.calculator_test_fault() FROM PUBLIC; CREATE TRIGGER calculator_test_fault ${timing} INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION public.calculator_test_fault()`);
   try{await expect(caller.db.transaction(tx=>create(tx),{isolationLevel:'serializable'})).rejects.toBeDefined();expect(await counts()).toEqual(before);}finally{await lab.admin.unsafe(`DROP TRIGGER calculator_test_fault ON ${table}; DROP FUNCTION public.calculator_test_fault()`);}
 });

 it.each([
   ['hidden requests',"CREATE POLICY calculator_test_hidden ON structr_financial.calculator_requests AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)","DROP POLICY calculator_test_hidden ON structr_financial.calculator_requests"],
   ['hidden historical links',"CREATE POLICY calculator_test_hidden ON public.historical_estimate_imports AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)","DROP POLICY calculator_test_hidden ON public.historical_estimate_imports"],
   ['filtered audit rows',"ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY"],
 ] as const)("refuses %s before a false not_found",async(_name,drift,restore)=>{
   const before=await counts();await lab.admin.unsafe(drift);
   try{await expect(caller.db.transaction(async tx=>{await tx.execute(sql`SELECT structr_financial.calculator_recover_v1(${JSON.stringify({...fixture.contextCommand,operation:'calculator.recover',requestId:randomUUID()})}::jsonb)`);},{isolationLevel:'serializable'})).rejects.toMatchObject({cause:{code:'42501',message:'FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH'}});expect(await counts()).toEqual(before);}finally{await lab.admin.unsafe(restore);}
 });

});


describe.skipIf(!enabled)("ADR-003 lifecycle installation remains closed",()=>{
 let lab:Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>;
 beforeAll(async()=>{lab=await startFinancialCalculatorBoundary();await lab.install();},60000);afterAll(async()=>lab?.stop());
 it.each([
   ['owner LOGIN','ALTER ROLE structr_calculator_write_owner_v1 LOGIN'],
   ['owner membership','CREATE ROLE hostile_owner NOLOGIN; GRANT hostile_owner TO structr_calculator_read_owner_v1 WITH INHERIT FALSE,SET TRUE'],
   ['future API execution','ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO authenticated'],
   ['cross-schema PUBLIC definer','CREATE SCHEMA hostile; CREATE FUNCTION hostile.reader() RETURNS int LANGUAGE sql SECURITY DEFINER RETURN 1'],
   ['cross-schema owner route','CREATE SCHEMA hostile; REVOKE ALL ON SCHEMA hostile FROM PUBLIC; CREATE FUNCTION hostile.reader() RETURNS int LANGUAGE sql SECURITY DEFINER RETURN 1; REVOKE ALL ON FUNCTION hostile.reader() FROM PUBLIC; GRANT USAGE ON SCHEMA hostile TO structr_calculator_read_owner_v1; GRANT EXECUTE ON FUNCTION hostile.reader() TO structr_calculator_read_owner_v1'],
   ['login schema creation','GRANT CREATE ON SCHEMA public TO structr_calculator_login_v1'],
 ] as const)("atomically rejects post-foundation %s drift",async(_name,drift)=>{
   const rolledBack=new Error('rollback hostile lab drift');
   await expect(lab.admin.begin(async tx=>{
     await tx.unsafe(drift);const [before]=await tx`SELECT pg_get_functiondef('structr_financial.calculator_context_v1(jsonb)'::regprocedure) AS definition`;
     await expect(tx.savepoint(async candidate=>candidate.unsafe(await readFile(new URL('../drizzle/0021_financial_calculator_lifecycle.sql',import.meta.url),'utf8')))).rejects.toMatchObject({code:'42501'});
     const [after]=await tx`SELECT pg_get_functiondef('structr_financial.calculator_context_v1(jsonb)'::regprocedure) AS definition,to_regprocedure('structr_financial.authorize_v1(jsonb)') AS partial`;
     expect(after).toEqual({...before,partial:null});throw rolledBack;
   })).rejects.toBe(rolledBack);
 });
});


describe.skipIf(!enabled)("ADR-003 audited fixture classification",()=>{
 it.each([
  ['unknown dimension',{dimensionSource:'browser_guessed'},'CALCULATOR_CONTEXT_UNSUPPORTED'],
  ['unknown shared source',{sharedSourceClassification:'global_unreviewed'},'CALCULATOR_CONTEXT_UNSUPPORTED'],
  ['non-unit dimension',{context:{channel:'direct',finishLevel:'standard',region:'charleston_sc',currency:'USD',dimensions:{wasteFactor:2}}},'CALCULATOR_CONTEXT_UNSUPPORTED'],
 ] as const)("refuses %s even when stored in an audited immutable fixture",async(_name,manifestOverrides,code)=>{
  const lab=await startFinancialCalculatorBoundary();try{
   await lab.install();await lab.admin.begin(async tx=>tx.unsafe(await readFile(new URL('../drizzle/0021_financial_calculator_lifecycle.sql',import.meta.url),'utf8')));
   const fixture=await setupCalculatorLifecycleFixture(lab,{manifestOverrides}),caller=await lab.connectLogin();
   await expect(caller.db.transaction(async tx=>tx.execute(sql`SELECT structr_financial.calculator_snapshot_v1(${JSON.stringify(fixture.command)}::jsonb)`),{isolationLevel:'serializable'})).rejects.toMatchObject({cause:{message:code}});
   const [rows]=await lab.admin`SELECT (SELECT count(*) FROM public.estimate_drafts)::int AS drafts,(SELECT count(*) FROM structr_financial.calculator_requests)::int AS requests`;expect(rows).toEqual({drafts:0,requests:0});
  }finally{await lab.stop();}
 },30000);
});
