/** A1 pure representation and arithmetic. No persistence, identity authorization or field authority. */
import { z } from "zod";
import {
  CHANNELS, INTERNAL_APPROVAL_SOURCES, INTERNAL_APPROVAL_CHANNEL_BASES,
  INTERNAL_APPROVAL_GEO_RISKS, INTERNAL_APPROVAL_EXPOSURES, INTERNAL_APPROVAL_CONFIDENCES,
  INTERNAL_APPROVAL_RISK_RESOLUTION_BASES, INTERNAL_APPROVAL_STORED_RISK_BASES,
  INTERNAL_APPROVAL_FLOOR_KINDS, INTERNAL_APPROVAL_CSV_UNIT_SOURCES,
  INTERNAL_APPROVAL_CSV_CODE_SOURCES, INTERNAL_APPROVAL_CSV_COST_TYPES,
  INTERNAL_APPROVAL_CSV_UNITS, INTERNAL_APPROVAL_PROTOCOL as P,
  INTERNAL_APPROVAL_OPERATIONS as OPS, INTERNAL_APPROVAL_SCOPE_ASSOCIATIONS as SCOPE,
  type InternalApprovalErrorCode,
} from "./domain/taxonomy";
import { COMMERCIAL_CHANNELS, normalizeCommercialChannel, PRICING_TO_COMMERCIAL_CHANNEL } from "./domain/phase2-taxonomy";
import { normalizeChannel } from "./domain/normalization";
import { CHANNEL_MIN_MARGIN_PCT, CHANNEL_FLOOR_KIND, GEO_MIN_MARGIN_PCT, PROFIT_SHIELD } from "./constants/profit-shield";
import { buildGeoContextSummary, GEO_WARNING_CODES } from "./geo-context-warnings";

export class InternalApprovalError extends Error {
  constructor(public readonly code: InternalApprovalErrorCode, public readonly path: string | null = null) {
    super(`${code}: Internal approval data does not satisfy the required contract`);
    this.name = "InternalApprovalError";
  }
}
const MAX_MINOR = 10n ** 20n - 1n;
function fail(code: InternalApprovalErrorCode = "INTERNAL_APPROVAL_INPUT_INVALID", path: string | null = null): never {
  throw new InternalApprovalError(code, path === null ? null : Array.from(path).slice(0, 128).join(""));
}
function validUnicode(value: string): boolean {
  return !value.includes("\0") && Array.from(value).every(char => { const n = char.codePointAt(0)!; return n < 0xd800 || n > 0xdfff; });
}
/** Validate before Zod to avoid silently accepting prototype state, accessors or sparse arrays. */
function assertJson(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 32) fail();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (!validUnicode(value)) fail(); return; }
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail(); return; }
  if (typeof value !== "object" || seen.has(value)) fail();
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) fail();
  } else if (proto !== Object.prototype && proto !== null) fail();
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string" || !validUnicode(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    assertJson(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}
function issue(ctx: z.RefinementCtx, path: (string | number)[], code: InternalApprovalErrorCode): void {
  ctx.addIssue({ code: "custom", path, message: code, params: { approvalCode: code } });
}
function parsed<T>(schema: z.ZodType<T>, value: unknown, code: InternalApprovalErrorCode = "INTERNAL_APPROVAL_INPUT_INVALID"): T {
  assertJson(value);
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const customCode = first?.code === "custom" ? first.params?.approvalCode as InternalApprovalErrorCode | undefined : undefined;
    fail(customCode ?? code, first?.path.join(".") ?? null);
  }
  return result.data;
}
function jsonSchema<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, ctx) => {
    try { assertJson(value); } catch {
      ctx.addIssue({ code: "custom", message: "INTERNAL_APPROVAL_INPUT_INVALID" });
      return z.NEVER;
    }
    return value;
  }, schema);
}

