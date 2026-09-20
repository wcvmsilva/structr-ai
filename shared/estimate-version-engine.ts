/** Pure version-copy representation and projection. No DB, clock, allocation or authority. */
import { z } from "zod";
import {
  InternalApprovalError, internalApprovalSnapshotSchema, internalApprovalPolicyContextSchema,
  internalApprovalVersionPrimitives as p, guardInternalApprovalJsonSchema as guarded,
  parseInternalApprovalData as parse, hashCanonicalInternalApprovalJson as digest,
  refineInternalApprovalFinancialAmounts, refineInternalApprovalContentRelationships,
  hashInternalApprovalContent, type InternalApprovalSnapshot,
} from "./internal-estimate-approval-engine";
import {
  ESTIMATE_VERSION_PROTOCOL_V2 as V, ESTIMATE_VERSION_SOURCE_KINDS as K,
  ESTIMATE_VERSION_RECORDED_STATES, INTERNAL_APPROVAL_OPERATIONS,
  INTERNAL_APPROVAL_CHANNEL_BASES, type InternalApprovalErrorCode,
} from "./domain/taxonomy";

function fail(code: InternalApprovalErrorCode = "INTERNAL_APPROVAL_CONTENT_UNRESOLVED"): never {
  throw new InternalApprovalError(code);
}
function issue(ctx: z.RefinementCtx, path: (string | number)[]): void {
  ctx.addIssue({ code: "custom", path, message: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED", params: { approvalCode: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" } });
}

const previewCommon = { version: z.literal(V.previewCommand), sourceDraftId: p.uuid };
export const estimateVersionPreviewCommandV2Schema = guarded(z.discriminatedUnion("sourceKind", [
  z.object({ ...previewCommon, sourceKind: z.literal(K[0]), confirmedCurrencyCode: z.literal("USD") }).strict(),
  z.object({ ...previewCommon, sourceKind: z.literal(K[1]), confirmedCurrencyCode: z.null() }).strict(),
]));
export type VersionPreviewCommandV2 = z.infer<typeof estimateVersionPreviewCommandV2Schema>;

const commandCommon = {
  version: z.literal(V.command), sourceDraftId: p.uuid, requestId: p.uuid,
  expectedSourceVersion: p.version, expectedSourceContentHash: p.hash,
  name: p.label.nullable().optional(), reason: p.reason,
};
export const estimateCreateVersionCommandV2Schema = guarded(z.discriminatedUnion("sourceKind", [
  z.object({ ...commandCommon, sourceKind: z.literal(K[0]), confirmedCurrencyCode: z.literal("USD") }).strict(),
  z.object({ ...commandCommon, sourceKind: z.literal(K[1]), confirmedCurrencyCode: z.null() }).strict(),
]).transform(value => ({ ...value, name: value.name ?? null })));
export type CreateVersionCommandV2 = z.infer<typeof estimateCreateVersionCommandV2Schema>;

// This grammar has its own currency provenance from the start. It never creates
// a temporary approval snapshot or calls the approval review/evaluation builder.
const copyFinancials = z.object({ ...p.financialFields, currencyBasis: z.literal(V.currencyBasis) }).strict().superRefine(refineInternalApprovalFinancialAmounts);
export const estimateVersionCopySourceV2Schema = guarded(z.object({
  version: z.literal(V.copySource), identity: p.identity, origin: p.origin,
  presentation: p.presentation, financials: copyFinancials, lines: p.lines,
  assemblySelections: p.assemblySelections,
  commercialContext: z.object({ pricingContext: p.pricingContext, policyContext: internalApprovalPolicyContextSchema }).strict(),
  scopeReference: p.scopeReference,
  copyProjection: z.object({ assemblyCount: z.number().int().min(0).max(1000).nullable(), directZone: p.code.nullable() }).strict(),
}).strict().superRefine((value, ctx) => {
  refineInternalApprovalContentRelationships(value, ctx);
  if (value.copyProjection.assemblyCount !== null && value.copyProjection.assemblyCount !== value.assemblySelections.length) issue(ctx, ["copyProjection", "assemblyCount"]);
  if (value.copyProjection.directZone !== null && value.copyProjection.directZone !== value.commercialContext.pricingContext.zone) issue(ctx, ["copyProjection", "directZone"]);
}));
export type VersionCopySourceV2 = z.infer<typeof estimateVersionCopySourceV2Schema>;

