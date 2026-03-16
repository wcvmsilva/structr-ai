/**
 * Sprint 11.6 — Domain Normalization ROLLBACK
 * 
 * Reverses the forward migration:
 * - Assembly categories: Title Case → lowercase (Supabase legacy)
 * - Assembly trades: Title Case → lowercase (Supabase legacy)
 * - Channel: "direct" → "residential" across all tables
 * 
 * Transaction-safe: all or nothing.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

// Reverse maps
const CATEGORY_ROLLBACK = {
  'Concrete': 'concrete',
  'Drywall': 'drywall',
  'Electrical': 'electrical',
  'Fencing': 'fencing',
};

const TRADE_ROLLBACK = {
  'Concrete': 'concrete',
  'Drywall': 'drywall',
  'Electrical': 'electrical',
  'Fencing': 'fencing',
};

// Note: We only rollback the 15 Supabase-era assemblies that were lowercase.
// The 56 Sprint 7+ assemblies were already Title Case and should NOT be touched.
// Channel rollback is universal since "residential" was the only legacy value.

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(conn);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Sprint 11.6 — Domain Normalization ROLLBACK`);
  console.log(`${'='.repeat(60)}\n`);

  await conn.beginTransaction();
  try {
    let totalAffected = 0;

    // 1. Rollback assembly categories (only the Supabase-era ones)
    for (const [from, to] of Object.entries(CATEGORY_ROLLBACK)) {
      const [result] = await conn.execute(
        `UPDATE assemblies SET category = ? WHERE category = ? AND supabase_id IS NOT NULL AND deleted_at IS NULL`,
        [to, from]
      );
      if (result.affectedRows > 0) {
        console.log(`  assemblies.category: "${from}" → "${to}" (${result.affectedRows} rows, Supabase only)`);
        totalAffected += result.affectedRows;
      }
    }

    // 2. Rollback assembly trades (only the Supabase-era ones)
    for (const [from, to] of Object.entries(TRADE_ROLLBACK)) {
      const [result] = await conn.execute(
        `UPDATE assemblies SET trade = ? WHERE trade = ? AND supabase_id IS NOT NULL AND deleted_at IS NULL`,
        [to, from]
      );
      if (result.affectedRows > 0) {
        console.log(`  assemblies.trade: "${from}" → "${to}" (${result.affectedRows} rows, Supabase only)`);
        totalAffected += result.affectedRows;
      }
    }

    // 3. Channel rollback across all tables
    const channelTables = ['bundles', 'estimate_drafts', 'clients', 'projects', 'intake_forms', 'estimates'];
    for (const table of channelTables) {
      const [result] = await conn.execute(
        `UPDATE ${table} SET channel = 'residential' WHERE channel = 'direct'`
      );
      if (result.affectedRows > 0) {
        console.log(`  ${table}.channel: "direct" → "residential" (${result.affectedRows} rows)`);
        totalAffected += result.affectedRows;
      }
    }

    await conn.commit();
    console.log(`\n✅ Rollback complete. Total rows affected: ${totalAffected}`);

  } catch (err) {
    await conn.rollback();
    console.error('\n❌ Rollback FAILED:', err.message);
    process.exitCode = 1;
  }

  await conn.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
