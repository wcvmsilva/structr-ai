/** Actual tRPC procedures, web transport validation, signed executor authentication and PG17.
 * Only fetch's wire is replaced with the real executor handler; no remote service is contacted.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { router } from "./_core/trpc";
import { assemblyRouter } from "./assembly-router";
import { estimateRouter } from "./estimate-router";
import type { TrpcContext } from "./_core/context";
import { startFinancialCalculatorBoundary, setupCalculatorLifecycleFixture } from "./test-support/financial-calculator-boundary";
import { executorTestConfig, signedExecutorAuthFixture, EXECUTOR_TEST_NOW_MS } from "./test-support/financial-executor-auth";
import { createExecutorTransactionRunner } from "../services/financial-executor/src/transaction";
import { createFinancialExecutorHandler } from "../services/financial-executor/src/handler";
import { executeFinancialCalculator } from "./financial-calculator-db";
import { financialExecutorCalculateResultSchema, financialExecutorContextResultSchema, financialExecutorReceiptResultSchema } from "../shared/financial-executor-contract";

const enabled = process.env.FINANCIAL_CALCULATOR_WEB_INTEGRATION_PHYSICAL === "1";
const api = router({ assembly: assemblyRouter, estimate: estimateRouter });
const executorOrigin = "https://calculator-local.example.invalid";
type Lab = Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>;
type Auth = Awaited<ReturnType<typeof signedExecutorAuthFixture>>;

describe.skipIf(!enabled)("Calculator existing web routes through signed executor to PostgreSQL", () => {
  let lab: Lab, fixture: Awaited<ReturnType<typeof setupCalculatorLifecycleFixture>>;
  let runner: ReturnType<typeof createExecutorTransactionRunner>, auth: Auth;
  let handler: ReturnType<typeof createFinancialExecutorHandler>;
  let dropCommittedCreate = false;
  const sent: Array<{ operation: string; requestId?: string }> = [];
  const counts = async () => {
    const [row] = await lab.admin`select (select count(*) from public.estimate_drafts)::int as drafts,
      (select count(*) from structr_financial.calculator_requests)::int as requests,
      (select count(*) from public.audit_logs where action='estimate_draft.create')::int as audits`;
    return row;
  };
  function context(currentAuth = auth): TrpcContext {
    const profile = { id: fixture.ids.actor, externalOpenId: fixture.ids.subject, tenantId: fixture.ids.tenant, role: "financial_operator", isActive: true };
    return { req: currentAuth.request, res: {}, authProvider: "supabase", user: profile, tenantId: fixture.ids.tenant,
      authenticatedDataApiSession: { version: "structr-authenticated-session-v1", profile, tenantId: fixture.ids.tenant,
        permissions: { slugs: ["estimate.create", "project.write"], isPlatformAdmin: false } } } as unknown as TrpcContext;
  }
  const caller = (ctx = context()) => api.createCaller(ctx);
  const pair = () => ({ projectId: fixture.ids.project, intakeFormId: fixture.ids.intake });
  const calculateCommand = (assemblyId = fixture.ids.a, quantity = 1) => ({ ...fixture.command, assemblies: [{ assemblyId, quantity }] });
  async function calculate(assemblyId = fixture.ids.a, quantity = 1) {
    return financialExecutorCalculateResultSchema.parse(await caller().assembly.calculateBatch(calculateCommand(assemblyId, quantity) as never));
  }
  async function createCommand(assemblyId = fixture.ids.a) {
    const calculation = await calculate(assemblyId);
    return { ...calculateCommand(assemblyId), operation: "calculator.create", requestId: randomUUID(),
      expectedSourceHash: calculation.sourceHash, expectedCalculationHash: calculation.calculationHash };
  }
  async function recover(requestId: string, ctx = context()) {
    const client = caller(ctx);
    // The new query is asserted behaviorally before T5 exists, never as an existence-only test.
    const invoke = (client.estimate as any).getCalculatorResult;
    return financialExecutorReceiptResultSchema.parse(await invoke({ contractVersion: "calculator-v1", operation: "calculator.recover", ...pair(), requestId }));
  }
  beforeAll(async () => {
    lab = await startFinancialCalculatorBoundary();
    await lab.install();
    await lab.admin.begin(async tx => { await tx.unsafe(await readFile(new URL("../drizzle/0021_financial_calculator_lifecycle.sql", import.meta.url), "utf8")); });
    fixture = await setupCalculatorLifecycleFixture(lab);
    const connection = await lab.connectLogin();
    const config = { ...executorTestConfig, auth: { ...executorTestConfig.auth, operatorSubject: fixture.ids.subject, actorId: fixture.ids.actor, tenantId: fixture.ids.tenant } };
    auth = await signedExecutorAuthFixture({ config });
    runner = createExecutorTransactionRunner(config, { database: connection.db, nowMs: () => EXECUTOR_TEST_NOW_MS });
    handler = createFinancialExecutorHandler({ authenticator: auth.authenticator,
      execute: (operator, command, options) => executeFinancialCalculator(runner, operator, command, options) });
  }, 30000);
  beforeEach(() => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
    vi.stubEnv("STRUCTR_FINANCIAL_CALCULATOR_ENABLED", "true");
    vi.stubEnv("STRUCTR_FINANCIAL_EXECUTOR_ORIGIN", executorOrigin);
    sent.length = 0; dropCommittedCreate = false;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      // Verify the actual destination/transport contract before handing bytes to real auth/SQL.
      expect(String(input)).toBe(`${executorOrigin}/api/execute`);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const headers = Object.fromEntries(new Headers(init?.headers));
      const result = await handler.handle({ method: init!.method!, headers,
        rawHeaders: Object.entries(headers).flat(), body: init?.body });
      const command = JSON.parse(String(init?.body));
      sent.push({ operation: command.operation, ...(command.requestId ? { requestId: command.requestId } : {}) });
      if (dropCommittedCreate && command.operation === "calculator.create" && result.status === 200) {
        dropCommittedCreate = false;
        throw new TypeError("Synthetic response lost after confirmed database commit");
      }
      return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers });
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  afterAll(async () => { await runner?.close(); await lab?.stop(); });

  it("loads only the three audited contextual options through the existing list endpoint", async () => {
    const before = await counts();
    const result = financialExecutorContextResultSchema.parse(await caller().assembly.list({ mode: "calculator", ...pair() } as never));
    expect(result.options).toEqual([
      { assemblyId: fixture.ids.a, name: "A", unit: "EA" },
      { assemblyId: fixture.ids.b, name: "B", unit: "EA" },
      { assemblyId: fixture.ids.c, name: "C", unit: "EA" },
    ]);
    expect(result).not.toHaveProperty("binding");
    expect(await counts()).toEqual(before);
  });
  it.each([
    ["a", "4000", "10000", "40.00", "100.00", 60],
    ["b", "6000", "9000", "60.00", "90.00", 33.33],
    ["c", "1", "1", "0.01", "0.01", 0],
  ] as const)("simulates, confirms and durably audits fixture %s with exact cents", async (key, costMinor, priceMinor, cost, price, gp) => {
    const before = await counts(), calculation = await calculate(fixture.ids[key]);
    expect(calculation.financials).toMatchObject({ costMinor, priceMinor, grossProfitPct: gp });
    const command = { ...calculateCommand(fixture.ids[key]), operation: "calculator.create", requestId: randomUUID(),
      expectedSourceHash: calculation.sourceHash, expectedCalculationHash: calculation.calculationHash };
    const result = financialExecutorReceiptResultSchema.parse(await caller().estimate.createFromCalculator(command as never));
    expect(result.status).toBe("confirmed"); expect(result.draft?.status).toBe("draft");
    expect(await counts()).toEqual({ drafts: before.drafts + 1, requests: before.requests + 1, audits: before.audits + 1 });
    const [stored] = await lab.admin`select d.subtotal_cost::text as cost,d.subtotal_price::text as price,d.tenant_id,a.user_id,a.old_values,a.new_values,r.receipt
      from structr_financial.calculator_requests r join public.estimate_drafts d on d.id=r.draft_id join public.audit_logs a on a.id=r.audit_id where r.request_id=${command.requestId}`;
    expect(stored).toMatchObject({ cost, price, tenant_id: fixture.ids.tenant, user_id: fixture.ids.actor, old_values: null });
    expect(stored.new_values).toEqual(stored.receipt.audit.new_values);
    expect(stored.new_values.draft.id).toBe(result.creation?.draftId);
  });
  it("keeps an uncertain write recoverable with a fresh session and never retries the create", async () => {
    const command = await createCommand(), before = await counts();
    dropCommittedCreate = true;
    await expect(caller().estimate.createFromCalculator(command as never)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(sent.filter(item => item.operation === "calculator.create")).toEqual([{ operation: "calculator.create", requestId: command.requestId }]);
    const fresh = await signedExecutorAuthFixture({ config: { ...executorTestConfig, auth: { ...executorTestConfig.auth,
      operatorSubject: fixture.ids.subject, actorId: fixture.ids.actor, tenantId: fixture.ids.tenant } }, claims: { session_id: randomUUID() } });
    const result = await recover(command.requestId, context(fresh));
    expect(result).toMatchObject({ status: "confirmed", requestId: command.requestId, creation: {
      sourceHash: command.expectedSourceHash, calculationHash: command.expectedCalculationHash } });
    expect(await counts()).toEqual({ drafts: before.drafts + 1, requests: before.requests + 1, audits: before.audits + 1 });
    expect(sent.filter(item => item.operation === "calculator.create")).toHaveLength(1);
  });
  it("rejects changed physical pricing after confirmation with zero new writes", async () => {
    const command = await createCommand(), before = await counts();
    await lab.admin`update public.cost_code_pricing_history set unit_price=101 where id='c3000000-0000-4000-8000-000000000401'`;
    try {
      await expect(caller().estimate.createFromCalculator(command as never)).rejects.toMatchObject({ code: "CONFLICT", message: "FINANCIAL_EXECUTOR_CONFIRMATION_STALE" });
      expect(await counts()).toEqual(before);
      const current = await calculate();
      expect(current.financials.priceMinor).toBe("10100");
      expect(current.sourceHash).not.toBe(command.expectedSourceHash);
    } finally { await lab.admin`update public.cost_code_pricing_history set unit_price=100 where id='c3000000-0000-4000-8000-000000000401'`; }
  });
  it("recovery of an absent request is a read and preserves the exact requested identity", async () => {
    const before = await counts(), requestId = randomUUID();
    expect(await recover(requestId)).toEqual({ contractVersion: "calculator-v1", operation: "calculator.recover", ...pair(), requestId, status: "not_found", draft: null, creation: null });
    expect(await counts()).toEqual(before);
    expect(sent).toEqual([{ operation: "calculator.recover", requestId }]);
  });
  it("withdrawal of protected operator authority blocks creation and recovery despite cached web identity", async () => {
    const command = await createCommand();
    await caller().estimate.createFromCalculator(command as never);
    const before = await counts();
    await lab.admin`update public.profiles set is_active=false where id=${fixture.ids.actor}`;
    try {
      await expect(recover(command.requestId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller().estimate.createFromCalculator(command as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await counts()).toEqual(before);
    } finally { await lab.admin`update public.profiles set is_active=true where id=${fixture.ids.actor}`; }
  });
  it("suppressed creation audit aborts the real transaction before the web can confirm", async () => {
    const command = await createCommand(), before = await counts();
    await lab.admin.unsafe(`CREATE FUNCTION public.web_proof_suppress_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='estimate_draft.create' THEN RETURN NULL; END IF; RETURN NEW; END $$;
      CREATE TRIGGER web_proof_suppress_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.web_proof_suppress_audit();`);
    try {
      await expect(caller().estimate.createFromCalculator(command as never)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(await counts()).toEqual(before);
      expect((await recover(command.requestId)).status).toBe("not_found");
    } finally { await lab.admin.unsafe("DROP TRIGGER web_proof_suppress_audit ON public.audit_logs; DROP FUNCTION public.web_proof_suppress_audit()"); }
  });
  it("rejects a different physical pair before returning options or creating a draft", async () => {
    const before = await counts();
    await expect(caller().assembly.list({ mode: "calculator", ...pair(), intakeFormId: randomUUID() } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await counts()).toEqual(before);
  });
  it("refuses conflicting reuse of a committed request identity without a second draft", async () => {
    const command = await createCommand();
    const first = financialExecutorReceiptResultSchema.parse(await caller().estimate.createFromCalculator(command as never));
    const before = await counts(), revised = await calculate(fixture.ids.a, 2);
    await expect(caller().estimate.createFromCalculator({ ...command, assemblies: [{ assemblyId: fixture.ids.a, quantity: 2 }],
      expectedSourceHash: revised.sourceHash, expectedCalculationHash: revised.calculationHash } as never))
      .rejects.toMatchObject({ code: "CONFLICT", message: "FINANCIAL_EXECUTOR_REQUEST_CONFLICT" });
    expect(await counts()).toEqual(before);
    expect((await recover(command.requestId)).creation).toEqual(first.creation);
  });
  it("the executor rejects a corrupt signed bearer even behind a cached valid web profile", async () => {
    const before = await counts(), ctx = context();
    const [head, payload, signature] = auth.token.split(".");
    const corrupted = `${head}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    ctx.req = { headers: { authorization: `Bearer ${corrupted}` }, rawHeaders: ["Authorization", `Bearer ${corrupted}`] } as any;
    await expect(caller(ctx).assembly.list({ mode: "calculator", ...pair() } as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(sent).toEqual([{ operation: "calculator.context" }]);
    expect(await counts()).toEqual(before);
  });
  it("a closed web gate refuses all four paths without contacting the executor", async () => {
    const command = await createCommand(), before = await counts(); sent.length = 0;
    vi.stubEnv("STRUCTR_FINANCIAL_CALCULATOR_ENABLED", "false");
    await expect(caller().assembly.list({ mode: "calculator", ...pair() } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().assembly.calculateBatch(calculateCommand() as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().estimate.createFromCalculator(command as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recover(command.requestId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sent).toEqual([]); expect(await counts()).toEqual(before);
  });
});
