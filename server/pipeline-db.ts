import { getDb } from "./db";
import { leads, deals, clients, projects, leadActivities } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logAudit } from "./audit";
import { assertSameTenant, tenantFilter, tenantWhere, withTenant } from "./tenant-scope";
import { assertLeadInScope } from "./lead-access";
import {
  findExistingConversionForLead,
  resolveActorLeadScope,
  resolveConvertedProjectOwner,
} from "./lead-conversion-identity";
import { buildLeadConversionPayload, buildDealWinPayload, getPipelineSummary } from "../shared/pipeline-orchestrator";
import { randomUUID } from "crypto";

/** Non-nullable DB handle used inside transaction callbacks. */
type DbHandle = PostgresJsDatabase;

/**
 * Raised when the caller references a lead/deal owned by another tenant.
 * Mirrors the `TENANT_MISMATCH` contract of server/lead-conversion.ts; routers map it
 * to FORBIDDEN.
 */
export class PipelineTenantError extends Error {
  public readonly code = "TENANT_MISMATCH" as const;

  constructor(message: string) {
    super(message);
    this.name = "PipelineTenantError";
  }
}

/**
 * Raised for the identity/replay failures this writer now checks: an actor that is not
 * an active profile of the caller's tenant, a persisted lead owner that no longer
 * resolves to one, or an existing-conversion marker/correlation that cannot be verified
 * consistently. Never exposes another tenant's row content in its message.
 */
export class PipelineConversionIdentityError extends Error {
  constructor(
    public readonly code: "ACTOR_INVALID" | "OWNER_INVALID" | "CONVERSION_LINK_INCONSISTENT" | "CONVERSION_LINK_AMBIGUOUS",
    message: string,
  ) {
    super(message);
    this.name = "PipelineConversionIdentityError";
  }
}

/**
 * Legacy trigger context for pipeline writes. A supplied profile ID is not proof
 * of a verified Supabase subject. This still requires permission to assume
 * `authenticated`; reconciling that identity/trigger contract is a separate gate.
 */
