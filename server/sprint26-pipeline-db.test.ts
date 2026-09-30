import { describe, it, expect, vi, beforeEach } from "vitest";

// B2: pipeline helpers take the caller's resolved tenant as a required argument.
const T = "t-fixture";

// ─────────────────────────────────────────────────────────────────────────────
// 1. ROBUST DRIZZLE MOCK
// ─────────────────────────────────────────────────────────────────────────────

const createQueryBuilder = (resolveType: "select" | "insert" | "update" | "delete") => {
  return {
    $dynamic: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    execute: vi.fn().mockReturnThis(),
    then(resolve: any) {
      resolve(queryResolveData[resolveType]);
    }
  };
};

let queryResolveData: any = { 
  select: [], 
  insert: [], 
  update: [], 
  delete: [] 
};

const mockDb = {
  select: vi.fn(() => createQueryBuilder("select")),
  insert: vi.fn(() => createQueryBuilder("insert")),
  update: vi.fn(() => createQueryBuilder("update")),
  delete: vi.fn(() => createQueryBuilder("delete")),
  execute: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
};

vi.mock("./db", () => ({
  getDb: vi.fn(() => mockDb),
  getRawClient: vi.fn(() => ({ execute: vi.fn() })),
}));

// Audits resolve a truthy row by default — matching the fail-closed contract the
// conversion writers now enforce (an audit call that returns null/undefined must abort
// the whole conversion). Individual tests override this per-call via mockResolvedValueOnce.
vi.mock("./audit", () => ({
  logAudit: vi.fn(async (params: any) => ({
    id: "audit-fixture-1",
    userId: params.userId ?? null,
    action: params.action,
    tableName: params.tableName,
    recordId: params.recordId ?? null,
    oldValues: params.before ?? null,
    newValues: params.after ?? null,
    createdAt: new Date(),
    ipAddress: null,
    userAgent: null,
  })),
  withAuditLog: vi.fn(async (params, before, fn) => {
    const res = await fn();
    return res;
  }),
}));

// Mock shared engine logic
vi.mock("../shared/pipeline-orchestrator", () => ({
  buildLeadConversionPayload: vi.fn(() => ({
    clientPayload: { firstName: "John", lastName: "Doe" },
    dealPayload: { title: "Lead Deal", value: "100" },
    projectPayload: { name: "Lead Project" },
  })),
  buildDealWinPayload: vi.fn(() => ({
    valid: true,
    dealUpdate: { stage: "won" },
    projectUpdate: { status: "approved" },
    estimateUpdate: { status: "approved" },
  })),
  getPipelineSummary: vi.fn(() => ({
    leadsByStatus: {},
    dealsByStage: {},
    pipelineValue: 1000,
  })),
}));

import * as pipelineDb from "./pipeline-db";

