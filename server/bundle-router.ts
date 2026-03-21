import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import { validateQuantity } from "@shared/catalog-utils";
import {
  createBundle, getBundleById, listBundles, updateBundleMeta,
  addItemToBundle, updateBundleItemQuantity, removeBundleItem,
  duplicateBundle, deleteBundle, recalculateBundleTotals
} from "./db";
import { getDb } from "./db";
import { bundleItems } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export const bundleRouter = router({
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1, "Bundle name is required").max(255),
      description: z.string().max(1000).optional(),
      channel: z.enum(["direct", "insurance", "commercial"]).optional(),
      defaultDiscount: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const bundle = await createBundle({
        ...input,
        createdBy: ctx.user.id,
      });
      logAudit({
        userId: ctx.user.id,
        action: "bundle.create",
        tableName: "bundles",
        recordId: bundle.id,
        before: null,
        after: bundle,
      });
      return bundle;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const bundle = await getBundleById(input.id);
      if (!bundle) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Bundle ${input.id} not found` });
      }
      return bundle;
    }),

  list: protectedProcedure
    .input(z.object({
      createdBy: z.number().optional(),
      activeOnly: z.boolean().optional(),
      presetsOnly: z.boolean().optional(),
    }).optional())
    .query(({ input }) => listBundles(input ?? undefined)),

  updateMeta: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).nullable().optional(),
      channel: z.enum(["direct", "insurance", "commercial"]).optional(),
      defaultDiscount: z.string().optional(),
      isPreset: z.boolean().optional(),
      presetCategory: z.string().max(128).nullable().optional(),
      presetTags: z.array(z.string()).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const before = await getBundleById(id);
      const result = await updateBundleMeta(id, data);
      logAudit({
        userId: ctx.user.id,
        action: "bundle.updateMeta",
        tableName: "bundles",
        recordId: id,
        before,
        after: result,
      });
      return result;
    }),

  addItem: protectedProcedure
    .input(z.object({
      bundleId: z.number(),
      catalogItemId: z.number(),
      quantity: z.number().default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const validation = validateQuantity(input.quantity);
      if (!validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validation.reason ?? "Invalid quantity" });
      }
      const result = await addItemToBundle({
        bundleId: input.bundleId,
        catalogItemId: input.catalogItemId,
        quantity: validation.corrected,
      });
      logAudit({
        userId: ctx.user.id,
        action: "bundle.addItem",
        tableName: "bundle_items",
        recordId: result.id,
        before: null,
        after: result,
      });
      return result;
    }),

  updateItemQuantity: protectedProcedure
    .input(z.object({
      bundleItemId: z.number(),
      quantity: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const validation = validateQuantity(input.quantity);
      if (!validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validation.reason ?? "Invalid quantity" });
      }
      // Capture old quantity BEFORE mutation for accurate audit trail
      const existingBundleItems = await getDb().then(db => db?.select().from(bundleItems).where(eq(bundleItems.id, input.bundleItemId)).limit(1));
      const oldQuantity = existingBundleItems && existingBundleItems.length > 0 ? existingBundleItems[0].quantity : null;
      const result = await updateBundleItemQuantity(input.bundleItemId, validation.corrected);
      logAudit({
        userId: ctx.user.id,
        action: "bundle.updateItemQuantity",
        tableName: "bundle_items",
        recordId: input.bundleItemId,
        before: { quantity: oldQuantity ?? null },
        after: result,
      });
      return result;
    }),

  removeItem: protectedProcedure
    .input(z.object({ bundleItemId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const result = await removeBundleItem(input.bundleItemId);
      logAudit({
        userId: ctx.user.id,
        action: "bundle.removeItem",
        tableName: "bundle_items",
        recordId: input.bundleItemId,
        before: result,
        after: null,
      });
      return result;
    }),

  duplicate: protectedProcedure
    .input(z.object({
      bundleId: z.number(),
      newName: z.string().min(1).max(255),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await duplicateBundle(input.bundleId, input.newName, ctx.user.id);
      logAudit({
        userId: ctx.user.id,
        action: "bundle.duplicate",
        tableName: "bundles",
        recordId: result.id,
        before: { sourceBundleId: input.bundleId },
        after: result,
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
        action: "bundle.delete",
        tableName: "bundles",
        recordId: input.bundleId,
        before,
        after: { isActive: false },
      });
      return { success: true } as const;
    }),

  recalculate: protectedProcedure
    .input(z.object({ bundleId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const before = await getBundleById(input.bundleId);
      const result = await recalculateBundleTotals(input.bundleId);
      logAudit({
        userId: ctx.user.id,
        action: "bundle.recalculate",
        tableName: "bundles",
        recordId: input.bundleId,
        before: { totalCost: before?.totalCost, totalPrice: before?.totalPrice },
        after: result,
      });
      return result;
    }),
});
