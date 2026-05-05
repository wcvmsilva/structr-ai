/**
 * structr.ai Domain Normalization Layer
 * ================================
 * Pure functions that convert legacy/variant domain values
 * to their canonical form defined in taxonomy.ts.
 *
 * RULES:
 * 1. Every normalize function is idempotent: normalize(normalize(x)) === normalize(x)
 * 2. Unknown values return null (never throw)
 * 3. Alias maps are exhaustive — every known variant is listed
 * 4. Geographic identifiers (zone names, ZIP codes, coordinates) are NEVER normalized
 */

import {
  type Channel,
  CHANNELS,
  type FinishLevel,
  FINISH_LEVELS,
  type ProjectType,
  PROJECT_TYPES,
  type ServiceType,
  SERVICE_TYPES,
  type Trade,
  TRADES,
  type Category,
  CATEGORIES,
  type PbCategory,
  PB_CATEGORIES,
  type Condition,
  CONDITIONS,
  type LeadSource,
  LEAD_SOURCES,
  type TicketBucket,
} from "./taxonomy";

// ─── Helper ─────────────────────────────────────────────────────────

function buildLookup<T extends string>(
  canonicals: readonly T[],
  aliases: Record<string, T>
): (input: string | null | undefined) => T | null {
  // Build a case-insensitive map: canonical values map to themselves
  const map = new Map<string, T>();
  for (const c of canonicals) map.set(c.toLowerCase(), c);
  for (const [alias, canonical] of Object.entries(aliases)) {
    // Normalize alias key the same way as input: lowercase + spaces→underscores
    map.set(alias.toLowerCase().replace(/\s+/g, "_"), canonical);
  }
  return (input: string | null | undefined): T | null => {
    if (input == null || input === "") return null;
    const key = input.trim().toLowerCase().replace(/\s+/g, "_");
    return map.get(key) ?? null;
  };
}

// ─── Channel ────────────────────────────────────────────────────────

const CHANNEL_ALIASES: Record<string, Channel> = {
  // "residential" was used in projects/estimates/intake/bundles tables
  residential: "direct",
  res: "direct",
  homeowner: "direct",
  // insurance variants
  ins: "insurance",
  insurance_restoration: "insurance",
  // commercial variants
  comm: "commercial",
  commercial_buildout: "commercial",
};

export const normalizeChannel = buildLookup(CHANNELS, CHANNEL_ALIASES);

// ─── Finish Level ───────────────────────────────────────────────────

const FINISH_LEVEL_ALIASES: Record<string, FinishLevel> = {
  std: "standard",
  basic: "standard",
  builder_grade: "standard",
  builder: "standard",
  prem: "premium",
  mid: "premium",
  mid_range: "premium",
  midrange: "premium",
  lux: "luxury",
  high_end: "luxury",
  highend: "luxury",
  custom: "luxury",
};

export const normalizeFinishLevel = buildLookup(FINISH_LEVELS, FINISH_LEVEL_ALIASES);

// ─── Project Type ───────────────────────────────────────────────────

const PROJECT_TYPE_ALIASES: Record<string, ProjectType> = {
  renovation: "remodel",
  reno: "remodel",
  rehab: "remodel",
  fix: "repair",
  maintenance: "repair",
  new_build: "new_construction",
  newcon: "new_construction",
  new: "new_construction",
  add_on: "addition",
  extension: "addition",
  insurance_claim: "insurance_restoration",
  insurance: "insurance_restoration",
  commercial: "commercial_buildout",
  buildout: "commercial_buildout",
  ext: "exterior",
  outdoor: "exterior",
};

export const normalizeProjectType = buildLookup(PROJECT_TYPES, PROJECT_TYPE_ALIASES);

// ─── Service Type ───────────────────────────────────────────────────

