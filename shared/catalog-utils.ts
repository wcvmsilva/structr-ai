/**
 * structr.ai Catalog Business Logic — Shared utilities
 * These functions are used by both frontend and backend.
 * No mock data — all data comes from the database via tRPC.
 */

export const MIN_GROSS_PROFIT = 35.0;

export interface CatalogItemView {
  id: number;
  costItemId: string | null;
  costGroupName: string;
  costItemName: string;
  description: string | null;
  unit: string;
  unitCost: string; // decimal comes as string from Drizzle
  unitPrice: string;
  margin: string | null;
  costCode: string;
  costType: string | null;
  taxable: boolean | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogGroup {
  costGroupName: string;
  costCode: string;
  count: number;
}

export function calcGrossProfit(sellPrice: number, cost: number): number {
  if (sellPrice <= 0) return 0;
  return ((sellPrice - cost) / sellPrice) * 100;
}

export function fmtCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export interface DiscountResult {
  appliedDiscount: number;
  finalSell: number;
  wasAdjusted: boolean;
}

export function autoAdjustDiscount(
  totalCost: number,
  totalSell: number,
  requestedDiscount: number
): DiscountResult {
  const discountedSell = totalSell * (1 - requestedDiscount / 100);
  const gp = calcGrossProfit(discountedSell, totalCost);

  if (gp >= MIN_GROSS_PROFIT) {
    return { appliedDiscount: requestedDiscount, finalSell: discountedSell, wasAdjusted: false };
  }

  // Auto-adjust: find max discount that maintains 35% GP
  const minSell = totalCost / (1 - MIN_GROSS_PROFIT / 100);
  const maxDiscount = Math.max(0, ((totalSell - minSell) / totalSell) * 100);
  const adjustedSell = totalSell * (1 - maxDiscount / 100);

  return { appliedDiscount: maxDiscount, finalSell: adjustedSell, wasAdjusted: true };
}

// ── Bundle Business Logic ──────────────────────────────────────────

export interface BundleLineItem {
  quantity: number;
  unitCost: number;
  unitPrice: number;
}

export interface LineTotals {
  lineTotalCost: number;
  lineTotalPrice: number;
}

export interface BundleTotals {
  totalCost: number;
  totalPrice: number;
  itemCount: number;
  grossProfitPct: number;
}

/** Calculate line totals: qty × unit snapshot */
export function calcLineTotals(qty: number, unitCost: number, unitPrice: number): LineTotals {
  const safeQty = Math.max(0, qty);
  return {
    lineTotalCost: Math.round(safeQty * unitCost * 100) / 100,
    lineTotalPrice: Math.round(safeQty * unitPrice * 100) / 100,
  };
}

/** Recalculate bundle totals from an array of line items */
export function calcBundleTotals(items: BundleLineItem[]): BundleTotals {
  let totalCost = 0;
  let totalPrice = 0;
  let itemCount = 0;

  for (const item of items) {
    const line = calcLineTotals(item.quantity, item.unitCost, item.unitPrice);
    totalCost += line.lineTotalCost;
    totalPrice += line.lineTotalPrice;
    itemCount++;
  }

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalPrice: Math.round(totalPrice * 100) / 100,
    itemCount,
    grossProfitPct: calcGrossProfit(totalPrice, totalCost),
  };
}

/** Validate quantity: must be > 0, max 99999, max 2 decimal places */
export function validateQuantity(qty: number): { valid: boolean; corrected: number; reason?: string } {
  if (typeof qty !== 'number' || isNaN(qty)) {
    return { valid: false, corrected: 1, reason: 'Quantity must be a number' };
  }
  if (qty <= 0) {
    return { valid: false, corrected: 1, reason: 'Quantity must be greater than zero' };
  }
  if (qty > 99999) {
    return { valid: false, corrected: 99999, reason: 'Quantity cannot exceed 99,999' };
  }
  // Round to 2 decimal places
  const rounded = Math.round(qty * 100) / 100;
  return { valid: true, corrected: rounded };
}

