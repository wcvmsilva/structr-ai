import { eq, like, or, sql, asc, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, catalogItems, bundles, bundleItems, estimateDrafts, type CatalogItem, type Bundle, type BundleItem, type InsertBundle, type InsertBundleItem, type EstimateDraft, type EstimateDraftLineItem } from "../drizzle/schema";
import { ENV } from './_core/env';
import { calcLineTotals, calcBundleTotals, calcGrossProfit, autoAdjustDiscount } from "@shared/catalog-utils";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ── Catalog Queries ──────────────────────────────────────────────

export async function getCatalogItems(opts?: {
  costGroupName?: string;
  search?: string;
  costCode?: string;
  activeOnly?: boolean;
}): Promise<CatalogItem[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (opts?.activeOnly !== false) {
    conditions.push(eq(catalogItems.isActive, true));
  }
  if (opts?.costGroupName) {
    conditions.push(eq(catalogItems.costGroupName, opts.costGroupName));
  }
  if (opts?.costCode) {
    conditions.push(eq(catalogItems.costCode, opts.costCode));
  }
  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(catalogItems.costItemName, pattern),
        like(catalogItems.description, pattern),
        like(catalogItems.costItemId, pattern)
      )!
    );
  }

  const query = db
    .select()
    .from(catalogItems)
    .orderBy(asc(catalogItems.costCode), asc(catalogItems.costItemName));

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }

  return query;
}

export async function getCatalogGroups(): Promise<{ costGroupName: string; costCode: string; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select({
      costGroupName: catalogItems.costGroupName,
      costCode: sql<string>`MIN(${catalogItems.costCode})`.as("costCode"),
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(catalogItems)
    .where(eq(catalogItems.isActive, true))
    .groupBy(catalogItems.costGroupName)
    .orderBy(sql`MIN(${catalogItems.costCode})`);

  return result;
}

export async function getCatalogItemById(id: number): Promise<CatalogItem | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(catalogItems)
    .where(eq(catalogItems.id, id))
    .limit(1);

  return result[0];
}

export async function getCatalogStats() {
  const db = await getDb();
  if (!db) return { totalItems: 0, totalGroups: 0, avgMargin: 0 };

  const [stats] = await db
    .select({
      totalItems: sql<number>`COUNT(*)`,
      totalGroups: sql<number>`COUNT(DISTINCT ${catalogItems.costGroupName})`,
      avgMargin: sql<number>`AVG(CASE WHEN ${catalogItems.unitPrice} > 0 THEN ((${catalogItems.unitPrice} - ${catalogItems.unitCost}) / ${catalogItems.unitPrice}) * 100 ELSE 0 END)`,
    })
    .from(catalogItems)
    .where(eq(catalogItems.isActive, true));

  return stats;
}

// ── Bundle Queries ──────────────────────────────────────────────

export async function createBundle(data: {
  name: string;
  description?: string | null;
  channel?: "direct" | "insurance" | "commercial";
  defaultDiscount?: string;
  createdBy?: number;
}): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(bundles).values({
    name: data.name,
    description: data.description ?? null,
    channel: data.channel ?? "direct",
    defaultDiscount: data.defaultDiscount ?? "8.00",
    createdBy: data.createdBy ?? null,
  }).$returningId();

  const [bundle] = await db.select().from(bundles).where(eq(bundles.id, result.id)).limit(1);
  return bundle;
}

export async function getBundleById(id: number): Promise<(Bundle & { items: (BundleItem & { catalogItem: CatalogItem | null })[] }) | null> {
  const db = await getDb();
  if (!db) return null;

  const [bundle] = await db.select().from(bundles).where(eq(bundles.id, id)).limit(1);
  if (!bundle) return null;

  const items = await db
    .select()
    .from(bundleItems)
    .where(eq(bundleItems.bundleId, id))
    .orderBy(asc(bundleItems.sortOrder), asc(bundleItems.id));

  // Fetch catalog items for each bundle item
  const catalogItemIds = Array.from(new Set(items.map(i => i.catalogItemId)));
  let catalogMap: Map<number, CatalogItem> = new Map();
  if (catalogItemIds.length > 0) {
    const catalogRows = await db
      .select()
      .from(catalogItems)
      .where(sql`${catalogItems.id} IN (${sql.join(catalogItemIds.map(id => sql`${id}`), sql`, `)})`);
    catalogMap = new Map(catalogRows.map(c => [c.id, c]));
  }

  const enrichedItems = items.map(item => ({
    ...item,
    catalogItem: catalogMap.get(item.catalogItemId) ?? null,
  }));

  return { ...bundle, items: enrichedItems };
}

