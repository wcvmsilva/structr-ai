// Bundles Page — Persistent structr.ai with Preset Gallery + Send to Estimate
// Supports: create, load, save, rename, duplicate, delete, presets, estimate bridge

import AssemblyLibrary from "@/components/AssemblyLibrary";
import BundleCart from "@/components/BundleCart";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Package,
  Loader2,
  AlertCircle,
  Plus,
  FolderOpen,
  Save,
  Copy,
  Trash2,
  Pencil,
  Bookmark,
  BookmarkCheck,
  Send,
  Sparkles,
  Tag,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import type { CatalogItemView } from "@shared/catalog-utils";

// ── DEV Mode Configuration ──
// When enabled, provides mock catalog data in DEV to bypass backend auth requirement
const DEV_DISABLE_OAUTH = import.meta.env.DEV;

// Mock catalog data for DEV mode (bypasses backend auth requirement)
const DEV_MOCK_CATALOG: CatalogItemView[] = [
  {
    id: "1",
    costItemId: "PAINT-001",
    costGroupName: "Paint & Stain",
    costItemName: "Interior Paint - 1 gal",
    description: "Premium interior paint",
    unit: "gal",
    unitCost: "25.00",
    unitPrice: "45.00",
    margin: "44.44",
    costCode: "05",
    costType: "material",
    taxable: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "2",
    costItemId: "LABOR-001",
    costGroupName: "Labor",
    costItemName: "General Labor - per hour",
    description: "Skilled labor",
    unit: "hr",
    unitCost: "35.00",
    unitPrice: "85.00",
    margin: "58.82",
    costCode: "01",
    costType: "labor",
    taxable: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "3",
    costItemId: "FLOORING-001",
    costGroupName: "Flooring",
    costItemName: "Hardwood Flooring - sq ft",
    description: "Premium hardwood",
    unit: "sq ft",
    unitCost: "4.50",
    unitPrice: "12.00",
    margin: "62.50",
    costCode: "09",
    costType: "material",
    taxable: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "4",
    costItemId: "FIXTURE-001",
    costGroupName: "Fixtures & Hardware",
    costItemName: "Light Fixture - Ceiling",
    description: "Standard ceiling fixture",
    unit: "ea",
    unitCost: "18.00",
    unitPrice: "65.00",
    margin: "72.31",
    costCode: "12",
    costType: "material",
    taxable: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const DEV_MOCK_GROUPS = [
  { costGroupName: "Paint & Stain", costCode: "05", count: 1 },
  { costGroupName: "Labor", costCode: "01", count: 1 },
  { costGroupName: "Flooring", costCode: "09", count: 1 },
  { costGroupName: "Fixtures & Hardware", costCode: "12", count: 1 },
];

type BundleItemLocal = {
  bundleItemId: string;
  catalogItemId: string;
  quantity: number;
  unitCostSnapshot: string;
  unitPriceSnapshot: string;
  catalogItem: CatalogItemView | null;
};

export default function BundlesPage() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();

  // ── State ──
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPresetGallery, setShowPresetGallery] = useState(false);
  const [showMarkPresetDialog, setShowMarkPresetDialog] = useState(false);
  const [showSendToEstimateDialog, setShowSendToEstimateDialog] = useState(false);
  const [newBundleName, setNewBundleName] = useState("");
  const [renameName, setRenameName] = useState("");
  const [presetCategory, setPresetCategory] = useState("");
  const [presetTags, setPresetTags] = useState("");
  const [estimateDiscount, setEstimateDiscount] = useState<string | null>(null);
  const [estimateNotes, setEstimateNotes] = useState("");

  // ── Queries ──
  // In DEV mode, use mock catalog data to bypass backend auth requirement
  const { data: catalogItems, isLoading: catalogLoading, error: catalogError } = trpc.catalog.list.useQuery(undefined, {
    initialData: DEV_DISABLE_OAUTH ? DEV_MOCK_CATALOG as any : undefined,
    retry: DEV_DISABLE_OAUTH ? 1 : 3, // Faster retries in DEV mode
  });
  const { data: groups } = trpc.catalog.groups.useQuery(undefined, {
    initialData: DEV_DISABLE_OAUTH ? DEV_MOCK_GROUPS as any : undefined,
    retry: DEV_DISABLE_OAUTH ? 1 : 3,
  });
  const { data: savedBundles, isLoading: bundlesLoading } = trpc.bundle.list.useQuery(
    { activeOnly: true },
    { enabled: isAuthenticated }
  );
  const { data: presets, isLoading: presetsLoading } = trpc.preset.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const {
    data: activeBundle,
    isLoading: bundleLoading,
    refetch: refetchBundle,
  } = trpc.bundle.getById.useQuery(
    { id: activeBundleId! },
    { enabled: activeBundleId !== null }
  );

  // ── Mutations ──
  const createBundle = trpc.bundle.create.useMutation({
    onSuccess: (bundle: any) => {
      setActiveBundleId(bundle.id);
      utils.bundle.list.invalidate();
      toast.success(`Bundle "${bundle.name}" created`);
    },
    onError: (err) => toast.error(err.message),
  });

  const addItem = trpc.bundle.addItem.useMutation({
    onSuccess: () => {
      refetchBundle();
      utils.bundle.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeItem = trpc.bundle.removeItem.useMutation({
    onSuccess: () => {
      refetchBundle();
      utils.bundle.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateQty = trpc.bundle.updateItemQuantity.useMutation({
    onSuccess: () => {
      refetchBundle();
      utils.bundle.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMeta = trpc.bundle.updateMeta.useMutation({
    onSuccess: (bundle: any) => {
      refetchBundle();
      utils.bundle.list.invalidate();
      toast.success(`Bundle renamed to "${bundle.name}"`);
    },
    onError: (err) => toast.error(err.message),
  });

  const duplicateBundle = trpc.bundle.duplicate.useMutation({
    onSuccess: (bundle: any) => {
      setActiveBundleId(bundle.id);
      utils.bundle.list.invalidate();
      toast.success(`Bundle duplicated as "${bundle.name}"`);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteBundle = trpc.bundle.delete.useMutation({
    onSuccess: () => {
      setActiveBundleId(null);
      utils.bundle.list.invalidate();
      toast.success("Bundle deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Preset Mutations ──
  const createPresetFromBundle = trpc.preset.createFromBundle.useMutation({
    onSuccess: (preset: any) => {
      utils.preset.list.invalidate();
      toast.success(`Preset "${preset?.name}" created from bundle`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createBundleFromPreset = trpc.preset.createBundleFromPreset.useMutation({
    onSuccess: (bundle: any) => {
      setActiveBundleId(bundle?.id);
      utils.bundle.list.invalidate();
      setShowPresetGallery(false);
      toast.success(`Working bundle "${bundle?.name}" created from preset`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deletePreset = trpc.preset.delete.useMutation({
    onSuccess: () => {
      utils.preset.list.invalidate();
      toast.success("Preset deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Estimate Mutation ──
  const sendToEstimate = trpc.estimateLegacy.sendBundleToEstimate.useMutation({
    onSuccess: (draft) => {
      setShowSendToEstimateDialog(false);
      toast.success(`Estimate Draft #${draft.id} created — redirecting...`, {
        duration: 3000,
      });
      setTimeout(() => setLocation("/estimate"), 1500);
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Derived Data ──
  const selectedIds = useMemo(() => {
    if (!activeBundle?.items) return [];
    return activeBundle?.items.map((i: any) => i.catalogItemId);
  }, [activeBundle]);

  const bundleItemsLocal: BundleItemLocal[] = useMemo(() => {
    if (!activeBundle?.items) return [];
    return activeBundle?.items.map((item: any) => ({
      bundleItemId: item.id,
      catalogItemId: item.catalogItemId,
      quantity: parseFloat(item.quantity),
      unitCostSnapshot: item.unitCostSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot,
      catalogItem: item.catalogItem as CatalogItemView | null,
    }));
  }, [activeBundle]);

  const groupedItems = useMemo(() => {
    if (!catalogItems || !groups) return [];
    return groups.map((g: any) => ({
      name: g.costGroupName ?? g.name,
      costCode: g.costCode ?? g.code,
      items: catalogItems.filter((item: any) => (item.costGroupName ?? item.name) === (g.costGroupName ?? g.name)),
    }));
  }, [catalogItems, groups]);

  // ── Handlers ──
  const handleToggleItem = useCallback(
    (catalogItemId: string) => {
      if (!activeBundleId) {
        toast.error("Create or load a bundle first");
        return;
      }
      if (!isAuthenticated) {
        toast.error("Please log in to modify bundles");
        return;
      }
      const existing = activeBundle?.items.find((i) => (i as any).catalogItemId === catalogItemId);
      if (existing) {
        removeItem.mutate({ bundleItemId: existing.id });
      } else {
        addItem.mutate({ bundleId: activeBundleId, catalogItemId, quantity: 1 } as any);
      }
    },
    [activeBundleId, activeBundle, addItem, removeItem, isAuthenticated]
  );

  const handleRemoveItem = useCallback(
    (bundleItemId: string) => {
      removeItem.mutate({ bundleItemId });
    },
    [removeItem]
  );

  const handleUpdateQty = useCallback(
    (bundleItemId: string, qty: number) => {
      updateQty.mutate({ bundleItemId, quantity: qty } as any);
    },
    [updateQty]
  );

  const handleCreateBundle = () => {
    if (!newBundleName.trim()) return;
    createBundle.mutate({ name: newBundleName.trim() });
    setNewBundleName("");
    setShowCreateDialog(false);
  };

  const handleRename = () => {
    if (!activeBundleId || !renameName.trim()) return;
    updateMeta.mutate({ id: activeBundleId, name: renameName.trim() });
    setShowRenameDialog(false);
  };

  const handleDuplicate = () => {
    if (!activeBundleId || !activeBundle) return;
    duplicateBundle.mutate({
      bundleId: activeBundleId,
      newName: `${activeBundle?.name} (Copy)`,
    });
  };

  const handleDelete = () => {
    if (!activeBundleId) return;
    deleteBundle.mutate({ bundleId: activeBundleId });
    setShowDeleteConfirm(false);
  };

  const handleLoadBundle = (id: string) => {
    setActiveBundleId(id);
    setShowLoadDialog(false);
  };

  const handleMarkAsPreset = () => {
    if (!activeBundleId) return;
    const tags = presetTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    createPresetFromBundle.mutate({
      bundleId: activeBundleId,
      presetCategory: presetCategory.trim() || undefined,
      presetTags: tags.length > 0 ? tags : undefined,
    });
    setShowMarkPresetDialog(false);
    setPresetCategory("");
    setPresetTags("");
  };

  const handleLoadPreset = (presetId: string, presetName: string) => {
    const bundleName = `${presetName} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    createBundleFromPreset.mutate({ presetId, bundleName } as any);
  };

  const handleSendToEstimate = () => {
    if (!activeBundleId) return;
    sendToEstimate.mutate({
      bundleId: activeBundleId,
      discount: estimateDiscount != null ? Number(estimateDiscount) : undefined,
      notes: estimateNotes.trim() || undefined,
    });
  };

  // ── Loading / Error ──
  if (catalogLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
        <p className="text-sm text-muted-foreground">Loading catalog from database...</p>
      </div>
    );
  }

  // In DEV mode with fallback data, show page even if there's an error
  if (catalogError && !catalogItems) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-400">Failed to load catalog: {catalogError.message}</p>
        {DEV_DISABLE_OAUTH && (
          <p className="text-[0.7rem] text-gold mt-2">💡 DEV: Using mock catalog data</p>
        )}
      </div>
    );
  }

  // Show warning if DEV mode is active
  const devWarning = DEV_DISABLE_OAUTH && catalogError && catalogItems ? (
    <div className="mb-4 rounded-lg border border-gold/30 bg-gold-glow/5 p-3 px-4">
      <p className="text-[0.75rem] text-gold-dark">
        ⚠️ DEV: Using mock catalog data (backend auth bypass active)
      </p>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-gold" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            structr.ai
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-9">
          {catalogItems?.length ?? 0} catalog items from Master Price Book — Charleston, SC — 2026
        </p>
        <div className="h-[2px] w-48 mt-3 ml-9 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
      </div>

      {/* DEV Mode Warning */}
      {devWarning}

      {/* Bundle Toolbar */}
      <div className="flex flex-wrap items-center gap-2 ml-9">
        {/* Live Data Badge */}
        <div className="flex items-center gap-2 mr-auto">
          <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[0.72rem] font-medium text-green-400/80 tracking-wide">
            LIVE — {catalogItems?.length} items · {groups?.length} groups
          </span>
        </div>

        {/* Bundle Actions */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
          onClick={() => setShowCreateDialog(true)}
          disabled={!isAuthenticated}
        >
          <Plus className="h-3.5 w-3.5" />
          New Bundle
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-border text-muted-foreground hover:text-foreground"
          onClick={() => setShowLoadDialog(true)}
          disabled={!isAuthenticated || !savedBundles?.length}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Load
          {savedBundles && savedBundles.length > 0 && (
            <span className="ml-1 rounded-full bg-gold/20 px-1.5 py-0.5 text-[0.6rem] font-bold text-gold">
              {savedBundles.length}
            </span>
          )}
        </Button>

        {/* Preset Gallery Button */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"
          onClick={() => setShowPresetGallery(true)}
          disabled={!isAuthenticated}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Presets
          {presets && presets.length > 0 && (
            <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[0.6rem] font-bold text-amber-400">
              {presets.length}
            </span>
          )}
        </Button>

        {activeBundleId && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-border text-muted-foreground hover:text-foreground"
              onClick={() => {
                setRenameName(activeBundle?.name ?? "");
                setShowRenameDialog(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-border text-muted-foreground hover:text-foreground"
              onClick={handleDuplicate}
              disabled={duplicateBundle.isPending}
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"
              onClick={() => setShowMarkPresetDialog(true)}
              disabled={!activeBundle?.items?.length}
            >
              <Bookmark className="h-3.5 w-3.5" />
              Save as Preset
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </>
        )}
      </div>

      {/* Active Bundle Indicator */}
      {activeBundle && (
        <div className="ml-9 flex items-center gap-2 rounded-lg bg-gold-glow border border-gold/25 px-3 py-2">
          <Save className="h-4 w-4 text-gold" />
          <span className="text-sm font-semibold text-gold">
            {activeBundle?.name}
          </span>
          <span className="text-xs text-muted-foreground">
            · {(activeBundle as any)?.itemCount} items · Auto-saved
          </span>
          {(activeBundle as any)?.isPreset && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[0.6rem] font-bold text-amber-400">
              <BookmarkCheck className="h-3 w-3" />
              PRESET
            </span>
          )}
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 xl:gap-8">
        {/* Left Column — Assembly Library */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <AssemblyLibrary
            groups={groupedItems as any}
            selectedIds={selectedIds}
            onToggle={handleToggleItem}
          />
        </aside>

        {/* Right Column — Bundle Cart */}
        <main>
          {!activeBundleId ? (
            <NoActiveBundle
              onCreateNew={() => setShowCreateDialog(true)}
              onLoadExisting={() => setShowLoadDialog(true)}
              onBrowsePresets={() => setShowPresetGallery(true)}
              hasSavedBundles={!!savedBundles?.length}
              hasPresets={!!presets?.length}
              isAuthenticated={isAuthenticated}
            />
          ) : bundleLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-gold" />
              <p className="text-sm text-muted-foreground">Loading bundle...</p>
            </div>
          ) : (
            <>
              <BundleCart
                bundleName={activeBundle?.name ?? "Untitled"}
                items={bundleItemsLocal}
                defaultDiscount={parseFloat((activeBundle as any)?.defaultDiscount ?? activeBundle?.bundleDiscount ?? "8.00")}
                onRemoveItem={handleRemoveItem}
                onUpdateQuantity={handleUpdateQty}
                isUpdating={updateQty.isPending || removeItem.isPending || addItem.isPending}
              />

              {/* Send to Estimate Button — below the cart */}
              {bundleItemsLocal.length > 0 && (
                <div className="mt-5">
                  <button
                    onClick={() => {
                      setEstimateDiscount(null);
                      setEstimateNotes("");
                      setShowSendToEstimateDialog(true);
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2.5 w-full rounded-xl py-3.5 px-6",
                      "bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400",
                      "text-white font-bold text-base tracking-wide",
                      "transition-all duration-300",
                      "hover:shadow-[0_6px_25px_rgba(16,185,129,0.3)]",
                      "hover:-translate-y-0.5",
                      "active:translate-y-0"
                    )}
                  >
                    <Send className="h-5 w-5" />
                    Send to Estimate
                  </button>
                  <p className="text-center text-xs text-muted-foreground/60 mt-2">
                    Transform this bundle into a typed Estimate Draft with Profit Shield applied
                  </p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ── Dialogs ── */}

      {/* Create Bundle Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create New Bundle</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Bundle name (e.g., Kitchen Remodel Package)"
              value={newBundleName}
              onChange={(e) => setNewBundleName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBundle()}
              className="bg-background border-border text-foreground"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateBundle}
              disabled={!newBundleName.trim() || createBundle.isPending}
              className="bg-gold text-background hover:bg-gold-light"
            >
              {createBundle.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Bundle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Bundle Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Rename Bundle</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="New bundle name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              className="bg-background border-border text-foreground"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={!renameName.trim() || updateMeta.isPending}
              className="bg-gold text-background hover:bg-gold-light"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Bundle Dialog */}
      <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Load Saved Bundle</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Select a working bundle to continue editing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-[400px] overflow-y-auto">
            {bundlesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gold" />
              </div>
            ) : !savedBundles?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No saved bundles yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {savedBundles.map((bundle) => (
                  <button
                    key={bundle.id}
                    onClick={() => handleLoadBundle(bundle.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left",
                      "transition-all duration-200 hover:border-gold/30 hover:bg-surface-hover",
                      activeBundleId === bundle.id && "border-gold/40 bg-gold-glow"
                    )}
                  >
                    <Package className="h-5 w-5 text-gold shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {bundle.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(bundle as any).itemCount} items · ${parseFloat((bundle as any).totalPrice ?? "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <span className="text-[0.65rem] text-muted-foreground/60">
                      {new Date(bundle.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Bundle</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete <strong className="text-foreground">{activeBundle?.name}</strong>?
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteBundle.isPending}
            >
              {deleteBundle.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete Bundle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preset Gallery Dialog ── */}
      <Dialog open={showPresetGallery} onOpenChange={setShowPresetGallery}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-400" />
              Preset Bundle Gallery
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Start from a preset template. A new working bundle will be created — fully independent and editable.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-[450px] overflow-y-auto">
            {presetsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
              </div>
            ) : !presets?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bookmark className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No presets yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
                  Create a bundle, add items, then click "Save as Preset" to build your template library.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(presets as any[]).map((preset) => (
                  <div
                    key={preset.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3",
                      "transition-all duration-200 hover:border-amber-500/40 hover:bg-amber-500/10 group"
                    )}
                  >
                    <BookmarkCheck className="h-5 w-5 text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {preset.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {preset.itemCount} items · ${parseFloat(preset.totalPrice ?? "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                        {preset.presetCategory && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-400">
                            <Tag className="h-2.5 w-2.5" />
                            {preset.presetCategory}
                          </span>
                        )}
                      </div>
                      {preset.description && (
                        <p className="text-[0.7rem] text-muted-foreground/70 mt-1 line-clamp-2">
                          {preset.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        className="gap-1.5 bg-amber-500 text-background hover:bg-amber-400 text-xs"
                        onClick={() => handleLoadPreset(preset.id, preset.name)}
                        disabled={createBundleFromPreset.isPending}
                      >
                        {createBundleFromPreset.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ArrowRight className="h-3 w-3" />
                        )}
                        Use
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 border-red-500/30 text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          if (confirm(`Delete preset "${preset.name}"?`)) {
                            deletePreset.mutate({ bundleId: preset.id });
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Mark as Preset Dialog ── */}
      <Dialog open={showMarkPresetDialog} onOpenChange={setShowMarkPresetDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Bookmark className="h-5 w-5 text-amber-400" />
              Save as Preset
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a reusable preset template from "{activeBundle?.name}". The original bundle remains unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Category (optional)
              </label>
              <Input
                placeholder="e.g., Kitchen, Bathroom, Exterior"
                value={presetCategory}
                onChange={(e) => setPresetCategory(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Tags (optional, comma-separated)
              </label>
              <Input
                placeholder="e.g., standard, premium, budget"
                value={presetTags}
                onChange={(e) => setPresetTags(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMarkPresetDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMarkAsPreset}
              disabled={createPresetFromBundle.isPending}
              className="bg-amber-500 text-background hover:bg-amber-400"
            >
              {createPresetFromBundle.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Bookmark className="h-4 w-4 mr-2" />
              )}
              Save as Preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send to Estimate Dialog ── */}
      <Dialog open={showSendToEstimateDialog} onOpenChange={setShowSendToEstimateDialog}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Send className="h-5 w-5 text-emerald-400" />
              Send to Estimate
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Transform "{activeBundle?.name}" into a typed Estimate Draft. Profit Shield will be applied.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            {/* Bundle Summary */}
            <div className="rounded-lg bg-background border border-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <Package className="h-4 w-4 text-gold" />
                <span className="text-sm font-semibold text-foreground">{activeBundle?.name}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[0.65rem] text-muted-foreground">Items</p>
                  <p className="text-sm font-bold text-foreground">{(activeBundle as any)?.itemCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-[0.65rem] text-muted-foreground">Total Cost</p>
                  <p className="text-sm font-bold text-foreground">
                    ${parseFloat((activeBundle as any)?.totalCost ?? "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-[0.65rem] text-muted-foreground">Total Price</p>
                  <p className="text-sm font-bold text-gold">
                    ${parseFloat((activeBundle as any)?.totalPrice ?? "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>

            {/* Optional Discount Override */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Discount Override (optional, %)
              </label>
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                placeholder={`Default: ${(activeBundle as any)?.defaultDiscount ?? activeBundle?.bundleDiscount ?? "8.00"}%`}
                value={estimateDiscount ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    setEstimateDiscount(null);
                    return;
                  }
                  const num = parseFloat(val);
                  if (!isNaN(num)) setEstimateDiscount(String(Math.min(50, Math.max(0, num))));
                }}
                className="bg-background border-border text-foreground font-mono"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Notes (optional)
              </label>
              <textarea
                placeholder="Any notes for this estimate draft..."
                value={estimateNotes}
                onChange={(e) => setEstimateNotes(e.target.value)}
                rows={3}
                className={cn(
                  "w-full rounded-lg border border-border bg-background px-3 py-2",
                  "text-sm text-foreground placeholder:text-muted-foreground/60",
                  "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30",
                  "resize-none"
                )}
              />
            </div>

            {/* Profit Shield Notice */}
            <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-400">
                Profit Shield (35% GP floor) will be automatically applied. All line items, quantities, and price snapshots will be preserved in the Estimate Draft.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendToEstimateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendToEstimate}
              disabled={sendToEstimate.isPending}
              className="bg-emerald-500 text-white hover:bg-emerald-400"
            >
              {sendToEstimate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Create Estimate Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── No Active Bundle Placeholder ──
function NoActiveBundle({
  onCreateNew,
  onLoadExisting,
  onBrowsePresets,
  hasSavedBundles,
  hasPresets,
  isAuthenticated,
}: {
  onCreateNew: () => void;
  onLoadExisting: () => void;
  onBrowsePresets: () => void;
  hasSavedBundles: boolean;
  hasPresets: boolean;
  isAuthenticated: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
          Bundle Summary — The structr.ai Cart
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
      </div>

      <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border bg-card/50">
        <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <p className="text-base font-medium text-muted-foreground">
          {isAuthenticated ? "No active bundle" : "Log in to create bundles"}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground/60 max-w-xs">
          {isAuthenticated
            ? "Create a new bundle, load an existing one, or start from a preset template."
            : "Authentication is required to create and manage persistent bundles."}
        </p>

        {isAuthenticated && (
          <div className="flex flex-wrap gap-3 mt-6 justify-center">
            <Button
              onClick={onCreateNew}
              className="gap-2 bg-gold text-background hover:bg-gold-light"
            >
              <Plus className="h-4 w-4" />
              New Bundle
            </Button>
            {hasSavedBundles && (
              <Button
                variant="outline"
                onClick={onLoadExisting}
                className="gap-2 border-border text-muted-foreground hover:text-foreground"
              >
                <FolderOpen className="h-4 w-4" />
                Load Existing
              </Button>
            )}
            {hasPresets && (
              <Button
                variant="outline"
                onClick={onBrowsePresets}
                className="gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"
              >
                <Sparkles className="h-4 w-4" />
                Browse Presets
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
