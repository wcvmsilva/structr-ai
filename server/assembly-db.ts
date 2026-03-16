/**
 * structr.ai v9 — Assembly Database Helpers
 * Sprint 7: Assembly Library — Remodel Scope
 *
 * Provides:
 *   - Assembly CRUD with versioning and soft delete
 *   - Component management (add/remove/list)
 *   - Clone support with parent_assembly_id
 *   - Filtered listing by trade, category, finish_level, region
 *   - Full BOM retrieval with price_book_items join
 */

import { eq, like, or, sql, asc, and, desc, inArray, isNull } from "drizzle-orm";
import { getDb } from "./db";
import {
  assemblies,
  assemblyComponents,
  priceBookItems,
  type Assembly,
  type InsertAssembly,
  type AssemblyComponent,
  type InsertAssemblyComponent,
  type PriceBookItem,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Assembly with its full component list (BOM) */
export interface AssemblyWithComponents extends Assembly {
  components: AssemblyComponentWithPBI[];
}

/** Component with joined price_book_item data */
export interface AssemblyComponentWithPBI extends AssemblyComponent {
  priceBookItem: PriceBookItem | null;
}

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLIES — CRUD with Versioning
// ══════════════════════════════════════════════════════════════════════

/**
 * List assemblies with optional filters.
 * Respects soft delete (excludes deleted_at IS NOT NULL).
 * Orders by trade_sequence_order by default.
 */
export async function listAssemblies(opts?: {
  trade?: string;
  category?: string;
  subcategory?: string;
  finishLevel?: string;
  region?: string;
  assemblyType?: string;
  activeOnly?: boolean;
  includeHidden?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Assembly[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  // Always exclude soft-deleted
  conditions.push(isNull(assemblies.deletedAt));

  if (opts?.activeOnly !== false) {
    conditions.push(eq(assemblies.isActive, true));
  }
  if (opts?.trade) {
    conditions.push(eq(assemblies.trade, opts.trade));
  }
  if (opts?.category) {
    conditions.push(eq(assemblies.category, opts.category));
  }
  if (opts?.subcategory) {
    conditions.push(eq(assemblies.subcategory, opts.subcategory));
  }
  if (opts?.finishLevel) {
    conditions.push(eq(assemblies.finishLevel, opts.finishLevel as any));
  }
  if (opts?.region) {
    conditions.push(eq(assemblies.region, opts.region));
  }
  if (opts?.assemblyType) {
    conditions.push(eq(assemblies.assemblyType, opts.assemblyType as any));
  }
  if (!opts?.includeHidden) {
    conditions.push(eq(assemblies.hiddenConditionFlag, false));
  }
  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(assemblies.name, pattern),
        like(assemblies.description, pattern),
        like(assemblies.code, pattern)
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

  // Get paginated results ordered by trade_sequence_order
  const limit = opts?.limit ?? 200;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(assemblies)
    .orderBy(asc(assemblies.tradeSequenceOrder), asc(assemblies.name))
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
 * Each component includes joined price_book_item data.
 */
export async function getAssemblyById(id: number): Promise<AssemblyWithComponents | null> {
  const db = await getDb();
  if (!db) return null;

  const [assembly] = await db
    .select()
    .from(assemblies)
    .where(and(eq(assemblies.id, id), isNull(assemblies.deletedAt)))
    .limit(1);

  if (!assembly) return null;

  // Get components with joined PBI data
  const components = await getComponentsForAssembly(id);

  return { ...assembly, components };
}

/**
 * Get assemblies filtered by trade.
 */
export async function getAssembliesByTrade(trade: string): Promise<Assembly[]> {
  const { items } = await listAssemblies({ trade, includeHidden: true });
  return items;
}

/**
 * Get assemblies filtered by category.
 */
export async function getAssembliesByCategory(category: string): Promise<Assembly[]> {
  const { items } = await listAssemblies({ category, includeHidden: true });
  return items;
}

/**
 * Create a new assembly.
 */
export async function createAssembly(
  data: Omit<InsertAssembly, "id" | "createdAt" | "updatedAt" | "version" | "deletedAt">
): Promise<Assembly> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(assemblies).values({
    ...data,
    version: 1,
  }).$returningId();

  const [assembly] = await db
    .select()
    .from(assemblies)
    .where(eq(assemblies.id, result.id))
    .limit(1);

  logAudit({
    action: "create",
    tableName: "assemblies",
    recordId: assembly.id,
    before: null,
    after: assembly,
  }).catch(() => {});

  return assembly;
}

/**
 * Update an assembly. Increments version on every update.
 */
export async function updateAssembly(
  id: number,
  data: Partial<Pick<Assembly,
    "name" | "code" | "trade" | "category" | "subcategory" | "description" |
    "defaultUnit" | "unitOfMeasure" | "directCost" | "sellPrice" | "crewHours" |
    "itemCount" | "grossProfitPct" | "assemblyType" | "finishLevel" | "region" |
    "coastalModifier" | "tradeSequenceOrder" | "inclusions" | "exclusions" |
    "hiddenConditionFlag" | "isPreset" | "isActive" | "conditionRules" | "notes"
  >>
): Promise<Assembly> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get current version
  const [current] = await db
    .select()
    .from(assemblies)
    .where(eq(assemblies.id, id))
    .limit(1);

  if (!current) throw new Error(`Assembly ${id} not found`);

  // Build update set with version increment
  const updateSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updateSet[key] = value;
    }
  }

  // Always increment version
  updateSet.version = (current.version ?? 1) + 1;

  await db.update(assemblies).set(updateSet).where(eq(assemblies.id, id));

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
  }).catch(() => {});

  return updated;
}

