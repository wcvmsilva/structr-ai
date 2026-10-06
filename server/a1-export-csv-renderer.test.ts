/**
 * A1-EXPORT-CSV-IMPLEMENTATION-CONTRACT.md — behavior tests for the pure CSV
 * renderer. Independent oracle for hashing: Node's own `crypto` module, used
 * HERE ONLY, never inside the shared renderer modules (WebCrypto exclusively).
 */
import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { renderExportCsv, type CsvRenderOutcome } from "../shared/internal-estimate-export-csv-renderer";
import { buildInternalApprovalReview, InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import {
  normalizeExportManifest, checkExportManifestAgainstSnapshot, exportIssueOrderIsValid, computeExactAmountMinor,
} from "../shared/internal-estimate-export-engine";
import { makeInternalApprovalReviewInput, approvalIds } from "./internal-estimate-approval-engine.fixtures";

const GENERATED_AT = "2026-10-02T00:00:00.000Z";

/** The shared fixture's default line has `taxable: null` (deliberately, to
 * prove JSON/printable/PDF don't need it known) — CSV needs it known, so
 * every CSV test starts from a line that's otherwise ready and overrides
 * only what a specific test needs to break. This is the "strictly necessary
 * fixture helper" named in the implementation contract's OUTPUT section —
 * kept local to this test file, not a new shared fixtures module. */
function csvReadyLine(overrides: Record<string, unknown> = {}) {
  return { ...makeInternalApprovalReviewInput().lines[0], taxable: true, ...overrides };
}
async function buildReview(overrides: Record<string, unknown> = {}) {
  return buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(), lines: [csvReadyLine()], ...overrides });
}
function baseInput(review: Awaited<ReturnType<typeof buildReview>>, overrides: Record<string, unknown> = {}) {
  return {
    snapshot: review.snapshot,
    authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: review.contentHash },
    exportId: randomUUID(), rendererVersion: "internal-estimate-jobtread-csv-v1", generatedAt: GENERATED_AT, generatedBy: approvalIds.actor,
    ...overrides,
  };
}
function independentSha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function expectReady(outcome: CsvRenderOutcome): Extract<CsvRenderOutcome, { outcome: "ready" }> {
  if (outcome.outcome !== "ready") throw new Error(`expected ready, got blocked: ${JSON.stringify(outcome.issues)}`);
  return outcome;
}
function expectBlocked(outcome: CsvRenderOutcome): Extract<CsvRenderOutcome, { outcome: "blocked" }> {
  if (outcome.outcome !== "blocked") throw new Error("expected blocked, got ready");
  return outcome;
}

/** Builds a manifest around a REAL renderer outcome and validates it against
 * the already-accepted engine — same pattern as JSON/printable/PDF, adapted
 * for CSV's two-outcome shape. Reconciliation shape for `blocked` mirrors the
 * (private) ISSUE_CLASS_RULE table: EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED
 * requires all four reconciliation fields non-null ("full" totals); every
 * other CSV/format issue requires only approvedTotalMinor/estimatedCostMinor
 * ("approvedOnly" totals), with exportedTotalMinor/differenceMinor null. */
