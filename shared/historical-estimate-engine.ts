import { z } from "zod";
import { HISTORICAL_ESTIMATE_SOURCE, HISTORICAL_SOURCE_KINDS, HISTORICAL_RECONCILIATION_STATES, HISTORICAL_FINDING_CODES, HISTORICAL_FINDING_FIELDS } from "./domain/taxonomy";
import { normalizeHistoricalSourceKind } from "./domain/normalization";
import type { HistoricalErrorCode, HistoricalFindingCode, HistoricalReconciliationState, HistoricalSourceKind } from "./domain/taxonomy";

export class HistoricalEstimateError extends Error {
  constructor(public readonly code: HistoricalErrorCode, message: string, public readonly field?: string) {
    super(`${code}: ${message}`); this.name = "HistoricalEstimateError";
  }
}
export interface RawHistoricalTotals {
  version: "historical-raw-totals-v1";
  subtotal: string | null; discount: string | null; tax: string | null; total: string | null; estimatedCost: string | null;
}
export interface RawHistoricalLineValues {
  version: "historical-raw-line-v1";
  quantity: string | null; unitPrice: string | null; unitEstimatedCost: string | null;
  linePrice: string | null; lineEstimatedCost: string | null; taxable: string | null; externalCode: string | null;
}
export interface RawHistoricalSelectedTotals {
  version: "historical-raw-selected-v1"; total: string | null; estimatedCost: string | null;
}
export interface HistoricalSourceLineInput {
  sourceLineKey: string; ordinal: number; description: string | null; quantity: string | null;
  unit: string | null; unitPrice: string | null; unitEstimatedCost: string | null;
  linePrice: string | null; lineEstimatedCost: string | null;
  externalCodeSystem: string | null; externalCode: string | null; taxable: boolean | null;
  rawValues: RawHistoricalLineValues;
}
export interface HistoricalSourceInput {
  requestId: string; projectId: string; clientId: string; sourceKind: HistoricalSourceKind;
  sourceLabel: string; currencyCode: "USD" | null; sourceFileId: string | null;
  declaredSubtotal: string | null; declaredDiscount: string | null; declaredTax: string | null;
  declaredTotal: string | null; declaredEstimatedCost: string | null;
  commercialTermsText: string | null; rawTotals: RawHistoricalTotals; lines: HistoricalSourceLineInput[];
}
export interface NormalizedHistoricalSourceLine extends Omit<HistoricalSourceLineInput, "linePrice" | "lineEstimatedCost"> {
  linePriceMinor: string | null; lineEstimatedCostMinor: string | null; canonicalContent: string;
}
export interface NormalizedHistoricalSource extends Omit<HistoricalSourceInput, "lines" | "declaredSubtotal" | "declaredDiscount" | "declaredTax" | "declaredTotal" | "declaredEstimatedCost"> {
  lines: NormalizedHistoricalSourceLine[]; declaredSubtotalMinor: string | null; declaredDiscountMinor: string | null;
  declaredTaxMinor: string | null; declaredTotalMinor: string | null; declaredEstimatedCostMinor: string | null;
  expectedLineCount: number; contractVersion: "historical-source-v1"; canonicalContent: string; canonicalRequest: string;
}
export interface HistoricalSourceSnapshot {
  id: string; projectId: string; clientId: string; currencyCode: "USD" | null; contentHash: string;
  lines: (NormalizedHistoricalSourceLine & { id: string; lineHash: string })[];
}
export interface HistoricalSelectionInput {
  requestId: string; source: HistoricalSourceSnapshot; projectId: string; clientId: string;
  selectedLineIds: string[]; declaredSelectedTotal: string | null; declaredSelectedEstimatedCost: string | null;
  rawSelectedTotals: RawHistoricalSelectedTotals; reportedApprovalAt: string | null; reportedApprovalNote: string | null;
  priorImportId: string | null; expectedRevision: number | null;
}
export interface HistoricalFinding {
  code: HistoricalFindingCode; field: "currency" | "price" | "cost";
  sourceLineKey?: string; expectedMinor?: string; actualMinor?: string;
}
export interface HistoricalReconciliation {
  version: "historical-reconciliation-v1"; state: HistoricalReconciliationState;
  sumPriceMinor: string | null; sumCostMinor: string | null; findings: HistoricalFinding[];
}
export interface BuiltHistoricalSelection extends Omit<HistoricalSelectionInput, "source" | "selectedLineIds" | "declaredSelectedTotal" | "declaredSelectedEstimatedCost"> {
  sourceId: string; currencyCode: "USD" | null; selectedLines: HistoricalSourceSnapshot["lines"];
  declaredSelectedTotalMinor: string | null; declaredSelectedEstimatedCostMinor: string | null;
  expectedLineCount: number; revision: number; contractVersion: "historical-selection-v1";
  reconciliation: HistoricalReconciliation; canonicalContent: string; canonicalRequest: string;
}
export interface HistoricalDraftProjection {
  source: "historical_import"; status: "draft"; projectId: string; clientId: string; version: number;
  finalTotalPrice: string | null; subtotalCost: string | null; subtotalPrice: null;
  discountAmount: null; discountApplied: null; lineItems: null; grossProfit: null; grossProfitPct: null;
  approvedBy: null; approvedAt: null; lockedAt: null; profitShieldEvaluation: null;
  profitShieldPassed: null; pricingSnapshot: null;
}