const SERVICE_TYPE_ALIASES: Record<string, ServiceType> = {
  // Kitchen variants
  kitchen: "kitchen_remodel",
  "Kitchen": "kitchen_remodel",
  "Kitchen Remodel": "kitchen_remodel",
  kitchen_renovation: "kitchen_remodel",
  // Bathroom variants
  bathroom: "bathroom_remodel",
  "Bathroom": "bathroom_remodel",
  "Bathroom Remodel": "bathroom_remodel",
  bath: "bathroom_remodel",
  bath_remodel: "bathroom_remodel",
  // Full remodel
  full: "full_remodel",
  whole_house: "full_remodel",
  complete_remodel: "full_remodel",
  // Flooring
  "Flooring": "flooring",
  floor: "flooring",
  floors: "flooring",
  // Painting
  "Painting": "painting",
  paint: "painting",
  "Interior Paint": "painting",
  interior_paint: "painting",
  // Flooring (legacy scope rules)
  flooring_install: "flooring",
  floor_install: "flooring",
  // Painting (legacy scope rules)
  exterior_paint: "painting",
  paint_interior: "painting",
  paint_exterior: "painting",
  // Roofing
  "Roofing": "roofing",
  roof: "roofing",
  roof_replacement: "roofing",
  roof_repair: "roofing",
  // Siding
  "Siding": "siding",
  siding_replacement: "siding",
  siding_install: "siding",
  // Windows & Doors
  windows: "windows_doors",
  doors: "windows_doors",
  "Windows / Doors": "windows_doors",
  "Windows & Doors": "windows_doors",
  windows_and_doors: "windows_doors",
  window_replacement: "windows_doors",
  door_replacement: "windows_doors",
  // Deck / Porch
  deck: "deck_porch",
  porch: "deck_porch",
  decking: "deck_porch",
  "Deck / Screen Porch": "deck_porch",
  screen_porch: "deck_porch",
  deck_build: "deck_porch",
  deck_construction: "deck_porch",
  // Electrical
  "Electrical": "electrical",
  electric: "electrical",
  // Plumbing
  "Plumbing": "plumbing",
  // Drywall
  "Drywall": "drywall",
  sheetrock: "drywall",
  // Concrete
  "Concrete": "concrete",
  // Fencing
  "Fencing": "fencing",
  fence: "fencing",
  // General repair
  repair: "general_repair",
  handyman: "general_repair",
  general: "general_repair",
  // Insurance
  insurance: "insurance_claim",
  claim: "insurance_claim",
  // New construction
  new_build: "new_construction",
  newcon: "new_construction",
  // Addition
  add_on: "addition",
  // Exterior
  "Full Exterior": "exterior",
  "Exterior": "exterior",
  outdoor: "exterior",
  exterior_renovation: "exterior",
  exterior_remodel: "exterior",
};

export const normalizeServiceType = buildLookup(SERVICE_TYPES, SERVICE_TYPE_ALIASES);

// ─── Trade ──────────────────────────────────────────────────────────

const TRADE_ALIASES: Record<string, Trade> = {
  // Title Case → lowercase (Sprint 7 data)
  "Appliances": "appliances",
  "Cabinetry": "cabinetry",
  "Concrete": "concrete",
  "Decking": "decking",
  "Demolition": "demolition",
  "Doors": "doors",
  "Drywall": "drywall",
  "Electrical": "electrical",
  "Exterior": "exterior",
  "Fencing": "fencing",
  "Flashing": "flashing",
  "Flooring": "flooring",
  "Foundation": "foundation",
  "Framing": "framing",
  "HVAC": "hvac",
  "Insulation": "insulation",
  "Landscaping": "landscaping",
  "Painting": "painting",
  "Plumbing": "plumbing",
  "Roofing": "roofing",
  "Screening": "screening",
  "Siding": "siding",
  "Tile": "tile",
  "Trim": "trim",
  "Windows": "windows",
  "General": "general",
  // Sprint 8 used some as both trade and category
  kitchen: "cabinetry",
  bathroom: "plumbing",
  // Misc aliases
  paint: "painting",
  deck: "decking",
  window: "windows",
  door: "doors",
  fence: "fencing",
  electric: "electrical",
  roof: "roofing",
  floor: "flooring",
  siding_install: "siding",
  demo: "demolition",
};

export const normalizeTrade = buildLookup(TRADES, TRADE_ALIASES);