function buildManifestFor(outcome: CsvRenderOutcome, review: Awaited<ReturnType<typeof buildReview>>, input: ReturnType<typeof baseInput>) {
  const context = {
    tenantId: review.snapshot.identity.tenantId, projectId: review.snapshot.identity.projectId,
    clientId: review.snapshot.identity.clientId, estimateDraftId: review.snapshot.identity.estimateDraftId,
    estimateVersion: review.snapshot.identity.draftVersion, requestedBy: input.generatedBy,
  };
  const authority = input.authority;
  if (outcome.outcome === "ready") {
    return normalizeExportManifest({
      version: "internal-estimate-export-v1", format: "csv_jobtread", attemptKind: "preflight", outcome: "ready",
      exportId: input.exportId, context, authority, checkedAt: input.generatedAt,
      lineKeys: review.snapshot.lines.map(l => l.lineKey),
      validation: {
        version: "internal-estimate-export-validation-v1", state: "valid", issues: [],
        reconciliation: {
          state: "matched", approvedTotalMinor: review.snapshot.financials.finalPriceMinor,
          exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0",
          estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
        },
      },
      representation: outcome.representation,
    });
  }
  const isCommercialAdjustment = outcome.issues[0]?.code === "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED";
  return normalizeExportManifest({
    version: "internal-estimate-export-v1", format: "csv_jobtread", attemptKind: "preflight", outcome: "blocked",
    exportId: input.exportId, context, authority, checkedAt: input.generatedAt, lineKeys: [],
    validation: {
      version: "internal-estimate-export-validation-v1", state: "invalid", issues: outcome.issues,
      reconciliation: isCommercialAdjustment
        ? {
          state: "unrepresentable", approvedTotalMinor: review.snapshot.financials.finalPriceMinor,
          exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0",
          estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
        }
        : {
          state: "unrepresentable", approvedTotalMinor: review.snapshot.financials.finalPriceMinor,
          exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
        },
    },
    representation: null,
  });
}

describe("renderExportCsv — structural guards (reused, not duplicated)", () => {
  it("rejects a rendererVersion that isn't the CSV literal", async () => {
    const review = await buildReview();
    await expect(renderExportCsv(baseInput(review, { rendererVersion: "internal-estimate-json-v1" })))
      .rejects.toMatchObject({ code: "EXPORT_RENDERER_UNAVAILABLE" });
  });

  it("rejects a diverging contentHash BEFORE producing any result", async () => {
    const review = await buildReview();
    const input = baseInput(review, { authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: "0".repeat(64) } });
    await expect(renderExportCsv(input)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
  });

  it("rejects a malformed wrapper / malformed snapshot, same as JSON/printable/PDF", async () => {
    const review = await buildReview();
    const extra: any = baseInput(review); extra.unexpectedExtra = "nope";
    await expect(renderExportCsv(extra)).rejects.toBeInstanceOf(InternalApprovalError);

    const broken: any = baseInput(review);
    const { version: _v, ...brokenSnapshot } = broken.snapshot;
    broken.snapshot = brokenSnapshot;
    await expect(renderExportCsv(broken)).rejects.toBeInstanceOf(InternalApprovalError);
  });

  it("fails closed, no fallback, when WebCrypto digest is unavailable", async () => {
    const review = await buildReview();
    const real = globalThis.crypto.subtle.digest;
    // @ts-expect-error — deliberately breaking WebCrypto for this one test
    globalThis.crypto.subtle.digest = undefined;
    try {
      await expect(renderExportCsv(baseInput(review))).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE" });
    } finally {
      globalThis.crypto.subtle.digest = real;
    }
  });
});

describe("renderExportCsv — ready output: bytes, hash, determinism, no mutation", () => {
  it("produces real CSV bytes whose independently-computed SHA-256 matches the returned artifactHash", async () => {
    const review = await buildReview();
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    expect(independentSha256Hex(outcome.bytes)).toBe(outcome.representation.artifactHash);
    expect(outcome.representation.byteLength).toBe(outcome.bytes.length);
    expect(outcome.representation.mimeType).toBe("text/csv");
    expect(outcome.representation.encoding).toBe("utf8");
    expect(outcome.representation.details.contractVersion).toBe("jobtread-budget-csv-a1-v1");
    expect(outcome.representation.details.delimiter).toBe(",");
    expect(outcome.representation.details.lineEnding).toBe("CRLF");
    expect(outcome.representation.details.utf8Bom).toBe(false);
  });

  it("is deterministic: identical input produces byte-identical output across repeated calls, and never mutates its input", async () => {
    const review = await buildReview();
    const input = baseInput(review);
    const snapshotBefore = JSON.parse(JSON.stringify(input.snapshot));
    const first = expectReady(await renderExportCsv(input));
    const second = expectReady(await renderExportCsv(input));
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(first.representation).toEqual(second.representation);
    expect(input.snapshot).toEqual(snapshotBefore);
  });

  it("header row matches EXPORT_CSV_HEADERS exactly, in order, and the file has UTF-8 bytes with no BOM and a final CRLF", async () => {
    const review = await buildReview();
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    const text = Buffer.from(outcome.bytes).toString("utf8");
    expect(text.startsWith("Cost Group Name,Cost Item Name,Description,Quantity,Unit,Unit Cost,Unit Price,Cost Type,Taxable\r\n")).toBe(true);
    expect(outcome.bytes[0]).not.toBe(0xef); // UTF-8 BOM starts EF BB BF
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(2); // header + 1 data row
  });
});

