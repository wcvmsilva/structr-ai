import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import type { TransactionSql } from "postgres";
import { startFinancialCalculatorBoundary, setupCalculatorLifecycleFixture } from "./test-support/financial-calculator-boundary";
import { executorTestConfig, signedExecutorAuthFixture, EXECUTOR_TEST_NOW_MS } from "./test-support/financial-executor-auth";
import { createExecutorTransactionRunner } from "../services/financial-executor/src/transaction";
import { createFinancialExecutorHandler } from "../services/financial-executor/src/handler";
import { createFinancialExecutorHttpAdapter } from "../services/financial-executor/src/http";
import type { ExecutorAuthenticator } from "../services/financial-executor/src/auth";
import { executeFinancialCalculator } from "./financial-calculator-db";
import type { FinancialExecutorCommand } from "../shared/financial-executor-contract";

const enabled = process.env.FINANCIAL_CALCULATOR_INTEGRATION_PHYSICAL === "1";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Lab = Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>;
type Auth = Awaited<ReturnType<typeof signedExecutorAuthFixture>>;
type Runner = ReturnType<typeof createExecutorTransactionRunner>;
type WireResult = { status: number; cache: string | number | string[] | undefined; body: any };

/** Real Node request/response objects over an in-memory transport; no listening socket. */
async function sendHttp(runner: Runner, auth: Auth, command: unknown, options: { authenticator?: ExecutorAuthenticator; remainingBodyBudgetMs?: number } = {}): Promise<WireResult> {
  const handler = createFinancialExecutorHandler({
    authenticator: options.authenticator ?? auth.authenticator,
    execute: (operator, input, request) => executeFinancialCalculator(runner, operator, input, request),
  });
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const request = new IncomingMessage(socket as Socket);
  request.method = "POST";
  request.headers = { ...auth.request.headers, "content-type": "application/json" };
  request.rawHeaders = [...auth.request.rawHeaders, "Content-Type", "application/json"];
  const response = new ServerResponse(request);
  response.assignSocket(socket as Socket);
  let initialClockRead = true;
  const adapter = createFinancialExecutorHttpAdapter(handler, { monotonicNowMs: () => {
    // Advance only the trusted body clock; SQL and authentication still use real clocks.
    const value = performance.now() - (initialClockRead && options.remainingBodyBudgetMs !== undefined ? 30000 - options.remainingBodyBudgetMs : 0);
    initialClockRead = false;
    return value;
  } });
  try {
    const pending = adapter(request, response);
    request.complete = true;
    request.push(Buffer.from(JSON.stringify(command)));
    request.push(null);
    await pending;
    const wire = Buffer.concat(chunks).toString("utf8");
    return { status: response.statusCode, cache: response.getHeader("cache-control"), body: JSON.parse(wire.slice(wire.indexOf("\r\n\r\n") + 4)) };
  } finally { socket.destroy(); }
}