/** Generate JobTread CSV with quantities */
export function generateJobTreadCSVWithQty(
  items: Array<{
    costGroupName: string;
    costItemName: string;
    description: string | null;
    unit: string;
    unitCost: string;
    unitPrice: string;
    quantity: number;
  }>,
  appliedDiscount: number
): string {
  const headers = [
    "Cost Group Name",
    "Cost Item Name",
    "Description",
    "Quantity",
    "Unit",
    "Unit Cost",
    "Unit Price",
    "Cost Type",
    "Taxable",
  ];

  const rows = items.map((item) => [
    item.costGroupName,
    item.costItemName,
    item.description || "",
    item.quantity.toString(),
    item.unit,
    parseFloat(item.unitCost).toFixed(2),
    (parseFloat(item.unitPrice) * (1 - appliedDiscount / 100)).toFixed(2),
    "Subcontractor",
    "No",
  ]);

  return [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
}

// ── Estimate Draft Transformation ──────────────────────────────────

export interface EstimateDraftPayload {
  bundleId: number;
  bundleName: string;
  channel: string;
  lineItems: EstimateDraftPayloadLineItem[];
  subtotalCost: number;
  subtotalPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  discountApplied: number;
  discountAmount: number;
  finalTotalPrice: number;
  itemCount: number;
  createdAt: string; // ISO timestamp
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EstimateDraftPayloadLineItem {
  catalogItemId: number;
  costItemId: string | null;
  costGroupName: string;
  costItemName: string;
  description: string | null;
  unit: string;
  quantity: number;
  unitCostSnapshot: number;
  unitPriceSnapshot: number;
  lineTotalCost: number;
  lineTotalPrice: number;
  grossProfitPct: number;
  sortOrder: number;
}

/** Input shape for the transformation — matches the enriched bundle from DB */
export interface BundleForEstimate {
  id: number;
  name: string;
  channel: string | null;
  defaultDiscount: string | null;
  totalCost: string | null;
  totalPrice: string | null;
  itemCount: number | null;
  description: string | null;
  items: Array<{
    catalogItemId: number;
    quantity: string;
    unitCostSnapshot: string;
    unitPriceSnapshot: string;
    lineTotalCost: string;
    lineTotalPrice: string;
    sortOrder: number | null;
    catalogItem: {
      costItemId: string | null;
      costGroupName: string;
      costItemName: string;
      description: string | null;
      unit: string;
    } | null;
  }>;
}

/**
 * Transform a Bundle (with enriched items) into an EstimateDraftPayload.
 * This is the formal bridge contract between structr.ai and Estimate Workspace.
 * All business logic (discount, Profit Shield, GP) is applied here.
 */
export function transformBundleToEstimateDraft(
  bundle: BundleForEstimate,
  requestedDiscount?: number,
  notes?: string | null
): EstimateDraftPayload {
  const defaultDiscount = requestedDiscount ?? parseFloat(bundle.defaultDiscount ?? "8.00");

  // Build line items with full calculations
  const lineItems: EstimateDraftPayloadLineItem[] = bundle.items.map((item, idx) => {
    const qty = parseFloat(item.quantity);
    const unitCost = parseFloat(item.unitCostSnapshot);
    const unitPrice = parseFloat(item.unitPriceSnapshot);
    const line = calcLineTotals(qty, unitCost, unitPrice);
    const gp = calcGrossProfit(unitPrice, unitCost);

    return {
      catalogItemId: item.catalogItemId,
      costItemId: item.catalogItem?.costItemId ?? null,
      costGroupName: item.catalogItem?.costGroupName ?? "Unknown",
      costItemName: item.catalogItem?.costItemName ?? `Item #${item.catalogItemId}`,
      description: item.catalogItem?.description ?? null,
      unit: item.catalogItem?.unit ?? "EA",
      quantity: qty,
      unitCostSnapshot: unitCost,
      unitPriceSnapshot: unitPrice,
      lineTotalCost: line.lineTotalCost,
      lineTotalPrice: line.lineTotalPrice,
      grossProfitPct: Math.round(gp * 100) / 100,
      sortOrder: item.sortOrder ?? idx + 1,
    };
  });

  // Calculate subtotals
  const subtotalCost = lineItems.reduce((sum, li) => sum + li.lineTotalCost, 0);
  const subtotalPrice = lineItems.reduce((sum, li) => sum + li.lineTotalPrice, 0);

  // Apply Profit Shield discount
  const discountResult = autoAdjustDiscount(subtotalCost, subtotalPrice, defaultDiscount);

  const grossProfit = discountResult.finalSell - subtotalCost;
  const grossProfitPct = calcGrossProfit(discountResult.finalSell, subtotalCost);
  const discountAmount = subtotalPrice - discountResult.finalSell;

  return {
    bundleId: bundle.id,
    bundleName: bundle.name,
    channel: bundle.channel ?? "direct",
    lineItems,
    subtotalCost: Math.round(subtotalCost * 100) / 100,
    subtotalPrice: Math.round(subtotalPrice * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossProfitPct: Math.round(grossProfitPct * 100) / 100,
    discountApplied: Math.round(discountResult.appliedDiscount * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    finalTotalPrice: Math.round(discountResult.finalSell * 100) / 100,
    itemCount: lineItems.length,
    createdAt: new Date().toISOString(),
    notes: notes ?? null,
    metadata: null,
  };
}

export function generateJobTreadCSV(
  items: Array<{ costGroupName: string; costItemName: string; description: string | null; unit: string; unitCost: string; unitPrice: string }>,
  appliedDiscount: number
): string {
  const headers = [
    "Cost Group Name",
    "Cost Item Name",
    "Description",
    "Quantity",
    "Unit",
    "Unit Cost",
    "Unit Price",
    "Cost Type",
    "Taxable",
  ];

  const rows = items.map((item) => [
    item.costGroupName,
    item.costItemName,
    item.description || "",
    "1",
    item.unit,
    parseFloat(item.unitCost).toFixed(2),
    (parseFloat(item.unitPrice) * (1 - appliedDiscount / 100)).toFixed(2),
    "Subcontractor",
    "No",
  ]);

  return [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
}
