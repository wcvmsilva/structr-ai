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

/** List all override rules, optionally filtered by zoneId and/or active status */
export async function listOverrideRules(opts?: {
  zoneId?: string;
  activeOnly?: boolean;
}): Promise<GeographicOverride[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts?.zoneId) {
    conditions.push(eq(geographicOverrides.zoneId, opts.zoneId));
  }
  if (opts?.activeOnly !== false) {
    conditions.push(eq(geographicOverrides.isActive, true));
  }

  if (conditions.length === 0) {
    return db.select().from(geographicOverrides).orderBy(geographicOverrides.overrideType);
  }

  return db
    .select()
    .from(geographicOverrides)
    .where(and(...conditions))
    .orderBy(geographicOverrides.overrideType);
}

/** Get a single override rule by ID */
export async function getOverrideRuleById(id: string): Promise<GeographicOverride | null> {
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

  const result = await db.insert(geographicOverrides).values(data).returning();
  const created = result[0];

  await logAudit({
    userId: null,
    action: "geo_override.create",
    tableName: "geographic_overrides",
    recordId: created.id,
    after: {
      zoneId: data.zoneId,
      assemblyId: data.assemblyId,
      costCodeId: data.costCodeId,
      overrideType: data.overrideType,
      overrideValue: data.overrideValue,
      reason: data.reason,
      isActive: data.isActive,
      operatorId,
    },
  });

  return created;
}

/** Update an existing override rule */
export async function updateOverrideRule(
  id: string,
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
  id: string,
  operatorId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(geographicOverrides)
    .set({ isActive: false })
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
  id: string,
  operatorId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(geographicOverrides)
    .set({ isActive: true })
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
  scopeDraftId: string
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
      operatorId,
    },
  });

  return entries.length;
}

/** Check if overrides have already been applied to a scope draft */
export async function hasOverridesApplied(scopeDraftId: string): Promise<boolean> {
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
  scopeDraftId: string,
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

/** Get override rule counts grouped by zoneId */
export async function getOverrideCountsByZoneId(): Promise<
  { zoneId: string | null; count: number }[]
> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      zoneId: geographicOverrides.zoneId,
      count: sql<number>`count(*)`,
    })
    .from(geographicOverrides)
    .where(eq(geographicOverrides.isActive, true))
    .groupBy(geographicOverrides.zoneId)
    .orderBy(desc(sql`count(*)`));

  return rows;
}

// ══════════════════════════════════════════════════════════════════════
// COMPATIBILITY ALIASES (old function names for router compatibility)
// ══════════════════════════════════════════════════════════════════════
export const getOverrideCountsByZone = getOverrideCountsByZoneId;
