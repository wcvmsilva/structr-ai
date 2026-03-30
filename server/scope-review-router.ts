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
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
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
  createReviewSnapshot,
  getSnapshotForDraft,
  updateSnapshotBundleId,
  buildSnapshotData,
} from "./scope-review-db";
import { getScopeDraftById, getScopeDraftItems } from "./scope-db";
import { MIN_GROSS_PROFIT } from "../shared/catalog-utils";

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
    .query(async ({ input }) => {
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
  convertToBundle: adminProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
      assemblyNameLookup: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const draft = await getScopeDraftById(input.scopeDraftId);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      // Enforce state machine: must be approved
      const result = validateTransition(draft.status as ScopeDraftStatus, "converted");
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error ?? "Invalid state transition",
        });
      }

      // Build assembly name lookup from input or use defaults
      const nameLookup = new Map<number, string>();
      if (input.assemblyNameLookup) {
        for (const [key, value] of Object.entries(input.assemblyNameLookup)) {
          nameLookup.set(Number(key), value);
        }
      }

      // Build snapshot data
      const snapshotData = await buildSnapshotData(input.scopeDraftId, nameLookup);
      if (!snapshotData) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to build snapshot data",
        });
      }

      // ── PROFIT SHIELD VALIDATION ──────────────────────────────
      // Check if any approved item has critically low confidence
      // (confidence < 0.5 = high risk of under-pricing)
      const lowConfidenceItems = snapshotData.approvedItems.filter(
        (item) => item.confidence < 0.5
      );
      const profitShieldWarnings: string[] = [];

      if (lowConfidenceItems.length > 0) {
        profitShieldWarnings.push(
          `PROFIT_SHIELD: ${lowConfidenceItems.length} item(s) have confidence below 50%: ` +
          lowConfidenceItems.map((i) => `${i.assemblyName ?? `#${i.assemblyId}`} (${(i.confidence * 100).toFixed(0)}%)`).join(", ")
        );
      }

      // Check if overall confidence score is below threshold
      const overallConfidence = snapshotData.confidence
        ? parseFloat(snapshotData.confidence)
        : null;
      if (overallConfidence !== null && overallConfidence < 0.6) {
        profitShieldWarnings.push(
          `PROFIT_SHIELD: Overall scope confidence ${(overallConfidence * 100).toFixed(0)}% is below 60% threshold. Review pricing carefully.`
        );
      }

      // Merge Profit Shield warnings into snapshot warnings
      const allWarnings = [
        ...(snapshotData.warnings ?? []),
        ...profitShieldWarnings,
      ];

      // Create snapshot (bundleId will be updated after bundle creation)
      const snapshot = await createReviewSnapshot(
        {
          scopeDraftId: input.scopeDraftId,
          approvedItems: snapshotData.approvedItems,
          deltaChanges: snapshotData.deltaChanges,
          warnings: allWarnings.length > 0 ? allWarnings : null,
          confidenceScore: snapshotData.confidence,
          bundleId: null,
          operatorId: ctx.user.id,
        },
        ctx.user.id
      );

      if (!snapshot) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create review snapshot",
        });
      }

      // Transition to converted
      const updated = await transitionDraftStatus(input.scopeDraftId, "converted", ctx.user.id);
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to transition draft to converted",
        });
      }

      return {
        id: updated.id,
        status: "converted",
        snapshotId: snapshot.id,
        approvedItemCount: snapshotData.approvedItems.length,
        deltaCount: snapshotData.deltaChanges.length,
        warnings: allWarnings,
        profitShieldWarnings,
        profitShieldPassed: profitShieldWarnings.length === 0,
        message: profitShieldWarnings.length > 0
          ? `Scope draft converted with ${profitShieldWarnings.length} Profit Shield warning(s). Review before estimate generation.`
          : "Scope draft converted. Snapshot persisted. Ready for bundle creation.",
        validNextStates: [],
      };
    }),
});
