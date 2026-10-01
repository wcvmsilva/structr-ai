/**
 * A1-EXPORT-MANIFEST-ENGINE-CONTRACT.md — pure grammar and invariants of
 * A1-EXPORT-DATA-CONTRACT.md §§1/4/5, plus the non-SQL local correspondence to a typed
 * snapshot required by §6. Three explicit tiers, never blurred:
 *
 *   1. STRUCTURAL parse (`normalizeExportManifest`) — is this unknown value a
 *      well-formed `ExportManifest` per the closed envelope/validation/representation
 *      grammar, INCLUDING the full local state matrix of §4/§5.2 (authority
 *      presence, totals, reconciliation/validation state, client nullability) derived
 *      purely from the manifest's own `outcome` and principal issue code. Throws
 *      `InternalApprovalError` on any violation.
 *   2. CORRESPONDENCE (`checkExportManifestAgainstSnapshot`) — given an already
 *      structurally-valid manifest and a typed `InternalApprovalSnapshot`, does the
 *      manifest's content (hash, totals, LineKeys, CSV row values/classification)
 *      actually match that snapshot. Async (it hashes), returns match/mismatch
 *      booleans, never throws, never consults a database.
 *   3. AUTHORITY (explicitly OUT of this engine) — whether a decision/snapshot/hash
 *      genuinely exists and is current. That requires locks and a real read; this
 *      engine only accepts an `authorityKnown: boolean` flag as an external input for
 *      tier-2 checks that depend on it — it never derives that flag itself, and
 *      `normalizeExportManifest` never accepts such a flag at all.
 *
 * V2 — 2026-10-01, closing MICHAEL-A1-EXPORT-MANIFEST-V1-QA-AND-CORRECTION.md's six
 * groups. The 16 real QA counterexamples (`qa-counterexamples.mts` in
 * `a1-export-manifest-v1-review-inputs/`) are reproduced below as kept, named test
 * cases rather than left as an external diagnostic script. Each one that V1 wrongly
 * accepted/rejected was re-run against the UNCHANGED V1 commit (`63d584e9`) to capture
 * a genuine RED for the SAME reason QA found — preserved in
 * `a1-export-manifest-engine-v2/red-before-v2-fix.log` — before the V2 fix below made
 * it pass. This is not the stash-retroactive technique: 63d584e9 is a real, already
 * committed, already-reviewed prior artifact, not code written in this same pass.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeExportManifest, checkExportManifestAgainstSnapshot, checkExportCsvRowAgainstLine, exportIssueOrderIsValid,
  buildExportFilename, type ExportManifest,
} from "../shared/internal-estimate-export-engine";
import { buildInternalApprovalReview } from "../shared/internal-estimate-approval-engine";
import { makeInternalApprovalReviewInput, approvalIds as ids } from "./internal-estimate-approval-engine.fixtures";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import { EXPORT_CSV_HEADERS } from "../shared/domain/taxonomy";

const draftUuid = ids.draft, exportUuid = "a1000000-0000-4000-8000-0000000000e1";
const snapshotUuid = "a1000000-0000-4000-8000-0000000000ee", otherUuid = "a1000000-0000-4000-8000-0000000000ff";

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
    authority: { approvalId: ids.approval, snapshotId: snapshotUuid, contentHash: "a".repeat(64) },
    checkedAt: "2026-10-01T00:00:00.000Z", lineKeys: ["line:1"],
    validation: {
      version: "internal-estimate-export-validation-v1", state: "valid", issues: [],
      reconciliation: { state: "matched", approvedTotalMinor: "10000", exportedTotalMinor: "10000", differenceMinor: "0", estimatedCostMinor: "4000" },
    },
    representation: {
      format: "json", rendererVersion: "internal-estimate-json-v1", generatedAt: "2026-10-01T00:00:00.000Z",
      generatedBy: ids.actor, filename: buildExportFilename(draftUuid, exportUuid, "json"), mimeType: "application/json",
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

  it("rejects ready with a non-empty issues array", () => {
    const m = readyJsonManifest(); (m as any).validation.issues = [{ code: "EXPORT_RENDERER_UNAVAILABLE", lineKey: null, field: null }];
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
    (m as any).validation.state = "invalid";
    (m as any).validation.reconciliation.state = "unrepresentable";
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

  it.each(["0.00", "-0", "1.000", "x", "1e2"])("rejects a non-canonical reconciliation amount: %s", bad => {
    const m = readyJsonManifest(); (m as any).validation.reconciliation.approvedTotalMinor = bad;
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects a signed-minor value of '-0' for differenceMinor", () => {
    const m = readyJsonManifest(); (m as any).validation.reconciliation.differenceMinor = "-0";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects an all-zero sentinel UUID anywhere identity is required", () => {
    const m = blockedManifest({ context: baseContext({ requestedBy: "00000000-0000-0000-0000-000000000000" }) });
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects clientId null without an issue that permits it", () => {
    const m = blockedManifest({ context: baseContext({ clientId: null }) });
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects a LineKey not matching line:<ordinal> grammar", () => {
    const m = readyJsonManifest(); (m as any).lineKeys = ["line:0"];
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects duplicate LineKeys", () => {
    expect(() => normalizeExportManifest({ ...readyJsonManifest(), lineKeys: ["line:1", "line:1"] })).toThrow(InternalApprovalError);
  });

  it("rejects representation.generatedAt after checkedAt", () => {
    const m = readyJsonManifest();
    (m as any).representation.generatedAt = "2026-10-01T00:00:00.001Z";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });
});

describe("normalizeExportManifest — PDF/printable/CSV representation", () => {
  function readyWith(format: "pdf" | "printable" | "csv_jobtread", details: unknown, rendererVersion: string, mimeType: string, encoding: "utf8" | "base64") {
    return readyJsonManifest({
      format,
      representation: {
        format, rendererVersion, generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: ids.actor,
        filename: buildExportFilename(draftUuid, exportUuid, format), mimeType, encoding, artifactHash: "c".repeat(64), byteLength: 10, details,
      },
    });
  }

  it("accepts a well-formed PDF representation", () => {
    expect(() => normalizeExportManifest(readyWith("pdf", { layoutVersion: "internal-estimate-summary-v1", pageCount: 2 }, "internal-estimate-pdf-v1", "application/pdf", "base64"))).not.toThrow();
  });

  it("rejects PDF pageCount of 0", () => {
    expect(() => normalizeExportManifest(readyWith("pdf", { layoutVersion: "internal-estimate-summary-v1", pageCount: 0 }, "internal-estimate-pdf-v1", "application/pdf", "base64"))).toThrow(InternalApprovalError);
  });

  it("accepts a well-formed printable representation", () => {
    expect(() => normalizeExportManifest(readyWith("printable", { templateVersion: "internal-estimate-summary-v1", escaping: "html-text-attribute-v1", sandbox: "no-scripts-no-network-v1" }, "internal-estimate-printable-v1", "text/html", "utf8"))).not.toThrow();
  });

  it("rejects mismatched mimeType for a given format", () => {
    expect(() => normalizeExportManifest(readyWith("printable", { templateVersion: "internal-estimate-summary-v1", escaping: "html-text-attribute-v1", sandbox: "no-scripts-no-network-v1" }, "internal-estimate-printable-v1", "text/csv", "utf8"))).toThrow(InternalApprovalError);
  });

  const csvRow = {
    lineKey: "line:1", ordinal: 1, costGroupName: "Framing", costItemName: "Lumber", description: "", quantity: "10",
    unit: "Linear Feet", unitCost: "5.00", unitPrice: "8.00", costType: "Materials", taxable: true, costCode: "04-100",
    assemblyId: null, lineCostMinor: "5000", linePriceMinor: "8000", costTypeSource: "classifyCostType_v1",
    unitSource: "stored_canonical", costCodeSource: "stored",
  };
  const csvDetails = {
    contractVersion: "jobtread-budget-csv-a1-v1", classificationVersion: "jobtread-s20.1-classification-h1-8550e842-v1",
    headers: EXPORT_CSV_HEADERS, delimiter: ",", lineEnding: "CRLF", utf8Bom: false, rows: [csvRow],
  };

  it("accepts a well-formed CSV representation with one classified row", () => {
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", csvDetails, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8"))).not.toThrow();
  });

  it("rejects CSV headers out of order", () => {
    const bad = { ...csvDetails, headers: [...csvDetails.headers].reverse() };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8"))).toThrow(InternalApprovalError);
  });

  it("rejects an arbitrary/forged classificationVersion (QA: csv-unknown-classification-version)", () => {
    const bad = { ...csvDetails, classificationVersion: "forged-v99" };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8"))).toThrow(InternalApprovalError);
  });

  it("rejects a CSV row with costCodeSource 'unknown' and costCode null — ready CSV never carries unreviewed classification (QA: csv-ready-null-code-unknown-source)", () => {
    const bad = { ...csvDetails, rows: [{ ...csvRow, costCode: null, costCodeSource: "unknown" }] };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8"))).toThrow(InternalApprovalError);
  });

  it("rejects zero CSV rows (QA: csv-ready-empty-rows)", () => {
    const bad = { ...csvDetails, rows: [] };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8"))).toThrow(InternalApprovalError);
  });

  it("rejects a CSV row unitCost rate that is not a two-decimal string", () => {
    const bad = { ...csvDetails, rows: [{ ...csvRow, unitCost: "5" }] };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8"))).toThrow(InternalApprovalError);
  });

  it("rejects a CSV row count that does not match lineKeys.length", () => {
    const bad = { ...csvDetails, rows: [csvRow, { ...csvRow, lineKey: "line:2", ordinal: 2 }] };
    expect(() => normalizeExportManifest(readyWith("csv_jobtread", bad, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8"))).toThrow(InternalApprovalError);
  });

  it("rejects a Filename with a directory component", () => {
    const m: any = readyWith("csv_jobtread", csvDetails, "internal-estimate-jobtread-csv-v1", "text/csv", "utf8");
    m.representation.filename = `../${m.representation.filename}`;
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });
});

describe("normalizeExportManifest — representation identity (QA group 2)", () => {
  it("rejects generatedBy other than the manifest's own requestedBy (QA: ready-other-generatedBy)", () => {
    const m: any = readyJsonManifest();
    m.representation.generatedBy = ids.client;
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects a Filename encoding a different draft/export id than the manifest's own (QA: ready-filename-wrong-draft-and-export)", () => {
    const m: any = readyJsonManifest();
    m.representation.filename = `EST-${ids.project}-${ids.client}.json`;
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });
});

describe("normalizeExportManifest — §4/§5.2 local state matrix (QA group 1)", () => {
  it("rejects ready with null authority (QA: ready-null-authority)", () => {
    const m = readyJsonManifest({ authority: null });
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects ready with every total/cost null (QA: ready-null-totals)", () => {
    const m = readyJsonManifest();
    (m as any).validation.reconciliation = { state: "matched", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null };
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects ready with approved=exported=0 (QA: ready-zero-totals)", () => {
    const m = readyJsonManifest();
    (m as any).validation.reconciliation.approvedTotalMinor = "0";
    (m as any).validation.reconciliation.exportedTotalMinor = "0";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects ready with a difference that is not exported-approved (QA: ready-mismatched-totals-and-difference)", () => {
    const m = readyJsonManifest();
    (m as any).validation.reconciliation.exportedTotalMinor = "7";
    (m as any).validation.reconciliation.differenceMinor = "99";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("rejects blocked INTERNAL_APPROVAL_REQUIRED paired with validation=valid/reconciliation=matched (QA: blocked-required-but-valid-matched)", () => {
    const m = blockedManifest();
    (m as any).validation.state = "valid";
    (m as any).validation.reconciliation.state = "matched";
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("accepts clientId null paired with ESTIMATE_CLIENT_CONTEXT_MISMATCH — the legitimate case (QA: blocked-client-context-mismatch-null-is-valid)", () => {
    const m = blockedManifest({
      context: baseContext({ clientId: null }),
      validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "ESTIMATE_CLIENT_CONTEXT_MISMATCH", lineKey: null, field: "identity" }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
    });
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });

  it("still accepts clientId null paired with ESTIMATE_CLIENT_MISSING", () => {
    const m = blockedManifest({
      context: baseContext({ clientId: null }),
      validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "ESTIMATE_CLIENT_MISSING", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
    });
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });

  it("rejects EXPORT_FORMAT_UNREPRESENTABLE declared with null authority — a validation-class block always has authority known (QA: blocked-format-without-authority)", () => {
    const m = blockedManifest({
      validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: null, field: "format" }], reconciliation: { state: "unrepresentable", approvedTotalMinor: "10000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "4000" } },
    });
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
  });

  it("accepts EXPORT_FORMAT_UNREPRESENTABLE with authority known and the right totals class", () => {
    const m = blockedManifest({
      authority: { approvalId: ids.approval, snapshotId: snapshotUuid, contentHash: "a".repeat(64) },
      validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: null, field: "format" }], reconciliation: { state: "unrepresentable", approvedTotalMinor: "10000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "4000" } },
    });
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });

  it("accepts INTERNAL_APPROVAL_REVOKED with authority known, approved-only totals", () => {
    const m = blockedManifest({
      authority: { approvalId: ids.approval, snapshotId: snapshotUuid, contentHash: "a".repeat(64) },
      validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REVOKED", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: "10000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "4000" } },
    });
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });

  it("accepts EXPORT_RECONCILIATION_MISMATCH with a real negative difference matching exported-approved", () => {
    const m = blockedManifest({
      authority: { approvalId: ids.approval, snapshotId: snapshotUuid, contentHash: "a".repeat(64) },
      validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: "currency" }], reconciliation: { state: "mismatch", approvedTotalMinor: "10000", exportedTotalMinor: "9500", differenceMinor: "-500", estimatedCostMinor: "4000" } },
    });
    expect(() => normalizeExportManifest(m)).not.toThrow();
  });

  it("rejects EXPORT_RECONCILIATION_MISMATCH whose differenceMinor is not exported-approved", () => {
    const m = blockedManifest({
      authority: { approvalId: ids.approval, snapshotId: snapshotUuid, contentHash: "a".repeat(64) },
      validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: "currency" }], reconciliation: { state: "mismatch", approvedTotalMinor: "10000", exportedTotalMinor: "9500", differenceMinor: "-999", estimatedCostMinor: "4000" } },
    });
    expect(() => normalizeExportManifest(m)).toThrow(InternalApprovalError);
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
  it("rejects line:2 appearing before line:1 within the same class (QA: line-issue-order-reversed)", () => {
    expect(exportIssueOrderIsValid([
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:2", field: "taxable" },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" },
    ])).toBe(false);
  });
  it("accepts ascending LineKey ordinal, then field-table order, within the same class", () => {
    expect(exportIssueOrderIsValid([
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "unit" },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "unitCost" },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:2", field: "unit" },
    ])).toBe(true);
  });
});

describe("checkExportManifestAgainstSnapshot — pure correspondence, no DB", () => {
  async function snapshotAndManifest() {
    const review = await buildInternalApprovalReview(makeInternalApprovalReviewInput());
    const manifest = normalizeExportManifest(readyJsonManifest({
      context: baseContext({
        tenantId: review.snapshot.identity.tenantId, projectId: review.snapshot.identity.projectId,
        clientId: review.snapshot.identity.clientId, estimateDraftId: review.snapshot.identity.estimateDraftId,
        estimateVersion: review.snapshot.identity.draftVersion,
      }),
      authority: { approvalId: ids.approval, snapshotId: snapshotUuid, contentHash: review.contentHash },
      validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: review.snapshot.financials.finalPriceMinor, exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0", estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
    }));
    return { review, manifest };
  }

  it("reports every match when the manifest genuinely corresponds to the snapshot", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const result = await checkExportManifestAgainstSnapshot(manifest, review.snapshot, { authorityKnown: true });
    expect(result.contextMatches).toBe(true);
    expect(result.contentHashMatches).toBe(true);
    expect(result.approvedTotalMatches).toBe(true);
    expect(result.estimatedCostMatches).toBe(true);
    expect(result.lineKeysMatchSnapshotExactly).toBe(true);
  });

  it("flags a context mismatch (wrong clientId) without consulting a database", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const forged: ExportManifest = { ...manifest, context: { ...manifest.context, clientId: otherUuid } };
    const result = await checkExportManifestAgainstSnapshot(forged, review.snapshot, { authorityKnown: true });
    expect(result.contextMatches).toBe(false);
  });

  it("flags a LineKey referencing a line absent from the snapshot", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const forged: ExportManifest = { ...manifest, validation: { ...manifest.validation, issues: [{ code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:999", field: "taxable" }] } };
    const result = await checkExportManifestAgainstSnapshot(forged, review.snapshot, { authorityKnown: true });
    expect(result.unknownLineKeys).toContain("line:999");
  });

  it("flags mismatched totals and a forged contentHash (QA: snapshot-wrong-totals-and-hash)", async () => {
    const { review, manifest } = await snapshotAndManifest();
    const wrong: ExportManifest = {
      ...manifest,
      authority: { ...manifest.authority!, contentHash: "f".repeat(64) },
      validation: { ...manifest.validation, reconciliation: { ...manifest.validation.reconciliation, approvedTotalMinor: "1", estimatedCostMinor: "1" } },
    };
    const result = await checkExportManifestAgainstSnapshot(wrong, review.snapshot, { authorityKnown: true });
    expect(result.contentHashMatches).toBe(false);
    expect(result.approvedTotalMatches).toBe(false);
    expect(result.estimatedCostMatches).toBe(false);
  });

  it("flags a manifest whose lineKeys are a proper prefix of the snapshot's lines, not the whole sequence (QA: snapshot-linekeys-proper-prefix)", async () => {
    const input = makeInternalApprovalReviewInput();
    input.lines.push({ ...input.lines[0], lineKey: "line:2", ordinal: 2 });
    input.financials.subtotalPriceMinor = "20000"; input.financials.finalPriceMinor = "20000"; input.financials.estimatedCostMinor = "8000";
    const review = await buildInternalApprovalReview(input);
    const { manifest } = await snapshotAndManifest();
    const result = await checkExportManifestAgainstSnapshot(manifest, review.snapshot, { authorityKnown: true });
    expect(result.lineKeysMatchSnapshotExactly).toBe(false);
  });
});

describe("checkExportCsvRowAgainstLine — pure per-row correspondence, no DB (QA group 3)", () => {
  it("reports every match for a row that genuinely mirrors its snapshot line", async () => {
    const review = await buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(), lines: [{ ...makeInternalApprovalReviewInput().lines[0], taxable: true }] });
    const line = review.snapshot.lines[0], frozen = line.csvClassification!;
    const row = {
      lineKey: line.lineKey, ordinal: line.ordinal, costGroupName: line.costGroupName, costItemName: line.costItemName,
      description: line.description ?? "", quantity: line.quantity, unit: frozen.normalizedUnit, unitCost: "20.00", unitPrice: "50.00",
      costType: frozen.costType, taxable: line.taxable, costCode: frozen.costCode, assemblyId: line.assemblyId,
      lineCostMinor: line.lineTotalCostMinor, linePriceMinor: line.lineTotalPriceMinor, costTypeSource: frozen.costTypeSource,
      unitSource: frozen.unitSource, costCodeSource: frozen.costCodeSource,
    } as const;
    const result = checkExportCsvRowAgainstLine(row, review.snapshot);
    expect(result.lineMissing).toBe(false);
    expect(result.identityMatches).toBe(true);
    expect(result.classificationMatches).toBe(true);
  });

  it("flags forged names/description/quantity/assemblyId as a non-match (QA: csv-forged-names-description-quantity-assembly)", async () => {
    const review = await buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(), lines: [{ ...makeInternalApprovalReviewInput().lines[0], taxable: true }] });
    const line = review.snapshot.lines[0], frozen = line.csvClassification!;
    const row = {
      lineKey: line.lineKey, ordinal: line.ordinal, costGroupName: "FORGED", costItemName: "FORGED",
      description: "FORGED", quantity: "999", unit: frozen.normalizedUnit, unitCost: "20.00", unitPrice: "50.00",
      costType: frozen.costType, taxable: line.taxable, costCode: frozen.costCode, assemblyId: null,
      lineCostMinor: line.lineTotalCostMinor, linePriceMinor: line.lineTotalPriceMinor, costTypeSource: frozen.costTypeSource,
      unitSource: frozen.unitSource, costCodeSource: frozen.costCodeSource,
    } as const;
    const result = checkExportCsvRowAgainstLine(row, review.snapshot);
    expect(result.identityMatches).toBe(false);
  });

  it("reports the line as missing when the LineKey is not in the snapshot", async () => {
    const review = await buildInternalApprovalReview(makeInternalApprovalReviewInput());
    const row = {
      lineKey: "line:999", ordinal: 999, costGroupName: "X", costItemName: "X", description: "", quantity: "1",
      unit: "Each", unitCost: "1.00", unitPrice: "1.00", costType: "Materials", taxable: true, costCode: "01-100",
      assemblyId: null, lineCostMinor: "100", linePriceMinor: "100", costTypeSource: "classifyCostType_v1",
      unitSource: "stored_canonical", costCodeSource: "stored",
    } as const;
    expect(checkExportCsvRowAgainstLine(row, review.snapshot).lineMissing).toBe(true);
  });
});
