/**
 * Environment contract.
 *
 * PHASE 1 additions:
 *   - session tuning (cookie TTL, refresh window, SameSite policy)
 *   - progressive CSP (report-only first, enforced later, per environment)
 *   - explicit dev-bypass switch that can never be enabled in production
 *
 * SUPABASE AUTH V1 additions:
 *   - AUTH_PROVIDER switch (supabase | legacy), default "supabase"
 *   - Supabase project URL / publishable key / optional JWT secret
 *   - the legacy Manus OAuth variables stay required only while AUTH_PROVIDER=legacy
 */

/** Auth provider selected for this process. Kept local to avoid an import cycle. */
const rawAuthProvider = (process.env.AUTH_PROVIDER ?? "").trim().toLowerCase();
const authProvider: "supabase" | "legacy" =
  rawAuthProvider === "legacy" ? "legacy" : "supabase";

/**
 * Supabase project URL. Accepts the server-side name first, then the Vite name so a
 * single-origin deployment can declare it once.
 */
const supabaseUrl = (
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ""
).trim();

/**
 * Publishable (anon) key. Safe to expose to the browser; the server keeps a copy so
 * boot-time validation can report a half-configured deployment.
 */
const supabasePublishableKey = (
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  ""
).trim();

// Validate required environment variables at startup.
// Legacy OAuth variables are only mandatory while the legacy provider is active.
const BASE_REQUIRED_ENV_VARS = ['DATABASE_URL', 'JWT_SECRET'] as const;
const LEGACY_REQUIRED_ENV_VARS = ['OAUTH_SERVER_URL', 'OWNER_OPEN_ID'] as const;
const SUPABASE_REQUIRED_ENV_VARS = ['SUPABASE_URL'] as const;

const requiredEnvVars: string[] = [
  ...BASE_REQUIRED_ENV_VARS,
  ...(authProvider === 'legacy' ? LEGACY_REQUIRED_ENV_VARS : []),
];

const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0 && process.env.NODE_ENV !== 'test') {
  throw new Error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
}

if (
  authProvider === 'supabase' &&
  process.env.NODE_ENV !== 'test' &&
  !supabaseUrl
) {
  throw new Error(
    `[FATAL] AUTH_PROVIDER=supabase requires ${SUPABASE_REQUIRED_ENV_VARS.join(', ')} ` +
      `(or VITE_SUPABASE_URL). Set AUTH_PROVIDER=legacy to roll back to Manus OAuth.`,
  );
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";
const isDevelopment = nodeEnv === "development";

/** Parse an integer env var, falling back when unset or malformed. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parse a boolean env var ("1", "true", "yes" are true). */
function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

/**
 * SameSite policy for the session cookie.
 * Default is "lax": protects against CSRF on cross-site POSTs while keeping the
 * OAuth redirect flow working (the callback is a top-level GET navigation).
 * "strict" is available for deployments that do not need any cross-site entry.
 * "none" is rejected in production because it re-opens the CSRF hole Phase 1 closes.
 */
function sameSiteEnv(): "lax" | "strict" | "none" {
  const raw = (process.env.SESSION_COOKIE_SAMESITE ?? "").trim().toLowerCase();
  if (raw === "strict") return "strict";
  if (raw === "none") {
    if (isProduction) {
      console.error(
        "[ENV] SESSION_COOKIE_SAMESITE=none is not allowed in production; falling back to 'lax'.",
      );
      return "lax";
    }
    return "none";
  }
  return "lax";
}

/**
 * CSP rollout mode.
 *   off         → no CSP header (legacy behaviour, requires explicit opt-in)
 *   report-only → header sent as Content-Security-Policy-Report-Only (default in prod first pass)
 *   enforce     → header sent as Content-Security-Policy
 */
function cspModeEnv(): "off" | "report-only" | "enforce" {
  const raw = (process.env.CSP_MODE ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "enforce" || raw === "report-only") return raw;
  // Progressive default: dev enforces (fail fast while building), prod reports first.
  return isProduction ? "report-only" : "enforce";
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  nodeEnv,
  isProduction,
  isDevelopment,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "http://localhost:3000",

  // ── PHASE 1: session hardening ────────────────────────────────────────
  /**
   * Session lifetime in days. Was 365; now 7 by default.
   * The canonical millisecond value lives in shared/const.ts (SESSION_MAX_AGE_MS);
   * this override exists so a deployment can shorten it without a code change.
   */
  sessionTtlDays: intEnv("SESSION_TTL_DAYS", 7),
  /**
   * Sliding-window refresh: when a request arrives and the session has less
   * than this many days left, a fresh cookie is issued. Keeps daily operators
   * logged in without ever minting a year-long credential.
   */
  sessionRefreshThresholdDays: intEnv("SESSION_REFRESH_THRESHOLD_DAYS", 1),
  sessionCookieSameSite: sameSiteEnv(),

  // ── PHASE 1: content security policy ──────────────────────────────────
  cspMode: cspModeEnv(),
  /** Optional endpoint that receives CSP violation reports. */
  cspReportUri: process.env.CSP_REPORT_URI ?? "",

  // ── SUPABASE AUTH V1 ──────────────────────────────────────────────────
  /** Active auth provider: "supabase" (default) or "legacy" (Manus OAuth rollback). */
  authProvider,
  /** Supabase project URL, e.g. https://xxxx.supabase.co (no trailing slash). */
  supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
  /** Publishable/anon key. Browser-safe. */
  supabasePublishableKey,
  /**
   * Legacy symmetric JWT secret. Only needed for Supabase projects that still sign
   * with HS256. When empty, tokens are verified against the project JWKS (asymmetric).
   */
  supabaseJwtSecret: (process.env.SUPABASE_JWT_SECRET ?? "").trim(),
  /**
   * Transitional switch: while AUTH_PROVIDER=supabase, accept a valid legacy session
   * cookie when the request carries no bearer token. Off by default.
   */
  supabaseAllowLegacyFallback: boolEnv(
    "SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK",
    false,
  ),
};

export type Env = typeof ENV;
