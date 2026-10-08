/** Render the actual estimate pages; substitute transport/auth, never their UI. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateProfitShield, type ProfitShieldEvaluation } from "../shared/profit-shield-engine";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), draft: vi.fn(), shield: vi.fn(), authorization: vi.fn(), printable: vi.fn(),
  mutation: vi.fn(), mutate: vi.fn(), preflight: vi.fn(), route: vi.fn(),
  invalidateDraft: vi.fn(), invalidateShield: vi.fn(), invalidateAuthorization: vi.fn(), invalidateList: vi.fn(),
  approve: vi.fn(), reject: vi.fn(), reopen: vi.fn(),
  exportHistory: vi.fn(), exportDetail: vi.fn(), redownload: vi.fn(),
  internalApproval: vi.fn(), internalApprovalReview: vi.fn(), versionPreview: vi.fn(), revoke: vi.fn(), createVersion: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  // ADR-002 partial-read UI reservation (CODEX-LEGACY-MOCK-RESERVATION.md):
  // estimateReadOnly:false preserves this suite's existing (full-mode) behavior.
  auth: { session: { useQuery: () => ({ data: { provider: "supabase", authenticated: true, supabase: null, estimateReadOnly: false }, error: null, isError: false, isPending: false, isLoading: false, isFetching: false, isPaused: false, isSuccess: true }) } },
  estimate: {
    list: { useQuery: mocks.list }, getById: { useQuery: mocks.draft },
    profitShield: { useQuery: mocks.shield }, exportAuthorization: { useQuery: mocks.authorization },
    exportPrintable: { useMutation: mocks.printable }, exportPreflight: { useMutation: mocks.preflight },
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
    listExports: { invalidate: vi.fn() },
    getInternalApproval: { invalidate: vi.fn() }, getInternalApprovalReview: { invalidate: vi.fn() }, getEstimateVersionPreview: { invalidate: vi.fn() },
  } }),
} }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("wouter", () => ({ useRoute: mocks.route, useLocation: () => ["/estimates/test", vi.fn()] }));
import EstimatePage from "../client/src/pages/Estimate";
import EstimateDetailPage from "../client/src/pages/EstimateDetail";
import { formatDiscountPercent } from "../client/src/components/estimate/EstimateReadiness";

const ID = "d2700000-0000-4000-8000-000000000001";
const SECRET = "database credential details must not be displayed";
const draft = {
  id: ID, bundleName: "Readiness fixture", status: "draft", createdAt: "2026-09-18T18:00:00Z",
  subtotalCost: "900.00", subtotalPrice: "1500.00", finalTotalPrice: "1200.00",
  grossProfit: "300.00", grossProfitPct: "25.00", discountAmount: "300.00", discountApplied: true,
  profitShieldPassed: null, profitShieldMinPct: null, lineItems: [], assemblySelections: [], metadata: {},
};
const shield: ProfitShieldEvaluation = {
  channel: null, channelFloorPct: null, geoFloorPct: 0, riskClass: "inland", effectiveFloorPct: 28,
  actualPct: 25, floorKind: null, passed: false, blocked: true,
  violations: [{ code: "UNKNOWN_CHANNEL", severity: "violation", message: "Commercial channel is unresolved.", floorPct: 28, actualPct: 25 }],
  warnings: [], remediation: ["Resolve the commercial channel before approval."],
};
const authorized = { estimateId: ID, authorized: true, code: null, authority: { approvalId: ID, snapshotId: ID, contentHash: "a".repeat(64) } };
function settled<T>(data: T) {
  return { data, error: null, isError: false, isPending: false, isLoading: false, isFetching: false, isPaused: false, isSuccess: true };
}
const renderDetail = () => renderToStaticMarkup(createElement(EstimateDetailPage));
const renderList = () => renderToStaticMarkup(createElement(EstimatePage));
function exportButtons(html: string) {
  return Array.from(html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g))
    .map(match => match[0]).filter(button => />(PDF|JSON|JobTread CSV)<\/button>/.test(button));
}
/** The server, not a cached authorization query, decides every export click
 * (A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md / Integration§6.5) — buttons are
 * enabled by default and only disable while THEIR OWN mutation is pending. */
