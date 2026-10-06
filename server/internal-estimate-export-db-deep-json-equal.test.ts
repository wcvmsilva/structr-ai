/**
 * Pure unit tests for `deepJsonEqual` (QA V2.1 supplement item 1). No
 * database, no lab gate. The PRIOR hand-rolled canonicalization converted
 * every plain object into an array of sorted [key,value] pairs but left
 * real arrays untouched — so an object and the literal pairs-array
 * transform of that SAME object canonicalized to an IDENTICAL structure,
 * a real collision Michael proved physically against the retained-evidence
 * reader. These are the exact pairs that collision hinges on, plus the
 * control case (key-reordering must still compare equal) the correction
 * explicitly asked to preserve.
 */
import { describe, expect, it } from "vitest";
import { deepJsonEqual } from "./internal-estimate-export-db";

describe("deepJsonEqual — type-preserving JSON equality (QA V2.1 supplement item 1)", () => {
  it("rejects an object vs the literal pairs-array transform of that SAME object ({a:1} vs [[\"a\",1]])", () => {
    expect(deepJsonEqual({ a: 1 }, [["a", 1]])).toBe(false);
  });
  it("rejects an empty object vs an empty array ({} vs [])", () => {
    expect(deepJsonEqual({}, [])).toBe(false);
  });
  it("control: accepts two objects that are equal except for key order", () => {
    expect(deepJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it("accepts deeply nested equal structures regardless of key order at every level", () => {
    const left = { x: { a: 1, b: [1, 2, { c: 3, d: 4 }] } };
    const right = { x: { b: [1, 2, { d: 4, c: 3 }], a: 1 } };
    expect(deepJsonEqual(left, right)).toBe(true);
  });
  it("rejects arrays that differ only in element order (array order is significant)", () => {
    expect(deepJsonEqual([1, 2], [2, 1])).toBe(false);
  });
  it("distinguishes null from an empty object and from an empty array", () => {
    expect(deepJsonEqual(null, {})).toBe(false);
    expect(deepJsonEqual(null, [])).toBe(false);
  });
  it("accepts identical primitives and rejects differing ones", () => {
    expect(deepJsonEqual("a", "a")).toBe(true);
    expect(deepJsonEqual(1, 1)).toBe(true);
    expect(deepJsonEqual(true, true)).toBe(true);
    expect(deepJsonEqual("1", 1)).toBe(false);
  });
});
