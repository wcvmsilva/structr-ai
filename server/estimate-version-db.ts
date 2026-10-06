/**
 * Legacy estimate version history and C2-A operation holds.
 *
 * Historical rows remain readable. The old copy/change-order signatures create no
 * authority or rows; the reviewed v2 writer remains a separate, unmounted foundation.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { nonHistoricalEstimateCondition } from "./historical-estimate-guard";
import { estimateDrafts, type EstimateDraft } from "../drizzle/schema";
import { holdLegacyEstimateOperation } from "@shared/estimate-legacy-hold";

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
/**
 * A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md / Export§9: "não escolhe versão mais
 * alta se houver ambiguidade: informa candidatos/seleção necessária". Lists every
 * non-superseded, non-historical-capture draft on the project — the SAME exclusion
 * `getVersionChain` already uses (`nonHistoricalEstimateCondition`) — and returns
 * them as explicit candidates, highest version first, for the caller to choose
 * from. Never auto-picks one, never promotes a legacy `approved` draft (the
 * exclusion already screens those out when they are historical captures; a
 * calculated legacy-approved draft that isn't a capture still only becomes a
 * CANDIDATE here — actual export eligibility is decided later, by the writers'
 * own authority resolution, never by this list). A change order
 * (`changeOrderOf` NOT NULL) is also excluded: it is an incremental addendum
 * to its base draft, never itself the exportable project estimate
 * (Integration§4: "A1 não representa o pacote aceito/autorização exigido
 * para a operação existente" of `createChangeOrder`).
 */
export async function getExportableEstimate(
  projectId: string,
): Promise<ExportableEstimateSelection> {
  const db = await getDb();
  if (!db) return { projectId, candidates: [] };
  const rows = await db
    .select({
      id: estimateDrafts.id, version: estimateDrafts.version, status: estimateDrafts.status,
      source: estimateDrafts.source, createdAt: estimateDrafts.createdAt,
    })
    .from(estimateDrafts)
    .where(and(
      eq(estimateDrafts.projectId, projectId), nonHistoricalEstimateCondition(),
      isNull(estimateDrafts.supersededBy), isNull(estimateDrafts.changeOrderOf),
    ))
    .orderBy(desc(estimateDrafts.version));
  return {
    projectId,
    candidates: rows.map(r => ({ estimateDraftId: r.id, version: r.version, status: r.status, source: r.source ?? "unknown", createdAt: r.createdAt })),
  };
}
