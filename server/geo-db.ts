/**
 * structr.ai — Geographic Intelligence DB Helpers
 * Sprint 11: Geographic Intelligence Layer
 *
 * DB helpers for geo_zones CRUD, zone detection from DB, and seed operations.
 * All mutations log to audit trail.
 */

import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { geoZones, projects, type GeoZone, type InsertGeoZone } from "../drizzle/schema";
import { logAudit } from "./audit";
import type { GeoZoneData, ZoneModifierSnapshot } from "@shared/geo-engine";

// ══════════════════════════════════════════════════════════════════════
// ZONE CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a new geo zone.
 */
export async function createGeoZone(
  data: Omit<InsertGeoZone, "id" | "createdAt" | "updatedAt">,
  userId?: number
): Promise<GeoZone | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(geoZones).values(data).returning({ id: geoZones.id });
  const [zone] = await db.select().from(geoZones).where(eq(geoZones.id, result.id)).limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "geo_zone.create",
    tableName: "geo_zones",
    recordId: zone.id,
    after: zone,
  });

  return zone;
}

/**
 * Get a geo zone by ID.
 */
export async function getGeoZoneById(id: string): Promise<GeoZone | null> {
  const db = await getDb();
  if (!db) return null;

  const [zone] = await db.select().from(geoZones).where(eq(geoZones.id, id)).limit(1);
  return zone ?? null;
}

/**
 * Get a geo zone by name.
 */
export async function getGeoZoneByName(name: string): Promise<GeoZone | null> {
  const db = await getDb();
  if (!db) return null;

  const [zone] = await db.select().from(geoZones).where(eq(geoZones.zoneName, name)).limit(1);
  return zone ?? null;
}

/**
 * List all active geo zones.
 */
export async function listGeoZones(opts?: {
  includeInactive?: boolean;
}): Promise<GeoZone[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (!opts?.includeInactive) {
    conditions.push(eq(geoZones.isActive, true));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db.select().from(geoZones).orderBy(geoZones.zoneName);
  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  return await query;
}

/**
 * Update a geo zone.
 */
export async function updateGeoZone(
  id: number,
  data: Partial<Omit<InsertGeoZone, "id" | "createdAt" | "updatedAt">>,
  userId?: number
): Promise<GeoZone | null> {
  const db = await getDb();
  if (!db) return null;

  // Capture before state
  const [before] = await db.select().from(geoZones).where(eq(geoZones.id, id)).limit(1);
  if (!before) return null;

  await db.update(geoZones).set(data).where(eq(geoZones.id, id));

  const [after] = await db.select().from(geoZones).where(eq(geoZones.id, id)).limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "geo_zone.update",
    tableName: "geo_zones",
    recordId: id,
    before,
    after,
  });

  return after;
}

/**
 * Soft-deactivate a geo zone (set isActive = false).
 */
export async function deactivateGeoZone(id: string, userId?: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [before] = await db.select().from(geoZones).where(eq(geoZones.id, id)).limit(1);
  if (!before) return false;

  await db.update(geoZones).set({ isActive: false }).where(eq(geoZones.id, id));

  await logAudit({
    userId: userId ?? null,
    action: "geo_zone.deactivate",
    tableName: "geo_zones",
    recordId: id,
    before,
    after: { ...before, isActive: false },
  });

  return true;
}

/**
 * Reactivate a geo zone.
 */
export async function reactivateGeoZone(id: string, userId?: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db.update(geoZones).set({ isActive: true }).where(eq(geoZones.id, id));

  await logAudit({
    userId: userId ?? null,
    action: "geo_zone.reactivate",
    tableName: "geo_zones",
    recordId: id,
  });

  return true;
}

// ══════════════════════════════════════════════════════════════════════
// ZONE DETECTION FROM DB
// ══════════════════════════════════════════════════════════════════════

/**
 * Load all active zones as GeoZoneData for the geo-engine.
 * Converts DB rows (string decimals) to numbers.
 */
export async function loadActiveZonesForEngine(): Promise<GeoZoneData[]> {
  const zones = await listGeoZones({ includeInactive: false });
  return zones.map(dbZoneToEngineZone);
}

/**
 * Convert a DB GeoZone row to a GeoZoneData object for the engine.
 */
