import { z } from "zod";

export type PasswordChangeContext = {
  userId: string;
  token: string;
  /** Unix epoch milliseconds, converted from Session.expires_at by the caller. */
  expiresAt: number;
  generation: number;
  action: number;
};
export type PasswordChangeResult = { ok: boolean; message: string };
export type PasswordChangerDependencies = {
  supabaseUrl: string;
  publishableKey: string;
  getContext(): PasswordChangeContext | null;
  fetch?: typeof fetch;
  now?: () => number;
};
const contextSchema = z.object({
  userId: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  expiresAt: z.number().int().positive(),
  generation: z.number().int().nonnegative(),
  action: z.number().int().nonnegative(),
});
const currentSchema = z.string().min(1).max(1024);
const nextSchema = z
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
const failed = "Unable to update your password. Try again shortly.";
const expired = "Your session has expired. Sign in again.";
const changed = "Session changed. Please try again.";
const nativeErrors = new Map([
  ["current_password_invalid", "Your current password is incorrect."],
  ["current_password_required", "Enter your current password."],
  [
    "same_password",
    "Choose a new password different from your current password.",
  ],
  [
    "weak_password",
    "Use a stronger password that meets your account's password policy.",
  ],
  ["reauthentication_needed", "Sign in again before changing your password."],
  [
    "reauthentication_not_valid",
    "Sign in again before changing your password.",
  ],
  [
    "insufficient_aal",
    "Complete the required sign-in verification before changing your password.",
  ],
]);

/** Native Auth credential operation, not a business mutation. The caller must
 * supply only an eligible password-authenticated session; provider configuration
 * must require current_password. Recovery/OTP exemptions must be excluded by the
 * caller. This client never retries without the current password or saves a session. */
export function createPasswordChanger(deps: PasswordChangerDependencies) {
  let authOrigin: string | null = null;
  try {
    const url = new URL(deps.supabaseUrl);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    )
      authOrigin = url.origin;
  } catch {
    /* Invalid configuration fails before any credential leaves memory. */
  }
  const publishableKey = deps.publishableKey;
  const configured = Boolean(
    authOrigin && /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)
  );
  const request =
    deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  let revision = 0;
  let pending: AbortController | null = null;
  const result = (ok: boolean, message: string): PasswordChangeResult => ({
    ok,
    message,
  });
  function readContext(): PasswordChangeContext | null {
    try {
      const parsed = contextSchema.safeParse(deps.getContext());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
  function cancel() {
    revision += 1;
    pending?.abort();
    pending = null;
  }
  function isCurrent(lease: PasswordChangeContext, version: number): boolean {
    const current = readContext();
    return (
      revision === version &&
      !!current &&
      current.userId === lease.userId &&
      current.generation === lease.generation &&
      current.action === lease.action
    );
  }
  async function change(
    currentPassword: string,
    newPassword: string,
    confirmation: string
  ): Promise<PasswordChangeResult> {
    if (!configured)
      return result(false, "Password change is unavailable. Try again later.");
    if (pending)
      return result(false, "A password update is already in progress.");
    if (!currentSchema.safeParse(currentPassword).success)
      return result(
        false,
        "Enter your current password (up to 1024 characters)."
      );
    if (!nextSchema.safeParse(newPassword).success)
      return result(false, "Use a password between 8 and 128 characters.");
    if (newPassword !== confirmation)
      return result(false, "Passwords do not match.");
    if (newPassword === currentPassword)
      return result(
        false,
        "Choose a new password different from your current password."
      );
    const version = revision,
      lease = readContext();
    if (!lease || lease.expiresAt <= now()) return result(false, expired);
    const abort = new AbortController();
    pending = abort;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // No SDK session read/await may replace this copied credential before PUT.
      if (!isCurrent(lease, version) || abort.signal.aborted)
        return result(false, changed);
      if (lease.expiresAt <= now()) return result(false, expired);
      timeout = setTimeout(() => abort.abort(), 15_000);
      const response = await request(`${authOrigin}/auth/v1/user`, {
        method: "PUT",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey,
          Authorization: `Bearer ${lease.token}`,
          "X-Supabase-Api-Version": "2024-01-01",
        },
        body: JSON.stringify({
          password: newPassword,
          current_password: currentPassword,
        }),
      });
      if (!isCurrent(lease, version)) return result(false, changed);
      const body: unknown = await response.json().catch(() => null);
      if (!isCurrent(lease, version)) return result(false, changed);
      if (!response.ok) {
        const code =
          body &&
          typeof body === "object" &&
          "code" in body &&
          typeof body.code === "string"
            ? body.code
            : null;
        return result(
          false,
          (code && nativeErrors.get(code)) ||
            ([401, 403].includes(response.status) ? expired : failed)
        );
      }
      const value =
        body && typeof body === "object" && "user" in body ? body.user : body;
      const parsed = userSchema.safeParse(value);
      if (!parsed.success || parsed.data.id !== lease.userId)
        return result(false, failed);
      return result(true, "Password updated.");
    } catch {
      return result(false, isCurrent(lease, version) ? failed : changed);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (pending === abort) pending = null;
    }
  }
  return { change, cancel };
}
