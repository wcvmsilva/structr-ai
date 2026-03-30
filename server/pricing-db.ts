/**
 * structr.ai — Pricing Database Helpers
 * Aligned with Supabase schema (source of truth)
 *
 * Provides:
 *   - Cost Code Pricing History CRUD
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
  costCodePricingHistory,
  regionalModifiers,
  channelMultipliers,
  finishLevels,
  parametricModels,
  remodelTemplates,
  newconTemplates,
  type CostCodePricingHistory,
  type InsertCostCodePricingHistory,
  type RegionalModifier,
  type ChannelMultiplier,
  type FinishLevel,
  type ParametricModel,
  type RemodelTemplate,
  type NewconTemplate,
} from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// COST CODE PRICING HISTORY — CRUD
// Schema: id, costCodeId, unitId, unitCost, unitPrice, source, notes,
//         effectiveDate, expirationDate, isActive, createdAt, updatedBy,
//         unitCostMaterial, unitCostLabor, taxable
// ══════════════════════════════════════════════════════════════════════

export async function listCostCodePricingHistorys(opts?: {
  costCodeId?: string;
  source?: string;
  search?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: CostCodePricingHistory[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  if (opts?.activeOnly !== false) {
    conditions.push(eq(costCodePricingHistory.isActive, true));
  }
  if (opts?.costCodeId) {
    conditions.push(eq(costCodePricingHistory.costCodeId, opts.costCodeId));
  }
  if (opts?.source) {
    conditions.push(eq(costCodePricingHistory.source, opts.source));
  }
  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(costCodePricingHistory.notes, pattern),
        like(costCodePricingHistory.source, pattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(costCodePricingHistory)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Get paginated results
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(costCodePricingHistory)
    .orderBy(desc(costCodePricingHistory.effectiveDate), desc(costCodePricingHistory.createdAt))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;
  return { items, total };
}

export async function getCostCodePricingHistoryById(id: string): Promise<CostCodePricingHistory | null> {
  const db = await getDb();
  if (!db) return null;

  const [item] = await db
    .select()
    .from(costCodePricingHistory)
    .where(eq(costCodePricingHistory.id, id))
    .limit(1);

  return item ?? null;
}

export async function getCostCodePricingHistorysByIds(ids: string[]): Promise<CostCodePricingHistory[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];

  return db
    .select()
    .from(costCodePricingHistory)
    .where(inArray(costCodePricingHistory.id, ids));
}

export async function getLatestPricingForCostCode(costCodeId: string): Promise<CostCodePricingHistory | null> {
  const db = await getDb();
  if (!db) return null;

  const [item] = await db
    .select()
    .from(costCodePricingHistory)
    .where(and(
      eq(costCodePricingHistory.costCodeId, costCodeId),
      eq(costCodePricingHistory.isActive, true),
    ))
    .orderBy(desc(costCodePricingHistory.effectiveDate))
    .limit(1);

  return item ?? null;
}

export async function getPriceBookStats(): Promise<{
  totalItems: number;
  avgCost: number;
  avgPrice: number;
}> {
  const db = await getDb();
  if (!db) return { totalItems: 0, avgCost: 0, avgPrice: 0 };

  const [stats] = await db
    .select({
      totalItems: sql<number>`COUNT(*)`,
      avgCost: sql<number>`COALESCE(AVG(CAST(${costCodePricingHistory.unitCost} AS numeric)), 0)`,
      avgPrice: sql<number>`COALESCE(AVG(CAST(${costCodePricingHistory.unitPrice} AS numeric)), 0)`,
    })
    .from(costCodePricingHistory)
    .where(eq(costCodePricingHistory.isActive, true));

  return stats;
}

/**
 * Create a new pricing history record for a cost code.
 */
