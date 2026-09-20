import { describe, expect, it } from "vitest";
import { buildEstimateVersionCopyFromRows as copy, buildInternalApprovalReviewFromRows as approve } from "./internal-estimate-approval-adapter";
import { approvalRows, approvalContext as context } from "./internal-estimate-approval-adapter.fixtures";

describe("version copy row adapter", () => {
  it("binds explicit copy currency without manufacturing an approval result", async () => {
    const rows = approvalRows(), before = structuredClone(rows);
    const result = await copy(rows, context);
    expect(result.content.version).toBe("estimate-version-copy-source-v2");
    expect(result.content.financials.currencyBasis).toBe("version_request_confirmation");
    expect(result.content.financials.currencyCode).toBe("USD");
    expect(Object.keys(result).sort()).toEqual(["content", "contentHash"]);
    expect(JSON.stringify(result)).not.toContain("approver_confirmation");
    expect(rows).toEqual(before);
  });
  it("keeps approval representation and hash distinct from copy", async () => {
    const rows = approvalRows(); const a = await approve(rows, context), c = await copy(rows, context);
    expect(a.snapshot.financials.currencyBasis).toBe("approver_confirmation");
    expect(c.contentHash).not.toBe(a.contentHash);
    expect(c.content.financials.subtotalPriceMinor).toBe(a.snapshot.financials.subtotalPriceMinor);
    expect(c.content.commercialContext).toEqual(a.snapshot.commercialContext);
  });
  it.each([null, undefined, "EUR"])("requires explicit copy currency %s", async confirmedCurrencyCode => {
    await expect(copy(approvalRows(), { ...context, confirmedCurrencyCode } as never)).rejects.toHaveProperty("code");
  });
  it("includes null projection presence in the hash", async () => {
    const rows = approvalRows(); const known = await copy(rows, context);
    rows.draft.assemblyCount = null;
    const unknown = await copy(rows, context);
    expect(unknown.content.copyProjection).toEqual({ assemblyCount: null, directZone: null });
    expect(known.content.copyProjection.assemblyCount).toBe(1);
    expect(known.contentHash).not.toBe(unknown.contentHash);
  });
  it("distinguishes a direct zone from the same resolved pricing zone", async () => {
    const rows = approvalRows(); rows.draft.pricingSnapshot = { zone: rows.project.zone };
    const indirect = await copy(rows, context);
    rows.draft.zone = rows.project.zone;
    const direct = await copy(rows, context);
    expect(direct.content.commercialContext).toEqual(indirect.content.commercialContext);
    expect(indirect.content.copyProjection.directZone).toBeNull();
    expect(direct.content.copyProjection.directZone).toBe(rows.project.zone);
    expect(direct.contentHash).not.toBe(indirect.contentHash);
  });
  it.each([undefined, -1, 0, 2, 1001, 1.5, "1"])("rejects invalid/inconsistent count %s", async value => {
    const rows = approvalRows(); rows.draft.assemblyCount = value as never;
    await expect(copy(rows, context)).rejects.toHaveProperty("code");
  });
  it.each(["", " ", "Different zone", undefined])("does not silently erase invalid direct zone %s", async value => {
    const rows = approvalRows(); rows.draft.zone = value as never;
    await expect(copy(rows, context)).rejects.toHaveProperty("code");
  });
  it("retains explicit count zero for an empty reviewed selection array", async () => {
    const rows = approvalRows(); rows.draft.assemblyCount = 0; rows.draft.assemblySelections = [];
    expect((await copy(rows, context)).content.copyProjection.assemblyCount).toBe(0);
  });
  it("allows copying known below-floor data for a later correction", async () => {
    const rows = approvalRows(); rows.draft.subtotalCost = "99.00";
    (rows.draft.lineItems![0] as any).lineTotalCost = "99.00";
    const result = await copy(rows, context);
    expect(result.content.financials.estimatedCostMinor).toBe("9900");
    expect(result).not.toHaveProperty("evaluation");
  });
  it("preserves large exact money and true/zero discount", async () => {
    const rows = approvalRows(); rows.draft.subtotalPrice = "999999999999999999.99";
    rows.draft.finalTotalPrice = rows.draft.subtotalPrice; rows.draft.discountApplied = true;
    (rows.draft.lineItems![0] as any).lineTotalPrice = rows.draft.subtotalPrice;
    const result = await copy(rows, context);
    expect(result.content.financials).toMatchObject({ subtotalPriceMinor: "99999999999999999999", finalPriceMinor: "99999999999999999999", discountApplied: true, discountMinor: "0" });
  });
  it("rejects a foreign tenant before creating copy content", async () => {
    const rows = approvalRows(); rows.project.tenantId = rows.client.id;
    await expect(copy(rows, context)).rejects.toHaveProperty("code");
  });
  it("ignores unreviewed metadata instead of copying authority flags", async () => {
    const rows = approvalRows(); rows.draft.metadata = { approved: true, executionReady: true, private: "synthetic-unreviewed" };
    const result = await copy(rows, context);
    expect(JSON.stringify(result)).not.toContain("synthetic-unreviewed");
    expect(result.content).not.toHaveProperty("metadata");
  });
});
