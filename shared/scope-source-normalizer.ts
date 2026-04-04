/**
 * structr.ai — ScopeSource Normalizer
 * TakeOff V1: Converts ScopeSource payloads into scope_draft-compatible output
 *
 * This is the CRITICAL bridge between the Drawing Intake Layer and the existing pipeline.
 *
 * Input:  ScopeSourcePayload (manual + drawing + confidence flags)
 * Output: NormalizedScopeOutput (compatible with createScopeDraft + addScopeDraftItems)
 *
 * RULES:
 *   1. Does NOT modify pricing or assembly definitions
 *   2. Does NOT bypass scope review
 *   3. Does NOT inject AI metadata into deterministic fields
 *   4. Merges manual + drawing quantities using confidence-weighted resolution
 *   5. Flags low-confidence items as warnings
 *   6. Preserves full traceability
 */

import type {
  ScopeSourcePayload,
  ScopeSourceAssemblyCandidate,
  ConfidenceLevel,
  ConfidenceSummary,
  NormalizedScopeOutput,
} from "./drawing-intake-types";
import { CONFIDENCE_WEIGHTS } from "./drawing-intake-types";

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Below this confidence, the item generates a warning */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Below this confidence, the item is excluded from scope (needs RFI) */
const EXCLUDE_CONFIDENCE_THRESHOLD = 0.2;

/** Maximum allowed divergence between manual and drawing before flagging conflict */
const CONFLICT_TOLERANCE = 0.10;

// ══════════════════════════════════════════════════════════════════════
// NORMALIZER
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize a ScopeSource payload into a scope_draft-compatible structure.
 *
 * This function is PURE — no database access, no side effects.
 * It can be unit-tested independently.
 */
