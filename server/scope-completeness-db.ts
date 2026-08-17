/**
 * structr.ai — PHASE 4 Scope Completeness Persistence
 *
 * Contract: docs/phase4-contract.md §4 (SC4-001 … SC4-003)
 *
 * Scores the approved scope against what was actually executed, and promotes repeated omissions
 * into a reusable pre-estimate checklist. Scoring logic lives in
 * `shared/scope-completeness-engine.ts`.
 *
 * Invariants enforced here:
 *   SC4-001  a score requires an approved estimate and at least one committed actual
 *   SC4-002  score → verdict is derived, never hand-set
 *   SC4-003  a pattern needs ≥2 occurrences AND ≥40% frequency within the project type
 *
 * The checklist is the actual product of this module. A score tells an owner the estimate was
 * 82% complete; the checklist tells the estimator "on a bathroom remodel you forget the exhaust
 * fan and the tile trim", which is the only version of that information that changes a bid.
 */

import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import {
  projectCostActuals,
  projects,
  scopeChecklistPatterns,
  scopeCompletenessScores,
  type ScopeChecklistPattern,
  type ScopeCompletenessScore,
} from "../drizzle/schema";
import { recordAuditAsync } from "./audit-trail";
import { assertSameTenant, tenantWhere, withTenant } from "./tenant-scope";
import {
  buildScopeChecklist,
  detectScopePatterns,
  scoreScopeCompleteness,
  type ExecutedScopeLine,
  type PlannedScopeLine,
  type ScopeCompletenessResult,
  type ScopePattern,
} from "@shared/scope-completeness-engine";
import { getProjectBudgetEstimate } from "./field-operations-db";
import { getProjectBudgetLines } from "./actuals-db";
import { getCloseoutByProject } from "./closeout-db";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type ScopeCompletenessErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "NO_APPROVED_ESTIMATE"
  | "NO_ACTUALS"
  | "SCORE_NOT_FOUND"
  | "TENANT_MISMATCH";

export class ScopeCompletenessError extends Error {
  public readonly code: ScopeCompletenessErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    code: ScopeCompletenessErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ScopeCompletenessError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// SCORING (SC4-001, SC4-002)
// ══════════════════════════════════════════════════════════════════════

export interface ComputeScopeCompletenessInput {
  tenantId: string;
  projectId: string;
  actorId?: string | null;
  /** Persist the result. Default true; false is used by previews. */
  persist?: boolean;
}

/**
 * Score one project's scope completeness.
 *
 * The planned side comes from the approved baseline estimate only — deliberately *not* including
 * approved change orders. A change order is by definition scope that was not in the original
 * estimate, so folding it into "planned" would score every project as perfect and the whole
 * measurement would report nothing. Change-order-covered cost is instead credited separately by
 * the engine, which distinguishes "we caught it and sold it" from "we ate it".
 */
export async function computeProjectScopeCompleteness(
  input: ComputeScopeCompletenessInput,
): Promise<{ result: ScopeCompletenessResult; scoreId: string | null }> {
  const db = await getDb();
  if (!db) throw new ScopeCompletenessError("DB_UNAVAILABLE", "Database not available.");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new ScopeCompletenessError(
      "PROJECT_NOT_FOUND",
      `Project ${input.projectId} not found.`,
      { projectId: input.projectId },
    );
  }
  if (!assertSameTenant(project.tenantId, input.tenantId)) {
    throw new ScopeCompletenessError(
      "TENANT_MISMATCH",
      "Project belongs to another tenant.",
      { projectId: input.projectId },
    );
  }

  const budget = await getProjectBudgetEstimate(input.projectId);
  if (!budget) {
    throw new ScopeCompletenessError(
      "NO_APPROVED_ESTIMATE",
      "Scope completeness compares approved scope against execution. Without an approved estimate there is no scope to compare.",
      { projectId: input.projectId },
    );
  }

  // Planned: baseline budget lines only (see the note above about change orders).
  const allBudgetLines = await getProjectBudgetLines(input.projectId);
  const planned: PlannedScopeLine[] = allBudgetLines
    .filter(line => !line.fromChangeOrder)
    .map(line => ({
      costCode: line.costCode,
      costCodeId: line.costCodeId ?? null,
      costCodeName: line.costCodeName ?? null,
      estimatedCents: line.estimatedCents,
    }));