describe("renderExportCsv — blocked output: zero content, every code reachable", () => {
  it("blocked never includes bytes, representation, or any other content", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ taxable: null })] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(Object.keys(outcome)).toEqual(["outcome", "issues"]);
    expect((outcome as any).bytes).toBeUndefined();
    expect((outcome as any).representation).toBeUndefined();
  });

  it("CSV_CLASSIFICATION_NOT_REVIEWED when csvClassification is null", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ csvClassification: null })] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toContainEqual({ code: "CSV_CLASSIFICATION_NOT_REVIEWED", lineKey: "line:1", field: "costType" });
  });

  it("CSV_TAXABLE_UNKNOWN when taxable is null", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ taxable: null })] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toContainEqual({ code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" });
  });

  it("CSV_RATE_UNREPRESENTABLE for unitPrice when it has more than two decimal places (classification still present)", async () => {
    const preciseRatePrice = await buildReview({ lines: [csvReadyLine({ unitPriceSnapshot: "50.125" })] });
    const outPrice = expectBlocked(await renderExportCsv(baseInput(preciseRatePrice)));
    expect(outPrice.issues).toContainEqual({ code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitPrice" });
  });

  it("CSV_RATE_UNREPRESENTABLE for a null unitCost — the core itself requires classification to ALSO be null whenever a rate is null, so this always co-occurs with CSV_CLASSIFICATION_NOT_REVIEWED, never in isolation", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ unitCostSnapshot: null, csvClassification: null })] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toContainEqual({ code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitCost" });
    expect(outcome.issues).toContainEqual({ code: "CSV_CLASSIFICATION_NOT_REVIEWED", lineKey: "line:1", field: "costType" });
  });

  it("both unitCost and unitPrice can be flagged on the SAME line, in unitCost-then-unitPrice order", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ unitCostSnapshot: "20.333", unitPriceSnapshot: "50.125" })] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toEqual([
      { code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitCost" },
      { code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitPrice" },
    ]);
  });

  it("CSV_COST_CODE_UNKNOWN when costCodeSource is 'unknown' (costCode null), only diagnosed when classification is present", async () => {
    const base = makeInternalApprovalReviewInput();
    const line = csvReadyLine({
      costCode: null,
      csvClassification: { ...base.lines[0].csvClassification, costCode: null, costCodeSource: "unknown" },
    });
    const review = await buildReview({ lines: [line] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toContainEqual({ code: "CSV_COST_CODE_UNKNOWN", lineKey: "line:1", field: "costCode" });
  });

  it("CSV_COST_CODE_INVALID when costCode is known but outside the frozen catalog", async () => {
    const base = makeInternalApprovalReviewInput();
    const line = csvReadyLine({
      costCode: "99-999",
      csvClassification: { ...base.lines[0].csvClassification, costCode: "99-999", costCodeSource: "stored" },
    });
    const review = await buildReview({ lines: [line] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toContainEqual({ code: "CSV_COST_CODE_INVALID", lineKey: "line:1", field: "costCode" });
  });

  it("classification-null line still independently reports rate/taxable issues — cost-code is skipped (no object to read it from), not silently passed", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ csvClassification: null, taxable: null, unitCostSnapshot: null })] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toEqual([
      { code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitCost" },
      { code: "CSV_CLASSIFICATION_NOT_REVIEWED", lineKey: "line:1", field: "costType" },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" },
    ]);
  });

  it("maximum four issues on one line (classification present: both rates + taxable + cost code)", async () => {
    const base = makeInternalApprovalReviewInput();
    const line = csvReadyLine({
      unitCostSnapshot: "20.333", unitPriceSnapshot: "50.125", taxable: null, costCode: "99-999",
      csvClassification: { ...base.lines[0].csvClassification, costCode: "99-999", costCodeSource: "stored" },
    });
    const review = await buildReview({ lines: [line] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toEqual([
      { code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitCost" },
      { code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitPrice" },
      { code: "CSV_TAXABLE_UNKNOWN", lineKey: "line:1", field: "taxable" },
      { code: "CSV_COST_CODE_INVALID", lineKey: "line:1", field: "costCode" },
    ]);
  });

  it("maximum four issues on one line (classification absent: both rates + classification + taxable)", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ unitCostSnapshot: "20.333", unitPriceSnapshot: "50.125", taxable: null, csvClassification: null })] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toHaveLength(4);
  });

  it("never diagnoses CSV_UNIT_UNREPRESENTABLE or CSV_LINE_IDENTITY_INVALID — malformed normalizedUnit/lineKey are rejected by the CORE snapshot schema before any CSV result exists", async () => {
    const base = makeInternalApprovalReviewInput();
    // `line.unit` itself is a free-form Code string (no enum) — the enum lives on
    // csvClassification.normalizedUnit, which the core validates independently.
    const badUnit: any = { ...base, lines: [{ ...base.lines[0], csvClassification: { ...base.lines[0].csvClassification, normalizedUnit: "not-a-real-unit" } }] };
    await expect(buildInternalApprovalReview(badUnit)).rejects.toBeInstanceOf(InternalApprovalError);

    const badLineKey: any = { ...base, lines: [{ ...base.lines[0], lineKey: "line:2" }] }; // ordinal=1 but lineKey claims 2
    await expect(buildInternalApprovalReview(badLineKey)).rejects.toBeInstanceOf(InternalApprovalError);
    // Both rejections happen at buildInternalApprovalReview (core), before renderExportCsv
    // is ever reachable with this input — CSV_UNIT_UNREPRESENTABLE/CSV_LINE_IDENTITY_INVALID
    // never appear anywhere in this renderer's own issue-producing code (grep-verifiable).
  });
});

