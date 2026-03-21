import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  calcLineTotals,
  calcBundleTotals,
  validateQuantity,
  generateJobTreadCSVWithQty,
} from "../shared/catalog-utils";

// ── Helpers ───────────────────────────────────────────────────────────
function createAuthContext(): TrpcContext {
  return {
    user: { id: 1, openId: "test-owner", name: "Test User", role: "admin" } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

// ── Pure Business Logic Tests ─────────────────────────────────────────

describe("calcLineTotals", () => {
  it("calculates line totals for qty=1", () => {
    const result = calcLineTotals(1, 185, 385);
    expect(result.lineTotalCost).toBe(185);
    expect(result.lineTotalPrice).toBe(385);
  });

  it("calculates line totals for qty=3", () => {
    const result = calcLineTotals(3, 185, 385);
    expect(result.lineTotalCost).toBe(555);
    expect(result.lineTotalPrice).toBe(1155);
  });

  it("handles fractional quantities (qty=2.5)", () => {
    const result = calcLineTotals(2.5, 100, 200);
    expect(result.lineTotalCost).toBe(250);
    expect(result.lineTotalPrice).toBe(500);
  });

  it("handles zero quantity", () => {
    const result = calcLineTotals(0, 185, 385);
    expect(result.lineTotalCost).toBe(0);
    expect(result.lineTotalPrice).toBe(0);
  });

  it("handles negative quantity (clamps to 0)", () => {
    const result = calcLineTotals(-5, 185, 385);
    expect(result.lineTotalCost).toBe(0);
    expect(result.lineTotalPrice).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const result = calcLineTotals(3, 33.33, 66.67);
    expect(result.lineTotalCost).toBe(99.99);
    expect(result.lineTotalPrice).toBe(200.01);
  });
});

describe("calcBundleTotals", () => {
  it("calculates totals for a multi-item bundle", () => {
    const items = [
      { quantity: 2, unitCost: 185, unitPrice: 385 },
      { quantity: 1, unitCost: 450, unitPrice: 850 },
    ];
    const result = calcBundleTotals(items);
    expect(result.totalCost).toBe(820); // 2*185 + 1*450
    expect(result.totalPrice).toBe(1620); // 2*385 + 1*850
    expect(result.itemCount).toBe(2);
    expect(result.grossProfitPct).toBeGreaterThan(35);
  });

  it("returns zeros for empty bundle", () => {
    const result = calcBundleTotals([]);
    expect(result.totalCost).toBe(0);
    expect(result.totalPrice).toBe(0);
    expect(result.itemCount).toBe(0);
    expect(result.grossProfitPct).toBe(0);
  });

  it("calculates GP correctly for single item", () => {
    const result = calcBundleTotals([{ quantity: 1, unitCost: 65, unitPrice: 100 }]);
    expect(result.grossProfitPct).toBeCloseTo(35, 0);
  });
});

describe("validateQuantity", () => {
  it("accepts valid integer quantity", () => {
    const result = validateQuantity(5);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe(5);
  });

  it("accepts valid decimal quantity", () => {
    const result = validateQuantity(2.5);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe(2.5);
  });

  it("rejects zero quantity", () => {
    const result = validateQuantity(0);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(1);
  });

  it("rejects negative quantity", () => {
    const result = validateQuantity(-3);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(1);
  });

  it("clamps quantity above 99999", () => {
    const result = validateQuantity(100000);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(99999);
  });

  it("rounds to 2 decimal places", () => {
    const result = validateQuantity(3.456);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe(3.46);
  });

  it("rejects NaN", () => {
    const result = validateQuantity(NaN);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe(1);
  });
});

describe("generateJobTreadCSVWithQty", () => {
  it("generates CSV with quantity column", () => {
    const items = [
      {
        costGroupName: "Plumbing",
        costItemName: "Bathroom Faucet - Premium",
        description: "Test",
        unit: "Each",
        unitCost: "185.00",
        unitPrice: "385.00",
        quantity: 3,
      },
    ];
    const csv = generateJobTreadCSVWithQty(items, 8);
    const lines = csv.split("\n");

    expect(lines[0]).toContain("Quantity");
    expect(lines[1]).toContain('"3"');
    // 385 * (1 - 0.08) = 354.20
    expect(lines[1]).toContain("354.20");
  });

  it("applies 0% discount with quantity", () => {
    const items = [
      {
        costGroupName: "Electrical",
        costItemName: "AFCI Breaker",
        description: null,
        unit: "Each",
        unitCost: "45.00",
        unitPrice: "80.00",
        quantity: 10,
      },
    ];
    const csv = generateJobTreadCSVWithQty(items, 0);
    const lines = csv.split("\n");
    expect(lines[1]).toContain('"10"');
    expect(lines[1]).toContain("80.00");
  });
});

// ── tRPC Bundle Router Integration Tests (live DB) ────────────────────

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("bundle router — full CRUD lifecycle", () => {
  let bundleId: number;
  let bundleItemId: number;
  let catalogItemId: number;

  beforeAll(async () => {
    // Get a valid catalog item ID for testing
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const items = await caller.catalog.list();
    expect(items.length).toBeGreaterThan(0);
    catalogItemId = items[0].id;
  });

  it("1. creates a new bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bundle = await caller.bundle.create({
      name: "Test Bundle — Vitest",
      description: "Created by automated test",
    });

    expect(bundle).toBeDefined();
    expect(bundle.id).toBeGreaterThan(0);
    expect(bundle.name).toBe("Test Bundle — Vitest");
    bundleId = bundle.id;
  });

  it("2. gets bundle by ID", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bundle = await caller.bundle.getById({ id: bundleId });

    expect(bundle).toBeDefined();
    expect(bundle.name).toBe("Test Bundle — Vitest");
    expect(bundle.items).toEqual([]);
    expect(bundle.itemCount).toBe(0);
  });

  it("3. lists all bundles (includes our new bundle)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bundles = await caller.bundle.list();

    expect(Array.isArray(bundles)).toBe(true);
    const found = bundles.find((b) => b.id === bundleId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test Bundle — Vitest");
  });

  it("4. adds a catalog item to the bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bundle.addItem({
      bundleId,
      catalogItemId,
      quantity: 2,
    });

    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    bundleItemId = result.id;
  });

  it("5. verifies item was added with correct quantity and snapshots", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bundle = await caller.bundle.getById({ id: bundleId });

    expect(bundle.items.length).toBe(1);
    expect(bundle.itemCount).toBe(1);
    expect(parseFloat(bundle.items[0].quantity)).toBe(2);
    // Snapshots should match the catalog item's current prices
    expect(parseFloat(bundle.items[0].unitCostSnapshot)).toBeGreaterThan(0);
    expect(parseFloat(bundle.items[0].unitPriceSnapshot)).toBeGreaterThan(0);
  });

  it("6. updates item quantity", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bundle.updateItemQuantity({
      bundleItemId,
      quantity: 5,
    });

    expect(result).toBeDefined();

    // Verify the update
    const publicCaller = appRouter.createCaller(createAuthContext());
    const bundle = await publicCaller.bundle.getById({ id: bundleId });
    expect(parseFloat(bundle.items[0].quantity)).toBe(5);
  });

  it("7. rejects invalid quantity (zero)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.bundle.updateItemQuantity({ bundleItemId, quantity: 0 })
    ).rejects.toThrow();
  });

  it("8. updates bundle metadata (rename)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const updated = await caller.bundle.updateMeta({
      id: bundleId,
      name: "Renamed Test Bundle",
    });

    expect(updated.name).toBe("Renamed Test Bundle");
  });

  it("9. duplicates the bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const duplicate = await caller.bundle.duplicate({
      bundleId,
      newName: "Duplicated Test Bundle",
    });

    expect(duplicate).toBeDefined();
    expect(duplicate.id).not.toBe(bundleId);
    expect(duplicate.name).toBe("Duplicated Test Bundle");

    // Verify the duplicate has items
    const publicCaller = appRouter.createCaller(createAuthContext());
    const dupBundle = await publicCaller.bundle.getById({ id: duplicate.id });
    expect(dupBundle.items.length).toBe(1);

    // Clean up duplicate
    await caller.bundle.delete({ bundleId: duplicate.id });
  });

  it("10. removes item from bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await caller.bundle.removeItem({ bundleItemId });

    const publicCaller = appRouter.createCaller(createAuthContext());
    const bundle = await publicCaller.bundle.getById({ id: bundleId });
    expect(bundle.items.length).toBe(0);
  });

  it("11. deletes the bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bundle.delete({ bundleId });
    expect(result.success).toBe(true);
  });

  it("12. deleted bundle is soft-deleted (isActive=false)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bundle = await caller.bundle.getById({ id: bundleId });
    expect(bundle.isActive).toBe(false);
  });
});

describe("bundle router — auth enforcement", () => {
  it("rejects unauthenticated create", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.bundle.create({ name: "Should Fail" })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated addItem", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.bundle.addItem({ bundleId: 1, catalogItemId: 1, quantity: 1 })
    ).rejects.toThrow();
  });
});
