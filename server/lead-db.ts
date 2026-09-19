import { getDb } from "./db";
import { logAudit } from "./audit";
import { leads, leadActivities, profiles } from "../drizzle/schema";
import { eq, and, desc, asc, like, or, sql, gte, lte } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Lead, InsertLead, InsertLeadActivity, LeadActivity } from "../drizzle/schema";
// Authorization: every lead read/write is scoped to the caller's tenant (and, when
// LEADS_OWNER_SCOPE is on, to the leads they own). See server/lead-access.ts.
import { assertLeadInScope, leadScopeWhere, type LeadScope } from "./lead-access";

/** Non-nullable DB handle used inside transaction callbacks. */
type DbHandle = PostgresJsDatabase;

/**
 * Legacy trigger context for lead writes. The supplied actor is an internal profile
 * ID; this does not prove that it equals a verified Supabase subject. The connection
 * must already be authorized to assume `authenticated`. Missing grants fail closed;
 * this helper never falls back to a privileged role. Replacing this legacy claim
 * binding requires an independently verified auth/trigger contract.
 * SET LOCAL limits these settings to the transaction (including pooled connections).
 */
async function withSupabaseAuth<T>(
  userId: string,
  fn: (db: DbHandle) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return db.transaction(async (tx) => {
    // Preserve the existing trigger context; do not infer external subject identity.
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

/** Run scoped work with the connection's existing grants and RLS policies. */
async function withApplicationTransaction<T>(fn: (db: DbHandle) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");
  return db.transaction(async (tx) => fn(tx as DbHandle));
}

export class LeadProfileError extends Error {
  constructor(readonly code: "PROFILE_NOT_ALLOWED" | "DB_UNAVAILABLE") {
    super(code === "PROFILE_NOT_ALLOWED"
      ? "An active profile in the current tenant is required"
      : "Unable to verify the lead profile");
    this.name = "LeadProfileError";
  }
}

/** Validate the persisted internal profile without provisioning or changing roles. */
export async function requireExistingLeadProfile(userId: string, tenantId: string): Promise<void> {
  if (!userId || !tenantId) throw new LeadProfileError("PROFILE_NOT_ALLOWED");

  let eligible: boolean;
  try {
    const db = await getDb();
    if (!db) throw new LeadProfileError("DB_UNAVAILABLE");
    const [profile] = await db.select({ id: profiles.id }).from(profiles).where(and(
      eq(profiles.id, userId),
      eq(profiles.tenantId, tenantId),
      eq(profiles.isActive, true),
    )).limit(1);
    eligible = Boolean(profile);
  } catch {
    // Database details must not become part of the authorization error contract.
    throw new LeadProfileError("DB_UNAVAILABLE");
  }

  if (!eligible) throw new LeadProfileError("PROFILE_NOT_ALLOWED");
}

export async function createLead(
  data: Omit<InsertLead, "id" | "createdAt" | "updatedAt">,
  userId?: string,
) {
  // The route supplies the authenticated actor after resolving its tenant scope.
  // A writable payload owner is not authentication, and absence never elevates.
  if (!userId) throw new LeadProfileError("PROFILE_NOT_ALLOWED");
  return withSupabaseAuth(userId, async (db) => {
    const [result] = await db.insert(leads).values(data).returning();
    return result as Lead;
  });
}

export async function getLeadById(id: string, scope: LeadScope): Promise<Lead | null> {
  return withApplicationTransaction(async (db) => {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!lead) return null;

    // Authorization decision before the row is returned: another tenant's lead is
    // reported as "not found", never handed back to the caller.
    assertLeadInScope(lead, scope);

    return lead;
  });
}

export async function listLeads(scope: LeadScope, opts?: {
  status?: string;
  urgency?: string;
  ownerUserId?: string;
  dateRange?: { start: Date; end: Date };
}) {
  return withApplicationTransaction(async (db) => {
    const conditions: Array<SQL | undefined> = [];

    if (opts?.status) conditions.push(eq(leads.status, opts.status as any));
    if (opts?.urgency) conditions.push(eq(leads.urgency, opts.urgency as any));
    if (opts?.ownerUserId) conditions.push(eq(leads.ownerUserId, opts.ownerUserId));
    if (opts?.dateRange) {
      conditions.push(gte(leads.createdAt, opts.dateRange.start));
      conditions.push(lte(leads.createdAt, opts.dateRange.end));
    }

    // The caller's scope is applied before any domain filter and is never optional.
    return db
      .select()
      .from(leads)
      .where(leadScopeWhere(scope, ...conditions))
      .orderBy(desc(leads.createdAt));
  });
}

export async function updateLead(
  id: string,
  data: Partial<InsertLead>,
  scope: LeadScope,
  userId?: string,
) {
  if (!scope.userId || (userId !== undefined && userId !== scope.userId)) {
    throw new LeadProfileError("PROFILE_NOT_ALLOWED");
  }
  return withSupabaseAuth(scope.userId, async (db) => {
    const [before] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!before) throw new Error("Lead not found");

    // Authorization decision before the mutation.
    assertLeadInScope(before, scope);

    // Scope repeated in the UPDATE predicate so the write itself can never reach a
    // row outside the caller's scope.
    await db.update(leads).set(data).where(leadScopeWhere(scope, eq(leads.id, id)));
    const [updated] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return updated as Lead;
  });
}

export async function updateLeadStatus(
  id: string,
  status: Lead["status"],
  scope: LeadScope,
  userId?: string,
) {
  const data: Partial<InsertLead> = { status };
  return updateLead(id, data, scope, userId);
}

export async function qualifyLead(id: string, scope: LeadScope) {
  return updateLeadStatus(id, "qualified", scope);
}

export async function disqualifyLead(id: string, reason: string, scope: LeadScope) {
  const result = await updateLeadStatus(id, "disqualified", scope);

  await addLeadActivity({
    leadId: id,
    activityType: "status_change",
    description: `Lead disqualified: ${reason}`,
  }, scope);

  return result;
}

/**
 * Is this lead inside the caller's scope?
 *
 * `lead_activities` has no `tenant_id` of its own — it inherits the tenant of its parent
 * lead — so activity reads/writes are scoped through this check, mirroring
 * `dealExistsInTenant()` in deal-db.ts. The parent lookup reuses `leadScopeWhere()`, so
 * the caller's tenant (and, when LEADS_OWNER_SCOPE is on, ownership) applies exactly as
 * it does to the lead itself, in addition to the connection's effective RLS policies.
 */
async function leadExistsInScope(
  db: DbHandle,
  leadId: string,
  scope: LeadScope,
): Promise<boolean> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(leadScopeWhere(scope, eq(leads.id, leadId)))
    .limit(1);

  return Boolean(lead);
}

