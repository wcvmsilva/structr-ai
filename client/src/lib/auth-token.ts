/** One browser-session store shared by the transport and every auth hook.
 * Identity generations isolate UI work; they are never an authorization source. */
import type { Session } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { z } from "zod";
import { IS_SUPABASE_AUTH } from "@/const";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  SUPABASE_STORAGE_KEY,
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from "./supabase";
import {
  createPasswordRecoveryController,
  type PasswordRecoveryController,
  type PasswordRecoverySnapshot,
  type PasswordRecoveryResult,
} from "./password-recovery";
import { createPasswordChanger } from "./password-change";

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
// The SDK saves callback credentials before emitting PASSWORD_RECOVERY. Block
// hydration at module initialization; the URL itself never authorizes recovery.
const recoveryCallback =
  IS_SUPABASE_AUTH &&
  typeof window !== "undefined" &&
  window.location?.pathname?.toLowerCase().replace(/\/$/, "") ===
    "/reset-password";
let locallySignedOut = hasLogoutIntent() || recoveryCallback;
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
type RefreshResult = { ok: true } | { ok: false; message: string };
let forcedRefresh: {
  subject: string;
  generation: number;
  action: number;
  promise: Promise<RefreshResult>;
} | null = null;
const listeners = new Set<() => void>();
const identityListeners = new Set<() => void>();
const tokenRefreshListeners = new Set<() => void>();
const recoveryListeners = new Set<() => void>();
let providerSubject: string | null = null;
let recovery: PasswordRecoveryController | null = null;
let passwordChanger: ReturnType<typeof createPasswordChanger> | null = null;
const inactiveRecovery: PasswordRecoverySnapshot = Object.freeze({
  active: false,
  status: "inactive",
  message: null,
});
const recoveryUnavailable: PasswordRecoveryResult = {
  ok: false,
  message: "Password recovery is unavailable. Try again later.",
};
const passwordMethods = z.array(z.object({ method: z.string().min(1) }));
function hasCurrentPasswordSession(token: string): boolean {
  // Refusal guard only: Auth verifies the bearer signature and current password.
  // The provider exempts any session carrying OTP/magic-link/recovery AMR.
  try {
    const methods = passwordMethods.safeParse(decodeJwt(token).amr);
    return (
      methods.success &&
      methods.data.some(({ method }) => method === "password") &&
      !methods.data.some(({ method }) =>
        ["otp", "magiclink", "recovery"].includes(method)
      )
    );
  } catch {
    return false;
  }
}

/** Bind the write to the operator that submitted it, without mutating SDK storage. */
export async function changeCurrentPassword(
  currentPassword: string,
  newPassword: string,
  confirmation: string
) {
  passwordChanger ??= createPasswordChanger({
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    getContext: () => {
      const session = snapshot.session;
      if (
        !IS_SUPABASE_AUTH ||
        locallySignedOut ||
        hasLogoutIntent() ||
        recovery?.getSnapshot().active ||
        !usableSession(session) ||
        !hasCurrentPasswordSession(session.access_token)
      )
        return null;
      return {
        userId: session.user.id,
        token: session.access_token,
        expiresAt: session.expires_at! * 1000,
        generation: snapshot.generation,
        action: authAction,
      };
    },
  });
  return passwordChanger.change(currentPassword, newPassword, confirmation);
}

function ensureRecovery() {
  if (recovery || !IS_SUPABASE_AUTH) return recovery;
  const client = getSupabaseClient();
  if (!client || typeof client.auth.resetPasswordForEmail !== "function")
    return null;
  recovery = createPasswordRecoveryController({
    auth: client.auth,
    origin: typeof window === "undefined" ? "" : window.location.origin,
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    getIdentity: () => ({
      userId: providerSubject,
      generation: snapshot.generation,
    }),
  });
  recovery.subscribe(() => {
    for (const listener of recoveryListeners) listener();
  });
  return recovery;
}
export const getPasswordRecoverySnapshot = () =>
  recovery?.getSnapshot() ?? inactiveRecovery;
export function subscribePasswordRecovery(listener: () => void) {
  recoveryListeners.add(listener);
  void initSupabaseAuthBridge();
  return () => {
    recoveryListeners.delete(listener);
  };
}
export async function requestPasswordRecovery(email: string) {
  await initSupabaseAuthBridge();
  return ensureRecovery()?.requestLink(email) ?? recoveryUnavailable;
}
export async function requestOwnPasswordRecovery(): Promise<PasswordRecoveryResult> {
  const original = snapshot;
  const action = authAction;
  if (
    locallySignedOut ||
    hasLogoutIntent() ||
    !original.session?.user.email_confirmed_at ||
    !original.session.user.email
  )
    return {
      ok: false,
      message: "Sign in with a confirmed account to change your password.",
    };
  const isCurrent = () =>
    !locallySignedOut &&
    !hasLogoutIntent() &&
    authAction === action &&
    snapshot.generation === original.generation &&
    snapshot.session?.user.id === original.session?.user.id;
  await initSupabaseAuthBridge();
  if (!isCurrent())
    return { ok: false, message: "Session changed. Please sign in again." };
  const result = await (ensureRecovery()?.requestLink(
    original.session.user.email
  ) ?? recoveryUnavailable);
  if (
    authAction !== action ||
    snapshot.generation !== original.generation ||
    snapshot.session?.user.id !== original.session.user.id
  )
    return { ok: false, message: "Session changed. Please sign in again." };
  return result;
}
export async function submitRecoveredPassword(
  password: string,
  confirmation: string
) {
  return (
    ensureRecovery()?.submitPassword(password, confirmation) ??
    recoveryUnavailable
  );
}
export async function exitPasswordRecovery(): Promise<void> {
  // A provider signOut rereads global SDK storage asynchronously and could
  // revoke a different account established in another tab. Discard only this
  // local recovery; the durable logout marker requires an explicit new login.
  clearAccessToken();
}

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

