/**
 * structr.ai — PHASE 2 Estimate Versioning
 *
 * An approved estimate is immutable (docs/phase2-contract.md §7.3). This module provides
 * the two legitimate ways forward:
 *
 *   1. `createEstimateVersion`  → a new priced version that supersedes the approved one
 *   2. `createChangeOrder`      → an incremental commitment on top of the approved one
 *
 * Both create NEW rows. Nothing here ever mutates an approved draft's money.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import { estimateDrafts, type EstimateDraft } from "../drizzle/schema";
import { logAudit } from "./audit";
import { EstimateGuardError } from "./estimate-db";

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
  /** The single approved, non-superseded version, when one exists. */
  activeApprovedId: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Next version number for a project (max + 1). Starts at 1. */
async function nextVersionForProject(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectId: string | null,
): Promise<number> {
  if (!projectId) return 1;
  const rows = await db
    .select({ version: estimateDrafts.version })
    .from(estimateDrafts)
    .where(eq(estimateDrafts.projectId, projectId))
    .orderBy(desc(estimateDrafts.version))
    .limit(1);
  return (rows[0]?.version ?? 0) + 1;
}

/** Copy the pricing-relevant payload of a draft, excluding identity and lifecycle. */
function copyPricingPayload(source: EstimateDraft): Record<string, unknown> {
  return {
    estimateId: source.estimateId,
    bundleId: source.bundleId,
    bundleName: source.bundleName,
    region: source.region,
    channel: source.channel,
    finishLevel: source.finishLevel,
    lineItems: source.lineItems,
    assemblySelections: source.assemblySelections,
    subtotalCost: source.subtotalCost,
    subtotalPrice: source.subtotalPrice,
    grossProfit: source.grossProfit,
    grossProfitPct: source.grossProfitPct,
    finalTotalPrice: source.finalTotalPrice,
    pricingSchemaVersion: source.pricingSchemaVersion,
    draftData: source.draftData,
    commercialChannel: source.commercialChannel,
    profitShieldFloorPct: source.profitShieldFloorPct,
    profitShieldEvaluation: source.profitShieldEvaluation,
    pricingSnapshot: source.pricingSnapshot,
    scopeDraftId: source.scopeDraftId,
    tenantId: source.tenantId,
  };
}

// ══════════════════════════════════════════════════════════════════════
// CREATE VERSION
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a new estimate version from an existing draft.
 *
 * The source draft is not modified except for `superseded_by`, which is a pointer, not
 * money. The new version starts as `draft`, so it must pass the Profit Shield again at
 * approval — a new version is not a way around the floor.
 */
export async function createEstimateVersion(
  input: CreateVersionInput,
): Promise<{ version: EstimateDraft; supersededId: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [source] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, input.sourceDraftId))
    .limit(1);

  if (!source) throw new Error(`Estimate draft ${input.sourceDraftId} not found`);

  if (source.supersededBy) {
    throw new EstimateGuardError(
      "ESTIMATE_VERSION_LOCKED",
      `Estimate draft ${source.id} was already superseded by ${source.supersededBy}. Version from the newest draft instead.`,
      { estimateDraftId: source.id, supersededBy: source.supersededBy },
    );
  }

  if (!input.reason || input.reason.trim().length < 10) {
    throw new EstimateGuardError(
      "ESTIMATE_VERSION_LOCKED",
      "A new estimate version requires a reason of at least 10 characters — the version history is the audit trail for price changes.",
      { estimateDraftId: source.id },
    );
  }

  const version = await nextVersionForProject(db, source.projectId);
  const now = new Date();
  const payload = copyPricingPayload(source);

  const [created] = await db
    .insert(estimateDrafts)
    .values({
      ...payload,
      projectId: source.projectId,
      status: "draft",
      source: "version",
      version,
      supersedesId: source.id,
      bundleName: input.name ?? `${source.bundleName ?? "Estimate"} — v${version}`,
      changeOrderReason: input.reason,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    } as typeof estimateDrafts.$inferInsert)
    .returning();

  // Point the previous version forward. This is metadata, not money, so it does not
  // violate the immutability rule (and the DB trigger allows it).
  await db
    .update(estimateDrafts)
    .set({ supersededBy: created.id, updatedAt: now })
    .where(eq(estimateDrafts.id, source.id));

  await logAudit({
    userId: input.userId,
    action: "estimate.version_created",
    tableName: "estimate_drafts",
    recordId: created.id,
    before: {
      sourceDraftId: source.id,
      sourceVersion: source.version,
      sourceStatus: source.status,
      sourceFinalTotalPrice: source.finalTotalPrice,
    },
    after: {
      newDraftId: created.id,
      version,
      reason: input.reason,
      status: "draft",
    },
  }).catch(() => undefined);

  return { version: created, supersededId: source.id };
}

