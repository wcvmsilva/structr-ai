/**
 * structr.ai — PHASE 2 Lead → Client → Project Conversion (transactional writer)
 *
 * Implements the conversion gate of docs/phase2-contract.md §3.
 *
 * Division of responsibility:
 *   - shared/intake-conversion.ts  → decides (pure)
 *   - this module                  → persists (transactional, audited)
 *
 * Guarantees:
 *   1. Minimum data enforced before any write (LIG-007)
 *   2. Existing client reused instead of duplicated (LIG-003)
 *   3. No duplicate project at the same address + project type (LIG-004)
 *   4. tenant_id stamped on every created entity (TIA/LIG-001)
 *   5. Idempotent: a lead already converted returns its existing IDs
 *   6. Geo context resolved and propagated to the project after creation
 */

import { and, eq, isNull, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import {
  clients,
  intakeForms,
  leadActivities,
  leads,
  projects,
  tenants,
  type Client,
  type Project,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import { assertSameTenant, isStrictTenantMode, tenantWhere } from "./tenant-scope";
import {
  buildConversionPlan,
  normalizeAddressValue,
  planAllowsWrite,
  type ConversionCandidateInput,
  type ConversionPlan,
  type ExistingClientRecord,
  type ExistingProjectRecord,
} from "@shared/intake-conversion";
import { COMMERCIAL_TO_PRICING_CHANNEL } from "@shared/domain/phase2-taxonomy";
import { buildGeoContextSummary, type GeoContextSummary } from "@shared/geo-context-warnings";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type ConversionErrorCode =
  | "LEAD_NOT_FOUND"
  | "DB_UNAVAILABLE"
  | "MINIMUM_DATA_MISSING"
  | "NEEDS_REVIEW"
  | "TENANT_MISMATCH";

export class LeadConversionError extends Error {
  public readonly code: ConversionErrorCode;
  public readonly plan: ConversionPlan | null;

  constructor(code: ConversionErrorCode, message: string, plan: ConversionPlan | null = null) {
    super(message);
    this.name = "LeadConversionError";
    this.code = code;
    this.plan = plan;
  }
}

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface ConvertLeadInput {
  leadId: string;
  /**
   * Trusted resolved caller tenant. NON-NULLABLE (B2, Codex P1-1 second review).
   *
   * It was previously nullable, and an unresolved caller could pick any lead by primary
   * key and then ADOPT that lead's tenant as their own authority — the lookup was
   * unscoped and the guard `input.tenantId && lead.tenantId && …` failed open on null.
   * With both sides null the candidate loaders ran with no predicate at all and returned
   * every tenant's clients and projects as reuse candidates.
   */
  tenantId: string;
  userId: string;
  /**
   * Operator-supplied completions for the minimum data set. These are merged on top of
   * the lead record, because a website lead frequently lacks project type / client type.
   */
  overrides?: {
    clientName?: string | null;
    email?: string | null;
    phone?: string | null;
    siteAddress?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    projectType?: string | null;
    clientType?: string | null;
    commercialChannel?: string | null;
    sourceChannel?: string | null;
    nextStep?: string | null;
  };
  /** When true, resolve and persist the geo context for the new project. */
  resolveGeo?: boolean;
  /** Allows the caller to inspect the decision without writing anything. */
  dryRun?: boolean;
}

export interface ConvertLeadResult {
  plan: ConversionPlan;
  created: boolean;
  clientId: string | null;
  projectId: string | null;
  intakeFormId: string | null;
  clientReused: boolean;
  geoContext: GeoContextSummary | null;
  warnings: string[];
}

// ══════════════════════════════════════════════════════════════════════
// CANDIDATE LOADING
// ══════════════════════════════════════════════════════════════════════

/**
 * Build the conversion candidate input by merging the lead row with operator overrides.
 * Overrides win, because the operator is completing data the web form could not capture.
 */
function buildCandidateInput(
  lead: typeof leads.$inferSelect,
  input: ConvertLeadInput,
  allowUntenantedCandidates = false,
): ConversionCandidateInput {
  const o = input.overrides ?? {};

  return {
    // B2: ALWAYS the caller's own tenant. Never `?? lead.tenantId` — that was the
    // adoption path by which an unresolved caller inherited a selected lead's authority.
    tenantId: input.tenantId,
    allowUntenantedCandidates,
    leadId: lead.id,
    clientName: o.clientName ?? lead.name,
    email: o.email ?? lead.email,
    phone: o.phone ?? lead.phone,
    siteAddress: o.siteAddress ?? lead.address,
    city: o.city ?? lead.city,
    state: o.state ?? lead.state,
    zip: o.zip ?? lead.zip,
    projectType: o.projectType ?? lead.projectType ?? lead.serviceType,
    clientType: o.clientType ?? lead.clientType,
    commercialChannel: o.commercialChannel ?? lead.commercialChannel,
    sourceChannel: o.sourceChannel ?? lead.sourceChannel ?? lead.source,
    sourceDetail: lead.sourceDetail,
    nextStepCandidates: [o.nextStep ?? lead.nextStep],
    ownerUserId: lead.ownerUserId,
  };
}

/**
 * May a candidate row with `tenant_id IS NULL` be treated as the caller's own — i.e. be
 * reused and updated by the conversion?
 *
 * Only where such a row cannot belong to anyone else: while the deployment holds at most
 * one tenant. As soon as a second tenant exists an un-backfilled row is of unknown
 * ownership, so it may only block the conversion (see `classifyCandidateTenant`), never be
 * reused. `TENANT_STRICT` turns the tolerance off outright, and any failure fails closed.
 *
 * Exported for tests; the conversion paths below are its only production callers.
 */
export async function untenantedCandidatesAllowed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<boolean> {
  if (isStrictTenantMode()) return false;
  try {
    const rows = await db.select({ id: tenants.id }).from(tenants).limit(2);
    return rows.length <= 1;
  } catch {
    return false;
  }
}

/** Load client candidates within the caller's tenant (plus legacy rows without tenant). */
async function loadClientCandidates(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: string,
): Promise<ExistingClientRecord[]> {
  // B2: non-nullable, so the previous unscoped `db.select().from(clients)` branch — which
  // returned every tenant's clients as reuse candidates — no longer exists.
  const rows: Client[] = await db
    .select()
    .from(clients)
    .where(or(eq(clients.tenantId, tenantId), isNull(clients.tenantId)));

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    deletedAt: r.deletedAt,
    isActive: r.isActive,
  }));
}

