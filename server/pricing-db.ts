/**
 * structr.ai v9 — Pricing Database Helpers
 * Sprint 6 Phase 5: Master Pricing Architecture
 *
 * Provides:
 *   - Price Book CRUD with history tracking
 *   - Regional modifier queries
 *   - Channel multiplier queries
 *   - Finish level queries
 *   - Parametric model queries
 *   - Template queries (remodel + new construction)
 */

import { eq, like, or, sql, asc, and, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { logAudit } from "./audit";
import {
  priceBookItems,
  priceBookHistory,
  regionalModifiers,
  channelMultipliers,
  finishLevels,
  parametricModels,
  remodelTemplates,
  newconTemplates,
  type PriceBookItem,
  type InsertPriceBookItem,
  type PriceBookHistoryEntry,
  type RegionalModifier,
  type ChannelMultiplier,
  type FinishLevel,
  type ParametricModel,
  type RemodelTemplate,
  type NewconTemplate,
} from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// PRICE BOOK ITEMS — CRUD with History Tracking
// ══════════════════════════════════════════════════════════════════════

export async function listPriceBookItems(opts?: {
  category?: string;
  trade?: string;
  itemType?: string;
  finishLevel?: string;
  channel?: string;
  region?: string;
  search?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: PriceBookItem[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  if (opts?.activeOnly !== false) {
    conditions.push(eq(priceBookItems.isActive, true));
  }
  if (opts?.category) {
    conditions.push(eq(priceBookItems.category, opts.category));
  }
  if (opts?.trade) {
    conditions.push(eq(priceBookItems.trade, opts.trade));
  }
  if (opts?.itemType) {
    conditions.push(eq(priceBookItems.itemType, opts.itemType as any));
  }
  if (opts?.finishLevel) {
    conditions.push(eq(priceBookItems.finishLevel, opts.finishLevel as any));
  }
  if (opts?.channel) {
    conditions.push(eq(priceBookItems.channel, opts.channel as any));
  }
  if (opts?.region) {
    conditions.push(eq(priceBookItems.region, opts.region));
  }
  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(priceBookItems.name, pattern),
        like(priceBookItems.description, pattern),
        like(priceBookItems.sku, pattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(priceBookItems)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Get paginated results
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(priceBookItems)
    .orderBy(asc(priceBookItems.category), asc(priceBookItems.name))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;
  return { items, total };
}

export async function getPriceBookItemById(id: number): Promise<PriceBookItem | null> {
  const db = await getDb();
  if (!db) return null;

  const [item] = await db
    .select()
    .from(priceBookItems)
    .where(eq(priceBookItems.id, id))
    .limit(1);

  return item ?? null;
}

export async function getPriceBookItemBySku(sku: string): Promise<PriceBookItem | null> {
  const db = await getDb();
  if (!db) return null;

  const [item] = await db
    .select()
    .from(priceBookItems)
    .where(eq(priceBookItems.sku, sku))
    .limit(1);

  return item ?? null;
}

export async function getPriceBookItemsByIds(ids: number[]): Promise<PriceBookItem[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];

  return db
    .select()
    .from(priceBookItems)
    .where(inArray(priceBookItems.id, ids));
}

export async function getPriceBookCategories(): Promise<{ category: string; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      category: priceBookItems.category,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(priceBookItems)
    .where(eq(priceBookItems.isActive, true))
    .groupBy(priceBookItems.category)
    .orderBy(asc(priceBookItems.category));
}

export async function getPriceBookTrades(): Promise<{ trade: string | null; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      trade: priceBookItems.trade,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(priceBookItems)
    .where(eq(priceBookItems.isActive, true))
    .groupBy(priceBookItems.trade)
    .orderBy(asc(priceBookItems.trade));
}

export async function getPriceBookStats(): Promise<{
  totalItems: number;
  totalCategories: number;
  totalTrades: number;
  avgCost: number;
  avgPrice: number;
  avgMargin: number;
  totalCostValue: number;
  totalPriceValue: number;
}> {
  const db = await getDb();
  if (!db) return {
    totalItems: 0, totalCategories: 0, totalTrades: 0,
    avgCost: 0, avgPrice: 0, avgMargin: 0,
    totalCostValue: 0, totalPriceValue: 0,
  };

  const [stats] = await db
    .select({
      totalItems: sql<number>`COUNT(*)`,
      totalCategories: sql<number>`COUNT(DISTINCT ${priceBookItems.category})`,
      totalTrades: sql<number>`COUNT(DISTINCT ${priceBookItems.trade})`,
      avgCost: sql<number>`AVG(${priceBookItems.unitCost})`,
      avgPrice: sql<number>`AVG(${priceBookItems.unitPrice})`,
      avgMargin: sql<number>`AVG(CASE WHEN ${priceBookItems.unitPrice} > 0 THEN ((${priceBookItems.unitPrice} - ${priceBookItems.unitCost}) / ${priceBookItems.unitPrice}) * 100 ELSE 0 END)`,
      totalCostValue: sql<number>`SUM(${priceBookItems.unitCost})`,
      totalPriceValue: sql<number>`SUM(${priceBookItems.unitPrice})`,
    })
    .from(priceBookItems)
    .where(eq(priceBookItems.isActive, true));

  return stats;
}

/**
 * Update a price book item with automatic history tracking.
 * Records old/new cost and price in price_book_history.
 */
export async function updatePriceBookItem(
  id: number,
  data: Partial<Pick<PriceBookItem,
    "name" | "description" | "unitCost" | "unitPrice" | "category" | "subcategory" |
    "unitOfMeasure" | "isAdminFee" | "isActive" | "itemType" | "trade" |
    "finishLevel" | "channel" | "region" | "wasteFactor" | "coastalModifier" |
    "channelMultiplier" | "source" | "effectiveDate" | "costCode" | "costType" | "taxable"
  >>,
  changedBy?: number,
  reason?: string
): Promise<PriceBookItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get current state for history
  const [current] = await db
    .select()
    .from(priceBookItems)
    .where(eq(priceBookItems.id, id))
    .limit(1);

  if (!current) throw new Error(`Price book item ${id} not found`);

  // Track price changes in history
  const costChanged = data.unitCost !== undefined && data.unitCost !== current.unitCost;
  const priceChanged = data.unitPrice !== undefined && data.unitPrice !== current.unitPrice;

  if (costChanged || priceChanged) {
    await db.insert(priceBookHistory).values({
      priceBookItemId: id,
      oldUnitCost: current.unitCost,
      newUnitCost: data.unitCost ?? current.unitCost,
      oldUnitPrice: current.unitPrice,
      newUnitPrice: data.unitPrice ?? current.unitPrice,
      changedBy: changedBy ?? null,
      reason: reason ?? null,
    });

    // Update lastCostUpdatedAt when cost changes
    if (costChanged) {
      (data as any).lastCostUpdatedAt = new Date();
    }
  }

  // Build update set (only include defined fields)
  const updateSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updateSet[key] = value;
    }
  }

  if (Object.keys(updateSet).length > 0) {
    await db.update(priceBookItems).set(updateSet).where(eq(priceBookItems.id, id));
  }

  const [updated] = await db
    .select()
    .from(priceBookItems)
    .where(eq(priceBookItems.id, id))
    .limit(1);

  logAudit({
    userId: changedBy ?? null,
    action: "update",
    tableName: "price_book_items",
    recordId: id,
    before: current,
    after: updated,
  }).catch(() => {});

  return updated;
}

