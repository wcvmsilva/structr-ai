import { describe, expect, it } from "vitest";
import { validateCalculatorReceipt } from "./financial-calculator-receipt";
import {
  calculatorId as id,
  calculatorIds as ids,
  calculatorSnapshot,
} from "./test-support/calculator-engine-fixture";

// Literal receipt fixture: independent of the validator and the SQL writer.
const hash = "a".repeat(64);
function fixture() {
  const command = {
    contractVersion: "calculator-v1",
    operation: "calculator.create",
    projectId: ids.project,
    intakeFormId: ids.intake,
    assemblies: [{ assemblyId: ids.a, quantity: 1 }],
    requestId: ids.request,
    expectedSourceHash: hash,
    expectedCalculationHash: "b".repeat(64),
  };
  const draft: Record<string, unknown> = {
    id: id(500),
    tenant_id: ids.tenant,
    estimate_id: null,
    project_id: ids.project,
    status: "draft",
    source: "assembly_calculator",
    draft_data: null,
    bundle_name: "Synthetic",
    zone: null,
    finish_level: "standard",
    trade: null,
    pricing_schema_version: null,
    channel: "direct",
    region: "charleston_sc",
    created_by: ids.actor,
    coastal_modifier: null,
    subtotal_price: 100,
    subtotal_cost: 40,
    final_total_price: 100,
    discount_applied: false,
    discount_amount: null,
    gross_profit: 60,
    gross_profit_pct: 60,
    profit_shield_passed: true,
    profit_shield_min_pct: 35,
    assembly_selections: [{ assemblyId: ids.a, quantity: 1 }],
    line_items: [{ quantity: 1, lineTotalCost: 40, lineTotalPrice: 100 }],
    intake_form_id: ids.intake,
    warnings_json: [],
    scope_draft_id: null,
    notes: null,
    metadata: {},
    bundle_id: null,
    client_id: ids.client,
    assembly_count: 1,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    created_at: "2026-10-10T16:00:00+00:00",
    updated_at: "2026-10-10T16:00:00+00:00",
    version: 1,
    superseded_by: null,
    supersedes_id: null,
    locked_at: null,
    change_order_of: null,
    change_order_reason: null,
    commercial_channel: "premium",
    profit_shield_floor_pct: 42,
    profit_shield_evaluation: null,
    pricing_snapshot: {
      calculatorContractVersion: "calculator-v1",
      sourceHash: hash,
      calculationHash: "b".repeat(64),
      policyContext: calculatorSnapshot().policyContext,
    },
    a1_version_request_id: null,
    a1_version_request_hash: null,
  };
  const meta = {
    contractVersion: "calculator-v1",
    bindingId: ids.binding,
    tenantId: ids.tenant,
    actorId: ids.actor,
    operation: "calculator.create",
    requestId: ids.request,
    commandHash: "c".repeat(64),
    sourceHash: hash,
    calculationHash: "b".repeat(64),
    projectId: ids.project,
    intakeFormId: ids.intake,
    clientId: ids.client,
  };
  Object.assign(draft.pricing_snapshot as object, {
    provenance: {
      engineVersion: "calculator-canonical-engines-v1",
      evaluationDate: "2026-10-10",
      timeZone: "America/New_York",
      fixtureId: ids.fixture,
      fixtureRevision: "fixture-r1",
      fixtureAuditId: ids.audit,
    },
    lines: [
      {
        ordinal: 1,
        assemblyId: ids.a,
        componentId: id(301),
        quantity: "1",
        unit: "EA",
        unitCost: "40",
        unitPrice: "100",
        lineTotalCostMinor: "4000",
        lineTotalPriceMinor: "10000",
        source: {
          assemblyRevision: "assembly-r1",
          componentRevision: "bom-r1",
          costCodeId: id(201),
          costCodeRevision: "code-r1",
          costTypeId: ids.type,
          costTypeRevision: "type-r1",
          unitId: ids.unit,
          unitRevision: "unit-r1",
          priceId: id(401),
          priceRevision: "price-r1",
          effectiveDate: "2026-10-01",
          expirationDate: null,
          source: "synthetic_audited_fixture",
        },
      },
    ],
  });
  const audit = {
    id: id(501),
    user_id: ids.actor,
    action: "estimate_draft.create",
    table_name: "estimate_drafts",
    record_id: draft.id,
    old_values: null,
    new_values: { ...meta, draft: structuredClone(draft) },
    ip_address: null,
    user_agent: null,
    created_at: "2026-10-10T16:00:00+00:00",
  };
  const receipt = {
    ...meta,
    draftId: draft.id,
    createdAt: "2026-10-10T16:00:00.000Z",
    before: null,
    draft,
    audit,
  };
  const intent = {
    command,
    commandHash: meta.commandHash,
    binding: { id: ids.binding, actorId: ids.actor, tenantId: ids.tenant },
    clientId: ids.client,
    policyContext: calculatorSnapshot().policyContext,
  };
  return { receipt, intent };
}

