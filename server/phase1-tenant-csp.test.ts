/**
 * PHASE 1 — Tenant scoping helpers & progressive CSP
 *
 * Tenant scoping: every business query must be constrained by tenant. These tests
 * lock the two rollout modes (transitional vs TENANT_STRICT) so the behaviour cannot
 * drift silently — a regression here means cross-tenant data leakage.
 *
 * CSP: Phase 0 shipped with CSP disabled. These tests assert the policy is built,
 * that it degrades progressively (report-only → enforce), and that the dev-only
 * relaxations (unsafe-eval for Vite HMR) never leak into a production policy.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { isStrictTenantMode, withTenant, withTenantAll, assertSameTenant, TenantScopeError } from "./tenant-scope";
import { buildCspDirectives } from "./_core/csp";

const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";

describe("PHASE 1: tenant mode flag", () => {
  it("defaults to transitional mode (legacy NULL rows still visible)", () => {
    expect(isStrictTenantMode({})).toBe(false);
    expect(isStrictTenantMode({ TENANT_STRICT: undefined })).toBe(false);
    expect(isStrictTenantMode({ TENANT_STRICT: "false" })).toBe(false);
  });

  it("enables strict isolation only for an explicit true", () => {
    expect(isStrictTenantMode({ TENANT_STRICT: "true" })).toBe(true);
    expect(isStrictTenantMode({ TENANT_STRICT: "TRUE" })).toBe(true);
  });

  it("does not treat arbitrary values as true", () => {
    for (const raw of ["1", "yes", "on", "strict"]) {
      expect(isStrictTenantMode({ TENANT_STRICT: raw })).toBe(false);
    }
  });
});

describe("PHASE 1: withTenant stamping", () => {
  it("stamps the tenant on an insert payload", () => {
    expect(withTenant({ name: "Kitchen" }, TENANT_A)).toEqual({
      name: "Kitchen",
      tenantId: TENANT_A,
    });
  });

  it("never overwrites an explicit tenantId", () => {
    expect(withTenant({ name: "Kitchen", tenantId: TENANT_B }, TENANT_A)).toEqual({
      name: "Kitchen",
      tenantId: TENANT_B,
    });
  });

  // HISTORY: this case previously read "leaves the payload untouched when no tenant is
  // known" and asserted that withTenant(values, null) returned the payload unstamped —
  // i.e. it blessed creating a business row with tenant_id NULL because the caller's
  // tenant could not be resolved. Codex P1-1 rejected that reading; under B2 an
  // unresolved caller tenant authorizes nothing, least of all a permanent unowned row.
  it("refuses to stamp a payload when no tenant is known", () => {
    expect(() => withTenant({ name: "Kitchen" }, null as unknown as string)).toThrow(/Tenant scope is unresolved/);
    expect(() => withTenant({ name: "Kitchen" }, undefined as unknown as string)).toThrow(/Tenant scope is unresolved/);
  });

  it("stamps a whole batch", () => {
    const rows = withTenantAll([{ n: 1 }, { n: 2, tenantId: TENANT_B }], TENANT_A);
    expect(rows).toEqual([
      { n: 1, tenantId: TENANT_A },
      { n: 2, tenantId: TENANT_B },
    ]);
  });
});

describe("PHASE 1: assertSameTenant", () => {
  const originalStrict = process.env.TENANT_STRICT;

  afterEach(() => {
    if (originalStrict === undefined) delete process.env.TENANT_STRICT;
    else process.env.TENANT_STRICT = originalStrict;
  });

  it("accepts a matching tenant", () => {
    expect(assertSameTenant(TENANT_A, TENANT_A)).toBe(true);
  });

  it("rejects a different tenant", () => {
    expect(assertSameTenant(TENANT_B, TENANT_A)).toBe(false);
  });

  it("accepts legacy NULL rows in transitional mode", () => {
    delete process.env.TENANT_STRICT;
    expect(assertSameTenant(null, TENANT_A)).toBe(true);
  });

  it("rejects legacy NULL rows once TENANT_STRICT is on", () => {
    process.env.TENANT_STRICT = "true";
    expect(assertSameTenant(null, TENANT_A)).toBe(false);
  });

  // HISTORY: this case previously read "does not constrain callers with an unknown tenant
  // (admin/dev path)" and asserted assertSameTenant(TENANT_B, null) === true — an
  // authorization function answering "yes" without knowing who was asking. An audit of
  // every call site found no such admin/dev path; the justification was for a caller that
  // does not exist. Codex P1-1; inverted under B2.
  it("authorizes nothing for a caller whose tenant is unresolved", () => {
    expect(assertSameTenant(TENANT_B, null as unknown as string)).toBe(false);
    expect(assertSameTenant(null, null as unknown as string)).toBe(false);
  });
});

describe("PHASE 1: progressive CSP", () => {
  it("builds a policy instead of disabling CSP", () => {
    const directives = buildCspDirectives({ isDevelopment: false });
    expect(directives.defaultSrc).toEqual(["'self'"]);
    expect(directives.objectSrc).toEqual(["'none'"]);
    expect(directives.frameAncestors).toEqual(["'none'"]);
  });

  it("never allows unsafe-eval in a production policy", () => {
    const directives = buildCspDirectives({ isDevelopment: false });
    expect(directives.scriptSrc).not.toContain("'unsafe-eval'");
    expect(directives.scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("relaxes script-src and websockets for the Vite dev server only", () => {
    const dev = buildCspDirectives({ isDevelopment: true });
    expect(dev.scriptSrc).toContain("'unsafe-eval'");
    expect(dev.connectSrc).toContain("ws:");
  });

  it("upgrades insecure requests outside development", () => {
    expect(buildCspDirectives({ isDevelopment: false })).toHaveProperty(
      "upgradeInsecureRequests",
    );
    expect(buildCspDirectives({ isDevelopment: true })).not.toHaveProperty(
      "upgradeInsecureRequests",
    );
  });

  it("keeps S3 images and PDF/canvas blob workers loadable", () => {
    const directives = buildCspDirectives({ isDevelopment: false });
    expect(directives.imgSrc).toContain("https:");
    expect(directives.imgSrc).toContain("blob:");
    expect(directives.workerSrc).toContain("blob:");
  });

  it("wires a report endpoint when one is configured", () => {
    const directives = buildCspDirectives({
      isDevelopment: false,
      reportUri: "https://example.test/csp",
    });
    expect(directives.reportUri).toEqual(["https://example.test/csp"]);
  });
});
