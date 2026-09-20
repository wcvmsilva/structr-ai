/** Actual routes, project access, lifecycle authorization and formatters; isolated IO only. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn(), permission: vi.fn(), put: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./audit", () => ({ logAudit: io.audit }));
vi.mock("./rbac", () => ({ hasPermission: io.permission }));
vi.mock("./storage", () => ({ storagePut: io.put }));
vi.mock("./estimate-export", async importOriginal => {
  const real = await importOriginal<typeof import("./estimate-export")>();
  return { ...real, generatePdfExport: vi.fn(real.generatePdfExport), generateJsonExport: vi.fn(real.generateJsonExport) };
});
import { estimateRouter } from "./estimate-router";
import { checkExportAuthorization, requestJobTreadExport, downloadJobTreadExport, listExportsForEstimate, listExportsForProject, getExportById } from "./jobtread-export-db";
import { generatePdfExport, generateJsonExport } from "./estimate-export";

const TENANT = "a3100000-0000-4000-8000-000000000001";
const OTHER = "a3100000-0000-4000-8000-000000000002";
const USER = "b3100000-0000-4000-8000-000000000001";
const PROJECT = "c3100000-0000-4000-8000-000000000001";
const DRAFT = "d3100000-0000-4000-8000-000000000001";
const NEXT = "d3100000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-19T12:00:00Z");
type Row = Record<string, unknown>;
const rows: Record<string, Row[]> = {};
const reads: string[] = [];
let draftReads = 0;
let beforeRead: ((table: string, count: number) => void) | undefined;
const mutationWrites: string[] = [];
const transactionLocks: string[] = [];
const camel = (value: string) => value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
function select(columns?: Record<string, { name: string }>) {
  return { from: (table: Table) => {
    const name = getTableName(table);
    let predicate: SQL, maximum = Infinity, lock: string | undefined;
    const query = {
      where: (value: SQL) => { predicate = value; return query; },
      orderBy: (..._order: unknown[]) => query,
      limit: (value: number) => { maximum = value; return query; },
      for: (value: string) => { lock = value; return query; },
      then: (resolve: (result: Row[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        reads.push(name);
        if (lock) transactionLocks.push(`${name}:${lock}`);
        if (name === "estimate_drafts") draftReads += 1;
        beforeRead?.(name, draftReads);
        const compiled = new PgDialect().sqlToQuery(predicate);
        let selected: Row[];
        if (name === "historical_estimate_imports") {
          expect(compiled.params).toEqual([DRAFT]);
          selected = (rows[name] ?? []).filter(row => row.estimateDraftId === compiled.params[0]);
        } else if (name === "project_members") {
          expect(compiled.params).toEqual([PROJECT, USER]);
          selected = rows[name] ?? [];
        } else {
          const conditions = [...compiled.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g)];
          if (conditions.length === 0) throw new Error("Expected exact relational identity lookup");
          selected = (rows[name] ?? []).filter(row => conditions.every(([, tableName, column, position]) => {
            if (tableName !== name) throw new Error("Unexpected cross-table predicate");
            return row[camel(column)] === compiled.params[Number(position) - 1];
          }));
        }
        selected = selected.slice(0, maximum);
        if (columns) selected = selected.map(row => Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[camel(column.name)]])));
        return structuredClone(selected);
      }).then(resolve, reject),
    };
    return query;
  } };
}
function unexpectedWrite(table: Table): never {
  mutationWrites.push(getTableName(table));
  throw new Error("Unexpected mutation in document authorization fixture");
}
const transactionDriver = { select, update: unexpectedWrite, insert: unexpectedWrite };
const driver = {
  select,
  transaction: vi.fn(async <T>(work: (tx: typeof transactionDriver) => Promise<T>) => {
    const before = structuredClone(rows);
    try { return await work(transactionDriver); } catch (error) {
      for (const key of Object.keys(rows)) delete rows[key];
      Object.assign(rows, before); throw error;
    }
  }),
};
function context(authenticated = true): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId: TENANT,
    user: authenticated ? {
      id: USER, tenantId: TENANT, role: "user", isActive: true, externalOpenId: null,
      email: "operator@example.invalid", fullName: "Synthetic Operator", companyName: null,
      loginMethod: "legacy", lastSignedIn: NOW, createdAt: NOW, updatedAt: NOW,
    } : null,
  };
}
function expectNoPayload() {
  expect(generatePdfExport).not.toHaveBeenCalled();
  expect(generateJsonExport).not.toHaveBeenCalled();
  expect(io.put).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TENANT_STRICT", "true");
  reads.length = 0; draftReads = 0; beforeRead = undefined;
  mutationWrites.length = 0; transactionLocks.length = 0;
  rows.tenants = [{ id: TENANT, isActive: true }];
  rows.estimate_internal_approval_snapshots = []; rows.estimate_internal_approvals = [];
  rows.historical_estimate_imports = [];
  rows.estimate_drafts = [{
    id: DRAFT, tenantId: TENANT, projectId: PROJECT, clientId: null, supersedesId: null, createdBy: USER, status: "approved", version: 2,
    approvedBy: USER, approvedAt: NOW, lockedAt: NOW, supersededBy: null, changeOrderOf: null,
    subtotalCost: "600.00", subtotalPrice: "1200.00", finalTotalPrice: "1200.00", grossProfit: "600.00", grossProfitPct: "50.00",
    bundleName: "Wholly invented export fixture", source: "scope_draft", channel: "direct", commercialChannel: "premium",
    region: "synthetic", finishLevel: "standard", pricingSchemaVersion: "1.0", createdAt: NOW, updatedAt: NOW,
    lineItems: [], assemblySelections: [], metadata: {}, notes: null, scopeDraftId: null,
    discountApplied: false, discountAmount: "0.00", profitShieldPassed: true, profitShieldMinPct: "28.00",
  }];
  rows.projects = [{ id: PROJECT, tenantId: TENANT, ownerUserId: USER, deletedAt: null }];
  rows.profiles = [{ id: USER, tenantId: TENANT, role: "user", isActive: true }];
  rows.project_members = [];
  io.getDb.mockResolvedValue(driver); io.permission.mockResolvedValue(false);
  io.audit.mockResolvedValue({ id: "synthetic-audit" });
  io.put.mockResolvedValue({ url: "https://storage.example.invalid/synthetic-file" });
});
afterEach(() => { vi.unstubAllEnvs(); });


const actor = { actorId: USER, tenantId: TENANT };
const EXPORT = "f3100000-0000-4000-8000-000000000001";
const held = { code: "PRECONDITION_FAILED", message: expect.stringMatching(/unavailable/i) };
const routes = ["approveEstimate", "createVersion", "createChangeOrder", "exportPdf", "exportJson", "exportPrintable", "validateCsvExport", "exportCsv", "exportPreflight"] as const;
function invoke(operation: typeof routes[number], ctx = context()) {
  const caller = estimateRouter.createCaller(ctx);
  if (operation === "createVersion" || operation === "createChangeOrder") return caller[operation]({ id: DRAFT, reason: "Synthetic C2-A hold" });
  return caller[operation]({ id: DRAFT });
}
describe.each(routes)("C2-A actual %s route", operation => {
  it("refuses an otherwise eligible legacy record before effects", async () => {
    if (operation === "approveEstimate") rows.estimate_drafts[0].status = "draft";
    await expect(invoke(operation)).rejects.toMatchObject(held);
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });
  it("preserves authentication ahead of the hold", async () => {
    await expect(invoke(operation, context(false))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(reads).toEqual([]); expectNoPayload();
  });
  it("preserves project permission ahead of the hold", async () => {
    rows.projects[0].ownerUserId = "other";
    await expect(invoke(operation)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
});
describe("C2-A export helpers and safe historical reads", () => {
  function seedExport() {
    rows.jobtread_exports = [{ id: EXPORT, tenantId: TENANT, projectId: PROJECT, estimateDraftId: DRAFT, estimateVersion: 2,
      status: "downloaded", rowCount: 8, createdAt: NOW, downloadedAt: NOW, csvHash: "private-hash", manifest: { url: "private-url" },
      validationReport: { payload: "private" }, blockReason: "private-message", storageKey: "private-key" }];
  }
  it.each(["approved", "draft", "internally_approved", "rejected"])("never authorizes %s", async status => {
    rows.estimate_drafts[0].status = status;
    const result = await checkExportAuthorization(DRAFT);
    expect(result).toMatchObject({ authorized: false, reason: expect.stringMatching(/unavailable/i) });
    expect(result).not.toHaveProperty("draft");
  });
  it.each(["request", "download"])("direct %s holds before consulting DB or writing", async operation => {
    io.getDb.mockRejectedValue(new Error("must not consult DB"));
    const result = operation === "request" ? requestJobTreadExport({ estimateDraftId: DRAFT, userId: USER, tenantId: TENANT }) : downloadJobTreadExport(EXPORT, USER);
    await expect(result).rejects.toMatchObject({ code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE" });
    expect(io.getDb).not.toHaveBeenCalled(); expect(io.audit).not.toHaveBeenCalled();
  });
  it.each(["estimate", "project", "single"])("returns only closed contextual %s history", async kind => {
    seedExport();
    const result = kind === "estimate" ? await listExportsForEstimate(DRAFT, actor) : kind === "project" ? await listExportsForProject(PROJECT, actor) : [await getExportById(EXPORT, actor)];
    expect(result).toEqual([{ id: EXPORT, projectId: PROJECT, estimateDraftId: DRAFT, estimateVersion: 2, status: "downloaded", rowCount: 8, createdAt: NOW, downloadedAt: NOW, downloadUnavailable: true }]);
    expect(io.audit).not.toHaveBeenCalled(); expect(mutationWrites).toEqual([]);
  });
  it.each(["tenant", "project", "estimate", "requestTenant", "actor"])("rejects incoherent historical %s", async fault => {
    seedExport();
    if (fault === "tenant") rows.jobtread_exports[0].tenantId = OTHER;
    if (fault === "project") rows.jobtread_exports[0].projectId = NEXT;
    if (fault === "estimate") rows.jobtread_exports[0].estimateDraftId = NEXT;
    if (fault === "requestTenant") actor.tenantId = OTHER;
    if (fault === "actor") actor.actorId = NEXT;
    try { await expect(getExportById(EXPORT, actor)).rejects.toBeDefined(); }
    finally { actor.tenantId = TENANT; actor.actorId = USER; }
    expectNoPayload(); expect(mutationWrites).toEqual([]);
  });
  it("holds download of an otherwise coherent historical ready attempt", async () => {
    seedExport(); rows.jobtread_exports[0].status = "approved_for_download";
    await expect(estimateRouter.createCaller(context()).downloadExport({ exportId: EXPORT })).rejects.toMatchObject(held);
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });

  it.each(["missing", "inactive"])("denies direct historical evidence when the company is %s", async fault => {
    seedExport();
    rows.tenants = fault === "missing" ? [] : [{ id: TENANT, isActive: false }];
    await expect(getExportById(EXPORT, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });

  it.each(["missing", "inactive"])("denies project history through the real route when the company is %s", async fault => {
    seedExport();
    rows.tenants = fault === "missing" ? [] : [{ id: TENANT, isActive: false }];
    await expect(estimateRouter.createCaller(context()).listProjectExports({ projectId: PROJECT }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected history transaction failure without returning driver details", async () => {
    seedExport();
    const sentinel = "synthetic private driver statement and parameters";
    driver.transaction.mockRejectedValueOnce(new Error(sentinel));
    const error = await estimateRouter.createCaller(context()).listProjectExports({ projectId: PROJECT })
      .then(() => undefined, failure => failure);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(error.message).not.toContain(sentinel);
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });

  it("keeps identity, lifecycle and project authorization on one serializable history transaction", async () => {
    seedExport();
    const poolSelect = vi.spyOn(driver, "select").mockImplementation(() => {
      throw new Error("History authorization must not read outside its transaction");
    });
    try {
      await expect(getExportById(EXPORT, actor)).resolves.toMatchObject({ id: EXPORT, downloadUnavailable: true });
      expect(io.getDb).toHaveBeenCalledTimes(1);
      expect(driver.transaction).toHaveBeenCalledTimes(1);
      expect(driver.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "serializable" });
      expect(poolSelect).not.toHaveBeenCalled();
      expect(transactionLocks).toEqual(expect.arrayContaining(["tenants:share", "projects:update", "profiles:share"]));
      expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
    } finally { poolSelect.mockRestore(); }
  });

  it("rejects the whole project history when a later record points to another project's estimate", async () => {
    seedExport();
    rows.jobtread_exports.push({ ...rows.jobtread_exports[0], id: "f3100000-0000-4000-8000-000000000002", estimateDraftId: NEXT });
    rows.estimate_drafts.push({ ...rows.estimate_drafts[0], id: NEXT, projectId: OTHER });
    await expect(listExportsForProject(PROJECT, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The valid first record is not returned as a partial success.
    expect(reads.filter(table => table === "estimate_drafts")).toHaveLength(2);
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });

  it("requires project permission even when the historical list is empty", async () => {
    rows.jobtread_exports = [];
    await expect(listExportsForProject(PROJECT, actor)).resolves.toEqual([]);
    rows.projects[0].ownerUserId = "synthetic-other-owner";
    await expect(listExportsForProject(PROJECT, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });

  it("sanitizes a driver failure in the route's preliminary history ACL as well", async () => {
    seedExport();
    const sentinel = "synthetic private preliminary ACL SQL and parameters";
    io.getDb.mockRejectedValueOnce(new Error(sentinel));
    const error = await estimateRouter.createCaller(context()).listProjectExports({ projectId: PROJECT })
      .then(() => undefined, failure => failure);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(error.message).not.toContain(sentinel);
    expect(driver.transaction).not.toHaveBeenCalled();
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });
});
