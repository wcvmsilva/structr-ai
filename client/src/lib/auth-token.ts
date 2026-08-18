/**
 * structr.ai — Access token bridge (Supabase Auth V1)
 *
 * The tRPC `httpBatchLink` needs the current Supabase access token at request time.
 * Reading it through `supabase.auth.getSession()` inside `headers()` is async and
 * would add a promise hop to every batch, so instead the token is mirrored into a
 * module-level cache that is kept up to date by the `onAuthStateChange` subscription
 * installed in `initSupabaseAuthBridge()`.
 *
 * Contract:
 *   - `getAccessToken()` is synchronous and always returns the freshest known token
 *   - `getFreshAccessToken()` forces supabase-js to refresh when the cached token is
 *     within the expiry skew, so a long-idle tab never sends a dead credential
 *   - when Supabase is not configured (legacy provider) everything returns null and
 *     the tRPC client falls back to cookie credentials
 */

import { getSupabaseClient } from "./supabase";

/** Refresh the token when it expires within this window. */
const EXPIRY_SKEW_MS = 60_000;

type TokenState = {
  accessToken: string | null;
  expiresAtMs: number | null;
};

const state: TokenState = { accessToken: null, expiresAtMs: null };

/** Overwrite the cached token. Called by the auth-state subscription. */
export function setAccessToken(
  accessToken: string | null,
  expiresAtSeconds?: number | null,
): void {
  state.accessToken = accessToken;
  state.expiresAtMs =
    typeof expiresAtSeconds === "number" ? expiresAtSeconds * 1000 : null;
}

/** Drop the cached token (logout). */
export function clearAccessToken(): void {
  setAccessToken(null, null);
}

/** Synchronous read of the cached access token. */
export function getAccessToken(): string | null {
  return state.accessToken;
}

/** True when the cached token is missing or about to expire. */
export function isAccessTokenStale(now: number = Date.now()): boolean {
  if (!state.accessToken) return true;
  if (!state.expiresAtMs) return false;
  return state.expiresAtMs - now <= EXPIRY_SKEW_MS;
}

/**
 * Return a usable access token, asking supabase-js to refresh when the cached one is
 * stale. Safe to call on every request: supabase-js de-duplicates concurrent refreshes.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  if (!isAccessTokenStale()) return state.accessToken;

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("[SupabaseAuth] Failed to read session:", error.message);
    return state.accessToken;
  }

  const session = data.session;
  setAccessToken(session?.access_token ?? null, session?.expires_at ?? null);
  return state.accessToken;
}

/**
 * Build the Authorization header for an outgoing request.
 * Returns an empty object when there is no session, so the legacy cookie flow is
 * completely unaffected.
 */
export async function buildAuthHeaders(): Promise<Record<string, string>> {
  const token = await getFreshAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Hydrate the cache and keep it in sync with supabase-js.
 * Returns an unsubscribe function; call it from a hot-reload teardown if needed.
 */
export async function initSupabaseAuthBridge(): Promise<() => void> {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const { data } = await supabase.auth.getSession();
  setAccessToken(
    data.session?.access_token ?? null,
    data.session?.expires_at ?? null,
  );

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    setAccessToken(session?.access_token ?? null, session?.expires_at ?? null);
  });

  return () => subscription.unsubscribe();
}
