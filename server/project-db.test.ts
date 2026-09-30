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
import { ProjectOperationBlockedError, ProjectStatusTransitionInvalidError } from "@shared/project-operation-guard";

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
    expect(boundary.audit.mock.calls[0][1]).toBe(driver); // exact transaction handle, not just "a second argument"
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

  it("V3: without the trusted allowFormationStatus option (the router's own call shape), ANY defined status is refused — not just the 4 forbidden ones", async () => {
    // project.update never passes this option — the public route always gets this default.
    await expect(updateProject(PROJECT, { status: "estimating" }, ACTOR, TENANT))
      .rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expectNoWrites();
  });

  it("V3: an explicit, trusted allowFormationStatus:true still enforces the transition table for a status that survives the operational barrier", async () => {
    // This capability is preserved for a future trusted internal caller (never the public
    // router) — cancelled's only legal next hop is "intake"; "estimating" is
    // legitimate-category but not a legal transition from this state — must be the
    // ORIGINAL transition error (now ProjectStatusTransitionInvalidError), not the
    // operational-destination barrier.
    rows.projects[0].status = "cancelled";
    await expect(updateProject(PROJECT, { status: "estimating" }, ACTOR, TENANT, { allowFormationStatus: true }))
      .rejects.toBeInstanceOf(ProjectStatusTransitionInvalidError);
    expectNoWrites();
  });

  it("V3: an explicit, trusted allowFormationStatus:true still refuses the 4 forbidden destinations", async () => {
    await expect(updateProject(PROJECT, { status: "approved" }, ACTOR, TENANT, { allowFormationStatus: true }))
      .rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expectNoWrites();
  });

  it("V3: an explicit, trusted allowFormationStatus:true performs a genuinely legal transition", async () => {
    const result = await updateProject(PROJECT, { status: "estimating" }, ACTOR, TENANT, { allowFormationStatus: true });
    expect(result.status).toBe("estimating");
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
    expect(boundary.audit.mock.calls[0][1]).toBe(driver); // exact transaction handle
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
  // V2 correction: tenantId is createProject()'s own parameter now, never a field of the
  // business payload — `base` has no tenantId at all.
  const base = { name: "New Project", projectType: "remodel" as const };

  it("creates under a verified, matching tenant/actor pair, always stamps ownership to the actor, and audits on the exact transaction handle", async () => {
    const project = await createProject(base, ACTOR, TENANT);
    expect(project.tenantId).toBe(TENANT);
    expect(project.ownerUserId).toBe(ACTOR);
    expect(boundary.audit).toHaveBeenCalledTimes(1);
    expect(boundary.audit.mock.calls[0][0]).toMatchObject({ action: "project.create", userId: ACTOR });
    // Exact identity, not "some second argument": proves the audit write shares the SAME
    // transaction as the insert, not a different handle (e.g. the outer pool) that would
    // silently decouple audit durability from the mutation's own commit/rollback.
    expect(boundary.audit.mock.calls[0][1]).toBe(driver);
  });

  it("V2 correction: ignores a forged ownerUserId in the payload — owner is ALWAYS the verified actor, never the caller's claim", async () => {
    const project = await createProject({ ...base, ownerUserId: OUTSIDER } as any, ACTOR, TENANT);
    expect(project.ownerUserId).toBe(ACTOR);
    expect(project.ownerUserId).not.toBe(OUTSIDER);
  });

  it("refuses when the actor's own tenant does not match the claimed tenant, even though both individually exist", async () => {
    rows.profiles.push({ id: OUTSIDER, tenantId: OTHER_TENANT, role: "user", isActive: true });
    await expect(createProject(base, OUTSIDER, OTHER_TENANT)).rejects.toBeInstanceOf(ProjectAccessError);
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("refuses when the actor's profile is inactive", async () => {
    rows.profiles[0].isActive = false;
    await expect(createProject(base, ACTOR, TENANT)).rejects.toBeInstanceOf(ProjectAccessError);
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
  });

  it("refuses a forbidden status even when supplied to the helper directly (defense-in-depth; the public router never exposes this field)", async () => {
    await expect(createProject({ ...base, status: "completed" }, ACTOR, TENANT)).rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
  });

  it("V4 correction: on the DEFAULT/public path (no trusted option), refuses ANY caller-chosen status, not just the four forbidden ones", async () => {
    // Unlike update, "estimating" is a real formation value — but WITHOUT the explicit,
    // trusted allowFormationStatus option (which the public router never supplies), create
    // still refuses it wholesale, defaulting silently to "intake" only when status is
    // absent. This is a statement about the DEFAULT/public path specifically — see the
    // allowFormationStatus:true block below for the preserved trusted-caller capability
    // the initial contract always intended to keep (Michael's V3 QA: my earlier wording
    // here wrongly generalized "no contract authorizes ANY caller-chosen status," which
    // contradicted the explicit instruction to preserve it for a trusted internal path).
    await expect(createProject({ ...base, status: "estimating" }, ACTOR, TENANT)).rejects.toBeInstanceOf(ProjectOperationBlockedError);
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
  });

  it("fails closed before any DB access when the actor is missing", async () => {
    await expect(createProject(base, "" as any, TENANT)).rejects.toBeInstanceOf(ProjectAccessError);
    expect(boundary.getDb).not.toHaveBeenCalled();
  });

  it("rolls back (no project persisted) when the audit write fails", async () => {
    boundary.audit.mockRejectedValueOnce(new Error("synthetic audit outage"));
    const before = rows.projects.length;
    await expect(createProject(base, ACTOR, TENANT)).rejects.toThrow(/synthetic audit outage/);
    expect(rows.projects.length).toBe(before);
  });

  describe("V4: explicit, trusted allowFormationStatus — preserves the baseline's formation/progression capability without a new public route", () => {
    it.each(["estimate", "intake", "estimating", "review"] as const)(
      "persists the historical formation status %s when the trusted option is explicitly set",
      async status => {
        const project = await createProject({ ...base, status }, ACTOR, TENANT, { allowFormationStatus: true });
        expect(project.status).toBe(status);
      },
    );

    it.each(["approved", "in_progress", "completed", "closed"])(
      "still refuses the operational status %s even with the trusted option set",
      async status => {
        await expect(createProject({ ...base, status }, ACTOR, TENANT, { allowFormationStatus: true }))
          .rejects.toBeInstanceOf(ProjectOperationBlockedError);
        expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
      },
    );

    it("refuses an unrecognized status with a typed error, even with the trusted option set", async () => {
      await expect(createProject({ ...base, status: "not_a_real_status" }, ACTOR, TENANT, { allowFormationStatus: true }))
        .rejects.toBeInstanceOf(ProjectStatusTransitionInvalidError);
      expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    });

    it('refuses "cancelled" even with the trusted option — cancellation is explicitly out of scope for this adjustment', async () => {
      await expect(createProject({ ...base, status: "cancelled" }, ACTOR, TENANT, { allowFormationStatus: true }))
        .rejects.toBeInstanceOf(ProjectStatusTransitionInvalidError);
      expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    });

    it("still refuses a financial key even with the trusted option set — the option only concerns status", async () => {
      await expect(createProject({ ...base, status: "intake", actualTotal: "500" } as any, ACTOR, TENANT, { allowFormationStatus: true }))
        .rejects.toBeInstanceOf(ProjectOperationBlockedError);
      expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    });

    it("router never supplies the trusted option — default remains false for the real call site", async () => {
      // Documents the router's own call shape (project-router.ts's create mutation calls
      // createProject(normalized, ctx.user.id, ctx.tenantId) — 3 arguments, never a 4th).
      // absent status still defaults to "intake"; a status still cannot reach the create
      // DML at all from the public route.
      const project = await createProject(base, ACTOR, TENANT);
      expect(project.status).toBe("intake");
    });
  });
});
