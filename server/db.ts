import { eq, like, or, sql, asc, and, desc } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { InsertProfile, profiles, costCodes, bundles, bundleItems, estimateDrafts, type CostCode, type Bundle, type BundleItem, type InsertBundle, type InsertBundleItem, type EstimateDraft, type InsertEstimateDraft, type Profile } from "../drizzle/schema";
import { ENV } from './_core/env';
// G1 — bundles are authorized through the shared, hardened tenant primitives.
import { assertSameTenant, tenantWhere, withTenant } from "./tenant-scope";

let _db: PostgresJsDatabase | null = null;
let _client: ReturnType<typeof postgres> | null = null;


// Lazily create the drizzle instance with connection pooling.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _client = postgres(process.env.DATABASE_URL, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
      });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}

/**
 * Get the raw postgres.js client for raw SQL operations.
 * Used for SET ROLE commands that must bypass Supabase RLS.
 */
export function getRawClient() {
  return _client;
}


/**
 * PHASE 1: Upsert a profile by internal UUID.
 *
 * Identity rule: `profiles.id` is the internal canonical UUID and `external_open_id`
 * is the external OAuth identifier. For OAuth-driven sync use
 * `upsertProfileFromOAuth()` in `server/identity-db.ts`, which keys on
 * `external_open_id` instead of the internal id.
 */
export async function upsertUser(user: InsertProfile): Promise<void> {
  if (!user.id) {
    throw new Error("User id is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertProfile = {
      id: user.id,
    };
    const updateSet: Record<string, unknown> = {};

    const assign = <K extends keyof InsertProfile>(key: K) => {
      const value = user[key];
      if (value !== undefined) {
        (values as Record<string, unknown>)[key as string] = value;
        updateSet[key as string] = value;
      }
    };

    assign("tenantId");
    assign("externalOpenId");
    assign("email");
    assign("loginMethod");
    assign("fullName");
    assign("companyName");
    assign("role");
    assign("isActive");
    assign("lastSignedIn");

    updateSet.updatedAt = new Date();

    await db.insert(profiles).values(values).onConflictDoUpdate({
      target: profiles.id,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

/**
 * PHASE 1: Functional lookup by external OAuth identifier.
 *
 * Previously this returned `undefined` unconditionally, which broke real login and
 * pushed every request into the dev bypass. It now resolves `profiles.external_open_id`
 * and returns the internal profile row.
 */
export async function getUserByOpenId(openId: string): Promise<Profile | undefined> {
  if (!openId) return undefined;

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.externalOpenId, openId))
    .limit(1);

  return profile ?? undefined;
}

// ── Catalog Queries ──────────────────────────────────────────────

export async function getCatalogItems(opts?: {
  search?: string;
  code?: string;
  activeOnly?: boolean;
}): Promise<CostCode[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (opts?.activeOnly !== false) {
    conditions.push(eq(costCodes.isActive, true));
  }
  if (opts?.code) {
    conditions.push(eq(costCodes.code, opts.code));
  }
  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(costCodes.name, pattern),
        like(costCodes.description, pattern),
        like(costCodes.code, pattern)
      )!
    );
  }

  const query = db
    .select()
    .from(costCodes)
    .orderBy(asc(costCodes.code), asc(costCodes.name));

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }

  return query;
}

