import type { HistoricalFinding, HistoricalReconciliation } from "@shared/historical-estimate-engine";

export function formatHistoricalMoney(minor: string | null, currency: string | null, raw: string | null): string {
  if (currency !== "USD") return `${raw || "Not provided"} · Currency not provided`;
  if (minor === null) return "Not provided";
  const cents = minor.padStart(3, "0");
  return `$${cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.slice(-2)}`;
}
export function HistoricalCaptureNotice() {
  return <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
    <strong>Historical record</strong><p>Original values and selected scope are preserved. Approval, export and field execution are unavailable for this record.</p>
  </div>;
}
export type HistoricalDisplayLine = {
  id: string; description: string|null; quantity: string|null; unit: string|null;
  unitPrice?: string|null; unitEstimatedCost?: string|null; externalCodeSystem?: string|null; externalCode?: string|null;
  linePriceMinor: string|null; lineEstimatedCostMinor: string|null; taxable: boolean|null;
  rawValues: { quantity?: string|null; unitPrice?: string|null; unitEstimatedCost?: string|null; externalCode?: string|null; linePrice: string|null; lineEstimatedCost: string|null };
};
export function HistoricalLines({ lines, currencyCode, selected, onToggle }: { lines: HistoricalDisplayLine[]; currencyCode: string|null; selected?: string[]; onToggle?: (id:string)=>void }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>
    {onToggle && <th className="p-2">Include</th>}<th className="p-2">Scope</th><th className="p-2">Quantity</th><th className="p-2">Price</th><th className="p-2">Estimated cost</th><th className="p-2">Taxable</th>
  </tr></thead><tbody>{lines.map((line, index) => <tr key={line.id} className="border-t border-border">
    {onToggle && <td className="p-2"><input aria-label={`Include line ${index + 1}: ${line.description || "Not provided"}`} type="checkbox" checked={selected?.includes(line.id) ?? false} onChange={() => onToggle(line.id)} /></td>}
    <td className="p-2">{line.description || "Not provided"}<details className="mt-2 min-w-56"><summary className="cursor-pointer text-muted-foreground">Recorded line details</summary><dl className="space-y-1 mt-2">
      <div><dt className="font-medium">Quantity as recorded</dt><dd className="whitespace-pre-wrap">{line.rawValues.quantity ?? line.quantity ?? "Not provided"} {line.unit}</dd></div>
      <div><dt className="font-medium">Unit price as recorded</dt><dd className="whitespace-pre-wrap">{line.rawValues.unitPrice ?? line.unitPrice ?? "Not provided"}{currencyCode !== "USD" && " · Currency not provided"}</dd></div>
      <div><dt className="font-medium">Unit estimated cost as recorded</dt><dd className="whitespace-pre-wrap">{line.rawValues.unitEstimatedCost ?? line.unitEstimatedCost ?? "Not provided"}{currencyCode !== "USD" && " · Currency not provided"}</dd></div>
      <div><dt className="font-medium">Line price as recorded</dt><dd className="whitespace-pre-wrap">{line.rawValues.linePrice ?? "Not provided"}</dd></div>
      <div><dt className="font-medium">Line estimated cost as recorded</dt><dd className="whitespace-pre-wrap">{line.rawValues.lineEstimatedCost ?? "Not provided"}</dd></div>
      <div><dt className="font-medium">Code system</dt><dd>{line.externalCodeSystem ?? "Not provided"}</dd></div>
      <div><dt className="font-medium">External code</dt><dd className="whitespace-pre-wrap">{line.rawValues.externalCode ?? line.externalCode ?? "Not provided"}</dd></div>
    </dl></details></td><td className="p-2">{line.quantity ?? "Not provided"} {line.unit}</td>
    <td className="p-2">{formatHistoricalMoney(line.linePriceMinor, currencyCode, line.rawValues.linePrice)}</td>
    <td className="p-2">{formatHistoricalMoney(line.lineEstimatedCostMinor, currencyCode, line.rawValues.lineEstimatedCost)}</td>
    <td className="p-2">{line.taxable === null ? "Not provided" : line.taxable ? "Yes" : "No"}</td>
  </tr>)}</tbody></table></div>;
}