export async function createCostCodePricingHistory(
  data: Omit<InsertCostCodePricingHistory, "id" | "createdAt">,
  userId?: string
): Promise<CostCodePricingHistory> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [item] = await db.insert(costCodePricingHistory).values({
    ...data,
    updatedBy: userId ?? null,
  }).returning();

  logAudit({
    userId: userId ?? null,
    action: "create",
    tableName: "cost_code_pricing_history",
    recordId: item.id,
    before: null,
    after: item,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return item;
}

/**
 * Update a pricing history record.
 */
export async function updateCostCodePricingHistory(
  id: string,
  data: Partial<Pick<CostCodePricingHistory,
    "unitCost" | "unitPrice" | "unitCostMaterial" | "unitCostLabor" |
    "source" | "notes" | "effectiveDate" | "expirationDate" | "isActive" | "taxable"
  >>,
  userId?: string
): Promise<CostCodePricingHistory> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [current] = await db
    .select()
    .from(costCodePricingHistory)
    .where(eq(costCodePricingHistory.id, id))
    .limit(1);

  if (!current) throw new Error(`Pricing record ${id} not found`);

  const updateSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updateSet[key] = value;
    }
  }
  if (userId) updateSet.updatedBy = userId;

  if (Object.keys(updateSet).length > 0) {
    await db.update(costCodePricingHistory).set(updateSet).where(eq(costCodePricingHistory.id, id));
  }

  const [updated] = await db
    .select()
    .from(costCodePricingHistory)
    .where(eq(costCodePricingHistory.id, id))
    .limit(1);

  logAudit({
    userId: userId ?? null,
    action: "update",
    tableName: "cost_code_pricing_history",
    recordId: id,
    before: current,
    after: updated,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return updated;
}

/**
 * Soft-delete a pricing record.
 */
export async function deactivateCostCodePricingHistory(id: string, userId?: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(costCodePricingHistory).where(eq(costCodePricingHistory.id, id)).limit(1);

  await db.update(costCodePricingHistory).set({
    isActive: false,
  }).where(eq(costCodePricingHistory.id, id));

  logAudit({
    userId: userId ?? null,
    action: "deactivate",
    tableName: "cost_code_pricing_history",
    recordId: id,
    before,
    after: { ...before, isActive: false },
  }).catch((err) => console.error("[Audit] write failed:", err.message));
}

/**
 * Get price history for a specific cost code.
 */
export async function getPriceBookHistory(
  costCodeId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ entries: CostCodePricingHistory[]; total: number }> {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(costCodePricingHistory)
    .where(eq(costCodePricingHistory.costCodeId, costCodeId));

  const total = countResult?.count ?? 0;

  const entries = await db
    .select()
    .from(costCodePricingHistory)
    .where(eq(costCodePricingHistory.costCodeId, costCodeId))
    .orderBy(desc(costCodePricingHistory.effectiveDate))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return { entries, total };
}

// ══════════════════════════════════════════════════════════════════════
// REGIONAL MODIFIERS
// Schema: id, region, category, multiplier, notes, isActive, createdAt, updatedAt
// ══════════════════════════════════════════════════════════════════════

export async function listRegionalModifiers(activeOnly = true): Promise<RegionalModifier[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (activeOnly) conditions.push(eq(regionalModifiers.isActive, true));

  const query = db.select().from(regionalModifiers).orderBy(asc(regionalModifiers.region));
  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getRegionalModifier(region: string): Promise<RegionalModifier | null> {
  const db = await getDb();
  if (!db) return null;

  const [mod] = await db
    .select()
    .from(regionalModifiers)
    .where(eq(regionalModifiers.region, region))
    .limit(1);

  return mod ?? null;
}

export async function updateRegionalModifier(
  id: string,
  data: Partial<Pick<RegionalModifier, "region" | "category" | "multiplier" | "notes" | "isActive">>
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
// Schema: id, channel, multiplier, notes, isActive, createdAt, updatedAt
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

export async function getChannelMultiplier(channel: string): Promise<ChannelMultiplier | null> {
  const db = await getDb();
  if (!db) return null;

  const [mod] = await db
    .select()
    .from(channelMultipliers)
    .where(and(
      eq(channelMultipliers.channel, channel),
      eq(channelMultipliers.isActive, true),
    ))
    .limit(1);

  return mod ?? null;
}

export async function updateChannelMultiplier(
  id: string,
  data: Partial<Pick<ChannelMultiplier, "channel" | "multiplier" | "notes" | "isActive">>
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
// Schema: id, level, trade, multiplier, description, isActive, createdAt, updatedAt
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
  level: string,
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
  id: string,
  data: Partial<Pick<FinishLevel, "multiplier" | "description" | "isActive">>
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
// Schema: id, name, description, modelType, formula, variables, isActive, createdAt, updatedAt
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

export async function getParametricModel(id: string): Promise<ParametricModel | null> {
  const db = await getDb();
  if (!db) return null;

  const [model] = await db
    .select()
    .from(parametricModels)
    .where(eq(parametricModels.id, id))
    .limit(1);

  return model ?? null;
}

export async function getParametricModelByType(modelType: string): Promise<ParametricModel | null> {
  const db = await getDb();
  if (!db) return null;

  const [model] = await db
    .select()
    .from(parametricModels)
    .where(and(
      eq(parametricModels.modelType, modelType),
      eq(parametricModels.isActive, true),
    ))
    .limit(1);

  return model ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// REMODEL TEMPLATES
// Schema: id, name, category, description, scopeJson, defaultFinishLevel, isActive, createdAt, updatedAt
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

export async function getRemodelTemplate(id: string): Promise<RemodelTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(remodelTemplates)
    .where(eq(remodelTemplates.id, id))
    .limit(1);

  return template ?? null;
}

export async function getRemodelTemplateByCategory(category: string): Promise<RemodelTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(remodelTemplates)
    .where(and(
      eq(remodelTemplates.category, category),
      eq(remodelTemplates.isActive, true),
    ))
    .limit(1);

  return template ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// NEW CONSTRUCTION TEMPLATES
// Schema: id, name, category, description, scopeJson, defaultFinishLevel, isActive, createdAt, updatedAt
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

export async function getNewconTemplate(id: string): Promise<NewconTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(newconTemplates)
    .where(eq(newconTemplates.id, id))
    .limit(1);

  return template ?? null;
}

export async function getNewconTemplateByCategory(category: string): Promise<NewconTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(newconTemplates)
    .where(and(
      eq(newconTemplates.category, category),
      eq(newconTemplates.isActive, true),
    ))
    .limit(1);

  return template ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// COMPATIBILITY ALIASES (old function names for router compatibility)
// TODO: Update pricing-router.ts to use the new function names
// ══════════════════════════════════════════════════════════════════════

export const listPriceBookItems = listCostCodePricingHistorys;
export const getPriceBookItemById = getCostCodePricingHistoryById;
export const getPriceBookItemsByIds = getCostCodePricingHistorysByIds;
export const updatePriceBookItem = updateCostCodePricingHistory;
export const createPriceBookItem = createCostCodePricingHistory;
export const deactivatePriceBookItem = deactivateCostCodePricingHistory;

// Stub functions for removed features (schema no longer has these fields)
export async function getPriceBookItemBySku(_sku: string) { return null; }
export async function getPriceBookCategories() { return []; }
export async function getPriceBookTrades() { return []; }

// Template aliases (old names used by pricing-router.ts)
export const getRemodelTemplateByType = getRemodelTemplateByCategory;
export const getNewconTemplateByType = getNewconTemplateByCategory;
