/**
 * structr.ai — PHASE 2 Lead → Intake → Project Conversion Engine
 *
 * PURE decision layer for the conversion gate described in docs/phase2-contract.md §3.
 * Implements gchi-lead-intake-governance rules LIG-003, LIG-004, LIG-006 and LIG-007.
 *
 * Responsibilities:
 *   1. Validate the four minimum data points (client, address, project type, client type/channel)
 *   2. Detect the client to reuse (never create a second client for the same contact)
 *   3. Detect an existing project for the same site address (never duplicate a project)
 *   4. Produce exactly ONE conversion decision plus an auditable rationale
 *
 * NON-NEGOTIABLE: this module never writes to the database and never creates IDs.
 * The transactional writer (server/lead-conversion.ts) consumes this decision.
 */

import {
  normalizeClientType,
  normalizeCommercialChannel,
  normalizeLeadSourceChannel,
  resolveSingleNextStep,
  type ClientType,
  type CommercialChannel,
  type LeadNextStep,
  type LeadSourceChannel,
} from "./domain/phase2-taxonomy";
import { normalizeProjectType } from "./domain/normalization";
import type { ProjectType } from "./domain/taxonomy";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** The four minimum data points required to start the operational flow. */
export const MINIMUM_DATA_FIELDS = [
  "clientName",
  "siteAddress",
  "projectType",
  "clientType",
] as const;

export type MinimumDataField = (typeof MINIMUM_DATA_FIELDS)[number];

export interface ConversionCandidateInput {
  /** Tenant of the caller — must match every entity in the chain (LIG-001). */
  tenantId: string | null;
  leadId: string;
  /** Client display name or organization. */
  clientName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Street address of the jobsite. */
  siteAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  /** Project type (remodel, new_construction, ...). */
  projectType?: string | null;
  /** Client type (homeowner, builder, investor, ...). */
  clientType?: string | null;
  /** Commercial channel (premium / trade / capital). Derived from clientType when absent. */
  commercialChannel?: string | null;
  /** Original lead source channel — immutable primary origin (LIG-005). */
  sourceChannel?: string | null;
  sourceDetail?: string | null;
  /** Next step candidates. Exactly one survives (LIG-006). */
  nextStepCandidates?: Array<string | null | undefined>;
  /** Internal owner of the lead. */
  ownerUserId?: string | null;
}

export interface ExistingClientRecord {
  id: string;
  tenantId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  deletedAt?: Date | string | null;
  isActive?: boolean | null;
}

export interface ExistingProjectRecord {
  id: string;
  tenantId: string | null;
  clientId: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  projectType: string | null;
  status: string | null;
  deletedAt?: Date | string | null;
}

export type ConversionDecision =
  | "convert"
  | "reuse_client"
  | "needs_review"
  | "blocked_minimum_data";

export interface ClientMatchEvaluation {
  clientId: string;
  matchedOn: Array<"email" | "phone" | "name_address">;
  /** "confirmed" = safe to reuse; "ambiguous" = requires human review (LIG-003). */
  strength: "confirmed" | "ambiguous";
}

export interface ProjectMatchEvaluation {
  projectId: string;
  matchedOn: Array<"address" | "address_project_type">;
  status: string | null;
}

export interface ConversionPlan {
  decision: ConversionDecision;
  /** Rules that produced the decision, for the audit trail. */
  ruleIds: string[];
  /** Missing minimum data points (empty when decision !== "blocked_minimum_data"). */
  missingFields: MinimumDataField[];
  /** Human-readable blockers. */
  blockers: string[];
  /** Non-blocking observations. */
  warnings: string[];
  /** Existing client to reuse, when confirmed. */
  clientIdToReuse: string | null;
  /** Every client candidate evaluated — audit evidence for LIG-003. */
  clientCandidates: ClientMatchEvaluation[];
  /** Existing project at the same address, when found. */
  existingProjectId: string | null;
  projectCandidates: ProjectMatchEvaluation[];
  /** Normalized payload ready for persistence (only when not blocked). */
  normalized: NormalizedConversionPayload;
}

