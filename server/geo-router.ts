/**
 * structr.ai — Geographic Intelligence Router
 * Sprint 11: Geographic Intelligence Layer
 *
 * tRPC procedures for geo zone management, zone detection,
 * and project zone assignment.
 *
 * ── G3a-1 — GEO-ZONE TENANT POLICY BOUNDARY ─────────────────────────────────
 *
 * `geo_zones` rows carry tenant commercial policy (modifiers, contingency, profit
 * floor). Every route that reads or writes that policy now runs behind
 * `tenantProcedure`, and the admin mutations behind `adminTenantProcedure`:
 * **admin role is not tenant identity**, and an admin with no resolved tenant has no
 * tenant whose policy they could be administering.
 *
 * `ctx.tenantId` is passed explicitly to every helper. No route accepts a tenant field
 * from the caller, and none may be added.
 *
 * Scoping is STRICT (`geo-db.ts`): a NULL-owned zone is unknown provenance and is
 * unreachable, unlike the transitional NULL arm the bundle domain still carries.
 *
 * Two things this router deliberately does NOT do, both deferred to G3b:
 *   - it does not make the operating centre / service radius tenant-configurable. Those
 *     remain hard-coded GCHI operating policy in server/geo-geocoding.ts. G3a-1 gates the
 *     routes that expose them behind a resolved tenant and documents the limit rather
 *     than inventing a service-area contract.
 *   - it does not decompose reference geography from tenant policy in the schema.
 */

import { z } from "zod";
import { router, tenantProcedure, adminTenantProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createGeoZone,
  getGeoZoneById,
  getGeoZoneByName,
  listGeoZones,
  updateGeoZone,
  deactivateGeoZone,
  reactivateGeoZone,
  loadActiveZonesForEngine,
  assignZoneToProject,
  getProjectZoneSnapshot,
  getGeoZoneStats,
  seedCharlestonZones,
} from "./geo-db";
import {
  detectZoneFromZip,
  detectZoneFromCoords,
  getZoneModifiers,
  CHARLESTON_ZONES,
  type GeoZoneData,
} from "@shared/geo-engine";
import { geocodeAddress, reverseGeocode, isWithinServiceRadius, distanceFromOperatingCenter } from "./geo-geocoding";
import { geocodeAndDetectZone } from "./geo-integration";
import { requireProjectAccessTrpc } from "./project-access";

// ══════════════════════════════════════════════════════════════════════
// GEO ROUTER
// ══════════════════════════════════════════════════════════════════════

