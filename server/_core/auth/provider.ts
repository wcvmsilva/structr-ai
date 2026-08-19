/**
 * structr.ai — Auth Provider Selector (Supabase Auth V1)
 *
 * The platform supports two authentication providers side by side:
 *
 *   supabase → Supabase GoTrue email/password. The browser holds the session and
 *              sends `Authorization: Bearer <access_token>` on every tRPC call.
 *              The server verifies the JWT and maps `sub` → profiles.external_open_id.
 *
 *   legacy   → the original Manus OAuth flow with an HttpOnly session cookie signed
 *              by JWT_SECRET. Kept intact for rollback; NOT deleted.
 *
 * Selection is driven by the AUTH_PROVIDER environment variable and defaults to
 * "supabase". Any unrecognised value falls back to the default with a warning, so a
 * typo can never silently disable authentication.
 *
 * Rollback contract: set AUTH_PROVIDER=legacy and restart. No code change required.
 */

export type AuthProviderName = "supabase" | "legacy";

/** Default provider when AUTH_PROVIDER is unset. */
export const DEFAULT_AUTH_PROVIDER: AuthProviderName = "supabase";

/**
 * Resolve the configured auth provider from an environment bag.
 * Pure function so it can be unit-tested without touching process.env.
 */
export function resolveAuthProvider(
  env: { AUTH_PROVIDER?: string | undefined } = process.env as {
    AUTH_PROVIDER?: string;
  },
): AuthProviderName {
  const raw = (env.AUTH_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "") return DEFAULT_AUTH_PROVIDER;
  if (raw === "supabase" || raw === "legacy") return raw;

  console.warn(
    `[Auth] Unknown AUTH_PROVIDER="${env.AUTH_PROVIDER}". ` +
      `Falling back to "${DEFAULT_AUTH_PROVIDER}". Valid values: supabase | legacy.`,
  );
  return DEFAULT_AUTH_PROVIDER;
}

/** True when the Supabase provider is active. */
export function isSupabaseAuthEnabled(
  env: { AUTH_PROVIDER?: string | undefined } = process.env as {
    AUTH_PROVIDER?: string;
  },
): boolean {
  return resolveAuthProvider(env) === "supabase";
}

/** True when the legacy Manus OAuth provider is active. */
export function isLegacyAuthEnabled(
  env: { AUTH_PROVIDER?: string | undefined } = process.env as {
    AUTH_PROVIDER?: string;
  },
): boolean {
  return resolveAuthProvider(env) === "legacy";
}
