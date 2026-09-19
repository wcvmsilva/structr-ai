import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ projects: vi.fn(), drafts: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { project: { list: { useQuery: mocks.projects } }, scope: { listDrafts: { useQuery: mocks.drafts } } } }));
vi.mock('wouter', () => ({ useSearch: mocks.search }));
import ReviewPage from '../client/src/pages/Review';
const PROJECT = 'a1700000-0000-4000-8000-000000000001';
const DRAFT = 'a1700000-0000-4000-8000-000000000002';
beforeEach(() => {
  vi.resetAllMocks(); mocks.search.mockReturnValue(`projectId=${PROJECT}`);
  mocks.projects.mockReturnValue({ data: { items: [{ id: PROJECT, name: 'Synthetic Work' }] } });
  mocks.drafts.mockReturnValue({ data: [{ id: DRAFT, projectId: PROJECT, intakeFormId: 'Fixture intake', status: 'under_review' }], isLoading: false });
});
describe('workflow navigation identity', () => {
  it('mounts the scope review URL in the authenticated router', () => {
    const app = readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(/<Route path="\/review" component=\{ReviewPage\}/);
  });
  it('passes full project UUID to scope listing and labels the selector', () => {
    const html = renderToStaticMarkup(createElement(ReviewPage));
    expect(mocks.drafts).toHaveBeenCalledWith({ projectId: PROJECT }, expect.objectContaining({ enabled: true }));
    expect(html).toContain('Synthetic Work'); expect(html).not.toContain('type="number"');
  });
  it.each(['', 'projectId=1', 'projectId=123junk'])('does not send invalid context %s', search => {
    mocks.search.mockReturnValue(search); renderToStaticMarkup(createElement(ReviewPage));
    expect(mocks.drafts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });
  it('shows a failed request instead of an empty review queue', () => {
    mocks.drafts.mockReturnValue({ isError: true, error: new Error('sensitive detail') });
    const html = renderToStaticMarkup(createElement(ReviewPage));
    expect(html).toContain('Unable to load scope drafts'); expect(html).not.toContain('sensitive detail');
  });
});
