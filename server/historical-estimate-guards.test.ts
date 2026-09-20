/** Existing business helpers exercised against a controlled relational query driver.
 * Physical constraints/concurrency are covered by the separate H1 PostgreSQL suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const io = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: () => database() }));
import {
  applyEstimateDraftDiscount, approveEstimateDraft, archiveEstimateDraft,
  getEstimateDraftFull, rejectEstimateDraft, updateEstimateDraftNotes,
  updateEstimateDraftStatus,
} from "./estimate-db";
import { createChangeOrder, createEstimateVersion, getExportableEstimate } from "./estimate-version-db";
import { checkExportAuthorization, downloadJobTreadExport } from "./jobtread-export-db";
import { createFieldTask, getProjectBudgetEstimate, listApprovedChangeOrders, materializeChangeOrderTasks, transitionFieldTask, updateFieldTask } from "./field-operations-db";
import { recordActual, transitionActual } from "./actuals-db";
import { getPipeline } from "./analytics-db";
import { actualsRouter } from "./actuals-router";
import { fieldOperationsRouter } from "./field-operations-router";

const TENANT = "71000000-0000-4000-8000-000000000001";
const USER = "71000000-0000-4000-8000-000000000002";
const PROJECT = "71000000-0000-4000-8000-000000000003";
const DRAFT = "71000000-0000-4000-8000-000000000004";
const IMPORT = "71000000-0000-4000-8000-000000000005";
const EXPORT = "71000000-0000-4000-8000-000000000006";
const ACTUAL = "71000000-0000-4000-8000-000000000007";
const OTHER_DRAFT = "71000000-0000-4000-8000-000000000008";
type Row = Record<string, any>;
let state: Record<string, Row[]>;
let writes: string[];
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function matches(table: string, row: Row, predicate?: SQL): boolean {
  if (!predicate) return true;
  const { sql: statement, params } = new PgDialect().sqlToQuery(predicate);
  if (/not exists/i.test(statement) && statement.includes("historical_estimate_imports")) {
    if (state.historical_estimate_imports.some(value => value.estimateDraftId === row.id)) return false;
  }
  for (const [, name, column, position] of statement.matchAll(/"([a-z_]+)"\."([a-z_]+)"\s*=\s*\$(\d+)/g)) {
    if (name === table && row[camel(column)] !== params[Number(position) - 1]) return false;
  }
  for (const [, name, column] of statement.matchAll(/"([a-z_]+)"\."([a-z_]+)" is null/gi)) {
    if (name === table && row[camel(column)] != null) return false;
  }
  for (const [, name, column, position] of statement.matchAll(/"([a-z_]+)"\."([a-z_]+)" is distinct from \$(\d+)/gi)) {
    if (name === table && row[camel(column)] === params[Number(position) - 1]) return false;
  }
  return true;
}

function database(): any {
  return {
    select: (columns?: Record<string, any>) => ({ from: (table: Table) => {
      const name = getTableName(table);
      let predicate: SQL | undefined;
      let limit = Infinity;
      let offset = 0;
      const query = {
        where: (value: SQL) => { predicate = value; return query; },
        orderBy: () => query, for: () => query,
        limit: (value: number) => { limit = value; return query; },
        offset: (value: number) => { offset = value; return query; },
        then: (resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) => {
          const rows = (state[name] ?? []).filter(row => matches(name, row, predicate)).slice(offset, offset + limit);
          const projected = columns ? rows.map(row => Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[camel(column.name ?? key)]]))) : rows;
          return Promise.resolve(structuredClone(projected)).then(resolve, reject);
        },
      };
      return query;
    } }),
    update: (table: Table) => ({ set: (patch: Row) => ({ where: (predicate: SQL) => {
      const execute = async () => {
        const name = getTableName(table);
        writes.push(`update:${name}`);
        const selected = (state[name] ?? []).filter(row => matches(name, row, predicate));
        for (const row of selected) Object.assign(row, structuredClone(patch));
        return structuredClone(selected);
      };
      return { returning: execute, then: (yes: (result: Row[]) => unknown, no?: (error: unknown) => unknown) => execute().then(yes, no) };
    } }) }),
    insert: (table: Table) => ({ values: (input: Row | Row[]) => {
      const execute = async () => {
        const name = getTableName(table);
        writes.push(`insert:${name}`);
        const rows = (Array.isArray(input) ? input : [input]).map(value => ({ id: `generated-${writes.length}`, ...structuredClone(value) }));
        (state[name] ??= []).push(...rows);
        return rows;
      };
      return { returning: execute, then: (resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) => execute().then(resolve, reject) };
    } }),
    transaction: async (callback: (tx: any) => unknown) => callback(database()),
  };
}

function draft(patch: Row = {}): Row {
  return {
    id: DRAFT, tenantId: TENANT, projectId: PROJECT, clientId: USER, createdBy: USER,
    source: "assembly_calculator", status: "draft", version: 1, supersededBy: null,
    changeOrderOf: null, approvedAt: null, finalTotalPrice: "500.00", subtotalPrice: "500.00",
    subtotalCost: "100.00", lineItems: [], commercialChannel: "direct",
    createdAt: new Date("2026-09-19T12:00:00Z"), ...patch,
  };
}
function historical(kind: "source" | "link", patch: Row = {}): void {
  state.estimate_drafts = [draft({ source: kind === "source" ? "historical_import" : "assembly_calculator", ...patch })];
  state.historical_estimate_imports = kind === "link" ? [{ id: IMPORT, tenantId: TENANT, estimateDraftId: DRAFT, projectId: PROJECT }] : [];
}
const rejected = (operation: Promise<unknown>) => expect(operation).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
const noWrites = () => expect(writes).toEqual([]);
const context = () => ({ tenantId: TENANT, user: { id: USER, role: "admin" } } as any);

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/h1-tests");
  vi.stubEnv("TENANT_STRICT", "true");
  vi.clearAllMocks(); writes = [];
  state = {
    projects: [{ id: PROJECT, tenantId: TENANT, ownerUserId: USER, clientId: null, fieldStartedAt: null, deletedAt: null, varianceThresholdPct: "10" }],
    tenants: [{ id: TENANT, isActive: true }],
    profiles: [{ id: USER, tenantId: TENANT, role: "admin", isActive: true }],
    estimate_drafts: [draft()], historical_estimate_imports: [], audit_logs: [],
    field_tasks: [], field_task_events: [], project_cost_actuals: [],
    jobtread_exports: [{ id: EXPORT, estimateDraftId: DRAFT, projectId: PROJECT, status: "approved_for_download", csvHash: null }],
  };
  io.getDb.mockResolvedValue(database());
});
afterEach(() => { vi.unstubAllEnvs(); });

describe.each(["source", "link"] as const)("H1 guards detected by %s", kind => {
  it("refuses approval before any financial mutation", async () => {
    historical(kind, { subtotalCost: null });
    await rejected(approveEstimateDraft(DRAFT, USER)); noWrites();
  });
  it("refuses discount without filling an unknown cost", async () => {
    historical(kind, { subtotalCost: null });
    await rejected(applyEstimateDraftDiscount(DRAFT, 5, USER, TENANT)); noWrites();
    expect(state.estimate_drafts[0].subtotalCost).toBeNull();
  });
  it("refuses version cloning and does not supersede the source", async () => {
    historical(kind);
    await rejected(createEstimateVersion({ sourceDraftId: DRAFT, userId: USER, reason: "Synthetic revision request" }));
    noWrites(); expect(state.estimate_drafts[0].supersededBy).toBeNull();
  });
  it("refuses change order creation even if the legacy status says approved", async () => {
    historical(kind, { status: "approved", approvedAt: new Date() });
    await rejected(createChangeOrder({ baseDraftId: DRAFT, userId: USER, reason: "Synthetic scope change" })); noWrites();
  });
  it.each(["sent_to_estimate", "converted", "rejected"] as const)("refuses generic %s", async status => {
    historical(kind);
    await rejected(updateEstimateDraftStatus(DRAFT, status, USER, TENANT)); noWrites();
  });
  it("refuses the dedicated rejection action", async () => {
    historical(kind); await rejected(rejectEstimateDraft(DRAFT, USER, "Synthetic rejection", TENANT)); noWrites();
  });
  it("refuses reopening an archived historical draft", async () => {
    historical(kind, { status: "archived" });
    await rejected(updateEstimateDraftStatus(DRAFT, "draft", USER, TENANT)); noWrites();
  });
  it("blocks export authorization despite a legacy approved stamp", async () => {
    historical(kind, { status: "approved", approvedAt: new Date() });
    const result = await checkExportAuthorization(DRAFT);
    expect(result.authorized).toBe(false); expect(result.reason).toMatch(/historical/i); noWrites();
  });
  it("blocks download of an old export attempt before CSV generation", async () => {
    historical(kind, { status: "approved", approvedAt: new Date(), lineItems: null });
    await rejected(downloadJobTreadExport(EXPORT, USER)); noWrites();
  });
  it("does not return a historical approved stamp as the project budget", async () => {
    historical(kind, { status: "approved", approvedAt: new Date() });
    expect(await getProjectBudgetEstimate(PROJECT)).toBeNull(); noWrites();
  });
  it("does not return a historical approved stamp as exportable", async () => {
    historical(kind, { status: "approved", approvedAt: new Date() });
    expect(await getExportableEstimate(PROJECT)).toBeNull(); noWrites();
  });
  it("excludes historical change orders from available budget", async () => {
    historical(kind, { status: "approved", approvedAt: new Date(), changeOrderOf: OTHER_DRAFT });
    expect(await listApprovedChangeOrders(PROJECT)).toEqual([]); noWrites();
  });
  it("refuses change-order materialization without creating field tasks", async () => {
    historical(kind, { status: "approved", approvedAt: new Date(), changeOrderOf: OTHER_DRAFT });
    await rejected(materializeChangeOrderTasks({ changeOrderId: DRAFT, userId: USER })); noWrites();
    expect(state.projects[0].fieldStartedAt).toBeNull();
  });
  it("refuses a field task linked to a historical change order even with a computed baseline", async () => {
    historical(kind, { status: "approved", approvedAt: new Date(), changeOrderOf: OTHER_DRAFT });
    state.estimate_drafts.push(draft({ id: OTHER_DRAFT, status: "approved", approvedAt: new Date() }));
    await rejected(createFieldTask({ projectId: PROJECT, tenantId: TENANT, userId: USER, taskType: "other", title: "Synthetic field task", changeOrderId: DRAFT }));
    noWrites(); expect(state.projects[0].fieldStartedAt).toBeNull();
  });
  it("refuses updating hours on a task backed by a historical estimate", async () => {
    historical(kind);
    state.field_tasks = [{ id: ACTUAL, projectId: PROJECT, status: "pending", budgetEstimateDraftId: DRAFT }];
    await rejected(updateFieldTask({ taskId: ACTUAL, userId: USER, actualHours: 2 })); noWrites();
  });
  it("refuses assignment of a task backed by a historical estimate", async () => {
    historical(kind);
    state.field_tasks = [{ id: ACTUAL, projectId: PROJECT, status: "pending", taskType: "other", budgetEstimateDraftId: DRAFT }];
    await rejected(transitionFieldTask({ taskId: ACTUAL, userId: USER, to: "assigned", assignment: { assigneeType: "crew", assigneeName: "Synthetic crew", assignedUserId: USER, subcontractorId: null } })); noWrites();
  });
  it("omits historical drafts from legacy lists", async () => {
    historical(kind);
    const legacyDb = await vi.importActual<typeof import("./db")>("./db");
    expect(await legacyDb.listEstimateDrafts()).toEqual([]); noWrites();
  });
  it("reserves historical source for the dedicated capture writer", async () => {
    const legacyDb = await vi.importActual<typeof import("./db")>("./db");
    await rejected(legacyDb.createEstimateDraft({ projectId: PROJECT, source: "historical_import", status: "approved" })); noWrites();
  });
  it.each(["supersedesId", "changeOrderOf"] as const)("refuses generic origin laundering through %s", async reference => {
    historical(kind);
    const legacyDb = await vi.importActual<typeof import("./db")>("./db");
    await rejected(legacyDb.createEstimateDraft({ projectId: PROJECT, source: "version", [reference]: DRAFT, createdBy: USER, tenantId: TENANT })); noWrites();
  });
  it("excludes historical draft revenue from the pipeline", async () => {
    historical(kind);
    expect(await getPipeline({ tenantId: TENANT })).toEqual(await getPipeline({ tenantId: "different-tenant" })); noWrites();
  });
  it("cannot record an actual against a historical approved stamp", async () => {
    historical(kind, { status: "approved", approvedAt: new Date() });
    await expect(recordActual({ projectId: PROJECT, tenantId: TENANT, userId: USER, costCode: "SYN-01", amountCents: 100, dateIncurred: "2026-09-19", vendorName: "Synthetic vendor" })).rejects.toMatchObject({ code: "NO_APPROVED_ESTIMATE" });
    noWrites();
  });
  it.each(["approved", "paid"])("cannot promote an actual to %s with a historical budget reference", async to => {
    historical(kind);
    state.project_cost_actuals = [{ id: ACTUAL, projectId: PROJECT, tenantId: TENANT, budgetEstimateDraftId: DRAFT, changeOrderId: null, status: to === "paid" ? "approved" : "pending", amountCents: 100 }];
    await rejected(transitionActual({ actualId: ACTUAL, userId: USER, to })); noWrites();
  });
  it.each(["approve", "markPaid"] as const)("maps actual %s historical refusal to PRECONDITION_FAILED", async procedure => {
    historical(kind);
    state.project_cost_actuals = [{ id: ACTUAL, projectId: PROJECT, tenantId: TENANT, budgetEstimateDraftId: DRAFT, changeOrderId: null, status: procedure === "markPaid" ? "approved" : "pending", amountCents: 100 }];
    await expect(actualsRouter.createCaller(context())[procedure]({ actualId: ACTUAL })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("HISTORICAL_AUTHORITY_NOT_AVAILABLE") }); noWrites();
  });
  it("maps field update historical refusal to PRECONDITION_FAILED", async () => {
    historical(kind);
    state.field_tasks = [{ id: ACTUAL, projectId: PROJECT, tenantId: TENANT, status: "pending", budgetEstimateDraftId: DRAFT }];
    await expect(fieldOperationsRouter.createCaller(context()).updateTask({ taskId: ACTUAL, actualHours: 2 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("HISTORICAL_AUTHORITY_NOT_AVAILABLE") }); noWrites();
  });
  it("maps field materialization historical refusal to PRECONDITION_FAILED", async () => {
    historical(kind, { status: "approved", approvedAt: new Date(), changeOrderOf: OTHER_DRAFT });
    await expect(fieldOperationsRouter.createCaller(context()).materializeChangeOrder({ changeOrderId: DRAFT })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("HISTORICAL_AUTHORITY_NOT_AVAILABLE") }); noWrites();
  });
});

describe("permitted reads and cosmetic operations", () => {
  it("returns relational historical identity even if the source field was changed", async () => {
    historical("link", { subtotalCost: null });
    expect(await getEstimateDraftFull(DRAFT)).toMatchObject({ historicalImportId: IMPORT, subtotalCost: null });
  });
  it("allows descriptive notes without rewriting historical evidence or money", async () => {
    historical("source", { subtotalCost: null });
    await updateEstimateDraftNotes(DRAFT, "Internal descriptive note", USER, TENANT);
    expect(state.estimate_drafts[0]).toMatchObject({ notes: "Internal descriptive note", subtotalCost: null, finalTotalPrice: "500.00", status: "draft" });
    expect(writes).not.toContain("update:historical_estimate_imports");
  });
  it("allows visual archival without changing money", async () => {
    historical("source"); await archiveEstimateDraft(DRAFT, USER, TENANT);
    expect(state.estimate_drafts[0]).toMatchObject({ status: "archived", finalTotalPrice: "500.00" });
  });
  it("retains the existing global generic-approved rejection", async () => {
    await expect(updateEstimateDraftStatus(DRAFT, "approved", USER, TENANT)).rejects.toMatchObject({ code: "ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION" }); noWrites();
  });
  it("preserves a calculated draft's ordinary status transition", async () => {
    await updateEstimateDraftStatus(DRAFT, "sent_to_estimate", USER, TENANT);
    expect(state.estimate_drafts[0].status).toBe("sent_to_estimate");
  });
  it("preserves a calculated approved budget whose source is NULL", async () => {
    state.estimate_drafts = [draft({ source: null, status: "approved", approvedAt: new Date() })];
    expect(await getProjectBudgetEstimate(PROJECT)).toMatchObject({ id: DRAFT, source: null });
  });
});
