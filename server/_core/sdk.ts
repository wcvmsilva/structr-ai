import {
  AXIOS_TIMEOUT_MS,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_REFRESH_THRESHOLD_MS,
} from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { Profile } from "../../drizzle/schema";
import {
  getProfileByExternalOpenId,
  upsertProfileFromOAuth,
} from "../identity-db";
import { ENV } from "./env";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  /** External OAuth identifier. Resolved to an internal profile UUID on every request. */
  openId: string;
  appId: string;
  name: string;
};

/** Result of verifying a session cookie, including expiry metadata for sliding refresh. */
export type VerifiedSession = SessionPayload & {
  /** JWT `exp` claim in milliseconds since epoch, when present. */
  expiresAtMs: number | null;
};

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

/** The insecure development secret. Only tolerated when NODE_ENV === "development". */
export const DEV_JWT_SECRET = "dev-secret-key";

/**
 * PHASE 1 — dev bypass lock.
 *
 * Phase 0 granted a hard-coded admin profile whenever JWT_SECRET === "dev-secret-key",
 * regardless of environment. That is a privilege-escalation path if the insecure secret
 * ever reaches a shared or production deployment.
 *
 * The bypass now requires BOTH conditions simultaneously:
 *   1. NODE_ENV === "development"
 *   2. JWT_SECRET === "dev-secret-key"
 *
 * Any other combination refuses to bypass. In production the insecure secret is a fatal
 * misconfiguration (see `assertProductionSecretsAreSafe`).
 */
export function isDevBypassEnabled(
  env: { NODE_ENV?: string | undefined } = process.env as { NODE_ENV?: string },
  secret: string = ENV.cookieSecret,
): boolean {
  return env.NODE_ENV === "development" && secret === DEV_JWT_SECRET;
}

/**
 * Fail fast when a production/staging build is configured with the dev secret.
 * Called from the server bootstrap before any request is served.
 */
export function assertProductionSecretsAreSafe(
  env: { NODE_ENV?: string | undefined } = process.env as { NODE_ENV?: string },
  secret: string = ENV.cookieSecret,
): void {
  const nodeEnv = env.NODE_ENV ?? "";
  const isNonDev = nodeEnv !== "development" && nodeEnv !== "test";

  if (isNonDev && secret === DEV_JWT_SECRET) {
    throw new Error(
      "[FATAL] JWT_SECRET is set to the development value \"dev-secret-key\" while NODE_ENV=" +
        `${nodeEnv || "(unset)"}. Refusing to start: rotate JWT_SECRET before deploying.`,
    );
  }

  if (isNonDev && secret.length < 32) {
    throw new Error(
      "[FATAL] JWT_SECRET must be at least 32 characters outside development.",
    );
  }
}

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }

  private decodeState(state: string): string {
    const redirectUri = atob(state);
    return redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for an external OAuth openId.
   *
   * PHASE 1: default lifetime is SESSION_MAX_AGE_MS (7 days) instead of one year.
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? SESSION_MAX_AGE_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<VerifiedSession | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name, exp } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }

      return {
        openId,
        appId,
        name,
        expiresAtMs: typeof exp === "number" ? exp * 1000 : null,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  /**
   * True when the session is close enough to expiry that the cookie should be
   * re-issued (sliding session). Keeps cookie lifetime short without forcing
   * active operators to re-authenticate every 7 days.
   */
  shouldRefreshSession(
    session: Pick<VerifiedSession, "expiresAtMs">,
    now: number = Date.now(),
  ): boolean {
    if (!session.expiresAtMs) return true;
    return session.expiresAtMs - now < SESSION_REFRESH_THRESHOLD_MS;
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  /**
   * Resolve the authenticated profile for a request.
   *
   * PHASE 1 flow:
   *   1. dev bypass (development + dev secret only)
   *   2. verify signed session cookie → external openId
   *   3. resolve profiles.external_open_id → internal profile UUID
   *   4. self-heal: if the profile is missing, sync it from the OAuth provider
   *   5. reject deactivated profiles
   */
  async authenticateRequest(req: Request): Promise<Profile> {
    if (isDevBypassEnabled()) {
      return this.buildDevProfile();
    }

    // Guard: the insecure dev secret must never authenticate outside development.
    if (ENV.cookieSecret === DEV_JWT_SECRET) {
      console.error(
        "[Auth] Refusing to authenticate: JWT_SECRET is the development value but NODE_ENV is not \"development\".",
      );
      throw ForbiddenError("Server auth misconfiguration");
    }

    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    // Session carries the EXTERNAL openId; resolve it to the internal profile UUID.
    let profile = await getProfileByExternalOpenId(session.openId);

    if (!profile) {
      // Self-heal: profile row missing (first login after migration, or manual deletion).
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        profile = await upsertProfileFromOAuth({
          externalOpenId: userInfo.openId || session.openId,
          fullName: userInfo.name || session.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        });
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!profile) {
      throw ForbiddenError("User not found");
    }

    if (profile.isActive === false) {
      throw ForbiddenError("User account is disabled");
    }

    return profile;
  }

  /**
   * Development-only profile. Uses a stable UUID that also exists in Supabase
   * `profiles` so that RLS triggers relying on auth.uid() keep working locally.
   */
  private buildDevProfile(): Profile {
    return {
      id: process.env.DEV_PROFILE_ID || "ada92dc5-a90c-4b2b-ba91-7b72ce427786",
      tenantId: process.env.DEV_TENANT_ID || null,
      externalOpenId: "dev-open-id",
      email: "dev@gchi.local",
      loginMethod: "dev",
      fullName: "Dev User",
      companyName: "GC Home Improvement LLC",
      role: "admin",
      isActive: true,
      lastSignedIn: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Profile;
  }

  /** Resolve the tenant a request should operate in (dev + real flows). */
  async resolveTenantId(profile: Profile | null): Promise<string | null> {
    // B2 (Codex P1-1): a profile with no tenant assignment is NOT silently promoted
    // into the default (GCHI) tenant. Doing so handed every unprovisioned account the
    // primary production tenant's live business data, through helpers that then scoped
    // it perfectly to a tenant identity that had been fabricated here.
    // getDefaultTenantId() itself is unchanged and still used for bootstrap/provisioning
    // (identity-db.upsertProfileFromOAuth) — only this authorization-time fallback is gone.
    return profile?.tenantId ?? null;
  }
}

export const sdk = new SDKServer();