export function dbZoneToEngineZone(zone: GeoZone): GeoZoneData {
  return {
    id: zone.id,
    zoneName: zone.zoneName,
    county: zone.county,
    zipCodes: zone.zipCodes as string[] | null,
    centerLat: zone.centerLat ? parseFloat(String(zone.centerLat)) : null,
    centerLng: zone.centerLng ? parseFloat(String(zone.centerLng)) : null,
    radiusMiles: zone.radiusMiles ? parseFloat(String(zone.radiusMiles)) : 15,
    coastalExposureLevel: zone.coastalExposureLevel as GeoZoneData["coastalExposureLevel"],
    logisticsComplexity: zone.logisticsComplexity as GeoZoneData["logisticsComplexity"],
    laborModifier: parseFloat(String(zone.laborModifier)),
    logisticsModifier: parseFloat(String(zone.logisticsModifier)),
    materialModifier: parseFloat(String(zone.materialModifier)),
    contingencyPct: parseFloat(String(zone.contingencyPct)),
    minProfitShieldPct: parseFloat(String(zone.minProfitShieldPct)),
    isActive: zone.isActive,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PROJECT ZONE ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════

/**
 * Assign a zone modifier snapshot to a project.
 */
export async function assignZoneToProject(
  projectId: string,
  snapshot: ZoneModifierSnapshot,
  userId?: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Capture before state
  const [before] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!before) return false;

  await db.update(projects).set({
    zone: snapshot.zoneName,
    zoneModifierSnapshot: snapshot as any,
  }).where(eq(projects.id, projectId));

  await logAudit({
    userId: userId ?? null,
    action: "project.assign_zone",
    tableName: "projects",
    recordId: projectId,
    before: { zone: before.zone, zoneModifierSnapshot: before.zoneModifierSnapshot },
    after: { zone: snapshot.zoneName, zoneModifierSnapshot: snapshot },
  });

  return true;
}

/**
 * Get the zone modifier snapshot for a project.
 */
export async function getProjectZoneSnapshot(
  projectId: string
): Promise<ZoneModifierSnapshot | null> {
  const db = await getDb();
  if (!db) return null;

  const [project] = await db.select({
    zoneModifierSnapshot: projects.zoneModifierSnapshot,
  }).from(projects).where(eq(projects.id, projectId)).limit(1);

  return (project?.zoneModifierSnapshot as ZoneModifierSnapshot) ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// ZONE STATISTICS
// ══════════════════════════════════════════════════════════════════════

/**
 * Get zone statistics.
 */
export async function getGeoZoneStats(): Promise<{
  totalZones: number;
  activeZones: number;
  coastalZones: number;
  avgLaborModifier: number;
  avgMaterialModifier: number;
}> {
  const db = await getDb();
  if (!db) return {
    totalZones: 0,
    activeZones: 0,
    coastalZones: 0,
    avgLaborModifier: 1.0,
    avgMaterialModifier: 1.0,
  };

  const [stats] = await db.select({
    totalZones: sql<number>`COUNT(*)`,
    activeZones: sql<number>`SUM(CASE WHEN ${geoZones.isActive} = 1 THEN 1 ELSE 0 END)`,
    coastalZones: sql<number>`SUM(CASE WHEN ${geoZones.coastalExposureLevel} != 'none' AND ${geoZones.isActive} = 1 THEN 1 ELSE 0 END)`,
    avgLaborModifier: sql<number>`AVG(CASE WHEN ${geoZones.isActive} = 1 THEN ${geoZones.laborModifier} ELSE NULL END)`,
    avgMaterialModifier: sql<number>`AVG(CASE WHEN ${geoZones.isActive} = 1 THEN ${geoZones.materialModifier} ELSE NULL END)`,
  }).from(geoZones);

  return {
    totalZones: stats?.totalZones ?? 0,
    activeZones: stats?.activeZones ?? 0,
    coastalZones: stats?.coastalZones ?? 0,
    avgLaborModifier: stats?.avgLaborModifier ? parseFloat(String(stats.avgLaborModifier)) : 1.0,
    avgMaterialModifier: stats?.avgMaterialModifier ? parseFloat(String(stats.avgMaterialModifier)) : 1.0,
  };
}

// ══════════════════════════════════════════════════════════════════════
// SEED HELPERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Seed the 5 Charleston zones if they don't already exist.
 * Returns the number of zones created.
 */
export async function seedCharlestonZones(userId?: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Import seed data from engine
  const { CHARLESTON_ZONES } = await import("@shared/geo-engine");

  let created = 0;
  for (const zoneData of CHARLESTON_ZONES) {
    // Check if zone already exists
    const existing = await getGeoZoneByName(zoneData.zoneName);
    if (existing) continue;

    await createGeoZone({
      zoneName: zoneData.zoneName,
      county: zoneData.county,
      zipCodes: zoneData.zipCodes,
      centerLat: String(zoneData.centerLat) as any,
      centerLng: String(zoneData.centerLng) as any,
      radiusMiles: String(zoneData.radiusMiles) as any,
      coastalExposureLevel: zoneData.coastalExposureLevel,
      logisticsComplexity: zoneData.logisticsComplexity,
      laborModifier: String(zoneData.laborModifier) as any,
      logisticsModifier: String(zoneData.logisticsModifier) as any,
      materialModifier: String(zoneData.materialModifier) as any,
      contingencyPct: String(zoneData.contingencyPct) as any,
      minProfitShieldPct: String(zoneData.minProfitShieldPct) as any,
      description: `${zoneData.zoneName} — ${zoneData.county} County. Coastal: ${zoneData.coastalExposureLevel}, Logistics: ${zoneData.logisticsComplexity}.`,
      isActive: true,
    }, userId);

    created++;
  }

  return created;
}