/**
 * Create a new price book item with initial history entry.
 */
export async function createPriceBookItem(
  data: Omit<InsertPriceBookItem, "id" | "createdAt" | "updatedAt">,
  changedBy?: number
): Promise<PriceBookItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(priceBookItems).values(data).$returningId();

  // Record initial history entry
  await db.insert(priceBookHistory).values({
    priceBookItemId: result.id,
    oldUnitCost: "0.0000",
    newUnitCost: data.unitCost,
    oldUnitPrice: "0.0000",
    newUnitPrice: data.unitPrice,
    changedBy: changedBy ?? null,
    reason: "Initial creation",
  });

  const [item] = await db
    .select()
    .from(priceBookItems)
    .where(eq(priceBookItems.id, result.id))
    .limit(1);

  logAudit({
    userId: changedBy ?? null,
    action: "create",
    tableName: "price_book_items",
    recordId: item.id,
    before: null,
    after: item,
  }).catch(() => {});

  return item;
}

/**
 * Soft-delete a price book item.
 */
export async function deactivatePriceBookItem(id: number, userId?: number | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(priceBookItems).where(eq(priceBookItems.id, id)).limit(1);

  await db.update(priceBookItems).set({
    isActive: false,
    deletedAt: new Date(),
  }).where(eq(priceBookItems.id, id));

  logAudit({
    userId: userId ?? null,
    action: "deactivate",
    tableName: "price_book_items",
    recordId: id,
    before,
    after: { ...before, isActive: false, deletedAt: new Date() },
  }).catch(() => {});
}

