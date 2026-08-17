import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "@shared/const";
import type { Profile } from "../../drizzle/schema";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: Profile | null;
  /** Tenant the request operates in. Null only when unauthenticated or DB unavailable. */
  tenantId: string | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: Profile | null = null;
  let tenantId: string | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
    tenantId = await sdk.resolveTenantId(user);
    await maybeRefreshSessionCookie(opts);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
    tenantId = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    tenantId,
  };
}

/**
 * PHASE 1: sliding session.
 *
 * Cookie lifetime is short (7 days). When an authenticated request arrives with a
 * session close to expiry, silently re-issue it so active operators are not logged
 * out, while abandoned sessions still die quickly.
 */
async function maybeRefreshSessionCookie(
  opts: CreateExpressContextOptions,
): Promise<void> {
  try {
    const rawCookie = opts.req.headers.cookie ?? "";
    const match = rawCookie
      .split(";")
      .map(part => part.trim())
      .find(part => part.startsWith(`${COOKIE_NAME}=`));

    if (!match) return;

    const cookieValue = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
    const session = await sdk.verifySession(cookieValue);
    if (!session) return;
    if (!sdk.shouldRefreshSession(session)) return;

    const refreshed = await sdk.createSessionToken(session.openId, {
      name: session.name,
      expiresInMs: SESSION_MAX_AGE_MS,
    });

    const cookieOptions = getSessionCookieOptions(opts.req);
    opts.res.cookie(COOKIE_NAME, refreshed, {
      ...cookieOptions,
      maxAge: SESSION_MAX_AGE_MS,
    });
  } catch (error) {
    // Refresh is best-effort: never fail a request because the cookie could not be rotated.
    console.warn("[Auth] Session refresh skipped:", String(error));
  }
}
