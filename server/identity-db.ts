/**
 * structr.ai — Identity DB Layer (Phase 1)
 *
 * Canonical identity model:
 *   profiles.id             → internal UUID. Every FK, RLS policy and audit row uses this.
 *   profiles.externalOpenId → unique external OAuth identifier (Manus openId / provider sub).
 *
 * The session cookie carries the EXTERNAL openId. Nothing in the database is ever
 * keyed by it directly; the openId is always resolved to an internal profile UUID
 * through `getProfileByExternalOpenId()`.
 *
 * Provides:
 *   - getDefaultTenantId()            → resolve/create the GCHI tenant
 *   - getProfileByExternalOpenId()    → functional session lookup (replaces the old stub)
 *   - getProfileById()
 *   - upsertProfileFromOAuth()        → OAuth callback sync (idempotent)
 *   - touchProfileSignIn()
 */

import { eq, sql } from "drizzle-orm";
import { DEFAULT_TENANT_SLUG } from "@shared/const";
import { getDb } from "./db";
import {
  profiles,
  tenants,
  type Profile,
  type Tenant,
} from "../drizzle/schema";

export type OAuthIdentity = {
  /** External OAuth identifier (Manus openId / provider sub). Never used as a FK. */
  externalOpenId: string;
  fullName?: string | null;
  email?: string | null;
  loginMethod?: string | null;
};

// ── Tenant resolution ─────────────────────────────────────────────────

let cachedDefaultTenantId: string | null = null;

/**
 * Resolve the default tenant (GCHI). Creates it on first use so that a fresh
 * database is never left without a tenant to attach new records to.
 */
export async function getDefaultTenant(): Promise<Tenant | null> {
  const db = await getDb();
  if (!db) return null;

  const [existing] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT_SLUG))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(tenants)
    .values({
      name: "GC Home Improvement LLC",
      slug: DEFAULT_TENANT_SLUG,
      legalName: "GC Home Improvement LLC",
      region: "charleston_sc",
    })
    .onConflictDoNothing({ target: tenants.slug })
    .returning();

  if (created) return created;

  const [afterRace] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT_SLUG))
    .limit(1);

  return afterRace ?? null;
}

export async function getDefaultTenantId(): Promise<string | null> {
  if (cachedDefaultTenantId) return cachedDefaultTenantId;
  const tenant = await getDefaultTenant();
  cachedDefaultTenantId = tenant?.id ?? null;
  return cachedDefaultTenantId;
}

/** Test/maintenance helper: drop the memoized tenant id. */
export function clearTenantCache(): void {
  cachedDefaultTenantId = null;
}

// ── Profile lookups ───────────────────────────────────────────────────

/**
 * Functional session lookup. Replaces the Phase 0 stub that always returned
 * `undefined` and therefore forced every request through the dev bypass.
 */
export async function getProfileByExternalOpenId(
  externalOpenId: string,
): Promise<Profile | null> {
  if (!externalOpenId) return null;

  const db = await getDb();
  if (!db) return null;

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.externalOpenId, externalOpenId))
    .limit(1);

  return profile ?? null;
}

export async function getProfileById(id: string): Promise<Profile | null> {
  if (!id) return null;

  const db = await getDb();
  if (!db) return null;

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);

  return profile ?? null;
}

// ── OAuth sync ────────────────────────────────────────────────────────

/**
 * Idempotent OAuth sync. Called from the OAuth callback and as a self-heal path
 * during session verification.
 *
 * Behaviour:
 *   - unknown externalOpenId → create profile with a fresh internal UUID
 *   - known externalOpenId   → update profile metadata and lastSignedIn
 *
 * The internal UUID is NEVER derived from the external openId.
 */
export async function upsertProfileFromOAuth(
  identity: OAuthIdentity,
): Promise<Profile | null> {
  if (!identity.externalOpenId) {
    throw new Error("externalOpenId is required to sync a profile");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Identity] Cannot sync profile: database not available");
    return null;
  }

  const tenantId = await getDefaultTenantId();

  const [row] = await db
    .insert(profiles)
    .values({
      tenantId,
      externalOpenId: identity.externalOpenId,
      fullName: identity.fullName ?? null,
      email: identity.email ?? null,
      loginMethod: identity.loginMethod ?? null,
      lastSignedIn: new Date(),
    })
    .onConflictDoUpdate({
      target: profiles.externalOpenId,
      set: {
        fullName: sql`COALESCE(EXCLUDED.full_name, ${profiles.fullName})`,
        email: sql`COALESCE(EXCLUDED.email, ${profiles.email})`,
        loginMethod: sql`COALESCE(EXCLUDED.login_method, ${profiles.loginMethod})`,
        tenantId: sql`COALESCE(${profiles.tenantId}, EXCLUDED.tenant_id)`,
        lastSignedIn: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  return row ?? getProfileByExternalOpenId(identity.externalOpenId);
}

/** Update lastSignedIn without touching any other profile field. */
export async function touchProfileSignIn(profileId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(profiles)
    .set({ lastSignedIn: new Date(), updatedAt: new Date() })
    .where(eq(profiles.id, profileId));
}
