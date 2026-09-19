import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('./db', () => ({ getDb: mocks.getDb }));
import { logAudit } from './audit';
const params = { action: 'fixture.created', tableName: 'intake_forms', recordId: 'synthetic', userId: 'operator', before: null, after: { status: 'draft' } };
function handle(rows: unknown[], error?: Error) {
  const returning = vi.fn(() => error ? Promise.reject(error) : Promise.resolve(rows));
  const values = vi.fn(() => ({ returning }));
  return { insert: vi.fn(() => ({ values })), values };
}
beforeEach(() => vi.resetAllMocks());
describe('transactional audit sink', () => {
  it('writes through the supplied transaction without acquiring another connection', async () => {
    const tx = handle([{ id: 'audit-fixture' }]);
    await expect(logAudit(params, tx as any)).resolves.toEqual({ id: 'audit-fixture' });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({ action: params.action, oldValues: null, newValues: params.after }));
  });
  it('propagates audit insert failure so the business transaction rolls back', async () => {
    const tx = handle([], new Error('fixture audit failure'));
    await expect(logAudit(params, tx as any)).rejects.toThrow('fixture audit failure');
  });
  it('fails closed when the transaction returns no audit row', async () => {
    await expect(logAudit(params, handle([]) as any)).rejects.toThrow('Audit insert returned no row');
  });
  it('keeps legacy missing-database behavior unchanged', async () => {
    mocks.getDb.mockResolvedValue(null);
    await expect(logAudit(params)).resolves.toBeNull();
  });
});