export async function addLeadActivity(
  data: Omit<InsertLeadActivity, "id" | "createdAt">,
  scope: LeadScope,
) {
  return withApplicationTransaction(async (db) => {
    // A lead outside the caller's scope is reported exactly like a missing one.
    if (!(await leadExistsInScope(db, data.leadId, scope))) {
      throw new Error("Lead not found");
    }

    const [result] = await db.insert(leadActivities).values(data).returning();
    await logAudit({
      userId: scope.userId,
      action: "lead.activity_created",
      tableName: "lead_activities",
      recordId: result.id,
      before: null,
      after: result,
    }, db);
    return result.id;
  });
}

export async function getLeadActivities(leadId: string, scope: LeadScope) {
  return withApplicationTransaction(async (db) => {
    if (!(await leadExistsInScope(db, leadId, scope))) return [];

    return db.select().from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt));
  });
}

export async function searchLeads(queryStr: string, scope: LeadScope) {
  return withApplicationTransaction(async (db) => {
    const searchParam = `%${queryStr}%`;
    return db.select().from(leads).where(
      leadScopeWhere(
        scope,
        or(
          like(leads.name, searchParam),
          like(leads.email, searchParam),
          like(leads.phone, searchParam),
          like(leads.address, searchParam)
        ),
      )
    ).orderBy(desc(leads.createdAt)).limit(50);
  });
}

export async function getLeadStats(scope: LeadScope) {
  return withApplicationTransaction(async (db) => {
    const total = await db.select({ count: sql<number>`count(*)` }).from(leads).where(leadScopeWhere(scope));
    const byStatus = await db.select({
      status: leads.status,
      count: sql<number>`count(*)`
    }).from(leads).where(leadScopeWhere(scope)).groupBy(leads.status);

    return {
      total: total[0]?.count ?? 0,
      byStatus: byStatus.reduce((acc, row) => ({ ...acc, [row.status as string]: row.count }), {} as Record<string, number>),
    };
  });
}
