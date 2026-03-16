/**
 * BundleSummaryPanel — Sprint 8 Bundle Calculator
 *
 * Displays:
 * - Grand totals (cost, price, profit)
 * - Profit Shield badge (green/yellow/red) with GP%
 * - Regional/Channel context summary
 * - Trade breakdown with progress bars
 * - Export button (blocked if any assembly is red)
 */

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Shield,
  ShieldAlert,
  ShieldX,
  MapPin,
  Radio,
  Sparkles,
  FileDown,
  TrendingUp,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { ProfitShieldStatus } from "@/hooks/useBundleCalculator";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

interface TradeEntry {
  trade: string;
  cost: number;
  pct: number;
}

interface BatchResult {
  assemblies: any[];
  totalCost: number;
  totalPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
}

interface BundleSummaryPanelProps {
  batchResult: BatchResult | null | undefined;
  profitShield: ProfitShieldStatus | null;
  tradeBreakdown: TradeEntry[];
  region: string | null;
  channel: string | null;
  finishLevel: string;
  calculating: boolean;
  recalculating: boolean;
  canExport: boolean;
  selectionCount: number;
  onExport: () => void;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function formatLargeCurrency(val: number): string {
  if (val >= 100_000) {
    return `$${(val / 1000).toFixed(1)}K`;
  }
  return formatCurrency(val);
}

const REGION_LABELS: Record<string, string> = {
  charleston_coastal: "Charleston Coastal",
  charleston_metro: "Charleston Metro",
  summerville_area: "Summerville Area",
  barrier_island: "Barrier Island",
};

const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct",
  insurance: "Insurance",
  commercial: "Commercial",
};

const FINISH_LABELS: Record<string, string> = {
  standard: "Standard",
  premium: "Premium",
  luxury: "Luxury",
};

// Trade colors for progress bars
const TRADE_COLORS = [
  "bg-gold",
  "bg-emerald-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-lime-500",
];

// ══════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════

export default function BundleSummaryPanel({
  batchResult,
  profitShield,
  tradeBreakdown,
  region,
  channel,
  finishLevel,
  calculating,
  recalculating,
  canExport,
  selectionCount,
  onExport,
}: BundleSummaryPanelProps) {
  // ── Empty State ──
  if (!batchResult && !calculating) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gold-glow flex items-center justify-center">
          <TrendingUp className="h-7 w-7 text-gold/40" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Bundle Summary</p>
          <p className="text-xs text-muted-foreground mt-1">
            {selectionCount === 0
              ? "Select assemblies and set region/channel to see pricing"
              : "Set region and channel to calculate pricing"}
          </p>
        </div>
      </div>
    );
  }

  // ── Loading State ──
  if (calculating && !batchResult) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
        <p className="text-xs text-muted-foreground">Calculating pricing...</p>
      </div>
    );
  }

  if (!batchResult) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* Recalculating indicator */}
      {recalculating && (
        <div className="flex items-center gap-2 text-xs text-gold animate-pulse">
          <Loader2 className="h-3 w-3 animate-spin" />
          Recalculating...
        </div>
      )}

      {/* ── Profit Shield Badge ── */}
      {profitShield && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border px-4 py-3",
            profitShield.level === "green" && "border-emerald-500/30 bg-emerald-500/5",
            profitShield.level === "yellow" && "border-amber-500/30 bg-amber-500/5",
            profitShield.level === "red" && "border-red-500/30 bg-red-500/5"
          )}
        >
          {profitShield.level === "green" && (
            <Shield className="h-8 w-8 text-emerald-400 shrink-0" />
          )}
          {profitShield.level === "yellow" && (
            <ShieldAlert className="h-8 w-8 text-amber-400 shrink-0" />
          )}
          {profitShield.level === "red" && (
            <ShieldX className="h-8 w-8 text-red-400 shrink-0" />
          )}
          <div>
            <p
              className={cn(
                "text-sm font-bold",
                profitShield.level === "green" && "text-emerald-400",
                profitShield.level === "yellow" && "text-amber-400",
                profitShield.level === "red" && "text-red-400"
              )}
            >
              Profit Shield:{" "}
              {profitShield.level === "green"
                ? "PROTECTED"
                : profitShield.level === "yellow"
                ? "WARNING"
                : "CRITICAL"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gross Profit: {profitShield.pct.toFixed(1)}%
              {profitShield.level === "green" && " — Above 35% floor"}
              {profitShield.level === "yellow" && " — Between 28-35%, review recommended"}
              {profitShield.level === "red" && " — Below 28% minimum, export blocked"}
            </p>
          </div>
        </div>
      )}

      {/* ── Grand Totals ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground">
            Total Cost
          </p>
          <p className="text-lg font-bold font-mono text-foreground mt-1">
            {formatLargeCurrency(batchResult.totalCost)}
          </p>
        </div>
        <div className="rounded-lg border border-gold/20 bg-gold-glow p-3">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-gold">
            Total Price
          </p>
          <p className="text-lg font-bold font-mono text-gold mt-1">
            {formatLargeCurrency(batchResult.totalPrice)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground">
            Gross Profit
          </p>
          <p
            className={cn(
              "text-lg font-bold font-mono mt-1",
              profitShield?.level === "green"
                ? "text-emerald-400"
                : profitShield?.level === "yellow"
                ? "text-amber-400"
                : "text-red-400"
            )}
          >
            {formatLargeCurrency(batchResult.grossProfit)}
          </p>
        </div>
      </div>

      {/* ── Context Summary ── */}
      <div className="flex flex-wrap gap-2">
        {region && (
          <Badge variant="outline" className="text-[0.65rem] border-gold/20 text-gold gap-1">
            <MapPin className="h-3 w-3" />
            {REGION_LABELS[region] ?? region}
          </Badge>
        )}
        {channel && (
          <Badge variant="outline" className="text-[0.65rem] border-gold/20 text-gold gap-1">
            <Radio className="h-3 w-3" />
            {CHANNEL_LABELS[channel] ?? channel}
          </Badge>
        )}
        <Badge variant="outline" className="text-[0.65rem] border-gold/20 text-gold gap-1">
          <Sparkles className="h-3 w-3" />
          {FINISH_LABELS[finishLevel] ?? finishLevel}
        </Badge>
        <Badge variant="outline" className="text-[0.65rem] border-border text-muted-foreground">
          {batchResult.assemblies.length} assemblies
        </Badge>
      </div>

      {/* ── Trade Breakdown ── */}
      {tradeBreakdown.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
              Cost by Trade
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>

          <div className="flex flex-col gap-2">
            {tradeBreakdown.map((entry, idx) => (
              <div key={entry.trade} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground font-medium">{entry.trade}</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {formatCurrency(entry.cost)}{" "}
                    <span className="text-[0.6rem]">({entry.pct}%)</span>
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-border/50 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      TRADE_COLORS[idx % TRADE_COLORS.length]
                    )}
                    style={{ width: `${Math.max(entry.pct, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Export Button ── */}
      <div className="pt-2 border-t border-border">
        {!canExport && profitShield?.level === "red" && (
          <div className="flex items-center gap-2 text-xs text-red-400 mb-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Export blocked — one or more assemblies have GP% below 28%. Adjust pricing or
              remove low-margin assemblies.
            </span>
          </div>
        )}
        <Button
          onClick={onExport}
          disabled={!canExport}
          className={cn(
            "w-full gap-2",
            canExport
              ? "bg-gold hover:bg-gold-dark text-background"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          <FileDown className="h-4 w-4" />
          Generate Estimate Draft
        </Button>
      </div>
    </div>
  );
}