describe("renderExportCsv — phase 2: per-line quantity x rate must reconcile to its OWN total", () => {
  it("EXPORT_FORMAT_UNREPRESENTABLE/lineCost when only the cost extension diverges (price is correct)", async () => {
    const line = csvReadyLine({ quantity: "2", unitCostSnapshot: "20", unitPriceSnapshot: "50", lineTotalCostMinor: "4001", lineTotalPriceMinor: "10000" });
    // financials must still balance at the whole-export level for this to reach phase 2 at all
    const review = await buildInternalApprovalReview({
      ...makeInternalApprovalReviewInput(), lines: [line],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: false, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: "4001" },
    });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toEqual([{ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: "line:1", field: "lineCost" }]);
  });

  it("two lines whose price divergences cancel at the whole-export total are EACH still flagged — not EXPORT_RECONCILIATION_MISMATCH (net difference is zero)", async () => {
    const base = makeInternalApprovalReviewInput();
    const lineA = csvReadyLine({ lineKey: "line:1", ordinal: 1, quantity: "2", unitCostSnapshot: "20", unitPriceSnapshot: "50", lineTotalCostMinor: "4000", lineTotalPriceMinor: "10100" }); // +100 off
    const lineB = { ...csvReadyLine({ lineKey: "line:2", ordinal: 2, quantity: "2", unitCostSnapshot: "20", unitPriceSnapshot: "50", lineTotalCostMinor: "4000", lineTotalPriceMinor: "9900" }) }; // -100 off
    const review = await buildInternalApprovalReview({
      ...base, lines: [lineA, lineB],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "20000", discountApplied: false, discountMinor: "0", finalPriceMinor: "20000", estimatedCostMinor: "8000" },
    });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toEqual([
      { code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: "line:1", field: "linePrice" },
      { code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: "line:2", field: "linePrice" },
    ]);
  });

  it("phase 2 correctly reuses the exact half-away-from-zero cent rounding rule for a genuine tie (quantity 0.5 x rate 0.01 = exactly half a cent)", async () => {
    // computeExactAmountMinor(0.5, 0.01) rounds the exact 0.5-cent tie UP (away
    // from zero) to 1 cent — reused here, not re-derived, so a correctly
    // rounded total is accepted as a legitimate match, not a false mismatch.
    const expectedCents = computeExactAmountMinor("0.5", "0.01");
    expect(expectedCents).toBe(1n);
    const line = csvReadyLine({ quantity: "0.5", unitCostSnapshot: "0.01", unitPriceSnapshot: "0.01", lineTotalCostMinor: "1", lineTotalPriceMinor: "1" });
    const review = await buildInternalApprovalReview({
      ...makeInternalApprovalReviewInput(), lines: [line],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "1", discountApplied: false, discountMinor: "0", finalPriceMinor: "1", estimatedCostMinor: "1" },
    });
    expectReady(await renderExportCsv(baseInput(review)));
  });
});

