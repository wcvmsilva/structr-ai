/** Real estimate markup and expand callbacks with synthetic transport.
 * Only page-owned useState is captured. Descendant hooks use React's SSR
 * dispatcher; explicit rerenders do not claim browser scheduling or hydration.
 */
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEstimateVersionPreviewV2, projectEstimateVersionDraftV2 } from "../shared/estimate-version-engine";
import { approvalIds as ids, makeInternalApprovalSnapshot } from "./internal-estimate-approval-engine.fixtures";

const io = vi.hoisted(() => ({
  list: vi.fn(), draft: vi.fn(), shield: vi.fn(), authorization: vi.fn(), printable: vi.fn(),
  mutation: vi.fn(), mutate: vi.fn(), preflight: vi.fn(), navigate: vi.fn(),
  slots: [] as unknown[], cursor: 0, capture: false,
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState(initial: unknown) {
    if (!io.capture) return actual.useState(initial);
    const index = io.cursor++;
    if (!(index in io.slots)) io.slots[index] = typeof initial === "function" ? initial() : initial;
    return [io.slots[index], (value: unknown) => {
      io.slots[index] = typeof value === "function" ? value(io.slots[index]) : value;
    }];
  } };
});
vi.mock("@/lib/trpc", () => ({ trpc: {
  estimate: {
    list: { useQuery: io.list }, getById: { useQuery: io.draft },
    profitShield: { useQuery: io.shield }, exportAuthorization: { useQuery: io.authorization },
    exportPrintable: { useQuery: io.printable }, exportPreflight: { useMutation: io.preflight },
    exportPdf: { useMutation: io.mutation }, exportJson: { useMutation: io.mutation }, exportCsv: { useMutation: io.mutation },
    approveEstimate: { useMutation: io.mutation }, rejectEstimate: { useMutation: io.mutation }, updateStatus: { useMutation: io.mutation },
  },
  issueReport: { create: { useMutation: io.mutation } },
  useUtils: () => ({ estimate: {
    getById: { invalidate: vi.fn() }, profitShield: { invalidate: vi.fn() },
    exportAuthorization: { invalidate: vi.fn() }, list: { invalidate: vi.fn() },
  } }),
} }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("wouter", () => ({ useRoute: () => [true, { id: CHILD }], useLocation: () => ["/estimate", io.navigate] }));
import EstimatePage from "../client/src/pages/Estimate";
import EstimateDetailPage from "../client/src/pages/EstimateDetail";

const CHILD = "e7100000-0000-4000-8000-000000000001";
const OTHER = "e7100000-0000-4000-8000-000000000002";
type Row = Record<string, any>;
let original: Row;
const settled = (data: unknown) => ({ data, error: null, isError: false, isPending: false,
  isLoading: false, isFetching: false, isPaused: false, isSuccess: true });
function input(patch: Row = {}): Row { return { ...structuredClone(original), ...patch }; }
function legacy(patch: Row = {}): Row {
  return input({ a1VersionRequestId: null, a1VersionRequestHash: null, source: "assembly_calculator", ...patch });
}
function provide(row: Row, otherRows: Row[] = []) {
  io.draft.mockReturnValue(settled(row)); io.list.mockReturnValue(settled({ items: [row, ...otherRows] }));
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function button(tree: ReactNode, id: string): ReactElement<{ onClick: () => void }> {
  let found: ReactElement<{ onClick: () => void }> | undefined;
  function visit(node: ReactNode) {
    if (found || !isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
    if (node.type === "button" && typeof node.props.onClick === "function" && text(node).includes(`#${id}`)) {
      found = node as ReactElement<{ onClick: () => void }>; return;
    }
    Children.forEach(node.props.children, visit);
  }
  Children.forEach(tree, visit);
  if (!found) throw new Error("Expected the real estimate header button");
  return found;
}
function list() {
  io.cursor = 0; io.capture = true;
  let tree: ReactNode;
  try { tree = EstimatePage(); } finally { io.capture = false; }
  return { tree, html: renderToStaticMarkup(tree) };
}
function expand(id = CHILD) {
  const before = list(); button(before.tree, id).props.onClick(); return list();
}
const detail = () => renderToStaticMarkup(createElement(EstimateDetailPage));
function rowHtml(html: string, label: string) {
  return html.match(new RegExp(`<tr[^>]*><td[^>]*>${label}[\\s\\S]*?</tr>`))?.[0] ?? "";
}
function metric(html: string, label: string, value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(html).toMatch(new RegExp(`${label}</p><p[^>]*>${escaped}</p>`));
}
function totals(row: Row, price: string, cost: string, discount = "0.00") {
  row.subtotalPrice = price; row.subtotalCost = cost; row.discountAmount = discount;
  row.finalTotalPrice = price; row.discountApplied = discount !== "0.00";
  row.lineItems[0].lineTotalPrice = price; row.lineItems[0].lineTotalCost = cost;
  return row;
}

beforeAll(async () => {
  const snapshot = makeInternalApprovalSnapshot();
  const content = { ...snapshot, version: "estimate-version-copy-source-v2",
    financials: { ...snapshot.financials, currencyBasis: "version_request_confirmation" },
    copyProjection: { assemblyCount: 1, directZone: null } };
  const command = { version: "estimate-version-preview-command-v2", sourceKind: "current_draft",
    sourceDraftId: ids.draft, confirmedCurrencyCode: "USD" };
  const preview = await buildEstimateVersionPreviewV2({ command, content, sourceApprovalId: null, sourceApprovalState: null });
  original = await projectEstimateVersionDraftV2({ preview,
    command: { ...command, version: "estimate-version-command-v2", requestId: ids.request,
      expectedSourceVersion: 1, expectedSourceContentHash: preview.sourceContentHash, name: null, reason: "Synthetic UI version review" },
    context: { tenantId: ids.tenant, actorId: ids.actor, projectId: ids.project, clientId: ids.client },
    allocation: { id: CHILD, version: 2, timestamp: "2026-09-20T12:00:00.000Z" } });
});
beforeEach(() => {
  vi.clearAllMocks(); io.slots = []; io.cursor = 0; io.capture = false;
  provide(input());
  io.shield.mockReturnValue(settled(undefined));
  io.authorization.mockReturnValue(settled({ authorized: false, reason: "Synthetic export denial" }));
  io.printable.mockReturnValue(settled(undefined));
  io.mutation.mockReturnValue({ mutate: io.mutate, isPending: false });
  io.preflight.mockReturnValue({ mutate: io.mutate, isPending: false });
});

describe("real list expansion callbacks", () => {
  it("opens the projected string rows and closes them through the actual header", () => {
    const first = list(); expect(first.html).not.toContain("Synthetic shelf");
    button(first.tree, CHILD).props.onClick();
    const opened = list(); const line = rowHtml(opened.html, "Synthetic shelf");
    expect(line).toContain("$100.00"); expect(line).toContain("60.00%");
    button(opened.tree, CHILD).props.onClick(); expect(list().html).not.toContain("Synthetic shelf");
    expect(io.mutate).not.toHaveBeenCalled(); expect(io.preflight).not.toHaveBeenCalled();
  });
  it("switches between same-name legacy and v2 rows by their real UUID buttons", () => {
    const old = legacy({ id: OTHER }); old.lineItems[0].costItemName = "Legacy separate line";
    provide(input(), [old]);
    expect(expand().html).toContain("Synthetic shelf");
    const view = list(); button(view.tree, OTHER).props.onClick(); const next = list().html;
    expect(next).toContain("Legacy separate line"); expect(next).not.toContain("Synthetic shelf");
    expect(rowHtml(next, "Legacy separate line")).toContain("60.0%");
  });
});

describe.each([["collapsed", () => list().html], ["expanded", () => expand().html]] as const)("%s list pricing metadata", (_, render) => {
  it("does not show a raw channel from an invalid v2 representation", () => {
    provide(input({ a1VersionRequestHash: null, channel: "UNREVIEWED_LIST_CHANNEL_C1" }));
    expect(render()).not.toContain("UNREVIEWED_LIST_CHANNEL_C1");
  });
  it("uses the known stored pricing channel instead of the direct raw column", () => {
    const row = input({ channel: "UNREVIEWED_LIST_CHANNEL_C1" });
    row.pricingSnapshot.channel = "insurance"; provide(row);
    const html = render(); expect(html).toContain(">insurance</span>");
    expect(html).not.toContain("UNREVIEWED_LIST_CHANNEL_C1");
  });
  it("keeps a null stored pricing channel unavailable without falling back to the raw column", () => {
    const row = input({ channel: "UNREVIEWED_LIST_CHANNEL_C1" });
    row.pricingSnapshot.channel = null; provide(row);
    const html = render(); expect(html).toContain(">Unavailable</span>");
    expect(html).not.toContain("UNREVIEWED_LIST_CHANNEL_C1");
  });
  it("preserves the legacy raw channel display", () => {
    provide(legacy({ channel: "LEGACY_LIST_CHANNEL_C1" }));
    expect(render()).toContain(">LEGACY_LIST_CHANNEL_C1</span>");
  });
});

describe.each([["collapsed list", () => list().html], ["expanded list", () => expand().html], ["detail", detail]] as const)("%s exact current summary", (surface, render) => {
  it("preserves the twentieth minor digit instead of rounding through Number", () => {
    provide(totals(input(), "999999999999999999.99", "0.00"));
    const html = render(); expect(html).toContain("$999,999,999,999,999,999.99");
    expect(html).not.toContain("1,000,000,000,000,000,000.00");
  });
  it("derives current GP after a discount rather than displaying stale stored margins", () => {
    const row = input({ finalTotalPrice: "80.00", discountAmount: "20.00", discountApplied: true,
      grossProfit: "999.00", grossProfitPct: "99.00" }); provide(row);
    const html = render(); expect(html).toContain("50.00%"); expect(html).not.toContain("99.0%");
    if (surface !== "collapsed list") expect(html).toContain("$40.00");
  });
  it("keeps a zero-price current record readable while its margin is undefined", () => {
    provide(totals(input(), "0.00", "0.00")); const html = render();
    expect(html).toContain("$0.00"); metric(html, surface === "detail" ? "GP %" : "GP", "Unavailable");
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
  });
  it("retains exact negative GP and two-decimal rounding for v2", () => {
    provide(totals(input(), "0.32", "0.33"));
    const html = render(); expect(html).toContain("-3.13%");
    if (surface !== "collapsed list") expect(html).toContain("-$0.01");
  });
  it("does not reinterpret a partial version marker as a legacy amount", () => {
    provide(input({ a1VersionRequestHash: null })); const html = render();
    expect(html).toContain("Estimate values unavailable");
    metric(html, surface === "detail" ? "Final Total" : "Final Price", "Unavailable");
    expect(html).not.toContain("$100.00");
  });
});

describe.each([["expanded list", () => expand().html], ["detail", detail]] as const)("%s projected line presentation", (_, render) => {
  it("preserves six rate decimals and all fourteen quantity whole digits", () => {
    const row = input(); row.lineItems[0].unitPriceSnapshot = "0.000001";
    row.lineItems[0].quantity = "99999999999999.999999"; provide(row);
    const line = rowHtml(render(), "Synthetic shelf");
    expect(line).toContain("$0.000001"); expect(line).toContain("99999999999999.999999");
  });
  it("uses explicit cost and price pairs with no legacy GP field requirement", () => {
    const row = input(); expect(row.lineItems[0]).not.toHaveProperty("grossProfitPct"); provide(row);
    expect(rowHtml(render(), "Synthetic shelf")).toContain("60.00%");
  });
  it("escapes stored labels while preserving their exact text", () => {
    const row = input(); row.lineItems[0].costItemName = '<script>synthetic</script>'; provide(row);
    const html = render(); expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("preserves known legacy zeroes and marks missing cost-derived margins unavailable", () => {
    const row = legacy(); row.lineItems[0] = { costItemName: "Legacy zero line", quantity: 0,
      unit: "EA", unitPriceSnapshot: 0, lineTotalPrice: "0.00", grossProfitPct: 99 }; provide(row);
    const line = rowHtml(render(), "Legacy zero line");
    expect(line).toContain("$0.00"); expect(line).toContain("Unavailable"); expect(line).not.toContain("99.0%");
  });
  it("distinguishes unavailable legacy line collections from a known empty array", () => {
    provide(legacy({ lineItems: null })); expect(render()).toContain("Line items unavailable");
    io.slots = []; provide(legacy({ lineItems: [] })); expect(render()).not.toContain("Line items unavailable");
  });
  it("does not render partial financial success from a v2 row with extra line keys", () => {
    const row = input(); row.lineItems[0].grossProfitPct = 60; provide(row);
    const html = render(); expect(html).toContain("Estimate values unavailable"); expect(html).not.toContain("$100.00");
  });
});

describe("actual detail selection, context and historical boundaries", () => {
  it("keeps unknown selection rate/extension distinct from a known zero", () => {
    const row = input(); Object.assign(row.assemblySelections[0], { unitCost: null, unitPrice: "0", extendedCost: null, extendedPrice: "0.00" });
    provide(row); const assembly = rowHtml(detail(), "Synthetic assembly");
    expect(assembly.match(/Unavailable/g)).toHaveLength(2);
    expect(assembly.match(/\$0\.00/g)).toHaveLength(2); expect(assembly).not.toContain("NaN");
  });
  it("distinguishes unknown selections from a known empty legacy collection", () => {
    provide(legacy({ assemblySelections: null })); expect(detail()).toContain("Assembly selections unavailable");
    provide(legacy({ assemblySelections: [] })); expect(detail()).not.toContain("Assembly selections unavailable");
  });
  it("shows the stored eight-field context without inventing provenance or defaults", () => {
    const row = input({ pricingSchemaVersion: null, scopeDraftId: null });
    row.pricingSnapshot = { channel: null, finishLevel: null, region: null, zone: null, trade: null,
      coastalModifier: null, commercialChannel: null, geoRiskClass: null };
    provide(row); const html = detail();
    expect(html).toContain("Stored pricing context"); expect(html).toContain("does not verify policy, geography or approval");
    expect(html).not.toContain("Coastal Modifier</p><p>1.0");
  });
  it("does not fabricate v1.0 in the metadata row when the v2 schema is null", () => {
    provide(input({ pricingSchemaVersion: null }));
    expect(detail()).not.toContain(" v1.0</span>");
  });
  it("shows the actual known v2 schema in the metadata row", () => {
    provide(input({ pricingSchemaVersion: "2.7" }));
    expect(detail()).toContain(" v2.7</span>");
  });
  it("retains the legacy metadata fallback without applying it to a v2 record", () => {
    provide(legacy({ pricingSchemaVersion: null }));
    expect(detail()).toContain(" v1.0</span>");
  });
  it("does not display raw pricing or scope metadata from an invalid v2 record", () => {
    provide(input({ a1VersionRequestHash: null, region: "UNREVIEWED_REGION_C1", channel: "UNREVIEWED_CHANNEL_C1",
      finishLevel: "UNREVIEWED_FINISH_C1", pricingSchemaVersion: "UNREVIEWED_SCHEMA_C1", scopeDraftId: OTHER }));
    const html = detail();
    for (const value of ["UNREVIEWED_REGION_C1", "UNREVIEWED_CHANNEL_C1", "UNREVIEWED_FINISH_C1", "UNREVIEWED_SCHEMA_C1", `Scope #${OTHER}`]) {
      expect(html).not.toContain(value);
    }
  });
  it.each([
    ["source", { source: "historical_import", historicalImportId: null }],
    ["relation", { source: "version", historicalImportId: OTHER }],
  ])("preserves H1 dispatch by %s before any calculated money renderer", (_, fields) => {
    provide(input(fields)); const html = detail();
    expect(html).toContain("Historical estimate"); expect(html).toContain("Approval, export and field execution are unavailable");
    expect(html).not.toContain("Financial Summary"); expect(html).not.toContain("$100.00");
    expect(html).not.toContain("Stored pricing context");
    expect(io.shield).toHaveBeenCalledWith({ id: CHILD }, { enabled: false });
    expect(io.authorization).toHaveBeenCalledWith({ id: CHILD }, { enabled: false });
    expect(io.mutate).not.toHaveBeenCalled();
  });
  it("keeps current export denial after successful exact display", () => {
    const html = detail(); expect(html).toContain("Synthetic export denial");
    for (const name of ["PDF", "JSON", "JobTread CSV"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>[\\s\\S]*?${name}</button>`));
    }
    expect(io.mutate).not.toHaveBeenCalled();
  });
  it("does not mutate source strings, unknowns or arrays during either rendering path", () => {
    const row = input(); row.assemblySelections[0].extendedCost = null;
    const before = structuredClone(row); provide(row); expand(); detail();
    expect(row).toEqual(before); expect(io.mutate).not.toHaveBeenCalled();
  });
});
