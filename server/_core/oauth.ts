import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { upsertProfileFromOAuth } from "../identity-db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      // PHASE 1: persist the identity before issuing a session.
      // profiles.id stays an internal UUID; the OAuth openId is stored in
      // profiles.external_open_id (unique), so the two are never conflated.
      const profile = await upsertProfileFromOAuth({
        externalOpenId: userInfo.openId,
        fullName: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
      });

      if (!profile) {
        // Database unavailable — do not hand out a session that cannot be resolved.
        console.error("[OAuth] Profile sync returned no row; refusing to issue session");
        res.status(503).json({ error: "Profile store unavailable" });
        return;
      }

      if (profile.isActive === false) {
        res.status(403).json({ error: "User account is disabled" });
        return;
      }

      // PHASE 1: 7-day session instead of 1 year, refreshed on activity.
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: SESSION_MAX_AGE_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: SESSION_MAX_AGE_MS,
      });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
