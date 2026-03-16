/**
 * structr.ai — Remodel Template Seed Data
 * Sprint 13: Remodel Workflow Coordinator
 *
 * Provides pre-built remodel templates for key service types.
 * Each template defines:
 *   - Required scope rules (which scope rules must match for this template)
 *   - Default assemblies (always included)
 *   - Optional assemblies (available for add-on)
 *   - Workflow steps (construction sequence with assembly assignments)
 *   - Typical sqft range and estimated duration
 *
 * Templates are organized by:
 *   1. Kitchen Remodel (Standard, Premium, Luxury)
 *   2. Bathroom Remodel (Standard, Premium)
 *   3. Roofing (Standard, Coastal)
 *   4. Siding (Standard, Coastal)
 *   5. Windows & Doors (Standard, Coastal)
 *   6. Deck & Porch (Standard, Premium)
 *   7. Painting (Interior, Exterior, Full)
 *   8. Flooring (Standard, Premium)
 *   9. Exterior (Standard)
 *  10. Full Remodel (Standard, Premium)
 *
 * Total: 18 templates across 10 service types
 */

import type { WorkflowStep, RequiredScopeRuleRef } from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// SEED INTERFACE
// ══════════════════════════════════════════════════════════════════════

export interface RemodelTemplateSeed {
  name: string;
  serviceType: string;
  finishLevel?: string;
  zone?: string;
  channel?: string;
  description?: string;
  requiredScopeRules?: RequiredScopeRuleRef[];
  defaultAssemblies?: number[];
  optionalAssemblies?: number[];
  workflowSteps?: WorkflowStep[];
  typicalSqftRange?: { min: number; max: number };
  estimatedDuration?: string;
}

