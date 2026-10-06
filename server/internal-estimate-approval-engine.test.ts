import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertInternalApprovalReviewMatch, buildInternalApprovalReview, canonicalizeInternalApproval,
  evaluateInternalApprovalPolicy, hashInternalApprovalCommand, hashInternalApprovalContent,
  hashInternalApprovalPolicy, internalApprovalSnapshotSchema, internalApprovalPolicyContextSchema,
  internalApprovalPolicyEvaluationSchema, internalApproveCommandSchema, internalRevokeCommandSchema,
  internalCreateVersionCommandSchema, normalizeApprovalDecimal, normalizeApprovalMinor,
  normalizeApprovalPercent, validateInternalApprovalSnapshotRecord,
} from "../shared/internal-estimate-approval-engine";
import { approvalIds as ids, makeInternalApprovalReviewInput as input, makeInternalApprovalSnapshot as snapshot } from "./internal-estimate-approval-engine.fixtures";

afterEach(() => vi.unstubAllGlobals());
const hash = "a".repeat(64);
const context = () => ({ tenantId: ids.tenant, actorId: ids.actor, projectId: ids.project, clientId: ids.client });
const command = () => ({ id: ids.draft, requestId: ids.request, expectedDraftVersion: 1, expectedContentHash: hash, expectedPolicyHash: "b".repeat(64), confirmedCurrencyCode: "USD", reason: "Synthetic internal review" });
function evaluationInput() { const value = input(); return { financials: value.financials, assemblySelections: value.assemblySelections, policyContext: value.policyContext, policyHash: hash }; }
function inland(value: ReturnType<typeof input>) {
  value.policyContext.geoRiskClass = "inland";
  Object.assign(value.policyContext.projectGeo, { zone: "Synthetic inland zone", coastalExposureLevel: "none", riskResolutionBasis: "persisted_project_risk", persistedProjectRiskClass: "inland", zoneMinFloorPct: "0", warningCodes: [] });
  Object.assign(value.policyContext.floors, { geoBasePct: "0", effectiveFloorPct: "28" });
  return value;
}

describe("A1 decimal representation without financial rounding", () => {
  it("keeps every cent at the twenty-digit storage boundary", () => expect(normalizeApprovalMinor("999999999999999999.99")).toBe("99999999999999999999"));
  it("normalizes zero padding and six-place rates without changing value", () => {
    expect(normalizeApprovalDecimal("00012.340000")).toBe("12.34");
    expect(normalizeApprovalMinor("0000.00")).toBe("0");
    expect(normalizeApprovalPercent("035.040000")).toBe("35.04");
  });
  it.each([null, 0, "-1", "+1", "NaN", "Infinity", "1e2", "1,00", " 1", ".5", "1.", ""])("rejects ambiguous input %j instead of coercing it", value => {
    expect(() => normalizeApprovalMinor(value as never)).toThrow(/INTERNAL_APPROVAL_INPUT_INVALID/);
  });
  it("rejects fractional cents, excessive precision and numeric overflow", () => {
    expect(() => normalizeApprovalMinor("1.001")).toThrow();
    expect(() => normalizeApprovalMinor("1000000000000000000")).toThrow();
    expect(() => normalizeApprovalDecimal("1.0000000")).toThrow();
    expect(() => normalizeApprovalDecimal("100000000000000")).toThrow();
    expect(() => normalizeApprovalPercent("100.000001")).toThrow();
  });
});

