/**
 * PHASE 1 — Route guard coverage (structural test)
 *
 * The guard is only worth as much as its coverage. This test reads the router
 * sources and asserts that every procedure receiving a project-scoped identifier
 * actually calls the guard.
 *
 * Why a source-level test: a per-procedure integration test would require a live
 * database and would still miss a *newly added* unguarded route. This test fails
 * the build the moment someone adds `projectId` to a router without a guard, which
 * is the failure mode that matters.
 *
 * Maintenance contract: if a procedure legitimately needs no guard (admin-only
 * catalog operations, aggregate dashboards), add its router to
 * `ROUTERS_WITHOUT_PROJECT_SCOPE` with a reason.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

/** Identifiers that mean "this operation touches a specific project's data". */
const SCOPED_ID_PATTERN =
  /\b(projectId|drawingId|scopeDraftId|scopeSourceId|estimateDraftId|intakeFormId|rfiId|revisionId)\b/;

/** The guard entry points exported by server/project-access.ts. */
const GUARD_PATTERN =
  /\b(requireProjectAccess|requireProjectAccessTrpc|requireEntityAccess|canAccessProject|assertEstimateDraftAccess)\b/;

/**
 * Routers that receive scoped ids but intentionally do not guard, with the reason.
 * Empty by design: every such router was reviewed during Phase 1.
 */
const ROUTERS_WITHOUT_PROJECT_SCOPE: Record<string, string> = {};

function routerFiles(): string[] {
  return readdirSync(SERVER_DIR)
    .filter(f => f.endsWith("-router.ts") && !f.endsWith(".test.ts"))
    .sort();
}

function read(file: string): string {
  return readFileSync(join(SERVER_DIR, file), "utf8");
}

/**
 * ADR-003 delegates this exact pair of contextual branches to the isolated executor.
 * Parse executable syntax: comments, an unused import, or a call on the other branch
 * cannot satisfy the inventory. Runtime authority remains covered by the route and
 * physical integration suites; this detector prevents silently widening that surface.
 */
