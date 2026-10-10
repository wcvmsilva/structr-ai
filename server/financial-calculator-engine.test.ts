import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCalculatorResult, calculatorCalculateCommandSchema, calculatorCreateCommandSchema, calculatorRecoverCommandSchema, canonicalizeCalculator, hashCalculatorCanonical } from "../shared/financial-calculator-engine";
import { calculateMultipleAssemblies } from "../shared/assembly-engine";
import { transformBatchToEstimateDraft } from "../shared/estimate-engine";
import { calculatorCommand as command, calculatorSnapshot as snapshot, calculatorIds as ids, calculatorId } from "./test-support/calculator-engine-fixture";

afterEach(() => vi.unstubAllGlobals());

describe("Calculator public authority boundary", () => {
  it.each([true, Infinity, NaN, 1.5, 0, 101, "2"])("rejects quantity %j rather than coercing or truncating it", quantity => {
    expect(calculatorCalculateCommandSchema.safeParse(command([{ assemblyId: ids.a, quantity: quantity as number }])).success).toBe(false);
  });
  it("rejects empty, oversized, and duplicate selections", () => {
    for (const assemblies of [[], Array.from({ length: 26 }, (_, n) => ({ assemblyId: calculatorId(1000 + n), quantity: 1 })), [{ assemblyId: ids.a, quantity: 1 }, { assemblyId: ids.a, quantity: 2 }]]) {
      expect(calculatorCalculateCommandSchema.safeParse(command(assemblies)).success).toBe(false);
    }
  });
  it("rejects authority and price fields at both public levels", () => {
    for (const extra of [{ tenantId: ids.tenant }, { actorId: ids.actor }, { unitPrice: "1" }, { channel: "direct" }, { policyContext: {} }, { draftName: "Forged" }]) {
      expect(calculatorCalculateCommandSchema.safeParse({ ...command(), ...extra }).success).toBe(false);
      expect(calculatorCalculateCommandSchema.safeParse(command([{ assemblyId: ids.a, quantity: 1, ...extra }])).success).toBe(false);
    }
  });
  it("requires confirmation hashes and a request identity only on create", () => {
    const create = { ...command(), operation: "calculator.create", requestId: ids.request, expectedSourceHash: "a".repeat(64), expectedCalculationHash: "b".repeat(64) };
    expect(calculatorCreateCommandSchema.safeParse(create).success).toBe(true);
    expect(calculatorCalculateCommandSchema.safeParse(create).success).toBe(false);
    expect(calculatorCreateCommandSchema.safeParse({ ...create, expectedSourceHash: "invalid" }).success).toBe(false);
    const { assemblies: _, ...recovery } = command();
    expect(calculatorRecoverCommandSchema.safeParse({ ...recovery, operation: "calculator.recover", requestId: ids.request }).success).toBe(true);
    expect(calculatorRecoverCommandSchema.safeParse(create).success).toBe(false);
  });
  it("accepts the 25-selection and 100-unit boundary without reordering", () => {
    const value = command(Array.from({ length: 25 }, (_, n) => ({ assemblyId: calculatorId(2000 + n), quantity: 100 })));
    expect(calculatorCalculateCommandSchema.parse(value)).toEqual(value);
  });
});

