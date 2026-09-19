import { describe, expect, it } from "vitest";
import { compareSchemaSnapshots } from "../scripts/migration-schema-compare";

const object = (kind = "column", name = "public.fixture.amount", definition: unknown = { type: "numeric(10,2)", nullable: false, default: null }) => ({ kind, name, definition });
const snapshot = (objects = [object()], complete = true) => ({ version: 1, complete, omissions: complete ? [] : ["external spatial dependency unavailable"], objects });

describe("structural schema reconciliation", () => {
  it("compares structure independently of object and definition-key ordering", () => {
    const a = snapshot([object(), object("table", "public.fixture", { rls: true, forceRls: false })]);
    const b = snapshot([object("table", "public.fixture", { forceRls: false, rls: true }), object("column", "public.fixture.amount", { default: null, nullable: false, type: "numeric(10,2)" })]);
    expect(compareSchemaSnapshots(a, b)).toMatchObject({ status: "equal", observedCount: 2, intendedCount: 2, matches: 2, differences: [], structuralEquality: true, migrationHistoryProven: false, deploymentAllowed: false });
  });
  it.each([
    ["column", { type: "integer" }], ["column", { default: "0" }], ["column", { nullable: true }],
    ["constraint", { deleteAction: "CASCADE", validated: true }], ["constraint", { validated: false }],
    ["index", { definition: "unique different expression" }], ["trigger", { enabled: "D" }],
    ["policy", { using: "true", roles: ["anon"] }], ["table", { rls: false, forceRls: false }],
    ["routine", { securityDefiner: true, searchPath: null }], ["extension", { version: "different" }],
    ["sequence", { increment: 2 }], ["view", { definition: "SELECT changed" }],
  ])("detects actual %s properties rather than accepting matching names", (kind, changed) => {
    const result = compareSchemaSnapshots(snapshot([object(kind as string)]), snapshot([object(kind as string, "public.fixture.amount", changed)]));
    expect(result).toMatchObject({ status: "different", matches: 0, structuralEquality: false });
    expect(result.differences).toEqual([{ kind, name: "public.fixture.amount", disposition: "changed" }]);
  });
  it("reports both observed-only and intended-only objects, sorted deterministically", () => {
    const result = compareSchemaSnapshots(snapshot([object("table", "public.old")]), snapshot([object("table", "public.new")]));
    expect(result.differences).toEqual([{ kind: "table", name: "public.new", disposition: "missing_from_observed" }, { kind: "table", name: "public.old", disposition: "only_in_observed" }]);
  });
  it("never certifies incomplete restoration even when all captured objects match", () => {
    expect(compareSchemaSnapshots(snapshot(undefined, false), snapshot())).toMatchObject({ status: "incomplete", matches: 1, structuralEquality: false, deploymentAllowed: false, observedComplete: false });
  });
  it("keeps ordering inside definitions significant for composite keys", () => {
    const result = compareSchemaSnapshots(snapshot([object("constraint", "public.fixture.key", { columns: ["a", "b"] })]), snapshot([object("constraint", "public.fixture.key", { columns: ["b", "a"] })]));
    expect(result.status).toBe("different");
  });
  it("does not publish SQL definitions or source literals in the result", () => {
    const result = compareSchemaSnapshots(snapshot([object("routine", "public.fixture()", { body: "PRIVATE_SQL_SENTINEL" })]), snapshot([]));
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SQL_SENTINEL");
    expect(result.observedFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    { version: 2, complete: true, omissions: [], objects: [] },
    { ...snapshot(), objects: [object(), object()] },
    { ...snapshot(), objects: [object("unsupported")] },
    { ...snapshot(), complete: true, omissions: ["missing dependencies"] },
    { ...snapshot(), objects: [object("table", "", {})] },
  ])("rejects malformed or internally contradictory catalog evidence", bad => {
    expect(() => compareSchemaSnapshots(bad, snapshot())).toThrow(/catalog snapshot/i);
  });
});
