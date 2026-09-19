import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ projects: vi.fn(), workspace: vi.fn(), generate: vi.fn(), review: vi.fn(), search: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { project: { list: { useQuery: mocks.projects } }, scopeGeneration: { loadWorkspace: { useQuery: mocks.workspace }, sendToReview: { useMutation: mocks.review } }, scope: { generate: { useMutation: mocks.generate } } } }));
vi.mock('wouter', () => ({ useSearch: mocks.search, useLocation: () => ['',mocks.navigate], Link: ({href,children}:any)=>createElement('a',{href},children) }));
import ScopeGenerationPage from '../client/src/pages/ScopeGeneration';
const ID='a5700000-0000-4000-8000-000000000001'; const INTAKE='a5700000-0000-4000-8000-000000000002'; const DRAFT='a5700000-0000-4000-8000-000000000003';
beforeEach(()=>{vi.resetAllMocks();mocks.search.mockReturnValue(`projectId=${ID}&intakeFormId=${INTAKE}`);mocks.projects.mockReturnValue({data:{items:[]}});mocks.workspace.mockReturnValue({data:null,refetch:vi.fn()});mocks.review.mockReturnValue({mutate:vi.fn()});mocks.generate.mockReturnValue({mutate:vi.fn()});});
describe('scope navigation continuity',()=>{
  it('opens the same project handed off from intake',()=>{renderToStaticMarkup(createElement(ScopeGenerationPage));expect(mocks.workspace).toHaveBeenCalledWith({projectId:ID},{enabled:true});});
  it.each(['','projectId=123'])('does not query invalid project context %s',search=>{mocks.search.mockReturnValue(search);renderToStaticMarkup(createElement(ScopeGenerationPage));expect(mocks.workspace).toHaveBeenCalledWith(expect.anything(),{enabled:false});});
  it('opens the submitted draft after successful send to review',()=>{renderToStaticMarkup(createElement(ScopeGenerationPage));mocks.review.mock.calls[0][0].onSuccess({transitioned:true,message:'Sent'},{scopeDraftId:DRAFT});expect(mocks.navigate).toHaveBeenCalledWith(`/review?projectId=${ID}&scopeDraftId=${DRAFT}`);});
});
