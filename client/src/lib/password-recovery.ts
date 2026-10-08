import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { z } from "zod";

export type PasswordRecoverySnapshot = Readonly<{
  active: boolean;
  status:
    | "inactive"
    | "ready"
    | "submitting"
    | "complete"
    | "expired"
    | "cancelled"
    | "error";
  message: string | null;
}>;
export type PasswordRecoveryResult = { ok: boolean; message: string };
export type PasswordRecoveryDependencies = {
  auth: {
    resetPasswordForEmail(
      email: string,
      options: { redirectTo: string }
    ): Promise<{ error: { code?: string; status?: number } | null }>;
  };
  origin: string;
  supabaseUrl: string;
  publishableKey: string;
  getIdentity(): { userId: string | null; generation: number };
  fetch?: typeof fetch;
  now?: () => number;
};

const emailSchema = z.string().trim().max(254).email();
const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine(value => value.trim().length > 0);
const userSchema = z.object({
  id: z.uuid(),
  aud: z.literal("authenticated"),
  created_at: z.iso.datetime({ offset: true }),
  app_metadata: z.record(z.string(), z.unknown()),
  user_metadata: z.record(z.string(), z.unknown()),
});
const messages = {
  link: "If this account can receive password reset emails, a link will arrive shortly.",
  request: "Unable to request a reset link. Try again shortly.",
  unavailable: "Password recovery is unavailable. Try again later.",
  expired: "This reset link is invalid or has expired. Request a new link.",
  cancelled: "Password recovery was cancelled. Request a new link to continue.",
  update: "Unable to update your password. Try again shortly.",
  complete: "Password updated. Sign in with your new password.",
} as const;

