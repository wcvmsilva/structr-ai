import { z } from "zod";
import { router, protectedProcedure, tenantProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getPipelineOverviewData,
  orchestrateLeadConversion,
  orchestrateDealWin,
  getFullPipelineState,
  PipelineTenantError,
  PipelineConversionIdentityError,
} from "./pipeline-db";

/** A cross-tenant reference is a permission failure, not a bad request. */
function rethrowTenantError(error: unknown): void {
  if (error instanceof PipelineTenantError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
}

/**
 * FORBIDDEN for identity/access denials (the caller or the persisted owner is not a
 * usable actor, or the caller has no ACL on the linked project); PRECONDITION_FAILED for
 * a record whose own state does not support the operation; CONFLICT for contradictory or
 * concurrently-changed state (more than one linked record).
 */
function rethrowConversionIdentityError(error: unknown): void {
  if (error instanceof PipelineConversionIdentityError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      ACTOR_INVALID: "FORBIDDEN",
      OWNER_INVALID: "PRECONDITION_FAILED",
      CONVERSION_LINK_INCONSISTENT: "PRECONDITION_FAILED",
      CONVERSION_LINK_AMBIGUOUS: "CONFLICT",
      PROJECT_ACCESS_DENIED: "FORBIDDEN",
    };
    throw new TRPCError({ code: codeMap[error.code] ?? "BAD_REQUEST", message: error.message });
  }
}

export const pipelineRouter = router({
  /** Get overview summary and funnel metrics */
  getOverview: tenantProcedure
    .query(async ({ ctx }) => {
      try {
        return await getPipelineOverviewData(ctx.tenantId ?? null);
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch pipeline overview: ${error.message}`,
        });
      }
    }),

  /** Convert a lead to a Client, Project, and Deal */
  convertLead: tenantProcedure
    .input(z.object({ leadId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await orchestrateLeadConversion(input.leadId, ctx.user.id, ctx.tenantId ?? null);
      } catch (error: any) {
        rethrowTenantError(error);
        rethrowConversionIdentityError(error);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to convert lead: ${error.message}`,
        });
      }
    }),

  /** Mark a deal as won and update related project/estimate */
  winDeal: tenantProcedure
    .input(z.object({ dealId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await orchestrateDealWin(input.dealId, ctx.user.id, ctx.tenantId ?? null);
      } catch (error: any) {
        rethrowTenantError(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to mark deal as won: ${error.message}`,
        });
      }
    }),

  /** Get full state for a deal (lead, client, project, estimate) */
  getDealState: tenantProcedure
    .input(z.object({ dealId: z.string() }))
    .query(async ({ input, ctx }) => {
      const state = await getFullPipelineState(input.dealId, ctx.tenantId ?? null);
      if (!state) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Pipeline state for Deal #${input.dealId} not found`,
        });
      }
      return state;
    }),
});
