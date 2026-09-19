import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), permission: vi.fn(), client: vi.fn(), geocode:vi.fn(), persistGeo:vi.fn(), address:vi.fn() }));
vi.mock('./intake-db', () => ({ createIntakeForm: mocks.create, getIntakeFormById: vi.fn(), listIntakeForms: vi.fn(), updateIntakeForm: vi.fn(), updateIntakeStatus: vi.fn(), getIntakeFormsByProject: vi.fn(), getIntakeFormsByClient: vi.fn(), getIntakeStats: vi.fn() }));
vi.mock('./project-access', () => ({ requireProjectAccessTrpc: mocks.access, requireEntityAccess: vi.fn() }));
vi.mock('./rbac', () => ({ requirePermission: mocks.permission }));
vi.mock('./client-db', () => ({ getClientById: mocks.client }));
vi.mock('./geo-integration',()=>({geocodeAndDetectZone:mocks.geocode,persistGeocodeResult:mocks.persistGeo}));
vi.mock('./geo-geocoding',()=>({validateAddressForGeocoding:mocks.address}));
import { intakeRouter } from './intake-router';
const ID = 'a3700000-0000-4000-8000-000000000001';
const request = { requestId: ID, serviceType:'repair', newProject: { name: 'Synthetic Project', address:'100 Example Lane', projectType:'repair' as const, client: { firstName: 'Synthetic', lastName: 'Customer' } }, rawPayload: {} };
const caller = (role='estimator', tenantId:string|null=ID, user=true) => intakeRouter.createCaller({ user:user?{id:ID,role}:null,tenantId } as any);
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ id:ID,projectId:ID });mocks.address.mockReturnValue({isValid:true});mocks.geocode.mockResolvedValue({success:true,geocode:{confidence:'high'},zoneSnapshot:{}}); mocks.client.mockResolvedValue({id:ID}); });
describe('atomic intake boundary', () => {
  it('forwards validated creation context and server-owned tenant/operator', async () => {
    await caller().create({ ...request, tenantId:'hostile' } as any);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({newProject:request.newProject,requestId:ID,tenantId:ID}),ID);
    expect(mocks.permission).toHaveBeenCalledWith(ID,'client','write');
  });
  it('cannot bypass the existing client write restriction', async () => {
    mocks.permission.mockRejectedValue(new TRPCError({ code:'FORBIDDEN' }));
    await expect(caller('viewer').create(request)).rejects.toMatchObject({code:'FORBIDDEN'}); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('retains admin authorization without an unnecessary permission lookup', async () => {
    await caller('admin').create(request); expect(mocks.permission).not.toHaveBeenCalled();
  });
  it.each([{projectId:ID},{clientId:ID},{leadId:ID}])('rejects conflicting identities %j', extra => {
    return expect(caller().create({...request,...extra})).rejects.toMatchObject({code:'BAD_REQUEST'});
  });
  it('requires the retry identifier for combined creation', async () => {
    await expect(caller().create({ ...request,requestId:undefined })).rejects.toMatchObject({code:'BAD_REQUEST'});
  });
  it('rejects anonymous callers before any write', async () => { await expect(caller('admin',ID,false).create(request)).rejects.toMatchObject({code:'UNAUTHORIZED'}); expect(mocks.create).not.toHaveBeenCalled(); });
  it('rejects unresolved tenants before any write', async () => { await expect(caller('admin',null).create(request)).rejects.toMatchObject({code:'FORBIDDEN'}); expect(mocks.create).not.toHaveBeenCalled(); });
  it('checks destination project authorization for linked intakes', async () => {
    await caller().create({projectId:ID,rawPayload:{}}); expect(mocks.access).toHaveBeenCalledWith(ID,ID,'write');
  });
  it('refuses a linked client outside the tenant', async () => {
    mocks.client.mockResolvedValue(null); await expect(caller().create({clientId:ID,rawPayload:{}})).rejects.toMatchObject({code:'NOT_FOUND'}); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects invalid customer email before writes', async () => {
    await expect(caller().create({...request,newProject:{...request.newProject,client:{...request.newProject.client,email:'invalid'}}})).rejects.toMatchObject({code:'BAD_REQUEST'}); expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('new operational project minimums',()=>{
  it.each(['address','projectType'] as const)('requires %s rather than inventing it',async field=>{
    const full={...request,serviceType:'repair',newProject:{...request.newProject,address:'100 Example Lane',projectType:'repair' as const}};
    await expect(caller().create({...full,newProject:{...full.newProject,[field]:undefined}})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('requires scope service type before creating the project',async()=>{
    await expect(caller().create({...request,serviceType:undefined,newProject:{...request.newProject,address:'100 Example Lane',projectType:'repair'}})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

 describe('intake project geographic context',()=>{
 it('preserves tenant-scoped geocoding after the atomic project commit',async()=>{await caller().create(request);expect(mocks.geocode).toHaveBeenCalledWith(ID,expect.objectContaining({address:'100 Example Lane'}));expect(mocks.persistGeo).toHaveBeenCalledWith(expect.objectContaining({projectId:ID,userId:ID}));});
 it('does not geocode an operation whose transaction failed',async()=>{mocks.create.mockRejectedValue(new Error('rollback'));await expect(caller().create(request)).rejects.toThrow('rollback');expect(mocks.geocode).not.toHaveBeenCalled();});
 it('keeps the committed intake available when geocoding is unavailable',async()=>{mocks.geocode.mockRejectedValue(new Error('offline'));await expect(caller().create(request)).resolves.toMatchObject({id:ID});expect(mocks.persistGeo).not.toHaveBeenCalled();});
 });
