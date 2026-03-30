/**
 * Estimate Legacy Router — Simplified for new schema
 * The old bundle-to-estimate flow stored detailed fields; new schema uses draftData jsonb.
 */
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import { getBundleById, createEstimateDraft, getEstimateDraftById, listEstimateDrafts } from "./db";

export const estimateLegacyRouter = router({
  sendBundleToEstimate: protectedProcedure
    .input(z.object({
      bundleId: z.string().uuid(),
      discount: z.number().min(0).max(100).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const bundle = await getBundleById(input.bundleId);
      if (!bundle) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Bundle ${input.bundleId} not found` });
      }
      if (bundle.items.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot send an empty bundle to estimate" });
      }

      // Store all bundle data in draftData jsonb
      const draft = await createEstimateDraft({
        projectId: "00000000-0000-0000-0000-000000000000", // placeholder - needs real project
        source: "bundle_legacy",
        draftData: {
          bundleId: input.bundleId,
          bundleName: bundle.name,
          discount: input.discount,
          notes: input.notes,
          items: bundle.items,
        },
      });

      logAudit({
        userId: ctx.user.id,
        action: "estimate.sendBundleToEstimate",
        tableName: "estimate_drafts",
        recordId: draft.id,
        before: { bundleId: input.bundleId },
        after: draft,
      });

      return draft;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const draft = await getEstimateDraftById(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      return draft;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
    }).optional())
    .query(({ input }) => listEstimateDrafts(input ?? undefined)),
});
