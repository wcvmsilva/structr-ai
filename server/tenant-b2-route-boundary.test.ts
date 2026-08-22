/**
 * B2 — ROUTE-LEVEL proof that an unresolved caller tenant grants zero business access.
 *
 * Why this file exists separately from `tenant-b2-fail-closed.test.ts`. That suite proved
 * the helper layer: `tenantFilter`, `withTenant`, `assertSameTenant`, and the client/deal/
 * pipeline data helpers. The second independent Codex review returned NO-GO because
 * helper-level evidence does not establish a route-level claim — and it was right. At
 * commit 42e678fa, roughly 220 procedures across 26 router families still sat on
 * `protectedProcedure`, and the guard they all funnel through, `requireProjectAccess()`:
 *
 *   - never received or required a resolved caller tenant;
 *   - returned FULL OWNER PERMISSIONS for `role === "admin"` BEFORE any tenant
 *     comparison, so a tenant-A admin was authorized on every tenant's projects;
 *   - guarded tenancy with `project.tenantId && user.tenantId && project.tenantId !==
 *     user.tenantId`, which fails OPEN whenever either side is null, so a profile with no
 *     tenant passed it for any project.
 *
 * And the Phase 2 conversion path let an unresolved caller pick any lead by primary key
 * and ADOPT that lead's tenant as their own authority.
 *
 * These tests therefore exercise the production authorization primitives and the real
 * router callers, not helper functions in isolation.
 *
 * Scope note: this file proves the shared choke point and the route families remediated in
 * this pass. It does NOT claim every route family is covered — see the report's
 * "REMAINING B2 PATHS".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";

const TENANT_A = "40000000-0000-4000-8000-00000000000a";
const TENANT_B = "40000000-0000-4000-8000-00000000000b";
const USER = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const LEAD_OF_B = "30000000-0000-4000-8000-0000000000b1";

// ── Authorization-store stub ─────────────────────────────────────────────────
// Mirrors the harness in phase1-project-access.test.ts: the guard makes three lookups
// (project, profile, membership) and is distinguished by the requested column set.

const state: {
  project: Record<string, unknown> | undefined;
  user: Record<string, unknown> | undefined;
  membership: Record<string, unknown> | undefined;
  rbacAllowed: boolean;
} = { project: undefined, user: undefined, membership: undefined, rbacAllowed: true };

function makeDb() {
  return {
    select(columns: Record<string, unknown>) {
      const keys = Object.keys(columns ?? {});
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
  getDb: vi.fn(async () => makeDb()),
  getRawClient: vi.fn(async () => null),
}));
vi.mock("./rbac", () => ({ hasPermission: vi.fn(async () => state.rbacAllowed) }));

beforeEach(() => {
  state.project = {
    id: PROJECT,
    tenantId: TENANT_A,
    ownerUserId: null,
    deletedAt: null,
  };
  state.user = { id: USER, tenantId: TENANT_A, role: "user", isActive: true };
  state.membership = undefined;
  state.rbacAllowed = true;
});

/** Each principal shape that could previously bypass the tenant comparison. */
const PRINCIPALS = [
  { label: "platform admin", user: { role: "admin" }, project: {} },
  { label: "project owner", user: { role: "user" }, project: { ownerUserId: USER } },
  { label: "project member", user: { role: "user" }, project: {}, member: true },
  { label: "ordinary authenticated caller", user: { role: "user" }, project: {} },
];

