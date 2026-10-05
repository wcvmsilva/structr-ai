/**
 * Pure unit tests for the closed A1 `ExportAttemptSummary` response schema
 * (decision #5, MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V1-QA-AND-CORRECTION.md item
 * 5). No database, no lab gate — these prove the schema itself rejects what it
 * must reject and accepts what it must accept, independent of the writer.
 */
import { describe, expect, it } from "vitest";
import { exportAttemptSummarySchema, parseExportAttemptSummary } from "../shared/internal-estimate-export-attempt";

const READY = {
  exportId: "a1111111-0000-4000-8000-000000000001", estimateId: "a1111111-0000-4000-8000-000000000002",
  format: "json" as const, kind: "preflight" as const, outcome: "ready" as const, status: "approved_for_download" as const,
  checkedAt: "2026-10-05T00:00:00.000Z",
  authority: { approvalId: "a1111111-0000-4000-8000-000000000003", snapshotId: "a1111111-0000-4000-8000-000000000004", contentHash: "e".repeat(64) },
  validation: { state: "valid" as const, issues: [], reconciliation: { state: "matched" as const, approvedTotalMinor: "10000", exportedTotalMinor: "10000", differenceMinor: "0", estimatedCostMinor: "4000" } },
  artifact: { artifactHash: "f".repeat(64), byteLength: 100, rendererVersion: "internal-estimate-json-v1", generatedAt: "2026-10-05T00:00:00.000Z" },
  availability: "requires_revalidation" as const,
};
const BLOCKED = {
  ...READY, outcome: "blocked" as const, status: "blocked_authorization" as const, authority: null, artifact: null,
  availability: "blocked" as const,
  validation: { state: "not_evaluated" as const, issues: [{ code: "INTERNAL_APPROVAL_REQUIRED" as const, lineKey: null, field: null }], reconciliation: { state: "not_evaluated" as const, approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
};

describe("exportAttemptSummarySchema — closed A1 response DTO", () => {
  it("accepts a well-formed ready summary", () => {
    expect(exportAttemptSummarySchema.safeParse(READY).success).toBe(true);
  });
  it("accepts a well-formed blocked summary", () => {
    expect(exportAttemptSummarySchema.safeParse(BLOCKED).success).toBe(true);
  });
  it("rejects an extra top-level field (e.g. canDownload)", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...READY, canDownload: true }).success).toBe(false);
  });
  for (const field of ["content", "csvString", "data", "manifest", "url"]) {
    it(`rejects a competing '${field}' field`, () => {
      expect(exportAttemptSummarySchema.safeParse({ ...READY, [field]: "x" }).success).toBe(false);
    });
  }
  it("rejects a 'validation.version' field leaking from the internal manifest envelope", () => {
    const withVersion = { ...READY, validation: { ...READY.validation, version: "internal-estimate-export-validation-v1" } };
    expect(exportAttemptSummarySchema.safeParse(withVersion).success).toBe(false);
  });
  it("rejects outcome:ready paired with a non-ready status", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...READY, status: "blocked_authorization" }).success).toBe(false);
  });
  it("rejects outcome:blocked paired with availability:requires_revalidation", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...BLOCKED, availability: "requires_revalidation" }).success).toBe(false);
  });
  it("rejects a ready summary that still carries validation issues", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...READY, validation: { ...READY.validation, issues: [{ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: null, field: "format" }] } }).success).toBe(false);
  });
  it("rejects a ready summary with artifact:null", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...READY, artifact: null }).success).toBe(false);
  });
  it("rejects a blocked summary with zero issues", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...BLOCKED, validation: { ...BLOCKED.validation, issues: [] } }).success).toBe(false);
  });
  it("rejects a blocked summary that still carries an artifact", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...BLOCKED, artifact: READY.artifact }).success).toBe(false);
  });
  it("rejects two issues out of §5.2 rank order (reuses the engine's own exportIssueOrderIsValid)", () => {
    const unordered = {
      ...BLOCKED,
      validation: {
        ...BLOCKED.validation,
        issues: [
          { code: "EXPORT_RECONCILIATION_MISMATCH" as const, lineKey: null, field: null }, // rank 2
          { code: "INTERNAL_APPROVAL_REQUIRED" as const, lineKey: null, field: null }, // rank 0 — out of order after rank 2
        ],
      },
    };
    expect(exportAttemptSummarySchema.safeParse(unordered).success).toBe(false);
  });
  it("accepts a 20-digit minor amount (numeric(20,0) ceiling) without truncation", () => {
    const big = "9".repeat(20);
    const withBigTotal = { ...READY, validation: { ...READY.validation, reconciliation: { ...READY.validation.reconciliation, approvedTotalMinor: big, exportedTotalMinor: big } } };
    const result = exportAttemptSummarySchema.safeParse(withBigTotal);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.validation.reconciliation.approvedTotalMinor).toBe(big);
  });
  it("accepts a negative differenceMinor (signed) without rejecting the sign", () => {
    const negative = { ...READY, validation: { ...READY.validation, reconciliation: { ...READY.validation.reconciliation, differenceMinor: "-500" } } };
    expect(exportAttemptSummarySchema.safeParse(negative).success).toBe(true);
  });
  it("rejects a sub-millisecond-precision checkedAt", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...READY, checkedAt: "2026-10-05T00:00:00.123456Z" }).success).toBe(false);
  });
  it("parseExportAttemptSummary throws INTERNAL_APPROVAL_INTEGRITY_ERROR (not a bespoke error) on an invalid value", () => {
    expect(() => parseExportAttemptSummary({ ...READY, canDownload: true })).toThrow(/INTERNAL_APPROVAL_INTEGRITY_ERROR/);
  });
  it("parseExportAttemptSummary returns the parsed value unchanged on success", () => {
    expect(parseExportAttemptSummary(READY)).toEqual(READY);
  });
});
