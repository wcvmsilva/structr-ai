import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scopeDrafts,scopeDraftItems,auditLogs } from '../drizzle/schema';
const mocks=vi.hoisted(()=>({getDb:vi.fn()}));vi.mock('./db',()=>({getDb:mocks.getDb}));
import {createScopeDraft} from './scope-db';
const ID='b2700000-0000-4000-8000-000000000001';
let rows:Array<{table:unknown,value:any}>,fail:unknown,tx:any,db:any;
beforeEach(()=>{rows=[];fail=null;tx={insert:(table:unknown)=>({values:(value:any)=>({returning:async()=>{if(table===fail)throw new Error('fixture failure');const next=(Array.isArray(value)?value:[value]).map(row=>({id:ID,...row}));rows.push(...next.map(value=>({table,value})));return next;}})})};db={transaction:vi.fn(async(fn:any)=>{const before=[...rows];try{return await fn(tx);}catch(error){rows=before;throw error;}})};mocks.getDb.mockResolvedValue(db);});
describe('scope draft atomic persistence',()=>{
 it('links items to the returned draft and audits inside the same transaction',async()=>{const draft=await createScopeDraft({projectId:ID,tenantId:ID},ID,[{assemblyId:ID,quantity:'2',unit:'EA'}]);expect(draft?.id).toBe(ID);expect(db.transaction).toHaveBeenCalledTimes(1);expect(rows.find(row=>row.table===scopeDraftItems)?.value).toMatchObject({scopeDraftId:ID,assemblyId:ID,quantity:'2'});expect(rows.filter(row=>row.table===auditLogs)).toHaveLength(1);});
 it.each([scopeDrafts,scopeDraftItems,auditLogs])('rolls back header, items and audit together',async table=>{fail=table;await expect(createScopeDraft({projectId:ID,tenantId:ID},ID,[{assemblyId:ID,quantity:'2'}])).rejects.toThrow('fixture failure');expect(rows).toEqual([]);});
 it('can persist a deliberate empty scope without a detached item operation',async()=>{await createScopeDraft({projectId:ID,tenantId:ID},ID,[]);expect(rows.filter(row=>row.table===scopeDraftItems)).toHaveLength(0);expect(rows.filter(row=>row.table===auditLogs)).toHaveLength(1);});
});
