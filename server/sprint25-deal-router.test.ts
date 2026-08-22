import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─────────────────────────────────────────────────────────────────────────────
// 1. MOCKS
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./deal-db", () => ({
  createDeal: vi.fn(),
  getDealById: vi.fn(),
  listDeals: vi.fn(),
  updateDeal: vi.fn(),
  updateDealStage: vi.fn(),
  markWon: vi.fn(),
  markLost: vi.fn(),
  linkEstimate: vi.fn(),
  addDealActivity: vi.fn(),
  getDealActivities: vi.fn(),
  getDealStats: vi.fn(),
  getStaleDeals: vi.fn(),
  getPipelineForecast: vi.fn(),
}));

vi.mock("../shared/deal-engine", () => ({
  validateStageTransition: vi.fn(),
  suggestNextAction: vi.fn(),
}));

// PHASE 1: the router now enforces project access. Authorization itself is covered
// by phase1-project-access.test.ts; here we stub it to keep this suite focused on
// deal-pipeline behaviour.
vi.mock("./project-access", () => ({
  requireProjectAccessTrpc: vi.fn().mockResolvedValue({
    projectId: "a0000000-0000-4000-8000-000000000010",
    tenantId: null,
    via: "admin",
    projectRole: "owner",
    permissions: ["read", "write", "approve", "delete"],
  }),
  requireEntityAccess: vi.fn().mockResolvedValue({
    projectId: "a0000000-0000-4000-8000-000000000010",
    tenantId: null,
    via: "admin",
    projectRole: "owner",
    permissions: ["read", "write", "approve", "delete"],
  }),
}));

import { dealRouter } from "./deal-router";
import * as dealDb from "./deal-db";
import * as engine from "../shared/deal-engine";

// B2: a deal procedure is a tenant-scoped business route, so the fixture context must
// carry a resolved tenant — an unresolved one is now refused at the boundary.
const FIXTURE_TENANT = "tenant-fixture";
const ctx = {
  db: {} as any,
  user: { id: "a0000000-0000-4000-8000-000000000001", role: "admin", name: "Test User" } as any,
  tenantId: FIXTURE_TENANT,
  req: {} as any,
  res: {} as any,
};
const caller = dealRouter.createCaller(ctx);
const publicCaller = dealRouter.createCaller({ ...ctx, user: undefined } as any);

