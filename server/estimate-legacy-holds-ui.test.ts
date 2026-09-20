/** Invoke the actual detail callbacks, including stale positive transport state. */
import { Children, isValidElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ draft: vi.fn(), auth: vi.fn(), mutation: vi.fn(), mutate: vi.fn(), fetch: vi.fn(), navigate: vi.fn(), success: vi.fn(), open: vi.fn(), capture: false }));
vi.mock('react', async original => { const real = await original<typeof import('react')>(); return { ...real, useState: (initial: unknown) => io.capture ? [typeof initial === 'function' ? initial() : initial, vi.fn()] : real.useState(initial) }; });
vi.mock('@/lib/trpc', () => ({ trpc: { estimate: {
  getById: { useQuery: io.draft }, profitShield: { useQuery: () => ({}) }, exportAuthorization: { useQuery: io.auth }, exportPrintable: { useQuery: () => ({}) },
  exportPdf: { useMutation: io.mutation }, exportJson: { useMutation: io.mutation }, exportCsv: { useMutation: io.mutation }, exportPreflight: { useMutation: io.mutation },
  approveEstimate: { useMutation: io.mutation }, rejectEstimate: { useMutation: io.mutation }, updateStatus: { useMutation: io.mutation },
}, issueReport: { create: { useMutation: io.mutation } }, useUtils: () => ({ estimate: { validateCsvExport: { fetch: io.fetch }, getById: { invalidate: vi.fn() }, profitShield: { invalidate: vi.fn() }, exportAuthorization: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }) } }));
vi.mock('wouter', () => ({ useRoute: () => [true, { id: 'd2700000-0000-4000-8000-000000000001' }], useLocation: () => ['/', io.navigate] }));
vi.mock('sonner', () => ({ toast: { success: io.success, error: vi.fn(), info: vi.fn() } }));
import Detail from '../client/src/pages/EstimateDetail';
import { LEGACY_ESTIMATE_HOLD_MESSAGE } from '../shared/estimate-legacy-hold';
import { buildEstimateVersionPreviewV2, projectEstimateVersionDraftV2 } from '../shared/estimate-version-engine';
import { approvalIds, makeInternalApprovalSnapshot } from './internal-estimate-approval-engine.fixtures';
let versionRow: Awaited<ReturnType<typeof projectEstimateVersionDraftV2>>;
beforeAll(async () => {
 const snapshot = makeInternalApprovalSnapshot();
 const content = { ...snapshot, version: 'estimate-version-copy-source-v2',
  financials: { ...snapshot.financials, currencyBasis: 'version_request_confirmation' },
  copyProjection: { assemblyCount: 1, directZone: null } };
 const command = { version: 'estimate-version-preview-command-v2', sourceKind: 'current_draft',
  sourceDraftId: approvalIds.draft, confirmedCurrencyCode: 'USD' };
 const preview = await buildEstimateVersionPreviewV2({ command, content, sourceApprovalId: null, sourceApprovalState: null });
 versionRow = await projectEstimateVersionDraftV2({ preview,
  command: { ...command, version: 'estimate-version-command-v2', requestId: approvalIds.request,
   expectedSourceVersion: 1, expectedSourceContentHash: preview.sourceContentHash, name: null, reason: 'Synthetic callback hold regression' },
  context: { tenantId: approvalIds.tenant, actorId: approvalIds.actor, projectId: approvalIds.project, clientId: approvalIds.client },
  allocation: { id: 'd2700000-0000-4000-8000-000000000001', version: 2, timestamp: '2026-09-20T12:00:00.000Z' } });
});
function text(node: ReactNode): string { return typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : isValidElement<{children?: ReactNode}>(node) ? text(node.props.children) : ''; }
function buttons(tree: ReactNode, label: string) {
 const found: ReactElement<{ onClick?: () => unknown; children?: ReactNode }>[] = [];
 function visit(node: ReactNode) { if (!isValidElement<{onClick?: () => unknown; children?: ReactNode}>(node)) return;
 if (text(node.props.children).trim() === label && typeof node.props.onClick === 'function') found.push(node); Children.forEach(node.props.children, visit); }
 Children.forEach(tree, visit); return found;
}
function view() { io.capture = true; let tree: ReactNode; try { tree = Detail(); } finally { io.capture = false; } return { tree, html: renderToStaticMarkup(tree) }; }
const row = { id: 'd2700000-0000-4000-8000-000000000001', status: 'draft', source: 'assembly_calculator', bundleName: 'Synthetic hold test', createdAt: '2026-09-20', subtotalCost: '40.00', subtotalPrice: '100.00', finalTotalPrice: '100.00', discountAmount: '0.00', lineItems: [], assemblySelections: [], metadata: {} };
beforeEach(() => { vi.clearAllMocks(); io.draft.mockReturnValue({ data: row }); io.auth.mockReturnValue({ data: { authorized: true }, isSuccess: true }); io.mutation.mockReturnValue({ mutate: io.mutate, isPending: false }); io.fetch.mockResolvedValue({ isValid: true, validRows: 4 }); vi.stubGlobal('window', { open: io.open }); });
afterEach(() => vi.unstubAllGlobals());
describe.each(['draft', 'approved', 'internally_approved', 'rejected'])('C2-A detail %s', status => {
 it.each(['PDF', 'JSON', 'Print', 'Validate CSV', 'JobTread CSV'])('blocks the real %s callback despite cached authorization', async label => {
  io.draft.mockReturnValue({ data: { ...row, status } }); const result = view(); const matches = buttons(result.tree, label); expect(matches.length).toBeGreaterThan(0);
  for (const node of matches) await node.props.onClick!();
  expect(io.mutate).not.toHaveBeenCalled(); expect(io.fetch).not.toHaveBeenCalled(); expect(io.open).not.toHaveBeenCalled(); expect(io.success).not.toHaveBeenCalled();
  expect(result.html).toContain('Approval and exports are temporarily unavailable'); expect(result.html).not.toContain('Export authorization: allowed');
 });
});
it('cannot dispatch approval through an old confirmation callback', async () => { const result = view(); for (const node of buttons(result.tree, 'Confirm Approval')) await node.props.onClick!(); expect(io.mutate).not.toHaveBeenCalled(); expect(result.html).not.toContain('Confirm Approval'); expect(result.html).toContain('Approval and exports are temporarily unavailable'); });
it('keeps reading and back navigation available', async () => { const result = view(); expect(result.html).toContain('$100.00'); for (const node of buttons(result.tree, 'Back to Estimates')) await node.props.onClick!(); expect(io.navigate).toHaveBeenCalledWith('/estimate'); });

// Exercise callbacks directly even when the DOM marks them disabled.
describe.each(['real v2', 'partial v2 marker', 'paused authorization', 'cached error', 'pending authorization'])('C2-A %s boundary', kind => {
 it.each(['PDF', 'JSON', 'Print', 'Validate CSV', 'JobTread CSV'])('keeps the %s callback inert', async label => {
  if (kind === 'real v2') io.draft.mockReturnValue({ data: versionRow });
  if (kind === 'partial v2 marker') io.draft.mockReturnValue({ data: { ...row, source: 'version', a1VersionRequestId: approvalIds.request, a1VersionRequestHash: null } });
  if (kind === 'paused authorization') io.auth.mockReturnValue({ data: { authorized: true }, isSuccess: true, isPaused: true });
  if (kind === 'cached error') io.auth.mockReturnValue({ data: { authorized: true }, isSuccess: true, isError: true, error: new Error('Synthetic private failure') });
  if (kind === 'pending authorization') io.auth.mockReturnValue({ data: { authorized: true }, isSuccess: false, isPending: true });
  const result = view(); const matches = buttons(result.tree, label); expect(matches.length).toBeGreaterThan(0);
  for (const node of matches) await node.props.onClick!();
  expect(io.mutate).not.toHaveBeenCalled(); expect(io.fetch).not.toHaveBeenCalled(); expect(io.open).not.toHaveBeenCalled(); expect(io.success).not.toHaveBeenCalled();
  expect(result.html).toContain('Approval and exports are temporarily unavailable'); expect(result.html).not.toContain('Export authorization: allowed'); expect(result.html).not.toContain('Synthetic private failure');
 });
});
it.each([
 ['source', { source: 'historical_import' }],
 ['linked source', { source: 'assembly_calculator', historicalImportId: approvalIds.request }],
])('keeps H1 %s outside every held or positive artifact callback', async (_, patch) => {
 io.draft.mockReturnValue({ data: { ...row, ...patch } }); const result = view();
 for (const label of ['PDF', 'JSON', 'Print', 'Validate CSV', 'JobTread CSV', 'Confirm Approval']) expect(buttons(result.tree, label)).toHaveLength(0);
 expect(result.html).toContain('Historical record'); expect(result.html).toContain('Approval, export and field execution are unavailable for this record.');
 expect(io.auth).toHaveBeenCalledWith({ id: row.id }, { enabled: false });
 expect(io.mutate).not.toHaveBeenCalled(); expect(io.fetch).not.toHaveBeenCalled(); expect(io.open).not.toHaveBeenCalled(); expect(io.success).not.toHaveBeenCalled();
});
it('renders the shared hold reason once rather than repeating a server hold', () => {
 io.auth.mockReturnValue({ data: { authorized: false, reason: LEGACY_ESTIMATE_HOLD_MESSAGE }, isSuccess: true });
 const result = view();
 const paragraphs = result.html.match(/<p[^>]*>[\s\S]*?<\/p>/g) ?? [];
 expect(paragraphs.filter(paragraph => paragraph.includes(LEGACY_ESTIMATE_HOLD_MESSAGE))).toHaveLength(1);
});
