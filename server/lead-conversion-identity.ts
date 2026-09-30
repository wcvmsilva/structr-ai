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
import { requireProjectAccess, ProjectAccessError } from "./project-access";

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
  | { status: "inconsistent" }
  /** The link is real and consistent, but this actor has no project-level access to it —
   * distinct from "inconsistent" (broken/foreign data), never conflated with it so a
   * caller can tell "you may not see this" from "this doesn't add up". */
  | { status: "forbidden" };

/**
 * Looks up an existing conversion for this lead by the durable correlation key
 * (`projects.lead_id`, written by BOTH writers), cross-checked against the lead's own
 * marker fields when present, the project's own ACL, and the client/deal rows' own
 * tenant/active state. A marker alone, or a lead-level correlation alone, is never
 * sufficient:
 *   - "the project is linked to this lead" is not "this actor may access the project" —
 *     that is a separate authority, checked here via the real `requireProjectAccess` guard
 *     (owner/membership/RBAC precedence), on the same transaction handle.
 *   - a client that exists but is foreign-tenant, inactive or soft-deleted is not a
 *     resolvable client.
 *   - a deal that exists but belongs to another tenant is not a resolvable deal.
 *   - rows that exist for this lead but were filtered out as foreign/deleted are NOT the
 *     same as no rows existing at all — the former is a broken link (inconsistent), the
 *     latter is genuinely nothing yet (none). A marker alone (project OR client) with no
 *     consistent row behind it is the same broken-link case.
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
  actorId: string,
  markerProjectId: string | null | undefined,
  markerClientId: string | null | undefined,
  options: { requireDeal: boolean },
): Promise<ExistingConversionResult> {
  const projectRows = await tx
    .select({
      id: projects.id,
      tenantId: projects.tenantId,
      leadId: projects.leadId,
      clientId: projects.clientId,
      deletedAt: projects.deletedAt,
    })
    .from(projects)
    .where(eq(projects.leadId, leadId));

  // ANY correlation beyond a single row is contradictory evidence — never silently narrow
  // to "the one that looks valid" and proceed as if the other did not exist. Multiplicity
  // itself is the finding, checked before either row is filtered by tenant/deleted state.
  if (projectRows.length > 1) return { status: "ambiguous" };

  const dealRowsRaw = await tx
    .select({ id: deals.id, tenantId: deals.tenantId })
    .from(deals)
    .where(eq(deals.leadId, leadId));
  if (dealRowsRaw.length > 1) return { status: "ambiguous" };

  if (projectRows.length === 0) {
    // No project correlation at all. A marker, OR an orphan deal with no project behind
    // it (a partial/legacy write that never finished), is still evidence something already
    // happened here — never silently "nothing has happened yet", which would let a new
    // conversion — and, via the sibling writer, a second deal — be created over it.
    if (markerProjectId || markerClientId || dealRowsRaw.length > 0) {
      return { status: "inconsistent" };
    }
    return { status: "none" };
  }

  const rawProject = projectRows[0];
  const projectConsistent =
    rawProject.tenantId === tenantId && rawProject.leadId === leadId && rawProject.deletedAt == null;
  if (!projectConsistent) return { status: "inconsistent" };
  if (markerProjectId && markerProjectId !== rawProject.id) return { status: "inconsistent" };
  if (!rawProject.clientId) return { status: "inconsistent" };
  if (markerClientId && markerClientId !== rawProject.clientId) return { status: "inconsistent" };

  // The lead-level correlation only proves A project references this lead — it is not
  // project-level authorization. Reuse the existing ACL primitive (owner/membership/RBAC
  // precedence), on the SAME handle, rather than treating "linked" as "accessible". This
  // also takes the project's own row lock (requireProjectAccess's `FOR UPDATE`).
  try {
    await requireProjectAccess(rawProject.id, actorId, "read", {
      mode: "a1",
      transaction: tx as any,
      expectedTenantId: tenantId,
    });
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      if (err.code === "FORBIDDEN") return { status: "forbidden" };
      // NOT_FOUND/BAD_REQUEST: the guard's own lookup disagrees with what was just read —
      // a broken link, not a permission question.
      return { status: "inconsistent" };
    }
    // An unexpected/infrastructure failure is not a data-consistency verdict — propagate
    // it rather than relabeling a crash as "this lead's link is broken".
    throw err;
  }

  // requireProjectAccess only re-reads/locks id/tenant/owner/deletedAt — it does not
  // confirm leadId/clientId are still what the unlocked read above saw. Re-read those
  // fields on THIS handle now that the row is actually locked, so a link that changed
  // between the first read and the guard's lock is never silently trusted.
  const [relocked] = await tx
    .select({
      id: projects.id,
      tenantId: projects.tenantId,
      leadId: projects.leadId,
      clientId: projects.clientId,
      deletedAt: projects.deletedAt,
    })
    .from(projects)
    .where(eq(projects.id, rawProject.id))
    .limit(1);
  if (
    !relocked ||
    relocked.leadId !== leadId ||
    relocked.tenantId !== tenantId ||
    relocked.deletedAt != null ||
    !relocked.clientId
  ) {
    return { status: "inconsistent" };
  }
  if (markerClientId && markerClientId !== relocked.clientId) return { status: "inconsistent" };

  const [client] = await tx
    .select({
      id: clients.id,
      tenantId: clients.tenantId,
      isActive: clients.isActive,
      deletedAt: clients.deletedAt,
    })
    .from(clients)
    .where(eq(clients.id, relocked.clientId))
    .limit(1);
  if (!client || client.tenantId !== tenantId || client.isActive !== true || client.deletedAt != null) {
    return { status: "inconsistent" };
  }

  // `dealRowsRaw` was read BEFORE the project's own lock was acquired above (it had to be,
  // to decide the zero-project/orphan-deal branch before there was any project to lock) —
  // a writer could change the deal's own tenant/leadId while `requireProjectAccess` was
  // still acquiring the project's lock. Re-read deals fresh, by leadId, now that the
  // project row this decision is keyed on is actually locked and re-verified, instead of
  // deriving the final `dealId` from that earlier snapshot. Re-check multiplicity on this
  // fresh read too — never assume the earlier count still holds.
  const dealRowsAtLock = await tx
    .select({ id: deals.id, tenantId: deals.tenantId, leadId: deals.leadId })
    .from(deals)
    .where(eq(deals.leadId, leadId));
  if (dealRowsAtLock.length > 1) return { status: "ambiguous" };

  const consistentDeals = dealRowsAtLock.filter(
    (d: any) => d.tenantId === tenantId && d.leadId === leadId,
  );
  if (dealRowsAtLock.length > 0 && consistentDeals.length === 0) return { status: "inconsistent" };
  const dealId = consistentDeals.length === 1 ? consistentDeals[0].id : null;

  if (options.requireDeal && !dealId) return { status: "inconsistent" };

  return { status: "found", clientId: relocked.clientId, projectId: relocked.id, dealId };
}
