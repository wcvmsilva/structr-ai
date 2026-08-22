/**
 * B2 — subcontractor routes: an unresolved caller tenant grants zero access.
 *
 * This closes the one live counterexample the previous unit reported. `subcontractors-router.ts`
 * carried a PRIVATE `assertSameTenant` that shadowed the name of the shared primitive while
 * implementing the opposite semantics:
 *
 *     if (sub.tenantId && callerTenantId && sub.tenantId !== callerTenantId) throw FORBIDDEN;
 *
 * The comparison is skipped whenever either side is null, so a caller whose tenant could not
 * be resolved passed it for EVERY tenant's subcontractor. `getSubcontractor()` is an unscoped
 * primary-key lookup that returns the whole row, and `subcontractors.license_number` — the
 * sensitive column flagged in issue #7 — is part of that row and is returned verbatim by
 * `subcontractors.get`.
 *
 * Seven routes depended on that guard: get, update, archive, getCompliance, getPerformance,
 * refreshPerformance, listTasks.
 *
 * These tests drive the real router through `createCaller`, so they exercise the production
 * boundary (`tenantProcedure` → `loadSubcontractorInTenant` → shared `assertSameTenant`)
 * rather than a helper in isolation. Two supplementary source-shape assertions are included
 * at the end; they are supplements, not the proof.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_A = "50000000-0000-4000-8000-00000000000a";
const TENANT_B = "50000000-0000-4000-8000-00000000000b";
const USER = "10000000-0000-4000-8000-000000000001";
const SUB_OF_B = "60000000-0000-4000-8000-0000000000b1";

/** The licence number that must never cross a tenant boundary. */
const LICENCE_OF_B = "SC-LICENCE-TENANT-B-0007";

/** A real subcontractor row owned by tenant B, including the sensitive column. */
const SUBCONTRACTOR_OF_B = {
  id: SUB_OF_B,
  tenantId: TENANT_B,
  name: "Tenant B Electrical",
  trade: "electrical",
  licenseNumber: LICENCE_OF_B,
  status: "active",
  deletedAt: null,
};

/** Counts every data-layer call so a refusal that still read or wrote is caught. */
const calls = {
  get: 0,
  update: 0,
  archive: 0,
  compliance: 0,
  performance: 0,
  refresh: 0,
  tasks: 0,
};

vi.mock("./subcontractor-db", () => ({
  getSubcontractor: vi.fn(async () => {
    calls.get += 1;
    return SUBCONTRACTOR_OF_B;
  }),
  updateSubcontractor: vi.fn(async () => {
    calls.update += 1;
    return SUBCONTRACTOR_OF_B;
  }),
  archiveSubcontractor: vi.fn(async () => {
    calls.archive += 1;
    return { archived: true };
  }),
  getSubcontractorCompliance: vi.fn(async () => {
    calls.compliance += 1;
    return { compliance: { state: "compliant" }, eligibility: { eligible: true } };
  }),
  getSubcontractorPerformance: vi.fn(async () => {
    calls.performance += 1;
    return { committedCostCents: 0 };
  }),
  refreshSubcontractorPerformance: vi.fn(async () => {
    calls.refresh += 1;
    return { refreshed: true };
  }),
  listTasksForSubcontractor: vi.fn(async () => {
    calls.tasks += 1;
    return [{ id: "task-of-b" }];
  }),
  createSubcontractor: vi.fn(async () => SUBCONTRACTOR_OF_B),
  listSubcontractors: vi.fn(async () => ({ subcontractors: [], total: 0 })),
  listComplianceAlerts: vi.fn(async () => []),
  SubcontractorError: class SubcontractorError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
}));

beforeEach(() => {
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0;
});

async function callerWith(tenantId: string | null, role = "user") {
  const { subcontractorsRouter } = await import("./subcontractors-router");
  return (subcontractorsRouter as any).createCaller({
    user: { id: USER, role },
    tenantId,
  });
}

/** Every route that takes a subcontractorId, with a minimal valid input. */
const ROUTES: Array<{ name: string; call: (c: any) => Promise<unknown>; writes: boolean }> = [
  { name: "get", call: c => c.get({ subcontractorId: SUB_OF_B }), writes: false },
  { name: "update", call: c => c.update({ subcontractorId: SUB_OF_B, name: "Renamed" }), writes: true },
  { name: "archive", call: c => c.archive({ subcontractorId: SUB_OF_B }), writes: true },
  { name: "getCompliance", call: c => c.getCompliance({ subcontractorId: SUB_OF_B }), writes: false },
  { name: "getPerformance", call: c => c.getPerformance({ subcontractorId: SUB_OF_B }), writes: false },
  { name: "refreshPerformance", call: c => c.refreshPerformance({ subcontractorId: SUB_OF_B }), writes: true },
  { name: "listTasks", call: c => c.listTasks({ subcontractorId: SUB_OF_B }), writes: false },
];

