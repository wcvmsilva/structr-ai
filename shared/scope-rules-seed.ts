/**
 * structr.ai — Scope Rules Seed Data
 * Sprint 12 + 12.5: Deterministic Scope Builder (Domain-Aligned)
 *
 * Sprint 12.5 changes:
 *   - All serviceType values now use canonical taxonomy (SERVICE_TYPES)
 *   - Added scopeVariant field to preserve legacy sub-classification
 *   - Legacy values (roof_replacement, etc.) → canonical (roofing, etc.)
 *
 * Scope rules for all 9 trade groups:
 *   1. Kitchen (kitchen_remodel)
 *   2. Bathroom (bathroom_remodel)
 *   3. Roofing (roofing)
 *   4. Siding (siding)
 *   5. Windows / Doors (windows_doors)
 *   6. Deck / Screen Porch (deck_porch)
 *   7. Painting (painting)
 *   8. Flooring (flooring)
 *   9. Exterior (exterior)
 *
 * Each rule maps:
 *   service_type + finish_level + [conditions] → assembly_id + quantity_formula + reason
 *
 * Assembly IDs reference the live database.
 * Quantity formulas use the FormulaContext variables:
 *   area, rooms, units, length, width, height, waste_factor, luxury_multiplier
 */

import type { ScopeRuleCondition } from "../drizzle/schema";

export interface ScopeRuleSeed {
  ruleCode: string;
  serviceType: string;
  scopeVariant: string | null;
  projectType: string | null;
  channel: string | null;
  zone: string | null;
  finishLevel: string | null;
  conditionJson: ScopeRuleCondition[] | null;
  assemblyId: string;
  quantityFormula: string;
  reasonTemplate: string;
  priority: number;
}

// ══════════════════════════════════════════════════════════════════════
// KITCHEN SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const KITCHEN_RULES: ScopeRuleSeed[] = [
  // Standard Kitchen Remodel
  {
    ruleCode: "KIT-DEMO-STD",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: "remodel",
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: [{ field: "condition", op: "eq", value: "full_gut" }],
    assemblyId: "30060", // KIT-DEMO-001 Kitchen Demo — Full Gut
    quantityFormula: "1",
    reasonTemplate: "Full gut demo required for {{finish_level}} {{service_type}} in {{condition}} condition.",
    priority: 10,
  },
  {
    ruleCode: "KIT-CAB-STD",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30061", // KIT-CAB-STD Cabinet Install — Standard
    quantityFormula: "ceil(area / 40)",
    reasonTemplate: "Standard cabinet install for {{service_type}} ({{area}} area).",
    priority: 20,
  },
  {
    ruleCode: "KIT-CTR-STD",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30063", // KIT-CTR-LAM Countertop Install — Laminate
    quantityFormula: "ceil(area / 50)",
    reasonTemplate: "Laminate countertop for {{finish_level}} {{service_type}}.",
    priority: 25,
  },
  {
    ruleCode: "KIT-BSP-STD",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30065", // KIT-BSP-001 Tile Backsplash Install
    quantityFormula: "ceil(area / 60)",
    reasonTemplate: "Tile backsplash for {{service_type}}.",
    priority: 30,
  },
  {
    ruleCode: "KIT-SNK-STD",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30066", // KIT-SNK-001 Kitchen Sink & Faucet
    quantityFormula: "1",
    reasonTemplate: "Sink & faucet replacement for {{service_type}}.",
    priority: 35,
  },
  {
    ruleCode: "KIT-APP-STD",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30067", // KIT-APP-STD Appliance Hookup
    quantityFormula: "1",
    reasonTemplate: "Standard appliance hookup package for {{service_type}}.",
    priority: 40,
  },
  {
    ruleCode: "KIT-PNT-STD",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30068", // KIT-PNT-001 Kitchen Paint
    quantityFormula: "1",
    reasonTemplate: "Kitchen paint — walls & ceiling for {{service_type}}.",
    priority: 45,
  },
  // Premium Kitchen Remodel
  {
    ruleCode: "KIT-DEMO-PRM",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: "remodel",
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: [{ field: "condition", op: "eq", value: "full_gut" }],
    assemblyId: "30060", // KIT-DEMO-001
    quantityFormula: "1",
    reasonTemplate: "Full gut demo for {{finish_level}} {{service_type}}.",
    priority: 10,
  },
  {
    ruleCode: "KIT-CAB-PRM",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30062", // KIT-CAB-PRM Cabinet Install — Premium
    quantityFormula: "ceil(area / 40) * luxury_multiplier",
    reasonTemplate: "Premium cabinet install for {{finish_level}} {{service_type}} (luxury complexity applied).",
    priority: 20,
  },
  {
    ruleCode: "KIT-CTR-PRM",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30064", // KIT-CTR-QTZ Countertop Install — Quartz
    quantityFormula: "ceil(area / 50) * luxury_multiplier",
    reasonTemplate: "Quartz countertop for {{finish_level}} {{service_type}} (luxury complexity applied).",
    priority: 25,
  },

  // Luxury Kitchen — uses premium assemblies with luxury multiplier
  {
    ruleCode: "KIT-CAB-LUX",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "luxury",
    conditionJson: null,
    assemblyId: "30062", // KIT-CAB-PRM (luxury uses premium assemblies)
    quantityFormula: "ceil(area / 40) * luxury_multiplier",
    reasonTemplate: "Luxury cabinet install for {{finish_level}} {{service_type}} (1.15x complexity).",
    priority: 20,
  },
  {
    ruleCode: "KIT-CTR-LUX",
    serviceType: "kitchen_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "luxury",
    conditionJson: null,
    assemblyId: "30064", // KIT-CTR-QTZ
    quantityFormula: "ceil(area / 50) * luxury_multiplier",
    reasonTemplate: "Luxury quartz countertop for {{finish_level}} {{service_type}} (1.15x complexity).",
    priority: 25,
  },
];

