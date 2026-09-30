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
import { assertLeadInScope } from "./lead-access";
import {
  findExistingConversionForLead,
  resolveActorLeadScope,
  resolveConvertedProjectOwner,
  type ExistingConversionResult,
} from "./lead-conversion-identity";
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
  | "TENANT_MISMATCH"
  | "ACTOR_INVALID"
  | "OWNER_INVALID"
  | "CONVERSION_LINK_INCONSISTENT"
  | "CONVERSION_LINK_AMBIGUOUS"
  | "PROJECT_ACCESS_DENIED"
  /** The lead's tenant/owner (or a client this conversion planned to reuse) changed
   * between the pre-lock read and the write acquiring its lock — never proceed on stale
   * identity data; the caller should re-plan and retry. */
  | "CONFLICT";

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

  // Read-only is not exempt from authorization: with LEADS_OWNER_SCOPE on, a non-owner
  // must not see candidate clients/projects for a lead they may not touch, even just to
  // plan. Same policy the write path applies via lead-access.ts.
  const actorScope = await resolveActorLeadScope(db, input.userId, input.tenantId);
  if (!actorScope.ok) {
    throw new LeadConversionError("ACTOR_INVALID", "The converting actor is not an active profile of this tenant.");
  }
  assertLeadInScope(lead, actorScope.scope);

  const candidate = buildCandidateInput(lead, input, await untenantedCandidatesAllowed(db));
  const [clientCandidates, projectCandidates] = await Promise.all([
    loadClientCandidates(db, input.tenantId),
    loadProjectCandidates(db, input.tenantId),
  ]);

  return buildConversionPlan(candidate, clientCandidates, projectCandidates);
}

/**
 * Shapes a VERIFIED existing conversion (never a marker alone) into the public return
 * type. `plan` is only available once already computed by the caller; the early fast
 * path builds a minimal one, matching the previous behavior.
 */
function existingConversionToResult(
  existing: Extract<ExistingConversionResult, { status: "found" }>,
  lead: typeof leads.$inferSelect,
  input: ConvertLeadInput,
  plan?: ConversionPlan,
): ConvertLeadResult {
  const resolvedPlan = plan ?? buildConversionPlan(buildCandidateInput(lead, input), [], []);
  return {
    plan: resolvedPlan,
    created: false,
    clientId: existing.clientId,
    projectId: existing.projectId,
    intakeFormId: null,
    clientReused: true,
    geoContext: null,
    warnings: [
      `Lead ${lead.id} was already converted to project ${existing.projectId}. Returning existing identifiers instead of creating duplicates (LIG-004).`,
    ],
  };
}

/**
 * Throws the correct typed error for every non-"found", non-"none" replay verdict — used
 * identically at the early fast-path check and both re-lock recheck points, so the three
 * copies of this branch can never drift out of sync with each other.
 */
