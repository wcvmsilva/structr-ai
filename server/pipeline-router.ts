import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { 
  getPipelineOverviewData, 
  orchestrateLeadConversion, 
  orchestrateDealWin, 
  getFullPipelineState 
} from "./pipeline-db";

export const pipelineRouter = router({
  /** Get overview summary and funnel metrics */
  getOverview: protectedProcedure
    .query(async () => {
      try {
        return await getPipelineOverviewData();
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch pipeline overview: ${error.message}`,
        });
      }
    }),

  /** Convert a lead to a Client, Project, and Deal */
  convertLead: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await orchestrateLeadConversion(input.leadId, ctx.user.id);
      } catch (error: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to convert lead: ${error.message}`,
        });
      }
    }),

  /** Mark a deal as won and update related project/estimate */
  winDeal: protectedProcedure
    .input(z.object({ dealId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await orchestrateDealWin(input.dealId, ctx.user.id);
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to mark deal as won: ${error.message}`,
        });
      }
    }),

  /** Get full state for a deal (lead, client, project, estimate) */
  getDealState: protectedProcedure
    .input(z.object({ dealId: z.number() }))
    .query(async ({ input }) => {
      const state = await getFullPipelineState(input.dealId);
      if (!state) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Pipeline state for Deal #${input.dealId} not found`,
        });
      }
      return state;
    }),
});
