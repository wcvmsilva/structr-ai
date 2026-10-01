/**
 * A1-EXPORT-JSON-PRINTABLE-CONTRACT.md — behavior tests for the pure JSON and
 * printable renderers. Independent oracle for hashing: Node's own `crypto`
 * module is used HERE ONLY, never inside the shared renderer module itself
 * (which uses WebCrypto exclusively, per the accepted decision).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  renderExportJson, renderExportPrintable, escapeHtmlText, escapeHtmlAttribute, ExportRendererError,
} from "../shared/internal-estimate-export-renderer";
import { buildInternalApprovalReview, InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import { normalizeExportManifest, checkExportManifestAgainstSnapshot } from "../shared/internal-estimate-export-engine";
import { makeInternalApprovalReviewInput, approvalIds } from "./internal-estimate-approval-engine.fixtures";

const GENERATED_AT = "2026-10-01T00:00:00.000Z";

async function buildBaseReview(overrides: Record<string, unknown> = {}) {
  return buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(), ...overrides });
}
function baseInput(review: Awaited<ReturnType<typeof buildBaseReview>>, rendererVersion: string, overrides: Record<string, unknown> = {}) {
  return {
    snapshot: review.snapshot,
    authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: review.contentHash },
    exportId: randomUUID(), rendererVersion, generatedAt: GENERATED_AT, generatedBy: approvalIds.actor,
    ...overrides,
  };
}
function independentSha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

describe("renderExportJson", () => {
  it("produces canonical JSON bytes whose independently-computed SHA-256 matches the returned artifactHash", async () => {
    const review = await buildBaseReview();
    const { bytes, representation } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    expect(independentSha256Hex(bytes)).toBe(representation.artifactHash);
    expect(representation.byteLength).toBe(bytes.length);
  });

  it("canonical object keys are sorted lexicographically at every level (document, authority, exportMetadata)", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    const text = Buffer.from(bytes).toString("utf8");
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed)).toEqual(["authority", "exportMetadata", "snapshot", "version"]);
    expect(Object.keys(parsed.authority)).toEqual(["approvalId", "contentHash", "snapshotId"]);
    expect(Object.keys(parsed.exportMetadata)).toEqual(["exportId", "generatedAt", "generatedBy", "rendererVersion"]);
    // Raw-text order check too — sorted KEYS, not just round-trippable via JSON.parse
    // (which would hide an accidental non-canonical but still-parseable ordering).
    expect(text.indexOf('"authority"')).toBeLessThan(text.indexOf('"exportMetadata"'));
    expect(text.indexOf('"exportMetadata"')).toBeLessThan(text.indexOf('"snapshot"'));
    expect(text.indexOf('"snapshot"')).toBeLessThan(text.indexOf('"version"'));
  });

  it("preserves array order exactly as given (lines are NOT re-sorted)", async () => {
    const review = await buildBaseReview({
      lines: [
        { ...makeInternalApprovalReviewInput().lines[0], lineKey: "line:1", ordinal: 1, costItemName: "First item", lineTotalCostMinor: "1000", lineTotalPriceMinor: "3000" },
        { ...makeInternalApprovalReviewInput().lines[0], lineKey: "line:2", ordinal: 2, costItemName: "Second item", lineTotalCostMinor: "3000", lineTotalPriceMinor: "7000" },
      ],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: false, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: "4000" },
    });
    const { bytes } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    expect(parsed.snapshot.lines.map((l: any) => l.costItemName)).toEqual(["First item", "Second item"]);
  });

  it("encodes Unicode content as exact UTF-8 bytes (no mangling, no escaping-as-ASCII)", async () => {
    const review = await buildBaseReview({ presentation: { bundleName: "Café ☕ 界", reviewedNotes: null } });
    const { bytes } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    const text = Buffer.from(bytes).toString("utf8");
    expect(text).toContain("Café ☕ 界");
    expect(Buffer.byteLength(text, "utf8")).toBe(bytes.length);
  });

  it("has no BOM and no trailing newline", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    expect(bytes[0]).not.toBe(0xef); // UTF-8 BOM starts EF BB BF
    expect(bytes[bytes.length - 1]).not.toBe(0x0a); // '\n'
  });

  it("never includes the artifactHash field inside the hashed bytes themselves", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    expect(Buffer.from(bytes).toString("utf8")).not.toContain("artifactHash");
  });

  it("is deterministic: identical input produces byte-identical output across repeated calls", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, "internal-estimate-json-v1");
    const first = await renderExportJson(input);
    const second = await renderExportJson(input);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(first.representation).toEqual(second.representation);
  });

  it("never mutates its input", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, "internal-estimate-json-v1");
    const snapshotBefore = JSON.parse(JSON.stringify(input.snapshot));
    const authorityBefore = { ...input.authority };
    await renderExportJson(input);
    expect(input.snapshot).toEqual(snapshotBefore);
    expect(input.authority).toEqual(authorityBefore);
  });

  it("rejects a rendererVersion that isn't the JSON literal (EXPORT_RENDERER_UNAVAILABLE)", async () => {
    const review = await buildBaseReview();
    await expect(renderExportJson(baseInput(review, "internal-estimate-printable-v1")))
      .rejects.toMatchObject({ code: "EXPORT_RENDERER_UNAVAILABLE" });
    await expect(renderExportJson(baseInput(review, "internal-estimate-printable-v1"))).rejects.toBeInstanceOf(ExportRendererError);
  });

  it("rejects a malformed wrapper with an extra key (strict object)", async () => {
    const review = await buildBaseReview();
    const input: any = baseInput(review, "internal-estimate-json-v1");
    input.unexpectedExtra = "nope";
    await expect(renderExportJson(input)).rejects.toBeInstanceOf(InternalApprovalError);
  });

  it("rejects a malformed snapshot (missing a required field)", async () => {
    const review = await buildBaseReview();
    const input: any = baseInput(review, "internal-estimate-json-v1");
    const { version: _v, ...brokenSnapshot } = input.snapshot;
    input.snapshot = brokenSnapshot;
    await expect(renderExportJson(input)).rejects.toBeInstanceOf(InternalApprovalError);
  });

  it("rejects authority with an invalid hash shape", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, "internal-estimate-json-v1", { authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: "not-a-hash" } });
    await expect(renderExportJson(input)).rejects.toBeInstanceOf(InternalApprovalError);
  });

  it("rejects a diverging contentHash BEFORE producing any bytes (recomputed from the validated snapshot, never trusting the caller's claim)", async () => {
    const review = await buildBaseReview();
    const wrongHash = "0".repeat(64);
    const input = baseInput(review, "internal-estimate-json-v1", { authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: wrongHash } });
    await expect(renderExportJson(input)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
  });

  it("fails closed when WebCrypto digest is unavailable, without a Node-crypto fallback", async () => {
    const review = await buildBaseReview();
    const realDigest = globalThis.crypto.subtle.digest;
    // @ts-expect-error — deliberately breaking WebCrypto for this one test
    globalThis.crypto.subtle.digest = undefined;
    try {
      await expect(renderExportJson(baseInput(review, "internal-estimate-json-v1")))
        .rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE" });
    } finally {
      globalThis.crypto.subtle.digest = realDigest;
    }
  });

  it("missing CSV classification on a line does not block JSON rendering", async () => {
    const review = await buildBaseReview({ lines: [{ ...makeInternalApprovalReviewInput().lines[0], csvClassification: null }] });
    await expect(renderExportJson(baseInput(review, "internal-estimate-json-v1"))).resolves.toBeTruthy();
  });

  it("the output representation, embedded in a real manifest, validates against the ALREADY-ACCEPTED engine (normalizeExportManifest) and matches the real snapshot (checkExportManifestAgainstSnapshot)", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, "internal-estimate-json-v1");
    const { representation } = await renderExportJson(input);
    const manifest = normalizeExportManifest({
      version: "internal-estimate-export-v1", format: "json", attemptKind: "preflight", outcome: "ready",
      exportId: input.exportId,
      context: { tenantId: review.snapshot.identity.tenantId, projectId: review.snapshot.identity.projectId, clientId: review.snapshot.identity.clientId, estimateDraftId: review.snapshot.identity.estimateDraftId, estimateVersion: review.snapshot.identity.draftVersion, requestedBy: input.generatedBy },
      authority: input.authority, checkedAt: input.generatedAt, lineKeys: review.snapshot.lines.map(l => l.lineKey),
      validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: review.snapshot.financials.finalPriceMinor, exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0", estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
      representation,
    });
    expect(manifest.outcome).toBe("ready");
    const correspondence = await checkExportManifestAgainstSnapshot(manifest, review.snapshot);
    expect(correspondence.contentHashMatches).toBe(true);
    expect(correspondence.lineKeysMatchSnapshotExactly).toBe(true);
  });

  it("round-trips a 20-digit money value exactly (no float loss) inside the snapshot", async () => {
    const bigMinor = "99999999999999999999"; // 20 nines — within MAX_MINOR (10^20 - 1)
    const review = await buildBaseReview({
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: bigMinor, discountApplied: false, discountMinor: "0", finalPriceMinor: bigMinor, estimatedCostMinor: "4000" },
      lines: [{ ...makeInternalApprovalReviewInput().lines[0], lineTotalPriceMinor: bigMinor, lineTotalCostMinor: "4000" }],
    });
    const { bytes } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    expect(parsed.snapshot.financials.finalPriceMinor).toBe(bigMinor);
  });
});

describe("renderExportPrintable", () => {
  it("produces a real HTML document whose independently-computed SHA-256 matches the returned artifactHash", async () => {
    const review = await buildBaseReview();
    const { bytes, representation } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    expect(independentSha256Hex(bytes)).toBe(representation.artifactHash);
    const html = Buffer.from(bytes).toString("utf8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(representation.mimeType).toBe("text/html");
    expect(representation.details).toEqual({ templateVersion: "internal-estimate-summary-v1", escaping: "html-text-attribute-v1", sandbox: "no-scripts-no-network-v1" });
  });

  it("rejects a rendererVersion that isn't the printable literal", async () => {
    const review = await buildBaseReview();
    await expect(renderExportPrintable(baseInput(review, "internal-estimate-json-v1")))
      .rejects.toMatchObject({ code: "EXPORT_RENDERER_UNAVAILABLE" });
  });

  it("is deterministic and does not mutate its input", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, "internal-estimate-printable-v1");
    const snapshotBefore = JSON.parse(JSON.stringify(input.snapshot));
    const first = await renderExportPrintable(input);
    const second = await renderExportPrintable(input);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(input.snapshot).toEqual(snapshotBefore);
  });

  it("escapes a script-injection attempt in reviewedNotes — no unescaped <script> or executable sequence reaches the output", async () => {
    const malicious = `Reviewed </div><script>alert(1)</script> and a close attempt" onmouseover="alert(2)`;
    const review = await buildBaseReview({ presentation: { bundleName: "Synthetic", reviewedNotes: malicious } });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;/script&gt;");
    // The `"` before "onmouseover" is never escaped by a TEXT-context escaper
    // (correctly — it's inert inside a text node, not inside an attribute),
    // so it appears verbatim; the real property is that it can never form a
    // live tag/attribute, which the absence of any un-escaped `<` already
    // guarantees. Assert there is no actual element carrying that handler.
    expect(html).not.toMatch(/<[a-z]+[^&<]*\bonmouseover\s*=/i);
  });

  it("escapes an injection attempt in costGroupName/costItemName/description", async () => {
    const review = await buildBaseReview({
      lines: [{
        ...makeInternalApprovalReviewInput().lines[0],
        costGroupName: "Group <img src=x onerror=alert(1)>", costItemName: "Item & co.",
        description: "Line one\nLine two <iframe src=//evil.example></iframe>",
      }],
    });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Item &amp; co.");
    expect(html).toContain("&lt;iframe src=//evil.example&gt;&lt;/iframe&gt;");
    // The literal newline is preserved as TEXT (pre-wrap CSS does the visual
    // break), never converted into a <br> tag derived from user content.
    expect(html).toContain("Line one\nLine two");
    expect(html).not.toContain("Line one<br>Line two");
  });

  it("has no <script>, external href/src, <iframe>, <form> or @import anywhere in the whole document, even outside the escaped-content check above", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/href\s*=\s*"https?:/i);
    expect(html).not.toMatch(/src\s*=\s*"https?:/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i); // no inline event handlers anywhere
  });

  it("the document never declares issuance, acceptance, signature or receipt", async () => {
    const review = await buildBaseReview();
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8").toLowerCase();
    expect(html).not.toContain("accepted");
    expect(html).not.toContain("signed");
    expect(html).not.toContain("issued");
    expect(html).not.toContain("received by");
  });

  it("distinguishes two lines with identical display names but different LineKeys — each row keeps its OWN quantity/cost/price, never mixed up", async () => {
    const review = await buildBaseReview({
      lines: [
        { ...makeInternalApprovalReviewInput().lines[0], lineKey: "line:1", ordinal: 1, costGroupName: "Shared Group", costItemName: "Shared Item", quantity: "3", lineTotalCostMinor: "1500", lineTotalPriceMinor: "3300" },
        { ...makeInternalApprovalReviewInput().lines[0], lineKey: "line:2", ordinal: 2, costGroupName: "Shared Group", costItemName: "Shared Item", quantity: "7", lineTotalCostMinor: "2500", lineTotalPriceMinor: "7700" },
      ],
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "11000", discountApplied: false, discountMinor: "0", finalPriceMinor: "11000", estimatedCostMinor: "4000" },
    });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    const row1 = html.slice(html.indexOf("<td>line:1</td>"), html.indexOf("<td>line:2</td>"));
    const row2 = html.slice(html.indexOf("<td>line:2</td>"));
    expect(row1).toContain("<td>3</td>");
    expect(row1).toContain("$15.00");
    expect(row1).toContain("$33.00");
    expect(row2).toContain("<td>7</td>");
    expect(row2).toContain("$25.00");
    expect(row2).toContain("$77.00");
  });

  it("missing CSV classification shows an explicit indication, never a silently blank/invented value, and does not block rendering", async () => {
    const review = await buildBaseReview({ lines: [{ ...makeInternalApprovalReviewInput().lines[0], csvClassification: null, unit: null, costCode: null, taxable: null }] });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    expect(html).toContain("No CSV classification reviewed");
    expect(html).toContain("Unit unknown");
    expect(html).toContain("Cost code unknown");
    expect(html).toContain("Taxable unknown");
    expect(html).not.toContain("<td>false</td>");
    expect(html).not.toContain("<td>0</td>");
  });

  it("zero-denominator and null assembly GP% show a textual indication, never 0%, NaN, Infinity or a thrown error", async () => {
    const review = await buildBaseReview({
      assemblySelections: [
        { ...makeInternalApprovalReviewInput().assemblySelections[0], selectionKey: "selection:1", extendedPriceMinor: "0", extendedCostMinor: "0" },
      ],
    });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    // Scope to the assembly row itself — the OVERALL snapshot totals legitimately
    // show "60.0%" elsewhere in the document, which contains "0.0%" as a
    // substring; checking the whole document would be a false positive.
    const assemblyRow = html.slice(html.indexOf("<td>selection:1</td>"));
    expect(assemblyRow).not.toMatch(/<td>-?\d+\.\d%<\/td>/);
    expect(assemblyRow).toContain("<td>—</td>");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).toContain("—");
  });

  it("negative gross profit rounds the exact half-decimal boundary AWAY from zero (not toward zero, not banker's rounding)", async () => {
    // price=16 (minor), cost=17 → profit=-1 → |profit|/price*1000 = 1000/16 = 62.5 exactly
    // → rounds to 63 tenths → "-6.3%", proving away-from-zero on the negative side.
    const review = await buildBaseReview({
      assemblySelections: [
        { ...makeInternalApprovalReviewInput().assemblySelections[0], selectionKey: "selection:1", extendedPriceMinor: "16", extendedCostMinor: "17" },
      ],
    });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    expect(html).toContain("-6.3%");
  });

  it("formats Decimal6 rates and quantities exactly as given, never padded/truncated to two decimals", async () => {
    const review = await buildBaseReview({
      lines: [{ ...makeInternalApprovalReviewInput().lines[0], quantity: "1.333333", unitCostSnapshot: "20.5", unitPriceSnapshot: "50" }],
    });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    expect(html).toContain("1.333333");
    expect(html).toContain("20.5"); // not "20.50"
  });

  it("shows discount presence and amount separately, never folding a non-applied discount into the totals silently", async () => {
    const review = await buildBaseReview({
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: true, discountMinor: "500", finalPriceMinor: "9500", estimatedCostMinor: "4000" },
    });
    const { bytes } = await renderExportPrintable(baseInput(review, "internal-estimate-printable-v1"));
    const html = Buffer.from(bytes).toString("utf8");
    expect(html).toContain("$5.00");
    expect(html).toContain("$95.00");
    expect(html).toContain("$100.00");
  });

  it("the output representation, embedded in a real manifest, validates against the already-accepted engine", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, "internal-estimate-printable-v1");
    const { representation } = await renderExportPrintable(input);
    const manifest = normalizeExportManifest({
      version: "internal-estimate-export-v1", format: "printable", attemptKind: "preflight", outcome: "ready",
      exportId: input.exportId,
      context: { tenantId: review.snapshot.identity.tenantId, projectId: review.snapshot.identity.projectId, clientId: review.snapshot.identity.clientId, estimateDraftId: review.snapshot.identity.estimateDraftId, estimateVersion: review.snapshot.identity.draftVersion, requestedBy: input.generatedBy },
      authority: input.authority, checkedAt: input.generatedAt, lineKeys: review.snapshot.lines.map(l => l.lineKey),
      validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: review.snapshot.financials.finalPriceMinor, exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0", estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
      representation,
    });
    expect(manifest.outcome).toBe("ready");
  });

  it("rejects a diverging contentHash before producing bytes, same as JSON", async () => {
    const review = await buildBaseReview();
    const input = baseInput(review, "internal-estimate-printable-v1", { authority: { approvalId: approvalIds.approval, snapshotId: randomUUID(), contentHash: "1".repeat(64) } });
    await expect(renderExportPrintable(input)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
  });
});

describe("escapeHtmlText / escapeHtmlAttribute (pure helpers)", () => {
  it("escapes &, <, > in text context", () => {
    expect(escapeHtmlText(`a & b < c > d`)).toBe("a &amp; b &lt; c &gt; d");
  });
  it("escapes quotes in attribute context in addition to text escaping", () => {
    expect(escapeHtmlAttribute(`He said "hi" & 'bye'`)).toBe("He said &quot;hi&quot; &amp; &#39;bye&#39;");
  });
  it("round-trips plain ASCII and Unicode text unchanged when there is nothing to escape", () => {
    expect(escapeHtmlText("Café 界 plain text")).toBe("Café 界 plain text");
  });
});

describe("EXPORT_PAYLOAD_TOO_LARGE — the 10 MiB response limit, reached for real via Unicode-heavy content", () => {
  function manyLinesReviewInput(count: number, padChar: string) {
    const base = makeInternalApprovalReviewInput();
    const maxLabel = padChar.repeat(255);
    const maxDescription = padChar.repeat(5000);
    const lines = Array.from({ length: count }, (_, i) => ({
      lineKey: `line:${i + 1}`, ordinal: i + 1, costGroupName: maxLabel, costItemName: maxLabel,
      description: maxDescription, quantity: "2", unit: "EA", unitCostSnapshot: "20", unitPriceSnapshot: "50",
      lineTotalCostMinor: "4000", lineTotalPriceMinor: "10000", assemblyId: null, costCode: "12-100", taxable: true,
      csvClassification: null,
    }));
    const totalCost = (4000n * BigInt(count)).toString();
    const totalPrice = (10000n * BigInt(count)).toString();
    return {
      ...base, lines,
      financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: totalPrice, discountApplied: false, discountMinor: "0", finalPriceMinor: totalPrice, estimatedCostMinor: totalCost },
    };
  }

  it("rejects a JSON render whose Unicode-heavy snapshot genuinely exceeds 10,485,760 bytes", async () => {
    const review = await buildInternalApprovalReview(manyLinesReviewInput(1000, "界"));
    await expect(renderExportJson(baseInput(review, "internal-estimate-json-v1")))
      .rejects.toMatchObject({ code: "EXPORT_PAYLOAD_TOO_LARGE" });
  }, 30000);

  it("rejects a printable render whose Unicode-heavy snapshot genuinely exceeds 10,485,760 bytes", async () => {
    const review = await buildInternalApprovalReview(manyLinesReviewInput(1000, "界"));
    await expect(renderExportPrintable(baseInput(review, "internal-estimate-printable-v1")))
      .rejects.toMatchObject({ code: "EXPORT_PAYLOAD_TOO_LARGE" });
  }, 30000);

  it("the SAME shape at the same line count with plain ASCII content stays under the limit and renders successfully — proving the rejection above is about real byte size, not line count alone", async () => {
    const review = await buildInternalApprovalReview(manyLinesReviewInput(1000, "A"));
    const { bytes } = await renderExportJson(baseInput(review, "internal-estimate-json-v1"));
    expect(bytes.length).toBeLessThan(10_485_760);
  }, 30000);
});
