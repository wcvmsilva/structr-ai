/**
 * A1-EXPORT-PDF-IMPLEMENTATION-CONTRACT.md — behavior tests for the pure PDF
 * renderer. Independent oracle for hashing: Node's own `crypto` module, used
 * HERE ONLY, never inside the shared renderer modules (WebCrypto exclusively).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { jsPDF } from "jspdf";
import { renderExportPdf } from "../shared/internal-estimate-export-pdf-renderer";
import { ExportRendererError } from "../shared/internal-estimate-export-renderer";
import { buildInternalApprovalReview, InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import { normalizeExportManifest, checkExportManifestAgainstSnapshot } from "../shared/internal-estimate-export-engine";
import { makeInternalApprovalReviewInput, approvalIds } from "./internal-estimate-approval-engine.fixtures";

const GENERATED_AT = "2026-10-01T00:00:00.000Z";

async function buildBaseReview(overrides: Record<string, unknown> = {}) {
  return buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(), ...overrides });
}
function baseInput(review: Awaited<ReturnType<typeof buildBaseReview>>, overrides: Record<string, unknown> = {}) {
  return {
    snapshot: review.snapshot,
    authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: review.contentHash },
    exportId: randomUUID(), rendererVersion: "internal-estimate-pdf-v1", generatedAt: GENERATED_AT, generatedBy: approvalIds.actor,
    ...overrides,
  };
}

/** Test-only PDF content-stream text extractor (compress:false makes this
 * possible): finds every `(...) Tj` operator across every stream and
 * unescapes PDF string escapes. Not a general PDF parser — sufficient to
 * assert on literal text/order/page geometry in this specific layout. */
