import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  CheckCircle,
  XCircle,
  Eye,
  BarChart3,
  Target,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function LearningDashboard() {

  const utils = trpc.useUtils();
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<any>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("reviewed");
  const [reviewNotes, setReviewNotes] = useState("");
  const [suggestionsFilter, setSuggestionsFilter] = useState<string>("all");

  // Queries
  const summary = trpc.learning.dashboardSummary.useQuery();
  const highestVariance = trpc.learning.highestVariance.useQuery({ limit: 10 });
  const overruns = trpc.learning.consistentOverruns.useQuery({ limit: 10 });
  const underruns = trpc.learning.consistentUnderruns.useQuery({ limit: 10 });
  const suggestions = trpc.learning.listSuggestions.useQuery({
    status: suggestionsFilter === "all" ? undefined : suggestionsFilter,
    limit: 50,
  });

  // Mutations
  const refreshAll = trpc.learning.refreshAllMetrics.useMutation({
    onSuccess: (data) => {
      toast("Metrics Refreshed", { description: `${data.assembliesRefreshed} assemblies updated.` });
      utils.learning.invalidate();
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const generateSuggs = trpc.learning.generateSuggestions.useMutation({
    onSuccess: (data) => {
      toast("Suggestions Generated", { description: `${data.suggestionsGenerated} calibration suggestions created.` });
      utils.learning.invalidate();
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const reviewMut = trpc.learning.reviewSuggestion.useMutation({
    onSuccess: () => {
      toast("Suggestion Updated", { description: `Status changed to ${reviewStatus}.` });
      setReviewDialogOpen(false);
      setSelectedSuggestion(null);
      setReviewNotes("");
      utils.learning.invalidate();
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const s = summary.data;

  const openReviewDialog = (suggestion: any) => {
    setSelectedSuggestion(suggestion);
    setReviewStatus("reviewed");
    setReviewNotes("");
    setReviewDialogOpen(true);
  };

  const handleReview = () => {
    if (!selectedSuggestion) return;
    reviewMut.mutate({
      id: selectedSuggestion.id,
      status: reviewStatus as "reviewed" | "accepted" | "rejected",
      reviewNotes: reviewNotes || undefined,
    });
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      case "reviewed": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      case "accepted": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      case "rejected": return "bg-red-500/15 text-red-400 border-red-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-gold" />
            Learning Layer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analytics pipeline — estimate vs. actual performance analysis
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshAll.mutate()}
            disabled={refreshAll.isPending}
          >
            {refreshAll.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Refresh Metrics
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateSuggs.mutate()}
            disabled={generateSuggs.isPending}
          >
            {generateSuggs.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Generate Suggestions
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Variance Events</div>
            <div className="text-2xl font-bold text-foreground mt-1">{s?.totalVarianceEvents ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Assemblies Tracked</div>
            <div className="text-2xl font-bold text-foreground mt-1">{s?.totalAssembliesTracked ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Avg Variance</div>
            <div className="text-2xl font-bold text-foreground mt-1">
              {s?.avgSystemVariance ? `${parseFloat(String(s.avgSystemVariance)).toFixed(1)}%` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Pending Suggestions</div>
            <div className="text-2xl font-bold text-gold mt-1">{s?.pendingSuggestions ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="variance" className="space-y-4">
        <TabsList className="bg-surface border border-border">
          <TabsTrigger value="variance" className="data-[state=active]:bg-gold/15 data-[state=active]:text-gold">
            <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Highest Variance
          </TabsTrigger>
          <TabsTrigger value="overruns" className="data-[state=active]:bg-red-500/15 data-[state=active]:text-red-400">
            <TrendingUp className="h-3.5 w-3.5 mr-1" /> Overruns
          </TabsTrigger>
          <TabsTrigger value="underruns" className="data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400">
            <TrendingDown className="h-3.5 w-3.5 mr-1" /> Underruns
          </TabsTrigger>
          <TabsTrigger value="calibration" className="data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-400">
            <Target className="h-3.5 w-3.5 mr-1" /> Calibration
          </TabsTrigger>
        </TabsList>

        {/* Highest Variance Tab */}
        <TabsContent value="variance">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Assemblies with Highest Variance
              </CardTitle>
              <CardDescription>Assemblies where estimates deviate most from actuals</CardDescription>
            </CardHeader>
            <CardContent>
              {highestVariance.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !highestVariance.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No variance data yet. Record project actuals and ingest variance events to populate this view.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
                        <th className="pb-2 pr-4">Assembly</th>
                        <th className="pb-2 pr-4 text-right">Projects</th>
                        <th className="pb-2 pr-4 text-right">Avg Est. Cost</th>
                        <th className="pb-2 pr-4 text-right">Avg Act. Cost</th>
                        <th className="pb-2 pr-4 text-right">Avg Variance</th>
                        <th className="pb-2 pr-4 text-right">Overruns</th>
                        <th className="pb-2 text-right">Underruns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {highestVariance.data.map((m) => (
                        <tr key={m.id} className="border-b border-border/50 hover:bg-surface-hover transition-colors">
                          <td className="py-2.5 pr-4 font-medium text-foreground">{m.assemblyName ?? `#${m.assemblyId}`}</td>
                          <td className="py-2.5 pr-4 text-right">{m.projectCount}</td>
                          <td className="py-2.5 pr-4 text-right font-mono">${parseFloat(String(m.avgEstimatedCost ?? 0)).toFixed(2)}</td>
                          <td className="py-2.5 pr-4 text-right font-mono">${parseFloat(String(m.avgActualCost ?? 0)).toFixed(2)}</td>
                          <td className="py-2.5 pr-4 text-right">
                            <span className={parseFloat(String(m.avgVariancePct ?? 0)) > 20 ? "text-red-400 font-semibold" : "text-amber-400"}>
                              {parseFloat(String(m.avgVariancePct ?? 0)).toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-right text-red-400">{m.overrunCount}</td>
                          <td className="py-2.5 text-right text-emerald-400">{m.underrunCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Overruns Tab */}
        <TabsContent value="overruns">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-red-400" />
                Consistent Overruns
              </CardTitle>
              <CardDescription>Assemblies where actual costs consistently exceed estimates</CardDescription>
            </CardHeader>
            <CardContent>
              {overruns.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !overruns.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No overrun patterns detected yet.</p>
              ) : (
                <div className="space-y-2">
                  {overruns.data.map((m) => {
                    const totalProjects = m.overrunCount + m.underrunCount;
                    const overrunPct = totalProjects > 0 ? Math.round((m.overrunCount / totalProjects) * 100) : 0;
                    return (
                      <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-surface border border-border hover:border-red-500/30 transition-colors">
                        <div>
                          <div className="font-medium text-foreground">{m.assemblyName ?? `#${m.assemblyId}`}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {m.overrunCount} overruns / {totalProjects} projects ({overrunPct}% overrun rate)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-red-400 font-semibold">+{parseFloat(String(m.avgVariancePct ?? 0)).toFixed(1)}%</div>
                          <div className="text-xs text-muted-foreground">avg variance</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Underruns Tab */}
        <TabsContent value="underruns">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-emerald-400" />
                Consistent Underruns
              </CardTitle>
              <CardDescription>Assemblies where actual costs consistently come under estimates</CardDescription>
            </CardHeader>
            <CardContent>
              {underruns.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !underruns.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No underrun patterns detected yet.</p>
              ) : (
                <div className="space-y-2">
                  {underruns.data.map((m) => {
                    const totalProjects = m.overrunCount + m.underrunCount;
                    const underrunPct = totalProjects > 0 ? Math.round((m.underrunCount / totalProjects) * 100) : 0;
                    return (
                      <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-surface border border-border hover:border-emerald-500/30 transition-colors">
                        <div>
                          <div className="font-medium text-foreground">{m.assemblyName ?? `#${m.assemblyId}`}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {m.underrunCount} underruns / {totalProjects} projects ({underrunPct}% underrun rate)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-emerald-400 font-semibold">-{parseFloat(String(m.avgVariancePct ?? 0)).toFixed(1)}%</div>
                          <div className="text-xs text-muted-foreground">avg variance</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calibration Suggestions Tab */}
        <TabsContent value="calibration">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-blue-400" />
                    Calibration Suggestions
                  </CardTitle>
                  <CardDescription>AI-generated multiplier adjustments based on performance data</CardDescription>
                </div>
                <Select value={suggestionsFilter} onValueChange={setSuggestionsFilter}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {suggestions.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !suggestions.data?.items?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No calibration suggestions yet. Click "Generate Suggestions" to analyze assembly performance data.
                </p>
              ) : (
                <div className="space-y-3">
                  {suggestions.data.items.map((sug) => (
                    <div key={sug.id} className="p-4 rounded-lg bg-surface border border-border hover:border-blue-500/20 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-medium text-foreground">{sug.assemblyName ?? `Assembly #${sug.assemblyId}`}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={statusColor(sug.status)}>{sug.status}</Badge>
                            <span className="text-xs text-muted-foreground">
                              Confidence: {parseFloat(String(sug.confidenceScore)).toFixed(0)}% · {sug.sampleSize} samples
                            </span>
                          </div>
                        </div>
                        {sug.status === "pending" && (
                          <Button variant="outline" size="sm" onClick={() => openReviewDialog(sug)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Review
                          </Button>
                        )}
                      </div>

                      {/* Suggested Multipliers */}
                      <div className="grid grid-cols-3 gap-3 mt-3">
                        <div className="text-center p-2 rounded bg-background border border-border">
                          <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">Waste Factor</div>
                          <div className="text-sm font-mono font-semibold text-foreground mt-0.5">
                            {parseFloat(String(sug.suggestedWasteFactor ?? 1)).toFixed(4)}
                          </div>
                        </div>
                        <div className="text-center p-2 rounded bg-background border border-border">
                          <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">Labor Mult.</div>
                          <div className="text-sm font-mono font-semibold text-foreground mt-0.5">
                            {parseFloat(String(sug.suggestedLaborMultiplier ?? 1)).toFixed(4)}
                          </div>
                        </div>
                        <div className="text-center p-2 rounded bg-background border border-border">
                          <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">Material Mult.</div>
                          <div className="text-sm font-mono font-semibold text-foreground mt-0.5">
                            {parseFloat(String(sug.suggestedMaterialMultiplier ?? 1)).toFixed(4)}
                          </div>
                        </div>
                      </div>

                      {/* Rationale */}
                      {sug.rationale && (
                        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{sug.rationale}</p>
                      )}

                      {/* Review Notes */}
                      {sug.reviewNotes && (
                        <div className="mt-2 p-2 rounded bg-background border border-border">
                          <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wider mb-1">Review Notes</div>
                          <p className="text-xs text-foreground">{sug.reviewNotes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Review Calibration Suggestion</DialogTitle>
            <DialogDescription>
              {selectedSuggestion?.assemblyName ?? `Assembly #${selectedSuggestion?.assemblyId}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Decision</label>
              <Select value={reviewStatus} onValueChange={setReviewStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reviewed">
                    <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> Mark as Reviewed</span>
                  </SelectItem>
                  <SelectItem value="accepted">
                    <span className="flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> Accept</span>
                  </SelectItem>
                  <SelectItem value="rejected">
                    <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-400" /> Reject</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Notes (optional)</label>
              <Textarea
                className="mt-1"
                placeholder="Add review notes..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Show suggested values */}
            {selectedSuggestion && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded bg-background border border-border">
                  <div className="text-[0.6rem] text-muted-foreground uppercase">Waste</div>
                  <div className="text-sm font-mono">{parseFloat(String(selectedSuggestion.suggestedWasteFactor ?? 1)).toFixed(4)}</div>
                </div>
                <div className="p-2 rounded bg-background border border-border">
                  <div className="text-[0.6rem] text-muted-foreground uppercase">Labor</div>
                  <div className="text-sm font-mono">{parseFloat(String(selectedSuggestion.suggestedLaborMultiplier ?? 1)).toFixed(4)}</div>
                </div>
                <div className="p-2 rounded bg-background border border-border">
                  <div className="text-[0.6rem] text-muted-foreground uppercase">Material</div>
                  <div className="text-sm font-mono">{parseFloat(String(selectedSuggestion.suggestedMaterialMultiplier ?? 1)).toFixed(4)}</div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleReview} disabled={reviewMut.isPending}>
              {reviewMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Submit Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
