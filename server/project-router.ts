/**
 * structr.ai — Project tRPC Router (Sprint 10)
 *
 * Procedures:
 *   - project.create         (protected) → create new project
 *   - project.getById        (protected) → get project by id
 *   - project.list           (protected) → list projects with search/filter/pagination
 *   - project.update         (protected) → update project fields
 *   - project.updateStatus   (protected) → change project status (state machine)
 *   - project.delete         (admin)     → soft delete project
 *   - project.getByClient    (protected) → list projects for a client
 *   - project.stats          (protected) → aggregate stats
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { normalizeChannel, normalizeProjectType } from "@shared/domain/normalization";
import {
  createProject,
  getProjectById,
  listProjects,
  updateProject,
  updateProjectStatus,
  deleteProject,
  getProjectsByClient,
  getProjectStats,
} from "./project-db";
import { geocodeAndDetectZone, persistGeocodeResult, refreshProjectGeocode } from "./geo-integration";
import { validateAddressForGeocoding } from "./geo-geocoding";
import { requireProjectAccessTrpc } from "./project-access";

const projectTypeEnum = z.enum([
  "remodel", "new_construction", "repair", "insurance_restoration",
  "commercial_buildout", "addition", "exterior",
]);

// Canonical channel enum — "direct" replaces legacy "residential"
const channelEnum = z.enum(["direct", "insurance", "commercial"]);

const statusEnum = z.enum([
  "intake", "estimating", "review", "approved",
  "in_progress", "completed", "cancelled",
]);

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  clientName: z.string().max(255).nullish(),
  clientEmail: z.string().email().max(320).nullish(),
  address: z.string().nullish(),
  city: z.string().max(128).nullish(),
  state: z.string().max(2).nullish(),
  zip: z.string().max(10).nullish(),
  projectType: projectTypeEnum.optional(),
  channel: channelEnum.optional(),
  notes: z.string().nullish(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  clientName: z.string().max(255).nullish(),
  clientEmail: z.string().email().max(320).nullish(),
  address: z.string().nullish(),
  city: z.string().max(128).nullish(),
  county: z.string().max(128).nullish(),
  state: z.string().max(2).nullish(),
  zipCode: z.string().max(10).nullish(),
  region: z.string().max(80).nullish(),
  zone: z.string().max(80).nullish(),
  projectType: projectTypeEnum.optional(),
  channel: channelEnum.optional(),
  estimatedValue: z.string().nullish(),
  actualCost: z.string().nullish(),
  grossProfit: z.string().nullish(),
  profitShieldMinPct: z.string().nullish(),
  notes: z.string().nullish(),
  assignedTo: z.string().uuid().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const projectRouter = router({
  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ input, ctx }) => {
      const normalized = {
        ...input,
        // PHASE 1: stamp tenant + owner so requireProjectAccess can authorize later calls.
        tenantId: ctx.tenantId ?? undefined,
        ownerUserId: ctx.user.id,
        channel: (normalizeChannel(input.channel) ?? input.channel) as any,
        projectType: (normalizeProjectType(input.projectType) ?? input.projectType) as any,
      };
      const project = await createProject(normalized, ctx.user.id);

      // Sprint 15: Auto-geocode on create if address fields are present
      const addressFields = { address: input.address, city: input.city, state: input.state, zipCode: input.zip };
      const validation = validateAddressForGeocoding(addressFields);
      if (validation.isValid && project) {
        try {
          const geoResult = await geocodeAndDetectZone(addressFields);
          if (geoResult.success) {
            await persistGeocodeResult({
              projectId: project.id,
              geocode: geoResult.geocode,
              userId: ctx.user.id,
              zoneSnapshot: geoResult.zoneSnapshot,
            });
          }
        } catch {
          // Geocoding failure should not block project creation
        }
      }

      return project;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.id, ctx.user.id, "read");

      const project = await getProjectById(input.id);
      if (!project) throw new Error(`Project ${input.id} not found`);
      return project;
    }),

  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.string().optional(),
        channel: z.string().optional(),
        clientName: z.string().optional(),
        projectType: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      // Tenant scoping is applied inside listProjects().
      return listProjects({ ...(input ?? {}), tenantId: ctx.tenantId ?? undefined });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateProjectSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.id, ctx.user.id, "write");

      const result = await updateProject(input.id, input.data, ctx.user.id);

      // Sprint 15: Re-geocode if address fields changed
      const addressChanged = input.data.address !== undefined || input.data.city !== undefined ||
        input.data.state !== undefined || input.data.zipCode !== undefined;
      if (addressChanged) {
        try {
          await refreshProjectGeocode(input.id, ctx.user.id);
        } catch {
          // Geocoding failure should not block project update
        }
      }

      return result;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        status: statusEnum,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Status transitions are approval-grade actions.
      await requireProjectAccessTrpc(input.id, ctx.user.id, "approve");
      return updateProjectStatus(input.id, input.status, ctx.user.id);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.id, ctx.user.id, "delete");
      return deleteProject(input.id, ctx.user.id);
    }),

  getByClient: protectedProcedure
    .input(z.object({ clientName: z.string() }))
    .query(async ({ input, ctx }) => {
      return getProjectsByClient(input.clientName, ctx.tenantId ?? undefined);
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return getProjectStats(ctx.tenantId ?? undefined);
  }),

  // ── Sprint 15: Geocode project address ──────────────────────────
  geocode: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.id, ctx.user.id, "write");

      const result = await refreshProjectGeocode(input.id, ctx.user.id);
      return {
        success: result.success,
        geocode: {
          latitude: result.geocode.latitude,
          longitude: result.geocode.longitude,
          formattedAddress: result.geocode.formattedAddress,
          confidence: result.geocode.confidence,
          source: result.geocode.source,
          distanceFromCenter: result.geocode.distanceFromCenter,
          withinServiceRadius: result.geocode.withinServiceRadius,
        },
        zone: result.zoneSnapshot ? {
          name: result.zoneSnapshot.zoneName,
          coastalExposure: result.zoneSnapshot.coastalExposureLevel,
        } : null,
        warnings: result.warnings,
        persisted: result.persisted,
      };
    }),

  // ── Sprint 15: Validate address for geocoding ──────────────────
  validateAddress: protectedProcedure
    .input(z.object({
      address: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      zipCode: z.string().nullish(),
    }))
    .query(({ input }) => {
      return validateAddressForGeocoding(input);
    }),
});
