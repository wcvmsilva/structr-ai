/**
 * Estimate Export Module — Sprint 20
 *
 * Compatibility signatures for the retired draft artifact path:
 *   - PDF: Professional estimate summary document
 *   - JSON: Machine-readable full export with metadata
 *   - Printable HTML: Clean, print-optimized HTML summary
 *
 * C2-A: all draft artifact entrypoints refuse before reading data or producing bytes.
 * Governed snapshot renderers are a separate, not-yet-mounted contract.
 */
import { holdLegacyEstimateOperation } from "../shared/estimate-legacy-hold";
import type {
  EstimateDraft,
  EstimateDraftAssemblySelection,
  EstimateDraftLineItem,
} from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface ExportMetadata {
  exportedAt: string;
  exportedBy: string;
  pricingSchemaVersion: string;
  source: string;
  format: "pdf" | "json" | "printable";
}

export interface JsonExport {
  version: "1.0";
  exportMetadata: ExportMetadata;
  draft: {
    id: string;
    bundleName: string | null;
    status: string;
    source: string | null;
    channel: string | null;
    region: string | null;
    finishLevel: string | null;
    pricingSchemaVersion: string | null;
    createdAt: string;
    updatedAt: string;
  };
  financials: {
    subtotalCost: string | null;
    subtotalPrice: string | null;
    grossProfit: string | null;
    grossProfitPct: string | null;
    discountApplied: boolean | null;
    discountAmount: string | null;
    finalTotalPrice: string | null;
  };
  assemblies: EstimateDraftAssemblySelection[];
  lineItems: EstimateDraftLineItem[];
  provenance: {
    contextSnapshot: unknown | null;
    scopeDraftId: string | null;
  };
  notes: string | null;
}

export interface PrintableExport {
  html: string;
  title: string;
}

/** Retained return contracts prevent callers from substituting a new unsafe renderer. */
export function generateJsonExport(_draft: EstimateDraft, _userId: string): JsonExport {
  return holdLegacyEstimateOperation("export");
}

export function generatePdfExport(_draft: EstimateDraft, _userId: string): Buffer {
  return holdLegacyEstimateOperation("export");
}

export function generatePrintableExport(_draft: EstimateDraft, _userId: string): PrintableExport {
  return holdLegacyEstimateOperation("export");
}
