/**
 * A1-EXPORT-DATA-CONTRACT.md §7 — pure renderers (JSON, printable) over an
 * approved snapshot. Single input: a typed/validated snapshot core plus
 * immutable metadata `{exportId,rendererVersion,generatedAt,generatedBy}`
 * and the caller-supplied `authority` reference. NEVER consults a live
 * catalog, draft/project/notes or current profile to complete text/price.
 * No persistence, no network, no Date.now/random/env — every value in the
 * output is either copied from the validated input or derived from it by
 * pure arithmetic. This module only PRODUCES representation bytes; it is
 * not an authorization to deliver them (A1-EXPORT-DATA-CONTRACT.md §0/§8).
 */
import { z } from "zod";
import {
  internalApprovalVersionPrimitives as p, internalApprovalSnapshotSchema,
  parseInternalApprovalData as parse,
  canonicalizeInternalApproval as canonicalizeApprovalJson, hashInternalApprovalContent,
  InternalApprovalError, type InternalApprovalSnapshot,
} from "./internal-estimate-approval-engine";
import { buildExportFilename, type ExportManifest } from "./internal-estimate-export-engine";
import { EXPORT_PROTOCOL as EP, EXPORT_RESPONSE_BYTE_LIMIT, type ExportIssueCode } from "./domain/taxonomy";

/** Typed failure specific to rendering — reuses the EXISTING closed ExportIssueCode
 * vocabulary (no taxonomy change) rather than inventing a parallel error enum. */
export class ExportRendererError extends Error {
  constructor(public readonly code: ExportIssueCode) {
    super(`${code}: A1 export renderer refused this input`);
    this.name = "ExportRendererError";
  }
}

// ── Input / output shape ────────────────────────────────────────────────────
const authorityInputSchema = z.object({ approvalId: p.uuid, snapshotId: p.uuid, contentHash: p.hash }).strict();
const renderInputSchema = z.object({
  snapshot: internalApprovalSnapshotSchema, authority: authorityInputSchema, exportId: p.uuid,
  rendererVersion: z.string().min(1), generatedAt: p.timestamp, generatedBy: p.uuid,
}).strict();
export interface ExportRenderInput {
  snapshot: unknown;
  authority: { approvalId: string; snapshotId: string; contentHash: string };
  exportId: string;
  rendererVersion: string;
  generatedAt: string;
  generatedBy: string;
}
type JsonRepresentation = Extract<NonNullable<ExportManifest["representation"]>, { format: "json" }>;
type PrintableRepresentation = Extract<NonNullable<ExportManifest["representation"]>, { format: "printable" }>;
export interface ExportRenderResult<R> { bytes: Uint8Array; representation: R }

/** Exported so the PDF renderer (second concrete consumer) can reuse the exact
 * same validation/hash gate instead of a parallel copy — same input shape,
 * same recusa order, same InternalApprovalError/ExportRendererError codes. */
export async function parseAndAuthenticate(value: ExportRenderInput, expectedRendererVersion: string) {
  // parse() (parseInternalApprovalData) already runs assertJson on the whole
  // wrapper before Zod — same rigor as every other core entry point, no
  // separate guard needed (the nested snapshot field gets it a second time via
  // its own jsonSchema() wrapper, which is harmless and already the accepted
  // pattern elsewhere in this codebase).
  const input = parse(renderInputSchema, value);
  if (input.rendererVersion !== expectedRendererVersion) throw new ExportRendererError("EXPORT_RENDERER_UNAVAILABLE");
  // Recompute the content hash of the VALIDATED snapshot (never the raw input) and
  // require equality with the reference the caller already committed to — §6/§7:
  // divergence refuses before any byte is produced, never a best-effort render.
  const recomputedHash = await hashInternalApprovalContent(input.snapshot);
  if (recomputedHash !== input.authority.contentHash) throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
  return input as { snapshot: InternalApprovalSnapshot; authority: typeof input.authority; exportId: string; rendererVersion: string; generatedAt: string; generatedBy: string };
}

// ── Bytes-only SHA-256, WebCrypto, no Node crypto, no fallback ─────────────
/** Exported — the PDF renderer needs this exact fail-closed bytes-only hash
 * both for its file ID material and its final artifactHash. */
