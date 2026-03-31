import { getDb, getRawClient } from "./db";
import { leads, leadActivities, profiles } from "../drizzle/schema";
import { eq, and, desc, asc, like, or, sql, gte, lte } from "drizzle-orm";
import type { Lead, InsertLead, InsertLeadActivity, LeadActivity } from "../drizzle/schema";

/**
 * Execute a DB operation with full Supabase auth context.
 *
 * Problem: The leads table has BEFORE INSERT triggers (auto_assign_lead_owner,
 * set_lead_owner) that call auth.uid(). When connecting via postgres.js directly
 * (not through PostgREST), auth.uid() returns NULL because there's no JWT context.
 * The trigger then raises: "Authentication required to create leads" (P0001).
 *
 * Fix: Set the Supabase JWT claims and role inside a transaction so auth.uid()
 * returns the real user ID. This satisfies both RLS policies AND trigger functions.
 *
 * SET LOCAL ensures these settings only apply within the transaction boundary,
 * which is safe for PgBouncer transaction pooling (port 6543).
 *
 * @param userId - The real profile UUID to use as auth.uid()
 * @param fn - The database operation to execute
 */
async function withSupabaseAuth<T>(
  userId: string,
  fn: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return db.transaction(async (tx) => {
    // Set JWT claims so auth.uid() returns the correct user ID
    const claims = JSON.stringify({
      sub: userId,
      role: "authenticated",
      iss: "structr-server",
      aud: "authenticated",
    });
    // SET LOCAL doesn't support bind params — use sql.raw() with sanitized JSON
    // Safety: claims is built from controlled JSON.stringify (no user input in keys)
    const safeClaims = claims.replace(/'/g, "''");
    await tx.execute(sql.raw(`SET LOCAL request.jwt.claims = '${safeClaims}'`));
    await tx.execute(sql.raw(`SET LOCAL role = 'authenticated'`));

    return fn(tx as any);
  });
}

/**
 * Execute a DB operation bypassing all auth (RLS + triggers).
 * Uses postgres superuser role. Triggers still fire but auth.uid() will be NULL.
 * Use withSupabaseAuth() instead for tables with auth-checking triggers.
 */
async function bypassRLS<T>(fn: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL role = 'postgres'`);
    return fn(tx as any);
  });
}

/**
 * Ensure a profile row exists for the given userId.
 * This prevents FK violations on leads.owner_user_id → profiles.id.
 */
export async function ensureProfileExists(userId: string, fullName: string) {
  return bypassRLS(async (db) => {
    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) {
      console.log("[ensureProfile] Creating profile for", userId);
      await db.insert(profiles).values({
        id: userId,
        fullName,
        role: "admin",
      });
      console.log("[ensureProfile] Profile created");
    } else {
      console.log("[ensureProfile] Profile already exists for", userId);
    }
  });
}

export async function createLead(
  data: Omit<InsertLead, "id" | "createdAt" | "updatedAt">,
  userId?: string,
) {
  console.log("[createLead] Inserting with keys:", Object.keys(data).join(", "));

  // Leads table has BEFORE INSERT triggers that check auth.uid().
  // We must set the Supabase auth context so the trigger doesn't raise P0001.
  const authId = userId || data.ownerUserId || null;

  if (authId) {
    return withSupabaseAuth(authId, async (db) => {
      const [result] = await db.insert(leads).values(data).returning();
      return result as Lead;
    });
  }

  // Fallback: no user ID available — use superuser bypass (trigger may still block)
  return bypassRLS(async (db) => {
    const [result] = await db.insert(leads).values(data).returning();
    return result as Lead;
  });
}

export async function getLeadById(id: string): Promise<Lead | null> {
  return bypassRLS(async (db) => {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return lead ?? null;
  });
}

export async function listLeads(opts?: {
  status?: string;
  urgency?: string;
  ownerUserId?: string;
  dateRange?: { start: Date; end: Date };
}) {
  return bypassRLS(async (db) => {
    let query = db.select().from(leads).$dynamic();
    const conditions = [];

    if (opts?.status) conditions.push(eq(leads.status, opts.status as any));
    if (opts?.urgency) conditions.push(eq(leads.urgency, opts.urgency as any));
    if (opts?.ownerUserId) conditions.push(eq(leads.ownerUserId, opts.ownerUserId));
    if (opts?.dateRange) {
      conditions.push(gte(leads.createdAt, opts.dateRange.start));
      conditions.push(lte(leads.createdAt, opts.dateRange.end));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(desc(leads.createdAt));
  });
}

export async function updateLead(id: string, data: Partial<InsertLead>, userId?: string) {
  // Use Supabase auth context if userId is available (triggers may check auth.uid() on UPDATE too)
  const executor = userId ? withSupabaseAuth.bind(null, userId) : bypassRLS;

  return executor(async (db: any) => {
    const [before] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!before) throw new Error("Lead not found");

    await db.update(leads).set(data).where(eq(leads.id, id));
    const [updated] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return updated as Lead;
  });
}

export async function updateLeadStatus(id: string, status: Lead["status"], userId?: string) {
  const data: Partial<InsertLead> = { status };
  return updateLead(id, data, userId);
}

export async function qualifyLead(id: string) {
  return updateLeadStatus(id, "qualified");
}

export async function disqualifyLead(id: string, reason: string) {
  const result = await updateLeadStatus(id, "disqualified");

  await addLeadActivity({
    leadId: id,
    activityType: "status_change",
    description: `Lead disqualified: ${reason}`,
  });

  return result;
}

export async function addLeadActivity(data: Omit<InsertLeadActivity, "id" | "createdAt">) {
  return bypassRLS(async (db) => {
    const [result] = await db.insert(leadActivities).values(data).returning();
    return result.id;
  });
}

export async function getLeadActivities(leadId: string) {
  return bypassRLS(async (db) => {
    return db.select().from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt));
  });
}

export async function searchLeads(queryStr: string) {
  return bypassRLS(async (db) => {
    const searchParam = `%${queryStr}%`;
    return db.select().from(leads).where(
      or(
        like(leads.name, searchParam),
        like(leads.email, searchParam),
        like(leads.phone, searchParam),
        like(leads.address, searchParam)
      )
    ).orderBy(desc(leads.createdAt)).limit(50);
  });
}

export async function getLeadStats() {
  return bypassRLS(async (db) => {
    const total = await db.select({ count: sql<number>`count(*)` }).from(leads);
    const byStatus = await db.select({
      status: leads.status,
      count: sql<number>`count(*)`
    }).from(leads).groupBy(leads.status);

    return {
      total: total[0]?.count ?? 0,
      byStatus: byStatus.reduce((acc, row) => ({ ...acc, [row.status as string]: row.count }), {} as Record<string, number>),
    };
  });
}
