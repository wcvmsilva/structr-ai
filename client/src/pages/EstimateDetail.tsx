/**
 * Sprint 20 — Estimate Detail Page (read-only)
 *
 * Shows full estimate draft with:
 *   - Metadata header (ID, name, status, source, dates)
 *   - Financial summary
 *   - Assembly selections with stage/override indicators
 *   - Pricing Provenance Panel (context snapshot, multipliers, sources)
 *   - Line items table
 *   - Export actions (PDF, JSON, Print)
 *   - Report Issue button
 */
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Download,
  FileJson,
  Printer,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldX,
  Layers,
  MapPin,
  Tag,
  Clock,
  Hash,
  ChevronDown,
  ChevronRight,
  Eye,
  Info,
  Zap,
  GitBranch,
  Flag,
  CheckCircle,
  XCircle,
  RotateCcw,
  FileSpreadsheet,
} from "lucide-react";
import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquareWarning } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtPct(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return `${num.toFixed(1)}%`;
}

function fmtDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function capitalize(s: string | null | undefined): string {
  if (!s) return "N/A";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Status Badge ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Draft" },
    sent_to_estimate: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Sent" },
    converted: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Converted" },
    archived: { bg: "bg-gray-500/15", text: "text-gray-400", label: "Archived" },
    approved: { bg: "bg-green-500/15", text: "text-green-400", label: "Approved" },
    rejected: { bg: "bg-red-500/15", text: "text-red-400", label: "Rejected" },
  };
  const c = config[status] ?? config.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wider", c.bg, c.text)}>
      {c.label}
    </span>
  );
}

// ── Source Badge ──────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string | null }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    assembly_calculator: { bg: "bg-purple-500/15", text: "text-purple-400", label: "Calculator" },
    scope_draft: { bg: "bg-cyan-500/15", text: "text-cyan-400", label: "Scope Pipeline" },
    legacy_bundle: { bg: "bg-orange-500/15", text: "text-orange-400", label: "Legacy Bundle" },
  };
  const c = config[source ?? ""] ?? { bg: "bg-gray-500/15", text: "text-gray-400", label: source ?? "Unknown" };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-bold", c.bg, c.text)}>
      {c.label}
    </span>
  );
}

// ── Section Label ────────────────────────────────────────────────────

function SectionLabel({ text, icon: Icon }: { text: string; icon?: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      {Icon && <Icon className="h-4 w-4 text-gold" />}
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
        {text}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
    </div>
  );
}

// ── Metric Card ──────────────────────────────────────────────────────

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: "gold" | "emerald" | "red" }) {
  return (
    <div className="rounded-xl bg-surface border border-border p-3 text-center">
      <p className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn(
        "text-lg font-bold mt-1 font-mono",
        accent === "gold" ? "text-gold" : accent === "emerald" ? "text-emerald-400" : accent === "red" ? "text-red-400" : "text-foreground"
      )}>
        {value}
      </p>
    </div>
  );
}

// ── Pricing Provenance Panel ─────────────────────────────────────────