// ═════════════════════════════════════════════════════════════════════════════
// 1–5. The shared project/entity authorization choke point
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 route boundary · requireProjectAccess cannot authorize an unresolved caller", () => {
  for (const p of PRINCIPALS) {
    it(`refuses an unresolved ${p.label} (role/ownership/membership is not a tenant)`, async () => {
      const { requireProjectAccess } = await import("./project-access");

      state.user = { id: USER, tenantId: null, ...p.user, isActive: true };
      state.project = { ...state.project, ...p.project };
      if (p.member) {
        state.membership = { projectRole: "owner", permissions: ["read", "write"], isActive: true };
      }

      await expect(requireProjectAccess(PROJECT, USER, "read")).rejects.toThrow(
        FORBIDDEN_PROJECT_ERR_MSG,
      );
      await expect(requireProjectAccess(PROJECT, USER, "write")).rejects.toThrow(
        FORBIDDEN_PROJECT_ERR_MSG,
      );
    });
  }

  it("11. tenant A cannot reach tenant B's project — for any principal shape", async () => {
    const { requireProjectAccess } = await import("./project-access");

    for (const p of PRINCIPALS) {
      state.user = { id: USER, tenantId: TENANT_A, ...p.user, isActive: true };
      state.project = { id: PROJECT, tenantId: TENANT_B, ownerUserId: null, deletedAt: null, ...p.project };
      state.membership = p.member
        ? { projectRole: "owner", permissions: ["read", "write"], isActive: true }
        : undefined;

      await expect(requireProjectAccess(PROJECT, USER, "read")).rejects.toThrow(
        FORBIDDEN_PROJECT_ERR_MSG,
      );
    }
  });

  it("4/5. an unresolved caller cannot read OR mutate project/entity data", async () => {
    const { requireEntityAccess } = await import("./project-access");

    state.user = { id: USER, tenantId: null, role: "admin", isActive: true };

    // requireEntityAccess resolves the child to its project and delegates to the same
    // guard, so the child-id entry point is closed by the same boundary.
    await expect(requireEntityAccess("fieldTask", "task-1", USER, "read")).rejects.toThrow();
    await expect(requireEntityAccess("fieldTask", "task-1", USER, "write")).rejects.toThrow();
  });

  it("14. valid same-tenant access still works, for every principal shape", async () => {
    const { requireProjectAccess } = await import("./project-access");

    for (const p of PRINCIPALS) {
      state.user = { id: USER, tenantId: TENANT_A, ...p.user, isActive: true };
      state.project = { id: PROJECT, tenantId: TENANT_A, ownerUserId: null, deletedAt: null, ...p.project };
      state.membership = p.member
        ? { projectRole: "owner", permissions: ["read", "write"], isActive: true }
        : undefined;

      const result = await requireProjectAccess(PROJECT, USER, "read");
      expect(result.projectId).toBe(PROJECT);
    }
  });

  it("ROW axis preserved: a legacy tenant-less project stays reachable (F15 / issue #10)", async () => {
    const { requireProjectAccess } = await import("./project-access");

    state.user = { id: USER, tenantId: TENANT_A, role: "admin", isActive: true };
    state.project = { id: PROJECT, tenantId: null, ownerUserId: null, deletedAt: null };

    // B2 is the CALLER axis. A resolved caller may still reach an unmigrated project
    // while TENANT_STRICT is off — unchanged by this pass.
    await expect(requireProjectAccess(PROJECT, USER, "read")).resolves.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The route boundary itself
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 route boundary · remediated route families sit behind tenantProcedure", () => {
  it("field-operations routes require a resolved caller tenant", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/field-operations-router.ts", "utf8");

    // Every field-operation business route: create, read, transition and the rest.
    expect(src).not.toContain("protectedProcedure");
    expect(src).toContain("tenantProcedure");
  });

  it("both Phase 2 conversion routes require a resolved caller tenant", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/lead-router.ts", "utf8");

    expect(src).toMatch(/\n {2}convertToProject: tenantProcedure/);
    expect(src).toMatch(/\n {2}planConversion: tenantProcedure/);
  });

  it("6/7/8. unresolved callers are rejected by the field-operations boundary", async () => {
    const { fieldOperationsRouter } = await import("./field-operations-router");

    const caller = (fieldOperationsRouter as any).createCaller({
      user: { id: USER, role: "admin" },
      tenantId: null,
    });

    // create, read and transition — the three shapes named in the remediation unit.
    await expect(caller.createTask({ projectId: PROJECT } as never)).rejects.toThrow(
      /No tenant is assigned/,
    );
    await expect(caller.getTask({ taskId: "task-1" } as never)).rejects.toThrow(
      /No tenant is assigned/,
    );
    await expect(
      caller.transitionTask({ taskId: "task-1", to: "in_progress" } as never),
    ).rejects.toThrow(/No tenant is assigned/);
  });

  it("9/10. unresolved callers are rejected by both conversion routes", async () => {
    const { leadRouter } = await import("./lead-router");

    const caller = (leadRouter as any).createCaller({
      user: { id: USER, role: "admin" },
      tenantId: null,
    });

    await expect(caller.convertToProject({ id: LEAD_OF_B } as never)).rejects.toThrow(
      /No tenant is assigned/,
    );
    await expect(caller.planConversion({ id: LEAD_OF_B } as never)).rejects.toThrow(
      /No tenant is assigned/,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12/13. Phase 2 — no tenant adoption, no cross-tenant reuse
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 route boundary · Phase 2 conversion cannot adopt a lead's tenant", () => {
  it("the conversion input no longer accepts a null caller tenant", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/lead-conversion.ts", "utf8");

    // The adoption expression is gone: the candidate's tenant is the caller's, full stop.
    expect(src).not.toContain("input.tenantId ?? lead.tenantId");
  });

  it("12. the lead lookup is tenant-scoped — a primary-key hit is not authorization", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/lead-conversion.ts", "utf8");

    // Both entry points must scope the lookup; an unscoped `eq(leads.id, …)` would let
    // tenant A select tenant B's lead and only then be checked.
    const scoped = src.match(/tenantWhere\(leads, input\.tenantId, eq\(leads\.id, input\.leadId\)\)/g);
    expect(scoped).toHaveLength(2);
    expect(src).not.toMatch(/from\(leads\)\s*\.where\(eq\(leads\.id, input\.leadId\)\)/);
  });

  it("13. candidate loaders can no longer run unscoped across every tenant", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/lead-conversion.ts", "utf8");

    // Previously: `: await db.select().from(clients);` when the tenant was null — every
    // tenant's clients returned as reuse candidates.
    expect(src).not.toMatch(/:\s*await db\.select\(\)\.from\(clients\);/);
    expect(src).not.toMatch(/:\s*await db\.select\(\)\.from\(projects\);/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. Field operations — inheritance follows authorization
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 route boundary · field-operation row inheritance follows authorization", () => {
  it("the parent row's tenant takes precedence over the caller's", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/field-operations-db.ts", "utf8");

    // Inheritance is data integrity, not authorization: the parent wins, and the
    // already-authorized caller tenant is only the legacy fallback.
    expect(src).toContain("const tenantId = project.tenantId ?? input.tenantId ?? null;");
    expect(src).not.toContain("const tenantId = input.tenantId ?? project.tenantId ?? null;");
  });

  it("the module note no longer claims a boundary the code did not enforce", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/field-operations-db.ts", "utf8");

    expect(src).not.toContain(
      "boundary still rejects an unresolved caller before any of it runs",
    );
    expect(src).toContain("CORRECTION (Codex P1-1, second review)");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The equivalence this remediation depends on
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 route boundary · ctx.tenantId and profiles.tenant_id are the same value", () => {
  it("resolveTenantId returns exactly profile.tenantId, with no substitution", async () => {
    const { sdk } = await import("./_core/sdk");

    // requireProjectAccess reads the caller tenant from the profile row rather than
    // receiving ctx.tenantId as an argument. That is only sound while these two are the
    // same field of the same row. This test pins that equivalence so it cannot drift
    // silently — if resolveTenantId ever reintroduces a fallback or derives the tenant
    // from anywhere else, this fails and the guard must start taking the tenant directly.
    await expect(sdk.resolveTenantId({ tenantId: TENANT_A } as never)).resolves.toBe(TENANT_A);
    await expect(sdk.resolveTenantId({ tenantId: null } as never)).resolves.toBeNull();
    await expect(sdk.resolveTenantId(null)).resolves.toBeNull();
  });
});
