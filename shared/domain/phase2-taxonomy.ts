/**
 * structr.ai — PHASE 2 Domain Taxonomy
 *
 * Closed vocabularies required by the Phase 2 contract (docs/phase2-contract.md):
 *   - Lead source channels           (gchi-lead-intake-governance, LIG-005)
 *   - Single next step per lead      (LIG-006)
 *   - Client types                   (minimum data set: "tipo de cliente")
 *   - Commercial channels            (Premium / Trade / Capital — margin floors)
 *   - Evidence classification        (FACT / CLIENT PROVIDED / INFERENCE / UNKNOWN)
 *   - Pre-visit next-step decisions  (single recommendation rule)
 *
 * PURE module: no DB, no IO, no side effects.
 *
 * Design note — why a separate file from `shared/domain/taxonomy.ts`:
 * the legacy taxonomy encodes the *pricing* channel (`direct | insurance | commercial`)
 * which is already persisted across estimates, bundles and multipliers. Phase 2 adds the
 * *commercial* channel (`premium | trade | capital`) that governs margin floors. Mixing
 * both into one enum would silently change pricing behaviour, so they are mapped
 * explicitly instead.
 */

// ══════════════════════════════════════════════════════════════════════
// LEAD SOURCE CHANNEL (LIG-005 — closed value, immutable as primary origin)
// ══════════════════════════════════════════════════════════════════════

export const LEAD_SOURCE_CHANNELS = [
  "organic_search",
  "paid_search",
  "website_direct",
  "referral",
  "repeat_client",
  "trade_partner",
  "social",
  "phone",
  "walk_in",
  "event",
  "import_approved",
  "other",
] as const;

export type LeadSourceChannel = (typeof LEAD_SOURCE_CHANNELS)[number];

/** Aliases accepted from legacy `leads.source` values and website payloads. */
const LEAD_SOURCE_CHANNEL_ALIASES: Record<string, LeadSourceChannel> = {
  web: "website_direct",
  website: "website_direct",
  site: "website_direct",
  web_form: "website_direct",
  landing_page: "website_direct",
  direct: "website_direct",
  organic: "organic_search",
  seo: "organic_search",
  google: "organic_search",
  google_organic: "organic_search",
  google_ads: "paid_search",
  adwords: "paid_search",
  ppc: "paid_search",
  paid: "paid_search",
  sem: "paid_search",
  houzz: "paid_search",
  ref: "referral",
  word_of_mouth: "referral",
  client_referral: "referral",
  repeat: "repeat_client",
  returning_client: "repeat_client",
  past_client: "repeat_client",
  builder: "trade_partner",
  gc: "trade_partner",
  trade: "trade_partner",
  architect: "trade_partner",
  designer: "trade_partner",
  instagram: "social",
  facebook: "social",
  linkedin: "social",
  tiktok: "social",
  call: "phone",
  inbound_call: "phone",
  telephone: "phone",
  walkin: "walk_in",
  office_visit: "walk_in",
  trade_show: "event",
  home_show: "event",
  expo: "event",
  import: "import_approved",
  migration: "import_approved",
  csv_import: "import_approved",
  email: "other",
  insurance: "other",
  unknown: "other",
};

// ══════════════════════════════════════════════════════════════════════
// NEXT STEP (LIG-006 — exactly one per active lead/intake)
// ══════════════════════════════════════════════════════════════════════

export const LEAD_NEXT_STEPS = [
  "request_intake",
  "qualification_call",
  "schedule_previsit",
  "nurture",
  "decline",
  "needs_review",
] as const;

export type LeadNextStep = (typeof LEAD_NEXT_STEPS)[number];

/**
 * Priority used to normalize a payload that (incorrectly) carries multiple
 * competing next steps into the single mandatory recommendation.
 * Higher number wins. `needs_review` outranks everything because an unresolved
 * review must never be silently replaced by a commercial action.
 */
export const LEAD_NEXT_STEP_PRIORITY: Record<LeadNextStep, number> = {
  needs_review: 60,
  decline: 50,
  schedule_previsit: 40,
  qualification_call: 30,
  request_intake: 20,
  nurture: 10,
};

// ══════════════════════════════════════════════════════════════════════
// CLIENT TYPE (minimum data set — "tipo de cliente")
// ══════════════════════════════════════════════════════════════════════

export const CLIENT_TYPES = [
  "homeowner",
  "builder",
  "investor",
  "property_manager",
  "commercial_owner",
  "insurance_carrier",
] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];

