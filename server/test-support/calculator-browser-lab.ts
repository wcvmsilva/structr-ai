/** Opt-in local browser lab: actual page, hooks, tRPC, signed executor and owned PG17.
 * Synthetic boundaries: Supabase SDK, web bootstrap profile/permissions, and the executor
 * fetch wire. JWT verification, page/session hooks, routers and SQL execute for real. This
 * does not attest production PostgREST bootstrap, hosted Auth or external TLS. No hosted
 * credential/customer record/connection is used. Never imported by the product.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { startFinancialCalculatorBoundary, setupCalculatorLifecycleFixture } from "./financial-calculator-boundary";
import { signedExecutorAuthFixture, executorTestConfig } from "./financial-executor-auth";
import { createExecutorTransactionRunner } from "../../services/financial-executor/src/transaction";
import { createFinancialExecutorHandler } from "../../services/financial-executor/src/handler";
import { executeFinancialCalculator } from "../financial-calculator-db";
import { router } from "../_core/trpc";
import { assemblyRouter } from "../assembly-router";
import { estimateRouter } from "../estimate-router";
import { authRouter } from "../auth-router";
import type { TrpcContext } from "../_core/context";
import { fileURLToPath } from "node:url";

if (process.env.STRUCTR_CALCULATOR_BROWSER_LAB !== "1" || process.env.NODE_ENV !== "test")
  throw new Error("Browser lab requires explicit local test opt-in");
const root = fileURLToPath(new URL("../../", import.meta.url));
const lab = await startFinancialCalculatorBoundary();
let runner: ReturnType<typeof createExecutorTransactionRunner> | undefined;
let server: ReturnType<typeof createServer> | undefined;
const originalFetch = globalThis.fetch;
let stopped = false;
async function stop() {
  if (stopped) return; stopped = true;
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
  globalThis.fetch = originalFetch;
  await runner?.close(); await lab.stop();
}
process.once("SIGTERM", () => { void stop().then(() => process.exit(0)); });
process.once("SIGINT", () => { void stop().then(() => process.exit(0)); });
try {
  await lab.install();
  await lab.admin.begin(async tx => { await tx.unsafe(await readFile(new URL("../../drizzle/0021_financial_calculator_lifecycle.sql", import.meta.url), "utf8")); });
  const fixture = await setupCalculatorLifecycleFixture(lab);
  // Match the production two-slot runner with separately owned driver connections.
  const databases = [(await lab.connectLogin()).db, (await lab.connectLogin()).db];
  const config = { ...executorTestConfig, auth: { ...executorTestConfig.auth, operatorSubject: fixture.ids.subject,
    actorId: fixture.ids.actor, tenantId: fixture.ids.tenant } };
  const nowMs = () => Date.now();
  const auth = await signedExecutorAuthFixture({ config, nowMs, expiresAtMs: Date.now() + 3600000 });
  runner = createExecutorTransactionRunner(config, { createDatabase: () => {
    const database = databases.shift();
    if (!database) throw new Error("Browser lab exhausted its owned database slots");
    return database;
  }, nowMs });
  const handler = createFinancialExecutorHandler({ authenticator: auth.authenticator,
    execute: (operator, command, options) => executeFinancialCalculator(runner!, operator, command, options) });
  process.env.STRUCTR_DATABASE_MODE = "authenticated-data-api";
  process.env.STRUCTR_FINANCIAL_CALCULATOR_ENABLED = "true";
  process.env.STRUCTR_FINANCIAL_EXECUTOR_ORIGIN = "https://calculator-browser.example.invalid";
  const commands: { operation: string; requestId?: string }[] = [];
  let loseNextCreate = false;
  globalThis.fetch = async (input, init) => {
    if (String(input) !== "https://calculator-browser.example.invalid/api/execute" || init?.method !== "POST" || init.redirect !== "error")
      throw new Error("Browser lab refuses an unexpected outbound request");
    const headers = Object.fromEntries(new Headers(init.headers));
    const command = JSON.parse(String(init.body));
    commands.push({ operation: command.operation, ...(command.requestId ? { requestId: command.requestId } : {}) });
    const result = await handler.handle({ method: "POST", headers, rawHeaders: Object.entries(headers).flat(), body: init.body });
    if (loseNextCreate && command.operation === "calculator.create" && result.status === 200) {
      loseNextCreate = false; throw new Error("Synthetic response loss after confirmed commit");
    }
    return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers });
  };
  const bootstrap = {
    access_token: auth.token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "synthetic-unusable-refresh", user: { id: fixture.ids.subject, email: "synthetic@example.invalid", aud: "authenticated" },
  };
  const sdkSource = `
    export const SUPABASE_URL='https://executor-auth.example.invalid', SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic', SUPABASE_STORAGE_KEY='local-browser-lab-auth';
    export const isSupabaseConfigured=()=>true;
    const listeners=new Set();
    const client={auth:{getSession:async()=>({data:{session:window.__calculatorLabSession},error:null}),onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe(){listeners.delete(fn)}}}}},signOut:async()=>{window.__calculatorLabSession=null;for(const fn of listeners)fn('SIGNED_OUT',null);return {error:null}}}};
    export const getSupabaseClient=()=>client,requireSupabaseClient=()=>client;
    window.__calculatorLabSignOut=()=>client.auth.signOut();
  `;
  const entry = `
    import React,{Fragment,useSyncExternalStore} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {httpBatchLink} from '@trpc/client';
    import superjson from 'superjson';
    import {trpc} from './client/src/lib/trpc';
    import Calculator from './client/src/pages/Calculator';
    import {getAuthSessionSnapshot,subscribeAuthSession,initSupabaseAuthBridge} from './client/src/lib/auth-token';
    import {authSessionLink,buildSessionAuthHeaders,bindAuthSessionCache} from './client/src/lib/auth-session-cache';
    window.__calculatorLabSession=await fetch('/_lab/session').then(r=>r.json());
    const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    bindAuthSessionCache(cache);
    const client=trpc.createClient({links:[authSessionLink,httpBatchLink({url:'/api/trpc',transformer:superjson,headers:({opList})=>buildSessionAuthHeaders(opList)})]});
    function SessionBoundary(){const {generation}=useSyncExternalStore(subscribeAuthSession,getAuthSessionSnapshot,getAuthSessionSnapshot);return <Fragment key={generation}><Calculator/></Fragment>}
    await initSupabaseAuthBridge();
    createRoot(document.getElementById('root')).render(<trpc.Provider client={client} queryClient={cache}><QueryClientProvider client={cache}><SessionBoundary/></QueryClientProvider></trpc.Provider>);
  `;
  const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "calculator-local-browser.tsx", loader: "tsx" },
    absWorkingDir: root, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "import.meta.env": JSON.stringify({ VITE_AUTH_PROVIDER: "supabase", DEV: true }) },
    plugins: [{ name: "synthetic-browser-sdk", setup(builder) {
      builder.onResolve({ filter: /supabase$/ }, args => {
        if (args.path === "@/lib/supabase" || args.path === "./supabase") return { path: "synthetic-sdk", namespace: "local-lab" };
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "local-lab" }, () => ({ contents: sdkSource, loader: "js" }));
    } }] });
  const api = router({ auth: authRouter, assembly: assemblyRouter, estimate: estimateRouter });
  const app = express();
  app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.post("/_lab/stop", (_req, res) => { res.json({ stopping: true }); void stop(); });
  app.get("/_lab/session", (_req, res) => res.json(bootstrap));
  app.get("/_lab/evidence", async (_req, res) => {
    const [counts] = await lab.admin`select (select count(*) from public.estimate_drafts)::int as drafts,
      (select count(*) from structr_financial.calculator_requests)::int as requests,
      (select count(*) from public.audit_logs where action='estimate_draft.create')::int as audits`;
    res.json({ counts, commands });
  });
  app.post("/_lab/lose-next-create", (_req, res) => { loseNextCreate = true; res.json({ ready: true }); });
  app.post("/_lab/price/:value", async (req, res) => {
    if (!["100", "101"].includes(req.params.value)) { res.sendStatus(400); return; }
    await lab.admin`update public.cost_code_pricing_history set unit_price=${req.params.value} where id='c3000000-0000-4000-8000-000000000401'`;
    res.json({ changed: true });
  });
  app.use("/api/trpc", createExpressMiddleware({ router: api, createContext: async ({ req, res }) => {
    let valid = true; try { await auth.authenticator.authenticate(req); } catch { valid = false; }
    const profile = { id: fixture.ids.actor, externalOpenId: fixture.ids.subject, tenantId: fixture.ids.tenant, role: "financial_operator", isActive: true };
    return { req, res, authProvider: "supabase", user: valid ? profile : null, tenantId: valid ? fixture.ids.tenant : null,
      ...(valid ? { authenticatedDataApiSession: { version: "structr-authenticated-session-v1", profile, tenantId: fixture.ids.tenant,
        permissions: { slugs: ["estimate.create", "project.write"], isPlatformAdmin: false } } } : {}) } as unknown as TrpcContext;
  } }));
  app.get("/calculator-lab.js", (_req, res) => res.type("text/javascript").send(bundle.outputFiles[0].text));
  app.get("*", (_req, res) => res.type("html").send('<!doctype html><html><head><meta charset="UTF-8"><title>Calculator local proof</title><style>body{font-family:Arial,sans-serif;margin:24px}button,input,select{margin:6px;padding:8px}button{cursor:pointer}h1,h2{margin:20px 0}table{border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #ccc}</style></head><body><p>Local synthetic laboratory — no field approval</p><div id="root"></div><script type="module" src="/calculator-lab.js"></script></body></html>'));
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing owned loopback listener");
  console.log("CALCULATOR_BROWSER_LAB_READY", JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, pid: process.pid, pair: { projectId: fixture.ids.project, intakeFormId: fixture.ids.intake } }));
} catch (error) { await stop(); throw error; }