// ─── Category (Assembly) ────────────────────────────────────────────

const CATEGORY_ALIASES: Record<string, Category> = {
  // Sprint 7 Title Case variants
  "Kitchen": "kitchen",
  "Bathroom": "bathroom",
  "Flooring": "flooring",
  "Roofing": "roofing",
  "Siding": "siding",
  "Interior Paint": "painting",
  "Full Exterior": "exterior",
  "Windows / Doors": "windows_doors",
  "Deck / Screen Porch": "deck_porch",
  "Electrical": "electrical",
  "Plumbing": "plumbing",
  "Drywall": "drywall",
  "Concrete": "concrete",
  "Fencing": "fencing",
  "Framing": "framing",
  "HVAC": "hvac",
  "Insulation": "insulation",
  "Landscaping": "landscaping",
  "General": "general",
  // Sprint 8 lowercase variants
  decking: "deck_porch",
  painting: "painting",
  windows: "windows_doors",
  // Other aliases
  paint: "painting",
  interior_paint: "painting",
  deck: "deck_porch",
  porch: "deck_porch",
  screen_porch: "deck_porch",
  doors: "windows_doors",
  windows_and_doors: "windows_doors",
  electric: "electrical",
  fence: "fencing",
  roof: "roofing",
  floor: "flooring",
  bath: "bathroom",
};

export const normalizeCategory = buildLookup(CATEGORIES, CATEGORY_ALIASES);

// ─── Price Book Category ────────────────────────────────────────────

const PB_CATEGORY_ALIASES: Record<string, PbCategory> = {
  // Legacy Title Case + multi-word (from Sprint 6 seed data)
  "Appliances & Fixtures": "appliances_fixtures",
  "Cabinetry & Millwork": "cabinetry_millwork",
  "Doors & Windows": "doors_windows",
  "Drywall & Plaster": "drywall_plaster",
  "Electrical": "electrical",
  "Exterior Envelope": "exterior_envelope",
  "Exterior Improvements": "exterior_improvements",
  "Flooring": "flooring",
  "Foundation & Concrete": "foundation_concrete",
  "Framing & Structural": "framing_structural",
  "General Conditions": "general_conditions",
  "Insulation & Air Sealing": "insulation_air_sealing",
  "Interior Finishes": "interior_finishes",
  "Landscaping & Hardscape": "landscaping_hardscape",
  "Mechanical (HVAC)": "mechanical_hvac",
  "Painting & Wall Covering": "painting_wall_covering",
  "Plumbing": "plumbing",
  "Roofing": "roofing",
  "Site Work & Excavation": "site_work_excavation",
  // Short aliases
  appliances: "appliances_fixtures",
  cabinetry: "cabinetry_millwork",
  millwork: "cabinetry_millwork",
  doors: "doors_windows",
  windows: "doors_windows",
  drywall: "drywall_plaster",
  plaster: "drywall_plaster",
  foundation: "foundation_concrete",
  concrete: "foundation_concrete",
  framing: "framing_structural",
  structural: "framing_structural",
  insulation: "insulation_air_sealing",
  hvac: "mechanical_hvac",
  mechanical: "mechanical_hvac",
  painting: "painting_wall_covering",
  landscaping: "landscaping_hardscape",
  hardscape: "landscaping_hardscape",
  site_work: "site_work_excavation",
  excavation: "site_work_excavation",
  interior: "interior_finishes",
  general: "general_conditions",
};

export const normalizePbCategory = buildLookup(PB_CATEGORIES, PB_CATEGORY_ALIASES);

// ─── Condition ──────────────────────────────────────────────────────

const CONDITION_ALIASES: Record<string, Condition> = {
  great: "excellent",
  new: "excellent",
  ok: "fair",
  average: "fair",
  bad: "poor",
  rough: "poor",
  broken: "damaged",
  destroyed: "damaged",
  na: "unknown",
  "n/a": "unknown",
  not_sure: "unknown",
};

export const normalizeCondition = buildLookup(CONDITIONS, CONDITION_ALIASES);

// ─── Lead Source (Sprint A1 — Analytics) ────────────────────────────

