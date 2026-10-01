/**
 * A1-EXPORT-DATA-CONTRACT.md §7, A1-EXPORT-PDF-IMPLEMENTATION-CONTRACT.md —
 * pure PDF renderer over an approved snapshot. Same single-input contract as
 * the JSON/printable renderers (shared/internal-estimate-export-renderer.ts):
 * typed/validated snapshot core + immutable metadata, caller-supplied
 * authority reference. NEVER consults a live catalog/draft/project/notes or
 * current profile. No persistence, no network, no Date.now/random/env.
 *
 * jsPDF@4.2.0 pinned (MICHAEL-A1-EXPORT-PDF-DETERMINISM-DECISION.md): the
 * library's own defaults for the PDF trailer `/ID` (Math.random) and
 * `/CreationDate` (local-timezone Date getters) are NEVER used — both are
 * always set explicitly, before serialization, from the validated input.
 */
import { jsPDF } from "jspdf";
import {
  canonicalizeInternalApproval as canonicalizeApprovalJson, type InternalApprovalSnapshot,
} from "./internal-estimate-approval-engine";
import {
  parseAndAuthenticate, sha256HexOfBytes, assertWithinResponseLimit,
  formatMinorAsUsd, formatDecimalAsIs, formatGrossProfitPercent,
  ExportRendererError, type ExportRenderInput, type ExportRenderResult,
} from "./internal-estimate-export-renderer";
import { buildExportFilename, type ExportManifest } from "./internal-estimate-export-engine";
import { EXPORT_PROTOCOL as EP } from "./domain/taxonomy";

const PINNED_JSPDF_VERSION = "4.2.0";
type PdfRepresentation = Extract<NonNullable<ExportManifest["representation"]>, { format: "pdf" }>;

// ── Layout v1 — fixed, versioned (A1-EXPORT-PDF-IMPLEMENTATION-CONTRACT.md) ─
const LAYOUT = {
  unit: "pt" as const, format: "letter" as const, // 612x792pt
  pageWidth: 612, pageHeight: 792,
  marginLeft: 40, marginRight: 40, marginTop: 40, marginBottom: 40,
  bodyFontSize: 9, headingFontSize: 12, lineHeight: 11.5, paragraphGap: 5.5, sectionGap: 14,
};
const USABLE_WIDTH = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;
const USABLE_BOTTOM = LAYOUT.pageHeight - LAYOUT.marginBottom;

// ── Textual representability profile v1 ────────────────────────────────────
/**
 * Literal, versioned whitelist of Unicode code points this renderer accepts,
 * tied to jsPDF@4.2.0's standard Helvetica/WinAnsiEncoding font — NOT derived
 * by sniffing bytes jsPDF happens to emit (that conflated raw C1 controls
 * with their same-byte WinAnsi lookalikes; QA found U+0080 == Euro U+20AC and
 * U+0091 == left-quote U+2018 in OUTPUT bytes, which is not a representability
 * signal). Source of truth for the 27-entry table: the exact comment block in
 * `node_modules/jspdf/dist/jspdf.node.js` near `to8bitStream` (~line 3329),
 * "Unicode characters to WinAnsiEncoding:" — reproduced here as data, pinned
 * to jsPDF 4.2.0; a library version bump requires re-deriving this table, not
 * silently reusing it.
 */
const WIN_ANSI_EXTRA_UNICODE: ReadonlySet<number> = new Set([
  402, 8211, 8212, 8216, 8217, 8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230,
  8364, 8240, 8249, 8250, 710, 8482, 338, 339, 732, 352, 353, 376, 381, 382,
]);
const SOFT_HYPHEN = 0x00ad;
function isRepresentableCodePoint(cp: number): boolean {
  if (cp === 0x0a) return true; // LF — explicit paragraph structure, never a raw literal char passed to doc.text
  if (cp >= 0x20 && cp <= 0x7e) return true; // ASCII printable
  if (cp === SOFT_HYPHEN) return false; // explicit exclusion — never a silent visible hyphen for a break control
  if (cp >= 0xa0 && cp <= 0xff) return true; // Latin-1 printable (0x80-0x9f are C1 controls, excluded below)
  return WIN_ANSI_EXTRA_UNICODE.has(cp);
}
/** Every other C0 control (including TAB), DEL, every C1 control, soft hyphen,
 * and anything outside the whitelist above (CJK/Cyrillic/emoji/Latin
 * Extended-A/etc.) is rejected — never dropped/expanded/transliterated. */
