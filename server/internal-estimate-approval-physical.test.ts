/** A1 constraints on a separately owned socket-only laboratory; never DATABASE_URL. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import postgres from 'postgres';
import { makeInternalApprovalSnapshot } from './internal-estimate-approval-engine.fixtures';

const labConfig = process.env.A1_PHYSICAL_CONFIG;
let first: TestConnection, second: TestConnection;
let tenantId: string, actorId: string, clientId: string, projectId: string;
let secondPid: number;
const at = '2026-09-19T12:00:00.123Z';
const contentHash = 'a'.repeat(64), policyHash = 'b'.repeat(64), requestHash = 'c'.repeat(64);
// postgres 3.4.8 declares TransactionSql via Omit<Sql>, which drops Sql's call
// signatures. Restore only the tag/identifier/row calls used by this fixture;
// retain transaction methods without adding connection-only methods to Tx.
interface TransactionCalls {
  <T extends readonly (object | undefined)[] = postgres.Row[]>(template: TemplateStringsArray, ...parameters: readonly postgres.ParameterOrFragment<never>[]): postgres.PendingQuery<T>;
  (identifier: string): postgres.Helper<string, []>;
  <T extends Record<string, unknown>>(row: T): postgres.Helper<T, []>;
}
type Tx = postgres.TransactionSql & TransactionCalls;
type TestConnection = {
  begin<T>(callback: (tx: Tx) => T | Promise<T>): Promise<T>;
} & ReturnType<typeof postgres>;
type Snapshot = ReturnType<typeof makeInternalApprovalSnapshot>;

function snapshot(id: string): Snapshot {
  const value = makeInternalApprovalSnapshot();
  value.identity = {tenantId,projectId,clientId,estimateDraftId:id,draftVersion:1};
  value.origin.sourceCreatedAt = at;
  value.commercialContext.policyContext.projectGeo.zoneTenantId = tenantId;
  return value;
}
function evaluation() {
  return {version:'internal-approval-evaluation-v1',policyVersion:'phase2-channel-geo-plus-tenant-exact-v1',policyHash,commercialChannel:'premium',geoRiskClass:'coastal',floorKind:'margin',effectiveFloorPct:'42',priceMinor:'10000',costMinor:'4000',profitMinor:'6000',passed:true,violations:[],warnings:[]};
}
async function pricedDraft() {
  const id = await draft(), value = snapshot(id);
  await first`update estimate_drafts set bundle_name=${value.presentation.bundleName},notes=${value.presentation.reviewedNotes},pricing_schema_version='1.0',channel='direct',finish_level='standard',region='synthetic',subtotal_price=100,subtotal_cost=40,final_total_price=100,discount_applied=false,discount_amount=0,assembly_count=1,line_items=${first.json([{costGroupName:'Cabinetry & Millwork',costItemName:'Synthetic shelf',description:'Synthetic component',quantity:2,unit:'EA',unitCostSnapshot:'20',unitPriceSnapshot:'50',lineTotalCost:40,lineTotalPrice:100,assemblyId:value.lines[0].assemblyId,costCode:'12-100',taxable:null}])},assembly_selections=${first.json([{assemblyId:value.assemblySelections[0].assemblyId,assemblyName:'Synthetic assembly',assemblyCode:'SYN-1',category:'Synthetic',quantity:2,unitCost:20,unitPrice:50,extendedCost:40,extendedPrice:100}])} where id=${id}`;
  return {id,value};
}
async function insertSnapshot(tx: Tx, id: string, value: Snapshot, sid: string = randomUUID(), extra: Record<string,unknown> = {}) {
  const row = {id:sid,tenant_id:tenantId,project_id:projectId,client_id:clientId,estimate_draft_id:id,draft_version:1,contract_version:'internal-approval-snapshot-v1',content_hash:contentHash,currency_code:'USD',currency_basis:'approver_confirmation',subtotal_price_minor:'10000',discount_minor:'0',final_price_minor:'10000',estimated_cost_minor:'4000',policy_version:'phase2-channel-geo-plus-tenant-exact-v1',policy_hash:policyHash,snapshot_payload:tx.json(value),policy_evaluation:tx.json(evaluation()),captured_by:actorId,created_at:at,updated_at:at,...extra};
  await tx`insert into estimate_internal_approval_snapshots ${tx(row)}`;
  return sid;
}
async function approve(tx: Tx, id: string, value: Snapshot, options: {snapshotId?:string;approvalId?:string;requestId?:string;reason?:string;snapshotExtra?:Record<string,unknown>} = {}) {
  const approvalId = options.approvalId ?? randomUUID();
  await tx`update estimate_drafts set status='internally_approved',approved_by=${actorId},approved_at=${at},locked_at=${at},profit_shield_passed=true,profit_shield_floor_pct=42,profit_shield_evaluation=${tx.json(evaluation())} where id=${id}`;
  const snapshotId = await insertSnapshot(tx,id,value,options.snapshotId,options.snapshotExtra);
  await tx`insert into estimate_internal_approvals(id,tenant_id,project_id,client_id,estimate_draft_id,snapshot_id,request_id,request_hash,approved_by,approved_at,reason,contract_version,created_at,updated_at)
    values (${approvalId},${tenantId},${projectId},${clientId},${id},${snapshotId},${options.requestId ?? randomUUID()},${requestHash},${actorId},${at},${options.reason ?? 'Synthetic reviewed decision'},'internal-approval-decision-v1',${at},${at})`;
  return {snapshotId,approvalId,id};
}
async function decided() {const source=await pricedDraft();return {...source,...await first.begin(tx=>approve(tx,source.id,source.value))};}
async function revoke(tx: Tx, id: string, approvalId: string, updateStatus = true) {
  if(updateStatus) await tx`update estimate_drafts set status='internal_approval_revoked',updated_at=${at} where id=${id}`;
  const revocationId=randomUUID();
  await tx`insert into estimate_internal_approval_revocations(id,tenant_id,project_id,client_id,estimate_draft_id,approval_id,request_id,request_hash,revoked_by,revoked_at,reason,contract_version,created_at,updated_at)
    values (${revocationId},${tenantId},${projectId},${clientId},${id},${approvalId},${randomUUID()},${requestHash},${actorId},${at},'Synthetic revoked decision','internal-approval-revocation-v1',${at},${at})`;
  return revocationId;
}
async function successor(tx: Tx, sourceId: string, id = randomUUID(), requestId = randomUUID()) {
  await tx`insert into estimate_drafts(id,tenant_id,project_id,client_id,created_by,source,status,version,supersedes_id,a1_version_request_id,a1_version_request_hash,created_at,updated_at)
    values (${id},${tenantId},${projectId},${clientId},${actorId},'version','draft',2,${sourceId},${requestId},${requestHash},${at},${at})`;
  await tx`update estimate_drafts set superseded_by=${id} where id=${sourceId}`;
  return id;
}
function latch() { let release!:()=>void;const promise=new Promise<void>(done=>{release=done;});return {promise,release}; }
async function waitForSecondLock(tx:Tx) {
  for(let attempt=0;attempt<200;attempt++) {
    const [state]=await tx`select wait_event_type from pg_stat_activity where pid=${secondPid}`;
    if(state?.wait_event_type==='Lock')return;
    await new Promise(done=>setTimeout(done,10));
  }
  throw new Error('Expected the actual second connection to wait on the parent row lock');
}

async function draft(status = 'draft') {
  const id = randomUUID();
  await first`insert into estimate_drafts(id,tenant_id,project_id,client_id,created_by,status,source,version,created_at,updated_at)
    values (${id},${tenantId},${projectId},${clientId},${actorId},${status},'assembly_calculator',1,${at},${at})`;
  return id;
}

describe.skipIf(!labConfig)('A1 PostgreSQL physical invariants', () => {
  beforeAll(async () => {
    const config = JSON.parse(await readFile(labConfig!, 'utf8')) as {directory:string;dataDirectory:string;socketDirectory:string;database:string;user:string;port:number};
    const directory = await realpath(config.directory);
    if (!directory.startsWith('/private/tmp/structr-a1-') || directory !== resolve(config.directory) || config.database !== 'a1_test' || config.user !== 'a1_lab' || !Number.isInteger(config.port)) throw new Error('Not an owned A1 laboratory configuration');
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory + sep) || !socketDirectory.startsWith(directory + sep) || dataDirectory !== resolve(config.dataDirectory) || socketDirectory !== resolve(config.socketDirectory)) throw new Error('A1 laboratory paths escape the owned directory');
    const options = {host:socketDirectory,database:config.database,username:config.user,port:config.port,ssl:false as const,max:1,prepare:false};
    first = postgres(options) as TestConnection; second = postgres(options) as TestConnection;
    for (const connection of [first, second]) {
      const [identity] = await connection`select current_database() as database,current_user as username,current_setting('data_directory') as data_directory,current_setting('unix_socket_directories') as socket_directories,current_setting('listen_addresses') as listen_addresses,current_setting('port') as port,inet_server_addr() as server_address`;
      if (identity.database !== config.database || identity.username !== config.user || await realpath(identity.data_directory) !== dataDirectory || identity.socket_directories !== socketDirectory || identity.listen_addresses !== '' || Number(identity.port) !== config.port || identity.server_address !== null) throw new Error('A1 server identity does not match the owned socket-only laboratory');
    }
    secondPid=Number((await second`select pg_backend_pid() as pid`)[0].pid);
  });
  afterAll(async () => { await Promise.all([first?.end(), second?.end()]); });
  beforeEach(async () => {
    tenantId = randomUUID(); actorId = randomUUID(); clientId = randomUUID(); projectId = randomUUID();
    await first`insert into tenants(id,name,slug) values (${tenantId},'Synthetic A1 laboratory',${'a1-' + tenantId})`;
    await first`insert into profiles(id,tenant_id,is_active,role) values (${actorId},${tenantId},true,'user')`;
    await first`insert into clients(id,tenant_id,name) values (${clientId},${tenantId},'Synthetic fixture client')`;
    await first`insert into projects(id,tenant_id,client_id,owner_user_id,name,project_type) values (${projectId},${tenantId},${clientId},${actorId},'Synthetic A1 project','repair')`;
  });

  it('refuses a new legacy approved draft instead of manufacturing approval', async () => {
    await expect(draft('approved')).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from estimate_drafts where project_id=${projectId}`).toHaveLength(0);
  });
  it('refuses a generic transition into legacy approved even with author and timestamps', async () => {
    const id = await draft();
    await expect(first`update estimate_drafts set status='approved',approved_by=${actorId},approved_at=${at},locked_at=${at} where id=${id}`).rejects.toMatchObject({code:'23514'});
    expect((await first`select status,approved_at from estimate_drafts where id=${id}`)[0]).toMatchObject({status:'draft',approved_at:null});
  });
  it('refuses direct insertion of internal approval status without an existing reviewed draft', async () => {
    await expect(draft('internally_approved')).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from estimate_drafts where project_id=${projectId}`).toHaveLength(0);
  });
  it('rolls back an internal approval status update without its paired decision', async () => {
    const id = await draft();
    await expect(first.begin(async tx => {
      await tx`update estimate_drafts set status='internally_approved',approved_by=${actorId},approved_at=${at},locked_at=${at} where id=${id}`;
    })).rejects.toMatchObject({code:'23514'});
    expect((await first`select status from estimate_drafts where id=${id}`)[0].status).toBe('draft');
  });
  it('commits a complete contextual approval with exact monetary strings and millisecond timestamps', async () => {
    const saved=await decided();
    const [row]=await first`select d.status,s.final_price_minor,s.estimated_cost_minor,s.created_at,s.snapshot_payload,a.snapshot_id from estimate_drafts d join estimate_internal_approval_snapshots s on s.estimate_draft_id=d.id join estimate_internal_approvals a on a.estimate_draft_id=d.id where d.id=${saved.id}`;
    expect(row).toMatchObject({status:'internally_approved',final_price_minor:'10000',estimated_cost_minor:'4000',snapshot_id:saved.snapshotId});
    expect(new Date(row.created_at).toISOString()).toBe(at);
    expect(row.snapshot_payload.lines[0]).toMatchObject({lineKey:'line:1',taxable:null,lineTotalPriceMinor:'10000'});
  });
  it('rolls back an orphan snapshot rather than granting authority by its presence', async () => {
    const source=await pricedDraft();
    await expect(first.begin(tx=>insertSnapshot(tx,source.id,source.value))).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from estimate_internal_approval_snapshots where estimate_draft_id=${source.id}`).toHaveLength(0);
  });
  it('rolls back paired evidence when the draft projection is not internally approved', async () => {
    const source=await pricedDraft();
    await expect(first.begin(async tx=>{await approve(tx,source.id,source.value);await tx`update estimate_drafts set status='draft' where id=${source.id}`;})).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from estimate_internal_approvals where estimate_draft_id=${source.id}`).toHaveLength(0);
  });
  it('rejects a hidden monetary change in the first approval transition', async () => {
    const source=await pricedDraft();
    await expect(first.begin(async tx=>{
      await tx`update estimate_drafts set status='internally_approved',final_total_price=101,approved_by=${actorId},approved_at=${at},locked_at=${at} where id=${source.id}`;
      await insertSnapshot(tx,source.id,source.value);
    })).rejects.toMatchObject({code:'23514'});
    expect((await first`select final_total_price from estimate_drafts where id=${source.id}`)[0].final_total_price).toBe('100');
  });
  it.each(['snapshot','approval','revocation'] as const)('rejects UPDATE and DELETE of immutable %s evidence', async kind => {
    const saved=await decided();await first.begin(tx=>revoke(tx,saved.id,saved.approvalId));
    const table={snapshot:'estimate_internal_approval_snapshots',approval:'estimate_internal_approvals',revocation:'estimate_internal_approval_revocations'}[kind];
    await expect(first`update ${first(table)} set deleted_at=${at} where estimate_draft_id=${saved.id}`).rejects.toMatchObject({code:'23514'});
    await expect(first`delete from ${first(table)} where estimate_draft_id=${saved.id}`).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from ${first(table)} where estimate_draft_id=${saved.id}`).toHaveLength(1);
  });
  it.each(['estimate_internal_approval_snapshots','estimate_internal_approvals','estimate_internal_approval_revocations'])('rejects TRUNCATE of %s even through an owner connection', async table => {
    const saved=await decided();await first.begin(tx=>revoke(tx,saved.id,saved.approvalId));
    await expect(first`truncate table ${first(table)} cascade`).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from estimate_internal_approval_snapshots where estimate_draft_id=${saved.id}`).toHaveLength(1);
    expect(await first`select id from estimate_internal_approvals where estimate_draft_id=${saved.id}`).toHaveLength(1);
    expect(await first`select id from estimate_internal_approval_revocations where estimate_draft_id=${saved.id}`).toHaveLength(1);
  });
  it('separates non-owner ACL denial from trigger denial under a temporary laboratory-only TRUNCATE grant', async () => {
    const saved=await decided(),reader='a1_physical_reader_'+randomUUID().replaceAll('-','');
    await first`create role ${first(reader)} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`;
    try {
      await first`grant usage on schema public to ${first(reader)}`;
      const [before]=await first`select has_table_privilege(${reader},'public.estimate_internal_approval_snapshots','TRUNCATE') as allowed`;
      expect(before.allowed).toBe(false);
      await expect(first.begin(async tx=>{await tx`set local role ${tx(reader)}`;await tx`truncate public.estimate_internal_approval_snapshots cascade`;})).rejects.toMatchObject({code:'42501'});
      await first`grant truncate on public.estimate_internal_approval_snapshots,public.estimate_internal_approvals,public.estimate_internal_approval_revocations to ${first(reader)}`;
      await expect(first.begin(async tx=>{await tx`set local role ${tx(reader)}`;await tx`truncate public.estimate_internal_approval_snapshots cascade`;})).rejects.toMatchObject({code:'23514'});
      const [row]=await first`select content_hash from estimate_internal_approval_snapshots where id=${saved.snapshotId}`;
      expect(row.content_hash).toBe(contentHash);
    } finally {
      await first`revoke all privileges on public.estimate_internal_approval_snapshots,public.estimate_internal_approvals,public.estimate_internal_approval_revocations from ${first(reader)}`;
      await first`revoke usage on schema public from ${first(reader)}`;
      await first`drop role ${first(reader)}`;
    }
  });
  it.each(['SET ROLE SELECT','inherited MAINTAIN'] as const)('refuses the migration with residual API privileges through %s', async route => {
    const ddl=await readFile(new URL('../drizzle/0007_internal_estimate_approval_core.sql',import.meta.url),'utf8');
    const block=ddl.slice(ddl.indexOf('DO $acl$'),ddl.indexOf('END $acl$;')+'END $acl$;'.length);
    const rollback=new Error('Rollback synthetic ACL fixture');
    try {
      await first.begin(async tx=>{
        const known=await tx`select oid from pg_roles where rolname='anon'`;
        if(!known.length)await tx`create role anon nologin nosuperuser nocreatedb nocreaterole nobypassrls`;
        const delegate='a1_acl_delegate_'+randomUUID().replaceAll('-','');
        await tx`create role ${tx(delegate)} nologin nosuperuser nocreatedb nocreaterole nobypassrls`;
        if(route==='SET ROLE SELECT') {
          await tx`grant select on public.estimate_internal_approval_snapshots to ${tx(delegate)}`;
          await tx`grant ${tx(delegate)} to anon with inherit false,set true`;
        } else {
          await tx`grant maintain on public.estimate_internal_approval_snapshots to ${tx(delegate)}`;
          await tx`grant ${tx(delegate)} to anon with inherit true,set true`;
        }
        let refused=false;
        await tx.savepoint(async sp=>{await sp.unsafe(block);}).catch(error=>{if(error.code!=='23514')throw error;refused=true;});
        expect(refused).toBe(true);
        throw rollback;
      });
    } catch(error) { if(error!==rollback)throw error; }
  });
  it('requires a matching revocation event for the revoked status', async () => {
    const saved=await decided();
    await expect(first`update estimate_drafts set status='internal_approval_revoked' where id=${saved.id}`).rejects.toMatchObject({code:'23514'});
    expect((await first`select status from estimate_drafts where id=${saved.id}`)[0].status).toBe('internally_approved');
  });
  it('requires the revoked projection when a revocation event is inserted', async () => {
    const saved=await decided();
    await expect(first.begin(tx=>revoke(tx,saved.id,saved.approvalId,false))).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from estimate_internal_approval_revocations where approval_id=${saved.approvalId}`).toHaveLength(0);
  });
  it('preserves the decision and financial freeze after terminal revocation', async () => {
    const saved=await decided();await first.begin(tx=>revoke(tx,saved.id,saved.approvalId));
    await expect(first`update estimate_drafts set subtotal_cost=1 where id=${saved.id}`).rejects.toMatchObject({code:'23514'});
    await expect(first`update estimate_drafts set status='internally_approved' where id=${saved.id}`).rejects.toMatchObject({code:'23514'});
    expect((await first`select status,subtotal_cost from estimate_drafts where id=${saved.id}`)[0]).toMatchObject({status:'internal_approval_revoked',subtotal_cost:'40'});
  });
  it('permits operational notes without rewriting the reviewed snapshot', async () => {
    const saved=await decided();await first`update estimate_drafts set notes='Operational note only' where id=${saved.id}`;
    const [row]=await first`select d.notes,s.snapshot_payload,s.content_hash from estimate_drafts d join estimate_internal_approval_snapshots s on s.estimate_draft_id=d.id where d.id=${saved.id}`;
    expect(row.notes).toBe('Operational note only');expect(row.snapshot_payload.presentation.reviewedNotes).toBe('Reviewed text — café');expect(row.content_hash).toBe(contentHash);
  });
  it('accepts legacy CRLF labels and codes as the exact reviewed LF text', async () => {
    const source=await pricedDraft(),value=source.value;
    const [raw]=await first`select line_items,assembly_selections from estimate_drafts where id=${source.id}`;
    Object.assign(value.presentation,{bundleName:'Bundle\nA'});
    Object.assign(value.lines[0],{costGroupName:'Cabinetry\nGroup',costItemName:'Shelf\nA',description:'Description\nA'});
    Object.assign(value.assemblySelections[0],{assemblyName:'Assembly\nA',assemblyCode:'SYN-\n1',category:'Category\nA'});
    Object.assign(raw.line_items[0],{costGroupName:' Cabinetry\r\nGroup ',costItemName:'Shelf\rA',description:'Description\r\nA'});
    Object.assign(raw.assembly_selections[0],{assemblyName:'Assembly\r\nA',assemblyCode:'SYN-\r\n1',category:'Category\rA'});
    await first`update estimate_drafts set bundle_name=${'Bundle\r\nA'},line_items=${first.json(raw.line_items)},assembly_selections=${first.json(raw.assembly_selections)} where id=${source.id}`;
    const saved=await first.begin(tx=>approve(tx,source.id,value));
    const [row]=await first`select snapshot_payload from estimate_internal_approval_snapshots where id=${saved.snapshotId}`;
    expect(row.snapshot_payload.lines[0].costItemName).toBe('Shelf\nA');
    expect(row.snapshot_payload.assemblySelections[0].assemblyCode).toBe('SYN-\n1');
    expect((await first`select bundle_name from estimate_drafts where id=${source.id}`)[0].bundle_name).toBe('Bundle\r\nA');
  });
  it('accepts legacy Unicode edges in canonical pricing codes without changing the raw draft', async () => {
    const source=await pricedDraft(),value=source.value;
    Object.assign(value.commercialContext.pricingContext,{zone:value.commercialContext.policyContext.projectGeo.zone,trade:'carpentry'});
    const [raw]=await first`select line_items from estimate_drafts where id=${source.id}`;
    Object.assign(raw.line_items[0],{unit:'\tEA\u00a0',costCode:' 12-100 '});
    await first`update estimate_drafts set pricing_schema_version=${'\t1.0\u00a0'},finish_level=${' standard '},region=${'\tsynthetic\u00a0'},zone=${' Synthetic coastal zone '},trade=${' carpentry '},line_items=${first.json(raw.line_items)} where id=${source.id}`;
    const saved=await first.begin(tx=>approve(tx,source.id,value));
    const [row]=await first`select snapshot_payload from estimate_internal_approval_snapshots where id=${saved.snapshotId}`;
    expect(row.snapshot_payload.commercialContext.pricingContext).toMatchObject({finishLevel:'standard',region:'synthetic',zone:'Synthetic coastal zone',trade:'carpentry'});
    expect((await first`select finish_level from estimate_drafts where id=${source.id}`)[0].finish_level).toBe(' standard ');
  });
  it.each(['extra_top','extra_line','null_version','unknown_money','wrong_sum','wrong_policy','wrong_line_key','unknown_classification_key'] as const)('rejects malformed snapshot %s with complete paired rows', async defect => {
    const source=await pricedDraft();const value=source.value as unknown as Record<string,any>;
    if(defect==='extra_top')value.waiver=true;
    if(defect==='extra_line')value.lines[0].approved=true;
    if(defect==='null_version')value.version=null;
    if(defect==='unknown_money')value.financials.estimatedCostMinor=null;
    if(defect==='wrong_sum')value.lines[0].lineTotalPriceMinor='9999';
    if(defect==='wrong_policy')value.commercialContext.policyContext.floors.effectiveFloorPct='0';
    if(defect==='wrong_line_key')value.lines[0].lineKey='line:2';
    if(defect==='unknown_classification_key')value.lines[0].csvClassification.autoApprove=true;
    await expect(first.begin(tx=>approve(tx,source.id,source.value))).rejects.toMatchObject({code:'23514'});
    expect((await first`select status from estimate_drafts where id=${source.id}`)[0].status).toBe('draft');
  });
  it('rejects snapshot monetary columns that disagree with the reviewed JSON', async () => {
    const source=await pricedDraft();
    await expect(first.begin(tx=>approve(tx,source.id,source.value,{snapshotExtra:{estimated_cost_minor:'3999'}}))).rejects.toMatchObject({code:'23514'});
  });
  it.each([
    ['legacy commercial alias from the wrong channel basis',(s:any,e:any)=>{s.commercialContext.policyContext.channelRawValue='capital';s.commercialContext.policyContext.commercialChannel='capital';s.commercialContext.policyContext.floors.channelBasePct='15';s.commercialContext.policyContext.floors.floorKind='fee';e.commercialChannel='capital';e.floorKind='fee';}],
    ['a pricing zone contradicting the current reviewed zone',(s:any)=>{s.commercialContext.pricingContext.zone='Another zone';}],
    ['claimed stored risk provenance with no stored risk',(s:any)=>{s.commercialContext.pricingContext.storedRiskBasis='persisted_pricing_context';}],
    ['missing derived coastal warning',(s:any)=>{s.commercialContext.policyContext.projectGeo.warningCodes=[];}],
    ['low exposure with persisted coastal risk contradicting the zone',(s:any)=>{const g=s.commercialContext.policyContext.projectGeo;g.coastalExposureLevel='low';g.riskResolutionBasis='persisted_project_risk';g.persistedProjectRiskClass='coastal';g.zone='Inland district';s.commercialContext.pricingContext.zone=null;}],
    ['missing high multiplier warning at the exact threshold',(s:any)=>{s.commercialContext.policyContext.projectGeo.costMultiplier='1.15';}],
    ['carriage return inside canonical labels',(s:any)=>{s.lines[0].costGroupName='Cabinetry\rGroup';}],
  ] as const)('rejects SQL/engine grammar divergence: %s', async (_name,mutate) => {
    const value=snapshot(randomUUID()),result=evaluation();mutate(value,result);
    const [row]=await first`select public.internal_approval_valid_snapshot_v1(${first.json(value)},${first.json(result)}) as valid`;
    expect(row.valid).toBe(false);
  });
  it('accepts the existing res pricing alias under the explicit pricing-channel basis', async () => {
    const value=snapshot(randomUUID());value.commercialContext.policyContext.channelRawValue='res';
    const [row]=await first`select public.internal_approval_valid_snapshot_v1(${first.json(value)},${first.json(evaluation())}) as valid`;
    expect(row.valid).toBe(true);
  });
  it.each(['snapshot id','approval request id'] as const)('rejects the all-zero UUID sentinel in a new %s', async field => {
    const source=await pricedDraft(),zero='00000000-0000-0000-0000-000000000000';
    await expect(first.begin(tx=>approve(tx,source.id,source.value,field==='snapshot id'?{snapshotId:zero}:{requestId:zero}))).rejects.toMatchObject({code:'23514'});
  });
  it('rejects the all-zero UUID sentinel in a version replay key', async () => {
    const parent=await draft();
    await expect(first.begin(tx=>successor(tx,parent,randomUUID(),'00000000-0000-0000-0000-000000000000'))).rejects.toMatchObject({code:'23514'});
  });
  it('rejects a decision reason with noncanonical tab and nonbreaking-space edges', async () => {
    const source=await pricedDraft();
    await expect(first.begin(tx=>approve(tx,source.id,source.value,{reason:'\tSynthetic reviewed decision\u00a0'}))).rejects.toMatchObject({code:'23514'});
  });
  it('rejects a forged passing evaluation one cent below the exact 42 percent floor at 20 digits', async () => {
    const source=await pricedDraft(),value=source.value as unknown as Record<string,any>;
    value.financials.subtotalPriceMinor='10000000000000000000';value.financials.finalPriceMinor='10000000000000000000';value.financials.estimatedCostMinor='5800000000000000001';
    value.lines[0].lineTotalPriceMinor='10000000000000000000';value.lines[0].lineTotalCostMinor='5800000000000000001';value.lines[0].unitCostSnapshot=null;value.lines[0].unitPriceSnapshot=null;value.lines[0].csvClassification=null;value.assemblySelections=[];
    const lines=[{costGroupName:'Cabinetry & Millwork',costItemName:'Synthetic shelf',description:'Synthetic component',quantity:2,unit:'EA',unitCostSnapshot:null,unitPriceSnapshot:null,lineTotalCost:'58000000000000000.01',lineTotalPrice:'100000000000000000',assemblyId:value.lines[0].assemblyId,costCode:'12-100',taxable:null}];
    await first`update estimate_drafts set subtotal_price=100000000000000000,final_total_price=100000000000000000,subtotal_cost=58000000000000000.01,assembly_count=0,assembly_selections='[]'::jsonb,line_items=${first.json(lines)} where id=${source.id}`;
    await expect(first.begin(tx=>approve(tx,source.id,source.value,{snapshotExtra:{subtotal_price_minor:'10000000000000000000',final_price_minor:'10000000000000000000',estimated_cost_minor:'5800000000000000001',policy_evaluation:tx.json({...evaluation(),priceMinor:'10000000000000000000',costMinor:'5800000000000000001',profitMinor:'4199999999999999999'})}}))).rejects.toMatchObject({code:'23514'});
    expect((await first`select status from estimate_drafts where id=${source.id}`)[0].status).toBe('draft');
  });
  it('rejects an actor from another tenant even when the draft identity is valid', async () => {
    const source=await pricedDraft(),foreignTenant=randomUUID(),foreignActor=randomUUID();
    await first`insert into tenants(id,name,slug) values (${foreignTenant},'Synthetic foreign tenant',${'a1-'+foreignTenant})`;
    await first`insert into profiles(id,tenant_id,role) values (${foreignActor},${foreignTenant},'user')`;
    await expect(first.begin(tx=>approve(tx,source.id,source.value,{snapshotExtra:{captured_by:foreignActor}}))).rejects.toMatchObject({code:'23503'});
  });
  it('keeps request identity unique across two decisions in one tenant', async () => {
    const one=await pricedDraft(),two=await pricedDraft(),requestId=randomUUID();
    await first.begin(tx=>approve(tx,one.id,one.value,{requestId}));
    await expect(first.begin(tx=>approve(tx,two.id,two.value,{requestId}))).rejects.toMatchObject({code:'23505'});
    expect(await first`select id from estimate_internal_approvals where tenant_id=${tenantId} and request_id=${requestId}`).toHaveLength(1);
  });
  it('keeps an A1 version and its replay key after attempted deletion before approval', async () => {
    const parent=await draft(),child=await first.begin(tx=>successor(tx,parent));
    await expect(first`delete from estimate_drafts where id=${child}`).rejects.toMatchObject({code:'23514'});
    await expect(first`delete from estimate_drafts where id=${parent}`).rejects.toMatchObject({code:'23514'});
    expect((await first`select superseded_by from estimate_drafts where id=${parent}`)[0].superseded_by).toBe(child);
  });
  it('rejects an A1 version that never establishes its parent backpointer', async () => {
    const parent=await draft(),child=randomUUID();
    await expect(first.begin(async tx=>{
      await tx`insert into estimate_drafts(id,tenant_id,project_id,client_id,created_by,source,status,version,supersedes_id,a1_version_request_id,a1_version_request_hash) values (${child},${tenantId},${projectId},${clientId},${actorId},'version','draft',2,${parent},${randomUUID()},${requestHash})`;
    })).rejects.toMatchObject({code:'23514'});
    expect(await first`select id from estimate_drafts where id=${child}`).toHaveLength(0);
  });
  it('rejects changing replay identity while allowing unapproved version financial edits', async () => {
    const parent=await draft(),child=await first.begin(tx=>successor(tx,parent));
    await expect(first`update estimate_drafts set a1_version_request_id=${randomUUID()} where id=${child}`).rejects.toMatchObject({code:'23514'});
    await first`update estimate_drafts set final_total_price=150 where id=${child}`;
    expect((await first`select final_total_price from estimate_drafts where id=${child}`)[0].final_total_price).toBe('150');
  });
  it('refuses dangling, reversed and second A1 successor pointers', async () => {
    const parent=await draft(),child=await first.begin(tx=>successor(tx,parent));
    await expect(first`update estimate_drafts set superseded_by=${randomUUID()} where id=${parent}`).rejects.toMatchObject({code:'23514'});
    await expect(first`update estimate_drafts set superseded_by=null where id=${parent}`).rejects.toMatchObject({code:'23514'});
    await expect(first.begin(tx=>successor(tx,parent))).rejects.toThrow();
    expect((await first`select superseded_by from estimate_drafts where id=${parent}`)[0].superseded_by).toBe(child);
  });
  it('keeps a predecessor primary identity fixed while a permanent A1 successor references it', async () => {
    const parent=await draft(),child=await first.begin(tx=>successor(tx,parent));
    await expect(first`update estimate_drafts set id=${randomUUID()} where id=${parent}`).rejects.toMatchObject({code:'23514'});
    expect((await first`select supersedes_id from estimate_drafts where id=${child}`)[0].supersedes_id).toBe(parent);
    expect(await first`select id from estimate_drafts where id=${parent}`).toHaveLength(1);
  });
  it('serializes successor insertion before concurrent parent deletion and preserves both rows', async () => {
    const parent=await draft(),child=randomUUID(),inserted=latch(),deletionLaunched=latch();
    const holder=first.begin(async tx=>{
      await successor(tx,parent,child);inserted.release();await deletionLaunched.promise;
      await waitForSecondLock(tx);
    });
    await inserted.promise;
    const deletion=second`delete from estimate_drafts where id=${parent}`.then(()=>({ok:true,error:null}),error=>({ok:false,error}));
    deletionLaunched.release();await holder;
    expect(await deletion).toMatchObject({ok:false,error:{code:'23514'}});
    expect(await first`select id from estimate_drafts where id in (${parent},${child})`).toHaveLength(2);
  });
  it('refuses successor insertion after a concurrent parent deletion has committed', async () => {
    const parent=await draft(),child=randomUUID(),deleted=latch(),insertionLaunched=latch();
    const holder=first.begin(async tx=>{
      await tx`delete from estimate_drafts where id=${parent}`;deleted.release();await insertionLaunched.promise;
      await waitForSecondLock(tx);
    });
    await deleted.promise;
    const insertion=second.begin(tx=>successor(tx,parent,child)).then(()=>({ok:true,error:null}),error=>({ok:false,error}));
    insertionLaunched.release();await holder;
    expect(await insertion).toMatchObject({ok:false,error:{code:'23514'}});
    expect(await first`select id from estimate_drafts where id in (${parent},${child})`).toHaveLength(0);
  });
});