describe("A1 review reconciles stored extended totals", () => {
  it("returns a computed review with no execution or acceptance authority", async () => {
    const result = await buildInternalApprovalReview(input());
    expect(result.snapshot.financials).toEqual({ currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: false, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: "4000" });
    expect(result.evaluation).toMatchObject({ priceMinor: "10000", costMinor: "4000", profitMinor: "6000", passed: true, violations: [], warnings: [] });
    expect(Object.keys(result).sort()).toEqual(["contentHash", "evaluation", "policyHash", "snapshot"]);
  });
  it("preserves legitimate per-assembly cent extensions instead of quantity times rate", async () => {
    const value = input(); value.financials = { ...value.financials, subtotalPriceMinor: "4", finalPriceMinor: "4", estimatedCostMinor: "2" };
    Object.assign(value.lines[0], { quantity: "1", unitCostSnapshot: "0.01", unitPriceSnapshot: "0.02", lineTotalCostMinor: "2", lineTotalPriceMinor: "4" });
    value.assemblySelections = [];
    const result = await buildInternalApprovalReview(value);
    expect(result.snapshot.lines[0].lineTotalCostMinor).toBe("2");
    expect(result.evaluation.profitMinor).toBe("2");
  });
  it("preserves unknown rates and units with known totals without enabling CSV", async () => {
    const value = input(); Object.assign(value.lines[0], { unit: null, unitCostSnapshot: null, unitPriceSnapshot: null, csvClassification: null });
    const result = await buildInternalApprovalReview(value);
    expect(result.snapshot.lines[0]).toMatchObject({ unit: null, unitCostSnapshot: null, csvClassification: null, taxable: null, lineTotalCostMinor: "4000" });
  });
  it.each(["subtotalPriceMinor", "estimatedCostMinor"])("rejects %s that does not reconcile with lines", async field => {
    const value = input(); (value.financials as any)[field] = "9999";
    await expect(buildInternalApprovalReview(value)).rejects.toThrow(/CONTENT_UNRESOLVED/);
  });
  it("keeps discount distinct from subtotal and refuses unsupported correction", async () => {
    const value = input(); Object.assign(value.financials, { discountApplied: true, discountMinor: "1000", finalPriceMinor: "9000" });
    expect((await buildInternalApprovalReview(value)).evaluation.profitMinor).toBe("5000");
    value.financials.discountApplied = false;
    await expect(buildInternalApprovalReview(value)).rejects.toThrow();
  });
  it("rejects missing or null known money instead of making it zero", async () => {
    const value = input(); (value.financials as any).estimatedCostMinor = null;
    await expect(buildInternalApprovalReview(value)).rejects.toThrow();
    expect(internalApprovalSnapshotSchema.safeParse({ ...snapshot(), financials: { ...snapshot().financials, currencyCode: null } }).success).toBe(false);
  });
  it("rejects a combined line sum beyond storage capacity", async () => {
    const value = input(); value.lines[0].lineTotalPriceMinor = "99999999999999999999";
    value.lines.push({ ...value.lines[0], lineKey: "line:2", ordinal: 2, lineTotalPriceMinor: "1" });
    await expect(buildInternalApprovalReview(value)).rejects.toThrow(/CONTENT_UNRESOLVED/);
  });
  it("does not mutate the supplied review", async () => {
    const value = input(); const before = structuredClone(value);
    await buildInternalApprovalReview(value); expect(value).toEqual(before);
  });
  it("normalizes reviewed line endings and label trim before hashing", async () => {
    const first = input(); first.presentation.reviewedNotes = "one\r\ntwo\rthree"; first.presentation.bundleName = " Synthetic assembly ";
    const second = input(); second.presentation.reviewedNotes = "one\ntwo\nthree";
    const a = await buildInternalApprovalReview(first); const b = await buildInternalApprovalReview(second);
    expect(a.contentHash).toBe(b.contentHash); expect(a.snapshot.presentation.reviewedNotes).toBe("one\ntwo\nthree");
  });
});