describe("Calculator canonical assembly and estimate adaptation", () => {
  it.each([
    [ids.a, "4000", "10000", "6000", 60, "6000", "10000"],
    [ids.b, "6000", "9000", "3000", 33.33, "3000", "9000"],
    [ids.c, "1", "1", "0", 0, "0", "1"],
  ])("forms draft %s with exact cents and an unreduced exact margin fraction", async (assemblyId, cost, price, profit, displayPct, numerator, denominator) => {
    const result = await buildCalculatorResult(snapshot(), command([{ assemblyId: assemblyId as string, quantity: 1 }]));
    expect(result).toMatchObject({ authority: "draft_only", financials: { costMinor: cost, priceMinor: price, profitMinor: profit, grossProfitPct: displayPct, margin: { numerator, denominator } } });
    expect(result.draft).toMatchObject({ source: "assembly_calculator", projectId: ids.project, clientId: ids.client });
    expect(result.lines).toMatchObject([{ lineTotalCostMinor: cost, lineTotalPriceMinor: price }]);
    expect(result).not.toHaveProperty("approved");
    expect(result).not.toHaveProperty("authority.tenantId");
  });
  it("keeps below-floor B and C draft formation possible while exposing warnings", async () => {
    for (const assemblyId of [ids.b, ids.c]) {
      const result = await buildCalculatorResult(snapshot(), command([{ assemblyId, quantity: 1 }]));
      expect(result.warnings).toContain("calculator.margin_below_policy_floor");
      expect(result.draft.assemblyCount).toBe(1);
      expect(result.authority).toBe("draft_only");
    }
  });
  it("preserves selection order, quantities, price provenance, and literal extended totals", async () => {
    const result = await buildCalculatorResult(snapshot(), command([{ assemblyId: ids.c, quantity: 3 }, { assemblyId: ids.a, quantity: 2 }]));
    expect(result.financials).toMatchObject({ costMinor: "8003", priceMinor: "20003", profitMinor: "12000" });
    expect(result.draft.assemblySelections.map((v: any) => v.assemblyId)).toEqual([ids.c, ids.a]);
    expect(result.lines).toMatchObject([{ assemblyId: ids.c, quantity: "3", lineTotalCostMinor: "3", lineTotalPriceMinor: "3", source: { priceId: calculatorId(403), effectiveDate: "2026-10-01", source: "synthetic_audited_fixture" } }, { assemblyId: ids.a, quantity: "2", lineTotalCostMinor: "8000", lineTotalPriceMinor: "20000" }]);
    expect(result.provenance).toMatchObject({ evaluationDate: "2026-10-10", timeZone: "America/New_York", fixtureId: ids.fixture, fixtureAuditId: ids.audit });
  });
  it("extends the existing engine's rounded component totals instead of repricing combined quantities", async () => {
    const value = snapshot(); value.assemblies[2].components[0].quantity = "0.5";
    const result = await buildCalculatorResult(value, command([{ assemblyId: ids.c, quantity: 3 }]));
    expect(result.financials).toMatchObject({ costMinor: "3", priceMinor: "3" });
    expect(result.lines[0]).toMatchObject({ quantity: "1.5", lineTotalCostMinor: "3", lineTotalPriceMinor: "3" });
    expect(result.draft.lineItems[0]).toMatchObject({ quantity: 1.5, lineTotalCost: 0.03, lineTotalPrice: 0.03 });
  });
  it("reconciles multiple BOM rows after their individual cent rounding and selection extension", async () => {
    const value = snapshot();
    value.assemblies[2].components[0].quantity = "0.5";
    value.assemblies[2].components.push({ ...value.assemblies[2].components[0], id: calculatorId(399), sortOrder: 2 });
    const result = await buildCalculatorResult(value, command([{ assemblyId: ids.c, quantity: 3 }]));
    expect(result.financials).toMatchObject({ costMinor: "6", priceMinor: "6" });
    expect(result.lines.map(line => line.lineTotalPriceMinor)).toEqual(["3", "3"]);
    expect(result.draft.lineItems.map(line => line.quantity)).toEqual([1.5, 1.5]);
  });
  it("does not warn below the individual floor at an exact 28 percent margin", async () => {
    const value = snapshot(); value.prices[0].unitCost = "72.00";
    const result = await buildCalculatorResult(value, command());
    expect(result.warnings).not.toContain("calculator.assembly_below_warning");
    expect(result.warnings).toContain("calculator.margin_below_policy_floor");
  });
  it("extends fractional BOM quantity exactly without repricing existing rounded financials", async () => {
    const value = snapshot(); value.assemblies[0].components[0].quantity = "0.1";
    const result = await buildCalculatorResult(value, command([{ assemblyId: ids.a, quantity: 3 }]));
    expect(result.lines[0]).toMatchObject({ quantity: "0.3", lineTotalCostMinor: "1200", lineTotalPriceMinor: "3000" });
    expect(result.draft.lineItems[0]).toMatchObject({ quantity: 0.3, lineTotalCost: 12, lineTotalPrice: 30 });
  });
  it("normalizes known channel/finish/component aliases before restricting context", async () => {
    const value = snapshot(); value.context.channel = "residential"; value.context.finishLevel = "std";
    value.assemblies[0].finishLevel = "Standard"; value.assemblies[0].components[0].componentType = "Material"; value.costTypes[0].componentType = "MATERIAL";
    expect((await buildCalculatorResult(value, command())).draft).toMatchObject({ channel: "direct", finishLevel: "standard" });
  });
  it("uses the protected save clock in the draft name and metadata", async () => {
    const value = snapshot(); value.capturedAt = "2026-10-11T01:00:00.000Z";
    const result = await buildCalculatorResult(value, command());
    expect(result.draft.bundleName).toBe("Estimate Draft — 1 assemblies — 10/10/2026");
    expect(result.draft.metadata.generatedAt).toBe("2026-10-11T01:00:00.000Z");
  });
  it("keeps an explicit legacy transform clock deterministic without changing financial mapping", () => {
    const batch = calculateMultipleAssemblies([{ quantity: 1, context: { assemblyId: ids.a, assemblyName: "A", coastalModifier: "1", finishLevel: "standard", region: "charleston_sc" }, components: [{ id: calculatorId(301), componentType: "material", description: "A", quantity: "1", unit: "EA", wasteFactorPct: "0", unitCostOverride: null, priceBookItem: { id: calculatorId(401), name: "A", unitCost: "40", unitPrice: "100", wasteFactor: "1", coastalModifier: "1", itemType: "material" } }] }]);
    const result = (transformBatchToEstimateDraft as any)(batch, { region: "charleston_sc", channel: "direct", finishLevel: "standard" }, new Map(), 35, { capturedAt: "2026-10-11T01:00:00.000Z", timeZone: "America/New_York" });
    expect(result.bundleName).toBe("Estimate Draft — 1 assemblies — 10/10/2026");
    expect(result.metadata.generatedAt).toBe("2026-10-11T01:00:00.000Z");
    expect(result.subtotalCost).toBe("40.00");
  });
});

