/** Complete exact read projections, without commercial or execution authority. */
import { and, asc, eq, gt, isNull, notInArray, sql } from "drizzle-orm";
import { estimateDrafts, historicalEstimateImports, leads } from "../drizzle/schema";
import {
  aggregateEstimateOpportunityPipeline, aggregateEstimateStats, checkedAggregateCount,
  EstimateAggregateError, prepareEstimateAggregateRow,
  type AggregateReadResult, type EstimateAggregateRow, type EstimateDraftStatsExactV1,
  type LeadOpportunityRow, type PipelineSummaryExactV1,
} from "@shared/estimate-aggregate-engine";
import type { AuthTransaction } from "./auth-transaction";
import { getDb } from "./db";
import { TenantScopeError } from "./tenant-scope";

/**
 * Operational bounds, not population filters: 100,000 records across every scan in
 * one response. Historical/outside-opportunity records also consume the budget.
 * At the exact limit every remaining scan must still prove completion with an
 * empty one-record probe. An exceeded budget discards the whole result.
 * No timeout, retry, OFFSET or driver-error reinterpretation is installed here.
 */
const PAGE_SIZE = 500;
const MAX_RECORDS = 100_000;
class AggregateScanBudgetExceeded extends Error {}
type ScanBudget = { records: number };

// Complete C1 input, including identity and both v2 discriminators. Deliberately
// excludes unrelated notes/metadata/draftData while retaining every consumed field.
const estimateProjection = {
  id: estimateDrafts.id, tenantId: estimateDrafts.tenantId,
  projectId: estimateDrafts.projectId, clientId: estimateDrafts.clientId,
  createdBy: estimateDrafts.createdBy, source: estimateDrafts.source,
  status: estimateDrafts.status, version: estimateDrafts.version,
  supersedesId: estimateDrafts.supersedesId, supersededBy: estimateDrafts.supersededBy,
  changeOrderOf: estimateDrafts.changeOrderOf,
  a1VersionRequestId: estimateDrafts.a1VersionRequestId,
  a1VersionRequestHash: estimateDrafts.a1VersionRequestHash,
  subtotalPrice: estimateDrafts.subtotalPrice, subtotalCost: estimateDrafts.subtotalCost,
  discountAmount: estimateDrafts.discountAmount, finalTotalPrice: estimateDrafts.finalTotalPrice,
  discountApplied: estimateDrafts.discountApplied,
  lineItems: estimateDrafts.lineItems, assemblySelections: estimateDrafts.assemblySelections,
  assemblyCount: estimateDrafts.assemblyCount, zone: estimateDrafts.zone,
  pricingSnapshot: estimateDrafts.pricingSnapshot, pricingSchemaVersion: estimateDrafts.pricingSchemaVersion,
  scopeDraftId: estimateDrafts.scopeDraftId, region: estimateDrafts.region,
  commercialChannel: estimateDrafts.commercialChannel, createdAt: estimateDrafts.createdAt,
  // Correlated lookup has one scalar result, so links never duplicate a draft.
  // Its same-snapshot relation remains authoritative if the source label changed.
  historicalImportId: sql<string | null>`(SELECT ${historicalEstimateImports.id}
    FROM ${historicalEstimateImports}
    WHERE ${historicalEstimateImports.estimateDraftId} = ${estimateDrafts.id}
    ORDER BY ${historicalEstimateImports.id} ASC LIMIT 1)`,
};

function requireTenant(tenantId: string): void {
  if (!tenantId) throw new TenantScopeError("estimate aggregate read");
}

function ageInDays(from: unknown, now: Date): number | null {
  const timestamp = from instanceof Date ? from.getTime() : typeof from === "string" ? Date.parse(from) : NaN;
  return Number.isFinite(timestamp) ? Math.round((now.getTime() - timestamp) / 86_400_000) : null;
}