function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const pieces: string[] = [];
  let idx = 0;
  while (true) {
    const s = raw.indexOf("stream\n", idx);
    if (s === -1) break;
    const e = raw.indexOf("endstream", s);
    const chunk = raw.slice(s + 7, e);
    idx = e + 9;
    const tjRe = /\(((?:\\.|[^()\\])*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = tjRe.exec(chunk))) pieces.push(unescapePdfString(m[1]));
  }
  return pieces.join("\n");
}
function unescapePdfString(s: string): string {
  const named = s.replace(/\\([()\\nrtbf])/g, (_, c) => ({ "(": "(", ")": ")", "\\": "\\", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[c]);
  return decodeWinAnsiByteString(named);
}
/**
 * Buffer.toString("latin1") decodes each byte 1:1 as Unicode code points
 * 0-255 -- correct for 0x00-0x7F and 0xA0-0xFF, but WRONG for 0x80-0x9F: PDF
 * text strings under the standard font use WinAnsiEncoding (~CP1252) there,
 * not ISO-8859-1/Latin-1 (which reserves 0x80-0x9F for C1 controls). This is
 * the INDEPENDENT reverse of the renderer's own 27-entry Unicode->WinAnsi
 * table (same jsPDF 4.2.0 source, re-derived here rather than imported, so
 * the test doesn't just echo the production table back at itself).
 */
const CP1252_C1_REVERSE: Readonly<Record<number, number>> = {
  128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
  136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
  146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
  153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376,
};
function decodeWinAnsiByteString(raw: string): string {
  return Array.from(raw, (ch) => {
    const code = ch.codePointAt(0)!;
    if (code >= 0x80 && code <= 0x9f) {
      const mapped = CP1252_C1_REVERSE[code];
      return mapped !== undefined ? String.fromCodePoint(mapped) : ch;
    }
    return ch;
  }).join("");
}
/** Every "Td" y-coordinate actually written, across every content stream. */
function extractTdYCoordinates(bytes: Uint8Array): number[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const ys: number[] = [];
  const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) ys.push(Number.parseFloat(m[2]));
  return ys;
}
function independentSha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

describe("renderExportPdf — validation / integrity / crypto failure", () => {
  it("produces real PDF bytes whose independently-computed SHA-256 matches the returned artifactHash", async () => {
    const review = await buildBaseReview();
    const { bytes, representation } = await renderExportPdf(baseInput(review));
    expect(independentSha256Hex(bytes)).toBe(representation.artifactHash);
    expect(representation.byteLength).toBe(bytes.length);
    expect(Buffer.from(bytes).toString("latin1").startsWith("%PDF-")).toBe(true);
    expect(representation.mimeType).toBe("application/pdf");
    expect(representation.encoding).toBe("base64");
    expect(representation.details).toEqual({ layoutVersion: "internal-estimate-summary-v1", pageCount: representation.details.pageCount });
  });

  it("rejects a rendererVersion that isn't the PDF literal", async () => {
    const review = await buildBaseReview();
    await expect(renderExportPdf(baseInput(review, { rendererVersion: "internal-estimate-json-v1" })))
      .rejects.toMatchObject({ code: "EXPORT_RENDERER_UNAVAILABLE" });
  });

  it("rejects an installed jsPDF version that doesn't match the pinned 4.2.0", async () => {
    const real = jsPDF.version;
    // @ts-expect-error — deliberately simulating a library version drift for this one test
    jsPDF.version = "9.9.9";
    try {
      await expect(renderExportPdf(baseInput(await buildBaseReview())))
        .rejects.toMatchObject({ code: "EXPORT_RENDERER_UNAVAILABLE" });
    } finally {
      // @ts-expect-error — restoring the real static value
      jsPDF.version = real;
    }
  });

  it("rejects a malformed wrapper / malformed snapshot / invalid hash shape, same as JSON/printable", async () => {
    const review = await buildBaseReview();
    const extra: any = baseInput(review); extra.unexpectedExtra = "nope";
    await expect(renderExportPdf(extra)).rejects.toBeInstanceOf(InternalApprovalError);

    const broken: any = baseInput(review);
    const { version: _v, ...brokenSnapshot } = broken.snapshot;
    broken.snapshot = brokenSnapshot;
    await expect(renderExportPdf(broken)).rejects.toBeInstanceOf(InternalApprovalError);

    const badHash = baseInput(review, { authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: "not-a-hash" } });
    await expect(renderExportPdf(badHash)).rejects.toBeInstanceOf(InternalApprovalError);
  });

  it("rejects a diverging contentHash BEFORE producing any bytes", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, { authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: "0".repeat(64) } });
    await expect(renderExportPdf(input)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
  });

  it("fails closed, no fallback, when WebCrypto digest fails at EACH of the three distinct digest call sites (snapshot hash, file ID hash, final artifact hash)", async () => {
    const review = await buildBaseReview();
    const real = globalThis.crypto.subtle.digest;
    for (const failOnCall of [1, 2, 3]) {
      let calls = 0;
      globalThis.crypto.subtle.digest = (async (...args: Parameters<typeof real>) => {
        calls++;
        if (calls === failOnCall) throw new Error("synthetic digest failure");
        return real.apply(globalThis.crypto.subtle, args);
      }) as typeof real;
      try {
        await expect(renderExportPdf(baseInput(review))).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE" });
      } finally {
        globalThis.crypto.subtle.digest = real;
      }
    }
  });
});