describe("Calculator protected-source rejection before legacy defaults", () => {
  const failures: Array<[string, (v: ReturnType<typeof snapshot>) => void, string]> = [
    ["missing assembly", v => { v.assemblies = []; }, "CALCULATOR_SOURCE_MISSING"],
    ["duplicate assembly", v => { v.assemblies.push(v.assemblies[0]); }, "CALCULATOR_SOURCE_DUPLICATE"],
    ["empty BOM", v => { v.assemblies[0].components = []; }, "CALCULATOR_SOURCE_MISSING"],
    ["inactive assembly", v => { v.assemblies[0].isActive = false; }, "CALCULATOR_SOURCE_INACTIVE"],
    ["inactive type", v => { v.costTypes[0].isActive = false; }, "CALCULATOR_SOURCE_INACTIVE"],
    ["inactive unit", v => { v.units[0].isActive = false; }, "CALCULATOR_SOURCE_INACTIVE"],
    ["another tenant cost code", v => { v.costCodes[0].tenantId = calculatorId(999); }, "CALCULATOR_SOURCE_TENANT_MISMATCH"],
    ["unowned cost code", v => { (v.costCodes[0] as any).tenantId = null; }, "CALCULATOR_SOURCE_TENANT_MISMATCH"],
    ["contradictory type", v => { v.costTypes[0].componentType = "labor"; }, "CALCULATOR_SOURCE_INCOMPATIBLE"],
    ["contradictory unit", v => { v.costCodes[0].defaultUnitId = calculatorId(999); }, "CALCULATOR_SOURCE_INCOMPATIBLE"],
    ["missing price", v => { v.prices = []; }, "CALCULATOR_PRICE_MISSING"],
    ["duplicate eligible price", v => { v.prices.push({ ...v.prices[0], id: calculatorId(499) }); }, "CALCULATOR_PRICE_AMBIGUOUS"],
    ["expired price", v => { v.prices[0].expirationDate = "2026-10-09"; }, "CALCULATOR_PRICE_NOT_EFFECTIVE"],
    ["future price", v => { v.prices[0].effectiveDate = "2026-10-11"; }, "CALCULATOR_PRICE_NOT_EFFECTIVE"],
    ["wrong price unit", v => { v.prices[0].unitId = calculatorId(999); }, "CALCULATOR_SOURCE_INCOMPATIBLE"],
    ["override outside manifest", v => { (v.assemblies[0].components[0] as any).unitCostOverride = "10"; }, "CALCULATOR_OVERRIDE_UNSUPPORTED"],
    ["missing audited manifest", v => { (v as any).manifest = null; }, "CALCULATOR_MANIFEST_INVALID"],
    ["unclassified source", v => { v.manifest.costTypeIds = []; }, "CALCULATOR_MANIFEST_INVALID"],
    ["unclassified assembly", v => { v.manifest.assemblyIds = []; }, "CALCULATOR_MANIFEST_INVALID"],
    ["unknown timezone", v => { v.timeZone = "Mars/Olympus"; }, "CALCULATOR_CLOCK_INVALID"],
    ["mismatched evaluation day", v => { v.evaluationDate = "2026-10-09"; }, "CALCULATOR_CLOCK_INVALID"],
    ["invalid calendar day", v => { v.evaluationDate = "2026-02-30"; }, "CALCULATOR_CLOCK_INVALID"],
    ["unknown channel", v => { v.context.channel = "insurance"; }, "CALCULATOR_CONTEXT_UNSUPPORTED"],
    ["missing dimension", v => { delete (v.context.dimensions as any).finishMultiplier; }, "CALCULATOR_CONTEXT_UNSUPPORTED"],
    ["nonunit dimension", v => { v.context.dimensions.regionalMaterialModifier = 1.1; }, "CALCULATOR_CONTEXT_UNSUPPORTED"],
    ["nonunit base quantity", v => { v.assemblies[0].baseUnitQty = "2"; }, "CALCULATOR_CONTEXT_UNSUPPORTED"],
    ["nonunit assembly waste", v => { v.assemblies[0].wasteFactor = "1.1"; }, "CALCULATOR_CONTEXT_UNSUPPORTED"],
    ["nonunit assembly coastal", v => { v.assemblies[0].coastalModifier = "1.1"; }, "CALCULATOR_CONTEXT_UNSUPPORTED"],
    ["incomplete policy", v => { (v.policyContext as any).tenantSettings = null; }, "CALCULATOR_POLICY_INVALID"],
    ["foreign policy zone", v => { v.policyContext.projectGeo.zoneTenantId = calculatorId(999); }, "CALCULATOR_POLICY_INVALID"],
    ["inactive client", v => { v.client.isActive = false; }, "CALCULATOR_SOURCE_INACTIVE"],
    ["mismatched pair", v => { v.intake.projectId = calculatorId(999); }, "CALCULATOR_IDENTITY_MISMATCH"],
  ];
  it.each(failures)("rejects %s with a discriminating error", async (_, change, code) => {
    const value = snapshot(); change(value);
    await expect(buildCalculatorResult(value, command())).rejects.toMatchObject({ code });
  });
  it.each([true, Infinity, "Infinity", "40junk", "1e2", "-1", "", "90071992547410.00"])("rejects unsafe price %j before numeric parsing", async unitCost => {
    const value = snapshot(); (value.prices[0] as any).unitCost = unitCost;
    await expect(buildCalculatorResult(value, command())).rejects.toMatchObject({ code: "CALCULATOR_NUMBER_INVALID" });
  });
  it("rejects extended totals outside safe cents even when each input is safe", async () => {
    const value = snapshot(); value.prices[0].unitCost = "900719925475.00";
    await expect(buildCalculatorResult(value, command([{ assemblyId: ids.a, quantity: 100 }]))).rejects.toMatchObject({ code: "CALCULATOR_NUMBER_INVALID" });
  });
  it("refuses enormous rates that lose a cent despite producing a safe integer", async () => {
    const value = snapshot(); value.prices[0].unitPrice = "9000000000000.01";
    await expect(buildCalculatorResult(value, command([{ assemblyId: ids.a, quantity: 10 }]))).rejects.toMatchObject({ code: "CALCULATOR_NUMBER_INVALID" });
  });
  it("enforces the supported money limit after aggregating otherwise supported rows", async () => {
    const value = snapshot(); value.prices[0].unitPrice = "600000000.00"; value.prices[1].unitPrice = "600000000.00";
    await expect(buildCalculatorResult(value, command([{ assemblyId: ids.a, quantity: 1 }, { assemblyId: ids.b, quantity: 1 }]))).rejects.toMatchObject({ code: "CALCULATOR_NUMBER_INVALID" });
  });
  it("keeps every cent at the supported amount boundary and refuses one cent beyond it", async () => {
    const value = snapshot(); value.prices[0].unitPrice = "1000000000.00";
    expect((await buildCalculatorResult(value, command())).financials.priceMinor).toBe("100000000000");
    value.prices[0].unitPrice = "1000000000.01";
    await expect(buildCalculatorResult(value, command())).rejects.toMatchObject({ code: "CALCULATOR_NUMBER_INVALID" });
  });
  it("treats the expiration day as excluded, matching the existing protected price reader", async () => {
    const value = snapshot(); value.prices[0].expirationDate = "2026-10-10";
    await expect(buildCalculatorResult(value, command())).rejects.toMatchObject({ code: "CALCULATOR_PRICE_NOT_EFFECTIVE" });
  });
  it("rejects contradictory expiration before eligibility can hide it", async () => {
    const value = snapshot(); value.prices.push({ ...value.prices[0], id: calculatorId(499), effectiveDate: "2026-10-12", expirationDate: "2026-10-11" });
    await expect(buildCalculatorResult(value, command())).rejects.toMatchObject({ code: "CALCULATOR_PRICE_NOT_EFFECTIVE" });
  });
  it("never executes a protected snapshot accessor during validation", async () => {
    const value = snapshot(); let invoked = 0;
    Object.defineProperty(value, "context", { enumerable: true, get: () => { invoked++; return { channel: "direct" }; } });
    await expect(buildCalculatorResult(value, command())).rejects.toMatchObject({ code: "CALCULATOR_SNAPSHOT_INVALID" });
    expect(invoked).toBe(0);
  });
});

