import { describe, it, expect } from "vitest";
import {
  calculateWeightedPipeline,
  calculateWinProbability,
  forecastRevenue,
  suggestNextAction,
  detectStaleDeal,
  validateStageTransition
} from "../shared/deal-engine";
import type { DealStage } from "../shared/domain/taxonomy";

describe("Sprint 25: Deal Engine", () => {
  describe("calculateWeightedPipeline", () => {
    it("1. returns 0 for empty array", () => {
      const res = calculateWeightedPipeline([]);
      expect(res.total).toBe(0);
      expect(Object.keys(res.byStage).length).toBe(0);
    });

    it("2. computes correct total and breakdown for deals", () => {
      const deals = [
        { stage: "discovery" as DealStage, value: "1000", probability: 20 },
        { stage: "estimating" as DealStage, value: "5000", probability: 50 },
        { stage: "discovery" as DealStage, value: "2000", probability: 10 },
      ];
      const res = calculateWeightedPipeline(deals as any);
      
      // Expected total: 1000 * 0.2 + 5000 * 0.5 + 2000 * 0.1 = 200 + 2500 + 200 = 2900
      expect(res.total).toBe(2900);
      expect(res.byStage["discovery"]).toBe(400); // 200 + 200
      expect(res.byStage["estimating"]).toBe(2500);
    });
  });

  describe("calculateWinProbability", () => {
    it("3. sets baseline based on stage", () => {
      expect(calculateWinProbability({ stage: "discovery" } as any)).toBe(10);
      expect(calculateWinProbability({ stage: "estimating" } as any)).toBe(50);
      expect(calculateWinProbability({ stage: "negotiation" } as any)).toBe(80);
      expect(calculateWinProbability({ stage: "won" } as any)).toBe(100);
      expect(calculateWinProbability({ stage: "lost" } as any)).toBe(0);
    });

    it("4. adjusts based on service types matching historically high close rates", () => {
      // Base for discovery is 10, kitchen adds +15 = 25
      expect(calculateWinProbability({ stage: "discovery", serviceTypes: ["kitchen"] } as any)).toBe(25);
    });

    it("5. accumulates probabilities correctly", () => {
      expect(calculateWinProbability({ stage: "negotiation", serviceTypes: ["kitchen", "bathroom"] } as any)).toBe(99);
    });
  });

  describe("forecastRevenue", () => {
    it("6. calculates best, worst, expected cleanly", () => {
      const deals = [
        { value: "10000", probability: 50 },
        { value: "5000", probability: 20 },
      ];
      const res = forecastRevenue(deals as any, "monthly");
      // Expected: sum(val * prob) = 5000 + 1000 = 6000
      // Best: sum(val) = 15000
      // Worst: sum(val * (prob > 80 ? 1 : 0)) = 0
      expect(res.expected).toBe(6000);
      expect(res.best).toBe(15000);
      expect(res.worst).toBe(0);
    });
  });

  describe("suggestNextAction", () => {
    it("7. discovery stage", () => {
      const res = suggestNextAction({ stage: "discovery" });
      expect(res.action).toContain("Schedule site visit");
    });
    it("8. estimating with estimate linked", () => {
      const res = suggestNextAction({ stage: "estimating", estimateId: 1 });
      expect(res.action).toContain("Send proposal");
    });
    it("9. negotiation urgency", () => {
      const res = suggestNextAction({ stage: "negotiation" });
      expect(res.urgency).toBe("high");
    });
  });

  describe("detectStaleDeal", () => {
    it("10. identifies stale deal after 14 days", () => {
      const twentyDaysAgo = new Date();
      twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);
      const res = detectStaleDeal({ stage: "discovery" }, twentyDaysAgo);
      expect(res.isStale).toBe(true);
      expect(res.daysSinceLastActivity).toBe(20);
    });

    it("11. not stale if recently updated", () => {
      const res = detectStaleDeal({ stage: "discovery" }, new Date());
      expect(res.isStale).toBe(false);
      expect(res.daysSinceLastActivity).toBe(0);
    });

    it("12. won or lost deals are never stale", () => {
      const twentyDaysAgo = new Date();
      twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);
      expect(detectStaleDeal({ stage: "won" }, twentyDaysAgo).isStale).toBe(false);
    });
  });

  describe("validateStageTransition", () => {
    it("13. allows sequential progression", () => {
      expect(validateStageTransition("discovery", "site_visit")).toBe(true);
      expect(validateStageTransition("site_visit", "estimating")).toBe(true);
      expect(validateStageTransition("proposal_sent", "negotiation")).toBe(true);
    });

    it("14. rejects jumping backwards", () => {
      expect(validateStageTransition("negotiation", "discovery")).toBe(false);
    });

    it("15. allows any stage to go to lost", () => {
      expect(validateStageTransition("discovery", "lost")).toBe(true);
      expect(validateStageTransition("negotiation", "lost")).toBe(true);
    });

    it("16. allows new deal to start anywhere", () => {
      expect(validateStageTransition(null, "discovery")).toBe(true);
      expect(validateStageTransition(undefined, "estimating")).toBe(true);
    });

    // --- ADDITIONAL EDGE CASE TESTS ---

    it("17. calculateWeightedPipeline gracefully handles string values and missing probabilities", () => {
      const deals = [
        { stage: "discovery" as DealStage, value: "1000" }, // missing prob -> assumes 0 or uses probability?
        { stage: "estimating" as DealStage, value: null, probability: 50 },
      ];
      const res = calculateWeightedPipeline(deals as any);
      expect(res.total).toBe(0);
    });

    it("18. calculateWinProbability considers bathroom service +10%", () => {
      expect(calculateWinProbability({ stage: "discovery", serviceTypes: ["bathroom"] } as any)).toBe(20);
    });

    it("19. calculateWinProbability considers remodel service +5%", () => {
      expect(calculateWinProbability({ stage: "discovery", serviceTypes: ["remodel"] } as any)).toBe(15);
    });

    it("20. calculateWinProbability caps at 99% for non-won deals", () => {
      expect(calculateWinProbability({ stage: "negotiation", serviceTypes: ["kitchen", "bathroom", "remodel"] } as any)).toBe(99);
    });

    it("21. calculateWinProbability applies channel boosts", () => {
      expect(calculateWinProbability({ stage: "estimating", channel: "insurance" } as any)).toBe(60); // 50 + 10
    });

    it("22. forecastRevenue ignores deals without value", () => {
      const deals = [{ value: null, probability: 100 }];
      const res = forecastRevenue(deals as any, "monthly");
      expect(res.expected).toBe(0);
    });

    it("23. forecastRevenue worst case includes ONLY highly probable deals (>80%)", () => {
      const deals = [
        { value: "100", probability: 80 },
        { value: "100", probability: 81 },
      ];
      const res = forecastRevenue(deals as any, "monthly");
      expect(res.worst).toBe(100);
    });

    it("24. suggestNextAction: site_visit", () => {
      expect(suggestNextAction({ stage: "site_visit" }).action).toContain("Perform site measurement");
    });

    it("25. suggestNextAction: proposal_sent", () => {
      expect(suggestNextAction({ stage: "proposal_sent" }).action).toContain("Follow up on proposal");
    });

    it("26. suggestNextAction: won", () => {
      expect(suggestNextAction({ stage: "won" }).action).toContain("Onboard client");
    });

    it("27. suggestNextAction: lost", () => {
      expect(suggestNextAction({ stage: "lost" }).action).toContain("Archive deal");
    });

    it("28. detectStaleDeal: 13 days is NOT stale", () => {
      const date = new Date();
      date.setDate(date.getDate() - 13);
      expect(detectStaleDeal({ stage: "estimating" }, date).isStale).toBe(false);
    });

    it("29. detectStaleDeal: exactly 14 days IS stale", () => {
      const date = new Date();
      date.setDate(date.getDate() - 14);
      expect(detectStaleDeal({ stage: "estimating" }, date).isStale).toBe(true);
    });

    it("30. detectStaleDeal: uses deal.updatedAt if date param missing", () => {
      const twentyDaysAgo = new Date();
      twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);
      expect(detectStaleDeal({ stage: "estimating", updatedAt: twentyDaysAgo } as any).isStale).toBe(true);
    });

    it("31. detectStaleDeal: handles missing dates gracefully", () => {
      expect(detectStaleDeal({ stage: "estimating" } as any).isStale).toBe(false);
    });

    it("32. validateStageTransition: allows skipping stages forward", () => {
      expect(validateStageTransition("discovery", "estimating")).toBe(true);
      expect(validateStageTransition("site_visit", "won")).toBe(true);
    });

    it("33. validateStageTransition: blocks 'won' to active active stages", () => {
      expect(validateStageTransition("won", "negotiation")).toBe(false);
    });

    it("34. validateStageTransition: blocks 'lost' to active stages", () => {
      expect(validateStageTransition("lost", "discovery")).toBe(false);
    });
    
    it("35. validateStageTransition: allows won to lost (e.g. refund/cancellation)", () => {
      expect(validateStageTransition("won", "lost")).toBe(true);
    });

    it("36. validateStageTransition: blocks invalid strings", () => {
      expect(validateStageTransition("discovery", "fake" as any)).toBe(false);
    });
  });
});
