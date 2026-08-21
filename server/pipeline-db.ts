import { getDb } from "./db";
import { leads, deals, clients, projects, leadActivities } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logAudit } from "./audit";
import { assertSameTenant, tenantFilter, tenantWhere, withTenant } from "./tenant-scope";
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
 * Execute DB operations with full Supabase auth context.
 * Sets JWT claims so auth.uid() returns the real userId,
 * satisfying both RLS policies AND trigger functions.
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
  tenantId?: string | null,
) {
  return withSupabaseAuth(userId, async (db) => {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) throw new Error("Lead not found");

    // The lead is loaded by primary key, so the tenant has to be asserted here.
    if (!assertSameTenant(lead.tenantId, tenantId)) {
      throw new PipelineTenantError("Lead belongs to a different tenant.");
    }

    // Every row created by the conversion inherits the lead's tenant.
    const rowTenantId = lead.tenantId ?? tenantId ?? null;

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

    // Step 4: Update lead status to "converted"
    console.log("[ConvertLead] Step 4: Updating lead status...");
    try {
      await db.update(leads)
        .set({ status: "converted", updatedAt: now })
        .where(eq(leads.id, leadId));
      console.log("[ConvertLead] Step 4 OK: lead marked converted");
    } catch (e: any) {
      console.warn("[ConvertLead] Step 4 FAILED (non-critical):", e.message);
    }

    // Step 5: Record activity (non-critical)
    try {
      await db.insert(leadActivities).values({
        id: randomUUID(),
        leadId,
        activityType: "status_change",
        description: `Lead converted to Deal #${dealId} and Project #${projectId}`,
        createdAt: now,
      });
    } catch (e) {
      console.warn("[Pipeline] Could not record lead activity:", e);
    }

    // Step 6: Log audit (non-critical)
    try {
      await logAudit({
        userId,
        action: "pipeline.convert_lead",
        tableName: "deals",
        recordId: dealId,
        before: { status: lead.status },
        after: { status: "converted" },
      });
    } catch (e) {
      console.warn("[Pipeline] Could not log audit:", e);
    }

    console.log("[ConvertLead] ALL STEPS DONE. clientId=%s projectId=%s dealId=%s", clientId, projectId, dealId);
    return { clientId, projectId, dealId, id: dealId };
  });
}

export async function orchestrateDealWin(
  dealId: string,
  userId: string,
  tenantId?: string | null,
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
 * Bypass RLS for read operations (no trigger auth issues on SELECT).
 */
async function bypassRLS<T>(fn: (db: DbHandle) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL role = 'postgres'`);
    return fn(tx as any);
  });
}

export async function getFullPipelineState(dealId: string, tenantId?: string | null) {
  return bypassRLS(async (db) => {
    // This read bypasses RLS, so the tenant scope has to come from the query itself.
    const [deal] = await db.select().from(deals).where(tenantWhere(deals, tenantId, eq(deals.id, dealId))).limit(1);
    if (!deal) return null;

    const [lead] = deal.leadId ? await db.select().from(leads).where(tenantWhere(leads, tenantId, eq(leads.id, deal.leadId))).limit(1) : [null];

    return { deal, lead };
  });
}

export async function getPipelineOverviewData(tenantId?: string | null) {
  return bypassRLS(async (db) => {
    // This read bypasses RLS, so the tenant scope has to come from the query itself.
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
