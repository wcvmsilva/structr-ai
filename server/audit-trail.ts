/**
 * structr.ai — PHASE 4 Audit Trail (canonical)
 *
 * Contract: docs/phase4-contract.md §7 (AU-001 … AU-003)
 *
 * Writes to `audit_log`, the tenant-scoped append-only table introduced by migration 0004.
 *
 * Why a second module next to `server/audit.ts`: the legacy `audit_logs` table has no tenant and
 * no entity taxonomy. Once a second GC is on the platform, "who changed this price" must be
 * answerable *within a tenant*, and a legacy row with `tenant_id = NULL` cannot answer it.
 * Backfilling a tenant into historical rows would fabricate evidence, so the old table is kept
 * readable as history and every new act of consequence is recorded here.
 *
 * Design rules:
 *   - AU-002: never update, never delete. The database enforces it with a trigger; this module
 *     simply has no code path that would try.
 *   - AU-002: money and permission acts carry both snapshots plus a computed field-level diff.
 *   - Audit failures NEVER break the business operation. A price adjustment that succeeded but
 *     failed to log is a problem; a price adjustment rolled back because the log was unavailable
 *     is a worse one. Failures are logged loudly and swallowed.
 */

import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { auditLog, type AuditLogEntry } from "../drizzle/schema";
import {
  normalizeAuditEntityType,
  requiresAuditSnapshots,
  type AuditAction,
  type AuditEntityType,
} from "@shared/domain/phase4-taxonomy";
import { tenantWhere } from "./tenant-scope";

// ══════════════════════════════════════════════════════════════════════
// DIFF
// ══════════════════════════════════════════════════════════════════════

/**
 * Field-level diff between two snapshots.
 *
 * Stored alongside the snapshots rather than derived on read because the shape of a row changes
 * across releases: a diff computed today against a schema from two years ago would be wrong in
 * exactly the situation where the trail matters most.
 */
export function computeChangedFields(
  before: unknown,
  after: unknown,
): Array<{ field: string; before: unknown; after: unknown }> {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  if (!isObject(before) || !isObject(after)) {
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      changes.push({ field: "(value)", before: before ?? null, after: after ?? null });
    }
    return changes;
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  // Volatile bookkeeping columns are excluded: every row would otherwise report a change.
  const ignored = new Set(["updatedAt", "updated_at", "createdAt", "created_at"]);

  for (const key of Array.from(keys).sort()) {
    if (ignored.has(key)) continue;
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) {
      changes.push({ field: key, before: b ?? null, after: a ?? null });
    }
  }

  return changes;
}

// ══════════════════════════════════════════════════════════════════════
// WRITE
// ══════════════════════════════════════════════════════════════════════

