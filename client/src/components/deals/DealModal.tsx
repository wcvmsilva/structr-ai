import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { X, Loader2, DollarSign, FolderKanban, Target, Percent } from "lucide-react";

export function DealModal({ dealId, onClose }: { dealId: string | null; onClose: () => void }) {
  const isEditing = !!dealId;
  const utils = trpc.useUtils();

  const { data: deal, isLoading } = trpc.deal.getById.useQuery(dealId as string, { enabled: isEditing });

  const createMutation = trpc.deal.create.useMutation({
    onSuccess: () => {
      utils.deal.list.invalidate();
      toast.success("Deal created successfully");
      onClose();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateMutation = trpc.deal.update.useMutation({
    onSuccess: () => {
      utils.deal.list.invalidate();
      toast.success("Deal updated");
      onClose();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const advanceStageMutation = trpc.deal.advanceStage.useMutation({
    onSuccess: () => {
      utils.deal.list.invalidate();
      toast.success("Deal stage updated");
      setIsStageModalOpen(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const [formData, setFormData] = useState({
    title: "",
    stage: "discovery",
    value: "",
    probability: "",
  });

  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [newStage, setNewStage] = useState("discovery");

  useEffect(() => {
    if (deal) {
      setFormData({
        title: deal.name || "",
        stage: deal.stage || "discovery",
        value: deal.value?.toString() || "",
        probability: "",
      });
      setNewStage(deal.stage || "discovery");
    }
  }, [deal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      value: formData.value ? Number(formData.value) : undefined,
      probability: formData.probability ? Number(formData.probability) : undefined,
      stage: formData.stage as any,
    };

    if (isEditing) {
      updateMutation.mutate({ id: dealId!, data: payload });
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
      <div className="bg-card w-full max-w-2xl rounded-xl shadow-2xl border border-border overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">
              {isEditing ? "Edit Deal" : "New Deal"}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto flex-1">
          <form id="deal-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
            
            <FormField label="Deal Title" icon={FolderKanban} value={formData.title} onChange={(v) => setFormData({...formData, title: v})} required placeholder="e.g. Smith Kitchen Remodel" />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5" />
                  Initial Stage
                  <span className="text-gold">*</span>
                </label>
                <select
                  value={formData.stage}
                  onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                  disabled={isEditing} // if editing, stage uses advanceStage logic in real app, but keep simple here
                  className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30 disabled:opacity-50"
                  required
                >
                  <option value="discovery">Discovery</option>
                  <option value="site_visit">Site Visit</option>
                  <option value="estimating">Estimating</option>
                  <option value="proposal_sent">Proposal Sent</option>
                  <option value="negotiation">Negotiation</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
                {isEditing && (
                  <span className="text-[0.65rem] text-muted-foreground mt-1">
                    To move stages, use the pipeline drag-and-drop or advance manually.
                  </span>
                )}
              </div>

              <FormField label="Estimated Value ($)" icon={DollarSign} type="number" value={formData.value} onChange={(v) => setFormData({...formData, value: v})} placeholder="25000" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <FormField label="Probability (%)" icon={Percent} type="number" value={formData.probability} onChange={(v) => setFormData({...formData, probability: v})} placeholder="50" />
            </div>

          </form>
        </div>

        {/* Actions Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-end shrink-0 gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-xl text-sm font-medium hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            form="deal-form"
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 bg-gold hover:bg-gold-light text-background px-6 py-2 rounded-xl text-sm font-bold shadow-sm transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Deal"}
          </button>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon?: any;
  type?: string;
  required?: boolean;
  placeholder?: string;
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
        className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
      />
    </div>
  );
}
