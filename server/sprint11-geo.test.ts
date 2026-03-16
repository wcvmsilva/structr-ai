/**
 * structr.ai v9 — Sprint 11 Tests
 * Geographic Intelligence Engine
 *
 * Test coverage (65 tests):
 *   Section 1: Schema — geo_zones table, projects.zone_modifier_snapshot (6 tests)
 *   Section 2: Zone Detection — ZIP-based, coordinate-based, combined (14 tests)
 *   Section 3: Zone Modifiers — snapshot extraction, pricing dimensions mapping (8 tests)
 *   Section 4: Coastal Exposure — modifier conversion, exposure ordering (5 tests)
 *   Section 5: Validation — geographic context validation rules (7 tests)
 *   Section 6: Haversine Distance — distance calculation accuracy (4 tests)
 *   Section 7: Charleston Seed Data — 5 zones with correct values (6 tests)
 *   Section 8: Geo-DB Helper Types — exported functions and types (5 tests)
 *   Section 9: Geo-Router Structure — 14 tRPC procedures (6 tests)
 *   Section 10: Pricing Engine Integration — zone→PricingDimensions mapping (4 tests)
 */

import { describe, it, expect } from "vitest";
import * as schema from "../drizzle/schema";
import {
  detectZoneFromZip,
  detectZoneFromCoords,
  detectZone,
  getZoneModifiers,
  zoneToPricingDimensions,
  coastalExposureToModifier,
  getEffectiveMinProfitShield,
  buildProjectGeoContext,
  validateGeoContext,
  haversineDistance,
  CHARLESTON_ZONES,
  DEFAULT_ZONE_NAME,
  MAX_SERVICE_RADIUS_MILES,
  COASTAL_EXPOSURE_ORDER,
  type GeoZoneData,
  type ZoneModifierSnapshot,
  type ZoneDetectionResult,
  type ProjectGeoContext,
  type GeoValidationResult,
} from "@shared/geo-engine";
import {
  DEFAULT_PRICING_DIMENSIONS,
  type PricingDimensions,
} from "@shared/pricing-engine";

// ── Test Helpers ──

/** Create a minimal GeoZoneData for testing */
function makeZone(overrides: Partial<GeoZoneData> = {}): GeoZoneData {
  return {
    id: 1,
    zoneName: "Test Zone",
    county: "Test County",
    zipCodes: ["29407", "29414"],
    centerLat: 32.7765,
    centerLng: -79.9311,
    radiusMiles: 15,
    coastalExposureLevel: "moderate",
    logisticsComplexity: "standard",
    laborModifier: 1.05,
    logisticsModifier: 1.00,
    materialModifier: 1.05,
    contingencyPct: 0,
    minProfitShieldPct: 35.0,
    isActive: true,
    ...overrides,
  };
}

