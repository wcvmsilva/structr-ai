/**
 * structr.ai — Authentication dispatcher (Supabase Auth V1)
 *
 * Single entry point used by the tRPC context. Routes the request to the provider
 * selected by AUTH_PROVIDER (default: "supabase") and keeps the legacy Manus OAuth
 * path fully intact for rollback.
 *
 *   AUTH_PROVIDER=supabase → Authorization: Bearer <supabase access_token>
 *   AUTH_PROVIDER=legacy   → HttpOnly `app_session_id` cookie (unchanged Phase 1 flow)
 *
 * Dual-read safety net (SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK=true):
 *   while the Supabase provider is active, a request that carries no bearer token may
 *   still be authenticated by a valid legacy cookie. This exists purely to keep
 *   already-signed-in operators working during the cutover window and is OFF by default.
 */

import type { Request } from "express";
import type { Profile } from "../../../drizzle/schema";
import { sdk } from "../sdk";
import {
  resolveAuthProvider,
  type AuthProviderName,
} from "./provider";
import { authenticateSupabaseRequest } from "./supabase-auth";
import { extractBearerToken } from "./supabase-jwt";

export {
  DEFAULT_AUTH_PROVIDER,
  isLegacyAuthEnabled,
  isSupabaseAuthEnabled,
  resolveAuthProvider,
  type AuthProviderName,
} from "./provider";
export {
  authenticateSupabaseRequest,
  resolveProfileForSupabaseIdentity,
  supabaseLoginMethod,
} from "./supabase-auth";
export {
  extractBearerToken,
  verifySupabaseAccessToken,
  type SupabaseIdentity,
} from "./supabase-jwt";

/** Parse the legacy-fallback switch. Defaults to false (bearer-only). */
export function isLegacyFallbackEnabled(
  env: {
    SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK?: string | undefined;
  } = process.env as { SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK?: string },
): boolean {
  const raw = (env.SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK ?? "").trim();
  return /^(1|true|yes|on)$/i.test(raw);
}

/**
 * Authenticate a request with the active provider.
 * Throws (HttpError 403) when the caller cannot be authenticated — identical
 * contract to the Phase 1 `sdk.authenticateRequest`.
 */
export async function authenticateRequest(
  req: Request,
  provider: AuthProviderName = resolveAuthProvider(),
): Promise<Profile> {
  if (provider === "legacy") {
    return sdk.authenticateRequest(req);
  }

  const hasBearer = extractBearerToken(req.headers.authorization) !== null;

  if (!hasBearer && isLegacyFallbackEnabled()) {
    // Cutover window: honour an existing legacy cookie session.
    return sdk.authenticateRequest(req);
  }

  return authenticateSupabaseRequest(req);
}

/** Resolve the tenant for an authenticated profile. Shared by both providers. */
export async function resolveTenantId(
  profile: Profile | null,
): Promise<string | null> {
  return sdk.resolveTenantId(profile);
}
