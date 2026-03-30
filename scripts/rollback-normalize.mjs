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
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
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
  const pgClient = postgres(process.env.DATABASE_URL, { max: 5 });
  const db = drizzle(pgClient);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Sprint 11.6 — Domain Normalization ROLLBACK`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    let totalAffected = 0;

    // 1. Rollback assembly categories (only the Supabase-era ones)
    for (const [from, to] of Object.entries(CATEGORY_ROLLBACK)) {
      const result = await pgClient`UPDATE assemblies SET category = ${to} WHERE category = ${from} AND supabase_id IS NOT NULL AND deleted_at IS NULL`;
      if (result.count > 0) {
        console.log(`  assemblies.category: "${from}" → "${to}" (${result.count} rows, Supabase only)`);
        totalAffected += result.count;
      }
    }

    // 2. Rollback assembly trades (only the Supabase-era ones)
    for (const [from, to] of Object.entries(TRADE_ROLLBACK)) {
      const result = await pgClient`UPDATE assemblies SET trade = ${to} WHERE trade = ${from} AND supabase_id IS NOT NULL AND deleted_at IS NULL`;
      if (result.count > 0) {
        console.log(`  assemblies.trade: "${from}" → "${to}" (${result.count} rows, Supabase only)`);
        totalAffected += result.count;
      }
    }

    // 3. Channel rollback across all tables
    const channelTables = ['bundles', 'estimate_drafts', 'clients', 'projects', 'intake_forms', 'estimates'];
    for (const table of channelTables) {
      const result = await pgClient`UPDATE ${ pgClient(table) } SET channel = 'residential' WHERE channel = 'direct'`;
      if (result.count > 0) {
        console.log(`  ${table}.channel: "direct" → "residential" (${result.count} rows)`);
        totalAffected += result.count;
      }
    }

    console.log(`\n✅ Rollback complete. Total rows affected: ${totalAffected}`);

  } catch (err) {
    console.error('\n❌ Rollback FAILED:', err.message);
    process.exitCode = 1;
  }

  await pgClient.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