describe("closed Calculator receipt content", () => {
  it("returns a detached verified receipt including complete durable audit", async () => {
    const { receipt, intent } = fixture();
    const verified = await validateCalculatorReceipt(receipt, intent);
    expect(verified).toEqual(receipt);
    expect(verified).not.toBe(receipt);
  });
  const mutations: Array<[string, (r: any) => void]> = [
    ["other binding", r => (r.bindingId = id(999))],
    ["other tenant", r => (r.tenantId = id(999))],
    ["other actor", r => (r.actorId = id(999))],
    ["other project", r => (r.projectId = id(999))],
    ["other intake", r => (r.intakeFormId = id(999))],
    ["other client", r => (r.clientId = id(999))],
    ["other request", r => (r.requestId = id(999))],
    ["other command", r => (r.commandHash = "d".repeat(64))],
    ["other source", r => (r.sourceHash = "d".repeat(64))],
    ["other calculation", r => (r.calculationHash = "d".repeat(64))],
    ["non-create operation", r => (r.operation = "calculator.calculate")],
    ["unknown version", r => (r.contractVersion = "v2")],
    ["non-null before", r => (r.before = {})],
    ["missing physical column", r => delete r.draft.notes],
    ["extra physical column", r => (r.draft.hidden_authority = true)],
    ["audit missing", r => (r.audit = null)],
    ["audit wrong actor", r => (r.audit.user_id = id(999))],
    ["audit wrong action", r => (r.audit.action = "estimate.approve")],
    ["audit wrong table", r => (r.audit.table_name = "projects")],
    ["audit wrong record", r => (r.audit.record_id = id(999))],
    ["audit wrong before", r => (r.audit.old_values = {})],
    ["audit changed row", r => (r.audit.new_values.draft.subtotal_cost = 39)],
    ["audit missing context", r => delete r.audit.new_values.tenantId],
    ["audit duplicate id as draft", r => (r.audit.id = r.draftId)],
    ["row tenant mismatch", r => (r.draft.tenant_id = id(999))],
    ["row actor mismatch", r => (r.draft.created_by = id(999))],
    ["creation already approved", r => (r.draft.approved_by = ids.actor)],
    ["creation locked", r => (r.draft.locked_at = r.createdAt)],
    ["creation historical", r => (r.draft.source = "historical_import")],
    ["invalid timestamp", r => (r.createdAt = "not-a-date")],
    ["missing receipt field", r => delete r.before],
    ["extra receipt field", r => (r.authorized = true)],
    [
      "JSON boolean replaces numeric",
      r => (r.audit.new_values.draft.version = true),
    ],
  ];
  it.each(mutations)("rejects %s before commit", async (_label, mutate) => {
    const { receipt, intent } = fixture();
    mutate(receipt);
    await expect(
      validateCalculatorReceipt(receipt, intent)
    ).rejects.toMatchObject({ code: "FINANCIAL_EXECUTOR_RECEIPT_INVALID" });
  });
  it("rejects a complete self-consistent row for another physical draft", async () => {
    const { receipt, intent } = fixture();
    receipt.draft.id = id(999);
    receipt.audit.new_values.draft.id = id(999);
    await expect(
      validateCalculatorReceipt(receipt, intent)
    ).rejects.toMatchObject({ code: "FINANCIAL_EXECUTOR_RECEIPT_INVALID" });
  });
  it.each([
    [0.01, 0.01, 0, 0],
    [60, 90, 30, 33.33],
  ])(
    "accepts physical finite decimal money and exact matching audit (%s/%s)",
    async (cost, price, profit, gp) => {
      const { receipt, intent } = fixture();
      Object.assign(receipt.draft, {
        subtotal_cost: cost,
        subtotal_price: price,
        final_total_price: price,
        gross_profit: profit,
        gross_profit_pct: gp,
      });
      receipt.audit.new_values.draft = structuredClone(receipt.draft);
      await expect(validateCalculatorReceipt(receipt, intent)).resolves.toEqual(
        receipt
      );
    }
  );
  it.each([
    "draft_data",
    "zone",
    "trade",
    "pricing_schema_version",
    "coastal_modifier",
    "discount_amount",
    "bundle_id",
  ])("rejects self-consistent alteration of intended-null %s", async key => {
    const { receipt, intent } = fixture();
    receipt.draft[key] =
      key === "coastal_modifier" || key === "discount_amount" ? 1 : "changed";
    receipt.audit.new_values.draft = structuredClone(receipt.draft);
    await expect(
      validateCalculatorReceipt(receipt, intent)
    ).rejects.toMatchObject({ code: "FINANCIAL_EXECUTOR_RECEIPT_INVALID" });
  });
  it("accepts a changed protected policy floor after a new valid confirmation", async () => {
    const { receipt, intent } = fixture();
    const pricing = receipt.draft.pricing_snapshot as any;
    pricing.policyContext.floors.effectiveFloorPct = "43";
    pricing.policyContext.tenantSettings.geoOverridePct = "43";
    receipt.draft.profit_shield_floor_pct = 43;
    intent.policyContext = structuredClone(pricing.policyContext);
    receipt.audit.new_values.draft = structuredClone(receipt.draft);
    await expect(validateCalculatorReceipt(receipt, intent)).resolves.toEqual(
      receipt
    );
  });
});
