/**
 * MICHAEL-A1-DECISION-CYCLE-V3-QA-AND-CORRECTION.md, two reproduced groups:
 *
 * 1. "Confirmation prior to the first review": the approve/create-version
 *    USD-confirmation checkbox and reason stay reachable while review data
 *    is still unavailable, and the fingerprint-sync effect only clears a
 *    stale confirmation when a NON-NULL prior fingerprint differs from the
 *    new one — so confirmation entered before the FIRST review ever
 *    arrived (prior fingerprint null) was never invalidated.
 * 2. "A→B→A visit round trip keeps the old intent": the visit-boundary
 *    effect resets export state on an estimateId change/unmount, but never
 *    touched decision dialogs/reason/confirmation/intent — returning to A
 *    with an identical fingerprint never triggers the per-dialog
 *    fingerprint-change effect, so a frozen intent/reason from before
 *    leaving survives.
 *
 * This extracts the REAL effect bodies and functions from
 * EstimateDetail.tsx via the TypeScript compiler API (no React/DOM mount —
 * these are plain closures over a synthetic scope standing in for the
 * component's state/refs), and evaluates each by name — not a copy of the
 * source re-typed into the test.
 */
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/pages/EstimateDetail.tsx", import.meta.url), "utf8");
const sf = ts.createSourceFile("EstimateDetail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function nodes(predicate: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  function walk(n: ts.Node) { if (predicate(n)) out.push(n); ts.forEachChild(n, walk); }
  walk(sf);
  return out;
}
function evaluate(node: ts.Node, scope: Record<string, unknown>) {
  const js = ts.transpileModule("const actual = (" + node.getText(sf) + ");", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), js + "\nreturn actual;")(...Object.values(scope));
}
function fn(name: string, s: Record<string, unknown>) {
  const n = nodes((n) => ts.isFunctionDeclaration(n) && n.name?.getText(sf) === name)[0];
  if (!n) throw new Error(`cannot find function ${name}`);
  return evaluate(n, s);
}
/** The one `useEffect` call whose body text includes `marker` — same
 * selection technique as the fingerprint-sync and visit-boundary effects
 * are each uniquely identifiable by a string only they contain. */
function effect(marker: string, s: Record<string, unknown>) {
  const n = nodes((n) => ts.isCallExpression(n) && n.expression.getText(sf) === "useEffect"
    && n.arguments[0]?.getText(sf).includes(marker))[0] as ts.CallExpression;
  if (!n) throw new Error(`cannot find useEffect containing ${marker}`);
  return evaluate(n.arguments[0], s);
}

function baseScope() {
  return {
    estimateId: "draft-A",
    currentVisitRef: { current: { estimateId: "draft-A", generation: 1 } },
    visitGenerationRef: { current: 1 },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    navigate: vi.fn(),
    setPrintableHtml: vi.fn(), setBlockedExportId: vi.fn(), setSelectedExportId: vi.fn(),
    approveOpen: true, approveReason: "Reason reviewed by user", approveUsdConfirmed: true,
    approveSeenFingerprintRef: { current: null as string | null },
    approveIntentRef: { current: null as { requestId: string } | null },
    approveReview: { contentHash: "hash-A", policyHash: "policy-A" } as any,
    setApproveOpen: vi.fn(), setApproveReason: vi.fn(), setApproveUsdConfirmed: vi.fn(),
    revokeOpen: true, revokeReason: "Reason reviewed by user",
    revokeIntentRef: { current: null as { requestId: string } | null },
    revokeSeenFingerprintRef: { current: null as string | null },
    setRevokeOpen: vi.fn(), setRevokeReason: vi.fn(),
    createVersionOpen: true, createVersionReason: "Reason reviewed by user", createVersionUsdConfirmed: true,
    createVersionSeenFingerprintRef: { current: null as string | null },
    createVersionIntentRef: { current: null as { requestId: string } | null },
    versionPreview: { sourceVersion: 1, sourceContentHash: "hash-A" } as any,
    setCreateVersionOpen: vi.fn(), setCreateVersionReason: vi.fn(), setCreateVersionUsdConfirmed: vi.fn(),
  };
}
/** Mirror each `set*` mock onto the matching scope property, same as the
 * component's own `useState` setter would. */
