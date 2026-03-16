import { cn } from "@/lib/utils";
import { History, Search, Filter, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const mockHistory = [
  { id: 1, project: "Roof Replacement — Daniel Island", client: "Robert Williams", status: "completed", value: 14200, date: "2026-03-05", gp: 38.5 },
  { id: 2, project: "LVP Flooring — James Island", client: "Maria Santos", status: "completed", value: 8900, date: "2026-02-28", gp: 41.2 },
  { id: 3, project: "Bathroom Remodel — West Ashley", client: "David Kim", status: "completed", value: 18500, date: "2026-02-20", gp: 36.8 },
  { id: 4, project: "Deck Build — Isle of Palms", client: "Amanda Foster", status: "cancelled", value: 12300, date: "2026-02-15", gp: 0 },
  { id: 5, project: "Exterior Painting — Summerville", client: "Tom Bradley", status: "completed", value: 6800, date: "2026-02-10", gp: 42.1 },
];

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  completed: { label: "Completed", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  cancelled: { label: "Cancelled", color: "text-red-400", bg: "bg-red-500/10" },
};

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export default function HistoryPage() {
  const [search, setSearch] = useState("");

  const filtered = mockHistory.filter(
    (p) =>
      p.project.toLowerCase().includes(search.toLowerCase()) ||
      p.client.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-gold" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Project History
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-9">
          View completed and archived projects
        </p>
        <div className="h-[2px] w-48 mt-3 ml-9 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history..."
            className={cn(
              "w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5",
              "text-sm text-foreground placeholder:text-muted-foreground/60",
              "transition-all duration-200",
              "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
            )}
          />
        </div>
        <button
          onClick={() => toast("Feature coming soon", { description: "Export will be available in the next sprint." })}
          className={cn(
            "flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5",
            "text-sm font-medium text-foreground",
            "transition-all hover:bg-surface-hover hover:border-gold/30"
          )}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          Export
        </button>
      </div>

      {/* History Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Project</th>
                <th className="px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Client</th>
                <th className="px-4 py-3 text-center text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Value</th>
                <th className="px-4 py-3 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">GP %</th>
                <th className="px-4 py-3 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project, i) => {
                const status = statusConfig[project.status];
                return (
                  <tr
                    key={project.id}
                    className={cn(
                      "border-b border-border/50 transition-colors hover:bg-surface-hover cursor-pointer",
                      i % 2 === 0 ? "bg-transparent" : "bg-surface/30"
                    )}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{project.project}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{project.client}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold", status?.bg, status?.color)}>
                        {status?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-gold">{fmtCurrency(project.value)}</td>
                    <td className={cn("px-4 py-3 text-right font-mono text-sm font-semibold", project.gp >= 35 ? "text-green-400" : project.gp > 0 ? "text-red-400" : "text-muted-foreground")}>
                      {project.gp > 0 ? `${project.gp}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-muted-foreground">{project.date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">{text}</span>
      <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
    </div>
  );
}