/**
 * Soft-delete an assembly.
 */
export async function deleteAssembly(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);

  await db.update(assemblies).set({
    isActive: false,
    deletedAt: new Date(),
  }).where(eq(assemblies.id, id));

  logAudit({
    action: "delete",
    tableName: "assemblies",
    recordId: id,
    before,
    after: { ...before, isActive: false, deletedAt: new Date() },
  }).catch(() => {});
}

/**
 * Clone an assembly with all its components.
 * Sets parent_assembly_id to the source, resets version to 1.
 */
export async function cloneAssembly(
  sourceId: number,
  overrides?: Partial<Pick<Assembly, "name" | "code" | "finishLevel" | "region">>
): Promise<AssemblyWithComponents> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get source assembly with components
  const source = await getAssemblyById(sourceId);
  if (!source) throw new Error(`Source assembly ${sourceId} not found`);

  // Create clone
  const { id, uuid, supabaseId, createdAt, updatedAt, deletedAt, components, ...rest } = source;

  const [result] = await db.insert(assemblies).values({
    ...rest,
    name: overrides?.name ?? `${source.name} (Copy)`,
    code: overrides?.code ?? `${source.code}-CLN`,
    finishLevel: overrides?.finishLevel ?? source.finishLevel,
    region: overrides?.region ?? source.region,
    parentAssemblyId: sourceId,
    version: 1,
    uuid: null,
    supabaseId: null,
  }).$returningId();

  const cloneId = result.id;

  // Clone all components
  if (components.length > 0) {
    const componentValues = components.map(c => ({
      assemblyId: cloneId,
      priceBookItemId: c.priceBookItemId,
      catalogItemId: c.catalogItemId,
      componentType: c.componentType,
      description: c.description,
      quantity: c.quantity,
      unit: c.unit,
      wasteFactorPct: c.wasteFactorPct,
      unitCostOverride: c.unitCostOverride,
      notes: c.notes,
      sortOrder: c.sortOrder,
    }));

    await db.insert(assemblyComponents).values(componentValues);
  }

  // Return the full clone
  const cloned = (await getAssemblyById(cloneId))!;

  logAudit({
    action: "create",
    tableName: "assemblies",
    recordId: cloneId,
    before: { clonedFrom: sourceId },
    after: cloned,
  }).catch(() => {});

  return cloned;
}

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLY COMPONENTS — CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Get all components for an assembly, joined with price_book_items.
 */
export async function getComponentsForAssembly(assemblyId: number): Promise<AssemblyComponentWithPBI[]> {
  const db = await getDb();
  if (!db) return [];

  // Get components
  const comps = await db
    .select()
    .from(assemblyComponents)
    .where(eq(assemblyComponents.assemblyId, assemblyId))
    .orderBy(asc(assemblyComponents.sortOrder));

  if (comps.length === 0) return [];

  // Get all referenced PBI IDs
  const pbiIds = comps
    .map(c => c.priceBookItemId)
    .filter((id): id is number => id !== null);

  let pbiMap: Map<number, PriceBookItem> = new Map();
  if (pbiIds.length > 0) {
    const pbis = await db
      .select()
      .from(priceBookItems)
      .where(inArray(priceBookItems.id, pbiIds));
    pbiMap = new Map(pbis.map(p => [p.id, p]));
  }

  return comps.map(c => ({
    ...c,
    priceBookItem: c.priceBookItemId ? (pbiMap.get(c.priceBookItemId) ?? null) : null,
  }));
}

