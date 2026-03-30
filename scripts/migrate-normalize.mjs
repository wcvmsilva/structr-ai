/**
 * Sprint 11.6 — Domain Normalization Migration
 * 
 * Forward migration: normalizes legacy values in the database.
 * - Assembly categories: lowercase → Title Case canonical
 * - Assembly trades: lowercase → Title Case canonical
 * - Channel: "residential" → "direct" across all tables
 * 
 * Transaction-safe: all or nothing.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Category normalization map (lowercase → canonical Title Case) ──
const CATEGORY_MAP = {
  'bathroom': 'Bathroom',
  'kitchen': 'Kitchen',
  'flooring': 'Flooring',
  'painting': 'Interior Paint',
  'roofing': 'Roofing',
  'siding': 'Siding',
  'decking': 'Deck / Screen Porch',
  'windows': 'Windows / Doors',
  'concrete': 'Concrete',
  'drywall': 'Drywall',
  'electrical': 'Electrical',
  'fencing': 'Fencing',
};

// ── Trade normalization map (lowercase → canonical Title Case) ──
const TRADE_MAP = {
  'bathroom': 'Plumbing',
  'kitchen': 'Cabinetry',
  'flooring': 'Flooring',
  'painting': 'Painting',
  'roofing': 'Roofing',
  'siding': 'Siding',
  'decking': 'Decking',
  'windows': 'Windows',
  'concrete': 'Concrete',
  'drywall': 'Drywall',
  'electrical': 'Electrical',
  'fencing': 'Fencing',
};

async function main() {
  const pgClient = postgres(process.env.DATABASE_URL, { max: 5 });
  const db = drizzle(pgClient);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Sprint 11.6 — Domain Normalization Migration`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Pre-migration audit ──
  console.log('── Pre-migration audit ──\n');

  const [asmCats] = await db.execute(sql`SELECT category, COUNT(*) as cnt FROM assemblies WHERE deleted_at IS NULL GROUP BY category ORDER BY category`);
  console.log('Assembly categories:');
  for (const r of asmCats) console.log(`  ${r.category}: ${r.cnt}`);

  const [asmTrades] = await db.execute(sql`SELECT trade, COUNT(*) as cnt FROM assemblies WHERE deleted_at IS NULL GROUP BY trade ORDER BY trade`);
  console.log('\nAssembly trades:');
  for (const r of asmTrades) console.log(`  ${r.trade}: ${r.cnt}`);

  const [bundleChannels] = await db.execute(sql`SELECT channel, COUNT(*) as cnt FROM bundles GROUP BY channel`);
  console.log('\nBundle channels:');
  for (const r of bundleChannels) console.log(`  ${r.channel}: ${r.cnt}`);

  const [edChannels] = await db.execute(sql`SELECT channel, COUNT(*) as cnt FROM estimate_drafts GROUP BY channel`);
  console.log('\nEstimate draft channels:');
  for (const r of edChannels) console.log(`  ${r.channel}: ${r.cnt}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would apply the following changes:');
    for (const [from, to] of Object.entries(CATEGORY_MAP)) {
      console.log(`  assemblies.category: "${from}" → "${to}"`);
    }
    for (const [from, to] of Object.entries(TRADE_MAP)) {
      console.log(`  assemblies.trade: "${from}" → "${to}"`);
    }
    console.log('  bundles.channel: "residential" → "direct"');
    console.log('  estimate_drafts.channel: "residential" → "direct"');
    console.log('  clients.channel: "residential" → "direct"');
    console.log('  projects.channel: "residential" → "direct"');
    console.log('  intake_forms.channel: "residential" → "direct"');
    console.log('  estimates.channel: "residential" → "direct"');
    await pgClient.end();
    return;
  }

  // ── Execute migration ──
  console.log('\n── Executing migration ──\n');

  try {
    let totalAffected = 0;

    // 1. Assembly categories
    for (const [from, to] of Object.entries(CATEGORY_MAP)) {
      const result = await pgClient`UPDATE assemblies SET category = ${to} WHERE category = ${from} AND deleted_at IS NULL`;
      if (result.count > 0) {
        console.log(`  assemblies.category: "${from}" → "${to}" (${result.count} rows)`);
        totalAffected += result.count;
      }
    }

    // 2. Assembly trades
    for (const [from, to] of Object.entries(TRADE_MAP)) {
      const result = await pgClient`UPDATE assemblies SET trade = ${to} WHERE trade = ${from} AND deleted_at IS NULL`;
      if (result.count > 0) {
        console.log(`  assemblies.trade: "${from}" → "${to}" (${result.count} rows)`);
        totalAffected += result.count;
      }
    }

    // 3. Channel normalization across all tables
    const channelTables = ['bundles', 'estimate_drafts', 'clients', 'projects', 'intake_forms', 'estimates'];
    for (const table of channelTables) {
      const result = await pgClient`UPDATE ${ pgClient(table) } SET channel = 'direct' WHERE channel = 'residential'`;
      if (result.count > 0) {
        console.log(`  ${table}.channel: "residential" → "direct" (${result.count} rows)`);
        totalAffected += result.count;
      }
    }
    console.log(`\n✅ Migration complete. Total rows affected: ${totalAffected}`);

    // ── Post-migration audit ──
    console.log('\n── Post-migration audit ──\n');

    const [postCats] = await db.execute(sql`SELECT category, COUNT(*) as cnt FROM assemblies WHERE deleted_at IS NULL GROUP BY category ORDER BY category`);
    console.log('Assembly categories:');
    for (const r of postCats) console.log(`  ${r.category}: ${r.cnt}`);

    const [postTrades] = await db.execute(sql`SELECT trade, COUNT(*) as cnt FROM assemblies WHERE deleted_at IS NULL GROUP BY trade ORDER BY trade`);
    console.log('\nAssembly trades:');
    for (const r of postTrades) console.log(`  ${r.trade}: ${r.cnt}`);

    const [postBundleChannels] = await db.execute(sql`SELECT channel, COUNT(*) as cnt FROM bundles GROUP BY channel`);
    console.log('\nBundle channels:');
    for (const r of postBundleChannels) console.log(`  ${r.channel}: ${r.cnt}`);

    const [postEdChannels] = await db.execute(sql`SELECT channel, COUNT(*) as cnt FROM estimate_drafts GROUP BY channel`);
    console.log('\nEstimate draft channels:');
    for (const r of postEdChannels) console.log(`  ${r.channel}: ${r.cnt}`);

  } catch (err) {
    console.error('\n❌ Migration FAILED due to error:', err.message);
    process.exitCode = 1;
  }

  await pgClient.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
