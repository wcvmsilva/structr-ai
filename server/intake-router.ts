/**
 * structr.ai — Intake tRPC Router (Sprint 10)
 *
 * Procedures:
 *   - intake.create         (protected) → create new intake form
 *   - intake.getById        (protected) → get intake form by id
 *   - intake.list           (protected) → list intake forms with filter/pagination
 *   - intake.update         (protected) → update intake form fields
 *   - intake.updateStatus   (protected) → change intake status (state machine)
 *   - intake.getByProject   (protected) → list intake forms for a project
 *   - intake.getByClient    (protected) → list intake forms for a client
 *   - intake.stats          (protected) → aggregate stats
 *
 * Note: IDs are now strings (uuid). Detail fields are packed into formData jsonb.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PROJECT_TYPES } from "@shared/domain/taxonomy";
import { requirePermission } from "./rbac";
import { geocodeAndDetectZone, persistGeocodeResult } from "./geo-integration";
import { validateAddressForGeocoding } from "./geo-geocoding";
import { getClientById } from "./client-db";
import { router, protectedProcedure, tenantProcedure } from "./_core/trpc";
import {
  createIntakeForm,
  getIntakeFormById,
  listIntakeForms,
  updateIntakeForm,
  updateIntakeStatus,
  getIntakeFormsByProject,
  getIntakeFormsByClient,
  getIntakeStats,
} from "./intake-db";
import { requireProjectAccessTrpc, requireEntityAccess } from "./project-access";

// Canonical channel enum — "direct" replaces legacy "residential"
const channelEnum = z.enum(["direct", "insurance", "commercial"]);
const finishLevelEnum = z.enum(["standard", "premium", "luxury"]);
const intakeStatusEnum = z.enum(["draft", "parsing", "parsed", "reviewed", "converted"]);

const createIntakeSchema = z.object({
  requestId: z.string().uuid().optional(),
  newProject: z.object({
    name: z.string().trim().min(1).max(255),
    projectType: z.enum(PROJECT_TYPES),
    client: z.object({
      firstName: z.string().trim().min(1).max(128), lastName: z.string().trim().min(1).max(128),
      email: z.string().email().max(320).optional(), phone: z.string().max(64).optional(),
    }),
    address: z.string().trim().min(1).max(1000), city: z.string().max(128).optional(), county: z.string().max(128).optional(),
    state: z.string().max(2).optional(), zip: z.string().max(10).optional(),
  }).optional(),
  projectId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
  clientId: z.string().uuid().nullish(),
  channel: channelEnum.optional(),
  serviceType: z.string().max(128).nullish(),
  area: z.string().max(255).nullish(),
  finishLevel: finishLevelEnum.optional(),
  condition: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  rawPayload: z.record(z.string(), z.unknown()),
}).superRefine((input, ctx) => {
  if (input.newProject && !input.serviceType?.trim()) ctx.addIssue({ code: "custom", message: "Service type is required for a new project." });
  if (input.newProject && (!input.requestId || input.projectId || input.clientId || input.leadId)) {
    ctx.addIssue({ code: "custom", message: "Combined creation requires a request ID and cannot include existing project, client, or lead IDs." });
  }
});

const updateIntakeSchema = z.object({
  projectId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
  clientId: z.string().uuid().nullish(),
  channel: channelEnum.optional(),
  serviceType: z.string().max(128).nullish(),
  area: z.string().max(255).nullish(),
  finishLevel: finishLevelEnum.optional(),
  condition: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
  parsedScope: z.record(z.string(), z.unknown()).nullish(),
  confidenceScore: z.string().nullish(),
  status: intakeStatusEnum.optional(),
});

export const intakeRouter = router({
  create: tenantProcedure
    .input(createIntakeSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.newProject && ctx.user.role !== "admin") {
        await requirePermission(ctx.user.id, "client", "write");
      }
      if (input.clientId) {
        const client = await getClientById(input.clientId, { tenantId: ctx.tenantId });
        if (!client || client.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }
      // An intake form may exist before a project (lead-only intake); guard only when linked.
      if (input.projectId) {
        await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");
      }

      // Pass input directly; createIntakeForm will pack it into formData
      const form = await createIntakeForm({ ...input, tenantId: ctx.tenantId }, ctx.user.id);
      // Preserve the existing project.create geographic enrichment after the atomic
      // business write; an unavailable geocoder leaves the explicit scope warning.
      if (input.newProject && form.projectId) {
        const fields = { address: input.newProject.address, city: input.newProject.city, state: input.newProject.state, zipCode: input.newProject.zip };
        if (validateAddressForGeocoding(fields).isValid) {
          try {
            const result = await geocodeAndDetectZone(ctx.tenantId, fields);
            if (result.success) await persistGeocodeResult({ projectId: form.projectId, geocode: result.geocode, zoneSnapshot: result.zoneSnapshot, userId: ctx.user.id });
          } catch { /* The persisted project remains available with unresolved geo context. */ }
        }
      }
      return form;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const form = await getIntakeFormById(input.id);
      if (!form) throw new Error(`Intake form ${input.id} not found`);
      if (form.projectId) {
        await requireProjectAccessTrpc(form.projectId, ctx.user.id, "read");
      }
      return form;
    }),

  list: tenantProcedure
    .input(
      z.object({
        status: z.string().optional(),
        projectId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      if (input?.projectId) {
        await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      }
      return listIntakeForms({ ...(input ?? {}), tenantId: ctx.tenantId });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateIntakeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getIntakeFormById(input.id);
      if (!existing) throw new Error(`Intake form ${input.id} not found`);
      if (existing.projectId) {
        await requireProjectAccessTrpc(existing.projectId, ctx.user.id, "write");
      }
      // Re-parenting an intake into another project requires access to the target project too.
      if (input.data.projectId) {
        await requireProjectAccessTrpc(input.data.projectId, ctx.user.id, "write");
      }

      return updateIntakeForm(input.id, input.data, ctx.user.id);
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: intakeStatusEnum,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getIntakeFormById(input.id);
      if (!existing) throw new Error(`Intake form ${input.id} not found`);
      if (existing.projectId) {
        await requireProjectAccessTrpc(existing.projectId, ctx.user.id, "approve");
      }

      return updateIntakeStatus(input.id, input.status, ctx.user.id);
    }),

  getByProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return getIntakeFormsByProject(input.projectId);
    }),

  getByClient: tenantProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getIntakeFormsByClient(input.clientId, ctx.tenantId);
    }),

  stats: tenantProcedure.query(async ({ ctx }) => {
    return getIntakeStats(ctx.tenantId);
  }),
});
