/**
 * CostBreakdownTable — Sprint 8 Bundle Calculator
 *
 * Expandable cost breakdown per assembly showing:
 * - Assembly name, qty, unit cost, extended cost, GP%
 * - Expandable row: component-level detail (type, qty, unit cost, waste, adjusted, subtotal)
 * - Profit Shield badge per assembly
 *
 * Uses the actual AssemblyCostResult shape from assembly-engine.ts.
 */

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronRight,
  Shield,
  ShieldAlert,
  ShieldX,
  Trash2,
} from "lucide-react";
import { useState, useCallback } from "react";
import type { ProfitShieldStatus } from "@/hooks/useBundleCalculator";

// ══════════════════════════════════════════════════════════════════════
// TYPES — matches AssemblyCostResult & { quantity, extendedCost, extendedPrice }
// ══════════════════════════════════════════════════════════════════════

interface PricedComponent {
  componentId: number;
  componentType: string;
  description: string;
  quantity: number;
  unit: string;
  baseUnitCost: number;
  baseUnitPrice: number;
  wasteFactor: number;
  adjustedUnitCost: number;
  adjustedUnitPrice: number;
  lineTotalCost: number;
  lineTotalPrice: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
  priceBookItemId: number | null;
  priceBookItemName: string | null;
}

interface AssemblyRow {
  assemblyId: string;
  assemblyName: string;
  pricedComponents: PricedComponent[];
  totalDirectCost: number;
  totalSellPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
  componentCount: number;
  quantity: number;
  extendedCost: number;
  extendedPrice: number;
}

interface CostBreakdownTableProps {
  assemblies: AssemblyRow[];
  assemblyShields: Map<string, ProfitShieldStatus>;
  onRemove: (assemblyId: string) => void;
  onQuantityChange: (assemblyId: string, qty: number) => void;
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

function formatPct(val: number): string {
  return `${val.toFixed(1)}%`;
}

function ShieldIcon({ status }: { status: ProfitShieldStatus }) {
  if (status.level === "green")
    return <Shield className="h-3.5 w-3.5 text-emerald-400" />;
  if (status.level === "yellow")
    return <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />;
  return <ShieldX className="h-3.5 w-3.5 text-red-400" />;
}

function shieldColor(status: ProfitShieldStatus): string {
  if (status.level === "green") return "text-emerald-400";
  if (status.level === "yellow") return "text-amber-400";
  return "text-red-400";
}

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  material: "Material",
  labor: "Labor",
  equipment: "Equipment",
  subcontract: "Sub",
  permit: "Permit",
  admin: "Admin",
  other: "Other",
};

const COMPONENT_TYPE_COLORS: Record<string, string> = {
  material: "border-emerald-500/30 text-emerald-400",
  labor: "border-blue-500/30 text-blue-400",
  equipment: "border-purple-500/30 text-purple-400",
  subcontract: "border-amber-500/30 text-amber-400",
  permit: "border-rose-500/30 text-rose-400",
  admin: "border-cyan-500/30 text-cyan-400",
};

// ══════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════