// ─────────────────────────────────────────────────────────────────────────────
// 2. TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 25: Deal Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Security Context", () => {
    it("1. Rejects public access to routes", async () => {
      await expect(publicCaller.getById("a0000000-0000-4000-8000-000000000001")).rejects.toThrow("Please login");
    });
  });

  describe("deal.create", () => {
    it("2. Validates incoming Zod schema (rejects missing title)", async () => {
      await expect(caller.create({ stage: "discovery" } as any)).rejects.toThrow(/title/i);
    });

    it("3. Creates deal on valid input", async () => {
      vi.mocked(dealDb.createDeal).mockResolvedValue({ id: "a0000000-0000-4000-8000-000000000001" } as any);
      const res = await caller.create({ title: "New Kitchen", stage: "discovery", leadId: "a0000000-0000-4000-8000-000000000005", value: 10000 });
      expect(dealDb.createDeal).toHaveBeenCalledWith(expect.objectContaining({ name: "New Kitchen" }), FIXTURE_TENANT);
      expect(res.id).toBe("a0000000-0000-4000-8000-000000000001");
    });
  });

  describe("deal.advanceStage", () => {
    it("4. Rejects invalid stage enums", async () => {
      await expect(caller.advanceStage({ id: "a0000000-0000-4000-8000-000000000001", newStage: "fake-stage" } as any)).rejects.toThrow(/invalid/i);
    });

    it("5. Verifies transition validity before mutating", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue({ stage: "negotiation" } as any);
      vi.mocked(engine.validateStageTransition).mockReturnValue(false);

      await expect(caller.advanceStage({ id: "a0000000-0000-4000-8000-000000000001", newStage: "discovery" } as any)).rejects.toThrow("Invalid stage transition");
    });

    it("6. Succeeds when valid", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue({ stage: "proposal_sent" } as any);
      vi.mocked(engine.validateStageTransition).mockReturnValue(true);
      vi.mocked(dealDb.updateDealStage).mockResolvedValue({ id: "a0000000-0000-4000-8000-000000000001", stage: "negotiation" } as any);

      const res = await caller.advanceStage({ id: "a0000000-0000-4000-8000-000000000001", newStage: "negotiation", notes: "Negotiating docs" });
      expect(dealDb.updateDealStage).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001", "negotiation", "a0000000-0000-4000-8000-000000000001", "Negotiating docs", FIXTURE_TENANT);
      expect(res.stage).toBe("negotiation");
    });
  });

  describe("deal.markWon", () => {
    it("7. Requires projectId", async () => {
      await expect(caller.markWon({ id: "a0000000-0000-4000-8000-000000000001" } as any)).rejects.toThrow(/projectId/i);
    });

    it("8. Marks deal won", async () => {
      vi.mocked(dealDb.updateDealStage).mockResolvedValue({ id: "a0000000-0000-4000-8000-000000000001", stage: "won" } as any);
      const res = await caller.markWon({ id: "a0000000-0000-4000-8000-000000000001", projectId: "a0000000-0000-4000-8000-000000000010", actualCloseDate: new Date() });
      expect(dealDb.updateDealStage).toHaveBeenCalled();
      expect(res.stage).toBe("won");
    });
  });

  describe("deal.markLost", () => {
    it("9. Requires lostReason", async () => {
      await expect(caller.markLost({ id: "a0000000-0000-4000-8000-000000000001" } as any)).rejects.toThrow(/lostReason/i);
    });

    it("10. Marks deal lost", async () => {
      vi.mocked(dealDb.updateDealStage).mockResolvedValue({ id: "a0000000-0000-4000-8000-000000000001", stage: "lost" } as any);
      const res = await caller.markLost({ id: "a0000000-0000-4000-8000-000000000001", lostReason: "Price" });
      expect(dealDb.updateDealStage).toHaveBeenCalled();
      expect(res.stage).toBe("lost");
    });
  });

  describe("deal.suggestNextAction", () => {
    it("11. Reads deal by ID and calls engine", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue({ stage: "discovery" } as any);
      vi.mocked(engine.suggestNextAction).mockReturnValue({ action: "Test", reason: "Test", urgency: "low" });
      const res = await caller.suggestNextAction("a0000000-0000-4000-8000-000000000001");
      expect(dealDb.getDealById).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001", FIXTURE_TENANT);
      expect(engine.suggestNextAction).toHaveBeenCalled();
      expect(res.action).toBe("Test");
    });

    it("12. Throws if deal not found", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue(null);
      await expect(caller.suggestNextAction("a0000000-0000-4000-8000-000000000001")).rejects.toThrow("NOT_FOUND");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Tenant isolation: a deal id alone must not grant access. Every read/write
  // carries the caller's tenant, and a deal owned by another tenant is a 404.
  // ───────────────────────────────────────────────────────────────────────────
  describe("tenant isolation", () => {
    const DEAL_ID = "a0000000-0000-4000-8000-000000000001";
    const tenantCaller = dealRouter.createCaller({ ...ctx, tenantId: "tenant-a" } as any);

    it("13. getById → NOT_FOUND when the loaded deal belongs to another tenant", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue({ id: DEAL_ID, tenantId: "tenant-b" } as any);
      await expect(tenantCaller.getById(DEAL_ID)).rejects.toThrow("Deal not found");
    });

    it("14. getById → scopes the lookup to the caller tenant and returns its own deal", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue({ id: DEAL_ID, tenantId: "tenant-a" } as any);
      const res = await tenantCaller.getById(DEAL_ID);
      expect(res.id).toBe(DEAL_ID);
      expect(dealDb.getDealById).toHaveBeenCalledWith(DEAL_ID, "tenant-a");
    });

    it("15. advanceStage → NOT_FOUND when the deal belongs to another tenant", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue({ id: DEAL_ID, tenantId: "tenant-b", stage: "discovery" } as any);
      vi.mocked(engine.validateStageTransition).mockReturnValue(true);
      await expect(
        tenantCaller.advanceStage({ id: DEAL_ID, newStage: "estimating" } as any),
      ).rejects.toThrow("NOT_FOUND");
      expect(dealDb.updateDealStage).not.toHaveBeenCalled();
    });

    it("16. list / stats / staleDeals forward the caller tenant to the db helpers", async () => {
      vi.mocked(dealDb.listDeals).mockResolvedValue([] as any);
      vi.mocked(dealDb.getDealStats).mockResolvedValue({ total: 0 } as any);
      vi.mocked(dealDb.getStaleDeals).mockResolvedValue([] as any);

      await tenantCaller.list();
      await tenantCaller.stats();
      await tenantCaller.staleDeals();

      expect(dealDb.listDeals).toHaveBeenCalledWith({ tenantId: "tenant-a" });
      expect(dealDb.getDealStats).toHaveBeenCalledWith("tenant-a");
      expect(dealDb.getStaleDeals).toHaveBeenCalledWith("tenant-a");
    });

    it("17. update / markWon / markLost forward the caller tenant to the db helpers", async () => {
      vi.mocked(dealDb.updateDeal).mockResolvedValue({ id: DEAL_ID } as any);
      vi.mocked(dealDb.updateDealStage).mockResolvedValue({ id: DEAL_ID } as any);

      await tenantCaller.update({ id: DEAL_ID, data: { name: "Renamed" } });
      await tenantCaller.markWon({ id: DEAL_ID, projectId: "a0000000-0000-4000-8000-000000000010" });
      await tenantCaller.markLost({ id: DEAL_ID, lostReason: "Price" });

      expect(dealDb.updateDeal).toHaveBeenCalledWith(DEAL_ID, expect.anything(), ctx.user.id, "tenant-a");
      expect(dealDb.updateDealStage).toHaveBeenCalledWith(DEAL_ID, "won", ctx.user.id, expect.any(String), "tenant-a");
      expect(dealDb.updateDealStage).toHaveBeenCalledWith(DEAL_ID, "lost", ctx.user.id, "Price", "tenant-a");
    });

    it("18. activity read/write forward the caller tenant to the db helpers", async () => {
      vi.mocked(dealDb.getDealActivities).mockResolvedValue([] as any);
      vi.mocked(dealDb.addDealActivity).mockResolvedValue({ id: "1" } as any);

      await tenantCaller.getActivities(DEAL_ID);
      await tenantCaller.addActivity({ dealId: DEAL_ID, activityType: "note", description: "n" });

      expect(dealDb.getDealActivities).toHaveBeenCalledWith(DEAL_ID, "tenant-a");
      expect(dealDb.addDealActivity).toHaveBeenCalledWith(
        expect.objectContaining({ dealId: DEAL_ID }),
        "tenant-a",
      );
    });
  });
});
