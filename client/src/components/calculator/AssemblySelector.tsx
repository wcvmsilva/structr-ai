/**
 * AssemblySelector — Sprint 8 Bundle Calculator
 *
 * Displays assemblies filtered by category with selection checkboxes
 * and quantity controls. Supports up to 25 simultaneous assemblies.
 */

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  ChefHat,
  Bath,
  Layers,
  Paintbrush,
  Zap,
  Droplets,
  Wind,
  Home,
  Wrench,
  Check,
  Minus,
  Plus,
  Loader2,
  Search,
  Package,
} from "lucide-react";
import { useState, useMemo } from "react";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

interface AssemblyItem {
  id: string;
  name: string;
  code: string;
  category: string | null;
  trade: string | null;
  assemblyType: string | null;
  finishLevel: string | null;
  description: string | null;
  unitOfMeasure: string | null;
  directCost: string;
  sellPrice: string;
}

interface AssemblySelectorProps {
  assemblies: AssemblyItem[];
  loading: boolean;
  categories: string[];
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  isSelected: (id: string) => boolean;
  getQuantity: (id: string) => number;
  onToggle: (id: string) => void;
  onQuantityChange: (id: string, qty: number) => void;
  selectionCount: number;
}

// ══════════════════════════════════════════════════════════════════════
// CATEGORY ICONS
// ══════════════════════════════════════════════════════════════════════

const CATEGORY_ICONS: Record<string, typeof ChefHat> = {
  Kitchen: ChefHat,
  Bathroom: Bath,
  Flooring: Layers,
  Painting: Paintbrush,
  Electrical: Zap,
  Plumbing: Droplets,
  HVAC: Wind,
  Exterior: Home,
  General: Wrench,
};

function getCategoryIcon(category: string) {
  return CATEGORY_ICONS[category] ?? Package;
}

// ══════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════

export default function AssemblySelector({
  assemblies,
  loading,
  categories,
  activeCategory,
  onCategoryChange,
  isSelected,
  getQuantity,
  onToggle,
  onQuantityChange,
  selectionCount,
}: AssemblySelectorProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return assemblies;
    const q = search.toLowerCase();
    return assemblies.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        (a.trade ?? "").toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q)
    );
  }, [assemblies, search]);

  return (
    <div className="flex flex-col gap-4">
      {/* Category Tabs */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[0.75rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
            Categories
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
          <Badge variant="outline" className="text-[0.65rem] border-gold/30 text-gold">
            {selectionCount}/25
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onCategoryChange(null)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
              "border transition-all duration-200",
              activeCategory === null
                ? "border-gold/40 bg-gold-glow text-gold"
                : "border-border bg-card text-muted-foreground hover:border-gold/20 hover:bg-surface-hover"
            )}
          >
            All
          </button>
          {categories.map((cat) => {
            const Icon = getCategoryIcon(cat);
            return (
              <button
                key={cat}
                onClick={() => onCategoryChange(cat)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                  "border transition-all duration-200",
                  activeCategory === cat
                    ? "border-gold/40 bg-gold-glow text-gold"
                    : "border-border bg-card text-muted-foreground hover:border-gold/20 hover:bg-surface-hover"
                )}
              >
                <Icon className="h-3 w-3" />
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assemblies..."
          className={cn(
            "w-full rounded-lg border border-border bg-card pl-9 pr-4 py-2",
            "text-sm text-foreground placeholder:text-muted-foreground/60",
            "transition-all duration-200",
            "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          )}
        />
      </div>

      {/* Assembly List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-gold" />
          <p className="text-xs text-muted-foreground">Loading assemblies...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            {search ? "No matching assemblies" : "No assemblies in this category"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin">
          {filtered.map((assembly) => {
            const selected = isSelected(assembly.id);
            const qty = getQuantity(assembly.id);
            const Icon = getCategoryIcon(assembly.category ?? "General");

            return (
              <div
                key={assembly.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                  "transition-all duration-200 cursor-pointer",
                  selected
                    ? "border-gold/40 bg-gold-glow"
                    : "border-border bg-card hover:border-gold/20 hover:bg-surface-hover"
                )}
                onClick={() => onToggle(assembly.id)}
              >
                {/* Checkbox */}
                <div
                  className={cn(
                    "flex items-center justify-center h-5 w-5 rounded shrink-0 border transition-all",
                    selected
                      ? "bg-gold border-gold text-background"
                      : "border-border bg-transparent"
                  )}
                >
                  {selected && <Check className="h-3 w-3" />}
                </div>

                {/* Icon */}
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    selected ? "text-gold" : "text-muted-foreground"
                  )}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium truncate",
                      selected ? "text-gold" : "text-foreground"
                    )}
                  >
                    {assembly.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[0.65rem] text-muted-foreground font-mono">
                      {assembly.code}
                    </span>
                    {assembly.finishLevel && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[0.6rem] px-1.5 py-0",
                          assembly.finishLevel === "luxury"
                            ? "border-purple-500/30 text-purple-400"
                            : assembly.finishLevel === "premium"
                            ? "border-amber-500/30 text-amber-400"
                            : "border-border text-muted-foreground"
                        )}
                      >
                        {assembly.finishLevel}
                      </Badge>
                    )}
                    {assembly.assemblyType && (
                      <span className="text-[0.6rem] text-muted-foreground/60">
                        {assembly.assemblyType}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quantity Controls (only when selected) */}
                {selected && (
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => onQuantityChange(assembly.id, Math.max(1, qty - 1))}
                      className="flex items-center justify-center h-6 w-6 rounded border border-border bg-card hover:bg-surface-hover transition-colors"
                    >
                      <Minus className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={qty}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 1) onQuantityChange(assembly.id, val);
                      }}
                      className="w-10 text-center text-sm font-mono bg-transparent border-b border-gold/30 text-foreground focus:outline-none focus:border-gold"
                    />
                    <button
                      onClick={() => onQuantityChange(assembly.id, qty + 1)}
                      className="flex items-center justify-center h-6 w-6 rounded border border-border bg-card hover:bg-surface-hover transition-colors"
                    >
                      <Plus className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