async function scan<Row extends { id: string }>(
  budget: ScanBudget,
  read: (cursor: string | null, limit: number) => PromiseLike<Row[]>,
  consume: (row: Row) => void,
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const limit = Math.min(PAGE_SIZE, MAX_RECORDS - budget.records + 1);
    const page = await read(cursor, limit);
    budget.records = checkedAggregateCount(budget.records, page.length);
    if (budget.records > MAX_RECORDS) throw new AggregateScanBudgetExceeded();
    for (const row of page) consume(row);
    if (page.length < limit) return;
    cursor = page[page.length - 1].id;
  }
}

async function readEstimates(
  tx: AuthTransaction, tenantId: string, budget: ScanBudget, now?: Date,
): Promise<EstimateAggregateRow[]> {
  const rows: EstimateAggregateRow[] = [];
  await scan(budget, (cursor, limit) => tx.select(estimateProjection).from(estimateDrafts)
    // Explicit equality stays strict even when global transitional flags are off.
    // All statuses/H1 rows must be read to account for the excluded populations.
    .where(and(eq(estimateDrafts.tenantId, tenantId), cursor ? gt(estimateDrafts.id, cursor) : undefined))
    .orderBy(asc(estimateDrafts.id)).limit(limit), row => {
      rows.push(prepareEstimateAggregateRow(row, {
        historicalImportId: row.historicalImportId,
        ageDays: now ? ageInDays(row.createdAt, now) : null,
      }));
    });
  return rows;
}

async function readLeads(
  tx: AuthTransaction, tenantId: string, budget: ScanBudget, now: Date,
): Promise<LeadOpportunityRow[]> {
  const rows: LeadOpportunityRow[] = [];
  await scan(budget, (cursor, limit) => tx.select({
    id: leads.id, status: leads.status, commercialChannel: leads.commercialChannel, createdAt: leads.createdAt,
  }).from(leads).where(and(
    eq(leads.tenantId, tenantId), cursor ? gt(leads.id, cursor) : undefined,
    notInArray(leads.status, ["won", "lost", "disqualified", "converted"]), isNull(leads.convertedProjectId),
  )).orderBy(asc(leads.id)).limit(limit), row => {
    // NOT IN excludes SQL NULL; a contradictory returned row is an internal error.
    if (row.status === null) throw new Error("Unexpected lead outside the selected population");
    rows.push({ id: row.id, stage: row.status, commercialChannel: row.commercialChannel, ageDays: ageInDays(row.createdAt, now) });
  });
  return rows;
}

async function withAggregateSnapshot<T>(
  tenantId: string, read: (tx: AuthTransaction, budget: ScanBudget) => Promise<AggregateReadResult<T>>,
): Promise<AggregateReadResult<T>> {
  requireTenant(tenantId);
  const db = await getDb();
  if (!db) return { state: "unavailable", reason: "DB_UNAVAILABLE" };
  try {
    return await db.transaction(tx => read(tx, { records: 0 }), {
      isolationLevel: "repeatable read", accessMode: "read only",
    });
  } catch (error) {
    if (error instanceof AggregateScanBudgetExceeded) return { state: "unavailable", reason: "INCOMPLETE_SCAN" };
    if (error instanceof EstimateAggregateError && error.code === "COUNT_OVERFLOW") return { state: "unavailable", reason: "COUNT_OVERFLOW" };
    throw error;
  }
}

export function getExactEstimateStats(tenantId: string): Promise<AggregateReadResult<EstimateDraftStatsExactV1>> {
  return withAggregateSnapshot(tenantId, async (tx, budget) => aggregateEstimateStats(await readEstimates(tx, tenantId, budget)));
}

export function getExactEstimatePipeline(input: { tenantId: string; now?: Date }): Promise<AggregateReadResult<PipelineSummaryExactV1>> {
  const now = new Date((input.now ?? new Date()).getTime());
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid pipeline reference time");
  return withAggregateSnapshot(input.tenantId, async (tx, budget) => {
    const estimates = await readEstimates(tx, input.tenantId, budget, now);
    const leadRows = await readLeads(tx, input.tenantId, budget, now);
    return aggregateEstimateOpportunityPipeline({ estimates, leads: leadRows });
  });
}
