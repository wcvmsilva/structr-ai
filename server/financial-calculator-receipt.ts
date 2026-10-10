import { z } from "zod";
import {
  type CalculatorResult,
  type CreateCalculatorCommand,
  type RecoverCalculatorCommand,
} from "../shared/financial-calculator-engine";
import { serializeExecutorJson } from "../shared/financial-executor-json";
import { internalApprovalPolicyContextSchema } from "../shared/internal-estimate-approval-engine";
import { FinancialExecutorError } from "../shared/financial-executor-error";
import {
  CALCULATOR_PROTOCOL,
  CALCULATOR_OPERATIONS,
} from "../shared/domain/taxonomy";
import { PROFIT_SHIELD_PCT } from "../shared/constants/profit-shield";
import { safeParseFloat } from "../shared/utils/math";
import { financialExecutorCalculateResultSchema } from "../shared/financial-executor-contract";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const jsonRow = z.record(z.string(), z.unknown());
const receiptSchema = z
  .object({
    contractVersion: z.literal(CALCULATOR_PROTOCOL.version),
    bindingId: uuid,
    tenantId: uuid,
    actorId: uuid,
    operation: z.literal(CALCULATOR_OPERATIONS[2]),
    requestId: uuid,
    commandHash: hash,
    sourceHash: hash,
    calculationHash: hash,
    projectId: uuid,
    intakeFormId: uuid,
    clientId: uuid,
    draftId: uuid,
    createdAt: z.string().datetime({ precision: 3 }),
    before: z.null(),
    draft: jsonRow,
    audit: z
      .object({
        id: uuid,
        user_id: uuid,
        action: z.literal("estimate_draft.create"),
        table_name: z.literal("estimate_drafts"),
        record_id: uuid,
        old_values: z.null(),
        new_values: jsonRow,
        ip_address: z.null(),
        user_agent: z.null(),
        created_at: z.string(),
      })
      .strict(),
  })
  .strict();

