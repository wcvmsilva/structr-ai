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
import { withAggregateReadBoundary } from "./estimate-aggregate-errors";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { estimateDrafts } from "../drizzle/schema";
import { LegacyEstimateOperationError, holdLegacyEstimateOperation } from "@shared/estimate-legacy-hold";
import { TRPCError } from "@trpc/server";
import { normalizeEstimateDiscountPercent } from "../shared/estimate-discount-engine";
import { protectedProcedure, tenantProcedure, router } from "./_core/trpc";
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
  requireProjectAccessTrpc,
  ProjectAccessError,
  requireEntityAccess,
  resolveProjectIdFor,
  type ProjectAccessResult,
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
import { requireScopeOverrideLogAccess } from "./geo-override-db";
import {
  createPartialDraft,
  listPartialDrafts,
  getPartialDraftById,
  markPartialDraftRetrying,
  markPartialDraftRecovered,
  abandonPartialDraft,
  getPartialDraftStats,
} from "./draft-recovery-db";
import { logAudit } from "./audit";
// PHASE 2 — export gate, versioning, Profit Shield inspection
import {
  ExportError,
  getExportById,
  listExportsForEstimate,
  listExportsForProject,
} from "./jobtread-export-db";
import {
  createChangeOrder,
  createEstimateVersion,
  getExportableEstimate,
  getVersionChain,
} from "./estimate-version-db";
// A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md — the three accepted writers.
import {
  createExportAttempt,
  createAndDeliverExportAttempt,
  downloadExportAttempt,
  checkExportAttemptAuthorization,
  ExportDeliveryBlockedError,
} from "./internal-estimate-export-db";
import { formatExportDeliveryBlockedMessage } from "@shared/export-delivery-blocked-message";
import { EstimateGuardError, evaluateDraftProfitShield } from "./estimate-db";
import { isEstimateMutationError, mapEstimateMutationError, requireEstimateMutationTenant } from "./estimate-mutation-errors";
import { historicalImportProcedure, mapHistoricalError } from "./historical-estimate-router";
import { assertHistoricalCaptureOnly, HistoricalEstimateError } from "@shared/historical-estimate-engine";
import {
  getInternalApprovalReview as internalApprovalReviewHelper,
  getInternalApproval as internalApprovalReadHelper,
  reviewCommandSchema,
  getInternalApprovalInputSchema,
} from "./internal-estimate-approval-db";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import { InternalApprovalPersistenceError, InternalApprovalAuditFailure } from "./internal-estimate-approval-errors";
import { getEstimateVersionPreviewV2 } from "./estimate-version-v2-db";
import { estimateVersionPreviewCommandV2Schema } from "../shared/estimate-version-engine";

// ═══════════════════════════════════════════════════════════════════
// PHASE 2 — ERROR MAPPING
// ═══════════════════════════════════════════════════════════════════

/** Translate Phase 2 governance errors into precise tRPC codes. */
function mapPhase2Error(err: unknown): never {
  if (err instanceof LegacyEstimateOperationError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message, cause: err });
  }
  if (err instanceof ProjectAccessError) {
    throw new TRPCError({ code: err.code, message: err.message });
  }
  if (err instanceof HistoricalEstimateError) return mapHistoricalError(err);
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
      ESTIMATE_CONTEXT_UNRESOLVED: "PRECONDITION_FAILED",
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

/**
 * A1-READ-QUERIES-IMPLEMENTATION-CONTRACT.md §3 — maps the two read helpers' errors
 * for getInternalApprovalReview/getInternalApproval ONLY. Deliberately separate from
 * mapEstimateMutationError/mapPhase2Error above: those are mutation-flavored (their
 * final fallback message talks about a save that did not happen), which would be
 * false for a query that never wrote anything. FORBIDDEN/NOT_FOUND are rethrown
 * exactly as the helper typed them, with no draft/tenant/commercial data attached.
 */
