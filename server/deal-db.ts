import { getDb } from "./db";
import { deals, dealActivities, dealStageHistory } from "../drizzle/schema";
import { eq, and, desc, asc, like, or, sql, gte, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { withAuditLog } from "./audit";
import { tenantFilter, tenantWhere, withTenant } from "./tenant-scope";
import type { Deal, InsertDeal, InsertDealActivity, DealActivity, DealStageHistory } from "../drizzle/schema";

// Schema:
// deals: id, leadId, name, stage, value, closureDate, notes, createdAt, updatedAt
// dealActivities: id, dealId, activityType, description, createdAt
// dealStageHistory: id, dealId, previousStage, newStage, changedAt
//
// Tenant isolation: every query below is constrained with tenantFilter()/tenantWhere() and
// inserts stamp `tenantId`, so a deal id alone never grants access to another tenant's row.
// The trailing `tenantId` argument is supplied by the router from ctx.tenantId.

/**
 * Does `dealId` resolve to a deal the caller's tenant may touch?
 *
 * `deal_activities` has no `tenant_id` of its own — it inherits the tenant of its parent
 * deal — so activity reads/writes are scoped through this check. B2 (Codex P1-1): there is
 * no unresolved-tenant no-op — the caller tenant is always present, so this check always
 * runs and an out-of-tenant deal reads as absent.
 */
async function dealExistsInTenant(
  db: PostgresJsDatabase,
  dealId: string,
  tenantId: string,
): Promise<boolean> {
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(tenantWhere(deals, tenantId, eq(deals.id, dealId)))
    .limit(1);

  return Boolean(deal);
}

export async function createDeal(
  data: Omit<InsertDeal, "id" | "createdAt" | "updatedAt"> & { createdBy?: string },
  tenantId: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return withAuditLog(
    { userId: data.createdBy ?? null, action: "deal.create", tableName: "deals" },
    null,
    async () => {
      // Stamp the caller's tenant so the row is owned from the start; otherwise it stays
      // tenant-less and remains visible to every tenant.
      const [result] = await db.insert(deals).values(withTenant({
        name: data.name,
        leadId: data.leadId ?? null,
        stage: data.stage ?? "discovery",
        value: data.value ?? null,
        closureDate: data.closureDate ?? null,
        notes: data.notes ?? null,
      }, tenantId)).returning();

      return result;
    }
  );
}

export async function getDealById(id: string, tenantId: string): Promise<Deal | null> {
  const db = await getDb();
  if (!db) return null;

  const [deal] = await db
    .select()
    .from(deals)
    .where(tenantWhere(deals, tenantId, eq(deals.id, id)))
    .limit(1);

  return deal ?? null;
}

export async function listDeals(opts: {
  stage?: string;
  /** Caller tenant — rows outside it are never returned. */
  tenantId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  let query = db.select().from(deals).$dynamic();
  const conditions = [];

  if (opts.stage) conditions.push(eq(deals.stage, opts.stage));

  const where = tenantWhere(deals, opts.tenantId, ...conditions);
  if (where) {
    query = query.where(where);
  }

  return query;
}

export async function updateDeal(
  id: string,
  data: Partial<Deal>,
  updatedBy: string | undefined,
  tenantId: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  // Every statement below carries the tenant predicate, so a deal owned by another
  // tenant is indistinguishable from one that does not exist.
  const scope = tenantWhere(deals, tenantId, eq(deals.id, id));

  const before = await getDealById(id, tenantId);
  if (!before) throw new Error("Deal not found");

  return withAuditLog(
    { userId: updatedBy ?? null, action: "deal.update", tableName: "deals" },
    before,
    async () => {
      await db.update(deals).set({ ...data, updatedAt: new Date() }).where(scope);
      return getDealById(id, tenantId) as any;
    }
  );
}

export async function updateDealStage(
  id: string,
  newStage: string,
  changedBy: string | undefined,
  notes: string | undefined,
  tenantId: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  // Tenant scope: a deal outside the caller's tenant must look like it does not exist.
  const scope = tenantWhere(deals, tenantId, eq(deals.id, id));

  const deal = await getDealById(id, tenantId);
  if (!deal) throw new Error("Deal not found");

  if (deal.stage === newStage) return deal;

  return withAuditLog(
    { userId: changedBy ?? null, action: "deal.update_stage", tableName: "deals" },
    deal,
    async () => {
      return db.transaction(async (tx) => {
        await tx.update(deals).set({ stage: newStage, updatedAt: new Date() }).where(scope);
        await tx.insert(dealStageHistory).values({
          dealId: id,
          previousStage: deal.stage,
          newStage,
        });

        const [updatedDeal] = await tx.select().from(deals).where(scope).limit(1);
        return updatedDeal as any;
      });
    }
  );
}

export async function addDealActivity(
  data: Omit<InsertDealActivity, "id" | "createdAt">,
  tenantId: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  if (!(await dealExistsInTenant(db, data.dealId, tenantId))) {
    throw new Error("Deal not found");
  }

  const [result] = await db.insert(dealActivities).values(data).returning();
  return result;
}

export async function getDealActivities(
  dealId: string,
  tenantId: string,
): Promise<DealActivity[]> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  if (!(await dealExistsInTenant(db, dealId, tenantId))) {
    return [];
  }

  return db.select().from(dealActivities).where(eq(dealActivities.dealId, dealId)).orderBy(desc(dealActivities.createdAt));
}

export async function getDealStats(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [stats] = await db
    .select({ total: sql<number>`count(*)` })
    .from(deals)
    .where(tenantFilter(deals, tenantId));

  return stats;
}

export async function getStaleDeals(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  return db.select().from(deals).where(
    tenantWhere(
      deals,
      tenantId,
      lte(deals.updatedAt, twoWeeksAgo),
      or(eq(deals.stage, "discovery"), eq(deals.stage, "estimating"), eq(deals.stage, "proposal_sent"))
    )
  );
}

export async function getPipelineForecast() {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return [];
}
