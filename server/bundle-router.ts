import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import {
  createBundle, getBundleById, listBundles, updateBundleMeta,
  addItemToBundle, updateBundleItemQuantity, removeBundleItem,
  duplicateBundle, deleteBundle,
} from "./db";
import { getDb } from "./db";
import { bundleItems } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export const bundleRouter = router({
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1, "Bundle name is required").max(255),
      description: z.string().max(1000).optional(),
      category: z.string().optional(),
      bundleDiscount: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const bundle = await createBundle(input);
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
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const bundle = await getBundleById(input.id);
      if (!bundle) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Bundle ${input.id} not found` });
      }
      return bundle;
    }),

  list: protectedProcedure
    .input(z.object({
      activeOnly: z.boolean().optional(),
    }).optional())
    .query(({ input }) => listBundles(input ?? undefined)),

  updateMeta: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).nullable().optional(),
      category: z.string().optional(),
      bundleDiscount: z.string().optional(),
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
      bundleId: z.string().uuid(),
      assemblyId: z.string().uuid(),
      quantity: z.string().optional(),
      isOptional: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await addItemToBundle(input);
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
      bundleItemId: z.string().uuid(),
      quantity: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database connection failed" });
      const existingBundleItems = await db.select().from(bundleItems).where(eq(bundleItems.id, input.bundleItemId)).limit(1);
      const oldQuantity = existingBundleItems.length > 0 ? existingBundleItems[0].quantity : null;
      const result = await updateBundleItemQuantity(input.bundleItemId, input.quantity);
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
    .input(z.object({ bundleItemId: z.string().uuid() }))
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
      bundleId: z.string().uuid(),
      newName: z.string().min(1).max(255),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await duplicateBundle(input.bundleId, input.newName);
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
    .input(z.object({ bundleId: z.string().uuid() }))
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
});
