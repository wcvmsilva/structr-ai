/**
 * structr.ai Construction Brain — Geographic Override DB Helpers
 * Sprint 16: Coastal Override Resolver
 *
 * CRUD for geographic_overrides and scope_override_log tables.
 * All mutations log to centralized audit trail.
 */

import { eq, and, or, asc, desc, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  geographicOverrides,
  scopeOverrideLog,
  projects,
  scopeDrafts,
  type GeographicOverride,
  type InsertGeographicOverride,
  type ScopeOverrideLogEntry,
} from "../drizzle/schema";
import { logAudit } from "./audit";
import { TenantScopeError } from "./tenant-scope";
import { requireEntityAccess, type ProjectPermission } from "./project-access";
import { validateOverrideRule, type OverrideRule, type ResolvedOverride } from "../shared/geo-override-engine";

export type OverrideRuleCreateData = Omit<
  InsertGeographicOverride,
  "id" | "tenantId" | "createdAt" | "updatedAt"
>;

export type OverrideRulePatch = Partial<Pick<
  OverrideRule,
  "zone" | "trade" | "finishLevel" | "originalAssemblyId" |
  "replacementAssemblyId" | "overrideType" | "reasonTemplate"
>> & { isActive?: boolean };

type OverrideDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type OverrideTx = Parameters<Parameters<OverrideDb["transaction"]>[0]>[0];
type OverrideHandle = OverrideDb | OverrideTx;
type OverrideWriteAction =
  | "geo_override.update"
  | "geo_override.deactivate"
  | "geo_override.reactivate";

const CREATE_FIELDS = [
  "zoneId", "assemblyId", "costCodeId", "overrideType", "overrideValue", "reason",
  "zone", "trade", "finishLevel", "reasonTemplate", "originalAssemblyId",
  "replacementAssemblyId", "isActive",
] as const satisfies readonly (keyof OverrideRuleCreateData)[];

const UPDATE_FIELDS = [
  "zone", "trade", "finishLevel", "originalAssemblyId", "replacementAssemblyId",
  "overrideType", "reasonTemplate", "isActive",
] as const satisfies readonly (keyof OverrideRulePatch)[];

function pickDefined<T extends object, K extends keyof T>(data: T, keys: readonly K[]): Pick<T, K> {
  const clean = {} as Pick<T, K>;
  for (const key of keys) {
    if (data[key] !== undefined) clean[key] = data[key];
  }
  return clean;
}

function requireOverrideTenant(tenantId: unknown, operation: string): string {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new TenantScopeError(operation);
  }
  return tenantId.toLowerCase();
}

// Rule CRUD, lists and aggregates use strict ownership in both TENANT_STRICT modes.
// Log helpers retain their separate, still-open contracts.
function overrideRuleWhere(owner: string, id: string): SQL {
  return and(eq(geographicOverrides.tenantId, owner), eq(geographicOverrides.id, id))!;
}

async function loadRuleInTenant(
  handle: OverrideHandle,
  owner: string,
  id: string,
  lockForUpdate: boolean,
): Promise<GeographicOverride | null> {
  const query = handle.select().from(geographicOverrides)
    .where(overrideRuleWhere(owner, id)).limit(1);
  const rows = lockForUpdate ? await query.for("update") : await query;
  const row = rows[0];
  if (!row || typeof row.id !== "string" || row.id.toLowerCase() !== id ||
      typeof row.tenantId !== "string" || row.tenantId.toLowerCase() !== owner) {
    return null;
  }
  return row;
}

class OverrideWriteVerificationError extends Error {
  constructor() {
    super("Override rule write could not be verified");
    this.name = "OverrideWriteVerificationError";
  }
}