describe("A1 policy compares exact rational margins", () => {
  it("rejects a one-cent shortfall above Number safe precision", () => {
    const value = evaluationInput(); value.financials = { ...value.financials, subtotalPriceMinor: "10000000000000000000", finalPriceMinor: "10000000000000000000", estimatedCostMinor: "5800000000000000001" };
    expect(evaluateInternalApprovalPolicy(value)).toMatchObject({ passed: false, profitMinor: "4199999999999999999", violations: ["margin_below_effective_floor"] });
    value.financials.estimatedCostMinor = "5800000000000000000";
    expect(evaluateInternalApprovalPolicy(value).passed).toBe(true);
  });
  it("applies an override at all six digits instead of rounding the floor down", () => {
    const value = inland(input()); Object.assign(value.policyContext.tenantSettings, { settingsId: ids.settings, settingsUpdatedAt: "2026-09-01T12:00:00.000Z", channelOverridePct: "35.040001" });
    value.policyContext.floors.effectiveFloorPct = "35.040001";
    Object.assign(value.financials, { subtotalPriceMinor: "100000000", finalPriceMinor: "100000000", estimatedCostMinor: "64960000" });
    expect(evaluateInternalApprovalPolicy({ financials: value.financials, assemblySelections: [], policyContext: value.policyContext, policyHash: hash }).passed).toBe(false);
  });
  it("warns below 35 without making it a new hard floor", () => {
    const value = inland(input()); value.financials.estimatedCostMinor = "7000";
    const result = evaluateInternalApprovalPolicy({ financials: value.financials, assemblySelections: [], policyContext: value.policyContext, policyHash: hash });
    expect(result).toMatchObject({ passed: true, effectiveFloorPct: "28", warnings: [{ code: "below_global_warning", selectionKey: null, thresholdPct: "35" }] });
  });
  it("does not allow a lower override to lower the channel floor", () => {
    const value = inland(input()); Object.assign(value.policyContext.tenantSettings, { settingsId: ids.settings, settingsUpdatedAt: "2026-09-01T12:00:00.000Z", channelOverridePct: "15" });
    value.policyContext.floors.effectiveFloorPct = "15";
    expect(() => evaluateInternalApprovalPolicy({ financials: value.financials, assemblySelections: [], policyContext: value.policyContext, policyHash: hash })).toThrow(/POLICY_CONTEXT_UNRESOLVED/);
  });
  it("preserves capital fee semantics with the existing margin formula", () => {
    const value = inland(input()); Object.assign(value.policyContext, { commercialChannel: "capital", channelBasis: "draft.commercialChannel", channelRawValue: "capital" });
    Object.assign(value.policyContext.floors, { channelBasePct: "15", effectiveFloorPct: "15", floorKind: "fee" });
    value.financials.estimatedCostMinor = "8500";
    expect(evaluateInternalApprovalPolicy({ financials: value.financials, assemblySelections: [], policyContext: value.policyContext, policyHash: hash })).toMatchObject({ passed: true, floorKind: "fee" });
  });
  it("reports individual unknown and low margins without inventing money", () => {
    const value = evaluationInput(); value.assemblySelections[0].extendedCostMinor = "9000";
    expect(evaluateInternalApprovalPolicy(value).warnings).toEqual([{ code: "assembly_below_individual_warning", selectionKey: "selection:1", thresholdPct: "28" }]);
    (value.assemblySelections[0] as any).extendedCostMinor = null;
    expect(evaluateInternalApprovalPolicy(value).warnings).toEqual([{ code: "assembly_margin_unknown", selectionKey: "selection:1", thresholdPct: null }]);
  });
  it("blocks contradictory zone floor instead of silently ignoring it", () => {
    const value = evaluationInput(); value.policyContext.projectGeo.zoneMinFloorPct = "50";
    expect(() => evaluateInternalApprovalPolicy(value)).toThrow(/POLICY_CONTEXT_UNRESOLVED/);
  });
  it.each([null, "low", "unknown", "failed"])("does not accept unknown or weak geocode confidence %j", value => {
    const policy = input().policyContext; (policy.projectGeo as any).geocodeConfidence = value;
    expect(internalApprovalPolicyContextSchema.safeParse(policy).success).toBe(false);
  });
  it("requires explicit persisted risk for low/none exposure", () => {
    const value = inland(input()); (value.policyContext.projectGeo as any).persistedProjectRiskClass = null;
    expect(internalApprovalPolicyContextSchema.safeParse(value.policyContext).success).toBe(false);
  });
  it("refuses contradictory raw channel, geo exposure and tenant identity", async () => {
    for (const change of [
      (x: any) => { x.policyContext.channelRawValue = "insurance"; },
      (x: any) => { x.policyContext.projectGeo.coastalExposureLevel = "extreme"; },
      (x: any) => { x.policyContext.projectGeo.zoneTenantId = ids.client; },
      (x: any) => { x.pricingContext.storedRiskBasis = "persisted_pricing_context"; x.pricingContext.storedGeoRiskClass = "inland"; },
    ]) { const value = input(); change(value); await expect(buildInternalApprovalReview(value)).rejects.toThrow(); }
  });
});

