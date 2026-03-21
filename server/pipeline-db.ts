import { getDb } from "./db";
import { leads, deals, clients, projects, auditLogs, estimateDrafts, leadActivities } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { withAuditLog } from "./audit";
import { buildLeadConversionPayload, buildDealWinPayload, getPipelineSummary } from "../shared/pipeline-orchestrator";

export async function orchestrateLeadConversion(leadId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error("Lead not found");
  if (lead.status !== "qualified") throw new Error("Lead must be qualified before conversion");

  const payload = buildLeadConversionPayload(lead);

  return withAuditLog(
    { userId, action: "pipeline.convert_lead", tableName: "deals" },
    { status: lead.status },
    async () => {
      return await db.transaction(async (tx) => {
        // 1. Create client
        const [clientRes] = await tx.insert(clients).values({
          ...payload.clientPayload,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const clientId = clientRes.insertId;

        // 2. Create project
        const [projectRes] = await tx.insert(projects).values({
          ...payload.projectPayload,
          clientId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const projectId = projectRes.insertId;

        // 3. Create deal
        const [dealRes] = await tx.insert(deals).values({
          ...payload.dealPayload,
          leadId,
          clientId,
          projectId,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: userId,
        });
        const dealId = dealRes.insertId;

        // 4. Update lead status
        await tx.update(leads)
          .set({ status: "converted", convertedAt: new Date() })
          .where(eq(leads.id, leadId));

        // 5. Record activity
        await tx.insert(leadActivities).values({
          leadId,
          activityType: "status_change",
          description: `Lead converted to Deal #${dealId} and Project #${projectId}`,
          performedBy: userId,
        });

        return { clientId, projectId, dealId, id: dealId }; // include id for withAuditLog recordId
      });
    }
  );
}

export async function orchestrateDealWin(dealId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new Error("Deal not found");

  const payload = buildDealWinPayload(deal);
  if (!payload.valid) {
    return { success: false, reason: payload.reason };
  }

  return withAuditLog(
    { userId, action: "pipeline.deal_won", tableName: "deals" },
    { stage: deal.stage, projectId: deal.projectId },
    async () => {
      await db.transaction(async (tx) => {
        // 1. Update Deal
        await tx.update(deals)
          .set(payload.dealUpdate as any)
          .where(eq(deals.id, dealId));

        // 2. Update Project
        if (deal.projectId) {
          await tx.update(projects)
            .set(payload.projectUpdate as any)
            .where(eq(projects.id, deal.projectId));
        }

        // 3. Update Estimate
        if (deal.estimateId && payload.estimateUpdate) {
          await tx.update(estimateDrafts)
            .set(payload.estimateUpdate as any)
            .where(eq(estimateDrafts.id, deal.estimateId));
        }
      });

      return { success: true, id: dealId };
    }
  );
}

export async function getFullPipelineState(dealId: number) {
  const db = await getDb();
  if (!db) return null;

  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return null;

  const [lead] = deal.leadId ? await db.select().from(leads).where(eq(leads.id, deal.leadId)).limit(1) : [null];
  const [client] = deal.clientId ? await db.select().from(clients).where(eq(clients.id, deal.clientId)).limit(1) : [null];
  const [project] = deal.projectId ? await db.select().from(projects).where(eq(projects.id, deal.projectId)).limit(1) : [null];
  const [estimate] = deal.estimateId ? await db.select().from(estimateDrafts).where(eq(estimateDrafts.id, deal.estimateId)).limit(1) : [null];

  return { deal, lead, client, project, estimate };
}

export async function getPipelineOverviewData() {
  const db = await getDb();
  if (!db) return { summary: null };

  const allLeads = await db.select().from(leads) || [];
  const allDeals = await db.select().from(deals) || [];
  const allProjects = await db.select().from(projects) || [];

  const summary = getPipelineSummary(allLeads, allDeals, allProjects);

  return {
    summary,
    funnel: {
      totalLeads: allLeads.length,
      qualifiedLeads: allLeads.filter(l => l.status === "qualified").length,
      totalDeals: allDeals.length,
      proposalsSent: allDeals.filter(d => d.estimateId !== null).length,
      dealsWon: allDeals.filter(d => d.stage === "won").length,
    },
    revenue: {
      pipelineValue: summary.pipelineValue,
      weightedValue: allDeals.reduce((sum, d) => sum + parseFloat(d.weightedValue || "0"), 0),
    }
  };
}
