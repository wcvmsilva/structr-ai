/**
 * Sprint 21 — Project Actuals
 *
 * Manual input of actual costs for completed assemblies:
 *   - Record actual qty/cost vs estimated
 *   - Auto-calculate variance percentage
 *   - High variance alerts (>20%)
 *   - Variance summary per project
 */

import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  Plus,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  BarChart3,
  Filter,
} from "lucide-react";

export default function ProjectActualsPage() {
  const [showRecordDialog, setShowRecordDialog] = useState(false);
  const [highVarianceOnly, setHighVarianceOnly] = useState(false);
  const [filterProjectId, setFilterProjectId] = useState<string>("");

  // Form state
  const [form, setForm] = useState({
    projectId: "",
    estimateId: "",
    assemblyName: "",
    lineItemDescription: "",
    unit: "",
    estimatedQty: "",
    actualQty: "",
    estimatedTotalCost: "",
    actualTotalCost: "",
    varianceReason: "",
    trade: "",
  });

  const utils = trpc.useUtils();

  const actualsList = trpc.fieldLaunch.listActuals.useQuery({
    projectId: filterProjectId ? parseInt(filterProjectId) : undefined,
    highVarianceOnly: highVarianceOnly || undefined,
    limit: 50,
    offset: 0,
  });

  const recordActual = trpc.fieldLaunch.recordActual.useMutation({
    onSuccess: () => {
      toast.success("Actual recorded successfully");
      setShowRecordDialog(false);
      resetForm();
      utils.fieldLaunch.listActuals.invalidate();
      utils.fieldLaunch.monitoringMetrics.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm() {
    setForm({
      projectId: "",
      estimateId: "",
      assemblyName: "",
      lineItemDescription: "",
      unit: "",
      estimatedQty: "",
      actualQty: "",
      estimatedTotalCost: "",
      actualTotalCost: "",
      varianceReason: "",
      trade: "",
    });
  }

  // Live variance preview
  const liveVariance = useMemo(() => {
    const est = parseFloat(form.estimatedTotalCost);
    const act = parseFloat(form.actualCost);
    if (isNaN(est) || isNaN(act) || est === 0) return null;
    const pct = Math.abs(act - est) / Math.abs(est) * 100;
    const amount = act - est;
    return { pct: pct.toFixed(1), amount: amount.toFixed(2), isHigh: pct > 20 };
  }, [form.estimatedTotalCost, form.actualCost]);

  function handleSubmit() {
    const projectId = parseInt(form.projectId);
    const estimatedTotalCost = parseFloat(form.estimatedTotalCost);
    const actualTotalCost = parseFloat(form.actualCost);

    if (isNaN(projectId) || isNaN(estimatedTotalCost) || isNaN(actualTotalCost)) {
      toast.error("Project ID, Estimated Cost, and Actual Cost are required");
      return;
    }

    recordActual.mutate({
      projectId,
      estimateId: form.estimateId ? parseInt(form.estimateId) : undefined,
      assemblyName: form.assemblyName || undefined,
      lineItemDescription: form.lineItemDescription || undefined,
      unit: form.unit || undefined,
      estimatedQty: form.estimatedQty ? parseFloat(form.estimatedQty) : undefined,
      actualQty: form.actualQty ? parseFloat(form.actualQty) : undefined,
      estimatedTotalCost,
      actualTotalCost,
      varianceReason: form.varianceReason || undefined,
      trade: form.trade || undefined,
    });
  }

  function updateForm(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Project Actuals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Record actual costs and track variance against estimates
          </p>
        </div>
        <Button
          onClick={() => setShowRecordDialog(true)}
          className="bg-gold hover:bg-gold-dark text-background font-semibold"
        >
          <Plus className="h-4 w-4 mr-2" />
          Record Actual
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by Project ID"
          value={filterProjectId}
          onChange={(e) => setFilterProjectId(e.target.value)}
          className="w-[180px]"
          type="number"
        />
        <div className="flex items-center gap-2">
          <Switch
            checked={highVarianceOnly}
            onCheckedChange={setHighVarianceOnly}
          />
          <Label className="text-sm text-muted-foreground">High Variance Only</Label>
        </div>
      </div>

      {/* Actuals List */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-gold" />
            Recorded Actuals ({actualsList.data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {actualsList.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : actualsList.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No actuals recorded yet. Click "Record Actual" to start tracking.
            </p>
          ) : (
            <div className="space-y-3">
              {actualsList.data?.items.map((actual) => {
                const variance = parseFloat(String(actual.variancePct ?? 0));
                const varAmount = parseFloat(String(actual.varianceAmount ?? 0));
                const estCost = parseFloat(String(actual.estimatedTotalCost ?? 0));
                const actCost = parseFloat(String(actual.actualCost ?? 0));

                return (
                  <div
                    key={actual.id}
                    className={`p-4 rounded-lg border transition-colors ${
                      actual.isHighVariance
                        ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
                        : "border-border bg-muted/20 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">
                            Project #{actual.projectId}
                          </span>
                          {actual.assemblyName && (
                            <Badge variant="outline" className="text-xs">
                              {actual.assemblyName}
                            </Badge>
                          )}
                          {actual.trade && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              {actual.trade}
                            </Badge>
                          )}
                          {actual.isHighVariance && (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              HIGH VARIANCE
                            </Badge>
                          )}
                        </div>
                        {actual.lineItemDescription && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {actual.lineItemDescription}
                          </p>
                        )}
                        <div className="flex items-center gap-6 mt-2 text-sm">
                          <span className="text-muted-foreground">
                            Est: <span className="text-foreground font-mono">${estCost.toLocaleString()}</span>
                          </span>
                          <span className="text-muted-foreground">
                            Act: <span className="text-foreground font-mono">${actCost.toLocaleString()}</span>
                          </span>
                        </div>
                        {actual.varianceReason && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            Reason: {actual.varianceReason}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(actual.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`flex items-center gap-1 ${
                          variance > 20 ? "text-red-400" : variance > 10 ? "text-amber-400" : "text-emerald-400"
                        }`}>
                          {varAmount >= 0 ? (
                            <TrendingUp className="h-4 w-4" />
                          ) : (
                            <TrendingDown className="h-4 w-4" />
                          )}
                          <span className="text-lg font-bold">{variance.toFixed(1)}%</span>
                        </div>
                        <p className={`text-xs font-mono ${varAmount >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {varAmount >= 0 ? "+" : ""}${varAmount.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Actual Dialog */}
      <Dialog open={showRecordDialog} onOpenChange={setShowRecordDialog}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>Record Project Actual</DialogTitle>
            <DialogDescription>
              Enter actual costs for a completed assembly or line item
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Project ID *</Label>
                <Input
                  type="number"
                  value={form.projectId}
                  onChange={(e) => updateForm("projectId", e.target.value)}
                  placeholder="e.g. 42"
                />
              </div>
              <div className="space-y-2">
                <Label>Estimate ID</Label>
                <Input
                  type="number"
                  value={form.estimateId}
                  onChange={(e) => updateForm("estimateId", e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assembly Name</Label>
                <Input
                  value={form.assemblyName}
                  onChange={(e) => updateForm("assemblyName", e.target.value)}
                  placeholder="e.g. Kitchen Cabinets"
                />
              </div>
              <div className="space-y-2">
                <Label>Trade</Label>
                <Input
                  value={form.trade}
                  onChange={(e) => updateForm("trade", e.target.value)}
                  placeholder="e.g. Carpentry"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Line Item Description</Label>
              <Input
                value={form.lineItemDescription}
                onChange={(e) => updateForm("lineItemDescription", e.target.value)}
                placeholder="e.g. Install base cabinets"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Unit</Label>
                <Input
                  value={form.unit}
                  onChange={(e) => updateForm("unit", e.target.value)}
                  placeholder="e.g. LF"
                />
              </div>
              <div className="space-y-2">
                <Label>Est. Qty</Label>
                <Input
                  type="number"
                  value={form.estimatedQty}
                  onChange={(e) => updateForm("estimatedQty", e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Actual Qty</Label>
                <Input
                  type="number"
                  value={form.actualQty}
                  onChange={(e) => updateForm("actualQty", e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Cost inputs with live variance preview */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estimated Total Cost *</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={form.estimatedTotalCost}
                    onChange={(e) => updateForm("estimatedTotalCost", e.target.value)}
                    placeholder="0.00"
                    className="pl-9"
                    step="0.01"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Actual Total Cost *</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={form.actualCost}
                    onChange={(e) => updateForm("actualTotalCost", e.target.value)}
                    placeholder="0.00"
                    className="pl-9"
                    step="0.01"
                  />
                </div>
              </div>
            </div>

            {/* Live Variance Preview */}
            {liveVariance && (
              <div className={`p-3 rounded-lg border ${
                liveVariance.isHigh
                  ? "border-red-500/30 bg-red-500/10"
                  : "border-emerald-500/30 bg-emerald-500/10"
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Variance Preview</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold ${
                      liveVariance.isHigh ? "text-red-400" : "text-emerald-400"
                    }`}>
                      {liveVariance.pct}%
                    </span>
                    <span className={`text-sm font-mono ${
                      parseFloat(liveVariance.amount) >= 0 ? "text-red-400" : "text-emerald-400"
                    }`}>
                      ({parseFloat(liveVariance.amount) >= 0 ? "+" : ""}${liveVariance.amount})
                    </span>
                  </div>
                </div>
                {liveVariance.isHigh && (
                  <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    This will be flagged as HIGH VARIANCE (&gt;20%)
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Variance Reason</Label>
              <Textarea
                value={form.varianceReason}
                onChange={(e) => updateForm("varianceReason", e.target.value)}
                placeholder="Explain the reason for any variance..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRecordDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={recordActual.isPending}
              className="bg-gold hover:bg-gold-dark text-background"
            >
              {recordActual.isPending ? "Recording..." : "Record Actual"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
