import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─────────────────────────────────────────────────────────────────────────────
// 1. MOCKS
// ─────────────────────────────────────────────────────────────────────────────

// Mock DB helpers so we only test the router's validation and mapping behavior
vi.mock("./lead-db", () => ({
  createLead: vi.fn(),
  getLeadById: vi.fn(),
  listLeads: vi.fn(),
  updateLead: vi.fn(),
  updateLeadStatus: vi.fn(),
  disqualifyLead: vi.fn(),
  convertLeadToProject: vi.fn(),
  searchLeads: vi.fn(),
  addLeadActivity: vi.fn(),
  getLeadActivities: vi.fn(), // fixed name
  getLeadStats: vi.fn(),
}));

// Mock pipeline-db for orchestrated lead conversion
vi.mock("./pipeline-db", () => ({
  orchestrateLeadConversion: vi.fn(),
}));

// Mock Engine for duplication
vi.mock("../shared/lead-engine", () => ({
  detectDuplicateLead: vi.fn(),
  classifyPriority: vi.fn(),
  scoreLead: vi.fn(),
  validateLeadForConversion: vi.fn(),
}));

import { leadRouter } from "./lead-router";
import * as leadDb from "./lead-db";
import * as pipelineDb from "./pipeline-db";
import * as engine from "../shared/lead-engine";

// Create a caller mimicking an authenticated tRPC context
const ctx = {
  db: {} as any,
  user: { id: 1, role: "admin", name: "Test User", openId: "test" } as any,
  req: {} as any,
  res: {} as any,
};
const caller = leadRouter.createCaller(ctx);

