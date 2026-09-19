/**
 * `leads.diagSchema` — platform/debug capabilities must not be reachable by a tenant admin.
 *
 * The endpoint used to run everything inside a `SET LOCAL role = 'postgres'` transaction
 * behind nothing but `ctx.user.role === "admin"`, and returned:
 *   - `SELECT id, full_name, role FROM profiles LIMIT 5` with no tenant predicate;
 *   - RLS policy source for `leads` (`qual`, `with_check`);
 *   - trigger and function bodies (`pg_get_triggerdef`, `pg_get_functiondef`, `prosrc`).
 *
 * `profiles.role === "admin"` is a per-profile role — a tenant administrator, not a
 * platform operator — so a tenant-A admin could read tenant-B profile rows and the
 * database's own authorization rules.
 *
 * These tests pin the two halves of the correction:
 *   1. the schema-internals half is fail-closed: unavailable in production for any role,
 *      and off elsewhere unless explicitly opted in;
 *   2. the profile sample that remains is scoped to the caller's own tenant.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { profiles } from "../drizzle/schema";

const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";

// ── Fake database handle ─────────────────────────────────────────────────────
// Records every WHERE predicate and every raw SQL statement executed, so a test can
// assert both what was asked for and whether the elevated transaction ran at all.

const dbState: {
  wheres: SQL[];
  executed: string[];
  transactionOpened: boolean;
} = { wheres: [], executed: [], transactionOpened: false };

const dialect = new PgDialect();

function createSelect() {
  const chain: Record<string, unknown> = {};
  const self = (..._args: unknown[]) => chain;
  for (const method of ["from", "orderBy", "limit", "offset"]) chain[method] = self;
  chain.where = (condition: SQL | undefined) => {
    if (condition) dbState.wheres.push(condition);
    return chain;
  };
  chain.then = (resolve: (rows: unknown[]) => unknown) =>
    resolve([{ id: "p1", fullName: "Tenant A Person", role: "admin" }]);
  return chain;
}

const tx = {
  execute: async (statement: SQL) => {
    dbState.executed.push(dialect.sqlToQuery(statement).sql);
    return [];
  },
  select: () => createSelect(),
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    select: () => createSelect(),
    transaction: async (fn: (handle: unknown) => unknown) => {
      dbState.transactionOpened = true;
      return fn(tx);
    },
  })),
  getRawClient: vi.fn(async () => null),
}));

// The router pulls in the whole tRPC surface; stub the collaborators diagSchema
// never touches so the module loads in isolation.
vi.mock("./lead-db", () => ({}));
vi.mock("./pipeline-db", () => ({ orchestrateLeadConversion: vi.fn(), PipelineTenantError: class extends Error {} }));
vi.mock("./lead-conversion", () => ({
  convertLeadToProject: vi.fn(),
  planLeadConversion: vi.fn(),
  resolveProjectGeoContext: vi.fn(),
  LeadConversionError: class extends Error { code = "X"; },
}));

function adminCtx(tenantId: string | null) {
  return { user: { id: "u1", role: "admin" }, tenantId } as any;
}

/** Invoke the diagSchema resolver directly, bypassing the tRPC caller plumbing. */
async function callDiagSchema(ctx: ReturnType<typeof adminCtx>) {
  const { leadRouter } = await import("./lead-router");
  const def: any = (leadRouter as any)._def.procedures.diagSchema._def;
  const resolver = def.resolver ?? def.resolve ?? def.middlewares?.at(-1);
  return resolver({ ctx, input: undefined, type: "query", path: "diagSchema" });
}