async function withSupabaseAuth<T>(
  userId: string,
  fn: (db: DbHandle) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  return db.transaction(async (tx) => {
    const claims = JSON.stringify({
      sub: userId,
      role: "authenticated",
      iss: "structr-server",
      aud: "authenticated",
    });
    // SET LOCAL doesn't support bind params — use sql.raw() with sanitized JSON
    const safeClaims = claims.replace(/'/g, "''");
    await tx.execute(sql.raw(`SET LOCAL request.jwt.claims = '${safeClaims}'`));
    await tx.execute(sql.raw(`SET LOCAL role = 'authenticated'`));
    return fn(tx as any);
  });
}

export async function orchestrateLeadConversion(
  leadId: string,
  userId: string,
  tenantId: string,
) {
  return withSupabaseAuth(userId, async (db) => {
    // Locked: the whole function runs in one transaction (withSupabaseAuth), and this is
    // the ONE row both conversion entry points coordinate on. Lock order is fixed and
    // shared with convertLeadToProject: the lead row is always locked first, before any
    // project row is read or created — neither writer ever acquires a project lock before
    // its own lead lock, so no inversion between the two routes is possible.
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1).for("update");
    if (!lead) throw new Error("Lead not found");

    // The lead is loaded by primary key, so the tenant has to be asserted here.
    if (!assertSameTenant(lead.tenantId, tenantId)) {
      throw new PipelineTenantError("Lead belongs to a different tenant.");
    }

    // Revalidated fresh, in this handle — never trusted from the caller. Applies the same
    // shared/owner-scope/admin policy every other lead route already applies (lead-access.ts).
    const actorScope = await resolveActorLeadScope(db, userId, tenantId);
    if (!actorScope.ok) {
      throw new PipelineConversionIdentityError(
        "ACTOR_INVALID",
        "The converting actor is not an active profile of this tenant.",
      );
    }
    assertLeadInScope(lead, actorScope.scope);

    // Replay: a lead that already has a verifiable conversion returns its existing ids —
    // AFTER authorization above, never before. The LEGACY shape always returns a dealId,
    // so a project found with no matching deal is inconsistent for THIS caller, not "found".
    const existing = await findExistingConversionForLead(
      db,
      tenantId,
      leadId,
      lead.convertedProjectId,
      lead.convertedClientId,
      { requireDeal: true },
    );
    if (existing.status === "found") {
      return { clientId: existing.clientId, projectId: existing.projectId, dealId: existing.dealId as string, id: existing.dealId as string };
    }
    if (existing.status === "ambiguous") {
      throw new PipelineConversionIdentityError(
        "CONVERSION_LINK_AMBIGUOUS",
        "More than one project or deal is linked to this lead; refusing to guess which one to return.",
      );
    }
    if (existing.status === "inconsistent") {
      throw new PipelineConversionIdentityError(
        "CONVERSION_LINK_INCONSISTENT",
        "This lead is marked converted, but no consistent project/client/deal set could be verified for it.",
      );
    }

    // Owner: preserved when valid, actor-fallback only when the lead has none, refused
    // (never silently substituted) when the persisted owner no longer resolves.
    const ownerResolution = await resolveConvertedProjectOwner(db, tenantId, lead.ownerUserId, userId);
    if (!ownerResolution.ok) {
      throw new PipelineConversionIdentityError(
        "OWNER_INVALID",
        "The lead's persisted owner is not an active profile of this tenant.",
      );
    }
    const ownerUserId = ownerResolution.ownerUserId;

    // Every row created by the conversion inherits the lead's tenant. B2: `tenantId` is
    // always present, so the previous `?? null` arm — which silently created untenanted
    // client/project/deal rows — is gone. A conversion now always produces owned rows.
    const rowTenantId = lead.tenantId ?? tenantId;

    const payload = buildLeadConversionPayload(lead);

    const clientId = randomUUID();
    const projectId = randomUUID();
    const dealId = randomUUID();

    const now = new Date();
    const leadName = lead.name || "Unknown";

    // Step 1: Create client
    console.log("[ConvertLead] Step 1: Creating client...");
    try {
      await db.insert(clients).values(withTenant({
        id: clientId,
        name: leadName,
        email: lead.email || null,
        phone: lead.phone || null,
        company: null,
        address: lead.address || null,
        city: lead.city || null,
        state: lead.state || null,
        zip: lead.zip || null,
        notes: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }, rowTenantId));
      console.log("[ConvertLead] Step 1 OK: client created", clientId);
    } catch (e: any) {
      console.error("[ConvertLead] Step 1 FAILED:", e.message, e.code, e.detail, e.constraint);
      throw new Error(`Client insert failed: ${e.message} | code=${e.code} | detail=${e.detail || "none"}`);
    }

    // Step 2: Create project
    console.log("[ConvertLead] Step 2: Creating project...");
    try {
      await db.insert(projects).values(withTenant({
        id: projectId,
        name: `${leadName} - ${lead.serviceType || "New Project"}`,
        clientName: leadName,
        clientEmail: lead.email || null,
        address: lead.address || null,
        city: lead.city || null,
        state: lead.state || null,
        zip: lead.zip || null,
        projectType: lead.serviceType || "remodel",
        status: "intake",
        // The client just created in THIS conversion (step 1, same transaction) — never a
        // lookup by name.
        clientId: clientId,
        // Resolved above: the lead's own valid owner, or the validated actor when the
        // lead has none — never the actor "for convenience" over a persisted owner.
        ownerUserId: ownerUserId,
        leadId: leadId,
        notes: null,
        createdAt: now,
        updatedAt: now,
      }, rowTenantId));
      console.log("[ConvertLead] Step 2 OK: project created", projectId);
    } catch (e: any) {
      console.error("[ConvertLead] Step 2 FAILED:", e.message, e.code, e.detail);
      throw new Error(`Project insert failed: ${e.message} | code=${e.code} | detail=${e.detail || "none"}`);
    }

    // Step 3: Create deal
    console.log("[ConvertLead] Step 3: Creating deal...");
    try {
      await db.insert(deals).values(withTenant({
        id: dealId,
        leadId: leadId,
        name: `${leadName} - ${lead.serviceType || "New Deal"}`,
        stage: "discovery",
        value: null,
        notes: `Converted from lead. Service: ${lead.serviceType || "N/A"}. Source: ${lead.source || "N/A"}.`,
        createdAt: now,
        updatedAt: now,
      }, rowTenantId));
      console.log("[ConvertLead] Step 3 OK: deal created", dealId);
    } catch (e: any) {
      console.error("[ConvertLead] Step 3 FAILED:", e.message, e.code, e.detail);
      throw new Error(`Deal insert failed: ${e.message} | code=${e.code} | detail=${e.detail || "none"}`);
    }

    // Step 4: Update lead status to "converted" — no longer non-critical: a client/
    // project/deal set must not commit for a lead the DB never actually marked converted.
    console.log("[ConvertLead] Step 4: Updating lead status...");
    const [leadUpdated] = await db.update(leads)
      .set({
        status: "converted",
        updatedAt: now,
        // Previously omitted entirely — the sibling writer's own replay check (and this
        // one's, on a future call) depends on these being set here too, not just on the
        // modern route.
        convertedClientId: clientId,
        convertedProjectId: projectId,
        convertedAt: now,
      })
      .where(eq(leads.id, leadId))
      .returning({ id: leads.id });
    if (!leadUpdated) {
      throw new Error("Lead status update failed: expected row not found or not affected");
    }
    console.log("[ConvertLead] Step 4 OK: lead marked converted");

    // Step 5: Record activity — part of the conversion record now, not best-effort.
    const [activityInserted] = await db.insert(leadActivities).values({
      id: randomUUID(),
      leadId,
      activityType: "status_change",
      description: `Lead converted to Deal #${dealId} and Project #${projectId}`,
      createdAt: now,
    }).returning({ id: leadActivities.id });
    if (!activityInserted) {
      throw new Error("Lead activity insert failed: no row returned");
    }

    // Step 6: Audit — same transaction handle as the mutations above; a failed or empty
    // return aborts the whole conversion instead of logging a warning next to a real write.
    const dealAuditLogged = await logAudit({
      userId,
      action: "pipeline.convert_lead",
      tableName: "deals",
      recordId: dealId,
      before: { status: lead.status },
      after: { status: "converted" },
    }, db);
    if (!dealAuditLogged) {
      throw new Error("Audit insert failed for pipeline.convert_lead (deals)");
    }

    // A second, project-scoped event: the deal-scoped event above is not findable by a
    // tableName="projects" query even though this same operation creates a project.
    const projectAuditLogged = await logAudit({
      userId,
      action: "pipeline.convert_lead",
      tableName: "projects",
      recordId: projectId,
      before: null,
      after: { leadId, clientId, dealId, tenantId: rowTenantId, status: "intake" },
    }, db);
    if (!projectAuditLogged) {
      throw new Error("Audit insert failed for pipeline.convert_lead (projects)");
    }

    console.log("[ConvertLead] ALL STEPS DONE. clientId=%s projectId=%s dealId=%s", clientId, projectId, dealId);
    return { clientId, projectId, dealId, id: dealId };
  });
}

