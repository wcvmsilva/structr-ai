/**
 * structr.ai — Lead Access Guard
 *
 * Single authorization chokepoint for lead reads and writes. `lead.list`, `lead.get`,
 * `lead.search` and the lead mutations used to run with authentication as their only
 * gate: every query over `leads` was built without a tenant or ownership predicate, so
 * any signed-in principal could read and mutate every tenant's leads (customer PII).
 *
 * Decision order (first match wins):
 *   1. no authenticated caller          → 403 FORBIDDEN
 *   2. caller tenant NOT resolvable     → 403 FORBIDDEN (B2: NULL is not a tenant)
 *   3. caller tenant resolved           → the caller's tenant, plus tenant-less legacy
 *                                         rows while TENANT_STRICT is off (exactly the
 *                                         tolerance `tenantFilter` already applies)
 *
 * The tenant predicate applies to every caller, platform admins included: leads carry
 * customer PII and no lead route is a cross-tenant route. `profiles.role === "admin"`
 * only exempts a caller from the optional ownership narrowing below — it never widens a
 * lead query past the caller's own tenant.
 *
 * Ownership narrowing (`LEADS_OWNER_SCOPE=true`, OFF by default) additionally restricts a
 * non-admin caller to the leads they own. It is opt-in on purpose: the shared pipeline is
 * the product's default behaviour — teammates inside one tenant work each other's leads —
 * so turning it on is a deployment decision, not a side effect of this guard. Rows with
 * `owner_user_id IS NULL` (created before any owner backfill) stay reachable while
 * TENANT_STRICT is off, mirroring the tenant predicate's transitional tolerance.
 *
 * Fail-closed by construction (B2, Codex P1-1): `scope.tenantId` is non-nullable, so a
 * lead query can never run unscoped over the whole table — not for an admin, and not for
 * a caller whose tenant could not be resolved, who is now refused at `resolveLeadScope()`
 * rather than being handed the tenant-less rows. That earlier behaviour treated NULL as
 * an authorization domain; it is withdrawn.
 */

import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { leads } from "../drizzle/schema";
import { isStrictTenantMode, tenantFilter } from "./tenant-scope";

export const FORBIDDEN_LEAD_ERR_MSG = "You do not have access to this lead (10004)";
export const UNRESOLVED_TENANT_LEAD_ERR_MSG = "No tenant is assigned to this account (10005)";
export const LEAD_NOT_FOUND_ERR_MSG = "Lead not found";

/** How the caller is authorized inside their tenant. */
export type LeadScopeVia =
  /** Platform admin: tenant-scoped, exempt from the optional ownership narrowing. */
  | "admin"
  /** Default: every lead of the caller's tenant. */
  | "tenant"
  /** LEADS_OWNER_SCOPE opt-in: only the caller's own leads, inside their tenant. */
  | "owner";

/** Resolved authorization decision for one caller. Consumed by every lead query. */
export type LeadScope = {
  /** Caller profile id — the owner identity leads are matched against. */
  userId: string;
  /** Tenant the caller operates in. Non-nullable: an unresolved tenant is refused. */
  tenantId: string;
  via: LeadScopeVia;
};

/** Caller shape taken from the tRPC context (`ctx.user` is the authenticated profile). */
export type LeadCallerContext = {
  user?: { id?: string | null; role?: string | null; tenantId?: string | null } | null;
  tenantId?: string | null;
};

/** The columns of a lead row this guard decides on. */
export type LeadScopeRow = {
  tenantId?: string | null;
  ownerUserId?: string | null;
};

/**
 * Opt-in switch: narrow non-admin callers to the leads they own.
 * OFF by default so a same-tenant teammate keeps the visibility they have today.
 */
export function isLeadOwnerScopeMode(
  env: { LEADS_OWNER_SCOPE?: string | undefined } = process.env as {
    LEADS_OWNER_SCOPE?: string;
  },
): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.LEADS_OWNER_SCOPE ?? "").trim());
}

