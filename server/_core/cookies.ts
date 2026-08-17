import type { CookieOptions, Request } from "express";
import { SESSION_MAX_AGE_MS, SESSION_SAME_SITE } from "@shared/const";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * PHASE 1: effective session lifetime.
 *
 * Defaults to SESSION_MAX_AGE_MS (7 days) and can be shortened per deployment via
 * SESSION_TTL_DAYS. Values above the 7-day baseline are clamped, so an env var can
 * never re-introduce the previous 1-year cookie.
 */
export function resolveSessionMaxAgeMs(): number {
  const raw = process.env.SESSION_TTL_DAYS;
  if (!raw) return SESSION_MAX_AGE_MS;

  const days = Number.parseInt(raw, 10);
  if (!Number.isFinite(days) || days <= 0) return SESSION_MAX_AGE_MS;

  return Math.min(days * DAY_MS, SESSION_MAX_AGE_MS);
}

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

/**
 * PHASE 1: resolve the SameSite policy.
 *
 * Default is "lax" (blocks cross-site POST/CSRF while keeping top-level navigation
 * logins working). Set SESSION_COOKIE_SAMESITE=strict for maximum hardening, or
 * "none" only when the SPA is genuinely served from a different site — "none"
 * additionally requires Secure, so it is downgraded to "lax" on plain HTTP.
 */
export function resolveSameSite(req: Request): "lax" | "strict" | "none" {
  const configured = (process.env.SESSION_COOKIE_SAMESITE || SESSION_SAME_SITE)
    .toLowerCase()
    .trim();

  const policy: "lax" | "strict" | "none" =
    configured === "strict" ? "strict" : configured === "none" ? "none" : "lax";

  // SameSite=None without Secure is rejected by modern browsers.
  if (policy === "none" && !isSecureRequest(req)) return "lax";

  return policy;
}

export function getSessionCookieOptions(
  req: Request
): Pick<
  CookieOptions,
  "domain" | "httpOnly" | "path" | "sameSite" | "secure" | "maxAge"
> {
  const hostname = req.hostname ?? "";
  const shouldSetDomain =
    !!process.env.SESSION_COOKIE_DOMAIN &&
    !LOCAL_HOSTS.has(hostname) &&
    !isIpAddress(hostname);

  return {
    httpOnly: true,
    path: "/",
    sameSite: resolveSameSite(req),
    secure: isSecureRequest(req),
    maxAge: resolveSessionMaxAgeMs(),
    ...(shouldSetDomain ? { domain: process.env.SESSION_COOKIE_DOMAIN } : {}),
  };
}