/**
 * Get price history for a specific item.
 */
export async function getPriceBookHistory(
  priceBookItemId: number,
  opts?: { limit?: number; offset?: number }
): Promise<{ entries: PriceBookHistoryEntry[]; total: number }> {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(priceBookHistory)
    .where(eq(priceBookHistory.priceBookItemId, priceBookItemId));

  const total = countResult?.count ?? 0;

  const entries = await db
    .select()
    .from(priceBookHistory)
    .where(eq(priceBookHistory.priceBookItemId, priceBookItemId))
    .orderBy(desc(priceBookHistory.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { entries, total };
}

// ══════════════════════════════════════════════════════════════════════
// REGIONAL MODIFIERS
// ══════════════════════════════════════════════════════════════════════

export async function listRegionalModifiers(activeOnly = true): Promise<RegionalModifier[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (activeOnly) conditions.push(eq(regionalModifiers.isActive, true));

  const query = db.select().from(regionalModifiers).orderBy(asc(regionalModifiers.regionName));
  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getRegionalModifier(regionCode: string): Promise<RegionalModifier | null> {
  const db = await getDb();
  if (!db) return null;

  const [mod] = await db
    .select()
    .from(regionalModifiers)
    .where(eq(regionalModifiers.regionCode, regionCode))
    .limit(1);

  return mod ?? null;
}

export async function updateRegionalModifier(
  id: number,
  data: Partial<Pick<RegionalModifier,
    "regionName" | "costModifier" | "laborModifier" | "materialModifier" | "permitModifier" | "description" | "isActive"
  >>
): Promise<RegionalModifier> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) updateSet[key] = value;
  }

  if (Object.keys(updateSet).length > 0) {
    await db.update(regionalModifiers).set(updateSet).where(eq(regionalModifiers.id, id));
  }

  const [updated] = await db
    .select()
    .from(regionalModifiers)
    .where(eq(regionalModifiers.id, id))
    .limit(1);

  if (!updated) throw new Error(`Regional modifier ${id} not found`);
  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// CHANNEL MULTIPLIERS
// ══════════════════════════════════════════════════════════════════════

export async function listChannelMultipliers(activeOnly = true): Promise<ChannelMultiplier[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (activeOnly) conditions.push(eq(channelMultipliers.isActive, true));

  const query = db.select().from(channelMultipliers).orderBy(asc(channelMultipliers.channel));
  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getChannelMultiplier(
  channel: "direct" | "insurance" | "commercial",
  trade?: string
): Promise<ChannelMultiplier | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions = [
    eq(channelMultipliers.channel, channel),
    eq(channelMultipliers.isActive, true),
  ];

  // Try trade-specific first, then fallback to generic (trade = null)
  if (trade) {
    const [specific] = await db
      .select()
      .from(channelMultipliers)
      .where(and(...conditions, eq(channelMultipliers.trade, trade)))
      .limit(1);

    if (specific) return specific;
  }

  // Fallback: generic multiplier for this channel (no trade)
  const [generic] = await db
    .select()
    .from(channelMultipliers)
    .where(and(...conditions, sql`${channelMultipliers.trade} IS NULL`))
    .limit(1);

  return generic ?? null;
}

export async function updateChannelMultiplier(
  id: number,
  data: Partial<Pick<ChannelMultiplier,
    "costMultiplier" | "priceMultiplier" | "description" | "isActive"
  >>
): Promise<ChannelMultiplier> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) updateSet[key] = value;
  }

  if (Object.keys(updateSet).length > 0) {
    await db.update(channelMultipliers).set(updateSet).where(eq(channelMultipliers.id, id));
  }

  const [updated] = await db
    .select()
    .from(channelMultipliers)
    .where(eq(channelMultipliers.id, id))
    .limit(1);

  if (!updated) throw new Error(`Channel multiplier ${id} not found`);
  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// FINISH LEVELS
