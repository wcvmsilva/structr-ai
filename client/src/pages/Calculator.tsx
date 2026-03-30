/**
 * Calculator Page — Sprint 8 Bundle Calculator UI
 *
 * Full-page assembly-based cost calculator with:
 * - Context selectors (region, channel, finish level)
 * - Assembly selector with category filter
 * - Cost breakdown table with expandable rows
 * - Summary panel with Profit Shield and trade breakdown
 * - Export to Estimate Draft
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { useBundleCalculator, REGION_OPTIONS, CHANNEL_OPTIONS, FINISH_OPTIONS } from "@/hooks/useBundleCalculator";
import AssemblySelector from "@/components/calculator/AssemblySelector";
import CostBreakdownTable from "@/components/calculator/CostBreakdownTable";
import BundleSummaryPanel from "@/components/calculator/BundleSummaryPanel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator as CalculatorIcon,
  MapPin,
  Radio,
  Sparkles,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import type { Region, Channel, FinishLevel } from "@/hooks/useBundleCalculator";

export default function CalculatorPage() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const calc = useBundleCalculator();

  // ── Export to Estimate Draft (Sprint 9) ──
  const createDraft = trpc.estimate.createFromCalculator.useMutation({
    onSuccess: (result: any) => {
      const warnings = result.warnings ?? [];
      if (warnings.length > 0) {
        toast.warning(
          `Estimate Draft #${result.draft.id} created with ${warnings.length} warning(s)`,
          { duration: 5000 }
        );
      } else {
        toast.success(
          `Estimate Draft #${result.draft.id} created — ${result.batchSummary.assemblyCount} assemblies, $${Number(result.draft.finalTotalPrice).toLocaleString()}`,
          { duration: 4000 }
        );
      }
      setTimeout(() => setLocation("/estimate"), 1500);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleExport = () => {
    if (!calc.batchResult || !calc.region || !calc.channel) return;
    if (!isAuthenticated) {
      toast.error("Please log in to export estimates");
      return;
    }
    if (createDraft.isPending) return;

    createDraft.mutate({
      selections: calc.selections.map((s) => ({
        assemblyId: s.assemblyId,
        quantity: s.quantity,
      })),
      context: {
        region: calc.region,
        channel: calc.channel as "direct" | "insurance" | "commercial",
        finishLevel: calc.finishLevel,
        notes: null,
      },
    });
  };

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gold-glow flex items-center justify-center">
              <CalculatorIcon className="h-5 w-5 text-gold" />
            </div>
            Bundle Calculator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select assemblies, set context, and calculate real-time pricing with Profit Shield
          </p>
        </div>
        {calc.selections.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              calc.clearSelections();
              toast.info("Selections cleared");
            }}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear All
          </Button>
        )}
      </div>

      {/* ── Context Selectors ── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[0.75rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
            Pricing Context
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Region */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3 w-3" />
              Region
            </label>
            <Select
              value={calc.region ?? ""}
              onValueChange={(v) => calc.setRegion(v as Region)}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder="Select region..." />
              </SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Channel */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Radio className="h-3 w-3" />
              Channel
            </label>
            <Select
              value={calc.channel ?? ""}
              onValueChange={(v) => calc.setChannel(v as Channel)}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder="Select channel..." />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Finish Level */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Finish Level
            </label>
            <Select
              value={calc.finishLevel}
              onValueChange={(v) => calc.setFinishLevel(v as FinishLevel)}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FINISH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!calc.contextReady && calc.selections.length > 0 && (
          <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Select both region and channel to enable pricing calculation
          </p>
        )}
      </div>

      {/* ── Main Layout: Two Columns ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 xl:gap-8">
        {/* Left Column — Assembly Selector */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4">
            <AssemblySelector
              assemblies={calc.assemblyList}
              loading={calc.assembliesLoading}
              categories={calc.categories.map((c: any) => typeof c === 'string' ? c : c.category).filter(Boolean)}
              activeCategory={calc.activeCategory}
              onCategoryChange={calc.setActiveCategory}
              isSelected={calc.isSelected}
              getQuantity={calc.getQuantity}
              onToggle={calc.toggleAssembly}
              onQuantityChange={calc.updateQuantity}
              selectionCount={calc.selections.length}
            />
          </div>
        </aside>

        {/* Right Column — Cost Breakdown + Summary */}
        <main className="flex flex-col gap-6">
          {/* Cost Breakdown Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <span className="text-[0.75rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
                Cost Breakdown
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
              {calc.calculating && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />
              )}
            </div>

            <CostBreakdownTable
              assemblies={calc.batchResult?.assemblies ?? []}
              assemblyShields={calc.assemblyShields}
              onRemove={calc.removeAssembly}
              onQuantityChange={calc.updateQuantity}
            />
          </div>

          {/* Summary Panel */}
          <div className="rounded-xl border border-border bg-card p-4">
            <BundleSummaryPanel
              batchResult={calc.batchResult}
              profitShield={calc.profitShield}
              tradeBreakdown={calc.tradeBreakdown}
              region={calc.region}
              channel={calc.channel}
              finishLevel={calc.finishLevel}
              calculating={calc.calculating}
              recalculating={calc.recalculating}
              canExport={calc.canExport}
              selectionCount={calc.selections.length}
              onExport={handleExport}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
