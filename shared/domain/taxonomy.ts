/**
 * structr.ai Domain Taxonomy — Canonical Enums & Constants
 * ===================================================
 * Single source of truth for all domain vocabulary.
 * Every enum value is lowercase_snake_case.
 * Human-readable labels are derived via LABELS maps.
 *
 * RULE: No module outside this file may define domain enum values.
 *       Import from here or from normalization.ts.
 */

// ─── Channel ────────────────────────────────────────────────────────
/** Existing assembly-engine component categories; no fallback category is implied. */
export const ASSEMBLY_COMPONENT_TYPES = ["material", "labor", "subcontract", "equipment", "permit", "admin"] as const;
export type AssemblyComponentType = (typeof ASSEMBLY_COMPONENT_TYPES)[number];

// "direct" is the canonical operational channel.
// "residential" was a legacy alias used in some tables.
// The Scope Builder and all new code must use these values.
export const CHANNELS = ["direct", "insurance", "commercial"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  direct: "Direct / Residential",
  insurance: "Insurance Restoration",
  commercial: "Commercial",
};

// ─── Finish Level ───────────────────────────────────────────────────
export const FINISH_LEVELS = ["standard", "premium", "luxury"] as const;
export type FinishLevel = (typeof FINISH_LEVELS)[number];

export const FINISH_LEVEL_LABELS: Record<FinishLevel, string> = {
  standard: "Standard",
  premium: "Premium",
  luxury: "Luxury",
};

// ─── Project Type ───────────────────────────────────────────────────
export const PROJECT_TYPES = [
  "remodel",
  "repair",
  "new_construction",
  "addition",
  "insurance_restoration",
  "commercial_buildout",
  "exterior",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  remodel: "Remodel",
  repair: "Repair",
  new_construction: "New Construction",
  addition: "Addition",
  insurance_restoration: "Insurance Restoration",
  commercial_buildout: "Commercial Buildout",
  exterior: "Exterior",
};

// ─── Service Type (Intake) ──────────────────────────────────────────
export const SERVICE_TYPES = [
  "kitchen_remodel",
  "bathroom_remodel",
  "full_remodel",
  "flooring",
  "painting",
  "roofing",
  "siding",
  "windows_doors",
  "deck_porch",
  "electrical",
  "plumbing",
  "drywall",
  "concrete",
  "fencing",
  "general_repair",
  "insurance_claim",
  "new_construction",
  "addition",
  "exterior",
  "other",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  kitchen_remodel: "Kitchen Remodel",
  bathroom_remodel: "Bathroom Remodel",
  full_remodel: "Full Remodel",
  flooring: "Flooring",
  painting: "Painting",
  roofing: "Roofing",
  siding: "Siding",
  windows_doors: "Windows & Doors",
  deck_porch: "Deck / Screen Porch",
  electrical: "Electrical",
  plumbing: "Plumbing",
  drywall: "Drywall",
  concrete: "Concrete",
  fencing: "Fencing",
  general_repair: "General Repair",
  insurance_claim: "Insurance Claim",
  new_construction: "New Construction",
  addition: "Addition",
  exterior: "Exterior",
  other: "Other",
};

// ─── Assembly Type ──────────────────────────────────────────────────
export const ASSEMBLY_TYPES = ["scope", "system", "package", "parametric"] as const;
export type AssemblyType = (typeof ASSEMBLY_TYPES)[number];

// ─── Trade (Assembly / Price Book) ──────────────────────────────────
// Canonical trade identifiers used by both assemblies and price book items.
export const TRADES = [
  "appliances",
  "cabinetry",
  "concrete",
  "decking",
  "demolition",
  "doors",
  "drywall",
  "electrical",
  "exterior",
  "fencing",
  "flashing",
  "flooring",
  "foundation",
  "framing",
  "hvac",
  "insulation",
  "landscaping",
  "painting",
  "plumbing",
  "roofing",
  "screening",
  "siding",
  "tile",
  "trim",
  "windows",
  "general",
] as const;
export type Trade = (typeof TRADES)[number];

