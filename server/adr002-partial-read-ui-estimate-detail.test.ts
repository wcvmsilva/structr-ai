/** Real page markup/query options and live handler behavior at the transport boundary.
 * Page-owned hooks are controlled to reproduce open dialogs and mode transitions;
 * descendant components render with React SSR. This is not a browser scheduling proof.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { freezeIntent } from "../client/src/lib/decision-intent";
import { ESTIMATE_VERSION_PROTOCOL_V2 } from "../shared/domain/taxonomy";

// ───────────────────────── Handler-level extraction ─────────────────────────

const fileUrl = new URL("../client/src/pages/EstimateDetail.tsx", import.meta.url);
const source = readFileSync(fileUrl, "utf8");
const ast = ts.createSourceFile("EstimateDetail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map<string, string>();
const stateNames: string[] = [];
function visit(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    functions.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(ast)};`);
  }
  // Baseline reject/reopen callbacks are inline. Exercise that exact source,
  // then the extracted named handler when the implementation moves it.
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onClick" && node.initializer &&
      ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) {
    const expression = node.initializer.expression.getText(ast);
    for (const [name, mutation] of [["submitReject", "rejectEstimate.mutate("], ["submitReopen", "reopenEstimate.mutate("]]) {
      if (expression.includes(mutation)) functions.set(name, `const ${name} = ${expression};`);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "EstimateDetailPage") as ts.FunctionDeclaration;
function collectStates(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useState") {
    stateNames.push(node.name.elements[0].getText(ast));
  }
  ts.forEachChild(node, collectStates);
}
collectStates(page.body!);
function liveFunction(name: string, scope: Record<string, unknown>): (...args: unknown[]) => unknown {
  const functionSource = functions.get(name);
  if (!functionSource) throw new Error(`Missing page function ${name}`);
  const js = ts.transpileModule(functionSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn ${name};`)(...Object.values(scope)) as (...args: unknown[]) => unknown;
}

describe("EstimateDetail.tsx — write handlers never fire while estimateReadOnly, real handlers preserved otherwise", () => {
  it("submitReject: no-op when estimateReadOnly, mutates when not", () => {
    const rejectEstimate = { mutate: vi.fn() };
    const draft = { id: "d1" };
    liveFunction("submitReject", { estimateReadOnly: true, draft, rejectEstimate, rejectReason: "a valid reason" })();
    expect(rejectEstimate.mutate).not.toHaveBeenCalled();
    liveFunction("submitReject", { estimateReadOnly: false, draft, rejectEstimate, rejectReason: "a valid reason" })();
    expect(rejectEstimate.mutate).toHaveBeenCalledWith({ id: "d1", reason: "a valid reason" });
  });

  it("submitReopen: no-op when estimateReadOnly, mutates when not", () => {
    const reopenEstimate = { mutate: vi.fn() };
    const draft = { id: "d1" };
    liveFunction("submitReopen", { estimateReadOnly: true, draft, reopenEstimate })();
    expect(reopenEstimate.mutate).not.toHaveBeenCalled();
    liveFunction("submitReopen", { estimateReadOnly: false, draft, reopenEstimate })();
    expect(reopenEstimate.mutate).toHaveBeenCalledWith({ id: "d1", status: "draft" });
  });

  it("submitApprove: no-op when estimateReadOnly even with a fully valid, passing review", () => {
    const approveMutation = { mutate: vi.fn() };
    const approveReview = {
      contentHash: "hash", policyHash: "policy", evaluation: { passed: true },
      snapshot: { identity: { estimateDraftId: "d1", draftVersion: 3 } },
    };
    const scope = {
      estimateReadOnly: true, approveReview, approveUsdConfirmed: true, approveReason: "a valid reason",
      freezeIntent, approveIntentRef: { current: null }, currentVisitRef: { current: { generation: 1 } }, approveMutation,
    };
    liveFunction("submitApprove", scope)();
    expect(approveMutation.mutate).not.toHaveBeenCalled();
    liveFunction("submitApprove", { ...scope, estimateReadOnly: false, approveIntentRef: { current: null } })();
    expect(approveMutation.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", expectedDraftVersion: 3 }), expect.anything());
  });

  it("submitRevoke: no-op when estimateReadOnly even with an active approval and valid reason", () => {
    const revokeMutation = { mutate: vi.fn() };
    const internalApproval = { state: "active", approval: { id: "a1", estimateDraftId: "d1" }, snapshot: { contentHash: "hash" } };
    const scope = {
      estimateReadOnly: true, internalApproval, revokeReason: "a valid reason", freezeIntent,
      revokeIntentRef: { current: null }, currentVisitRef: { current: { generation: 1 } }, revokeMutation,
    };
    liveFunction("submitRevoke", scope)();
    expect(revokeMutation.mutate).not.toHaveBeenCalled();
    liveFunction("submitRevoke", { ...scope, estimateReadOnly: false, revokeIntentRef: { current: null } })();
    expect(revokeMutation.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", approvalId: "a1" }), expect.anything());
  });

  it("submitCreateVersion: no-op when estimateReadOnly even with a fully valid current_draft preview", () => {
    const createVersionMutation = { mutate: vi.fn() };
    const versionPreview = { sourceVersion: 5, sourceContentHash: "hash" };
    const scope = {
      estimateReadOnly: true, versionPreview, estimateId: "d1", createVersionSourceKind: "current_draft" as const,
      createVersionReason: "a valid reason", createVersionUsdConfirmed: true, freezeIntent,
      createVersionIntentRef: { current: null }, currentVisitRef: { current: { generation: 1 } },
      createVersionMutation, ESTIMATE_VERSION_PROTOCOL_V2,
    };
    liveFunction("submitCreateVersion", scope)();
    expect(createVersionMutation.mutate).not.toHaveBeenCalled();
    liveFunction("submitCreateVersion", { ...scope, estimateReadOnly: false, createVersionIntentRef: { current: null } })();
    expect(createVersionMutation.mutate).toHaveBeenCalledWith(expect.objectContaining({ sourceDraftId: "d1", sourceKind: "current_draft" }), expect.anything());
  });

  it("redownloadFrom: no-op when estimateReadOnly, mutates when not", () => {
    const redownload = { mutate: vi.fn() };
    const scope = { estimateReadOnly: true, currentVisitRef: { current: { generation: 1 } }, redownload };
    liveFunction("redownloadFrom", scope)("export-1");
    expect(redownload.mutate).not.toHaveBeenCalled();
    liveFunction("redownloadFrom", { ...scope, estimateReadOnly: false })("export-1");
    expect(redownload.mutate).toHaveBeenCalledWith({ exportId: "export-1" }, expect.anything());
  });

  it("runExportJson: no-op when estimateReadOnly, mutates when not", () => {
    const deliverJsonExport = { mutate: vi.fn() };
    const scope = { estimateReadOnly: true, currentVisitRef: { current: { generation: 1 } }, deliverJsonExport, estimateId: "d1" };
    liveFunction("runExportJson", scope)();
    expect(deliverJsonExport.mutate).not.toHaveBeenCalled();
    liveFunction("runExportJson", { ...scope, estimateReadOnly: false })();
    expect(deliverJsonExport.mutate).toHaveBeenCalledWith({ id: "d1" }, expect.anything());
  });

  it("runExportCsv: no-op when estimateReadOnly, mutates when not", () => {
    const deliverCsvExport = { mutate: vi.fn() };
    const scope = { estimateReadOnly: true, currentVisitRef: { current: { generation: 1 } }, deliverCsvExport, estimateId: "d1" };
    liveFunction("runExportCsv", scope)();
    expect(deliverCsvExport.mutate).not.toHaveBeenCalled();
    liveFunction("runExportCsv", { ...scope, estimateReadOnly: false })();
    expect(deliverCsvExport.mutate).toHaveBeenCalledWith({ id: "d1" }, expect.anything());
  });

  it("handleReportSubmit: no-op when estimateReadOnly even with a fully valid report, mutates when not (MICHAEL-UI-REVIEW-CHECKPOINTS.md: issueReport.create is also a write, not one of the three allowed reads)", () => {
    const reportIssue = { mutate: vi.fn() };
    const draft = { id: "d1", bundleName: "b", pricingSchemaVersion: 1, channel: "direct", finishLevel: "standard", region: "Charleston", finalTotalPrice: "100.00" };
    const scope = {
      estimateReadOnly: true, draft, reportIssue,
      reportCategory: "pricing_mismatch", reportSeverity: "medium", reportTitle: "A title", reportDescription: "A description long enough",
    };
    liveFunction("handleReportSubmit", scope)();
    expect(reportIssue.mutate).not.toHaveBeenCalled();
    liveFunction("handleReportSubmit", { ...scope, estimateReadOnly: false })();
    expect(reportIssue.mutate).toHaveBeenCalledWith(expect.objectContaining({ entityType: "estimate_draft", entityId: NaN }));
  });
});

describe("all export handlers enforce the read-only presentation boundary", () => {
  it.each([
    ["runExportPdf", "deliverExport"], ["runExportPrintable", "deliverPrintable"],
    ["runValidateCsv", "validateCsv"], ["runExportPreflight", "runPreflight"],
  ])("%s does not send a request when restricted, preserving explicit full-mode behavior", (handler, dependency) => {
    const mutate = vi.fn();
    const scope = { estimateReadOnly: true, estimateId: "draft-id", preflightFormat: "csv_jobtread",
      currentVisitRef: { current: { generation: 1 } }, [dependency]: { mutate } };
    liveFunction(handler, scope)();
    expect(mutate).not.toHaveBeenCalled();
    liveFunction(handler, { ...scope, estimateReadOnly: false })();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(handler === "runExportPreflight"
      ? { id: "draft-id", format: "csv_jobtread" } : { id: "draft-id" }, expect.anything());
  });
});

// ───────────────────────────── Rendered page ─────────────────────────────

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  list: vi.fn(), draft: vi.fn(), shield: vi.fn(), authorization: vi.fn(), session: vi.fn(),
  mutation: vi.fn(), mutate: vi.fn(), preflight: vi.fn(), route: vi.fn(),
  invalidateDraft: vi.fn(), invalidateShield: vi.fn(), invalidateAuthorization: vi.fn(), invalidateList: vi.fn(),
  approve: vi.fn(), reject: vi.fn(), reopen: vi.fn(),
  exportHistory: vi.fn(), exportDetail: vi.fn(), redownload: vi.fn(),
  internalApproval: vi.fn(), internalApprovalReview: vi.fn(), versionPreview: vi.fn(), revoke: vi.fn(), createVersion: vi.fn(),
}));
const host = vi.hoisted(() => ({
  capture: false, cursor: 0, stateCursor: 0, values: [] as any[],
  states: new Map<string, number>(), effects: [] as Array<() => unknown>,
}));
vi.mock("react", async original => {
  const real = await original<typeof import("react")>();
  return { ...real,
    useState(initial: unknown) {
      if (!host.capture) return real.useState(initial);
      const index = host.cursor++;
      host.states.set(stateNames[host.stateCursor++], index);
      if (!(index in host.values)) host.values[index] = typeof initial === "function" ? initial() : initial;
      return [host.values[index], (value: unknown) => {
        host.values[index] = typeof value === "function" ? value(host.values[index]) : value;
      }];
    },
    useRef(initial: unknown) {
      if (!host.capture) return real.useRef(initial);
      const index = host.cursor++;
      return host.values[index] ??= { current: initial };
    },
    useEffect(effect: () => unknown, deps: unknown[]) {
      if (!host.capture) return real.useEffect(effect as any, deps);
      const index = host.cursor++;
      const before = host.values[index];
      if (!before || deps.some((value, at) => !Object.is(value, before[at]))) {
        host.values[index] = deps;
        host.effects.push(effect);
      }
    },
  };
});
vi.mock("@/lib/trpc", () => ({ trpc: {
  auth: { session: { useQuery: mocks.session } },
  estimate: {
    list: { useQuery: mocks.list }, getById: { useQuery: mocks.draft },
    profitShield: { useQuery: mocks.shield }, exportAuthorization: { useQuery: mocks.authorization },
    exportPrintable: { useMutation: mocks.preflight }, exportPreflight: { useMutation: mocks.preflight },
    validateCsvExport: { useMutation: mocks.preflight },
    exportPdf: { useMutation: mocks.mutation }, exportJson: { useMutation: mocks.mutation }, exportCsv: { useMutation: mocks.mutation },
    approveEstimate: { useMutation: mocks.approve }, rejectEstimate: { useMutation: mocks.reject }, updateStatus: { useMutation: mocks.reopen },
    listExports: { useQuery: mocks.exportHistory }, getExportDetail: { useQuery: mocks.exportDetail },
    downloadExport: { useMutation: mocks.redownload },
    getInternalApproval: { useQuery: mocks.internalApproval }, getInternalApprovalReview: { useQuery: mocks.internalApprovalReview },
    getEstimateVersionPreview: { useQuery: mocks.versionPreview },
    revokeInternalApproval: { useMutation: mocks.revoke }, createVersion: { useMutation: mocks.createVersion },
  },
  issueReport: { create: { useMutation: mocks.mutation } },
  useUtils: () => ({ estimate: {
    getById: { invalidate: mocks.invalidateDraft }, profitShield: { invalidate: mocks.invalidateShield },
    exportAuthorization: { invalidate: mocks.invalidateAuthorization }, list: { invalidate: mocks.invalidateList },
    listExports: { invalidate: vi.fn(async () => {}) },
    getInternalApproval: { invalidate: vi.fn(async () => {}) }, getInternalApprovalReview: { invalidate: vi.fn(async () => {}) }, getEstimateVersionPreview: { invalidate: vi.fn(async () => {}) },
  } }),
} }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("wouter", () => ({ useRoute: mocks.route, useLocation: () => ["/estimates/test", mocks.navigate] }));
import EstimateDetailPage from "../client/src/pages/EstimateDetail";

const ID = "d2700000-0000-4000-8000-000000000001";
const draft = {
  id: ID, bundleName: "Partial-read fixture", status: "draft", projectId: "p1", createdAt: "2026-09-18T18:00:00Z",
  subtotalCost: "900.00", subtotalPrice: "1500.00", finalTotalPrice: "1200.00",
  grossProfit: "300.00", grossProfitPct: "25.00", discountAmount: "300.00", discountApplied: true,
  profitShieldPassed: null, profitShieldMinPct: null, lineItems: [], assemblySelections: [], metadata: {},
};
function settled<T>(data: T) {
  return { data, error: null, isError: false, isPending: false, isLoading: false, isFetching: false, isPaused: false, isSuccess: true };
}
function unsettled(overrides: Partial<ReturnType<typeof settled<undefined>>> = {}) {
  return { data: undefined, error: null, isError: false, isPending: true, isLoading: true, isFetching: true, isPaused: false, isSuccess: false, ...overrides };
}
const render = () => renderToStaticMarkup(createElement(EstimateDetailPage));

beforeEach(() => {
  vi.resetAllMocks();
  host.capture = false; host.cursor = 0; host.stateCursor = 0; host.values = []; host.states.clear(); host.effects = [];
  mocks.route.mockReturnValue([true, { id: ID }]);
  mocks.draft.mockReturnValue(settled(draft));
  mocks.session.mockReturnValue(settled({ provider: "supabase", authenticated: true, supabase: null, estimateReadOnly: false }));
  mocks.shield.mockReturnValue(unsettled());
  mocks.authorization.mockReturnValue(unsettled());
  mocks.exportHistory.mockReturnValue(unsettled());
  mocks.exportDetail.mockReturnValue(settled(undefined));
  mocks.internalApproval.mockReturnValue(settled({ state: "none", approval: null, snapshot: null, revocation: null }));
  mocks.internalApprovalReview.mockReturnValue(settled(undefined));
  mocks.versionPreview.mockReturnValue(settled(undefined));
  for (const hook of [mocks.mutation, mocks.approve, mocks.reject, mocks.reopen, mocks.preflight, mocks.redownload, mocks.revoke, mocks.createVersion]) {
    hook.mockReturnValue({ mutate: mocks.mutate, isPending: false });
  }
});

describe("estimateReadOnly=false (existing behavior, unchanged)", () => {
  it("keeps every suspendable query enabled", () => {
    render();
    expect(mocks.shield).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: true }));
    expect(mocks.authorization).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: true }));
    expect(mocks.exportHistory).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: true }));
  });
  it("renders the real Approve trigger, Create New Version, export action buttons, and Report Issue", () => {
    const html = render();
    expect(html).toContain(">Approve<");
    expect(html).toContain("Create New Version");
    expect(html).toContain(">PDF<");
    expect(html).toContain("JobTread CSV");
    expect(html).toContain("Run Preflight");
    expect(html).toContain("View project costs");
    expect(html).toContain("Report Issue");
    expect(html).not.toContain("View approval review");
    expect(html).not.toContain("Read-only view:");
  });
});

describe("estimateReadOnly=true (CODEX-UI-RESERVATION.md)", () => {
  beforeEach(() => {
    mocks.session.mockReturnValue(settled({ provider: "supabase", authenticated: true, supabase: null, estimateReadOnly: true }));
  });

  it("suspends automatic profitShield/exportAuthorization/listExports query options", () => {
    render();
    expect(mocks.shield).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
    expect(mocks.authorization).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
    expect(mocks.exportHistory).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
  });

  it("keeps getById and getInternalApproval enabled — the two allowed reads", () => {
    render();
    expect(mocks.draft).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: true }));
    expect(mocks.internalApproval).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: true }));
  });

  it("shows explicit unavailability for the suspended surfaces instead of an infinite 'Verifying…' or silent empty state", () => {
    const html = render();
    expect(html).toContain("Stored pricing check unavailable in this read-only view.");
    expect(html).toContain("Export authorization and export history are unavailable in this read-only view.");
    expect(html).toContain("Export actions are unavailable in this read-only view.");
    expect(html).not.toContain("Verifying stored pricing check");
  });

  it("shows the short partial-scope explanation banner", () => {
    const html = render();
    expect(html).toContain("Read-only view:");
  });

  it("hides every write trigger: Create New Version, export action buttons, the project costs link, and Report Issue", () => {
    const html = render();
    expect(html).not.toContain("Create New Version");
    expect(html).not.toContain(">PDF<");
    expect(html).not.toContain(">JSON<");
    expect(html).not.toContain("JobTread CSV");
    expect(html).not.toContain("Run Preflight");
    expect(html).not.toContain("Validate CSV");
    expect(html).not.toContain("View project costs");
    expect(html).not.toContain("Report Issue");
  });

  it("relabels the Approve trigger to 'View approval review' instead of hiding the review entirely", () => {
    const html = render();
    expect(html).toContain("View approval review");
    expect(html).not.toContain(">Approve<");
  });

  it("hides Revoke even when an approval is active", () => {
    mocks.internalApproval.mockReturnValue(settled({
      state: "active",
      approval: { id: "a1", estimateDraftId: ID, approvedBy: "u1", approvedAt: "2026-09-18T18:00:00Z" },
      snapshot: { contentHash: "h".repeat(64) }, revocation: null,
    }));
    const html = render();
    expect(html).not.toContain(">Revoke<");
  });

  it("hides Reject and Reopen regardless of draft status", () => {
    mocks.draft.mockReturnValue(settled({ ...draft, status: "rejected", rejectionReason: "test" }));
    const html = render();
    expect(html).not.toContain(">Reject<");
    expect(html).not.toContain("Reopen as Draft");
  });

  it("hides the historical source listing link and shows an explicit message instead", () => {
    mocks.draft.mockReturnValue(settled({ ...draft, source: "historical_import", historicalImportId: "h1" }));
    const html = render();
    expect(html).toContain("The historical source and selection listing is unavailable in this read-only view.");
    expect(html).not.toContain("Open recorded source and selection");
  });
});

describe("estimateReadOnly defaults to restricted while the descriptor is unresolved (never presents commands as ready)", () => {
  it("restricts while the session query is loading", () => {
    mocks.session.mockReturnValue(unsettled());
    const html = render();
    expect(mocks.shield).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
    expect(html).toContain("Read-only view:");
  });
  it("restricts while the session query errors", () => {
    mocks.session.mockReturnValue({ ...unsettled(), isError: true, error: new Error("unavailable"), isPending: false, isLoading: false });
    const html = render();
    expect(mocks.shield).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
    expect(html).toContain("Read-only view:");
  });
});

// Retain real React elements and their callbacks; only page-owned hooks are hosted.
function controlled() {
  host.cursor = 0; host.stateCursor = 0; host.effects = []; host.capture = true;
  let tree: ReactNode;
  try { tree = EstimateDetailPage(); } finally { host.capture = false; }
  const nodes: ReactElement<any>[] = [];
  function walk(node: ReactNode): void {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isValidElement(node)) return;
    nodes.push(node as ReactElement<any>);
    walk((node.props as any).children);
  }
  walk(tree);
  const html = renderToStaticMarkup(tree);
  for (const effect of host.effects) effect();
  return { tree, nodes, html };
}
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return isValidElement(node) ? nodeText((node.props as any).children) : "";
}
function state(name: string, value: unknown) {
  const index = host.states.get(name);
  if (index === undefined) throw new Error(`Missing page-owned state ${name}`);
  host.values[index] = value;
}
function mode(value: unknown) {
  mocks.session.mockReturnValue(settled({ provider: "supabase", authenticated: true, supabase: null, estimateReadOnly: value }));
}
function dialog(view: ReturnType<typeof controlled>, title: string) {
  return view.nodes.find(node => typeof node.props.onOpenChange === "function" &&
    typeof node.props.open === "boolean" && nodeText(node).includes(title));
}
function button(view: ReturnType<typeof controlled>, label: string) {
  const found = view.nodes.find(node => typeof node.props.onClick === "function" && nodeText(node).trim() === label);
  if (!found) throw new Error(`Missing real action ${label}`);
  return found;
}

describe("descriptor values fail closed unless false is explicit", () => {
  it.each([
    ["missing field", { provider: "supabase", authenticated: true, supabase: null }],
    ["null", { estimateReadOnly: null }],
    ["zero", { estimateReadOnly: 0 }],
    ["empty string", { estimateReadOnly: "" }],
    ["string false", { estimateReadOnly: "false" }],
  ])("restricts a settled descriptor with %s", (_label, descriptor) => {
    mocks.session.mockReturnValue(settled(descriptor));
    const html = render();
    expect(mocks.shield).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
    expect(mocks.authorization).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
    expect(mocks.exportHistory).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
    expect(html).not.toContain(">PDF<");
    expect(html).not.toContain("Report Issue");
    expect(html).toContain("Read-only view:");
  });
  it.each(["isFetching", "isPaused", "isError"])("does not reuse false from a stale %s result", status => {
    mocks.session.mockReturnValue({ ...settled({ estimateReadOnly: false }), [status]: true });
    expect(render()).not.toContain(">PDF<");
    expect(mocks.shield).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: false }));
  });
});

describe("existing navigation and open dialogs respect restriction changes", () => {
  it.each(["loaded", "missing"])("does not navigate to the unavailable estimate list from the %s page", status => {
    if (status === "missing") mocks.draft.mockReturnValue({ ...settled(undefined), error: new Error("Not found") });
    mode(false);
    button(controlled(), "Back to Estimates").props.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith("/estimate");
    mocks.navigate.mockClear(); mode(true);
    const view = controlled();
    const back = view.nodes.find(node => nodeText(node).trim() === "Back to Estimates" && typeof node.props.onClick === "function");
    if (back) {
      expect(back.props.disabled).toBe(true);
      back.props.onClick();
    }
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("keeps selected export detail disabled after changing to restricted mode", () => {
    controlled();
    state("selectedExportId", "export-selected");
    controlled();
    expect(mocks.exportDetail).toHaveBeenLastCalledWith({ exportId: "export-selected" }, expect.objectContaining({ enabled: true }));
    mode(true); controlled();
    expect(mocks.exportDetail).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });
  it("keeps an opened valid version preview disabled after changing to restricted mode", () => {
    const before = controlled();
    dialog(before, "Create New Version")!.props.onOpenChange(true);
    controlled();
    expect(mocks.versionPreview).toHaveBeenLastCalledWith(expect.objectContaining({ sourceDraftId: ID, sourceKind: "current_draft" }), expect.objectContaining({ enabled: true }));
    mode(true); controlled();
    expect(mocks.versionPreview).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });
  it("removes an already-open report form when restriction arrives", () => {
    const before = controlled();
    dialog(before, "Report Issue")!.props.onOpenChange(true);
    state("reportTitle", "Valid title"); state("reportDescription", "Valid detailed report");
    expect(dialog(controlled(), "Report Issue")?.props.open).toBe(true);
    mode(true);
    const report = dialog(controlled(), "Report Issue");
    expect(report?.props.open ?? false).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("closes an already-open export dialog even when export detail is cached", () => {
    controlled(); state("selectedExportId", "export-selected");
    mocks.exportDetail.mockReturnValue(settled({ exportId: "export-selected", format: "pdf", kind: "initial", status: "ready", availability: "requires_revalidation", validation: null }));
    expect(dialog(controlled(), "Export attempt detail")?.props.open).toBe(true);
    mode(true);
    expect(dialog(controlled(), "Export attempt detail")?.props.open ?? false).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("closes an already-open printable preview before the frame can be printed", () => {
    controlled(); state("printableHtml", "<h1>Previously authorized preview</h1>");
    expect(dialog(controlled(), "Printable preview")?.props.open).toBe(true);
    mode(true);
    expect(dialog(controlled(), "Printable preview")?.props.open ?? false).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("leaves the requested read-only approval review enabled while removing decision controls", () => {
    mode(true);
    const first = controlled();
    expect(mocks.internalApprovalReview).toHaveBeenLastCalledWith({ id: ID, confirmedCurrencyCode: "USD" }, expect.objectContaining({ enabled: false }));
    const review = dialog(first, "Internal Approval");
    expect(review).toBeDefined();
    review!.props.onOpenChange(true);
    const opened = controlled();
    expect(mocks.internalApprovalReview).toHaveBeenLastCalledWith({ id: ID, confirmedCurrencyCode: "USD" }, expect.objectContaining({ enabled: true }));
    const content = nodeText(dialog(opened, "Internal Approval"));
    expect(content).not.toContain("Confirm Internal Approval");
    expect(content).not.toContain("I confirm the amounts above");
    expect(content).not.toContain("Reason (min 10 characters)");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
