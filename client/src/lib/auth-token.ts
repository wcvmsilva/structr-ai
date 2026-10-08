/** One browser-session store shared by the transport and every auth hook.
 * Identity generations isolate UI work; they are never an authorization source. */
import type { Session } from "@supabase/supabase-js";
import { IS_SUPABASE_AUTH } from "@/const";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  SUPABASE_STORAGE_KEY,
} from "./supabase";

const EXPIRY_SKEW_MS = 60_000;
// Contains only local logout intent, never a token, subject or account identifier.
const LOGOUT_INTENT_KEY = "structr-supabase-logout-intent";
function hasLogoutIntent(): boolean {
  if (!IS_SUPABASE_AUTH) return false;
  try {
    return globalThis.localStorage?.getItem(LOGOUT_INTENT_KEY) === "1";
  } catch {
    return false;
  }
}
let locallySignedOut = hasLogoutIntent();
export type AuthSessionSnapshot = {
  session: Session | null;
  loading: boolean;
  error: string | null;
  generation: number;
};
let snapshot: AuthSessionSnapshot = {
  session: null,
  loading: IS_SUPABASE_AUTH && isSupabaseConfigured() && !locallySignedOut,
  error: null,
  generation: 0,
};
let accessToken: string | null = null;
let expiresAtMs: number | null = null;
let revision = 0;
let bridge: Promise<void> | null = null;
let unsubscribeProvider: (() => void) | null = null;
let authAction = 0;
let logoutPending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const identityListeners = new Set<() => void>();

export function describeAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials"))
    return "Invalid email or password.";
  if (normalized.includes("email not confirmed"))
    return "Email not confirmed. Check your inbox for the confirmation link.";
  if (
    normalized.includes("too many requests") ||
    normalized.includes("rate limit")
  )
    return "Too many attempts. Wait a moment and try again.";
  if (normalized.includes("failed to fetch") || normalized.includes("network"))
    return "Cannot reach the authentication service. Check your connection.";
  return message;
}

export function getAuthSessionSnapshot(): AuthSessionSnapshot {
  return snapshot;
}
export function subscribeAuthSession(listener: () => void): () => void {
  listeners.add(listener);
  void initSupabaseAuthBridge();
  return () => {
    listeners.delete(listener);
  };
}
export function subscribeAuthIdentityChange(listener: () => void): () => void {
  identityListeners.add(listener);
  return () => {
    identityListeners.delete(listener);
  };
}

function publish(session: Session | null, error: string | null = null) {
  const changed =
    (snapshot.session?.user.id ?? null) !== (session?.user.id ?? null);
  accessToken = session?.access_token ?? null;
  expiresAtMs = session?.expires_at == null ? null : session.expires_at * 1000;
  snapshot = {
    session,
    error,
    loading: false,
    generation: snapshot.generation + Number(changed),
  };
  // Cancel/remove old work before React observes the new identity.
  if (changed) for (const listener of identityListeners) listener();
  for (const listener of listeners) listener();
}

/** Clear immediately, even when provider logout is slow or fails. */
export function clearAccessToken(): void {
  if (!IS_SUPABASE_AUTH) return;
  try {
    globalThis.localStorage?.setItem(LOGOUT_INTENT_KEY, "1");
  } catch {
    /* unavailable storage */
  }
  locallySignedOut = true;
  authAction += 1;
  revision += 1;
  publish(null);
}
export function getAccessToken(): string | null {
  return locallySignedOut || hasLogoutIntent() ? null : accessToken;
}
export function isAccessTokenStale(now = Date.now()): boolean {
  return (
    !accessToken ||
    (expiresAtMs !== null && expiresAtMs - now <= EXPIRY_SKEW_MS)
  );
}

/** Idempotent across the application bridge, hooks and StrictMode mounts.
 * The returned teardown belongs to the application/HMR lifecycle, not a hook. */
export async function initSupabaseAuthBridge(): Promise<() => void> {
  if (!IS_SUPABASE_AUTH) return () => {};
  if (!bridge) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      publish(null);
      return () => {};
    }
    // Subscribe before hydration; a late persisted read cannot undo a newer event.
    const readRevision = revision;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      revision += 1;
      if (hasLogoutIntent() && !locallySignedOut) {
        clearAccessToken();
        return;
      }
      // Negative provider signals must still clear an already-open tab. Only
      // positive hydration/refresh is suppressed by a persisted logout intent.
      if (!session || (!locallySignedOut && !hasLogoutIntent()))
        publish(session);
    });
    const browserWindow = typeof window === "undefined" ? null : window;
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === LOGOUT_INTENT_KEY &&
        event.newValue === "1" &&
        !locallySignedOut
      )
        clearAccessToken();
    };
    browserWindow?.addEventListener("storage", onStorage);
    unsubscribeProvider = () => {
      subscription.unsubscribe();
      browserWindow?.removeEventListener("storage", onStorage);
    };
    bridge = supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (revision !== readRevision || locallySignedOut || hasLogoutIntent())
          return;
        publish(
          error ? null : data.session,
          error ? describeAuthError(error.message) : null
        );
      })
      .catch((error: unknown) => {
        if (
          revision === readRevision &&
          !locallySignedOut &&
          !hasLogoutIntent()
        )
          publish(null, describeAuthError(String(error)));
      });
  }
  await bridge;
  return () => {
    unsubscribeProvider?.();
    unsubscribeProvider = null;
    bridge = null;
    revision += 1;
  };
}

