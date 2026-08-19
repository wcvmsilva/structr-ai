/**
 * structr.ai — Supabase JWT verification (Supabase Auth V1)
 *
 * Verifies the access token issued by Supabase GoTrue and returns a normalized
 * identity. Two verification modes are supported, chosen automatically:
 *
 *   1. Asymmetric (preferred, default)
 *      Supabase projects using ES256/RS256 signing keys expose a JWKS document at
 *      `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. The key set is fetched and
 *      cached by `jose` (remote JWKS with automatic rotation handling).
 *
 *   2. Symmetric (legacy Supabase projects)
 *      Older projects sign with HS256 using the project's JWT secret. Set
 *      SUPABASE_JWT_SECRET to enable this path.
 *
 * Both paths enforce:
 *   - signature validity
 *   - `exp` / `nbf` (handled by jose)
 *   - issuer === `${SUPABASE_URL}/auth/v1`
 *   - audience === "authenticated" (Supabase default for signed-in users)
 *   - a non-empty `sub` claim
 *
 * Nothing here touches the database. Mapping the verified identity onto the Structr
 * profile/tenant/RBAC model happens in `server/_core/auth/supabase-auth.ts`.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ENV } from "../env";

/** Audience Supabase stamps on tokens for signed-in (non-anon) users. */
export const SUPABASE_AUDIENCE = "authenticated";

/** Identity extracted from a verified Supabase access token. */
export type SupabaseIdentity = {
  /** Supabase `auth.users.id` (UUID). Stored in profiles.external_open_id. */
  sub: string;
  email: string | null;
  /** Best-effort display name from user_metadata. */
  fullName: string | null;
  /** Sign-in provider reported by GoTrue (email, google, ...). */
  provider: string | null;
  /** Supabase role claim, normally "authenticated". */
  role: string | null;
  /** `exp` claim in milliseconds since epoch, when present. */
  expiresAtMs: number | null;
  /** Raw claims, for callers that need provider-specific metadata. */
  claims: JWTPayload;
};

export class SupabaseAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseAuthConfigError";
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Normalize the Supabase project URL (no trailing slash). */
export function normalizeSupabaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Expected `iss` claim for a Supabase project. */
export function supabaseIssuer(url: string): string {
  return `${normalizeSupabaseUrl(url)}/auth/v1`;
}

/** JWKS endpoint for a Supabase project. */
export function supabaseJwksUrl(url: string): string {
  return `${normalizeSupabaseUrl(url)}/auth/v1/.well-known/jwks.json`;
}

// ── Remote JWKS cache ──────────────────────────────────────────────────
// `createRemoteJWKSet` already caches keys and handles rotation; we memoize the
// set per project URL so we do not create a new fetcher on every request.
let cachedJwks: {
  url: string;
  keySet: ReturnType<typeof createRemoteJWKSet>;
} | null = null;

function getJwks(projectUrl: string) {
  const jwksUrl = supabaseJwksUrl(projectUrl);
  if (cachedJwks && cachedJwks.url === jwksUrl) return cachedJwks.keySet;
  const keySet = createRemoteJWKSet(new URL(jwksUrl), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  cachedJwks = { url: jwksUrl, keySet };
  return keySet;
}

/** Test/maintenance helper: forget the memoized JWKS fetcher. */
export function clearSupabaseJwksCache(): void {
  cachedJwks = null;
}

/**
 * Extract the bearer token from an Authorization header value.
 * Returns null when the header is absent or not a Bearer scheme.
 */
export function extractBearerToken(
  headerValue: string | string[] | undefined | null,
): string | null {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!isNonEmptyString(raw)) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match) return null;
  const token = match[1]?.trim();
  return isNonEmptyString(token) ? token : null;
}

/**
 * Map verified JWT claims onto the normalized identity shape.
 * Exported for unit tests: claim shaping is where provider drift usually bites.
 */
export function identityFromClaims(payload: JWTPayload): SupabaseIdentity {
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const appMeta = (payload.app_metadata ?? {}) as Record<string, unknown>;

  const email = isNonEmptyString(payload.email)
    ? payload.email
    : isNonEmptyString(meta.email)
      ? (meta.email as string)
      : null;

  const fullName = isNonEmptyString(meta.full_name)
    ? (meta.full_name as string)
    : isNonEmptyString(meta.name)
      ? (meta.name as string)
      : null;

  const provider = isNonEmptyString(appMeta.provider)
    ? (appMeta.provider as string)
    : null;

  return {
    sub: String(payload.sub ?? ""),
    email,
    fullName,
    provider,
    role: isNonEmptyString(payload.role) ? payload.role : null,
    expiresAtMs: typeof payload.exp === "number" ? payload.exp * 1000 : null,
    claims: payload,
  };
}

/**
 * Verify a Supabase access token and return the normalized identity.
 * Returns null for any invalid/expired/foreign token — never throws on a bad token.
 * Throws SupabaseAuthConfigError only when the server itself is misconfigured.
 */
export async function verifySupabaseAccessToken(
  token: string | null | undefined,
  options: {
    supabaseUrl?: string;
    jwtSecret?: string;
    /** Override the audience check. Defaults to "authenticated". */
    audience?: string;
  } = {},
): Promise<SupabaseIdentity | null> {
  if (!isNonEmptyString(token)) return null;

  const supabaseUrl = normalizeSupabaseUrl(
    options.supabaseUrl ?? ENV.supabaseUrl,
  );
  if (!supabaseUrl) {
    throw new SupabaseAuthConfigError(
      "[FATAL] AUTH_PROVIDER=supabase requires SUPABASE_URL (or VITE_SUPABASE_URL) to be set.",
    );
  }

  const issuer = supabaseIssuer(supabaseUrl);
  const audience = options.audience ?? SUPABASE_AUDIENCE;
  const jwtSecret = options.jwtSecret ?? ENV.supabaseJwtSecret;

  try {
    const { payload } = jwtSecret
      ? await jwtVerify(token, new TextEncoder().encode(jwtSecret), {
          issuer,
          audience,
          algorithms: ["HS256"],
        })
      : await jwtVerify(token, getJwks(supabaseUrl), {
          issuer,
          audience,
        });

    if (!isNonEmptyString(payload.sub)) {
      console.warn("[SupabaseAuth] Token verified but carries no `sub` claim");
      return null;
    }

    return identityFromClaims(payload);
  } catch (error) {
    console.warn("[SupabaseAuth] Token verification failed:", String(error));
    return null;
  }
}
