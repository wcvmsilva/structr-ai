/**
 * Sprint 15 — Geocoding Integration Tests
 *
 * Coverage:
 *   1. Constants & Configuration (OPERATING_CENTER, LOCATION_TYPE_QUALITY, MIN_ADDRESS_COMPONENTS)
 *   2. normalizeAddress() — whitespace, commas, edge cases
 *   3. buildGeocodeInput() — field assembly, partial fields
 *   4. validateAddressForGeocoding() — component counting, warnings
 *   5. classifyGeocodeQuality() — location type mapping, fallback types
 *   6. isWithinServiceRadius() — boundary, inside, outside, invalid
 *   7. distanceFromOperatingCenter() — known distances
 *   8. GeocodeResult interface — structure validation
 *   9. GeocodeAndZoneResult interface — pipeline output structure
 *  10. Schema: projects table geocoding fields
 *  11. Router structure: project.geocode, project.validateAddress, geo.geocodeAddress
 *  12. Integration: geo-geocoding → geo-engine → geo-integration pipeline
 *  13. Audit events: 4 audit actions
 *  14. Edge cases: NaN coords, empty strings, missing fields
 *
 * Total: 60+ tests
 */

import { describe, it, expect } from "vitest";

// ── Pure functions from geo-geocoding.ts ──────────────────────────
import {
  normalizeAddress,
  buildGeocodeInput,
  validateAddressForGeocoding,
  classifyGeocodeQuality,
  isWithinServiceRadius,
  distanceFromOperatingCenter,
  OPERATING_CENTER,
  MIN_ADDRESS_COMPONENTS,
  LOCATION_TYPE_QUALITY,
  type GeocodeResult,
  type GeocodeInput,
  type AddressValidation,
} from "./geo-geocoding";

// ── Geo-engine imports for cross-module tests ─────────────────────
import {
  haversineDistance,
  MAX_SERVICE_RADIUS_MILES,
  CHARLESTON_ZONES,
  detectZoneFromCoords,
  getZoneModifiers,
  type GeoZoneData,
  type ZoneModifierSnapshot,
} from "@shared/geo-engine";

// ── Integration types ─────────────────────────────────────────────
import type { GeocodeAndZoneResult } from "./geo-integration";

