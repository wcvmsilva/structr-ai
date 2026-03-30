/**
 * structr.ai Construction Brain — Remodel Workflow Visualization
 * Sprint 17: Read-only timeline consuming Remodel Engine output
 *
 * Panels:
 *   A. Project + Scope Draft Selector
 *   B. Warnings Panel (Scope Builder, Geographic Resolver, Remodel Engine)
 *   C. Override Summary (swap/add/warning counts, zone badge)
 *   D. Workflow Timeline (vertical stage stack with assemblies and override indicators)
 *   E. Workflow Metadata (template, stage count, assembly count)
 *
 * NON-NEGOTIABLE:
 *   - Read-only — no mutations
 *   - Does NOT reconstruct workflow logic
 *   - Does NOT alter Remodel Engine behavior
 *   - Does NOT introduce new business logic
 */

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import {
  GitBranch,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ArrowRight,
  Shield,
  Package,
  MapPin,
  Info,
  Layers,
  Clock,
  Repeat,
  Plus,
  Eye,
  FolderKanban,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

// ══════════════════════════════════════════════════════════════════════
// STATUS BADGES
// ══════════════════════════════════════════════════════════════════════

const DRAFT_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Draft" },
  under_review: { bg: "bg-purple-500/10", text: "text-purple-400", label: "Under Review" },
  approved: { bg: "bg-green-500/10", text: "text-green-400", label: "Approved" },
  rejected: { bg: "bg-red-500/10", text: "text-red-400", label: "Rejected" },
  converted: { bg: "bg-gold/10", text: "text-gold", label: "Converted" },
};

