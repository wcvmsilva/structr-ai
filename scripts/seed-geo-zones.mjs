/**
 * Sprint 11 — Seed Charleston Geo Zones + Coastal Price Book Items
 * Run: cd gchi-bundle-builder-web && node scripts/seed-geo-zones.mjs
 */
import mysql from "mysql2/promise";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const conn = await mysql.createConnection(DATABASE_URL);

// ═══════════════════════════════════════════════════════════════
// SEED 5 CHARLESTON ZONES
// ═══════════════════════════════════════════════════════════════

const ZONES = [
  {
    zone_name: "Barrier Island Premium",
    county: "Charleston",
    zip_codes: JSON.stringify(["29455", "29439", "29482", "29451", "29438"]),
    center_lat: 32.6083,
    center_lng: -79.9581,
    radius_miles: 12,
    coastal_exposure_level: "extreme",
    logistics_complexity: "extreme",
    labor_modifier: 1.25,
    logistics_modifier: 1.40,
    material_modifier: 1.30,
    contingency_pct: 5.0,
    min_profit_shield_pct: 50.0,
    description: "Barrier Island Premium — Charleston County. Coastal: extreme, Logistics: extreme. Includes Kiawah, Seabrook, Folly Beach, Isle of Palms, Sullivan's Island.",
    is_active: true,
  },
  {
    zone_name: "Charleston Coastal",
    county: "Charleston",
    zip_codes: JSON.stringify(["29412", "29422", "29492", "29464", "29403"]),
    center_lat: 32.7546,
    center_lng: -79.9748,
    radius_miles: 15,
    coastal_exposure_level: "high",
    logistics_complexity: "complex",
    labor_modifier: 1.15,
    logistics_modifier: 1.20,
    material_modifier: 1.15,
    contingency_pct: 3.0,
    min_profit_shield_pct: 42.0,
    description: "Charleston Coastal — Charleston County. Coastal: high, Logistics: complex. Includes James Island, Mt. Pleasant, West Ashley coastal areas.",
    is_active: true,
  },
  {
    zone_name: "Charleston Metro",
    county: "Charleston",
    zip_codes: JSON.stringify(["29407", "29414", "29418", "29405", "29406", "29409", "29401", "29403", "29464", "29466"]),
    center_lat: 32.7765,
    center_lng: -79.9311,
    radius_miles: 20,
    coastal_exposure_level: "moderate",
    logistics_complexity: "standard",
    labor_modifier: 1.05,
    logistics_modifier: 1.00,
    material_modifier: 1.05,
    contingency_pct: 0.0,
    min_profit_shield_pct: 35.0,
    description: "Charleston Metro — Charleston County. Coastal: moderate, Logistics: standard. Default zone for Charleston area projects.",
    is_active: true,
  },
  {
    zone_name: "Summerville / Goose Creek",
    county: "Berkeley / Dorchester",
    zip_codes: JSON.stringify(["29483", "29485", "29486", "29445", "29456", "29461", "29470", "29472"]),
    center_lat: 33.0185,
    center_lng: -80.1756,
    radius_miles: 18,
    coastal_exposure_level: "none",
    logistics_complexity: "standard",
    labor_modifier: 1.00,
    logistics_modifier: 0.95,
    material_modifier: 1.00,
    contingency_pct: 0.0,
    min_profit_shield_pct: 32.0,
    description: "Summerville / Goose Creek — Berkeley/Dorchester County. Coastal: none, Logistics: standard. Inland suburban zone.",
    is_active: true,
  },
  {
    zone_name: "Outer Lowcountry",
    county: "Colleton / Dorchester",
    zip_codes: JSON.stringify(["29488", "29474", "29477", "29479", "29481", "29440", "29426", "29431"]),
    center_lat: 32.8954,
    center_lng: -80.3421,
    radius_miles: 30,
    coastal_exposure_level: "low",
    logistics_complexity: "moderate",
    labor_modifier: 1.05,
    logistics_modifier: 1.05,
    material_modifier: 1.00,
    contingency_pct: 2.0,
    min_profit_shield_pct: 35.0,
    description: "Outer Lowcountry — Colleton/Dorchester County. Coastal: low, Logistics: moderate. Rural and semi-rural areas.",
    is_active: true,
  },
];

console.log("Seeding 5 Charleston geo zones...");
let zonesCreated = 0;

