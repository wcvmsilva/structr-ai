/**
 * structr.ai v9 — Assembly tRPC Router
 * Sprint 7: Assembly Library — Remodel Scope
 *
 * Provides tRPC procedures for:
 *   - Assembly CRUD (list, get, create, update, delete)
 *   - Component management (add, remove)
 *   - Clone support
 *   - Cost calculation with pricing dimensions
 *   - Stats and category/trade listing
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "./_core/trpc";
import {
  listAssemblies,
  getAssemblyById,
  getAssembliesByTrade,
  getAssembliesByCategory,
  createAssembly,
  updateAssembly,
  deleteAssembly,
  cloneAssembly,
  addComponentToAssembly,
  removeComponentFromAssembly,
  getAssemblyCategories,
  getAssemblyTrades,
  getAssemblyStats,
} from "./assembly-db";
import {
  calculateAssemblyCost,
  calculateAssemblyCostWithProfitShield,
  calculateMultipleAssemblies,
  type AssemblyComponentInput,
} from "@shared/assembly-engine";
import { normalizeCategory, normalizeTrade, normalizeChannel, normalizeFinishLevel } from "@shared/domain/normalization";
import { resolvePricingDimensions, toPricingEngineDimensions } from "./pricing-dimensions";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// ZODS
// ══════════════════════════════════════════════════════════════════════

const assemblyFilterSchema = z.object({
  trade: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  finishLevel: z.enum(["standard", "premium", "luxury"]).optional(),
  region: z.string().optional(),
  assemblyType: z.enum(["scope", "system", "package", "parametric"]).optional(),
  activeOnly: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(500).optional(),
  offset: z.number().min(0).optional(),
}).optional();

const createAssemblySchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(32),
  trade: z.string().max(80).optional(),
  category: z.string().max(128).optional(),
  subcategory: z.string().max(128).optional(),
  description: z.string().optional(),
  defaultUnit: z.string().max(16).optional(),
  unitOfMeasure: z.string().max(30).optional(),
  directCost: z.string().default("0.00"),
  sellPrice: z.string().default("0.00"),
  crewHours: z.string().optional(),
  assemblyType: z.enum(["scope", "system", "package", "parametric"]).optional(),
  finishLevel: z.enum(["standard", "premium", "luxury"]).optional(),
  region: z.string().max(80).optional(),
  coastalModifier: z.string().optional(),
  tradeSequenceOrder: z.number().int().optional(),
  inclusions: z.string().optional(),
  exclusions: z.string().optional(),
  hiddenConditionFlag: z.boolean().optional(),
  isPreset: z.boolean().optional(),
  notes: z.string().optional(),
});

const updateAssemblySchema = z.object({
  id: z.number(),
  name: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(32).optional(),
  trade: z.string().max(80).optional(),
  category: z.string().max(128).optional(),
  subcategory: z.string().max(128).optional(),
  description: z.string().optional(),
  defaultUnit: z.string().max(16).optional(),
  unitOfMeasure: z.string().max(30).optional(),
  directCost: z.string().optional(),
  sellPrice: z.string().optional(),
  crewHours: z.string().optional(),
  assemblyType: z.enum(["scope", "system", "package", "parametric"]).optional(),
  finishLevel: z.enum(["standard", "premium", "luxury"]).optional(),
  region: z.string().max(80).optional(),
  coastalModifier: z.string().optional(),
  tradeSequenceOrder: z.number().int().optional(),
  inclusions: z.string().optional(),
  exclusions: z.string().optional(),
  hiddenConditionFlag: z.boolean().optional(),
  isPreset: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});

const addComponentSchema = z.object({
  assemblyId: z.number(),
  priceBookItemId: z.number().optional(),
  catalogItemId: z.number().optional(),
  componentType: z.enum(["material", "labor", "subcontract", "equipment", "permit", "admin"]).optional(),
  description: z.string().max(255).optional(),
  quantity: z.string().default("1.0000"),
  unit: z.string().max(30).optional(),
  wasteFactorPct: z.string().optional(),
  unitCostOverride: z.string().optional(),
  notes: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const geoDimensionsSchema = z.object({
  regionalLaborModifier: z.number().optional(),
  regionalMaterialModifier: z.number().optional(),
  regionalCostModifier: z.number().optional(),
  coastalModifier: z.number().optional(),
}).optional();

const calculateCostSchema = z.object({
  assemblyId: z.number(),
  region: z.string().optional(),
  channel: z.enum(["direct", "insurance", "commercial"]).optional(),
  finishLevel: z.enum(["standard", "premium", "luxury"]).optional(),
  enforceProfitShield: z.boolean().optional(),
  geoDimensions: geoDimensionsSchema,
});

const calculateBatchSchema = z.object({
  assemblies: z.array(z.object({
    assemblyId: z.number(),
    quantity: z.number().min(0.01).default(1),
  })),
  region: z.string().optional(),
  channel: z.enum(["direct", "insurance", "commercial"]).optional(),
  finishLevel: z.enum(["standard", "premium", "luxury"]).optional(),
  geoDimensions: geoDimensionsSchema,
});

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const assemblyRouter = router({
  // ─── LIST ─────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(assemblyFilterSchema)
    .query(async ({ input }) => {
      return listAssemblies(input ?? undefined);
    }),

  // ─── GET BY ID ────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const assembly = await getAssemblyById(input.id);
      if (!assembly) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Assembly ${input.id} not found` });
      }
      return assembly;
    }),

  // ─── GET BY TRADE ─────────────────────────────────────────────────
  getByTrade: protectedProcedure
    .input(z.object({ trade: z.string() }))
    .query(async ({ input }) => {
      return getAssembliesByTrade(input.trade);
    }),

  // ─── GET BY CATEGORY ──────────────────────────────────────────────
  getByCategory: protectedProcedure
    .input(z.object({ category: z.string() }))
    .query(async ({ input }) => {
      return getAssembliesByCategory(input.category);
    }),

  // ─── CREATE (admin only) ──────────────────────────────────────────
  create: adminProcedure
    .input(createAssemblySchema)
    .mutation(async ({ input, ctx }) => {
      const assembly = await createAssembly({
        ...input,
        trade: normalizeTrade(input.trade) ?? input.trade,
        category: normalizeCategory(input.category) ?? input.category,
        finishLevel: (normalizeFinishLevel(input.finishLevel) ?? input.finishLevel) as any,
        createdBy: ctx.user.id,
      });
      // Audit logging handled in assembly-db.ts
      return assembly;
    }),

  // ─── UPDATE (admin only) ──────────────────────────────────────────
  update: adminProcedure
    .input(updateAssemblySchema)
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;

      const before = await getAssemblyById(id);
      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Assembly ${id} not found` });
      }

      const normalized: Record<string, any> = { ...data };
      if (data.trade !== undefined) normalized.trade = normalizeTrade(data.trade) ?? data.trade;
      if (data.category !== undefined) normalized.category = normalizeCategory(data.category) ?? data.category;
      if (data.finishLevel !== undefined) normalized.finishLevel = (normalizeFinishLevel(data.finishLevel) ?? data.finishLevel) as any;

      const assembly = await updateAssembly(id, normalized);
      // Audit logging handled in assembly-db.ts
      return assembly;
    }),

  // ─── DELETE (soft, admin only) ─────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const before = await getAssemblyById(input.id);
      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Assembly ${input.id} not found` });
      }

      await deleteAssembly(input.id);
      // Audit logging handled in assembly-db.ts
      return { success: true };
    }),

  // ─── CLONE (admin only) ───────────────────────────────────────────
  clone: adminProcedure
    .input(z.object({
      sourceId: z.number(),
      name: z.string().min(1).max(255).optional(),
      code: z.string().min(1).max(32).optional(),
      finishLevel: z.enum(["standard", "premium", "luxury"]).optional(),
      region: z.string().max(80).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { sourceId, ...overrides } = input;

      const cloned = await cloneAssembly(sourceId, overrides);
      // Audit logging handled in assembly-db.ts
      return cloned;
    }),

  // ─── ADD COMPONENT (admin only) ────────────────────────────────────
  addComponent: adminProcedure
    .input(addComponentSchema)
    .mutation(async ({ input, ctx }) => {
      const assembly = await getAssemblyById(input.assemblyId);
      if (!assembly) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Assembly ${input.assemblyId} not found` });
      }

      const component = await addComponentToAssembly(input);
      // Audit logging handled in assembly-db.ts
      return component;
    }),

  // ─── REMOVE COMPONENT (admin only) ─────────────────────────────────
  removeComponent: adminProcedure
    .input(z.object({ componentId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await removeComponentFromAssembly(input.componentId);
      // Audit logging handled in assembly-db.ts
      return { success: true };
    }),

  // ─── CALCULATE ASSEMBLY COST ──────────────────────────────────────
  calculateCost: protectedProcedure
    .input(calculateCostSchema)
    .query(async ({ input }) => {
      const assembly = await getAssemblyById(input.assemblyId);
      if (!assembly) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Assembly ${input.assemblyId} not found` });
      }

      // Map DB components to engine input format
      const componentInputs: AssemblyComponentInput[] = assembly.components.map(c => ({
        id: c.id,
        componentType: (c.componentType ?? "material") as any,
        description: c.description,
        quantity: c.quantity,
        unit: c.unit,
        wasteFactorPct: c.wasteFactorPct,
        unitCostOverride: c.unitCostOverride,
        priceBookItem: c.priceBookItem ? {
          id: c.priceBookItem.id,
          name: c.priceBookItem.name,
          unitCost: c.priceBookItem.unitCost,
          unitPrice: c.priceBookItem.unitPrice,
          wasteFactor: c.priceBookItem.wasteFactor,
          coastalModifier: c.priceBookItem.coastalModifier,
          itemType: c.priceBookItem.itemType,
        } : null,
      }));

      // Sprint 18.5: Normalize at router boundary
      const normChannel = normalizeChannel(input.channel) ?? input.channel ?? null;
      const normFinish = normalizeFinishLevel(input.finishLevel) ?? input.finishLevel ?? null;

      // Sprint 18.5: Audit normalization if values changed
      if ((input.channel && normChannel !== input.channel) || (input.finishLevel && normFinish !== input.finishLevel)) {
        logAudit({
          action: "router_normalization_applied",
          tableName: "assembly_router.calculateCost",
          before: { channel: input.channel, finishLevel: input.finishLevel },
          after: { channel: normChannel, finishLevel: normFinish },
        }).catch(() => {});
      }

      // Sprint 18: DB-driven multiplier resolution (replaces hardcoded values)
      const resolved = await resolvePricingDimensions({
        channel: normChannel,
        finishLevel: normFinish,
        region: assembly.region ?? input.region ?? null,
        trade: assembly.trade ?? null,
      });

      const context = {
        assemblyId: assembly.id,
        assemblyName: assembly.name,
        coastalModifier: assembly.coastalModifier,
        finishLevel: assembly.finishLevel ?? normFinish,
        region: assembly.region ?? input.region ?? null,
        dimensions: toPricingEngineDimensions(resolved, input.geoDimensions ?? undefined),
      };

      if (input.enforceProfitShield) {
        return calculateAssemblyCostWithProfitShield(componentInputs, context);
      }

      return calculateAssemblyCost(componentInputs, context);
    }),

  // ─── BATCH CALCULATE ──────────────────────────────────────────────
  calculateBatch: protectedProcedure
    .input(calculateBatchSchema)
    .query(async ({ input }) => {
      const assemblyInputs = [];

      for (const item of input.assemblies) {
        const assembly = await getAssemblyById(item.assemblyId);
        if (!assembly) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Assembly ${item.assemblyId} not found`,
          });
        }

        const componentInputs: AssemblyComponentInput[] = assembly.components.map(c => ({
          id: c.id,
          componentType: (c.componentType ?? "material") as any,
          description: c.description,
          quantity: c.quantity,
          unit: c.unit,
          wasteFactorPct: c.wasteFactorPct,
          unitCostOverride: c.unitCostOverride,
          priceBookItem: c.priceBookItem ? {
            id: c.priceBookItem.id,
            name: c.priceBookItem.name,
            unitCost: c.priceBookItem.unitCost,
            unitPrice: c.priceBookItem.unitPrice,
            wasteFactor: c.priceBookItem.wasteFactor,
            coastalModifier: c.priceBookItem.coastalModifier,
            itemType: c.priceBookItem.itemType,
          } : null,
        }));

        // Sprint 18.5: Normalize at router boundary (batch)
        const batchNormChannel = normalizeChannel(input.channel) ?? input.channel ?? null;
        const batchNormFinish = normalizeFinishLevel(input.finishLevel) ?? input.finishLevel ?? null;

        // Sprint 18: DB-driven multiplier resolution (replaces hardcoded values)
        const resolved = await resolvePricingDimensions({
          channel: batchNormChannel,
          finishLevel: batchNormFinish,
          region: assembly.region ?? input.region ?? null,
          trade: assembly.trade ?? null,
        });

        assemblyInputs.push({
          components: componentInputs,
          context: {
            assemblyId: assembly.id,
            assemblyName: assembly.name,
            coastalModifier: assembly.coastalModifier,
            finishLevel: assembly.finishLevel ?? batchNormFinish,
            region: assembly.region ?? input.region ?? null,
            dimensions: toPricingEngineDimensions(resolved, input.geoDimensions ?? undefined),
          },
          quantity: item.quantity,
        });
      }

      return calculateMultipleAssemblies(assemblyInputs);
    }),

  // ─── CATEGORIES ───────────────────────────────────────────────────
  categories: protectedProcedure.query(async () => {
    return getAssemblyCategories();
  }),

  // ─── TRADES ───────────────────────────────────────────────────────
  trades: protectedProcedure.query(async () => {
    return getAssemblyTrades();
  }),

  // ─── STATS ────────────────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    return getAssemblyStats();
  }),
});
