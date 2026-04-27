import { describe, it, expect } from "vitest";
import { 
  buildLeadConversionPayload, 
  buildDealWinPayload, 
  getPipelineSummary, 
  validatePipelineIntegrity,
  calculateFunnelMetrics
} from "../shared/pipeline-orchestrator";
import { Lead, Deal } from "../drizzle/schema";

describe("Pipeline Orchestrator Engine", () => {
  describe("buildLeadConversionPayload", () => {
    const mockLead: Lead = {
      id: "1",
      source: "website",
      name: "John Doe",
      email: "john@example.com",
      phone: "555-0199",
      address: "123 Main St",
      city: "Charleston",
      state: "SC",
      zip: "29401",
      serviceType: "kitchen",
      service: "roof",
      urgency: "medium",
      leadScore: 0,
      status: "qualified",
      ownerUserId: null,
      notes: "Looking for full remodel",
      tags: null,
      latitude: null,
      longitude: null,
      lat: null,
      lng: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should return valid payloads for happy path", () => {
      const result = buildLeadConversionPayload(mockLead);

      expect(result.clientPayload).toMatchObject({
        name: "John Doe",
        email: "john@example.com",
        phone: "555-0199",
        address: "123 Main St",
        city: "Charleston",
        state: "SC",
        zip: "29401",
      });

      expect(result.dealPayload).toMatchObject({
        stage: "discovery",
      });

      expect(result.projectPayload).toMatchObject({
        name: "John Doe - kitchen",
        status: "intake",
        address: "123 Main St",
        city: "Charleston",
        state: "SC",
        zip: "29401",
      });
    });

    it("should include service type in deal name", () => {
      const result = buildLeadConversionPayload(mockLead);
      expect(result.dealPayload.name).toContain("kitchen");
    });

    it("should handle null value by defaulting to null", () => {
      const result = buildLeadConversionPayload(mockLead);
      expect(result.dealPayload.value).toBeNull();
    });

    it("should handle missing name by defaulting to Unknown", () => {
      const namelessLead = { ...mockLead, name: "" };
      const result = buildLeadConversionPayload(namelessLead);
      expect(result.clientPayload.name).toBe("Unknown");
    });

    it("should handle missing serviceType gracefully", () => {
      const noServiceLead = { ...mockLead, serviceType: null } as any;
      const result = buildLeadConversionPayload(noServiceLead);
      expect(result.dealPayload.name).toContain("New Deal");
    });
  });

  describe("buildDealWinPayload", () => {
    const mockDeal: Deal = {
      id: "1",
      leadId: "1",
      name: "Kitchen Remodel",
      stage: "negotiation",
      value: "60000.00",
      closureDate: null,
      notes: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should return valid deal win payload", () => {
      const result = buildDealWinPayload(mockDeal);
      expect(result.valid).toBe(true);
      expect((result as any).dealUpdate.stage).toBe("won");
      expect((result as any).dealUpdate.closureDate).toBeDefined();
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

    it("should group projects by status", () => {
      const projects = [
        { status: "intake" },
        { status: "intake" },
        { status: "in_progress" },
      ];
      const result = getPipelineSummary([], [], projects as any);
      expect(result.projectsByStatus).toEqual({ intake: 2, in_progress: 1 });
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
      const lead: any = { name: "Jane Smith", source: "direct", serviceType: "remodel" };
      const conversion = buildLeadConversionPayload(lead);
      const deal: any = { ...conversion.dealPayload, id: "deal-1" };
      const win = buildDealWinPayload(deal);

      expect(win.valid).toBe(true);
      expect(win.dealUpdate?.stage).toBe("won");
    });
  });
});
