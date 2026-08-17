# Data Migration: MySQL to PostgreSQL

*Status: Completed*

This document serves as a historical reference for the migration of Structr.ai from MySQL to PostgreSQL (Supabase).

## Rationale

The migration was performed to consolidate the database infrastructure around Supabase, which already hosted the Master Price Book data. This unifies the tech stack, simplifies deployment, and leverages PostgreSQL's superior JSON handling (`jsonb`) and connection pooling.

## Technical Changes Made

1. **Schema Definitions (`drizzle/schema.ts`)**:
   - `mysqlTable` → `pgTable`
   - `mysqlEnum` → `pgEnum`
   - `int` → `serial` or `integer`
   - `decimal` → `numeric`
   - `json` → `jsonb`
   - Removed `.onUpdateNow()` (requires manual updates or PG triggers).

2. **Database Driver (`server/db.ts`)**:
   - Replaced `mysql2/promise` with `postgres`.
   - Replaced `MySql2Database` with `PostgresJsDatabase`.
   - Replaced `.onDuplicateKeyUpdate()` with `.onConflictDoUpdate()`.

3. **Query Syntax**:
   - Replaced MySQL's `.$returningId()` with PostgreSQL's `.returning({ id: table.id })` across all `server/*-db.ts` files.

4. **Configuration**:
   - Updated `drizzle.config.ts` dialect to `postgresql`.
   - Updated `.env.example` to use the `postgresql://` format.

## Future Considerations

- **Integrity**: The schema currently lacks explicit `references()` (Foreign Keys) and indexes. Phase 2 of the stabilization plan will introduce these to ensure relational integrity.
- **Timestamps**: Since PostgreSQL does not have MySQL's `ON UPDATE CURRENT_TIMESTAMP`, `updatedAt` fields must be handled explicitly in application logic or via database triggers.