// ══════════════════════════════════════════════════════════════════════

export async function listFinishLevels(activeOnly = true): Promise<FinishLevel[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (activeOnly) conditions.push(eq(finishLevels.isActive, true));

  const query = db.select().from(finishLevels).orderBy(asc(finishLevels.level));
  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getFinishLevel(
  level: "standard" | "premium" | "luxury",
  trade?: string
): Promise<FinishLevel | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions = [
    eq(finishLevels.level, level),
    eq(finishLevels.isActive, true),
  ];

  // Try trade-specific first, then fallback to generic
  if (trade) {
    const [specific] = await db
      .select()
      .from(finishLevels)
      .where(and(...conditions, eq(finishLevels.trade, trade)))
      .limit(1);

    if (specific) return specific;
  }

  // Fallback: generic finish level (no trade)
  const [generic] = await db
    .select()
    .from(finishLevels)
    .where(and(...conditions, sql`${finishLevels.trade} IS NULL`))
    .limit(1);

  return generic ?? null;
}

export async function updateFinishLevel(
  id: number,
  data: Partial<Pick<FinishLevel,
    "priceMultiplier" | "description" | "isActive"
  >>
): Promise<FinishLevel> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) updateSet[key] = value;
  }

  if (Object.keys(updateSet).length > 0) {
    await db.update(finishLevels).set(updateSet).where(eq(finishLevels.id, id));
  }

  const [updated] = await db
    .select()
    .from(finishLevels)
    .where(eq(finishLevels.id, id))
    .limit(1);

  if (!updated) throw new Error(`Finish level ${id} not found`);
  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// PARAMETRIC MODELS
// ══════════════════════════════════════════════════════════════════════

export async function listParametricModels(activeOnly = true): Promise<ParametricModel[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (activeOnly) conditions.push(eq(parametricModels.isActive, true));

  const query = db.select().from(parametricModels).orderBy(asc(parametricModels.name));
  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getParametricModel(id: number): Promise<ParametricModel | null> {
  const db = await getDb();
  if (!db) return null;

  const [model] = await db
    .select()
    .from(parametricModels)
    .where(eq(parametricModels.id, id))
    .limit(1);

  return model ?? null;
}

export async function getParametricModelByType(
  structureType: "adu" | "one_story" | "two_story" | "two_story_terrace" | "shell"
): Promise<ParametricModel | null> {
  const db = await getDb();
  if (!db) return null;

  const [model] = await db
    .select()
    .from(parametricModels)
    .where(and(
      eq(parametricModels.structureType, structureType),
      eq(parametricModels.isActive, true),
    ))
    .limit(1);

  return model ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// REMODEL TEMPLATES
// ══════════════════════════════════════════════════════════════════════

export async function listRemodelTemplates(activeOnly = true): Promise<RemodelTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (activeOnly) conditions.push(eq(remodelTemplates.isActive, true));

  const query = db.select().from(remodelTemplates).orderBy(asc(remodelTemplates.name));
  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getRemodelTemplate(id: number): Promise<RemodelTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(remodelTemplates)
    .where(eq(remodelTemplates.id, id))
    .limit(1);

  return template ?? null;
}

export async function getRemodelTemplateByType(
  serviceType: string
): Promise<RemodelTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(remodelTemplates)
    .where(and(
      eq(remodelTemplates.serviceType, serviceType as any),
      eq(remodelTemplates.isActive, true),
    ))
    .limit(1);

  return template ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// NEW CONSTRUCTION TEMPLATES
// ══════════════════════════════════════════════════════════════════════

export async function listNewconTemplates(activeOnly = true): Promise<NewconTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (activeOnly) conditions.push(eq(newconTemplates.isActive, true));

  const query = db.select().from(newconTemplates).orderBy(asc(newconTemplates.name));
  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getNewconTemplate(id: number): Promise<NewconTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(newconTemplates)
    .where(eq(newconTemplates.id, id))
    .limit(1);

  return template ?? null;
}

export async function getNewconTemplateByType(
  structureType: "adu" | "one_story" | "two_story" | "two_story_terrace" | "shell"
): Promise<NewconTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(newconTemplates)
    .where(and(
      eq(newconTemplates.structureType, structureType),
      eq(newconTemplates.isActive, true),
    ))
    .limit(1);

  return template ?? null;
}
