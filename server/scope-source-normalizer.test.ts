/**
 * structr.ai — ScopeSource Normalizer Tests
 * TakeOff V1: Unit tests for the normalization layer
 *
 * Tests the CRITICAL bridge between Drawing Intake and the existing pipeline.
 * The normalizer is pure (no DB, no side effects) — fully unit-testable.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeScopeSource,
  calculateConfidenceSummary,
} from "../shared/scope-source-normalizer";
import type {
  ScopeSourcePayload,
  ScopeSourceAssemblyCandidate,
  ConfidenceLevel,
} from "../shared/drawing-intake-types";

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function makePayload(
  overrides: Partial<ScopeSourcePayload> = {}
): ScopeSourcePayload {
  return {
    sourceType: "manual",
    projectId: "project-001",
    measuredInputs: [],
    assemblyCandidates: [],
    assumptions: [],
    confidenceSummary: { measured: 0, scaled: 0, assumed: 0, ai_extracted: 0, overall: 0 },
    rfiCandidateIds: [],
    context: {},
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<ScopeSourceAssemblyCandidate> = {}
): ScopeSourceAssemblyCandidate {
  return {
    assemblyId: "asm-001",
    assemblyName: "Kitchen Cabinets",
    suggestedQuantity: 10,
    unit: "LF",
    confidence: "measured",
    reason: "Measured from floor plan",
    source: "manual",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// normalizeScopeSource
// ══════════════════════════════════════════════════════════════════════

describe("normalizeScopeSource", () => {
  it("produces correct draft and items from valid payload", () => {
    const payload = makePayload({
      sourceType: "drawing",
      assemblyCandidates: [
        makeCandidate({ assemblyId: "asm-001", assemblyName: "Cabinets", suggestedQuantity: 15, confidence: "measured" }),
        makeCandidate({ assemblyId: "asm-002", assemblyName: "Countertops", suggestedQuantity: 25, unit: "SF", confidence: "scaled" }),
      ],
      context: {
        serviceType: "kitchen_remodel",
        finishLevel: "premium",
        channel: "direct",
        zone: "Charleston Urban",
      },
    });

    const result = normalizeScopeSource(payload, "user-001");

    // Draft
    expect(result.draft.projectId).toBe("project-001");
    expect(result.draft.status).toBe("draft");
    expect(result.draft.serviceType).toBe("kitchen_remodel");
    expect(result.draft.finishLevel).toBe("premium");
    expect(result.draft.channel).toBe("direct");
    expect(result.draft.createdBy).toBe("user-001");
    expect(result.draft.reason).toContain("drawing");

    // Items
    expect(result.items).toHaveLength(2);
    expect(result.items[0].assemblyId).toBe("asm-001");
    expect(result.items[0].quantity).toBe(15);
    expect(result.items[0].confidence).toBe(1.0); // measured = 1.0
    expect(result.items[0].sortOrder).toBe(1);

    expect(result.items[1].assemblyId).toBe("asm-002");
    expect(result.items[1].quantity).toBe(25);
    expect(result.items[1].confidence).toBe(0.75); // scaled = 0.75
    expect(result.items[1].sortOrder).toBe(2);
  });

  it("returns empty items and warning for empty candidates", () => {
    const payload = makePayload({ assemblyCandidates: [] });
    const result = normalizeScopeSource(payload);

    expect(result.items).toHaveLength(0);
    expect(result.warnings).toContain(
      "No assembly candidates found in scope source. Scope draft will be empty."
    );
  });

  it("warns on low-confidence items (assumed = 0.5)", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({ confidence: "assumed" }),
      ],
    });
    const result = normalizeScopeSource(payload);

    // assumed = 0.5, which is at threshold, not below
    expect(result.items).toHaveLength(1);
    // No low-confidence warning since 0.5 is not < 0.5
  });

  it("warns on ai_extracted items (score 0.3, below 0.5)", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({ confidence: "ai_extracted" }),
      ],
    });
    const result = normalizeScopeSource(payload);

    expect(result.items).toHaveLength(1);
    expect(result.warnings.some((w: string) => w.includes("Low confidence"))).toBe(true);
  });

  it("warns about open RFIs", () => {
    const payload = makePayload({
      assemblyCandidates: [makeCandidate()],
      rfiCandidateIds: ["rfi-001", "rfi-002"],
    });
    const result = normalizeScopeSource(payload);

    expect(result.warnings.some((w: string) => w.includes("2 RFI(s)"))).toBe(true);
  });

  it("calculates overall confidence as weighted average", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({ confidence: "measured" }),  // 1.0
        makeCandidate({ assemblyId: "asm-002", confidence: "scaled" }),   // 0.75
      ],
    });
    const result = normalizeScopeSource(payload);

    // (1.0 + 0.75) / 2 = 0.875 → rounded to 0.88
    expect(result.draft.confidence).toBe(0.88);
  });

  // ── Hybrid quantity resolution ───────────────────────────────────

  it("resolves merged quantity: averages when within 10% tolerance", () => {
    const payload = makePayload({
      sourceType: "hybrid",
      assemblyCandidates: [
        makeCandidate({
          source: "merged",
          manualQuantity: 100,
          drawingQuantity: 105, // 5% diff — within tolerance
          suggestedQuantity: 100, // fallback
          confidence: "measured",
        }),
      ],
    });
    const result = normalizeScopeSource(payload);

    // Average of 100 and 105 = 102.5
    expect(result.items[0].quantity).toBe(102.5);
    expect(result.items[0].notes).toContain("Manual: 100");
    expect(result.items[0].notes).toContain("Drawing: 105");
  });

  it("resolves merged quantity: favors manual when >10% conflict", () => {
    const payload = makePayload({
      sourceType: "hybrid",
      assemblyCandidates: [
        makeCandidate({
          source: "merged",
          manualQuantity: 100,
          drawingQuantity: 150, // 50% diff — conflict
          suggestedQuantity: 100,
          confidence: "measured",
        }),
      ],
    });
    const result = normalizeScopeSource(payload);

    // Conflict: favors manual
    expect(result.items[0].quantity).toBe(100);
    // B4: Must emit a conflict warning
    expect(result.warnings.some((w: string) => w.includes("CONFLICT"))).toBe(true);
    expect(result.warnings.some((w: string) => w.includes("manual=100"))).toBe(true);
    expect(result.warnings.some((w: string) => w.includes("drawing=150"))).toBe(true);
  });

  it("resolves merged quantity: uses manual when drawing is missing", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({
          source: "merged",
          manualQuantity: 50,
          drawingQuantity: undefined,
          suggestedQuantity: 50,
        }),
      ],
    });
    const result = normalizeScopeSource(payload);

    expect(result.items[0].quantity).toBe(50);
  });

  it("resolves merged quantity: uses drawing when manual is missing", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({
          source: "merged",
          manualQuantity: undefined,
          drawingQuantity: 75,
          suggestedQuantity: 75,
        }),
      ],
    });
    const result = normalizeScopeSource(payload);

    expect(result.items[0].quantity).toBe(75);
  });

  // ── Edge cases ───────────────────────────────────────────────────

  it("preserves content metadata in draft", () => {
    const payload = makePayload({
      sourceType: "hybrid",
      drawingRevisionId: "rev-001",
      measuredInputs: [
        { field: "area", value: 500, unit: "SF", confidence: "measured", source: "manual" },
      ],
      assemblyCandidates: [makeCandidate()],
      assumptions: ["Standard 8ft ceiling height"],
    });
    const result = normalizeScopeSource(payload);
    const content = result.draft.content as any;

    expect(content.scopeSourceType).toBe("hybrid");
    expect(content.drawingRevisionId).toBe("rev-001");
    expect(content.measuredInputCount).toBe(1);
    expect(content.assumptionCount).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// calculateConfidenceSummary
// ══════════════════════════════════════════════════════════════════════

describe("calculateConfidenceSummary", () => {
  it("counts levels correctly", () => {
    const levels: ConfidenceLevel[] = ["measured", "measured", "scaled", "assumed"];
    const summary = calculateConfidenceSummary(levels);

    expect(summary.measured).toBe(2);
    expect(summary.scaled).toBe(1);
    expect(summary.assumed).toBe(1);
    expect(summary.ai_extracted).toBe(0);
  });

  it("calculates weighted overall score", () => {
    const levels: ConfidenceLevel[] = ["measured", "scaled"];
    const summary = calculateConfidenceSummary(levels);

    // (1.0 + 0.75) / 2 = 0.875
    expect(summary.overall).toBe(0.875);
  });

  it("returns zeros for empty input", () => {
    const summary = calculateConfidenceSummary([]);

    expect(summary.measured).toBe(0);
    expect(summary.scaled).toBe(0);
    expect(summary.assumed).toBe(0);
    expect(summary.ai_extracted).toBe(0);
    expect(summary.overall).toBe(0);
  });

  it("handles all ai_extracted", () => {
    const levels: ConfidenceLevel[] = ["ai_extracted", "ai_extracted", "ai_extracted"];
    const summary = calculateConfidenceSummary(levels);

    expect(summary.ai_extracted).toBe(3);
    expect(summary.overall).toBeCloseTo(0.3);
  });
});

// ══════════════════════════════════════════════════════════════════════
// B4: Conflict warning tests
// ══════════════════════════════════════════════════════════════════════

describe("B4: conflict warnings", () => {
  it("does NOT emit conflict warning when within tolerance", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({
          source: "merged",
          manualQuantity: 100,
          drawingQuantity: 105, // 5% — within 10% tolerance
          suggestedQuantity: 100,
        }),
      ],
    });
    const result = normalizeScopeSource(payload);

    expect(result.warnings.some((w: string) => w.includes("CONFLICT"))).toBe(false);
  });

  it("emits conflict warning when values diverge at exactly boundary", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({
          source: "merged",
          manualQuantity: 100,
          drawingQuantity: 112, // 12% — just over 10% tolerance
          suggestedQuantity: 100,
        }),
      ],
    });
    const result = normalizeScopeSource(payload);

    expect(result.warnings.some((w: string) => w.includes("CONFLICT"))).toBe(true);
    // Must use manual value
    expect(result.items[0].quantity).toBe(100);
  });

  it("does NOT emit conflict warning for non-merged sources", () => {
    const payload = makePayload({
      assemblyCandidates: [
        makeCandidate({ source: "manual", suggestedQuantity: 100 }),
      ],
    });
    const result = normalizeScopeSource(payload);

    expect(result.warnings.some((w: string) => w.includes("CONFLICT"))).toBe(false);
  });
});
