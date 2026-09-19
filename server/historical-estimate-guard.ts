import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { estimateDrafts, historicalEstimateImports } from "../drizzle/schema";
import { HISTORICAL_ESTIMATE_SOURCE } from "@shared/domain/taxonomy";
import { assertHistoricalCaptureOnly } from "@shared/historical-estimate-engine";

type EstimateReader = Pick<PostgresJsDatabase, "select">;
type DraftIdentity = { id: string; source?: string | null };

/** The immutable relation remains authoritative if a legacy source label changes. */
export async function getHistoricalImportId(db: EstimateReader, draftId: string): Promise<string | null> {
  const [entry] = await db.select({ id: historicalEstimateImports.id })
    .from(historicalEstimateImports)
    .where(eq(historicalEstimateImports.estimateDraftId, draftId)).limit(1);
  return entry?.id ?? null;
}

export async function isHistoricalEstimateDraft(db: EstimateReader, draft: DraftIdentity): Promise<boolean> {
  return draft.source === HISTORICAL_ESTIMATE_SOURCE || (await getHistoricalImportId(db, draft.id)) !== null;
}

export async function assertNotHistoricalEstimateDraft(
  db: EstimateReader, draft: DraftIdentity, action = "legacy estimate operation",
): Promise<void> {
  assertHistoricalCaptureOnly({ source: draft.source, hasHistoricalImport: await isHistoricalEstimateDraft(db, draft) }, action);
}

/** Guard references persisted before H1, including rows carrying an old approval stamp. */
export async function assertNotHistoricalEstimateReference(
  db: EstimateReader, draftId: string | null | undefined, action: string,
): Promise<void> {
  if (!draftId) return;
  const [draft] = await db.select({ id: estimateDrafts.id, source: estimateDrafts.source })
    .from(estimateDrafts).where(eq(estimateDrafts.id, draftId)).limit(1);
  if (draft) await assertNotHistoricalEstimateDraft(db, draft, action);
}

/** NULL source is valid legacy calculated data; SQL inequality would silently drop it. */
export function nonHistoricalEstimateCondition() {
  return sql`${estimateDrafts.source} IS DISTINCT FROM ${HISTORICAL_ESTIMATE_SOURCE}
    AND NOT EXISTS (SELECT 1 FROM ${historicalEstimateImports}
      WHERE ${historicalEstimateImports.estimateDraftId} = ${estimateDrafts.id})`;
}