function mapInternalApprovalReadError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof HistoricalEstimateError) return mapHistoricalError(error);
  if (error instanceof ProjectAccessError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  if (error instanceof InternalApprovalPersistenceError) {
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      throw new TRPCError({ code: error.code, message: "This estimate is not available to your account." });
    }
    if (error.code === "INTERNAL_APPROVAL_REQUEST_CONFLICT" || error.code === "INTERNAL_APPROVAL_ALREADY_DECIDED") {
      throw new TRPCError({ code: "CONFLICT", message: "This estimate's approval state changed. Refresh and try again." });
    }
    // PROFIT_SHIELD_CHANNEL_FLOOR is a writer-only code; INTERNAL_SERVER_ERROR falls through below.
  }
  if (error instanceof InternalApprovalError) {
    if (error.code === "INTERNAL_APPROVAL_INPUT_INVALID") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This request is not valid." });
    }
    if (error.code === "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" || error.code === "POLICY_CONTEXT_UNRESOLVED") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This estimate's context is not ready to review." });
    }
    if (error.code === "INTERNAL_APPROVAL_REVIEW_STALE") {
      throw new TRPCError({ code: "CONFLICT", message: "This estimate's approval state changed. Refresh and try again." });
    }
    // INTEGRITY_ERROR / CRYPTO_UNAVAILABLE fall through to the fixed internal message below.
  }
  // Neither read helper audits, but the same fixed, content-free message applies if one
  // ever surfaced here — never attach an auditCause or a database driver error.
  if (error instanceof InternalApprovalAuditFailure) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "This estimate's approval review could not be completed. Please try again." });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "This estimate's approval review could not be completed. Please try again." });
}

/**
 * A1-VERSION-PREVIEW-IMPLEMENTATION-CONTRACT.md §3 — maps getEstimateVersionPreviewV2's
 * errors for estimate.getEstimateVersionPreview ONLY. Deliberately NOT
 * mapInternalApprovalReadError unchanged: that mapper's own doc-comment scopes it to
 * the two already-accepted approval-review queries, and its CONFLICT/fallback messages
 * literally say "approval review" — false for a version-preview query that never
 * touches an approval decision on the current_draft branch. The two existing queries'
 * public behavior through mapInternalApprovalReadError is unchanged by adding this.
 */
function mapEstimateVersionPreviewError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof HistoricalEstimateError) return mapHistoricalError(error);
  if (error instanceof ProjectAccessError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  if (error instanceof InternalApprovalPersistenceError) {
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      throw new TRPCError({ code: error.code, message: "This estimate is not available to your account." });
    }
    if (error.code === "INTERNAL_APPROVAL_REQUEST_CONFLICT" || error.code === "INTERNAL_APPROVAL_ALREADY_DECIDED") {
      throw new TRPCError({ code: "CONFLICT", message: "This estimate's version state changed. Refresh and try again." });
    }
    // PROFIT_SHIELD_CHANNEL_FLOOR is a writer-only code; INTERNAL_SERVER_ERROR falls through below.
  }
  if (error instanceof InternalApprovalError) {
    if (error.code === "INTERNAL_APPROVAL_INPUT_INVALID") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This request is not valid." });
    }
    if (error.code === "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" || error.code === "POLICY_CONTEXT_UNRESOLVED") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This estimate's context is not ready for a new version." });
    }
    if (error.code === "INTERNAL_APPROVAL_REVIEW_STALE") {
      throw new TRPCError({ code: "CONFLICT", message: "This estimate's version state changed. Refresh and try again." });
    }
    // INTEGRITY_ERROR / CRYPTO_UNAVAILABLE fall through to the fixed internal message below.
  }
  // This read never audits, but the same fixed, content-free message applies if one
  // ever surfaced here — never attach an auditCause or a database driver error.
  if (error instanceof InternalApprovalAuditFailure) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "This estimate's version preview could not be completed. Please try again." });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "This estimate's version preview could not be completed. Please try again." });
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
  discountPct: z.number().refine(value => {
    try { normalizeEstimateDiscountPercent(value); return true; }
    catch { return false; }
  }, "The discount percentage must be a finite number between 0 and 50."),
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
): Promise<ProjectAccessResult> {
  const projectId = await resolveProjectIdFor("estimateDraft", draftId);

  if (projectId) {
    return requireProjectAccessTrpc(projectId, ctx.user.id, permission);
  }

  // B2 (Codex P1-1, route inventory): the owner-or-admin fallback that used to live here
  // was the same inverted shape — `role !== "admin" && owner !== caller` — that let an
  // admin of any tenant reach another tenant's row in the partial-draft routes. Here it
  // was latent rather than live, because `estimate_drafts.project_id` is NOT NULL so the
  // branch above always resolves for an existing draft. It is removed anyway: leaving one
  // surviving copy of a pattern deleted three times in the same file is how this class of
  // defect gets reintroduced, and a role is never a substitute for tenant authorization.
  //
  // Behaviour is unchanged for every reachable case. Previously an unresolvable parent
  // meant the owner lookup also returned null and the route answered NOT_FOUND; it still
  // does, now without a branch that could grant access if project_id ever became nullable.
  throw new TRPCError({ code: "NOT_FOUND", message: `Estimate draft ${draftId} not found` });
}

