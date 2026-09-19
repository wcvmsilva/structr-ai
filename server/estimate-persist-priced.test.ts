import { afterAll, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({values:vi.fn(),drizzle:vi.fn(),transaction:vi.fn(),auditValues:vi.fn()}));
vi.mock('postgres',()=>({default:vi.fn(()=>({}))}));
vi.mock('drizzle-orm/postgres-js',()=>({drizzle:mocks.drizzle}));
import { createEstimateDraft } from './db';
import { auditLogs } from '../drizzle/schema';
const ID='a8700000-0000-4000-8000-000000000001';
const priced={bundleName:'Synthetic estimate',channel:'direct',region:'charleston',finishLevel:'standard',lineItems:[{costItemName:'Fixture',quantity:1}],assemblySelections:[{assemblyId:ID,quantity:1}],subtotalCost:'600.00',subtotalPrice:'1000.00',grossProfit:'400.00',grossProfitPct:'40.00',finalTotalPrice:'1000.00',assemblyCount:1,profitShieldPassed:true,profitShieldMinPct:'28.00',notes:'Synthetic',clientId:ID,projectId:ID,metadata:{source:'fixture'}};
afterAll(()=>vi.unstubAllEnvs());
describe('priced estimate persistence',()=>{
 it('writes pricing and identity into the real estimate columns',async()=>{
  vi.stubEnv('DATABASE_URL','postgres://fixture:fixture@127.0.0.1:1/fixture');
  mocks.values.mockImplementation((values:any)=>({returning:async()=>[{id:ID,...values}]}));
  mocks.auditValues.mockImplementation((values:any)=>({returning:async()=>[{id:ID,...values}]}));
  const handle={insert:(table:unknown)=>({values:table===auditLogs?mocks.auditValues:mocks.values}),transaction:mocks.transaction};
  mocks.transaction.mockImplementation((fn:any)=>fn(handle));
  mocks.drizzle.mockReturnValue(handle);
  const result=await createEstimateDraft({projectId:ID,tenantId:ID,scopeDraftId:ID,createdBy:ID,source:'scope_draft',priced} as any);
  expect(result).toMatchObject({...priced,projectId:ID,source:'scope_draft',tenantId:ID,scopeDraftId:ID,createdBy:ID});
 });
 it('audits canonical priced drafts in the same transaction',async()=>{
  mocks.transaction.mockClear();mocks.auditValues.mockClear();
  await createEstimateDraft({projectId:ID,tenantId:ID,createdBy:ID,source:'scope_draft',priced} as any);
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  expect(mocks.auditValues).toHaveBeenCalledWith(expect.objectContaining({action:'estimate.create_from_scope',tableName:'estimate_drafts',recordId:ID,newValues:expect.objectContaining({projectId:ID,tenantId:ID})}));
 });
 it('does not report a canonical draft saved when transactional audit fails',async()=>{
  mocks.auditValues.mockImplementationOnce(()=>({returning:async()=>{throw new Error('audit failure');}}));
  await expect(createEstimateDraft({projectId:ID,tenantId:ID,createdBy:ID,source:'scope_draft',priced} as any)).rejects.toThrow('audit failure');
 });
 it('keeps legacy unpriced calls compatible' ,async()=>{
  const result=await createEstimateDraft({projectId:ID,draftData:{legacy:true}});
  expect(result).toMatchObject({projectId:ID,draftData:{legacy:true},status:'draft'});
 });
});
