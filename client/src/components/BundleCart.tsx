// BundleCart — Right column: metrics, discount control, items with editable qty, export
// Design: structr.ai dashboard with gold metric cards, profit protection alerts
// NOW USES PERSISTENT BUNDLES from MySQL via tRPC — editable quantities

import MetricCard from "@/components/MetricCard";
import {
  autoAdjustDiscount,
  calcGrossProfit,
  calcLineTotals,
  fmtCurrency,
  generateJobTreadCSVWithQty,
  MIN_GROSS_PROFIT,
  type CatalogItemView,
} from "@shared/catalog-utils";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Minus,
  Package,
  Plus,
  Shield,
  Tag,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

type BundleItemLocal = {
  bundleItemId: string;
  catalogItemId: string;
  quantity: number;
  unitCostSnapshot: string;
  unitPriceSnapshot: string;
  catalogItem: CatalogItemView | null;
};

interface BundleCartProps {
  bundleName: string;
  items: BundleItemLocal[];
  defaultDiscount: number;
  onRemoveItem: (bundleItemId: string) => void;
  onUpdateQuantity: (bundleItemId: string, qty: number) => void;
  isUpdating: boolean;
}

export default function BundleCart({
  bundleName,
  items,
  defaultDiscount,
  onRemoveItem,
  onUpdateQuantity,
  isUpdating,
}: BundleCartProps) {
  const [requestedDiscount, setRequestedDiscount] = useState(defaultDiscount);

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalSell = 0;
    for (const item of items) {
      const line = calcLineTotals(
        item.quantity,
        parseFloat(item.unitCostSnapshot),
        parseFloat(item.unitPriceSnapshot)
      );
      totalCost += line.lineTotalCost;
      totalSell += line.lineTotalPrice;
    }
    return { totalCost, totalSell };
  }, [items]);

  const discount = useMemo(
    () => autoAdjustDiscount(totals.totalCost, totals.totalSell, requestedDiscount),
    [totals, requestedDiscount]
  );

  const finalGP = calcGrossProfit(discount.finalSell, totals.totalCost);
  const discountAmount = totals.totalSell - discount.finalSell;
  const profitMargin = discount.finalSell - totals.totalCost;

  const handleExport = () => {
    const csvItems = items
      .filter((i) => i.catalogItem)
      .map((i) => ({
        costGroupName: i.catalogItem!.costGroupName,
        costItemName: i.catalogItem!.costItemName,
        description: i.catalogItem!.description,
        unit: i.catalogItem!.unit,
        unitCost: i.unitCostSnapshot,
        unitPrice: i.unitPriceSnapshot,
        quantity: i.quantity,
      }));

    const csv = generateJobTreadCSVWithQty(csvItems, discount.appliedDiscount);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    a.href = url;
    a.download = `structr.ai_${bundleName.replace(/\s+/g, "_")}_${timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Empty state
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SectionLabel text={`${bundleName} — Bundle Cart`} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <p className="text-base font-medium text-muted-foreground">Bundle is empty</p>
          <p className="mt-1.5 text-sm text-muted-foreground/60 max-w-xs">
            Select items from the catalog library to add them to this bundle.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionLabel text={`${bundleName} — Bundle Cart`} />

      {/* Updating indicator */}
      {isUpdating && (
        <div className="flex items-center gap-2 text-gold/70">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="text-xs">Saving changes...</span>
        </div>
      )}

      {/* Metric Cards Row 1 */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Direct Cost (Combined)"
          value={fmtCurrency(totals.totalCost)}
          subtitle={`${items.length} line items`}
        />
        <MetricCard
          label="Total Sell (Before Discount)"
          value={fmtCurrency(totals.totalSell)}
          subtitle={`Avg GP: ${calcGrossProfit(totals.totalSell, totals.totalCost).toFixed(1)}%`}
        />
      </div>

      {/* Discount Control */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Tag className="h-4 w-4 text-gold" />
          <span className="text-sm font-semibold text-foreground">Bundle Discount Configuration</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          {/* Input */}
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Discount (%)
            </label>
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={requestedDiscount}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "" || val === "-") {
                  setRequestedDiscount(0);
                  return;
                }
                const num = parseFloat(val);
                if (!isNaN(num)) setRequestedDiscount(Math.min(50, Math.max(0, num)));
              }}
              className={cn(
                "w-24 rounded-lg border border-border bg-background px-3 py-2",
                "font-mono text-sm font-semibold text-foreground",
                "transition-all duration-200",
                "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30",
                "focus:shadow-[0_0_10px_var(--color-gold-glow)]"
              )}
            />
          </div>

          {/* Alert */}
          <div className="flex-1">
            {discount.wasAdjusted ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/25 px-3 py-2">
                <Shield className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-400">
                    Profit Protection Activated (Auto-Adjust)
                  </p>
                  <p className="text-[0.7rem] text-red-400/70 mt-0.5">
                    Requested {requestedDiscount.toFixed(1)}% → Adjusted to{" "}
                    {discount.appliedDiscount.toFixed(1)}% to maintain {MIN_GROSS_PROFIT.toFixed(0)}%
                    GP floor.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
                <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                <p className="text-xs font-medium text-green-400">
                  Discount Approved — {discount.appliedDiscount.toFixed(1)}% applied. GP remains
                  healthy at {finalGP.toFixed(1)}%.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metric Cards Row 2 */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Gross Profit"
          value={`${finalGP.toFixed(1)}%`}
          subtitle={`Floor: ${MIN_GROSS_PROFIT.toFixed(0)}% · Margin: ${fmtCurrency(profitMargin)}`}
          variant={finalGP < MIN_GROSS_PROFIT + 2 ? "danger" : finalGP >= 40 ? "success" : "default"}
        />
        <MetricCard
          label="Final Sell Price"
          value={fmtCurrency(discount.finalSell)}
          subtitle={`Discount: -${fmtCurrency(discountAmount)} (${discount.appliedDiscount.toFixed(1)}%)`}
        />
      </div>

      {/* Profit Shield Badge */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-gold-glow border border-gold/25 px-4 py-1.5">
          <Shield className="h-3.5 w-3.5 text-gold" />
          <span className="text-[0.72rem] font-semibold text-gold tracking-wide">
            Profit Shield: {MIN_GROSS_PROFIT.toFixed(0)}% GP Floor Active
          </span>
        </div>
      </div>

      {/* Selected Items List with Editable Quantities */}
      <SectionLabel text="Bundle Items" />

      <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
        {items.map((item) => (
          <BundleItemRow
            key={item.bundleItemId}
            item={item}
            onRemove={() => onRemoveItem(item.bundleItemId)}
            onUpdateQty={(qty) => onUpdateQuantity(item.bundleItemId, qty)}
          />
        ))}
      </div>

      {/* Summary Table */}
      <SectionLabel text="Detailed Breakdown" />

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-3 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Item
                </th>
                <th className="px-3 py-2.5 text-center text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Qty
                </th>
                <th className="px-3 py-2.5 text-center text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Unit
                </th>
                <th className="px-3 py-2.5 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Unit Cost
                </th>
                <th className="px-3 py-2.5 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Unit Price
                </th>
                <th className="px-3 py-2.5 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Line Total
                </th>
                <th className="px-3 py-2.5 text-right text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  GP %
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const unitCost = parseFloat(item.unitCostSnapshot);
                const unitPrice = parseFloat(item.unitPriceSnapshot);
                const line = calcLineTotals(item.quantity, unitCost, unitPrice);
                const gp = calcGrossProfit(unitPrice, unitCost);
                return (
                  <tr
                    key={item.bundleItemId}
                    className={cn(
                      "border-b border-border/50 transition-colors hover:bg-surface-hover",
                      i % 2 === 0 ? "bg-transparent" : "bg-surface/30"
                    )}
                  >
                    <td className="px-3 py-2 text-xs font-medium text-foreground max-w-[200px] truncate">
                      {item.catalogItem?.costItemName ?? `Item #${item.catalogItemId}`}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs font-semibold text-gold">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                      {item.catalogItem?.unit ?? "EA"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                      {fmtCurrency(unitCost)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-gold">
                      {fmtCurrency(unitPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-bold text-foreground">
                      {fmtCurrency(line.lineTotalPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                      {gp.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="border-t-2 border-gold/30 bg-gold-glow/50">
                <td className="px-3 py-2.5 font-mono text-xs font-bold text-gold">
                  BUNDLE TOTAL
                </td>
                <td className="px-3 py-2.5 text-center font-mono text-xs font-bold text-gold">
                  {items.reduce((s, i) => s + i.quantity, 0)}
                </td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-foreground">
                  {fmtCurrency(totals.totalCost)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-gold">
                  {fmtCurrency(totals.totalSell)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-gold">
                  {fmtCurrency(discount.finalSell)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-foreground">
                  {finalGP.toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Gold Divider */}
      <div className="h-px w-4/5 mx-auto bg-gradient-to-r from-transparent via-gold to-transparent" />

      {/* Export Button */}
      <button
        onClick={handleExport}
        className={cn(
          "flex items-center justify-center gap-2.5 w-full rounded-xl py-3.5 px-6",
          "bg-gradient-to-r from-gold-dark via-gold to-gold-light",
          "text-background font-bold text-base tracking-wide",
          "transition-all duration-300",
          "hover:shadow-[0_6px_25px_var(--color-gold-glow-strong)]",
          "hover:-translate-y-0.5",
          "active:translate-y-0"
        )}
      >
        <Download className="h-5 w-5" />
        Export Bundle to JobTread (CSV)
      </button>

      {/* Export info */}
      <div className="flex items-start gap-2 rounded-lg bg-gold-glow border border-gold/20 px-3 py-2.5">
        <AlertTriangle className="h-4 w-4 text-gold shrink-0 mt-0.5" />
        <p className="text-xs text-gold/80">
          Export includes {items.length} items with quantities and{" "}
          {discount.appliedDiscount.toFixed(1)}% bundle discount applied. Ready for JobTread import.
        </p>
      </div>
    </div>
  );
}

// ── Bundle Item Row with Editable Quantity ──
function BundleItemRow({
  item,
  onRemove,
  onUpdateQty,
}: {
  item: BundleItemLocal;
  onRemove: () => void;
  onUpdateQty: (qty: number) => void;
}) {
  const unitCost = parseFloat(item.unitCostSnapshot);
  const unitPrice = parseFloat(item.unitPriceSnapshot);
  const line = calcLineTotals(item.quantity, unitCost, unitPrice);
  const gp = calcGrossProfit(unitPrice, unitCost);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQtyChange = useCallback(
    (newQty: number) => {
      if (newQty <= 0 || newQty > 99999 || isNaN(newQty)) return;
      const rounded = Math.round(newQty * 100) / 100;

      // Debounce the server call
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onUpdateQty(rounded);
      }, 400);
    },
    [onUpdateQty]
  );

  const increment = () => handleQtyChange(item.quantity + 1);
  const decrement = () => {
    if (item.quantity > 1) handleQtyChange(item.quantity - 1);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3",
        "transition-all duration-200 hover:border-gold/25 hover:bg-surface-hover group"
      )}
    >
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[0.88rem] font-semibold text-foreground truncate">
          {item.catalogItem?.costItemName ?? `Item #${item.catalogItemId}`}
        </p>
        <p className="font-mono text-[0.7rem] text-muted-foreground">
          {item.catalogItem?.costItemId} · {item.catalogItem?.unit ?? "EA"} · GP {gp.toFixed(1)}%
        </p>
      </div>

      {/* Quantity Control */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={decrement}
          disabled={item.quantity <= 1}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg border border-border",
            "transition-all duration-200",
            item.quantity <= 1
              ? "opacity-30 cursor-not-allowed"
              : "hover:border-gold/30 hover:bg-gold/10 text-muted-foreground hover:text-gold"
          )}
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="number"
          min={1}
          max={99999}
          step={1}
          defaultValue={item.quantity}
          key={item.bundleItemId + "-" + item.quantity}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val > 0) handleQtyChange(val);
          }}
          className={cn(
            "w-14 rounded-lg border border-border bg-background px-1.5 py-1 text-center",
            "font-mono text-sm font-bold text-gold",
            "focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          )}
        />
        <button
          onClick={increment}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg border border-border",
            "transition-all duration-200",
            "hover:border-gold/30 hover:bg-gold/10 text-muted-foreground hover:text-gold"
          )}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Line Total */}
      <div className="text-right shrink-0 min-w-[80px]">
        <p className="font-mono text-[0.9rem] font-bold text-gold">
          {fmtCurrency(line.lineTotalPrice)}
        </p>
        <p className="font-mono text-[0.68rem] text-muted-foreground">
          Cost: {fmtCurrency(line.lineTotalCost)}
        </p>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10"
        title="Remove from bundle"
      >
        <Trash2 className="h-3.5 w-3.5 text-red-400" />
      </button>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
        {text}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
    </div>
  );
}