export const geoRouter = router({
  // ── List all zones ──────────────────────────────────────────────
  list: tenantProcedure
    .input(z.object({
      includeInactive: z.boolean().optional().default(false),
    }).optional())
    .query(async ({ input, ctx }) => {
      return await listGeoZones(ctx.tenantId, { includeInactive: input?.includeInactive });
    }),

  // ── Get zone by ID ──────────────────────────────────────────────
  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      // Foreign, NULL-owned and nonexistent are indistinguishable here by design.
      const zone = await getGeoZoneById(ctx.tenantId, input.id);
      if (!zone) throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });
      return zone;
    }),

  // ── Get zone by name ────────────────────────────────────────────
  getByName: tenantProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const zone = await getGeoZoneByName(ctx.tenantId, input.name);
      if (!zone) throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });
      return zone;
    }),

  // ── Create zone (admin only) ────────────────────────────────────
  create: adminTenantProcedure
    .input(z.object({
      zoneName: z.string().min(1).max(100),
      county: z.string().min(1).max(100),
      zipCodes: z.array(z.string()).optional(),
      centerLat: z.number().min(-90).max(90).optional(),
      centerLng: z.number().min(-180).max(180).optional(),
      radiusMiles: z.number().positive().optional().default(15),
      coastalExposureLevel: z.enum(["none", "low", "moderate", "high", "extreme"]).optional().default("none"),
      logisticsComplexity: z.enum(["standard", "moderate", "complex"]).optional().default("standard"),
      laborModifier: z.number().min(0.5).max(3.0).optional().default(1.0),
      logisticsModifier: z.number().min(0.5).max(3.0).optional().default(1.0),
      materialModifier: z.number().min(0.5).max(3.0).optional().default(1.0),
      contingencyPct: z.number().min(0).max(50).optional().default(5),
      minProfitShieldPct: z.number().min(0).max(80).optional().default(35),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Duplicate check is TENANT-SCOPED. A global name check would both leak the
      // existence of another tenant's zone (an oracle this unit must not introduce) and
      // wrongly block a tenant from naming its own zone "Charleston Coastal".
      const existing = await getGeoZoneByName(ctx.tenantId, input.zoneName);
      if (existing) throw new TRPCError({
        code: "CONFLICT",
        message: `Zone "${input.zoneName}" already exists`,
      });

      // Ownership comes from ctx.tenantId only; the input schema carries no tenant field
      // and the helper's data type excludes tenantId, so a caller cannot supply one.
      return await createGeoZone(ctx.tenantId, {
        name: input.zoneName,
        zoneName: input.zoneName,
        county: input.county,
        zipCodes: input.zipCodes ?? null,
        centerLat: input.centerLat != null ? String(input.centerLat) as any : null,
        centerLng: input.centerLng != null ? String(input.centerLng) as any : null,
        radiusMiles: String(input.radiusMiles) as any,
        coastalExposureLevel: input.coastalExposureLevel,
        logisticsComplexity: input.logisticsComplexity,
        laborModifier: String(input.laborModifier) as any,
        logisticsModifier: String(input.logisticsModifier) as any,
        materialModifier: String(input.materialModifier) as any,
        contingencyPct: String(input.contingencyPct) as any,
        minProfitShieldPct: String(input.minProfitShieldPct) as any,
        description: input.description ?? null,
        isActive: true,
      }, ctx.user.id);
    }),

  // ── Update zone (admin only) ────────────────────────────────────
  update: adminTenantProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: z.object({
        zoneName: z.string().min(1).max(100).optional(),
        county: z.string().min(1).max(100).optional(),
        zipCodes: z.array(z.string()).optional(),
        centerLat: z.number().min(-90).max(90).optional(),
        centerLng: z.number().min(-180).max(180).optional(),
        radiusMiles: z.number().positive().optional(),
        coastalExposureLevel: z.enum(["none", "low", "moderate", "high", "extreme"]).optional(),
        logisticsComplexity: z.enum(["standard", "moderate", "complex"]).optional(),
        laborModifier: z.number().min(0.5).max(3.0).optional(),
        logisticsModifier: z.number().min(0.5).max(3.0).optional(),
        materialModifier: z.number().min(0.5).max(3.0).optional(),
        contingencyPct: z.number().min(0).max(50).optional(),
        minProfitShieldPct: z.number().min(0).max(80).optional(),
        description: z.string().optional(),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      const updateData: Record<string, any> = {};

      // Convert numeric fields to string for decimal columns
      for (const [key, value] of Object.entries(input.data)) {
        if (value === undefined) continue;
        if (["centerLat", "centerLng", "radiusMiles", "laborModifier", "logisticsModifier",
             "materialModifier", "contingencyPct", "minProfitShieldPct"].includes(key)) {
          updateData[key] = String(value);
        } else {
          updateData[key] = value;
        }
      }

      const result = await updateGeoZone(ctx.tenantId, input.id, updateData, ctx.user.id);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });
      return result;
    }),

  // ── Deactivate zone (admin only) ────────────────────────────────
  deactivate: adminTenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const success = await deactivateGeoZone(ctx.tenantId, input.id, ctx.user.id);
      if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });
      return { success: true };
    }),

  // ── Reactivate zone (admin only) ────────────────────────────────
  reactivate: adminTenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // The helper now authorizes before writing, so a nonexistent or foreign id returns
      // false here instead of reporting success and auditing a row it never touched.
      const success = await reactivateGeoZone(ctx.tenantId, input.id, ctx.user.id);
      if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });
      return { success: true };
    }),

  // ── Detect zone from ZIP code ───────────────────────────────────
  detectFromZip: tenantProcedure
    .input(z.object({ zipCode: z.string().min(5).max(10) }))
    .query(async ({ input, ctx }) => {
      // Detection runs over the caller tenant's OWN zones. The built-in CHARLESTON_ZONES
      // fallback that used to run here is gone: it returned GCHI's modifiers and profit
      // floor to any tenant whose ZIP did not match one of its own zones.
      const dbZones = await loadActiveZonesForEngine(ctx.tenantId);
      const detected = detectZoneFromZip(input.zipCode, dbZones);

      if (detected.zone) {
        return {
          found: true as const,
          zone: detected.zone,
          modifiers: getZoneModifiers(detected.zone),
          confidence: detected.confidence,
        };
      }

      return { found: false as const, zone: null, modifiers: null, confidence: "low" as const };
    }),

  // ── Detect zone from coordinates ────────────────────────────────
  detectFromCoords: tenantProcedure
    .input(z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .query(async ({ input, ctx }) => {
      // Same-tenant zones only; CHARLESTON_ZONES commercial fallback removed (see above).
      const dbZones = await loadActiveZonesForEngine(ctx.tenantId);
      const detected = detectZoneFromCoords(input.lat, input.lng, dbZones);

      if (detected.zone) {
        return {
          found: true as const,
          zone: detected.zone,
          modifiers: getZoneModifiers(detected.zone),
          confidence: detected.confidence,
          distanceMiles: detected.distanceMiles,
        };
      }

      return { found: false as const, zone: null, modifiers: null, confidence: "low" as const, distanceMiles: undefined };
    }),

  // ── Assign zone to project ──────────────────────────────────────
  assignToProject: tenantProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      zoneId: z.string().uuid().optional(),
      zipCode: z.string().min(5).max(10).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // The project guard authorizes the DESTINATION. It says nothing about the source
      // zone, so the zone is authorized separately — the snapshot written here becomes
      // durable project state, and must never be built from another tenant's policy.
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");

      let snapshot;

      if (input.zoneId) {
        // Direct zone assignment by ID, within the caller's tenant.
        const zone = await getGeoZoneById(ctx.tenantId, input.zoneId);
        if (!zone) throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });

        const { dbZoneToEngineZone } = await import("./geo-db");
        const engineZone = dbZoneToEngineZone(zone);
        snapshot = getZoneModifiers(engineZone);
      } else if (input.zipCode) {
        // Auto-detect from ZIP code over the caller tenant's own zones. The built-in
        // Charleston fallback is removed: it could stamp GCHI policy onto any project.
        const dbZones = await loadActiveZonesForEngine(ctx.tenantId);
        const result = detectZoneFromZip(input.zipCode, dbZones);

        if (!result.zone) throw new TRPCError({
          code: "NOT_FOUND",
          message: `No zone found for ZIP code ${input.zipCode}`,
        });
        snapshot = getZoneModifiers(result.zone);
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either zoneId or zipCode must be provided",
        });
      }

      const success = await assignZoneToProject(input.projectId, snapshot, ctx.user.id);
      if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      return { success: true, snapshot };
    }),

  // ── Get project zone snapshot ───────────────────────────────────
  getProjectZone: tenantProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      const snapshot = await getProjectZoneSnapshot(input.projectId);
      return { snapshot };
    }),

  // ── Zone statistics ─────────────────────────────────────────────
  // Aggregates over tenant policy are still tenant policy: zone counts and average
  // modifiers describe a tenant's commercial posture.
  stats: tenantProcedure.query(async ({ ctx }) => {
    return await getGeoZoneStats(ctx.tenantId);
  }),

  // ── Seed Charleston zones (admin only) ──────────────────────────
  // Seeds into the ADMIN'S OWN TENANT. Previously this both created NULL-owned rows and
  // used a global zone-name check, so a second tenant seeding after GCHI silently created
  // nothing and was left with no policy at all.
  seedCharleston: adminTenantProcedure.mutation(async ({ ctx }) => {
    const created = await seedCharlestonZones(ctx.tenantId, ctx.user.id);
    return { created, message: `Seeded ${created} new Charleston zones` };
  }),

  // ── Built-in Charleston zones — REFERENCE-ONLY projection ───────
  //
  // DECISION-1. This constant is NOT platform reference data as the original ADR text
  // assumed: `CHARLESTON_ZONES` carries GCHI commercial policy — laborModifier,
  // materialModifier, logisticsModifier, contingencyPct and minProfitShieldPct (up to
  // 50.0). The route used to return all of it, plus computed modifiers, to any
  // authenticated caller.
  //
  // It now returns only genuinely geographic fields. Two fields are deliberately EXCLUDED
  // rather than exposed, because they participate in operating and pricing decisions and
  // could not be cleanly classified as reference: `radiusMiles` (geometry AND service-area
  // policy) and `coastalExposureLevel` (physically determined BUT drives risk pricing).
  // Where a field cannot be cleanly classified, this unit excludes it.
  charlestonZones: tenantProcedure.query(() => {
    return CHARLESTON_ZONES.map((z, i) => ({
      id: String(-(i + 1)),
      zoneName: z.zoneName,
      county: z.county,
      zipCodes: z.zipCodes,
      centerLat: z.centerLat,
      centerLng: z.centerLng,
    }));
  }),

  // ── Sprint 15: Geocode an address ──────────────────────────────
  geocodeAddress: tenantProcedure
    .input(z.object({
      address: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      zipCode: z.string().nullish(),
      county: z.string().nullish(),
    }))
    .mutation(async ({ input }) => {
      return geocodeAddress(input);
    }),

  // ── Sprint 15: Reverse geocode coordinates ─────────────────────
  reverseGeocode: tenantProcedure
    .input(z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .mutation(async ({ input }) => {
      return reverseGeocode(input.lat, input.lng);
    }),

  // ── Sprint 15: Full geocode + zone detection pipeline ──────────
  geocodeAndDetectZone: tenantProcedure
    .input(z.object({
      address: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      zipCode: z.string().nullish(),
      county: z.string().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await geocodeAndDetectZone(ctx.tenantId, input);
      return {
        success: result.success,
        geocode: {
          latitude: result.geocode.latitude,
          longitude: result.geocode.longitude,
          formattedAddress: result.geocode.formattedAddress,
          confidence: result.geocode.confidence,
          withinServiceRadius: result.geocode.withinServiceRadius,
          distanceFromCenter: result.geocode.distanceFromCenter,
        },
        zone: result.zoneSnapshot ? {
          name: result.zoneSnapshot.zoneName,
          coastalExposure: result.zoneSnapshot.coastalExposureLevel,
          laborModifier: result.zoneSnapshot.laborModifier,
          materialModifier: result.zoneSnapshot.materialModifier,
          logisticsModifier: result.zoneSnapshot.logisticsModifier,
        } : null,
        warnings: result.warnings,
      };
    }),

  // ── Sprint 15: Check if coordinates are within service radius ──
  checkServiceRadius: tenantProcedure
    .input(z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .query(({ input }) => {
      return {
        withinRadius: isWithinServiceRadius(input.lat, input.lng),
        distanceMiles: Math.round(distanceFromOperatingCenter(input.lat, input.lng) * 100) / 100,
      };
    }),
});