export async function listBundles(opts?: { createdBy?: number; activeOnly?: boolean; presetsOnly?: boolean }): Promise<Bundle[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts?.activeOnly !== false) {
    conditions.push(eq(bundles.isActive, true));
  }
  if (opts?.createdBy) {
    conditions.push(eq(bundles.createdBy, opts.createdBy));
  }
  // Filter: presets only vs working bundles only
  if (opts?.presetsOnly === true) {
    conditions.push(eq(bundles.isPreset, true));
  } else if (opts?.presetsOnly === false) {
    conditions.push(eq(bundles.isPreset, false));
  }

  const query = db.select().from(bundles).orderBy(desc(bundles.updatedAt));

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function updateBundleMeta(id: number, data: {
  name?: string;
  description?: string | null;
  channel?: "direct" | "insurance" | "commercial";
  defaultDiscount?: string;
  isPreset?: boolean;
  presetCategory?: string | null;
  presetTags?: string[] | null;
}): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.description !== undefined) updateSet.description = data.description;
  if (data.channel !== undefined) updateSet.channel = data.channel;
  if (data.defaultDiscount !== undefined) updateSet.defaultDiscount = data.defaultDiscount;
  if (data.isPreset !== undefined) updateSet.isPreset = data.isPreset;
  if (data.presetCategory !== undefined) updateSet.presetCategory = data.presetCategory;
  if (data.presetTags !== undefined) updateSet.presetTags = data.presetTags;

  if (Object.keys(updateSet).length > 0) {
    await db.update(bundles).set(updateSet).where(eq(bundles.id, id));
  }

  const [bundle] = await db.select().from(bundles).where(eq(bundles.id, id)).limit(1);
  if (!bundle) throw new Error(`Bundle ${id} not found`);
  return bundle;
}

export async function addItemToBundle(data: {
  bundleId: number;
  catalogItemId: number;
  quantity: number;
}): Promise<BundleItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get catalog item for snapshot
  const [catItem] = await db.select().from(catalogItems).where(eq(catalogItems.id, data.catalogItemId)).limit(1);
  if (!catItem) throw new Error(`Catalog item ${data.catalogItemId} not found`);

  const unitCost = parseFloat(catItem.unitCost);
  const unitPrice = parseFloat(catItem.unitPrice);
  const line = calcLineTotals(data.quantity, unitCost, unitPrice);

  // Get next sort order
  const [maxSort] = await db
    .select({ maxSort: sql<number>`COALESCE(MAX(${bundleItems.sortOrder}), 0)` })
    .from(bundleItems)
    .where(eq(bundleItems.bundleId, data.bundleId));

  const [result] = await db.insert(bundleItems).values({
    bundleId: data.bundleId,
    catalogItemId: data.catalogItemId,
    quantity: data.quantity.toFixed(2),
    unitCostSnapshot: unitCost.toFixed(2),
    unitPriceSnapshot: unitPrice.toFixed(2),
    lineTotalCost: line.lineTotalCost.toFixed(2),
    lineTotalPrice: line.lineTotalPrice.toFixed(2),
    sortOrder: (maxSort?.maxSort ?? 0) + 1,
  }).$returningId();

  // Recalculate bundle totals
  await recalculateBundleTotals(data.bundleId);

  const [item] = await db.select().from(bundleItems).where(eq(bundleItems.id, result.id)).limit(1);
  return item;
}

export async function updateBundleItemQuantity(bundleItemId: number, quantity: number): Promise<BundleItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [existing] = await db.select().from(bundleItems).where(eq(bundleItems.id, bundleItemId)).limit(1);
  if (!existing) throw new Error(`Bundle item ${bundleItemId} not found`);

  const unitCost = parseFloat(existing.unitCostSnapshot);
  const unitPrice = parseFloat(existing.unitPriceSnapshot);
  const line = calcLineTotals(quantity, unitCost, unitPrice);

  await db.update(bundleItems).set({
    quantity: quantity.toFixed(2),
    lineTotalCost: line.lineTotalCost.toFixed(2),
    lineTotalPrice: line.lineTotalPrice.toFixed(2),
  }).where(eq(bundleItems.id, bundleItemId));

  // Recalculate bundle totals
  await recalculateBundleTotals(existing.bundleId);

  const [updated] = await db.select().from(bundleItems).where(eq(bundleItems.id, bundleItemId)).limit(1);
  return updated;
}

