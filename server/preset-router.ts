/**
 * Preset Router — Stub
 * Bundles no longer have preset functionality in the new schema.
 * These endpoints return empty/stub responses to avoid breaking the app.
 * TODO: Remove or redesign when preset feature is re-implemented.
 */
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { listBundles, getBundleById, deleteBundle } from "./db";

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

  delete: protectedProcedure
    .input(z.object({ bundleId: z.string() }))
    .mutation(async ({ input }) => {
      await deleteBundle(input.bundleId);
      return { success: true } as const;
    }),
});
