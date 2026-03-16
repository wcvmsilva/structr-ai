/**
 * GCHI Master Price Book — CSV Export
 * Exports all price_book_items with all columns to a CSV file
 */
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);

  // Get all price_book_items ordered by category, trade, name
  const [rows] = await conn.execute(`
    SELECT
      id,
      uuid,
      sku,
      cost_code AS costCode,
      cost_type AS costType,
      category,
      subcategory,
      name,
      description,
      unit_of_measure AS unitOfMeasure,
      unit_cost AS unitCost,
      unit_price AS unitPrice,
      item_type AS itemType,
      trade,
      finish_level AS finishLevel,
      channel,
      region,
      waste_factor AS wasteFactor,
      coastal_modifier AS coastalModifier,
      channel_multiplier AS channelMultiplier,
      source,
      is_admin_fee AS isAdminFee,
      is_active AS isActive,
      taxable,
      effective_date AS effectiveDate,
      last_cost_updated_at AS lastCostUpdatedAt,
      created_at AS createdAt,
      updated_at AS updatedAt,
      deleted_at AS deletedAt
    FROM price_book_items
    ORDER BY category, trade, name
  `);

  console.log(`Found ${rows.length} price book items`);

  // CSV Headers
  const headers = [
    "ID",
    "UUID",
    "SKU",
    "Cost Code",
    "Cost Type",
    "Category",
    "Subcategory",
    "Name",
    "Description",
    "Unit of Measure",
    "Unit Cost",
    "Unit Price",
    "Gross Profit %",
    "Item Type",
    "Trade",
    "Finish Level",
    "Channel",
    "Region",
    "Waste Factor",
    "Coastal Modifier",
    "Channel Multiplier",
    "Source",
    "Is Admin Fee",
    "Is Active",
    "Taxable",
    "Effective Date",
    "Last Cost Updated",
    "Created At",
    "Updated At",
    "Deleted At",
  ];

  // Helper to escape CSV values
  function csvEscape(val) {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // Calculate GP%
  function calcGP(cost, price) {
    const c = parseFloat(cost);
    const p = parseFloat(price);
    if (!p || p === 0) return "0.00";
    return ((1 - c / p) * 100).toFixed(2);
  }

  // Format date
  function fmtDate(d) {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  }

  // Build CSV lines
  const lines = [headers.join(",")];

  for (const r of rows) {
    const gp = calcGP(r.unitCost, r.unitPrice);
    const line = [
      r.id,
      r.uuid,
      r.sku,
      r.costCode,
      r.costType,
      r.category,
      r.subcategory,
      csvEscape(r.name),
      csvEscape(r.description),
      r.unitOfMeasure,
      r.unitCost,
      r.unitPrice,
      gp,
      r.itemType,
      r.trade,
      r.finishLevel,
      r.channel,
      r.region,
      r.wasteFactor,
      r.coastalModifier,
      r.channelMultiplier,
      r.source,
      r.isAdminFee ? "Yes" : "No",
      r.isActive ? "Yes" : "No",
      r.taxable ? "Yes" : "No",
      fmtDate(r.effectiveDate),
      fmtDate(r.lastCostUpdatedAt),
      fmtDate(r.createdAt),
      fmtDate(r.updatedAt),
      fmtDate(r.deletedAt),
    ].map(csvEscape).join(",");
    lines.push(line);
  }

  const outputPath = path.resolve(__dirname, "..", "GCHI_Master_Price_Book.csv");
  fs.writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
  console.log(`CSV exported to: ${outputPath}`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Total columns: ${headers.length}`);

  // Summary stats
  let totalCost = 0;
  let totalPrice = 0;
  const categories = new Set();
  const trades = new Set();
  for (const r of rows) {
    totalCost += parseFloat(r.unitCost) || 0;
    totalPrice += parseFloat(r.unitPrice) || 0;
    categories.add(r.category);
    if (r.trade) trades.add(r.trade);
  }
  console.log(`\n=== Summary ===`);
  console.log(`Categories: ${categories.size} (${[...categories].join(", ")})`);
  console.log(`Trades: ${trades.size}`);
  console.log(`Sum Unit Costs: $${totalCost.toFixed(2)}`);
  console.log(`Sum Unit Prices: $${totalPrice.toFixed(2)}`);

  await conn.end();
}

main().catch(console.error);