  // Executed: committed cost, aggregated per cost code, flagged when a change order authorized it.
  const actualRows = await db
    .select({
      costCode: projectCostActuals.costCode,
      costCodeId: projectCostActuals.costCodeId,
      costCodeName: projectCostActuals.costCodeName,
      amountCents: projectCostActuals.amountCents,
      changeOrderId: projectCostActuals.changeOrderId,
      status: projectCostActuals.status,
    })
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.projectId, input.projectId),
        inArray(projectCostActuals.status, ["committed", "paid"]),
        isNull(projectCostActuals.deletedAt),
      ),
    );

  if (actualRows.length === 0) {
    throw new ScopeCompletenessError(
      "NO_ACTUALS",
      "No committed cost on this project yet, so there is nothing to compare the scope against.",
      { projectId: input.projectId },
    );
  }

  const executed: ExecutedScopeLine[] = actualRows.map(row => ({
    costCode: row.costCode ?? "UNCODED",
    costCodeId: row.costCodeId ?? null,
    costCodeName: row.costCodeName ?? null,
    actualCents: Math.round(Number(row.amountCents ?? 0)),
    fromChangeOrder: !!row.changeOrderId,
  }));

  const result = scoreScopeCompleteness({
    projectId: input.projectId,
    projectType: project.projectType ?? null,
    commercialChannel: project.commercialChannel ?? null,
    planned,
    executed,
  });

  if (input.persist === false) {
    return { result, scoreId: null };
  }

  const closeout = await getCloseoutByProject(input.projectId);
  const computedAt = new Date();

  const values = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    closeoutId: closeout?.id ?? null,
    budgetEstimateDraftId: budget.id,
    projectType: result.projectType,
    commercialChannel: result.commercialChannel,
    score: String(result.score),
    verdict: result.verdict,
    plannedItemCount: result.plannedItemCount,
    executedItemCount: result.executedItemCount,
    matchedItemCount: result.matchedItemCount,
    missingItemCount: result.missingItemCount,
    unplannedItemCount: result.unplannedItemCount,
    unplannedCostCents: result.unplannedCostCents,
    unexecutedCostCents: result.unexecutedCostCents,
    missingItems: result.missingItems as never,
    unexecutedItems: result.unexecutedItems as never,
    changeOrderCoveredCount: result.changeOrderCoveredCount,
    summary: result.summary,
    computedBy: input.actorId ?? null,
    computedAt,
    updatedAt: computedAt,
  };

  // One score per project (SC4-001): recomputation replaces, never accumulates.
  const [existing] = await db
    .select({ id: scopeCompletenessScores.id })
    .from(scopeCompletenessScores)
    .where(eq(scopeCompletenessScores.projectId, input.projectId))
    .limit(1);

  let scoreId: string | null;
  if (existing) {
    const [updated] = await db
      .update(scopeCompletenessScores)
      .set(values as never)
      .where(eq(scopeCompletenessScores.id, existing.id))
      .returning({ id: scopeCompletenessScores.id });
    scoreId = updated?.id ?? existing.id;
  } else {
    const [created] = await db
      .insert(scopeCompletenessScores)
      .values(withTenant(values, input.tenantId) as never)
      .returning({ id: scopeCompletenessScores.id });
    scoreId = created?.id ?? null;
  }

  // Denormalize onto the project so the dashboard does not need a join.
  await db
    .update(projects)
    .set({ scopeCompletenessScore: String(result.score), updatedAt: computedAt })
    .where(eq(projects.id, input.projectId));

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId ?? null,
    entityType: "scope_completeness",
    entityId: scoreId,
    action: "scope_completeness.scored",
    projectId: input.projectId,
    before: null,
    after: { score: result.score, verdict: result.verdict },
    amountCents: result.unplannedCostCents,
    reason: result.summary,
  });

  return { result, scoreId };
}

// ══════════════════════════════════════════════════════════════════════
// PATTERNS (SC4-003)
// ══════════════════════════════════════════════════════════════════════

/**
 * Recompute recurring scope gaps for a tenant and persist the checklist.
 *
 * Runs across every scored project rather than incrementally, because frequency is a ratio: one
 * new clean bathroom remodel should be able to *demote* a pattern, and an incremental counter
 * that only ever increments would keep stale items on the checklist forever.
 */
