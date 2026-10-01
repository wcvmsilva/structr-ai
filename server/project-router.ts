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
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, tenantProcedure, adminProcedure } from "./_core/trpc";
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
import { requireProjectAccessTrpc, ProjectAccessError } from "./project-access";
import { ProjectOperationBlockedError, ProjectStatusTransitionInvalidError } from "@shared/project-operation-guard";

/**
 * createProject/updateProject/updateProjectStatus now authorize and apply the negative
 * payload barrier inside their own transaction (server/project-db.ts) — this translates
 * each typed error they threw into the corresponding tRPC code. Identity/ACL failures keep
 * their original codes (NOT_FOUND/FORBIDDEN/BAD_REQUEST); the operational barrier maps to
 * PRECONDITION_FAILED (mirroring the existing LegacyEstimateOperationError →
 * estimate-router.ts:101 pattern); a recognized-but-illegal status transition (neither
 * forbidden nor a legal next hop) maps to BAD_REQUEST — a client input problem, revealed
 * only after authorization already ran, never a generic INTERNAL_SERVER_ERROR.
 */
function translateProjectOperationError(error: unknown): never {
  if (error instanceof ProjectAccessError) {
    throw new TRPCError({ code: error.code, message: error.message, cause: error });
  }
  if (error instanceof ProjectOperationBlockedError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof ProjectStatusTransitionInvalidError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

const projectTypeEnum = z.enum([
  "remodel", "new_construction", "repair", "insurance_restoration",
  "commercial_buildout", "addition", "exterior",
]);

// Canonical channel enum — "direct" replaces legacy "residential"
const channelEnum = z.enum(["direct", "insurance", "commercial"]);

// `.unknown().optional()` below is deliberately NOT a validated, writable field — it
// exists only so Zod preserves the key instead of silently stripping it before the
// helper's assertNoOperationalProjectPayload() ever sees it (a mixed payload like
// {notes, actualTotal:null} was passing through to a PARTIAL silent success — notes
// applied, actualTotal dropped without a trace — because Zod discarded the unrecognized
// key before the barrier could refuse the whole request). None of these keys gain a real
// writer; the helper still only applies the fields it always applied. All 11 — the 7
// direct helper field names plus the router's 4 alias names for the same governed data —
// are recognized on BOTH create and update (V3 correction: V2 only added `status` to
// create's schema; the other 8 were still silently stripped there. approvedBudgetCents/
// changeOrderBudgetCents were still silently stripped on both routes — same bug, same fix
// shape, added here).
const forbiddenOperationalShape = {
  status: z.unknown().optional(),
  estimatedTotal: z.unknown().optional(),
  actualTotal: z.unknown().optional(),
  variancePct: z.unknown().optional(),
  startDate: z.unknown().optional(),
  endDate: z.unknown().optional(),
  estimatedValue: z.unknown().optional(),
  actualCost: z.unknown().optional(),
  grossProfit: z.unknown().optional(),
  profitShieldMinPct: z.unknown().optional(),
  approvedBudgetCents: z.unknown().optional(),
  changeOrderBudgetCents: z.unknown().optional(),
};

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
  // create has no legitimate caller-chosen status or financial value at all; recognizing
  // these keys (rather than letting Zod strip them) lets createProject() refuse the whole
  // attempt instead of silently creating a default project while discarding the request.
  ...forbiddenOperationalShape,
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
  notes: z.string().nullish(),
  assignedTo: z.string().uuid().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  // V3 correction: `status` here is recognized ONLY to be refused, same as create — a
  // formation/cancellation transition belongs exclusively to the dedicated, approve-gated
  // project.updateStatus route (updateProject() is called by this router WITHOUT the
  // trusted allowFormationStatus option, so ANY defined status here is refused wholesale,
  // never applied — see updateProject()'s own doc in project-db.ts and
  // assertNoOperationalProjectPayload()'s doc in shared/project-operation-guard.ts).
  ...forbiddenOperationalShape,
});

