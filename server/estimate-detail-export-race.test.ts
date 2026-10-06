/**
 * MICHAEL-A1-EXPORT-SURFACE-V2-QA-AND-CORRECTION.md item 3 (`client-callback-
 * probe.mjs`): the OLD `forContext(estimateId, apply)` pattern (reproduced
 * against commit `41106fd1`) proved a genuine TanStack Query race — dispatch
 * mutate(A), the page's context moves on to B before A's response arrives,
 * and the callback TanStack actually invokes is whichever `onSuccess` is
 * CURRENT as of the latest render (now bound to B), yet the closure-captured
 * "requested id" it compared against was ALSO always "whatever the latest
 * render captured" — so the guard was comparing "current" to "current" and
 * could never catch a genuinely stale response.
 *
 * MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 2 (Michael's
 * decision on Case 2): equal `estimateId` alone does NOT prove the response
 * belongs to the CURRENT visit — A→B→A is a NEW visit to A, and a request
 * dispatched during the ORIGINAL visit resolving after the return must still
 * be discarded. `EstimateDetail.tsx` now tracks a `visitGenerationRef`
 * incremented on every `estimateId` change (A→B and B→A are each one
 * increment) and compares the GENERATION captured at dispatch — via each
 * export action's own `run*` function, which calls `.mutate(input,
 * {onSuccess,onError})` with PER-CALL options bound to that one dispatch —
 * never the id alone, never a hook-level option TanStack would rebind.
 *
 * This is the PERMANENT regression test for that fix. `isCurrentVisit`,
 * `onExportError`, and `runExportPrintable` are extracted LIVE via TypeScript
 * AST from the real `.tsx` file at test-run time — never a hand-copied
 * snapshot — and executed against a REAL `@tanstack/query-core`
 * `MutationObserver` standing in for `deliverPrintable` (its own
 * `mutate(variables, options)` is the exact same per-call mechanism the real
 * mutation object uses under the hood).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { createHash } from "node:crypto";
import { parseDeliveredExport } from "../shared/internal-estimate-export-delivery";
import { buildExportFilename } from "../shared/internal-estimate-export-engine";

const ESTIMATE_DETAIL_PATH = path.resolve(__dirname, "../client/src/pages/EstimateDetail.tsx");
const fileText = readFileSync(ESTIMATE_DETAIL_PATH, "utf8");
const ast = ts.createSourceFile("EstimateDetail.tsx", fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const functionDeclarations = new Map<string, ts.FunctionDeclaration>();
function walk(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name) functionDeclarations.set(node.name.text, node);
  ts.forEachChild(node, walk);
}
walk(ast);
function requireFn(name: string): string {
  const found = functionDeclarations.get(name);
  if (!found) throw new Error(`${name} not found in EstimateDetail.tsx`);
  return found.getText(ast);
}
const isCurrentVisitSrc = requireFn("isCurrentVisit");
const onExportErrorSrc = requireFn("onExportError");
const runExportPrintableSrc = requireFn("runExportPrintable");

const combinedSource = `${isCurrentVisitSrc}\n${onExportErrorSrc}\n${runExportPrintableSrc}\nreturn runExportPrintable;`;
const transpiled = ts.transpileModule(combinedSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function buildRunExportPrintable(
  currentVisitRef: { current: { estimateId: string | null; generation: number } },
  deliverPrintable: { mutate: (variables: unknown, options: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void }) => unknown },
  estimateId: string,
  parseDeliveredExportFn: typeof parseDeliveredExport,
  setPrintableHtml: (html: string) => void,
  showExportErrorStub: (error: unknown) => string | null,
  setBlockedExportId: (exportId: string) => void,
): () => void {
  return new Function(
    "currentVisitRef", "deliverPrintable", "estimateId", "parseDeliveredExport", "setPrintableHtml", "showExportError", "setBlockedExportId",
    transpiled,
  )(currentVisitRef, deliverPrintable, estimateId, parseDeliveredExportFn, setPrintableHtml, showExportErrorStub, setBlockedExportId);
}

async function buildValidPrintableDelivery(estimateId: string, exportId: string) {
  const content = "<h1>Real printable content</h1>";
  const bytes = new TextEncoder().encode(content);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  const delivered = {
    exportId, estimateId,
    approvalId: "c1000000-0000-4000-8000-000000000003", snapshotId: "c1000000-0000-4000-8000-000000000004",
    contentHash: "b".repeat(64), artifactHash, format: "printable" as const,
    filename: buildExportFilename(estimateId, exportId, "printable"),
    mimeType: "text/html", encoding: "utf8" as const, byteLength: bytes.length, content,
  };
  // Confirms the fixture is genuinely valid BEFORE using it in the race — a
  // failure here would mean the race test below is proving nothing.
  await parseDeliveredExport(delivered);
  return delivered;
}

const ESTIMATE_A = "c1000000-0000-4000-8000-00000000000a";
const ESTIMATE_B = "c1000000-0000-4000-8000-00000000000b";

const req = createRequire(import.meta.url);
const queryCoreReq = createRequire(req.resolve("@tanstack/react-query"));
const { QueryClient, MutationObserver } = queryCoreReq("@tanstack/query-core");

describe("EstimateDetail runExportPrintable — real TanStack MutationObserver, live-extracted code", () => {
  it("applies the delivered content when the visit never changed (positive control)", async () => {
    const currentVisitRef = { current: { estimateId: ESTIMATE_A as string | null, generation: 1 } };
    const applied: string[] = [];
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let resolveResponse!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { resolveResponse = resolve; });
    const deliverPrintable = new MutationObserver(queryClient, { mutationFn: () => delayed });
    const unsubscribe = deliverPrintable.subscribe(() => {});
    const runExportPrintable = buildRunExportPrintable(
      currentVisitRef, deliverPrintable, ESTIMATE_A, parseDeliveredExport,
      (html) => applied.push(html), () => null, () => {},
    );
    const delivered = await buildValidPrintableDelivery(ESTIMATE_A, "c1000000-0000-4000-8000-000000000001");

    runExportPrintable();
    await Promise.resolve();
    resolveResponse(delivered);
    await new Promise((resolve) => setTimeout(resolve, 20)); // flush parseDeliveredExport's own async work (crypto.subtle)
    unsubscribe(); queryClient.clear();
    expect(applied).toEqual(["<h1>Real printable content</h1>"]);
  });

  it("discards a stale response that resolves after the visit moved on (the proven A→B race)", async () => {
    const currentVisitRef = { current: { estimateId: ESTIMATE_A as string | null, generation: 1 } };
    const applied: string[] = [];
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let resolveResponse!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { resolveResponse = resolve; });
    const deliverPrintable = new MutationObserver(queryClient, { mutationFn: () => delayed });
    const unsubscribe = deliverPrintable.subscribe(() => {});
    const runExportPrintable = buildRunExportPrintable(
      currentVisitRef, deliverPrintable, ESTIMATE_A, parseDeliveredExport,
      (html) => applied.push(html), () => null, () => {},
    );
    const deliveredForA = await buildValidPrintableDelivery(ESTIMATE_A, "c1000000-0000-4000-8000-000000000002");

    runExportPrintable(); // captures generation 1 (A) at dispatch
    await Promise.resolve();
    // The user has since navigated to a different estimate while A's request
    // was still in flight — the exact moment Michael's probe reproduced.
    currentVisitRef.current = { estimateId: ESTIMATE_B, generation: 2 };
    resolveResponse(deliveredForA);
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubscribe(); queryClient.clear();
    // Before the V2 fix: this would equal ["<h1>Real printable content</h1>"] —
    // A's content wrongly shown while the page had already moved to B.
    expect(applied).toEqual([]);
  });

  it("discards a stale response from the ORIGINAL visit to A even after returning to A (Michael's A→B→A decision, V3)", async () => {
    const currentVisitRef = { current: { estimateId: ESTIMATE_A as string | null, generation: 1 } };
    const applied: string[] = [];
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let resolveResponse!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { resolveResponse = resolve; });
    const deliverPrintable = new MutationObserver(queryClient, { mutationFn: () => delayed });
    const unsubscribe = deliverPrintable.subscribe(() => {});
    const runExportPrintable = buildRunExportPrintable(
      currentVisitRef, deliverPrintable, ESTIMATE_A, parseDeliveredExport,
      (html) => applied.push(html), () => null, () => {},
    );
    const deliveredForOriginalVisit = await buildValidPrintableDelivery(ESTIMATE_A, "c1000000-0000-4000-8000-000000000003");

    runExportPrintable(); // captures generation 1 — the ORIGINAL visit to A
    await Promise.resolve();
    currentVisitRef.current = { estimateId: ESTIMATE_B, generation: 2 }; // leaves to B
    currentVisitRef.current = { estimateId: ESTIMATE_A, generation: 3 }; // returns to A — a NEW visit, id equal, generation different
    resolveResponse(deliveredForOriginalVisit); // the ORIGINAL (generation 1) request finally resolves
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubscribe(); queryClient.clear();
    // Equal estimateId (A again) must NOT revalidate the old visit — the
    // content belongs to generation 1, the current visit is generation 3.
    expect(applied).toEqual([]);
  });

  it("applies a fresh dispatch made DURING the current visit to A, after a prior visit to A already came and went", async () => {
    const currentVisitRef = { current: { estimateId: ESTIMATE_A as string | null, generation: 3 } }; // already on the SECOND visit to A
    const applied: string[] = [];
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let resolveResponse!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { resolveResponse = resolve; });
    const deliverPrintable = new MutationObserver(queryClient, { mutationFn: () => delayed });
    const unsubscribe = deliverPrintable.subscribe(() => {});
    const runExportPrintable = buildRunExportPrintable(
      currentVisitRef, deliverPrintable, ESTIMATE_A, parseDeliveredExport,
      (html) => applied.push(html), () => null, () => {},
    );
    const delivered = await buildValidPrintableDelivery(ESTIMATE_A, "c1000000-0000-4000-8000-000000000004");

    runExportPrintable(); // captures generation 3 — the CURRENT (second) visit to A
    await Promise.resolve();
    resolveResponse(delivered); // resolves while still on generation 3 — genuinely current
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubscribe(); queryClient.clear();
    expect(applied).toEqual(["<h1>Real printable content</h1>"]);
  });
});
