/**
 * Drawing Upload Page — TakeOff V1
 *
 * Project-level drawing management:
 * - Upload drawings (PDF/images)
 * - Manage revisions
 * - Create revision snapshots
 * - Navigate to scope source creation
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  Image,
  Trash2,
  CheckCircle,
  Clock,
  Camera,
} from "lucide-react";

const SHEET_TYPES = [
  { value: "floor_plan", label: "Floor Plan" },
  { value: "elevation", label: "Elevation" },
  { value: "section", label: "Section" },
  { value: "detail", label: "Detail" },
  { value: "site", label: "Site Plan" },
  { value: "other", label: "Other" },
] as const;

export default function DrawingUploadPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [uploadForm, setUploadForm] = useState({
    revisionLabel: "A",
    sheetLabel: "",
    sheetType: "" as string,
    notes: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const utils = trpc.useUtils();

  // Queries
  const { data: projectsData } = trpc.project.list.useQuery({});
  const projectList = (projectsData && "items" in projectsData ? projectsData.items : projectsData) ?? [];
  const { data: drawings, isLoading: drawingsLoading } = trpc.drawing.listByProject.useQuery(
    { projectId: selectedProjectId, activeOnly: false },
    { enabled: !!selectedProjectId }
  );
  const { data: snapshots } = trpc.drawing.listSnapshots.useQuery(
    { projectId: selectedProjectId },
    { enabled: !!selectedProjectId }
  );

  // Mutations
  const uploadMutation = trpc.drawing.upload.useMutation({
    onSuccess: () => {
      toast.success("Drawing uploaded successfully");
      utils.drawing.listByProject.invalidate({ projectId: selectedProjectId });
      setSelectedFile(null);
      setUploadForm({ revisionLabel: "A", sheetLabel: "", sheetType: "", notes: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.drawing.delete.useMutation({
    onSuccess: () => {
      toast.success("Drawing deleted");
      utils.drawing.listByProject.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const setActiveMutation = trpc.drawing.setActiveRevision.useMutation({
    onSuccess: () => {
      toast.success("Active revision updated");
      utils.drawing.listByProject.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const snapshotMutation = trpc.drawing.createSnapshot.useMutation({
    onSuccess: () => {
      toast.success("Revision snapshot created");
      utils.drawing.listSnapshots.invalidate({ projectId: selectedProjectId });
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !selectedProjectId) return;
    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "pdf";
        const fileType = ext === "jpeg" ? "jpg" : ext;

        uploadMutation.mutate({
          projectId: selectedProjectId,
          fileName: selectedFile.name,
          fileType: fileType as "pdf" | "png" | "jpg" | "tiff",
          fileBase64: base64,
          revisionLabel: uploadForm.revisionLabel,
          sheetLabel: uploadForm.sheetLabel || undefined,
          sheetType: (uploadForm.sheetType || undefined) as any,
          notes: uploadForm.notes || undefined,
        });
      };
      reader.readAsDataURL(selectedFile);
    } catch {
      toast.error("Failed to read file");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Drawing Upload</h1>
        <p className="text-muted-foreground">Upload construction drawings and manage revisions</p>
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
                  {p.name} — {p.address ?? "No address"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedProjectId && (
        <>
          {/* Upload Form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload Drawing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>File (PDF, PNG, JPG, TIFF — max 50MB)</Label>
                <Input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.tiff"
                  onChange={handleFileSelect}
                  className="mt-1"
                />
                {selectedFile && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(1)}MB)
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Revision Label</Label>
                  <Input
                    value={uploadForm.revisionLabel}
                    onChange={(e) => setUploadForm({ ...uploadForm, revisionLabel: e.target.value })}
                    placeholder="A"
                    maxLength={10}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Sheet Label</Label>
                  <Input
                    value={uploadForm.sheetLabel}
                    onChange={(e) => setUploadForm({ ...uploadForm, sheetLabel: e.target.value })}
                    placeholder="A1, S2, MEP-01..."
                    maxLength={20}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Sheet Type</Label>
                  <Select
                    value={uploadForm.sheetType}
                    onValueChange={(v) => setUploadForm({ ...uploadForm, sheetType: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SHEET_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Notes</Label>
                <Textarea
                  value={uploadForm.notes}
                  onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                  placeholder="Optional notes about this drawing..."
                  className="mt-1"
                  rows={2}
                />
              </div>

              <Button
                onClick={handleUpload}
                disabled={!selectedFile || uploading || uploadMutation.isPending}
              >
                {uploading || uploadMutation.isPending ? "Uploading..." : "Upload Drawing"}
              </Button>
            </CardContent>
          </Card>

          {/* Drawing List */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Drawings ({drawings?.length ?? 0})</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const label = prompt("Revision label for snapshot?", "Rev-A");
                  if (label) {
                    snapshotMutation.mutate({ projectId: selectedProjectId, revisionLabel: label });
                  }
                }}
                disabled={!drawings?.length}
              >
                <Camera className="h-3 w-3 mr-1" />
                Snapshot
              </Button>
            </CardHeader>
            <CardContent>
              {drawingsLoading ? (
                <p className="text-muted-foreground text-sm">Loading...</p>
              ) : !drawings?.length ? (
                <p className="text-muted-foreground text-sm">No drawings uploaded yet.</p>
              ) : (
                <div className="space-y-3">
                  {drawings.map((d: any) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border"
                    >
                      <div className="flex items-center gap-3">
                        {d.fileType === "pdf" ? (
                          <FileText className="h-5 w-5 text-red-400" />
                        ) : (
                          <Image className="h-5 w-5 text-blue-400" />
                        )}
                        <div>
                          <p className="font-medium text-sm">{d.fileName}</p>
                          <p className="text-xs text-muted-foreground">
                            Rev {d.revisionLabel}
                            {d.sheetLabel && ` · Sheet ${d.sheetLabel}`}
                            {d.sheetType && ` · ${d.sheetType.replace("_", " ")}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {d.isActiveRevision ? (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveMutation.mutate({ projectId: selectedProjectId, drawingId: d.id })}
                          >
                            Set Active
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("Delete this drawing?")) {
                              deleteMutation.mutate({ id: d.id });
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Snapshots */}
          {snapshots && snapshots.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revision Snapshots</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {snapshots.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between p-2 rounded border border-border">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{s.revisionLabel}</span>
                        <span className="text-xs text-muted-foreground">
                          {((s.drawingIds as string[]) ?? []).length} drawings
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
