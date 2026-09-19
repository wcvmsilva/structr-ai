/**
 * G1 — Bundles caller-axis tenant isolation (B2 / Codex P1-1).
 *
 * Before G1 the entire bundle surface ran on `protectedProcedure` over tenant-blind helpers:
 * `createBundle` never wrote `tenant_id`, `getBundleById`/`listBundles` were bare lookups, and
 * the three `bundle_items` routes mutated on a primary key alone with no parent check. Any
 * authenticated caller — including one with NO resolved tenant — could create, read, list,
 * edit, duplicate and delete any tenant's bundles. Two consumers outside `bundle-router.ts`
 * shared the exposure: `preset.delete` (a real soft-delete reaching `deleteBundle`) and
 * `estimateLegacy.sendBundleToEstimate`, which copied a foreign bundle's contents into the
 * caller's own `estimate_drafts` row.
 *
 * These tests drive the REAL routers and the REAL `server/db.ts` helpers through
 * `appRouter.createCaller`. Only the postgres driver is faked, so a request travels the whole
 * production path down to the SQL builder.
 *
 * ── WHAT THE FAKE PROVES, AND WHAT IT DOES NOT ───────────────────────────────
 * The suite has no live Postgres (`server/env.test.ts` — `DATABASE_URL` is unset under
 * vitest), so the driver is faked. The fake is deliberately PERMISSIVE: it applies no tenant
 * filtering of its own and hands back whatever row the test configured. A cross-tenant read
 * that still yields "not found" therefore proves the code refused the row, not that the fake
 * hid it. Writes are proven by counters: an unauthorized request must leave `driver.inserts`,
 * `driver.updates` and `driver.deletes` untouched. Where isolation rests on the emitted
 * predicate rather than a post-check (`bundle.list`), the predicate itself is serialized with
 * `PgDialect` and asserted to bind the caller's tenant and never the foreign one — the method
 * `client-tenant-isolation.test.ts` established. Row-level proof against a real Postgres would
 * need an integration harness this project does not have.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * G1 closes the CALLER axis. The final block documents legacy `tenant_id IS NULL` behaviour
 * under transitional mode; it is F15 / issue #10 SURFACE DOCUMENTATION, explicitly NOT proof
 * of row isolation, and TENANT_STRICT is never enabled.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { bundles, bundleItems, estimateDrafts } from "../drizzle/schema";

const TENANT_A = "90000000-0000-4000-8000-00000000000a";
const TENANT_B = "90000000-0000-4000-8000-00000000000b";
const USER_A = "a0000000-0000-4000-8000-00000000000a";
const PROJECT_A = "b0000000-0000-4000-8000-000000000001";

const BUNDLE_OF_A = "c0000000-0000-4000-8000-0000000000a1";
const BUNDLE_OF_B = "c0000000-0000-4000-8000-0000000000b1";
const ITEM_OF_B = "d0000000-0000-4000-8000-0000000000b1";
const ASSEMBLY = "e0000000-0000-4000-8000-000000000001";
const NEW_ID = "f0000000-0000-4000-8000-000000000001";

const bundleRowOfB = {
  id: BUNDLE_OF_B,
  tenantId: TENANT_B,
  name: "Tenant B — Coastal Package",
  description: "tenant B commercial content",
  category: "general",
  bundleDiscount: "0.08",
  region: "Charleston, SC",
  isActive: true,
  isCustomizable: true,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const bundleRowOfA = {
  ...bundleRowOfB,
  id: BUNDLE_OF_A,
  tenantId: TENANT_A,
  name: "Tenant A — Kitchen Package",
  description: "tenant A content",
};

const itemRowOfB = {
  id: ITEM_OF_B,
  bundleId: BUNDLE_OF_B,
  assemblyId: ASSEMBLY,
  quantity: "3",
  isOptional: false,
  overrideQty: null,
  sortOrder: 1,
  notes: null,
};

// ── Permissive fake driver ───────────────────────────────────────────────────
// Records every operation and applies NO tenant filtering, so any isolation observed in a
// test came from the code under test.

type Op = { table: string; where?: SQL; values?: unknown; set?: unknown };

const driver = {
  selects: [] as Op[],
  inserts: [] as Op[],
  updates: [] as Op[],
  deletes: [] as Op[],
  rows: { bundles: [] as unknown[], bundle_items: [] as unknown[], estimate_drafts: [] as unknown[], other: [] as unknown[] },
};

function reset() {
  driver.selects = [];
  driver.inserts = [];
  driver.updates = [];
  driver.deletes = [];
  driver.rows = { bundles: [], bundle_items: [], estimate_drafts: [], other: [] };
}

function tableName(t: unknown): string {
  if (t === bundles) return "bundles";
  if (t === bundleItems) return "bundle_items";
  if (t === estimateDrafts) return "estimate_drafts";
  return "other";
}

/** Every business write the fake saw, regardless of table. */
function businessWrites() {
  return driver.inserts.length + driver.updates.length + driver.deletes.length;
}

