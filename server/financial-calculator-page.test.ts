/** Real page routing/markup. Browser scheduling is exercised by the local lab. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({
  session: {} as any,
  search: "",
  projects: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { session: { useQuery: () => io.session } },
    project: { list: { useQuery: io.projects } },
    assembly: { list: { useQuery: io.catalog } },
    estimate: {
      createFromCalculator: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false, user: null }),
}));
vi.mock("@/lib/auth-token", () => ({
  getAuthSessionSnapshot: () => ({
    session: null,
    loading: false,
    generation: 0,
  }),
  subscribeAuthSession: () => () => {},
  subscribeAuthIdentityChange: () => () => {},
}));
vi.mock("wouter", () => ({
  useSearch: () => io.search,
  useLocation: () => ["/calculator", vi.fn()],
}));
vi.mock("@/hooks/useBundleCalculator", () => ({
  useBundleCalculator: () => ({
    selections: [],
    contextReady: false,
    assemblyList: [],
    assembliesLoading: false,
    categories: [],
    assemblyShields: new Map(),
    tradeBreakdown: [],
    profitShield: null,
    batchResult: null,
    finishLevel: "standard",
  }),
  REGION_OPTIONS: [],
  CHANNEL_OPTIONS: [],
  FINISH_OPTIONS: [],
}));
vi.mock("@/components/calculator/AssemblySelector", () => ({
  default: () => null,
}));
vi.mock("@/components/calculator/CostBreakdownTable", () => ({
  default: () => null,
}));
vi.mock("@/components/calculator/BundleSummaryPanel", () => ({
  default: () => null,
}));
import CalculatorPage from "../client/src/pages/Calculator";
beforeEach(() => {
  vi.clearAllMocks();
  io.projects.mockReturnValue({ data: { items: [] } });
  io.search = "";
  io.session = {
    data: {
      estimateReadOnly: true,
      authenticated: true,
      financialCalculatorEnabled: true,
    },
    isSuccess: true,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isPaused: false,
    isError: false,
    error: null,
  };
});
describe("Calculator contextual page boundary", () => {
  it("missing known pair renders guidance and never mounts global project or catalog reads", () => {
    const html = renderToStaticMarkup(createElement(CalculatorPage));
    expect(html).toMatch(/project and intake link/i);
    expect(io.projects).not.toHaveBeenCalled();
    expect(io.catalog).not.toHaveBeenCalled();
  });
  it("duplicate pair refuses before reading any context", () => {
    io.search =
      "projectId=bc100000-0000-4000-8000-000000000001&projectId=bc100000-0000-4000-8000-000000000001&intakeFormId=bc100000-0000-4000-8000-000000000002";
    expect(renderToStaticMarkup(createElement(CalculatorPage))).toMatch(
      /project and intake link/i
    );
    expect(io.projects).not.toHaveBeenCalled();
  });
  it.each([
    { isFetching: true },
    { isError: true, error: new Error("private details") },
    { data: undefined, isPending: true, isSuccess: false },
  ])("unknown or unsettled runtime never mounts legacy hooks %j", patch => {
    Object.assign(io.session, patch);
    const html = renderToStaticMarkup(createElement(CalculatorPage));
    expect(html).toMatch(/access|Checking/i);
    expect(html).not.toContain("private details");
    expect(io.projects).not.toHaveBeenCalled();
    expect(io.catalog).not.toHaveBeenCalled();
  });
  it("disabled capability shows a closed notice", () => {
    io.session.data.financialCalculatorEnabled = false;
    expect(renderToStaticMarkup(createElement(CalculatorPage))).toMatch(
      /unavailable/i
    );
    expect(io.projects).not.toHaveBeenCalled();
  });
});

it("preserves the existing project chooser in positively identified direct mode", () => {
  io.session.data.estimateReadOnly = false;
  io.session.data.financialCalculatorEnabled = false;
  const html = renderToStaticMarkup(createElement(CalculatorPage));
  expect(html).toContain("calculator-project-search");
  expect(io.projects).toHaveBeenCalledTimes(1);
});
it("reports a terminal runtime-descriptor error as unavailable rather than perpetual loading", () => {
  io.session.isError = true;
  io.session.error = new Error("private detail");
  const html = renderToStaticMarkup(createElement(CalculatorPage));
  expect(html).toMatch(/unavailable/i);
  expect(html).not.toContain("Checking");
  expect(html).not.toContain("private detail");
});
