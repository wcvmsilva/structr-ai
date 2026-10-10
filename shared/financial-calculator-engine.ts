/** ADR-003 pure protected-source adapter: no database, environment, or ambient clock. */
import { z } from "zod";
import { calculateMultipleAssemblies, type AssemblyComponentInput } from "./assembly-engine";
import { transformBatchToEstimateDraft, type AssemblyMetadata } from "./estimate-engine";
import { round2, safeParseFloat } from "./utils/math";
import { PROFIT_SHIELD_PCT } from "./constants/profit-shield";
import { CALCULATOR_OPERATIONS as OPS, CALCULATOR_PROTOCOL as P, CALCULATOR_SOURCE_CLASSIFICATIONS, CALCULATOR_DIMENSION_SOURCES, CALCULATOR_WARNING_CODES, CALCULATOR_MAX_AMOUNT_USD, CALCULATOR_MAX_BOM_QUANTITY, ASSEMBLY_COMPONENT_TYPES, CHANNELS, FINISH_LEVELS, type CalculatorErrorCode } from "./domain/taxonomy";
import { normalizeCalculatorOperation, normalizeCalculatorSourceClassification, normalizeCalculatorDimensionSource, normalizeAssemblyComponentType, normalizeChannel, normalizeFinishLevel } from "./domain/normalization";
import { canonicalizeInternalApproval, hashCanonicalInternalApprovalJson, guardInternalApprovalJsonSchema, internalApprovalPolicyContextSchema, internalApprovalVersionPrimitives } from "./internal-estimate-approval-engine";

export class CalculatorError extends Error {
  constructor(public readonly code: CalculatorErrorCode, public readonly path: string | null = null) { super(`${code}: Calculator contract rejected`); this.name = "CalculatorError"; }
}
function fail(code: CalculatorErrorCode, path: string | null = null): never { throw new CalculatorError(code, path); }
const { uuid, hash, timestamp } = internalApprovalVersionPrimitives;
const label = z.string().min(1).max(255);
const revision = z.string().min(1).max(128);
function normalized<T extends z.ZodType>(schema: T, normalize: (input: string) => unknown) {
  return z.preprocess(value => typeof value === "string" ? normalize(value) : value, schema);
}
const operation = <T extends typeof OPS[number]>(value: T) => normalized(z.literal(value), normalizeCalculatorOperation);
const pairFields = { projectId: uuid, intakeFormId: uuid };
const selectionSchema = z.object({ assemblyId: uuid, quantity: z.number().int().min(1).max(100) }).strict();
const selectionsSchema = z.array(selectionSchema).min(1).max(25).refine(values => new Set(values.map(v => v.assemblyId)).size === values.length, "Duplicate assemblies");
const commandFields = { contractVersion: z.literal(P.version), ...pairFields, assemblies: selectionsSchema };
export const calculatorCalculateCommandSchema = guardInternalApprovalJsonSchema(z.object({ ...commandFields, operation: operation(OPS[1]) }).strict());
export const calculatorCreateCommandSchema = guardInternalApprovalJsonSchema(z.object({ ...commandFields, operation: operation(OPS[2]), requestId: uuid, expectedSourceHash: hash, expectedCalculationHash: hash }).strict());
export const calculatorRecoverCommandSchema = guardInternalApprovalJsonSchema(z.object({ contractVersion: z.literal(P.version), operation: operation(OPS[3]), ...pairFields, requestId: uuid }).strict());
export type CalculateCommand = z.infer<typeof calculatorCalculateCommandSchema>;
export type CreateCalculatorCommand = z.infer<typeof calculatorCreateCommandSchema>;
export type RecoverCalculatorCommand = z.infer<typeof calculatorRecoverCommandSchema>;
export type CalculatorPair = Pick<CalculateCommand, "projectId" | "intakeFormId">;
export type CalculatorSelection = z.infer<typeof selectionSchema>;

