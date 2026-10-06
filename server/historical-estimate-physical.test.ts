/**
 * H1 physical acceptance. Opt-in only: the runner must provision a disposable local
 * PostgreSQL database, apply the existing schema and migration 0005, then set the
 * dedicated H1_PHYSICAL_CONFIG. DATABASE_URL is deliberately never used.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import * as s from '../drizzle/schema';
import type { HistoricalSourceInput } from '../shared/historical-estimate-engine';
const mocks=vi.hoisted(()=>({getDb:vi.fn()}));
vi.mock('./db',()=>({getDb:mocks.getDb}));
import { recordHistoricalSource, importHistoricalEstimate, getHistoricalSource } from './historical-estimate-db';
const labConfig=process.env.H1_PHYSICAL_CONFIG;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const raw={version:'historical-raw-line-v1' as const,quantity:'2',unitPrice:'73.45',unitEstimatedCost:null,linePrice:'146.90',lineEstimatedCost:null,taxable:null,externalCode:null};
let first:ReturnType<typeof postgres>, second:ReturnType<typeof postgres>, db:PostgresJsDatabase, otherDb:PostgresJsDatabase;
let tenantId:string,userId:string,clientId:string,projectId:string;
const context=new AsyncLocalStorage<PostgresJsDatabase>();
const sourceInput=():HistoricalSourceInput=>({requestId:randomUUID(),projectId,clientId,sourceKind:'manual_transcription',sourceLabel:`Synthetic evidence ${randomUUID()}`,currencyCode:'USD',sourceFileId:null,declaredSubtotal:null,declaredDiscount:null,declaredTax:null,declaredTotal:'146.90',declaredEstimatedCost:null,commercialTermsText:null,rawTotals:{version:'historical-raw-totals-v1',subtotal:null,discount:null,tax:null,total:'146.90',estimatedCost:null},lines:[{sourceLineKey:'row-1',ordinal:0,description:'Synthetic test line',quantity:'2',unit:'ea',unitPrice:'73.45',unitEstimatedCost:null,linePrice:'146.90',lineEstimatedCost:null,externalCodeSystem:null,externalCode:null,taxable:null,rawValues:raw}]});
function importInput(sourceId:string,lineId:string) {return {requestId:randomUUID(),sourceId,projectId,clientId,selectedLineIds:[lineId],declaredSelectedTotal:'146.90',declaredSelectedEstimatedCost:null,rawSelectedTotals:{version:'historical-raw-selected-v1' as const,total:'146.90',estimatedCost:null},reportedApprovalAt:null,reportedApprovalNote:null,priorImportId:null,expectedRevision:null};}
async function captured(){return recordHistoricalSource(sourceInput(),userId,tenantId);}
async function imported(){const source=await captured();const result=await importHistoricalEstimate(importInput(source.sourceId,source.lineIds[0].id),userId,tenantId);return {source,result};}

describe.skipIf(!labConfig)('H1 PostgreSQL physical constraints and atomicity',()=>{
  beforeAll(async()=>{
    const config=JSON.parse(await readFile(labConfig!,'utf8')) as {directory:string;dataDirectory:string;socketDirectory:string;database:string;user:string;port:number};
    const directory=await realpath(config.directory);
    if(!directory.startsWith('/private/tmp/structr-h1-')||directory!==resolve(config.directory)||config.database!=='h1_test'||config.user!=='h1_lab'||!Number.isInteger(config.port))throw new Error('Not an owned H1 laboratory configuration');
    const dataDirectory=await realpath(config.dataDirectory),socketDirectory=await realpath(config.socketDirectory);
    if(!dataDirectory.startsWith(directory+sep)||!socketDirectory.startsWith(directory+sep)||socketDirectory!==resolve(config.socketDirectory)||dataDirectory!==resolve(config.dataDirectory))throw new Error('H1 paths escape the owned disposable directory');
    const options={host:socketDirectory,database:config.database,username:config.user,port:config.port,ssl:false as const,max:1,prepare:false};
    first=postgres(options);second=postgres(options);
    // Verify the actual server identity and transport before any fixture write or DDL.
    for(const connection of [first,second]) {
      const [identity]=await connection`select current_database() as database, current_user as username, current_setting('data_directory') as data_directory, current_setting('unix_socket_directories') as socket_directories, current_setting('listen_addresses') as listen_addresses, current_setting('port') as port, inet_server_addr() as server_address`;
      if(identity.database!==config.database||identity.username!==config.user||await realpath(identity.data_directory)!==dataDirectory||identity.socket_directories!==socketDirectory||identity.listen_addresses!==''||Number(identity.port)!==config.port||identity.server_address!==null)throw new Error('H1 server identity does not match the owned socket-only laboratory');
    }
    db=drizzle(first);otherDb=drizzle(second);
    mocks.getDb.mockImplementation(async()=>context.getStore()??db);
  });
  afterAll(async()=>{await Promise.all([first?.end(),second?.end()]);});
  beforeEach(async()=>{
    tenantId=randomUUID();userId=randomUUID();clientId=randomUUID();projectId=randomUUID();
    await db.insert(s.tenants).values({id:tenantId,name:'Synthetic H1 laboratory',slug:`h1-${tenantId}`});
    await db.insert(s.profiles).values({id:userId,tenantId,isActive:true,role:'user'});
    await db.insert(s.clients).values({id:clientId,tenantId,name:'Synthetic fixture client'});
    await db.insert(s.projects).values({id:projectId,tenantId,clientId,ownerUserId:userId,name:'Synthetic H1 project',projectType:'repair'});
  });
  it('commits complete source and selection with exact prices and no operational changes',async()=>{
    const {source,result}=await imported();const saved=await getHistoricalSource(source.sourceId,userId,tenantId);
    expect(saved.lines[0]).toMatchObject({linePriceMinor:'14690',unitEstimatedCost:null,taxable:null});
    const [draft]=await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.id,result.draftId));
    expect(draft).toMatchObject({status:'draft',source:'historical_import',finalTotalPrice:'146.90',approvedAt:null,approvedBy:null,lineItems:null,subtotalCost:null});
    const [project]=await db.select().from(s.projects).where(eq(s.projects.id,projectId));
    expect(project).toMatchObject({fieldStartedAt:null,approvedBudgetCents:null,changeOrderBudgetCents:0});
  });
  it('rejects a parent source with no completed lines at commit',async()=>{
    await expect(db.transaction(async tx=>{
      await tx.insert(s.historicalEstimateSources).values({tenantId,projectId,clientId,requestId:randomUUID(),recordedBy:userId,requestHash:hash('request'),contentHash:hash('missing-line'),contractVersion:'historical-source-v1',sourceKind:'manual_transcription',sourceLabel:'Synthetic incomplete',currencyCode:'USD',rawTotals:sourceInput().rawTotals,expectedLineCount:1});
    })).rejects.toThrow();
    const rows=await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.projectId,projectId));expect(rows).toEqual([]);
  });
  it('rolls back a source that declares two lines but inserts only one',async()=>{
    const source=await captured();const [saved]=await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.id,source.sourceId));
    const [line]=await db.select().from(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId));const incompleteId=randomUUID();
    await expect(db.transaction(async tx=>{
      await tx.insert(s.historicalEstimateSources).values({...saved,id:incompleteId,requestId:randomUUID(),contentHash:hash(randomUUID()),expectedLineCount:2});
      await tx.insert(s.historicalEstimateSourceLines).values({...line,id:randomUUID(),sourceId:incompleteId});
    })).rejects.toThrow();
    expect(await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.id,incompleteId))).toEqual([]);
  });
  it('rejects late source-line insertion and preserves its immutable complete set',async()=>{
    const source=await captured();const [line]=await db.select().from(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId));
    await expect(db.insert(s.historicalEstimateSourceLines).values({...line,id:randomUUID(),sourceLineKey:'late',ordinal:1})).rejects.toThrow();
    const lines=await db.select().from(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId));expect(lines).toHaveLength(1);
  });
  it('rejects source and source-line UPDATE and DELETE, including soft delete',async()=>{
    const source=await captured();
    await expect(db.update(s.historicalEstimateSources).set({deletedAt:new Date()}).where(eq(s.historicalEstimateSources.id,source.sourceId))).rejects.toThrow();
    await expect(db.delete(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.id,source.sourceId))).rejects.toThrow();
    await expect(db.update(s.historicalEstimateSourceLines).set({linePriceMinor:'1'}).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId))).rejects.toThrow();
    await expect(db.delete(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId))).rejects.toThrow();
  });
  it('rolls back incomplete import and its draft when its line set is absent',async()=>{
    const {result}=await imported();const [saved]=await db.select().from(s.historicalEstimateImports).where(eq(s.historicalEstimateImports.id,result.importId));const newDraft=randomUUID();
    await expect(db.transaction(async tx=>{
      await tx.insert(s.estimateDrafts).values({id:newDraft,tenantId,projectId,clientId,source:'historical_import',status:'draft',createdBy:userId});
      await tx.insert(s.historicalEstimateImports).values({...saved,id:randomUUID(),estimateDraftId:newDraft,requestId:randomUUID(),selectionHash:hash(randomUUID())});
    })).rejects.toThrow();
    expect(await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.id,newDraft))).toEqual([]);
  });
  it('rolls back a selection that declares two lines but inserts only one',async()=>{
    const {source,result}=await imported();const [saved]=await db.select().from(s.historicalEstimateImports).where(eq(s.historicalEstimateImports.id,result.importId));const importId=randomUUID(),draftId=randomUUID();
    await expect(db.transaction(async tx=>{
      await tx.insert(s.estimateDrafts).values({id:draftId,tenantId,projectId,clientId,source:'historical_import',status:'draft'});
      await tx.insert(s.historicalEstimateImports).values({...saved,id:importId,estimateDraftId:draftId,requestId:randomUUID(),selectionHash:hash(randomUUID()),expectedLineCount:2});
      await tx.insert(s.historicalEstimateImportLines).values({tenantId,importId,sourceId:source.sourceId,sourceLineId:source.lineIds[0].id,position:0});
    })).rejects.toThrow();
    expect(await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.id,draftId))).toEqual([]);
  });
  it('rejects late import lines and import UPDATE/DELETE without altering selection',async()=>{
    const input=sourceInput();input.lines.push({...input.lines[0],sourceLineKey:'row-2',ordinal:1});
    const source=await recordHistoricalSource(input,userId,tenantId);const imported=await importHistoricalEstimate(importInput(source.sourceId,source.lineIds[0].id),userId,tenantId);
    await expect(db.insert(s.historicalEstimateImportLines).values({tenantId,importId:imported.importId,sourceId:source.sourceId,sourceLineId:source.lineIds[1].id,position:1})).rejects.toThrow();
    await expect(db.update(s.historicalEstimateImports).set({declaredSelectedTotalMinor:'1'}).where(eq(s.historicalEstimateImports.id,imported.importId))).rejects.toThrow();
    await expect(db.delete(s.historicalEstimateImports).where(eq(s.historicalEstimateImports.id,imported.importId))).rejects.toThrow();
    await expect(db.update(s.historicalEstimateImportLines).set({position:8}).where(eq(s.historicalEstimateImportLines.importId,imported.importId))).rejects.toThrow();
    await expect(db.delete(s.historicalEstimateImportLines).where(eq(s.historicalEstimateImportLines.importId,imported.importId))).rejects.toThrow();
  });
  it('physically refuses a cross-context source link even for a direct SQL writer',async()=>{
    const wrongClient=randomUUID();await db.insert(s.clients).values({id:wrongClient,tenantId,name:'Another synthetic client'});
    await expect(db.transaction(async tx=>{
      await tx.insert(s.historicalEstimateSources).values({tenantId,projectId,clientId:wrongClient,requestId:randomUUID(),recordedBy:userId,requestHash:hash('request'),contentHash:hash('foreign-client'),contractVersion:'historical-source-v1',sourceKind:'manual_transcription',sourceLabel:'Synthetic invalid',currencyCode:'USD',rawTotals:sourceInput().rawTotals,expectedLineCount:1});
    })).rejects.toThrow();
  });
  it('rejects both concurrent attempts to append to an already committed source',async()=>{
    const source=await captured();const [line]=await db.select().from(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId));
    const attempts=await Promise.allSettled([db.insert(s.historicalEstimateSourceLines).values({...line,id:randomUUID(),sourceLineKey:'late-a',ordinal:1}),otherDb.insert(s.historicalEstimateSourceLines).values({...line,id:randomUUID(),sourceLineKey:'late-b',ordinal:2})]);
    expect(attempts.every(attempt=>attempt.status==='rejected')).toBe(true);
    expect(await db.select().from(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId))).toHaveLength(1);
  });
  it('rejects normalized money in a source line when its parent currency is unknown',async()=>{
    const source=await captured();const [saved]=await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.id,source.sourceId));
    const [line]=await db.select().from(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId));const newId=randomUUID();
    await expect(db.transaction(async tx=>{
      await tx.insert(s.historicalEstimateSources).values({...saved,id:newId,requestId:randomUUID(),contentHash:hash(randomUUID()),currencyCode:null,declaredSubtotalMinor:null,declaredDiscountMinor:null,declaredTaxMinor:null,declaredTotalMinor:null,declaredEstimatedCostMinor:null});
      await tx.insert(s.historicalEstimateSourceLines).values({...line,id:randomUUID(),sourceId:newId});
    })).rejects.toThrow();
    expect(await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.id,newId))).toEqual([]);
  });
  it('rejects normalized selection money when its source currency is unknown',async()=>{
    const source=await recordHistoricalSource({...sourceInput(),currencyCode:null},userId,tenantId);const importId=randomUUID(),draftId=randomUUID();
    await expect(db.transaction(async tx=>{
      await tx.insert(s.estimateDrafts).values({id:draftId,tenantId,projectId,clientId,source:'historical_import',status:'draft'});
      await tx.insert(s.historicalEstimateImports).values({id:importId,tenantId,projectId,clientId,sourceId:source.sourceId,estimateDraftId:draftId,requestId:randomUUID(),recordedBy:userId,requestHash:hash(randomUUID()),selectionHash:hash(randomUUID()),contractVersion:'historical-selection-v1',revision:1,declaredSelectedTotalMinor:'14690',declaredSelectedEstimatedCostMinor:null,reconciliationState:'unresolved',reconciliationFindings:{version:'historical-reconciliation-v1',state:'unresolved',sumPriceMinor:null,sumCostMinor:null,findings:[{code:'unknown_currency',field:'currency'}]},rawSelectedTotals:{version:'historical-raw-selected-v1',total:'146.90',estimatedCost:null},expectedLineCount:1});
      await tx.insert(s.historicalEstimateImportLines).values({tenantId,importId,sourceId:source.sourceId,sourceLineId:source.lineIds[0].id,position:0});
    })).rejects.toThrow();
    expect(await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.id,draftId))).toEqual([]);
  });
  it.each(['source','line'] as const)('rejects JSON null as the raw version in %s evidence',async kind=>{
    const source=await captured();const [saved]=await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.id,source.sourceId));
    const [line]=await db.select().from(s.historicalEstimateSourceLines).where(eq(s.historicalEstimateSourceLines.sourceId,source.sourceId));const newId=randomUUID();
    await expect(db.transaction(async tx=>{
      await tx.insert(s.historicalEstimateSources).values({...saved,id:newId,requestId:randomUUID(),contentHash:hash(randomUUID()),rawTotals:kind==='source'?{...(saved.rawTotals as object),version:null}:saved.rawTotals});
      await tx.insert(s.historicalEstimateSourceLines).values({...line,id:randomUUID(),sourceId:newId,rawValues:kind==='line'?{...(line.rawValues as object),version:null}:line.rawValues});
    })).rejects.toMatchObject({cause:{code:'23514',constraint_name:kind==='source'?'hes_raw':'hesl_raw'}});
  });
  it.each(['rawSelectedTotals','reconciliationFindings'] as const)('rejects JSON null as the version of %s',async field=>{
    const {source,result}=await imported();const [saved]=await db.select().from(s.historicalEstimateImports).where(eq(s.historicalEstimateImports.id,result.importId));const importId=randomUUID(),draftId=randomUUID();
    await expect(db.transaction(async tx=>{
      await tx.insert(s.estimateDrafts).values({id:draftId,tenantId,projectId,clientId,source:'historical_import',status:'draft'});
      await tx.insert(s.historicalEstimateImports).values({...saved,id:importId,estimateDraftId:draftId,requestId:randomUUID(),selectionHash:hash(randomUUID()),[field]:{...(saved[field] as object),version:null}});
      await tx.insert(s.historicalEstimateImportLines).values({tenantId,importId,sourceId:source.sourceId,sourceLineId:source.lineIds[0].id,position:0});
    })).rejects.toMatchObject({cause:{code:'23514',constraint_name:field==='rawSelectedTotals'?'hei_raw':'hei_findings'}});
  });
  it.each(['top-level','finding'] as const)('rejects unexpected reconciliation properties at %s',async location=>{
    const {source,result}=await imported();const [saved]=await db.select().from(s.historicalEstimateImports).where(eq(s.historicalEstimateImports.id,result.importId));const importId=randomUUID(),draftId=randomUUID();
    const original=saved.reconciliationFindings as Record<string,unknown>;
    const reconciliationFindings=location==='top-level'?{...original,unexpected:true}:{...original,findings:[{code:'unknown_currency',field:'currency',unexpected:true}]};
    await expect(db.transaction(async tx=>{
      await tx.insert(s.estimateDrafts).values({id:draftId,tenantId,projectId,clientId,source:'historical_import',status:'draft'});
      await tx.insert(s.historicalEstimateImports).values({...saved,id:importId,estimateDraftId:draftId,requestId:randomUUID(),selectionHash:hash(randomUUID()),reconciliationFindings});
      await tx.insert(s.historicalEstimateImportLines).values({tenantId,importId,sourceId:source.sourceId,sourceLineId:source.lineIds[0].id,position:0});
    })).rejects.toMatchObject({cause:{code:'23514',constraint_name:'hei_findings'}});
  });
  it('serializes identical requests across two actual connections and returns one source',async()=>{
    const input=sourceInput();const results=await Promise.all([context.run(db,()=>recordHistoricalSource(input,userId,tenantId)),context.run(otherDb,()=>recordHistoricalSource(input,userId,tenantId))]);
    expect(results[0].sourceId).toBe(results[1].sourceId);expect(results.map(r=>r.replayed).sort()).toEqual([false,true]);
    expect(await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.projectId,projectId))).toHaveLength(1);
  });
  it('serializes simultaneous imports and preserves one draft and one selection',async()=>{
    const source=await captured();const input=importInput(source.sourceId,source.lineIds[0].id);
    const results=await Promise.all([context.run(db,()=>importHistoricalEstimate(input,userId,tenantId)),context.run(otherDb,()=>importHistoricalEstimate(input,userId,tenantId))]);
    expect(results[0].draftId).toBe(results[1].draftId);expect(results[0].importId).toBe(results[1].importId);
    expect(await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.projectId,projectId))).toHaveLength(1);
  });
  it('allows only one linear successor when two connections revise the same predecessor',async()=>{
    const {source,result}=await imported();const base=importInput(source.sourceId,source.lineIds[0].id);
    const results=await Promise.allSettled([context.run(db,()=>importHistoricalEstimate({...base,priorImportId:result.importId,expectedRevision:1,reportedApprovalNote:'Synthetic revision A'},userId,tenantId)),context.run(otherDb,()=>importHistoricalEstimate({...base,requestId:randomUUID(),priorImportId:result.importId,expectedRevision:1,reportedApprovalNote:'Synthetic revision B'},userId,tenantId))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(rejected.reason).toMatchObject({code:'HISTORICAL_REVISION_CONFLICT'});
    expect(await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.projectId,projectId))).toHaveLength(2);
    const [prior]=await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.id,result.draftId));expect(prior.supersededBy).toBeNull();
  });
  it('rolls back the draft and selection when durable audit fails physically',async()=>{
    const source=await captured();
    await first`create function h1_lab_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$`;
    await first`create trigger h1_lab_audit_failure before insert on audit_logs for each row execute function h1_lab_reject_audit()`;
    try {
      await expect(importHistoricalEstimate(importInput(source.sourceId,source.lineIds[0].id),userId,tenantId)).rejects.toThrow();
      expect(await db.select().from(s.estimateDrafts).where(eq(s.estimateDrafts.projectId,projectId))).toEqual([]);
      expect(await db.select().from(s.historicalEstimateImports).where(eq(s.historicalEstimateImports.sourceId,source.sourceId))).toEqual([]);
    } finally {await first`drop trigger h1_lab_audit_failure on audit_logs`;await first`drop function h1_lab_reject_audit()`;}
  });
  it('rolls back persisted source when transactional audit insert fails physically',async()=>{
    await first`create function h1_lab_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$`;
    await first`create trigger h1_lab_audit_failure before insert on audit_logs for each row execute function h1_lab_reject_audit()`;
    try {await expect(captured()).rejects.toThrow();expect(await db.select().from(s.historicalEstimateSources).where(eq(s.historicalEstimateSources.projectId,projectId))).toEqual([]);}
    finally {await first`drop trigger h1_lab_audit_failure on audit_logs`;await first`drop function h1_lab_reject_audit()`;}
  });
});
