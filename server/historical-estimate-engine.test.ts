import { describe, expect, it } from "vitest";
import {
  assertHistoricalCaptureOnly, buildHistoricalDraftProjection, buildHistoricalSelection,
  canonicalHistoricalJson, decimalToMinorUnits, normalizeHistoricalSource,
  parseHistoricalDecimal, reconcileHistoricalSelection,
  historicalReconciliationSchema,
  type HistoricalSourceInput, type HistoricalSelectionInput,
} from "../shared/historical-estimate-engine";

const ids = {
  project: "10000000-0000-4000-8000-000000000001", client: "10000000-0000-4000-8000-000000000002",
  request: "10000000-0000-4000-8000-000000000003", source: "10000000-0000-4000-8000-000000000004",
  one: "10000000-0000-4000-8000-000000000005", two: "10000000-0000-4000-8000-000000000006",
  previous: "10000000-0000-4000-8000-000000000007",
};
const hash = "a".repeat(64);
function source(overrides: Partial<HistoricalSourceInput> = {}): HistoricalSourceInput {
  return {
    requestId: ids.request, projectId: ids.project, clientId: ids.client,
    sourceKind: "manual_transcription", sourceLabel: "Invented workshop quote", currencyCode: "USD", sourceFileId: null,
    declaredSubtotal: "210.45", declaredDiscount: null, declaredTax: null, declaredTotal: "210.45",
    declaredEstimatedCost: "120.30", commercialTermsText: null,
    rawTotals: { version: "historical-raw-totals-v1", subtotal: "210.45", discount: null, tax: null, total: "210.45", estimatedCost: "120.30" },
    lines: [0, 1].map(ordinal => ({
      sourceLineKey: `row-${ordinal + 1}`, ordinal, description: "Identical descriptions do not imply identity",
      quantity: ordinal === 0 ? "2" : "1", unit: "EA", unitPrice: "70.15", unitEstimatedCost: "40.10",
      linePrice: ordinal === 0 ? "140.30" : "70.15", lineEstimatedCost: ordinal === 0 ? "80.20" : "40.10",
      externalCodeSystem: "synthetic", externalCode: `SYN-${ordinal}`, taxable: ordinal === 0 ? null : false,
      rawValues: { version: "historical-raw-line-v1", quantity: ordinal === 0 ? "2" : "1", unitPrice: "70.15", unitEstimatedCost: "40.10", linePrice: ordinal === 0 ? "140.30" : "70.15", lineEstimatedCost: ordinal === 0 ? "80.20" : "40.10", taxable: null, externalCode: `SYN-${ordinal}` },
    })), ...overrides,
  };
}
function selection(overrides: Partial<HistoricalSelectionInput> = {}): HistoricalSelectionInput {
  const normalized = normalizeHistoricalSource(source());
  return {
    requestId: ids.request, projectId: ids.project, clientId: ids.client,
    source: { id: ids.source, projectId: ids.project, clientId: ids.client, currencyCode: "USD", contentHash: hash,
      lines: normalized.lines.map((line, index) => ({ ...line, id: index === 0 ? ids.one : ids.two, lineHash: index === 0 ? hash : "b".repeat(64) })) },
    selectedLineIds: [ids.one], declaredSelectedTotal: "140.30", declaredSelectedEstimatedCost: "80.20",
    rawSelectedTotals: { version: "historical-raw-selected-v1", total: "140.30", estimatedCost: "80.20" },
    reportedApprovalAt: null, reportedApprovalNote: null, priorImportId: null, expectedRevision: null,
    ...overrides,
  };
}

