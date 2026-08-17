/**
 * structr.ai — PHASE 2 Pre-Visit Persistence
 *
 * Persists the Pre-Visit Project Brief and the field inspection checklist described in
 * docs/phase2-contract.md §4. All decision logic lives in shared/previsit-engine.ts;
 * this module only stores, transitions and reads.
 *
 * Invariants enforced here:
 *   - a brief always belongs to a canonical project_id (and its tenant)
 *   - a brief never stores a definitive price (engine + DB check constraint)
 *   - checklist items are unique per (brief_id, item_key)
 *   - a brief can only be completed when every required checklist item is resolved
 */

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import {
  previsitBriefs,
  previsitChecklistItems,
  projects,
  scopeDrafts,
  type PrevisitBriefRow,
  type PrevisitChecklistItem,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import {
  assessPrevisitReadiness,
  buildPrevisitBrief,
  validatePrevisitBriefInput,
  type ChecklistItem,
  type PrevisitBrief,
  type PrevisitBriefInput,
  type PrevisitReadiness,
} from "@shared/previsit-engine";
import { normalizeEvidenceClass, PREVISIT_STEPS_ALLOWING_ESTIMATE } from "@shared/domain/phase2-taxonomy";
import { getProjectGeoContext } from "./lead-conversion";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type PrevisitErrorCode =
  | "DB_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "BRIEF_NOT_FOUND"
  | "BRIEF_VALIDATION_FAILED"
  | "BRIEF_NOT_READY"
  | "BRIEF_LOCKED"
  | "CHECKLIST_ITEM_NOT_FOUND";

export class PrevisitError extends Error {
  public readonly code: PrevisitErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: PrevisitErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PrevisitError";
    this.code = code;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface CreateBriefInput extends Omit<PrevisitBriefInput, "geoWarnings"> {
  userId: string;
  /** When omitted, the geo warnings are read from the project's persisted geo context. */
  geoWarnings?: string[];
}

export interface BriefWithChecklist {
  brief: PrevisitBriefRow;
  checklist: PrevisitChecklistItem[];
  readiness: PrevisitReadiness;
  /** True when the recommendation authorizes moving toward an estimate. */
  allowsEstimate: boolean;
}

// ══════════════════════════════════════════════════════════════════════
// CREATE
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a Pre-Visit Project Brief plus its derived checklist, in one transaction.
 *
 * A previous brief for the same project is marked `superseded` rather than deleted:
 * the pre-visit record is evidence of what was known at a point in time.
 */
export async function createPrevisitBrief(
  input: CreateBriefInput,
): Promise<BriefWithChecklist> {
  const db = await getDb();
  if (!db) throw new PrevisitError("DB_UNAVAILABLE", "Database not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new PrevisitError("PROJECT_NOT_FOUND", `Project ${input.projectId} not found`, {
      projectId: input.projectId,
    });
  }

  // Geo warnings feed the coastal checklist seeds; read them from the project when the
  // caller did not provide an explicit set.
  let geoWarnings = input.geoWarnings;
  if (!geoWarnings) {
    const geo = await getProjectGeoContext(input.projectId);
    geoWarnings = geo ? geo.warnings.map((w) => `[${w.code}] ${w.message}`) : [];
  }

  const engineInput: PrevisitBriefInput = {
    tenantId: input.tenantId ?? project.tenantId ?? null,
    projectId: input.projectId,
    intakeFormId: input.intakeFormId ?? null,
    summary: input.summary ?? null,
    items: input.items,
    nextStepCandidates: input.nextStepCandidates,
    nextStepRationale: input.nextStepRationale ?? null,
    geoWarnings,
    preparedBy: input.preparedBy ?? input.userId,
    generatedAt: input.generatedAt,
  };

  const errors = validatePrevisitBriefInput(engineInput);
  if (errors.length > 0) {
    throw new PrevisitError(
      "BRIEF_VALIDATION_FAILED",
      `Pre-visit brief rejected: ${errors.map((e) => `[${e.ruleId}] ${e.message}`).join("; ")}`,
      { errors },
    );
  }

  const brief: PrevisitBrief = buildPrevisitBrief(engineInput);
  const briefId = randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    // Supersede previous active briefs for this project.
    await tx
      .update(previsitBriefs)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(eq(previsitBriefs.projectId, input.projectId), eq(previsitBriefs.status, "draft")),
      );

    await tx.insert(previsitBriefs).values({
      id: briefId,
      tenantId: brief.tenantId,
      projectId: brief.projectId,
      intakeFormId: brief.intakeFormId,
      status: "draft",
      summary: brief.summary,
      evidenceItems: brief.items,
      evidenceSummary: brief.evidenceSummary,
      factCoveragePct: String(brief.evidenceSummary.factCoveragePct),
      unknownCount: brief.evidenceSummary.byClass.UNKNOWN,
      inferenceCount: brief.evidenceSummary.byClass.INFERENCE,
      nextStep: brief.nextStep,
      nextStepRationale: brief.nextStepRationale,
      discardedNextSteps: brief.discardedNextSteps,
      geoWarnings: brief.geoWarnings,
      warnings: brief.warnings,
      emitsDefinitivePrice: false,
      preparedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    });

    if (brief.checklist.length > 0) {
      await tx.insert(previsitChecklistItems).values(
        brief.checklist.map((item: ChecklistItem, index: number) => ({
          id: randomUUID(),
          tenantId: brief.tenantId,
          projectId: brief.projectId,
          briefId,
          itemKey: item.key,
          section: item.section,
          label: item.label,
          reason: item.reason,
          isRequired: item.required,
          sourceKey: item.sourceKey,
          status: "open" as const,
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    // The project leaves "intake" and enters the pre-visit stage.
    await tx
      .update(projects)
      .set({ status: "previsit", updatedBy: input.userId, updatedAt: now })
      .where(eq(projects.id, input.projectId));
  });

  await logAudit({
    userId: input.userId,
    action: "previsit.brief_created",
    tableName: "previsit_briefs",
    recordId: briefId,
    before: null,
    after: {
      projectId: brief.projectId,
      nextStep: brief.nextStep,
      discardedNextSteps: brief.discardedNextSteps,
      evidenceSummary: brief.evidenceSummary,
      checklistItems: brief.checklist.length,
      requiredChecklistItems: brief.checklist.filter((c) => c.required).length,
      emitsDefinitivePrice: false,
      geoWarnings: brief.geoWarnings,
    },
  }).catch(() => undefined);

  const stored = await getBriefWithChecklist(briefId);
  if (!stored) {
    throw new PrevisitError("BRIEF_NOT_FOUND", `Brief ${briefId} could not be read back`);
  }
  return stored;
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

/** Load a brief with its checklist and computed readiness. */
export async function getBriefWithChecklist(
  briefId: string,
): Promise<BriefWithChecklist | null> {
  const db = await getDb();
  if (!db) return null;

  const [brief] = await db
    .select()
    .from(previsitBriefs)
    .where(eq(previsitBriefs.id, briefId))
    .limit(1);

  if (!brief) return null;

  const checklist = await db
    .select()
    .from(previsitChecklistItems)
    .where(eq(previsitChecklistItems.briefId, briefId))
    .orderBy(previsitChecklistItems.sortOrder);

  return {
    brief,
    checklist,
    readiness: computeReadiness(brief, checklist),
    allowsEstimate: (PREVISIT_STEPS_ALLOWING_ESTIMATE as readonly string[]).includes(
      brief.nextStep,
    ),
  };
}

/** Load the most recent active brief for a project. */
export async function getLatestBriefForProject(
  projectId: string,
): Promise<BriefWithChecklist | null> {
  const db = await getDb();
  if (!db) return null;

  const [brief] = await db
    .select()
    .from(previsitBriefs)
    .where(eq(previsitBriefs.projectId, projectId))
    .orderBy(desc(previsitBriefs.createdAt))
    .limit(1);

  if (!brief) return null;
  return getBriefWithChecklist(brief.id);
}

/** List briefs for a project, newest first. */
export async function listBriefsForProject(projectId: string): Promise<PrevisitBriefRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(previsitBriefs)
    .where(eq(previsitBriefs.projectId, projectId))
    .orderBy(desc(previsitBriefs.createdAt));
}

// ══════════════════════════════════════════════════════════════════════
// READINESS
// ══════════════════════════════════════════════════════════════════════

/** Compute readiness from the persisted rows (no engine re-derivation of the brief). */
export function computeReadiness(
  brief: PrevisitBriefRow,
  checklist: PrevisitChecklistItem[],
): PrevisitReadiness {
  const engineChecklist: ChecklistItem[] = checklist.map((c) => ({
    key: c.itemKey,
    section: c.section as ChecklistItem["section"],
    label: c.label,
    reason: c.reason ?? "",
    required: c.isRequired,
    sourceKey: c.sourceKey,
  }));

  const resolvedKeys = checklist
    .filter((c) => c.status === "captured" || c.status === "waived")
    .map((c) => c.itemKey);

  return assessPrevisitReadiness(
    {
      checklist: engineChecklist,
      evidenceSummary: brief.evidenceSummary as PrevisitBrief["evidenceSummary"],
      nextStep: brief.nextStep as PrevisitBrief["nextStep"],
    },
    resolvedKeys,
  );
}

// ══════════════════════════════════════════════════════════════════════
// CHECKLIST CAPTURE
// ══════════════════════════════════════════════════════════════════════

export interface CaptureChecklistInput {
  itemId: string;
  userId: string;
  value?: string | null;
  /** Evidence class assigned in the field. Defaults to FACT for a captured value. */
  evidence?: string | null;
  /** When set, the item is waived instead of captured, and a reason is mandatory. */
  waiveReason?: string | null;
}

/**
 * Capture or waive a checklist item.
 *
 * Capturing without a value is rejected: an "open" item with no value is still open.
 * Waiving requires a reason, because waiving is how the operator accepts risk.
 */
export async function captureChecklistItem(
  input: CaptureChecklistInput,
): Promise<PrevisitChecklistItem> {
  const db = await getDb();
  if (!db) throw new PrevisitError("DB_UNAVAILABLE", "Database not available");

  const [item] = await db
    .select()
    .from(previsitChecklistItems)
    .where(eq(previsitChecklistItems.id, input.itemId))
    .limit(1);

  if (!item) {
    throw new PrevisitError(
      "CHECKLIST_ITEM_NOT_FOUND",
      `Checklist item ${input.itemId} not found`,
      { itemId: input.itemId },
    );
  }

  const now = new Date();

  if (input.waiveReason) {
    const [updated] = await db
      .update(previsitChecklistItems)
      .set({
        status: "waived",
        waivedReason: input.waiveReason,
        capturedBy: input.userId,
        capturedAt: now,
        updatedAt: now,
      })
      .where(eq(previsitChecklistItems.id, input.itemId))
      .returning();

    await logAudit({
      userId: input.userId,
      action: "previsit.checklist_waived",
      tableName: "previsit_checklist_items",
      recordId: input.itemId,
      before: { status: item.status },
      after: { status: "waived", reason: input.waiveReason },
    }).catch(() => undefined);

    return updated;
  }

  if (input.value == null || String(input.value).trim() === "") {
    throw new PrevisitError(
      "BRIEF_VALIDATION_FAILED",
      `Checklist item ${item.itemKey} requires a captured value or an explicit waive reason.`,
      { itemId: input.itemId },
    );
  }

  const evidence = normalizeEvidenceClass(input.evidence ?? "FACT") ?? "FACT";

  const [updated] = await db
    .update(previsitChecklistItems)
    .set({
      status: "captured",
      capturedValue: String(input.value),
      capturedEvidence: evidence,
      capturedBy: input.userId,
      capturedAt: now,
      updatedAt: now,
    })
    .where(eq(previsitChecklistItems.id, input.itemId))
    .returning();

  await logAudit({
    userId: input.userId,
    action: "previsit.checklist_captured",
    tableName: "previsit_checklist_items",
    recordId: input.itemId,
    before: { status: item.status, value: item.capturedValue },
    after: { status: "captured", value: String(input.value), evidence },
  }).catch(() => undefined);

  return updated;
}

// ══════════════════════════════════════════════════════════════════════
// COMPLETE
// ══════════════════════════════════════════════════════════════════════

/**
 * Promote a brief to `completed`.
 * Blocks while any required checklist item is still open — that is the whole point of
 * the checklist: the company does not estimate conditions it has not verified.
 */
export async function completePrevisitBrief(
  briefId: string,
  userId: string,
): Promise<BriefWithChecklist> {
  const db = await getDb();
  if (!db) throw new PrevisitError("DB_UNAVAILABLE", "Database not available");

  const current = await getBriefWithChecklist(briefId);
  if (!current) {
    throw new PrevisitError("BRIEF_NOT_FOUND", `Brief ${briefId} not found`, { briefId });
  }

  if (current.brief.status === "completed") {
    return current;
  }

  if (current.brief.status === "superseded") {
    throw new PrevisitError(
      "BRIEF_LOCKED",
      `Brief ${briefId} was superseded by a newer pre-visit and can no longer be completed.`,
      { briefId },
    );
  }

  if (!current.readiness.canComplete) {
    throw new PrevisitError(
      "BRIEF_NOT_READY",
      `Brief ${briefId} has ${current.readiness.requiredChecklistOpen} required checklist item(s) still open. ${current.readiness.blockers.join(" ")}`,
      { briefId, blockers: current.readiness.blockers },
    );
  }

  const now = new Date();
  await db
    .update(previsitBriefs)
    .set({ status: "completed", completedBy: userId, completedAt: now, updatedAt: now })
    .where(eq(previsitBriefs.id, briefId));

  await logAudit({
    userId,
    action: "previsit.brief_completed",
    tableName: "previsit_briefs",
    recordId: briefId,
    before: { status: current.brief.status },
    after: {
      status: "completed",
      nextStep: current.brief.nextStep,
      checklistResolved: current.checklist.filter((c) => c.status !== "open").length,
      checklistTotal: current.checklist.length,
    },
  }).catch(() => undefined);

  const updated = await getBriefWithChecklist(briefId);
  return updated!;
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE LINKAGE
// ══════════════════════════════════════════════════════════════════════

/**
 * Link a scope draft to the brief that authorized it, propagating the geo signals the
 * Scope Builder must display. Returns false when either side does not exist.
 */
export async function linkBriefToScopeDraft(
  briefId: string,
  scopeDraftId: string,
  userId: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [brief] = await db
    .select()
    .from(previsitBriefs)
    .where(eq(previsitBriefs.id, briefId))
    .limit(1);
  if (!brief) return false;

  const geo = await getProjectGeoContext(brief.projectId);

  const result = await db
    .update(scopeDrafts)
    .set({
      previsitBriefId: briefId,
      geoWarnings: geo?.warnings ?? brief.geoWarnings,
      geoRiskClass: geo?.riskClass ?? null,
      updatedAt: new Date(),
    })
    .where(eq(scopeDrafts.id, scopeDraftId))
    .returning();

  if (result.length === 0) return false;

  await logAudit({
    userId,
    action: "previsit.brief_linked_to_scope",
    tableName: "scope_drafts",
    recordId: scopeDraftId,
    before: null,
    after: { briefId, geoRiskClass: geo?.riskClass ?? null, geoCodes: geo?.codes ?? [] },
  }).catch(() => undefined);

  return true;
}
