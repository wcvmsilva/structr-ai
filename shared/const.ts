export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
export const FORBIDDEN_PROJECT_ERR_MSG = 'You do not have access to this project (10003)';

// ── PHASE 1: session hardening ────────────────────────────────────────
/** Session lifetime: 7 days (was 1 year). Refreshed on activity. */
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
/** Sliding refresh threshold: re-issue the cookie when less than 1 day remains. */
export const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24;
/** Default SameSite policy for the session cookie. */
export const SESSION_SAME_SITE: "lax" | "strict" | "none" = "lax";
/** Canonical tenant slug for the first (GCHI) tenant. */
export const DEFAULT_TENANT_SLUG = "gchi";
