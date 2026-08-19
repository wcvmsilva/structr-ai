/**
 * structr.ai — Supabase → Structr identity mapping (Supabase Auth V1)
 *
 * Bridges a verified Supabase identity onto the existing Structr identity model.
 * Nothing about the model changes:
 *
 *   profiles.id                → internal UUID, used by every FK, RLS policy and audit row
 *   profiles.external_open_id  → external identity. For Supabase this is `auth.users.id`
 *                                (the JWT `sub`), exactly as it was the Manus openId before
 *   profiles.tenant_id         → assigned by Structr provisioning / administration
 *   profiles.role              → untouched; RBAC keeps resolving permissions from it
 *
 * Because the external identifier keeps living in the same column, `requireProjectAccess`,
 * `getUserPermissions` and every tenant-scoped query keep working with zero changes.
 *
 * SECURITY CONTRACT — FAIL CLOSED:
 *   A valid Supabase JWT proves who the caller is; it does not grant Structr access.
 *   The caller must already be mapped by an administrator through
 *   `profiles.external_open_id === auth.users.id` and have an active profile.
 *   This module never provisions profiles, default tenants or tenant memberships.
 */

import { ForbiddenError } from "@shared/_core/errors";
import type { Request } from "express";
import type { Profile } from "../../../drizzle/schema";
import { getProfileByExternalOpenId } from "../../identity-db";
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
 * Resolve the pre-provisioned Structr profile for a verified Supabase identity.
 *
 * A Supabase JWT establishes authentication only. Structr authorization starts only
 * after an administrator has explicitly mapped `auth.users.id` to
 * `profiles.external_open_id`. No default tenant lookup, membership creation or
 * provisioning-helper call is permitted on this path.
 */
export async function resolveProfileForSupabaseIdentity(
  identity: SupabaseIdentity,
): Promise<Profile> {
  if (!identity.sub) {
    throw ForbiddenError("Supabase identity carries no subject");
  }

  const profile = await getProfileByExternalOpenId(identity.sub);

  if (!profile) {
    // Fail closed: a valid Supabase identity without an explicit Structr profile
    // mapping has no tenant, no RBAC role and therefore no application access.
    throw ForbiddenError("Supabase user is not provisioned for Structr access");
  }

  if (profile.isActive === false) {
    throw ForbiddenError("User account is disabled");
  }

  // Do not mutate profile metadata here. The legacy provisioning helper has
  // first-sign-in behavior that assigns the default GCHI tenant. Tenant and RBAC
  // values therefore remain exactly as configured on the mapped profile.
  return profile;
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
