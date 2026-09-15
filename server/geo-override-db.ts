/**
 * structr.ai Construction Brain — Geographic Override DB Helpers
 * Sprint 16: Coastal Override Resolver
 *
 * CRUD for geographic_overrides and scope_override_log tables.
 * All mutations log to centralized audit trail.
 */

import { eq, and, desc, sql, type SQL } from "drizzle-orm";
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
import { TenantScopeError } from "./tenant-scope";
import type { OverrideRule } from "../shared/geo-override-engine";

export type OverrideRuleCreateData = Omit<
  InsertGeographicOverride,
  "id" | "tenantId" | "createdAt" | "updatedAt"
>;

export type OverrideRulePatch = Partial<Pick<
  OverrideRule,
  "zone" | "trade" | "finishLevel" | "originalAssemblyId" |
  "replacementAssemblyId" | "overrideType" | "reasonTemplate"
>> & { isActive?: boolean };

type OverrideDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type OverrideTx = Parameters<Parameters<OverrideDb["transaction"]>[0]>[0];
type OverrideHandle = OverrideDb | OverrideTx;
type OverrideWriteAction =
  | "geo_override.update"
  | "geo_override.deactivate"
  | "geo_override.reactivate";

const CREATE_FIELDS = [
  "zoneId", "assemblyId", "costCodeId", "overrideType", "overrideValue", "reason",
  "zone", "trade", "finishLevel", "reasonTemplate", "originalAssemblyId",
  "replacementAssemblyId", "isActive",
] as const satisfies readonly (keyof OverrideRuleCreateData)[];

const UPDATE_FIELDS = [
  "zone", "trade", "finishLevel", "originalAssemblyId", "replacementAssemblyId",
  "overrideType", "reasonTemplate", "isActive",
] as const satisfies readonly (keyof OverrideRulePatch)[];

function pickDefined<T extends object, K extends keyof T>(data: T, keys: readonly K[]): Pick<T, K> {
  const clean = {} as Pick<T, K>;
  for (const key of keys) {
    if (data[key] !== undefined) clean[key] = data[key];
  }
  return clean;
}

function requireOverrideTenant(tenantId: unknown, operation: string): string {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new TenantScopeError(operation);
  }
  return tenantId.toLowerCase();
}

// G2-1 CRUD uses strict ownership in both global TENANT_STRICT modes.
// List, aggregate and log helpers retain their separate, still-open contracts.
function overrideRuleWhere(owner: string, id: string): SQL {
  return and(eq(geographicOverrides.tenantId, owner), eq(geographicOverrides.id, id))!;
}

async function loadRuleInTenant(
  handle: OverrideHandle,
  owner: string,
  id: string,
  lockForUpdate: boolean,
): Promise<GeographicOverride | null> {
  const query = handle.select().from(geographicOverrides)
    .where(overrideRuleWhere(owner, id)).limit(1);
  const rows = lockForUpdate ? await query.for("update") : await query;
  const row = rows[0];
  if (!row || typeof row.id !== "string" || row.id.toLowerCase() !== id ||
      typeof row.tenantId !== "string" || row.tenantId.toLowerCase() !== owner) {
    return null;
  }
  return row;
}

class OverrideWriteVerificationError extends Error {
  constructor() {
    super("Override rule write could not be verified");
    this.name = "OverrideWriteVerificationError";
  }
}

async function changeRuleInTenant(
  tenantId: string,
  ruleId: string,
  data: OverrideRulePatch,
  operatorId: string,
  action: OverrideWriteAction,
): Promise<GeographicOverride | null> {
  const owner = requireOverrideTenant(tenantId, action);
  const id = ruleId.toLowerCase();
  const clean = pickDefined(data, UPDATE_FIELDS);
  const db = await getDb();
  if (!db) return null;

  const result = await db.transaction(async tx => {
    // Lock before capturing the snapshot so another writer cannot change it
    // between this authorization read and our UPDATE.
    const before = await loadRuleInTenant(tx, owner, id, true);
    if (!before) throw new OverrideWriteVerificationError();
    if (Object.keys(clean).length === 0) {
      return { before, after: before, didWrite: false };
    }

    const ids = await tx.update(geographicOverrides).set(clean)
      .where(overrideRuleWhere(owner, id)).returning({ id: geographicOverrides.id });
    if (ids.length !== 1 || typeof ids[0]?.id !== "string" || ids[0].id.toLowerCase() !== id) {
      throw new OverrideWriteVerificationError();
    }

    const after = await loadRuleInTenant(tx, owner, id, false);
    if (!after || (clean.isActive !== undefined && after.isActive !== clean.isActive)) {
      throw new OverrideWriteVerificationError();
    }
    return { before, after, didWrite: true };
  }).catch(error => {
    if (error instanceof OverrideWriteVerificationError) return null;
    throw error;
  });

  if (!result) return null;
  if (result.didWrite) {
    // Await audit after commit. A null audit result remains unconfirmed; an
    // unexpected throw may escape after the business change has committed.
    await logAudit({
      userId: null,
      action,
      tableName: "geographic_overrides",
      recordId: result.after.id,
      before: result.before,
      after: { ...result.after, operatorId },
    });
  }
  return result.after;
}

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

/** Get an active or inactive rule owned by the caller's tenant. */
export async function getOverrideRuleById(tenantId: string, id: string): Promise<GeographicOverride | null> {
  const owner = requireOverrideTenant(tenantId, "getOverrideRuleById");
  const ruleId = id.toLowerCase();
  const db = await getDb();
  if (!db) return null;
  return loadRuleInTenant(db, owner, ruleId, false);
}

/** Create a new override rule */
export async function createOverrideRule(
  tenantId: string,
  data: OverrideRuleCreateData,
  operatorId: string
): Promise<GeographicOverride> {
  const owner = requireOverrideTenant(tenantId, "createOverrideRule");
  const clean = pickDefined(data, CREATE_FIELDS);
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const created = await db.transaction(async tx => {
    const ids = await tx.insert(geographicOverrides)
      .values({ ...clean, tenantId: owner }).returning({ id: geographicOverrides.id });
    if (ids.length !== 1 || typeof ids[0]?.id !== "string" || !ids[0].id) {
      throw new OverrideWriteVerificationError();
    }
    const row = await loadRuleInTenant(tx, owner, ids[0].id.toLowerCase(), false);
    if (!row) throw new OverrideWriteVerificationError();
    return row;
  });

  // The row is committed before this awaited, separately persisted audit.
  await logAudit({
    userId: null,
    action: "geo_override.create",
    tableName: "geographic_overrides",
    recordId: created.id,
    after: { ...created, operatorId },
  });

  return created;
}

/** Update an existing override rule */
export async function updateOverrideRule(
  tenantId: string,
  id: string,
  data: OverrideRulePatch,
  operatorId: string
): Promise<GeographicOverride | null> {
  return changeRuleInTenant(tenantId, id, data, operatorId, "geo_override.update");
}

/** Deactivate an override rule (soft delete) */
export async function deactivateOverrideRule(
  tenantId: string,
  id: string,
  operatorId: string
): Promise<boolean> {
  const row = await changeRuleInTenant(tenantId, id, { isActive: false }, operatorId, "geo_override.deactivate");
  return row !== null;
}

/** Reactivate an override rule */
export async function reactivateOverrideRule(
  tenantId: string,
  id: string,
  operatorId: string
): Promise<boolean> {
  const row = await changeRuleInTenant(tenantId, id, { isActive: true }, operatorId, "geo_override.reactivate");
  return row !== null;
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
