/** Pure read presentation. No persistence, pricing, approval or execution authority. */
import { z } from "zod";
import type { EstimateVersionPricingProjection } from "./estimate-version-engine";
import {
  internalApprovalVersionPrimitives as p, guardInternalApprovalJsonSchema as guarded,
  normalizeApprovalDecimal, normalizeApprovalMinor,
} from "./internal-estimate-approval-engine";
import { CHANNELS, INTERNAL_APPROVAL_GEO_RISKS } from "./domain/taxonomy";
import { COMMERCIAL_CHANNELS } from "./domain/phase2-taxonomy";

export type DisplayUnknownReason = "missing" | "invalid" | "undefined_ratio";
export type DisplayScalar = { state: "known"; value: string }
  | { state: "unavailable"; reason: DisplayUnknownReason };
export type DisplayCollection<T> = { state: "known"; rows: T[] }
  | { state: "unavailable"; reason: "missing" | "invalid" };
export type EstimateDisplayLine = {
  costGroupName: string | null; costItemName: string | null; description: string | null;
  unit: string | null; costCode: string | null; taxable: boolean | null;
  quantity: DisplayScalar; unitCost: DisplayScalar; unitPrice: DisplayScalar;
  totalCost: DisplayScalar; totalPrice: DisplayScalar;
  grossProfit: DisplayScalar; grossProfitPct: DisplayScalar;
};
export type EstimateDisplaySelection = {
  assemblyName: string | null; assemblyCode: string | null; category: string | null;
  quantity: DisplayScalar; unitCost: DisplayScalar; unitPrice: DisplayScalar;
  totalCost: DisplayScalar; totalPrice: DisplayScalar;
  grossProfit: DisplayScalar; grossProfitPct: DisplayScalar;
};
export type EstimateDisplayPricing = EstimateVersionPricingProjection;
export type EstimateDisplayProvenance = {
  state: "known"; source: "stored_pricing_snapshot"; pricing: EstimateDisplayPricing;
  pricingSchemaVersion: string | null; scopeDraftId: string | null;
} | { state: "unavailable"; reason: "legacy_context" };
export type EstimateDisplayResult = {
  state: "available"; representation: "v2" | "legacy"; percentPlaces: 1 | 2;
  summary: {
    subtotalPrice: DisplayScalar; subtotalCost: DisplayScalar; discountAmount: DisplayScalar;
    finalTotalPrice: DisplayScalar; grossProfit: DisplayScalar; grossProfitPct: DisplayScalar;
    discountRatioPct: DisplayScalar;
  };
  lines: DisplayCollection<EstimateDisplayLine>;
  selections: DisplayCollection<EstimateDisplaySelection>;
  provenance: EstimateDisplayProvenance;
} | {
  state: "unavailable"; representation: "v2" | "legacy" | "unknown";
  reason: "invalid_input" | "invalid_version_projection" | "historical_capture";
};

