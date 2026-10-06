/**
 * MICHAEL-A1-EXPORT-SURFACE-V4-QA-AND-CORRECTION.md (client lifecycle),
 * confirming the fix for the gap proven in two rounds of read-only QA
 * (dispatches `635340`/`81652e`, Michael's own complement
 * `a1-export-v4-michael-lifecycle-qa.test.ts`): the `useEffect(() => {...},
 * [estimateId])` that renews `visitGenerationRef`/`currentVisitRef` had NO
 * cleanup — nothing invalidated the ref on a real component UNMOUNT, only on
 * an `estimateId` change while still mounted. Michael's complement also
 * established the precise boundary: TanStack's own unsubscribe-on-unmount
 * DOES suppress a callback that has not started yet, but CANNOT stop one
 * already running and suspended inside its own `await` (parser or
 * otherwise) — unsubscribing only prevents FUTURE notifications, it cannot
 * cancel an already-detached promise chain. The generation bump added to
 * this effect's cleanup is what closes that second window.
 *
 * This is the PERMANENT regression test. All code under test is extracted
 * LIVE via TypeScript AST from the real `.tsx` file — never a hand-copied
 * snapshot — and exercised against a REAL `@tanstack/query-core`
 * `MutationObserver`, including calling its REAL `unsubscribe()`.
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

// ── Extract the [estimateId] effect's MAIN body and its CLEANUP separately ──
function findEstimateIdEffect(): ts.ArrowFunction | ts.FunctionExpression {
  let found: ts.ArrowFunction | ts.FunctionExpression | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect" &&
      node.arguments.length === 2 && ts.isArrayLiteralExpression(node.arguments[1]) &&
      node.arguments[1].elements.length === 1 && ts.isIdentifier(node.arguments[1].elements[0]) &&
      (node.arguments[1].elements[0] as ts.Identifier).text === "estimateId"
    ) {
      const callback = node.arguments[0];
      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) found = callback;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!found) throw new Error("useEffect(..., [estimateId]) not found");
  return found;
}
const estimateIdEffect = findEstimateIdEffect();
if (!estimateIdEffect.body || !ts.isBlock(estimateIdEffect.body)) throw new Error("effect body is not a block");
const effectReturn = estimateIdEffect.body.statements.find((s): s is ts.ReturnStatement => ts.isReturnStatement(s));
if (!effectReturn || !effectReturn.expression) throw new Error("the [estimateId] effect registers no cleanup — this test expects the V5 fix to be present");
const cleanupFn = effectReturn.expression;
if (!ts.isArrowFunction(cleanupFn) && !ts.isFunctionExpression(cleanupFn)) throw new Error("effect cleanup is not a function expression");
const effectMainStatements = estimateIdEffect.body.statements.filter(s => !ts.isReturnStatement(s)).map(s => s.getText(ast)).join("\n");
const effectCleanupSrc = cleanupFn.getText(ast);

function transpile(src: string): string {
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

/** Runs the effect's extracted MAIN body against injected
 * `visitGenerationRef`/`currentVisitRef`/`estimateId`/state setters — mirrors
 * what React runs on mount/dependency-change. */
function runEffectMain(visitGenerationRef: { current: number }, currentVisitRef: { current: unknown }, estimateId: string) {
  const body = `
const setPrintableHtml = () => {};
const setBlockedExportId = () => {};
const setSelectedExportId = () => {};
${effectMainStatements}
`;
  new Function("visitGenerationRef", "currentVisitRef", "estimateId", transpile(body))(visitGenerationRef, currentVisitRef, estimateId);
}
/** Builds the extracted CLEANUP as a real callable function — mirrors what
 * React runs on unmount (or before re-running the effect). The cleanup also
 * ends every open decision dialog now (MICHAEL-A1-DECISION-CYCLE-V3-QA-AND-
 * CORRECTION.md group 2) — this file's own concern is the generation bump,
 * so the added dependencies are injected as harmless no-ops here, not
 * re-verified (that is `a1-decision-cycle-client-effects.test.ts`'s job). */
