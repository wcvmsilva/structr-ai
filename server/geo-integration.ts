/**
 * structr.ai — Geocode → Zone Integration Bridge (Sprint 15)
 *
 * Orchestrates the full pipeline:
 *   Address → Geocode → Coordinates → Zone Detection → Snapshot → DB Persistence
 *
 * This module bridges geo-geocoding.ts (address resolution) with
 * geo-engine.ts (zone detection) and geo-db.ts (zone persistence).
 *
 * Functions:
 *   - geocodeAndDetectZone()    → full pipeline: address → zone snapshot
 *   - persistGeocodeResult()    → save geocode data to project record
 *   - refreshProjectGeocode()   → re-geocode and re-detect zone for existing project
 */

import {
  geocodeAddress,
  type GeocodeResult,
  type ProjectGeocodeFields,
} from "./geo-geocoding";
import {
  detectZoneFromCoords,
  getZoneModifiers,
  CHARLESTON_ZONES,
  type GeoZoneData,
  type ZoneModifierSnapshot,
  type ZoneDetectionResult,
} from "@shared/geo-engine";
import { loadActiveZonesForEngine, assignZoneToProject } from "./geo-db";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface GeocodeAndZoneResult {
  geocode: GeocodeResult;
  zoneDetection: ZoneDetectionResult | null;
  zoneSnapshot: ZoneModifierSnapshot | null;
  /** Combined warnings from geocoding and zone detection */
  warnings: string[];
  /** Overall pipeline success */
  success: boolean;
}

export interface PersistGeocodeInput {
  projectId: string;
  geocode: GeocodeResult;
  userId?: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// GEOCODE → ZONE PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Full pipeline: geocode address → detect zone from coordinates → build snapshot.
 * Does NOT persist to DB — caller decides when/how to save.
 */
export async function geocodeAndDetectZone(
  fields: ProjectGeocodeFields
): Promise<GeocodeAndZoneResult> {
  const warnings: string[] = [];

  // Step 1: Geocode address
  const geocode = await geocodeAddress(fields);

  if (!geocode.success || geocode.latitude == null || geocode.longitude == null) {
    if (geocode.warning) warnings.push(geocode.warning);
    return {
      geocode,
      zoneDetection: null,
      zoneSnapshot: null,
      warnings,
      success: false,
    };
  }

  if (geocode.warning) warnings.push(geocode.warning);

  // Step 2: Detect zone from coordinates
  // First try DB zones, then fall back to built-in Charleston zones
  let dbZones: GeoZoneData[];
  try {
    dbZones = await loadActiveZonesForEngine();
  } catch {
    dbZones = [];
  }

  let zoneDetection: ZoneDetectionResult;
  if (dbZones.length > 0) {
    zoneDetection = detectZoneFromCoords(geocode.latitude, geocode.longitude, dbZones);
  } else {
    // Fallback to built-in Charleston zones with synthetic IDs
    const builtInZones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: String(-(i + 1)) })) as unknown as GeoZoneData[];
    zoneDetection = detectZoneFromCoords(geocode.latitude, geocode.longitude, builtInZones);
  }

  if (zoneDetection.warning) warnings.push(zoneDetection.warning);

  // Step 3: Build zone modifier snapshot
  let zoneSnapshot: ZoneModifierSnapshot | null = null;
  if (zoneDetection.zone) {
    zoneSnapshot = getZoneModifiers(zoneDetection.zone);
  } else {
    warnings.push("No zone detected from coordinates — zone modifiers will not be applied.");
  }

  return {
    geocode,
    zoneDetection,
    zoneSnapshot,
    warnings,
    success: true,
  };
}

// ══════════════════════════════════════════════════════════════════════
// DB PERSISTENCE
// ══════════════════════════════════════════════════════════════════════

/**
 * Persist geocode result to a project record.
 * Updates latitude, longitude, geocode_confidence, geocode_source, geocoded_address, geocoded_at.
 * Optionally assigns zone if zoneSnapshot is provided.
 */
