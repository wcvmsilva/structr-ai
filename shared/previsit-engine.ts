/**
 * structr.ai — PHASE 2 Pre-Visit Intelligence Engine
 *
 * PURE engine for the pre-visit gate described in docs/phase2-contract.md §4.
 * Derived from the dossier (§3.2) and gchi-previsit-intelligence:
 *
 *   - Every relevant field carries an evidence class:
 *       FACT | CLIENT PROVIDED | INFERENCE | UNKNOWN
 *   - The pre-visit NEVER emits a definitive price.
 *   - The visit closes with exactly ONE main recommendation.
 *   - A field inspection checklist is derived from UNKNOWN items and coastal risk.
 *
 * No DB, no IO, no randomness (timestamps are injected by the caller).
 */

import {
  isPriceGradeEvidence,
  normalizeEvidenceClass,
  normalizePrevisitNextStep,
  PREVISIT_NEXT_STEPS,
  PREVISIT_STEPS_ALLOWING_ESTIMATE,
  type EvidenceClass,
  type PrevisitNextStep,
} from "./domain/phase2-taxonomy";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Sections of the Pre-Visit Project Brief. */
export const BRIEF_SECTIONS = [
  "client_context",
  "property_context",
  "jurisdiction",
  "coastal_exposure",
  "structural_condition",
  "scope_intent",
  "access_logistics",
  "schedule_expectation",
  "budget_expectation",
] as const;

export type BriefSection = (typeof BRIEF_SECTIONS)[number];

/** A single classified data point inside the brief. */
export interface EvidenceItem {
  /** Stable key, e.g. "foundation_type". */
  key: string;
  section: BriefSection;
  label: string;
  /** Raw value as captured. `null` is expected for UNKNOWN. */
  value: string | number | boolean | null;
  evidence: EvidenceClass;
  /** Where the value came from: inspector, client statement, county GIS, rule id, ... */
  source?: string | null;
  /** Required when evidence is INFERENCE — how the value was derived. */
  rationale?: string | null;
  /** True when this field must be verified before it can support a price. */
  blocksPricing?: boolean;
}

export interface PrevisitBriefInput {
  tenantId: string | null;
  projectId: string;
  intakeFormId?: string | null;
  /** Free-text executive summary written by the operator. */
  summary?: string | null;
  items: EvidenceItem[];
  /** Candidate next steps. Exactly one survives. */
  nextStepCandidates?: Array<string | null | undefined>;
  /** Rationale for the chosen next step. */
  nextStepRationale?: string | null;
  /** Geo warnings already resolved for the project (coastal, zone, radius). */
  geoWarnings?: string[];
  /** Operator/inspector identity. */
  preparedBy?: string | null;
  /** Injected timestamp (ISO string) — keeps the engine deterministic. */
  generatedAt?: string;
}

export interface ChecklistItem {
  key: string;
  section: BriefSection;
  label: string;
  /** Why this item exists: unresolved unknown, coastal risk, pricing dependency. */
  reason: string;
  required: boolean;
  /** Source evidence key that generated the item, when applicable. */
  sourceKey: string | null;
}

export interface EvidenceSummary {
  total: number;
  byClass: Record<EvidenceClass, number>;
  /** Percentage of items classified as FACT (0-100, 1 decimal). */
  factCoveragePct: number;
  /** Keys still UNKNOWN. */
  unknownKeys: string[];
  /** Keys classified as INFERENCE. */
  inferenceKeys: string[];
  /** Keys that block final pricing. */
  pricingBlockers: string[];
}

export interface PrevisitBrief {
  tenantId: string | null;
  projectId: string;
  intakeFormId: string | null;
  summary: string | null;
  items: EvidenceItem[];
  evidenceSummary: EvidenceSummary;
  nextStep: PrevisitNextStep;
  nextStepRationale: string | null;
  discardedNextSteps: PrevisitNextStep[];
  checklist: ChecklistItem[];
  geoWarnings: string[];
  warnings: string[];
  /** Always false — a brief never carries a definitive price. */
  emitsDefinitivePrice: false;
  preparedBy: string | null;
  generatedAt: string;
}

