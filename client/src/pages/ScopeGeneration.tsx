/**
 * structr.ai — Scope Generation Workspace
 * Sprint 15.5: Operator workspace for deterministic scope generation
 *
 * Panels:
 *   A. Project Selector
 *   B. Project Context Panel (address, channel, type, status)
 *   C. Intake Summary Panel (service_type, area, finish_level, condition, notes)
 *   D. Geographic Context (zone, geocode_confidence, service radius warning)
 *   E. Generate Scope Action + Scope Draft Preview
 *   F. Send to Review Action
 *
 * NON-NEGOTIABLE:
 *   - Does NOT duplicate Scope Builder logic in the frontend
 *   - Does NOT calculate pricing
 *   - Does NOT bypass Scope Review Workspace
 *   - Does NOT allow direct conversion to Bundle
 */

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import {
  Crosshair,
  FileSearch,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Zap,
  MapPin,
  Globe,
  Shield,
  ClipboardList,
  FolderKanban,
  ChevronDown,
  Info,
  Eye,
  RefreshCw,
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

function DraftStatusBadge({ status }: { status: string }) {
  const style = DRAFT_STATUS_STYLES[status] ?? DRAFT_STATUS_STYLES.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold", style.bg, style.text)}>
      {style.label}
    </span>
  );
}

const GEOCODE_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  high: { bg: "bg-emerald-500/10", text: "text-emerald-400", icon: CheckCircle2 },
  medium: { bg: "bg-amber-500/10", text: "text-amber-400", icon: AlertTriangle },
  low: { bg: "bg-orange-500/10", text: "text-orange-400", icon: AlertTriangle },
  failed: { bg: "bg-red-500/10", text: "text-red-400", icon: XCircle },
};

