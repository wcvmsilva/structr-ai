/**
 * structr.ai — Tenant Scope Helpers (Phase 1)
 *
 * Every business query must be constrained to the caller's tenant. These helpers
 * provide a single, testable way to build that constraint so routers never hand-roll
 * tenant filtering (and never forget it).
 *
 * Usage:
 *   const where = tenantWhere(projects, ctx.tenantId, eq(projects.status, "active"));
 *   const rows = await db.select().from(projects).where(where);
 */

import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/** Any table exposing a `tenantId` column. */
export type TenantScopedTable = { tenantId: PgColumn };

/**
 * Legacy rows created before Phase 1 may still have `tenant_id IS NULL`.
 * While `TENANT_STRICT` is off (default during rollout), those rows remain visible
 * to the tenant so existing data does not disappear. Set TENANT_STRICT=true once the
 * backfill has completed to enforce hard isolation.
 */
export function isStrictTenantMode(
  env: { TENANT_STRICT?: string | undefined } = process.env as { TENANT_STRICT?: string },
): boolean {
  return String(env.TENANT_STRICT ?? "").toLowerCase() === "true";
}

/** Build the tenant predicate for a table. Returns undefined when tenantId is absent. */
export function tenantFilter(
  table: TenantScopedTable,
  tenantId: string | null | undefined,
): SQL | undefined {
  if (!tenantId) return undefined;

  if (isStrictTenantMode()) {
    return eq(table.tenantId, tenantId);
  }

  // Transitional mode: tenant rows + not-yet-backfilled legacy rows.
  return or(eq(table.tenantId, tenantId), isNull(table.tenantId));
}

/**
 * Compose a WHERE clause combining the tenant predicate with domain conditions.
 * Undefined conditions are ignored, so callers can pass optional filters directly.
 */
export function tenantWhere(
  table: TenantScopedTable,
  tenantId: string | null | undefined,
  ...conditions: Array<SQL | undefined>
): SQL | undefined {
  const parts = [tenantFilter(table, tenantId), ...conditions].filter(
    (c): c is SQL => c !== undefined,
  );

  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return and(...parts);
}

/** Stamp `tenantId` onto an insert payload without overwriting an explicit value. */
export function withTenant<T extends Record<string, unknown>>(
  values: T,
  tenantId: string | null | undefined,
): T & { tenantId?: string | null } {
  if (values.tenantId !== undefined && values.tenantId !== null) return values;
  if (!tenantId) return values;
  return { ...values, tenantId };
}

/** Stamp `tenantId` onto a batch of insert payloads. */
export function withTenantAll<T extends Record<string, unknown>>(
  rows: T[],
  tenantId: string | null | undefined,
): Array<T & { tenantId?: string | null }> {
  return rows.map(row => withTenant(row, tenantId));
}

/**
 * Assert that a loaded row belongs to the caller's tenant.
 * Used after point lookups by primary key, where the query itself was not scoped.
 */
export function assertSameTenant(
  rowTenantId: string | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  if (!tenantId) return true;           // caller tenant unknown (dev/admin path)
  if (!rowTenantId) return !isStrictTenantMode(); // legacy row
  return rowTenantId === tenantId;
}
