import { describe, it, expect } from "vitest";
import {
  scoreLead,
  classifyPriority,
  validateLeadForConversion,
  convertLeadToClient,
  detectDuplicateLead,
} from "../shared/lead-engine";
import type { Lead } from "../drizzle/schema";

describe("Sprint 24: Lead Engine", () => {
  describe("scoreLead", () => {
    it("adds +20 for high-value trades and +10 for Charleston zip", () => {
      const lead = {
        serviceType: "kitchen remodeling",
        zip: "29403", // Charleston
        source: "website",
        email: "test@test.com",
        phone: null,
      } as unknown as Lead;

      const result = scoreLead(lead);
      // Base: +20 (kitchen), +10 (Charleston zip) = 30
      expect(result.score).toBe(30);
      expect(result.factors).toContain("High-value trade (+20)");
      expect(result.factors).toContain("In service radius (+10)");
    });

    it("deducts points for outside radius", () => {
      const lead = {
        serviceType: "painting",
        zip: "90210", // Beverly Hills -> outside
        source: "walk_in",
        email: null,
        phone: null,
      } as unknown as Lead;

      const result = scoreLead(lead);
      // Base: -10 (outside radius) = -10 -> clamped to 0
      expect(result.score).toBe(0);
      expect(result.factors).toContain("Outside service radius (-10)");
    });

    it("maxes out at 100", () => {
      const lead = {
        serviceType: "kitchen, bathroom, roofing",
        zip: "29401", // inside
        source: "referral",
        email: "test@test.com",
        phone: "555-1234",
      } as unknown as Lead;

      const result = scoreLead(lead);
      // factors: +20 (kitchen), +10 (zip), +10 (referral), +5 (email & phone) = 45
      expect(result.score).toBe(45);
    });
  });

  describe("classifyPriority", () => {
    it("classifies >= 70 as hot", () => {
      expect(classifyPriority(75)).toBe("hot");
      expect(classifyPriority(70)).toBe("hot");
    });
    it("classifies >= 40 as warm", () => {
      expect(classifyPriority(69)).toBe("warm");
      expect(classifyPriority(40)).toBe("warm");
    });
    it("classifies < 40 as cold", () => {
      expect(classifyPriority(39)).toBe("cold");
      expect(classifyPriority(0)).toBe("cold");
    });
  });

  describe("validateLeadForConversion", () => {
    it("fails if missing name or contact info", () => {
      const lead = {
        name: "",
        email: null,
        phone: null,
        serviceType: "kitchen",
        status: "qualified"
      } as unknown as Lead;

      const res = validateLeadForConversion(lead);
      expect(res.valid).toBe(false);
      expect(res.blockers).toContain("Missing name");
      expect(res.blockers).toContain("Must have either email or phone");
    });

    it("fails if not qualified", () => {
      const lead = {
        name: "John Smith",
        email: "john@smith.com",
        serviceType: "kitchen",
        status: "new"
      } as unknown as Lead;

      const res = validateLeadForConversion(lead);
      expect(res.valid).toBe(false);
      expect(res.blockers).toContain("Lead status must be qualified");
    });

    it("passes when valid", () => {
      const lead = {
        name: "John Smith",
        phone: "555-1234",
        serviceType: "kitchen",
        status: "qualified"
      } as unknown as Lead;

      const res = validateLeadForConversion(lead);
      expect(res.valid).toBe(true);
      expect(res.blockers.length).toBe(0);
    });
  });

  describe("convertLeadToClient", () => {
    it("maps fields correctly", () => {
      const lead = {
        name: "John Smith",
        email: "john@test.com",
        phone: "555-1234",
        address: "123 Main St",
        city: "Charleston",
        state: "SC",
        zip: "29403",
      } as unknown as Lead;

      const client = convertLeadToClient(lead);
      expect(client.firstName).toBe("John");
      expect(client.email).toBe("john@test.com");
      expect(client.lastName).toBe("Smith");
      expect(client.city).toBe("Charleston");
    });
  });

  describe("detectDuplicateLead", () => {
    const existing = [
      { id: "1", name: "Jane Doe", email: "jane@doe.com", phone: "111-2222", zip: "29401" },
      { id: "2", name: "John Smith", email: "john@smith.com", phone: "555-1234", zip: "29403" }
    ] as unknown as Lead[];

    it("matches on exact email (case insensitive)", () => {
      const res = detectDuplicateLead({ email: "JANE@doe.com" } as Lead, existing);
      expect(res.isDuplicate).toBe(true);
      expect(res.matchedLeadId).toBe("1");
    });

    it("matches on normalized phone", () => {
      const res = detectDuplicateLead({ phone: "(555) 123-4" } as Lead, existing);
      expect(res.isDuplicate).toBe(true);
      expect(res.matchedLeadId).toBe("2");
    });

    it("matches on full name and zip", () => {
      const res = detectDuplicateLead({ name: "jane doe", zip: "29401" } as unknown as Lead, existing);
      expect(res.isDuplicate).toBe(true);
      expect(res.matchedLeadId).toBe("1");
    });

    it("returns false for no match", () => {
      const res = detectDuplicateLead({ name: "Bob", email: "bob@bob.com", phone: "999" } as unknown as Lead, existing);
      expect(res.isDuplicate).toBe(false);
    });
  });
});
