/**
 * GCHI Catalog Seed Script
 * Reads the JobTread Master Price Book CSV and inserts valid items into MySQL.
 * Filter: Only items with Unit Cost > 0 AND Unit Price > 0 are persisted.
 *
 * Usage: node seed-catalog.mjs /path/to/GCHI_JobTread_Import_FINAL_V3.csv
 */

import { createReadStream } from "fs";
import { createInterface } from "readline";
import { createPool } from "mysql2/promise";
import { config } from "dotenv";

config(); // load .env

const CSV_PATH = process.argv[2];
if (!CSV_PATH) {
  console.error("Usage: node seed-catalog.mjs <csv-file-path>");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// Parse the DATABASE_URL
function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "3306"),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace("/", ""),
    ssl: { rejectUnauthorized: false },
  };
}

// Parse a single CSV line handling quoted fields
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function main() {
  console.log("🔌 Connecting to database...");
  const pool = createPool({
    ...parseDbUrl(DATABASE_URL),
    waitForConnections: true,
    connectionLimit: 5,
  });

  // Read CSV
  console.log(`📄 Reading CSV: ${CSV_PATH}`);
  const rl = createInterface({ input: createReadStream(CSV_PATH) });

  let headers = null;
  const rows = [];

  for await (const line of rl) {
    if (!headers) {
      headers = parseCSVLine(line);
      console.log(`   Headers (${headers.length}): ${headers.slice(0, 6).join(", ")}...`);
      continue;
    }
    const fields = parseCSVLine(line);
    if (fields.length < headers.length) continue; // skip malformed rows

    const row = {};
    headers.forEach((h, i) => {
      row[h] = fields[i] || "";
    });
    rows.push(row);
  }

  console.log(`   Total CSV rows: ${rows.length}`);

  // Filter: only items with Unit Cost > 0 AND Unit Price > 0
  const validRows = rows.filter((r) => {
    const unitCost = parseFloat(r["Unit Cost"] || "0");
    const unitPrice = parseFloat(r["Unit Price"] || "0");
    return unitCost > 0 && unitPrice > 0;
  });

  console.log(`   Valid rows (UnitCost>0 AND UnitPrice>0): ${validRows.length}`);
  console.log(
    `   Skipped rows (permits/fees with zero cost): ${rows.length - validRows.length}`
  );

  // Clear existing catalog items
  console.log("🗑️  Clearing existing catalog_items...");
  await pool.execute("DELETE FROM catalog_items");

  // Insert in batches of 50
  const BATCH_SIZE = 50;
  let inserted = 0;

  const INSERT_SQL = `
    INSERT INTO catalog_items 
    (costItemId, costGroupName, costItemName, description, unit, unitCost, unitPrice, margin, costCode, costType, taxable, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const unitCost = parseFloat(row["Unit Cost"] || "0");
      const unitPrice = parseFloat(row["Unit Price"] || "0");
      const taxable = (row["Taxable"] || "").toLowerCase() === "true" ? 1 : 0;
      const costType = row["Cost Type"] || null;
      const margin = row["Margin"] || "35%";

      // Generate a stable costItemId from cost code + item name
      const costCode = row["Cost Code"] || "000";
      const costItemId = `CC${costCode}-${String(i + batch.indexOf(row) + 1).padStart(4, "0")}`;

      await pool.execute(INSERT_SQL, [
        costItemId,
        row["Cost Group Name"] || "",
        row["Cost Item Name"] || "",
        row["Description"] || null,
        row["Unit"] || "Each",
        unitCost.toFixed(2),
        unitPrice.toFixed(2),
        margin,
        costCode,
        costType || null,
        taxable,
        1, // isActive
      ]);
      inserted++;
    }

    process.stdout.write(`\r   Inserted: ${inserted}/${validRows.length}`);
  }

  console.log(`\n✅ Seed complete! ${inserted} catalog items inserted.`);

  // Verify
  const [countResult] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM catalog_items"
  );
  console.log(`   Verification: ${countResult[0].cnt} rows in catalog_items`);

  // Show group distribution
  const [groups] = await pool.execute(
    "SELECT costGroupName, COUNT(*) as cnt FROM catalog_items GROUP BY costGroupName ORDER BY costCode"
  );
  console.log("\n📊 Cost Group Distribution:");
  for (const g of groups) {
    console.log(`   ${g.costGroupName}: ${g.cnt} items`);
  }

  await pool.end();
  console.log("\n🔒 Database connection closed.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