function expectExportsEnabled(html: string) {
  const buttons = exportButtons(html);
  expect(buttons).toHaveLength(3);
  for (const button of buttons) expect(button).not.toContain('disabled=""');
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.route.mockReturnValue([true, { id: ID }]);
  mocks.list.mockReturnValue(settled({ items: [draft] }));
  mocks.draft.mockReturnValue(settled(draft));
  mocks.shield.mockReturnValue(settled(shield));
  mocks.authorization.mockReturnValue(settled({ estimateId: ID, authorized: false, code: "INTERNAL_APPROVAL_REQUIRED", authority: null }));
  mocks.exportHistory.mockReturnValue(settled([]));
  mocks.exportDetail.mockReturnValue(settled(undefined));
  mocks.internalApproval.mockReturnValue(settled({ state: "none", approval: null, snapshot: null, revocation: null }));
  mocks.internalApprovalReview.mockReturnValue(settled(undefined));
  mocks.versionPreview.mockReturnValue(settled(undefined));
  for (const hook of [mocks.mutation, mocks.approve, mocks.reject, mocks.reopen, mocks.printable, mocks.preflight, mocks.redownload, mocks.revoke, mocks.createVersion]) {
    hook.mockReturnValue({ mutate: mocks.mutate, isPending: false });
  }
});

describe("exact stored discount ratio boundary", () => {
  it.each([
    ["10049.00", "100000.00", "10.0%"],
    ["10050.00", "100000.00", "10.1%"],
    ["499499999999999999.99", "999999999999999999.99", "49.9%"],
    ["499500000000000000.00", "999999999999999999.99", "50.0%"],
    ["0.00", "999999999999999999.99", "0.0%"],
    ["999999999999999999.99", "999999999999999999.99", "100.0%"],
    [" 3e2 ", "1.5e3", "20.0%"],
    ["0.001", "100.00", "Unavailable"],
    ["0.00", "0.00", "Unavailable"],
  ])("formats %s / %s directly as %s", (discountAmount, subtotalPrice, expected) => {
    expect(formatDiscountPercent({ discountAmount, subtotalPrice })).toBe(expected);
  });
  it.each([
    { a1VersionRequestId: "d2700000-0000-4000-8000-000000000009" },
    { a1VersionRequestHash: "a".repeat(64) },
    { a1VersionRequestId: null, a1VersionRequestHash: "a".repeat(64) },
    { a1VersionRequestId: undefined, a1VersionRequestHash: undefined },
    { source: "calculator", a1VersionRequestId: "d2700000-0000-4000-8000-000000000009", a1VersionRequestHash: "a".repeat(64) },
  ])("does not erase a malformed version signal before ratio presentation: %j", markers => {
    const value = { ...draft, ...markers };
    expect(formatDiscountPercent(value)).toBe("Unavailable");
  });
  it("accepts explicitly null legacy markers without inventing v2 validation", () => {
    const value = { ...draft, a1VersionRequestId: null, a1VersionRequestHash: null };
    expect(formatDiscountPercent(value)).toBe("20.0%");
  });
});

