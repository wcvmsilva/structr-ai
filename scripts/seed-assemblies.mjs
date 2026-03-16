/**
 * GCHI Command Center v9 — Sprint 7 Assembly Seed Script
 * Seeds ~50 remodel assemblies with real price_book_items references
 *
 * Corrected SKU mapping based on actual DB:
 *   PAI-INT-0364 = Interior Painting - Walls (per SF)
 *   PAI-INT-0361 = Interior Painting - Ceilings (per SF)
 *   PAI-INT-0363 = Interior Painting - Trim (per LF)
 *   PAI-INT-0362 = Interior Painting - Doors (per EA)
 *   PAI-PRI-0366 = Primer - Moisture Resistant (per SF)
 *   EXT-EXT-0114 = Exterior Painting - Full House (per SF)
 *   EXT-WEA-0135 = Weather-Resistant Barrier - House Wrap (per SF)
 *   EXT-EXT-0121 = Fiber Cement Siding - Lap (per SF)
 *   EXT-VIN-0133 = Vinyl Siding - Standard (per SF)
 *   EXT-EXT-0118 = Exterior Trim - PVC (per LF)
 *   EXT-FAS-0120 = Fascia Board - PVC 1x6 (per LF)
 *   EXT-SOF-0128 = Soffit - Vinyl (per SF)
 *   EXT-EXT-0113 = Exterior Caulking & Sealing (per LF)
 *   EXT-DEC-0142 = Deck Framing - PT Lumber (per SF)
 *   EXT-DEC-0138 = Deck Boards - Composite Standard (per SF)
 *   EXT-DEC-0145 = Deck Railing - Aluminum (per LF)
 *   EXT-SCR-0177 = Screen System - Standard (per SF)
 *   FRA-OSB-0260 = OSB Sheathing - 7/16" Wall (per SF)
 *   No dedicated demo/dumpster SKUs — use GEN-TEM-0276 or null for labor
 *
 * Run: cd gchi-bundle-builder-web && node scripts/seed-assemblies.mjs
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function insertAssembly(data) {
  const [result] = await db.execute(sql`
    INSERT INTO assemblies (
      name, code, trade, category, subcategory, description, defaultUnit, unit_of_measure,
      directCost, sellPrice, crewHours, itemCount, grossProfitPct,
      assembly_type, finish_level, region, coastal_modifier,
      trade_sequence_order, inclusions, exclusions, hidden_condition_flag,
      version, isActive
    ) VALUES (
      ${data.name}, ${data.code}, ${data.trade}, ${data.category}, ${data.subcategory ?? null},
      ${data.description}, ${data.defaultUnit ?? "EA"}, ${data.unitOfMeasure ?? null},
      ${data.directCost ?? "0.00"}, ${data.sellPrice ?? "0.00"}, ${data.crewHours ?? "0"},
      ${data.itemCount ?? 0}, ${data.grossProfitPct ?? null},
      'scope', ${data.finishLevel ?? "standard"}, ${data.region ?? "charleston_metro"},
      ${data.coastalModifier ?? "1.0000"}, ${data.tradeSequenceOrder ?? 100},
      ${data.inclusions ?? null}, ${data.exclusions ?? null},
      ${data.hiddenConditionFlag ?? false}, 1, 1
    )
  `);
  return result.insertId;
}

async function insertComponent(data) {
  const pbiId = data.pbiId ?? null;
  if (pbiId === null) {
    // Labor-only or equipment component without PBI reference
    await db.execute(sql`
      INSERT INTO assembly_components (
        assembly_id, price_book_item_id, component_type, description,
        quantity, unit, waste_factor_pct, notes, sort_order
      ) VALUES (
        ${data.assemblyId}, NULL, ${data.componentType ?? "material"},
        ${data.description}, ${data.quantity ?? "1.0000"}, ${data.unit ?? "EA"},
        ${data.wasteFactorPct ?? "0.00"}, ${data.notes ?? null}, ${data.sortOrder ?? 0}
      )
    `);
  } else {
    await db.execute(sql`
      INSERT INTO assembly_components (
        assembly_id, price_book_item_id, component_type, description,
        quantity, unit, waste_factor_pct, notes, sort_order
      ) VALUES (
        ${data.assemblyId}, ${pbiId}, ${data.componentType ?? "material"},
        ${data.description}, ${data.quantity ?? "1.0000"}, ${data.unit ?? "EA"},
        ${data.wasteFactorPct ?? "0.00"}, ${data.notes ?? null}, ${data.sortOrder ?? 0}
      )
    `);
  }
}

// Build a PBI lookup map by SKU
async function buildPbiMap() {
  const [rows] = await db.execute(sql`SELECT id, sku, name, unit_cost, unit_price FROM price_book_items`);
  const map = {};
  for (const r of rows) {
    map[r.sku] = { id: r.id, name: r.name, unitCost: r.unit_cost, unitPrice: r.unit_price };
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SEED
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("🔨 Sprint 7 — Seeding Remodel Assemblies (corrected SKUs)...");

  const pbi = await buildPbiMap();
  let missing = 0;
  const p = (sku) => {
    const item = pbi[sku];
    if (!item) { console.warn(`  ⚠ SKU not found: ${sku}`); missing++; return null; }
    return item.id;
  };

  let count = 0;
  let aId;

  // ═══════════════════════════════════════════════════════════════
  // 1. KITCHEN (10 assemblies)
  // ═══════════════════════════════════════════════════════════════

  // 1.1 Kitchen Demo — Full Gut (no dedicated demo SKU, use labor-only component)
  aId = await insertAssembly({
    name: "Kitchen Demo — Full Gut", code: "KIT-DEMO-001",
    trade: "Demolition", category: "Kitchen", subcategory: "Demo",
    description: "Complete kitchen demolition including cabinets, countertops, backsplash, flooring, and disposal",
    defaultUnit: "EA", tradeSequenceOrder: 10,
    inclusions: "Cabinet removal, countertop removal, backsplash removal, flooring removal, dumpster, haul-away",
    exclusions: "Asbestos abatement, structural modifications, plumbing/electrical rough-in",
  });
  await insertComponent({ assemblyId: aId, componentType: "labor", description: "Interior Selective Demo — Kitchen (200 SF)", quantity: "200", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, componentType: "equipment", description: "Dumpster 20-yard for kitchen demo", quantity: "1", unit: "EA", sortOrder: 2 });
  count++;

  // 1.2 Cabinet Install — Standard
  aId = await insertAssembly({
    name: "Cabinet Install — Standard", code: "KIT-CAB-STD",
    trade: "Cabinetry", category: "Kitchen", subcategory: "Cabinets",
    description: "Stock kitchen cabinet installation — 15 LF base + 15 LF wall",
    defaultUnit: "LF", finishLevel: "standard", tradeSequenceOrder: 40,
    inclusions: "Stock cabinets, hardware, installation labor, leveling, shimming",
    exclusions: "Custom cabinets, countertops, plumbing connections, electrical",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-KIT-0030"), componentType: "material", description: "Kitchen Cabinets - Stock (15 LF)", quantity: "15", unit: "LF", wasteFactorPct: "5.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-CAB-0021"), componentType: "material", description: "Cabinet Hardware (30 pcs)", quantity: "30", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-CAB-0020"), componentType: "material", description: "Cabinet Crown Molding (15 LF)", quantity: "15", unit: "LF", sortOrder: 3 });
  count++;

  // 1.3 Cabinet Install — Premium
  aId = await insertAssembly({
    name: "Cabinet Install — Premium", code: "KIT-CAB-PRM",
    trade: "Cabinetry", category: "Kitchen", subcategory: "Cabinets",
    description: "Semi-custom kitchen cabinet installation — 15 LF base + 15 LF wall",
    defaultUnit: "LF", finishLevel: "premium", tradeSequenceOrder: 40,
    inclusions: "Semi-custom cabinets, premium hardware, soft-close, crown molding, installation",
    exclusions: "Custom cabinets, countertops, plumbing connections",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-KIT-0029"), componentType: "material", description: "Kitchen Cabinets - Semi-Custom (15 LF)", quantity: "15", unit: "LF", wasteFactorPct: "3.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-CAB-0021"), componentType: "material", description: "Cabinet Hardware - Premium (30 pcs)", quantity: "30", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-CAB-0020"), componentType: "material", description: "Cabinet Crown Molding (15 LF)", quantity: "15", unit: "LF", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-PAN-0031"), componentType: "material", description: "Pantry Shelving System", quantity: "1", unit: "EA", sortOrder: 4 });
  count++;

  // 1.4 Countertop Install — Laminate
  aId = await insertAssembly({
    name: "Countertop Install — Laminate", code: "KIT-CTR-LAM",
    trade: "Cabinetry", category: "Kitchen", subcategory: "Countertops",
    description: "Laminate countertop fabrication and installation — 30 SF",
    defaultUnit: "SF", finishLevel: "standard", tradeSequenceOrder: 45,
    inclusions: "Laminate countertop, edge profile, sink cutout, installation",
    exclusions: "Sink, faucet, backsplash, plumbing connections",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-COU-0024"), componentType: "material", description: "Countertop - Laminate (30 SF)", quantity: "30", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  count++;

  // 1.5 Countertop Install — Quartz
  aId = await insertAssembly({
    name: "Countertop Install — Quartz", code: "KIT-CTR-QTZ",
    trade: "Cabinetry", category: "Kitchen", subcategory: "Countertops",
    description: "Quartz countertop fabrication and installation — 30 SF",
    defaultUnit: "SF", finishLevel: "premium", tradeSequenceOrder: 45,
    inclusions: "Quartz slab, fabrication, edge profile, sink cutout, installation, seaming",
    exclusions: "Sink, faucet, backsplash, plumbing connections",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-COU-0026"), componentType: "material", description: "Countertop - Quartz (30 SF)", quantity: "30", unit: "SF", wasteFactorPct: "8.00", sortOrder: 1 });
  count++;

  // 1.6 Tile Backsplash Install
  aId = await insertAssembly({
    name: "Tile Backsplash Install", code: "KIT-BSP-001",
    trade: "Tile", category: "Kitchen", subcategory: "Backsplash",
    description: "Ceramic tile backsplash installation — 30 SF",
    defaultUnit: "SF", tradeSequenceOrder: 50,
    inclusions: "Tile material, thinset, grout, edge trim, installation labor",
    exclusions: "Specialty tile patterns, natural stone, glass mosaic",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0209"), componentType: "material", description: "Tile - Ceramic (30 SF backsplash)", quantity: "30", unit: "SF", wasteFactorPct: "12.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0212"), componentType: "material", description: "Tile Underlayment - DITRA (30 SF)", quantity: "30", unit: "SF", wasteFactorPct: "5.00", sortOrder: 2 });
  count++;

  // 1.7 Kitchen Sink and Faucet Replacement
  aId = await insertAssembly({
    name: "Kitchen Sink & Faucet Replacement", code: "KIT-SNK-001",
    trade: "Plumbing", category: "Kitchen", subcategory: "Plumbing",
    description: "Kitchen sink and faucet replacement with garbage disposal",
    defaultUnit: "EA", tradeSequenceOrder: 55,
    inclusions: "Stainless double sink, standard faucet, garbage disposal, supply lines, drain connections",
    exclusions: "Countertop modification, dishwasher connection, gas line",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-KIT-0389"), componentType: "material", description: "Kitchen Sink - Stainless Double", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-KIT-0387"), componentType: "material", description: "Kitchen Faucet - Standard", quantity: "1", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-GAR-0379"), componentType: "material", description: "Garbage Disposal - 1/2 HP", quantity: "1", unit: "EA", sortOrder: 3 });
  count++;

  // 1.8 Appliance Hookup — Standard Package
  aId = await insertAssembly({
    name: "Appliance Hookup — Standard Package", code: "KIT-APP-STD",
    trade: "Appliances", category: "Kitchen", subcategory: "Appliances",
    description: "Standard appliance package: refrigerator, range, dishwasher, microwave",
    defaultUnit: "EA", finishLevel: "standard", tradeSequenceOrder: 60,
    inclusions: "Standard refrigerator, electric range, standard dishwasher, over-range microwave, hookup labor",
    exclusions: "Gas line, dedicated circuits, custom ventilation",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("APP-REF-0013"), componentType: "material", description: "Refrigerator - Standard", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("APP-RAN-0009"), componentType: "material", description: "Range - Electric", quantity: "1", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("APP-DIS-0004"), componentType: "material", description: "Dishwasher - Standard", quantity: "1", unit: "EA", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("APP-MIC-0008"), componentType: "material", description: "Microwave - Over Range", quantity: "1", unit: "EA", sortOrder: 4 });
  count++;

  // 1.9 Kitchen Paint — Walls and Ceiling
  aId = await insertAssembly({
    name: "Kitchen Paint — Walls & Ceiling", code: "KIT-PNT-001",
    trade: "Painting", category: "Kitchen", subcategory: "Paint",
    description: "Kitchen walls and ceiling paint — ~400 SF walls + 200 SF ceiling",
    defaultUnit: "SF", tradeSequenceOrder: 70,
    inclusions: "Surface prep, primer, 2 coats paint walls, 1 coat ceiling, trim paint",
    exclusions: "Wallpaper removal, extensive patching, cabinet painting",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0364"), componentType: "material", description: "Interior Painting - Walls (400 SF)", quantity: "400", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0361"), componentType: "material", description: "Interior Painting - Ceilings (200 SF)", quantity: "200", unit: "SF", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-PRI-0366"), componentType: "material", description: "Primer - Moisture Resistant (600 SF)", quantity: "600", unit: "SF", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0363"), componentType: "material", description: "Interior Painting - Trim (40 LF)", quantity: "40", unit: "LF", sortOrder: 4 });
  count++;

  // 1.10 Cabinet Removal and Disposal
  aId = await insertAssembly({
    name: "Cabinet Removal & Disposal", code: "KIT-REM-001",
    trade: "Demolition", category: "Kitchen", subcategory: "Demo",
    description: "Remove existing kitchen cabinets and dispose — 15 LF",
    defaultUnit: "LF", tradeSequenceOrder: 5,
    inclusions: "Cabinet removal, countertop removal, haul-away, dumpster share",
    exclusions: "Backsplash removal, flooring removal, plumbing disconnect",
  });
  await insertComponent({ assemblyId: aId, componentType: "labor", description: "Selective Demo - Cabinet area (100 SF)", quantity: "100", unit: "SF", sortOrder: 1 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 2. BATHROOM (8 assemblies)
  // ═══════════════════════════════════════════════════════════════

  // 2.1 Standard Shower Rebuild
  aId = await insertAssembly({
    name: "Standard Shower Rebuild", code: "BTH-SHW-STD",
    trade: "Plumbing", category: "Bathroom", subcategory: "Shower",
    description: "Complete shower rebuild with tile, pan, and fixtures",
    defaultUnit: "EA", finishLevel: "standard", tradeSequenceOrder: 30,
    inclusions: "Tile-ready pan, porcelain tile walls (60 SF), shower valve, rain head, framed door",
    exclusions: "Custom tile patterns, frameless door, body sprays, bench seat",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-SHO-0394"), componentType: "material", description: "Shower Pan - Tile-Ready", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0211"), componentType: "material", description: "Tile - Porcelain (60 SF walls)", quantity: "60", unit: "SF", wasteFactorPct: "12.00", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-TUB-0400"), componentType: "material", description: "Tub/Shower Valve", quantity: "1", unit: "EA", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-SHO-0395"), componentType: "material", description: "Shower System - Rain Head", quantity: "1", unit: "EA", sortOrder: 4 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-SHO-0392"), componentType: "material", description: "Shower Door - Framed", quantity: "1", unit: "EA", sortOrder: 5 });
  await insertComponent({ assemblyId: aId, pbiId: p("DRY-DRY-0066"), componentType: "material", description: "Cement Board 1/2\" (60 SF)", quantity: "60", unit: "SF", wasteFactorPct: "10.00", sortOrder: 6 });
  count++;

  // 2.2 Tub-to-Shower Conversion
  aId = await insertAssembly({
    name: "Tub-to-Shower Conversion", code: "BTH-TUB-CNV",
    trade: "Plumbing", category: "Bathroom", subcategory: "Shower",
    description: "Convert existing bathtub to walk-in shower with tile",
    defaultUnit: "EA", finishLevel: "standard", tradeSequenceOrder: 30,
    inclusions: "Tub removal, shower pan, tile walls, valve, rain head, framed door, plumbing rework",
    exclusions: "Structural modifications, frameless door, heated floor",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-SHO-0394"), componentType: "material", description: "Shower Pan - Tile-Ready", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0211"), componentType: "material", description: "Tile - Porcelain (60 SF)", quantity: "60", unit: "SF", wasteFactorPct: "12.00", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-TUB-0400"), componentType: "material", description: "Tub/Shower Valve", quantity: "1", unit: "EA", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-SHO-0395"), componentType: "material", description: "Shower System - Rain Head", quantity: "1", unit: "EA", sortOrder: 4 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-SHO-0392"), componentType: "material", description: "Shower Door - Framed", quantity: "1", unit: "EA", sortOrder: 5 });
  await insertComponent({ assemblyId: aId, pbiId: p("DRY-DRY-0066"), componentType: "material", description: "Cement Board 1/2\"", quantity: "60", unit: "SF", wasteFactorPct: "10.00", sortOrder: 6 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-DRA-0377"), componentType: "material", description: "Drain Line - PVC 3\" (10 LF rework)", quantity: "10", unit: "LF", sortOrder: 7 });
  count++;

  // 2.3 Vanity Replacement — Standard
  aId = await insertAssembly({
    name: "Vanity Replacement — Standard", code: "BTH-VAN-STD",
    trade: "Plumbing", category: "Bathroom", subcategory: "Vanity",
    description: "Standard 36\" vanity replacement with faucet and mirror",
    defaultUnit: "EA", finishLevel: "standard", tradeSequenceOrder: 35,
    inclusions: "Stock 36\" vanity, standard faucet, undermount sink, supply lines, drain",
    exclusions: "Custom vanity, countertop upgrade, electrical for mirror",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-BAT-0019"), componentType: "material", description: "Bathroom Vanity - Stock 36\"", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-BAT-0372"), componentType: "material", description: "Bathroom Faucet - Standard", quantity: "1", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-BAT-0374"), componentType: "material", description: "Bathroom Sink - Undermount", quantity: "1", unit: "EA", sortOrder: 3 });
  count++;

  // 2.4 Vanity Replacement — Premium
  aId = await insertAssembly({
    name: "Vanity Replacement — Premium", code: "BTH-VAN-PRM",
    trade: "Plumbing", category: "Bathroom", subcategory: "Vanity",
    description: "Custom vanity replacement with premium faucet — 4 LF",
    defaultUnit: "LF", finishLevel: "premium", tradeSequenceOrder: 35,
    inclusions: "Custom vanity (4 LF), premium faucet, undermount sink, quartz top",
    exclusions: "Electrical for mirror/lights, plumbing reroute",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-BAT-0018"), componentType: "material", description: "Bathroom Vanity - Custom (4 LF)", quantity: "4", unit: "LF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-BAT-0371"), componentType: "material", description: "Bathroom Faucet - Premium", quantity: "1", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-BAT-0374"), componentType: "material", description: "Bathroom Sink - Undermount", quantity: "1", unit: "EA", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("CAB-COU-0026"), componentType: "material", description: "Countertop - Quartz (8 SF)", quantity: "8", unit: "SF", sortOrder: 4 });
  count++;

  // 2.5 Toilet Replacement
  aId = await insertAssembly({
    name: "Toilet Replacement", code: "BTH-TOI-001",
    trade: "Plumbing", category: "Bathroom", subcategory: "Fixtures",
    description: "Toilet replacement with wax ring and supply line",
    defaultUnit: "EA", tradeSequenceOrder: 40,
    inclusions: "Standard toilet, wax ring, supply line, installation, haul-away old",
    exclusions: "Flange repair, floor repair, bidet seat",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PLU-TOI-0399"), componentType: "material", description: "Toilet - Standard", quantity: "1", unit: "EA", sortOrder: 1 });
  count++;

  // 2.6 Tile Floor Install — Bathroom
  aId = await insertAssembly({
    name: "Tile Floor Install — Bathroom", code: "BTH-FLR-TIL",
    trade: "Tile", category: "Bathroom", subcategory: "Flooring",
    description: "Porcelain tile floor installation — 50 SF bathroom",
    defaultUnit: "SF", tradeSequenceOrder: 25,
    inclusions: "Porcelain tile, DITRA underlayment, thinset, grout, floor transitions",
    exclusions: "Heated floor mat, natural stone, custom patterns",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0211"), componentType: "material", description: "Tile Flooring - Porcelain (50 SF)", quantity: "50", unit: "SF", wasteFactorPct: "12.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0212"), componentType: "material", description: "Tile Underlayment - DITRA (50 SF)", quantity: "50", unit: "SF", wasteFactorPct: "5.00", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-FLO-0203"), componentType: "material", description: "Floor Transition Strips", quantity: "2", unit: "EA", sortOrder: 3 });
  count++;

  // 2.7 Bathroom Demo — Full Gut
  aId = await insertAssembly({
    name: "Bathroom Demo — Full Gut", code: "BTH-DEMO-001",
    trade: "Demolition", category: "Bathroom", subcategory: "Demo",
    description: "Complete bathroom demolition — fixtures, tile, vanity, drywall",
    defaultUnit: "EA", tradeSequenceOrder: 5,
    inclusions: "Fixture removal, tile removal, vanity removal, drywall strip, disposal",
    exclusions: "Asbestos abatement, structural modifications, plumbing cap-off",
  });
  await insertComponent({ assemblyId: aId, componentType: "labor", description: "Interior Selective Demo (100 SF bathroom)", quantity: "100", unit: "SF", sortOrder: 1 });
  count++;

  // 2.8 Bathroom Paint — Walls and Ceiling
  aId = await insertAssembly({
    name: "Bathroom Paint — Walls & Ceiling", code: "BTH-PNT-001",
    trade: "Painting", category: "Bathroom", subcategory: "Paint",
    description: "Bathroom walls and ceiling paint — ~200 SF walls + 50 SF ceiling",
    defaultUnit: "SF", tradeSequenceOrder: 65,
    inclusions: "Surface prep, moisture-resistant primer, 2 coats semi-gloss walls, ceiling paint",
    exclusions: "Wallpaper removal, extensive patching, cabinet painting",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0364"), componentType: "material", description: "Interior Painting - Walls (200 SF)", quantity: "200", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0361"), componentType: "material", description: "Interior Painting - Ceilings (50 SF)", quantity: "50", unit: "SF", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-PRI-0366"), componentType: "material", description: "Primer - Moisture Resistant (250 SF)", quantity: "250", unit: "SF", sortOrder: 3 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 3. ROOFING (9 assemblies)
  // ═══════════════════════════════════════════════════════════════

  aId = await insertAssembly({
    name: "Asphalt Shingle Reroof — Standard", code: "ROF-SHG-STD",
    trade: "Roofing", category: "Roofing", subcategory: "Shingles",
    description: "30-year architectural shingle reroof per square (100 SF)",
    defaultUnit: "SQ", finishLevel: "standard", tradeSequenceOrder: 20,
    inclusions: "30-yr shingles, synthetic underlayment, ridge cap, starter strip, nails",
    exclusions: "Deck repair, ice & water shield, drip edge, gutters",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ARC-0409"), componentType: "material", description: "Architectural Shingles - 30yr", quantity: "1", unit: "SQ", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ROO-0438"), componentType: "material", description: "Roof Underlayment - Synthetic", quantity: "1", unit: "SQ", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-RID-0428"), componentType: "material", description: "Ridge Cap Shingles (10 LF/SQ avg)", quantity: "10", unit: "LF", sortOrder: 3 });
  count++;

  aId = await insertAssembly({
    name: "Asphalt Shingle Reroof — Architectural", code: "ROF-SHG-ARC",
    trade: "Roofing", category: "Roofing", subcategory: "Shingles",
    description: "50-year premium architectural shingle reroof per square",
    defaultUnit: "SQ", finishLevel: "premium", tradeSequenceOrder: 20,
    inclusions: "50-yr premium shingles, self-adhering underlayment, enhanced ridge vent, ridge cap",
    exclusions: "Deck repair, gutters, solar penetrations",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ARC-0410"), componentType: "material", description: "Architectural Shingles - 50yr Premium", quantity: "1", unit: "SQ", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ROO-0437"), componentType: "material", description: "Roof Underlayment - Self-Adhering Full", quantity: "1", unit: "SQ", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-RID-0429"), componentType: "material", description: "Ridge Vent - Enhanced Seal FORTIFIED (10 LF)", quantity: "10", unit: "LF", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-RID-0428"), componentType: "material", description: "Ridge Cap Shingles (10 LF)", quantity: "10", unit: "LF", sortOrder: 4 });
  count++;

  aId = await insertAssembly({
    name: "Roof Deck Repair (per OSB sheet)", code: "ROF-DEC-RPR",
    trade: "Roofing", category: "Roofing", subcategory: "Deck Repair",
    description: "Replace damaged OSB roof decking — per 4x8 sheet",
    defaultUnit: "SF", hiddenConditionFlag: true, tradeSequenceOrder: 15,
    inclusions: "OSB 5/8\" sheet, ring shank nails, installation",
    exclusions: "Structural rafter repair, full deck replacement",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FRA-OSB-0259"), componentType: "material", description: "OSB Sheathing - 5/8\" Roof (32 SF per sheet)", quantity: "32", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FRA-RIN-0262"), componentType: "material", description: "Ring Shank Nails 8d (1 LB per sheet)", quantity: "1", unit: "LB", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Ridge Cap Replacement", code: "ROF-RDG-001",
    trade: "Roofing", category: "Roofing", subcategory: "Ridge",
    description: "Replace ridge cap shingles and ridge vent",
    defaultUnit: "LF", tradeSequenceOrder: 22,
    inclusions: "Ridge cap shingles, ridge vent, sealant",
    exclusions: "Full reroof, deck repair",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-RID-0428"), componentType: "material", description: "Ridge Cap Shingles", quantity: "1", unit: "LF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ROO-0440"), componentType: "material", description: "Ridge Vent", quantity: "1", unit: "LF", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Drip Edge Install", code: "ROF-DRP-001",
    trade: "Roofing", category: "Roofing", subcategory: "Flashing",
    description: "Aluminum drip edge installation per LF",
    defaultUnit: "LF", tradeSequenceOrder: 18,
    inclusions: "Aluminum drip edge, roofing nails, sealant",
    exclusions: "Enhanced FORTIFIED drip edge, fascia repair",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-DRI-0413"), componentType: "material", description: "Drip Edge - Aluminum", quantity: "1", unit: "LF", sortOrder: 1 });
  count++;

  aId = await insertAssembly({
    name: "Roof Tear-Off & Disposal", code: "ROF-DEMO-001",
    trade: "Roofing", category: "Roofing", subcategory: "Demo",
    description: "Complete roof tear-off and disposal per square",
    defaultUnit: "SQ", tradeSequenceOrder: 10,
    inclusions: "Shingle removal, underlayment removal, nail pulling, dumpster, haul-away",
    exclusions: "Deck repair, structural work",
  });
  await insertComponent({ assemblyId: aId, componentType: "labor", description: "Roof tear-off labor (100 SF per SQ)", quantity: "100", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, componentType: "equipment", description: "Dumpster share (0.1 per SQ)", quantity: "0.1", unit: "EA", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Flashing Replacement — Chimney", code: "ROF-FLS-CHM",
    trade: "Roofing", category: "Roofing", subcategory: "Flashing",
    description: "Chimney flashing replacement",
    defaultUnit: "EA", tradeSequenceOrder: 19,
    inclusions: "Step flashing, counter flashing, sealant, installation",
    exclusions: "Chimney cap, chimney repair, cricket installation",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ROO-0432"), componentType: "material", description: "Roof Flashing - Chimney", quantity: "1", unit: "EA", sortOrder: 1 });
  count++;

  aId = await insertAssembly({
    name: "Flashing Replacement — Valley", code: "ROF-FLS-VAL",
    trade: "Roofing", category: "Roofing", subcategory: "Flashing",
    description: "Valley flashing replacement per LF",
    defaultUnit: "LF", tradeSequenceOrder: 19,
    inclusions: "Valley flashing, ice & water shield, sealant",
    exclusions: "Deck repair, shingle replacement",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ROO-0435"), componentType: "material", description: "Roof Flashing - Valley", quantity: "1", unit: "LF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-ICE-0421"), componentType: "material", description: "Ice & Water Shield - Eaves", quantity: "1", unit: "LF", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Flashing Replacement — Pipe Boot", code: "ROF-FLS-PPB",
    trade: "Roofing", category: "Roofing", subcategory: "Flashing",
    description: "Pipe boot flashing replacement",
    defaultUnit: "EA", tradeSequenceOrder: 19,
    inclusions: "Pipe boot flashing, sealant, shingle patch",
    exclusions: "Vent pipe repair",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-PIP-0427"), componentType: "material", description: "Pipe Boots / Roof Penetration Flashing", quantity: "1", unit: "EA", sortOrder: 1 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 4. SIDING (4 assemblies) — corrected SKUs
  // ═══════════════════════════════════════════════════════════════

  aId = await insertAssembly({
    name: "Fiber Cement Siding Replacement", code: "SID-FBC-001",
    trade: "Siding", category: "Siding", subcategory: "Fiber Cement",
    description: "Fiber cement siding replacement per square (100 SF)",
    defaultUnit: "SQ", tradeSequenceOrder: 25,
    inclusions: "Fiber cement siding, house wrap, trim, caulk, paint, installation",
    exclusions: "Sheathing repair, window/door flashing, structural repair",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-FIB-0121"), componentType: "material", description: "Fiber Cement Siding - Lap (100 SF)", quantity: "100", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-WEA-0135"), componentType: "material", description: "House Wrap (100 SF)", quantity: "100", unit: "SF", wasteFactorPct: "5.00", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Vinyl Siding Replacement", code: "SID-VNL-001",
    trade: "Siding", category: "Siding", subcategory: "Vinyl",
    description: "Vinyl siding replacement per square (100 SF)",
    defaultUnit: "SQ", tradeSequenceOrder: 25,
    inclusions: "Vinyl siding, J-channel, starter strip, house wrap, installation",
    exclusions: "Sheathing repair, window/door flashing",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-VIN-0133"), componentType: "material", description: "Vinyl Siding - Standard (100 SF)", quantity: "100", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-WEA-0135"), componentType: "material", description: "House Wrap (100 SF)", quantity: "100", unit: "SF", wasteFactorPct: "5.00", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Trim Board Replacement", code: "SID-TRM-001",
    trade: "Siding", category: "Siding", subcategory: "Trim",
    description: "PVC trim board replacement per LF",
    defaultUnit: "LF", tradeSequenceOrder: 26,
    inclusions: "PVC trim board, adhesive, paint, caulk",
    exclusions: "Structural repair, fascia board, soffit",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-EXT-0118"), componentType: "material", description: "Exterior Trim - PVC (per LF)", quantity: "1", unit: "LF", sortOrder: 1 });
  count++;

  aId = await insertAssembly({
    name: "Siding Demo & Disposal", code: "SID-DEMO-001",
    trade: "Demolition", category: "Siding", subcategory: "Demo",
    description: "Siding removal and disposal per square (100 SF)",
    defaultUnit: "SQ", tradeSequenceOrder: 10,
    inclusions: "Siding removal, trim removal, disposal, dumpster share",
    exclusions: "Sheathing removal, structural demo",
  });
  await insertComponent({ assemblyId: aId, componentType: "labor", description: "Selective Demo - Siding (100 SF)", quantity: "100", unit: "SF", sortOrder: 1 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 5. WINDOWS / DOORS (7 assemblies)
  // ═══════════════════════════════════════════════════════════════

  aId = await insertAssembly({
    name: "Double-Hung Window — Standard", code: "WIN-DH-STD",
    trade: "Windows", category: "Windows / Doors", subcategory: "Windows",
    description: "Standard double-hung window replacement (non-coastal)",
    defaultUnit: "EA", finishLevel: "standard", tradeSequenceOrder: 30,
    inclusions: "Standard double-hung window, flashing, sill pan, interior/exterior trim, caulk",
    exclusions: "Impact-rated glass, structural header, electrical",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0054"), componentType: "material", description: "Window - Standard Double-Hung", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0055"), componentType: "material", description: "Window Flashing - Sill Pan", quantity: "1", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0056"), componentType: "material", description: "Window Trim - Exterior PVC (12 LF)", quantity: "12", unit: "LF", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("INT-WIN-0320"), componentType: "material", description: "Window Casing - Interior (12 LF)", quantity: "12", unit: "LF", sortOrder: 4 });
  count++;

  aId = await insertAssembly({
    name: "Double-Hung Window — Impact", code: "WIN-DH-IMP",
    trade: "Windows", category: "Windows / Doors", subcategory: "Windows",
    description: "Impact-rated double-hung window replacement (coastal)",
    defaultUnit: "EA", finishLevel: "premium", coastalModifier: "1.0800", tradeSequenceOrder: 30,
    inclusions: "Impact-rated double-hung DP50, flashing, sill pan, trim, caulk",
    exclusions: "Structural header, electrical, DP65 upgrade",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0050"), componentType: "material", description: "Window - Impact Resistant Double-Hung", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0055"), componentType: "material", description: "Window Flashing - Sill Pan", quantity: "1", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0056"), componentType: "material", description: "Window Trim - Exterior PVC (12 LF)", quantity: "12", unit: "LF", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("INT-WIN-0320"), componentType: "material", description: "Window Casing - Interior (12 LF)", quantity: "12", unit: "LF", sortOrder: 4 });
  count++;

  aId = await insertAssembly({
    name: "Casement Window Replacement", code: "WIN-CAS-001",
    trade: "Windows", category: "Windows / Doors", subcategory: "Windows",
    description: "Impact-rated casement window replacement",
    defaultUnit: "EA", coastalModifier: "1.0800", tradeSequenceOrder: 30,
    inclusions: "Impact casement window, flashing, sill pan, trim, caulk",
    exclusions: "Structural header, electrical",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0049"), componentType: "material", description: "Window - Impact Resistant Casement", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0055"), componentType: "material", description: "Window Flashing - Sill Pan", quantity: "1", unit: "EA", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0056"), componentType: "material", description: "Window Trim - Exterior PVC (12 LF)", quantity: "12", unit: "LF", sortOrder: 3 });
  count++;

  aId = await insertAssembly({
    name: "Exterior Door — Standard", code: "DOO-EXT-STD",
    trade: "Doors", category: "Windows / Doors", subcategory: "Doors",
    description: "Impact steel exterior entry door replacement",
    defaultUnit: "EA", finishLevel: "standard", coastalModifier: "1.0800", tradeSequenceOrder: 32,
    inclusions: "Impact steel door, hardware, weatherstripping, threshold, installation",
    exclusions: "Sidelight, transom, structural header modification",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-EXT-0034"), componentType: "material", description: "Exterior Entry Door - Impact Steel", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-DOO-0032"), componentType: "material", description: "Door Hardware - Coastal Grade SS316", quantity: "1", unit: "SET", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Exterior Door — Premium", code: "DOO-EXT-PRM",
    trade: "Doors", category: "Windows / Doors", subcategory: "Doors",
    description: "Impact fiberglass exterior entry door replacement",
    defaultUnit: "EA", finishLevel: "premium", coastalModifier: "1.0800", tradeSequenceOrder: 32,
    inclusions: "Impact fiberglass door, coastal-grade hardware, weatherstripping, threshold",
    exclusions: "Sidelight, transom, structural header modification",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-EXT-0033"), componentType: "material", description: "Exterior Entry Door - Impact Fiberglass", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-DOO-0032"), componentType: "material", description: "Door Hardware - Coastal Grade SS316", quantity: "1", unit: "SET", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Interior Door Replacement", code: "DOO-INT-001",
    trade: "Doors", category: "Windows / Doors", subcategory: "Doors",
    description: "Interior door replacement — solid core shaker style",
    defaultUnit: "EA", tradeSequenceOrder: 50,
    inclusions: "Solid core shaker door, hinges, door casing, installation, paint",
    exclusions: "Frame modification, hardware upgrade",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("INT-INT-0312"), componentType: "material", description: "Interior Door - Shaker Style", quantity: "1", unit: "EA", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("INT-DOO-0307"), componentType: "material", description: "Door Casing - Standard (17 LF)", quantity: "17", unit: "LF", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Window Trim Install (per unit)", code: "WIN-TRM-001",
    trade: "Trim", category: "Windows / Doors", subcategory: "Trim",
    description: "Interior and exterior window trim for one window",
    defaultUnit: "EA", tradeSequenceOrder: 55,
    inclusions: "Exterior PVC trim, interior casing, caulk, paint",
    exclusions: "Window replacement, sill replacement",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("DOO-WIN-0056"), componentType: "material", description: "Window Trim - Exterior PVC (12 LF)", quantity: "12", unit: "LF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("INT-WIN-0320"), componentType: "material", description: "Window Casing - Interior (12 LF)", quantity: "12", unit: "LF", sortOrder: 2 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 6. DECK / SCREEN PORCH (5 assemblies) — corrected SKUs
  // ═══════════════════════════════════════════════════════════════

  aId = await insertAssembly({
    name: "Pressure-Treated Deck Framing", code: "DEC-FRM-001",
    trade: "Framing", category: "Deck / Screen Porch", subcategory: "Framing",
    description: "Pressure-treated deck framing per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 20,
    inclusions: "PT joists, beams, posts, ledger board, joist hangers, hardware",
    exclusions: "Footings, concrete piers, decking surface, railing",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-DEC-0142"), componentType: "material", description: "Deck Framing - PT Lumber (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-SIM-0182"), componentType: "material", description: "Simpson Joist Hanger LUS (0.75 per SF)", quantity: "0.75", unit: "EA", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Composite Decking Install", code: "DEC-CMP-001",
    trade: "Decking", category: "Deck / Screen Porch", subcategory: "Decking",
    description: "Composite decking installation per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 25,
    inclusions: "Composite deck boards, hidden fasteners, end caps",
    exclusions: "Framing, railing, stairs, staining",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-DEC-0138"), componentType: "material", description: "Deck Boards - Composite Standard (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-DEC-0141"), componentType: "material", description: "Deck Fasteners - SS316 Hidden (per SF)", quantity: "1", unit: "SF", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Railing Install", code: "DEC-RAL-001",
    trade: "Decking", category: "Deck / Screen Porch", subcategory: "Railing",
    description: "Deck railing installation per LF — aluminum",
    defaultUnit: "LF", tradeSequenceOrder: 28,
    inclusions: "Aluminum railing, posts, balusters, post caps, installation",
    exclusions: "Cable railing, glass panels, custom designs",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-DEC-0145"), componentType: "material", description: "Deck Railing - Aluminum (per LF)", quantity: "1", unit: "LF", sortOrder: 1 });
  count++;

  aId = await insertAssembly({
    name: "Screen Porch Enclosure", code: "DEC-SCR-001",
    trade: "Screening", category: "Deck / Screen Porch", subcategory: "Screen",
    description: "Screen porch enclosure per sqft — aluminum frame with fiberglass screen",
    defaultUnit: "SF", tradeSequenceOrder: 30,
    inclusions: "Aluminum screen frame, fiberglass screen, screen door, installation",
    exclusions: "Structural framing, roof, electrical, ceiling fan",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-SCR-0177"), componentType: "material", description: "Screen System - Standard (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "5.00", sortOrder: 1 });
  count++;

  aId = await insertAssembly({
    name: "Deck Demo & Disposal", code: "DEC-DEMO-001",
    trade: "Demolition", category: "Deck / Screen Porch", subcategory: "Demo",
    description: "Deck demolition and disposal per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 5,
    inclusions: "Decking removal, railing removal, disposal, dumpster",
    exclusions: "Framing removal, footing removal, grading",
  });
  await insertComponent({ assemblyId: aId, componentType: "labor", description: "Selective Demo - Deck (per SF)", quantity: "1", unit: "SF", sortOrder: 1 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 7. FULL EXTERIOR (5 assemblies) — corrected SKUs
  // ═══════════════════════════════════════════════════════════════

  aId = await insertAssembly({
    name: "Full Exterior Paint", code: "EXT-PNT-001",
    trade: "Painting", category: "Full Exterior", subcategory: "Paint",
    description: "Full exterior paint per sqft — pressure wash, prime, 2 coats",
    defaultUnit: "SF", tradeSequenceOrder: 60,
    inclusions: "Pressure wash, scraping, primer, 2 coats exterior paint, trim paint",
    exclusions: "Lead paint abatement, wood repair, caulking",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-EXT-0114"), componentType: "material", description: "Exterior Painting - Full House (per SF)", quantity: "1", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-PRI-0366"), componentType: "material", description: "Primer - Moisture Resistant (per SF)", quantity: "1", unit: "SF", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Fascia & Soffit Replacement", code: "EXT-FAS-001",
    trade: "Exterior", category: "Full Exterior", subcategory: "Fascia/Soffit",
    description: "Fascia and soffit replacement per LF",
    defaultUnit: "LF", tradeSequenceOrder: 35,
    inclusions: "PVC fascia board, soffit panel, J-channel, paint, caulk",
    exclusions: "Rafter tail repair, structural work",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-FAS-0120"), componentType: "material", description: "Fascia Board - PVC 1x6 (per LF)", quantity: "1", unit: "LF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-SOF-0128"), componentType: "material", description: "Soffit - Vinyl (per SF, ~1 SF/LF)", quantity: "1", unit: "SF", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Gutter Replacement", code: "EXT-GUT-001",
    trade: "Roofing", category: "Full Exterior", subcategory: "Gutters",
    description: "Aluminum 5\" K-style gutter replacement per LF",
    defaultUnit: "LF", tradeSequenceOrder: 38,
    inclusions: "5\" aluminum gutter, hangers, end caps, outlets, sealant",
    exclusions: "Downspouts, gutter guards, fascia repair",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-GUT-0415"), componentType: "material", description: "Gutter - Aluminum 5\" K-Style", quantity: "1", unit: "LF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-GUT-0419"), componentType: "material", description: "Gutter Hangers - SS316 (1 per 2 LF)", quantity: "0.5", unit: "EA", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Downspout Replacement", code: "EXT-DWN-001",
    trade: "Roofing", category: "Full Exterior", subcategory: "Gutters",
    description: "Aluminum 3\"x4\" downspout replacement per unit (10 LF avg)",
    defaultUnit: "EA", tradeSequenceOrder: 39,
    inclusions: "Downspout (10 LF), elbows, brackets, splash block",
    exclusions: "Underground drainage, gutter connection modification",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("ROO-DOW-0412"), componentType: "material", description: "Downspout - Aluminum 3\"x4\" (10 LF)", quantity: "10", unit: "LF", sortOrder: 1 });
  count++;

  aId = await insertAssembly({
    name: "Exterior Caulking & Sealing", code: "EXT-CLK-001",
    trade: "Exterior", category: "Full Exterior", subcategory: "Weatherproofing",
    description: "Exterior caulking and sealing per LF — windows, doors, trim joints",
    defaultUnit: "LF", tradeSequenceOrder: 55,
    inclusions: "Polyurethane caulk, backer rod, surface prep, application",
    exclusions: "Window/door replacement, flashing, structural repair",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("EXT-EXT-0113"), componentType: "material", description: "Exterior Caulking & Sealing (per LF)", quantity: "1", unit: "LF", sortOrder: 1 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 8. INTERIOR PAINT (4 assemblies) — corrected SKUs
  // ═══════════════════════════════════════════════════════════════

  aId = await insertAssembly({
    name: "Interior Paint — Walls Only", code: "PNT-WAL-001",
    trade: "Painting", category: "Interior Paint", subcategory: "Walls",
    description: "Interior wall paint per sqft — prep, prime, 2 coats",
    defaultUnit: "SF", tradeSequenceOrder: 65,
    inclusions: "Surface prep, primer, 2 coats premium interior paint",
    exclusions: "Ceiling, trim, wallpaper removal, extensive patching",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0364"), componentType: "material", description: "Interior Painting - Walls (per SF)", quantity: "1", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-PRI-0366"), componentType: "material", description: "Primer - Moisture Resistant (per SF)", quantity: "1", unit: "SF", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Interior Paint — Walls + Ceiling", code: "PNT-WLC-001",
    trade: "Painting", category: "Interior Paint", subcategory: "Walls + Ceiling",
    description: "Interior walls and ceiling paint per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 65,
    inclusions: "Wall prep, ceiling prep, primer, 2 coats walls, 1 coat ceiling",
    exclusions: "Trim, wallpaper removal, extensive patching",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0364"), componentType: "material", description: "Interior Painting - Walls (per SF)", quantity: "1", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0361"), componentType: "material", description: "Interior Painting - Ceilings (per SF, ~0.4 ratio)", quantity: "0.4", unit: "SF", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-PRI-0366"), componentType: "material", description: "Primer (~1.4 combined)", quantity: "1.4", unit: "SF", sortOrder: 3 });
  count++;

  aId = await insertAssembly({
    name: "Interior Paint — Full Room Package", code: "PNT-FUL-001",
    trade: "Painting", category: "Interior Paint", subcategory: "Full Room",
    description: "Full room paint — walls, ceiling, trim, doors per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 65,
    inclusions: "Wall prep, ceiling prep, trim prep, primer, 2 coats walls, ceiling, trim paint, door paint",
    exclusions: "Wallpaper removal, extensive patching, cabinet painting",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0364"), componentType: "material", description: "Interior Painting - Walls (per SF)", quantity: "1", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0361"), componentType: "material", description: "Interior Painting - Ceilings (~0.4 ratio)", quantity: "0.4", unit: "SF", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0363"), componentType: "material", description: "Interior Painting - Trim (~0.15 LF/SF)", quantity: "0.15", unit: "LF", sortOrder: 3 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-PRI-0366"), componentType: "material", description: "Primer (~1.55 combined)", quantity: "1.55", unit: "SF", sortOrder: 4 });
  count++;

  aId = await insertAssembly({
    name: "Drywall Patch & Paint (per patch)", code: "PNT-PAT-001",
    trade: "Painting", category: "Interior Paint", subcategory: "Patch",
    description: "Drywall patch and paint — per patch (up to 12\"x12\")",
    defaultUnit: "EA", tradeSequenceOrder: 60,
    inclusions: "Drywall patch, joint compound, sanding, primer, 2 coats paint",
    exclusions: "Large holes (>12\"), water damage repair, mold remediation",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("DRY-DRY-0064"), componentType: "material", description: "Drywall - 1/2\" Standard (4 SF patch)", quantity: "4", unit: "SF", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-INT-0364"), componentType: "material", description: "Interior Painting - Walls (4 SF)", quantity: "4", unit: "SF", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("PAI-PRI-0366"), componentType: "material", description: "Primer (4 SF)", quantity: "4", unit: "SF", sortOrder: 3 });
  count++;

  // ═══════════════════════════════════════════════════════════════
  // 9. FLOORING (6 assemblies)
  // ═══════════════════════════════════════════════════════════════

  aId = await insertAssembly({
    name: "LVP Install", code: "FLR-LVP-001",
    trade: "Flooring", category: "Flooring", subcategory: "LVP",
    description: "Luxury vinyl plank installation per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 55,
    inclusions: "LVP material, underlayment, transitions, installation",
    exclusions: "Subfloor repair, floor leveling, demo of existing",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-LUX-0207"), componentType: "material", description: "Luxury Vinyl Plank (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-FLO-0203"), componentType: "material", description: "Floor Transition Strips (1 per 100 SF)", quantity: "0.01", unit: "EA", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Hardwood Install", code: "FLR-HWD-001",
    trade: "Flooring", category: "Flooring", subcategory: "Hardwood",
    description: "Engineered hardwood flooring installation per sqft",
    defaultUnit: "SF", finishLevel: "premium", tradeSequenceOrder: 55,
    inclusions: "Engineered hardwood, underlayment, transitions, installation, acclimation",
    exclusions: "Subfloor repair, floor leveling, demo, staining",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-HAR-0204"), componentType: "material", description: "Hardwood Flooring - Engineered (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-FLO-0203"), componentType: "material", description: "Floor Transition Strips (1 per 100 SF)", quantity: "0.01", unit: "EA", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Tile Floor Install", code: "FLR-TIL-001",
    trade: "Tile", category: "Flooring", subcategory: "Tile",
    description: "Porcelain tile floor installation per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 55,
    inclusions: "Porcelain tile, DITRA underlayment, thinset, grout, transitions",
    exclusions: "Subfloor repair, heated floor, natural stone, custom patterns",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0211"), componentType: "material", description: "Tile Flooring - Porcelain (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "12.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-TIL-0212"), componentType: "material", description: "Tile Underlayment - DITRA (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "5.00", sortOrder: 2 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-FLO-0203"), componentType: "material", description: "Floor Transition Strips (1 per 100 SF)", quantity: "0.01", unit: "EA", sortOrder: 3 });
  count++;

  aId = await insertAssembly({
    name: "Carpet Install", code: "FLR-CPT-001",
    trade: "Flooring", category: "Flooring", subcategory: "Carpet",
    description: "Standard carpet installation per sqft",
    defaultUnit: "SF", finishLevel: "standard", tradeSequenceOrder: 55,
    inclusions: "Standard carpet, pad, tack strips, seaming, transitions",
    exclusions: "Subfloor repair, demo of existing, stairs",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-CAR-0200"), componentType: "material", description: "Carpet - Standard (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  await insertComponent({ assemblyId: aId, pbiId: p("FLO-FLO-0203"), componentType: "material", description: "Floor Transition Strips (1 per 100 SF)", quantity: "0.01", unit: "EA", sortOrder: 2 });
  count++;

  aId = await insertAssembly({
    name: "Floor Demo & Disposal", code: "FLR-DEMO-001",
    trade: "Demolition", category: "Flooring", subcategory: "Demo",
    description: "Floor demolition and disposal per sqft",
    defaultUnit: "SF", tradeSequenceOrder: 5,
    inclusions: "Flooring removal, underlayment removal, disposal, dumpster share",
    exclusions: "Subfloor removal, asbestos abatement",
  });
  await insertComponent({ assemblyId: aId, componentType: "labor", description: "Selective Demo - Flooring (per SF)", quantity: "1", unit: "SF", sortOrder: 1 });
  count++;

  aId = await insertAssembly({
    name: "Subfloor Repair", code: "FLR-SUB-RPR",
    trade: "Framing", category: "Flooring", subcategory: "Subfloor",
    description: "Subfloor repair per sqft — discovered condition",
    defaultUnit: "SF", hiddenConditionFlag: true, tradeSequenceOrder: 8,
    inclusions: "OSB/plywood replacement, leveling compound, fasteners",
    exclusions: "Joist repair, structural engineering, mold remediation",
  });
  await insertComponent({ assemblyId: aId, pbiId: p("FRA-OSB-0260"), componentType: "material", description: "OSB Sheathing - 7/16\" Wall (per SF)", quantity: "1", unit: "SF", wasteFactorPct: "10.00", sortOrder: 1 });
  count++;

  console.log(`\n✅ Seeded ${count} remodel assemblies with components`);
  console.log(`⚠  Missing SKU references: ${missing}`);
  console.log("🏗  Sprint 7 Assembly Library — Remodel Scope — Complete");

  process.exit(0);
}

main().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
