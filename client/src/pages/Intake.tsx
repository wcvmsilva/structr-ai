import { PROJECT_TYPES } from "@shared/domain/taxonomy";
import { createIntakeSchema, serializeIntakeFormationPreimage } from "@shared/intake-formation-engine";
import { scopeWorkspaceReadCommandSchema } from "@shared/scope-workspace-read";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { currentQueryData } from "@/components/estimate/EstimateReadiness";
import { lookupCityByZip } from "@/lib/zip-lookup";
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
import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useAuth } from "@/_core/hooks/useAuth";
import { getAuthSessionSnapshot, subscribeAuthSession, subscribeAuthIdentityChange } from "@/lib/auth-token";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-blue-500/20 text-blue-400" },
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
  projectType: string;
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
  projectType: "",
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

export function buildIntakePayload(form: IntakeFormData, requestId: string) {
  return {
    requestId,
    newProject: {
      name: form.projectName.trim(),
      projectType: form.projectType as typeof PROJECT_TYPES[number],
      client: { firstName: form.clientFirstName.trim(), lastName: form.clientLastName.trim(), email: form.clientEmail || undefined, phone: form.clientPhone || undefined },
      address: form.address.trim(), city: form.city || undefined, county: form.county || undefined,
      state: form.state || undefined, zip: form.zipCode || undefined,
    },
    channel: form.channel as "direct" | "insurance" | "commercial",
    serviceType: form.serviceType || undefined, area: form.area || undefined,
    finishLevel: form.finishLevel as "standard" | "premium" | "luxury",
    condition: form.condition || undefined, notes: form.notes || undefined,
    rawPayload: { projectName: form.projectName.trim(), clientName: `${form.clientFirstName} ${form.clientLastName}`.trim(), address: form.address, city: form.city, county: form.county, channel: form.channel, serviceType: form.serviceType, area: form.area, finishLevel: form.finishLevel, condition: form.condition },
  };
}

