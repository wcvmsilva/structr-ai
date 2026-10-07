/** Real HTTP verifier, role switch and SQL. Only fixture writers use redirected getDb. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { startAdr002Postgrest, type Adr002Postgrest, type RpcResult } from "./test-support/adr002-postgrest";
import { seedAdr002Fixture, seedAdr002Identity, type LabIdentity } from "./test-support/adr002-fixtures";
const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { getInternalApprovalReview } from "./internal-estimate-approval-db";
import { buildAuthenticatedInternalApprovalReview } from "./authenticated-internal-approval-review";
import { callAuthenticatedReview } from "./authenticated-data-api";

const sessionRpc = "structr_authenticated_session_v1";
const reviewRpc = "structr_internal_approval_review_v1";

describe.skipIf(process.env.ADR002_PHYSICAL !== "1")("ADR002 real ES256 → PostgREST → PostgreSQL", () => {
  let lab: Adr002Postgrest;
  let identity: LabIdentity;
  const tenant = randomUUID();
  const bearer = (actor = identity, overrides: Record<string, unknown> = {}) =>
    lab.token({ sub: actor.sub, session_id: actor.session, ...overrides });
  beforeAll(async () => {
    lab = await startAdr002Postgrest();
    deps.getDb.mockImplementation(async () => lab.cluster.observer.db);
    await lab.sql`INSERT INTO public.tenants(id,name,slug,is_active) VALUES(${tenant},'ADR002 synthetic tenant',${`adr002-${tenant}`},true)`;
    identity = await seedAdr002Identity(lab, tenant);
  }, 60_000);
  afterAll(async () => { deps.getDb.mockReset(); await lab?.stop(); }, 30_000);

  // Rejections must originate in the real HTTP JWT verifier (401), never an absent RPC (404).
  function jwtRejected(result: RpcResult) {
    expect(result.status).toBe(401);
    expect(result.body.code).toMatch(/^PGRST30[13]$/);
    expect(result.body).not.toHaveProperty("profile");
  }
  it("rejects ES256 signed by another private key", async () => {
    jwtRejected(await lab.rpc(sessionRpc, await lab.token({ sub: identity.sub, session_id: identity.session }, true)));
  });
  it("rejects payload replacement while retaining the original ES256 signature", async () => {
    const parts = (await bearer()).split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: randomUUID(), role: "authenticated", aud: "authenticated" })).toString("base64url");
    jwtRejected(await lab.rpc(sessionRpc, parts.join(".")));
  });
  it("rejects alg none even for a known subject", async () => {
    const payload = (await bearer()).split(".")[1];
    jwtRejected(await lab.rpc(sessionRpc, `${Buffer.from('{"alg":"none"}').toString("base64url")}.${payload}.`));
  });
  it("rejects a malformed compact bearer", async () => { jwtRejected(await lab.rpc(sessionRpc, "not.a.jwt")); });
  it("rejects an expired signed JWT before the RPC executes", async () => {
    jwtRejected(await lab.rpc(sessionRpc, await bearer(identity, { exp: Math.floor(Date.now() / 1000) - 120 })));
  });
  it("rejects a future not-before claim before the RPC executes", async () => {
    jwtRejected(await lab.rpc(sessionRpc, await bearer(identity, { nbf: Math.floor(Date.now() / 1000) + 120 })));
  });
  it("rejects a JWT addressed to a different audience", async () => {
    jwtRejected(await lab.rpc(sessionRpc, await bearer(identity, { aud: "other-service" })));
  });

  // Explicit RED mode retains a domain assertion against the live missing operation.
  describe.skipIf(process.env.ADR002_RPC_RED !== "1")("preimplementation functional RED", () => {
    it("resolves a signed subject to its mapped active profile", async () => {
      expect(await lab.rpc(sessionRpc, await bearer())).toMatchObject({ status: 200,
        body: { version: "structr-authenticated-session-v1", profile: { id: identity.id, tenantId: tenant } } });
    });
    it("executes review and returns domain NOT_FOUND for an unknown draft", async () => {
      expect(await lab.rpc(reviewRpc, await bearer(), { command: { id: randomUUID(), confirmedCurrencyCode: "USD" } }))
        .toMatchObject({ status: 400, body: { code: "P0001", message: "NOT_FOUND" } });
    });
  });

  // The earlier Auth-liveness proposal was not adopted. Its stronger guarantees
  // are recorded in adr002-postgrest.md, not counted as passing or pending tests.
  describe.skipIf(process.env.ADR002_BOUNDED_CONTRACT !== "1")("bounded JWT RPC contract", () => {
    let fixture: Awaited<ReturnType<typeof seedAdr002Fixture>>;
    beforeAll(async () => {
      if (!lab.boundaryPresent) throw new Error("ADR002_BOUNDED_CONTRACT=1 requires explicit ADR002_APPLY_BOUNDARY=1");
      fixture = await seedAdr002Fixture(lab);
    });
    const review = async (actor = fixture.a1, command: unknown = { id: fixture.draft.id, confirmedCurrencyCode: "USD" }) =>
      lab.rpc(reviewRpc, await bearer(actor), { command });
    function forbidden(result: RpcResult) { expect(result).toMatchObject({ status: 403, body: { code: "42501", message: "FORBIDDEN" } }); }
    function domainDenied(result: RpcResult, message = "FORBIDDEN") { expect(result).toMatchObject({ status: 400, body: { code: "P0001", message } }); }
    async function fresh() { return seedAdr002Identity(lab, fixture.tenant); }
    const delay = (ms: number) => new Promise(done => setTimeout(done, ms));
    function latch<T = void>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>(done => { resolve = done; });
      return { promise, resolve };
    }
    async function waitForBlockedBy(pid: number) {
      for (let attempt = 0; attempt < 150; attempt++) {
        const rows = await lab.sql`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE usename='authenticator' AND ${pid}::int=ANY(pg_blocking_pids(pid))`;
        if (rows.length === 1) return rows[0];
        await delay(10);
      }
      throw new Error("The real PostgREST transaction never reached the expected lock edge");
    }
    async function withPhysicalTransport<T>(run: (exchanges: Array<{ status: number; code?: string }>) => Promise<T>) {
      const actualFetch = globalThis.fetch.bind(globalThis);
      const exchanges: Array<{ status: number; code?: string }> = [];
      vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
      vi.stubEnv("AUTH_PROVIDER", "supabase"); vi.stubEnv("TENANT_STRICT", "true");
      vi.stubEnv("SUPABASE_URL", "https://adr002-local.invalid");
      vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_local_transport");
      // Only destination translation is test-owned. Bearer/body and every HTTP
      // response pass unchanged to/from the real cryptographic service.
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.origin !== "https://adr002-local.invalid" || !url.pathname.startsWith("/rest/v1/rpc/")) {
          throw new Error("Unexpected physical transport destination");
        }
        const response = await actualFetch(`${lab.baseUrl}${url.pathname.slice('/rest/v1'.length)}`, init);
        const body = await response.clone().json();
        exchanges.push({ status: response.status, ...(body.code ? { code: body.code } : {}) });
        return response;
      });
      try { return await run(exchanges); }
      finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
    }
    async function concurrentReview(kind: "draft" | "membership" | "profile", actor: LabIdentity) {
      const writer = await lab.connectSupervisor();
      const ready = latch<number>(), release = latch();
      const transaction = writer.begin(async tx => {
        const [backend] = await tx`SELECT pg_backend_pid() AS pid`;
        if (kind === "profile") await tx`SELECT id FROM public.profiles WHERE id=${actor.id} FOR UPDATE`;
        else await tx`SELECT id FROM public.projects WHERE id=${fixture.projectId} FOR UPDATE`;
        ready.resolve(backend.pid);
        await release.promise;
        if (kind === "draft") await tx`UPDATE public.estimate_drafts SET notes='Synthetic concurrently changed notes' WHERE id=${fixture.draft.id}`;
        if (kind === "membership") await tx`UPDATE public.project_members SET is_active=false WHERE project_id=${fixture.projectId} AND user_id=${actor.id}`;
        if (kind === "profile") await tx`UPDATE public.profiles SET is_active=false WHERE id=${actor.id}`;
      });
      try {
        const pid = await ready.promise;
        return await withPhysicalTransport(async exchanges => {
          const pending = callAuthenticatedReview({ headers: { authorization: `Bearer ${await bearer(actor)}` } },
            { id: fixture.draft.id, confirmedCurrencyCode: "USD" }).then(value => ({ value }), error => ({ error }));
          await waitForBlockedBy(pid);
          release.resolve(); await transaction;
          return { ...(await pending), exchanges };
        });
      } finally { release.resolve(); await transaction; await writer.end(); }
    }

    it("unmodified legacy replay refuses installation before distinct laboratory containment", () => {
      expect(lab.freshReplayPreflight).toMatchObject({ code: "42501", objectsRolledBack: true });
      expect(lab.freshReplayPreflight?.message).toMatch(/^ADR002_BUSINESS_(FUNCTION|TABLE)_PREFLIGHT:/);
    });
    it.each(["column grant", "switchable role", "restrictive evidence policy", "unknown executable function", "unknown readable view"])
      ("preflight refuses %s and rolls its injected drift back", name => {
        const observation = lab.preflightDrift.find(item => item.name === name);
        expect(observation?.code).toBe("42501");
        expect(observation?.message).toMatch(/^ADR002_[A-Z_]+PREFLIGHT/);
      });

    it("resolves DB identity despite forged actor, tenant and admin metadata in JWT", async () => {
      const result = await lab.rpc(sessionRpc, await bearer(fixture.a1, { tenant_id: fixture.otherTenant, actor_id: fixture.b1.id, user_metadata: { role: "admin" } }));
      expect(result).toMatchObject({ status: 200, body: { version: "structr-authenticated-session-v1", tenantId: fixture.tenant,
        profile: { id: fixture.a1.id, tenantId: fixture.tenant, externalOpenId: fixture.a1.sub, role: "user" }, permissions: { isPlatformAdmin: false } } });
      expect(JSON.stringify(result.body)).not.toContain("eyJ");
    });
    it("A1 approve-capable member receives the exact calculated identity, amounts and original lines", async () => {
      expect(await review()).toMatchObject({ status: 200, body: { version: "structr-authenticated-review-v1",
        context: { actorId: fixture.a1.id, tenantId: fixture.tenant }, rows: {
          draft: { id: fixture.draft.id, tenantId: fixture.tenant, projectId: fixture.projectId, clientId: fixture.clientId,
            finalTotalPrice: "100.00", subtotalCost: "40.00", lineItems: fixture.draft.lineItems }, profile: { id: fixture.a1.id } },
        approvalEvidence: { snapshots: [], approvals: [], revocations: [] } } });
    });
    it("matches the existing A1 review engine without repricing or changing evidence", async () => {
      const reference = await getInternalApprovalReview({ id: fixture.draft.id, confirmedCurrencyCode: "USD" }, fixture.a1.id, fixture.tenant);
      const result = await review(); expect(result.status).toBe(200);
      const actual = await buildAuthenticatedInternalApprovalReview(result.body,
        { id: fixture.draft.id, confirmedCurrencyCode: "USD" }, { actorId: fixture.a1.id, tenantId: fixture.tenant });
      expect(actual).toEqual(reference);
      expect(actual.snapshot.financials).toMatchObject({ finalPriceMinor: "10000", estimatedCostMinor: "4000" });
    });
    it("repeated review is read-only and returns the same snapshot", async () => {
      const counts = () => lab.sql`SELECT (SELECT count(*) FROM public.audit_logs)::int AS audits,
        (SELECT count(*) FROM public.estimate_internal_approvals)::int AS approvals,
        (SELECT count(*) FROM public.estimate_internal_approval_snapshots)::int AS snapshots`;
      const before = await counts(), first = await review(), second = await review();
      expect(first.status).toBe(200); expect(second).toEqual(first); expect(await counts()).toEqual(before);
    });
    it("A2 viewer cannot review an approval decision", async () => { domainDenied(await review(fixture.a2)); });
    it.each([{ label: "SQL NULL", value: null }, { label: "empty array", value: "[]" }])("viewer permissions $label cannot grant approve", async ({ value }) => {
      const actor = await fresh();
      await lab.sql`INSERT INTO public.project_members(tenant_id,project_id,user_id,project_role,permissions)
        VALUES(${fixture.tenant},${fixture.projectId},${actor.id},'viewer',${value}::jsonb)`;
      domainDenied(await review(actor));
      await expect(getInternalApprovalReview({ id: fixture.draft.id, confirmedCurrencyCode: "USD" }, actor.id, fixture.tenant)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("physical NOT NULL role constraint rejects a null membership role", async () => {
      const actor = await fresh();
      await expect(lab.sql`INSERT INTO public.project_members(tenant_id,project_id,user_id,project_role,permissions)
        VALUES(${fixture.tenant},${fixture.projectId},${actor.id},NULL,NULL)`).rejects.toMatchObject({ code: "23502" });
      domainDenied(await review(actor));
    });
    it("B1 admin cannot cross the tenant boundary", async () => { domainDenied(await review(fixture.b1), "NOT_FOUND"); });
    it("one HTTP pool connection alternates A1, B1, anonymous and A1 without identity leakage", async () => {
      const before = await lab.sql`SELECT pid FROM pg_stat_activity WHERE usename='authenticator'`;
      expect((await review()).status).toBe(200); domainDenied(await review(fixture.b1), "NOT_FOUND");
      expect((await lab.rpc(reviewRpc, null, { command: { id: fixture.draft.id, confirmedCurrencyCode: "USD" } })).status).toBe(401);
      expect(await review()).toMatchObject({ status: 200, body: { context: { actorId: fixture.a1.id, tenantId: fixture.tenant } } });
      expect(await lab.sql`SELECT pid FROM pg_stat_activity WHERE usename='authenticator'`).toEqual(before);
      expect(before).toHaveLength(1);
    });
    it.each([
      ["missing exp", { exp: undefined }],
      ["missing issuer", { iss: undefined }], ["wrong issuer", { iss: "https://wrong.invalid/auth/v1" }],
      ["missing session", { session_id: undefined }], ["malformed session", { session_id: "not-a-uuid" }],
      ["missing subject", { sub: undefined }], ["zero subject", { sub: "00000000-0000-0000-0000-000000000000" }],
      ["anonymous user", { is_anonymous: true }], ["missing anonymous declaration", { is_anonymous: undefined }],
    ])("denies signed claims with %s", async (_name, claims) => { forbidden(await lab.rpc(sessionRpc, await bearer(fixture.a1, claims))); });
    it("PostgREST rejects fractional expiration before SQL executes", async () => {
      const result = await lab.rpc(sessionRpc, await bearer(fixture.a1, { exp: Math.floor(Date.now() / 1000) + 600.5 }));
      expect(result).toMatchObject({ status: 401, body: { code: "PGRST303", message: "JWT expired" } });
      expect(result.body).not.toHaveProperty("profile");
    });
    it.each([899, 900])("accepts an original signed lifetime of %i seconds", async lifetime => {
      const now = Math.floor(Date.now() / 1000);
      expect((await lab.rpc(sessionRpc, await bearer(fixture.a1, { iat: now, exp: now + lifetime }))).status).toBe(200);
    });
    it.each([901, 3600])("rejects an original lifetime of %i seconds even close to expiry", async lifetime => {
      const now = Math.floor(Date.now() / 1000);
      forbidden(await lab.rpc(sessionRpc, await bearer(fixture.a1, { iat: now + 30 - lifetime, exp: now + 30 })));
    });
    it("rejects remaining lifetime above 900 even within the iat future allowance", async () => {
      const now = Math.floor(Date.now() / 1000);
      forbidden(await lab.rpc(sessionRpc, await bearer(fixture.a1, { iat: now + 20, exp: now + 920 })));
    });
    it("rejects missing issued-at claim", async () => {
      forbidden(await lab.rpc(sessionRpc, await bearer(fixture.a1, { iat: undefined })));
    });
    it("rejects issued-at beyond the 30-second future allowance", async () => {
      const now = Math.floor(Date.now() / 1000);
      const result = await lab.rpc(sessionRpc, await bearer(fixture.a1, { iat: now + 60, exp: now + 600 }));
      expect(result).toMatchObject({ status: 401, body: { code: "PGRST303", message: "JWT issued at future" } });
      expect(result.body).not.toHaveProperty("profile");
    });
    it("accepts a string-only audience array containing authenticated", async () => {
      expect((await lab.rpc(sessionRpc, await bearer(fixture.a1, { aud: ["authenticated", "other"] }))).status).toBe(200);
    });
    it("auth tables retain RLS, separate ownership, no policies and no access by the definer", async () => {
      const rows = await lab.sql`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
        has_table_privilege('structr_review_owner_v1',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS table_access,
        has_any_column_privilege('structr_review_owner_v1',c.oid,'SELECT,INSERT,UPDATE') AS column_access
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
        WHERE n.nspname='auth' AND c.relname IN ('users','sessions') ORDER BY c.relname`;
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: false,
        rolname: "supabase_auth_admin", policies: 0, table_access: false, column_access: false });
      expect((await lab.rpc(sessionRpc, await bearer(fixture.a1))).status).toBe(200);
    });
    it("public bound wrapper succeeds while private schema lookup and private HTTP route are denied", async () => {
      expect((await lab.rpc(sessionRpc, await bearer(fixture.a1))).status).toBe(200);
      await expect(lab.sql.begin(async tx => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT structr_private.authenticated_session_v1()`;
      })).rejects.toMatchObject({ code: "42501" });
      expect((await lab.rpc("authenticated_session_v1", await bearer(fixture.a1))).status).toBe(404);
    });
    it("Auth logout alone leaves an issued bounded JWT valid, but organizational revocation denies it", async () => {
      const actor = await fresh(), token = await bearer(actor);
      expect((await lab.rpc(sessionRpc, token)).status).toBe(200);
      await lab.sql`DELETE FROM auth.sessions WHERE id=${actor.session}`;
      await lab.sql`UPDATE auth.users SET banned_until=now()+interval '1 hour',deleted_at=now() WHERE id=${actor.sub}`;
      expect((await lab.rpc(sessionRpc, token)).status).toBe(200);
      await lab.sql`UPDATE public.profiles SET is_active=false WHERE id=${actor.id}`;
      forbidden(await lab.rpc(sessionRpc, token));
    });
    it("denies an inactive profile without cached session fallback", async () => {
      const actor = await fresh(), token = await bearer(actor); expect((await lab.rpc(sessionRpc, token)).status).toBe(200);
      await lab.sql`UPDATE public.profiles SET is_active=false WHERE id=${actor.id}`; forbidden(await lab.rpc(sessionRpc, token));
    });
    it("denies an external subject after removal of its explicit mapping", async () => {
      const actor = await fresh(); await lab.sql`UPDATE public.profiles SET external_open_id=NULL WHERE id=${actor.id}`;
      forbidden(await lab.rpc(sessionRpc, await bearer(actor)));
    });
    it("denies an inactive tenant", async () => {
      const id = randomUUID();
      await lab.sql`INSERT INTO public.tenants(id,name,slug,is_active) VALUES(${id},'Synthetic inactive tenant',${`adr002-${id}`},false)`;
      forbidden(await lab.rpc(sessionRpc, await bearer(await seedAdr002Identity(lab, id))));
    });
    it("revoked membership removes approve authority from the same JWT", async () => {
      const actor = await fresh();
      await lab.sql`INSERT INTO public.project_members(tenant_id,project_id,user_id,project_role) VALUES(${fixture.tenant},${fixture.projectId},${actor.id},'estimator')`;
      expect((await review(actor)).status).toBe(200);
      await lab.sql`UPDATE public.project_members SET is_active=false WHERE user_id=${actor.id} AND project_id=${fixture.projectId}`;
      domainDenied(await review(actor));
    });
    it("explicit approve permission permits review for a viewer membership", async () => {
      const actor = await fresh();
      await lab.sql`INSERT INTO public.project_members(tenant_id,project_id,user_id,project_role,permissions)
        VALUES(${fixture.tenant},${fixture.projectId},${actor.id},'viewer','["approve"]'::jsonb)`;
      expect((await review(actor)).status).toBe(200);
    });
    it("service_role JWT cannot enter the authenticated operation", async () => {
      expect(await lab.rpc(sessionRpc, await bearer(fixture.a1, { role: "service_role" }))).toMatchObject({ status: 403, body: { code: "42501" } });
    });
    it("GET cannot invoke the VOLATILE review operation", async () => {
      const query = encodeURIComponent(JSON.stringify({ id: fixture.draft.id, confirmedCurrencyCode: "USD" }));
      forbidden(await lab.request(`/rpc/${reviewRpc}?command=${query}`, await bearer(fixture.a1), undefined, "GET"));
    });
    it.each([
      ["caller supplied actor", () => ({ id: fixture.draft.id, confirmedCurrencyCode: "USD", actorId: fixture.b1.id })],
      ["caller supplied tenant", () => ({ id: fixture.draft.id, confirmedCurrencyCode: "USD", tenantId: fixture.otherTenant })],
      ["unknown currency", () => ({ id: fixture.draft.id, confirmedCurrencyCode: "EUR" })],
      ["invalid identifier", () => ({ id: "not-a-uuid", confirmedCurrencyCode: "USD" })],
    ])("strict command rejects %s", async (_name, command) => { domainDenied(await review(fixture.a1, command()), "INTERNAL_APPROVAL_INPUT_INVALID"); });
    it("raw business table reads remain closed to an authenticated bearer", async () => {
      expect(await lab.request("/estimate_drafts?select=id", await bearer(fixture.a1), undefined, "GET"))
        .toMatchObject({ status: 403, body: { code: "42501" } });
    });
    it("direct SQL with forged request claims cannot impersonate PostgREST", async () => {
      const direct = await lab.connectDenied();
      try {
        await direct.sql`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: fixture.a1.sub, session_id: fixture.a1.session, role: "authenticated" })},false)`;
        await expect(direct.sql.unsafe(`SELECT public.${sessionRpc}()`)).rejects.toMatchObject({ code: "42501" });
      } finally { await direct.sql.end(); }
    });
    it("row_security=off cannot turn denied direct SQL into business visibility", async () => {
      const direct = await lab.connectDenied();
      try { await direct.sql`SET row_security=off`; await expect(direct.sql`SELECT id FROM public.estimate_drafts`).rejects.toMatchObject({ code: "42501" }); }
      finally { await direct.sql.end(); }
    });
    it.each(["authenticated", "structr_review_owner_v1"])("a direct SQL login cannot SET ROLE %s", async role => {
      const direct = await lab.connectDenied();
      try { await expect(direct.sql.unsafe(`SET ROLE ${role}`)).rejects.toMatchObject({ code: "42501" }); }
      finally { await direct.sql.end(); }
    });
    it.each(["set_config", "review_claims_v1", "review_permissions_v1"])("authenticated HTTP cannot invoke private/helper operation %s", async name => {
      const result = await lab.rpc(name, await bearer(fixture.a1), {});
      expect(result).toMatchObject({ status: 404, body: { code: "PGRST202" } });
      expect(result.body).not.toHaveProperty("rows");
    });
    it("a real serialization conflict retries the whole HTTP operation and returns the new exact snapshot", async () => {
      const original = (await review()).body;
      try {
        const result = await concurrentReview("draft", fixture.a1);
        expect(result.exchanges).toEqual([{ status: 500, code: "40001" }, { status: 200 }]);
        expect(result).not.toHaveProperty("error");
        const body = (result as { value: any }).value;
        expect(body.rows.draft.notes).toBe("Synthetic concurrently changed notes");
        expect(body.rows.draft.lineItems).toEqual(original.rows.draft.lineItems);
        const actual = await buildAuthenticatedInternalApprovalReview(body, { id: fixture.draft.id, confirmedCurrencyCode: "USD" },
          { actorId: fixture.a1.id, tenantId: fixture.tenant });
        expect(actual).toEqual(await getInternalApprovalReview({ id: fixture.draft.id, confirmedCurrencyCode: "USD" }, fixture.a1.id, fixture.tenant));
      } finally { await lab.sql`UPDATE public.estimate_drafts SET notes=${fixture.draft.notes} WHERE id=${fixture.draft.id}`; }
    });
    it.each(["membership", "profile"] as const)("concurrent %s revocation aborts the old snapshot and the HTTP retry denies access", async kind => {
      const actor = await fresh();
      await lab.sql`INSERT INTO public.project_members(tenant_id,project_id,user_id,project_role) VALUES(${fixture.tenant},${fixture.projectId},${actor.id},'estimator')`;
      expect((await review(actor)).status).toBe(200);
      const result = await concurrentReview(kind, actor);
      expect(result.exchanges[0]).toEqual({ status: 500, code: "40001" });
      expect(result.exchanges).toHaveLength(2);
      expect(result).toMatchObject({ error: { kind: "forbidden" } });
      expect(result).not.toHaveProperty("value");
      if (kind === "membership") expect(result.exchanges[1]).toEqual({ status: 400, code: "P0001" });
      else expect(result.exchanges[1]).toEqual({ status: 403, code: "42501" });
    });
    it("a JWT that expires during a real project-lock wait is rejected before returning rows", async () => {
      const writer = await lab.connectSupervisor(), ready = latch<number>(), release = latch();
      const transaction = writer.begin(async tx => {
        const [backend] = await tx`SELECT pg_backend_pid() AS pid`;
        await tx`SELECT id FROM public.projects WHERE id=${fixture.projectId} FOR UPDATE`;
        ready.resolve(backend.pid); await release.promise;
      });
      try {
        const pid = await ready.promise, exp = Math.floor(Date.now() / 1000) + 3;
        const pending = lab.rpc(reviewRpc, await bearer(fixture.a1, { exp }), { command: { id: fixture.draft.id, confirmedCurrencyCode: "USD" } });
        await waitForBlockedBy(pid);
        await delay(Math.max(0, exp * 1000 - Date.now() + 30));
        release.resolve(); await transaction;
        const result = await pending;
        forbidden(result); expect(result.body).not.toHaveProperty("rows");
      } finally { release.resolve(); await transaction; await writer.end(); }
    }, 10_000);
  });
});
