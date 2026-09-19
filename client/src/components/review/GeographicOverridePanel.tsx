import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowRight, Info, Loader2, MapPin, Plus, Shield } from "lucide-react";

// ══════════════════════════════════════════════════════════════════════
// GEOGRAPHIC OVERRIDE PANEL (Sprint 16)
// ══════════════════════════════════════════════════════════════════════

const OVERRIDE_TYPE_STYLES: Record<string, { bg: string; text: string; icon: typeof ArrowRight; label: string }> = {
  swap: { bg: "bg-blue-500/10", text: "text-blue-400", icon: ArrowRight, label: "Swap" },
  add: { bg: "bg-green-500/10", text: "text-green-400", icon: Plus, label: "Addition" },
  warning_only: { bg: "bg-amber-500/10", text: "text-amber-400", icon: Info, label: "Warning" },
};

export function GeographicOverridePanel({
  scopeDraftId,
  projectId,
}: {
  scopeDraftId: string;
  projectId: string;
}) {
  // Fetch project to get zone
  const projectQuery = trpc.project.getById.useQuery({ id: projectId });
  const projectZone = projectQuery.data?.zone ?? "";
  const previewEnabled = !!projectZone && projectZone !== "unknown";

  // Fetch override log for this draft
  const logQuery = trpc.geoOverride.getLog.useQuery(
    { scopeDraftId },
  );

  // Fetch override preview if zone exists
  const previewQuery = trpc.geoOverride.previewForDraft.useQuery(
    { scopeDraftId, projectZone },
    { enabled: previewEnabled }
  );

  const requiredQueries = previewEnabled
    ? [projectQuery, logQuery, previewQuery]
    : [projectQuery, logQuery];
  const overrideLog = logQuery.data;
  const previewData = previewQuery.data;
  const hasAppliedOverrides = overrideLog && overrideLog.length > 0;

  // A cached result cannot turn a query failure into an apparently empty success.
  if (requiredQueries.some(query => query.isError || query.error)) {
    return (
      <div role="alert" className="rounded-xl border border-red-500/20 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-red-400">
            Geographic Overrides
          </p>
        </div>
        <p className="text-xs text-muted-foreground mt-2 ml-6">
          Unable to load geographic override information. Please try again.
        </p>
      </div>
    );
  }

  // Active refetches temporarily show loading rather than asserting stale empty data.
  // Disabled previews do not participate in required-query state.
  if (requiredQueries.some(query => !query.isSuccess || query.isPending || query.isLoading || query.isFetching)) {
    return (
      <div role="status" className="rounded-xl border border-border/50 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-gold" />
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">
            Geographic Overrides
          </p>
          <Loader2 className="h-3 w-3 animate-spin text-gold ml-auto" />
        </div>
        <p className="text-xs text-muted-foreground mt-2 ml-6">
          Loading geographic override information...
        </p>
      </div>
    );
  }

  // Missing current zone does not erase successfully loaded applied history.
  if (!previewEnabled) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Geographic Overrides
          </p>
        </div>
        <p className="text-xs text-muted-foreground mt-2 ml-6">
          No zone detected for this project. Override preview is unavailable.
        </p>
        {hasAppliedOverrides && (
          <div className="text-[0.65rem] text-muted-foreground mt-2 ml-6">
            <Shield className="h-3 w-3 inline mr-1" />
            {overrideLog!.length} override(s) persisted in audit log
          </div>
        )}
      </div>
    );
  }

  // Determine if overrides exist
  const overrides = previewData?.overrides ?? [];
  const warnings = previewData?.warnings ?? [];
  const stats = previewData?.stats;

  // No overrides for this zone
  if (overrideLog?.length === 0 && previewData?.hasOverrides === false) {
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
