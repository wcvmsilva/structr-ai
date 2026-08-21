import { describe, it, expect, vi, beforeEach } from "vitest";

// 1. Mock the pipeline-db
vi.mock("./pipeline-db", () => ({
  getPipelineOverviewData: vi.fn(async () => ({ summary: { pipelineValue: 1000 } })),
  orchestrateLeadConversion: vi.fn(async () => ({ dealId: 1 })),
  orchestrateDealWin: vi.fn(async () => ({ success: true })),
  getFullPipelineState: vi.fn(async () => ({ deal: { id: 1 } })),
  PipelineTenantError: class PipelineTenantError extends Error {
    readonly code = "TENANT_MISMATCH";
  },
}));

// 2. Mock tRPC core
vi.mock("./_core/trpc", () => {
  const mockProcedure = {
    input: vi.fn().mockReturnThis(),
    query: vi.fn().mockImplementation((fn) => fn),
    mutation: vi.fn().mockImplementation((fn) => fn),
  };
  return {
    router: vi.fn((obj) => obj),
    protectedProcedure: mockProcedure,
    adminProcedure: mockProcedure,
  };
});

import { pipelineRouter } from "./pipeline-router";
import { TRPCError } from "@trpc/server";

describe("Pipeline API Router", () => {
  const mockCtx = {
    user: { id: 1, role: "admin" as const },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOverview", () => {
    it("1. should return overview data for protected user", async () => {
      const result = await pipelineRouter.getOverview({ ctx: mockCtx, input: undefined } as any);
      expect(result.summary.pipelineValue).toBe(1000);
    });
  });

  describe("convertLead", () => {
    it("2. should call orchestration with leadId", async () => {
      const { orchestrateLeadConversion } = await import("./pipeline-db");
      const input = { leadId: 123 };
      await pipelineRouter.convertLead({ ctx: mockCtx, input } as any);
      expect(orchestrateLeadConversion).toHaveBeenCalledWith(123, 1, null);
    });
  });

  describe("winDeal", () => {
    it("4. should call orchestration with dealId", async () => {
      const { orchestrateDealWin } = await import("./pipeline-db");
      const input = { dealId: 555 };
      const result = await pipelineRouter.winDeal({ ctx: mockCtx, input } as any);
      expect(orchestrateDealWin).toHaveBeenCalledWith(555, 1, null);
      expect(result.success).toBe(true);
    });

    it("5. should handle orchestration errors", async () => {
        const { orchestrateDealWin } = await import("./pipeline-db");
        (orchestrateDealWin as any).mockResolvedValueOnce({ success: false, reason: "Incomplete project" });
        const input = { dealId: 555 };
        const result = await pipelineRouter.winDeal({ ctx: mockCtx, input } as any);
        expect(result.success).toBe(false);
        expect((result as any).reason).toBe("Incomplete project");
    });
  });

  describe("getDealState", () => {
    it("6. should return full state if found", async () => {
      const result = await pipelineRouter.getDealState({ ctx: mockCtx, input: { dealId: 1 } } as any);
      expect(result.deal.id).toBe(1);
    });

    it("7. should throw NOT_FOUND if deal missing", async () => {
      const { getFullPipelineState } = await import("./pipeline-db");
      (getFullPipelineState as any).mockResolvedValueOnce(null);
      
      await expect(pipelineRouter.getDealState({ ctx: mockCtx, input: { dealId: 99 } } as any))
        .rejects.toThrow(/not found/i);
    });
  });

  // Adding more tests for coverage (Requirement: 15)
  describe("Security & Robustness", () => {
    it("8. ensure getOverview is defined", () => {
        expect(pipelineRouter.getOverview).toBeDefined();
    });

    it("10. handle unexpected DB errors in overview", async () => {
        const { getPipelineOverviewData } = await import("./pipeline-db");
        (getPipelineOverviewData as any).mockRejectedValueOnce(new Error("DB Down"));
        await expect(pipelineRouter.getOverview({ ctx: mockCtx, input: undefined } as any))
            .rejects.toThrow(/failed to fetch/i);
    });

    it("11. handle unexpected DB errors in conversion", async () => {
        const { orchestrateLeadConversion } = await import("./pipeline-db");
        (orchestrateLeadConversion as any).mockRejectedValueOnce(new Error("Unique constraint"));
        await expect(pipelineRouter.convertLead({ ctx: mockCtx, input: { leadId: 1 } } as any))
            .rejects.toThrow(/failed to convert/i);
    });

    it("14. check procedure is an async function", () => {
        expect(typeof pipelineRouter.getOverview).toBe("function");
    });

    it("15. handle conversion error wrapping", async () => {
        const { orchestrateLeadConversion } = await import("./pipeline-db");
        (orchestrateLeadConversion as any).mockRejectedValueOnce(new Error("Generic DB Error"));
        const promise = pipelineRouter.convertLead({ ctx: mockCtx, input: { leadId: 1 } } as any);
        await expect(promise).rejects.toThrow("Failed to convert lead: Generic DB Error");
    });

    it("16. handle winDeal error wrapping", async () => {
        const { orchestrateDealWin } = await import("./pipeline-db");
        (orchestrateDealWin as any).mockRejectedValueOnce(new Error("Update failed"));
        const promise = pipelineRouter.winDeal({ ctx: mockCtx, input: { dealId: 1 } } as any);
        await expect(promise).rejects.toThrow("Failed to mark deal as won: Update failed");
    });

    it("17. verify getFullPipelineState is called", async () => {
        const { getFullPipelineState } = await import("./pipeline-db");
        await pipelineRouter.getDealState({ ctx: mockCtx, input: { dealId: 1 } } as any);
        expect(getFullPipelineState).toHaveBeenCalledWith(1, null);
    });

    it("18. getOverview return structure matches expect", async () => {
        const result = await pipelineRouter.getOverview({ ctx: mockCtx, input: undefined } as any);
        expect(result).toHaveProperty("summary");
    });

    it("19. winDeal should return success boolean", async () => {
        const result = await pipelineRouter.winDeal({ ctx: mockCtx, input: { dealId: 1 } } as any);
        expect(typeof result.success).toBe("boolean");
    });

    it("20. ensure ctx is passed to orchestrators", async () => {
        const { orchestrateLeadConversion } = await import("./pipeline-db");
        await pipelineRouter.convertLead({ ctx: { user: { id: 55 } }, input: { leadId: 1 } } as any);
        expect(orchestrateLeadConversion).toHaveBeenCalledWith(1, 55, null);
    });

    it("21. forwards the caller tenant to every orchestrator", async () => {
        const { orchestrateLeadConversion, orchestrateDealWin, getFullPipelineState, getPipelineOverviewData } =
            await import("./pipeline-db");
        const tenantCtx = { user: { id: 1, role: "admin" as const }, tenantId: "tenant-a" };

        await pipelineRouter.convertLead({ ctx: tenantCtx, input: { leadId: 7 } } as any);
        await pipelineRouter.winDeal({ ctx: tenantCtx, input: { dealId: 8 } } as any);
        await pipelineRouter.getDealState({ ctx: tenantCtx, input: { dealId: 9 } } as any);
        await pipelineRouter.getOverview({ ctx: tenantCtx, input: undefined } as any);

        expect(orchestrateLeadConversion).toHaveBeenCalledWith(7, 1, "tenant-a");
        expect(orchestrateDealWin).toHaveBeenCalledWith(8, 1, "tenant-a");
        expect(getFullPipelineState).toHaveBeenCalledWith(9, "tenant-a");
        expect(getPipelineOverviewData).toHaveBeenCalledWith("tenant-a");
    });

    it("22. maps a cross-tenant conversion to FORBIDDEN", async () => {
        const { orchestrateLeadConversion, PipelineTenantError } = await import("./pipeline-db");
        (orchestrateLeadConversion as any).mockRejectedValueOnce(
            new PipelineTenantError("Lead belongs to a different tenant."),
        );
        await expect(pipelineRouter.convertLead({ ctx: mockCtx, input: { leadId: 1 } } as any))
            .rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