const MAX_MINOR = 10n ** 20n - 1n;
const idSchema = z.string().uuid().transform(value => value.toLowerCase());
const rawText = z.string().max(256).nullable();
const decimalText = z.string().max(64).nullable();
export const rawTotalsSchema = z.object({ version: z.literal("historical-raw-totals-v1"), subtotal: rawText, discount: rawText, tax: rawText, total: rawText, estimatedCost: rawText }).strict();
export const rawLineSchema = z.object({ version: z.literal("historical-raw-line-v1"), quantity: rawText, unitPrice: rawText, unitEstimatedCost: rawText, linePrice: rawText, lineEstimatedCost: rawText, taxable: rawText, externalCode: rawText }).strict();
export const rawSelectedSchema = z.object({ version: z.literal("historical-raw-selected-v1"), total: rawText, estimatedCost: rawText }).strict();
const minorText = z.string().regex(/^(0|[1-9]\d{0,19})$/);
export const historicalReconciliationSchema = z.object({
  version: z.literal("historical-reconciliation-v1"), state: z.enum(HISTORICAL_RECONCILIATION_STATES),
  sumPriceMinor: minorText.nullable(), sumCostMinor: minorText.nullable(),
  findings: z.array(z.object({
    code: z.enum(HISTORICAL_FINDING_CODES), field: z.enum(HISTORICAL_FINDING_FIELDS),
    sourceLineKey: z.string().min(1).max(128).optional(),
    // The exact quantity×rate comparison can exceed stored money's twenty digits.
    expectedMinor: z.string().regex(/^(0|[1-9]\d{0,29})$/).optional(), actualMinor: minorText.optional(),
  }).strict()).max(4002),
}).strict();
const lineInputSchema = z.object({
  sourceLineKey: z.string().min(1).max(128), ordinal: z.number().int().min(0).max(2147483647),
  description: z.string().max(5000).nullable(), quantity: decimalText, unit: z.string().max(128).nullable(),
  unitPrice: decimalText, unitEstimatedCost: decimalText, linePrice: decimalText, lineEstimatedCost: decimalText,
  externalCodeSystem: z.string().max(128).nullable(), externalCode: z.string().max(128).nullable(),
  taxable: z.boolean().nullable(), rawValues: rawLineSchema,
}).strict();
const sourceInputSchema = z.object({
  requestId: idSchema, projectId: idSchema, clientId: idSchema,
  sourceKind: z.preprocess(value => typeof value === "string" ? normalizeHistoricalSourceKind(value) : value, z.enum(HISTORICAL_SOURCE_KINDS)),
  sourceLabel: z.string().min(1).max(255), currencyCode: z.literal("USD").nullable(), sourceFileId: idSchema.nullable(),
  declaredSubtotal: decimalText, declaredDiscount: decimalText, declaredTax: decimalText, declaredTotal: decimalText,
  declaredEstimatedCost: decimalText, commercialTermsText: z.string().max(5000).nullable(),
  rawTotals: rawTotalsSchema, lines: z.array(lineInputSchema).min(1).max(1000),
}).strict();
function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "Input does not satisfy the historical capture contract", result.error.issues[0]?.path.join("."));
  return result.data;
}
function invalidDecimal(field?: string): never {
  throw new HistoricalEstimateError("HISTORICAL_INVALID_DECIMAL", "A nonnegative decimal string within the supported precision is required", field);
}