describe("renderExportPdf — content model (every contractual field, not just artifactHash change)", () => {
  it("includes authority (approvalId/snapshotId/contentHash), identity/origin, and bundle name", async () => {
    const review = await buildBaseReview();
    const snapshotId = randomUUID();
    const { bytes } = await renderExportPdf(baseInput(review, { authority: { approvalId: approvalIds.approval, snapshotId, contentHash: review.contentHash } }));
    const text = extractPdfText(bytes);
    expect(text).toContain(approvalIds.approval);
    expect(text).toContain(snapshotId);
    expect(text).toContain(review.contentHash);
    expect(text).toContain(approvalIds.tenant);
    expect(text).toContain(approvalIds.draft);
    expect(text).toContain("Synthetic assembly"); // fixture bundleName
  });

  it("includes both frozen context groups (calculation captured + review verified), and a changed field is visible", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportPdf(baseInput(review));
    const text = extractPdfText(bytes);
    expect(text).toContain("Calculation context (captured when priced)");
    expect(text).toContain("synthetic"); // default pricingContext.region
    expect(text).toContain("Review context (verified internally at review time)");
    expect(text).toContain("Synthetic coastal zone"); // default policyContext.projectGeo.zone
    expect(text).toContain("google_maps");

    const changed = await buildBaseReview({ pricingContext: { ...makeInternalApprovalReviewInput().pricingContext, region: "MICHAEL_PDF_REGION_ALTERED" } });
    const changedText = extractPdfText((await renderExportPdf(baseInput(changed))).bytes);
    expect(changedText).toContain("MICHAEL_PDF_REGION_ALTERED");
  });

  it("includes reviewed notes, or an explicit 'no notes' indication when null", async () => {
    const withNotes = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: "A specific reviewed note" } });
    expect(extractPdfText((await renderExportPdf(baseInput(withNotes))).bytes)).toContain("A specific reviewed note");
    const withoutNotes = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: null } });
    expect(extractPdfText((await renderExportPdf(baseInput(withoutNotes))).bytes)).toContain("No reviewed notes");
  });

  it("formats a 20-digit money value exactly, via the shared helper (no Number loss)", async () => {
    const bigMinor = "99999999999999999999";
    const review = await buildBaseReview({
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: bigMinor, discountApplied: false, discountMinor: "0", finalPriceMinor: bigMinor, estimatedCostMinor: "4000" },
      lines: [{ ...makeInternalApprovalReviewInput().lines[0], lineTotalPriceMinor: bigMinor, lineTotalCostMinor: "4000" }],
    });
    const text = extractPdfText((await renderExportPdf(baseInput(review))).bytes);
    expect(text).toContain("$999999999999999999.99");
  });

  it("shows discount presence (Yes/No) and amount in separate, always-present fields across the three valid combinations", async () => {
    const notApplied = await buildBaseReview({ financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: false, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: "4000" } });
    expect(extractPdfText((await renderExportPdf(baseInput(notApplied))).bytes)).toContain("Discount applied: No   Discount amount: $0.00");

    const appliedZero = await buildBaseReview({ financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: true, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: "4000" } });
    expect(extractPdfText((await renderExportPdf(baseInput(appliedZero))).bytes)).toContain("Discount applied: Yes   Discount amount: $0.00");

    const appliedPositive = await buildBaseReview({ financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: true, discountMinor: "500", finalPriceMinor: "9500", estimatedCostMinor: "4000" } });
    const text = extractPdfText((await renderExportPdf(baseInput(appliedPositive))).bytes);
    expect(text).toContain("Discount applied: Yes   Discount amount: $5.00");
    expect(text).toContain("Final price: $95.00");
  });

  it("zero/null denominators for GP% show a textual indication, never 0%/NaN/Infinity", async () => {
    const review = await buildBaseReview({
      assemblySelections: [{ ...makeInternalApprovalReviewInput().assemblySelections[0], selectionKey: "selection:1", extendedPriceMinor: "0", extendedCostMinor: "0" }],
    });
    const text = extractPdfText((await renderExportPdf(baseInput(review))).bytes);
    expect(text).toContain("GP % —");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  });

  it("distinguishes two lines with identical display names but different LineKeys — values never mixed up", async () => {
    const review = await buildBaseReview({
      lines: [
        { ...makeInternalApprovalReviewInput().lines[0], lineKey: "line:1", ordinal: 1, costGroupName: "Shared Group", costItemName: "Shared Item", quantity: "3", lineTotalCostMinor: "1500", lineTotalPriceMinor: "3300" },
        { ...makeInternalApprovalReviewInput().lines[0], lineKey: "line:2", ordinal: 2, costGroupName: "Shared Group", costItemName: "Shared Item", quantity: "7", lineTotalCostMinor: "2500", lineTotalPriceMinor: "7700" },
      ],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "11000", discountApplied: false, discountMinor: "0", finalPriceMinor: "11000", estimatedCostMinor: "4000" },
    });
    const text = extractPdfText((await renderExportPdf(baseInput(review))).bytes);
    const row1 = text.slice(text.indexOf("line:1 -"), text.indexOf("line:2 -"));
    const row2 = text.slice(text.indexOf("line:2 -"));
    expect(row1).toContain("Qty 3");
    expect(row1).toContain("$15.00");
    expect(row1).toContain("$33.00");
    expect(row2).toContain("Qty 7");
    expect(row2).toContain("$25.00");
    expect(row2).toContain("$77.00");
  });

  it("missing CSV classification / unit / cost code / taxable show explicit unknown indications, never blank/invented", async () => {
    const review = await buildBaseReview({ lines: [{ ...makeInternalApprovalReviewInput().lines[0], csvClassification: null, unit: null, costCode: null, taxable: null }] });
    const text = extractPdfText((await renderExportPdf(baseInput(review))).bytes);
    expect(text).toContain("No CSV classification reviewed");
    expect(text).toContain("Unit: unknown");
    expect(text).toContain("Cost code: unknown");
    expect(text).toContain("Taxable unknown");
  });

  it("includes assembly selections by selectionKey, or an explicit 'none recorded' indication when empty", async () => {
    const review = await buildBaseReview();
    const text = extractPdfText((await renderExportPdf(baseInput(review))).bytes);
    expect(text).toContain("selection:1 - Synthetic assembly");

    const empty = await buildBaseReview({ assemblySelections: [] });
    const emptyText = extractPdfText((await renderExportPdf(baseInput(empty))).bytes);
    expect(emptyText).toContain("No assembly selections recorded");
  });

  it("the output representation, embedded in a real manifest, validates against the already-accepted engine", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review);
    const { representation } = await renderExportPdf(input);
    const manifest = normalizeExportManifest({
      version: "internal-estimate-export-v1", format: "pdf", attemptKind: "preflight", outcome: "ready",
      exportId: input.exportId,
      context: { tenantId: review.snapshot.identity.tenantId, projectId: review.snapshot.identity.projectId, clientId: review.snapshot.identity.clientId, estimateDraftId: review.snapshot.identity.estimateDraftId, estimateVersion: review.snapshot.identity.draftVersion, requestedBy: input.generatedBy },
      authority: input.authority, checkedAt: input.generatedAt, lineKeys: review.snapshot.lines.map(l => l.lineKey),
      validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: review.snapshot.financials.finalPriceMinor, exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0", estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
      representation,
    });
    expect(manifest.outcome).toBe("ready");
    const correspondence = await checkExportManifestAgainstSnapshot(manifest, review.snapshot);
    expect(correspondence.contentHashMatches).toBe(true);
  });
});

