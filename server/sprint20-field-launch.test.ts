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
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

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
  type JsonExport,
  type PrintableExport,
  type ExportMetadata,
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
  } as EstimateDraft;
}

// ══════════════════════════════════════════════════════════════════════
// GROUP A: Estimate Export Module (12 tests)
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 20 — GROUP A: Estimate Export Module", () => {
  const mockDraft = makeMockDraft();

  // ── JSON Export ──
  describe("JSON Export", () => {
    it("A1: generateJsonExport returns version 1.0", () => {
      const result = generateJsonExport(mockDraft, 1);
      expect(result.version).toBe("1.0");
    });

    it("A2: JSON export includes exportMetadata with correct format", () => {
      const result = generateJsonExport(mockDraft, 99);
      expect(result.exportMetadata).toBeDefined();
      expect(result.exportMetadata.exportedBy).toBe(99);
      expect(result.exportMetadata.format).toBe("json");
      expect(result.exportMetadata.pricingSchemaVersion).toBe("1.0");
      expect(result.exportMetadata.source).toBe("assembly_calculator");
      expect(result.exportMetadata.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("A3: JSON export includes draft metadata fields", () => {
      const result = generateJsonExport(mockDraft, 1);
      expect(result.draft.id).toBe(42);
      expect(result.draft.bundleName).toBe("Kitchen Remodel — Premium");
      expect(result.draft.status).toBe("draft");
      expect(result.draft.channel).toBe("direct");
      expect(result.draft.region).toBe("Charleston");
      expect(result.draft.finishLevel).toBe("premium");
    });

    it("A4: JSON export includes financials with all required fields", () => {
      const result = generateJsonExport(mockDraft, 1);
      expect(result.financials.subtotalCost).toBe("5000.00");
      expect(result.financials.subtotalPrice).toBe("10000.00");
      expect(result.financials.grossProfit).toBe("5000.00");
      expect(result.financials.grossProfitPct).toBe("50.00");
      expect(result.financials.discountApplied).toBe("5.00");
      expect(result.financials.discountAmount).toBe("500.00");
      expect(result.financials.finalTotalPrice).toBe("9500.00");
    });

    it("A5: JSON export includes assemblies and lineItems arrays", () => {
      const result = generateJsonExport(mockDraft, 1);
      expect(Array.isArray(result.assemblies)).toBe(true);
      expect(result.assemblies.length).toBe(1);
      expect(Array.isArray(result.lineItems)).toBe(true);
      expect(result.lineItems.length).toBe(1);
    });

    it("A6: JSON export includes provenance with contextSnapshot", () => {
      const result = generateJsonExport(mockDraft, 1);
      expect(result.provenance).toBeDefined();
      expect(result.provenance.contextSnapshot).not.toBeNull();
      expect((result.provenance.contextSnapshot as any).channel).toBe("direct");
    });
  });

  // ── PDF Export ──
  describe("PDF Export", () => {
    it("A7: generatePdfExport returns a Buffer", () => {
      const result = generatePdfExport(mockDraft, 1);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it("A8: PDF buffer is non-empty and starts with PDF header", () => {
      const result = generatePdfExport(mockDraft, 1);
      expect(result.length).toBeGreaterThan(100);
      // PDF files start with %PDF-
      const header = result.subarray(0, 5).toString("ascii");
      expect(header).toBe("%PDF-");
    });

    it("A9: PDF export handles draft without notes", () => {
      const draftNoNotes = makeMockDraft({ notes: null });
      const result = generatePdfExport(draftNoNotes, 1);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(100);
    });

    it("A10: PDF export handles draft without assemblies", () => {
      const draftNoAsm = makeMockDraft({ assemblySelections: [] });
      const result = generatePdfExport(draftNoAsm, 1);
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  // ── Printable HTML Export ──
  describe("Printable HTML Export", () => {
    it("A11: generatePrintableExport returns html and title", () => {
      const result = generatePrintableExport(mockDraft, 1);
      expect(result.html).toBeDefined();
      expect(result.title).toBeDefined();
      expect(typeof result.html).toBe("string");
      expect(typeof result.title).toBe("string");
    });

    it("A12: Printable HTML contains estimate ID and company name", () => {
      const result = generatePrintableExport(mockDraft, 1);
      expect(result.html).toContain("EST-00042");
      expect(result.html).toContain("structr.ai");
      expect(result.html).toContain("Kitchen Remodel");
      expect(result.html).toContain("$9,500.00");
      expect(result.title).toContain("EST-00042");
    });
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

    it("C5: approveEstimateDraft sets approvedBy and approvedAt", () => {
      expect(estimateDbFile).toContain("approvedBy: userId");
      expect(estimateDbFile).toContain("approvedAt: new Date()");
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

    it("C11: approve/reject audit events are logged", () => {
      expect(estimateDbFile).toContain('"estimate_approved"');
      expect(estimateDbFile).toContain('"estimate_rejected"');
    });
  });

  // ── UI ──
  describe("UI — EstimateDetail Quick Actions", () => {
    it("C12: EstimateDetail has Approve, Reject, and Reopen buttons", () => {
      expect(estimateDetailFile).toContain("Approve");
      expect(estimateDetailFile).toContain("Reject");
      expect(estimateDetailFile).toContain("Reopen as Draft");
    });

    it("C13: EstimateDetail has approval confirmation dialog", () => {
      expect(estimateDetailFile).toContain("Approve Estimate");
      expect(estimateDetailFile).toContain("Confirm Approval");
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
    it("D11: estimateRouter has listPartialDrafts procedure", () => {
      expect(estimateRouterFile).toContain("listPartialDrafts: protectedProcedure");
    });

    it("D12: estimateRouter has retryPartialDraft procedure", () => {
      expect(estimateRouterFile).toContain("retryPartialDraft: protectedProcedure");
    });

    it("D13: estimateRouter has abandonPartialDraft procedure", () => {
      expect(estimateRouterFile).toContain("abandonPartialDraft: protectedProcedure");
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
  it("E1: estimate-router.ts logs estimate.export_pdf event", () => {
    expect(estimateRouterFile).toContain('"estimate.export_pdf"');
  });

  it("E2: estimate-router.ts logs estimate.export_json event", () => {
    expect(estimateRouterFile).toContain('"estimate.export_json"');
  });

  it("E3: estimate-router.ts logs estimate.export_printable event", () => {
    expect(estimateRouterFile).toContain('"estimate.export_printable"');
  });

  it("E4: issue-report-router.ts logs issue_reported event", () => {
    expect(issueReportRouterFile).toContain('"issue_reported"');
  });

  it("E5: issue-report-router.ts logs issue_status_updated event", () => {
    expect(issueReportRouterFile).toContain('"issue_status_updated"');
  });

  it("E6: estimate-db.ts logs estimate_approved event", () => {
    expect(estimateDbFile).toContain('"estimate_approved"');
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

describe("Sprint 20 — GROUP F: Export Edge Cases", () => {
  it("F1: JSON export handles null metadata gracefully", () => {
    const draft = { ...makeMockDraft(), metadata: null };
    const result = generateJsonExport(draft, 1);
    expect(result.provenance.contextSnapshot).toBeNull();
  });

  it("F2: JSON export handles null notes", () => {
    const draft = { ...makeMockDraft(), notes: null };
    const result = generateJsonExport(draft, 1);
    expect(result.notes).toBeNull();
  });

  it("F3: JSON export handles null source", () => {
    const draft = { ...makeMockDraft(), source: null };
    const result = generateJsonExport(draft, 1);
    expect(result.exportMetadata.source).toBe("unknown");
  });

  it("F4: Printable HTML includes provenance section when contextSnapshot exists", () => {
    const draft = makeMockDraft();
    const result = generatePrintableExport(draft, 1);
    expect(result.html).toContain("Pricing Provenance");
    expect(result.html).toContain("channelMultiplier");
  });

  it("F5: Printable HTML omits provenance section when no contextSnapshot", () => {
    const draft = { ...makeMockDraft(), metadata: {} };
    const result = generatePrintableExport(draft, 1);
    expect(result.html).not.toContain("Pricing Provenance");
  });

  it("F6: PDF export handles draft with many assemblies (pagination)", () => {
    const manyAssemblies = Array.from({ length: 50 }, (_, i) => ({
      assemblyId: i + 1,
      assemblyName: `Assembly ${i + 1}`,
      category: "General",
      quantity: 1,
      unitCost: "100.00",
      unitPrice: "200.00",
      extendedCost: "100.00",
      extendedPrice: "200.00",
      grossProfitPct: "50.00",
      componentCount: 5,
    }));
    const draft = makeMockDraft({ assemblySelections: manyAssemblies as any });
    const result = generatePdfExport(draft, 1);
    expect(Buffer.isBuffer(result)).toBe(true);
    // Multi-page PDF should be larger
    expect(result.length).toBeGreaterThan(1000);
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

  it("G2: estimate-router.ts imports export functions", () => {
    expect(estimateRouterFile).toContain("generatePdfExport");
    expect(estimateRouterFile).toContain("generateJsonExport");
    expect(estimateRouterFile).toContain("generatePrintableExport");
  });

  it("G3: estimate-router.ts imports approveEstimateDraft and rejectEstimateDraft", () => {
    expect(estimateRouterFile).toContain("approveEstimateDraft");
    expect(estimateRouterFile).toContain("rejectEstimateDraft");
  });

  it("G4: estimate-router.ts has exportPdf, exportJson, exportPrintable procedures", () => {
    expect(estimateRouterFile).toContain("exportPdf: protectedProcedure");
    expect(estimateRouterFile).toContain("exportJson: protectedProcedure");
    expect(estimateRouterFile).toContain("exportPrintable: protectedProcedure");
  });

  it("G5: EstimateDetail.tsx uses trpc.estimate.approveEstimate and rejectEstimate mutations", () => {
    expect(estimateDetailFile).toContain("trpc.estimate.approveEstimate.useMutation");
    expect(estimateDetailFile).toContain("trpc.estimate.rejectEstimate.useMutation");
  });
});
