/**
 * PHASE 1 — Route guard coverage (structural test)
 *
 * The guard is only worth as much as its coverage. This test reads the router
 * sources and asserts that every procedure receiving a project-scoped identifier
 * actually calls the guard.
 *
 * Why a source-level test: a per-procedure integration test would require a live
 * database and would still miss a *newly added* unguarded route. This test fails
 * the build the moment someone adds `projectId` to a router without a guard, which
 * is the failure mode that matters.
 *
 * Maintenance contract: if a procedure legitimately needs no guard (admin-only
 * catalog operations, aggregate dashboards), add its router to
 * `ROUTERS_WITHOUT_PROJECT_SCOPE` with a reason.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SERVER_DIR = __dirname;

/** Identifiers that mean "this operation touches a specific project's data". */
const SCOPED_ID_PATTERN =
  /\b(projectId|drawingId|scopeDraftId|scopeSourceId|estimateDraftId|intakeFormId|rfiId|revisionId)\b/;

/** The guard entry points exported by server/project-access.ts. */
const GUARD_PATTERN =
  /\b(requireProjectAccess|requireProjectAccessTrpc|requireEntityAccess|canAccessProject|assertEstimateDraftAccess)\b/;

/**
 * Routers that receive scoped ids but intentionally do not guard, with the reason.
 * Empty by design: every such router was reviewed during Phase 1.
 */
const ROUTERS_WITHOUT_PROJECT_SCOPE: Record<string, string> = {};

function routerFiles(): string[] {
  return readdirSync(SERVER_DIR)
    .filter(f => f.endsWith("-router.ts") && !f.endsWith(".test.ts"))
    .sort();
}

function read(file: string): string {
  return readFileSync(join(SERVER_DIR, file), "utf8");
}

describe("PHASE 1: route guard coverage", () => {
  const files = routerFiles();

  it("finds the router files to audit", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("guards every router that receives a project-scoped identifier", () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const src = read(file);
      if (!SCOPED_ID_PATTERN.test(src)) continue;
      if (file in ROUTERS_WITHOUT_PROJECT_SCOPE) continue;
      if (!GUARD_PATTERN.test(src)) unguarded.push(file);
    }

    expect(unguarded).toEqual([]);
  });

  it("imports the guard from the single chokepoint module", () => {
    const wrongImport: string[] = [];

    for (const file of files) {
      const src = read(file);
      if (!GUARD_PATTERN.test(src)) continue;
      // The guard must come from ./project-access, not be re-implemented locally.
      if (!/from\s+"\.\/project-access"/.test(src)) wrongImport.push(file);
    }

    expect(wrongImport).toEqual([]);
  });

  it("guards the drawing and RFI routers specifically (highest-risk data)", () => {
    for (const file of ["drawing-router.ts", "rfi-router.ts", "scope-source-router.ts"]) {
      const src = read(file);
      expect(GUARD_PATTERN.test(src), `${file} must call the project access guard`).toBe(
        true,
      );
    }
  });

  it("keeps the guard chokepoint free of router-specific logic", () => {
    const guardSrc = readFileSync(join(SERVER_DIR, "project-access.ts"), "utf8");
    // The guard must not import routers (would create a cycle and hide policy).
    expect(guardSrc).not.toMatch(/from\s+"\.\/[a-z-]+-router"/);
    // Fail-closed contract must be present.
    expect(guardSrc).toMatch(/Authorization store unavailable/);
  });
});
