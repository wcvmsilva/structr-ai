export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * SUPABASE AUTH V1 — client-side provider switch.
 *
 * Mirrors the server's AUTH_PROVIDER contract. The SPA reads VITE_AUTH_PROVIDER
 * (default "supabase") so the login affordance matches whatever the backend is
 * validating. Rollback: set both AUTH_PROVIDER=legacy and VITE_AUTH_PROVIDER=legacy.
 */
export type AuthProviderName = "supabase" | "legacy";

export const AUTH_PROVIDER: AuthProviderName =
  (import.meta.env.VITE_AUTH_PROVIDER ?? "").trim().toLowerCase() === "legacy"
    ? "legacy"
    : "supabase";

export const IS_SUPABASE_AUTH = AUTH_PROVIDER === "supabase";
export const IS_LEGACY_AUTH = AUTH_PROVIDER === "legacy";

/** Route that hosts the email/password sign-in form. */
export const SUPABASE_LOGIN_PATH = "/login";

// DEV-only flag to disable OAuth redirects and allow full local access.
// Only applies to the legacy provider: the Supabase flow is exercised in dev too.
const DEV_DISABLE_OAUTH = import.meta.env.DEV && IS_LEGACY_AUTH;

/**
 * Where an unauthenticated visitor should be sent.
 *   supabase → the in-app /login form
 *   legacy   → the Manus OAuth portal (unchanged Phase 1 behaviour)
 */
export const getLoginUrl = () => {
  if (IS_SUPABASE_AUTH) {
    return SUPABASE_LOGIN_PATH;
  }

  // In dev mode, return a no-op hash to prevent redirects
  if (DEV_DISABLE_OAUTH) {
    return "#";
  }

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