export default function IntakePage() {
  const [showForm, setShowForm] = useState(false);
  const [limitedFlowStarted, setLimitedFlowStarted] = useState(false);
  const [, setLocation] = useLocation();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [formData, setFormData] = useState<IntakeFormData>(emptyForm);
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Presentation only: the server remains the authority for every request.
  // Cached mode data cannot enable unavailable queries while being revalidated.
  const sessionQuery = trpc.auth.session.useQuery();
  const session = currentQueryData(sessionQuery);
  const limitedAccess = session?.estimateReadOnly !== false;
  const utils = trpc.useUtils();
  const { data: intakeData, isLoading, error: intakeError, isError: intakeIsError } = trpc.intake.list.useQuery(
    { status: statusFilter || undefined },
    {
      enabled: !limitedAccess,
      // Let session revalidation settle before enabled reopens this query.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Intake has no offline queue; a failed read must not replay on reconnect.
      networkMode: "always",
      retry: false,
    }
  );

  const createIntakeMutation = trpc.intake.create.useMutation({
    onSuccess: (intake) => {
      utils.intake.list.invalidate();
      toast.success("Project intake created successfully");
      resetForm();
      if (intake.projectId) setLocation(`/scope-generation?projectId=${intake.projectId}&intakeFormId=${intake.id}`);
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
    setRequestId(crypto.randomUUID());
    setShowForm(false);
  }

  const updateField = (field: keyof IntakeFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setRequestId(crypto.randomUUID());
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

    if (!formData.projectType || !formData.serviceType.trim() || !formData.address.trim()) { toast.error("Project type, service type, and property address are required"); return; }
    setIsSubmitting(true);
    try {
      await createIntakeMutation.mutateAsync(buildIntakePayload(formData, requestId));

      utils.clients.list.invalidate();
      utils.project.list.invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create intake");
    } finally {
      setIsSubmitting(false);
    }
  }

  const nextStatus: Record<string, string> = {
    draft: "parsing",
    parsing: "parsed",
    parsed: "reviewed",
    reviewed: "converted",
  };

  // Keep this child mounted across descriptor revalidation/revocation once opened.
  // Its in-memory recovery command belongs to this page lifetime and identity.
  if (limitedFlowStarted) return <LimitedIntakePage sessionQuery={sessionQuery} />;
  if (session?.estimateReadOnly === true && session.intakeFormationEnabled === true && session.authenticated === true) {
    return <div className="flex flex-col gap-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Project Intake</h1>
      <p>Initial project intake is available. Intake lists and status changes remain unavailable.</p>
      <button className="rounded-xl bg-gold px-4 py-3 font-semibold" onClick={() => setLimitedFlowStarted(true)}>New Intake</button>
    </div>;
  }

  if (limitedAccess) {
    const checking =
      !sessionQuery.error &&
      !sessionQuery.isError &&
      (sessionQuery.isPending ||
        sessionQuery.isLoading ||
        sessionQuery.isFetching ||
        sessionQuery.isPaused);
    const confirmedLimited = session?.estimateReadOnly === true;
    return (
      <div className="flex flex-col gap-6 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Project Intake
        </h1>
        <div
          role={confirmedLimited || checking ? "status" : "alert"}
          className="rounded-xl border border-border bg-card p-6"
        >
          <h2 className="text-lg font-semibold text-foreground">
            {confirmedLimited
              ? "Limited access"
              : checking
                ? "Checking intake access…"
                : "Intake access unavailable"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {confirmedLimited
              ? "Project intake creation, listing and status changes are not available in this environment. You can view an estimate using a link provided to you, or manage your account in Settings."
              : checking
                ? "Please wait while access is confirmed."
                : "Access could not be confirmed. Reload the page to try again."}
          </p>
        </div>
      </div>
    );
  }

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
      {showForm && renderIntakeForm(formData, updateField, setFormData, handleSubmit, isSubmitting)}

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
      {intakeError || intakeIsError ? (
        <div role="alert" className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">
            Unable to load intake forms
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Intake forms could not be loaded. Reload the page to try again.
          </p>
        </div>
      ) : isLoading ? (
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

                {form.projectId && <Link href={`/scope-generation?projectId=${form.projectId}&intakeFormId=${form.id}`} className="block px-4 pb-3 text-sm text-gold underline">Continue to scope</Link>}
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
  inputMode,
  maxLength,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
  inputMode?: "numeric" | "text" | "tel" | "email";
  maxLength?: number;
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
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="new-password"
        data-form-type="other"
        data-lpignore="true"
        name={`structr-${label.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`}
        className={cn(
          "rounded-xl border border-border bg-background px-4 py-2.5",
          "text-sm text-foreground placeholder:text-muted-foreground/60",
          "transition-all duration-200",
          "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30",
          "focus:shadow-[0_0_10px_var(--color-gold-glow)]"
        )}
        style={{ backgroundColor: '#ffffff', color: '#1a1a2e', WebkitTextFillColor: '#1a1a2e' }}
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


/** Shared field markup preserves the direct workflow and its existing payload. */
function renderIntakeForm(
  formData: IntakeFormData,
  updateField: (field: keyof IntakeFormData, value: string) => void,
  setFormData: Dispatch<SetStateAction<IntakeFormData>>,
  handleSubmit: (event: React.FormEvent) => Promise<void>,
  isSubmitting: boolean,
  locked = false,
) {
  return (<form onSubmit={handleSubmit} autoComplete="off" className="rounded-xl border border-border bg-card p-5">
          <fieldset disabled={locked} className="flex flex-col gap-4">
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
                style={{ backgroundColor: '#ffffff', color: '#1a1a2e' }}
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5"><label htmlFor="intake-project-type" className="text-xs font-medium">Project type *</label><select id="intake-project-type" required value={formData.projectType} onChange={event => updateField("projectType", event.target.value)} className="rounded-xl border border-border bg-background p-3"><option value="">Choose project type</option>{PROJECT_TYPES.map(type => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>
            <FormField icon={FileText} label="Service Type" required value={formData.serviceType} onChange={(v) => updateField("serviceType", v)} placeholder="e.g., Kitchen Remodel, Bathroom Renovation" />
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
                style={{ backgroundColor: '#ffffff', color: '#1a1a2e' }}
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
                style={{ backgroundColor: '#ffffff', color: '#1a1a2e' }}
              >
                <option value="Charleston">Charleston County</option>
                <option value="Berkeley">Berkeley County</option>
                <option value="Dorchester">Dorchester County</option>
              </select>
            </div>
            <FormField icon={MapPin} label="State" value={formData.state} onChange={(v) => updateField("state", v)} placeholder="SC" />
            <FormField icon={MapPin} label="ZIP Code" inputMode="numeric" maxLength={5} value={formData.zipCode} onChange={(v) => {
              const digits = v.replace(/\D/g, "").slice(0, 5);
              setFormData(prev => {
                const next = { ...prev, zipCode: digits };
                if (digits.length === 5) {
                  const city = lookupCityByZip(digits);
                  if (city) next.city = city;
                }
                return next;
              });
            }} placeholder="29401" />
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
            style={{ backgroundColor: '#ffffff', color: '#1a1a2e', WebkitTextFillColor: '#1a1a2e' }}
          />

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || locked}
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
          </fieldset>
        </form>);
}

type SessionDescriptor = inferRouterOutputs<AppRouter>["auth"]["session"];
type SessionQuery = Parameters<typeof currentQueryData<SessionDescriptor>>[0];
type FormationIdentity = { actorId: string; tenantId: string; subject: string; generation: number };
type FormationReceipt = { id: string; projectId: string | null; status: string };
type FormationAttempt = {
  mounted: boolean;
  phase: "draft" | "submitting" | "uncertain" | "confirmed" | "expired";
  identity: FormationIdentity | null;
  command: ReturnType<typeof buildIntakePayload> | null;
  receipt: FormationReceipt | null;
};

const INTAKE_FIELD_LABELS: Record<string, string> = {
  "newProject.name": "Project name",
  "newProject.projectType": "Project type",
  "newProject.client.firstName": "First name",
  "newProject.client.lastName": "Last name",
  "newProject.client.email": "Email",
  "newProject.client.phone": "Phone",
  "newProject.address": "Property address",
  "newProject.city": "City",
  "newProject.county": "County",
  "newProject.state": "State",
  "newProject.zip": "ZIP code",
  channel: "Channel",
  serviceType: "Service type",
  area: "Area",
  finishLevel: "Finish level",
  condition: "Condition",
  notes: "Notes",
};

function freezeCommand<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freezeCommand(nested);
    Object.freeze(value);
  }
  return value;
}

function LimitedIntakePage({ sessionQuery }: { sessionQuery: SessionQuery }) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const browserSession = useSyncExternalStore(subscribeAuthSession, getAuthSessionSnapshot, getAuthSessionSnapshot);
  const [formData, setFormData] = useState<IntakeFormData>(emptyForm);
  const [showForm, setShowForm] = useState(true);
  const [, redraw] = useState(0);
  const attempt = useRef<FormationAttempt>({ mounted: true, phase: "draft", identity: null, command: null, receipt: null });
  const live = useRef({ auth, sessionQuery });
  live.current = { auth, sessionQuery };
  // No hook-level completion callbacks: all effects below are locally identity guarded.
  const mutation = trpc.intake.create.useMutation({ retry: false, networkMode: "always" });

  function identity(): FormationIdentity | null {
    const current = getAuthSessionSnapshot();
    const profile = utils.auth.me.getData();
    if (!attempt.current.mounted || current.loading || !current.session ||
      !profile?.id || !profile.tenantId || profile.externalOpenId !== current.session.user.id) return null;
    return { actorId: profile.id, tenantId: profile.tenantId, subject: current.session.user.id, generation: current.generation };
  }
  function sameIdentity() {
    const expected = attempt.current.identity;
    const current = identity();
    return attempt.current.phase !== "expired" && !!current && !!expected && current.actorId === expected.actorId &&
      current.tenantId === expected.tenantId && current.subject === expected.subject && current.generation === expected.generation;
  }
  function enabled() {
    const latest = live.current.auth;
    if (!latest.isAuthenticated || latest.loading || latest.error) return false;
    const descriptor = currentQueryData(live.current.sessionQuery);
    const cached = utils.auth.session.getData();
    const state = queryClient.getQueryState(getQueryKey(trpc.auth.session, undefined, "query"));
    return descriptor?.estimateReadOnly === true && descriptor.intakeFormationEnabled === true &&
      descriptor.authenticated === true && cached === descriptor &&
      state?.status === "success" && state.fetchStatus === "idle" && !state.error;
  }
  function canViewReceipt() {
    const latest = live.current.auth;
    if (!latest.isAuthenticated || latest.loading || latest.error || !sameIdentity()) return false;
    const descriptor = currentQueryData(live.current.sessionQuery);
    const state = queryClient.getQueryState(getQueryKey(trpc.auth.session, undefined, "query"));
    return descriptor?.estimateReadOnly === true && descriptor.authenticated === true &&
      descriptor.scopeWorkspaceReadEnabled === true && utils.auth.session.getData() === descriptor &&
      state?.status === "success" && state.fetchStatus === "idle" && !state.error;
  }
  function expire() {
    attempt.current.identity = null;
    attempt.current.command = null;
    attempt.current.receipt = null;
    attempt.current.phase = "expired";
    if (attempt.current.mounted) { setFormData(emptyForm); redraw(value => value + 1); }
  }
  useEffect(() => {
    attempt.current.mounted = true;
    const stop = subscribeAuthIdentityChange(expire);
    return () => {
      stop();
      attempt.current.mounted = false;
      attempt.current.command = null;
      attempt.current.receipt = null;
    };
  }, []);
  useEffect(() => {
    if (attempt.current.identity && !sameIdentity()) expire();
  }, [auth.user?.id, auth.user?.tenantId, browserSession.generation, browserSession.session?.user.id]);

  async function dispatch(command?: ReturnType<typeof buildIntakePayload>) {
    const own = attempt.current;
    if (!own.mounted || own.phase === "submitting" || own.phase === "confirmed" || own.phase === "expired") return;
    if (own.identity && !sameIdentity()) { expire(); return; }
    if (!enabled()) return;
    const current = identity();
    if (!current) return;
    if (!own.command) {
      if (!command) return;
      own.identity = current;
      // Copy all nested fields before freezing; later drafts cannot alter replay bytes.
      own.command = freezeCommand(structuredClone(command));
    }
    // Recheck immediately before entering the mutation/transport queue.
    if (!sameIdentity() || !enabled()) return;
    own.phase = "submitting";
    redraw(value => value + 1);
    try {
      const result = await mutation.mutateAsync(own.command);
      if (!sameIdentity()) return;
      own.receipt = { id: result.id, projectId: result.projectId ?? null, status: result.status };
      own.phase = "confirmed";
    } catch {
      if (!sameIdentity()) return;
      // No response metadata proves a safe rejection. Keep the exact command.
      own.phase = "uncertain";
    } finally {
      if (sameIdentity()) redraw(value => value + 1);
    }
  }
  function editable() { return attempt.current.mounted && attempt.current.phase === "draft" && enabled() && sameIdentity(); }
  const updateForm: Dispatch<SetStateAction<IntakeFormData>> = value => { if (editable()) setFormData(value); };
  const updateField = (field: keyof IntakeFormData, value: string) => updateForm(previous => ({ ...previous, [field]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editable()) return;
    if (!formData.projectName.trim()) { toast.error("Project name is required"); return; }
    if (!formData.clientFirstName.trim() || !formData.clientLastName.trim()) { toast.error("Client first and last name are required"); return; }
    if (!formData.projectType || !formData.serviceType.trim() || !formData.address.trim()) { toast.error("Project type, service type, and property address are required"); return; }
    // The placeholder satisfies the full shared schema without allocating a real
    // request ID. It is replaced only after local validation and is never sent.
    const draft = buildIntakePayload(formData, "00000000-0000-0000-0000-000000000000");
    const validated = createIntakeSchema.safeParse(draft);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      const label = INTAKE_FIELD_LABELS[issue.path.join(".")] ?? "Intake";
      const message = issue.code === "too_big" && issue.origin === "string"
        ? `Use ${issue.maximum} characters or fewer.` : issue.message;
      toast.error(`${label}: ${message}`);
      return;
    }
    const current = identity();
    if (!current) return;
    try {
      // Validate the same UTF-8/JSON limits as the transport before freezing a
      // request. The validated preimage is not sent or retained by the browser.
      serializeIntakeFormationPreimage(draft, { actorId: current.actorId, tenantId: current.tenantId });
    } catch {
      toast.error("Intake is too long or contains unsupported characters. Shorten the notes or correct the text and try again.");
      return;
    }
    await dispatch({ ...draft, requestId: crypto.randomUUID() });
  }
  const own = attempt.current;
  // Drafts also belong to their originating account; an old submit closure must
  // not first capture an identity that appeared after the user entered the data.
  if (own.phase === "draft" && !own.identity) own.identity = identity();
  const available = (enabled() || (own.phase === "confirmed" && canViewReceipt())) && !!identity();
  const changed = own.phase === "expired" || (!!own.identity && !sameIdentity());
  const receiptPair = own.phase === "confirmed" && own.receipt
    ? scopeWorkspaceReadCommandSchema.safeParse({ projectId: own.receipt.projectId, intakeFormId: own.receipt.id }) : null;
  if (changed || !available) return <div className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-bold">Project Intake</h1>
    <p role="status">{changed ? "Session changed. This request is no longer available in this page. Any request already sent may still have been saved." : "Intake access is being confirmed or is unavailable. Submission actions are disabled."}</p>
  </div>;
  return <div className="flex flex-col gap-6 max-w-3xl">
    <h1 className="text-2xl font-bold">Project Intake</h1>
    <p>Initial project intake only. Intake lists and status changes are unavailable.</p>
    {showForm ? <button onClick={() => {
      if (own.phase === "draft") setFormData(emptyForm);
      setShowForm(false);
    }}>{own.phase === "draft" ? "Cancel" : "Close form"}</button> : own.phase === "draft" ? <button onClick={() => setShowForm(true)}>New Intake</button> : null}
    {showForm && renderIntakeForm(formData, updateField, updateForm, submit, own.phase === "submitting", own.phase !== "draft")}
    {own.phase !== "draft" && <section aria-label="Intake submission" className="rounded-xl border border-border bg-card p-5 space-y-3">
      {own.phase === "submitting" && <p role="status">Sending intake request… Leaving this page does not cancel it.</p>}
      {own.phase === "uncertain" && <>
        <p role="alert">The result is unconfirmed. This request may already have been saved. Resending uses the same request; leaving this page does not cancel it.</p>
        <p>Resending submits the saved request again and may create the intake if the first attempt did not complete.</p>
        <button onClick={() => dispatch()}>Resend same request</button>
      </>}
      {own.receipt && <div role="status" className="space-y-2">
        <h2 className="text-lg font-semibold">Intake receipt confirmed</h2>
        <p>Intake ID: {own.receipt.id}</p><p>Project ID: {own.receipt.projectId ?? "Unavailable"}</p><p>Current intake status: {own.receipt.status}</p>
        <p>Geocoding: pending. Financial calculation: pending. Scope generation: pending.</p>
        <p>This receipt confirms the current intake record. It does not confirm those later steps or approve an estimate.</p>
        {receiptPair?.success && canViewReceipt() && <Link
          href={`/scope-generation?projectId=${receiptPair.data.projectId}&intakeFormId=${receiptPair.data.intakeFormId}`}
          className="inline-block text-gold underline"
          onClick={event => { if (!canViewReceipt()) event.preventDefault(); }}
        >View project and intake</Link>}
      </div>}
      <p className="text-sm text-muted-foreground">Request ID: {own.command?.requestId}</p>
      <p className="text-sm text-muted-foreground">Recovery is available only in this page and sign-in session. Reloading or leaving the page loses the saved request.</p>
    </section>}
  </div>;
}