describe("Calculator confirmation hashing", () => {
  it("matches an independently specified canonical JSON and SHA-256 vector", async () => {
    expect(canonicalizeCalculator({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(await hashCalculatorCanonical({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  });
  it("rejects undefined, unsafe integers, accessors, and sparse arrays instead of omitting them", () => {
    for (const value of [{ a: undefined }, { a: Number.MAX_SAFE_INTEGER + 1 }, { get a() { return 1; } }, new Array(1)]) {
      expect(() => canonicalizeCalculator(value)).toThrow(/CALCULATOR_INPUT_INVALID/);
    }
  });
  it("fails closed when WebCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    await expect(hashCalculatorCanonical({ a: 1 })).rejects.toMatchObject({ code: "CALCULATOR_CRYPTO_UNAVAILABLE" });
  });
  it("ignores only the capture clock across same-day calculations", async () => {
    const first = await buildCalculatorResult(snapshot(), command());
    const value = snapshot(); value.capturedAt = "2026-10-10T17:00:00.000Z";
    const second = await buildCalculatorResult(value, command());
    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.calculationHash).toBe(first.calculationHash);
    expect(second.draft.metadata.generatedAt).not.toBe(first.draft.metadata.generatedAt);
  });
  it.each(["price", "policy", "day", "price revision", "manifest", "geo"])("invalidates source and calculation confirmation when %s changes", async field => {
    const first = await buildCalculatorResult(snapshot(), command()); const value = snapshot();
    if (field === "price") value.prices[0].unitPrice = "101.00";
    if (field === "policy") { (value.policyContext.tenantSettings as any).geoOverridePct = "43"; value.policyContext.floors.effectiveFloorPct = "43"; }
    if (field === "day") { value.evaluationDate = "2026-10-11"; value.capturedAt = "2026-10-11T16:00:00.000Z"; }
    if (field === "price revision") value.prices[0].revision = "price-r2";
    if (field === "manifest") value.manifest.revision = "fixture-r2";
    if (field === "geo") value.policyContext.projectGeo.zoneSnapshotCapturedAt = "2026-10-02T12:00:00.000Z";
    const second = await buildCalculatorResult(value, command());
    expect(second.sourceHash).not.toBe(first.sourceHash); expect(second.calculationHash).not.toBe(first.calculationHash);
  });
  it("binds selection order and quantities into calculation confirmation", async () => {
    const first = await buildCalculatorResult(snapshot(), command([{ assemblyId: ids.a, quantity: 1 }, { assemblyId: ids.c, quantity: 1 }]));
    const second = await buildCalculatorResult(snapshot(), command([{ assemblyId: ids.c, quantity: 1 }, { assemblyId: ids.a, quantity: 1 }]));
    const third = await buildCalculatorResult(snapshot(), command([{ assemblyId: ids.a, quantity: 2 }, { assemblyId: ids.c, quantity: 1 }]));
    expect(second.calculationHash).not.toBe(first.calculationHash); expect(third.calculationHash).not.toBe(first.calculationHash);
  });
});
