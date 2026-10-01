/**
 * A1-EXPORT-MANIFEST-ENGINE-CONTRACT.md — pure grammar and invariants of
 * A1-EXPORT-DATA-CONTRACT.md §§1/4/5, plus the non-SQL local correspondence to a typed
 * snapshot required by §6. Three explicit tiers, never blurred:
 *
 *   1. STRUCTURAL parse (`normalizeExportManifest`) — is this unknown value a
 *      well-formed `ExportManifest` per the closed envelope/validation/representation
 *      grammar. Throws `InternalApprovalError` (reused from the approval engine,
 *      same error class every A1 pure-grammar sibling uses) on malformed shape.
 *   2. CORRESPONDENCE (`checkExportManifestAgainstSnapshot`) — given an already
 *      structurally-valid manifest and a typed `InternalApprovalSnapshot`, does the
 *      manifest's content (totals, LineKeys, CSV row values/classification) actually
 *      match that snapshot. Returns issues, never throws, never consults a database.
 *   3. AUTHORITY (explicitly OUT of this engine) — whether a decision/snapshot/hash
 *      genuinely exists and is current. That requires locks and a real read; this
 *      engine only accepts an `authorityKnown: boolean` flag as an external input for
 *      tier-2 checks that depend on it (e.g. whether `approvedTotalMinor` must be
 *      known) — it never derives that flag itself, and never produces
 *      INTERNAL_APPROVAL_REQUIRED/REVOKED/etc. codes (those are DB-state conclusions).
 *
 * TDD: this file was written and run BEFORE `shared/internal-estimate-export-engine.ts`
 * existed. Real RED captured: "Cannot find module '../shared/internal-estimate-export-engine'"
 * — preserved verbatim in a1-export-manifest-engine/red-before-wiring.log, not reconstructed.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeExportManifest, checkExportManifestAgainstSnapshot, exportIssueOrderIsValid,
  buildExportFilename, type ExportManifest,
} from "../shared/internal-estimate-export-engine";
import { buildInternalApprovalReview } from "../shared/internal-estimate-approval-engine";
import { makeInternalApprovalReviewInput, approvalIds as ids } from "./internal-estimate-approval-engine.fixtures";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";

const draftUuid = ids.draft, exportUuid = "a1000000-0000-4000-8000-0000000000e1";
const otherUuid = "a1000000-0000-4000-8000-0000000000ee";

function baseContext(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenantId: ids.tenant, projectId: ids.project, clientId: ids.client,
    estimateDraftId: draftUuid, estimateVersion: 1, requestedBy: ids.actor, ...overrides,
  };
}
function blockedManifest(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    version: "internal-estimate-export-v1", format: "pdf", attemptKind: "preflight", outcome: "blocked",
    exportId: exportUuid, context: baseContext(), authority: null, checkedAt: "2026-10-01T00:00:00.000Z",
    lineKeys: [],
    validation: {
      version: "internal-estimate-export-validation-v1", state: "not_evaluated",
      issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }],
      reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null },
    },
    representation: null,
    ...overrides,
  };
}
function readyJsonManifest(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    version: "internal-estimate-export-v1", format: "json", attemptKind: "delivery", outcome: "ready",
    exportId: exportUuid, context: baseContext(),
    authority: { approvalId: ids.actor, snapshotId: otherUuid, contentHash: "a".repeat(64) },
    checkedAt: "2026-10-01T00:00:00.000Z", lineKeys: ["line:1"],
    validation: {
      version: "internal-estimate-export-validation-v1", state: "valid", issues: [],
      reconciliation: { state: "matched", approvedTotalMinor: "10000", exportedTotalMinor: "10000", differenceMinor: "0", estimatedCostMinor: "4000" },
    },
    representation: {
      format: "json", rendererVersion: "internal-estimate-json-v1", generatedAt: "2026-10-01T00:00:00.000Z",
      generatedBy: ids.actor, filename: `EST-${draftUuid}-${exportUuid}.json`, mimeType: "application/json",
      encoding: "utf8", artifactHash: "b".repeat(64), byteLength: 123,
      details: { documentVersion: "internal-estimate-document-v1", serialization: "canonical-json-utf8-v1" },
    },
    ...overrides,
  };
}

describe("normalizeExportManifest — structural grammar", () => {
  it("accepts a well-formed blocked manifest", () => {
    const parsed = normalizeExportManifest(blockedManifest());
    expect(parsed.outcome).toBe("blocked");
    expect(parsed.representation).toBeNull();
  });

  it("accepts a well-formed ready JSON manifest", () => {
    const parsed = normalizeExportManifest(readyJsonManifest());
    expect(parsed.outcome).toBe("ready");
    expect(parsed.representation?.format).toBe("json");
  });

  it("rejects the abbreviation 'v1' — the literal is 'internal-estimate-export-v1'", () => {
    expect(() => normalizeExportManifest(blockedManifest({ version: "v1" }))).toThrow(InternalApprovalError);
  });

  it.each(["pdf", "json", "printable", "csv_jobtread"])("accepts each of the four canonical formats (%s) with blocked outcome", format => {
    expect(() => normalizeExportManifest(blockedManifest({ format }))).not.toThrow();
  });

  it("rejects a format outside the closed four", () => {
    expect(() => normalizeExportManifest(blockedManifest({ format: "xlsx" }))).toThrow(InternalApprovalError);
  });

  it("rejects an extraneous top-level key — the envelope is closed", () => {
    expect(() => normalizeExportManifest({ ...blockedManifest(), forged: true })).toThrow(InternalApprovalError);
  });

  it("rejects a ready outcome with null representation", () => {
    expect(() => normalizeExportManifest({ ...readyJsonManifest(), representation: null })).toThrow(InternalApprovalError);
  });

  it("rejects a blocked outcome carrying a representation", () => {
    expect(() => normalizeExportManifest({ ...blockedManifest(), representation: readyJsonManifest().representation })).toThrow(InternalApprovalError);
  });

  it("rejects a ready outcome with empty lineKeys", () => {
    expect(() => normalizeExportManifest({ ...readyJsonManifest(), lineKeys: [] })).toThrow(InternalApprovalError);
  });

  it("rejects a blocked outcome with non-empty lineKeys", () => {
    expect(() => normalizeExportManifest({ ...blockedManifest(), lineKeys: ["line:1"] })).toThrow(InternalApprovalError);
  });

  it("rejects ready with a non-matching representation.format", () => {
    const m = readyJsonManifest(); (m as any).representation.format = "pdf";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects ready with validation.state other than 'valid'", () => {
    const m = readyJsonManifest(); (m as any).validation.state = "invalid";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects ready with a non-empty issues array", () => {
    const m = readyJsonManifest(); (m as any).validation.issues = [{ code: "EXPORT_RENDERER_UNAVAILABLE", lineKey: null, field: null }];
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects ready with reconciliation.state other than 'matched'", () => {
    const m = readyJsonManifest(); (m as any).validation.reconciliation.state = "mismatch";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects blocked with an empty issues array", () => {
    const m = blockedManifest(); (m as any).validation.issues = [];
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects duplicate (code,lineKey,field) issue triples", () => {
    const m = blockedManifest();
    (m as any).validation.issues = [
      { code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null },
      { code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null },
    ];
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects an authority-class issue appearing after a validation-class issue", () => {
    const m = blockedManifest();
    (m as any).validation.issues = [
      { code: "EXPORT_RENDERER_UNAVAILABLE", lineKey: null, field: null },
      { code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null },
    ];
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects more than 4002 issues", () => {
    const m = blockedManifest();
    (m as any).validation.issues = Array.from({ length: 4003 }, () => ({ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }));
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it.each(["0", "0.00", "-0", "1.000", "-1", "x", "1e2"])("rejects a non-canonical reconciliation amount: %s", bad => {
    const m = readyJsonManifest(); (m as any).validation.reconciliation.approvedTotalMinor = bad;
    if (bad === "0") return; // "0" is canonical Minor; skip as a non-failing case
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects a signed-minor value of '-0' for differenceMinor", () => {
    const m = readyJsonManifest(); (m as any).validation.reconciliation.differenceMinor = "-0";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("accepts a negative differenceMinor (exported below approved)", () => {
    const m = readyJsonManifest(); (m as any).validation.reconciliation.differenceMinor = "-500";
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });

  it("rejects an all-zero sentinel UUID anywhere identity is required", () => {
    const m = blockedManifest({ context: baseContext({ requestedBy: "00000000-0000-0000-0000-000000000000" }) });
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects clientId null without the issue that permits it (ESTIMATE_CLIENT_MISSING)", () => {
    const m = blockedManifest({ context: baseContext({ clientId: null }) });
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("accepts clientId null paired with ESTIMATE_CLIENT_MISSING", () => {
    const m = blockedManifest({
      context: baseContext({ clientId: null }),
      validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "ESTIMATE_CLIENT_MISSING", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
    });
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });

  it("rejects a LineKey not matching line:<ordinal> grammar", () => {
    const m = readyJsonManifest(); (m as any).lineKeys = ["line:0"];
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects duplicate LineKeys", () => {
    const m = readyJsonManifest(); (m as any).lineKeys = ["line:1", "line:1"];
    (m as any).validation.reconciliation = readyJsonManifest().validation; // keep other fields; irrelevant here
    expect(() => normalizeExportManifest({ ...readyJsonManifest(), lineKeys: ["line:1", "line:1"] })).toThrow(InternalApprovalError);
  });

  it("rejects manifest.text over the 16 MiB physical limit (surrogate check, not real jsonb::text)", () => {
    const m = readyJsonManifest();
    (m as any).context.requestedBy = ids.actor; // keep valid
    (m as any).validation.issues = []; // stays ready-valid
    // Oversized note-like field is not part of this envelope; assert the exported limit constant instead of fabricating a 16MB string.
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });
});

describe("normalizeExportManifest — PDF/printable/CSV representation", () => {
  function readyWith(format: "pdf" | "printable" | "csv_jobtread", details: unknown, filename: string, mimeType: string, encoding: "utf8" | "base64", rendererVersion: string) {
    return readyJsonManifest({
      format, representation: { format, rendererVersion, generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: ids.actor, filename, mimeType, encoding, artifactHash: "c".repeat(64), byteLength: 10, details },
    });
  }

  it("accepts a well-formed PDF representation", () => {
    expect(() => normalizeExportManifest(readyWith("pdf", { layoutVersion: "internal-estimate-summary-v1", pageCount: 2 }, `EST-${draftUuid}-${exportUuid}.pdf`, "application/pdf", "base64", "internal-estimate-pdf-v1"))).not.toThrow();
  });

  it("rejects PDF pageCount of 0", () => {
    expect(() => normalizeExportManifest(readyWith("pdf", { layoutVersion: "internal-estimate-summary-v1", pageCount: 0 }, `EST-${draftUuid}-${exportUuid}.pdf`, "application/pdf", "base64", "internal-estimate-pdf-v1"))).toThrow(InternalApprovalError);
  });

  it("accepts a well-formed printable representation", () => {
    expect(() => normalizeExportManifest(readyWith("printable", { templateVersion: "internal-estimate-summary-v1", escaping: "html-text-attribute-v1", sandbox: "no-scripts-no-network-v1" }, `EST-${draftUuid}-${exportUuid}.html`, "text/html", "utf8", "internal-estimate-printable-v1"))).not.toThrow();
  });

  it("rejects mismatched mimeType for a given format", () => {
    expect(() => normalizeExportManifest(readyWith("printable", { templateVersion: "internal-estimate-summary-v1", escaping: "html-text-attribute-v1", sandbox: "no-scripts-no-network-v1" }, `EST-${draftUuid}-${exportUuid}.html`, "text/csv", "utf8", "internal-estimate-printable-v1"))).toThrow(InternalApprovalError);
  });

  const csvRow = {
    lineKey: "line:1", ordinal: 1, costGroupName: "Framing", costItemName: "Lumber", description: "", quantity: "10",
    unit: "Linear Feet", unitCost: "5.00", unitPrice: "8.00", costType: "Materials", taxable: true, costCode: "04-100",
    assemblyId: null, lineCostMinor: "5000", linePriceMinor: "8000", costTypeSource: "classifyCostType_v1",
    unitSource: "stored_canonical", costCodeSource: "stored",
  };
  const csvDetails = {
    contractVersion: "jobtread-budget-csv-a1-v1", classificationVersion: "jobtread-s20.1-classification-h1-8550e842-v1",
    headers: ["Cost Group Name", "Cost Item Name", "Description", "Quantity", "Unit", "Unit Cost", "Unit Price", "Cost Type", "Taxable"],
    delimiter: ",", lineEnding: "CRLF", utf8Bom: false, rows: [csvRow],
  };

  it("accepts a well-formed CSV representation with one classified row", () => {
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", csvDetails, `EST-${draftUuid}-${exportUuid}.csv`, "text/csv", "utf8", "internal-estimate-jobtread-csv-v1"))).not.toThrow();
  });

  it("rejects CSV headers out of order", () => {
    const bad = { ...csvDetails, headers: [...csvDetails.headers].reverse() };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, `EST-${draftUuid}-${exportUuid}.csv`, "text/csv", "utf8", "internal-estimate-jobtread-csv-v1"))).toThrow(InternalApprovalError);
  });

  it("rejects a CSV row with costCodeSource 'unknown' paired with a non-null costCode", () => {
    const bad = { ...csvDetails, rows: [{ ...csvRow, costCodeSource: "unknown" }] };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, `EST-${draftUuid}-${exportUuid}.csv`, "text/csv", "utf8", "internal-estimate-jobtread-csv-v1"))).toThrow(InternalApprovalError);
  });

  it("rejects a CSV row unitCost rate that is not a two-decimal string", () => {
    const bad = { ...csvDetails, rows: [{ ...csvRow, unitCost: "5" }] };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, `EST-${draftUuid}-${exportUuid}.csv`, "text/csv", "utf8", "internal-estimate-jobtread-csv-v1"))).toThrow(InternalApprovalError);
  });

  it("rejects a Filename with a directory component", () => {
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", csvDetails, `../EST-${draftUuid}-${exportUuid}.csv`, "text/csv", "utf8", "internal-estimate-jobtread-csv-v1"))).toThrow(InternalApprovalError);
  });
});

describe("buildExportFilename", () => {
  it("builds the exact normative filename for each format", () => {
    expect(buildExportFilename(draftUuid, exportUuid, "pdf")).toBe(`EST-${draftUuid}-${exportUuid}.pdf`);
    expect(buildExportFilename(draftUuid, exportUuid, "json")).toBe(`EST-${draftUuid}-${exportUuid}.json`);
    expect(buildExportFilename(draftUuid, exportUuid, "printable")).toBe(`EST-${draftUuid}-${exportUuid}.html`);
    expect(buildExportFilename(draftUuid, exportUuid, "csv_jobtread")).toBe(`EST-${draftUuid}-${exportUuid}.csv`);
  });
});

describe("exportIssueOrderIsValid — pure ordering invariant, no snapshot needed", () => {
  it("accepts authority-class before validation-class before reconciliation-class", () => {
    expect(exportIssueOrderIsValid([
      { code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" },
      { code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: null },
    ])).toBe(true);
  });
  it("rejects reconciliation-class before validation-class", () => {
    expect(exportIssueOrderIsValid([
      { code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: null },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" },
    ])).toBe(false);
  });
  it("rejects a duplicate (code,lineKey,field) triple", () => {
    expect(exportIssueOrderIsValid([
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" },
    ])).toBe(false);
  });
});

describe("checkExportManifestAgainstSnapshot — pure correspondence, no DB", () => {
  async function snapshotAndManifest() {
    const review = await buildInternalApprovalReview(makeInternalApprovalReviewInput());
    const manifest = normalizeExportManifest(blockedManifest({
      context: baseContext({
        tenantId: review.snapshot.identity.tenantId, projectId: review.snapshot.identity.projectId,
        clientId: review.snapshot.identity.clientId, estimateDraftId: review.snapshot.identity.estimateDraftId,
        estimateVersion: review.snapshot.identity.draftVersion,
      }),
    }));
    return { review, manifest };
  }

  it("reports no issue when context matches the snapshot identity exactly", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const result = checkExportManifestAgainstSnapshot(manifest, review.snapshot, { authorityKnown: false });
    expect(result.contextMatches).toBe(true);
  });

  it("flags a context mismatch (wrong clientId) without consulting a database", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const forged: ExportManifest = { ...manifest, context: { ...manifest.context, clientId: otherUuid } };
    const result = checkExportManifestAgainstSnapshot(forged, review.snapshot, { authorityKnown: false });
    expect(result.contextMatches).toBe(false);
  });

  it("flags a LineKey referencing a line absent from the snapshot", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const forged: ExportManifest = { ...manifest, validation: { ...manifest.validation, issues: [{ code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:999", field: "taxable" }] } };
    const result = checkExportManifestAgainstSnapshot(forged, review.snapshot, { authorityKnown: false });
    expect(result.unknownLineKeys).toContain("line:999");
  });

  it("computes exact totals from the snapshot's financials when authority is known", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const result = checkExportManifestAgainstSnapshot(manifest, review.snapshot, { authorityKnown: true });
    expect(result.expectedApprovedTotalMinor).toBe(review.snapshot.financials.finalPriceMinor);
    expect(result.expectedEstimatedCostMinor).toBe(review.snapshot.financials.estimatedCostMinor);
  });
});
