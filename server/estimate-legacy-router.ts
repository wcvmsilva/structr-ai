import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import { transformBundleToEstimateDraft } from "@shared/catalog-utils";
import { getBundleById, createEstimateDraft, getEstimateDraftById, listEstimateDrafts } from "./db";

export const estimateLegacyRouter = router({
  sendBundleToEstimate: protectedProcedure
    .input(z.object({
      bundleId: z.number(),
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

      const payload = transformBundleToEstimateDraft(bundle, input.discount, input.notes);

      const draft = await createEstimateDraft({
        bundleId: payload.bundleId,
        bundleName: payload.bundleName,
        channel: payload.channel as "direct" | "insurance" | "commercial",
        lineItems: payload.lineItems,
        subtotalCost: payload.subtotalCost.toFixed(2),
        subtotalPrice: payload.subtotalPrice.toFixed(2),
        grossProfit: payload.grossProfit.toFixed(2),
        grossProfitPct: payload.grossProfitPct.toFixed(2),
        discountApplied: payload.discountApplied.toFixed(2),
        discountAmount: payload.discountAmount.toFixed(2),
        finalTotalPrice: payload.finalTotalPrice.toFixed(2),
        notes: payload.notes,
        metadata: payload.metadata,
        createdBy: ctx.user.id,
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
    .input(z.object({ id: z.number() }))
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