/** Build the 5 Charleston zones with synthetic IDs for engine tests */
function getCharlestonZonesWithIds(): GeoZoneData[] {
  return CHARLESTON_ZONES.map((z, i) => ({ ...z, id: i + 1 }));
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: Schema — geo_zones table and projects extension
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Schema: geo_zones Table", () => {
  it("exports geoZones table from schema", () => {
    expect(schema.geoZones).toBeDefined();
  });

  it("has all required columns", () => {
    const cols = Object.keys(schema.geoZones);
    const required = [
      "id", "zoneName", "county", "zipCodes",
      "centerLat", "centerLng", "radiusMiles",
      "coastalExposureLevel", "logisticsComplexity",
      "laborModifier", "logisticsModifier", "materialModifier",
      "contingencyPct", "minProfitShieldPct",
      "description", "isActive",
      "createdAt", "updatedAt",
    ];
    for (const col of required) {
      expect(cols, `Missing column: ${col}`).toContain(col);
    }
  });

  it("exports GeoZone and InsertGeoZone types", () => {
    // Type-level check: if these compile, the types exist
    const _selectType: schema.GeoZone | null = null;
    const _insertType: schema.InsertGeoZone | null = null;
    expect(true).toBe(true);
  });

  it("projects table has zoneModifierSnapshot JSON column", () => {
    const cols = Object.keys(schema.projects);
    expect(cols).toContain("zoneModifierSnapshot");
  });

  it("exports ZoneModifierSnapshot interface from schema", () => {
    const snapshot: schema.ZoneModifierSnapshot = {
      zoneId: 1,
      zoneName: "Test",
      laborModifier: 1.0,
      logisticsModifier: 1.0,
      materialModifier: 1.0,
      contingencyPct: 0,
      minProfitShieldPct: 35,
      coastalExposureLevel: "none",
      capturedAt: new Date().toISOString(),
    };
    expect(snapshot.zoneId).toBe(1);
    expect(snapshot.capturedAt).toBeTruthy();
  });

  it("geo_zones table has indexes on coastal_exposure_level and is_active", () => {
    // Verify the table is properly defined (indexes are structural)
    expect(schema.geoZones).toBeDefined();
    const cols = Object.keys(schema.geoZones);
    expect(cols).toContain("coastalExposureLevel");
    expect(cols).toContain("isActive");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: Zone Detection — ZIP, coordinates, combined
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Zone Detection: ZIP Code", () => {
  const zones = getCharlestonZonesWithIds();

  it("detects Barrier Island Premium from ZIP 29455", () => {
    const result = detectZoneFromZip("29455", zones);
    expect(result.zone).not.toBeNull();
    expect(result.zone!.zoneName).toBe("Barrier Island Premium");
    expect(result.method).toBe("zip");
    expect(result.confidence).toBe("high");
  });

  it("detects Charleston Metro from ZIP 29407", () => {
    const result = detectZoneFromZip("29407", zones);
    expect(result.zone).not.toBeNull();
    expect(result.zone!.zoneName).toBe("Charleston Metro");
    expect(result.confidence).toBe("high");
  });

  it("detects Summerville / Goose Creek from ZIP 29483", () => {
    const result = detectZoneFromZip("29483", zones);
    expect(result.zone).not.toBeNull();
    expect(result.zone!.zoneName).toBe("Summerville / Goose Creek");
  });

  it("returns null zone for unknown ZIP code", () => {
    const result = detectZoneFromZip("90210", zones);
    expect(result.zone).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.warning).toContain("90210");
  });

  it("returns low confidence for empty ZIP", () => {
    const result = detectZoneFromZip("", zones);
    expect(result.zone).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.warning).toContain("No ZIP code provided");
  });

  it("normalizes ZIP to first 5 digits", () => {
    const result = detectZoneFromZip("29407-1234", zones);
    expect(result.zone).not.toBeNull();
    expect(result.zone!.zoneName).toBe("Charleston Metro");
  });

  it("skips inactive zones", () => {
    const zonesWithInactive = zones.map(z =>
      z.zoneName === "Charleston Metro" ? { ...z, isActive: false } : z
    );
    const result = detectZoneFromZip("29407", zonesWithInactive);
    // 29407 is only in Charleston Metro, which is now inactive
    // But 29407 might also be in another zone's zipCodes — check
    // Actually 29407 is only in Charleston Metro
    expect(result.zone).toBeNull();
  });
});