function calculatorGuardInventory(file: string, src: string) {
  const tree = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imported = (name: string, module: string) => tree.statements.some(statement =>
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === module && !statement.importClause?.isTypeOnly &&
    statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
    statement.importClause.namedBindings.elements.some(element => !element.isTypeOnly &&
      element.name.text === name && (element.propertyName?.text ?? element.name.text) === name));
  const identifier = (node: ts.Node | undefined, name: string): boolean =>
    !!node && ts.isIdentifier(node) && node.text === name;
  const call = (node: ts.Node | undefined, name: string): node is ts.CallExpression =>
    !!node && ts.isCallExpression(node) && identifier(node.expression, name);
  const method = (node: ts.Node | undefined, name: string): ts.CallExpression | undefined =>
    node && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name ? node : undefined;
  const declaration = (name: string) => tree.statements.flatMap(statement =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find(value => identifier(value.name, name));
  let invokesBoundary = false;
  const inspectCalls = (node: ts.Node) => { if (call(node, "callFinancialCalculator")) invokesBoundary = true; ts.forEachChild(node, inspectCalls); };
  inspectCalls(tree);
  const boundaryImported = imported("callFinancialCalculator", "./financial-calculator-client");
  const wrongImport = invokesBoundary && !boundaryImported;
  const routerDeclaration = declaration("assemblyRouter");
  const routerCall = routerDeclaration?.initializer;
  if (file !== "assembly-router.ts" || !call(routerCall, "router") || !ts.isObjectLiteralExpression(routerCall.arguments[0])) return { covered: false, wrongImport };
  const properties = routerCall.arguments[0].properties;
  const property = (name: string) => properties.find(value => ts.isPropertyAssignment(value) && identifier(value.name, name)) as ts.PropertyAssignment | undefined;
  const list = property("list"), batch = property("calculateBatch"), listSchema = declaration("calculatorListSchema");
  if (!list || !batch || !listSchema || !boundaryImported ||
      !imported("financialCalculatorRouteInput", "./financial-calculator-client") ||
      !imported("protectedProcedure", "./_core/trpc") || !imported("router", "./_core/trpc") ||
      !imported("calculatorCalculateCommandSchema", "../shared/financial-calculator-engine")) return { covered: false, wrongImport };

  function contextualBranch(value: ts.PropertyAssignment, schema: string, legacy: string, marker: string, discriminant: string, listMode: boolean): boolean {
    const query = method(value.initializer, "query");
    if (!query || !ts.isPropertyAccessExpression(query.expression)) return false;
    const input = method(query.expression.expression, "input");
    if (!input || !ts.isPropertyAccessExpression(input.expression) || !identifier(input.expression.expression, "protectedProcedure")) return false;
    const selector = input.arguments[0];
    if (!call(selector, "financialCalculatorRouteInput") || selector.arguments.length !== 3 ||
        !identifier(selector.arguments[0], schema) || !identifier(selector.arguments[1], legacy) ||
        !ts.isStringLiteral(selector.arguments[2]) || selector.arguments[2].text !== marker) return false;
    const callback = query.arguments[0];
    if (!callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) return false;
    const branch = callback.body.statements[0];
    if (!branch || !ts.isIfStatement(branch) || branch.elseStatement) return false;
    let condition = branch.expression;
    if (listMode) {
      if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || !identifier(condition.left, "input")) return false;
      condition = condition.right;
    }
    if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.InKeyword ||
        !ts.isStringLiteral(condition.left) || condition.left.text !== discriminant || !identifier(condition.right, "input")) return false;
    const returned = branch.thenStatement;
    if (!ts.isReturnStatement(returned) || !call(returned.expression, "callFinancialCalculator") ||
        returned.expression.arguments.length !== 2 || !identifier(returned.expression.arguments[0], "ctx")) return false;
    if (!listMode) return identifier(returned.expression.arguments[1], "input");
    const command = returned.expression.arguments[1];
    if (!ts.isObjectLiteralExpression(command)) return false;
    return ["projectId", "intakeFormId"].every(name => command.properties.some(field =>
      ts.isPropertyAssignment(field) && identifier(field.name, name) && ts.isPropertyAccessExpression(field.initializer) &&
      identifier(field.initializer.expression, "input") && field.initializer.name.text === name));
  }
  if (!contextualBranch(list, "calculatorListSchema", "assemblyFilterSchema", "mode", "mode", true) ||
      !contextualBranch(batch, "calculatorCalculateCommandSchema", "calculateBatchSchema", "contractVersion", "operation", false)) return { covered: false, wrongImport };

  // All scoped identifiers and nominal schema/helper references must stay inside
  // these two procedures or their one local pair schema. A third route is not covered.
  const nominalNames = new Set(["calculatorListSchema", "calculatorCalculateCommandSchema", "financialCalculatorRouteInput", "callFinancialCalculator"]);
  const allowed = new Set<ts.Node>([list, batch, listSchema]);
  let uncovered = false;
  const visit = (node: ts.Node) => {
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && (SCOPED_ID_PATTERN.test(node.text) || nominalNames.has(node.text))) {
      let ancestor: ts.Node | undefined = node;
      while (ancestor && !allowed.has(ancestor) && !ts.isImportDeclaration(ancestor)) ancestor = ancestor.parent;
      if (!ancestor) uncovered = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { covered: !uncovered, wrongImport };
}

/** Structural inventory result; runtime authorization is covered by route/physical tests. */
function routeGuardIssues(file: string, src: string): string[] {
  const issues: string[] = [];
  const nominal = calculatorGuardInventory(file, src);
  const guarded = file === "assembly-router.ts" ? nominal.covered : GUARD_PATTERN.test(src);
  if (SCOPED_ID_PATTERN.test(src) && !(file in ROUTERS_WITHOUT_PROJECT_SCOPE) && !guarded) issues.push("missing-project-guard");
  if (nominal.wrongImport || (GUARD_PATTERN.test(src) && !/from\s+"\.\/project-access"/.test(src))) issues.push("wrong-guard-import");
  return issues;
}