// ══════════════════════════════════════════════════════════════════════
// BATHROOM SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const BATHROOM_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "BTH-DEMO-STD",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: "remodel",
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: [{ field: "condition", op: "eq", value: "full_gut" }],
    assemblyId: "30076", // BTH-DEMO-001
    quantityFormula: "1",
    reasonTemplate: "Full gut demo for {{finish_level}} {{service_type}}.",
    priority: 10,
  },
  {
    ruleCode: "BTH-SHW-STD",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30070", // BTH-SHW-STD Shower Valve & Trim
    quantityFormula: "1",
    reasonTemplate: "Shower valve & trim for {{finish_level}} {{service_type}}.",
    priority: 15,
  },
  {
    ruleCode: "BTH-TIL-STD",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30075", // BTH-FLR-TIL Tile Install
    quantityFormula: "area * waste_factor",
    reasonTemplate: "Standard tile install for {{service_type}} ({{area}} area, waste factor applied).",
    priority: 20,
  },
  {
    ruleCode: "BTH-VAN-STD",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30072", // BTH-VAN-STD
    quantityFormula: "1",
    reasonTemplate: "Standard vanity install for {{service_type}}.",
    priority: 25,
  },
  {
    ruleCode: "BTH-TOI-STD",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30074", // BTH-TOI-001
    quantityFormula: "1",
    reasonTemplate: "Toilet replacement for {{service_type}}.",
    priority: 30,
  },
  {
    ruleCode: "BTH-PNT-STD",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30077", // BTH-PNT-001
    quantityFormula: "1",
    reasonTemplate: "Bathroom paint — walls & ceiling for {{service_type}}.",
    priority: 35,
  },
  // Premium Bathroom
  {
    ruleCode: "BTH-VAN-PRM",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30073", // BTH-VAN-PRM
    quantityFormula: "1",
    reasonTemplate: "Premium vanity install for {{finish_level}} {{service_type}}.",
    priority: 25,
  },
  // Luxury Bathroom
  {
    ruleCode: "BTH-VAN-LUX",
    serviceType: "bathroom_remodel",
    scopeVariant: null,
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "luxury",
    conditionJson: null,
    assemblyId: "30073", // BTH-VAN-PRM (luxury uses premium)
    quantityFormula: "1 * luxury_multiplier",
    reasonTemplate: "Luxury vanity install for {{finish_level}} {{service_type}} (1.15x complexity).",
    priority: 25,
  },
];

