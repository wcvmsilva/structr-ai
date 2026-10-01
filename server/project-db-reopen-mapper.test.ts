/**
 * Direct unit coverage of isReopenFormationViolation (server/project-db.ts) for the
 * defensive branches a real Postgres error cannot naturally exercise: a cause chain that
 * cycles, one that exceeds the depth limit, and tuples that are close-but-not-exact
 * matches. The main scenarios (a real refusal, a real audit failure, a real 40001) are
 * proven through actual execution in server/project-reopen-product-physical.test.ts;
 * this file complements that with the edge cases MICHAEL-PROJECT-REOPEN-PRODUCT-PORT-V1-
 * QA.md named (cycles, depth, unrelated code/constraint/table). No database, no mocks.
 */
import { describe, expect, it } from "vitest";
import { isReopenFormationViolation } from "./project-db";

const MATCH = { code: "23514", constraint_name: "project_reopen_formation_not_verified", table_name: "projects" };

describe("isReopenFormationViolation", () => {
  it("matches the exact tuple", () => {
    expect(isReopenFormationViolation(MATCH)).toBe(true);
  });

  it("does not match a different code (e.g. a real 40001 serialization failure)", () => {
    expect(isReopenFormationViolation({ ...MATCH, code: "40001" })).toBe(false);
  });

  it("does not match a different constraint_name", () => {
    expect(isReopenFormationViolation({ ...MATCH, constraint_name: "some_other_check" })).toBe(false);
  });

  it("does not match a coincidentally-identical code+constraint_name from a DIFFERENT table (the exact audit-origin scenario V1-QA finding 4 named)", () => {
    expect(isReopenFormationViolation({ ...MATCH, table_name: "audit_logs" })).toBe(false);
  });

  it("does not match when table_name is absent entirely", () => {
    const { table_name, ...withoutTable } = MATCH;
    expect(isReopenFormationViolation(withoutTable)).toBe(false);
  });

  it("walks a cause chain to find the match at depth 2", () => {
    expect(isReopenFormationViolation({ cause: MATCH })).toBe(true);
  });

  it("refuses a cause chain deeper than the limit (4 iterations) even if the exact tuple sits just past it", () => {
    const deep = { cause: { cause: { cause: { cause: MATCH } } } }; // MATCH sits 4 .cause hops deep; only hops 0-3 are ever inspected
    expect(isReopenFormationViolation(deep)).toBe(false);
  });

  it("refuses a cyclical cause chain instead of looping forever", () => {
    const a: Record<string, unknown> = { code: "23514", constraint_name: "project_reopen_formation_not_verified", table_name: "projects" };
    a.cause = a; // self-reference
    expect(isReopenFormationViolation(a)).toBe(false);
  });

  it("a plain audit-insert-failure Error with no .code at all is never matched", () => {
    expect(isReopenFormationViolation(new Error("Audit insert failed for project.update"))).toBe(false);
  });

  it("null/undefined/non-object inputs are never matched", () => {
    expect(isReopenFormationViolation(null)).toBe(false);
    expect(isReopenFormationViolation(undefined)).toBe(false);
    expect(isReopenFormationViolation("a string error")).toBe(false);
  });

  it("an intermediate step with no .code still lets the walk continue to its own .cause", () => {
    expect(isReopenFormationViolation({ cause: { cause: MATCH } })).toBe(true);
  });
});
