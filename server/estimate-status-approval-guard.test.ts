/** Real route, access guard and estimate helper; only persistence/audit sinks are isolated. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getDb: boundary.getDb }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));
vi.mock("./rbac", () => ({ hasPermission: boundary.permission }));
import { estimateRouter } from "./estimate-router";
import { updateEstimateDraftStatus, archiveEstimateDraft } from "./estimate-db";

const TENANT = "a2900000-0000-4000-8000-000000000001";
const OTHER_TENANT = "a2900000-0000-4000-8000-000000000002";
const USER = "b2900000-0000-4000-8000-000000000001";
const PROJECT = "c2900000-0000-4000-8000-000000000001";
const DRAFT = "d2900000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-18T23:00:00Z");
type Row = Record<string, unknown>;
const rows: Record<string, Row[]> = {};
const events: string[] = [];
function matching(table: Table, predicate: SQL) {
  const name = getTableName(table);
  const query = new PgDialect().sqlToQuery(predicate);
  if (name === "project_members") return [];
  const conditions = [...query.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g)];
  if (conditions.length === 0) throw new Error("Expected exact relational identity lookup");
  return (rows[name] ?? []).filter(row => conditions.every(([, tableName, column, position]) => {
    if (tableName !== name) throw new Error("Unexpected cross-table predicate");
    const field = column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    return row[field] === query.params[Number(position) - 1];
  }));
}
const driver = {
  select: (columns?: Record<string, any>) => ({ from: (table: Table) => {
    let predicate: SQL; let maximum = Infinity;
    const query = {
      where: (value: SQL) => { predicate = value; return query; },
      limit: (value: number) => { maximum = value; return query; },
      for: () => query,
      then: (yes: (result: Row[]) => unknown, no?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        events.push(`read:${getTableName(table)}`);
        const selected = structuredClone(matching(table, predicate).slice(0, maximum));
        return columns ? selected.map(row => Object.fromEntries(Object.entries(columns).map(([key, column]) => [key,
          row[column.name.replace(/_([a-z])/g, (_match: string, letter: string) => letter.toUpperCase())],
        ]))) : selected;
      }).then(yes, no),
    };
    return query;
  } }),
  update: (table: Table) => ({ set: (patch: Row) => ({ where: (predicate: SQL) => {
    const write = async () => {
      events.push(`write:${getTableName(table)}`);
      const selected = matching(table, predicate);
      for (const row of selected) Object.assign(row, patch);
      return structuredClone(selected);
    };
    return { returning: write, then: (yes: (result: Row[]) => unknown, no?: (error: unknown) => unknown) => write().then(yes, no) };
  } }) }),
  transaction: async <T>(work: (tx: any) => Promise<T>) => {
    const before = structuredClone(rows);
    try { return await work(driver); } catch (error) {
      for (const key of Object.keys(rows)) delete rows[key];
      Object.assign(rows, before); throw error;
    }
  },
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
const caller = () => estimateRouter.createCaller(context());
function expectNoWrites() {
  expect(events.filter(event => event.startsWith("write:"))).toEqual([]);
  expect(boundary.audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TENANT_STRICT", "true");
  events.length = 0;
  rows.estimate_drafts = [{
    id: DRAFT, tenantId: TENANT, projectId: PROJECT, createdBy: USER, status: "draft",
    version: 1, approvedBy: null, approvedAt: null, lockedAt: null, changeOrderOf: null,
    subtotalCost: "900.00", subtotalPrice: "1200.00", finalTotalPrice: "1200.00",
    grossProfit: "300.00", grossProfitPct: "25.00", bundleName: "Synthetic partial estimate",
    commercialChannel: null, pricingSnapshot: null, draftData: {},
  }];
  rows.historical_estimate_imports = [];
  rows.projects = [{ id: PROJECT, tenantId: TENANT, ownerUserId: USER, deletedAt: null }];
  rows.profiles = [{ id: USER, tenantId: TENANT, role: "user", isActive: true }];
  boundary.getDb.mockResolvedValue(driver);
  boundary.audit.mockImplementation(async (params) => ({
    id: "e2900000-0000-4000-8000-000000000001", userId: params.userId, action: params.action,
    tableName: params.tableName, recordId: params.recordId, oldValues: params.before ?? null,
    newValues: params.after ?? null, createdAt: NOW, ipAddress: null, userAgent: null,
  }));
  rows.tenants = [{ id: TENANT, isActive: true }];
  rows.estimate_internal_approval_snapshots = []; rows.estimate_internal_approvals = [];
  boundary.permission.mockResolvedValue(false);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("approval cannot use the generic status writer", () => {
  it.each(["draft", "sent_to_estimate"])("rejects approved from %s before any DB call, even above the floor", async status => {
    Object.assign(rows.estimate_drafts[0], { status, commercialChannel: "premium", subtotalCost: "600.00" });
    const before = structuredClone(rows.estimate_drafts[0]);
    await expect(updateEstimateDraftStatus(DRAFT, "approved", USER, TENANT)).rejects.toMatchObject({
      code: "ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION",
      message: expect.stringContaining("estimate.approveEstimate"),
    });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(rows.estimate_drafts[0]).toEqual(before);
    expectNoWrites();
  });

  it("refuses approval without requiring an available database", async () => {
    boundary.getDb.mockResolvedValue(null);
    await expect(updateEstimateDraftStatus(DRAFT, "approved", USER, TENANT)).rejects.toMatchObject({
      code: "ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION",
    });
    expect(boundary.getDb).not.toHaveBeenCalled();
  });

  it("returns an actionable BAD_REQUEST on the existing authorized route without changing money or status", async () => {
    const before = structuredClone(rows.estimate_drafts[0]);
    await expect(caller().updateStatus({ id: DRAFT, status: "approved" })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: expect.stringContaining("estimate.approveEstimate"),
    });
    expect(events).toEqual(["read:estimate_drafts", "read:projects", "read:profiles"]);
    expect(rows.estimate_drafts[0]).toEqual(before);
    expectNoWrites();
  });

  it("requires authentication before any business reads", async () => {
    await expect(estimateRouter.createCaller(context(false)).updateStatus({ id: DRAFT, status: "approved" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(events).toEqual([]);
    expectNoWrites();
  });

  it("validates UUID input before business reads", async () => {
    await expect(caller().updateStatus({ id: "invalid", status: "approved" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(events).toEqual([]);
    expectNoWrites();
  });

  it.each(["user", "admin"])("preserves cross-tenant denial for %s before exposing approval guidance", async role => {
    rows.profiles[0].role = role;
    rows.projects[0].tenantId = OTHER_TENANT;
    const ctx = context();
    if (ctx.user) ctx.user.role = role;
    await expect(estimateRouter.createCaller(ctx).updateStatus({ id: DRAFT, status: "approved" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoWrites();
  });

  it("preserves denial for an unresolved operator tenant", async () => {
    rows.profiles[0].tenantId = null;
    await expect(caller().updateStatus({ id: DRAFT, status: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoWrites();
  });

  it("preserves project approval permission checks", async () => {
    rows.projects[0].ownerUserId = "b2900000-0000-4000-8000-000000000002";
    await expect(caller().updateStatus({ id: DRAFT, status: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(boundary.permission).toHaveBeenCalledWith(USER, "project", "approve");
    expectNoWrites();
  });

  it("preserves NOT_FOUND when the draft does not exist", async () => {
    rows.estimate_drafts = [];
    await expect(caller().updateStatus({ id: DRAFT, status: "approved" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expectNoWrites();
  });

  it("still reopens a rejected draft and records the existing audit", async () => {
    rows.estimate_drafts[0].status = "rejected";
    await expect(caller().updateStatus({ id: DRAFT, status: "draft" })).resolves.toMatchObject({ status: "draft", finalTotalPrice: "1200.00" });
    expect(boundary.audit).toHaveBeenCalledTimes(1);
    expect(boundary.audit).toHaveBeenCalledWith({ userId: USER, action: "estimate_draft.status_change",
      tableName: "estimate_drafts", recordId: DRAFT, before: { status: "rejected" }, after: { status: "draft" } }, driver);
  });

  it("still archives through the existing helper with audit", async () => {
    await expect(archiveEstimateDraft(DRAFT, USER, TENANT)).resolves.toMatchObject({ status: "archived" });
    expect(boundary.audit).toHaveBeenCalledWith(expect.objectContaining({
      before: { status: "draft" }, after: { status: "archived" }, action: "estimate_draft.status_change",
    }), driver);
  });

  it("preserves invalid nonapproval transition rejection", async () => {
    rows.estimate_drafts[0].status = "archived";
    await expect(caller().updateStatus({ id: DRAFT, status: "converted" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectNoWrites();
  });

  it("keeps the dedicated approval path gated by the actual Profit Shield", async () => {
    await expect(caller().approveEstimate({ id: DRAFT })).rejects.toThrow("Approval blocked by Profit Shield");
    expect(rows.estimate_drafts[0]).toMatchObject({ status: "draft", approvedBy: null, approvedAt: null, lockedAt: null });
    expectNoWrites();
  });

  it("keeps compliant dedicated approval with approver, lock and audit evidence", async () => {
    Object.assign(rows.estimate_drafts[0], { subtotalCost: "600.00", commercialChannel: "premium" });
    await expect(caller().approveEstimate({ id: DRAFT })).resolves.toMatchObject({
      status: "approved", approvedBy: USER, approvedAt: expect.any(Date), lockedAt: expect.any(Date),
      finalTotalPrice: "1200.00", profitShieldFloorPct: "28",
    });
    expect(boundary.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "estimate_approved", before: { status: "draft" },
      after: expect.objectContaining({ approvedBy: USER, profitShieldFloorPct: 28, profitShieldActualPct: 50 }),
    }));
  });
});