for (const zone of ZONES) {
  // Check if zone already exists
  const [existing] = await conn.execute(
    "SELECT id FROM geo_zones WHERE zone_name = ?",
    [zone.zone_name]
  );
  if (existing.length > 0) {
    console.log(`  ⏭  Zone "${zone.zone_name}" already exists, skipping.`);
    continue;
  }

  await conn.execute(
    `INSERT INTO geo_zones (zone_name, county, zip_codes, center_lat, center_lng, radius_miles,
     coastal_exposure_level, logistics_complexity, labor_modifier, logistics_modifier,
     material_modifier, contingency_pct, min_profit_shield_pct, description, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      zone.zone_name, zone.county, zone.zip_codes, zone.center_lat, zone.center_lng,
      zone.radius_miles, zone.coastal_exposure_level, zone.logistics_complexity,
      zone.labor_modifier, zone.logistics_modifier, zone.material_modifier,
      zone.contingency_pct, zone.min_profit_shield_pct, zone.description, zone.is_active,
    ]
  );
  console.log(`  ✅ Created zone: ${zone.zone_name}`);
  zonesCreated++;
}

// ═══════════════════════════════════════════════════════════════
// SEED COASTAL PRICE BOOK ITEMS (12 items)
// ═══════════════════════════════════════════════════════════════

console.log("\nSeeding coastal-grade Price Book items...");

const COASTAL_ITEMS = [
  // Exterior Envelope — Coastal-grade materials
  {
    sku: "EXT-SIDING-HARDI-CST",
    cost_code: "07-400",
    cost_type: "material",
    category: "Exterior Envelope",
    subcategory: "Coastal Siding",
    name: "HardiePlank Coastal Siding (per sq ft)",
    description: "Fiber cement siding rated for coastal exposure. Salt-air resistant, 30-year warranty.",
    unit_of_measure: "sqft",
    unit_cost: 4.85,
    unit_price: 8.50,
    item_type: "material",
    trade: "Siding",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.12,
    coastal_modifier: 1.15,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  {
    sku: "EXT-WINDOW-IMPACT-CST",
    cost_code: "08-500",
    cost_type: "material",
    category: "Doors & Windows",
    subcategory: "Impact Windows",
    name: "Impact-Rated Window (per unit)",
    description: "Hurricane impact-rated window, DP50+ rating. Required for coastal barrier island construction.",
    unit_of_measure: "unit",
    unit_cost: 485.00,
    unit_price: 850.00,
    item_type: "material",
    trade: "Windows",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.02,
    coastal_modifier: 1.20,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  {
    sku: "EXT-DOOR-IMPACT-CST",
    cost_code: "08-100",
    cost_type: "material",
    category: "Doors & Windows",
    subcategory: "Impact Doors",
    name: "Impact-Rated Entry Door (per unit)",
    description: "Hurricane impact-rated entry door with reinforced frame. Coastal-grade hardware.",
    unit_of_measure: "unit",
    unit_cost: 1250.00,
    unit_price: 2200.00,
    item_type: "material",
    trade: "Doors",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.00,
    coastal_modifier: 1.15,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  {
    sku: "EXT-FLASH-COASTAL-CST",
    cost_code: "07-600",
    cost_type: "material",
    category: "Exterior Envelope",
    subcategory: "Coastal Flashing",
    name: "Stainless Steel Flashing (per lf)",
    description: "316 stainless steel flashing for coastal applications. Prevents galvanic corrosion.",
    unit_of_measure: "lf",
    unit_cost: 8.50,
    unit_price: 15.00,
    item_type: "material",
    trade: "Flashing",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.10,
    coastal_modifier: 1.10,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  // Roofing — Coastal-grade
  {
    sku: "ROOF-SHINGLE-WIND-CST",
    cost_code: "07-300",
    cost_type: "material",
    category: "Roofing",
    subcategory: "Coastal Roofing",
    name: "Wind-Rated Architectural Shingle (per sq)",
    description: "130 MPH wind-rated architectural shingle. Class H nail pattern for coastal zones.",
    unit_of_measure: "sq",
    unit_cost: 125.00,
    unit_price: 220.00,
    item_type: "material",
    trade: "Roofing",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.15,
    coastal_modifier: 1.15,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  {
    sku: "ROOF-UNDERLAYMENT-CST",
    cost_code: "07-310",
    cost_type: "material",
    category: "Roofing",
    subcategory: "Coastal Roofing",
    name: "Self-Adhering Underlayment (per sq)",
    description: "Ice & water shield underlayment, full-deck application for coastal wind zones.",
    unit_of_measure: "sq",
    unit_cost: 65.00,
    unit_price: 115.00,
    item_type: "material",
    trade: "Roofing",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.10,
    coastal_modifier: 1.10,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  // Foundation — Coastal-grade
  {
    sku: "FND-PILE-COASTAL-CST",
    cost_code: "02-300",
    cost_type: "material",
    category: "Foundation & Concrete",
    subcategory: "Coastal Foundation",
    name: "Treated Timber Pile (per lf)",
    description: "CCA-treated timber pile for elevated coastal foundation. 40-year ground contact rating.",
    unit_of_measure: "lf",
    unit_cost: 18.50,
    unit_price: 32.00,
    item_type: "material",
    trade: "Foundation",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.05,
    coastal_modifier: 1.25,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  {
    sku: "FND-CONCRETE-5000-CST",
    cost_code: "03-100",
    cost_type: "material",
    category: "Foundation & Concrete",
    subcategory: "Coastal Concrete",
    name: "5000 PSI Coastal Concrete Mix (per cy)",
    description: "High-strength concrete with corrosion inhibitor for coastal exposure. ACI 318 compliant.",
    unit_of_measure: "cy",
    unit_cost: 185.00,
    unit_price: 325.00,
    item_type: "material",
    trade: "Concrete",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.08,
    coastal_modifier: 1.15,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  // Framing — Coastal-grade
  {
    sku: "FRM-HARDWARE-SS-CST",
    cost_code: "06-100",
    cost_type: "material",
    category: "Framing & Structural",
    subcategory: "Coastal Hardware",
    name: "Stainless Steel Simpson Connector Kit (per unit)",
    description: "316 SS hurricane tie-down kit. Includes straps, clips, and bolts for coastal wind zones.",
    unit_of_measure: "unit",
    unit_cost: 12.50,
    unit_price: 22.00,
    item_type: "material",
    trade: "Framing",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.05,
    coastal_modifier: 1.10,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  // Electrical — Coastal-grade
  {
    sku: "ELEC-PANEL-COASTAL-CST",
    cost_code: "16-100",
    cost_type: "material",
    category: "Electrical",
    subcategory: "Coastal Electrical",
    name: "NEMA 4X Coastal Electrical Panel (per unit)",
    description: "Stainless steel NEMA 4X rated panel for coastal salt-air environments. 200A main.",
    unit_of_measure: "unit",
    unit_cost: 850.00,
    unit_price: 1500.00,
    item_type: "material",
    trade: "Electrical",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.00,
    coastal_modifier: 1.20,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  // Painting — Coastal-grade
  {
    sku: "PNT-EXTERIOR-MARINE-CST",
    cost_code: "09-900",
    cost_type: "material",
    category: "Painting & Wall Covering",
    subcategory: "Coastal Paint",
    name: "Marine-Grade Exterior Paint (per gal)",
    description: "Marine-grade exterior latex with UV and salt-air resistance. 15-year coastal warranty.",
    unit_of_measure: "gal",
    unit_cost: 65.00,
    unit_price: 115.00,
    item_type: "material",
    trade: "Painting",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.10,
    coastal_modifier: 1.10,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
  // Plumbing — Coastal-grade
  {
    sku: "PLMB-PIPE-CPVC-CST",
    cost_code: "15-100",
    cost_type: "material",
    category: "Plumbing",
    subcategory: "Coastal Plumbing",
    name: "CPVC Coastal-Grade Supply Pipe (per lf)",
    description: "CPVC supply pipe rated for coastal corrosive environments. Chlorine-resistant.",
    unit_of_measure: "lf",
    unit_cost: 3.25,
    unit_price: 5.75,
    item_type: "material",
    trade: "Plumbing",
    finish_level: "standard",
    channel: "direct",
    region: "charleston",
    waste_factor: 1.10,
    coastal_modifier: 1.10,
    source: "GCHI-Sprint11-Coastal",
    is_active: true,
    taxable: true,
  },
];

let itemsCreated = 0;
for (const item of COASTAL_ITEMS) {
  // Check if SKU already exists
  const [existing] = await conn.execute(
    "SELECT id FROM price_book_items WHERE sku = ?",
    [item.sku]
  );
  if (existing.length > 0) {
    console.log(`  ⏭  SKU "${item.sku}" already exists, skipping.`);
    continue;
  }

  const uuid = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO price_book_items (uuid, sku, cost_code, cost_type, category, subcategory, name, description,
     unit_of_measure, unit_cost, unit_price, item_type, trade, finish_level, channel, region,
     waste_factor, coastal_modifier, source, is_active, taxable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid, item.sku, item.cost_code, item.cost_type, item.category, item.subcategory,
      item.name, item.description, item.unit_of_measure, item.unit_cost, item.unit_price,
      item.item_type, item.trade, item.finish_level, item.channel, item.region,
      item.waste_factor, item.coastal_modifier, item.source, item.is_active, item.taxable,
    ]
  );
  console.log(`  ✅ Created coastal item: ${item.sku} — ${item.name}`);
  itemsCreated++;
}

console.log(`\n═══ SEED COMPLETE ═══`);
console.log(`Zones created: ${zonesCreated}/5`);
console.log(`Coastal PBI items created: ${itemsCreated}/12`);

await conn.end();
