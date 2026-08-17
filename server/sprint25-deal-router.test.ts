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

const ctx = {
  db: {} as any,
  user: { id: "a0000000-0000-4000-8000-000000000001", role: "admin", name: "Test User" } as any,
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
      expect(dealDb.createDeal).toHaveBeenCalledWith(expect.objectContaining({ name: "New Kitchen" }));
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
      expect(dealDb.updateDealStage).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001", "negotiation", "a0000000-0000-4000-8000-000000000001", "Negotiating docs");
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
      expect(dealDb.getDealById).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001");
      expect(engine.suggestNextAction).toHaveBeenCalled();
      expect(res.action).toBe("Test");
    });

    it("12. Throws if deal not found", async () => {
      vi.mocked(dealDb.getDealById).mockResolvedValue(null);
      await expect(caller.suggestNextAction("a0000000-0000-4000-8000-000000000001")).rejects.toThrow("NOT_FOUND");
    });
  });
});
