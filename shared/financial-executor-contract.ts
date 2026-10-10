/** Closed public HTTP projections. Internal snapshots, drafts, bindings and audits never fit these schemas. */
import { z } from "zod";
import { calculatorContextCommandSchema, calculatorCalculateCommandSchema, calculatorCreateCommandSchema, calculatorRecoverCommandSchema } from "./financial-calculator-engine";
import { internalApprovalVersionPrimitives } from "./internal-estimate-approval-engine";
import { CALCULATOR_OPERATIONS as OPS, CALCULATOR_PROTOCOL as P, CALCULATOR_WARNING_CODES, FINANCIAL_EXECUTOR_RESULT_STATUSES } from "./domain/taxonomy";

const { uuid, hash, timestamp } = internalApprovalVersionPrimitives;
export const financialExecutorCommandSchema = z.union([calculatorContextCommandSchema, calculatorCalculateCommandSchema, calculatorCreateCommandSchema, calculatorRecoverCommandSchema]);
export type FinancialExecutorCommand = z.infer<typeof financialExecutorCommandSchema>;
const pair = { contractVersion: z.literal(P.version), projectId: uuid, intakeFormId: uuid };
const label = z.string().min(1).max(255);
const revision = z.string().min(1).max(128);
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/);
const minor = z.string().regex(/^(0|[1-9][0-9]{0,11})$/);
const signedMinor = z.string().regex(/^-?(0|[1-9][0-9]{0,11})$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
export const financialExecutorContextResultSchema = z.object({
  ...pair, operation: z.literal(OPS[0]), clientId: uuid,
  options: z.array(z.object({ assemblyId: uuid, name: label, unit: label }).strict()).max(25),
}).strict().refine(value => new Set(value.options.map(option => option.assemblyId)).size === value.options.length);
export const financialExecutorCalculateResultSchema = z.object({
  ...pair, operation: z.literal(OPS[1]), authority: z.literal(P.authority),
  financials: z.object({
    currency: z.literal(P.currency), costMinor: minor, priceMinor: minor, profitMinor: signedMinor,
    grossProfitPct: z.number().finite().max(100), margin: z.object({ numerator: signedMinor, denominator: minor }).strict(),
  }).strict(),
  lines: z.array(z.object({
    ordinal: z.number().int().min(1), assemblyId: uuid, componentId: uuid, quantity: decimal, unit: label,
    unitCost: decimal, unitPrice: decimal, lineTotalCostMinor: minor, lineTotalPriceMinor: minor,
    source: z.object({
      assemblyRevision: revision, componentRevision: revision, costCodeId: uuid, costCodeRevision: revision,
      costTypeId: uuid, costTypeRevision: revision, unitId: uuid, unitRevision: revision, priceId: uuid,
      priceRevision: revision, effectiveDate: date, expirationDate: date.nullable(), source: label,
    }).strict(),
  }).strict()).min(1).max(1000),
  selections: z.array(z.object({ assemblyId: uuid, quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(25),
  sourceHash: hash, calculationHash: hash, warnings: z.array(z.enum(CALCULATOR_WARNING_CODES)).max(2),
  provenance: z.object({ engineVersion: z.literal(P.engine), evaluationDate: date, timeZone: z.literal(P.timeZone), fixtureId: uuid, fixtureRevision: revision, fixtureAuditId: uuid }).strict(),
}).strict();
const receiptFields = {
  ...pair, requestId: uuid, status: z.enum(FINANCIAL_EXECUTOR_RESULT_STATUSES),
  draft: z.object({ id: uuid, status: z.string().min(1).max(64), version: z.number().int().min(1), supersededBy: uuid.nullable() }).strict().nullable(),
  creation: z.object({ draftId: uuid, sourceHash: hash, calculationHash: hash, createdAt: timestamp }).strict().nullable(),
};
export const financialExecutorReceiptResultSchema = z.object({ ...receiptFields, operation: z.union([z.literal(OPS[2]), z.literal(OPS[3])]) }).strict().superRefine((value, context) => {
  if (value.status === FINANCIAL_EXECUTOR_RESULT_STATUSES[0]) {
    if (!value.draft || !value.creation || value.draft.id !== value.creation.draftId) context.addIssue({ code: "custom", message: "Invalid public receipt identity" });
  } else if (value.operation !== OPS[3] || value.draft !== null || value.creation !== null) context.addIssue({ code: "custom", message: "Invalid public recovery state" });
});
export const financialExecutorPublicResultSchema = z.union([financialExecutorContextResultSchema, financialExecutorCalculateResultSchema, financialExecutorReceiptResultSchema]);
export type FinancialExecutorPublicResult = z.infer<typeof financialExecutorPublicResultSchema>;