function StatusBadge({ status }: { status: string }) {
  const style = DRAFT_STATUS_STYLES[status] ?? DRAFT_STATUS_STYLES.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold", style.bg, style.text)}>
      {style.label}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// OVERRIDE TYPE BADGE
// ══════════════════════════════════════════════════════════════════════

const OVERRIDE_STYLES: Record<string, { bg: string; text: string; icon: typeof Repeat; label: string }> = {
  swap: { bg: "bg-amber-500/10", text: "text-amber-400", icon: Repeat, label: "Swapped" },
  add: { bg: "bg-cyan-500/10", text: "text-cyan-400", icon: Plus, label: "Added" },
  warning_only: { bg: "bg-orange-500/10", text: "text-orange-400", icon: AlertTriangle, label: "Warning" },
};

function OverrideBadge({ type }: { type: string }) {
  const style = OVERRIDE_STYLES[type] ?? OVERRIDE_STYLES.swap;
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold", style.bg, style.text)}>
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ZONE BADGE
// ══════════════════════════════════════════════════════════════════════

function ZoneBadge({ zone }: { zone: string | null }) {
  if (!zone) return null;
  const isCoastal = zone.includes("coastal") || zone.includes("barrier");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
        isCoastal ? "bg-cyan-500/10 text-cyan-400" : "bg-emerald-500/10 text-emerald-400"
      )}
    >
      <MapPin className="h-3 w-3" />
      {zone.replace(/_/g, " ")}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// WARNINGS PANEL
// ══════════════════════════════════════════════════════════════════════

function WarningsPanel({ warnings }: { warnings: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (warnings.length === 0) return null;

  const displayWarnings = expanded ? warnings : warnings.slice(0, 3);

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-400">
            {warnings.length} Warning{warnings.length !== 1 ? "s" : ""}
          </span>
        </div>
        {warnings.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[0.7rem] text-amber-400/70 hover:text-amber-400 transition-colors"
          >
            {expanded ? "Show less" : `Show all ${warnings.length}`}
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {displayWarnings.map((w, i) => (
          <li key={i} className="text-[0.78rem] text-amber-300/80 leading-relaxed pl-6 relative">
            <span className="absolute left-2 top-1.5 h-1 w-1 rounded-full bg-amber-400/50" />
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// OVERRIDE SUMMARY
// ══════════════════════════════════════════════════════════════════════

function OverrideSummary({
  summary,
  zone,
}: {
  summary: {
    hasOverrides: boolean;
    totalOverrides: number;
    swapCount: number;
    addCount: number;
    warningCount: number;
  };
  zone: string | null;
}) {
  if (!summary.hasOverrides) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">No geographic overrides applied</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/20 bg-gold-glow p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-gold" />
          <span className="text-sm font-semibold text-gold">Geographic Overrides Active</span>
        </div>
        <ZoneBadge zone={zone} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {summary.swapCount > 0 && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 p-2.5 text-center">
            <div className="text-lg font-bold text-amber-400">{summary.swapCount}</div>
            <div className="text-[0.65rem] text-amber-400/70 uppercase tracking-wider">Swaps</div>
          </div>
        )}
        {summary.addCount > 0 && (
          <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/10 p-2.5 text-center">
            <div className="text-lg font-bold text-cyan-400">{summary.addCount}</div>
            <div className="text-[0.65rem] text-cyan-400/70 uppercase tracking-wider">Additions</div>
          </div>
        )}
        {summary.warningCount > 0 && (
          <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 p-2.5 text-center">
            <div className="text-lg font-bold text-orange-400">{summary.warningCount}</div>
            <div className="text-[0.65rem] text-orange-400/70 uppercase tracking-wider">Warnings</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLY ROW (within a stage)
// ══════════════════════════════════════════════════════════════════════

function AssemblyRow({
  assembly,
}: {
  assembly: {
    assemblyId: number;
    assemblyCode: string;
    assemblyName: string;
    category: string;
    trade: string | null;
    quantity: number;
    unit: string;
    source: string;
    ruleCode?: string;
    override: {
      originalAssemblyId: number;
      replacementAssemblyId: number;
      overrideType: string;
      overrideReason: string;
      zone: string;
    } | null;
  };
}) {
  const hasOverride = assembly.override !== null;
  const isSwap = assembly.override?.overrideType === "swap";
  const isAdd = assembly.override?.overrideType === "add";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-all",
        hasOverride
          ? isSwap
            ? "border-amber-500/20 bg-amber-500/5"
            : isAdd
            ? "border-cyan-500/20 bg-cyan-500/5"
            : "border-orange-500/20 bg-orange-500/5"
          : "border-border/50 bg-card/50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[0.78rem] font-semibold text-foreground">
              {assembly.assemblyName}
            </span>
            <span className="text-[0.65rem] text-muted-foreground font-mono">
              {assembly.assemblyCode}
            </span>
            {hasOverride && <OverrideBadge type={assembly.override!.overrideType} />}
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            {assembly.trade && (
              <span className="text-[0.65rem] text-muted-foreground">
                <Wrench className="inline h-3 w-3 mr-0.5" />
                {assembly.trade}
              </span>
            )}
            {assembly.category && (
              <span className="text-[0.65rem] text-muted-foreground">
                <Layers className="inline h-3 w-3 mr-0.5" />
                {assembly.category}
              </span>
            )}
            <span className="text-[0.65rem] text-muted-foreground">
              <Package className="inline h-3 w-3 mr-0.5" />
              {assembly.quantity} {assembly.unit}
            </span>
          </div>

          {/* Override detail */}
          {hasOverride && assembly.override!.overrideReason && (
            <div className="mt-2 pl-3 border-l-2 border-amber-500/30">
              <p className="text-[0.7rem] text-amber-300/80 leading-relaxed">
                {assembly.override!.overrideReason}
              </p>
              {isSwap && (
                <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                  Original: Assembly #{assembly.override!.originalAssemblyId} → Replacement: Assembly #{assembly.override!.replacementAssemblyId}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Source badge */}
        <span className="text-[0.6rem] text-muted-foreground/60 uppercase tracking-wider whitespace-nowrap">
          {assembly.source}
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// STAGE CARD (within the timeline)
// ══════════════════════════════════════════════════════════════════════

function StageCard({
  stage,
  isLast,
}: {
  stage: {
    order: number;
    code: string;
    label: string;
    assemblies: Array<{
      assemblyId: number;
      assemblyCode: string;
      assemblyName: string;
      category: string;
      trade: string | null;
      quantity: number;
      unit: string;
      source: string;
      ruleCode?: string;
      override: {
        originalAssemblyId: number;
        replacementAssemblyId: number;
        overrideType: string;
        overrideReason: string;
        zone: string;
      } | null;
    }>;
    estimatedDuration?: string;
  };
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const overrideCount = stage.assemblies.filter((a: any) => a.override !== null).length;

  return (
    <div className="relative">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-5 top-14 bottom-0 w-px bg-gradient-to-b from-gold/30 to-border/20" />
      )}

      <div className="relative pl-12">
        {/* Timeline dot */}
        <div className="absolute left-3 top-4 h-4 w-4 rounded-full border-2 border-gold bg-background flex items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-gold" />
        </div>

        {/* Stage header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-gold/20 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-gold/10 text-gold text-[0.7rem] font-bold">
                {stage.order}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{stage.label}</span>
                  <span className="text-[0.6rem] text-muted-foreground font-mono uppercase">{stage.code}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[0.65rem] text-muted-foreground">
                    {stage.assemblies.length} assembl{stage.assemblies.length !== 1 ? "ies" : "y"}
                  </span>
                  {stage.estimatedDuration && (
                    <span className="text-[0.65rem] text-muted-foreground">
                      <Clock className="inline h-3 w-3 mr-0.5" />
                      {stage.estimatedDuration}
                    </span>
                  )}
                  {overrideCount > 0 && (
                    <span className="text-[0.65rem] text-amber-400">
                      <Shield className="inline h-3 w-3 mr-0.5" />
                      {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
            />
          </div>
        </button>

        {/* Stage assemblies */}
        {expanded && stage.assemblies.length > 0 && (
          <div className="mt-2 space-y-2 pb-6">
            {stage.assemblies.map((assembly, idx) => (
              <AssemblyRow key={`${assembly.assemblyId}-${idx}`} assembly={assembly} />
            ))}
          </div>
        )}

        {expanded && stage.assemblies.length === 0 && (
          <div className="mt-2 pb-6">
            <div className="rounded-lg border border-dashed border-border/50 p-3 text-center">
              <span className="text-[0.75rem] text-muted-foreground">No assemblies assigned to this stage</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// WORKFLOW METADATA
// ══════════════════════════════════════════════════════════════════════

function WorkflowMetadata({
  workflow,
}: {
  workflow: {
    templateId: number | null;
    templateName: string | null;
    stages: any[];
    totalAssemblies: number;
    stageCount: number;
    metadata: any;
  };
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Info className="h-4 w-4 text-gold" />
        <span className="text-sm font-semibold text-foreground">Workflow Metadata</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-surface p-2.5 text-center">
          <div className="text-lg font-bold text-foreground">{workflow.stageCount}</div>
          <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">Stages</div>
        </div>
        <div className="rounded-lg bg-surface p-2.5 text-center">
          <div className="text-lg font-bold text-foreground">{workflow.totalAssemblies}</div>
          <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">Assemblies</div>
        </div>
        <div className="col-span-2 rounded-lg bg-surface p-2.5">
          <div className="text-[0.78rem] font-semibold text-foreground truncate">
            {workflow.templateName ?? "No template matched"}
          </div>
          <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">Template</div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SKELETON LOADER
// ══════════════════════════════════════════════════════════════════════

function WorkflowSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-16 rounded-xl bg-surface" />
      <div className="h-24 rounded-xl bg-surface" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="pl-12 relative">
          <div className="absolute left-3 top-4 h-4 w-4 rounded-full bg-surface" />
          <div className="h-20 rounded-xl bg-surface" />
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// WORKFLOW DETAIL (main visualization)
// ══════════════════════════════════════════════════════════════════════

function WorkflowDetail({ scopeDraftId }: { scopeDraftId: number }) {
  const { data, isLoading, error } = trpc.workflowViz.loadVisualization.useQuery(
    { scopeDraftId },
    { retry: 1 }
  );

  if (isLoading) return <WorkflowSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <p className="text-sm text-destructive font-semibold">Failed to load workflow</p>
        <p className="text-[0.75rem] text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Project context bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-gold" />
          <span className="text-sm font-semibold text-foreground">{data.project.name}</span>
        </div>
        <ZoneBadge zone={data.project.zone} />
        <StatusBadge status={data.scopeDraft.status} />
        <span className="text-[0.7rem] text-muted-foreground">
          Scope Draft #{data.scopeDraft.id} · {data.scopeDraft.itemCount} items
        </span>
      </div>

      {/* Warnings */}
      <WarningsPanel warnings={data.warnings} />

      {/* Override summary */}
      <OverrideSummary summary={data.overrideSummary} zone={data.project.zone} />

      {/* Workflow metadata */}
      <WorkflowMetadata workflow={data.workflow} />

      {/* Timeline */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="h-4 w-4 text-gold" />
          <span className="text-sm font-semibold text-foreground">Construction Workflow Timeline</span>
        </div>

        {data.workflow.stages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No workflow stages generated</p>
            <p className="text-[0.7rem] text-muted-foreground mt-1">
              This may indicate no remodel template matched the scope draft parameters.
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {data.workflow.stages.map((stage, idx) => (
              <StageCard
                key={`${stage.code}-${stage.order}`}
                stage={stage}
                isLast={idx === data.workflow.stages.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════

export default function WorkflowPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // Load projects
  const { data: projects, isLoading: projectsLoading } = trpc.project.list.useQuery({});

  // Load drafts for selected project
  const { data: drafts, isLoading: draftsLoading } = trpc.workflowViz.listDraftsForProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  // Auto-select first draft when project changes
  useMemo(() => {
    if (drafts && drafts.length > 0 && !selectedDraftId) {
      setSelectedDraftId(drafts[0].id);
    }
  }, [drafts]);

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          <span className="text-gold-gradient">Workflow</span> Visualization
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only timeline of the remodel construction workflow with geographic override indicators
        </p>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Project selector */}
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="text-[0.7rem] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
            Project
          </label>
          {projectsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading projects...
            </div>
          ) : (
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setSelectedProjectId(id);
                setSelectedDraftId(null);
              }}
              className="w-full rounded-lg border border-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gold/50"
            >
              <option value="">Select a project...</option>
              {projects?.items?.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.zone ? `(${p.zone})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Scope Draft selector */}
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="text-[0.7rem] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
            Scope Draft
          </label>
          {!selectedProjectId ? (
            <p className="text-sm text-muted-foreground">Select a project first</p>
          ) : draftsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading drafts...
            </div>
          ) : drafts && drafts.length > 0 ? (
            <select
              value={selectedDraftId ?? ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setSelectedDraftId(id);
              }}
              className="w-full rounded-lg border border-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gold/50"
            >
              <option value="">Select a scope draft...</option>
              {drafts.map((d: any) => (
                <option key={d.id} value={d.id}>
                  Draft #{d.id} — {d.status} (Confidence: {d.confidenceScore ?? "N/A"})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted-foreground">No scope drafts found for this project</p>
          )}
        </div>
      </div>

      {/* Workflow Visualization */}
      {selectedDraftId ? (
        <WorkflowDetail scopeDraftId={selectedDraftId} />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <GitBranch className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Select a project and scope draft to visualize the construction workflow
          </p>
          <p className="text-[0.7rem] text-muted-foreground/60 mt-1">
            The timeline shows stages in execution order with assembly assignments and geographic override indicators
          </p>
        </div>
      )}
    </div>
  );
}
