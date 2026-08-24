/**
 * structr.ai — Geographic Intelligence DB Helpers
 * Sprint 11: Geographic Intelligence Layer
 *
 * DB helpers for geo_zones CRUD, zone detection from DB, and seed operations.
 * All mutations log to audit trail.
 *
 * ── G3a-1 — GEO-ZONE TENANT POLICY BOUNDARY ─────────────────────────────────
 *
 * `geo_zones` rows are predominantly TENANT COMMERCIAL POLICY, not reference data:
 * `laborModifier`, `materialModifier`, `logisticsModifier`, `logisticsComplexity`,
 * `contingencyPct`, `costMultiplier`, `minProfitShieldPct` and the calibration fields
 * decide what a tenant charges and how much margin protection it carries.
 *
 * Every helper that touches that policy therefore takes a REQUIRED, non-nullable
 * `tenantId` as its first argument. Omitting it is a compile error at the call site.
 *
 * ── STRICT, NOT TRANSITIONAL ────────────────────────────────────────────────
 * The scoping here is deliberately STRICTER than the shared `tenant-scope.ts`
 * primitives used by bundles/clients/leads. Those emit a transitional
 * `tenant_id IS NULL` arm while TENANT_STRICT is off (F15 / issue #10); geo does NOT:
 *
 *     geo_zones.tenant_id = <trusted tenantId>          -- and nothing else
 *
 * A NULL `tenant_id` on a geo zone means UNKNOWN PROVENANCE. It does not mean
 * platform-global, it does not mean GCHI, and it does not mean the current tenant.
 * NULL-owned rows are unreachable through these tenant-policy APIs. Three reasons:
 *
 *   1. A visible legacy bundle is a template; a visible legacy geo zone is a priced
 *      commercial policy that silently changes another tenant's pricing and floors.
 *   2. Migration 0004 §14.2 states the intent in the repository itself: "Existing geo
 *      zones belong to the default tenant, so a second GC starts empty instead of
 *      inheriting Charleston zones it never validated."
 *   3. ADR-001 Invariant 1: no commercial or operational tenant data becomes global
 *      because `tenant_id` is NULL.
 *
 * `server/tenant-scope.ts` is NOT modified — it is shared, and its NULL arm is
 * deliberate for the domains that rely on it.
 *
 * ── rule-F5 — ATOMICITY (AGENTS.md:65) ──────────────────────────────────────
 *
 * "ALL multi-step DB operations use db.transaction()" — Tier 1 FATAL.
 *
 * Every mutation here issues more than one business statement (authorization read, write,
 * read-back), so each one owns a transaction. The shape is the repository's existing
 * wrapper/primitive idiom (`lead-db.ts`, `pipeline-db.ts`):
 *
 *     public wrapper   → opens db.transaction(), delegates, commits, THEN audits
 *     internal primitive (…InTx) → takes a DbHandle, opens nothing, audits nothing
 *     composite (seed) → opens ONE transaction and calls the primitives N times
 *
 * `seedCharlestonZones` therefore never calls the public `createGeoZone`: one invocation
 * is one transaction, and all rows it creates commit or roll back together. Nothing here
 * opens a nested transaction — the repository uses none and relies on no savepoints.
 *
 * The tenant predicate and the transaction are COMPLEMENTARY, not alternatives. The
 * predicate is the isolation control (a write cannot escape its tenant); the transaction
 * is the integrity control (partial writes cannot survive). rule-F5 requires the second
 * and is not discharged by the first.
 *
 * Transactions are short-lived and contain database operations only; the seed uses one
 * batch transaction for all new rows in an invocation. No transaction spans network I/O.
 *
 * AUDIT stays OUTSIDE the business transaction, matching every repository precedent
 * (`lead-conversion.ts:522`, `bundle-router.ts:186`, `assembly-db.ts:274`): `logAudit`
 * acquires its own connection, cannot take a handle, and swallows its own errors. That is
 * rule-F2's domain, deliberately non-transactional, and is not changed by this unit.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * This closes the caller axis and the explicit-row axis for geo policy. It does NOT
 * resolve the provenance of existing NULL-owned rows (F15-class), does not touch
 * historical `projects.zone_modifier_snapshot` data, and makes no claim about live
 * database ownership state.
 */

