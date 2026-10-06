/** Real routes, ACL, audit and persistence helpers against a deterministic query driver.
 * Physical isolation/rollback proofs live in the separately gated PostgreSQL suite. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const io = vi.hoisted(() => ({
  getDb: vi.fn(),
  budget: vi.fn(),
  changes: vi.fn(),
  permission: vi.fn(),
  tasks: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./field-operations-db", () => ({
  getProjectBudgetEstimate: io.budget,
  listApprovedChangeOrders: io.changes,
  listFieldTasks: io.tasks,
}));
vi.mock("./rbac", () => ({ hasPermission: io.permission }));
import { actualsRouter } from "./actuals-router";
import {
  recordActual,
  transitionActual,
  reviewActualVariance,
  deleteActual,
  getProjectBudget,
  getProjectBudgetLines,
  getVarianceSnapshot,
} from "./actuals-db";
import {
  openCloseout,
  updateCloseoutChecklist,
  transitionCloseout,
  closeProject,
  getCloseoutStatus,
  buildProjectFinalReport,
} from "./closeout-db";
import { closeoutRouter } from "./closeout-router";
import { recordProjectActual, getVarianceSummary } from "./field-launch-db";
import { fieldLaunchRouter } from "./field-launch-router";

const TENANT = "a9700000-0000-4000-8000-000000000001",
  OTHER = "a9700000-0000-4000-8000-000000000002";
const USER = "b9700000-0000-4000-8000-000000000001",
  PROJECT = "c9700000-0000-4000-8000-000000000001",
  FOREIGN_PROJECT = "c9700000-0000-4000-8000-000000000002";
const BASE = "d9700000-0000-4000-8000-000000000001",
  CO = "d9700000-0000-4000-8000-000000000002";
const CODE = "e9700000-0000-4000-8000-000000000001",
  ASSEMBLY = "e9700000-0000-4000-8000-000000000002",
  SUB = "e9700000-0000-4000-8000-000000000003",
  TASK = "e9700000-0000-4000-8000-000000000004",
  ITEM = "e9700000-0000-4000-8000-000000000005";
type Row = Record<string, any>;
let state: Record<string, Row[]>;
let writes: string[];
let baseline: Row | null;
let failAt: string | undefined;
const input = {
  projectId: PROJECT,
  costCode: "SYN-L01",
  amountCents: 12500,
  vendorName: "Synthetic crew",
  dateIncurred: "2026-09-18",
};
function matches(row: Row, predicate?: SQL) {
  if (!predicate) return true;
  const query = new PgDialect().sqlToQuery(predicate);
  const comparisons = Array.from(
    query.sql.matchAll(/"[a-z_]+"\."([a-z_]+)" = \$(\d+)/g)
  );
  const nulls = Array.from(
    query.sql.matchAll(/"[a-z_]+"\."([a-z_]+)" is null/g)
  );
  return (
    comparisons.every(
      ([, column, index]) =>
        row[
          column.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
        ] === query.params[Number(index) - 1]
    ) &&
    nulls.every(
      ([, column]) =>
        row[
          column.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
        ] == null
    )
  );
}
function database() {
  return {
    select: (columns?: Record<string, any>) => ({
      from: (table: Table) => {
        const name = getTableName(table);
        let predicate: SQL | undefined;
        let limit = Infinity;
        let offset = 0;
        const query = {
          where: (p: SQL) => {
            predicate = p;
            return query;
          },
          orderBy: () => query,
          for: () => query,
          limit: (n: number) => {
            limit = n;
            return query;
          },
          offset: (n: number) => {
            offset = n;
            return query;
          },
          then: (
            resolve: (rows: Row[]) => unknown,
            reject?: (error: unknown) => unknown
          ) => {
            const rows = (state[name] ?? [])
              .filter(row => matches(row, predicate))
              .slice(offset, offset + limit)
              .map(row =>
                columns
                  ? Object.fromEntries(
                      Object.entries(columns).map(([key, column]) => [
                        key,
                        row[
                          column.name?.replace(
                            /_([a-z])/g,
                            (_: string, c: string) => c.toUpperCase()
                          )
                        ],
                      ])
                    )
                  : row
              );
            return Promise.resolve(
              structuredClone(
                columns?.count
                  ? [
                      {
                        count: (state[name] ?? []).filter(r =>
                          matches(r, predicate)
                        ).length,
                      },
                    ]
                  : rows
              )
            ).then(resolve, reject);
          },
        };
        return query;
      },
    }),
    insert: (table: Table) => ({
      values: (value: Row) => {
        const execute = async () => {
          const name = getTableName(table);
          const operation = `insert:${name}`;
          writes.push(operation);
          const row = {
            id: `generated-${writes.length}`,
            ...structuredClone(value),
          };
          (state[name] ??= []).push(row);
          if (
            failAt === operation ||
            (name === "audit_logs" && failAt === `audit:${value.action}`)
          )
            throw new Error(`Injected ${failAt}`);
          return [row];
        };
        return {
          returning: execute,
          then: (
            resolve: (rows: Row[]) => unknown,
            reject?: (error: unknown) => unknown
          ) => execute().then(resolve, reject),
        };
      },
    }),
    update: (table: Table) => ({
      set: (patch: Row) => ({
        where: async (predicate: SQL) => {
          const name = getTableName(table);
          const operation = `update:${name}`;
          writes.push(operation);
          for (const row of state[name] ?? [])
            if (matches(row, predicate)) Object.assign(row, patch);
          if (failAt === operation) throw new Error(`Injected ${operation}`);
        },
      }),
    }),
    transaction: async <T>(callback: (tx: any) => Promise<T>) => {
      const before = structuredClone(state);
      try {
        const result = await callback(database());
        if (failAt === "commit") throw new Error("Injected commit");
        return result;
      } catch (error) {
        state = before;
        throw error;
      }
    },
  };
}
const caller = (tenantId: string | null = TENANT) =>
  actualsRouter.createCaller({
    tenantId,
    user: { id: USER, role: "admin" },
  } as any);
const direct = (extra: Row = {}) =>
  recordActual({ ...input, userId: USER, tenantId: TENANT, ...extra });
function noWrites() {
  expect(writes).toEqual([]);
  expect(state.project_cost_actuals).toEqual([]);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TENANT_STRICT", "true");
  writes = [];
  failAt = undefined;
  baseline = {
    id: BASE,
    tenantId: TENANT,
    projectId: PROJECT,
    status: "approved",
    approvedAt: new Date("2026-09-18T12:00:00Z"),
    supersededBy: null,
    changeOrderOf: null,
    lineItems: [
      {
        costCode: "SYN-L01",
        costItemName: "Synthetic labor",
        quantity: 2,
        unitCostSnapshot: "50.00",
      },
    ],
  };
  state = {
    projects: [
      {
        id: PROJECT,
        tenantId: TENANT,
        ownerUserId: USER,
        deletedAt: null,
        varianceThresholdPct: "10",
      },
    ],
    profiles: [{ id: USER, tenantId: TENANT, role: "admin", isActive: true }],
    estimate_drafts: [
      baseline,
      {
        ...baseline,
        id: CO,
        changeOrderOf: BASE,
        lineItems: [
          { costCode: "SYN-L01", quantity: 1, unitCostSnapshot: "40.00" },
        ],
      },
    ],
    cost_codes: [
      {
        id: CODE,
        tenantId: TENANT,
        code: "SYN-L01",
        name: "Synthetic labor",
        isActive: true,
      },
    ],
    assemblies: [{ id: ASSEMBLY, tenantId: TENANT, isActive: true }],
    subcontractors: [{ id: SUB, tenantId: TENANT, deletedAt: null }],
    field_tasks: [
      {
        id: TASK,
        tenantId: TENANT,
        projectId: PROJECT,
        deletedAt: null,
        changeOrderId: null,
      },
    ],
    estimate_items: [
      {
        id: ITEM,
        tenantId: TENANT,
        projectId: PROJECT,
        costCodeId: CODE,
        assemblyId: ASSEMBLY,
      },
    ],
    project_cost_actuals: [],
    audit_logs: [],
  };
  io.getDb.mockResolvedValue(database());
  io.budget.mockImplementation(async () => baseline);
  io.changes.mockResolvedValue([]);
  io.permission.mockResolvedValue(false);
  io.tasks.mockResolvedValue({ tasks: [], total: 0 });
  state.project_closeouts = [];
  state.project_actuals = [];
});
afterEach(() => vi.unstubAllEnvs());

const ACTUAL = "f9700000-0000-4000-8000-000000000001",
  CLOSEOUT = "f9700000-0000-4000-8000-000000000002";
const unavailable = {
  state: "unavailable",
  reason: "EXECUTION_AUTHORITY_NOT_AVAILABLE",
};
const authorityError = { code: "EXECUTION_AUTHORITY_NOT_AVAILABLE" };
const actor = { userId: USER, tenantId: TENANT };
const closeCaller = () =>
  closeoutRouter.createCaller({
    tenantId: TENANT,
    user: { id: USER, role: "admin" },
  } as any);
function actual(status = "pending", extra: Row = {}) {
  const row = {
    id: ACTUAL,
    projectId: PROJECT,
    tenantId: TENANT,
    deletedAt: null,
    status,
    amountCents: 12500,
    budgetEstimateDraftId: BASE,
    changeOrderId: null,
    varianceReviewed: false,
    ...extra,
  };
  state.project_cost_actuals = [row];
  return row;
}
function closeout(status = "open", extra: Row = {}) {
  const row = {
    id: CLOSEOUT,
    projectId: PROJECT,
    tenantId: TENANT,
    deletedAt: null,
    status,
    budgetEstimateDraftId: BASE,
    finalInspectionPassed: true,
    punchListComplete: true,
    lienWaiversCollected: true,
    finalPaymentReceived: true,
    warrantyDocsDelivered: true,
    clientSatisfactionScore: 10,
    readyAt: null,
    closedAt: null,
    ...extra,
  };
  state.project_closeouts = [row];
  return row;
}

describe("A1 actuals and closeout authority boundary", () => {
  it.each(["approved", "internal_approved", "draft"])(
    "holds direct cost capture with %s legacy state before writes",
    async status => {
      baseline!.status = status;
      await expect(direct()).rejects.toMatchObject(authorityError);
      noWrites();
    }
  );
  it("holds cost capture with no estimate or cost code", async () => {
    state.estimate_drafts = [];
    await expect(direct({ costCode: null })).rejects.toMatchObject(
      authorityError
    );
    noWrites();
  });
  it("checks capture task reference identity before historical classification", async () => {
    state.field_tasks[0].budgetEstimateDraftId = BASE;
    Object.assign(state.estimate_drafts[0], {
      tenantId: OTHER,
      source: "historical_import",
    });
    await expect(direct({ fieldTaskId: TASK })).rejects.toMatchObject({
      code: "REFERENCE_NOT_AVAILABLE",
    });
    noWrites();
  });
  it("checks capture change-order ancestry beyond its immediate parent", async () => {
    state.estimate_drafts[0].supersedesId = ITEM;
    state.estimate_drafts.push({
      ...baseline,
      id: ITEM,
      changeOrderOf: null,
      supersedesId: null,
      source: "historical_import",
    });
    await expect(direct({ changeOrderId: CO })).rejects.toMatchObject({
      code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE",
    });
    noWrites();
  });
  it("maps capture hold at the route without changing ledger", async () => {
    await expect(caller().record(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    noWrites();
  });
  it.each(["approved", "paid"])("denies direct %s", async to => {
    actual(to === "paid" ? "approved" : "pending");
    const before = structuredClone(state);
    await expect(
      transitionActual({ actualId: ACTUAL, ...actor, to })
    ).rejects.toMatchObject(authorityError);
    expect(state).toEqual(before);
  });
  it.each(["approve", "markPaid"] as const)(
    "denies routed %s",
    async operation => {
      actual(operation === "markPaid" ? "approved" : "pending");
      await expect(
        caller()[operation]({ actualId: ACTUAL })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(writes).toEqual([]);
    }
  );
  it.each([
    ["pending", "rejected"],
    ["approved", "void"],
    ["pending", "void"],
  ])("preserves %s to %s, audit and factual ledger only", async (from, to) => {
    actual(from);
    state.project_cost_actuals.push({
      ...state.project_cost_actuals[0],
      id: "retained",
      amountCents: 30000,
      status: "paid",
    });
    io.budget.mockRejectedValue(new Error("Budget must not be read"));
    const row = await transitionActual({
      actualId: ACTUAL,
      ...actor,
      to,
      reason: "Incorrect source entry",
    });
    expect(row.status).toBe(to);
    expect(state.project_cost_actuals[0].amountCents).toBe(12500);
    expect(state.projects[0]).toMatchObject({
      committedCostCents: 30000,
      actualTotal: "300.00",
      variancePct: null,
    });
    expect(state.audit_logs.map(r => r.action)).toEqual([
      `actual.${to}`,
      "project.actuals_refreshed",
    ]);
    expect(io.budget).not.toHaveBeenCalled();
  });
  it.each([
    "insert:audit_logs",
    "update:projects",
    "audit:project.actuals_refreshed",
    "commit",
  ])("rolls back retained ledger and audit when %s fails", async failure => {
    actual("approved");
    const before = structuredClone(state);
    failAt = failure;
    await expect(
      transitionActual({
        actualId: ACTUAL,
        ...actor,
        to: "void",
        reason: "Incorrect source entry",
      })
    ).rejects.toThrow(`Injected ${failure}`);
    expect(state).toEqual(before);
  });
  it.each([
    "foreign-child",
    "foreign-project",
    "missing-tenant",
    "inactive-actor",
    "deleted-child",
  ])("denies reduction for %s", async kind => {
    actual();
    if (kind === "foreign-child")
      state.project_cost_actuals[0].tenantId = OTHER;
    if (kind === "foreign-project") state.projects[0].tenantId = OTHER;
    if (kind === "inactive-actor") state.profiles[0].isActive = false;
    if (kind === "deleted-child")
      state.project_cost_actuals[0].deletedAt = new Date();
    await expect(
      transitionActual({
        actualId: ACTUAL,
        ...actor,
        tenantId: kind === "missing-tenant" ? (null as any) : TENANT,
        to: "rejected",
        reason: "Incorrect source entry",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes).toEqual([]);
  });
  it("preserves the existing terminal paid state", async () => {
    actual("paid");
    await expect(
      transitionActual({
        actualId: ACTUAL,
        ...actor,
        to: "void",
        reason: "Cannot widen terminal flow",
      })
    ).rejects.toMatchObject({ code: "INVALID_ACTUAL_TRANSITION" });
    expect(writes).toEqual([]);
  });
  it.each(["foreign", "missing"])(
    "denies an actual's %s baseline identity before H1 classification",
    async kind => {
      actual();
      state.estimate_drafts[0].source = "historical_import";
      if (kind === "foreign") state.estimate_drafts[0].tenantId = OTHER;
      else state.estimate_drafts = [];
      await expect(
        transitionActual({
          actualId: ACTUAL,
          ...actor,
          to: "rejected",
          reason: "Incorrect source entry",
        })
      ).rejects.toMatchObject({ code: "REFERENCE_NOT_AVAILABLE" });
      expect(writes).toEqual([]);
    }
  );
  it.each(["foreign", "missing"])(
    "denies closeout's %s baseline identity before H1 classification",
    async kind => {
      closeout();
      state.estimate_drafts[0].source = "historical_import";
      if (kind === "foreign") state.estimate_drafts[0].tenantId = OTHER;
      else state.estimate_drafts = [];
      await expect(
        updateCloseoutChecklist({
          closeoutId: CLOSEOUT,
          ...actor,
          notes: "Cannot read another tenant's history",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(writes).toEqual([]);
    }
  );
  it("does not reinterpret an unknown legacy actual status as pending", async () => {
    actual("unrecognized");
    await expect(
      transitionActual({
        actualId: ACTUAL,
        ...actor,
        to: "rejected",
        reason: "Invalid state cannot reduce",
      })
    ).rejects.toMatchObject({ code: "INVALID_ACTUAL_TRANSITION" });
    expect(writes).toEqual([]);
  });
  it("requires a reason on a direct reduction", async () => {
    actual();
    await expect(
      transitionActual({ actualId: ACTUAL, ...actor, to: "rejected" })
    ).rejects.toMatchObject({ code: "ACTUAL_VALIDATION_FAILED" });
    expect(writes).toEqual([]);
  });
  it("preserves variance review as annotation, with transactional audit", async () => {
    actual("paid");
    const row = await reviewActualVariance({
      actualId: ACTUAL,
      ...actor,
      varianceReason: "Reviewed historical invoice",
    });
    expect(row).toMatchObject({
      status: "paid",
      amountCents: 12500,
      varianceReviewed: true,
    });
    expect(state.audit_logs).toHaveLength(1);
  });
  it("rolls back variance review on audit failure", async () => {
    actual();
    failAt = "insert:audit_logs";
    const before = structuredClone(state);
    await expect(
      reviewActualVariance({
        actualId: ACTUAL,
        ...actor,
        varianceReason: "Reviewed historical invoice",
      })
    ).rejects.toThrow();
    expect(state).toEqual(before);
  });
  it("soft-deletes only noncommitted facts and refreshes without budget", async () => {
    actual();
    await deleteActual(ACTUAL, USER, TENANT);
    expect(state.project_cost_actuals[0].deletedAt).toBeInstanceOf(Date);
    expect(state.projects[0]).toMatchObject({
      committedCostCents: 0,
      variancePct: null,
    });
    expect(state.audit_logs).toHaveLength(2);
  });
  it.each(["approved", "paid"])(
    "requires void instead of deleting %s",
    async status => {
      actual(status);
      await expect(deleteActual(ACTUAL, USER, TENANT)).rejects.toMatchObject({
        code: "INVALID_ACTUAL_TRANSITION",
      });
      expect(writes).toEqual([]);
    }
  );
  it("refuses deleting an unknown legacy actual state", async () => {
    actual("unrecognized");
    const before = structuredClone(state);
    await expect(deleteActual(ACTUAL, USER, TENANT)).rejects.toMatchObject({
      code: "INVALID_ACTUAL_TRANSITION",
    });
    expect(state).toEqual(before);
    expect(writes).toEqual([]);
  });
  it("rolls back reduction when a sibling ledger status is unknown", async () => {
    actual("approved");
    state.project_cost_actuals.push({
      ...state.project_cost_actuals[0],
      id: ITEM,
      status: "unrecognized",
      amountCents: 30000,
    });
    Object.assign(state.projects[0], {
      committedCostCents: 42500,
      actualTotal: "425.00",
      variancePct: "12",
    });
    const before = structuredClone(state);
    await expect(
      transitionActual({
        actualId: ACTUAL,
        ...actor,
        to: "void",
        reason: "Incorrect source entry",
      })
    ).rejects.toMatchObject({ code: "ACTUAL_VALIDATION_FAILED" });
    expect(state).toEqual(before);
  });
  it("includes committed records past the old 2000-row truncation", async () => {
    actual();
    state.project_cost_actuals.push(
      ...Array.from({ length: 2001 }, (_, i) => ({
        ...state.project_cost_actuals[0],
        id: `retained-${i}`,
        status: "paid",
        amountCents: 100,
      }))
    );
    await deleteActual(ACTUAL, USER, TENANT);
    expect(state.projects[0].committedCostCents).toBe(200100);
  });
  it.each([getProjectBudget, getProjectBudgetLines, getVarianceSnapshot])(
    "holds dependent internal budget computations",
    async getter => {
      await expect(getter(PROJECT)).rejects.toMatchObject(authorityError);
      expect(writes).toEqual([]);
    }
  );
  it.each(["getBudget", "getVariance"] as const)(
    "returns explicit %s unavailability without numeric placeholders",
    async name => {
      expect(await caller()[name]({ projectId: PROJECT })).toEqual(unavailable);
    }
  );
  it("preserves unknown monetary snapshots as null rather than zero", async () => {
    actual("paid", { estimatedAmountCents: null, varianceCents: null });
    expect((await caller().get({ actualId: ACTUAL })).formatted).toMatchObject({
      estimated: null,
      variance: null,
    });
  });
  it("preserves known zero monetary snapshots as zero", async () => {
    actual("paid", { estimatedAmountCents: 0, varianceCents: 0 });
    const result = await caller().get({ actualId: ACTUAL });
    expect(result.formatted).toMatchObject({
      estimated: "0.00",
      variance: "0.00",
    });
  });
  it("preserves existing ledger reads", async () => {
    actual("paid");
    expect(
      (await caller().list({ projectId: PROJECT })).actuals[0]
    ).toMatchObject({ id: ACTUAL, status: "paid", amountCents: 12500 });
  });
  it("holds alternate direct capture before insert", async () => {
    await expect(
      recordProjectActual({ projectId: PROJECT, recordedBy: USER } as any)
    ).rejects.toMatchObject(authorityError);
    expect(writes).toEqual([]);
  });
  it("holds alternate routed capture for admins", async () => {
    const launch = fieldLaunchRouter.createCaller({
      tenantId: TENANT,
      user: { id: USER, role: "admin" },
    } as any);
    await expect(
      launch.recordActual({
        projectId: PROJECT,
        estimatedTotalCost: 1,
        actualTotalCost: 2,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(writes).toEqual([]);
  });
  it("keeps alternate actual facts with unavailable variance component", async () => {
    state.project_actuals = [
      {
        id: ACTUAL,
        projectId: PROJECT,
        actualQuantity: "3",
        actualCost: "12.50",
        actualLaborHours: "2",
      },
    ];
    expect(await getVarianceSummary(PROJECT)).toEqual({
      totalItems: 1,
      totalActualQuantity: 3,
      totalActualCost: 12.5,
      totalLaborHours: 2,
      variance: unavailable,
    });
  });
  it("denies opening closeout without a write", async () => {
    await expect(
      openCloseout({ projectId: PROJECT, ...actor })
    ).rejects.toMatchObject(authorityError);
    expect(writes).toEqual([]);
  });
  it.each([
    ["open", "in_progress"],
    ["in_progress", "ready_to_close"],
    ["blocked", "open"],
    ["ready_to_close", "closed"],
  ])("holds closeout promotion %s to %s", async (from, to) => {
    closeout(from);
    await expect(
      transitionCloseout({ closeoutId: CLOSEOUT, ...actor, to })
    ).rejects.toMatchObject(authorityError);
    expect(writes).toEqual([]);
  });
  it("denies final close even with complete legacy facts", async () => {
    closeout("ready_to_close");
    await expect(
      closeProject({ closeoutId: CLOSEOUT, ...actor })
    ).rejects.toMatchObject(authorityError);
    expect(writes).toEqual([]);
  });
  it.each([
    ["open", "blocked"],
    ["in_progress", "blocked"],
    ["ready_to_close", "in_progress"],
  ])("preserves reductive closeout %s to %s", async (from, to) => {
    closeout(from);
    const row = await transitionCloseout({
      closeoutId: CLOSEOUT,
      ...actor,
      to,
    });
    expect(row).toMatchObject({ status: to, readyAt: null, closedAt: null });
    expect(state.audit_logs).toHaveLength(1);
    expect(writes).not.toContain("update:projects");
  });
  it("checklist facts never promote open closeout", async () => {
    closeout();
    const { closeout: row } = await updateCloseoutChecklist({
      closeoutId: CLOSEOUT,
      ...actor,
      finalInspectionPassed: true,
      notes: "Factual observation",
    });
    expect(row).toMatchObject({
      status: "open",
      notes: "Factual observation",
      readyAt: null,
      closedAt: null,
    });
    expect(state.audit_logs).toHaveLength(1);
  });
  it.each([
    "status",
    "readyAt",
    "closedAt",
    "approvedSellPriceCents",
    "budgetEstimateDraftId",
  ])(
    "rejects mixed checklist payload with %s including explicit null",
    async key => {
      closeout();
      const before = structuredClone(state);
      await expect(
        updateCloseoutChecklist({
          closeoutId: CLOSEOUT,
          ...actor,
          notes: "Do not partly save",
          [key]: null,
        } as any)
      ).rejects.toMatchObject(authorityError);
      expect(state).toEqual(before);
    }
  );
  it("keeps closed checklist immutable", async () => {
    closeout("closed");
    await expect(
      updateCloseoutChecklist({
        closeoutId: CLOSEOUT,
        ...actor,
        notes: "Cannot edit",
      })
    ).rejects.toMatchObject({ code: "CLOSEOUT_LOCKED" });
    expect(writes).toEqual([]);
  });
  it.each(["checklist", "transition"])(
    "rolls back %s when audit fails",
    async kind => {
      closeout();
      const before = structuredClone(state);
      failAt = "insert:audit_logs";
      const result =
        kind === "checklist"
          ? updateCloseoutChecklist({
              closeoutId: CLOSEOUT,
              ...actor,
              notes: "Factual observation",
            })
          : transitionCloseout({
              closeoutId: CLOSEOUT,
              ...actor,
              to: "blocked",
            });
      await expect(result).rejects.toThrow();
      expect(state).toEqual(before);
    }
  );
  it.each([
    "foreign-child",
    "foreign-project",
    "missing-tenant",
    "inactive-actor",
    "deleted-child",
  ])("rejects factual closeout write with %s", async kind => {
    closeout();
    if (kind === "foreign-child") state.project_closeouts[0].tenantId = OTHER;
    if (kind === "foreign-project") state.projects[0].tenantId = OTHER;
    if (kind === "inactive-actor") state.profiles[0].isActive = false;
    if (kind === "deleted-child")
      state.project_closeouts[0].deletedAt = new Date();
    await expect(
      updateCloseoutChecklist({
        closeoutId: CLOSEOUT,
        ...actor,
        tenantId: kind === "missing-tenant" ? (null as any) : TENANT,
        notes: "Denied",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes).toEqual([]);
  });
  it("never reports canClose for complete legacy facts", async () => {
    closeout("ready_to_close");
    const result = await getCloseoutStatus(PROJECT);
    expect(result).toMatchObject({
      canClose: false,
      readiness: { canOpen: false, openTaskCount: 0 },
      checklist: { complete: true },
    });
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "EXECUTION_AUTHORITY_NOT_AVAILABLE" })
    );
  });
  it("preserves saved final report and makes new report unavailable", async () => {
    const saved = { totalActualCents: 12500, summary: "Persisted evidence" };
    closeout("closed", { varianceReport: saved });
    expect(
      await closeCaller().getFinalReport({ projectId: PROJECT })
    ).toMatchObject({ source: "snapshot", report: saved });
    expect(await closeCaller().previewReport({ projectId: PROJECT })).toEqual(
      unavailable
    );
    await expect(buildProjectFinalReport(PROJECT)).rejects.toMatchObject(
      authorityError
    );
  });
  it("returns current final report unavailability without losing closeout facts", async () => {
    closeout();
    expect(
      await closeCaller().getFinalReport({ projectId: PROJECT })
    ).toMatchObject({ ...unavailable, closeout: { id: CLOSEOUT } });
  });
  describe.each(["actual", "closeout"])("scoped %s ancestry", domain => {
    const mutate = () =>
      domain === "actual"
        ? transitionActual({
            actualId: ACTUAL,
            ...actor,
            to: "rejected",
            reason: "Incorrect source entry",
          })
        : updateCloseoutChecklist({
            closeoutId: CLOSEOUT,
            ...actor,
            notes: "Factual observation",
          });
    const setup = () => {
      actual();
      closeout();
      state.estimate_drafts = [
        { ...baseline, changeOrderOf: null, supersedesId: null },
        { ...baseline, id: CO, changeOrderOf: null, supersedesId: null },
      ];
      state.historical_estimate_imports = [];
    };
    it.each(["changeOrderOf", "supersedesId"])(
      "rejects source-backed historical ancestry through %s",
      async edge => {
        setup();
        state.estimate_drafts[0][edge] = CO;
        state.estimate_drafts[1].source = "historical_import";
        await expect(mutate()).rejects.toMatchObject({
          code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE",
        });
        expect(writes).toEqual([]);
      }
    );
    it.each(["changeOrderOf", "supersedesId"])(
      "rejects relational historical ancestry through %s",
      async edge => {
        setup();
        state.estimate_drafts[0][edge] = CO;
        state.estimate_drafts[1].source = "assembly_calculator";
        state.historical_estimate_imports = [
          {
            id: ITEM,
            tenantId: TENANT,
            projectId: PROJECT,
            estimateDraftId: CO,
          },
        ];
        await expect(mutate()).rejects.toMatchObject({
          code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE",
        });
        expect(writes).toEqual([]);
      }
    );
    it.each(["foreign", "missing", "cycle", "limit"])(
      "fails closed for %s ancestry before exposing unrelated H1 identity",
      async kind => {
        setup();
        state.estimate_drafts[0].supersedesId = CO;
        if (kind === "foreign")
          Object.assign(state.estimate_drafts[1], {
            tenantId: OTHER,
            source: "historical_import",
          });
        if (kind === "missing") state.estimate_drafts.pop();
        if (kind === "cycle") state.estimate_drafts[1].supersedesId = BASE;
        if (kind === "limit") {
          state.estimate_drafts = Array.from({ length: 130 }, (_, i) => ({
            ...baseline,
            id: i === 0 ? BASE : `ancestor-${i}`,
            changeOrderOf: null,
            supersedesId: i === 129 ? null : `ancestor-${i + 1}`,
          }));
        }
        await expect(mutate()).rejects.toMatchObject({
          code: domain === "actual" ? "REFERENCE_NOT_AVAILABLE" : "FORBIDDEN",
        });
        expect(writes).toEqual([]);
      }
    );
    it("accepts shared calculated ancestry without misclassifying a diamond as a cycle", async () => {
      setup();
      state.estimate_drafts[0].supersedesId = CO;
      state.estimate_drafts[0].changeOrderOf = ITEM;
      state.estimate_drafts[1].supersedesId = TASK;
      state.estimate_drafts.push(
        { ...baseline, id: ITEM, changeOrderOf: null, supersedesId: TASK },
        { ...baseline, id: TASK, changeOrderOf: null, supersedesId: null }
      );
      const result = await mutate();
      if (domain === "actual")
        expect(result).toMatchObject({
          status: "rejected",
          amountCents: 12500,
        });
      else
        expect(result).toMatchObject({
          closeout: { status: "open", notes: "Factual observation" },
        });
      expect(state.audit_logs.length).toBe(domain === "actual" ? 2 : 1);
    });
  });
  describe("whole retained mutation payload", () => {
    it.each(["amountCents", "status"])(
      "rejects direct actual transition mixed with %s:null",
      async key => {
        actual();
        const before = structuredClone(state);
        await expect(
          transitionActual({
            actualId: ACTUAL,
            ...actor,
            to: "rejected",
            reason: "Incorrect source entry",
            [key]: null,
          } as any)
        ).rejects.toMatchObject(authorityError);
        expect(state).toEqual(before);
        expect(writes).toEqual([]);
      }
    );
    it.each(["amountCents", "status"])(
      "rejects direct actual review mixed with %s:null",
      async key => {
        actual();
        const before = structuredClone(state);
        await expect(
          reviewActualVariance({
            actualId: ACTUAL,
            ...actor,
            varianceReason: "Reviewed historical invoice",
            [key]: null,
          } as any)
        ).rejects.toMatchObject(authorityError);
        expect(state).toEqual(before);
        expect(writes).toEqual([]);
      }
    );
    it.each(["closedAt", "approvedSellPriceCents"])(
      "rejects direct closeout transition mixed with %s:null",
      async key => {
        closeout();
        const before = structuredClone(state);
        await expect(
          transitionCloseout({
            closeoutId: CLOSEOUT,
            ...actor,
            to: "blocked",
            [key]: null,
          } as any)
        ).rejects.toMatchObject(authorityError);
        expect(state).toEqual(before);
        expect(writes).toEqual([]);
      }
    );
    it.each(["amountCents", "status"])(
      "rejects routed actual reject mixed with %s:null",
      async key => {
        actual();
        const before = structuredClone(state);
        await expect(
          caller().reject({
            actualId: ACTUAL,
            reason: "Incorrect source entry",
            [key]: null,
          } as any)
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(state).toEqual(before);
        expect(writes).toEqual([]);
      }
    );
    it.each(["amountCents", "status"])(
      "rejects routed actual review mixed with %s:null",
      async key => {
        actual();
        const before = structuredClone(state);
        await expect(
          caller().reviewVariance({
            actualId: ACTUAL,
            varianceReason: "Reviewed historical invoice",
            [key]: null,
          } as any)
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(state).toEqual(before);
        expect(writes).toEqual([]);
      }
    );
    it.each(["closedAt", "approvedSellPriceCents"])(
      "rejects routed closeout transition mixed with %s:null",
      async key => {
        closeout();
        const before = structuredClone(state);
        await expect(
          closeCaller().transition({
            closeoutId: CLOSEOUT,
            to: "blocked",
            [key]: null,
          } as any)
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(state).toEqual(before);
        expect(writes).toEqual([]);
      }
    );
    it("treats undefined operational keys as omitted in a direct reduction", async () => {
      actual();
      const row = await transitionActual({
        actualId: ACTUAL,
        ...actor,
        to: "rejected",
        reason: "Incorrect source entry",
        amountCents: undefined,
      } as any);
      expect(row).toMatchObject({ status: "rejected", amountCents: 12500 });
    });
  });
});