describe.skipIf(!enabled)("Calculator HTTP to owned PostgreSQL integration", () => {
  let lab: Lab, fixture: Awaited<ReturnType<typeof setupCalculatorLifecycleFixture>>;
  let connections: Awaited<ReturnType<Lab["connectLogin"]>>[], runners: Runner[], auth: Auth;
  let config: typeof executorTestConfig;
  const counts = async () => {
    const [row] = await lab.admin`select (select count(*) from public.estimate_drafts)::int as drafts, (select count(*) from structr_financial.calculator_requests)::int as requests, (select count(*) from public.audit_logs where action='estimate_draft.create')::int as audits`;
    return row as { drafts: number; requests: number; audits: number };
  };
  const recover = (requestId: string) => ({ ...fixture.contextCommand, operation: "calculator.recover", requestId });
  async function createCommand(quantity = 1, requestId = randomUUID()): Promise<FinancialExecutorCommand> {
    const input = { ...fixture.command, assemblies: [{ assemblyId: fixture.ids.a, quantity }] };
    const simulation = await sendHttp(runners[0], auth, input);
    expect(simulation.status, JSON.stringify(simulation.body)).toBe(200);
    expect(simulation.body.financials).toMatchObject({ costMinor: String(4000 * quantity), priceMinor: String(10000 * quantity) });
    return { ...input, operation: "calculator.create", requestId, expectedSourceHash: simulation.body.sourceHash, expectedCalculationHash: simulation.body.calculationHash } as FinancialExecutorCommand;
  }
  async function waitForLock(tx: TransactionSql, pids: number[]) {
    const deadline = performance.now() + 1500;
    while (performance.now() < deadline) {
      await tx`select pg_stat_clear_snapshot()`;
      const rows = await tx`select pid from pg_stat_activity where pid = any(${tx.array(pids)}::integer[]) and wait_event_type='Lock'`;
      if (rows.length === pids.length) return;
      await pause(10);
    }
    throw new Error("Owned executor connections did not enter the expected real SQL lock wait");
  }
  async function startTogether(first: () => Promise<WireResult>, second: () => Promise<WireResult>) {
    let pending: Promise<WireResult>[] = [];
    try {
      await lab.admin.begin(async tx => {
        await tx`select id from structr_financial.principal_bindings where id=${fixture.ids.binding} for update`;
        pending = [first(), second()];
        await waitForLock(tx, connections.map(connection => connection.pid));
      });
      return await Promise.all(pending);
    } finally { await Promise.allSettled(pending); }
  }
  beforeAll(async () => {
    lab = await startFinancialCalculatorBoundary();
    await lab.install();
    await lab.admin.begin(async tx => { await tx.unsafe(await readFile(new URL("../drizzle/0021_financial_calculator_lifecycle.sql", import.meta.url), "utf8")); });
    fixture = await setupCalculatorLifecycleFixture(lab);
    connections = [await lab.connectLogin(), await lab.cluster.connect("calculator-http-second", "structr_calculator_login_v1")];
    expect(connections[0].pid).not.toBe(connections[1].pid);
    config = { ...executorTestConfig, auth: { ...executorTestConfig.auth, operatorSubject: fixture.ids.subject, actorId: fixture.ids.actor, tenantId: fixture.ids.tenant } };
    auth = await signedExecutorAuthFixture({ config });
    runners = connections.map(connection => createExecutorTransactionRunner(config, { database: connection.db, nowMs: () => EXECUTOR_TEST_NOW_MS }));
  }, 30000);
  afterAll(async () => {
    await Promise.allSettled((runners ?? []).map(runner => runner.close()));
    await lab?.stop();
  });

  it("two simultaneous identical HTTP creates converge on one committed draft and audit", async () => {
    const command = await createCommand(), before = await counts();
    const [first, second] = await startTogether(() => sendHttp(runners[0], auth, command), () => sendHttp(runners[1], auth, command));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.status).toBe("confirmed");
    expect(second.body).toEqual(first.body);
    expect([first.cache, second.cache]).toEqual(["no-store", "no-store"]);
    expect(await counts()).toEqual({ drafts: before.drafts + 1, requests: before.requests + 1, audits: before.audits + 1 });
    const [stored] = await lab.admin`select r.draft_id, r.receipt, a.new_values from structr_financial.calculator_requests r join public.audit_logs a on a.id=r.audit_id where r.request_id=${(command as any).requestId}`;
    expect(stored.draft_id).toBe(first.body.draft.id);
    expect(stored.receipt.audit.new_values).toEqual(stored.new_values);
    expect(stored.new_values.draft.id).toBe(first.body.draft.id);
  });

  it("simultaneous different commands sharing a request UUID yield one confirmation and one conflict", async () => {
    const requestId = randomUUID(), firstCommand = await createCommand(1, requestId), secondCommand = await createCommand(2, requestId), before = await counts();
    const responses = await startTogether(() => sendHttp(runners[0], auth, firstCommand), () => sendHttp(runners[1], auth, secondCommand));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(responses.find(response => response.status === 409)?.body).toEqual({ error: { code: "FINANCIAL_EXECUTOR_REQUEST_CONFLICT" } });
    expect(await counts()).toEqual({ drafts: before.drafts + 1, requests: before.requests + 1, audits: before.audits + 1 });
    const [stored] = await lab.admin`select d.subtotal_cost::text as cost, d.subtotal_price::text as price from structr_financial.calculator_requests r join public.estimate_drafts d on d.id=r.draft_id where r.request_id=${requestId}`;
    const winner = responses[0].status === 200 ? 1 : 2;
    expect(stored).toEqual({ cost: `${40 * winner}.00`, price: `${100 * winner}.00` });
  });

  it("a fresh signed recovery finds a committed create whose HTTP body was lost", async () => {
    const requestId = randomUUID(), command = await createCommand(1, requestId), before = await counts();
    // The caller deliberately discards the complete HTTP result, modeling loss after commit.
    await sendHttp(runners[0], auth, command);
    const [stored] = await lab.admin`select draft_id, receipt from structr_financial.calculator_requests where request_id=${requestId}`;
    expect(stored, "the independently read request must already be committed").toBeDefined();
    const freshAuth = await signedExecutorAuthFixture({ config, claims: { session_id: randomUUID() } });
    const response = await sendHttp(runners[1], freshAuth, recover(requestId));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ operation: "calculator.recover", requestId, status: "confirmed", draft: { id: stored.draft_id }, creation: { draftId: stored.draft_id, sourceHash: stored.receipt.sourceHash, calculationHash: stored.receipt.calculationHash, createdAt: stored.receipt.createdAt } });
    expect(await counts()).toEqual({ drafts: before.drafts + 1, requests: before.requests + 1, audits: before.audits + 1 });
  });

  it("recovery of an absent request returns not_found and writes nothing", async () => {
    const requestId = randomUUID(), before = await counts();
    const response = await sendHttp(runners[1], auth, recover(requestId));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...recover(requestId), status: "not_found", draft: null, creation: null });
    expect(await counts()).toEqual(before);
  });

  it("expiry during an observed SQL lock wait refuses the create before any draft or audit", async () => {
    const command = await createCommand(), before = await counts();
    let now = EXECUTOR_TEST_NOW_MS;
    const shortAuth = await signedExecutorAuthFixture({ config, nowMs: () => now, expiresAtMs: now + 1000 });
    const connection = await lab.cluster.connect("calculator-http-expiring", "structr_calculator_login_v1");
    const runner = createExecutorTransactionRunner(config, { database: connection.db, nowMs: () => now });
    let pending: Promise<WireResult> | undefined;
    try {
      await lab.admin.begin(async tx => {
        await tx`select id from structr_financial.principal_bindings where id=${fixture.ids.binding} for update`;
        pending = sendHttp(runner, shortAuth, command);
        await waitForLock(tx, [connection.pid]);
        now += 1001;
      });
      const response = await pending!;
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: { code: "EXECUTOR_UNAUTHORIZED" } });
      expect(await counts()).toEqual(before);
    } finally { await pending; await runner.close(); }
  });

  it("body, real authentication, pool waiting and SQL waiting consume one request deadline", async () => {
    const command = await createCommand(), before = await counts();
    let releasePool!: () => void, acquiredPool!: () => void;
    const acquired = new Promise<void>(resolve => { acquiredPool = resolve; });
    const release = new Promise<void>(resolve => { releasePool = resolve; });
    const occupying = connections[0].sql.begin(async tx => { await tx`select 1`; acquiredPool(); await release; });
    await acquired;
    const slowAuth: ExecutorAuthenticator = { async authenticate(request) { const operator = await auth.authenticator.authenticate(request); await pause(100); return operator; } };
    let pending: Promise<WireResult> | undefined, releaseTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await lab.admin.begin(async tx => {
        await tx`select id from structr_financial.principal_bindings where id=${fixture.ids.binding} for update`;
        const started = performance.now();
        pending = sendHttp(runners[0], auth, command, { authenticator: slowAuth, remainingBodyBudgetMs: 600 });
        releaseTimer = setTimeout(releasePool, 300);
        await waitForLock(tx, [connections[0].pid]);
        const response = await pending;
        expect(response.status).toBe(503);
        expect(response.body).toEqual({ error: { code: "FINANCIAL_EXECUTOR_DEADLINE" } });
        expect(performance.now() - started).toBeLessThan(1000);
      });
      await occupying;
      expect(await counts()).toEqual(before);
      // Timed-out work has settled: a fresh independent request remains usable.
      const response = await sendHttp(runners[1], auth, fixture.contextCommand);
      expect(response.status).toBe(200);
    } finally { if (releaseTimer) clearTimeout(releaseTimer); releasePool(); await occupying; await pending; }
  }, 10000);
});