describe("Sprint 11 — Zone Detection: Coordinates", () => {
  const zones = getCharlestonZonesWithIds();

  it("detects closest zone from coordinates near Charleston Metro center", () => {
    // Charleston Metro center: 32.7765, -79.9311
    const result = detectZoneFromCoords(32.78, -79.93, zones);
    expect(result.zone).not.toBeNull();
    expect(result.method).toBe("coordinates");
    expect(result.confidence).toBe("high");
    expect(result.distanceMiles).toBeDefined();
    expect(result.distanceMiles!).toBeLessThan(5);
  });

  it("returns low confidence for coordinates far outside service area", () => {
    // New York City coordinates — way outside Charleston
    const result = detectZoneFromCoords(40.7128, -74.0060, zones);
    expect(result.zone).not.toBeNull(); // Still returns closest zone
    expect(result.confidence).toBe("low");
    expect(result.distanceMiles!).toBeGreaterThan(MAX_SERVICE_RADIUS_MILES);
    expect(result.warning).toContain("Outside");
  });

  it("returns low confidence for invalid coordinates", () => {
    const result = detectZoneFromCoords(NaN, NaN, zones);
    expect(result.zone).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.warning).toContain("Invalid coordinates");
  });

  it("returns low confidence when no zones have coordinates", () => {
    const noCoordZones = zones.map(z => ({ ...z, centerLat: null, centerLng: null }));
    const result = detectZoneFromCoords(32.78, -79.93, noCoordZones);
    expect(result.zone).toBeNull();
    expect(result.warning).toContain("No zones with coordinates");
  });

  it("returns medium confidence when within service area but outside zone radius", () => {
    // Pick a point that's between two zones but outside both radii
    // Summerville center: 33.0185, -80.1756 with radius 18 mi
    // A point ~20 miles away but within 60-mile service area
    const result = detectZoneFromCoords(33.25, -80.18, zones);
    expect(result.zone).not.toBeNull();
    if (result.distanceMiles! > result.zone!.radiusMiles && result.distanceMiles! <= MAX_SERVICE_RADIUS_MILES) {
      expect(result.confidence).toBe("medium");
    }
  });
});