export function normalizeEstimateVersionPreviewCommand(value: unknown): VersionPreviewCommandV2 {
  return parse(estimateVersionPreviewCommandV2Schema, value);
}
export function normalizeEstimateCreateVersionCommand(value: unknown): CreateVersionCommandV2 {
  return parse(estimateCreateVersionCommandV2Schema, value);
}
export function normalizeEstimateVersionCopySourceV2(value: unknown): VersionCopySourceV2 {
  return parse(estimateVersionCopySourceV2Schema, value);
}
export async function hashEstimateVersionCopySourceV2(value: unknown): Promise<string> {
  return digest(normalizeEstimateVersionCopySourceV2(value));
}
const commandHashInput = guarded(z.object({ context: p.context, command: estimateCreateVersionCommandV2Schema }).strict());
export async function hashEstimateVersionCommandV2(value: unknown): Promise<string> {
  const { context, command } = parse(commandHashInput, value);
  return digest({ version: V.request, operation: INTERNAL_APPROVAL_OPERATIONS[2], ...context, command });
}

const previewFields = { version: z.literal(V.preview), sourceDraftId: p.uuid, sourceVersion: p.version, sourceContentHash: p.hash };
export const estimateVersionPreviewV2Schema = guarded(z.discriminatedUnion("sourceKind", [
  z.object({ ...previewFields, sourceKind: z.literal(K[0]), sourceApprovalId: z.null(), sourceApprovalState: z.null(), confirmedCurrencyCode: z.literal("USD"), content: estimateVersionCopySourceV2Schema }).strict(),
  z.object({ ...previewFields, sourceKind: z.literal(K[1]), sourceApprovalId: p.uuid, sourceApprovalState: z.enum(ESTIMATE_VERSION_RECORDED_STATES), confirmedCurrencyCode: z.null(), content: internalApprovalSnapshotSchema }).strict(),
]).superRefine((value, ctx) => {
  if (value.sourceDraftId !== value.content.identity.estimateDraftId || value.sourceVersion !== value.content.identity.draftVersion) issue(ctx, ["sourceDraftId"]);
}));
export type VersionPreviewV2 = z.infer<typeof estimateVersionPreviewV2Schema>;

const previewBuildInput = guarded(z.object({
  command: estimateVersionPreviewCommandV2Schema, content: z.unknown(),
  sourceApprovalId: p.uuid.nullable(), sourceApprovalState: z.enum(ESTIMATE_VERSION_RECORDED_STATES).nullable(),
}).strict());
export async function buildEstimateVersionPreviewV2(value: unknown): Promise<VersionPreviewV2> {
  const input = parse(previewBuildInput, value);
  const content = input.command.sourceKind === K[0]
    ? normalizeEstimateVersionCopySourceV2(input.content)
    : parse(internalApprovalSnapshotSchema, input.content);
  const sourceContentHash = input.command.sourceKind === K[0]
    ? await hashEstimateVersionCopySourceV2(content)
    : await hashInternalApprovalContent(content);
  return parse(estimateVersionPreviewV2Schema, {
    version: V.preview, sourceKind: input.command.sourceKind,
    sourceDraftId: input.command.sourceDraftId, sourceVersion: content.identity.draftVersion,
    sourceContentHash, sourceApprovalId: input.sourceApprovalId,
    sourceApprovalState: input.sourceApprovalState,
    confirmedCurrencyCode: input.command.confirmedCurrencyCode, content,
  });
}

