/**
 * structr.ai Construction Brain — Geographic Override DB Helpers
 * Sprint 16: Coastal Override Resolver
 *
 * CRUD for geographic_overrides and scope_override_log tables.
 * All mutations log to centralized audit trail.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  geographicOverrides,
  scopeOverrideLog,
  type GeographicOverride,
  type InsertGeographicOverride,
  type ScopeOverrideLogEntry,
  type InsertScopeOverrideLogEntry,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// GEOGRAPHIC OVERRIDES — CRUD
// ══════════════════════════════════════════════════════════════════════

/** List all override rules, optionally filtered by zone and/or active status */
export async function listOverrideRules(opts?: {
  zone?: string;
  trade?: string;
  activeOnly?: boolean;
}): Promise<GeographicOverride[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts?.zone) {
    conditions.push(eq(geographicOverrides.zone, opts.zone));
  }
  if (opts?.trade) {
    conditions.push(eq(geographicOverrides.trade, opts.trade));
  }
  if (opts?.activeOnly !== false) {
    conditions.push(eq(geographicOverrides.active, true));
  }

  if (conditions.length === 0) {
    return db.select().from(geographicOverrides).orderBy(geographicOverrides.zone, geographicOverrides.trade);
  }

  return db
    .select()
    .from(geographicOverrides)
    .where(and(...conditions))
    .orderBy(geographicOverrides.zone, geographicOverrides.trade);
}

/** Get a single override rule by ID */
export async function getOverrideRuleById(id: number): Promise<GeographicOverride | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(geographicOverrides)
    .where(eq(geographicOverrides.id, id))
    .limit(1);

  return rows[0] ?? null;
}

/** Create a new override rule */
export async function createOverrideRule(
  data: Omit<InsertGeographicOverride, "id" | "createdAt" | "updatedAt">,
  operatorId: string
): Promise<GeographicOverride> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(geographicOverrides).values(data);
  const insertId = result[0].insertId;

  await logAudit({
    userId: null,
    action: "geo_override.create",
    tableName: "geographic_overrides",
    recordId: insertId,
    after: {
      zone: data.zone,
      trade: data.trade,
      overrideType: data.overrideType,
      originalAssemblyId: data.originalAssemblyId,
      replacementAssemblyId: data.replacementAssemblyId,
      operatorId,
    },
  });

  const created = await getOverrideRuleById(insertId);
  return created!;
}

/** Update an existing override rule */
export async function updateOverrideRule(
  id: number,
  data: Partial<Omit<InsertGeographicOverride, "id" | "createdAt">>,
  operatorId: string
): Promise<GeographicOverride | null> {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(geographicOverrides)
    .set(data)
    .where(eq(geographicOverrides.id, id));

  await logAudit({
    userId: null,
    action: "geo_override.update",
    tableName: "geographic_overrides",
    recordId: id,
    after: { ...data, operatorId },
  });

  return getOverrideRuleById(id);
}

/** Deactivate an override rule (soft delete) */
export async function deactivateOverrideRule(
  id: number,
  operatorId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(geographicOverrides)
    .set({ active: false })
    .where(eq(geographicOverrides.id, id));

  await logAudit({
    userId: null,
    action: "geo_override.deactivate",
    tableName: "geographic_overrides",
    recordId: id,
    after: { operatorId },
  });

  return true;
}

/** Reactivate an override rule */
export async function reactivateOverrideRule(
  id: number,
  operatorId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(geographicOverrides)
    .set({ active: true })
    .where(eq(geographicOverrides.id, id));

  await logAudit({
    userId: null,
    action: "geo_override.reactivate",
    tableName: "geographic_overrides",
    recordId: id,
    after: { operatorId },
  });

  return true;
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE OVERRIDE LOG — QUERIES & WRITES
// ══════════════════════════════════════════════════════════════════════

/** Get all override log entries for a scope draft */
export async function getOverrideLogForDraft(
  scopeDraftId: number
): Promise<ScopeOverrideLogEntry[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(scopeOverrideLog)
    .where(eq(scopeOverrideLog.scopeDraftId, scopeDraftId))
    .orderBy(desc(scopeOverrideLog.createdAt));
}

/** Write override log entries (batch insert) */
export async function writeOverrideLogEntries(
  entries: Omit<InsertScopeOverrideLogEntry, "id" | "createdAt">[],
  operatorId: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (entries.length === 0) return 0;

  await db.insert(scopeOverrideLog).values(entries);

  // Log a single audit event for the batch
  const scopeDraftId = entries[0].scopeDraftId;
  await logAudit({
    userId: null,
    action: "geo_override.resolve",
    tableName: "scope_override_log",
    recordId: scopeDraftId,
    after: {
      entriesWritten: entries.length,
      overrideTypes: entries.map((e) => e.overrideType),
      operatorId,
    },
  });

  return entries.length;
}

/** Check if overrides have already been applied to a scope draft */
export async function hasOverridesApplied(scopeDraftId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(scopeOverrideLog)
    .where(eq(scopeOverrideLog.scopeDraftId, scopeDraftId));

  return (rows[0]?.count ?? 0) > 0;
}

/** Delete override log entries for a scope draft (for reversal) */
export async function clearOverrideLogForDraft(
  scopeDraftId: number,
  operatorId: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Count before delete
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(scopeOverrideLog)
    .where(eq(scopeOverrideLog.scopeDraftId, scopeDraftId));

  const count = countRows[0]?.count ?? 0;

  if (count > 0) {
    await db
      .delete(scopeOverrideLog)
      .where(eq(scopeOverrideLog.scopeDraftId, scopeDraftId));

    await logAudit({
      userId: null,
      action: "geo_override.clear",
      tableName: "scope_override_log",
      recordId: scopeDraftId,
      after: { entriesCleared: count, operatorId },
    });
  }

  return count;
}

// ══════════════════════════════════════════════════════════════════════
// STATISTICS
// ══════════════════════════════════════════════════════════════════════

/** Get override rule counts grouped by zone */
export async function getOverrideCountsByZone(): Promise<
  { zone: string; count: number }[]
> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      zone: geographicOverrides.zone,
      count: sql<number>`count(*)`,
    })
    .from(geographicOverrides)
    .where(eq(geographicOverrides.active, true))
    .groupBy(geographicOverrides.zone)
    .orderBy(desc(sql`count(*)`));

  return rows;
}
