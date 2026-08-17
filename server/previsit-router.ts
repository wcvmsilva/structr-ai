/**
 * structr.ai — PHASE 2 Pre-Visit tRPC Router
 *
 * Procedures:
 *   - previsit.createBrief        (protected) → create brief + derived checklist
 *   - previsit.getBrief           (protected) → brief + checklist + readiness
 *   - previsit.getLatestForProject(protected) → latest brief for a project
 *   - previsit.listForProject     (protected) → brief history for a project
 *   - previsit.captureChecklist   (protected) → capture or waive a checklist item
 *   - previsit.completeBrief      (protected) → promote brief to completed
 *   - previsit.linkToScope        (protected) → link brief to a scope draft
 *   - previsit.readiness          (protected) → estimate-readiness assessment
 *
 * Authorization: every procedure resolves the project and delegates to the Phase 1
 * project access guard. The pre-visit never emits a definitive price, so there is no
 * pricing procedure in this router by design.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { requireProjectAccessTrpc } from "./project-access";
import {
  captureChecklistItem,
  completePrevisitBrief,
  createPrevisitBrief,
  getBriefWithChecklist,
  getLatestBriefForProject,
  linkBriefToScopeDraft,
  listBriefsForProject,
  PrevisitError,
} from "./previsit-db";
import {
  BRIEF_SECTIONS,
  detectDefinitivePriceLanguage,
} from "@shared/previsit-engine";
import {
  EVIDENCE_CLASSES,
  PREVISIT_NEXT_STEPS,
  PREVISIT_STEPS_ALLOWING_ESTIMATE,
} from "@shared/domain/phase2-taxonomy";
import { getDb } from "./db";
import { previsitChecklistItems, scopeDrafts } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const evidenceItemSchema = z.object({
  key: z.string().min(1).max(128),
  section: z.enum(BRIEF_SECTIONS),
  label: z.string().min(1).max(255),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  evidence: z.enum(EVIDENCE_CLASSES),
  source: z.string().max(255).nullish(),
  rationale: z.string().max(1000).nullish(),
});

const createBriefSchema = z.object({
  projectId: z.string().uuid(),
  intakeFormId: z.string().uuid().nullish(),
  summary: z.string().max(5000).nullish(),
  items: z.array(evidenceItemSchema).min(1),
  /** Candidate recommendations; exactly one survives normalization. */
  nextStepCandidates: z.array(z.enum(PREVISIT_NEXT_STEPS)).min(1),
  nextStepRationale: z.string().max(2000).nullish(),
  geoWarnings: z.array(z.string()).optional(),
});

// ══════════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ══════════════════════════════════════════════════════════════════════

