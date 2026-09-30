/**
 * Field launch tenant isolation — route boundary. Proves monitoringMetrics,
 * estimateStatusDistribution and recentActivity reject an unresolved caller tenant
 * BEFORE touching any data (tenantProcedure's middleware, not the handler), and that
 * a resolved tenant reaches the real helper with ctx.tenantId — never from client input.
 * Data-shape isolation (two tenants, distinct counts) is covered at the helper level in
 * field-launch-monitoring-historical.test.ts; this file is route-boundary only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_UNRESOLVED_ERR_MSG } from "./_core/trpc";

const io = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));

const { fieldLaunchRouter } = await import("./field-launch-router");

const USER = "73000000-0000-4000-8000-000000000001";
const TENANT = "73000000-0000-4000-8000-000000000002";

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
  io.getDb.mockResolvedValue(null); // "no db" short-circuit is enough to prove the route boundary
});

describe.each([
  ["monitoringMetrics", (c: ReturnType<typeof fieldLaunchRouter.createCaller>) => c.monitoringMetrics()],
  ["estimateStatusDistribution", (c: ReturnType<typeof fieldLaunchRouter.createCaller>) => c.estimateStatusDistribution()],
  ["recentActivity", (c: ReturnType<typeof fieldLaunchRouter.createCaller>) => c.recentActivity()],
] as const)("%s tenant boundary", (_name, invoke) => {
  it("refuses an unresolved caller tenant before any query runs", async () => {
    await expect(invoke(fieldLaunchRouter.createCaller(ctxFor(null)))).rejects.toThrow(TENANT_UNRESOLVED_ERR_MSG);
    expect(io.getDb).not.toHaveBeenCalled();
  });
  it("reaches the real helper once a tenant is resolved from verified context", async () => {
    await invoke(fieldLaunchRouter.createCaller(ctxFor(TENANT)));
    expect(io.getDb).toHaveBeenCalled();
  });
});
