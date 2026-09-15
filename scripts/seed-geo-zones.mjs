/**
 * G3a-3 — seed only the five legacy Charleston geo zones.
 * From the source checkout: node scripts/seed-geo-zones.mjs
 * Requires installed project dependencies, DATABASE_URL and an explicit existing
 * tenant UUID in SEED_TENANT_ID. Never infers a tenant or backfills old rows.
 * Coastal price-book co-seeding was explicitly retired; existing items are untouched.
 * Running this command against any operational database requires its own approval.
 */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ZONES = [
  {
    zone_name: "Barrier Island Premium",
    county: "Charleston",
    zip_codes: JSON.stringify(["29455", "29439", "29482", "29451", "29438"]),
    center_lat: 32.6083,
    center_lng: -79.9581,
    radius_miles: 12,
    coastal_exposure_level: "extreme",
    logistics_complexity: "extreme",
    labor_modifier: 1.25,
    logistics_modifier: 1.40,
    material_modifier: 1.30,
    contingency_pct: 5.0,
    min_profit_shield_pct: 50.0,
    description: "Barrier Island Premium — Charleston County. Coastal: extreme, Logistics: extreme. Includes Kiawah, Seabrook, Folly Beach, Isle of Palms, Sullivan's Island.",
    is_active: true,
  },
  {
    zone_name: "Charleston Coastal",
    county: "Charleston",
    zip_codes: JSON.stringify(["29412", "29422", "29492", "29464", "29403"]),
    center_lat: 32.7546,
    center_lng: -79.9748,
    radius_miles: 15,
    coastal_exposure_level: "high",
    logistics_complexity: "complex",
    labor_modifier: 1.15,
    logistics_modifier: 1.20,
    material_modifier: 1.15,
    contingency_pct: 3.0,
    min_profit_shield_pct: 42.0,
    description: "Charleston Coastal — Charleston County. Coastal: high, Logistics: complex. Includes James Island, Mt. Pleasant, West Ashley coastal areas.",
    is_active: true,
  },
  {
    zone_name: "Charleston Metro",
    county: "Charleston",
    zip_codes: JSON.stringify(["29407", "29414", "29418", "29405", "29406", "29409", "29401", "29403", "29464", "29466"]),
    center_lat: 32.7765,
    center_lng: -79.9311,
    radius_miles: 20,
    coastal_exposure_level: "moderate",
    logistics_complexity: "standard",
    labor_modifier: 1.05,
    logistics_modifier: 1.00,
    material_modifier: 1.05,
    contingency_pct: 0.0,
    min_profit_shield_pct: 35.0,
    description: "Charleston Metro — Charleston County. Coastal: moderate, Logistics: standard. Default zone for Charleston area projects.",
    is_active: true,
  },
  {
    zone_name: "Summerville / Goose Creek",
    county: "Berkeley / Dorchester",
    zip_codes: JSON.stringify(["29483", "29485", "29486", "29445", "29456", "29461", "29470", "29472"]),
    center_lat: 33.0185,
    center_lng: -80.1756,
    radius_miles: 18,
    coastal_exposure_level: "none",
    logistics_complexity: "standard",
    labor_modifier: 1.00,
    logistics_modifier: 0.95,
    material_modifier: 1.00,
    contingency_pct: 0.0,
    min_profit_shield_pct: 32.0,
    description: "Summerville / Goose Creek — Berkeley/Dorchester County. Coastal: none, Logistics: standard. Inland suburban zone.",
    is_active: true,
  },
  {
    zone_name: "Outer Lowcountry",
    county: "Colleton / Dorchester",
    zip_codes: JSON.stringify(["29488", "29474", "29477", "29479", "29481", "29440", "29426", "29431"]),
    center_lat: 32.8954,
    center_lng: -80.3421,
    radius_miles: 30,
    coastal_exposure_level: "low",
    logistics_complexity: "moderate",
    labor_modifier: 1.05,
    logistics_modifier: 1.05,
    material_modifier: 1.00,
    contingency_pct: 2.0,
    min_profit_shield_pct: 35.0,
    description: "Outer Lowcountry — Colleton/Dorchester County. Coastal: low, Logistics: moderate. Rural and semi-rural areas.",
    is_active: true,
  },
];

/** Importing this module performs no configuration, connection or seed work. */
export async function runGeoSeed() {
  dotenv.config();
  const tenantId = process.env.SEED_TENANT_ID?.trim().toLowerCase();
  if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tenantId)) {
    throw new Error("SEED_TENANT_ID must be an explicit existing tenant UUID");
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL not set");

  // A single scoped loader is essential: separate tsImport calls can create
  // separate db.ts singletons and leave the seed's actual pool unclosed.
  const { register } = await import("tsx/esm/api");
  const scoped = register({
    namespace: `structr-geo-seed-${randomUUID()}`,
    tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  });
  let database;
  let result;
  const errors = [];
  try {
    database = await scoped.import("../server/db.ts", import.meta.url);
    const { seedOperationalGeoZones } = await scoped.import("../server/geo-db.ts", import.meta.url);
    const rows = ZONES.map(zone => ({
      name: zone.zone_name,
      zoneName: zone.zone_name,
      county: zone.county,
      zipCodes: JSON.parse(zone.zip_codes),
      centerLat: zone.center_lat,
      centerLng: zone.center_lng,
      radiusMiles: String(zone.radius_miles),
      coastalExposureLevel: zone.coastal_exposure_level,
      logisticsComplexity: zone.logistics_complexity,
      laborModifier: String(zone.labor_modifier),
      logisticsModifier: String(zone.logistics_modifier),
      materialModifier: String(zone.material_modifier),
      contingencyPct: String(zone.contingency_pct),
      minProfitShieldPct: String(zone.min_profit_shield_pct),
      description: zone.description,
      isActive: zone.is_active,
    }));
    result = await seedOperationalGeoZones(tenantId, rows);
    console.log(`Geo zones committed: ${result.created}/5`);
    if (result.auditUnconfirmed) {
      console.error(`Zones are committed; audit persistence is unconfirmed for ${result.auditUnconfirmed} creation(s).`);
      process.exitCode = 1;
    }
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await database?.getRawClient()?.end({ timeout: 5 });
    } catch (error) {
      errors.push(error);
    } finally {
      try { await scoped.unregister(); } catch (error) { errors.push(error); }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : String(error)).join("; "));
  }
  return result;
}

// Node resolves the module's real path, even when the operator invokes a symlink.
// An unrelated/missing argv path must still leave imports inert.
let directEntry = false;
try {
  directEntry = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch { /* Not an invocation of this file. */ }
if (directEntry) {
  try { await runGeoSeed(); }
  catch (error) {
    console.error("Geo seed failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