/** Map a PrevisitError to the correct tRPC code so the UI can react precisely. */
function toTrpcError(err: unknown): never {
  if (err instanceof PrevisitError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      PROJECT_NOT_FOUND: "NOT_FOUND",
      BRIEF_NOT_FOUND: "NOT_FOUND",
      CHECKLIST_ITEM_NOT_FOUND: "NOT_FOUND",
      BRIEF_VALIDATION_FAILED: "BAD_REQUEST",
      BRIEF_NOT_READY: "PRECONDITION_FAILED",
      BRIEF_LOCKED: "CONFLICT",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const previsitRouter = router({
  /**
   * Create the Pre-Visit Project Brief and its field inspection checklist.
   * Rejects definitive-price language and multiple competing recommendations.
   */
  createBrief: protectedProcedure
    .input(createBriefSchema)
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");

      // Defensive second pass at the transport boundary: the engine also checks this,
      // but a pre-visit that promises a price must never reach persistence.
      const priceFindings = [
        ...detectDefinitivePriceLanguage(input.summary),
        ...detectDefinitivePriceLanguage(input.nextStepRationale),
      ];
      if (priceFindings.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Pre-visit cannot emit a definitive price. Remove: ${priceFindings.map((f) => `"${f.excerpt}"`).join(", ")}.`,
        });
      }

      try {
        return await createPrevisitBrief({
          tenantId: ctx.tenantId ?? null,
          projectId: input.projectId,
          intakeFormId: input.intakeFormId ?? null,
          summary: input.summary ?? null,
          items: input.items.map((i) => ({
            key: i.key,
            section: i.section,
            label: i.label,
            value: i.value,
            evidence: i.evidence,
            source: i.source ?? null,
            rationale: i.rationale ?? null,
          })),
          nextStepCandidates: input.nextStepCandidates,
          nextStepRationale: input.nextStepRationale ?? null,
          geoWarnings: input.geoWarnings,
          userId: ctx.user.id,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  getBrief: protectedProcedure
    .input(z.object({ briefId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const result = await getBriefWithChecklist(input.briefId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Brief not found" });
      await requireProjectAccessTrpc(result.brief.projectId, ctx.user.id, "read");
      return result;
    }),

  getLatestForProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getLatestBriefForProject(input.projectId);
    }),

  listForProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return listBriefsForProject(input.projectId);
    }),

  /** Capture a field value or waive the item with an explicit reason. */
  captureChecklist: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        value: z.string().max(2000).nullish(),
        evidence: z.enum(EVIDENCE_CLASSES).optional(),
        waiveReason: z.string().max(1000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [item] = await db
        .select()
        .from(previsitChecklistItems)
        .where(eq(previsitChecklistItems.id, input.itemId))
        .limit(1);

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Checklist item not found" });
      }

      await requireProjectAccessTrpc(item.projectId, ctx.user.id, "write");

      try {
        return await captureChecklistItem({
          itemId: input.itemId,
          userId: ctx.user.id,
          value: input.value ?? null,
          evidence: input.evidence ?? null,
          waiveReason: input.waiveReason ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Promote the brief to completed. Blocked while required checklist items are open. */
  completeBrief: protectedProcedure
    .input(z.object({ briefId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await getBriefWithChecklist(input.briefId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Brief not found" });
      await requireProjectAccessTrpc(existing.brief.projectId, ctx.user.id, "approve");

      try {
        return await completePrevisitBrief(input.briefId, ctx.user.id);
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Link the brief to a scope draft, propagating geo signals to the Scope Builder. */
  linkToScope: protectedProcedure
    .input(z.object({ briefId: z.string().uuid(), scopeDraftId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const brief = await getBriefWithChecklist(input.briefId);
      if (!brief) throw new TRPCError({ code: "NOT_FOUND", message: "Brief not found" });
      await requireProjectAccessTrpc(brief.brief.projectId, ctx.user.id, "write");

      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [draft] = await db
        .select()
        .from(scopeDrafts)
        .where(eq(scopeDrafts.id, input.scopeDraftId))
        .limit(1);

      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      if (draft.projectId !== brief.brief.projectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scope draft and pre-visit brief belong to different projects.",
        });
      }

      const linked = await linkBriefToScopeDraft(input.briefId, input.scopeDraftId, ctx.user.id);
      return { linked };
    }),

  /**
   * Estimate-readiness assessment for a project.
   * Reports whether the pre-visit decision authorizes pricing work and what remains open.
   */
  readiness: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const latest = await getLatestBriefForProject(input.projectId);
      if (!latest) {
        return {
          hasBrief: false,
          allowsEstimate: false,
          briefStatus: null,
          nextStep: null,
          blockers: [
            "No pre-visit brief exists for this project. The pre-visit is the gate that classifies conditions before any pricing work.",
          ],
          warnings: [],
          requiredChecklistOpen: 0,
        };
      }

      const blockers: string[] = [...latest.readiness.blockers];
      if (!latest.allowsEstimate) {
        blockers.push(
          `Pre-visit recommendation is "${latest.brief.nextStep}", which requires verification work before pricing. Estimate-oriented steps: ${PREVISIT_STEPS_ALLOWING_ESTIMATE.join(", ")}.`,
        );
      }
      if (latest.brief.status !== "completed") {
        blockers.push(
          `Pre-visit brief status is "${latest.brief.status}" — complete the brief before relying on it for pricing.`,
        );
      }

      return {
        hasBrief: true,
        allowsEstimate: latest.allowsEstimate && latest.brief.status === "completed" && blockers.length === 0,
        briefStatus: latest.brief.status,
        nextStep: latest.brief.nextStep,
        blockers,
        warnings: latest.readiness.warnings,
        requiredChecklistOpen: latest.readiness.requiredChecklistOpen,
      };
    }),
});
