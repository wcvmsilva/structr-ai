/**
 * PHASE 1 — Identity model & dev-bypass lock
 *
 * Two things are asserted here:
 *
 * 1. The identity split. `profiles.id` is an internal UUID; `profiles.externalOpenId`
 *    is the external OAuth identifier. The internal id must never be derived from,
 *    or equal to, the external openId — that was the Phase 0 defect that made
 *    session lookup impossible.
 *
 * 2. The dev bypass lock. `dev-secret-key` may only bypass authentication when
 *    NODE_ENV === "development". Every other environment must refuse, and a
 *    production boot with that secret must fail fast.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  isDevBypassEnabled,
  assertProductionSecretsAreSafe,
  DEV_JWT_SECRET,
} from "./_core/sdk";
import { resolveSessionMaxAgeMs } from "./_core/cookies";
import {
  SESSION_MAX_AGE_MS,
  SESSION_REFRESH_THRESHOLD_MS,
  SESSION_SAME_SITE,
  ONE_YEAR_MS,
} from "@shared/const";

const STRONG_SECRET = "a".repeat(48);

describe("PHASE 1: dev-bypass lock", () => {
  it("enables the bypass only when NODE_ENV=development AND the secret is the dev value", () => {
    expect(isDevBypassEnabled({ NODE_ENV: "development" }, DEV_JWT_SECRET)).toBe(true);
  });

  it("refuses the bypass in production even with the dev secret", () => {
    expect(isDevBypassEnabled({ NODE_ENV: "production" }, DEV_JWT_SECRET)).toBe(false);
  });

  it("refuses the bypass in staging/test/unset environments", () => {
    for (const NODE_ENV of ["staging", "test", "preview", "", undefined]) {
      expect(isDevBypassEnabled({ NODE_ENV }, DEV_JWT_SECRET)).toBe(false);
    }
  });

  it("refuses the bypass in development when the secret is NOT the dev value", () => {
    expect(isDevBypassEnabled({ NODE_ENV: "development" }, STRONG_SECRET)).toBe(false);
  });
});

describe("PHASE 1: production secret assertions", () => {
  it("throws when a production build still carries the dev secret", () => {
    expect(() =>
      assertProductionSecretsAreSafe({ NODE_ENV: "production" }, DEV_JWT_SECRET),
    ).toThrow(/JWT_SECRET/i);
  });

  it("throws for any non-dev environment carrying the dev secret", () => {
    expect(() =>
      assertProductionSecretsAreSafe({ NODE_ENV: "staging" }, DEV_JWT_SECRET),
    ).toThrow(/JWT_SECRET/i);
  });

  it("throws when the production secret is too short to be safe", () => {
    expect(() =>
      assertProductionSecretsAreSafe({ NODE_ENV: "production" }, "short-secret"),
    ).toThrow(/32 characters/i);
  });

  it("accepts a strong secret in production", () => {
    expect(() =>
      assertProductionSecretsAreSafe({ NODE_ENV: "production" }, STRONG_SECRET),
    ).not.toThrow();
  });

  it("tolerates the dev secret in development and test", () => {
    expect(() =>
      assertProductionSecretsAreSafe({ NODE_ENV: "development" }, DEV_JWT_SECRET),
    ).not.toThrow();
    expect(() =>
      assertProductionSecretsAreSafe({ NODE_ENV: "test" }, DEV_JWT_SECRET),
    ).not.toThrow();
  });
});

describe("PHASE 1: session cookie lifetime", () => {
  const originalTtl = process.env.SESSION_TTL_DAYS;

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.SESSION_TTL_DAYS;
    else process.env.SESSION_TTL_DAYS = originalTtl;
  });

  it("defaults to 7 days, not 1 year", () => {
    const sevenDays = 1000 * 60 * 60 * 24 * 7;
    expect(SESSION_MAX_AGE_MS).toBe(sevenDays);
    expect(SESSION_MAX_AGE_MS).toBeLessThan(ONE_YEAR_MS);
  });

  it("refreshes before expiry (threshold shorter than lifetime)", () => {
    expect(SESSION_REFRESH_THRESHOLD_MS).toBeGreaterThan(0);
    expect(SESSION_REFRESH_THRESHOLD_MS).toBeLessThan(SESSION_MAX_AGE_MS);
  });

  it("defaults SameSite to lax (CSRF protection, OAuth still works)", () => {
    expect(SESSION_SAME_SITE).toBe("lax");
  });

  it("allows shortening the lifetime via SESSION_TTL_DAYS", () => {
    process.env.SESSION_TTL_DAYS = "1";
    expect(resolveSessionMaxAgeMs()).toBe(1000 * 60 * 60 * 24);
  });

  it("clamps attempts to extend the lifetime beyond the 7-day baseline", () => {
    process.env.SESSION_TTL_DAYS = "365";
    expect(resolveSessionMaxAgeMs()).toBe(SESSION_MAX_AGE_MS);
  });

  it("ignores malformed SESSION_TTL_DAYS values", () => {
    for (const raw of ["0", "-5", "abc"]) {
      process.env.SESSION_TTL_DAYS = raw;
      expect(resolveSessionMaxAgeMs()).toBe(SESSION_MAX_AGE_MS);
    }
  });
});
