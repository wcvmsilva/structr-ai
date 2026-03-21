import type { Lead } from "../drizzle/schema";
import { detectZoneFromZip, CHARLESTON_ZONES } from "./geo-engine";

export function scoreLead(lead: Lead): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // +20 if serviceTypeInterest matches high-value trades (kitchen, bathroom, roofing)
  if (lead.serviceTypeInterest && /kitchen|bathroom|roofing/i.test(lead.serviceTypeInterest)) {
    score += 20;
    factors.push("High-value trade (+20)");
  }

  // +15 if estimatedBudget > $50k
  // -20 if budget < $5k
  if (lead.estimatedBudget) {
    const budget = parseFloat(lead.estimatedBudget.toString());
    if (budget > 50000) {
      score += 15;
      factors.push("Budget > 50k (+15)");
    } else if (budget < 5000) {
      score -= 20;
      factors.push("Budget < 5k (-20)");
    }
  }

  // +10 if zip in Charleston service radius (reuse geo-engine)
  // -10 if zip outside service radius
  if (lead.zip) {
    const zoneResult = detectZoneFromZip(lead.zip, CHARLESTON_ZONES as any);
    if (zoneResult.zone) {
      score += 10;
      factors.push("In service radius (+10)");
    } else {
      score -= 10;
      factors.push("Outside service radius (-10)");
    }
  }

  // +10 if source is referral
  if (lead.source === "referral") {
    score += 10;
    factors.push("Referral source (+10)");
  }

  // +5 if has email AND phone
  if (lead.email && lead.phone) {
    score += 5;
    factors.push("Has email and phone (+5)");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    factors,
  };
}

export function classifyPriority(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

export function validateLeadForConversion(lead: Lead): { valid: boolean; blockers: string[] } {
  const blockers: string[] = [];
  
  if (!lead.firstName) {
    blockers.push("Missing first name");
  }
  if (!lead.lastName) {
    blockers.push("Missing last name");
  }
  
  if (!lead.phone && !lead.email) {
    blockers.push("Must have either email or phone");
  }
  
  if (!lead.serviceTypeInterest) {
    blockers.push("Missing service type interest");
  }
  
  if (lead.status !== "qualified") {
    blockers.push("Lead status must be qualified");
  }

  return {
    valid: blockers.length === 0,
    blockers,
  };
}

export function convertLeadToClient(lead: Lead) {
  return {
    firstName: lead.firstName || "",
    lastName: lead.lastName || "",
    email: lead.email,
    phone: lead.phone,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    type: lead.channel === "commercial" ? "commercial" : "residential",
  };
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/\D/g, "");
}

export function detectDuplicateLead(
  newLead: Partial<Lead>,
  existingLeads: Lead[]
): { isDuplicate: boolean; matchedLeadId?: number } {
  
  const normEmail = newLead.email?.toLowerCase().trim();
  const normPhone = normalizePhone(newLead.phone || null);
  const normFirst = newLead.firstName?.toLowerCase().trim();
  const normLast = newLead.lastName?.toLowerCase().trim();
  const zip = newLead.zip?.trim();

  for (const existing of existingLeads) {
    // 1. Exact email match
    if (normEmail && existing.email?.toLowerCase().trim() === normEmail) {
      return { isDuplicate: true, matchedLeadId: existing.id };
    }
    
    // 2. Exact phone match
    const existingNormPhone = normalizePhone(existing.phone || null);
    if (normPhone && existingNormPhone === normPhone) {
      return { isDuplicate: true, matchedLeadId: existing.id };
    }
    
    // 3. Name + Zip match
    const existingFirst = existing.firstName?.toLowerCase().trim();
    const existingLast = existing.lastName?.toLowerCase().trim();
    
    if (
      normFirst && normLast && zip &&
      existingFirst === normFirst &&
      existingLast === normLast &&
      existing.zip?.trim() === zip
    ) {
      return { isDuplicate: true, matchedLeadId: existing.id };
    }
  }

  return { isDuplicate: false };
}