export interface NormalizedConversionPayload {
  tenantId: string | null;
  leadId: string;
  clientName: string;
  email: string | null;
  phone: string | null;
  emailNormalized: string | null;
  phoneNormalized: string | null;
  siteAddress: string;
  addressNormalized: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  projectType: ProjectType | null;
  clientType: ClientType | null;
  commercialChannel: CommercialChannel | null;
  sourceChannel: LeadSourceChannel;
  sourceDetail: string | null;
  nextStep: LeadNextStep | null;
  discardedNextSteps: LeadNextStep[];
  ownerUserId: string | null;
  projectName: string;
}

// ══════════════════════════════════════════════════════════════════════
// NORMALIZATION HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Reduce a phone number to digits only, dropping a leading US country code. */
export function normalizePhoneValue(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/** Lowercase + trim an e-mail for comparison. */
export function normalizeEmailValue(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = String(email).trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Normalize a street address for duplicate detection.
 * Collapses whitespace/punctuation and expands the most common US abbreviations so
 * "123 Main St." and "123 MAIN STREET" resolve to the same key.
 */
export function normalizeAddressValue(address: string | null | undefined): string {
  if (!address) return "";
  let value = String(address).trim().toLowerCase();
  value = value.replace(/[.,#]/g, " ");
  value = value.replace(/\s+/g, " ").trim();

  const abbreviations: Array<[RegExp, string]> = [
    [/\bstreet\b/g, "st"],
    [/\bavenue\b/g, "ave"],
    [/\bboulevard\b/g, "blvd"],
    [/\bdrive\b/g, "dr"],
    [/\broad\b/g, "rd"],
    [/\blane\b/g, "ln"],
    [/\bcourt\b/g, "ct"],
    [/\bcircle\b/g, "cir"],
    [/\bplace\b/g, "pl"],
    [/\bterrace\b/g, "ter"],
    [/\bhighway\b/g, "hwy"],
    [/\bnorth\b/g, "n"],
    [/\bsouth\b/g, "s"],
    [/\beast\b/g, "e"],
    [/\bwest\b/g, "w"],
    [/\bsuite\b/g, "ste"],
    [/\bapartment\b/g, "apt"],
    [/\bunit\b/g, "unit"],
  ];
  for (const [pattern, replacement] of abbreviations) {
    value = value.replace(pattern, replacement);
  }

  return value.replace(/\s+/g, " ").trim();
}

/** Normalize a person/company name for comparison. */
function normalizeNameValue(name: string | null | undefined): string {
  if (!name) return "";
  return String(name).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Derive the commercial channel from the client type when not explicitly provided. */
export function deriveCommercialChannel(
  clientType: ClientType | null,
  explicitChannel?: string | null,
): CommercialChannel | null {
  const explicit = normalizeCommercialChannel(explicitChannel);
  if (explicit) return explicit;
  if (!clientType) return null;

  const map: Record<ClientType, CommercialChannel> = {
    homeowner: "premium",
    builder: "trade",
    investor: "capital",
    property_manager: "trade",
    commercial_owner: "trade",
    insurance_carrier: "trade",
  };
  return map[clientType];
}

function isLiveRecord(record: { deletedAt?: Date | string | null; isActive?: boolean | null }): boolean {
  if (record.deletedAt) return false;
  if (record.isActive === false) return false;
  return true;
}

/** Tenant guard: a candidate only counts when it belongs to the caller's tenant (LIG-001). */
function sameTenant(candidateTenantId: string | null, callerTenantId: string | null): boolean {
  if (!callerTenantId) return true; // caller tenant unknown (dev/admin path)
  if (!candidateTenantId) return true; // legacy row not yet backfilled
  return candidateTenantId === callerTenantId;
}

// ══════════════════════════════════════════════════════════════════════
// MINIMUM DATA VALIDATION (LIG-007)
// ══════════════════════════════════════════════════════════════════════

export interface MinimumDataResult {
  valid: boolean;
  missingFields: MinimumDataField[];
  blockers: string[];
}

/**
 * Validate the four minimum data points required by the dossier before a project
 * may be created: client, site address, project type and client type.
 */
export function validateMinimumData(input: ConversionCandidateInput): MinimumDataResult {
  const missingFields: MinimumDataField[] = [];
  const blockers: string[] = [];

  if (!input.clientName || String(input.clientName).trim() === "") {
    missingFields.push("clientName");
    blockers.push("Client name or organization is required (LIG-007).");
  }

  if (!input.siteAddress || String(input.siteAddress).trim() === "") {
    missingFields.push("siteAddress");
    blockers.push("Site address is required (LIG-007).");
  }

  const projectType = normalizeProjectType(input.projectType);
  if (!projectType) {
    missingFields.push("projectType");
    blockers.push(
      input.projectType
        ? `Project type "${input.projectType}" is not a canonical project type (LIG-007).`
        : "Project type is required (LIG-007).",
    );
  }

  const clientType = normalizeClientType(input.clientType);
  const commercialChannel = deriveCommercialChannel(clientType, input.commercialChannel);
  if (!clientType && !commercialChannel) {
    missingFields.push("clientType");
    blockers.push("Client type / commercial channel is required (LIG-007).");
  }

  // A contact method is a lead-creation requirement, so it is a blocker here too:
  // conversion cannot produce a canonical client with no way to reach them.
  if (!normalizeEmailValue(input.email) && !normalizePhoneValue(input.phone)) {
    blockers.push("Client must have at least an e-mail or a phone number (LIG-007).");
  }

  return { valid: missingFields.length === 0 && blockers.length === 0, missingFields, blockers };
}

// ══════════════════════════════════════════════════════════════════════
// CLIENT MATCHING (LIG-003)
// ══════════════════════════════════════════════════════════════════════

/**
 * Evaluate existing clients for duplication.
 *
 * A match on normalized e-mail or phone is "confirmed" — the same contact is the same
 * canonical client. A match only on name + address is "ambiguous": common names at
 * multi-unit addresses are a real field condition, so it requires human review.
 */
export function evaluateClientMatches(
  input: ConversionCandidateInput,
  existingClients: ExistingClientRecord[],
): ClientMatchEvaluation[] {
  const email = normalizeEmailValue(input.email);
  const phone = normalizePhoneValue(input.phone);
  const name = normalizeNameValue(input.clientName);
  const address = normalizeAddressValue(input.siteAddress);

  const evaluations: ClientMatchEvaluation[] = [];

  for (const candidate of existingClients) {
    if (!sameTenant(candidate.tenantId, input.tenantId)) continue;
    if (!isLiveRecord(candidate)) continue;

    const matchedOn: ClientMatchEvaluation["matchedOn"] = [];

    if (email && normalizeEmailValue(candidate.email) === email) matchedOn.push("email");
    if (phone && normalizePhoneValue(candidate.phone) === phone) matchedOn.push("phone");
    if (
      name &&
      address &&
      normalizeNameValue(candidate.name) === name &&
      normalizeAddressValue(candidate.address) === address
    ) {
      matchedOn.push("name_address");
    }

    if (matchedOn.length === 0) continue;

    const strength: ClientMatchEvaluation["strength"] =
      matchedOn.includes("email") || matchedOn.includes("phone") ? "confirmed" : "ambiguous";

    evaluations.push({ clientId: candidate.id, matchedOn, strength });
  }

  return evaluations;
}

// ══════════════════════════════════════════════════════════════════════
// PROJECT MATCHING (LIG-004)
// ══════════════════════════════════════════════════════════════════════

/** Project statuses that no longer block a new project at the same address. */
const CLOSED_PROJECT_STATUSES = new Set(["completed", "cancelled"]);

/**
 * Evaluate existing projects for duplication at the same site address.
 * Only live projects of the same tenant (and, when known, the same client) count.
 */
export function evaluateProjectMatches(
  input: ConversionCandidateInput,
  existingProjects: ExistingProjectRecord[],
  clientIdToReuse: string | null,
): ProjectMatchEvaluation[] {
  const address = normalizeAddressValue(input.siteAddress);
  if (address === "") return [];

  const projectType = normalizeProjectType(input.projectType);
  const evaluations: ProjectMatchEvaluation[] = [];

  for (const candidate of existingProjects) {
    if (!sameTenant(candidate.tenantId, input.tenantId)) continue;
    if (candidate.deletedAt) continue;
    if (CLOSED_PROJECT_STATUSES.has(String(candidate.status ?? ""))) continue;
    if (normalizeAddressValue(candidate.address) !== address) continue;

    // A different client at the same address (duplex, rental, HOA) is not a duplicate.
    if (clientIdToReuse && candidate.clientId && candidate.clientId !== clientIdToReuse) continue;

    const matchedOn: ProjectMatchEvaluation["matchedOn"] = ["address"];
    if (projectType && normalizeProjectType(candidate.projectType) === projectType) {
      matchedOn.push("address_project_type");
    }

    evaluations.push({ projectId: candidate.id, matchedOn, status: candidate.status ?? null });
  }

  return evaluations;
}

// ══════════════════════════════════════════════════════════════════════
// CONVERSION PLAN (single decision)
// ══════════════════════════════════════════════════════════════════════

function buildNormalizedPayload(
  input: ConversionCandidateInput,
): NormalizedConversionPayload {
  const clientType = normalizeClientType(input.clientType);
  const commercialChannel = deriveCommercialChannel(clientType, input.commercialChannel);
  const projectType = normalizeProjectType(input.projectType);
  const { nextStep, discarded } = resolveSingleNextStep(input.nextStepCandidates ?? []);
  const clientName = String(input.clientName ?? "").trim();
  const siteAddress = String(input.siteAddress ?? "").trim();

  const projectLabel = projectType ? projectType.replace(/_/g, " ") : "project";
  const projectName = clientName
    ? `${clientName} — ${projectLabel}${siteAddress ? ` — ${siteAddress}` : ""}`
    : `Project — ${siteAddress || "unknown address"}`;

  return {
    tenantId: input.tenantId ?? null,
    leadId: input.leadId,
    clientName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    emailNormalized: normalizeEmailValue(input.email),
    phoneNormalized: normalizePhoneValue(input.phone),
    siteAddress,
    addressNormalized: normalizeAddressValue(input.siteAddress),
    city: input.city ?? null,
    state: input.state ?? null,
    zip: input.zip ?? null,
    projectType,
    clientType,
    commercialChannel,
    // LIG-005: origin is mandatory. An unmappable value is preserved as "other"
    // rather than silently dropped, and the raw value stays in sourceDetail.
    sourceChannel: normalizeLeadSourceChannel(input.sourceChannel) ?? "other",
    sourceDetail:
      input.sourceDetail ??
      (input.sourceChannel && !normalizeLeadSourceChannel(input.sourceChannel)
        ? `raw_source=${input.sourceChannel}`
        : null),
    nextStep,
    discardedNextSteps: discarded,
    ownerUserId: input.ownerUserId ?? null,
    projectName,
  };
}

/**
 * Build the single conversion decision for a lead.
 *
 * Decision order is deliberate and cannot be reordered:
 *   1. minimum data      → blocked_minimum_data
 *   2. ambiguous client  → needs_review
 *   3. duplicate project → needs_review
 *   4. confirmed client  → reuse_client
 *   5. otherwise         → convert
 */
export function buildConversionPlan(
  input: ConversionCandidateInput,
  existingClients: ExistingClientRecord[] = [],
  existingProjects: ExistingProjectRecord[] = [],
): ConversionPlan {
  const ruleIds: string[] = [];
  const warnings: string[] = [];
  const normalized = buildNormalizedPayload(input);

  // ── 1. Minimum data (LIG-007) ───────────────────────────────────────
  const minimum = validateMinimumData(input);
  if (!minimum.valid) {
    ruleIds.push("LIG-007");
    return {
      decision: "blocked_minimum_data",
      ruleIds,
      missingFields: minimum.missingFields,
      blockers: minimum.blockers,
      warnings,
      clientIdToReuse: null,
      clientCandidates: [],
      existingProjectId: null,
      projectCandidates: [],
      normalized,
    };
  }

  if (normalized.discardedNextSteps.length > 0) {
    ruleIds.push("LIG-006");
    warnings.push(
      `Multiple next steps received; normalized to "${normalized.nextStep}" and discarded: ${normalized.discardedNextSteps.join(", ")} (LIG-006).`,
    );
  }
  if (!normalized.nextStep) {
    ruleIds.push("LIG-006");
    warnings.push("No next step provided; lead owner must set exactly one next step (LIG-006).");
  }

  // ── 2. Client matching (LIG-003) ────────────────────────────────────
  const clientCandidates = evaluateClientMatches(input, existingClients);
  const confirmed = clientCandidates.filter((c) => c.strength === "confirmed");
  const ambiguous = clientCandidates.filter((c) => c.strength === "ambiguous");

  const distinctConfirmedIds = Array.from(new Set(confirmed.map((c) => c.clientId)));

  if (distinctConfirmedIds.length > 1) {
    ruleIds.push("LIG-003");
    return {
      decision: "needs_review",
      ruleIds,
      missingFields: [],
      blockers: [
        `Contact matches ${distinctConfirmedIds.length} existing clients (${distinctConfirmedIds.join(", ")}). Merge decision requires an authorized role (LIG-003).`,
      ],
      warnings,
      clientIdToReuse: null,
      clientCandidates,
      existingProjectId: null,
      projectCandidates: [],
      normalized,
    };
  }

  if (distinctConfirmedIds.length === 0 && ambiguous.length > 0) {
    ruleIds.push("LIG-003");
    return {
      decision: "needs_review",
      ruleIds,
      missingFields: [],
      blockers: [
        `Name + address match an existing client (${ambiguous.map((a) => a.clientId).join(", ")}) without matching e-mail or phone. Human review required (LIG-003).`,
      ],
      warnings,
      clientIdToReuse: null,
      clientCandidates,
      existingProjectId: null,
      projectCandidates: [],
      normalized,
    };
  }

  const clientIdToReuse = distinctConfirmedIds[0] ?? null;

  // ── 3. Project matching (LIG-004) ───────────────────────────────────
  const projectCandidates = evaluateProjectMatches(input, existingProjects, clientIdToReuse);
  const sameTypeMatch = projectCandidates.find((p) =>
    p.matchedOn.includes("address_project_type"),
  );

  if (sameTypeMatch) {
    ruleIds.push("LIG-004");
    return {
      decision: "needs_review",
      ruleIds,
      missingFields: [],
      blockers: [
        `An active project already exists at this address with the same project type (project ${sameTypeMatch.projectId}, status ${sameTypeMatch.status ?? "unknown"}). Creating another one requires an authorized decision (LIG-004).`,
      ],
      warnings,
      clientIdToReuse,
      clientCandidates,
      existingProjectId: sameTypeMatch.projectId,
      projectCandidates,
      normalized,
    };
  }

  if (projectCandidates.length > 0) {
    ruleIds.push("LIG-004");
    warnings.push(
      `Address already has ${projectCandidates.length} active project(s) with a different project type. New project allowed as a distinct scope (LIG-004).`,
    );
  }

  // ── 4/5. Reuse client or full convert ───────────────────────────────
  if (clientIdToReuse) {
    ruleIds.push("LIG-004");
    return {
      decision: "reuse_client",
      ruleIds,
      missingFields: [],
      blockers: [],
      warnings,
      clientIdToReuse,
      clientCandidates,
      existingProjectId: null,
      projectCandidates,
      normalized,
    };
  }

  ruleIds.push("LIG-007", "LIG-009");
  return {
    decision: "convert",
    ruleIds,
    missingFields: [],
    blockers: [],
    warnings,
    clientIdToReuse: null,
    clientCandidates,
    existingProjectId: null,
    projectCandidates,
    normalized,
  };
}

/** True when the plan authorizes an immediate transactional write. */
export function planAllowsWrite(plan: ConversionPlan): boolean {
  return plan.decision === "convert" || plan.decision === "reuse_client";
}
