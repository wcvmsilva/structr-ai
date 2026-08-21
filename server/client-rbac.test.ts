/**
 * F12 — RBAC enforcement on the CRM client domain.
 *
 * `client.create` / `client.update` / `client.getById` / `client.list` ran on bare
 * `protectedProcedure`, so a read-only `viewer` or `reviewer` could create and modify
 * any client record even though the seeded RBAC model withholds `client:write` from
 * both roles.
 *
 * These tests prove the two halves of the contract:
 *   1. the model is now enforced — a role the model governs and that lacks the action
 *      is refused with FORBIDDEN;
 *   2. the gate takes nothing away from callers the model does not govern — the
 *      default `'user'` role, a missing profile, an unseeded RBAC table and an absent
 *      database all resolve to "unenforced" and keep exactly today's access.
 *
 * The decision is exercised through the REAL `getUserPermissions()` resolution chain
 * (profile.role → roles row → role_permissions → permissions) against a fake db
 * handle, because half of (2) is about how that chain fails, not about set algebra.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { NOT_ADMIN_ERR_MSG } from "@shared/const";
import { profiles, roles, rolePermissions } from "../drizzle/schema";

// ── Fake database handle ─────────────────────────────────────────────────────
// Mirrors just enough of the drizzle builder for getUserPermissions():
//   select().from(users).where().limit()                        → profile row
//   select().from(roles).where().limit()                        → role row
//   select().from(rolePermissions).innerJoin().where()          → permission rows

type PermissionRow = { resource: string; action: string };

const dbState: {
  handle: unknown;
  profileRow: { role: string | null } | null;
  roleRow: { id: string } | null;
  permissionRows: PermissionRow[];
} = { handle: null, profileRow: null, roleRow: null, permissionRows: [] };

function rowsFor(table: unknown): unknown[] {
  // `users` is an alias of `profiles` in drizzle/schema.ts, so identity holds.
  if (table === profiles) return dbState.profileRow ? [dbState.profileRow] : [];
  if (table === roles) return dbState.roleRow ? [dbState.roleRow] : [];
  if (table === rolePermissions) return dbState.permissionRows;
  return [];
}

function createSelect() {
  let table: unknown = null;
  const chain = {
    from(t: unknown) {
      table = t;
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      return chain;
    },
    then(
      onFulfilled: (rows: unknown[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(rowsFor(table)).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

const mockDb = { select: () => createSelect() };

vi.mock("./db", () => ({ getDb: vi.fn(async () => dbState.handle) }));

import { evaluatePermission, requirePermission } from "./rbac";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The `client:*` grants seed-rbac.mjs actually assigns, per role. */
const SEEDED_CLIENT_GRANTS: Record<string, string[]> = {
  admin: ["client:read", "client:write", "client:delete"],
  estimator: ["client:read", "client:write"],
  reviewer: ["client:read"],
  viewer: ["client:read"],
};

let userSeq = 0;
/** A fresh id per check — getUserPermissions() caches per user for 30s. */
const freshUser = () => `user-${++userSeq}`;

/** Put the fake db in the state a caller with `roleName` and `grants` would see. */
function asRole(roleName: string, grants: string[]): string {
  dbState.profileRow = { role: roleName };
  dbState.roleRow = { id: `role-${roleName}` };
  dbState.permissionRows = grants.map(g => {
    const [resource, action] = g.split(":");
    return { resource, action };
  });
  return freshUser();
}

beforeEach(() => {
  dbState.handle = mockDb;
  dbState.profileRow = null;
  dbState.roleRow = null;
  dbState.permissionRows = [];
});

// ── 1. The model is enforced where it speaks ─────────────────────────────────

describe("F12: evaluatePermission enforces the seeded client model", () => {
  it("denies client:write to the read-only roles (the finding)", async () => {
    for (const role of ["viewer", "reviewer"]) {
      const userId = asRole(role, SEEDED_CLIENT_GRANTS[role]);
      expect(
        await evaluatePermission(userId, "client", "write"),
        `${role} must not hold client:write`,
      ).toBe("denied");
    }
  });

  it("keeps client:read for the read-only roles", async () => {
    for (const role of ["viewer", "reviewer"]) {
      const userId = asRole(role, SEEDED_CLIENT_GRANTS[role]);
      expect(await evaluatePermission(userId, "client", "read")).toBe("granted");
    }
  });

  it("grants both actions to estimator and admin", async () => {
    for (const role of ["estimator", "admin"]) {
      for (const action of ["read", "write"]) {
        const userId = asRole(role, SEEDED_CLIENT_GRANTS[role]);
        expect(
          await evaluatePermission(userId, "client", action),
          `${role} must hold client:${action}`,
        ).toBe("granted");
      }
    }
  });

  it("denies client:delete to every non-admin seeded role", async () => {
    for (const role of ["viewer", "reviewer", "estimator"]) {
      const userId = asRole(role, SEEDED_CLIENT_GRANTS[role]);
      expect(await evaluatePermission(userId, "client", "delete")).toBe("denied");
    }
  });
});

// ── 2. The gate takes nothing away where the model is silent ─────────────────

