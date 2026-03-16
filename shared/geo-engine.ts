/**
 * structr.ai — Geographic Intelligence Engine
 * Sprint 11: Geographic Intelligence Layer
 *
 * Pure business logic for geographic zone detection and modifier resolution.
 * No database dependencies — works with in-memory zone data.
 *
 * Key capabilities:
 *   1. detectZoneFromZip()    — match ZIP code to zone
 *   2. detectZoneFromCoords() — find closest zone by lat/lng (Haversine)
 *   3. getZoneModifiers()     — extract modifier snapshot from zone
 *   4. applyZoneToProject()   — merge zone modifiers into project context
 *   5. zoneToPricingDimensions() — convert zone snapshot to PricingDimensions
 */

import type { PricingDimensions } from "./pricing-engine";
import { round2 } from "./utils/math";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Minimal zone data needed for detection (no DB dependency) */
export interface GeoZoneData {
  id: number;
  zoneName: string;
  county: string | null;
  zipCodes: string[] | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusMiles: number;
  coastalExposureLevel: "none" | "low" | "moderate" | "high" | "extreme";
  logisticsComplexity: "standard" | "moderate" | "complex" | "extreme";
  laborModifier: number;
  logisticsModifier: number;
  materialModifier: number;
  contingencyPct: number;
  minProfitShieldPct: number;
  isActive: boolean;
}

/** Zone modifier snapshot for persistence in project context */
export interface ZoneModifierSnapshot {
  zoneId: number;
  zoneName: string;
  laborModifier: number;
  logisticsModifier: number;
  materialModifier: number;
  contingencyPct: number;
  minProfitShieldPct: number;
  coastalExposureLevel: string;
  capturedAt: string; // ISO timestamp
}

/** Result of zone detection */
export interface ZoneDetectionResult {
  zone: GeoZoneData | null;
  method: "zip" | "coordinates" | "default";
  confidence: "high" | "medium" | "low";
  distanceMiles?: number;
  warning?: string;
}

/** Project geographic context */
export interface ProjectGeoContext {
  zone: string;
  zoneId: number;
  zoneModifierSnapshot: ZoneModifierSnapshot;
  coastalExposureLevel: string;
  contingencyPct: number;
  minProfitShieldPct: number;
}

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Default zone name when detection fails */
export const DEFAULT_ZONE_NAME = "Charleston Metro";

/** Maximum service radius in miles */
export const MAX_SERVICE_RADIUS_MILES = 60;

/** Coastal exposure level ordering for comparison */
export const COASTAL_EXPOSURE_ORDER: Record<string, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};

// ══════════════════════════════════════════════════════════════════════
// ZONE DETECTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Detect zone from a ZIP code.
 * Searches all active zones' zipCodes arrays for a match.
 */
export function detectZoneFromZip(
  zip: string,
  zones: GeoZoneData[]
): ZoneDetectionResult {
  if (!zip || typeof zip !== "string") {
    return {
      zone: null,
      method: "zip",
      confidence: "low",
      warning: "No ZIP code provided",
    };
  }

  const normalizedZip = zip.trim().substring(0, 5); // Take first 5 digits
  const activeZones = zones.filter(z => z.isActive);

  for (const zone of activeZones) {
    if (zone.zipCodes && zone.zipCodes.includes(normalizedZip)) {
      return {
        zone,
        method: "zip",
        confidence: "high",
      };
    }
  }

  // ZIP not found in any zone
  return {
    zone: null,
    method: "zip",
    confidence: "low",
    warning: `ZIP code ${normalizedZip} not found in any configured zone`,
  };
}

/**
 * Detect zone from latitude/longitude coordinates.
 * Uses Haversine formula to find the closest zone center.
 */
export function detectZoneFromCoords(
  lat: number,
  lng: number,
  zones: GeoZoneData[]
): ZoneDetectionResult {
  if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) {
    return {
      zone: null,
      method: "coordinates",
      confidence: "low",
      warning: "Invalid coordinates provided",
    };
  }

  const activeZones = zones.filter(z => z.isActive && z.centerLat != null && z.centerLng != null);

  if (activeZones.length === 0) {
    return {
      zone: null,
      method: "coordinates",
      confidence: "low",
      warning: "No zones with coordinates configured",
    };
  }

  let closestZone: GeoZoneData | null = null;
  let closestDistance = Infinity;

  for (const zone of activeZones) {
    const distance = haversineDistance(lat, lng, zone.centerLat!, zone.centerLng!);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestZone = zone;
    }
  }

  if (!closestZone) {
    return {
      zone: null,
      method: "coordinates",
      confidence: "low",
      warning: "Could not determine closest zone",
    };
  }

  // Check if within zone radius
  const withinRadius = closestDistance <= closestZone.radiusMiles;
  // Check if within max service radius
  const withinServiceArea = closestDistance <= MAX_SERVICE_RADIUS_MILES;

  if (!withinServiceArea) {
    return {
      zone: closestZone,
      method: "coordinates",
      confidence: "low",
      distanceMiles: round2(closestDistance),
      warning: `Location is ${round2(closestDistance)} miles from nearest zone center (${closestZone.zoneName}). Outside ${MAX_SERVICE_RADIUS_MILES}-mile service radius.`,
    };
  }

  return {
    zone: closestZone,
    method: "coordinates",
    confidence: withinRadius ? "high" : "medium",
    distanceMiles: round2(closestDistance),
    warning: withinRadius
      ? undefined
      : `Location is ${round2(closestDistance)} miles from ${closestZone.zoneName} center (radius: ${closestZone.radiusMiles} mi). Assigned to closest zone.`,
  };
}

