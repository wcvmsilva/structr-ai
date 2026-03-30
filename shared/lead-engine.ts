import type { Lead } from "../drizzle/schema";
import { detectZoneFromZip, CHARLESTON_ZONES } from "./geo-engine";

export function scoreLead(lead: Partial<Lead>): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // +20 if serviceType matches high-value trades (kitchen, bathroom, roofing)
  const serviceType = lead.serviceType || "";
  if (serviceType && /kitchen|bathroom|roofing|remodel/i.test(serviceType)) {
    score += 20;
    factors.push("High-value trade (+20)");
  }

  // +10 if zip in Charleston service radius (reuse geo-engine)
  // -10 if zip outside service radius
  if (lead.zip) {
    try {
      const zoneResult = detectZoneFromZip(lead.zip, CHARLESTON_ZONES as any);
      if (zoneResult.zone) {
        score += 10;
        factors.push("In service radius (+10)");
      } else {
        score -= 10;
        factors.push("Outside service radius (-10)");
      }
    } catch {
      // geo-engine may not be available
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

  if (!lead.name || lead.name.trim() === "") {
    blockers.push("Missing name");
  }

  if (!lead.phone && !lead.email) {
    blockers.push("Must have either email or phone");
  }

  if (!lead.serviceType || lead.serviceType === "general") {
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
  // Split name back into parts for client record
  const nameParts = (lead.name || "").split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  return {
    firstName,
    lastName,
    email: lead.email,
    phone: lead.phone,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    type: "residential",
  };
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/\D/g, "");
}

export function detectDuplicateLead(
  newLead: Partial<Lead>,
  existingLeads: Lead[]
): { isDuplicate: boolean; matchedLeadId?: string } {

  const normEmail = newLead.email?.toLowerCase().trim();
  const normPhone = normalizePhone(newLead.phone || null);
  const normName = newLead.name?.toLowerCase().trim();
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
    const existingName = existing.name?.toLowerCase().trim();

    if (
      normName && zip &&
      existingName === normName &&
      existing.zip?.trim() === zip
    ) {
      return { isDuplicate: true, matchedLeadId: existing.id };
    }
  }

  return { isDuplicate: false };
}