export async function getFreshAccessToken(): Promise<string | null> {
  if (!IS_SUPABASE_AUTH) return null;
  if (hasLogoutIntent() && !locallySignedOut) clearAccessToken();
  if (locallySignedOut) return null;
  await initSupabaseAuthBridge();
  if (locallySignedOut || hasLogoutIntent()) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  if (!isAccessTokenStale()) return accessToken;
  const readRevision = revision;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (revision === readRevision && !locallySignedOut && !hasLogoutIntent()) {
      publish(
        error ? null : data.session,
        error ? describeAuthError(error.message) : null
      );
    }
  } catch {
    if (revision === readRevision && !locallySignedOut && !hasLogoutIntent())
      publish(
        null,
        "Cannot reach the authentication service. Check your connection."
      );
  }
  return getAccessToken();
}

export async function buildAuthHeaders(): Promise<Record<string, string>> {
  const token = await getFreshAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function signInSupabaseSession(email: string, password: string) {
  if (!IS_SUPABASE_AUTH)
    return {
      ok: false as const,
      message: "Email/password sign-in requires Supabase.",
    };
  // Provider revocation and application-cookie cleanup can both remove session
  // storage at completion. Finish both before establishing another account.
  await logoutPending;
  const supabase = getSupabaseClient();
  if (!supabase)
    return { ok: false as const, message: "Supabase is not configured." };
  await initSupabaseAuthBridge();
  const action = ++authAction;
  const generation = snapshot.generation;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // The provider event normally publishes first. Never restore a response after logout.
    if (
      action !== authAction ||
      (snapshot.generation !== generation &&
        snapshot.session?.user.id !== data.user?.id)
    ) {
      return {
        ok: false as const,
        message: "Session changed. Please try again.",
      };
    }
    if (error) {
      const message = describeAuthError(error.message);
      publish(snapshot.session, message);
      return { ok: false as const, message };
    }
    // Persisted logout is lifted only by a successful, explicit sign-in. Provider
    // hydration/refresh events cannot resurrect the session during a slow logout.
    try {
      globalThis.localStorage?.removeItem(LOGOUT_INTENT_KEY);
    } catch {
      /* unavailable storage */
    }
    if (hasLogoutIntent())
      return {
        ok: false as const,
        message: "Unable to start a new session. Please try again.",
      };
    locallySignedOut = false;
    revision += 1;
    publish(data.session);
    return { ok: true as const };
  } catch (error) {
    const message = describeAuthError(
      error instanceof Error ? error.message : String(error)
    );
    if (!locallySignedOut) publish(snapshot.session, message);
    return { ok: false as const, message };
  }
}

export function signOutSupabaseSession(
  clearApplicationCookie?: () => Promise<unknown>
): Promise<void> {
  if (!IS_SUPABASE_AUTH) return Promise.resolve();
  if (logoutPending) return logoutPending;
  clearAccessToken();
  const revokeProvider = (async () => {
    try {
      await getSupabaseClient()?.auth.signOut();
    } catch {
      /* Local logout already completed; do not retain a bearer on network failure. */
    } finally {
      // Leave SDK storage intact until it has read the bearer for revocation.
      // Clear it even when revocation fails; local requests remain blocked.
      try {
        globalThis.localStorage?.removeItem(SUPABASE_STORAGE_KEY);
      } catch {
        /* unavailable storage */
      }
    }
  })();
  // Dispatch only after clearAccessToken published the signed-out generation;
  // otherwise authSessionLink would cancel the cookie request during logout.
  // The Data API boundary intentionally refuses this existing mutation. Network
  // failure or that refusal must not restore the locally removed identity.
  const clearCookie = Promise.resolve()
    .then(() => clearApplicationCookie?.())
    .catch(() => {});
  const pending = Promise.all([revokeProvider, clearCookie]).then(() => {});
  logoutPending = pending;
  void pending.finally(() => {
    if (logoutPending === pending) logoutPending = null;
  });
  return pending;
}