export async function getCatalogGroups(): Promise<{ name: string; code: string; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  // Groups parent cost codes with child counts
  const result = await db
    .select({
      name: costCodes.name,
      code: sql<string>`MIN(${costCodes.code})`.as("code"),
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(costCodes)
    .where(eq(costCodes.isActive, true))
    .groupBy(costCodes.name)
    .orderBy(sql`MIN(${costCodes.code})`);

  return result;
}

export async function getCatalogItemById(id: string): Promise<CostCode | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(costCodes)
    .where(eq(costCodes.id, id))
    .limit(1);

  return result[0];
}

export async function getCatalogStats() {
  const db = await getDb();
  if (!db) return { totalItems: 0, totalGroups: 0, avgMargin: 0 };

  // Pricing data is now in separate costCodePricingHistory table
  const [stats] = await db
    .select({
      totalItems: sql<number>`COUNT(*)`,
      totalGroups: sql<number>`COUNT(DISTINCT ${costCodes.parentId})`,
      avgMargin: sql<number>`0`,
    })
    .from(costCodes)
    .where(eq(costCodes.isActive, true));

  return stats;
}

// ── Bundle Queries ──────────────────────────────────────────────
// NOTE: Bundles schema uses: id, tenantId, name, description, category, bundleDiscount,
// region, isActive, isCustomizable, minItems, maxItems, validFrom, validUntil, notes
// BundleItems uses: id, bundleId, assemblyId, quantity, isOptional, overrideQty, sortOrder, notes
//
// ── G1 — BUNDLES CALLER-AXIS BOUNDARY (B2 / Codex P1-1) ──────────────────────
//
// Every helper below takes a REQUIRED, non-nullable `tenantId` as its first argument.
// Omitting it is a compile error at the call site — the pattern F8 established for
// client-db.ts — so a bundle query cannot silently run unscoped. The primitives are the
// shared, hardened ones in server/tenant-scope.ts; nothing here re-implements tenant
// authorization.
//
// `bundle_items` carries no tenant_id of its own, by design. Its authorization derives
// from the parent bundle, and the ordering is always:
//
//     caller tenant → authorized parent bundle → child item
//
// never child-item-id → mutation. `loadBundleItemInTenant()` below is the single place
// that ordering is expressed, and every item helper goes through it.
//
// A bundle belonging to another tenant is reported as "not found", not "forbidden", so a
// cross-tenant probe cannot use the error to prove a row exists. This matches client-db.ts.
//
// ── SCOPE: CALLER AXIS ONLY ──────────────────────────────────────────────────
// This closes the CALLER axis. While TENANT_STRICT is off, the shared primitives keep
// their transitional `tenant_id IS NULL` arm, so legacy NULL-owned bundles remain
// readable — and mutable — by any *resolved* tenant. That is the ROW axis (F15 /
// issue #10) and is deliberately NOT resolved here.
//
// What G1 does guarantee on the row axis is that the population stops growing:
// `createBundle` and `duplicateBundle` now stamp ownership, so no new NULL-owned bundle
// can be created through the application.

/**
 * Load one bundle constrained to the caller's tenant.
 * Returns null when the bundle does not exist OR belongs to another tenant.
 */
async function loadBundleInTenant(
  db: PostgresJsDatabase,
  tenantId: string,
  bundleId: string,
): Promise<Bundle | null> {
  const [bundle] = await db
    .select()
    .from(bundles)
    .where(tenantWhere(bundles, tenantId, eq(bundles.id, bundleId)))
    .limit(1);
  if (!bundle) return null;

  // Defence in depth: the predicate above already excludes foreign rows, but isolation must
  // not depend on the query builder alone, so the row that actually came back is re-checked.
  // `assertSameTenant` keeps the same transitional NULL semantics as `tenantWhere` (F15), so
  // this narrows nothing beyond the caller axis.
  if (!assertSameTenant(bundle.tenantId, tenantId)) return null;

  return bundle;
}

/**
 * Resolve a bundle item and authorize it through its PARENT bundle.
 *
 * The item lookup comes first because the parent id is only knowable from the row — it is
 * the minimum read needed to establish authorization, and it authorizes nothing on its own.
 * Authorization is the parent check that follows it. Returns null when the item is missing,
 * or when its parent bundle is missing or belongs to another tenant.
 */
async function loadBundleItemInTenant(
  db: PostgresJsDatabase,
  tenantId: string,
  bundleItemId: string,
): Promise<BundleItem | null> {
  const [item] = await db
    .select()
    .from(bundleItems)
    .where(eq(bundleItems.id, bundleItemId))
    .limit(1);
  if (!item) return null;

  const parent = await loadBundleInTenant(db, tenantId, item.bundleId);
  if (!parent) return null;

  return item;
}

/**
 * Authorized point lookup of a bundle WITHOUT its items.
 * Exposed so routers can authorize a target (and capture an audit "before" value) without
 * paying for the item fan-out. Null means "not found or not yours".
 */
export async function getBundleInTenant(tenantId: string, bundleId: string): Promise<Bundle | null> {
  const db = await getDb();
  if (!db) return null;
  return loadBundleInTenant(db, tenantId, bundleId);
}

/**
 * Authorized point lookup of a bundle item, via its parent bundle.
 * Replaces the unscoped `bundle_items` PK read the router used to perform inline.
 */
export async function getBundleItemInTenant(
  tenantId: string,
  bundleItemId: string,
): Promise<BundleItem | null> {
  const db = await getDb();
  if (!db) return null;
  return loadBundleItemInTenant(db, tenantId, bundleItemId);
}

export async function createBundle(tenantId: string, data: {
  name: string;
  description?: string | null;
  category?: string;
  bundleDiscount?: string;
}): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Ownership comes from the trusted `tenantId` argument and nowhere else. The payload is
  // rebuilt field by field from named inputs, so the object handed to `withTenant()` provably
  // has no `tenantId` key of its own — which matters, because `withTenant` preserves an
  // existing non-null value rather than overriding it. A caller-supplied tenant therefore
  // cannot reach this insert even if one were ever added to the route input.
  const [result] = await db.insert(bundles).values(
    withTenant({
      name: data.name,
      description: data.description ?? null,
      category: data.category ?? "general",
      bundleDiscount: data.bundleDiscount ?? "0.08",
    }, tenantId),
  ).returning();

  return result;
}

