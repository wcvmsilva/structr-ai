/**
 * B2 — the five Class-B routes from the route inventory.
 *
 * These were the only *live* caller-axis vulnerabilities the inventory found. Two root
 * causes, five routes:
 *
 * ROOT CAUSE A — a guard applied only when an OPTIONAL input is supplied.
 *   `fieldLaunch.listActuals` called `requireProjectAccessTrpc` only `if (input?.projectId)`.
 *   With it omitted, `listProjectActuals()` built `whereClause = undefined` and executed
 *   `SELECT * FROM project_actuals` — a tenant-scoped cost table — for any authenticated
 *   caller, with no tenant required. `estimate.listPartialDrafts` had the same shape via
 *   an optional `scopeDraftId`.
 *
 * ROOT CAUSE B — ownership + admin role used INSTEAD of tenant authorization.
 *   `getPartialDraft` / `retryPartialDraft` / `abandonPartialDraft` fell back to
 *   `role !== "admin" && owner !== caller`, so an admin of ANY tenant reached the row.
 *   `pipeline_partial_drafts.scope_draft_id` is nullable, so that branch was reachable.
 *
 * These tests drive the real routers through `createCaller`. Data-layer counters prove an
 * unauthorized request performs no business read or write beyond the lookup needed to
 * establish authorization.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_A = "70000000-0000-4000-8000-00000000000a";
const TENANT_B = "70000000-0000-4000-8000-00000000000b";
const USER_A = "10000000-0000-4000-8000-00000000000a";
const USER_B = "10000000-0000-4000-8000-00000000000b";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const DRAFT_OF_B = "80000000-0000-4000-8000-0000000000b1";

/** Records exactly what the data layer was asked for. */
const calls = {
  listActualsOpts: [] as any[],
  listPartialOpts: [] as any[],
  getPartial: 0,
  markRetrying: 0,
  abandon: 0,
};

/** A partial draft owned by USER_B with NO parent scope draft — the reachable branch. */
const PARENTLESS_DRAFT_OF_B = {
  id: DRAFT_OF_B,
  scopeDraftId: null,
  userId: USER_B,
  status: "pending",
  partialData: { secret: "tenant-B in-flight scope data" },
  retryCount: 0,
};

vi.mock("./field-launch-db", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listProjectActuals: vi.fn(async (opts: any) => {
      calls.listActualsOpts.push(opts);
      return { items: [], total: 0 };
    }),
  };
});

vi.mock("./draft-recovery-db", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listPartialDrafts: vi.fn(async (opts: any) => {
      calls.listPartialOpts.push(opts);
      return { items: [], total: 0 };
    }),
    getPartialDraftById: vi.fn(async () => {
      calls.getPartial += 1;
      return PARENTLESS_DRAFT_OF_B;
    }),
    markPartialDraftRetrying: vi.fn(async () => {
      calls.markRetrying += 1;
      return PARENTLESS_DRAFT_OF_B;
    }),
    abandonPartialDraft: vi.fn(async () => {
      calls.abandon += 1;
      return PARENTLESS_DRAFT_OF_B;
    }),
  };
});

beforeEach(() => {
  calls.listActualsOpts = [];
  calls.listPartialOpts = [];
  calls.getPartial = 0;
  calls.markRetrying = 0;
  calls.abandon = 0;
});

async function fieldLaunchCaller(tenantId: string | null, role = "user", id = USER_A) {
  const { fieldLaunchRouter } = await import("./field-launch-router");
  return (fieldLaunchRouter as any).createCaller({ user: { id, role }, tenantId });
}
async function estimateCaller(tenantId: string | null, role = "user", id = USER_A) {
  const { estimateRouter } = await import("./estimate-router");
  return (estimateRouter as any).createCaller({ user: { id, role }, tenantId });
}