export const TRADE_LABELS: Record<Trade, string> = {
  appliances: "Appliances",
  cabinetry: "Cabinetry",
  concrete: "Concrete",
  decking: "Decking",
  demolition: "Demolition",
  doors: "Doors",
  drywall: "Drywall",
  electrical: "Electrical",
  exterior: "Exterior",
  fencing: "Fencing",
  flashing: "Flashing",
  flooring: "Flooring",
  foundation: "Foundation",
  framing: "Framing",
  hvac: "HVAC",
  insulation: "Insulation",
  landscaping: "Landscaping",
  painting: "Painting",
  plumbing: "Plumbing",
  roofing: "Roofing",
  screening: "Screening",
  siding: "Siding",
  tile: "Tile",
  trim: "Trim",
  windows: "Windows",
  general: "General",
};

// ─── Category (Assembly grouping for UI) ────────────────────────────
// These are the top-level groupings shown in the Bundle Calculator UI.
export const CATEGORIES = [
  "kitchen",
  "bathroom",
  "flooring",
  "painting",
  "roofing",
  "siding",
  "windows_doors",
  "deck_porch",
  "electrical",
  "plumbing",
  "drywall",
  "concrete",
  "fencing",
  "exterior",
  "framing",
  "hvac",
  "insulation",
  "landscaping",
  "general",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  flooring: "Flooring",
  painting: "Painting",
  roofing: "Roofing",
  siding: "Siding",
  windows_doors: "Windows & Doors",
  deck_porch: "Deck / Screen Porch",
  electrical: "Electrical",
  plumbing: "Plumbing",
  drywall: "Drywall",
  concrete: "Concrete",
  fencing: "Fencing",
  exterior: "Exterior",
  framing: "Framing",
  hvac: "HVAC",
  insulation: "Insulation",
  landscaping: "Landscaping",
  general: "General",
};

// ─── Price Book Category (CSI-inspired groupings) ───────────────────
// These are the broader CSI-style categories used in the price book.
// They are NOT the same as assembly categories.
export const PB_CATEGORIES = [
  "appliances_fixtures",
  "cabinetry_millwork",
  "doors_windows",
  "drywall_plaster",
  "electrical",
  "exterior_envelope",
  "exterior_improvements",
  "flooring",
  "foundation_concrete",
  "framing_structural",
  "general_conditions",
  "insulation_air_sealing",
  "interior_finishes",
  "landscaping_hardscape",
  "mechanical_hvac",
  "painting_wall_covering",
  "plumbing",
  "roofing",
  "site_work_excavation",
] as const;
export type PbCategory = (typeof PB_CATEGORIES)[number];

export const PB_CATEGORY_LABELS: Record<PbCategory, string> = {
  appliances_fixtures: "Appliances & Fixtures",
  cabinetry_millwork: "Cabinetry & Millwork",
  doors_windows: "Doors & Windows",
  drywall_plaster: "Drywall & Plaster",
  electrical: "Electrical",
  exterior_envelope: "Exterior Envelope",
  exterior_improvements: "Exterior Improvements",
  flooring: "Flooring",
  foundation_concrete: "Foundation & Concrete",
  framing_structural: "Framing & Structural",
  general_conditions: "General Conditions",
  insulation_air_sealing: "Insulation & Air Sealing",
  interior_finishes: "Interior Finishes",
  landscaping_hardscape: "Landscaping & Hardscape",
  mechanical_hvac: "Mechanical (HVAC)",
  painting_wall_covering: "Painting & Wall Covering",
  plumbing: "Plumbing",
  roofing: "Roofing",
  site_work_excavation: "Site Work & Excavation",
};

// ─── Condition (Intake) ─────────────────────────────────────────────
export const CONDITIONS = [
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
  "unknown",
] as const;
export type Condition = (typeof CONDITIONS)[number];

