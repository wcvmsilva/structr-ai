import { Lead, Deal, Client, Project, EstimateDraft } from "../drizzle/schema";

export function buildLeadConversionPayload(lead: Lead) {
  const serviceTypes = lead.serviceTypeInterest
    ? lead.serviceTypeInterest.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  
  const clientChannel = lead.channel ?? "direct";

  return {
    clientPayload: {
      uuid: crypto.randomUUID(),
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      channel: clientChannel as "direct" | "insurance" | "commercial",
      source: lead.source,
    },
    dealPayload: {
      nanoid: lead.nanoid + "_deal", // Unique enough for engine test
      title: `${lead.firstName} ${lead.lastName} - ${lead.serviceTypeInterest || "New Deal"}`,
      stage: "discovery" as const,
      value: lead.estimatedBudget || "0.00",
      probability: 10,
      weightedValue: (parseFloat(lead.estimatedBudget || "0") * 0.1).toFixed(2),
      serviceTypes,
      channel: lead.channel,
      assignedTo: lead.assignedTo,
    },
    projectPayload: {
      uuid: crypto.randomUUID(),
      name: `${lead.firstName} ${lead.lastName} - ${lead.serviceTypeInterest || "New Project"}`,
      status: "intake" as const,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zipCode: lead.zip,
      channel: lead.channel,
    },
  };
}

export function buildDealWinPayload(deal: Deal) {
  if (!deal.projectId) {
    return { valid: false, reason: "Deal has no linked project" };
  }

  const now = new Date();

  return {
    valid: true,
    dealUpdate: {
      stage: "won" as const,
      actualCloseDate: now,
      probability: 100,
      weightedValue: deal.value,
    },
    projectUpdate: {
      status: deal.estimateId ? ("approved" as const) : ("in_progress" as const),
      updatedAt: now,
    },
    estimateUpdate: deal.estimateId ? {
      status: "approved" as const,
      approvedAt: now,
    } : null,
  };
}

export function getPipelineSummary(leads: any[], deals: any[], projects: any[]) {
  const leadsByStatus = leads.reduce((acc: any, lead: any) => {
    acc[lead.status] = (acc[lead.status] || 0) + 1;
    return acc;
  }, {});

  const dealsByStage = deals.reduce((acc: any, deal: any) => {
    acc[deal.stage] = (acc[deal.stage] || 0) + 1;
    return acc;
  }, {});

  const projectsByStatus = projects.reduce((acc: any, project: any) => {
    acc[project.status] = (acc[project.status] || 0) + 1;
    return acc;
  }, {});

  const totalValue = deals.reduce((sum: number, deal: any) => {
    const val = parseFloat(deal.weightedValue || "0");
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
  const totalLeads = leads.length;
  const convertedLeads = leads.filter(l => l.status === "converted").length;
  const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
  
  const totalDealValue = deals.reduce((sum: number, deal: any) => {
    const val = parseFloat(deal.value || "0");
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
  const avgDealValue = deals.length > 0 ? totalDealValue / deals.length : 0;

  return {
    leadsByStatus,
    dealsByStage,
    projectsByStatus,
    pipelineValue: totalValue,
    conversionRate,
    avgDealValue,
    totalLeads,
    totalDeals: deals.length,
    totalProjects: projects.length,
  };
}

export function validatePipelineIntegrity(deal: any, lead: any, client: any, project: any, estimate: any) {
  const issues: string[] = [];

  if (deal.leadId && !lead) issues.push(`Lead ${deal.leadId} not found`);
  if (deal.clientId && !client) issues.push(`Client ${deal.clientId} not found`);
  if (deal.projectId && !project) issues.push(`Project ${deal.projectId} not found`);
  if (deal.estimateId && !estimate) issues.push(`Estimate ${deal.estimateId} not found`);

  if (deal.stage === "won") {
    if (!deal.projectId) issues.push("Won deal has no linked project");
    if (!deal.actualCloseDate) issues.push("Won deal has no close date");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function calculateFunnelMetrics(counts: {
  totalLeads: number;
  qualifiedLeads: number;
  totalDeals: number;
  proposalsSent: number;
  dealsWon: number;
}) {
  const { totalLeads, qualifiedLeads, totalDeals, proposalsSent, dealsWon } = counts;

  const getRate = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

  return {
    overallConversionRate: getRate(dealsWon, totalLeads),
    stages: [
      { name: "Leads", count: totalLeads, conversionFromPrevious: totalLeads > 0 ? 100 : 0 },
      { name: "Qualified", count: qualifiedLeads, conversionFromPrevious: getRate(qualifiedLeads, totalLeads) },
      { name: "Deals", count: totalDeals, conversionFromPrevious: getRate(totalDeals, qualifiedLeads) },
      { name: "Proposals", count: proposalsSent, conversionFromPrevious: getRate(proposalsSent, totalDeals) },
      { name: "Won", count: dealsWon, conversionFromPrevious: getRate(dealsWon, proposalsSent) },
    ],
  };
}
