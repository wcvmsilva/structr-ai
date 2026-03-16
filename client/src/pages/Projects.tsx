import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  FolderKanban,
  Plus,
  Search,
  Building2,
  MapPin,
  X,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowRight,
  Globe,
  RefreshCw,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  intake: { label: "Intake", color: "bg-blue-500/20 text-blue-400" },
  estimating: { label: "Estimating", color: "bg-amber-500/20 text-amber-400" },
  review: { label: "Review", color: "bg-purple-500/20 text-purple-400" },
  approved: { label: "Approved", color: "bg-emerald-500/20 text-emerald-400" },
  in_progress: { label: "In Progress", color: "bg-gold-glow text-gold" },
  completed: { label: "Completed", color: "bg-green-500/20 text-green-400" },
  cancelled: { label: "Cancelled", color: "bg-red-500/20 text-red-400" },
};

const PROJECT_TYPES = [
  { value: "remodel", label: "Remodel" },
  { value: "new_construction", label: "New Construction" },
  { value: "repair", label: "Repair" },
  { value: "insurance_restoration", label: "Insurance Restoration" },
  { value: "commercial_buildout", label: "Commercial Buildout" },
  { value: "addition", label: "Addition" },
  { value: "exterior", label: "Exterior" },
];

const CHANNELS = [
  { value: "direct", label: "Direct" },
  { value: "commercial", label: "Commercial" },
  { value: "insurance", label: "Insurance" },
];

const GEOCODE_CONFIDENCE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  high: { label: "Geocoded (High)", color: "bg-emerald-500/20 text-emerald-400", icon: "\u2713" },
  medium: { label: "Geocoded (Medium)", color: "bg-amber-500/20 text-amber-400", icon: "~" },
  low: { label: "Geocoded (Low)", color: "bg-orange-500/20 text-orange-400", icon: "!" },
  failed: { label: "Geocode Failed", color: "bg-red-500/20 text-red-400", icon: "\u2717" },
  pending: { label: "Pending", color: "bg-muted text-muted-foreground", icon: "\u2026" },
};

type ProjectFormData = {
  name: string;
  clientId: number | null;
  address: string;
  city: string;
  county: string;
  state: string;
  zipCode: string;
  region: string;
  zone: string;
  projectType: string;
  channel: string;
  notes: string;
};

const emptyForm: ProjectFormData = {
  name: "",
  clientId: null,
  address: "",
  city: "Charleston",
  county: "Charleston",
  state: "SC",
  zipCode: "",
  region: "charleston",
  zone: "",
  projectType: "remodel",
  channel: "direct",
  notes: "",
};