describe("A1 closed snapshot and reviewed CSV provenance", () => {
  it.each(["identity", "origin", "presentation", "financials", "commercialContext", "scopeReference"])("rejects unknown authority keys inside %s", key => {
    const value = snapshot(); (value as any)[key].executionEnabled = true;
    expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false);
  });
  it("rejects sparse order, mismatched line keys, zero quantities and missing keys", () => {
    for (const change of [
      (x: any) => { x.lines[0].ordinal = 2; }, (x: any) => { x.lines[0].lineKey = "line:9"; },
      (x: any) => { x.lines[0].quantity = "0"; }, (x: any) => { delete x.lines[0].taxable; },
      (x: any) => { x.assemblySelections[0].selectionKey = "selection:2"; },
    ]) { const value = snapshot(); change(value); expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false); }
  });
  it("rejects null versions, zero UUID sentinels, unsupported ancestry and fabricated scope snapshots", () => {
    for (const change of [
      (x: any) => { x.version = null; }, (x: any) => { x.identity.clientId = "00000000-0000-0000-0000-000000000000"; },
      (x: any) => { x.origin.source = "historical_import"; }, (x: any) => { x.origin.source = "version"; },
      (x: any) => { x.scopeReference = { association: "explicit_snapshot_link", scopeDraftId: ids.draft, reviewSnapshotId: ids.approval }; },
    ]) { const value = snapshot(); change(value); expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false); }
  });
  it("counts Unicode codepoints rather than UTF16 and rejects malformed Unicode", () => {
    const value = snapshot(); value.presentation.bundleName = "🏗".repeat(255);
    expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(true);
    for (const text of ["🏗".repeat(256), "bad\u0000text", "bad\ud800text"]) {
      value.presentation.bundleName = text; expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false);
    }
  });
  it("rejects coerced numeric JSON, noncanonical decimals and impossible timestamps", () => {
    for (const change of [
      (x: any) => { x.financials.subtotalPriceMinor = 10000; },
      (x: any) => { x.lines[0].quantity = "02"; },
      (x: any) => { x.lines[0].unitPriceSnapshot = "50.0000000"; },
      (x: any) => { x.origin.sourceCreatedAt = "2026-02-31T12:00:00.000Z"; },
    ]) { const value = snapshot(); change(value); expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false); }
  });
  it("returns a validation failure for malformed numeric strings without throwing from refinements", () => {
    for (const change of [
      (x: any) => { x.financials.subtotalPriceMinor = "not-money"; },
      (x: any) => { x.lines[0].lineTotalCostMinor = "not-money"; },
      (x: any) => { x.lines[0].quantity = "not-quantity"; },
      (x: any) => { x.commercialContext.policyContext.floors.effectiveFloorPct = "not-percent"; },
    ]) { const value = snapshot(); change(value); expect(() => internalApprovalSnapshotSchema.safeParse(value)).not.toThrow(); expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false); }
  });
  it("rejects prototype and accessor objects at the public schema boundary", () => {
    const inherited = Object.assign(Object.create({ authority: true }), snapshot());
    expect(internalApprovalSnapshotSchema.safeParse(inherited).success).toBe(false);
    const accessor = snapshot(); Object.defineProperty(accessor.presentation, "bundleName", { enumerable: true, get() { throw new Error("getter must not execute"); } });
    expect(() => internalApprovalSnapshotSchema.safeParse(accessor)).not.toThrow();
    expect(internalApprovalSnapshotSchema.safeParse(accessor).success).toBe(false);
  });
  it("rejects sparse arrays and array subclasses at the public schema boundary", () => {
    const sparse = snapshot(); sparse.lines.length = 2;
    expect(internalApprovalSnapshotSchema.safeParse(sparse).success).toBe(false);
    class CustomArray extends Array {}
    const subclass = snapshot(); subclass.lines = CustomArray.from(subclass.lines) as typeof subclass.lines;
    expect(internalApprovalSnapshotSchema.safeParse(subclass).success).toBe(false);
  });
  it("does not confuse derived cost codes with stored codes", () => {
    const value = snapshot(); value.lines[0].csvClassification.costCode = "01-100";
    expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false);
    Object.assign(value.lines[0], { costCode: null });
    value.lines[0].csvClassification.costCodeSource = "inferCostCode_v1";
    expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(true);
  });
  it("does not classify inside the engine or fabricate taxable", async () => {
    const value = input(); Object.assign(value.lines[0], { csvClassification: null, taxable: null });
    expect((await buildInternalApprovalReview(value)).snapshot.lines[0]).toMatchObject({ csvClassification: null, taxable: null });
  });
  it("validates the exact existing unit/type vocabulary and classification version", () => {
    for (const change of [
      (x: any) => { x.lines[0].csvClassification.normalizedUnit = "EA"; },
      (x: any) => { x.lines[0].csvClassification.costType = "labour"; },
      (x: any) => { x.lines[0].csvClassification.classificationVersion = "guess"; },
      (x: any) => { x.lines[0].csvClassification.approved = true; },
      (x: any) => { x.lines[0].csvClassification.unitSource = "stored_canonical"; },
      (x: any) => { x.lines[0].unitCostSnapshot = null; },
    ]) { const value = snapshot(); change(value); expect(internalApprovalSnapshotSchema.safeParse(value).success).toBe(false); }
  });
});

