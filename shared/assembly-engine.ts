/**
 * structr.ai v9 — Assembly Calculation Engine
 * Sprint 7: Assembly Library — Remodel Scope
 *
 * Pure calculation layer that:
 *   1. Builds BOM from assembly_components
 *   2. Pulls live prices from price_book_items (never hardcodes)
 *   3. Applies component-level waste factors
 *   4. Applies assembly-level coastal_modifier
 *   5. Applies channel_multiplier (direct / insurance / commercial)
 *   6. Produces detailed cost breakdown by component_type
 *   7. Calculates totals with markup
 *
 * REUSES existing Pricing Engine functions — does NOT duplicate pricing logic.
 * No database dependencies — pure business logic.
 */

import {
  type PricingDimensions,
  type PricingLineItem,
  type PricedLineItem,
  type PricingSummary,
  priceLineItems,
  mergeDimensions,
  enforceMinGP,
  round2,
  round4,
} from "./pricing-engine";
import { MIN_GROSS_PROFIT, calcGrossProfit } from "./catalog-utils";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Minimal component shape needed for calculation (DB-agnostic) */
export interface AssemblyComponentInput {
  id: number;
  componentType: "material" | "labor" | "subcontract" | "equipment" | "permit" | "admin";
  description: string | null;
  quantity: string;          // decimal string from DB
  unit: string | null;
  wasteFactorPct: string | null;  // component-level override
  unitCostOverride: string | null;
  /** Joined price_book_item data */
  priceBookItem: {
    id: number;
    name: string;
    unitCost: string;
    unitPrice: string;
    wasteFactor: string | null;
    coastalModifier: string | null;
    itemType: string | null;
  } | null;
}

/** Assembly-level context for pricing */
export interface AssemblyPricingContext {
  assemblyId: number;
  assemblyName: string;
  coastalModifier: string | null;  // assembly-level coastal modifier
  finishLevel: string | null;
  region: string | null;
  /** External pricing dimensions (channel, regional, finish) */
  dimensions?: Partial<PricingDimensions>;
}

/** Detailed cost breakdown by component_type */
export interface CostBreakdown {
  materialCost: number;
  laborCost: number;
  subcontractCost: number;
  equipmentCost: number;
  permitCost: number;
  adminCost: number;
}

/** Result of calculating an assembly's cost */
export interface AssemblyCostResult {
  assemblyId: number;
  assemblyName: string;
  /** Individual priced components */
  pricedComponents: PricedAssemblyComponent[];
  /** Cost breakdown by component_type */
  costBreakdown: CostBreakdown;
  /** Price breakdown by component_type */
  priceBreakdown: CostBreakdown;
  /** Totals */
  totalDirectCost: number;
  totalSellPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
  /** Pricing dimensions that were applied */
  dimensionsApplied: PricingDimensions;
  /** Component count */
  componentCount: number;
  /** Warnings (e.g., missing PBI, GP violations) */
  warnings: string[];
}