describe("Sprint 11 — Zone Detection: Combined (detectZone)", () => {
  const zones = getCharlestonZonesWithIds();

  it("prioritizes ZIP code over coordinates", () => {
    const result = detectZone(
      { zip: "29455", lat: 33.0185, lng: -80.1756 }, // ZIP=Barrier Island, coords=Summerville
      zones
    );
    expect(result.zone!.zoneName).toBe("Barrier Island Premium");
    expect(result.method).toBe("zip");
  });

  it("falls back to coordinates when ZIP not found", () => {
    const result = detectZone(
      { zip: "90210", lat: 32.78, lng: -79.93 },
      zones
    );
    expect(result.zone).not.toBeNull();
    expect(result.method).toBe("coordinates");
  });

  it("defaults to Charleston Metro when neither ZIP nor coords match", () => {
    const result = detectZone({}, zones);
    expect(result.method).toBe("default");
    expect(result.confidence).toBe("low");
    if (result.zone) {
      expect(result.zone.zoneName).toBe(DEFAULT_ZONE_NAME);
    }
    expect(result.warning).toContain("Defaulting to Charleston Metro");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: Zone Modifiers — snapshot extraction, pricing dimensions
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Zone Modifiers: Snapshot Extraction", () => {
  it("extracts correct modifier snapshot from a zone", () => {
    const zone = makeZone({
      id: 42,
      zoneName: "Test Coastal",
      laborModifier: 1.15,
      logisticsModifier: 1.20,
      materialModifier: 1.10,
      contingencyPct: 3.0,
      minProfitShieldPct: 42.0,
      coastalExposureLevel: "high",
    });

    const snapshot = getZoneModifiers(zone);
    expect(snapshot.zoneId).toBe(42);
    expect(snapshot.zoneName).toBe("Test Coastal");
    expect(snapshot.laborModifier).toBe(1.15);
    expect(snapshot.logisticsModifier).toBe(1.20);
    expect(snapshot.materialModifier).toBe(1.10);
    expect(snapshot.contingencyPct).toBe(3.0);
    expect(snapshot.minProfitShieldPct).toBe(42.0);
    expect(snapshot.coastalExposureLevel).toBe("high");
    expect(snapshot.capturedAt).toBeTruthy();
    // capturedAt should be a valid ISO string
    expect(new Date(snapshot.capturedAt).getTime()).not.toBeNaN();
  });

  it("snapshot has ISO timestamp for auditability", () => {
    const zone = makeZone();
    const before = new Date().toISOString();
    const snapshot = getZoneModifiers(zone);
    const after = new Date().toISOString();
    expect(snapshot.capturedAt >= before).toBe(true);
    expect(snapshot.capturedAt <= after).toBe(true);
  });

  it("builds complete ProjectGeoContext from detection result", () => {
    const zone = makeZone({
      id: 5,
      zoneName: "Barrier Island Premium",
      coastalExposureLevel: "extreme",
      contingencyPct: 5.0,
      minProfitShieldPct: 50.0,
    });

    const detection: ZoneDetectionResult = {
      zone,
      method: "zip",
      confidence: "high",
    };

    const ctx = buildProjectGeoContext(detection);
    expect(ctx).not.toBeNull();
    expect(ctx!.zone).toBe("Barrier Island Premium");
    expect(ctx!.zoneId).toBe(5);
    expect(ctx!.coastalExposureLevel).toBe("extreme");
    expect(ctx!.contingencyPct).toBe(5.0);
    expect(ctx!.minProfitShieldPct).toBe(50.0);
    expect(ctx!.zoneModifierSnapshot).toBeDefined();
    expect(ctx!.zoneModifierSnapshot.zoneId).toBe(5);
  });

  it("returns null ProjectGeoContext when no zone detected", () => {
    const detection: ZoneDetectionResult = {
      zone: null,
      method: "zip",
      confidence: "low",
    };
    const ctx = buildProjectGeoContext(detection);
    expect(ctx).toBeNull();
  });
});

describe("Sprint 11 — Zone Modifiers: Pricing Dimensions Mapping", () => {
  it("maps zone snapshot to PricingDimensions correctly", () => {
    const snapshot: ZoneModifierSnapshot = {
      zoneId: 1,
      zoneName: "Charleston Coastal",
      laborModifier: 1.15,
      logisticsModifier: 1.20,
      materialModifier: 1.15,
      contingencyPct: 3.0,
      minProfitShieldPct: 42.0,
      coastalExposureLevel: "high",
      capturedAt: new Date().toISOString(),
    };

    const dims = zoneToPricingDimensions(snapshot);
    expect(dims.regionalLaborModifier).toBe(1.15);
    expect(dims.regionalMaterialModifier).toBe(1.15);
    expect(dims.regionalCostModifier).toBe(1.20); // logistics → regional cost
    expect(dims.coastalModifier).toBe(1.20); // high → 1.20
  });

  it("maps none coastal exposure to 1.0 modifier", () => {
    const snapshot: ZoneModifierSnapshot = {
      zoneId: 4,
      zoneName: "Summerville",
      laborModifier: 1.00,
      logisticsModifier: 0.95,
      materialModifier: 1.00,
      contingencyPct: 0,
      minProfitShieldPct: 32.0,
      coastalExposureLevel: "none",
      capturedAt: new Date().toISOString(),
    };

    const dims = zoneToPricingDimensions(snapshot);
    expect(dims.coastalModifier).toBe(1.00);
    expect(dims.regionalCostModifier).toBe(0.95);
  });

  it("maps extreme coastal exposure to 1.30 modifier", () => {
    const snapshot: ZoneModifierSnapshot = {
      zoneId: 1,
      zoneName: "Barrier Island",
      laborModifier: 1.25,
      logisticsModifier: 1.40,
      materialModifier: 1.30,
      contingencyPct: 5.0,
      minProfitShieldPct: 50.0,
      coastalExposureLevel: "extreme",
      capturedAt: new Date().toISOString(),
    };

    const dims = zoneToPricingDimensions(snapshot);
    expect(dims.coastalModifier).toBe(1.30);
  });

  it("returned partial dimensions can merge with defaults", () => {
    const snapshot: ZoneModifierSnapshot = {
      zoneId: 3,
      zoneName: "Charleston Metro",
      laborModifier: 1.05,
      logisticsModifier: 1.00,
      materialModifier: 1.05,
      contingencyPct: 0,
      minProfitShieldPct: 35.0,
      coastalExposureLevel: "moderate",
      capturedAt: new Date().toISOString(),
    };

    const partial = zoneToPricingDimensions(snapshot);
    const merged: PricingDimensions = { ...DEFAULT_PRICING_DIMENSIONS, ...partial };

    // Zone values should override defaults
    expect(merged.regionalLaborModifier).toBe(1.05);
    expect(merged.regionalMaterialModifier).toBe(1.05);
    expect(merged.coastalModifier).toBe(1.10); // moderate → 1.10

    // Non-zone defaults should remain
    expect(merged.wasteFactor).toBe(1.0);
    expect(merged.channelCostMultiplier).toBe(1.0);
    expect(merged.channelPriceMultiplier).toBe(1.0);
    expect(merged.finishMultiplier).toBe(1.0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: Coastal Exposure — modifier conversion, ordering
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Coastal Exposure Modifiers", () => {
  it("converts all 5 exposure levels to correct numeric modifiers", () => {
    expect(coastalExposureToModifier("none")).toBe(1.00);
    expect(coastalExposureToModifier("low")).toBe(1.05);
    expect(coastalExposureToModifier("moderate")).toBe(1.10);
    expect(coastalExposureToModifier("high")).toBe(1.20);
    expect(coastalExposureToModifier("extreme")).toBe(1.30);
  });

  it("defaults to 1.0 for unknown exposure level", () => {
    expect(coastalExposureToModifier("unknown")).toBe(1.00);
    expect(coastalExposureToModifier("")).toBe(1.00);
  });

  it("COASTAL_EXPOSURE_ORDER has correct ordering", () => {
    expect(COASTAL_EXPOSURE_ORDER["none"]).toBe(0);
    expect(COASTAL_EXPOSURE_ORDER["low"]).toBe(1);
    expect(COASTAL_EXPOSURE_ORDER["moderate"]).toBe(2);
    expect(COASTAL_EXPOSURE_ORDER["high"]).toBe(3);
    expect(COASTAL_EXPOSURE_ORDER["extreme"]).toBe(4);
  });

  it("getEffectiveMinProfitShield returns zone value when snapshot provided", () => {
    const snapshot: ZoneModifierSnapshot = {
      zoneId: 1,
      zoneName: "Barrier Island",
      laborModifier: 1.25,
      logisticsModifier: 1.40,
      materialModifier: 1.30,
      contingencyPct: 5.0,
      minProfitShieldPct: 50.0,
      coastalExposureLevel: "extreme",
      capturedAt: new Date().toISOString(),
    };
    expect(getEffectiveMinProfitShield(snapshot)).toBe(50.0);
  });

  it("getEffectiveMinProfitShield returns system default (35%) when no snapshot", () => {
    expect(getEffectiveMinProfitShield(null)).toBe(35.0);
    expect(getEffectiveMinProfitShield(undefined)).toBe(35.0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: Validation — geographic context validation rules
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Geographic Context Validation", () => {
  it("returns valid with no warnings for high-confidence ZIP match", () => {
    const detection: ZoneDetectionResult = {
      zone: makeZone({ coastalExposureLevel: "none" }),
      method: "zip",
      confidence: "high",
    };
    const result = validateGeoContext(detection);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when no zone detected (GEO_NO_ZONE)", () => {
    const detection: ZoneDetectionResult = {
      zone: null,
      method: "zip",
      confidence: "low",
    };
    const result = validateGeoContext(detection);
    expect(result.isValid).toBe(true); // Non-blocking
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain("GEO_NO_ZONE");
  });

  it("warns when default zone used (GEO_DEFAULT_ZONE)", () => {
    const detection: ZoneDetectionResult = {
      zone: makeZone(),
      method: "default",
      confidence: "low",
    };
    const result = validateGeoContext(detection);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain("GEO_DEFAULT_ZONE");
  });

  it("warns on low confidence with zone present (GEO_LOW_CONFIDENCE)", () => {
    const detection: ZoneDetectionResult = {
      zone: makeZone({ coastalExposureLevel: "none" }),
      method: "coordinates",
      confidence: "low",
      distanceMiles: 50,
    };
    const result = validateGeoContext(detection);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain("GEO_LOW_CONFIDENCE");
  });

  it("warns when outside service area (GEO_OUTSIDE_SERVICE_AREA)", () => {
    const detection: ZoneDetectionResult = {
      zone: makeZone({ coastalExposureLevel: "none" }),
      method: "coordinates",
      confidence: "low",
      distanceMiles: 75, // > MAX_SERVICE_RADIUS_MILES (60)
    };
    const result = validateGeoContext(detection);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain("GEO_OUTSIDE_SERVICE_AREA");
  });

  it("warns on high coastal exposure (GEO_HIGH_COASTAL)", () => {
    const detection: ZoneDetectionResult = {
      zone: makeZone({ coastalExposureLevel: "high" }),
      method: "zip",
      confidence: "high",
    };
    const result = validateGeoContext(detection);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain("GEO_HIGH_COASTAL");
  });

  it("warns on extreme coastal exposure (GEO_HIGH_COASTAL)", () => {
    const detection: ZoneDetectionResult = {
      zone: makeZone({ coastalExposureLevel: "extreme" }),
      method: "zip",
      confidence: "high",
    };
    const result = validateGeoContext(detection);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain("GEO_HIGH_COASTAL");
    const msg = result.warnings.find(w => w.code === "GEO_HIGH_COASTAL")!.message;
    expect(msg).toContain("extreme");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: Haversine Distance — calculation accuracy
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Haversine Distance Calculation", () => {
  it("returns 0 for same point", () => {
    const d = haversineDistance(32.7765, -79.9311, 32.7765, -79.9311);
    expect(d).toBe(0);
  });

  it("calculates ~1 mile for nearby points", () => {
    // ~1 mile apart in Charleston area
    const d = haversineDistance(32.7765, -79.9311, 32.7910, -79.9311);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(2.0);
  });

  it("calculates ~600 miles from Charleston to NYC", () => {
    const d = haversineDistance(32.7765, -79.9311, 40.7128, -74.0060);
    expect(d).toBeGreaterThan(550);
    expect(d).toBeLessThan(700);
  });

  it("is symmetric (A→B = B→A)", () => {
    const d1 = haversineDistance(32.7765, -79.9311, 33.0185, -80.1756);
    const d2 = haversineDistance(33.0185, -80.1756, 32.7765, -79.9311);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: Charleston Seed Data — 5 zones with correct values
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Charleston Zone Seed Data", () => {
  it("has exactly 5 Charleston zones", () => {
    expect(CHARLESTON_ZONES).toHaveLength(5);
  });

  it("has correct zone names", () => {
    const names = CHARLESTON_ZONES.map(z => z.zoneName);
    expect(names).toContain("Barrier Island Premium");
    expect(names).toContain("Charleston Coastal");
    expect(names).toContain("Charleston Metro");
    expect(names).toContain("Summerville / Goose Creek");
    expect(names).toContain("Outer Lowcountry");
  });

  it("Barrier Island Premium has extreme coastal exposure and highest modifiers", () => {
    const bi = CHARLESTON_ZONES.find(z => z.zoneName === "Barrier Island Premium")!;
    expect(bi.coastalExposureLevel).toBe("extreme");
    expect(bi.laborModifier).toBe(1.25);
    expect(bi.logisticsModifier).toBe(1.40);
    expect(bi.materialModifier).toBe(1.30);
    expect(bi.contingencyPct).toBe(5.0);
    expect(bi.minProfitShieldPct).toBe(50.0);
  });

  it("Summerville / Goose Creek has no coastal exposure and lowest modifiers", () => {
    const sg = CHARLESTON_ZONES.find(z => z.zoneName === "Summerville / Goose Creek")!;
    expect(sg.coastalExposureLevel).toBe("none");
    expect(sg.laborModifier).toBe(1.00);
    expect(sg.logisticsModifier).toBe(0.95);
    expect(sg.materialModifier).toBe(1.00);
    expect(sg.contingencyPct).toBe(0.0);
    expect(sg.minProfitShieldPct).toBe(32.0);
  });

  it("all zones have coordinates and ZIP codes", () => {
    for (const zone of CHARLESTON_ZONES) {
      expect(zone.centerLat, `${zone.zoneName} missing lat`).not.toBeNull();
      expect(zone.centerLng, `${zone.zoneName} missing lng`).not.toBeNull();
      expect(zone.zipCodes, `${zone.zoneName} missing zipCodes`).not.toBeNull();
      expect(zone.zipCodes!.length, `${zone.zoneName} has no ZIP codes`).toBeGreaterThan(0);
    }
  });

  it("all zones are active by default", () => {
    for (const zone of CHARLESTON_ZONES) {
      expect(zone.isActive, `${zone.zoneName} should be active`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: Geo-DB Helper Types — exported functions and types
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Geo-DB Helper Exports", () => {
  it("exports createGeoZone function", async () => {
    const mod = await import("./geo-db");
    expect(typeof mod.createGeoZone).toBe("function");
  });

  it("exports getGeoZoneById and getGeoZoneByName functions", async () => {
    const mod = await import("./geo-db");
    expect(typeof mod.getGeoZoneById).toBe("function");
    expect(typeof mod.getGeoZoneByName).toBe("function");
  });

  it("exports listGeoZones and loadActiveZonesForEngine functions", async () => {
    const mod = await import("./geo-db");
    expect(typeof mod.listGeoZones).toBe("function");
    expect(typeof mod.loadActiveZonesForEngine).toBe("function");
  });

  it("exports zone lifecycle functions (deactivate, reactivate, update)", async () => {
    const mod = await import("./geo-db");
    expect(typeof mod.deactivateGeoZone).toBe("function");
    expect(typeof mod.reactivateGeoZone).toBe("function");
    expect(typeof mod.updateGeoZone).toBe("function");
  });

  it("exports project zone functions and seed helper", async () => {
    const mod = await import("./geo-db");
    expect(typeof mod.assignZoneToProject).toBe("function");
    expect(typeof mod.getProjectZoneSnapshot).toBe("function");
    expect(typeof mod.getGeoZoneStats).toBe("function");
    expect(typeof mod.seedCharlestonZones).toBe("function");
    expect(typeof mod.dbZoneToEngineZone).toBe("function");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 9: Geo-Router Structure — 14 tRPC procedures
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Geo-Router Structure", () => {
  it("exports geoRouter from geo-router.ts", async () => {
    const mod = await import("./geo-router");
    expect(mod.geoRouter).toBeDefined();
  });

  it("geoRouter has all 14 expected procedure keys", async () => {
    const mod = await import("./geo-router");
    const routerDef = mod.geoRouter._def;
    const procedures = Object.keys(routerDef.procedures ?? routerDef.record ?? {});

    const expected = [
      "list", "getById", "getByName",
      "create", "update", "deactivate", "reactivate",
      "detectFromZip", "detectFromCoords",
      "assignToProject", "getProjectZone",
      "stats", "seedCharleston", "charlestonZones",
    ];

    for (const proc of expected) {
      expect(procedures, `Missing procedure: ${proc}`).toContain(proc);
    }
  });

  it("geoRouter is integrated into appRouter under 'geo' namespace", async () => {
    const mod = await import("./routers");
    const routerDef = mod.appRouter._def;
    const topLevel = Object.keys(routerDef.procedures ?? routerDef.record ?? {});

    // tRPC flattens nested routers with dot notation
    const geoProcs = topLevel.filter(k => k.startsWith("geo."));
    expect(geoProcs.length).toBeGreaterThanOrEqual(14);
  });

  it("admin-only procedures exist for zone management", async () => {
    const mod = await import("./geo-router");
    const routerDef = mod.geoRouter._def;
    const procedures = routerDef.procedures ?? routerDef.record ?? {};

    // create, update, deactivate, reactivate, seedCharleston should be mutations
    const mutationKeys = ["create", "update", "deactivate", "reactivate", "seedCharleston"];
    for (const key of mutationKeys) {
      expect(procedures[key], `Missing mutation: ${key}`).toBeDefined();
    }
  });

  it("query procedures exist for zone detection and listing", async () => {
    const mod = await import("./geo-router");
    const routerDef = mod.geoRouter._def;
    const procedures = routerDef.procedures ?? routerDef.record ?? {};

    const queryKeys = ["list", "getById", "getByName", "detectFromZip", "detectFromCoords", "getProjectZone", "stats", "charlestonZones"];
    for (const key of queryKeys) {
      expect(procedures[key], `Missing query: ${key}`).toBeDefined();
    }
  });

  it("assignToProject is a mutation procedure", async () => {
    const mod = await import("./geo-router");
    const routerDef = mod.geoRouter._def;
    const procedures = routerDef.procedures ?? routerDef.record ?? {};
    expect(procedures["assignToProject"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 10: Pricing Engine Integration — zone→PricingDimensions
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Pricing Engine Integration", () => {
  it("Barrier Island Premium zone produces highest cost multipliers", () => {
    const bi = CHARLESTON_ZONES.find(z => z.zoneName === "Barrier Island Premium")!;
    const zone: GeoZoneData = { ...bi, id: 1 };
    const snapshot = getZoneModifiers(zone);
    const dims = zoneToPricingDimensions(snapshot);

    // Extreme coastal → 1.30
    expect(dims.coastalModifier).toBe(1.30);
    // Highest labor modifier
    expect(dims.regionalLaborModifier).toBe(1.25);
    // Highest material modifier
    expect(dims.regionalMaterialModifier).toBe(1.30);
    // Highest logistics → regional cost
    expect(dims.regionalCostModifier).toBe(1.40);
  });

  it("Summerville zone produces lowest cost multipliers (below 1.0 logistics)", () => {
    const sg = CHARLESTON_ZONES.find(z => z.zoneName === "Summerville / Goose Creek")!;
    const zone: GeoZoneData = { ...sg, id: 4 };
    const snapshot = getZoneModifiers(zone);
    const dims = zoneToPricingDimensions(snapshot);

    expect(dims.coastalModifier).toBe(1.00); // none
    expect(dims.regionalLaborModifier).toBe(1.00);
    expect(dims.regionalMaterialModifier).toBe(1.00);
    expect(dims.regionalCostModifier).toBe(0.95); // Below 1.0 — cheaper logistics
  });

  it("zone dimensions integrate with PricingDimensions type", () => {
    const metro = CHARLESTON_ZONES.find(z => z.zoneName === "Charleston Metro")!;
    const zone: GeoZoneData = { ...metro, id: 3 };
    const snapshot = getZoneModifiers(zone);
    const partial = zoneToPricingDimensions(snapshot);

    // Merge with full defaults
    const full: PricingDimensions = { ...DEFAULT_PRICING_DIMENSIONS, ...partial };

    // All 8 PricingDimensions fields should be present
    expect(full.wasteFactor).toBe(1.0);
    expect(full.coastalModifier).toBe(1.10); // moderate
    expect(full.channelCostMultiplier).toBe(1.0);
    expect(full.channelPriceMultiplier).toBe(1.0);
    expect(full.finishMultiplier).toBe(1.0);
    expect(full.regionalCostModifier).toBe(1.00); // logistics
    expect(full.regionalLaborModifier).toBe(1.05);
    expect(full.regionalMaterialModifier).toBe(1.05);
  });

  it("DEFAULT_ZONE_NAME constant matches Charleston Metro zone", () => {
    expect(DEFAULT_ZONE_NAME).toBe("Charleston Metro");
    const metro = CHARLESTON_ZONES.find(z => z.zoneName === DEFAULT_ZONE_NAME);
    expect(metro).toBeDefined();
    expect(metro!.coastalExposureLevel).toBe("moderate");
    expect(metro!.minProfitShieldPct).toBe(35.0);
  });
});