import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "./db";
import { geoZones, projects, type GeoZone, type InsertGeoZone } from "../drizzle/schema";
import { logAudit } from "./audit";
import type { GeoZoneData, ZoneModifierSnapshot } from "@shared/geo-engine";

/**
 * A database or transaction handle.
 *
 * Same alias `server/lead-db.ts` and `server/pipeline-db.ts` already use. Internal
 * primitives below take one of these instead of calling `getDb()` themselves, so the
 * public wrapper that owns the transaction can hand them its `tx` and every statement of
 * one operation runs on a single connection (rule-F5).
 */
type DbHandle = PostgresJsDatabase;

// ══════════════════════════════════════════════════════════════════════
// G3a-1 — STRICT GEO TENANT PREDICATE
// ══════════════════════════════════════════════════════════════════════

/**
 * Raised when a geo policy helper is reached without a resolved caller tenant.
 *
 * Defense in depth only: `tenantProcedure` is expected to reject the request first, so
 * an operator sees a provisioning error rather than a 500. This exists so a path that
 * forgets that boundary still cannot read or write tenant geo policy.
 */
export class GeoTenantScopeError extends Error {
  readonly code = "GEO_TENANT_UNRESOLVED";

  constructor(operation: string) {
    super(
      `Tenant scope is unresolved for ${operation}(); refusing to authorize geo policy access.`,
    );
    this.name = "GeoTenantScopeError";
  }
}

/** Runtime guard for callers the compiler cannot check (JS callers, casts, tests). */
function requireGeoTenant(tenantId: string | null | undefined, operation: string): string {
  if (!tenantId) throw new GeoTenantScopeError(operation);
  return tenantId;
}

/**
 * The single boundary cast between a drizzle transaction object and `DbHandle`.
 *
 * drizzle's `tx` is structurally a query builder but is not typed as `PostgresJsDatabase`,
 * so the repository's established idiom casts once where the transaction is opened
 * (`lead-db.ts:52,67`, `pipeline-db.ts:50,249` all do `fn(tx as any)`). Confining it to
 * this one helper keeps the cast off every call site and, deliberately, out of the
 * tenant-authorization logic — nothing below re-casts, and no primitive is typed loosely.
 */
function txHandle(tx: unknown): DbHandle {
  return tx as DbHandle;
}

/**
 * Internal signal used to roll a transaction back deliberately.
 *
 * Thrown inside a `db.transaction()` callback to abort the transaction when a business
 * precondition fails (target not found, read-back unauthorized). Caught by the wrapper
 * that opened the transaction and translated back into the helper's existing `null` /
 * `false` return contract, so route-level error mapping is unchanged. Never escapes this
 * module.
 */
class GeoZoneWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoZoneWriteError";
  }
}

/**
 * The geo policy predicate. STRICT equality — no `IS NULL` arm, by design (see header).
 * Always returns a predicate, so a geo policy query can never run unscoped.
 */
export function geoZoneTenantWhere(
  tenantId: string,
  ...conditions: Array<SQL | undefined>
): SQL {
  const id = requireGeoTenant(tenantId, "geoZoneTenantWhere");
  const parts = [eq(geoZones.tenantId, id), ...conditions].filter(
    (c): c is SQL => c !== undefined,
  );
  if (parts.length === 1) return parts[0];
  return and(...parts)!;
}

/**
 * Assert that a loaded geo zone belongs to the caller's tenant.
 * Returns false for an unresolved caller AND for a NULL-owned row — unknown provenance
 * is never the caller's policy. Used as defense in depth after a scoped point lookup, so
 * isolation does not rest on the query builder alone.
 */
export function assertGeoZoneTenant(
  rowTenantId: string | null | undefined,
  tenantId: string,
): boolean {
  if (!tenantId) return false;
  if (!rowTenantId) return false; // NULL = unknown provenance, never authorized
  return rowTenantId === tenantId;
}