const CLIENT_TYPE_ALIASES: Record<string, ClientType> = {
  residential: "homeowner",
  owner: "homeowner",
  home_owner: "homeowner",
  private_owner: "homeowner",
  gc: "builder",
  general_contractor: "builder",
  trade: "builder",
  developer: "investor",
  capital: "investor",
  fund: "investor",
  flipper: "investor",
  pm: "property_manager",
  hoa: "property_manager",
  landlord: "property_manager",
  commercial: "commercial_owner",
  business_owner: "commercial_owner",
  carrier: "insurance_carrier",
  insurance: "insurance_carrier",
  adjuster: "insurance_carrier",
};

// ══════════════════════════════════════════════════════════════════════
// COMMERCIAL CHANNEL (margin floors — dossier §3.1)
// ══════════════════════════════════════════════════════════════════════

export const COMMERCIAL_CHANNELS = ["premium", "trade", "capital"] as const;

export type CommercialChannel = (typeof COMMERCIAL_CHANNELS)[number];

export const COMMERCIAL_CHANNEL_LABELS: Record<CommercialChannel, string> = {
  premium: "Premium / Homeowner",
  trade: "Trade / Builder",
  capital: "Capital / Investor",
};

const COMMERCIAL_CHANNEL_ALIASES: Record<string, CommercialChannel> = {
  // Premium / Homeowner
  homeowner: "premium",
  residential: "premium",
  direct: "premium",
  retail: "premium",
  owner: "premium",
  high_end: "premium",
  // Trade / Builder
  builder: "trade",
  gc: "trade",
  general_contractor: "trade",
  trade_partner: "trade",
  wholesale: "trade",
  commercial: "trade",
  commercial_buildout: "trade",
  // Capital / Investor
  investor: "capital",
  fund: "capital",
  developer: "capital",
  institutional: "capital",
  // Insurance work is priced through the insurance pricing channel, but its
  // commercial floor behaves like Trade (fixed scope, carrier-driven pricing).
  insurance: "trade",
  insurance_restoration: "trade",
};

/** Map a Phase 2 commercial channel to the legacy pricing channel. */
export const COMMERCIAL_TO_PRICING_CHANNEL: Record<
  CommercialChannel,
  "direct" | "insurance" | "commercial"
> = {
  premium: "direct",
  trade: "commercial",
  capital: "commercial",
};

/** Map a legacy pricing channel to the default commercial channel. */
export const PRICING_TO_COMMERCIAL_CHANNEL: Record<
  "direct" | "insurance" | "commercial",
  CommercialChannel
> = {
  direct: "premium",
  insurance: "trade",
  commercial: "trade",
};

// ══════════════════════════════════════════════════════════════════════
// EVIDENCE CLASSIFICATION (dossier §3.2 — FACT / CLIENT PROVIDED / INFERENCE / UNKNOWN)
// ══════════════════════════════════════════════════════════════════════