const LEAD_SOURCE_ALIASES: Record<string, LeadSource> = {
  // Website variants
  web: "website",
  site: "website",
  homepage: "website",
  // Google variants (paid, organic, GMB)
  gmb: "google",
  google_my_business: "google",
  google_ads: "google",
  google_search: "google",
  adwords: "google",
  // Referral / word of mouth
  word_of_mouth: "referral",
  wom: "referral",
  ref: "referral",
  recommendation: "referral",
  // Repeat client variants
  repeat: "repeat_client",
  previous_customer: "repeat_client",
  existing_client: "repeat_client",
  returning_customer: "repeat_client",
  past_client: "repeat_client",
  // Social media
  fb: "social",
  facebook: "social",
  instagram: "social",
  ig: "social",
  tiktok: "social",
  linkedin: "social",
  // Insurance restoration
  insurance_claim: "insurance",
  ins: "insurance",
  claim: "insurance",
  // Walk-in
  walkin: "walk_in",
  drop_in: "walk_in",
  // Houzz (no common aliases — canonical only)
};

export const normalizeLeadSource = buildLookup(LEAD_SOURCES, LEAD_SOURCE_ALIASES);

// ─── Ticket Size Bucketing (Sprint A1 — Analytics) ──────────────────
// Pure numeric bucketing of deal value into 4 ranges.
// Returns null for null/undefined/negative/non-finite inputs.
export function bucketTicketSize(value: number | null | undefined): TicketBucket | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  if (value < 25_000) return "under_25k";
  if (value < 75_000) return "25k_75k";
  if (value < 200_000) return "75k_200k";
  return "over_200k";
}

// ─── Batch Normalizer ───────────────────────────────────────────────
// Convenience for normalizing an entire record at API boundaries.

export interface NormalizableFields {
  channel?: string | null;
  finishLevel?: string | null;
  projectType?: string | null;
  serviceType?: string | null;
  trade?: string | null;
  category?: string | null;
  condition?: string | null;
}

export interface NormalizedFields {
  channel?: Channel | null;
  finishLevel?: FinishLevel | null;
  projectType?: ProjectType | null;
  serviceType?: ServiceType | null;
  trade?: Trade | null;
  category?: Category | null;
  condition?: Condition | null;
}

/**
 * Normalize all domain fields in a record.
 * Only fields present in the input are normalized.
 * Returns a new object with canonical values (does not mutate input).
 */
export function normalizeRecord(input: NormalizableFields): NormalizedFields {
  const result: NormalizedFields = {};
  if ("channel" in input) result.channel = normalizeChannel(input.channel);
  if ("finishLevel" in input) result.finishLevel = normalizeFinishLevel(input.finishLevel);
  if ("projectType" in input) result.projectType = normalizeProjectType(input.projectType);
  if ("serviceType" in input) result.serviceType = normalizeServiceType(input.serviceType);
  if ("trade" in input) result.trade = normalizeTrade(input.trade);
  if ("category" in input) result.category = normalizeCategory(input.category);
  if ("condition" in input) result.condition = normalizeCondition(input.condition);
  return result;
}

// ─── Re-exports ─────────────────────────────────────────────────────
export type {
  Channel,
  FinishLevel,
  ProjectType,
  ServiceType,
  Trade,
  Category,
  PbCategory,
  Condition,
  LeadSource,
  TicketBucket,
} from "./taxonomy";

export {
  CHANNELS,
  FINISH_LEVELS,
  PROJECT_TYPES,
  SERVICE_TYPES,
  TRADES,
  CATEGORIES,
  PB_CATEGORIES,
  CONDITIONS,
  LEAD_SOURCES,
  TICKET_BUCKETS,
  CHANNEL_LABELS,
  FINISH_LEVEL_LABELS,
  PROJECT_TYPE_LABELS,
  SERVICE_TYPE_LABELS,
  TRADE_LABELS,
  CATEGORY_LABELS,
  PB_CATEGORY_LABELS,
  LEAD_SOURCE_LABELS,
  TICKET_BUCKET_LABELS,
} from "./taxonomy";
