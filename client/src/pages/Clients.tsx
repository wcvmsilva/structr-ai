import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  Users,
  Plus,
  Search,
  User,
  Mail,
  Phone,
  MapPin,
  Building2,
  X,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

type ClientFormData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  billingAddressLine1: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  shippingAddressLine1: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  notes: string;
  source: string;
};

const emptyForm: ClientFormData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  companyName: "",
  billingAddressLine1: "",
  billingCity: "Charleston",
  billingState: "SC",
  billingZip: "",
  shippingAddressLine1: "",
  shippingCity: "Charleston",
  shippingState: "SC",
  shippingZip: "",
  notes: "",
  source: "direct",
};

export default function ClientsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ClientFormData>(emptyForm);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: clientsData, isLoading } = trpc.clients.list.useQuery({});
  const createMutation = trpc.clients.create.useMutation({
    onSuccess: () => {
      utils.clients.list.invalidate();
      toast.success("Client created successfully");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateMutation = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.list.invalidate();
      toast.success("Client updated successfully");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = trpc.clients.delete.useMutation({
    onSuccess: () => {
      utils.clients.list.invalidate();
      toast.success("Client deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  const clients = clientsData?.items ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(
      (c: any) =>
        c.firstName?.toLowerCase().includes(q) ||
        c.lastName?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.companyName?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  function resetForm() {
    setFormData(emptyForm);
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(client: any) {
    setFormData({
      firstName: client.firstName ?? "",
      lastName: client.lastName ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      companyName: client.companyName ?? "",
      billingAddressLine1: client.billingAddressLine1 ?? "",
      billingCity: client.billingCity ?? "Charleston",
      billingState: client.billingState ?? "SC",
      billingZip: client.billingZip ?? "",
      shippingAddressLine1: client.shippingAddressLine1 ?? "",
      shippingCity: client.shippingCity ?? "Charleston",
      shippingState: client.shippingState ?? "SC",
      shippingZip: client.shippingZip ?? "",
      notes: client.notes ?? "",
      source: client.source ?? "direct",
    });
    setEditingId(client.id);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  const updateField = (field: keyof ClientFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-gold" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Clients
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-9">
            Manage client contacts and billing information
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
              <Plus className="h-4 w-4" /> New Client
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
              {editingId ? "Edit Client" : "New Client"}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField icon={User} label="First Name" value={formData.firstName} onChange={(v) => updateField("firstName", v)} placeholder="First name" required />
            <FormField icon={User} label="Last Name" value={formData.lastName} onChange={(v) => updateField("lastName", v)} placeholder="Last name" required />
            <FormField icon={Mail} label="Email" value={formData.email} onChange={(v) => updateField("email", v)} placeholder="email@example.com" type="email" />
            <FormField icon={Phone} label="Phone" value={formData.phone} onChange={(v) => updateField("phone", v)} placeholder="(843) 555-0000" type="tel" />
            <FormField icon={Building2} label="Company" value={formData.companyName} onChange={(v) => updateField("companyName", v)} placeholder="Company name" />
          </div>

          {/* Billing Address */}
          <SectionLabel text="Billing Address" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField icon={MapPin} label="Street" value={formData.billingAddressLine1} onChange={(v) => updateField("billingAddressLine1", v)} placeholder="123 Main St" />
            <FormField icon={MapPin} label="City" value={formData.billingCity} onChange={(v) => updateField("billingCity", v)} placeholder="Charleston" />
            <FormField icon={MapPin} label="State" value={formData.billingState} onChange={(v) => updateField("billingState", v)} placeholder="SC" />
            <FormField icon={MapPin} label="ZIP" value={formData.billingZip} onChange={(v) => updateField("billingZip", v)} placeholder="29401" />
          </div>

          {/* Shipping Address */}
          <SectionLabel text="Shipping / Property Address" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField icon={MapPin} label="Street" value={formData.shippingAddressLine1} onChange={(v) => updateField("shippingAddressLine1", v)} placeholder="456 Oak Ave" />
            <FormField icon={MapPin} label="City" value={formData.shippingCity} onChange={(v) => updateField("shippingCity", v)} placeholder="Charleston" />
            <FormField icon={MapPin} label="State" value={formData.shippingState} onChange={(v) => updateField("shippingState", v)} placeholder="SC" />
            <FormField icon={MapPin} label="ZIP" value={formData.shippingZip} onChange={(v) => updateField("shippingZip", v)} placeholder="29401" />
          </div>

          {/* Notes */}
          <SectionLabel text="Notes" />
          <textarea
            value={formData.notes}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder="Additional notes about this client..."
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
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {editingId ? "Update Client" : "Create Client"}
          </button>
        </form>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients by name, email, phone, or company..."
          className={cn(
            "w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5",
            "text-sm text-foreground placeholder:text-muted-foreground/60",
            "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          )}
        />
      </div>

      {/* Client List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gold" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {search ? "No clients match your search" : "No clients yet. Create your first client above."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((client: any) => {
            const isExpanded = expandedId === client.id;
            return (
              <div
                key={client.id}
                className="rounded-xl border border-border bg-card overflow-hidden transition-all"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : client.id)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-gold-glow flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-gold">
                      {client.firstName?.charAt(0)?.toUpperCase() ?? "?"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {client.firstName} {client.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[client.email, client.phone, client.companyName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[0.65rem] px-2 py-0.5 rounded-full bg-gold-glow text-gold font-medium">
                      {client.source ?? "direct"}
                    </span>
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
                      <DetailRow label="Email" value={client.email} />
                      <DetailRow label="Phone" value={client.phone} />
                      <DetailRow label="Company" value={client.companyName} />
                      <DetailRow label="Source" value={client.source} />
                      <DetailRow
                        label="Billing"
                        value={[client.billingAddressLine1, client.billingCity, client.billingState, client.billingZip].filter(Boolean).join(", ")}
                      />
                      <DetailRow
                        label="Shipping"
                        value={[client.shippingAddressLine1, client.shippingCity, client.shippingState, client.shippingZip].filter(Boolean).join(", ")}
                      />
                      {client.notes && (
                        <div className="md:col-span-2">
                          <DetailRow label="Notes" value={client.notes} />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                      <button
                        onClick={() => startEdit(client)}
                        className="flex items-center gap-1.5 text-xs text-gold hover:text-gold-light transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Delete this client?")) {
                            deleteMutation.mutate({ id: client.id });
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
