/**
 * structr.ai — Drawing Intake Layer Type Contracts
 * TakeOff V1: Drawing Upload / Assisted Takeoff
 *
 * These types define the data contracts for the Drawing Intake module.
 * The module is an INPUT LAYER only — it never replaces deterministic engines.
 *
 * Flow: Drawing Upload → ScopeSource → Normalizer → scope_draft (existing pipeline)
 */

// ══════════════════════════════════════════════════════════════════════
// CONFIDENCE
// ══════════════════════════════════════════════════════════════════════

/** How a quantity was determined — transparency for human reviewers */
export const CONFIDENCE_LEVELS = ["measured", "scaled", "assumed", "ai_extracted"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  measured: "Measured (from drawing dimensions)",
  scaled: "Scaled (from drawing scale factor)",
  assumed: "Assumed (default or inferred)",
  ai_extracted: "AI-Extracted (requires validation)",
};

/** Numeric confidence weight — higher = more trustworthy */
export const CONFIDENCE_WEIGHTS: Record<ConfidenceLevel, number> = {
  measured: 1.0,
  scaled: 0.75,
  assumed: 0.5,
  ai_extracted: 0.3,
};

// ══════════════════════════════════════════════════════════════════════
// SOURCE TYPES
// ══════════════════════════════════════════════════════════════════════

export const SOURCE_TYPES = ["manual", "drawing", "narrative", "hybrid"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  manual: "Manual Entry",
  drawing: "Drawing Upload",
  narrative: "Narrative Description",
  hybrid: "Hybrid (Manual + Drawing)",
};

// ══════════════════════════════════════════════════════════════════════
// DRAWING
// ══════════════════════════════════════════════════════════════════════

export const SHEET_TYPES = ["floor_plan", "elevation", "section", "detail", "site", "other"] as const;
export type SheetType = (typeof SHEET_TYPES)[number];

export const DRAWING_STATUSES = ["uploaded", "processed", "extracted", "validated", "normalized"] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];

export const REVIEW_STATUSES = ["pending", "partial", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const RFI_STATUSES = ["open", "resolved", "dismissed", "promoted"] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

export const RFI_CATEGORIES = ["dimension", "material", "quantity", "spec", "conflict", "other"] as const;
export type RfiCategory = (typeof RFI_CATEGORIES)[number];

// ══════════════════════════════════════════════════════════════════════
// SCOPE SOURCE PAYLOAD (the normalized data inside payloadJson)
// ══════════════════════════════════════════════════════════════════════

/** A single quantity input — what was measured/entered and how confident we are */
export interface ScopeSourceMeasuredInput {
  field: string; // e.g. "total_area", "wall_linear_ft", "window_count"
  value: number;
  unit: string; // e.g. "SF", "LF", "EA"
  confidence: ConfidenceLevel;
  source: "manual" | "drawing";
  notes?: string;
}

/** A suggested assembly candidate from the drawing/manual analysis */
export interface ScopeSourceAssemblyCandidate {
  assemblyId: string;
  assemblyName: string;
  suggestedQuantity: number;
  unit: string;
  confidence: ConfidenceLevel;
  reason: string;
  /** If both manual and drawing exist, which one was used */
  source: "manual" | "drawing" | "merged";
  manualQuantity?: number;
  drawingQuantity?: number;
}

/** Confidence summary — counts per level */
export interface ConfidenceSummary {
  measured: number;
  scaled: number;
  assumed: number;
  ai_extracted: number;
  overall: number; // weighted average 0.0-1.0
}

/** The full normalized payload stored in scope_sources.payload_json */
export interface ScopeSourcePayload {
  sourceType: SourceType;
  projectId: string;
  drawingRevisionId?: string;
  measuredInputs: ScopeSourceMeasuredInput[];
  assemblyCandidates: ScopeSourceAssemblyCandidate[];
  assumptions: string[];
  confidenceSummary: ConfidenceSummary;
  rfiCandidateIds: string[];
  /** Context from intake/project — carried through for normalizer */
  context: {
    serviceType?: string;
    finishLevel?: string;
    channel?: string;
    zone?: string;
    projectType?: string;
  };
}

// ══════════════════════════════════════════════════════════════════════
// RFI CANDIDATE
// ══════════════════════════════════════════════════════════════════════

export interface RfiCandidateData {
  category: RfiCategory;
  question: string;
  context?: string;
  suggestedAnswer?: string;
}

// ══════════════════════════════════════════════════════════════════════
// NORMALIZER OUTPUT — maps to scope_draft + scope_draft_items
// ══════════════════════════════════════════════════════════════════════

/**
 * Output of ScopeSourceNormalizer.
 * This is the adapter between the Drawing Intake Layer and the existing pipeline.
 * It produces data compatible with createScopeDraft() + addScopeDraftItems().
 */
export interface NormalizedScopeOutput {
  /** Data for scope_drafts row */
  draft: {
    projectId: string;
    status: "draft";
    content: Record<string, unknown>;
    zone?: string;
    finishLevel?: string;
    serviceType?: string;
    channel?: string;
    confidence: number; // 0.0-1.0
    reason: string;
    createdBy?: string;
    warningsJson?: string[];
  };
  /** Data for scope_draft_items rows */
  items: Array<{
    assemblyId: string;
    assemblyName: string;
    quantity: number;
    unit: string;
    reason: string;
    confidence: number; // 0.0-1.0
    notes?: string;
    sortOrder: number;
  }>;
  /** Warnings that should be surfaced to the reviewer */
  warnings: string[];
}