export const EVIDENCE_CLASSES = [
  "FACT",
  "CLIENT_PROVIDED",
  "INFERENCE",
  "UNKNOWN",
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const EVIDENCE_CLASS_LABELS: Record<EvidenceClass, string> = {
  FACT: "FACT",
  CLIENT_PROVIDED: "CLIENT PROVIDED",
  INFERENCE: "INFERENCE",
  UNKNOWN: "UNKNOWN",
};

const EVIDENCE_CLASS_ALIASES: Record<string, EvidenceClass> = {
  fact: "FACT",
  verified: "FACT",
  confirmed: "FACT",
  measured: "FACT",
  client_provided: "CLIENT_PROVIDED",
  "client provided": "CLIENT_PROVIDED",
  client: "CLIENT_PROVIDED",
  reported: "CLIENT_PROVIDED",
  stated: "CLIENT_PROVIDED",
  inference: "INFERENCE",
  inferred: "INFERENCE",
  assumption: "INFERENCE",
  assumed: "INFERENCE",
  estimated: "INFERENCE",
  unknown: "UNKNOWN",
  missing: "UNKNOWN",
  tbd: "UNKNOWN",
  na: "UNKNOWN",
};

/** Evidence classes that may support a final price without further verification. */
export const PRICE_GRADE_EVIDENCE: readonly EvidenceClass[] = ["FACT"] as const;

/** True when the evidence class may feed a final price (LIG-008). */
export function isPriceGradeEvidence(evidence: EvidenceClass): boolean {
  return PRICE_GRADE_EVIDENCE.includes(evidence);
}

// ══════════════════════════════════════════════════════════════════════
// PRE-VISIT NEXT STEP (dossier §3.2 — single main recommendation)
// ══════════════════════════════════════════════════════════════════════

export const PREVISIT_NEXT_STEPS = [
  "conceptual_estimate",
  "survey_zoning_verification",
  "design",
  "structural_evaluation",
  "paid_preconstruction",
  "design_build_proposal",
] as const;

export type PrevisitNextStep = (typeof PREVISIT_NEXT_STEPS)[number];

export const PREVISIT_NEXT_STEP_LABELS: Record<PrevisitNextStep, string> = {
  conceptual_estimate: "Conceptual Estimate",
  survey_zoning_verification: "Survey / Zoning Verification",
  design: "Design",
  structural_evaluation: "Structural Evaluation",
  paid_preconstruction: "Paid Preconstruction",
  design_build_proposal: "Design-Build Proposal",
};

const PREVISIT_NEXT_STEP_ALIASES: Record<string, PrevisitNextStep> = {
  conceptual: "conceptual_estimate",
  concept_estimate: "conceptual_estimate",
  budget_range: "conceptual_estimate",
  survey: "survey_zoning_verification",
  zoning: "survey_zoning_verification",
  survey_zoning: "survey_zoning_verification",
  architectural_design: "design",
  design_phase: "design",
  structural: "structural_evaluation",
  engineering: "structural_evaluation",
  engineer_review: "structural_evaluation",
  preconstruction: "paid_preconstruction",
  precon: "paid_preconstruction",
  paid_precon: "paid_preconstruction",
  design_build: "design_build_proposal",
  full_proposal: "design_build_proposal",
};

/**
 * Only these decisions authorize an estimate-oriented downstream flow.
 * The remaining decisions require verification work before pricing.
 */
export const PREVISIT_STEPS_ALLOWING_ESTIMATE: readonly PrevisitNextStep[] = [
  "conceptual_estimate",
  "design_build_proposal",
  "paid_preconstruction",
] as const;

// ══════════════════════════════════════════════════════════════════════
// NORMALIZERS (idempotent, never throw, unknown → null)
// ══════════════════════════════════════════════════════════════════════

function buildLookup<T extends string>(
  canonicals: readonly T[],
  aliases: Record<string, T>,
): (input: string | null | undefined) => T | null {
  const map = new Map<string, T>();
  for (const c of canonicals) map.set(c.toLowerCase(), c);
  for (const [alias, canonical] of Object.entries(aliases)) {
    map.set(alias.toLowerCase().replace(/\s+/g, "_"), canonical);
  }
  return (input: string | null | undefined): T | null => {
    if (input == null || input === "") return null;
    const key = String(input).trim().toLowerCase().replace(/\s+/g, "_");
    return map.get(key) ?? null;
  };
}

export const normalizeLeadSourceChannel = buildLookup(
  LEAD_SOURCE_CHANNELS,
  LEAD_SOURCE_CHANNEL_ALIASES,
);

export const normalizeLeadNextStep = buildLookup(LEAD_NEXT_STEPS, {
  intake: "request_intake",
  send_intake: "request_intake",
  call: "qualification_call",
  qualify: "qualification_call",
  previsit: "schedule_previsit",
  site_visit: "schedule_previsit",
  schedule_visit: "schedule_previsit",
  follow_up: "nurture",
  later: "nurture",
  reject: "decline",
  disqualify: "decline",
  review: "needs_review",
});

export const normalizeClientType = buildLookup(CLIENT_TYPES, CLIENT_TYPE_ALIASES);

export const normalizeCommercialChannel = buildLookup(
  COMMERCIAL_CHANNELS,
  COMMERCIAL_CHANNEL_ALIASES,
);

export const normalizeEvidenceClass = buildLookup(
  EVIDENCE_CLASSES,
  EVIDENCE_CLASS_ALIASES,
);

export const normalizePrevisitNextStep = buildLookup(
  PREVISIT_NEXT_STEPS,
  PREVISIT_NEXT_STEP_ALIASES,
);

/**
 * Reduce a list of competing next steps to the single mandatory recommendation.
 * Returns the winner plus every discarded option, so the caller can audit the
 * normalization instead of losing the operator's original intent (LIG-006).
 */
export function resolveSingleNextStep(
  candidates: Array<string | null | undefined>,
): { nextStep: LeadNextStep | null; discarded: LeadNextStep[] } {
  const normalized = candidates
    .map((c) => normalizeLeadNextStep(c))
    .filter((c): c is LeadNextStep => c !== null);

  if (normalized.length === 0) return { nextStep: null, discarded: [] };

  const unique = Array.from(new Set(normalized));
  const sorted = [...unique].sort(
    (a, b) => LEAD_NEXT_STEP_PRIORITY[b] - LEAD_NEXT_STEP_PRIORITY[a],
  );

  return { nextStep: sorted[0], discarded: sorted.slice(1) };
}