// ─────────────────────────────────────────────────────────────────────────────
// 2. TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 24: Lead Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks(); // ensures mockResolvedValue doesn't leak between tests
  });

  describe("Router Structure", () => {
    it("1. Verify all endpoints are protected (user must be present)", async () => {
      const publicCaller = leadRouter.createCaller({ ...ctx, user: undefined } as any);
      // We expect any procedure call to throw our custom auth error
      await expect(publicCaller.list()).rejects.toThrow("Please login");
      await expect(publicCaller.getActivities({ leadId: 1 })).rejects.toThrow("Please login");
    });
  });

  describe("lead.create", () => {
    it("2. test with valid input → returns lead", async () => {
      vi.mocked(engine.detectDuplicateLead).mockReturnValue({ isDuplicate: false } as any);
      vi.mocked(engine.scoreLead).mockReturnValue({ score: 50, factors: [] });
      vi.mocked(engine.classifyPriority).mockReturnValue("warm");
      vi.mocked(leadDb.createLead).mockResolvedValue({ id: 99, firstName: "John" } as any);
      
      const res = await caller.create({
        firstName: "John",
        lastName: "Doe",
        email: "john@test.com",
        source: "website",
        channel: "direct",
      });
      expect(res.id).toBe(99);
      expect(leadDb.createLead).toHaveBeenCalled();
    });

    it("3. test with missing required fields → throws", async () => {
      await expect(caller.create({ lastName: "Doe" } as any)).rejects.toThrow();
    });

    it("4. rejects invalid email formats", async () => {
      await expect(caller.create({ firstName: "John", email: "invalid" } as any)).rejects.toThrow();
    });

    it("5. test duplicate detection (same email)", async () => {
      vi.mocked(engine.detectDuplicateLead).mockReturnValue({
        isDuplicate: true,
        matchedLeadId: 2,
      } as any);
      // The router should throw CONFLICT and skip creating the lead
      await expect(caller.create({ 
        firstName: "Dup", email: "dup@test.com", source: "website", channel: "direct" 
      } as any)).rejects.toThrow();
      
      expect(leadDb.createLead).not.toHaveBeenCalled();
    });
  });

  describe("lead.get", () => {
    it("6. test existing lead → returns data", async () => {
      vi.mocked(leadDb.getLeadById).mockResolvedValue({ id: 1 } as any);
      const res = await caller.get({ id: 1 });
      expect(res.id).toBe(1);
    });

    it("7. test non-existent ID → throws NOT_FOUND", async () => {
      vi.mocked(leadDb.getLeadById).mockResolvedValue(undefined as any);
      await expect(caller.get({ id: 999 })).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("lead.list", () => {
    it("8. lists leads without filters", async () => {
      vi.mocked(leadDb.listLeads).mockResolvedValue([]);
      await caller.list();
      expect(leadDb.listLeads).toHaveBeenCalledWith(undefined);
    });

    it("9. test with status filter", async () => {
      vi.mocked(leadDb.listLeads).mockResolvedValue([]);
      await caller.list({ status: "new" });
      expect(leadDb.listLeads).toHaveBeenCalledWith({ status: "new" });
    });

    it("10. test with priority filter", async () => {
      vi.mocked(leadDb.listLeads).mockResolvedValue([]);
      await caller.list({ priority: "hot" });
      expect(leadDb.listLeads).toHaveBeenCalledWith({ priority: "hot" });
    });

    it("11. test with assignedTo filter", async () => {
      vi.mocked(leadDb.listLeads).mockResolvedValue([]);
      await caller.list({ assignedTo: 1 });
      expect(leadDb.listLeads).toHaveBeenCalledWith({ assignedTo: 1 });
    });
  });

  describe("lead.updateStatus", () => {
    it("12. throws if lead not found (simulating DB throw)", async () => {
      vi.mocked(leadDb.updateLeadStatus).mockRejectedValue(new Error("Lead not found"));
      await expect(caller.updateStatus({ id: 1, status: "contacted" })).rejects.toThrow("Lead not found");
    });

    it("13. test valid transition", async () => {
      vi.mocked(leadDb.updateLeadStatus).mockResolvedValue({ id: 1, status: "contacted" } as any);
      const res = await caller.updateStatus({ id: 1, status: "contacted" });
      expect(res).toBeDefined();
      expect(leadDb.updateLeadStatus).toHaveBeenCalled();
    });

    it("14. test invalid transition → throws (converted->new)", async () => {
      // Setup the mock to reject, verifying router propagates it
      vi.mocked(leadDb.updateLeadStatus).mockRejectedValue(new Error("Cannot change status of converted lead"));
      await expect(caller.updateStatus({ id: 1, status: "new" })).rejects.toThrow();
    });

    it("15. does not throw if status is identical (router calls helper)", async () => {
      vi.mocked(leadDb.updateLeadStatus).mockResolvedValue({ id: 1, status: "new" } as any);
      await caller.updateStatus({ id: 1, status: "new" });
      expect(leadDb.updateLeadStatus).toHaveBeenCalled();
    });
  });

  describe("lead.convert", () => {
    it("16. throws NOT_FOUND if lead doesn't exist (DB helper throw propagation)", async () => {
      vi.mocked(pipelineDb.orchestrateLeadConversion).mockRejectedValue(new Error("NOT_FOUND"));
      await expect(caller.convertToProject({ id: 1 })).rejects.toThrow("NOT_FOUND");
    });

    it("17. test qualified lead → creates project and deal", async () => {
      vi.mocked(pipelineDb.orchestrateLeadConversion).mockResolvedValue({ 
        clientId: 1, 
        projectId: 2, 
        dealId: 3 
      } as any);
      const result = await caller.convertToProject({ id: 1 });
      expect(pipelineDb.orchestrateLeadConversion).toHaveBeenCalled();
      expect(result).toHaveProperty("dealId");
      expect(result).toHaveProperty("clientId");
      expect(result).toHaveProperty("projectId");
    });

    it("18. test non-qualified lead → throws (validation failure)", async () => {
      vi.mocked(pipelineDb.orchestrateLeadConversion).mockRejectedValue(new Error("Validation failed"));
      await expect(caller.convertToProject({ id: 1 })).rejects.toThrow("Validation failed");
    });
  });

  describe("lead.addActivity", () => {
    it("19. test creates activity with correct leadId", async () => {
      vi.mocked(leadDb.addLeadActivity).mockResolvedValue({ id: 10 } as any);

      await caller.addActivity({
        leadId: 2,
        activityType: "note",
        description: "Test note",
        metadata: { foo: "bar" },
      });
      const callArgs = vi.mocked(leadDb.addLeadActivity).mock.calls[0][0];
      expect(callArgs.leadId).toBe(2);
      expect(callArgs.performedBy).toBe(ctx.user.id);
    });

    it("20. throws if lead does not exist (DB propagation)", async () => {
      vi.mocked(leadDb.addLeadActivity).mockRejectedValue(new Error("NOT_FOUND"));
      await expect(caller.addActivity({ leadId: 99, activityType: "note", description: "Foo" } as any)).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("lead.getActivities", () => {
    it("21. lists activities for a specific lead", async () => {
      vi.mocked(leadDb.getLeadActivities).mockResolvedValue([{ id: 1 }] as any);
      const res = await caller.getActivities({ leadId: 5 });
      expect(res.length).toBe(1);
      expect(leadDb.getLeadActivities).toHaveBeenCalledWith(5);
    });
  });

  describe("lead.update", () => {
    it("22. updates arbitrary fields on the lead", async () => {
      vi.mocked(leadDb.updateLead).mockResolvedValue({ id: 1, firstName: "Alice" } as any);
      await caller.update({ id: 1, data: { firstName: "Alice" } });
      expect(leadDb.updateLead).toHaveBeenCalled();
    });
    
    it("23. throws if lead does not exist (propagated)", async () => {
      vi.mocked(leadDb.updateLead).mockRejectedValue(new Error("Lead not found"));
      await expect(caller.update({ id: 99, data: {} })).rejects.toThrow("Lead not found");
    });

    it("24. delegates to searchLeads db helper when via router.search", async () => {
      vi.mocked(leadDb.searchLeads).mockResolvedValue([]);
      await caller.search({ query: "Test" });
      expect(leadDb.searchLeads).toHaveBeenCalledWith("Test");
    });

    it("25. successfully routes to search action with empty string", async () => {
      vi.mocked(leadDb.searchLeads).mockResolvedValue([]);
      await caller.search({ query: "" });
      expect(leadDb.searchLeads).toHaveBeenCalledWith("");
    });
  });
});
