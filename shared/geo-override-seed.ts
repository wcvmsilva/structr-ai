/**
 * structr.ai Construction Brain — Geographic Override Seed Data
 * Sprint 16: Coastal Override Resolver
 *
 * Realistic override rules for Charleston, SC micro-zones.
 * These rules encode the coastal resilience requirements that differentiate
 * a Goose Creek project from a Sullivan's Island project.
 *
 * Rule categories:
 *   - SWAP: Replace standard assembly with coastal-grade equivalent
 *   - ADD:  Inject additional assembly required by zone regulations
 *   - WARNING_ONLY: Flag for operator review without automatic changes
 *
 * Zone mapping (from geo-engine.ts):
 *   - Barrier Island Premium: Sullivan's Island, Isle of Palms, Folly Beach, Kiawah, Seabrook
 *   - Charleston Coastal: Mt. Pleasant, James Island, Daniel Island, Johns Island
 *   - Inland/Metro: Goose Creek, Summerville, North Charleston, West Ashley
 */

export interface SeedOverrideRule {
  zone: string;
  trade: string;
  finishLevel: string | null;
  originalAssemblyId: number;
  replacementAssemblyId: number;
  overrideType: "swap" | "add" | "warning_only";
  reasonTemplate: string;
  active: boolean;
}

/**
 * Seed override rules for Charleston coastal zones.
 *
 * NOTE: Assembly IDs are placeholder references. In production, these
 * would map to actual assemblies in the catalog. The seed procedure
 * should validate that referenced assemblies exist before inserting.
 *
 * Assembly ID conventions for seed data:
 *   100-199: Standard-grade assemblies
 *   200-299: Coastal-grade replacement assemblies
 *   300-399: Additional assemblies (code-required additions)
 */