const date = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
// Full decimals only, before safeParseFloat. Money never enters this boundary as JSON floats.
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/, "CALCULATOR_NUMBER_INVALID").refine(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= CALCULATOR_MAX_AMOUNT_USD, "CALCULATOR_NUMBER_INVALID");
const positiveDecimal = decimal.refine(value => Number(value) > 0, "CALCULATOR_NUMBER_INVALID");
const componentType = normalized(z.enum(ASSEMBLY_COMPONENT_TYPES), normalizeAssemblyComponentType);
const direct = normalized(z.literal(CHANNELS[0]), normalizeChannel);
const standard = normalized(z.literal(FINISH_LEVELS[0]), normalizeFinishLevel);
const row = { id: uuid, isActive: z.boolean(), revision };
const tenantRow = { ...row, tenantId: uuid.nullable() };
const dimensionsSchema = z.object({ wasteFactor: z.literal(1), coastalModifier: z.literal(1), channelCostMultiplier: z.literal(1), channelPriceMultiplier: z.literal(1), finishMultiplier: z.literal(1), regionalCostModifier: z.literal(1), regionalLaborModifier: z.literal(1), regionalMaterialModifier: z.literal(1) }).strict();
/** wasteFactor is an explicitly normalized multiplier; raw BOM waste_factor percentages are not accepted here. */
const componentSchema = z.object({ id: uuid, assemblyId: uuid, costCodeId: uuid, costTypeId: uuid, unitId: uuid, description: label, quantity: positiveDecimal.refine(value => Number(value) <= CALCULATOR_MAX_BOM_QUANTITY), wasteFactor: z.literal("1"), componentType, unitCostOverride: z.null(), isOptional: z.literal(false), sortOrder: z.number().int().min(0), revision }).strict();
const assemblySchema = z.object({ ...tenantRow, name: label, code: label, category: label, trade: label.nullable(), defaultUnitId: uuid, baseUnitQty: z.literal("1"), wasteFactor: z.literal("1"), coastalModifier: z.literal("1"), region: z.literal(P.region), finishLevel: standard, components: z.array(componentSchema).max(1000) }).strict();
const manifestSchema = z.object({ ...row, auditId: uuid, assemblyIds: z.array(uuid).max(25), costCodeIds: z.array(uuid).max(1000), costTypeIds: z.array(uuid).max(1000), unitIds: z.array(uuid).max(1000), sharedSourceClassification: normalized(z.enum(CALCULATOR_SOURCE_CLASSIFICATIONS), normalizeCalculatorSourceClassification), dimensionSource: normalized(z.enum(CALCULATOR_DIMENSION_SOURCES), normalizeCalculatorDimensionSource) }).strict();
const snapshotShape = z.object({
  contractVersion: z.literal(P.version), engineVersion: z.literal(P.engine),
  authority: z.object({ bindingId: uuid, actorId: uuid, tenantId: uuid }).strict(),
  project: z.object({ ...tenantRow, clientId: uuid }).strict(), intake: z.object({ ...tenantRow, projectId: uuid }).strict(), client: z.object(tenantRow).strict(),
  capturedAt: timestamp, evaluationDate: date, timeZone: z.literal(P.timeZone), manifest: manifestSchema,
  context: z.object({ channel: direct, finishLevel: standard, region: z.literal(P.region), currency: z.literal(P.currency), dimensions: dimensionsSchema }).strict(),
  policyContext: internalApprovalPolicyContextSchema,
  assemblies: z.array(assemblySchema).max(25),
  costCodes: z.array(z.object({ ...tenantRow, code: label, name: label, defaultCostTypeId: uuid, defaultUnitId: uuid }).strict()).max(1000),
  costTypes: z.array(z.object({ ...row, componentType }).strict()).max(1000),
  units: z.array(z.object({ ...row, abbreviation: label }).strict()).max(1000),
  prices: z.array(z.object({ ...row, costCodeId: uuid, unitId: uuid, unitCost: decimal, unitPrice: positiveDecimal, source: label, effectiveDate: date, expirationDate: date.nullable() }).strict()).max(5000),
}).strict();
export const calculatorSnapshotSchema = z.preprocess((value, ctx) => {
  try { assertPlainSnapshot(value); } catch { ctx.addIssue({ code: "custom", message: "CALCULATOR_SNAPSHOT_INVALID" }); return z.NEVER; }
  return value;
}, snapshotShape);
export type CalculatorSnapshot = z.infer<typeof snapshotShape>;

/** Inspect descriptors before Zod can read a getter or copy away hidden state. */
function assertPlainSnapshot(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 32) fail("CALCULATOR_SNAPSHOT_INVALID");
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) fail("CALCULATOR_SNAPSHOT_INVALID");
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) fail("CALCULATOR_SNAPSHOT_INVALID");
  } else if (proto !== Object.prototype && proto !== null) fail("CALCULATOR_SNAPSHOT_INVALID");
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("CALCULATOR_SNAPSHOT_INVALID");
    assertPlainSnapshot(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}