/**
 * Resolve the caller's lead scope from the tRPC context.
 * Throws FORBIDDEN when there is no authenticated caller to authorize.
 */
export function resolveLeadScope(ctx: LeadCallerContext | null | undefined): LeadScope {
  const userId = ctx?.user?.id;

  if (!userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_LEAD_ERR_MSG });
  }

  const tenantId = ctx?.tenantId ?? ctx?.user?.tenantId ?? null;

  // B2: a caller whose tenant cannot be resolved is not a tenant of anything and is
  // authorized for nothing — not even the tenant-less rows.
  if (!tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: UNRESOLVED_TENANT_LEAD_ERR_MSG });
  }

  const isPlatformAdmin = ctx?.user?.role === "admin";

  const via: LeadScopeVia = isPlatformAdmin
    ? "admin"
    : isLeadOwnerScopeMode()
      ? "owner"
      : "tenant";

  return { userId, tenantId, via };
}

/**
 * Tenant predicate for the `leads` table.
 * Never widens: `scope.tenantId` is non-nullable, so this is always the caller's tenant
 * (plus tenant-less legacy rows while TENANT_STRICT is off — the ROW axis, F15/#10).
 */
function tenantPredicate(scope: LeadScope): SQL {
  return tenantFilter(leads, scope.tenantId);
}

/** Ownership predicate, with the same legacy tolerance the tenant predicate applies. */
function ownerPredicate(scope: LeadScope): SQL {
  const owned = eq(leads.ownerUserId, scope.userId);
  if (isStrictTenantMode()) return owned;
  // Transitional mode: leads owned by the caller + not-yet-backfilled ownerless rows.
  return or(owned, isNull(leads.ownerUserId))!;
}

/**
 * Compose the WHERE clause for a lead query: the caller's scope combined with the
 * domain filters. Always returns a predicate, so the query is never unscoped.
 */
export function leadScopeWhere(
  scope: LeadScope,
  ...conditions: Array<SQL | undefined>
): SQL {
  const parts: SQL[] = [tenantPredicate(scope)];

  if (scope.via === "owner") {
    parts.push(ownerPredicate(scope));
  }

  for (const condition of conditions) {
    if (condition !== undefined) parts.push(condition);
  }

  return parts.length === 1 ? parts[0] : and(...parts)!;
}

/**
 * Authorization verdict for a single lead row, mirroring `leadScopeWhere()` exactly.
 * Used after point lookups by primary key, where the row was loaded by id.
 */
export function leadScopeVerdict(
  lead: LeadScopeRow | null | undefined,
  scope: LeadScope,
): "in_scope" | "other_tenant" | "not_owned" {
  const leadTenantId = lead?.tenantId ?? null;

  // `scope.tenantId` is non-nullable (B2), so the only tolerance left is the ROW axis:
  // legacy tenant-less rows, visible while the backfill is in progress (F15 / issue #10).
  if (leadTenantId === null) {
    if (isStrictTenantMode()) return "other_tenant";
  } else if (leadTenantId !== scope.tenantId) {
    return "other_tenant";
  }

  if (scope.via === "owner") {
    const ownerUserId = lead?.ownerUserId ?? null;
    const legacyOwnerless = ownerUserId === null && !isStrictTenantMode();
    if (!legacyOwnerless && ownerUserId !== scope.userId) return "not_owned";
  }

  return "in_scope";
}

/**
 * Enforce the scope on a lead loaded by id, before it is returned or mutated.
 *
 * Another tenant's lead is reported as NOT_FOUND so the route never confirms that the
 * id exists; a lead inside the caller's tenant that they may not touch is FORBIDDEN.
 */
export function assertLeadInScope(
  lead: LeadScopeRow | null | undefined,
  scope: LeadScope,
): void {
  const verdict = leadScopeVerdict(lead, scope);

  if (verdict === "other_tenant") {
    throw new TRPCError({ code: "NOT_FOUND", message: LEAD_NOT_FOUND_ERR_MSG });
  }

  if (verdict === "not_owned") {
    throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_LEAD_ERR_MSG });
  }
}
