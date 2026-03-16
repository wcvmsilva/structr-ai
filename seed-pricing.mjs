/**
 * seed-pricing.mjs — Populate Pricing Architecture reference tables
 * Sprint 6 — GCHI Command Center v9
 *
 * Tables seeded:
 *   1. regional_modifiers   (Charleston Metro + surrounding regions)
 *   2. channel_multipliers  (direct / insurance / commercial × trade)
 *   3. finish_levels        (standard / premium / luxury × trade)
 *   4. parametric_models    (ADU, one-story, two-story, shell)
 *   5. remodel_templates    (kitchen, bath, roof, siding, etc.)
 *   6. newcon_templates     (ADU, one-story, two-story)
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

console.log("=== GCHI Pricing Architecture Seed ===\n");

// ─── 1. REGIONAL MODIFIERS ──────────────────────────────────────────
const regions = [
  { code: "charleston_metro",     name: "Charleston Metro (Downtown, Mt Pleasant, W Ashley)", cost: "1.0000", labor: "1.0000", material: "1.0000", permit: "1.0000", desc: "Baseline region — all modifiers at 1.0" },
  { code: "charleston_peninsula", name: "Charleston Peninsula (Historic District, SOB)",       cost: "1.1200", labor: "1.0800", material: "1.0500", permit: "1.2500", desc: "Historic district premium — BAR review, restricted access, specialty materials" },
  { code: "james_island",         name: "James Island",                                        cost: "0.9800", labor: "0.9800", material: "1.0000", permit: "1.0000", desc: "Slightly below metro baseline" },
  { code: "johns_island",         name: "Johns Island",                                        cost: "0.9500", labor: "0.9500", material: "1.0200", permit: "0.9500", desc: "Rural-adjacent, lower labor costs, slightly higher material delivery" },
  { code: "daniel_island",        name: "Daniel Island",                                       cost: "1.0800", labor: "1.0500", material: "1.0300", permit: "1.1000", desc: "Upscale planned community, HOA requirements" },
  { code: "summerville",          name: "Summerville / Dorchester County",                     cost: "0.9200", labor: "0.9000", material: "0.9800", permit: "0.8500", desc: "Lower cost area, reduced permit fees" },
  { code: "north_charleston",     name: "North Charleston",                                    cost: "0.9000", labor: "0.8800", material: "0.9800", permit: "0.9000", desc: "Lowest cost metro area" },
  { code: "isle_of_palms",        name: "Isle of Palms / Sullivan's Island",                   cost: "1.1500", labor: "1.1000", material: "1.0800", permit: "1.3000", desc: "Barrier island premium — coastal building codes, flood zone, limited access" },
  { code: "kiawah_seabrook",      name: "Kiawah Island / Seabrook Island",                     cost: "1.2000", labor: "1.1500", material: "1.1000", permit: "1.3500", desc: "Resort island premium — ARB review, gated access, premium expectations" },
  { code: "goose_creek",          name: "Goose Creek / Hanahan",                               cost: "0.9300", labor: "0.9000", material: "0.9800", permit: "0.9000", desc: "Suburban, moderate costs" },
];

for (const r of regions) {
  await conn.execute(
    `INSERT INTO regional_modifiers (region_code, region_name, cost_modifier, labor_modifier, material_modifier, permit_modifier, description, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE region_name=VALUES(region_name), cost_modifier=VALUES(cost_modifier), labor_modifier=VALUES(labor_modifier), material_modifier=VALUES(material_modifier), permit_modifier=VALUES(permit_modifier), description=VALUES(description)`,
    [r.code, r.name, r.cost, r.labor, r.material, r.permit, r.desc]
  );
}
console.log(`✅ regional_modifiers: ${regions.length} regions seeded`);

// ─── 2. CHANNEL MULTIPLIERS ─────────────────────────────────────────
const channels = [
  // Direct (baseline)
  { channel: "direct",     trade: null,         costMul: "1.0000", priceMul: "1.0000", desc: "Direct residential — baseline pricing" },
  // Insurance — O&P markup
  { channel: "insurance",  trade: null,         costMul: "1.0000", priceMul: "1.2000", desc: "Insurance channel — 20% O&P standard markup" },
  { channel: "insurance",  trade: "Roofing",    costMul: "1.0000", priceMul: "1.2500", desc: "Insurance roofing — 25% O&P (storm damage standard)" },
  { channel: "insurance",  trade: "Siding",     costMul: "1.0000", priceMul: "1.2500", desc: "Insurance siding — 25% O&P (storm damage standard)" },
  { channel: "insurance",  trade: "Plumbing",   costMul: "1.0000", priceMul: "1.2000", desc: "Insurance plumbing — 20% O&P" },
  { channel: "insurance",  trade: "Electrical", costMul: "1.0000", priceMul: "1.2000", desc: "Insurance electrical — 20% O&P" },
  // Commercial — volume discount on cost, higher margin on price
  { channel: "commercial", trade: null,         costMul: "0.9500", priceMul: "1.1500", desc: "Commercial channel — 5% cost reduction, 15% price premium" },
  { channel: "commercial", trade: "Electrical", costMul: "0.9200", priceMul: "1.1800", desc: "Commercial electrical — volume discount, higher complexity" },
  { channel: "commercial", trade: "HVAC",       costMul: "0.9300", priceMul: "1.2000", desc: "Commercial HVAC — volume discount, commercial-grade equipment" },
];

for (const c of channels) {
  await conn.execute(
    `INSERT INTO channel_multipliers (channel, trade, cost_multiplier, price_multiplier, description, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [c.channel, c.trade, c.costMul, c.priceMul, c.desc]
  );
}
console.log(`✅ channel_multipliers: ${channels.length} entries seeded`);

// ─── 3. FINISH LEVELS ───────────────────────────────────────────────
const finishes = [
  // Standard (baseline)
  { level: "standard", trade: null,         mul: "1.0000", desc: "Standard finish — builder-grade materials and fixtures" },
  // Premium
  { level: "premium",  trade: null,         mul: "1.3500", desc: "Premium finish — upgraded materials, mid-range fixtures" },
  { level: "premium",  trade: "Plumbing",   mul: "1.4000", desc: "Premium plumbing — Kohler/Delta mid-range fixtures" },
  { level: "premium",  trade: "Electrical", mul: "1.2500", desc: "Premium electrical — Lutron dimmers, USB outlets" },
  { level: "premium",  trade: "Flooring",   mul: "1.4500", desc: "Premium flooring — engineered hardwood, porcelain tile" },
  { level: "premium",  trade: "Cabinets",   mul: "1.5000", desc: "Premium cabinets — soft-close, dovetail, plywood box" },
  // Luxury
  { level: "luxury",   trade: null,         mul: "1.8500", desc: "Luxury finish — designer-grade, custom specifications" },
  { level: "luxury",   trade: "Plumbing",   mul: "2.0000", desc: "Luxury plumbing — Waterworks, Brizo, custom shower systems" },
  { level: "luxury",   trade: "Electrical", mul: "1.6000", desc: "Luxury electrical — Lutron HomeWorks, integrated AV" },
  { level: "luxury",   trade: "Flooring",   mul: "2.2000", desc: "Luxury flooring — wide-plank hardwood, natural stone" },
  { level: "luxury",   trade: "Cabinets",   mul: "2.5000", desc: "Luxury cabinets — custom inset, furniture-grade finish" },
  { level: "luxury",   trade: "Countertops",mul: "2.3000", desc: "Luxury countertops — quartzite, marble, waterfall edge" },
];

for (const f of finishes) {
  await conn.execute(
    `INSERT INTO finish_levels (level, trade, price_multiplier, description, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [f.level, f.trade, f.mul, f.desc]
  );
}
console.log(`✅ finish_levels: ${finishes.length} entries seeded`);

// ─── 4. PARAMETRIC MODELS ───────────────────────────────────────────
const parametric = [
  {
    name: "ADU — Accessory Dwelling Unit",
    type: "adu",
    costSqft: "185.0000",
    priceSqft: "285.0000",
    minSqft: 400,
    maxSqft: 1200,
    complexity: "1.0000",
    systems: JSON.stringify(["foundation_slab", "framing_wood", "roofing_asphalt", "siding_hardie", "mep_basic", "interior_standard"]),
    options: JSON.stringify({ porch: false, garage: false, loft: false }),
    desc: "Detached ADU / DADU — Charleston zoning compliant, 400-1200 SF"
  },
  {
    name: "One-Story Residential",
    type: "one_story",
    costSqft: "165.0000",
    priceSqft: "255.0000",
    minSqft: 800,
    maxSqft: 3000,
    complexity: "1.0000",
    systems: JSON.stringify(["foundation_slab", "framing_wood", "roofing_asphalt", "siding_hardie", "mep_standard", "interior_standard"]),
    options: JSON.stringify({ porch: true, garage: true, screened_porch: false }),
    desc: "Single-story residential — slab on grade, standard roof pitch"
  },
  {
    name: "Two-Story Residential",
    type: "two_story",
    costSqft: "155.0000",
    priceSqft: "240.0000",
    minSqft: 1500,
    maxSqft: 5000,
    complexity: "1.1500",
    systems: JSON.stringify(["foundation_slab", "framing_wood", "roofing_asphalt", "siding_hardie", "mep_standard", "interior_standard", "stairs"]),
    options: JSON.stringify({ porch: true, garage: true, screened_porch: true, bonus_room: false }),
    desc: "Two-story residential — economy of scale on footprint, added stair/structural complexity"
  },
  {
    name: "Two-Story with Terrace",
    type: "two_story_terrace",
    costSqft: "175.0000",
    priceSqft: "270.0000",
    minSqft: 1800,
    maxSqft: 5000,
    complexity: "1.2500",
    systems: JSON.stringify(["foundation_elevated", "framing_wood", "roofing_metal", "siding_hardie", "mep_standard", "interior_premium", "stairs", "terrace"]),
    options: JSON.stringify({ porch: true, garage: true, rooftop_deck: true, elevator: false }),
    desc: "Two-story with terrace/rooftop — Charleston-style elevated, flood zone compliant"
  },
  {
    name: "Shell Only (Dry-In)",
    type: "shell",
    costSqft: "95.0000",
    priceSqft: "145.0000",
    minSqft: 600,
    maxSqft: 5000,
    complexity: "0.8000",
    systems: JSON.stringify(["foundation_slab", "framing_wood", "roofing_asphalt", "siding_hardie"]),
    options: JSON.stringify({ windows: true, exterior_doors: true }),
    desc: "Shell/dry-in only — foundation, framing, roof, siding, windows, exterior doors. No MEP or interior."
  },
];

for (const p of parametric) {
  await conn.execute(
    `INSERT INTO parametric_models (name, structure_type, base_cost_per_sqft, base_price_per_sqft, min_sqft, max_sqft, complexity_multiplier, default_systems, default_options, description, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [p.name, p.type, p.costSqft, p.priceSqft, p.minSqft, p.maxSqft, p.complexity, p.systems, p.options, p.desc]
  );
}
console.log(`✅ parametric_models: ${parametric.length} models seeded`);

// ─── 5. REMODEL TEMPLATES ───────────────────────────────────────────
const remodels = [
  {
    name: "Kitchen Remodel — Standard",
    type: "kitchen_remodel",
    desc: "Full kitchen remodel: demo, cabinets, countertops, plumbing, electrical, flooring, paint, appliance hookup",
    assemblies: JSON.stringify(["DEMO-KIT", "CAB-STD", "CNTR-STD", "PLMB-KIT", "ELEC-KIT", "FLR-KIT", "PAINT-KIT"]),
    options: JSON.stringify({ island: false, backsplash: true, under_cabinet_lighting: true }),
    sqftRange: JSON.stringify({ min: 80, max: 300 }),
    duration: "4-6 weeks"
  },
  {
    name: "Bathroom Remodel — Standard",
    type: "bathroom_remodel",
    desc: "Full bathroom remodel: demo, tile, plumbing fixtures, vanity, electrical, paint, accessories",
    assemblies: JSON.stringify(["DEMO-BATH", "TILE-BATH", "PLMB-BATH", "VAN-STD", "ELEC-BATH", "PAINT-BATH"]),
    options: JSON.stringify({ walk_in_shower: false, freestanding_tub: false, heated_floor: false }),
    sqftRange: JSON.stringify({ min: 35, max: 120 }),
    duration: "2-4 weeks"
  },
  {
    name: "Roof Replacement — Asphalt Shingle",
    type: "roof_replacement",
    desc: "Full roof tear-off and replacement: demo, underlayment, shingles, flashing, ridge vent, cleanup",
    assemblies: JSON.stringify(["DEMO-ROOF", "UNDER-30", "SHGL-ARCH", "FLASH-STD", "VENT-RIDGE"]),
    options: JSON.stringify({ ice_shield: true, drip_edge: true, gutter_replacement: false }),
    sqftRange: JSON.stringify({ min: 1000, max: 4000 }),
    duration: "3-5 days"
  },
  {
    name: "Siding Replacement — HardiePlank",
    type: "siding_replacement",
    desc: "Full siding replacement: demo, housewrap, HardiePlank, trim, caulk, paint",
    assemblies: JSON.stringify(["DEMO-SIDE", "WRAP-TYVEK", "SIDE-HARDIE", "TRIM-HARDIE", "PAINT-EXT"]),
    options: JSON.stringify({ board_and_batten: false, shake_accent: false }),
    sqftRange: JSON.stringify({ min: 800, max: 3500 }),
    duration: "1-3 weeks"
  },
  {
    name: "Window Replacement — Vinyl Double-Hung",
    type: "window_replacement",
    desc: "Window replacement: remove existing, install new vinyl windows, trim, caulk, paint touch-up",
    assemblies: JSON.stringify(["WIN-VINYL-DH", "TRIM-WIN", "CAULK-WIN"]),
    options: JSON.stringify({ low_e: true, argon_fill: true, grids: false }),
    sqftRange: JSON.stringify({ min: 0, max: 0 }),
    duration: "1-3 days per 10 windows"
  },
  {
    name: "Deck Build — Pressure Treated",
    type: "deck_build",
    desc: "New deck construction: footings, framing, decking, railing, stairs, permit",
    assemblies: JSON.stringify(["FOOT-DECK", "FRAME-DECK", "DECK-PT", "RAIL-WOOD", "STAIR-DECK"]),
    options: JSON.stringify({ composite_decking: false, cable_railing: false, built_in_seating: false }),
    sqftRange: JSON.stringify({ min: 100, max: 600 }),
    duration: "1-2 weeks"
  },
  {
    name: "Exterior Paint — Full House",
    type: "exterior_paint",
    desc: "Full exterior paint: pressure wash, scrape/sand, prime, 2 coats, trim, shutters",
    assemblies: JSON.stringify(["PREP-EXT", "PRIME-EXT", "PAINT-EXT-2CT", "TRIM-PAINT"]),
    options: JSON.stringify({ shutters: true, front_door: true, deck_stain: false }),
    sqftRange: JSON.stringify({ min: 1000, max: 4000 }),
    duration: "1-2 weeks"
  },
  {
    name: "Interior Paint — Full House",
    type: "interior_paint",
    desc: "Full interior paint: prep, prime where needed, 2 coats walls, 1 coat ceilings, trim",
    assemblies: JSON.stringify(["PREP-INT", "PAINT-WALL-2CT", "PAINT-CEIL", "PAINT-TRIM"]),
    options: JSON.stringify({ accent_walls: false, cabinet_paint: false, wallpaper_removal: false }),
    sqftRange: JSON.stringify({ min: 800, max: 4000 }),
    duration: "3-7 days"
  },
  {
    name: "Flooring — LVP Full House",
    type: "flooring",
    desc: "Full house flooring: remove existing, prep subfloor, install LVP, transitions, baseboards",
    assemblies: JSON.stringify(["DEMO-FLR", "PREP-SUB", "FLR-LVP", "TRANS-FLR", "BASE-FLR"]),
    options: JSON.stringify({ moisture_barrier: true, quarter_round: true, stair_treads: false }),
    sqftRange: JSON.stringify({ min: 500, max: 3500 }),
    duration: "3-7 days"
  },
];

for (const r of remodels) {
  await conn.execute(
    `INSERT INTO remodel_templates (name, service_type, description, default_assemblies, default_options, typical_sqft_range, estimated_duration, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [r.name, r.type, r.desc, r.assemblies, r.options, r.sqftRange, r.duration]
  );
}
console.log(`✅ remodel_templates: ${remodels.length} templates seeded`);

// ─── 6. NEW CONSTRUCTION TEMPLATES ──────────────────────────────────
// Get parametric model IDs
const [pmRows] = await conn.query("SELECT id, structure_type FROM parametric_models");
const pmMap = {};
for (const r of pmRows) pmMap[r.structure_type] = r.id;

const newcons = [
  {
    name: "ADU — Standard Package",
    type: "adu",
    desc: "Complete ADU build — foundation through finish, all trades included",
    pmId: pmMap["adu"],
    params: JSON.stringify({ sqft: 600, bedrooms: 1, bathrooms: 1, finish_level: "standard" }),
    systems: JSON.stringify(["foundation_slab", "framing_wood", "roofing_asphalt", "siding_hardie", "mep_basic", "interior_standard"]),
    options: JSON.stringify({ porch: false, washer_dryer: true, mini_split: true }),
    mep: JSON.stringify({ electrical: "100A panel", plumbing: "PEX", hvac: "mini-split" }),
  },
  {
    name: "One-Story — Standard Package",
    type: "one_story",
    desc: "Complete one-story residential build — all trades, standard finish",
    pmId: pmMap["one_story"],
    params: JSON.stringify({ sqft: 1600, bedrooms: 3, bathrooms: 2, finish_level: "standard" }),
    systems: JSON.stringify(["foundation_slab", "framing_wood", "roofing_asphalt", "siding_hardie", "mep_standard", "interior_standard"]),
    options: JSON.stringify({ porch: true, garage: true, screened_porch: false }),
    mep: JSON.stringify({ electrical: "200A panel", plumbing: "PEX", hvac: "central_split" }),
  },
  {
    name: "Two-Story — Standard Package",
    type: "two_story",
    desc: "Complete two-story residential build — all trades, standard finish",
    pmId: pmMap["two_story"],
    params: JSON.stringify({ sqft: 2400, bedrooms: 4, bathrooms: 2.5, finish_level: "standard" }),
    systems: JSON.stringify(["foundation_slab", "framing_wood", "roofing_asphalt", "siding_hardie", "mep_standard", "interior_standard", "stairs"]),
    options: JSON.stringify({ porch: true, garage: true, screened_porch: false, bonus_room: false }),
    mep: JSON.stringify({ electrical: "200A panel", plumbing: "PEX", hvac: "central_split_zoned" }),
  },
];

for (const n of newcons) {
  await conn.execute(
    `INSERT INTO newcon_templates (name, structure_type, description, parametric_model_id, default_parameters, default_systems, default_options, mep_packages, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [n.name, n.type, n.desc, n.pmId, n.params, n.systems, n.options, n.mep]
  );
}
console.log(`✅ newcon_templates: ${newcons.length} templates seeded`);

// ─── VERIFICATION ───────────────────────────────────────────────────
console.log("\n=== Verification ===");
const tables = ["regional_modifiers", "channel_multipliers", "finish_levels", "parametric_models", "remodel_templates", "newcon_templates"];
for (const t of tables) {
  const [rows] = await conn.query(`SELECT COUNT(*) as cnt FROM ${t}`);
  console.log(`  ${t}: ${rows[0].cnt} rows`);
}

await conn.end();
console.log("\n✅ Pricing Architecture seed complete!");