function buildEffectCleanup(visitGenerationRef: { current: number }, currentVisitRef: { current: unknown }) {
  const noop = () => {};
  return new Function(
    "visitGenerationRef", "currentVisitRef",
    "setApproveOpen", "resetApproveIntent", "setRevokeOpen", "resetRevokeIntent", "setCreateVersionOpen", "resetCreateVersionIntent",
    `const cleanup = ${transpile(effectCleanupSrc)};\nreturn cleanup;`,
  )(visitGenerationRef, currentVisitRef, noop, noop, noop, noop, noop, noop);
}

const isCurrentVisitSrc = requireFn("isCurrentVisit");
const onExportErrorSrc = requireFn("onExportError");
const validateAndDownloadSrc = (() => {
  const signature = "async function validateAndDownload(";
  const start = fileText.indexOf(signature);
  let i = start + signature.length, depth = 1;
  while (depth > 0) { if (fileText[i] === "(") depth++; else if (fileText[i] === ")") depth--; i++; }
  while (fileText[i] !== "{") i++;
  let braceDepth = 1; i++;
  while (braceDepth > 0) { if (fileText[i] === "{") braceDepth++; else if (fileText[i] === "}") braceDepth--; i++; }
  return fileText.slice(start, i);
})();
const runExportPdfSrc = requireFn("runExportPdf");
const runExportPrintableSrc = requireFn("runExportPrintable");

function buildHandlers(opts: {
  currentVisitRef: { current: { estimateId: string | null; generation: number } };
  estimateId: string;
  deliverExport: { mutate: (v: unknown, o: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void }) => unknown };
  deliverPrintable: { mutate: (v: unknown, o: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void }) => unknown };
  downloadDeliveredExport: (d: unknown) => void;
  setPrintableHtml: (html: string) => void;
  showExportError: (error: unknown) => string | null;
  setBlockedExportId: (exportId: string) => void;
  parseDeliveredExportOverride: typeof parseDeliveredExport;
}) {
  const combined = `
${isCurrentVisitSrc}
${onExportErrorSrc}
${validateAndDownloadSrc}
${runExportPdfSrc}
${runExportPrintableSrc}
return { runExportPdf, runExportPrintable };
`;
  const factory = new Function(
    "currentVisitRef", "estimateId", "deliverExport", "deliverPrintable", "redownload", "parseDeliveredExport",
    "downloadDeliveredExport", "setPrintableHtml", "showExportError", "setBlockedExportId",
    transpile(combined),
  );
  return factory(
    opts.currentVisitRef, opts.estimateId, opts.deliverExport, opts.deliverPrintable, opts.deliverExport,
    opts.parseDeliveredExportOverride, opts.downloadDeliveredExport, opts.setPrintableHtml, opts.showExportError, opts.setBlockedExportId,
  );
}

function buildDownloadDoubles() {
  const events: string[] = [];
  const anchor = { click() { events.push("click"); } };
  const document = { createElement() { return anchor; }, body: { appendChild() { events.push("append"); }, removeChild() { events.push("remove"); } } };
  const URL = { createObjectURL(blob: Blob) { events.push(`blob:${blob.size}:${blob.type}`); return "blob:synthetic"; }, revokeObjectURL() { events.push("revoke"); } };
  const setTimeout = (f: () => void) => { events.push("timer"); f(); };
  const signature = "function downloadDeliveredExport(";
  const start = fileText.indexOf(signature);
  let i = start + signature.length, depth = 1;
  while (depth > 0) { if (fileText[i] === "(") depth++; else if (fileText[i] === ")") depth--; i++; }
  while (fileText[i] !== "{") i++;
  let braceDepth = 1; i++;
  while (braceDepth > 0) { if (fileText[i] === "{") braceDepth++; else if (fileText[i] === "}") braceDepth--; i++; }
  const src = fileText.slice(start, i);
  const downloadDeliveredExport = new Function(
    "document", "URL", "setTimeout", "Blob", "TextEncoder", "atob", `${transpile(src)}\nreturn downloadDeliveredExport;`,
  )(document, URL, setTimeout, globalThis.Blob, globalThis.TextEncoder, globalThis.atob);
  return { events, downloadDeliveredExport };
}