describe("H1 exact decimal input", () => {
  it("normalizes decimal identity without changing the source text", () => {
    expect(parseHistoricalDecimal("00017.2300")).toEqual({ normalized: "17.23", unscaled: 1723n, scale: 2 });
  });
  it("keeps the numeric(20,6) boundary exact above JS safe integer precision", () => {
    expect(parseHistoricalDecimal("99999999999999.999999").unscaled).toBe(99999999999999999999n);
  });
  it("returns cents exactly at the numeric(20,0) boundary", () => {
    expect(decimalToMinorUnits("999999999999999999.99")).toBe("99999999999999999999");
  });
  it("converts zero and one decimal dollar without rounding", () => {
    expect(decimalToMinorUnits("0")).toBe("0"); expect(decimalToMinorUnits("2.4")).toBe("240");
  });
  it.each(["1e2", "NaN", "Infinity", "-1", "+1", "1,000", " 1", "1.", ".5", ""])("rejects non-contract grammar %j", value => {
    expect(() => parseHistoricalDecimal(value)).toThrow();
  });
  it("rejects numeric coercion and excessive scale even if extra decimals are zeros", () => {
    expect(() => parseHistoricalDecimal(12 as never)).toThrow();
    expect(() => parseHistoricalDecimal("1.0000000")).toThrow();
    expect(() => decimalToMinorUnits("1.001")).toThrow();
  });
  it("rejects integer overflow rather than allowing PostgreSQL to round or truncate", () => {
    expect(() => parseHistoricalDecimal("100000000000000")).toThrow();
    expect(() => decimalToMinorUnits("1000000000000000000")).toThrow();
  });
});

describe("H1 stored reconciliation envelope", () => {
  const report = () => ({ version: "historical-reconciliation-v1", state: "unresolved", sumPriceMinor: "0", sumCostMinor: null,
    findings: [{ code: "missing_declared_cost", field: "cost" }] });
  it("preserves known zero and unknown money distinctly", () => {
    expect(historicalReconciliationSchema.parse(report())).toEqual(report());
  });
  it("rejects unexpected top-level authority fields", () => {
    expect(historicalReconciliationSchema.safeParse({ ...report(), approved: true }).success).toBe(false);
  });
  it("rejects unexpected nested authority fields", () => {
    expect(historicalReconciliationSchema.safeParse({ ...report(), findings: [{ ...report().findings[0], approved: true }] }).success).toBe(false);
  });
  it("rejects non-contract monetary sums instead of coercing them", () => {
    for (const sumPriceMinor of [0, "-1", "1.5", "01", "1".repeat(21)]) expect(historicalReconciliationSchema.safeParse({ ...report(), sumPriceMinor }).success).toBe(false);
  });
  it("rejects unknown finding vocabulary and null version", () => {
    expect(historicalReconciliationSchema.safeParse({ ...report(), version: null }).success).toBe(false);
    expect(historicalReconciliationSchema.safeParse({ ...report(), findings: [{ code: "approved", field: "cost" }] }).success).toBe(false);
  });
  it("retains an exact extended mismatch beyond the storage limit as evidence", () => {
    const result = { ...report(), state: "mismatch", findings: [{ code: "price_extension_mismatch", field: "price", expectedMinor: "999999999999999999999999999999", actualMinor: "1" }] };
    expect(historicalReconciliationSchema.parse(result)).toEqual(result);
  });
});

