/**
 * Sprint 21 — Field Feedback System
 *
 * Submit and manage field feedback reports:
 *   - Submit new feedback with issue type, severity, description
 *   - View all feedback with filters
 *   - Resolve/dismiss feedback (admin)
 *   - Stats overview
 */

import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  MessageSquarePlus,
  Filter,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  BarChart3,
} from "lucide-react";

const ISSUE_TYPES = [
  { value: "pricing_inaccuracy", label: "Pricing Inaccuracy" },
  { value: "scope_mismatch", label: "Scope Mismatch" },
  { value: "material_unavailable", label: "Material Unavailable" },
  { value: "labor_shortage", label: "Labor Shortage" },
  { value: "timeline_issue", label: "Timeline Issue" },
  { value: "quality_concern", label: "Quality Concern" },
  { value: "client_complaint", label: "Client Complaint" },
  { value: "safety_issue", label: "Safety Issue" },
  { value: "other", label: "Other" },
] as const;

const SEVERITIES = [
  { value: "low", label: "Low", color: "text-blue-400" },
  { value: "medium", label: "Medium", color: "text-amber-400" },
  { value: "high", label: "High", color: "text-orange-400" },
  { value: "critical", label: "Critical", color: "text-red-400" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  open: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  in_review: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  resolved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  dismissed: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export default function FieldFeedbackPage() {
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  // Form state
  const [issueType, setIssueType] = useState<string>("");
  const [severity, setSeverity] = useState<string>("medium");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [estimateId, setEstimateId] = useState<string>("");
  const [resolution, setResolution] = useState("");

  const utils = trpc.useUtils();

  const feedbackList = trpc.fieldLaunch.listFeedback.useQuery({
    status: filterStatus !== "all" ? (filterStatus as any) : undefined,
    severity: filterSeverity !== "all" ? (filterSeverity as any) : undefined,
    limit: 50,
    offset: 0,
  });

  const feedbackStats = trpc.fieldLaunch.feedbackStats.useQuery();

  const submitFeedback = trpc.fieldLaunch.submitFeedback.useMutation({
    onSuccess: () => {
      toast.success("Feedback submitted successfully");
      setShowSubmitDialog(false);
      resetForm();
      utils.fieldLaunch.listFeedback.invalidate();
      utils.fieldLaunch.feedbackStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resolveFeedback = trpc.fieldLaunch.resolveFeedback.useMutation({
    onSuccess: () => {
      toast.success("Feedback resolved");
      setShowResolveDialog(false);
      setResolution("");
      setSelectedId(null);
      utils.fieldLaunch.listFeedback.invalidate();
      utils.fieldLaunch.feedbackStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const dismissFeedback = trpc.fieldLaunch.dismissFeedback.useMutation({
    onSuccess: () => {
      toast.success("Feedback dismissed");
      utils.fieldLaunch.listFeedback.invalidate();
      utils.fieldLaunch.feedbackStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm() {
    setIssueType("");
    setSeverity("medium");
    setDescription("");
    setProjectId("");
    setEstimateId("");
  }

  function handleSubmit() {
    if (!issueType || !description || description.length < 10) {
      toast.error("Please fill in all required fields (description must be at least 10 characters)");
      return;
    }
    submitFeedback.mutate({
      issueType: issueType as any,
      severity: severity as any,
      description,
      projectId: projectId ? parseInt(projectId) : undefined,
      estimateId: estimateId ? parseInt(estimateId) : undefined,
    });
  }

  const stats = feedbackStats.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Field Feedback</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Submit and track field reports from active projects
          </p>
        </div>
        <Button
          onClick={() => setShowSubmitDialog(true)}
          className="bg-gold hover:bg-gold-dark text-background font-semibold"
        >
          <MessageSquarePlus className="h-4 w-4 mr-2" />
          Submit Feedback
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats?.total ?? 0, icon: BarChart3 },
          { label: "Open", value: stats?.open ?? 0, icon: Clock },
          { label: "In Review", value: stats?.inReview ?? 0, icon: AlertTriangle },
          { label: "Resolved", value: stats?.resolved ?? 0, icon: CheckCircle },
          { label: "Dismissed", value: stats?.dismissed ?? 0, icon: XCircle },
        ].map((s) => (
          <Card key={s.label} className="border-border bg-card">
            <CardContent className="p-3 flex items-center gap-3">
              <s.icon className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            {SEVERITIES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Feedback List */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">
            Reports ({feedbackList.data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {feedbackList.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : feedbackList.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No feedback reports found. Submit your first field feedback above.
            </p>
          ) : (
            <div className="space-y-3">
              {feedbackList.data?.items.map((report) => (
                <div
                  key={report.id}
                  className="p-4 rounded-lg border border-border bg-muted/20 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={STATUS_COLORS[report.status] ?? ""}>
                          {report.status.replace("_", " ")}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {report.issueType.replace(/_/g, " ")}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            SEVERITIES.find((s) => s.value === report.severity)?.color ?? ""
                          }`}
                        >
                          {report.severity}
                        </Badge>
                        {report.projectId && (
                          <span className="text-xs text-muted-foreground">
                            Project #{report.projectId}
                          </span>
                        )}
                        {report.estimateId && (
                          <span className="text-xs text-muted-foreground">
                            Estimate #{report.estimateId}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground mt-2 line-clamp-2">
                        {report.description}
                      </p>
                      {report.resolution && (
                        <p className="text-xs text-emerald-400 mt-1">
                          Resolution: {report.resolution}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(report.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {report.status === "open" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedId(report.id);
                            setShowResolveDialog(true);
                          }}
                          className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                        >
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => dismissFeedback.mutate({ id: report.id })}
                          className="text-gray-400 border-gray-500/30 hover:bg-gray-500/10"
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit Feedback Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Submit Field Feedback</DialogTitle>
            <DialogDescription>
              Report an issue encountered during field operations
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Issue Type *</Label>
                <Select value={issueType} onValueChange={setIssueType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Project ID (optional)</Label>
                <Input
                  type="number"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="e.g. 42"
                />
              </div>
              <div className="space-y-2">
                <Label>Estimate ID (optional)</Label>
                <Input
                  type="number"
                  value={estimateId}
                  onChange={(e) => setEstimateId(e.target.value)}
                  placeholder="e.g. 15"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the issue in detail (min 10 characters)..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitFeedback.isPending}
              className="bg-gold hover:bg-gold-dark text-background"
            >
              {submitFeedback.isPending ? "Submitting..." : "Submit Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Resolve Feedback</DialogTitle>
            <DialogDescription>
              Provide a resolution for this feedback report
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Resolution *</Label>
              <Textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Describe how this issue was resolved..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedId || !resolution) {
                  toast.error("Please provide a resolution");
                  return;
                }
                resolveFeedback.mutate({ id: selectedId, resolution });
              }}
              disabled={resolveFeedback.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {resolveFeedback.isPending ? "Resolving..." : "Resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