/** Same-operator token renewal only; it does not authorize a cached profile. */
export function subscribeAuthTokenRefresh(listener: () => void): () => void {
  tokenRefreshListeners.add(listener);
  return () => {
    tokenRefreshListeners.delete(listener);
  };
}

function usableSession(session: Session | null): session is Session {
  return Boolean(
    session?.user.id &&
      session.access_token &&
      Number.isFinite(session.expires_at) &&
      session.expires_at! * 1000 > Date.now()
  );
}

function publish(
  session: Session | null,
  error: string | null = null,
  newBoundary = false
) {
  const changed =
    newBoundary ||
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
  if (changed) passwordChanger?.cancel();
  if (changed) for (const listener of identityListeners) listener();
  for (const listener of listeners) listener();
}

/** Clear immediately, even when provider logout is slow or fails. */
export function clearAccessToken(newBoundary = false): void {
  if (!IS_SUPABASE_AUTH) return;
  providerSubject = null;
  recovery?.cancel();
  passwordChanger?.cancel();
  try {
    globalThis.localStorage?.setItem(LOGOUT_INTENT_KEY, "1");
  } catch {
    /* unavailable storage */
  }
  locallySignedOut = true;
  authAction += 1;
  revision += 1;
  publish(null, null, newBoundary);
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
    if (recoveryCallback) clearAccessToken();
    const supabase = getSupabaseClient();
    if (!supabase) {
      publish(null);
      return () => {};
    }
    // Subscribe before hydration; a late persisted read cannot undo a newer event.
    const readRevision = revision;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      revision += 1;
      if (event === "PASSWORD_RECOVERY") {
        // A second recovery credential must discard fields and handlers from
        // the first even though neither credential is a business session.
        clearAccessToken(true);
        providerSubject = session?.user.id ?? null;
        ensureRecovery()?.handleAuthEvent(event, session);
        return;
      }
      if (hasLogoutIntent() && !locallySignedOut) {
        clearAccessToken();
        return;
      }
      // Negative provider signals must still clear an already-open tab. Only
      // positive hydration/refresh is suppressed by a persisted logout intent.
      // A forced refresh started for A cannot restore A after logout or a switch
      // to B, even if its provider callback arrives before its promise settles.
      if (
        event === "TOKEN_REFRESHED" &&
        session &&
        forcedRefresh?.subject === session.user.id &&
        (forcedRefresh.generation !== snapshot.generation ||
          forcedRefresh.action !== authAction)
      )
        return;
      const sameSubject = snapshot.session?.user.id === session?.user.id;
      providerSubject = session?.user.id ?? null;
      recovery?.handleAuthEvent(event, session);
      if (!session || (!locallySignedOut && !hasLogoutIntent())) {
        publish(session);
        // Explicit retries perform their own awaited profile read after renewal.
        if (
          event === "TOKEN_REFRESHED" &&
          sameSubject &&
          usableSession(session) &&
          !forcedRefresh
        )
          for (const listener of tokenRefreshListeners) listener();
      }
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
        if (recoveryCallback && error && revision === readRevision)
          ensureRecovery()?.reportLinkError();
        if (revision !== readRevision || locallySignedOut || hasLogoutIntent())
          return;
        providerSubject = error ? null : (data.session?.user.id ?? null);
        publish(
          error ? null : data.session,
          error ? describeAuthError(error.message) : null
        );
      })
      .catch((error: unknown) => {
        if (recoveryCallback && revision === readRevision)
          ensureRecovery()?.reportLinkError();
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

/** Explicit recovery must rotate even a locally unexpired bearer that the server
 * refused. Share one provider attempt and never carry it across an identity change. */
export function refreshSupabaseSession(): Promise<RefreshResult> {
  const changed: RefreshResult = {
    ok: false,
    message: "Session changed. Please sign in again.",
  };
  if (
    !IS_SUPABASE_AUTH ||
    locallySignedOut ||
    hasLogoutIntent() ||
    !snapshot.session
  )
    return Promise.resolve(changed);
  if (forcedRefresh) return forcedRefresh.promise;
  const expected = {
    subject: snapshot.session.user.id,
    generation: snapshot.generation,
    action: authAction,
  };
  const isCurrent = () =>
    !locallySignedOut &&
    !hasLogoutIntent() &&
    snapshot.generation === expected.generation &&
    snapshot.session?.user.id === expected.subject &&
    authAction === expected.action;
  const failure =
    "Cannot refresh your session. Check your connection and try again, or sign out and sign in again.";
  // Defer the provider call until the shared attempt and its callback guard exist.
  const promise = Promise.resolve().then(async (): Promise<RefreshResult> => {
    await initSupabaseAuthBridge();
    if (!isCurrent()) return changed;
    try {
      const supabase = getSupabaseClient();
      const result = await supabase?.auth.refreshSession();
      if (!isCurrent()) return changed;
      if (
        !result ||
        result.error ||
        !usableSession(result.data.session) ||
        result.data.session.user.id !== expected.subject
      ) {
        publish(snapshot.session, failure);
        return { ok: false, message: failure };
      }
      revision += 1;
      publish(result.data.session);
      return { ok: true };
    } catch {
      if (!isCurrent()) return changed;
      publish(snapshot.session, failure);
      return { ok: false, message: failure };
    }
  });
  forcedRefresh = { ...expected, promise };
  void promise.finally(() => {
    if (forcedRefresh?.promise === promise) forcedRefresh = null;
  });
  return promise;
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
  recovery?.cancel();
  passwordChanger?.cancel();
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
    providerSubject = data.session?.user.id ?? null;
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