// ══════════════════════════════════════════════════════════════════════
// CREATE CHANGE ORDER
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a change order attached to an approved estimate.
 *
 * Unlike a version, a change order does not supersede the base estimate: the original
 * commitment stands and the change order is priced on top of it. Only an approved base
 * can carry a change order — there is nothing to change before the client agrees.
 */
export async function createChangeOrder(
  input: CreateChangeOrderInput,
): Promise<EstimateDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [base] = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, input.baseDraftId))
    .limit(1);

  if (!base) throw new Error(`Estimate draft ${input.baseDraftId} not found`);

  if (base.status !== "approved") {
    throw new EstimateGuardError(
      "SCOPE_NOT_APPROVED",
      `Change orders require an approved base estimate. Draft ${base.id} is "${base.status}" — edit it directly or create a new version instead.`,
      { estimateDraftId: base.id, status: base.status },
    );
  }

  if (!input.reason || input.reason.trim().length < 10) {
    throw new EstimateGuardError(
      "ESTIMATE_VERSION_LOCKED",
      "A change order requires a reason of at least 10 characters describing the change and who requested it.",
      { estimateDraftId: base.id },
    );
  }

  const version = await nextVersionForProject(db, base.projectId);
  const now = new Date();

  const subtotalCost =
    input.subtotalCost == null ? null : String(Number(input.subtotalCost).toFixed(2));
  const subtotalPrice =
    input.subtotalPrice == null ? null : String(Number(input.subtotalPrice).toFixed(2));

  const [created] = await db
    .insert(estimateDrafts)
    .values({
      tenantId: base.tenantId,
      projectId: base.projectId,
      scopeDraftId: base.scopeDraftId,
      status: "draft",
      source: "change_order",
      version,
      changeOrderOf: base.id,
      changeOrderReason: input.reason,
      bundleName: `Change Order — ${base.bundleName ?? "Estimate"} (v${version})`,
      region: base.region,
      channel: base.channel,
      finishLevel: base.finishLevel,
      commercialChannel: base.commercialChannel,
      pricingSnapshot: base.pricingSnapshot,
      pricingSchemaVersion: base.pricingSchemaVersion,
      lineItems: (input.lineItems ?? []) as never,
      subtotalCost,
      subtotalPrice,
      finalTotalPrice: subtotalPrice,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await logAudit({
    userId: input.userId,
    action: "estimate.change_order_created",
    tableName: "estimate_drafts",
    recordId: created.id,
    before: {
      baseDraftId: base.id,
      baseVersion: base.version,
      baseFinalTotalPrice: base.finalTotalPrice,
    },
    after: {
      changeOrderId: created.id,
      version,
      reason: input.reason,
      subtotalCost,
      subtotalPrice,
    },
  }).catch(() => undefined);

  return created;
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Return the full version chain of a project, plus the active approved version. */
export async function getVersionChain(projectId: string): Promise<VersionChain> {
  const db = await getDb();
  if (!db) return { projectId, versions: [], activeApprovedId: null };

  const rows = await db
    .select()
    .from(estimateDrafts)
    .where(eq(estimateDrafts.projectId, projectId))
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

  // The active approved version is the approved row that nothing supersedes and that is
  // not itself a change order.
  const active =
    versions
      .filter((v) => v.status === "approved" && !v.supersededBy && !v.changeOrderOf)
      .sort((a, b) => b.version - a.version)[0] ?? null;

  return { projectId, versions, activeApprovedId: active?.id ?? null };
}

/**
 * Find the approved estimate that may be exported for a project.
 * Returns null when no approved, non-superseded version exists.
 */
export async function getExportableEstimate(
  projectId: string,
): Promise<EstimateDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(estimateDrafts)
    .where(
      and(
        eq(estimateDrafts.projectId, projectId),
        eq(estimateDrafts.status, "approved"),
        isNotNull(estimateDrafts.approvedAt),
      ),
    )
    .orderBy(desc(estimateDrafts.version));

  return rows.find((r) => !r.supersededBy && !r.changeOrderOf) ?? null;
}