describe("H1 immutable source representation", () => {
  it("preserves the complete source and distinct stable keys despite identical descriptions", () => {
    const result = normalizeHistoricalSource(source());
    expect(result.expectedLineCount).toBe(2); expect(result.lines.map(l => l.sourceLineKey)).toEqual(["row-1", "row-2"]);
    expect(result.lines.map(l => l.linePriceMinor)).toEqual(["14030", "7015"]);
  });
  it("preserves false, unknown taxation, codes and literal source formatting", () => {
    const input = source(); input.rawTotals.total = "$ 210.45"; input.lines[0].rawValues.unitPrice = "$70.1500";
    const result = normalizeHistoricalSource(input);
    expect(result.rawTotals.total).toBe("$ 210.45"); expect(result.lines[0].rawValues.unitPrice).toBe("$70.1500");
    expect(result.lines[0].taxable).toBeNull(); expect(result.lines[1].taxable).toBe(false); expect(result.lines[0].externalCode).toBe("SYN-0");
  });
  it("does not normalize any monetary field without known currency", () => {
    const result = normalizeHistoricalSource(source({ currencyCode: null }));
    expect([result.declaredSubtotalMinor, result.declaredDiscountMinor, result.declaredTaxMinor, result.declaredTotalMinor, result.declaredEstimatedCostMinor]).toEqual([null, null, null, null, null]);
    expect(result.lines[0]).toMatchObject({ quantity: "2", unitPrice: null, unitEstimatedCost: null, linePriceMinor: null, lineEstimatedCostMinor: null });
    expect(result.rawTotals.total).toBe("210.45"); expect(result.lines[0].rawValues.linePrice).toBe("140.30");
  });
  it("retains unknown costs and totals instead of fabricating zeros", () => {
    const input = source({ declaredEstimatedCost: null }); input.lines[0].lineEstimatedCost = null; input.lines[0].unitEstimatedCost = null;
    const result = normalizeHistoricalSource(input); expect(result.declaredEstimatedCostMinor).toBeNull(); expect(result.lines[0].lineEstimatedCostMinor).toBeNull();
  });
  it("rejects empty sources and duplicate keys or ordinals", () => {
    expect(() => normalizeHistoricalSource(source({ lines: [] }))).toThrow();
    const input = source(); input.lines[1].sourceLineKey = input.lines[0].sourceLineKey;
    expect(() => normalizeHistoricalSource(input)).toThrow(); input.lines[1].sourceLineKey = "another"; input.lines[1].ordinal = 0;
    expect(() => normalizeHistoricalSource(input)).toThrow();
  });
  it("rejects an extraction without its authorized file identifier and non-USD currency", () => {
    expect(() => normalizeHistoricalSource(source({ sourceKind: "file_extract" }))).toThrow();
    expect(() => normalizeHistoricalSource(source({ currencyCode: "EUR" as never }))).toThrow();
  });
  it("rejects extra raw fields and values too long rather than accepting authority metadata", () => {
    const input = source(); (input.rawTotals as any).approved = true;
    expect(() => normalizeHistoricalSource(input)).toThrow();
    expect(() => normalizeHistoricalSource(source({ sourceLabel: "x".repeat(256) }))).toThrow();
  });
  it("sorts object keys canonically, preserving array order and distinguishing null and zero", () => {
    expect(canonicalHistoricalJson({ b: null, a: ["0", null] })).toBe('{"a":["0",null],"b":null}');
    expect(canonicalHistoricalJson({ b: null, a: ["0", null] })).not.toBe(canonicalHistoricalJson({ b: "0", a: [null, "0"] }));
    expect(() => canonicalHistoricalJson({ a: undefined })).toThrow(); expect(() => canonicalHistoricalJson({ a: NaN })).toThrow();
  });
  it("content identity excludes retry ID; request identity and source changes remain detectable", () => {
    const first = normalizeHistoricalSource(source()); const retry = normalizeHistoricalSource(source({ requestId: ids.previous }));
    expect(first.canonicalContent).toBe(retry.canonicalContent); expect(first.canonicalRequest).not.toBe(retry.canonicalRequest);
    const changed = source(); changed.lines[0].taxable = false;
    expect(normalizeHistoricalSource(changed).canonicalContent).not.toBe(first.canonicalContent);
  });
  it("does not mutate input objects", () => {
    const input = source(); const copy = structuredClone(input); const result = normalizeHistoricalSource(input);
    result.lines[0].rawValues.linePrice = "changed result"; expect(input).toEqual(copy);
  });
});

