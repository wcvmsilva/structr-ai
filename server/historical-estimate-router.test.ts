import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { router } from "./_core/trpc";

const io = vi.hoisted(() => ({ record: vi.fn(), select: vi.fn(), getSource: vi.fn(), getImport: vi.fn(), list: vi.fn(), access: vi.fn() }));
vi.mock("./project-access", () => ({ requireProjectAccessTrpc: io.access }));
vi.mock("./historical-estimate-db", () => ({
  recordHistoricalSource: io.record, importHistoricalEstimate: io.select,
  getHistoricalSource: io.getSource, getHistoricalImport: io.getImport, listHistoricalSources: io.list,
}));
import { historicalEstimateRouter, historicalImportProcedure } from "./historical-estimate-router";
const api = router({ historical: historicalEstimateRouter, estimate: router({ importHistorical: historicalImportProcedure }) });
const id = "10000000-0000-4000-8000-000000000001";
const tenant = "20000000-0000-4000-8000-000000000001";
const actor = "30000000-0000-4000-8000-000000000001";
const rawTotals = { version: "historical-raw-totals-v1" as const, subtotal: null, discount: null, tax: null, total: "123.45", estimatedCost: null };
const source = () => ({
  requestId: id, projectId: id, clientId: id, sourceKind: "manual_transcription" as const, sourceLabel: "Synthetic proposal",
  currencyCode: "USD" as const, sourceFileId: null, declaredSubtotal: null, declaredDiscount: null, declaredTax: null,
  declaredTotal: "123.45", declaredEstimatedCost: null, commercialTermsText: null, rawTotals,
  lines: [{ sourceLineKey: "line-1", ordinal: 0, description: "Synthetic cabinet", quantity: "1", unit: "EA", unitPrice: "123.45",
    unitEstimatedCost: null, linePrice: "123.45", lineEstimatedCost: null, externalCodeSystem: null, externalCode: null, taxable: null,
    rawValues: { version: "historical-raw-line-v1" as const, quantity: "1", unitPrice: "123.45", unitEstimatedCost: null, linePrice: "123.45", lineEstimatedCost: null, taxable: null, externalCode: null } }],
});
const selection = () => ({ requestId: id, sourceId: id, projectId: id, clientId: id, selectedLineIds: [id], declaredSelectedTotal: "123.45", declaredSelectedEstimatedCost: null,
  rawSelectedTotals: { version: "historical-raw-selected-v1" as const, total: "123.45", estimatedCost: null }, reportedApprovalAt: null, reportedApprovalNote: null, priorImportId: null, expectedRevision: null });
function caller(tenantId: string | null = tenant, loggedIn = true) {
  return api.createCaller({ tenantId, user: loggedIn ? { id: actor, role: "user" } : null } as TrpcContext);
}
beforeEach(() => { vi.resetAllMocks(); io.access.mockResolvedValue(undefined); io.record.mockResolvedValue({ sourceId: id }); io.select.mockResolvedValue({ importId: id, canApprove: false, canExport: false, canExecute: false }); });

const projectRoutes = [
  { name: "recordSource", permission: "write", invoke: () => caller().historical.recordSource(source()), helper: io.record, input: source },
  { name: "importHistorical", permission: "write", invoke: () => caller().estimate.importHistorical(selection()), helper: io.select, input: selection },
  { name: "listSources", permission: "read", invoke: () => caller().historical.listSources({ projectId: id, limit: 25 }), helper: io.list, input: () => ({ projectId: id, limit: 25 }) },
] as const;

