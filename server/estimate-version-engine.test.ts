import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeEstimateVersionPreviewCommand, normalizeEstimateCreateVersionCommand,
  normalizeEstimateVersionCopySourceV2, hashEstimateVersionCopySourceV2,
  hashEstimateVersionCommandV2, buildEstimateVersionPreviewV2,
  projectEstimateVersionDraftV2, estimateVersionCopySourceV2Schema,
  estimateCreateVersionCommandV2Schema, estimateVersionPreviewCommandV2Schema,
} from "../shared/estimate-version-engine";
import {
  hashInternalApprovalContent, hashInternalApprovalPolicy, hashInternalApprovalCommand,
  internalApprovalSnapshotSchema,
} from "../shared/internal-estimate-approval-engine";
import { approvalIds as ids, makeInternalApprovalSnapshot as snapshot } from "./internal-estimate-approval-engine.fixtures";

afterEach(() => vi.unstubAllGlobals());
const childId = "a2000000-0000-4000-8000-000000000001";
const timestamp = "2026-09-20T12:00:00.123Z";
const context = () => ({ tenantId: ids.tenant, actorId: ids.actor, projectId: ids.project, clientId: ids.client });
const allocation = () => ({ id: childId, version: 2, timestamp });
function copy() {
  const value = snapshot();
  return { ...value, version: "estimate-version-copy-source-v2", financials: { ...value.financials, currencyBasis: "version_request_confirmation" }, copyProjection: { assemblyCount: null as number | null, directZone: null as string | null } };
}
function previewCommand(sourceKind: "current_draft" | "recorded_a1" = "current_draft") {
  return { version: "estimate-version-preview-command-v2", sourceKind, sourceDraftId: ids.draft, confirmedCurrencyCode: sourceKind === "current_draft" ? "USD" : null };
}
function command(sourceKind: "current_draft" | "recorded_a1" = "current_draft", sourceContentHash = "a".repeat(64)) {
  return { version: "estimate-version-command-v2", sourceKind, sourceDraftId: ids.draft, requestId: ids.request, expectedSourceVersion: 1, expectedSourceContentHash: sourceContentHash, confirmedCurrencyCode: sourceKind === "current_draft" ? "USD" : null, name: null as string | null, reason: "Synthetic version review" };
}
async function draftPreview(content = copy()) {
  return buildEstimateVersionPreviewV2({ command: previewCommand(), content, sourceApprovalId: null, sourceApprovalState: null });
}
async function recordedPreview(content = snapshot(), state: "active" | "revoked" = "active") {
  return buildEstimateVersionPreviewV2({ command: previewCommand("recorded_a1"), content, sourceApprovalId: ids.approval, sourceApprovalState: state });
}
async function projected(content = copy()) {
  const preview = await draftPreview(content);
  return projectEstimateVersionDraftV2({ preview, command: command("current_draft", preview.sourceContentHash), context: context(), allocation: allocation() });
}

describe("published Core hashes frozen before version v2 refactor", () => {
  // Captured from base e5cb0e92, independently matched using Node SHA256 and
  // ordinal-key canonical JSON before any Core changes (private baseline log).
  it("preserves the original snapshot golden bytes", async () => expect(await hashInternalApprovalContent(snapshot())).toBe("cee45d47bc3b31995b5db06e3edbe099773bafee04d9eb7d22e81bc6641440ac"));
  it("preserves the original policy golden bytes", async () => expect(await hashInternalApprovalPolicy(snapshot().commercialContext.policyContext)).toBe("337d615c414a74bc98e965d6671fe68abfbb1f1bf94db436f7be53cf1ebbe405"));
  it.each([
    ["approve", { id: ids.draft, requestId: ids.request, expectedDraftVersion: 1, expectedContentHash: "a".repeat(64), expectedPolicyHash: "b".repeat(64), confirmedCurrencyCode: "USD", reason: "Synthetic internal review" }, "2f5d8d3778a8b209c76dfff15f86fe998e41bf6b4e11e3a34e3ebe19b44daab1"],
    ["revoke", { id: ids.draft, approvalId: ids.approval, requestId: ids.request, expectedContentHash: "a".repeat(64), reason: "Synthetic revoke review" }, "b71ec0a7e76376e165e9145b6ecfe9bac43b208cdf6ed02c16f41390d570bc55"],
    ["create_version", { sourceDraftId: ids.draft, requestId: ids.request, expectedSourceVersion: 1, expectedSourceContentHash: "a".repeat(64), name: null, reason: "Synthetic version review" }, "6195207c8e2f692e0b2ad095767e7a5508f1ca76faa062361adee9df99332c77"],
  ] as const)("preserves %s command golden bytes", async (operation, legacyCommand, expected) => {
    expect(await hashInternalApprovalCommand({ operation, context: context(), command: legacyCommand })).toBe(expected);
  });
});

