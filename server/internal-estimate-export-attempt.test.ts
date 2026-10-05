/**
 * Pure unit tests for the closed A1 `ExportAttemptSummary` response schema
 * (decision #5 of V2; MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V2-QA-AND-CORRECTION.md
 * item A corrects and extends this file's own invariants). No database, no lab
 * gate — these prove the schema itself rejects what it must reject and accepts
 * what it must accept, independent of the writer.
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
// A real "authority-required" blocked class (REVOKED/SUPERSEDED): totals class
// "approvedOnly" — approvedTotalMinor/estimatedCostMinor present, exportedTotalMinor/
// differenceMinor absent, state "not_evaluated", authority non-null.
const REVOKED = {
  ...BLOCKED,
  validation: { state: "not_evaluated" as const, issues: [{ code: "INTERNAL_APPROVAL_REVOKED" as const, lineKey: null, field: null }], reconciliation: { state: "not_evaluated" as const, approvedTotalMinor: "10000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "4000" } },
  authority: READY.authority,
};
// A real rank-2 EXPORT_RECONCILIATION_MISMATCH: totals class "full", state
// "mismatch", status blocked_reconciliation, authority non-null — the ONLY
// class where a nonzero (and legitimately negative) differenceMinor is valid.
const MISMATCH = {
  ...BLOCKED, status: "blocked_reconciliation" as const, authority: READY.authority,
  validation: { state: "invalid" as const, issues: [{ code: "EXPORT_RECONCILIATION_MISMATCH" as const, lineKey: null, field: null }], reconciliation: { state: "mismatch" as const, approvedTotalMinor: "10000", exportedTotalMinor: "9500", differenceMinor: "-500", estimatedCostMinor: "4000" } },
};

describe("exportAttemptSummarySchema — closed A1 response DTO", () => {
  it("accepts a well-formed ready summary", () => {
    expect(exportAttemptSummarySchema.safeParse(READY).success).toBe(true);
  });
  it("accepts a well-formed blocked (authority-null) summary", () => {
    expect(exportAttemptSummarySchema.safeParse(BLOCKED).success).toBe(true);
  });
  it("accepts a well-formed revoked (authority-required, approvedOnly totals) summary", () => {
    expect(exportAttemptSummarySchema.safeParse(REVOKED).success).toBe(true);
  });
  it("accepts a well-formed reconciliation-mismatch (full totals, legitimate negative difference) summary", () => {
    expect(exportAttemptSummarySchema.safeParse(MISMATCH).success).toBe(true);
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
  it("rejects a sub-millisecond-precision checkedAt", () => {
    expect(exportAttemptSummarySchema.safeParse({ ...READY, checkedAt: "2026-10-05T00:00:00.123456Z" }).success).toBe(false);
  });

  // MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V2-QA-AND-CORRECTION.md item A: the exact
  // nine cases dto-probe.mjs proved were wrongly accepted by V2's four-relation
  // superRefine. Reproduced verbatim (not re-derived) against the corrected schema.
  describe("item A — the nine cases dto-probe.mjs found wrongly accepted", () => {
    const cases: [string, unknown][] = [
      ["1. ready without authority", { ...READY, authority: null }],
      ["2. ready with invalid validation state", { ...READY, validation: { ...READY.validation, state: "invalid" } }],
      ["3. ready with all money absent", { ...READY, validation: { ...READY.validation, reconciliation: { state: "matched", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } } }],
      ["4. ready with contradictory negative difference (approved=exported, difference=-500)", { ...READY, validation: { ...READY.validation, reconciliation: { ...READY.validation.reconciliation, differenceMinor: "-500" } } }],
      ["5. preflight marked downloaded", { ...READY, status: "downloaded" }],
      ["6. generatedAt after checkedAt", { ...READY, artifact: { ...READY.artifact, generatedAt: "2026-10-06T00:00:00.000Z" } }],
      ["7. INTERNAL_APPROVAL_REQUIRED with authority supplied", { ...BLOCKED, authority: READY.authority }],
      ["8. INTERNAL_APPROVAL_REQUIRED with status needs_exception_review", { ...BLOCKED, status: "needs_exception_review" }],
      ["9. JSON format with PDF rendererVersion", { ...READY, artifact: { ...READY.artifact, rendererVersion: "internal-estimate-pdf-v1" } }],
    ];
    for (const [name, input] of cases) {
      it(`rejects: ${name}`, () => {
        expect(exportAttemptSummarySchema.safeParse(input).success).toBe(false);
      });
    }
    it("the fixed set is exactly nine (no case silently dropped)", () => {
      expect(cases).toHaveLength(9);
    });
  });

  describe("additional invariants closing the same relation classes", () => {
    it("accepts a legitimate negative differenceMinor on a real reconciliation-mismatch (distinct from the rejected ready case above)", () => {
      expect(exportAttemptSummarySchema.safeParse(MISMATCH).success).toBe(true);
    });
    it("rejects EXPORT_RECONCILIATION_MISMATCH with a zero difference (contradicts the code's own meaning)", () => {
      const zero = { ...MISMATCH, validation: { ...MISMATCH.validation, reconciliation: { ...MISMATCH.validation.reconciliation, exportedTotalMinor: "10000", differenceMinor: "0" } } };
      expect(exportAttemptSummarySchema.safeParse(zero).success).toBe(false);
    });
    it("rejects EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED mapped to blocked_reconciliation instead of needs_exception_review", () => {
      const wrong = {
        ...MISMATCH, status: "blocked_reconciliation" as const,
        validation: { ...MISMATCH.validation, issues: [{ code: "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED" as const, lineKey: null, field: "discount" as const }], reconciliation: { ...MISMATCH.validation.reconciliation, state: "unrepresentable" as const } },
      };
      expect(exportAttemptSummarySchema.safeParse(wrong).success).toBe(false);
    });
    it("rejects INTERNAL_APPROVAL_REVOKED without authority (the authority-required class, inverse of case 7)", () => {
      expect(exportAttemptSummarySchema.safeParse({ ...REVOKED, authority: null }).success).toBe(false);
    });
    it("rejects a rank-1 validation code (EXPORT_PAYLOAD_TOO_LARGE) mapped to blocked_authorization", () => {
      const wrong = { ...BLOCKED, status: "blocked_authorization" as const, validation: { state: "invalid" as const, issues: [{ code: "EXPORT_PAYLOAD_TOO_LARGE" as const, lineKey: null, field: "bytes" as const }], reconciliation: { state: "unrepresentable" as const, approvedTotalMinor: "10000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "4000" } } };
      expect(exportAttemptSummarySchema.safeParse(wrong).success).toBe(false); // correct status for this code is blocked_validation
    });
    it("rejects REVOKED (approvedOnly totals class) with an exportedTotalMinor present", () => {
      const wrong = { ...REVOKED, validation: { ...REVOKED.validation, reconciliation: { ...REVOKED.validation.reconciliation, exportedTotalMinor: "10000", differenceMinor: "0" } } };
      expect(exportAttemptSummarySchema.safeParse(wrong).success).toBe(false);
    });
    it("rejects a ready summary whose approvedTotalMinor and exportedTotalMinor disagree", () => {
      const wrong = { ...READY, validation: { ...READY.validation, reconciliation: { ...READY.validation.reconciliation, exportedTotalMinor: "9999" } } };
      expect(exportAttemptSummarySchema.safeParse(wrong).success).toBe(false);
    });
    it("rejects a ready summary whose approvedTotalMinor is zero (must be strictly positive)", () => {
      const wrong = { ...READY, validation: { ...READY.validation, reconciliation: { ...READY.validation.reconciliation, approvedTotalMinor: "0", exportedTotalMinor: "0" } } };
      expect(exportAttemptSummarySchema.safeParse(wrong).success).toBe(false);
    });
    it("accepts generatedAt exactly equal to checkedAt (boundary, not strictly before)", () => {
      expect(exportAttemptSummarySchema.safeParse({ ...READY, artifact: { ...READY.artifact, generatedAt: READY.checkedAt } }).success).toBe(true);
    });
    it("rejects a csv_jobtread format with the json rendererVersion", () => {
      const wrong = { ...READY, format: "csv_jobtread" as const };
      expect(exportAttemptSummarySchema.safeParse(wrong).success).toBe(false); // rendererVersion still says json
    });
  });

  // MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V3-QA-SUPPLEMENT.md item 1: the exact
  // 7-code x 4-format x 2-position matrix dto-extra-probe.mjs proved had 42
  // wrong acceptances and 14 valid controls. Reproduced verbatim.
  describe("V3 supplement item 1 — CSV-exclusive issue codes never justify blocking a non-CSV format", () => {
    const CSV_CODES = [
      "CSV_CLASSIFICATION_NOT_REVIEWED", "CSV_TAXABLE_UNKNOWN", "CSV_UNIT_UNREPRESENTABLE", "CSV_RATE_UNREPRESENTABLE",
      "CSV_LINE_IDENTITY_INVALID", "CSV_COST_CODE_UNKNOWN", "CSV_COST_CODE_INVALID",
    ] as const;
    const FORMATS = ["csv_jobtread", "json", "pdf", "printable"] as const;
    let controls = 0, unexpected = 0;
    for (const code of CSV_CODES) {
      const base = {
        ...BLOCKED, status: "blocked_validation" as const, authority: READY.authority,
        validation: {
          state: "invalid" as const, issues: [{ code, lineKey: "line:1" as const, field: null }],
          reconciliation: { state: "unrepresentable" as const, approvedTotalMinor: "10000", estimatedCostMinor: "4000", exportedTotalMinor: null, differenceMinor: null },
        },
      };
      for (const format of FORMATS) {
        const input = { ...base, format };
        const expectAccepted = format === "csv_jobtread";
        it(`${code} as PRINCIPAL on format=${format}: ${expectAccepted ? "accepts (control)" : "rejects"}`, () => {
          expect(exportAttemptSummarySchema.safeParse(input).success).toBe(expectAccepted);
        });
        if (expectAccepted) controls++; else unexpected++;

        const secondary = structuredClone(input);
        secondary.validation.issues.unshift({ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: null, field: null });
        it(`${code} as SECONDARY (principal is EXPORT_FORMAT_UNREPRESENTABLE) on format=${format}: ${expectAccepted ? "accepts (control)" : "rejects"}`, () => {
          expect(exportAttemptSummarySchema.safeParse(secondary).success).toBe(expectAccepted);
        });
        if (expectAccepted) controls++; else unexpected++;
      }
    }
    it("the fixed matrix is exactly 56 cases: 14 valid controls, 42 that must reject", () => {
      expect(controls).toBe(14);
      expect(unexpected).toBe(42);
    });
  });

  it("parseExportAttemptSummary throws INTERNAL_APPROVAL_INTEGRITY_ERROR (not a bespoke error) on an invalid value", () => {
    expect(() => parseExportAttemptSummary({ ...READY, canDownload: true })).toThrow(/INTERNAL_APPROVAL_INTEGRITY_ERROR/);
  });
  it("parseExportAttemptSummary returns the parsed value unchanged on success", () => {
    expect(parseExportAttemptSummary(READY)).toEqual(READY);
  });
});