export interface PrevisitValidationError {
  field: string;
  message: string;
  ruleId: string;
}

// ══════════════════════════════════════════════════════════════════════
// PRICE-LANGUAGE GUARD (pre-visit never emits a definitive price)
// ══════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate a definitive price commitment in free text.
 * Ranges and explicit "not a quote" phrasing are allowed; fixed totals are not.
 */
const DEFINITIVE_PRICE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfinal\s+(price|cost|total|number)\b/i, label: "final price" },
  { pattern: /\bfixed\s+(price|cost|bid|fee)\b/i, label: "fixed price" },
  { pattern: /\blocked[-\s]?in\s+(price|cost)\b/i, label: "locked-in price" },
  { pattern: /\bfirm\s+(quote|bid|price)\b/i, label: "firm quote" },
  { pattern: /\bcontract\s+(price|amount)\b/i, label: "contract price" },
  { pattern: /\bguarantee[ds]?\s+(price|cost|total)\b/i, label: "guaranteed price" },
  { pattern: /\bthe\s+(price|cost)\s+(is|will\s+be)\s*\$/i, label: "committed price" },
  { pattern: /\btotal\s+(is|will\s+be)\s*\$/i, label: "committed total" },
];

export interface PriceLanguageFinding {
  label: string;
  excerpt: string;
}

/**
 * Detect definitive-price language in pre-visit text.
 * Conceptual ranges ("$180k–$220k range", "order of magnitude") are permitted.
 */
