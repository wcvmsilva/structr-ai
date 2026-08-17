/**
 * PHASE 2 — Pure engine tests
 *
 * Covers the decision layer that governs the pre-visit → estimate cycle:
 *   1. Taxonomy normalization and the single-next-step rule (LIG-005, LIG-006)
 *   2. Lead → intake → project conversion: minimum data, dedupe (LIG-003, LIG-004, LIG-007)
 *   3. Pre-visit: evidence classification, price-language guard, checklist, single decision
 *   4. Geo context warnings and risk classification
 *   5. Profit Shield channel floors (28 / 18 / 15) combined with geographic floors
 *   6. JobTread reconciliation in integer cents, manifest and export state machine
 *
 * These engines are pure by contract, so every case below runs without a database.
 */
import { describe, it, expect } from "vitest";

import {
  CLIENT_TYPES,
  COMMERCIAL_CHANNELS,
  COMMERCIAL_TO_PRICING_CHANNEL,
  EVIDENCE_CLASSES,
  isPriceGradeEvidence,
  LEAD_SOURCE_CHANNELS,
  normalizeClientType,
  normalizeCommercialChannel,
  normalizeEvidenceClass,
  normalizeLeadSourceChannel,
  normalizePrevisitNextStep,
  PREVISIT_NEXT_STEPS,
  PREVISIT_STEPS_ALLOWING_ESTIMATE,
  PRICING_TO_COMMERCIAL_CHANNEL,
  resolveSingleNextStep,
} from "@shared/domain/phase2-taxonomy";

import {
  buildConversionPlan,
  deriveCommercialChannel,
  evaluateClientMatches,
  evaluateProjectMatches,
  MINIMUM_DATA_FIELDS,
  normalizeAddressValue,
  normalizeEmailValue,
  normalizePhoneValue,
  planAllowsWrite,
  validateMinimumData,
  type ConversionCandidateInput,
  type ExistingClientRecord,
  type ExistingProjectRecord,
} from "@shared/intake-conversion";

import {
  assessPrevisitReadiness,
  buildFieldChecklist,
  buildPrevisitBrief,
  detectDefinitivePriceLanguage,
  normalizeEvidenceItem,
  resolvePrevisitDecision,
  summarizeEvidence,
  validatePrevisitBriefInput,
  type EvidenceItem,
  type PrevisitBriefInput,
} from "@shared/previsit-engine";

import {
  buildGeoContextSummary,
  geoWarningsToStrings,
  GEO_WARNING_CODES,
} from "@shared/geo-context-warnings";

import {
  assertProfitShield,
  evaluateProfitShield,
  inferGeoRiskClass,
  resolveCommercialChannel,
} from "@shared/profit-shield-engine";

import {
  CHANNEL_MIN_MARGIN_PCT,
  GEO_MIN_MARGIN_PCT,
  PROFIT_SHIELD_PCT,
} from "@shared/constants/profit-shield";

import {
  buildExportManifest,
  canDownloadExport,
  canTransitionExport,
  EXPORT_STATES,
  formatCents,
  fromCents,
  isExportBlocked,
  JOBTREAD_CONTRACT_VERSION,
  lineTotalCents,
  reconcileExport,
  toCents,
} from "@shared/jobtread-reconciliation";

import {
  isEstimateReady,
  isValidTransition,
  normalizeScopeStatus,
  SCOPE_STATUS_ALIASES,
} from "@shared/scope-review-state-machine";

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

const TENANT = "11111111-1111-4111-8111-111111111111";

function makeCandidate(
  overrides: Partial<ConversionCandidateInput> = {},
): ConversionCandidateInput {
  return {
    tenantId: TENANT,
    leadId: "lead-1",
    clientName: "Sarah Whitfield",
    email: "Sarah.Whitfield@example.com",
    phone: "(843) 555-0142",
    siteAddress: "412 Palmetto Street",
    city: "Charleston",
    state: "SC",
    zip: "29403",
    projectType: "remodel",
    clientType: "homeowner",
    sourceChannel: "referral",
    nextStepCandidates: ["schedule_previsit"],
    ...overrides,
  };
}