async function changeRuleInTenant(
  tenantId: string,
  ruleId: string,
  data: OverrideRulePatch,
  operatorId: string,
  action: OverrideWriteAction,
): Promise<GeographicOverride | null> {
  const owner = requireOverrideTenant(tenantId, action);
  const id = ruleId.toLowerCase();
  const clean = pickDefined(data, UPDATE_FIELDS);
  const db = await getDb();
  if (!db) return null;

  const result = await db.transaction(async tx => {
    // Lock before capturing the snapshot so another writer cannot change it
    // between this authorization read and our UPDATE.
    const before = await loadRuleInTenant(tx, owner, id, true);
    if (!before) throw new OverrideWriteVerificationError();
    if (Object.keys(clean).length === 0) {
      return { before, after: before, didWrite: false };
    }

    const ids = await tx.update(geographicOverrides).set(clean)
      .where(overrideRuleWhere(owner, id)).returning({ id: geographicOverrides.id });
    if (ids.length !== 1 || typeof ids[0]?.id !== "string" || ids[0].id.toLowerCase() !== id) {
      throw new OverrideWriteVerificationError();
    }

    const after = await loadRuleInTenant(tx, owner, id, false);
    if (!after || (clean.isActive !== undefined && after.isActive !== clean.isActive)) {
      throw new OverrideWriteVerificationError();
    }
    return { before, after, didWrite: true };
  }).catch(error => {
    if (error instanceof OverrideWriteVerificationError) return null;
    throw error;
  });

  if (!result) return null;
  if (result.didWrite) {
    // Await audit after commit. A null audit result remains unconfirmed; an
    // unexpected throw may escape after the business change has committed.
    await logAudit({
      userId: null,
      action,
      tableName: "geographic_overrides",
      recordId: result.after.id,
      before: result.before,
      after: { ...result.after, operatorId },
    });
  }
  return result.after;
}

// ══════════════════════════════════════════════════════════════════════
// GEOGRAPHIC OVERRIDES — CRUD
// ══════════════════════════════════════════════════════════════════════

/** List the tenant's rules with optional intersecting filters. */
export async function listOverrideRules(tenantId: string, opts?: {
  zoneId?: string;
  zone?: string;
  trade?: string;
  activeOnly?: boolean;
}): Promise<GeographicOverride[]> {
  const owner = requireOverrideTenant(tenantId, "listOverrideRules");
  try {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const conditions = [eq(geographicOverrides.tenantId, owner)];
    if (opts?.zoneId) conditions.push(eq(geographicOverrides.zoneId, opts.zoneId));
    if (opts?.zone !== undefined) conditions.push(eq(geographicOverrides.zone, opts.zone));
    if (opts?.trade !== undefined) conditions.push(eq(geographicOverrides.trade, opts.trade));
    if (opts?.activeOnly !== false) conditions.push(eq(geographicOverrides.isActive, true));
    return await db.select().from(geographicOverrides)
      .where(and(...conditions)).orderBy(geographicOverrides.overrideType);
  } catch {
    // Empty results must mean a successful read; do not expose driver/SQL details.
    throw new Error("Geographic override rules are unavailable");
  }
}

/** Get an active or inactive rule owned by the caller's tenant. */
export async function getOverrideRuleById(tenantId: string, id: string): Promise<GeographicOverride | null> {
  const owner = requireOverrideTenant(tenantId, "getOverrideRuleById");
  const ruleId = id.toLowerCase();
  const db = await getDb();
  if (!db) return null;
  return loadRuleInTenant(db, owner, ruleId, false);
}

/** Create a new override rule */
export async function createOverrideRule(
  tenantId: string,
  data: OverrideRuleCreateData,
  operatorId: string
): Promise<GeographicOverride> {
  const owner = requireOverrideTenant(tenantId, "createOverrideRule");
  const clean = pickDefined(data, CREATE_FIELDS);
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const created = await db.transaction(async tx => {
    const ids = await tx.insert(geographicOverrides)
      .values({ ...clean, tenantId: owner }).returning({ id: geographicOverrides.id });
    if (ids.length !== 1 || typeof ids[0]?.id !== "string" || !ids[0].id) {
      throw new OverrideWriteVerificationError();
    }
    const row = await loadRuleInTenant(tx, owner, ids[0].id.toLowerCase(), false);
    if (!row) throw new OverrideWriteVerificationError();
    return row;
  });

  // The row is committed before this awaited, separately persisted audit.
  await logAudit({
    userId: null,
    action: "geo_override.create",
    tableName: "geographic_overrides",
    recordId: created.id,
    after: { ...created, operatorId },
  });

  return created;
}

/** Update an existing override rule */
export async function updateOverrideRule(
  tenantId: string,
  id: string,
  data: OverrideRulePatch,
  operatorId: string
): Promise<GeographicOverride | null> {
  return changeRuleInTenant(tenantId, id, data, operatorId, "geo_override.update");
}

/** Deactivate an override rule (soft delete) */
export async function deactivateOverrideRule(
  tenantId: string,
  id: string,
  operatorId: string
): Promise<boolean> {
  const row = await changeRuleInTenant(tenantId, id, { isActive: false }, operatorId, "geo_override.deactivate");
  return row !== null;
}