// ══════════════════════════════════════════════════════════════════════
// 1. KITCHEN REMODEL TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const KITCHEN_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Kitchen Remodel — Standard",
    serviceType: "kitchen_remodel",
    finishLevel: "standard",
    description: "Complete kitchen renovation with stock cabinets, laminate countertops, and standard appliances. Typical Charleston-area kitchen remodel.",
    requiredScopeRules: [
      { ruleCode: "KIT-DEMO-STD", mandatory: true },
      { ruleCode: "KIT-CAB-STD", mandatory: true },
      { ruleCode: "KIT-CTR-STD", mandatory: true },
      { ruleCode: "KIT-SNK-STD", mandatory: true },
      { ruleCode: "KIT-BSP-STD", mandatory: false },
      { ruleCode: "KIT-PNT-STD", mandatory: true },
      { ruleCode: "KIT-APP-STD", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection & Prep", assemblyIds: [] },
      { order: 2, code: "demo", label: "Kitchen Demolition", assemblyIds: [] },
      { order: 3, code: "rough_electrical", label: "Rough Electrical", assemblyIds: [] },
      { order: 4, code: "rough_plumbing", label: "Rough Plumbing", assemblyIds: [] },
      { order: 5, code: "drywall", label: "Drywall Repair", assemblyIds: [] },
      { order: 6, code: "prime_paint", label: "Prime & Paint", assemblyIds: [] },
      { order: 7, code: "finish_carpentry", label: "Cabinet Installation", assemblyIds: [] },
      { order: 8, code: "tile", label: "Backsplash Tile", assemblyIds: [] },
      { order: 9, code: "finish_install", label: "Countertop & Sink Install", assemblyIds: [] },
      { order: 10, code: "fixtures", label: "Fixtures & Appliances", assemblyIds: [] },
      { order: 11, code: "hardware", label: "Hardware & Final Touches", assemblyIds: [] },
      { order: 12, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 80, max: 200 },
    estimatedDuration: "3-5 weeks",
  },
  {
    name: "Kitchen Remodel — Premium",
    serviceType: "kitchen_remodel",
    finishLevel: "premium",
    description: "Premium kitchen renovation with semi-custom cabinets, quartz countertops, and upgraded appliances. Suitable for Mount Pleasant and Daniel Island.",
    requiredScopeRules: [
      { ruleCode: "KIT-DEMO-PRM", mandatory: true },
      { ruleCode: "KIT-CAB-PRM", mandatory: true },
      { ruleCode: "KIT-CTR-PRM", mandatory: true },
      { ruleCode: "KIT-SNK-STD", mandatory: true },
      { ruleCode: "KIT-BSP-STD", mandatory: true },
      { ruleCode: "KIT-PNT-STD", mandatory: true },
      { ruleCode: "KIT-APP-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection & Prep", assemblyIds: [] },
      { order: 2, code: "demo", label: "Kitchen Demolition (Premium)", assemblyIds: [] },
      { order: 3, code: "structural", label: "Structural Modifications", assemblyIds: [] },
      { order: 4, code: "rough_electrical", label: "Rough Electrical", assemblyIds: [] },
      { order: 5, code: "rough_plumbing", label: "Rough Plumbing", assemblyIds: [] },
      { order: 6, code: "insulation", label: "Insulation", assemblyIds: [] },
      { order: 7, code: "drywall", label: "Drywall", assemblyIds: [] },
      { order: 8, code: "prime_paint", label: "Prime & Paint", assemblyIds: [] },
      { order: 9, code: "finish_carpentry", label: "Cabinet Installation", assemblyIds: [] },
      { order: 10, code: "tile", label: "Backsplash Tile", assemblyIds: [] },
      { order: 11, code: "finish_install", label: "Countertop & Sink Install", assemblyIds: [] },
      { order: 12, code: "fixtures", label: "Fixtures & Appliances", assemblyIds: [] },
      { order: 13, code: "hardware", label: "Hardware & Final Touches", assemblyIds: [] },
      { order: 14, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 120, max: 300 },
    estimatedDuration: "4-7 weeks",
  },
  {
    name: "Kitchen Remodel — Luxury",
    serviceType: "kitchen_remodel",
    finishLevel: "luxury",
    description: "Luxury kitchen renovation with custom cabinets, natural stone countertops, and high-end appliances. Kiawah Island and Sullivans Island quality.",
    requiredScopeRules: [
      { ruleCode: "KIT-DEMO-PRM", mandatory: true },
      { ruleCode: "KIT-CAB-LUX", mandatory: true },
      { ruleCode: "KIT-CTR-LUX", mandatory: true },
      { ruleCode: "KIT-SNK-STD", mandatory: true },
      { ruleCode: "KIT-BSP-STD", mandatory: true },
      { ruleCode: "KIT-PNT-STD", mandatory: true },
      { ruleCode: "KIT-APP-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection & Prep", assemblyIds: [] },
      { order: 2, code: "demo", label: "Full Kitchen Demolition", assemblyIds: [] },
      { order: 3, code: "structural", label: "Structural Modifications", assemblyIds: [] },
      { order: 4, code: "framing", label: "Framing Adjustments", assemblyIds: [] },
      { order: 5, code: "rough_electrical", label: "Rough Electrical (Upgraded)", assemblyIds: [] },
      { order: 6, code: "rough_plumbing", label: "Rough Plumbing (Upgraded)", assemblyIds: [] },
      { order: 7, code: "insulation", label: "Insulation", assemblyIds: [] },
      { order: 8, code: "drywall", label: "Drywall", assemblyIds: [] },
      { order: 9, code: "prime_paint", label: "Prime & Paint", assemblyIds: [] },
      { order: 10, code: "finish_carpentry", label: "Custom Cabinet Installation", assemblyIds: [] },
      { order: 11, code: "tile", label: "Premium Backsplash Tile", assemblyIds: [] },
      { order: 12, code: "finish_install", label: "Stone Countertop & Undermount Sink", assemblyIds: [] },
      { order: 13, code: "fixtures", label: "High-End Fixtures & Appliances", assemblyIds: [] },
      { order: 14, code: "hardware", label: "Premium Hardware & Final Touches", assemblyIds: [] },
      { order: 15, code: "cleanup", label: "Final Cleanup", assemblyIds: [] },
      { order: 16, code: "final_inspection", label: "Final Inspection", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 150, max: 500 },
    estimatedDuration: "6-10 weeks",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 2. BATHROOM REMODEL TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const BATHROOM_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Bathroom Remodel — Standard",
    serviceType: "bathroom_remodel",
    finishLevel: "standard",
    description: "Standard bathroom renovation with vanity, toilet, shower/tub, tile, and paint. Typical for Goose Creek and Summerville.",
    requiredScopeRules: [
      { ruleCode: "BTH-DEMO-STD", mandatory: true },
      { ruleCode: "BTH-VAN-STD", mandatory: true },
      { ruleCode: "BTH-TOI-STD", mandatory: true },
      { ruleCode: "BTH-SHW-STD", mandatory: true },
      { ruleCode: "BTH-TIL-STD", mandatory: true },
      { ruleCode: "BTH-PNT-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Bathroom Demolition", assemblyIds: [] },
      { order: 3, code: "rough_plumbing", label: "Rough Plumbing", assemblyIds: [] },
      { order: 4, code: "rough_electrical", label: "Rough Electrical", assemblyIds: [] },
      { order: 5, code: "waterproofing", label: "Waterproofing", assemblyIds: [] },
      { order: 6, code: "drywall", label: "Drywall & Backer Board", assemblyIds: [] },
      { order: 7, code: "tile", label: "Tile Installation", assemblyIds: [] },
      { order: 8, code: "prime_paint", label: "Prime & Paint", assemblyIds: [] },
      { order: 9, code: "finish_install", label: "Vanity & Toilet Install", assemblyIds: [] },
      { order: 10, code: "fixtures", label: "Fixtures & Accessories", assemblyIds: [] },
      { order: 11, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 35, max: 80 },
    estimatedDuration: "2-3 weeks",
  },
  {
    name: "Bathroom Remodel — Premium",
    serviceType: "bathroom_remodel",
    finishLevel: "premium",
    description: "Premium bathroom renovation with upgraded vanity, custom tile, and premium fixtures. Suitable for Mount Pleasant and James Island.",
    requiredScopeRules: [
      { ruleCode: "BTH-DEMO-STD", mandatory: true },
      { ruleCode: "BTH-VAN-PRM", mandatory: true },
      { ruleCode: "BTH-TOI-STD", mandatory: true },
      { ruleCode: "BTH-SHW-STD", mandatory: true },
      { ruleCode: "BTH-TIL-STD", mandatory: true },
      { ruleCode: "BTH-PNT-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Bathroom Demolition", assemblyIds: [] },
      { order: 3, code: "rough_plumbing", label: "Rough Plumbing", assemblyIds: [] },
      { order: 4, code: "rough_electrical", label: "Rough Electrical", assemblyIds: [] },
      { order: 5, code: "waterproofing", label: "Waterproofing", assemblyIds: [] },
      { order: 6, code: "insulation", label: "Insulation", assemblyIds: [] },
      { order: 7, code: "drywall", label: "Drywall & Backer Board", assemblyIds: [] },
      { order: 8, code: "tile", label: "Custom Tile Installation", assemblyIds: [] },
      { order: 9, code: "prime_paint", label: "Prime & Paint", assemblyIds: [] },
      { order: 10, code: "finish_carpentry", label: "Finish Carpentry", assemblyIds: [] },
      { order: 11, code: "finish_install", label: "Premium Vanity & Toilet", assemblyIds: [] },
      { order: 12, code: "fixtures", label: "Premium Fixtures", assemblyIds: [] },
      { order: 13, code: "hardware", label: "Hardware & Accessories", assemblyIds: [] },
      { order: 14, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 50, max: 120 },
    estimatedDuration: "3-5 weeks",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 3. ROOFING TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const ROOFING_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Roofing — Standard",
    serviceType: "roofing",
    finishLevel: "standard",
    description: "Standard roof replacement with architectural shingles, drip edge, ridge vent, and flashing. Inland Charleston area.",
    requiredScopeRules: [
      { ruleCode: "ROF-DEMO-STD", mandatory: true },
      { ruleCode: "ROF-SHG-STD", mandatory: true },
      { ruleCode: "ROF-DRP-STD", mandatory: true },
      { ruleCode: "ROF-RDG-STD", mandatory: true },
      { ruleCode: "ROF-FLS-PPB", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection & Dumpster", assemblyIds: [] },
      { order: 2, code: "demo", label: "Tear-Off Existing Roof", assemblyIds: [] },
      { order: 3, code: "structural", label: "Decking Repair (if needed)", assemblyIds: [] },
      { order: 4, code: "waterproofing", label: "Underlayment & Ice Shield", assemblyIds: [] },
      { order: 5, code: "finish_install", label: "Shingle Installation", assemblyIds: [] },
      { order: 6, code: "fixtures", label: "Drip Edge, Ridge Vent, Flashing", assemblyIds: [] },
      { order: 7, code: "cleanup", label: "Cleanup & Magnet Sweep", assemblyIds: [] },
      { order: 8, code: "final_inspection", label: "Final Inspection", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1200, max: 3500 },
    estimatedDuration: "2-4 days",
  },
  {
    name: "Roofing — Coastal Hardened",
    serviceType: "roofing",
    finishLevel: "premium",
    zone: "coastal",
    description: "Coastal-rated roof replacement with impact-resistant shingles, enhanced flashing, and hurricane straps. Required for barrier islands and coastal zones.",
    requiredScopeRules: [
      { ruleCode: "ROF-DEMO-STD", mandatory: true },
      { ruleCode: "ROF-SHG-COASTAL", mandatory: true },
      { ruleCode: "ROF-DRP-STD", mandatory: true },
      { ruleCode: "ROF-RDG-STD", mandatory: true },
      { ruleCode: "ROF-FLS-CHM", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection & Dumpster", assemblyIds: [] },
      { order: 2, code: "demo", label: "Tear-Off Existing Roof", assemblyIds: [] },
      { order: 3, code: "structural", label: "Decking Repair & Hurricane Straps", assemblyIds: [] },
      { order: 4, code: "waterproofing", label: "Enhanced Underlayment & Ice Shield", assemblyIds: [] },
      { order: 5, code: "finish_install", label: "Impact-Resistant Shingle Installation", assemblyIds: [] },
      { order: 6, code: "fixtures", label: "Coastal Flashing, Drip Edge, Ridge Vent", assemblyIds: [] },
      { order: 7, code: "cleanup", label: "Cleanup & Magnet Sweep", assemblyIds: [] },
      { order: 8, code: "final_inspection", label: "Coastal Code Inspection", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1200, max: 3500 },
    estimatedDuration: "3-5 days",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 4. SIDING TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const SIDING_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Siding — Standard",
    serviceType: "siding",
    finishLevel: "standard",
    description: "Standard vinyl siding replacement with trim and soffit. Typical for inland Charleston area.",
    requiredScopeRules: [
      { ruleCode: "SID-DEMO-STD", mandatory: true },
      { ruleCode: "SID-VNL-STD", mandatory: true },
      { ruleCode: "SID-TRM-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Remove Existing Siding", assemblyIds: [] },
      { order: 3, code: "structural", label: "Sheathing Repair (if needed)", assemblyIds: [] },
      { order: 4, code: "waterproofing", label: "House Wrap", assemblyIds: [] },
      { order: 5, code: "finish_install", label: "Siding Installation", assemblyIds: [] },
      { order: 6, code: "finish_carpentry", label: "Trim & Soffit", assemblyIds: [] },
      { order: 7, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 800, max: 3000 },
    estimatedDuration: "3-7 days",
  },
  {
    name: "Siding — Coastal Fiber Cement",
    serviceType: "siding",
    finishLevel: "premium",
    zone: "coastal",
    description: "Coastal-rated fiber cement siding (HardiePlank) with enhanced moisture protection. Required for barrier islands.",
    requiredScopeRules: [
      { ruleCode: "SID-DEMO-STD", mandatory: true },
      { ruleCode: "SID-FBC-COASTAL", mandatory: true },
      { ruleCode: "SID-TRM-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Remove Existing Siding", assemblyIds: [] },
      { order: 3, code: "structural", label: "Sheathing Repair & Reinforcement", assemblyIds: [] },
      { order: 4, code: "waterproofing", label: "Enhanced House Wrap & Flashing", assemblyIds: [] },
      { order: 5, code: "finish_install", label: "Fiber Cement Siding Installation", assemblyIds: [] },
      { order: 6, code: "finish_carpentry", label: "Trim & Soffit", assemblyIds: [] },
      { order: 7, code: "paint", label: "Exterior Paint", assemblyIds: [] },
      { order: 8, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 800, max: 3000 },
    estimatedDuration: "5-10 days",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 5. WINDOWS & DOORS TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const WINDOWS_DOORS_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Windows & Doors — Standard",
    serviceType: "windows_doors",
    finishLevel: "standard",
    description: "Standard window and door replacement with double-hung windows and exterior doors. Inland Charleston.",
    requiredScopeRules: [
      { ruleCode: "WIN-DH-STD", mandatory: true },
      { ruleCode: "DOO-EXT-STD", mandatory: true },
      { ruleCode: "WIN-TRM-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Interior Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Remove Existing Windows/Doors", assemblyIds: [] },
      { order: 3, code: "waterproofing", label: "Flashing & Weatherproofing", assemblyIds: [] },
      { order: 4, code: "finish_install", label: "Window & Door Installation", assemblyIds: [] },
      { order: 5, code: "finish_carpentry", label: "Interior/Exterior Trim", assemblyIds: [] },
      { order: 6, code: "paint", label: "Touch-Up Paint", assemblyIds: [] },
      { order: 7, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1200, max: 3500 },
    estimatedDuration: "2-5 days",
  },
  {
    name: "Windows & Doors — Coastal Impact-Rated",
    serviceType: "windows_doors",
    finishLevel: "premium",
    zone: "coastal",
    description: "Impact-rated windows and reinforced doors for coastal zones. Meets SC coastal building code requirements.",
    requiredScopeRules: [
      { ruleCode: "WIN-IMP-COASTAL", mandatory: true },
      { ruleCode: "DOO-EXT-PRM", mandatory: true },
      { ruleCode: "WIN-TRM-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Interior Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Remove Existing Windows/Doors", assemblyIds: [] },
      { order: 3, code: "structural", label: "Opening Reinforcement", assemblyIds: [] },
      { order: 4, code: "waterproofing", label: "Enhanced Flashing & Sealing", assemblyIds: [] },
      { order: 5, code: "finish_install", label: "Impact Window & Door Installation", assemblyIds: [] },
      { order: 6, code: "finish_carpentry", label: "Interior/Exterior Trim", assemblyIds: [] },
      { order: 7, code: "paint", label: "Touch-Up Paint", assemblyIds: [] },
      { order: 8, code: "cleanup", label: "Cleanup", assemblyIds: [] },
      { order: 9, code: "final_inspection", label: "Coastal Code Inspection", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1200, max: 3500 },
    estimatedDuration: "3-7 days",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 6. DECK & PORCH TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const DECK_PORCH_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Deck & Porch — Standard",
    serviceType: "deck_porch",
    finishLevel: "standard",
    description: "Standard pressure-treated deck with railing and post treatment. Typical for Summerville and Goose Creek.",
    requiredScopeRules: [
      { ruleCode: "DK-DEMO-STD", mandatory: true },
      { ruleCode: "DK-FRM-STD", mandatory: true },
      { ruleCode: "DK-PT-STD", mandatory: true },
      { ruleCode: "DK-RAL-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Prep & Layout", assemblyIds: [] },
      { order: 2, code: "demo", label: "Demolition (if existing)", assemblyIds: [] },
      { order: 3, code: "structural", label: "Footings & Posts", assemblyIds: [] },
      { order: 4, code: "framing", label: "Deck Framing", assemblyIds: [] },
      { order: 5, code: "finish_install", label: "Decking Installation", assemblyIds: [] },
      { order: 6, code: "finish_carpentry", label: "Railing & Stairs", assemblyIds: [] },
      { order: 7, code: "paint", label: "Stain/Seal", assemblyIds: [] },
      { order: 8, code: "cleanup", label: "Cleanup", assemblyIds: [] },
      { order: 9, code: "final_inspection", label: "Final Inspection", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 100, max: 500 },
    estimatedDuration: "1-2 weeks",
  },
  {
    name: "Deck & Porch — Premium Composite",
    serviceType: "deck_porch",
    finishLevel: "premium",
    description: "Premium composite deck with screened porch option. Suitable for Mount Pleasant and Daniel Island.",
    requiredScopeRules: [
      { ruleCode: "DK-DEMO-STD", mandatory: true },
      { ruleCode: "DK-FRM-STD", mandatory: true },
      { ruleCode: "DK-CMP-PRM", mandatory: true },
      { ruleCode: "DK-RAL-STD", mandatory: true },
      { ruleCode: "DK-SCR-STD", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Prep & Layout", assemblyIds: [] },
      { order: 2, code: "demo", label: "Demolition (if existing)", assemblyIds: [] },
      { order: 3, code: "structural", label: "Footings & Posts", assemblyIds: [] },
      { order: 4, code: "framing", label: "Deck Framing", assemblyIds: [] },
      { order: 5, code: "finish_install", label: "Composite Decking Installation", assemblyIds: [] },
      { order: 6, code: "finish_carpentry", label: "Railing, Stairs & Screen", assemblyIds: [] },
      { order: 7, code: "fixtures", label: "Lighting & Accessories", assemblyIds: [] },
      { order: 8, code: "cleanup", label: "Cleanup", assemblyIds: [] },
      { order: 9, code: "final_inspection", label: "Final Inspection", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 150, max: 600 },
    estimatedDuration: "2-3 weeks",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 7. PAINTING TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const PAINTING_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Interior Painting",
    serviceType: "painting",
    finishLevel: "standard",
    description: "Full interior painting including walls, ceilings, and trim. Standard prep and two-coat system.",
    requiredScopeRules: [
      { ruleCode: "PNT-WAL-STD", mandatory: true },
      { ruleCode: "PNT-WLC-STD", mandatory: false },
      { ruleCode: "PNT-PAT-STD", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Floor & Furniture Protection", assemblyIds: [] },
      { order: 2, code: "prime_paint", label: "Surface Prep & Patching", assemblyIds: [] },
      { order: 3, code: "paint", label: "Paint Application (2 coats)", assemblyIds: [] },
      { order: 4, code: "finish_carpentry", label: "Trim Paint", assemblyIds: [] },
      { order: 5, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 800, max: 4000 },
    estimatedDuration: "2-5 days",
  },
  {
    name: "Exterior Painting",
    serviceType: "painting",
    finishLevel: "standard",
    description: "Full exterior painting including siding, trim, and fascia. Pressure wash prep included.",
    requiredScopeRules: [
      { ruleCode: "PNT-EXT-STD", mandatory: true },
      { ruleCode: "PNT-PAT-STD", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Landscape & Window Protection", assemblyIds: [] },
      { order: 2, code: "prime_paint", label: "Pressure Wash & Scrape", assemblyIds: [] },
      { order: 3, code: "paint", label: "Exterior Paint Application", assemblyIds: [] },
      { order: 4, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1000, max: 4000 },
    estimatedDuration: "3-7 days",
  },
  {
    name: "Full House Painting (Interior + Exterior)",
    serviceType: "painting",
    finishLevel: "premium",
    description: "Complete interior and exterior painting package. Premium prep with caulking and patching.",
    requiredScopeRules: [
      { ruleCode: "PNT-FUL-STD", mandatory: true },
      { ruleCode: "PNT-PAT-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Full Site Protection", assemblyIds: [] },
      { order: 2, code: "prime_paint", label: "Exterior Pressure Wash & Prep", assemblyIds: [] },
      { order: 3, code: "paint", label: "Exterior Paint Application", assemblyIds: [] },
      { order: 4, code: "prime_paint", label: "Interior Surface Prep & Patching", assemblyIds: [] },
      { order: 5, code: "paint", label: "Interior Paint Application", assemblyIds: [] },
      { order: 6, code: "finish_carpentry", label: "All Trim Paint", assemblyIds: [] },
      { order: 7, code: "cleanup", label: "Final Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1200, max: 5000 },
    estimatedDuration: "5-10 days",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 8. FLOORING TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const FLOORING_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Flooring — Standard (LVP/Carpet)",
    serviceType: "flooring",
    finishLevel: "standard",
    description: "Standard flooring replacement with LVP or carpet. Includes demo, subfloor prep, and installation.",
    requiredScopeRules: [
      { ruleCode: "FLR-DEMO-STD", mandatory: true },
      { ruleCode: "FLR-LVP-STD", mandatory: false },
      { ruleCode: "FLR-CPT-STD", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Furniture Move & Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Remove Existing Flooring", assemblyIds: [] },
      { order: 3, code: "finish_install", label: "Subfloor Prep & Leveling", assemblyIds: [] },
      { order: 4, code: "flooring", label: "Flooring Installation", assemblyIds: [] },
      { order: 5, code: "finish_carpentry", label: "Transitions & Baseboards", assemblyIds: [] },
      { order: 6, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 200, max: 3000 },
    estimatedDuration: "2-5 days",
  },
  {
    name: "Flooring — Premium (Hardwood/Tile)",
    serviceType: "flooring",
    finishLevel: "premium",
    description: "Premium flooring with hardwood or porcelain tile. Includes subfloor prep, installation, and finishing.",
    requiredScopeRules: [
      { ruleCode: "FLR-DEMO-STD", mandatory: true },
      { ruleCode: "FLR-HWD-PRM", mandatory: false },
      { ruleCode: "FLR-TIL-STD", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Furniture Move & Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Remove Existing Flooring", assemblyIds: [] },
      { order: 3, code: "finish_install", label: "Subfloor Prep & Leveling", assemblyIds: [] },
      { order: 4, code: "flooring", label: "Premium Flooring Installation", assemblyIds: [] },
      { order: 5, code: "finish_carpentry", label: "Transitions & Baseboards", assemblyIds: [] },
      { order: 6, code: "paint", label: "Baseboard Touch-Up Paint", assemblyIds: [] },
      { order: 7, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 200, max: 3000 },
    estimatedDuration: "3-7 days",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 9. EXTERIOR TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const EXTERIOR_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Exterior Maintenance Package",
    serviceType: "exterior",
    finishLevel: "standard",
    description: "Comprehensive exterior maintenance: gutters, downspouts, fascia, caulking, and paint. Preventive maintenance package.",
    requiredScopeRules: [
      { ruleCode: "EXT-GUT-STD", mandatory: true },
      { ruleCode: "EXT-DWN-STD", mandatory: true },
      { ruleCode: "EXT-FAS-STD", mandatory: true },
      { ruleCode: "EXT-CLK-STD", mandatory: true },
      { ruleCode: "EXT-PNT-STD", mandatory: false },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Site Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Remove Damaged Components", assemblyIds: [] },
      { order: 3, code: "finish_install", label: "Gutter & Downspout Install", assemblyIds: [] },
      { order: 4, code: "finish_carpentry", label: "Fascia Repair/Replace", assemblyIds: [] },
      { order: 5, code: "waterproofing", label: "Caulking & Sealing", assemblyIds: [] },
      { order: 6, code: "paint", label: "Exterior Touch-Up Paint", assemblyIds: [] },
      { order: 7, code: "cleanup", label: "Cleanup", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1000, max: 4000 },
    estimatedDuration: "2-4 days",
  },
];

// ══════════════════════════════════════════════════════════════════════
// 10. FULL REMODEL TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const FULL_REMODEL_TEMPLATES: RemodelTemplateSeed[] = [
  {
    name: "Full Home Remodel — Standard",
    serviceType: "full_remodel",
    finishLevel: "standard",
    description: "Complete home renovation covering kitchen, bathrooms, flooring, painting, and exterior. Coordinated multi-trade workflow for whole-house projects.",
    requiredScopeRules: [
      { ruleCode: "KIT-DEMO-STD", mandatory: true },
      { ruleCode: "KIT-CAB-STD", mandatory: true },
      { ruleCode: "KIT-CTR-STD", mandatory: true },
      { ruleCode: "BTH-DEMO-STD", mandatory: true },
      { ruleCode: "BTH-VAN-STD", mandatory: true },
      { ruleCode: "FLR-DEMO-STD", mandatory: true },
      { ruleCode: "FLR-LVP-STD", mandatory: true },
      { ruleCode: "PNT-FUL-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Full Site Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Demolition (All Areas)", assemblyIds: [] },
      { order: 3, code: "structural", label: "Structural Repairs", assemblyIds: [] },
      { order: 4, code: "framing", label: "Framing Modifications", assemblyIds: [] },
      { order: 5, code: "mechanical", label: "HVAC Modifications", assemblyIds: [] },
      { order: 6, code: "rough_electrical", label: "Rough Electrical (All Areas)", assemblyIds: [] },
      { order: 7, code: "rough_plumbing", label: "Rough Plumbing (Kitchen + Bath)", assemblyIds: [] },
      { order: 8, code: "insulation", label: "Insulation", assemblyIds: [] },
      { order: 9, code: "waterproofing", label: "Waterproofing (Bathrooms)", assemblyIds: [] },
      { order: 10, code: "drywall", label: "Drywall (All Areas)", assemblyIds: [] },
      { order: 11, code: "tile", label: "Tile (Kitchen + Bathrooms)", assemblyIds: [] },
      { order: 12, code: "prime_paint", label: "Prime & Paint (All Areas)", assemblyIds: [] },
      { order: 13, code: "finish_carpentry", label: "Cabinets, Trim & Finish Carpentry", assemblyIds: [] },
      { order: 14, code: "finish_install", label: "Countertops, Fixtures, Appliances", assemblyIds: [] },
      { order: 15, code: "flooring", label: "Flooring (All Areas)", assemblyIds: [] },
      { order: 16, code: "fixtures", label: "All Fixtures & Hardware", assemblyIds: [] },
      { order: 17, code: "paint", label: "Final Paint Touch-Up", assemblyIds: [] },
      { order: 18, code: "hardware", label: "Hardware & Accessories", assemblyIds: [] },
      { order: 19, code: "cleanup", label: "Final Cleanup", assemblyIds: [] },
      { order: 20, code: "final_inspection", label: "Final Inspection & Walkthrough", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1000, max: 3500 },
    estimatedDuration: "8-16 weeks",
  },
  {
    name: "Full Home Remodel — Premium",
    serviceType: "full_remodel",
    finishLevel: "premium",
    description: "Premium whole-house renovation with upgraded finishes throughout. Suitable for Mount Pleasant, Daniel Island, and James Island properties.",
    requiredScopeRules: [
      { ruleCode: "KIT-DEMO-PRM", mandatory: true },
      { ruleCode: "KIT-CAB-PRM", mandatory: true },
      { ruleCode: "KIT-CTR-PRM", mandatory: true },
      { ruleCode: "BTH-DEMO-STD", mandatory: true },
      { ruleCode: "BTH-VAN-PRM", mandatory: true },
      { ruleCode: "FLR-DEMO-STD", mandatory: true },
      { ruleCode: "FLR-HWD-PRM", mandatory: true },
      { ruleCode: "PNT-FUL-STD", mandatory: true },
    ],
    workflowSteps: [
      { order: 1, code: "protection", label: "Full Site Protection", assemblyIds: [] },
      { order: 2, code: "demo", label: "Demolition (All Areas)", assemblyIds: [] },
      { order: 3, code: "structural", label: "Structural Repairs & Upgrades", assemblyIds: [] },
      { order: 4, code: "framing", label: "Framing Modifications", assemblyIds: [] },
      { order: 5, code: "mechanical", label: "HVAC Upgrades", assemblyIds: [] },
      { order: 6, code: "rough_electrical", label: "Rough Electrical (Upgraded)", assemblyIds: [] },
      { order: 7, code: "rough_plumbing", label: "Rough Plumbing (Upgraded)", assemblyIds: [] },
      { order: 8, code: "insulation", label: "Insulation", assemblyIds: [] },
      { order: 9, code: "waterproofing", label: "Waterproofing", assemblyIds: [] },
      { order: 10, code: "drywall", label: "Drywall (All Areas)", assemblyIds: [] },
      { order: 11, code: "tile", label: "Premium Tile (Kitchen + Bathrooms)", assemblyIds: [] },
      { order: 12, code: "prime_paint", label: "Prime & Paint", assemblyIds: [] },
      { order: 13, code: "finish_carpentry", label: "Premium Cabinets, Trim & Millwork", assemblyIds: [] },
      { order: 14, code: "finish_install", label: "Quartz Countertops, Premium Fixtures", assemblyIds: [] },
      { order: 15, code: "flooring", label: "Hardwood Flooring (All Areas)", assemblyIds: [] },
      { order: 16, code: "fixtures", label: "Premium Fixtures & Hardware", assemblyIds: [] },
      { order: 17, code: "paint", label: "Final Paint Touch-Up", assemblyIds: [] },
      { order: 18, code: "hardware", label: "Premium Hardware & Accessories", assemblyIds: [] },
      { order: 19, code: "cleanup", label: "Final Cleanup", assemblyIds: [] },
      { order: 20, code: "final_inspection", label: "Final Inspection & Walkthrough", assemblyIds: [] },
    ],
    typicalSqftRange: { min: 1200, max: 5000 },
    estimatedDuration: "12-20 weeks",
  },
];

// ══════════════════════════════════════════════════════════════════════
// COMBINED EXPORT
// ══════════════════════════════════════════════════════════════════════

/** All remodel templates — 18 templates across 10 service types */
export const ALL_REMODEL_TEMPLATES: RemodelTemplateSeed[] = [
  ...KITCHEN_TEMPLATES,
  ...BATHROOM_TEMPLATES,
  ...ROOFING_TEMPLATES,
  ...SIDING_TEMPLATES,
  ...WINDOWS_DOORS_TEMPLATES,
  ...DECK_PORCH_TEMPLATES,
  ...PAINTING_TEMPLATES,
  ...FLOORING_TEMPLATES,
  ...EXTERIOR_TEMPLATES,
  ...FULL_REMODEL_TEMPLATES,
];

/** Template counts by service type for validation */
export const TEMPLATE_COUNTS: Record<string, number> = {
  kitchen_remodel: KITCHEN_TEMPLATES.length,
  bathroom_remodel: BATHROOM_TEMPLATES.length,
  roofing: ROOFING_TEMPLATES.length,
  siding: SIDING_TEMPLATES.length,
  windows_doors: WINDOWS_DOORS_TEMPLATES.length,
  deck_porch: DECK_PORCH_TEMPLATES.length,
  painting: PAINTING_TEMPLATES.length,
  flooring: FLOORING_TEMPLATES.length,
  exterior: EXTERIOR_TEMPLATES.length,
  full_remodel: FULL_REMODEL_TEMPLATES.length,
};

/** Individual group exports for testing */
export {
  KITCHEN_TEMPLATES,
  BATHROOM_TEMPLATES,
  ROOFING_TEMPLATES,
  SIDING_TEMPLATES,
  WINDOWS_DOORS_TEMPLATES,
  DECK_PORCH_TEMPLATES,
  PAINTING_TEMPLATES,
  FLOORING_TEMPLATES,
  EXTERIOR_TEMPLATES,
  FULL_REMODEL_TEMPLATES,
};