export async function sha256HexOfBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") throw new InternalApprovalError("INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE");
  let digestBuffer: ArrayBuffer;
  try { digestBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes); }
  catch { throw new InternalApprovalError("INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE"); }
  const result = new Uint8Array(digestBuffer);
  if (result.length !== 32) throw new InternalApprovalError("INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE");
  return Array.from(result, byte => byte.toString(16).padStart(2, "0")).join("");
}
export function assertWithinResponseLimit(byteLength: number): void {
  if (byteLength > EXPORT_RESPONSE_BYTE_LIMIT) throw new ExportRendererError("EXPORT_PAYLOAD_TOO_LARGE");
}

// ── Money / decimal presentation helpers (pure, BigInt/string only) ───────
/** Minor (integer cents, optionally signed) → a dollar string via pure integer
 * arithmetic — never Number/parseFloat. Exported — identical rule for PDF. */
export function formatMinorAsUsd(minorStr: string): string {
  const negative = minorStr.startsWith("-");
  const digits = negative ? minorStr.slice(1) : minorStr;
  const padded = digits.padStart(3, "0");
  const whole = padded.slice(0, -2);
  const frac = padded.slice(-2);
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}
/** Decimal6-family values (quantity, unitCostSnapshot, unitPriceSnapshot) are already
 * canonical strings with trailing fractional zeros stripped — rendered as-is, never
 * re-padded/truncated to a fixed scale (the contract's explicit "não perdem casas"). */
export function formatDecimalAsIs(value: string): string { return value; }
/** Gross profit %, derived rationally from (price-cost)/price*100, rounded to ONE
 * decimal half-away-from-zero ONLY here at presentation — never earlier, never via
 * Number/float. A zero or unknown denominator is a textual indication, never an
 * invented 0% or an actual division by zero. */
export function formatGrossProfitPercent(priceMinor: string | null, costMinor: string | null): string {
  if (priceMinor === null || costMinor === null) return "—";
  const price = BigInt(priceMinor);
  if (price === 0n) return "—";
  const cost = BigInt(costMinor);
  const scaledNumerator = (price - cost) * 1000n; // percent * 10, exact
  const negative = scaledNumerator < 0n;
  const absNumerator = negative ? -scaledNumerator : scaledNumerator;
  const absDenominator = price < 0n ? -price : price;
  const quotientTenths = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const roundedTenths = 2n * remainder >= absDenominator ? quotientTenths + 1n : quotientTenths;
  const whole = roundedTenths / 10n;
  const tenth = roundedTenths % 10n;
  return `${negative ? "-" : ""}${whole}.${tenth}%`;
}

// ── HTML escaping (printable only) ─────────────────────────────────────────
/** Text-node context: neutralizes `&`,`<`,`>` — also closes off any attempt at a
 * closing tag sequence (`</...>` requires an unescaped `<`, already covered). */
export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Attribute-value context: text-escaping plus quote characters, so the value can
 * never terminate a `"..."`/`'...'` attribute early. Not used by the current
 * template (no dynamic attribute values exist in it), kept and tested as a
 * dedicated primitive per the contract's explicit text/attribute distinction. */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** Preserves literal newlines as TEXT (never a `<br>` tag) — the container applies
 * `white-space:pre-wrap` so the browser renders them as line breaks without any
 * HTML structure being derived from user content ("nunca HTML"). */
function escapedMultilineText(value: string): string { return escapeHtmlText(value); }

function identityOrUnknown(value: string | null, label: string): string {
  return value === null ? `<span class="unknown">${escapeHtmlText(label)} unknown</span>` : escapeHtmlText(value);
}
/** Same unknown-indication rule as identityOrUnknown, for a nullable Decimal6-family
 * value rendered as-is (never reformatted) when present. */
function decimalOrUnknown(value: string | null, label: string): string {
  return value === null ? `<span class="unknown">${escapeHtmlText(label)} unknown</span>` : formatDecimalAsIs(value);
}

