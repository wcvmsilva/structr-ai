import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  project: vi.fn(),
  checklist: vi.fn(),
  mutate: vi.fn(),
  projectRetry: vi.fn(),
  checklistRetry: vi.fn(),
}));
const DRAFT = "a6800000-0000-4000-8000-000000000001";
const PROJECT = "a6800000-0000-4000-8000-000000000002";
const URL_PROJECT = "a6800000-0000-4000-8000-000000000003";
const TYPE = "bathroom_remodel";
const PATTERN_ID = "a6800000-0000-4000-8000-000000000004";

vi.mock("@/components/review/GeographicOverridePanel", () => ({
  GeographicOverridePanel: () => null,
}));
vi.mock("wouter", () => ({
  useSearch: () => `scopeDraftId=${DRAFT}&projectId=${URL_PROJECT}`,
  useLocation: () => ["", vi.fn()],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    project: {
      list: { useQuery: () => ({ data: { items: [] } }) },
      getById: { useQuery: mocks.project },
    },
    scope: { listDrafts: { useQuery: () => ({ data: [] }) } },
    scopeReview: {
      getReviewState: { useQuery: mocks.review },
      startReview: { useMutation: () => ({ mutate: mocks.mutate }) },
      approveOrReject: { useMutation: () => ({ mutate: mocks.mutate }) },
      convertToBundle: { useMutation: () => ({ mutate: mocks.mutate }) },
    },
    scopeCompleteness: { getChecklist: { useQuery: mocks.checklist } },
    estimate: {
      createFromScopeDraft: { useMutation: () => ({ mutate: mocks.mutate }) },
    },
    useUtils: () => ({}),
  },
}));
import ReviewPage from "../client/src/pages/Review";

function success(data: unknown, refetch = vi.fn()) {
  return {
    data,
    refetch,
    isSuccess: true,
    isError: false,
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
  };
}
function pattern(overrides: Record<string, unknown> = {}) {
  return {
    id: PATTERN_ID,
    projectType: TYPE,
    costCode: "Z-001",
    costCodeName: "Site protection",
    occurrenceCount: 3,
    projectCount: 5,
    frequency: "0.6",
    avgUnplannedCents: 12345,
    suggestion: "Review floor protection for this scope.",
    acknowledgedBy: "a6800000-0000-4000-8000-000000000005",
    acknowledgedAt: new Date("2026-09-01T00:00:00Z"),
    evidence: { projectIds: ["PRIVATE_PROJECT_EVIDENCE"] },
    ...overrides,
  };
}
function checklist(items: unknown[] = [pattern()], projectType = TYPE) {
  return { projectType, items, summary: "Historical suggestions only." };
}
function review(projectId = PROJECT) {
  return success({
    draft: {
      id: DRAFT,
      projectId,
      intakeFormId: DRAFT,
      status: "under_review",
    },
    effectiveItems: [],
    deltas: [],
    snapshot: null,
    validNextStates: ["approved", "rejected"],
    isTerminal: false,
  });
}
const render = () => renderToStaticMarkup(createElement(ReviewPage));
function approvalButton(html: string) {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(match => match[0])
    .find(button => button.includes("Approve"));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.review.mockReturnValue(review());
  mocks.project.mockReturnValue(
    success({ id: PROJECT, projectType: TYPE }, mocks.projectRetry)
  );
  mocks.checklist.mockReturnValue(success(checklist(), mocks.checklistRetry));
});

