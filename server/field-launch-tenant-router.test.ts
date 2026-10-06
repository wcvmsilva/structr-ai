/**
 * Field launch tenant isolation — route boundary. Proves monitoringMetrics,
 * estimateStatusDistribution and recentActivity reject an unresolved caller tenant
 * BEFORE touching any data (tenantProcedure's middleware, not the handler), that a
 * resolved tenant reaches the real helper with EXACTLY ctx.tenantId, and that a client
 * cannot override that tenant by smuggling a `tenantId` field into the input payload.
 * Data-shape isolation (two tenants, distinct counts, NULL-owner exclusion) is covered
 * at the helper level in field-launch-monitoring-historical.test.ts; this file is
 * route-boundary only, so it mocks the field-launch-db module directly rather than the
 * database, to assert on the exact arguments the router passes through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_UNRESOLVED_ERR_MSG } from "./_core/trpc";

const dbHelpers = vi.hoisted(() => ({
  getMonitoringMetrics: vi.fn().mockResolvedValue({}),
  getEstimateStatusDistribution: vi.fn().mockResolvedValue({}),
  getRecentAuditActivity: vi.fn().mockResolvedValue([]),
}));
vi.mock("./field-launch-db", async importOriginal => ({
  ...(await importOriginal<typeof import("./field-launch-db")>()),
  getMonitoringMetrics: dbHelpers.getMonitoringMetrics,
  getEstimateStatusDistribution: dbHelpers.getEstimateStatusDistribution,
  getRecentAuditActivity: dbHelpers.getRecentAuditActivity,
}));

const { fieldLaunchRouter } = await import("./field-launch-router");

const USER = "73000000-0000-4000-8000-000000000001";
const TENANT = "73000000-0000-4000-8000-000000000002";
const FORGED_TENANT = "73000000-0000-4000-8000-000000000fee";

function ctxFor(tenantId: string | null) {
  return {
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
    user: { id: USER, name: "Caller", role: "user", tenantId },
    tenantId,
    authProvider: "legacy",
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbHelpers.getMonitoringMetrics.mockResolvedValue({});
  dbHelpers.getEstimateStatusDistribution.mockResolvedValue({});
  dbHelpers.getRecentAuditActivity.mockResolvedValue([]);
});

describe.each([
  ["monitoringMetrics", (c: ReturnType<typeof fieldLaunchRouter.createCaller>, input?: unknown) => (c as any).monitoringMetrics(input), dbHelpers.getMonitoringMetrics] as const,
  ["estimateStatusDistribution", (c: ReturnType<typeof fieldLaunchRouter.createCaller>, input?: unknown) => (c as any).estimateStatusDistribution(input), dbHelpers.getEstimateStatusDistribution] as const,
  ["recentActivity", (c: ReturnType<typeof fieldLaunchRouter.createCaller>, input?: unknown) => (c as any).recentActivity(input), dbHelpers.getRecentAuditActivity] as const,
])("%s tenant boundary", (_name, invoke, helper) => {
  it("refuses an unresolved caller tenant before any query runs", async () => {
    await expect(invoke(fieldLaunchRouter.createCaller(ctxFor(null)))).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    expect(helper).not.toHaveBeenCalled();
  });

  it("passes exactly ctx.tenantId to the real helper, never a client-supplied value", async () => {
    await invoke(fieldLaunchRouter.createCaller(ctxFor(TENANT)));
    expect(helper).toHaveBeenCalledTimes(1);
    expect(helper.mock.calls[0][0]).toBe(TENANT);
  });

  it("ignores a forged tenantId smuggled into the input payload and still uses ctx.tenantId", async () => {
    await invoke(fieldLaunchRouter.createCaller(ctxFor(TENANT)), { tenantId: FORGED_TENANT, limit: 5 } as any);
    expect(helper).toHaveBeenCalledTimes(1);
    expect(helper.mock.calls[0][0]).toBe(TENANT);
    expect(helper.mock.calls[0]).not.toContain(FORGED_TENANT);
  });
});

describe("recentActivity limit forwarding", () => {
  it("forwards the caller's limit to the helper alongside the trusted tenant", async () => {
    await fieldLaunchRouter.createCaller(ctxFor(TENANT)).recentActivity({ limit: 7 });
    expect(dbHelpers.getRecentAuditActivity).toHaveBeenCalledWith(TENANT, 7);
  });
  it("defaults to 20 when no limit is given", async () => {
    await fieldLaunchRouter.createCaller(ctxFor(TENANT)).recentActivity();
    expect(dbHelpers.getRecentAuditActivity).toHaveBeenCalledWith(TENANT, 20);
  });
});