/**
 * Authorized point lookup shared by every tenant-owned geo read/write.
 * Returns null when the zone does not exist, is owned by another tenant, or is
 * NULL-owned — all three are indistinguishable to the caller by design.
 */
async function loadGeoZoneInTenant(
  h: DbHandle,
  tenantId: string,
  id: string,
): Promise<GeoZone | null> {
  const [zone] = await h
    .select()
    .from(geoZones)
    .where(geoZoneTenantWhere(tenantId, eq(geoZones.id, id)))
    .limit(1);
  if (!zone) return null;
  if (!assertGeoZoneTenant(zone.tenantId, tenantId)) return null;
  return zone;
}

/**
 * Authorized lookup by zone name, on a caller-supplied handle.
 *
 * Same non-disclosing semantics as the id lookup: a zone owned by another tenant, or a
 * NULL-owned zone of unknown provenance, reads as absent. Taking the handle is what lets
 * the seed run its existence checks inside its own transaction, where they can see the
 * rows that transaction has already inserted.
 */
async function loadGeoZoneByNameInTenant(
  h: DbHandle,
  tenantId: string,
  name: string,
): Promise<GeoZone | null> {
  const [zone] = await h
    .select()
    .from(geoZones)
    .where(geoZoneTenantWhere(tenantId, eq(geoZones.zoneName, name)))
    .limit(1);
  if (!zone) return null;
  if (!assertGeoZoneTenant(zone.tenantId, tenantId)) return null;
  return zone;
}

/**
 * Insert one geo zone and read it back, both on the SAME handle.
 *
 * The single place the insert is expressed: `createGeoZone` and `seedCharlestonZones` both
 * delegate here, so there is no second implementation to drift. Opens no transaction and
 * writes no audit — the caller that owns the transaction does both.
 *
 * Ownership comes from the trusted `tenantId` argument alone; the `data` type excludes
 * `tenantId`, so a caller payload cannot supply or override one.
 */
async function insertGeoZoneInTx(
  h: DbHandle,
  tenantId: string,
  data: Omit<InsertGeoZone, "id" | "createdAt" | "updatedAt" | "tenantId">,
): Promise<GeoZone | null> {
  const [result] = await h
    .insert(geoZones)
    .values({ ...data, tenantId })
    .returning({ id: geoZones.id });

  // Read back through the tenant predicate on the same handle, so the row returned (and
  // later audited) is provably the one this operation just created for this tenant.
  return loadGeoZoneInTenant(h, tenantId, result.id);
}

// ══════════════════════════════════════════════════════════════════════
// ZONE CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a new geo zone owned by the trusted caller tenant.
 *
 * `tenantId` is deliberately excluded from the `data` type: ownership comes from the
 * trusted argument and cannot be supplied, overridden, or hinted at by a caller payload.
 */