/** A priced component in the assembly */
export interface PricedAssemblyComponent {
  componentId: number;
  componentType: string;
  description: string;
  quantity: number;
  unit: string;
  /** Base unit cost from PBI (or override) */
  baseUnitCost: number;
  /** Base unit price from PBI */
  baseUnitPrice: number;
  /** Waste factor applied */
  wasteFactor: number;
  /** Adjusted unit cost (after waste, coastal, channel) */
  adjustedUnitCost: number;
  /** Adjusted unit price (after finish, channel) */
  adjustedUnitPrice: number;
  /** Line total cost = adjustedUnitCost × quantity */
  lineTotalCost: number;
  /** Line total price = adjustedUnitPrice × quantity */
  lineTotalPrice: number;
  /** Line gross profit % */
  grossProfitPct: number;
  meetsMinGP: boolean;
  /** PBI reference */
  priceBookItemId: number | null;
  priceBookItemName: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// CORE CALCULATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate the full cost of an assembly from its components.
 *
 * This is the main entry point for assembly pricing.
 * It reuses the Pricing Engine's priceLineItems() for the actual math.
 */
export function calculateAssemblyCost(
  components: AssemblyComponentInput[],
  context: AssemblyPricingContext
): AssemblyCostResult {
  const warnings: string[] = [];

  // Build pricing line items from components
  const lineItems: PricingLineItem[] = [];

  for (const comp of components) {
    if (!comp.priceBookItem && !comp.unitCostOverride) {
      warnings.push(
        `Component ${comp.id} (${comp.description ?? "unknown"}) has no price_book_item and no cost override — skipped`
      );
      continue;
    }

    const pbi = comp.priceBookItem;

    // Determine unit cost: override > PBI
    const unitCost = comp.unitCostOverride
      ? parseFloat(comp.unitCostOverride)
      : pbi ? parseFloat(pbi.unitCost) : 0;

    // Determine unit price from PBI (no override for price — that's governance)
    const unitPrice = pbi ? parseFloat(pbi.unitPrice) : round2(unitCost / (1 - MIN_GROSS_PROFIT / 100));

    // Determine waste factor: component override > PBI default > 1.0
    const compWaste = comp.wasteFactorPct ? 1 + parseFloat(comp.wasteFactorPct) / 100 : null;
    const pbiWaste = pbi?.wasteFactor ? parseFloat(pbi.wasteFactor) : null;
    const wasteFactor = compWaste ?? pbiWaste ?? 1.0;

    // Assembly-level coastal modifier
    const coastalMod = context.coastalModifier ? parseFloat(context.coastalModifier) : 1.0;

    // Map component_type to pricing itemType
    const itemType = mapComponentTypeToItemType(comp.componentType);

    lineItems.push({
      id: comp.id,
      name: comp.description ?? pbi?.name ?? `Component ${comp.id}`,
      itemType,
      unitCost,
      unitPrice,
      quantity: parseFloat(comp.quantity),
      wasteFactor,
      coastalModifier: coastalMod,
    });
  }

  // Use the Pricing Engine to price all items with shared dimensions
  const summary = priceLineItems(lineItems, context.dimensions ?? {});

  // Build priced components with detailed info
  const pricedComponents: PricedAssemblyComponent[] = summary.lineItems.map((item, idx) => {
    const comp = components.find(c => c.id === item.id);
    return {
      componentId: item.id,
      componentType: comp?.componentType ?? "material",
      description: item.name,
      quantity: item.quantity,
      unit: comp?.unit ?? comp?.priceBookItem?.name?.match(/\(per (\w+)\)/)?.[1] ?? "EA",
      baseUnitCost: item.unitCost,
      baseUnitPrice: item.unitPrice,
      wasteFactor: item.wasteFactor ?? 1.0,
      adjustedUnitCost: item.adjustedUnitCost,
      adjustedUnitPrice: item.adjustedUnitPrice,
      lineTotalCost: item.lineTotalCost,
      lineTotalPrice: item.lineTotalPrice,
      grossProfitPct: item.grossProfitPct,
      meetsMinGP: item.meetsMinGP,
      priceBookItemId: comp?.priceBookItem?.id ?? null,
      priceBookItemName: comp?.priceBookItem?.name ?? null,
    };
  });

  // Build cost/price breakdowns by component_type
  const costBreakdown = buildBreakdown(pricedComponents, "lineTotalCost");
  const priceBreakdown = buildBreakdown(pricedComponents, "lineTotalPrice");

  return {
    assemblyId: context.assemblyId,
    assemblyName: context.assemblyName,
    pricedComponents,
    costBreakdown,
    priceBreakdown,
    totalDirectCost: summary.subtotalCost,
    totalSellPrice: summary.subtotalPrice,
    grossProfit: summary.grossProfit,
    grossProfitPct: summary.grossProfitPct,
    meetsMinGP: summary.meetsMinGP,
    dimensionsApplied: summary.dimensionsApplied,
    componentCount: pricedComponents.length,
    warnings,
  };
}

/**
 * Calculate assembly cost with Profit Shield enforcement.
 * If the assembly GP is below minimum, adjusts the total sell price.
 */
export function calculateAssemblyCostWithProfitShield(
  components: AssemblyComponentInput[],
  context: AssemblyPricingContext,
  minGP: number = MIN_GROSS_PROFIT
): AssemblyCostResult & { profitShieldApplied: boolean; originalSellPrice: number } {
  const result = calculateAssemblyCost(components, context);

  const shield = enforceMinGP(result.totalDirectCost, result.totalSellPrice, minGP);

  return {
    ...result,
    totalSellPrice: shield.price,
    grossProfit: round2(shield.price - result.totalDirectCost),
    grossProfitPct: shield.grossProfitPct,
    meetsMinGP: true,
    profitShieldApplied: shield.wasAdjusted,
    originalSellPrice: result.totalSellPrice,
  };
}

// ══════════════════════════════════════════════════════════════════════
// BATCH CALCULATIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate costs for multiple assemblies (e.g., for a bundle/estimate).
 * Returns individual results plus aggregate totals.
 */
export function calculateMultipleAssemblies(
  assemblies: Array<{
    components: AssemblyComponentInput[];
    context: AssemblyPricingContext;
    quantity: number;
  }>
): {
  assemblies: Array<AssemblyCostResult & { quantity: number; extendedCost: number; extendedPrice: number }>;
  totalCost: number;
  totalPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
} {
  let totalCost = 0;
  let totalPrice = 0;

  const results = assemblies.map(({ components, context, quantity }) => {
    const result = calculateAssemblyCost(components, context);
    const extendedCost = round2(result.totalDirectCost * quantity);
    const extendedPrice = round2(result.totalSellPrice * quantity);
    totalCost += extendedCost;
    totalPrice += extendedPrice;
    return { ...result, quantity, extendedCost, extendedPrice };
  });

  totalCost = round2(totalCost);
  totalPrice = round2(totalPrice);
  const grossProfit = round2(totalPrice - totalCost);
  const grossProfitPct = round2(calcGrossProfit(totalPrice, totalCost));

  return {
    assemblies: results,
    totalCost,
    totalPrice,
    grossProfit,
    grossProfitPct,
    meetsMinGP: grossProfitPct >= MIN_GROSS_PROFIT,
  };
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Map assembly component_type to pricing engine itemType.
 */
function mapComponentTypeToItemType(
  componentType: string
): "material" | "labor" | "subcontract" | "permit_fee" | "equipment" | "allowance" {
  switch (componentType) {
    case "material": return "material";
    case "labor": return "labor";
    case "subcontract": return "subcontract";
    case "equipment": return "equipment";
    case "permit": return "permit_fee";
    case "admin": return "allowance";
    default: return "material";
  }
}

/**
 * Build a cost/price breakdown by component_type.
 */
function buildBreakdown(
  components: PricedAssemblyComponent[],
  field: "lineTotalCost" | "lineTotalPrice"
): CostBreakdown {
  const breakdown: CostBreakdown = {
    materialCost: 0,
    laborCost: 0,
    subcontractCost: 0,
    equipmentCost: 0,
    permitCost: 0,
    adminCost: 0,
  };

  for (const comp of components) {
    const value = comp[field];
    switch (comp.componentType) {
      case "material":
        breakdown.materialCost = round2(breakdown.materialCost + value);
        break;
      case "labor":
        breakdown.laborCost = round2(breakdown.laborCost + value);
        break;
      case "subcontract":
        breakdown.subcontractCost = round2(breakdown.subcontractCost + value);
        break;
      case "equipment":
        breakdown.equipmentCost = round2(breakdown.equipmentCost + value);
        break;
      case "permit":
        breakdown.permitCost = round2(breakdown.permitCost + value);
        break;
      case "admin":
        breakdown.adminCost = round2(breakdown.adminCost + value);
        break;
    }
  }

  return breakdown;
}

/**
 * Summarize an assembly's cost breakdown as a human-readable string.
 */
export function formatCostBreakdown(breakdown: CostBreakdown): string {
  const lines: string[] = [];
  if (breakdown.materialCost > 0) lines.push(`Material: $${breakdown.materialCost.toFixed(2)}`);
  if (breakdown.laborCost > 0) lines.push(`Labor: $${breakdown.laborCost.toFixed(2)}`);
  if (breakdown.subcontractCost > 0) lines.push(`Subcontract: $${breakdown.subcontractCost.toFixed(2)}`);
  if (breakdown.equipmentCost > 0) lines.push(`Equipment: $${breakdown.equipmentCost.toFixed(2)}`);
  if (breakdown.permitCost > 0) lines.push(`Permit/Fee: $${breakdown.permitCost.toFixed(2)}`);
  if (breakdown.adminCost > 0) lines.push(`Admin: $${breakdown.adminCost.toFixed(2)}`);
  return lines.join(" | ");
}

/**
 * Calculate the total from a cost breakdown.
 */
export function totalFromBreakdown(breakdown: CostBreakdown): number {
  return round2(
    breakdown.materialCost +
    breakdown.laborCost +
    breakdown.subcontractCost +
    breakdown.equipmentCost +
    breakdown.permitCost +
    breakdown.adminCost
  );
}
