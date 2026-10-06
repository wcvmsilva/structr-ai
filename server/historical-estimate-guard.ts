import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { estimateDrafts, historicalEstimateImports } from "../drizzle/schema";
import { HISTORICAL_ESTIMATE_SOURCE } from "@shared/domain/taxonomy";
import { assertHistoricalCaptureOnly } from "@shared/historical-estimate-engine";

type EstimateReader = Pick<PostgresJsDatabase, "select">;
type DraftIdentity = { id: string; source?: string | null };

/** The immutable relation remains authoritative if a legacy source label changes. */
export async function getHistoricalImportId(
  db: EstimateReader,
  draftId: string
): Promise<string | null> {
  const [entry] = await db
    .select({ id: historicalEstimateImports.id })
    .from(historicalEstimateImports)
    .where(eq(historicalEstimateImports.estimateDraftId, draftId))
    .limit(1);
  return entry?.id ?? null;
}

export async function isHistoricalEstimateDraft(
  db: EstimateReader,
  draft: DraftIdentity
): Promise<boolean> {
  return (
    draft.source === HISTORICAL_ESTIMATE_SOURCE ||
    (await getHistoricalImportId(db, draft.id)) !== null
  );
}

export async function assertNotHistoricalEstimateDraft(
  db: EstimateReader,
  draft: DraftIdentity,
  action = "legacy estimate operation"
): Promise<void> {
  assertHistoricalCaptureOnly(
    {
      source: draft.source,
      hasHistoricalImport: await isHistoricalEstimateDraft(db, draft),
    },
    action
  );
}

/** Guard references persisted before H1, including rows carrying an old approval stamp. */
export async function assertNotHistoricalEstimateReference(
  db: EstimateReader,
  draftId: string | null | undefined,
  action: string
): Promise<void> {
  if (!draftId) return;
  const [draft] = await db
    .select({ id: estimateDrafts.id, source: estimateDrafts.source })
    .from(estimateDrafts)
    .where(eq(estimateDrafts.id, draftId))
    .limit(1);
  if (draft) await assertNotHistoricalEstimateDraft(db, draft, action);
}

/** NULL source is valid legacy calculated data; SQL inequality would silently drop it. */
export function nonHistoricalEstimateCondition() {
  return sql`${estimateDrafts.source} IS DISTINCT FROM ${HISTORICAL_ESTIMATE_SOURCE}
    AND NOT EXISTS (SELECT 1 FROM ${historicalEstimateImports}
      WHERE ${historicalEstimateImports.estimateDraftId} = ${estimateDrafts.id})`;
}

/**
 * A1 retained writes must not mutate historical descendants or disclose a foreign
 * draft's classification. The caller supplies its already-authorized project and
 * tenant and a domain-specific fail-closed error. Existing helpers stay unchanged.
 */
export async function assertScopedCalculatedEstimateLineage(
  db: EstimateReader,
  draftId: string | null | undefined,
  context: {
    projectId: string;
    tenantId: string;
    action: string;
    invalid: (message: string) => never;
  }
): Promise<void> {
  if (!context.projectId || !context.tenantId)
    context.invalid("Estimate scope is unresolved.");
  if (!draftId) return;
  const maxNodes = 128;
  const active = new Set<string>();
  const verified = new Set<string>();
  const pending: Array<{ id: string; exiting: boolean }> = [
    { id: draftId, exiting: false },
  ];
  let inspected = 0;
  while (pending.length) {
    const frame = pending.pop()!;
    if (frame.exiting) {
      active.delete(frame.id);
      verified.add(frame.id);
      continue;
    }
    if (active.has(frame.id))
      context.invalid("Estimate ancestry contains a cycle.");
    if (verified.has(frame.id)) continue;
    if (inspected >= maxNodes)
      context.invalid("Estimate ancestry exceeds the inspection limit.");
    inspected++;
    const [draft] = await db
      .select()
      .from(estimateDrafts)
      .where(eq(estimateDrafts.id, frame.id))
      .limit(1)
      .for("share");
    if (
      !draft ||
      draft.projectId !== context.projectId ||
      draft.tenantId !== context.tenantId
    ) {
      context.invalid("Estimate ancestry is unavailable for this project.");
    }
    await assertNotHistoricalEstimateDraft(db, draft, context.action);
    active.add(draft.id);
    pending.push({ id: draft.id, exiting: true });
    for (const id of new Set([draft.changeOrderOf, draft.supersedesId])) {
      if (id) pending.push({ id, exiting: false });
    }
  }
}
