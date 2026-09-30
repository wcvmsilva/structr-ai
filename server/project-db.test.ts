/**
 * Real requireProjectAccess (server/project-access.ts) and the real payload/transition
 * guards (shared/project-operation-guard.ts, assertValidStatusTransition) run against a
 * lightweight in-memory relational driver — the driver replaces only the true I/O
 * boundary (getDb, logAudit), same convention as server/estimate-status-approval-guard.test.ts.
 * This is a MOCKED-DB unit suite, not a physical Postgres proof: it proves the helper's own
 * control flow (order, payload refusal, transaction/audit coupling), not real constraint
 * enforcement, locking semantics under real concurrency, or RLS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const boundary = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: boundary.getDb }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));

import {
  createProject,
  updateProject,
  updateProjectStatus,
  assertValidStatusTransition,
} from "./project-db";
import { ProjectAccessError } from "./project-access";
import { ProjectOperationBlockedError } from "@shared/project-operation-guard";

const TENANT = "c3000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c3000000-0000-4000-8000-000000000002";
const ACTOR = "c3000000-0000-4000-8000-000000000010";
const OUTSIDER = "c3000000-0000-4000-8000-000000000011";
const PROJECT = "c3000000-0000-4000-8000-000000000100";

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
        const id = `c3000000-0000-4000-8000-9${String(++sequence).padStart(11, "0")}`;
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

function expectNoWrites() {
  expect(events.filter(e => e.startsWith("write:") || e.startsWith("insert:"))).toEqual([]);
  expect(boundary.audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  for (const key of Object.keys(rows)) delete rows[key];
  rows.tenants = [{ id: TENANT, isActive: true }];
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

describe("assertValidStatusTransition (pure)", () => {
  it("allows a real next hop", () => {
    expect(() => assertValidStatusTransition("intake", "estimating")).not.toThrow();
  });
  it("rejects a hop absent from the table", () => {
    expect(() => assertValidStatusTransition("cancelled", "estimating")).toThrow(/Invalid status transition/);
  });
});

describe("updateProject", () => {
  it("applies a formation-safe payload (notes+address) under real owner authorization", async () => {
    const result = await updateProject(PROJECT, { notes: "Site visit done", address: "12 Main St" }, ACTOR, TENANT);
    expect(result.notes).toBe("Site visit done");
    expect(result.address).toBe("12 Main St");
    expect(events).toEqual(["read:projects", "read:profiles", "read:projects", "write:projects", "read:projects"]);
    expect(boundary.audit).toHaveBeenCalledTimes(1);
    expect(boundary.audit.mock.calls[0][0]).toMatchObject({ action: "project.update", tableName: "projects", recordId: PROJECT, userId: ACTOR });
  });

  it.each(["approved", "in_progress", "completed", "closed"])("refuses status=%s even called directly, with no write and no audit", async status => {
    const before = structuredClone(rows.projects[0]);
    await expect(updateProject(PROJECT, { status: status as any }, ACTOR, TENANT)).rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("refuses the whole payload when a forbidden direct field carries a defined value, alongside a legitimate field", async () => {
    const before = structuredClone(rows.projects[0]);
    await expect(updateProject(PROJECT, { notes: "should not save", estimatedTotal: "9999.00" } as any, ACTOR, TENANT))
      .rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("refuses an explicit null on a forbidden field, not only a truthy value", async () => {
    await expect(updateProject(PROJECT, { actualTotal: null } as any, ACTOR, TENANT))
      .rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expectNoWrites();
  });

  it("refuses the router's alias key for a governed field even though it has no dedicated UpdateProjectInput field", async () => {
    // estimatedValue is only declared in project-router.ts's Zod schema, never in
    // UpdateProjectInput — proves the barrier inspects the raw payload, not the type.
    await expect(updateProject(PROJECT, { estimatedValue: "500" } as any, ACTOR, TENANT))
      .rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expectNoWrites();
  });

  it("still enforces the transition table for a status that survives the operational barrier", async () => {
    rows.projects[0].status = "cancelled";
    // cancelled's only legal next hop is "intake"; "estimating" is legitimate-category but
    // not a legal transition from this state — must be the ORIGINAL transition error, not
    // the operational-destination barrier.
    await expect(updateProject(PROJECT, { status: "estimating" }, ACTOR, TENANT))
      .rejects.toThrow(/Invalid status transition: cancelled/);
    expectNoWrites();
  });

  it("authorization precedes the operational barrier: a cross-tenant caller is refused before the payload is even inspected", async () => {
    rows.profiles.push({ id: OUTSIDER, tenantId: OTHER_TENANT, role: "user", isActive: true });
    const before = structuredClone(rows.projects[0]);
    const error = await updateProject(PROJECT, { status: "approved" }, OUTSIDER, OTHER_TENANT).catch(e => e);
    expect(error).toBeInstanceOf(ProjectAccessError);
    expect(error).not.toBeInstanceOf(ProjectOperationBlockedError);
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("fails closed before any DB access when actor or tenant context is missing", async () => {
    await expect(updateProject(PROJECT, { notes: "x" }, "", TENANT)).rejects.toBeInstanceOf(ProjectAccessError);
    expect(boundary.getDb).not.toHaveBeenCalled();
  });

  it("rolls back the mutation when the audit write fails, leaving the row unchanged", async () => {
    boundary.audit.mockRejectedValueOnce(new Error("synthetic audit outage"));
    const before = structuredClone(rows.projects[0]);
    await expect(updateProject(PROJECT, { notes: "should not persist" }, ACTOR, TENANT)).rejects.toThrow(/synthetic audit outage/);
    expect(rows.projects[0]).toEqual(before);
  });
});

describe("updateProjectStatus", () => {
  it("applies a legal transition under real owner authorization", async () => {
    const result = await updateProjectStatus(PROJECT, "estimating", ACTOR, TENANT);
    expect(result.status).toBe("estimating");
    expect(boundary.audit).toHaveBeenCalledTimes(1);
    expect(boundary.audit.mock.calls[0][0]).toMatchObject({ action: "project.status_change", recordId: PROJECT, userId: ACTOR });
  });

  it("refuses an operationally-forbidden destination even though the transition table would allow it", async () => {
    rows.projects[0].status = "review"; // review→approved is a legal hop per STATUS_TRANSITIONS
    const before = structuredClone(rows.projects[0]);
    await expect(updateProjectStatus(PROJECT, "approved", ACTOR, TENANT)).rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it('refuses "closed" without relying on STATUS_TRANSITIONS containing it', async () => {
    await expect(updateProjectStatus(PROJECT, "closed", ACTOR, TENANT)).rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expectNoWrites();
  });

  it("refuses a same-state forbidden request instead of treating it as a no-op", async () => {
    rows.projects[0].status = "approved"; // a pre-existing legacy row already at "approved"
    await expect(updateProjectStatus(PROJECT, "approved", ACTOR, TENANT)).rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expectNoWrites();
  });

  it("propagates FORBIDDEN for an actor with no standing on the project, before any write", async () => {
    rows.profiles.push({ id: OUTSIDER, tenantId: TENANT, role: "user", isActive: true });
    await expect(updateProjectStatus(PROJECT, "estimating", OUTSIDER, TENANT)).rejects.toBeInstanceOf(ProjectAccessError);
    expectNoWrites();
  });

  it("rolls back when the audit write fails", async () => {
    boundary.audit.mockRejectedValueOnce(new Error("synthetic audit outage"));
    const before = structuredClone(rows.projects[0]);
    await expect(updateProjectStatus(PROJECT, "estimating", ACTOR, TENANT)).rejects.toThrow(/synthetic audit outage/);
    expect(rows.projects[0]).toEqual(before);
  });
});

describe("createProject", () => {
  const base = { tenantId: TENANT, name: "New Project", projectType: "remodel" as const };

  it("creates under a verified, matching tenant/actor pair and defaults ownership to the actor", async () => {
    const project = await createProject(base, ACTOR);
    expect(project.tenantId).toBe(TENANT);
    expect(project.ownerUserId).toBe(ACTOR);
    expect(boundary.audit).toHaveBeenCalledTimes(1);
    expect(boundary.audit.mock.calls[0][0]).toMatchObject({ action: "project.create", userId: ACTOR });
  });

  it("refuses when the actor's own tenant does not match the claimed tenant, even though both individually exist", async () => {
    rows.profiles.push({ id: OUTSIDER, tenantId: OTHER_TENANT, role: "user", isActive: true });
    await expect(createProject(base, OUTSIDER)).rejects.toBeInstanceOf(ProjectAccessError);
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("refuses when the actor's profile is inactive", async () => {
    rows.profiles[0].isActive = false;
    await expect(createProject(base, ACTOR)).rejects.toBeInstanceOf(ProjectAccessError);
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
  });

  it("refuses a forbidden status even when supplied to the helper directly (defense-in-depth; the public router never exposes this field)", async () => {
    await expect(createProject({ ...base, status: "completed" }, ACTOR)).rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
  });

  it("fails closed before any DB access when the actor is missing", async () => {
    await expect(createProject(base, "" as any)).rejects.toBeInstanceOf(ProjectAccessError);
    expect(boundary.getDb).not.toHaveBeenCalled();
  });
});