function makeControllableGate() {
  let resolveGate!: () => void;
  let entered = false;
  const gate = new Promise<void>((r) => { resolveGate = r; });
  const wrap = (real: typeof parseDeliveredExport) => async (value: unknown) => { entered = true; await gate; return real(value); };
  return { wrap, resolveGate: () => resolveGate(), get entered() { return entered; } };
}

async function buildValidDelivery(estimateId: string, exportId: string, format: "json" | "printable" = "json") {
  const content = format === "json" ? "{}" : "<h1>QA content</h1>";
  const bytes = new TextEncoder().encode(content);
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  const delivered = {
    exportId, estimateId,
    approvalId: "a1000000-0000-4000-8000-000000000003", snapshotId: "a1000000-0000-4000-8000-000000000004",
    contentHash: "c".repeat(64), artifactHash, format,
    filename: buildExportFilename(estimateId, exportId, format),
    mimeType: format === "json" ? "application/json" : "text/html", encoding: "utf8" as const, byteLength: bytes.length, content,
  };
  await parseDeliveredExport(delivered);
  return delivered;
}

const req = createRequire(import.meta.url);
const queryCoreReq = createRequire(req.resolve("@tanstack/react-query"));
const { QueryClient, MutationObserver } = queryCoreReq("@tanstack/query-core");

function buildObserverStub(mutationFn: () => Promise<unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const observer = new MutationObserver(queryClient, { mutationFn });
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe, clear: () => queryClient.clear() };
}

const ESTIMATE_A = "a1000000-0000-4000-8000-00000000000a";

describe("EstimateDetail [estimateId] effect — now has a cleanup (V5 fix)", () => {
  it("the cleanup bumps the generation and clears the visit's estimateId", () => {
    const visitGenerationRef = { current: 0 };
    const currentVisitRef: { current: { estimateId: string | null; generation: number } } = { current: { estimateId: null, generation: 0 } };
    runEffectMain(visitGenerationRef, currentVisitRef, ESTIMATE_A);
    expect(currentVisitRef.current).toEqual({ estimateId: ESTIMATE_A, generation: 1 });
    const cleanup = buildEffectCleanup(visitGenerationRef, currentVisitRef) as () => void;
    cleanup();
    expect(currentVisitRef.current.generation).toBe(2);
    expect(currentVisitRef.current.estimateId).toBeNull();
  });
});

