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
import { CHANNELS, FINISH_LEVELS } from "@shared/domain/taxonomy";
import { createIntakeSchema } from "@shared/intake-formation-engine";
import { requirePermission } from "./rbac";
import { geocodeAndDetectZone, persistGeocodeResult } from "./geo-integration";
import { validateAddressForGeocoding } from "./geo-geocoding";
import { getClientById } from "./client-db";
import {
  router,
  protectedProcedure,
  tenantProcedure,
  resolveAuthenticatedIntakeIdentity,
} from "./_core/trpc";
import { isAuthenticatedDataApiMode, isIntakeFormationEnabled } from "./_core/database-mode";
import { callAuthenticatedIntakeCreate, AuthenticatedDataApiError } from "./authenticated-data-api";
import { decodeAuthenticatedIntakeCreate } from "./authenticated-intake-create";
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
const channelEnum = z.enum(CHANNELS);
const finishLevelEnum = z.enum(FINISH_LEVELS);
const intakeStatusEnum = z.enum(["draft", "parsing", "parsed", "reviewed", "converted"]);

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

/**
 * IF-1 sanitized failures. Only fixed, content-free messages leave this branch:
 * no SQL state, provider body, stack or request detail, and no claim that the
 * remote transaction rolled back when the result is simply unknown.
 */
const INTAKE_FORMATION_UNAVAILABLE =
  "This intake submission could not be confirmed. Check Intake before submitting it again.";
const INTAKE_FORMATION_MESSAGES = {
  UNAUTHORIZED: "This intake submission could not be authorized. Sign in again.",
  FORBIDDEN: "Creating an intake is not available to your account.",
  NOT_FOUND: "This intake submission is not available to your account.",
  BAD_REQUEST: "This intake request is not valid.",
  CONFLICT: "This intake request conflicts with an existing submission. Review Intake before submitting it again.",
  INTERNAL_SERVER_ERROR: INTAKE_FORMATION_UNAVAILABLE,
} as const;

function intakeFormationError(code: keyof typeof INTAKE_FORMATION_MESSAGES): TRPCError {
  return new TRPCError({ code, message: INTAKE_FORMATION_MESSAGES[code] });
}

export const intakeRouter = router({
  create: tenantProcedure
    .input(createIntakeSchema)
    .mutation(async ({ input, ctx }) => {
      // IF-1 (ADR-002 addendum): under the authenticated Data API this endpoint
      // owns exactly one operation, the gated newProject formation through
      // POST public.structr_intake_create_v1(preimage text). Everything else —
      // existing project/client/lead targets, the legacy Drizzle formation, the
      // RBAC/client/project lookups, geocoding and extra audit — stays closed
      // here, and there is no SQL fallback on this boundary.
      if (isAuthenticatedDataApiMode()) {
        if (!isIntakeFormationEnabled() || !input.newProject) throw intakeFormationError("FORBIDDEN");
        const identity = resolveAuthenticatedIntakeIdentity(ctx);
        if (!identity) throw intakeFormationError("FORBIDDEN");
        try {
          const raw = await callAuthenticatedIntakeCreate(ctx.req, input, {
            actorId: ctx.user.id,
            tenantId: ctx.tenantId,
          });
          // The real decoder binds the envelope to this actor, tenant, request ID
          // and the exact command bytes before anything is returned.
          return decodeAuthenticatedIntakeCreate(raw, input, identity);
        } catch (error) {
          const codes = {
            unauthorized: "UNAUTHORIZED", forbidden: "FORBIDDEN", not_found: "NOT_FOUND",
            invalid_request: "BAD_REQUEST", conflict: "CONFLICT", unavailable: "INTERNAL_SERVER_ERROR",
          } as const;
          // Conflicts are never resubmitted here; the transport already retries
          // only 40001/40P01, and an uncertain result proves no rollback.
          throw intakeFormationError(
            error instanceof AuthenticatedDataApiError ? codes[error.kind] : "INTERNAL_SERVER_ERROR",
          );
        }
      }

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
