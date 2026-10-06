import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { withHistoricalLabPrerequisites } from "./test-support/ed-pilot-lab";

const historical = readFileSync(new URL("../drizzle/0005_historical_estimate_capture.sql", import.meta.url), "utf8");
const approval = readFileSync(new URL("../drizzle/0007_internal_estimate_approval_core.sql", import.meta.url), "utf8");
const functions = ["trim", "matches", "lookup_key", "pricing_channel", "channel", "snapshot_shape", "evaluation_shape", "valid_snapshot"];
const ddl = [
  'CREATE TABLE sample (report jsonb, state text, CHECK (public.historical_estimate_valid_reconciliation(report, state)), CHECK (public.internal_approval_valid_snapshot_v1(report, report) IS TRUE), CHECK (public.internal_approval_trim_v1(state) = state));',
  'ALTER TABLE sample ADD CONSTRAINT sample_fk FOREIGN KEY (state) REFERENCES parent (state);',
  'CREATE UNIQUE INDEX parent_identity ON parent (state);',
];

describe("A1 empty-schema laboratory prerequisites", () => {
  it("places every canonical pure dependency before the generated constraints, without replaying the migration", () => {
    const plan = withHistoricalLabPrerequisites(ddl, historical, approval);
    const names = plan.flatMap(statement => [...statement.matchAll(/CREATE FUNCTION public\.internal_approval_([a-z_]+)_v1\(/g)].map(match => match[1]));
    expect(names).toEqual(functions);
    expect(plan.findIndex(statement => statement.startsWith("CREATE TABLE sample"))).toBe(9);
    expect(plan.filter(statement => statement.startsWith("CREATE TABLE"))).toEqual([ddl[0]]);
    expect(plan.some(statement => /CREATE (?:CONSTRAINT )?TRIGGER|CREATE POLICY|\bGRANT\b|\bREVOKE\b|ALTER TABLE public\./.test(statement))).toBe(false);
    expect(plan.at(-1)).toBe(ddl[1]);
    expect(plan.indexOf(ddl[2])).toBeLessThan(plan.indexOf(ddl[1]));
  });
  it("fails before schema creation when the A1 migration is absent", () => {
    expect(() => withHistoricalLabPrerequisites(ddl, historical)).toThrow(/approval.*prerequisite/i);
  });
  it("fails before schema creation when any dependency is absent", () => {
    const missing = approval.replace("CREATE FUNCTION public.internal_approval_channel_v1(", "CREATE FUNCTION public.unrelated_channel_v1(");
    expect(() => withHistoricalLabPrerequisites(ddl, historical, missing)).toThrow(/approval.*prerequisite/i);
  });
  it("rejects duplicate canonical definitions", () => {
    expect(() => withHistoricalLabPrerequisites(ddl, historical, approval + "\n" + approval)).toThrow(/approval.*prerequisite/i);
  });
  it("does not install A1 functions when the generated schema has no A1 constraints", () => {
    expect(withHistoricalLabPrerequisites(["SELECT 1"], historical, approval)).toEqual(["SELECT 1"]);
  });
});
