import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  calcGrossProfit,
  autoAdjustDiscount,
  fmtCurrency,
  MIN_GROSS_PROFIT,
  generateJobTreadCSV,
} from "../shared/catalog-utils";

// ── Helper: create a public (unauthenticated) context ──────────────
function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ── tRPC Catalog Router Tests (live DB) ────────────────────────────
describe("catalog.list", () => {
  it("returns an array of catalog items from the database", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const items = await caller.catalog.list();

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    // Verify structure of the first item
    const first = items[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("costItemId");
    expect(first).toHaveProperty("costGroupName");
    expect(first).toHaveProperty("costItemName");
    expect(first).toHaveProperty("unit");
    expect(first).toHaveProperty("unitCost");
    expect(first).toHaveProperty("unitPrice");
    expect(first).toHaveProperty("costCode");
  });

  it("filters items by costGroupName", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const items = await caller.catalog.list({ costGroupName: "Electrical" });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.costGroupName).toBe("Electrical");
    }
  });

  it("filters items by search term", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const items = await caller.catalog.list({ search: "AFCI" });

    expect(items.length).toBeGreaterThan(0);
    const hasMatch = items.some(
      (item) =>
        item.costItemName.toLowerCase().includes("afci") ||
        (item.description || "").toLowerCase().includes("afci") ||
        (item.costItemId || "").toLowerCase().includes("afci")
    );
    expect(hasMatch).toBe(true);
  });

  it("filters items by costCode", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const items = await caller.catalog.list({ costCode: "1000" });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.costCode).toBe("1000");
    }
  });
});

describe("catalog.groups", () => {
  it("returns all cost groups with counts", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const groups = await caller.catalog.groups();

    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    // Verify structure
    const first = groups[0];
    expect(first).toHaveProperty("costGroupName");
    expect(first).toHaveProperty("costCode");
    expect(first).toHaveProperty("count");
    expect(typeof first.count).toBe("number");
    expect(first.count).toBeGreaterThan(0);
  });

  it("includes the Electrical group with 39 items", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const groups = await caller.catalog.groups();
    const electrical = groups.find((g) => g.costGroupName === "Electrical");

    expect(electrical).toBeDefined();
    expect(electrical!.count).toBe(39);
    expect(electrical!.costCode).toBe("1000");
  });
});

describe("catalog.stats", () => {
  it("returns total items, groups, and average margin", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const stats = await caller.catalog.stats();

    expect(stats).toHaveProperty("totalItems");
    expect(stats).toHaveProperty("totalGroups");
    expect(stats).toHaveProperty("avgMargin");
    expect(Number(stats.totalItems)).toBe(458);
    expect(Number(stats.totalGroups)).toBe(19);
    expect(Number(stats.avgMargin)).toBeGreaterThan(30);
  });
});

describe("catalog.getById", () => {
  it("returns a single item by ID", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // First get an item to know a valid ID
    const items = await caller.catalog.list();
    const firstItem = items[0];

    const result = await caller.catalog.getById({ id: firstItem.id });

    expect(result).toBeDefined();
    expect(result!.id).toBe(firstItem.id);
    expect(result!.costItemName).toBe(firstItem.costItemName);
  });

  it("returns undefined for a non-existent ID", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.catalog.getById({ id: 999999 });

    expect(result).toBeUndefined();
  });
});

// ── Business Logic Tests (pure functions, no DB) ───────────────────
describe("calcGrossProfit", () => {
  it("calculates GP correctly for standard 35% margin", () => {
    // If cost = 65, sell = 100 → GP = 35%
    expect(calcGrossProfit(100, 65)).toBeCloseTo(35, 1);
  });

  it("returns 0 when sell price is 0", () => {
    expect(calcGrossProfit(0, 50)).toBe(0);
  });

  it("calculates GP for real catalog item (AFCI Breaker: cost $45, sell $80)", () => {
    const gp = calcGrossProfit(80, 45);
    expect(gp).toBeCloseTo(43.75, 1);
  });
});

describe("autoAdjustDiscount", () => {
  it("approves discount when GP stays above floor", () => {
    const result = autoAdjustDiscount(65, 100, 5);
    // 5% off $100 = $95 sell, cost $65 → GP = (95-65)/95 = 31.6% → below 35%!
    // Actually let's recalculate: (95-65)/95*100 = 31.58% → should be adjusted
    // Let me use a case where it passes
    const result2 = autoAdjustDiscount(45, 100, 5);
    // 5% off $100 = $95, cost $45 → GP = (95-45)/95*100 = 52.6% → passes
    expect(result2.wasAdjusted).toBe(false);
    expect(result2.appliedDiscount).toBe(5);
    expect(result2.finalSell).toBeCloseTo(95, 2);
  });

  it("auto-adjusts discount when GP would drop below floor", () => {
    // cost = 65, sell = 100, requested 10% discount
    // 10% off → $90, GP = (90-65)/90 = 27.8% → below 35%
    const result = autoAdjustDiscount(65, 100, 10);
    expect(result.wasAdjusted).toBe(true);
    expect(result.appliedDiscount).toBeLessThan(10);
    // Final GP should be at or above MIN_GROSS_PROFIT
    const finalGP = calcGrossProfit(result.finalSell, 65);
    expect(finalGP).toBeGreaterThanOrEqual(MIN_GROSS_PROFIT - 0.1);
  });

  it("returns 0 discount when even 0% discount would violate floor", () => {
    // cost = 70, sell = 100 → GP = 30% already below 35%
    const result = autoAdjustDiscount(70, 100, 5);
    expect(result.wasAdjusted).toBe(true);
    expect(result.appliedDiscount).toBeCloseTo(0, 0);
  });
});

describe("fmtCurrency", () => {
  it("formats numbers as USD currency", () => {
    expect(fmtCurrency(1500)).toBe("$1,500.00");
    expect(fmtCurrency(0)).toBe("$0.00");
    expect(fmtCurrency(45.5)).toBe("$45.50");
  });
});

describe("generateJobTreadCSV", () => {
  it("generates valid CSV with headers and rows", () => {
    const items = [
      {
        costGroupName: "Electrical",
        costItemName: "AFCI Breaker",
        description: "Test item",
        unit: "Each",
        unitCost: "45.00",
        unitPrice: "80.00",
      },
    ];

    const csv = generateJobTreadCSV(items, 8);
    const lines = csv.split("\n");

    // First line is headers
    expect(lines[0]).toContain("Cost Group Name");
    expect(lines[0]).toContain("Unit Price");

    // Second line is data with 8% discount applied
    expect(lines[1]).toContain("Electrical");
    expect(lines[1]).toContain("AFCI Breaker");
    // 80 * (1 - 0.08) = 73.60
    expect(lines[1]).toContain("73.60");
  });

  it("applies 0% discount correctly", () => {
    const items = [
      {
        costGroupName: "Roofing",
        costItemName: "Shingles",
        description: null,
        unit: "Square",
        unitCost: "100.00",
        unitPrice: "200.00",
      },
    ];

    const csv = generateJobTreadCSV(items, 0);
    const lines = csv.split("\n");
    expect(lines[1]).toContain("200.00");
  });
});
