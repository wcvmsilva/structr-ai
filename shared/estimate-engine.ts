/**
 * structr.ai v9 — Estimate Engine
 * Sprint 9: Estimate Draft Real Flow
 *
 * PURE TYPE MAPPING LAYER — ZERO arithmetic.
 *
 * Transforms the output of assembly-engine.ts (AssemblyCostResult batch)
 * into the EstimateDraftPayload shape for persistence.
 *
 * All numbers come directly from the assembly-engine output.
 * This module NEVER recalculates costs, prices, GP, or totals.
 */

import type {
  AssemblyCostResult,
  PricedAssemblyComponent,
} from "./assembly-engine";

import type {
  EstimateDraftLineItem,
  EstimateDraftAssemblySelection,
} from "../drizzle/schema";

import { PROFIT_SHIELD_PCT } from "./constants/profit-shield";

// ══════════════════════════════════════════════════════════════════════
// INPUT TYPES
// ══════════════════════════════════════════════════════════════════════

/** The batch result from calculateMultipleAssemblies */
export interface BatchCalculationResult {
  assemblies: Array<
    AssemblyCostResult & {
      quantity: number;
      extendedCost: number;
      extendedPrice: number;
    }
  >;
  totalCost: number;
  totalPrice: number;
  grossProfit: number;
  grossProfitPct: number;
  meetsMinGP: boolean;
}

/** Context provided by the Bundle Calculator UI */
export interface EstimateDraftContext {
  region: string;
  channel: "direct" | "insurance" | "commercial";
  finishLevel: "standard" | "premium" | "luxury";
  projectId?: number | null;
  clientId?: number | null;
  notes?: string | null;
  draftName?: string;
}

// ══════════════════════════════════════════════════════════════════════
// OUTPUT TYPES
// ══════════════════════════════════════════════════════════════════════

