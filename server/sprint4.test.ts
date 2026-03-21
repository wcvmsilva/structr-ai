import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  transformBundleToEstimateDraft,
  calcLineTotals,
  calcBundleTotals,
  autoAdjustDiscount,
  MIN_GROSS_PROFIT,
  type BundleForEstimate,
} from "../shared/catalog-utils";

// ── Helpers ───────────────────────────────────────────────────────────
function createAuthContext(): TrpcContext {
  return {
    user: { id: 1, openId: "test-owner", name: "Test User", role: "admin" } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ── Pure Business Logic: transformBundleToEstimateDraft ───────────────

describe("transformBundleToEstimateDraft", () => {
  const mockBundle: BundleForEstimate = {
    id: 99,
    name: "Test Kitchen Bundle",
    channel: "residential",
    defaultDiscount: "8.00",
    totalCost: "470.00",
    totalPrice: "935.00",
    itemCount: 2,
    description: "Test bundle for vitest",
    items: [
      {
        catalogItemId: 1,
        quantity: "1",
        unitCostSnapshot: "285.00",
        unitPriceSnapshot: "550.00",
        lineTotalCost: "285.00",
        lineTotalPrice: "550.00",
        sortOrder: 1,
        catalogItem: {
          costItemId: "CC1100-0322",
          costGroupName: "Plumbing",
          costItemName: "Kitchen Faucet - Premium",
          description: "Premium kitchen faucet",
          unit: "Each",
        },
      },
      {
        catalogItemId: 2,
        quantity: "2",
        unitCostSnapshot: "185.00",
        unitPriceSnapshot: "385.00",
        lineTotalCost: "370.00",
        lineTotalPrice: "770.00",
        sortOrder: 2,
        catalogItem: {
          costItemId: "CC1100-0319",
          costGroupName: "Plumbing",
          costItemName: "Kitchen Sink - Stainless Double",
          description: "Stainless steel double bowl",
          unit: "Each",
        },
      },
    ],
  };

  it("produces correct line items with quantities", () => {
    const payload = transformBundleToEstimateDraft(mockBundle);

    expect(payload.lineItems.length).toBe(2);
    expect(payload.lineItems[0].costItemName).toBe("Kitchen Faucet - Premium");
    expect(payload.lineItems[0].quantity).toBe(1);
    expect(payload.lineItems[0].lineTotalCost).toBe(285);
    expect(payload.lineItems[0].lineTotalPrice).toBe(550);
    expect(payload.lineItems[1].quantity).toBe(2);
    expect(payload.lineItems[1].lineTotalCost).toBe(370);
    expect(payload.lineItems[1].lineTotalPrice).toBe(770);
  });

  it("calculates subtotals correctly", () => {
    const payload = transformBundleToEstimateDraft(mockBundle);

    // 285 + 370 = 655 cost, 550 + 770 = 1320 price
    expect(payload.subtotalCost).toBe(655);
    expect(payload.subtotalPrice).toBe(1320);
  });

  it("applies default discount from bundle (8%)", () => {
    const payload = transformBundleToEstimateDraft(mockBundle);

    // 8% discount on 1320 = 105.60, final = 1214.40
    expect(payload.discountApplied).toBe(8);
    expect(payload.discountAmount).toBeCloseTo(105.6, 1);
    expect(payload.finalTotalPrice).toBeCloseTo(1214.4, 1);
  });

  it("applies custom discount override", () => {
    const payload = transformBundleToEstimateDraft(mockBundle, 5);

    expect(payload.discountApplied).toBe(5);
    // 5% of 1320 = 66, final = 1254
    expect(payload.discountAmount).toBeCloseTo(66, 1);
    expect(payload.finalTotalPrice).toBeCloseTo(1254, 1);
  });

  it("enforces Profit Shield — caps discount to maintain 35% GP", () => {
    // Request an extreme discount that would violate 35% GP floor
    const payload = transformBundleToEstimateDraft(mockBundle, 60);

    // GP should be at or above 35%
    expect(payload.grossProfitPct).toBeGreaterThanOrEqual(MIN_GROSS_PROFIT - 0.1);
    // Discount should have been auto-adjusted down
    expect(payload.discountApplied).toBeLessThan(60);
  });

  it("includes notes in the payload", () => {
    const payload = transformBundleToEstimateDraft(mockBundle, undefined, "Special instructions for this estimate");

    expect(payload.notes).toBe("Special instructions for this estimate");
  });

  it("defaults channel to direct when null", () => {
    const bundleNoChannel = { ...mockBundle, channel: null };
    const payload = transformBundleToEstimateDraft(bundleNoChannel);

    expect(payload.channel).toBe("direct");
  });

  it("preserves bundleId and bundleName", () => {
    const payload = transformBundleToEstimateDraft(mockBundle);

    expect(payload.bundleId).toBe(99);
    expect(payload.bundleName).toBe("Test Kitchen Bundle");
  });

  it("calculates per-line GP correctly", () => {
    const payload = transformBundleToEstimateDraft(mockBundle);

    // Kitchen Faucet: GP = (550 - 285) / 550 = 48.18%
    expect(payload.lineItems[0].grossProfitPct).toBeCloseTo(48.18, 0);
    // Kitchen Sink: GP = (385 - 185) / 385 = 51.95%
    expect(payload.lineItems[1].grossProfitPct).toBeCloseTo(51.95, 0);
  });

  it("handles empty items array gracefully", () => {
    const emptyBundle = { ...mockBundle, items: [] };
    const payload = transformBundleToEstimateDraft(emptyBundle);

    expect(payload.lineItems.length).toBe(0);
    expect(payload.subtotalCost).toBe(0);
    expect(payload.subtotalPrice).toBe(0);
    expect(payload.itemCount).toBe(0);
  });
});

// ── tRPC Preset Router Integration Tests (live DB) ────────────────────

describe("preset router — full lifecycle", () => {
  let workingBundleId: number;
  let presetBundleId: number;
  let catalogItemId: number;

  beforeAll(async () => {
    // Get a valid catalog item ID for testing
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const items = await caller.catalog.list();
    expect(items.length).toBeGreaterThan(0);
    catalogItemId = items[0].id;
  });

  it("1. creates a working bundle to use as preset source", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bundle = await caller.bundle.create({
      name: "Sprint 4 Test — Preset Source",
      description: "Will be converted to preset",
    });

    expect(bundle.id).toBeGreaterThan(0);
    workingBundleId = bundle.id;

    // Add an item to it
    await caller.bundle.addItem({
      bundleId: workingBundleId,
      catalogItemId,
      quantity: 3,
    });
  });

  it("2. creates a preset from the working bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const preset = await caller.preset.createFromBundle({
      bundleId: workingBundleId,
      presetCategory: "Kitchen",
      presetTags: ["plumbing", "premium"],
      description: "Standard kitchen plumbing preset",
    });

    expect(preset).toBeDefined();
    expect(preset.id).toBeGreaterThan(0);
    expect(preset.id).not.toBe(workingBundleId);
    presetBundleId = preset.id;
  });

  it("3. lists presets (includes our new preset)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const presets = await caller.preset.list();

    expect(Array.isArray(presets)).toBe(true);
    const found = presets.find((p) => p.id === presetBundleId);
    expect(found).toBeDefined();
    expect(found!.isPreset).toBe(true);
  });

  it("4. filters presets by category", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const kitchenPresets = await caller.preset.list({ category: "Kitchen" });
    const found = kitchenPresets.find((p) => p.id === presetBundleId);
    expect(found).toBeDefined();

    const bathroomPresets = await caller.preset.list({ category: "Bathroom" });
    const notFound = bathroomPresets.find((p) => p.id === presetBundleId);
    expect(notFound).toBeUndefined();
  });

  it("5. creates a working bundle from the preset (clone)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const cloned = await caller.preset.createBundleFromPreset({
      presetId: presetBundleId,
      bundleName: "Cloned from Preset — Test",
    });

    expect(cloned).toBeDefined();
    expect(cloned.id).not.toBe(presetBundleId);
    expect(cloned.name).toBe("Cloned from Preset — Test");

    const authCaller = appRouter.createCaller(createAuthContext());
    const clonedBundle = await authCaller.bundle.getById({ id: cloned.id });
    expect(clonedBundle.items.length).toBe(1);
    expect(parseFloat(clonedBundle.items[0].quantity)).toBe(3);

    // Clean up
    await caller.bundle.delete({ bundleId: cloned.id });
  });

  it("6. marks an existing bundle as preset", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a fresh bundle
    const bundle = await caller.bundle.create({ name: "Will Become Preset" });
    await caller.bundle.addItem({ bundleId: bundle.id, catalogItemId, quantity: 1 });

    const marked = await caller.preset.markAsPreset({
      bundleId: bundle.id,
      presetCategory: "Bathroom",
      presetTags: ["basic"],
    });

    expect(marked.isPreset).toBe(true);

    // Verify it shows in presets list
    const publicCaller = appRouter.createCaller(createPublicContext());
    const presets = await publicCaller.preset.list();
    const found = presets.find((p) => p.id === bundle.id);
    expect(found).toBeDefined();

    // Unmark it
    const unmarked = await caller.preset.unmarkAsPreset({ bundleId: bundle.id });
    expect(unmarked.isPreset).toBe(false);

    // Clean up
    await caller.bundle.delete({ bundleId: bundle.id });
  });

  it("7. deletes the preset", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.preset.delete({ bundleId: presetBundleId });
    expect(result.success).toBe(true);

    // Verify it's gone from presets list
    const publicCaller = appRouter.createCaller(createPublicContext());
    const presets = await publicCaller.preset.list();
    const found = presets.find((p) => p.id === presetBundleId);
    expect(found).toBeUndefined();
  });

  // Clean up the working bundle
  it("8. cleans up the working bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.bundle.delete({ bundleId: workingBundleId });
  });
});

