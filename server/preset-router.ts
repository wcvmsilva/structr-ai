import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { logAudit } from "./audit";
import {
  listBundles, getBundleById, createPresetFromBundle,
  createBundleFromPreset, markBundleAsPreset,
  unmarkBundleAsPreset, deleteBundle
} from "./db";

export const presetRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const presets = await listBundles({ presetsOnly: true });
      if (input?.category) {
        return presets.filter(p => p.presetCategory === input.category);
      }
      return presets;
    }),

  createFromBundle: protectedProcedure
    .input(z.object({
      bundleId: z.number(),
      presetCategory: z.string().max(128).optional(),
      presetTags: z.array(z.string()).optional(),
      description: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createPresetFromBundle(input.bundleId, {
        presetCategory: input.presetCategory ?? null,
        presetTags: input.presetTags ?? null,
        description: input.description ?? null,
      }, ctx.user.id);
      logAudit({
        userId: ctx.user.id,
        action: "preset.createFromBundle",
        tableName: "bundles",
        recordId: result.id,
        before: { sourceBundleId: input.bundleId },
        after: result,
      });
      return result;
    }),

  createBundleFromPreset: protectedProcedure
    .input(z.object({
      presetId: z.number(),
      bundleName: z.string().min(1).max(255),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createBundleFromPreset(input.presetId, input.bundleName, ctx.user.id);
      logAudit({
        userId: ctx.user.id,
        action: "preset.createBundleFromPreset",
        tableName: "bundles",
        recordId: result.id,
        before: { sourcePresetId: input.presetId },
        after: result,
      });
      return result;
    }),

  markAsPreset: protectedProcedure
    .input(z.object({
      bundleId: z.number(),
      presetCategory: z.string().max(128).optional(),
      presetTags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getBundleById(input.bundleId);
      const result = await markBundleAsPreset(input.bundleId, {
        presetCategory: input.presetCategory ?? null,
        presetTags: input.presetTags ?? null,
      });
      logAudit({
        userId: ctx.user.id,
        action: "preset.markAsPreset",
        tableName: "bundles",
        recordId: input.bundleId,
        before: { isPreset: before?.isPreset },
        after: { isPreset: true },
      });
      return result;
    }),

  unmarkAsPreset: protectedProcedure
    .input(z.object({ bundleId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const result = await unmarkBundleAsPreset(input.bundleId);
      logAudit({
        userId: ctx.user.id,
        action: "preset.unmarkAsPreset",
        tableName: "bundles",
        recordId: input.bundleId,
        before: { isPreset: true },
        after: { isPreset: false },
      });
      return result;
    }),

  delete: protectedProcedure
    .input(z.object({ bundleId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const before = await getBundleById(input.bundleId);
      await deleteBundle(input.bundleId);
      logAudit({
        userId: ctx.user.id,
        action: "preset.delete",
        tableName: "bundles",
        recordId: input.bundleId,
        before,
        after: { isActive: false },
      });
      return { success: true } as const;
    }),
});