/**
 * Authenticated context for the three accepted A1 export writers: resolves the
 * draft's REAL project via the same authorized lookup `assertEstimateDraftAccess`
 * already uses (never trusting a client-supplied projectId), then hands the
 * writer the plain `{tenantId,actorId,projectId,estimateDraftId}` context it
 * will itself re-validate under lock inside its own transaction. This router
 * layer's own check is a necessary authenticated lookup, never a substitute for
 * the writer's internal revalidation (both run; neither is skipped).
 */
async function resolveExportAttemptContext(
  draftId: string,
  ctx: { user: { id: string; role?: string | null }; tenantId: string | null },
): Promise<{ tenantId: string; actorId: string; projectId: string; estimateDraftId: string }> {
  const access = await assertEstimateDraftAccess(draftId, ctx, "read");
  if (!ctx.tenantId || access.tenantId !== ctx.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
  }
  if (!access.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate draft not found" });
  return { tenantId: ctx.tenantId, actorId: ctx.user.id, projectId: access.projectId, estimateDraftId: draftId };
}

/**
 * A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md — maps the three accepted writers'
 * (`createExportAttempt`/`downloadExportAttempt`/`createAndDeliverExportAttempt`,
 * `checkExportAttemptAuthorization`) errors for the export mutations/query below
 * ONLY. Mirrors `mapInternalApprovalReadError`'s exact code/message shape (the
 * house pattern for this error family) rather than inventing a new one.
 * `ExportDeliveryBlockedError` is the one case that must reach the client with
 * structured `{exportId,code}` — tRPC's default formatter drops `cause` on the
 * wire, so the pair is encoded into the message itself via the shared helper
 * both this mapper and the client import (never two competing formats).
 */
function mapExportWriterError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ProjectAccessError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  if (error instanceof ExportDeliveryBlockedError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: formatExportDeliveryBlockedMessage({ code: error.code, exportId: error.exportId }) });
  }
  if (error instanceof InternalApprovalPersistenceError) {
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      throw new TRPCError({ code: error.code, message: "This export is not available to your account." });
    }
    if (error.code === "INTERNAL_APPROVAL_REQUEST_CONFLICT" || error.code === "INTERNAL_APPROVAL_ALREADY_DECIDED") {
      throw new TRPCError({ code: "CONFLICT", message: "This estimate's export state changed. Refresh and try again." });
    }
    // PROFIT_SHIELD_CHANNEL_FLOOR is a different writer's code; falls through below.
  }
  if (error instanceof InternalApprovalError && error.code === "INTERNAL_APPROVAL_INPUT_INVALID") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This request is not valid." });
  }
  // InternalApprovalError INTEGRITY_ERROR/CRYPTO_UNAVAILABLE, InternalApprovalAuditFailure,
  // and anything else fall through to the same fixed, content-free message — never a
  // database/driver/constraint detail, never another tenant's ids.
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "This export could not be completed. Please try again." });
}

