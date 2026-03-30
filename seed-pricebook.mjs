/**
 * GCHI Command Center v9 — Price Book Migration Script
 * Migrates 458 catalog_items into price_book_items as the single source of truth.
 *
 * Strategy:
 * 1. Read all active catalog_items
 * 2. Generate UUID + SKU for each item
 * 3. Map costGroupName → category, costCode → subcategory
 * 4. Insert into price_book_items preserving all pricing data
 * 5. Create initial price_book_history entries as baseline
 * 6. Verify data integrity (row counts, totals)
 *
 * Backward compatibility:
 * - catalog_items table is NOT modified or deleted
 * - bundle_items FK to catalog_items remains intact
 * - assembly_components FK to catalog_items remains intact
 */

import postgres from "postgres";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 5 });

console.log("🔌 Connected to PostgreSQL");

// Step 1: Read all active catalog_items
const catalogItems = await sql`SELECT id, "costItemId", "costGroupName", "costItemName", description, unit,
          "unitCost", "unitPrice", margin, "costCode", "costType", taxable, "isActive"
   FROM catalog_items
   WHERE "isActive" = 1
   ORDER BY "costGroupName", "costItemName"`;

console.log(`📦 Found ${catalogItems.length} active catalog items`);

// Step 2: Check if price_book_items already has data
const existing = await sql`SELECT COUNT(*) as cnt FROM price_book_items`;
if (existing[0].cnt > 0) {
  console.log(`⚠️  price_book_items already has ${existing[0].cnt} rows.`);
  console.log("   Clearing existing data for fresh migration...");
  await sql`DELETE FROM price_book_history`;
  await sql`DELETE FROM price_book_items`;
  console.log("   ✅ Cleared.");
}

// Step 3: Generate SKU from costGroupName + costItemName
function generateSKU(costGroupName, costItemName, index) {
  // Take first 3 chars of group, uppercase
  const groupCode = costGroupName
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 3)
    .toUpperCase()
    .padEnd(3, "X");

  // Take first 3 chars of item name, uppercase
  const itemCode = costItemName
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 3)
    .toUpperCase()
    .padEnd(3, "X");

  // Pad index to 4 digits
  const num = String(index + 1).padStart(4, "0");

  return `${groupCode}-${itemCode}-${num}`;
}

// SQL templates defined below in the loop

// Track unique SKUs to avoid collisions
const usedSKUs = new Set();

let insertedCount = 0;
let historyCount = 0;
let skippedCount = 0;

for (let i = 0; i < catalogItems.length; i++) {
  const item = catalogItems[i];

  // Generate unique SKU
  let sku = generateSKU(item.costGroupName, item.costItemName, i);
  let attempt = 0;
  while (usedSKUs.has(sku)) {
    attempt++;
    sku = generateSKU(item.costGroupName, item.costItemName, i + attempt * 1000);
  }
  usedSKUs.add(sku);

  const uuid = randomUUID();
  const unitCost = parseFloat(item.unitCost);
  const unitPrice = parseFloat(item.unitPrice);

  // Determine if admin fee (items with zero cost but positive price)
  const isAdminFee = unitCost === 0 && unitPrice > 0;

  // Map costGroupName → category, costCode → subcategory
  const category = item.costGroupName;
  const subcategory = item.costCode || null;

  try {
    const result = await sql`
      INSERT INTO price_book_items (
        uuid, sku, category, subcategory, name, description,
        unit_of_measure, unit_cost, unit_price,
        is_admin_fee, is_active, cost_code, cost_type, taxable,
        created_at, updated_at
      ) VALUES (${uuid}, ${sku}, ${category}, ${subcategory}, ${item.costItemName}, ${item.description || null},
        ${item.unit}, ${item.unitCost}, ${item.unitPrice},
        ${isAdminFee ? 1 : 0}, 1, ${item.costCode || null}, ${item.costType || null}, ${item.taxable ? 1 : 0},
        NOW(), NOW())
      RETURNING id
    `;

    insertedCount++;

    // Create initial price_book_history entry
    const priceBookItemId = result[0].id;
    await sql`
      INSERT INTO price_book_history (
        price_book_item_id, old_unit_cost, new_unit_cost,
        old_unit_price, new_unit_price, changed_by, reason, created_at
      ) VALUES (${priceBookItemId}, '0.0000', ${item.unitCost},
        '0.0000', ${item.unitPrice}, NULL, 'Initial migration from catalog_items', NOW())
    `;
    historyCount++;
  } catch (err) {
    console.error(`  ⚠️ Skipped "${item.costItemName}": ${err.message}`);
    skippedCount++;
  }
}

console.log(`\n✅ Migration complete:`);
console.log(`   📦 price_book_items: ${insertedCount} inserted`);
console.log(`   📜 price_book_history: ${historyCount} baseline entries`);
if (skippedCount > 0) {
  console.log(`   ⚠️  Skipped: ${skippedCount}`);
}

// Step 5: Verify data integrity
const pbCount = await sql`SELECT COUNT(*) as cnt FROM price_book_items WHERE is_active = 1`;
const phCount = await sql`SELECT COUNT(*) as cnt FROM price_book_history`;
const catCount = await sql`SELECT COUNT(*) as cnt FROM catalog_items WHERE "isActive" = 1`;

console.log(`\n📊 Verification:`);
console.log(`   catalog_items (active):    ${catCount[0].cnt}`);
console.log(`   price_book_items (active):  ${pbCount[0].cnt}`);
console.log(`   price_book_history:         ${phCount[0].cnt}`);

// Verify totals match
const catTotals = await sql`
  SELECT SUM("unitCost") as "totalCost", SUM("unitPrice") as "totalPrice" FROM catalog_items WHERE "isActive" = 1
`;
const pbTotals = await sql`
  SELECT SUM(unit_cost) as "totalCost", SUM(unit_price) as "totalPrice" FROM price_book_items WHERE is_active = 1
`;

const catCost = parseFloat(catTotals[0].totalCost);
const pbCost = parseFloat(pbTotals[0].totalCost);
const catPrice = parseFloat(catTotals[0].totalPrice);
const pbPrice = parseFloat(pbTotals[0].totalPrice);

console.log(`\n💰 Cost Totals Match: ${Math.abs(catCost - pbCost) < 0.01 ? "✅ YES" : "❌ NO"}`);
console.log(`   catalog_items total cost:    $${catCost.toFixed(2)}`);
console.log(`   price_book_items total cost: $${pbCost.toFixed(2)}`);
console.log(`\n💰 Price Totals Match: ${Math.abs(catPrice - pbPrice) < 0.01 ? "✅ YES" : "❌ NO"}`);
console.log(`   catalog_items total price:    $${catPrice.toFixed(2)}`);
console.log(`   price_book_items total price: $${pbPrice.toFixed(2)}`);

// Step 6: Show category distribution
const categories = await sql`
  SELECT category, COUNT(*) as cnt,
          ROUND(SUM(unit_cost)::numeric, 2) as "totalCost",
          ROUND(SUM(unit_price)::numeric, 2) as "totalPrice"
   FROM price_book_items
   WHERE is_active = 1
   GROUP BY category
   ORDER BY category
`;

console.log(`\n📋 Category Distribution:`);
for (const cat of categories) {
  console.log(`   ${cat.category}: ${cat.cnt} items | Cost: $${cat.totalCost} | Price: $${cat.totalPrice}`);
}

await sql.end();
console.log("\n🔌 Connection closed. Migration complete.");
