/** Real route, ledger helper and variance engine with a deterministic query driver. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const io = vi.hoisted(() => ({ getDb: vi.fn(), budget: vi.fn(), changes: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./field-operations-db", () => ({ getProjectBudgetEstimate: io.budget, listApprovedChangeOrders: io.changes }));
vi.mock("./rbac", () => ({ hasPermission: io.permission }));
import { actualsRouter } from "./actuals-router";
import { recordActual } from "./actuals-db";

const TENANT="a9700000-0000-4000-8000-000000000001", OTHER="a9700000-0000-4000-8000-000000000002";
const USER="b9700000-0000-4000-8000-000000000001", PROJECT="c9700000-0000-4000-8000-000000000001", FOREIGN_PROJECT="c9700000-0000-4000-8000-000000000002";
const BASE="d9700000-0000-4000-8000-000000000001", CO="d9700000-0000-4000-8000-000000000002";
const CODE="e9700000-0000-4000-8000-000000000001", ASSEMBLY="e9700000-0000-4000-8000-000000000002", SUB="e9700000-0000-4000-8000-000000000003", TASK="e9700000-0000-4000-8000-000000000004", ITEM="e9700000-0000-4000-8000-000000000005";
type Row=Record<string,any>;
let state:Record<string,Row[]>; let writes:string[]; let baseline:Row | null; let failAt:string|undefined;
const input={projectId:PROJECT,costCode:"SYN-L01",amountCents:12500,vendorName:"Synthetic crew",dateIncurred:"2026-09-18"};
function matches(row:Row,predicate?:SQL) {
  if (!predicate) return true;
  const query=new PgDialect().sqlToQuery(predicate);
  const comparisons=Array.from(query.sql.matchAll(/"[a-z_]+"\."([a-z_]+)" = \$(\d+)/g));
  const nulls=Array.from(query.sql.matchAll(/"[a-z_]+"\."([a-z_]+)" is null/g));
  return comparisons.every(([,column,index])=>row[column.replace(/_([a-z])/g,(_:string,c:string)=>c.toUpperCase())]===query.params[Number(index)-1]) && nulls.every(([,column])=>row[column.replace(/_([a-z])/g,(_:string,c:string)=>c.toUpperCase())]==null);
}
function database() {
  return {
    select: (columns?:Record<string,any>)=>({from:(table:Table)=>{
      const name=getTableName(table);let predicate:SQL|undefined;let limit=Infinity;let offset=0;
      const query={where:(p:SQL)=>{predicate=p;return query;},orderBy:()=>query,for:()=>query,limit:(n:number)=>{limit=n;return query;},offset:(n:number)=>{offset=n;return query;},
        then:(resolve:(rows:Row[])=>unknown,reject?:(error:unknown)=>unknown)=>{
          const rows=(state[name]??[]).filter(row=>matches(row,predicate)).slice(offset,offset+limit).map(row=>columns?Object.fromEntries(Object.entries(columns).map(([key,column])=>[key,row[column.name?.replace(/_([a-z])/g,(_:string,c:string)=>c.toUpperCase()) ?? key]])):row);
          return Promise.resolve(structuredClone(rows)).then(resolve,reject);
        }};return query;
    }}),
    insert:(table:Table)=>({values:(value:Row)=>{
      const execute=async()=>{const name=getTableName(table);const operation=`insert:${name}`;writes.push(operation);const row={id:`generated-${writes.length}`,...structuredClone(value)};(state[name]??=[]).push(row);if(failAt===operation || (name==="audit_logs" && failAt===`audit:${value.action}`))throw new Error(`Injected ${failAt}`);return [row];};
      return {returning:execute,then:(resolve:(rows:Row[])=>unknown,reject?:(error:unknown)=>unknown)=>execute().then(resolve,reject)};
    }}),
    update:(table:Table)=>({set:(patch:Row)=>({where:async(predicate:SQL)=>{const name=getTableName(table);const operation=`update:${name}`;writes.push(operation);for(const row of state[name]??[])if(matches(row,predicate))Object.assign(row,patch);if(failAt===operation)throw new Error(`Injected ${operation}`);}})}),
    transaction:async<T>(callback:(tx:any)=>Promise<T>)=>{const before=structuredClone(state);try{const result=await callback(database());if(failAt==="commit")throw new Error("Injected commit");return result;}catch(error){state=before;throw error;}},
  };
}
const caller=(tenantId:string|null=TENANT)=>actualsRouter.createCaller({tenantId,user:{id:USER,role:"admin"}} as any);
const direct=(extra:Row={})=>recordActual({...input,userId:USER,tenantId:TENANT,...extra});
function noWrites(){expect(writes).toEqual([]);expect(state.project_cost_actuals).toEqual([]);}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("TENANT_STRICT","true");writes=[];failAt=undefined;
  baseline={id:BASE,tenantId:TENANT,projectId:PROJECT,status:"approved",approvedAt:new Date("2026-09-18T12:00:00Z"),supersededBy:null,changeOrderOf:null,lineItems:[{costCode:"SYN-L01",costItemName:"Synthetic labor",quantity:2,unitCostSnapshot:"50.00"}]};
  state={projects:[{id:PROJECT,tenantId:TENANT,ownerUserId:USER,deletedAt:null,varianceThresholdPct:"10"}],profiles:[{id:USER,tenantId:TENANT,role:"admin",isActive:true}],estimate_drafts:[baseline,{...baseline,id:CO,changeOrderOf:BASE,lineItems:[{costCode:"SYN-L01",quantity:1,unitCostSnapshot:"40.00"}]}],cost_codes:[{id:CODE,tenantId:TENANT,code:"SYN-L01",name:"Synthetic labor",isActive:true}],assemblies:[{id:ASSEMBLY,tenantId:TENANT,isActive:true}],subcontractors:[{id:SUB,tenantId:TENANT,deletedAt:null}],field_tasks:[{id:TASK,tenantId:TENANT,projectId:PROJECT,deletedAt:null,changeOrderId:null}],estimate_items:[{id:ITEM,tenantId:TENANT,projectId:PROJECT,costCodeId:CODE,assemblyId:ASSEMBLY}],project_cost_actuals:[],audit_logs:[]};
  io.getDb.mockResolvedValue(database());io.budget.mockImplementation(async()=>baseline);io.changes.mockResolvedValue([]);io.permission.mockResolvedValue(false);
});
afterEach(()=>vi.unstubAllEnvs());

describe("actual cost authority",()=>{
  it("records the exact UUID and cents against the server's approved budget",async()=>{
    const actual=await caller().record(input);
    expect(actual).toMatchObject({projectId:PROJECT,tenantId:TENANT,amountCents:12500,estimatedAmountCents:10000,varianceCents:2500,budgetEstimateDraftId:BASE,status:"pending"});
  });
  it("ignores a supplied estimated amount at the route and helper boundaries",async()=>{
    const actual=await caller().record({...input,estimatedAmountCents:1});
    expect(actual).toMatchObject({estimatedAmountCents:10000,varianceCents:2500});
    const second=await direct({estimatedAmountCents:999999});expect(second.estimatedAmountCents).toBe(10000);
  });
  it("retains unbudgeted textual costs without inventing a budget",async()=>{
    const result=await direct({costCode:"SYN-UNBUDGETED",estimatedAmountCents:1});
    expect(result).toMatchObject({estimatedAmountCents:null,varianceSeverity:"unbudgeted"});
  });
  it.each(["foreign","missing","deleted"])("refuses a %s parent project before a write",async kind=>{
    if(kind==="foreign")state.projects[0].tenantId=OTHER;
    if(kind==="missing")state.projects=[];
    if(kind==="deleted")state.projects[0].deletedAt=new Date();
    await expect(direct()).rejects.toMatchObject({code:"PROJECT_NOT_FOUND"});noWrites();
  });
  it("rejects an unresolved caller before a write",async()=>{await expect(caller(null).record(input)).rejects.toMatchObject({code:"FORBIDDEN"});noWrites();});
  it.each(["foreign","other-project","unapproved","superseded","missing-evidence"])("refuses a %s baseline returned by storage",async kind=>{
    if(kind==="foreign")baseline!.tenantId=OTHER;
    if(kind==="other-project")baseline!.projectId=FOREIGN_PROJECT;
    if(kind==="unapproved")baseline!.status="draft";
    if(kind==="superseded")baseline!.supersededBy=CO;
    if(kind==="missing-evidence")baseline!.approvedAt=null;
    await expect(direct()).rejects.toMatchObject({code:"NO_APPROVED_ESTIMATE"});noWrites();
  });
  it("refuses absence of an approved budget",async()=>{baseline=null;state.estimate_drafts=[];await expect(direct()).rejects.toMatchObject({code:"NO_APPROVED_ESTIMATE"});noWrites();});
  it.each(["foreign","missing","inactive"])("refuses a %s catalog cost-code ID",async kind=>{
    if(kind==="foreign")state.cost_codes[0].tenantId=OTHER;
    if(kind==="missing")state.cost_codes=[];
    if(kind==="inactive")state.cost_codes[0].isActive=false;
    await expect(direct({costCodeId:CODE})).rejects.toMatchObject({code:"REFERENCE_NOT_AVAILABLE"});noWrites();
  });
  it("uses canonical cost-code text and name instead of client labels",async()=>{
    const result=await direct({costCodeId:CODE,costCodeName:"Untrusted name"});expect(result).toMatchObject({costCodeId:CODE,costCode:"SYN-L01",costCodeName:"Synthetic labor"});
  });
  it("refuses a code ID/text mismatch",async()=>{await expect(direct({costCodeId:CODE,costCode:"OTHER"})).rejects.toMatchObject({code:"REFERENCE_NOT_AVAILABLE"});noWrites();});
  it.each([true,false])("preserves legacy null-tenant catalog policy strict=%s",async strict=>{
    vi.stubEnv("TENANT_STRICT",String(strict));state.cost_codes[0].tenantId=null;
    if(strict){await expect(direct({costCodeId:CODE})).rejects.toMatchObject({code:"REFERENCE_NOT_AVAILABLE"});noWrites();}
    else{await direct({costCodeId:CODE});expect(state.cost_codes[0].tenantId).toBeNull();}
  });
  it.each(["foreign","other-project","unapproved","superseded","missing-evidence","invalid-parent"])("refuses a %s change order",async kind=>{
    const co=state.estimate_drafts[1];if(kind==="foreign")co.tenantId=OTHER;if(kind==="other-project")co.projectId=FOREIGN_PROJECT;if(kind==="unapproved")co.status="draft";if(kind==="superseded")co.supersededBy=BASE;if(kind==="missing-evidence")co.approvedAt=null;if(kind==="invalid-parent")co.changeOrderOf=OTHER;
    await expect(direct({changeOrderId:CO})).rejects.toMatchObject({code:"CHANGE_ORDER_NOT_APPROVED"});noWrites();
  });
  it("uses the authorized change-order snapshot budget separately from the baseline",async()=>{
    const result=await direct({changeOrderId:CO});expect(result).toMatchObject({changeOrderId:CO,budgetEstimateDraftId:BASE,estimatedAmountCents:4000,varianceCents:8500});
  });
  it.each([["assemblyId","assemblies",ASSEMBLY],["subcontractorId","subcontractors",SUB],["fieldTaskId","field_tasks",TASK],["estimateItemId","estimate_items",ITEM]])("refuses foreign %s references",async(field,table,id)=>{
    state[table][0].tenantId=OTHER;await expect(direct({[field]:id})).rejects.toMatchObject({code:"REFERENCE_NOT_AVAILABLE"});noWrites();
  });
  it.each([["fieldTaskId","field_tasks",TASK],["estimateItemId","estimate_items",ITEM]])("refuses another project's %s even within this tenant",async(field,table,id)=>{
    state[table][0].projectId=FOREIGN_PROJECT;await expect(direct({[field]:id})).rejects.toMatchObject({code:"REFERENCE_NOT_AVAILABLE"});noWrites();
  });
  it("refuses a field task assigned to another change-order scope",async()=>{
    state.field_tasks[0].changeOrderId=CO;await expect(direct({fieldTaskId:TASK})).rejects.toMatchObject({code:"REFERENCE_NOT_AVAILABLE"});noWrites();
  });
  it("allows same-tenant references with matching project parents",async()=>{
    const result=await direct({costCodeId:CODE,assemblyId:ASSEMBLY,subcontractorId:SUB,fieldTaskId:TASK,estimateItemId:ITEM});
    expect(result).toMatchObject({costCodeId:CODE,assemblyId:ASSEMBLY,subcontractorId:SUB,fieldTaskId:TASK,estimateItemId:ITEM});
  });
  it("audits project totals before and after the refresh in the same transaction",async()=>{
    Object.assign(state.projects[0],{committedCostCents:1200,actualTotal:"12.00",variancePct:"-12"});
    await direct();
    const audit=state.audit_logs.find(row=>row.action==="project.actuals_refreshed");
    if (!audit) throw new Error("Expected a durable project-total audit");
    expect(audit).toMatchObject({tableName:"projects",recordId:PROJECT,userId:USER,oldValues:{committedCostCents:1200,actualTotal:"12.00",variancePct:"-12"},newValues:{committedCostCents:state.projects[0].committedCostCents,actualTotal:state.projects[0].actualTotal,variancePct:state.projects[0].variancePct}});
    expect(audit.oldValues).not.toEqual(audit.newValues);
  });
  it.each(["insert:project_cost_actuals","insert:audit_logs","update:projects","audit:project.actuals_refreshed","commit"])("rolls back cost, audit and project totals when %s fails",async failure=>{
    const before=structuredClone(state);failAt=failure;
    await expect(direct()).rejects.toThrow(`Injected ${failure}`);
    expect(state).toEqual(before);
  });
});
