/**
 * structr.ai v9 — Pricing Calculation Engine
 * Sprint 6 Phase 5: Master Pricing Architecture
 *
 * Core pricing formulas:
 *   Adjusted Cost  = unit_cost × waste_factor × coastal_modifier × channel_cost_multiplier
 *   Adjusted Price = unit_price × finish_multiplier × channel_price_multiplier
 *   Parametric     = sqft × base_cost_per_sqft × complexity × regional × channel
 *
 * This module is shared between server and client for consistent calculations.
 * No database dependencies — pure business logic.
 */

import { MIN_GROSS_PROFIT, calcGrossProfit } from "./catalog-utils";
import { round2, round4 } from "./utils/math";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Pricing dimensions applied to a single line item */
export interface PricingDimensions {
  wasteFactor: number;          // default 1.0, e.g. 1.10 for 10% waste
  coastalModifier: number;      // default 1.0, e.g. 1.15 for coastal zone
  channelCostMultiplier: number;  // default 1.0
  channelPriceMultiplier: number; // default 1.0
  finishMultiplier: number;     // default 1.0, e.g. 1.35 for premium
  regionalCostModifier: number; // default 1.0, general regional cost mod
  regionalLaborModifier: number; // default 1.0, labor-specific regional mod
  regionalMaterialModifier: number; // default 1.0, material-specific regional mod
}

/** Default pricing dimensions (no adjustments) */
export const DEFAULT_PRICING_DIMENSIONS: PricingDimensions = {
  wasteFactor: 1.0,
  coastalModifier: 1.0,
  channelCostMultiplier: 1.0,
  channelPriceMultiplier: 1.0,
  finishMultiplier: 1.0,
  regionalCostModifier: 1.0,
  regionalLaborModifier: 1.0,
  regionalMaterialModifier: 1.0,
};

/** Result of applying pricing dimensions to a single item */
export interface AdjustedPrice {
  baseUnitCost: number;
  baseUnitPrice: number;
  adjustedUnitCost: number;
  adjustedUnitPrice: number;
  costMultiplierApplied: number;   // cumulative cost multiplier
  priceMultiplierApplied: number;  // cumulative price multiplier
  grossProfitPct: number;
  meetsMinGP: boolean;
}

/** Input for parametric estimation */
export interface ParametricInput {
  sqft: number;
  baseCostPerSqft: number;
  basePricePerSqft: number;
  complexityMultiplier: number;
  dimensions: Partial<PricingDimensions>;
}

/** Result of parametric estimation */
export interface ParametricEstimate {
  sqft: number;
  baseCostPerSqft: number;
  basePricePerSqft: number;
  adjustedCostPerSqft: number;
  adjustedPricePerSqft: number;
  totalCost: number;
  totalPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
  complexityMultiplier: number;
  dimensionsApplied: PricingDimensions;
}

/** Input for multi-item pricing calculation */
export interface PricingLineItem {
  id: string | number;
  name: string;
  itemType: "material" | "labor" | "subcontract" | "permit_fee" | "equipment" | "allowance";
  unitCost: number;
  unitPrice: number;
  quantity: number;
  wasteFactor?: number;
  coastalModifier?: number;
}

/** Result of multi-item pricing calculation */
export interface PricedLineItem extends PricingLineItem {
  adjustedUnitCost: number;
  adjustedUnitPrice: number;
  lineTotalCost: number;
  lineTotalPrice: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
}

/** Summary of a priced estimate */
export interface PricingSummary {
  lineItems: PricedLineItem[];
  subtotalCost: number;
  subtotalPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
  itemCount: number;
  dimensionsApplied: PricingDimensions;
}

/** Price governance validation result */
export interface PriceGovernanceResult {
  isValid: boolean;
  violations: PriceViolation[];
  adjustedPrice?: number;
  adjustedGP?: number;
}

export interface PriceViolation {
  rule: string;
  message: string;
  severity: "warning" | "error";
  currentValue: number;
  requiredValue: number;
}

// ══════════════════════════════════════════════════════════════════════
// CORE PRICING CALCULATIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Merge partial dimensions with defaults.
 */
export function mergeDimensions(partial?: Partial<PricingDimensions>): PricingDimensions {
  return { ...DEFAULT_PRICING_DIMENSIONS, ...partial };
}

/**
 * Calculate the cumulative cost multiplier for a line item.
 *
 * Formula:
 *   For materials: waste × coastal × channel_cost × regional_material
 *   For labor:     waste × coastal × channel_cost × regional_labor
 *   For others:    waste × coastal × channel_cost × regional_cost
 */
export function calcCostMultiplier(
  itemType: string,
  dims: PricingDimensions
): number {
  const base = dims.wasteFactor * dims.coastalModifier * dims.channelCostMultiplier;

  switch (itemType) {
    case "material":
      return round4(base * dims.regionalMaterialModifier);
    case "labor":
      return round4(base * dims.regionalLaborModifier);
    default:
      return round4(base * dims.regionalCostModifier);
  }
}

