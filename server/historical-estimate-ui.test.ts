import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatHistoricalMoney, HistoricalCaptureNotice, HistoricalLines, HistoricalOriginalTotals, HistoricalReconciliationDetails } from "../client/src/components/historical-estimates/HistoricalSourceView";

describe("historical presentation preserves evidence", () => {
  it("formats minor units beyond Number's exact range", () => { expect(formatHistoricalMoney("99999999999999999999", "USD", null)).toBe("$999,999,999,999,999,999.99"); });
  it("displays explicit zero distinctly from missing cost", () => { expect(formatHistoricalMoney("0", "USD", null)).toBe("$0.00"); expect(formatHistoricalMoney(null, "USD", null)).toBe("Not provided"); });
  it("does not label unknown currency as USD", () => { expect(formatHistoricalMoney(null, null, "1.200,00")).toBe("1.200,00 · Currency not provided"); });
  it("does not use normalized money when currency is unknown", () => { expect(formatHistoricalMoney("120000", null, "1200")).not.toContain("$"); });
  it("explains capture without claiming customer or execution approval", () => { const html = renderToStaticMarkup(createElement(HistoricalCaptureNotice)); expect(html).toContain("Historical record"); expect(html).toContain("Approval, export and field execution are unavailable"); });
  it("renders nullable taxability and costs without defaults", () => { const html = renderToStaticMarkup(createElement(HistoricalLines, { currencyCode: "USD", lines: [{ id: "one", description: "Cabinet", quantity: null, unit: null, linePriceMinor: "12345", lineEstimatedCostMinor: null, taxable: null, rawValues: { linePrice: "123.45", lineEstimatedCost: null } }] })); expect(html).toContain("$123.45"); expect(html).toContain("Not provided"); expect(html).not.toContain("$0.00"); });
  it("escapes source text instead of rendering markup from the proposal", () => { const html = renderToStaticMarkup(createElement(HistoricalLines, { currencyCode: null, lines: [{ id: "one", description: '<script>alert("x")</script>', quantity: null, unit: null, linePriceMinor: null, lineEstimatedCostMinor: null, taxable: null, rawValues: { linePrice: "<b>100</b>", lineEstimatedCost: null } }] })); expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("Currency not provided"); });
  it("exposes original quantity, rates and codes without changing their text", () => {
    const html = renderToStaticMarkup(createElement(HistoricalLines, { currencyCode: "USD", lines: [{ id: "one", description: "Synthetic line", quantity: "2.5", unit: "ea", unitPrice: "4.25", unitEstimatedCost: null, externalCodeSystem: "SOURCE-CATALOG", externalCode: "001-AB", linePriceMinor: "1063", lineEstimatedCostMinor: null, taxable: null, rawValues: { quantity: "0002.500000", unitPrice: "0004.250000", unitEstimatedCost: null, externalCode: "001-AB", linePrice: "010.63", lineEstimatedCost: null } }] }));
    for (const text of ["0002.500000", "0004.250000", "001-AB", "SOURCE-CATALOG", "010.63", "Unit estimated cost"]) expect(html).toContain(text);
  });
  it("shows raw rates with unknown currency without a fabricated dollar amount", () => {
    const html = renderToStaticMarkup(createElement(HistoricalLines, { currencyCode: null, lines: [{ id: "one", description: null, quantity: null, unit: null, unitPrice: null, unitEstimatedCost: null, linePriceMinor: null, lineEstimatedCostMinor: null, taxable: null, rawValues: { unitPrice: "1.234,567800", unitEstimatedCost: "unconfirmed", linePrice: null, lineEstimatedCost: null } }] }));
    expect(html).toContain("1.234,567800"); expect(html).toContain("unconfirmed"); expect(html).toContain("Currency not provided"); expect(html).not.toContain("$");
  });
  it("shows all original totals while distinguishing reported text, zero and unknown", () => {
    const html = renderToStaticMarkup(createElement(HistoricalOriginalTotals, { source: { currencyCode: "USD", declaredSubtotalMinor: "10000", declaredDiscountMinor: "0", declaredTaxMinor: null, declaredTotalMinor: "10000", declaredEstimatedCostMinor: null, rawTotals: { subtotal: "0100.00", discount: "00.00", tax: null, total: "100.00", estimatedCost: null } } }));
    for (const text of ["Subtotal", "Discount", "Tax", "Total", "Estimated cost", "0100.00", "00.00", "$0.00", "Not provided"]) expect(html).toContain(text);
  });
  it("preserves raw original totals when currency is missing", () => {
    const html = renderToStaticMarkup(createElement(HistoricalOriginalTotals, { source: { currencyCode: null, declaredSubtotalMinor: null, declaredDiscountMinor: null, declaredTaxMinor: null, declaredTotalMinor: null, declaredEstimatedCostMinor: null, rawTotals: { subtotal: null, discount: "unknown", tax: null, total: "1.200,00", estimatedCost: null } } }));
    expect(html).toContain("1.200,00"); expect(html).toContain("unknown"); expect(html).toContain("Currency not provided"); expect(html).not.toContain("$");
  });
  it("explains a line mismatch with exact expected and reported amounts", () => {
    const html = renderToStaticMarkup(createElement(HistoricalReconciliationDetails, { currencyCode: "USD", lines: [{ sourceLineKey: "row-2", description: "Synthetic shelf" }], reconciliation: { version: "historical-reconciliation-v1", state: "mismatch", sumPriceMinor: "12500", sumCostMinor: null, findings: [{ code: "price_extension_mismatch", field: "price", sourceLineKey: "row-2", expectedMinor: "999999999999999999999999999999", actualMinor: "12500" }] } }));
    expect(html).toContain("Quantity × unit price differs from the recorded line price"); expect(html).toContain("Synthetic shelf"); expect(html).toContain("Expected"); expect(html).toContain("Reported"); expect(html).toContain("$9,999,999,999,999,999,999,999,999,999.99"); expect(html).toContain("$125.00"); expect(html).not.toContain("price_extension_mismatch");
  });
  it("explains missing details without inventing expected values", () => {
    const html = renderToStaticMarkup(createElement(HistoricalReconciliationDetails, { currencyCode: "USD", lines: [{ sourceLineKey: "row-1", description: "Synthetic work" }], reconciliation: { version: "historical-reconciliation-v1", state: "unresolved", sumPriceMinor: null, sumCostMinor: null, findings: [{ code: "missing_line_cost", field: "cost", sourceLineKey: "row-1" }, { code: "fractional_minor_extension", field: "price", sourceLineKey: "row-1" }] } }));
    expect(html).toContain("Line estimated cost was not provided"); expect(html).toContain("fraction of a cent"); expect(html).toContain("Synthetic work"); expect(html).not.toContain("$0.00"); expect(html).not.toContain("Expected:");
  });
  it("keeps a matched capture distinct from commercial authority", () => {
    const html = renderToStaticMarkup(createElement(HistoricalReconciliationDetails, { currencyCode: "USD", lines: [], reconciliation: { version: "historical-reconciliation-v1", state: "matched", sumPriceMinor: "12300", sumCostMinor: "3000", findings: [] } }));
    expect(html).toContain("Recorded amounts reconcile"); expect(html).toContain("does not grant approval or permission to start work"); expect(html).toContain("$123.00"); expect(html).toContain("$30.00");
  });
});
