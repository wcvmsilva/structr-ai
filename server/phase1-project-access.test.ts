/**
 * PHASE 1 — requireProjectAccess guard
 *
 * Covers the full decision table of server/project-access.ts:
 *   missing input → BAD_REQUEST
 *   no user       → FORBIDDEN
 *   no database   → FORBIDDEN (fail closed, never fail open)
 *   unknown project → NOT_FOUND
 *   platform admin  → allowed
 *   project owner   → allowed
 *   member role/explicit permissions → allowed only for granted actions
 *   cross-tenant    → FORBIDDEN even with a membership row
 *   tenant RBAC fallback → allowed only when RBAC grants the equivalent permission
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";

// ── Mocks ─────────────────────────────────────────────────────────────

const state: {
  db: unknown;
  project: Record<string, unknown> | undefined;
  user: Record<string, unknown> | undefined;
  membership: Record<string, unknown> | undefined;
  rbacAllowed: boolean;
} = {
  db: null,
  project: undefined,
  user: undefined,
  membership: undefined,
  rbacAllowed: false,
};

/**
 * Minimal drizzle query-builder stub.
 * `select({...}).from(table).where(...).limit(n)` resolves to an array; the row it
 * returns is chosen by which column set was requested, which is how the guard
 * distinguishes its three lookups (project, profile, membership).
 */
function makeDb() {
  return {
    select(columns: Record<string, unknown>) {
      const keys = Object.keys(columns);
      const rowFor = (): Record<string, unknown> | undefined => {
        if (keys.includes("ownerUserId")) return state.project;
        if (keys.includes("projectRole")) return state.membership;
        if (keys.includes("isActive") || keys.includes("role")) return state.user;
        return undefined;
      };

      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: () => Promise.resolve(rowFor() ? [rowFor()] : []),
        then: (resolve: (v: unknown[]) => unknown) =>
          Promise.resolve(rowFor() ? [rowFor()] : []).then(resolve),
      };
      return builder;
    },
  };
}

vi.mock("./db", () => ({
  getDb: vi.fn(async () => state.db),
}));

vi.mock("./rbac", () => ({
  hasPermission: vi.fn(async () => state.rbacAllowed),
}));

import {
  requireProjectAccess,
  requireProjectAccessTrpc,
  canAccessProject,
  ProjectAccessError,
  PROJECT_ROLE_PERMISSIONS,
} from "./project-access";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";
const USER_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_USER = "30000000-0000-4000-8000-000000000002";

beforeEach(() => {
  state.db = makeDb();
  state.project = {
    id: PROJECT_ID,
    tenantId: TENANT_A,
    ownerUserId: OTHER_USER,
    deletedAt: null,
  };
  state.user = { id: USER_ID, tenantId: TENANT_A, role: "user", isActive: true };
  state.membership = undefined;
  state.rbacAllowed = false;
});