// ═════════════════════════════════════════════════════════════════════════════
// fieldLaunch.listActuals — ROOT CAUSE A
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 Class-B · fieldLaunch.listActuals", () => {
  it("1. an unresolved caller tenant is rejected", async () => {
    const caller = await fieldLaunchCaller(null);

    await expect(caller.listActuals({})).rejects.toThrow(/No tenant is assigned/);
    expect(calls.listActualsOpts).toHaveLength(0);
  });

  it("1b. an unresolved ADMIN is rejected too — a role is not a tenant", async () => {
    const caller = await fieldLaunchCaller(null, "admin");

    await expect(caller.listActuals({})).rejects.toThrow(/No tenant is assigned/);
    expect(calls.listActualsOpts).toHaveLength(0);
  });

  it("2. omitting projectId cannot execute an unscoped query", async () => {
    const caller = await fieldLaunchCaller(TENANT_A);

    await caller.listActuals({});

    // The decisive assertion: the helper is never handed an undefined business scope.
    expect(calls.listActualsOpts).toHaveLength(1);
    expect(calls.listActualsOpts[0]).toBeDefined();
    expect(calls.listActualsOpts[0].tenantId).toBe(TENANT_A);
  });

  it("3. the caller's tenant is always the one used — never a caller-supplied value", async () => {
    const caller = await fieldLaunchCaller(TENANT_A);

    // A caller cannot smuggle another tenant in through the input.
    await caller.listActuals({ tenantId: TENANT_B } as never);

    expect(calls.listActualsOpts[0].tenantId).toBe(TENANT_A);
    expect(calls.listActualsOpts[0].tenantId).not.toBe(TENANT_B);
  });

  it("4. a valid same-tenant caller succeeds", async () => {
    const caller = await fieldLaunchCaller(TENANT_A);
    // No projectId: the tenant predicate alone must be a legitimate, working scope.
    await expect(caller.listActuals({})).resolves.toBeDefined();
  });

  it("no SELECT-all behaviour is reachable: the helper itself refuses an absent tenant", async () => {
    const actual = await vi.importActual<typeof import("./field-launch-db")>(
      "./field-launch-db",
    );
    // The contract is type-level; this pins the runtime behaviour too — tenantWhere()
    // throws rather than producing `whereClause = undefined`.
    await expect(
      (actual.listProjectActuals as any)({ tenantId: null }),
    ).rejects.toThrow(/Tenant scope is unresolved/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// estimate.listPartialDrafts — ROOT CAUSE A
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 Class-B · estimate.listPartialDrafts", () => {
  it("1. an unresolved caller tenant is rejected", async () => {
    const caller = await estimateCaller(null);

    await expect(caller.listPartialDrafts({})).rejects.toThrow(/No tenant is assigned/);
    expect(calls.listPartialOpts).toHaveLength(0);
  });

  it("2/3. an ADMIN no longer lists every user's drafts across every tenant", async () => {
    const caller = await estimateCaller(TENANT_A, "admin");

    await caller.listPartialDrafts({});

    // Previously: `userId: role === "admin" ? undefined : ctx.user.id` — an unbounded read.
    expect(calls.listPartialOpts).toHaveLength(1);
    expect(calls.listPartialOpts[0].userId).toBe(USER_A);
    expect(calls.listPartialOpts[0].userId).not.toBeUndefined();
  });

  it("2b. omitting scopeDraftId narrows to the caller, never widens", async () => {
    const caller = await estimateCaller(TENANT_A);

    await caller.listPartialDrafts({});

    expect(calls.listPartialOpts[0].userId).toBe(USER_A);
  });

  it("4. a valid same-tenant caller succeeds", async () => {
    const caller = await estimateCaller(TENANT_A);
    await expect(caller.listPartialDrafts({})).resolves.toBeDefined();
  });

  it("the helper itself refuses a call with no authorization discriminator", async () => {
    const actual = await vi.importActual<typeof import("./draft-recovery-db")>(
      "./draft-recovery-db",
    );
    await expect((actual.listPartialDrafts as any)({})).rejects.toThrow(
      /requires an authorization scope/,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPartialDraft / retryPartialDraft / abandonPartialDraft — ROOT CAUSE B
// ═════════════════════════════════════════════════════════════════════════════

const OWNERSHIP_ROUTES: Array<{ name: string; call: (c: any) => Promise<unknown>; writes: boolean }> = [
  { name: "getPartialDraft", call: c => c.getPartialDraft({ id: DRAFT_OF_B }), writes: false },
  { name: "retryPartialDraft", call: c => c.retryPartialDraft({ id: DRAFT_OF_B }), writes: true },
  { name: "abandonPartialDraft", call: c => c.abandonPartialDraft({ id: DRAFT_OF_B }), writes: true },
];

describe("B2 Class-B · partial-draft ownership routes", () => {
  for (const r of OWNERSHIP_ROUTES) {
    it(`1. ${r.name}: an unresolved caller tenant is rejected`, async () => {
      const caller = await estimateCaller(null);

      await expect(r.call(caller)).rejects.toThrow(/No tenant is assigned/);
      // Rejected before the row is even loaded.
      expect(calls.getPartial).toBe(0);
      expect(calls.markRetrying + calls.abandon).toBe(0);
    });

    it(`2. ${r.name}: a cross-tenant caller is rejected`, async () => {
      const caller = await estimateCaller(TENANT_A, "user", USER_A);

      await expect(r.call(caller)).rejects.toThrow();
      expect(calls.markRetrying + calls.abandon).toBe(0);
    });

    it(`3. ${r.name}: a cross-tenant ADMIN is rejected — the fallback no longer admits admins`, async () => {
      const caller = await estimateCaller(TENANT_A, "admin", USER_A);

      // This is the exact case that previously succeeded: parent-less draft owned by a
      // user of tenant B, reached by an admin of tenant A through the `role !== "admin"`
      // arm. Ownership alone must not be replaceable by a role.
      await expect(r.call(caller)).rejects.toThrow();
      expect(calls.markRetrying + calls.abandon).toBe(0);
    });

    it(`4. ${r.name}: the owner passes authorization`, async () => {
      const caller = await estimateCaller(TENANT_B, "user", USER_B);

      // The owner must get PAST the tenant/ownership gate. Some of these routes then run
      // further business logic that needs fixtures beyond this suite's scope, so the
      // assertion is that the failure — if any — is never an authorization failure.
      const outcome = await r.call(caller).then(() => null, (e: Error) => e);
      if (outcome) {
        expect(outcome.message).not.toMatch(/No tenant is assigned/);
        expect(outcome.message).not.toMatch(/do not have access/i);
      }
    });
  }

  it("a cross-tenant admin never receives the draft payload", async () => {
    const caller = await estimateCaller(TENANT_A, "admin", USER_A);

    const result = await caller.getPartialDraft({ id: DRAFT_OF_B }).catch((e: Error) => e);

    expect(result).toBeInstanceOf(Error);
    expect(JSON.stringify(result)).not.toContain("tenant-B in-flight scope data");
  });

  it("positive control: the owner does receive the payload", async () => {
    const caller = await estimateCaller(TENANT_B, "user", USER_B);

    const result: any = await caller.getPartialDraft({ id: DRAFT_OF_B });

    // Proves the negatives above fail for authorization reasons, not a hollow fixture.
    expect(result.partialData.secret).toBe("tenant-B in-flight scope data");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The latent shape hardened in the same pass
// ═════════════════════════════════════════════════════════════════════════════

describe("B2 Class-B · the inverted admin/ownership shape is gone from estimate-router", () => {
  it("no executable `role !== \"admin\"` authorization arm remains", async () => {
    const { readFileSync } = await import("node:fs");
    const code = readFileSync("server/estimate-router.ts", "utf8")
      .split("\n")
      .filter(l => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join("\n");

    expect(code).not.toMatch(/role !== "admin" &&/);
  });
});