export default function ProjectsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ProjectFormData>(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: projectsData, isLoading } = trpc.project.list.useQuery({
    status: statusFilter || undefined,
  });
  const { data: clientsData } = trpc.clients.list.useQuery({});
  const createMutation = trpc.project.create.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      toast.success("Project created successfully");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      toast.success("Project updated successfully");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateStatusMutation = trpc.project.updateStatus.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      toast.success("Status updated");
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      toast.success("Project deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  const projects = projectsData?.items ?? [];
  const clients = clientsData?.items ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p: any) =>
        p.name?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q) ||
        p.clientName?.toLowerCase().includes(q)
    );
  }, [projects, search]);

  function resetForm() {
    setFormData(emptyForm);
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(project: any) {
    setFormData({
      name: project.name ?? "",
      clientId: project.clientId ?? null,
      address: project.address ?? "",
      city: project.city ?? "Charleston",
      county: project.county ?? "Charleston",
      state: project.state ?? "SC",
      zipCode: project.zipCode ?? "",
      region: project.region ?? "charleston",
      zone: project.zone ?? "",
      projectType: project.projectType ?? "remodel",
      channel: project.channel ?? "direct",
      notes: project.notes ?? "",
    });
    setEditingId(project.id);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("Project name is required");
      return;
    }
    const payload: any = {
      name: formData.name,
      address: formData.address || undefined,
      city: formData.city || undefined,
      county: formData.county || undefined,
      state: formData.state || undefined,
      zipCode: formData.zipCode || undefined,
      region: formData.region || undefined,
      zone: formData.zone || undefined,
      projectType: formData.projectType as any,
      channel: formData.channel as any,
      notes: formData.notes || undefined,
    };
    if (formData.clientId) payload.clientId = formData.clientId;

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const updateField = (field: keyof ProjectFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const nextStatus: Record<string, string> = {
    intake: "estimating",
    estimating: "review",
    review: "approved",
    approved: "in_progress",
    in_progress: "completed",
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <FolderKanban className="h-6 w-6 text-gold" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Projects
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-9">
            Manage construction projects and track progress
          </p>
          <div className="h-[2px] w-48 mt-3 ml-9 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
        </div>
        <button
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
            showForm
              ? "bg-card border border-border text-foreground hover:bg-surface-hover"
              : "bg-gradient-to-r from-gold-dark via-gold to-gold-light text-background hover:shadow-[0_4px_15px_var(--color-gold-glow-strong)]"
          )}
        >
          {showForm ? (
            <>
              <X className="h-4 w-4" /> Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> New Project
            </>
          )}
        </button>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-gold uppercase tracking-wider">
              {editingId ? "Edit Project" : "New Project"}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField icon={Building2} label="Project Name" value={formData.name} onChange={(v) => updateField("name", v)} placeholder="e.g., Kitchen & Bath Renovation" required />

            {/* Client Select */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5" />
                Client
              </label>
              <select
                value={formData.clientId ?? ""}
                onChange={(e) => updateField("clientId", e.target.value ? Number(e.target.value) : null)}
                className={cn(
                  "rounded-xl border border-border bg-background px-4 py-2.5",
                  "text-sm text-foreground",
                  "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
                )}
              >
                <option value="">No client linked</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}{c.companyName ? ` (${c.companyName})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Project Type */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Project Type</label>
              <select
                value={formData.projectType}
                onChange={(e) => updateField("projectType", e.target.value)}
                className={cn(
                  "rounded-xl border border-border bg-background px-4 py-2.5",
                  "text-sm text-foreground",
                  "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
                )}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Channel */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Channel</label>
              <select
                value={formData.channel}
                onChange={(e) => updateField("channel", e.target.value)}
                className={cn(
                  "rounded-xl border border-border bg-background px-4 py-2.5",
                  "text-sm text-foreground",
                  "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
                )}
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Address */}
          <SectionLabel text="Property Address" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField icon={MapPin} label="Address" value={formData.address} onChange={(v) => updateField("address", v)} placeholder="123 Main St" />
            <FormField icon={MapPin} label="City" value={formData.city} onChange={(v) => updateField("city", v)} placeholder="Charleston" />
            <FormField icon={MapPin} label="County" value={formData.county} onChange={(v) => updateField("county", v)} placeholder="Charleston" />
            <FormField icon={MapPin} label="State" value={formData.state} onChange={(v) => updateField("state", v)} placeholder="SC" />
            <FormField icon={MapPin} label="ZIP Code" value={formData.zipCode} onChange={(v) => updateField("zipCode", v)} placeholder="29401" />
            <FormField icon={MapPin} label="Region" value={formData.region} onChange={(v) => updateField("region", v)} placeholder="charleston" />
          </div>

          {/* Notes */}
          <SectionLabel text="Notes" />
          <textarea
            value={formData.notes}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder="Project scope, special requirements..."
            rows={3}
            className={cn(
              "rounded-xl border border-border bg-background px-4 py-3",
              "text-sm text-foreground placeholder:text-muted-foreground/60",
              "transition-all duration-200 resize-none",
              "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
            )}
          />

          <button
            type="submit"
            disabled={isSaving}
            className={cn(
              "flex items-center justify-center gap-2.5 w-full rounded-xl py-3 px-6",
              "bg-gradient-to-r from-gold-dark via-gold to-gold-light",
              "text-background font-bold text-sm tracking-wide",
              "transition-all duration-300",
              "hover:shadow-[0_6px_25px_var(--color-gold-glow-strong)]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {editingId ? "Update Project" : "Create Project"}
          </button>
        </form>
      )}

      {/* Search + Filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className={cn(
              "w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5",
              "text-sm text-foreground placeholder:text-muted-foreground/60",
              "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
            )}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={cn(
            "rounded-xl border border-border bg-card px-4 py-2.5",
            "text-sm text-foreground",
            "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          )}
        >
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Project List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gold" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FolderKanban className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {search || statusFilter ? "No projects match your filters" : "No projects yet. Create your first project above."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((project: any) => {
            const isExpanded = expandedId === project.id;
            const statusInfo = STATUS_LABELS[project.status] ?? { label: project.status, color: "bg-muted text-muted-foreground" };
            const next = nextStatus[project.status];
            return (
              <div
                key={project.id}
                className="rounded-xl border border-border bg-card overflow-hidden transition-all"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : project.id)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {project.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                      {[project.address, project.city, project.channel].filter(Boolean).join(" · ")}
                      {project.geocodeConfidence && project.geocodeConfidence !== "pending" && (
                        <span className={cn("inline-flex items-center gap-0.5 text-[0.6rem] px-1.5 py-0 rounded-full font-medium", GEOCODE_CONFIDENCE_LABELS[project.geocodeConfidence]?.color ?? "bg-muted text-muted-foreground")}>
                          <Globe className="h-2.5 w-2.5" />
                          {GEOCODE_CONFIDENCE_LABELS[project.geocodeConfidence]?.label ?? project.geocodeConfidence}
                        </span>
                      )}
                      {project.zoneModifierSnapshot && (
                        <span className="inline-flex items-center gap-0.5 text-[0.6rem] px-1.5 py-0 rounded-full bg-gold-glow text-gold font-medium">
                          <Shield className="h-2.5 w-2.5" />
                          {(project.zoneModifierSnapshot as any)?.zoneName ?? "Zone"}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-[0.65rem] px-2 py-0.5 rounded-full font-medium", statusInfo.color)}>
                      {statusInfo.label}
                    </span>
                    {project.projectType && (
                      <span className="text-[0.65rem] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
                        {PROJECT_TYPES.find((t) => t.value === project.projectType)?.label ?? project.projectType}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 bg-background/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <DetailRow label="Address" value={[project.address, project.city, project.state, project.zipCode].filter(Boolean).join(", ")} />
                      <DetailRow label="County" value={project.county} />
                      <DetailRow label="Region" value={project.region} />
                      <DetailRow label="Zone" value={project.zone} />
                      {/* Sprint 15: Geocoding Details */}
                      {project.geocodeConfidence && (
                        <DetailRow label="Geocode" value={`${GEOCODE_CONFIDENCE_LABELS[project.geocodeConfidence]?.label ?? project.geocodeConfidence}${project.geocodedAddress ? ` — ${project.geocodedAddress}` : ""}`} />
                      )}
                      {project.latitude && project.longitude && (
                        <DetailRow label="Coordinates" value={`${project.latitude}, ${project.longitude}`} />
                      )}
                      {project.zoneModifierSnapshot && (
                        <DetailRow label="Detected Zone" value={`${(project.zoneModifierSnapshot as any)?.zoneName ?? "—"} (Coastal: ${(project.zoneModifierSnapshot as any)?.coastalExposureLevel ?? "none"})`} />
                      )}
                      <DetailRow label="Channel" value={project.channel} />
                      <DetailRow label="Type" value={project.projectType} />
                      <DetailRow label="Client" value={project.clientName} />
                      <DetailRow label="Estimated Value" value={project.estimatedValue ? `$${Number(project.estimatedValue).toLocaleString()}` : undefined} />
                      {project.notes && (
                        <div className="md:col-span-2">
                          <DetailRow label="Notes" value={project.notes} />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                      <button
                        onClick={() => startEdit(project)}
                        className="flex items-center gap-1.5 text-xs text-gold hover:text-gold-light transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <GeocodeButton projectId={project.id} />
                      {next && (
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: project.id, status: next as any })}
                          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          <ArrowRight className="h-3.5 w-3.5" /> Move to {STATUS_LABELS[next]?.label}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm("Delete this project?")) {
                            deleteMutation.mutate({ id: project.id });
                          }
                        }}
                        className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function FormField({
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" />
        {label}
        {required && <span className="text-gold">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={cn(
          "rounded-xl border border-border bg-background px-4 py-2.5",
          "text-sm text-foreground placeholder:text-muted-foreground/60",
          "transition-all duration-200",
          "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
        )}
      />
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
        {text}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
    </div>
  );
}

function GeocodeButton({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const geocodeMutation = trpc.project.geocode.useMutation({
    onSuccess: (result) => {
      utils.project.list.invalidate();
      const confidence = result.geocode?.confidence;
      if (confidence === "high" || confidence === "medium") {
        toast.success(`Geocoded successfully (${confidence} confidence)`);
      } else if (confidence === "low") {
        toast.warning("Geocoded with low confidence — verify address");
      } else {
        toast.error("Geocoding failed — check address details");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <button
      onClick={() => geocodeMutation.mutate({ id: projectId })}
      disabled={geocodeMutation.isPending}
      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
    >
      {geocodeMutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {geocodeMutation.isPending ? "Geocoding..." : "Geocode"}
    </button>
  );
}
