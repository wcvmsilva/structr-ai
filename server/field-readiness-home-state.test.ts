/** Real Home markup, handlers and query options with controlled transport results.
 * SSR does not claim browser scheduling or hosted authorization coverage. */
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  session: vi.fn(),
  projectStats: vi.fn(),
  projects: vi.fn(),
  catalogStats: vi.fn(),
  groups: vi.fn(),
  pipeline: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { session: { useQuery: mocks.session } },
    project: {
      stats: { useQuery: mocks.projectStats },
      list: { useQuery: mocks.projects },
    },
    catalog: {
      stats: { useQuery: mocks.catalogStats },
      groups: { useQuery: mocks.groups },
    },
    pipeline: { getOverview: { useQuery: mocks.pipeline } },
  },
}));
import Home from "../client/src/pages/Home";

function success(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isSuccess: true,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isPaused: false,
  };
}
const sessionData = {
  provider: "supabase",
  authenticated: true,
  supabase: {
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
  },
  estimateReadOnly: false,
};
const business = [
  mocks.projectStats,
  mocks.projects,
  mocks.catalogStats,
  mocks.groups,
  mocks.pipeline,
];
const ready = () => [
  success({
    total: 2,
    byStatus: { intake: 1, estimating: 1 },
    byChannel: {},
    byType: {},
  }),
  success({
    items: [
      {
        id: "p1",
        name: "Kitchen remodel",
        clientName: "Client A",
        status: "intake",
        estimatedTotal: "12500",
        createdAt: "2026-10-08T12:00:00.000Z",
      },
    ],
    total: 1,
  }),
  success({ totalItems: 27, totalGroups: 3, avgMargin: 37.5 }),
  success([{ id: "g1", name: "Finishes" }]),
  success({
    summary: {},
    funnel: {
      totalLeads: 1,
      qualifiedLeads: 1,
      totalDeals: 4,
      proposalsSent: 1,
      dealsWon: 0,
    },
    revenue: { pipelineValue: 45600, totalDealValue: 45600 },
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue(success(sessionData));
  ready().forEach((result, index) => business[index].mockReturnValue(result));
});

function render() {
  return renderToStaticMarkup(createElement(Home));
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return text(node.props.children);
  return "";
}
function click(label: string) {
  let action: (() => void) | undefined;
  function visit(node: ReactNode) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (
      !isValidElement<{
        children?: ReactNode;
        label?: string;
        onClick?: () => void;
      }>(node)
    )
      return;
    if (
      (node.props.label === label ||
        text(node.props.children).trim() === label) &&
      node.props.onClick
    )
      action = node.props.onClick;
    visit(node.props.children);
  }
  visit(Home());
  expect(action, `visible action ${label}`).toBeDefined();
  action!();
}
function expectNoOperationalClaims(html: string) {
  expect(html).not.toMatch(
    /CSV export ready|Catalog synced|>connected<|>ready<|Auto-adjust enabled/
  );
}
function expectNoMetrics(html: string) {
  expect(html).not.toContain("Active Projects");
  expect(html).not.toContain("Pipeline Value");
  expect(html).not.toContain("Avg. Gross Profit");
  expect(html).not.toContain("Catalog Items");
}
function expectNoUnavailableActions(html: string) {
  for (const label of [
    "New Intake",
    "New Estimate",
    "Bundles",
    "Pending Reviews",
    "Create Lead",
    "Create Estimate",
  ]) {
    expect(html).not.toContain(label);
  }
  expect(html).not.toMatch(/<(button|a)\b/);
}
function expectQueryGate(enabled: boolean) {
  for (const query of business) {
    expect(query.mock.lastCall?.[1]).toMatchObject({ enabled });
  }
}

describe("Home presentation follows the current access descriptor", () => {
  it("limited mode suppresses all five unavailable queries, cached metrics and in-page actions", () => {
    mocks.session.mockReturnValue(
      success({ ...sessionData, estimateReadOnly: true })
    );
    const html = render();
    expectQueryGate(false);
    expect(html).toMatch(/limited access|access is limited/i);
    expect(html).toMatch(/unavailable|not available/i);
    expectNoMetrics(html);
    expectNoUnavailableActions(html);
    expectNoOperationalClaims(html);
  });

  it.each([
    ["missing result", success(undefined)],
    ["missing flag", success({ provider: "supabase" })],
    ["non-boolean flag", success({ ...sessionData, estimateReadOnly: 0 })],
    [
      "initial load",
      {
        ...success(undefined),
        isSuccess: false,
        isPending: true,
        isLoading: true,
        isFetching: true,
      },
    ],
    [
      "cached false during refetch",
      { ...success(sessionData), isFetching: true },
    ],
    ["cached false while paused", { ...success(sessionData), isPaused: true }],
    [
      "cached false after error",
      {
        ...success(sessionData),
        isSuccess: false,
        isError: true,
        error: new Error("private server detail"),
      },
    ],
  ])(
    "%s never enables business requests or renders operational claims",
    (_name, result) => {
      mocks.session.mockReturnValue(result);
      const html = render();
      expectQueryGate(false);
      expectNoMetrics(html);
      expectNoUnavailableActions(html);
      expectNoOperationalClaims(html);
      expect(html).not.toContain("private server detail");
      expect(html).toMatch(/access/i);
    }
  );

  it("only a current explicit false enables the five original query inputs", () => {
    render();
    expectQueryGate(true);
    expect(mocks.projects).toHaveBeenLastCalledWith(
      { limit: 5 },
      { enabled: true }
    );
    for (const query of [
      mocks.projectStats,
      mocks.catalogStats,
      mocks.groups,
      mocks.pipeline,
    ]) {
      expect(query).toHaveBeenLastCalledWith(undefined, { enabled: true });
    }
  });

  it("a descriptor refresh withdraws the already-rendered dashboard and its navigation", () => {
    expect(render()).toContain("Kitchen remodel");
    mocks.session.mockReturnValue({
      ...success(sessionData),
      isFetching: true,
    });
    const html = render();
    expectQueryGate(false);
    expect(html).not.toContain("Kitchen remodel");
    expectNoMetrics(html);
    expectNoUnavailableActions(html);
  });
});

