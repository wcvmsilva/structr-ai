import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as leadDb from "./lead-db";
import { scoreLead, classifyPriority, detectDuplicateLead } from "@shared/lead-engine";
import { orchestrateLeadConversion } from "./pipeline-db";
import { TRPCError } from "@trpc/server";

export const leadRouter = router({
  /** Diagnostic: dump trigger function source code and RLS for leads table (admin only) */
  diagSchema: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return { error: "DB not available" };

    try {
      const { sql } = await import("drizzle-orm");

      return await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL role = 'postgres'`);

        // 1. Triggers on leads
        const triggers = await tx.execute(sql`
          SELECT tgname, pg_get_triggerdef(oid) as definition
          FROM pg_trigger
          WHERE tgrelid = 'public.leads'::regclass AND NOT tgisinternal
        `);

        // 2. Full source of trigger functions on leads table
        const triggerFunctions = await tx.execute(sql`
          SELECT p.proname, pg_get_functiondef(p.oid) as full_definition
          FROM pg_trigger t
          JOIN pg_proc p ON t.tgfoid = p.oid
          WHERE t.tgrelid = 'public.leads'::regclass AND NOT t.tgisinternal
        `);

        // 3. Also search for any function containing "Authentication required"
        const authFunctions = await tx.execute(sql`
          SELECT proname, prosrc
          FROM pg_proc
          WHERE prosrc LIKE '%Authentication required%'
        `);

        // 4. RLS status
        const rlsStatus = await tx.execute(sql`
          SELECT relname, relrowsecurity, relforcerowsecurity
          FROM pg_class WHERE oid = 'public.leads'::regclass
        `);

        // 5. RLS policies
        const rlsPolicies = await tx.execute(sql`
          SELECT policyname, permissive, roles, cmd, qual, with_check
          FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'leads'
        `);

        // 6. Profiles in DB
        const profilesSample = await tx.execute(sql`
          SELECT id, full_name, role FROM profiles LIMIT 5
        `);

        return {
          triggers,
          triggerFunctions,
          authFunctions,
          rlsStatus,
          rlsPolicies,
          profilesSample,
        };
      });
    } catch (err: any) {
      return { error: err.message, code: err.code, detail: err.detail };
    }
  }),

  create: protectedProcedure
    .input(z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      source: z.string().optional().default("website"),
      channel: z.string().optional(),
      serviceTypeInterest: z.string().optional(),
      estimatedBudget: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || "Unknown";
      console.log("[CreateLead] Input:", JSON.stringify(input));

      // 1. Detect duplicates
      let allLeads: any[] = [];
      try {
        allLeads = await leadDb.listLeads();
        console.log("[CreateLead] Dup check: found", allLeads.length, "existing leads");
      } catch (err: any) {
        console.error("[CreateLead] listLeads FAILED:", err.message, "code=", err.code, "detail=", err.detail);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to check duplicates: ${err.message} (code=${err.code})`,
        });
      }

      const dupCheck = detectDuplicateLead(
        { name, email: input.email, phone: input.phone, zip: input.zip },
        allLeads as any[]
      );
      if (dupCheck.isDuplicate) {
        throw new TRPCError({ code: "CONFLICT", message: "Duplicate lead detected" });
      }

      // 2. Score and classify
      const scoring = scoreLead({
        name,
        email: input.email || null,
        phone: input.phone || null,
        zip: input.zip || null,
        source: input.source || "website",
        serviceType: input.serviceTypeInterest || "general",
      } as any);
      const urgency = classifyPriority(scoring.score) === "hot"
        ? "high"
        : classifyPriority(scoring.score) === "warm"
          ? "medium"
          : "low";

      // 3. Build notes
      let notes = input.notes || "";
      if (input.channel && input.channel !== "direct") {
        notes = `[Channel: ${input.channel}] ${notes}`.trim();
      }
      if (input.estimatedBudget) {
        notes = `[Budget: $${input.estimatedBudget.toLocaleString()}] ${notes}`.trim();
      }

      // 4. Ensure profile exists for ownerUserId (prevents FK violation)
      try {
        await leadDb.ensureProfileExists(ctx.user.id, ctx.user.fullName || "Dev User");
      } catch (err: any) {
        console.warn("[CreateLead] ensureProfile warning:", err.message);
      }

      // 5. Insert lead (bypassRLS handles Supabase auth)
      const payload = {
        name,
        email: input.email || null,
        phone: input.phone || null,
        address: input.address || "",
        city: input.city || null,
        state: input.state || null,
        zip: input.zip || null,
        source: input.source || "website",
        serviceType: input.serviceTypeInterest || "general",
        urgency,
        leadScore: scoring.score,
        status: "new" as const,
        ownerUserId: ctx.user.id,
        notes: notes || null,
      };
      console.log("[CreateLead] Insert payload:", JSON.stringify(payload));

      try {
        // Pass userId so createLead sets Supabase auth context (for triggers that check auth.uid())
        const lead = await leadDb.createLead(payload, ctx.user.id);
        console.log("[CreateLead] SUCCESS: id=", lead.id);
        return lead;
      } catch (err: any) {
        console.error("[CreateLead] INSERT FAILED:", err.message, "code=", err.code, "detail=", err.detail, "constraint=", err.constraint);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Lead insert failed: ${err.message} (code=${err.code}, detail=${err.detail || "none"}, constraint=${err.constraint || "none"})`,
        });
      }
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const lead = await leadDb.getLeadById(input.id);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      return lead;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      urgency: z.string().optional(),
      ownerUserId: z.string().optional(),
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
      id: z.string(),
      data: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")).or(z.null()),
        phone: z.string().optional().or(z.null()),
        address: z.string().optional(),
        city: z.string().optional().or(z.null()),
        state: z.string().optional().or(z.null()),
        zip: z.string().optional().or(z.null()),
        source: z.string().optional(),
        serviceType: z.string().optional(),
        serviceTypeInterest: z.string().optional(),
        urgency: z.string().optional(),
        status: z.string().optional(),
        notes: z.string().optional().or(z.null()),
        estimatedBudget: z.number().optional(),
        channel: z.string().optional(),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      const { firstName, lastName, serviceTypeInterest, estimatedBudget, channel, ...rest } = input.data;
      const updateData: Record<string, unknown> = { ...rest };
      if (firstName !== undefined || lastName !== undefined) {
        updateData.name = [firstName, lastName].filter(Boolean).join(" ").trim();
      }
      if (serviceTypeInterest !== undefined) {
        updateData.serviceType = serviceTypeInterest;
      }
      return await leadDb.updateLead(input.id, updateData, ctx.user.id);
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(["new", "contacted", "qualified", "disqualified", "converted"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.status === "disqualified") {
        return await leadDb.disqualifyLead(input.id, input.reason || "No reason");
      }
      return await leadDb.updateLeadStatus(input.id, input.status, ctx.user.id);
    }),

  convertToProject: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        console.log(`[ConvertLead] Starting conversion for lead ${input.id}`);
        const result = await orchestrateLeadConversion(input.id, ctx.user.id);
        console.log(`[ConvertLead] Success:`, result);
        return result;
      } catch (err: any) {
        console.error(`[ConvertLead] FAILED for lead ${input.id}:`, err.message, err.stack);
        throw err;
      }
    }),

  addActivity: protectedProcedure
    .input(z.object({
      leadId: z.string(),
      activityType: z.enum(["note", "call", "email", "sms", "meeting", "status_change"]),
      description: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await leadDb.addLeadActivity({
        leadId: input.leadId,
        activityType: input.activityType,
        description: input.description,
      });
    }),

  getActivities: protectedProcedure
    .input(z.object({ leadId: z.string() }))
    .query(async ({ input }) => {
      return await leadDb.getLeadActivities(input.leadId);
    }),
});