describe("leads.diagSchema — schema internals are not a tenant-admin capability", () => {
  beforeEach(() => {
    dbState.wheres = [];
    dbState.executed = [];
    dbState.transactionOpened = false;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.SCHEMA_DIAGNOSTICS;
    delete process.env.NODE_ENV;
  });

  it("a tenant admin cannot retrieve RLS policy definitions", async () => {
    process.env.NODE_ENV = "production";
    process.env.SCHEMA_DIAGNOSTICS = "true"; // even opted in, production wins

    const result: any = await callDiagSchema(adminCtx(TENANT_A));

    expect(result.rlsPolicies).toBeUndefined();
    expect(result.rlsStatus).toBeUndefined();
    expect(result.schemaDiagnostics).toBe("disabled");
    // Nothing was asked of pg_policies at all.
    expect(dbState.executed.join(" ")).not.toContain("pg_policies");
    expect(dbState.executed.join(" ")).not.toContain("with_check");
  });

  it("a tenant admin cannot retrieve function bodies", async () => {
    process.env.NODE_ENV = "production";
    process.env.SCHEMA_DIAGNOSTICS = "true";

    const result: any = await callDiagSchema(adminCtx(TENANT_A));

    expect(result.triggerFunctions).toBeUndefined();
    expect(result.authFunctions).toBeUndefined();
    expect(result.triggers).toBeUndefined();
    const executed = dbState.executed.join(" ");
    expect(executed).not.toContain("pg_get_functiondef");
    expect(executed).not.toContain("pg_get_triggerdef");
    expect(executed).not.toContain("prosrc");
  });

  it("the schema half stays off outside production unless explicitly opted in", async () => {
    process.env.NODE_ENV = "development";
    // SCHEMA_DIAGNOSTICS unset

    const result: any = await callDiagSchema(adminCtx(TENANT_A));

    expect(result.schemaDiagnostics).toBe("disabled");
    expect(result.rlsPolicies).toBeUndefined();
  });

  it("the production-reachable path never opens the elevated transaction", async () => {
    process.env.NODE_ENV = "production";

    await callDiagSchema(adminCtx(TENANT_A));

    expect(dbState.transactionOpened).toBe(false);
    expect(dbState.executed.join(" ")).not.toContain("SET LOCAL role");
  });

  it("the opt-in gate is fail-closed for anything but an exact 'true'", async () => {
    const { isSchemaDiagnosticsEnabled } = await import("./lead-router");

    expect(isSchemaDiagnosticsEnabled({ NODE_ENV: "production", SCHEMA_DIAGNOSTICS: "true" } as any)).toBe(false);
    expect(isSchemaDiagnosticsEnabled({ NODE_ENV: "development" } as any)).toBe(false);
    for (const raw of ["1", "yes", "on", "TRUE", "", undefined]) {
      expect(
        isSchemaDiagnosticsEnabled({ NODE_ENV: "development", SCHEMA_DIAGNOSTICS: raw } as any),
      ).toBe(false);
    }
    // The single combination that enables it.
    expect(isSchemaDiagnosticsEnabled({ NODE_ENV: "development", SCHEMA_DIAGNOSTICS: "true" } as any)).toBe(true);
  });
});

describe("leads.diagSchema — the profile sample is tenant-scoped", () => {
  beforeEach(() => {
    dbState.wheres = [];
    dbState.executed = [];
    dbState.transactionOpened = false;
    vi.resetModules();
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    delete process.env.SCHEMA_DIAGNOSTICS;
    delete process.env.NODE_ENV;
  });

  it("profiles are bound to the caller's tenant, never another's", async () => {
    await callDiagSchema(adminCtx(TENANT_A));

    expect(dbState.wheres).toHaveLength(1);
    const { sql, params } = dialect.sqlToQuery(dbState.wheres[0]);
    expect(sql).toContain("tenant_id");
    expect(params).toContain(TENANT_A);
    expect(params).not.toContain(TENANT_B);
  });

  it("the predicate is strict equality — no NULL-tenant tolerance on a diagnostic", async () => {
    await callDiagSchema(adminCtx(TENANT_A));

    const { sql } = dialect.sqlToQuery(dbState.wheres[0]);
    expect(sql).not.toContain("is null");
  });

  it("an unresolved tenant yields no profiles at all rather than everyone's", async () => {
    const result: any = await callDiagSchema(adminCtx(null));

    expect(result.profilesSample).toEqual([]);
    // No query was issued, so there is no unfiltered LIMIT to leak.
    expect(dbState.wheres).toHaveLength(0);
  });

  it("a non-admin is still refused outright", async () => {
    const ctx = { user: { id: "u1", role: "viewer" }, tenantId: TENANT_A } as any;

    await expect(callDiagSchema(ctx)).rejects.toThrow("Admin access required");
  });
});
