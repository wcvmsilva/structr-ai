/**
 * structr.ai — Scope Review Workspace
 * Sprint 14: Operator review, delta application, approve/reject, convert to bundle
 *
 * Connects to scopeReview router for state machine operations
 * and scope router for listing drafts.
 */

import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import {
  CheckSquare,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Play,
  Minus,
  SlidersHorizontal,
  Package,
  AlertTriangle,
  Shield,
  Loader2,
  X,
  MapPin,
  ArrowRight,
  Plus,
  Info,
} from "lucide-react";
import { toast } from "sonner";

// ══════════════════════════════════════════════════════════════════════
// STATUS BADGE
// ══════════════════════════════════════════════════════════════════════

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Draft" },
  under_review: { bg: "bg-purple-500/10", text: "text-purple-400", label: "Under Review" },
  approved: { bg: "bg-green-500/10", text: "text-green-400", label: "Approved" },
  rejected: { bg: "bg-red-500/10", text: "text-red-400", label: "Rejected" },
  converted: { bg: "bg-gold/10", text: "text-gold", label: "Converted" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold",
        style.bg,
        style.text
      )}
    >
      {style.label}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// METRIC CELL
// ══════════════════════════════════════════════════════════════════════

function ReviewMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="px-4 py-3 text-center">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-bold mt-1",
          highlight ? "text-gold" : "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SECTION LABEL
// ══════════════════════════════════════════════════════════════════════

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
        {text}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// DELTA DIALOG (inline form)
// ══════════════════════════════════════════════════════════════════════

function DeltaForm({
  scopeDraftId,
  item,
  onClose,
}: {
  scopeDraftId: string;
  item: { assemblyId: string; quantity: number; reason: string };
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [actionType, setActionType] = useState<"remove" | "quantity_adjustment">("quantity_adjustment");
  const [newQuantity, setNewQuantity] = useState(item.quantity.toString());
  const [reason, setReason] = useState("");

  const applyDelta = trpc.scopeReview.applyDelta.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.scopeReview.getReviewState.invalidate({ scopeDraftId });
      onClose();
    },
    onError: (err) => {
      toast.error("Delta failed", { description: err.message });
    },
  });

  const handleSubmit = () => {
    if (!reason.trim()) {
      toast.error("Operator reason is required");
      return;
    }
    applyDelta.mutate({
      scopeDraftId,
      assemblyId: item.assemblyId,
      actionType,
      previousQuantity: item.quantity,
      newQuantity: actionType === "remove" ? 0 : parseFloat(newQuantity),
      operatorReason: reason,
    });
  };

  return (
    <div className="mt-3 p-4 rounded-lg border border-gold/20 bg-surface/50 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Apply Delta — Assembly #{item.assemblyId}</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setActionType("quantity_adjustment")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all",
            actionType === "quantity_adjustment"
              ? "border-gold/40 bg-gold/10 text-gold"
              : "border-border text-muted-foreground hover:bg-surface-hover"
          )}
        >
          <SlidersHorizontal className="h-3 w-3" />
          Adjust Qty
        </button>
        <button
          onClick={() => setActionType("remove")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all",
            actionType === "remove"
              ? "border-red-500/40 bg-red-500/10 text-red-400"
              : "border-border text-muted-foreground hover:bg-surface-hover"
          )}
        >
          <Minus className="h-3 w-3" />
          Remove
        </button>
      </div>

      {actionType === "quantity_adjustment" && (
        <div>
          <label className="text-xs text-muted-foreground">New Quantity</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold/50 focus:outline-none"
          />
        </div>
      )}

      <div>
        <label className="text-xs text-muted-foreground">Operator Reason (required)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold/50 focus:outline-none resize-none"
          placeholder="Explain why this change is needed..."
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={applyDelta.isPending}
        className={cn(
          "w-full rounded-lg px-4 py-2 text-sm font-medium transition-all",
          actionType === "remove"
            ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
            : "bg-gold/20 text-gold hover:bg-gold/30",
          applyDelta.isPending && "opacity-50 cursor-not-allowed"
        )}
      >
        {applyDelta.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mx-auto" />
        ) : actionType === "remove" ? (
          "Remove Assembly"
        ) : (
          "Apply Quantity Adjustment"
        )}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// GEOGRAPHIC OVERRIDE PANEL (Sprint 16)