describe("PHASE 1: route guard coverage", () => {
  const files = routerFiles();

  it("finds the router files to audit", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("guards every router that receives a project-scoped identifier", () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const src = read(file);
      if (routeGuardIssues(file, src).includes("missing-project-guard")) unguarded.push(file);
    }

    expect(unguarded).toEqual([]);
  });

  it("imports the guard from the single chokepoint module", () => {
    const wrongImport: string[] = [];

    for (const file of files) {
      const src = read(file);
      if (routeGuardIssues(file, src).includes("wrong-guard-import")) wrongImport.push(file);
    }

    expect(wrongImport).toEqual([]);
  });

  it("guards the drawing and RFI routers specifically (highest-risk data)", () => {
    for (const file of ["drawing-router.ts", "rfi-router.ts", "scope-source-router.ts"]) {
      const src = read(file);
      expect(GUARD_PATTERN.test(src), `${file} must call the project access guard`).toBe(
        true,
      );
    }
  });

  it("keeps the guard chokepoint free of router-specific logic", () => {
    const guardSrc = readFileSync(join(SERVER_DIR, "project-access.ts"), "utf8");
    // The guard must not import routers (would create a cycle and hide policy).
    expect(guardSrc).not.toMatch(/from\s+"\.\/[a-z-]+-router"/);
    // Fail-closed contract must be present.
    expect(guardSrc).toMatch(/Authorization store unavailable/);
  });
});


describe("ADR-003 nominal guard inventory", () => {
  const source = read("assembly-router.ts");
  it("recognizes the protected contextual list and batch branches through their imported executor boundary", () => {
    expect(routeGuardIssues("assembly-router.ts", source)).toEqual([]);
  });
  it.each([
    ["list boundary", "return callFinancialCalculator(ctx, {", "return bypassCalculator(ctx, {"],
    ["batch boundary", "return callFinancialCalculator(ctx, input)", "return bypassCalculator(ctx, input)"],
    ["list protection", "list: protectedProcedure", "list: publicProcedure"],
    ["batch protection", "calculateBatch: protectedProcedure", "calculateBatch: publicProcedure"],
    ["strict variant selection", "financialCalculatorRouteInput(calculatorCalculateCommandSchema, calculateBatchSchema", "unsafeInput(calculatorCalculateCommandSchema, calculateBatchSchema"],
    ["contextual branch", 'if ("operation" in input)', 'if (!("operation" in input))'],
    ["terminal boundary return", "return callFinancialCalculator(ctx, input)", "callFinancialCalculator(ctx, input)"],
  ])("detects removal or bypass of the %s", (_name, from, to) => {
    expect(source).toContain(from);
    expect(routeGuardIssues("assembly-router.ts", source.replace(from, to))).toContain("missing-project-guard");
  });
  it("rejects an executor import from a different module", () => {
    const changed = source.replace('from "./financial-calculator-client"', 'from "./untrusted-calculator-client"');
    expect(routeGuardIssues("assembly-router.ts", changed)).toContain("wrong-guard-import");
    expect(routeGuardIssues("assembly-router.ts", changed)).toContain("missing-project-guard");
  });
  it("rejects protectedProcedure imported from another module", () => {
    expect(routeGuardIssues("assembly-router.ts", source.replace('from "./_core/trpc"', 'from "./untrusted-trpc"'))).toContain("missing-project-guard");
  });
  it("does not treat a commented boundary call as an invocation", () => {
    const changed = source.replace("return callFinancialCalculator(ctx, input);", "/* return callFinancialCalculator(ctx, input); */ return input;");
    expect(routeGuardIssues("assembly-router.ts", changed)).toContain("missing-project-guard");
  });
  it("refuses a third project-scoped endpoint without giving the entire router an exemption", () => {
    const changed = source.replace("export const assemblyRouter = router({", `export const assemblyRouter = router({
      unrelated: protectedProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => input),`);
    expect(routeGuardIssues("assembly-router.ts", changed)).toContain("missing-project-guard");
  });
  it("refuses a third endpoint reusing the contextual schema", () => {
    const changed = source.replace("export const assemblyRouter = router({", `export const assemblyRouter = router({
      unrelated: protectedProcedure.input(calculatorCalculateCommandSchema).query(({ input }) => input),`);
    expect(routeGuardIssues("assembly-router.ts", changed)).toContain("missing-project-guard");
  });
  it("does not extend the nominal inventory to another router", () => {
    expect(routeGuardIssues("other-router.ts", source)).toContain("missing-project-guard");
  });
  it("continues detecting a project route with no boundary", () => {
    expect(routeGuardIssues("new-router.ts", 'export const newRouter = router({ read: protectedProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => input) });')).toContain("missing-project-guard");
  });
  it("continues detecting a legacy guard imported from the wrong module", () => {
    expect(routeGuardIssues("new-router.ts", 'import { requireProjectAccessTrpc } from "./incorrect"; const read = (projectId: string) => requireProjectAccessTrpc(projectId);')).toContain("wrong-guard-import");
  });
});