export async function refreshScopePatterns(input: {
  tenantId: string;
  projectType?: string | null;
  actorId?: string | null;
}): Promise<{ patterns: ScopePattern[]; recurringCount: number }> {
  const db = await getDb();
  if (!db) throw new ScopeCompletenessError("DB_UNAVAILABLE", "Database not available.");

  const conditions: Array<SQL | undefined> = [isNull(scopeCompletenessScores.deletedAt)];
  if (input.projectType) {
    conditions.push(eq(scopeCompletenessScores.projectType, input.projectType));
  }

  const scores = await db
    .select()
    .from(scopeCompletenessScores)
    .where(tenantWhere(scopeCompletenessScores, input.tenantId, ...conditions))
    .limit(2000);

  const patternInput = scores.map(row => ({
    projectId: row.projectId,
    projectType: row.projectType ?? "unknown",
    missingItems: ((row.missingItems ?? []) as Array<{
      costCode: string;
      costCodeId?: string | null;
      costCodeName?: string | null;
      trade?: string | null;
      actualCents: number;
    }>).map(item => ({
      costCode: item.costCode,
      costCodeId: item.costCodeId ?? null,
      costCodeName: item.costCodeName ?? null,
      trade: item.trade ?? null,
      actualCents: Math.round(Number(item.actualCents ?? 0)),
    })),
  }));

  const patterns = detectScopePatterns(patternInput);
  const now = new Date();

  for (const pattern of patterns) {
    const values = {
      tenantId: input.tenantId,
      projectType: pattern.projectType,
      costCodeId: pattern.costCodeId,
      costCode: pattern.costCode,
      costCodeName: pattern.costCodeName,
      trade: pattern.trade,
      occurrenceCount: pattern.occurrenceCount,
      projectCount: pattern.projectCount,
      frequency: String(pattern.frequency),
      avgUnplannedCents: pattern.avgUnplannedCents,
      totalUnplannedCents: pattern.totalUnplannedCents,
      confidenceScore: String(pattern.confidence.score),
      confidenceBand: pattern.confidence.band,
      isRecurring: pattern.isRecurring,
      suggestion: pattern.suggestion,
      evidence: pattern.evidence as never,
      lastSeenAt: now,
      updatedAt: now,
    };

    const [existing] = await db
      .select({ id: scopeChecklistPatterns.id })
      .from(scopeChecklistPatterns)
      .where(
        and(
          eq(scopeChecklistPatterns.tenantId, input.tenantId),
          eq(scopeChecklistPatterns.projectType, pattern.projectType),
          eq(scopeChecklistPatterns.costCode, pattern.costCode),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(scopeChecklistPatterns)
        .set(values as never)
        .where(eq(scopeChecklistPatterns.id, existing.id));
    } else {
      await db
        .insert(scopeChecklistPatterns)
        .values(withTenant(values, input.tenantId) as never);
    }
  }

  const recurringCount = patterns.filter(p => p.isRecurring).length;

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId ?? null,
    entityType: "scope_pattern",
    entityKey: input.projectType ?? "all",
    action: "scope_pattern.detected",
    before: null,
    after: { patternCount: patterns.length, recurringCount },
    reason: `Scope pattern refresh across ${scores.length} scored project(s).`,
  });

  return { patterns, recurringCount };
}

/** The pre-estimate checklist for a project type — what to ask before quoting. */
export async function getScopeChecklist(input: {
  tenantId: string;
  projectType: string;
}): Promise<{
  projectType: string;
  items: ScopeChecklistPattern[];
  summary: string;
}> {
  const db = await getDb();
  if (!db) {
    return { projectType: input.projectType, items: [], summary: "Database not available." };
  }

  const items = await db
    .select()
    .from(scopeChecklistPatterns)
    .where(
      tenantWhere(
        scopeChecklistPatterns,
        input.tenantId,
        eq(scopeChecklistPatterns.projectType, input.projectType.trim().toLowerCase()),
        eq(scopeChecklistPatterns.isRecurring, true),
        isNull(scopeChecklistPatterns.deletedAt),
      ),
    )
    .orderBy(desc(scopeChecklistPatterns.totalUnplannedCents))
    .limit(100);

  const exposure = items.reduce((sum, i) => sum + Number(i.avgUnplannedCents ?? 0), 0);

  return {
    projectType: input.projectType,
    items,
    summary: items.length
      ? `${items.length} item(s) are routinely missed on ${input.projectType} jobs, worth roughly $${(exposure / 100).toFixed(2)} per job if forgotten again.`
      : `No recurring scope gap recorded for ${input.projectType} jobs yet.`,
  };
}

/** Acknowledge a pattern so it stops being surfaced as new. */
export async function acknowledgePattern(input: {
  patternId: string;
  actorId: string;
  tenantId?: string | null;
}): Promise<ScopeChecklistPattern> {
  const db = await getDb();
  if (!db) throw new ScopeCompletenessError("DB_UNAVAILABLE", "Database not available.");

  const [pattern] = await db
    .select()
    .from(scopeChecklistPatterns)
    .where(eq(scopeChecklistPatterns.id, input.patternId))
    .limit(1);

  if (!pattern) {
    throw new ScopeCompletenessError(
      "SCORE_NOT_FOUND",
      `Scope pattern ${input.patternId} not found.`,
      { patternId: input.patternId },
    );
  }
  if (!assertSameTenant(pattern.tenantId, input.tenantId)) {
    throw new ScopeCompletenessError(
      "TENANT_MISMATCH",
      "Scope pattern belongs to another tenant.",
      { patternId: input.patternId },
    );
  }

  const [updated] = await db
    .update(scopeChecklistPatterns)
    .set({
      acknowledgedBy: input.actorId,
      acknowledgedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scopeChecklistPatterns.id, input.patternId))
    .returning();

  recordAuditAsync({
    tenantId: pattern.tenantId,
    userId: input.actorId,
    entityType: "scope_pattern",
    entityId: updated.id,
    entityKey: `${pattern.projectType}:${pattern.costCode}`,
    action: "scope_pattern.acknowledged",
    before: pattern,
    after: updated,
  });

  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// QUERIES
// ══════════════════════════════════════════════════════════════════════

export async function getScopeCompleteness(
  projectId: string,
): Promise<ScopeCompletenessScore | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(scopeCompletenessScores)
    .where(eq(scopeCompletenessScores.projectId, projectId))
    .limit(1);

  return row ?? null;
}