// Deliberately frozen physical projection. A new database column requires review.
export const CALCULATOR_DRAFT_RECEIPT_COLUMNS = [
  "id",
  "tenant_id",
  "estimate_id",
  "project_id",
  "status",
  "source",
  "draft_data",
  "bundle_name",
  "zone",
  "finish_level",
  "trade",
  "pricing_schema_version",
  "channel",
  "region",
  "created_by",
  "coastal_modifier",
  "subtotal_price",
  "subtotal_cost",
  "final_total_price",
  "discount_applied",
  "discount_amount",
  "gross_profit",
  "gross_profit_pct",
  "profit_shield_passed",
  "profit_shield_min_pct",
  "assembly_selections",
  "line_items",
  "intake_form_id",
  "warnings_json",
  "scope_draft_id",
  "notes",
  "metadata",
  "bundle_id",
  "client_id",
  "assembly_count",
  "approved_by",
  "approved_at",
  "rejected_by",
  "rejected_at",
  "rejection_reason",
  "created_at",
  "updated_at",
  "version",
  "superseded_by",
  "supersedes_id",
  "locked_at",
  "change_order_of",
  "change_order_reason",
  "commercial_channel",
  "profit_shield_floor_pct",
  "profit_shield_evaluation",
  "pricing_snapshot",
  "a1_version_request_id",
  "a1_version_request_hash",
] as const;
export type CalculatorReceipt = z.infer<typeof receiptSchema>;
export interface CalculatorReceiptIntent {
  command: CreateCalculatorCommand | RecoverCalculatorCommand;
  commandHash?: string;
  binding: { id: string; actorId: string; tenantId: string };
  clientId: string;
  calculation?: CalculatorResult;
  policyContext?: unknown;
}
function invalid(): never {
  throw new FinancialExecutorError("FINANCIAL_EXECUTOR_RECEIPT_INVALID");
}
function equal(actual: unknown, expected: unknown) {
  if (serializeExecutorJson(actual) !== serializeExecutorJson(expected))
    invalid();
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

/** Checks content, not just the presence of audit IDs; callers remain inside their real transaction. */
export async function validateCalculatorReceipt(
  value: unknown,
  intent: CalculatorReceiptIntent
): Promise<CalculatorReceipt> {
  try {
    serializeExecutorJson(value);
    const r = receiptSchema.parse(value),
      d = r.draft,
      a = r.audit;
    const { command: c, binding: b } = intent;
    equal(Object.keys(d).sort(), [...CALCULATOR_DRAFT_RECEIPT_COLUMNS].sort());
    for (const [actual, expected] of [
      [r.bindingId, b.id],
      [r.tenantId, b.tenantId],
      [r.actorId, b.actorId],
      [r.projectId, c.projectId],
      [r.intakeFormId, c.intakeFormId],
      [r.clientId, intent.clientId],
      [r.requestId, c.requestId],
    ])
      if (actual !== expected) invalid();
    if (intent.commandHash && r.commandHash !== intent.commandHash) invalid();
    if (
      c.operation === CALCULATOR_OPERATIONS[2] &&
      (r.sourceHash !== c.expectedSourceHash ||
        r.calculationHash !== c.expectedCalculationHash)
    )
      invalid();
    for (const [key, expected] of Object.entries({
      id: r.draftId,
      tenant_id: b.tenantId,
      project_id: c.projectId,
      intake_form_id: c.intakeFormId,
      client_id: intent.clientId,
      created_by: b.actorId,
      status: "draft",
      source: "assembly_calculator",
      version: 1,
      discount_applied: false,
      channel: "direct",
      region: CALCULATOR_PROTOCOL.region,
      finish_level: "standard",
    }))
      equal(d[key], expected);
    for (const key of [
      "estimate_id",
      "draft_data",
      "zone",
      "trade",
      "pricing_schema_version",
      "coastal_modifier",
      "discount_amount",
      "bundle_id",
      "approved_by",
      "approved_at",
      "rejected_by",
      "rejected_at",
      "rejection_reason",
      "superseded_by",
      "supersedes_id",
      "locked_at",
      "change_order_of",
      "change_order_reason",
      "scope_draft_id",
      "a1_version_request_id",
      "a1_version_request_hash",
      "profit_shield_evaluation",
    ])
      if (d[key] !== null) invalid();
    const pricing = z
      .object({
        calculatorContractVersion: z.literal(CALCULATOR_PROTOCOL.version),
        sourceHash: hash,
        calculationHash: hash,
        policyContext: internalApprovalPolicyContextSchema,
        provenance: financialExecutorCalculateResultSchema.shape.provenance,
        lines: financialExecutorCalculateResultSchema.shape.lines,
      })
      .strict()
      .parse(d.pricing_snapshot);
    const floor = safeParseFloat(
      pricing.policyContext.floors.effectiveFloorPct,
      "effectiveFloorPct"
    );
    if (
      d.commercial_channel !== "premium" ||
      d.profit_shield_floor_pct !== floor ||
      floor < PROFIT_SHIELD_PCT.COASTAL_MIN_GP ||
      pricing.sourceHash !== r.sourceHash ||
      pricing.calculationHash !== r.calculationHash ||
      pricing.policyContext.projectGeo.zoneTenantId !== b.tenantId ||
      pricing.policyContext.commercialChannel !== "premium" ||
      pricing.policyContext.geoRiskClass !== "coastal"
    )
      invalid();
    if (intent.policyContext !== undefined)
      equal(pricing.policyContext, intent.policyContext);
    if (
      a.user_id !== b.actorId ||
      a.record_id !== r.draftId ||
      a.id === r.draftId
    )
      invalid();
    if (
      instant(d.created_at) !== r.createdAt ||
      instant(d.updated_at) !== r.createdAt ||
      instant(a.created_at) !== r.createdAt
    )
      invalid();
    const {
      draftId: _id,
      createdAt: _at,
      before: _before,
      draft: _draft,
      audit: _audit,
      ...meta
    } = r;
    equal(a.new_values, { ...meta, draft: d });
    if (intent.calculation) {
      const expected = intent.calculation;
      if (
        r.sourceHash !== expected.sourceHash ||
        r.calculationHash !== expected.calculationHash ||
        expected.lines.length < 1 ||
        expected.lines.length > 1000
      )
        invalid();
      const p = expected.draft;
      equal(pricing.lines, expected.lines);
      equal(pricing.provenance, expected.provenance);
      for (const [column, value] of Object.entries({
        bundle_name: p.bundleName,
        channel: p.channel,
        region: p.region,
        finish_level: p.finishLevel,
        line_items: p.lineItems,
        assembly_selections: p.assemblySelections,
        assembly_count: p.assemblyCount,
        profit_shield_passed: p.profitShieldPassed,
        notes: p.notes,
        metadata: p.metadata,
        warnings_json: expected.warnings,
      }))
        equal(d[column], value);
      for (const [column, value] of Object.entries({
        subtotal_cost: p.subtotalCost,
        subtotal_price: p.subtotalPrice,
        final_total_price: p.finalTotalPrice,
        gross_profit: p.grossProfit,
        gross_profit_pct: p.grossProfitPct,
        profit_shield_min_pct: p.profitShieldMinPct,
      })) {
        if (
          typeof d[column] !== "number" ||
          !Number.isFinite(d[column]) ||
          d[column] !== safeParseFloat(value, column)
        )
          invalid();
      }
    }
    return structuredClone(r);
  } catch (error) {
    if (error instanceof FinancialExecutorError) throw error;
    invalid();
  }
}