describe("EstimateDetail lifecycle — a callback already suspended inside the parser survives a REAL unsubscribe (TanStack's own mechanism cannot help here)", () => {
  it("pdf: real unsubscribe while suspended in the parser does NOT stop the download — only the cleanup's generation bump does", async () => {
    const visitGenerationRef = { current: 0 };
    const currentVisitRef: { current: { estimateId: string | null; generation: number } } = { current: { estimateId: null, generation: 0 } };
    runEffectMain(visitGenerationRef, currentVisitRef, ESTIMATE_A); // "mount"
    const { events, downloadDeliveredExport } = buildDownloadDoubles();
    const gate = makeControllableGate();
    const delivered = await buildValidDelivery(ESTIMATE_A, "a1000000-0000-4000-8000-000000000001", "json");
    const { observer: deliverExport, unsubscribe, clear } = buildObserverStub(async () => delivered);
    const handlers = buildHandlers({
      currentVisitRef, estimateId: ESTIMATE_A, deliverExport, deliverPrintable: deliverExport,
      downloadDeliveredExport, setPrintableHtml: () => {}, showExportError: () => null, setBlockedExportId: () => {},
      parseDeliveredExportOverride: gate.wrap(parseDeliveredExport),
    });
    (handlers.runExportPdf as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gate.entered).toBe(true); // genuinely suspended inside the parser, not "hasn't started"
    expect(events).toEqual([]);
    unsubscribe(); // the REAL TanStack unsubscribe — confirmed insufficient alone
    gate.resolveGate();
    await new Promise((resolve) => setTimeout(resolve, 20));
    clear();
    expect(events).toEqual(["blob:2:application/json", "append", "click", "remove", "timer", "revoke"]);
  });

  it("pdf: the SAME sequence, but the effect's cleanup (unmount) ALSO runs before releasing the gate — now correctly suppressed (the V5 fix)", async () => {
    const visitGenerationRef = { current: 0 };
    const currentVisitRef: { current: { estimateId: string | null; generation: number } } = { current: { estimateId: null, generation: 0 } };
    runEffectMain(visitGenerationRef, currentVisitRef, ESTIMATE_A);
    const { events, downloadDeliveredExport } = buildDownloadDoubles();
    const gate = makeControllableGate();
    const delivered = await buildValidDelivery(ESTIMATE_A, "a1000000-0000-4000-8000-000000000002", "json");
    const { observer: deliverExport, unsubscribe, clear } = buildObserverStub(async () => delivered);
    const handlers = buildHandlers({
      currentVisitRef, estimateId: ESTIMATE_A, deliverExport, deliverPrintable: deliverExport,
      downloadDeliveredExport, setPrintableHtml: () => {}, showExportError: () => null, setBlockedExportId: () => {},
      parseDeliveredExportOverride: gate.wrap(parseDeliveredExport),
    });
    (handlers.runExportPdf as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gate.entered).toBe(true);
    expect(events).toEqual([]);
    unsubscribe();
    const cleanup = buildEffectCleanup(visitGenerationRef, currentVisitRef) as () => void;
    cleanup(); // real component unmount — the SAME cleanup React would run
    gate.resolveGate();
    await new Promise((resolve) => setTimeout(resolve, 20));
    clear();
    expect(events).toEqual([]); // correctly suppressed now
  });

  it("error during the parser: real unsubscribe alone does NOT stop the toast; the cleanup's generation bump does", async () => {
    const visitGenerationRef = { current: 0 };
    const currentVisitRef: { current: { estimateId: string | null; generation: number } } = { current: { estimateId: null, generation: 0 } };
    runEffectMain(visitGenerationRef, currentVisitRef, ESTIMATE_A);
    const toastCalls: unknown[] = [];
    const { downloadDeliveredExport } = buildDownloadDoubles();
    let enteredParser = false;
    let rejectGate!: (error: unknown) => void;
    const gatedParser = async (_value: unknown) => {
      enteredParser = true;
      return new Promise((_resolve, reject) => { rejectGate = reject; });
    };
    // The network round trip genuinely succeeds — it is the PARSER that will
    // reject this malformed-shaped payload, never the mutation itself.
    const { observer: deliverExport, unsubscribe, clear } = buildObserverStub(async () => ({ content: "<h1>UNVALIDATED</h1>" }));
    const handlers = buildHandlers({
      currentVisitRef, estimateId: ESTIMATE_A, deliverExport, deliverPrintable: deliverExport,
      downloadDeliveredExport, setPrintableHtml: () => {}, showExportError: (error) => { toastCalls.push(error); return null; }, setBlockedExportId: () => {},
      parseDeliveredExportOverride: gatedParser as unknown as typeof parseDeliveredExport,
    });
    (handlers.runExportPdf as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(enteredParser).toBe(true);
    expect(toastCalls).toEqual([]);
    unsubscribe(); // real unsubscribe ALONE, no cleanup yet
    rejectGate(new Error("INTERNAL_APPROVAL_INTEGRITY_ERROR"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    clear();
    expect(toastCalls.length).toBe(1); // still fires — unsubscribe alone is insufficient here too
  });

  it("error during the parser: the SAME sequence, with the effect's cleanup ALSO run before rejecting — now correctly suppressed", async () => {
    const visitGenerationRef = { current: 0 };
    const currentVisitRef: { current: { estimateId: string | null; generation: number } } = { current: { estimateId: null, generation: 0 } };
    runEffectMain(visitGenerationRef, currentVisitRef, ESTIMATE_A);
    const toastCalls: unknown[] = [];
    const { downloadDeliveredExport } = buildDownloadDoubles();
    let enteredParser = false;
    let rejectGate!: (error: unknown) => void;
    const gatedParser = async (_value: unknown) => {
      enteredParser = true;
      return new Promise((_resolve, reject) => { rejectGate = reject; });
    };
    const { observer: deliverExport, unsubscribe, clear } = buildObserverStub(async () => ({ content: "<h1>UNVALIDATED</h1>" }));
    const handlers = buildHandlers({
      currentVisitRef, estimateId: ESTIMATE_A, deliverExport, deliverPrintable: deliverExport,
      downloadDeliveredExport, setPrintableHtml: () => {}, showExportError: (error) => { toastCalls.push(error); return null; }, setBlockedExportId: () => {},
      parseDeliveredExportOverride: gatedParser as unknown as typeof parseDeliveredExport,
    });
    (handlers.runExportPdf as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(enteredParser).toBe(true);
    expect(toastCalls).toEqual([]);
    unsubscribe();
    const cleanup = buildEffectCleanup(visitGenerationRef, currentVisitRef) as () => void;
    cleanup();
    rejectGate(new Error("INTERNAL_APPROVAL_INTEGRITY_ERROR"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    clear();
    expect(toastCalls).toEqual([]); // correctly suppressed now
  });

  it("printable: same two-step proof — unsubscribe alone insufficient, cleanup's generation bump closes it", async () => {
    const visitGenerationRef = { current: 0 };
    const currentVisitRef: { current: { estimateId: string | null; generation: number } } = { current: { estimateId: null, generation: 0 } };
    runEffectMain(visitGenerationRef, currentVisitRef, ESTIMATE_A);
    const applied: string[] = [];
    const gate = makeControllableGate();
    const delivered = await buildValidDelivery(ESTIMATE_A, "a1000000-0000-4000-8000-000000000003", "printable");
    const { observer: deliverPrintable, unsubscribe, clear } = buildObserverStub(async () => delivered);
    const handlers = buildHandlers({
      currentVisitRef, estimateId: ESTIMATE_A, deliverExport: deliverPrintable, deliverPrintable,
      downloadDeliveredExport: () => {}, setPrintableHtml: (html) => applied.push(html), showExportError: () => null, setBlockedExportId: () => {},
      parseDeliveredExportOverride: gate.wrap(parseDeliveredExport),
    });
    (handlers.runExportPrintable as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gate.entered).toBe(true);
    expect(applied).toEqual([]);
    unsubscribe();
    const cleanup = buildEffectCleanup(visitGenerationRef, currentVisitRef) as () => void;
    cleanup();
    gate.resolveGate();
    await new Promise((resolve) => setTimeout(resolve, 20));
    clear();
    expect(applied).toEqual([]); // correctly suppressed — this is the exact case Michael's complement flagged as unproven in the original QA, now a permanent proof of the FIX
  });

  it("control: unsubscribing BEFORE the mutation itself resolves (callback never started) is already sufficient on its own — the fix adds the LATER window, not a replacement for this one", async () => {
    const visitGenerationRef = { current: 0 };
    const currentVisitRef: { current: { estimateId: string | null; generation: number } } = { current: { estimateId: null, generation: 0 } };
    runEffectMain(visitGenerationRef, currentVisitRef, ESTIMATE_A);
    const applied: string[] = [];
    let resolveMutation!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveMutation = resolve; });
    const { observer: deliverPrintable, unsubscribe, clear } = buildObserverStub(() => pending as Promise<unknown>);
    const handlers = buildHandlers({
      currentVisitRef, estimateId: ESTIMATE_A, deliverExport: deliverPrintable, deliverPrintable,
      downloadDeliveredExport: () => {}, setPrintableHtml: (html) => applied.push(html), showExportError: () => null, setBlockedExportId: () => {},
      parseDeliveredExportOverride: parseDeliveredExport,
    });
    (handlers.runExportPrintable as () => void)();
    unsubscribe(); // BEFORE the mutation resolves — no generation bump needed here
    const delivered = await buildValidDelivery(ESTIMATE_A, "a1000000-0000-4000-8000-000000000004", "printable");
    resolveMutation(delivered);
    await new Promise((resolve) => setTimeout(resolve, 20));
    clear();
    expect(applied).toEqual([]); // TanStack's own mechanism already covers this earlier window
  });
});
