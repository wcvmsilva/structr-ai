// C2-A ratification supersedes positive legacy issuance. Identity/ACL/snapshot
// controls remain; a refusal is before admission, so it writes no partial attempt/audit.
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

describe.each(["pdf", "json"] as const)("%s document export approval authorization", format => {
  const invoke = (ctx = context(), id = DRAFT) => {
    const caller = estimateRouter.createCaller(ctx);
    return format === "pdf" ? caller.exportPdf({ id }) : caller.exportJson({ id });
  };
  const generator = () => format === "pdf" ? vi.mocked(generatePdfExport) : vi.mocked(generateJsonExport);

  it.each(["draft", "sent_to_estimate", "converted", "archived", "rejected"])("blocks %s before generating or uploading without admitting a governed attempt", async status => {
    rows.estimate_drafts[0].status = status;
    const before = structuredClone(rows.estimate_drafts[0]);
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/unavailable/i) });
    expectNoPayload(); expect(rows.estimate_drafts[0]).toEqual(before);
    expect(io.audit).not.toHaveBeenCalled();
  });
  it("blocks a superseded approval", async () => {
    rows.estimate_drafts[0].supersededBy = NEXT;
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/unavailable/i) });
    expectNoPayload();
  });
  it("blocks approval with missing timestamp evidence", async () => {
    rows.estimate_drafts[0].approvedAt = null;
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/unavailable/i) });
    expectNoPayload();
  });
  it("does not trust a previous positive UI authorization", async () => {
    await expect(estimateRouter.createCaller(context()).exportAuthorization({ id: DRAFT })).resolves.toMatchObject({ authorized: false });
    rows.estimate_drafts[0].status = "rejected";
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoPayload();
  });
  it("keeps denied exports denied when the existing audit sink returns null", async () => {
    rows.estimate_drafts[0].status = "draft"; io.audit.mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoPayload();
  });
  it("requires authentication before any reads or payload work", async () => {
    await expect(invoke(context(false))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(reads).toEqual([]); expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("validates UUID input before business reads", async () => {
    await expect(invoke(context(), "not-an-id")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(reads).toEqual([]); expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it.each(["user", "admin"])("keeps cross-tenant %s denied before disclosing export state", async role => {
    rows.profiles[0].tenantId = OTHER; rows.profiles[0].role = role;
    const ctx = context(); ctx.user!.role = role as "user" | "admin";
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("denies an unresolved profile tenant", async () => {
    rows.profiles[0].tenantId = null;
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload();
  });
  it("denies an inactive profile", async () => {
    rows.profiles[0].isActive = false;
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" }); expectNoPayload();
  });
  it("requires project read access", async () => {
    rows.projects[0].ownerUserId = "another-owner";
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.permission).toHaveBeenCalledWith(USER, "project", "read"); expectNoPayload();
  });
  it("preserves read-only member access to context while holding issuance", async () => {
    rows.projects[0].ownerUserId = "another-owner";
    rows.project_members = [{ projectRole: "viewer", permissions: [], isActive: true }];
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoPayload();
  });
  it("returns not found for a missing draft", async () => {
    rows.estimate_drafts = [];
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" }); expectNoPayload();
  });
  it("does not export a draft that disappears after the access check", async () => {
    beforeRead = (table, count) => { if (table === "estimate_drafts" && count === 2) rows.estimate_drafts = []; };
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" }); expectNoPayload();
  });
  it.each([OTHER, null])("rejects an export snapshot with tenant %s even when its project is accessible", async tenantId => {
    rows.estimate_drafts[0].tenantId = tenantId;
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it.each([OTHER, null])("rejects tenant %s introduced between the access check and export snapshot", async tenantId => {
    beforeRead = (table, count) => {
      if (table === "estimate_drafts" && count === 2) rows.estimate_drafts[0].tenantId = tenantId;
    };
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("rejects a snapshot rebound to another project after the original project was authorized", async () => {
    beforeRead = (table, count) => {
      if (table === "estimate_drafts" && count === 2) rows.estimate_drafts[0].projectId = NEXT;
    };
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("requires a resolved request tenant for the document snapshot", async () => {
    const ctx = context(); ctx.tenantId = null;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("rejects a snapshot and request tenant inconsistent with the authorized project tenant", async () => {
    const ctx = context(); ctx.tenantId = OTHER; rows.estimate_drafts[0].tenantId = OTHER;
    await expect(invoke(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
  it("does not allow a null draft tenant to authorize export with strict mode disabled", async () => {
    vi.stubEnv("TENANT_STRICT", "false"); rows.estimate_drafts[0].tenantId = null;
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoPayload();
  });
  it("fails closed when the authorization database becomes unavailable", async () => {
    io.getDb.mockResolvedValueOnce(driver).mockResolvedValueOnce(driver).mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); expectNoPayload();
  });
  it("holds a fully stamped legacy approval without bytes, storage or success audit", async () => {
    const before = structuredClone(rows.estimate_drafts[0]);
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
    expect(rows.estimate_drafts[0]).toEqual(before);
  });

  it("never touches storage even if the sink would fail", async () => {
    io.put.mockRejectedValueOnce(new Error("Synthetic storage failure"));
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expectNoPayload(); expect(io.audit).not.toHaveBeenCalled();
  });
});

describe.each(["exportPrintable", "validateCsvExport", "profitShield"] as const)("H1 %s direct route", operation => {
  it.each(["source", "link"])("rejects capture-only origin detected by %s before legacy formatting", async kind => {
    if (kind === "source") rows.estimate_drafts[0].source = "historical_import";
    else rows.historical_estimate_imports = [{ id: NEXT, estimateDraftId: DRAFT }];
    rows.estimate_drafts[0].subtotalCost = null;
    await expect(estimateRouter.createCaller(context())[operation]({ id: DRAFT })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: operation === "profitShield" ? expect.stringMatching(/historical/i) : expect.stringMatching(/unavailable/i) });
    expect(io.put).not.toHaveBeenCalled();
    expect(io.audit).not.toHaveBeenCalled();
  });
});

describe.each(["source", "link"] as const)("H1 mutation error mapping by %s", kind => {
  it.each(["updateStatus", "approveEstimate", "rejectEstimate", "applyDiscount"] as const)("returns a precise unavailable authority error for %s", async operation => {
    rows.estimate_drafts[0].status = "draft";
    if (kind === "source") rows.estimate_drafts[0].source = "historical_import";
    else rows.historical_estimate_imports = [{ id: NEXT, estimateDraftId: DRAFT }];
    const caller = estimateRouter.createCaller(context());
    const result = operation === "updateStatus" ? caller.updateStatus({ id: DRAFT, status: "sent_to_estimate" })
      : operation === "approveEstimate" ? caller.approveEstimate({ id: DRAFT })
      : operation === "rejectEstimate" ? caller.rejectEstimate({ id: DRAFT, reason: "Synthetic rejection" })
      : caller.applyDiscount({ id: DRAFT, discountPct: 5 });
    await expect(result).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: operation === "approveEstimate" ? expect.stringMatching(/unavailable/i) : expect.stringMatching(/historical/i) });
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
    if (operation !== "approveEstimate") {
      expect(driver.transaction).toHaveBeenCalledTimes(1);
      expect(driver.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "serializable" });
      expect(transactionLocks).toEqual(expect.arrayContaining(["projects:update", "estimate_drafts:update", "tenants:share", "profiles:share"]));
    }
  });
});
