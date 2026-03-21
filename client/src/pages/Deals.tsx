import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
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
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { DealModal } from "../components/deals/DealModal";

export default function DealsPage() {
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: dealsData, isLoading } = trpc.deal.list.useQuery();
  const { data: forecastData } = trpc.deal.forecast.useQuery(undefined);
  const { data: staleDeals } = trpc.deal.staleDeals.useQuery();

  const deals = useMemo(() => {
    if (!dealsData) return [];
    if (!search.trim()) return dealsData;
    const q = search.toLowerCase();
    return dealsData.filter(
      (d: any) =>
        (d.title?.toLowerCase() || "").includes(q) ||
        (d.client?.firstName?.toLowerCase() || "").includes(q) ||
        (d.client?.lastName?.toLowerCase() || "").includes(q)
    );
  }, [dealsData, search]);

  const advanceStageMutation = trpc.deal.advanceStage.useMutation({
    onSuccess: () => {
      utils.deal.list.invalidate();
      toast.success("Deal advanced to next stage.");
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const columns = [
    { key: "discovery", label: "Discovery", color: "border-blue-500/30" },
    { key: "site_visit", label: "Site Visit", color: "border-indigo-500/30" },
    { key: "estimating", label: "Estimating", color: "border-violet-500/30" },
    { key: "proposal_sent", label: "Proposal Sent", color: "border-fuchsia-500/30" },
    { key: "negotiation", label: "Negotiation", color: "border-amber-500/30" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <TrendingUp className="h-6 w-6 text-gold" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Deal Pipeline
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-9">
            Manage your sales deals and forecast revenue
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          {forecastData && typeof forecastData === "object" && 'expected' in forecastData && (
            <div className="flex flex-col items-end mr-2 bg-muted/40 px-3 py-1.5 rounded-lg border border-border/50">
              <span className="text-[0.65rem] text-muted-foreground uppercase tracking-widest font-bold">Expected Revenue</span>
              <span className="text-sm font-bold text-emerald-500">${(forecastData.expected || 0).toLocaleString()}</span>
            </div>
          )}
          {staleDeals && staleDeals.length > 0 && (
            <div className="flex items-center gap-2 bg-red-500/10 text-red-500 px-3 py-1.5 rounded-lg text-sm font-medium">
              <AlertCircle className="w-4 h-4" />
              {staleDeals.length} Stale Deals
            </div>
          )}
          
          <button
            onClick={() => {
              setSelectedDealId(null);
              setIsModalOpen(true);
            }}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
              "bg-gradient-to-r from-gold-dark via-gold to-gold-light text-background hover:shadow-[0_4px_15px_var(--color-gold-glow-strong)]"
            )}
          >
            <Plus className="h-4 w-4" /> New Deal
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex gap-3 mb-6 shrink-0">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals, clients..."
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
            const columnDeals = deals.filter((d: any) => d.stage === col.key);
            const totalValue = columnDeals.reduce((sum: number, d: any) => sum + (parseFloat(d.value) || 0), 0);
            
            return (
              <div
                key={col.key}
                className={cn(
                  "flex flex-col flex-shrink-0 w-80 max-h-full rounded-xl border bg-card/50",
                  col.color
                )}
              >
                {/* Column Header */}
                <div className="p-3 border-b border-border flex flex-col items-center justify-between bg-card shrink-0 rounded-t-xl">
                  <div className="flex items-center justify-between w-full mb-1">
                    <h3 className="font-semibold text-sm uppercase tracking-wider">
                      {col.label}
                    </h3>
                    <span className="bg-muted px-2 py-0.5 rounded-full text-xs font-medium text-muted-foreground">
                      {columnDeals.length}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground w-full text-right font-medium">
                    ${totalValue.toLocaleString()}
                  </div>
                </div>

                {/* Cards Container */}
                <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-3">
                  {columnDeals.map((deal: any) => (
                    <div
                      key={deal.id}
                      onClick={() => {
                        setSelectedDealId(deal.id);
                        setIsModalOpen(true);
                      }}
                      className={cn(
                        "group cursor-pointer rounded-lg border border-border bg-card p-4 transition-all hover:bg-surface-hover hover:border-gold/50 shadow-sm relative"
                      )}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm line-clamp-1">
                            {deal.title}
                          </span>
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {deal.client?.firstName} {deal.client?.lastName}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-4">
                        <span className="text-sm font-medium text-gold">
                          ${parseFloat(deal.value || "0").toLocaleString()}
                        </span>
                        
                        <div className="flex items-center gap-2">
                          {deal.probability && (
                            <span className="text-[0.65rem] bg-secondary/80 text-secondary-foreground font-mono px-1.5 py-0.5 rounded shadow-inner">
                              {deal.probability}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {columnDeals.length === 0 && (
                    <div className="text-center py-6 text-muted-foreground/50 text-xs italic">
                      No deals in {col.label}.
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Closed Deals Column */}
        <div className="flex flex-col flex-shrink-0 w-80 max-h-full rounded-xl border border-muted bg-card/30 opacity-70">
          <div className="p-3 border-b border-border flex items-center justify-between bg-card/50 shrink-0 rounded-t-xl">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Closed
            </h3>
          </div>
          <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-3">
            {deals.filter((d: any) => d.stage === "won" || d.stage === "lost").map((deal: any) => (
              <div
                key={deal.id}
                onClick={() => {
                  setSelectedDealId(deal.id);
                  setIsModalOpen(true);
                }}
                className={cn(
                  "cursor-pointer rounded-lg border border-border bg-card/50 p-4 transition-all hover:bg-surface-hover shadow-[none]"
                )}
              >
                <div className="flex justify-between items-start mb-2 opacity-70">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm line-through decoration-muted-foreground/50">
                      {deal.title}
                    </span>
                  </div>
                  <span className={cn(
                    "text-[0.6rem] px-1.5 py-0.5 rounded font-medium",
                    deal.stage === "won" ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                  )}>
                    {deal.stage === "won" ? "Won" : "Lost"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {isModalOpen && (
        <DealModal
          dealId={selectedDealId}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}