function wireSetters(s: ReturnType<typeof baseScope>) {
  (s.setApproveOpen as any).mockImplementation((v: boolean) => (s.approveOpen = v));
  (s.setApproveReason as any).mockImplementation((v: string) => (s.approveReason = v));
  (s.setApproveUsdConfirmed as any).mockImplementation((v: boolean) => (s.approveUsdConfirmed = v));
  (s.setRevokeOpen as any).mockImplementation((v: boolean) => (s.revokeOpen = v));
  (s.setRevokeReason as any).mockImplementation((v: string) => (s.revokeReason = v));
  (s.setCreateVersionOpen as any).mockImplementation((v: boolean) => (s.createVersionOpen = v));
  (s.setCreateVersionReason as any).mockImplementation((v: string) => (s.createVersionReason = v));
  (s.setCreateVersionUsdConfirmed as any).mockImplementation((v: boolean) => (s.createVersionUsdConfirmed = v));
  return Object.assign(s, {
    resetApproveIntent: fn("resetApproveIntent", s),
    resetRevokeIntent: fn("resetRevokeIntent", s),
    resetCreateVersionIntent: fn("resetCreateVersionIntent", s),
  });
}

describe("EstimateDetail.tsx real effects — A1 decision cycle V3.1 fixes", () => {
  it("approve: confirmation entered while review is unavailable does not survive its arrival", () => {
    const s = wireSetters(baseScope());
    s.approveReview = undefined;
    effect("approveSeenFingerprintRef", s)(); // dialog open, no review yet
    s.approveUsdConfirmed = true;
    s.approveReason = "Typed before seeing any reviewed content";
    s.approveReview = { contentHash: "hash-A", policyHash: "policy-A" };
    effect("approveSeenFingerprintRef", s)(); // review finally arrives
    expect(s.approveUsdConfirmed).toBe(false);
    expect(s.approveReason).toBe("");
  });

  it("createVersion: confirmation entered while preview is unavailable does not survive its arrival", () => {
    const s = wireSetters(baseScope());
    s.versionPreview = undefined;
    effect("createVersionSeenFingerprintRef", s)();
    s.createVersionUsdConfirmed = true;
    s.createVersionReason = "Typed before seeing any reviewed content";
    s.versionPreview = { sourceVersion: 1, sourceContentHash: "hash-A" };
    effect("createVersionSeenFingerprintRef", s)();
    expect(s.createVersionUsdConfirmed).toBe(false);
    expect(s.createVersionReason).toBe("");
  });

  it("approve: a genuine mid-review content change still clears confirmation (unchanged prior behavior)", () => {
    const s = wireSetters(baseScope());
    effect("approveSeenFingerprintRef", s)(); // first real sighting — must NOT clear what was already confirmed
    expect(s.approveUsdConfirmed).toBe(true);
    expect(s.approveReason).toBe("Reason reviewed by user");
    s.approveReview = { contentHash: "hash-B", policyHash: "policy-B" };
    effect("approveSeenFingerprintRef", s)();
    expect(s.approveUsdConfirmed).toBe(false);
    expect(s.approveReason).toBe("");
  });

  for (const [label, intentKey, reasonKey] of [
    ["approve", "approveIntentRef", "approveReason"],
    ["revoke", "revokeIntentRef", "revokeReason"],
    ["createVersion", "createVersionIntentRef", "createVersionReason"],
  ] as const) {
    it(`${label}: leaving the visit (A→B→A) ends the dialog's intent even when content is unchanged on return`, () => {
      const s = wireSetters(baseScope());
      (s as any)[intentKey].current = { requestId: "frozen-request-id" };
      const savedReason = (s as any)[reasonKey];

      const cleanupA = effect("visitGenerationRef.current", s)();
      cleanupA(); // leaving draft-A
      s.estimateId = "draft-B";
      const cleanupB = effect("visitGenerationRef.current", s)();
      cleanupB(); // leaving draft-B (its own query never landed)
      s.estimateId = "draft-A";
      effect("visitGenerationRef.current", s)(); // back on draft-A, identical content

      expect((s as any)[intentKey].current).toBe(null);
      expect((s as any)[reasonKey]).not.toBe(savedReason);
    });
  }
});