describe("A1 WebCrypto content and request identity", () => {
  it("keeps object key ordering canonical but array order meaningful", () => {
    const value = snapshot(); const reverse = Object.fromEntries(Object.entries(value).reverse());
    expect(canonicalizeInternalApproval(reverse)).toBe(canonicalizeInternalApproval(value));
    expect(canonicalizeInternalApproval({ id: ids.draft, confirmedCurrencyCode: "USD" })).toBe('{"confirmedCurrencyCode":"USD","id":"a1000000-0000-4000-8000-000000000004"}');
  });
  it("refuses unsafe objects before canonicalizing them", () => {
    for (const value of [{ x: undefined }, { x: NaN }, { x: Infinity }, { x: new Date() }, Object.create({ hidden: true }), [1, , 2]]) expect(() => canonicalizeInternalApproval(value)).toThrow();
  });
  it("includes reviewed notes and CSV provenance in the content but not policy hash", async () => {
    const first = await buildInternalApprovalReview(input()); const changed = input(); changed.presentation.reviewedNotes = "Changed reviewed text";
    const second = await buildInternalApprovalReview(changed);
    expect(second.contentHash).not.toBe(first.contentHash); expect(second.policyHash).toBe(first.policyHash);
    changed.lines[0].taxable = true as never;
    expect((await buildInternalApprovalReview(changed)).contentHash).not.toBe(second.contentHash);
  });
  it("changes policy identity for a current relevant policy change", async () => {
    const policy = input().policyContext; const first = await hashInternalApprovalPolicy(policy);
    Object.assign(policy.tenantSettings, { settingsId: ids.settings, settingsUpdatedAt: "2026-09-01T12:00:00.000Z", channelOverridePct: "43" });
    policy.floors.effectiveFloorPct = "43"; policy.projectGeo.zoneMinFloorPct = "42";
    expect(await hashInternalApprovalPolicy(policy)).not.toBe(first);
  });
  it("keeps a repeated command stable without clock or generated IDs", async () => {
    const value = { operation: "approve", context: context(), command: command() };
    const first = await hashInternalApprovalCommand(value);
    expect(await hashInternalApprovalCommand(structuredClone(value))).toBe(first);
    expect(await hashInternalApprovalCommand({ ...value, context: { ...value.context, actorId: ids.approval } })).not.toBe(first);
    await expect(hashInternalApprovalCommand({ ...value, now: "2026-09-01T12:00:00.000Z" })).rejects.toThrow();
  });
  it("matches an independently generated SHA-256 command vector", async () => {
    // Fixed canonical envelope verified independently using Python hashlib, not the engine.
    expect(await hashInternalApprovalCommand({ operation: "approve", context: context(), command: command() }))
      .toBe("2f5d8d3778a8b209c76dfff15f86fe998e41bf6b4e11e3a34e3ebe19b44daab1");
  });
  it("rejects unsupported client authority and missing request identity in commands", () => {
    expect(internalApproveCommandSchema.safeParse({ ...command(), force: true }).success).toBe(false);
    expect(internalApproveCommandSchema.safeParse({ ...command(), requestId: null }).success).toBe(false);
    expect(internalRevokeCommandSchema.safeParse({ id: ids.draft, approvalId: ids.approval, requestId: ids.request, expectedContentHash: hash, reason: "Synthetic revocation" }).success).toBe(true);
    expect(internalCreateVersionCommandSchema.safeParse({ sourceDraftId: ids.draft, requestId: ids.request, expectedSourceVersion: 1, expectedSourceContentHash: hash, name: null, reason: "Synthetic correction" }).success).toBe(true);
  });
  it("rejects stale review content, policy and version separately", async () => {
    const review = await buildInternalApprovalReview(input());
    for (const override of [{ expectedContentHash: "0".repeat(64) }, { expectedPolicyHash: "0".repeat(64) }, { expectedDraftVersion: 2 }]) {
      expect(() => assertInternalApprovalReviewMatch({ review, expectedDraftVersion: 1, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, ...override })).toThrow(/REVIEW_STALE/);
    }
  });
  it("recomputes persisted evidence instead of trusting a valid-looking hash", async () => {
    const result = await buildInternalApprovalReview(input());
    const record = { snapshot: result.snapshot, evaluation: result.evaluation, expectedContentHash: result.contentHash, expectedPolicyHash: result.policyHash };
    expect((await validateInternalApprovalSnapshotRecord(record)).evaluation.profitMinor).toBe("6000");
    await expect(validateInternalApprovalSnapshotRecord({ ...record, expectedContentHash: "f".repeat(64) })).rejects.toThrow(/INTEGRITY_ERROR/);
    await expect(validateInternalApprovalSnapshotRecord({ ...record, evaluation: { ...result.evaluation, profitMinor: "9999" } })).rejects.toThrow(/INTEGRITY_ERROR/);
  });
  it("refuses a forged passing evaluation at the schema boundary", () => {
    const result = evaluateInternalApprovalPolicy(evaluationInput());
    expect(internalApprovalPolicyEvaluationSchema.safeParse({ ...result, passed: false, violations: [] }).success).toBe(false);
    expect(internalApprovalPolicyEvaluationSchema.safeParse({ ...result, force: true }).success).toBe(false);
  });
  it("fails closed without WebCrypto", async () => {
    vi.stubGlobal("crypto", undefined);
    await expect(hashInternalApprovalContent(snapshot())).rejects.toThrow(/CRYPTO_UNAVAILABLE/);
  });
  it("fails closed when digest rejects instead of returning a weak replacement", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: () => Promise.reject(new Error("not available")) } });
    await expect(hashInternalApprovalContent(snapshot())).rejects.toThrow(/CRYPTO_UNAVAILABLE/);
  });
});