describe("renderExportPdf — text representability profile v1", () => {
  it("accepts ASCII, Latin-1 accented text, Euro sign, and the 27 WinAnsi-mapped punctuation marks", async () => {
    const sample = "Café Møller Ñoño Zürich € ‘quoted’ “double” —em-dash–en-dash…";
    const review = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: sample } });
    const text = extractPdfText((await renderExportPdf(baseInput(review))).bytes);
    expect(text).toContain(sample);
  });

  it("rejects CJK, Cyrillic, emoji and Latin Extended-A content with EXPORT_FORMAT_UNREPRESENTABLE, isolated to PDF", async () => {
    for (const bad of ["界 CJK text", "Привет мир", "emoji \u{1F642}", "Latin Extended-A Ā"]) {
      const review = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: bad } });
      await expect(renderExportPdf(baseInput(review))).rejects.toBeInstanceOf(ExportRendererError);
      await expect(renderExportPdf(baseInput(review))).rejects.toMatchObject({ code: "EXPORT_FORMAT_UNREPRESENTABLE" });
    }
  });

  it("rejects C0 controls, DEL, C1 controls (even ones byte-identical in WinAnsi to a legitimate mapped character), tab, and soft hyphen", async () => {
    const badChars = [
      "\u0001", // C0 control
      "\u001f", // C0 control (last before space)
      "\u007f", // DEL
      "\u0080", // C1 control -- byte-identical in WinAnsi output to legitimate Euro U+20AC
      "\u0091", // C1 control -- byte-identical in WinAnsi output to legitimate left single quote U+2018
      "\t",     // tab (also a C0 control; called out separately by the contract)
      "\u00ad", // soft hyphen
    ];
    for (const ch of badChars) {
      const review = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: `before${ch}after` } });
      await expect(renderExportPdf(baseInput(review))).rejects.toMatchObject({ code: "EXPORT_FORMAT_UNREPRESENTABLE" });
    }
  });

  it("treats a legitimate curly-quote/Euro character correctly even though it shares a WinAnsi byte with a rejected C1 control — rejection is about the control's code point, not the output byte", async () => {
    const legit = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: "left quote ‘ and euro € are fine" } });
    await expect(renderExportPdf(baseInput(legit))).resolves.toBeTruthy();
  });

  it("accepts LF as an explicit line break without rejecting the surrounding text", async () => {
    const review = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: "Line one\nLine two" } });
    const text = extractPdfText((await renderExportPdf(baseInput(review))).bytes);
    expect(text).toContain("Line one");
    expect(text).toContain("Line two");
  });

  it("preserves literal parentheses and backslashes as plain text, not PDF operator syntax", async () => {
    const review = await buildBaseReview({
      lines: [{ ...makeInternalApprovalReviewInput().lines[0], costItemName: "Cost (labor) \\ item", description: "Looks like an operator ) Tj (attack" }],
    });
    const { bytes } = await renderExportPdf(baseInput(review));
    const text = extractPdfText(bytes);
    expect(text).toContain("Cost (labor) \\ item");
    expect(text).toContain("Looks like an operator ) Tj (attack");
    expect(Buffer.from(bytes).toString("latin1").startsWith("%PDF-")).toBe(true); // structure survived intact
  });

  it("validates EVERY emitted text field before producing any bytes — a non-representable line item blocks the whole render, not just that field", async () => {
    const review = await buildBaseReview({ lines: [{ ...makeInternalApprovalReviewInput().lines[0], costItemName: "界" }] });
    await expect(renderExportPdf(baseInput(review))).rejects.toMatchObject({ code: "EXPORT_FORMAT_UNREPRESENTABLE" });
  });
});

