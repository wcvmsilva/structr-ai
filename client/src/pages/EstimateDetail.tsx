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
import { HistoricalCaptureNotice } from "@/components/historical-estimates/HistoricalSourceView";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { currentQueryData, ProfitShieldStatus } from "@/components/estimate/EstimateReadiness";
import { buildEstimateDisplay, formatEstimateMoney, formatEstimatePercent,
  formatEstimateQuantity, formatEstimateUnitRate, type EstimateDisplayProvenance } from "@shared/estimate-display";
import {
  ArrowLeft,
  Download,
  FileJson,
  Printer,
  AlertTriangle,
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
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { freezeIntent } from "@/lib/decision-intent";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquareWarning } from "lucide-react";
import { parseExportDeliveryBlockedMessage } from "@shared/export-delivery-blocked-message";
import { parseDeliveredExport } from "@shared/internal-estimate-export-delivery";
import { ESTIMATE_VERSION_PROTOCOL_V2, type ExportIssueCode } from "@shared/domain/taxonomy";

// ── Helpers ──────────────────────────────────────────────────────────

const unavailableValue = { state: "unavailable", reason: "invalid" } as const;

function StoredPricingContext({ context }: { context: Extract<EstimateDisplayProvenance, { state: "known" }> }) {
  const pricing = context.pricing;
  const fields: [string, string | null][] = [
    ["Pricing channel", pricing.channel], ["Finish level", pricing.finishLevel],
    ["Region", pricing.region], ["Zone", pricing.zone], ["Trade", pricing.trade],
    ["Coastal modifier", pricing.coastalModifier], ["Commercial channel", pricing.commercialChannel],
    ["Geographic risk", pricing.geoRiskClass], ["Pricing schema", context.pricingSchemaVersion],
    ["Scope reference", context.scopeDraftId],
  ];
  return <section aria-label="Stored pricing context" className="rounded-xl border border-border bg-card p-4 space-y-3">
    <h2 className="text-sm font-semibold">Stored pricing context</h2>
    <p className="text-xs text-muted-foreground">Stored context only; this does not verify policy, geography or approval.</p>
    <dl className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {fields.map(([label, value]) => <div key={label}>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm break-words">{value ?? "Unavailable"}</dd>
      </div>)}
    </dl>
  </section>;
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

/** financials.*Minor fields are integer minor-unit (cent) strings — never the
 * decimal DisplayScalar shape formatEstimateMoney expects. */
function formatMinorUSD(minor: string): string {
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  const cents = digits.slice(-2);
  return `${negative ? "-$" : "$"}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
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
    // A1-DECISION-CYCLE-SURFACE-INTEGRATION-CONTRACT.md §6.1: this legacy
    // status confers no real A1 authority — never label it in a way that
    // implies one. The two real A1 decision states get their own labels below.
    approved: { bg: "bg-gray-500/15", text: "text-gray-400", label: "Legacy — Review Required" },
    rejected: { bg: "bg-red-500/15", text: "text-red-400", label: "Rejected" },
    internally_approved: { bg: "bg-green-500/15", text: "text-green-400", label: "Internal Approval Active" },
    internal_approval_revoked: { bg: "bg-orange-500/15", text: "text-orange-400", label: "Internal Approval Revoked" },
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

// ── A1 export — presentation-only text, never a policy decision (the server
// is the sole authority on authorized/blocked/outcome). ────────────────────
const EXPORT_BLOCK_CODE_MESSAGES: Record<ExportIssueCode, string> = {
  INTERNAL_APPROVAL_REQUIRED: "This estimate has no internal approval yet.",
  INTERNAL_APPROVAL_REVOKED: "Internal approval for this estimate was revoked.",
  INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED: "A legacy approval needs review before export.",
  ESTIMATE_SUPERSEDED: "A newer version of this estimate exists.",
  ESTIMATE_CLIENT_MISSING: "This estimate has no linked client.",
  ESTIMATE_CLIENT_CONTEXT_MISMATCH: "This estimate's client context no longer matches its project.",
  HISTORICAL_AUTHORITY_NOT_AVAILABLE: "This estimate's context is not calculated.",
  INTERNAL_APPROVAL_CONTENT_UNRESOLVED: "This estimate's approved content could not be resolved.",
  EXPORT_FORMAT_UNREPRESENTABLE: "This format cannot represent the approved content.",
  CSV_CLASSIFICATION_NOT_REVIEWED: "CSV line classification has not been reviewed.",
  CSV_TAXABLE_UNKNOWN: "CSV tax treatment is unknown for one or more approved lines.",
  CSV_UNIT_UNREPRESENTABLE: "CSV export contains a unit that cannot be represented.",
  CSV_RATE_UNREPRESENTABLE: "CSV export cannot represent a required rate exactly.",
  CSV_LINE_IDENTITY_INVALID: "CSV line identities do not match the approved content.",
  CSV_COST_CODE_UNKNOWN: "CSV cost code is unknown for one or more approved lines.",
  CSV_COST_CODE_INVALID: "CSV cost code is invalid for this export format.",
  EXPORT_RENDERER_UNAVAILABLE: "Export generation for this format is currently unavailable.",
  EXPORT_PAYLOAD_TOO_LARGE: "The generated file exceeds the supported size limit.",
  EXPORT_RECONCILIATION_MISMATCH: "The export totals do not match the approved content.",
  EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED: "This export format cannot represent an approved commercial adjustment.",
};
function exportBlockMessage(code: string | null): string {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(EXPORT_BLOCK_CODE_MESSAGES, code)
    ? EXPORT_BLOCK_CODE_MESSAGES[code as ExportIssueCode]
    : "This export attempt was blocked.";
}
/** Surfaces the one typed error a blocked delivery raises after commit
 * (`{exportId,code}`, encoded into the TRPCError message — see
 * shared/export-delivery-blocked-message.ts) as a readable toast; any other
 * error falls back to its own (already server-sanitized) message. Returns
 * the blocked attempt's `exportId` (or null) so the caller can offer access
 * to that terminal attempt instead of discarding it (QA #6). */
function showExportError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "Export failed.";
  const blocked = parseExportDeliveryBlockedMessage(message);
  toast.error(blocked ? exportBlockMessage(blocked.code) : message);
  return blocked?.exportId ?? null;
}
/**
 * Builds a Blob strictly from a validated `DeliveredExport`, triggers a local
 * download via a transient anchor, and revokes the object URL right after —
 * never an `<a>` left pointing at a live URL, never a raw `data:` URL, never
 * content injected into the page outside this one Blob.
 *
 * MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md item 5: cleanup (anchor
 * removal + objectURL revocation) now runs in a `finally` — previously, if
 * `anchor.click()` threw, neither ran, leaking the object URL and leaving a
 * detached anchor referencing it. `document.body.appendChild`/`removeChild`
 * and `URL.createObjectURL`/`revokeObjectURL` are browser globals, not a
 * Node-exclusive module — nothing new added to the bundle.
 */
function downloadDeliveredExport(delivered: { content: string; encoding: "utf8" | "base64"; mimeType: string; filename: string }): void {
  const bytes = delivered.encoding === "base64"
    ? Uint8Array.from(atob(delivered.content), c => c.charCodeAt(0))
    : new TextEncoder().encode(delivered.content);
  const blob = new Blob([bytes], { type: delivered.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = delivered.filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
/**
 * Re-validates the FULL `DeliveredExport` through the SAME closed parser the
 * writer itself already parses its own return value with
 * (`shared/internal-estimate-export-delivery.ts`'s `parseDeliveredExport` —
 * isomorphic: SHA-256 via `globalThis.crypto.subtle`, no Node-exclusive
 * import) before any Blob/download effect — never trusting the transported
 * JSON by its mere presence (QA #5: a declared `byteLength` that doesn't
 * match the actually decoded bytes, a MIME type/filename the format doesn't
 * allow, or content over the 10 MiB response limit must never reach
 * `downloadDeliveredExport` at all, let alone allocate/download it).
 *
 * MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 2 (Jim's own
 * read-only QA, `2026-10-06T06-35-13-390Z-ce0c3f`): the caller already checks
 * `isCurrentVisit` BEFORE calling this function, but the visit can still
 * change WHILE `parseDeliveredExport`'s own await is pending — this function
 * was calling `downloadDeliveredExport` unconditionally once validation
 * resolved, regardless of what happened during that wait. `isStillCurrent` is
 * re-checked AFTER the await and BEFORE the one effect, mirroring the same
 * discipline `runExportPrintable` already applies around its own
 * `setPrintableHtml`.
 */
async function validateAndDownload(delivered: unknown, isStillCurrent: () => boolean): Promise<void> {
  const validated = await parseDeliveredExport(delivered);
  if (!isStillCurrent()) return;
  downloadDeliveredExport(validated);
}

// ── Main Page ────────────────────────────────────────────────────────

export default function EstimateDetailPage() {
  const [, params] = useRoute("/estimates/:id");
  const [, navigate] = useLocation();
  const estimateId = params?.id ?? null;

  const { data: draft, isLoading, error } = trpc.estimate.getById.useQuery(
    { id: estimateId! },
    { enabled: !!estimateId }
  );
  const isHistorical = draft?.source === "historical_import" || !!draft?.historicalImportId;

  // ADR-002 partial-read UI reservation (CODEX-UI-RESERVATION.md): presentation
  // only, computed from auth.session's estimateReadOnly — never a second source
  // of authorization. Absence, loading, erroring, or pausing of the descriptor
  // must never present a write command as ready (MICHAEL-UI-TEST-MAP-
  // RECONCILIATION.md) — the safe default is always read-only until the
  // descriptor positively resolves to false.
  const sessionQuery = trpc.auth.session.useQuery();
  const sessionDescriptor = currentQueryData(sessionQuery);
  const estimateReadOnly = sessionDescriptor?.estimateReadOnly !== false;

  const profitShieldQuery = trpc.estimate.profitShield.useQuery(
    { id: estimateId! }, { enabled: !!estimateId && !!draft && !isHistorical && !estimateReadOnly }
  );
  const exportAuthorizationQuery = trpc.estimate.exportAuthorization.useQuery(
    { id: estimateId! }, { enabled: !!estimateId && !!draft && !isHistorical && !estimateReadOnly }
  );

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

  // MICHAEL-UI-REVIEW-CHECKPOINTS.md: issueReport.create is a write, not one
  // of the three reads this reservation allows — same estimateReadOnly guard
  // as every other mutation-triggering handler on this page.
  function handleReportSubmit(): void {
    if (estimateReadOnly || !draft) return;
    reportIssue.mutate({
      entityType: "estimate_draft",
      entityId: Number(draft.id),
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
  const refreshReadiness = () => Promise.all([
    utils.estimate.getById.invalidate({ id: estimateId! }),
    utils.estimate.profitShield.invalidate({ id: estimateId! }),
    utils.estimate.exportAuthorization.invalidate({ id: estimateId! }),
    utils.estimate.list.invalidate(),
  ]);

  const rejectEstimate = trpc.estimate.rejectEstimate.useMutation({
    onSuccess: async () => {
      toast.success("Estimate rejected");
      setRejectOpen(false);
      setRejectReason("");
      await refreshReadiness();
    },
    onError: (err) => toast.error(`Rejection failed: ${err.message}`),
  });

  const reopenEstimate = trpc.estimate.updateStatus.useMutation({
    onSuccess: async () => {
      toast.success("Estimate reopened as draft");
      await refreshReadiness();
    },
    onError: (err) => toast.error(`Reopen failed: ${err.message}`),
  });

  const canReject = !estimateReadOnly && draft && ["draft", "sent_to_estimate"].includes(draft.status);
  const canReopen = !estimateReadOnly && draft && ["rejected", "archived"].includes(draft.status);
  function submitReject(): void {
    if (estimateReadOnly || !draft) return;
    rejectEstimate.mutate({ id: draft.id, reason: rejectReason });
  }
  function submitReopen(): void {
    if (estimateReadOnly || !draft) return;
    reopenEstimate.mutate({ id: draft.id, status: "draft" });
  }

  const exportAuthorization = currentQueryData(exportAuthorizationQuery);

  // A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md — real export/print actions.
  // Draft/project/revocation changes must never reuse a stale authorization:
  // every mutation re-invalidates `exportAuthorization` (and the history
  // lists) on settle, success or failure alike, and the server re-decides
  // every call regardless of what this query currently shows.
  const invalidateExportState = () => Promise.all([
    utils.estimate.exportAuthorization.invalidate({ id: estimateId! }),
    utils.estimate.listExports.invalidate({ id: estimateId! }),
  ]);
  const [printableHtml, setPrintableHtml] = useState<string | null>(null);
  const [blockedExportId, setBlockedExportId] = useState<string | null>(null);
  const [selectedExportId, setSelectedExportId] = useState<string | null>(null);
  const [preflightFormat, setPreflightFormat] = useState<"pdf" | "json" | "printable" | "csv_jobtread">("csv_jobtread");
  const printableFrameRef = useRef<HTMLIFrameElement | null>(null);
  /**
   * MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 2 (Michael's
   * decision on Case 2): equal `estimateId` does NOT prove the response
   * belongs to the CURRENT visit — leaving and returning to the SAME
   * estimate (A→B→A) is a NEW visit (fresh authorization/version/preview
   * state; the reset `useEffect` below already clears it), and a request
   * dispatched during the ORIGINAL visit to A resolving after the return
   * must still be discarded, not applied as if it belonged to the new visit.
   * `visitGenerationRef` increments on every `estimateId` CHANGE (A→B and
   * B→A are each one increment, even though the id repeats); `currentVisitRef`
   * pairs the CURRENT id with the CURRENT generation. Only `generation`
   * equality decides staleness — never the id alone.
   */
  const visitGenerationRef = useRef(0);
  const currentVisitRef = useRef({ estimateId, generation: 0 });
  useEffect(() => {
    visitGenerationRef.current += 1;
    currentVisitRef.current = { estimateId, generation: visitGenerationRef.current };
    setPrintableHtml(null);
    setBlockedExportId(null);
    setSelectedExportId(null);
    /**
     * MICHAEL-A1-EXPORT-SURFACE-V4-QA-AND-CORRECTION.md / Jim's read-only QA
     * (ce0c3f/635340/81652e): this effect had NO cleanup — React only
     * invalidates `currentVisitRef` when `estimateId` CHANGES while the
     * component stays mounted, never on a full UNMOUNT. A mutation already
     * dispatched and awaiting the parser (or anything else async) when the
     * user navigates fully away resolves into a `currentVisitRef` nobody
     * ever told the visit ended — `isCurrentVisit` would still read `true`.
     * Confirmed (per the QA's real-MutationObserver reproduction) that
     * TanStack's own unsubscribe-on-unmount does NOT help here either: it
     * only suppresses a callback that hasn't started yet, never one already
     * running and suspended inside its own `await` — this generation bump is
     * the only thing that can invalidate an ALREADY-DISPATCHED callback.
     * Runs on every cleanup (both an `estimateId` change and a real unmount
     * trigger it) — bumping twice on a plain id change is harmless, since
     * only inequality with whatever a pending request captured matters.
     */
    return () => {
      visitGenerationRef.current += 1;
      currentVisitRef.current = { estimateId: null, generation: visitGenerationRef.current };
      /**
       * MICHAEL-A1-DECISION-CYCLE-V3-QA-AND-CORRECTION.md group 2: leaving
       * this visit (an estimateId change OR a real unmount) must end every
       * open decision dialog's intent/reason/confirmation explicitly — an
       * A→B→A round trip where B's query never lands returns to A with a
       * fingerprint IDENTICAL to what was frozen before leaving, so the
       * per-dialog fingerprint-change effects never fire. Only the visit
       * boundary itself can catch that case.
       */
      setApproveOpen(false);
      resetApproveIntent();
      setRevokeOpen(false);
      resetRevokeIntent();
      setCreateVersionOpen(false);
      resetCreateVersionIntent();
    };
  }, [estimateId]);
  /**
   * The generation is captured at DISPATCH time (inside each `run*` function
   * below, called directly from `onClick` — never inside a mutation hook's
   * own `onSuccess`/`onError`, which TanStack Query rebinds to the LATEST
   * render on every `setOptions` call, exactly the closure-rebinding bug
   * `forContext(estimateId, apply)` had in V2/V3). Each `.mutate(input,
   * {onSuccess,onError})` call below supplies PER-CALL options bound to that
   * one dispatch, never the hook's own rebindable options — this is what
   * stays immutable across any later render, for every export action, not
   * only redownload. Re-checked again after any `await` (parser validation)
   * and right before each effect — Blob/download, printable preview, or a
   * toast/message tied to the attempt — never only once up front.
   */
  function isCurrentVisit(requestedGeneration: number): boolean {
    return requestedGeneration === currentVisitRef.current.generation;
  }
  function onExportError(error: unknown, requestedGeneration: number): void {
    if (!isCurrentVisit(requestedGeneration)) return; // a stale visit's error produces no message either
    const exportId = showExportError(error);
    if (exportId) setBlockedExportId(exportId);
  }
  const deliverExport = trpc.estimate.exportPdf.useMutation({ onSettled: invalidateExportState });
  function runExportPdf(): void {
    if (estimateReadOnly) return;
    const requestedGeneration = currentVisitRef.current.generation;
    deliverExport.mutate({ id: estimateId! }, {
      onSuccess: (delivered) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        validateAndDownload(delivered, () => isCurrentVisit(requestedGeneration)).catch((error) => onExportError(error, requestedGeneration));
      },
      onError: (error) => onExportError(error, requestedGeneration),
    });
  }
  const deliverJsonExport = trpc.estimate.exportJson.useMutation({ onSettled: invalidateExportState });
  function runExportJson(): void {
    if (estimateReadOnly) return;
    const requestedGeneration = currentVisitRef.current.generation;
    deliverJsonExport.mutate({ id: estimateId! }, {
      onSuccess: (delivered) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        validateAndDownload(delivered, () => isCurrentVisit(requestedGeneration)).catch((error) => onExportError(error, requestedGeneration));
      },
      onError: (error) => onExportError(error, requestedGeneration),
    });
  }
  const deliverCsvExport = trpc.estimate.exportCsv.useMutation({ onSettled: invalidateExportState });
  function runExportCsv(): void {
    if (estimateReadOnly) return;
    const requestedGeneration = currentVisitRef.current.generation;
    deliverCsvExport.mutate({ id: estimateId! }, {
      onSuccess: (delivered) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        validateAndDownload(delivered, () => isCurrentVisit(requestedGeneration)).catch((error) => onExportError(error, requestedGeneration));
      },
      onError: (error) => onExportError(error, requestedGeneration),
    });
  }
  // QA #3b: printable used to apply `delivered.content` directly, with NO
  // `DeliveredExport` validation at all — unlike pdf/json/csv, which already
  // routed through `validateAndDownload`/`parseDeliveredExport`. Validate
  // here too, before the one effect (`setPrintableHtml`), and re-check the
  // visit AFTER the async validation resolves, not only before it starts.
  const deliverPrintable = trpc.estimate.exportPrintable.useMutation({ onSettled: invalidateExportState });
  function runExportPrintable(): void {
    if (estimateReadOnly) return;
    const requestedGeneration = currentVisitRef.current.generation;
    deliverPrintable.mutate({ id: estimateId! }, {
      onSuccess: (delivered) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        parseDeliveredExport(delivered)
          .then((validated) => { if (isCurrentVisit(requestedGeneration)) setPrintableHtml(validated.content); })
          .catch((error) => onExportError(error, requestedGeneration));
      },
      onError: (error) => onExportError(error, requestedGeneration),
    });
  }
  const validateCsv = trpc.estimate.validateCsvExport.useMutation({ onSettled: invalidateExportState });
  function runValidateCsv(): void {
    if (estimateReadOnly) return;
    const requestedGeneration = currentVisitRef.current.generation;
    validateCsv.mutate({ id: estimateId! }, {
      onSuccess: (summary) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        if (summary.outcome === "ready") toast.success("CSV is valid and ready for JobTread export.");
        else toast.warning(exportBlockMessage(summary.validation.issues[0]?.code ?? null));
      },
      onError: (error) => onExportError(error, requestedGeneration),
    });
  }
  const runPreflight = trpc.estimate.exportPreflight.useMutation({ onSettled: invalidateExportState });
  function runExportPreflight(): void {
    if (estimateReadOnly) return;
    const requestedGeneration = currentVisitRef.current.generation;
    runPreflight.mutate({ id: estimateId!, format: preflightFormat }, {
      onSuccess: (summary) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        if (summary.outcome === "ready") toast.success(`Preflight ready for ${summary.format}.`);
        else toast.warning(exportBlockMessage(summary.validation.issues[0]?.code ?? null));
      },
      onError: (error) => onExportError(error, requestedGeneration),
    });
  }
  // `downloadExport`'s own input (`{exportId}`) carries no estimateId/
  // generation to send the server — the generation is purely local
  // (never serialized into a strict server schema), captured the same way
  // as every other action above.
  const redownload = trpc.estimate.downloadExport.useMutation();
  function redownloadFrom(exportId: string): void {
    if (estimateReadOnly) return;
    const requestedGeneration = currentVisitRef.current.generation;
    redownload.mutate({ exportId }, {
      onSuccess: (delivered) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        validateAndDownload(delivered, () => isCurrentVisit(requestedGeneration)).catch((error) => onExportError(error, requestedGeneration));
      },
      onError: (error) => onExportError(error, requestedGeneration),
    });
  }
  const exportsQuery = trpc.estimate.listExports.useQuery(
    { id: estimateId! }, { enabled: !!estimateId && !!draft && !isHistorical && !estimateReadOnly },
  );
  const exportHistory = currentQueryData(exportsQuery) ?? [];
  const exportDetailQuery = trpc.estimate.getExportDetail.useQuery(
    { exportId: selectedExportId! }, { enabled: !!selectedExportId && !estimateReadOnly },
  );
  const exportDetail = currentQueryData(exportDetailQuery);

  // ── A1 Decision Cycle — A1-DECISION-CYCLE-SURFACE-INTEGRATION-CONTRACT.md ──
  // review -> internal approve -> revoke -> create new version (no decision).
  // A review is never a standing authorization — it is INVALIDATED (never
  // just re-enabled against a possibly-cached result) every time a decision
  // dialog opens, so it always refetches fresh. Mutations use PER-CALL
  // `.mutate(input, {onSuccess,onError})` options and the SAME
  // isCurrentVisit/currentVisitRef generation guard already accepted for the
  // export actions above — never hook-level options, which TanStack rebinds
  // to the latest render and which have no visit-staleness check at all
  // (MICHAEL-A1-DECISION-CYCLE-V1-QA-AND-CORRECTION.md items 2/3/5).
  const internalApprovalQuery = trpc.estimate.getInternalApproval.useQuery(
    { id: estimateId! }, { enabled: !!estimateId && !!draft && !isHistorical },
  );
  const internalApproval = currentQueryData(internalApprovalQuery);
  // Distinct from `state === "none"` — a query that errored, is (re)fetching,
  // or is paused is NOT evidence of "no decision recorded" and must never
  // render as if it were.
  const internalApprovalUnsettled = internalApprovalQuery.isError || internalApprovalQuery.isFetching
    || internalApprovalQuery.isPending || internalApprovalQuery.isPaused;
  const invalidateDecisionState = () => Promise.all([
    utils.estimate.getById.invalidate({ id: estimateId! }),
    utils.estimate.getInternalApproval.invalidate({ id: estimateId! }),
    utils.estimate.getInternalApprovalReview.invalidate(),
    utils.estimate.getEstimateVersionPreview.invalidate(),
    utils.estimate.exportAuthorization.invalidate({ id: estimateId! }),
    utils.estimate.listExports.invalidate({ id: estimateId! }),
  ]);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveReason, setApproveReason] = useState("");
  const [approveUsdConfirmed, setApproveUsdConfirmed] = useState(false);
  const approveReviewQuery = trpc.estimate.getInternalApprovalReview.useQuery(
    { id: estimateId!, confirmedCurrencyCode: "USD" }, { enabled: !!estimateId && approveOpen },
  );
  const approveReview = currentQueryData(approveReviewQuery);
  const approveReviewUnsettled = approveOpen && (approveReviewQuery.isError || approveReviewQuery.isFetching || approveReviewQuery.isPending || approveReviewQuery.isPaused);
  const approveIntentRef = useRef<{ requestId: string; reason: string; fingerprint: string } | null>(null);
  const approveSeenFingerprintRef = useRef<string | null>(null);
  function resetApproveIntent(): void {
    approveIntentRef.current = null; approveSeenFingerprintRef.current = null;
    setApproveReason(""); setApproveUsdConfirmed(false);
  }
  function openApprove(): void {
    resetApproveIntent(); setApproveOpen(true);
    // Force a genuine refetch, never a cache hit from a prior open of the
    // same dialog for the same draft — a stale cached review is exactly the
    // "reused hash under an old reason/confirmation" this guards against.
    if (estimateId) void utils.estimate.getInternalApprovalReview.invalidate({ id: estimateId, confirmedCurrencyCode: "USD" }).catch(() => {});
  }
  function closeApprove(): void { setApproveOpen(false); resetApproveIntent(); }
  useEffect(() => {
    if (!approveOpen) return;
    if (!approveReview) {
      // MICHAEL-A1-DECISION-CYCLE-V3-QA-AND-CORRECTION.md group 1: the
      // checkbox/reason are reachable while review data is still
      // unavailable. Mark the fingerprint as "awaiting" so that whenever
      // review actually arrives, it is always treated as a change from
      // nothing seen yet — never as if confirming were safe because no
      // prior (non-null) fingerprint existed to differ from.
      approveSeenFingerprintRef.current = "__awaiting_review__";
      return;
    }
    const fingerprint = `${approveReview.contentHash}:${approveReview.policyHash}`;
    // A review that changed WHILE the dialog stayed open (a background
    // refetch landing new content) must never let a reason/confirmation
    // typed against the OLD content silently carry over to the new one.
    // This also covers the FIRST arrival after a period with no review
    // available at all (the ref holds the "awaiting" sentinel then, which
    // is non-null and never equal to a real fingerprint) — distinguished
    // from a genuine mid-review change only for which toast to show.
    const priorFingerprint = approveSeenFingerprintRef.current;
    if (priorFingerprint !== null && priorFingerprint !== fingerprint) {
      setApproveReason(""); setApproveUsdConfirmed(false);
      toast.warning(priorFingerprint === "__awaiting_review__"
        ? "Review the content below before confirming."
        : "This estimate's reviewed content changed. Re-confirm before approving.");
    }
    approveSeenFingerprintRef.current = fingerprint;
  }, [approveOpen, approveReview]);
  const approveMutation = trpc.estimate.approveEstimate.useMutation();
  function submitApprove(): void {
    if (estimateReadOnly) return;
    if (!approveReview || !approveUsdConfirmed || approveReason.length < 10 || !approveReview.evaluation.passed) return;
    const fingerprint = `${approveReview.contentHash}:${approveReview.policyHash}`;
    const requestId = freezeIntent(approveIntentRef, fingerprint, approveReason, (a, b) => a === b, () => crypto.randomUUID());
    const requestedGeneration = currentVisitRef.current.generation;
    approveMutation.mutate({
      id: approveReview.snapshot.identity.estimateDraftId, requestId,
      expectedDraftVersion: approveReview.snapshot.identity.draftVersion,
      expectedContentHash: approveReview.contentHash, expectedPolicyHash: approveReview.policyHash,
      confirmedCurrencyCode: "USD", reason: approveReason,
    }, {
      onSuccess: async () => {
        if (!isCurrentVisit(requestedGeneration)) return;
        toast.success("Internal approval recorded.");
        closeApprove();
        await invalidateDecisionState().catch(() => {});
      },
      onError: (err) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        if (err.data?.code === "CONFLICT") {
          toast.error("This estimate changed since it was reviewed. Review it again before approving.");
          resetApproveIntent();
          void utils.estimate.getInternalApprovalReview.invalidate({ id: approveReview.snapshot.identity.estimateDraftId, confirmedCurrencyCode: "USD" }).catch(() => {});
          return;
        }
        toast.error(`Approval failed: ${err.message}`);
      },
    });
  }

  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const revokeIntentRef = useRef<{ requestId: string; reason: string; fingerprint: string } | null>(null);
  const revokeSeenFingerprintRef = useRef<string | null>(null);
  function resetRevokeIntent(): void {
    revokeIntentRef.current = null; revokeSeenFingerprintRef.current = null; setRevokeReason("");
  }
  function openRevoke(): void { resetRevokeIntent(); setRevokeOpen(true); }
  function closeRevoke(): void { setRevokeOpen(false); resetRevokeIntent(); }
  useEffect(() => {
    if (!revokeOpen || internalApproval?.state !== "active") return;
    // Identity, not just contentHash — a different approval/draft that
    // happens to hash the same content is still a DIFFERENT decision.
    const fingerprint = `${internalApproval.approval.id}:${internalApproval.snapshot.contentHash}`;
    if (revokeSeenFingerprintRef.current !== null && revokeSeenFingerprintRef.current !== fingerprint) {
      setRevokeReason("");
      toast.warning("The approval being revoked changed. Re-confirm before revoking.");
    }
    revokeSeenFingerprintRef.current = fingerprint;
  }, [revokeOpen, internalApproval]);
  const revokeMutation = trpc.estimate.revokeInternalApproval.useMutation();
  function submitRevoke(): void {
    if (estimateReadOnly) return;
    if (internalApproval?.state !== "active" || revokeReason.length < 10) return;
    const fingerprint = `${internalApproval.approval.id}:${internalApproval.snapshot.contentHash}`;
    const requestId = freezeIntent(revokeIntentRef, fingerprint, revokeReason, (a, b) => a === b, () => crypto.randomUUID());
    const requestedGeneration = currentVisitRef.current.generation;
    revokeMutation.mutate({
      id: internalApproval.approval.estimateDraftId, approvalId: internalApproval.approval.id,
      requestId, expectedContentHash: internalApproval.snapshot.contentHash, reason: revokeReason,
    }, {
      onSuccess: async () => {
        if (!isCurrentVisit(requestedGeneration)) return;
        toast.success("Internal approval revoked.");
        closeRevoke();
        await invalidateDecisionState().catch(() => {});
      },
      onError: (err) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        if (err.data?.code === "CONFLICT") {
          toast.error("This approval changed since it was loaded. Refresh before revoking.");
          resetRevokeIntent();
          void utils.estimate.getInternalApproval.invalidate({ id: estimateId! }).catch(() => {});
          return;
        }
        toast.error(`Revocation failed: ${err.message}`);
      },
    });
  }

  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [createVersionReason, setCreateVersionReason] = useState("");
  // Per Core (estimate-version-v2-db.ts createEstimateVersionV2): "current_draft"
  // requires no prior decision at all; "recorded_a1" reads the draft's existing
  // approval/revocation evidence (active or revoked). Only ever one is actually
  // available for a given draft — never both offered as if interchangeable.
  // Never inferred while the decision state itself is unsettled (loading/
  // error/paused) — that would silently offer the WRONG source kind.
  const createVersionSourceKind: "current_draft" | "recorded_a1" | null = internalApprovalUnsettled ? null
    : internalApproval?.state && internalApproval.state !== "none" ? "recorded_a1" : "current_draft";
  const versionPreviewInput = createVersionSourceKind === null ? null : (createVersionSourceKind === "current_draft"
    ? { version: ESTIMATE_VERSION_PROTOCOL_V2.previewCommand, sourceDraftId: estimateId!, sourceKind: "current_draft" as const, confirmedCurrencyCode: "USD" as const }
    : { version: ESTIMATE_VERSION_PROTOCOL_V2.previewCommand, sourceDraftId: estimateId!, sourceKind: "recorded_a1" as const, confirmedCurrencyCode: null }) as any;
  const versionPreviewQuery = trpc.estimate.getEstimateVersionPreview.useQuery(
    versionPreviewInput as any, { enabled: !!estimateId && createVersionOpen && versionPreviewInput !== null && !estimateReadOnly },
  );
  const versionPreview = currentQueryData(versionPreviewQuery);
  const versionPreviewUnsettled = createVersionOpen && (versionPreviewInput === null || versionPreviewQuery.isError || versionPreviewQuery.isFetching || versionPreviewQuery.isPending || versionPreviewQuery.isPaused);
  const [createVersionUsdConfirmed, setCreateVersionUsdConfirmed] = useState(false);
  const createVersionIntentRef = useRef<{ requestId: string; reason: string; fingerprint: string } | null>(null);
  const createVersionSeenFingerprintRef = useRef<string | null>(null);
  function resetCreateVersionIntent(): void {
    createVersionIntentRef.current = null; createVersionSeenFingerprintRef.current = null;
    setCreateVersionReason(""); setCreateVersionUsdConfirmed(false);
  }
  function openCreateVersion(): void {
    resetCreateVersionIntent(); setCreateVersionOpen(true);
    void utils.estimate.getEstimateVersionPreview.invalidate().catch(() => {});
  }
  function closeCreateVersion(): void { setCreateVersionOpen(false); resetCreateVersionIntent(); }
  useEffect(() => {
    if (!createVersionOpen) return;
    if (!versionPreview) {
      // Same group-1 fix as approve's effect: a confirmation entered while
      // the preview is still unavailable must never survive its arrival.
      createVersionSeenFingerprintRef.current = "__awaiting_review__";
      return;
    }
    const fingerprint = `${versionPreview.sourceVersion}:${versionPreview.sourceContentHash}`;
    const priorFingerprint = createVersionSeenFingerprintRef.current;
    if (priorFingerprint !== null && priorFingerprint !== fingerprint) {
      setCreateVersionReason(""); setCreateVersionUsdConfirmed(false);
      toast.warning(priorFingerprint === "__awaiting_review__"
        ? "Review the content below before confirming."
        : "The content to copy changed. Re-confirm before creating a version.");
    }
    createVersionSeenFingerprintRef.current = fingerprint;
  }, [createVersionOpen, versionPreview]);
  const createVersionMutation = trpc.estimate.createVersion.useMutation();
  function submitCreateVersion(): void {
    if (estimateReadOnly) return;
    if (!versionPreview || !estimateId || !createVersionSourceKind || createVersionReason.length < 10) return;
    if (createVersionSourceKind === "current_draft" && !createVersionUsdConfirmed) return;
    const fingerprint = `${versionPreview.sourceVersion}:${versionPreview.sourceContentHash}`;
    const requestId = freezeIntent(createVersionIntentRef, fingerprint, createVersionReason, (a, b) => a === b, () => crypto.randomUUID());
    const requestedGeneration = currentVisitRef.current.generation;
    createVersionMutation.mutate((createVersionSourceKind === "current_draft" ? {
      version: ESTIMATE_VERSION_PROTOCOL_V2.command, sourceDraftId: estimateId, sourceKind: "current_draft",
      requestId, expectedSourceVersion: versionPreview.sourceVersion,
      expectedSourceContentHash: versionPreview.sourceContentHash, reason: createVersionReason, confirmedCurrencyCode: "USD",
    } : {
      version: ESTIMATE_VERSION_PROTOCOL_V2.command, sourceDraftId: estimateId, sourceKind: "recorded_a1",
      requestId, expectedSourceVersion: versionPreview.sourceVersion,
      expectedSourceContentHash: versionPreview.sourceContentHash, reason: createVersionReason, confirmedCurrencyCode: null,
    }) as any, {
      onSuccess: async (result) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        toast.success("New version created — it carries no decision yet.");
        closeCreateVersion();
        await invalidateDecisionState().catch(() => {});
        // MICHAEL-A1-DECISION-CYCLE-V2-QA-AND-CORRECTION.md item 1: the visit
        // can change DURING the await above — re-check immediately before
        // navigating, not just before the await started.
        if (!isCurrentVisit(requestedGeneration)) return;
        navigate(`/estimates/${result.draftId}`);
      },
      onError: (err) => {
        if (!isCurrentVisit(requestedGeneration)) return;
        if (err.data?.code === "CONFLICT") {
          toast.error("This estimate's version state changed. Review the new preview before creating a version.");
          resetCreateVersionIntent();
          void utils.estimate.getEstimateVersionPreview.invalidate().catch(() => {});
          return;
        }
        toast.error(`Creating a new version failed: ${err.message}`);
      },
    });
  }
  const canApprove = draft && draft.status === "draft" && !internalApprovalUnsettled && (!internalApproval || internalApproval.state === "none");
  const canRevoke = !internalApprovalUnsettled && internalApproval?.state === "active";

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
        {!estimateReadOnly && (
          <Button variant="outline" onClick={() => navigate("/estimate")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Estimates
          </Button>
        )}
      </div>
    );
  }

  if (isHistorical) return <div className="space-y-4"><h1 className="text-2xl font-bold">Historical estimate</h1><HistoricalCaptureNotice />
    {estimateReadOnly
      ? <p className="text-sm text-muted-foreground">The historical source and selection listing is unavailable in this read-only view.</p>
      : draft.historicalImportId ? <Button onClick={() => navigate(`/historical-estimates?import=${draft.historicalImportId}`)}>Open recorded source and selection</Button>
      : <p>This historical record requires its linked source before it can be displayed.</p>}</div>;

  const metadata = (draft.metadata as Record<string, unknown>) ?? {};
  const display = buildEstimateDisplay(draft);
  const summary = display.state === "available" ? display.summary : null;
  const assemblies = display.state === "available" && display.selections.state === "known" ? display.selections.rows : [];
  const lineItems = display.state === "available" && display.lines.state === "known" ? display.lines.rows : [];
  const isLegacyDisplay = display.state === "available" && display.representation === "legacy";
  const storedContext = display.state === "available" && display.provenance.state === "known" ? display.provenance : null;
  const displayedScopeId = isLegacyDisplay ? draft.scopeDraftId : storedContext?.scopeDraftId;
  const hasProvenance = isLegacyDisplay && !!metadata?.contextSnapshot;
  // Stage/override badges are legacy row annotations, never inferred v2 fields.
  const legacyAssemblies = isLegacyDisplay && Array.isArray(draft.assemblySelections) ? draft.assemblySelections : [];

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {!estimateReadOnly && (
            <button
              onClick={() => navigate("/estimate")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Estimates
            </button>
          )}
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-foreground">
              <span className="text-gold font-mono">EST-{String(draft.id).padStart(5, "0")}</span>
            </h1>
            <StatusBadge status={draft.status} />
            <SourceBadge source={draft.source} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">{draft.bundleName}</p>
        </div>

        {draft.projectId && !estimateReadOnly && <a href={`/actuals?projectId=${draft.projectId}`} className="text-sm text-gold underline">View project costs</a>}
        {/* Export Actions — A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md */}
        <div className="flex items-center gap-2">
          {estimateReadOnly ? (
            <p role="status" className="text-sm text-muted-foreground">Export actions are unavailable in this read-only view.</p>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={deliverExport.isPending}
                onClick={() => runExportPdf()}>
                <Download className="h-3.5 w-3.5 mr-1.5" />PDF
              </Button>
              <Button variant="outline" size="sm" disabled={deliverJsonExport.isPending}
                onClick={() => runExportJson()}>
                <FileJson className="h-3.5 w-3.5 mr-1.5" />JSON
              </Button>
              <Button variant="outline" size="sm" disabled={deliverPrintable.isPending}
                onClick={() => runExportPrintable()}>
                <Printer className="h-3.5 w-3.5 mr-1.5" />Print
              </Button>
              <div className="w-px h-6 bg-border" />
              <Button variant="outline" size="sm" disabled={validateCsv.isPending}
                onClick={() => runValidateCsv()}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />Validate CSV
              </Button>
              <Button variant="outline" size="sm" disabled={deliverCsvExport.isPending}
                onClick={() => runExportCsv()}>
                <Download className="h-3.5 w-3.5 mr-1.5" />JobTread CSV
              </Button>
              <div className="w-px h-6 bg-border" />
              <Select value={preflightFormat} onValueChange={(value) => setPreflightFormat(value as typeof preflightFormat)}>
                <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="printable">Printable</SelectItem>
                  <SelectItem value="csv_jobtread">JobTread CSV</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" disabled={runPreflight.isPending}
                onClick={() => runExportPreflight()}>
                Run Preflight
              </Button>
            </>
          )}

          {!estimateReadOnly && (
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
          )}
        </div>
      </div>

      {/* ADR-002 partial-read UI reservation: short explanation of the recut. */}
      {estimateReadOnly && (
        <div role="status" aria-label="Partial read-only view" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
          Read-only view: you can inspect this estimate and its approval review. Changes, exports, and project costs are not available yet.
        </div>
      )}

      {/* Sprint 20: Quick Actions Bar */}
      {(canReject || canReopen) && (
        <div className="flex items-center gap-3 rounded-xl border border-gold/20 bg-card px-4 py-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-gold mr-2">Quick Actions</span>
          <div className="h-4 w-px bg-border" />

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
                    onClick={submitReject}
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
              onClick={submitReopen}
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

      {/* Legacy approval banner — confers no real A1 authority. */}
      {draft.status === "approved" && (
        <div className="rounded-xl border border-gray-500/30 bg-gray-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-bold text-gray-400">Legacy — Review Required</span>
            {draft.approvedAt && (
              <span className="text-xs text-muted-foreground">legacy status set on {fmtDate(draft.approvedAt)}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 ml-6">This legacy status is not an internal approval and grants no export authority. Use Internal Approval below.</p>
        </div>
      )}

      {/* A1 Decision Cycle — A1-DECISION-CYCLE-SURFACE-INTEGRATION-CONTRACT.md */}
      <div className="rounded-xl border border-gold/20 bg-card px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-gold">Internal Approval (A1)</span>
          <div className="flex items-center gap-2">
            {canApprove && (
              <Dialog open={approveOpen} onOpenChange={(open) => { if (open) openApprove(); else closeApprove(); }}>
                <DialogTrigger asChild>
                  {estimateReadOnly ? (
                    <Button variant="outline" size="sm">
                      <Eye className="h-3.5 w-3.5 mr-1.5" />View approval review
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="border-green-500/30 hover:border-green-500/50 text-green-400 hover:text-green-300">
                      <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Approve
                    </Button>
                  )}
                </DialogTrigger>
                <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] flex flex-col">
                  <DialogHeader className="shrink-0">
                    <DialogTitle className="text-foreground">Internal Approval — EST-{String(draft.id).padStart(5, "0")}</DialogTitle>
                    <DialogDescription>
                      This records an internal review decision only — not a client-facing proposal, acceptance, or execution authority.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2 flex-1 min-h-0 overflow-y-auto pr-1">
                    {approveReviewUnsettled || !approveReview ? (
                      <p className="text-sm text-muted-foreground" role="status">
                        {approveReviewQuery.isError ? "This estimate's review is unavailable right now. Try again."
                          : approveReviewQuery.isPaused ? "Paused — waiting for a network connection to load the reviewed content."
                          : "Loading the current reviewed content…"}
                      </p>
                    ) : (
                      <>
                        <dl className="grid grid-cols-2 gap-3 text-sm">
                          <div><dt className="text-xs text-muted-foreground">Project / Client</dt><dd className="font-mono text-xs break-all">{approveReview.snapshot.identity.projectId} / {approveReview.snapshot.identity.clientId}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Reviewed draft version</dt><dd className="font-mono">{approveReview.snapshot.identity.draftVersion}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Bundle</dt><dd>{approveReview.snapshot.presentation.bundleName ?? "—"}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Currency</dt><dd className="font-mono">{approveReview.snapshot.financials.currencyCode}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Final price</dt><dd className="font-mono">{formatMinorUSD(approveReview.snapshot.financials.finalPriceMinor)}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Estimated cost</dt><dd className="font-mono">{formatMinorUSD(approveReview.snapshot.financials.estimatedCostMinor)}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Channel / Finish / Region</dt><dd>{capitalize(approveReview.snapshot.commercialContext.pricingContext.pricingChannel)} / {capitalize(approveReview.snapshot.commercialContext.pricingContext.finishLevel)} / {approveReview.snapshot.commercialContext.pricingContext.region}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Commercial channel / Geo risk</dt><dd>{capitalize(approveReview.snapshot.commercialContext.policyContext.commercialChannel)} / {capitalize(approveReview.snapshot.commercialContext.policyContext.geoRiskClass)}</dd></div>
                          <div className="col-span-2"><dt className="text-xs text-muted-foreground">Policy / geocode provenance</dt><dd className="text-xs">{approveReview.snapshot.commercialContext.policyContext.channelBasis} channel basis · geocoded via {approveReview.snapshot.commercialContext.policyContext.projectGeo.geocodeSource} ({approveReview.snapshot.commercialContext.policyContext.projectGeo.geocodeConfidence} confidence) on {fmtDate(approveReview.snapshot.commercialContext.policyContext.projectGeo.geocodedAt)}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Profit Shield floor</dt><dd className={approveReview.evaluation.passed ? "text-emerald-400" : "text-red-400"}>{approveReview.evaluation.passed ? "Passed" : "Failed"} (floor {approveReview.evaluation.effectiveFloorPct}%)</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Line items</dt><dd>{approveReview.snapshot.lines.length} line(s)</dd></div>
                        </dl>
                        {!approveReview.evaluation.passed && (
                          <p role="alert" className="text-xs text-red-400 border border-red-500/30 rounded-lg px-2 py-1.5">
                            This estimate does not meet the required profit margin for its channel. It cannot be approved until that is resolved.
                          </p>
                        )}
                        {approveReview.snapshot.presentation.reviewedNotes && (
                          <p className="text-xs text-muted-foreground border-t border-border pt-2">{approveReview.snapshot.presentation.reviewedNotes}</p>
                        )}
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">Line detail</summary>
                          <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                            {approveReview.snapshot.lines.map((line) => (
                              <div key={line.lineKey} className="flex justify-between gap-2">
                                <span className="truncate">{line.costItemName}</span>
                                <span className="font-mono whitespace-nowrap">{line.quantity} {line.unit} · {formatMinorUSD(line.lineTotalPriceMinor)}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                        <p className="text-xs text-muted-foreground font-mono break-all">Hash {approveReview.contentHash.slice(0, 16)}… / policy {approveReview.policyHash.slice(0, 16)}…</p>
                      </>
                    )}
                    {!estimateReadOnly && (
                      <>
                        <div className="flex items-start gap-2">
                          <Checkbox id="approve-usd" checked={approveUsdConfirmed} disabled={approveReviewUnsettled || !approveReview}
                            onCheckedChange={(v) => setApproveUsdConfirmed(v === true)} className="mt-0.5" />
                          <label htmlFor="approve-usd" className="text-xs text-foreground">I confirm the amounts above are in USD and I have reviewed this exact content.</label>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase">Reason (min 10 characters)</label>
                          <Textarea value={approveReason} onChange={(e) => setApproveReason(e.target.value)} disabled={approveReviewUnsettled || !approveReview}
                            placeholder="Why this estimate is being internally approved…" className="mt-1 min-h-[80px] bg-surface border-border" />
                        </div>
                      </>
                    )}
                  </div>
                  <DialogFooter className="shrink-0">
                    <Button variant="outline" onClick={closeApprove}>{estimateReadOnly ? "Close" : "Cancel"}</Button>
                    {!estimateReadOnly && (
                      <Button
                        onClick={submitApprove}
                        disabled={approveReviewUnsettled || !approveReview || !approveReview.evaluation.passed || !approveUsdConfirmed || approveMutation.isPending || approveReason.length < 10}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {approveMutation.isPending ? "Approving…" : "Confirm Internal Approval"}
                      </Button>
                    )}
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {!estimateReadOnly && canRevoke && internalApproval?.state === "active" && (
              <Dialog open={revokeOpen} onOpenChange={(open) => { if (open) openRevoke(); else closeRevoke(); }}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="border-orange-500/30 hover:border-orange-500/50 text-orange-400 hover:text-orange-300">
                    <ShieldOff className="h-3.5 w-3.5 mr-1.5" />Revoke
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-border max-h-[85vh] flex flex-col">
                  <DialogHeader className="shrink-0">
                    <DialogTitle className="text-foreground">Revoke Internal Approval</DialogTitle>
                    <DialogDescription>
                      This revokes the current internal approval. The reviewed snapshot is preserved, never edited; this estimate cannot be re-approved afterward — create a new version instead.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2 flex-1 min-h-0 overflow-y-auto pr-1">
                    {internalApproval.state === "active" && (
                      <dl className="grid grid-cols-2 gap-3 text-sm border-b border-border pb-3">
                        <div><dt className="text-xs text-muted-foreground">Approval identity</dt><dd className="font-mono text-xs break-all">{internalApproval.approval.id}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Approved by / on</dt><dd className="text-xs">{internalApproval.approval.approvedBy} · {fmtDate(internalApproval.approval.approvedAt)}</dd></div>
                        <div className="col-span-2"><dt className="text-xs text-muted-foreground">Snapshot content hash</dt><dd className="font-mono text-xs break-all">{internalApproval.snapshot.contentHash}</dd></div>
                      </dl>
                    )}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Reason (min 10 characters)</label>
                      <Textarea value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)}
                        placeholder="Why this internal approval is being revoked…" className="mt-1 min-h-[80px] bg-surface border-border" />
                    </div>
                  </div>
                  <DialogFooter className="shrink-0">
                    <Button variant="outline" onClick={closeRevoke}>Cancel</Button>
                    <Button
                      onClick={submitRevoke}
                      disabled={internalApproval?.state !== "active" || revokeMutation.isPending || revokeReason.length < 10}
                      className="bg-orange-600 hover:bg-orange-700 text-white"
                    >
                      {revokeMutation.isPending ? "Revoking…" : "Confirm Revocation"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {!estimateReadOnly && (
            <Dialog open={createVersionOpen} onOpenChange={(open) => { if (open) openCreateVersion(); else closeCreateVersion(); }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <GitBranch className="h-3.5 w-3.5 mr-1.5" />Create New Version
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] flex flex-col">
                <DialogHeader className="shrink-0">
                  <DialogTitle className="text-foreground">Create New Version</DialogTitle>
                  <DialogDescription>
                    {createVersionSourceKind === null
                      ? (internalApprovalQuery.isError ? "The current decision state is unavailable right now. Try again."
                        : internalApprovalQuery.isPaused ? "Paused — waiting for a network connection to resolve the current decision state."
                        : "Resolving the current decision state…")
                      : createVersionSourceKind === "recorded_a1"
                      ? "Creates a new draft copied from this draft's recorded A1 evidence." : "Creates a new draft copied from the current draft."}
                    {" "}The new version carries no decision — it must be reviewed and approved separately.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2 flex-1 min-h-0 overflow-y-auto pr-1">
                  {versionPreviewUnsettled || !versionPreview ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {createVersionSourceKind === null
                        ? (internalApprovalQuery.isError ? "The current decision state is unavailable right now. Try again."
                          : internalApprovalQuery.isPaused ? "Paused — waiting for a network connection to resolve the current decision state."
                          : "Resolving the current decision state before offering a source…")
                        : versionPreviewQuery.isError ? "This estimate's version preview is unavailable right now. Try again."
                        : versionPreviewQuery.isPaused ? "Paused — waiting for a network connection to load the content to copy."
                        : "Loading the exact content to copy…"}
                    </p>
                  ) : (
                    <>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div><dt className="text-xs text-muted-foreground">Source version</dt><dd className="font-mono">{versionPreview.sourceVersion}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{createVersionSourceKind === "recorded_a1" ? `Recorded A1 (${versionPreview.sourceApprovalState})` : "Current draft"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Project / Client</dt><dd className="font-mono text-xs break-all">{versionPreview.content.identity.projectId} / {versionPreview.content.identity.clientId}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Channel / Region</dt><dd>{capitalize(versionPreview.content.commercialContext.pricingContext.pricingChannel)} / {versionPreview.content.commercialContext.pricingContext.region}</dd></div>
                        <div className="col-span-2"><dt className="text-xs text-muted-foreground">Policy / geocode provenance</dt><dd className="text-xs">{versionPreview.content.commercialContext.policyContext.channelBasis} channel basis · geocoded via {versionPreview.content.commercialContext.policyContext.projectGeo.geocodeSource} ({versionPreview.content.commercialContext.policyContext.projectGeo.geocodeConfidence} confidence) on {fmtDate(versionPreview.content.commercialContext.policyContext.projectGeo.geocodedAt)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Final price</dt><dd className="font-mono">{formatMinorUSD(versionPreview.content.financials.finalPriceMinor)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Line items</dt><dd>{versionPreview.content.lines.length} line(s)</dd></div>
                      </dl>
                      {versionPreview.content.presentation.reviewedNotes && (
                        <p className="text-xs text-muted-foreground border-t border-border pt-2">{versionPreview.content.presentation.reviewedNotes}</p>
                      )}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Line detail</summary>
                        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                          {versionPreview.content.lines.map((line) => (
                            <div key={line.lineKey} className="flex justify-between gap-2">
                              <span className="truncate">{line.costItemName}</span>
                              <span className="font-mono whitespace-nowrap">{line.quantity} {line.unit} · {formatMinorUSD(line.lineTotalPriceMinor)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                      <p className="text-xs text-muted-foreground font-mono break-all">Content hash {versionPreview.sourceContentHash.slice(0, 16)}…</p>
                    </>
                  )}
                  {createVersionSourceKind === "current_draft" && (
                    <div className="flex items-start gap-2">
                      <Checkbox id="version-usd" checked={createVersionUsdConfirmed} disabled={versionPreviewUnsettled || !versionPreview}
                        onCheckedChange={(v) => setCreateVersionUsdConfirmed(v === true)} className="mt-0.5" />
                      <label htmlFor="version-usd" className="text-xs text-foreground">I confirm the amounts above are in USD and I have reviewed this exact content.</label>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Reason (min 10 characters)</label>
                    <Textarea value={createVersionReason} onChange={(e) => setCreateVersionReason(e.target.value)} disabled={versionPreviewUnsettled || !versionPreview}
                      placeholder="Why a new version is being created…" className="mt-1 min-h-[80px] bg-surface border-border" />
                  </div>
                </div>
                <DialogFooter className="shrink-0">
                  <Button variant="outline" onClick={closeCreateVersion}>Cancel</Button>
                  <Button
                    onClick={submitCreateVersion}
                    disabled={versionPreviewUnsettled || !versionPreview || !createVersionSourceKind
                      || (createVersionSourceKind === "current_draft" && !createVersionUsdConfirmed)
                      || createVersionMutation.isPending || createVersionReason.length < 10}
                  >
                    {createVersionMutation.isPending ? "Creating…" : "Confirm New Version"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </div>

        {internalApprovalUnsettled ? (
          <p className="text-xs text-muted-foreground" role="status">
            {internalApprovalQuery.isError ? "Internal approval state is unavailable right now."
              : internalApprovalQuery.isPaused ? "Paused — waiting for a network connection to load internal approval state."
              : "Loading internal approval state…"}
          </p>
        ) : internalApproval?.state === "active" ? (
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-green-400" />
            <span className="text-green-400 font-semibold">Internally approved</span>
            <span className="text-xs text-muted-foreground">by {internalApproval.approval.approvedBy} on {fmtDate(internalApproval.approval.approvedAt)}</span>
          </div>
        ) : internalApproval?.state === "revoked" ? (
          <div className="flex items-center gap-2 text-sm">
            <ShieldOff className="h-4 w-4 text-orange-400" />
            <span className="text-orange-400 font-semibold">Internal approval revoked</span>
            <span className="text-xs text-muted-foreground">on {fmtDate(internalApproval.revocation.revokedAt)}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No internal approval decision has been recorded for this estimate.</p>
        )}
      </div>

      {estimateReadOnly ? (
        <section aria-label="Export authorization" role="status" className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
          Export authorization and export history are unavailable in this read-only view.
        </section>
      ) : (
        <>
          {exportAuthorization && !exportAuthorization.authorized && (
            <section aria-label="Export authorization" role="status" className="rounded-xl border border-amber-500/30 px-4 py-3 text-sm text-amber-400 space-y-1">
              <p>{exportBlockMessage(exportAuthorization.code)}</p>
              {blockedExportId && (
                <p>
                  <button type="button" className="underline" onClick={() => setSelectedExportId(blockedExportId)}>
                    View this blocked attempt
                  </button>
                </p>
              )}
            </section>
          )}

          {/* Export history — real listExports.useQuery; never a cached/reusable authorization. */}
          {exportHistory.length > 0 && (
            <section aria-label="Export history" className="rounded-xl border border-border bg-card p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Export history</p>
              {exportHistory.map((row) => (
                <div key={row.exportId} className="flex items-center justify-between text-sm gap-2">
                  <span className="text-muted-foreground">
                    {row.format ?? "legacy"} · {row.kind ?? "—"} · {row.status}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => setSelectedExportId(row.exportId)}>Details</Button>
                    {row.availability === "requires_revalidation" && (
                      <Button variant="outline" size="sm" disabled={redownload.isPending}
                        onClick={() => redownloadFrom(row.exportId)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {/* Export detail — authenticated, closed A1 manifest only; never content/bytes/URL. */}
      {!estimateReadOnly && (
      <Dialog open={selectedExportId !== null} onOpenChange={(open) => { if (!open) setSelectedExportId(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Export attempt detail</DialogTitle>
          </DialogHeader>
          {exportDetail ? (
            <div className="text-sm space-y-1">
              <p>Format: {exportDetail.format ?? "legacy"}</p>
              <p>Kind: {exportDetail.kind ?? "—"}</p>
              <p>Status: {exportDetail.status}</p>
              <p>Checked: {exportDetail.checkedAt ?? "—"}</p>
              {exportDetail.validation && exportDetail.validation.issues.length > 0 && (
                <p>{exportBlockMessage(exportDetail.validation.issues[0].code)}</p>
              )}
              {exportDetail.availability === "requires_revalidation" && (
                <Button size="sm" disabled={redownload.isPending}
                  onClick={() => redownloadFrom(exportDetail.exportId)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />Download
                </Button>
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground">Loading…</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedExportId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Printable preview — sandboxed (no scripts/network), with ONLY the modal
       * capability the system print dialog needs — MICHAEL-A1-EXPORT-SURFACE-V1-
       * QA-AND-CORRECTION.md item 6: `allow-same-origin` alone makes the browser
       * ignore contentWindow.print() outright (confirmed in real Chrome,
       * A1-EXPORT-SURFACE-V1-BROWSER-EVIDENCE.md). `allow-modals` adds nothing
       * else: still no scripts, no network/forms/popups, no top-navigation. */}
      {!estimateReadOnly && (
      <Dialog open={printableHtml !== null} onOpenChange={(open) => { if (!open) setPrintableHtml(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Printable preview</DialogTitle>
            <DialogDescription>This is the file that was generated for you — not a live draft.</DialogDescription>
          </DialogHeader>
          {printableHtml !== null && (
            <iframe
              ref={printableFrameRef}
              title="Printable export preview"
              sandbox="allow-same-origin allow-modals"
              srcDoc={printableHtml}
              className="w-full h-[60vh] rounded-lg border border-border bg-white"
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintableHtml(null)}>Close</Button>
            <Button onClick={() => printableFrameRef.current?.contentWindow?.print()}>
              <Printer className="h-3.5 w-3.5 mr-1.5" />Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Metadata Row */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {isLegacyDisplay ? draft.region ?? "N/A" : storedContext?.pricing.region ?? "Unavailable"}</span>
        <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {isLegacyDisplay ? capitalize(draft.channel) : storedContext?.pricing.channel ? capitalize(storedContext.pricing.channel) : "Unavailable"}</span>
        <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {isLegacyDisplay ? capitalize(draft.finishLevel) : storedContext?.pricing.finishLevel ? capitalize(storedContext.pricing.finishLevel) : "Unavailable"}</span>
        <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> {isLegacyDisplay ? `v${draft.pricingSchemaVersion ?? "1.0"}` : storedContext?.pricingSchemaVersion ? `v${storedContext.pricingSchemaVersion}` : "Unavailable"}</span>
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDate(draft.createdAt)}</span>
        {displayedScopeId && (
          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> Scope #{displayedScopeId}</span>
        )}
      </div>

      {/* Financial Summary */}
      <div>
        <SectionLabel text="Financial Summary" icon={Zap} />
        {display.state === "unavailable" && <p role="status" className="mb-3 text-sm text-amber-400">
          Estimate values unavailable. Reconcile this record before relying on its totals.
        </p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricCard label="Total Cost" value={formatEstimateMoney(summary?.subtotalCost ?? unavailableValue)} />
          <MetricCard label="Total Price" value={formatEstimateMoney(summary?.subtotalPrice ?? unavailableValue)} />
          <MetricCard label="Gross Profit" value={formatEstimateMoney(summary?.grossProfit ?? unavailableValue)} accent="emerald" />
          <MetricCard label="GP %" value={formatEstimatePercent(summary?.grossProfitPct ?? unavailableValue)} />
          <MetricCard label="Discount" value={formatEstimatePercent(summary?.discountRatioPct ?? unavailableValue)} />
          <MetricCard label="Discount Amt" value={formatEstimateMoney(summary?.discountAmount ?? unavailableValue)} />
          <MetricCard label="Final Total" value={formatEstimateMoney(summary?.finalTotalPrice ?? unavailableValue)} accent="gold" />
        </div>
      </div>

      {/* Profit Shield */}
      {estimateReadOnly ? (
        <div role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Stored pricing check unavailable in this read-only view.</div>
      ) : (
        <ProfitShieldStatus query={profitShieldQuery} />
      )}

      {/* Pricing Provenance Panel */}
      {hasProvenance && <ProvenancePanel metadata={metadata} draft={draft} />}
      {storedContext && <StoredPricingContext context={storedContext} />}

      {/* Assembly Selections */}
      {display.state === "available" && display.selections.state === "unavailable" && (
        <p className="text-sm text-muted-foreground">Assembly selections unavailable</p>
      )}
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
                        {asm.assemblyName ?? "Unavailable"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">
                        {asm.category ?? "Unavailable"}
                      </td>
                      <td className="px-3 py-2 text-center font-mono font-semibold text-gold">
                        {formatEstimateQuantity(asm.quantity)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {formatEstimateUnitRate(asm.unitCost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {formatEstimateUnitRate(asm.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                        {formatEstimateMoney(asm.totalPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {formatEstimatePercent(asm.grossProfitPct)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {legacyAssemblies[idx]?.stage && (
                            <Badge variant="outline" className="text-[0.55rem] px-1.5 py-0 border-cyan-500/30 text-cyan-400">
                              {legacyAssemblies[idx].stage}
                            </Badge>
                          )}
                          {legacyAssemblies[idx]?.overrideFlag && (
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
      {display.state === "available" && display.lines.state === "unavailable" && (
        <p className="text-sm text-muted-foreground">Line items unavailable</p>
      )}
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
                      <td className="px-3 py-2 font-medium text-foreground max-w-[180px] truncate">{li.costItemName ?? "Unavailable"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{li.costGroupName ?? "Unavailable"}</td>
                      <td className="px-3 py-2 text-center font-mono font-semibold text-gold">{formatEstimateQuantity(li.quantity)}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{li.unit ?? "Unavailable"}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{formatEstimateUnitRate(li.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{formatEstimateMoney(li.totalPrice)}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{formatEstimatePercent(li.grossProfitPct)}</td>
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
