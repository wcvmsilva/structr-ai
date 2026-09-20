/**
 * Sprint 20 — Field Launch Toolkit Tests
 *
 * 50+ tests covering:
 *   GROUP A: Estimate Export Module (12 tests)
 *     - JSON export structure & fields
 *     - PDF export returns valid Buffer
 *     - Printable HTML export structure
 *   GROUP B: Issue Report Router (10 tests)
 *     - Router wiring in appRouter
 *     - CRUD procedures existence
 *     - Input validation schemas
 *   GROUP C: Quick Actions — Approve/Reject (12 tests)
 *     - Status transitions (approve, reject, reopen)
 *     - Rejection reason validation
 *     - Audit logging for approve/reject
 *     - StatusBadge UI coverage
 *   GROUP D: Draft Recovery (10 tests)
 *     - createPartialDraft structure
 *     - listPartialDrafts / getPartialDraftById
 *     - markPartialDraftRetrying / markPartialDraftRecovered / abandonPartialDraft
 *     - Pipeline catch block integration
 *   GROUP E: Audit Logging Events (8 tests)
 *     - estimate_generated, estimate_viewed, export events
 *     - issue_reported, estimate_approved, estimate_rejected
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as fs from "fs";
import * as path from "path";

// C2-A revokes the old approval/export authority. Test refusal and actual UI behavior,
// while keeping the unrelated issue/recovery contracts below intact.
const effects = vi.hoisted(() => ({
  getDb: vi.fn(), audit: vi.fn(), draft: vi.fn(), approve: vi.fn(), reject: vi.fn(),
  reopen: vi.fn(), mutation: vi.fn(), mutate: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: effects.getDb }));
vi.mock("./audit", () => ({ logAudit: effects.audit }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  estimate: {
    getById: { useQuery: effects.draft }, profitShield: { useQuery: () => ({}) },
    exportAuthorization: { useQuery: () => ({ data: { authorized: true }, isSuccess: true }) },
    approveEstimate: { useMutation: effects.approve }, rejectEstimate: { useMutation: effects.reject },
    updateStatus: { useMutation: effects.reopen }, exportPdf: { useMutation: effects.mutation },
    exportJson: { useMutation: effects.mutation }, exportCsv: { useMutation: effects.mutation },
    exportPrintable: { useQuery: () => ({}) }, exportPreflight: { useMutation: effects.mutation },
  }, issueReport: { create: { useMutation: effects.mutation } },
  useUtils: () => ({ estimate: { getById: { invalidate: effects.invalidate },
    profitShield: { invalidate: effects.invalidate }, exportAuthorization: { invalidate: effects.invalidate },
    list: { invalidate: effects.invalidate } } }),
} }));
vi.mock("wouter", () => ({ useRoute: () => [true, { id: "d2700000-0000-4000-8000-000000000001" }], useLocation: () => ["/", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
import EstimateDetailPage from "../client/src/pages/EstimateDetail";
import { approveEstimateDraft } from "./estimate-db";
const hold = { code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE", operation: "export" };
const renderDetail = () => renderToStaticMarkup(createElement(EstimateDetailPage));
function held(invoke: () => unknown) {
  expect(invoke).toThrow(expect.objectContaining(hold));
  expect(effects.getDb).not.toHaveBeenCalled();
  expect(effects.audit).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  effects.getDb.mockImplementation(() => { throw new Error("Held operations must not open storage"); });
  effects.audit.mockImplementation(() => { throw new Error("Held operations must not publish a success audit"); });
  effects.draft.mockReturnValue({ data: makeMockDraft() });
  for (const hook of [effects.approve, effects.reject, effects.reopen, effects.mutation])
    hook.mockReturnValue({ mutate: effects.mutate, isPending: false });
});

// ── Load source files for structural assertions ──────────────────────
const estimateExportFile = fs.readFileSync(
  path.resolve(__dirname, "./estimate-export.ts"),
  "utf-8"
);
const estimateRouterFile = fs.readFileSync(
  path.resolve(__dirname, "./estimate-router.ts"),
  "utf-8"
);
const estimateDbFile = fs.readFileSync(
  path.resolve(__dirname, "./estimate-db.ts"),
  "utf-8"
);
const issueReportRouterFile = fs.readFileSync(
  path.resolve(__dirname, "./issue-report-router.ts"),
  "utf-8"
);
const draftRecoveryDbFile = fs.readFileSync(
  path.resolve(__dirname, "./draft-recovery-db.ts"),
  "utf-8"
);
const schemaFile = fs.readFileSync(
  path.resolve(__dirname, "../drizzle/schema.ts"),
  "utf-8"
);
const routersFile = fs.readFileSync(
  path.resolve(__dirname, "./routers.ts"),
  "utf-8"
);
const estimateDetailFile = fs.readFileSync(
  path.resolve(__dirname, "../client/src/pages/EstimateDetail.tsx"),
  "utf-8"
);

// ── Runtime imports ──────────────────────────────────────────────────
import {
  generateJsonExport,
  generatePdfExport,
  generatePrintableExport,
} from "./estimate-export";

import type { EstimateDraft } from "../drizzle/schema";

// ── Mock EstimateDraft for export testing ────────────────────────────
function makeMockDraft(overrides: Partial<EstimateDraft> = {}): EstimateDraft {
  return {
    id: 42,
    bundleId: null,
    bundleName: "Kitchen Remodel — Premium",
    channel: "direct",
    lineItems: [
      {
        costItemId: 1,
        costItemName: "Drywall 4x8 Sheet",
        costGroupName: "Drywall",
        quantity: 10,
        unit: "sheet",
        unitCostSnapshot: "12.50",
        unitPriceSnapshot: "25.00",
        lineTotalCost: "125.00",
        lineTotalPrice: "250.00",
        grossProfitPct: "50.00",
      },
    ] as any,
    subtotalCost: "5000.00",
    subtotalPrice: "10000.00",
    grossProfit: "5000.00",
    grossProfitPct: "50.00",
    discountApplied: "5.00",
    discountAmount: "500.00",
    finalTotalPrice: "9500.00",
    notes: "Test estimate notes for export",
    metadata: {
      contextSnapshot: {
        channel: "direct",
        channelSource: "user_input",
        finishLevel: "premium",
        finishLevelSource: "user_input",
        region: "Charleston",
        regionSource: "default",
        zone: "Zone A",
        multipliersApplied: { channelMultiplier: 1.0, finishMultiplier: 1.15 },
      },
    },
    status: "draft",
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    createdBy: 1,
    createdAt: new Date("2026-03-15T10:00:00Z"),
    updatedAt: new Date("2026-03-15T10:00:00Z"),
    region: "Charleston",
    finishLevel: "premium",
    projectId: null,
    clientId: null,
    assemblySelections: [
      {
        assemblyId: 1,
        assemblyName: "Kitchen Cabinet Set",
        category: "Kitchen",
        quantity: 1,
        unitCost: "2500.00",
        unitPrice: "5000.00",
        extendedCost: "2500.00",
        extendedPrice: "5000.00",
        grossProfitPct: "50.00",
        componentCount: 12,
      },
    ] as any,
    assemblyCount: 1,
    profitShieldPassed: true,
    profitShieldMinPct: "35.00",
    source: "assembly_calculator",
    pricingSchemaVersion: "1.0",
    scopeDraftId: null,
    ...overrides,
  } as EstimateDraft;
}

// ══════════════════════════════════════════════════════════════════════
// GROUP A: Estimate Export Module (12 tests)
// ══════════════════════════════════════════════════════════════════════

describe.each([
  ["JSON", generateJsonExport], ["PDF", generatePdfExport], ["Printable", generatePrintableExport],
] as const)("Sprint 20 — GROUP A: %s compatibility hold", (_, render) => {
  it("does not render an ordinary calculated draft", () => {
    held(() => render(makeMockDraft(), "operator-1"));
  });
  it("does not treat a stored legacy approval as export authority", () => {
    held(() => render(makeMockDraft({ status: "approved", approvedBy: "operator-1", approvedAt: new Date("2026-09-20T12:00:00Z") }), "operator-1"));
  });
  it("does not render a draft whose content is absent", () => {
    held(() => render(makeMockDraft({ notes: null, lineItems: [], assemblySelections: [] }), "operator-1"));
  });
  it("refuses before reading financials or creating an artifact", () => {
    const read = vi.fn(() => { throw new Error("Financial contents must not be read"); });
    const draft = Object.defineProperty(makeMockDraft(), "finalTotalPrice", { get: read });
    held(() => render(draft, "operator-1"));
    expect(read).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP B: Issue Report Router (10 tests)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20 — GROUP B: Issue Report Router", () => {
  it("B1: issueReportRouter is wired into appRouter under 'issueReport'", () => {
    expect(routersFile).toContain("issueReport: issueReportRouter");
  });

  it("B2: issueReportRouter is imported from ./issue-report-router", () => {
    expect(routersFile).toContain('import { issueReportRouter } from "./issue-report-router"');
  });

  it("B3: issueReportRouter exports create procedure", () => {
    expect(issueReportRouterFile).toContain("create: protectedProcedure");
  });

  it("B4: issueReportRouter exports list procedure", () => {
    expect(issueReportRouterFile).toContain("list: protectedProcedure");
  });

  it("B5: issueReportRouter exports getById procedure", () => {
    expect(issueReportRouterFile).toContain("getById: protectedProcedure");
  });

  it("B6: issueReportRouter exports updateStatus procedure", () => {
    expect(issueReportRouterFile).toContain("updateStatus: protectedProcedure");
  });

  it("B7: issueReportRouter exports stats procedure", () => {
    expect(issueReportRouterFile).toContain("stats: protectedProcedure");
  });

  it("B8: Issue categories include all expected values", () => {
    const expectedCategories = [
      "pricing_mismatch",
      "missing_assembly",
      "wrong_multiplier",
      "scope_error",
      "data_integrity",
      "other",
    ];
    for (const cat of expectedCategories) {
      expect(issueReportRouterFile).toContain(`"${cat}"`);
    }
  });

  it("B9: Issue severities include all expected values", () => {
    const expectedSeverities = ["low", "medium", "high", "critical"];
    for (const sev of expectedSeverities) {
      expect(issueReportRouterFile).toContain(`"${sev}"`);
    }
  });

  it("B10: Issue report create writes audit log", () => {
    expect(issueReportRouterFile).toContain("logAudit(");
    expect(issueReportRouterFile).toContain('"issue_reported"');
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP C: Quick Actions — Approve/Reject (12 tests)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20 — GROUP C: Quick Actions (Approve/Reject)", () => {
  // ── Schema ──
  describe("Schema", () => {
    it.skip("C1: estimate_drafts status enum — skipped: estimateDrafts table removed in PG migration", () => {});

    it.skip("C2: estimate_drafts approval/rejection fields — skipped: estimateDrafts table removed in PG migration", () => {});
  });

  // ── DB Helpers ──
  describe("DB Helpers", () => {
    it("C3: estimate-db.ts exports approveEstimateDraft function", () => {
      expect(estimateDbFile).toContain("export async function approveEstimateDraft");
    });

    it("C4: estimate-db.ts exports rejectEstimateDraft function", () => {
      expect(estimateDbFile).toContain("export async function rejectEstimateDraft");
    });

    it("C5: old approval refuses before stamps, writes or audit", async () => {
      await expect(approveEstimateDraft("draft-1", "operator-1")).rejects.toMatchObject({ ...hold, operation: "approval" });
      expect(effects.getDb).not.toHaveBeenCalled();
      expect(effects.audit).not.toHaveBeenCalled();
    });

    it("C6: rejectEstimateDraft sets rejectedBy, rejectedAt, and rejectionReason", () => {
      expect(estimateDbFile).toContain("rejectedBy: userId");
      expect(estimateDbFile).toContain("rejectedAt: new Date()");
      expect(estimateDbFile).toContain("rejectionReason: reason");
    });

    it("C7: STATUS_TRANSITIONS allows draft → approved and draft → rejected", () => {
      expect(estimateDbFile).toContain(
        'draft: ["sent_to_estimate", "archived", "approved", "rejected"]'
      );
    });

    it("C8: STATUS_TRANSITIONS allows rejected → draft (reopen)", () => {
      expect(estimateDbFile).toContain(
        'rejected: ["draft", "archived"]'
      );
    });
  });

  // ── Router Procedures ──
  describe("Router Procedures", () => {
    it("C9: estimateRouter has approveEstimate procedure", () => {
      expect(estimateRouterFile).toContain("approveEstimate: protectedProcedure");
    });

    it("C10: estimateRouter has rejectEstimate procedure with reason validation", () => {
      expect(estimateRouterFile).toContain("rejectEstimate: protectedProcedure");
      expect(estimateRouterFile).toContain(
        'reason: z.string().min(5, "Rejection reason must be at least 5 characters")'
      );
    });

    it("C11: held approval emits no success audit while rejection keeps its existing event", async () => {
      await expect(approveEstimateDraft("draft-1", "operator-1")).rejects.toMatchObject({ ...hold, operation: "approval" });
      expect(effects.audit).not.toHaveBeenCalled();
      expect(estimateDbFile).toContain('"estimate_rejected"');
    });
  });

  // ── UI ──
  describe("UI — EstimateDetail Quick Actions", () => {
    it("C12: actual detail preserves Reject and Reopen while approval remains held", () => {
      expect(renderDetail()).toContain("Reject");
      effects.draft.mockReturnValue({ data: makeMockDraft({ status: "rejected" }) });
      const html = renderDetail();
      expect(html).toContain("Reopen as Draft");
      expect(html).toContain("Approval and exports are temporarily unavailable");
      expect(html).not.toContain("Confirm Approval");
    });

    it("C13: detail does not register approval or render its confirmation dialog", () => {
      const html = renderDetail();
      expect(effects.approve).not.toHaveBeenCalled();
      expect(effects.mutate).not.toHaveBeenCalled();
      expect(html).not.toContain("Confirm Approval");
      expect(html).toContain("Approval and exports are temporarily unavailable");
    });

    it("C14: EstimateDetail has rejection dialog with reason textarea", () => {
      expect(estimateDetailFile).toContain("Reject Estimate");
      expect(estimateDetailFile).toContain("Rejection Reason");
      expect(estimateDetailFile).toContain("Confirm Rejection");
    });

    it("C15: StatusBadge includes approved and rejected styles", () => {
      expect(estimateDetailFile).toContain('approved: { bg: "bg-green-500/15"');
      expect(estimateDetailFile).toContain('rejected: { bg: "bg-red-500/15"');
    });

    it("C16: EstimateDetail shows rejection banner when status is rejected", () => {
      expect(estimateDetailFile).toContain('draft.status === "rejected"');
      expect(estimateDetailFile).toContain("draft.rejectionReason");
    });

    it("C17: EstimateDetail shows approval banner when status is approved", () => {
      expect(estimateDetailFile).toContain('draft.status === "approved"');
      expect(estimateDetailFile).toContain("draft.approvedAt");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP D: Draft Recovery (10 tests)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20 — GROUP D: Draft Recovery", () => {
  // ── Schema ──
  describe("Schema", () => {
    it("D1: pipeline_partial_drafts table exists in schema", () => {
      expect(schemaFile).toContain('pgTable("pipeline_partial_drafts"');
    });

    it("D2: pipeline_partial_drafts has required columns", () => {
      expect(schemaFile).toContain('scopeDraftId: uuid("scope_draft_id")');
      expect(schemaFile).toContain('errorCode: text("error_code")');
      expect(schemaFile).toContain('retryCount: integer("retry_count")');
      expect(schemaFile).toContain('maxRetries: integer("max_retries")');
      expect(schemaFile).toContain('recoveredEstimateId: uuid("recovered_estimate_id")');
    });

    it("D3: pipeline_partial_drafts status defaults to partial", () => {
      expect(schemaFile).toContain('.default("partial")');
    });
  });

  // ── DB Helpers ──
  describe("DB Helpers", () => {
    it("D4: draft-recovery-db.ts exports createPartialDraft", () => {
      expect(draftRecoveryDbFile).toContain("export async function createPartialDraft");
    });

    it("D5: draft-recovery-db.ts exports listPartialDrafts", () => {
      expect(draftRecoveryDbFile).toContain("export async function listPartialDrafts");
    });

    it("D6: draft-recovery-db.ts exports markPartialDraftRetrying", () => {
      expect(draftRecoveryDbFile).toContain("export async function markPartialDraftRetrying");
    });

    it("D7: draft-recovery-db.ts exports markPartialDraftRecovered", () => {
      expect(draftRecoveryDbFile).toContain("export async function markPartialDraftRecovered");
    });

    it("D8: draft-recovery-db.ts exports abandonPartialDraft", () => {
      expect(draftRecoveryDbFile).toContain("export async function abandonPartialDraft");
    });

    it("D9: markPartialDraftRetrying checks retry limit", () => {
      expect(draftRecoveryDbFile).toContain("current.retryCount");
      expect(draftRecoveryDbFile).toContain("current.maxRetries");
    });

    it("D10: markPartialDraftRecovered sets recoveredEstimateId and recoveredAt", () => {
      expect(draftRecoveryDbFile).toContain("recoveredEstimateId");
      expect(draftRecoveryDbFile).toContain("recoveredAt: new Date()");
    });
  });

  // ── Router Integration ──
  describe("Router Integration", () => {
    // HISTORY (B2 / Codex P1-1, route inventory): D11-D13 previously asserted
    // "<route>: protectedProcedure". Their intent is that the procedure EXISTS, but they
    // also pinned the weaker procedure type. These three routes reach
    // `pipeline_partial_drafts`, which has no tenant_id, and their guard was skippable by
    // omitting `scopeDraftId`; they now run behind `tenantProcedure` so an unresolved
    // caller tenant is rejected before the handler. The existence assertion is preserved.
    it("D11: estimateRouter has listPartialDrafts procedure (tenant-scoped)", () => {
      expect(estimateRouterFile).toContain("listPartialDrafts: tenantProcedure");
    });

    it("D12: estimateRouter has retryPartialDraft procedure (tenant-scoped)", () => {
      expect(estimateRouterFile).toContain("retryPartialDraft: tenantProcedure");
    });

    it("D13: estimateRouter has abandonPartialDraft procedure (tenant-scoped)", () => {
      expect(estimateRouterFile).toContain("abandonPartialDraft: tenantProcedure");
    });

    it("D14: estimateRouter has partialDraftStats procedure", () => {
      expect(estimateRouterFile).toContain("partialDraftStats: protectedProcedure");
    });

    it("D15: Pipeline catch block auto-saves partial draft on PipelineError", () => {
      expect(estimateRouterFile).toContain("Auto-save partial draft on pipeline failure");
      expect(estimateRouterFile).toContain("createPartialDraft({");
      expect(estimateRouterFile).toContain("scopeDraftId: input.scopeDraftId");
      expect(estimateRouterFile).toContain("failedStep: err.step");
      expect(estimateRouterFile).toContain("errorCode: err.code");
    });

    it("D16: retryPartialDraft re-executes pipeline with original context", () => {
      expect(estimateRouterFile).toContain("executeScopeToEstimatePipeline(");
      expect(estimateRouterFile).toContain("markPartialDraftRecovered(");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP E: Audit Logging Events (8 tests)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20 — GROUP E: Audit Logging Events", () => {
  it("E1: held pdf cannot produce a success artifact or export audit", () => {
    held(() => generatePdfExport(makeMockDraft(), "operator-1"));
  });

  it("E2: held json cannot produce a success artifact or export audit", () => {
    held(() => generateJsonExport(makeMockDraft(), "operator-1"));
  });

  it("E3: held printable cannot produce a success artifact or export audit", () => {
    held(() => generatePrintableExport(makeMockDraft(), "operator-1"));
  });

  it("E4: issue-report-router.ts logs issue_reported event", () => {
    expect(issueReportRouterFile).toContain('"issue_reported"');
  });

  it("E5: issue-report-router.ts logs issue_status_updated event", () => {
    expect(issueReportRouterFile).toContain('"issue_status_updated"');
  });

  it("E6: repeated old approval attempts do not publish estimate_approved", async () => {
    for (let i = 0; i < 2; i++) await expect(approveEstimateDraft("draft-1", "operator-1")).rejects.toMatchObject({ ...hold, operation: "approval" });
    expect(effects.audit).not.toHaveBeenCalled();
    expect(effects.getDb).not.toHaveBeenCalled();
  });

  it("E7: estimate-db.ts logs estimate_rejected event", () => {
    expect(estimateDbFile).toContain('"estimate_rejected"');
  });

  it("E8: draft-recovery-db.ts logs partial_draft_created event", () => {
    expect(draftRecoveryDbFile).toContain('"partial_draft_created"');
  });

  it("E9: draft-recovery-db.ts logs partial_draft_retry event", () => {
    expect(draftRecoveryDbFile).toContain('"partial_draft_retry"');
  });

  it("E10: draft-recovery-db.ts logs partial_draft_recovered event", () => {
    expect(draftRecoveryDbFile).toContain('"partial_draft_recovered"');
  });

  it("E11: draft-recovery-db.ts logs partial_draft_abandoned event", () => {
    expect(draftRecoveryDbFile).toContain('"partial_draft_abandoned"');
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP F: Export Module — Edge Cases (6 tests)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20 — GROUP F: held export edge cases", () => {
  it.each([
    ["null metadata", { metadata: null }], ["null notes", { notes: null }], ["null source", { source: null }],
  ] as const)("JSON does not invent defaults for %s", (_, fields) => {
    held(() => generateJsonExport(makeMockDraft(fields), "operator-1"));
  });
  it("does not expose pricing provenance through printable HTML", () => {
    const draft = makeMockDraft(); const before = structuredClone(draft);
    held(() => generatePrintableExport(draft, "operator-1"));
    expect(draft).toEqual(before);
  });
  it("does not fall back to printable HTML when provenance is missing", () => {
    held(() => generatePrintableExport(makeMockDraft({ metadata: {} }), "operator-1"));
  });
  it("does not paginate or inspect an assembly collection", () => {
    const read = vi.fn(() => { throw new Error("Assembly contents must not be read"); });
    const draft = Object.defineProperty(makeMockDraft(), "assemblySelections", { get: read });
    held(() => generatePdfExport(draft, "operator-1"));
    expect(read).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP G: Integration Wiring (5 tests)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20 — GROUP G: Integration Wiring", () => {
  it("G1: estimate-router.ts imports all draft recovery functions", () => {
    expect(estimateRouterFile).toContain("import {");
    expect(estimateRouterFile).toContain("createPartialDraft");
    expect(estimateRouterFile).toContain("listPartialDrafts");
    expect(estimateRouterFile).toContain("markPartialDraftRetrying");
    expect(estimateRouterFile).toContain("markPartialDraftRecovered");
    expect(estimateRouterFile).toContain("abandonPartialDraft");
    expect(estimateRouterFile).toContain("getPartialDraftStats");
  });

  it("G2: all public draft renderers refuse independently of router wiring", () => {
    for (const render of [generatePdfExport, generateJsonExport, generatePrintableExport])
      held(() => render(makeMockDraft(), "operator-1"));
  });

  it("G3: direct approval is held while the rejection route remains wired", async () => {
    await expect(approveEstimateDraft("draft-1", "operator-1")).rejects.toMatchObject({ ...hold, operation: "approval" });
    expect(effects.getDb).not.toHaveBeenCalled();
    expect(estimateRouterFile).toContain("rejectEstimateDraft");
  });

  it("G4: estimate-router.ts has exportPdf, exportJson, exportPrintable procedures", () => {
    expect(estimateRouterFile).toContain("exportPdf: protectedProcedure");
    expect(estimateRouterFile).toContain("exportJson: protectedProcedure");
    expect(estimateRouterFile).toContain("exportPrintable: protectedProcedure");
  });

  it("G5: actual detail registers operational rejection without the old approval hook", async () => {
    renderDetail();
    expect(effects.approve).not.toHaveBeenCalled();
    await effects.reject.mock.calls[0][0].onSuccess();
    expect(effects.invalidate).toHaveBeenCalledTimes(4);
    expect(effects.mutate).not.toHaveBeenCalled();
  });
});
