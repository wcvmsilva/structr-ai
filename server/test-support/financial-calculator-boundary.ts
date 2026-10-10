/** Owned PG17.11 laboratory; no external destination or credential inputs. */
import postgres from "postgres";
import { readFile, access, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { startAppPrincipalPostgres } from "./app-principal-postgres";

const root = new URL("../../", import.meta.url);
export const boundaryMigration = "0020_closed_financial_calculator_boundary";
export async function boundarySource() { return readFile(new URL(`drizzle/${boundaryMigration}.sql`, root), "utf8"); }
export async function startFinancialCalculatorBoundary() {
  if (process.env.FINANCIAL_CALCULATOR_BOUNDARY_PHYSICAL !== "1") throw new Error("Explicit boundary physical opt-in required");
  const cluster = await startAppPrincipalPostgres(postgres);
  const admin = cluster.observer.sql;
  const clients: ReturnType<typeof postgres>[] = [];
  try {
    const [identity] = await admin`SELECT current_setting('server_version_num') AS version, current_setting('app_principal_lab.nonce') AS nonce`;
    if (identity.version !== "170011") throw new Error("Requires real PostgreSQL 17.11");
    await admin.unsafe(`CREATE ROLE anon NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT anon,authenticated,service_role TO authenticator WITH INHERIT FALSE, SET TRUE;`);
    const journal = JSON.parse(await readFile(new URL("drizzle/meta/_journal.json", root), "utf8"));
    const migrations: Array<{tag:string;sha256:string}> = [];
    for (const {tag} of journal.entries as Array<{tag:string}>) {
      if (Number(tag.slice(0,4))>19) continue;
      const source = await readFile(new URL(`drizzle/${tag}.sql`,root),"utf8");
      if (tag.startsWith("0015")) {
        let refusal:any;
        try { await admin.begin(async tx=>{ await tx.unsafe(source); }); } catch(error) { refusal=error; }
        if (refusal?.code!=="42501" || !refusal.message.startsWith("ADR002_BUSINESS_FUNCTION_PREFLIGHT:"))
          throw new Error("Uncontained legacy baseline was not refused as expected",{cause:refusal});
        const [partial] = await admin`SELECT to_regnamespace('structr_private') IS NOT NULL AS schema, to_regrole('structr_review_owner_v1') IS NOT NULL AS role`;
        if (partial.schema || partial.role) throw new Error("Legacy refused installation left partial objects");
        console.log("BOUNDARY_UNCONTAINED_BASELINE_REFUSED",refusal.code,refusal.message);
        await admin.begin(async tx=>{await tx.unsafe(await readFile(new URL("./financial-calculator-boundary/legacy-public-containment.sql",import.meta.url),"utf8"));});
      }
      await admin.begin(async tx=>{
        await tx.unsafe(source);
        if(tag.startsWith("0018")) await tx.unsafe(await readFile(new URL("docs/security/intake-formation/homolog-close.sql",root),"utf8"));
        if(tag.startsWith("0019")) await tx.unsafe(await readFile(new URL("docs/security/scope-workspace-read/homolog-close.sql",root),"utf8"));
      });
      migrations.push({tag,sha256:createHash("sha256").update(source).digest("hex")});
    }
    console.log("BOUNDARY_BASELINE",JSON.stringify({directory:cluster.directory,version:identity.version,migrations}));
    if(process.env.FINANCIAL_CALCULATOR_CAPTURE_BASELINE==="1") {
      const catalog=await admin.begin(async tx=>{await tx.unsafe("SET LOCAL search_path=pg_catalog");return tx.unsafe(await readFile(new URL("./financial-calculator-boundary/catalog.sql",import.meta.url),"utf8"));});
      await writeFile("/private/tmp/calculator-boundary-baseline-catalog.json",JSON.stringify(catalog,null,2));
    }
    async function install() {
      await admin.begin(async tx=>{await tx.unsafe(await boundarySource());});
      if(process.env.FINANCIAL_CALCULATOR_CAPTURE_INSTALLED==="1") {
        const source=(await readFile(new URL("./financial-calculator-boundary/catalog.sql",import.meta.url),"utf8")).replaceAll("('public','structr_private')","('public','structr_private','structr_financial')");
        const catalog=await admin.begin(async tx=>{await tx.unsafe("SET LOCAL search_path=pg_catalog");return tx.unsafe(source);});
        await writeFile("/private/tmp/calculator-boundary-installed-catalog.json",JSON.stringify(catalog,null,2));
      }
    }
    async function connectLogin() {
      // Explicit test-only opening of the otherwise NOLOGIN principal. No password.
      await admin.unsafe("ALTER ROLE structr_calculator_login_v1 LOGIN");
      const caller=await cluster.connect("financial-calculator-boundary", "structr_calculator_login_v1");
      console.log("BOUNDARY_LOGIN",JSON.stringify(await caller.sql`SELECT session_user,current_user,pg_backend_pid() AS pid`));
      return caller;
    }
    async function stop() {await Promise.allSettled(clients.map(c=>c.end({timeout:1})));await cluster.stop();if(await access(cluster.directory).then(()=>true,()=>false))throw new Error("Owned cluster directory not removed");console.log("BOUNDARY_CLEANUP",cluster.directory,"removed");}
    return {admin,cluster,migrations,install,connectLogin,stop};
  } catch(error) {await Promise.allSettled(clients.map(c=>c.end({timeout:1})));await cluster.stop();throw error;}
}

/** Audited, complete, disposable A/B/C fixture. Never takes a remote connection. */
export async function setupCalculatorLifecycleFixture(lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>, options: {manifestOverrides?: Record<string,unknown>} = {}) {
  const {calculatorSnapshot,calculatorIds:i,calculatorId,calculatorCommand}=await import("./calculator-engine-fixture");
  const base=calculatorSnapshot(),subject=calculatorId(14),roleId=calculatorId(15),createPermission=calculatorId(16),writePermission=calculatorId(17);
  await lab.admin.begin(async tx=>{
    // postgres TransactionSql omits the tagged-call signature from its Omit type.
    // The owned callback is the real transaction tag; keep this cast local and typed.
    const query=tx as unknown as postgres.Sql;
    await query`INSERT INTO public.tenants(id,name,slug,timezone) VALUES(${i.tenant},'Calculator laboratory','calculator-lifecycle','America/New_York')`;
    await query`INSERT INTO public.profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${i.actor},${i.tenant},${subject},'financial_operator',true)`;
    await query`INSERT INTO public.roles(id,name) VALUES(${roleId},'financial_operator')`;
    await query`INSERT INTO public.permissions(id,resource,action) VALUES(${createPermission},'estimate','create'),(${writePermission},'project','write')`;
    await query`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${roleId},${createPermission}),(${roleId},${writePermission})`;
    await query`INSERT INTO public.clients(id,tenant_id,name,is_active) VALUES(${i.client},${i.tenant},'Synthetic client',true)`;
    await query`INSERT INTO public.geo_zones(id,tenant_id,name,zone_name,is_active,coastal_exposure_level,cost_multiplier,labor_modifier,material_modifier,logistics_modifier,contingency_pct,min_profit_shield_pct)
      VALUES(${i.zone},${i.tenant},'Synthetic coastal zone','Synthetic coastal zone',true,'moderate',1,1,1,1,0,42)`;
    const at='2026-10-01T12:00:00.000Z';
    const reviewEvidence={version:'project-geocode-review-v1',projectId:i.project,tenantId:i.tenant,inputAddress:{address:'1 Synthetic Lane',city:'Synthetic City',state:'SC',zipCode:'00000',county:'Synthetic County'},geocodedAt:at,geocode:{success:true,latitude:32.75,longitude:-79.9,formattedAddress:'1 Synthetic Lane, Synthetic City',confidence:'high',source:'google_maps',withinServiceRadius:true},zoneDetection:{zoneId:i.zone,method:'coordinates',confidence:'high'}};
    const zoneSnapshot={zoneId:i.zone,zoneName:'Synthetic coastal zone',laborModifier:1,materialModifier:1,logisticsModifier:1,contingencyPct:0,minProfitShieldPct:42,coastalExposureLevel:'moderate',capturedAt:at,reviewEvidence};
    await query`INSERT INTO public.projects(id,tenant_id,client_id,owner_user_id,name,project_type,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot)
      VALUES(${i.project},${i.tenant},${i.client},${i.actor},'Synthetic financial project','repair','direct','coastal','1 Synthetic Lane','Synthetic City','SC','00000','Synthetic County',32.75,-79.9,${at},'high','google_maps','1 Synthetic Lane, Synthetic City','Synthetic coastal zone',${JSON.stringify(zoneSnapshot)}::jsonb)`;
    await query`INSERT INTO public.intake_forms(id,tenant_id,project_id,status,form_data) VALUES(${i.intake},${i.tenant},${i.project},'draft','{"serviceType":"repair","finishLevel":"standard","channel":"direct"}')`;
    await query`INSERT INTO public.tenant_settings(id,tenant_id,profit_shield_overrides,geo_floor_overrides,updated_at) VALUES(${i.settings},${i.tenant},'{}','{}',${at})`;
    await query`INSERT INTO public.cost_types(id,name,is_active) VALUES(${i.type},'Material',true)`;
    await query`INSERT INTO public.units(id,name,abbreviation,is_active) VALUES(${i.unit},'Each','EA',true)`;
    for(const assembly of base.assemblies){const c=assembly.components[0],code=base.costCodes.find(x=>x.id===c.costCodeId)!,price=base.prices.find(x=>x.costCodeId===code.id)!;
      await query`INSERT INTO public.cost_codes(id,tenant_id,code,name,default_cost_type_id,default_unit_id,is_active) VALUES(${code.id},${i.tenant},${code.code},${code.name},${i.type},${i.unit},true)`;
      await query`INSERT INTO public.cost_code_pricing_history(id,cost_code_id,unit_id,unit_cost,unit_price,source,effective_date,expiration_date,is_active) VALUES(${price.id},${code.id},${i.unit},${price.unitCost},${price.unitPrice},${price.source},'2026-10-01',NULL,true)`;
      await query`INSERT INTO public.assemblies(id,tenant_id,name,code,category,trade,default_unit_id,base_unit_qty,waste_factor,coastal_modifier,region,finish_level,is_active) VALUES(${assembly.id},${i.tenant},${assembly.name},${assembly.code},${assembly.category},NULL,${i.unit},1,0,1,'charleston_sc','standard',true)`;
      await query`INSERT INTO public.assembly_items(id,assembly_id,cost_code_id,cost_type_id,unit_id,description,default_qty_per_unit,waste_factor,component_type,unit_cost_override,is_optional,sort_order) VALUES(${c.id},${assembly.id},${code.id},${i.type},${i.unit},${c.description},1,0,'material',NULL,false,1)`;
    }
    await query`INSERT INTO structr_financial.principal_bindings(id,session_role,subject,actor_id,tenant_id,operations) VALUES(${i.binding},'structr_calculator_login_v1',${subject},${i.actor},${i.tenant},ARRAY['calculator.context','calculator.calculate','calculator.create','calculator.recover'])`;
    const manifest={contractVersion:'calculator-fixture-v1',assemblyIds:base.manifest.assemblyIds,costCodeIds:base.manifest.costCodeIds,costTypeIds:base.manifest.costTypeIds,unitIds:base.manifest.unitIds,sharedSourceClassification:base.manifest.sharedSourceClassification,dimensionSource:base.manifest.dimensionSource,context:base.context,policyContext:base.policyContext,costTypeClassifications:{[i.type]:{name:'Material',componentType:'material'}},zoneSnapshot,...options.manifestOverrides};
    const [m]=await query`SELECT encode(sha256(convert_to(${JSON.stringify(manifest)}::jsonb::text,'UTF8')),'hex') AS hash`;
    const event={contractVersion:'calculator-fixture-v1',bindingId:i.binding,tenantId:i.tenant,actorId:i.actor,fixtureId:i.fixture,projectId:i.project,intakeFormId:i.intake,clientId:i.client,manifestHash:m.hash,manifest};
    await query`INSERT INTO public.audit_logs(id,user_id,action,table_name,record_id,old_values,new_values,created_at) VALUES(${i.audit},${i.actor},'financial.calculator.fixture.create','calculator_fixtures',${i.fixture},NULL,${JSON.stringify(event)}::jsonb,${at})`;
    await query`INSERT INTO structr_financial.calculator_fixtures(id,binding_id,tenant_id,actor_id,project_id,intake_form_id,client_id,manifest,manifest_hash,provenance_audit_id,created_at,updated_at)
      VALUES(${i.fixture},${i.binding},${i.tenant},${i.actor},${i.project},${i.intake},${i.client},${JSON.stringify(manifest)}::jsonb,${m.hash},${i.audit},${at},${at})`;
  });
  return {ids:{...i,subject,roleId,createPermission,writePermission},command:calculatorCommand(),contextCommand:{contractVersion:'calculator-v1',operation:'calculator.context',projectId:i.project,intakeFormId:i.intake}};
}