function mapExportHistoryError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ProjectAccessError || error instanceof ExportError || error instanceof LegacyEstimateOperationError) return mapPhase2Error(error);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Export history is unavailable." });
}

function exportHistoryContext(ctx: { user: { id: string }; tenantId: string | null }) {
  if (!ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
  return { actorId: ctx.user.id, tenantId: ctx.tenantId };
}

function assertCalculatedRoute(draft: { source: string | null; historicalImportId?: string | null }, action: string): void {
  try { assertHistoricalCaptureOnly({ source: draft.source, hasHistoricalImport: !!draft.historicalImportId }, action); }
  catch (error) { mapHistoricalError(error); }
}

export const estimateRouter = router({
  importHistorical: historicalImportProcedure,
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
        const assembly = await getAssemblyById(sel.assemblyId, { requirePricing: true });
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
                code: comp.priceBookItem.code,
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
        ctx.user.id,
        ctx.tenantId,
      ).catch(mapPhase2Error);

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
   * A1-READ-QUERIES-IMPLEMENTATION-CONTRACT.md — preview of the internal-approval
   * decision not yet made. Delegates entirely to the real transactional helper
   * (capability "approve", checked under lock inside its OWN transaction). A later
   * decision never reuses this transaction or this result as a standing grant — it
   * opens a brand-new transaction and reruns every lock/authorization/content check
   * from scratch (Core §7.3: "a leitura não é token de autorização futura; approve
   * repete todas as leituras/checks sob locks"). This procedure itself performs no
   * authorization or business logic of its own, caches nothing, and never mutates or
   * audits.
   */
  getInternalApprovalReview: tenantProcedure
    .input(reviewCommandSchema)
    .query(async ({ input, ctx }) => {
      try {
        return await internalApprovalReviewHelper(input, ctx.user.id, ctx.tenantId);
      } catch (err) {
        return mapInternalApprovalReadError(err);
      }
    }),

  /**
   * A1-READ-QUERIES-IMPLEMENTATION-CONTRACT.md — current internal-approval decision,
   * snapshot and revocation (if any) for a draft, including after a replay. Delegates
   * entirely to the real transactional helper (capability "read"); never mutates.
   */
  getInternalApproval: tenantProcedure
    .input(getInternalApprovalInputSchema)
    .query(async ({ input, ctx }) => {
      try {
        return await internalApprovalReadHelper(input.id, ctx.user.id, ctx.tenantId);
      } catch (err) {
        return mapInternalApprovalReadError(err);
      }
    }),

  /**
   * A1-VERSION-PREVIEW-IMPLEMENTATION-CONTRACT.md — read-only preview of a new
   * version's exact content, from either the current draft or recorded A1 evidence
   * (active or revoked). Delegates entirely to the real transactional helper
   * (capability "write", the same capability createVersion itself requires, even
   * though this query never persists one); never mutates, never grants approval,
   * never replays a create request — replay/idempotency belongs to the writer only.
   */
  getEstimateVersionPreview: tenantProcedure
    .input(estimateVersionPreviewCommandV2Schema)
    .query(async ({ input, ctx }) => {
      try {
        return await getEstimateVersionPreviewV2(input, ctx.user.id, ctx.tenantId);
      } catch (err) {
        return mapEstimateVersionPreviewError(err);
      }
    }),

  /**
   * Update the status of an estimate draft.
   */
  updateStatus: protectedProcedure
    .input(statusSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireEstimateMutationTenant(ctx.tenantId);
      await assertEstimateDraftAccess(input.id, ctx, "approve");

      try {
        return await updateEstimateDraftStatus(
          input.id,
          input.status,
          ctx.user.id,
          tenantId
        );
      } catch (err: any) {
        if (isEstimateMutationError(err)) return mapEstimateMutationError(err);
        if (err.message?.includes("Invalid status transition")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err.message,
          });
        }
        return mapEstimateMutationError(err);
      }
    }),

  /**
   * C2-A: hold the old id-only approval until the A1 command replaces it.
   */
  approveEstimate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await assertEstimateDraftAccess(input.id, ctx, "approve");

      try {
        return await approveEstimateDraft(input.id, ctx.user.id);
      } catch (err) {
        return mapPhase2Error(err);
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
      const tenantId = requireEstimateMutationTenant(ctx.tenantId);
      await assertEstimateDraftAccess(input.id, ctx, "approve");

      try {
        return await rejectEstimateDraft(input.id, ctx.user.id, input.reason, tenantId);
      } catch (err: any) {
        if (isEstimateMutationError(err)) return mapEstimateMutationError(err);
        if (err.message?.includes("Invalid status transition") || err.message?.includes("not found")) {
          throw new TRPCError({
            code: err.message.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        return mapEstimateMutationError(err);
      }
    }),

  /**
   * Update notes on an estimate draft.
   */
  updateNotes: protectedProcedure
    .input(notesSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireEstimateMutationTenant(ctx.tenantId);
      await assertEstimateDraftAccess(input.id, ctx, "write");
      return updateEstimateDraftNotes(input.id, input.notes, ctx.user.id, tenantId).catch(mapEstimateMutationError);
    }),

  /**
   * Apply a discount percentage to an estimate draft.
   */
  applyDiscount: protectedProcedure
    .input(discountSchema)
    .mutation(async ({ input, ctx }) => {
      // Discounts move margin — approval-grade action.
      const tenantId = requireEstimateMutationTenant(ctx.tenantId);
      await assertEstimateDraftAccess(input.id, ctx, "approve");
      try { return await applyEstimateDraftDiscount(input.id, input.discountPct, ctx.user.id, tenantId); }
      catch (error) { return mapEstimateMutationError(error); }
    }),

  /**
   * Archive (soft-delete) an estimate draft.
   */
  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = requireEstimateMutationTenant(ctx.tenantId);
      await assertEstimateDraftAccess(input.id, ctx, "delete");
      return archiveEstimateDraft(input.id, ctx.user.id, tenantId).catch(mapEstimateMutationError);
    }),

  /**
   * Get estimate draft statistics.
   */
  stats: tenantProcedure.query(async ({ ctx }) => {
    return withAggregateReadBoundary(() => getEstimateDraftStats(ctx.tenantId));
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
  createFromScopeDraft: tenantProcedure
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
      // G2: the parent policy is checked BEFORE the try that saves a partial draft, so
      // an authorization refusal is never recorded as a recoverable commercial failure.
      const authority = { tenantId: ctx.tenantId, userId: ctx.user.id };
      await requireScopeOverrideLogAccess(authority, input.scopeDraftId, "write");

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
          authority
        );

        return result;
      } catch (err) {
        if (isEstimateMutationError(err)) return mapEstimateMutationError(err);
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
  // A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md — PDF/JSON/CSV/Printable all
  // deliver via `createAndDeliverExportAttempt` (one combined create+deliver
  // operation, per the already-accepted new-delivery writer): format is fixed
  // per endpoint, never caller-supplied, and no `declaredAdjustments` or other
  // extra field reaches the writer's `.strict()` input (Michael's decision —
  // discarded, never accepted as a silent no-op or promoted to authority).
  // ══════════════════════════════════════════════════════════════════════

  exportPdf: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const context = await resolveExportAttemptContext(input.id, ctx);
      try { return await createAndDeliverExportAttempt({ context, format: "pdf", attemptKind: "delivery" }); }
      catch (error) { return mapExportWriterError(error); }
    }),

  exportJson: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const context = await resolveExportAttemptContext(input.id, ctx);
      try { return await createAndDeliverExportAttempt({ context, format: "json", attemptKind: "delivery" }); }
      catch (error) { return mapExportWriterError(error); }
    }),

  /** Printable moved from a query to a mutation — §9/Integration§6.6: printing is
   * an auditable delivery action, never a side-effect-free read. */
  exportPrintable: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const context = await resolveExportAttemptContext(input.id, ctx);
      try { return await createAndDeliverExportAttempt({ context, format: "printable", attemptKind: "delivery" }); }
      catch (error) { return mapExportWriterError(error); }
    }),

  // ══════════════════════════════════════════════════════════════════════
  // Sprint 20.1: JobTread CSV Export
  // ══════════════════════════════════════════════════════════════════════

  /** CSV validation now persists a real preflight attempt + audit (Michael's
   * decision #3) — a mutation, never a side-effect-free query. The button's
   * adapter always sends `csv_jobtread` explicitly; the writer never defaults it. */
  validateCsvExport: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const context = await resolveExportAttemptContext(input.id, ctx);
      try { return await createExportAttempt({ context, format: "csv_jobtread", attemptKind: "preflight" }); }
      catch (error) { return mapExportWriterError(error); }
    }),

  exportCsv: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const context = await resolveExportAttemptContext(input.id, ctx);
      try { return await createAndDeliverExportAttempt({ context, format: "csv_jobtread", attemptKind: "delivery" }); }
      catch (error) { return mapExportWriterError(error); }
    }),

  // ═════════════════════════════════════════════════════════════════
  // PHASE 2 — EXPORT GATE, RECONCILIATION, VERSIONING, PROFIT SHIELD
  // ═════════════════════════════════════════════════════════════════

  /** Check whether this estimate is authorized for export, without generating
   * or persisting anything — reuses the writers' own authority resolution via
   * `checkExportAttemptAuthorization`, never a reusable download capability. */
  exportAuthorization: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const context = await resolveExportAttemptContext(input.id, ctx);
      try { return await checkExportAttemptAuthorization({ context }); }
      catch (error) { return mapExportWriterError(error); }
    }),

  /** Preflight always receives an explicit format — no default, UI or server-side. */
  exportPreflight: protectedProcedure
    .input(z.object({ id: z.string().uuid(), format: z.enum(["pdf", "json", "printable", "csv_jobtread"]) }))
    .mutation(async ({ input, ctx }) => {
      const context = await resolveExportAttemptContext(input.id, ctx);
      try { return await createExportAttempt({ context, format: input.format, attemptKind: "preflight" }); }
      catch (error) { return mapExportWriterError(error); }
    }),

  /** Regenerates bytes for an EXISTING attempt row (first delivery of a ready
   * preflight, or a redownload) via the accepted download writer — never a new
   * attempt, never a stale cached authorization. */
  downloadExport: protectedProcedure
    .input(z.object({ exportId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
      try {
        return await downloadExportAttempt({ context: { tenantId: ctx.tenantId, actorId: ctx.user.id }, exportId: input.exportId });
      } catch (error) { return mapExportWriterError(error); }
    }),

  /** Export attempt history for an estimate (includes blocked attempts — JIC-014). */
  listExports: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        await assertEstimateDraftAccess(input.id, ctx, "read");
        return await listExportsForEstimate(input.id, exportHistoryContext(ctx));
      } catch (error) { return mapExportHistoryError(error); }
    }),

  /** Export attempt history for a project. */
  listProjectExports: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
        return await listExportsForProject(input.projectId, exportHistoryContext(ctx));
      } catch (error) { return mapExportHistoryError(error); }
    }),

  /** Detail of a single export attempt — the one surface exposing the A1
   * manifest (never content/bytes/URL) after the same authorization gate the
   * list endpoints use. No equivalent route existed before this unit. */
  getExportDetail: protectedProcedure
    .input(z.object({ exportId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        const record = await getExportById(input.exportId, exportHistoryContext(ctx));
        if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Export not found" });
        return record;
      } catch (error) { return mapExportHistoryError(error); }
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
      assertCalculatedRoute(draft, "Profit Shield evaluation");
      return evaluateDraftProfitShield(draft);
    }),

  /** C2-A: hold the old copy; C3 replaces this existing route with the v2 command. */
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

  /** C2-A: legacy approval cannot authorize a new change order. */
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

  /** Historical version chain; legacy status does not identify current authority. */
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
  listPartialDrafts: tenantProcedure
    .input(
      z.object({
        scopeDraftId: z.string().uuid().optional(),
        status: z.enum(["pending", "retrying", "recovered", "abandoned"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      // B2: `pipeline_partial_drafts` has no tenant_id, so authorization comes from the
      // parent scope draft — or, when there is no parent, from ownership alone. Admin no
      // longer widens this: `userId: undefined` for an admin listed EVERY user's partial
      // drafts across every tenant, and omitting scopeDraftId skipped the guard entirely.
      if (input?.scopeDraftId) {
        await requireEntityAccess("scopeDraft", input.scopeDraftId, ctx.user.id, "read");
        return listPartialDrafts({ ...input });
      }
      // No parent to authorize against: the caller's own drafts only. A caller can never
      // reach another principal's row, so this cannot cross a tenant boundary.
      return listPartialDrafts({ ...(input ?? {}), userId: ctx.user.id });
    }),

  /** Get a single partial draft by ID */
  getPartialDraft: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const draft = await getPartialDraftById(input.id);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Partial draft ${input.id} not found` });
      }
      if (draft.scopeDraftId) {
        await requireEntityAccess("scopeDraft", draft.scopeDraftId, ctx.user.id, "read");
      } else if (draft.userId !== ctx.user.id) {
        // B2: no parent scope draft means no tenant linkage to authorize against, so the
        // only safe grant is ownership. The previous `role !== "admin" && ...` arm let an
        // admin of ANY tenant read this row — admin status is not a tenant.
        throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
      }
      return draft;
    }),

  /** Retry a failed pipeline run from a partial draft */
  retryPartialDraft: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const partial = await getPartialDraftById(input.id);
      if (!partial) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Partial draft ${input.id} not found` });
      }
      if (!partial.scopeDraftId) {
        // B2 (unchanged): ownership only — a role is not a tenant.
        if (partial.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_PROJECT_ERR_MSG });
        }
        // G2: with no parent there is nothing to authorize a retry against, and the
        // pipeline would otherwise run with an empty scope draft id. Reading and
        // abandoning such a partial draft are unchanged.
        throw new TRPCError({ code: "BAD_REQUEST", message: "Partial draft has no scope draft to retry" });
      }
      // G2: authorized before anything is marked, using the CURRENT request context.
      const authority = { tenantId: ctx.tenantId, userId: ctx.user.id };
      await requireScopeOverrideLogAccess(authority, partial.scopeDraftId, "write");

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
          authority
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
        if (isEstimateMutationError(retryErr)) return mapEstimateMutationError(retryErr);
        // A safe authorization error raised inside the pipeline keeps its own code and
        // message: a revocation is not a commercial retry failure. It does not undo the
        // retrying mark already recorded — that remains a recovery limit, not a rollback.
        if (retryErr instanceof TRPCError) throw retryErr;
        // Pipeline failed again — update error info but don't create another partial
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Retry failed: ${retryErr instanceof Error ? retryErr.message : "Unknown error"}`,
        });
      }
    }),

  /** Abandon a partial draft (give up on recovery) */
  abandonPartialDraft: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const partial = await getPartialDraftById(input.id);
      if (partial?.scopeDraftId) {
        await requireEntityAccess("scopeDraft", partial.scopeDraftId, ctx.user.id, "write");
      } else if (partial && partial.userId !== ctx.user.id) {
        // B2: ownership only — see getPartialDraft. Admin does not cross tenants.
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
