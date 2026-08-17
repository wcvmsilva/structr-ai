/**
 * structr.ai — PHASE 4 Scope Completeness tRPC Router
 *
 * Procedures:
 *   - scopeCompleteness.score              (protected, write)  → score a project
 *   - scopeCompleteness.preview            (protected, read)   → score without persisting
 *   - scopeCompleteness.get                (protected, read)   → persisted score of a project
 *   - scopeCompleteness.list               (protected)          → scores, tenant-scoped
 *   - scopeCompleteness.getSummary         (protected)          → dashboard aggregation
 *   - scopeCompleteness.refreshPatterns    (protected, admin)   → recompute the checklist
 *   - scopeCompleteness.getChecklist       (protected)          → pre-estimate checklist
 *   - scopeCompleteness.acknowledgePattern (protected)          → mark a pattern as seen
 *
 * `getChecklist` is the procedure that actually earns money: it is meant to be called by the
 * estimating screen before a bid is written, not by a report nobody opens.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { requireProjectAccessTrpc } from "./project-access";
import {
  acknowledgePattern,
  computeProjectScopeCompleteness,
  getScopeChecklist,
  getScopeCompleteness,
  getScopeCompletenessSummary,
  listScopeCompleteness,
  refreshScopePatterns,
  ScopeCompletenessError,
} from "./scope-completeness-db";
import { SCOPE_COMPLETENESS_VERDICTS } from "@shared/domain/phase4-taxonomy";

function requireTenant(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant in session. Scope completeness data is tenant-scoped.",
    });
  }
  return tenantId;
}

function toTrpcError(err: unknown): never {
  if (err instanceof ScopeCompletenessError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      PROJECT_NOT_FOUND: "NOT_FOUND",
      SCORE_NOT_FOUND: "NOT_FOUND",
      NO_APPROVED_ESTIMATE: "PRECONDITION_FAILED",
      NO_ACTUALS: "PRECONDITION_FAILED",
      TENANT_MISMATCH: "FORBIDDEN",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

export const scopeCompletenessRouter = router({
  score: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const access = await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");

      try {
        return await computeProjectScopeCompleteness({
          tenantId: requireTenant(access.tenantId ?? ctx.tenantId),
          projectId: input.projectId,
          actorId: ctx.user.id,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Same computation without writing, so an estimator can look before the project closes. */
  preview: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const access = await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      try {
        const { result } = await computeProjectScopeCompleteness({
          tenantId: requireTenant(access.tenantId ?? ctx.tenantId),
          projectId: input.projectId,
          actorId: ctx.user.id,
          persist: false,
        });
        return result;
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getScopeCompleteness(input.projectId);
    }),

  list: protectedProcedure
    .input(
      z.object({
        projectType: z.string().max(100).optional(),
        verdict: z.enum(SCOPE_COMPLETENESS_VERDICTS).optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      return listScopeCompleteness({
        tenantId: requireTenant(ctx.tenantId),
        projectType: input.projectType,
        verdict: input.verdict,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  getSummary: protectedProcedure.query(async ({ ctx }) => {
    return getScopeCompletenessSummary(requireTenant(ctx.tenantId));
  }),

  /**
   * Recompute the checklist across every scored project.
   *
   * Admin-only because it rewrites what the estimating screen tells every estimator to check.
   */
  refreshPatterns: adminProcedure
    .input(z.object({ projectType: z.string().max(100).nullish() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await refreshScopePatterns({
          tenantId: requireTenant(ctx.tenantId),
          projectType: input.projectType ?? null,
          actorId: ctx.user.id,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** The pre-estimate checklist for a project type. Call this before writing a bid. */
  getChecklist: protectedProcedure
    .input(z.object({ projectType: z.string().min(1).max(100) }))
    .query(async ({ input, ctx }) => {
      return getScopeChecklist({
        tenantId: requireTenant(ctx.tenantId),
        projectType: input.projectType,
      });
    }),

  acknowledgePattern: protectedProcedure
    .input(z.object({ patternId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await acknowledgePattern({
          patternId: input.patternId,
          actorId: ctx.user.id,
          tenantId: requireTenant(ctx.tenantId),
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),
});
