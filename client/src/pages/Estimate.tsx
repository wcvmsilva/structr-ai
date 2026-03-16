// Estimate Page — Shows real Estimate Drafts from MySQL via tRPC
// Bridge from structr.ai → Estimate Workspace

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { fmtCurrency } from "@shared/catalog-utils";
import {
  Calculator,
  Search,
  ArrowRight,
  Loader2,
  FileText,
  Package,
  Shield,
  Clock,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function EstimatePage() {
  const { isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: drafts, isLoading, error } = trpc.estimate.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const draftItems = drafts && 'items' in drafts ? drafts.items : (Array.isArray(drafts) ? drafts : []);
  const filtered = draftItems.filter(
    (d: any) =>
      d.bundleName?.toLowerCase().includes(search.toLowerCase()) ||
      (d.notes ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <Calculator className="h-6 w-6 text-gold" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Estimate Workspace
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-9">
          Estimate Drafts generated from structr.ai — ready for proposal generation
        </p>
        <div className="h-[2px] w-48 mt-3 ml-9 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search estimate drafts..."
          className={cn(
            "w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5",
            "text-sm text-foreground placeholder:text-muted-foreground/60",
            "transition-all duration-200",
            "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          )}
        />
      </div>

      {/* Quick link to structr.ai */}
      <div>
        <button
          onClick={() => setLocation("/bundles")}
          className={cn(
            "flex items-center gap-3 rounded-xl border border-gold/20 bg-gold-glow p-4 w-full text-left",
            "transition-all duration-200",
            "hover:border-gold/40 hover:shadow-[0_0_20px_var(--color-gold-glow)]"
          )}
        >
          <Package className="h-5 w-5 text-gold" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Open structr.ai</p>
            <p className="text-xs text-muted-foreground">Create a multi-assembly estimate with preset bundles</p>
          </div>
          <ArrowRight className="h-4 w-4 text-gold" />
        </button>
      </div>

      {/* Estimate Drafts */}
      <SectionLabel text="Estimate Drafts" />

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 className="h-6 w-6 animate-spin text-gold" />
          <p className="text-sm text-muted-foreground">Loading estimate drafts...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <AlertCircle className="h-6 w-6 text-red-400" />
          <p className="text-sm text-red-400">Failed to load: {error.message}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border bg-card/50">
          <FileText className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <p className="text-base font-medium text-muted-foreground">
            {draftItems.length === 0 ? "No estimate drafts yet" : "No matching drafts"}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground/60 max-w-xs">
            {draftItems.length === 0
              ? 'Use the structr.ai to create a bundle, then click "Send to Estimate" to generate a draft.'
              : "Try adjusting your search."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((draft: any) => {
            const isExpanded = expandedId === draft.id;
            const lineItems = (draft.lineItems ?? []) as Array<{
              costItemName: string;
              costGroupName: string;
              quantity: number;
              unitPriceSnapshot: number;
              lineTotalPrice: number;
              grossProfitPct: number;
              unit: string;
            }>;

            return (
              <div key={draft.id} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Header Row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                  className={cn(
                    "flex items-center gap-3 w-full px-5 py-4 text-left",
                    "transition-all duration-200 hover:bg-surface-hover"
                  )}
                >
                  <FileText className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {draft.bundleName}
                      </p>
                      <StatusBadge status={draft.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(draft.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>#{draft.id}</span>
                      <span>{draft.channel}</span>
                    </div>
                  </div>

                  {/* Key Metrics */}
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[0.65rem] text-muted-foreground">Final Price</p>
                      <p className="text-sm font-bold text-gold">
                        {fmtCurrency(parseFloat(draft.finalTotalPrice))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.65rem] text-muted-foreground">GP</p>
                      <p className={cn(
                        "text-sm font-bold",
                        parseFloat(draft.grossProfitPct) >= 35 ? "text-emerald-400" : "text-red-400"
                      )}>
                        {parseFloat(draft.grossProfitPct).toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.65rem] text-muted-foreground">Discount</p>
                      <p className="text-sm font-semibold text-foreground">
                        {parseFloat(draft.discountApplied).toFixed(1)}%
                      </p>
                    </div>
                    <ArrowRight className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90"
                    )} />
                  </div>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-border px-5 py-4 bg-background/50">
                    {/* Summary Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <MetricBox label="Subtotal Cost" value={fmtCurrency(parseFloat(draft.subtotalCost))} />
                      <MetricBox label="Subtotal Price" value={fmtCurrency(parseFloat(draft.subtotalPrice))} />
                      <MetricBox label="Gross Profit" value={fmtCurrency(parseFloat(draft.grossProfit))} accent="emerald" />
                      <MetricBox label="Discount Amount" value={fmtCurrency(parseFloat(draft.discountAmount))} />
                    </div>

                    {/* Profit Shield Badge */}
                    <div className="flex items-center gap-2 mb-4">
                      <Shield className="h-3.5 w-3.5 text-gold" />
                      <span className="text-[0.72rem] font-semibold text-gold tracking-wide">
                        Profit Shield: 35% GP Floor Applied
                      </span>
                    </div>

                    {/* Line Items Table */}
                    {lineItems.length > 0 && (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border bg-surface">
                                <th className="px-3 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Item
                                </th>
                                <th className="px-3 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Group
                                </th>
                                <th className="px-3 py-2 text-center text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Qty
                                </th>
                                <th className="px-3 py-2 text-center text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Unit
                                </th>
                                <th className="px-3 py-2 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Unit Price
                                </th>
                                <th className="px-3 py-2 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Line Total
                                </th>
                                <th className="px-3 py-2 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  GP %
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {lineItems.map((li, idx) => (
                                <tr
                                  key={idx}
                                  className={cn(
                                    "border-b border-border/50 transition-colors hover:bg-surface-hover",
                                    idx % 2 === 0 ? "bg-transparent" : "bg-surface/30"
                                  )}
                                >
                                  <td className="px-3 py-2 text-xs font-medium text-foreground max-w-[180px] truncate">
                                    {li.costItemName}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[120px] truncate">
                                    {li.costGroupName}
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono text-xs font-semibold text-gold">
                                    {li.quantity}
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                                    {li.unit}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                                    {fmtCurrency(li.unitPriceSnapshot)}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-xs font-bold text-foreground">
                                    {fmtCurrency(li.lineTotalPrice)}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                                    {li.grossProfitPct.toFixed(1)}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {draft.notes && (
                      <div className="mt-3 rounded-lg bg-surface border border-border p-3">
                        <p className="text-[0.7rem] font-semibold text-muted-foreground mb-1">Notes</p>
                        <p className="text-xs text-foreground">{draft.notes}</p>
                      </div>
                    )}

                    {/* Future Actions Placeholder */}
                    <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground/60">
                      <Clock className="h-3 w-3" />
                      <span>Full Estimate Workspace integration coming in the next sprint.</span>
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

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Draft" },
    sent_to_estimate: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Sent" },
    converted: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Converted" },
    archived: { bg: "bg-gray-500/15", text: "text-gray-400", label: "Archived" },
  };
  const c = config[status] ?? config.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-bold", c.bg, c.text)}>
      {c.label}
    </span>
  );
}

function MetricBox({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-surface border border-border p-2.5 text-center">
      <p className="text-[0.65rem] text-muted-foreground">{label}</p>
      <p className={cn(
        "text-sm font-bold mt-0.5",
        accent === "emerald" ? "text-emerald-400" : "text-foreground"
      )}>
        {value}
      </p>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
        {text}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
    </div>
  );
}
