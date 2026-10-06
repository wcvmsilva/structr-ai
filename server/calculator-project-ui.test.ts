/** Actual calculator markup and callbacks; transport/pricing are synthetic.
 * The state harness re-renders explicitly and does not claim browser scheduling.
 */
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  query: vi.fn(), mutation: vi.fn(), mutate: vi.fn(), error: vi.fn(), success: vi.fn(),
  warning: vi.fn(), navigate: vi.fn(), calc: vi.fn(), auth: vi.fn(),
  slots: [] as unknown[], cursor: 0,
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState(initial: unknown) {
    const index = io.cursor++;
    if (!(index in io.slots)) io.slots[index] = typeof initial === "function" ? initial() : initial;
    return [io.slots[index], (value: unknown) => {
      io.slots[index] = typeof value === "function" ? value(io.slots[index]) : value;
    }];
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: io.auth }));
vi.mock("@/hooks/useBundleCalculator", () => ({
  useBundleCalculator: io.calc,
  REGION_OPTIONS: [{ value: "charleston_metro", label: "Synthetic region" }],
  CHANNEL_OPTIONS: [{ value: "direct", label: "Direct" }],
  FINISH_OPTIONS: [{ value: "standard", label: "Standard" }],
}));
vi.mock("@/components/calculator/AssemblySelector", () => ({ default: () => null }));
vi.mock("@/components/calculator/CostBreakdownTable", () => ({ default: () => null }));
// Pricing selectors are unrelated to this contract. Avoid their portal/internal hooks.
vi.mock("@/components/ui/select", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { Select: passthrough, SelectContent: passthrough, SelectItem: passthrough,
    SelectTrigger: passthrough, SelectValue: ({ placeholder }: { placeholder?: string }) => createElement("span", null, placeholder) };
});
vi.mock("@/lib/trpc", () => ({ trpc: {
  project: { list: { useQuery: io.query } },
  estimate: { createFromCalculator: { useMutation: io.mutation } },
} }));
vi.mock("sonner", () => ({ toast: { error: io.error, success: io.success, warning: io.warning, info: vi.fn() } }));
vi.mock("wouter", () => ({ useLocation: () => ["/calculator", io.navigate] }));
import CalculatorPage from "../client/src/pages/Calculator";

const PROJECT = "bc100000-0000-4000-8000-000000000001";
const OTHER = "bc100000-0000-4000-8000-000000000002";
const ASSEMBLY = "bc100000-0000-4000-8000-000000000003";
const project = (id = PROJECT, patch: Record<string, unknown> = {}) => ({
  id, name: "Synthetic project", address: "1 Synthetic Lane", clientId: OTHER, tenantId: OTHER, deletedAt: null, ...patch,
});
const settled = (items = [project()], patch: Record<string, unknown> = {}) => ({
  data: { items, total: items.length }, isLoading: false, isPending: false, isFetching: false,
  isError: false, error: null, refetch: vi.fn(), ...patch,
});
function calculation() {
  return {
    selections: [{ assemblyId: ASSEMBLY, quantity: 2 }],
    region: "charleston_metro", channel: "direct", finishLevel: "standard",
    batchResult: { assemblies: [], totalCost: 40, totalPrice: 100, grossProfit: 60, grossProfitPct: 60, meetsMinGP: true },
    profitShield: { level: "green", pct: 60 }, tradeBreakdown: [],
    contextReady: true, canExport: true, calculating: false, recalculating: false,
    assemblyList: [], categories: [], assemblyShields: new Map(),
    setRegion: vi.fn(), setChannel: vi.fn(), setFinishLevel: vi.fn(), clearSelections: vi.fn(),
    removeAssembly: vi.fn(), updateQuantity: vi.fn(), toggleAssembly: vi.fn(), setActiveCategory: vi.fn(),
    isSelected: vi.fn(), getQuantity: vi.fn(),
  };
}
function find(tree: ReactNode, match: (props: Record<string, any>) => boolean): ReactElement<Record<string, any>> {
  let found: ReactElement<Record<string, any>> | undefined;
  function visit(node: ReactNode) {
    if (found || !isValidElement<Record<string, any>>(node)) return;
    if (match(node.props)) { found = node; return; }
    Children.forEach(node.props.children, visit);
  }
  visit(tree);
  if (!found) throw new Error("Expected calculator control was not rendered");
  return found;
}
function render() {
  io.cursor = 0;
  const tree = CalculatorPage();
  return { tree, html: renderToStaticMarkup(tree) };
}
function choose(id: string) {
  const { tree } = render();
  find(tree, props => props.id === "calculator-project").props.onChange({ target: { value: id } });
  return render();
}
function search(value: string) {
  const { tree } = render();
  find(tree, props => props.id === "calculator-project-search").props.onChange({ target: { value } });
  return render();
}
function generate(tree: ReactNode) { find(tree, props => typeof props.onExport === "function").props.onExport(); }
function canGenerate(tree: ReactNode) { return find(tree, props => typeof props.onExport === "function").props.canExport; }

beforeEach(() => {
  vi.clearAllMocks(); io.slots = []; io.cursor = 0;
  io.auth.mockReturnValue({ isAuthenticated: true });
  io.query.mockReturnValue(settled());
  io.calc.mockReturnValue(calculation());
  io.mutation.mockReturnValue({ mutate: io.mutate, isPending: false });
});