/** Load project candidates within the caller's tenant (plus legacy rows without tenant). */
async function loadProjectCandidates(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: string,
): Promise<ExistingProjectRecord[]> {
  // B2: non-nullable — see loadClientCandidates.
  const rows: Project[] = await db
    .select()
    .from(projects)
    .where(or(eq(projects.tenantId, tenantId), isNull(projects.tenantId)));

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    clientId: r.clientId,
    name: r.name,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    projectType: r.projectType,
    status: r.status,
    deletedAt: r.deletedAt,
  }));
}

// ══════════════════════════════════════════════════════════════════════
// PLAN (read-only)
// ══════════════════════════════════════════════════════════════════════

/**
 * Evaluate the conversion decision for a lead without writing anything.
 * Used by the UI to show blockers/duplicates before the operator commits.
 */
export async function planLeadConversion(input: ConvertLeadInput): Promise<ConversionPlan> {
  const db = await getDb();
  if (!db) throw new LeadConversionError("DB_UNAVAILABLE", "Database not available");

  // B2: the lookup itself is scoped to the caller's tenant, so a lead outside it is
  // indistinguishable from one that does not exist. A primary-key hit is not authorization.
  const [lead] = await db
    .select()
    .from(leads)
    .where(tenantWhere(leads, input.tenantId, eq(leads.id, input.leadId)))
    .limit(1);
  if (!lead) {
    throw new LeadConversionError("LEAD_NOT_FOUND", `Lead ${input.leadId} not found`);
  }

  if (!assertSameTenant(lead.tenantId, input.tenantId)) {
    throw new LeadConversionError(
      "TENANT_MISMATCH",
      "Lead belongs to a different tenant.",
    );
  }

  const candidate = buildCandidateInput(lead, input, await untenantedCandidatesAllowed(db));
  const [clientCandidates, projectCandidates] = await Promise.all([
    loadClientCandidates(db, input.tenantId),
    loadProjectCandidates(db, input.tenantId),
  ]);

  return buildConversionPlan(candidate, clientCandidates, projectCandidates);
}