export const COASTAL_OVERRIDE_SEED_RULES: SeedOverrideRule[] = [
  // ══════════════════════════════════════════════════════════════════
  // BARRIER ISLAND PREMIUM — Highest exposure zone
  // Sullivan's Island, IOP, Folly Beach, Kiawah, Seabrook
  // ══════════════════════════════════════════════════════════════════

  // --- Roofing ---
  {
    zone: "Barrier Island Premium",
    trade: "roofing",
    finishLevel: null,
    originalAssemblyId: 101,
    replacementAssemblyId: 201,
    overrideType: "swap",
    reasonTemplate: "Barrier island wind exposure requires 130 mph-rated roofing system per SC Residential Code R609.3. Standard shingles replaced with impact-resistant Class 4 shingles with 6-nail pattern.",
    active: true,
  },
  {
    zone: "Barrier Island Premium",
    trade: "roofing",
    finishLevel: null,
    originalAssemblyId: 101,
    replacementAssemblyId: 301,
    overrideType: "add",
    reasonTemplate: "Barrier island zone requires secondary water barrier (ice & water shield) on entire roof deck per IRC R905.1.1 for structures within 3,000 ft of mean high tide.",
    active: true,
  },

  // --- Windows & Doors ---
  {
    zone: "Barrier Island Premium",
    trade: "windows_doors",
    finishLevel: null,
    originalAssemblyId: 102,
    replacementAssemblyId: 202,
    overrideType: "swap",
    reasonTemplate: "Barrier island wind-borne debris region requires impact-rated windows (Large Missile Test per ASTM E1886/E1996) or approved shutters. Standard windows replaced with impact-rated units.",
    active: true,
  },
  {
    zone: "Barrier Island Premium",
    trade: "windows_doors",
    finishLevel: null,
    originalAssemblyId: 103,
    replacementAssemblyId: 203,
    overrideType: "swap",
    reasonTemplate: "Entry doors in barrier island zone must meet +/- 50 PSF design pressure minimum. Standard entry door replaced with wind-rated reinforced door system.",
    active: true,
  },

  // --- Siding & Exterior ---
  {
    zone: "Barrier Island Premium",
    trade: "siding",
    finishLevel: null,
    originalAssemblyId: 104,
    replacementAssemblyId: 204,
    overrideType: "swap",
    reasonTemplate: "Barrier island salt spray exposure requires fiber cement or marine-grade siding. Standard vinyl siding replaced with HardiePlank fiber cement with saltwater-resistant fasteners.",
    active: true,
  },
  {
    zone: "Barrier Island Premium",
    trade: "siding",
    finishLevel: null,
    originalAssemblyId: 104,
    replacementAssemblyId: 302,
    overrideType: "add",
    reasonTemplate: "Barrier island zone requires enhanced moisture barrier (housewrap + flashing tape at all penetrations) per SC Building Code Chapter 14 for coastal exposure.",
    active: true,
  },

  // --- Structural ---
  {
    zone: "Barrier Island Premium",
    trade: "framing",
    finishLevel: null,
    originalAssemblyId: 105,
    replacementAssemblyId: 205,
    overrideType: "swap",
    reasonTemplate: "Barrier island structures require continuous load path from roof to foundation. Standard framing connectors replaced with Simpson Strong-Tie hurricane clips and hold-downs rated for 130 mph.",
    active: true,
  },
  {
    zone: "Barrier Island Premium",
    trade: "framing",
    finishLevel: null,
    originalAssemblyId: 105,
    replacementAssemblyId: 303,
    overrideType: "add",
    reasonTemplate: "Barrier island flood zone requires elevated foundation system. Additional pilings or elevated crawlspace per FEMA Flood Zone V/VE requirements and local BFE + 2 ft freeboard.",
    active: true,
  },

  // --- Electrical ---
  {
    zone: "Barrier Island Premium",
    trade: "electrical",
    finishLevel: null,
    originalAssemblyId: 106,
    replacementAssemblyId: 206,
    overrideType: "swap",
    reasonTemplate: "Barrier island electrical systems require NEMA 4X-rated panels and marine-grade wiring. Standard electrical panel replaced with corrosion-resistant stainless steel enclosure.",
    active: true,
  },

  // --- HVAC ---
  {
    zone: "Barrier Island Premium",
    trade: "hvac",
    finishLevel: null,
    originalAssemblyId: 107,
    replacementAssemblyId: 207,
    overrideType: "swap",
    reasonTemplate: "Barrier island HVAC condensers require coastal-rated units with pre-coated coils and elevated mounting. Standard condenser replaced with coastal-rated unit on hurricane-rated pad.",
    active: true,
  },

  // --- Warning: Flood Insurance ---
  {
    zone: "Barrier Island Premium",
    trade: "general",
    finishLevel: null,
    originalAssemblyId: 100,
    replacementAssemblyId: 100,
    overrideType: "warning_only",
    reasonTemplate: "ADVISORY: Barrier island projects require NFIP flood insurance. Verify flood zone designation (V, VE, A, AE) and confirm Base Flood Elevation (BFE) with Charleston County Floodplain Manager before finalizing scope.",
    active: true,
  },

  // ══════════════════════════════════════════════════════════════════
  // CHARLESTON COASTAL — Moderate exposure zone
  // Mt. Pleasant, James Island, Daniel Island, Johns Island
  // ══════════════════════════════════════════════════════════════════

  // --- Roofing ---
  {
    zone: "Charleston Coastal",
    trade: "roofing",
    finishLevel: null,
    originalAssemblyId: 101,
    replacementAssemblyId: 208,
    overrideType: "swap",
    reasonTemplate: "Coastal zone wind exposure requires 110 mph-rated roofing system. Standard shingles replaced with wind-resistant architectural shingles with enhanced nailing pattern.",
    active: true,
  },

  // --- Windows & Doors ---
  {
    zone: "Charleston Coastal",
    trade: "windows_doors",
    finishLevel: null,
    originalAssemblyId: 102,
    replacementAssemblyId: 209,
    overrideType: "swap",
    reasonTemplate: "Coastal zone requires wind-rated windows meeting +/- 35 PSF design pressure. Standard windows replaced with DP-50 rated units with reinforced frames.",
    active: true,
  },

  // --- Siding ---
  {
    zone: "Charleston Coastal",
    trade: "siding",
    finishLevel: null,
    originalAssemblyId: 104,
    replacementAssemblyId: 210,
    overrideType: "swap",
    reasonTemplate: "Coastal zone salt air exposure requires upgraded siding. Standard vinyl replaced with engineered wood or fiber cement siding with corrosion-resistant fasteners.",
    active: true,
  },

  // --- Structural ---
  {
    zone: "Charleston Coastal",
    trade: "framing",
    finishLevel: null,
    originalAssemblyId: 105,
    replacementAssemblyId: 211,
    overrideType: "swap",
    reasonTemplate: "Coastal zone requires enhanced wind bracing. Standard framing connectors replaced with hurricane clips at all rafter-to-wall connections per IRC R802.11.",
    active: true,
  },

  // --- Warning: Flood Zone Check ---
  {
    zone: "Charleston Coastal",
    trade: "general",
    finishLevel: null,
    originalAssemblyId: 100,
    replacementAssemblyId: 100,
    overrideType: "warning_only",
    reasonTemplate: "ADVISORY: Coastal zone project may be in FEMA flood zone A/AE. Verify flood zone designation and BFE with Charleston County before finalizing foundation design.",
    active: true,
  },

  // --- Warning: Historic District ---
  {
    zone: "Charleston Coastal",
    trade: "general",
    finishLevel: null,
    originalAssemblyId: 100,
    replacementAssemblyId: 100,
    overrideType: "warning_only",
    reasonTemplate: "ADVISORY: Parts of this coastal zone fall within Charleston Historic District. Verify BAR (Board of Architectural Review) approval requirements for exterior modifications.",
    active: true,
  },

  // ══════════════════════════════════════════════════════════════════
  // FINISH LEVEL OVERRIDES — Premium/Luxury in coastal zones
  // ══════════════════════════════════════════════════════════════════

  // Luxury finish on barrier island requires marine-grade everything
  {
    zone: "Barrier Island Premium",
    trade: "painting",
    finishLevel: "luxury",
    originalAssemblyId: 110,
    replacementAssemblyId: 212,
    overrideType: "swap",
    reasonTemplate: "Luxury finish in barrier island zone requires marine-grade exterior paint system (primer + 2 coats Sherwin-Williams Duration or equivalent) with salt-spray resistance rating.",
    active: true,
  },

  // Premium finish on barrier island — deck/porch
  {
    zone: "Barrier Island Premium",
    trade: "deck_porch",
    finishLevel: "premium",
    originalAssemblyId: 111,
    replacementAssemblyId: 213,
    overrideType: "swap",
    reasonTemplate: "Premium deck in barrier island zone requires marine-grade composite decking (Trex Transcend or equivalent) with stainless steel hidden fasteners. Standard pressure-treated lumber not suitable for salt exposure.",
    active: true,
  },
];

/**
 * Summary statistics for the seed data.
 * Used by the seed procedure to report what was inserted.
 */
export function getSeedSummary() {
  const rules = COASTAL_OVERRIDE_SEED_RULES;
  const byZone = new Map<string, number>();
  const byType = new Map<string, number>();

  for (const r of rules) {
    byZone.set(r.zone, (byZone.get(r.zone) ?? 0) + 1);
    byType.set(r.overrideType, (byType.get(r.overrideType) ?? 0) + 1);
  }

  return {
    totalRules: rules.length,
    byZone: Object.fromEntries(byZone),
    byType: Object.fromEntries(byType),
  };
}
