import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assemblies, assemblyItems, costCodes, costCodePricingHistory, costTypes, units, tenants, tenantSettings } from "../drizzle/schema";
import { calculateAssemblyCost, type AssemblyComponentInput } from "../shared/assembly-engine";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./audit", () => ({ logAudit: vi.fn(async () => null) }));
import { cloneAssembly, getAssemblyById, getComponentsForAssembly } from "./assembly-db";
import { assemblyRouter } from "./assembly-router";

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let rows: Map<unknown, any[]>;
let db: any;
let tx: any;
let reads: Array<{ table: unknown; insideTransaction: boolean }>;

function component() { return rows.get(assemblyItems)![0]; }
function pricing() { return rows.get(costCodePricingHistory)![0]; }
function builder(inTransaction: boolean) {
  let table: unknown;
  const query: any = {
    from(value: unknown) { table = value; return query; },
    where() { return query; }, orderBy() { return query; }, limit() { return query; },
    then(resolve: (value: any) => void, reject: (error: unknown) => void) {
      reads.push({ table, insideTransaction: inTransaction });
      return Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
    },
  };
  return query;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T01:00:00Z"));
  reads = [];
  rows = new Map<unknown, any[]>([
    [assemblies, [{ id: id(1), tenantId: id(2), name: "Synthetic assembly", isActive: true, coastalModifier: null }]],
    [assemblyItems, [{ id: id(3), assemblyId: id(1), costCodeId: id(4), costTypeId: id(5), unitId: id(6), description: "Synthetic component", defaultQtyPerUnit: "2.500", wasteFactor: "0", priceBookItem: id(99), componentType: "material", unitCostOverride: null, isOptional: false, sortOrder: 0 }]],
    [costCodes, [{ id: id(4), tenantId: id(2), code: "SYNTHETIC-001", name: "Synthetic material", isActive: true }]],
    [costTypes, [{ id: id(5), name: "material", isActive: true }]],
    [units, [{ id: id(6), name: "Linear feet", abbreviation: "LF", isActive: true }]],
    [costCodePricingHistory, [{ id: id(7), costCodeId: id(4), unitId: id(6), unitCost: "4.00", unitPrice: "8.00", effectiveDate: "2026-09-01", expirationDate: null, isActive: true, taxable: false }]],
    [tenants, [{ id: id(2), timezone: "America/New_York", isActive: true }]],
    [tenantSettings, [{ tenantId: id(2), timezone: "America/New_York" }]],
  ]);
  tx = { select: vi.fn(() => builder(true)) };
  db = { select: vi.fn(() => builder(false)), transaction: vi.fn(async (fn: any) => fn(tx)) };
  mocks.getDb.mockResolvedValue(db);
});
afterEach(() => vi.useRealTimers());