const MAX_MINOR = 10n ** 20n - 1n;
const ABSENT = Symbol("absent");
const known = (value: string): DisplayScalar => ({ state: "known", value });
const unavailable = (reason: DisplayUnknownReason): DisplayScalar => ({ state: "unavailable", reason });
const abs = (value: bigint) => value < 0n ? -value : value;
function fixed(value: bigint, places: number): string {
  const digits = abs(value).toString().padStart(places + 1, "0");
  return `${value < 0n ? "-" : ""}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
/** Only consumed own data fields are read; unrelated transport fields remain untouched. */
function own(value: Record<string, unknown>, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field) return ABSENT;
  if (!field.enumerable || !Object.hasOwn(field, "value")) throw new Error("Invalid display field");
  return field.value;
}
const absent = (value: unknown) => value === ABSENT || value === undefined || value === null;

/** Parse canonical display money, with a separate bound for a derived signed GP. */
function canonicalMinor(value: unknown, maximum: bigint): bigint | null {
  if (typeof value !== "string" || value.length > 32 || !/^-?(0|[1-9]\d*)\.\d{2}$/.test(value)) return null;
  const result = BigInt(value.replace(".", ""));
  return abs(result) <= maximum && !(result === 0n && value.startsWith("-")) ? result : null;
}
function canonicalDecimal(value: unknown, signed: boolean): boolean {
  if (typeof value !== "string" || value.length > 24) return false;
  const negative = value.startsWith("-");
  if (negative && !signed) return false;
  const unsigned = negative ? value.slice(1) : value;
  try { return normalizeApprovalDecimal(unsigned) === unsigned && !(negative && unsigned === "0"); }
  catch { return false; }
}
/** Exact decimal expansion, bounded before any padding or BigInt allocation. */
function legacyDecimal(value: string, wholeLimit: number, scale: number): string | null {
  if (value.length > 128) return null;
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match) return null;
  const exponent = Number(match[5] ?? "0"); // A bounded position, never monetary arithmetic.
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 350) return null;
  const whole = match[2] ?? "0", fraction = match[3] ?? match[4] ?? "";
  const digits = whole + fraction, point = whole.length + exponent;
  const expandedWhole = (point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0")).replace(/^0+(?=\d)/, "");
  const expandedFraction = (point < 0 ? "0".repeat(-point) + digits : digits.slice(point)).replace(/0+$/, "");
  if (expandedWhole.length > wholeLimit || expandedFraction.length > scale) return null;
  const zero = expandedWhole === "0" && !expandedFraction;
  return `${match[1] === "-" && !zero ? "-" : ""}${expandedWhole}${expandedFraction ? `.${expandedFraction}` : ""}`;
}
function scaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-"), unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const result = BigInt(whole + fraction.padEnd(scale, "0"));
  return negative ? -result : result;
}
function legacyScalar(value: unknown, money: boolean): DisplayScalar {
  if (absent(value)) return unavailable("missing");
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return unavailable("invalid");
  const scale = money ? 2 : 6;
  const parsed = legacyDecimal(typeof value === "string" ? value : String(value), money ? 18 : 14, scale);
  if (parsed === null) return unavailable("invalid");
  const units = scaled(parsed, scale);
  if (typeof value === "number" && (
    abs(units) > BigInt(Number.MAX_SAFE_INTEGER)
    || Number(units) / 10 ** scale !== value
    || Number(units + 1n) / 10 ** scale === value
    || Number(units - 1n) / 10 ** scale === value
  )) return unavailable("invalid");
  return known(money ? fixed(units, 2) : parsed);
}
function scalarText(value: DisplayScalar): string | null {
  try {
    if (!plain(value) || Reflect.ownKeys(value).length !== 2 || own(value, "state") !== "known") return null;
    const text = own(value, "value");
    return typeof text === "string" ? text : null;
  } catch { return null; }
}
function operand(value: DisplayScalar): { amount: bigint } | { unknown: DisplayScalar } {
  const text = scalarText(value), amount = canonicalMinor(text, MAX_MINOR);
  if (amount !== null) return { amount };
  try {
    if (plain(value) && own(value, "state") === "unavailable" && own(value, "reason") === "missing") return { unknown: unavailable("missing") };
  } catch { /* A malformed scalar is invalid, never a coercion opportunity. */ }
  return { unknown: unavailable("invalid") };
}
function ratio(numerator: bigint, denominator: bigint, places: 1 | 2): DisplayScalar {
  const extended = abs(numerator) * 10n ** BigInt(places);
  const rounded = extended / denominator + (2n * (extended % denominator) >= denominator ? 1n : 0n);
  return known(fixed(numerator < 0n ? -rounded : rounded, places));
}
export function deriveEstimateProfit(price: DisplayScalar, cost: DisplayScalar, places: 1 | 2): { amount: DisplayScalar; percent: DisplayScalar } {
  const p = operand(price), c = operand(cost);
  if ("unknown" in p || "unknown" in c || (places !== 1 && places !== 2)) {
    const unknown = "unknown" in p ? p.unknown : "unknown" in c ? c.unknown : unavailable("invalid");
    return { amount: unknown, percent: unknown };
  }
  const difference = p.amount - c.amount;
  return { amount: known(fixed(difference, 2)), percent: p.amount <= 0n ? unavailable("undefined_ratio") : ratio(difference * 100n, p.amount, places) };
}
export function deriveEstimateDiscountRatio(discount: DisplayScalar, subtotal: DisplayScalar): DisplayScalar {
  const d = operand(discount), s = operand(subtotal);
  if ("unknown" in d) return d.unknown;
  if ("unknown" in s) return s.unknown;
  return s.amount <= 0n || d.amount < 0n || d.amount > s.amount
    ? unavailable("undefined_ratio") : ratio(d.amount * 100n, s.amount, 1);
}
function grouped(value: string): string {
  const negative = value.startsWith("-"), unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  return `${negative ? "-$" : "$"}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function formatEstimateMoney(value: DisplayScalar): string {
  const text = scalarText(value);
  return canonicalMinor(text, 2n * MAX_MINOR) === null ? "Unavailable" : grouped(text!);
}
export function formatEstimateQuantity(value: DisplayScalar): string {
  const text = scalarText(value);
  return canonicalDecimal(text, true) ? text! : "Unavailable";
}
export function formatEstimateUnitRate(value: DisplayScalar): string {
  const text = scalarText(value);
  if (!canonicalDecimal(text, true)) return "Unavailable";
  const [whole, fraction = ""] = text!.split(".");
  return grouped(`${whole}.${fraction.padEnd(2, "0")}`);
}
export function formatEstimatePercent(value: DisplayScalar): string {
  const text = scalarText(value);
  if (text === null || !/^-?(0|[1-9]\d{0,22})\.\d{1,2}$/.test(text)) return "Unavailable";
  const places = text.split(".")[1].length, units = scaled(text, places);
  if (abs(units) > 10n ** BigInt(22 + places) || (units === 0n && text.startsWith("-"))) return "Unavailable";
  return `${text}%`;
}

function validUnicode(value: string): boolean {
  return !value.includes("\0") && Array.from(value).every(char => { const code = char.codePointAt(0)!; return code < 0xd800 || code > 0xdfff; });
}
const notesSchema = z.string().refine(validUnicode).transform(value => value.replace(/\r\n?/g, "\n"))
  .refine(value => Array.from(value).length <= 5000);
const decimalSchema = z.string().refine(value => canonicalDecimal(value, false));
const positiveDecimalSchema = decimalSchema.refine(value => scaled(value, 6) > 0n);
const fixedUsdSchema = z.string().refine(value => {
  const amount = canonicalMinor(value, MAX_MINOR); return amount !== null && amount >= 0n;
});
const numericUsdSchema = z.string().refine(value => {
  try { normalizeApprovalMinor(value); return true; } catch { return false; }
}).transform(value => fixed(BigInt(normalizeApprovalMinor(value)), 2));
const lineSchema = z.object({
  costGroupName: p.label, costItemName: p.label, description: notesSchema.nullable(),
  quantity: positiveDecimalSchema, unit: p.code.nullable(), unitCostSnapshot: decimalSchema.nullable(), unitPriceSnapshot: decimalSchema.nullable(),
  lineTotalCost: fixedUsdSchema, lineTotalPrice: fixedUsdSchema, assemblyId: p.uuid.nullable(), costCode: p.code.nullable(), taxable: z.boolean().nullable(),
}).strict();
const selectionSchema = z.object({
  assemblyId: p.uuid, assemblyName: p.label, assemblyCode: p.code.nullable(), category: p.label.nullable(),
  quantity: positiveDecimalSchema, unitCost: decimalSchema.nullable(), unitPrice: decimalSchema.nullable(),
  extendedCost: fixedUsdSchema.nullable(), extendedPrice: fixedUsdSchema.nullable(),
}).strict();
const pricingSchema = z.object({
  channel: z.enum(CHANNELS).nullable(), finishLevel: p.code.nullable(), region: p.code.nullable(), zone: p.code.nullable(), trade: p.code.nullable(),
  coastalModifier: decimalSchema.nullable(), commercialChannel: z.enum(COMMERCIAL_CHANNELS).nullable(), geoRiskClass: z.enum(INTERNAL_APPROVAL_GEO_RISKS).nullable(),
}).strict();
const v2Fields = {
  id: p.uuid, tenantId: p.uuid, projectId: p.uuid, clientId: p.uuid, createdBy: p.uuid, supersedesId: p.uuid,
  source: z.literal("version"), version: p.version, a1VersionRequestId: p.uuid, a1VersionRequestHash: p.hash,
  subtotalPrice: numericUsdSchema, subtotalCost: numericUsdSchema, discountAmount: numericUsdSchema, finalTotalPrice: numericUsdSchema, discountApplied: z.boolean(),
  lineItems: z.array(lineSchema).min(1).max(1000), assemblySelections: z.array(selectionSchema).max(1000),
  assemblyCount: z.number().int().min(0).max(1000).nullable(), zone: p.code.nullable(),
  pricingSnapshot: pricingSchema, pricingSchemaVersion: p.code.nullable(), scopeDraftId: p.uuid.nullable(),
};
const v2Schema = guarded(z.object(v2Fields).strict().superRefine((value, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "Invalid version presentation" });
  const subtotal = scaled(value.subtotalPrice, 2), cost = scaled(value.subtotalCost, 2);
  const discount = scaled(value.discountAmount, 2), final = scaled(value.finalTotalPrice, 2);
  if (value.id === value.supersedesId || discount > subtotal || subtotal - discount !== final || (!value.discountApplied && discount !== 0n)) fail();
  if (value.assemblyCount !== null && value.assemblyCount !== value.assemblySelections.length) fail();
  if (value.zone !== null && value.zone !== value.pricingSnapshot.zone) fail();
  if (value.lineItems.reduce((sum, line) => sum + scaled(line.lineTotalCost, 2), 0n) !== cost
    || value.lineItems.reduce((sum, line) => sum + scaled(line.lineTotalPrice, 2), 0n) !== subtotal) fail();
}));