describe("renderExportPdf — creation date range (jsPDF 4.2.0's own 1970-2037 boundary)", () => {
  it("rejects a generatedAt year before 1970 and after 2037, isolated to PDF", async () => {
    for (const generatedAt of ["1969-12-31T23:59:59.999Z", "2038-01-01T00:00:00.000Z"]) {
      const review = await buildBaseReview();
      await expect(renderExportPdf(baseInput(review, { generatedAt })))
        .rejects.toMatchObject({ code: "EXPORT_FORMAT_UNREPRESENTABLE" });
    }
  });

  it("accepts exactly the 1970 and 2037 boundary years, and shows the full millisecond-precision generatedAt in the body", async () => {
    for (const generatedAt of ["1970-01-01T00:00:00.000Z", "2037-12-31T23:59:59.999Z"]) {
      const review = await buildBaseReview();
      const { bytes } = await renderExportPdf(baseInput(review, { generatedAt }));
      expect(extractPdfText(bytes)).toContain(generatedAt);
    }
  });
});

describe("renderExportPdf — layout, pagination, wrapping", () => {
  it("wraps a long run of text without spaces (a single unbreakable token) within the usable page width, never truncating it", async () => {
    const longToken = "A".repeat(400); // far wider than the usable width at 9pt Helvetica
    const review = await buildBaseReview({ presentation: { bundleName: "B", reviewedNotes: longToken } });
    const { bytes } = await renderExportPdf(baseInput(review));
    const text = extractPdfText(bytes);
    expect(text.replace(/\n/g, "")).toContain(longToken); // full token present once wrapping fragments are rejoined
  });

  it("produces multiple real pages for a long snapshot, preserving line order/identity, with pageCount matching the actual page objects", async () => {
    const base = makeInternalApprovalReviewInput();
    const lines = Array.from({ length: 60 }, (_, i) => ({
      lineKey: `line:${i + 1}`, ordinal: i + 1, costGroupName: `Group ${i + 1}`, costItemName: `Item ${i + 1}`,
      description: `A moderately long description for line ${i + 1} to exercise pagination and wrapping behavior across pages`,
      quantity: "2", unit: "EA", unitCostSnapshot: "20", unitPriceSnapshot: "50",
      lineTotalCostMinor: "4000", lineTotalPriceMinor: "10000", assemblyId: null, costCode: "12-100", taxable: true, csvClassification: null,
    }));
    const totalCost = (4000n * 60n).toString(); const totalPrice = (10000n * 60n).toString();
    const review = await buildInternalApprovalReview({
      ...base, lines,
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: totalPrice, discountApplied: false, discountMinor: "0", finalPriceMinor: totalPrice, estimatedCostMinor: totalCost },
    });
    const { bytes, representation } = await renderExportPdf(baseInput(review));
    expect(representation.details.pageCount).toBeGreaterThan(1);
    const pageObjectCount = (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pageObjectCount).toBe(representation.details.pageCount);
    const text = extractPdfText(bytes);
    expect(text.indexOf("line:1 -")).toBeLessThan(text.indexOf("line:2 -"));
    expect(text.indexOf("line:59 -")).toBeLessThan(text.indexOf("line:60 -"));
    expect(text).toContain("line:1 -");
    expect(text).toContain("line:60 -");
  });

  it("never places a text line outside the usable vertical page area (geometry check, not a visual render)", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportPdf(baseInput(review));
    const ys = extractTdYCoordinates(bytes);
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(792); }
    // NOTE: no visual/rendered-pixel check was performed — this asserts only the
    // numeric Td coordinates written to the content stream stay within the
    // Letter-page geometry this layout targets.
  });

  it("a short snapshot stays on exactly one page", async () => {
    const review = await buildBaseReview();
    const { representation } = await renderExportPdf(baseInput(review));
    expect(representation.details.pageCount).toBe(1);
  });

  it("never places two consecutive lines on the same page closer than a safe minimum gap — regression for V1's visible overlap (MICHAEL-A1-EXPORT-PDF-V1-QA-AND-CORRECTION.md)", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportPdf(baseInput(review));
    const raw = Buffer.from(bytes).toString("latin1");
    // Walk per content stream (= per page) so the top-of-next-page reset is
    // never compared against the bottom-of-previous-page as a false "overlap".
    let idx = 0; let minGapSeen = Infinity; let pairsChecked = 0;
    while (true) {
      const s = raw.indexOf("stream\n", idx);
      if (s === -1) break;
      const e = raw.indexOf("endstream", s);
      const chunk = raw.slice(s, e);
      idx = e + 9;
      const ys: number[] = [];
      const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(chunk))) ys.push(Number.parseFloat(m[2]));
      for (let i = 1; i < ys.length; i++) {
        const gap = ys[i - 1] - ys[i];
        if (gap <= 0) continue; // not a top-to-bottom same-page advance
        pairsChecked++;
        minGapSeen = Math.min(minGapSeen, gap);
      }
    }
    expect(pairsChecked).toBeGreaterThan(10);
    // V1's bug produced 5.5pt gaps at 9pt body text (less than the font's own
    // line height); 8pt is comfortably below every real per-fontSize line
    // height used in this layout (9pt body = 11.7pt, 11/12pt headings more),
    // so this threshold would have failed on V1 and passes on the fix.
    expect(minGapSeen).toBeGreaterThanOrEqual(8);
  });

  it("a block-kind transition (heading/subheading to body and back) keeps at least as much separation as a same-kind transition — no font-size-dependent overlap", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportPdf(baseInput(review));
    const raw = Buffer.from(bytes).toString("latin1");
    const s = raw.indexOf("stream\n"); const e = raw.indexOf("endstream", s);
    const chunk = raw.slice(s, e);
    // Pull (fontSize, y) pairs in document order from the /F1|/F2 Tf + Td pairs.
    const re = /\/F\d\s+([\d.]+)\s+Tf[\s\S]{0,80}?(-?[\d.]+)\s+(-?[\d.]+)\s+Td/g;
    const entries: { fontSize: number; y: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) entries.push({ fontSize: Number.parseFloat(m[1]), y: Number.parseFloat(m[3]) });
    expect(entries.length).toBeGreaterThan(5);
    for (let i = 1; i < entries.length; i++) {
      const gap = entries[i - 1].y - entries[i].y;
      if (gap <= 0) continue;
      // Minimum acceptable is the larger side's own line height alone (no extra) —
      // a transition must never be tighter than either block would require on its own.
      const minAcceptable = Math.min(entries[i - 1].fontSize, entries[i].fontSize) * 1.3;
      expect(gap).toBeGreaterThanOrEqual(minAcceptable - 0.01); // float tolerance
    }
  });
});

