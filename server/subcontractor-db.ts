/**
 * structr.ai — PHASE 3 Subcontractor Persistence
 *
 * Persists the trade-partner registry of docs/phase3-contract.md §5. Compliance and
 * performance judgment live in shared/subcontractor-performance-engine.ts; this module
 * stores, recomputes, reads and audits.
 *
 * Invariants enforced here:
 *   SC-001  compliance state is derived from the documents on file, never typed
 *   SC-002  an expired-insurance company cannot receive new work
 *   SC-003  on-time / quality / cost metrics are derived from tasks and actuals
 */

import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import {
  fieldTasks,
  projectCostActuals,
  subcontractors,
  type FieldTask,
  type Subcontractor,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import {
  assessCompliance,
  computePerformanceMetrics,
  evaluateAssignmentEligibility,
  type ComplianceAssessment,
  type EligibilityResult,
  type PerformanceMetrics,
} from "@shared/subcontractor-performance-engine";
import {
  DEFAULT_COMPLIANCE_WARNING_DAYS,
  normalizeSubcontractorStatus,
  type SubcontractorStatus,
} from "@shared/domain/phase3-taxonomy";
import { normalizeTrade } from "@shared/domain/normalization";
import { tenantFilter, withTenant } from "./tenant-scope";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type SubcontractorErrorCode =
  | "DB_UNAVAILABLE"
  | "SUBCONTRACTOR_NOT_FOUND"
  | "DUPLICATE_SUBCONTRACTOR"
  | "INVALID_TRADE"
  | "INVALID_STATUS"
  | "SUBCONTRACTOR_NOT_ELIGIBLE";

export class SubcontractorError extends Error {
  public readonly code: SubcontractorErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    code: SubcontractorErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SubcontractorError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Canonical key that prevents "ABC Framing" and "abc  framing" from coexisting. */
export function normalizeSubcontractorName(name: string): string {
  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function todayIso(explicit?: string): string {
  return explicit ?? new Date().toISOString().slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════
// CREATE / UPDATE
// ══════════════════════════════════════════════════════════════════════

export interface CreateSubcontractorInput {
  userId: string;
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  name: string;
  trade: string;
  companyType?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  licenseNumber?: string | null;
  licenseExpiry?: string | null;
  insuranceCarrier?: string | null;
  insurancePolicyNumber?: string | null;
  insuranceExpiry?: string | null;
  insuranceCoverageCents?: number | null;
  workersCompExpiry?: string | null;
  w9OnFile?: boolean;
  rating?: number | null;
  status?: string | null;
  notes?: string | null;
  today?: string;
}

/** Register a trade partner. Compliance state is computed, not accepted from the caller. */
export async function createSubcontractor(
  input: CreateSubcontractorInput,
): Promise<Subcontractor> {
  const db = await getDb();
  if (!db) throw new SubcontractorError("DB_UNAVAILABLE", "Database not available");

  const trade = normalizeTrade(input.trade);
  if (!trade) {
    throw new SubcontractorError(
      "INVALID_TRADE",
      `"${input.trade}" is not a known trade. Use the canonical trade vocabulary.`,
      { trade: input.trade },
    );
  }

  const status = input.status ? normalizeSubcontractorStatus(input.status) : "active";
  if (!status) {
    throw new SubcontractorError("INVALID_STATUS", `"${input.status}" is not a valid status.`);
  }

  const nameNormalized = normalizeSubcontractorName(input.name);

  const existing = await db
    .select({ id: subcontractors.id, name: subcontractors.name })
    .from(subcontractors)
    .where(
      and(
        eq(subcontractors.nameNormalized, nameNormalized),
        eq(subcontractors.trade, trade),
        isNull(subcontractors.deletedAt),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new SubcontractorError(
      "DUPLICATE_SUBCONTRACTOR",
      `"${input.name}" already exists for the ${trade} trade. Update the existing record instead of creating a parallel one.`,
      { existingId: existing[0].id },
    );
  }

  const compliance = assessCompliance({
    licenseNumber: input.licenseNumber,
    licenseExpiry: input.licenseExpiry,
    insuranceCarrier: input.insuranceCarrier,
    insuranceExpiry: input.insuranceExpiry,
    insuranceCoverageCents: input.insuranceCoverageCents,
    today: todayIso(input.today),
  });

  const id = randomUUID();
  const now = new Date();

  const values = withTenant(
    {
      id,
      name: input.name.trim(),
      nameNormalized,
      trade,
      companyType: input.companyType ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      state: input.state ?? "SC",
      zip: input.zip ?? null,
      licenseNumber: input.licenseNumber ?? null,
      licenseExpiry: input.licenseExpiry ?? null,
      insuranceCarrier: input.insuranceCarrier ?? null,
      insurancePolicyNumber: input.insurancePolicyNumber ?? null,
      insuranceExpiry: input.insuranceExpiry ?? null,
      insuranceCoverageCents: input.insuranceCoverageCents ?? null,
      workersCompExpiry: input.workersCompExpiry ?? null,
      w9OnFile: input.w9OnFile ?? false,
      complianceState: compliance.overall,
      rating: input.rating != null ? String(input.rating) : null,
      status,
      notes: input.notes ?? null,
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    },
    input.tenantId ?? null,
  );

  await db.insert(subcontractors).values(values as never);

  await logAudit({
    userId: input.userId,
    action: "subcontractor.created",
    tableName: "subcontractors",
    recordId: id,
    before: null,
    after: { name: input.name, trade, status, complianceState: compliance.overall },
  }).catch(() => undefined);

  const created = await getSubcontractor(id);
  if (!created) {
    throw new SubcontractorError("SUBCONTRACTOR_NOT_FOUND", `Subcontractor ${id} could not be read back`);
  }
  return created;
}

export interface UpdateSubcontractorInput {
  subcontractorId: string;
  userId: string;
  name?: string;
  trade?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  licenseNumber?: string | null;
  licenseExpiry?: string | null;
  insuranceCarrier?: string | null;
  insurancePolicyNumber?: string | null;
  insuranceExpiry?: string | null;
  insuranceCoverageCents?: number | null;
  workersCompExpiry?: string | null;
  w9OnFile?: boolean;
  rating?: number | null;
  status?: string | null;
  notes?: string | null;
  today?: string;
}

/** Update a trade partner and recompute its compliance state. */
export async function updateSubcontractor(
  input: UpdateSubcontractorInput,
): Promise<Subcontractor> {
  const db = await getDb();
  if (!db) throw new SubcontractorError("DB_UNAVAILABLE", "Database not available");

  const before = await getSubcontractor(input.subcontractorId);
  if (!before) {
    throw new SubcontractorError(
      "SUBCONTRACTOR_NOT_FOUND",
      `Subcontractor ${input.subcontractorId} not found`,
    );
  }

  const patch: Record<string, unknown> = { updatedBy: input.userId, updatedAt: new Date() };

  if (input.name !== undefined) {
    patch.name = input.name.trim();
    patch.nameNormalized = normalizeSubcontractorName(input.name);
  }
  if (input.trade !== undefined) {
    const trade = normalizeTrade(input.trade);
    if (!trade) {
      throw new SubcontractorError("INVALID_TRADE", `"${input.trade}" is not a known trade.`);
    }
    patch.trade = trade;
  }
  if (input.status !== undefined && input.status !== null) {
    const status = normalizeSubcontractorStatus(input.status);
    if (!status) {
      throw new SubcontractorError("INVALID_STATUS", `"${input.status}" is not a valid status.`);
    }
    patch.status = status;
  }

  const simpleFields: Array<keyof UpdateSubcontractorInput> = [
    "contactName",
    "contactEmail",
    "contactPhone",
    "address",
    "city",
    "state",
    "zip",
    "licenseNumber",
    "licenseExpiry",
    "insuranceCarrier",
    "insurancePolicyNumber",
    "insuranceExpiry",
    "insuranceCoverageCents",
    "workersCompExpiry",
    "w9OnFile",
    "notes",
  ];
  for (const field of simpleFields) {
    if (input[field] !== undefined) patch[field] = input[field] as never;
  }
  if (input.rating !== undefined) {
    patch.rating = input.rating != null ? String(input.rating) : null;
  }

  // Recompute compliance from the merged document set.
  const compliance = assessCompliance({
    licenseNumber: (patch.licenseNumber as string | null) ?? before.licenseNumber,
    licenseExpiry: (patch.licenseExpiry as string | null) ?? before.licenseExpiry,
    insuranceCarrier: (patch.insuranceCarrier as string | null) ?? before.insuranceCarrier,
    insuranceExpiry: (patch.insuranceExpiry as string | null) ?? before.insuranceExpiry,
    insuranceCoverageCents:
      (patch.insuranceCoverageCents as number | null) ?? before.insuranceCoverageCents,
    today: todayIso(input.today),
  });
  patch.complianceState = compliance.overall;

  await db
    .update(subcontractors)
    .set(patch as never)
    .where(eq(subcontractors.id, input.subcontractorId));

  await logAudit({
    userId: input.userId,
    action: "subcontractor.updated",
    tableName: "subcontractors",
    recordId: input.subcontractorId,
    before,
    after: patch,
  }).catch(() => undefined);

  const after = await getSubcontractor(input.subcontractorId);
  return after ?? before;
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Load one trade partner. */
export async function getSubcontractor(id: string): Promise<Subcontractor | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(subcontractors)
    .where(eq(subcontractors.id, id))
    .limit(1);

  return row ?? null;
}

export interface ListSubcontractorsOptions {
  /** Caller tenant. Non-nullable (B2): the router rejects an unresolved tenant. */
  tenantId: string;
  trade?: string;
  status?: SubcontractorStatus | SubcontractorStatus[];
  complianceState?: string;
  limit?: number;
  offset?: number;
}

/** List trade partners of the caller's tenant. */
export async function listSubcontractors(
  opts: ListSubcontractorsOptions,
): Promise<{ subcontractors: Subcontractor[]; total: number }> {
  const db = await getDb();
  if (!db) return { subcontractors: [], total: 0 };

  const conditions = [isNull(subcontractors.deletedAt)];

  const tenantCondition = tenantFilter(subcontractors, opts.tenantId);
  if (tenantCondition) conditions.push(tenantCondition);

  if (opts.trade) {
    const trade = normalizeTrade(opts.trade);
    if (trade) conditions.push(eq(subcontractors.trade, trade));
  }
  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    if (statuses.length > 0) conditions.push(inArray(subcontractors.status, statuses));
  }
  if (opts.complianceState) {
    conditions.push(eq(subcontractors.complianceState, opts.complianceState));
  }

  const rows = await db
    .select()
    .from(subcontractors)
    .where(and(...conditions))
    .orderBy(asc(subcontractors.trade), asc(subcontractors.name))
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);

  return { subcontractors: rows, total: rows.length };
}

// ══════════════════════════════════════════════════════════════════════
// COMPLIANCE (SC-001, SC-002)
// ══════════════════════════════════════════════════════════════════════

export interface SubcontractorCompliance {
  subcontractorId: string;
  name: string;
  trade: string;
  status: SubcontractorStatus;
  compliance: ComplianceAssessment;
  eligibility: EligibilityResult;
}

/** Assess compliance and assignment eligibility of one trade partner. */
export async function getSubcontractorCompliance(
  subcontractorId: string,
  options: { today?: string; strict?: boolean; requiredCoverageCents?: number | null } = {},
): Promise<SubcontractorCompliance> {
  const sub = await getSubcontractor(subcontractorId);
  if (!sub) {
    throw new SubcontractorError(
      "SUBCONTRACTOR_NOT_FOUND",
      `Subcontractor ${subcontractorId} not found`,
    );
  }

  const compliance = assessCompliance({
    licenseNumber: sub.licenseNumber,
    licenseExpiry: sub.licenseExpiry,
    insuranceCarrier: sub.insuranceCarrier,
    insuranceExpiry: sub.insuranceExpiry,
    insuranceCoverageCents: sub.insuranceCoverageCents,
    requiredCoverageCents: options.requiredCoverageCents ?? null,
    today: todayIso(options.today),
  });

  const status = (normalizeSubcontractorStatus(sub.status) ?? "active") as SubcontractorStatus;
  const eligibility = evaluateAssignmentEligibility({
    status,
    compliance,
    strict: options.strict ?? String(process.env.SUBCONTRACTOR_STRICT ?? "").toLowerCase() === "true",
  });

  return {
    subcontractorId: sub.id,
    name: sub.name,
    trade: sub.trade,
    status,
    compliance,
    eligibility,
  };
}

export interface ComplianceAlert {
  subcontractorId: string;
  name: string;
  trade: string;
  document: "license" | "insurance" | "workers_comp";
  expiry: string | null;
  daysUntilExpiry: number | null;
  state: string;
  message: string;
}

/**
 * List documents expiring within `withinDays` (default 30) or already expired.
 *
 * This is the operational alert the field needs before scheduling, not a report: an expired
 * certificate discovered on the morning of the pour is a stopped job.
 */
export async function listComplianceAlerts(
  opts: { tenantId: string; withinDays?: number; today?: string },
): Promise<ComplianceAlert[]> {
  const db = await getDb();
  if (!db) return [];

  const withinDays = opts.withinDays ?? DEFAULT_COMPLIANCE_WARNING_DAYS;
  const today = todayIso(opts.today);
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + withinDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const conditions = [
    isNull(subcontractors.deletedAt),
    inArray(subcontractors.status, ["active", "probation"]),
    or(
      lte(subcontractors.licenseExpiry, cutoffIso),
      lte(subcontractors.insuranceExpiry, cutoffIso),
      lte(subcontractors.workersCompExpiry, cutoffIso),
    ),
  ];

  const tenantCondition = tenantFilter(subcontractors, opts.tenantId);
  if (tenantCondition) conditions.push(tenantCondition);

  const rows = await db
    .select()
    .from(subcontractors)
    .where(and(...conditions))
    .orderBy(asc(subcontractors.insuranceExpiry));

  const alerts: ComplianceAlert[] = [];

  for (const sub of rows) {
    const assessment = assessCompliance({
      licenseNumber: sub.licenseNumber,
      licenseExpiry: sub.licenseExpiry,
      insuranceCarrier: sub.insuranceCarrier,
      insuranceExpiry: sub.insuranceExpiry,
      insuranceCoverageCents: sub.insuranceCoverageCents,
      warningDays: withinDays,
      today,
    });

    for (const doc of [assessment.license, assessment.insurance]) {
      if (doc.state === "compliant") continue;
      alerts.push({
        subcontractorId: sub.id,
        name: sub.name,
        trade: sub.trade,
        document: doc.kind,
        expiry: doc.expiry,
        daysUntilExpiry: doc.daysUntilExpiry,
        state: doc.state,
        message: `${sub.name} (${sub.trade}): ${doc.message}`,
      });
    }

    if (sub.workersCompExpiry && sub.workersCompExpiry <= cutoffIso) {
      const days = Math.round(
        (new Date(`${sub.workersCompExpiry}T00:00:00Z`).getTime() -
          new Date(`${today}T00:00:00Z`).getTime()) /
          86_400_000,
      );
      alerts.push({
        subcontractorId: sub.id,
        name: sub.name,
        trade: sub.trade,
        document: "workers_comp",
        expiry: sub.workersCompExpiry,
        daysUntilExpiry: days,
        state: days < 0 ? "expired" : "expiring",
        message: `${sub.name} (${sub.trade}): workers' comp ${days < 0 ? `expired ${Math.abs(days)} day(s) ago` : `expires in ${days} day(s)`}.`,
      });
    }
  }

  // Expired first, then closest to expiry.
  alerts.sort((a, b) => {
    if (a.state !== b.state) return a.state === "expired" ? -1 : 1;
    return (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999);
  });

  return alerts;
}

// ══════════════════════════════════════════════════════════════════════
// PERFORMANCE (SC-003)
// ══════════════════════════════════════════════════════════════════════

/** Field tasks assigned to a trade partner across projects. */
export async function listTasksForSubcontractor(
  subcontractorId: string,
  limit = 1000,
): Promise<FieldTask[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(fieldTasks)
    .where(
      and(eq(fieldTasks.subcontractorId, subcontractorId), isNull(fieldTasks.deletedAt)),
    )
    .orderBy(desc(fieldTasks.createdAt))
    .limit(limit);
}

/**
 * Recompute and persist the derived performance metrics of a trade partner.
 *
 * Persisting the result is deliberate: the field needs the number instantly when choosing
 * who to schedule, and recomputing across every project on each read does not scale.
 */
export async function refreshSubcontractorPerformance(
  subcontractorId: string,
  userId?: string,
): Promise<PerformanceMetrics> {
  const db = await getDb();
  if (!db) throw new SubcontractorError("DB_UNAVAILABLE", "Database not available");

  const sub = await getSubcontractor(subcontractorId);
  if (!sub) {
    throw new SubcontractorError(
      "SUBCONTRACTOR_NOT_FOUND",
      `Subcontractor ${subcontractorId} not found`,
    );
  }

  const tasks = await listTasksForSubcontractor(subcontractorId);
  const actuals = await db
    .select()
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.subcontractorId, subcontractorId),
        isNull(projectCostActuals.deletedAt),
      ),
    );

  const metrics = computePerformanceMetrics(
    tasks.map((t) => ({
      status: t.status,
      plannedEndDate: t.plannedEndDate,
      actualEndDate: t.actualEndDate,
      reworkCount: t.reworkCount,
    })),
    actuals.map((a) => ({
      estimatedAmountCents: a.estimatedAmountCents,
      amountCents: a.amountCents,
      status: a.status,
    })),
  );

  const now = new Date();
  await db
    .update(subcontractors)
    .set({
      onTimePct: metrics.onTimePct != null ? String(metrics.onTimePct) : null,
      qualityScore: metrics.qualityScore != null ? String(metrics.qualityScore) : null,
      costVarianceAvgPct:
        metrics.costVarianceAvgPct != null ? String(metrics.costVarianceAvgPct) : null,
      derivedRating: metrics.derivedRating != null ? String(metrics.derivedRating) : null,
      completedTaskCount: metrics.completedTaskCount,
      committedCostCents: metrics.committedCostCents,
      performanceComputedAt: now,
      updatedBy: userId ?? null,
      updatedAt: now,
    })
    .where(eq(subcontractors.id, subcontractorId));

  await logAudit({
    userId: userId ?? null,
    action: "subcontractor.performance_refreshed",
    tableName: "subcontractors",
    recordId: subcontractorId,
    before: {
      onTimePct: sub.onTimePct,
      qualityScore: sub.qualityScore,
      derivedRating: sub.derivedRating,
    },
    after: metrics,
  }).catch(() => undefined);

  return metrics;
}