// ══════════════════════════════════════════════════════════════════════
// ROOFING SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const ROOFING_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "ROF-DEMO-STD",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30083", // ROF-DEMO-001
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Roof tear-off for {{finish_level}} {{service_type}} ({{area}} sq ft, waste applied).",
    priority: 10,
  },
  {
    ruleCode: "ROF-SHG-STD",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30078", // ROF-SHG-STD Standard Shingle
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Standard asphalt shingle reroof for {{service_type}} ({{area}} sq ft).",
    priority: 20,
  },
  {
    ruleCode: "ROF-SHG-PRM",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30079", // ROF-SHG-ARC Architectural Shingle
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Architectural shingle reroof for {{finish_level}} {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "ROF-DRP-STD",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30082", // ROF-DRP-001 Drip Edge
    quantityFormula: "ceil((length * 2 + width * 2) / 10)",
    reasonTemplate: "Drip edge install for {{service_type}} (perimeter-based).",
    priority: 30,
  },
  {
    ruleCode: "ROF-RDG-STD",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30081", // ROF-RDG-001 Ridge Cap
    quantityFormula: "ceil(length / 10)",
    reasonTemplate: "Ridge cap replacement for {{service_type}}.",
    priority: 35,
  },
  {
    ruleCode: "ROF-FLS-CHM",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30084", // ROF-FLS-CHM Chimney Flashing
    quantityFormula: "1",
    reasonTemplate: "Chimney flashing replacement for {{service_type}}.",
    priority: 40,
  },
  {
    ruleCode: "ROF-FLS-PPB",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30086", // ROF-FLS-PPB Pipe Boot
    quantityFormula: "max(1, ceil(area / 500))",
    reasonTemplate: "Pipe boot flashing for {{service_type}} (area-based count).",
    priority: 42,
  },
  // Coastal zone roofing — Barrier Island Premium
  {
    ruleCode: "ROF-SHG-COASTAL",
    serviceType: "roofing",
    scopeVariant: "roof_replacement",
    projectType: null,
    channel: null,
    zone: "Barrier Island Premium",
    finishLevel: null,
    conditionJson: [{ field: "coastal_exposure", op: "in", value: ["high", "extreme"] }],
    assemblyId: "30079", // ROF-SHG-ARC (coastal requires architectural minimum)
    quantityFormula: "ceil(area / 100) * waste_factor * 1.05",
    reasonTemplate: "Applied Coastal Hardening Logic due to {{zone}} zone. Architectural shingles required for wind resistance.",
    priority: 5, // Higher priority than standard
  },
];

