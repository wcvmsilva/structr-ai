import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { buildCalculatorResult } from "../shared/financial-calculator-engine";
import { calculatorCommand, calculatorIds as ids, calculatorSnapshot } from "./test-support/calculator-engine-fixture";
const legacy = vi.hoisted(() => ({ list: vi.fn(), assembly: vi.fn(), create: vi.fn(), access: vi.fn() }));
vi.mock("./assembly-db", async original => ({ ...(await original<typeof import("./assembly-db")>()), listAssemblies: legacy.list, getAssemblyById: legacy.assembly }));
vi.mock("./estimate-db", async original => ({ ...(await original<typeof import("./estimate-db")>()), createEstimateDraftFromCalculator: legacy.create }));
vi.mock("./project-access", async original => ({ ...(await original<typeof import("./project-access")>()), requireProjectAccessTrpc: legacy.access }));
import { assemblyRouter } from "./assembly-router";
import { estimateRouter } from "./estimate-router";
import { router } from "./_core/trpc";
const api = router({ assembly: assemblyRouter, estimate: estimateRouter });
const pair = { projectId: ids.project, intakeFormId: ids.intake };
const list = { mode: "calculator", ...pair };
const calculate = calculatorCommand();
const create = { ...calculate, operation: "calculator.create", requestId: ids.request, expectedSourceHash: "a".repeat(64), expectedCalculationHash: "b".repeat(64) };
const recover = { contractVersion: "calculator-v1", operation: "calculator.recover", ...pair, requestId: ids.request };
const contextResult = { contractVersion: "calculator-v1", operation: "calculator.context", ...pair, clientId: ids.client, options: [{ assemblyId: ids.a, name: "Synthetic A", unit: "EA" }] };
const receipt = (operation = "calculator.create") => ({ contractVersion: "calculator-v1", operation, ...pair, requestId: ids.request, status: "confirmed", draft: { id: ids.client, status: "draft", version: 1, supersededBy: null }, creation: { draftId: ids.client, sourceHash: create.expectedSourceHash, calculationHash: create.expectedCalculationHash, createdAt: "2026-10-10T12:00:00.000Z" } });
function context(): TrpcContext {
  const profile = { id: ids.actor, tenantId: ids.tenant, role: "user", isActive: true };
  return { req: { headers: { authorization: "Bearer e30.e30.synthetic" } }, res: {}, authProvider: "supabase", user: profile, tenantId: ids.tenant,
    authenticatedDataApiSession: { version: "structr-authenticated-session-v1", profile, tenantId: ids.tenant, permissions: { slugs: [], isPlatformAdmin: false } } } as unknown as TrpcContext;
}
type Route = "list" | "calculate" | "create" | "recover";
const commands = { list, calculate, create, recover };
function invoke(route: Route, input: unknown = commands[route], ctx = context()) {
  const caller = api.createCaller(ctx);
  if (route === "list") return caller.assembly.list(input as never);
  if (route === "calculate") return caller.assembly.calculateBatch(input as never);
  if (route === "create") return caller.estimate.createFromCalculator(input as never);
  return (caller.estimate as any).getCalculatorResult(input);
}
const fetcher = vi.fn<typeof fetch>();
function respond(body: unknown, status = 200) { fetcher.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })); }
function noLegacy() { for (const spy of Object.values(legacy)) expect(spy).not.toHaveBeenCalled(); }
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("STRUCTR_FINANCIAL_CALCULATOR_ENABLED", "true");
  vi.stubEnv("STRUCTR_FINANCIAL_EXECUTOR_ORIGIN", "https://calculator.example.test");
  vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); Object.values(legacy).forEach(spy => spy.mockReset()); respond(contextResult);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("ADR-003 contextual web routes and transport", () => {
  it("loads only contextual options using the fixed executor and the protected bearer", async () => {
    expect(await invoke("list")).toEqual(contextResult);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://calculator.example.test/api/execute");
    expect(options).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { authorization: "Bearer e30.e30.synthetic", "content-type": "application/json" } });
    expect(JSON.parse(options!.body as string)).toEqual({ contractVersion: "calculator-v1", operation: "calculator.context", ...pair }); noLegacy();
  });
  it("returns the frozen calculation projection without exposing the internal snapshot", async () => {
    const { context: _context, draft: _draft, ...result } = await buildCalculatorResult(calculatorSnapshot(), calculate);
    respond({ ...result, operation: "calculator.calculate" });
    expect(await invoke("calculate")).toMatchObject({ financials: { costMinor: "4000", priceMinor: "10000" }, authority: "draft_only", selections: calculate.assemblies }); noLegacy();
  });
  it("returns the confirmed creation receipt without performing a separate web write/audit", async () => {
    respond(receipt()); expect(await invoke("create")).toEqual(receipt());
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(create); noLegacy();
  });
  it("preserves recover not_found without creating another draft", async () => {
    const result = { ...recover, status: "not_found", draft: null, creation: null }; respond(result);
    expect(await invoke("recover")).toEqual(result); expect(fetcher).toHaveBeenCalledTimes(1); noLegacy();
  });
  it.each(["list", "calculate", "create", "recover"] as const)("keeps %s unavailable without its explicit gate", async route => {
    vi.stubEnv("STRUCTR_FINANCIAL_CALCULATOR_ENABLED", "false");
    await expect(invoke(route)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it.each(["", "TRUE", "1", "yes"])("does not interpret %s as permission to open the gate", async flag => {
    vi.stubEnv("STRUCTR_FINANCIAL_CALCULATOR_ENABLED", flag);
    await expect(invoke("list")).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it.each(["list", "calculate", "create", "recover"] as const)("requires authentication for %s", async route => {
    await expect(invoke(route, commands[route], { ...context(), user: null })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it.each(["session", "tenant", "inactive", "provider"])("refuses inconsistent protected %s", async field => {
    const ctx = context(); if (field === "session") ctx.authenticatedDataApiSession = undefined;
    if (field === "tenant") ctx.tenantId = ids.client;
    if (field === "inactive") ctx.user!.isActive = false;
    if (field === "provider") ctx.authProvider = "legacy";
    await expect(invoke("list", list, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it.each([undefined, {}, { activeOnly: true }, { projectId: ids.project }, { ...list, search: "global" }, { ...list, actorId: ids.actor }])("rejects global/expanded catalog input %j before any lookup", async input => {
    const caller = api.createCaller(context()); await expect(caller.assembly.list(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it.each([
    { ...calculate, actorId: ids.actor }, { ...calculate, tenantId: ids.tenant }, { ...calculate, channel: "direct" },
    { ...calculate, assemblies: [{ assemblyId: ids.a, quantity: 1, unitPrice: "100" }] },
    { ...calculate, assemblies: [{ assemblyId: ids.a, quantity: 1.1 }] },
    { ...calculate, assemblies: [{ assemblyId: ids.a, quantity: true }] },
    { ...calculate, assemblies: [{ assemblyId: ids.a, quantity: 101 }] },
    { ...calculate, assemblies: [...calculate.assemblies, ...calculate.assemblies] },
    { assemblies: calculate.assemblies },
  ])("rejects malformed or legacy calculate input %j", async input => {
    await expect(invoke("calculate", input)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it.each([{ ...create, notes: "injected" }, { ...create, expectedSourceHash: "bad" }, { selections: calculate.assemblies, context: { region: "charleston_sc", channel: "direct", finishLevel: "standard" } }])("rejects expanded or legacy creation %j", async input => {
    await expect(invoke("create", input)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it("rejects accessor input before evaluating untrusted values", async () => {
    let reads = 0; const command = Object.defineProperty({ mode: "calculator", intakeFormId: ids.intake }, "projectId", { enumerable: true, get: () => { reads++; return ids.project; } });
    await expect(invoke("list", command)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(reads).toBe(0); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["http://calculator.example.test", "https://calculator.example.test/path", "https://user:pass@calculator.example.test", "https://calculator.example.test?redirect=elsewhere", "https://calculator.example.test#fragment", " https://calculator.example.test", ""])("rejects an unsafe nominal origin %s without forwarding bearer", async origin => {
    vi.stubEnv("STRUCTR_FINANCIAL_EXECUTOR_ORIGIN", origin);
    await expect(invoke("list")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
  it.each([undefined, "Bearer private", ["Bearer e30.e30.synthetic"], "Bearer e30.e30.synthetic\nother"])("refuses malformed bearer %j before transport", async bearer => {
    const ctx = context(); ctx.req.headers.authorization = bearer as any;
    await expect(invoke("list", list, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses duplicate authorization headers", async () => {
    const ctx = context(); ctx.req.rawHeaders = ["Authorization", "Bearer e30.e30.synthetic", "authorization", "Bearer e30.e30.other"];
    await expect(invoke("list", list, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [401, "EXECUTOR_UNAUTHORIZED", "UNAUTHORIZED"], [403, "FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH", "FORBIDDEN"],
    [409, "FINANCIAL_EXECUTOR_CONFIRMATION_STALE", "CONFLICT"], [409, "FINANCIAL_EXECUTOR_REQUEST_CONFLICT", "CONFLICT"],
    [400, "FINANCIAL_EXECUTOR_INPUT_INVALID", "BAD_REQUEST"], [409, "CALCULATOR_PRICE_AMBIGUOUS", "CONFLICT"],
  ])("maps the nominal %s %s error to %s", async (status, message, code) => {
    respond({ error: { code: message } }, status); await expect(invoke("create")).rejects.toMatchObject({ code, message }); expect(fetcher).toHaveBeenCalledTimes(1); noLegacy();
  });
  it("sanitizes provider exceptions and never retries an uncertain creation", async () => {
    fetcher.mockRejectedValue(new Error("Bearer secret SQL other-tenant"));
    const error = await invoke("create").catch(error => error);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR"); expect(error.message).not.toMatch(/Bearer|secret|SQL|other-tenant/); expect(error.cause).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1); noLegacy();
  });
  it("refuses redirect responses without using Location or exposing the upstream body", async () => {
    fetcher.mockResolvedValue(new Response("Bearer secret SQL", { status: 302, headers: { location: "https://elsewhere.test" } }));
    await expect(invoke("list")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); expect(fetcher).toHaveBeenCalledTimes(1); noLegacy();
  });
  it.each([
    { ...contextResult, projectId: ids.client }, { ...contextResult, intakeFormId: ids.client },
    { ...contextResult, tenantId: ids.tenant }, { ...contextResult, operation: "calculator.calculate" },
  ])("rejects mismatched or widened executor output %j", async result => {
    respond(result); await expect(invoke("list")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); noLegacy();
  });
  it.each(["requestId", "sourceHash", "calculationHash"])("binds creation receipt %s to the confirmed command", async field => {
    const result = receipt(); if (field === "requestId") result.requestId = ids.client;
    if (field === "sourceHash") result.creation.sourceHash = "c".repeat(64);
    if (field === "calculationHash") result.creation.calculationHash = "c".repeat(64);
    respond(result); await expect(invoke("create")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); noLegacy();
  });
  it("does not resolve a creation while the executor response remains pending", async () => {
    let finish!: (value: Response) => void; fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let completed = false; const pending = invoke("create").then(value => { completed = true; return value; });
    void pending.catch(() => undefined);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); expect(completed).toBe(false);
    finish(new Response(JSON.stringify(receipt()), { headers: { "content-type": "application/json" } }));
    expect(await pending).toEqual(receipt()); noLegacy();
  });
  it("preserves the direct legacy catalog contract", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct"); legacy.list.mockResolvedValue([{ id: ids.a, name: "Legacy" }]);
    expect(await invoke("list", { activeOnly: true })).toEqual([{ id: ids.a, name: "Legacy" }]); expect(legacy.list).toHaveBeenCalledWith({ activeOnly: true }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps contextual commands closed in direct mode without falling through to legacy SQL", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    await expect(invoke("calculate")).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(fetcher).not.toHaveBeenCalled(); noLegacy();
  });
});