describe("calculator existing-project formation", () => {
  it("requires an explicit choice even when the company has only one project", () => {
    const { tree, html } = render();
    expect(canGenerate(tree)).toBe(false);
    expect(html).toContain("Choose a project");
    generate(tree);
    expect(io.mutate).not.toHaveBeenCalled();
  });
  it("queries the existing tenant list only when authenticated", () => {
    render();
    expect(io.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }), expect.objectContaining({ enabled: true }));
    io.auth.mockReturnValue({ isAuthenticated: false });
    const { tree } = render();
    expect(io.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    generate(tree); expect(io.mutate).not.toHaveBeenCalled();
  });
  it("sends the exact chosen UUID with unchanged calculator input and no client/tenant authority", () => {
    const calc = calculation(); io.calc.mockReturnValue(calc);
    const before = { selections: structuredClone(calc.selections), batchResult: structuredClone(calc.batchResult) };
    const { tree } = choose(PROJECT);
    expect(canGenerate(tree)).toBe(true);
    generate(tree);
    expect(io.mutate).toHaveBeenCalledTimes(1);
    expect(io.mutate).toHaveBeenCalledWith({ selections: [{ assemblyId: ASSEMBLY, quantity: 2 }],
      context: { projectId: PROJECT, region: "charleston_metro", channel: "direct", finishLevel: "standard", notes: null } });
    expect(calc.selections).toEqual(before.selections);
    expect(calc.batchResult).toEqual(before.batchResult);
    expect(calc.setRegion).not.toHaveBeenCalled(); expect(calc.setChannel).not.toHaveBeenCalled();
    expect(calc.setFinishLevel).not.toHaveBeenCalled(); expect(calc.clearSelections).not.toHaveBeenCalled();
  });
  it("uses UUID identity when two projects have the same name", () => {
    io.query.mockReturnValue(settled([project(), project(OTHER)]));
    generate(choose(OTHER).tree);
    expect(io.mutate).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ projectId: OTHER }) }));
  });
  it("omits deleted projects and refuses a forged deleted selection callback", () => {
    io.query.mockReturnValue(settled([project(), project(OTHER, { name: "Deleted synthetic project", deletedAt: "2026-09-20" })]));
    expect(render().html).not.toContain("Deleted synthetic project");
    const { tree } = choose(OTHER);
    expect(canGenerate(tree)).toBe(false); generate(tree); expect(io.mutate).not.toHaveBeenCalled();
  });
  it.each(["", "not-a-uuid", "00000000-0000-0000-0000-000000000000", OTHER])(
    "refuses unavailable or invalid selected identity %j", value => {
      const { tree } = choose(value);
      expect(canGenerate(tree)).toBe(false); generate(tree); expect(io.mutate).not.toHaveBeenCalled();
    }
  );
  it.each([
    ["loading", { isLoading: true }], ["pending", { isPending: true }],
    ["refreshing", { isFetching: true }], ["failure", { isError: true, error: new Error("private DB details") }],
  ] as const)("withholds generation while projects are %s even with stale selected data", (_name, patch) => {
    choose(PROJECT); io.query.mockReturnValue(settled([project()], patch));
    const { tree, html } = render();
    expect(canGenerate(tree)).toBe(false); generate(tree); expect(io.mutate).not.toHaveBeenCalled();
    expect(html).not.toContain("private DB details");
  });
  it("shows an empty-result state and refuses a selection removed by refresh", () => {
    choose(PROJECT); io.query.mockReturnValue(settled([]));
    const { tree, html } = render();
    expect(html).toContain("No projects found");
    expect(canGenerate(tree)).toBe(false); generate(tree); expect(io.mutate).not.toHaveBeenCalled();
  });
  it("searches on the server beyond the first 100 and requires a new explicit selection", () => {
    io.query.mockReturnValue(settled([project()], { data: { items: [project()], total: 101 } }));
    choose(PROJECT);
    let view = search("Another job");
    expect(io.query).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Another job", limit: 100 }), expect.anything());
    expect(canGenerate(view.tree)).toBe(false);
    io.query.mockReturnValue(settled([project(OTHER, { name: "Another job" })]));
    view = render(); expect(canGenerate(view.tree)).toBe(false);
    generate(choose(OTHER).tree);
    expect(io.mutate).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ projectId: OTHER }) }));
  });
  it("keeps a project without a linked client as a draft-only choice without inventing a client", () => {
    io.query.mockReturnValue(settled([project(PROJECT, { clientId: null })]));
    generate(choose(PROJECT).tree);
    expect(io.mutate).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ projectId: PROJECT }) }));
    expect(io.mutate.mock.calls[0][0].context).not.toHaveProperty("clientId");
  });
  it("prevents another submission while the mutation is pending", () => {
    choose(PROJECT); io.mutation.mockReturnValue({ mutate: io.mutate, isPending: true });
    const { tree } = render(); expect(canGenerate(tree)).toBe(false);
    generate(tree); expect(io.mutate).not.toHaveBeenCalled();
    expect(find(tree, props => props.id === "calculator-project").props.disabled).toBe(true);
  });
  it.each(["canExport", "calculating", "recalculating"] as const)("preserves calculator readiness gate %s", key => {
    choose(PROJECT);
    io.calc.mockReturnValue({ ...calculation(), [key]: key === "canExport" ? false : true });
    const { tree } = render(); expect(canGenerate(tree)).toBe(false);
    generate(tree); expect(io.mutate).not.toHaveBeenCalled();
  });
  it("shows a server permission denial without clearing the project or calculation", () => {
    choose(PROJECT);
    const options = io.mutation.mock.calls.at(-1)![0];
    options.onError(new Error("Project access withdrawn."));
    expect(io.error).toHaveBeenCalledWith("Project access withdrawn.");
    expect(find(render().tree, props => props.id === "calculator-project").props.value).toBe(PROJECT);
    expect(io.calc.mock.results[0].value.clearSelections).not.toHaveBeenCalled();
  });
});