type Line = InternalApprovalSnapshot["lines"][number];
type Selection = InternalApprovalSnapshot["assemblySelections"][number];
type Pricing = InternalApprovalSnapshot["commercialContext"]["pricingContext"];
export type EstimateVersionLineProjection = Pick<Line, "costGroupName" | "costItemName" | "description" | "quantity" | "unit" | "unitCostSnapshot" | "unitPriceSnapshot" | "assemblyId" | "costCode" | "taxable"> & { lineTotalCost: string; lineTotalPrice: string };
export type EstimateVersionSelectionProjection = Pick<Selection, "assemblyId" | "assemblyName" | "assemblyCode" | "category" | "quantity" | "unitCost" | "unitPrice"> & { extendedCost: string | null; extendedPrice: string | null };
export interface EstimateVersionPricingProjection {
  channel: Pricing["pricingChannel"]; finishLevel: Pricing["finishLevel"]; region: Pricing["region"];
  zone: Pricing["zone"]; trade: Pricing["trade"]; coastalModifier: Pricing["coastalModifier"];
  commercialChannel: Pricing["storedCommercialChannel"]; geoRiskClass: Pricing["storedGeoRiskClass"];
}
/** All 54 insertable columns, independent of legacy Number-based JSON interfaces. */
export interface EstimateVersionDraftProjectionV2 {
  id: string; tenantId: string; estimateId: string | null; projectId: string;
  status: "draft"; source: "version"; draftData: null; bundleName: string | null;
  zone: string | null; finishLevel: string | null; trade: string | null;
  pricingSchemaVersion: string | null; channel: Pricing["pricingChannel"]; region: string | null;
  createdBy: string; coastalModifier: string | null;
  subtotalPrice: string; subtotalCost: string; finalTotalPrice: string;
  discountApplied: boolean; discountAmount: string; grossProfit: string; grossProfitPct: string;
  profitShieldPassed: null; profitShieldMinPct: null;
  assemblySelections: EstimateVersionSelectionProjection[]; lineItems: EstimateVersionLineProjection[];
  intakeFormId: string | null; warningsJson: null; scopeDraftId: string | null;
  notes: string | null; metadata: null; bundleId: string | null; clientId: string;
  assemblyCount: number | null; approvedBy: null; approvedAt: null;
  rejectedBy: null; rejectedAt: null; rejectionReason: null;
  createdAt: Date; updatedAt: Date; version: number; supersededBy: null;
  supersedesId: string; lockedAt: null; changeOrderOf: string | null; changeOrderReason: string;
  commercialChannel: Pricing["storedCommercialChannel"]; profitShieldFloorPct: null;
  profitShieldEvaluation: null; pricingSnapshot: EstimateVersionPricingProjection;
  a1VersionRequestId: string; a1VersionRequestHash: string;
}