describe("renderExportCsv — discount (phase 3) and content/identity preservation", () => {
  it("EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED for a positive discount, and separately for a zero-valued but APPLIED discount", async () => {
    const positive = await buildReview({ financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: true, discountMinor: "500", finalPriceMinor: "9500", estimatedCostMinor: "4000" } });
    expect(expectBlocked(await renderExportCsv(baseInput(positive))).issues).toEqual([{ code: "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED", lineKey: null, field: "discount" }]);

    const zeroApplied = await buildReview({ financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: true, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: "4000" } });
    expect(expectBlocked(await renderExportCsv(baseInput(zeroApplied))).issues).toEqual([{ code: "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED", lineKey: null, field: "discount" }]);
  });

  it("discount issue is the ONLY issue even when line-level issues would otherwise exist — phase 3 only runs once phases 1-2 are already clean, so this never actually co-occurs, proven by using an otherwise-fully-ready line", async () => {
    const review = await buildReview({ financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: true, discountMinor: "500", finalPriceMinor: "9500", estimatedCostMinor: "4000" } });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toHaveLength(1);
  });

  it("distinguishes two lines with identical display names but different LineKeys — each row keeps its own values, in order", async () => {
    const lineA = csvReadyLine({ lineKey: "line:1", ordinal: 1, costGroupName: "Shared Group", costItemName: "Shared Item", quantity: "3", unitCostSnapshot: "5", unitPriceSnapshot: "11", lineTotalCostMinor: "1500", lineTotalPriceMinor: "3300" });
    const lineB = csvReadyLine({ lineKey: "line:2", ordinal: 2, costGroupName: "Shared Group", costItemName: "Shared Item", quantity: "7", unitCostSnapshot: "5", unitPriceSnapshot: "11", lineTotalCostMinor: "3500", lineTotalPriceMinor: "7700" });
    const review = await buildInternalApprovalReview({
      ...makeInternalApprovalReviewInput(), lines: [lineA, lineB],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "11000", discountApplied: false, discountMinor: "0", finalPriceMinor: "11000", estimatedCostMinor: "5000" },
    });
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    const text = Buffer.from(outcome.bytes).toString("utf8");
    const [, row1, row2] = text.split("\r\n");
    expect(row1).toBe("Shared Group,Shared Item,Synthetic component,3,Each,5.00,11.00,Materials,True");
    expect(row2).toBe("Shared Group,Shared Item,Synthetic component,7,Each,5.00,11.00,Materials,True");
  });

  it("a 20-digit money total round-trips exactly via BigInt (no Number) in a real ready CSV row", async () => {
    const quantity = "10000"; const unitCost = "99999999999999.99"; const unitPrice = "99999999999999.99";
    const lineCostMinor = computeExactAmountMinor(quantity, unitCost).toString();
    const linePriceMinor = computeExactAmountMinor(quantity, unitPrice).toString();
    expect(lineCostMinor.length).toBeGreaterThanOrEqual(20);
    const line = csvReadyLine({ quantity, unitCostSnapshot: unitCost, unitPriceSnapshot: unitPrice, lineTotalCostMinor: lineCostMinor, lineTotalPriceMinor: linePriceMinor });
    const review = await buildInternalApprovalReview({
      ...makeInternalApprovalReviewInput(), lines: [line],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: linePriceMinor, discountApplied: false, discountMinor: "0", finalPriceMinor: linePriceMinor, estimatedCostMinor: lineCostMinor },
    });
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    const text = Buffer.from(outcome.bytes).toString("utf8");
    expect(text).toContain("99999999999999.99");
  });
});