function makeClient(overrides: Partial<ExistingClientRecord> = {}): ExistingClientRecord {
  return {
    id: "client-1",
    tenantId: TENANT,
    name: "Sarah Whitfield",
    email: "sarah.whitfield@example.com",
    phone: "8435550142",
    address: "412 Palmetto St",
    city: "Charleston",
    state: "SC",
    zip: "29403",
    deletedAt: null,
    isActive: true,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ExistingProjectRecord> = {}): ExistingProjectRecord {
  return {
    id: "project-1",
    tenantId: TENANT,
    clientId: "client-1",
    name: "Whitfield — remodel",
    address: "412 Palmetto Street",
    city: "Charleston",
    state: "SC",
    zip: "29403",
    projectType: "remodel",
    status: "active",
    deletedAt: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    key: "foundation_type",
    section: "structural_condition",
    label: "foundation type",
    value: "crawlspace",
    evidence: "FACT",
    source: "field inspection 2026-08-10",
    ...overrides,
  };
}

function makeBriefInput(overrides: Partial<PrevisitBriefInput> = {}): PrevisitBriefInput {
  return {
    tenantId: TENANT,
    projectId: "project-1",
    summary: "Single-story crawlspace home, kitchen and primary bath remodel intent.",
    items: [makeEvidence()],
    nextStepCandidates: ["conceptual_estimate"],
    generatedAt: "2026-08-12T12:00:00.000Z",
    ...overrides,
  };
}

function makeCsvRow(overrides: Record<string, string> = {}) {
  return {
    "Cost Group Name": "Interior Finishes",
    "Cost Item Name": "Hardwood Flooring - Oak",
    Description: "Solid oak flooring",
    Quantity: "500",
    Unit: "Square Feet",
    "Unit Cost": "4.50",
    "Unit Price": "6.75",
    "Cost Type": "Materials",
    Taxable: "True",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// GROUP A — TAXONOMY
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 — Group A: domain taxonomy", () => {
  it("A1: closed vocabularies have the expected members", () => {
    expect(COMMERCIAL_CHANNELS).toEqual(["premium", "trade", "capital"]);
    expect(CLIENT_TYPES).toContain("homeowner");
    expect(CLIENT_TYPES).toContain("builder");
    expect(CLIENT_TYPES).toContain("investor");
    expect(EVIDENCE_CLASSES).toEqual(["FACT", "CLIENT_PROVIDED", "INFERENCE", "UNKNOWN"]);
    expect(LEAD_SOURCE_CHANNELS).toContain("website_direct");
    expect(PREVISIT_NEXT_STEPS).toHaveLength(6);
  });

  it("A2: the six pre-visit decisions of the dossier are all representable", () => {
    expect(PREVISIT_NEXT_STEPS).toEqual([
      "conceptual_estimate",
      "survey_zoning_verification",
      "design",
      "structural_evaluation",
      "paid_preconstruction",
      "design_build_proposal",
    ]);
  });

  it("A3: only pricing-oriented decisions authorize an estimate", () => {
    expect(PREVISIT_STEPS_ALLOWING_ESTIMATE).toContain("conceptual_estimate");
    expect(PREVISIT_STEPS_ALLOWING_ESTIMATE).toContain("design_build_proposal");
    expect(PREVISIT_STEPS_ALLOWING_ESTIMATE).toContain("paid_preconstruction");
    expect(PREVISIT_STEPS_ALLOWING_ESTIMATE).not.toContain("structural_evaluation");
    expect(PREVISIT_STEPS_ALLOWING_ESTIMATE).not.toContain("survey_zoning_verification");
    expect(PREVISIT_STEPS_ALLOWING_ESTIMATE).not.toContain("design");
  });

  it("A4: normalizers accept aliases and reject unknown values", () => {
    expect(normalizeLeadSourceChannel("Google Ads")).toBe("paid_search");
    expect(normalizeLeadSourceChannel("word of mouth")).toBe("referral");
    expect(normalizeLeadSourceChannel("carrier pigeon")).toBeNull();
    expect(normalizeClientType("general_contractor")).toBe("builder");
    expect(normalizeCommercialChannel("Investor")).toBe("capital");
    expect(normalizeEvidenceClass("client provided")).toBe("CLIENT_PROVIDED");
    expect(normalizePrevisitNextStep("precon")).toBe("paid_preconstruction");
  });

  it("A5: only FACT is price-grade evidence (LIG-008)", () => {
    expect(isPriceGradeEvidence("FACT")).toBe(true);
    expect(isPriceGradeEvidence("CLIENT_PROVIDED")).toBe(false);
    expect(isPriceGradeEvidence("INFERENCE")).toBe(false);
    expect(isPriceGradeEvidence("UNKNOWN")).toBe(false);
  });

  it("A6: competing next steps collapse to exactly one, discards preserved (LIG-006)", () => {
    const result = resolveSingleNextStep(["nurture", "schedule_previsit", "needs_review"]);
    expect(result.nextStep).toBe("needs_review");
    expect(result.discarded).toEqual(["schedule_previsit", "nurture"]);
  });

  it("A7: commercial and pricing channels map in both directions without collision", () => {
    expect(COMMERCIAL_TO_PRICING_CHANNEL.premium).toBe("direct");
    expect(PRICING_TO_COMMERCIAL_CHANNEL.direct).toBe("premium");
    expect(PRICING_TO_COMMERCIAL_CHANNEL.insurance).toBe("trade");
    for (const channel of COMMERCIAL_CHANNELS) {
      expect(COMMERCIAL_TO_PRICING_CHANNEL[channel]).toBeTruthy();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP B — LEAD → INTAKE → PROJECT CONVERSION
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 — Group B: lead → intake → project conversion", () => {
  it("B1: the minimum data set is exactly the four dossier fields", () => {
    expect(MINIMUM_DATA_FIELDS).toEqual([
      "clientName",
      "siteAddress",
      "projectType",
      "clientType",
    ]);
  });

  it("B2: a complete candidate passes minimum data validation", () => {
    const result = validateMinimumData(makeCandidate());
    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("B3: each missing minimum field is reported individually (LIG-007)", () => {
    const result = validateMinimumData(
      makeCandidate({ clientName: null, siteAddress: "", projectType: null, clientType: null }),
    );
    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual([
      "clientName",
      "siteAddress",
      "projectType",
      "clientType",
    ]);
  });

  it("B4: a client with no e-mail and no phone is blocked", () => {
    const result = validateMinimumData(makeCandidate({ email: null, phone: null }));
    expect(result.valid).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/e-mail or a phone/i);
  });

  it("B5: conversion is blocked (not silently partial) when data is missing", () => {
    const plan = buildConversionPlan(makeCandidate({ siteAddress: null }));
    expect(plan.decision).toBe("blocked_minimum_data");
    expect(plan.missingFields).toContain("siteAddress");
    expect(planAllowsWrite(plan)).toBe(false);
  });

  it("B6: address normalization collapses abbreviations and punctuation", () => {
    expect(normalizeAddressValue("412 Palmetto St.")).toBe("412 palmetto st");
    expect(normalizeAddressValue("412 PALMETTO STREET")).toBe("412 palmetto st");
    expect(normalizeAddressValue("  1200   North  Main  Avenue ")).toBe("1200 n main ave");
  });

  it("B7: phone and e-mail normalization is comparison-safe", () => {
    expect(normalizePhoneValue("+1 (843) 555-0142")).toBe("8435550142");
    expect(normalizePhoneValue("843.555.0142")).toBe("8435550142");
    expect(normalizeEmailValue("  Sarah.Whitfield@Example.COM ")).toBe(
      "sarah.whitfield@example.com",
    );
  });

  it("B8: an e-mail match is a confirmed client match (LIG-003)", () => {
    const matches = evaluateClientMatches(makeCandidate(), [makeClient()]);
    expect(matches).toHaveLength(1);
    expect(matches[0].strength).toBe("confirmed");
    expect(matches[0].matchedOn).toContain("email");
  });

  it("B9: a name+address-only match is ambiguous and requires review (LIG-003)", () => {
    const matches = evaluateClientMatches(
      makeCandidate({ email: "different@example.com", phone: "8435559999" }),
      [makeClient()],
    );
    expect(matches[0].strength).toBe("ambiguous");
    expect(matches[0].matchedOn).toEqual(["name_address"]);
  });

  it("B10: a confirmed client is reused instead of duplicated (LIG-004)", () => {
    const plan = buildConversionPlan(makeCandidate(), [makeClient()], []);
    expect(plan.decision).toBe("reuse_client");
    expect(plan.clientIdToReuse).toBe("client-1");
    expect(planAllowsWrite(plan)).toBe(true);
  });

  it("B11: an ambiguous match blocks the write and asks for review", () => {
    const plan = buildConversionPlan(
      makeCandidate({ email: "other@example.com", phone: "8435559999" }),
      [makeClient()],
      [],
    );
    expect(plan.decision).toBe("needs_review");
    expect(planAllowsWrite(plan)).toBe(false);
  });

  it("B12: matching two different clients is never auto-merged", () => {
    const plan = buildConversionPlan(
      makeCandidate(),
      [makeClient(), makeClient({ id: "client-2", email: null, phone: "8435550142" })],
      [],
    );
    expect(plan.decision).toBe("needs_review");
    expect(plan.blockers.join(" ")).toMatch(/2 existing clients/);
  });

  it("B13: same address + same project type is a duplicate project (LIG-004)", () => {
    const plan = buildConversionPlan(makeCandidate(), [makeClient()], [makeProject()]);
    expect(plan.decision).toBe("needs_review");
    expect(plan.existingProjectId).toBe("project-1");
  });

  it("B14: same address with a different project type is allowed as a distinct scope", () => {
    const plan = buildConversionPlan(
      makeCandidate({ projectType: "addition" }),
      [makeClient()],
      [makeProject()],
    );
    expect(plan.decision).toBe("reuse_client");
    expect(plan.warnings.join(" ")).toMatch(/different project type/i);
  });

  it("B15: a completed project at the same address does not block a new one", () => {
    const matches = evaluateProjectMatches(
      makeCandidate(),
      [makeProject({ status: "completed" })],
      "client-1",
    );
    expect(matches).toEqual([]);
  });

  it("B16: a project of another client at the same address is not a duplicate", () => {
    const matches = evaluateProjectMatches(
      makeCandidate(),
      [makeProject({ clientId: "client-999" })],
      "client-1",
    );
    expect(matches).toEqual([]);
  });

  it("B17: candidates from another tenant are invisible (LIG-001)", () => {
    const foreign = makeClient({ id: "client-x", tenantId: "22222222-2222-4222-8222-222222222222" });
    expect(evaluateClientMatches(makeCandidate(), [foreign])).toEqual([]);
  });

  it("B18: soft-deleted and inactive clients are not reused", () => {
    expect(evaluateClientMatches(makeCandidate(), [makeClient({ deletedAt: new Date() })])).toEqual([]);
    expect(evaluateClientMatches(makeCandidate(), [makeClient({ isActive: false })])).toEqual([]);
  });

  it("B19: commercial channel derives from client type when not explicit", () => {
    expect(deriveCommercialChannel("homeowner")).toBe("premium");
    expect(deriveCommercialChannel("builder")).toBe("trade");
    expect(deriveCommercialChannel("investor")).toBe("capital");
    expect(deriveCommercialChannel("homeowner", "capital")).toBe("capital");
  });

  it("B20: a clean candidate converts and carries a normalized payload", () => {
    const plan = buildConversionPlan(makeCandidate());
    expect(plan.decision).toBe("convert");
    expect(plan.normalized.tenantId).toBe(TENANT);
    expect(plan.normalized.commercialChannel).toBe("premium");
    expect(plan.normalized.sourceChannel).toBe("referral");
    expect(plan.normalized.addressNormalized).toBe("412 palmetto st");
    expect(plan.normalized.projectName).toContain("Sarah Whitfield");
  });

  it("B21: an unmappable source is preserved as `other` with the raw value kept", () => {
    const plan = buildConversionPlan(makeCandidate({ sourceChannel: "billboard on I-26" }));
    expect(plan.normalized.sourceChannel).toBe("other");
    expect(plan.normalized.sourceDetail).toContain("billboard on I-26");
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP C — PRE-VISIT
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 — Group C: pre-visit briefing", () => {
  it("C1: a valueless item degrades to UNKNOWN, never to FACT", () => {
    const item = normalizeEvidenceItem(makeEvidence({ value: null, evidence: "FACT" }));
    expect(item.evidence).toBe("UNKNOWN");
    expect(item.blocksPricing).toBe(true);
  });

  it("C2: FACT items with a source do not block pricing", () => {
    const item = normalizeEvidenceItem(makeEvidence());
    expect(item.evidence).toBe("FACT");
    expect(item.blocksPricing).toBe(false);
  });

  it("C3: evidence summary counts every class and computes FACT coverage", () => {
    const summary = summarizeEvidence([
      makeEvidence(),
      makeEvidence({ key: "roof_age", evidence: "CLIENT_PROVIDED", value: "12 years", source: "client" }),
      makeEvidence({ key: "slab_thickness", evidence: "INFERENCE", value: "4 in", rationale: "typical for era" }),
      makeEvidence({ key: "septic_location", evidence: "UNKNOWN", value: null }),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.byClass.FACT).toBe(1);
    expect(summary.byClass.CLIENT_PROVIDED).toBe(1);
    expect(summary.byClass.INFERENCE).toBe(1);
    expect(summary.byClass.UNKNOWN).toBe(1);
    expect(summary.factCoveragePct).toBe(25);
    expect(summary.unknownKeys).toEqual(["septic_location"]);
    expect(summary.pricingBlockers).toHaveLength(3);
  });

  it("C4: definitive price language is detected, ranges are allowed", () => {
    expect(detectDefinitivePriceLanguage("The final price is $184,500.")).not.toHaveLength(0);
    expect(detectDefinitivePriceLanguage("Fixed price of $92,000 for the scope")).not.toHaveLength(0);
    expect(detectDefinitivePriceLanguage("Firm quote attached")).not.toHaveLength(0);
    expect(detectDefinitivePriceLanguage("Conceptual range $180k–$220k, not a quote")).toEqual([]);
    expect(detectDefinitivePriceLanguage(null)).toEqual([]);
  });

  it("C5: a brief carrying a definitive price is rejected (PVI-002)", () => {
    const errors = validatePrevisitBriefInput(
      makeBriefInput({ summary: "Confirmed the final price is $210,000." }),
    );
    expect(errors.some((e) => e.ruleId === "PVI-002")).toBe(true);
  });

  it("C6: an INFERENCE without rationale is rejected (LIG-008)", () => {
    const errors = validatePrevisitBriefInput(
      makeBriefInput({
        items: [makeEvidence({ key: "beam_span", evidence: "INFERENCE", value: "16 ft", rationale: null })],
      }),
    );
    expect(errors.some((e) => e.ruleId === "LIG-008")).toBe(true);
  });

  it("C7: a FACT without a verifiable source is rejected", () => {
    const errors = validatePrevisitBriefInput(
      makeBriefInput({ items: [makeEvidence({ source: null })] }),
    );
    expect(errors.some((e) => e.field.includes("foundation_type"))).toBe(true);
  });

  it("C8: a brief with no recommendation is rejected (PVI-003)", () => {
    const errors = validatePrevisitBriefInput(makeBriefInput({ nextStepCandidates: [] }));
    expect(errors.some((e) => e.ruleId === "PVI-003")).toBe(true);
  });

  it("C9: duplicate evidence keys are rejected", () => {
    const errors = validatePrevisitBriefInput(
      makeBriefInput({ items: [makeEvidence(), makeEvidence()] }),
    );
    expect(errors.some((e) => e.message.includes("Duplicate evidence key"))).toBe(true);
  });

  it("C10: competing recommendations collapse verification-first", () => {
    const decision = resolvePrevisitDecision(["conceptual_estimate", "structural_evaluation"]);
    expect(decision?.nextStep).toBe("structural_evaluation");
    expect(decision?.allowsEstimate).toBe(false);
    expect(decision?.discarded).toEqual(["conceptual_estimate"]);
    expect(decision?.normalizationNote).toMatch(/verification-first/i);
  });

  it("C11: a conceptual estimate recommendation authorizes the estimate path", () => {
    const decision = resolvePrevisitDecision(["conceptual"]);
    expect(decision?.nextStep).toBe("conceptual_estimate");
    expect(decision?.allowsEstimate).toBe(true);
  });

  it("C12: UNKNOWN items become required checklist items", () => {
    const checklist = buildFieldChecklist([
      makeEvidence({ key: "septic_location", label: "septic tank location", value: null, evidence: "UNKNOWN" }),
    ]);
    expect(checklist).toHaveLength(1);
    expect(checklist[0].key).toBe("verify_septic_location");
    expect(checklist[0].required).toBe(true);
  });

  it("C13: INFERENCE items become required confirmations; CLIENT PROVIDED are optional", () => {
    const checklist = buildFieldChecklist([
      makeEvidence({ key: "slab_thickness", evidence: "INFERENCE", value: "4 in", rationale: "era typical" }),
      makeEvidence({ key: "roof_age", evidence: "CLIENT_PROVIDED", value: "12 years", source: "client" }),
    ]);
    expect(checklist.find((c) => c.key === "confirm_slab_thickness")?.required).toBe(true);
    expect(checklist.find((c) => c.key === "validate_roof_age")?.required).toBe(false);
  });

  it("C14: FACT items generate no checklist work", () => {
    expect(buildFieldChecklist([makeEvidence()])).toEqual([]);
  });

  it("C15: coastal geo warnings inject the baseline coastal checklist", () => {
    const checklist = buildFieldChecklist([makeEvidence()], ["[geo.coastal_exposure] coastal zone"]);
    const keys = checklist.map((c) => c.key);
    expect(keys).toContain("coastal_wind_exposure_confirmed");
    expect(keys).toContain("coastal_flood_zone_confirmed");
    expect(keys).toContain("coastal_corrosion_check");
  });

  it("C16: a valid brief is built with exactly one decision and never a definitive price", () => {
    const brief = buildPrevisitBrief(makeBriefInput());
    expect(brief.nextStep).toBe("conceptual_estimate");
    expect(brief.discardedNextSteps).toEqual([]);
    expect(brief.emitsDefinitivePrice).toBe(false);
    expect(brief.generatedAt).toBe("2026-08-12T12:00:00.000Z");
    expect(brief.projectId).toBe("project-1");
    expect(brief.tenantId).toBe(TENANT);
  });

  it("C17: building an invalid brief throws instead of persisting a bad state", () => {
    expect(() => buildPrevisitBrief(makeBriefInput({ items: [] }))).toThrow(
      /validation failed/i,
    );
  });

  it("C18: a pricing-oriented decision with non-FACT evidence warns that pricing is conceptual", () => {
    const brief = buildPrevisitBrief(
      makeBriefInput({
        items: [
          makeEvidence(),
          makeEvidence({ key: "septic_location", value: null, evidence: "UNKNOWN" }),
        ],
      }),
    );
    expect(brief.warnings.join(" ")).toMatch(/conceptual until verified/i);
  });

  it("C19: readiness blocks completion while required checklist items are open", () => {
    const brief = buildPrevisitBrief(
      makeBriefInput({
        items: [makeEvidence({ key: "septic_location", value: null, evidence: "UNKNOWN" })],
      }),
    );
    const before = assessPrevisitReadiness(brief, []);
    expect(before.canComplete).toBe(false);
    expect(before.requiredChecklistOpen).toBe(1);

    const after = assessPrevisitReadiness(brief, ["verify_septic_location"]);
    expect(after.canComplete).toBe(true);
    expect(after.requiredChecklistOpen).toBe(0);
  });

  it("C20: optional checklist items only warn, they never block", () => {
    const brief = buildPrevisitBrief(
      makeBriefInput({
        items: [
          makeEvidence(),
          makeEvidence({ key: "roof_age", evidence: "CLIENT_PROVIDED", value: "12 years", source: "client" }),
        ],
      }),
    );
    const readiness = assessPrevisitReadiness(brief, []);
    expect(readiness.canComplete).toBe(true);
    expect(readiness.warnings.join(" ")).toMatch(/optional checklist/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP D — GEO CONTEXT
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 — Group D: geo context warnings", () => {
  it("D1: warning codes are stable and namespaced", () => {
    for (const code of GEO_WARNING_CODES) {
      expect(code.startsWith("geo.")).toBe(true);
    }
    expect(GEO_WARNING_CODES).toHaveLength(7);
  });

  it("D2: a failed geocode is blocking and makes the context unreliable", () => {
    const summary = buildGeoContextSummary({ geocodeSuccess: false, zoneName: null });
    expect(summary.codes).toContain("geo.geocode_failed");
    expect(summary.warnings[0].severity).toBe("blocking");
    expect(summary.reliable).toBe(false);
  });

  it("D3: low geocode confidence warns without blocking", () => {
    const summary = buildGeoContextSummary({
      geocodeSuccess: true,
      geocodeConfidence: "approximate",
      zoneName: "Downtown Charleston",
    });
    expect(summary.codes).toContain("geo.geocode_low_confidence");
    expect(summary.reliable).toBe(true);
  });

  it("D4: a missing zone is reported and makes the context unreliable", () => {
    const summary = buildGeoContextSummary({ geocodeSuccess: true, zoneName: null });
    expect(summary.codes).toContain("geo.zone_not_detected");
    expect(summary.reliable).toBe(false);
  });

  it("D5: barrier island exposure outranks generic coastal exposure", () => {
    const summary = buildGeoContextSummary({
      geocodeSuccess: true,
      zoneName: "Isle of Palms",
      coastalExposureLevel: "extreme",
    });
    expect(summary.riskClass).toBe("barrier_island");
    expect(summary.codes).toContain("geo.barrier_island_exposure");
    expect(summary.codes).not.toContain("geo.coastal_exposure");
  });

  it("D6: zone exposure level overrides an uninformative zone name", () => {
    const summary = buildGeoContextSummary({
      geocodeSuccess: true,
      zoneName: "Zone C",
      coastalExposureLevel: "high",
    });
    expect(summary.riskClass).toBe("coastal");
    expect(summary.codes).toContain("geo.coastal_exposure");
  });

  it("D7: outside the service radius is reported with the distance", () => {
    const summary = buildGeoContextSummary({
      geocodeSuccess: true,
      zoneName: "Summerville",
      withinServiceRadius: false,
      distanceFromCenter: 47.4,
    });
    expect(summary.codes).toContain("geo.outside_service_radius");
    expect(summary.warnings.find((w) => w.code === "geo.outside_service_radius")?.message).toContain(
      "47.4",
    );
  });

  it("D8: a high cost multiplier is informative, not blocking", () => {
    const summary = buildGeoContextSummary({
      geocodeSuccess: true,
      zoneName: "Kiawah Island",
      costMultiplier: 1.28,
    });
    expect(summary.codes).toContain("geo.high_cost_multiplier");
    expect(summary.reliable).toBe(true);
  });

  it("D9: an inland zone with a good geocode produces no warnings", () => {
    const summary = buildGeoContextSummary({
      geocodeSuccess: true,
      geocodeConfidence: "high",
      zoneName: "West Ashley",
      coastalExposureLevel: "none",
      withinServiceRadius: true,
      costMultiplier: 1.0,
    });
    expect(summary.codes).toEqual([]);
    expect(summary.riskClass).toBe("inland");
    expect(summary.reliable).toBe(true);
  });

  it("D10: the same input always produces the same codes in the same order", () => {
    const input = {
      geocodeSuccess: true,
      geocodeConfidence: "low",
      zoneName: "Folly Beach",
      coastalExposureLevel: "extreme",
      withinServiceRadius: false,
      distanceFromCenter: 12.2,
      costMultiplier: 1.31,
    };
    expect(buildGeoContextSummary(input).codes).toEqual(buildGeoContextSummary(input).codes);
    expect(buildGeoContextSummary(input).codes).toEqual([
      "geo.geocode_low_confidence",
      "geo.barrier_island_exposure",
      "geo.outside_service_radius",
      "geo.high_cost_multiplier",
    ]);
  });

  it("D11: legacy string form keeps the code prefix for matching", () => {
    const summary = buildGeoContextSummary({ geocodeSuccess: false, zoneName: null });
    expect(geoWarningsToStrings(summary)[0]).toMatch(/^\[geo\.geocode_failed\]/);
  });

  it("D12: zone-declared minimum margin is surfaced when present", () => {
    const summary = buildGeoContextSummary({
      geocodeSuccess: true,
      zoneName: "Sullivan's Island",
      minProfitShieldPct: "50.00",
    });
    expect(summary.zoneMinProfitShieldPct).toBe(50);
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP E — PROFIT SHIELD (channel floors)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 — Group E: Profit Shield channel floors", () => {
  it("E1: channel floors match the dossier (28 / 18 / 15)", () => {
    expect(CHANNEL_MIN_MARGIN_PCT.premium).toBe(28);
    expect(CHANNEL_MIN_MARGIN_PCT.trade).toBe(18);
    expect(CHANNEL_MIN_MARGIN_PCT.capital).toBe(15);
  });

  it("E2: geographic floors are preserved", () => {
    expect(GEO_MIN_MARGIN_PCT.inland).toBe(0);
    expect(GEO_MIN_MARGIN_PCT.coastal).toBe(PROFIT_SHIELD_PCT.COASTAL_MIN_GP);
    expect(GEO_MIN_MARGIN_PCT.barrier_island).toBe(PROFIT_SHIELD_PCT.BARRIER_ISLAND_MIN_GP);
  });

  it("E3: channel resolution accepts commercial, alias and legacy pricing values", () => {
    expect(resolveCommercialChannel("premium")).toBe("premium");
    expect(resolveCommercialChannel("builder")).toBe("trade");
    expect(resolveCommercialChannel("direct")).toBe("premium");
    expect(resolveCommercialChannel("insurance")).toBe("trade");
    expect(resolveCommercialChannel("nonsense")).toBeNull();
  });

  it("E4: Premium below 28% is blocked", () => {
    const result = evaluateProfitShield(24, { channel: "premium", riskClass: "inland" });
    expect(result.blocked).toBe(true);
    expect(result.effectiveFloorPct).toBe(28);
    expect(result.violations.map((v) => v.code)).toContain("CHANNEL_FLOOR");
    expect(result.remediation.length).toBeGreaterThan(0);
  });

  it("E5: Premium at exactly 28% passes (the floor is inclusive)", () => {
    const result = evaluateProfitShield(28, { channel: "premium", riskClass: "inland" });
    expect(result.blocked).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("E6: Trade at 20% passes where Premium would fail", () => {
    expect(evaluateProfitShield(20, { channel: "trade", riskClass: "inland" }).blocked).toBe(false);
    expect(evaluateProfitShield(20, { channel: "premium", riskClass: "inland" }).blocked).toBe(true);
  });

  it("E7: Trade below 18% is blocked", () => {
    const result = evaluateProfitShield(17.9, { channel: "trade", riskClass: "inland" });
    expect(result.blocked).toBe(true);
    expect(result.effectiveFloorPct).toBe(18);
  });

  it("E8: Capital is evaluated as a minimum fee of 15%", () => {
    const passing = evaluateProfitShield(15, { channel: "capital", riskClass: "inland" });
    expect(passing.blocked).toBe(false);
    expect(passing.floorKind).toBe("fee");

    const failing = evaluateProfitShield(14.5, { channel: "capital", riskClass: "inland" });
    expect(failing.blocked).toBe(true);
  });

  it("E9: the coastal floor outranks a lower channel floor", () => {
    const result = evaluateProfitShield(30, { channel: "trade", riskClass: "coastal" });
    expect(result.effectiveFloorPct).toBe(42);
    expect(result.blocked).toBe(true);
    expect(result.violations.map((v) => v.code)).toContain("GEO_FLOOR");
  });

  it("E10: the barrier island floor is the most protective", () => {
    const result = evaluateProfitShield(45, { channel: "premium", riskClass: "barrier_island" });
    expect(result.effectiveFloorPct).toBe(50);
    expect(result.blocked).toBe(true);
  });

  it("E11: an unresolved channel falls back to the most protective channel floor", () => {
    const result = evaluateProfitShield(40, { channel: "who knows", riskClass: "inland" });
    expect(result.channel).toBeNull();
    expect(result.effectiveFloorPct).toBe(28);
    expect(result.violations.map((v) => v.code)).toContain("UNKNOWN_CHANNEL");
    expect(result.blocked).toBe(true);
  });

  it("E12: the historical 35% target degrades to a warning when the floor is met", () => {
    const result = evaluateProfitShield(22, { channel: "trade", riskClass: "inland" });
    expect(result.blocked).toBe(false);
    expect(result.warnings.map((w) => w.code)).toContain("GLOBAL_FLOOR");
  });

  it("E13: critically low assembly margins warn without blocking the estimate", () => {
    const result = evaluateProfitShield(40, {
      channel: "premium",
      riskClass: "inland",
      assemblyMargins: [
        { assemblyId: "a1", assemblyName: "Framing", grossProfitPct: 12 },
        { assemblyId: "a2", assemblyName: "Cabinetry", grossProfitPct: 44 },
      ],
    });
    expect(result.blocked).toBe(false);
    expect(result.warnings.filter((w) => w.code === "ASSEMBLY_WARNING")).toHaveLength(1);
  });

  it("E14: zone names infer the geographic risk class", () => {
    expect(inferGeoRiskClass("Isle of Palms")).toBe("barrier_island");
    expect(inferGeoRiskClass("Coastal Mount Pleasant")).toBe("coastal");
    expect(inferGeoRiskClass("Summerville")).toBe("inland");
    expect(inferGeoRiskClass(null)).toBe("inland");
  });

  it("E15: the assertion guard throws with a deterministic prefix", () => {
    expect(() => assertProfitShield(10, { channel: "premium", riskClass: "inland" })).toThrow(
      /^PROFIT_SHIELD_CHANNEL_FLOOR:/,
    );
    expect(() => assertProfitShield(50, { channel: "premium", riskClass: "inland" })).not.toThrow();
  });

  it("E16: a non-finite margin is treated as zero, never as a pass", () => {
    const result = evaluateProfitShield(Number.NaN, { channel: "trade", riskClass: "inland" });
    expect(result.actualPct).toBe(0);
    expect(result.blocked).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP F — JOBTREAD RECONCILIATION
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 — Group F: JobTread reconciliation", () => {
  it("F1: money conversion is exact in integer cents", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("$1,234.56")).toBe(123456);
    // 0.145 * 100 is 14.499999999999998 in binary floating point, so rounding lands on
    // 14. This is exactly why reconciliation is done in integer cents: the conversion is
    // performed once, at the boundary, and never again.
    expect(toCents(0.145)).toBe(14);
    expect(toCents("0.15")).toBe(15);
    expect(toCents(null)).toBe(0);
    expect(toCents("abc")).toBe(0);
    expect(fromCents(123456)).toBe(1234.56);
    expect(formatCents(123456)).toBe("1234.56");
    expect(formatCents(-505)).toBe("-5.05");
    expect(formatCents(7)).toBe("0.07");
  });

  it("F2: line totals round once, at the line level", () => {
    expect(lineTotalCents("500", "6.75")).toBe(337500);
    expect(lineTotalCents(12.5, "3.33")).toBe(4163);
    expect(lineTotalCents("bad", "6.75")).toBe(0);
  });

  it("F3: an exact match reconciles", () => {
    const result = reconcileExport({ rows: [makeCsvRow()], approvedTotal: "3375.00" });
    expect(result.status).toBe("reconciled");
    expect(result.differenceCents).toBe(0);
    expect(result.suspectLines).toEqual([]);
  });

  it("F4: a one-cent difference blocks the export (JIC-003, zero tolerance)", () => {
    const result = reconcileExport({ rows: [makeCsvRow()], approvedTotal: "3375.01" });
    expect(result.status).toBe("blocked_reconciliation");
    expect(result.differenceCents).toBe(-1);
    expect(result.message).toMatch(/JIC-003/);
  });

  it("F5: suspect lines are ranked by absolute contribution", () => {
    const result = reconcileExport({
      rows: [
        makeCsvRow({ "Cost Item Name": "Small", Quantity: "1", "Unit Price": "10.00" }),
        makeCsvRow({ "Cost Item Name": "Large", Quantity: "100", "Unit Price": "500.00" }),
      ],
      approvedTotal: "1.00",
    });
    expect(result.status).toBe("blocked_reconciliation");
    expect(result.suspectLines[0].costItemName).toBe("Large");
  });

  it("F6: declared adjustments that explain the gap route to exception review", () => {
    const result = reconcileExport({
      rows: [makeCsvRow()],
      approvedTotal: "3275.00",
      declaredAdjustments: [{ kind: "discount", amount: "100.00", reason: "repeat client" }],
    });
    expect(result.status).toBe("needs_exception_review");
    expect(result.message).toMatch(/change order/i);
  });

  it("F7: declared adjustments that do not explain the gap still block", () => {
    const result = reconcileExport({
      rows: [makeCsvRow()],
      approvedTotal: "3000.00",
      declaredAdjustments: [{ kind: "discount", amount: "100.00" }],
    });
    expect(result.status).toBe("blocked_reconciliation");
  });

  it("F8: an empty export against a non-zero total is blocked", () => {
    const result = reconcileExport({ rows: [], approvedTotal: "5000.00" });
    expect(result.status).toBe("blocked_reconciliation");
    expect(result.exportedTotalCents).toBe(0);
  });

  it("F9: the manifest carries per-row cost codes without adding a CSV column", () => {
    const rows = [makeCsvRow(), makeCsvRow({ "Cost Item Name": "Trim" })];
    const reconciliation = reconcileExport({ rows, approvedTotal: "6750.00" });
    const manifest = buildExportManifest({
      estimateDraftId: "est-1",
      estimateVersion: 2,
      projectId: "project-1",
      tenantId: TENANT,
      rows,
      rowMetadata: [
        { costCode: "09-000", costCodeSource: "line_item" },
        { costCode: null, costCodeSource: "missing" },
      ],
      reconciliation,
      generatedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(manifest.contractVersion).toBe(JOBTREAD_CONTRACT_VERSION);
    expect(manifest.rowCount).toBe(2);
    expect(manifest.rows[0].costCode).toBe("09-000");
    expect(manifest.rows[0].csvRowNumber).toBe(1);
    expect(manifest.costCodeIssues).toEqual([
      { csvRowNumber: 2, costCode: null, issue: "cost_code_unmapped" },
    ]);
    expect(Object.keys(makeCsvRow())).toHaveLength(9);
  });

  it("F10: an invalid cost code is reported through the injected validator", () => {
    const rows = [makeCsvRow()];
    const manifest = buildExportManifest({
      estimateDraftId: "est-1",
      estimateVersion: 1,
      projectId: "project-1",
      tenantId: TENANT,
      rows,
      rowMetadata: [{ costCode: "99-999", costCodeSource: "line_item" }],
      reconciliation: reconcileExport({ rows, approvedTotal: "3375.00" }),
      isValidCostCode: (code) => code === "09-000",
    });
    expect(manifest.costCodeIssues[0].issue).toBe("cost_code_invalid");
  });

  it("F11: assembly summary fallback rows are flagged (JIC-008)", () => {
    const rows = [makeCsvRow()];
    const manifest = buildExportManifest({
      estimateDraftId: "est-1",
      estimateVersion: 1,
      projectId: "project-1",
      tenantId: TENANT,
      rows,
      rowMetadata: [{ costCode: "09-000", assemblySummaryFallback: true, assemblyId: "asm-1" }],
      reconciliation: reconcileExport({ rows, approvedTotal: "3375.00" }),
    });
    expect(manifest.assemblyFallbackRows).toEqual([1]);
    expect(manifest.rows[0].assemblyId).toBe("asm-1");
  });

  it("F12: the export state machine only allows the authorized path", () => {
    expect(canTransitionExport("requested", "validating")).toBe(true);
    expect(canTransitionExport("validating", "reconciling")).toBe(true);
    expect(canTransitionExport("reconciling", "approved_for_download")).toBe(true);
    expect(canTransitionExport("approved_for_download", "downloaded")).toBe(true);
    // No shortcut from request straight to a downloadable file.
    expect(canTransitionExport("requested", "approved_for_download")).toBe(false);
    expect(canTransitionExport("blocked_validation", "approved_for_download")).toBe(false);
    expect(canTransitionExport("blocked_reconciliation", "downloaded")).toBe(false);
  });

  it("F13: blocking states never allow a download", () => {
    for (const state of EXPORT_STATES) {
      if (isExportBlocked(state)) {
        expect(canDownloadExport(state)).toBe(false);
      }
    }
    expect(canDownloadExport("approved_for_download")).toBe(true);
    expect(canDownloadExport("downloaded")).toBe(true);
    expect(canDownloadExport("requested")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP G — SCOPE REVIEW STATE MACHINE (Phase 2 alias + estimate gate)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 — Group G: scope review states", () => {
  it("G1: `in_review` is accepted as an alias of the persisted `under_review`", () => {
    expect(normalizeScopeStatus("in_review")).toBe("under_review");
    expect(normalizeScopeStatus("under_review")).toBe("under_review");
    expect(normalizeScopeStatus("IN REVIEW")).toBe("under_review");
    expect(SCOPE_STATUS_ALIASES["in_review"]).toBe("under_review");
  });

  it("G2: the draft → in_review → approved path is valid", () => {
    expect(isValidTransition("draft", "under_review")).toBe(true);
    expect(isValidTransition("under_review", "approved")).toBe(true);
    expect(isValidTransition("under_review", "rejected")).toBe(true);
  });

  it("G3: a draft cannot jump straight to approved", () => {
    expect(isValidTransition("draft", "approved")).toBe(false);
  });

  it("G4: only an approved (or converted) scope is estimate-ready", () => {
    expect(isEstimateReady("approved")).toBe(true);
    expect(isEstimateReady("in_review")).toBe(false);
    expect(isEstimateReady("draft")).toBe(false);
    expect(isEstimateReady("rejected")).toBe(false);
  });
});
