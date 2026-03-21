import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as leadDb from "./lead-db";
import { detectDuplicateLead, scoreLead, classifyPriority } from "@shared/lead-engine";
import { orchestrateLeadConversion } from "./pipeline-db";
import { TRPCError } from "@trpc/server";

export const leadRouter = router({
  create: protectedProcedure
    .input(z.object({
      source: z.enum(["website", "email", "phone", "referral", "social", "walk_in"]),
      channel: z.enum(["direct", "insurance", "commercial"]),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      serviceTypeInterest: z.string().optional(),
      estimatedBudget: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Detect duplicates
      const allLeads = await leadDb.listLeads(); // Ideally we search specifically
      const dupCheck = detectDuplicateLead(input as any, allLeads as any[]);
      if (dupCheck.isDuplicate) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Duplicate lead detected",
        });
      }

      // 2. Score and classify
      const scoring = scoreLead(input as any);
      const priority = classifyPriority(scoring.score);

      // 3. Create
      const lead = await leadDb.createLead({
        ...input,
        email: input.email || null,
        estimatedBudget: input.estimatedBudget ? input.estimatedBudget.toString() : null,
        status: "new",
        priority,
        createdBy: ctx.user.id,
      });

      return lead;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const lead = await leadDb.getLeadById(input.id);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      return lead;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      priority: z.string().optional(),
      assignedTo: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return await leadDb.listLeads(input);
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return await leadDb.searchLeads(input.query);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      data: z.record(z.string(), z.any()), // Partial updates
    }))
    .mutation(async ({ input, ctx }) => {
      return await leadDb.updateLead(input.id, input.data, ctx.user.id);
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["new", "contacted", "qualified", "disqualified", "converted"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.status === "disqualified") {
        return await leadDb.disqualifyLead(input.id, input.reason || "No reason", ctx.user.id);
      }
      return await leadDb.updateLeadStatus(input.id, input.status, ctx.user.id);
    }),

  convertToProject: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return await orchestrateLeadConversion(input.id, ctx.user.id);
    }),

  addActivity: protectedProcedure
    .input(z.object({
      leadId: z.number(),
      activityType: z.enum(["note", "call", "email", "sms", "meeting", "status_change"]),
      description: z.string(),
      metadata: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return await leadDb.addLeadActivity({
        ...input,
        performedBy: ctx.user.id,
      });
    }),

  getActivities: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      return await leadDb.getLeadActivities(input.leadId);
    }),
});