function isRepresentableText(text: string): boolean {
  for (const ch of text) { if (!isRepresentableCodePoint(ch.codePointAt(0)!)) return false; }
  return true;
}

// ── Deterministic CreationDate / FileId (the decision's two fixed points) ──
/** jsPDF 4.2.0's setCreationDate(string) only accepts years 1970-2037 (its own
 * regex); outside that range it throws. We check the SAME range ourselves,
 * before calling the library, so the result is our own typed error, never a
 * caught library exception or a silently clamped/local-timezone date. */
function pdfCreationDateUtc(generatedAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/.exec(generatedAt);
  if (!m) throw new ExportRendererError("EXPORT_FORMAT_UNREPRESENTABLE");
  const year = Number(m[1]);
  if (year < 1970 || year > 2037) throw new ExportRendererError("EXPORT_FORMAT_UNREPRESENTABLE");
  const [, y, mo, d, h, mi, s] = m;
  return `D:${y}${mo}${d}${h}${mi}${s}+00'00'`;
}
/** First 32 hex chars (uppercased) of the WebCrypto SHA-256 of the canonical
 * JSON of the exact small object the decision specifies — never the library's
 * own Math.random-based default. */
async function pdfFileId(input: { exportId: string; rendererVersion: string; generatedAt: string; generatedBy: string; authority: { approvalId: string; snapshotId: string; contentHash: string } }): Promise<string> {
  const material = canonicalizeApprovalJson({
    exportId: input.exportId, rendererVersion: input.rendererVersion,
    generatedAt: input.generatedAt, generatedBy: input.generatedBy, authority: input.authority,
  });
  const fullHash = await sha256HexOfBytes(new TextEncoder().encode(material));
  return fullHash.slice(0, 32).toUpperCase();
}

// ── Text content model (same fields as the accepted printable, §Conteúdo) ──
const UNKNOWN = (label: string) => `${label}: unknown`;
function identityOrUnknownText(value: string | null, label: string): string { return value === null ? UNKNOWN(label) : value; }
function decimalOrUnknownText(value: string | null, label: string): string { return value === null ? UNKNOWN(label) : formatDecimalAsIs(value); }