function parsedSnapshot(value: unknown): CalculatorSnapshot {
  const parsed = calculatorSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]; const path = issue.path.map(String).join("."); const segments = issue.path.map(String);
    if (segments.includes("unitCostOverride")) fail("CALCULATOR_OVERRIDE_UNSUPPORTED", path);
    if (segments.some(v => ["unitCost", "unitPrice", "quantity"].includes(v))) fail("CALCULATOR_NUMBER_INVALID", path);
    if (segments[0] === "manifest") fail("CALCULATOR_MANIFEST_INVALID", path);
    if (segments[0] === "policyContext") fail("CALCULATOR_POLICY_INVALID", path);
    if (segments.some(v => ["capturedAt", "evaluationDate", "timeZone", "effectiveDate", "expirationDate"].includes(v))) fail("CALCULATOR_CLOCK_INVALID", path);
    if (segments[0] === "context" || segments.some(v => ["baseUnitQty", "wasteFactor", "coastalModifier", "region", "finishLevel", "isOptional"].includes(v))) fail("CALCULATOR_CONTEXT_UNSUPPORTED", path);
    fail("CALCULATOR_SNAPSHOT_INVALID", path);
  }
  // Reject hidden/prototype state instead of trusting Zod's plain-object copy.
  try { canonicalizeInternalApproval(value); } catch { fail("CALCULATOR_SNAPSHOT_INVALID"); }
  return parsed.data;
}
/** Hash envelopes use strings for decimal quantities/rates and safe integers for ordinals. */
export function canonicalizeCalculator(value: unknown): string {
  try { return canonicalizeInternalApproval(value); } catch { fail("CALCULATOR_INPUT_INVALID"); }
}
export async function hashCalculatorCanonical(value: unknown): Promise<string> {
  canonicalizeCalculator(value);
  try { return await hashCanonicalInternalApprovalJson(value); } catch { fail("CALCULATOR_CRYPTO_UNAVAILABLE"); }
}
function uniqueRows<T extends { id: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) { if (map.has(row.id)) fail("CALCULATOR_SOURCE_DUPLICATE"); map.set(row.id, row); }
  return map;
}
function requireRow<T extends { isActive: boolean }>(row: T | undefined): T {
  if (!row) fail("CALCULATOR_SOURCE_MISSING"); if (!row.isActive) fail("CALCULATOR_SOURCE_INACTIVE"); return row;
}
function tenantMatch(tenantId: string | null, expected: string) { if (tenantId !== expected) fail("CALCULATOR_SOURCE_TENANT_MISMATCH"); }
function classified(ids: string[], id: string) { if (!ids.includes(id)) fail("CALCULATOR_MANIFEST_INVALID"); }
function minor(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > CALCULATOR_MAX_AMOUNT_USD) fail("CALCULATOR_NUMBER_INVALID");
  const rounded = round2(value); const cents = Math.round(rounded * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(rounded - value) > 1e-8) fail("CALCULATOR_NUMBER_INVALID");
  return String(cents);
}
function numeric(value: string, field: string): number {
  const result = safeParseFloat(value, field); if (!Number.isFinite(result)) fail("CALCULATOR_NUMBER_INVALID", field); return result;
}
function capturedDate(value: CalculatorSnapshot): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value.capturedAt));
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function belowFloor(cost: string, price: string, floor: string): boolean {
  const [whole, fraction = ""] = floor.split("."); const denominator = 10n ** BigInt(fraction.length);
  return (BigInt(price) - BigInt(cost)) * 100n * denominator < BigInt(price) * BigInt(whole + fraction);
}
/** Extend source decimal quantity exactly; this never reprices the engine's rounded line totals. */
function extendedQuantity(quantity: string, selectionQuantity: number): string {
  const [whole, fraction = ""] = quantity.split(".");
  const digits = String(BigInt(whole + fraction) * BigInt(selectionQuantity)).padStart(fraction.length + 1, "0");
  if (!fraction.length) return digits;
  return `${digits.slice(0, -fraction.length)}.${digits.slice(-fraction.length)}`.replace(/0+$/, "").replace(/\.$/, "");
}
export interface CalculatorLine {
  ordinal: number; assemblyId: string; componentId: string; quantity: string; unit: string;
  unitCost: string; unitPrice: string; lineTotalCostMinor: string; lineTotalPriceMinor: string;
  source: { assemblyRevision: string; componentRevision: string; costCodeId: string; costCodeRevision: string; costTypeId: string; costTypeRevision: string; unitId: string; unitRevision: string; priceId: string; priceRevision: string; effectiveDate: string; expirationDate: string | null; source: string };
}