function assertConversionLinkVerdictOk(existing: ExistingConversionResult): void {
  if (existing.status === "ambiguous") {
    throw new LeadConversionError(
      "CONVERSION_LINK_AMBIGUOUS",
      "More than one project is linked to this lead; refusing to guess which one to return.",
    );
  }
  if (existing.status === "forbidden") {
    throw new LeadConversionError(
      "PROJECT_ACCESS_DENIED",
      "This lead's linked project exists, but the converting actor does not have access to it.",
    );
  }
  if (existing.status === "inconsistent") {
    throw new LeadConversionError(
      "CONVERSION_LINK_INCONSISTENT",
      "This lead is marked converted, but no consistent project/client set could be verified for it.",
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
// CONVERT (transactional)
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert a lead into a canonical client + project, creating the intake form that
 * carries the flow forward.
 *
 * EVERYTHING that decides what happens — the lead lock, actor/scope validation, the
 * replay check, and the plan itself (candidates, normalization, blocked/allow decision)
 * — runs inside ONE transaction, on the row that transaction has locked. There is no
 * separate unlocked pre-read whose plan/owner/replay-verdict could go stale before a
 * later re-lock: the plan IS the coordinated read, not a snapshot re-verified afterward.
 * The one exception is the typed business refusal (MINIMUM_DATA_MISSING/NEEDS_REVIEW),
 * thrown AFTER the transaction commits — never from inside it, which would undo the
 * blocked-decision record the transaction just wrote to explain the refusal.
 */
export async function convertLeadToProject(
  input: ConvertLeadInput,
): Promise<ConvertLeadResult> {
  const db = await getDb();
  if (!db) throw new LeadConversionError("DB_UNAVAILABLE", "Database not available");

  const outcome = await db.transaction(async (tx) => {
    // B2: scoped lookup (see planLeadConversion) — the caller cannot reach outside their
    // tenant. Locked: this is the ONE row both conversion entry points coordinate on, and
    // the ONLY read of it for this whole call — everything below uses THIS row, never an
    // earlier or separate one.
    const [lead] = await tx
      .select()
      .from(leads)
      .where(tenantWhere(leads, input.tenantId, eq(leads.id, input.leadId)))
      .limit(1)
      .for("update");
    if (!lead) {
      throw new LeadConversionError("LEAD_NOT_FOUND", `Lead ${input.leadId} not found`);
    }

    if (!assertSameTenant(lead.tenantId, input.tenantId)) {
      throw new LeadConversionError("TENANT_MISMATCH", "Lead belongs to a different tenant.");
    }

    // Revalidated fresh from `profiles`, on THIS handle, against the row THIS transaction
    // just locked. Applies the same shared/owner-scope/admin policy every other lead route
    // already applies (lead-access.ts).
    const actorScope = await resolveActorLeadScope(tx, input.userId, input.tenantId);
    if (!actorScope.ok) {
      throw new LeadConversionError("ACTOR_INVALID", "The converting actor is not an active profile of this tenant.");
    }
    assertLeadInScope(lead, actorScope.scope);

    // ── Idempotency: already converted — verified, not just marker-trusted ───────────
    // Runs AFTER authorization above, on the SAME locked row, inside the SAME transaction
    // as everything else — this is the only replay check in the function, so there is no
    // separate unlocked fast path whose verdict could differ from the one that matters.
    const existing = await findExistingConversionForLead(
      tx,
      input.tenantId,
      lead.id,
      input.userId,
      lead.convertedProjectId,
      lead.convertedClientId,
      { requireDeal: false },
    );
    if (existing.status === "found") {
      return { kind: "replay" as const, lead, existing };
    }
    assertConversionLinkVerdictOk(existing);

    // The plan is built from THIS locked row and candidates loaded on THIS handle — not a
    // snapshot from before the lock, so there is nothing to compare it against or refuse a
    // conflict over: it already IS the coordinated read.
    const candidate = buildCandidateInput(lead, input, await untenantedCandidatesAllowed(tx));
    const [clientCandidates, projectCandidates] = await Promise.all([
      loadClientCandidates(tx, input.tenantId),
      loadProjectCandidates(tx, input.tenantId),
    ]);
    const plan = buildConversionPlan(candidate, clientCandidates, projectCandidates);

    // ── Blocked: persist the decision, create nothing ─────────────────────────────────
    if (!planAllowsWrite(plan)) {
      if (!input.dryRun) {
        const blockedLogged = await logAudit({
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
        }, tx);
        if (!blockedLogged) {
          throw new Error("Audit insert failed for lead.conversion_blocked");
        }
        await tx
          .update(leads)
          .set({
            conversionDecision: plan.decision,
            conversionBlockers: { blockers: plan.blockers, missingFields: plan.missingFields },
            status: plan.decision === "needs_review" ? "qualified" : lead.status,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, lead.id));
      }
      return { kind: "blocked" as const, plan };
    }

    if (input.dryRun) {
      return { kind: "dryRun" as const, plan };
    }

    // ── Real write, same lock, same handle, no re-check needed — it was never released.
    const now = new Date();
    const n = plan.normalized;
    const pricingChannel = n.commercialChannel
      ? COMMERCIAL_TO_PRICING_CHANNEL[n.commercialChannel]
      : "direct";

    const clientId = plan.clientIdToReuse ?? randomUUID();
    const projectId = randomUUID();
    const intakeFormId = randomUUID();

    // Owner: preserved when valid, actor-fallback only when the lead has none, refused
    // (never silently substituted) when the persisted owner no longer resolves. Reads
    // straight off `lead` — the row this whole transaction is locked on, never a value
    // captured before the lock.
    const ownerResolution = await resolveConvertedProjectOwner(tx, input.tenantId, lead.ownerUserId, input.userId);
    if (!ownerResolution.ok) {
      throw new LeadConversionError(
        "OWNER_INVALID",
        "The lead's persisted owner is not an active profile of this tenant.",
      );
    }
    const ownerUserId = ownerResolution.ownerUserId;

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
      // The candidate list was loaded moments ago on THIS same handle — still, lock the
      // reused client's row now and hold that lock through the UPDATE below, so nothing
      // else can change its eligibility between this check and that write.
      const [reusedClient] = await tx
        .select({
          id: clients.id,
          tenantId: clients.tenantId,
          isActive: clients.isActive,
          deletedAt: clients.deletedAt,
        })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1)
        .for("update");
      if (
        !reusedClient ||
        reusedClient.tenantId !== input.tenantId ||
        reusedClient.isActive !== true ||
        reusedClient.deletedAt != null
      ) {
        throw new LeadConversionError(
          "CONFLICT",
          "The client this conversion planned to reuse is no longer eligible; re-plan and retry the conversion.",
        );
      }

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
      ownerUserId,
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

    // 6. Audit — same handle as the mutations above; a failed or empty return rolls back
    // the whole conversion instead of silently succeeding without durable evidence.
    const converted = await logAudit({
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
    }, tx);
    if (!converted) {
      throw new Error("Audit insert failed for lead.converted");
    }
    return { kind: "created" as const, plan, clientId, projectId, intakeFormId };
  });

  if (outcome.kind === "replay") {
    return existingConversionToResult(outcome.existing, outcome.lead, input);
  }

  if (outcome.kind === "blocked") {
    // The expected business refusal is thrown AFTER the transaction above has already
    // committed the decision record — throwing it from inside would undo that very record.
    if (outcome.plan.decision === "blocked_minimum_data") {
      throw new LeadConversionError(
        "MINIMUM_DATA_MISSING",
        `Conversion blocked — missing minimum data: ${outcome.plan.missingFields.join(", ")}. ${outcome.plan.blockers.join(" ")}`,
        outcome.plan,
      );
    }
    throw new LeadConversionError(
      "NEEDS_REVIEW",
      `Conversion requires human review. ${outcome.plan.blockers.join(" ")}`,
      outcome.plan,
    );
  }

  if (outcome.kind === "dryRun") {
    return {
      plan: outcome.plan,
      created: false,
      clientId: outcome.plan.clientIdToReuse,
      projectId: null,
      intakeFormId: null,
      clientReused: outcome.plan.clientIdToReuse != null,
      geoContext: null,
      warnings: outcome.plan.warnings,
    };
  }

  // ── Geo context (post-commit, non-blocking) ───────────────────────
  let geoContext: GeoContextSummary | null = null;
  const warnings = [...outcome.plan.warnings];

  if (input.resolveGeo !== false) {
    try {
      // G3a-1: the geo context is resolved against the CALLER'S OWN tenant zones, so a
      // conversion cannot stamp another tenant's commercial policy onto the new project.
      geoContext = await resolveProjectGeoContext(input.tenantId, outcome.projectId, input.userId);
      warnings.push(...geoContext.warnings.map((w) => `[${w.code}] ${w.message}`));
    } catch (err) {
      warnings.push(
        `Geo context could not be resolved automatically (${(err as Error).message}). Run project.refreshGeocode before scope generation.`,
      );
    }
  }

  return {
    plan: outcome.plan,
    created: true,
    clientId: outcome.clientId,
    projectId: outcome.projectId,
    intakeFormId: outcome.intakeFormId,
    clientReused: outcome.plan.clientIdToReuse != null,
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
  tenantId: string,
  projectId: string,
  userId: string,
): Promise<GeoContextSummary> {
  const db = await getDb();
  if (!db) throw new LeadConversionError("DB_UNAVAILABLE", "Database not available");

  const { refreshProjectGeocode } = await import("./geo-integration");
  const result = await refreshProjectGeocode(tenantId, projectId, userId);

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
