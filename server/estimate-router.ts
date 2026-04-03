/**
 * structr.ai v9 — Estimate Draft tRPC Router
 * Sprint 9: Estimate Draft Real Flow
 *
 * Provides tRPC procedures for:
 *   - createFromCalculator: persist a draft from Bundle Calculator output
 *   - getById: fetch a single draft with all fields
 *   - list: paginated list with filters (status, source, region)
 *   - updateStatus: status transitions with validation
 *   - updateNotes: edit notes on a draft
 *   - applyDiscount: apply discount percentage
 *   - archive: soft-delete a draft
 *   - stats: summary statistics
 *   - validate: pre-flight validation before creation
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "./_core/trpc";
import {
  createEstimateDraftFromCalculator,
  getEstimateDraftFull,
  listEstimateDraftsPaginated,
  updateEstimateDraftStatus,
  updateEstimateDraftNotes,
  applyEstimateDraftDiscount,
  archiveEstimateDraft,
  approveEstimateDraft,
  rejectEstimateDraft,
  getEstimateDraftStats,
} from "./estimate-db";
import {
  validateEstimateDraftInputs,
  transformBatchToEstimateDraft,
  type BatchCalculationResult,
  type EstimateDraftContext,
  type AssemblyMetadata,
} from "@shared/estimate-engine";
import {
  calculateMultipleAssemblies,
  type AssemblyComponentInput,
} from "@shared/assembly-engine";
import { getAssemblyById } from "./assembly-db";
import { getClientById } from "./client-db";
import { getProjectById } from "./project-db";
import { resolvePricingDimensions, toPricingEngineDimensions } from "./pricing-dimensions";
import { normalizeChannel, normalizeFinishLevel, normalizeTrade } from "@shared/domain/normalization";
import { executeScopeToEstimatePipeline, PipelineError } from "./scope-to-estimate-pipeline";
import {
  createPartialDraft,
  listPartialDrafts,
  getPartialDraftById,
  markPartialDraftRetrying,
  markPartialDraftRecovered,
  abandonPartialDraft,
  getPartialDraftStats,
} from "./draft-recovery-db";
import { generatePdfExport, generateJsonExport, generatePrintableExport } from "./estimate-export";
import { generateJobTreadCsvExport, generateCsvString, validateCsvExport, generateCsvRows } from "./jobtread-csv-export";
import { storagePut } from "./storage";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const assemblySelectionSchema = z.object({
  assemblyId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
});

const contextSchema = z.object({
  region: z.string().min(1, "Region is required"),
  channel: z.enum(["direct", "insurance", "commercial"]),
  finishLevel: z.enum(["standard", "premium", "luxury"]),
  projectId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  draftName: z.string().max(255).optional(),
});

const createFromCalculatorSchema = z.object({
  selections: z.array(assemblySelectionSchema).min(1, "At least one assembly required").max(25),
  context: contextSchema,
});

const listSchema = z.object({
  status: z.enum(["draft", "sent_to_estimate", "converted", "archived", "approved", "rejected"]).optional(),
  source: z.enum(["legacy_bundle", "assembly_calculator", "scope_draft"]).optional(),
  region: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "sent_to_estimate", "converted", "archived", "approved", "rejected"]),
});

const notesSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().max(5000).nullable(),
});

const discountSchema = z.object({
  id: z.string().uuid(),
  discountPct: z.number().min(0).max(50),
});

const validateSchema = z.object({
  selections: z.array(assemblySelectionSchema).min(1),
  context: contextSchema.partial(),
});

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const estimateRouter = router({
  /**
   * Create an estimate draft from the Bundle Calculator.
   * 1. Fetches assemblies + components from DB
   * 2. Runs calculateMultipleAssemblies (assembly-engine)
   * 3. Validates (estimate-engine)
   * 4. Transforms to persist payload (estimate-engine)
   * 5. Persists to DB with audit (estimate-db)
   */
  createFromCalculator: protectedProcedure
    .input(createFromCalculatorSchema)
    .mutation(async ({ input, ctx }) => {
      const { selections, context } = input;

      // 0. Validate project/client references if provided
      if (context.projectId) {
        const project = await getProjectById(context.projectId);
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Project ${context.projectId} not found`,
          });
        }
        if (project.deletedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Project ${context.projectId} has been deleted`,
          });
        }
      }
      if (context.clientId) {
        const client = await getClientById(context.clientId);
        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Client ${context.clientId} not found`,
          });
        }
        if (client.deletedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Client ${context.clientId} has been deleted`,
          });
        }
      }

      // 1. Fetch assemblies with components from DB
      const assemblyDataList: Array<{
        assembly: NonNullable<Awaited<ReturnType<typeof getAssemblyById>>>;
        quantity: number;
      }> = [];

      for (const sel of selections) {
        const assembly = await getAssemblyById(sel.assemblyId);
        if (!assembly) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Assembly ${sel.assemblyId} not found`,
          });
        }
        if (!assembly.isActive) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Assembly ${assembly.name} is inactive`,
          });
        }
        assemblyDataList.push({ assembly, quantity: sel.quantity });
      }

      // Sprint 18: Normalize inputs at router boundary
      const normalizedChannel = (normalizeChannel(context.channel) ?? context.channel) as "direct" | "insurance" | "commercial";
      const normalizedFinish = (normalizeFinishLevel(context.finishLevel) ?? context.finishLevel) as "standard" | "premium" | "luxury";

      // 2. Build inputs for calculateMultipleAssemblies
      const calcInputs = [];
      for (const { assembly, quantity } of assemblyDataList) {
        const components: AssemblyComponentInput[] = (assembly.components ?? []).map((comp: any) => ({
          id: comp.id,
          componentType: comp.componentType ?? "material",
          description: comp.description,
          quantity: comp.quantity,
          unit: comp.unit,
          wasteFactorPct: comp.wasteFactor,
          unitCostOverride: comp.unitCostOverride,
          priceBookItem: comp.priceBookItem
            ? {
                id: comp.priceBookItem.id,
                name: comp.priceBookItem.name,
                unitCost: comp.priceBookItem.unitCost,
                unitPrice: comp.priceBookItem.unitPrice,
                wasteFactor: comp.priceBookItem.wasteFactor,
                coastalModifier: comp.priceBookItem.coastalModifier,
                itemType: comp.priceBookItem.itemType,
              }
            : null,
        }));

        // Sprint 18: DB-driven multiplier resolution (replaces hardcoded values)
        const resolved = await resolvePricingDimensions({
          channel: normalizedChannel,
          finishLevel: normalizedFinish,
          region: assembly.region ?? context.region,
          trade: assembly.trade ?? null,
        }, { userId: ctx.user.id, projectId: context.projectId ?? undefined });

        calcInputs.push({
          components,
          context: {
            assemblyId: assembly.id,
            assemblyName: assembly.name,
            coastalModifier: assembly.coastalModifier,
            finishLevel: assembly.finishLevel ?? context.finishLevel,
            region: assembly.region ?? context.region,
            dimensions: toPricingEngineDimensions(resolved),
          },
          quantity,
        });
      }

      // 3. Calculate
      const batchResult = calculateMultipleAssemblies(calcInputs);

      // 4. Validate
      const errors = validateEstimateDraftInputs(batchResult, context);
      // Filter out profitShield errors — we allow creation but flag it
      const blockingErrors = errors.filter(
        (e) => e.field !== "profitShield"
      );
      if (blockingErrors.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Validation failed: ${blockingErrors.map((e) => e.message).join("; ")}`,
        });
      }

      // 5. Build assembly metadata map
      const assemblyMetadata = new Map<string, AssemblyMetadata>();
      for (const { assembly } of assemblyDataList) {
        assemblyMetadata.set(assembly.id, {
          id: assembly.id,
          code: assembly.code ?? `ASM-${assembly.id}`,
          category: assembly.category ?? "General",
          trade: assembly.trade ?? "General",
        });
      }

      // 6. Transform to persist payload
      const payload = transformBatchToEstimateDraft(
        batchResult,
        context,
        assemblyMetadata
      );

      // 7. Persist
      const draft = await createEstimateDraftFromCalculator(
        payload,
        ctx.user.id
      );

      // Sprint 20: Operational logging — estimate_generated
      await logAudit({
        userId: ctx.user.id,
        action: "estimate_generated",
        tableName: "estimate_drafts",
        recordId: draft.id,
        after: {
          source: "calculator",
          bundleName: draft.bundleName,
          assemblyCount: batchResult.assemblies.length,
          totalCost: batchResult.totalCost,
          totalPrice: batchResult.totalPrice,
          grossProfitPct: batchResult.grossProfitPct,
          meetsMinGP: batchResult.meetsMinGP,
          pricingSchemaVersion: draft.pricingSchemaVersion,
          channel: normalizedChannel,
          finishLevel: normalizedFinish,
          region: context.region,
        },
      }).catch((err) => console.error("[Audit] estimate-router:", err.message)); // non-blocking

      return {
        draft,
        warnings: errors.filter((e) => e.field === "profitShield"),
        batchSummary: {
          totalCost: batchResult.totalCost,
          totalPrice: batchResult.totalPrice,
          grossProfitPct: batchResult.grossProfitPct,
          meetsMinGP: batchResult.meetsMinGP,
          assemblyCount: batchResult.assemblies.length,
        },
      };
    }),

  /**
   * Get a single estimate draft by ID.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Estimate draft ${input.id} not found`,
        });
      }
      // Sprint 20: Operational logging — estimate_viewed
      await logAudit({
        userId: ctx.user.id,
        action: "estimate_viewed",
        tableName: "estimate_drafts",
        recordId: draft.id,
        after: {
          bundleName: draft.bundleName,
          status: draft.status,
          source: draft.source,
          pricingSchemaVersion: draft.pricingSchemaVersion,
        },
      }).catch((err) => console.error("[Audit] estimate-router:", err.message)); // non-blocking
      return draft;
    }),

  /**
   * List estimate drafts with pagination and filters.
   */
  list: protectedProcedure
    .input(listSchema.optional())
    .query(async ({ input, ctx }) => {
      return listEstimateDraftsPaginated({
        createdBy: ctx.user.role === "admin" ? undefined : ctx.user.id,
        status: input?.status,
        source: input?.source,
        region: input?.region,
        limit: input?.limit,
        offset: input?.offset,
      });
    }),

  /**
   * Update the status of an estimate draft.
   */
  updateStatus: protectedProcedure
    .input(statusSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await updateEstimateDraftStatus(
          input.id,
          input.status,
          ctx.user.id
        );
      } catch (err: any) {
        if (err.message?.includes("Invalid status transition")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Sprint 20: Approve an estimate draft (Quick Action).
   * Transitions to "approved" status and records approver info.
   */
  approveEstimate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await approveEstimateDraft(input.id, ctx.user.id);
      } catch (err: any) {
        if (err.message?.includes("Invalid status transition") || err.message?.includes("not found")) {
          throw new TRPCError({
            code: err.message.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Sprint 20: Reject an estimate draft with a reason (Quick Action).
   * Transitions to "rejected" status and records rejection reason.
   */
  rejectEstimate: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(5, "Rejection reason must be at least 5 characters").max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await rejectEstimateDraft(input.id, ctx.user.id, input.reason);
      } catch (err: any) {
        if (err.message?.includes("Invalid status transition") || err.message?.includes("not found")) {
          throw new TRPCError({
            code: err.message.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Update notes on an estimate draft.
   */
  updateNotes: protectedProcedure
    .input(notesSchema)
    .mutation(async ({ input, ctx }) => {
      return updateEstimateDraftNotes(input.id, input.notes, ctx.user.id);
    }),

  /**
   * Apply a discount percentage to an estimate draft.
   */
  applyDiscount: protectedProcedure
    .input(discountSchema)
    .mutation(async ({ input, ctx }) => {
      return applyEstimateDraftDiscount(
        input.id,
        input.discountPct,
        ctx.user.id
      );
    }),

  /**
   * Archive (soft-delete) an estimate draft.
   */
  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return archiveEstimateDraft(input.id, ctx.user.id);
    }),

  /**
   * Get estimate draft statistics.
   */
  stats: protectedProcedure.query(async () => {
    return getEstimateDraftStats();
  }),

  /**
   * Pre-flight validation — check inputs before creating a draft.
   * Returns validation errors without persisting anything.
   */
  validate: protectedProcedure
    .input(validateSchema)
    .query(async ({ input }) => {
      const { selections, context } = input;

      // Fetch assemblies to check they exist and are active
      const assemblyErrors: Array<{ field: string; message: string }> = [];
      for (const sel of selections) {
        const assembly = await getAssemblyById(sel.assemblyId);
        if (!assembly) {
          assemblyErrors.push({
            field: "assemblies",
            message: `Assembly ${sel.assemblyId} not found`,
          });
        } else if (!assembly.isActive) {
          assemblyErrors.push({
            field: "assemblies",
            message: `Assembly ${assembly.name} is inactive`,
          });
        }
      }

      // Build a mock batch result for validation (without full calculation)
      const mockBatch: BatchCalculationResult = {
        assemblies: selections.map((s) => ({
          assemblyId: s.assemblyId,
          assemblyName: `Assembly ${s.assemblyId}`,
          pricedComponents: [],
          costBreakdown: {
            materialCost: 0,
            laborCost: 0,
            subcontractCost: 0,
            equipmentCost: 0,
            permitCost: 0,
            adminCost: 0,
          },
          priceBreakdown: {
            materialCost: 0,
            laborCost: 0,
            subcontractCost: 0,
            equipmentCost: 0,
            permitCost: 0,
            adminCost: 0,
          },
          totalDirectCost: 0,
          totalSellPrice: 0,
          grossProfit: 0,
          grossProfitPct: 50, // placeholder — real calc not done
          meetsMinGP: true,
          dimensionsApplied: {} as any,
          componentCount: 1, // assume at least 1 for validation
          warnings: [],
          quantity: s.quantity,
          extendedCost: 0,
          extendedPrice: 0,
        })),
        totalCost: 0,
        totalPrice: 0,
        grossProfit: 0,
        grossProfitPct: 50, // placeholder
        meetsMinGP: true,
      };

      const validationErrors = validateEstimateDraftInputs(
        mockBatch,
        context
      );

      return {
        valid: assemblyErrors.length === 0 && validationErrors.length === 0,
        errors: [...assemblyErrors, ...validationErrors],
      };
    }),

  /**
   * Sprint 18: Create estimate draft from an approved scope draft.
   * Executes the full Scope → Estimate pipeline.
   * Idempotent: returns existing draft if one already exists for this scope draft.
   */
  createFromScopeDraft: protectedProcedure
    .input(
      z.object({
        scopeDraftId: z.string().uuid(),
        channelOverride: z.enum(["direct", "insurance", "commercial"]).nullish(),
        finishLevelOverride: z.enum(["standard", "premium", "luxury"]).nullish(),
        regionOverride: z.string().nullish(),
        draftName: z.string().nullish(),
        notes: z.string().nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Sprint 18.5: Normalize overrides at router boundary
      const normChannelOverride = input.channelOverride
        ? (normalizeChannel(input.channelOverride) ?? input.channelOverride) as "direct" | "insurance" | "commercial"
        : null;
      const normFinishOverride = input.finishLevelOverride
        ? (normalizeFinishLevel(input.finishLevelOverride) ?? input.finishLevelOverride) as "standard" | "premium" | "luxury"
        : null;

      try {
        const result = await executeScopeToEstimatePipeline(
          {
            scopeDraftId: input.scopeDraftId,
            channelOverride: normChannelOverride,
            finishLevelOverride: normFinishOverride,
            regionOverride: input.regionOverride ?? null,
            draftName: input.draftName ?? null,
            notes: input.notes ?? null,
          },
          ctx.user.id
        );

        return result;
      } catch (err) {
        // Sprint 20: Auto-save partial draft on pipeline failure
        if (err instanceof PipelineError) {
          // Non-blocking: save partial draft for recovery
          createPartialDraft({
            scopeDraftId: input.scopeDraftId,
            userId: ctx.user.id,
            failedStep: err.step,
            errorCode: err.code,
            errorMessage: err.message,
            partialPayload: err.details,
            contextSnapshot: {
              channelOverride: normChannelOverride,
              finishLevelOverride: normFinishOverride,
              regionOverride: input.regionOverride,
              draftName: input.draftName,
              notes: input.notes,
            },
          }).catch((saveErr) => {
            console.error("[Pipeline] Failed to save partial draft:", saveErr);
          });

          // Sprint 19: Map PipelineError to TRPCError for transport
          const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR"> = {
            SCOPE_DRAFT_NOT_FOUND: "NOT_FOUND",
            SCOPE_DRAFT_INVALID_STATUS: "BAD_REQUEST",
            NO_EFFECTIVE_ITEMS: "BAD_REQUEST",
            ASSEMBLIES_NOT_FOUND: "NOT_FOUND",
            NO_ACTIVE_ASSEMBLIES: "BAD_REQUEST",
            ESTIMATE_VALIDATION_FAILED: "BAD_REQUEST",
            PERSIST_FAILED: "INTERNAL_SERVER_ERROR",
          };
          throw new TRPCError({
            code: codeMap[err.code] ?? "INTERNAL_SERVER_ERROR",
            message: `[${err.code}] ${err.message}`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  // ══════════════════════════════════════════════════════════════════════
  // Sprint 20: Estimate Export (PDF, JSON, Printable)
  // ══════════════════════════════════════════════════════════════════════

  exportPdf: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      const pdfBuffer = generatePdfExport(draft, ctx.user.id);
      const fileKey = `exports/estimates/EST-${String(draft.id).padStart(5, "0")}-${Date.now()}.pdf`;
      const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");
      await logAudit({
        userId: ctx.user.id,
        action: "estimate.export_pdf",
        tableName: "estimate_drafts",
        recordId: draft.id,
        before: null,
        after: { format: "pdf", fileKey, url, pricingSchemaVersion: draft.pricingSchemaVersion },
      });
      return { url, fileKey, format: "pdf" as const, estimateId: draft.id };
    }),

  exportJson: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      const jsonExport = generateJsonExport(draft, ctx.user.id);
      const jsonBuffer = Buffer.from(JSON.stringify(jsonExport, null, 2), "utf-8");
      const fileKey = `exports/estimates/EST-${String(draft.id).padStart(5, "0")}-${Date.now()}.json`;
      const { url } = await storagePut(fileKey, jsonBuffer, "application/json");
      await logAudit({
        userId: ctx.user.id,
        action: "estimate.export_json",
        tableName: "estimate_drafts",
        recordId: draft.id,
        before: null,
        after: { format: "json", fileKey, url, pricingSchemaVersion: draft.pricingSchemaVersion },
      });
      return { url, fileKey, format: "json" as const, estimateId: draft.id, data: jsonExport };
    }),

  exportPrintable: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      const printable = generatePrintableExport(draft, ctx.user.id);
      await logAudit({
        userId: ctx.user.id,
        action: "estimate.export_printable",
        tableName: "estimate_drafts",
        recordId: draft.id,
        before: null,
        after: { format: "printable", pricingSchemaVersion: draft.pricingSchemaVersion },
      });
      return { html: printable.html, title: printable.title, format: "printable" as const, estimateId: draft.id };
    }),

  // ══════════════════════════════════════════════════════════════════════
  // Sprint 20.1: JobTread CSV Export
  // ══════════════════════════════════════════════════════════════════════

  /** Validate CSV export before download — returns validation report */
  validateCsvExport: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      const result = generateJobTreadCsvExport(draft, ctx.user.id);
      // Strip csvString from validation-only response
      const { csvString, ...report } = result;
      return report;
    }),

  /** Export CSV — blocks if validation fails */
  exportCsv: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      const result = generateJobTreadCsvExport(draft, ctx.user.id);
      if (!result.isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `CSV export blocked: ${result.invalidRows} invalid row(s) with ${result.errors.length} error(s). Run validation first to see details.`,
        });
      }
      const csvBuffer = Buffer.from(result.csvString!, "utf-8");
      const fileKey = `exports/estimates/EST-${String(draft.id).padStart(5, "0")}-${Date.now()}-jobtread.csv`;
      const { url } = await storagePut(fileKey, csvBuffer, "text/csv");
      await logAudit({
        userId: ctx.user.id,
        action: "estimate.export_csv_jobtread",
        tableName: "estimate_drafts",
        recordId: draft.id,
        before: null,
        after: {
          format: "csv_jobtread",
          fileKey,
          url,
          totalRows: result.totalRows,
          validRows: result.validRows,
          pricingSchemaVersion: draft.pricingSchemaVersion,
          costTypeDistribution: result.summary.costTypeDistribution,
        },
      });
      return {
        url,
        fileKey,
        format: "csv_jobtread" as const,
        estimateId: draft.id,
        totalRows: result.totalRows,
        summary: result.summary,
      };
    }),

  // ══════════════════════════════════════════════════════════════════════
  // Sprint 20: Draft Recovery
  // ══════════════════════════════════════════════════════════════════════

  /** List partial (failed) drafts for recovery */
  listPartialDrafts: protectedProcedure
    .input(
      z.object({
        scopeDraftId: z.string().uuid().optional(),
        status: z.enum(["pending", "retrying", "recovered", "abandoned"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return listPartialDrafts(input ?? undefined);
    }),

  /** Get a single partial draft by ID */
  getPartialDraft: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const draft = await getPartialDraftById(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Partial draft ${input.id} not found` });
      }
      return draft;
    }),

  /** Retry a failed pipeline run from a partial draft */
  retryPartialDraft: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const partial = await getPartialDraftById(input.id);
      if (!partial) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Partial draft ${input.id} not found` });
      }

      // Mark as retrying
      const retrying = await markPartialDraftRetrying(input.id, ctx.user.id);
      if (!retrying) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot retry partial draft ${input.id}: max retries exceeded or invalid status (${partial.status})`,
        });
      }

      // Re-execute the pipeline with the original context
      const snapshot = ((partial as any).contextSnapshot as Record<string, unknown>) ?? {};
      try {
        const result = await executeScopeToEstimatePipeline(
          {
            scopeDraftId: partial.scopeDraftId ?? "",
            channelOverride: (snapshot.channelOverride as any) ?? null,
            finishLevelOverride: (snapshot.finishLevelOverride as any) ?? null,
            regionOverride: (snapshot.regionOverride as string) ?? null,
            draftName: (snapshot.draftName as string) ?? null,
            notes: (snapshot.notes as string) ?? null,
          },
          ctx.user.id
        );

        // Mark as recovered
        await markPartialDraftRecovered(input.id, result.draft.id, ctx.user.id);

        return {
          recovered: true,
          partialDraftId: input.id,
          estimateDraft: result.draft,
          batchSummary: result.batchSummary,
        };
      } catch (retryErr) {
        // Pipeline failed again — update error info but don't create another partial
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Retry failed: ${retryErr instanceof Error ? retryErr.message : "Unknown error"}`,
        });
      }
    }),

  /** Abandon a partial draft (give up on recovery) */
  abandonPartialDraft: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const result = await abandonPartialDraft(input.id, ctx.user.id);
      if (!result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot abandon partial draft ${input.id}: not found or already resolved`,
        });
      }
      return result;
    }),

  /** Get stats for partial drafts */
  partialDraftStats: protectedProcedure.query(async () => {
    return getPartialDraftStats();
  }),
});
