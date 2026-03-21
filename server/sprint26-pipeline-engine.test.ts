import { describe, it, expect } from "vitest";
import { 
  buildLeadConversionPayload, 
  buildDealWinPayload, 
  getPipelineSummary, 
  validatePipelineIntegrity,
  calculateFunnelMetrics
} from "../shared/pipeline-orchestrator";
import { Lead, Deal, Client, Project } from "../drizzle/schema";

describe("Pipeline Orchestrator Engine", () => {
  describe("buildLeadConversionPayload", () => {
    const mockLead: Lead = {
      id: 1,
      nanoid: "lead_123",
      source: "website",
      channel: "direct",
      status: "qualified",
      priority: "hot",
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "555-0199",
      address: "123 Main St",
      city: "Charleston",
      state: "SC",
      zip: "29401",
      serviceTypeInterest: "kitchen, bathroom",
      estimatedBudget: "50000.00",
      notes: "Looking for full remodel",
      assignedTo: 1,
      qualifiedAt: new Date(),
      convertedAt: null,
      disqualifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 1,
      deletedAt: null,
    };

    it("should return valid payloads for happy path", () => {
      const result = buildLeadConversionPayload(mockLead);
      
      expect(result.clientPayload).toMatchObject({
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "555-0199",
        address: "123 Main St",
        city: "Charleston",
        state: "SC",
        zip: "29401",
        channel: "residential", // derived from lead channel 'direct'
      });

      expect(result.dealPayload).toMatchObject({
        stage: "discovery",
        value: "50000.00",
        probability: 10,
        serviceTypes: ["kitchen", "bathroom"],
      });

      expect(result.projectPayload).toMatchObject({
        name: "John Doe - kitchen, bathroom",
        status: "intake",
        address: "123 Main St",
        city: "Charleston",
        state: "SC",
        zipCode: "29401",
      });
    });

    it("should map commercial channel correctly", () => {
      const commercialLead = { ...mockLead, channel: "commercial" as const };
      const result = buildLeadConversionPayload(commercialLead);
      expect(result.clientPayload.channel).toBe("commercial");
    });

    it("should handle null budget by defaulting to 0", () => {
      const noBudgetLead = { ...mockLead, estimatedBudget: null };
      const result = buildLeadConversionPayload(noBudgetLead);
      expect(result.dealPayload.value).toBe("0.00");
    });

    it("should handle missing names by defaulting to empty strings", () => {
      const namelessLead = { ...mockLead, firstName: null, lastName: null };
      const result = buildLeadConversionPayload(namelessLead);
      expect(result.clientPayload.firstName).toBe("");
      expect(result.clientPayload.lastName).toBe("");
    });

    it("should handle whitespace and multiple commas in serviceTypeInterest", () => {
      const messyLead = { ...mockLead, serviceTypeInterest: " kitchen , , bathroom " };
      const result = buildLeadConversionPayload(messyLead);
      expect(result.dealPayload.serviceTypes).toEqual(["kitchen", "bathroom"]);
    });
  });

  describe("buildDealWinPayload", () => {
    const mockDeal: Deal = {
      id: 1,
      nanoid: "deal_123",
      leadId: 1,
      clientId: 1,
      projectId: 1,
      title: "Kitchen Remodel",
      stage: "negotiation",
      value: "60000.00",
      probability: 90,
      weightedValue: "54000.00",
      expectedCloseDate: new Date(),
      actualCloseDate: null,
      lostReason: null,
      serviceTypes: ["kitchen"],
      channel: "direct",
      region: "charleston",
      zone: "standard",
      assignedTo: 1,
      estimateId: 101,
      notes: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 1,
      deletedAt: null,
    };

    it("should return approved status when estimateId exists", () => {
      const result = buildDealWinPayload(mockDeal);
      expect(result.valid).toBe(true);
      expect(result.projectUpdate?.status).toBe("approved");
      expect(result.estimateUpdate?.status).toBe("approved");
      expect((result as any).dealUpdate.stage).toBe("won");
      expect((result as any).dealUpdate.actualCloseDate).toBeInstanceOf(Date);
    });

    it("should return in_progress status when estimateId is missing", () => {
      const noEstimateDeal = { ...mockDeal, estimateId: null };
      const result = buildDealWinPayload(noEstimateDeal);
      expect(result.projectUpdate?.status).toBe("in_progress");
      expect(result.estimateUpdate).toBeNull();
    });

    it("should return error if projectId is missing", () => {
      const noProjectDeal = { ...mockDeal, projectId: null };
      const result = buildDealWinPayload(noProjectDeal);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Deal has no linked project");
    });
  });

  describe("getPipelineSummary", () => {
    it("should calculate summary metrics correctly", () => {
      const leads = [
        { status: "new" as const },
        { status: "qualified" as const },
        { status: "qualified" as const },
        { status: "converted" as const },
      ];
      const deals = [
        { stage: "discovery" as const, value: "10000", probability: 10, weightedValue: "1000" },
        { stage: "won" as const, value: "20000", probability: 100, weightedValue: "20000" },
      ];
      const projects = [{ status: "intake" as const }];

      const result = getPipelineSummary(leads as any, deals as any, projects as any);

      expect(result.leadsByStatus).toEqual({ new: 1, qualified: 2, converted: 1 });
      expect(result.dealsByStage).toEqual({ discovery: 1, won: 1 });
      expect(result.pipelineValue).toBe(21000);
      expect(result.conversionRate).toBe(25); // 1/4 * 100
      expect(result.avgDealValue).toBe(15000);
      expect(result.totalLeads).toBe(4);
      expect(result.totalDeals).toBe(2);
      expect(result.totalProjects).toBe(1);
    });

    it("should handle empty arrays without crashing", () => {
      const result = getPipelineSummary([], [], []);
      expect(result.pipelineValue).toBe(0);
      expect(result.conversionRate).toBe(0);
      expect(result.avgDealValue).toBe(0);
    });

    it("should handle non-numeric values gracefully in sum", () => {
      const badDeals = [
        { value: "invalid", weightedValue: "not a number" },
        { value: "100.00", weightedValue: "10.00" }
      ];
      const result = getPipelineSummary([], badDeals as any, []);
      expect(result.pipelineValue).toBe(10);
      expect(result.avgDealValue).toBe(50); // (0 + 100) / 2
    });
  });

  describe("validatePipelineIntegrity", () => {
    const mockDeal: Deal = {
      id: 1,
      leadId: 10,
      clientId: 20,
      projectId: 30,
      estimateId: 40,
      stage: "won",
      actualCloseDate: new Date(),
    } as any;

    it("should return true for consistent state", () => {
      const result = validatePipelineIntegrity(mockDeal, { id: 10 } as any, { id: 20 } as any, { id: 30 } as any, { id: 40 } as any);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should catch missing entities", () => {
      const result = validatePipelineIntegrity(mockDeal, null, null, null, null);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Lead 10 not found");
      expect(result.issues).toContain("Client 20 not found");
      expect(result.issues).toContain("Project 30 not found");
      expect(result.issues).toContain("Estimate 40 not found");
    });

    it("should catch won deal without project or close date", () => {
      const brokenDeal = { ...mockDeal, projectId: null, actualCloseDate: null };
      const result = validatePipelineIntegrity(brokenDeal, { id: 10 } as any, { id: 20 } as any, null, { id: 40 } as any);
      expect(result.issues).toContain("Won deal has no linked project");
      expect(result.issues).toContain("Won deal has no close date");
    });

    it("should only validate entities that are specified on the deal", () => {
      const sparseDeal = { id: 1, stage: "discovery" } as any;
      const result = validatePipelineIntegrity(sparseDeal, null, null, null, null);
      expect(result.valid).toBe(true);
    });
  });

  describe("calculateFunnelMetrics", () => {
    it("should calculate conversion rates correctly", () => {
      const counts = {
        totalLeads: 100,
        qualifiedLeads: 50,
        totalDeals: 30,
        proposalsSent: 15,
        dealsWon: 5,
      };

      const result = calculateFunnelMetrics(counts);

      expect(result.overallConversionRate).toBe(5);
      expect(result.stages[1].conversionFromPrevious).toBe(50); // 50/100
      expect(result.stages[2].conversionFromPrevious).toBe(60); // 30/50
    });

    it("should handle zero leads by returning 0 conversion", () => {
      const result = calculateFunnelMetrics({
        totalLeads: 0,
        qualifiedLeads: 0,
        totalDeals: 0,
        proposalsSent: 0,
        dealsWon: 0,
      });
      expect(result.overallConversionRate).toBe(0);
      expect(result.stages.every(s => s.conversionFromPrevious === 0)).toBe(true);
    });

    it("should handle more wins than proposals (edge case) gracefully", () => {
      const result = calculateFunnelMetrics({
        totalLeads: 10,
        qualifiedLeads: 10,
        totalDeals: 10,
        proposalsSent: 5,
        dealsWon: 10,
      });
      expect(result.stages[4].conversionFromPrevious).toBe(200); // 10/5 * 100
    });

    it("should handle zero proposals but some wins (edge case) gracefully", () => {
      const result = calculateFunnelMetrics({
        totalLeads: 10,
        qualifiedLeads: 10,
        totalDeals: 10,
        proposalsSent: 0,
        dealsWon: 1,
      });
      expect(result.stages[4].conversionFromPrevious).toBe(0);
    });
  });

  describe("Integration-like Engine Scenarios", () => {
    it("should flow through lead to conversion then deal win with consistent state", () => {
      const lead: any = { firstName: "Jane", lastName: "Smith", channel: "direct", estimatedBudget: "100" };
      const conversion = buildLeadConversionPayload(lead);
      const deal: any = { ...conversion.dealPayload, projectId: 555, estimateId: null };
      const win = buildDealWinPayload(deal);
      
      expect(win.valid).toBe(true);
      expect(win.projectUpdate?.status).toBe("in_progress");
    });
  });
});
