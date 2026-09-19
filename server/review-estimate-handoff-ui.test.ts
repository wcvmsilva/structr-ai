import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({review:vi.fn(),estimate:vi.fn(),mutate:vi.fn(),navigate:vi.fn(),invalidate:vi.fn()}));
const ID='a6700000-0000-4000-8000-000000000001'; const PROJECT='a6700000-0000-4000-8000-000000000002';const ESTIMATE='a6700000-0000-4000-8000-000000000003';
vi.mock('@/components/review/GeographicOverridePanel',()=>({GeographicOverridePanel:()=>null}));
vi.mock('wouter',()=>({useSearch:()=>`scopeDraftId=a6700000-0000-4000-8000-000000000001&projectId=a6700000-0000-4000-8000-000000000002`,useLocation:()=>['',mocks.navigate],Link:({href,children}:any)=>createElement('a',{href},children)}));
vi.mock('@/lib/trpc',()=>({trpc:{project:{list:{useQuery:()=>({data:{items:[]}})}},scope:{listDrafts:{useQuery:()=>({data:[]})}},scopeReview:{getReviewState:{useQuery:mocks.review},startReview:{useMutation:()=>({mutate:vi.fn()})},approveOrReject:{useMutation:()=>({mutate:vi.fn()})},convertToBundle:{useMutation:()=>({mutate:vi.fn()})}},estimate:{createFromScopeDraft:{useMutation:mocks.estimate}},useUtils:()=>({estimate:{list:{invalidate:mocks.invalidate}}})}}));
import ReviewPage from '../client/src/pages/Review';
const state = (status:string)=>({data:{draft:{id:ID,projectId:PROJECT,intakeFormId:ID,status},effectiveItems:[],deltas:[],snapshot:null,validNextStates:[],isTerminal:status==='converted'},isLoading:false});
beforeEach(()=>{vi.resetAllMocks();mocks.review.mockReturnValue(state('approved'));mocks.estimate.mockReturnValue({mutate:mocks.mutate,isPending:false});});
describe('review to estimate handoff',()=>{
  it.each(['approved','converted'])('offers canonical estimate creation from %s',status=>{mocks.review.mockReturnValue(state(status));expect(renderToStaticMarkup(createElement(ReviewPage))).toContain('Prepare estimate');});
  it.each(['draft','under_review','rejected'])('withholds estimate creation from %s',status=>{mocks.review.mockReturnValue(state(status));expect(renderToStaticMarkup(createElement(ReviewPage))).not.toContain('Prepare estimate');});
  it('navigates to the exact returned estimate after success',async()=>{renderToStaticMarkup(createElement(ReviewPage));await mocks.estimate.mock.calls[0][0].onSuccess({draft:{id:ESTIMATE},created:true});expect(mocks.navigate).toHaveBeenCalledWith(`/estimates/${ESTIMATE}`);expect(mocks.invalidate).toHaveBeenCalled();});
  it('keeps submission disabled while the pipeline runs',()=>{mocks.estimate.mockReturnValue({mutate:mocks.mutate,isPending:true});const html=renderToStaticMarkup(createElement(ReviewPage));expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Preparing estimate/);});
});