function decimal(value: unknown, digits: number, scale: number): { text: string; n: bigint; d: bigint } {
  if (typeof value !== "string" || value.length > 64 || !/^\d+(?:\.\d+)?$/.test(value)) fail();
  const [rawWhole, rawFraction = ""] = value.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  if (whole.length > digits || rawFraction.length > scale) fail();
  const fraction = rawFraction.replace(/0+$/, "");
  return { text: whole + (fraction ? `.${fraction}` : ""), n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}
export function normalizeApprovalMinor(value: unknown): string {
  const v = decimal(value, 18, 2); return (v.n * 100n / v.d).toString();
}
export function normalizeApprovalDecimal(value: unknown): string { return decimal(value, 14, 6).text; }
export function normalizeApprovalPercent(value: unknown): string {
  const v = decimal(value, 3, 6); if (v.n > 100n * v.d) fail(); return v.text;
}
function canonicalDecimal(value: string, percent = false): boolean {
  try { return (percent ? normalizeApprovalPercent(value) : normalizeApprovalDecimal(value)) === value; } catch { return false; }
}
function compare(a: string, b: string): bigint {
  const left = decimal(a, 14, 6); const right = decimal(b, 14, 6); return left.n * right.d - right.n * left.d;
}
function meetsMargin(price: string, cost: string, floor: string): boolean {
  const p = BigInt(price); const f = decimal(floor, 3, 6);
  return p > 0n && 100n * f.d * (p - BigInt(cost)) >= f.n * p;
}
// Convert existing fractional constants as decimal rationals, not 0.28*100 binary float.
function fractionalConstantPercent(value: number): string {
  const f = decimal(String(value), 3, 6); const scaled = f.n * 100n;
  const whole = scaled / f.d; const remainder = scaled % f.d;
  if (!remainder) return whole.toString();
  const places = f.d.toString().length - 1;
  return normalizeApprovalPercent(`${whole}.${remainder.toString().padStart(places, "0")}`);
}
const GLOBAL_WARNING = fractionalConstantPercent(PROFIT_SHIELD.GLOBAL_MIN_GP);
const INDIVIDUAL_WARNING = fractionalConstantPercent(PROFIT_SHIELD.INDIVIDUAL_WARNING_GP);

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(v => v !== "00000000-0000-0000-0000-000000000000");
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const minor = z.string().regex(/^(0|[1-9][0-9]{0,19})$/, { abort: true });
const signedMinor = z.string().regex(/^(0|-?[1-9][0-9]{0,19})$/, { abort: true });
const decimalString = z.string().refine(v => canonicalDecimal(v), { abort: true });
const positiveDecimal = decimalString.refine(v => compare(v, "0") > 0n);
const percent = z.string().refine(v => canonicalDecimal(v, true), { abort: true });
const version = z.number().int().min(1).max(2147483647);
const ordinal = z.number().int().min(1).max(1000);
const timestamp = z.string().refine(v => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  const time = new Date(v); return Number.isFinite(time.getTime()) && time.toISOString() === v;
});
function text(min: number, max: number, trim: boolean) {
  return z.string().refine(validUnicode).transform(v => { const lf = v.replace(/\r\n?/g, "\n"); return trim ? lf.trim() : lf; })
    .refine(v => Array.from(v).length >= min && Array.from(v).length <= max);
}
const label = text(1, 255, true); const code = text(1, 128, true); const notes = text(0, 5000, false); const reason = text(10, 2000, true);
const risk = z.enum(INTERNAL_APPROVAL_GEO_RISKS);
const identitySchema = z.object({ tenantId: uuid, projectId: uuid, clientId: uuid, estimateDraftId: uuid, draftVersion: version }).strict();
const originSchema = z.object({
  source: z.enum(INTERNAL_APPROVAL_SOURCES), sourceCreatedAt: timestamp, pricingSchemaVersion: code.nullable(),
  estimateId: uuid.nullable(), intakeFormId: uuid.nullable(), bundleId: uuid.nullable(), supersedesId: uuid.nullable(), changeOrderOf: uuid.nullable(), lineageBasis: z.literal(P.lineageBasis),
}).strict().superRefine((v, ctx) => {
  if ((v.source === INTERNAL_APPROVAL_SOURCES[2] && v.supersedesId === null) || (v.source === INTERNAL_APPROVAL_SOURCES[3] && v.changeOrderOf === null)) issue(ctx, ["source"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
});
const presentationSchema = z.object({ bundleName: label.nullable(), reviewedNotes: notes.nullable() }).strict();
const financialsSchema = z.object({ currencyCode: z.literal(P.currency), currencyBasis: z.literal(P.currencyBasis), subtotalPriceMinor: minor, discountApplied: z.boolean(), discountMinor: minor, finalPriceMinor: minor, estimatedCostMinor: minor }).strict().superRefine((v, ctx) => {
  const subtotal = BigInt(v.subtotalPriceMinor), discount = BigInt(v.discountMinor), final = BigInt(v.finalPriceMinor);
  if (discount > subtotal || subtotal - discount !== final || final <= 0n || (!v.discountApplied && discount !== 0n)) issue(ctx, ["finalPriceMinor"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
});
const csvSchema = z.object({ classificationVersion: z.literal(P.classification), costType: z.enum(INTERNAL_APPROVAL_CSV_COST_TYPES), normalizedUnit: z.enum(INTERNAL_APPROVAL_CSV_UNITS), costCode: code.nullable(), costTypeSource: z.literal(P.costTypeSource), unitSource: z.enum(INTERNAL_APPROVAL_CSV_UNIT_SOURCES), costCodeSource: z.enum(INTERNAL_APPROVAL_CSV_CODE_SOURCES) }).strict().superRefine((v, ctx) => {
  if ((v.costCodeSource === INTERNAL_APPROVAL_CSV_CODE_SOURCES[2]) !== (v.costCode === null)) issue(ctx, ["costCode"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
});
const lineSchema = z.object({
  lineKey: z.string(), ordinal, costGroupName: label, costItemName: label, description: notes.nullable(), quantity: positiveDecimal, unit: code.nullable(),
  unitCostSnapshot: decimalString.nullable(), unitPriceSnapshot: decimalString.nullable(), lineTotalCostMinor: minor, lineTotalPriceMinor: minor,
  assemblyId: uuid.nullable(), costCode: code.nullable(), taxable: z.boolean().nullable(), csvClassification: csvSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.lineKey !== `line:${v.ordinal}`) issue(ctx, ["lineKey"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
  const csv = v.csvClassification;
  if (!csv) return;
  if (v.unit === null || v.unitCostSnapshot === null || v.unitPriceSnapshot === null) issue(ctx, ["csvClassification"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
  if (csv.unitSource === INTERNAL_APPROVAL_CSV_UNIT_SOURCES[0] && csv.normalizedUnit !== v.unit) issue(ctx, ["csvClassification", "unitSource"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
  if (v.costCode !== null ? (csv.costCodeSource !== INTERNAL_APPROVAL_CSV_CODE_SOURCES[0] || csv.costCode !== v.costCode) : csv.costCodeSource === INTERNAL_APPROVAL_CSV_CODE_SOURCES[0]) issue(ctx, ["csvClassification", "costCodeSource"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
});
const selectionSchema = z.object({ selectionKey: z.string(), ordinal, assemblyId: uuid, assemblyName: label, assemblyCode: code.nullable(), category: label.nullable(), quantity: positiveDecimal, unitCost: decimalString.nullable(), unitPrice: decimalString.nullable(), extendedCostMinor: minor.nullable(), extendedPriceMinor: minor.nullable() }).strict().superRefine((v, ctx) => {
  if (v.selectionKey !== `selection:${v.ordinal}`) issue(ctx, ["selectionKey"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
});
const linesSchema = z.array(lineSchema).min(1).max(1000).superRefine((v, ctx) => v.forEach((line, i) => { if (line.ordinal !== i + 1) issue(ctx, [i, "ordinal"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED"); }));
const selectionsSchema = z.array(selectionSchema).max(1000).superRefine((v, ctx) => v.forEach((selection, i) => { if (selection.ordinal !== i + 1) issue(ctx, [i, "ordinal"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED"); }));
const pricingContextSchema = z.object({ pricingChannel: z.enum(CHANNELS).nullable(), finishLevel: code.nullable(), region: code.nullable(), zone: code.nullable(), trade: code.nullable(), coastalModifier: decimalString.nullable(), storedCommercialChannel: z.enum(COMMERCIAL_CHANNELS).nullable(), storedGeoRiskClass: risk.nullable(), storedRiskBasis: z.enum(INTERNAL_APPROVAL_STORED_RISK_BASES) }).strict().superRefine((v, ctx) => {
  if ((v.storedRiskBasis === INTERNAL_APPROVAL_STORED_RISK_BASES[1]) !== (v.storedGeoRiskClass === null)) issue(ctx, ["storedGeoRiskClass"], "POLICY_CONTEXT_UNRESOLVED");
});
const projectGeoSchema = z.object({
  zone: code, zoneId: uuid, zoneTenantId: uuid, zoneSnapshotCapturedAt: timestamp, geocodedAt: timestamp,
  geocodeConfidence: z.enum(INTERNAL_APPROVAL_CONFIDENCES), geocodeSource: z.literal(P.geocodeSource),
  coastalExposureLevel: z.enum(INTERNAL_APPROVAL_EXPOSURES), riskResolutionBasis: z.enum(INTERNAL_APPROVAL_RISK_RESOLUTION_BASES), persistedProjectRiskClass: risk.nullable(),
  costMultiplier: positiveDecimal.nullable(), zoneMinFloorPct: percent.nullable(), warningCodes: z.array(z.enum(GEO_WARNING_CODES)).max(GEO_WARNING_CODES.length),
}).strict().superRefine((v, ctx) => {
  let previous = -1;
  for (const warning of v.warningCodes) {
    const position = GEO_WARNING_CODES.indexOf(warning);
    if (position <= previous || position < 3) issue(ctx, ["warningCodes"], "POLICY_CONTEXT_UNRESOLVED");
    previous = position;
  }
});
const settingsSchema = z.object({ settingsId: uuid.nullable(), settingsUpdatedAt: timestamp.nullable(), channelOverridePct: percent.nullable(), geoOverridePct: percent.nullable() }).strict().superRefine((v, ctx) => {
  if ((v.settingsId === null) !== (v.settingsUpdatedAt === null) || (v.settingsId === null && (v.channelOverridePct !== null || v.geoOverridePct !== null))) issue(ctx, ["settingsId"], "POLICY_CONTEXT_UNRESOLVED");
});
const floorsSchema = z.object({ channelBasePct: percent, geoBasePct: percent, effectiveFloorPct: percent, globalWarningPct: z.literal(GLOBAL_WARNING), individualWarningPct: z.literal(INDIVIDUAL_WARNING), floorKind: z.enum(INTERNAL_APPROVAL_FLOOR_KINDS) }).strict();
export const internalApprovalPolicyContextSchema = jsonSchema(z.object({
  version: z.literal(P.policy), evaluatorVersion: z.literal(P.evaluator), commercialChannel: z.enum(COMMERCIAL_CHANNELS), channelBasis: z.enum(INTERNAL_APPROVAL_CHANNEL_BASES), channelRawValue: code,
  geoRiskClass: risk, riskBasis: z.literal(P.riskBasis), projectGeo: projectGeoSchema, tenantSettings: settingsSchema, floors: floorsSchema,
}).strict().superRefine((v, ctx) => {
  const pricingChannel = normalizeChannel(v.channelRawValue);
  const channel = v.channelBasis === INTERNAL_APPROVAL_CHANNEL_BASES[3] ? (pricingChannel ? PRICING_TO_COMMERCIAL_CHANNEL[pricingChannel] : null) : normalizeCommercialChannel(v.channelRawValue);
  if (channel !== v.commercialChannel) issue(ctx, ["channelRawValue"], "POLICY_CONTEXT_UNRESOLVED");
  const geo = v.projectGeo;
  const summary = buildGeoContextSummary({ geocodeSuccess: true, geocodeConfidence: geo.geocodeConfidence, zoneName: geo.zone, coastalExposureLevel: geo.coastalExposureLevel, costMultiplier: geo.costMultiplier });
  const lowExposure = geo.coastalExposureLevel === INTERNAL_APPROVAL_EXPOSURES[0] || geo.coastalExposureLevel === INTERNAL_APPROVAL_EXPOSURES[1];
  if (summary.riskClass !== v.geoRiskClass || (geo.persistedProjectRiskClass !== null && geo.persistedProjectRiskClass !== v.geoRiskClass) || (lowExposure && (geo.riskResolutionBasis !== INTERNAL_APPROVAL_RISK_RESOLUTION_BASES[1] || geo.persistedProjectRiskClass === null)) || (!lowExposure && geo.riskResolutionBasis !== INTERNAL_APPROVAL_RISK_RESOLUTION_BASES[0])) issue(ctx, ["geoRiskClass"], "POLICY_CONTEXT_UNRESOLVED");
  if (summary.codes.some(c => !geo.warningCodes.includes(c))) issue(ctx, ["projectGeo", "warningCodes"], "POLICY_CONTEXT_UNRESOLVED");
  const channelFloor = String(CHANNEL_MIN_MARGIN_PCT[v.commercialChannel]); const geoFloor = String(GEO_MIN_MARGIN_PCT[v.geoRiskClass]);
  const candidates = [channelFloor, geoFloor, v.tenantSettings.channelOverridePct, v.tenantSettings.geoOverridePct].filter((x): x is string => x !== null);
  const effective = candidates.reduce((a, b) => compare(a, b) >= 0n ? a : b);
  const kind = CHANNEL_FLOOR_KIND[v.commercialChannel] === "fee" ? INTERNAL_APPROVAL_FLOOR_KINDS[1] : INTERNAL_APPROVAL_FLOOR_KINDS[0];
  if (v.floors.channelBasePct !== channelFloor || v.floors.geoBasePct !== geoFloor || v.floors.effectiveFloorPct !== effective || v.floors.floorKind !== kind) issue(ctx, ["floors"], "POLICY_CONTEXT_UNRESOLVED");
  if (geo.zoneMinFloorPct !== null && compare(geo.zoneMinFloorPct, effective) > 0n) issue(ctx, ["projectGeo", "zoneMinFloorPct"], "POLICY_CONTEXT_UNRESOLVED");
}));
const scopeSchema = z.discriminatedUnion("association", [
  z.object({ association: z.literal(SCOPE[0]), scopeDraftId: z.null(), reviewSnapshotId: z.null() }).strict(),
  z.object({ association: z.literal(SCOPE[1]), scopeDraftId: uuid, reviewSnapshotId: z.null() }).strict(),
]);
const snapshotBase = z.object({ version: z.literal(P.snapshot), identity: identitySchema, origin: originSchema, presentation: presentationSchema, financials: financialsSchema, lines: linesSchema, assemblySelections: selectionsSchema, commercialContext: z.object({ pricingContext: pricingContextSchema, policyContext: internalApprovalPolicyContextSchema }).strict(), scopeReference: scopeSchema }).strict();
export const internalApprovalSnapshotSchema = jsonSchema(snapshotBase.superRefine((v, ctx) => {
  const sum = (field: "lineTotalCostMinor" | "lineTotalPriceMinor") => v.lines.reduce((total, line) => total + BigInt(line[field]), 0n);
  const cost = sum("lineTotalCostMinor"), price = sum("lineTotalPriceMinor");
  if (cost > MAX_MINOR || price > MAX_MINOR || cost !== BigInt(v.financials.estimatedCostMinor) || price !== BigInt(v.financials.subtotalPriceMinor)) issue(ctx, ["financials"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
  const { pricingContext: pricing, policyContext: policy } = v.commercialContext;
  if (policy.projectGeo.zoneTenantId !== v.identity.tenantId || (pricing.zone !== null && pricing.zone !== policy.projectGeo.zone) || (pricing.storedGeoRiskClass !== null && pricing.storedGeoRiskClass !== policy.geoRiskClass) || (pricing.storedCommercialChannel !== null && pricing.storedCommercialChannel !== policy.commercialChannel)) issue(ctx, ["commercialContext"], "POLICY_CONTEXT_UNRESOLVED");
  if (v.origin.supersedesId === v.identity.estimateDraftId || v.origin.changeOrderOf === v.identity.estimateDraftId) issue(ctx, ["origin"], "INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
}));
const selectionKey = z.string().regex(/^selection:([1-9][0-9]{0,2}|1000)$/);
const warningSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal(P.globalWarning), selectionKey: z.null(), thresholdPct: z.literal(GLOBAL_WARNING) }).strict(),
  z.object({ code: z.literal(P.assemblyWarning), selectionKey, thresholdPct: z.literal(INDIVIDUAL_WARNING) }).strict(),
  z.object({ code: z.literal(P.assemblyUnknown), selectionKey, thresholdPct: z.null() }).strict(),
]);
export const internalApprovalPolicyEvaluationSchema = jsonSchema(z.object({ version: z.literal(P.evaluation), policyVersion: z.literal(P.evaluator), policyHash: hash, commercialChannel: z.enum(COMMERCIAL_CHANNELS), geoRiskClass: risk, floorKind: z.enum(INTERNAL_APPROVAL_FLOOR_KINDS), effectiveFloorPct: percent, priceMinor: minor.refine(v => BigInt(v) > 0n), costMinor: minor, profitMinor: signedMinor, passed: z.boolean(), violations: z.array(z.literal(P.marginViolation)).max(1), warnings: z.array(warningSchema).max(1001) }).strict().superRefine((v, ctx) => {
  const passed = meetsMargin(v.priceMinor, v.costMinor, v.effectiveFloorPct);
  if (v.profitMinor !== (BigInt(v.priceMinor) - BigInt(v.costMinor)).toString() || v.passed !== passed || v.violations.length !== (passed ? 0 : 1)) issue(ctx, ["passed"], "INTERNAL_APPROVAL_INTEGRITY_ERROR");
  let previous = -1;
  for (const warning of v.warnings) {
    const position = warning.selectionKey === null ? 0 : Number(warning.selectionKey.slice(10));
    if (position <= previous) issue(ctx, ["warnings"], "INTERNAL_APPROVAL_INTEGRITY_ERROR");
    previous = position;
  }
}));

export type InternalApprovalSnapshot = z.infer<typeof internalApprovalSnapshotSchema>;
export type InternalApprovalPolicyContext = z.infer<typeof internalApprovalPolicyContextSchema>;
export type InternalApprovalPolicyEvaluation = z.infer<typeof internalApprovalPolicyEvaluationSchema>;
const reviewInputSchema = z.object({ identity: identitySchema, origin: originSchema, presentation: presentationSchema, financials: financialsSchema, lines: linesSchema, assemblySelections: selectionsSchema, pricingContext: pricingContextSchema, policyContext: internalApprovalPolicyContextSchema, scopeReference: scopeSchema }).strict();
export type InternalApprovalReviewInput = z.infer<typeof reviewInputSchema>;
export interface ReviewResult { snapshot: InternalApprovalSnapshot; contentHash: string; policyHash: string; evaluation: InternalApprovalPolicyEvaluation }

export const internalApproveCommandSchema = jsonSchema(z.object({ id: uuid, requestId: uuid, expectedDraftVersion: version, expectedContentHash: hash, expectedPolicyHash: hash, confirmedCurrencyCode: z.literal(P.currency), reason }).strict());
export const internalRevokeCommandSchema = jsonSchema(z.object({ id: uuid, approvalId: uuid, requestId: uuid, expectedContentHash: hash, reason }).strict());
export const internalCreateVersionCommandSchema = jsonSchema(z.object({ sourceDraftId: uuid, requestId: uuid, expectedSourceVersion: version, expectedSourceContentHash: hash, name: label.nullable(), reason }).strict());
const contextSchema = z.object({ tenantId: uuid, actorId: uuid, projectId: uuid, clientId: uuid }).strict();
const commandInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal(OPS[0]), context: contextSchema, command: internalApproveCommandSchema }).strict(),
  z.object({ operation: z.literal(OPS[1]), context: contextSchema, command: internalRevokeCommandSchema }).strict(),
  z.object({ operation: z.literal(OPS[2]), context: contextSchema, command: internalCreateVersionCommandSchema }).strict(),
]);

export function canonicalizeInternalApproval(value: unknown): string {
  assertJson(value);
  function encode(v: unknown): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(encode).join(",")}]`;
    return `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${encode((v as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return encode(value);
}
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeInternalApproval(value));
  try {
    if (typeof globalThis.crypto?.subtle?.digest !== "function") fail("INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE");
    const result = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    if (result.length !== 32) fail("INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE");
    return Array.from(result, byte => byte.toString(16).padStart(2, "0")).join("");
  } catch { fail("INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE"); }
}
export async function hashInternalApprovalContent(value: unknown): Promise<string> { return digest(parsed(internalApprovalSnapshotSchema, value)); }
export async function hashInternalApprovalPolicy(value: unknown): Promise<string> { return digest(parsed(internalApprovalPolicyContextSchema, value, "POLICY_CONTEXT_UNRESOLVED")); }
export async function hashInternalApprovalCommand(value: unknown): Promise<string> {
  const { operation, context, command } = parsed(commandInputSchema, value);
  return digest({ version: P.command, operation, ...context, command });
}
const evaluationInputSchema = z.object({ financials: financialsSchema, assemblySelections: selectionsSchema, policyContext: internalApprovalPolicyContextSchema, policyHash: hash }).strict();
export function evaluateInternalApprovalPolicy(value: unknown): InternalApprovalPolicyEvaluation {
  const { financials: f, assemblySelections, policyContext: policy, policyHash } = parsed(evaluationInputSchema, value);
  const passed = meetsMargin(f.finalPriceMinor, f.estimatedCostMinor, policy.floors.effectiveFloorPct);
  const warnings: z.infer<typeof warningSchema>[] = [];
  if (!meetsMargin(f.finalPriceMinor, f.estimatedCostMinor, GLOBAL_WARNING)) warnings.push({ code: P.globalWarning, selectionKey: null, thresholdPct: GLOBAL_WARNING });
  for (const selection of assemblySelections) {
    const cost = selection.extendedCostMinor, price = selection.extendedPriceMinor;
    if (cost === null || price === null || price === "0") warnings.push({ code: P.assemblyUnknown, selectionKey: selection.selectionKey, thresholdPct: null });
    else if (!meetsMargin(price, cost, INDIVIDUAL_WARNING)) warnings.push({ code: P.assemblyWarning, selectionKey: selection.selectionKey, thresholdPct: INDIVIDUAL_WARNING });
  }
  return parsed(internalApprovalPolicyEvaluationSchema, { version: P.evaluation, policyVersion: P.evaluator, policyHash, commercialChannel: policy.commercialChannel, geoRiskClass: policy.geoRiskClass, floorKind: policy.floors.floorKind, effectiveFloorPct: policy.floors.effectiveFloorPct, priceMinor: f.finalPriceMinor, costMinor: f.estimatedCostMinor, profitMinor: (BigInt(f.finalPriceMinor) - BigInt(f.estimatedCostMinor)).toString(), passed, violations: passed ? [] : [P.marginViolation], warnings });
}
export async function buildInternalApprovalReview(value: unknown): Promise<ReviewResult> {
  const { policyContext, pricingContext, ...rest } = parsed(reviewInputSchema, value);
  const snapshot = parsed(internalApprovalSnapshotSchema, { version: P.snapshot, ...rest, commercialContext: { pricingContext, policyContext } });
  const [contentHash, policyHash] = await Promise.all([hashInternalApprovalContent(snapshot), hashInternalApprovalPolicy(policyContext)]);
  const evaluation = evaluateInternalApprovalPolicy({ financials: snapshot.financials, assemblySelections: snapshot.assemblySelections, policyContext, policyHash });
  return { snapshot, contentHash, policyHash, evaluation };
}
const reviewResultSchema = z.object({ snapshot: internalApprovalSnapshotSchema, contentHash: hash, policyHash: hash, evaluation: internalApprovalPolicyEvaluationSchema }).strict();
export function assertInternalApprovalReviewMatch(value: unknown): void {
  const v = parsed(z.object({ review: reviewResultSchema, expectedDraftVersion: version, expectedContentHash: hash, expectedPolicyHash: hash }).strict(), value);
  if (v.review.snapshot.identity.draftVersion !== v.expectedDraftVersion || v.review.contentHash !== v.expectedContentHash || v.review.policyHash !== v.expectedPolicyHash) fail("INTERNAL_APPROVAL_REVIEW_STALE");
}
export async function validateInternalApprovalSnapshotRecord(value: unknown): Promise<ReviewResult> {
  try {
    const v = parsed(z.object({ snapshot: internalApprovalSnapshotSchema, evaluation: internalApprovalPolicyEvaluationSchema, expectedContentHash: hash, expectedPolicyHash: hash }).strict(), value);
    const { version: _version, commercialContext, ...rest } = v.snapshot;
    const review = await buildInternalApprovalReview({ ...rest, ...commercialContext });
    if (review.contentHash !== v.expectedContentHash || review.policyHash !== v.expectedPolicyHash || canonicalizeInternalApproval(review.evaluation) !== canonicalizeInternalApproval(v.evaluation)) fail("INTERNAL_APPROVAL_INTEGRITY_ERROR");
    return review;
  } catch (error) {
    if (error instanceof InternalApprovalError && error.code === "INTERNAL_APPROVAL_CRYPTO_UNAVAILABLE") throw error;
    fail("INTERNAL_APPROVAL_INTEGRITY_ERROR");
  }
}