// ══════════════════════════════════════════════════════════════════════
// SIDING SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const SIDING_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "SID-DEMO-STD",
    serviceType: "siding",
    scopeVariant: "siding_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "in", value: ["full_gut", "poor", "damaged"] }],
    assemblyId: "30090", // SID-DEMO-001
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Siding demo for {{service_type}} in {{condition}} condition.",
    priority: 10,
  },
  {
    ruleCode: "SID-VNL-STD",
    serviceType: "siding",
    scopeVariant: "siding_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30088", // SID-VNL-001 Vinyl Siding
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Vinyl siding replacement for {{finish_level}} {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "SID-FBC-PRM",
    serviceType: "siding",
    scopeVariant: "siding_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30087", // SID-FBC-001 Fiber Cement
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Fiber cement siding for {{finish_level}} {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "SID-TRM-STD",
    serviceType: "siding",
    scopeVariant: "siding_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30089", // SID-TRM-001 Trim Board
    quantityFormula: "ceil((length * 2 + width * 2) / 8)",
    reasonTemplate: "Trim board replacement for {{service_type}} (perimeter-based).",
    priority: 30,
  },
  // Coastal siding — fiber cement required
  {
    ruleCode: "SID-FBC-COASTAL",
    serviceType: "siding",
    scopeVariant: "siding_replacement",
    projectType: null,
    channel: null,
    zone: "Barrier Island Premium",
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30087", // SID-FBC-001 Fiber Cement (coastal requirement)
    quantityFormula: "ceil(area / 100) * waste_factor * 1.05",
    reasonTemplate: "Applied Coastal Hardening Logic due to {{zone}} zone. Fiber cement siding required for coastal durability.",
    priority: 5,
  },
];

// ══════════════════════════════════════════════════════════════════════
// WINDOWS / DOORS SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const WINDOW_DOOR_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "WIN-DH-STD",
    serviceType: "windows_doors",
    scopeVariant: "window_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30091", // WIN-DH-STD Double-Hung Standard
    quantityFormula: "units",
    reasonTemplate: "Standard double-hung window replacement for {{service_type}} ({{area}} area).",
    priority: 20,
  },
  {
    ruleCode: "WIN-DH-PRM",
    serviceType: "windows_doors",
    scopeVariant: "window_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30092", // WIN-DH-IMP Impact Windows
    quantityFormula: "units",
    reasonTemplate: "Impact-rated window replacement for {{finish_level}} {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "WIN-TRM-STD",
    serviceType: "windows_doors",
    scopeVariant: "window_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30097", // WIN-TRM-001 Window Trim
    quantityFormula: "units",
    reasonTemplate: "Window trim install for {{service_type}}.",
    priority: 30,
  },
  {
    ruleCode: "DOO-EXT-STD",
    serviceType: "windows_doors",
    scopeVariant: "door_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30094", // DOO-EXT-STD
    quantityFormula: "units",
    reasonTemplate: "Standard exterior door replacement for {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "DOO-EXT-PRM",
    serviceType: "windows_doors",
    scopeVariant: "door_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30095", // DOO-EXT-PRM
    quantityFormula: "units",
    reasonTemplate: "Premium exterior door replacement for {{finish_level}} {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "DOO-INT-STD",
    serviceType: "windows_doors",
    scopeVariant: "door_replacement",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "eq", value: "interior" }],
    assemblyId: "30096", // DOO-INT-001
    quantityFormula: "units",
    reasonTemplate: "Interior door replacement for {{service_type}}.",
    priority: 25,
  },
  // Coastal windows — impact required
  {
    ruleCode: "WIN-IMP-COASTAL",
    serviceType: "windows_doors",
    scopeVariant: "window_replacement",
    projectType: null,
    channel: null,
    zone: "Barrier Island Premium",
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30092", // WIN-DH-IMP Impact Windows (coastal requirement)
    quantityFormula: "units",
    reasonTemplate: "Applied Coastal Hardening Logic due to {{zone}} zone. Impact-rated windows required per coastal building code.",
    priority: 5,
  },
];

// ══════════════════════════════════════════════════════════════════════
// DECK / SCREEN PORCH SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const DECK_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "DK-DEMO-STD",
    serviceType: "deck_porch",
    scopeVariant: "deck_build",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "in", value: ["full_gut", "poor", "damaged", "replace"] }],
    assemblyId: "30102", // DEC-DEMO-001
    quantityFormula: "1",
    reasonTemplate: "Deck demo for {{service_type}} in {{condition}} condition.",
    priority: 10,
  },
  {
    ruleCode: "DK-FRM-STD",
    serviceType: "deck_porch",
    scopeVariant: "deck_build",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30098", // DEC-FRM-001 Deck Framing
    quantityFormula: "ceil(area / 100)",
    reasonTemplate: "Deck framing for {{service_type}} ({{area}} sq ft).",
    priority: 15,
  },
  {
    ruleCode: "DK-PT-STD",
    serviceType: "deck_porch",
    scopeVariant: "deck_build",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "3", // DEC-STADEC10X Pressure-Treated Deck
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Pressure-treated deck build for {{finish_level}} {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "DK-CMP-PRM",
    serviceType: "deck_porch",
    scopeVariant: "deck_build",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30099", // DEC-CMP-001 Composite Deck
    quantityFormula: "ceil(area / 100) * waste_factor",
    reasonTemplate: "Composite deck build for {{finish_level}} {{service_type}}.",
    priority: 20,
  },
  {
    ruleCode: "DK-RAL-STD",
    serviceType: "deck_porch",
    scopeVariant: "deck_build",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30100", // DEC-RAL-001 Railing
    quantityFormula: "ceil((length * 2 + width) / 8)",
    reasonTemplate: "Deck railing install for {{service_type}} (perimeter-based).",
    priority: 30,
  },
  {
    ruleCode: "DK-SCR-STD",
    serviceType: "deck_porch",
    scopeVariant: "screen_porch",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30101", // DEC-SCR-001 Screen Porch Enclosure
    quantityFormula: "ceil(area / 100)",
    reasonTemplate: "Screen porch enclosure for {{service_type}} ({{area}} sq ft).",
    priority: 20,
  },
];

