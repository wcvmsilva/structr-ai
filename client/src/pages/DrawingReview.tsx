/**
 * Drawing Review Workspace — TakeOff V1
 *
 * Human review interface for scope sources:
 * - View/edit assembly candidates with confidence levels
 * - Manage RFI candidates
 * - Approve/reject scope source
 * - Finalize to scope draft (pipeline integration)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  HelpCircle,
  ArrowRight,
  Shield,
  Edit3,
} from "lucide-react";

const CONFIDENCE_COLORS: Record<string, string> = {
  measured: "bg-green-600",
  scaled: "bg-blue-500",
  assumed: "bg-yellow-500",
  ai_extracted: "bg-orange-500",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  measured: "Measured",
  scaled: "Scaled",
  assumed: "Assumed",
  ai_extracted: "AI Extracted",
};

export default function DrawingReviewPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // Queries
  const { data: projectsData } = trpc.project.list.useQuery({});
  const projectList = (projectsData && "items" in projectsData ? projectsData.items : projectsData) ?? [];
  const { data: scopeSource } = trpc.scopeSource.getActive.useQuery(
    { projectId: selectedProjectId },
    { enabled: !!selectedProjectId }
  );
  const { data: rfis } = trpc.rfi.listByProject.useQuery(
    { projectId: selectedProjectId, openOnly: false },
    { enabled: !!selectedProjectId }
  );

  // Mutations
  const approveMutation = trpc.scopeSource.setReviewStatus.useMutation({
    onSuccess: () => {
      toast.success("Scope source approved");
      utils.scopeSource.getActive.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = trpc.scopeSource.setReviewStatus.useMutation({
    onSuccess: () => {
      toast.success("Scope source rejected");
      utils.scopeSource.getActive.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const finalizeMutation = trpc.scopeSource.finalize.useMutation({
    onSuccess: (result) => {
      toast.success(`Scope draft created with ${result.itemCount} items (confidence: ${(result.overallConfidence * 100).toFixed(0)}%)`);
      utils.scopeSource.getActive.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const resolveRfiMutation = trpc.rfi.resolve.useMutation({
    onSuccess: () => {
      toast.success("RFI resolved");
      utils.rfi.listByProject.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const dismissRfiMutation = trpc.rfi.dismiss.useMutation({
    onSuccess: () => {
      toast.success("RFI dismissed");
      utils.rfi.listByProject.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const payload = scopeSource?.payloadJson as any;
  const candidates = (payload?.assemblyCandidates ?? []) as any[];
  const confidenceSummary = scopeSource?.confidenceSummaryJson as any;
  const openRfiCount = rfis?.filter((r: any) => r.status === "open").length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Drawing Review</h1>
        <p className="text-muted-foreground">Review and validate scope source data before pipeline entry</p>
      </div>

      {/* Project Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Project</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a project..." />
            </SelectTrigger>
            <SelectContent>
              {projectList.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedProjectId && !scopeSource && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No active scope source for this project. Create one from the Drawing Upload page.
          </CardContent>
        </Card>
      )}

      {scopeSource && (
        <>
          {/* Status Bar */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Source Type:</span>{" "}
                    <Badge variant="outline">{payload?.sourceType ?? "—"}</Badge>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Review Status:</span>{" "}
                    <Badge
                      variant={scopeSource.reviewStatus === "approved" ? "default" : "secondary"}
                      className={scopeSource.reviewStatus === "approved" ? "bg-green-600" : ""}
                    >
                      {scopeSource.reviewStatus}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Candidates:</span>{" "}
                    <span className="font-medium">{candidates.length}</span>
                  </div>
                  {openRfiCount > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {openRfiCount} Open RFI(s)
                    </Badge>
                  )}
                </div>

                {scopeSource.scopeDraftId && (
                  <Badge className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Finalized
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Confidence Summary */}
          {confidenceSummary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Confidence Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-4">
                  {["measured", "scaled", "assumed", "ai_extracted"].map((level) => (
                    <div key={level} className="text-center">
                      <Badge className={CONFIDENCE_COLORS[level]}>
                        {CONFIDENCE_LABELS[level]}
                      </Badge>
                      <p className="text-2xl font-bold mt-1">{(confidenceSummary as any)[level] ?? 0}</p>
                    </div>
                  ))}
                  <div className="text-center">
                    <Badge variant="outline">Overall</Badge>
                    <p className="text-2xl font-bold mt-1">
                      {((confidenceSummary as any).overall * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Assembly Candidates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assembly Candidates</CardTitle>
            </CardHeader>
            <CardContent>
              {candidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">No assembly candidates.</p>
              ) : (
                <div className="space-y-3">
                  {candidates.map((c: any, i: number) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg border border-border space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-sm">{c.assemblyName}</span>
                          <span className="text-xs text-muted-foreground ml-2">({c.source})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={CONFIDENCE_COLORS[c.confidence] ?? "bg-gray-500"}>
                            {CONFIDENCE_LABELS[c.confidence] ?? c.confidence}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingIndex(editingIndex === i ? null : i)}
                          >
                            <Edit3 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <span>Qty: <strong>{c.suggestedQuantity}</strong> {c.unit}</span>
                        {c.manualQuantity != null && (
                          <span className="text-muted-foreground">Manual: {c.manualQuantity}</span>
                        )}
                        {c.drawingQuantity != null && (
                          <span className="text-muted-foreground">Drawing: {c.drawingQuantity}</span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">{c.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* RFI Candidates */}
          {rfis && rfis.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" />
                  RFI Candidates ({rfis.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {rfis.map((rfi: any) => (
                    <div
                      key={rfi.id}
                      className="p-3 rounded-lg border border-border space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{rfi.category}</Badge>
                          <Badge
                            variant={rfi.status === "open" ? "destructive" : "secondary"}
                          >
                            {rfi.status}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm font-medium">{rfi.question}</p>
                      {rfi.context && (
                        <p className="text-xs text-muted-foreground">{rfi.context}</p>
                      )}
                      {rfi.resolution && (
                        <p className="text-sm text-green-400">Resolution: {rfi.resolution}</p>
                      )}

                      {rfi.status === "open" && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const answer = prompt("Resolution:", rfi.suggestedAnswer ?? "");
                              if (answer) {
                                resolveRfiMutation.mutate({ id: rfi.id, resolution: answer });
                              }
                            }}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Resolve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => dismissRfiMutation.mutate({ id: rfi.id })}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          {!scopeSource.scopeDraftId && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {scopeSource.reviewStatus !== "approved" && (
                      <Button
                        onClick={() => approveMutation.mutate({ id: scopeSource.id, reviewStatus: "approved" })}
                        disabled={openRfiCount > 0}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve Scope Source
                      </Button>
                    )}
                    {scopeSource.reviewStatus !== "rejected" && (
                      <Button
                        variant="destructive"
                        onClick={() => rejectMutation.mutate({ id: scopeSource.id, reviewStatus: "rejected" })}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    )}
                  </div>

                  {scopeSource.reviewStatus === "approved" && (
                    <Button
                      onClick={() => finalizeMutation.mutate({ scopeSourceId: scopeSource.id })}
                      disabled={finalizeMutation.isPending}
                    >
                      <ArrowRight className="h-4 w-4 mr-1" />
                      {finalizeMutation.isPending ? "Finalizing..." : "Finalize → Create Scope Draft"}
                    </Button>
                  )}
                </div>

                {openRfiCount > 0 && scopeSource.reviewStatus !== "approved" && (
                  <p className="text-xs text-destructive mt-2">
                    Resolve all open RFIs before approving.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
