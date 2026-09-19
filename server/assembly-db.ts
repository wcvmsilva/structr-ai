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
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AssemblyComponentInput } from "../shared/assembly-engine";
import { normalizeAssemblyComponentType } from "../shared/domain/normalization";
import { safeParseFloat } from "../shared/utils/math";
import {
  assemblies,
  assemblyItems,
  costCodes,
  costCodePricingHistory,
  costTypes,
  units,
  tenants,
  tenantSettings,
  type Assembly,
  type InsertAssembly,
  type AssemblyItem,
  type InsertAssemblyItem,
  type CostCode,
  type CostType,
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

export interface PricedAssemblyWithComponents extends Assembly {
  components: PricedAssemblyItemWithCostCode[];
}

export interface PricedAssemblyItemWithCostCode extends Omit<AssemblyItemWithCostCode, "priceBookItem" | "componentType"> {
  costType: CostType;
  componentType: AssemblyComponentInput["componentType"];
  quantity: string;
  unit: string;
  /** Preserve the unresolved legacy scalar without reinterpreting it as a pricing-history FK. */
  priceBookItemReference: string | null;
  priceBookItem: NonNullable<AssemblyComponentInput["priceBookItem"]>;
  pricingRecordId: string;
  pricingEvaluationDate: string;
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
export function getAssemblyById(id: string, options: { requirePricing: true }): Promise<PricedAssemblyWithComponents | null>;
export function getAssemblyById(id: string, options?: { requirePricing?: false }): Promise<AssemblyWithComponents | null>;
export function getAssemblyById(id: string, options?: { requirePricing?: boolean }): Promise<AssemblyWithComponents | PricedAssemblyWithComponents | null>;
export async function getAssemblyById(id: string, options: { requirePricing?: boolean } = {}): Promise<AssemblyWithComponents | PricedAssemblyWithComponents | null> {
  const db = await getDb();
  if (!db) return null;

  return db.transaction(async tx => {
    const [assembly] = await tx.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);
    if (!assembly) return null;
    if (options.requirePricing) return { ...assembly, components: await readPricedComponents(tx, assembly) };
    return { ...assembly, components: await readRawComponents(tx, assembly.id) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
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
 * Get a complete, unambiguous engine input graph. This does not authorize the caller
 * to the parent assembly or classify legacy catalog ownership (G4b remains separate).
 */
export async function getComponentsForAssembly(assemblyId: string): Promise<PricedAssemblyItemWithCostCode[]> {
  const db = await getDb();
  if (!db) return [];

  return db.transaction(async tx => {
    const [assembly] = await tx.select().from(assemblies).where(eq(assemblies.id, assemblyId)).limit(1);
    if (!assembly) return [];
    return readPricedComponents(tx, assembly);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Preserve the existing raw detail/CRUD contract; this graph must not be used for calculation. */
async function readRawComponents(db: Pick<PostgresJsDatabase, "select">, assemblyId: string): Promise<AssemblyItemWithCostCode[]> {
  const components = await db.select().from(assemblyItems).where(eq(assemblyItems.assemblyId, assemblyId)).orderBy(asc(assemblyItems.sortOrder));
  if (components.length === 0) return [];
  const ids = Array.from(new Set(components.map(component => component.costCodeId)));
  const codes = await db.select().from(costCodes).where(inArray(costCodes.id, ids));
  const codeMap = new Map(codes.map(code => [code.id, code]));
  return components.map(component => ({ ...component, costCode: codeMap.get(component.costCodeId) ?? null }));
}

function requireNonnegativeDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    throw new Error(`Invalid assembly pricing ${field}`);
  }
  const parsed = safeParseFloat(value, field);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid assembly pricing ${field}`);
  return value;
}

function validPricingDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readPricedComponents(db: Pick<PostgresJsDatabase, "select">, assembly: Assembly): Promise<PricedAssemblyItemWithCostCode[]> {
  const comps = await db
    .select()
    .from(assemblyItems)
    .where(eq(assemblyItems.assemblyId, assembly.id))
    .orderBy(asc(assemblyItems.sortOrder));

  if (comps.length === 0) return [];
  if (!assembly.tenantId) throw new Error("Assembly pricing requires an authoritative tenant and calendar");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, assembly.tenantId)).limit(1);
  const settings = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, assembly.tenantId));
  if (!tenant || tenant.id !== assembly.tenantId || !tenant.timezone
    || settings.some(setting => setting.tenantId !== assembly.tenantId || setting.timezone !== tenant.timezone)) {
    throw new Error("Assembly pricing tenant timezone is missing or inconsistent");
  }
  let evaluationDate: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find(value => value.type === type)?.value;
    evaluationDate = `${part("year")}-${part("month")}-${part("day")}`;
    if (!validPricingDate(evaluationDate)) throw new Error("Invalid calendar date");
  } catch {
    throw new Error("Assembly pricing tenant timezone is invalid");
  }

  // Batched graph reads use the caller's single repeatable-read transaction.
  const costCodeIds = Array.from(new Set(comps.map(c => c.costCodeId)));
  const unitIds = Array.from(new Set(comps.map(c => c.unitId)));
  const costTypeIds = Array.from(new Set(comps.map(c => c.costTypeId)));
  const [codes, componentUnits, componentTypes, history] = await Promise.all([
    db.select().from(costCodes).where(inArray(costCodes.id, costCodeIds)),
    db.select().from(units).where(inArray(units.id, unitIds)),
    db.select().from(costTypes).where(inArray(costTypes.id, costTypeIds)),
    db.select().from(costCodePricingHistory).where(and(inArray(costCodePricingHistory.costCodeId, costCodeIds), eq(costCodePricingHistory.isActive, true))),
  ]);
  const codeMap = new Map(codes.map(code => [code.id, code]));
  const unitMap = new Map(componentUnits.map(unit => [unit.id, unit]));
  const typeMap = new Map(componentTypes.map(type => [type.id, type]));

  return comps.map(component => {
    const costCode = codeMap.get(component.costCodeId);
    const unit = unitMap.get(component.unitId);
    const costType = typeMap.get(component.costTypeId);
    if (component.assemblyId !== assembly.id || !costCode || !unit || !costType) {
      throw new Error("Assembly component catalog reference is missing or inconsistent");
    }
    if (costCode.tenantId !== assembly.tenantId) throw new Error("Assembly component cost-code tenant ownership is inconsistent");
    const componentType = normalizeAssemblyComponentType(component.componentType === null ? costType.name : component.componentType);
    if (!componentType) throw new Error("Assembly component type is unresolved");
    const unitLabel = unit.abbreviation?.trim() || unit.name.trim();
    if (!unitLabel) throw new Error("Assembly component unit is unresolved");
    const quantity = requireNonnegativeDecimal(component.defaultQtyPerUnit, "quantity");
    if (component.unitCostOverride !== null) requireNonnegativeDecimal(component.unitCostOverride, "cost override");
    if (component.wasteFactor !== null) requireNonnegativeDecimal(component.wasteFactor, "waste factor");
    const eligible = history.filter(price => {
      if (!price.isActive || price.costCodeId !== costCode.id || price.unitId !== unit.id) return false;
      if (!validPricingDate(price.effectiveDate) || (price.expirationDate !== null
        && (!validPricingDate(price.expirationDate) || price.expirationDate <= price.effectiveDate))) {
        throw new Error("Assembly component pricing interval is invalid");
      }
      return price.effectiveDate <= evaluationDate && (price.expirationDate === null || evaluationDate < price.expirationDate);
    });
    if (eligible.length === 0) throw new Error("Assembly component pricing is missing for its exact unit and date");
    if (eligible.length !== 1) throw new Error("Assembly component pricing is ambiguous for its exact unit and date");
    const price = eligible[0];
    const unitCost = requireNonnegativeDecimal(price.unitCost, "unit cost");
    const unitPrice = requireNonnegativeDecimal(price.unitPrice, "unit price");

    return {
      ...component,
      costCode,
      costType,
      componentType,
      quantity,
      unit: unitLabel,
      priceBookItemReference: component.priceBookItem,
      pricingRecordId: price.id,
      pricingEvaluationDate: evaluationDate,
      priceBookItem: { id: costCode.id, code: costCode.code, name: costCode.name, unitCost, unitPrice, wasteFactor: null, coastalModifier: null, itemType: componentType },
    };
  });
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