function validOrigin(value: string, allowLocal: boolean): string | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !(
        allowLocal &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** This state is credential recovery, never business authorization. The caller
 * supplies a private Auth-event identity/epoch, not the business profile or cache.
 * It must quarantine the callback route before initializing the SDK. Only the
 * SDK performs PKCE exchange; no URL parameter can create a recovery capture. */
export function createPasswordRecoveryController(
  deps: PasswordRecoveryDependencies
) {
  const origin = validOrigin(deps.origin, true),
    authOrigin = validOrigin(deps.supabaseUrl, false);
  const configured = Boolean(
    origin &&
      authOrigin &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(deps.publishableKey)
  );
  const now = deps.now ?? Date.now;
  const request =
    deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let snapshot: PasswordRecoverySnapshot = Object.freeze({
    active: false,
    status: "inactive",
    message: null,
  });
  let epoch = 0;
  type Capture = {
    userId: string;
    generation: number;
    epoch: number;
    token: string;
    expiresAt: number;
  };
  let capture: Capture | null = null;
  // The completed screen retains only identity, never the consumed credential.
  let completedIdentity: Pick<Capture, "userId" | "generation"> | null = null;
  let pending: AbortController | null = null;
  const listeners = new Set<() => void>();
  const result = (ok: boolean, message: string): PasswordRecoveryResult => ({
    ok,
    message,
  });
  function publish(
    status: PasswordRecoverySnapshot["status"],
    active: boolean,
    message: string | null
  ) {
    snapshot = Object.freeze({ status, active, message });
    for (const listener of listeners) listener();
  }
  function discard() {
    epoch += 1;
    capture = null;
    completedIdentity = null;
    pending?.abort();
    pending = null;
  }
  function cancel() {
    discard();
    publish("cancelled", false, messages.cancelled);
  }
  function identityMatches(
    value: Pick<Capture, "userId" | "generation">
  ): boolean {
    try {
      const identity = deps.getIdentity();
      return (
        identity.userId === value.userId &&
        identity.generation === value.generation
      );
    } catch {
      return false;
    }
  }
  function current(value: Capture): boolean {
    if (!capture || capture.epoch !== value.epoch || epoch !== value.epoch)
      return false;
    if (!identityMatches(value)) {
      cancel();
      return false;
    }
    return true;
  }
  function verifiedSession(session: Session | null): Capture | null {
    try {
      const identity = deps.getIdentity();
      if (
        !session ||
        !z.uuid().safeParse(session.user?.id).success ||
        identity.userId !== session.user.id ||
        !Number.isSafeInteger(identity.generation) ||
        identity.generation < 0 ||
        typeof session.access_token !== "string" ||
        !/^[A-Za-z0-9_.-]+$/.test(session.access_token) ||
        !Number.isFinite(session.expires_at) ||
        session.expires_at! * 1000 <= now()
      )
        return null;
      return {
        userId: session.user.id,
        generation: identity.generation,
        epoch,
        token: session.access_token,
        expiresAt: session.expires_at! * 1000,
      };
    } catch {
      return null;
    }
  }
  function handleAuthEvent(event: AuthChangeEvent, session: Session | null) {
    if (event === "PASSWORD_RECOVERY") {
      discard();
      capture = configured ? verifiedSession(session) : null;
      publish(
        capture ? "ready" : "expired",
        true,
        capture ? null : messages.expired
      );
      return;
    }
    if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
      // The SDK re-emits SIGNED_IN when a tab regains focus. Preserve only the
      // exact verified recovery credential and identity epoch. Explicit login
      // must cancel recovery before calling the SDK (the caller owns that step).
      if (
        event === "SIGNED_IN" &&
        capture &&
        session?.user.id === capture.userId &&
        session.access_token === capture.token &&
        current(capture)
      )
        return;
      if (
        event === "SIGNED_IN" &&
        snapshot.status === "complete" &&
        completedIdentity &&
        session?.user.id === completedIdentity.userId &&
        identityMatches(completedIdentity)
      )
        return;
      if (snapshot.active || capture) cancel();
      return;
    }
    if (!capture) return;
    if (
      !session ||
      session.user.id !== capture.userId ||
      !identityMatches(capture)
    ) {
      cancel();
      return;
    }
    if (event === "TOKEN_REFRESHED") {
      const refreshed = verifiedSession(session);
      if (!refreshed) {
        discard();
        publish("expired", true, messages.expired);
        return;
      }
      // An in-flight attempt keeps its original immutable credential. Refresh
      // only supplies the next attempt; subject/generation/epoch are unchanged.
      capture = refreshed;
    }
  }
  async function requestLink(email: string): Promise<PasswordRecoveryResult> {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return result(false, "Enter a valid email address.");
    if (!configured) return result(false, messages.unavailable);
    try {
      const response = await deps.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${origin}/reset-password`,
      });
      if (
        response.error &&
        !["user_not_found", "email_not_found"].includes(
          response.error.code ?? ""
        )
      )
        return result(false, messages.request);
      return result(true, messages.link);
    } catch {
      return result(false, messages.request);
    }
  }
  async function submitPassword(
    password: string,
    confirmation: string
  ): Promise<PasswordRecoveryResult> {
    if (!configured) return result(false, messages.unavailable);
    if (snapshot.status === "submitting")
      return result(false, "A password update is already in progress.");
    const lease = capture;
    if (!lease || !current(lease)) return result(false, messages.expired);
    if (lease.expiresAt <= now()) {
      discard();
      publish("expired", true, messages.expired);
      return result(false, messages.expired);
    }
    if (!passwordSchema.safeParse(password).success)
      return result(false, "Use a password between 8 and 128 characters.");
    if (password !== confirmation)
      return result(false, "Passwords do not match.");
    const abort = new AbortController();
    pending = abort;
    publish("submitting", true, null);
    // Publishing can synchronously trigger logout/cancel. Recheck immediately
    // before dispatch, without any SDK await or global session/token read.
    if (!current(lease) || abort.signal.aborted)
      return result(false, messages.cancelled);
    if (lease.expiresAt <= now()) {
      discard();
      publish("expired", true, messages.expired);
      return result(false, messages.expired);
    }
    const timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await request(`${authOrigin}/auth/v1/user`, {
        method: "PUT",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          apikey: deps.publishableKey,
          Authorization: `Bearer ${lease.token}`,
          "X-Supabase-Api-Version": "2024-01-01",
        },
        body: JSON.stringify({ password }),
      });
      if (!current(lease)) return result(false, messages.cancelled);
      const body: unknown = await response.json().catch(() => null);
      if (!current(lease)) return result(false, messages.cancelled);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          discard();
          publish("expired", true, messages.expired);
          return result(false, messages.expired);
        }
        const code =
          body && typeof body === "object" && "code" in body ? body.code : null;
        const message =
          code === "weak_password"
            ? "Use a stronger password that meets your account's password policy."
            : code === "same_password"
              ? "Choose a password you have not used before."
              : messages.update;
        publish("error", true, message);
        return result(false, message);
      }
      const user =
        body && typeof body === "object" && "user" in body ? body.user : body;
      const parsed = userSchema.safeParse(user);
      if (!parsed.success || parsed.data.id !== lease.userId) {
        publish("error", true, messages.update);
        return result(false, messages.update);
      }
      // Do not save, refresh, sign out or otherwise mutate the SDK session here:
      // a global session operation could act on a different account by then.
      discard();
      completedIdentity = {
        userId: lease.userId,
        generation: lease.generation,
      };
      publish("complete", true, messages.complete);
      return result(true, messages.complete);
    } catch {
      if (!current(lease)) return result(false, messages.cancelled);
      publish("error", true, messages.update);
      return result(false, messages.update);
    } finally {
      clearTimeout(timeout);
      if (pending === abort) pending = null;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    handleAuthEvent,
    cancel,
    requestLink,
    submitPassword,
    reportLinkError: () => {
      const active = snapshot.active;
      discard();
      publish("expired", active, messages.expired);
    },
  };
}
export type PasswordRecoveryController = ReturnType<
  typeof createPasswordRecoveryController
>;
