import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { validateQuantity, transformBundleToEstimateDraft } from "@shared/catalog-utils";
import {
  getCatalogItems,
  getCatalogGroups,
  getCatalogItemById,
  getCatalogStats,
  createBundle,
  getBundleById,
  listBundles,
  updateBundleMeta,
  addItemToBundle,
  updateBundleItemQuantity,
  removeBundleItem,
  duplicateBundle,
  deleteBundle,
  recalculateBundleTotals,
  createPresetFromBundle,
  createBundleFromPreset,
  markBundleAsPreset,
  unmarkBundleAsPreset,
  createEstimateDraft,
  getEstimateDraftById,
  listEstimateDrafts,
} from "./db";
import { TRPCError } from "@trpc/server";
import { logAudit, listAuditLogs, getAuditLogById, withAuditLog } from "./audit";
import {
  getUserPermissions,
  hasPermission,
  listRoles,
  listPermissions,
  getRoleWithPermissions,
  assignRoleToUser,
  clearPermissionCache,
} from "./rbac";
import { pricingRouter } from "./pricing-router";
import { assemblyRouter } from "./assembly-router";
import { estimateRouter } from "./estimate-router";
import { clientRouter } from "./client-router";
import { projectRouter } from "./project-router";
import { intakeRouter } from "./intake-router";
import { geoRouter } from "./geo-router";
import { scopeRouter } from "./scope-router";
import { remodelRouter } from "./remodel-router";
import { scopeReviewRouter } from "./scope-review-router";
import { scopeGenerationRouter } from "./scope-generation-router";
import { geoOverrideRouter } from "./geo-override-router";
import { workflowVisualizationRouter } from "./workflow-visualization-router";
import { issueReportRouter } from "./issue-report-router";
import { fieldLaunchRouter } from "./field-launch-router";
import { learningLayerRouter } from "./learning-layer-router";

