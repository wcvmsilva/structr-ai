/**
 * useBundleCalculator — Sprint 8 Bundle Calculator Hook
 *
 * Encapsulates all state management and tRPC calls for the Bundle Calculator UI.
 * Manages: assembly selection, quantity, region/channel/finish context,
 * real-time cost calculation via assembly.calculateBatch, and estimate draft export.
 *
 * All calculations are deterministic and idempotent — same inputs = same outputs.
 * No side effects during calculation (no DB writes).
 */

import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export type Region =
  | "charleston_coastal"
  | "charleston_metro"
  | "summerville_area"
  | "barrier_island";

export type Channel = "direct" | "insurance" | "commercial";
export type FinishLevel = "standard" | "premium" | "luxury";

export interface SelectedAssembly {
  assemblyId: number;
  quantity: number;
}

export interface ProfitShieldStatus {
  level: "green" | "yellow" | "red";
  pct: number;
}

export const REGION_OPTIONS: { value: Region; label: string }[] = [
  { value: "charleston_coastal", label: "Charleston Coastal" },
  { value: "charleston_metro", label: "Charleston Metro / Inland" },
  { value: "summerville_area", label: "Summerville / Goose Creek / Ladson" },
  { value: "barrier_island", label: "Barrier Island Premium" },
];

export const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "insurance", label: "Insurance" },
  { value: "commercial", label: "Commercial" },
];

export const FINISH_OPTIONS: { value: FinishLevel; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
  { value: "luxury", label: "Luxury" },
];

/** Derive Profit Shield status from GP% */
export function getProfitShieldStatus(gpPct: number): ProfitShieldStatus {
  if (gpPct >= 35) return { level: "green", pct: gpPct };
  if (gpPct >= 28) return { level: "yellow", pct: gpPct };
  return { level: "red", pct: gpPct };
}

// ══════════════════════════════════════════════════════════════════════
// HOOK
// ══════════════════════════════════════════════════════════════════════

export function useBundleCalculator() {
  // ── Context State ──
  const [region, setRegion] = useState<Region | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [finishLevel, setFinishLevel] = useState<FinishLevel>("standard");

  // ── Selection State ──
  const [selections, setSelections] = useState<SelectedAssembly[]>([]);

  // ── Category Filter ──
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // ── Queries ──
  const { data: assemblies, isLoading: assembliesLoading } =
    trpc.assembly.list.useQuery(
      activeCategory ? { category: activeCategory, activeOnly: true } : { activeOnly: true },
      { staleTime: 60_000 }
    );

  const { data: categories } = trpc.assembly.categories.useQuery(undefined, {
    staleTime: 120_000,
  });

  // ── Batch Calculate Query ──
  // Only runs when we have selections AND both region and channel are set
  const canCalculate = selections.length > 0 && region !== null && channel !== null;

  const batchInput = useMemo(() => {
    if (!canCalculate) return undefined;
    return {
      assemblies: selections.map((s) => ({
        assemblyId: s.assemblyId,
        quantity: s.quantity,
      })),
      region: region!,
      channel: channel!,
      finishLevel,
    };
  }, [canCalculate, selections, region, channel, finishLevel]);

  const {
    data: batchResult,
    isLoading: calculating,
    isFetching: recalculating,
  } = trpc.assembly.calculateBatch.useQuery(batchInput!, {
    enabled: !!batchInput,
    staleTime: 0, // Always recalculate on param change
    refetchOnWindowFocus: false,
  });

  // ── Derived: Trade Breakdown ──
  const tradeBreakdown = useMemo(() => {
    if (!batchResult?.assemblies) return [];

    const tradeMap = new Map<string, number>();

    for (const asm of batchResult.assemblies) {
      // Get the trade from the assembly data in the list
      const assemblyData = (assemblies as any)?.items?.find((a: any) => a.id === asm.assemblyId);
      const trade = assemblyData?.trade ?? assemblyData?.category ?? "General";
      const current = tradeMap.get(trade) ?? 0;
      tradeMap.set(trade, current + asm.extendedCost);
    }

    const total = batchResult.totalCost;
    const entries = Array.from(tradeMap.entries())
      .map(([trade, cost]) => ({
        trade,
        cost: Math.round(cost * 100) / 100,
        pct: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.cost - a.cost);

    return entries;
  }, [batchResult, assemblies]);

  // ── Derived: Profit Shield ──
  const profitShield = useMemo<ProfitShieldStatus | null>(() => {
    if (!batchResult) return null;
    return getProfitShieldStatus(batchResult.grossProfitPct);
  }, [batchResult]);

  // ── Per-assembly Profit Shield ──
  const assemblyShields = useMemo(() => {
    if (!batchResult?.assemblies) return new Map<number, ProfitShieldStatus>();
    const map = new Map<number, ProfitShieldStatus>();
    for (const asm of batchResult.assemblies) {
      map.set(asm.assemblyId, getProfitShieldStatus(asm.grossProfitPct));
    }
    return map;
  }, [batchResult]);

  // ── Can Export ──
  const canExport = useMemo(() => {
    if (!batchResult || !profitShield) return false;
    // Block if ANY assembly has red shield
    for (const asm of batchResult.assemblies) {
      if (asm.grossProfitPct < 28) return false;
    }
    return true;
  }, [batchResult, profitShield]);

  // ── Selection Handlers ──
  const toggleAssembly = useCallback((assemblyId: number) => {
    setSelections((prev) => {
      const exists = prev.find((s) => s.assemblyId === assemblyId);
      if (exists) {
        return prev.filter((s) => s.assemblyId !== assemblyId);
      }
      if (prev.length >= 25) {
        toast.error("Maximum 25 assemblies allowed");
        return prev;
      }
      return [...prev, { assemblyId, quantity: 1 }];
    });
  }, []);

  const updateQuantity = useCallback((assemblyId: number, quantity: number) => {
    if (quantity < 1) return;
    if (!Number.isInteger(quantity)) return;
    setSelections((prev) =>
      prev.map((s) => (s.assemblyId === assemblyId ? { ...s, quantity } : s))
    );
  }, []);

  const removeAssembly = useCallback((assemblyId: number) => {
    setSelections((prev) => prev.filter((s) => s.assemblyId !== assemblyId));
  }, []);

  const clearSelections = useCallback(() => {
    setSelections([]);
  }, []);

  const isSelected = useCallback(
    (assemblyId: number) => selections.some((s) => s.assemblyId === assemblyId),
    [selections]
  );

  const getQuantity = useCallback(
    (assemblyId: number) => selections.find((s) => s.assemblyId === assemblyId)?.quantity ?? 0,
    [selections]
  );

  // ── Context Validity ──
  const contextReady = region !== null && channel !== null;

  return {
    // Context
    region,
    setRegion,
    channel,
    setChannel,
    finishLevel,
    setFinishLevel,
    contextReady,

    // Category
    activeCategory,
    setActiveCategory,
    categories: categories ?? [],

    // Assemblies
    assemblyList: (assemblies as any)?.items ?? [],
    assembliesTotal: (assemblies as any)?.total ?? 0,
    assembliesLoading,

    // Selections
    selections,
    toggleAssembly,
    updateQuantity,
    removeAssembly,
    clearSelections,
    isSelected,
    getQuantity,

    // Calculation
    canCalculate,
    calculating,
    recalculating,
    batchResult,

    // Derived
    tradeBreakdown,
    profitShield,
    assemblyShields,
    canExport,
  };
}
