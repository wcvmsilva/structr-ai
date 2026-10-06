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
 * This is the PERMANENT regression test for the fix applied to
 * `EstimateDetail.tsx` (`isCurrentEstimate`/`onExportError`/`deliverPrintable`
 * now compare the mutation's own per-dispatch `variables` argument — never a
 * closure — against the live `currentEstimateIdRef`). Both the extracted
 * functions and the real `@tanstack/query-core` `MutationObserver` are live:
 * nothing here is a hand-copied snapshot of either.
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
const variableDeclarations = new Map<string, ts.VariableDeclaration>();
function walk(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name) functionDeclarations.set(node.name.text, node);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) variableDeclarations.set(node.name.text, node);
  ts.forEachChild(node, walk);
}
walk(ast);

function requireFn<T extends ts.Node>(map: Map<string, T>, name: string): T {
  const found = map.get(name);
  if (!found) throw new Error(`${name} not found in EstimateDetail.tsx`);
  return found;
}
const isCurrentEstimateSrc = requireFn(functionDeclarations, "isCurrentEstimate").getText(ast);
const onExportErrorSrc = requireFn(functionDeclarations, "onExportError").getText(ast);
const deliverPrintableInit = requireFn(variableDeclarations, "deliverPrintable").initializer;
if (!deliverPrintableInit || !ts.isCallExpression(deliverPrintableInit)) throw new Error("deliverPrintable is not a call expression");
const optionsArg = deliverPrintableInit.arguments[0];
if (!ts.isObjectLiteralExpression(optionsArg)) throw new Error("deliverPrintable's useMutation argument is not an object literal");
const onSuccessProp = optionsArg.properties.find(
  (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "onSuccess",
);
if (!onSuccessProp) throw new Error("deliverPrintable has no onSuccess property");
const onSuccessSrc = onSuccessProp.initializer.getText(ast);

const combinedSource = `${isCurrentEstimateSrc}\n${onExportErrorSrc}\nconst handler = ${onSuccessSrc};\nreturn handler;`;
const transpiled = ts.transpileModule(combinedSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function buildPrintableOnSuccessHandler(
  currentEstimateIdRef: { current: string | null },
  parseDeliveredExportFn: typeof parseDeliveredExport,
  setPrintableHtml: (html: string) => void,
  showExportErrorStub: (error: unknown) => string | null,
  setBlockedExportId: (exportId: string) => void,
) {
  return new Function(
    "currentEstimateIdRef", "parseDeliveredExport", "setPrintableHtml", "showExportError", "setBlockedExportId",
    transpiled,
  )(currentEstimateIdRef, parseDeliveredExportFn, setPrintableHtml, showExportErrorStub, setBlockedExportId);
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

describe("EstimateDetail printable onSuccess — real TanStack MutationObserver, live-extracted callback", () => {
  it("applies the delivered content when the context never changed (positive control)", async () => {
    const ref = { current: ESTIMATE_A as string | null };
    const applied: string[] = [];
    const handler = buildPrintableOnSuccessHandler(ref, parseDeliveredExport, (html) => applied.push(html), () => null, () => {});
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let resolveResponse!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { resolveResponse = resolve; });
    const observer = new MutationObserver(queryClient, { mutationFn: () => delayed, onSuccess: handler });
    const unsubscribe = observer.subscribe(() => {});
    const delivered = await buildValidPrintableDelivery(ESTIMATE_A, "c1000000-0000-4000-8000-000000000001");
    const pending = observer.mutate({ id: ESTIMATE_A });
    await Promise.resolve();
    resolveResponse(delivered);
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 20)); // flush parseDeliveredExport's own async work (crypto.subtle)
    unsubscribe(); queryClient.clear();
    expect(applied).toEqual(["<h1>Real printable content</h1>"]);
  });

  it("discards a stale response that resolves after the context moved on (the proven A→B race)", async () => {
    const ref = { current: ESTIMATE_A as string | null };
    const applied: string[] = [];
    const handler = buildPrintableOnSuccessHandler(ref, parseDeliveredExport, (html) => applied.push(html), () => null, () => {});
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let resolveResponse!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { resolveResponse = resolve; });
    // Same handler instance kept across the "re-render" — mirrors the fix's
    // own property: the callback no longer closes over a per-render estimateId
    // at all, so it needs no rebuild when options are re-applied (unlike the
    // OLD `forContext(estimateId, apply)` currying, rebuilt fresh every render).
    const observer = new MutationObserver(queryClient, { mutationFn: () => delayed, onSuccess: handler });
    const unsubscribe = observer.subscribe(() => {});
    const deliveredForA = await buildValidPrintableDelivery(ESTIMATE_A, "c1000000-0000-4000-8000-000000000002");
    const pending = observer.mutate({ id: ESTIMATE_A });
    await Promise.resolve();
    // The user has since navigated to a different estimate while A's request
    // was still in flight — the exact moment Michael's probe reproduced.
    ref.current = ESTIMATE_B;
    observer.setOptions({ mutationFn: () => delayed, onSuccess: handler });
    resolveResponse(deliveredForA);
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubscribe(); queryClient.clear();
    // Before the fix: this would equal ["<h1>Real printable content</h1>"] —
    // A's content wrongly shown while the page had already moved to B.
    expect(applied).toEqual([]);
  });
});
