#!/usr/bin/env node
/**
 * Diagnostic script: Inspect real Supabase schema, RLS policies, and triggers.
 * Run from project root: node scripts/diag-schema.mjs
 */
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres.xoqhxpqsfxpdiwyuvhdd:P2Y0YYht236BpWuR@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

const sql = postgres(DATABASE_URL, { prepare: false });

async function main() {
  console.log("=".repeat(70));
  console.log("STRUCTR.AI — FULL SCHEMA + RLS + TRIGGER DIAGNOSTIC");
  console.log("=".repeat(70));

  // Check current role
  const roleCheck = await sql`SELECT current_user, current_role, session_user`;
  console.log("\nCurrent role:", JSON.stringify(roleCheck[0]));

  // Check auth.uid() availability
  try {
    const authCheck = await sql`SELECT auth.uid() as uid`;
    console.log("auth.uid():", authCheck[0]?.uid ?? "NULL");
  } catch (e) {
    console.log("auth.uid(): NOT AVAILABLE or errored:", e.message);
  }

  const tables = ["leads", "profiles", "clients", "projects", "deals", "lead_activities"];

  for (const table of tables) {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`TABLE: ${table}`);
    console.log(`${"═".repeat(70)}`);

    // Check if table exists
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY ordinal_position
    `;

    if (cols.length === 0) {
      console.log(`  ⚠️  TABLE DOES NOT EXIST`);
      continue;
    }

    // Columns
    console.log("\n  COLUMNS:");
    for (const c of cols) {
      const nullable = c.is_nullable === "YES" ? "NULL" : "NOT NULL";
      const def = c.column_default ? ` DEFAULT ${c.column_default}` : "";
      console.log(`    ${c.column_name.padEnd(25)} ${c.udt_name.padEnd(12)} ${nullable}${def}`);
    }

    // Constraints
    const constraints = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = ${`public.${table}`}::regclass
      ORDER BY contype
    `.catch(() => []);

    if (constraints.length > 0) {
      console.log("\n  CONSTRAINTS:");
      for (const c of constraints) {
        const typeLabel = { p: "PK", f: "FK", u: "UNIQUE", c: "CHECK" }[c.contype] || c.contype;
        console.log(`    [${typeLabel}] ${c.conname}: ${c.definition}`);
      }
    }

    // RLS status
    const rls = await sql`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = ${`public.${table}`}::regclass
    `.catch(() => []);

    if (rls.length > 0) {
      const enabled = rls[0].relrowsecurity ? "ENABLED" : "DISABLED";
      const forced = rls[0].relforcerowsecurity ? " + FORCE" : "";
      console.log(`\n  RLS: ${enabled}${forced}`);
    }

    // RLS policies
    const policies = await sql`
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ${table}
    `.catch(() => []);

    if (policies.length > 0) {
      console.log("\n  RLS POLICIES:");
      for (const p of policies) {
        console.log(`    [${p.cmd}] ${p.policyname} (${p.permissive})`);
        console.log(`      roles: ${p.roles}`);
        if (p.qual) console.log(`      USING: ${p.qual}`);
        if (p.with_check) console.log(`      WITH CHECK: ${p.with_check}`);
      }
    }

    // Triggers
    const triggers = await sql`
      SELECT tgname, pg_get_triggerdef(oid) as definition
      FROM pg_trigger
      WHERE tgrelid = ${`public.${table}`}::regclass AND NOT tgisinternal
    `.catch(() => []);

    if (triggers.length > 0) {
      console.log("\n  TRIGGERS:");
      for (const t of triggers) {
        console.log(`    ${t.tgname}: ${t.definition}`);
      }
    }
  }

  // Dev user check
  console.log(`\n${"═".repeat(70)}`);
  console.log("DEV USER CHECK");
  console.log(`${"═".repeat(70)}`);
  const devUser = await sql`SELECT id, full_name, role FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001' LIMIT 1`;
  if (devUser.length > 0) {
    console.log(`  ✅ Dev user exists:`, devUser[0]);
  } else {
    console.log(`  ❌ Dev user NOT FOUND in profiles table`);
    const allProfiles = await sql`SELECT id, full_name FROM profiles LIMIT 5`;
    console.log(`  Existing profiles:`, allProfiles.length > 0 ? allProfiles : "NONE");
  }

  // Test insert with SET LOCAL role bypass
  console.log(`\n${"═".repeat(70)}`);
  console.log("TEST: INSERT WITH ROLE BYPASS");
  console.log(`${"═".repeat(70)}`);
  try {
    const result = await sql.begin(async (tx) => {
      await tx`SET LOCAL role = 'postgres'`;
      const [row] = await tx`
        INSERT INTO leads (name, address, source, service_type, urgency, lead_score, status)
        VALUES ('__DIAG_TEST__', '', 'website', 'general', 'low', 0, 'new')
        RETURNING id
      `;
      // Rollback by throwing — we don't want to keep test data
      console.log(`  ✅ INSERT succeeded with id=${row.id}`);
      console.log(`  Rolling back test row...`);
      throw new Error("__ROLLBACK__");
    });
  } catch (e) {
    if (e.message === "__ROLLBACK__") {
      console.log(`  ✅ Test row rolled back. INSERT WORKS with role bypass.`);
    } else {
      console.log(`  ❌ INSERT FAILED even with role bypass: ${e.message}`);
      console.log(`     code=${e.code} detail=${e.detail} constraint=${e.constraint}`);
    }
  }

  // Test insert WITHOUT role bypass
  console.log(`\n${"═".repeat(70)}`);
  console.log("TEST: INSERT WITHOUT ROLE BYPASS (default role)");
  console.log(`${"═".repeat(70)}`);
  try {
    const result = await sql.begin(async (tx) => {
      // No SET LOCAL role — this uses the default connection role
      const [row] = await tx`
        INSERT INTO leads (name, address, source, service_type, urgency, lead_score, status)
        VALUES ('__DIAG_TEST_NO_BYPASS__', '', 'website', 'general', 'low', 0, 'new')
        RETURNING id
      `;
      console.log(`  ✅ INSERT succeeded WITHOUT bypass (RLS not blocking) id=${row.id}`);
      throw new Error("__ROLLBACK__");
    });
  } catch (e) {
    if (e.message === "__ROLLBACK__") {
      console.log(`  ✅ Test row rolled back. INSERT WORKS without bypass too.`);
    } else {
      console.log(`  ❌ INSERT FAILED without bypass: ${e.message}`);
      console.log(`     code=${e.code} detail=${e.detail}`);
      console.log(`     ^^^ THIS IS THE ROOT CAUSE — RLS blocks inserts without auth context`);
    }
  }

  await sql.end();
  console.log("\n✅ Diagnostic complete.");
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