function GeocodeBadge({ confidence }: { confidence: string | null }) {
  const key = confidence ?? "pending";
  const style = GEOCODE_STYLES[key] ?? { bg: "bg-muted", text: "text-muted-foreground", icon: Info };
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold", style.bg, style.text)}>
      <Icon className="h-3 w-3" />
      {confidence ? `Geocode: ${confidence}` : "Not geocoded"}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// CONFIDENCE BAR
// ══════════════════════════════════════════════════════════════════════

function ConfidenceBar({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 80 ? "bg-emerald-500" :
    pct >= 60 ? "bg-amber-500" :
    pct >= 40 ? "bg-orange-500" :
    "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className={cn("flex-1 rounded-full bg-muted/50 overflow-hidden", size === "lg" ? "h-2.5" : "h-1.5")}>
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("font-mono font-bold tabular-nums", size === "lg" ? "text-sm" : "text-[0.65rem]")}>
        {pct}%
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SECTION CARD
// ══════════════════════════════════════════════════════════════════════

function SectionCard({
  title,
  icon: Icon,
  children,
  className,
  headerRight,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {headerRight}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// DETAIL ROW
// ══════════════════════════════════════════════════════════════════════

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <span className={cn("text-sm text-foreground text-right", mono && "font-mono")}>
        {value || <span className="text-muted-foreground/50 italic">—</span>}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════

export default function ScopeGenerationPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedIntakeId, setSelectedIntakeId] = useState<string | null>(null);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);

  // Load project list for selector
  const projectsQuery = trpc.project.list.useQuery({ limit: 100 });

  // Load workspace data when project is selected
  const workspaceQuery = trpc.scopeGeneration.loadWorkspace.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  // Generate scope mutation
  const generateMutation = trpc.scope.generate.useMutation({
    onSuccess: (data) => {
      toast.success(`Scope draft generated — ${data.items.length} assemblies selected`);
      workspaceQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Scope generation failed: ${err.message}`);
    },
  });

  // Send to review mutation
  const sendToReviewMutation = trpc.scopeGeneration.sendToReview.useMutation({
    onSuccess: (data) => {
      if (data.transitioned) {
        toast.success(data.message);
      } else {
        toast.info(data.message);
      }
      workspaceQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Send to review failed: ${err.message}`);
    },
  });

  const workspace = workspaceQuery.data;
  const projects = projectsQuery.data;

  // Auto-select first intake when workspace loads
  const activeIntakeId = useMemo(() => {
    if (selectedIntakeId) return selectedIntakeId;
    if (workspace?.intakeForms && workspace.intakeForms.length > 0) {
      return workspace.intakeForms[0].id;
    }
    return null;
  }, [selectedIntakeId, workspace?.intakeForms]);

  const selectedIntake = useMemo(() => {
    if (!workspace?.intakeForms || !activeIntakeId) return null;
    return workspace.intakeForms.find(i => i.id === activeIntakeId) ?? null;
  }, [workspace?.intakeForms, activeIntakeId]);

  // Find existing draft for selected intake
  const existingDraftForIntake = useMemo(() => {
    if (!workspace?.scopeDrafts || !activeIntakeId) return null;
    return workspace.scopeDrafts.find(d => d.intakeFormId === activeIntakeId) ?? null;
  }, [workspace?.scopeDrafts, activeIntakeId]);

  // Determine if generation is blocked
  const blockers = useMemo(() => {
    const b: string[] = [];
    if (!workspace) return b;
    if (workspace.intakeForms.length === 0) {
      b.push("No intake forms linked to this project.");
    }
    if (selectedIntake && !selectedIntake.serviceType) {
      b.push("Selected intake is missing service_type.");
    }
    return b;
  }, [workspace, selectedIntake]);

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!workspace) return w;
    if (workspace.readiness.warnings) w.push(...workspace.readiness.warnings);
    if (selectedIntake && !selectedIntake.area) {
      w.push("Intake is missing area/dimensions. Default area will be used.");
    }
    if (!workspace.project.geocodeConfidence || workspace.project.geocodeConfidence === "failed") {
      if (!w.some(x => x.includes("Geocod"))) {
        w.push("Geocoding unavailable — zone-specific rules may not match.");
      }
    }
    return w;
  }, [workspace, selectedIntake]);

  const canGenerate = blockers.length === 0 && !!activeIntakeId && !!selectedProjectId;

  // ── Handlers ──

  function handleSelectProject(id: number) {
    setSelectedProjectId(id);
    setSelectedIntakeId(null);
    setIsProjectDropdownOpen(false);
  }

  function handleGenerate() {
    if (!selectedProjectId || !activeIntakeId) return;
    generateMutation.mutate({
      projectId: selectedProjectId,
      intakeFormId: activeIntakeId,
    });
  }

  function handleSendToReview(draftId: number) {
    sendToReviewMutation.mutate({ scopeDraftId: draftId });
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          <span className="bg-gradient-to-r from-gold-dark via-gold to-gold-light bg-clip-text text-transparent">
            Scope Generation
          </span>{" "}
          Workspace
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a project, review intake data, and generate a deterministic scope draft.
        </p>
      </div>

      {/* Gold Divider */}
      <div className="h-[2px] w-full bg-gradient-to-r from-gold/40 via-gold/20 to-transparent" />

      {/* ── Panel A: Project Selector ── */}
      <SectionCard title="Select Project" icon={FolderKanban}>
        <div className="relative">
          <button
            onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
            className="w-full flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground hover:border-gold/30 transition-colors"
          >
            {selectedProjectId && workspace?.project ? (
              <span className="flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-gold" />
                <span className="font-medium">{workspace.project.name}</span>
                <span className="text-muted-foreground">— {workspace.project.clientName ?? "No client"}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Choose a project...</span>
            )}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isProjectDropdownOpen && "rotate-180")} />
          </button>

          {isProjectDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
              {projectsQuery.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-gold" />
                </div>
              ) : !projects?.items?.length ? (
                <div className="py-6 text-center text-sm text-muted-foreground">No projects found</div>
              ) : (
                projects.items.map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProject(p.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent transition-colors",
                      selectedProjectId === p.id && "bg-gold-glow"
                    )}
                  >
                    <FolderKanban className={cn("h-4 w-4 shrink-0", selectedProjectId === p.id ? "text-gold" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-foreground">{p.name}</p>
                      <p className="text-[0.7rem] text-muted-foreground truncate">
                        {p.clientName ?? "No client"} · {p.address ?? "No address"}
                      </p>
                    </div>
                    {p.zone && (
                      <span className="text-[0.6rem] font-mono text-gold/70 shrink-0">{p.zone}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Show workspace content only when project is selected */}
      {selectedProjectId && (
        <>
          {workspaceQuery.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-gold" />
              <span className="ml-3 text-sm text-muted-foreground">Loading workspace...</span>
            </div>
          ) : workspaceQuery.isError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
              <XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-400">{workspaceQuery.error.message}</p>
            </div>
          ) : workspace ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ── Panel B: Project Context ── */}
              <SectionCard title="Project Context" icon={FolderKanban}>
                <div className="space-y-0.5">
                  <DetailRow label="Project" value={workspace.project.name} />
                  <DetailRow label="Client" value={workspace.project.clientName} />
                  <DetailRow label="Address" value={
                    [workspace.project.address, workspace.project.city, workspace.project.state, workspace.project.zipCode]
                      .filter(Boolean).join(", ")
                  } />
                  <DetailRow label="County" value={workspace.project.county} />
                  <DetailRow label="Region" value={workspace.project.region} />
                  <DetailRow label="Type" value={workspace.project.projectType} />
                  <DetailRow label="Channel" value={workspace.project.channel} />
                  <DetailRow label="Status" value={workspace.project.status} />
                </div>
              </SectionCard>

              {/* ── Panel D: Geographic Context ── */}
              <SectionCard title="Geographic Context" icon={Globe}
                headerRight={
                  <GeocodeBadge confidence={workspace.project.geocodeConfidence} />
                }
              >
                <div className="space-y-0.5">
                  <DetailRow label="Zone" value={
                    workspace.project.zone ? (
                      <span className="flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5 text-gold" />
                        {workspace.project.zone}
                      </span>
                    ) : null
                  } />
                  <DetailRow label="Geocoded Address" value={workspace.project.geocodedAddress} />
                  <DetailRow label="Coordinates" value={
                    workspace.project.latitude && workspace.project.longitude
                      ? `${workspace.project.latitude}, ${workspace.project.longitude}`
                      : null
                  } mono />
                  <DetailRow label="Geocode Source" value={workspace.project.geocodeSource} />
                  <DetailRow label="Geocoded At" value={
                    workspace.project.geocodedAt
                      ? new Date(workspace.project.geocodedAt).toLocaleString()
                      : null
                  } />
                </div>

                {/* Service radius warning */}
                {workspace.project.geocodeConfidence === "failed" && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-[0.75rem] text-red-400">
                      Geocoding failed. Zone-specific rules will not be applied.
                    </p>
                  </div>
                )}

                {!workspace.project.zone && workspace.project.geocodeConfidence !== "failed" && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-[0.75rem] text-amber-400">
                      No zone assigned. Zone-specific assembly selection will be skipped.
                    </p>
                  </div>
                )}
              </SectionCard>

              {/* ── Panel C: Intake Summary ── */}
              <SectionCard
                title="Intake Forms"
                icon={ClipboardList}
                className="lg:col-span-2"
                headerRight={
                  <span className="text-[0.7rem] font-mono text-muted-foreground">
                    {workspace.intakeForms.length} intake{workspace.intakeForms.length !== 1 ? "s" : ""}
                  </span>
                }
              >
                {workspace.intakeForms.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <ClipboardList className="h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">No intake forms linked to this project.</p>
                    <p className="text-[0.7rem] text-muted-foreground/70 mt-1">
                      Create an intake form first, then return here to generate scope.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Intake selector tabs */}
                    <div className="flex gap-2 flex-wrap">
                      {workspace.intakeForms.map((intake) => (
                        <button
                          key={intake.id}
                          onClick={() => setSelectedIntakeId(intake.id)}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all",
                            activeIntakeId === intake.id
                              ? "border-gold/40 bg-gold-glow text-gold font-semibold"
                              : "border-border bg-background text-foreground hover:border-gold/20"
                          )}
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          <span>#{intake.id}</span>
                          {intake.serviceType && (
                            <span className="text-[0.65rem] text-muted-foreground">
                              {intake.serviceType}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Selected intake details */}
                    {selectedIntake && (
                      <div className="rounded-lg border border-border bg-background p-4 space-y-0.5">
                        <DetailRow label="Service Type" value={
                          selectedIntake.serviceType ? (
                            <span className="font-semibold text-gold">{selectedIntake.serviceType}</span>
                          ) : (
                            <span className="text-red-400 font-semibold flex items-center gap-1">
                              <XCircle className="h-3 w-3" /> Missing
                            </span>
                          )
                        } />
                        <DetailRow label="Area" value={selectedIntake.area} />
                        <DetailRow label="Finish Level" value={selectedIntake.finishLevel} />
                        <DetailRow label="Condition" value={selectedIntake.condition} />
                        <DetailRow label="Channel" value={selectedIntake.channel} />
                        <DetailRow label="Status" value={selectedIntake.status} />
                        {selectedIntake.confidenceScore && (
                          <div className="pt-1">
                            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                              Confidence
                            </span>
                            <div className="mt-1">
                              <ConfidenceBar value={parseFloat(selectedIntake.confidenceScore)} />
                            </div>
                          </div>
                        )}
                        {selectedIntake.notes && (
                          <div className="pt-2 border-t border-border mt-2">
                            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                              Notes
                            </span>
                            <p className="mt-1 text-sm text-foreground/80 whitespace-pre-wrap">
                              {selectedIntake.notes}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>

              {/* ── Blockers & Warnings ── */}
              {(blockers.length > 0 || warnings.length > 0) && (
                <div className="lg:col-span-2 space-y-2">
                  {blockers.map((b, i) => (
                    <div key={`b-${i}`} className="flex items-start gap-2 rounded-lg bg-red-500/5 border border-red-500/20 px-4 py-3">
                      <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-400">{b}</p>
                    </div>
                  ))}
                  {warnings.map((w, i) => (
                    <div key={`w-${i}`} className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-4 py-3">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-400">{w}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Panel E: Generate Scope Action ── */}
              <div className="lg:col-span-2">
                <SectionCard title="Scope Generation" icon={Zap}>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex-1">
                      <p className="text-sm text-foreground">
                        {existingDraftForIntake
                          ? `Existing draft #${existingDraftForIntake.id} found (${existingDraftForIntake.status}). You can view it below or generate a new draft.`
                          : "Run the deterministic scope engine to generate a draft from the selected intake."
                        }
                      </p>
                      {!canGenerate && blockers.length > 0 && (
                        <p className="text-[0.75rem] text-red-400 mt-1">
                          Generation blocked — resolve issues above.
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleGenerate}
                      disabled={!canGenerate || generateMutation.isPending}
                      className={cn(
                        "flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-all shrink-0",
                        canGenerate
                          ? "bg-gradient-to-r from-gold-dark via-gold to-gold-light text-background hover:shadow-[0_4px_20px_var(--color-gold-glow-strong)] active:scale-[0.98]"
                          : "bg-muted text-muted-foreground cursor-not-allowed"
                      )}
                    >
                      {generateMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      {generateMutation.isPending ? "Generating..." : "Generate Scope"}
                    </button>
                  </div>
                </SectionCard>
              </div>

              {/* ── Panel E (continued): Scope Draft Preview ── */}
              {workspace.latestDraft && (
                <div className="lg:col-span-2">
                  <SectionCard
                    title={`Scope Draft #${workspace.latestDraft.draft.id}`}
                    icon={FileSearch}
                    headerRight={
                      <div className="flex items-center gap-2">
                        <DraftStatusBadge status={workspace.latestDraft.draft.status} />
                        {workspace.latestDraft.draft.confidenceScore && (
                          <span className="text-[0.65rem] font-mono text-muted-foreground">
                            conf: {Math.round(parseFloat(workspace.latestDraft.draft.confidenceScore) * 100)}%
                          </span>
                        )}
                      </div>
                    }
                  >
                    {/* Draft confidence */}
                    {workspace.latestDraft.draft.confidenceScore && (
                      <div className="mb-4">
                        <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Overall Confidence
                        </span>
                        <div className="mt-1">
                          <ConfidenceBar value={parseFloat(workspace.latestDraft.draft.confidenceScore)} size="lg" />
                        </div>
                      </div>
                    )}

                    {/* Draft warnings */}
                    {workspace.latestDraft.draft.warningsJson && (workspace.latestDraft.draft.warningsJson as string[]).length > 0 && (
                      <div className="mb-4 space-y-1.5">
                        <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Warnings ({(workspace.latestDraft.draft.warningsJson as string[]).length})
                        </span>
                        {(workspace.latestDraft.draft.warningsJson as string[]).map((w, i) => (
                          <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                            <p className="text-[0.75rem] text-amber-400">{w}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Draft items table */}
                    {workspace.latestDraft.items.length === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        No assemblies in this draft.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-2 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
                              <th className="text-left py-2 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Assembly ID</th>
                              <th className="text-left py-2 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Qty</th>
                              <th className="text-left py-2 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Unit</th>
                              <th className="text-left py-2 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</th>
                              <th className="text-left py-2 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {workspace.latestDraft.items.map((item, idx) => (
                              <tr key={item.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                                <td className="py-2 px-2 text-muted-foreground font-mono text-[0.7rem]">{idx + 1}</td>
                                <td className="py-2 px-2 font-mono text-gold">{item.assemblyId}</td>
                                <td className="py-2 px-2 font-mono font-bold">{item.quantity}</td>
                                <td className="py-2 px-2 text-muted-foreground">{item.unit}</td>
                                <td className="py-2 px-2">
                                  <ConfidenceBar value={parseFloat(item.confidence)} />
                                </td>
                                <td className="py-2 px-2 text-foreground/80 max-w-xs truncate">{item.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-3 text-right text-[0.7rem] text-muted-foreground">
                          {workspace.latestDraft.items.length} assembl{workspace.latestDraft.items.length !== 1 ? "ies" : "y"} selected
                        </div>
                      </div>
                    )}

                    {/* ── Panel F: Send to Review ── */}
                    {workspace.latestDraft.draft.status === "draft" && (
                      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Ready for Review?</p>
                          <p className="text-[0.75rem] text-muted-foreground">
                            Send this draft to the Scope Review Workspace for operator review.
                          </p>
                        </div>
                        <button
                          onClick={() => handleSendToReview(workspace.latestDraft!.draft.id)}
                          disabled={sendToReviewMutation.isPending}
                          className="flex items-center gap-2 rounded-xl border border-gold/30 bg-gold-glow px-5 py-2.5 text-sm font-bold text-gold hover:border-gold/50 hover:shadow-[0_4px_20px_var(--color-gold-glow)] transition-all active:scale-[0.98]"
                        >
                          {sendToReviewMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="h-4 w-4" />
                          )}
                          Send to Review
                        </button>
                      </div>
                    )}

                    {/* Idempotent status messages for non-draft states */}
                    {workspace.latestDraft.draft.status === "under_review" && (
                      <div className="mt-4 pt-4 border-t border-border flex items-center gap-2 text-purple-400">
                        <Eye className="h-4 w-4" />
                        <p className="text-sm">Draft is currently under review in the Scope Review Workspace.</p>
                      </div>
                    )}
                    {workspace.latestDraft.draft.status === "approved" && (
                      <div className="mt-4 pt-4 border-t border-border flex items-center gap-2 text-green-400">
                        <CheckCircle2 className="h-4 w-4" />
                        <p className="text-sm">Draft approved. Ready for conversion to bundle.</p>
                      </div>
                    )}
                    {workspace.latestDraft.draft.status === "converted" && (
                      <div className="mt-4 pt-4 border-t border-border flex items-center gap-2 text-gold">
                        <CheckCircle2 className="h-4 w-4" />
                        <p className="text-sm">Draft converted to bundle. Workflow complete.</p>
                      </div>
                    )}
                    {workspace.latestDraft.draft.status === "rejected" && (
                      <div className="mt-4 pt-4 border-t border-border flex items-center gap-2 text-red-400">
                        <XCircle className="h-4 w-4" />
                        <p className="text-sm">Draft was rejected. Generate a new scope if needed.</p>
                      </div>
                    )}
                  </SectionCard>
                </div>
              )}

              {/* No draft yet message */}
              {!workspace.latestDraft && !generateMutation.isPending && (
                <div className="lg:col-span-2 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
                  <Crosshair className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No scope drafts yet. Select an intake and click <strong>Generate Scope</strong> to create one.
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}

      {/* Empty state when no project selected */}
      {!selectedProjectId && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <FolderKanban className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground">Select a Project</p>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a project above to load its intake data and generate scope.
          </p>
        </div>
      )}
    </div>
  );
}