export async function orchestrateDealWin(
  dealId: string,
  userId: string,
  tenantId: string,
) {
  return withSupabaseAuth(userId, async (db) => {
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal) throw new Error("Deal not found");

    // The deal is loaded by primary key, so the tenant has to be asserted here.
    if (!assertSameTenant(deal.tenantId, tenantId)) {
      throw new PipelineTenantError("Deal belongs to a different tenant.");
    }

    const payload = buildDealWinPayload(deal);
    if (!payload.valid) {
      return { success: false, reason: "Invalid deal state" };
    }

    const oldStage = deal.stage;

    // Update Deal — only closureDate and stage exist in deals table
    await db.update(deals)
      .set({
        stage: payload.dealUpdate!.stage,
        closureDate: payload.dealUpdate!.closureDate,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, dealId));

    // Log audit
    try {
      await logAudit({
        userId,
        action: "pipeline.deal_won",
        tableName: "deals",
        recordId: dealId,
        before: { stage: oldStage },
        after: { stage: payload.dealUpdate!.stage },
      });
    } catch (e) {
      console.warn("[Pipeline] Could not log audit:", e);
    }

    return { success: true, id: dealId };
  });
}

/**
 * Preserve the connection's grants and RLS for scoped read operations.
 */
async function withApplicationTransaction<T>(fn: (db: DbHandle) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");
  return db.transaction(async (tx) => {
    return fn(tx as any);
  });
}

export async function getFullPipelineState(dealId: string, tenantId: string) {
  return withApplicationTransaction(async (db) => {
    // Keep the explicit tenant predicate in addition to effective RLS policies.
    const [deal] = await db.select().from(deals).where(tenantWhere(deals, tenantId, eq(deals.id, dealId))).limit(1);
    if (!deal) return null;

    const [lead] = deal.leadId ? await db.select().from(leads).where(tenantWhere(leads, tenantId, eq(leads.id, deal.leadId))).limit(1) : [null];

    return { deal, lead };
  });
}

export async function getPipelineOverviewData(tenantId: string) {
  return withApplicationTransaction(async (db) => {
    // Keep the explicit tenant predicate in addition to effective RLS policies.
    const allLeads = await db.select().from(leads).where(tenantFilter(leads, tenantId)) || [];
    const allDeals = await db.select().from(deals).where(tenantFilter(deals, tenantId)) || [];
    const allProjects = await db.select().from(projects).where(tenantFilter(projects, tenantId)) || [];

    const summary = getPipelineSummary(allLeads, allDeals, allProjects);

    return {
      summary,
      funnel: {
        totalLeads: allLeads.length,
        qualifiedLeads: allLeads.filter(l => l.status === "qualified").length,
        totalDeals: allDeals.length,
        proposalsSent: allDeals.filter(d => d.value !== null && parseFloat(String(d.value)) > 0).length,
        dealsWon: allDeals.filter(d => d.stage === "won").length,
      },
      revenue: {
        pipelineValue: summary.pipelineValue,
        totalDealValue: allDeals.reduce((sum, d) => sum + (parseFloat(String(d.value || 0))), 0),
      }
    };
  });
}