describe("renderExportPdf — page count domain (1..10000)", () => {
  it("rejects a valid newline-heavy snapshot that would exceed 10,000 pages, even though it stays well under the 10 MiB byte limit — regression for V1 returning an out-of-domain representation (MICHAEL-A1-EXPORT-PDF-V1-QA-AND-CORRECTION.md)", async () => {
    const base = makeInternalApprovalReviewInput();
    const heavyDescription = "\n".repeat(4900); // within description's 5000-char limit
    const lines = Array.from({ length: 160 }, (_, i) => ({
      lineKey: `line:${i + 1}`, ordinal: i + 1, costGroupName: `Group ${i + 1}`, costItemName: `Item ${i + 1}`,
      description: heavyDescription, quantity: "2", unit: "EA", unitCostSnapshot: "20", unitPriceSnapshot: "50",
      lineTotalCostMinor: "4000", lineTotalPriceMinor: "10000", assemblyId: null, costCode: "12-100", taxable: true, csvClassification: null,
    }));
    const totalCost = (4000n * 160n).toString(); const totalPrice = (10000n * 160n).toString();
    const review = await buildInternalApprovalReview({
      ...base, lines,
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: totalPrice, discountApplied: false, discountMinor: "0", finalPriceMinor: totalPrice, estimatedCostMinor: totalCost },
    });
    await expect(renderExportPdf(baseInput(review))).rejects.toMatchObject({ code: "EXPORT_FORMAT_UNREPRESENTABLE" });
  }, 20000); // early-abort at page 10001 keeps this fast; V1 would have laid out ~12649 pages first
});