// ══════════════════════════════════════════════════════════════════════
// CONVERT (transactional)
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert a lead into a canonical client + project, creating the intake form that
 * carries the flow forward. Runs in a single transaction; a failure leaves no partial
 * client/project behind.
 */
export async function convertLeadToProject(
  input: ConvertLeadInput,
): Promise<ConvertLeadResult> {
  const db = await getDb();
  if (!db) throw new LeadConversionError("DB_UNAVAILABLE", "Database not available");

  // B2: scoped lookup (see planLeadConversion) — the caller cannot reach outside their tenant.
  const [lead] = await db
    .select()
    .from(leads)
    .where(tenantWhere(leads, input.tenantId, eq(leads.id, input.leadId)))
    .limit(1);
  if (!lead) {
    throw new LeadConversionError("LEAD_NOT_FOUND", `Lead ${input.leadId} not found`);
  }

  if (!assertSameTenant(lead.tenantId, input.tenantId)) {
    throw new LeadConversionError("TENANT_MISMATCH", "Lead belongs to a different tenant.");
  }

  // ── Idempotency: already converted ────────────────────────────────
  if (lead.convertedProjectId) {
    const candidate = buildCandidateInput(lead, input);
    const plan = buildConversionPlan(candidate, [], []);
    return {
      plan,
      created: false,
      clientId: lead.convertedClientId ?? null,
      projectId: lead.convertedProjectId,
      intakeFormId: null,
      clientReused: true,
      geoContext: null,
      warnings: [
        `Lead ${lead.id} was already converted to project ${lead.convertedProjectId}. Returning existing identifiers instead of creating duplicates (LIG-004).`,
      ],
    };
  }

  const candidate = buildCandidateInput(lead, input, await untenantedCandidatesAllowed(db));
  const [clientCandidates, projectCandidates] = await Promise.all([
    loadClientCandidates(db, input.tenantId),
    loadProjectCandidates(db, input.tenantId),
  ]);

  const plan = buildConversionPlan(candidate, clientCandidates, projectCandidates);

  // ── Blocked paths: persist the decision, create nothing ───────────
  if (!planAllowsWrite(plan)) {
    if (!input.dryRun) {
      await db
        .update(leads)
        .set({
          conversionDecision: plan.decision,
          conversionBlockers: { blockers: plan.blockers, missingFields: plan.missingFields },
          status: plan.decision === "needs_review" ? "qualified" : lead.status,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, lead.id));

      await logAudit({
        userId: input.userId,
        action: "lead.conversion_blocked",
        tableName: "leads",
        recordId: lead.id,
        before: { status: lead.status },
        after: {
          decision: plan.decision,
          ruleIds: plan.ruleIds,
          missingFields: plan.missingFields,
          blockers: plan.blockers,
        },
      }).catch(() => undefined);
    }

    if (plan.decision === "blocked_minimum_data") {
      throw new LeadConversionError(
        "MINIMUM_DATA_MISSING",
        `Conversion blocked — missing minimum data: ${plan.missingFields.join(", ")}. ${plan.blockers.join(" ")}`,
        plan,
      );
    }

    throw new LeadConversionError(
      "NEEDS_REVIEW",
      `Conversion requires human review. ${plan.blockers.join(" ")}`,
      plan,
    );
  }

  if (input.dryRun) {
    return {
      plan,
      created: false,
      clientId: plan.clientIdToReuse,
      projectId: null,
      intakeFormId: null,
      clientReused: plan.clientIdToReuse != null,
      geoContext: null,
      warnings: plan.warnings,
    };
  }

  // ── Transactional write ───────────────────────────────────────────
  const now = new Date();
  const n = plan.normalized;
  const pricingChannel = n.commercialChannel
    ? COMMERCIAL_TO_PRICING_CHANNEL[n.commercialChannel]
    : "direct";

  const clientId = plan.clientIdToReuse ?? randomUUID();
  const projectId = randomUUID();
  const intakeFormId = randomUUID();

  await db.transaction(async (tx) => {
    // 1. Client — reuse or create
    if (!plan.clientIdToReuse) {
      await tx.insert(clients).values({
        id: clientId,
        tenantId: n.tenantId,
        name: n.clientName,
        email: n.email,
        phone: n.phone,
        emailNormalized: n.emailNormalized,
        phoneNormalized: n.phoneNormalized,
        address: n.siteAddress,
        city: n.city,
        state: n.state,
        zip: n.zip,
        clientType: n.clientType,
        commercialChannel: n.commercialChannel,
        sourceChannel: n.sourceChannel,
        originLeadId: lead.id,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Reuse path: only fill governance fields that are still empty. Never overwrite
      // an existing client's identity data from a new lead payload.
      await tx
        .update(clients)
        .set({
          clientType: n.clientType,
          commercialChannel: n.commercialChannel,
          emailNormalized: n.emailNormalized,
          phoneNormalized: n.phoneNormalized,
          updatedAt: now,
        })
        .where(eq(clients.id, clientId));
    }

    // 2. Project — canonical operational entity
    await tx.insert(projects).values({
      id: projectId,
      tenantId: n.tenantId,
      name: n.projectName,
      clientId,
      ownerUserId: n.ownerUserId ?? input.userId,
      clientName: n.clientName,
      clientEmail: n.email,
      address: n.siteAddress,
      addressNormalized: n.addressNormalized,
      city: n.city,
      state: n.state,
      zip: n.zip,
      projectType: n.projectType ?? "remodel",
      channel: pricingChannel,
      commercialChannel: n.commercialChannel,
      clientType: n.clientType,
      sourceChannel: n.sourceChannel,
      status: "intake",
      leadId: lead.id,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Intake form — carries the lead payload into the operational flow
    await tx.insert(intakeForms).values({
      id: intakeFormId,
      tenantId: n.tenantId,
      leadId: lead.id,
      projectId,
      status: "draft",
      formData: {
        source: "lead_conversion",
        schemaVersion: "phase2.1",
        leadId: lead.id,
        clientId,
        clientName: n.clientName,
        clientType: n.clientType,
        commercialChannel: n.commercialChannel,
        sourceChannel: n.sourceChannel,
        projectType: n.projectType,
        siteAddress: n.siteAddress,
        city: n.city,
        state: n.state,
        zip: n.zip,
        nextStep: n.nextStep,
        discardedNextSteps: n.discardedNextSteps,
        conversionDecision: plan.decision,
        conversionRuleIds: plan.ruleIds,
      },
      createdAt: now,
      updatedAt: now,
    });

    // 4. Lead — mark converted and record the outcome
    await tx
      .update(leads)
      .set({
        status: "converted",
        sourceChannel: n.sourceChannel,
        sourceDetail: n.sourceDetail,
        clientType: n.clientType,
        commercialChannel: n.commercialChannel,
        projectType: n.projectType,
        nextStep: n.nextStep,
        nextStepSetBy: n.nextStep ? input.userId : null,
        nextStepSetAt: n.nextStep ? now : null,
        convertedClientId: clientId,
        convertedProjectId: projectId,
        convertedAt: now,
        conversionDecision: plan.decision,
        conversionBlockers: null,
        updatedAt: now,
      })
      .where(eq(leads.id, lead.id));

    // 5. Lead activity (non-critical for correctness, but part of the trail)
    await tx.insert(leadActivities).values({
      id: randomUUID(),
      leadId: lead.id,
      activityType: "status_change",
      description: `Lead converted — client ${clientId}, project ${projectId}, decision ${plan.decision}.`,
      createdAt: now,
    });
  });

  await logAudit({
    userId: input.userId,
    action: "lead.converted",
    tableName: "projects",
    recordId: projectId,
    before: { leadId: lead.id, leadStatus: lead.status },
    after: {
      decision: plan.decision,
      ruleIds: plan.ruleIds,
      clientId,
      clientReused: plan.clientIdToReuse != null,
      projectId,
      intakeFormId,
      tenantId: n.tenantId,
      commercialChannel: n.commercialChannel,
      clientType: n.clientType,
      sourceChannel: n.sourceChannel,
      projectType: n.projectType,
      warnings: plan.warnings,
    },
  }).catch(() => undefined);

  // ── Geo context (post-commit, non-blocking) ───────────────────────
  let geoContext: GeoContextSummary | null = null;
  const warnings = [...plan.warnings];

  if (input.resolveGeo !== false) {
    try {
      geoContext = await resolveProjectGeoContext(projectId, input.userId);
      warnings.push(...geoContext.warnings.map((w) => `[${w.code}] ${w.message}`));
    } catch (err) {
      warnings.push(
        `Geo context could not be resolved automatically (${(err as Error).message}). Run project.refreshGeocode before scope generation.`,
      );
    }
  }

  return {
    plan,
    created: true,
    clientId,
    projectId,
    intakeFormId,
    clientReused: plan.clientIdToReuse != null,
    geoContext,
    warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════
// GEO CONTEXT PROPAGATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve the geo context for a project and persist the derived warning set.
 *
 * The geocode/zone pipeline already exists (server/geo-integration.ts); this function
 * makes it part of the intake flow instead of an operator-triggered extra step, and
 * reduces its output to the canonical warning codes the Scope Builder consumes.
 */
export async function resolveProjectGeoContext(
  projectId: string,
  userId: string,
): Promise<GeoContextSummary> {
  const db = await getDb();
  if (!db) throw new LeadConversionError("DB_UNAVAILABLE", "Database not available");

  const { refreshProjectGeocode } = await import("./geo-integration");
  const result = await refreshProjectGeocode(projectId, userId);

  const summary = buildGeoContextSummary({
    geocodeSuccess: result.geocode.success,
    geocodeConfidence: result.geocode.confidence,
    withinServiceRadius: result.geocode.withinServiceRadius,
    distanceFromCenter: result.geocode.distanceFromCenter,
    zoneName: result.zoneSnapshot?.zoneName ?? result.zoneDetection?.zone?.zoneName ?? null,
    coastalExposureLevel:
      result.zoneSnapshot?.coastalExposureLevel ??
      result.zoneDetection?.zone?.coastalExposureLevel ??
      null,
    costMultiplier:
      result.zoneSnapshot?.logisticsModifier ?? result.zoneDetection?.zone?.logisticsModifier ?? null,
    minProfitShieldPct:
      result.zoneSnapshot?.minProfitShieldPct ?? result.zoneDetection?.zone?.minProfitShieldPct ?? null,
    rawWarnings: result.warnings,
  });

  await db
    .update(projects)
    .set({
      geoWarnings: summary.warnings,
      geoRiskClass: summary.riskClass,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  await logAudit({
    userId,
    action: "project.geo_context_resolved",
    tableName: "projects",
    recordId: projectId,
    before: null,
    after: {
      zoneName: summary.zoneName,
      riskClass: summary.riskClass,
      codes: summary.codes,
      reliable: summary.reliable,
    },
  }).catch(() => undefined);

  return summary;
}

/**
 * Read the persisted geo context of a project.
 * Falls back to deriving it from the stored geocode columns when the Phase 2 warning
 * set has not been materialized yet (legacy projects created before this migration).
 */
export async function getProjectGeoContext(
  projectId: string,
): Promise<GeoContextSummary | null> {
  const db = await getDb();
  if (!db) return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);

  if (!project) return null;

  const snapshot = (project.zoneModifierSnapshot ?? null) as {
    logisticsModifier?: number;
    coastalExposureLevel?: string;
    minProfitShieldPct?: number;
  } | null;

  return buildGeoContextSummary({
    geocodeSuccess: project.geocodedAt != null,
    geocodeConfidence: project.geocodeConfidence,
    withinServiceRadius: null,
    distanceFromCenter: null,
    zoneName: project.zone,
    coastalExposureLevel: snapshot?.coastalExposureLevel ?? null,
    costMultiplier: snapshot?.logisticsModifier ?? null,
    minProfitShieldPct: snapshot?.minProfitShieldPct ?? null,
    rawWarnings: [],
  });
}

/** Recompute the canonical address key for a project (used when the address changes). */
export function computeAddressKey(address: string | null | undefined): string {
  return normalizeAddressValue(address);
}