/**
 * Calculate the cumulative price multiplier for a line item.
 *
 * Formula: channel_price × finish
 */
export function calcPriceMultiplier(dims: PricingDimensions): number {
  return round4(dims.channelPriceMultiplier * dims.finishMultiplier);
}

/**
 * Apply pricing dimensions to a single item.
 */
export function applyPricingDimensions(
  unitCost: number,
  unitPrice: number,
  itemType: string,
  dims: Partial<PricingDimensions> = {}
): AdjustedPrice {
  const fullDims = mergeDimensions(dims);
  const costMul = calcCostMultiplier(itemType, fullDims);
  const priceMul = calcPriceMultiplier(fullDims);

  const adjustedUnitCost = round2(unitCost * costMul);
  const adjustedUnitPrice = round2(unitPrice * priceMul);
  const gp = calcGrossProfit(adjustedUnitPrice, adjustedUnitCost);

  return {
    baseUnitCost: unitCost,
    baseUnitPrice: unitPrice,
    adjustedUnitCost,
    adjustedUnitPrice,
    costMultiplierApplied: costMul,
    priceMultiplierApplied: priceMul,
    grossProfitPct: round2(gp),
    meetsMinGP: gp >= MIN_GROSS_PROFIT,
  };
}

/**
 * Price a list of line items with shared dimensions.
 * Returns individual priced items and an aggregate summary.
 */