function MultipliersGrid({ multipliers }: { multipliers: Record<string, number> }) {
  return (
    <div>
      <p className="text-[0.7rem] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Multipliers Applied</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Object.entries(multipliers).map(([key, val]) => {
          const numVal = Number(val);
          return (
            <div key={key} className="rounded-lg bg-surface border border-border px-3 py-2">
              <p className="text-[0.6rem] text-muted-foreground truncate">{formatMultiplierName(key)}</p>
              <p className={cn(
                "text-sm font-bold font-mono",
                numVal !== 1 ? "text-gold" : "text-foreground"
              )}>
                {!isNaN(numVal) ? numVal.toFixed(4) : String(val)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProvenancePanel({ metadata, draft }: { metadata: Record<string, unknown>; draft: any }) {
  const [expanded, setExpanded] = useState(true);
  const contextSnapshot = metadata?.contextSnapshot as Record<string, unknown> | null;
  const multipliersApplied: Record<string, number> | null = (contextSnapshot?.multipliersApplied as Record<string, number>) ?? null;

  return (
    <div className="rounded-xl border border-gold/20 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-gold" />
          <span className="text-sm font-bold text-gold uppercase tracking-wider">Pricing Provenance</span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Context Info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <ProvenanceItem label="Channel" value={capitalize(contextSnapshot?.channel as string)} source={contextSnapshot?.channelSource as string} />
            <ProvenanceItem label="Finish Level" value={capitalize(contextSnapshot?.finishLevel as string)} source={contextSnapshot?.finishLevelSource as string} />
            <ProvenanceItem label="Region" value={contextSnapshot?.region as string ?? "N/A"} source={contextSnapshot?.regionSource as string} />
            <ProvenanceItem label="Zone" value={contextSnapshot?.zone as string ?? "N/A"} />
            <ProvenanceItem label="Pricing Schema" value={`v${draft.pricingSchemaVersion ?? "1.0"}`} />
            <ProvenanceItem label="Scope Draft" value={draft.scopeDraftId ? `#${draft.scopeDraftId}` : "N/A"} />
          </div>

          {!!multipliersApplied && <MultipliersGrid multipliers={multipliersApplied} />}

          {!!metadata?.pipelineSource && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              <span>{"Pipeline: "}<span className="font-semibold text-foreground">{String(metadata.pipelineSource)}</span></span>
              {metadata.inactiveAssembliesSkipped ? (
                <span className="ml-2 text-amber-400">
                  {`(${(metadata.inactiveAssembliesSkipped as string[]).length} inactive skipped)`}
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProvenanceItem({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div className="rounded-lg bg-surface border border-border px-3 py-2">
      <p className="text-[0.6rem] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
      {source && (
        <p className="text-[0.55rem] text-muted-foreground mt-0.5">
          source: <span className={cn(
            "font-semibold",
            source === "override" ? "text-amber-400" : source === "project" ? "text-cyan-400" : "text-muted-foreground"
          )}>{source}</span>
        </p>
      )}
    </div>
  );
}

function formatMultiplierName(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// ── Main Page ────────────────────────────────────────────────────────

export default function EstimateDetailPage() {
  const [, params] = useRoute("/estimates/:id");
  const [, navigate] = useLocation();
  const estimateId = params?.id ? parseInt(params.id, 10) : null;

  const { data: draft, isLoading, error } = trpc.estimate.getById.useQuery(
    { id: estimateId! },
    { enabled: !!estimateId }
  );

  const exportPdf = trpc.estimate.exportPdf.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success("PDF exported successfully");
    },
    onError: (err) => toast.error(`PDF export failed: ${err.message}`),
  });

  const exportJson = trpc.estimate.exportJson.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success("JSON exported successfully");
    },
    onError: (err) => toast.error(`JSON export failed: ${err.message}`),
  });

  // CSV Export (JobTread)
  const exportCsv = trpc.estimate.exportCsv.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success(`CSV exported: ${data.totalRows} rows`);
      setCsvValidation(null);
    },
    onError: (err) => toast.error(`CSV export blocked: ${err.message}`),
  });
  const [csvValidation, setCsvValidation] = useState<any>(null);
  const [csvValidating, setCsvValidating] = useState(false);

  // Report Issue
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<string>("pricing_mismatch");
  const [reportSeverity, setReportSeverity] = useState<string>("medium");
  const [reportTitle, setReportTitle] = useState("");
  const [reportDescription, setReportDescription] = useState("");

  const reportIssue = trpc.issueReport.create.useMutation({
    onSuccess: () => {
      toast.success("Issue reported successfully");
      setReportOpen(false);
      setReportTitle("");
      setReportDescription("");
    },
    onError: (err) => toast.error(`Failed to report issue: ${err.message}`),
  });

  const handleReportSubmit = () => {
    if (!draft) return;
    reportIssue.mutate({
      entityType: "estimate_draft",
      entityId: draft.id,
      issueCategory: reportCategory as any,
      severity: reportSeverity as any,
      title: reportTitle,
      description: reportDescription,
      metadata: {
        estimateId: draft.id,
        bundleName: draft.bundleName,
        pricingSchemaVersion: draft.pricingSchemaVersion,
        channel: draft.channel,
        finishLevel: draft.finishLevel,
        region: draft.region,
        finalTotal: draft.finalTotalPrice,
      },
    });
  };

  // Sprint 20: Quick Actions
  const utils = trpc.useUtils();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);

  const approveEstimate = trpc.estimate.approveEstimate.useMutation({
    onSuccess: () => {
      toast.success("Estimate approved successfully");
      utils.estimate.getById.invalidate({ id: estimateId! });
      setApproveConfirmOpen(false);
    },
    onError: (err) => toast.error(`Approval failed: ${err.message}`),
  });

  const rejectEstimate = trpc.estimate.rejectEstimate.useMutation({
    onSuccess: () => {
      toast.success("Estimate rejected");
      utils.estimate.getById.invalidate({ id: estimateId! });
      setRejectOpen(false);
      setRejectReason("");
    },
    onError: (err) => toast.error(`Rejection failed: ${err.message}`),
  });

  const reopenEstimate = trpc.estimate.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Estimate reopened as draft");
      utils.estimate.getById.invalidate({ id: estimateId! });
    },
    onError: (err) => toast.error(`Reopen failed: ${err.message}`),
  });

  const canApprove = draft && ["draft", "sent_to_estimate"].includes(draft.status);
  const canReject = draft && ["draft", "sent_to_estimate"].includes(draft.status);
  const canReopen = draft && ["rejected", "archived"].includes(draft.status);

  const { data: printableData } = trpc.estimate.exportPrintable.useQuery(
    { id: estimateId! },
    { enabled: false } // Only fetch on demand
  );

  const handlePrint = () => {
    if (!draft) return;
    // Open printable in new window
    const printWindow = window.open("", "_blank");
    if (printWindow && draft) {
      // We'll generate a simple print view
      const metadata = (draft.metadata as Record<string, unknown>) ?? {};
      printWindow.document.write(`
        <html><head><title>Estimate #EST-${String(draft.id).padStart(5, "0")}</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; padding: 20mm; max-width: 210mm; margin: 0 auto; color: #1e1e23; }
          h1 { font-size: 22px; border-bottom: 3px solid #d4af37; padding-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 10px 0; }
          th { background: #f5f5f5; padding: 6px 8px; text-align: left; border-bottom: 2px solid #ddd; }
          td { padding: 5px 8px; border-bottom: 1px solid #eee; }
          .right { text-align: right; }
          .bold { font-weight: 700; }
          .total { font-size: 16px; font-weight: 700; border-top: 2px solid #d4af37; padding-top: 8px; margin-top: 12px; }
        </style></head><body>
        <h1>structr.ai — Estimate #EST-${String(draft.id).padStart(5, "0")}</h1>
        <p><strong>${draft.bundleName}</strong> — ${capitalize(draft.status)} — ${fmtDate(draft.createdAt)}</p>
        <p>Channel: ${capitalize(draft.channel)} | Region: ${draft.region ?? "N/A"} | Finish: ${capitalize(draft.finishLevel)}</p>
        <div class="total">TOTAL: ${fmtCurrency(draft.finalTotalPrice)}</div>
        <p>Cost: ${fmtCurrency(draft.subtotalCost)} | Price: ${fmtCurrency(draft.subtotalPrice)} | GP: ${fmtPct(draft.grossProfitPct)}</p>
        ${(draft.assemblySelections ?? []).length > 0 ? `
          <h2>Assemblies</h2>
          <table>
            <tr><th>Assembly</th><th>Category</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Ext. Price</th><th class="right">GP%</th></tr>
            ${(draft.assemblySelections as any[]).map((a: any) => `
              <tr>
                <td>${a.assemblyName}</td>
                <td>${a.category}</td>
                <td class="right">${a.quantity}</td>
                <td class="right">${fmtCurrency(a.unitPrice)}</td>
                <td class="right bold">${fmtCurrency(a.extendedPrice)}</td>
                <td class="right">${fmtPct(a.grossProfitPct)}</td>
              </tr>
            `).join("")}
          </table>
        ` : ""}
        <p style="margin-top: 30px; font-size: 9px; color: #aaa; text-align: center;">
          Pricing Schema v${draft.pricingSchemaVersion ?? "1.0"} — Generated ${new Date().toISOString()}
        </p>
        </body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const handleCsvValidate = async () => {
    if (!draft) return;
    setCsvValidating(true);
    try {
      const report = await utils.estimate.validateCsvExport.fetch({ id: draft.id });
      setCsvValidation(report);
      if (report.isValid) {
        toast.success(`Validation passed: ${report.validRows} rows ready for JobTread`);
      } else {
        toast.error(`Validation failed: ${report.invalidRows} invalid row(s)`);
      }
    } catch (err: any) {
      toast.error(`Validation error: ${err.message}`);
    } finally {
      setCsvValidating(false);
    }
  };

  const handleCsvExport = () => {
    if (!draft) return;
    exportCsv.mutate({ id: draft.id });
  };

  // ── Loading State ──
  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-4 gap-3 mt-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl mt-4" />
      </div>
    );
  }

  // ── Error State ──
  if (error || !draft) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <AlertTriangle className="h-12 w-12 text-red-400" />
        <p className="text-lg font-semibold text-foreground">Estimate Not Found</p>
        <p className="text-sm text-muted-foreground">{error?.message ?? "The requested estimate draft does not exist."}</p>
        <Button variant="outline" onClick={() => navigate("/estimate")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Estimates
        </Button>
      </div>
    );
  }

  const metadata = (draft.metadata as Record<string, unknown>) ?? {};
  const assemblies = (draft.assemblySelections ?? []) as any[];
  const lineItems = (draft.lineItems ?? []) as any[];
  const hasProvenance = !!metadata?.contextSnapshot;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate("/estimate")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Estimates
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-foreground">
              <span className="text-gold font-mono">EST-{String(draft.id).padStart(5, "0")}</span>
            </h1>
            <StatusBadge status={draft.status} />
            <SourceBadge source={draft.source} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">{draft.bundleName}</p>
        </div>

        {/* Export Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportPdf.mutate({ id: draft.id })}
            disabled={exportPdf.isPending}
            className="border-gold/30 hover:border-gold/50"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {exportPdf.isPending ? "Generating..." : "PDF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportJson.mutate({ id: draft.id })}
            disabled={exportJson.isPending}
            className="border-gold/30 hover:border-gold/50"
          >
            <FileJson className="h-3.5 w-3.5 mr-1.5" />
            {exportJson.isPending ? "Generating..." : "JSON"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="border-gold/30 hover:border-gold/50"
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Print
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCsvValidate}
            disabled={csvValidating}
            className="border-emerald-500/30 hover:border-emerald-500/50 text-emerald-400 hover:text-emerald-300"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
            {csvValidating ? "Validating..." : "Validate CSV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCsvExport}
            disabled={exportCsv.isPending || (csvValidation && !csvValidation.isValid)}
            className={cn(
              "border-emerald-500/30 hover:border-emerald-500/50",
              csvValidation?.isValid
                ? "text-emerald-400 hover:text-emerald-300"
                : "text-muted-foreground"
            )}
            title={csvValidation && !csvValidation.isValid ? "Fix validation errors first" : "Export to JobTread CSV"}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {exportCsv.isPending ? "Exporting..." : "JobTread CSV"}
          </Button>

          <Dialog open={reportOpen} onOpenChange={setReportOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300"
              >
                <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" />
                Report Issue
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">Report Issue — EST-{String(draft.id).padStart(5, "0")}</DialogTitle>
                <DialogDescription>Flag a pricing, scope, or data issue for this estimate.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Category</label>
                    <Select value={reportCategory} onValueChange={setReportCategory}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pricing_mismatch">Pricing Mismatch</SelectItem>
                        <SelectItem value="missing_assembly">Missing Assembly</SelectItem>
                        <SelectItem value="wrong_multiplier">Wrong Multiplier</SelectItem>
                        <SelectItem value="scope_error">Scope Error</SelectItem>
                        <SelectItem value="data_quality">Data Quality</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Severity</label>
                    <Select value={reportSeverity} onValueChange={setReportSeverity}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Title</label>
                  <input
                    type="text"
                    value={reportTitle}
                    onChange={(e) => setReportTitle(e.target.value)}
                    placeholder="Brief summary of the issue"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Description</label>
                  <Textarea
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    placeholder="Describe the issue in detail..."
                    className="mt-1 min-h-[100px] bg-surface border-border"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReportOpen(false)}>Cancel</Button>
                <Button
                  onClick={handleReportSubmit}
                  disabled={reportIssue.isPending || reportTitle.length < 3 || reportDescription.length < 10}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {reportIssue.isPending ? "Submitting..." : "Submit Report"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Sprint 20: Quick Actions Bar */}
      {(canApprove || canReject || canReopen) && (
        <div className="flex items-center gap-3 rounded-xl border border-gold/20 bg-card px-4 py-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-gold mr-2">Quick Actions</span>
          <div className="h-4 w-px bg-border" />

          {canApprove && (
            <Dialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                  Approve
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="text-foreground">Approve Estimate</DialogTitle>
                  <DialogDescription>
                    Approve EST-{String(draft.id).padStart(5, "0")} ({draft.bundleName}) for {fmtCurrency(draft.finalTotalPrice)}?
                    This marks the estimate as ready for client presentation.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 my-2">
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="font-semibold">Profit Shield: {draft.profitShieldPassed ? "PASSED" : "FAILED"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">GP: {fmtPct(draft.grossProfitPct)} | Total: {fmtCurrency(draft.finalTotalPrice)}</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setApproveConfirmOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => approveEstimate.mutate({ id: draft.id })}
                    disabled={approveEstimate.isPending}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {approveEstimate.isPending ? "Approving..." : "Confirm Approval"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canReject && (
            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                  Reject
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="text-foreground">Reject Estimate</DialogTitle>
                  <DialogDescription>
                    Reject EST-{String(draft.id).padStart(5, "0")}? A reason is required for audit trail.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Rejection Reason</label>
                    <Textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Explain why this estimate is being rejected (min 5 characters)..."
                      className="mt-1 min-h-[100px] bg-surface border-border"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => rejectEstimate.mutate({ id: draft.id, reason: rejectReason })}
                    disabled={rejectEstimate.isPending || rejectReason.length < 5}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {rejectEstimate.isPending ? "Rejecting..." : "Confirm Rejection"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canReopen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => reopenEstimate.mutate({ id: draft.id, status: "draft" })}
              disabled={reopenEstimate.isPending}
              className="border-blue-500/30 hover:border-blue-500/50 text-blue-400 hover:text-blue-300"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              {reopenEstimate.isPending ? "Reopening..." : "Reopen as Draft"}
            </Button>
          )}
        </div>
      )}

      {/* Rejection Banner */}
      {draft.status === "rejected" && draft.rejectionReason && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm font-bold text-red-400">Rejected</span>
            {draft.rejectedAt && (
              <span className="text-xs text-muted-foreground">on {fmtDate(draft.rejectedAt)}</span>
            )}
          </div>
          <p className="text-sm text-foreground/80 ml-6">{draft.rejectionReason}</p>
        </div>
      )}

      {/* Approval Banner */}
      {draft.status === "approved" && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-400" />
            <span className="text-sm font-bold text-green-400">Approved</span>
            {draft.approvedAt && (
              <span className="text-xs text-muted-foreground">on {fmtDate(draft.approvedAt)}</span>
            )}
          </div>
        </div>
      )}

      {/* CSV Validation Report */}
      {csvValidation && (
        <div className={cn(
          "rounded-xl border px-4 py-3",
          csvValidation.isValid
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-red-500/30 bg-red-500/5"
        )}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className={cn("h-4 w-4", csvValidation.isValid ? "text-emerald-400" : "text-red-400")} />
              <span className={cn("text-sm font-bold", csvValidation.isValid ? "text-emerald-400" : "text-red-400")}>
                JobTread CSV Validation: {csvValidation.isValid ? "PASSED" : "FAILED"}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCsvValidation(null)} className="h-6 px-2 text-xs text-muted-foreground">
              Dismiss
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs mb-2">
            <div><span className="text-muted-foreground">Total Rows:</span> <span className="font-semibold text-foreground">{csvValidation.totalRows}</span></div>
            <div><span className="text-muted-foreground">Valid:</span> <span className="font-semibold text-emerald-400">{csvValidation.validRows}</span></div>
            <div><span className="text-muted-foreground">Invalid:</span> <span className={cn("font-semibold", csvValidation.invalidRows > 0 ? "text-red-400" : "text-muted-foreground")}>{csvValidation.invalidRows}</span></div>
          </div>
          {csvValidation.summary && (
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold">Cost Types:</span>{" "}
              {Object.entries(csvValidation.summary.costTypeDistribution as Record<string, number>)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .map(([type, count]) => `${type} (${count})`)
                .join(" \u00B7 ")}
            </div>
          )}
          {csvValidation.errors.length > 0 && (
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {csvValidation.errors.slice(0, 10).map((err: any, i: number) => (
                <div key={i} className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
                  Row {err.rowIndex + 1}: <span className="font-semibold">{err.field}</span> — {err.error}
                  <span className="text-muted-foreground ml-1">({err.costItemName})</span>
                </div>
              ))}
              {csvValidation.errors.length > 10 && (
                <div className="text-xs text-muted-foreground px-2">...and {csvValidation.errors.length - 10} more errors</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metadata Row */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {draft.region ?? "N/A"}</span>
        <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {capitalize(draft.channel)}</span>
        <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {capitalize(draft.finishLevel)}</span>
        <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> v{draft.pricingSchemaVersion ?? "1.0"}</span>
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDate(draft.createdAt)}</span>
        {draft.scopeDraftId && (
          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> Scope #{draft.scopeDraftId}</span>
        )}
      </div>

      {/* Financial Summary */}
      <div>
        <SectionLabel text="Financial Summary" icon={Zap} />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricCard label="Total Cost" value={fmtCurrency(draft.subtotalCost)} />
          <MetricCard label="Total Price" value={fmtCurrency(draft.subtotalPrice)} />
          <MetricCard label="Gross Profit" value={fmtCurrency(draft.grossProfit)} accent="emerald" />
          <MetricCard label="GP %" value={fmtPct(draft.grossProfitPct)} accent={parseFloat(draft.grossProfitPct) >= 35 ? "emerald" : "red"} />
          <MetricCard label="Discount" value={fmtPct(draft.discountApplied)} />
          <MetricCard label="Discount Amt" value={fmtCurrency(draft.discountAmount)} />
          <MetricCard label="Final Total" value={fmtCurrency(draft.finalTotalPrice)} accent="gold" />
        </div>
      </div>

      {/* Profit Shield */}
      <div className="flex items-center gap-3 rounded-xl border px-4 py-3"
        style={{
          borderColor: draft.profitShieldPassed ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)",
          backgroundColor: draft.profitShieldPassed ? "rgba(34, 197, 94, 0.05)" : "rgba(239, 68, 68, 0.05)",
        }}
      >
        {draft.profitShieldPassed
          ? <ShieldCheck className="h-5 w-5 text-emerald-400" />
          : <ShieldX className="h-5 w-5 text-red-400" />
        }
        <div>
          <p className={cn("text-sm font-bold", draft.profitShieldPassed ? "text-emerald-400" : "text-red-400")}>
            Profit Shield: {draft.profitShieldPassed ? "PASSED" : "FAILED"}
          </p>
          <p className="text-xs text-muted-foreground">
            Minimum GP threshold: {draft.profitShieldMinPct ?? "35.00"}%
          </p>
        </div>
      </div>

      {/* Pricing Provenance Panel */}
      {hasProvenance && <ProvenancePanel metadata={metadata} draft={draft} />}

      {/* Assembly Selections */}
      {assemblies.length > 0 && (
        <div>
          <SectionLabel text={`Assembly Selections (${assemblies.length})`} icon={Layers} />
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface">
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Assembly</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Category</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Qty</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Unit Cost</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Unit Price</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Ext. Price</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">GP %</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {assemblies.map((asm: any, idx: number) => (
                    <tr
                      key={idx}
                      className={cn(
                        "border-b border-border/50 transition-colors hover:bg-surface-hover",
                        idx % 2 === 0 ? "bg-transparent" : "bg-surface/30"
                      )}
                    >
                      <td className="px-3 py-2 font-medium text-foreground max-w-[200px] truncate">
                        {asm.assemblyName}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">
                        {asm.category}
                      </td>
                      <td className="px-3 py-2 text-center font-mono font-semibold text-gold">
                        {asm.quantity}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {fmtCurrency(asm.unitCost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {fmtCurrency(asm.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                        {fmtCurrency(asm.extendedPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {fmtPct(asm.grossProfitPct)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {asm.stage && (
                            <Badge variant="outline" className="text-[0.55rem] px-1.5 py-0 border-cyan-500/30 text-cyan-400">
                              {asm.stage}
                            </Badge>
                          )}
                          {asm.overrideFlag && (
                            <Badge variant="outline" className="text-[0.55rem] px-1.5 py-0 border-amber-500/30 text-amber-400">
                              <Flag className="h-2.5 w-2.5 mr-0.5" /> Override
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Line Items */}
      {lineItems.length > 0 && (
        <div>
          <SectionLabel text={`Line Items (${lineItems.length})`} icon={Hash} />
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface">
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Item</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Group</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Qty</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Unit</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Unit Price</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">Line Total</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem]">GP %</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li: any, idx: number) => (
                    <tr
                      key={idx}
                      className={cn(
                        "border-b border-border/50 transition-colors hover:bg-surface-hover",
                        idx % 2 === 0 ? "bg-transparent" : "bg-surface/30"
                      )}
                    >
                      <td className="px-3 py-2 font-medium text-foreground max-w-[180px] truncate">{li.costItemName}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{li.costGroupName}</td>
                      <td className="px-3 py-2 text-center font-mono font-semibold text-gold">{li.quantity}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{li.unit}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{fmtCurrency(li.unitPriceSnapshot)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{fmtCurrency(li.lineTotalPrice)}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{fmtPct(li.grossProfitPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {draft.notes && (
        <div>
          <SectionLabel text="Notes" icon={Info} />
          <div className="rounded-xl bg-surface border border-border p-4">
            <p className="text-sm text-foreground whitespace-pre-wrap">{draft.notes}</p>
          </div>
        </div>
      )}
    </div>
  );
}