describe("renderExportCsv — RFC-style escaping and roundtrip of all nine columns", () => {
  it("quotes fields containing a comma, a double quote (doubled), or an embedded LF, leaving plain fields unquoted", async () => {
    const line = csvReadyLine({
      costGroupName: "Group, with comma", costItemName: `Item "quoted"`, description: "Line one\nLine two",
    });
    const review = await buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(), lines: [line] });
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    const text = Buffer.from(outcome.bytes).toString("utf8");
    expect(text).toContain(`"Group, with comma"`);
    expect(text).toContain(`"Item ""quoted"""`);
    expect(text).toContain(`"Line one\nLine two"`);
    expect(text).toContain(",2,Each,20.00,50.00,Materials,True"); // plain fields stay unquoted, unaffected by the escaped ones
  });

  it("a CRLF typed by the reviewer is already normalized to a bare LF by the core BEFORE this renderer ever sees it — the renderer escapes what it receives, it does not need CR to reappear", async () => {
    const line = csvReadyLine({ description: "Line one\r\nLine two" }); // input has CRLF
    const review = await buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(), lines: [line] });
    expect(review.snapshot.lines[0].description).toBe("Line one\nLine two"); // core already stripped the \r
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    const text = Buffer.from(outcome.bytes).toString("utf8");
    expect(text).toContain(`"Line one\nLine two"`);
    expect(text).not.toContain("Line one\r\nLine two");
  });

  it("a NULL description becomes an explicit empty field, never 'null' text or a dropped column", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ description: null })] });
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    const text = Buffer.from(outcome.bytes).toString("utf8");
    const dataRow = text.split("\r\n")[1];
    expect(dataRow.split(",")[2]).toBe(""); // Description column, 0-indexed: Group,Item,Description,...
    expect(dataRow).not.toContain("null");
  });

  it("Unicode content round-trips as exact UTF-8 bytes", async () => {
    const review = await buildReview({ lines: [csvReadyLine({ costGroupName: "Café ☕ 界" })] });
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    const text = Buffer.from(outcome.bytes).toString("utf8");
    expect(text).toContain("Café ☕ 界");
    expect(Buffer.byteLength(text, "utf8")).toBe(outcome.bytes.length);
  });

  it("taxable serializes as exactly the literal strings True/False, never lowercase or boolean-ish text", async () => {
    const trueReview = await buildReview({ lines: [csvReadyLine({ taxable: true })] });
    expect(Buffer.from(expectReady(await renderExportCsv(baseInput(trueReview))).bytes).toString("utf8")).toContain(",True\r\n");
    const falseReview = await buildReview({ lines: [csvReadyLine({ taxable: false })] });
    expect(Buffer.from(expectReady(await renderExportCsv(baseInput(falseReview))).bytes).toString("utf8")).toContain(",False\r\n");
  });

  it("formatCsvRateFromDecimal6 boundary behavior, observed through the public renderer: 0, one decimal, and a 14-integer-digit rate all ready (with phase-2-consistent totals); 3-6 decimal fractions block at phase 1 regardless of totals", async () => {
    // Pad to two decimals the same simple way the (private) renderer helper
    // does, purely to derive a phase-2-consistent total for each rate under
    // test — this does not re-implement or assert on the private helper.
    // NOTE: "12.30" is deliberately NOT included — the core's own canonical-
    // decimal grammar strips trailing fractional zeros, so "12.30" is itself
    // an invalid snapshot value (only "12.3" is canonical); the two-decimal
    // padding case is still exercised by "0" -> "0.00" and "12.3" -> "12.30".
    const padTwoDecimals = (v: string) => { const [w, f = ""] = v.split("."); return `${w}.${f.padEnd(2, "0")}`; };
    for (const unitCostSnapshot of ["0", "12.3", "99999999999999"]) {
      const lineCostMinor = computeExactAmountMinor("2", padTwoDecimals(unitCostSnapshot)).toString();
      const review = await buildReview({
        lines: [csvReadyLine({ unitCostSnapshot, lineTotalCostMinor: lineCostMinor })],
        financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: false, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: lineCostMinor },
      });
      expectReady(await renderExportCsv(baseInput(review)));
    }
    for (const unitCostSnapshot of ["12.345", "12.3456", "12.345678"]) {
      const review = await buildReview({ lines: [csvReadyLine({ unitCostSnapshot })] });
      const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
      expect(outcome.issues).toContainEqual({ code: "CSV_RATE_UNREPRESENTABLE", lineKey: "line:1", field: "unitCost" });
    }
  });
});

