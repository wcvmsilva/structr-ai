/**
 * structr.ai — Assembly Database Helpers
 * Aligned with Supabase schema (source of truth)
 *
 * Schema:
 * - assemblies: id, name, description, category, defaultUnitId, baseUnitQty, wasteFactor, region, isActive, createdAt, updatedAt
 * - assemblyItems: id, assemblyId, costCodeId, costTypeId, unitId, description, defaultQtyPerUnit, wasteFactor, isOptional, sortOrder, createdAt, updatedAt
 *
 * Provides:
 *   - Assembly CRUD
 *   - Component management (add/remove/list)
 *   - Clone support
 *   - Filtered listing by category, region
 *   - Full BOM retrieval with cost code join
 */

import { eq, like, or, sql, asc, and, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  assemblies,
  assemblyItems,
  costCodes,
  type Assembly,
  type InsertAssembly,
  type AssemblyItem,
  type InsertAssemblyItem,
  type CostCode,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Assembly with its full component list (BOM) */
export interface AssemblyWithComponents extends Assembly {
  components: AssemblyItemWithCostCode[];
}

/** Component with joined cost code data */
export interface AssemblyItemWithCostCode extends AssemblyItem {
  costCode: CostCode | null;
}

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLIES — CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * List assemblies with optional filters.
 */
export async function listAssemblies(opts?: {
  category?: string;
  region?: string;
  activeOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Assembly[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  if (opts?.activeOnly !== false) {
    conditions.push(eq(assemblies.isActive, true));
  }
  if (opts?.category) {
    conditions.push(eq(assemblies.category, opts.category));
  }
  if (opts?.region) {
    conditions.push(eq(assemblies.region, opts.region));
  }
  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(assemblies.name, pattern),
        like(assemblies.description, pattern),
        like(assemblies.category, pattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(assemblies)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Get paginated results
  const limit = opts?.limit ?? 200;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(assemblies)
    .orderBy(asc(assemblies.category), asc(assemblies.name))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;
  return { items, total };
}

/**
 * Get a single assembly by ID with its full component list (BOM).
 */
export async function getAssemblyById(id: string): Promise<AssemblyWithComponents | null> {
  const db = await getDb();
  if (!db) return null;

  const [assembly] = await db
    .select()
    .from(assemblies)
    .where(eq(assemblies.id, id))
    .limit(1);

  if (!assembly) return null;

  const components = await getComponentsForAssembly(id);

  return { ...assembly, components };
}

/**
 * Get assemblies filtered by category.
 */
export async function getAssembliesByCategory(category: string): Promise<Assembly[]> {
  const { items } = await listAssemblies({ category });
  return items;
}

/**
 * Create a new assembly.
 */
export async function createAssembly(
  data: Omit<InsertAssembly, "id" | "createdAt" | "updatedAt">
): Promise<Assembly> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [assembly] = await db.insert(assemblies).values(data).returning();

  logAudit({
    action: "create",
    tableName: "assemblies",
    recordId: assembly.id,
    before: null,
    after: assembly,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return assembly;
}

/**
 * Update an assembly.
 */
export async function updateAssembly(
  id: string,
  data: Partial<Pick<Assembly,
    "name" | "description" | "category" | "defaultUnitId" | "baseUnitQty" |
    "wasteFactor" | "region" | "isActive"
  >>
): Promise<Assembly> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [current] = await db
    .select()
    .from(assemblies)
    .where(eq(assemblies.id, id))
    .limit(1);

  if (!current) throw new Error(`Assembly ${id} not found`);

  const updateSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updateSet[key] = value;
    }
  }

  if (Object.keys(updateSet).length > 0) {
    await db.update(assemblies).set(updateSet).where(eq(assemblies.id, id));
  }

  const [updated] = await db
    .select()
    .from(assemblies)
    .where(eq(assemblies.id, id))
    .limit(1);

  logAudit({
    action: "update",
    tableName: "assemblies",
    recordId: id,
    before: current,
    after: updated,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return updated;
}

/**
 * Soft-delete an assembly (mark inactive).
 */
export async function deleteAssembly(id: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);

  await db.update(assemblies).set({ isActive: false }).where(eq(assemblies.id, id));

  logAudit({
    action: "delete",
    tableName: "assemblies",
    recordId: id,
    before,
    after: { ...before, isActive: false },
  }).catch((err) => console.error("[Audit] write failed:", err.message));
}

/**
 * Clone an assembly with all its components.
 */
export async function cloneAssembly(
  sourceId: string,
  overrides?: { name?: string; region?: string }
): Promise<AssemblyWithComponents> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const source = await getAssemblyById(sourceId);
  if (!source) throw new Error(`Source assembly ${sourceId} not found`);

  const newAssembly = await db.transaction(async (tx) => {
    const [result] = await tx.insert(assemblies).values({
      name: overrides?.name ?? `${source.name} (Copy)`,
      description: source.description,
      category: source.category,
      defaultUnitId: source.defaultUnitId,
      baseUnitQty: source.baseUnitQty,
      wasteFactor: source.wasteFactor,
      region: overrides?.region ?? source.region,
    }).returning();

    if (source.components.length > 0) {
      const componentValues = source.components.map(c => ({
        assemblyId: result.id,
        costCodeId: c.costCodeId,
        costTypeId: c.costTypeId,
        unitId: c.unitId,
        description: c.description,
        defaultQtyPerUnit: c.defaultQtyPerUnit,
        wasteFactor: c.wasteFactor,
        isOptional: c.isOptional,
        sortOrder: c.sortOrder,
      }));
      await tx.insert(assemblyItems).values(componentValues);
    }

    return result;
  });

  const cloned = (await getAssemblyById(newAssembly.id))!;

  logAudit({
    action: "create",
    tableName: "assemblies",
    recordId: newAssembly.id,
    before: { clonedFrom: sourceId },
    after: cloned,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return cloned;
}

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLY COMPONENTS — CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Get all components for an assembly, joined with cost codes.
 */
export async function getComponentsForAssembly(assemblyId: string): Promise<AssemblyItemWithCostCode[]> {
  const db = await getDb();
  if (!db) return [];

  const comps = await db
    .select()
    .from(assemblyItems)
    .where(eq(assemblyItems.assemblyId, assemblyId))
    .orderBy(asc(assemblyItems.sortOrder));

  if (comps.length === 0) return [];

  // Get all referenced cost code IDs
  const costCodeIds = Array.from(new Set(comps.map(c => c.costCodeId)));

  let costCodeMap: Map<string, CostCode> = new Map();
  if (costCodeIds.length > 0) {
    const codes = await db
      .select()
      .from(costCodes)
      .where(inArray(costCodes.id, costCodeIds));
    costCodeMap = new Map(codes.map(c => [c.id, c]));
  }

  return comps.map(c => ({
    ...c,
    costCode: costCodeMap.get(c.costCodeId) ?? null,
  }));
}

/**
 * Add a component to an assembly.
 */
export async function addComponentToAssembly(
  data: Omit<InsertAssemblyItem, "id" | "createdAt" | "updatedAt">
): Promise<AssemblyItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [component] = await db.insert(assemblyItems).values(data).returning();

  logAudit({
    action: "create",
    tableName: "assembly_items",
    recordId: component.id,
    before: null,
    after: component,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return component;
}

/**
 * Remove a component from an assembly.
 */
export async function removeComponentFromAssembly(componentId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [component] = await db
    .select()
    .from(assemblyItems)
    .where(eq(assemblyItems.id, componentId))
    .limit(1);

  if (!component) throw new Error(`Component ${componentId} not found`);

  await db.delete(assemblyItems).where(eq(assemblyItems.id, componentId));

  logAudit({
    action: "delete",
    tableName: "assembly_items",
    recordId: componentId,
    before: component,
    after: null,
  }).catch((err) => console.error("[Audit] write failed:", err.message));
}

/**
 * Get assembly categories with counts.
 */
export async function getAssemblyCategories(): Promise<{ category: string; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      category: assemblies.category,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(assemblies)
    .where(eq(assemblies.isActive, true))
    .groupBy(assemblies.category)
    .orderBy(asc(assemblies.category));
}

/**
 * Get assembly stats.
 */
export async function getAssemblyStats(): Promise<{
  totalAssemblies: number;
  totalCategories: number;
  totalComponents: number;
  avgComponentsPerAssembly: number;
}> {
  const db = await getDb();
  if (!db) return {
    totalAssemblies: 0, totalCategories: 0,
    totalComponents: 0, avgComponentsPerAssembly: 0,
  };

  const [stats] = await db
    .select({
      totalAssemblies: sql<number>`COUNT(*)`,
      totalCategories: sql<number>`COUNT(DISTINCT ${assemblies.category})`,
    })
    .from(assemblies)
    .where(eq(assemblies.isActive, true));

  const [compStats] = await db
    .select({
      totalComponents: sql<number>`COUNT(*)`,
    })
    .from(assemblyItems);

  const totalAssemblies = stats?.totalAssemblies ?? 0;
  const totalComponents = compStats?.totalComponents ?? 0;

  return {
    totalAssemblies,
    totalCategories: stats?.totalCategories ?? 0,
    totalComponents,
    avgComponentsPerAssembly: totalAssemblies > 0 ? Math.round((totalComponents / totalAssemblies) * 10) / 10 : 0,
  };
}

// ══════════════════════════════════════════════════════════════════════
// COMPATIBILITY ALIASES (old function names for router compatibility)
// ══════════════════════════════════════════════════════════════════════

export async function getAssembliesByTrade(trade: string): Promise<Assembly[]> {
  // assemblies no longer have a trade field; return all in category as fallback
  const { items } = await listAssemblies({ category: trade });
  return items;
}

export async function getAssemblyTrades(): Promise<{ trade: string | null; count: number }[]> {
  // assemblies no longer have a trade field; return categories instead
  const categories = await getAssemblyCategories();
  return categories.map(c => ({ trade: c.category, count: c.count }));
}