export async function removeBundleItem(bundleItemId: number): Promise<{ bundleId: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [existing] = await db.select().from(bundleItems).where(eq(bundleItems.id, bundleItemId)).limit(1);
  if (!existing) throw new Error(`Bundle item ${bundleItemId} not found`);

  await db.delete(bundleItems).where(eq(bundleItems.id, bundleItemId));
  await recalculateBundleTotals(existing.bundleId);

  return { bundleId: existing.bundleId };
}

export async function recalculateBundleTotals(bundleId: number): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const items = await db.select().from(bundleItems).where(eq(bundleItems.bundleId, bundleId));

  const lineItems = items.map(i => ({
    quantity: parseFloat(i.quantity),
    unitCost: parseFloat(i.unitCostSnapshot),
    unitPrice: parseFloat(i.unitPriceSnapshot),
  }));

  const totals = calcBundleTotals(lineItems);

  await db.update(bundles).set({
    totalCost: totals.totalCost.toFixed(2),
    totalPrice: totals.totalPrice.toFixed(2),
    itemCount: totals.itemCount,
  }).where(eq(bundles.id, bundleId));

  const [bundle] = await db.select().from(bundles).where(eq(bundles.id, bundleId)).limit(1);
  return bundle;
}

export async function duplicateBundle(bundleId: number, newName: string, createdBy?: number): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const original = await getBundleById(bundleId);
  if (!original) throw new Error(`Bundle ${bundleId} not found`);

  // Create new bundle with same meta
  const [newBundleResult] = await db.insert(bundles).values({
    name: newName,
    description: original.description,
    channel: original.channel,
    defaultDiscount: original.defaultDiscount,
    totalCost: original.totalCost,
    totalPrice: original.totalPrice,
    itemCount: original.itemCount,
    createdBy: createdBy ?? original.createdBy,
  }).$returningId();

  // Copy all items
  if (original.items.length > 0) {
    const newItems = original.items.map(item => ({
      bundleId: newBundleResult.id,
      catalogItemId: item.catalogItemId,
      quantity: item.quantity,
      unitCostSnapshot: item.unitCostSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot,
      lineTotalCost: item.lineTotalCost,
      lineTotalPrice: item.lineTotalPrice,
      sortOrder: item.sortOrder,
    }));
    await db.insert(bundleItems).values(newItems);
  }

  const [newBundle] = await db.select().from(bundles).where(eq(bundles.id, newBundleResult.id)).limit(1);
  return newBundle;
}

export async function deleteBundle(bundleId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Soft delete: mark as inactive
  await db.update(bundles).set({ isActive: false }).where(eq(bundles.id, bundleId));
}

// ── Preset Bundle Queries ──────────────────────────────────────────

export async function createPresetFromBundle(bundleId: number, presetMeta: {
  presetCategory?: string | null;
  presetTags?: string[] | null;
  description?: string | null;
}, createdBy?: number): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const original = await getBundleById(bundleId);
  if (!original) throw new Error(`Bundle ${bundleId} not found`);

  // Create a new bundle marked as preset
  const [newBundleResult] = await db.insert(bundles).values({
    name: original.name,
    description: presetMeta.description ?? original.description,
    channel: original.channel,
    defaultDiscount: original.defaultDiscount,
    totalCost: original.totalCost,
    totalPrice: original.totalPrice,
    itemCount: original.itemCount,
    isPreset: true,
    presetCategory: presetMeta.presetCategory ?? null,
    presetTags: presetMeta.presetTags ?? null,
    createdBy: createdBy ?? original.createdBy,
  }).$returningId();

  // Copy all items
  if (original.items.length > 0) {
    const newItems = original.items.map(item => ({
      bundleId: newBundleResult.id,
      catalogItemId: item.catalogItemId,
      quantity: item.quantity,
      unitCostSnapshot: item.unitCostSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot,
      lineTotalCost: item.lineTotalCost,
      lineTotalPrice: item.lineTotalPrice,
      sortOrder: item.sortOrder,
    }));
    await db.insert(bundleItems).values(newItems);
  }

  const [preset] = await db.select().from(bundles).where(eq(bundles.id, newBundleResult.id)).limit(1);
  return preset;
}