export async function getScopeCompletenessById(
  id: string,
): Promise<ScopeCompletenessScore | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(scopeCompletenessScores)
    .where(eq(scopeCompletenessScores.id, id))
    .limit(1);

  return row ?? null;
}

export async function listScopeCompleteness(options: {
  tenantId?: string | null;
  projectType?: string;
  verdict?: string;
  limit?: number;
  offset?: number;
}): Promise<{ scores: ScopeCompletenessScore[]; total: number }> {
  const db = await getDb();
  if (!db) return { scores: [], total: 0 };

  const conditions: Array<SQL | undefined> = [isNull(scopeCompletenessScores.deletedAt)];
  if (options.projectType) {
    conditions.push(eq(scopeCompletenessScores.projectType, options.projectType));
  }
  if (options.verdict) conditions.push(eq(scopeCompletenessScores.verdict, options.verdict));

  const where = tenantWhere(scopeCompletenessScores, options.tenantId, ...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(scopeCompletenessScores)
    .where(where);

  const scores = await db
    .select()
    .from(scopeCompletenessScores)
    .where(where)
    .orderBy(scopeCompletenessScores.score)
    .limit(Math.min(options.limit ?? 50, 500))
    .offset(options.offset ?? 0);

  return { scores, total: countRow?.count ?? 0 };
}

export interface ScopeCompletenessSummary {
  projectCount: number;
  avgScore: number | null;
  medianScore: number | null;
  byVerdict: Array<{ verdict: string; count: number }>;
  totalUnplannedCostCents: number;
  recurringPatternCount: number;
  worstProjects: Array<{ projectId: string; score: number; verdict: string }>;
}

export async function getScopeCompletenessSummary(
  tenantId: string,
): Promise<ScopeCompletenessSummary> {
  const db = await getDb();
  if (!db) {
    return {
      projectCount: 0,
      avgScore: null,
      medianScore: null,
      byVerdict: [],
      totalUnplannedCostCents: 0,
      recurringPatternCount: 0,
      worstProjects: [],
    };
  }

  const base = tenantWhere(
    scopeCompletenessScores,
    tenantId,
    isNull(scopeCompletenessScores.deletedAt),
  );

  const rows = await db
    .select({
      projectId: scopeCompletenessScores.projectId,
      score: scopeCompletenessScores.score,
      verdict: scopeCompletenessScores.verdict,
      unplannedCostCents: scopeCompletenessScores.unplannedCostCents,
    })
    .from(scopeCompletenessScores)
    .where(base)
    .limit(2000);

  const scores = rows
    .map(r => Number(r.score))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

  const byVerdictMap = new Map<string, number>();
  let totalUnplannedCostCents = 0;
  for (const r of rows) {
    byVerdictMap.set(r.verdict, (byVerdictMap.get(r.verdict) ?? 0) + 1);
    totalUnplannedCostCents += Math.round(Number(r.unplannedCostCents ?? 0));
  }

  const [patternRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(scopeChecklistPatterns)
    .where(
      tenantWhere(
        scopeChecklistPatterns,
        tenantId,
        eq(scopeChecklistPatterns.isRecurring, true),
        isNull(scopeChecklistPatterns.deletedAt),
      ),
    );

  return {
    projectCount: rows.length,
    avgScore: scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null,
    medianScore: scores.length
      ? scores.length % 2 === 0
        ? Math.round(((scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) * 10) / 10
        : scores[Math.floor(scores.length / 2)]
      : null,
    byVerdict: Array.from(byVerdictMap.entries()).map(([verdict, count]) => ({
      verdict,
      count,
    })),
    totalUnplannedCostCents,
    recurringPatternCount: patternRow?.count ?? 0,
    worstProjects: rows
      .map(r => ({
        projectId: r.projectId,
        score: Number(r.score),
        verdict: r.verdict,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5),
  };
}

/** Build a checklist from in-memory patterns; used by tests and previews. */
export function checklistFromPatterns(
  patterns: readonly ScopePattern[],
  projectType: string,
): ReturnType<typeof buildScopeChecklist> {
  return buildScopeChecklist(patterns, projectType);
}
