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
 *
 * ── B2 INVARIANT (Codex P1-1) ────────────────────────────────────────────────
 * An unresolved caller tenant confers NO authorization. NULL is not a tenant and is
 * never an authorization domain. `tenantId` is therefore NON-NULLABLE on every helper
 * below: the null case is a compile error at the call site, and a runtime
 * `TenantScopeError` for any path the compiler cannot see.
 *
 * This replaces the previous transitional reading, in which a null caller tenant
 * dropped the predicate entirely (reads ran unscoped) and `assertSameTenant` returned
 * `true` for any row. That behaviour was justified by a "dev/admin path" that an audit
 * of every call site proved does not exist.
 *
 * Note the two axes stay separate:
 *   - CALLER tenant unresolved  → this file. Fail closed, always.
 *   - ROW tenant_id IS NULL     → legacy data (F15 / issue #10). Still tolerated while
 *                                 TENANT_STRICT is off, and untouched here.
 */

import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/** Any table exposing a `tenantId` column. */
export type TenantScopedTable = { tenantId: PgColumn };

/**
 * Raised when a tenant-scoped helper is reached without a resolved caller tenant.
 *
 * Defense-in-depth only: the tenant-aware procedure boundary is expected to reject the
 * request first, loudly, so an operator sees a provisioning error rather than a 500.
 * This exists so that a route which forgets that boundary still cannot leak.
 */
export class TenantScopeError extends Error {
  readonly code = "TENANT_UNRESOLVED";

  constructor(operation: string) {
    super(
      `Tenant scope is unresolved for ${operation}(); refusing to authorize business data access.`,
    );
    this.name = "TenantScopeError";
  }
}

/** Runtime guard for callers the compiler cannot check (JS callers, `as any`, tests). */
function requireTenant(tenantId: string | null | undefined, operation: string): string {
  if (!tenantId) throw new TenantScopeError(operation);
  return tenantId;
}

/**
 * Legacy rows created before Phase 1 may still have `tenant_id IS NULL`.
 * While `TENANT_STRICT` is off (default during rollout), those rows remain visible
 * to the tenant so existing data does not disappear. Set TENANT_STRICT=true once the
 * backfill has completed to enforce hard isolation.
 *
 * This is the ROW axis (F15 / issue #10). It says nothing about an unresolved CALLER.
 */
export function isStrictTenantMode(
  env: { TENANT_STRICT?: string | undefined } = process.env as { TENANT_STRICT?: string },
): boolean {
  return String(env.TENANT_STRICT ?? "").toLowerCase() === "true";
}

/**
 * Build the tenant predicate for a table. Always returns a predicate.
 * Throws `TenantScopeError` when the caller tenant is unresolved — a query is never
 * allowed to run unscoped.
 */
export function tenantFilter(
  table: TenantScopedTable,
  tenantId: string,
): SQL {
  const id = requireTenant(tenantId, "tenantFilter");

  if (isStrictTenantMode()) {
    return eq(table.tenantId, id);
  }

  // Transitional mode: tenant rows + not-yet-backfilled legacy rows (F15 / issue #10).
  return or(eq(table.tenantId, id), isNull(table.tenantId))!;
}

/**
 * Compose a WHERE clause combining the tenant predicate with domain conditions.
 * Undefined conditions are ignored, so callers can pass optional filters directly.
 * The tenant predicate is always present, so the result is never undefined.
 */
export function tenantWhere(
  table: TenantScopedTable,
  tenantId: string,
  ...conditions: Array<SQL | undefined>
): SQL {
  const parts = [tenantFilter(table, tenantId), ...conditions].filter(
    (c): c is SQL => c !== undefined,
  );

  if (parts.length === 1) return parts[0];
  return and(...parts)!;
}

/**
 * Stamp `tenantId` onto an insert payload without overwriting an explicit value.
 * Throws rather than writing an unowned row: an untenanted row created today is
 * permanent, un-attributable data that enlarges the issue #10 backfill.
 */
export function withTenant<T extends Record<string, unknown>>(
  values: T,
  tenantId: string,
): T & { tenantId?: string | null } {
  const id = requireTenant(tenantId, "withTenant");
  if (values.tenantId !== undefined && values.tenantId !== null) return values;
  return { ...values, tenantId: id };
}

/** Stamp `tenantId` onto a batch of insert payloads. */
export function withTenantAll<T extends Record<string, unknown>>(
  rows: T[],
  tenantId: string,
): Array<T & { tenantId?: string | null }> {
  return rows.map(row => withTenant(row, tenantId));
}

/**
 * Assert that a loaded row belongs to the caller's tenant.
 * Used after point lookups by primary key, where the query itself was not scoped.
 *
 * Returns `false` rather than throwing: every caller already treats `false` as
 * "not found" or "forbidden", so a boolean keeps their error semantics intact while
 * still authorizing nothing for an unresolved caller.
 */
export function assertSameTenant(
  rowTenantId: string | null | undefined,
  tenantId: string,
): boolean {
  if (!tenantId) return false;                    // B2: unresolved caller authorizes nothing
  if (!rowTenantId) return !isStrictTenantMode(); // legacy row (ROW axis — F15 / issue #10)
  return rowTenantId === tenantId;
}
