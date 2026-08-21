import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as leadDb from "./lead-db";
import { scoreLead, classifyPriority, detectDuplicateLead } from "@shared/lead-engine";
import { orchestrateLeadConversion, PipelineTenantError } from "./pipeline-db";
import { TRPCError } from "@trpc/server";
// PHASE 2 — governed lead → client → project conversion
import {
  convertLeadToProject,
  LeadConversionError,
  planLeadConversion,
  resolveProjectGeoContext,
} from "./lead-conversion";
import {
  CLIENT_TYPES,
  COMMERCIAL_CHANNELS,
  LEAD_SOURCE_CHANNELS,
  PREVISIT_NEXT_STEPS,
} from "@shared/domain/phase2-taxonomy";
import { requireProjectAccessTrpc } from "./project-access";
// Authorization for lead reads/writes: resolves the caller's tenant (and, when
// LEADS_OWNER_SCOPE is on, ownership) scope. See server/lead-access.ts.
import { resolveLeadScope } from "./lead-access";

/** Map a conversion error to the correct tRPC code. */
function mapConversionError(err: unknown): never {
  if (err instanceof LeadConversionError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      LEAD_NOT_FOUND: "NOT_FOUND",
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      MINIMUM_DATA_MISSING: "BAD_REQUEST",
      NEEDS_REVIEW: "PRECONDITION_FAILED",
      TENANT_MISMATCH: "FORBIDDEN",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err.plan ?? err,
    });
  }
  throw err;
}

/** Operator completions accepted when converting a lead. */
const conversionOverridesSchema = z
  .object({
    clientName: z.string().max(255).nullish(),
    email: z.string().max(255).nullish(),
    phone: z.string().max(64).nullish(),
    siteAddress: z.string().max(500).nullish(),
    city: z.string().max(128).nullish(),
    state: z.string().max(64).nullish(),
    zip: z.string().max(16).nullish(),
    projectType: z.string().max(64).nullish(),
    clientType: z.enum(CLIENT_TYPES).nullish(),
    commercialChannel: z.enum(COMMERCIAL_CHANNELS).nullish(),
    sourceChannel: z.enum(LEAD_SOURCE_CHANNELS).nullish(),
    nextStep: z.enum(PREVISIT_NEXT_STEPS).nullish(),
  })
  .optional();

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
      const scope = resolveLeadScope(ctx);

      // 1. Detect duplicates (within the caller's scope only)
      let allLeads: any[] = [];
      try {
        allLeads = await leadDb.listLeads(scope);
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
        // Stamp the caller's tenant so the lead is created inside the scope every
        // lead read/write is now filtered by (otherwise new rows stay tenant-less
        // and remain visible to every tenant while TENANT_STRICT is off).
        tenantId: ctx.tenantId ?? null,
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
    .query(async ({ input, ctx }) => {
      const lead = await leadDb.getLeadById(input.id, resolveLeadScope(ctx));
      if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      return lead;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      urgency: z.string().optional(),
      ownerUserId: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return await leadDb.listLeads(resolveLeadScope(ctx), input);
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input, ctx }) => {
      return await leadDb.searchLeads(input.query, resolveLeadScope(ctx));
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
      return await leadDb.updateLead(input.id, updateData, resolveLeadScope(ctx), ctx.user.id);
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(["new", "contacted", "qualified", "disqualified", "converted"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const scope = resolveLeadScope(ctx);
      if (input.status === "disqualified") {
        return await leadDb.disqualifyLead(input.id, input.reason || "No reason", scope);
      }
      return await leadDb.updateLeadStatus(input.id, input.status, scope, ctx.user.id);
    }),

  /**
   * PHASE 2 — convert a lead into a canonical client + project.
   *
   * Enforces the minimum data set, reuses an existing client instead of duplicating it,
   * refuses to create a second project at the same address for the same project type,
   * stamps tenant_id on everything it creates, and resolves the geo context so the Scope
   * Builder receives zone and coastal warnings automatically.
   */
  convertToProject: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        overrides: conversionOverridesSchema,
        /** Skip geo resolution (useful when the address is known to be unresolvable). */
        resolveGeo: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await convertLeadToProject({
          leadId: input.id,
          tenantId: ctx.tenantId ?? null,
          userId: ctx.user.id,
          overrides: input.overrides ?? undefined,
          resolveGeo: input.resolveGeo,
        });
      } catch (err) {
        return mapConversionError(err);
      }
    }),

  /**
   * Evaluate the conversion decision without writing anything.
   * Returns missing minimum fields, duplicate matches and the normalized payload.
   */
  planConversion: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        overrides: conversionOverridesSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        return await planLeadConversion({
          leadId: input.id,
          tenantId: ctx.tenantId ?? null,
          userId: ctx.user.id,
          overrides: input.overrides ?? undefined,
        });
      } catch (err) {
        return mapConversionError(err);
      }
    }),

  /** Re-resolve the geo context of a converted project (zone, coastal risk, warnings). */
  refreshGeoContext: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");
      try {
        return await resolveProjectGeoContext(input.projectId, ctx.user.id);
      } catch (err) {
        return mapConversionError(err);
      }
    }),

  /**
   * LEGACY conversion path (pre-Phase 2). Kept for backward compatibility only.
   * It does not enforce the minimum data set or dedupe; prefer `convertToProject`.
   */
  convertToProjectLegacy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await orchestrateLeadConversion(input.id, ctx.user.id, ctx.tenantId ?? null);
      } catch (err) {
        if (err instanceof PipelineTenantError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
    }),

  addActivity: protectedProcedure
    .input(z.object({
      leadId: z.string(),
      activityType: z.enum(["note", "call", "email", "sms", "meeting", "status_change"]),
      description: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return await leadDb.addLeadActivity({
        leadId: input.leadId,
        activityType: input.activityType,
        description: input.description,
      }, resolveLeadScope(ctx));
    }),

  getActivities: protectedProcedure
    .input(z.object({ leadId: z.string() }))
    .query(async ({ input, ctx }) => {
      return await leadDb.getLeadActivities(input.leadId, resolveLeadScope(ctx));
    }),
});