describe.each([["list", renderList], ["detail", renderDetail]] as const)("%s discount display", (_, render) => {
  it.each([true, false])("uses stored amount/subtotal regardless of discountApplied=%s", discountApplied => {
    const value = { ...draft, discountApplied };
    mocks.draft.mockReturnValue(settled(value)); mocks.list.mockReturnValue(settled({ items: [value] }));
    const html = render();
    expect(html).toContain("20.0%"); expect(html).not.toContain("NaN");
  });
  it("renders a real zero discount", () => {
    const value = { ...draft, discountAmount: "0.00", discountApplied: false };
    mocks.draft.mockReturnValue(settled(value)); mocks.list.mockReturnValue(settled({ items: [value] }));
    expect(render()).toContain("0.0%");
  });
  it("parses complete numeric strings consistently instead of truncating exponents", () => {
    const value = { ...draft, discountAmount: "3e2", subtotalPrice: "1.5e3" };
    mocks.draft.mockReturnValue(settled(value)); mocks.list.mockReturnValue(settled({ items: [value] }));
    expect(render()).toContain("20.0%");
  });
  it("keeps the GP metric neutral until a policy evaluation is shown", () => {
    const html = render();
    const gpMetric = html.match(/<p[^>]*>GP(?: %)?<\/p><p[^>]*>25\.0%<\/p>/)?.[0];
    expect(gpMetric).toBeDefined();
    expect(gpMetric).not.toContain("text-red-400");
    expect(gpMetric).not.toContain("text-emerald-400");
  });
  it.each([
    { subtotalPrice: "0.00" }, { discountAmount: null }, { discountAmount: "invalid" },
    { subtotalPrice: "Infinity" }, { discountAmount: "400junk" },
    { discountAmount: true }, { subtotalPrice: "" }, { discountAmount: "-1" },
    { discountAmount: "1e308", subtotalPrice: "1e-308" },
    { discountAmount: "0x10" }, { subtotalPrice: "0b11" }, { discountAmount: "1501.00" },
    { discountAmount: 1e308, subtotalPrice: 1e-308 },
  ])("does not invent a percentage from incomplete amounts: %j", fields => {
    const value = { ...draft, ...fields };
    mocks.draft.mockReturnValue(settled(value)); mocks.list.mockReturnValue(settled({ items: [value] }));
    const html = render();
    expect(html).toMatch(/Discount<\/p><p[^>]*>Unavailable<\/p>/);
    expect(html).not.toContain("NaN%");
  });
});

describe("stored-context Profit Shield presentation", () => {
  it("does not evaluate per-row policies or claim a fixed floor in the list", () => {
    const html = renderList();
    expect(html).toContain("Profit Shield: verify in estimate details");
    expect(html).toContain(`href="/estimates/${ID}"`);
    expect(html).not.toContain("35% GP Floor Applied");
    expect(mocks.shield).not.toHaveBeenCalled(); expect(mocks.authorization).not.toHaveBeenCalled();
  });
  it("shows the unresolved channel and the actual fallback floor", () => {
    const html = renderDetail();
    expect(html).toContain("Stored pricing check: channel unresolved");
    expect(html).toContain("Stored pricing floor: 28.0%");
    expect(html).toContain("Commercial channel is unresolved.");
    expect(html).toContain("Resolve the commercial channel before requesting internal approval.");
    expect(html).not.toContain("35.00%"); expect(html).not.toContain("Stored pricing check: FAILED");
    expect(mocks.shield).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: true }));
  });
  it("uses a successful server evaluation even when the legacy snapshot is null", () => {
    mocks.shield.mockReturnValue(settled({ ...shield, passed: true, blocked: false, channel: "GC", effectiveFloorPct: 22, violations: [], remediation: [] }));
    const html = renderDetail();
    expect(html).toContain("Stored pricing check: passed"); expect(html).toContain("Stored pricing floor: 22.0%");
    expect(html).not.toContain("FAILED");
  });
  it("shows a known channel violation and assembly warnings from the server", () => {
    mocks.shield.mockReturnValue(settled({ ...shield, channel: "GC", violations: [{ ...shield.violations[0], code: "CHANNEL_FLOOR", message: "Below the configured channel floor." }], warnings: [{ ...shield.violations[0], code: "ASSEMBLY_WARNING", severity: "warning", message: "Review the assembly margin." }] }));
    const html = renderDetail();
    expect(html).toContain("Stored pricing check: blocked"); expect(html).toContain("Below the configured channel floor.");
    expect(html).toContain("Review the assembly margin.");
  });
  it("does not render a cached pass after a query error", () => {
    mocks.shield.mockReturnValue({ ...settled({ ...shield, passed: true, blocked: false }), isError: true, error: new Error(SECRET), isFetching: true });
    const html = renderDetail();
    expect(html).toContain('role="alert"'); expect(html).toContain("Unable to verify the stored pricing check");
    expect(html).not.toContain("Stored pricing check: passed"); expect(html).not.toContain(SECRET);
  });
  it("does not render a cached pass while the verification request is paused", () => {
    mocks.shield.mockReturnValue({ ...settled({ ...shield, channel: "GC", passed: true, blocked: false, violations: [] }), isPaused: true });
    const html = renderDetail();
    expect(html).toContain('role="status"'); expect(html).toContain("Verifying stored pricing check");
    expect(html).not.toContain("Stored pricing check: passed");
  });
  it.each(["pending", "refetch", "missing"])("shows unverified/loading for %s instead of null becoming failed", state => {
    mocks.shield.mockReturnValue(state === "pending" ? { ...settled(undefined), isSuccess: false, isPending: true } : state === "refetch" ? { ...settled(shield), isFetching: true } : settled(undefined));
    const html = renderDetail();
    expect(html).toContain('role="status"'); expect(html).toContain("Verifying stored pricing check");
    expect(html).not.toContain("Stored pricing check: FAILED"); expect(html).not.toContain("Stored pricing check: passed");
  });
});

