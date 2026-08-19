import { router, publicProcedure } from "./_core/trpc";
import { getUserPermissions } from "./rbac";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./_core/env";

export const authRouter = router({
  me: publicProcedure.query(async (opts) => {
    if (!opts.ctx.user) return null;
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