// ═════════════════════════════════════════════════════════════════════════════
// Unresolved caller tenant
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 subcontractors · an unresolved caller tenant is refused", () => {
  for (const route of ROUTES) {
    it(`refuses subcontractors.${route.name}`, async () => {
      const caller = await callerWith(null);

      await expect(route.call(caller)).rejects.toThrow(/No tenant is assigned/);

      // The refusal precedes the data layer entirely: the record was never even loaded.
      expect(calls.get).toBe(0);
      expect(calls.update + calls.archive + calls.refresh).toBe(0);
    });
  }

  it("an unresolved ADMIN cannot bypass tenant resolution", async () => {
    const caller = await callerWith(null, "admin");

    // A role is not a tenant. Admin is refused exactly like any other principal.
    for (const route of ROUTES) {
      await expect(route.call(caller)).rejects.toThrow(/No tenant is assigned/);
    }
    expect(calls.get).toBe(0);
  });

  it("an unresolved caller cannot read a licence number", async () => {
    const caller = await callerWith(null);

    await expect(caller.get({ subcontractorId: SUB_OF_B })).rejects.toThrow(
      /No tenant is assigned/,
    );
    expect(calls.get).toBe(0);
  });

  it("an unresolved caller cannot mutate subcontractor data", async () => {
    const caller = await callerWith(null);

    for (const route of ROUTES.filter(r => r.writes)) {
      await expect(route.call(caller)).rejects.toThrow(/No tenant is assigned/);
    }
    expect(calls.update + calls.archive + calls.refresh).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cross-tenant caller
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 subcontractors · tenant A cannot reach tenant B's record", () => {
  for (const route of ROUTES) {
    it(`refuses cross-tenant subcontractors.${route.name}`, async () => {
      const caller = await callerWith(TENANT_A);

      await expect(route.call(caller)).rejects.toThrow(/belongs to another tenant/);

      // The record is loaded (point lookup by id) but nothing downstream runs.
      expect(calls.update + calls.archive + calls.refresh).toBe(0);
      expect(calls.compliance + calls.performance + calls.tasks).toBe(0);
    });
  }

  it("a licence number never crosses the tenant boundary", async () => {
    const caller = await callerWith(TENANT_A);

    const result = await caller.get({ subcontractorId: SUB_OF_B }).catch((e: Error) => e);

    expect(result).toBeInstanceOf(Error);
    expect(JSON.stringify(result)).not.toContain(LICENCE_OF_B);
  });

  it("a cross-tenant ADMIN is refused too — admin is not a tenant", async () => {
    const caller = await callerWith(TENANT_A, "admin");

    await expect(caller.get({ subcontractorId: SUB_OF_B })).rejects.toThrow(
      /belongs to another tenant/,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Positive controls
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 subcontractors · same-tenant access still works", () => {
  for (const route of ROUTES) {
    it(`allows same-tenant subcontractors.${route.name}`, async () => {
      const caller = await callerWith(TENANT_B);
      await expect(route.call(caller)).resolves.toBeDefined();
    });
  }

  it("the same-tenant caller does receive the licence number", async () => {
    const caller = await callerWith(TENANT_B);

    const result: any = await caller.get({ subcontractorId: SUB_OF_B });

    // Proves the negative tests above fail for authorization reasons, not because the
    // fixture never carried the sensitive value in the first place.
    expect(result.subcontractor.licenseNumber).toBe(LICENCE_OF_B);
  });

  it("ROW axis preserved: a legacy tenant-less subcontractor stays reachable", async () => {
    const db = await import("./subcontractor-db");
    vi.mocked(db.getSubcontractor).mockResolvedValueOnce({
      ...SUBCONTRACTOR_OF_B,
      tenantId: null,
    } as never);

    const caller = await callerWith(TENANT_A);

    // B2 is the CALLER axis. An unmigrated record stays visible to a resolved caller while
    // TENANT_STRICT is off — unchanged by this unit (F15 / issue #10).
    await expect(caller.get({ subcontractorId: SUB_OF_B })).resolves.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Supplementary source-shape assertions (supplements, not the proof)
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 subcontractors · the fail-open shape is gone", () => {
  it("the private null-tolerant comparison no longer exists", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/subcontractors-router.ts", "utf8");

    // Check EXECUTABLE lines only: the module docstring quotes the removed expression
    // verbatim to record what it used to do, and that prose must not fail this assertion.
    // (A neat demonstration of why these source-shape checks are supplements, not proof.)
    const code = src
      .split("\n")
      .filter(l => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join("\n");
    expect(code).not.toContain(
      "sub.tenantId && callerTenantId && sub.tenantId !== callerTenantId",
    );
    // And the shadowing name is gone, so it cannot be confused with the shared primitive.
    expect(src).not.toMatch(/async function assertSameTenant\(/);
    expect(src).toContain('import { assertSameTenant } from "./tenant-scope";');
  });

  it("only the static vocabulary route remains outside the tenant boundary", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/subcontractors-router.ts", "utf8");

    const remaining = src.match(/\n {2}(\w+): protectedProcedure/g) ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain("trades");
  });
});