export async function persistGeocodeResult(
  input: PersistGeocodeInput & { zoneSnapshot?: ZoneModifierSnapshot | null }
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const { projectId, geocode, userId, zoneSnapshot } = input;

  // Capture before state
  const [before] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!before) return false;

  // Build update payload
  const updateData: Record<string, unknown> = {
    latitude: geocode.latitude?.toString() ?? null,
    longitude: geocode.longitude?.toString() ?? null,
    geocodeConfidence: geocode.confidence,
    geocodeSource: geocode.source,
    geocodedAddress: geocode.formattedAddress,
    geocodedAt: geocode.success ? new Date() : null,
    updatedBy: userId ?? null,
  };

  // If zone snapshot provided, also update zone fields
  if (zoneSnapshot) {
    updateData.zone = zoneSnapshot.zoneName;
    updateData.zoneModifierSnapshot = zoneSnapshot;
  }

  await db.update(projects).set(updateData).where(eq(projects.id, projectId));

  // Audit: geocode resolved
  await logAudit({
    userId: userId ?? null,
    action: geocode.success ? "project.geocode_resolved" : "project.geocode_failed",
    tableName: "projects",
    recordId: projectId,
    before: {
      latitude: (before as any).latitude,
      longitude: (before as any).longitude,
      geocodeConfidence: before.geocodeConfidence,
      zone: before.zone,
    },
    after: {
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      geocodeConfidence: geocode.confidence,
      geocodedAddress: geocode.formattedAddress,
      zone: zoneSnapshot?.zoneName ?? before.zone,
    },
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  // If zone changed, log separate zone audit
  if (zoneSnapshot && before.zone !== zoneSnapshot.zoneName) {
    await logAudit({
      userId: userId ?? null,
      action: before.zone ? "project.zone_changed" : "project.zone_assigned",
      tableName: "projects",
      recordId: projectId,
      before: { zone: before.zone, zoneModifierSnapshot: before.zoneModifierSnapshot },
      after: { zone: zoneSnapshot.zoneName, zoneModifierSnapshot: zoneSnapshot },
    }).catch((err) => console.error("[Audit] write failed:", err.message));
  }

  return true;
}

/**
 * Re-geocode an existing project and update its geocode + zone data.
 * Used when address is updated or when user requests a refresh.
 */
export async function refreshProjectGeocode(
  projectId: string,
  userId?: string | null
): Promise<GeocodeAndZoneResult & { persisted: boolean }> {
  const db = await getDb();
  if (!db) {
    return {
      geocode: {
        success: false, latitude: null, longitude: null, formattedAddress: null,
        confidence: "failed", source: "google_maps", locationType: null, placeId: null,
        distanceFromCenter: null, withinServiceRadius: false,
        warning: "Database not available", addressComponents: null,
      },
      zoneDetection: null,
      zoneSnapshot: null,
      warnings: ["Database not available"],
      success: false,
      persisted: false,
    };
  }

  // Load project
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    return {
      geocode: {
        success: false, latitude: null, longitude: null, formattedAddress: null,
        confidence: "failed", source: "google_maps", locationType: null, placeId: null,
        distanceFromCenter: null, withinServiceRadius: false,
        warning: `Project ${projectId} not found`, addressComponents: null,
      },
      zoneDetection: null,
      zoneSnapshot: null,
      warnings: [`Project ${projectId} not found`],
      success: false,
      persisted: false,
    };
  }

  // Run geocode + zone pipeline
  const result = await geocodeAndDetectZone({
    address: project.address,
    city: project.city,
    state: project.state,
    zipCode: project.zip,
    county: project.county,
  });

  // Persist results
  const persisted = await persistGeocodeResult({
    projectId,
    geocode: result.geocode,
    userId,
    zoneSnapshot: result.zoneSnapshot,
  });

  return { ...result, persisted };
}