describe("F12: unenforced states keep today's access", () => {
  it("treats the default 'user' role as unenforced (no such row is ever seeded)", async () => {
    // profiles.role defaults to 'user'; seed-rbac.mjs creates only
    // admin/estimator/reviewer/viewer, so the role name resolves to no role row.
    dbState.profileRow = { role: "user" };
    dbState.roleRow = null;
    const userId = freshUser();

    expect(await evaluatePermission(userId, "client", "read")).toBe("unenforced");
    expect(await evaluatePermission(freshUser(), "client", "write")).toBe("unenforced");
  });

  it("treats a missing profile row as unenforced", async () => {
    dbState.profileRow = null;
    expect(await evaluatePermission(freshUser(), "client", "write")).toBe("unenforced");
  });

  it("treats a profile with a NULL role as unenforced", async () => {
    dbState.profileRow = { role: null };
    expect(await evaluatePermission(freshUser(), "client", "write")).toBe("unenforced");
  });

  it("treats an unseeded role_permissions table as unenforced", async () => {
    // The role row exists but carries no grants at all — the model was never seeded.
    dbState.profileRow = { role: "viewer" };
    dbState.roleRow = { id: "role-viewer" };
    dbState.permissionRows = [];
    expect(await evaluatePermission(freshUser(), "client", "write")).toBe("unenforced");
  });

  it("treats an absent database as unenforced, never as a refusal", async () => {
    dbState.handle = null;
    expect(await evaluatePermission(freshUser(), "client", "write")).toBe("unenforced");
  });

  it("treats a role whose grants say nothing about client as unenforced", async () => {
    // A role that the model governs for OTHER resources does not thereby lose
    // client access it was never modelled for.
    const userId = asRole("catalog-only", ["catalog:read", "estimate:read"]);
    expect(await evaluatePermission(userId, "client", "write")).toBe("unenforced");
    expect(await evaluatePermission(asRole("catalog-only", ["catalog:read"]), "client", "read")).toBe(
      "unenforced",
    );
  });

  it("denies only when the role carries some client grant but not this one", async () => {
    // The single condition that separates "denied" from "unenforced".
    const governed = asRole("client-reader", ["client:read"]);
    expect(await evaluatePermission(governed, "client", "write")).toBe("denied");

    const ungoverned = asRole("client-reader", ["project:read"]);
    expect(await evaluatePermission(ungoverned, "client", "write")).toBe("unenforced");
  });
});

// ── 3. requirePermission throws on "denied" only ─────────────────────────────

describe("F12: requirePermission", () => {
  it("throws FORBIDDEN with the shared permission message on 'denied'", async () => {
    const userId = asRole("viewer", SEEDED_CLIENT_GRANTS.viewer);

    await expect(requirePermission(userId, "client", "write")).rejects.toBeInstanceOf(
      TRPCError,
    );

    const error = await requirePermission(asRole("viewer", ["client:read"]), "client", "write")
      .then(() => null)
      .catch((e: TRPCError) => e);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error!.code).toBe("FORBIDDEN");
    expect(error!.message).toBe(NOT_ADMIN_ERR_MSG);
  });

  it("does not throw on 'granted'", async () => {
    const userId = asRole("estimator", SEEDED_CLIENT_GRANTS.estimator);
    await expect(requirePermission(userId, "client", "write")).resolves.toBe("granted");
  });

  it("does not throw on 'unenforced'", async () => {
    dbState.profileRow = { role: "user" };
    dbState.roleRow = null;
    await expect(requirePermission(freshUser(), "client", "write")).resolves.toBe(
      "unenforced",
    );
  });
});

// ── 4. Every client procedure is bound to the gate ───────────────────────────
//
// Source-level, like server/phase1-route-guard-coverage.test.ts: it fails the build
// the moment a client procedure is added back on bare `protectedProcedure`, which is
// the regression that matters here.

describe("F12: client-router procedure gating", () => {
  const src = readFileSync(join(__dirname, "client-router.ts"), "utf8");

  it("gates the reads on client:read", () => {
    for (const proc of ["getById", "list", "search", "stats"]) {
      expect(src, `client.${proc} must use clientReadProcedure`).toMatch(
        new RegExp(`\\n  ${proc}: clientReadProcedure`),
      );
    }
  });

  it("gates create and update on client:write", () => {
    for (const proc of ["create", "update"]) {
      expect(src, `client.${proc} must use clientWriteProcedure`).toMatch(
        new RegExp(`\\n  ${proc}: clientWriteProcedure`),
      );
    }
  });

  it("leaves delete on adminProcedure (strictly stricter than client:delete)", () => {
    expect(src).toMatch(/\n {2}delete: adminProcedure/);
  });

  it("defines no procedure directly on bare protectedProcedure", () => {
    expect(src).not.toMatch(/\n {2}\w+: protectedProcedure/);
  });

  it("takes the gate from the shared RBAC module, not a local reimplementation", () => {
    expect(src).toMatch(/import \{ requirePermission \} from "\.\/rbac"/);
  });

  it("still threads the tenant scope into every data-layer call (F8 must survive)", () => {
    // The RBAC gate is additive: it must not have displaced the tenant argument.
    // Count inside the router body only, so the prose above it cannot inflate it.
    const body = src.slice(src.indexOf("export const clientRouter = router({"));
    const tenantScoped = body.match(/\{ tenantId: ctx\.tenantId \}/g) ?? [];
    expect(tenantScoped.length).toBe(7);
  });
});
