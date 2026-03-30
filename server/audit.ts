/**
 * structr.ai — Audit Logging Module
 * Aligned with Supabase schema (source of truth)
 *
 * Schema: audit_logs (id, user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent, created_at)
 *
 * Provides:
 *   - logAudit(params)  → records action with before/after snapshots
 *   - listAuditLogs(opts) → paginated query with filters
 *   - withAuditLog(ctx, params, fn) → wraps a mutation with automatic before/after capture
 */

import { eq, desc, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { auditLogs, type AuditLog, type InsertAuditLog } from "../drizzle/schema";

export interface AuditLogParams {
  userId?: string | null;
  action: string;
  tableName: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Insert an audit log entry.
 */
export async function logAudit(params: AuditLogParams): Promise<AuditLog | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Audit] Database not available, skipping audit log");
    return null;
  }

  try {
    const [log] = await db.insert(auditLogs).values({
      userId: params.userId ?? null,
      action: params.action,
      tableName: params.tableName,
      recordId: params.recordId ?? null,
      oldValues: params.before ?? null,
      newValues: params.after ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    }).returning();

    return log;
  } catch (error) {
    console.error("[Audit] Failed to write audit log:", error);
    return null;
  }
}

/**
 * List audit logs with optional filters and pagination.
 */
export async function listAuditLogs(opts?: {
  userId?: string;
  tableName?: string;
  action?: string;
  recordId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: AuditLog[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };

  const conditions = [];
  if (opts?.userId) conditions.push(eq(auditLogs.userId, opts.userId));
  if (opts?.tableName) conditions.push(eq(auditLogs.tableName, opts.tableName));
  if (opts?.action) conditions.push(eq(auditLogs.action, opts.action));
  if (opts?.recordId) conditions.push(eq(auditLogs.recordId, opts.recordId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(whereClause);

  const total = countResult?.count ?? 0;

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let query = db.select().from(auditLogs);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const logs = await query
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return { logs, total };
}

/**
 * Get audit log entry by ID.
 */
export async function getAuditLogById(id: string): Promise<AuditLog | null> {
  const db = await getDb();
  if (!db) return null;

  const [log] = await db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
  return log ?? null;
}

/**
 * Helper: wrap a mutation with automatic audit logging.
 */
export async function withAuditLog<T>(
  params: Omit<AuditLogParams, "before" | "after" | "recordId">,
  beforeSnapshot: unknown,
  fn: () => Promise<T & { id?: string }>,
): Promise<T> {
  const result = await fn();

  logAudit({
    ...params,
    recordId: (result as any)?.id ?? null,
    before: beforeSnapshot,
    after: result,
  }).catch(err => console.error("[Audit] Background log failed:", err));

  return result;
}
