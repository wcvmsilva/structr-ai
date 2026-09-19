/**
 * F3 — lead authorization guard.
 *
 * Proves the two halves of the contract:
 *   - tenant isolation is enforced on every lead read and write, for every caller;
 *   - a same-tenant teammate keeps the tenant-wide visibility they have today, unless
 *     the deployment opts into LEADS_OWNER_SCOPE.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";
import {
  assertLeadInScope,
  isLeadOwnerScopeMode,
  leadScopeVerdict,
  leadScopeWhere,
  resolveLeadScope,
  type LeadScope,
} from "./lead-access";

const dialect = new PgDialect();
const toSql = (scope: LeadScope) => dialect.sqlToQuery(leadScopeWhere(scope)).sql;

const ENV_KEYS = ["LEADS_OWNER_SCOPE", "TENANT_STRICT"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const ctxFor = (role: string | null, tenantId: string | null) => ({
  user: { id: "user-a", role, tenantId },
  tenantId,
});

describe("resolveLeadScope", () => {
  it("refuses a request without an authenticated caller", () => {
    expect(() => resolveLeadScope({ user: null, tenantId: "t1" })).toThrow();
    expect(() => resolveLeadScope(undefined)).toThrow();
  });

  it("gives a default-role caller tenant-wide scope (no ownership narrowing)", () => {
    // profiles.role defaults to "user" and no seeded RBAC role grants lead access:
    // the default caller must still see their own tenant's whole pipeline.
    expect(resolveLeadScope(ctxFor("user", "t1"))).toEqual({
      userId: "user-a",
      tenantId: "t1",
      via: "tenant",
    });
  });

  it("marks a platform admin, who stays tenant-bound all the same", () => {
    expect(resolveLeadScope(ctxFor("admin", "t1")).via).toBe("admin");
  });

  it("falls back to the profile tenant when the context carries none", () => {
    const scope = resolveLeadScope({ user: { id: "user-a", role: "user", tenantId: "t9" } });
    expect(scope.tenantId).toBe("t9");
  });

  it("narrows to owner scope only when LEADS_OWNER_SCOPE is set", () => {
    expect(isLeadOwnerScopeMode({})).toBe(false);
    process.env.LEADS_OWNER_SCOPE = "true";
    expect(isLeadOwnerScopeMode()).toBe(true);
    expect(resolveLeadScope(ctxFor("user", "t1")).via).toBe("owner");
    // An admin is exempt from the ownership narrowing, never from the tenant predicate.
    expect(resolveLeadScope(ctxFor("admin", "t1")).via).toBe("admin");
  });
});

describe("leadScopeWhere", () => {
  it("always emits a tenant predicate — no caller queries the whole table", () => {
    for (const via of ["tenant", "admin", "owner"] as const) {
      const sql = toSql({ userId: "user-a", tenantId: "t1", via });
      expect(sql).toContain("tenant_id");
    }
  });

  // HISTORY: this case previously read "fails closed to tenant-less rows when the tenant
  // cannot be resolved" and asserted the predicate narrowed to `tenant_id IS NULL` — B1.
  // It was named "fails closed" while granting an unidentified caller the whole unowned
  // row set. Under B2 the scope cannot be constructed at all: resolveLeadScope() refuses
  // the caller, so no lead query is ever built for them.
  it("refuses to build a scope at all when the tenant cannot be resolved", () => {
    expect(() => resolveLeadScope({ user: { id: "user-a" }, tenantId: null })).toThrow(
      TRPCError,
    );
    expect(() =>
      resolveLeadScope({ user: { id: "user-a", role: "admin" }, tenantId: null }),
    ).toThrow(TRPCError);
  });

  it("adds the owner predicate only in owner scope", () => {
    expect(toSql({ userId: "user-a", tenantId: "t1", via: "tenant" })).not.toContain("owner_user_id");
    expect(toSql({ userId: "user-a", tenantId: "t1", via: "admin" })).not.toContain("owner_user_id");
    expect(toSql({ userId: "user-a", tenantId: "t1", via: "owner" })).toContain("owner_user_id");
  });

  it("keeps the domain filters alongside the scope", () => {
    const sql = dialect.sqlToQuery(
      leadScopeWhere({ userId: "user-a", tenantId: "t1", via: "tenant" }, undefined),
    ).sql;
    expect(sql).toContain("tenant_id");
  });
});

describe("leadScopeVerdict", () => {
  const tenantScope: LeadScope = { userId: "user-a", tenantId: "t1", via: "tenant" };
  const adminScope: LeadScope = { userId: "user-a", tenantId: "t1", via: "admin" };

  it("lets a caller read a teammate's lead in the same tenant", () => {
    expect(
      leadScopeVerdict({ tenantId: "t1", ownerUserId: "colleague" }, tenantScope),
    ).toBe("in_scope");
  });

  it("hides another tenant's lead from every caller, admin included", () => {
    expect(leadScopeVerdict({ tenantId: "t2", ownerUserId: "user-a" }, tenantScope)).toBe(
      "other_tenant",
    );
    expect(leadScopeVerdict({ tenantId: "t2", ownerUserId: "user-a" }, adminScope)).toBe(
      "other_tenant",
    );
  });

  it("keeps legacy tenant-less leads reachable until TENANT_STRICT is on", () => {
    expect(leadScopeVerdict({ tenantId: null, ownerUserId: null }, tenantScope)).toBe("in_scope");
    process.env.TENANT_STRICT = "true";
    expect(leadScopeVerdict({ tenantId: null, ownerUserId: null }, tenantScope)).toBe(
      "other_tenant",
    );
  });

  // HISTORY: this case previously constructed `{ tenantId: null, via: "admin" }` and
  // asserted that a foreign row was "other_tenant" (correct) while a tenant-less row was
  // "in_scope" (B1 — the half that failed open, on the line below it). Under B2 a scope
  // with a null tenant is not constructible: the type forbids it and resolveLeadScope()
  // refuses to produce one, so the whole branch is gone rather than corrected.
  it("cannot represent a caller with no tenant", () => {
    expect(() => resolveLeadScope({ user: { id: "user-a" }, tenantId: null })).toThrow();
    // The remaining tolerance is the ROW axis only: a legacy tenant-less lead stays
    // visible to a resolved tenant while TENANT_STRICT is off (F15 / issue #10).
    expect(leadScopeVerdict({ tenantId: null, ownerUserId: "someone" }, adminScope)).toBe(
      "in_scope",
    );
  });

  describe("with LEADS_OWNER_SCOPE enabled", () => {
    const ownerScope: LeadScope = { userId: "user-a", tenantId: "t1", via: "owner" };

    it("allows the caller's own lead", () => {
      expect(leadScopeVerdict({ tenantId: "t1", ownerUserId: "user-a" }, ownerScope)).toBe(
        "in_scope",
      );
    });

    it("denies a teammate's lead", () => {
      expect(leadScopeVerdict({ tenantId: "t1", ownerUserId: "colleague" }, ownerScope)).toBe(
        "not_owned",
      );
    });

    it("tolerates leads created before an owner backfill", () => {
      expect(leadScopeVerdict({ tenantId: "t1", ownerUserId: null }, ownerScope)).toBe("in_scope");
      process.env.TENANT_STRICT = "true";
      expect(leadScopeVerdict({ tenantId: "t1", ownerUserId: null }, ownerScope)).toBe("not_owned");
    });
  });
});

describe("assertLeadInScope", () => {
  const tenantScope: LeadScope = { userId: "user-a", tenantId: "t1", via: "tenant" };
  const ownerScope: LeadScope = { userId: "user-a", tenantId: "t1", via: "owner" };

  it("passes an in-scope lead through", () => {
    expect(() =>
      assertLeadInScope({ tenantId: "t1", ownerUserId: "colleague" }, tenantScope),
    ).not.toThrow();
  });

  it("reports another tenant's lead as NOT_FOUND", () => {
    expect(() => assertLeadInScope({ tenantId: "t2", ownerUserId: "x" }, tenantScope)).toThrow(
      /NOT_FOUND|Lead not found/,
    );
  });

  it("reports an in-tenant lead the caller may not touch as FORBIDDEN", () => {
    try {
      assertLeadInScope({ tenantId: "t1", ownerUserId: "colleague" }, ownerScope);
      throw new Error("expected the guard to deny");
    } catch (err: any) {
      expect(err.code).toBe("FORBIDDEN");
    }
  });
});