export function normalizeScopeSource(
  payload: ScopeSourcePayload,
  createdBy?: string
): NormalizedScopeOutput {
  const warnings: string[] = [];
  const items: NormalizedScopeOutput["items"] = [];

  // ── Validate inputs ──────────────────────────────────────────────
  if (!payload.assemblyCandidates || payload.assemblyCandidates.length === 0) {
    warnings.push("No assembly candidates found in scope source. Scope draft will be empty.");
    return {
      draft: buildDraftData(payload, 0, warnings, createdBy),
      items: [],
      warnings,
    };
  }

  // ── Process assembly candidates ──────────────────────────────────
  let sortOrder = 0;
  for (const candidate of payload.assemblyCandidates) {
    const confidenceScore = CONFIDENCE_WEIGHTS[candidate.confidence] ?? 0.5;

    // Skip items below exclusion threshold
    if (confidenceScore < EXCLUDE_CONFIDENCE_THRESHOLD) {
      warnings.push(
        `Excluded "${candidate.assemblyName}" (confidence: ${candidate.confidence}, score: ${confidenceScore}). Needs RFI resolution.`
      );
      continue;
    }

    // Warn on low confidence
    if (confidenceScore < LOW_CONFIDENCE_THRESHOLD) {
      warnings.push(
        `Low confidence on "${candidate.assemblyName}" (${candidate.confidence}). Human review recommended.`
      );
    }

    // Resolve quantity: use merged logic if hybrid
    const resolved = resolveQuantity(candidate);

    // B4: Warn on quantity conflicts (manual vs drawing diverge >10%)
    if (resolved.conflict) {
      warnings.push(
        `CONFLICT on "${candidate.assemblyName}": manual=${candidate.manualQuantity}, drawing=${candidate.drawingQuantity} (>${(CONFLICT_TOLERANCE * 100).toFixed(0)}% divergence). Manual value used.`
      );
    }

    sortOrder++;
    items.push({
      assemblyId: candidate.assemblyId,
      assemblyName: candidate.assemblyName,
      quantity: resolved.quantity,
      unit: candidate.unit,
      reason: buildReason(candidate),
      confidence: confidenceScore,
      notes: candidate.source === "merged"
        ? `Manual: ${candidate.manualQuantity ?? "N/A"}, Drawing: ${candidate.drawingQuantity ?? "N/A"}`
        : undefined,
      sortOrder,
    });
  }

  // ── Calculate overall confidence ─────────────────────────────────
  const overallConfidence = items.length > 0
    ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length
    : 0;

  // ── Check for empty result ───────────────────────────────────────
  if (items.length === 0) {
    warnings.push("All assembly candidates were excluded due to low confidence. Manual entry required.");
  }

  // ── Check for open RFIs ──────────────────────────────────────────
  if (payload.rfiCandidateIds.length > 0) {
    warnings.push(`${payload.rfiCandidateIds.length} RFI(s) remain unresolved. Review before finalizing scope.`);
  }

  return {
    draft: buildDraftData(payload, overallConfidence, warnings, createdBy),
    items,
    warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════
// QUANTITY RESOLUTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve the final quantity for a candidate.
 *
 * Strategy:
 *   - "manual" source → use suggestedQuantity directly
 *   - "drawing" source → use suggestedQuantity directly
 *   - "merged" source → weighted average favoring the higher-confidence input
 *     (manual is typically "measured" or "assumed", drawing is "scaled" or "ai_extracted")
 */
interface QuantityResolution {
  quantity: number;
  conflict: boolean;
}

function resolveQuantity(candidate: ScopeSourceAssemblyCandidate): QuantityResolution {
  if (candidate.source !== "merged") {
    return { quantity: candidate.suggestedQuantity, conflict: false };
  }

  const manual = candidate.manualQuantity;
  const drawing = candidate.drawingQuantity;

  // If only one exists, use it
  if (manual != null && drawing == null) return { quantity: manual, conflict: false };
  if (drawing != null && manual == null) return { quantity: drawing, conflict: false };
  if (manual == null && drawing == null) return { quantity: candidate.suggestedQuantity, conflict: false };

  // Both exist — check for conflicts
  const manualVal = manual!;
  const drawingVal = drawing!;
  const diff = Math.abs(manualVal - drawingVal);
  const avg = (manualVal + drawingVal) / 2;

  // If within tolerance, average them
  if (avg > 0 && diff / avg <= CONFLICT_TOLERANCE) {
    return { quantity: Math.round(avg * 100) / 100, conflict: false };
  }

  // Conflict: favor manual (human-entered) over drawing (extracted)
  return { quantity: manualVal, conflict: true };
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function buildReason(candidate: ScopeSourceAssemblyCandidate): string {
  const sourceLabel =
    candidate.source === "merged" ? "hybrid input (manual + drawing)"
    : candidate.source === "manual" ? "manual entry"
    : "drawing extraction";

  return `${candidate.reason} [source: ${sourceLabel}, confidence: ${candidate.confidence}]`;
}

function buildDraftData(
  payload: ScopeSourcePayload,
  overallConfidence: number,
  warnings: string[],
  createdBy?: string
): NormalizedScopeOutput["draft"] {
  return {
    projectId: payload.projectId,
    status: "draft" as const,
    content: {
      scopeSourceType: payload.sourceType,
      drawingRevisionId: payload.drawingRevisionId ?? null,
      measuredInputCount: payload.measuredInputs.length,
      assemblyCandidateCount: payload.assemblyCandidates.length,
      assumptionCount: payload.assumptions.length,
      confidenceSummary: payload.confidenceSummary,
    },
    zone: payload.context.zone,
    finishLevel: payload.context.finishLevel,
    serviceType: payload.context.serviceType,
    channel: payload.context.channel,
    confidence: Math.round(overallConfidence * 100) / 100,
    reason: `Generated from ${payload.sourceType} scope source`,
    createdBy,
    warningsJson: warnings.length > 0 ? warnings : undefined,
  };
}

// ══════════════════════════════════════════════════════════════════════
// CONFIDENCE SUMMARY CALCULATOR
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate confidence summary from a list of confidence levels.
 * Utility for building the confidenceSummaryJson field.
 */
export function calculateConfidenceSummary(
  levels: ConfidenceLevel[]
): ConfidenceSummary {
  const counts: ConfidenceSummary = {
    measured: 0,
    scaled: 0,
    assumed: 0,
    ai_extracted: 0,
    overall: 0,
  };

  if (levels.length === 0) return counts;

  for (const level of levels) {
    counts[level]++;
  }

  counts.overall =
    levels.reduce((sum, level) => sum + CONFIDENCE_WEIGHTS[level], 0) / levels.length;

  return counts;
}