export const projectRouter = router({
  create: tenantProcedure
    .input(createProjectSchema)
    .mutation(async ({ input, ctx }) => {
      const normalized = {
        ...input,
        channel: (normalizeChannel(input.channel) ?? input.channel) as any,
        projectType: (normalizeProjectType(input.projectType) ?? input.projectType) as any,
      };
      // tenantId/ownerUserId are createProject()'s own trusted-context parameters now
      // (V2 correction) — ctx.tenantId/ctx.user.id are passed directly, never merged into
      // the business payload, so there is nothing for even a direct caller to override.
      const project = await createProject(normalized, ctx.user.id, ctx.tenantId).catch(translateProjectOperationError);

      // Sprint 15: Auto-geocode on create if address fields are present
      const addressFields = { address: input.address, city: input.city, state: input.state, zipCode: input.zip };
      const validation = validateAddressForGeocoding(addressFields);
      if (validation.isValid && project) {
        try {
          // G3a-1: zone detection is scoped to the caller's tenant, so a new project can
          // only ever be stamped with its own tenant's geo policy.
          const geoResult = await geocodeAndDetectZone(ctx.tenantId, addressFields);
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

  list: tenantProcedure
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
      return listProjects({ ...(input ?? {}), tenantId: ctx.tenantId });
    }),

  update: tenantProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateProjectSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Authorization now runs inside updateProject() itself, transactionally, against
      // the same row it is about to mutate (project-db.ts) — this is the real gate, not a
      // pre-check; a separate non-transactional requireProjectAccessTrpc() call here would
      // be redundant and looser (no row lock, no shared handle with the mutation+audit).
      const result = await updateProject(input.id, input.data, ctx.user.id, ctx.tenantId)
        .catch(translateProjectOperationError);

      // Sprint 15: Re-geocode if address fields changed
      const addressChanged = input.data.address !== undefined || input.data.city !== undefined ||
        input.data.state !== undefined || input.data.zipCode !== undefined;
      if (addressChanged) {
        try {
          await refreshProjectGeocode(ctx.tenantId, input.id, ctx.user.id);
        } catch {
          // Geocoding failure should not block project update
        }
      }

      return result;
    }),

  updateStatus: tenantProcedure
    .input(
      z.object({
        id: z.string(),
        // V2 correction: was `statusEnum` (a 7-value z.enum excluding "closed"), which
        // made Zod reject "closed" as a format error BEFORE ctx/authorization ever ran —
        // a caller learned "closed is an unrecognized shape" regardless of whether they
        // could touch this project at all. A loose string lets requireProjectAccess run
        // first for every value; updateProjectStatus() itself then refuses the four
        // forbidden destinations (PRECONDITION_FAILED) and, for anything else, its
        // existing assertValidStatusTransition() still rejects a genuinely unrecognized
        // value — no format validation is lost, only its ORDER relative to authorization.
        status: z.string().min(1).max(32),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Status transitions are approval-grade actions; authorization ("approve") and the
      // operational-destination barrier both run inside updateProjectStatus() itself,
      // transactionally.
      return updateProjectStatus(input.id, input.status, ctx.user.id, ctx.tenantId)
        .catch(translateProjectOperationError);
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Authorization ("delete") and the transition check now run inside deleteProject()
      // itself, transactionally, against the same row and handle it mutates — the same
      // correction already applied to update/updateStatus. Upgraded from
      // protectedProcedure to tenantProcedure so ctx.tenantId is guaranteed resolved
      // before reaching the helper's expectedTenantId (the same B2 guarantee every other
      // mutation on this router already relies on).
      return deleteProject(input.id, ctx.user.id, ctx.tenantId)
        .catch(translateProjectOperationError);
    }),

  getByClient: tenantProcedure
    .input(z.object({ clientName: z.string() }))
    .query(async ({ input, ctx }) => {
      return getProjectsByClient(input.clientName, ctx.tenantId);
    }),

  stats: tenantProcedure.query(async ({ ctx }) => {
    return getProjectStats(ctx.tenantId);
  }),

  // ── Sprint 15: Geocode project address ──────────────────────────
  geocode: tenantProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // The project guard authorizes the destination; the zone read behind
      // refreshProjectGeocode is authorized separately by ctx.tenantId.
      await requireProjectAccessTrpc(input.id, ctx.user.id, "write");

      const result = await refreshProjectGeocode(ctx.tenantId, input.id, ctx.user.id);
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
