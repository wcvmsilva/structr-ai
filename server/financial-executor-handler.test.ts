import { describe, expect, it } from "vitest";
import { createFinancialExecutorHandler } from "../services/financial-executor/src/handler";
import { assertVerifiedExecutorOperator } from "../services/financial-executor/src/auth";
import { CalculatorError, buildCalculatorResult } from "../shared/financial-calculator-engine";
import { calculatorCommand, calculatorIds, calculatorSnapshot } from "./test-support/calculator-engine-fixture";
import { EXECUTOR_TEST_NOW_MS, signedExecutorAuthFixture } from "./test-support/financial-executor-auth";

const pair = { projectId: calculatorIds.project, intakeFormId: calculatorIds.intake };
const contextCommand = () => ({ contractVersion: "calculator-v1", operation: "calculator.context", ...pair });
const contextResult = () => ({ ...contextCommand(), clientId: calculatorIds.client, options: [{ assemblyId: calculatorIds.a, name: "Synthetic A", unit: "EA" }] });
const createCommand = () => ({ ...calculatorCommand(), operation: "calculator.create", requestId: calculatorIds.request, expectedSourceHash: "a".repeat(64), expectedCalculationHash: "b".repeat(64) });
const recoverCommand = () => ({ contractVersion: "calculator-v1", operation: "calculator.recover", ...pair, requestId: calculatorIds.request });
function confirmedResult(operation = "calculator.create") {
  return { contractVersion: "calculator-v1", operation, ...pair, requestId: calculatorIds.request, status: "confirmed", draft: { id: calculatorIds.client, status: "draft", version: 1, supersededBy: null }, creation: { draftId: calculatorIds.client, sourceHash: "a".repeat(64), calculationHash: "b".repeat(64), createdAt: "2026-10-10T12:00:00.000Z" } };
}
async function fixture(result: unknown = contextResult()) {
  const auth = await signedExecutorAuthFixture();
  let executions = 0;
  let received: unknown;
  const handler = createFinancialExecutorHandler({ authenticator: auth.authenticator, execute: async (operator, command) => {
    expect(assertVerifiedExecutorOperator(operator, EXECUTOR_TEST_NOW_MS).subject).toBe("11111111-1111-4111-8111-111111111111");
    received = command;
    executions++;
    return result as never;
  } });
  const request = (command: unknown = contextCommand()) => ({ method: "POST", headers: { ...auth.request.headers, "content-type": "application/json" }, rawHeaders: [...auth.request.rawHeaders, "Content-Type", "application/json"], body: JSON.stringify(command) });
  return { ...auth, handler, request, executions: () => executions, received: () => received };
}