export async function getBundleById(
  tenantId: string,
  id: string,
): Promise<(Bundle & { items: BundleItem[] }) | null> {
  const db = await getDb();
  if (!db) return null;

  const bundle = await loadBundleInTenant(db, tenantId, id);
  if (!bundle) return null;

  // Items are reached only through a bundle the caller is already authorized for.
  const items = await db
    .select()
    .from(bundleItems)
    .where(eq(bundleItems.bundleId, bundle.id))
    .orderBy(asc(bundleItems.sortOrder), asc(bundleItems.id));

  return { ...bundle, items };
}

export async function listBundles(tenantId: string, opts?: { activeOnly?: boolean }): Promise<Bundle[]> {
  const db = await getDb();
  if (!db) return [];

  const activeOnly = opts?.activeOnly !== false ? eq(bundles.isActive, true) : undefined;

  return db
    .select()
    .from(bundles)
    .where(tenantWhere(bundles, tenantId, activeOnly))
    .orderBy(desc(bundles.updatedAt));
}

export async function updateBundleMeta(tenantId: string, id: string, data: {
  name?: string;
  description?: string | null;
  category?: string;
  bundleDiscount?: string;
}): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Authorize the target before mutating it.
  const existing = await loadBundleInTenant(db, tenantId, id);
  if (!existing) throw new Error(`Bundle ${id} not found`);

  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.description !== undefined) updateSet.description = data.description;
  if (data.category !== undefined) updateSet.category = data.category;
  if (data.bundleDiscount !== undefined) updateSet.bundleDiscount = data.bundleDiscount;

  if (Object.keys(updateSet).length > 0) {
    // The tenant predicate is repeated on the UPDATE itself, so the write cannot outlive
    // the authorization above.
    await db.update(bundles).set(updateSet).where(tenantWhere(bundles, tenantId, eq(bundles.id, id)));
  }

  const bundle = await loadBundleInTenant(db, tenantId, id);
  if (!bundle) throw new Error(`Bundle ${id} not found`);
  return bundle;
}

export async function addItemToBundle(tenantId: string, data: {
  bundleId: string;
  assemblyId: string;
  quantity?: string;
  isOptional?: boolean;
}): Promise<BundleItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Parent authorization precedes the insert: an item may only be added to a bundle the
  // caller's tenant owns.
  const parent = await loadBundleInTenant(db, tenantId, data.bundleId);
  if (!parent) throw new Error(`Bundle ${data.bundleId} not found`);

  // Get next sort order
  const [maxSort] = await db
    .select({ maxSort: sql<number>`COALESCE(MAX(${bundleItems.sortOrder}), 0)` })
    .from(bundleItems)
    .where(eq(bundleItems.bundleId, parent.id));

  const [result] = await db.insert(bundleItems).values({
    bundleId: parent.id,
    assemblyId: data.assemblyId,
    quantity: data.quantity ?? "1",
    isOptional: data.isOptional ?? false,
    sortOrder: (maxSort?.maxSort ?? 0) + 1,
  }).returning();

  return result;
}

export async function updateBundleItemQuantity(
  tenantId: string,
  bundleItemId: string,
  quantity: string,
): Promise<BundleItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await loadBundleItemInTenant(db, tenantId, bundleItemId);
  if (!existing) throw new Error(`Bundle item ${bundleItemId} not found`);

  // Constrained by the parent established above, not by the caller-supplied id alone.
  await db.update(bundleItems).set({
    quantity,
  }).where(and(eq(bundleItems.id, existing.id), eq(bundleItems.bundleId, existing.bundleId)));

  const [updated] = await db.select().from(bundleItems).where(eq(bundleItems.id, existing.id)).limit(1);
  return updated;
}

