import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { lookupCityByZip } from "@/lib/zip-lookup";
import { toast } from "sonner";
import {
  X,
  Mail,
  Phone,
  MapPin,
  Building2,
  DollarSign,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";

export function LeadModal({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const isEditing = !!leadId;
  const utils = trpc.useUtils();

  // Queries
  const { data: lead, isLoading } = trpc.leads.get.useQuery(
    { id: leadId as string },
    { enabled: isEditing }
  );

  // Mutations
  const createMutation = trpc.leads.create.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      toast.success("Lead created successfully");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.leads.update.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      toast.success("Lead updated");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const convertMutation = trpc.leads.convertToProject.useMutation({
    onSuccess: (data: any) => {
      utils.leads.list.invalidate();
      utils.project.list.invalidate();
      utils.clients.list.invalidate();
      toast.success("Successfully converted to Project, Client & Deal");
      onClose();
    },
    onError: (err) => {
      console.error("[Convert Lead Error]", err);
      toast.error(`Conversion failed: ${err.message}`);
    },
  });

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "Charleston",
    state: "SC",
    zip: "",
    serviceTypeInterest: "remodel",
    channel: "direct",
    source: "website",
    estimatedBudget: "",
    notes: "",
  });

  useEffect(() => {
    if (lead) {
      // The DB stores a single "name" field — split it for the form
      const nameParts = (lead.name || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      setFormData({
        firstName,
        lastName,
        email: lead.email || "",
        phone: lead.phone || "",
        address: lead.address || "",
        city: lead.city || "Charleston",
        state: lead.state || "SC",
        zip: lead.zip || "",
        serviceTypeInterest: lead.serviceType || "remodel",
        channel: "direct",
        source: lead.source || "website",
        estimatedBudget: "",
        notes: lead.notes || "",
      });
    }
  }, [lead]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      estimatedBudget: formData.estimatedBudget ? Number(formData.estimatedBudget) : undefined,
    };

    if (isEditing) {
      updateMutation.mutate({ id: leadId!, data: payload });
    } else {
      createMutation.mutate(payload as any);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isEditing && isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card w-full max-w-3xl rounded-xl shadow-2xl border border-border overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">
              {isEditing ? "Edit Lead" : "New Lead"}
            </h2>
            {isEditing && lead && (
              <span className={cn(
                "px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase tracking-wider",
                lead.urgency === "high" ? "bg-red-500/20 text-red-500" :
                lead.urgency === "medium" ? "bg-amber-500/20 text-amber-500" :
                "bg-blue-500/20 text-blue-500"
              )}>
                {lead.urgency === "high" ? "Hot" : lead.urgency === "medium" ? "Warm" : "Cold"}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto flex-1">
          <form id="lead-form" onSubmit={handleSubmit} autoComplete="off" className="flex flex-col gap-6">

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Contact Info */}
              <FormField label="First Name" value={formData.firstName} onChange={(v) => setFormData({...formData, firstName: v})} required />
              <FormField label="Last Name" value={formData.lastName} onChange={(v) => setFormData({...formData, lastName: v})} required />
              <FormField label="Email" type="email" icon={Mail} value={formData.email} onChange={(v) => setFormData({...formData, email: v})} />
              <FormField label="Phone" type="tel" icon={Phone} value={formData.phone} onChange={(v) => setFormData({...formData, phone: v})} />
            </div>

            {/* Address */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase text-gold tracking-widest border-b border-border pb-1">Location</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Address" icon={MapPin} value={formData.address} onChange={(v) => setFormData({...formData, address: v})} />
                <FormField label="City" value={formData.city} onChange={(v) => setFormData({...formData, city: v})} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="State" value={formData.state} onChange={(v) => setFormData({...formData, state: v})} />
                  <FormField label="ZIP" value={formData.zip} inputMode="numeric" maxLength={5} onChange={(v) => {
                    const digits = v.replace(/\D/g, "").slice(0, 5);
                    const update: any = { zip: digits };
                    if (digits.length === 5) {
                      const city = lookupCityByZip(digits);
                      if (city) update.city = city;
                    }
                    setFormData(prev => ({...prev, ...update}));
                  }} placeholder="29401" />
                </div>
              </div>
            </div>

            {/* Project Details */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase text-gold tracking-widest border-b border-border pb-1">Interest & Source</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Type/Interest</label>
                  <select
                    value={formData.serviceTypeInterest}
                    onChange={(e) => setFormData({ ...formData, serviceTypeInterest: e.target.value })}
                    className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30 text-foreground"
                    style={{ backgroundColor: '#ffffff', color: '#1a1a2e', WebkitTextFillColor: '#1a1a2e' }}
                  >
                    <option value="remodel">Remodel</option>
                    <option value="new_construction">New Construction</option>
                    <option value="repair">Repair</option>
                    <option value="addition">Addition</option>
                    <option value="exterior">Exterior</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Source</label>
                  <select
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30 text-foreground"
                    style={{ backgroundColor: '#ffffff', color: '#1a1a2e', WebkitTextFillColor: '#1a1a2e' }}
                  >
                    <option value="website">Website</option>
                    <option value="walk_in">Walk-in</option>
                    <option value="phone">Phone</option>
                    <option value="referral">Referral</option>
                    <option value="social">Social Media</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Channel</label>
                  <select
                    value={formData.channel}
                    onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                    className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30 text-foreground"
                    style={{ backgroundColor: '#ffffff', color: '#1a1a2e', WebkitTextFillColor: '#1a1a2e' }}
                  >
                    <option value="direct">Direct</option>
                    <option value="insurance">Insurance</option>
                    <option value="commercial">Commercial</option>
                  </select>
                </div>
              </div>

              <FormField label="Estimated Budget" icon={DollarSign} type="number" value={formData.estimatedBudget} onChange={(v) => setFormData({...formData, estimatedBudget: v})} placeholder="50000" />
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="rounded-xl border border-border bg-background px-4 py-3 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30 resize-none text-foreground"
                style={{ backgroundColor: '#ffffff', color: '#1a1a2e', WebkitTextFillColor: '#1a1a2e' }}
                placeholder="Background context, timeline requirements..."
              />
            </div>

          </form>
        </div>

        {/* Actions Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between shrink-0">
          <div>
            {isEditing && lead?.status !== "converted" && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Are you sure you want to convert this lead? It will create a Project.")) {
                    convertMutation.mutate({ id: lead!.id });
                  }
                }}
                disabled={convertMutation.isPending}
                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-colors disabled:opacity-50"
              >
                {convertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Convert to Project
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-xl text-sm font-medium hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              form="lead-form"
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 bg-gold hover:bg-gold-light text-background px-6 py-2 rounded-xl text-sm font-bold shadow-sm transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  icon: Icon,
  type = "text",
  required = false,
  placeholder,
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon?: any;
  type?: string;
  required?: boolean;
  placeholder?: string;
  inputMode?: "numeric" | "text" | "tel" | "email";
  maxLength?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
        {required && <span className="text-gold">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="new-password"
        data-form-type="other"
        data-lpignore="true"
        name={`structr-${label.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`}
        className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30 text-foreground"
        style={{ backgroundColor: '#ffffff', color: '#1a1a2e', WebkitTextFillColor: '#1a1a2e' }}
      />
    </div>
  );
}