export async function createBundleFromPreset(presetId: number, bundleName: string, createdBy?: number): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const preset = await getBundleById(presetId);
  if (!preset) throw new Error(`Preset ${presetId} not found`);
  if (!preset.isPreset) throw new Error(`Bundle ${presetId} is not a preset`);

  // Create a new working bundle from the preset
  const [newBundleResult] = await db.insert(bundles).values({
    name: bundleName,
    description: preset.description,
    channel: preset.channel,
    defaultDiscount: preset.defaultDiscount,
    totalCost: preset.totalCost,
    totalPrice: preset.totalPrice,
    itemCount: preset.itemCount,
    isPreset: false, // Working bundle, not a preset
    createdBy: createdBy ?? null,
  }).$returningId();

  // Copy all items with fresh snapshots from the current catalog prices
  if (preset.items.length > 0) {
    const newItems = preset.items.map(item => ({
      bundleId: newBundleResult.id,
      catalogItemId: item.catalogItemId,
      quantity: item.quantity,
      unitCostSnapshot: item.unitCostSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot,
      lineTotalCost: item.lineTotalCost,
      lineTotalPrice: item.lineTotalPrice,
      sortOrder: item.sortOrder,
    }));
    await db.insert(bundleItems).values(newItems);
  }

  const [newBundle] = await db.select().from(bundles).where(eq(bundles.id, newBundleResult.id)).limit(1);
  return newBundle;
}

export async function markBundleAsPreset(bundleId: number, presetMeta: {
  presetCategory?: string | null;
  presetTags?: string[] | null;
}): Promise<Bundle> {
  return updateBundleMeta(bundleId, {
    isPreset: true,
    presetCategory: presetMeta.presetCategory ?? null,
    presetTags: presetMeta.presetTags ?? null,
  });
}

export async function unmarkBundleAsPreset(bundleId: number): Promise<Bundle> {
  return updateBundleMeta(bundleId, {
    isPreset: false,
    presetCategory: null,
    presetTags: null,
  });
}

// ── Estimate Draft Queries ──────────────────────────────────────────

export async function createEstimateDraft(data: {
  bundleId: number;
  bundleName: string;
  channel?: "direct" | "insurance" | "commercial";
  lineItems: EstimateDraftLineItem[];
  subtotalCost: string;
  subtotalPrice: string;
  grossProfit: string;
  grossProfitPct: string;
  discountApplied: string;
  discountAmount: string;
  finalTotalPrice: string;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: number;
}): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(estimateDrafts).values({
    bundleId: data.bundleId,
    bundleName: data.bundleName,
    channel: data.channel ?? "direct",
    lineItems: data.lineItems,
    subtotalCost: data.subtotalCost,
    subtotalPrice: data.subtotalPrice,
    grossProfit: data.grossProfit,
    grossProfitPct: data.grossProfitPct,
    discountApplied: data.discountApplied,
    discountAmount: data.discountAmount,
    finalTotalPrice: data.finalTotalPrice,
    notes: data.notes ?? null,
    metadata: data.metadata ?? null,
    status: "draft",
    createdBy: data.createdBy ?? null,
  }).$returningId();

  const [draft] = await db.select().from(estimateDrafts).where(eq(estimateDrafts.id, result.id)).limit(1);
  return draft;
}

export async function getEstimateDraftById(id: number): Promise<EstimateDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [draft] = await db.select().from(estimateDrafts).where(eq(estimateDrafts.id, id)).limit(1);
  return draft ?? null;
}

export async function listEstimateDrafts(opts?: { createdBy?: number; status?: string }): Promise<EstimateDraft[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts?.createdBy) {
    conditions.push(eq(estimateDrafts.createdBy, opts.createdBy));
  }
  if (opts?.status) {
    conditions.push(eq(estimateDrafts.status, opts.status as "draft" | "sent_to_estimate" | "converted" | "archived"));
  }

  const query = db.select().from(estimateDrafts).orderBy(desc(estimateDrafts.updatedAt));

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}
