/**
 * structr.ai — Geocoding Module (Sprint 15)
 *
 * Server-side address resolution using the Manus Google Maps proxy.
 * This module handles ONLY geocoding (address → coordinates).
 * Zone detection is delegated to geo-engine.ts.
 *
 * Responsibilities:
 *   - normalizeAddress()       → clean/standardize address string
 *   - geocodeAddress()         → resolve address → lat/lng via Google Maps
 *   - reverseGeocode()         → resolve lat/lng → formatted address
 *   - buildGeocodeInput()      → assemble address from project fields
 *   - classifyGeocodeQuality() → assess geocode result quality
 *   - isWithinServiceRadius()  → check if coordinates are within operating area
 *
 * All functions are pure or use the makeRequest helper from server/_core/map.ts.
 */

import { makeRequest, type GeocodingResult, type LatLng } from "./_core/map";
import { haversineDistance, MAX_SERVICE_RADIUS_MILES } from "@shared/geo-engine";

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Charleston, SC — center of structr.ai operating area */
export const OPERATING_CENTER: LatLng = { lat: 32.7765, lng: -79.9311 };

/** Minimum address components required for reliable geocoding */
export const MIN_ADDRESS_COMPONENTS = 2; // e.g., street + city or street + zip

/** Google Maps geocoding location_type quality ranking */
export const LOCATION_TYPE_QUALITY: Record<string, "high" | "medium" | "low"> = {
  ROOFTOP: "high",
  RANGE_INTERPOLATED: "medium",
  GEOMETRIC_CENTER: "medium",
  APPROXIMATE: "low",
};

/** SC state abbreviations and full names for normalization */
const SC_VARIANTS = ["sc", "south carolina", "s.c.", "s.c"];

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface GeocodeInput {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  county?: string | null;
}

export interface GeocodeResult {
  success: boolean;
  latitude: number | null;
  longitude: number | null;
  formattedAddress: string | null;
  confidence: "high" | "medium" | "low" | "failed";
  source: "google_maps" | "manual" | "zip_centroid";
  locationType: string | null;
  placeId: string | null;
  /** Distance from structr.ai operating center in miles */
  distanceFromCenter: number | null;
  /** Whether the location is within the service radius */
  withinServiceRadius: boolean;
  /** Warning message if any issues detected */
  warning: string | null;
  /** Raw address components from Google */
  addressComponents: AddressComponent[] | null;
}

export interface AddressComponent {
  longName: string;
  shortName: string;
  types: string[];
}

export interface AddressValidation {
  isValid: boolean;
  hasStreet: boolean;
  hasCity: boolean;
  hasState: boolean;
  hasZip: boolean;
  componentCount: number;
  warning: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// ADDRESS NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize an address string for geocoding.
 * Trims whitespace, collapses multiple spaces, removes trailing commas.
 */
export function normalizeAddress(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/\s+/g, " ")           // collapse multiple spaces
    .replace(/,\s*,/g, ",")         // remove double commas
    .replace(/,\s*$/g, "")          // remove trailing comma
    .replace(/^\s*,/g, "");         // remove leading comma
}

/**
 * Build a geocodable address string from project fields.
 * Assembles available fields into a single comma-separated string.
 */
export function buildGeocodeInput(fields: GeocodeInput): string {
  const parts: string[] = [];

  if (fields.address) parts.push(normalizeAddress(fields.address));
  if (fields.city) parts.push(fields.city.trim());
  if (fields.state) parts.push(fields.state.trim());
  if (fields.zipCode) parts.push(fields.zipCode.trim());

  return parts.filter(Boolean).join(", ");
}

/**
 * Validate address components for geocoding readiness.
 * Returns which components are present and whether the address is sufficient.
 */
export function validateAddressForGeocoding(fields: GeocodeInput): AddressValidation {
  const hasStreet = Boolean(fields.address && fields.address.trim().length > 3);
  const hasCity = Boolean(fields.city && fields.city.trim().length > 1);
  const hasState = Boolean(fields.state && fields.state.trim().length >= 2);
  const hasZip = Boolean(fields.zipCode && /^\d{5}(-\d{4})?$/.test(fields.zipCode.trim()));

  const componentCount = [hasStreet, hasCity, hasState, hasZip].filter(Boolean).length;
  const isValid = componentCount >= MIN_ADDRESS_COMPONENTS;

  let warning: string | null = null;
  if (!isValid) {
    warning = `Insufficient address data (${componentCount} components). Need at least ${MIN_ADDRESS_COMPONENTS} of: street, city, state, zip.`;
  } else if (!hasStreet) {
    warning = "No street address provided — geocode may be approximate (city/zip level).";
  }

  return { isValid, hasStreet, hasCity, hasState, hasZip, componentCount, warning };
}

