/**
 * structr.ai — Browser Supabase client (Supabase Auth V1)
 *
 * Single Supabase instance for the SPA. Created lazily so a legacy-provider build
 * (AUTH_PROVIDER=legacy) that ships without Supabase env vars never crashes at import
 * time — `getSupabaseClient()` simply returns null and the legacy flow takes over.
 *
 * Session handling is delegated to supabase-js:
 *   - persistSession    → the session (access + refresh token) is stored in localStorage
 *   - autoRefreshToken  → the access token is rotated in the background before it expires
 *   - detectSessionInUrl→ handles magic-link / recovery redirects landing on /login
 *
 * The access token is read synchronously from the in-memory session by
 * `client/src/lib/auth-token.ts`, which is what attaches the Authorization header to
 * every tRPC request.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Storage key used by supabase-js. Exposed so logout can hard-clear it. */
export const SUPABASE_STORAGE_KEY = "structr-supabase-auth";

export const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL ?? ""
).trim().replace(/\/+$/, "");

export const SUPABASE_PUBLISHABLE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""
).trim();

/** True when the build carries a complete Supabase configuration. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;
}

let client: SupabaseClient | null = null;

/**
 * Return the shared Supabase client, or null when the app is not configured for
 * Supabase auth (legacy provider builds).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  if (!isSupabaseConfigured()) {
    console.warn(
      "[SupabaseAuth] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set. " +
        "Supabase auth is disabled in this build.",
    );
    return null;
  }

  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: SUPABASE_STORAGE_KEY,
      flowType: "pkce",
    },
  });

  return client;
}

/**
 * Same as `getSupabaseClient()` but throws instead of returning null.
 * Use inside the Supabase login flow, where a missing client is a hard error.
 */
export function requireSupabaseClient(): SupabaseClient {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return supabase;
}
