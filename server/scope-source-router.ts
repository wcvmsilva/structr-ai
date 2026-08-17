/**
 * structr.ai — Scope Source Router
 * TakeOff V1: Unified input layer that normalizes into the pipeline
 *
 * This router manages scope sources (manual + drawing + hybrid) and
 * converts them into scope_drafts via the ScopeSourceNormalizer.
 *
 * CRITICAL: The finalize procedure is the pipeline integration point.
 * It creates a standard scope_draft that the existing pipeline consumes unchanged.
 *
 * Audit fixes applied:
 *   B1: finalize wrapped in DB transaction with SELECT-then-SET idempotency
 *   B2: review status transitions enforced via state machine
 *   S1: previous active scope source deactivated on create
 *   S2: RFI check scoped to scope source (falls back to project if unlinked)
 *   S3: intakeFormId passed through to scope_draft
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  scopeSources,
  scopeDrafts,
  scopeDraftItems,
} from "../drizzle/schema";
import {
  createScopeSource,
  getScopeSourceById,
  listScopeSourcesByProject,
  getActiveScopeSource,
  updateScopeSource,
} from "./scope-source-db";
import { listOpenRfisByScopeSource, listOpenRfisByProject } from "./rfi-db";
import { normalizeScopeSource, calculateConfidenceSummary } from "@shared/scope-source-normalizer";
import type { ScopeSourcePayload, ConfidenceLevel, ScopeSourceAssemblyCandidate, ScopeSourceMeasuredInput } from "@shared/drawing-intake-types";
import { SOURCE_TYPES, CONFIDENCE_LEVELS } from "@shared/drawing-intake-types";
import { logAudit } from "./audit";
import { validateReviewTransition } from "@shared/scope-source-state-machine";
import { requireProjectAccessTrpc, requireEntityAccess } from "./project-access";

// ── Zod Schemas ─────────────────────────────────────────────────────

const measuredInputSchema = z.object({
  field: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  confidence: z.enum(CONFIDENCE_LEVELS),
  source: z.enum(["manual", "drawing"]),
  notes: z.string().optional(),
});

const assemblyCandidateSchema = z.object({
  assemblyId: z.string().uuid(),
  assemblyName: z.string().min(1),
  suggestedQuantity: z.number().positive(),
  unit: z.string().min(1),
  confidence: z.enum(CONFIDENCE_LEVELS),
  reason: z.string().min(1),
  source: z.enum(["manual", "drawing", "merged"]),
  manualQuantity: z.number().optional(),
  drawingQuantity: z.number().optional(),
});

const contextSchema = z.object({
  serviceType: z.string().optional(),
  finishLevel: z.string().optional(),
  channel: z.string().optional(),
  zone: z.string().optional(),
  projectType: z.string().optional(),
});

export const scopeSourceRouter = router({
  /**
   * Create a scope source from drawing + manual inputs.
   * This is the main entry point for the Drawing Intake Layer.
   * S1: Deactivates any previous active scope source for the same project.
   */
  create: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      sourceType: z.enum(SOURCE_TYPES),
      drawingRevisionId: z.string().uuid().optional(),
      intakeFormId: z.string().uuid().optional(),
      measuredInputs: z.array(measuredInputSchema).default([]),
      assemblyCandidates: z.array(assemblyCandidateSchema).default([]),
      assumptions: z.array(z.string()).default([]),
      context: contextSchema.default({}),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      await requireProjectAccessTrpc(input.projectId, userId, "write");

      // S1: Deactivate previous active scope source for this project
      const previousActive = await getActiveScopeSource(input.projectId);
      if (previousActive) {
        await updateScopeSource(previousActive.id, { isActive: false }, userId);
      }

      // Build confidence summary
      const allConfidenceLevels: ConfidenceLevel[] = [
        ...input.measuredInputs.map((m) => m.confidence),
        ...input.assemblyCandidates.map((a) => a.confidence),
      ];
      const confidenceSummary = calculateConfidenceSummary(allConfidenceLevels);

      // Build the full payload
      const payload: ScopeSourcePayload = {
        sourceType: input.sourceType,
        projectId: input.projectId,
        drawingRevisionId: input.drawingRevisionId,
        measuredInputs: input.measuredInputs as ScopeSourceMeasuredInput[],
        assemblyCandidates: input.assemblyCandidates as ScopeSourceAssemblyCandidate[],
        assumptions: input.assumptions,
        confidenceSummary,
        rfiCandidateIds: [], // RFIs are created separately
        context: input.context,
      };

      const scopeSource = await createScopeSource({
        projectId: input.projectId,
        sourceType: input.sourceType,
        drawingRevisionId: input.drawingRevisionId,
        intakeFormId: input.intakeFormId,
        payloadJson: payload,
        confidenceSummaryJson: confidenceSummary,
        assemblyCandidates: input.assemblyCandidates,
        assumptions: input.assumptions,
        reviewStatus: "pending",
        isActive: true,
        createdBy: userId,
      }, userId);

      if (!scopeSource) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create scope source" });
      }

      return scopeSource;
    }),

  /** Get a scope source by ID */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("scopeSource", input.id, ctx.user!.id, "read");

      const source = await getScopeSourceById(input.id);
      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope source not found" });
      }
      return source;
    }),

  /** List scope sources for a project */
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user!.id, "read");
      return listScopeSourcesByProject(input.projectId);
    }),

  /** Get the active scope source for a project */
  getActive: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user!.id, "read");
      return getActiveScopeSource(input.projectId);
    }),

  /**
   * Update assembly candidates on an existing scope source (human review edits).
   * Only allowed when reviewStatus is "pending" or "partial".
   */
  updateCandidates: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      assemblyCandidates: z.array(assemblyCandidateSchema),
      measuredInputs: z.array(measuredInputSchema).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      await requireEntityAccess("scopeSource", input.id, userId, "write");

      const existing = await getScopeSourceById(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope source not found" });
      }

      if (!["pending", "partial"].includes(existing.reviewStatus)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot update scope source in "${existing.reviewStatus}" status`,
        });
      }

      // Recalculate confidence
      const existingPayload = existing.payloadJson as ScopeSourcePayload;
      const measuredInputs = input.measuredInputs ?? existingPayload.measuredInputs ?? [];
      const allLevels: ConfidenceLevel[] = [
        ...measuredInputs.map((m) => m.confidence),
        ...input.assemblyCandidates.map((a) => a.confidence),
      ];
      const confidenceSummary = calculateConfidenceSummary(allLevels);

      const updatedPayload: ScopeSourcePayload = {
        ...existingPayload,
        measuredInputs: measuredInputs as ScopeSourceMeasuredInput[],
        assemblyCandidates: input.assemblyCandidates as ScopeSourceAssemblyCandidate[],
        confidenceSummary,
      };

      const updated = await updateScopeSource(input.id, {
        payloadJson: updatedPayload,
        assemblyCandidates: input.assemblyCandidates,
        confidenceSummaryJson: confidenceSummary,
        reviewStatus: "partial",
      }, userId);

      if (!updated) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update scope source" });
      }

      return updated;
    }),

  /**
   * Update review status with state machine validation (B2).
   */
  setReviewStatus: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      reviewStatus: z.enum(["pending", "partial", "approved", "rejected"]),
    }))
    .mutation(async ({ input, ctx }) => {
      // Status changes are approval-grade actions.
      await requireEntityAccess("scopeSource", input.id, ctx.user!.id, "approve");

      const existing = await getScopeSourceById(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope source not found" });
      }

      // B2: Enforce state machine transitions
      const transition = validateReviewTransition(existing.reviewStatus, input.reviewStatus);
      if (!transition.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: transition.error!,
        });
      }

      // Prevent approval if already finalized
      if (existing.scopeDraftId && input.reviewStatus === "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scope source already finalized — cannot change status",
        });
      }

      const result = await updateScopeSource(existing.id, { reviewStatus: input.reviewStatus }, ctx.user!.id);
      if (!result) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update review status" });
      }
      return result;
    }),

  /**
   * FINALIZE: Convert an approved scope source into a scope_draft.
   *
   * THIS IS THE PIPELINE INTEGRATION POINT.
   *
   * B1: Wrapped in a DB transaction to prevent race conditions.
   *     Steps 4-6 (create draft, add items, link source) are atomic.
   *     The scopeDraftId check + set happens within the same transaction.
   *
   * S2: RFI check is scoped to this scope source (falls back to project).
   * S3: intakeFormId passed through to scope_draft.
   *
   * Pipeline flow after finalize:
   *   scope_draft → scope_review → geo_override → estimate
   */
  finalize: protectedProcedure
    .input(z.object({
      scopeSourceId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      await requireEntityAccess("scopeSource", input.scopeSourceId, userId, "approve");

      // ── Step 1: Load and validate (outside transaction — read-only) ──
      const scopeSource = await getScopeSourceById(input.scopeSourceId);
      if (!scopeSource) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope source not found" });
      }

      if (scopeSource.reviewStatus !== "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Scope source must be "approved" to finalize. Current status: "${scopeSource.reviewStatus}"`,
        });
      }

      // Early idempotency check (non-transactional — fast path)
      if (scopeSource.scopeDraftId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scope source already finalized — scope draft already exists",
        });
      }

      // ── Step 2: Check open RFIs (S2: source-scoped first, fall back to project) ──
      const sourceRfis = await listOpenRfisByScopeSource(input.scopeSourceId);
      if (sourceRfis.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${sourceRfis.length} open RFI(s) linked to this scope source must be resolved before finalizing`,
        });
      }
      // Also check project-wide unlinked RFIs (scopeSourceId is null)
      const projectRfis = await listOpenRfisByProject(scopeSource.projectId);
      const unlinkedRfis = projectRfis.filter((r) => !r.scopeSourceId);
      if (unlinkedRfis.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${unlinkedRfis.length} unlinked open RFI(s) on this project must be resolved before finalizing`,
        });
      }

      // ── Step 3: Normalize (pure function — no DB) ──────────────────
      const payload = scopeSource.payloadJson as ScopeSourcePayload;
      const normalized = normalizeScopeSource(payload, userId);

      if (normalized.items.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Normalization produced no scope items. Review assembly candidates.",
        });
      }

      // ── Step 4: TRANSACTIONAL — create draft + items + link (B1) ───
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const result = await db.transaction(async (tx) => {
        // B1: Re-check idempotency INSIDE the transaction to prevent race condition.
        // Read the scope_source row within the transaction — if another request
        // already set scopeDraftId between our initial check and now, bail out.
        const [freshSource] = await tx
          .select({ scopeDraftId: scopeSources.scopeDraftId })
          .from(scopeSources)
          .where(eq(scopeSources.id, input.scopeSourceId))
          .limit(1);

        if (freshSource?.scopeDraftId) {
          // Another concurrent request already finalized — return existing draft ID
          return { scopeDraftId: freshSource.scopeDraftId, alreadyFinalized: true };
        }

        // Create scope_draft
        const [draft] = await tx.insert(scopeDrafts).values({
          projectId: normalized.draft.projectId,
          status: normalized.draft.status,
          content: normalized.draft.content,
          zone: normalized.draft.zone,
          finishLevel: normalized.draft.finishLevel,
          serviceType: normalized.draft.serviceType,
          channel: normalized.draft.channel,
          confidence: String(normalized.draft.confidence),
          reason: normalized.draft.reason,
          createdBy: normalized.draft.createdBy,
          warningsJson: normalized.draft.warningsJson,
          // S3: Pass through intakeFormId if present on scope source
          intakeFormId: scopeSource.intakeFormId ?? undefined,
        }).returning({ id: scopeDrafts.id });

        // Add scope_draft_items
        const draftItems = normalized.items.map((item) => ({
          scopeDraftId: draft.id,
          assemblyId: item.assemblyId,
          assemblyName: item.assemblyName,
          quantity: String(item.quantity),
          unit: item.unit,
          reason: item.reason,
          confidence: String(item.confidence),
          notes: item.notes,
          sortOrder: item.sortOrder,
        }));

        if (draftItems.length > 0) {
          await tx.insert(scopeDraftItems).values(draftItems);
        }

        // Link scope_source → scope_draft (atomically with the above)
        await tx
          .update(scopeSources)
          .set({ scopeDraftId: draft.id, updatedAt: new Date() })
          .where(eq(scopeSources.id, input.scopeSourceId));

        return { scopeDraftId: draft.id, alreadyFinalized: false };
      });

      // ── Step 5: Audit (outside transaction — non-blocking) ─────────
      const action = result.alreadyFinalized
        ? "scope_source.finalize_idempotent"
        : "scope_source.finalized";

      try {
        await logAudit({
          userId,
          action,
          tableName: "scope_sources",
          recordId: input.scopeSourceId,
          before: result.alreadyFinalized ? null : {
            reviewStatus: scopeSource.reviewStatus,
            sourceType: payload.sourceType,
            assemblyCandidateCount: payload.assemblyCandidates.length,
          },
          after: {
            scopeDraftId: result.scopeDraftId,
            itemCount: normalized.items.length,
            overallConfidence: normalized.draft.confidence,
            warnings: normalized.warnings,
            sourceType: payload.sourceType,
          },
        });
      } catch {
        // Audit failure is non-blocking
      }

      return {
        scopeDraftId: result.scopeDraftId,
        scopeSourceId: input.scopeSourceId,
        itemCount: result.alreadyFinalized ? 0 : normalized.items.length,
        overallConfidence: normalized.draft.confidence,
        warnings: result.alreadyFinalized
          ? ["Scope source was already finalized — returning existing draft."]
          : normalized.warnings,
        alreadyFinalized: result.alreadyFinalized,
      };
    }),
});
