import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { 
  TrendingUp, 
  Target, 
  Users, 
  Briefcase, 
  ArrowRight, 
  DollarSign,
  Activity,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import MetricCard from "@/components/MetricCard";
import { useLocation } from "wouter";

const funnelStages = [
  { key: "totalLeads", label: "Total Leads", icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "qualifiedLeads", label: "Qualified", icon: Target, color: "text-amber-400", bg: "bg-amber-500/10" },
  { key: "totalDeals", label: "Active Deals", icon: Briefcase, color: "text-purple-400", bg: "bg-purple-500/10" },
  { key: "proposalsSent", label: "Proposals", icon: Activity, color: "text-gold", bg: "bg-gold-glow" },
  { key: "dealsWon", label: "Deals Won", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
];

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function PipelineOverview() {
  const [, setLocation] = useLocation();
  const { data: pipelineData, isLoading } = trpc.pipeline.getOverview.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold" />
      </div>
    );
  }

  const funnel = pipelineData?.funnel ?? {
    totalLeads: 0,
    qualifiedLeads: 0,
    totalDeals: 0,
    proposalsSent: 0,
    dealsWon: 0,
  };

  const summary = pipelineData?.summary;
  const revenue = pipelineData?.revenue;

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="h-5 w-5 text-gold" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Sales Pipeline
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Real-time orchestration of leads, deals, and projects.
        </p>
        <div className="h-[2px] w-48 mt-3 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
      </div>

      {/* High-Level Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Pipeline Value"
          value={fmtCurrency(revenue?.pipelineValue ?? 0)}
          subtitle="Total potential revenue"
          variant="default"
        />
        <MetricCard
          label="Weighted Value"
          value={fmtCurrency(revenue?.pipelineValue ?? 0)}
          subtitle="Probability-adjusted revenue"
          variant="success"
        />
        <MetricCard
          label="Conversion Rate"
          value={`${funnel.totalLeads > 0 ? ((funnel.dealsWon / funnel.totalLeads) * 100).toFixed(1) : "0"}%`}
          subtitle="Discovery to Win ratio"
          variant="default"
        />
      </div>

      {/* Funnel Visualization */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm overflow-hidden relative">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gold flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Conversion Funnel
          </h3>
          <span className="text-xs text-muted-foreground font-mono">
            LAST 30 DAYS
          </span>
        </div>

        <div className="flex flex-col gap-4 relative z-10">
          {funnelStages.map((stage, i) => {
            const count = (funnel as any)[stage.key] || 0;
            const prevCount = i > 0 ? (funnel as any)[funnelStages[i-1].key] || 0 : count;
            const dropoff = i > 0 && prevCount > 0 ? Math.round((count / prevCount) * 100) : 100;
            const width = Math.max(20, 100 - (i * 12));

            return (
              <div key={stage.key} className="group flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs px-1">
                  <div className="flex items-center gap-2">
                    <stage.icon className={cn("h-3.5 w-3.5", stage.color)} />
                    <span className="font-semibold text-foreground/80">{stage.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-lg">{count}</span>
                    {i > 0 && (
                      <span className={cn(
                        "text-[0.65rem] font-bold px-1.5 py-0.5 rounded-sm",
                        dropoff > 70 ? "bg-emerald-500/10 text-emerald-400" : 
                        dropoff > 40 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"
                      )}>
                        {dropoff}%
                      </span>
                    )}
                  </div>
                </div>
                <div 
                  className="h-10 rounded-lg bg-surface relative overflow-hidden transition-all duration-300 group-hover:bg-surface-hover border border-border/50"
                  style={{ width: `${width}%` }}
                >
                  <div 
                    className={cn("absolute inset-0 opacity-20", stage.bg)}
                  />
                  <div 
                    className={cn("absolute left-0 top-0 bottom-0 w-1", stage.bg.replace('/10', ''))} 
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Decorative background element */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-gold-glow opacity-5 blur-[120px] pointer-events-none" />
      </div>

      {/* Grid of Actions / Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deal Health */}
        <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="text-[0.7rem] font-bold text-muted-foreground uppercase tracking-widest mb-4">
                Pipeline Health
            </h4>
            <div className="space-y-4">
                <HealthItem 
                    label="Active Deals" 
                    count={funnel.totalDeals} 
                    detail="Opportunities currently in flow" 
                />
                <HealthItem 
                    label="Pending Proposals" 
                    count={funnel.totalDeals - funnel.proposalsSent} 
                    detail="Awaiting estimate generation" 
                    status="warning"
                />
                <HealthItem 
                    label="Stale Leads" 
                    count={summary?.leadsByStatus?.new ?? 0} 
                    detail="Unprocessed intake forms" 
                    status="danger"
                />
            </div>
        </div>

        {/* Quick Conversion CTA */}
        <div className="rounded-xl border border-dashed border-gold/30 bg-gold-glow/5 p-5 flex flex-col justify-center items-center text-center">
            <div className="h-12 w-12 rounded-full bg-gold-glow flex items-center justify-center mb-3">
                <ArrowRight className="h-6 w-6 text-gold" />
            </div>
            <h4 className="text-lg font-bold text-foreground mb-1">Lead to Project Flow</h4>
            <p className="text-xs text-muted-foreground max-w-[250px] mb-4">
                Accelerate conversion by qualifying leads and generating estimates in one click.
            </p>
            <button 
                onClick={() => setLocation("/leads")}
                className="bg-gold text-surface px-6 py-2 rounded-lg text-sm font-bold hover:shadow-[0_0_15px_var(--color-gold)] transition-all"
            >
                Process Leads
            </button>
        </div>
      </div>
    </div>
  );
}

function HealthItem({ label, count, detail, status = "default" }: { 
    label: string; 
    count: number; 
    detail: string;
    status?: "default" | "success" | "warning" | "danger";
}) {
    const colors = {
        default: "text-gold",
        success: "text-emerald-400",
        warning: "text-amber-400",
        danger: "text-red-400",
    };

    return (
        <div className="flex items-center justify-between group">
            <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground group-hover:text-gold transition-colors">{label}</p>
                <p className="text-[0.7rem] text-muted-foreground">{detail}</p>
            </div>
            <div className="flex flex-col items-end">
                <span className={cn("text-xl font-mono font-bold", colors[status])}>{count}</span>
            </div>
        </div>
    );
}