/** Exact parsing, never a financial rounding operation. Original text is retained separately. */
export function parseHistoricalDecimal(value: string, options: { maxScale?: number; maxIntegerDigits?: number; field?: string } = {}): { normalized: string; unscaled: bigint; scale: number } {
  const { maxScale = 6, maxIntegerDigits = 14, field } = options;
  if (!Number.isInteger(maxScale) || maxScale < 0 || maxScale > 6 || !Number.isInteger(maxIntegerDigits) || maxIntegerDigits < 1 || maxIntegerDigits > 20) invalidDecimal(field);
  if (typeof value !== "string" || value.length > 64 || !/^\d+(?:\.\d+)?$/.test(value)) invalidDecimal(field);
  const [rawWhole, rawFraction = ""] = value.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  if (whole.length > maxIntegerDigits || rawFraction.length > maxScale) invalidDecimal(field);
  const fraction = rawFraction.replace(/0+$/, "");
  return { normalized: whole + (fraction ? `.${fraction}` : ""), unscaled: BigInt(whole + fraction), scale: fraction.length };
}
export function decimalToMinorUnits(value: string, field?: string): string {
  const parsed = parseHistoricalDecimal(value, { maxScale: 2, maxIntegerDigits: 18, field });
  return (parsed.unscaled * 10n ** BigInt(2 - parsed.scale)).toString();
}