// ══════════════════════════════════════════════════════════════════════
// INTERIOR PAINT SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const PAINT_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "PNT-PAT-STD",
    serviceType: "painting",
    scopeVariant: "interior_paint",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "in", value: ["patch", "spot_repair", "minor"] }],
    assemblyId: "30111", // PNT-PAT-001 Drywall Patch & Paint
    quantityFormula: "max(1, ceil(area / 50))",
    reasonTemplate: "Drywall patch & paint for {{service_type}} in {{condition}} condition.",
    priority: 10,
  },
  {
    ruleCode: "PNT-FUL-STD",
    serviceType: "painting",
    scopeVariant: "interior_paint",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30110", // PNT-FUL-001 Full Room Package
    quantityFormula: "rooms",
    reasonTemplate: "Full room paint package for {{finish_level}} {{service_type}} ({{area}} area).",
    priority: 20,
  },
  {
    ruleCode: "PNT-WLC-STD",
    serviceType: "painting",
    scopeVariant: "interior_paint",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30109", // PNT-WLC-001 Walls + Ceiling
    quantityFormula: "rooms * luxury_multiplier",
    reasonTemplate: "Premium walls + ceiling paint for {{finish_level}} {{service_type}} (complexity applied).",
    priority: 20,
  },
  {
    ruleCode: "PNT-WAL-STD",
    serviceType: "painting",
    scopeVariant: "interior_paint",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "eq", value: "walls_only" }],
    assemblyId: "30108", // PNT-WAL-001 Walls Only
    quantityFormula: "rooms",
    reasonTemplate: "Walls-only paint for {{service_type}} ({{condition}} specified).",
    priority: 15,
  },
  {
    ruleCode: "PNT-EXT-STD",
    serviceType: "painting",
    scopeVariant: "exterior_paint",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30103", // EXT-PNT-001 Full Exterior Paint
    quantityFormula: "ceil(area / 200) * waste_factor",
    reasonTemplate: "Full exterior paint for {{service_type}} ({{area}} sq ft).",
    priority: 20,
  },
];

// ══════════════════════════════════════════════════════════════════════
// FLOORING SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const FLOORING_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "FLR-DEMO-STD",
    serviceType: "flooring",
    scopeVariant: "flooring_install",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "in", value: ["full_gut", "replace", "damaged"] }],
    assemblyId: "30116", // FLR-DEMO-001
    quantityFormula: "ceil(area / 100)",
    reasonTemplate: "Floor demo for {{service_type}} in {{condition}} condition.",
    priority: 10,
  },
  {
    ruleCode: "FLR-LVP-STD",
    serviceType: "flooring",
    scopeVariant: "flooring_install",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "standard",
    conditionJson: null,
    assemblyId: "30112", // FLR-LVP-001
    quantityFormula: "area * waste_factor",
    reasonTemplate: "LVP flooring install for {{finish_level}} {{service_type}} (waste factor applied).",
    priority: 20,
  },
  {
    ruleCode: "FLR-HWD-PRM",
    serviceType: "flooring",
    scopeVariant: "flooring_install",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "premium",
    conditionJson: null,
    assemblyId: "30113", // FLR-HWD-001 Hardwood
    quantityFormula: "area * waste_factor * luxury_multiplier",
    reasonTemplate: "Hardwood flooring for {{finish_level}} {{service_type}} (waste + luxury complexity).",
    priority: 20,
  },
  {
    ruleCode: "FLR-TIL-STD",
    serviceType: "flooring",
    scopeVariant: "flooring_install",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "eq", value: "tile" }],
    assemblyId: "30114", // FLR-TIL-001
    quantityFormula: "area * waste_factor",
    reasonTemplate: "Tile floor install for {{service_type}} (tile condition specified).",
    priority: 15,
  },
  {
    ruleCode: "FLR-CPT-STD",
    serviceType: "flooring",
    scopeVariant: "flooring_install",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: [{ field: "condition", op: "eq", value: "carpet" }],
    assemblyId: "30115", // FLR-CPT-001 Carpet
    quantityFormula: "area * waste_factor",
    reasonTemplate: "Carpet install for {{service_type}} (carpet condition specified).",
    priority: 15,
  },
  // Luxury flooring — hardwood with complexity
  {
    ruleCode: "FLR-HWD-LUX",
    serviceType: "flooring",
    scopeVariant: "flooring_install",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: "luxury",
    conditionJson: null,
    assemblyId: "30113", // FLR-HWD-001
    quantityFormula: "area * waste_factor * luxury_multiplier",
    reasonTemplate: "Luxury hardwood flooring for {{finish_level}} {{service_type}} (1.15x complexity).",
    priority: 20,
  },
];