function usd(minor: bigint): string {
  const negative = minor < 0n;
  const text = (negative ? -minor : minor).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${text.slice(0, -2)}.${text.slice(-2)}`;
}
function gpDisplay(price: bigint, cost: bigint): string {
  const numerator = (price - cost) * 10000n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = absolute / price + (2n * (absolute % price) >= price ? 1n : 0n);
  return usd(numerator < 0n ? -rounded : rounded);
}
const projectionInput = guarded(z.object({
  preview: estimateVersionPreviewV2Schema, command: estimateCreateVersionCommandV2Schema,
  context: p.context,
  allocation: z.object({ id: p.uuid, version: p.version, timestamp: p.timestamp }).strict(),
}).strict());
export async function projectEstimateVersionDraftV2(value: unknown): Promise<EstimateVersionDraftProjectionV2> {
  const { preview, command, context, allocation } = parse(projectionInput, value);
  const content = preview.content;
  const verifiedHash = preview.sourceKind === K[0]
    ? await hashEstimateVersionCopySourceV2(content)
    : await hashInternalApprovalContent(content);
  if (preview.sourceContentHash !== verifiedHash || command.expectedSourceContentHash !== verifiedHash
    || command.sourceKind !== preview.sourceKind || command.sourceDraftId !== preview.sourceDraftId
    || command.expectedSourceVersion !== preview.sourceVersion) fail("INTERNAL_APPROVAL_REVIEW_STALE");
  if (context.tenantId !== content.identity.tenantId || context.projectId !== content.identity.projectId
    || context.clientId !== content.identity.clientId || allocation.version <= preview.sourceVersion
    || allocation.id === preview.sourceDraftId) fail();

  const requestHash = await hashEstimateVersionCommandV2({ context, command });
  const pricing = content.commercialContext.pricingContext;
  const financials = content.financials;
  const final = BigInt(financials.finalPriceMinor), cost = BigInt(financials.estimatedCostMinor);
  const lineItems = content.lines.map((line): EstimateVersionLineProjection => ({
    costGroupName: line.costGroupName, costItemName: line.costItemName, description: line.description,
    quantity: line.quantity, unit: line.unit, unitCostSnapshot: line.unitCostSnapshot,
    unitPriceSnapshot: line.unitPriceSnapshot, assemblyId: line.assemblyId, costCode: line.costCode,
    taxable: line.taxable, lineTotalCost: usd(BigInt(line.lineTotalCostMinor)), lineTotalPrice: usd(BigInt(line.lineTotalPriceMinor)),
  }));
  const assemblySelections = content.assemblySelections.map((selection): EstimateVersionSelectionProjection => ({
    assemblyId: selection.assemblyId, assemblyName: selection.assemblyName, assemblyCode: selection.assemblyCode,
    category: selection.category, quantity: selection.quantity, unitCost: selection.unitCost, unitPrice: selection.unitPrice,
    extendedCost: selection.extendedCostMinor === null ? null : usd(BigInt(selection.extendedCostMinor)),
    extendedPrice: selection.extendedPriceMinor === null ? null : usd(BigInt(selection.extendedPriceMinor)),
  }));
  return {
    id: allocation.id, tenantId: context.tenantId, estimateId: content.origin.estimateId,
    projectId: context.projectId, status: "draft", source: "version", draftData: null,
    bundleName: command.name ?? content.presentation.bundleName,
    zone: preview.sourceKind === K[0] ? preview.content.copyProjection.directZone : pricing.zone,
    finishLevel: pricing.finishLevel, trade: pricing.trade, pricingSchemaVersion: content.origin.pricingSchemaVersion,
    channel: pricing.pricingChannel, region: pricing.region, createdBy: context.actorId,
    coastalModifier: pricing.coastalModifier, subtotalPrice: usd(BigInt(financials.subtotalPriceMinor)),
    subtotalCost: usd(cost), finalTotalPrice: usd(final), discountApplied: financials.discountApplied,
    discountAmount: usd(BigInt(financials.discountMinor)), grossProfit: usd(final - cost), grossProfitPct: gpDisplay(final, cost),
    profitShieldPassed: null, profitShieldMinPct: null, assemblySelections, lineItems,
    intakeFormId: content.origin.intakeFormId, warningsJson: null, scopeDraftId: content.scopeReference.scopeDraftId,
    notes: content.presentation.reviewedNotes, metadata: null, bundleId: content.origin.bundleId,
    clientId: context.clientId,
    assemblyCount: preview.sourceKind === K[0] ? preview.content.copyProjection.assemblyCount : content.assemblySelections.length,
    approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
    createdAt: new Date(allocation.timestamp), updatedAt: new Date(allocation.timestamp),
    version: allocation.version, supersededBy: null, supersedesId: preview.sourceDraftId, lockedAt: null,
    changeOrderOf: content.origin.changeOrderOf, changeOrderReason: command.reason,
    commercialChannel: content.commercialContext.policyContext.channelBasis === INTERNAL_APPROVAL_CHANNEL_BASES[0]
      ? pricing.storedCommercialChannel : null,
    profitShieldFloorPct: null, profitShieldEvaluation: null,
    pricingSnapshot: { channel: pricing.pricingChannel, finishLevel: pricing.finishLevel, region: pricing.region,
      zone: pricing.zone, trade: pricing.trade, coastalModifier: pricing.coastalModifier,
      commercialChannel: pricing.storedCommercialChannel, geoRiskClass: pricing.storedGeoRiskClass },
    a1VersionRequestId: command.requestId, a1VersionRequestHash: requestHash,
  };
}
