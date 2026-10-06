/**
 * MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md item 5 — client-side
 * download validation/cleanup. Two complementary real proofs, neither a
 * shallow "buttons present in static HTML" check:
 *
 * 1. `downloadDeliveredExport` (client/src/pages/EstimateDetail.tsx) is
 *    extracted LIVE from the real file at test-run time (brace-matched
 *    source slice, transpiled with the project's own `typescript` package,
 *    evaluated with DOM/URL doubles) — never a hand-copied snapshot that
 *    could silently drift from the real function. Proves cleanup (anchor
 *    removal + objectURL revocation) now happens even when `anchor.click()`
 *    throws, via the `try/finally` the V2 fix added.
 * 2. `parseDeliveredExport` (shared/internal-estimate-export-delivery.ts) is
 *    imported for REAL (not extracted — it already is a plain importable
 *    module function) and fed the exact three malformed payloads Michael's
 *    probe reproduced against the OLD unvalidated path: a declared
 *    `byteLength` that doesn't match the actually decoded bytes, a MIME
 *    type/filename the format doesn't allow, and content over the 10 MiB
 *    response limit. `EstimateDetail.tsx`'s `validateAndDownload` calls this
 *    exact function before any Blob/download effect — proving IT rejects
 *    these payloads proves the real guard, not a copy of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createHash } from "node:crypto";
import { parseDeliveredExport } from "../shared/internal-estimate-export-delivery";

/** Balances the PARAMETER LIST's parens first (never mistaking a type
 * annotation's `{...}`, e.g. `delivered: { content: string; ... }`, for the
 * function body) before scanning for the body's own opening `{`. */
function extractFunctionSource(fileText: string, functionName: string): string {
  const signature = `function ${functionName}(`;
  const start = fileText.indexOf(signature);
  if (start === -1) throw new Error(`${functionName} not found in source`);
  let i = start + signature.length;
  let parenDepth = 1;
  while (parenDepth > 0) {
    if (fileText[i] === "(") parenDepth++;
    else if (fileText[i] === ")") parenDepth--;
    i++;
  }
  while (fileText[i] !== "{") i++;
  let depth = 1;
  i++;
  while (depth > 0) {
    if (fileText[i] === "{") depth++;
    else if (fileText[i] === "}") depth--;
    i++;
  }
  return fileText.slice(start, i);
}