/** Async only for native WebCrypto; callers provide the protected transaction snapshot. */
export async function buildCalculatorResult(snapshotInput: unknown, commandInput: unknown) {
  const input = calculatorCalculateCommandSchema.safeParse(commandInput);
  if (!input.success) fail("CALCULATOR_INPUT_INVALID");
  const command = input.data, snapshot = parsedSnapshot(snapshotInput);
  const { authority, project, intake, client, manifest, context, policyContext } = snapshot;
  if (project.id !== command.projectId || intake.id !== command.intakeFormId || intake.projectId !== project.id || project.clientId !== client.id) fail("CALCULATOR_IDENTITY_MISMATCH");
  for (const row of [project, intake, client]) { requireRow(row); tenantMatch(row.tenantId, authority.tenantId); }
  if (!manifest.isActive) fail("CALCULATOR_MANIFEST_INVALID");
  for (const ids of [manifest.assemblyIds, manifest.costCodeIds, manifest.costTypeIds, manifest.unitIds]) if (new Set(ids).size !== ids.length) fail("CALCULATOR_MANIFEST_INVALID");
  if (capturedDate(snapshot) !== snapshot.evaluationDate) fail("CALCULATOR_CLOCK_INVALID");
  if (policyContext.projectGeo.zoneTenantId !== authority.tenantId || policyContext.commercialChannel !== "premium" || policyContext.geoRiskClass !== "coastal" || policyContext.tenantSettings.settingsId === null || policyContext.projectGeo.costMultiplier !== "1") fail("CALCULATOR_POLICY_INVALID");
  const assemblies = uniqueRows(snapshot.assemblies), costCodes = uniqueRows(snapshot.costCodes), types = uniqueRows(snapshot.costTypes), units = uniqueRows(snapshot.units);
  uniqueRows(snapshot.prices);
  const assemblyMetadata = new Map<string, AssemblyMetadata>(), provenance: CalculatorLine["source"][] = [], componentIds = new Set<string>();
  const batchInputs = command.assemblies.map(selection => {
    const assembly = requireRow(assemblies.get(selection.assemblyId));
    tenantMatch(assembly.tenantId, authority.tenantId); classified(manifest.assemblyIds, assembly.id); classified(manifest.unitIds, assembly.defaultUnitId); requireRow(units.get(assembly.defaultUnitId));
    if (!assembly.components.length) fail("CALCULATOR_SOURCE_MISSING");
    assemblyMetadata.set(assembly.id, { id: assembly.id, code: assembly.code, category: assembly.category, trade: assembly.trade });
    const components: AssemblyComponentInput[] = assembly.components.map((component, index) => {
      if (componentIds.has(component.id)) fail("CALCULATOR_SOURCE_DUPLICATE"); componentIds.add(component.id);
      if (component.assemblyId !== assembly.id || (index > 0 && component.sortOrder <= assembly.components[index - 1].sortOrder)) fail("CALCULATOR_SOURCE_INCOMPATIBLE");
      classified(manifest.costCodeIds, component.costCodeId); classified(manifest.costTypeIds, component.costTypeId); classified(manifest.unitIds, component.unitId);
      const code = requireRow(costCodes.get(component.costCodeId)), type = requireRow(types.get(component.costTypeId)), unit = requireRow(units.get(component.unitId));
      tenantMatch(code.tenantId, authority.tenantId);
      if (code.defaultCostTypeId !== type.id || code.defaultUnitId !== unit.id || component.componentType !== type.componentType) fail("CALCULATOR_SOURCE_INCOMPATIBLE");
      const codePrices = snapshot.prices.filter(price => price.costCodeId === code.id);
      if (!codePrices.length) fail("CALCULATOR_PRICE_MISSING");
      if (codePrices.some(price => price.expirationDate !== null && price.expirationDate <= price.effectiveDate)) fail("CALCULATOR_PRICE_NOT_EFFECTIVE");
      const compatible = codePrices.filter(price => price.unitId === unit.id);
      if (!compatible.length) fail("CALCULATOR_SOURCE_INCOMPATIBLE");
      const active = compatible.filter(price => price.isActive);
      if (!active.length) fail("CALCULATOR_SOURCE_INACTIVE");
      const eligible = active.filter(price => price.effectiveDate <= snapshot.evaluationDate && (price.expirationDate === null || price.expirationDate > snapshot.evaluationDate));
      if (!eligible.length) fail("CALCULATOR_PRICE_NOT_EFFECTIVE"); if (eligible.length !== 1) fail("CALCULATOR_PRICE_AMBIGUOUS");
      const price = eligible[0], unitCost = numeric(price.unitCost, "unitCost"), unitPrice = numeric(price.unitPrice, "unitPrice"), quantity = numeric(component.quantity, "quantity");
      minor(round2(unitCost)); minor(round2(unitPrice)); minor(round2(round2(unitCost) * quantity * selection.quantity)); minor(round2(round2(unitPrice) * quantity * selection.quantity));
      provenance.push({ assemblyRevision: assembly.revision, componentRevision: component.revision, costCodeId: code.id, costCodeRevision: code.revision, costTypeId: type.id, costTypeRevision: type.revision, unitId: unit.id, unitRevision: unit.revision, priceId: price.id, priceRevision: price.revision, effectiveDate: price.effectiveDate, expirationDate: price.expirationDate, source: price.source });
      return { id: component.id, componentType: component.componentType, description: component.description, quantity: component.quantity, unit: unit.abbreviation, wasteFactorPct: "0", unitCostOverride: null, priceBookItem: { id: price.id, code: code.code, name: code.name, unitCost: price.unitCost, unitPrice: price.unitPrice, wasteFactor: component.wasteFactor, coastalModifier: assembly.coastalModifier, itemType: type.componentType } };
    });
    return { components, quantity: selection.quantity, context: { assemblyId: assembly.id, assemblyName: assembly.name, coastalModifier: assembly.coastalModifier, finishLevel: context.finishLevel, region: context.region, dimensions: context.dimensions } };
  });
  const batch = calculateMultipleAssemblies(batchInputs), costMinor = minor(batch.totalCost), priceMinor = minor(batch.totalPrice);
  if (priceMinor === "0") fail("CALCULATOR_CALCULATION_INVALID");
  const profitMinor = String(BigInt(priceMinor) - BigInt(costMinor));
  const financials = { currency: P.currency, costMinor, priceMinor, profitMinor, grossProfitPct: batch.grossProfitPct, margin: { numerator: profitMinor, denominator: priceMinor } };
  const draft = transformBatchToEstimateDraft(batch, { ...context, projectId: project.id, clientId: client.id }, assemblyMetadata, PROFIT_SHIELD_PCT.GLOBAL_MIN_GP, { capturedAt: snapshot.capturedAt, timeZone: snapshot.timeZone });
  const lines: CalculatorLine[] = []; let ordinal = 0;
  for (const assembly of batch.assemblies) for (const component of assembly.pricedComponents) {
    const line = draft.lineItems[ordinal];
    const source = assemblies.get(assembly.assemblyId)!.components.find(source => source.id === component.componentId)!;
    const quantity = extendedQuantity(source.quantity, assembly.quantity);
    line.quantity = numeric(quantity, "quantity");
    lines.push({ ordinal: ordinal + 1, assemblyId: assembly.assemblyId, componentId: component.componentId, quantity, unit: component.unit, unitCost: String(component.adjustedUnitCost), unitPrice: String(component.adjustedUnitPrice), lineTotalCostMinor: minor(line.lineTotalCost), lineTotalPriceMinor: minor(line.lineTotalPrice), source: provenance[ordinal] }); ordinal++;
  }
  const sum = (key: "lineTotalCostMinor" | "lineTotalPriceMinor") => String(lines.reduce((total, line) => total + BigInt(line[key]), 0n));
  if (sum("lineTotalCostMinor") !== costMinor || sum("lineTotalPriceMinor") !== priceMinor) fail("CALCULATOR_CALCULATION_INVALID");
  const { capturedAt: _capturedAt, ...stableSources } = snapshot;
  const sourceHash = await hashCalculatorCanonical({ version: P.sourceHash, sources: stableSources });
  const calculationHash = await hashCalculatorCanonical({ version: P.calculationHash, sourceHash, command, financials: { ...financials, grossProfitPct: String(financials.grossProfitPct) }, lines });
  const warnings: typeof CALCULATOR_WARNING_CODES[number][] = [];
  if (belowFloor(costMinor, priceMinor, policyContext.floors.effectiveFloorPct)) warnings.push(CALCULATOR_WARNING_CODES[0]);
  if (batch.assemblies.some(assembly => belowFloor(minor(assembly.extendedCost), minor(assembly.extendedPrice), policyContext.floors.individualWarningPct))) warnings.push(CALCULATOR_WARNING_CODES[1]);
  return { contractVersion: P.version, projectId: project.id, intakeFormId: intake.id, authority: P.authority, financials, lines, selections: command.assemblies, context, sourceHash, calculationHash, warnings, provenance: { engineVersion: P.engine, evaluationDate: snapshot.evaluationDate, timeZone: snapshot.timeZone, fixtureId: manifest.id, fixtureRevision: manifest.revision, fixtureAuditId: manifest.auditId }, draft };
}
export type CalculatorResult = Awaited<ReturnType<typeof buildCalculatorResult>>;