export const appRouter = router({
  geo: geoRouter,
  geoOverride: geoOverrideRouter,
  scope: scopeRouter,
  scopeReview: scopeReviewRouter,
  scopeGeneration: scopeGenerationRouter,
  remodel: remodelRouter,
  workflowViz: workflowVisualizationRouter,
  system: systemRouter,

  // ══════════════════════════════════════════════════════════
  // CLIENT DOMAIN (Sprint 10 — Operational Pre-Estimate)
  // ══════════════════════════════════════════════════════════
  clients: clientRouter,

  // ══════════════════════════════════════════════════════════
  // PROJECT DOMAIN (Sprint 10 — Operational Pre-Estimate)
  // ══════════════════════════════════════════════════════════
  project: projectRouter,

  // ══════════════════════════════════════════════════════════
  // INTAKE FORMS (Sprint 10 — Operational Pre-Estimate)
  // ══════════════════════════════════════════════════════════
  intake: intakeRouter,

  // ══════════════════════════════════════════════════════════
  // PRICING ENGINE (Sprint 6 — Master Pricing Architecture)
  // ══════════════════════════════════════════════════════════
  pricing: pricingRouter,

  // ══════════════════════════════════════════════════════════
  // ASSEMBLY LIBRARY (Sprint 7 — Remodel Scope)
  // ══════════════════════════════════════════════════════════
  assembly: assemblyRouter,

  // ══════════════════════════════════════════════════════════
  // ESTIMATE DRAFTS (Sprint 9 — Real Flow)
  // ══════════════════════════════════════════════════════════
  estimate: estimateRouter,

  // ══════════════════════════════════════════════════════════
  // ISSUE REPORTS (Sprint 20 — Field Launch Toolkit)
  // ══════════════════════════════════════════════════════════
  issueReport: issueReportRouter,

  // ══════════════════════════════════════════════════════════
  // FIELD LAUNCH CONTROL (Sprint 21)
  // ══════════════════════════════════════════════════════════
  fieldLaunch: fieldLaunchRouter,

  // ══════════════════════════════════════════════════════════
  // LEARNING LAYER (Sprint 22 — Analytics Pipeline)
  // ══════════════════════════════════════════════════════════
  learning: learningLayerRouter,

  auth: router({
    me: publicProcedure.query(async (opts) => {
      if (!opts.ctx.user) return null;
      // Enrich with permissions
      const perms = await getUserPermissions(opts.ctx.user.id);
      return {
        ...opts.ctx.user,
        permissions: Array.from(perms),
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ══════════════════════════════════════════════════════════════
  // CATALOG
  // ══════════════════════════════════════════════════════════════

  catalog: router({
    list: publicProcedure
      .input(
        z.object({
          costGroupName: z.string().optional(),
          search: z.string().optional(),
          costCode: z.string().optional(),
        }).optional()
      )
      .query(({ input }) => getCatalogItems(input ?? undefined)),

    groups: publicProcedure.query(() => getCatalogGroups()),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(({ input }) => getCatalogItemById(input.id)),

    stats: publicProcedure.query(() => getCatalogStats()),
  }),

  // ══════════════════════════════════════════════════════════════
  // BUNDLES (with audit logging)
  // ══════════════════════════════════════════════════════════════

  bundle: router({
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

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const bundle = await getBundleById(input.id);
        if (!bundle) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Bundle ${input.id} not found` });
        }
        return bundle;
      }),

    list: publicProcedure
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
        const result = await updateBundleItemQuantity(input.bundleItemId, validation.corrected);
        logAudit({
          userId: ctx.user.id,
          action: "bundle.updateItemQuantity",
          tableName: "bundle_items",
          recordId: input.bundleItemId,
          before: { quantity: input.quantity },
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
  }),

  // ══════════════════════════════════════════════════════════════
  // PRESETS (with audit logging)
  // ══════════════════════════════════════════════════════════════

  preset: router({
    list: publicProcedure
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
  }),

  // ══════════════════════════════════════════════════════════════
  // LEGACY ESTIMATES (Sprint 4 — Bundle-based, kept for backward compat)
  // ══════════════════════════════════════════════════════════════

  estimateLegacy: router({
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

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const draft = await getEstimateDraftById(input.id);
        if (!draft) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
        }
        return draft;
      }),

    list: publicProcedure
      .input(z.object({
        status: z.string().optional(),
      }).optional())
      .query(({ input }) => listEstimateDrafts(input ?? undefined)),
  }),

  // ══════════════════════════════════════════════════════════════
  // RBAC ADMIN (admin-only procedures)
  // ══════════════════════════════════════════════════════════════

  rbac: router({
    /** List all roles */
    listRoles: adminProcedure.query(() => listRoles()),

    /** List all permissions */
    listPermissions: adminProcedure.query(() => listPermissions()),

    /** Get role with its permissions */
    getRoleWithPermissions: adminProcedure
      .input(z.object({ roleId: z.number() }))
      .query(async ({ input }) => {
        const result = await getRoleWithPermissions(input.roleId);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Role ${input.roleId} not found` });
        }
        return result;
      }),

    /** Assign a role to a user */
    assignRole: adminProcedure
      .input(z.object({
        userId: z.number(),
        roleId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        await assignRoleToUser(input.userId, input.roleId);
        logAudit({
          userId: ctx.user.id,
          action: "rbac.assignRole",
          tableName: "users",
          recordId: input.userId,
          before: null,
          after: { roleId: input.roleId },
        });
        return { success: true } as const;
      }),

    /** Get current user's permissions */
    myPermissions: protectedProcedure.query(async ({ ctx }) => {
      const perms = await getUserPermissions(ctx.user.id);
      return Array.from(perms);
    }),

    /** Check if current user has a specific permission */
    checkPermission: protectedProcedure
      .input(z.object({
        resource: z.string(),
        action: z.string(),
      }))
      .query(async ({ input, ctx }) => {
        const allowed = await hasPermission(ctx.user.id, input.resource, input.action);
        return { allowed };
      }),
  }),

  // ══════════════════════════════════════════════════════════════
  // AUDIT LOGS (admin-only read access)
  // ══════════════════════════════════════════════════════════════

  audit: router({
    /** List audit logs with filters and pagination */
    list: adminProcedure
      .input(z.object({
        userId: z.number().optional(),
        tableName: z.string().optional(),
        action: z.string().optional(),
        recordId: z.number().optional(),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
      }).optional())
      .query(({ input }) => listAuditLogs(input ?? undefined)),

    /** Get a single audit log entry by ID */
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const log = await getAuditLogById(input.id);
        if (!log) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Audit log ${input.id} not found` });
        }
        return log;
      }),
  }),
});

export type AppRouter = typeof appRouter;
