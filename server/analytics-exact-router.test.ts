import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
const io = vi.hoisted(() => ({ pipeline: vi.fn(), forecast: vi.fn(), dashboard: vi.fn(), stats: vi.fn(), save: vi.fn(), get: vi.fn(), list: vi.fn(), profit: vi.fn() }));
vi.mock("./analytics-db", async original => ({
  ...await original<typeof import("./analytics-db")>(), getPipeline: io.pipeline, getRevenueForecast: io.forecast,
  getDashboard: io.dashboard, saveSnapshot: io.save, getSnapshot: io.get, listSnapshots: io.list, getProfitHealth: io.profit,
}));
vi.mock("./estimate-db", async original => ({ ...await original<typeof import("./estimate-db")>(), getEstimateDraftStats: io.stats }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
import { analyticsRouter } from "./analytics-router";
import { estimateRouter } from "./estimate-router";

function context(role: "user" | "admin" = "user", tenant: string | null = "tenant-a", authenticated = true): TrpcContext {
  const now = new Date("2026-09-20T12:00:00Z");
  return { req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId: tenant,
    user: authenticated ? { id: "actor-a", tenantId: tenant, role, isActive: true, externalOpenId: null,
      email: "operator@example.invalid", fullName: "Synthetic", companyName: null, loginMethod: "legacy", lastSignedIn: now, createdAt: now, updatedAt: now } : null };
}
beforeEach(() => { vi.clearAllMocks(); for (const fn of Object.values(io)) fn.mockReset(); });

const queries = ["pipeline", "forecast", "dashboard", "stats"] as const;
function call(name: typeof queries[number], ctx: TrpcContext) {
  if (name === "stats") return estimateRouter.createCaller(ctx).stats();
  const c = analyticsRouter.createCaller(ctx);
  if (name === "pipeline") return c.getPipeline();
  if (name === "forecast") return c.getForecast();
  return c.getDashboard();
}
describe.each(queries)("existing %s boundary", name => {
  it("rejects anonymous requests before reading", async () => {
    await expect(call(name, context("user", "tenant-a", false))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(io[name]).not.toHaveBeenCalled();
  });
  it("rejects a missing tenant before reading", async () => {
    await expect(call(name, context("user", null))).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(io[name]).not.toHaveBeenCalled();
  });
  it("uses the session tenant and returns exact/discriminated data unchanged", async () => {
    const response = name === "forecast" ? { state: "unavailable", reason: "EXECUTION_AUTHORITY_NOT_AVAILABLE" }
      : { state: "available", data: { version: "synthetic-transport", amount: "1999999999999999999.98" } };
    io[name].mockResolvedValue(response); expect(await call(name, context())).toBe(response);
    if (name === "stats") expect(io.stats).toHaveBeenCalledWith("tenant-a");
    else expect(io[name]).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }));
  });
  it("sanitizes unexpected driver errors without inventing empty data", async () => {
    io[name].mockRejectedValue(new Error("private SQL driver DSN and data"));
    await expect(call(name, context())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Analytics are temporarily unavailable." });
  });
  it.each(["INTERNAL_SERVER_ERROR", "TIMEOUT"] as const)("sanitizes a technical %s already wrapped as tRPC", async code => {
    io[name].mockRejectedValue(new TRPCError({ code, message: "private wrapped driver diagnostics" }));
    await expect(call(name, context())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Analytics are temporarily unavailable." });
  });
  it("preserves ordinary access errors as access errors", async () => {
    io[name].mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "Access denied." }));
    await expect(call(name, context())).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access denied." });
  });
});
describe("snapshot route hold", () => {
  it.each(["pipeline", "revenue_forecast"] as const)("holds %s before calculating or saving for admins", async snapshotType => {
    await expect(analyticsRouter.createCaller(context("admin")).saveSnapshot({ snapshotType })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "New pipeline and forecast snapshots are temporarily unavailable." });
    expect(io.pipeline).not.toHaveBeenCalled(); expect(io.forecast).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
  });
  it("retains the admin requirement", async () => {
    await expect(analyticsRouter.createCaller(context()).saveSnapshot({ snapshotType: "pipeline" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(io.save).not.toHaveBeenCalled();
  });
  it("does not reveal a held operation before tenant resolution", async () => {
    await expect(analyticsRouter.createCaller(context("admin", null)).saveSnapshot({ snapshotType: "pipeline" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(io.save).not.toHaveBeenCalled();
  });
  it("rejects invalid snapshot types instead of falling through", async () => {
    await expect(analyticsRouter.createCaller(context("admin")).saveSnapshot({ snapshotType: "unrecognized" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(io.save).not.toHaveBeenCalled();
  });
  it("preserves independent snapshot branches without certifying them", async () => {
    const payload = { legacy: "independent profit data" }; const saved = { id: "saved" };
    io.profit.mockResolvedValue(payload); io.save.mockResolvedValue(saved);
    expect(await analyticsRouter.createCaller(context("admin")).saveSnapshot({ snapshotType: "profit_health" })).toBe(saved);
    expect(io.save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a", actorId: "actor-a", payload }));
  });
  it("leaves historical payload read unchanged", async () => {
    const row = { id: "historical", payload: { oldNumericValue: 45.2 } }; io.get.mockResolvedValue(row);
    expect(await analyticsRouter.createCaller(context()).getSnapshot({ snapshotKey: "pipeline:month:old" })).toBe(row);
    expect(io.get).toHaveBeenCalledWith({ tenantId: "tenant-a", snapshotKey: "pipeline:month:old" });
  });
});
