// AssemblyLibrary — Left column: search + category browser with expandable groups
// Design: Dark card layout with gold hover accents
// NOW USES LIVE DATA from MySQL via tRPC

import { calcGrossProfit, fmtCurrency, type CatalogItemView } from "@shared/catalog-utils";
import { cn } from "@/lib/utils";
import { ChevronDown, FolderOpen, Search, Check, Square } from "lucide-react";
import { useState, useMemo } from "react";

interface CatalogGroup {
  name: string;
  costCode: string;
  items: CatalogItemView[];
}

interface AssemblyLibraryProps {
  groups: CatalogGroup[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

export default function AssemblyLibrary({ groups, selectedIds, onToggle }: AssemblyLibraryProps) {
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (item) =>
            item.costItemName.toLowerCase().includes(q) ||
            (item.costItemId || "").toLowerCase().includes(q) ||
            (item.description || "").toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [search, groups]);

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Section Label */}
      <div className="flex items-center gap-3">
        <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
          Catalog Library
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search catalog items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(
            "w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5",
            "text-sm text-foreground placeholder:text-muted-foreground/60",
            "transition-all duration-200",
            "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30",
            "focus:shadow-[0_0_10px_var(--color-gold-glow)]"
          )}
        />
      </div>

      {/* Selected count */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-gold-glow border border-gold/25 px-3 py-1.5">
          <span className="text-xs font-semibold text-gold">
            {selectedIds.length} item{selectedIds.length === 1 ? "" : "s"} selected
          </span>
        </div>
      )}

      {/* Category Browser */}
      <div className="flex items-center gap-3 mt-1">
        <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
          Browse by Cost Group
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
      </div>

      <div className="flex flex-col gap-1.5 max-h-[calc(100vh-380px)] overflow-y-auto pr-1">
        {filteredGroups.map((group) => {
          const isExpanded = expandedGroups.has(group.name);
          const selectedInGroup = group.items.filter((item) => selectedIds.includes(item.id)).length;

          return (
            <div
              key={group.name}
              className={cn(
                "rounded-xl border border-border bg-card overflow-hidden transition-all duration-200",
                isExpanded && "border-gold/20"
              )}
            >
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group.name)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left",
                  "transition-colors duration-200 hover:bg-surface-hover"
                )}
              >
                <FolderOpen className="h-4 w-4 text-gold/70 shrink-0" />
                <span className="flex-1 text-sm font-semibold text-foreground truncate">
                  {group.name}
                </span>
                {selectedInGroup > 0 && (
                  <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[0.65rem] font-bold text-gold">
                    {selectedInGroup}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {group.items.length}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    isExpanded && "rotate-180"
                  )}
                />
              </button>

              {/* Group Items */}
              {isExpanded && (
                <div className="border-t border-border/50 px-2 py-1.5">
                  {group.items.map((item) => (
                    <CatalogRow
                      key={item.id}
                      item={item}
                      isSelected={selectedIds.includes(item.id)}
                      onToggle={() => onToggle(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CatalogRow({
  item,
  isSelected,
  onToggle,
}: {
  item: CatalogItemView;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const unitCost = parseFloat(item.unitCost);
  const unitPrice = parseFloat(item.unitPrice);
  const gp = calcGrossProfit(unitPrice, unitCost);

  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        "transition-all duration-200",
        isSelected
          ? "bg-gold-glow border border-gold/30"
          : "hover:bg-surface-hover border border-transparent"
      )}
    >
      {/* Checkbox */}
      <div className="shrink-0">
        {isSelected ? (
          <div className="flex h-4.5 w-4.5 items-center justify-center rounded bg-gold">
            <Check className="h-3 w-3 text-background" strokeWidth={3} />
          </div>
        ) : (
          <Square className="h-4.5 w-4.5 text-muted-foreground/50" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={cn("text-[0.85rem] font-semibold truncate", isSelected ? "text-gold-light" : "text-foreground")}>
          {item.costItemName}
        </p>
        <p className="font-mono text-[0.7rem] text-muted-foreground">
          {item.costItemId} &middot; {item.unit} &middot; CC {item.costCode}
        </p>
      </div>

      {/* Price */}
      <div className="text-right shrink-0">
        <p className="font-mono text-[0.85rem] font-bold text-gold">
          {fmtCurrency(unitPrice)}
        </p>
        <p className="font-mono text-[0.65rem] text-muted-foreground">
          GP: {gp.toFixed(1)}%
        </p>
      </div>
    </button>
  );
}
