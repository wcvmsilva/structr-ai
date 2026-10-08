/** Exercises the live page's formatter, action callbacks and detail paragraph.
 * TypeScript AST extraction avoids a copied implementation; this is not browser evidence. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { EXPORT_ISSUE_CODES, type ExportIssueCode } from "../shared/domain/taxonomy";
import { formatExportDeliveryBlockedMessage, parseExportDeliveryBlockedMessage } from "../shared/export-delivery-blocked-message";

const source = readFileSync(new URL("../client/src/pages/EstimateDetail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("EstimateDetail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map<string, ts.FunctionDeclaration>();
let detailParagraph: ts.JsxElement | undefined;
function visit(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "p"
    && node.getText(ast).includes("exportBlockMessage(exportDetail.validation.issues[0].code)")) detailParagraph = node;
  ts.forEachChild(node, visit);
}
visit(ast);
const messageDeclarations = ast.statements.filter(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => /_CODE_MESSAGES$/.test(declaration.name.getText(ast))))
  .map(statement => statement.getText(ast)).join("\n");
function liveFunction(name: string, scope: Record<string, unknown> = {}): any {
  const node = functions.get(name);
  if (!node) throw new Error(`Missing page function ${name}`);
  const js = ts.transpileModule(`${messageDeclarations}\n${node.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn ${name};`)(...Object.values(scope));
}
const message = liveFunction("exportBlockMessage") as (code: unknown) => unknown;
const generic = "This export attempt was blocked.";
const exportId = "ed600000-0000-4000-8000-000000000008";

// Each expectation names the actual reason the operator needs to distinguish.
const reasons: Record<ExportIssueCode, RegExp> = {
  INTERNAL_APPROVAL_REQUIRED: /no internal approval/i,
  INTERNAL_APPROVAL_REVOKED: /approval.*revoked/i,
  INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED: /legacy approval.*review/i,
  HISTORICAL_AUTHORITY_NOT_AVAILABLE: /not calculated/i,
  ESTIMATE_SUPERSEDED: /newer version/i,
  ESTIMATE_CLIENT_MISSING: /no linked client/i,
  ESTIMATE_CLIENT_CONTEXT_MISMATCH: /client context.*no longer matches/i,
  INTERNAL_APPROVAL_CONTENT_UNRESOLVED: /approved content.*not.*resolved/i,
  EXPORT_FORMAT_UNREPRESENTABLE: /format.*represent.*approved content/i,
  CSV_CLASSIFICATION_NOT_REVIEWED: /CSV.*classification.*review/i,
  CSV_TAXABLE_UNKNOWN: /CSV.*tax.*unknown/i,
  CSV_UNIT_UNREPRESENTABLE: /CSV.*unit.*represent/i,
  CSV_RATE_UNREPRESENTABLE: /CSV.*required rate.*exactly/i,
  CSV_LINE_IDENTITY_INVALID: /CSV.*line.*identit/i,
  CSV_COST_CODE_UNKNOWN: /CSV.*cost code.*unknown/i,
  CSV_COST_CODE_INVALID: /CSV.*cost code.*invalid/i,
  EXPORT_RENDERER_UNAVAILABLE: /format.*unavailable/i,
  EXPORT_PAYLOAD_TOO_LARGE: /file.*size limit/i,
  EXPORT_RECONCILIATION_MISMATCH: /export.*total.*match.*approved/i,
  EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED: /format.*represent.*approved commercial adjustment/i,
};

describe("Estimate export blocking reasons", () => {
  it.each(EXPORT_ISSUE_CODES)("explains %s using safe human-readable text", code => {
    expect(message(code)).toMatch(reasons[code]);
    expect(message(code)).not.toBe(generic);
    expect(message(code)).not.toContain(code);
  });

  it.each([null, undefined, "", "constructor", "toString", "__proto__", "SQL_SECRET <script>alert(1)</script>"])(
    "uses only the generic block message for unrecognized input %s", code => {
      expect(message(code)).toBe(generic);
    },
  );

  it("shows the CSV reason in the live authenticated attempt-detail paragraph", () => {
    if (!detailParagraph) throw new Error("Missing attempt-detail reason paragraph");
    const js = ts.transpileModule(`const paragraph = (${detailParagraph.getText(ast)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
    }).outputText;
    const paragraph = new Function("React", "exportDetail", "exportBlockMessage", `${js}\nreturn paragraph;`)(
      React, { validation: { issues: [{ code: "CSV_TAXABLE_UNKNOWN", lineKey: null, field: "taxable" }] } }, message,
    );
    const html = renderToStaticMarkup(paragraph);
    expect(html).toMatch(reasons.CSV_TAXABLE_UNKNOWN);
    expect(html).not.toContain("CSV_TAXABLE_UNKNOWN");
    expect(html).not.toContain(generic);
  });

  it.each(["runValidateCsv", "runExportPreflight"])("%s explains a persisted validation block without a success toast", name => {
    const toast = { warning: vi.fn(), success: vi.fn() };
    const mutate = vi.fn((_input: unknown, callbacks: { onSuccess: (value: unknown) => void }) => callbacks.onSuccess({
      outcome: "blocked", validation: { issues: [{ code: "CSV_COST_CODE_UNKNOWN" }] },
    }));
    liveFunction(name, { estimateReadOnly: false, toast, exportBlockMessage: message, estimateId: "draft-id", preflightFormat: "csv_jobtread",
      currentVisitRef: { current: { generation: 1 } }, isCurrentVisit: () => true,
      validateCsv: { mutate }, runPreflight: { mutate }, onExportError: vi.fn(),
    })();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(reasons.CSV_COST_CODE_UNKNOWN));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("preserves the blocked attempt identity while explaining a typed delivery failure", () => {
    const toast = { error: vi.fn() };
    const showError = liveFunction("showExportError", { toast, exportBlockMessage: message, parseExportDeliveryBlockedMessage });
    const result = showError(new Error(formatExportDeliveryBlockedMessage({ exportId, code: "CSV_RATE_UNREPRESENTABLE" })));
    expect(result).toBe(exportId);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(reasons.CSV_RATE_UNREPRESENTABLE));
    expect(toast.error.mock.calls[0][0]).not.toContain("EXPORT_DELIVERY_BLOCKED");
    expect(toast.error.mock.calls[0][0]).not.toContain(exportId);
  });
});
