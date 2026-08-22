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
import { protectedProcedure, publicProcedure, adminProcedure, tenantProcedure, router } from "./_core/trpc";
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
  getEstimateDraftOwner,
} from "./estimate-db";
import {
  requireProjectAccessTrpc,
  requireEntityAccess,
  resolveProjectIdFor,
} from "./project-access";
import { FORBIDDEN_PROJECT_ERR_MSG } from "@shared/const";
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
// PHASE 2 — export gate, versioning, Profit Shield inspection
import {
  checkExportAuthorization,
  downloadJobTreadExport,
  ExportError,
  getExportById,
  listExportsForEstimate,
  listExportsForProject,
  requestJobTreadExport,
} from "./jobtread-export-db";
import {
  createChangeOrder,
  createEstimateVersion,
  getExportableEstimate,
  getVersionChain,
} from "./estimate-version-db";
import { EstimateGuardError, evaluateDraftProfitShield } from "./estimate-db";

// ═══════════════════════════════════════════════════════════════════
// PHASE 2 — ERROR MAPPING
// ═══════════════════════════════════════════════════════════════════

/** Translate Phase 2 governance errors into precise tRPC codes. */
function mapPhase2Error(err: unknown): never {
  if (err instanceof ExportError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      ESTIMATE_NOT_FOUND: "NOT_FOUND",
      EXPORT_NOT_FOUND: "NOT_FOUND",
      ESTIMATE_NOT_APPROVED: "PRECONDITION_FAILED",
      ESTIMATE_SUPERSEDED: "CONFLICT",
      VALIDATION_FAILED: "BAD_REQUEST",
      RECONCILIATION_FAILED: "PRECONDITION_FAILED",
      EXPORT_BLOCKED: "PRECONDITION_FAILED",
      INVALID_TRANSITION: "CONFLICT",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }

  if (err instanceof EstimateGuardError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      ESTIMATE_VERSION_LOCKED: "CONFLICT",
      PROFIT_SHIELD_CHANNEL_FLOOR: "PRECONDITION_FAILED",
      SCOPE_NOT_APPROVED: "PRECONDITION_FAILED",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }

  throw err;
}

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

/**
 * PHASE 1 helper: estimate drafts are the unit of authorization here. When a draft
 * is linked to a project the project guard applies; unlinked (calculator-only)
 * drafts fall back to "creator or platform admin".
 */