// ── JSON renderer ────────────────────────────────────────────────────────────
export async function renderExportJson(value: ExportRenderInput): Promise<ExportRenderResult<JsonRepresentation>> {
  const input = await parseAndAuthenticate(value, EP.jsonRenderer);
  const document = {
    version: EP.document,
    authority: { approvalId: input.authority.approvalId, snapshotId: input.authority.snapshotId, contentHash: input.authority.contentHash },
    exportMetadata: { exportId: input.exportId, rendererVersion: input.rendererVersion, generatedAt: input.generatedAt, generatedBy: input.generatedBy },
    snapshot: input.snapshot,
  };
  // §7: UTF-8, no BOM, no trailing newline, canonical key order, arrays in their
  // original order — canonicalizeApprovalJson already guarantees exactly this
  // (sorted object keys, untouched array order, standard JSON.stringify for
  // scalars); reused by import+alias per the accepted decision, not re-derived.
  const canonicalText = canonicalizeApprovalJson(document);
  const bytes = new TextEncoder().encode(canonicalText);
  assertWithinResponseLimit(bytes.length);
  const artifactHash = await sha256HexOfBytes(bytes);
  const representation: JsonRepresentation = {
    format: "json", rendererVersion: EP.jsonRenderer, mimeType: "application/json", encoding: "utf8",
    generatedAt: input.generatedAt, generatedBy: input.generatedBy,
    filename: buildExportFilename(input.snapshot.identity.estimateDraftId, input.exportId, "json"),
    artifactHash, byteLength: bytes.length,
    details: { documentVersion: EP.document, serialization: EP.jsonSerialization },
  };
  return { bytes, representation };
}

// ── Printable (HTML) renderer ───────────────────────────────────────────────
function renderLineRow(line: InternalApprovalSnapshot["lines"][number]): string {
  const unit = identityOrUnknown(line.unit, "Unit");
  const taxable = line.taxable === null ? `<span class="unknown">Taxable unknown</span>` : (line.taxable ? "Yes" : "No");
  const costCode = identityOrUnknown(line.costCode, "Cost code");
  const unitCost = line.unitCostSnapshot === null ? "—" : formatDecimalAsIs(line.unitCostSnapshot);
  const unitPrice = line.unitPriceSnapshot === null ? "—" : formatDecimalAsIs(line.unitPriceSnapshot);
  const classification = line.csvClassification === null
    ? `<span class="unknown">No CSV classification reviewed</span>`
    : `${escapeHtmlText(line.csvClassification.costType)} / ${escapeHtmlText(line.csvClassification.normalizedUnit)}`;
  return `<tr>
<td>${escapeHtmlText(line.lineKey)}</td>
<td>${escapeHtmlText(line.costGroupName)}</td>
<td>${escapeHtmlText(line.costItemName)}</td>
<td class="notes">${line.description === null ? "" : escapedMultilineText(line.description)}</td>
<td>${formatDecimalAsIs(line.quantity)}</td>
<td>${unit}</td>
<td>${unitCost}</td>
<td>${unitPrice}</td>
<td>${formatMinorAsUsd(line.lineTotalCostMinor)}</td>
<td>${formatMinorAsUsd(line.lineTotalPriceMinor)}</td>
<td>${taxable}</td>
<td>${costCode}</td>
<td>${classification}</td>
</tr>`;
}
function renderAssemblyRow(selection: InternalApprovalSnapshot["assemblySelections"][number]): string {
  const unitCost = selection.unitCost === null ? "—" : formatDecimalAsIs(selection.unitCost);
  const unitPrice = selection.unitPrice === null ? "—" : formatDecimalAsIs(selection.unitPrice);
  const extCost = selection.extendedCostMinor === null ? "—" : formatMinorAsUsd(selection.extendedCostMinor);
  const extPrice = selection.extendedPriceMinor === null ? "—" : formatMinorAsUsd(selection.extendedPriceMinor);
  const gp = formatGrossProfitPercent(selection.extendedPriceMinor, selection.extendedCostMinor);
  return `<tr>
<td>${escapeHtmlText(selection.selectionKey)}</td>
<td>${escapeHtmlText(selection.assemblyName)}</td>
<td>${identityOrUnknown(selection.assemblyCode, "Code")}</td>
<td>${identityOrUnknown(selection.category, "Category")}</td>
<td>${formatDecimalAsIs(selection.quantity)}</td>
<td>${unitCost}</td>
<td>${unitPrice}</td>
<td>${extCost}</td>
<td>${extPrice}</td>
<td>${gp}</td>
</tr>`;
}
const PRINTABLE_STYLE = `body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:2rem}table{border-collapse:collapse;width:100%;margin-bottom:1.5rem}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;font-size:0.85rem}th{background:#f0f0f0}.notes{white-space:pre-wrap}.unknown{color:#888;font-style:italic}.meta{color:#555;font-size:0.8rem}.total-row td{font-weight:bold}`;