function makeChain(op: "select" | "insert" | "update" | "delete", table: string) {
  const state: Op = { table };
  const chain: Record<string, unknown> = {};

  chain.from = (t: unknown) => { state.table = tableName(t); return chain; };
  chain.where = (c: SQL | undefined) => { state.where = c; return chain; };
  chain.set = (v: unknown) => { state.set = v; return chain; };
  chain.values = (v: unknown) => { state.values = v; return chain; };
  for (const m of ["returning", "limit", "offset", "orderBy", "onConflictDoUpdate", "onConflictDoNothing"]) {
    chain[m] = () => chain;
  }

  chain.then = (resolve: (rows: unknown[]) => unknown) => {
    if (op === "select") {
      driver.selects.push({ ...state });
      const key = state.table as keyof typeof driver.rows;
      return resolve((driver.rows[key] ?? []) as unknown[]);
    }
    if (op === "insert") {
      driver.inserts.push({ ...state });
      const vals = state.values;
      const rows = Array.isArray(vals) ? vals : [vals];
      return resolve(rows.map((v, i) => ({ id: i === 0 ? NEW_ID : `${NEW_ID}-${i}`, ...(v as object) })));
    }
    if (op === "update") { driver.updates.push({ ...state }); return resolve([]); }
    driver.deletes.push({ ...state });
    return resolve([]);
  };

  return chain;
}

const fakeDb = {
  select: () => makeChain("select", "other"),
  insert: (t: unknown) => makeChain("insert", tableName(t)),
  update: (t: unknown) => makeChain("update", tableName(t)),
  delete: (t: unknown) => makeChain("delete", tableName(t)),
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
};

process.env.DATABASE_URL = "postgres://fake/g1";

vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));

vi.mock("drizzle-orm/postgres-js", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, drizzle: vi.fn(() => fakeDb) };
});

vi.mock("./audit", () => ({
  logAudit: vi.fn(async () => undefined),
  withAuditLog: vi.fn(async (_m: unknown, fn: () => unknown) => fn()),
}));

// The project half of `sendBundleToEstimate` is already hardened (PHASE 1) and is not what
// this unit tests: it is allowed to pass so the BUNDLE check is the deciding factor.
vi.mock("./project-access", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireProjectAccessTrpc: vi.fn(async () => ({ projectId: PROJECT_A, role: "owner" })),
    requireEntityAccess: vi.fn(async () => undefined),
  };
});

const { appRouter } = await import("./routers");
const { TENANT_UNRESOLVED_ERR_MSG } = await import("./_core/trpc");

// ── Callers ──────────────────────────────────────────────────────────────────

function ctxFor(tenantId: string | null, role: "user" | "admin" = "user") {
  return {
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
    user: { id: USER_A, name: "Caller", role, tenantId },
    tenantId,
    authProvider: "legacy",
  } as never;
}

const callerA = () => appRouter.createCaller(ctxFor(TENANT_A));
const callerAdminA = () => appRouter.createCaller(ctxFor(TENANT_A, "admin"));
const unresolved = () => appRouter.createCaller(ctxFor(null));
const unresolvedAdmin = () => appRouter.createCaller(ctxFor(null, "admin"));

function predicateSql(where: SQL | undefined): string {
  if (!where) return "";
  const q = new PgDialect().sqlToQuery(where);
  return `${q.sql} :: ${JSON.stringify(q.params)}`;
}

beforeEach(() => { reset(); });

// ═════════════════════════════════════════════════════════════════════════════
// 1. UNRESOLVED CALLER — every business route on the measured surface
// ═════════════════════════════════════════════════════════════════════════════