const ESTIMATE_DETAIL_PATH = path.resolve(__dirname, "../client/src/pages/EstimateDetail.tsx");
const fileText = readFileSync(ESTIMATE_DETAIL_PATH, "utf8");
const downloadDeliveredExportSource = extractFunctionSource(fileText, "downloadDeliveredExport");
const transpiled = ts.transpileModule(downloadDeliveredExportSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

// MICHAEL-A1-EXPORT-SURFACE-V2-QA-AND-CORRECTION.md item 3 (last paragraph):
// `filename: "estimate.json"` is NOT a valid filename under the real pattern
// (`EST-<draftId>-<exportId>.<ext>`, proven by the control case below) — every
// negative test that only overrode ONE other field was silently also failing
// on this pre-existing invalid filename, so it never cleanly isolated the one
// dimension it claimed to test. The baseline itself must be a genuinely valid
// `DeliveredExport` (confirmed by the control case) so each "rejects X" test
// below proves X alone, by perturbing exactly one field off an otherwise-valid
// control.
const baseline = {
  exportId: "b1000000-0000-4000-8000-000000000001", estimateId: "b1000000-0000-4000-8000-000000000002",
  approvalId: "b1000000-0000-4000-8000-000000000003", snapshotId: "b1000000-0000-4000-8000-000000000004",
  contentHash: "a".repeat(64), format: "json" as const,
  filename: "EST-b1000000-0000-4000-8000-000000000002-b1000000-0000-4000-8000-000000000001.json",
  mimeType: "application/json", encoding: "utf8" as const, byteLength: 2, content: "{}",
};

describe("downloadDeliveredExport — extracted live from EstimateDetail.tsx", () => {
  function run(delivered: { content: string; encoding: "utf8" | "base64"; mimeType: string; filename: string }) {
    const events: string[] = [];
    const clickFails = true;
    const anchor = { click() { events.push("click"); throw new Error("synthetic click failure"); } };
    const document = { createElement() { return anchor; }, body: { appendChild() { events.push("append"); }, removeChild() { events.push("remove"); } } };
    const URL = { createObjectURL(blob: Blob) { events.push(`blob:${blob.size}:${blob.type}`); return "blob:synthetic"; }, revokeObjectURL() { events.push("revoke"); } };
    const setTimeout = (f: () => void) => { events.push("timer"); f(); };
    const fn = new Function("document", "URL", "setTimeout", "Blob", "TextEncoder", "atob", `${transpiled}\nreturn downloadDeliveredExport;`)(document, URL, setTimeout, globalThis.Blob, globalThis.TextEncoder, globalThis.atob);
    let error: string | null = null;
    try { fn(delivered); } catch (e) { error = (e as Error).message; }
    return { events, error };
  }

  it("cleans up (removes the anchor, revokes the objectURL) even when anchor.click() throws — the V2 try/finally fix", () => {
    const { events, error } = run(baseline);
    expect(error).toBe("synthetic click failure");
    // Before the fix: events stopped at "click" (no remove/timer/revoke) — a leaked
    // objectURL and a detached anchor still referencing it. After: cleanup always runs.
    expect(events).toEqual(["blob:2:application/json", "append", "click", "remove", "timer", "revoke"]);
  });
});

describe("parseDeliveredExport — the real guard validateAndDownload calls before any Blob/download effect", () => {
  function hashed(content: string) { return createHash("sha256").update(content).digest("hex"); }

  it("rejects a declared byteLength that doesn't match the actually decoded bytes", async () => {
    const bad = { ...baseline, artifactHash: hashed(baseline.content), byteLength: 1 };
    await expect(parseDeliveredExport(bad)).rejects.toBeDefined();
  });

  it("rejects a MIME type/filename the format doesn't allow", async () => {
    const bad = { ...baseline, artifactHash: hashed(baseline.content), mimeType: "image/svg+xml", filename: "../outside.svg" };
    await expect(parseDeliveredExport(bad)).rejects.toBeDefined();
  });

  it("rejects content over the 10 MiB decoded response limit", async () => {
    const content = "A".repeat(10_485_761);
    const bad = { ...baseline, content, artifactHash: hashed(content), byteLength: content.length };
    await expect(parseDeliveredExport(bad)).rejects.toBeDefined();
  });

  it("accepts a genuinely well-formed DeliveredExport (control case — the guard is not overbroad)", async () => {
    const good = { ...baseline, artifactHash: hashed(baseline.content) };
    await expect(parseDeliveredExport(good)).resolves.toBeDefined();
  });
});

/**
 * MICHAEL-A1-EXPORT-SURFACE-V2-QA-AND-CORRECTION.md item 3 (last paragraph):
 * the V2 report's own documented limitation was that `validateAndDownload`
 * (the function that actually calls `parseDeliveredExport` BEFORE
 * `downloadDeliveredExport`) was never exercised end-to-end, only proven "by
 * composition" (reading the code, each half tested separately). `async
 * function validateAndDownload` is extracted live the same way
 * `downloadDeliveredExport` already is above, then reconstructed with the
 * REAL imported `parseDeliveredExport` and the REAL (DOM-doubled) extracted
 * `downloadDeliveredExport` injected as its own two free identifiers —
 * composing three genuine pieces into one real call chain, never a hand-
 * written stand-in for either dependency.
 */
function extractAsyncFunctionSource(fileText: string, functionName: string): string {
  const signature = `async function ${functionName}(`;
  const start = fileText.indexOf(signature);
  if (start === -1) throw new Error(`${functionName} not found in source`);
  let i = start + signature.length;
  let parenDepth = 1;
  while (parenDepth > 0) {
    if (fileText[i] === "(") parenDepth++;
    else if (fileText[i] === ")") parenDepth--;
    i++;
  }
  while (fileText[i] !== "{") i++;
  let depth = 1;
  i++;
  while (depth > 0) {
    if (fileText[i] === "{") depth++;
    else if (fileText[i] === "}") depth--;
    i++;
  }
  return fileText.slice(start, i);
}
const validateAndDownloadSource = extractAsyncFunctionSource(fileText, "validateAndDownload");
const validateAndDownloadTranspiled = ts.transpileModule(validateAndDownloadSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function buildRealDownloadDeliveredExport(events: string[]) {
  const anchor = { click() { events.push("click"); } };
  const document = { createElement() { return anchor; }, body: { appendChild() { events.push("append"); }, removeChild() { events.push("remove"); } } };
  const URL = { createObjectURL(blob: Blob) { events.push(`blob:${blob.size}:${blob.type}`); return "blob:synthetic"; }, revokeObjectURL() { events.push("revoke"); } };
  const setTimeout = (f: () => void) => { events.push("timer"); f(); };
  return new Function("document", "URL", "setTimeout", "Blob", "TextEncoder", "atob", `${transpiled}\nreturn downloadDeliveredExport;`)(document, URL, setTimeout, globalThis.Blob, globalThis.TextEncoder, globalThis.atob);
}
function buildRealValidateAndDownload(downloadDeliveredExport: unknown) {
  return new Function("parseDeliveredExport", "downloadDeliveredExport", `${validateAndDownloadTranspiled}\nreturn validateAndDownload;`)(parseDeliveredExport, downloadDeliveredExport);
}

describe("validateAndDownload — real success path, real parser + real (DOM-doubled) downloader composed", () => {
  it("a genuinely valid DeliveredExport reaches the Blob/anchor effect", async () => {
    const events: string[] = [];
    const downloadDeliveredExport = buildRealDownloadDeliveredExport(events);
    const validateAndDownload = buildRealValidateAndDownload(downloadDeliveredExport);
    const good = { ...baseline, artifactHash: createHash("sha256").update(baseline.content).digest("hex") };
    await expect(validateAndDownload(good)).resolves.toBeUndefined();
    expect(events).toEqual(["blob:2:application/json", "append", "click", "remove", "timer", "revoke"]);
  });

  it("a malformed DeliveredExport rejects before any Blob/anchor effect runs", async () => {
    const events: string[] = [];
    const downloadDeliveredExport = buildRealDownloadDeliveredExport(events);
    const validateAndDownload = buildRealValidateAndDownload(downloadDeliveredExport);
    const bad = { ...baseline, artifactHash: createHash("sha256").update(baseline.content).digest("hex"), byteLength: 1 };
    await expect(validateAndDownload(bad)).rejects.toBeDefined();
    expect(events).toEqual([]); // zero download-side effects on a validation failure
  });
});
