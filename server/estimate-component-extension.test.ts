import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ drizzle: vi.fn(), insert: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: io.drizzle }));
import { calculateMultipleAssemblies, type AssemblyComponentInput } from "../shared/assembly-engine";
import { transformBatchToEstimateDraft } from "../shared/estimate-engine";
import { budgetLinesFromEstimateLineItems } from "../shared/actuals-variance-engine";
import { reconcileExport } from "../shared/jobtread-reconciliation";
import { auditLogs, projects, tenants, profiles, clients, type EstimateDraftLineItem } from "../drizzle/schema";
vi.mock("./project-access", () => ({ requireProjectAccess: vi.fn(async () => undefined) }));
import { createEstimateDraft } from "./db";

const ID = "ba100000-0000-4000-8000-000000000001";
// This suite isolates pricing persistence; transactional access semantics have their own behavior suite.
function selectContext() {
 return { from: (table: unknown) => {
  const data = table === projects ? [{ id: ID, tenantId: ID, clientId: ID, deletedAt: null }]
   : table === tenants ? [{ id: ID, isActive: true }]
   : table === profiles ? [{ id: ID, tenantId: ID, isActive: true }]
   : table === clients ? [{ id: ID, tenantId: ID, isActive: true, deletedAt: null }] : [];
  const query: any = { where: () => query, limit: () => query, for: () => query,
   then: (yes: any, no: any) => Promise.resolve(data).then(yes, no) };
  return query;
 } };
}
const CODE = "FLOW-SYN-01";
function component(overrides: Partial<AssemblyComponentInput> = {}): AssemblyComponentInput {
  return { id: ID, componentType: "material", description: "Synthetic component", quantity: "2.5", unit: "LF", wasteFactorPct: null, unitCostOverride: null,
    priceBookItem: { id: ID, code: CODE, name: "Synthetic source", unitCost: "4.00", unitPrice: "8.00", wasteFactor: null, coastalModifier: null, itemType: "material" }, ...overrides };
}
const context = { region: "synthetic", channel: "direct" as const, finishLevel: "standard" as const, projectId: ID, clientId: ID };
function batch(quantity = 2, components = [component()]) {
  return calculateMultipleAssemblies([{ components, quantity, context: { assemblyId: ID, assemblyName: "Synthetic assembly", coastalModifier: null, finishLevel: null, region: null } }]);
}
function csvReconciliation(payload: ReturnType<typeof transformBatchToEstimateDraft>) {
  return reconcileExport({ approvedTotal: payload.finalTotalPrice, rows: payload.lineItems.map(line => ({ "Cost Group Name": line.costGroupName, "Cost Item Name": line.costItemName, Quantity: String(line.quantity), "Unit Price": String(line.unitPriceSnapshot) })) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://fixture:fixture@127.0.0.1:1/synthetic");
  io.insert.mockImplementation((row: any) => ({ returning: async () => [{ id: ID, ...row }] }));
  io.audit.mockImplementation((row: any) => ({ returning: async () => [{ id: ID, ...row }] }));
  const tx = { select: selectContext, insert: (table: unknown) => ({ values: table === auditLogs ? io.audit : io.insert }) };
  io.transaction.mockImplementation((work: any) => work(tx));
  io.drizzle.mockReturnValue({ ...tx, transaction: io.transaction });
});
afterEach(() => vi.unstubAllEnvs());

describe("component quantity and cost-code continuity", () => {
  it.each([1, 2, 3])("extends component quantity and priced totals for %s assembly units", quantity => {
    const calculated = batch(quantity); const before = structuredClone(calculated);
    const payload = transformBatchToEstimateDraft(calculated, context, new Map());
    expect(payload.lineItems).toHaveLength(1);
    expect(payload.lineItems[0]).toMatchObject({ quantity: 2.5 * quantity, costCode: CODE, unitCostSnapshot: 4, unitPriceSnapshot: 8, lineTotalCost: 10 * quantity, lineTotalPrice: 20 * quantity, grossProfitPct: 50, meetsMinGP: true });
    expect(payload.assemblySelections[0]).toMatchObject({ quantity, extendedCost: 10 * quantity, extendedPrice: 20 * quantity, grossProfitPct: 50, meetsMinGP: true });
    expect(payload.subtotalCost).toBe(calculated.totalCost.toFixed(2));
    expect(payload.finalTotalPrice).toBe(calculated.totalPrice.toFixed(2));
    expect(calculated).toEqual(before);
    expect(csvReconciliation(payload)).toMatchObject({ status: "reconciled", differenceCents: 0 });
  });
  it("preserves the actual textual code on the priced component", () => {
    expect(batch().assemblies[0].pricedComponents[0]).toMatchObject({ costCode: CODE, priceBookItemId: ID });
  });
  it("does not turn a missing textual code into a UUID or component description", () => {
    const source = component(); delete source.priceBookItem!.code;
    const payload = transformBatchToEstimateDraft(batch(2, [source]), context, new Map());
    expect(payload.lineItems[0].costCode).toBeNull();
    expect(payload.lineItems[0].costCode).not.toBe(ID);
  });
  it("persists extended quantities and the exact code so actual-cost budget reconciles to the same batch", async () => {
    const calculated = batch();
    const priced = transformBatchToEstimateDraft(calculated, context, new Map());
    const result = await createEstimateDraft({ tenantId: ID, projectId: ID, scopeDraftId: ID, createdBy: ID, source: "scope_draft", priced });
    const lines = result.lineItems as EstimateDraftLineItem[];
    expect(lines[0]).toMatchObject({ quantity: 5, costCode: CODE, lineTotalCost: 20, lineTotalPrice: 40 });
    expect(budgetLinesFromEstimateLineItems(lines, { basis: "cost" })).toEqual([{ costCode: CODE, costCodeName: "Synthetic component", estimatedCents: 2000, fromChangeOrder: false }]);
    expect(result).toMatchObject({ subtotalCost: "20.00", subtotalPrice: "40.00", finalTotalPrice: "40.00", projectId: ID, clientId: ID, tenantId: ID });
    expect(io.audit).toHaveBeenCalled();
  });
  it("retains upstream per-assembly cent rounding for costs and blocks an unrepresentable CSV total", () => {
    const source = component({ quantity: "0.5" });
    source.priceBookItem = { ...source.priceBookItem!, unitCost: "0.01", unitPrice: "0.03" };
    const calculated = batch(2, [source]);
    expect(calculated).toMatchObject({ totalCost: 0.02, totalPrice: 0.04 });
    const payload = transformBatchToEstimateDraft(calculated, context, new Map());
    expect(payload.lineItems[0]).toMatchObject({ quantity: 1, lineTotalCost: 0.02, lineTotalPrice: 0.04, unitCostSnapshot: 0.01, unitPriceSnapshot: 0.03 });
    expect(budgetLinesFromEstimateLineItems(payload.lineItems, { basis: "cost" })[0].estimatedCents).toBe(2);
    expect(csvReconciliation(payload)).toMatchObject({ status: "blocked_reconciliation", approvedTotalCents: 4, exportedTotalCents: 3, differenceCents: -1 });
  });
});
