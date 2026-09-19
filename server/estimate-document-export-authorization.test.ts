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
const driver = {
  select: () => ({ from: (table: Table) => ({ where: (predicate: SQL) => ({ limit: async (limit: number) => {
    const name = getTableName(table);
    reads.push(name);
    if (name === "estimate_drafts") draftReads += 1;
    beforeRead?.(name, draftReads);
    const query = new PgDialect().sqlToQuery(predicate);
    if (name === "historical_estimate_imports") {
      expect(query.params).toEqual([DRAFT]);
      return structuredClone((rows[name] ?? []).filter(row => row.estimateDraftId === query.params[0]).slice(0, limit));
    }
    if (name === "project_members") {
      expect(query.params).toEqual([PROJECT, USER]);
      return structuredClone((rows[name] ?? []).slice(0, limit));
    }
    if (query.sql !== `"${name}"."id" = $1`) throw new Error("Expected primary-key lookup");
    return structuredClone((rows[name] ?? []).filter(row => row.id === query.params[0]).slice(0, limit));
  } }) }) }),
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
  rows.historical_estimate_imports = [];
  rows.estimate_drafts = [{
    id: DRAFT, tenantId: TENANT, projectId: PROJECT, createdBy: USER, status: "approved", version: 2,
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

  it.each(["draft", "sent_to_estimate", "converted", "archived", "rejected"])("blocks %s before generating or uploading and audits the refusal", async status => {
    rows.estimate_drafts[0].status = status;
    const before = structuredClone(rows.estimate_drafts[0]);
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("approved") });
    expectNoPayload(); expect(rows.estimate_drafts[0]).toEqual(before);
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER, action: "estimate.export_blocked", tableName: "estimate_drafts", recordId: DRAFT,
      before: { status, version: 2, supersededBy: null, approvedAt: NOW },
      after: expect.objectContaining({ format, reason: expect.any(String) }),
    }));
  });
  it("blocks a superseded approval", async () => {
    rows.estimate_drafts[0].supersededBy = NEXT;
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/superseded/i) });
    expectNoPayload();
  });
  it("blocks approval with missing timestamp evidence", async () => {
    rows.estimate_drafts[0].approvedAt = null;
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/timestamp|evidence/i) });
    expectNoPayload();
  });
  it("does not trust a previous positive UI authorization", async () => {
    await expect(estimateRouter.createCaller(context()).exportAuthorization({ id: DRAFT })).resolves.toMatchObject({ authorized: true });
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
  it("preserves read-only project member access to an authorized document", async () => {
    rows.projects[0].ownerUserId = "another-owner";
    rows.project_members = [{ projectRole: "viewer", permissions: [], isActive: true }];
    await expect(invoke()).resolves.toMatchObject({ estimateId: DRAFT, format });
    expect(io.put).toHaveBeenCalledOnce();
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
  it("preserves the legacy null-row policy only while tenant strict mode is disabled", async () => {
    vi.stubEnv("TENANT_STRICT", "false"); rows.estimate_drafts[0].tenantId = null;
    await expect(invoke()).resolves.toMatchObject({ estimateId: DRAFT, format });
    expect(io.put).toHaveBeenCalledOnce();
  });
  it("fails closed when the authorization database becomes unavailable", async () => {
    io.getDb.mockResolvedValueOnce(driver).mockResolvedValueOnce(driver).mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); expectNoPayload();
  });
  it("preserves bytes, content type, return shape and the existing success audit", async () => {
    const before = structuredClone(rows.estimate_drafts[0]);
    const result = await invoke();
    expect(result).toMatchObject({ url: "https://storage.example.invalid/synthetic-file", format, estimateId: DRAFT });
    expect(result.fileKey).toMatch(new RegExp(`^exports/estimates/EST-${DRAFT}-\\d+\\.${format}$`));
    expect(generator()).toHaveBeenCalledOnce();
    expect(generator()).toHaveBeenCalledWith(expect.objectContaining(before), USER);
    const [fileKey, buffer, contentType] = io.put.mock.calls[0];
    expect(fileKey).toBe(result.fileKey); expect(contentType).toBe(`application/${format}`); expect(Buffer.isBuffer(buffer)).toBe(true);
    if (format === "pdf") {
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-"); expect(Object.keys(result).sort()).toEqual(["estimateId", "fileKey", "format", "url"]);
    } else {
      expect(JSON.parse(buffer.toString("utf8"))).toEqual(Reflect.get(result, "data"));
      expect(Reflect.get(result, "data")).toMatchObject({ draft: { id: DRAFT, status: "approved" }, financials: { finalTotalPrice: "1200.00" }, exportMetadata: { exportedBy: USER, format: "json" } });
    }
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ action: `estimate.export_${format}`, before: null, after: expect.objectContaining({ format, fileKey, url: result.url }) }));
    expect(rows.estimate_drafts[0]).toEqual(before);
  });
  it("propagates a storage failure without reporting successful export", async () => {
    io.put.mockRejectedValueOnce(new Error("Synthetic storage failure"));
    await expect(invoke()).rejects.toThrow("Synthetic storage failure"); expect(io.audit).not.toHaveBeenCalled();
  });
});

describe.each(["exportPrintable", "validateCsvExport", "profitShield"] as const)("H1 %s direct route", operation => {
  it.each(["source", "link"])("rejects capture-only origin detected by %s before legacy formatting", async kind => {
    if (kind === "source") rows.estimate_drafts[0].source = "historical_import";
    else rows.historical_estimate_imports = [{ id: NEXT, estimateDraftId: DRAFT }];
    rows.estimate_drafts[0].subtotalCost = null;
    await expect(estimateRouter.createCaller(context())[operation]({ id: DRAFT })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/historical/i) });
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
    await expect(result).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/historical/i) });
  });
});
