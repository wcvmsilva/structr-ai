/** Child of run.ts only. Real auth/router; isolated fixture and restricted preview. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { createFixtureRows, provisionFixture, sanitizeLabHtml, schemaForLabDdl, validateSelection, verifyOwnedDatabase } from "../../server/test-support/ed-pilot-lab";
import type { AppRouter } from "../../server/routers";

const configSchema = z.object({ root: z.string(), owned: z.object({ directory: z.string(), dataDirectory: z.string(), socketDirectory: z.string(), database: z.literal("postgres"), user: z.literal("ed_pilot_lab"), port: z.literal(5432) }), evidence: z.string(), selectionFile: z.string(), selectionSha256: z.string(), mode: z.enum(["verify", "preview"]), minutes: z.number().int().min(1).max(15) });
if (!process.env.ED_PILOT_LAB_CONFIG) throw new Error("Use the reviewed run.ts supervisor");
const config = configSchema.parse(JSON.parse(await readFile(process.env.ED_PILOT_LAB_CONFIG, "utf8")));
const { owned, root, evidence } = config;
assert.equal(process.env.PGHOST, owned.socketDirectory);
assert.equal(process.env.AUTH_PROVIDER, "legacy");
assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 && process.env.JWT_SECRET !== "dev-secret-key");
const source = await readFile(config.selectionFile);
assert.equal(createHash("sha256").update(source).digest("hex"), config.selectionSha256);
const selection = validateSelection(JSON.parse(source.toString("utf8")));
const checks: Record<string, unknown> = { scope: "Local fixture; legacy session; not Supabase, production, migration, or Lead-to-Export certification" };
const { getDb, getRawClient } = await import("../../server/db");
const db = await getDb();
const raw = getRawClient();
if (!db || !raw) throw new Error("Lab database client unavailable");
let vite: import("vite").ViteDevServer | undefined;
const server = createServer();
let stopPreview: (() => void) | undefined;
let checksPassed = false;
const completedClosers: string[] = [];
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stopPreview?.());

try {
  checks.identity = await verifyOwnedDatabase(raw, owned);
  const [before] = await raw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  assert.equal(before.count, 0, "Refuse schema creation in a nonempty database");
  const schema = await import("../../drizzle/schema");
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  // Schema exports include users = profiles. Serialize each actual table once;
  // preserve distinct definitions and their indexes/FKs without production edits.
  const snapshot = generateDrizzleJson(schemaForLabDdl(schema));
  const ddl = await generateMigration(generateDrizzleJson({}), snapshot);
  await raw.begin(async tx => { for (const statement of ddl) await tx.unsafe(statement); });
  const [after] = await raw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  assert.equal(after.count, Object.keys(snapshot.tables).length);
  checks.schema = { tables: after.count, statements: ddl.length, method: "Private empty-to-current-schema fixture DDL; no migration-only RLS/triggers/backfills" };

  // Exercise the actual provisioner, not a generic transaction. A private temporary
  // constraint fails its fourth insert, after tenant/profile/client were written.
  // There is no application record in this newly created database before this probe.
  await raw`ALTER TABLE projects ADD CONSTRAINT ed_pilot_rollback_probe CHECK (false)`;
  try {
    await assert.rejects(provisionFixture(db, raw, owned, selection), error => {
      assert.ok(error instanceof Error, "Expected the provisioner's database error");
      const cause = error.cause;
      assert.ok(cause && typeof cause === "object", "Expected the actual PostgreSQL constraint violation");
      assert.equal(Reflect.get(cause, "constraint_name"), "ed_pilot_rollback_probe");
      return true;
    });
    const [rolledBack] = await raw`SELECT (SELECT count(*)::int FROM tenants) AS tenants, (SELECT count(*)::int FROM profiles) AS operators, (SELECT count(*)::int FROM clients) AS clients, (SELECT count(*)::int FROM projects) AS projects, (SELECT count(*)::int FROM estimate_drafts) AS drafts, (SELECT count(*)::int FROM audit_logs) AS audits`;
    assert.deepEqual({ ...rolledBack }, { tenants: 0, operators: 0, clients: 0, projects: 0, drafts: 0, audits: 0 });
    checks.provisioningRollback = { verified: true, constraintName: "ed_pilot_rollback_probe", failureStage: "projects insert after tenant/profile/client", remainingRows: rolledBack };
  } finally {
    await raw`ALTER TABLE projects DROP CONSTRAINT ed_pilot_rollback_probe`;
  }

  const fixture = await provisionFixture(db, raw, owned, selection);
  assert.equal(fixture.created, true);
  assert.equal((await provisionFixture(db, raw, owned, selection)).created, false);
  const divergent = structuredClone(selection); divergent.customer.name += " changed";
  await assert.rejects(provisionFixture(db, raw, owned, divergent), /fixture mismatch/i);
  const [counts] = await raw`SELECT (SELECT count(*)::int FROM tenants) AS tenants, (SELECT count(*)::int FROM profiles) AS operators, (SELECT count(*)::int FROM clients) AS clients, (SELECT count(*)::int FROM projects) AS projects, (SELECT count(*)::int FROM estimate_drafts) AS drafts, (SELECT count(*)::int FROM audit_logs WHERE action = 'lab.fixture.insert') AS fixture_audits`;
  assert.deepEqual({ ...counts }, { tenants: 1, operators: 1, clients: 1, projects: 1, drafts: 1, fixture_audits: 5 });
  checks.idempotency = counts;
  const { default: postgres } = await import("postgres");
  const observer = postgres({ host: owned.socketDirectory, port: owned.port, database: owned.database, user: owned.user, password: "lab-local-socket-only", ssl: false, max: 1, prepare: false, connect_timeout: 5 });
  try {
    await verifyOwnedDatabase(observer, owned);
    const [persisted] = await observer`SELECT final_total_price, subtotal_cost, line_items FROM estimate_drafts WHERE id = ${fixture.draft.id}`;
    assert.equal(persisted.final_total_price, "1200.00"); assert.equal(persisted.subtotal_cost, "900.00"); assert.deepEqual(persisted.line_items, fixture.lines);
    checks.independentConnectionReadback = true;
  } finally { await observer.end({ timeout: 2 }); }

  const [{ default: express }, { createExpressMiddleware }, { appRouter }, { createContext }, { sdk, isDevBypassEnabled }, { COOKIE_NAME }, { getSessionCookieOptions }, { createTRPCProxyClient, httpLink }, { default: superjson }] = await Promise.all([
    import("express"), import("@trpc/server/adapters/express"), import("../../server/routers"), import("../../server/_core/context"), import("../../server/_core/sdk"), import("../../shared/const"), import("../../server/_core/cookies"), import("@trpc/client"), import("superjson"),
  ]);
  assert.equal(isDevBypassEnabled(), false);
  // >1 day avoids the legacy path's automatic seven-day refresh; browser cookie is short.
  const token = await sdk.createSessionToken(fixture.profile.externalOpenId, { name: fixture.profile.fullName, expiresInMs: 2 * 86_400_000 });
  const app = express();
  server.on("request", app);
  const allowed = new Set(["auth.me", "auth.session", "estimate.getById", "estimate.list", "estimate.profitShield", "estimate.exportAuthorization", "estimate.exportPreflight", "estimate.approveEstimate", "estimate.listExports"]);
  app.use((req, res, next) => {
    if (req.hostname !== "127.0.0.1" || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) { res.status(403).send("Lab accepts same-origin loopback only"); return; }
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/trpc", (req, res, next) => {
    const paths = decodeURIComponent(req.path.slice(1)).split(",");
    if (!paths.every(path => allowed.has(path))) { res.status(403).json({ error: "Outside the lab's reviewed router paths; uploads and integrations are disabled here." }); return; }
    next();
  }, createExpressMiddleware({ router: appRouter, createContext }));
  const nonce = randomBytes(32).toString("hex");
  let bootstrapUsed = false;
  app.get(`/__lab/session/${nonce}`, (req, res) => {
    if (config.mode !== "preview" || bootstrapUsed) { res.status(410).send("Lab session entry unavailable"); return; }
    bootstrapUsed = true;
    res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: config.minutes * 60_000 });
    res.redirect(303, `/estimates/${fixture.draft.id}`);
  });

  const envDir = join(owned.directory, "empty-vite-env");
  await mkdir(envDir, { mode: 0o700 });
  const [{ createServer: createViteServer }, { default: react }, { default: tailwind }] = await Promise.all([import("vite"), import("@vitejs/plugin-react"), import("@tailwindcss/vite")]);
  vite = await createViteServer({ configFile: false, root: join(root, "client"), envDir, cacheDir: join(owned.directory, "vite-cache"), publicDir: join(root, "client/public"), plugins: [react(), tailwind()], resolve: { alias: { "@": join(root, "client/src"), "@shared": join(root, "shared"), "@assets": join(root, "attached_assets") } }, server: { middlewareMode: true, host: "127.0.0.1", hmr: false, ws: false, allowedHosts: ["127.0.0.1"], fs: { strict: true, allow: [join(root, "client"), join(root, "shared"), join(root, "attached_assets"), await realpath(join(root, "node_modules"))], deny: ["**/.env*", "**/.git/**", "**/tmp/ed-pilot/**"] } }, appType: "custom" });
  app.use(vite.middlewares);
  app.use(async (req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/__lab/")) { res.status(404).end(); return; }
    try { res.type("html").send(await vite!.transformIndexHtml(req.originalUrl, sanitizeLabHtml(await readFile(join(root, "client/index.html"), "utf8")))); }
    catch (error) { next(error); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const blockedUploadRoutes: Record<string, number> = {};
  for (const route of ["estimate.exportPdf", "estimate.exportJson", "estimate.exportCsv"]) {
    const response = await fetch(`${baseUrl}/api/trpc/${route}`, { method: "POST", headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${token}` }, body: JSON.stringify({ json: { id: fixture.draft.id } }) });
    assert.equal(response.status, 403, `Lab must block upload route ${route} before the business procedure`);
    await response.text();
    blockedUploadRoutes[route] = response.status;
  }
  checks.labBlockedUploadRoutes = blockedUploadRoutes;
  const api = (cookie?: string) => createTRPCProxyClient<AppRouter>({ links: [httpLink({ url: `${baseUrl}/api/trpc`, transformer: superjson, headers: cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {} })] });
  const authenticated = api(token);
  assert.equal(await api().auth.me.query(), null);
  await assert.rejects(api().estimate.getById.query({ id: fixture.draft.id }), /login|unauthorized|authenticate/i);
  const parts = token.split("."); parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  await assert.rejects(api(parts.join(".")).estimate.getById.query({ id: fixture.draft.id }), /login|unauthorized|authenticate/i);
  const expired = await sdk.createSessionToken(fixture.profile.externalOpenId, { name: fixture.profile.fullName, expiresInMs: -1000 });
  await assert.rejects(api(expired).estimate.getById.query({ id: fixture.draft.id }), /login|unauthorized|authenticate/i);
  assert.equal((await authenticated.auth.me.query())?.id, fixture.profile.id);
  const draft = await authenticated.estimate.getById.query({ id: fixture.draft.id });
  assert.equal(draft.finalTotalPrice, "1200.00"); assert.equal(draft.subtotalCost, "900.00"); assert.deepEqual(draft.lineItems, fixture.lines);
  const secondRead = await api(token).estimate.getById.query({ id: fixture.draft.id });
  assert.equal(secondRead.id, draft.id);
  assert.equal((await authenticated.estimate.list.query()).items.length, 1);
  checks.realHttpLegacyAuth = { authenticated: true, noCookieRejected: true, tamperedCookieRejected: true, expiredCookieRejected: true, bypassEnabled: false, repeatedRead: true };
  checks.profitShield = await authenticated.estimate.profitShield.query({ id: draft.id });
  assert.equal((checks.profitShield as { blocked: boolean }).blocked, true);
  await assert.rejects(authenticated.estimate.approveEstimate.mutate({ id: draft.id }), /Profit Shield/i);
  checks.exportAuthorization = await authenticated.estimate.exportAuthorization.query({ id: draft.id });
  assert.equal((checks.exportAuthorization as { authorized: boolean }).authorized, false);
  await assert.rejects(authenticated.estimate.exportPreflight.mutate({ id: draft.id }), /approved/i);
  const attempts = await authenticated.estimate.listExports.query({ id: draft.id });
  assert.equal(attempts.length, 1); assert.equal(attempts[0].status, "blocked_authorization");
  const finalDraft = await authenticated.estimate.getById.query({ id: draft.id });
  assert.equal(finalDraft.status, "draft"); assert.equal(finalDraft.approvedBy, null); assert.equal(finalDraft.approvedAt, null); assert.equal(finalDraft.lockedAt, null);
  checks.approvalAndExport = { approvalBlocked: true, preflightBlocked: true, recordedAttempt: attempts[0].status, draftUnchanged: true, storageBoundary: "Upload routes are absent from the lab allowlist; the exercised blocked preflight path was reviewed. Outbound storage calls were not instrumented." };
  const html = await fetch(`${baseUrl}/estimates/${draft.id}`);
  assert.equal(html.status, 200);
  assert.ok(!/fonts\.google|VITE_ANALYTICS|\/umami/.test(await html.text()));
  assert.ok(html.headers.get("content-security-policy")?.includes("font-src 'self' data:"));
  checks.htmlServed = true; checks.browserObserved = false;
  await writeFile(join(evidence, "application-checks.json"), JSON.stringify(checks, null, 2), { mode: 0o600 });
  checksPassed = true;
  if (config.mode === "preview") {
    const entryFile = join(evidence, "browser-entry.txt");
    await writeFile(entryFile, `${baseUrl}/__lab/session/${nonce}\n`, { mode: 0o600 });
    await writeFile(join(evidence, "ready.json"), JSON.stringify({ baseUrl, applicationPid: process.pid, draftId: draft.id, browserEntryFile: entryFile, expiresAt: new Date(Date.now() + config.minutes * 60_000).toISOString(), stop: "Send SIGTERM to the recorded supervisor PID; it owns application and PostgreSQL cleanup." }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ previewReady: true, baseUrl, readyFile: join(evidence, "ready.json") }));
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, config.minutes * 60_000); stopPreview = () => { clearTimeout(timer); resolve(); }; });
  }
} catch (error) {
  await writeFile(join(evidence, "application-checks.json"), JSON.stringify({ ...checks, failed: true, failure: error instanceof Error ? error.message : String(error), browserObserved: false }, null, 2), { mode: 0o600 });
  process.exitCode = 1;
} finally {
  const recordTeardown = (stage: string) => {
    const resources = process.getActiveResourcesInfo().reduce<Record<string, number>>((counts, type) => {
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({ teardown: stage, at: new Date().toISOString(), activeResources: resources }));
  };
  recordTeardown("teardown:start");
  const cleanupErrors: unknown[] = [];
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["vite:closed", async () => vite?.close()],
    ["http:closed", async () => {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }],
    ["postgres:ended", async () => raw.end({ timeout: 3 })],
    ["esbuild:stopped", async () => (await import("esbuild")).stop()],
  ];
  // Attempt every owned-resource cleanup even if an earlier closer rejects.
  for (const [stage, close] of steps) {
    try { await close(); completedClosers.push(stage); recordTeardown(stage); }
    catch (error) { cleanupErrors.push(error); recordTeardown(`${stage}:failed`); }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Lab cleanup failed");
}

// This disposable CLI deliberately ends after verified teardown. Some installed
// build/loader dependencies retain a ProcessWrap despite successful public close
// calls; explicit exit is recorded honestly and never converts an error to success.
assert.deepEqual(completedClosers, ["vite:closed", "http:closed", "postgres:ended", "esbuild:stopped"]);
if (!checksPassed) process.exitCode = Number(process.exitCode) || 1;
const finalExitCode = process.exitCode ?? 0;
const activeResourcesByType = process.getActiveResourcesInfo().reduce<Record<string, number>>((counts, type) => {
  counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}, {});
await writeFile(join(evidence, "lifecycle-complete.json"), JSON.stringify({ checksPassed, completedClosers, allClosersCompleted: true, exitCode: finalExitCode, exitStrategy: "explicit-after-verified-teardown", activeResourcesByType, at: new Date().toISOString(), descendantProcessAbsence: "Requires independent supervisor observation after exit; not inferred from close callbacks." }, null, 2), { mode: 0o600 });
await Promise.all([
  new Promise<void>((resolve, reject) => process.stdout.write("", error => error ? reject(error) : resolve())),
  new Promise<void>((resolve, reject) => process.stderr.write("", error => error ? reject(error) : resolve())),
]);
process.exit(finalExitCode);