/** Reactivate an override rule */
export async function reactivateOverrideRule(
  tenantId: string,
  id: string,
  operatorId: string
): Promise<boolean> {
  const row = await changeRuleInTenant(tenantId, id, { isActive: true }, operatorId, "geo_override.reactivate");
  return row !== null;
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE OVERRIDE LOG — QUERIES & WRITES
// ══════════════════════════════════════════════════════════════════════

// G2 — override history authority.
//
// The four history operations are authorized by the draft's CURRENT parents: the
// project that owns it. They are never authorized by the current owner of a rule that
// a historical row happens to reference — a removed, deactivated or reassigned rule
// does not hide history the parent authorizes, while a NEW entry still requires a
// live, own, active rule.
//
// A draft with no tenant of its own stays reachable through an authorized project and
// its column is never rewritten. A draft bound to another tenant, a project of another
// tenant, a project with no identified tenant and a deleted project are refused — in
// both TENANT_STRICT modes, because this local predicate does not consult that flag.

export type OverrideLogAuthority = Readonly<{ tenantId: string; userId: string }>;
export type OverrideLogPermission = Extract<ProjectPermission, "read" | "write" | "delete">;
export type OverrideLogAccess = Readonly<{
  tenantId: string;
  scopeDraftId: string;
  projectId: string;
  permission: OverrideLogPermission;
}>;
export type OverrideRuleSnapshot = Readonly<Pick<GeographicOverride,
  "id" | "tenantId" | "zone" | "trade" | "finishLevel" |
  "originalAssemblyId" | "replacementAssemblyId" | "overrideType" |
  "reasonTemplate" | "isActive"
>>;
export type OverrideLogWriteEntry = Readonly<{
  overrideId: string;
  originalAssemblyId: string;
  replacementAssemblyId: string;
  overrideType: ResolvedOverride["overrideType"];
  reason: string;
}>;
export type OverrideLogWriteBatch = Readonly<{
  expectedProjectId: string;
  expectedHistory: readonly ScopeOverrideLogEntry[];
  expectedRules: readonly OverrideRuleSnapshot[];
  entries: readonly OverrideLogWriteEntry[];
}>;

const HISTORY_DENIED = "Override history is unavailable for this draft";
const HISTORY_UNAVAILABLE = "Override history is unavailable";
const HISTORY_CHANGED = "Override inputs changed; resolve again";
const HISTORY_BAD_BATCH = "Invalid override history batch";

/** Generic on purpose: a refusal must not describe the parent it refused. */
const denied = () => new TRPCError({ code: "FORBIDDEN", message: HISTORY_DENIED });
/** No SQL, no driver text, no serialized cause. */
const unavailable = () => new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: HISTORY_UNAVAILABLE });
const changed = () => new TRPCError({ code: "CONFLICT", message: HISTORY_CHANGED });
const invalidBatch = () => new TRPCError({ code: "BAD_REQUEST", message: HISTORY_BAD_BATCH });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OVERRIDE_TYPES = ["swap", "add", "warning_only"] as const;
const ENTRY_FIELDS = ["overrideId", "originalAssemblyId", "replacementAssemblyId", "overrideType", "reason"] as const;
const BATCH_FIELDS = ["expectedProjectId", "expectedHistory", "expectedRules", "entries"] as const;

function identity(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** Copied and validated before any await, so a caller cannot mutate it mid-operation. */
function copyAuthority(authority: OverrideLogAuthority): { tenantId: string; userId: string } {
  const source = (authority ?? {}) as Record<string, unknown>;
  const tenantId = identity(source.tenantId);
  const userId = identity(source.userId);
  if (!tenantId || !userId) throw denied();
  return { tenantId, userId };
}

function requireDraftId(draftId: string): string {
  const id = identity(draftId);
  if (!id) throw denied();
  return id;
}

function requirePermission(
  permission: unknown, allowed: readonly OverrideLogPermission[],
): OverrideLogPermission {
  if (typeof permission !== "string" || !(allowed as readonly string[]).includes(permission)) {
    throw denied();
  }
  return permission as OverrideLogPermission;
}

async function acquireHistoryDb(): Promise<OverrideDb> {
  const db = await getDb().catch(() => null);
  if (!db) throw unavailable();
  return db;
}

/** Known permission errors are preserved; everything else becomes a safe error. */
async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw unavailable();
  }
}

/** The local parent policy. Independent of TENANT_STRICT by design. */
function parentWhere(tenantId: string, draftId: string, projectId: string): SQL {
  return and(
    eq(scopeDrafts.id, draftId),
    eq(scopeDrafts.projectId, projectId),
    eq(projects.id, projectId),
    eq(projects.tenantId, tenantId),
    isNull(projects.deletedAt),
    or(eq(scopeDrafts.tenantId, tenantId), isNull(scopeDrafts.tenantId)),
  )!;
}

