import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLogs, clients, intakeForms, projects } from '../drizzle/schema';
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('./db', () => ({ getDb: mocks.getDb }));
import { createIntakeForm } from './intake-db';
const TENANT = 'a2700000-0000-4000-8000-000000000001';
const USER = 'a2700000-0000-4000-8000-000000000002';
const REQUEST = 'a2700000-0000-4000-8000-000000000003';
const input = { tenantId: TENANT, requestId: REQUEST, channel: 'direct' as const, serviceType: 'repair', rawPayload: { projectName: 'Synthetic Project' }, newProject: { name: 'Synthetic Project', projectType:'repair', client: { firstName: 'Synthetic', lastName: 'Customer', email: 'fixture@example.test' }, address: '100 Example Lane', city: 'Charleston', state: 'SC', zip: '29401' } };
let persisted: Array<{ table: unknown; value: any }>; let failTable: unknown; let db: any; let tx: any;
beforeEach(() => {
  persisted = []; failTable = undefined;
  const insert = vi.fn((table: unknown) => ({ values: (value: any) => ({ returning: async () => {
    if (table === failTable) throw new Error('fixture write failure');
    const row = { id: value.id ?? `fixture-${persisted.length}`, ...value }; persisted.push({ table, value: row }); return [row];
  } }) }));
  const select = vi.fn(() => { let table: unknown; return { from: (value: unknown) => { table=value; return { where: () => ({ limit: async () => persisted.filter(row => row.table === table).map(row=>row.value) }) }; } }; });
  tx = { insert, select, execute: vi.fn(async () => []) };
  db = { ...tx, transaction: vi.fn(async (fn: any) => { const before = [...persisted]; try { return await fn(tx); } catch (error) { persisted=before; throw error; } }) };
  mocks.getDb.mockResolvedValue(db);
});
describe('intake identity transaction', () => {
  it('creates one tenant-owned client/project/intake with the same canonical identity', async () => {
    const form = await createIntakeForm(input as any, USER);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const client = persisted.find(row=>row.table===clients)?.value;
    const project = persisted.find(row=>row.table===projects)?.value;
    expect(client).toMatchObject({ tenantId: TENANT, name: 'Synthetic Customer' });
    expect(project).toMatchObject({ tenantId: TENANT, ownerUserId: USER, clientId: client.id });
    expect(form).toMatchObject({ id: REQUEST, tenantId: TENANT, projectId: project.id, formData: expect.objectContaining({ clientId: client.id }) });
    expect(persisted.filter(row=>row.table===auditLogs)).toHaveLength(3);
  });
  it.each([clients, projects, intakeForms, auditLogs])('rolls back all records when a constituent write fails', async table => {
    failTable=table; await expect(createIntakeForm(input as any, USER)).rejects.toThrow('fixture write failure'); expect(persisted).toEqual([]);
  });
  it('returns the original intake on a repeated operation without duplicating identities', async () => {
    const first = await createIntakeForm(input as any, USER); const second = await createIntakeForm(input as any, USER);
    expect(second.id).toBe(first.id); expect(persisted.filter(row=>row.table===clients)).toHaveLength(1); expect(persisted.filter(row=>row.table===projects)).toHaveLength(1);
  });
  it('refuses reusing an operation ID for different details', async () => {
    await createIntakeForm(input as any, USER);
    await expect(createIntakeForm({ ...input, newProject: { ...input.newProject, name: 'Different' } } as any, USER)).rejects.toThrow('already used');
  });
  it('never reuses another tenant intake returned by storage', async () => {
    persisted.push({table:intakeForms,value:{id:REQUEST,tenantId:'other',formData:{}}});
    await expect(createIntakeForm(input as any, USER)).rejects.toThrow('already used');
  });
  it('requires an operation id for combined creation', async () => {
    await expect(createIntakeForm({ ...input, requestId: undefined } as any, USER)).rejects.toThrow('request');
    expect(persisted).toEqual([]);
  });
  it('keeps linked intake creation transactional and audited', async () => {
    const form = await createIntakeForm({ tenantId:TENANT, projectId:USER, clientId:REQUEST, rawPayload:{} }, USER);
    expect(form).toMatchObject({ projectId:USER, formData:expect.objectContaining({clientId:REQUEST}) });
    expect(db.transaction).toHaveBeenCalledTimes(1); expect(persisted.filter(row=>row.table===auditLogs)).toHaveLength(1);
  });
});