// ══════════════════════════════════════════════════════════════════════
// GEOCODING (Google Maps API)
// ══════════════════════════════════════════════════════════════════════

/**
 * Geocode an address using Google Maps Geocoding API via Manus proxy.
 * Returns structured result with coordinates, confidence, and metadata.
 */
export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult> {
  // Validate input
  const validation = validateAddressForGeocoding(input);
  if (!validation.isValid) {
    return {
      success: false,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      confidence: "failed",
      source: "google_maps",
      locationType: null,
      placeId: null,
      distanceFromCenter: null,
      withinServiceRadius: false,
      warning: validation.warning,
      addressComponents: null,
    };
  }

  const addressString = buildGeocodeInput(input);
  if (!addressString) {
    return {
      success: false,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      confidence: "failed",
      source: "google_maps",
      locationType: null,
      placeId: null,
      distanceFromCenter: null,
      withinServiceRadius: false,
      warning: "Empty address string after normalization",
      addressComponents: null,
    };
  }

  try {
    // Call Google Maps Geocoding API via Manus proxy
    const result = await makeRequest<GeocodingResult>(
      "/maps/api/geocode/json",
      {
        address: addressString,
        // Bias results toward South Carolina
        bounds: "32.0,-82.0|35.2,-78.5",
      }
    );

    if (result.status !== "OK" || !result.results || result.results.length === 0) {
      return {
        success: false,
        latitude: null,
        longitude: null,
        formattedAddress: null,
        confidence: "failed",
        source: "google_maps",
        locationType: null,
        placeId: null,
        distanceFromCenter: null,
        withinServiceRadius: false,
        warning: `Geocoding failed: ${result.status}`,
        addressComponents: null,
      };
    }

    const best = result.results[0];
    const lat = best.geometry.location.lat;
    const lng = best.geometry.location.lng;
    const locationType = best.geometry.location_type;
    const confidence = classifyGeocodeQuality(locationType, best.types);
    const distanceFromCenter = haversineDistance(
      lat, lng,
      OPERATING_CENTER.lat, OPERATING_CENTER.lng
    );
    const withinServiceRadius = distanceFromCenter <= MAX_SERVICE_RADIUS_MILES;

    // Parse address components
    const addressComponents: AddressComponent[] = best.address_components.map(c => ({
      longName: c.long_name,
      shortName: c.short_name,
      types: c.types,
    }));

    // Check if result is in South Carolina
    const stateComponent = addressComponents.find(c => c.types.includes("administrative_area_level_1"));
    const isInSC = stateComponent
      ? SC_VARIANTS.includes(stateComponent.shortName.toLowerCase()) || SC_VARIANTS.includes(stateComponent.longName.toLowerCase())
      : false;

    let warning: string | null = null;
    if (!withinServiceRadius) {
      warning = `Location is ${Math.round(distanceFromCenter)} miles from Charleston — outside ${MAX_SERVICE_RADIUS_MILES}-mile service radius.`;
    } else if (!isInSC) {
      warning = `Geocoded location may not be in South Carolina (state: ${stateComponent?.shortName ?? "unknown"}).`;
    } else if (confidence === "low") {
      warning = "Geocode is approximate — only city/zip level accuracy.";
    }

    return {
      success: true,
      latitude: lat,
      longitude: lng,
      formattedAddress: best.formatted_address,
      confidence,
      source: "google_maps",
      locationType,
      placeId: best.place_id,
      distanceFromCenter: Math.round(distanceFromCenter * 100) / 100,
      withinServiceRadius,
      warning,
      addressComponents,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown geocoding error";
    return {
      success: false,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      confidence: "failed",
      source: "google_maps",
      locationType: null,
      placeId: null,
      distanceFromCenter: null,
      withinServiceRadius: false,
      warning: `Geocoding error: ${message}`,
      addressComponents: null,
    };
  }
}

/**
 * Reverse geocode coordinates to a formatted address.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) {
    return {
      success: false,
      latitude: lat,
      longitude: lng,
      formattedAddress: null,
      confidence: "failed",
      source: "google_maps",
      locationType: null,
      placeId: null,
      distanceFromCenter: null,
      withinServiceRadius: false,
      warning: "Invalid coordinates for reverse geocoding",
      addressComponents: null,
    };
  }

  try {
    const result = await makeRequest<GeocodingResult>(
      "/maps/api/geocode/json",
      { latlng: `${lat},${lng}` }
    );

    if (result.status !== "OK" || !result.results || result.results.length === 0) {
      return {
        success: false,
        latitude: lat,
        longitude: lng,
        formattedAddress: null,
        confidence: "failed",
        source: "google_maps",
        locationType: null,
        placeId: null,
        distanceFromCenter: null,
        withinServiceRadius: false,
        warning: `Reverse geocoding failed: ${result.status}`,
        addressComponents: null,
      };
    }

    const best = result.results[0];
    const distanceFromCenter = haversineDistance(lat, lng, OPERATING_CENTER.lat, OPERATING_CENTER.lng);
    const withinServiceRadius = distanceFromCenter <= MAX_SERVICE_RADIUS_MILES;
    const locationType = best.geometry.location_type;

    return {
      success: true,
      latitude: lat,
      longitude: lng,
      formattedAddress: best.formatted_address,
      confidence: classifyGeocodeQuality(locationType, best.types),
      source: "google_maps",
      locationType,
      placeId: best.place_id,
      distanceFromCenter: Math.round(distanceFromCenter * 100) / 100,
      withinServiceRadius,
      warning: withinServiceRadius ? null : `Location is ${Math.round(distanceFromCenter)} miles from Charleston — outside service radius.`,
      addressComponents: best.address_components.map(c => ({
        longName: c.long_name,
        shortName: c.short_name,
        types: c.types,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      latitude: lat,
      longitude: lng,
      formattedAddress: null,
      confidence: "failed",
      source: "google_maps",
      locationType: null,
      placeId: null,
      distanceFromCenter: null,
      withinServiceRadius: false,
      warning: `Reverse geocoding error: ${message}`,
      addressComponents: null,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// QUALITY CLASSIFICATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Classify geocode quality based on Google's location_type and result types.
 * ROOFTOP = high (exact address match)
 * RANGE_INTERPOLATED / GEOMETRIC_CENTER = medium (interpolated or center of area)
 * APPROXIMATE = low (city/zip level)
 */
export function classifyGeocodeQuality(
  locationType: string | null,
  resultTypes?: string[]
): "high" | "medium" | "low" {
  if (!locationType) return "low";

  const quality = LOCATION_TYPE_QUALITY[locationType];
  if (quality) return quality;

  // Fallback: check result types for hints
  if (resultTypes) {
    if (resultTypes.includes("street_address") || resultTypes.includes("premise")) return "high";
    if (resultTypes.includes("route") || resultTypes.includes("intersection")) return "medium";
  }

  return "low";
}

/**
 * Check if coordinates are within the structr.ai service radius.
 */
export function isWithinServiceRadius(lat: number, lng: number): boolean {
  if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) {
    return false;
  }
  const distance = haversineDistance(lat, lng, OPERATING_CENTER.lat, OPERATING_CENTER.lng);
  return distance <= MAX_SERVICE_RADIUS_MILES;
}

/**
 * Calculate distance from structr.ai operating center.
 */
export function distanceFromOperatingCenter(lat: number, lng: number): number {
  return haversineDistance(lat, lng, OPERATING_CENTER.lat, OPERATING_CENTER.lng);
}

// ══════════════════════════════════════════════════════════════════════
// PROJECT GEOCODING ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════

export interface ProjectGeocodeFields {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  county?: string | null;
}

/**
 * Full geocoding pipeline for a project.
 * 1. Validate address fields
 * 2. Call Google Maps geocoding
 * 3. Check service radius
 * 4. Return structured result ready for DB persistence
 */
export async function geocodeProject(fields: ProjectGeocodeFields): Promise<GeocodeResult> {
  return geocodeAddress(fields);
}
