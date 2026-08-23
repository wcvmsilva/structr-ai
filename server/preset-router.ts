/**
 * Preset Router — Stub
 * Bundles no longer have preset functionality in the new schema.
 * These endpoints return empty/stub responses to avoid breaking the app.
 * TODO: Remove or redesign when preset feature is re-implemented.
 */
import { z } from "zod";
import { router, protectedProcedure, tenantProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { deleteBundle, getBundleInTenant } from "./db";

export const presetRouter = router({
  list: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async () => {
      // Bundles no longer have isPreset field
      return [];
    }),

  createFromBundle: protectedProcedure
    .input(z.object({
      bundleId: z.string(),
      presetCategory: z.string().max(128).optional(),
      presetTags: z.array(z.string()).optional(),
      description: z.string().max(1000).optional(),
    }))
    .mutation(async () => {
      throw new Error("Preset functionality not available in current schema");
    }),

  createBundleFromPreset: protectedProcedure
    .input(z.object({
      presetId: z.string(),
      bundleName: z.string().min(1).max(255),
    }))
    .mutation(async () => {
      throw new Error("Preset functionality not available in current schema");
    }),

  markAsPreset: protectedProcedure
    .input(z.object({
      bundleId: z.string(),
      presetCategory: z.string().max(128).optional(),
      presetTags: z.array(z.string()).optional(),
    }))
    .mutation(async () => {
      throw new Error("Preset functionality not available in current schema");
    }),

  unmarkAsPreset: protectedProcedure
    .input(z.object({ bundleId: z.string() }))
    .mutation(async () => {
      throw new Error("Preset functionality not available in current schema");
    }),

  /**
   * G1 — this is a real bundle write, not a preset stub.
   *
   * It reaches `deleteBundle()` and soft-deletes a TENANT-OWNED row, so it belongs to the
   * bundle caller-axis surface and is gated exactly like `bundle.delete`: a resolved caller
   * tenant, and a target authorized for that tenant before the mutation. A bundle owned by
   * another tenant is reported as NOT_FOUND, like one that does not exist.
   */
  delete: tenantProcedure
    .input(z.object({ bundleId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await getBundleInTenant(ctx.tenantId, input.bundleId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Bundle ${input.bundleId} not found` });
      }
      await deleteBundle(ctx.tenantId, input.bundleId);
      return { success: true } as const;
    }),
});
