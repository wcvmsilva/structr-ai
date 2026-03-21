import { getDb } from "./db";
import { leads, leadActivities, clients, projects } from "../drizzle/schema";
import { eq, and, desc, asc, like, or, sql, gte, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { withAuditLog } from "./audit";
import type { Lead, InsertLead, InsertLeadActivity, LeadActivity } from "../drizzle/schema";
import { convertLeadToClient, validateLeadForConversion } from "@shared/lead-engine";

export async function createLead(data: Omit<InsertLead, "id" | "nanoid" | "createdAt" | "updatedAt"> & { createdBy?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const newId = nanoid(10);
  
  return withAuditLog(
    { userId: data.createdBy || 0, action: "lead.create", tableName: "leads" },
    null,
    async () => {
      const [result] = await db.insert(leads).values({
        ...data,
        nanoid: newId,
      });

      return getLeadById(result.insertId) as Promise<Lead>;
    }
  );
}

export async function getLeadById(id: number): Promise<Lead | null> {
  const db = await getDb();
  if (!db) return null;

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return lead ?? null;
}

export async function listLeads(opts?: {
  status?: string;
  priority?: string;
  assignedTo?: number;
  dateRange?: { start: Date; end: Date };
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  let query = db.select().from(leads).$dynamic();
  const conditions = [];

  if (opts?.status) conditions.push(eq(leads.status, opts.status as any));
  if (opts?.priority) conditions.push(eq(leads.priority, opts.priority as any));
  if (opts?.assignedTo) conditions.push(eq(leads.assignedTo, opts.assignedTo));
  if (opts?.dateRange) {
    conditions.push(gte(leads.createdAt, opts.dateRange.start));
    conditions.push(lte(leads.createdAt, opts.dateRange.end));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return query.orderBy(desc(leads.createdAt));
}

export async function updateLead(id: number, data: Partial<InsertLead>, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const before = await getLeadById(id);
  if (!before) throw new Error("Lead not found");

  return withAuditLog(
    { userId, action: "lead.update", tableName: "leads" },
    before,
    async () => {
      await db.update(leads).set(data).where(eq(leads.id, id));
      return getLeadById(id) as Promise<Lead>;
    }
  );
}

export async function updateLeadStatus(id: number, status: Lead["status"], userId: number) {
  const data: Partial<InsertLead> = { status };
  
  if (status === "qualified") data.qualifiedAt = new Date();
  else if (status === "disqualified") data.disqualifiedAt = new Date();
  else if (status === "converted") data.convertedAt = new Date();

  return updateLead(id, data, userId);
}

export async function qualifyLead(id: number, userId: number) {
  return updateLeadStatus(id, "qualified", userId);
}

export async function disqualifyLead(id: number, reason: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const result = await updateLeadStatus(id, "disqualified", userId);
  
  await addLeadActivity({
    leadId: id,
    activityType: "status_change",
    description: `Lead disqualified: ${reason}`,
    performedBy: userId,
  });

  return result;
}


export async function addLeadActivity(data: Omit<InsertLeadActivity, "id" | "createdAt" | "performedAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [result] = await db.insert(leadActivities).values(data);
  return result.insertId;
}

export async function getLeadActivities(leadId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.performedAt));
}

export async function searchLeads(queryStr: string) {
  const db = await getDb();
  if (!db) return [];

  const searchParam = `%${queryStr}%`;

  return db.select().from(leads).where(
    or(
      like(leads.firstName, searchParam),
      like(leads.lastName, searchParam),
      like(leads.email, searchParam),
      like(leads.phone, searchParam),
      like(leads.address, searchParam)
    )
  ).orderBy(desc(leads.createdAt)).limit(50);
}

export async function getLeadStats() {
  const db = await getDb();
  if (!db) return null;

  const total = await db.select({ count: sql<number>`count(*)` }).from(leads);
  const byStatus = await db.select({
    status: leads.status,
    count: sql<number>`count(*)`
  }).from(leads).groupBy(leads.status);

  return {
    total: total[0]?.count ?? 0,
    byStatus: byStatus.reduce((acc, row) => ({ ...acc, [row.status]: row.count }), {}),
  };
}
