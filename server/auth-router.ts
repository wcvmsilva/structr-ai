import { router, publicProcedure, resolveAuthenticatedIntakeIdentity, resolveAuthenticatedDataApiIdentity } from "./_core/trpc";
import { getUserPermissions } from "./rbac";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "@shared/const";
import { ENV, isAuthenticatedDataApiMode } from "./_core/env";
import { isIntakeFormationEnabled, isScopeWorkspaceReadEnabled, isFinancialCalculatorEnabled } from "./_core/database-mode";

export const authRouter = router({
  me: publicProcedure.query(async (opts) => {
    if (!opts.ctx.user) return null;
    if (isAuthenticatedDataApiMode()) {
      const session = opts.ctx.authenticatedDataApiSession;
      if (!session) return null;
      return { ...session.profile, permissions: session.permissions.slugs };
    }
    // Enrich with permissions
    const perms = await getUserPermissions(opts.ctx.user.id);
    return {
      ...opts.ctx.user,
      permissions: Array.from(perms),
    };
  }),
  /**
   * SUPABASE AUTH V1 — public auth descriptor.
   *
   * Lets the SPA discover which provider is active before it renders a login screen,
   * without leaking anything sensitive (the publishable key is browser-safe by design
   * and is normally injected at build time via VITE_SUPABASE_PUBLISHABLE_KEY; it is
   * echoed here only so a runtime-configured deployment also works).
   */
  session: publicProcedure.query(({ ctx }) => ({
    provider: ctx.authProvider,
    authenticated: Boolean(ctx.user),
    supabase:
      ctx.authProvider === "supabase"
        ? {
            url: ENV.supabaseUrl,
            publishableKey: ENV.supabasePublishableKey,
          }
        : null,
    // ADR-002 partial-read UI reservation: presentation-only. Computed strictly
    // from the active database mode, never from the auth provider — the router
    // allowlist in _core/trpc.ts remains the only authorization boundary.
    estimateReadOnly: isAuthenticatedDataApiMode(),
    // IF-1 reservation: presentation-only. True only when the server gate is open
    // AND this request already carries a consistent protected identity, so the UI
    // can offer the submission instead of guessing. It is a boolean descriptor —
    // it leaks no identity or permission, and it never authorizes the write: the
    // router gate, the protected identity check and SQL remain the authorities.
    intakeFormationEnabled:
      isIntakeFormationEnabled() && resolveAuthenticatedIntakeIdentity(ctx) !== null,
    // Presentation only; executor independently authorizes this known pair.
    financialCalculatorEnabled:
      isFinancialCalculatorEnabled() && resolveAuthenticatedDataApiIdentity(ctx) !== null,
    // SWR-1 has its own closed-by-default capability. Presentation is not access:
    // the named RPC reauthorizes the physical project/intake pair on every read.
    scopeWorkspaceReadEnabled:
      isScopeWorkspaceReadEnabled() && resolveAuthenticatedDataApiIdentity(ctx) !== null,
  })),

  logout: publicProcedure.mutation(({ ctx }) => {
    // The legacy cookie is always cleared, even under the Supabase provider: a
    // stale Phase 1 cookie must not survive a Supabase sign-out.
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    // Under AUTH_PROVIDER=supabase the browser additionally calls
    // supabase.auth.signOut(), which revokes the refresh token client-side.
    return { success: true } as const;
  }),
});