export async function renderExportPrintable(value: ExportRenderInput): Promise<ExportRenderResult<PrintableRepresentation>> {
  const input = await parseAndAuthenticate(value, EP.printableRenderer);
  const s = input.snapshot;
  const f = s.financials;
  const pricing = s.commercialContext.pricingContext;
  const policy = s.commercialContext.policyContext;
  const gpOverall = formatGrossProfitPercent(f.finalPriceMinor, f.estimatedCostMinor);
  const notesHtml = s.presentation.reviewedNotes === null ? `<span class="unknown">No reviewed notes</span>` : `<div class="notes">${escapedMultilineText(s.presentation.reviewedNotes)}</div>`;
  const bundleNameHtml = s.presentation.bundleName === null ? `<span class="unknown">No bundle name</span>` : escapeHtmlText(s.presentation.bundleName);
  const lineRows = s.lines.map(renderLineRow).join("\n");
  const assemblyRows = s.assemblySelections.length === 0
    ? `<tr><td colspan="10" class="unknown">No assembly selections recorded</td></tr>`
    : s.assemblySelections.map(renderAssemblyRow).join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Internal Estimate Summary</title>
<style>${PRINTABLE_STYLE}</style>
</head>
<body>
<h1>Internal Estimate Summary</h1>
<p class="meta">Export ${escapeHtmlText(input.exportId)} &middot; renderer ${escapeHtmlText(input.rendererVersion)} &middot; generated ${escapeHtmlText(input.generatedAt)} by ${escapeHtmlText(input.generatedBy)}</p>
<h2>Revision</h2>
<table>
<tr><th>Tenant</th><td>${escapeHtmlText(s.identity.tenantId)}</td><th>Project</th><td>${escapeHtmlText(s.identity.projectId)}</td></tr>
<tr><th>Client</th><td>${escapeHtmlText(s.identity.clientId)}</td><th>Draft</th><td>${escapeHtmlText(s.identity.estimateDraftId)} v${s.identity.draftVersion}</td></tr>
<tr><th>Source</th><td>${escapeHtmlText(s.origin.source)}</td><th>Source created</th><td>${escapeHtmlText(s.origin.sourceCreatedAt)}</td></tr>
<tr><th>Bundle name</th><td colspan="3">${bundleNameHtml}</td></tr>
<tr><th>Approval</th><td>${escapeHtmlText(input.authority.approvalId)}</td><th>Snapshot</th><td>${escapeHtmlText(input.authority.snapshotId)}</td></tr>
<tr><th>Content hash</th><td colspan="3">${escapeHtmlText(input.authority.contentHash)}</td></tr>
</table>
<h2>Calculation context (captured when priced)</h2>
<table>
<tr><th>Pricing channel</th><td>${identityOrUnknown(pricing.pricingChannel, "Pricing channel")}</td><th>Finish level</th><td>${identityOrUnknown(pricing.finishLevel, "Finish level")}</td></tr>
<tr><th>Region</th><td>${identityOrUnknown(pricing.region, "Region")}</td><th>Zone</th><td>${identityOrUnknown(pricing.zone, "Zone")}</td></tr>
<tr><th>Trade</th><td>${identityOrUnknown(pricing.trade, "Trade")}</td><th>Coastal modifier</th><td>${decimalOrUnknown(pricing.coastalModifier, "Coastal modifier")}</td></tr>
<tr><th>Stored commercial channel</th><td>${identityOrUnknown(pricing.storedCommercialChannel, "Stored commercial channel")}</td><th>Stored geo risk class</th><td>${identityOrUnknown(pricing.storedGeoRiskClass, "Stored geo risk class")}</td></tr>
<tr><th>Stored risk basis</th><td>${escapeHtmlText(pricing.storedRiskBasis)}</td><th>Pricing schema version</th><td>${identityOrUnknown(s.origin.pricingSchemaVersion, "Pricing schema version")}</td></tr>
</table>
<h2>Review context (verified internally at review time)</h2>
<table>
<tr><th>Commercial channel</th><td>${escapeHtmlText(policy.commercialChannel)}</td><th>Channel basis</th><td>${escapeHtmlText(policy.channelBasis)}</td></tr>
<tr><th>Channel raw value</th><td>${escapeHtmlText(policy.channelRawValue)}</td><th>Geo risk class</th><td>${escapeHtmlText(policy.geoRiskClass)}</td></tr>
<tr><th>Risk basis</th><td>${escapeHtmlText(policy.riskBasis)}</td><th>Zone</th><td>${escapeHtmlText(policy.projectGeo.zone)}</td></tr>
<tr><th>Zone provenance</th><td>${escapeHtmlText(policy.projectGeo.geocodeSource)}</td><th>Zone resolved at</th><td>${escapeHtmlText(policy.projectGeo.geocodedAt)}</td></tr>
<tr><th>Geocode confidence</th><td>${escapeHtmlText(policy.projectGeo.geocodeConfidence)}</td><th>Coastal exposure</th><td>${escapeHtmlText(policy.projectGeo.coastalExposureLevel)}</td></tr>
<tr><th>Risk resolution basis</th><td>${escapeHtmlText(policy.projectGeo.riskResolutionBasis)}</td><th>Policy version</th><td>${policy.version}</td></tr>
<tr><th>Evaluator version</th><td>${policy.evaluatorVersion}</td><th>Effective floor %</th><td>${escapeHtmlText(policy.floors.effectiveFloorPct)}</td></tr>
<tr><th>Floor kind</th><td colspan="3">${escapeHtmlText(policy.floors.floorKind)}</td></tr>
</table>
<h2>Reviewed notes</h2>
${notesHtml}
<h2>Totals</h2>
<table>
<tr><th>Subtotal (price)</th><td>${formatMinorAsUsd(f.subtotalPriceMinor)}</td></tr>
<tr><th>Discount applied</th><td>${f.discountApplied ? "Yes" : "No"}</td></tr>
<tr><th>Discount amount</th><td>${formatMinorAsUsd(f.discountMinor)}</td></tr>
<tr><th>Final price</th><td>${formatMinorAsUsd(f.finalPriceMinor)}</td></tr>
<tr><th>Estimated cost</th><td>${formatMinorAsUsd(f.estimatedCostMinor)}</td></tr>
<tr class="total-row"><th>Gross profit %</th><td>${gpOverall}</td></tr>
</table>
<h2>Lines (frozen in snapshot; origin: calculated)</h2>
<table>
<tr><th>Line</th><th>Cost group</th><th>Cost item</th><th>Description</th><th>Qty</th><th>Unit</th><th>Unit cost</th><th>Unit price</th><th>Line cost</th><th>Line price</th><th>Taxable</th><th>Cost code</th><th>CSV classification</th></tr>
${lineRows}
</table>
<h2>Assembly selections (as calculated, not re-summed into totals)</h2>
<table>
<tr><th>Selection</th><th>Assembly</th><th>Code</th><th>Category</th><th>Qty</th><th>Unit cost</th><th>Unit price</th><th>Ext. cost</th><th>Ext. price</th><th>GP %</th></tr>
${assemblyRows}
</table>
<p class="meta">This document is an internal rendering of approved snapshot evidence. It does not itself constitute issuance, acceptance, signature or receipt of any export.</p>
</body>
</html>`;
  const bytes = new TextEncoder().encode(html);
  assertWithinResponseLimit(bytes.length);
  const artifactHash = await sha256HexOfBytes(bytes);
  const representation: PrintableRepresentation = {
    format: "printable", rendererVersion: EP.printableRenderer, mimeType: "text/html", encoding: "utf8",
    generatedAt: input.generatedAt, generatedBy: input.generatedBy,
    filename: buildExportFilename(input.snapshot.identity.estimateDraftId, input.exportId, "printable"),
    artifactHash, byteLength: bytes.length,
    details: { templateVersion: EP.printableTemplate, escaping: EP.printableEscaping, sandbox: EP.printableSandbox },
  };
  return { bytes, representation };
}
