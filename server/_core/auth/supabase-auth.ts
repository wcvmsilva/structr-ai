/**
 * structr.ai — Supabase → Structr identity mapping (Supabase Auth V1)
 *
 * Bridges a verified Supabase identity onto the existing Structr identity model.
 * Nothing about the model changes:
 *
 *   profiles.id                → internal UUID, used by every FK, RLS policy and audit row
 *   profiles.external_open_id  → external identity. For Supabase this is `auth.users.id`
 *                                (the JWT `sub`), exactly as it was the Manus openId before
 *   profiles.tenant_id         → resolved/created through the existing identity-db helpers
 *   profiles.role              → untouched; RBAC keeps resolving permissions from it
 *
 * Because the external identifier keeps living in the same column, `requireProjectAccess`,
 * `getUserPermissions` and every tenant-scoped query keep working with zero changes.
 *
 * Provisioning is idempotent: unknown `sub` → profile created inside the default tenant;
 * known `sub` → metadata + lastSignedIn refreshed.
 */

import { ForbiddenError } from "@shared/_core/errors";
import type { Request } from "express";
import type { Profile } from "../../../drizzle/schema";
import {
  getProfileByExternalOpenId,
  upsertProfileFromOAuth,
} from "../../identity-db";
import {
  extractBearerToken,
  verifySupabaseAccessToken,
  type SupabaseIdentity,
} from "./supabase-jwt";

/** Login method persisted for Supabase-issued identities. */
export const SUPABASE_LOGIN_METHOD_PREFIX = "supabase";

/**
 * Derive the `login_method` value stored on the profile.
 * `supabase:email`, `supabase:google`, ... so the origin of an account stays auditable.
 */
export function supabaseLoginMethod(identity: SupabaseIdentity): string {
  const provider = (identity.provider ?? "").trim().toLowerCase();
  return provider
    ? `${SUPABASE_LOGIN_METHOD_PREFIX}:${provider}`
    : SUPABASE_LOGIN_METHOD_PREFIX;
}

/**
 * Fallback display name when Supabase user_metadata carries none.
 * Uses the local part of the email so the UI never shows an empty operator name.
 */
export function deriveDisplayName(identity: SupabaseIdentity): string | null {
  if (identity.fullName) return identity.fullName;
  if (!identity.email) return null;
  const localPart = identity.email.split("@")[0] ?? "";
  return localPart.length > 0 ? localPart : null;
}

/**
 * Resolve (and provision on first sign-in) the Structr profile for a Supabase identity.
 *
 * Order:
 *   1. lookup by profiles.external_open_id === identity.sub
 *   2. not found → provision inside the default tenant (idempotent upsert)
 *   3. found     → refresh metadata / lastSignedIn
 *   4. reject deactivated profiles
 */
export async function resolveProfileForSupabaseIdentity(
  identity: SupabaseIdentity,
): Promise<Profile> {
  if (!identity.sub) {
    throw ForbiddenError("Supabase identity carries no subject");
  }

  const existing = await getProfileByExternalOpenId(identity.sub);

  if (existing && existing.isActive === false) {
    throw ForbiddenError("User account is disabled");
  }

  // Idempotent sync: creates on first sign-in, refreshes metadata afterwards.
  // profiles.role and profiles.tenant_id are never downgraded by this call.
  const profile = await upsertProfileFromOAuth({
    externalOpenId: identity.sub,
    fullName: deriveDisplayName(identity),
    email: identity.email,
    loginMethod: supabaseLoginMethod(identity),
  });

  const resolved = profile ?? existing;

  if (!resolved) {
    // Database unavailable: fail closed rather than granting an unmapped session.
    throw ForbiddenError("Profile store unavailable");
  }

  if (resolved.isActive === false) {
    throw ForbiddenError("User account is disabled");
  }

  return resolved;
}

/**
 * Authenticate an Express request using the Supabase provider.
 *
 * Contract:
 *   - the browser sends `Authorization: Bearer <supabase access_token>`
 *   - the token is verified against the project JWKS (or JWT secret)
 *   - the verified `sub` is mapped to a Structr profile
 *
 * Throws ForbiddenError when the header is missing or the token is invalid, matching
 * the legacy provider's behaviour so `createContext` stays provider-agnostic.
 */
export async function authenticateSupabaseRequest(
  req: Request,
): Promise<Profile> {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    throw ForbiddenError("Missing Supabase bearer token");
  }

  const identity = await verifySupabaseAccessToken(token);

  if (!identity) {
    throw ForbiddenError("Invalid Supabase access token");
  }

  return resolveProfileForSupabaseIdentity(identity);
}