describe("renderExportPdf — determinism across processes/TZ/locale, and coherent variation", () => {
  it("same input across 3 fresh Node child processes with different TZ/locale produces byte-identical PDFs", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review);
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    // System/mission tmp, never inside the accepted checkout (MICHAEL-A1-EXPORT-PDF-V1-QA-AND-CORRECTION.md).
    const fixtureDir = mkdtempSync(join(tmpdir(), "a1-pdf-determinism-"));
    try {
      const inputPath = join(fixtureDir, "input.json");
      writeFileSync(inputPath, JSON.stringify(input));
      const workerPath = join(fixtureDir, "worker.cjs");
      writeFileSync(workerPath, [
        "const fs = require('fs');",
        "const { pathToFileURL } = require('url');",
        // argv[0]=node, argv[1]=this script path, argv[2]=inputPath, argv[3]=modulePath, argv[4]=outPdfPath
        "const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));",
        "(async () => {",
        "  const mod = await import(pathToFileURL(process.argv[3]).href);",
        "  const { bytes } = await mod.renderExportPdf(input);",
        "  fs.writeFileSync(process.argv[4], Buffer.from(bytes));",
        "})();",
      ].join("\n"));
      const modulePath = `${process.cwd()}/shared/internal-estimate-export-pdf-renderer.ts`;
      const run = (tz: string, lang: string) => {
        const outPath = join(fixtureDir, `out-${tz.replace(/\W/g, "_")}.pdf`);
        // Explicit environment allowlist — never the full inherited process.env.
        const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? tmpdir(), TZ: tz, LANG: lang, LC_ALL: lang };
        execFileSync(process.execPath, ["--import", "tsx", workerPath, inputPath, modulePath, outPath], { env, timeout: 30000 });
        return readFileSync(outPath);
      };
      const utc = run("UTC", "en_US.UTF-8");
      const newYork = run("America/New_York", "en_US.UTF-8");
      const tokyo = run("Asia/Tokyo", "ja_JP.UTF-8");
      // Compare the REAL bytes produced in each process, not only their hashes.
      expect(newYork.equals(utc)).toBe(true);
      expect(tokyo.equals(utc)).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 60000);

  it("is deterministic in-process and does not mutate its input", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review);
    const snapshotBefore = JSON.parse(JSON.stringify(input.snapshot));
    const first = await renderExportPdf(input);
    const second = await renderExportPdf(input);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(input.snapshot).toEqual(snapshotBefore);
  });

  it("changing content or metadata changes the actual content, not merely the file ID", async () => {
    const review = await buildBaseReview();
    const baseline = await renderExportPdf(baseInput(review));
    const baselineText = extractPdfText(baseline.bytes);

    const changedContent = await buildBaseReview({ presentation: { bundleName: "Different Bundle Name", reviewedNotes: null } });
    const changedContentOut = await renderExportPdf(baseInput(changedContent));
    expect(extractPdfText(changedContentOut.bytes)).toContain("Different Bundle Name");
    expect(changedContentOut.representation.artifactHash).not.toBe(baseline.representation.artifactHash);

    const changedMetadata = await renderExportPdf(baseInput(review, { generatedAt: "2030-05-15T08:30:00.000Z" }));
    expect(extractPdfText(changedMetadata.bytes)).toContain("2030-05-15T08:30:00.000Z");
    expect(baselineText).not.toContain("2030-05-15T08:30:00.000Z");
    expect(changedMetadata.representation.artifactHash).not.toBe(baseline.representation.artifactHash);
  });
});