async function assertEstimateDraftAccess(
  draftId: string,
  ctx: { user: { id: string; role?: string | null } },
  permission: "read" | "write" | "approve" | "delete",
): Promise<void> {
  const projectId = await resolveProjectIdFor("estimateDraft", draftId);

  if (projectId) {
    await requireProjectAccessTrpc(projectId, ctx.user.id, permission);
    return;
  }

  const owner = await getEstimateDraftOwner(draftId);
  if (!owner) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${draftId} not found` });
  }
  if (ctx.user.role !== "admin" && owner !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
  }
}

export const estimateRouter = router({
  /**
   * Create an estimate draft from the Bundle Calculator.
   * 1. Fetches assemblies + components from DB
   * 2. Runs calculateMultipleAssemblies (assembly-engine)
   * 3. Validates (estimate-engine)
   * 4. Transforms to persist payload (estimate-engine)
   * 5. Persists to DB with audit (estimate-db)
   */
  createFromCalculator: tenantProcedure
    .input(createFromCalculatorSchema)
    .mutation(async ({ input, ctx }) => {
      const { selections, context } = input;

      // 0. Validate project/client references if provided
      if (context.projectId) {
        // PHASE 1: writing an estimate against a project requires project write access.
        await requireProjectAccessTrpc(context.projectId, ctx.user.id, "write");

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
        const client = await getClientById(context.clientId, { tenantId: ctx.tenantId });
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
      await assertEstimateDraftAccess(input.id, ctx, "read");

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
  list: tenantProcedure
    .input(listSchema.optional())
    .query(async ({ input, ctx }) => {
      return listEstimateDraftsPaginated({
        createdBy: ctx.user.role === "admin" ? undefined : ctx.user.id,
        status: input?.status,
        source: input?.source,
        region: input?.region,
        limit: input?.limit,
        offset: input?.offset,
        tenantId: ctx.tenantId,
      });
    }),

  /**
   * Update the status of an estimate draft.
   */
  updateStatus: protectedProcedure
    .input(statusSchema)
    .mutation(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "approve");

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
      await assertEstimateDraftAccess(input.id, ctx, "approve");

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
      await assertEstimateDraftAccess(input.id, ctx, "approve");

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
      await assertEstimateDraftAccess(input.id, ctx, "write");
      return updateEstimateDraftNotes(input.id, input.notes, ctx.user.id);
    }),

  /**
   * Apply a discount percentage to an estimate draft.
   */
  applyDiscount: protectedProcedure
    .input(discountSchema)
    .mutation(async ({ input, ctx }) => {
      // Discounts move margin — approval-grade action.
      await assertEstimateDraftAccess(input.id, ctx, "approve");
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
      await assertEstimateDraftAccess(input.id, ctx, "delete");
      return archiveEstimateDraft(input.id, ctx.user.id);
    }),

  /**
   * Get estimate draft statistics.
   */
  stats: tenantProcedure.query(async ({ ctx }) => {
    return getEstimateDraftStats(ctx.tenantId);
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
      await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "write");

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
      await assertEstimateDraftAccess(input.id, ctx, "read");

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
      await assertEstimateDraftAccess(input.id, ctx, "read");

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
      await assertEstimateDraftAccess(input.id, ctx, "read");

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
      await assertEstimateDraftAccess(input.id, ctx, "read");

      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      const result = generateJobTreadCsvExport(draft, ctx.user.id);
      // Strip csvString from validation-only response
      const { csvString, ...report } = result;
      return report;
    }),

  /**
   * Export CSV — PHASE 2 gate.
   *
   * Runs the full authorization → validation → reconciliation chain before producing a
   * file. A non-approved estimate, an invalid row, or any reconciliation difference
   * blocks the download and records the blocked attempt (JIC-002, JIC-003, JIC-014).
   */
  exportCsv: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** Commercial adjustments that are not CSV lines (discount, lump sum). */
        declaredAdjustments: z
          .array(
            z.object({
              kind: z.string().min(1).max(64),
              amount: z.union([z.string(), z.number()]),
              reason: z.string().max(500).optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "read");

      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }

      let attempt: Awaited<ReturnType<typeof requestJobTreadExport>>;
      try {
        attempt = await requestJobTreadExport({
          estimateDraftId: input.id,
          userId: ctx.user.id,
          tenantId: ctx.tenantId ?? null,
          declaredAdjustments: input.declaredAdjustments,
        });
      } catch (err) {
        return mapPhase2Error(err);
      }

      if (!attempt.canDownload || !attempt.csvString) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `CSV export blocked (${attempt.status}): ${attempt.blockReason ?? "validation or reconciliation failed"}`,
          cause: {
            exportId: attempt.exportId,
            status: attempt.status,
            reconciliation: attempt.reconciliation,
            invalidRows: attempt.validation.invalidRows,
          },
        });
      }

      const csvBuffer = Buffer.from(attempt.csvString, "utf-8");
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
          exportId: attempt.exportId,
          totalRows: attempt.validation.totalRows,
          validRows: attempt.validation.validRows,
          pricingSchemaVersion: draft.pricingSchemaVersion,
          costTypeDistribution: attempt.validation.summary.costTypeDistribution,
          reconciliation: {
            status: attempt.reconciliation.status,
            approvedTotal: attempt.reconciliation.approvedTotal,
            exportedTotal: attempt.reconciliation.exportedTotal,
            difference: attempt.reconciliation.difference,
          },
          csvHash: attempt.csvHash,
        },
      });

      return {
        url,
        fileKey,
        format: "csv_jobtread" as const,
        estimateId: draft.id,
        exportId: attempt.exportId,
        totalRows: attempt.validation.totalRows,
        summary: attempt.validation.summary,
        reconciliation: attempt.reconciliation,
        manifest: attempt.manifest,
        csvHash: attempt.csvHash,
      };
    }),

  // ═════════════════════════════════════════════════════════════════
  // PHASE 2 — EXPORT GATE, RECONCILIATION, VERSIONING, PROFIT SHIELD
  // ═════════════════════════════════════════════════════════════════

  /** Check whether this estimate is authorized for export, without generating anything. */
  exportAuthorization: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "read");
      try {
        const auth = await checkExportAuthorization(input.id);
        return {
          authorized: auth.authorized,
          reason: auth.reason,
          status: auth.draft?.status ?? null,
          version: auth.draft?.version ?? null,
          supersededBy: auth.draft?.supersededBy ?? null,
          approvedTotal: auth.draft?.finalTotalPrice ?? null,
        };
      } catch (err) {
        return mapPhase2Error(err);
      }
    }),

  /**
   * Dry-run the export chain and return validation + reconciliation without a file.
   * This is the procedure the UI should call before offering a download button.
   */
  exportPreflight: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        declaredAdjustments: z
          .array(
            z.object({
              kind: z.string().min(1).max(64),
              amount: z.union([z.string(), z.number()]),
              reason: z.string().max(500).optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "read");
      try {
        const attempt = await requestJobTreadExport({
          estimateDraftId: input.id,
          userId: ctx.user.id,
          tenantId: ctx.tenantId ?? null,
          declaredAdjustments: input.declaredAdjustments,
        });
        // Never leak the payload from a preflight call.
        const { csvString: _csv, ...rest } = attempt;
        return rest;
      } catch (err) {
        return mapPhase2Error(err);
      }
    }),

  /** Download a previously approved export attempt. */
  downloadExport: protectedProcedure
    .input(z.object({ exportId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const record = await getExportById(input.exportId);
      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Export not found" });
      }
      if (record.projectId) {
        await requireProjectAccessTrpc(record.projectId, ctx.user.id, "read");
      }
      try {
        const result = await downloadJobTreadExport(input.exportId, ctx.user.id);
        return {
          csvString: result.csvString,
          filename: result.filename,
          status: result.export.status,
          rowCount: result.export.rowCount,
        };
      } catch (err) {
        return mapPhase2Error(err);
      }
    }),

  /** Export attempt history for an estimate (includes blocked attempts — JIC-014). */
  listExports: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "read");
      return listExportsForEstimate(input.id);
    }),

  /** Export attempt history for a project. */
  listProjectExports: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return listExportsForProject(input.projectId);
    }),

  /** Profit Shield evaluation for a stored draft, using its own pricing snapshot. */
  profitShield: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "read");
      const draft = await getEstimateDraftFull(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${input.id} not found` });
      }
      return evaluateDraftProfitShield(draft);
    }),

  /**
   * Create a new version of an estimate. The only way to change the money on an approved
   * estimate (docs/phase2-contract.md §7.3).
   */
  createVersion: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().min(10).max(2000),
        name: z.string().max(255).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "write");
      try {
        return await createEstimateVersion({
          sourceDraftId: input.id,
          userId: ctx.user.id,
          reason: input.reason,
          name: input.name ?? null,
        });
      } catch (err) {
        return mapPhase2Error(err);
      }
    }),

  /** Create a change order attached to an approved estimate. */
  createChangeOrder: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().min(10).max(2000),
        lineItems: z.array(z.record(z.string(), z.unknown())).optional(),
        subtotalCost: z.union([z.string(), z.number()]).nullish(),
        subtotalPrice: z.union([z.string(), z.number()]).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "write");
      try {
        return await createChangeOrder({
          baseDraftId: input.id,
          userId: ctx.user.id,
          reason: input.reason,
          lineItems: input.lineItems,
          subtotalCost: input.subtotalCost ?? null,
          subtotalPrice: input.subtotalPrice ?? null,
        });
      } catch (err) {
        return mapPhase2Error(err);
      }
    }),

  /** Full version chain for a project, with the active approved version identified. */
  versionChain: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getVersionChain(input.projectId);
    }),

  /** The estimate that may currently be exported for a project, if any. */
  exportableEstimate: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getExportableEstimate(input.projectId);
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
    .query(async ({ input, ctx }) => {
      if (input?.scopeDraftId) {
        await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "read");
      }
      return listPartialDrafts({ ...(input ?? {}), userId: ctx.user.role === "admin" ? undefined : ctx.user.id });
    }),

  /** Get a single partial draft by ID */
  getPartialDraft: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const draft = await getPartialDraftById(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Partial draft ${input.id} not found` });
      }
      if (draft.scopeDraftId) {
        await requireEntityAccess("scopeDraft", draft.scopeDraftId, ctx.user.id, "read");
      } else if (ctx.user.role !== "admin" && draft.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
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
      if (partial.scopeDraftId) {
        await requireEntityAccess("scopeDraft", partial.scopeDraftId, ctx.user.id, "write");
      } else if (ctx.user.role !== "admin" && partial.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
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
      const partial = await getPartialDraftById(input.id);
      if (partial?.scopeDraftId) {
        await requireEntityAccess("scopeDraft", partial.scopeDraftId, ctx.user.id, "write");
      } else if (partial && ctx.user.role !== "admin" && partial.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
      }

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