type HistoricalTotalsSource = {
  currencyCode: string|null;
  declaredSubtotalMinor: string|null; declaredDiscountMinor: string|null; declaredTaxMinor: string|null;
  declaredTotalMinor: string|null; declaredEstimatedCostMinor: string|null;
  rawTotals: { subtotal: string|null; discount: string|null; tax: string|null; total: string|null; estimatedCost: string|null };
};
export function HistoricalOriginalTotals({ source }: { source: HistoricalTotalsSource }) {
  const fields = [
    ["Subtotal", source.declaredSubtotalMinor, source.rawTotals.subtotal],
    ["Discount", source.declaredDiscountMinor, source.rawTotals.discount],
    ["Tax", source.declaredTaxMinor, source.rawTotals.tax],
    ["Total", source.declaredTotalMinor, source.rawTotals.total],
    ["Estimated cost", source.declaredEstimatedCostMinor, source.rawTotals.estimatedCost],
  ] as const;
  return <details className="rounded border p-3"><summary className="cursor-pointer font-medium">Original proposal totals</summary>
    <p className="text-sm text-muted-foreground mt-2">Recorded text is preserved exactly. These full-proposal amounts are not allocated to the selected scope.</p>
    <dl className="grid gap-3 mt-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label, minor, raw]) => <div key={label}>
      <dt className="font-medium">{label}</dt><dd>{formatHistoricalMoney(minor, source.currencyCode, raw)}</dd>
      <dd className="text-sm text-muted-foreground whitespace-pre-wrap">As recorded: {raw ?? "Not provided"}</dd>
    </div>)}</dl>
  </details>;
}

const findingText: Record<HistoricalFinding["code"], string> = {
  unknown_currency: "Currency was not provided; amounts cannot be compared",
  missing_line_price: "Line price was not provided",
  missing_line_cost: "Line estimated cost was not provided",
  missing_declared_total: "Selected total was not provided",
  missing_declared_cost: "Selected estimated cost was not provided",
  price_total_mismatch: "Selected line prices differ from the reported selected total",
  cost_total_mismatch: "Selected line costs differ from the reported selected estimated cost",
  price_extension_mismatch: "Quantity × unit price differs from the recorded line price",
  cost_extension_mismatch: "Quantity × unit estimated cost differs from the recorded line cost",
  fractional_minor_extension: "Quantity × unit rate produces a fraction of a cent; no rounding rule was applied",
  incomplete_extension: "Quantity or unit rate is missing; the line amount cannot be checked",
};
const reconciliationText: Record<HistoricalReconciliation["state"], string> = {
  unresolved: "Some recorded details need confirmation",
  matched: "Recorded amounts reconcile",
  mismatch: "Recorded amounts differ",
};
export function HistoricalReconciliationDetails({ reconciliation, currencyCode, lines }: {
  reconciliation: HistoricalReconciliation; currencyCode: string|null;
  lines: { sourceLineKey: string; description: string|null }[];
}) {
  return <section className="rounded border p-3 space-y-2" aria-label="Recorded amount checks">
    <h3 className="font-semibold">{reconciliationText[reconciliation.state]}</h3>
    <p className="text-sm text-muted-foreground">This comparison does not grant approval or permission to start work.</p>
    <p className="text-sm">Selected line prices: {formatHistoricalMoney(reconciliation.sumPriceMinor, currencyCode, null)} · Selected line estimated costs: {formatHistoricalMoney(reconciliation.sumCostMinor, currencyCode, null)}</p>
    {reconciliation.findings.length > 0 && <ul className="space-y-3 text-sm">{reconciliation.findings.map((finding, index) => {
      const lineIndex = finding.sourceLineKey ? lines.findIndex(line => line.sourceLineKey === finding.sourceLineKey) : -1;
      const line = lineIndex < 0 ? undefined : lines[lineIndex];
      return <li key={index} className="border-t pt-2">
        {finding.sourceLineKey && <p className="font-medium">{line ? `Line ${lineIndex + 1} · ${line.description || "Not provided"}` : `Source line ${finding.sourceLineKey}`}</p>}
        <p>{findingText[finding.code]}{finding.field === "currency" ? "." : ` (${finding.field === "cost" ? "estimated cost" : "price"}).`}</p>
        {finding.expectedMinor !== undefined && <p>Expected: {formatHistoricalMoney(finding.expectedMinor, currencyCode, null)}</p>}
        {finding.actualMinor !== undefined && <p>Reported: {formatHistoricalMoney(finding.actualMinor, currencyCode, null)}</p>}
      </li>;
    })}</ul>}
  </section>;
}
