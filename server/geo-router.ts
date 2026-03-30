/**
 * structr.ai — Geographic Intelligence Router
 * Sprint 11: Geographic Intelligence Layer
 *
 * tRPC procedures for geo zone management, zone detection,
 * and project zone assignment.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
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

// ══════════════════════════════════════════════════════════════════════
// GEO ROUTER
// ══════════════════════════════════════════════════════════════════════

export const geoRouter = router({
  // ── List all zones ──────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      includeInactive: z.boolean().optional().default(false),
    }).optional())
    .query(async ({ input }) => {
      return await listGeoZones({ includeInactive: input?.includeInactive });
    }),

  // ── Get zone by ID ──────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const zone = await getGeoZoneById(input.id);
      if (!zone) throw new Error("Zone not found");
      return zone;
    }),

  // ── Get zone by name ────────────────────────────────────────────
  getByName: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input }) => {
      const zone = await getGeoZoneByName(input.name);
      if (!zone) throw new Error("Zone not found");
      return zone;
    }),

  // ── Create zone (admin only) ────────────────────────────────────
  create: adminProcedure
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
      // Check for duplicate name
      const existing = await getGeoZoneByName(input.zoneName);
      if (existing) throw new Error(`Zone "${input.zoneName}" already exists`);

      return await createGeoZone({
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
  update: adminProcedure
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

      const result = await updateGeoZone(input.id, updateData, ctx.user.id);
      if (!result) throw new Error("Zone not found");
      return result;
    }),

  // ── Deactivate zone (admin only) ────────────────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const success = await deactivateGeoZone(input.id, ctx.user.id);
      if (!success) throw new Error("Zone not found");
      return { success: true };
    }),

  // ── Reactivate zone (admin only) ────────────────────────────────
  reactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const success = await reactivateGeoZone(input.id, ctx.user.id);
      if (!success) throw new Error("Zone not found");
      return { success: true };
    }),

  // ── Detect zone from ZIP code ───────────────────────────────────
  detectFromZip: protectedProcedure
    .input(z.object({ zipCode: z.string().min(5).max(10) }))
    .query(async ({ input }) => {
      // First try DB zones
      const dbZones = await loadActiveZonesForEngine();
      const detected = detectZoneFromZip(input.zipCode, dbZones);

      if (detected.zone) {
        return {
          found: true as const,
          zone: detected.zone,
          modifiers: getZoneModifiers(detected.zone),
          confidence: detected.confidence,
        };
      }

      // Fallback to built-in Charleston zones (add synthetic ids)
      const builtInZones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: -(i + 1) })) as GeoZoneData[];
      const fallback = detectZoneFromZip(input.zipCode, builtInZones);
      if (fallback.zone) {
        return {
          found: true as const,
          zone: fallback.zone,
          modifiers: getZoneModifiers(fallback.zone),
          confidence: fallback.confidence,
        };
      }

      return { found: false as const, zone: null, modifiers: null, confidence: "low" as const };
    }),

  // ── Detect zone from coordinates ────────────────────────────────
  detectFromCoords: protectedProcedure
    .input(z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .query(async ({ input }) => {
      const dbZones = await loadActiveZonesForEngine();
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

      // Fallback to built-in Charleston zones (add synthetic ids)
      const builtInZones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: -(i + 1) })) as GeoZoneData[];
      const fallback = detectZoneFromCoords(input.lat, input.lng, builtInZones);
      if (fallback.zone) {
        return {
          found: true as const,
          zone: fallback.zone,
          modifiers: getZoneModifiers(fallback.zone),
          confidence: fallback.confidence,
          distanceMiles: fallback.distanceMiles,
        };
      }

      return { found: false as const, zone: null, modifiers: null, confidence: "low" as const, distanceMiles: undefined };
    }),

  // ── Assign zone to project ──────────────────────────────────────
  assignToProject: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      zoneId: z.number().int().positive().optional(),
      zipCode: z.string().min(5).max(10).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      let snapshot;

      if (input.zoneId) {
        // Direct zone assignment by ID
        const zone = await getGeoZoneById(input.zoneId);
        if (!zone) throw new Error("Zone not found");

        const { dbZoneToEngineZone } = await import("./geo-db");
        const engineZone = dbZoneToEngineZone(zone);
        snapshot = getZoneModifiers(engineZone);
      } else if (input.zipCode) {
        // Auto-detect from ZIP code
        const dbZones = await loadActiveZonesForEngine();
        let result = detectZoneFromZip(input.zipCode, dbZones);

        if (!result.zone) {
          // Fallback to built-in zones
          const builtInZones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: -(i + 1) })) as GeoZoneData[];
          result = detectZoneFromZip(input.zipCode, builtInZones);
        }

        if (!result.zone) throw new Error(`No zone found for ZIP code ${input.zipCode}`);
        snapshot = getZoneModifiers(result.zone);
      } else {
        throw new Error("Either zoneId or zipCode must be provided");
      }

      const success = await assignZoneToProject(input.projectId, snapshot, ctx.user.id);
      if (!success) throw new Error("Project not found");

      return { success: true, snapshot };
    }),

  // ── Get project zone snapshot ───────────────────────────────────
  getProjectZone: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const snapshot = await getProjectZoneSnapshot(input.projectId);
      return { snapshot };
    }),

  // ── Zone statistics ─────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    return await getGeoZoneStats();
  }),

  // ── Seed Charleston zones (admin only) ──────────────────────────
  seedCharleston: adminProcedure.mutation(async ({ ctx }) => {
    const created = await seedCharlestonZones(ctx.user.id);
    return { created, message: `Seeded ${created} new Charleston zones` };
  }),

  // ── Get all built-in Charleston zones (for reference) ───────────
  charlestonZones: protectedProcedure.query(() => {
    // Add synthetic IDs for display
    return CHARLESTON_ZONES.map((z, i) => {
      const withId = { ...z, id: -(i + 1) } as GeoZoneData;
      return {
        ...withId,
        modifiers: getZoneModifiers(withId),
      };
    });
  }),

  // ── Sprint 15: Geocode an address ──────────────────────────────
  geocodeAddress: protectedProcedure
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
  reverseGeocode: protectedProcedure
    .input(z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .mutation(async ({ input }) => {
      return reverseGeocode(input.lat, input.lng);
    }),

  // ── Sprint 15: Full geocode + zone detection pipeline ──────────
  geocodeAndDetectZone: protectedProcedure
    .input(z.object({
      address: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      zipCode: z.string().nullish(),
      county: z.string().nullish(),
    }))
    .mutation(async ({ input }) => {
      const result = await geocodeAndDetectZone(input);
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
  checkServiceRadius: protectedProcedure
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