describe("renderExportCsv — manifest integration and issue ordering", () => {
  it("a ready output, embedded in a real manifest, validates against the already-accepted engine", async () => {
    const review = await buildReview();
    const input = baseInput(review);
    const outcome = expectReady(await renderExportCsv(input));
    const manifest = buildManifestFor(outcome, review, input);
    expect(manifest.outcome).toBe("ready");
    const correspondence = await checkExportManifestAgainstSnapshot(manifest, review.snapshot);
    expect(correspondence.contentHashMatches).toBe(true);
    expect(correspondence.csv).not.toBeNull();
    expect(correspondence.csv!.sumCostMatches).toBe(true);
    expect(correspondence.csv!.sumPriceMatches).toBe(true);
    expect(correspondence.csv!.rows.every(r => r.identityMatches && r.classificationMatches && r.rateExact && r.amountsExact)).toBe(true);
  });

  it("a blocked output (including the zero-net-difference EXPORT_FORMAT_UNREPRESENTABLE case), embedded in a real manifest, validates against the already-accepted engine", async () => {
    const lineA = csvReadyLine({ lineKey: "line:1", ordinal: 1, quantity: "2", unitCostSnapshot: "20", unitPriceSnapshot: "50", lineTotalCostMinor: "4000", lineTotalPriceMinor: "10100" });
    const lineB = csvReadyLine({ lineKey: "line:2", ordinal: 2, quantity: "2", unitCostSnapshot: "20", unitPriceSnapshot: "50", lineTotalCostMinor: "4000", lineTotalPriceMinor: "9900" });
    const review = await buildInternalApprovalReview({
      ...makeInternalApprovalReviewInput(), lines: [lineA, lineB],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "20000", discountApplied: false, discountMinor: "0", finalPriceMinor: "20000", estimatedCostMinor: "8000" },
    });
    const input = baseInput(review);
    const outcome = expectBlocked(await renderExportCsv(input));
    expect(exportIssueOrderIsValid(outcome.issues)).toBe(true);
    const manifest = buildManifestFor(outcome, review, input);
    expect(manifest.outcome).toBe("blocked");
  });

  it("every produced issues array satisfies exportIssueOrderIsValid — ordinal ascending, then EXPORT_ISSUE_FIELDS order, no duplicates", async () => {
    const base = makeInternalApprovalReviewInput();
    const line = csvReadyLine({
      unitCostSnapshot: "20.333", unitPriceSnapshot: "50.125", taxable: null, costCode: "99-999",
      csvClassification: { ...base.lines[0].csvClassification, costCode: "99-999", costCodeSource: "stored" },
    });
    const review = await buildReview({ lines: [line] });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(exportIssueOrderIsValid(outcome.issues)).toBe(true);
  });

  it("a 1000-line snapshot where every line fails the same way produces a large, fully-populated, correctly-ordered issues array — not truncated", async () => {
    const base = makeInternalApprovalReviewInput();
    const lines = Array.from({ length: 1000 }, (_, i) => csvReadyLine({ lineKey: `line:${i + 1}`, ordinal: i + 1, taxable: null }));
    const totalCost = (4000n * 1000n).toString(); const totalPrice = (10000n * 1000n).toString();
    const review = await buildInternalApprovalReview({
      ...base, lines,
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: totalPrice, discountApplied: false, discountMinor: "0", finalPriceMinor: totalPrice, estimatedCostMinor: totalCost },
    });
    const outcome = expectBlocked(await renderExportCsv(baseInput(review)));
    expect(outcome.issues).toHaveLength(1000);
    expect(outcome.issues.every(i => i.code === "CSV_TAXABLE_UNKNOWN")).toBe(true);
    expect(exportIssueOrderIsValid(outcome.issues)).toBe(true);
  }, 30000);
});

