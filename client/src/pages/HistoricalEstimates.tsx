import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoricalCaptureNotice, HistoricalLines, HistoricalOriginalTotals, HistoricalReconciliationDetails, formatHistoricalMoney } from "@/components/historical-estimates/HistoricalSourceView";
import type { HistoricalSourceInput } from "@shared/historical-estimate-engine";
import { toast } from "sonner";

const nullable = (value: string) => value.trim() ? value : null;
const emptyLine = () => ({ key: crypto.randomUUID(), description: "", quantity: "", unit: "", unitPrice: "", unitEstimatedCost: "", linePrice: "", lineEstimatedCost: "", externalCodeSystem: "", externalCode: "", taxable: "" });
const fieldClass = "rounded border border-input bg-background p-2 text-sm w-full";
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v:string)=>void }) {
  return <label className="block text-sm space-y-1"><span>{label}</span><Input value={value} onChange={event => onChange(event.target.value)} /></label>;
}

export default function HistoricalEstimates() {
  const params = new URLSearchParams(window.location.search);
  const [projectId, setProjectId] = useState(params.get("projectId") ?? "");
  const [sourceId, setSourceId] = useState(params.get("source") ?? "");
  const [importId, setImportId] = useState(params.get("import") ?? "");
  const [showForm, setShowForm] = useState(false);
  const [sourceRequest, setSourceRequest] = useState(() => crypto.randomUUID());
  const [selectionRequest, setSelectionRequest] = useState(() => crypto.randomUUID());
  const [label, setLabel] = useState("");
  const [currency, setCurrency] = useState<"USD"|"">("");
  const [totals, setTotals] = useState({ subtotal: "", discount: "", tax: "", total: "", estimatedCost: "" });
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedTotal, setSelectedTotal] = useState("");
  const [selectedCost, setSelectedCost] = useState("");
  const [reportedNote, setReportedNote] = useState("");
  const [error, setError] = useState("");
  const projects = trpc.project.list.useQuery({ limit: 100 });
  const project = projects.data?.items.find(item => item.id === projectId);
  const sourceList = trpc.historicalEstimate.listSources.useQuery({ projectId, limit: 100 }, { enabled: !!projectId });
  const source = trpc.historicalEstimate.getSource.useQuery({ sourceId }, { enabled: !!sourceId && !importId });
  const imported = trpc.historicalEstimate.getImport.useQuery({ importId }, { enabled: !!importId });
  const record = trpc.historicalEstimate.recordSource.useMutation({ onError: e => setError(e.message) });
  const capture = trpc.estimate.importHistorical.useMutation({ onError: e => setError(e.message) });
  const current = imported.data?.source ?? source.data;
  function resetSourceForm() {
    setLabel(""); setCurrency(""); setTotals({ subtotal: "", discount: "", tax: "", total: "", estimatedCost: "" });
    setTerms(""); setLines([emptyLine()]); setSourceRequest(crypto.randomUUID());
  }
  function openImport(id: string) { setImportId(id); setError(""); window.history.replaceState(null, "", `/historical-estimates?import=${id}`); }
  function openSource(id: string) { setSourceId(id); setImportId(""); setSelected([]); setSelectedTotal(""); setSelectedCost(""); setReportedNote(""); setSelectionRequest(crypto.randomUUID()); setError(""); window.history.replaceState(null, "", `/historical-estimates?projectId=${projectId}&source=${id}`); }
  async function saveSource(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!project?.clientId) { setError("Choose a project with a linked client before recording this proposal."); return; }
    const input: HistoricalSourceInput = {
      requestId: sourceRequest, projectId: project.id, clientId: project.clientId, sourceKind: "manual_transcription", sourceLabel: label,
      currencyCode: currency || null, sourceFileId: null, declaredSubtotal: currency ? nullable(totals.subtotal) : null,
      declaredDiscount: currency ? nullable(totals.discount) : null, declaredTax: currency ? nullable(totals.tax) : null,
      declaredTotal: currency ? nullable(totals.total) : null, declaredEstimatedCost: currency ? nullable(totals.estimatedCost) : null,
      commercialTermsText: nullable(terms), rawTotals: { version: "historical-raw-totals-v1", ...Object.fromEntries(Object.entries(totals).map(([k,v]) => [k, nullable(v)])) } as HistoricalSourceInput["rawTotals"],
      lines: lines.map((line, ordinal) => ({ sourceLineKey: line.key, ordinal, description: nullable(line.description), quantity: nullable(line.quantity), unit: nullable(line.unit),
        unitPrice: currency ? nullable(line.unitPrice) : null, unitEstimatedCost: currency ? nullable(line.unitEstimatedCost) : null,
        linePrice: currency ? nullable(line.linePrice) : null, lineEstimatedCost: currency ? nullable(line.lineEstimatedCost) : null,
        taxable: line.taxable === "" ? null : line.taxable === "yes", externalCodeSystem: nullable(line.externalCodeSystem), externalCode: nullable(line.externalCode),
        rawValues: { version: "historical-raw-line-v1", quantity: nullable(line.quantity), unitPrice: nullable(line.unitPrice), unitEstimatedCost: nullable(line.unitEstimatedCost), linePrice: nullable(line.linePrice), lineEstimatedCost: nullable(line.lineEstimatedCost), taxable: nullable(line.taxable), externalCode: nullable(line.externalCode) },
      })),
    };
    try { const result = await record.mutateAsync(input); setShowForm(false); setSourceRequest(crypto.randomUUID()); await sourceList.refetch(); openSource(result.sourceId); toast.success("Original proposal recorded"); } catch { /* mutation displays the failure; request ID stays stable for retry */ }
  }
  async function saveSelection() {
    if (!current || !selected.length) return;
    setError("");
    try {
      const result = await capture.mutateAsync({ requestId: selectionRequest, projectId: current.projectId, clientId: current.clientId, sourceId: current.id, selectedLineIds: selected,
        declaredSelectedTotal: current.currencyCode ? nullable(selectedTotal) : null, declaredSelectedEstimatedCost: current.currencyCode ? nullable(selectedCost) : null,
        rawSelectedTotals: { version: "historical-raw-selected-v1", total: nullable(selectedTotal), estimatedCost: nullable(selectedCost) },
        reportedApprovalAt: null, reportedApprovalNote: nullable(reportedNote), priorImportId: null, expectedRevision: null });
      setSelectionRequest(crypto.randomUUID()); openImport(result.importId); toast.success("Selected scope recorded");
    } catch { /* keep the same request ID for retry */ }
  }
  const queryError = projects.error ?? sourceList.error ?? source.error ?? imported.error;
  return <div className="max-w-6xl mx-auto space-y-5 pb-12">
    <div><h1 className="text-2xl font-bold">Historical estimates</h1><p className="text-muted-foreground">Record an existing proposal and the scope selected for a later phase.</p></div>
    <HistoricalCaptureNotice />
    {(error || queryError) && <p role="alert" className="text-red-500">{error || queryError?.message}</p>}
    <div className="flex items-end gap-3"><label className="flex-1 text-sm space-y-1"><span>Existing project</span><select className={fieldClass} aria-label="Existing project" value={projectId} onChange={event => { const nextProjectId = event.target.value; setProjectId(nextProjectId); resetSourceForm(); setSourceId(""); setImportId(""); setShowForm(false); setError(""); window.history.replaceState(null, "", nextProjectId ? `/historical-estimates?projectId=${encodeURIComponent(nextProjectId)}` : "/historical-estimates"); }}>
      <option value="">Choose a project</option>{projects.data?.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.clientName || "Client not linked"}</option>)}
    </select></label><Button disabled={!project?.clientId} onClick={() => { resetSourceForm(); setShowForm(true); setSourceId(""); setImportId(""); }}>Record original proposal</Button></div>
    {projectId && !project?.clientId && !projects.isLoading && <p className="text-sm">Link the correct client to this project before recording a historical estimate.</p>}
    {showForm && <form onSubmit={saveSource} className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Transcribe the complete original proposal</h2><p className="text-sm text-muted-foreground">Leave missing details blank. Enter recorded amounts exactly; no current catalog prices are applied.</p>
      <div className="grid md:grid-cols-2 gap-3"><TextField label="Source description" value={label} onChange={setLabel} /><label className="text-sm space-y-1"><span>Currency stated in the source</span><select className={fieldClass} value={currency} onChange={e => setCurrency(e.target.value as "USD"|"")}><option value="">Not provided</option><option value="USD">USD</option></select></label></div>
      <div className="grid md:grid-cols-5 gap-3">{Object.keys(totals).map(key => <TextField key={key} label={`Original ${key === "estimatedCost" ? "estimated cost" : key}`} value={totals[key as keyof typeof totals]} onChange={value => setTotals(prev => ({ ...prev, [key]: value }))} />)}</div>
      {lines.map((line, index) => <fieldset key={line.key} className="border rounded p-3 space-y-3"><legend className="px-1">Line {index + 1}</legend>
        <TextField label={`Line ${index + 1} description`} value={line.description} onChange={description => setLines(prev => prev.map(item => item.key === line.key ? { ...item, description } : item))} />
        <div className="grid md:grid-cols-4 gap-3">{([['quantity','Quantity'],['unit','Unit'],['unitPrice','Unit price'],['linePrice','Line price'],['unitEstimatedCost','Unit estimated cost'],['lineEstimatedCost','Line estimated cost'],['externalCodeSystem','Code system'],['externalCode','External code']] as const).map(([key,caption]) => <TextField key={key} label={`Line ${index+1} ${caption.toLowerCase()}`} value={line[key]} onChange={value => setLines(prev => prev.map(item => item.key === line.key ? { ...item, [key]: value } : item))} />)}</div>
        <label className="block text-sm">Taxable<select className={fieldClass} value={line.taxable} onChange={e => setLines(prev => prev.map(item => item.key === line.key ? { ...item, taxable: e.target.value } : item))}><option value="">Not provided</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        {lines.length > 1 && <Button type="button" variant="outline" onClick={() => setLines(prev => prev.filter(item => item.key !== line.key))}>Remove line {index+1}</Button>}
      </fieldset>)}
      <Button type="button" variant="outline" disabled={lines.length >= 1000} onClick={() => setLines(prev => [...prev, emptyLine()])}>Add line</Button>
      <TextField label="Original commercial terms (if provided)" value={terms} onChange={setTerms} />
      <div className="flex gap-3"><Button type="submit" disabled={record.isPending || !label.trim()}>{record.isPending ? "Recording…" : "Save original proposal"}</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button></div>
    </form>}
    {!showForm && !current && projectId && <section className="space-y-2"><h2 className="font-semibold">Recorded proposals</h2>{sourceList.isLoading ? <p>Loading…</p> : sourceList.data?.items.length ? sourceList.data.items.map(item => <button key={item.id} className="block text-left border rounded-lg p-4 w-full hover:bg-muted" onClick={() => openSource(item.id)}>{item.sourceLabel}</button>) : <p>No historical proposals recorded for this project.</p>}</section>}
    {current && !showForm && <section className="space-y-4 border rounded-lg p-4"><h2 className="text-lg font-semibold">{current.sourceLabel}</h2>
      <p className="text-sm">Original total: {formatHistoricalMoney(current.declaredTotalMinor, current.currencyCode, current.rawTotals.total)}</p>
      <HistoricalOriginalTotals source={current} />
      {imported.data ? <><h3 className="font-semibold">Recorded selection · Revision {imported.data.revision}</h3><HistoricalLines currencyCode={current.currencyCode} lines={imported.data.lines} />
        <p>Selected total: {formatHistoricalMoney(imported.data.declaredSelectedTotalMinor, current.currencyCode, imported.data.rawSelectedTotals.total)}</p>
        <p>Selected estimated cost: {formatHistoricalMoney(imported.data.declaredSelectedEstimatedCostMinor, current.currencyCode, imported.data.rawSelectedTotals.estimatedCost)}</p>
        <HistoricalReconciliationDetails reconciliation={imported.data.reconciliationFindings} currencyCode={current.currencyCode} lines={current.lines} />
        <p className="text-sm">Reported approval: {imported.data.reportedApprovalNote || "Not provided"}</p>
        <Button variant="outline" onClick={() => openSource(current.id)}>View complete original proposal</Button>
      </> : <><HistoricalLines currencyCode={current.currencyCode} lines={current.lines} selected={selected} onToggle={id => setSelected(prev => prev.includes(id) ? prev.filter(value => value !== id) : [...prev, id])} />
        <p className="text-sm">Select whole lines for this phase. Discounts and taxes from the full proposal are not distributed automatically.</p>
        <div className="grid md:grid-cols-2 gap-3"><TextField label="Selected total as reported" value={selectedTotal} onChange={setSelectedTotal} /><TextField label="Selected estimated cost (if provided)" value={selectedCost} onChange={setSelectedCost} /></div>
        <TextField label="Reported customer approval (optional note)" value={reportedNote} onChange={setReportedNote} />
        <Button disabled={!selected.length || capture.isPending} onClick={saveSelection}>{capture.isPending ? "Recording…" : "Record selected scope"}</Button>
        {source.data?.imports?.length ? <div><h3 className="font-semibold mb-2">Recorded selections</h3>{source.data.imports.map(item => <Button key={item.id} variant="outline" onClick={() => openImport(item.id)}>Open revision {item.revision}</Button>)}</div> : null}
      </>}
      <details><summary className="cursor-pointer">Original terms</summary><p className="whitespace-pre-wrap text-sm">{current.commercialTermsText || "Not provided"}</p></details>
    </section>}
  </div>;
}
