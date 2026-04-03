/**
 * structr.ai v9 — Pricing tRPC Router
 * Sprint 6 Phase 5: Master Pricing Architecture
 *
 * Provides tRPC procedures for:
 *   - Price Book management (list, get, create, update, deactivate, history)
 *   - Regional modifiers (list, get, update)
 *   - Channel multipliers (list, get, update)
 *   - Finish levels (list, get, update)
 *   - Parametric models (list, get, calculate)
 *   - Templates (remodel + newcon)
 *   - Pricing calculation engine (applyDimensions, priceItems, parametric)
 *   - Price governance (validate, enforceMinGP)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "./_core/trpc";
import { logAudit } from "./audit";
import { normalizeTrade, normalizeServiceType, normalizeChannel, normalizeFinishLevel, normalizePbCategory } from "@shared/domain/normalization";
import {
  listPriceBookItems,
  getPriceBookItemById,
  getPriceBookItemBySku,
  getPriceBookItemsByIds,
  getPriceBookCategories,
  getPriceBookTrades,
  getPriceBookStats,
  updatePriceBookItem,
  createPriceBookItem,
  deactivatePriceBookItem,
  getPriceBookHistory,
  listRegionalModifiers,
  getRegionalModifier,
  updateRegionalModifier,
  listChannelMultipliers,
  getChannelMultiplier,
  updateChannelMultiplier,
  listFinishLevels,
  getFinishLevel,
  updateFinishLevel,
  listParametricModels,
  getParametricModel,
  getParametricModelByType,
  listRemodelTemplates,
  getRemodelTemplate,
  getRemodelTemplateByType,
  listNewconTemplates,
  getNewconTemplate,
  getNewconTemplateByType,
} from "./pricing-db";
import {
  applyPricingDimensions,
  priceLineItems,
  calculateParametricEstimate,
  validateParametricSqft,
  validatePriceGovernance,
  enforceMinGP,
  mergeDimensions,
  type PricingDimensions,
} from "@shared/pricing-engine";

// ── Shared Zod Schemas ──────────────────────────────────────────────

const pricingDimensionsSchema = z.object({
  wasteFactor: z.number().min(0.5).max(3.0).optional(),
  coastalModifier: z.number().min(0.5).max(3.0).optional(),
  channelCostMultiplier: z.number().min(0.1).max(5.0).optional(),
  channelPriceMultiplier: z.number().min(0.1).max(5.0).optional(),
  finishMultiplier: z.number().min(0.5).max(5.0).optional(),
  regionalCostModifier: z.number().min(0.5).max(3.0).optional(),
  regionalLaborModifier: z.number().min(0.5).max(3.0).optional(),
  regionalMaterialModifier: z.number().min(0.5).max(3.0).optional(),
}).optional();

const itemTypeEnum = z.enum(["material", "labor", "subcontract", "permit_fee", "equipment", "allowance"]);
const finishLevelEnum = z.enum(["standard", "premium", "luxury"]);
const channelEnum = z.enum(["direct", "insurance", "commercial"]);
const structureTypeEnum = z.enum(["adu", "one_story", "two_story", "two_story_terrace", "shell"]);

// ══════════════════════════════════════════════════════════════════════
// PRICING ROUTER
// ══════════════════════════════════════════════════════════════════════

export const pricingRouter = router({

  // ── Price Book Management ─────────────────────────────────────────

  priceBook: router({
    /** List price book items with filters and pagination */
    list: protectedProcedure
      .input(z.object({
        category: z.string().optional(),
        trade: z.string().optional(),
        itemType: z.string().optional(),
        finishLevel: z.string().optional(),
        channel: z.string().optional(),
        region: z.string().optional(),
        search: z.string().optional(),
        activeOnly: z.boolean().optional(),
        limit: z.number().min(1).max(500).optional(),
        offset: z.number().min(0).optional(),
      }).optional())
      .query(({ input }) => listPriceBookItems(input ?? undefined)),

    /** Get a single price book item by ID */
    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const item = await getPriceBookItemById(input.id);
        if (!item) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Price book item ${input.id} not found` });
        }
        return item;
      }),

    /** Get a single price book item by SKU */
    getBySku: protectedProcedure
      .input(z.object({ sku: z.string() }))
      .query(async ({ input }) => {
        const item = await getPriceBookItemBySku(input.sku);
        if (!item) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Price book item with SKU ${input.sku} not found` });
        }
        return item;
      }),

    /** Get multiple price book items by IDs */
    getByIds: protectedProcedure
      .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
      .query(({ input }) => getPriceBookItemsByIds(input.ids)),

    /** Get distinct categories with counts */
    categories: protectedProcedure.query(() => getPriceBookCategories()),

    /** Get distinct trades with counts */
    trades: protectedProcedure.query(() => getPriceBookTrades()),

    /** Get aggregate statistics */
    stats: protectedProcedure.query(() => getPriceBookStats()),

    /** Create a new price book item (admin only) */
    create: adminProcedure
      .input(z.object({
        uuid: z.string().length(36),
        sku: z.string().min(1).max(80),
        category: z.string().min(1).max(100),
        subcategory: z.string().max(100).optional(),
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        unitOfMeasure: z.string().min(1).max(30),
        unitCost: z.string(),
        unitPrice: z.string(),
        isAdminFee: z.boolean().optional(),
        itemType: itemTypeEnum.optional(),
        trade: z.string().max(80).optional(),
        finishLevel: finishLevelEnum.optional(),
        channel: channelEnum.optional(),
        region: z.string().max(80).optional(),
        wasteFactor: z.string().optional(),
        coastalModifier: z.string().optional(),
        channelMultiplier: z.string().optional(),
        source: z.string().max(80).optional(),
        costCode: z.string().max(16).optional(),
        costType: z.string().max(64).optional(),
        taxable: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Sprint 18.5: Normalize at router boundary
        const normalized = {
          ...input,
          ...(input.trade ? { trade: normalizeTrade(input.trade) ?? input.trade } : {}),
          ...(input.category ? { category: normalizePbCategory(input.category) ?? input.category } : {}),
          ...(input.finishLevel ? { finishLevel: (normalizeFinishLevel(input.finishLevel) ?? input.finishLevel) as any } : {}),
          ...(input.channel ? { channel: (normalizeChannel(input.channel) ?? input.channel) as any } : {}),
        };
        const item = await createPriceBookItem(normalized as any, ctx.user.id);
        // Audit logging handled in pricing-db.ts
        return item;
      }),

    /** Update a price book item (admin only, with history tracking) */
    update: adminProcedure
      .input(z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        unitCost: z.string().optional(),
        unitPrice: z.string().optional(),
        category: z.string().max(100).optional(),
        subcategory: z.string().max(100).optional(),
        unitOfMeasure: z.string().max(30).optional(),
        isAdminFee: z.boolean().optional(),
        isActive: z.boolean().optional(),
        itemType: itemTypeEnum.optional(),
        trade: z.string().max(80).optional(),
        finishLevel: finishLevelEnum.optional(),
        channel: channelEnum.optional(),
        region: z.string().max(80).optional(),
        wasteFactor: z.string().optional(),
        coastalModifier: z.string().optional(),
        channelMultiplier: z.string().optional(),
        source: z.string().max(80).optional(),
        costCode: z.string().max(16).optional(),
        costType: z.string().max(64).optional(),
        taxable: z.boolean().optional(),
        reason: z.string().max(255).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const before = await getPriceBookItemById(input.id);
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Price book item ${input.id} not found` });
        }

        const { id, reason, ...updateData } = input;
        // Sprint 18.5: Normalize at router boundary
        const normalizedUpdate = {
          ...updateData,
          ...(updateData.trade ? { trade: normalizeTrade(updateData.trade) ?? updateData.trade } : {}),
          ...(updateData.category ? { category: normalizePbCategory(updateData.category) ?? updateData.category } : {}),
          ...(updateData.finishLevel ? { finishLevel: (normalizeFinishLevel(updateData.finishLevel) ?? updateData.finishLevel) as any } : {}),
          ...(updateData.channel ? { channel: (normalizeChannel(updateData.channel) ?? updateData.channel) as any } : {}),
        };
        const updated = await updatePriceBookItem(id, normalizedUpdate as any, ctx.user.id);
        // Audit logging handled in pricing-db.ts
        return updated;
      }),

    /** Soft-delete a price book item (admin only) */
    deactivate: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const before = await getPriceBookItemById(input.id);
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Price book item ${input.id} not found` });
        }

        await deactivatePriceBookItem(input.id, ctx.user.id);

        return { success: true } as const;
      }),

    /** Get price history for an item */
    history: protectedProcedure
      .input(z.object({
        priceBookItemId: z.string().uuid(),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
      }))
      .query(({ input }) => getPriceBookHistory(input.priceBookItemId, input)),
  }),

  // ── Regional Modifiers ────────────────────────────────────────────

  regional: router({
    /** List all regional modifiers */
    list: protectedProcedure
      .input(z.object({ activeOnly: z.boolean().optional() }).optional())
      .query(({ input }) => listRegionalModifiers(input?.activeOnly)),

    /** Get a regional modifier by region code */
    get: protectedProcedure
      .input(z.object({ regionCode: z.string() }))
      .query(async ({ input }) => {
        const mod = await getRegionalModifier(input.regionCode);
        if (!mod) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Region ${input.regionCode} not found` });
        }
        return mod;
      }),

    /** Update a regional modifier (admin only) */
    update: adminProcedure
      .input(z.object({
        id: z.string().uuid(),
        regionName: z.string().max(160).optional(),
        costModifier: z.string().optional(),
        laborModifier: z.string().optional(),
        materialModifier: z.string().optional(),
        permitModifier: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const updated = await updateRegionalModifier(id, data as any);

        logAudit({
          userId: ctx.user.id,
          action: "pricing.regional.update",
          tableName: "regional_modifiers",
          recordId: id,
          before: null,
          after: updated,
        });

        return updated;
      }),
  }),

  // ── Channel Multipliers ───────────────────────────────────────────

  channel: router({
    /** List all channel multipliers */
    list: protectedProcedure
      .input(z.object({ activeOnly: z.boolean().optional() }).optional())
      .query(({ input }) => listChannelMultipliers(input?.activeOnly)),

    /** Get a channel multiplier (with trade-specific fallback) */
    get: protectedProcedure
      .input(z.object({
        channel: channelEnum,
        trade: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const normalizedTrade = normalizeTrade(input.trade) ?? input.trade;
        const mul = await getChannelMultiplier(input.channel);
        if (!mul) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Channel multiplier for ${input.channel} not found` });
        }
        return mul;
      }),

    /** Update a channel multiplier (admin only) */
    update: adminProcedure
      .input(z.object({
        id: z.string().uuid(),
        costMultiplier: z.string().optional(),
        priceMultiplier: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const updated = await updateChannelMultiplier(id, data as any);

        logAudit({
          userId: ctx.user.id,
          action: "pricing.channel.update",
          tableName: "channel_multipliers",
          recordId: id,
          before: null,
          after: updated,
        });

        return updated;
      }),
  }),

  // ── Finish Levels ─────────────────────────────────────────────────

  finish: router({
    /** List all finish levels */
    list: protectedProcedure
      .input(z.object({ activeOnly: z.boolean().optional() }).optional())
      .query(({ input }) => listFinishLevels(input?.activeOnly)),

    /** Get a finish level (with trade-specific fallback) */
    get: protectedProcedure
      .input(z.object({
        level: finishLevelEnum,
        trade: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const normalizedTrade = normalizeTrade(input.trade) ?? input.trade;
        const fl = await getFinishLevel(input.level, normalizedTrade);
        if (!fl) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Finish level ${input.level} not found` });
        }
        return fl;
      }),

    /** Update a finish level (admin only) */
    update: adminProcedure
      .input(z.object({
        id: z.string().uuid(),
        priceMultiplier: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const updated = await updateFinishLevel(id, data as any);

        logAudit({
          userId: ctx.user.id,
          action: "pricing.finish.update",
          tableName: "finish_levels",
          recordId: id,
          before: null,
          after: updated,
        });

        return updated;
      }),
  }),

  // ── Parametric Models ─────────────────────────────────────────────

  parametric: router({
    /** List all parametric models */
    list: protectedProcedure
      .input(z.object({ activeOnly: z.boolean().optional() }).optional())
      .query(({ input }) => listParametricModels(input?.activeOnly)),

    /** Get a parametric model by ID */
    getById: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const model = await getParametricModel(input.id);
        if (!model) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Parametric model ${input.id} not found` });
        }
        return model;
      }),

    /** Get a parametric model by structure type */
    getByType: protectedProcedure
      .input(z.object({ structureType: structureTypeEnum }))
      .query(async ({ input }) => {
        const model = await getParametricModelByType(input.structureType);
        if (!model) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Parametric model for ${input.structureType} not found` });
        }
        return model;
      }),

    /** Calculate a parametric estimate */
    calculate: protectedProcedure
      .input(z.object({
        modelId: z.string().uuid().optional(),
        structureType: structureTypeEnum.optional(),
        sqft: z.number().min(1).max(100000),
        dimensions: pricingDimensionsSchema,
      }))
      .query(async ({ input }) => {
        // Resolve model
        let model;
        if (input.modelId) {
          model = await getParametricModel(input.modelId);
        } else if (input.structureType) {
          model = await getParametricModelByType(input.structureType);
        }

        if (!model) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Parametric model not found. Provide modelId or structureType.",
          });
        }

        // Validate sqft
        const sqftValidation = validateParametricSqft(
          input.sqft,
          (model as any).minSqft ?? 400,
          (model as any).maxSqft ?? 5000
        );

        const estimate = calculateParametricEstimate({
          sqft: sqftValidation.corrected,
          baseCostPerSqft: parseFloat((model as any).baseCostPerSqft),
          basePricePerSqft: parseFloat((model as any).basePricePerSqft),
          complexityMultiplier: parseFloat((model as any).complexityMultiplier ?? "1.0000"),
          dimensions: input.dimensions ?? {},
        });

        return {
          ...estimate,
          modelId: model.id,
          modelName: model.name,
          structureType: (model as any).structureType,
          sqftValidation,
        };
      }),
  }),

  // ── Templates ─────────────────────────────────────────────────────

  templates: router({
    /** List remodel templates */
    remodelList: publicProcedure
      .input(z.object({ activeOnly: z.boolean().optional() }).optional())
      .query(({ input }) => listRemodelTemplates(input?.activeOnly)),

    /** Get a remodel template by ID */
    remodelGetById: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const template = await getRemodelTemplate(input.id);
        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Remodel template ${input.id} not found` });
        }
        return template;
      }),

    /** Get a remodel template by service type */
    remodelGetByType: publicProcedure
      .input(z.object({ serviceType: z.string() }))
      .query(async ({ input }) => {
        const normalizedServiceType = normalizeServiceType(input.serviceType) ?? input.serviceType;
        const template = await getRemodelTemplateByType(normalizedServiceType);
        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Remodel template for ${input.serviceType} not found` });
        }
        return template;
      }),

    /** List new construction templates */
    newconList: publicProcedure
      .input(z.object({ activeOnly: z.boolean().optional() }).optional())
      .query(({ input }) => listNewconTemplates(input?.activeOnly)),

    /** Get a new construction template by ID */
    newconGetById: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const template = await getNewconTemplate(input.id);
        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Newcon template ${input.id} not found` });
        }
        return template;
      }),

    /** Get a new construction template by structure type */
    newconGetByType: publicProcedure
      .input(z.object({ structureType: structureTypeEnum }))
      .query(async ({ input }) => {
        const template = await getNewconTemplateByType(input.structureType);
        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Newcon template for ${input.structureType} not found` });
        }
        return template;
      }),
  }),

  // ── Pricing Calculation Engine ────────────────────────────────────

  calculate: router({
    /** Apply pricing dimensions to a single item */
    applyDimensions: publicProcedure
      .input(z.object({
        unitCost: z.number(),
        unitPrice: z.number(),
        itemType: itemTypeEnum,
        dimensions: pricingDimensionsSchema,
      }))
      .query(({ input }) =>
        applyPricingDimensions(
          input.unitCost,
          input.unitPrice,
          input.itemType,
          input.dimensions ?? {}
        )
      ),

    /** Price multiple line items with shared dimensions */
    priceItems: publicProcedure
      .input(z.object({
        items: z.array(z.object({
          id: z.string().uuid(),
          name: z.string(),
          itemType: itemTypeEnum,
          unitCost: z.number(),
          unitPrice: z.number(),
          quantity: z.number().min(0),
          wasteFactor: z.number().optional(),
          coastalModifier: z.number().optional(),
        })).min(1).max(500),
        dimensions: pricingDimensionsSchema,
      }))
      .query(({ input }) =>
        priceLineItems(input.items, input.dimensions ?? {})
      ),

    /** Resolve pricing dimensions from database references */
    resolveDimensions: publicProcedure
      .input(z.object({
        regionCode: z.string().optional(),
        channel: channelEnum.optional(),
        trade: z.string().optional(),
        finishLevel: finishLevelEnum.optional(),
      }))
      .query(async ({ input }) => {
        const dims: Partial<PricingDimensions> = {};

        // Resolve regional modifiers
        if (input.regionCode) {
          const region = await getRegionalModifier(input.regionCode);
          if (region) {
            dims.regionalCostModifier = parseFloat(region.multiplier);
            dims.regionalLaborModifier = parseFloat(region.multiplier);
            dims.regionalMaterialModifier = parseFloat(region.multiplier);
          }
        }

        // Resolve channel multipliers (Sprint 18: normalize trade)
        const normalizedTrade = normalizeTrade(input.trade) ?? input.trade;
        if (input.channel) {
          const channelMul = await getChannelMultiplier(input.channel);
          if (channelMul) {
            dims.channelCostMultiplier = parseFloat(channelMul.multiplier);
            dims.channelPriceMultiplier = parseFloat(channelMul.multiplier);
          }
        }

        // Resolve finish level (Sprint 18.5: normalize finishLevel)
        const normalizedFinish = normalizeFinishLevel(input.finishLevel) ?? input.finishLevel;
        if (normalizedFinish) {
          const fl = await getFinishLevel(normalizedFinish, normalizedTrade);
          if (fl) {
            dims.finishMultiplier = parseFloat(fl.multiplier);
          }
        }

        return {
          resolved: dims,
          merged: mergeDimensions(dims),
        };
      }),
  }),

  // ── Price Governance ──────────────────────────────────────────────

  governance: router({
    /** Validate a price against governance rules */
    validate: publicProcedure
      .input(z.object({
        unitCost: z.number(),
        unitPrice: z.number(),
        minGrossProfitPct: z.number().optional(),
        maxMarkupPct: z.number().optional(),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
      }))
      .query(({ input }) =>
        validatePriceGovernance(input.unitCost, input.unitPrice, {
          minGrossProfitPct: input.minGrossProfitPct,
          maxMarkupPct: input.maxMarkupPct,
          minPrice: input.minPrice,
          maxPrice: input.maxPrice,
        })
      ),

    /** Enforce minimum GP on a price (Profit Shield at item level) */
    enforceMinGP: publicProcedure
      .input(z.object({
        unitCost: z.number(),
        unitPrice: z.number(),
        minGP: z.number().optional(),
      }))
      .query(({ input }) =>
        enforceMinGP(input.unitCost, input.unitPrice, input.minGP)
      ),
  }),
});