describe("assembly component pricing adapter", () => {
  it("preserves raw component fields and cost code while adding real quantity, unit, type and unique price", async () => {
    const [result] = await getComponentsForAssembly(id(1));
    expect(result).toMatchObject({ id: id(3), defaultQtyPerUnit: "2.500", quantity: "2.500", unitId: id(6), unit: "LF", costTypeId: id(5), costType: { id: id(5), name: "material" }, costCode: { id: id(4) }, wasteFactor: "0", priceBookItemReference: id(99), pricingRecordId: id(7), priceBookItem: { id: id(4), name: "Synthetic material", unitCost: "4.00", unitPrice: "8.00" } });
    expect(component().priceBookItem).toBe(id(99));
  });
  it("feeds the actual engine without dropping the component or inventing zero quantity/prices", async () => {
    const components = await getComponentsForAssembly(id(1));
    const inputs = components.map((value: any) => ({ ...value, wasteFactorPct: value.wasteFactor })) as AssemblyComponentInput[];
    const result = calculateAssemblyCost(inputs, { assemblyId: id(1), assemblyName: "Synthetic", coastalModifier: null, finishLevel: null, region: null });
    expect(result).toMatchObject({ totalDirectCost: 10, totalSellPrice: 20, componentCount: 1, warnings: [] });
    expect(result.pricedComponents[0]).toMatchObject({ quantity: 2.5, unit: "LF", priceBookItemId: id(4) });
  });
  it("returns the enriched contract through the existing getAssemblyById API", async () => {
    expect(await getAssemblyById(id(1), { requirePricing: true })).toMatchObject({ id: id(1), components: [{ quantity: "2.500", priceBookItem: { id: id(4) } }] });
  });
  it("preserves the textual cost code separately from the logical UUID and pricing record", async () => {
    rows.get(costCodes)![0].code = "0042-KEEP";
    const [result] = await getComponentsForAssembly(id(1));
    expect(result).toMatchObject({ priceBookItem: { id: id(4), code: "0042-KEEP" }, pricingRecordId: id(7) });
  });
  it("keeps the cost code through the actual single-calculation endpoint without repricing", async () => {
    const caller = assemblyRouter.createCaller({ user: { id: id(20), role: "admin" }, tenantId: id(2), req: {}, res: {} } as any);
    const result = await caller.calculateCost({ assemblyId: id(1) });
    expect(result).toMatchObject({ totalDirectCost: 10, totalSellPrice: 20 });
    expect(result.pricedComponents[0]).toMatchObject({ costCode: "SYNTHETIC-001", priceBookItemId: id(4) });
  });
  it("keeps the cost code through the actual batch-calculation endpoint without repricing", async () => {
    const caller = assemblyRouter.createCaller({ user: { id: id(20), role: "admin" }, tenantId: id(2), req: {}, res: {} } as any);
    const result = await caller.calculateBatch({ assemblies: [{ assemblyId: id(1), quantity: 2 }] });
    expect(result.assemblies[0]).toMatchObject({ totalDirectCost: 10, totalSellPrice: 20, extendedCost: 20, extendedPrice: 40 });
    expect(result.assemblies[0].pricedComponents[0]).toMatchObject({ costCode: "SYNTHETIC-001", priceBookItemId: id(4) });
  });
  it("requires resolved pricing at the actual assembly calculateCost endpoint", async () => {
    rows.set(costCodePricingHistory, []);
    const caller = assemblyRouter.createCaller({ user: { id: id(20), role: "admin" }, tenantId: id(2), req: {}, res: {} } as any);
    await expect(caller.calculateCost({ assemblyId: id(1) })).rejects.toThrow(/pricing/i);
  });
  it("keeps default raw details readable for CRUD without introducing a price or ownership decision", async () => {
    rows.get(assemblies)![0].tenantId = null; rows.get(costCodes)![0].tenantId = null; rows.set(costCodePricingHistory, []);
    const detail = await getAssemblyById(id(1));
    expect(detail?.components[0]).toMatchObject({ defaultQtyPerUnit: "2.500", priceBookItem: id(99), costCode: { id: id(4) } });
    expect(detail?.components[0]).not.toHaveProperty("pricingRecordId");
    expect(reads.some(read => read.table === costCodePricingHistory)).toBe(false);
  });
  it("keeps clone reads raw and does not add a post-commit pricing failure or ownership assignment", async () => {
    rows.get(assemblies)![0].tenantId = null; rows.get(costCodes)![0].tenantId = null; rows.set(costCodePricingHistory, []);
    let insertedAssembly: any;
    tx.insert = vi.fn((table: unknown) => ({ values: (value: any) => {
      if (table === assemblies) {
        insertedAssembly = { ...value, id: id(50), tenantId: null };
        rows.set(assemblies, [insertedAssembly]);
        return { returning: async () => [insertedAssembly] };
      }
      if (table === assemblyItems) rows.set(assemblyItems, value.map((row: any) => ({ ...row, id: id(51), priceBookItem: null, componentType: null, unitCostOverride: null })));
      return Promise.resolve();
    } }));
    await expect(cloneAssembly(id(1))).resolves.toMatchObject({ id: id(50), name: "Synthetic assembly (Copy)" });
    expect(insertedAssembly).toMatchObject({ tenantId: null });
    expect(reads.some(read => read.table === costCodePricingHistory)).toBe(false);
  });
  it("keeps all component graph reads in one transaction and batches repeated references", async () => {
    rows.get(assemblyItems)!.push({ ...component(), id: id(8), sortOrder: 1 });
    expect(await getComponentsForAssembly(id(1))).toHaveLength(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(reads.every(read => read.insideTransaction)).toBe(true);
    for (const table of [costCodes, units, costTypes, costCodePricingHistory]) expect(reads.filter(read => read.table === table)).toHaveLength(1);
  });
  it("preserves the joined unit name when no abbreviation is present", async () => {
    rows.get(units)![0].abbreviation = null;
    expect((await getComponentsForAssembly(id(1)))[0]).toMatchObject({ unit: "Linear feet" });
  });
  it("preserves an explicit canonical component type before considering its cost-type name", async () => {
    component().componentType = "labor";
    expect((await getComponentsForAssembly(id(1)))[0].componentType).toBe("labor");
  });
  it.each(["material", "labor", "subcontract", "equipment", "permit", "admin"])("resolves a NULL type only from the exact known cost-type name %s", async name => {
    component().componentType = null; rows.get(costTypes)![0].name = name.toUpperCase();
    expect((await getComponentsForAssembly(id(1)))[0].componentType).toBe(name);
  });
  it("rejects an unknown cost-type name instead of silently classifying as material", async () => {
    component().componentType = null; rows.get(costTypes)![0].name = "Unclassified";
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/component type/i);
  });
  it("rejects an invalid non-null component type instead of hiding it with a cost-type fallback", async () => {
    component().componentType = "unknown";
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/component type/i);
  });
  it.each([costCodes, units, costTypes])("rejects a missing referenced catalog row", async table => {
    rows.set(table, []);
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/component|catalog/i);
  });
  it("rejects a cost code belonging to another tenant", async () => {
    rows.get(costCodes)![0].tenantId = id(10);
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/tenant|ownership/i);
  });
  it("does not treat a NULL cost-code tenant as canonical for a tenant-owned assembly", async () => {
    rows.get(costCodes)![0].tenantId = null;
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/tenant|ownership/i);
  });
  it("never uses a scalar legacy priceBookItem reference as a substitute for price history", async () => {
    rows.set(costCodePricingHistory, []);
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/pricing/i);
  });
  it("requires the exact unit rather than accepting a different unit or NULL", async () => {
    pricing().unitId = null;
    rows.get(costCodePricingHistory)!.push({ ...pricing(), id: id(11), unitId: id(12) });
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/pricing/i);
  });
  it("rejects overlapping eligible price records rather than picking whichever row is first", async () => {
    rows.get(costCodePricingHistory)!.push({ ...pricing(), id: id(11), unitCost: "99.00" });
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/ambiguous/i);
  });
  it("excludes inactive history without manufacturing an engine override price", async () => {
    pricing().isActive = false; component().unitCostOverride = "3.00";
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/pricing/i);
  });
  it("rejects missing sell price even with a persisted cost override", async () => {
    pricing().unitPrice = null; component().unitCostOverride = "3.00";
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/pricing|unit price/i);
  });
  it.each(["-1", "NaN", "Infinity", "1oops", "", "0x10"])("rejects invalid financial values: %s", async value => {
    pricing().unitPrice = value;
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/pricing|unit price/i);
  });
  it("preserves explicit zero cost and price as data instead of replacing either", async () => {
    pricing().unitCost = "0.00"; pricing().unitPrice = "0.00";
    expect((await getComponentsForAssembly(id(1)))[0]).toMatchObject({ priceBookItem: { unitCost: "0.00", unitPrice: "0.00" } });
  });
  it("does not alter the existing waste value or explicit unit-cost override", async () => {
    component().wasteFactor = "12.50"; component().unitCostOverride = "3.25";
    expect((await getComponentsForAssembly(id(1)))[0]).toMatchObject({ wasteFactor: "12.50", unitCostOverride: "3.25", priceBookItem: { unitCost: "4.00", unitPrice: "8.00" } });
  });
  it("uses the tenant's calendar and does not activate tomorrow's record at UTC midnight", async () => {
    pricing().effectiveDate = "2026-09-19";
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/pricing/i);
  });
  it("refuses pricing a legacy assembly without an authoritative tenant/calendar", async () => {
    rows.get(assemblies)![0].tenantId = null; rows.get(costCodes)![0].tenantId = null;
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/tenant|calendar|timezone/i);
  });
  it.each(["", "Invalid/Timezone", null])("refuses an invalid tenant timezone: %s", async timezone => {
    rows.get(tenants)![0].timezone = timezone;
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/timezone|calendar/i);
  });
  it("refuses a disagreement between tenant timezone and the existing settings row", async () => {
    rows.get(tenantSettings)![0].timezone = "UTC";
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/timezone|calendar/i);
  });
  it("does not infer a tenant record from the assembly stamp alone", async () => {
    rows.set(tenants, []);
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/tenant|calendar|timezone/i);
  });
  it("uses the authoritative tenant timezone when no secondary settings row exists", async () => {
    rows.set(tenantSettings, []);
    expect((await getComponentsForAssembly(id(1)))[0]).toMatchObject({ pricingEvaluationDate: "2026-09-18" });
  });
  it("treats expirationDate as exclusive and accepts the active adjacent interval only", async () => {
    const current = { ...pricing(), id: id(11), effectiveDate: "2026-09-18", expirationDate: null, unitPrice: "10.00" };
    pricing().expirationDate = "2026-09-18"; rows.get(costCodePricingHistory)!.push(current);
    expect((await getComponentsForAssembly(id(1)))[0]).toMatchObject({ pricingRecordId: id(11), priceBookItem: { unitPrice: "10.00" } });
  });
  it("does not choose the first record when two eligible intervals have the same prices", async () => {
    rows.get(costCodePricingHistory)!.push({ ...pricing(), id: id(11) });
    await expect(getComponentsForAssembly(id(1))).rejects.toThrow(/ambiguous/i);
  });
  it("keeps an empty BOM empty without synthesizing a component or price", async () => {
    rows.set(assemblyItems, []);
    expect(await getComponentsForAssembly(id(1))).toEqual([]);
  });
});