describe("historical estimate boundary", () => {
  it.each(projectRoutes)("denies $name before its database helper when project access fails", async route => {
    io.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "Project access denied" }));
    await expect(route.invoke()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Project access denied" });
    expect(io.access).toHaveBeenCalledWith(id, actor, route.permission);
    expect(route.helper).not.toHaveBeenCalled();
  });
  it.each(projectRoutes)("awaits the trusted project guard before $name reaches its database helper", async route => {
    const order: string[] = [];
    let releaseAccess!: () => void;
    let notifyAccess!: () => void;
    const accessEntered = new Promise<void>(resolve => { notifyAccess = resolve; });
    const accessGranted = new Promise<void>(resolve => { releaseAccess = resolve; });
    io.access.mockImplementation(async () => {
      order.push("guard entered");
      notifyAccess();
      await accessGranted;
      order.push("guard granted");
    });
    route.helper.mockImplementation(async () => { order.push("database helper"); return {}; });
    const pending = route.invoke();
    // A missing guard still settles the route, so RED never depends on a timeout.
    await Promise.race([accessEntered, pending]);
    expect(io.access).toHaveBeenCalledWith(id, actor, route.permission);
    expect(route.helper).not.toHaveBeenCalled();
    releaseAccess();
    await pending;
    expect(order).toEqual(["guard entered", "guard granted", "database helper"]);
    expect(route.helper).toHaveBeenCalledWith(route.input(), actor, tenant);
  });
  it("requires a session before capture", async () => { await expect(caller(tenant, false).historical.recordSource(source())).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(io.record).not.toHaveBeenCalled(); });
  it("requires a resolved tenant before capture", async () => { await expect(caller(null).historical.recordSource(source())).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(io.record).not.toHaveBeenCalled(); });
  it("passes trusted actor and tenant with exact decimal strings", async () => { await caller().historical.recordSource(source()); expect(io.record).toHaveBeenCalledWith(source(), actor, tenant); });
  it("rejects caller-supplied tenant authority", async () => { await expect(caller().historical.recordSource({ ...source(), tenantId: id } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(io.record).not.toHaveBeenCalled(); });
  it.each(["NaN", "1e3", "1,000.00", "-1", "1.001"])("rejects invalid USD total %s", async declaredTotal => { await expect(caller().historical.recordSource({ ...source(), declaredTotal })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(io.record).not.toHaveBeenCalled(); });
  it("rejects malformed nested raw values rather than accepting free metadata", async () => { const input = source(); (input.lines[0].rawValues as any).approved = true; await expect(caller().historical.recordSource(input)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(io.record).not.toHaveBeenCalled(); });
  it("rejects a normalized subtotal outside numeric capacity", async () => { await expect(caller().historical.recordSource({ ...source(), declaredSubtotal: "1234567890123456789.00" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("preserves explicitly unknown currency and raw text", async () => { const input = { ...source(), currencyCode: null }; await caller().historical.recordSource(input); expect(io.record.mock.calls[0][0].currencyCode).toBeNull(); expect(io.record.mock.calls[0][0].rawTotals.total).toBe("123.45"); });
  it("rejects empty source lines", async () => { await expect(caller().historical.recordSource({ ...source(), lines: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("rejects duplicate source line keys", async () => { const input = source(); input.lines.push({ ...input.lines[0], ordinal: 1 }); await expect(caller().historical.recordSource(input)).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("imports a selection with trusted actor without granting authority", async () => { await expect(caller().estimate.importHistorical(selection())).resolves.toMatchObject({ canApprove: false, canExport: false, canExecute: false }); expect(io.select).toHaveBeenCalledWith(selection(), actor, tenant); });
  it("rejects duplicated selection IDs", async () => { await expect(caller().estimate.importHistorical({ ...selection(), selectedLineIds: [id, id] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(io.select).not.toHaveBeenCalled(); });
  it("requires predecessor and expected revision together", async () => { await expect(caller().estimate.importHistorical({ ...selection(), priorImportId: id })).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("rejects extra authority fields on imports", async () => { await expect(caller().estimate.importHistorical({ ...selection(), status: "approved" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("rejects invalid reported dates", async () => { await expect(caller().estimate.importHistorical({ ...selection(), reportedApprovalAt: "yesterday" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("routes source reads with actor and tenant for project authorization", async () => { await caller().historical.getSource({ sourceId: id }); expect(io.getSource).toHaveBeenCalledWith(id, actor, tenant); });
  it("routes import reads with actor and tenant for project authorization", async () => { await caller().historical.getImport({ importId: id }); expect(io.getImport).toHaveBeenCalledWith(id, actor, tenant); });
  it("requires a session for reads", async () => { await expect(caller(tenant, false).historical.getSource({ sourceId: id })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(io.getSource).not.toHaveBeenCalled(); });
  it("requires tenant for reads", async () => { await expect(caller(null).historical.getImport({ importId: id })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(io.getImport).not.toHaveBeenCalled(); });
  it("bounds project pagination and passes trusted context", async () => { await caller().historical.listSources({ projectId: id, limit: 25 }); expect(io.list).toHaveBeenCalledWith({ projectId: id, limit: 25 }, actor, tenant); await expect(caller().historical.listSources({ projectId: id, limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("hides unexpected database details", async () => { io.record.mockRejectedValue(new Error("password=secret synthetic db error")); await expect(caller().historical.recordSource(source())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Historical estimate operation failed." }); });
});