describe("direct financial executor HTTP boundary", () => {
  it("verifies a direct bearer request and returns the strict public context projection", async () => {
    const f = await fixture();
    expect(await f.handler.handle(f.request())).toEqual({ status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: contextResult() });
    expect(f.received()).toEqual(contextCommand());
    expect(f.executions()).toBe(1);
  });
  it("accepts the calculate command and strips no unreviewed result fields silently", async () => {
    const { context: _context, draft: _draft, ...calculation } = await buildCalculatorResult(calculatorSnapshot(), calculatorCommand());
    const result = { ...calculation, operation: "calculator.calculate" };
    const f = await fixture(result);
    expect(await f.handler.handle(f.request(calculatorCommand()))).toMatchObject({ status: 200, body: { operation: "calculator.calculate", financials: { costMinor: "4000", priceMinor: "10000" } } });
  });
  it("accepts the confirmed create response only after the lifecycle returns", async () => {
    const f = await fixture(confirmedResult());
    expect(await f.handler.handle(f.request(createCommand()))).toMatchObject({ status: 200, body: { status: "confirmed", requestId: calculatorIds.request } });
  });
  it("returns a nominal not-found recovery without implying rollback", async () => {
    const result = { ...recoverCommand(), status: "not_found", draft: null, creation: null };
    const f = await fixture(result);
    expect(await f.handler.handle(f.request(recoverCommand()))).toMatchObject({ status: 200, body: result });
  });
  it("normalizes a canonical operation spelling before execution", async () => {
    const f = await fixture();
    expect(await f.handler.handle(f.request({ ...contextCommand(), operation: " CALCULATOR.CONTEXT " }))).toMatchObject({ status: 200 });
    expect(f.received()).toEqual(contextCommand());
  });

  it.each([
    ["GET", { method: "GET" }, 405],
    ["pre-parsed object", { body: contextCommand() }, 400],
    ["invalid JSON", { body: "{" }, 400],
    ["null JSON", { body: "null" }, 400],
    ["array JSON", { body: "[]" }, 400],
    ["empty raw body", { body: "" }, 400],
    ["duplicate JSON keys", { body: JSON.stringify(contextCommand()).replace('"operation":', '"operation":"calculator.create","operation":') }, 400],
    ["malformed UTF-16", { body: JSON.stringify({ ...contextCommand(), operation: "calculator.context\ud800" }) }, 400],
    ["over-limit ASCII body", { body: " ".repeat(65537) }, 413],
    ["over-limit UTF-8 body", { body: JSON.stringify({ ...contextCommand(), padding: "🔥".repeat(16384) }) }, 413],
  ])("rejects %s before execution", async (_name, override, status) => {
    const f = await fixture();
    const response = await f.handler.handle({ ...f.request(), ...override });
    expect(response).toMatchObject({ status, headers: { "cache-control": "no-store" }, body: { error: { code: "FINANCIAL_EXECUTOR_INPUT_INVALID" } } });
    expect(f.executions()).toBe(0);
  });
  it("accepts a valid JSON body at the 64 KiB boundary", async () => {
    const f = await fixture();
    const request = f.request();
    request.body += " ".repeat(65536 - Buffer.byteLength(request.body));
    expect(await f.handler.handle(request)).toMatchObject({ status: 200 });
  });

  it.each([
    { operation: "calculator.approve" }, { tenantId: calculatorIds.tenant }, { actorId: calculatorIds.actor },
    { total: "0.00" }, { context: { channelPriceMultiplier: 0 } }, { source: "trusted" },
    { projectId: "unknown" }, { contractVersion: "calculator-v2" }, { requestId: calculatorIds.request },
  ])("rejects invalid or authority-bearing context fields %#", async fields => {
    const f = await fixture();
    expect(await f.handler.handle(f.request({ ...contextCommand(), ...fields }))).toMatchObject({ status: 400 });
    expect(f.executions()).toBe(0);
  });
  it.each([
    { assemblies: [] }, { assemblies: [{ assemblyId: calculatorIds.a, quantity: 1.5 }] },
    { assemblies: [{ assemblyId: calculatorIds.a, quantity: 0 }] }, { assemblies: [{ assemblyId: calculatorIds.a, quantity: 101 }] },
    { assemblies: [{ assemblyId: calculatorIds.a, quantity: 1 }, { assemblyId: calculatorIds.a, quantity: 1 }] },
    { expectedSourceHash: "forged" }, { expectedCalculationHash: "forged" }, { requestId: undefined },
  ])("rejects invalid creation command %# before write", async fields => {
    const f = await fixture(confirmedResult());
    expect(await f.handler.handle(f.request({ ...createCommand(), ...fields }))).toMatchObject({ status: 400 });
    expect(f.executions()).toBe(0);
  });

  it.each([undefined, "text/plain", "application/json, application/json", ["application/json"], "application/json; charset=latin1", "application/json\n", "application/json;\ncharset=utf-8"])("rejects unsupported or multiple Content-Type %#", async contentType => {
    const f = await fixture();
    const request = f.request();
    expect(await f.handler.handle({ ...request, rawHeaders: undefined, headers: { ...request.headers, "content-type": contentType } })).toMatchObject({ status: 415 });
    expect(f.executions()).toBe(0);
  });
  it("refuses duplicate Content-Type originals even when Node normalized them", async () => {
    const f = await fixture();
    const request = f.request();
    expect(await f.handler.handle({ ...request, rawHeaders: [...request.rawHeaders, "content-type", "application/json"] })).toMatchObject({ status: 415 });
    expect(f.executions()).toBe(0);
  });
  it("authenticates a direct call instead of trusting web headers or cookies", async () => {
    const f = await fixture();
    expect(await f.handler.handle({ ...f.request(), rawHeaders: undefined, headers: { "content-type": "application/json", cookie: `session=${f.token}`, "x-user-id": calculatorIds.actor, "x-tenant-id": calculatorIds.tenant } })).toMatchObject({ status: 401, body: { error: { code: "EXECUTOR_UNAUTHORIZED" } } });
    expect(f.executions()).toBe(0);
  });
  it("rejects duplicate bearer originals in a direct call", async () => {
    const f = await fixture();
    const request = f.request();
    expect(await f.handler.handle({ ...request, rawHeaders: [...request.rawHeaders, ...f.request().rawHeaders.slice(0, 2)] })).toMatchObject({ status: 401 });
    expect(f.executions()).toBe(0);
  });

  it.each([
    ["database password", { ...contextResult(), password: "never-print" }],
    ["internal binding", { ...contextResult(), binding: { tenantId: calculatorIds.tenant } }],
    ["nested credential", { ...contextResult(), options: [{ assemblyId: calculatorIds.a, name: "Synthetic A", unit: "EA", token: "never-print" }] }],
    ["different project", { ...contextResult(), projectId: calculatorIds.client }],
    ["different operation", { ...contextResult(), operation: "calculator.recover" }],
  ])("rejects unreviewed executor output: %s", async (_name, result) => {
    const f = await fixture(result);
    expect(await f.handler.handle(f.request())).toMatchObject({ status: 500, body: { error: { code: "FINANCIAL_EXECUTOR_RECEIPT_INVALID" } } });
  });
  it("refuses an internal engine draft instead of forwarding it", async () => {
    const internal = await buildCalculatorResult(calculatorSnapshot(), calculatorCommand());
    const f = await fixture({ ...internal, operation: "calculator.calculate" });
    expect(await f.handler.handle(f.request(calculatorCommand()))).toMatchObject({ status: 500 });
  });
  it("refuses more than the 1000 lines allowed by draft formation", async () => {
    const { context: _context, draft: _draft, ...calculation } = await buildCalculatorResult(calculatorSnapshot(), calculatorCommand());
    const f = await fixture({ ...calculation, operation: "calculator.calculate", lines: Array.from({ length: 1001 }, (_, index) => ({ ...calculation.lines[0], ordinal: index + 1 })) });
    expect(await f.handler.handle(f.request(calculatorCommand()))).toMatchObject({ status: 500, body: { error: { code: "FINANCIAL_EXECUTOR_RECEIPT_INVALID" } } });
  });
  it.each([
    { status: "not_found", draft: null, creation: null },
    { requestId: calculatorIds.actor },
    { creation: { ...confirmedResult().creation, draftId: calculatorIds.actor } },
    { creation: { ...confirmedResult().creation, sourceHash: "forged" } },
  ])("refuses inconsistent creation projection %#", async fields => {
    const f = await fixture({ ...confirmedResult(), ...fields });
    expect(await f.handler.handle(f.request(createCommand()))).toMatchObject({ status: 500 });
  });

  it.each([
    ["EXECUTOR_UNAUTHORIZED", 401], ["FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH", 403],
    ["FINANCIAL_EXECUTOR_CONFIRMATION_STALE", 409], ["FINANCIAL_EXECUTOR_REQUEST_CONFLICT", 409],
    ["FINANCIAL_EXECUTOR_DEADLINE", 503], ["FINANCIAL_EXECUTOR_CAPACITY", 503],
    ["FINANCIAL_EXECUTOR_RECEIPT_INVALID", 500], ["FINANCIAL_EXECUTOR_TRANSACTION_INVALID", 500],
  ] as const)("maps %s to a sanitized HTTP %d response", async (code, status) => {
    const f = await fixture();
    const handler = createFinancialExecutorHandler({ authenticator: f.authenticator, execute: async () => { throw Object.assign(new Error(`secret ${f.token}`), { code }); } });
    expect(await handler.handle(f.request())).toEqual({ status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: { error: { code } } });
  });
  it("maps a known CalculatorError without leaking its source path", async () => {
    const f = await fixture();
    const handler = createFinancialExecutorHandler({ authenticator: f.authenticator, execute: async () => { throw new CalculatorError("CALCULATOR_PRICE_AMBIGUOUS", "private-source-path"); } });
    expect(await handler.handle(f.request())).toMatchObject({ status: 409, body: { error: { code: "CALCULATOR_PRICE_AMBIGUOUS" } } });
  });
  it("never forwards an unknown SQL error, code, or token-bearing message", async () => {
    const f = await fixture();
    const handler = createFinancialExecutorHandler({ authenticator: f.authenticator, execute: async () => { throw Object.assign(new Error(`private SQL ${f.token}`), { code: "42501", detail: "audit payload" }); } });
    expect(await handler.handle(f.request())).toMatchObject({ status: 500, body: { error: { code: "FINANCIAL_EXECUTOR_DATABASE_FAILURE" } } });
  });
  it("does not release success until the transactional execute promise commits", async () => {
    const f = await fixture();
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let commit!: (value: never) => void;
    const committed = new Promise<never>(resolve => { commit = resolve; });
    const handler = createFinancialExecutorHandler({ authenticator: f.authenticator, execute: async () => { enter(); return committed; } });
    let released = false;
    const response = handler.handle(f.request()).then(result => { released = true; return result; });
    await entered;
    expect(released).toBe(false);
    commit(contextResult() as never);
    expect(await response).toMatchObject({ status: 200 });
  });

  it("passes one request deadline through authentication to the transaction executor", async () => {
    const f = await fixture();
    let now = 1000;
    let observedDeadline: unknown;
    const handler = createFinancialExecutorHandler({
      authenticator: { authenticate: async request => { const operator = await f.authenticator.authenticate(request); now = 3500; return operator; } },
      monotonicNowMs: () => now,
      execute: async (_operator, _command, options) => { observedDeadline = options?.deadline; return contextResult() as never; },
    });
    expect(await handler.handle(f.request())).toMatchObject({ status: 200 });
    expect(observedDeadline).toBe(31000);
  });
  it("refuses to execute when authentication consumes the whole request deadline", async () => {
    const f = await fixture();
    let now = 0;
    let executions = 0;
    const handler = createFinancialExecutorHandler({
      authenticator: { authenticate: async request => { const operator = await f.authenticator.authenticate(request); now = 30000; return operator; } },
      monotonicNowMs: () => now,
      execute: async () => { executions++; return contextResult() as never; },
    });
    expect(await handler.handle(f.request())).toMatchObject({ status: 503, body: { error: { code: "FINANCIAL_EXECUTOR_DEADLINE" } } });
    expect(executions).toBe(0);
  });
  it("returns a recovery-required timeout for an execution completing after the original deadline", async () => {
    const f = await fixture();
    let now = 1000;
    let executions = 0;
    const handler = createFinancialExecutorHandler({
      authenticator: f.authenticator, monotonicNowMs: () => now,
      execute: async () => { executions++; now = 31000; return contextResult() as never; },
    });
    expect(await handler.handle(f.request())).toMatchObject({ status: 503, body: { error: { code: "FINANCIAL_EXECUTOR_DEADLINE" } } });
    expect(executions).toBe(1);
  });
  it("preserves a shorter deadline inherited from the raw body reader", async () => {
    const f = await fixture();
    let observed: unknown;
    const handler = createFinancialExecutorHandler({
      authenticator: f.authenticator, monotonicNowMs: () => 5000,
      execute: async (_operator, _command, options) => { observed = options.deadline; return contextResult() as never; },
    });
    expect(await handler.handle(f.request(), { deadline: 9000 })).toMatchObject({ status: 200 });
    expect(observed).toBe(9000);
  });
  it.each([5000, 4000, 35001, Number.POSITIVE_INFINITY, Number.NaN])("rejects an expired or invalid inherited deadline %#", async deadline => {
    const f = await fixture();
    let executions = 0;
    const handler = createFinancialExecutorHandler({
      authenticator: f.authenticator, monotonicNowMs: () => 5000,
      execute: async () => { executions++; return contextResult() as never; },
    });
    expect(await handler.handle(f.request(), { deadline })).toMatchObject({ status: 503, body: { error: { code: "FINANCIAL_EXECUTOR_DEADLINE" } } });
    expect(executions).toBe(0);
  });
});