describe("PHASE 1: requireProjectAccess", () => {
  describe("input validation", () => {
    it("rejects a missing projectId with BAD_REQUEST", async () => {
      await expect(requireProjectAccess(null, USER_ID, "read")).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("rejects a missing userId with FORBIDDEN", async () => {
      await expect(requireProjectAccess(PROJECT_ID, null, "read")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("fail-closed behaviour", () => {
    it("denies access when the database is unavailable", async () => {
      state.db = null;
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("reports an unknown project as NOT_FOUND, never as allowed", async () => {
      state.project = undefined;
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("denies a deactivated profile", async () => {
      state.user = { id: USER_ID, tenantId: TENANT_A, role: "admin", isActive: false };
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("denies an unknown profile", async () => {
      state.user = undefined;
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("platform admin", () => {
    it("grants every permission", async () => {
      state.user = { id: USER_ID, tenantId: TENANT_A, role: "admin", isActive: true };

      for (const permission of ["read", "write", "approve", "delete"] as const) {
        const result = await requireProjectAccess(PROJECT_ID, USER_ID, permission);
        expect(result.via).toBe("admin");
        expect(result.permissions).toEqual(PROJECT_ROLE_PERMISSIONS.owner);
      }
    });

    // HISTORY: this case previously read "crosses tenant boundaries (platform-level role)"
    // and asserted that a tenant-B admin was granted `delete` on a tenant-A project — the
    // vulnerability stated as intended behaviour. The admin branch returned full owner
    // permissions BEFORE any tenant comparison ran. Codex P1-1 (second review) rejected
    // that reading: `profiles.role === "admin"` is a per-profile role, a tenant
    // administrator, not a platform operator, and admin status must never confer
    // cross-tenant business access. Inverted; the same-tenant admin case above is
    // unchanged and still passes.
    it("does NOT cross tenant boundaries — admin is not a tenant", async () => {
      state.user = { id: USER_ID, tenantId: TENANT_B, role: "admin", isActive: true };
      await expect(
        requireProjectAccess(PROJECT_ID, USER_ID, "delete"),
      ).rejects.toThrow(FORBIDDEN_PROJECT_ERR_MSG);
    });

    it("is refused outright when the caller tenant is unresolved", async () => {
      state.user = { id: USER_ID, tenantId: null, role: "admin", isActive: true };
      await expect(
        requireProjectAccess(PROJECT_ID, USER_ID, "read"),
      ).rejects.toThrow(FORBIDDEN_PROJECT_ERR_MSG);
    });
  });

  describe("project owner", () => {
    it("grants every permission to the owner", async () => {
      state.project = { ...state.project!, ownerUserId: USER_ID };

      for (const permission of ["read", "write", "approve", "delete"] as const) {
        const result = await requireProjectAccess(PROJECT_ID, USER_ID, permission);
        expect(result.via).toBe("owner");
      }
    });
  });

  describe("explicit membership", () => {
    it("grants read to a viewer but denies write", async () => {
      state.membership = { projectRole: "viewer", permissions: [], isActive: true };

      const read = await requireProjectAccess(PROJECT_ID, USER_ID, "read");
      expect(read.via).toBe("member");
      expect(read.projectRole).toBe("viewer");

      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "write")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("grants write to field but denies approve", async () => {
      state.membership = { projectRole: "field", permissions: [], isActive: true };

      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "write")).resolves.toMatchObject({
        via: "member",
      });
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "approve")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("grants approve to estimator but denies delete", async () => {
      state.membership = { projectRole: "estimator", permissions: [], isActive: true };

      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "approve")).resolves.toMatchObject({
        via: "member",
      });
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "delete")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("honours explicit permission grants beyond the role", async () => {
      state.membership = { projectRole: "viewer", permissions: ["read", "approve"], isActive: true };

      const result = await requireProjectAccess(PROJECT_ID, USER_ID, "approve");
      expect(result.via).toBe("member");
      expect(result.permissions).toContain("approve");
    });

    it("ignores malformed permission payloads instead of trusting them", async () => {
      state.membership = {
        projectRole: "viewer",
        permissions: ["read", "superuser", 42, null],
        isActive: true,
      };

      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).resolves.toMatchObject({
        via: "member",
      });
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "delete")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("falls through to RBAC when the membership row is inactive", async () => {
      state.membership = { projectRole: "owner", permissions: [], isActive: false };
      state.rbacAllowed = false;

      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("tenant isolation", () => {
    it("denies a non-admin from another tenant even with a membership row", async () => {
      state.user = { id: USER_ID, tenantId: TENANT_B, role: "user", isActive: true };
      state.membership = { projectRole: "owner", permissions: [], isActive: true };

      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("does not fall back to RBAC across tenants", async () => {
      state.user = { id: USER_ID, tenantId: TENANT_B, role: "user", isActive: true };
      state.rbacAllowed = true;

      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "read")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("tenant RBAC fallback", () => {
    it("grants access when RBAC allows the equivalent permission", async () => {
      state.rbacAllowed = true;
      const result = await requireProjectAccess(PROJECT_ID, USER_ID, "write");
      expect(result.via).toBe("tenant_rbac");
      expect(result.permissions).toEqual(["write"]);
    });

    it("denies access when RBAC does not allow it", async () => {
      state.rbacAllowed = false;
      await expect(requireProjectAccess(PROJECT_ID, USER_ID, "write")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("error surface", () => {
    it("throws ProjectAccessError from the core guard", async () => {
      state.project = undefined;
      await expect(requireProjectAccess(PROJECT_ID, USER_ID)).rejects.toBeInstanceOf(
        ProjectAccessError,
      );
    });

    it("maps to a 403-equivalent TRPCError in the tRPC wrapper", async () => {
      state.rbacAllowed = false;
      await expect(requireProjectAccessTrpc(PROJECT_ID, USER_ID, "write")).rejects.toMatchObject({
        name: "TRPCError",
        code: "FORBIDDEN",
      });
    });

    it("maps a missing project to a 404-equivalent TRPCError", async () => {
      state.project = undefined;
      await expect(requireProjectAccessTrpc(PROJECT_ID, USER_ID)).rejects.toMatchObject({
        name: "TRPCError",
        code: "NOT_FOUND",
      });
    });
  });

  describe("canAccessProject", () => {
    it("returns true when access is granted", async () => {
      state.user = { id: USER_ID, tenantId: TENANT_A, role: "admin", isActive: true };
      await expect(canAccessProject(PROJECT_ID, USER_ID, "delete")).resolves.toBe(true);
    });

    it("returns false instead of throwing when denied", async () => {
      await expect(canAccessProject(PROJECT_ID, USER_ID, "delete")).resolves.toBe(false);
    });
  });
});
