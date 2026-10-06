/**
 * Legacy estimate version history and C2-A operation holds.
 *
 * Historical rows remain readable. The old copy/change-order signatures create no
 * authority or rows; the reviewed v2 writer remains a separate, unmounted foundation.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { nonHistoricalEstimateCondition } from "./historical-estimate-guard";
import { estimateDrafts, tenants, type EstimateDraft } from "../drizzle/schema";
import { holdLegacyEstimateOperation } from "@shared/estimate-legacy-hold";
import { requireProjectAccess, ProjectAccessError } from "./project-access";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface CreateVersionInput {
  /** Approved (or any) draft that the new version derives from. */
  sourceDraftId: string;
  userId: string;
  reason: string;
  /** Optional new bundle/estimate label for the version. */
  name?: string | null;
}

export interface CreateChangeOrderInput {
  /** Approved draft the change order attaches to. */
  baseDraftId: string;
  userId: string;
  reason: string;
  /** Change order line items (same shape as estimate line items). */
  lineItems?: unknown[];
  /** Incremental cost and price of the change order. */
  subtotalCost?: string | number | null;
  subtotalPrice?: string | number | null;
}

export interface VersionChain {
  projectId: string | null;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    finalTotalPrice: string | null;
    supersedesId: string | null;
    supersededBy: string | null;
    changeOrderOf: string | null;
    lockedAt: Date | null;
    approvedAt: Date | null;
    createdAt: Date;
  }>;
  /** Compatibility field: historical status never selects current authority. Always null. */
  activeApprovedId: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/** The old copy command is held until the reviewed v2 flow replaces its route. */
export async function createEstimateVersion(
  input: CreateVersionInput,
): Promise<{ version: EstimateDraft; supersededId: string }> {
  return holdLegacyEstimateOperation("version");
}

/** A historical approved label does not authorize a commercial change order. */
export async function createChangeOrder(
  input: CreateChangeOrderInput,
): Promise<EstimateDraft> {
  return holdLegacyEstimateOperation("change_order");
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Return historical version facts without selecting approval or execution authority. */
export async function getVersionChain(projectId: string): Promise<VersionChain> {
  const db = await getDb();
  if (!db) return { projectId, versions: [], activeApprovedId: null };

  const rows = await db
    .select()
    .from(estimateDrafts)
    .where(and(eq(estimateDrafts.projectId, projectId), nonHistoricalEstimateCondition()))
    .orderBy(estimateDrafts.version, estimateDrafts.createdAt);

  const versions = rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    finalTotalPrice: r.finalTotalPrice,
    supersedesId: r.supersedesId,
    supersededBy: r.supersededBy,
    changeOrderOf: r.changeOrderOf,
    lockedAt: r.lockedAt,
    approvedAt: r.approvedAt,
    createdAt: r.createdAt,
  }));

  return { projectId, versions, activeApprovedId: null };
}

export interface ExportableEstimateCandidate {
  estimateDraftId: string; version: number; status: string; source: string; createdAt: Date;
}
export interface ExportableEstimateSelection {
  projectId: string;
  candidates: ExportableEstimateCandidate[];
}
/** Authenticated caller context — never a payload field. Required: an
 * unauthenticated call is a refusal, never a successful empty list
 * (MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md #1). */
export interface ExportableEstimateContext { tenantId: string; actorId: string; }

/**
 * A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md / Export§9: "não escolhe versão mais
 * alta se houver ambiguidade: informa candidatos/seleção necessária". Lists every
 * non-superseded, non-historical-capture, non-change-order draft on the project
 * — the SAME exclusion `getVersionChain` already uses
 * (`nonHistoricalEstimateCondition`), plus `changeOrderOf IS NULL` (a change
 * order is an incremental addendum to its base draft, never itself the
 * exportable project estimate — Integration§4) — as explicit candidates,
 * highest version first. Never auto-picks one.
 *
 * Authorization is now REQUIRED and real (QA #1): the caller must supply its
 * authenticated `{tenantId,actorId}` (never a payload field); this helper
 * revalidates the project inside its OWN short serializable transaction via
 * the SAME accepted A1 chokepoint every other export reader uses
 * (`requireProjectAccess(..., {mode:'a1', transaction, expectedTenantId})`),
 * tenant-scoping the candidate query itself too — a project owner whose
 * CURRENT session tenant doesn't match the project's real tenant (or has no
 * tenant at all) is refused, never silently handed candidates. Absence of a
 * context, or of a database connection, is a refusal — never a successful
 * empty list, which would be indistinguishable from "authorized, no
 * candidates" to a caller.
 */
export async function getExportableEstimate(
  context: ExportableEstimateContext,
  projectId: string,
): Promise<ExportableEstimateSelection> {
  if (!context?.tenantId || !context?.actorId) {
    throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
  }
  const db = await getDb();
  if (!db) throw new ProjectAccessError("FORBIDDEN", "Export candidate selection is unavailable.");
  return db.transaction(async tx => {
    const [tenant] = await tx.select({ id: tenants.id, isActive: tenants.isActive }).from(tenants)
      .where(eq(tenants.id, context.tenantId)).limit(1).for("share");
    if (!tenant || tenant.isActive !== true) throw new ProjectAccessError("FORBIDDEN", FORBIDDEN_PROJECT_ERR_MSG);
    await requireProjectAccess(projectId, context.actorId, "read", {
      mode: "a1", transaction: tx, expectedTenantId: context.tenantId,
    });
    const rows = await tx
      .select({
        id: estimateDrafts.id, version: estimateDrafts.version, status: estimateDrafts.status,
        source: estimateDrafts.source, createdAt: estimateDrafts.createdAt,
      })
      .from(estimateDrafts)
      .where(and(
        eq(estimateDrafts.projectId, projectId), eq(estimateDrafts.tenantId, context.tenantId),
        nonHistoricalEstimateCondition(), isNull(estimateDrafts.supersededBy), isNull(estimateDrafts.changeOrderOf),
      ))
      .orderBy(desc(estimateDrafts.version));
    return {
      projectId,
      candidates: rows.map(r => ({ estimateDraftId: r.id, version: r.version, status: r.status, source: r.source ?? "unknown", createdAt: r.createdAt })),
    };
  }, { isolationLevel: "serializable" });
}