interface TextBlock { kind: "heading" | "subheading" | "body"; text: string }
function buildContentBlocks(input: { snapshot: InternalApprovalSnapshot; authority: { approvalId: string; snapshotId: string; contentHash: string }; exportId: string; rendererVersion: string; generatedAt: string; generatedBy: string }): TextBlock[] {
  const s = input.snapshot;
  const f = s.financials;
  const pricing = s.commercialContext.pricingContext;
  const policy = s.commercialContext.policyContext;
  const blocks: TextBlock[] = [];
  const h1 = (text: string) => blocks.push({ kind: "heading", text });
  const h2 = (text: string) => blocks.push({ kind: "subheading", text });
  const p = (text: string) => blocks.push({ kind: "body", text });

  h1("Internal Estimate Summary");
  p(`Export ${input.exportId} - renderer ${input.rendererVersion} - generated ${input.generatedAt} by ${input.generatedBy}`);

  h2("Revision");
  p(`Tenant ${s.identity.tenantId}   Project ${s.identity.projectId}`);
  p(`Client ${s.identity.clientId}   Draft ${s.identity.estimateDraftId} v${s.identity.draftVersion}`);
  p(`Source ${s.origin.source}   Source created ${s.origin.sourceCreatedAt}`);
  p(`Bundle name: ${identityOrUnknownText(s.presentation.bundleName, "Bundle name")}`);
  p(`Approval ${input.authority.approvalId}   Snapshot ${input.authority.snapshotId}`);
  p(`Content hash ${input.authority.contentHash}`);

  h2("Calculation context (captured when priced)");
  p(`Pricing channel: ${identityOrUnknownText(pricing.pricingChannel, "Pricing channel")}   Finish level: ${identityOrUnknownText(pricing.finishLevel, "Finish level")}`);
  p(`Region: ${identityOrUnknownText(pricing.region, "Region")}   Zone: ${identityOrUnknownText(pricing.zone, "Zone")}`);
  p(`Trade: ${identityOrUnknownText(pricing.trade, "Trade")}   Coastal modifier: ${decimalOrUnknownText(pricing.coastalModifier, "Coastal modifier")}`);
  p(`Stored commercial channel: ${identityOrUnknownText(pricing.storedCommercialChannel, "Stored commercial channel")}   Stored geo risk class: ${identityOrUnknownText(pricing.storedGeoRiskClass, "Stored geo risk class")}`);
  p(`Stored risk basis: ${pricing.storedRiskBasis}   Pricing schema version: ${identityOrUnknownText(s.origin.pricingSchemaVersion, "Pricing schema version")}`);

  h2("Review context (verified internally at review time)");
  p(`Commercial channel: ${policy.commercialChannel}   Channel basis: ${policy.channelBasis}`);
  p(`Channel raw value: ${policy.channelRawValue}   Geo risk class: ${policy.geoRiskClass}`);
  p(`Risk basis: ${policy.riskBasis}   Zone: ${policy.projectGeo.zone}`);
  p(`Zone provenance: ${policy.projectGeo.geocodeSource}   Zone resolved at: ${policy.projectGeo.geocodedAt}`);
  p(`Geocode confidence: ${policy.projectGeo.geocodeConfidence}   Coastal exposure: ${policy.projectGeo.coastalExposureLevel}`);
  p(`Risk resolution basis: ${policy.projectGeo.riskResolutionBasis}   Policy version: ${policy.version}`);
  p(`Evaluator version: ${policy.evaluatorVersion}   Effective floor %: ${policy.floors.effectiveFloorPct}`);
  p(`Floor kind: ${policy.floors.floorKind}`);

  h2("Reviewed notes");
  p(s.presentation.reviewedNotes === null ? "No reviewed notes" : s.presentation.reviewedNotes);

  h2("Totals");
  p(`Subtotal (price): ${formatMinorAsUsd(f.subtotalPriceMinor)}`);
  p(`Discount applied: ${f.discountApplied ? "Yes" : "No"}   Discount amount: ${formatMinorAsUsd(f.discountMinor)}`);
  p(`Final price: ${formatMinorAsUsd(f.finalPriceMinor)}`);
  p(`Estimated cost: ${formatMinorAsUsd(f.estimatedCostMinor)}`);
  p(`Gross profit %: ${formatGrossProfitPercent(f.finalPriceMinor, f.estimatedCostMinor)}`);

  h2("Lines (frozen in snapshot; origin: calculated)");
  for (const line of s.lines) {
    const unit = identityOrUnknownText(line.unit, "Unit");
    const taxable = line.taxable === null ? "Taxable unknown" : (line.taxable ? "Taxable: Yes" : "Taxable: No");
    const costCode = identityOrUnknownText(line.costCode, "Cost code");
    const unitCost = line.unitCostSnapshot === null ? "Unit cost: unknown" : `Unit cost: ${formatDecimalAsIs(line.unitCostSnapshot)}`;
    const unitPrice = line.unitPriceSnapshot === null ? "Unit price: unknown" : `Unit price: ${formatDecimalAsIs(line.unitPriceSnapshot)}`;
    const classification = line.csvClassification === null
      ? "No CSV classification reviewed"
      : `CSV classification: ${line.csvClassification.costType} / ${line.csvClassification.normalizedUnit}`;
    p(`${line.lineKey} - ${line.costGroupName} - ${line.costItemName}`);
    p(`Qty ${formatDecimalAsIs(line.quantity)} ${unit}   ${unitCost}   ${unitPrice}   Line cost ${formatMinorAsUsd(line.lineTotalCostMinor)}   Line price ${formatMinorAsUsd(line.lineTotalPriceMinor)}`);
    p(`${taxable}   Cost code: ${costCode}   ${classification}`);
    p(line.description === null ? "Description: unknown" : `Description: ${line.description}`);
  }

  h2("Assembly selections (as calculated, not re-summed into totals)");
  if (s.assemblySelections.length === 0) {
    p("No assembly selections recorded");
  } else {
    for (const selection of s.assemblySelections) {
      const unitCost = selection.unitCost === null ? "Unit cost: unknown" : `Unit cost: ${formatDecimalAsIs(selection.unitCost)}`;
      const unitPrice = selection.unitPrice === null ? "Unit price: unknown" : `Unit price: ${formatDecimalAsIs(selection.unitPrice)}`;
      const extCost = selection.extendedCostMinor === null ? "Ext. cost: unknown" : `Ext. cost: ${formatMinorAsUsd(selection.extendedCostMinor)}`;
      const extPrice = selection.extendedPriceMinor === null ? "Ext. price: unknown" : `Ext. price: ${formatMinorAsUsd(selection.extendedPriceMinor)}`;
      const gp = formatGrossProfitPercent(selection.extendedPriceMinor, selection.extendedCostMinor);
      p(`${selection.selectionKey} - ${selection.assemblyName} - ${identityOrUnknownText(selection.assemblyCode, "Code")} - ${identityOrUnknownText(selection.category, "Category")}`);
      p(`Qty ${formatDecimalAsIs(selection.quantity)}   ${unitCost}   ${unitPrice}   ${extCost}   ${extPrice}   GP % ${gp}`);
    }
  }

  p("This document is an internal rendering of approved snapshot evidence. It does not itself constitute issuance, acceptance, signature or receipt of any export.");
  return blocks;
}