export async function removeBundleItem(
  tenantId: string,
  bundleItemId: string,
): Promise<{ bundleId: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await loadBundleItemInTenant(db, tenantId, bundleItemId);
  if (!existing) throw new Error(`Bundle item ${bundleItemId} not found`);

  await db.delete(bundleItems)
    .where(and(eq(bundleItems.id, existing.id), eq(bundleItems.bundleId, existing.bundleId)));

  return { bundleId: existing.bundleId };
}

export async function duplicateBundle(
  tenantId: string,
  bundleId: string,
  newName: string,
): Promise<Bundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // The source must be readable by the caller's tenant before anything is written.
  const original = await getBundleById(tenantId, bundleId);
  if (!original) throw new Error(`Bundle ${bundleId} not found`);

  const newBundle = await db.transaction(async (tx) => {
    // Ownership of the copy is ALWAYS the caller's tenant. `original.tenantId` is
    // deliberately not propagated: a legacy NULL-owned or otherwise differently-owned
    // source must not stamp its ownership onto a row created today.
    const [newBundleResult] = await tx.insert(bundles).values(
      withTenant({
        name: newName,
        description: original.description,
        category: original.category,
        bundleDiscount: original.bundleDiscount,
        region: original.region,
        isCustomizable: original.isCustomizable,
      }, tenantId),
    ).returning();

    if (original.items.length > 0) {
      const newItems = original.items.map(item => ({
        bundleId: newBundleResult.id,
        assemblyId: item.assemblyId,
        quantity: item.quantity,
        isOptional: item.isOptional,
        overrideQty: item.overrideQty,
        sortOrder: item.sortOrder,
        notes: item.notes,
      }));
      await tx.insert(bundleItems).values(newItems);
    }

    return newBundleResult;
  });

  return newBundle;
}

export async function deleteBundle(tenantId: string, bundleId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Authorize the target before mutating it.
  const existing = await loadBundleInTenant(db, tenantId, bundleId);
  if (!existing) throw new Error(`Bundle ${bundleId} not found`);

  // Soft delete: mark as inactive
  await db.update(bundles).set({ isActive: false })
    .where(tenantWhere(bundles, tenantId, eq(bundles.id, bundleId)));
}

// ── Estimate Draft Queries ──────────────────────────────────────────
// NOTE: estimateDrafts schema uses: id, estimateId, projectId, status, source, draftData (jsonb), createdAt, updatedAt
// All detailed fields (lineItems, totals, etc.) are stored inside draftData jsonb

export async function createEstimateDraft(data: {
  projectId: string;
  source?: string;
  draftData?: Record<string, unknown>;
  status?: string;
  // PHASE 2 — governance fields promoted from draftData to real columns
  tenantId?: string | null;
  scopeDraftId?: string | null;
  version?: number;
  supersedesId?: string | null;
  changeOrderOf?: string | null;
  changeOrderReason?: string | null;
  commercialChannel?: string | null;
  profitShieldFloorPct?: string | null;
  profitShieldEvaluation?: Record<string, unknown> | null;
  pricingSnapshot?: Record<string, unknown> | null;
  createdBy?: string | null;
}): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(estimateDrafts).values({
    projectId: data.projectId,
    source: data.source ?? null,
    draftData: data.draftData ?? null,
    status: data.status ?? "draft",
    tenantId: data.tenantId ?? null,
    scopeDraftId: data.scopeDraftId ?? null,
    version: data.version ?? 1,
    supersedesId: data.supersedesId ?? null,
    changeOrderOf: data.changeOrderOf ?? null,
    changeOrderReason: data.changeOrderReason ?? null,
    commercialChannel: data.commercialChannel ?? null,
    profitShieldFloorPct: data.profitShieldFloorPct ?? null,
    profitShieldEvaluation: data.profitShieldEvaluation ?? null,
    pricingSnapshot: data.pricingSnapshot ?? null,
    createdBy: data.createdBy ?? null,
  }).returning();

  return result;
}

export async function getEstimateDraftById(id: string): Promise<EstimateDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [draft] = await db.select().from(estimateDrafts).where(eq(estimateDrafts.id, id)).limit(1);
  return draft ?? null;
}

export async function listEstimateDrafts(opts?: { status?: string }): Promise<EstimateDraft[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts?.status) {
    conditions.push(eq(estimateDrafts.status, opts.status));
  }

  const query = db.select().from(estimateDrafts).orderBy(desc(estimateDrafts.updatedAt));

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}