function numericRow(quantity: DisplayScalar, unitCost: DisplayScalar, unitPrice: DisplayScalar, totalCost: DisplayScalar, totalPrice: DisplayScalar, places: 1 | 2) {
  const gp = deriveEstimateProfit(totalPrice, totalCost, places);
  return { quantity, unitCost, unitPrice, totalCost, totalPrice, grossProfit: gp.amount, grossProfitPct: gp.percent };
}
function summary(subtotalPrice: DisplayScalar, subtotalCost: DisplayScalar, discountAmount: DisplayScalar, finalTotalPrice: DisplayScalar, places: 1 | 2) {
  const gp = deriveEstimateProfit(finalTotalPrice, subtotalCost, places);
  return { subtotalPrice, subtotalCost, discountAmount, finalTotalPrice, grossProfit: gp.amount, grossProfitPct: gp.percent, discountRatioPct: deriveEstimateDiscountRatio(discountAmount, subtotalPrice) };
}
const nullableKnown = (value: string | null) => value === null ? unavailable("missing") : known(value);

/** Legacy invalid numbers stay field-unavailable; malformed containers never look empty. */
function legacyContainer(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 32) throw new Error("Display depth exceeded");
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value !== "object" || seen.has(value)) throw new Error("Invalid legacy container");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 1000 || Reflect.ownKeys(value).length !== value.length + 1) throw new Error("Invalid display array");
    for (let index = 0; index < value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(value, String(index));
      if (!item || !item.enumerable || !Object.hasOwn(item, "value")) throw new Error("Invalid display array index");
    }
  } else if (!plain(value)) throw new Error("Invalid legacy object");
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") throw new Error("Invalid display key");
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (!field.enumerable || !Object.hasOwn(field, "value")) throw new Error("Invalid display descriptor");
    legacyContainer(field.value, seen, depth + 1);
  }
  seen.delete(value);
}
function legacyText(value: unknown, kind: "label" | "code" | "notes"): string | null {
  const result = (kind === "label" ? p.label : kind === "code" ? p.code : notesSchema).safeParse(value);
  return result.success ? result.data : null;
}
function legacyCollection<T>(value: unknown, map: (row: Record<string, unknown>) => T): DisplayCollection<T> {
  if (absent(value)) return { state: "unavailable", reason: "missing" };
  try {
    if (!Array.isArray(value)) throw new Error("Expected display array");
    legacyContainer(value);
    return { state: "known", rows: value.map(row => { if (!plain(row)) throw new Error("Invalid display row"); return map(row); }) };
  } catch { return { state: "unavailable", reason: "invalid" }; }
}