/** JSON canonicalization version one: plain objects only, key order sorted, arrays ordered. */
export function canonicalHistoricalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 32) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "Canonical content is too deeply nested");
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isSafeInteger(item)) return JSON.stringify(item);
    if (typeof item !== "object" || item === null || ancestors.has(item)) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "Canonical content contains an unsupported value");
    ancestors.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "Sparse or annotated arrays are not canonical content");
      result = `[${item.map(entry => encode(entry, depth + 1)).join(",")}]`;
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "Only plain canonical objects are supported");
      result = `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value, 0);
}
function optionalDecimal(value: string | null, field: string): string | null {
  return value === null ? null : parseHistoricalDecimal(value, { field }).normalized;
}
function optionalMoney(value: string | null, currency: "USD" | null, field: string): string | null {
  if (value === null) return null;
  // Validate a supplied normalized decimal lexically even when currency is unknown.
  // Only USD enables conversion to minor units; human formatting belongs in raw values.
  parseHistoricalDecimal(value, { maxScale: 2, maxIntegerDigits: 18, field });
  return currency === "USD" ? decimalToMinorUnits(value, field) : null;
}
function optionalRate(value: string | null, currency: "USD" | null, field: string): string | null {
  const parsed = optionalDecimal(value, field);
  return currency === "USD" ? parsed : null;
}
function uniqueValues(values: (number | string)[], code: HistoricalErrorCode = "HISTORICAL_INVALID_INPUT"): void {
  if (new Set(values).size !== values.length) throw new HistoricalEstimateError(code, "Duplicate identities or positions are not allowed");
}

export function normalizeHistoricalSource(input: HistoricalSourceInput): NormalizedHistoricalSource {
  const data = validated(sourceInputSchema, input);
  if (data.sourceKind === "file_extract" && !data.sourceFileId) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "A structured extraction requires its source file reference", "sourceFileId");
  uniqueValues(data.lines.map(line => line.sourceLineKey)); uniqueValues(data.lines.map(line => line.ordinal));
  const lines = [...data.lines].sort((a, b) => a.ordinal - b.ordinal).map(line => {
    const { linePrice, lineEstimatedCost, ...unchanged } = line;
    const normalized = {
      ...unchanged, quantity: optionalDecimal(line.quantity, "quantity"),
      unitPrice: optionalRate(line.unitPrice, data.currencyCode, "unitPrice"),
      unitEstimatedCost: optionalRate(line.unitEstimatedCost, data.currencyCode, "unitEstimatedCost"),
      linePriceMinor: optionalMoney(linePrice, data.currencyCode, "linePrice"),
      lineEstimatedCostMinor: optionalMoney(lineEstimatedCost, data.currencyCode, "lineEstimatedCost"),
    };
    return { ...normalized, canonicalContent: canonicalHistoricalJson({ contractVersion: "historical-source-line-v1", ...normalized }) };
  });
  const { requestId, lines: _lines, declaredSubtotal, declaredDiscount, declaredTax, declaredTotal, declaredEstimatedCost, ...unchanged } = data;
  const content = {
    ...unchanged, contractVersion: "historical-source-v1" as const, expectedLineCount: lines.length,
    declaredSubtotalMinor: optionalMoney(declaredSubtotal, data.currencyCode, "declaredSubtotal"),
    declaredDiscountMinor: optionalMoney(declaredDiscount, data.currencyCode, "declaredDiscount"),
    declaredTaxMinor: optionalMoney(declaredTax, data.currencyCode, "declaredTax"),
    declaredTotalMinor: optionalMoney(declaredTotal, data.currencyCode, "declaredTotal"),
    declaredEstimatedCostMinor: optionalMoney(declaredEstimatedCost, data.currencyCode, "declaredEstimatedCost"),
    lines: lines.map(({ canonicalContent: _canonicalContent, ...line }) => line),
  };
  return { ...content, requestId, lines, canonicalContent: canonicalHistoricalJson(content),
    canonicalRequest: canonicalHistoricalJson({ operation: "historicalEstimate.recordSource", contractVersion: "historical-request-v1", submitted: data }) };
}

function minor(value: string | null, field: string): bigint | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value)) invalidDecimal(field);
  return BigInt(value);
}
function addMinor(total: bigint, value: bigint, field: string): bigint {
  const sum = total + value;
  if (sum > MAX_MINOR) invalidDecimal(field);
  return sum;
}
export function reconcileHistoricalSelection(input: { currencyCode: "USD" | null; lines: NormalizedHistoricalSourceLine[]; declaredSelectedTotalMinor: string | null; declaredSelectedEstimatedCostMinor: string | null }): HistoricalReconciliation {
  if (input.currencyCode !== null && input.currencyCode !== "USD") throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "Currency is unsupported");
  if (input.lines.length < 1 || input.lines.length > 1000) throw new HistoricalEstimateError("HISTORICAL_INVALID_SELECTION", "Select between one and one thousand whole lines");
  if (input.currencyCode === null) return { version: "historical-reconciliation-v1", state: "unresolved", sumPriceMinor: null, sumCostMinor: null, findings: [{ code: "unknown_currency", field: "currency" }] };
  const findings: HistoricalFinding[] = [];
  let mismatch = false, unresolved = false;
  const sums: Record<"price" | "cost", string | null> = { price: null, cost: null };
  for (const field of ["price", "cost"] as const) {
    let sum = 0n, complete = true;
    for (const line of input.lines) {
      const lineMinor = minor(field === "price" ? line.linePriceMinor : line.lineEstimatedCostMinor, field);
      if (lineMinor === null) { complete = false; unresolved = true; findings.push({ code: field === "price" ? "missing_line_price" : "missing_line_cost", field, sourceLineKey: line.sourceLineKey }); }
      else sum = addMinor(sum, lineMinor, field);
      const quantity = line.quantity === null ? null : parseHistoricalDecimal(line.quantity, { field: "quantity" });
      const rateValue = field === "price" ? line.unitPrice : line.unitEstimatedCost;
      const rate = rateValue === null ? null : parseHistoricalDecimal(rateValue, { field });
      if (!quantity || !rate) { unresolved = true; findings.push({ code: "incomplete_extension", field, sourceLineKey: line.sourceLineKey }); continue; }
      const numerator = quantity.unscaled * rate.unscaled * 100n;
      const denominator = 10n ** BigInt(quantity.scale + rate.scale);
      if (numerator % denominator !== 0n) { unresolved = true; findings.push({ code: "fractional_minor_extension", field, sourceLineKey: line.sourceLineKey }); }
      else if (lineMinor !== null && numerator / denominator !== lineMinor) {
        mismatch = true;
        findings.push({ code: field === "price" ? "price_extension_mismatch" : "cost_extension_mismatch", field, sourceLineKey: line.sourceLineKey, expectedMinor: (numerator / denominator).toString(), actualMinor: lineMinor.toString() });
      }
    }
    sums[field] = complete ? sum.toString() : null;
    const declared = minor(field === "price" ? input.declaredSelectedTotalMinor : input.declaredSelectedEstimatedCostMinor, field);
    if (declared === null) { unresolved = true; findings.push({ code: field === "price" ? "missing_declared_total" : "missing_declared_cost", field }); }
    else if (complete && declared !== sum) { mismatch = true; findings.push({ code: field === "price" ? "price_total_mismatch" : "cost_total_mismatch", field, expectedMinor: sum.toString(), actualMinor: declared.toString() }); }
  }
  return { version: "historical-reconciliation-v1", state: mismatch ? "mismatch" : unresolved ? "unresolved" : "matched", sumPriceMinor: sums.price, sumCostMinor: sums.cost, findings };
}

function reportedTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "A valid ISO8601 reported date is required", "reportedApprovalAt");
  const [, ys, ms, ds, hs, mins, secs] = match;
  const year = Number(ys), month = Number(ms), day = Number(ds);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const date = new Date(value);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(hs) > 23 || Number(mins) > 59 || Number(secs) > 59 || !Number.isFinite(date.getTime())) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "A valid ISO8601 reported date is required", "reportedApprovalAt");
  return date.toISOString();
}
const selectionInputSchema = z.object({
  requestId: idSchema, projectId: idSchema, clientId: idSchema,
  selectedLineIds: z.array(idSchema).min(1).max(1000), declaredSelectedTotal: decimalText, declaredSelectedEstimatedCost: decimalText,
  rawSelectedTotals: rawSelectedSchema, reportedApprovalAt: z.string().max(40).nullable(), reportedApprovalNote: z.string().max(5000).nullable(),
  priorImportId: idSchema.nullable(), expectedRevision: z.number().int().min(1).max(2147483646).nullable(),
}).strict();
export function buildHistoricalSelection(input: HistoricalSelectionInput): BuiltHistoricalSelection {
  const { source, ...submitted } = input;
  const data = validated(selectionInputSchema, submitted);
  const sourceId = validated(idSchema, source.id);
  if (validated(idSchema, source.projectId) !== data.projectId || validated(idSchema, source.clientId) !== data.clientId) throw new HistoricalEstimateError("HISTORICAL_IDENTITY_MISMATCH", "Source and selection identities must match");
  if (source.currencyCode !== "USD" && source.currencyCode !== null) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "Currency is unsupported");
  if (!/^[0-9a-f]{64}$/.test(source.contentHash)) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "A persisted source content hash is required");
  if (source.lines.length < 1 || source.lines.length > 1000) throw new HistoricalEstimateError("HISTORICAL_INVALID_SELECTION", "The source line set is invalid");
  uniqueValues(data.selectedLineIds, "HISTORICAL_INVALID_SELECTION");
  const sourceLines = source.lines.map(line => ({ ...line, id: validated(idSchema, line.id) }));
  uniqueValues(sourceLines.map(line => line.id), "HISTORICAL_INVALID_SELECTION");
  if ((data.priorImportId === null) !== (data.expectedRevision === null)) throw new HistoricalEstimateError("HISTORICAL_REVISION_CONFLICT", "A predecessor and expected revision must be supplied together");
  const lineMap = new Map(sourceLines.map(line => [line.id, line]));
  const selectedLines = data.selectedLineIds.map(id => {
    const line = lineMap.get(id);
    if (!line) throw new HistoricalEstimateError("HISTORICAL_INVALID_SELECTION", "Every selected line must belong to the specified source");
    if (!/^[0-9a-f]{64}$/.test(line.lineHash)) throw new HistoricalEstimateError("HISTORICAL_INVALID_INPUT", "A persisted line hash is required");
    const copied = { ...line, rawValues: validated(rawLineSchema, line.rawValues) };
    if (source.currencyCode === null) return { ...copied, unitPrice: null, unitEstimatedCost: null, linePriceMinor: null, lineEstimatedCostMinor: null };
    return copied;
  });
  const declaredSelectedTotalMinor = optionalMoney(data.declaredSelectedTotal, source.currencyCode, "declaredSelectedTotal");
  const declaredSelectedEstimatedCostMinor = optionalMoney(data.declaredSelectedEstimatedCost, source.currencyCode, "declaredSelectedEstimatedCost");
  const reconciliation = reconcileHistoricalSelection({ currencyCode: source.currencyCode, lines: selectedLines, declaredSelectedTotalMinor, declaredSelectedEstimatedCostMinor });
  const revision = (data.expectedRevision ?? 0) + 1;
  const reportedApprovalAt = reportedTimestamp(data.reportedApprovalAt);
  const content = {
    contractVersion: "historical-selection-v1" as const, sourceId, sourceContentHash: source.contentHash,
    projectId: data.projectId, clientId: data.clientId, currencyCode: source.currencyCode,
    selectedLines: selectedLines.map((line, position) => ({ sourceLineId: line.id, lineHash: line.lineHash, position })),
    declaredSelectedTotalMinor, declaredSelectedEstimatedCostMinor, rawSelectedTotals: data.rawSelectedTotals,
    reportedApprovalAt, reportedApprovalNote: data.reportedApprovalNote,
  };
  return {
    requestId: data.requestId, projectId: data.projectId, clientId: data.clientId, sourceId, currencyCode: source.currencyCode,
    selectedLines, expectedLineCount: selectedLines.length, revision, priorImportId: data.priorImportId, expectedRevision: data.expectedRevision,
    contractVersion: "historical-selection-v1", declaredSelectedTotalMinor, declaredSelectedEstimatedCostMinor,
    rawSelectedTotals: data.rawSelectedTotals, reportedApprovalAt, reportedApprovalNote: data.reportedApprovalNote,
    reconciliation, canonicalContent: canonicalHistoricalJson(content),
    canonicalRequest: canonicalHistoricalJson({ operation: "estimate.importHistorical", contractVersion: "historical-request-v1", sourceId, sourceContentHash: source.contentHash, submitted: data }),
  };
}
function dollars(value: string | null): string | null {
  const cents = minor(value, "projection");
  if (cents === null) return null;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export function buildHistoricalDraftProjection(selection: BuiltHistoricalSelection): HistoricalDraftProjection {
  return {
    source: HISTORICAL_ESTIMATE_SOURCE, status: "draft", projectId: selection.projectId, clientId: selection.clientId, version: selection.revision,
    finalTotalPrice: selection.currencyCode === "USD" ? dollars(selection.declaredSelectedTotalMinor) : null,
    subtotalCost: selection.currencyCode === "USD" ? dollars(selection.declaredSelectedEstimatedCostMinor) : null,
    subtotalPrice: null, discountAmount: null, discountApplied: null, lineItems: null, grossProfit: null, grossProfitPct: null,
    approvedBy: null, approvedAt: null, lockedAt: null, profitShieldEvaluation: null, profitShieldPassed: null, pricingSnapshot: null,
  };
}
export function assertHistoricalCaptureOnly(input: { source?: string | null; hasHistoricalImport?: boolean }, action: string): void {
  if (input.source === HISTORICAL_ESTIMATE_SOURCE || input.hasHistoricalImport === true) throw new HistoricalEstimateError("HISTORICAL_AUTHORITY_NOT_AVAILABLE", `Historical capture cannot perform ${action}; authority requires a separately governed workflow`);
}