export function priceLineItems(
  items: PricingLineItem[],
  sharedDimensions: Partial<PricingDimensions> = {}
): PricingSummary {
  const fullDims = mergeDimensions(sharedDimensions);
  let subtotalCost = 0;
  let subtotalPrice = 0;

  const pricedItems: PricedLineItem[] = items.map(item => {
    // Per-item overrides for waste and coastal
    const itemDims: PricingDimensions = {
      ...fullDims,
      wasteFactor: item.wasteFactor ?? fullDims.wasteFactor,
      coastalModifier: item.coastalModifier ?? fullDims.coastalModifier,
    };

    const adjusted = applyPricingDimensions(
      item.unitCost,
      item.unitPrice,
      item.itemType,
      itemDims
    );

    const lineTotalCost = round2(adjusted.adjustedUnitCost * item.quantity);
    const lineTotalPrice = round2(adjusted.adjustedUnitPrice * item.quantity);

    subtotalCost += lineTotalCost;
    subtotalPrice += lineTotalPrice;

    return {
      ...item,
      adjustedUnitCost: adjusted.adjustedUnitCost,
      adjustedUnitPrice: adjusted.adjustedUnitPrice,
      lineTotalCost,
      lineTotalPrice,
      grossProfitPct: adjusted.grossProfitPct,
      meetsMinGP: adjusted.meetsMinGP,
    };
  });

  subtotalCost = round2(subtotalCost);
  subtotalPrice = round2(subtotalPrice);
  const grossProfit = round2(subtotalPrice - subtotalCost);
  const grossProfitPct = round2(calcGrossProfit(subtotalPrice, subtotalCost));

  return {
    lineItems: pricedItems,
    subtotalCost,
    subtotalPrice,
    grossProfit,
    grossProfitPct,
    meetsMinGP: grossProfitPct >= MIN_GROSS_PROFIT,
    itemCount: pricedItems.length,
    dimensionsApplied: fullDims,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PARAMETRIC CALCULATIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate a parametric estimate ($/sqft model).
 *
 * Formula:
 *   adjustedCostPerSqft  = baseCost × complexity × regional × channel_cost
 *   adjustedPricePerSqft = basePrice × complexity × finish × channel_price
 *   totalCost  = adjustedCostPerSqft × sqft
 *   totalPrice = adjustedPricePerSqft × sqft
 */
export function calculateParametricEstimate(input: ParametricInput): ParametricEstimate {
  const dims = mergeDimensions(input.dimensions);

  const adjustedCostPerSqft = round4(
    input.baseCostPerSqft *
    input.complexityMultiplier *
    dims.regionalCostModifier *
    dims.channelCostMultiplier *
    dims.coastalModifier
  );

  const adjustedPricePerSqft = round4(
    input.basePricePerSqft *
    input.complexityMultiplier *
    dims.finishMultiplier *
    dims.channelPriceMultiplier
  );

  const totalCost = round2(adjustedCostPerSqft * input.sqft);
  const totalPrice = round2(adjustedPricePerSqft * input.sqft);
  const grossProfit = round2(totalPrice - totalCost);
  const grossProfitPct = round2(calcGrossProfit(totalPrice, totalCost));

  return {
    sqft: input.sqft,
    baseCostPerSqft: input.baseCostPerSqft,
    basePricePerSqft: input.basePricePerSqft,
    adjustedCostPerSqft,
    adjustedPricePerSqft,
    totalCost,
    totalPrice,
    grossProfit,
    grossProfitPct,
    meetsMinGP: grossProfitPct >= MIN_GROSS_PROFIT,
    complexityMultiplier: input.complexityMultiplier,
    dimensionsApplied: dims,
  };
}

/**
 * Validate sqft against a parametric model's min/max range.
 */
export function validateParametricSqft(
  sqft: number,
  minSqft: number,
  maxSqft: number
): { valid: boolean; corrected: number; reason?: string } {
  if (typeof sqft !== "number" || isNaN(sqft)) {
    return { valid: false, corrected: minSqft, reason: "Square footage must be a number" };
  }
  if (sqft < minSqft) {
    return { valid: false, corrected: minSqft, reason: `Minimum ${minSqft} sqft required` };
  }
  if (sqft > maxSqft) {
    return { valid: false, corrected: maxSqft, reason: `Maximum ${maxSqft} sqft allowed` };
  }
  return { valid: true, corrected: sqft };
}

// ══════════════════════════════════════════════════════════════════════
// PRICE GOVERNANCE
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a price against governance rules.
 * Returns violations and optionally an adjusted price that meets all rules.
 */
export function validatePriceGovernance(
  unitCost: number,
  unitPrice: number,
  opts?: {
    minGrossProfitPct?: number;
    maxMarkupPct?: number;
    minPrice?: number;
    maxPrice?: number;
  }
): PriceGovernanceResult {
  const violations: PriceViolation[] = [];
  const minGP = opts?.minGrossProfitPct ?? MIN_GROSS_PROFIT;

  // Rule 1: Minimum gross profit
  const gp = calcGrossProfit(unitPrice, unitCost);
  if (gp < minGP) {
    violations.push({
      rule: "min_gross_profit",
      message: `Gross profit ${gp.toFixed(1)}% is below minimum ${minGP}%`,
      severity: "error",
      currentValue: round2(gp),
      requiredValue: minGP,
    });
  }

  // Rule 2: Maximum markup (prevent price gouging)
  if (opts?.maxMarkupPct !== undefined) {
    const markup = unitCost > 0 ? ((unitPrice - unitCost) / unitCost) * 100 : 0;
    if (markup > opts.maxMarkupPct) {
      violations.push({
        rule: "max_markup",
        message: `Markup ${markup.toFixed(1)}% exceeds maximum ${opts.maxMarkupPct}%`,
        severity: "warning",
        currentValue: round2(markup),
        requiredValue: opts.maxMarkupPct,
      });
    }
  }

  // Rule 3: Minimum price floor
  if (opts?.minPrice !== undefined && unitPrice < opts.minPrice) {
    violations.push({
      rule: "min_price",
      message: `Price $${unitPrice.toFixed(2)} is below minimum $${opts.minPrice.toFixed(2)}`,
      severity: "error",
      currentValue: unitPrice,
      requiredValue: opts.minPrice,
    });
  }

  // Rule 4: Maximum price ceiling
  if (opts?.maxPrice !== undefined && unitPrice > opts.maxPrice) {
    violations.push({
      rule: "max_price",
      message: `Price $${unitPrice.toFixed(2)} exceeds maximum $${opts.maxPrice.toFixed(2)}`,
      severity: "warning",
      currentValue: unitPrice,
      requiredValue: opts.maxPrice,
    });
  }

  // Calculate adjusted price that meets minimum GP
  let adjustedPrice: number | undefined;
  let adjustedGP: number | undefined;
  if (gp < minGP && unitCost > 0) {
    adjustedPrice = round2(unitCost / (1 - minGP / 100));
    adjustedGP = round2(calcGrossProfit(adjustedPrice, unitCost));
  }

  return {
    isValid: violations.filter(v => v.severity === "error").length === 0,
    violations,
    adjustedPrice,
    adjustedGP,
  };
}

/**
 * Enforce minimum gross profit on a price, returning the adjusted price if needed.
 * This is the Profit Shield at the item level.
 */
export function enforceMinGP(
  unitCost: number,
  unitPrice: number,
  minGP: number = MIN_GROSS_PROFIT
): { price: number; wasAdjusted: boolean; grossProfitPct: number } {
  const gp = calcGrossProfit(unitPrice, unitCost);
  if (gp >= minGP) {
    return { price: unitPrice, wasAdjusted: false, grossProfitPct: round2(gp) };
  }

  const adjustedPrice = unitCost > 0 ? round2(unitCost / (1 - minGP / 100)) : unitPrice;
  const adjustedGP = calcGrossProfit(adjustedPrice, unitCost);
  return { price: adjustedPrice, wasAdjusted: true, grossProfitPct: round2(adjustedGP) };
}

// ══════════════════════════════════════════════════════════════════════
// UTILITY RE-EXPORTS (canonical source: shared/utils/math.ts)
// ══════════════════════════════════════════════════════════════════════

export { round2, round4 } from "./utils/math";