describe("G1 · an unresolved caller tenant grants zero bundle access", () => {
  const invocations: Array<[string, (c: ReturnType<typeof unresolved>) => Promise<unknown>]> = [
    ["bundle.create", c => c.bundle.create({ name: "Should never exist" })],
    ["bundle.getById", c => c.bundle.getById({ id: BUNDLE_OF_A })],
    ["bundle.list", c => c.bundle.list({ activeOnly: true })],
    ["bundle.updateMeta", c => c.bundle.updateMeta({ id: BUNDLE_OF_A, name: "renamed" })],
    ["bundle.addItem", c => c.bundle.addItem({ bundleId: BUNDLE_OF_A, assemblyId: ASSEMBLY })],
    ["bundle.updateItemQuantity", c => c.bundle.updateItemQuantity({ bundleItemId: ITEM_OF_B, quantity: "9" })],
    ["bundle.removeItem", c => c.bundle.removeItem({ bundleItemId: ITEM_OF_B })],
    ["bundle.duplicate", c => c.bundle.duplicate({ bundleId: BUNDLE_OF_A, newName: "copy" })],
    ["bundle.delete", c => c.bundle.delete({ bundleId: BUNDLE_OF_A })],
    ["preset.delete", c => c.preset.delete({ bundleId: BUNDLE_OF_A })],
    ["estimateLegacy.sendBundleToEstimate", c => c.estimateLegacy.sendBundleToEstimate({ bundleId: BUNDLE_OF_A, projectId: PROJECT_A })],
  ];

  for (const [name, invoke] of invocations) {
    it(`rejects ${name} with FORBIDDEN and performs no business write`, async () => {
      driver.rows.bundles = [bundleRowOfA];
      driver.rows.bundle_items = [itemRowOfB];

      await expect(invoke(unresolved())).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
      expect(businessWrites()).toBe(0);
    });
  }

  it("an ADMIN without a resolved tenant is refused too — role is not a tenant", async () => {
    driver.rows.bundles = [bundleRowOfA];
    await expect(unresolvedAdmin().bundle.list({})).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    await expect(unresolvedAdmin().bundle.delete({ bundleId: BUNDLE_OF_A })).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    expect(businessWrites()).toBe(0);
  });

  it("performs no read of business data either — the boundary is before the helper", async () => {
    driver.rows.bundles = [bundleRowOfA];
    await expect(unresolved().bundle.getById({ id: BUNDLE_OF_A })).rejects.toThrow();
    expect(driver.selects).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CROSS-TENANT READS AND WRITES
// ═════════════════════════════════════════════════════════════════════════════

describe("G1 · a resolved tenant cannot reach an explicitly foreign bundle", () => {
  beforeEach(() => {
    // The fake hands back tenant B's row for every lookup. Anything that still fails,
    // failed because the code refused it.
    driver.rows.bundles = [bundleRowOfB];
    driver.rows.bundle_items = [itemRowOfB];
  });

  it("bundle.getById does not return it", async () => {
    await expect(callerA().bundle.getById({ id: BUNDLE_OF_B })).rejects.toThrow(/not found/i);
  });

  it("bundle.updateMeta cannot rename it — zero updates", async () => {
    await expect(
      callerA().bundle.updateMeta({ id: BUNDLE_OF_B, name: "seized" }),
    ).rejects.toThrow(/not found/i);
    expect(driver.updates).toHaveLength(0);
  });

  it("bundle.delete cannot soft-delete it — zero updates", async () => {
    await expect(callerA().bundle.delete({ bundleId: BUNDLE_OF_B })).rejects.toThrow(/not found/i);
    expect(driver.updates).toHaveLength(0);
  });

  it("a cross-tenant ADMIN is refused exactly like a plain user", async () => {
    await expect(
      callerAdminA().bundle.updateMeta({ id: BUNDLE_OF_B, name: "seized by admin" }),
    ).rejects.toThrow(/not found/i);
    await expect(callerAdminA().bundle.delete({ bundleId: BUNDLE_OF_B })).rejects.toThrow(/not found/i);
    expect(businessWrites()).toBe(0);
  });

  it("the refusal does not disclose that the foreign bundle exists", async () => {
    const foreign = await callerA().bundle.getById({ id: BUNDLE_OF_B }).catch(e => e as Error);
    driver.rows.bundles = [];
    const missing = await callerA().bundle.getById({ id: BUNDLE_OF_B }).catch(e => e as Error);
    expect((foreign as Error).message).toBe((missing as Error).message);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. bundle_items — authorization derives from the PARENT bundle
// ═════════════════════════════════════════════════════════════════════════════

describe("G1 · bundle items are authorized through the parent bundle, never by item id", () => {
  beforeEach(() => {
    driver.rows.bundles = [bundleRowOfB];   // the parent the item resolves to
    driver.rows.bundle_items = [itemRowOfB];
  });

  it("a foreign bundle item cannot be updated — zero updates", async () => {
    await expect(
      callerA().bundle.updateItemQuantity({ bundleItemId: ITEM_OF_B, quantity: "999" }),
    ).rejects.toThrow(/not found/i);
    expect(driver.updates).toHaveLength(0);
  });

  it("a foreign bundle item cannot be removed — zero deletes", async () => {
    await expect(callerA().bundle.removeItem({ bundleItemId: ITEM_OF_B })).rejects.toThrow(/not found/i);
    expect(driver.deletes).toHaveLength(0);
  });

  it("addItem cannot target a foreign bundle — zero inserts", async () => {
    await expect(
      callerA().bundle.addItem({ bundleId: BUNDLE_OF_B, assemblyId: ASSEMBLY }),
    ).rejects.toThrow(/not found/i);
    expect(driver.inserts).toHaveLength(0);
  });

  it("the parent bundle is read before any item mutation is attempted", async () => {
    await callerA().bundle.removeItem({ bundleItemId: ITEM_OF_B }).catch(() => undefined);
    const tables = driver.selects.map(s => s.table);
    expect(tables).toContain("bundle_items");   // resolve the item to learn its parent
    expect(tables).toContain("bundles");        // then authorize that parent
    expect(driver.deletes).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. OWNERSHIP OF WRITES — create and duplicate
// ═════════════════════════════════════════════════════════════════════════════

describe("G1 · new bundles are stamped with the caller's resolved tenant", () => {
  it("create stamps ctx.tenantId", async () => {
    const created = await callerA().bundle.create({ name: "Tenant A bundle" });
    expect(driver.inserts).toHaveLength(1);
    expect(driver.inserts[0].table).toBe("bundles");
    expect((driver.inserts[0].values as { tenantId?: string }).tenantId).toBe(TENANT_A);
    expect((created as { tenantId?: string }).tenantId).toBe(TENANT_A);
  });

  it("create never writes a NULL-owned bundle", async () => {
    await callerA().bundle.create({ name: "Tenant A bundle" });
    const values = driver.inserts[0].values as { tenantId?: string | null };
    expect(values.tenantId).toBeTruthy();
    expect(values.tenantId).not.toBeNull();
  });

  it("create ignores a caller-supplied tenantId — ownership comes from context only", async () => {
    // Cast past the input schema exactly as a hostile client would try to.
    await callerA().bundle.create({ name: "Injected", tenantId: TENANT_B } as never);
    expect((driver.inserts[0].values as { tenantId?: string }).tenantId).toBe(TENANT_A);
  });

  it("duplicate cannot clone a foreign bundle — zero inserts", async () => {
    driver.rows.bundles = [bundleRowOfB];
    driver.rows.bundle_items = [itemRowOfB];
    await expect(
      callerA().bundle.duplicate({ bundleId: BUNDLE_OF_B, newName: "stolen copy" }),
    ).rejects.toThrow(/not found/i);
    expect(driver.inserts).toHaveLength(0);
  });

  it("a duplicate of an own bundle is owned by ctx.tenantId, not by the source row", async () => {
    // Source carries a DIFFERENT tenantId than the caller to prove ownership is not copied.
    // (Reachable in production for a legacy NULL-owned source; the assertion is the same.)
    driver.rows.bundles = [{ ...bundleRowOfA, tenantId: null }];
    driver.rows.bundle_items = [];
    await callerA().bundle.duplicate({ bundleId: BUNDLE_OF_A, newName: "copy" });
    const bundleInsert = driver.inserts.find(i => i.table === "bundles");
    expect(bundleInsert).toBeDefined();
    expect((bundleInsert!.values as { tenantId?: string | null }).tenantId).toBe(TENANT_A);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. LIST SCOPING — proven on the emitted predicate
// ═════════════════════════════════════════════════════════════════════════════

describe("G1 · bundle.list is tenant-scoped", () => {
  it("binds the caller's tenant and never a foreign tenant", async () => {
    driver.rows.bundles = [bundleRowOfA];
    await callerA().bundle.list({ activeOnly: true });

    const select = driver.selects.find(s => s.table === "bundles");
    expect(select).toBeDefined();
    const sql = predicateSql(select!.where);
    expect(sql).toContain(TENANT_A);
    expect(sql).not.toContain(TENANT_B);
    expect(sql).toContain("tenant_id");
  });

  it("the tenant predicate is present even when activeOnly is disabled", async () => {
    driver.rows.bundles = [bundleRowOfA];
    await callerA().bundle.list({ activeOnly: false });
    const select = driver.selects.find(s => s.table === "bundles");
    expect(predicateSql(select!.where)).toContain(TENANT_A);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. THE TWO CONSUMERS OUTSIDE bundle-router.ts
// ═════════════════════════════════════════════════════════════════════════════

describe("G1 · preset.delete is part of the bundle surface", () => {
  it("cannot soft-delete a foreign bundle — zero updates", async () => {
    driver.rows.bundles = [bundleRowOfB];
    await expect(callerA().preset.delete({ bundleId: BUNDLE_OF_B })).rejects.toThrow(/not found/i);
    expect(driver.updates).toHaveLength(0);
  });

  it("still deletes the caller's own bundle (positive control)", async () => {
    driver.rows.bundles = [bundleRowOfA];
    await expect(callerA().preset.delete({ bundleId: BUNDLE_OF_A })).resolves.toEqual({ success: true });
    expect(driver.updates).toHaveLength(1);
    expect(driver.updates[0].table).toBe("bundles");
  });
});

describe("G1 · estimateLegacy.sendBundleToEstimate cannot import a foreign bundle", () => {
  it("does not persist tenant B's bundle into tenant A's estimate draft", async () => {
    driver.rows.bundles = [bundleRowOfB];
    driver.rows.bundle_items = [itemRowOfB];

    await expect(
      callerA().estimateLegacy.sendBundleToEstimate({ bundleId: BUNDLE_OF_B, projectId: PROJECT_A }),
    ).rejects.toThrow(/not found/i);

    expect(driver.inserts.filter(i => i.table === "estimate_drafts")).toHaveLength(0);
    expect(businessWrites()).toBe(0);
  });

  it("the project guard alone is not sufficient — the bundle is checked as well", async () => {
    // Project access is mocked to SUCCEED, so only the bundle check can produce this refusal.
    driver.rows.bundles = [bundleRowOfB];
    driver.rows.bundle_items = [itemRowOfB];
    await expect(
      callerA().estimateLegacy.sendBundleToEstimate({ bundleId: BUNDLE_OF_B, projectId: PROJECT_A }),
    ).rejects.toThrow(/not found/i);
  });

  it("still imports the caller's own bundle (positive control)", async () => {
    driver.rows.bundles = [bundleRowOfA];
    driver.rows.bundle_items = [{ ...itemRowOfB, bundleId: BUNDLE_OF_A }];
    await callerA().estimateLegacy.sendBundleToEstimate({ bundleId: BUNDLE_OF_A, projectId: PROJECT_A });
    expect(driver.inserts.filter(i => i.table === "estimate_drafts")).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. POSITIVE CONTROLS — same-tenant behaviour is unchanged
// ═════════════════════════════════════════════════════════════════════════════

describe("G1 · same-tenant operations still work", () => {
  beforeEach(() => {
    driver.rows.bundles = [bundleRowOfA];
    driver.rows.bundle_items = [{ ...itemRowOfB, id: ITEM_OF_B, bundleId: BUNDLE_OF_A }];
  });

  it("getById returns the caller's own bundle with its items", async () => {
    const b = await callerA().bundle.getById({ id: BUNDLE_OF_A });
    expect(b.id).toBe(BUNDLE_OF_A);
    expect(b.items).toHaveLength(1);
  });

  it("list returns rows", async () => {
    expect(await callerA().bundle.list({ activeOnly: true })).toHaveLength(1);
  });

  it("updateMeta renames the caller's own bundle", async () => {
    await callerA().bundle.updateMeta({ id: BUNDLE_OF_A, name: "renamed" });
    expect(driver.updates).toHaveLength(1);
    expect((driver.updates[0].set as { name?: string }).name).toBe("renamed");
  });

  it("addItem inserts into the caller's own bundle", async () => {
    await callerA().bundle.addItem({ bundleId: BUNDLE_OF_A, assemblyId: ASSEMBLY, quantity: "2" });
    const insert = driver.inserts.find(i => i.table === "bundle_items");
    expect(insert).toBeDefined();
    expect((insert!.values as { bundleId?: string }).bundleId).toBe(BUNDLE_OF_A);
  });

  it("updateItemQuantity updates an item of the caller's own bundle", async () => {
    await callerA().bundle.updateItemQuantity({ bundleItemId: ITEM_OF_B, quantity: "7" });
    expect(driver.updates).toHaveLength(1);
    expect((driver.updates[0].set as { quantity?: string }).quantity).toBe("7");
  });

  it("removeItem deletes an item of the caller's own bundle", async () => {
    await callerA().bundle.removeItem({ bundleItemId: ITEM_OF_B });
    expect(driver.deletes).toHaveLength(1);
    expect(driver.deletes[0].table).toBe("bundle_items");
  });

  it("duplicate copies the caller's own bundle and its items", async () => {
    await callerA().bundle.duplicate({ bundleId: BUNDLE_OF_A, newName: "copy" });
    expect(driver.inserts.filter(i => i.table === "bundles")).toHaveLength(1);
    expect(driver.inserts.filter(i => i.table === "bundle_items")).toHaveLength(1);
  });

  it("delete soft-deletes the caller's own bundle", async () => {
    await expect(callerA().bundle.delete({ bundleId: BUNDLE_OF_A })).resolves.toEqual({ success: true });
    expect((driver.updates[0].set as { isActive?: boolean }).isActive).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. F15 SURFACE DOCUMENTATION — NOT G1 ISOLATION PROOF
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️  READ THIS BEFORE CITING ANY ASSERTION BELOW.
 *
 * These assertions DOCUMENT the transitional ROW-axis behaviour of legacy
 * `tenant_id IS NULL` bundles. They are NOT proof of tenant isolation and must never be
 * quoted as G1 evidence. G1 closes the CALLER axis; legacy NULL rows remain the subject of
 * F15 / issue #10.
 *
 * TENANT_STRICT is NOT enabled here, globally or otherwise. `isStrictTenantMode()` reads
 * `process.env.TENANT_STRICT` at call time and it is left untouched, so these tests observe
 * the default rollout mode — which is exactly the behaviour being documented.
 */
describe("F15 SURFACE (documentation, not G1 proof) · legacy tenant_id IS NULL bundles", () => {
  const legacyNullBundle = { ...bundleRowOfA, tenantId: null };

  it("is still readable by a resolved tenant while TENANT_STRICT is off", async () => {
    expect(process.env.TENANT_STRICT).toBeFalsy();   // the flag is not set by this suite
    driver.rows.bundles = [legacyNullBundle];
    driver.rows.bundle_items = [];

    const b = await callerA().bundle.getById({ id: BUNDLE_OF_A });
    expect(b.tenantId).toBeNull();   // F15: unresolved ownership, still visible. Not isolation.
  });

  it("is still mutable by a resolved tenant while TENANT_STRICT is off", async () => {
    driver.rows.bundles = [legacyNullBundle];
    await callerA().bundle.updateMeta({ id: BUNDLE_OF_A, name: "edited legacy row" });
    expect(driver.updates).toHaveLength(1);   // F15 fallout, documented deliberately.
  });

  it("the list predicate carries the transitional NULL arm alongside the tenant match", async () => {
    driver.rows.bundles = [legacyNullBundle];
    await callerA().bundle.list({ activeOnly: true });
    const select = driver.selects.find(s => s.table === "bundles");
    const sql = predicateSql(select!.where);
    expect(sql).toContain(TENANT_A);
    expect(sql.toLowerCase()).toContain("is null");   // the F15 arm, still present by design
  });

  it("BUT an unresolved caller still gets nothing — the caller axis is closed regardless", async () => {
    driver.rows.bundles = [legacyNullBundle];
    await expect(unresolved().bundle.getById({ id: BUNDLE_OF_A })).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    expect(driver.selects).toHaveLength(0);
  });
});