const PARENT_COLUMNS = {
  draftId: scopeDrafts.id,
  draftTenantId: scopeDrafts.tenantId,
  draftProjectId: scopeDrafts.projectId,
  projectId: projects.id,
  projectTenantId: projects.tenantId,
  projectDeletedAt: projects.deletedAt,
} as const;

type ParentRow = {
  draftId: string | null;
  draftTenantId: string | null;
  draftProjectId: string | null;
  projectId: string | null;
  projectTenantId: string | null;
  projectDeletedAt: Date | null;
};

/** The columns actually returned are verified; the predicate is not trusted alone. */
function parentApproved(row: ParentRow | undefined, tenantId: string, draftId: string, projectId: string): boolean {
  if (!row) return false;
  const draftTenant = row.draftTenantId === null ? null : identity(row.draftTenantId);
  return identity(row.draftId) === draftId
    && identity(row.draftProjectId) === projectId
    && identity(row.projectId) === projectId
    && identity(row.projectTenantId) === tenantId
    && row.projectDeletedAt === null
    && (draftTenant === null || draftTenant === tenantId);
}

async function authorizeParents(
  who: { tenantId: string; userId: string }, draftId: string, permission: OverrideLogPermission,
): Promise<OverrideLogAccess> {
  // Outside any transaction: the guard uses its own acquisition and must never run
  // inside a callback that already holds the single laboratory connection.
  let granted;
  try {
    granted = await requireEntityAccess("scopeDraft", draftId, who.userId, permission);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw unavailable();
  }
  const projectId = identity(granted.projectId);
  if (!projectId || identity(granted.tenantId) !== who.tenantId) throw denied();

  const db = await acquireHistoryDb();
  const rows = await safely(() => db.select(PARENT_COLUMNS).from(scopeDrafts)
    .innerJoin(projects, eq(projects.id, scopeDrafts.projectId))
    .where(parentWhere(who.tenantId, draftId, projectId))
    .limit(1));
  if (!parentApproved(rows[0] as ParentRow | undefined, who.tenantId, draftId, projectId)) throw denied();

  return Object.freeze({ tenantId: who.tenantId, scopeDraftId: draftId, projectId, permission });
}

/**
 * Local preflight. Refuses a missing identity before any database is acquired, then
 * runs the existing project guard and the parent policy. It returns no durable token:
 * every operation repeats the final predicate for itself.
 */
export async function requireScopeOverrideLogAccess(
  authority: OverrideLogAuthority,
  draftId: string,
  permission: OverrideLogPermission,
): Promise<OverrideLogAccess> {
  const who = copyAuthority(authority);
  const draft = requireDraftId(draftId);
  const wanted = requirePermission(permission, ["read", "write", "delete"]);
  return authorizeParents(who, draft, wanted);
}

/**
 * Read the history of an authorized draft.
 *
 * The query is anchored on the authorized parent pair and LEFT JOINs the history, so an
 * authorized parent with no rows returns `[]` while zero parent rows is a refusal. An
 * empty array therefore always means a successful, authorized, empty read.
 */
export async function getOverrideLogForDraft(
  authority: OverrideLogAuthority,
  draftId: string,
  permission: "read" | "write",
): Promise<ScopeOverrideLogEntry[]> {
  const who = copyAuthority(authority);
  const draft = requireDraftId(draftId);
  const wanted = requirePermission(permission, ["read", "write"]);
  const access = await authorizeParents(who, draft, wanted);

  const db = await acquireHistoryDb();
  const rows = await safely(() => db
    .select({ entry: scopeOverrideLog })
    .from(scopeDrafts)
    .innerJoin(projects, eq(projects.id, scopeDrafts.projectId))
    .leftJoin(scopeOverrideLog, eq(scopeOverrideLog.scopeDraftId, scopeDrafts.id))
    .where(parentWhere(who.tenantId, draft, access.projectId))
    .orderBy(desc(scopeOverrideLog.createdAt), desc(scopeOverrideLog.id)));

  if (rows.length === 0) throw denied();
  return rows.flatMap(row => (row.entry ? [row.entry] : []));
}