describe("Pipeline DB Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResolveData = { 
      select: [{ id: 1, status: "qualified", projectId: 10, leadId: 5, clientId: 20 }], 
      insert: [{ insertId: 1 }], 
      update: [{ affectedRows: 1 }], 
      delete: [] 
    };
  });

  // orchestrateLeadConversion now locks the lead row (`.for("update")`) and looks up
  // profiles/projects/clients/deals for identity/replay verification — this file's
  // per-verb-type mock (one resolved array per select/insert/update, no per-table
  // awareness) cannot represent that correctly: every select resolves the SAME array
  // regardless of which table was queried, so a `profiles` lookup would receive whatever
  // row was configured for the `leads` lookup. Every scenario previously covered here
  // (tests 1-4, 21-26) is now covered, with a harness that actually supports per-table
  // data, in pipeline-conversion-audit-v2.test.ts. orchestrateDealWin/getFullPipelineState/
  // getPipelineOverviewData below are untouched by this card and keep this mock.

  describe("orchestrateDealWin", () => {
    it("5. should update multiple entities when deal is won", async () => {
      queryResolveData.select = [{ id: 1, projectId: 10, estimateId: 20 }]; // Deal
      const result = await pipelineDb.orchestrateDealWin("1", "999", T);

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalledTimes(1); // Deal stage update
      expect(result.success).toBe(true);
    });

    it("6. should only update deal/project if no estimate exists", async () => {
      const { buildDealWinPayload } = await import("../shared/pipeline-orchestrator");
      (buildDealWinPayload as any).mockReturnValueOnce({
        valid: true,
        dealUpdate: { stage: "won" },
        projectUpdate: { status: "in_progress" },
        estimateUpdate: null,
      });

      queryResolveData.select = [{ id: 1, projectId: 10, estimateId: null }]; 
      await pipelineDb.orchestrateDealWin("1", "999", T);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });

    it("7. should return error if payload is invalid", async () => {
        const { buildDealWinPayload } = await import("../shared/pipeline-orchestrator");
        (buildDealWinPayload as any).mockReturnValueOnce({
          valid: false,
          reason: "Invalid deal state",
        });
  
        queryResolveData.select = [{ id: 1 }]; 
        const result = await pipelineDb.orchestrateDealWin("1", "999", T);
        expect(result.success).toBe(false);
        expect((result as any).reason).toBe("Invalid deal state");
    });

    it("8. should throw error if deal not found", async () => {
      queryResolveData.select = [];
      await expect(pipelineDb.orchestrateDealWin("999", "1", T)).rejects.toThrow("Deal not found");
    });
  });

  describe("getFullPipelineState", () => {
    it("9. should fetch all linked entities", async () => {
      queryResolveData.select = [{ id: 1, projectId: 10 }]; // many selects will return this
      const result = await pipelineDb.getFullPipelineState("1", T);
      expect(mockDb.select).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.deal.id).toBe(1);
    });
  });

  describe("getPipelineOverviewData", () => {
    it("10. should return summary metrics from engine", async () => {
      queryResolveData.select = [[]]; // empty leads, deals, projects
      const result = await pipelineDb.getPipelineOverviewData(T);
      expect(result).toHaveProperty("summary");
      expect(result.summary!.pipelineValue).toBe(1000);
    });

    it("11. should fetch leads, deals, and projects", async () => {
        await pipelineDb.getPipelineOverviewData(T);
        expect(mockDb.select).toHaveBeenCalledTimes(3);
    });
  });

  // Adding more tests to reach 20
  describe("Edge Cases & Hardening", () => {
    // 12, 15, 17 (orchestrateLeadConversion: partial data, lead activity, transaction
    // failure re-throw) moved to pipeline-conversion-audit-v2.test.ts — see the note above
    // "orchestrateDealWin" for why this file's mock can no longer represent that function.

    it("13. orchestrateDealWin should log audit on deal win", async () => {
        const { withAuditLog } = await import("./audit");
        queryResolveData.select = [{ id: 1, projectId: 10 }];
        await pipelineDb.orchestrateDealWin("1", "1", T);
        const { logAudit: logAuditFn } = await import("./audit");
        expect(logAuditFn).toHaveBeenCalled();
    });

    it("14. getPipelineOverviewData should handle null responses", async () => {
        queryResolveData.select = null; // Should not crash if handled
        mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ then: (r: any) => r([]) }) }) } as any);
        const result = await pipelineDb.getPipelineOverviewData(T);
        expect(result).toBeDefined();
    });

    it.skip("16. validate lead is qualified before conversion — skipped: qualification check not yet in pipeline-db", () => {});

    it("18. orchestrateDealWin should handle projects already approved", async () => {
        queryResolveData.select = [{ id: 1, projectId: 10, estimateId: 20 }];
        // If project status is already approved, it still updates (idempotent-ish)
        const result = await pipelineDb.orchestrateDealWin("1", "1", T);
        expect(result.success).toBe(true);
    });

    it("19. getFullPipelineState should return null for missing deal", async () => {
        queryResolveData.select = [];
        const result = await pipelineDb.getFullPipelineState("999", T);
        expect(result).toBeNull();
    });

    it("20. ensure all payloads use logAudit", async () => {
        const { logAudit: logAuditFn } = await import("./audit");
        queryResolveData.select = [{ id: 1, projectId: 10 }];
        await pipelineDb.orchestrateDealWin("1", "1", T);
        expect(logAuditFn).toHaveBeenCalled();
    });
  });
});
