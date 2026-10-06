import { describe, it, expect } from "vitest";
import { buildInternalApprovalReviewFromRows as build } from "./internal-estimate-approval-adapter";
import {
  approvalRows,
  approvalContext as ctx,
  approvalSettings,
  approvalScope,
} from "./internal-estimate-approval-adapter.fixtures";
import { approvalIds as id } from "./internal-estimate-approval-engine.fixtures";
import { classifyCostType } from "./jobtread-csv-export";
import type { InternalApprovalRows } from "./internal-estimate-approval-adapter";
const snapshot = (r: InternalApprovalRows) =>
  r.project.zoneModifierSnapshot as any;
const line = (r: InternalApprovalRows) => (r.draft.lineItems as any[])[0];
const policyError = { code: "POLICY_CONTEXT_UNRESOLVED" };
describe("A1 persisted-row adapter", () => {
  it("preserves priced totals, identity, scope absence and reviewed CSV provenance without repricing", async () => {
    const result = await build(approvalRows(), ctx);
    expect(result.snapshot.identity).toEqual({
      tenantId: id.tenant,
      projectId: id.project,
      clientId: id.client,
      estimateDraftId: id.draft,
      draftVersion: 1,
    });
    expect(result.snapshot.financials).toMatchObject({
      subtotalPriceMinor: "10000",
      estimatedCostMinor: "4000",
      finalPriceMinor: "10000",
      discountMinor: "0",
    });
    expect(result.snapshot.lines[0]).toMatchObject({
      quantity: "2",
      unitCostSnapshot: "20",
      lineTotalCostMinor: "4000",
      costCode: "12-100",
      csvClassification: {
        costType: "Materials",
        normalizedUnit: "Each",
        costCodeSource: "stored",
        unitSource: "normalizeUnit_v1",
      },
    });
    expect(result.snapshot.scopeReference).toEqual({
      association: "none",
      scopeDraftId: null,
      reviewSnapshotId: null,
    });
    expect(result.evaluation).toMatchObject({
      passed: true,
      effectiveFloorPct: "42",
    });
  });
  it("hashes identical stored values deterministically and leaves inputs untouched", async () => {
    const r = approvalRows(),
      before = structuredClone(r);
    const a = await build(r, ctx),
      b = await build(r, ctx);
    expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toEqual(b);
    expect(r).toEqual(before);
  });
  it.each(["draft", "project", "client", "profile", "zone"] as const)(
    "denies foreign/null tenant on %s",
    async key => {
      const r = approvalRows();
      r[key]!.tenantId = null;
      await expect(build(r, ctx)).rejects.toMatchObject({
        code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED",
      });
    }
  );
  it("denies inactive identity and inconsistent client relationship", async () => {
    const r = approvalRows();
    r.client.isActive = false;
    await expect(build(r, ctx)).rejects.toHaveProperty("code");
    r.client.isActive = true;
    r.project.clientId = id.actor;
    await expect(build(r, ctx)).rejects.toHaveProperty("code");
  });
  it("retains exact one-cent rounding totals instead of multiplying rates", async () => {
    const r = approvalRows();
    Object.assign(line(r), {
      quantity: 1,
      unitCostSnapshot: 0.01,
      lineTotalCost: 0.02,
    });
    r.draft.subtotalCost = "0.02";
    expect((await build(r, ctx)).snapshot.lines[0].lineTotalCostMinor).toBe(
      "2"
    );
  });
  it("converts existing JSON decimal numbers exactly without binary multiplication error", async () => {
    const r = approvalRows();
    line(r).lineTotalCost = 0.29;
    r.draft.subtotalCost = "0.29";
    expect((await build(r, ctx)).snapshot.financials.estimatedCostMinor).toBe(
      "29"
    );
  });
  it.each([null, undefined, -1, NaN, 0.001, 1e21, 90071992547409.92])(
    "rejects unknown or nonrepresentable priced total %s",
    async value => {
      const r = approvalRows();
      line(r).lineTotalCost = value;
      await expect(build(r, ctx)).rejects.toHaveProperty("code");
    }
  );
  it("rejects a JSON number when adjacent cents collapse to the same double", async () => {
    const r = approvalRows(),
      ambiguous = 90071992547409.9;
    line(r).lineTotalCost = ambiguous;
    r.draft.subtotalCost = String(ambiguous);
    line(r).lineTotalPrice = "200000000000000.00";
    r.draft.subtotalPrice = "200000000000000.00";
    r.draft.finalTotalPrice = "200000000000000.00";
    await expect(build(r, ctx)).rejects.toMatchObject({
      code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED",
    });
  });
  it("keeps exact large string amounts without Number conversion", async () => {
    const r = approvalRows();
    line(r).lineTotalCost = "10000000000000000.01";
    line(r).lineTotalPrice = "20000000000000000.03";
    r.draft.subtotalCost = line(r).lineTotalCost;
    r.draft.subtotalPrice = line(r).lineTotalPrice;
    r.draft.finalTotalPrice = line(r).lineTotalPrice;
    expect((await build(r, ctx)).snapshot.financials.estimatedCostMinor).toBe(
      "1000000000000000001"
    );
  });
  it("lets policy return failed rather than inventing a margin exception", async () => {
    const r = approvalRows();
    line(r).lineTotalCost = 90;
    r.draft.subtotalCost = "90";
    expect((await build(r, ctx)).evaluation.passed).toBe(false);
  });
  it("reconciles line ledger and discounts, refusing divergent totals", async () => {
    const r = approvalRows();
    r.draft.discountApplied = true;
    r.draft.discountAmount = "10";
    r.draft.finalTotalPrice = "90";
    expect((await build(r, ctx)).snapshot.financials.finalPriceMinor).toBe(
      "9000"
    );
    r.draft.subtotalCost = "41";
    await expect(build(r, ctx)).rejects.toHaveProperty("code");
  });
  it("does not fabricate missing rates, taxable or CSV classification", async () => {
    const r = approvalRows();
    delete line(r).unitCostSnapshot;
    delete line(r).taxable;
    const l = (await build(r, ctx)).snapshot.lines[0];
    expect(l.unitCostSnapshot).toBeNull();
    expect(l.taxable).toBeNull();
    expect(l.csvClassification).toBeNull();
  });
  it.each([
    ["HVAC system", 0, 100],
    ["Permit review", 0, 0],
    ["Synthetic shelf", 20, 50],
    ["Synthetic shelf", 0, 20],
    ["Synthetic shelf", 0, 0],
  ] as const)(
    "preserves current classifier zero/positive branches for %s",
    async (name, cost, price) => {
      const r = approvalRows();
      Object.assign(line(r), {
        costItemName: name,
        unitCostSnapshot: cost,
        unitPriceSnapshot: price,
      });
      expect(
        (await build(r, ctx)).snapshot.lines[0].csvClassification?.costType
      ).toBe(classifyCostType("Cabinetry & Millwork", name, cost, price));
    }
  );
  it("infers cost code only when absent and records existing classifier origin", async () => {
    const r = approvalRows();
    line(r).costCode = null;
    const l = (await build(r, ctx)).snapshot.lines[0];
    expect(l.costCode).toBeNull();
    expect(l.csvClassification?.costCodeSource).toBe("inferCostCode_v1");
    expect(l.csvClassification?.costCode).not.toBeNull();
  });
  it("retains an unrecognized stored code and unknown unit without replacement", async () => {
    const r = approvalRows();
    line(r).costCode = "legacy-code";
    line(r).unit = "unknown-unit";
    const l = (await build(r, ctx)).snapshot.lines[0];
    expect(l.costCode).toBe("legacy-code");
    expect(l.csvClassification).toBeNull();
  });
  it("applies exact MAX tenant overrides with six-place precision", async () => {
    const r = approvalRows();
    r.settings = approvalSettings();
    r.settings.geoFloorOverrides = { coastal: "42.000001" };
    expect((await build(r, ctx)).evaluation.effectiveFloorPct).toBe(
      "42.000001"
    );
  });
  it.each([{ coastal: null }, { coastal: "n/a" }, [], { coastal: 101 }])(
    "rejects malformed or explicit unknown override %j",
    async value => {
      const r = approvalRows();
      r.settings = approvalSettings();
      r.settings.geoFloorOverrides = value;
      await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    }
  );
  it("rejects conflicting channel candidates even below precedence winner", async () => {
    const r = approvalRows();
    r.draft.commercialChannel = "premium";
    r.draft.pricingSnapshot = { commercialChannel: "trade" };
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
  });
  it("rejects project channel conflict without inventing a tenant default", async () => {
    const r = approvalRows();
    r.project.channel = "trade";
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
  });
  it("records source channel provenance and preserves current versus priced risk distinction", async () => {
    const r = approvalRows();
    r.draft.commercialChannel = "Premium";
    const p = (await build(r, ctx)).snapshot.commercialContext;
    expect(p.policyContext.channelBasis).toBe("draft.commercialChannel");
    expect(p.pricingContext.storedGeoRiskClass).toBeNull();
    expect(p.policyContext.riskBasis).toBe("project_at_internal_review");
  });
  it.each(["historical_import", "manual", null])(
    "rejects uncalculated source %s",
    async source => {
      const r = approvalRows();
      r.draft.source = source;
      await expect(build(r, ctx)).rejects.toHaveProperty("code");
    }
  );
  it("validates scope identity but never implies reviewed scope", async () => {
    const r = approvalRows();
    r.scopeDraft = approvalScope();
    r.draft.scopeDraftId = r.scopeDraft.id;
    expect((await build(r, ctx)).snapshot.scopeReference).toEqual({
      association: "draft_link_only",
      scopeDraftId: r.scopeDraft.id,
      reviewSnapshotId: null,
    });
    r.scopeDraft.projectId = id.actor;
    await expect(build(r, ctx)).rejects.toHaveProperty("code");
  });
  it("rejects missing, malformed, or unknown proof keys", async () => {
    for (const proof of [
      undefined,
      null,
      { version: "unknown" },
      { ...snapshot(approvalRows()).reviewEvidence, extra: true },
    ]) {
      const r = approvalRows();
      snapshot(r).reviewEvidence = proof;
      await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    }
  });
  it.each(["address", "city", "state", "zip", "county"] as const)(
    "rejects changed input %s and accepts exactly restored input",
    async key => {
      const r = approvalRows(),
        old = r.project[key];
      r.project[key] = "changed";
      await expect(build(r, ctx)).rejects.toMatchObject(policyError);
      r.project[key] = old;
      expect((await build(r, ctx)).evaluation.passed).toBe(true);
    }
  );
  it.each([
    "latitude",
    "longitude",
    "geocodedAddress",
    "geocodeSource",
    "geocodeConfidence",
  ] as const)("rejects divergent stored %s", async key => {
    const r = approvalRows();
    r.project[key] = "changed";
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
  });
  it("rejects different geocoded time, project, tenant, or zone in evidence", async () => {
    for (const key of ["geocodedAt", "projectId", "tenantId"]) {
      const r = approvalRows();
      snapshot(r).reviewEvidence[key] = "changed";
      await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    }
    const r = approvalRows();
    snapshot(r).reviewEvidence.zoneDetection.zoneId = id.actor;
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
  });
  it.each([
    { method: "default", confidence: "high" },
    { method: "coordinates", confidence: "low" },
    { method: "mystery", confidence: "high" },
  ])("rejects untrusted detection %j", async detection => {
    const r = approvalRows();
    Object.assign(snapshot(r).reviewEvidence.zoneDetection, detection);
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
  });
  it("accepts known medium ZIP detection", async () => {
    const r = approvalRows();
    Object.assign(snapshot(r).reviewEvidence.zoneDetection, {
      method: "zip",
      confidence: "medium",
    });
    expect((await build(r, ctx)).evaluation.passed).toBe(true);
  });
  it("preserves actual outside-radius warning, independent of stale project warnings", async () => {
    const r = approvalRows();
    snapshot(r).reviewEvidence.geocode.withinServiceRadius = false;
    r.project.geoWarnings = [];
    expect(
      (await build(r, ctx)).snapshot.commercialContext.policyContext.projectGeo
        .warningCodes
    ).toEqual(["geo.coastal_exposure", "geo.outside_service_radius"]);
  });
  it("rejects executable timestamp properties without calling them", async () => {
    const r = approvalRows();
    let invoked = false;
    Object.defineProperty(r.draft.createdAt, "toISOString", {
      get() {
        invoked = true;
        return () => "2026-09-01T12:00:00.000Z";
      },
    });
    await expect(build(r, ctx)).rejects.toHaveProperty("code");
    expect(invoked).toBe(false);
  });
  it("rejects non-JSON objects in stored pricing context", async () => {
    const r = approvalRows();
    r.draft.pricingSnapshot = new Date("2026-09-01T12:00:00.000Z");
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
  });
  it("rejects custom prototype/accessor proof without executing a getter", async () => {
    const r = approvalRows();
    let invoked = false;
    const evidence = snapshot(r).reviewEvidence;
    Object.defineProperty(evidence, "tenantId", {
      enumerable: true,
      get() {
        invoked = true;
        return id.tenant;
      },
    });
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    expect(invoked).toBe(false);
    const a = approvalRows();
    Object.setPrototypeOf(snapshot(a).reviewEvidence, { inherited: true });
    await expect(build(a, ctx)).rejects.toMatchObject(policyError);
  });
  it("rejects stale zone row modifiers and reassignment without a new geocode proof", async () => {
    const r = approvalRows();
    r.zone!.laborModifier = "1.2";
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    r.zone!.laborModifier = "1.1";
    delete snapshot(r).reviewEvidence;
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
  });
  it("rejects low/none exposure absent explicit project risk and zone floor conflict", async () => {
    const r = approvalRows();
    r.zone!.coastalExposureLevel = "none";
    snapshot(r).coastalExposureLevel = "none";
    r.project.geoRiskClass = null;
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    const a = approvalRows();
    a.zone!.minProfitShieldPct = "45";
    snapshot(a).minProfitShieldPct = 45;
    await expect(build(a, ctx)).rejects.toMatchObject(policyError);
  });
  it.each(["", "   ", "\r\n\t"])(
    "rejects an empty formatted resolver address even when both stored copies match %j",
    async value => {
      const r = approvalRows();
      r.project.geocodedAddress = value;
      snapshot(r).reviewEvidence.geocode.formattedAddress = value;
      await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    }
  );
  it("preserves original address strings and explicit null/empty fields without fuzzy equality", async () => {
    const r = approvalRows();
    Object.assign(r.project, {
      address: "  1 Synthetic Lane\r\nUnit Ω  ",
      city: "Synthetic City",
      state: "SC",
      zip: "00000",
      county: "",
    });
    Object.assign(snapshot(r).reviewEvidence.inputAddress, {
      address: r.project.address,
      county: "",
    });
    const before = structuredClone(r);
    expect((await build(r, ctx)).evaluation.passed).toBe(true);
    expect(r).toEqual(before);
    r.project.address = r.project.address!.replace(/\r\n/g, "\n");
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    r.project.address = before.project.address;
    r.project.county = null;
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    snapshot(r).reviewEvidence.inputAddress.county = null;
    expect((await build(r, ctx)).evaluation.passed).toBe(true);
  });
  it("accepts equivalent decimal coordinate encodings without rewriting source values", async () => {
    const r = approvalRows();
    r.project.latitude = "3.275e1";
    r.project.longitude = "-79.900000000000000000";
    const before = structuredClone(r);
    expect((await build(r, ctx)).evaluation.passed).toBe(true);
    expect(r).toEqual(before);
  });
  it.each(["latitude", "longitude"] as const)(
    "rejects a stored %s discrepancy smaller than a double increment",
    async key => {
      const r = approvalRows();
      r.project[key] = key === "latitude" ? "32.7500000000000001" : "-79.9000000000000001";
      await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    }
  );
  it("does not trim formatted output when comparing it to the stored resolver result", async () => {
    const r = approvalRows();
    r.project.geocodedAddress += " ";
    await expect(build(r, ctx)).rejects.toMatchObject(policyError);
    snapshot(r).reviewEvidence.geocode.formattedAddress = r.project.geocodedAddress;
    const before = structuredClone(r);
    expect((await build(r, ctx)).evaluation.passed).toBe(true);
    expect(r).toEqual(before);
  });
});