// ── tRPC Estimate Router Integration Tests (live DB) ──────────────────

describe("estimate router — send bundle to estimate", () => {
  let bundleId: number;
  let estimateDraftId: number;
  let catalogItemId: number;

  beforeAll(async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const items = await caller.catalog.list();
    catalogItemId = items[0].id;
  });

  it("1. creates a bundle with items for estimate", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bundle = await caller.bundle.create({
      name: "Estimate Test Bundle",
      description: "For estimate integration test",
    });
    bundleId = bundle.id;

    await caller.bundle.addItem({ bundleId, catalogItemId, quantity: 2 });
  });

  it("2. sends bundle to estimate (creates draft)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const draft = await caller.estimateLegacy.sendBundleToEstimate({
      bundleId,
      discount: 10,
      notes: "Test estimate from vitest",
    });

    expect(draft).toBeDefined();
    expect(draft.id).toBeGreaterThan(0);
    expect(draft.bundleName).toBe("Estimate Test Bundle");
    estimateDraftId = draft.id;
  });

  it("3. retrieves the estimate draft by ID", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const draft = await caller.estimateLegacy.getById({ id: estimateDraftId });

    expect(draft).toBeDefined();
    expect(draft.bundleName).toBe("Estimate Test Bundle");
    expect(draft.status).toBe("draft");
    expect(draft.notes).toBe("Test estimate from vitest");
    // Verify line items are stored as JSON
    expect(Array.isArray(draft.lineItems)).toBe(true);
    expect(draft.lineItems.length).toBe(1);
    expect(draft.lineItems[0].quantity).toBe(2);
  });

  it("4. lists estimate drafts (includes our draft)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const drafts = await caller.estimateLegacy.list();

    expect(Array.isArray(drafts)).toBe(true);
    const found = drafts.find((d: any) => d.id === estimateDraftId);
    expect(found).toBeDefined();
    expect(found!.bundleName).toBe("Estimate Test Bundle");
  });

  it("5. rejects sending an empty bundle to estimate", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create an empty bundle
    const emptyBundle = await caller.bundle.create({ name: "Empty Bundle" });

    await expect(
      caller.estimateLegacy.sendBundleToEstimate({ bundleId: emptyBundle.id })
    ).rejects.toThrow("Cannot send an empty bundle to estimate");

    // Clean up
    await caller.bundle.delete({ bundleId: emptyBundle.id });
  });

  it("6. rejects sending a non-existent bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.estimateLegacy.sendBundleToEstimate({ bundleId: 999999 })
    ).rejects.toThrow();
  });

  it("7. estimate draft preserves Profit Shield enforcement", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const draft = await caller.estimateLegacy.getById({ id: estimateDraftId });

    // GP should be >= 35% (Profit Shield floor)
    const gp = parseFloat(draft.grossProfitPct);
    expect(gp).toBeGreaterThanOrEqual(MIN_GROSS_PROFIT - 0.5);
  });

  // Clean up
  it("8. cleans up test bundle", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.bundle.delete({ bundleId });
  });
});