export function buildEstimateDisplay(input: unknown): EstimateDisplayResult {
  let representation: "v2" | "legacy" | "unknown" = "unknown";
  try {
    if (!plain(input)) return { state: "unavailable", representation, reason: "invalid_input" };
    const hasId = Object.hasOwn(input, "a1VersionRequestId"), hasHash = Object.hasOwn(input, "a1VersionRequestHash");
    representation = hasId || hasHash ? "v2" : "legacy";
    const source = own(input, "source"), historical = own(input, "historicalImportId");
    if (source === "historical_import" || !absent(historical)) return { state: "unavailable", representation, reason: "historical_capture" };
    const request = own(input, "a1VersionRequestId"), hash = own(input, "a1VersionRequestHash");
    if ((!hasId && !hasHash) || (request === null && hash === null)) representation = "legacy";
    if (representation === "v2") {
      const picked = Object.fromEntries(Object.keys(v2Fields).map(key => [key, own(input, key)]));
      const result = v2Schema.safeParse(picked);
      if (!result.success) return { state: "unavailable", representation, reason: "invalid_version_projection" };
      const row = result.data;
      return {
        state: "available", representation, percentPlaces: 2,
        summary: summary(known(row.subtotalPrice), known(row.subtotalCost), known(row.discountAmount), known(row.finalTotalPrice), 2),
        lines: { state: "known", rows: row.lineItems.map(line => ({
          costGroupName: line.costGroupName, costItemName: line.costItemName, description: line.description, unit: line.unit, costCode: line.costCode, taxable: line.taxable,
          ...numericRow(known(line.quantity), nullableKnown(line.unitCostSnapshot), nullableKnown(line.unitPriceSnapshot), known(line.lineTotalCost), known(line.lineTotalPrice), 2),
        })) },
        selections: { state: "known", rows: row.assemblySelections.map(selection => ({
          assemblyName: selection.assemblyName, assemblyCode: selection.assemblyCode, category: selection.category,
          ...numericRow(known(selection.quantity), nullableKnown(selection.unitCost), nullableKnown(selection.unitPrice), nullableKnown(selection.extendedCost), nullableKnown(selection.extendedPrice), 2),
        })) },
        provenance: { state: "known", source: "stored_pricing_snapshot", pricing: row.pricingSnapshot, pricingSchemaVersion: row.pricingSchemaVersion, scopeDraftId: row.scopeDraftId },
      };
    }
    return {
      state: "available", representation: "legacy", percentPlaces: 1,
      summary: summary(legacyScalar(own(input, "subtotalPrice"), true), legacyScalar(own(input, "subtotalCost"), true), legacyScalar(own(input, "discountAmount"), true), legacyScalar(own(input, "finalTotalPrice"), true), 1),
      lines: legacyCollection(own(input, "lineItems"), row => ({
        costGroupName: legacyText(own(row, "costGroupName"), "label"), costItemName: legacyText(own(row, "costItemName"), "label"),
        description: legacyText(own(row, "description"), "notes"), unit: legacyText(own(row, "unit"), "code"), costCode: legacyText(own(row, "costCode"), "code"),
        taxable: typeof own(row, "taxable") === "boolean" ? own(row, "taxable") as boolean : null,
        ...numericRow(legacyScalar(own(row, "quantity"), false), legacyScalar(own(row, "unitCostSnapshot"), false), legacyScalar(own(row, "unitPriceSnapshot"), false), legacyScalar(own(row, "lineTotalCost"), true), legacyScalar(own(row, "lineTotalPrice"), true), 1),
      })),
      selections: legacyCollection(own(input, "assemblySelections"), row => ({
        assemblyName: legacyText(own(row, "assemblyName"), "label"), assemblyCode: legacyText(own(row, "assemblyCode"), "code"), category: legacyText(own(row, "category"), "label"),
        ...numericRow(legacyScalar(own(row, "quantity"), false), legacyScalar(own(row, "unitCost"), false), legacyScalar(own(row, "unitPrice"), false), legacyScalar(own(row, "extendedCost"), true), legacyScalar(own(row, "extendedPrice"), true), 1),
      })),
      provenance: { state: "unavailable", reason: "legacy_context" },
    };
  } catch {
    return { state: "unavailable", representation, reason: representation === "v2" ? "invalid_version_projection" : "invalid_input" };
  }
}
