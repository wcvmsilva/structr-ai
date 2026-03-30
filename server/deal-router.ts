import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import * as dealDb from "./deal-db";
import { TRPCError } from "@trpc/server";
import { validateStageTransition, suggestNextAction } from "../shared/deal-engine";
import { DEAL_STAGES } from "../shared/domain/taxonomy";

export const dealRouter = router({
  create: protectedProcedure
    .input(z.object({
      title: z.string(),
      stage: z.enum(DEAL_STAGES as any),
      leadId: z.string().uuid().optional(),
      clientId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      value: z.number().optional(),
      probability: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const deal = await dealDb.createDeal({
        ...input,
        value: input.value?.toString(),
        createdBy: ctx.user.id,
      });
      return deal;
    }),

  getById: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ input }) => {
      const deal = await dealDb.getDealById(input);
      if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      return deal;
    }),

  list: protectedProcedure
    .input(z.object({
      stage: z.string().optional(),
      assignedTo: z.string().uuid().optional(),
    }).optional())
    .query(async ({ input }) => {
      return dealDb.listDeals(input);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: z.object({
        name: z.string().optional(),
        stage: z.string().optional(),
        value: z.number().optional().or(z.null()),
        notes: z.string().optional().or(z.null()),
        closureDate: z.date().optional().or(z.null()),
      })
    }))
    .mutation(async ({ input, ctx }) => {
      return dealDb.updateDeal(input.id, input.data, ctx.user.id);
    }),

  advanceStage: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      newStage: z.enum(DEAL_STAGES as any),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const deal = await dealDb.getDealById(input.id);
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });

      const isValid = validateStageTransition(deal.stage, input.newStage);
      if (!isValid) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid stage transition" });

      return dealDb.updateDealStage(input.id, input.newStage, ctx.user.id, input.notes);
    }),

  markWon: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      actualCloseDate: z.date().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return dealDb.markWon(input.id, input.projectId, input.actualCloseDate || new Date(), ctx.user.id);
    }),

  markLost: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      lostReason: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      return dealDb.markLost(input.id, input.lostReason, ctx.user.id);
    }),

  linkEstimate: protectedProcedure
    .input(z.object({ id: z.string().uuid(), estimateId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return dealDb.linkEstimate(input.id, input.estimateId, ctx.user.id);
    }),

  addActivity: protectedProcedure
    .input(z.object({
      dealId: z.string().uuid(),
      activityType: z.enum(["email", "note", "call", "sms", "meeting", "status_change"]),
      description: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return dealDb.addDealActivity({
        ...input,
        performedBy: ctx.user.id,
      });
    }),

  getActivities: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ input }) => {
      return dealDb.getDealActivities(input);
    }),

  stats: protectedProcedure
    .query(async () => {
      return dealDb.getDealStats();
    }),

  staleDeals: protectedProcedure
    .query(async () => {
      return dealDb.getStaleDeals();
    }),

  forecast: protectedProcedure
    .input(z.object({
      period: z.enum(["30d", "60d", "90d", "all"]).optional(),
    }).optional())
    .query(async () => {
      return dealDb.getPipelineForecast();
    }),

  suggestNextAction: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ input }) => {
      const deal = await dealDb.getDealById(input);
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });
      
      return suggestNextAction(deal);
    }),
});
