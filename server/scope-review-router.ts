/**
 * structr.ai — Scope Review Router
 * Sprint 14: Scope Review Workspace
 *
 * tRPC procedures for:
 *   1. startReview       — draft → under_review
 *   2. applyDelta        — add remove/quantity_adjustment delta (only in under_review)
 *   3. getReviewState    — effective items + deltas + status
 *   4. approveOrReject   — under_review → approved | rejected
 *   5. convertToBundle   — approved → converted (snapshot + bundle creation)
 *
 * All state transitions enforced by scope-review-state-machine.ts.
 * All mutations require admin role.
 * Read operations require authentication.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, adminTenantProcedure } from "./_core/trpc";
import {
  validateTransition,
  assertTransition,
  assertEditable,
  isTerminalState,
  getValidNextStates,
  type ScopeDraftStatus,
} from "../shared/scope-review-state-machine";
import {
  createScopeReviewDelta,
  getDeltasForDraft,
  transitionDraftStatus,
  getEffectiveItems,
  convertApprovedScopeToBundle,
  ScopeReviewConversionError,
  getSnapshotForDraft,
} from "./scope-review-db";
import { getScopeDraftById, getScopeDraftItems } from "./scope-db";
import { requireEntityAccess } from "./project-access";

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const scopeReviewRouter = router({

  // ────────────────────────────────────────────────────────────────────
  // 1. START REVIEW — draft → under_review
  // ────────────────────────────────────────────────────────────────────
  startReview: adminProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "approve");

      const draft = await getScopeDraftById(input.scopeDraftId);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      // Enforce state machine
      const result = validateTransition(draft.status as ScopeDraftStatus, "under_review");
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error ?? "Invalid state transition",
        });
      }

      const updated = await transitionDraftStatus(input.scopeDraftId, "under_review", ctx.user.id);
      if (!updated) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to transition draft" });
      }

      return {
        id: updated.id,
        status: updated.status,
        message: "Review started. Draft is now editable.",
        validNextStates: getValidNextStates("under_review"),
      };
    }),

  // ────────────────────────────────────────────────────────────────────
  // 2. APPLY DELTA — remove or adjust quantity (only in under_review)
  // ────────────────────────────────────────────────────────────────────
  applyDelta: adminProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
      assemblyId: z.string().uuid(),
      actionType: z.enum(["remove", "quantity_adjustment"]),
      previousQuantity: z.number().min(0),
      newQuantity: z.number().min(0).optional().nullable(),
      operatorReason: z.string().min(1, "Operator reason is required"),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "write");

      const draft = await getScopeDraftById(input.scopeDraftId);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      // Enforce editable state
      try {
        assertEditable(draft.status as ScopeDraftStatus);
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message ?? "Draft is not in an editable state",
        });
      }

      // Validate quantity_adjustment has newQuantity
      if (input.actionType === "quantity_adjustment") {
        if (input.newQuantity === null || input.newQuantity === undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "quantity_adjustment requires a newQuantity value",
          });
        }
      }

      // Verify assembly exists in the draft items
      const items = await getScopeDraftItems(input.scopeDraftId);
      const targetItem = items.find((i) => i.assemblyId === input.assemblyId);
      if (!targetItem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Assembly #${input.assemblyId} not found in scope draft #${input.scopeDraftId}`,
        });
      }

      const delta = await createScopeReviewDelta(
        {
          scopeDraftId: input.scopeDraftId,
          assemblyId: input.assemblyId,
          deltaType: input.actionType,
          actionType: input.actionType,
          previousQuantity: String(input.previousQuantity),
          newQuantity: input.newQuantity !== null && input.newQuantity !== undefined
            ? String(input.newQuantity)
            : null,
          operatorReason: input.operatorReason,
          createdBy: ctx.user.id,
        },
        ctx.user.id
      );

      if (!delta) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create delta" });
      }

      return {
        deltaId: delta.id,
        actionType: delta.actionType,
        assemblyId: delta.assemblyId,
        message: `Delta applied: ${delta.actionType} on assembly #${delta.assemblyId}`,
      };
    }),

  // ────────────────────────────────────────────────────────────────────
  // 3. GET REVIEW STATE — effective items + deltas + status
  // ────────────────────────────────────────────────────────────────────
  getReviewState: protectedProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
    }))
    .query(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user!.id, "read");

      const draft = await getScopeDraftById(input.scopeDraftId);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      const effectiveItems = await getEffectiveItems(input.scopeDraftId);
      const deltas = await getDeltasForDraft(input.scopeDraftId);
      const originalItems = await getScopeDraftItems(input.scopeDraftId);
      const snapshot = await getSnapshotForDraft(input.scopeDraftId);

      return {
        draft: {
          id: draft.id,
          projectId: draft.projectId,
          intakeFormId: draft.intakeFormId,
          status: draft.status,
          confidenceScore: draft.confidence,
          warnings: draft.warningsJson,
          createdAt: draft.createdAt,
        },
        originalItems: originalItems.map((item) => ({
          id: item.id,
          assemblyId: item.assemblyId,
          quantity: Number(item.quantity),
          unit: item.unit,
          reason: item.reason,
          confidence: Number(item.confidence),
          sortOrder: item.sortOrder,
        })),
        effectiveItems: effectiveItems.map((item) => ({
          id: item.id,
          assemblyId: item.assemblyId,
          quantity: Number(item.quantity),
          unit: item.unit,
          reason: item.reason,
          confidence: Number(item.confidence),
          sortOrder: item.sortOrder,
        })),
        deltas: deltas.map((d) => ({
          id: d.id,
          assemblyId: d.assemblyId,
          actionType: d.actionType,
          previousQuantity: Number(d.previousQuantity),
          newQuantity: d.newQuantity !== null ? Number(d.newQuantity) : null,
          operatorReason: d.operatorReason,
          createdBy: d.createdBy,
          createdAt: d.createdAt,
        })),
        snapshot: snapshot
          ? {
              id: snapshot.id,
              bundleId: snapshot.bundleId,
              approvedItemCount: (snapshot.approvedItems as any[]).length,
              deltaCount: (snapshot.deltaChanges as any[]).length,
              createdAt: snapshot.createdAt,
            }
          : null,
        validNextStates: getValidNextStates(draft.status as ScopeDraftStatus),
        isTerminal: isTerminalState(draft.status as ScopeDraftStatus),
      };
    }),

  // ────────────────────────────────────────────────────────────────────
  // 4. APPROVE OR REJECT — under_review → approved | rejected
  // ────────────────────────────────────────────────────────────────────
  approveOrReject: adminProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "approve");

      const draft = await getScopeDraftById(input.scopeDraftId);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      // Enforce state machine
      const result = validateTransition(
        draft.status as ScopeDraftStatus,
        input.decision as ScopeDraftStatus
      );
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error ?? "Invalid state transition",
        });
      }

      const updated = await transitionDraftStatus(
        input.scopeDraftId,
        input.decision,
        ctx.user.id
      );
      if (!updated) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to transition draft" });
      }

      return {
        id: updated.id,
        status: updated.status,
        decision: input.decision,
        reason: input.reason ?? null,
        message: input.decision === "approved"
          ? "Scope draft approved. Ready for conversion to bundle."
          : "Scope draft rejected. No further transitions allowed.",
        validNextStates: getValidNextStates(updated.status as ScopeDraftStatus),
      };
    }),

  // ────────────────────────────────────────────────────────────────────
  // 5. CONVERT TO BUNDLE — approved → converted (snapshot + bundle)
  // ────────────────────────────────────────────────────────────────────
  convertToBundle: adminTenantProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
      // Accepted for existing clients; canonical names come from the authorized catalog.
      assemblyNameLookup: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "approve");
      try {
        return await convertApprovedScopeToBundle(input.scopeDraftId, ctx.tenantId, ctx.user.id);
      } catch (error) {
        if (error instanceof ScopeReviewConversionError) throw new TRPCError({ code: error.code, message: error.message, cause: error });
        throw error;
      }
    }),
});