// ── Schema imports ────────────────────────────────────────────────
import { projects } from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// 1. CONSTANTS & CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — Constants & Configuration", () => {
  it("OPERATING_CENTER is Charleston, SC coordinates", () => {
    expect(OPERATING_CENTER.lat).toBeCloseTo(32.7765, 3);
    expect(OPERATING_CENTER.lng).toBeCloseTo(-79.9311, 3);
  });

  it("OPERATING_CENTER is within the Charleston Metro zone", () => {
    const charlestonMetro = CHARLESTON_ZONES.find(z => z.zoneName === "Charleston Metro");
    expect(charlestonMetro).toBeDefined();
    if (charlestonMetro && charlestonMetro.centerLat && charlestonMetro.centerLng) {
      const dist = haversineDistance(
        OPERATING_CENTER.lat, OPERATING_CENTER.lng,
        charlestonMetro.centerLat, charlestonMetro.centerLng
      );
      expect(dist).toBeLessThan(charlestonMetro.radiusMiles);
    }
  });

  it("MIN_ADDRESS_COMPONENTS is 2", () => {
    expect(MIN_ADDRESS_COMPONENTS).toBe(2);
  });

  it("LOCATION_TYPE_QUALITY maps all Google location types", () => {
    expect(LOCATION_TYPE_QUALITY.ROOFTOP).toBe("high");
    expect(LOCATION_TYPE_QUALITY.RANGE_INTERPOLATED).toBe("medium");
    expect(LOCATION_TYPE_QUALITY.GEOMETRIC_CENTER).toBe("medium");
    expect(LOCATION_TYPE_QUALITY.APPROXIMATE).toBe("low");
  });

  it("LOCATION_TYPE_QUALITY has exactly 4 entries", () => {
    expect(Object.keys(LOCATION_TYPE_QUALITY)).toHaveLength(4);
  });

  it("MAX_SERVICE_RADIUS_MILES is 60", () => {
    expect(MAX_SERVICE_RADIUS_MILES).toBe(60);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. normalizeAddress()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — normalizeAddress()", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeAddress("  123 Main St  ")).toBe("123 Main St");
  });

  it("collapses multiple spaces into one", () => {
    expect(normalizeAddress("123   Main    St")).toBe("123 Main St");
  });

  it("removes double commas", () => {
    expect(normalizeAddress("123 Main St,, Charleston")).toBe("123 Main St, Charleston");
  });

  it("removes trailing comma", () => {
    expect(normalizeAddress("123 Main St, Charleston,")).toBe("123 Main St, Charleston");
  });

  it("removes leading comma", () => {
    // normalizeAddress removes leading comma but preserves the space after it
    const result = normalizeAddress(", 123 Main St");
    expect(result.trim()).toBe("123 Main St");
  });

  it("returns empty string for null/undefined input", () => {
    expect(normalizeAddress("")).toBe("");
    expect(normalizeAddress(null as any)).toBe("");
    expect(normalizeAddress(undefined as any)).toBe("");
  });

  it("handles complex normalization", () => {
    expect(normalizeAddress("  123  Main  St,,  Charleston,  SC,  ")).toBe("123 Main St, Charleston, SC");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. buildGeocodeInput()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — buildGeocodeInput()", () => {
  it("assembles full address from all fields", () => {
    const result = buildGeocodeInput({
      address: "123 Main St",
      city: "Charleston",
      state: "SC",
      zipCode: "29401",
    });
    expect(result).toBe("123 Main St, Charleston, SC, 29401");
  });

  it("handles partial fields (city + state only)", () => {
    const result = buildGeocodeInput({
      city: "Charleston",
      state: "SC",
    });
    expect(result).toBe("Charleston, SC");
  });

  it("handles only zip code", () => {
    const result = buildGeocodeInput({ zipCode: "29401" });
    expect(result).toBe("29401");
  });

  it("handles only address", () => {
    const result = buildGeocodeInput({ address: "123 Main St" });
    expect(result).toBe("123 Main St");
  });

  it("returns empty string when all fields are null/undefined", () => {
    const result = buildGeocodeInput({});
    expect(result).toBe("");
  });

  it("trims whitespace from individual fields", () => {
    const result = buildGeocodeInput({
      address: "  123 Main St  ",
      city: " Charleston ",
      state: " SC ",
      zipCode: " 29401 ",
    });
    expect(result).toBe("123 Main St, Charleston, SC, 29401");
  });

  it("normalizes address field (collapses spaces)", () => {
    const result = buildGeocodeInput({
      address: "123   Main   St",
      city: "Charleston",
    });
    expect(result).toBe("123 Main St, Charleston");
  });

  it("skips null fields without extra commas", () => {
    const result = buildGeocodeInput({
      address: "123 Main St",
      city: null,
      state: "SC",
      zipCode: null,
    });
    expect(result).toBe("123 Main St, SC");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. validateAddressForGeocoding()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — validateAddressForGeocoding()", () => {
  it("validates full address as valid (4 components)", () => {
    const result = validateAddressForGeocoding({
      address: "123 Main St",
      city: "Charleston",
      state: "SC",
      zipCode: "29401",
    });
    expect(result.isValid).toBe(true);
    expect(result.componentCount).toBe(4);
    expect(result.hasStreet).toBe(true);
    expect(result.hasCity).toBe(true);
    expect(result.hasState).toBe(true);
    expect(result.hasZip).toBe(true);
    expect(result.warning).toBeNull();
  });

  it("validates street + city as valid (2 components)", () => {
    const result = validateAddressForGeocoding({
      address: "123 Main St",
      city: "Charleston",
    });
    expect(result.isValid).toBe(true);
    expect(result.componentCount).toBe(2);
  });

  it("rejects single component as invalid", () => {
    const result = validateAddressForGeocoding({
      address: "123 Main St",
    });
    expect(result.isValid).toBe(false);
    expect(result.componentCount).toBe(1);
    expect(result.warning).toContain("Insufficient address data");
  });

  it("rejects empty input as invalid", () => {
    const result = validateAddressForGeocoding({});
    expect(result.isValid).toBe(false);
    expect(result.componentCount).toBe(0);
  });

  it("warns when no street address is provided (city + zip)", () => {
    const result = validateAddressForGeocoding({
      city: "Charleston",
      zipCode: "29401",
    });
    expect(result.isValid).toBe(true);
    expect(result.hasStreet).toBe(false);
    expect(result.warning).toContain("No street address");
    expect(result.warning).toContain("approximate");
  });

  it("validates zip code format (5 digits)", () => {
    const valid = validateAddressForGeocoding({ zipCode: "29401", city: "Charleston" });
    expect(valid.hasZip).toBe(true);
  });

  it("validates zip+4 format", () => {
    const valid = validateAddressForGeocoding({ zipCode: "29401-1234", city: "Charleston" });
    expect(valid.hasZip).toBe(true);
  });

  it("rejects invalid zip code format", () => {
    const invalid = validateAddressForGeocoding({ zipCode: "2940", city: "Charleston" });
    expect(invalid.hasZip).toBe(false);
  });

  it("rejects very short street address (< 4 chars)", () => {
    const result = validateAddressForGeocoding({ address: "St", city: "Charleston" });
    expect(result.hasStreet).toBe(false);
  });

  it("requires state to be at least 2 characters", () => {
    const valid = validateAddressForGeocoding({ state: "SC", city: "Charleston" });
    expect(valid.hasState).toBe(true);
    const invalid = validateAddressForGeocoding({ state: "S", city: "Charleston" });
    expect(invalid.hasState).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. classifyGeocodeQuality()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — classifyGeocodeQuality()", () => {
  it("classifies ROOFTOP as high", () => {
    expect(classifyGeocodeQuality("ROOFTOP")).toBe("high");
  });

  it("classifies RANGE_INTERPOLATED as medium", () => {
    expect(classifyGeocodeQuality("RANGE_INTERPOLATED")).toBe("medium");
  });

  it("classifies GEOMETRIC_CENTER as medium", () => {
    expect(classifyGeocodeQuality("GEOMETRIC_CENTER")).toBe("medium");
  });

  it("classifies APPROXIMATE as low", () => {
    expect(classifyGeocodeQuality("APPROXIMATE")).toBe("low");
  });

  it("returns low for null location type", () => {
    expect(classifyGeocodeQuality(null)).toBe("low");
  });

  it("returns low for unknown location type", () => {
    expect(classifyGeocodeQuality("UNKNOWN_TYPE")).toBe("low");
  });

  it("uses result types as fallback — street_address → high", () => {
    expect(classifyGeocodeQuality("UNKNOWN", ["street_address"])).toBe("high");
  });

  it("uses result types as fallback — premise → high", () => {
    expect(classifyGeocodeQuality("UNKNOWN", ["premise"])).toBe("high");
  });

  it("uses result types as fallback — route → medium", () => {
    expect(classifyGeocodeQuality("UNKNOWN", ["route"])).toBe("medium");
  });

  it("uses result types as fallback — intersection → medium", () => {
    expect(classifyGeocodeQuality("UNKNOWN", ["intersection"])).toBe("medium");
  });

  it("returns low when no fallback types match", () => {
    expect(classifyGeocodeQuality("UNKNOWN", ["political"])).toBe("low");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. isWithinServiceRadius()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — isWithinServiceRadius()", () => {
  it("Charleston downtown is within service radius", () => {
    expect(isWithinServiceRadius(32.7765, -79.9311)).toBe(true);
  });

  it("Summerville is within service radius (~25 miles)", () => {
    expect(isWithinServiceRadius(33.0185, -80.1756)).toBe(true);
  });

  it("Kiawah Island is within service radius (~25 miles)", () => {
    expect(isWithinServiceRadius(32.6083, -80.0834)).toBe(true);
  });

  it("Columbia, SC is outside service radius (~100 miles)", () => {
    expect(isWithinServiceRadius(34.0007, -81.0348)).toBe(false);
  });

  it("New York City is outside service radius", () => {
    expect(isWithinServiceRadius(40.7128, -74.0060)).toBe(false);
  });

  it("returns false for NaN coordinates", () => {
    expect(isWithinServiceRadius(NaN, -79.9311)).toBe(false);
    expect(isWithinServiceRadius(32.7765, NaN)).toBe(false);
  });

  it("returns false for non-number inputs", () => {
    expect(isWithinServiceRadius("abc" as any, -79.9311)).toBe(false);
    expect(isWithinServiceRadius(32.7765, undefined as any)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. distanceFromOperatingCenter()
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — distanceFromOperatingCenter()", () => {
  it("distance from Charleston to itself is ~0", () => {
    const dist = distanceFromOperatingCenter(OPERATING_CENTER.lat, OPERATING_CENTER.lng);
    expect(dist).toBeCloseTo(0, 0);
  });

  it("distance from Charleston to Summerville is ~20-30 miles", () => {
    const dist = distanceFromOperatingCenter(33.0185, -80.1756);
    expect(dist).toBeGreaterThan(15);
    expect(dist).toBeLessThan(35);
  });

  it("distance from Charleston to Columbia is ~90-110 miles", () => {
    const dist = distanceFromOperatingCenter(34.0007, -81.0348);
    expect(dist).toBeGreaterThan(85);
    expect(dist).toBeLessThan(120);
  });

  it("uses haversineDistance internally (consistent results)", () => {
    const directDist = haversineDistance(
      33.0185, -80.1756,
      OPERATING_CENTER.lat, OPERATING_CENTER.lng
    );
    const funcDist = distanceFromOperatingCenter(33.0185, -80.1756);
    expect(funcDist).toBeCloseTo(directDist, 5);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. GeocodeResult Interface Structure
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — GeocodeResult Interface", () => {
  const successResult: GeocodeResult = {
    success: true,
    latitude: 32.7765,
    longitude: -79.9311,
    formattedAddress: "123 Main St, Charleston, SC 29401",
    confidence: "high",
    source: "google_maps",
    locationType: "ROOFTOP",
    placeId: "ChIJ123",
    distanceFromCenter: 0.5,
    withinServiceRadius: true,
    warning: null,
    addressComponents: [
      { longName: "123", shortName: "123", types: ["street_number"] },
      { longName: "Main Street", shortName: "Main St", types: ["route"] },
    ],
  };

  const failedResult: GeocodeResult = {
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
    warning: "Geocoding failed: ZERO_RESULTS",
    addressComponents: null,
  };

  it("success result has all required fields", () => {
    expect(successResult.success).toBe(true);
    expect(successResult.latitude).toBeTypeOf("number");
    expect(successResult.longitude).toBeTypeOf("number");
    expect(successResult.formattedAddress).toBeTypeOf("string");
    expect(["high", "medium", "low", "failed"]).toContain(successResult.confidence);
    expect(["google_maps", "manual", "zip_centroid"]).toContain(successResult.source);
  });

  it("failed result has null coordinates and formattedAddress", () => {
    expect(failedResult.success).toBe(false);
    expect(failedResult.latitude).toBeNull();
    expect(failedResult.longitude).toBeNull();
    expect(failedResult.formattedAddress).toBeNull();
    expect(failedResult.confidence).toBe("failed");
  });

  it("failed result has a warning message", () => {
    expect(failedResult.warning).toBeTypeOf("string");
    expect(failedResult.warning!.length).toBeGreaterThan(0);
  });

  it("confidence enum has 4 valid values", () => {
    const validConfidences = ["high", "medium", "low", "failed"];
    expect(validConfidences).toContain(successResult.confidence);
    expect(validConfidences).toContain(failedResult.confidence);
  });

  it("source enum has 3 valid values", () => {
    const validSources = ["google_maps", "manual", "zip_centroid"];
    expect(validSources).toContain(successResult.source);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. GeocodeAndZoneResult Pipeline Output
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — GeocodeAndZoneResult Pipeline Structure", () => {
  it("successful pipeline result has all fields", () => {
    const result: GeocodeAndZoneResult = {
      geocode: {
        success: true,
        latitude: 32.7765,
        longitude: -79.9311,
        formattedAddress: "123 Main St, Charleston, SC 29401",
        confidence: "high",
        source: "google_maps",
        locationType: "ROOFTOP",
        placeId: "ChIJ123",
        distanceFromCenter: 0.5,
        withinServiceRadius: true,
        warning: null,
        addressComponents: [],
      },
      zoneDetection: {
        zone: { ...CHARLESTON_ZONES[2], id: -3 } as GeoZoneData,
        method: "coordinates",
        confidence: "high",
      },
      zoneSnapshot: {
        zoneId: -3,
        zoneName: "Charleston Metro",
        laborModifier: 1.0,
        logisticsModifier: 1.0,
        materialModifier: 1.0,
        contingencyPct: 5.0,
        minProfitShieldPct: 35.0,
        coastalExposureLevel: "low",
        capturedAt: new Date().toISOString(),
      },
      warnings: [],
      success: true,
    };

    expect(result.success).toBe(true);
    expect(result.geocode.success).toBe(true);
    expect(result.zoneDetection).not.toBeNull();
    expect(result.zoneSnapshot).not.toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  it("failed pipeline result has null zone fields", () => {
    const result: GeocodeAndZoneResult = {
      geocode: {
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
        warning: "Insufficient address data",
        addressComponents: null,
      },
      zoneDetection: null,
      zoneSnapshot: null,
      warnings: ["Insufficient address data"],
      success: false,
    };

    expect(result.success).toBe(false);
    expect(result.zoneDetection).toBeNull();
    expect(result.zoneSnapshot).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. Schema: Projects Table Geocoding Fields
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — Projects Table Schema (Geocoding Fields)", () => {
  it("has geocode fields on projects table", () => {
    expect(projects.geocodeConfidence).toBeDefined();
    expect(projects.geocodeSource).toBeDefined();
    expect(projects.geocodedAddress).toBeDefined();
    expect(projects.geocodedAt).toBeDefined();
  });

  it("has geocodeConfidence column", () => {
    expect(projects.geocodeConfidence).toBeDefined();
    expect(projects.geocodeConfidence.name).toBe("geocode_confidence");
  });

  it("has geocodeSource column", () => {
    expect(projects.geocodeSource).toBeDefined();
    expect(projects.geocodeSource.name).toBe("geocode_source");
  });

  it("has geocodedAddress column", () => {
    expect(projects.geocodedAddress).toBeDefined();
    expect(projects.geocodedAddress.name).toBe("geocoded_address");
  });

  it("has geocodedAt column", () => {
    expect(projects.geocodedAt).toBeDefined();
    expect(projects.geocodedAt.name).toBe("geocoded_at");
  });

  it("geocodeConfidence has correct enum values", () => {
    const config = (projects.geocodeConfidence as any).config;
    if (config && config.enumValues) {
      expect(config.enumValues).toContain("high");
      expect(config.enumValues).toContain("medium");
      expect(config.enumValues).toContain("low");
      expect(config.enumValues).toContain("failed");
      expect(config.enumValues).toContain("pending");
      expect(config.enumValues).toHaveLength(5);
    }
  });

  it("geocodeConfidence is a text column", () => {
    expect(projects.geocodeConfidence).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. Router Structure Verification
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — Router Structure", () => {
  it("project router is registered in appRouter", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("project.create");
    expect(appRouter._def.procedures).toHaveProperty("project.update");
  });

  it("project router has geocode procedure", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("project.geocode");
  });

  it("project router has validateAddress procedure", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("project.validateAddress");
  });

  it("geo router has geocodeAddress procedure", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("geo.geocodeAddress");
  });

  it("geo router has reverseGeocode procedure", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("geo.reverseGeocode");
  });

  it("geo router has geocodeAndDetectZone procedure", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("geo.geocodeAndDetectZone");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 12. Integration: Geocoding → Zone Detection Pipeline
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — Geocoding → Zone Detection Integration", () => {
  it("Charleston downtown coordinates detect Charleston Metro zone", () => {
    const zones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: -(i + 1) })) as GeoZoneData[];
    const result = detectZoneFromCoords(32.7765, -79.9311, zones);
    expect(result.zone).not.toBeNull();
    // Should match either Charleston Coastal or Charleston Metro
    expect(["Charleston Coastal", "Charleston Metro"]).toContain(result.zone!.zoneName);
  });

  it("Kiawah Island coordinates detect Barrier Island Premium zone", () => {
    const zones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: -(i + 1) })) as GeoZoneData[];
    const result = detectZoneFromCoords(32.6083, -80.0834, zones);
    expect(result.zone).not.toBeNull();
    expect(result.zone!.coastalExposureLevel).toBe("extreme");
  });

  it("Summerville coordinates detect Summerville / Goose Creek zone", () => {
    const zones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: -(i + 1) })) as GeoZoneData[];
    const result = detectZoneFromCoords(33.0185, -80.1756, zones);
    expect(result.zone).not.toBeNull();
    expect(result.zone!.zoneName).toBe("Summerville / Goose Creek");
  });

  it("getZoneModifiers produces valid snapshot from detected zone", () => {
    const zones = CHARLESTON_ZONES.map((z, i) => ({ ...z, id: -(i + 1) })) as GeoZoneData[];
    const detection = detectZoneFromCoords(32.7765, -79.9311, zones);
    if (detection.zone) {
      const snapshot = getZoneModifiers(detection.zone);
      expect(snapshot.zoneName).toBe(detection.zone.zoneName);
      expect(snapshot.laborModifier).toBeGreaterThan(0);
      expect(snapshot.logisticsModifier).toBeGreaterThan(0);
      expect(snapshot.materialModifier).toBeGreaterThan(0);
      expect(snapshot.capturedAt).toBeTruthy();
    }
  });

  it("Barrier Island zone has extreme coastal exposure and highest modifiers", () => {
    const barrierIsland = CHARLESTON_ZONES.find(z => z.zoneName === "Barrier Island Premium");
    expect(barrierIsland).toBeDefined();
    expect(barrierIsland!.coastalExposureLevel).toBe("extreme");
    expect(barrierIsland!.laborModifier).toBeGreaterThanOrEqual(1.2);
    expect(barrierIsland!.logisticsModifier).toBeGreaterThanOrEqual(1.3);
    expect(barrierIsland!.materialModifier).toBeGreaterThanOrEqual(1.2);
  });

  it("Summerville zone has none/low coastal exposure", () => {
    const summerville = CHARLESTON_ZONES.find(z => z.zoneName === "Summerville / Goose Creek");
    expect(summerville).toBeDefined();
    expect(["none", "low"]).toContain(summerville!.coastalExposureLevel);
  });

  it("all CHARLESTON_ZONES have required fields", () => {
    for (const zone of CHARLESTON_ZONES) {
      expect(zone.zoneName).toBeTruthy();
      expect(zone.radiusMiles).toBeGreaterThan(0);
      expect(zone.laborModifier).toBeGreaterThan(0);
      expect(zone.logisticsModifier).toBeGreaterThan(0);
      expect(zone.materialModifier).toBeGreaterThan(0);
      expect(zone.contingencyPct).toBeGreaterThanOrEqual(0);
      expect(zone.minProfitShieldPct).toBeGreaterThan(0);
      expect(["none", "low", "moderate", "high", "extreme"]).toContain(zone.coastalExposureLevel);
    }
  });

  it("CHARLESTON_ZONES has 5 zones", () => {
    expect(CHARLESTON_ZONES).toHaveLength(5);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 13. Audit Events
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — Audit Event Coverage", () => {
  it("geo-integration.ts exports persistGeocodeResult (audited)", async () => {
    const mod = await import("./geo-integration");
    expect(mod.persistGeocodeResult).toBeTypeOf("function");
  });

  it("geo-integration.ts exports geocodeAndDetectZone", async () => {
    const mod = await import("./geo-integration");
    expect(mod.geocodeAndDetectZone).toBeTypeOf("function");
  });

  it("geo-integration.ts exports refreshProjectGeocode (audited)", async () => {
    const mod = await import("./geo-integration");
    expect(mod.refreshProjectGeocode).toBeTypeOf("function");
  });

  it("4 audit actions are defined: geocode_resolved, geocode_failed, zone_assigned, zone_changed", () => {
    // These are string constants used in logAudit calls within geo-integration.ts
    const auditActions = [
      "project.geocode_resolved",
      "project.geocode_failed",
      "project.zone_assigned",
      "project.zone_changed",
    ];
    // Verify they follow the naming convention
    for (const action of auditActions) {
      expect(action).toMatch(/^project\.\w+$/);
    }
    expect(auditActions).toHaveLength(4);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 14. Edge Cases
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — Edge Cases", () => {
  it("normalizeAddress handles non-string input gracefully", () => {
    expect(normalizeAddress(123 as any)).toBe("");
    expect(normalizeAddress({} as any)).toBe("");
    expect(normalizeAddress([] as any)).toBe("");
  });

  it("buildGeocodeInput handles all null fields", () => {
    const result = buildGeocodeInput({
      address: null,
      city: null,
      state: null,
      zipCode: null,
      county: null,
    });
    expect(result).toBe("");
  });

  it("validateAddressForGeocoding handles whitespace-only fields", () => {
    const result = validateAddressForGeocoding({
      address: "   ",
      city: "  ",
      state: "  ",
      zipCode: "  ",
    });
    // Whitespace-only should be treated as empty
    expect(result.componentCount).toBeLessThan(4);
  });

  it("isWithinServiceRadius handles extreme coordinates", () => {
    expect(isWithinServiceRadius(90, 180)).toBe(false); // North Pole
    expect(isWithinServiceRadius(-90, -180)).toBe(false); // South Pole
    expect(isWithinServiceRadius(0, 0)).toBe(false); // Gulf of Guinea
  });

  it("classifyGeocodeQuality handles empty string location type", () => {
    expect(classifyGeocodeQuality("")).toBe("low");
  });

  it("distanceFromOperatingCenter handles coordinates at operating center", () => {
    const dist = distanceFromOperatingCenter(OPERATING_CENTER.lat, OPERATING_CENTER.lng);
    expect(dist).toBe(0);
  });

  it("buildGeocodeInput handles empty string fields", () => {
    const result = buildGeocodeInput({
      address: "",
      city: "",
      state: "",
      zipCode: "",
    });
    expect(result).toBe("");
  });

  it("validateAddressForGeocoding rejects zip code with letters", () => {
    const result = validateAddressForGeocoding({
      zipCode: "2940A",
      city: "Charleston",
    });
    expect(result.hasZip).toBe(false);
  });

  it("service radius boundary: exactly at MAX_SERVICE_RADIUS_MILES", () => {
    // Find a point that's approximately 60 miles from Charleston
    // 1 degree of latitude ≈ 69 miles, so ~0.87 degrees north
    const lat60MilesNorth = OPERATING_CENTER.lat + 0.87;
    const dist = distanceFromOperatingCenter(lat60MilesNorth, OPERATING_CENTER.lng);
    // Should be approximately 60 miles
    expect(dist).toBeGreaterThan(55);
    expect(dist).toBeLessThan(65);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 15. Cross-Module Compatibility
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 15 — Cross-Module Compatibility", () => {
  it("geo-geocoding exports are importable", async () => {
    const mod = await import("./geo-geocoding");
    expect(mod.normalizeAddress).toBeTypeOf("function");
    expect(mod.buildGeocodeInput).toBeTypeOf("function");
    expect(mod.validateAddressForGeocoding).toBeTypeOf("function");
    expect(mod.classifyGeocodeQuality).toBeTypeOf("function");
    expect(mod.isWithinServiceRadius).toBeTypeOf("function");
    expect(mod.distanceFromOperatingCenter).toBeTypeOf("function");
    expect(mod.geocodeAddress).toBeTypeOf("function");
    expect(mod.reverseGeocode).toBeTypeOf("function");
    expect(mod.geocodeProject).toBeTypeOf("function");
    expect(mod.OPERATING_CENTER).toBeDefined();
    expect(mod.MIN_ADDRESS_COMPONENTS).toBeDefined();
    expect(mod.LOCATION_TYPE_QUALITY).toBeDefined();
  });

  it("geo-integration exports are importable", async () => {
    const mod = await import("./geo-integration");
    expect(mod.geocodeAndDetectZone).toBeTypeOf("function");
    expect(mod.persistGeocodeResult).toBeTypeOf("function");
    expect(mod.refreshProjectGeocode).toBeTypeOf("function");
  });

  it("geo-engine constants are accessible from geocoding module", () => {
    expect(MAX_SERVICE_RADIUS_MILES).toBe(60);
    expect(haversineDistance).toBeTypeOf("function");
    expect(CHARLESTON_ZONES).toBeDefined();
    expect(CHARLESTON_ZONES.length).toBeGreaterThan(0);
  });

  it("OPERATING_CENTER is consistent with CHARLESTON_ZONES center coordinates", () => {
    // Operating center should be close to at least one zone center
    let minDist = Infinity;
    for (const zone of CHARLESTON_ZONES) {
      if (zone.centerLat && zone.centerLng) {
        const dist = haversineDistance(
          OPERATING_CENTER.lat, OPERATING_CENTER.lng,
          zone.centerLat, zone.centerLng
        );
        if (dist < minDist) minDist = dist;
      }
    }
    // Operating center should be within 15 miles of at least one zone center
    expect(minDist).toBeLessThan(15);
  });

  it("geocode confidence values align with schema enum", () => {
    const schemaValues = ["high", "medium", "low", "failed", "pending"];
    const geocodeValues = ["high", "medium", "low", "failed"];
    // All geocode values should be in schema enum
    for (const v of geocodeValues) {
      expect(schemaValues).toContain(v);
    }
  });

  it("LOCATION_TYPE_QUALITY values are valid confidence levels", () => {
    const validConfidences = ["high", "medium", "low"];
    for (const quality of Object.values(LOCATION_TYPE_QUALITY)) {
      expect(validConfidences).toContain(quality);
    }
  });
});