export async function createGeoZone(
  tenantId: string,
  data: Omit<InsertGeoZone, "id" | "createdAt" | "updatedAt" | "tenantId">,
  userId?: string
): Promise<GeoZone | null> {
  const owner = requireGeoTenant(tenantId, "createGeoZone");
  const db = await getDb();
  if (!db) return null;

  // rule-F5: INSERT and the scoped read-back are one atomic unit. If the read-back fails
  // or cannot authorize the new row, the insert is rolled back rather than leaving a row
  // this function never returned.
  const zone = await db.transaction(async tx => {
    const created = await insertGeoZoneInTx(txHandle(tx), owner, data);
    if (!created) throw new GeoZoneWriteError("createGeoZone: read-back failed");
    return created;
  }).catch(err => {
    if (err instanceof GeoZoneWriteError) return null;
    throw err;
  });

  if (!zone) return null;

  // Audit AFTER commit, from the row already held in memory — no post-commit read-back,
  // which would reintroduce the multi-step problem outside the transaction.
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
 * Get a geo zone by ID, within the caller's tenant.
 * Foreign, NULL-owned and nonexistent all return null — no existence oracle.
 */
export async function getGeoZoneById(tenantId: string, id: string): Promise<GeoZone | null> {
  requireGeoTenant(tenantId, "getGeoZoneById");
  const db = await getDb();
  if (!db) return null;

  return loadGeoZoneInTenant(db, tenantId, id);
}

/**
 * Get a geo zone by name, within the caller's tenant.
 *
 * Zone names are unique PER TENANT after G3a-1, not globally: two tenants may each own a
 * "Charleston Coastal". A global name lookup would both leak existence and cause a second
 * tenant's seed to silently skip.
 */
export async function getGeoZoneByName(tenantId: string, name: string): Promise<GeoZone | null> {
  requireGeoTenant(tenantId, "getGeoZoneByName");
  const db = await getDb();
  if (!db) return null;

  return loadGeoZoneByNameInTenant(db, tenantId, name);
}

/**
 * List the caller tenant's geo zones. Strict: no foreign rows, no NULL-owned rows.
 */
export async function listGeoZones(tenantId: string, opts?: {
  includeInactive?: boolean;
}): Promise<GeoZone[]> {
  requireGeoTenant(tenantId, "listGeoZones");
  const db = await getDb();
  if (!db) return [];

  const activeOnly = opts?.includeInactive ? undefined : eq(geoZones.isActive, true);

  const rows = await db
    .select()
    .from(geoZones)
    .where(geoZoneTenantWhere(tenantId, activeOnly))
    .orderBy(geoZones.zoneName);

  // Defence in depth: the predicate above already excludes foreign and NULL-owned rows,
  // but this is the feed for detection and for every project/lead snapshot, so isolation
  // must not rest on the query builder alone. A row that reaches here without matching
  // ownership is dropped rather than priced against.
  return rows.filter(zone => assertGeoZoneTenant(zone.tenantId, tenantId));
}

/**
 * Update a geo zone the caller's tenant owns.
 *
 * Two distinct controls, both required:
 *   - ISOLATION: the tenant predicate is repeated on the UPDATE itself, so the write
 *     cannot outlive the authorization above it — no authorize-at-T0 / unscoped-write-at-T1
 *     gap. (This is tenant isolation, NOT rule-F5. An earlier revision of this comment
 *     attributed it to rule-F5; that was a conflation.)
 *   - ATOMICITY (rule-F5): the authorization read, the UPDATE and the read-back run in one
 *     `db.transaction()`. A repeated predicate does not satisfy rule-F5 — the rule names a
 *     mechanism, and only the transaction provides it.
 */
export async function updateGeoZone(
  tenantId: string,
  id: string,
  data: Partial<Omit<InsertGeoZone, "id" | "createdAt" | "updatedAt" | "tenantId">>,
  userId?: string
): Promise<GeoZone | null> {
  requireGeoTenant(tenantId, "updateGeoZone");
  const db = await getDb();
  if (!db) return null;

  // rule-F5: authorization read, UPDATE and read-back are one atomic unit on one handle.
  const result = await db.transaction(async rawTx => {
    const tx = txHandle(rawTx);

    // Capture before state — authorization and audit before-state in one read.
    const before = await loadGeoZoneInTenant(tx, tenantId, id);
    if (!before) throw new GeoZoneWriteError(`updateGeoZone: ${id} not in tenant`);

    await tx.update(geoZones).set(data).where(geoZoneTenantWhere(tenantId, eq(geoZones.id, id)));

    const after = await loadGeoZoneInTenant(tx, tenantId, id);
    return { before, after };
  }).catch(err => {
    if (err instanceof GeoZoneWriteError) return null;
    throw err;
  });

  if (!result) return null;
  const { before, after } = result;

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
 * Soft-deactivate a geo zone the caller's tenant owns (set isActive = false).
 */
export async function deactivateGeoZone(
  tenantId: string,
  id: string,
  userId?: string
): Promise<boolean> {
  requireGeoTenant(tenantId, "deactivateGeoZone");
  const db = await getDb();
  if (!db) return false;

  // rule-F5: authorization read and UPDATE are one atomic unit on one handle.
  const before = await db.transaction(async rawTx => {
    const tx = txHandle(rawTx);

    const row = await loadGeoZoneInTenant(tx, tenantId, id);
    if (!row) throw new GeoZoneWriteError(`deactivateGeoZone: ${id} not in tenant`);

    await tx
      .update(geoZones)
      .set({ isActive: false })
      .where(geoZoneTenantWhere(tenantId, eq(geoZones.id, id)));

    return row;
  }).catch(err => {
    if (err instanceof GeoZoneWriteError) return null;
    throw err;
  });

  if (!before) return false;

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
 * Reactivate a geo zone the caller's tenant owns.
 *
 * G3a-1 fix: this previously issued the UPDATE with no existence check and returned
 * `true` unconditionally, so a nonexistent (or foreign) id reported success and wrote an
 * audit row for a zone that was never touched. It now authorizes first, like every other
 * mutation, and carries a real before-state (rule-F2).
 */
export async function reactivateGeoZone(
  tenantId: string,
  id: string,
  userId?: string
): Promise<boolean> {
  requireGeoTenant(tenantId, "reactivateGeoZone");
  const db = await getDb();
  if (!db) return false;

  // rule-F5: authorization read and UPDATE are one atomic unit on one handle.
  const before = await db.transaction(async rawTx => {
    const tx = txHandle(rawTx);

    const row = await loadGeoZoneInTenant(tx, tenantId, id);
    if (!row) throw new GeoZoneWriteError(`reactivateGeoZone: ${id} not in tenant`);

    await tx
      .update(geoZones)
      .set({ isActive: true })
      .where(geoZoneTenantWhere(tenantId, eq(geoZones.id, id)));

    return row;
  }).catch(err => {
    if (err instanceof GeoZoneWriteError) return null;
    throw err;
  });

  if (!before) return false;

  await logAudit({
    userId: userId ?? null,
    action: "geo_zone.reactivate",
    tableName: "geo_zones",
    recordId: id,
    before,
    after: { ...before, isActive: true },
  });

  return true;
}

// ══════════════════════════════════════════════════════════════════════
// ZONE DETECTION FROM DB
// ══════════════════════════════════════════════════════════════════════

/**
 * Load the caller tenant's active zones as GeoZoneData for the geo-engine.
 *
 * This is the single chokepoint through which detection and every project/lead geo
 * consumer reads zone policy, so it is where their tenant scoping is enforced.
 */
export async function loadActiveZonesForEngine(tenantId: string): Promise<GeoZoneData[]> {
  requireGeoTenant(tenantId, "loadActiveZonesForEngine");
  const zones = await listGeoZones(tenantId, { includeInactive: false });
  return zones.map(dbZoneToEngineZone);
}

/**
 * Convert a DB GeoZone row to a GeoZoneData object for the engine.
 * Pure mapper — no DB access, no tenant decision.
 */
export function dbZoneToEngineZone(zone: GeoZone): GeoZoneData {
  return {
    id: zone.id,
    zoneName: zone.zoneName ?? zone.name,
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
 *
 * Unchanged by G3a-1: this writes `projects`, not `geo_zones`, and the project is already
 * authorized by the calling route's project guard. The G3a-1 invariant is upstream — the
 * SNAPSHOT handed to it must have been derived from a same-tenant zone.
 */
export async function assignZoneToProject(
  projectId: string,
  snapshot: ZoneModifierSnapshot,
  userId?: string
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
 * Reads project-owned historical state, not geo_zones — unchanged by G3a-1.
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
 * Get zone statistics for the caller's tenant.
 * Previously aggregated across every tenant, which leaked zone counts and average
 * modifiers — commercial policy in aggregate form.
 */
export async function getGeoZoneStats(tenantId: string): Promise<{
  totalZones: number;
  activeZones: number;
  coastalZones: number;
  avgLaborModifier: number;
  avgMaterialModifier: number;
}> {
  requireGeoTenant(tenantId, "getGeoZoneStats");
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
  }).from(geoZones).where(geoZoneTenantWhere(tenantId));

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
 * Seed the 5 Charleston zones INTO A NAMED TENANT if that tenant does not already have
 * them. Returns the number of zones created.
 *
 * G3a-1 changes three things:
 *   - ownership is stamped from the trusted `tenantId`, so no NULL-owned zone is created;
 *   - the duplicate check is tenant-scoped, so seeding tenant B no longer silently skips
 *     because tenant A already owns a zone with the same name (global name discovery);
 *   - `CHARLESTON_ZONES` is used here as SEED CONTENT for the named tenant, which is
 *     legitimate — the values become that tenant's own starting policy. It is no longer
 *     used as a silent runtime fallback anywhere (see geo-router / geo-integration).
 *
 * rule-F5 (AGENTS.md:65): ONE invocation is ONE logical provisioning operation and runs in
 * exactly ONE transaction. Every existence check and every insert executes on that single
 * handle, so the checks see rows this invocation has already staged, and if any step fails
 * every row it created rolls back together — a half-seeded set of coastal zones is not an
 * acceptable resting state for pricing policy.
 *
 * It deliberately calls the internal primitive rather than the public `createGeoZone`:
 * calling the wrapper would open a transaction inside a transaction, and this repository
 * neither uses nested transactions nor relies on savepoints.
 *
 * Rows that predate the invocation are never touched, skipping is unchanged, and the
 * return value is still the number of rows actually created.
 */
export async function seedCharlestonZones(tenantId: string, userId?: string): Promise<number> {
  const owner = requireGeoTenant(tenantId, "seedCharlestonZones");
  const db = await getDb();
  if (!db) return 0;

  // Import seed data from engine
  const { CHARLESTON_ZONES } = await import("@shared/geo-engine");

  // ONE transaction for every DB statement of this invocation.
  const created = await db.transaction(async rawTx => {
    const tx = txHandle(rawTx);
    const rows: GeoZone[] = [];

    for (const zoneData of CHARLESTON_ZONES) {
      // Does THIS tenant already have the zone? A zone owned by another tenant is not a
      // reason to skip, and must not be discoverable here. Runs on `tx`, so it also sees
      // what this invocation has already inserted.
      const existing = await loadGeoZoneByNameInTenant(tx, owner, zoneData.zoneName);
      if (existing) continue;

      const zone = await insertGeoZoneInTx(tx, owner, {
        name: zoneData.zoneName,
        zoneName: zoneData.zoneName,
        county: zoneData.county,
        zipCodes: zoneData.zipCodes,
        centerLat: zoneData.centerLat ?? null,
        centerLng: zoneData.centerLng ?? null,
        radiusMiles: zoneData.radiusMiles != null ? String(zoneData.radiusMiles) : null,
        coastalExposureLevel: zoneData.coastalExposureLevel,
        logisticsComplexity: zoneData.logisticsComplexity,
        laborModifier: zoneData.laborModifier != null ? String(zoneData.laborModifier) : null,
        logisticsModifier: zoneData.logisticsModifier != null ? String(zoneData.logisticsModifier) : null,
        materialModifier: zoneData.materialModifier != null ? String(zoneData.materialModifier) : null,
        contingencyPct: zoneData.contingencyPct != null ? String(zoneData.contingencyPct) : null,
        minProfitShieldPct: zoneData.minProfitShieldPct != null ? String(zoneData.minProfitShieldPct) : null,
        description: `${zoneData.zoneName} — ${zoneData.county} County. Coastal: ${zoneData.coastalExposureLevel}, Logistics: ${zoneData.logisticsComplexity}.`,
        isActive: true,
      });

      // A row we cannot read back and authorize is not a row we will keep.
      if (!zone) throw new GeoZoneWriteError(`seedCharlestonZones: read-back failed for ${zoneData.zoneName}`);
      rows.push(zone);
    }

    return rows;
  });

  // Audit AFTER commit, one record per row actually created, built from values captured
  // inside the transaction. No post-commit read-back is performed to construct them.
  //
  // These audit writes are NOT transactionally atomic with the inserts: `logAudit` opens
  // its own connection and swallows its own errors (rule-F2's deliberate design). A
  // rollback therefore emits no audit at all, but a committed seed whose audit write fails
  // stays committed.
  for (const zone of created) {
    await logAudit({
      userId: userId ?? null,
      action: "geo_zone.create",
      tableName: "geo_zones",
      recordId: zone.id,
      after: zone,
    });
  }

  return created.length;
}