// ══════════════════════════════════════════════════════════════════════
// FULL EXTERIOR SCOPE RULES
// ══════════════════════════════════════════════════════════════════════

const EXTERIOR_RULES: ScopeRuleSeed[] = [
  {
    ruleCode: "EXT-FAS-STD",
    serviceType: "exterior",
    scopeVariant: "exterior_renovation",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30104", // EXT-FAS-001 Fascia & Soffit
    quantityFormula: "ceil((length * 2 + width * 2) / 10)",
    reasonTemplate: "Fascia & soffit replacement for {{service_type}} (perimeter-based).",
    priority: 20,
  },
  {
    ruleCode: "EXT-GUT-STD",
    serviceType: "exterior",
    scopeVariant: "exterior_renovation",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30105", // EXT-GUT-001 Gutter
    quantityFormula: "ceil((length * 2 + width * 2) / 10)",
    reasonTemplate: "Gutter replacement for {{service_type}} (perimeter-based).",
    priority: 25,
  },
  {
    ruleCode: "EXT-DWN-STD",
    serviceType: "exterior",
    scopeVariant: "exterior_renovation",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30106", // EXT-DWN-001 Downspout
    quantityFormula: "max(2, ceil((length * 2 + width * 2) / 25))",
    reasonTemplate: "Downspout replacement for {{service_type}}.",
    priority: 30,
  },
  {
    ruleCode: "EXT-CLK-STD",
    serviceType: "exterior",
    scopeVariant: "exterior_renovation",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30107", // EXT-CLK-001 Caulking & Sealing
    quantityFormula: "1",
    reasonTemplate: "Exterior caulking & sealing for {{service_type}}.",
    priority: 35,
  },
  {
    ruleCode: "EXT-PNT-STD",
    serviceType: "exterior",
    scopeVariant: "exterior_renovation",
    projectType: null,
    channel: null,
    zone: null,
    finishLevel: null,
    conditionJson: null,
    assemblyId: "30103", // EXT-PNT-001 Full Exterior Paint
    quantityFormula: "ceil(area / 200) * waste_factor",
    reasonTemplate: "Full exterior paint for {{service_type}}.",
    priority: 40,
  },
];

// ══════════════════════════════════════════════════════════════════════
// COMBINED EXPORT
// ══════════════════════════════════════════════════════════════════════

/** All scope rules across 9 trade groups (canonical taxonomy) */
export const ALL_SCOPE_RULES: ScopeRuleSeed[] = [
  ...KITCHEN_RULES,
  ...BATHROOM_RULES,
  ...ROOFING_RULES,
  ...SIDING_RULES,
  ...WINDOW_DOOR_RULES,
  ...DECK_RULES,
  ...PAINT_RULES,
  ...FLOORING_RULES,
  ...EXTERIOR_RULES,
];

/** Rule count by trade for verification */
export const RULE_COUNTS = {
  kitchen: KITCHEN_RULES.length,
  bathroom: BATHROOM_RULES.length,
  roofing: ROOFING_RULES.length,
  siding: SIDING_RULES.length,
  windowsDoors: WINDOW_DOOR_RULES.length,
  deck: DECK_RULES.length,
  paint: PAINT_RULES.length,
  flooring: FLOORING_RULES.length,
  exterior: EXTERIOR_RULES.length,
  total: 0,
};
RULE_COUNTS.total = Object.values(RULE_COUNTS).reduce((a, b) => a + b, 0);
