/**
 * Sprint 21 — Monitoring Dashboard
 *
 * Internal dashboard showing:
 *   - Total estimates generated, approved, exported
 *   - Pipeline errors, override frequency, CSV validation failures
 *   - Field feedback reports count
 *   - High variance project count
 *   - Field launch mode toggle
 *   - Estimate status distribution
 *   - Recent audit activity feed
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  BarChart3,
  CheckCircle,
  XCircle,
  FileOutput,
  AlertTriangle,
  Shuffle,
  FileWarning,
  MessageSquare,
  TrendingUp,
  Activity,
  Shield,
  Clock,
} from "lucide-react";

export default function MonitoringPage() {
  const metrics = trpc.fieldLaunch.monitoringMetrics.useQuery();
  const statusDist = trpc.fieldLaunch.estimateStatusDistribution.useQuery();
  const recentActivity = trpc.fieldLaunch.recentActivity.useQuery({ limit: 15 });
  const fieldLaunchMode = trpc.fieldLaunch.getFieldLaunchMode.useQuery();
  const utils = trpc.useUtils();

  const toggleFieldLaunch = trpc.fieldLaunch.setFieldLaunchMode.useMutation({
    onSuccess: () => {
      utils.fieldLaunch.getFieldLaunchMode.invalidate();
      utils.fieldLaunch.monitoringMetrics.invalidate();
      toast.success("Field Launch Mode updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const m = metrics.data;
  const isLoading = metrics.isLoading;

  const metricCards = [
    { label: "Total Estimates", value: m?.totalEstimates ?? 0, icon: BarChart3, color: "text-blue-400" },
    { label: "Approved", value: m?.estimatesApproved ?? 0, icon: CheckCircle, color: "text-emerald-400" },
    { label: "Rejected", value: m?.estimatesRejected ?? 0, icon: XCircle, color: "text-red-400" },
    { label: "Exported", value: m?.estimatesExported ?? 0, icon: FileOutput, color: "text-cyan-400" },
    { label: "Pipeline Errors", value: m?.pipelineErrors ?? 0, icon: AlertTriangle, color: "text-amber-400" },
    { label: "Override Events", value: m?.overrideFrequency ?? 0, icon: Shuffle, color: "text-purple-400" },
    { label: "CSV Failures", value: m?.csvValidationFailures ?? 0, icon: FileWarning, color: "text-orange-400" },
    { label: "Feedback Reports", value: m?.feedbackReports ?? 0, icon: MessageSquare, color: "text-sky-400" },
    { label: "High Variance", value: m?.highVarianceProjects ?? 0, icon: TrendingUp, color: "text-rose-400" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monitoring Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Field Launch Control — Operational Metrics
          </p>
        </div>
        <Card className="border-gold/20 bg-card">
          <CardContent className="flex items-center gap-3 p-4">
            <Shield className="h-5 w-5 text-gold" />
            <div className="flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Field Launch Mode
              </span>
              <span className="text-sm font-medium text-foreground">
                {fieldLaunchMode.data?.enabled ? "Active" : "Inactive"}
              </span>
            </div>
            <Switch
              checked={fieldLaunchMode.data?.enabled ?? false}
              onCheckedChange={(checked) => toggleFieldLaunch.mutate({ enabled: checked })}
              disabled={toggleFieldLaunch.isPending}
            />
          </CardContent>
        </Card>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {metricCards.map((card) => (
          <Card key={card.label} className="border-border bg-card hover:border-gold/20 transition-colors">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`p-2.5 rounded-lg bg-muted/50 ${card.color}`}>
                <card.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-foreground">{card.value}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Two-column: Status Distribution + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Estimate Status Distribution */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-gold" />
              Estimate Status Distribution
            </CardTitle>
            <CardDescription>Breakdown by current status</CardDescription>
          </CardHeader>
          <CardContent>
            {statusDist.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : statusDist.data && Object.keys(statusDist.data).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(statusDist.data).map(([status, count]) => {
                  const total = Object.values(statusDist.data!).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
                  const colors: Record<string, string> = {
                    draft: "bg-slate-500",
                    review: "bg-amber-500",
                    approved: "bg-emerald-500",
                    rejected: "bg-red-500",
                    archived: "bg-gray-500",
                    exported: "bg-cyan-500",
                  };
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground w-24 capitalize">{status}</span>
                      <div className="flex-1 h-6 bg-muted rounded-md overflow-hidden">
                        <div
                          className={`h-full ${colors[status] ?? "bg-gold"} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono text-muted-foreground w-16 text-right">
                        {count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No estimates yet</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity Feed */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-gold" />
              Recent Activity
            </CardTitle>
            <CardDescription>Latest audit events</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : recentActivity.data && recentActivity.data.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {recentActivity.data.map((event: any) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[0.65rem] font-mono shrink-0">
                          {event.action}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {event.tableName}
                          {event.recordId ? ` #${event.recordId}` : ""}
                        </span>
                      </div>
                      <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No recent activity</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
