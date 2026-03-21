import { getDb } from "./db";
import { deals, dealActivities, dealStageHistory } from "../drizzle/schema";
import { eq, and, desc, asc, like, or, sql, gte, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { withAuditLog } from "./audit";
import type { Deal, InsertDeal, InsertDealActivity, DealActivity, DealStageHistory } from "../drizzle/schema";
import type { DealStage } from "../shared/domain/taxonomy";

export async function createDeal(data: Omit<InsertDeal, "id" | "nanoid" | "createdAt" | "updatedAt"> & { createdBy?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const newId = nanoid(10);
  
  return withAuditLog(
    { userId: data.createdBy || 0, action: "deal.create", tableName: "deals" },
    null,
    async () => {
      const [result] = await db.insert(deals).values({
        ...data,
        nanoid: newId,
      });

      return getDealById(result.insertId) as Promise<Deal>;
    }
  );
}

export async function getDealById(id: number): Promise<Deal | null> {
  const db = await getDb();
  if (!db) return null;

  const [deal] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return deal ?? null;
}

export async function listDeals(opts?: { stage?: string; assignedTo?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  let query = db.select().from(deals).$dynamic();
  const conditions = [];

  if (opts?.stage) conditions.push(eq(deals.stage, opts.stage as any));
  if (opts?.assignedTo) conditions.push(eq(deals.assignedTo, opts.assignedTo));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return query;
}

export async function updateDeal(id: number, data: Partial<Deal>, updatedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const before = await getDealById(id);
  if (!before) throw new Error("Deal not found");

  return withAuditLog(
    { userId: updatedBy, action: "deal.update", tableName: "deals" },
    before,
    async () => {
      await db.update(deals).set({ ...data, updatedAt: new Date() }).where(eq(deals.id, id));
      return getDealById(id) as any;
    }
  );
}

export async function updateDealStage(id: number, newStage: DealStage, changedBy: number, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const deal = await getDealById(id);
  if (!deal) throw new Error("Deal not found");

  if (deal.stage === newStage) return deal;

  const dwellTimeDays = Math.floor((new Date().getTime() - new Date(deal.updatedAt).getTime()) / (1000 * 3600 * 24));

  return withAuditLog(
    { userId: changedBy, action: "deal.update_stage", tableName: "deals" },
    deal,
    async () => {
      return db.transaction(async (tx) => {
        await tx.update(deals).set({ stage: newStage, updatedAt: new Date() }).where(eq(deals.id, id));
        await tx.insert(dealStageHistory).values({
          dealId: id,
          fromStage: deal.stage,
          toStage: newStage,
          changedBy,
          changedAt: new Date(),
          dwellTimeDays,
          notes,
        });

        const [updatedDeal] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
        return updatedDeal as any;
      });
    }
  );
}

export async function markWon(id: number, projectId: number, actualCloseDate: Date, changedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");
  
  const deal = await getDealById(id);
  if (!deal) throw new Error("Deal not found");

  return withAuditLog(
    { userId: changedBy, action: "deal.mark_won", tableName: "deals" },
    deal,
    async () => {
      await db.update(deals).set({ stage: "won", projectId, actualCloseDate, updatedAt: new Date() }).where(eq(deals.id, id));
      return getDealById(id) as any;
    }
  );
}

export async function markLost(id: number, lostReason: string, changedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");
  
  const deal = await getDealById(id);
  if (!deal) throw new Error("Deal not found");

  return withAuditLog(
    { userId: changedBy, action: "deal.mark_lost", tableName: "deals" },
    deal,
    async () => {
      await db.update(deals).set({ stage: "lost", lostReason, updatedAt: new Date() }).where(eq(deals.id, id));
      return getDealById(id) as any;
    }
  );
}

export async function linkEstimate(id: number, estimateId: number, changedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const deal = await getDealById(id);
  if (!deal) throw new Error("Deal not found");

  return withAuditLog(
    { userId: changedBy, action: "deal.link_estimate", tableName: "deals" },
    deal,
    async () => {
      await db.update(deals).set({ estimateId, updatedAt: new Date() }).where(eq(deals.id, id));
      return getDealById(id) as any;
    }
  );
}

export async function addDealActivity(data: Omit<InsertDealActivity, "id" | "createdAt" | "performedAt"> & { performedAt?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [result] = await db.insert(dealActivities).values({
    ...data,
    performedAt: data.performedAt || new Date(),
  });

  return result.insertId;
}

export async function getDealActivities(dealId: number): Promise<DealActivity[]> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return db.select().from(dealActivities).where(eq(dealActivities.dealId, dealId)).orderBy(desc(dealActivities.performedAt));
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

  // Simplified version, complex math should use deal-engine.ts
  return [];
}
