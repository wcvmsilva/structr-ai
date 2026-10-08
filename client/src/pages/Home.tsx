import MetricCard from "@/components/MetricCard";
import { currentQueryData } from "@/components/estimate/EstimateReadiness";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  Package,
  ClipboardList,
  Calculator,
  CheckSquare,
  Plus,
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const statusConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  intake: { label: "Intake", color: "text-blue-400", bg: "bg-blue-500/10" },
  estimating: {
    label: "Estimating",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  review: { label: "Review", color: "text-purple-400", bg: "bg-purple-500/10" },
  approved: {
    label: "Approved",
    color: "text-green-400",
    bg: "bg-green-500/10",
  },
  in_progress: { label: "In Progress", color: "text-gold", bg: "bg-gold-glow" },
  completed: {
    label: "Completed",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
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

  // Presentation only: the server remains the authority for every request.
  // Cached mode data cannot enable unavailable queries while being revalidated.
  const sessionQuery = trpc.auth.session.useQuery();
  const session = currentQueryData(sessionQuery);
  const limitedAccess = session?.estimateReadOnly !== false;
  const projectStatsQuery = trpc.project.stats.useQuery(undefined, {
    enabled: !limitedAccess,
  });
  const projectsQuery = trpc.project.list.useQuery(
    { limit: 5 },
    { enabled: !limitedAccess }
  );
  const catalogStatsQuery = trpc.catalog.stats.useQuery(undefined, {
    enabled: !limitedAccess,
  });
  const catalogGroupsQuery = trpc.catalog.groups.useQuery(undefined, {
    enabled: !limitedAccess,
  });
  const pipelineQuery = trpc.pipeline.getOverview.useQuery(undefined, {
    enabled: !limitedAccess,
  });

  if (limitedAccess) {
    if (session?.estimateReadOnly === true) {
      return (
        <DashboardState
          title="Limited access"
          detail="Dashboard totals, project creation and other business operations are not available in this environment. You can view an estimate using a link provided to you, or manage your account in Settings."
        />
      );
    }
    const checking =
      !sessionQuery.error &&
      !sessionQuery.isError &&
      (sessionQuery.isPending ||
        sessionQuery.isLoading ||
        sessionQuery.isFetching ||
        sessionQuery.isPaused);
    return (
      <DashboardState
        title={
          checking
            ? "Checking dashboard access…"
            : "Dashboard access unavailable"
        }
        detail={
          checking
            ? "Please wait while access is confirmed."
            : "Access could not be confirmed. Reload the page to try again."
        }
        alert={!checking}
      />
    );
  }

  const queries = [
    projectStatsQuery,
    projectsQuery,
    catalogStatsQuery,
    catalogGroupsQuery,
    pipelineQuery,
  ];
  if (queries.some(query => query.error || query.isError)) {
    return (
      <DashboardState
        title="Unable to load dashboard"
        detail="Dashboard data could not be loaded. Reload the page to try again."
        alert
      />
    );
  }
  if (
    queries.some(
      query =>
        query.isPending || query.isLoading || query.isFetching || query.isPaused
    )
  ) {
    return (
      <DashboardState
        title="Loading dashboard…"
        detail="Please wait while the latest totals and projects are loaded."
      />
    );
  }

  const projectStatsData = currentQueryData(projectStatsQuery);
  const recentProjectsData = currentQueryData(projectsQuery);
  const catalogStats = currentQueryData(catalogStatsQuery);
  const catalogGroups = currentQueryData(catalogGroupsQuery);
  const pipelineData = currentQueryData(pipelineQuery);
  if (
    !projectStatsData?.byStatus ||
    !Array.isArray(recentProjectsData?.items) ||
    !Array.isArray(catalogGroups) ||
    catalogStats?.totalItems == null ||
    catalogStats.totalGroups == null ||
    catalogStats.avgMargin == null ||
    pipelineData?.revenue?.pipelineValue == null ||
    pipelineData.funnel?.totalDeals == null
  ) {
    return (
      <DashboardState
        title="Dashboard data is incomplete"
        detail="Some totals or project data are unavailable. Reload the page to try again."
        alert
      />
    );
  }

  const totalCatalogItems = catalogStats.totalItems;
  const totalCostGroups = catalogStats.totalGroups;
  const avgGrossProfit = Number(catalogStats.avgMargin).toFixed(1);

  // Derived stats
  const activeProjects =
    (projectStatsData?.byStatus?.intake ?? 0) +
    (projectStatsData?.byStatus?.estimating ?? 0) +
    (projectStatsData?.byStatus?.review ?? 0) +
    (projectStatsData?.byStatus?.approved ?? 0) +
    (projectStatsData?.byStatus?.in_progress ?? 0);
  const pendingEstimates = projectStatsData?.byStatus?.estimating ?? 0;
  const pendingReviews = projectStatsData?.byStatus?.review ?? 0;
  const recentProjects = recentProjectsData!.items;

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          GC Home Improvement — Charleston, SC
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
          label="Bundles"
          description="Build a bundle"
          onClick={() => setLocation("/bundles")}
        />
        <QuickAction
          icon={CheckSquare}
          label="Pending Reviews"
          description={`${pendingReviews} awaiting`}
          onClick={() => setLocation("/review")}
        />
      </div>

      {/* Quick Actions Card */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Quick Actions
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Fast access to common operations
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => setLocation("/leads")}
            variant="outline"
            className="flex-1 h-10 border-gold/30 hover:border-gold hover:bg-gold-glow/10 text-foreground hover:text-gold transition-all"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Lead
          </Button>
          <Button
            onClick={() => setLocation("/estimate")}
            variant="outline"
            className="flex-1 h-10 border-gold/30 hover:border-gold hover:bg-gold-glow/10 text-foreground hover:text-gold transition-all"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Estimate
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Active Projects"
          value={activeProjects.toString()}
          subtitle={`${pendingEstimates} pending estimates`}
        />
        <MetricCard
          label="Pipeline Value"
          value={fmtCurrency(pipelineData.revenue.pipelineValue)}
          subtitle={`${pipelineData.funnel.totalDeals} active deals`}
          onClick={() => setLocation("/pipeline")}
        />
        <MetricCard
          label="Avg. Gross Profit"
          value={`${avgGrossProfit}%`}
          subtitle="Floor: 35% GP"
          variant={
            Number(avgGrossProfit) >= 38
              ? "success"
              : Number(avgGrossProfit) >= 35
                ? "default"
                : "danger"
          }
        />
        <MetricCard
          label="Catalog Items"
          value={totalCatalogItems.toString()}
          subtitle={`${totalCostGroups} cost groups`}
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
                {recentProjects.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-muted-foreground"
                    >
                      No projects yet.
                    </td>
                  </tr>
                )}
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
                        {project.clientName ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold",
                            status?.bg,
                            status?.color
                          )}
                        >
                          {status?.label ?? project.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-gold">
                        {project.estimatedTotal
                          ? fmtCurrency(parseFloat(project.estimatedTotal))
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {project.createdAt
                          ? new Date(project.createdAt).toLocaleDateString()
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

function DashboardState({
  title,
  detail,
  alert = false,
}: {
  title: string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Dashboard
      </h1>
      <div
        role={alert ? "alert" : "status"}
        className="rounded-xl border border-border bg-card p-6"
      >
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      </div>
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