/** Read the performance metrics of a trade partner without persisting. */
export async function getSubcontractorPerformance(
  subcontractorId: string,
): Promise<PerformanceMetrics> {
  const db = await getDb();
  if (!db) throw new SubcontractorError("DB_UNAVAILABLE", "Database not available");

  const tasks = await listTasksForSubcontractor(subcontractorId);
  const actuals = await db
    .select()
    .from(projectCostActuals)
    .where(
      and(
        eq(projectCostActuals.subcontractorId, subcontractorId),
        isNull(projectCostActuals.deletedAt),
      ),
    );

  return computePerformanceMetrics(
    tasks.map((t) => ({
      status: t.status,
      plannedEndDate: t.plannedEndDate,
      actualEndDate: t.actualEndDate,
      reworkCount: t.reworkCount,
    })),
    actuals.map((a) => ({
      estimatedAmountCents: a.estimatedAmountCents,
      amountCents: a.amountCents,
      status: a.status,
    })),
  );
}

/** Archive a trade partner. Active assignments must be reassigned first. */
export async function archiveSubcontractor(
  subcontractorId: string,
  userId: string,
): Promise<Subcontractor> {
  const db = await getDb();
  if (!db) throw new SubcontractorError("DB_UNAVAILABLE", "Database not available");

  const before = await getSubcontractor(subcontractorId);
  if (!before) {
    throw new SubcontractorError(
      "SUBCONTRACTOR_NOT_FOUND",
      `Subcontractor ${subcontractorId} not found`,
    );
  }

  const openTasks = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(fieldTasks)
    .where(
      and(
        eq(fieldTasks.subcontractorId, subcontractorId),
        inArray(fieldTasks.status, ["assigned", "in_progress", "blocked"]),
        isNull(fieldTasks.deletedAt),
      ),
    );

  const openCount = Number(openTasks[0]?.count ?? 0);
  if (openCount > 0) {
    throw new SubcontractorError(
      "SUBCONTRACTOR_NOT_ELIGIBLE",
      `${before.name} still has ${openCount} open task(s). Reassign or close them before archiving.`,
      { openCount },
    );
  }

  const now = new Date();
  await db
    .update(subcontractors)
    .set({ status: "archived", updatedBy: userId, updatedAt: now })
    .where(eq(subcontractors.id, subcontractorId));

  await logAudit({
    userId,
    action: "subcontractor.archived",
    tableName: "subcontractors",
    recordId: subcontractorId,
    before: { status: before.status },
    after: { status: "archived" },
  }).catch(() => undefined);

  const after = await getSubcontractor(subcontractorId);
  return after ?? before;
}
