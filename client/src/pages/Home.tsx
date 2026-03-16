import MetricCard from "@/components/MetricCard";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  Package,
  ClipboardList,
  Calculator,
  CheckSquare,
  TrendingUp,
  DollarSign,
  Clock,
  AlertTriangle,
  ArrowRight,
  Shield,
} from "lucide-react";
import { useLocation } from "wouter";

// Static dashboard data for projects (will be replaced with real queries later)
const projectStats = {
  activeProjects: 3,
  pendingEstimates: 2,
  pendingReviews: 1,
  completedThisMonth: 4,
  totalRevenue: 187500,
};

const recentProjects = [
  {
    id: 1,
    name: "Kitchen & Bath Renovation — Sullivan's Island",
    client: "James Morrison",
    status: "estimating" as const,
    value: 44800,
    date: "2026-03-10",
  },
  {
    id: 2,
    name: "Full Exterior Package — Mt. Pleasant",
    client: "Sarah Chen",
    status: "review" as const,
    value: 31400,
    date: "2026-03-08",
  },
  {
    id: 3,
    name: "Roof Replacement — Daniel Island",
    client: "Robert Williams",
    status: "approved" as const,
    value: 14200,
    date: "2026-03-05",
  },
  {
    id: 4,
    name: "General Restoration — Downtown Charleston",
    client: "Emily Parker",
    status: "in_progress" as const,
    value: 22600,
    date: "2026-03-01",
  },
];

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  intake: { label: "Intake", color: "text-blue-400", bg: "bg-blue-500/10" },
  estimating: { label: "Estimating", color: "text-amber-400", bg: "bg-amber-500/10" },
  review: { label: "Review", color: "text-purple-400", bg: "bg-purple-500/10" },
  approved: { label: "Approved", color: "text-green-400", bg: "bg-green-500/10" },
  in_progress: { label: "In Progress", color: "text-gold", bg: "bg-gold-glow" },
  completed: { label: "Completed", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  cancelled: { label: "Cancelled", color: "text-red-400", bg: "bg-red-500/10" },
};

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Home() {
  const [, setLocation] = useLocation();

  // Live catalog stats from MySQL
  const { data: catalogStats } = trpc.catalog.stats.useQuery();
  const { data: catalogGroups } = trpc.catalog.groups.useQuery();

  const totalCatalogItems = catalogStats?.totalItems ?? 0;
  const totalCostGroups = catalogStats?.totalGroups ?? 0;
  const avgGrossProfit = catalogStats?.avgMargin ? Number(catalogStats.avgMargin).toFixed(1) : "0.0";

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          structr.ai — Charleston, SC — structr.ai Overview
        </p>
        <div className="h-[2px] w-48 mt-3 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickAction
          icon={ClipboardList}
          label="New Intake"
          description="Start a new project"
          onClick={() => setLocation("/intake")}
        />
        <QuickAction
          icon={Calculator}
          label="New Estimate"
          description="Create an estimate"
          onClick={() => setLocation("/estimate")}
        />
        <QuickAction
          icon={Package}
          label="structr.ai"
          description="Build a bundle"
          onClick={() => setLocation("/bundles")}
        />
        <QuickAction
          icon={CheckSquare}
          label="Pending Reviews"
          description={`${projectStats.pendingReviews} awaiting`}
          onClick={() => setLocation("/review")}
        />
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Active Projects"
          value={projectStats.activeProjects.toString()}
          subtitle={`${projectStats.pendingEstimates} pending estimates`}
        />
        <MetricCard
          label="Revenue (MTD)"
          value={fmtCurrency(projectStats.totalRevenue)}
          subtitle={`${projectStats.completedThisMonth} completed this month`}
        />
        <MetricCard
          label="Avg. Gross Profit"
          value={`${avgGrossProfit}%`}
          subtitle="Floor: 35% GP"
          variant={Number(avgGrossProfit) >= 38 ? "success" : Number(avgGrossProfit) >= 35 ? "default" : "danger"}
        />
        <MetricCard
          label="Catalog Items"
          value={totalCatalogItems.toString()}
          subtitle={`${totalCostGroups} cost groups · Live from MySQL`}
        />
      </div>

      {/* Recent Projects */}
      <div>
        <SectionLabel text="Recent Projects" />
        <div className="mt-3 rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Project
                  </th>
                  <th className="px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Client
                  </th>
                  <th className="px-4 py-3 text-center text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Value
                  </th>
                  <th className="px-4 py-3 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentProjects.map((project, i) => {
                  const status = statusConfig[project.status];
                  return (
                    <tr
                      key={project.id}
                      className={cn(
                        "border-b border-border/50 transition-colors hover:bg-surface-hover cursor-pointer",
                        i % 2 === 0 ? "bg-transparent" : "bg-surface/30"
                      )}
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">
                          {project.name}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {project.client}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold",
                            status?.bg,
                            status?.color
                          )}
                        >
                          {status?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-gold">
                        {fmtCurrency(project.value)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {project.date}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div>
        <SectionLabel text="System Status" />
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatusCard
            label="MySQL Catalog"
            status="connected"
            detail={`${totalCatalogItems} items · ${totalCostGroups} cost groups · Live`}
          />
          <StatusCard
            label="Profit Protection"
            status="active"
            detail="35% GP floor · Auto-adjust enabled"
          />
          <StatusCard
            label="JobTread Integration"
            status="ready"
            detail="CSV export ready · Catalog synced"
          />
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border bg-card p-4",
        "transition-all duration-200",
        "hover:border-gold/30 hover:bg-surface-hover hover:shadow-[0_0_20px_var(--color-gold-glow)]",
        "active:scale-[0.98] text-left"
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-glow shrink-0">
        <Icon className="h-5 w-5 text-gold" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-[0.7rem] text-muted-foreground truncate">
          {description}
        </p>
      </div>
    </button>
  );
}

function StatusCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: "connected" | "active" | "ready" | "error";
  detail: string;
}) {
  const statusColor = {
    connected: "text-green-400",
    active: "text-gold",
    ready: "text-blue-400",
    error: "text-red-400",
  }[status];

  const dotColor = {
    connected: "bg-green-400",
    active: "bg-gold",
    ready: "bg-blue-400",
    error: "bg-red-400",
  }[status];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("h-2 w-2 rounded-full", dotColor)} />
        <span className={cn("text-xs font-semibold uppercase tracking-wider", statusColor)}>
          {status}
        </span>
      </div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-[0.7rem] text-muted-foreground mt-1">{detail}</p>
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
