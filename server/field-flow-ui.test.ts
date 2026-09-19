import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), projects: vi.fn(), record: vi.fn(), legacy: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: {
  project: { list: { useQuery: mocks.projects } },
  actuals: { list: { useQuery: mocks.list }, record: { useMutation: mocks.record } },
  fieldLaunch: { listActuals: { useQuery: mocks.legacy }, recordActual: { useMutation: mocks.record } },
  useUtils: () => ({ actuals: { list: { invalidate: vi.fn() } } }),
} }));
vi.mock('wouter', () => ({ useSearch: mocks.search }));
import ProjectActualsPage, { buildActualPayload } from '../client/src/pages/ProjectActuals';
const ID = 'f1700000-0000-4000-8000-000000000001';
const OTHER = 'f1700000-0000-4000-8000-000000000002';
const base = { projectId: ID, costCode: 'SYN-L01', vendorName: 'Synthetic Crew', description: 'Fixture labor', amount: '123.45', category: 'labor', dateIncurred: '2026-09-18', invoiceRef: '', notes: '' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.search.mockReturnValue(`projectId=${ID}`);
  mocks.projects.mockReturnValue({ data: { items: [{ id: ID, name: 'Synthetic Project' }] }, isLoading: false });
  mocks.list.mockReturnValue({ data: { actuals: [], total: 0 }, isLoading: false });
  mocks.legacy.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
  mocks.record.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
describe('real-cost form boundary', () => {
  it('preserves UUID and sends integer cents to the canonical ledger', () => {
    expect(buildActualPayload(base)).toEqual({ projectId: ID, costCode: 'SYN-L01', vendorName: 'Synthetic Crew', description: 'Fixture labor', amountCents: 12345, category: 'labor', dateIncurred: '2026-09-18', invoiceRef: undefined, notes: undefined });
  });
  it('leaves budget and estimate authority to the server', () => {
    const payload = buildActualPayload({ ...base, estimatedAmountCents: 1, estimateId: OTHER } as any);
    expect(payload).not.toHaveProperty('estimatedAmountCents'); expect(payload).not.toHaveProperty('estimateId');
  });
  it.each(['', '-1', '1.234', '1e3', 'Infinity', 'NaN', '123junk', '20000000.01'])("rejects invalid money '%s'", amount => {
    expect(() => buildActualPayload({ ...base, amount })).toThrow();
  });
  it.each(['', '42', '123-not-a-uuid'])("rejects invalid project '%s'", projectId => {
    expect(() => buildActualPayload({ ...base, projectId })).toThrow();
  });
  it.each(['costCode', 'vendorName', 'dateIncurred'] as const)('requires %s', field => {
    expect(() => buildActualPayload({ ...base, [field]: '' })).toThrow();
  });
  it('rejects nonexistent calendar dates', () => { expect(() => buildActualPayload({ ...base, dateIncurred: '2026-02-30' })).toThrow(); });
  it('normalizes whitespace but keeps the complete identity', () => { expect(buildActualPayload({ ...base, costCode: ' SYN-L01 ', vendorName: ' Crew ' })).toMatchObject({ projectId: ID, costCode: 'SYN-L01', vendorName: 'Crew' }); });
});
describe('real-cost page', () => {
  it('loads the canonical project ledger with the exact UUID', () => {
    const html = renderToStaticMarkup(createElement(ProjectActualsPage));
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ projectId: ID }), expect.objectContaining({ enabled: true }));
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(html).toContain('Synthetic Project');
  });
  it('does not query an empty or invalid project', () => {
    mocks.search.mockReturnValue(''); renderToStaticMarkup(createElement(ProjectActualsPage));
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });
  it('renders cents as dollars and pending costs as pending', () => {
    mocks.list.mockReturnValue({ data: { actuals: [{ id: OTHER, projectId: ID, costCode: 'SYN-L01', vendorName: 'Synthetic Crew', amountCents: 12345, estimatedAmountCents: 10000, varianceCents: 2345, variancePct: '23.45', status: 'pending', description: 'Fixture labor', dateIncurred: '2026-09-18' }], total: 1 }, isLoading: false });
    const html = renderToStaticMarkup(createElement(ProjectActualsPage));
    expect(html).toContain('$123.45'); expect(html).toContain('pending'); expect(html).toContain('Fixture labor'); expect(html).not.toContain('NaN');
  });
  it('shows a load failure instead of a false empty ledger', () => {
    mocks.list.mockReturnValue({ isError: true, error: new Error('private database details') });
    const html = renderToStaticMarkup(createElement(ProjectActualsPage));
    expect(html).toContain('Unable to load costs'); expect(html).not.toContain('private database details');
  });
});