describe("closed version commands without approval authority", () => {
  it.each(["current_draft", "recorded_a1"] as const)("accepts explicit %s preview/copy currency semantics", kind => {
    expect(normalizeEstimateVersionPreviewCommand(previewCommand(kind))).toEqual(previewCommand(kind));
    expect(normalizeEstimateCreateVersionCommand(command(kind))).toEqual(command(kind));
  });
  it("normalizes omitted name to the same explicit null command and hash", async () => {
    const { name: _name, ...omitted } = command();
    expect(normalizeEstimateCreateVersionCommand(omitted)).toEqual(command());
    expect(await hashEstimateVersionCommandV2({ context: context(), command: omitted })).toBe(await hashEstimateVersionCommandV2({ context: context(), command: command() }));
  });
  it("normalizes Unicode labels and LF without weakening reason limits", () => {
    expect(normalizeEstimateCreateVersionCommand({ ...command(), name: "  Café 🧱  ", reason: "  Synthetic\r\nversion review  " })).toMatchObject({ name: "Café 🧱", reason: "Synthetic\nversion review" });
    expect(() => normalizeEstimateCreateVersionCommand({ ...command(), name: " " })).toThrow();
    expect(() => normalizeEstimateCreateVersionCommand({ ...command(), reason: "short" })).toThrow();
  });
  it.each([
    { sourceKind: "current_draft", confirmedCurrencyCode: null },
    { sourceKind: "recorded_a1", confirmedCurrencyCode: "USD" },
    { sourceKind: "current_draft", confirmedCurrencyCode: "BRL" },
    { sourceKind: "legacy_approved", confirmedCurrencyCode: null },
  ])("rejects a contradictory branch/currency pair %#", fields => {
    expect(() => normalizeEstimateVersionPreviewCommand({ ...previewCommand(), ...fields })).toThrow();
    expect(() => normalizeEstimateCreateVersionCommand({ ...command(), ...fields })).toThrow();
  });
  it.each([
    { sourceDraftId: "00000000-0000-0000-0000-000000000000" },
    { sourceDraftId: ids.draft.toUpperCase() },
    { expectedSourceVersion: 0 }, { expectedSourceVersion: 2147483648 },
    { expectedSourceContentHash: "G".repeat(64) }, { approvedBy: ids.actor },
    { confirmedCurrencyCode: undefined },
  ])("rejects invalid command or unexpected authority %#", fields => {
    expect(() => normalizeEstimateCreateVersionCommand({ ...command(), ...fields })).toThrow();
  });
  it("keeps request hash independent of future allocation and distinct from Core v1", async () => {
    const value = { context: context(), command: command() };
    const first = await hashEstimateVersionCommandV2(value);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe("6195207c8e2f692e0b2ad095767e7a5508f1ca76faa062361adee9df99332c77");
    expect(await hashEstimateVersionCommandV2({ ...value, context: { ...context(), actorId: ids.approval } })).not.toBe(first);
    await expect(hashEstimateVersionCommandV2({ ...value, now: timestamp })).rejects.toThrow();
  });
});