describe("stored pricing context versus current internal approval", () => {
  it("labels a stored-context pass without presenting it as current approval eligibility", () => {
    // The legacy pricing context may pass at 28% while current coastal review
    // requires 42%; this component must identify what it actually evaluated.
    const stored = evaluateProfitShield(33, { channel: "direct", riskClass: "inland" });
    expect(stored).toMatchObject({ passed: true, effectiveFloorPct: 28 });
    mocks.shield.mockReturnValue(settled(stored));
    const html = renderDetail();
    expect(html).toContain('aria-label="Stored pricing check"');
    expect(html).toContain("Stored pricing check: passed");
    expect(html).toContain("Stored pricing floor: 28.0%");
    expect(html).toContain("Evaluated margin: 33.0%");
    expect(html).toContain("Profit Shield evaluated using the saved pricing context.");
    expect(html).toContain("Current internal approval requires a separate review of the current project context and required margin.");
    expect(html).not.toContain("Profit Shield: passed");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("replaces legacy exception advice with a current-review action while preserving the violation", () => {
    const stored = evaluateProfitShield(25, { channel: "direct", riskClass: "inland" });
    expect(stored.remediation.join(" ")).toContain("document an approved exception");
    mocks.shield.mockReturnValue(settled(stored));
    const html = renderDetail();
    expect(html).toContain("Stored pricing check: blocked");
    expect(html).toContain(stored.violations[0].message);
    expect(html).toContain("Review scope and pricing, then run a new internal approval review.");
    expect(html).not.toContain("document an approved exception");
    expect(html).not.toContain("Change payment terms");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("keeps unknown channel and fallback limitations explicit without suggesting a margin exception", () => {
    const stored = evaluateProfitShield(25, { channel: null, riskClass: "inland" });
    mocks.shield.mockReturnValue(settled(stored));
    const html = renderDetail();
    expect(html).toContain("Stored pricing check: channel unresolved");
    expect(html).toContain("Stored pricing floor: 28.0%");
    expect(html).toContain("The displayed floor is a fallback until the commercial channel is resolved.");
    expect(html).toContain("Resolve the commercial channel before requesting internal approval.");
    expect(html).not.toContain("document an approved exception");
  });

  it("identifies a stored-check error without displaying cached success or infrastructure details", () => {
    mocks.shield.mockReturnValue({ ...settled(evaluateProfitShield(60, { channel: "direct" })), isError: true, error: new Error(SECRET) });
    const html = renderDetail();
    expect(html).toContain("Unable to verify the stored pricing check. Please try again.");
    expect(html).not.toContain("Stored pricing check: passed");
    expect(html).not.toContain("Stored pricing floor:");
    expect(html).not.toContain(SECRET);
  });

  it("identifies a stored-check refresh without displaying cached success", () => {
    mocks.shield.mockReturnValue({ ...settled(evaluateProfitShield(60, { channel: "direct" })), isFetching: true });
    const html = renderDetail();
    expect(html).toContain("Verifying stored pricing check…");
    expect(html).not.toContain("Stored pricing check: passed");
    expect(html).not.toContain("Stored pricing floor:");
  });
});

describe("export authorization in actual detail actions", () => {
  // A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md retires the C2-A hold: the server
  // decides every export click for real (createAndDeliverExportAttempt etc.),
  // so the client never pre-gates the buttons on a cached authorization query —
  // it only informs. This describe block replaces the old "stays disabled no
  // matter what the query says" coverage with "stays enabled no matter what the
  // query says, and shows the server's denial as informational text".
  it("explains a denial as informational text without disabling the buttons", () => {
    const html = renderDetail();
    expectExportsEnabled(html);
    expect(html).toContain("This estimate has no internal approval yet.");
    expect(mocks.authorization).toHaveBeenCalledWith({ id: ID }, expect.objectContaining({ enabled: true }));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each(["pending", "refetch", "missing", "error"])("keeps exports enabled when the authorization query is %s — never a leaked error detail", state => {
    mocks.authorization.mockReturnValue(state === "pending" ? { ...settled(undefined), isSuccess: false, isPending: true } : state === "refetch" ? { ...settled(authorized), isFetching: true } : state === "error" ? { ...settled(authorized), isError: true, error: new Error(SECRET) } : settled(undefined));
    const html = renderDetail(); expectExportsEnabled(html);
    expect(html).not.toContain(SECRET);
  });
  it("shows no denial banner once authorized", () => {
    mocks.authorization.mockReturnValue(settled(authorized));
    const html = renderDetail(); expectExportsEnabled(html);
    expect(html).not.toContain("This estimate has no internal approval yet.");
  });
  // A1-DECISION-CYCLE-SURFACE-INTEGRATION-CONTRACT.md: approveEstimate.useMutation()
  // is now legitimately called by the new A1 "Internal Approval" dialog (a different
  // feature on the SAME real procedure) — `mocks.approve` being called is no longer
  // evidence of the retired Sprint 20 quick-action flow. The property this test
  // actually cares about — the OLD confirmation button's exact label never renders —
  // is unaffected and still checked.
  it("does not render the old quick-action approval confirmation label", () => {
    const html = renderDetail();
    expect(html).not.toContain("Confirm Approval");
  });
  it.each(["reject", "reopen"] as const)("refreshes readiness after %s succeeds", async action => {
    renderDetail(); await mocks[action].mock.calls[0][0].onSuccess();
    expect(mocks.invalidateDraft).toHaveBeenCalledWith({ id: ID });
    expect(mocks.invalidateShield).toHaveBeenCalledWith({ id: ID });
    expect(mocks.invalidateAuthorization).toHaveBeenCalledWith({ id: ID });
    expect(mocks.invalidateList).toHaveBeenCalled();
  });
  it.each(["reject", "reopen"] as const)("export buttons stay enabled during the %s mutation — each export action owns only its own pending state", action => {
    mocks.authorization.mockReturnValue(settled(authorized));
    mocks[action].mockReturnValue({ mutate: mocks.mutate, isPending: true });
    expectExportsEnabled(renderDetail());
  });
});

describe('estimate to actuals project continuity', () => {
  it('links the canonical project ledger using the stored UUID', () => {
    mocks.draft.mockReturnValue(settled({ ...draft, projectId: ID }));
    expect(renderDetail()).toContain(`href="/actuals?projectId=${ID}"`);
  });
  it('does not invent a project for an unlinked estimate', () => {
    expect(renderDetail()).not.toContain('href="/actuals?projectId=');
  });
});

describe("legacy estimate detail numeric presentation", () => {
  const unavailableValues = [undefined, null, NaN, Infinity, "", "not-a-number", "12oops", "0x10", true];
  it.each(unavailableValues)("does not invent summary zeroes from %s", value => {
    mocks.draft.mockReturnValue(settled({ ...draft, subtotalCost: value, subtotalPrice: value,
      grossProfit: value, grossProfitPct: value, discountAmount: value, finalTotalPrice: value }));
    const html = renderDetail();
    for (const label of ["Total Cost", "Total Price", "Gross Profit", "GP %", "Discount Amt", "Final Total"]) {
      expect(html).toMatch(new RegExp(`${label}</p><p[^>]*>Unavailable</p>`));
    }
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
    expectExportsEnabled(html);
  });
  it.each(unavailableValues)("renders legacy assembly and line rows with missing or invalid values %s without crashing", value => {
    mocks.draft.mockReturnValue(settled({ ...draft,
      assemblySelections: [{ assemblyName: "Legacy assembly fixture", category: "Known legacy category", quantity: value, unitCost: value,
        unitPrice: value, extendedPrice: value, grossProfitPct: value }],
      lineItems: [{ costItemName: "Legacy line fixture", costGroupName: "Known legacy group", quantity: value, unit: "EA",
        unitPriceSnapshot: value, lineTotalPrice: value, grossProfitPct: value }],
    }));
    const html = renderDetail();
    const assembly = html.match(/<tr[^>]*><td[^>]*>Legacy assembly fixture[\s\S]*?<\/tr>/)?.[0];
    const line = html.match(/<tr[^>]*><td[^>]*>Legacy line fixture[\s\S]*?<\/tr>/)?.[0];
    expect(assembly?.match(/Unavailable/g)).toHaveLength(5);
    expect(line?.match(/Unavailable/g)).toHaveLength(4);
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
    expectExportsEnabled(html);
  });
  it("retains actual zero amounts but does not invent a margin for a zero price", () => {
    mocks.draft.mockReturnValue(settled({ ...draft, subtotalCost: 0, subtotalPrice: "0.00",
      grossProfit: 0, grossProfitPct: "0", discountAmount: 0, finalTotalPrice: "0.00",
      assemblySelections: [{ assemblyName: "Zero assembly fixture", quantity: 0, unitCost: "0.00",
        unitPrice: 0, extendedPrice: "0", grossProfitPct: 0 }],
    }));
    const html = renderDetail();
    expect(html).toMatch(/Total Cost<\/p><p[^>]*>\$0\.00<\/p>/);
    expect(html).toMatch(/GP %<\/p><p[^>]*>Unavailable<\/p>/);
    expect(html).toMatch(/Gross Profit<\/p><p[^>]*>\$0\.00<\/p>/);
    const assembly = html.match(/<tr[^>]*><td[^>]*>Zero assembly fixture[\s\S]*?<\/tr>/)?.[0];
    expect(assembly).toContain("$0.00"); expect(assembly).toContain("Unavailable");
    expect(assembly).not.toContain("0.0%");
  });
  it("preserves valid negative margins and complete exponent-form monetary values", () => {
    mocks.draft.mockReturnValue(settled({ ...draft, grossProfitPct: "95.0", subtotalCost: " 1.025e2 ", finalTotalPrice: "1e2" }));
    const html = renderDetail();
    expect(html).toMatch(/GP %<\/p><p[^>]*>-2\.5%<\/p>/);
    expect(html).toMatch(/Total Cost<\/p><p[^>]*>\$102\.50<\/p>/);
  });
});