describe("historical scope checklist in Review (SSR and query boundary)", () => {
  it("uses the authorized draft project rather than the URL and places history before the decision", () => {
    const html = render();
    expect(mocks.project).toHaveBeenCalledWith(
      { id: PROJECT },
      expect.anything()
    );
    expect(mocks.checklist).toHaveBeenCalledWith(
      { projectType: TYPE },
      expect.objectContaining({ enabled: true })
    );
    expect(html).toContain("Recurring omissions to review");
    expect(html.indexOf("Recurring omissions to review")).toBeLessThan(
      html.indexOf("Approve")
    );
    expect(html).toContain(
      "Historical patterns for this project type. Review whether they apply to this scope."
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("does not request the project or checklist when the review authorization fails", () => {
    mocks.review.mockReturnValue({
      ...review(),
      error: new Error("Review unavailable"),
    });
    const html = render();
    expect(html).toContain("Review unavailable");
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.checklist).not.toHaveBeenCalled();
  });

  it.each(["loading", "refetching"])(
    "hides cached history while project details are %s",
    state => {
      mocks.project.mockReturnValue({
        ...success({ id: PROJECT, projectType: TYPE }),
        isLoading: state === "loading",
        isPending: state === "loading",
        isFetching: true,
      });
      const html = render();
      expect(html).toContain("Loading historical omissions...");
      expect(html).not.toContain("Review floor protection");
      expect(mocks.checklist).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false })
      );
    }
  );

  it("prioritizes a project error over cached data and offers the project retry", () => {
    mocks.project.mockReturnValue({
      ...success({ id: PROJECT, projectType: TYPE }, mocks.projectRetry),
      isError: true,
      error: new Error("Forbidden"),
    });
    const html = render();
    expect(html).toContain(
      "Unable to load project details for historical omissions. Try again."
    );
    expect(html).toContain('aria-label="Retry project details"');
    expect(html).not.toContain("Review floor protection");
    expect(mocks.checklist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });

  it("does not present an absent project as an empty history", () => {
    mocks.project.mockReturnValue(success(undefined, mocks.projectRetry));
    const html = render();
    expect(html).toContain(
      "Unable to load project details for historical omissions. Try again."
    );
    expect(html).not.toContain("No recurring omissions recorded");
    expect(mocks.checklist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });

  it.each([null, "", "   "])(
    "keeps the checklist disabled and ignores its cache for unavailable project type %s",
    projectType => {
      mocks.project.mockReturnValue(success({ id: PROJECT, projectType }));
      const html = render();
      expect(html).toContain(
        "Project type is unavailable. Historical omissions cannot be loaded."
      );
      expect(html).not.toContain("Review floor protection");
      expect(html).not.toContain("No recurring omissions recorded");
      expect(mocks.checklist).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false })
      );
    }
  );

  it("keeps historical type keys intact instead of remapping aliases", () => {
    mocks.project.mockReturnValue(
      success({ id: PROJECT, projectType: "  renovation  " })
    );
    mocks.checklist.mockReturnValue(success(checklist([], "renovation")));
    expect(render()).toContain(
      "No recurring omissions recorded for this project type yet."
    );
    expect(mocks.checklist).toHaveBeenCalledWith(
      { projectType: "renovation" },
      expect.objectContaining({ enabled: true })
    );
  });

  it("shows loading instead of a cached list while the checklist is refetching", () => {
    mocks.checklist.mockReturnValue({
      ...success(checklist()),
      isFetching: true,
    });
    const html = render();
    expect(html).toContain("Loading historical omissions...");
    expect(html).not.toContain("Review floor protection");
  });

  it("prioritizes a checklist failure over cached items and preserves the existing approval action", () => {
    mocks.checklist.mockReturnValue({
      ...success(checklist(), mocks.checklistRetry),
      isError: true,
      error: new Error("DB_UNAVAILABLE"),
    });
    const html = render();
    expect(html).toContain("Unable to load historical omissions. Try again.");
    expect(html).toContain('aria-label="Retry historical omissions"');
    expect(html).not.toContain("Review floor protection");
    expect(approvalButton(html)).toBeDefined();
    expect(approvalButton(html)).not.toContain("disabled");
  });

  it("describes a successful empty history without claiming completeness or blocking approval", () => {
    mocks.checklist.mockReturnValue(success(checklist([])));
    const html = render();
    expect(html).toContain(
      "No recurring omissions recorded for this project type yet."
    );
    expect(html).not.toMatch(
      /scope complete|all checks passed|checklist completed/i
    );
    expect(approvalButton(html)).toBeDefined();
    expect(approvalButton(html)).not.toContain("disabled");
  });

  it("renders server order, historical values and previously acknowledged patterns without exposing evidence identities", () => {
    mocks.checklist.mockReturnValue(
      success(
        checklist([
          pattern({
            suggestion: "Check <script>alert(1)</script> protection.",
          }),
          pattern({
            id: "a6800000-0000-4000-8000-000000000006",
            costCode: "A-002",
            costCodeName: "Demolition",
          }),
        ])
      )
    );
    const html = render();
    expect(html).toContain("Z-001");
    expect(html).toContain("Site protection");
    expect(html).toContain("3 of 5 projects");
    expect(html).toContain("60%");
    expect(html).toContain("$123.45");
    expect(html).toContain(
      "Check &lt;script&gt;alert(1)&lt;/script&gt; protection."
    );
    expect(html.indexOf("Z-001")).toBeLessThan(html.indexOf("A-002"));
    expect(html).not.toContain("PRIVATE_PROJECT_EVIDENCE");
    expect(html).not.toContain("a6800000-0000-4000-8000-000000000005");
    expect(html).not.toMatch(
      /acknowledge|reviewed for this job|checklist completed/i
    );
  });

  it("presents null metadata as unavailable rather than manufacturing zeros", () => {
    mocks.checklist.mockReturnValue(
      success(
        checklist([
          pattern({
            costCodeName: null,
            suggestion: null,
            occurrenceCount: null,
            projectCount: null,
            frequency: null,
            avgUnplannedCents: null,
          }),
        ])
      )
    );
    const html = render();
    expect(html).toContain("Z-001");
    expect(html).toContain("Historical suggestion unavailable.");
    expect(html).toContain("Occurrences unavailable");
    expect(html).toContain("Frequency unavailable");
    expect(html).toContain("Average historical omission cost unavailable");
    expect(html).not.toContain("0%");
    expect(html).not.toContain("$0.00");
  });

  it("preserves real numeric zero values", () => {
    mocks.checklist.mockReturnValue(
      success(
        checklist([
          pattern({
            occurrenceCount: 0,
            projectCount: 0,
            frequency: "0",
            avgUnplannedCents: 0,
          }),
        ])
      )
    );
    const html = render();
    expect(html).toContain("0 of 0 projects");
    expect(html).toContain("0%");
    expect(html).toContain("$0.00");
  });

  it("does not display checklist data returned for a different project type", () => {
    mocks.checklist.mockReturnValue(
      success(checklist([pattern()], "roofing"), mocks.checklistRetry)
    );
    const html = render();
    expect(html).toContain("Unable to load historical omissions. Try again.");
    expect(html).not.toContain("Review floor protection");
  });

  it("does not display a previous project's history under a newly authorized project context", () => {
    expect(render()).toContain("Review floor protection");
    mocks.review.mockReturnValue(review(URL_PROJECT));
    mocks.project.mockReturnValue({
      ...success({ id: PROJECT, projectType: TYPE }),
      isFetching: true,
    });
    const nextHtml = render();
    expect(nextHtml).toContain("Loading historical omissions...");
    expect(nextHtml).not.toContain("Review floor protection");
    expect(mocks.project).toHaveBeenLastCalledWith(
      { id: URL_PROJECT },
      expect.anything()
    );
    expect(mocks.checklist).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });
});
