/**
 * structr.ai — Lead Conversion Identity & Replay
 *
 * Shared by the two lead→project conversion writers (pipeline-db.ts's
 * orchestrateLeadConversion, lead-conversion.ts's convertLeadToProject): the actor who
 * may convert a lead, the owner a created project inherits, and whether a lead that
 * claims to already be converted actually has a verifiable project behind that claim.
 *
 * Every function here reads on the CALLER'S OWN transaction handle (`tx`) — this module
 * never opens a connection or a transaction of its own, so the caller decides atomicity.
 * Every function returns a discriminated result rather than throwing, so each writer
 * keeps control of its own public error type/shape.
 */

import { eq } from "drizzle-orm";
import { clients, deals, profiles, projects } from "../drizzle/schema";
import { isLeadOwnerScopeMode, type LeadScope, type LeadScopeVia } from "./lead-access";

/** Loosely typed on purpose: both writers pass either a `PostgresJsDatabase` or the
 * transaction proxy handed to their own `db.transaction()` callback — both support
 * `select().from().where().limit().for()`. */
type TxLike = {
  select: (...args: any[]) => any;
};

export type ActorScopeResult =
  | { ok: true; scope: LeadScope }
  | { ok: false; reason: "actor_invalid" };

/**
 * Re-derives the actor's scope FRESH from `profiles`, on the caller's own transaction
 * handle — never trusts a role/tenant claimed by the router's ctx, which could be stale
 * or (for a direct caller of the DB helper) simply absent. Locked with `.for("share")`,
 * matching `createProject`'s existing convention for the same kind of identity check.
 */
export async function resolveActorLeadScope(
  tx: TxLike,
  actorId: string,
  tenantId: string,
): Promise<ActorScopeResult> {
  const [actor] = await tx
    .select({
      id: profiles.id,
      tenantId: profiles.tenantId,
      isActive: profiles.isActive,
      role: profiles.role,
    })
    .from(profiles)
    .where(eq(profiles.id, actorId))
    .limit(1)
    .for("share");

  // `actor.id === actorId` is redundant against a real `WHERE id = $1` (Postgres cannot
  // return a row with a different primary key), but costs nothing and keeps this check
  // correct even if the query above is ever loosened to match on more than the id alone.
  if (!actor || actor.id !== actorId || actor.isActive !== true || actor.tenantId !== tenantId) {
    return { ok: false, reason: "actor_invalid" };
  }

  const via: LeadScopeVia =
    actor.role === "admin" ? "admin" : isLeadOwnerScopeMode() ? "owner" : "tenant";

  return { ok: true, scope: { userId: actorId, tenantId, via } };
}

export type OwnerResolution =
  | { ok: true; ownerUserId: string }
  | { ok: false; reason: "owner_invalid" };

/**
 * A valid persisted owner is preserved; a NULL owner falls back to the already-validated
 * actor; a NON-NULL but invalid owner (inactive, or a different tenant) never silently
 * falls back to the actor — that would misattribute the project to whoever happened to
 * run the conversion.
 */
export async function resolveConvertedProjectOwner(
  tx: TxLike,
  tenantId: string,
  leadOwnerUserId: string | null | undefined,
  actorId: string,
): Promise<OwnerResolution> {
  if (!leadOwnerUserId) return { ok: true, ownerUserId: actorId };

  const [owner] = await tx
    .select({ id: profiles.id, tenantId: profiles.tenantId, isActive: profiles.isActive })
    .from(profiles)
    .where(eq(profiles.id, leadOwnerUserId))
    .limit(1)
    .for("share");

  // Same redundant-against-real-Postgres, costs-nothing identity check as resolveActorLeadScope.
  if (!owner || owner.id !== leadOwnerUserId || owner.isActive !== true || owner.tenantId !== tenantId) {
    return { ok: false, reason: "owner_invalid" };
  }

  return { ok: true, ownerUserId: leadOwnerUserId };
}

export type ExistingConversionResult =
  | { status: "none" }
  | { status: "found"; clientId: string; projectId: string; dealId: string | null }
  | { status: "ambiguous" }
  | { status: "inconsistent" };

/**
 * Looks up an existing conversion for this lead by the durable correlation key
 * (`projects.lead_id`, written by BOTH writers), cross-checked against the lead's own
 * marker fields when present. A marker (`convertedProjectId`/`convertedClientId`) alone
 * is never sufficient — it must point at a project that genuinely exists, in the right
 * tenant, linked back to this lead, with a resolvable client.
 *
 * `requireDeal` distinguishes the two callers' return shapes: the LEGACY pipeline route
 * always returns a `dealId`, so a project found with no matching deal is INCONSISTENT for
 * that caller (nothing to return, and inventing one is forbidden) — the modern route
 * never created a deal to begin with, so the same project is simply FOUND for it.
 */
export async function findExistingConversionForLead(
  tx: TxLike,
  tenantId: string,
  leadId: string,
  markerProjectId: string | null | undefined,
  markerClientId: string | null | undefined,
  options: { requireDeal: boolean },
): Promise<ExistingConversionResult> {
  const rows = await tx
    .select({
      id: projects.id,
      tenantId: projects.tenantId,
      leadId: projects.leadId,
      clientId: projects.clientId,
      deletedAt: projects.deletedAt,
    })
    .from(projects)
    .where(eq(projects.leadId, leadId));

  const consistent = rows.filter(
    (p: any) => p.tenantId === tenantId && p.leadId === leadId && p.deletedAt == null,
  );

  if (consistent.length === 0) {
    // A marker pointing at a project this lookup cannot verify is a broken link, not "no
    // conversion yet" — refusing here is what keeps a stale/foreign marker from ever being
    // trusted on its own.
    return { status: markerProjectId ? "inconsistent" : "none" };
  }
  if (consistent.length > 1) return { status: "ambiguous" };

  const project = consistent[0];
  if (markerProjectId && markerProjectId !== project.id) return { status: "inconsistent" };
  if (!project.clientId) return { status: "inconsistent" };
  if (markerClientId && markerClientId !== project.clientId) return { status: "inconsistent" };

  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, project.clientId))
    .limit(1);
  if (!client) return { status: "inconsistent" };

  const dealRows = await tx.select({ id: deals.id }).from(deals).where(eq(deals.leadId, leadId));
  if (dealRows.length > 1) return { status: "ambiguous" };
  const dealId = dealRows.length === 1 ? dealRows[0].id : null;

  if (options.requireDeal && !dealId) return { status: "inconsistent" };

  return { status: "found", clientId: project.clientId, projectId: project.id, dealId };
}
