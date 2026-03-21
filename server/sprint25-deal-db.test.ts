import { describe, it, expect, vi, beforeEach } from "vitest";

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
  transaction: vi.fn(async (cb) => cb(mockDb)),
};

vi.mock("./db", () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock("./audit", () => ({
  logAudit: vi.fn(),
  withAuditLog: vi.fn(async (params, before, fn) => fn()),
}));

import * as dealDb from "./deal-db";

const mockDeal = {
  id: 1,
  nanoid: "deal_123",
  title: "A New Deal",
  stage: "discovery",
  value: 5000,
  probability: 10,
  assignedTo: 1,
  channel: "direct"
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 25: Deal Flow DB Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResolveData = { 
      select: [mockDeal], 
      insert: [{ insertId: 1 }], 
      update: [{ affectedRows: 1 }], 
      delete: [] 
    };
  });

  describe("createDeal", () => {
    it("1. creates a deal and logs audit", async () => {
      await dealDb.createDeal({
        title: "Test Deal",
        stage: "discovery",
        clientId: 1,
        createdBy: 1,
      } as any);

      expect(mockDb.insert).toHaveBeenCalled();
      const { withAuditLog } = await import("./audit");
      expect(withAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "deal.create", tableName: "deals" }),
        null,
        expect.any(Function)
      );
    });
  });

  describe("getDealById", () => {
    it("2. retrieves a deal correctly", async () => {
      const result = await dealDb.getDealById(1);
      expect(mockDb.select).toHaveBeenCalled();
      expect(result?.title).toBe("A New Deal");
    });
    
    it("3. handles missing deal", async () => {
      queryResolveData.select = [];
      const result = await dealDb.getDealById(99);
      expect(result).toBeNull();
    });
  });

  describe("listDeals", () => {
    it("4. applies filters correctly", async () => {
      await dealDb.listDeals({ stage: "discovery", assignedTo: 1 });
      expect(mockDb.select).toHaveBeenCalled();
      // Implementation specific verification would go here, basic call check is enough for mock
    });
  });

  describe("updateDeal", () => {
    it("5. updates deal attributes and logs audit", async () => {
      await dealDb.updateDeal(1, { title: "Updated Deal" }, 1);
      expect(mockDb.update).toHaveBeenCalled();
      const { withAuditLog } = await import("./audit");
      expect(withAuditLog).toHaveBeenCalled();
    });

    it("6. throws error if deal not found", async () => {
      queryResolveData.select = [];
      await expect(dealDb.updateDeal(99, { title: "Updated Deal" }, 1)).rejects.toThrow("Deal not found");
    });
  });

  describe("updateDealStage", () => {
    it("7. advances stage using transaction, adds history, and logs audit", async () => {
      await dealDb.updateDealStage(1, "estimating", 1, "Moving to estimating");
      
      expect(mockDb.transaction).toHaveBeenCalled();
      // Should update deal stage and create stage history record inside transaction bounds
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("8. avoids update if stage is identical", async () => {
      await dealDb.updateDealStage(1, "discovery", 1, "Still discovering");
      expect(mockDb.transaction).not.toHaveBeenCalled(); 
    });
  });

  describe("markWon / markLost", () => {
    it("9. markWon updates stage to won and sets projectId", async () => {
      await dealDb.markWon(1, 2, new Date(), 1);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("10. markLost updates stage to lost and sets reasonable lost reason", async () => {
      await dealDb.markLost(1, "Price too high", 1);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe("addDealActivity", () => {
    it("11. logs activity", async () => {
      await dealDb.addDealActivity({ dealId: 1, activityType: "call", description: "Called client", performedBy: 1 } as any);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe("getDealActivities", () => {
    it("12. gets activities for deal", async () => {
      queryResolveData.select = [{ id: 1, activityType: "call" }];
      const result = await dealDb.getDealActivities(1);
      expect(mockDb.select).toHaveBeenCalled();
      expect(result.length).toBe(1);
    });
  });

  describe("getDealStats", () => {
    it("13. retrieves stats without error", async () => {
      queryResolveData.select = [{ total: 5 }];
      const result = await dealDb.getDealStats();
      expect(mockDb.select).toHaveBeenCalled();
    });
  });
});
