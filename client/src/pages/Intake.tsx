import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  ClipboardList,
  Plus,
  Building2,
  User,
  MapPin,
  Phone,
  Mail,
  FileText,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  received: { label: "Received", color: "bg-blue-500/20 text-blue-400" },
  parsing: { label: "Parsing", color: "bg-amber-500/20 text-amber-400" },
  parsed: { label: "Parsed", color: "bg-purple-500/20 text-purple-400" },
  reviewed: { label: "Reviewed", color: "bg-emerald-500/20 text-emerald-400" },
  converted: { label: "Converted", color: "bg-green-500/20 text-green-400" },
};

const CHANNELS = [
  { value: "direct", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "insurance", label: "Insurance" },
];

const FINISH_LEVELS = [
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
  { value: "luxury", label: "Luxury" },
];

type IntakeFormData = {
  projectName: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  clientPhone: string;
  address: string;
  city: string;
  county: string;
  state: string;
  zipCode: string;
  channel: string;
  serviceType: string;
  area: string;
  finishLevel: string;
  condition: string;
  notes: string;
};

const emptyForm: IntakeFormData = {
  projectName: "",
  clientFirstName: "",
  clientLastName: "",
  clientEmail: "",
  clientPhone: "",
  address: "",
  city: "Charleston",
  county: "Charleston",
  state: "SC",
  zipCode: "",
  channel: "direct",
  serviceType: "",
  area: "",
  finishLevel: "standard",
  condition: "",
  notes: "",
};

