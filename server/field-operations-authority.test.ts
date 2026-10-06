/** Real field router, helpers, ACL and H1 guard against an in-memory I/O boundary.
 * Proves command refusal and atomic audit coupling, not physical locks or PostgreSQL RLS. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const io = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./audit", () => ({ logAudit: io.audit }));
import { createFieldTask, assignFieldTask, updateFieldTask, transitionFieldTask, deleteFieldTask, getProjectBudgetEstimate, listApprovedChangeOrders } from "./field-operations-db";
import { fieldOperationsRouter } from "./field-operations-router";

const id = (n: number) => `fa100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TENANT = id(1), USER = id(2), PROJECT = id(3), TASK = id(4), DRAFT = id(5), OUTSIDER = id(6), OTHER_TENANT = id(7);
type Row = Record<string, any>;
let rows: Record<string, Row[]>, writes: string[], locks: string[], transactionHandle: any;
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function matches(table: string, row: Row, predicate?: SQL): boolean {
  if (!predicate) return true;
  const compiled = new PgDialect().sqlToQuery(predicate);
  if (/not exists/i.test(compiled.sql) && compiled.sql.includes("historical_estimate_imports") && rows.historical_estimate_imports.some(item => item.estimateDraftId === row.id)) return false;
  for (const [, name, column, position] of compiled.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)"\s*=\s*\$(\d+)/g)) {
    if (name === table && row[camel(column)] !== compiled.params[Number(position) - 1]) return false;
  }
  for (const [, name, column] of compiled.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" is null/gi)) {
    if (name === table && row[camel(column)] != null) return false;
  }
  return true;
}
function driver(): any {
  return {
    select: (columns?: Record<string, any>) => ({ from: (table: Table) => {
      const tableName = getTableName(table); let predicate: SQL | undefined, limit = Infinity;
      const query: any = {
        where: (value: SQL) => { predicate = value; return query; },
        limit: (value: number) => { limit = value; return query; },
        orderBy: () => query, offset: () => query,
        for: (mode: string) => { locks.push(`${tableName}:${mode}`); return query; },
        then: (yes: any, no?: any) => Promise.resolve().then(() => {
          const selected = (rows[tableName] ?? []).filter(row => matches(tableName, row, predicate)).slice(0, limit);
          return structuredClone(columns ? selected.map(row => Object.fromEntries(Object.entries(columns).map(([key, col]) => [key, row[camel(col.name)]]))) : selected);
        }).then(yes, no),
      };
      return query;
    } }),
    insert: (table: Table) => ({ values: (value: Row | Row[]) => {
      const execute = async () => {
        const name = getTableName(table); writes.push(`insert:${name}`);
        const values = (Array.isArray(value) ? value : [value]).map(v => ({ id: id(90 + writes.length), ...structuredClone(v) }));
        (rows[name] ??= []).push(...values); return structuredClone(values);
      };
      return { returning: execute, then: (yes: any, no?: any) => execute().then(yes, no) };
    } }),
    update: (table: Table) => ({ set: (patch: Row) => ({ where: (predicate: SQL) => {
      const execute = async () => {
        const name = getTableName(table); writes.push(`update:${name}`);
        const selected = (rows[name] ?? []).filter(row => matches(name, row, predicate));
        selected.forEach(row => Object.assign(row, structuredClone(patch))); return structuredClone(selected);
      };
      return { returning: execute, then: (yes: any, no?: any) => execute().then(yes, no) };
    } }) }),
  };
}
const db = {
  ...driver(),
  transaction: async (work: (tx: any) => unknown) => {
    const before = structuredClone(rows);
    transactionHandle = driver();
    try { return await work(transactionHandle); }
    catch (error) { rows = before; throw error; }
  },
};
function context(userId = USER, tenantId: string | null = TENANT): any {
  return { req: {}, res: {}, authProvider: "legacy", tenantId, user: { id: userId, tenantId, isActive: true, role: "user" } };
}
const caller = (userId = USER, tenantId: string | null = TENANT) => fieldOperationsRouter.createCaller(context(userId, tenantId));
const held = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ code: "EXECUTION_AUTHORITY_NOT_AVAILABLE" });
const untouched = () => { expect(writes).toEqual([]); expect(io.audit).not.toHaveBeenCalled(); };
function task(patch: Row = {}): Row {
  return { id: TASK, tenantId: TENANT, projectId: PROJECT, budgetEstimateDraftId: DRAFT, changeOrderId: null,
    status: "pending", taskType: "other", title: "Existing task", description: null, notes: null, photosCount: 0,
    deletedAt: null, actualStartDate: null, actualEndDate: null, actualHours: null, verifiedAt: null, verifiedBy: null,
    assigneeType: null, subcontractorId: null, assigneeName: null, assignedUserId: null, reworkCount: 0, ...patch };
}
beforeEach(() => {
  vi.clearAllMocks(); writes = []; locks = []; transactionHandle = null;
  rows = {
    tenants: [{ id: TENANT, isActive: true }],
    profiles: [{ id: USER, tenantId: TENANT, isActive: true, role: "user" }, { id: OUTSIDER, tenantId: OTHER_TENANT, isActive: true, role: "admin" }],
    projects: [{ id: PROJECT, tenantId: TENANT, ownerUserId: USER, deletedAt: null, fieldStartedAt: null, fieldCompletedAt: null, approvedBudgetCents: 50000 }],
    field_tasks: [task()], field_task_events: [], audit_logs: [], historical_estimate_imports: [], project_members: [],
    estimate_drafts: [{ id: DRAFT, projectId: PROJECT, tenantId: TENANT, source: "assembly_calculator", status: "approved", changeOrderOf: null, supersedesId: null, supersededBy: null, version: 1 }],
  };
  io.getDb.mockResolvedValue(db);
  io.audit.mockResolvedValue({ id: id(99) });
});

describe("field execution promotion is unavailable", () => {
  it("refuses direct manual task creation even with an approved legacy budget before any task/event/project write", async () => {
    await held(createFieldTask({ projectId: PROJECT, userId: USER, tenantId: TENANT, taskType: "other", title: "New work" })); untouched();
  });
  it("refuses direct assignment before changing assignment metadata", async () => {
    await held(assignFieldTask({ taskId: TASK, userId: USER, assigneeType: "crew", assigneeName: "Crew" })); untouched();
  });
  it.each(["assigned", "in_progress", "completed", "verified", "pending"])("refuses direct transition to %s", async to => {
    rows.field_tasks[0].status = "blocked";
    await held(transitionFieldTask({ taskId: TASK, userId: USER, to })); untouched();
  });
  it.each(["taskType", "sequence", "costCodeId", "costCode", "quantity", "unit", "budgetedCostCents", "plannedStartDate", "plannedEndDate", "plannedHours", "actualHours", "requiresInspection", "status", "assignment", "assignedAt", "assignedBy", "subcontractorId", "assignedUserId", "actualStartDate", "actualEndDate", "verificationNotes"])("refuses mixed descriptive update plus explicit null %s", async key => {
    await held(updateFieldTask({ taskId: TASK, userId: USER, notes: "Must not persist", [key]: null } as any)); untouched();
    expect(rows.field_tasks[0].notes).toBeNull();
  });
  it.each(["assignment", "actualStartDate", "actualEndDate", "actualHours", "verificationNotes", "assignedUserId"])("refuses cancelled transition carrying %s=null", async key => {
    await held(transitionFieldTask({ taskId: TASK, userId: USER, to: "cancelled", blockReason: "Work paused", [key]: null } as any)); untouched();
  });
  it("refuses another tenant's direct call before exposing historical status or operational refusal", async () => {
    rows.estimate_drafts[0].source = "historical_import";
    await expect(updateFieldTask({ taskId: TASK, userId: OUTSIDER, actualHours: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" }); untouched();
  });
  it.each(["source", "durable link"])("keeps H1 %s refusal before operational hold for authorized task writes", async source => {
    if (source === "source") rows.estimate_drafts[0].source = "historical_import";
    else rows.historical_estimate_imports.push({ id: id(88), estimateDraftId: DRAFT });
    await expect(updateFieldTask({ taskId: TASK, userId: USER, actualHours: 2 })).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" }); untouched();
  });
});

describe("retained field mutations", () => {
  it("updates only descriptive fields with a strict audit on its own transaction handle", async () => {
    const after = await updateFieldTask({ taskId: TASK, userId: USER, title: "Corrected title", description: null, notes: "Site note", photosCount: 3 });
    expect(after).toMatchObject({ title: "Corrected title", notes: "Site note", photosCount: 3, status: "pending", actualHours: null });
    expect(locks).toContain("field_tasks:update");
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "field_task.updated", before: expect.objectContaining({ title: "Existing task" }), after: expect.objectContaining({ title: "Corrected title" }) }), transactionHandle);
    expect(writes).toEqual(["update:field_tasks"]);
  });
  it.each(["blocked", "cancelled"])("allows valid %s with reason, event and transactional audit without changing project milestones/budget", async to => {
    const beforeProject = structuredClone(rows.projects[0]);
    const result = await transitionFieldTask({ taskId: TASK, userId: USER, to, blockReason: "Work paused for review" });
    expect(result.status).toBe(to);
    expect(rows.field_task_events).toEqual([expect.objectContaining({ tenantId: TENANT, fieldTaskId: TASK, fromStatus: "pending", toStatus: to, reason: "Work paused for review" })]);
    expect(rows.projects[0]).toEqual(beforeProject);
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ action: `field_task.${to}` }), transactionHandle);
  });
  it("preserves existing execution dates/hours when cancelling existing started work", async () => {
    rows.field_tasks[0] = task({ status: "in_progress", actualStartDate: "2026-10-01", actualHours: "4.5" });
    const result = await transitionFieldTask({ taskId: TASK, userId: USER, to: "cancelled", blockReason: "Stop work until review" });
    expect(result).toMatchObject({ actualStartDate: "2026-10-01", actualHours: "4.5", actualEndDate: null });
    expect(rows.projects[0].fieldCompletedAt).toBeNull();
  });
  it("refuses cancellation without its reason", async () => {
    await expect(transitionFieldTask({ taskId: TASK, userId: USER, to: "cancelled" })).rejects.toMatchObject({ code: "BLOCK_REASON_REQUIRED" }); untouched();
  });
  it.each(["update", "transition", "delete"])("rolls back all %s writes when audit fails", async operation => {
    const before = structuredClone(rows);
    io.audit.mockRejectedValueOnce(new Error("synthetic audit outage"));
    const call = operation === "update" ? updateFieldTask({ taskId: TASK, userId: USER, notes: "x" })
      : operation === "transition" ? transitionFieldTask({ taskId: TASK, userId: USER, to: "cancelled", blockReason: "Stop work" })
        : deleteFieldTask(TASK, USER);
    await expect(call).rejects.toThrow("synthetic audit outage");
    expect(rows).toEqual(before);
  });
  it("soft deletes an unstarted task while retaining its existing events, with transactional audit", async () => {
    rows.field_task_events.push({ id: id(11), fieldTaskId: TASK, toStatus: "assigned" });
    expect(await deleteFieldTask(TASK, USER)).toBe(true);
    expect(rows.field_tasks[0].deletedAt).toBeInstanceOf(Date);
    expect(rows.field_task_events).toHaveLength(1);
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "field_task.deleted" }), transactionHandle);
  });
  it.each([
    ["start date", { actualStartDate: "2026-10-01" }], ["end date", { actualEndDate: "2026-10-01" }],
    ["actual hours", { actualHours: "0" }], ["verification", { verifiedAt: new Date() }], ["rework", { reworkCount: 1 }],
  ])("refuses soft delete with %s evidence despite pending status", async (_label, patch) => {
    Object.assign(rows.field_tasks[0], patch);
    await expect(deleteFieldTask(TASK, USER)).rejects.toMatchObject({ code: "INVALID_TASK_TRANSITION" }); untouched();
  });
  it("refuses soft delete when a persisted event proves earlier execution despite forged pending row", async () => {
    rows.field_task_events.push({ id: id(11), fieldTaskId: TASK, toStatus: "in_progress" });
    await expect(deleteFieldTask(TASK, USER)).rejects.toMatchObject({ code: "INVALID_TASK_TRANSITION" }); untouched();
  });
});

describe("field router authority boundary", () => {
  it.each([
    ["createTask", { projectId: PROJECT, taskType: "other", title: "New task" }],
    ["assignTask", { taskId: TASK, assigneeType: "crew", assigneeName: "Crew" }],
    ["startTask", { taskId: TASK }], ["completeTask", { taskId: TASK }],
    ["verifyTask", { taskId: TASK }], ["unblockTask", { taskId: TASK }],
  ])("maps %s operational hold to PRECONDITION_FAILED", async (route, input) => {
    await expect((caller() as any)[route](input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", cause: { code: "EXECUTION_AUTHORITY_NOT_AVAILABLE" } }); untouched();
  });
  it.each(["actualHours", "status", "assignedUserId", "actualStartDate"])("rejects whole descriptive update with operational %s even when null", async key => {
    await expect(caller().updateTask({ taskId: TASK, notes: "Not saved", [key]: null } as any)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", cause: { code: "EXECUTION_AUTHORITY_NOT_AVAILABLE" } }); untouched();
  });
  it("preserves a plain generic cancellation without manufacturing null operational inputs", async () => {
    const result = await caller().transitionTask({ taskId: TASK, to: "cancelled", blockReason: "Stop work" });
    expect(result.status).toBe("cancelled");
    expect(rows.projects[0].fieldCompletedAt).toBeNull();
  });
  it.each(["blockTask", "cancelTask", "transitionTask"])("rejects operational extras on %s instead of dropping them", async route => {
    await expect((caller() as any)[route]({ taskId: TASK, to: "cancelled", reason: "Stop work", blockReason: "Stop work", actualHours: null }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", cause: { code: "EXECUTION_AUTHORITY_NOT_AVAILABLE" } }); untouched();
  });
  it("returns explicit unavailable budget authority rather than legacy approved money", async () => {
    expect(await caller().getBudgetEstimate({ projectId: PROJECT })).toEqual({ state: "unavailable", reason: "EXECUTION_AUTHORITY_NOT_AVAILABLE" }); untouched();
  });
  it("holds both direct budget selectors rather than returning authoritative-looking legacy values", async () => {
    await held(getProjectBudgetEstimate(PROJECT)); await held(listApprovedChangeOrders(PROJECT)); untouched();
  });
  it("keeps the unresolved-tenant boundary before any query", async () => {
    await expect(caller(USER, null).getBudgetEstimate({ projectId: PROJECT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.getDb).not.toHaveBeenCalled();
  });
});


describe("retained field changes preserve lineage and row safety", () => {
  it.each(["changeOrderOf", "supersedesId"])("refuses historical ancestry through %s", async edge => {
    const ancestor = id(31);
    rows.estimate_drafts[0][edge] = ancestor;
    rows.estimate_drafts.push({ ...rows.estimate_drafts[0], id: ancestor, [edge]: null, source: "historical_import" });
    await expect(updateFieldTask({ taskId: TASK, userId: USER, notes: "No change" }))
      .rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" }); untouched();
  });
  it("refuses a durable H1 import hidden behind a source-edited version", async () => {
    const ancestor = id(31);
    rows.estimate_drafts[0].supersedesId = ancestor;
    rows.estimate_drafts.push({ ...rows.estimate_drafts[0], id: ancestor, supersedesId: null });
    rows.historical_estimate_imports.push({ id: id(32), estimateDraftId: ancestor });
    await expect(updateFieldTask({ taskId: TASK, userId: USER, notes: "No change" }))
      .rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" }); untouched();
  });
  it.each(["missing", "cycle", "other project", "other tenant"])("refuses %s reference before even descriptive writes", async defect => {
    const ancestor = id(31);
    rows.estimate_drafts[0].supersedesId = ancestor;
    if (defect !== "missing") rows.estimate_drafts.push({ ...rows.estimate_drafts[0], id: ancestor,
      supersedesId: defect === "cycle" ? DRAFT : null, projectId: defect === "other project" ? id(32) : PROJECT,
      tenantId: defect === "other tenant" ? OTHER_TENANT : TENANT });
    await expect(updateFieldTask({ taskId: TASK, userId: USER, notes: "No change" }))
      .rejects.toMatchObject({ code: "CHANGE_ORDER_NOT_APPROVED" }); untouched();
  });
  it.each(["verified", "cancelled"])("preserves immutable %s task rows", async status => {
    rows.field_tasks[0].status = status;
    await expect(updateFieldTask({ taskId: TASK, userId: USER, notes: "No change" }))
      .rejects.toMatchObject({ code: "INVALID_TASK_TRANSITION" }); untouched();
  });
  it("refuses a task whose tenant conflicts with its project", async () => {
    rows.field_tasks[0].tenantId = OTHER_TENANT;
    await expect(updateFieldTask({ taskId: TASK, userId: USER, notes: "No change" })).rejects.toMatchObject({ code: "FORBIDDEN" }); untouched();
  });
  it("refuses a deleted task", async () => {
    rows.field_tasks[0].deletedAt = new Date();
    await expect(updateFieldTask({ taskId: TASK, userId: USER, notes: "No change" })).rejects.toMatchObject({ code: "FORBIDDEN" }); untouched();
  });
  it("treats a null audit result as failed durability and rolls back", async () => {
    io.audit.mockResolvedValueOnce(null);
    const before = structuredClone(rows);
    await expect(updateFieldTask({ taskId: TASK, userId: USER, notes: "No change" })).rejects.toThrow(/Audit insert failed/);
    expect(rows).toEqual(before);
  });
});


it("retains approve permission for direct verification attempts", async () => {
  rows.projects[0].ownerUserId = id(70);
  rows.project_members.push({ projectId: PROJECT, userId: USER, tenantId: TENANT, isActive: true, projectRole: "field", permissions: [] });
  await expect(transitionFieldTask({ taskId: TASK, userId: USER, to: "verified" })).rejects.toMatchObject({ code: "FORBIDDEN" }); untouched();
});
it("does not delete a task whose event records execution in its source status", async () => {
  rows.field_task_events.push({ id: id(11), fieldTaskId: TASK, fromStatus: "in_progress", toStatus: "assigned" });
  await expect(deleteFieldTask(TASK, USER)).rejects.toMatchObject({ code: "INVALID_TASK_TRANSITION" }); untouched();
});


it("refuses a mismatched supplied caller tenant on direct creation", async () => {
  await expect(createFieldTask({ projectId: PROJECT, userId: USER, tenantId: OTHER_TENANT, taskType: "other", title: "New task" }))
    .rejects.toMatchObject({ code: "FORBIDDEN" }); untouched();
});


it.each([
  ["blockTask", { taskId: TASK, blockReason: "Pause work" }],
  ["cancelTask", { taskId: TASK, reason: "Stop work" }],
  ["transitionTask", { taskId: TASK, to: "cancelled", blockReason: "Stop work" }],
])("does not accept the helper-only date injection through %s", async (route, command) => {
  await expect((caller() as any)[route]({ ...command, today: { untrusted: "metadata" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  untouched();
});