describe("Home distinguishes unavailable data from successful empty results", () => {
  it("any pending data query displays loading instead of zero metrics or cached totals", () => {
    for (let index = 0; index < business.length; index++) {
      ready().forEach((result, at) => business[at].mockReturnValue(result));
      business[index].mockReturnValue({
        ...ready()[index],
        isSuccess: false,
        isPending: true,
        isLoading: true,
        isFetching: true,
      });
      const html = render();
      expect(html).toMatch(/loading dashboard/i);
      expect(html).toContain('role="status"');
      expectNoMetrics(html);
      expectNoOperationalClaims(html);
    }
  });

  it("a failed query hides even cached successful metrics and reports a sanitized error", () => {
    for (let index = 0; index < business.length; index++) {
      ready().forEach((result, at) => business[at].mockReturnValue(result));
      business[index].mockReturnValue({
        ...ready()[index],
        isSuccess: false,
        isError: true,
        error: new Error("internal database URI"),
      });
      const html = render();
      expect(html).toContain('role="alert"');
      expect(html).toMatch(/unable to load|could not be loaded/i);
      expect(html).not.toContain("internal database URI");
      expectNoMetrics(html);
      expectNoOperationalClaims(html);
    }
  });

  it.each([
    ["missing project stats", 0, undefined],
    ["missing status counts", 0, { total: 0 }],
    ["missing projects list", 1, { total: 0 }],
    ["missing catalog totals", 2, { avgMargin: 0 }],
    ["missing catalog groups", 3, null],
    ["missing pipeline revenue", 4, { funnel: { totalDeals: 0 } }],
    ["missing pipeline funnel", 4, { revenue: { pipelineValue: 0 } }],
  ])(
    "%s is an incomplete response, never a valid zero dashboard",
    (_name, index, data) => {
      business[index as number].mockReturnValue(success(data));
      const html = render();
      expect(html).toContain('role="alert"');
      expect(html).toMatch(/incomplete/i);
      expectNoMetrics(html);
      expectNoOperationalClaims(html);
    }
  );

  it("successful sparse counts and empty arrays display genuine zeros and an empty-project message", () => {
    mocks.projectStats.mockReturnValue(
      success({ total: 0, byStatus: {}, byChannel: {}, byType: {} })
    );
    mocks.projects.mockReturnValue(success({ items: [], total: 0 }));
    mocks.catalogStats.mockReturnValue(
      success({ totalItems: 0, totalGroups: 0, avgMargin: 0 })
    );
    mocks.groups.mockReturnValue(success([]));
    mocks.pipeline.mockReturnValue(
      success({
        summary: {},
        funnel: {
          totalLeads: 0,
          qualifiedLeads: 0,
          totalDeals: 0,
          proposalsSent: 0,
          dealsWon: 0,
        },
        revenue: { pipelineValue: 0, totalDealValue: 0 },
      })
    );
    const html = render();
    expect(html).toContain("Active Projects");
    expect(html).toContain("0 pending estimates");
    expect(html).toContain("$0");
    expect(html).toContain("0 active deals");
    expect(html).toContain("0.0%");
    expect(html).toContain("0 cost groups");
    expect(html).toMatch(/no projects yet/i);
    expect(html).not.toContain('role="alert"');
    expectNoOperationalClaims(html);
  });

  it("valid direct-mode results preserve metrics, projects and each original navigation action", () => {
    const html = render();
    expect(html).toContain("Kitchen remodel");
    expect(html).toContain("$12,500");
    expect(html).toContain("$45,600");
    expect(html).toContain("4 active deals");
    expect(html).toContain("37.5%");
    expect(html).toContain("3 cost groups");
    for (const [label, path] of [
      ["New Intake", "/intake"],
      ["New Estimate", "/estimate"],
      ["Bundles", "/bundles"],
      ["Pending Reviews", "/review"],
      ["Create Lead", "/leads"],
      ["Create Estimate", "/estimate"],
      ["Pipeline Value", "/pipeline"],
    ]) {
      click(label);
      expect(mocks.navigate).toHaveBeenLastCalledWith(path);
    }
    expectNoOperationalClaims(html);
  });
});