export default function IntakePage() {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<IntakeFormData>(emptyForm);
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: intakeData, isLoading } = trpc.intake.list.useQuery({
    status: statusFilter || undefined,
  });

  const createClientMutation = trpc.clients.create.useMutation();
  const createProjectMutation = trpc.project.create.useMutation();
  const createIntakeMutation = trpc.intake.create.useMutation({
    onSuccess: () => {
      utils.intake.list.invalidate();
      toast.success("Project intake created successfully");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateStatusMutation = trpc.intake.updateStatus.useMutation({
    onSuccess: () => {
      utils.intake.list.invalidate();
      toast.success("Status updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const intakeForms = intakeData?.items ?? [];

  function resetForm() {
    setFormData(emptyForm);
    setShowForm(false);
  }

  const updateField = (field: keyof IntakeFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.projectName.trim()) {
      toast.error("Project name is required");
      return;
    }
    if (!formData.clientFirstName.trim() || !formData.clientLastName.trim()) {
      toast.error("Client first and last name are required");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Create client
      const client = await createClientMutation.mutateAsync({
        firstName: formData.clientFirstName,
        lastName: formData.clientLastName,
        email: formData.clientEmail || undefined,
        phone: formData.clientPhone || undefined,
        address: formData.address || undefined,
        city: formData.city || undefined,
        state: formData.state || undefined,
        zip: formData.zipCode || undefined,
        county: formData.county || undefined,
        channel: formData.channel as any,
      });

      // 2. Create project linked to client
      const project = await createProjectMutation.mutateAsync({
        name: formData.projectName,
        clientId: client.id,
        address: formData.address || undefined,
        city: formData.city || undefined,
        county: formData.county || undefined,
        state: formData.state || undefined,
        zipCode: formData.zipCode || undefined,
        channel: formData.channel as any,
      });

      // 3. Create intake form linked to project + client
      await createIntakeMutation.mutateAsync({
        projectId: project.id,
        clientId: client.id,
        channel: formData.channel as any,
        serviceType: formData.serviceType || undefined,
        area: formData.area || undefined,
        finishLevel: (formData.finishLevel as any) || undefined,
        condition: formData.condition || undefined,
        notes: formData.notes || undefined,
        rawPayload: {
          projectName: formData.projectName,
          clientName: `${formData.clientFirstName} ${formData.clientLastName}`,
          address: formData.address,
          city: formData.city,
          county: formData.county,
          channel: formData.channel,
          serviceType: formData.serviceType,
          area: formData.area,
          finishLevel: formData.finishLevel,
          condition: formData.condition,
        },
      });

      utils.clients.list.invalidate();
      utils.project.list.invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create intake");
    } finally {
      setIsSubmitting(false);
    }
  }

  const nextStatus: Record<string, string> = {
    received: "parsing",
    parsing: "parsed",
    parsed: "reviewed",
    reviewed: "converted",
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-gold" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Project Intake
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-9">
            Capture new project details and client information
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
              <Plus className="h-4 w-4" /> New Intake
            </>
          )}
        </button>
      </div>

      {/* Intake Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-gold uppercase tracking-wider">
              New Project Intake
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
          </div>

          {/* Project Info */}
          <SectionLabel text="Project Information" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              icon={Building2}
              label="Project Name"
              value={formData.projectName}
              onChange={(v) => updateField("projectName", v)}
              placeholder="e.g., Kitchen & Bath Renovation"
              required
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                Channel
              </label>
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
            <FormField icon={FileText} label="Service Type" value={formData.serviceType} onChange={(v) => updateField("serviceType", v)} placeholder="e.g., Kitchen Remodel, Bathroom Renovation" />
            <FormField icon={FileText} label="Area / Scope" value={formData.area} onChange={(v) => updateField("area", v)} placeholder="e.g., 200 sqft kitchen, master bath" />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Finish Level</label>
              <select
                value={formData.finishLevel}
                onChange={(e) => updateField("finishLevel", e.target.value)}
                className={cn(
                  "rounded-xl border border-border bg-background px-4 py-2.5",
                  "text-sm text-foreground",
                  "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
                )}
              >
                {FINISH_LEVELS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <FormField icon={FileText} label="Condition" value={formData.condition} onChange={(v) => updateField("condition", v)} placeholder="e.g., Good, Fair, Needs major work" />
          </div>

          {/* Client Info */}
          <SectionLabel text="Client Information" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField icon={User} label="First Name" value={formData.clientFirstName} onChange={(v) => updateField("clientFirstName", v)} placeholder="First name" required />
            <FormField icon={User} label="Last Name" value={formData.clientLastName} onChange={(v) => updateField("clientLastName", v)} placeholder="Last name" required />
            <FormField icon={Mail} label="Email" value={formData.clientEmail} onChange={(v) => updateField("clientEmail", v)} placeholder="email@example.com" type="email" />
            <FormField icon={Phone} label="Phone" value={formData.clientPhone} onChange={(v) => updateField("clientPhone", v)} placeholder="(843) 555-0000" type="tel" />
          </div>

          {/* Address */}
          <SectionLabel text="Property Details" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField icon={MapPin} label="Property Address" value={formData.address} onChange={(v) => updateField("address", v)} placeholder="Full street address" required />
            <FormField icon={MapPin} label="City" value={formData.city} onChange={(v) => updateField("city", v)} placeholder="Charleston" />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" />
                County
              </label>
              <select
                value={formData.county}
                onChange={(e) => updateField("county", e.target.value)}
                className={cn(
                  "rounded-xl border border-border bg-background px-4 py-2.5",
                  "text-sm text-foreground",
                  "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
                )}
              >
                <option value="Charleston">Charleston County</option>
                <option value="Berkeley">Berkeley County</option>
                <option value="Dorchester">Dorchester County</option>
              </select>
            </div>
            <FormField icon={MapPin} label="State" value={formData.state} onChange={(v) => updateField("state", v)} placeholder="SC" />
            <FormField icon={MapPin} label="ZIP Code" value={formData.zipCode} onChange={(v) => updateField("zipCode", v)} placeholder="29401" />
          </div>

          {/* Notes */}
          <SectionLabel text="Notes" />
          <textarea
            value={formData.notes}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder="Additional project notes, scope description, special requirements..."
            rows={4}
            className={cn(
              "rounded-xl border border-border bg-background px-4 py-3",
              "text-sm text-foreground placeholder:text-muted-foreground/60",
              "transition-all duration-200 resize-none",
              "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
            )}
          />

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "flex items-center justify-center gap-2.5 w-full rounded-xl py-3.5 px-6 mt-2",
              "bg-gradient-to-r from-gold-dark via-gold to-gold-light",
              "text-background font-bold text-base tracking-wide",
              "transition-all duration-300",
              "hover:shadow-[0_6px_25px_var(--color-gold-glow-strong)]",
              "hover:-translate-y-0.5",
              "active:translate-y-0",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isSubmitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
            Create Project Intake
          </button>
        </form>
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground">Filter:</span>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter("")}
            className={cn(
              "text-[0.7rem] px-2.5 py-1 rounded-full font-medium transition-colors",
              !statusFilter ? "bg-gold-glow text-gold" : "bg-secondary text-secondary-foreground hover:bg-surface-hover"
            )}
          >
            All
          </button>
          {Object.entries(STATUS_LABELS).map(([key, { label, color }]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn(
                "text-[0.7rem] px-2.5 py-1 rounded-full font-medium transition-colors",
                statusFilter === key ? color : "bg-secondary text-secondary-foreground hover:bg-surface-hover"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Intake List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gold" />
        </div>
      ) : intakeForms.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {statusFilter ? "No intake forms match this filter" : "No intake forms yet. Create your first intake above."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {intakeForms.map((form: any) => {
            const isExpanded = expandedId === form.id;
            const statusInfo = STATUS_LABELS[form.status] ?? { label: form.status, color: "bg-muted text-muted-foreground" };
            const next = nextStatus[form.status];
            const raw = form.rawPayload ?? {};
            return (
              <div
                key={form.id}
                className="rounded-xl border border-border bg-card overflow-hidden transition-all"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : form.id)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {raw.projectName ?? `Intake #${form.id}`}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[raw.clientName, form.channel, form.serviceType].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-[0.65rem] px-2 py-0.5 rounded-full font-medium", statusInfo.color)}>
                      {statusInfo.label}
                    </span>
                    {form.finishLevel && (
                      <span className="text-[0.65rem] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium capitalize">
                        {form.finishLevel}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 bg-background/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <DetailRow label="Service Type" value={form.serviceType} />
                      <DetailRow label="Area" value={form.area} />
                      <DetailRow label="Finish Level" value={form.finishLevel} />
                      <DetailRow label="Condition" value={form.condition} />
                      <DetailRow label="Channel" value={form.channel} />
                      <DetailRow label="Project ID" value={form.projectId?.toString()} />
                      <DetailRow label="Client ID" value={form.clientId?.toString()} />
                      {form.notes && (
                        <div className="md:col-span-2">
                          <DetailRow label="Notes" value={form.notes} />
                        </div>
                      )}
                      {form.confidenceScore && (
                        <DetailRow label="Confidence" value={`${form.confidenceScore}%`} />
                      )}
                    </div>
                    {next && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: form.id, status: next as any })}
                          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          <ArrowRight className="h-3.5 w-3.5" /> Move to {STATUS_LABELS[next]?.label}
                        </button>
                      </div>
                    )}
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
          "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30",
          "focus:shadow-[0_0_10px_var(--color-gold-glow)]"
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
