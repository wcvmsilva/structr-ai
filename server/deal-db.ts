import { getDb } from "./db";
import { deals, dealActivities, dealStageHistory } from "../drizzle/schema";
import { eq, and, desc, asc, like, or, sql, gte, lte } from "drizzle-orm";
import { withAuditLog } from "./audit";
import type { Deal, InsertDeal, InsertDealActivity, DealActivity, DealStageHistory } from "../drizzle/schema";

// Schema:
// deals: id, leadId, name, stage, value, closureDate, notes, createdAt, updatedAt
// dealActivities: id, dealId, activityType, description, createdAt
// dealStageHistory: id, dealId, previousStage, newStage, changedAt

export async function createDeal(data: Omit<InsertDeal, "id" | "createdAt" | "updatedAt"> & { createdBy?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return withAuditLog(
    { userId: data.createdBy ?? null, action: "deal.create", tableName: "deals" },
    null,
    async () => {
      const [result] = await db.insert(deals).values({
        name: data.name,
        leadId: data.leadId ?? null,
        stage: data.stage ?? "discovery",
        value: data.value ?? null,
        closureDate: data.closureDate ?? null,
        notes: data.notes ?? null,
      }).returning();

      return result;
    }
  );
}

export async function getDealById(id: string): Promise<Deal | null> {
  const db = await getDb();
  if (!db) return null;

  const [deal] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return deal ?? null;
}

export async function listDeals(opts?: { stage?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  let query = db.select().from(deals).$dynamic();
  const conditions = [];

  if (opts?.stage) conditions.push(eq(deals.stage, opts.stage));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return query;
}

export async function updateDeal(id: string, data: Partial<Deal>, updatedBy?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const before = await getDealById(id);
  if (!before) throw new Error("Deal not found");

  return withAuditLog(
    { userId: updatedBy ?? null, action: "deal.update", tableName: "deals" },
    before,
    async () => {
      await db.update(deals).set({ ...data, updatedAt: new Date() }).where(eq(deals.id, id));
      return getDealById(id) as any;
    }
  );
}

export async function updateDealStage(id: string, newStage: string, changedBy?: string, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const deal = await getDealById(id);
  if (!deal) throw new Error("Deal not found");

  if (deal.stage === newStage) return deal;

  return withAuditLog(
    { userId: changedBy ?? null, action: "deal.update_stage", tableName: "deals" },
    deal,
    async () => {
      return db.transaction(async (tx) => {
        await tx.update(deals).set({ stage: newStage, updatedAt: new Date() }).where(eq(deals.id, id));
        await tx.insert(dealStageHistory).values({
          dealId: id,
          previousStage: deal.stage,
          newStage,
        });

        const [updatedDeal] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
        return updatedDeal as any;
      });
    }
  );
}

export async function addDealActivity(data: Omit<InsertDealActivity, "id" | "createdAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [result] = await db.insert(dealActivities).values(data).returning();
  return result;
}

export async function getDealActivities(dealId: string): Promise<DealActivity[]> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return db.select().from(dealActivities).where(eq(dealActivities.dealId, dealId)).orderBy(desc(dealActivities.createdAt));
}

export async function getDealStats() {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [stats] = await db.select({ total: sql<number>`count(*)` }).from(deals);
  return stats;
}

export async function getStaleDeals() {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  return db.select().from(deals).where(
    and(
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