describe("renderExportCsv — 10 MiB response limit", () => {
  it("rejects a render whose content genuinely exceeds 10,485,760 bytes (measured with real Unicode-heavy content, 1000 lines at the schema's own max field lengths)", async () => {
    const base = makeInternalApprovalReviewInput();
    const heavyName = "界".repeat(255); // Label max length, 3-byte UTF-8 each
    const heavyDescription = "界".repeat(5000); // Text max length
    const lines = Array.from({ length: 1000 }, (_, i) => csvReadyLine({
      lineKey: `line:${i + 1}`, ordinal: i + 1, costGroupName: heavyName, costItemName: heavyName, description: heavyDescription,
    }));
    const totalCost = (4000n * 1000n).toString(); const totalPrice = (10000n * 1000n).toString();
    const review = await buildInternalApprovalReview({
      ...base, lines,
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: totalPrice, discountApplied: false, discountMinor: "0", finalPriceMinor: totalPrice, estimatedCostMinor: totalCost },
    });
    await expect(renderExportCsv(baseInput(review))).rejects.toMatchObject({ code: "EXPORT_PAYLOAD_TOO_LARGE" });
  }, 30000);

  it("the same shape with plain ASCII content stays comfortably under the limit — proving the rejection above is about real byte size, not line count alone", async () => {
    const base = makeInternalApprovalReviewInput();
    const lines = Array.from({ length: 1000 }, (_, i) => csvReadyLine({ lineKey: `line:${i + 1}`, ordinal: i + 1 }));
    const totalCost = (4000n * 1000n).toString(); const totalPrice = (10000n * 1000n).toString();
    const review = await buildInternalApprovalReview({
      ...base, lines,
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: totalPrice, discountApplied: false, discountMinor: "0", finalPriceMinor: totalPrice, estimatedCostMinor: totalCost },
    });
    const outcome = expectReady(await renderExportCsv(baseInput(review)));
    expect(outcome.bytes.length).toBeLessThan(10_485_760);
  }, 30000);
});