// ── Pagination / wrapping ───────────────────────────────────────────────────
interface Placed { text: string; fontSize: number; bold: boolean; gapAfter: number }
function flattenToPlacedLines(doc: jsPDF, blocks: TextBlock[]): Placed[] {
  const placed: Placed[] = [];
  for (const block of blocks) {
    const fontSize = block.kind === "heading" ? LAYOUT.headingFontSize : block.kind === "subheading" ? LAYOUT.headingFontSize - 1 : LAYOUT.bodyFontSize;
    const bold = block.kind !== "body";
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    // splitTextToSize wraps on measured width (handles tokens without spaces by
    // breaking mid-token when a single token exceeds the usable width) and
    // preserves explicit "\n" paragraph breaks as separate lines — both via
    // the library's own static font metrics, no randomness/layout surprises.
    const paragraphs = block.text.split("\n");
    for (let i = 0; i < paragraphs.length; i++) {
      const wrapped: string[] = paragraphs[i].length === 0 ? [""] : doc.splitTextToSize(paragraphs[i], USABLE_WIDTH);
      for (const line of wrapped) placed.push({ text: line, fontSize, bold, gapAfter: LAYOUT.lineHeight });
    }
    placed[placed.length - 1].gapAfter = block.kind === "body" ? LAYOUT.paragraphGap : LAYOUT.sectionGap;
  }
  return placed;
}

export async function renderExportPdf(value: ExportRenderInput): Promise<ExportRenderResult<PdfRepresentation>> {
  if (jsPDF.version !== PINNED_JSPDF_VERSION) throw new ExportRendererError("EXPORT_RENDERER_UNAVAILABLE");
  const input = await parseAndAuthenticate(value, EP.pdfRenderer);
  const creationDate = pdfCreationDateUtc(input.generatedAt); // refuses out-of-range years before any document exists
  const fileId = await pdfFileId(input);

  const blocks = buildContentBlocks(input);
  // Validate EVERY string that will actually be emitted — static labels and
  // dynamic snapshot content alike — BEFORE any byte is produced. One failure
  // refuses the whole render; no partial emission.
  for (const block of blocks) if (!isRepresentableText(block.text)) throw new ExportRendererError("EXPORT_FORMAT_UNREPRESENTABLE");

  const doc = new jsPDF({ unit: LAYOUT.unit, format: LAYOUT.format, compress: false });
  doc.setProperties({ title: "Internal Estimate Summary" });
  doc.setCreationDate(creationDate);
  doc.setFileId(fileId);

  const placed = flattenToPlacedLines(doc, blocks);
  let y = LAYOUT.marginTop;
  for (const line of placed) {
    if (y > USABLE_BOTTOM) { doc.addPage(); y = LAYOUT.marginTop; }
    doc.setFont("helvetica", line.bold ? "bold" : "normal");
    doc.setFontSize(line.fontSize);
    doc.text(line.text, LAYOUT.marginLeft, y);
    y += line.gapAfter;
  }

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  assertWithinResponseLimit(bytes.length);
  const artifactHash = await sha256HexOfBytes(bytes as Uint8Array<ArrayBuffer>);
  const pageCount = doc.getNumberOfPages();
  const representation: PdfRepresentation = {
    format: "pdf", rendererVersion: EP.pdfRenderer, mimeType: "application/pdf", encoding: "base64",
    generatedAt: input.generatedAt, generatedBy: input.generatedBy,
    filename: buildExportFilename(input.snapshot.identity.estimateDraftId, input.exportId, "pdf"),
    artifactHash, byteLength: bytes.length,
    details: { layoutVersion: EP.pdfLayout, pageCount },
  };
  return { bytes, representation };
}