// ── Auth enforcement for new procedures ──────────────────────────────

describe("Sprint 4 — auth enforcement", () => {
  it("rejects unauthenticated preset.createFromBundle", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.preset.createFromBundle({ bundleId: 1 })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated preset.markAsPreset", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.preset.markAsPreset({ bundleId: 1 })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated estimateLegacy.sendBundleToEstimate", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.estimateLegacy.sendBundleToEstimate({ bundleId: 1 })
    ).rejects.toThrow();
  });

  it("allows public access to preset.list", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const presets = await caller.preset.list();
    expect(Array.isArray(presets)).toBe(true);
  });

  it("blocks public access to estimateLegacy.list", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.estimateLegacy.list()).rejects.toThrow();
  });
});

// ── Regression: existing bundle behavior still works ─────────────────

describe("Sprint 4 — no regression in bundle CRUD", () => {
  let bundleId: number;
  let catalogItemId: number;

  beforeAll(async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const items = await caller.catalog.list();
    catalogItemId = items[0].id;
  });

  it("create + add + update qty + remove + delete still works", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create
    const bundle = await caller.bundle.create({ name: "Regression Test" });
    bundleId = bundle.id;
    expect(bundle.id).toBeGreaterThan(0);

    // Add item
    const item = await caller.bundle.addItem({ bundleId, catalogItemId, quantity: 1 });
    expect(item.id).toBeGreaterThan(0);

    // Update quantity
    await caller.bundle.updateItemQuantity({ bundleItemId: item.id, quantity: 5 });
    const publicCaller = appRouter.createCaller(createPublicContext());
    const updated = await publicCaller.bundle.getById({ id: bundleId });
    expect(parseFloat(updated.items[0].quantity)).toBe(5);

    // Remove item
    await caller.bundle.removeItem({ bundleItemId: item.id });
    const afterRemove = await publicCaller.bundle.getById({ id: bundleId });
    expect(afterRemove.items.length).toBe(0);

    // Delete
    await caller.bundle.delete({ bundleId });
    const afterDelete = await publicCaller.bundle.getById({ id: bundleId });
    expect(afterDelete.isActive).toBe(false);
  });

  it("catalog list and groups require auth but still return data", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const items = await caller.catalog.list();
    expect(items.length).toBeGreaterThan(400);

    const groups = await caller.catalog.groups();
    expect(groups.length).toBe(19);
  });
});