export default function CostBreakdownTable({
  assemblies,
  assemblyShields,
  onRemove,
  onQuantityChange,
}: CostBreakdownTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (assemblies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-12 w-12 rounded-xl bg-gold-glow flex items-center justify-center mb-4">
          <Shield className="h-6 w-6 text-gold/50" />
        </div>
        <p className="text-sm text-muted-foreground">
          Select assemblies from the library to see cost breakdown
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="grid grid-cols-[1fr_70px_90px_90px_100px_100px_55px_32px] gap-2 px-3 py-2 text-[0.6rem] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
        <span>Assembly</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit Cost</span>
        <span className="text-right">Unit Price</span>
        <span className="text-right">Ext. Cost</span>
        <span className="text-right">Ext. Price</span>
        <span className="text-right">GP%</span>
        <span />
      </div>

      {/* Rows */}
      {assemblies.map((asm) => {
        const isExpanded = expanded.has(asm.assemblyId);
        const shield = assemblyShields.get(asm.assemblyId);

        return (
          <div key={asm.assemblyId} className="border-b border-border/50 last:border-b-0">
            {/* Assembly Row */}
            <div
              className={cn(
                "grid grid-cols-[1fr_70px_90px_90px_100px_100px_55px_32px] gap-2 px-3 py-2.5 items-center",
                "transition-colors duration-150",
                "hover:bg-surface-hover cursor-pointer",
                isExpanded && "bg-surface-hover"
              )}
              onClick={() => toggleExpand(asm.assemblyId)}
            >
              {/* Name + expand icon */}
              <div className="flex items-center gap-2 min-w-0">
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-gold shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                {shield && <ShieldIcon status={shield} />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {asm.assemblyName}
                  </p>
                  <p className="text-[0.6rem] text-muted-foreground">
                    {asm.componentCount} components
                  </p>
                </div>
              </div>

              {/* Qty */}
              <div className="text-right" onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  min={1}
                  value={asm.quantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1) onQuantityChange(asm.assemblyId, val);
                  }}
                  className="w-12 text-right text-sm font-mono bg-transparent border-b border-border text-foreground focus:outline-none focus:border-gold ml-auto block"
                />
              </div>

              {/* Unit Cost */}
              <span className="text-right text-sm font-mono text-foreground">
                {formatCurrency(asm.totalDirectCost)}
              </span>

              {/* Unit Price */}
              <span className="text-right text-sm font-mono text-foreground">
                {formatCurrency(asm.totalSellPrice)}
              </span>

              {/* Extended Cost */}
              <span className="text-right text-sm font-mono font-medium text-foreground">
                {formatCurrency(asm.extendedCost)}
              </span>

              {/* Extended Price */}
              <span className="text-right text-sm font-mono font-medium text-gold">
                {formatCurrency(asm.extendedPrice)}
              </span>

              {/* GP% */}
              <span
                className={cn(
                  "text-right text-sm font-mono font-bold",
                  shield ? shieldColor(shield) : "text-foreground"
                )}
              >
                {formatPct(asm.grossProfitPct)}
              </span>

              {/* Remove */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(asm.assemblyId);
                }}
                className="flex items-center justify-center h-7 w-7 rounded hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>

            {/* Expanded Component Detail */}
            {isExpanded && asm.pricedComponents && asm.pricedComponents.length > 0 && (
              <div className="bg-background/50 border-t border-border/30 px-4 py-2">
                <table className="w-full text-[0.7rem]">
                  <thead>
                    <tr className="text-muted-foreground uppercase tracking-wider">
                      <th className="text-left py-1 font-semibold">Component</th>
                      <th className="text-left py-1 font-semibold w-16">Type</th>
                      <th className="text-right py-1 font-semibold w-12">Qty</th>
                      <th className="text-right py-1 font-semibold w-20">Base Cost</th>
                      <th className="text-right py-1 font-semibold w-14">Waste</th>
                      <th className="text-right py-1 font-semibold w-20">Adj. Cost</th>
                      <th className="text-right py-1 font-semibold w-20">Line Total</th>
                      <th className="text-right py-1 font-semibold w-14">GP%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asm.pricedComponents.map((comp) => (
                      <tr
                        key={comp.componentId}
                        className="border-t border-border/20 text-foreground/80"
                      >
                        <td className="py-1.5">
                          <span className="font-medium">{comp.description}</span>
                          {comp.priceBookItemName && (
                            <span className="text-muted-foreground ml-2 text-[0.6rem]">
                              ({comp.priceBookItemName})
                            </span>
                          )}
                        </td>
                        <td className="py-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[0.55rem] px-1 py-0",
                              COMPONENT_TYPE_COLORS[comp.componentType] ?? "border-border text-muted-foreground"
                            )}
                          >
                            {COMPONENT_TYPE_LABELS[comp.componentType] ?? comp.componentType}
                          </Badge>
                        </td>
                        <td className="py-1.5 text-right font-mono">{comp.quantity}</td>
                        <td className="py-1.5 text-right font-mono">
                          {formatCurrency(comp.baseUnitCost)}
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {comp.wasteFactor > 1 ? formatPct((comp.wasteFactor - 1) * 100) : "—"}
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {formatCurrency(comp.adjustedUnitCost)}
                        </td>
                        <td className="py-1.5 text-right font-mono font-medium">
                          {formatCurrency(comp.lineTotalCost)}
                        </td>
                        <td className={cn(
                          "py-1.5 text-right font-mono",
                          comp.meetsMinGP ? "text-emerald-400" : "text-red-400"
                        )}>
                          {formatPct(comp.grossProfitPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
