/**
 * Bundle Router
 *
 * ── G1 — BUNDLES CALLER-AXIS BOUNDARY (B2 / Codex P1-1) ──────────────────────
 *
 * Every route here operates on `bundles` / `bundle_items`, which are TENANT-OWNED under the
 * approved Product/Data Ownership Model V1. They all run behind `tenantProcedure`: an
 * authenticated caller whose tenant cannot be resolved is rejected before any bundle read or
 * write, rather than being handed a silently empty result.
 *
 * `ctx.tenantId` is passed explicitly to every helper. No route accepts a tenant field from
 * the caller, and none may be added — ownership is derived from the resolved context only.
 *
 * Item routes authorize through the parent bundle, never through the child id:
 *
 *     authentication → resolved caller tenant → authorized parent bundle → child item
 *
 * The unscoped inline `bundle_items` primary-key read this router used to perform for its
 * audit "before" value has been removed; `getBundleItemInTenant()` performs that lookup
 * behind the parent check.
 *
 * SCOPE: this closes the CALLER axis only. Legacy `tenant_id IS NULL` bundles remain
 * reachable by any resolved tenant while TENANT_STRICT is off — that is the ROW axis
 * (F15 / issue #10) and is not addressed here.
 */
import { z } from "zod";
import { router, tenantProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import {
  createBundle, getBundleById, listBundles, updateBundleMeta,
  addItemToBundle, updateBundleItemQuantity, removeBundleItem,
  duplicateBundle, deleteBundle,
  getBundleInTenant, getBundleItemInTenant,
} from "./db";

/**
 * Authorize a bundle for the caller's tenant.
 * A bundle owned by another tenant is reported as NOT_FOUND, exactly like one that does not
 * exist, so the error cannot be used to prove a foreign row exists.
 */
async function requireBundleInTenant(tenantId: string, bundleId: string) {
  const bundle = await getBundleInTenant(tenantId, bundleId);
  if (!bundle) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Bundle ${bundleId} not found` });
  }
  return bundle;
}

/** Authorize a bundle item through its parent bundle. Same non-disclosing semantics. */
async function requireBundleItemInTenant(tenantId: string, bundleItemId: string) {
  const item = await getBundleItemInTenant(tenantId, bundleItemId);
  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Bundle item ${bundleItemId} not found` });
  }
  return item;
}

export const bundleRouter = router({
  create: tenantProcedure
    .input(z.object({
      name: z.string().min(1, "Bundle name is required").max(255),
      description: z.string().max(1000).optional(),
      category: z.string().optional(),
      bundleDiscount: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const bundle = await createBundle(ctx.tenantId, input);
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

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const bundle = await getBundleById(ctx.tenantId, input.id);
      if (!bundle) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Bundle ${input.id} not found` });
      }
      return bundle;
    }),

  list: tenantProcedure
    .input(z.object({
      activeOnly: z.boolean().optional(),
    }).optional())
    .query(({ input, ctx }) => listBundles(ctx.tenantId, input ?? undefined)),

  updateMeta: tenantProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).nullable().optional(),
      category: z.string().optional(),
      bundleDiscount: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const before = await requireBundleInTenant(ctx.tenantId, id);
      const result = await updateBundleMeta(ctx.tenantId, id, data);
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

  addItem: tenantProcedure
    .input(z.object({
      bundleId: z.string().uuid(),
      assemblyId: z.string().uuid(),
      quantity: z.string().optional(),
      isOptional: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Parent bundle is authorized before the child is created.
      await requireBundleInTenant(ctx.tenantId, input.bundleId);
      const result = await addItemToBundle(ctx.tenantId, input);
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

  updateItemQuantity: tenantProcedure
    .input(z.object({
      bundleItemId: z.string().uuid(),
      quantity: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await requireBundleItemInTenant(ctx.tenantId, input.bundleItemId);
      const result = await updateBundleItemQuantity(ctx.tenantId, input.bundleItemId, input.quantity);
      logAudit({
        userId: ctx.user.id,
        action: "bundle.updateItemQuantity",
        tableName: "bundle_items",
        recordId: input.bundleItemId,
        before: { quantity: existing.quantity ?? null },
        after: result,
      });
      return result;
    }),

  removeItem: tenantProcedure
    .input(z.object({ bundleItemId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireBundleItemInTenant(ctx.tenantId, input.bundleItemId);
      const result = await removeBundleItem(ctx.tenantId, input.bundleItemId);
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

  duplicate: tenantProcedure
    .input(z.object({
      bundleId: z.string().uuid(),
      newName: z.string().min(1).max(255),
    }))
    .mutation(async ({ input, ctx }) => {
      // The source is authorized before any row is written; the copy is owned by
      // ctx.tenantId, never by the source's tenant.
      await requireBundleInTenant(ctx.tenantId, input.bundleId);
      const result = await duplicateBundle(ctx.tenantId, input.bundleId, input.newName);
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

  delete: tenantProcedure
    .input(z.object({ bundleId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const before = await requireBundleInTenant(ctx.tenantId, input.bundleId);
      await deleteBundle(ctx.tenantId, input.bundleId);
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
