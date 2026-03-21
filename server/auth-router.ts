import { router, publicProcedure } from "./_core/trpc";
import { getUserPermissions } from "./rbac";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "@shared/const";

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
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
});