export interface AuditTrailParams {
  tenantId?: string | null;
  userId?: string | null;
  userLabel?: string | null;
  entityType: AuditEntityType | string;
  entityId?: string | null;
  /** Business key when the entity has no uuid (a cost code string, a feature flag name). */
  entityKey?: string | null;
  action: AuditAction | string;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Money moved or committed by this act, in integer cents. */
  amountCents?: number | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditTrailWarning {
  code: "MISSING_SNAPSHOTS" | "UNKNOWN_ENTITY_TYPE" | "ENTITY_NOT_IDENTIFIED";
  message: string;
}

/**
 * Validate an audit entry before writing (AU-001, AU-002, AU-003).
 *
 * Returns warnings instead of throwing: refusing to record an act because its metadata is
 * imperfect would leave no trace at all, which is strictly worse than an imperfect trace.
 */
export function validateAuditEntry(params: AuditTrailParams): AuditTrailWarning[] {
  const warnings: AuditTrailWarning[] = [];

  if (!normalizeAuditEntityType(params.entityType)) {
    warnings.push({
      code: "UNKNOWN_ENTITY_TYPE",
      message: `Entity type "${params.entityType}" is outside the audit taxonomy.`,
    });
  }

  if (!params.entityId && !params.entityKey) {
    warnings.push({
      code: "ENTITY_NOT_IDENTIFIED",
      message: "Audit entry identifies no entity (neither uuid nor business key).",
    });
  }

  if (requiresAuditSnapshots(String(params.action))) {
    if (params.before == null || params.after == null) {
      warnings.push({
        code: "MISSING_SNAPSHOTS",
        message: `Action ${params.action} moves money or permissions and must carry both before and after snapshots.`,
      });
    }
  }

  return warnings;
}

/**
 * Append an entry to the canonical audit trail.
 *
 * Never throws. Returns null when the database is unavailable or the write fails.
 */
export async function recordAudit(
  params: AuditTrailParams,
): Promise<AuditLogEntry | null> {
  const warnings = validateAuditEntry(params);
  for (const w of warnings) {
    console.warn(`[AuditTrail] ${w.code}: ${w.message}`);
  }

  const db = await getDb();
  if (!db) {
    console.warn("[AuditTrail] Database not available; audit entry dropped:", params.action);
    return null;
  }

  const entityType = normalizeAuditEntityType(params.entityType) ?? String(params.entityType);

  try {
    const changedFields =
      params.before !== undefined || params.after !== undefined
        ? computeChangedFields(params.before, params.after)
        : null;

    const [entry] = await db
      .insert(auditLog)
      .values({
        tenantId: params.tenantId ?? null,
        userId: params.userId ?? null,
        userLabel: params.userLabel ?? null,
        entityType,
        entityId: params.entityId ?? null,
        entityKey: params.entityKey ?? null,
        action: String(params.action),
        projectId: params.projectId ?? null,
        beforeSnapshot: (params.before ?? null) as never,
        afterSnapshot: (params.after ?? null) as never,
        changedFields: (changedFields ?? null) as never,
        amountCents: params.amountCents ?? null,
        reason: params.reason ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        requestId: params.requestId ?? null,
        metadata: (params.metadata ?? null) as never,
      })
      .returning();

    return entry ?? null;
  } catch (error) {
    console.error("[AuditTrail] Failed to append audit entry:", error);
    return null;
  }
}

/**
 * Fire-and-forget variant for use inside business mutations.
 * The `.catch` is deliberate and matches the Phase 1–3 convention.
 */
export function recordAuditAsync(params: AuditTrailParams): void {
  recordAudit(params).catch(err =>
    console.error("[AuditTrail] Background append failed:", err),
  );
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

export interface ListAuditTrailOptions {
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  entityType?: string;
  entityId?: string;
  entityKey?: string;
  action?: string;
  userId?: string;
  projectId?: string;
  /** ISO date-time, inclusive. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Query the audit trail, always tenant-scoped.
 *
 * `tenantId` is a first-class parameter rather than an optional filter: a cross-tenant audit
 * query is not a feature, it is a data leak with a nice UI.
 */
export async function listAuditTrail(
  options: ListAuditTrailOptions,
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };

  const conditions: Array<SQL | undefined> = [];
  if (options.entityType) {
    const normalized = normalizeAuditEntityType(options.entityType) ?? options.entityType;
    conditions.push(eq(auditLog.entityType, normalized));
  }
  if (options.entityId) conditions.push(eq(auditLog.entityId, options.entityId));
  if (options.entityKey) conditions.push(eq(auditLog.entityKey, options.entityKey));
  if (options.action) conditions.push(eq(auditLog.action, options.action));
  if (options.userId) conditions.push(eq(auditLog.userId, options.userId));
  if (options.projectId) conditions.push(eq(auditLog.projectId, options.projectId));
  if (options.from) conditions.push(gte(auditLog.createdAt, new Date(options.from)));
  if (options.to) conditions.push(lte(auditLog.createdAt, new Date(options.to)));

  const where = tenantWhere(auditLog, options.tenantId, ...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(auditLog)
    .where(where);

  const entries = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(options.limit ?? 50, 500))
    .offset(options.offset ?? 0);

  return { entries, total: countRow?.count ?? 0 };
}

/** Full history of one entity, oldest first — the shape a dispute actually needs. */
export async function getEntityHistory(input: {
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  entityType: string;
  entityId: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const db = await getDb();
  if (!db) return [];

  const entityType = normalizeAuditEntityType(input.entityType) ?? input.entityType;
  const where = tenantWhere(
    auditLog,
    input.tenantId,
    eq(auditLog.entityType, entityType),
    eq(auditLog.entityId, input.entityId),
  );

  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(auditLog.createdAt)
    .limit(Math.min(input.limit ?? 200, 1000));

  return rows;
}

/** Everything that happened on a project, newest first. */
export async function getProjectAuditTrail(input: {
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  projectId: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const db = await getDb();
  if (!db) return [];

  const where = tenantWhere(auditLog, input.tenantId, eq(auditLog.projectId, input.projectId));

  return db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(input.limit ?? 200, 1000));
}

export interface AuditTrailStats {
  totalEntries: number;
  byAction: Array<{ action: string; count: number }>;
  byEntityType: Array<{ entityType: string; count: number }>;
  /** Total money touched by audited acts in the window, in cents. */
  totalAmountCents: number;
}

/** Aggregate counts for the compliance view. */
export async function getAuditTrailStats(options: {
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  from?: string;
  to?: string;
}): Promise<AuditTrailStats> {
  const db = await getDb();
  if (!db) {
    return { totalEntries: 0, byAction: [], byEntityType: [], totalAmountCents: 0 };
  }

  const conditions: Array<SQL | undefined> = [];
  if (options.from) conditions.push(gte(auditLog.createdAt, new Date(options.from)));
  if (options.to) conditions.push(lte(auditLog.createdAt, new Date(options.to)));
  const where = tenantWhere(auditLog, options.tenantId, ...conditions);

  const [totals] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      amount: sql<number>`COALESCE(SUM(${auditLog.amountCents}), 0)::int`,
    })
    .from(auditLog)
    .where(where);

  const byAction = await db
    .select({ action: auditLog.action, count: sql<number>`COUNT(*)::int` })
    .from(auditLog)
    .where(where)
    .groupBy(auditLog.action)
    .orderBy(desc(sql`COUNT(*)`));

  const byEntityType = await db
    .select({ entityType: auditLog.entityType, count: sql<number>`COUNT(*)::int` })
    .from(auditLog)
    .where(where)
    .groupBy(auditLog.entityType)
    .orderBy(desc(sql`COUNT(*)`));

  return {
    totalEntries: totals?.count ?? 0,
    byAction: byAction.map(r => ({ action: r.action, count: r.count })),
    byEntityType: byEntityType.map(r => ({ entityType: r.entityType, count: r.count })),
    totalAmountCents: totals?.amount ?? 0,
  };
}

/**
 * Wrap a mutation so the act is recorded with both snapshots.
 *
 * The audit write happens after the mutation succeeds and never blocks its result.
 */
export async function withAuditTrail<T extends { id?: string }>(
  params: Omit<AuditTrailParams, "before" | "after" | "entityId">,
  beforeSnapshot: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const result = await fn();

  recordAuditAsync({
    ...params,
    entityId: result?.id ?? null,
    before: beforeSnapshot,
    after: result,
  });

  return result;
}
