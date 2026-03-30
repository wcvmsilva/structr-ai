import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Target,
  Plus,
  Search,
  MoreVertical,
  Activity,
  ArrowRight,
  Loader2,
  Trash2,
  X,
  Pencil,
  Phone,
  Mail,
  User,
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { LeadModal } from "../components/leads/LeadModal";

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: leadsData, isLoading } = trpc.leads.list.useQuery();

  const leads = useMemo(() => {
    if (!leadsData) return [];
    if (!search.trim()) return leadsData;
    const q = search.toLowerCase();
    return leadsData.filter(
      (l: any) =>
        (l.name?.toLowerCase() || "").includes(q) ||
        (l.email?.toLowerCase() || "").includes(q) ||
        (l.serviceType?.toLowerCase() || "").includes(q)
    );
  }, [leadsData, search]);

  const updateStatusMutation = trpc.leads.updateStatus.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      toast.success("Lead status updated.");
    },
    onError: (err) => toast.error(`Error: ${err.message}`),
  });

  const columns = [
    { key: "new", label: "New Leads", color: "border-blue-500/30" },
    { key: "contacted", label: "Contacted", color: "border-amber-500/30" },
    { key: "qualified", label: "Qualified", color: "border-emerald-500/30" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <Target className="h-6 w-6 text-gold" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Lead Management
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-9">
            Sales pipeline and opportunity tracking
          </p>
        </div>
        <button
          onClick={() => {
            setSelectedLeadId(null);
            setIsModalOpen(true);
          }}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
            "bg-gradient-to-r from-gold-dark via-gold to-gold-light text-background hover:shadow-[0_4px_15px_var(--color-gold-glow-strong)]"
          )}
        >
          <Plus className="h-4 w-4" /> New Lead
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex gap-3 mb-6 shrink-0">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, interest..."
            className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2 text-sm focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          />
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden flex items-start gap-4 pb-4">
        {isLoading ? (
          <div className="flex w-full items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-gold" />
          </div>
        ) : (
          columns.map((col) => {
            const columnLeads = leads.filter((l: any) => l.status === col.key);

            return (
              <div
                key={col.key}
                className={cn(
                  "flex flex-col flex-shrink-0 w-80 max-h-full rounded-xl border bg-card/50",
                  col.color
                )}
              >
                {/* Column Header */}
                <div className="p-3 border-b border-border flex items-center justify-between bg-card shrink-0 rounded-t-xl">
                  <h3 className="font-semibold text-sm uppercase tracking-wider">
                    {col.label}
                  </h3>
                  <span className="bg-muted px-2 py-0.5 rounded-full text-xs font-medium text-muted-foreground">
                    {columnLeads.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-3">
                  {columnLeads.map((lead: any) => {
                    const nextStatusMap: Record<string, string> = {
                      new: "contacted",
                      contacted: "qualified",
                      qualified: "converted",
                    };
                    const nextStatus = nextStatusMap[col.key];
                    const nextLabel: Record<string, string> = {
                      contacted: "Contacted",
                      qualified: "Qualified",
                      converted: "Convert",
                    };

                    return (
                      <div
                        key={lead.id}
                        className={cn(
                          "group cursor-pointer rounded-lg border border-border bg-card p-4 transition-all hover:bg-surface-hover hover:border-gold/50 shadow-sm relative"
                        )}
                      >
                        <div
                          onClick={() => {
                            setSelectedLeadId(lead.id);
                            setIsModalOpen(true);
                          }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex flex-col">
                              <span className="font-semibold text-sm">
                                {lead.name || "Unknown"}
                              </span>
                              <span className="text-xs text-muted-foreground line-clamp-1">
                                {lead.serviceType || "No specific interest"}
                              </span>
                            </div>
                            {lead.urgency === "high" && (
                              <span className="bg-red-500/20 text-red-500 text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold shadow-sm">
                                Hot
                              </span>
                            )}
                            {lead.urgency === "medium" && (
                              <span className="bg-amber-500/20 text-amber-500 text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold">
                                Warm
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                            {lead.source && (
                              <span className="bg-secondary/50 px-1.5 py-0.5 rounded">
                                {lead.source}
                              </span>
                            )}
                            <span className="ml-auto flex items-center gap-1 opacity-60">
                              {new Date(lead.createdAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                          {nextStatus && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (nextStatus === "converted") {
                                  setSelectedLeadId(lead.id);
                                  setIsModalOpen(true);
                                } else {
                                  updateStatusMutation.mutate({
                                    id: lead.id,
                                    status: nextStatus as any,
                                  });
                                }
                              }}
                              disabled={updateStatusMutation.isPending}
                              className="flex items-center gap-1 text-xs font-medium text-gold hover:text-gold-light transition-colors"
                            >
                              <ArrowRight className="h-3 w-3" />
                              {nextLabel[nextStatus]}
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Disqualify this lead?")) {
                                updateStatusMutation.mutate({
                                  id: lead.id,
                                  status: "disqualified",
                                  reason: "Manually disqualified",
                                });
                              }
                            }}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors ml-auto"
                          >
                            <XCircle className="h-3 w-3" />
                            Disqualify
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {columnLeads.length === 0 && (
                    <div className="text-center py-6 text-muted-foreground/50 text-xs italic">
                      No leads here.
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Closed Leads Column */}
        <div className="flex flex-col flex-shrink-0 w-80 max-h-full rounded-xl border border-muted bg-card/30 opacity-70">
          <div className="p-3 border-b border-border flex items-center justify-between bg-card/50 shrink-0 rounded-t-xl">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Closed
            </h3>
          </div>
          <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-3">
            {leads.filter((l: any) => l.status === "converted" || l.status === "disqualified").map((lead: any) => (
              <div
                key={lead.id}
                onClick={() => {
                  setSelectedLeadId(lead.id);
                  setIsModalOpen(true);
                }}
                className={cn(
                  "cursor-pointer rounded-lg border border-border bg-card/50 p-4 transition-all hover:bg-surface-hover shadow-[none]"
                )}
              >
                <div className="flex justify-between items-start mb-2 opacity-70">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm line-through decoration-muted-foreground/50">
                      {lead.name || "Unknown"}
                    </span>
                  </div>
                  <span className={cn(
                    "text-[0.6rem] px-1.5 py-0.5 rounded font-medium",
                    lead.status === "converted" ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                  )}>
                    {lead.status === "converted" ? "Won" : "Lost"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {isModalOpen && (
        <LeadModal
          leadId={selectedLeadId}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}