/**
 * Detect zone using best available data.
 * Priority: ZIP code → coordinates → default.
 */
export function detectZone(
  input: { zip?: string; lat?: number; lng?: number },
  zones: GeoZoneData[]
): ZoneDetectionResult {
  // Try ZIP first (highest confidence)
  if (input.zip) {
    const zipResult = detectZoneFromZip(input.zip, zones);
    if (zipResult.zone) return zipResult;
  }

  // Try coordinates
  if (input.lat !== undefined && input.lng !== undefined) {
    const coordResult = detectZoneFromCoords(input.lat, input.lng, zones);
    if (coordResult.zone) return coordResult;
  }

  // Default to Charleston Metro
  const defaultZone = zones.find(
    z => z.isActive && z.zoneName === DEFAULT_ZONE_NAME
  );

  return {
    zone: defaultZone || null,
    method: "default",
    confidence: "low",
    warning: "Could not determine zone from address. Defaulting to Charleston Metro.",
  };
}

// ══════════════════════════════════════════════════════════════════════
// ZONE MODIFIER EXTRACTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Extract a modifier snapshot from a zone.
 * This snapshot is persisted in the project context for auditability.
 */
export function getZoneModifiers(zone: GeoZoneData): ZoneModifierSnapshot {
  return {
    zoneId: zone.id,
    zoneName: zone.zoneName,
    laborModifier: zone.laborModifier,
    logisticsModifier: zone.logisticsModifier,
    materialModifier: zone.materialModifier,
    contingencyPct: zone.contingencyPct,
    minProfitShieldPct: zone.minProfitShieldPct,
    coastalExposureLevel: zone.coastalExposureLevel,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Convert a zone modifier snapshot to PricingDimensions partial.
 * Maps zone modifiers to the pricing engine's dimension system.
 *
 * Mapping:
 *   zone.laborModifier    → dims.regionalLaborModifier
 *   zone.materialModifier → dims.regionalMaterialModifier
 *   zone.logisticsModifier → dims.regionalCostModifier (general cost)
 *   zone.coastalExposure  → dims.coastalModifier (derived from exposure level)
 */
export function zoneToPricingDimensions(
  snapshot: ZoneModifierSnapshot
): Partial<PricingDimensions> {
  return {
    regionalLaborModifier: snapshot.laborModifier,
    regionalMaterialModifier: snapshot.materialModifier,
    regionalCostModifier: snapshot.logisticsModifier,
    coastalModifier: coastalExposureToModifier(snapshot.coastalExposureLevel),
  };
}

/**
 * Convert coastal exposure level string to a numeric modifier.
 */
export function coastalExposureToModifier(level: string): number {
  switch (level) {
    case "extreme": return 1.30;
    case "high":    return 1.20;
    case "moderate": return 1.10;
    case "low":     return 1.05;
    case "none":
    default:        return 1.00;
  }
}

/**
 * Get the effective minimum Profit Shield percentage for a zone.
 * If no zone snapshot, returns the system default (35%).
 */
export function getEffectiveMinProfitShield(
  snapshot?: ZoneModifierSnapshot | null
): number {
  return snapshot?.minProfitShieldPct ?? 35.0;
}

/**
 * Build a complete ProjectGeoContext from a zone detection result.
 */
export function buildProjectGeoContext(
  detection: ZoneDetectionResult
): ProjectGeoContext | null {
  if (!detection.zone) return null;

  const snapshot = getZoneModifiers(detection.zone);

  return {
    zone: detection.zone.zoneName,
    zoneId: detection.zone.id,
    zoneModifierSnapshot: snapshot,
    coastalExposureLevel: detection.zone.coastalExposureLevel,
    contingencyPct: detection.zone.contingencyPct,
    minProfitShieldPct: detection.zone.minProfitShieldPct,
  };
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════════

/** Validation result for geographic context */
export interface GeoValidationResult {
  isValid: boolean;
  warnings: GeoWarning[];
}

export interface GeoWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

/**
 * Validate geographic context for an estimate.
 * Non-blocking — returns warnings but never prevents estimate creation.
 */
export function validateGeoContext(
  detection: ZoneDetectionResult
): GeoValidationResult {
  const warnings: GeoWarning[] = [];

  // Rule 1: No zone detected → default applied
  if (!detection.zone) {
    warnings.push({
      code: "GEO_NO_ZONE",
      message: "Could not determine geographic zone. Charleston Metro defaults applied.",
      severity: "warning",
    });
  }

  // Rule 2: Default zone used
  if (detection.method === "default") {
    warnings.push({
      code: "GEO_DEFAULT_ZONE",
      message: "Using default Charleston Metro zone. Verify address for accurate pricing.",
      severity: "warning",
    });
  }

  // Rule 3: Low confidence detection
  if (detection.confidence === "low" && detection.zone) {
    warnings.push({
      code: "GEO_LOW_CONFIDENCE",
      message: `Zone "${detection.zone.zoneName}" assigned with low confidence. Verify address.`,
      severity: "warning",
    });
  }

  // Rule 4: Outside service radius
  if (detection.distanceMiles && detection.distanceMiles > MAX_SERVICE_RADIUS_MILES) {
    warnings.push({
      code: "GEO_OUTSIDE_SERVICE_AREA",
      message: `Location is ${detection.distanceMiles} miles away, outside the ${MAX_SERVICE_RADIUS_MILES}-mile service radius.`,
      severity: "info",
    });
  }

  // Rule 5: High coastal exposure
  if (detection.zone && COASTAL_EXPOSURE_ORDER[detection.zone.coastalExposureLevel] >= 3) {
    warnings.push({
      code: "GEO_HIGH_COASTAL",
      message: `${detection.zone.coastalExposureLevel} coastal exposure — coastal-grade materials and elevated Profit Shield apply.`,
      severity: "info",
    });
  }

  return {
    isValid: true, // Geographic validation never blocks
    warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════
// CHARLESTON ZONE DATA (seed reference)
// ══════════════════════════════════════════════════════════════════════

/** Charleston zone seed data — 5 zones as specified in Sprint 11 */
export const CHARLESTON_ZONES: Omit<GeoZoneData, "id">[] = [
  {
    zoneName: "Barrier Island Premium",
    county: "Charleston",
    zipCodes: ["29455", "29439", "29482", "29451", "29438"],
    centerLat: 32.6083,
    centerLng: -79.9581,
    radiusMiles: 12,
    coastalExposureLevel: "extreme",
    logisticsComplexity: "extreme",
    laborModifier: 1.25,
    logisticsModifier: 1.40,
    materialModifier: 1.30,
    contingencyPct: 5.0,
    minProfitShieldPct: 50.0,
    isActive: true,
  },
  {
    zoneName: "Charleston Coastal",
    county: "Charleston",
    zipCodes: ["29412", "29422", "29492", "29464", "29492", "29403", "29492"],
    centerLat: 32.7546,
    centerLng: -79.9748,
    radiusMiles: 15,
    coastalExposureLevel: "high",
    logisticsComplexity: "complex",
    laborModifier: 1.15,
    logisticsModifier: 1.20,
    materialModifier: 1.15,
    contingencyPct: 3.0,
    minProfitShieldPct: 42.0,
    isActive: true,
  },
  {
    zoneName: "Charleston Metro",
    county: "Charleston",
    zipCodes: [
      "29407", "29414", "29418", "29405", "29406",
      "29409", "29401", "29403", "29464", "29466",
    ],
    centerLat: 32.7765,
    centerLng: -79.9311,
    radiusMiles: 20,
    coastalExposureLevel: "moderate",
    logisticsComplexity: "standard",
    laborModifier: 1.05,
    logisticsModifier: 1.00,
    materialModifier: 1.05,
    contingencyPct: 0.0,
    minProfitShieldPct: 35.0,
    isActive: true,
  },
  {
    zoneName: "Summerville / Goose Creek",
    county: "Berkeley / Dorchester",
    zipCodes: [
      "29483", "29485", "29486", "29445", "29456",
      "29461", "29470", "29472",
    ],
    centerLat: 33.0185,
    centerLng: -80.1756,
    radiusMiles: 18,
    coastalExposureLevel: "none",
    logisticsComplexity: "standard",
    laborModifier: 1.00,
    logisticsModifier: 0.95,
    materialModifier: 1.00,
    contingencyPct: 0.0,
    minProfitShieldPct: 32.0,
    isActive: true,
  },
  {
    zoneName: "Outer Lowcountry",
    county: "Colleton / Dorchester",
    zipCodes: [
      "29488", "29474", "29477", "29479", "29481",
      "29440", "29426", "29431",
    ],
    centerLat: 32.8954,
    centerLng: -80.3421,
    radiusMiles: 30,
    coastalExposureLevel: "low",
    logisticsComplexity: "moderate",
    laborModifier: 1.05,
    logisticsModifier: 1.05,
    materialModifier: 1.00,
    contingencyPct: 2.0,
    minProfitShieldPct: 35.0,
    isActive: true,
  },
];

// ══════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Haversine formula — distance between two lat/lng points in miles.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// round2 imported from shared/utils/math.ts (canonical source)
