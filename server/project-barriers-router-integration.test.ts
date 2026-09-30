/**
 * V2 correction (PROJECT-BARRIERS-V2-CORRECTION-CONTRACT.md): regressions that exercise
 * the REAL router (real Zod schemas), REAL project-db.ts helpers, and REAL
 * requireProjectAccess — only the true I/O boundary (getDb, logAudit) is a fake driver,
 * same convention as server/tenant-f5b-project-geo-callers.test.ts and
 * server/estimate-status-approval-guard.test.ts. This file exists specifically because
 * server/project-router.test.ts mocks the helpers entirely and therefore cannot see
 * Zod silently stripping a forbidden key BEFORE it ever reaches the barrier — the exact
 * class of bug Michael's V1 QA found. No address fields are ever sent, so the geocode
 * branch (validateAddressForGeocoding → isValid:false) never fires; geo-integration/
 * geo-geocoding are real, unmocked modules that are simply never invoked.
 *
 * MOCKED-DB unit suite, not a physical Postgres proof — no real constraint enforcement,
 * locking under real concurrency, or RLS is exercised here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: boundary.getDb }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));

import { projectRouter } from "./project-router";

const TENANT = "c3200000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c3200000-0000-4000-8000-000000000002";
const ACTOR = "c3200000-0000-4000-8000-000000000010";
const PROJECT = "c3200000-0000-4000-8000-000000000100";
const NOW = new Date("2026-09-30T12:00:00Z");

type Row = Record<string, unknown>;
const rows: Record<string, Row[]> = {};
const events: string[] = [];
let sequence = 0;

function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_m, l: string) => l.toUpperCase());
}
function matching(table: Table, predicate: SQL | undefined): Row[] {
  const name = getTableName(table);
  if (!predicate) return rows[name] ?? [];
  const query = new PgDialect().sqlToQuery(predicate);
  const conditions = [...query.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g)];
  return (rows[name] ?? []).filter(row =>
    conditions.every(([, , column, position]) => row[camel(column)] === query.params[Number(position) - 1]),
  );
}

const driver: any = {
  select: (columns?: Record<string, any>) => ({
    from: (table: Table) => {
      let predicate: SQL | undefined;
      let maximum = Infinity;
      const q: any = {
        where: (value: SQL) => { predicate = value; return q; },
        limit: (value: number) => { maximum = value; return q; },
        for: () => q,
        then: (yes: any, no?: any) =>
          Promise.resolve()
            .then(() => {
              events.push(`read:${getTableName(table)}`);
              const selected = structuredClone(matching(table, predicate).slice(0, maximum));
              return columns
                ? selected.map((row: Row) =>
                    Object.fromEntries(Object.entries(columns).map(([key, col]: [string, any]) => [key, row[camel(col.name)]])),
                  )
                : selected;
            })
            .then(yes, no),
      };
      return q;
    },
  }),
  insert: (table: Table) => ({
    values: (value: Row) => ({
      returning: async (columns?: Record<string, any>) => {
        const name = getTableName(table);
        const id = `c3200000-0000-4000-8000-9${String(++sequence).padStart(11, "0")}`;
        const row = { deletedAt: null, ...structuredClone(value), id };
        (rows[name] ??= []).push(row);
        events.push(`insert:${name}`);
        return columns ? [{ id: row.id }] : [structuredClone(row)];
      },
    }),
  }),
  update: (table: Table) => ({
    set: (patch: Row) => ({
      where: (predicate: SQL) => {
        const write = async () => {
          const name = getTableName(table);
          events.push(`write:${name}`);
          const selected = matching(table, predicate);
          for (const row of selected) Object.assign(row, patch);
          return structuredClone(selected);
        };
        return { then: (yes: any, no?: any) => write().then(yes, no) };
      },
    }),
  }),
};
const db = {
  ...driver,
  transaction: async (work: (tx: any) => Promise<any>) => {
    const before = structuredClone(rows);
    try {
      return await work(driver);
    } catch (error) {
      for (const key of Object.keys(rows)) delete rows[key];
      Object.assign(rows, before);
      throw error;
    }
  },
};

function context(tenantId: string = TENANT): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId,
    user: {
      id: ACTOR, tenantId, role: "user", isActive: true, externalOpenId: null,
      email: "operator@example.invalid", fullName: "Synthetic Operator", companyName: null,
      loginMethod: "legacy", lastSignedIn: NOW, createdAt: NOW, updatedAt: NOW,
    } as any,
  };
}
const caller = (tenantId: string = TENANT) => projectRouter.createCaller(context(tenantId));

function expectNoWrites() {
  expect(events.filter(e => e.startsWith("write:") || e.startsWith("insert:"))).toEqual([]);
  expect(boundary.audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  for (const key of Object.keys(rows)) delete rows[key];
  rows.tenants = [{ id: TENANT, isActive: true }, { id: OTHER_TENANT, isActive: true }];
  rows.profiles = [{ id: ACTOR, tenantId: TENANT, role: "user", isActive: true }];
  rows.projects = [{
    id: PROJECT, tenantId: TENANT, ownerUserId: ACTOR, deletedAt: null, status: "intake",
    name: "Synthetic Project", clientId: null, notes: null, address: null,
  }];
  rows.project_members = [];
  boundary.getDb.mockResolvedValue(db);
  boundary.audit.mockImplementation(async (params: any) => ({
    id: "audit-1", userId: params.userId, action: params.action, tableName: params.tableName,
    recordId: params.recordId, oldValues: params.before ?? null, newValues: params.after ?? null,
    createdAt: new Date(), ipAddress: null, userAgent: null,
  }));
});

describe("V2 regression: the public route must not let Zod silently strip a forbidden key", () => {
  it("project.update refuses a mixed payload WHOLESALE instead of silently applying only the legitimate field", async () => {
    // Michael's V1 finding 1, reproduced exactly: {notes, actualTotal: null} through the
    // real router. Pre-fix, actualTotal is absent from updateProjectSchema, so Zod strips
    // it before the handler runs — updateProject only ever sees {notes}, applies it, and
    // returns success. That is the bug: an attempted forbidden write silently "succeeds"
    // by having the forbidden part dropped, rather than the whole request being refused.
    const before = structuredClone(rows.projects[0]);
    await expect(caller().update({ id: PROJECT, data: { notes: "should not save", actualTotal: null } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("project.create refuses an attempted status instead of silently creating with a default", async () => {
    // Michael's V1 finding 1, create illustration: {name, status:"approved"}. Pre-fix,
    // createProjectSchema has no status field, so Zod strips it — createProject receives
    // only {name}, and happily creates an "intake" project. The attempt to force approved
    // must be refused entirely, not silently downgraded to a default-status success.
    await expect(caller().create({ name: "New Project", status: "approved" } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("project.update still allows a real formation transition once the field survives Zod (positive control)", async () => {
    const result = await caller().update({ id: PROJECT, data: { notes: "moving forward" } as any });
    expect(result.notes).toBe("moving forward");
    const withStatus = await caller().update({ id: PROJECT, data: { status: "estimating" } as any });
    expect(withStatus.status).toBe("estimating");
  });
});

describe("V2 regression: updateStatus must authorize BEFORE judging a forbidden destination", () => {
  it('an unauthorized caller requesting "closed" gets the ACL error, not a format error that reveals the rule first', async () => {
    // Pre-fix, statusEnum excludes "closed" entirely, so Zod's input parser rejects the
    // call with BAD_REQUEST before ctx/authorization is ever consulted — a caller learns
    // "closed is not a recognized shape" regardless of whether they may touch this project
    // at all. Post-fix the schema accepts any non-empty string, so requireProjectAccess
    // runs first and this cross-tenant caller is refused on ACL grounds.
    await expect(caller(OTHER_TENANT).updateStatus({ id: PROJECT, status: "closed" } as any))
      .rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    expectNoWrites();
  });

  it('an authorized caller requesting "closed" is refused by the operational barrier, proving the value DID reach the resolver', async () => {
    await expect(caller().updateStatus({ id: PROJECT, status: "closed" } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events).toContain("read:projects"); // requireProjectAccess's own project read ran
    expectNoWrites();
  });

  it("a genuinely nonsense status is still rejected once it reaches the resolver, after authorization", async () => {
    await expect(caller().updateStatus({ id: PROJECT, status: "not_a_real_status" } as any))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); // the plain Error from assertValidStatusTransition
    expectNoWrites();
  });
});
