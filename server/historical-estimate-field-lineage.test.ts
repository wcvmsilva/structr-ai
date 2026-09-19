import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName, type SQL, type Table } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const mocks=vi.hoisted(()=>({getDb:vi.fn()}));
vi.mock('./db',()=>({getDb:mocks.getDb}));
import { listApprovedChangeOrders, materializeChangeOrderTasks } from './field-operations-db';
const id=(n:number)=>`aa990000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PROJECT=id(1),TENANT=id(2),USER=id(3),BASE=id(4),HISTORY=id(5),CO=id(6),VERSION=id(7);
type Row=Record<string,any>;
let state:Record<string,Row[]>,writes:string[],reads:number;
const camel=(key:string)=>key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase());
function matches(table:string,row:Row,condition?:SQL){
  if(!condition)return true;
  const compiled=new PgDialect().sqlToQuery(condition);
  if(/not exists/i.test(compiled.sql)&&compiled.sql.includes('historical_estimate_imports')&&state.historical_estimate_imports.some(item=>item.estimateDraftId===row.id))return false;
  for(const [,name,column,position] of compiled.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)"\s*=\s*\$(\d+)/g))if(name===table&&row[camel(column)]!==compiled.params[Number(position)-1])return false;
  for(const [,name,column] of compiled.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" is null/gi))if(name===table&&row[camel(column)]!=null)return false;
  for(const [,name,column,position] of compiled.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" is distinct from \$(\d+)/gi))if(name===table&&row[camel(column)]===compiled.params[Number(position)-1])return false;
  return true;
}
function draft(patch:Row={}){return {id:BASE,tenantId:TENANT,projectId:PROJECT,clientId:USER,source:'assembly_calculator',status:'approved',approvedAt:new Date(),supersededBy:null,supersedesId:null,changeOrderOf:null,version:1,finalTotalPrice:'190.00',lineItems:[],...patch};}
function db(){return {
  select:(columns?:Record<string,any>)=>({from:(table:Table)=>{let condition:SQL|undefined,limit=Infinity;const name=getTableName(table);const q:any={where:(value:SQL)=>{condition=value;return q},orderBy:()=>q,limit:(value:number)=>{limit=value;return q},then:(resolve:any,reject:any)=>{reads++;const rows=(state[name]??[]).filter(row=>matches(name,row,condition)).slice(0,limit);return Promise.resolve(columns?rows.map(row=>Object.fromEntries(Object.entries(columns).map(([key,column])=>[key,row[camel(column.name??key)]]))):structuredClone(rows)).then(resolve,reject)}};return q;}}),
  update:(table:Table)=>({set:()=>({where:async()=>{writes.push(`update:${getTableName(table)}`)}})}),
  insert:(table:Table)=>({values:()=>({returning:async()=>{writes.push(`insert:${getTableName(table)}`);return[{id:id(90)}]}})}),
};}
function setup(kind:'source'|'link',throughVersion=false){state.estimate_drafts.push(draft({id:HISTORY,source:kind==='source'?'historical_import':'assembly_calculator'}));if(kind==='link')state.historical_estimate_imports.push({id:id(80),estimateDraftId:HISTORY});if(throughVersion)state.estimate_drafts.push(draft({id:VERSION,source:'version',supersedesId:HISTORY,version:2}));state.estimate_drafts.push(draft({id:CO,source:'change_order',changeOrderOf:throughVersion?VERSION:HISTORY,version:3,finalTotalPrice:'71.50'}));}
beforeEach(()=>{vi.clearAllMocks();writes=[];reads=0;state={estimate_drafts:[draft()],historical_estimate_imports:[],field_tasks:[],projects:[{id:PROJECT,tenantId:TENANT}],audit_logs:[]};mocks.getDb.mockResolvedValue(db());});
describe.each(['source','link'] as const)('historical field ancestry detected by %s',kind=>{
  it('excludes a calculated change order whose parent is historical from available money',async()=>{setup(kind);expect(await listApprovedChangeOrders(PROJECT)).toEqual([]);expect(writes).toEqual([]);});
  it('blocks direct materialization and replay before any field event or budget write',async()=>{setup(kind);for(let retry=0;retry<2;retry++)await expect(materializeChangeOrderTasks({changeOrderId:CO,userId:USER})).rejects.toMatchObject({code:'HISTORICAL_AUTHORITY_NOT_AVAILABLE'});expect(writes).toEqual([]);});
  it('detects a historical ancestor behind a persisted calculated revision',async()=>{setup(kind,true);expect(await listApprovedChangeOrders(PROJECT)).toEqual([]);await expect(materializeChangeOrderTasks({changeOrderId:CO,userId:USER})).rejects.toMatchObject({code:'HISTORICAL_AUTHORITY_NOT_AVAILABLE'});expect(writes).toEqual([]);});
});
it('keeps unrelated calculated change-order money while excluding historical ancestry',async()=>{setup('link');state.estimate_drafts.push(draft({id:id(22),changeOrderOf:BASE,finalTotalPrice:'33.75'}));const result=await listApprovedChangeOrders(PROJECT);expect(result.map(row=>row.id)).toEqual([id(22)]);expect(result[0].finalTotalPrice).toBe('33.75');});
it('preserves calculated revision chains and nullable legacy source',async()=>{state.estimate_drafts[0].source=null;state.estimate_drafts.push(draft({id:VERSION,source:'version',supersedesId:BASE}),draft({id:CO,changeOrderOf:VERSION}));expect((await listApprovedChangeOrders(PROJECT)).map(row=>row.id)).toEqual([CO]);});
it('fails closed on a cycle without recursive looping or writes',async()=>{state.estimate_drafts.push(draft({id:CO,changeOrderOf:VERSION}),draft({id:VERSION,supersedesId:CO}));await expect(materializeChangeOrderTasks({changeOrderId:CO,userId:USER})).rejects.toMatchObject({code:'CHANGE_ORDER_NOT_APPROVED'});expect(await listApprovedChangeOrders(PROJECT)).toEqual([]);expect(reads).toBeLessThan(20);expect(writes).toEqual([]);});
it('fails closed when an ancestor is missing',async()=>{state.estimate_drafts.push(draft({id:CO,changeOrderOf:id(88)}));await expect(materializeChangeOrderTasks({changeOrderId:CO,userId:USER})).rejects.toMatchObject({code:'CHANGE_ORDER_NOT_APPROVED'});expect(writes).toEqual([]);});
it('rejects an ancestor in another project before materialization',async()=>{state.estimate_drafts.push(draft({id:CO,changeOrderOf:VERSION}),draft({id:VERSION,projectId:id(88)}));await expect(materializeChangeOrderTasks({changeOrderId:CO,userId:USER})).rejects.toMatchObject({code:'CHANGE_ORDER_NOT_APPROVED'});expect(writes).toEqual([]);});
it('bounds a malformed oversized ancestry graph and refuses rather than treating it as verified',async()=>{state.estimate_drafts.push(draft({id:CO,changeOrderOf:id(100)}));for(let n=100;n<230;n++)state.estimate_drafts.push(draft({id:id(n),supersedesId:n===229?BASE:id(n+1)}));await expect(materializeChangeOrderTasks({changeOrderId:CO,userId:USER})).rejects.toMatchObject({code:'CHANGE_ORDER_NOT_APPROVED'});expect(reads).toBeLessThan(270);expect(writes).toEqual([]);});