// ─── Lead Entities ──────────────────────────────────────────────────
// Acquisition source (where the lead came from). Mixes contact channels
// (website/email/phone/walk_in) with marketing channels (google/houzz/social)
// and relationship-driven channels (referral/repeat_client/insurance).
export const LEAD_SOURCES = [
  "website",
  "email",
  "phone",
  "referral",
  "social",
  "walk_in",
  "google",
  "houzz",
  "repeat_client",
  "insurance",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Website",
  email: "Email",
  phone: "Phone",
  referral: "Referral",
  social: "Social Media",
  walk_in: "Walk-In",
  google: "Google",
  houzz: "Houzz",
  repeat_client: "Repeat Client",
  insurance: "Insurance",
  other: "Other",
};

// ─── Ticket Size Buckets (Sprint A1 — Analytics) ────────────────────
// Used for win-rate breakdown by deal size.
export const TICKET_BUCKETS = [
  "under_25k",
  "25k_75k",
  "75k_200k",
  "over_200k",
] as const;
export type TicketBucket = (typeof TICKET_BUCKETS)[number];

export const TICKET_BUCKET_LABELS: Record<TicketBucket, string> = {
  under_25k: "Under $25k",
  "25k_75k": "$25k–$75k",
  "75k_200k": "$75k–$200k",
  over_200k: "$200k+",
};

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "disqualified",
  "converted",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ["hot", "warm", "cold"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "sms",
  "meeting",
  "status_change",
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

// ─── Deal Entities (Sprint 25) ──────────────────────────────────────────
export const DEAL_STAGES = [
  "discovery",
  "site_visit",
  "estimating",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_ACTIVITY_TYPES = [
  ...LEAD_ACTIVITY_TYPES, // Deals use same base activities as leads
];
export type DealActivityType = (typeof DEAL_ACTIVITY_TYPES)[number];

// H1 records provenance only. No entry in these vocabularies confers approval.
export const HISTORICAL_SOURCE_KINDS = ["manual_transcription", "file_extract"] as const;
export type HistoricalSourceKind = (typeof HISTORICAL_SOURCE_KINDS)[number];
export const HISTORICAL_RECONCILIATION_STATES = ["unresolved", "matched", "mismatch"] as const;
export type HistoricalReconciliationState = (typeof HISTORICAL_RECONCILIATION_STATES)[number];
export const HISTORICAL_ESTIMATE_SOURCE = "historical_import" as const;
export const HISTORICAL_ERROR_CODES = [
  "HISTORICAL_INVALID_INPUT", "HISTORICAL_INVALID_DECIMAL", "HISTORICAL_INVALID_SELECTION",
  "HISTORICAL_IDENTITY_MISMATCH", "HISTORICAL_SCOPE_FORBIDDEN", "HISTORICAL_NOT_FOUND",
  "HISTORICAL_REQUEST_CONFLICT", "HISTORICAL_CONTENT_ALREADY_RECORDED", "HISTORICAL_REVISION_CONFLICT",
  "HISTORICAL_AUTHORITY_NOT_AVAILABLE", "HISTORICAL_SOURCE_IMMUTABLE",
] as const;
export type HistoricalErrorCode = (typeof HISTORICAL_ERROR_CODES)[number];
export const HISTORICAL_FINDING_CODES = [
  "unknown_currency", "missing_line_price", "missing_line_cost", "missing_declared_total", "missing_declared_cost",
  "price_total_mismatch", "cost_total_mismatch", "price_extension_mismatch", "cost_extension_mismatch",
  "fractional_minor_extension", "incomplete_extension",
] as const;
export type HistoricalFindingCode = (typeof HISTORICAL_FINDING_CODES)[number];
export const HISTORICAL_FINDING_FIELDS = ["currency", "price", "cost"] as const;
export type HistoricalFindingField = (typeof HISTORICAL_FINDING_FIELDS)[number];
