import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({
  checklist: vi.fn(), score: vi.fn(), get: vi.fn(), summary: vi.fn(), list: vi.fn(),
  refresh: vi.fn(), acknowledge: vi.fn(), access: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./audit-trail", () => ({ recordAuditAsync: vi.fn() }));
vi.mock("./field-operations-db", () => ({ getProjectBudgetEstimate: vi.fn() }));
vi.mock("./actuals-db", () => ({ getProjectBudgetLines: vi.fn() }));
vi.mock("./closeout-db", () => ({ getCloseoutByProject: vi.fn() }));
vi.mock("./project-access", () => ({ requireProjectAccessTrpc: io.access }));
vi.mock("./scope-completeness-db", async importOriginal => ({
  ...await importOriginal<typeof import("./scope-completeness-db")>(),
  getScopeChecklist: io.checklist,
  computeProjectScopeCompleteness: io.score,
  getScopeCompleteness: io.get,
  getScopeCompletenessSummary: io.summary,
  listScopeCompleteness: io.list,
  refreshScopePatterns: io.refresh,
  acknowledgePattern: io.acknowledge,
}));

import { scopeCompletenessRouter } from "./scope-completeness-router";
import { ScopeCompletenessError } from "./scope-completeness-db";

const TENANT_A = "a2000000-0000-4000-8000-000000000001";
const TENANT_B = "a2000000-0000-4000-8000-000000000002";
function caller(tenantId: string | null | undefined = TENANT_A, authenticated = true) {
  return scopeCompletenessRouter.createCaller({
    tenantId,
    user: authenticated ? { id: "b2000000-0000-4000-8000-000000000001", role: "user" } : null,
  } as TrpcContext);
}

beforeEach(() => {
  vi.resetAllMocks();
  io.checklist.mockImplementation(async ({ projectType }) => ({ projectType, items: [], summary: "No recorded history." }));
});

describe("scopeCompleteness.getChecklist boundary", () => {
  it("rejects anonymous callers before reading history", async () => {
    await expect(caller(TENANT_A, false).getChecklist({ projectType: "remodel" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(io.checklist).not.toHaveBeenCalled();
  });

  it("rejects authenticated callers with no tenant before reading history", async () => {
    await expect(caller(null).getChecklist({ projectType: "remodel" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.checklist).not.toHaveBeenCalled();
  });

  it("uses the session tenant and discards a tenant supplied by the client", async () => {
    await caller().getChecklist({ projectType: "remodel", tenantId: TENANT_B } as { projectType: string });
    expect(io.checklist).toHaveBeenCalledTimes(1);
    expect(io.checklist).toHaveBeenCalledWith({ tenantId: TENANT_A, projectType: "remodel" });
  });

  it.each(["", " \t\n ", "x".repeat(101), null, undefined, 42])(
    "rejects invalid input %j before invoking the helper", async projectType => {
      await expect(caller().getChecklist({ projectType: projectType as string })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(io.checklist).not.toHaveBeenCalled();
    },
  );

  it("trims before checking the 100-character limit", async () => {
    const projectType = "x".repeat(100);
    await expect(caller().getChecklist({ projectType: ` ${projectType} ` })).resolves.toMatchObject({ projectType });
    expect(io.checklist).toHaveBeenCalledTimes(1);
    expect(io.checklist).toHaveBeenCalledWith({ tenantId: TENANT_A, projectType });
  });

  it.each(["BATHROOM_REMODEL", "Renovation", "remodel"])("accepts and trims historical type %s without alias remapping", async projectType => {
    await caller().getChecklist({ projectType: `  ${projectType}  ` });
    expect(io.checklist).toHaveBeenCalledTimes(1);
    expect(io.checklist).toHaveBeenCalledWith({ tenantId: TENANT_A, projectType });
  });

  it("maps unavailable history to INTERNAL_SERVER_ERROR", async () => {
    const failure = new ScopeCompletenessError("DB_UNAVAILABLE", "Database not available.");
    io.checklist.mockRejectedValue(failure);
    await expect(caller().getChecklist({ projectType: "remodel" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Database not available.", cause: failure });
  });

  it("uses the existing domain-error mapping for a denied tenant", async () => {
    io.checklist.mockRejectedValue(new ScopeCompletenessError("TENANT_MISMATCH", "Scope pattern belongs to another tenant."));
    await expect(caller().getChecklist({ projectType: "remodel" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not turn unexpected query failures into successful empty history", async () => {
    io.checklist.mockRejectedValue(new Error("Synthetic query failure"));
    await expect(caller().getChecklist({ projectType: "remodel" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("preserves the successful payload and never computes, refreshes or acknowledges patterns", async () => {
    const result = { projectType: "bathroom_remodel", items: [{ id: "pattern", acknowledgedBy: "previous-reviewer", acknowledgedAt: new Date("2026-09-18T12:00:00Z") }], summary: "Historical summary." };
    io.checklist.mockResolvedValue(result);
    await expect(caller().getChecklist({ projectType: "bathroom_remodel" })).resolves.toEqual(result);
    for (const operation of [io.score, io.get, io.summary, io.list, io.refresh, io.acknowledge, io.access]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });
});