describe("H1 exact partial selections and reconciliation", () => {
  it("selects whole lines by UUID; excluded lines do not enter selected totals", () => {
    const result = buildHistoricalSelection(selection()); expect(result.expectedLineCount).toBe(1);
    expect(result.selectedLines.map(l => l.id)).toEqual([ids.one]); expect(result.declaredSelectedTotalMinor).toBe("14030");
    expect(result.reconciliation.state).toBe("matched"); expect(result.reconciliation.sumPriceMinor).toBe("14030");
  });
  it("supports the complete selection without turning it into approval", () => {
    const result = buildHistoricalSelection(selection({ selectedLineIds: [ids.one, ids.two], declaredSelectedTotal: "210.45", declaredSelectedEstimatedCost: "120.30" }));
    expect(result.reconciliation.state).toBe("matched"); expect(buildHistoricalDraftProjection(result).status).toBe("draft");
  });
  it("unknown excluded costs do not make the known selected cost unresolved", () => {
    const input = selection(); input.source.lines[1].lineEstimatedCostMinor = null; input.source.lines[1].unitEstimatedCost = null;
    expect(buildHistoricalSelection(input).reconciliation.state).toBe("matched");
  });
  it("preserves mismatching totals and reports their difference without correcting price", () => {
    const result = buildHistoricalSelection(selection({ declaredSelectedTotal: "142.00" }));
    expect(result.declaredSelectedTotalMinor).toBe("14200"); expect(result.selectedLines[0].linePriceMinor).toBe("14030");
    expect(result.reconciliation.state).toBe("mismatch"); expect(result.reconciliation.findings.map(f => f.code)).toContain("price_total_mismatch");
  });
  it("unknown cost remains unresolved and is never projected as zero", () => {
    const input = selection({ declaredSelectedEstimatedCost: null }); input.source.lines[0].lineEstimatedCostMinor = null; input.source.lines[0].unitEstimatedCost = null;
    const result = buildHistoricalSelection(input); expect(result.reconciliation.state).toBe("unresolved");
    expect(buildHistoricalDraftProjection(result).subtotalCost).toBeNull();
  });
  it("unknown currency keeps selected raw totals but no normalized money or financial projection", () => {
    const input = selection(); input.source.currencyCode = null;
    const result = buildHistoricalSelection(input);
    expect(result.reconciliation.state).toBe("unresolved"); expect(result.declaredSelectedTotalMinor).toBeNull(); expect(result.declaredSelectedEstimatedCostMinor).toBeNull();
    expect(result.rawSelectedTotals.total).toBe("140.30");
    expect(result.selectedLines[0].unitPrice).toBeNull(); expect(result.selectedLines[0].linePriceMinor).toBeNull();
    expect(buildHistoricalDraftProjection(result)).toMatchObject({ finalTotalPrice: null, subtotalPrice: null, subtotalCost: null, grossProfit: null, grossProfitPct: null });
  });
  it("rejects duplicate, missing, foreign source lines and identity mismatches", () => {
    expect(() => buildHistoricalSelection(selection({ selectedLineIds: [] }))).toThrow();
    expect(() => buildHistoricalSelection(selection({ selectedLineIds: [ids.one, ids.one] }))).toThrow();
    expect(() => buildHistoricalSelection(selection({ selectedLineIds: [ids.previous] }))).toThrow();
    expect(() => buildHistoricalSelection(selection({ projectId: ids.previous }))).toThrow();
    expect(() => buildHistoricalSelection(selection({ clientId: ids.previous }))).toThrow();
  });
  it("requires a coherent predecessor/revision pair, producing the next immutable revision", () => {
    expect(() => buildHistoricalSelection(selection({ priorImportId: ids.previous }))).toThrow();
    expect(() => buildHistoricalSelection(selection({ expectedRevision: 1 }))).toThrow();
    expect(buildHistoricalSelection(selection({ priorImportId: ids.previous, expectedRevision: 3 })).revision).toBe(4);
  });
  it("hash identity includes reported facts/raw totals and selection order", () => {
    const first = buildHistoricalSelection(selection());
    expect(buildHistoricalSelection(selection({ reportedApprovalNote: "Operator-reported only" })).canonicalContent).not.toBe(first.canonicalContent);
    expect(buildHistoricalSelection(selection({ rawSelectedTotals: { version: "historical-raw-selected-v1", total: "$140.30", estimatedCost: "80.20" } })).canonicalContent).not.toBe(first.canonicalContent);
    const all = selection({ selectedLineIds: [ids.one, ids.two] });
    expect(buildHistoricalSelection(all).canonicalContent).not.toBe(buildHistoricalSelection({ ...all, selectedLineIds: [ids.two, ids.one] }).canonicalContent);
  });
  it("detects fractional-cent extensions without choosing an accepted-price rounding rule", () => {
    const line = normalizeHistoricalSource(source()).lines[0];
    const result = reconcileHistoricalSelection({ currencyCode: "USD", lines: [{ ...line, quantity: "0.5", unitPrice: "0.01", linePriceMinor: "1", unitEstimatedCost: "0.01", lineEstimatedCostMinor: "1" }], declaredSelectedTotalMinor: "1", declaredSelectedEstimatedCostMinor: "1" });
    expect(result.state).toBe("unresolved"); expect(result.findings.map(f => f.code)).toContain("fractional_minor_extension");
    expect(result.sumPriceMinor).toBe("1");
  });
  it("distinguishes an exact extension mismatch from total mismatch", () => {
    const line = normalizeHistoricalSource(source()).lines[0];
    const result = reconcileHistoricalSelection({ currencyCode: "USD", lines: [{ ...line, quantity: "3" }], declaredSelectedTotalMinor: "14030", declaredSelectedEstimatedCostMinor: "8020" });
    expect(result.state).toBe("mismatch"); expect(result.findings.map(f => f.code)).toContain("price_extension_mismatch");
    expect(result.findings.map(f => f.code)).not.toContain("price_total_mismatch");
  });
  it("does not hide a known mismatch behind a different missing cost", () => {
    const result = buildHistoricalSelection(selection({ declaredSelectedTotal: "142.00", declaredSelectedEstimatedCost: null }));
    expect(result.reconciliation.state).toBe("mismatch");
  });
  it("rejects invalid reported dates and immutable snapshot ambiguity", () => {
    expect(() => buildHistoricalSelection(selection({ reportedApprovalAt: "2026-02-30T00:00:00Z" }))).toThrow();
    const input = selection(); input.source.lines[1].id = ids.one;
    expect(() => buildHistoricalSelection(input)).toThrow();
  });
  it("projects only recorded values, never margin, approval, discount allocation or line defaults", () => {
    const result = buildHistoricalDraftProjection(buildHistoricalSelection(selection()));
    expect(result).toMatchObject({ source: "historical_import", status: "draft", projectId: ids.project, clientId: ids.client, finalTotalPrice: "140.30", subtotalCost: "80.20", subtotalPrice: null, discountAmount: null, discountApplied: null, approvedBy: null, approvedAt: null, lockedAt: null, profitShieldEvaluation: null, profitShieldPassed: null, pricingSnapshot: null, lineItems: null, grossProfit: null, grossProfitPct: null });
  });
  it("known sums that exceed storage bounds are refused instead of overflowing", () => {
    const input = selection({ selectedLineIds: [ids.one, ids.two] });
    for (const line of input.source.lines) line.linePriceMinor = "99999999999999999999";
    expect(() => buildHistoricalSelection(input)).toThrow();
  });
});

describe("H1 cannot grant authority", () => {
  it.each(["approve", "export", "convert", "version", "discount", "execute"])("blocks %s by historical source or durable linkage", action => {
    expect(() => assertHistoricalCaptureOnly({ source: "historical_import" }, action)).toThrow(/HISTORICAL_AUTHORITY_NOT_AVAILABLE/);
    expect(() => assertHistoricalCaptureOnly({ source: "version", hasHistoricalImport: true }, action)).toThrow(/HISTORICAL_AUTHORITY_NOT_AVAILABLE/);
  });
  it("preserves ordinary calculated records' authority behavior", () => {
    expect(() => assertHistoricalCaptureOnly({ source: "assembly_calculator", hasHistoricalImport: false }, "approve")).not.toThrow();
  });
});