describe("v2 copied content retains Core grammar and reconciliations", () => {
  it("uses copy confirmation directly and is not a valid approval snapshot", () => {
    const result = normalizeEstimateVersionCopySourceV2(copy());
    expect(result.financials.currencyBasis).toBe("version_request_confirmation");
    expect(internalApprovalSnapshotSchema.safeParse(result).success).toBe(false);
    expect(() => normalizeEstimateVersionCopySourceV2(snapshot())).toThrow();
  });
  it("allows a known below-floor margin for correction without granting approval", async () => {
    const value = copy(); value.financials.estimatedCostMinor = "9900"; value.lines[0].lineTotalCostMinor = "9900";
    const preview = await draftPreview(value);
    expect(preview.content.financials.estimatedCostMinor).toBe("9900");
    expect(preview).toMatchObject({ sourceApprovalId: null, sourceApprovalState: null });
    expect(Object.keys(preview)).not.toContain("evaluation");
  });
  it.each([
    (x: ReturnType<typeof copy>) => { x.financials.currencyBasis = "approver_confirmation"; },
    (x: ReturnType<typeof copy>) => { x.financials.finalPriceMinor = "0"; x.financials.discountMinor = "10000"; x.financials.discountApplied = true; },
    (x: ReturnType<typeof copy>) => { x.lines[0].lineTotalPriceMinor = "9999"; },
    (x: ReturnType<typeof copy>) => { x.copyProjection.assemblyCount = 2; },
    (x: ReturnType<typeof copy>) => { x.copyProjection.directZone = "Foreign unresolved zone"; },
    (x: ReturnType<typeof copy>) => { x.origin.source = "historical_reference"; },
    (x: ReturnType<typeof copy>) => { x.origin.source = "version"; },
    (x: ReturnType<typeof copy>) => { x.commercialContext.policyContext.projectGeo.zoneTenantId = ids.client; },
    (x: ReturnType<typeof copy>) => { x.commercialContext.policyContext.projectGeo.geocodeConfidence = "low"; },
    (x: ReturnType<typeof copy>) => { Object.assign(x.commercialContext.pricingContext, { storedCommercialChannel: "trade" }); },
  ])("fails closed on unresolved content or policy %#", change => {
    const value = copy(); change(value);
    expect(estimateVersionCopySourceV2Schema.safeParse(value).success).toBe(false);
    expect(() => normalizeEstimateVersionCopySourceV2(value)).toThrow();
  });
  it("rejects custom prototypes, accessors, sparse arrays and Array subclasses in public schemas", () => {
    const getter = vi.fn(() => "USD");
    const withGetter = copy(); Object.defineProperty(withGetter.financials, "currencyCode", { get: getter, enumerable: true });
    const withPrototype = Object.assign(Object.create({ inherited: true }), copy());
    const sparse = copy(); sparse.lines.length = 2;
    class CustomArray extends Array<unknown> {
      constructor(items: unknown[]) { super(); this.push(...items); }
    }
    const subclass = { ...copy(), lines: new CustomArray(copy().lines) };
    for (const value of [withGetter, withPrototype, sparse, subclass]) expect(estimateVersionCopySourceV2Schema.safeParse(value).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(estimateCreateVersionCommandV2Schema.safeParse(Object.assign(Object.create({}), command())).success).toBe(false);
    expect(estimateVersionPreviewCommandV2Schema.safeParse(Object.assign(Object.create({}), previewCommand())).success).toBe(false);
  });
  it("binds null/presence of count and direct zone to the copy hash", async () => {
    const first = copy(), second = copy(); second.copyProjection.assemblyCount = 1;
    expect(await hashEstimateVersionCopySourceV2(first)).not.toBe(await hashEstimateVersionCopySourceV2(second));
    Object.assign(first.commercialContext.pricingContext, { zone: "Synthetic coastal zone" });
    Object.assign(second.commercialContext.pricingContext, { zone: "Synthetic coastal zone" });
    second.copyProjection.assemblyCount = null; second.copyProjection.directZone = "Synthetic coastal zone";
    expect(await hashEstimateVersionCopySourceV2(first)).not.toBe(await hashEstimateVersionCopySourceV2(second));
  });
  it("normalizes text before hash and keeps key ordering irrelevant", async () => {
    const first = copy(); first.presentation.reviewedNotes = "a\r\nb";
    const second = copy(); second.presentation.reviewedNotes = "a\nb";
    const reordered = Object.fromEntries(Object.entries(second).reverse());
    expect(await hashEstimateVersionCopySourceV2(first)).toBe(await hashEstimateVersionCopySourceV2(reordered));
  });
  it("keeps current policy in the copy hash without importing a decision", async () => {
    const first = copy(), second = copy();
    Object.assign(second.commercialContext.policyContext.tenantSettings, { settingsId: ids.settings, settingsUpdatedAt: "2026-09-20T12:00:00.000Z", channelOverridePct: "43", geoOverridePct: null });
    second.commercialContext.policyContext.floors.effectiveFloorPct = "43";
    expect(await hashEstimateVersionCopySourceV2(second)).not.toBe(await hashEstimateVersionCopySourceV2(first));
  });
  it("fails closed without browser-compatible SHA256", async () => {
    vi.stubGlobal("crypto", undefined);
    await expect(hashEstimateVersionCopySourceV2(copy())).rejects.toThrow(/CRYPTO_UNAVAILABLE/);
  });
});

describe("preview and the explicit 54-column projection", () => {
  it("builds a copy preview without an approval claim", async () => {
    const result = await draftPreview();
    expect(result).toEqual({ version: "estimate-version-preview-v2", sourceKind: "current_draft", sourceDraftId: ids.draft, sourceVersion: 1, sourceContentHash: await hashEstimateVersionCopySourceV2(copy()), sourceApprovalId: null, sourceApprovalState: null, confirmedCurrencyCode: "USD", content: normalizeEstimateVersionCopySourceV2(copy()) });
  });
  it.each(["active", "revoked"] as const)("keeps recorded %s evidence and its original content hash", async state => {
    const result = await recordedPreview(snapshot(), state);
    expect(result).toMatchObject({ sourceKind: "recorded_a1", sourceApprovalId: ids.approval, sourceApprovalState: state, confirmedCurrencyCode: null, sourceContentHash: "cee45d47bc3b31995b5db06e3edbe099773bafee04d9eb7d22e81bc6641440ac" });
    expect(result.content).toEqual(snapshot());
  });
  it.each([
    { sourceApprovalId: ids.approval }, { sourceApprovalState: "active" },
  ])("rejects authority claims on a draft preview %#", extras => {
    return expect(buildEstimateVersionPreviewV2({ command: previewCommand(), content: copy(), sourceApprovalId: null, sourceApprovalState: null, ...extras })).rejects.toThrow();
  });
  it("projects every stored column and removes all inherited authority", async () => {
    const value = await projected();
    expect(Object.keys(value).sort()).toEqual([
      "id", "tenantId", "estimateId", "projectId", "status", "source", "draftData", "bundleName", "zone", "finishLevel", "trade", "pricingSchemaVersion", "channel", "region", "createdBy", "coastalModifier", "subtotalPrice", "subtotalCost", "finalTotalPrice", "discountApplied", "discountAmount", "grossProfit", "grossProfitPct", "profitShieldPassed", "profitShieldMinPct", "assemblySelections", "lineItems", "intakeFormId", "warningsJson", "scopeDraftId", "notes", "metadata", "bundleId", "clientId", "assemblyCount", "approvedBy", "approvedAt", "rejectedBy", "rejectedAt", "rejectionReason", "createdAt", "updatedAt", "version", "supersededBy", "supersedesId", "lockedAt", "changeOrderOf", "changeOrderReason", "commercialChannel", "profitShieldFloorPct", "profitShieldEvaluation", "pricingSnapshot", "a1VersionRequestId", "a1VersionRequestHash",
    ].sort());
    expect(value).toMatchObject({ id: childId, tenantId: ids.tenant, projectId: ids.project, clientId: ids.client, createdBy: ids.actor, version: 2, source: "version", status: "draft", supersedesId: ids.draft, a1VersionRequestId: ids.request, createdAt: new Date(timestamp), updatedAt: new Date(timestamp), notes: "Reviewed text — café", bundleName: "Synthetic assembly", assemblyCount: null, subtotalPrice: "100.00", subtotalCost: "40.00", finalTotalPrice: "100.00", discountAmount: "0.00", discountApplied: false, grossProfit: "60.00", grossProfitPct: "60.00" });
    for (const field of ["draftData", "metadata", "warningsJson", "profitShieldPassed", "profitShieldMinPct", "profitShieldFloorPct", "profitShieldEvaluation", "approvedBy", "approvedAt", "rejectedBy", "rejectedAt", "rejectionReason", "lockedAt", "supersededBy"] as const) expect(value[field]).toBeNull();
    expect(value.lineItems).toEqual([{ costGroupName: "Cabinetry & Millwork", costItemName: "Synthetic shelf", description: "Synthetic component", quantity: "2", unit: "EA", unitCostSnapshot: "20", unitPriceSnapshot: "50", assemblyId: ids.assembly, costCode: "12-100", taxable: null, lineTotalCost: "40.00", lineTotalPrice: "100.00" }]);
    expect(value.assemblySelections).toEqual([{ assemblyId: ids.assembly, assemblyName: "Synthetic assembly", assemblyCode: "SYN-1", category: "Synthetic", quantity: "2", unitCost: "20", unitPrice: "50", extendedCost: "40.00", extendedPrice: "100.00" }]);
    expect(value.pricingSnapshot).toEqual({ channel: "direct", finishLevel: "standard", region: "synthetic", zone: null, trade: null, coastalModifier: null, commercialChannel: null, geoRiskClass: null });
  });
  it("derives count/zone for recorded A1 without reading unrepresented draft columns", async () => {
    const content = snapshot(); Object.assign(content.commercialContext.pricingContext, { zone: "Synthetic coastal zone" });
    const preview = await recordedPreview(content, "revoked");
    const value = await projectEstimateVersionDraftV2({ preview, command: command("recorded_a1", preview.sourceContentHash), context: context(), allocation: allocation() });
    expect(value).toMatchObject({ assemblyCount: 1, zone: "Synthetic coastal zone", approvedAt: null, approvedBy: null, status: "draft" });
  });
  it("preserves reviewed nulls and zero discount command semantics", async () => {
    const content = copy(); content.financials.discountApplied = true;
    Object.assign(content.lines[0], { unit: null, unitCostSnapshot: null, unitPriceSnapshot: null, csvClassification: null });
    Object.assign(content.assemblySelections[0], { unitCost: null, unitPrice: null, extendedCostMinor: null, extendedPriceMinor: null });
    const value = await projected(content);
    expect(value).toMatchObject({ discountApplied: true, discountAmount: "0.00" });
    expect(value.lineItems[0]).toMatchObject({ unit: null, unitCostSnapshot: null, unitPriceSnapshot: null, taxable: null });
    expect(value.assemblySelections[0]).toMatchObject({ unitCost: null, unitPrice: null, extendedCost: null, extendedPrice: null });
  });
  it("copies direct commercial channel only from reviewed direct-column basis", async () => {
    const first = copy(); Object.assign(first.commercialContext.pricingContext, { storedCommercialChannel: "premium" });
    first.commercialContext.policyContext.channelBasis = "draft.pricingSnapshot.commercialChannel"; first.commercialContext.policyContext.channelRawValue = "premium";
    expect((await projected(first)).commercialChannel).toBeNull();
    first.commercialContext.policyContext.channelBasis = "draft.commercialChannel";
    expect((await projected(first)).commercialChannel).toBe("premium");
  });
  it.each([
    ["32", "31", "0.01", "3.13"], ["32", "33", "-0.01", "-3.13"],
    ["3", "1", "0.02", "66.67"], ["10000", "10000", "0.00", "0.00"],
    ["1", "99999999999999999999", "-999999999999999999.98", "-9999999999999999999800.00"],
    ["10000000000000000001", "0", "100000000000000000.01", "100.00"],
  ])("projects exact signed profit and display margin for price %s cost %s", async (price, cost, gp, pct) => {
    const content = copy(); Object.assign(content.financials, { subtotalPriceMinor: price, finalPriceMinor: price, estimatedCostMinor: cost });
    Object.assign(content.lines[0], { lineTotalPriceMinor: price, lineTotalCostMinor: cost });
    const value = await projected(content);
    expect(value.grossProfit).toBe(gp); expect(value.grossProfitPct).toBe(pct);
  });
  it("uses final discounted total and preserves original cost and optional reference IDs", async () => {
    const content = copy(); Object.assign(content.financials, { discountApplied: true, discountMinor: "1000", finalPriceMinor: "9000" });
    Object.assign(content.origin, { estimateId: ids.settings, intakeFormId: ids.zone, bundleId: ids.assembly, changeOrderOf: ids.approval });
    const value = await projected(content);
    expect(value).toMatchObject({ subtotalPrice: "100.00", subtotalCost: "40.00", discountAmount: "10.00", finalTotalPrice: "90.00", grossProfit: "50.00", grossProfitPct: "55.56", estimateId: ids.settings, intakeFormId: ids.zone, bundleId: ids.assembly, changeOrderOf: ids.approval });
  });
  it("normalizes explicit name/reason and binds them into the persisted request hash", async () => {
    const preview = await draftPreview(); const cmd = { ...command("current_draft", preview.sourceContentHash), name: "  New copy  ", reason: " Synthetic copy explanation " };
    const value = await projectEstimateVersionDraftV2({ preview, command: cmd, context: context(), allocation: allocation() });
    expect(value).toMatchObject({ bundleName: "New copy", changeOrderReason: "Synthetic copy explanation", a1VersionRequestHash: await hashEstimateVersionCommandV2({ context: context(), command: cmd }) });
  });
  it.each(["hash", "version", "source", "tenant", "project", "client", "allocation", "timestamp"])("rejects a contradictory projection %s", async kind => {
    const preview = await draftPreview(); const cmd = command("current_draft", preview.sourceContentHash); const ctx = context(); const alloc = allocation();
    if (kind === "hash") cmd.expectedSourceContentHash = "0".repeat(64);
    if (kind === "version") cmd.expectedSourceVersion = 2;
    if (kind === "source") cmd.sourceDraftId = childId;
    if (kind === "tenant") ctx.tenantId = ids.zone;
    if (kind === "project") ctx.projectId = ids.zone;
    if (kind === "client") ctx.clientId = ids.zone;
    if (kind === "allocation") alloc.version = 1;
    if (kind === "timestamp") alloc.timestamp = "2026-02-30T12:00:00.123Z";
    await expect(projectEstimateVersionDraftV2({ preview, command: cmd, context: ctx, allocation: alloc })).rejects.toThrow();
  });
  it("refuses a forged preview hash even if the command repeats it", async () => {
    const preview = { ...await draftPreview(), sourceContentHash: "0".repeat(64) };
    await expect(projectEstimateVersionDraftV2({ preview, command: command("current_draft", preview.sourceContentHash), context: context(), allocation: allocation() })).rejects.toThrow();
  });
  it("does not mutate reviewed content, commands or the allocation", async () => {
    const content = copy(); const before = structuredClone(content); const preview = await draftPreview(content);
    const input = { preview, command: command("current_draft", preview.sourceContentHash), context: context(), allocation: allocation() }; const original = structuredClone(input);
    await projectEstimateVersionDraftV2(input);
    expect(content).toEqual(before); expect(input).toEqual(original);
  });
});
