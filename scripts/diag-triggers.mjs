#!/usr/bin/env node
/**
 * Diagnostic: Dump trigger function source code for leads table.
 * Run from project root: node scripts/diag-triggers.mjs
 */
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres.xoqhxpqsfxpdiwyuvhdd:P2Y0YYht236BpWuR@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const sql = postgres(DATABASE_URL, { prepare: false });

async function main() {
  console.log("=".repeat(70));
  console.log("TRIGGER & FUNCTION DIAGNOSTIC — leads table");
  console.log("=".repeat(70));

  // 1. List all triggers on leads
  console.log("\n── TRIGGERS ON leads ──");
  const triggers = await sql`
    SELECT tgname, pg_get_triggerdef(oid) as definition
    FROM pg_trigger
    WHERE tgrelid = 'public.leads'::regclass AND NOT tgisinternal
  `;
  for (const t of triggers) {
    console.log(`\n  ${t.tgname}:`);
    console.log(`    ${t.definition}`);
  }

  // 2. Full source of each trigger function
  console.log("\n── TRIGGER FUNCTION SOURCE CODE ──");
  const funcs = await sql`
    SELECT DISTINCT p.proname, pg_get_functiondef(p.oid) as full_def
    FROM pg_trigger t
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE t.tgrelid = 'public.leads'::regclass AND NOT t.tgisinternal
  `;
  for (const f of funcs) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`FUNCTION: ${f.proname}`);
    console.log(`${"─".repeat(60)}`);
    console.log(f.full_def);
  }

  // 3. Search for ANY function with "Authentication required"
  console.log("\n── FUNCTIONS CONTAINING 'Authentication required' ──");
  const authFuncs = await sql`
    SELECT proname, prosrc
    FROM pg_proc
    WHERE prosrc LIKE '%Authentication required%'
  `;
  if (authFuncs.length === 0) {
    console.log("  None found.");
  } else {
    for (const f of authFuncs) {
      console.log(`\n  FUNCTION: ${f.proname}`);
      console.log(f.prosrc);
    }
  }

  // 4. Check if any function calls auth.uid()
  console.log("\n── FUNCTIONS CALLING auth.uid() ──");
  const authUidFuncs = await sql`
    SELECT proname, prosrc
    FROM pg_proc
    WHERE prosrc LIKE '%auth.uid()%'
    AND proname IN (
      SELECT p.proname FROM pg_trigger t
      JOIN pg_proc p ON t.tgfoid = p.oid
      WHERE t.tgrelid = 'public.leads'::regclass
    )
  `;
  if (authUidFuncs.length === 0) {
    console.log("  None of the lead triggers use auth.uid().");
  } else {
    for (const f of authUidFuncs) {
      console.log(`\n  FUNCTION: ${f.proname}`);
      console.log(f.prosrc);
    }
  }

  // 5. Check security definer/invoker on trigger functions
  console.log("\n── SECURITY MODE OF TRIGGER FUNCTIONS ──");
  const secMode = await sql`
    SELECT p.proname,
           CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END as security_mode
    FROM pg_trigger t
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE t.tgrelid = 'public.leads'::regclass AND NOT t.tgisinternal
  `;
  for (const s of secMode) {
    console.log(`  ${s.proname}: ${s.security_mode}`);
  }

  // 6. Profiles
  console.log("\n── PROFILES TABLE ──");
  const profiles = await sql`SELECT id, full_name, role FROM profiles LIMIT 5`;
  if (profiles.length === 0) {
    console.log("  No profiles found.");
  } else {
    for (const p of profiles) {
      console.log(`  ${p.id} | ${p.full_name} | ${p.role}`);
    }
  }

  // 7. Test insert with Supabase auth context
  console.log("\n── TEST: INSERT WITH SUPABASE AUTH CONTEXT ──");
  const realProfileId = "ada92dc5-a90c-4b2b-ba91-7b72ce427786";
  try {
    await sql.begin(async (tx) => {
      // Set JWT claims so auth.uid() returns the real profile ID
      const claims = JSON.stringify({
        sub: realProfileId,
        role: "authenticated",
        iss: "structr-server",
        aud: "authenticated",
      });
      await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
      await tx`SET LOCAL role = 'authenticated'`;

      const [row] = await tx`
        INSERT INTO leads (name, address, source, service_type, urgency, lead_score, status)
        VALUES ('__DIAG_AUTH_TEST__', '', 'website', 'general', 'low', 0, 'new')
        RETURNING id, owner_user_id
      `;
      console.log(`  ✅ INSERT with auth context SUCCEEDED. id=${row.id} owner=${row.owner_user_id}`);
      throw new Error("__ROLLBACK__");
    });
  } catch (e) {
    if (e.message === "__ROLLBACK__") {
      console.log(`  ✅ Test row rolled back. TRIGGERS PASS with auth context.`);
    } else {
      console.log(`  ❌ INSERT with auth context FAILED: ${e.message}`);
      console.log(`     code=${e.code} detail=${e.detail}`);
    }
  }

  await sql.end();
  console.log("\n✅ Done.");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