/** Whether an authorized draft has history. False only after an authorized read. */
export async function hasOverridesApplied(
  authority: OverrideLogAuthority,
  draftId: string,
): Promise<boolean> {
  const who = copyAuthority(authority);
  const draft = requireDraftId(draftId);
  const access = await authorizeParents(who, draft, "read");

  const db = await acquireHistoryDb();
  const rows = await safely(() => db
    .select({
      applied: sql<boolean>`EXISTS (SELECT 1 FROM ${scopeOverrideLog} WHERE ${scopeOverrideLog.scopeDraftId} = ${scopeDrafts.id})`,
    })
    .from(scopeDrafts)
    .innerJoin(projects, eq(projects.id, scopeDrafts.projectId))
    .where(parentWhere(who.tenantId, draft, access.projectId))
    .limit(1));

  if (rows.length === 0) throw denied();
  return rows[0].applied === true;
}

// ── Snapshot comparison ───────────────────────────────────────────────
// Values are compared, never counts, hashes or "latest timestamp". Timestamps are
// normalized through the driver's own Date, so a difference that exists only in the
// sub-millisecond precision the driver already discarded is NOT claimed to be detected.

function requiredIdentity(value: unknown): string {
  const id = identity(value);
  if (!id) throw invalidBatch();
  return id;
}

function optionalIdentity(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredIdentity(value);
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalidBatch();
  return value;
}

function instant(value: unknown): string {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw invalidBatch();
  return date.toISOString();
}

/** Every column of a history row, in a comparable form. */
function historyFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify([
    requiredIdentity(row.id),
    requiredIdentity(row.scopeDraftId),
    optionalIdentity(row.overrideId),
    optionalIdentity(row.originalAssemblyId),
    optionalIdentity(row.replacementAssemblyId),
    optionalText(row.overrideType),
    optionalText(row.reason),
    instant(row.createdAt),
  ]);
}

/** The ten rule columns the engine actually consumed. */
function ruleFingerprint(rule: Record<string, unknown>): string {
  return JSON.stringify([
    requiredIdentity(rule.id),
    optionalIdentity(rule.tenantId),
    optionalText(rule.zone),
    optionalText(rule.trade),
    optionalText(rule.finishLevel),
    optionalIdentity(rule.originalAssemblyId),
    optionalIdentity(rule.replacementAssemblyId),
    optionalText(rule.overrideType),
    optionalText(rule.reasonTemplate),
    rule.isActive === true,
  ]);
}

type PlannedEntry = {
  overrideId: string;
  originalAssemblyId: string;
  replacementAssemblyId: string;
  overrideType: ResolvedOverride["overrideType"];
  reason: string;
};
type PlannedBatch = {
  expectedProjectId: string;
  history: string[];
  rules: Map<string, string>;
  entries: PlannedEntry[];
};

/**
 * Copies and validates the batch before any await. Entries admit exactly their five
 * declared fields: a protected column (id, scopeDraftId, tenantId, createdAt) makes the
 * batch invalid rather than being silently dropped. No tenant, operator or parent is
 * ever taken from this payload.
 */
function copyBatch(batch: OverrideLogWriteBatch, draftId: string): PlannedBatch {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) throw invalidBatch();
  const source = batch as unknown as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== BATCH_FIELDS.length || !BATCH_FIELDS.every(field => keys.includes(field))) {
    throw invalidBatch();
  }
  const expectedProjectId = identity(source.expectedProjectId);
  if (!expectedProjectId) throw invalidBatch();
  if (!Array.isArray(source.expectedHistory) || !Array.isArray(source.expectedRules) || !Array.isArray(source.entries)) {
    throw invalidBatch();
  }

  const history = (source.expectedHistory as unknown[]).map(row => {
    if (!row || typeof row !== "object") throw invalidBatch();
    const record = row as Record<string, unknown>;
    // Only the target draft's own history may be presented as its snapshot.
    if (requiredIdentity(record.scopeDraftId) !== draftId) throw invalidBatch();
    return historyFingerprint(record);
  }).sort();

  const rules = new Map<string, string>();
  for (const rule of source.expectedRules as unknown[]) {
    if (!rule || typeof rule !== "object") throw invalidBatch();
    const record = rule as Record<string, unknown>;
    const ruleId = requiredIdentity(record.id);
    const fingerprint = ruleFingerprint(record);
    const seen = rules.get(ruleId);
    if (seen !== undefined && seen !== fingerprint) throw invalidBatch();
    rules.set(ruleId, fingerprint);
  }

  const entries = (source.entries as unknown[]).map(entry => {
    if (!entry || typeof entry !== "object") throw invalidBatch();
    const record = entry as Record<string, unknown>;
    const fields = Object.keys(record);
    if (fields.length !== ENTRY_FIELDS.length || !ENTRY_FIELDS.every(field => fields.includes(field))) {
      throw invalidBatch();
    }
    const overrideType = record.overrideType;
    if (typeof overrideType !== "string" || !(OVERRIDE_TYPES as readonly string[]).includes(overrideType)) {
      throw invalidBatch();
    }
    if (typeof record.reason !== "string") throw invalidBatch();
    const overrideId = requiredIdentity(record.overrideId);
    if (!rules.has(overrideId)) throw invalidBatch();
    return Object.freeze({
      overrideId,
      originalAssemblyId: requiredIdentity(record.originalAssemblyId),
      replacementAssemblyId: requiredIdentity(record.replacementAssemblyId),
      overrideType: overrideType as ResolvedOverride["overrideType"],
      reason: record.reason,
    });
  });

  return { expectedProjectId, history, rules, entries };
}