// ══════════════════════════════════════════════════════════════════════

const OVERRIDE_TYPE_STYLES: Record<string, { bg: string; text: string; icon: typeof ArrowRight; label: string }> = {
  swap: { bg: "bg-blue-500/10", text: "text-blue-400", icon: ArrowRight, label: "Swap" },
  add: { bg: "bg-green-500/10", text: "text-green-400", icon: Plus, label: "Addition" },
  warning_only: { bg: "bg-amber-500/10", text: "text-amber-400", icon: Info, label: "Warning" },
};

function GeographicOverridePanel({
  scopeDraftId,
  projectId,
}: {
  scopeDraftId: string;
  projectId: string;
}) {
  // Fetch project to get zone
  const { data: project } = trpc.project.getById.useQuery({ id: projectId });
  const projectZone = project?.zone ?? "";

  // Fetch override log for this draft
  const { data: overrideLog, isLoading: logLoading } = trpc.geoOverride.getLog.useQuery(
    { scopeDraftId },
  );

  // Fetch override preview if zone exists
  const { data: previewData, isLoading: previewLoading } = trpc.geoOverride.previewForDraft.useQuery(
    { scopeDraftId, projectZone },
    { enabled: !!projectZone && projectZone !== "unknown" }
  );

  const isLoading = logLoading || previewLoading;

  // No zone = no overrides possible
  if (!projectZone || projectZone === "unknown") {
    return (
      <div className="rounded-xl border border-border/50 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Geographic Overrides
          </p>
        </div>
        <p className="text-xs text-muted-foreground mt-2 ml-6">
          No zone detected for this project. Geographic overrides are not applicable.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-gold" />
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">
            Geographic Overrides
          </p>
          <Loader2 className="h-3 w-3 animate-spin text-gold ml-auto" />
        </div>
      </div>
    );
  }

  // Determine if overrides exist
  const hasAppliedOverrides = overrideLog && overrideLog.length > 0;
  const hasPreviewOverrides = previewData && previewData.hasOverrides;
  const overrides = previewData?.overrides ?? [];
  const warnings = previewData?.warnings ?? [];
  const stats = previewData?.stats;

  // No overrides for this zone
  if (!hasAppliedOverrides && !hasPreviewOverrides) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-green-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-green-400">
            Geographic Overrides
          </p>
          <span className="ml-auto text-[0.65rem] font-medium text-muted-foreground bg-surface rounded-full px-2 py-0.5">
            {projectZone}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2 ml-6">
          No geographic overrides applied. All assemblies are standard for this zone.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/20 bg-gold/5 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-gold" />
        <p className="text-xs font-semibold uppercase tracking-wider text-gold">
          Geographic Overrides
        </p>
        <span className="ml-auto text-[0.65rem] font-medium text-gold bg-gold/10 rounded-full px-2 py-0.5">
          {projectZone}
        </span>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg bg-surface/50 p-2">
            <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Swaps</p>
            <p className="text-sm font-bold text-blue-400">{stats.swapsApplied}</p>
          </div>
          <div className="rounded-lg bg-surface/50 p-2">
            <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Additions</p>
            <p className="text-sm font-bold text-green-400">{stats.additionsApplied}</p>
          </div>
          <div className="rounded-lg bg-surface/50 p-2">
            <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Warnings</p>
            <p className="text-sm font-bold text-amber-400">{stats.warningsGenerated}</p>
          </div>
          <div className="rounded-lg bg-surface/50 p-2">
            <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">Rules Matched</p>
            <p className="text-sm font-bold text-foreground">{stats.rulesMatched}</p>
          </div>
        </div>
      )}

      {/* Override Details */}
      {overrides.length > 0 && (
        <div className="space-y-2">
          {overrides.filter(o => !o.skippedBecauseAlreadyApplied).map((o, idx) => {
            const style = OVERRIDE_TYPE_STYLES[o.overrideType] ?? OVERRIDE_TYPE_STYLES.swap;
            const Icon = style.icon;
            return (
              <div
                key={idx}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  o.overrideType === "swap" ? "border-blue-500/20 bg-blue-500/5" :
                  o.overrideType === "add" ? "border-green-500/20 bg-green-500/5" :
                  "border-amber-500/20 bg-amber-500/5"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-semibold", style.bg, style.text)}>
                    <Icon className="h-3 w-3 mr-1" />
                    {style.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{o.trade}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className="text-foreground font-medium">{o.originalAssemblyName}</span>
                  {o.overrideType !== "warning_only" && (
                    <>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="text-gold font-medium">{o.replacementAssemblyName}</span>
                    </>
                  )}
                </div>
                <p className="text-[0.65rem] text-muted-foreground mt-1 italic">
                  {o.overrideReason}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Override Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-amber-400">
              Override Warnings
            </p>
          </div>
          <ul className="space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-[0.65rem] text-amber-300/80 pl-5">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Applied Log */}
      {hasAppliedOverrides && (
        <div className="text-[0.65rem] text-muted-foreground">
          <Shield className="h-3 w-3 inline mr-1" />
          {overrideLog!.length} override(s) persisted in audit log
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// REVIEW DETAIL PANEL
// ══════════════════════════════════════════════════════════════════════

function ReviewDetail({ scopeDraftId, onBack }: { scopeDraftId: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.scopeReview.getReviewState.useQuery({ scopeDraftId });
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const startReview = trpc.scopeReview.startReview.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      utils.scopeReview.getReviewState.invalidate({ scopeDraftId });
      utils.scope.listDrafts.invalidate();
    },
    onError: (err) => toast.error("Failed to start review", { description: err.message }),
  });

  const approveOrReject = trpc.scopeReview.approveOrReject.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      utils.scopeReview.getReviewState.invalidate({ scopeDraftId });
      utils.scope.listDrafts.invalidate();
      setShowRejectForm(false);
    },
    onError: (err) => toast.error("Decision failed", { description: err.message }),
  });

  const convertToBundle = trpc.scopeReview.convertToBundle.useMutation({
    onSuccess: (res) => {
      if (res.profitShieldPassed) {
        toast.success(res.message);
      } else {
        toast.warning(res.message, {
          description: `${res.profitShieldWarnings.length} Profit Shield warning(s)`,
          duration: 8000,
        });
      }
      utils.scopeReview.getReviewState.invalidate({ scopeDraftId });
      utils.scope.listDrafts.invalidate();
    },
    onError: (err) => toast.error("Conversion failed", { description: err.message }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-400">{error?.message ?? "Failed to load review state"}</p>
        <button onClick={onBack} className="mt-3 text-xs text-muted-foreground hover:text-foreground underline">
          Back to queue
        </button>
      </div>
    );
  }

  const { draft, effectiveItems, deltas, snapshot, validNextStates, isTerminal } = data;
  const status = draft.status as string;

  return (
    <div className="flex flex-col gap-5">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm">
          ← Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-foreground">Scope Draft #{draft.id}</h2>
            <StatusBadge status={status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Project #{draft.projectId} — Intake #{draft.intakeFormId}
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-4 divide-x divide-border/50 rounded-xl border border-border bg-card">
        <ReviewMetric
          label="Confidence"
          value={draft.confidenceScore ? `${(parseFloat(draft.confidenceScore as string) * 100).toFixed(0)}%` : "N/A"}
          highlight={draft.confidenceScore ? parseFloat(draft.confidenceScore as string) >= 0.8 : false}
        />
        <ReviewMetric label="Items" value={effectiveItems.length.toString()} />
        <ReviewMetric label="Deltas" value={deltas.length.toString()} />
        <ReviewMetric
          label="Snapshot"
          value={snapshot ? `#${snapshot.id}` : "None"}
          highlight={!!snapshot}
        />
      </div>

      {/* Warnings */}
      {draft.warnings && (draft.warnings as string[]).length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Warnings ({(draft.warnings as string[]).length})
            </p>
          </div>
          <ul className="space-y-1">
            {(draft.warnings as string[]).map((w, i) => (
              <li key={i} className="text-xs text-amber-300/80 pl-6">• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Buttons */}
      {!isTerminal && (
        <div className="flex items-center gap-3 flex-wrap">
          {status === "draft" && validNextStates.includes("under_review") && (
            <button
              onClick={() => startReview.mutate({ scopeDraftId })}
              disabled={startReview.isPending}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
                "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-all",
                startReview.isPending && "opacity-50 cursor-not-allowed"
              )}
            >
              <Play className="h-4 w-4" />
              {startReview.isPending ? "Starting..." : "Start Review"}
            </button>
          )}

          {status === "under_review" && (
            <>
              <button
                onClick={() => approveOrReject.mutate({ scopeDraftId, decision: "approved" })}
                disabled={approveOrReject.isPending}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
                  "bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-all",
                  approveOrReject.isPending && "opacity-50 cursor-not-allowed"
                )}
              >
                <ThumbsUp className="h-4 w-4" />
                Approve
              </button>
              <button
                onClick={() => setShowRejectForm(!showRejectForm)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
                  "bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                )}
              >
                <ThumbsDown className="h-4 w-4" />
                Reject
              </button>
            </>
          )}

          {status === "approved" && validNextStates.includes("converted") && (
            <button
              onClick={() => convertToBundle.mutate({ scopeDraftId })}
              disabled={convertToBundle.isPending}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
                "bg-gold/10 text-gold hover:bg-gold/20 transition-all",
                convertToBundle.isPending && "opacity-50 cursor-not-allowed"
              )}
            >
              <Package className="h-4 w-4" />
              {convertToBundle.isPending ? "Converting..." : "Convert to Bundle"}
            </button>
          )}
        </div>
      )}

      {/* Reject Form */}
      {showRejectForm && status === "under_review" && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
          <p className="text-sm font-semibold text-red-400">Reject Scope Draft</p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-red-500/50 focus:outline-none resize-none"
            placeholder="Reason for rejection (optional)..."
          />
          <div className="flex gap-2">
            <button
              onClick={() => approveOrReject.mutate({ scopeDraftId, decision: "rejected", reason: rejectReason })}
              disabled={approveOrReject.isPending}
              className="rounded-lg px-4 py-2 text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
            >
              Confirm Rejection
            </button>
            <button
              onClick={() => setShowRejectForm(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Profit Shield Status (for converted) */}
      {snapshot && (
        <div className="rounded-xl border border-gold/20 bg-gold/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-4 w-4 text-gold" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gold">
              Conversion Snapshot #{snapshot.id}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">{snapshot.approvedItemCount}</span> approved items
            </div>
            <div>
              <span className="font-medium text-foreground">{snapshot.deltaCount}</span> delta changes
            </div>
            <div>
              Bundle: {snapshot.bundleId ? `#${snapshot.bundleId}` : "Pending"}
            </div>
          </div>
        </div>
      )}

      {/* ── Sprint 16: Geographic Override Panel ── */}
      <GeographicOverridePanel scopeDraftId={scopeDraftId} projectId={draft.projectId} />

      {/* Deltas Applied */}
      {deltas.length > 0 && (
        <>
          <SectionLabel text={`Deltas Applied (${deltas.length})`} />
          <div className="space-y-2">
            {deltas.map((d) => (
              <div
                key={d.id}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  d.actionType === "remove"
                    ? "border-red-500/20 bg-red-500/5"
                    : "border-amber-500/20 bg-amber-500/5"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {d.actionType === "remove" ? "Removed" : "Adjusted"} Assembly #{d.assemblyId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {d.previousQuantity} → {d.newQuantity ?? 0}
                  </span>
                </div>
                {d.operatorReason && (
                  <p className="text-xs text-muted-foreground mt-1 italic">"{d.operatorReason}"</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Effective Items */}
      <SectionLabel text={`Effective Items (${effectiveItems.length})`} />
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface/30">
              <th className="px-4 py-2.5 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Assembly
              </th>
              <th className="px-4 py-2.5 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Qty
              </th>
              <th className="px-4 py-2.5 text-center text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Unit
              </th>
              <th className="px-4 py-2.5 text-center text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Confidence
              </th>
              <th className="px-4 py-2.5 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Reason
              </th>
              {status === "under_review" && (
                <th className="px-4 py-2.5 text-center text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Action
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {effectiveItems.map((item) => (
              <tr key={item.id} className="hover:bg-surface-hover/30 transition-colors">
                <td className="px-4 py-2.5 font-medium text-foreground">#{item.assemblyId}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{item.quantity}</td>
                <td className="px-4 py-2.5 text-center text-muted-foreground">{item.unit}</td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                      item.confidence >= 0.8
                        ? "bg-green-500/10 text-green-400"
                        : item.confidence >= 0.5
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-red-500/10 text-red-400"
                    )}
                  >
                    {(item.confidence * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">
                  {item.reason}
                </td>
                {status === "under_review" && (
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => setEditingItem(editingItem === item.assemblyId ? null : item.assemblyId)}
                      className="text-xs text-gold hover:text-gold/80 underline"
                    >
                      {editingItem === item.assemblyId ? "Cancel" : "Edit"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {effectiveItems.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No effective items (all removed by deltas)
          </div>
        )}
      </div>

      {/* Inline Delta Form */}
      {editingItem !== null && status === "under_review" && (
        <DeltaForm
          scopeDraftId={scopeDraftId}
          item={effectiveItems.find((i) => i.assemblyId === editingItem) ?? {
            assemblyId: editingItem,
            quantity: 0,
            reason: "",
          }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════

export default function ReviewPage() {
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectIdInput, setProjectIdInput] = useState<string>("1");
  // listDrafts requires a projectId — use a default project or show a project selector
  // For now, we'll list drafts for project 1 as a starting point
  const [projectId, setProjectId] = useState<string>("");
  const { data: draftsData, isLoading } = trpc.scope.listDrafts.useQuery({ projectId });

  const filteredDrafts = useMemo(() => {
    if (!draftsData) return [];
    if (statusFilter === "all") return draftsData;
    return draftsData.filter((d: any) => d.status === statusFilter);
  }, [draftsData, statusFilter]);

  // If viewing a specific draft, show detail panel
  if (selectedDraftId !== null) {
    return (
      <div className="flex flex-col gap-6">
        <ReviewDetail
          scopeDraftId={selectedDraftId}
          onBack={() => setSelectedDraftId(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <CheckSquare className="h-6 w-6 text-gold" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Scope Review Workspace
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-9">
          Review, adjust, approve, and convert scope drafts to bundles
        </p>
        <div className="h-[2px] w-48 mt-3 ml-9 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
      </div>

      {/* Project Selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project ID</label>
        <input
          type="number"
          min="1"
          value={projectIdInput}
          onChange={(e) => setProjectIdInput(e.target.value)}
          onBlur={() => {
            const val = parseInt(projectIdInput);
            if (val > 0) setProjectId(val);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = parseInt(projectIdInput);
              if (val > 0) setProjectId(val);
            }
          }}
          className="w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-gold/50 focus:outline-none"
        />
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {["all", "draft", "under_review", "approved", "rejected", "converted"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium border transition-all",
              statusFilter === s
                ? "border-gold/40 bg-gold/10 text-gold"
                : "border-border text-muted-foreground hover:bg-surface-hover"
            )}
          >
            {s === "all" ? "All" : STATUS_STYLES[s]?.label ?? s}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      )}

      {/* Draft List */}
      {!isLoading && (
        <>
          <SectionLabel text={`Scope Drafts (${filteredDrafts.length})`} />
          {filteredDrafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <CheckSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">
                {statusFilter === "all"
                  ? "No scope drafts found. Generate one from an intake form."
                  : `No scope drafts with status "${STATUS_STYLES[statusFilter]?.label ?? statusFilter}"`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDrafts.map((draft: any) => (
                <div
                  key={draft.id}
                  className="rounded-xl border border-border bg-card overflow-hidden hover:border-gold/20 transition-all cursor-pointer"
                  onClick={() => setSelectedDraftId(draft.id)}
                >
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <p className="text-base font-semibold text-foreground">
                          Scope Draft #{draft.id}
                        </p>
                        <StatusBadge status={draft.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Project #{draft.projectId} — Intake #{draft.intakeFormId}
                        {draft.confidenceScore && (
                          <> — Confidence: {(parseFloat(draft.confidenceScore) * 100).toFixed(0)}%</>
                        )}
                      </p>
                    </div>
                    <Eye className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