export function detectDefinitivePriceLanguage(
  text: string | null | undefined,
): PriceLanguageFinding[] {
  if (!text || String(text).trim() === "") return [];
  const value = String(text);
  const findings: PriceLanguageFinding[] = [];

  for (const { pattern, label } of DEFINITIVE_PRICE_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      findings.push({ label, excerpt: match[0] });
    }
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════
// EVIDENCE
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize an evidence item.
 * Unknown/missing classifications degrade to UNKNOWN — never to FACT.
 */
export function normalizeEvidenceItem(item: EvidenceItem): EvidenceItem {
  const evidence = normalizeEvidenceClass(item.evidence) ?? "UNKNOWN";
  const value = item.value === undefined ? null : item.value;

  // An item with no value cannot be a FACT or a CLIENT PROVIDED statement.
  const effective: EvidenceClass =
    value === null || value === "" ? (evidence === "INFERENCE" ? "INFERENCE" : "UNKNOWN") : evidence;

  return {
    ...item,
    value,
    evidence: effective,
    source: item.source ?? null,
    rationale: item.rationale ?? null,
    blocksPricing: item.blocksPricing ?? !isPriceGradeEvidence(effective),
  };
}

/** Aggregate evidence statistics for the brief. */
export function summarizeEvidence(items: EvidenceItem[]): EvidenceSummary {
  const byClass: Record<EvidenceClass, number> = {
    FACT: 0,
    CLIENT_PROVIDED: 0,
    INFERENCE: 0,
    UNKNOWN: 0,
  };

  const unknownKeys: string[] = [];
  const inferenceKeys: string[] = [];
  const pricingBlockers: string[] = [];

  for (const raw of items) {
    const item = normalizeEvidenceItem(raw);
    byClass[item.evidence] += 1;
    if (item.evidence === "UNKNOWN") unknownKeys.push(item.key);
    if (item.evidence === "INFERENCE") inferenceKeys.push(item.key);
    if (item.blocksPricing) pricingBlockers.push(item.key);
  }

  const total = items.length;
  const factCoveragePct = total === 0 ? 0 : Math.round((byClass.FACT / total) * 1000) / 10;

  return { total, byClass, factCoveragePct, unknownKeys, inferenceKeys, pricingBlockers };
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a brief payload before persistence.
 * Blocking conditions:
 *   - missing projectId
 *   - INFERENCE without rationale (LIG-008: inference must stay visible and justified)
 *   - definitive price language in the summary or in any rationale
 *   - zero evidence items
 */
export function validatePrevisitBriefInput(
  input: PrevisitBriefInput,
): PrevisitValidationError[] {
  const errors: PrevisitValidationError[] = [];

  if (!input.projectId || String(input.projectId).trim() === "") {
    errors.push({
      field: "projectId",
      message: "Pre-visit brief must be linked to a canonical project_id.",
      ruleId: "LIG-010",
    });
  }

  if (!input.items || input.items.length === 0) {
    errors.push({
      field: "items",
      message: "Pre-visit brief requires at least one classified evidence item.",
      ruleId: "PVI-001",
    });
  }

  const seenKeys = new Set<string>();
  for (const raw of input.items ?? []) {
    const item = normalizeEvidenceItem(raw);

    if (!item.key || item.key.trim() === "") {
      errors.push({
        field: "items.key",
        message: "Every evidence item requires a stable key.",
        ruleId: "PVI-001",
      });
      continue;
    }

    if (seenKeys.has(item.key)) {
      errors.push({
        field: `items.${item.key}`,
        message: `Duplicate evidence key "${item.key}".`,
        ruleId: "PVI-001",
      });
    }
    seenKeys.add(item.key);

    if (item.evidence === "INFERENCE" && (!item.rationale || item.rationale.trim() === "")) {
      errors.push({
        field: `items.${item.key}`,
        message: `Item "${item.key}" is INFERENCE and requires a rationale — inference can never be presented as fact (LIG-008).`,
        ruleId: "LIG-008",
      });
    }

    if (item.evidence === "FACT" && (!item.source || item.source.trim() === "")) {
      errors.push({
        field: `items.${item.key}`,
        message: `Item "${item.key}" is classified FACT and requires a verifiable source.`,
        ruleId: "LIG-008",
      });
    }

    for (const finding of detectDefinitivePriceLanguage(item.rationale)) {
      errors.push({
        field: `items.${item.key}.rationale`,
        message: `Pre-visit cannot emit a definitive price (found "${finding.excerpt}" — ${finding.label}).`,
        ruleId: "PVI-002",
      });
    }
  }

  for (const finding of detectDefinitivePriceLanguage(input.summary)) {
    errors.push({
      field: "summary",
      message: `Pre-visit cannot emit a definitive price (found "${finding.excerpt}" — ${finding.label}).`,
      ruleId: "PVI-002",
    });
  }

  for (const finding of detectDefinitivePriceLanguage(input.nextStepRationale)) {
    errors.push({
      field: "nextStepRationale",
      message: `Pre-visit cannot emit a definitive price (found "${finding.excerpt}" — ${finding.label}).`,
      ruleId: "PVI-002",
    });
  }

  const candidates = (input.nextStepCandidates ?? [])
    .map((c) => normalizePrevisitNextStep(c))
    .filter((c): c is PrevisitNextStep => c !== null);

  if (candidates.length === 0) {
    errors.push({
      field: "nextStepCandidates",
      message: `Pre-visit must close with exactly one recommendation. Allowed: ${PREVISIT_NEXT_STEPS.join(", ")}.`,
      ruleId: "PVI-003",
    });
  }

  return errors;
}

// ══════════════════════════════════════════════════════════════════════
// SINGLE DECISION
// ══════════════════════════════════════════════════════════════════════

/**
 * Priority used to reduce competing recommendations to one.
 * Verification-first: when the operator hesitates between verifying a condition and
 * pricing it, verification wins. That is exactly the discipline the dossier requires.
 */
export const PREVISIT_NEXT_STEP_PRIORITY: Record<PrevisitNextStep, number> = {
  structural_evaluation: 60,
  survey_zoning_verification: 50,
  paid_preconstruction: 40,
  design: 30,
  design_build_proposal: 20,
  conceptual_estimate: 10,
};

export interface PrevisitDecision {
  nextStep: PrevisitNextStep;
  discarded: PrevisitNextStep[];
  /** True when this decision authorizes moving toward an estimate. */
  allowsEstimate: boolean;
  /** Explanation of why a competing option was dropped. */
  normalizationNote: string | null;
}

/** Reduce the candidate list to the single mandatory recommendation. */
export function resolvePrevisitDecision(
  candidates: Array<string | null | undefined>,
): PrevisitDecision | null {
  const normalized = candidates
    .map((c) => normalizePrevisitNextStep(c))
    .filter((c): c is PrevisitNextStep => c !== null);

  if (normalized.length === 0) return null;

  const unique = Array.from(new Set(normalized));
  const sorted = [...unique].sort(
    (a, b) => PREVISIT_NEXT_STEP_PRIORITY[b] - PREVISIT_NEXT_STEP_PRIORITY[a],
  );

  const nextStep = sorted[0];
  const discarded = sorted.slice(1);

  return {
    nextStep,
    discarded,
    allowsEstimate: PREVISIT_STEPS_ALLOWING_ESTIMATE.includes(nextStep),
    normalizationNote:
      discarded.length > 0
        ? `Multiple recommendations received; verification-first priority selected "${nextStep}" and recorded discarded options: ${discarded.join(", ")}.`
        : null,
  };
}

// ══════════════════════════════════════════════════════════════════════
// FIELD INSPECTION CHECKLIST
// ══════════════════════════════════════════════════════════════════════

/** Baseline coastal checklist items required in the Charleston / hurricane context. */
const COASTAL_CHECKLIST_SEEDS: Array<{ key: string; section: BriefSection; label: string }> = [
  {
    key: "coastal_wind_exposure_confirmed",
    section: "coastal_exposure",
    label: "Confirm wind exposure category and design wind speed on site",
  },
  {
    key: "coastal_flood_zone_confirmed",
    section: "coastal_exposure",
    label: "Confirm FEMA flood zone and finished floor elevation reference",
  },
  {
    key: "coastal_corrosion_check",
    section: "coastal_exposure",
    label: "Inspect fasteners, connectors and flashing for salt-air corrosion",
  },
];

/**
 * Build the field inspection checklist for a brief.
 *
 * Rules:
 *   - Every UNKNOWN evidence item becomes a required checklist item.
 *   - Every INFERENCE item becomes a required verification item (it cannot price as-is).
 *   - Coastal geo warnings add the baseline coastal seeds.
 *   - Deduplicated by key, deterministic order (brief order, then coastal seeds).
 */
export function buildFieldChecklist(
  items: EvidenceItem[],
  geoWarnings: string[] = [],
): ChecklistItem[] {
  const checklist: ChecklistItem[] = [];
  const seen = new Set<string>();

  const push = (entry: ChecklistItem) => {
    if (seen.has(entry.key)) return;
    seen.add(entry.key);
    checklist.push(entry);
  };

  for (const raw of items) {
    const item = normalizeEvidenceItem(raw);

    if (item.evidence === "UNKNOWN") {
      push({
        key: `verify_${item.key}`,
        section: item.section,
        label: `Capture ${item.label}`,
        reason: "Field is UNKNOWN and must be captured before pricing.",
        required: true,
        sourceKey: item.key,
      });
      continue;
    }

    if (item.evidence === "INFERENCE") {
      push({
        key: `confirm_${item.key}`,
        section: item.section,
        label: `Confirm ${item.label}`,
        reason: `Value is an INFERENCE (${item.rationale ?? "no rationale"}) and must be verified before it can support a final price.`,
        required: true,
        sourceKey: item.key,
      });
      continue;
    }

    if (item.evidence === "CLIENT_PROVIDED") {
      push({
        key: `validate_${item.key}`,
        section: item.section,
        label: `Validate ${item.label}`,
        reason: "Value is CLIENT PROVIDED and has not been verified by GCHI.",
        required: false,
        sourceKey: item.key,
      });
    }
  }

  const coastalSignal = geoWarnings.some((w) =>
    /coastal|barrier|flood|wind|hurricane/i.test(w),
  );
  if (coastalSignal) {
    for (const seed of COASTAL_CHECKLIST_SEEDS) {
      push({
        key: seed.key,
        section: seed.section,
        label: seed.label,
        reason: "Coastal exposure detected by geo context.",
        required: true,
        sourceKey: null,
      });
    }
  }

  return checklist;
}

// ══════════════════════════════════════════════════════════════════════
// BRIEF BUILDER
// ══════════════════════════════════════════════════════════════════════

/**
 * Build the Pre-Visit Project Brief.
 * @throws Error when the payload violates a blocking rule — callers must validate first.
 */
export function buildPrevisitBrief(input: PrevisitBriefInput): PrevisitBrief {
  const errors = validatePrevisitBriefInput(input);
  if (errors.length > 0) {
    throw new Error(
      `Pre-visit brief validation failed: ${errors.map((e) => `[${e.ruleId}] ${e.message}`).join("; ")}`,
    );
  }

  const items = input.items.map(normalizeEvidenceItem);
  const evidenceSummary = summarizeEvidence(items);
  const decision = resolvePrevisitDecision(input.nextStepCandidates ?? []);

  if (!decision) {
    throw new Error("Pre-visit brief validation failed: no valid next step recommendation.");
  }

  const geoWarnings = input.geoWarnings ?? [];
  const checklist = buildFieldChecklist(items, geoWarnings);

  const warnings: string[] = [];
  if (decision.normalizationNote) warnings.push(decision.normalizationNote);
  if (evidenceSummary.byClass.UNKNOWN > 0) {
    warnings.push(
      `${evidenceSummary.byClass.UNKNOWN} field(s) are UNKNOWN and generated required checklist items.`,
    );
  }
  if (evidenceSummary.byClass.INFERENCE > 0) {
    warnings.push(
      `${evidenceSummary.byClass.INFERENCE} field(s) are INFERENCE and cannot support a final price without verification (LIG-008).`,
    );
  }
  if (decision.allowsEstimate && evidenceSummary.pricingBlockers.length > 0) {
    warnings.push(
      `Recommendation "${decision.nextStep}" moves toward pricing, but ${evidenceSummary.pricingBlockers.length} field(s) are not FACT yet. Estimate must be treated as conceptual until verified.`,
    );
  }

  return {
    tenantId: input.tenantId ?? null,
    projectId: input.projectId,
    intakeFormId: input.intakeFormId ?? null,
    summary: input.summary ?? null,
    items,
    evidenceSummary,
    nextStep: decision.nextStep,
    nextStepRationale: input.nextStepRationale ?? null,
    discardedNextSteps: decision.discarded,
    checklist,
    geoWarnings,
    warnings,
    emitsDefinitivePrice: false,
    preparedBy: input.preparedBy ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════
// READINESS
// ══════════════════════════════════════════════════════════════════════

export interface PrevisitReadiness {
  /** True when the brief may be promoted to "completed". */
  canComplete: boolean;
  blockers: string[];
  warnings: string[];
  requiredChecklistOpen: number;
}

/**
 * Assess whether a brief can be completed.
 * Required checklist items must be resolved; optional ones only warn.
 */
export function assessPrevisitReadiness(
  brief: Pick<PrevisitBrief, "checklist" | "evidenceSummary" | "nextStep">,
  completedChecklistKeys: string[] = [],
): PrevisitReadiness {
  const completed = new Set(completedChecklistKeys);
  const openRequired = brief.checklist.filter((c) => c.required && !completed.has(c.key));
  const openOptional = brief.checklist.filter((c) => !c.required && !completed.has(c.key));

  const blockers = openRequired.map(
    (c) => `Required checklist item "${c.key}" (${c.label}) is still open.`,
  );
  const warnings = openOptional.length > 0
    ? [`${openOptional.length} optional checklist item(s) remain open.`]
    : [];

  return {
    canComplete: blockers.length === 0,
    blockers,
    warnings,
    requiredChecklistOpen: openRequired.length,
  };
}