/** The complete payload ready for DB persistence */
export interface EstimateDraftPersistPayload {
  bundleName: string;
  channel: "direct" | "insurance" | "commercial";
  region: string;
  finishLevel: "standard" | "premium" | "luxury";
  lineItems: EstimateDraftLineItem[];
  assemblySelections: EstimateDraftAssemblySelection[];
  subtotalCost: string;
  subtotalPrice: string;
  grossProfit: string;
  grossProfitPct: string;
  finalTotalPrice: string;
  assemblyCount: number;
  profitShieldPassed: boolean;
  profitShieldMinPct: string;
  notes: string | null;
  projectId: number | null;
  clientId: number | null;
  source: "assembly_calculator";
  metadata: Record<string, unknown> | null;
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════════

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate the inputs before creating an estimate draft.
 * Returns an array of errors (empty = valid).
 */
export function validateEstimateDraftInputs(
  batchResult: BatchCalculationResult | null | undefined,
  context: Partial<EstimateDraftContext>,
  minGP: number = 35
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Region required
  if (!context.region || context.region.trim() === "") {
    errors.push({ field: "region", message: "Region is required" });
  }

  // 2. Channel required
  if (!context.channel || context.channel.trim() === "") {
    errors.push({ field: "channel", message: "Channel is required" });
  }

  // 3. At least one assembly
  if (!batchResult || batchResult.assemblies.length === 0) {
    errors.push({ field: "assemblies", message: "At least one assembly must be selected" });
  }

  // 4. Valid positive quantities
  if (batchResult) {
    for (const asm of batchResult.assemblies) {
      if (asm.quantity < 1 || !Number.isInteger(asm.quantity)) {
        errors.push({
          field: "quantity",
          message: `Assembly ${asm.assemblyId} has invalid quantity: ${asm.quantity}`,
        });
      }
    }
  }

  // 5. All calculations resolved (no zero-component assemblies)
  if (batchResult) {
    for (const asm of batchResult.assemblies) {
      if (asm.componentCount === 0) {
        errors.push({
          field: "components",
          message: `Assembly ${asm.assemblyId} (${asm.assemblyName}) has no priced components`,
        });
      }
    }
  }

  // 6. Profit Shield check
  if (batchResult && batchResult.grossProfitPct < minGP) {
    errors.push({
      field: "profitShield",
      message: `Bundle GP ${batchResult.grossProfitPct.toFixed(1)}% is below minimum ${minGP}%`,
    });
  }

  // 7. Individual assembly Profit Shield (warn on any below 28%)
  if (batchResult) {
    for (const asm of batchResult.assemblies) {
      if (asm.grossProfitPct < PROFIT_SHIELD_PCT.INDIVIDUAL_WARNING_GP) {
        errors.push({
          field: "profitShield",
          message: `Assembly ${asm.assemblyName} GP ${asm.grossProfitPct.toFixed(1)}% is critically low (< ${PROFIT_SHIELD_PCT.INDIVIDUAL_WARNING_GP}%)`,
        });
      }
    }
  }

  return errors;
}

// ══════════════════════════════════════════════════════════════════════
// TYPE MAPPING — ZERO ARITHMETIC
// ══════════════════════════════════════════════════════════════════════

/**
 * Map a single PricedAssemblyComponent to an EstimateDraftLineItem.
 * All values are passed through — no recalculation.
 */
function mapComponentToLineItem(
  comp: PricedAssemblyComponent,
  assemblyId: number,
  assemblyName: string,
  sortOrder: number
): EstimateDraftLineItem {
  return {
    catalogItemId: comp.priceBookItemId ?? 0,
    costItemId: comp.priceBookItemId?.toString() ?? null,
    costGroupName: assemblyName,
    costItemName: comp.description,
    description: comp.priceBookItemName ?? comp.description,
    unit: comp.unit,
    quantity: comp.quantity,
    unitCostSnapshot: comp.adjustedUnitCost,
    unitPriceSnapshot: comp.adjustedUnitPrice,
    lineTotalCost: comp.lineTotalCost,
    lineTotalPrice: comp.lineTotalPrice,
    grossProfitPct: comp.grossProfitPct,
    sortOrder,
    // Sprint 9 extensions
    assemblyId,
    assemblyName,
    componentType: comp.componentType,
    priceBookItemId: comp.priceBookItemId,
    wasteFactor: comp.wasteFactor,
    adjustedUnitCost: comp.adjustedUnitCost,
  };
}

/**
 * Map an AssemblyCostResult to an EstimateDraftAssemblySelection.
 * All values are passed through — no recalculation.
 */
function mapAssemblyToSelection(
  asm: AssemblyCostResult & { quantity: number; extendedCost: number; extendedPrice: number },
  assemblyCode?: string,
  category?: string,
  trade?: string | null
): EstimateDraftAssemblySelection {
  return {
    assemblyId: asm.assemblyId,
    assemblyName: asm.assemblyName,
    assemblyCode: assemblyCode ?? `ASM-${asm.assemblyId}`,
    category: category ?? "General",
    trade: trade ?? null,
    quantity: asm.quantity,
    unitCost: asm.totalDirectCost,
    unitPrice: asm.totalSellPrice,
    extendedCost: asm.extendedCost,
    extendedPrice: asm.extendedPrice,
    grossProfitPct: asm.grossProfitPct,
    componentCount: asm.componentCount,
  };
}

/**
 * Map channel from calculator format to DB enum format.
 */
function mapChannelToDbEnum(channel: string): "direct" | "insurance" | "commercial" {
  switch (channel) {
    case "direct": return "direct";
    case "residential": return "direct"; // legacy alias
    case "insurance": return "insurance";
    case "commercial": return "commercial";
    default: return "direct";
  }
}

// ══════════════════════════════════════════════════════════════════════
// MAIN TRANSFORM
// ══════════════════════════════════════════════════════════════════════

/**
 * Assembly metadata needed for the transform (from DB).
 * Keyed by assemblyId.
 */
export interface AssemblyMetadata {
  id: number;
  code: string;
  category: string;
  trade: string | null;
}

/**
 * Transform batch calculation result + context into a persistence-ready payload.
 *
 * ZERO arithmetic — all numbers come directly from batchResult.
 * This function only maps types and structures.
 */
export function transformBatchToEstimateDraft(
  batchResult: BatchCalculationResult,
  context: EstimateDraftContext,
  assemblyMetadata: Map<number, AssemblyMetadata>,
  minGP: number = 35
): EstimateDraftPersistPayload {
  // Build line items from all assembly components
  const lineItems: EstimateDraftLineItem[] = [];
  let sortOrder = 0;

  for (const asm of batchResult.assemblies) {
    const meta = assemblyMetadata.get(asm.assemblyId);
    for (const comp of asm.pricedComponents) {
      // For quantity > 1, we repeat the line items with quantity multiplied
      sortOrder++;
      lineItems.push(
        mapComponentToLineItem(
          comp,
          asm.assemblyId,
          asm.assemblyName,
          sortOrder
        )
      );
    }
  }

  // Build assembly selections
  const assemblySelections: EstimateDraftAssemblySelection[] = batchResult.assemblies.map((asm) => {
    const meta = assemblyMetadata.get(asm.assemblyId);
    return mapAssemblyToSelection(
      asm,
      meta?.code,
      meta?.category,
      meta?.trade
    );
  });

  // Generate draft name
  const draftName = context.draftName
    ?? `Estimate Draft — ${assemblySelections.length} assemblies — ${new Date().toLocaleDateString("en-US")}`;

  return {
    bundleName: draftName,
    channel: mapChannelToDbEnum(context.channel),
    region: context.region,
    finishLevel: context.finishLevel,
    lineItems,
    assemblySelections,
    subtotalCost: batchResult.totalCost.toFixed(2),
    subtotalPrice: batchResult.totalPrice.toFixed(2),
    grossProfit: batchResult.grossProfit.toFixed(2),
    grossProfitPct: batchResult.grossProfitPct.toFixed(2),
    finalTotalPrice: batchResult.totalPrice.toFixed(2),
    assemblyCount: batchResult.assemblies.length,
    profitShieldPassed: batchResult.grossProfitPct >= minGP,
    profitShieldMinPct: minGP.toFixed(2),
    notes: context.notes ?? null,
    projectId: context.projectId ?? null,
    clientId: context.clientId ?? null,
    source: "assembly_calculator",
    metadata: {
      generatedAt: new Date().toISOString(),
      region: context.region,
      channel: context.channel,
      finishLevel: context.finishLevel,
      assemblyIds: batchResult.assemblies.map((a) => a.assemblyId),
      totalComponents: lineItems.length,
    },
  };
}