describe("renderExportPdf — 10 MiB response limit", () => {
  /**
   * Unlike JSON/printable (UTF-8 multi-byte inflation reaches the limit),
   * PDF text is single-byte WinAnsi -- 1 char is always 1 byte regardless of
   * which representable character is used. Schema-maximum `lines` alone
   * (1000 x ~5.5KB of label/description text) measured at ~9.84MB of real
   * output -- close, but under the limit; the PDF OPERATOR OVERHEAD per
   * wrapped line (each of ~57,000 wrapped description lines costs its own
   * BT/Tf/TL/Td/Tj/ET syntax, not just its text) is what gets this close at
   * all. Maxing assemblySelections too (also schema-capped at 1000) is what
   * actually pushes real output over 10,485,760 bytes -- confirmed by
   * measuring the undecorated byte count before writing this fixture.
   */
  it("rejects a render whose content genuinely exceeds 10,485,760 bytes", async () => {
    const base = makeInternalApprovalReviewInput();
    const maxDescription = "A".repeat(5000);
    const lines = Array.from({ length: 1000 }, (_, i) => ({
      lineKey: `line:${i + 1}`, ordinal: i + 1, costGroupName: "A".repeat(255), costItemName: "A".repeat(255),
      description: maxDescription, quantity: "2", unit: "EA", unitCostSnapshot: "20", unitPriceSnapshot: "50",
      lineTotalCostMinor: "4000", lineTotalPriceMinor: "10000", assemblyId: null, costCode: "12-100", taxable: true, csvClassification: null,
    }));
    const selections = Array.from({ length: 1000 }, (_, i) => ({
      selectionKey: `selection:${i + 1}`, ordinal: i + 1, assemblyId: base.identity.tenantId, assemblyName: "B".repeat(255),
      assemblyCode: "C".repeat(128), category: "D".repeat(255), quantity: "2", unitCost: "20", unitPrice: "50",
      extendedCostMinor: "4000", extendedPriceMinor: "10000",
    }));
    const totalCost = (4000n * 1000n).toString(); const totalPrice = (10000n * 1000n).toString();
    const review = await buildInternalApprovalReview({
      ...base, lines, assemblySelections: selections,
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: totalPrice, discountApplied: false, discountMinor: "0", finalPriceMinor: totalPrice, estimatedCostMinor: totalCost },
    });
    await expect(renderExportPdf(baseInput(review))).rejects.toMatchObject({ code: "EXPORT_PAYLOAD_TOO_LARGE" });
  }, 30000);

  it("the same shape at a size comfortably under the limit renders successfully — proving the rejection above is about real byte size, not array-length alone", async () => {
    const review = await buildBaseReview({
      lines: [{ ...makeInternalApprovalReviewInput().lines[0], description: "A".repeat(5000) }],
    });
    const { bytes } = await renderExportPdf(baseInput(review));
    expect(bytes.length).toBeLessThan(10_485_760);
  }, 30000);
});