function sameFingerprints(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Parent lock order: project SHARE, then the exact draft FOR UPDATE. */
async function lockParents(
  tx: OverrideTx, tenantId: string, draftId: string, projectId: string,
): Promise<void> {
  const [project] = await tx.select({
    id: projects.id, tenantId: projects.tenantId, deletedAt: projects.deletedAt,
  }).from(projects).where(eq(projects.id, projectId)).limit(1).for("share");

  const [draft] = await tx.select({
    id: scopeDrafts.id, projectId: scopeDrafts.projectId, tenantId: scopeDrafts.tenantId,
  }).from(scopeDrafts).where(eq(scopeDrafts.id, draftId)).limit(1).for("update");

  const observed: ParentRow | undefined = project && draft ? {
    draftId: draft.id,
    draftTenantId: draft.tenantId,
    draftProjectId: draft.projectId,
    projectId: project.id,
    projectTenantId: project.tenantId,
    projectDeletedAt: project.deletedAt,
  } : undefined;
  if (!parentApproved(observed, tenantId, draftId, projectId)) throw denied();
}

/** The rules the new entries reference must still be own, active and engine-valid. */
function confirmRules(plan: PlannedBatch, referenced: string[], locked: GeographicOverride[], tenantId: string): void {
  if (locked.length !== referenced.length) throw changed();
  const confirmed = new Map<string, GeographicOverride>();
  for (const rule of locked) {
    const ruleId = requiredIdentity(rule.id);
    const expected = plan.rules.get(ruleId);
    if (!expected || expected !== ruleFingerprint(rule as unknown as Record<string, unknown>)) throw changed();
    if (identity(rule.tenantId) !== tenantId || rule.isActive !== true) throw changed();
    const invalid = validateOverrideRule({
      zone: rule.zone ?? undefined,
      trade: rule.trade ?? undefined,
      originalAssemblyId: rule.originalAssemblyId ?? undefined,
      replacementAssemblyId: rule.replacementAssemblyId ?? undefined,
      overrideType: rule.overrideType as OverrideRule["overrideType"],
      reasonTemplate: rule.reasonTemplate ?? undefined,
    });
    if (invalid.length > 0) throw changed();
    confirmed.set(ruleId, rule);
  }
  for (const entry of plan.entries) {
    const rule = confirmed.get(entry.overrideId);
    if (!rule) throw changed();
    if (identity(rule.originalAssemblyId) !== entry.originalAssemblyId
      || identity(rule.replacementAssemblyId) !== entry.replacementAssemblyId
      || rule.overrideType !== entry.overrideType) {
      throw changed();
    }
  }
}

const LOG_COLUMNS = {
  id: scopeOverrideLog.id,
  scopeDraftId: scopeOverrideLog.scopeDraftId,
  overrideId: scopeOverrideLog.overrideId,
  originalAssemblyId: scopeOverrideLog.originalAssemblyId,
  replacementAssemblyId: scopeOverrideLog.replacementAssemblyId,
  overrideType: scopeOverrideLog.overrideType,
  reason: scopeOverrideLog.reason,
  createdAt: scopeOverrideLog.createdAt,
} as const;

/**
 * Inserts the batch with the authorized parent restated as the final predicate, then
 * confirms it: the returned count and distinct ids, a read-back multiset of the six
 * persisted values, and the final history equal to the previous history plus exactly
 * the confirmed rows. Any divergence throws and the whole batch is rolled back.
 */
async function insertVerified(
  tx: OverrideTx, tenantId: string, draftId: string, projectId: string,
  entries: readonly PlannedEntry[], before: readonly ScopeOverrideLogEntry[],
): Promise<ScopeOverrideLogEntry[]> {
  const values = sql.join(entries.map(entry => sql`(
    ${entry.overrideId}::uuid, ${entry.originalAssemblyId}::uuid,
    ${entry.replacementAssemblyId}::uuid, ${entry.overrideType}::text, ${entry.reason}::text
  )`), sql`, `);

  const returned = (await tx.execute(sql`
    INSERT INTO ${scopeOverrideLog}
      (${sql.raw('"scope_draft_id", "override_id", "original_assembly_id", "replacement_assembly_id", "override_type", "reason"')})
    SELECT ${draftId}::uuid, v.rule_id, v.original_id, v.replacement_id, v.kind, v.reason
    FROM (VALUES ${values}) AS v(rule_id, original_id, replacement_id, kind, reason)
    WHERE EXISTS (
      SELECT 1 FROM ${scopeDrafts}
      INNER JOIN ${projects} ON ${projects.id} = ${scopeDrafts.projectId}
      WHERE ${parentWhere(tenantId, draftId, projectId)}
    )
    RETURNING ${scopeOverrideLog.id}
  `)) as unknown as Array<{ id: unknown }>;

  const ids = Array.from(returned).map(row => identity(row.id));
  if (ids.length !== entries.length || ids.some(value => value === null) || new Set(ids).size !== ids.length) {
    throw unavailable();
  }

  const readback = await tx.select(LOG_COLUMNS).from(scopeOverrideLog)
    .innerJoin(scopeDrafts, eq(scopeDrafts.id, scopeOverrideLog.scopeDraftId))
    .innerJoin(projects, eq(projects.id, scopeDrafts.projectId))
    .where(and(inArray(scopeOverrideLog.id, ids as string[]), parentWhere(tenantId, draftId, projectId)));

  const expectedRows = entries.map(entry => JSON.stringify([
    draftId, entry.overrideId, entry.originalAssemblyId,
    entry.replacementAssemblyId, entry.overrideType, entry.reason,
  ])).sort();
  const persistedRows = readback.map(row => JSON.stringify([
    requiredIdentity(row.scopeDraftId), optionalIdentity(row.overrideId), optionalIdentity(row.originalAssemblyId),
    optionalIdentity(row.replacementAssemblyId), optionalText(row.overrideType), optionalText(row.reason),
  ])).sort();
  if (!sameFingerprints(expectedRows, persistedRows)) throw unavailable();

  const final = await tx.select(LOG_COLUMNS).from(scopeOverrideLog)
    .where(eq(scopeOverrideLog.scopeDraftId, draftId));
  const expectedFinal = [
    ...before.map(row => historyFingerprint(row as unknown as Record<string, unknown>)),
    ...readback.map(row => historyFingerprint(row as unknown as Record<string, unknown>)),
  ].sort();
  if (!sameFingerprints(expectedFinal, final.map(row => historyFingerprint(row as unknown as Record<string, unknown>)).sort())) {
    throw unavailable();
  }

  return readback as ScopeOverrideLogEntry[];
}

/**
 * Append resolved occurrences to an authorized draft's history.
 *
 * Every occurrence the engine reported is preserved, including identical ones: the
 * count written is a count of resolution occurrences, not of distinct swaps. The
 * snapshot validates the observable history and the referenced rules; it does not
 * detect an intermediate cycle that restored exactly the same values, unrelated new
 * rules, catalog changes, or writers that bypass this protocol.
 */
export async function writeOverrideLogEntries(
  authority: OverrideLogAuthority,
  draftId: string,
  batch: OverrideLogWriteBatch,
): Promise<number> {
  const who = copyAuthority(authority);
  const draft = requireDraftId(draftId);
  const plan = copyBatch(batch, draft);

  const access = await authorizeParents(who, draft, "write");
  if (access.projectId !== plan.expectedProjectId) throw changed();

  const db = await acquireHistoryDb();
  const outcome = await safely(() => db.transaction(async tx => {
    await lockParents(tx, who.tenantId, draft, access.projectId);

    const referenced = Array.from(new Set(plan.entries.map(entry => entry.overrideId))).sort();
    const locked = referenced.length === 0 ? [] : await tx.select().from(geographicOverrides)
      .where(inArray(geographicOverrides.id, referenced))
      .orderBy(asc(geographicOverrides.id))
      .for("share");
    confirmRules(plan, referenced, locked, who.tenantId);

    const before = await tx.select(LOG_COLUMNS).from(scopeOverrideLog)
      .where(eq(scopeOverrideLog.scopeDraftId, draft))
      .orderBy(asc(scopeOverrideLog.id))
      .for("update");
    const current = before.map(row => historyFingerprint(row as unknown as Record<string, unknown>)).sort();
    if (!sameFingerprints(current, plan.history)) throw changed();

    // An empty batch still validates the parents and the history, and writes nothing.
    if (plan.entries.length === 0) return { inserted: [] as ScopeOverrideLogEntry[], before };

    const inserted = await insertVerified(tx, who.tenantId, draft, access.projectId, plan.entries, before as ScopeOverrideLogEntry[]);
    return { inserted, before };
  }));

  if (outcome.inserted.length > 0) {
    // After the commit. A null result is an unconfirmed audit and an unexpected throw
    // escapes here: neither undoes the business change that already committed.
    await logAudit({
      userId: null,
      action: "geo_override.resolve",
      tableName: "scope_override_log",
      recordId: draft,
      // The history as it stood before the insert, captured under the lock inside the
      // transaction — values, not a count.
      before: { entries: outcome.before },
      after: {
        entriesWritten: outcome.inserted.length,
        entries: outcome.inserted,
        operatorId: who.userId,
      },
    });
  }
  return outcome.inserted.length;
}

/**
 * Delete the history of an authorized draft and return how many rows were really
 * removed. Zero rows is zero, with no mutation and no audit event.
 */
export async function clearOverrideLogForDraft(
  authority: OverrideLogAuthority,
  draftId: string,
): Promise<number> {
  const who = copyAuthority(authority);
  const draft = requireDraftId(draftId);
  const access = await authorizeParents(who, draft, "delete");

  const db = await acquireHistoryDb();
  const outcome = await safely(() => db.transaction(async tx => {
    await lockParents(tx, who.tenantId, draft, access.projectId);

    const before = await tx.select(LOG_COLUMNS).from(scopeOverrideLog)
      .where(eq(scopeOverrideLog.scopeDraftId, draft))
      .orderBy(asc(scopeOverrideLog.id))
      .for("update");
    if (before.length === 0) return { before, deleted: [] as ScopeOverrideLogEntry[] };

    const deleted = await tx.delete(scopeOverrideLog).where(and(
      eq(scopeOverrideLog.scopeDraftId, draft),
      sql`EXISTS (
        SELECT 1 FROM ${scopeDrafts}
        INNER JOIN ${projects} ON ${projects.id} = ${scopeDrafts.projectId}
        WHERE ${parentWhere(who.tenantId, draft, access.projectId)}
      )`,
    )).returning(LOG_COLUMNS);

    const expected = before.map(row => historyFingerprint(row as unknown as Record<string, unknown>)).sort();
    const removed = deleted.map(row => historyFingerprint(row as unknown as Record<string, unknown>)).sort();
    if (!sameFingerprints(expected, removed)) throw unavailable();

    const remaining = await tx.select({ id: scopeOverrideLog.id }).from(scopeOverrideLog)
      .where(eq(scopeOverrideLog.scopeDraftId, draft));
    if (remaining.length !== 0) throw unavailable();

    return { before, deleted: deleted as ScopeOverrideLogEntry[] };
  }));

  if (outcome.deleted.length > 0) {
    await logAudit({
      userId: null,
      action: "geo_override.clear",
      tableName: "scope_override_log",
      recordId: draft,
      before: { entries: outcome.before },
      after: { entriesCleared: outcome.deleted.length, operatorId: who.userId },
    });
  }
  return outcome.deleted.length;
}

// ══════════════════════════════════════════════════════════════════════
// STATISTICS
// ══════════════════════════════════════════════════════════════════════

/** Count the tenant's active rules, including its legitimate NULL-zone group. */
export async function getOverrideCountsByZoneId(tenantId: string): Promise<
  { zoneId: string | null; count: number }[]
> {
  const owner = requireOverrideTenant(tenantId, "getOverrideCountsByZoneId");
  try {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return await db.select({
      zoneId: geographicOverrides.zoneId,
      count: sql<number>`count(*)`.mapWith(Number),
    }).from(geographicOverrides)
      .where(and(eq(geographicOverrides.tenantId, owner), eq(geographicOverrides.isActive, true)))
      .groupBy(geographicOverrides.zoneId)
      .orderBy(desc(sql`count(*)`));
  } catch {
    throw new Error("Geographic override rules are unavailable");
  }
}

// ══════════════════════════════════════════════════════════════════════
// COMPATIBILITY ALIASES (old function names for router compatibility)
// ══════════════════════════════════════════════════════════════════════
export const getOverrideCountsByZone = getOverrideCountsByZoneId;
