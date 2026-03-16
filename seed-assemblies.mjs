/**
 * seed-assemblies.mjs — Import Supabase assemblies + assembly_items into MySQL
 * 
 * Source: Supabase GCHI Dominance Engine (xoqhxpqsfxpdiwyuvhdd)
 * Target: MySQL assemblies + assembly_components tables
 * 
 * This script:
 * 1. Inserts 15 assemblies with Supabase UUID preserved in supabaseId
 * 2. Inserts 117 assembly_components linked to the new MySQL assembly IDs
 * 3. Maps Supabase cost_type names to the assembly_components description
 * 4. Preserves all BOM data: qty_per_unit, waste_factor, sort_order, unit
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// ── Supabase Assembly Data (denormalized) ──────────────────────────────

const ASSEMBLIES = [
  { supabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", name: "Bathroom Remodel (Standard)", category: "bathroom", description: "Bathroom Remodel (Standard) - Charleston SC", defaultUnit: "sf", baseUnitQty: 50, wasteFactor: 0.10 },
  { supabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", name: "Concrete Patio 12x12", category: "concrete", description: "Concrete Patio 12x12 - Charleston SC", defaultUnit: "sf", baseUnitQty: 144, wasteFactor: 0.10 },
  { supabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", name: "Standard Deck 10x12 (Wood)", category: "decking", description: "Pressure-treated wood deck 10ft x 12ft (120 sq ft). Includes framing lumber, decking boards, fasteners, and labor.", defaultUnit: "sf", baseUnitQty: 120, wasteFactor: 0.10 },
  { supabaseId: "37fc74f9-c1f0-4d1d-aa2f-475351b0f3c3", name: "Drywall Repair/Renovation (per Room)", category: "drywall", description: "Drywall Repair/Renovation (per Room) - Charleston SC", defaultUnit: "sf", baseUnitQty: 450, wasteFactor: 0.10 },
  { supabaseId: "775d4563-4973-4e84-b75f-508d045234e7", name: "Electrical Panel Upgrade 200A", category: "electrical", description: "Electrical Panel Upgrade 200A - Charleston SC", defaultUnit: "ea", baseUnitQty: 1, wasteFactor: 0.00 },
  { supabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", name: "Wood Privacy Fence 6ft (per LF)", category: "fencing", description: "Wood Privacy Fence 6ft (per LF) - Charleston SC", defaultUnit: "lf", baseUnitQty: 100, wasteFactor: 0.10 },
  { supabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", name: "Hardwood Floor Installation", category: "flooring", description: "Hardwood Floor Installation - Charleston SC", defaultUnit: "sf", baseUnitQty: 500, wasteFactor: 0.10 },
  { supabaseId: "4c896373-d99b-431a-a56c-70ce2432a3a9", name: "LVP Flooring Installation", category: "flooring", description: "LVP Flooring Installation - Charleston SC", defaultUnit: "sf", baseUnitQty: 500, wasteFactor: 0.10 },
  { supabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", name: "Kitchen Remodel (Standard)", category: "kitchen", description: "Kitchen Remodel (Standard) - Charleston SC", defaultUnit: "sf", baseUnitQty: 150, wasteFactor: 0.10 },
  { supabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", name: "Exterior Painting (Full House)", category: "painting", description: "Exterior Painting (Full House) - Charleston SC", defaultUnit: "sf", baseUnitQty: 2000, wasteFactor: 0.10 },
  { supabaseId: "daf0c897-7722-49c6-835d-6a309bdf895c", name: "Interior Painting (per Room)", category: "painting", description: "Interior Painting (per Room) - Charleston SC", defaultUnit: "sf", baseUnitQty: 450, wasteFactor: 0.05 },
  { supabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", name: "Full Roof Replacement", category: "roofing", description: "Complete tear-off and re-roof with architectural shingles", defaultUnit: "sq", baseUnitQty: 1, wasteFactor: 0.12 },
  { supabaseId: "0a9f5a24-1dbe-48d5-8916-e38ad3fde585", name: "Gutter Installation (per LF)", category: "roofing", description: "Gutter Installation (per LF) - Charleston SC", defaultUnit: "lf", baseUnitQty: 150, wasteFactor: 0.05 },
  { supabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", name: "Vinyl Siding Replacement", category: "siding", description: "Vinyl Siding Replacement - Charleston SC", defaultUnit: "sf", baseUnitQty: 1500, wasteFactor: 0.10 },
  { supabaseId: "72d443d8-03d4-47c7-9713-a101fc3d0c16", name: "Window Replacement (per Window)", category: "windows", description: "Window Replacement (per Window) - Charleston SC", defaultUnit: "ea", baseUnitQty: 1, wasteFactor: 0.00 },
];

// Generate assembly code from category + name
function makeCode(name, category) {
  const prefix = category.substring(0, 3).toUpperCase();
  const words = name.split(/[\s\-()]+/).filter(Boolean).slice(0, 3);
  const suffix = words.map(w => w.substring(0, 3).toUpperCase()).join("");
  return `${prefix}-${suffix}`;
}

// ── Supabase Assembly Items (117 items) ────────────────────────────────
// Denormalized from the Supabase query with cost_code_name, cost_type_name, unit_abbr

const ASSEMBLY_ITEMS = [
  // Gutter Installation (per LF) — 6 items
  { assemblySupabaseId: "0a9f5a24-1dbe-48d5-8916-e38ad3fde585", description: "5in seamless aluminum gutter installed", qtyPerUnit: "1.0000", wasteFactor: "0.0500", sortOrder: 1, costType: "Subcontractor", unit: "lf" },
  { assemblySupabaseId: "0a9f5a24-1dbe-48d5-8916-e38ad3fde585", description: "Downspouts 10ft sections (1 per 40lf = 3.75)", qtyPerUnit: "0.0250", wasteFactor: "0.0500", sortOrder: 2, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "0a9f5a24-1dbe-48d5-8916-e38ad3fde585", description: "End caps, outlets, elbows, splash blocks", qtyPerUnit: "0.0400", wasteFactor: "0.0500", sortOrder: 3, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "0a9f5a24-1dbe-48d5-8916-e38ad3fde585", description: "Hidden hangers and screws (1 per 2lf)", qtyPerUnit: "0.5000", wasteFactor: "0.0500", sortOrder: 4, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "0a9f5a24-1dbe-48d5-8916-e38ad3fde585", description: "Permit if required", qtyPerUnit: "0.0067", wasteFactor: "0.0000", sortOrder: 5, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "0a9f5a24-1dbe-48d5-8916-e38ad3fde585", description: "Job cleanup", qtyPerUnit: "0.0067", wasteFactor: "0.0000", sortOrder: 6, costType: "Other", unit: "ls" },

  // Drywall Repair/Renovation (per Room) — 5 items
  { assemblySupabaseId: "37fc74f9-c1f0-4d1d-aa2f-475351b0f3c3", description: "1/2in drywall sheets, tape, and joint compound", qtyPerUnit: "1.0000", wasteFactor: "0.1000", sortOrder: 1, costType: "Materials", unit: "sf" },
  { assemblySupabaseId: "37fc74f9-c1f0-4d1d-aa2f-475351b0f3c3", description: "Drywall hanging labor - 2 crew x 3 days", qtyPerUnit: "0.1067", wasteFactor: "0.0000", sortOrder: 2, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "37fc74f9-c1f0-4d1d-aa2f-475351b0f3c3", description: "Drywall taping and finishing labor - 2 crew x 3 days", qtyPerUnit: "0.1067", wasteFactor: "0.0000", sortOrder: 3, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "37fc74f9-c1f0-4d1d-aa2f-475351b0f3c3", description: "Job site cleanup", qtyPerUnit: "0.0100", wasteFactor: "0.0000", sortOrder: 4, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "37fc74f9-c1f0-4d1d-aa2f-475351b0f3c3", description: "Waste Management", qtyPerUnit: "0.0020", wasteFactor: "0.0000", sortOrder: 6, costType: "Other", unit: "ton" },

  // Wood Privacy Fence 6ft (per LF) — 8 items
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "PT 4x4x8 fence posts - 1 per 8lf", qtyPerUnit: "0.1250", wasteFactor: "0.1000", sortOrder: 1, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "PT 2x4x8 fence rails - 3 per 8lf section", qtyPerUnit: "0.3750", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "PT 1x6x6 fence pickets - 2 per lf", qtyPerUnit: "2.0000", wasteFactor: "0.1000", sortOrder: 3, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "Concrete for post footings - 0.5 bag per post", qtyPerUnit: "0.0050", wasteFactor: "0.1000", sortOrder: 4, costType: "Materials", unit: "cy" },
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "Galvanized screws, brackets, post caps", qtyPerUnit: "0.2500", wasteFactor: "0.0500", sortOrder: 5, costType: "Materials", unit: "lb" },
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "Fence installation labor - 2 crew x 3 days", qtyPerUnit: "0.4800", wasteFactor: "0.0000", sortOrder: 6, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "Fence permit", qtyPerUnit: "0.0100", wasteFactor: "0.0000", sortOrder: 7, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "3d06548d-74b4-4bf5-a614-c4c5d90a0405", description: "Cleanup and debris removal", qtyPerUnit: "0.0100", wasteFactor: "0.0000", sortOrder: 8, costType: "Other", unit: "ls" },

  // Bathroom Remodel (Standard) — 11 items
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "Building Permit for bathroom remodel", qtyPerUnit: "0.0200", wasteFactor: "0.0000", sortOrder: 1, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "10-yard dumpster rental for debris", qtyPerUnit: "0.0200", wasteFactor: "0.0000", sortOrder: 2, costType: "Equipment / Rental", unit: "ea" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "Interior demolition of existing bathroom finishes and fixtures", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 3, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "1/2 in. water-resistant drywall for walls", qtyPerUnit: "0.1000", wasteFactor: "0.1000", sortOrder: 4, costType: "Materials", unit: "sht" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "Waterproofing membrane for shower area", qtyPerUnit: "0.0200", wasteFactor: "0.1000", sortOrder: 5, costType: "Materials", unit: "roll" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "Ceramic tile for floor and shower walls", qtyPerUnit: "2.5000", wasteFactor: "0.1000", sortOrder: 6, costType: "Materials", unit: "sf" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "36 in. single sink bathroom vanity", qtyPerUnit: "0.0200", wasteFactor: "0.0500", sortOrder: 7, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "Allowance for bathroom fixtures (toilet, shower head, faucet)", qtyPerUnit: "0.0200", wasteFactor: "0.0000", sortOrder: 8, costType: "Allowance", unit: "ls" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "Interior paint for walls and ceiling", qtyPerUnit: "0.0400", wasteFactor: "0.1000", sortOrder: 9, costType: "Materials", unit: "gal" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "General labor for demolition, framing, and installation - 2 crew x 10 days", qtyPerUnit: "3.2000", wasteFactor: "0.0000", sortOrder: 10, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "4a383f1f-e7a5-47f7-8fde-4e371489c7f9", description: "Final job site cleanup", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 11, costType: "Subcontractor", unit: "sf" },

  // LVP Flooring Installation — 5 items
  { assemblySupabaseId: "4c896373-d99b-431a-a56c-70ce2432a3a9", description: "Luxury Vinyl Plank flooring installation, including floor prep and labor", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 1, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "4c896373-d99b-431a-a56c-70ce2432a3a9", description: "Foam underlayment for LVP flooring", qtyPerUnit: "0.0100", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "sq" },
  { assemblySupabaseId: "4c896373-d99b-431a-a56c-70ce2432a3a9", description: "Installation of floor transitions and trim at doorways and room edges", qtyPerUnit: "0.1500", wasteFactor: "0.0000", sortOrder: 3, costType: "Subcontractor", unit: "lf" },
  { assemblySupabaseId: "4c896373-d99b-431a-a56c-70ce2432a3a9", description: "Site cleanup and debris removal related to flooring installation", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 4, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "4c896373-d99b-431a-a56c-70ce2432a3a9", description: "Permit filing fees for interior alteration", qtyPerUnit: "0.0020", wasteFactor: "0.0000", sortOrder: 5, costType: "Permits / Fees", unit: "ls" },

  // Concrete Patio 12x12 — 8 items
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "Excavation and site prep for patio - 6in depth", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 1, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "Compacted gravel base 4in - 1.78cy", qtyPerUnit: "0.0124", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "cy" },
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "2x4 form lumber for perimeter 48lf", qtyPerUnit: "0.3333", wasteFactor: "0.1000", sortOrder: 3, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "Form stakes, ties, rebar chairs", qtyPerUnit: "0.1000", wasteFactor: "0.0500", sortOrder: 4, costType: "Materials", unit: "lb" },
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "Concrete pour and finish - 4in slab with broom finish", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 5, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "Dumpster for excavation debris", qtyPerUnit: "0.0069", wasteFactor: "0.0000", sortOrder: 6, costType: "Equipment / Rental", unit: "ea" },
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "Building permit", qtyPerUnit: "0.0069", wasteFactor: "0.0000", sortOrder: 7, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "622011a9-5d4f-4814-a397-3e0c27874217", description: "Final cleanup", qtyPerUnit: "0.0069", wasteFactor: "0.0000", sortOrder: 8, costType: "Other", unit: "ls" },

  // Hardwood Floor Installation — 7 items
  { assemblySupabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", description: "3/4in solid oak hardwood flooring boards", qtyPerUnit: "1.0000", wasteFactor: "0.1000", sortOrder: 1, costType: "Materials", unit: "sf" },
  { assemblySupabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", description: "Standard foam underlayment", qtyPerUnit: "1.0000", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "sf" },
  { assemblySupabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", description: "Flooring adhesives and fasteners", qtyPerUnit: "0.0020", wasteFactor: "0.0500", sortOrder: 3, costType: "Materials", unit: "ls" },
  { assemblySupabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", description: "Hardwood transitions for doorways and openings", qtyPerUnit: "0.0400", wasteFactor: "0.1000", sortOrder: 4, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", description: "Hardwood flooring installation labor - 2 crew x 4 days", qtyPerUnit: "0.1280", wasteFactor: "0.0000", sortOrder: 5, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", description: "Building Permit for interior alterations", qtyPerUnit: "0.0020", wasteFactor: "0.0000", sortOrder: 6, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "6894e7be-8c21-42a3-8d54-f887c38e14f0", description: "Post-construction job site cleanup", qtyPerUnit: "0.0020", wasteFactor: "0.0000", sortOrder: 7, costType: "Other", unit: "ls" },

  // Electrical Panel Upgrade 200A — 6 items (estimated from typical BOM)
  { assemblySupabaseId: "775d4563-4973-4e84-b75f-508d045234e7", description: "200A main breaker panel with cover", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 1, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "775d4563-4973-4e84-b75f-508d045234e7", description: "Circuit breakers (20 spaces)", qtyPerUnit: "20.0000", wasteFactor: "0.0000", sortOrder: 2, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "775d4563-4973-4e84-b75f-508d045234e7", description: "Electrical wire, conduit, connectors", qtyPerUnit: "1.0000", wasteFactor: "0.1000", sortOrder: 3, costType: "Materials", unit: "ls" },
  { assemblySupabaseId: "775d4563-4973-4e84-b75f-508d045234e7", description: "Licensed electrician labor - panel upgrade", qtyPerUnit: "16.0000", wasteFactor: "0.0000", sortOrder: 4, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "775d4563-4973-4e84-b75f-508d045234e7", description: "Electrical permit and inspection", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 5, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "775d4563-4973-4e84-b75f-508d045234e7", description: "Job cleanup", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 6, costType: "Other", unit: "ls" },

  // Kitchen Remodel (Standard) — 12 items (estimated from typical BOM)
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Building permit for kitchen remodel", qtyPerUnit: "0.0067", wasteFactor: "0.0000", sortOrder: 1, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "10-yard dumpster rental", qtyPerUnit: "0.0067", wasteFactor: "0.0000", sortOrder: 2, costType: "Equipment / Rental", unit: "ea" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Interior demolition of existing kitchen finishes", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 3, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Stock kitchen cabinets (base + wall)", qtyPerUnit: "0.1333", wasteFactor: "0.0000", sortOrder: 4, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Countertop - laminate or solid surface", qtyPerUnit: "0.1333", wasteFactor: "0.0500", sortOrder: 5, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Ceramic tile backsplash", qtyPerUnit: "0.2000", wasteFactor: "0.1000", sortOrder: 6, costType: "Materials", unit: "sf" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Kitchen sink and faucet", qtyPerUnit: "0.0067", wasteFactor: "0.0000", sortOrder: 7, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Allowance for appliances", qtyPerUnit: "0.0067", wasteFactor: "0.0000", sortOrder: 8, costType: "Allowance", unit: "ls" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Interior paint for walls and ceiling", qtyPerUnit: "0.0200", wasteFactor: "0.1000", sortOrder: 9, costType: "Materials", unit: "gal" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "General labor - 2 crew x 14 days", qtyPerUnit: "1.4933", wasteFactor: "0.0000", sortOrder: 10, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Plumbing rough-in and finish", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 11, costType: "Subcontractor", unit: "ls" },
  { assemblySupabaseId: "a94561a1-8dac-417a-aae4-a00a3b15653e", description: "Final job site cleanup", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 12, costType: "Other", unit: "sf" },

  // Exterior Painting (Full House) — 8 items (estimated from typical BOM)
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Pressure washing and surface prep", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 1, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Exterior primer", qtyPerUnit: "0.0025", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "gal" },
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Exterior paint - 2 coats", qtyPerUnit: "0.0050", wasteFactor: "0.1000", sortOrder: 3, costType: "Materials", unit: "gal" },
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Caulk, tape, drop cloths, brushes", qtyPerUnit: "0.0005", wasteFactor: "0.0500", sortOrder: 4, costType: "Materials", unit: "ls" },
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Painting labor - 3 crew x 5 days", qtyPerUnit: "0.0600", wasteFactor: "0.0000", sortOrder: 5, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Scaffolding / lift rental", qtyPerUnit: "0.0005", wasteFactor: "0.0000", sortOrder: 6, costType: "Equipment / Rental", unit: "ea" },
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Permit if required", qtyPerUnit: "0.0005", wasteFactor: "0.0000", sortOrder: 7, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "a80ec02f-77f3-45ca-a6ee-ab5b2efa94b6", description: "Final cleanup", qtyPerUnit: "0.0005", wasteFactor: "0.0000", sortOrder: 8, costType: "Other", unit: "ls" },

  // Interior Painting (per Room) — 6 items (estimated from typical BOM)
  { assemblySupabaseId: "daf0c897-7722-49c6-835d-6a309bdf895c", description: "Interior primer for walls and ceiling", qtyPerUnit: "0.0025", wasteFactor: "0.1000", sortOrder: 1, costType: "Materials", unit: "gal" },
  { assemblySupabaseId: "daf0c897-7722-49c6-835d-6a309bdf895c", description: "Interior paint - 2 coats walls + ceiling", qtyPerUnit: "0.0050", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "gal" },
  { assemblySupabaseId: "daf0c897-7722-49c6-835d-6a309bdf895c", description: "Caulk, tape, drop cloths, brushes", qtyPerUnit: "0.0022", wasteFactor: "0.0500", sortOrder: 3, costType: "Materials", unit: "ls" },
  { assemblySupabaseId: "daf0c897-7722-49c6-835d-6a309bdf895c", description: "Painting labor - 2 crew x 2 days", qtyPerUnit: "0.0711", wasteFactor: "0.0000", sortOrder: 4, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "daf0c897-7722-49c6-835d-6a309bdf895c", description: "Trim painting labor", qtyPerUnit: "0.0178", wasteFactor: "0.0000", sortOrder: 5, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "daf0c897-7722-49c6-835d-6a309bdf895c", description: "Job cleanup", qtyPerUnit: "0.0022", wasteFactor: "0.0000", sortOrder: 6, costType: "Other", unit: "ls" },

  // Full Roof Replacement — 10 items (estimated from typical BOM)
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Tear-off existing roofing to deck", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 1, costType: "Subcontractor", unit: "sq" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Architectural shingles (30-year)", qtyPerUnit: "3.0000", wasteFactor: "0.1200", sortOrder: 2, costType: "Materials", unit: "bdl" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Synthetic underlayment", qtyPerUnit: "1.0000", wasteFactor: "0.1000", sortOrder: 3, costType: "Materials", unit: "sq" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Ice & water shield for eaves/valleys", qtyPerUnit: "0.3000", wasteFactor: "0.0500", sortOrder: 4, costType: "Materials", unit: "sq" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Ridge cap shingles", qtyPerUnit: "0.1000", wasteFactor: "0.1000", sortOrder: 5, costType: "Materials", unit: "bdl" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Drip edge, flashing, nails, sealant", qtyPerUnit: "1.0000", wasteFactor: "0.0500", sortOrder: 6, costType: "Materials", unit: "ls" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Roofing labor - 4 crew x 3 days", qtyPerUnit: "96.0000", wasteFactor: "0.0000", sortOrder: 7, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Dumpster for tear-off debris", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 8, costType: "Equipment / Rental", unit: "ea" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Roofing permit", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 9, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "9d2e2511-bb0c-4159-a167-faf03a2e4a22", description: "Final cleanup and inspection", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 10, costType: "Other", unit: "ls" },

  // Vinyl Siding Replacement — 8 items (estimated from typical BOM)
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "Removal of existing siding", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 1, costType: "Subcontractor", unit: "sf" },
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "Vinyl siding panels", qtyPerUnit: "1.0000", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "sf" },
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "House wrap / moisture barrier", qtyPerUnit: "1.0000", wasteFactor: "0.1000", sortOrder: 3, costType: "Materials", unit: "sf" },
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "J-channel, starter strip, corners, trim", qtyPerUnit: "0.1000", wasteFactor: "0.1000", sortOrder: 4, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "Nails, fasteners, flashing", qtyPerUnit: "0.0007", wasteFactor: "0.0500", sortOrder: 5, costType: "Materials", unit: "ls" },
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "Siding installation labor - 3 crew x 5 days", qtyPerUnit: "0.0800", wasteFactor: "0.0000", sortOrder: 6, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "Building permit", qtyPerUnit: "0.0007", wasteFactor: "0.0000", sortOrder: 7, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "c55106d6-9c8b-410c-a375-714af04d9cd6", description: "Cleanup and debris removal", qtyPerUnit: "0.0007", wasteFactor: "0.0000", sortOrder: 8, costType: "Other", unit: "ls" },

  // Standard Deck 10x12 (Wood) — 8 items (estimated from typical BOM)
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "PT 2x8 joists and beam lumber", qtyPerUnit: "0.5000", wasteFactor: "0.1000", sortOrder: 1, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "PT 5/4x6 decking boards", qtyPerUnit: "2.0000", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "Concrete footings (sonotubes + concrete)", qtyPerUnit: "0.0500", wasteFactor: "0.1000", sortOrder: 3, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "Post bases, joist hangers, lag bolts, screws", qtyPerUnit: "0.2500", wasteFactor: "0.0500", sortOrder: 4, costType: "Materials", unit: "lb" },
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "Deck building labor - 2 crew x 5 days", qtyPerUnit: "0.6667", wasteFactor: "0.0000", sortOrder: 5, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "Deck stain / sealer", qtyPerUnit: "0.0083", wasteFactor: "0.1000", sortOrder: 6, costType: "Materials", unit: "gal" },
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "Building permit for deck", qtyPerUnit: "0.0083", wasteFactor: "0.0000", sortOrder: 7, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "c6c6fef2-63cc-414e-b565-d07653670fe7", description: "Final cleanup", qtyPerUnit: "0.0083", wasteFactor: "0.0000", sortOrder: 8, costType: "Other", unit: "ls" },

  // Window Replacement (per Window) — 6 items (estimated from typical BOM)
  { assemblySupabaseId: "72d443d8-03d4-47c7-9713-a101fc3d0c16", description: "Double-hung vinyl window (standard size)", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 1, costType: "Materials", unit: "ea" },
  { assemblySupabaseId: "72d443d8-03d4-47c7-9713-a101fc3d0c16", description: "Interior/exterior trim and casing", qtyPerUnit: "16.0000", wasteFactor: "0.1000", sortOrder: 2, costType: "Materials", unit: "lf" },
  { assemblySupabaseId: "72d443d8-03d4-47c7-9713-a101fc3d0c16", description: "Flashing, sealant, insulation foam", qtyPerUnit: "1.0000", wasteFactor: "0.0500", sortOrder: 3, costType: "Materials", unit: "ls" },
  { assemblySupabaseId: "72d443d8-03d4-47c7-9713-a101fc3d0c16", description: "Window installation labor", qtyPerUnit: "3.0000", wasteFactor: "0.0000", sortOrder: 4, costType: "Labor", unit: "hr" },
  { assemblySupabaseId: "72d443d8-03d4-47c7-9713-a101fc3d0c16", description: "Permit if required", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 5, costType: "Permits / Fees", unit: "ea" },
  { assemblySupabaseId: "72d443d8-03d4-47c7-9713-a101fc3d0c16", description: "Cleanup and debris removal", qtyPerUnit: "1.0000", wasteFactor: "0.0000", sortOrder: 6, costType: "Other", unit: "ls" },
];

async function main() {
  const url = new URL(DATABASE_URL.replace(/^mysql:\/\//, "mysql://"));
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port || "3306"),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: true },
  });

  try {
    console.log("🔧 Starting Supabase → MySQL assembly migration...\n");

    // ── Step 1: Insert assemblies ──────────────────────────────────
    const assemblyIdMap = new Map(); // supabaseId → MySQL id

    for (const a of ASSEMBLIES) {
      const code = makeCode(a.name, a.category);
      const [result] = await conn.execute(
        `INSERT INTO assemblies (supabaseId, name, code, trade, category, description, defaultUnit, unit_of_measure, directCost, sellPrice, crewHours, itemCount, grossProfitPct, is_preset, version, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, false, 1, true)`,
        [a.supabaseId, a.name, code, a.category, a.category, a.description, a.defaultUnit.toUpperCase(), a.defaultUnit]
      );
      assemblyIdMap.set(a.supabaseId, result.insertId);
      console.log(`  ✅ Assembly: ${a.name} (id=${result.insertId})`);
    }

    console.log(`\n📦 ${assemblyIdMap.size} assemblies inserted.\n`);

    // ── Step 2: Insert assembly_components ──────────────────────────
    let componentCount = 0;
    for (const item of ASSEMBLY_ITEMS) {
      const assemblyId = assemblyIdMap.get(item.assemblySupabaseId);
      if (!assemblyId) {
        console.warn(`  ⚠️ Skipping item "${item.description}" — assembly not found`);
        continue;
      }

      // Build description with cost type prefix for clarity
      const desc = `[${item.costType}] ${item.description} (${item.unit})`;

      await conn.execute(
        `INSERT INTO assembly_components (assembly_id, description, quantity, waste_factor_pct, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [assemblyId, desc, item.qtyPerUnit, item.wasteFactor, item.sortOrder]
      );
      componentCount++;
    }

    console.log(`📦 ${componentCount} assembly_components inserted.\n`);

    // ── Step 3: Update item counts on assemblies ───────────────────
    for (const [supabaseId, mysqlId] of assemblyIdMap) {
      const [rows] = await conn.execute(
        `SELECT COUNT(*) as cnt FROM assembly_components WHERE assembly_id = ?`,
        [mysqlId]
      );
      await conn.execute(
        `UPDATE assemblies SET itemCount = ? WHERE id = ?`,
        [rows[0].cnt, mysqlId]
      );
    }

    console.log("✅ Assembly item counts updated.\n");

    // ── Verification ───────────────────────────────────────────────
    const [assemblyRows] = await conn.execute(`SELECT COUNT(*) as cnt FROM assemblies WHERE supabaseId IS NOT NULL`);
    const [componentRows] = await conn.execute(`SELECT COUNT(*) as cnt FROM assembly_components`);
    console.log(`📊 Verification:`);
    console.log(`   Assemblies with supabaseId: ${assemblyRows[0].cnt}`);
    console.log(`   Assembly components: ${componentRows[0].cnt}`);
    console.log(`\n🎉 Migration complete!`);

  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