/**
 * Add a component to an assembly.
 */
export async function addComponentToAssembly(
  data: Omit<InsertAssemblyComponent, "id" | "createdAt">
): Promise<AssemblyComponent> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(assemblyComponents).values(data).$returningId();

  const [component] = await db
    .select()
    .from(assemblyComponents)
    .where(eq(assemblyComponents.id, result.id))
    .limit(1);

  // Update assembly item count
  await updateAssemblyItemCount(data.assemblyId);

  logAudit({
    action: "create",
    tableName: "assembly_components",
    recordId: component.id,
    before: null,
    after: component,
  }).catch(() => {});

  return component;
}

/**
 * Remove a component from an assembly.
 */
export async function removeComponentFromAssembly(componentId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get the component to find its assembly
  const [component] = await db
    .select()
    .from(assemblyComponents)
    .where(eq(assemblyComponents.id, componentId))
    .limit(1);

  if (!component) throw new Error(`Component ${componentId} not found`);

  await db.delete(assemblyComponents).where(eq(assemblyComponents.id, componentId));

  // Update assembly item count
  await updateAssemblyItemCount(component.assemblyId);

  logAudit({
    action: "delete",
    tableName: "assembly_components",
    recordId: componentId,
    before: component,
    after: null,
  }).catch(() => {});
}

/**
 * Update the itemCount on an assembly based on its component count.
 */
async function updateAssemblyItemCount(assemblyId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(assemblyComponents)
    .where(eq(assemblyComponents.assemblyId, assemblyId));

  const count = countResult?.count ?? 0;

  await db.update(assemblies).set({ itemCount: count }).where(eq(assemblies.id, assemblyId));
}

/**
 * Get assembly categories with counts.
 */
export async function getAssemblyCategories(): Promise<{ category: string | null; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      category: assemblies.category,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(assemblies)
    .where(and(eq(assemblies.isActive, true), isNull(assemblies.deletedAt)))
    .groupBy(assemblies.category)
    .orderBy(asc(assemblies.category));
}

/**
 * Get assembly trades with counts.
 */
export async function getAssemblyTrades(): Promise<{ trade: string | null; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      trade: assemblies.trade,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(assemblies)
    .where(and(eq(assemblies.isActive, true), isNull(assemblies.deletedAt)))
    .groupBy(assemblies.trade)
    .orderBy(asc(assemblies.trade));
}

/**
 * Get assembly stats.
 */
export async function getAssemblyStats(): Promise<{
  totalAssemblies: number;
  totalCategories: number;
  totalTrades: number;
  totalComponents: number;
  avgComponentsPerAssembly: number;
  hiddenConditionCount: number;
}> {
  const db = await getDb();
  if (!db) return {
    totalAssemblies: 0, totalCategories: 0, totalTrades: 0,
    totalComponents: 0, avgComponentsPerAssembly: 0, hiddenConditionCount: 0,
  };

  const [stats] = await db
    .select({
      totalAssemblies: sql<number>`COUNT(*)`,
      totalCategories: sql<number>`COUNT(DISTINCT ${assemblies.category})`,
      totalTrades: sql<number>`COUNT(DISTINCT ${assemblies.trade})`,
      hiddenConditionCount: sql<number>`SUM(CASE WHEN ${assemblies.hiddenConditionFlag} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(assemblies)
    .where(and(eq(assemblies.isActive, true), isNull(assemblies.deletedAt)));

  const [compStats] = await db
    .select({
      totalComponents: sql<number>`COUNT(*)`,
    })
    .from(assemblyComponents);

  const totalAssemblies = stats?.totalAssemblies ?? 0;
  const totalComponents = compStats?.totalComponents ?? 0;

  return {
    totalAssemblies,
    totalCategories: stats?.totalCategories ?? 0,
    totalTrades: stats?.totalTrades ?? 0,
    totalComponents,
    avgComponentsPerAssembly: totalAssemblies > 0 ? Math.round((totalComponents / totalAssemblies) * 10) / 10 : 0,
    hiddenConditionCount: stats?.hiddenConditionCount ?? 0,
  };
}
