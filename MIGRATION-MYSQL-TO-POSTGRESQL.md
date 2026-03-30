# Structr.ai — MySQL to PostgreSQL Migration Guide

## What Changed

The entire Structr.ai application has been migrated from **MySQL (mysql2)** to **PostgreSQL (postgres.js)** to connect directly to the existing **Supabase** database where the Master Price Book data already lives.

### Files Modified

| Category | Files | Changes |
|----------|-------|---------|
| **Schema** | `drizzle/schema.ts` | `mysqlTable` → `pgTable`, `mysqlEnum` → `pgEnum`, `int` → `serial`/`integer`, `decimal` → `numeric`, `json` → `jsonb`, removed `.onUpdateNow()` |
| **Database Driver** | `server/db.ts` | `mysql2/promise` → `postgres`, `MySql2Database` → `PostgresJsDatabase`, `onDuplicateKeyUpdate` → `onConflictDoUpdate` |
| **Config** | `drizzle.config.ts` | `dialect: "mysql"` → `dialect: "postgresql"` |
| **Package** | `package.json` | `mysql2` → `postgres` |
| **Environment** | `.env` | Updated `DATABASE_URL` for Supabase |
| **Server DB Files** (13) | `server/*-db.ts`, `server/audit.ts` | `.$returningId()` → `.returning({ id: table.id })` |
| **Seed Scripts** (5) | `seed-*.mjs` | `mysql2/promise` → `postgres` tagged templates |
| **Utility Scripts** (8) | `scripts/*.mjs` | Same driver swap |
| **Test Files** (3) | `server/sprint*.test.ts` | Schema assertion strings updated |
| **Debug** | `debug-db.ts` | Driver swap |

---

## Steps to Complete the Migration

### Step 1: Get Your Supabase Database Password

1. Go to https://supabase.com/dashboard
2. Open your project: `xoqhxpqsfxpdiwyuvhdd`
3. Navigate to **Settings** → **Database**
4. Copy the **database password** (or reset it if you forgot)

### Step 2: Update `.env`

Open `.env` and replace `YOUR_PASSWORD` with your actual Supabase password:

```
DATABASE_URL=postgresql://postgres.xoqhxpqsfxpdiwyuvhdd:YOUR_ACTUAL_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### Step 3: Install Dependencies

```bash
cd structr-ai
pnpm install
```

This will install the `postgres` package (replacing `mysql2`).

### Step 4: Push Schema to Supabase

```bash
pnpm db:push
```

This uses Drizzle Kit to create/sync all 50+ tables in your Supabase database.

> **Note:** Some tables already exist in Supabase (assemblies, bundles, etc.) from the original data. Drizzle will try to reconcile them. If there are conflicts, you may need to use `--force` flag or manually resolve in the Supabase SQL editor.

### Step 5: Verify Connection

```bash
pnpm dev
```

Open http://localhost:5002 and check if the dashboard connects to the database.

### Step 6: Seed Data (if needed)

If the catalog is still empty after connecting, you can run:

```bash
pnpm seed:all
```

This requires the JobTread CSV file. If you don't have it, the existing Supabase data in the `cost_codes` table should be accessible once the schema is reconciled.

---

## Important Notes

### PostgreSQL vs MySQL Differences

1. **No `ON UPDATE CURRENT_TIMESTAMP`**: PostgreSQL doesn't have MySQL's automatic timestamp update. The `updatedAt` columns will need to be updated manually in application code or via PostgreSQL triggers.

2. **Enum Types**: All enums are now defined as PostgreSQL ENUM types at the database level (via `pgEnum`). Shared enums like `channel`, `finish_level`, and `severity` are reused across tables.

3. **JSONB instead of JSON**: All JSON columns now use `jsonb` which supports indexing and better query performance in PostgreSQL.

4. **Serial vs Auto-increment**: Primary keys use PostgreSQL `serial` type instead of MySQL `int autoincrement`.

5. **Returning Clause**: Insert operations now use `.returning()` instead of `.$returningId()`.

### Supabase-Specific

- The connection uses Supabase's **connection pooler** (port 6543) for better performance
- Row Level Security (RLS) may need to be configured for new tables
- The app's RBAC middleware (protectedProcedure) provides application-level security

---

## Rollback Plan

If the migration fails, the original MySQL code is preserved in git history. You can:

```bash
git stash   # save any local changes
git checkout HEAD~1 -- .  # revert all files to previous commit
```
