/** Real JWT/HTTP/PostgreSQL proof; all resources and synthetic writers are local. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as s from "../drizzle/schema";
import { startAdr002Postgrest, type Adr002Postgrest } from "./test-support/adr002-postgrest";
import { seedAdr002Fixture, seedAdr002Identity, type LabIdentity } from "./test-support/adr002-fixtures";
const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { getEstimateDraftFull } from "./estimate-db";
import { getInternalApproval, getInternalApprovalReview, recordInternalEstimateApproval, revokeInternalEstimateApproval } from "./internal-estimate-approval-db";
import { recordHistoricalSource, importHistoricalEstimate } from "./historical-estimate-db";

const detailRpc = "structr_estimate_draft_read_v1", recordRpc = "structr_internal_approval_record_v1";
const readOwner = "structr_estimate_read_owner_v1";
type Fixture = Awaited<ReturnType<typeof seedAdr002Fixture>>;

describe.skipIf(process.env.ADR002_PHYSICAL !== "1")("ADR002 minimum authenticated estimate reads", () => {
  let lab: Adr002Postgrest;
  let f: Awaited<ReturnType<typeof seedAdr002Fixture>>;
  beforeAll(async () => {
    if (process.env.ADR002_APPLY_BOUNDARY !== "1") throw new Error("Explicit owned boundary application required");
    lab = await startAdr002Postgrest({ applyMinimumReads: true });
    deps.getDb.mockImplementation(async () => lab.cluster.observer.db);
    f = await seedAdr002Fixture(lab);
  }, 60_000);
  afterAll(async () => {
    deps.getDb.mockReset();
    if (!lab) return;
    const directory = lab.cluster.directory;
    await lab.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("ADR002_MINIMUM_READS_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 30_000);
  const bearer = (actor: LabIdentity) => lab.token({ sub: actor.sub, session_id: actor.session });
  const read = async (name: string, fixture = f, actor = fixture.a1, command: unknown = { id: fixture.draft.id }) =>
    lab.rpc(name, await bearer(actor), { command });
  async function approve(fixture: Fixture) {
    const review = await getInternalApprovalReview({ id: fixture.draft.id, confirmedCurrencyCode: "USD" }, fixture.a1.id, fixture.tenant);
    const decision = await recordInternalEstimateApproval({ id: fixture.draft.id, requestId: randomUUID(), expectedDraftVersion: 1,
      expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD",
      reason: "Synthetic minimum-read approval" }, fixture.a1.id, fixture.tenant);
    return { review, decision };
  }
  const delay = (ms: number) => new Promise(done => setTimeout(done, ms));
  function latch<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }
  async function blocked(pid: number) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await lab.sql`SELECT pid FROM pg_stat_activity WHERE usename='authenticator' AND ${pid}::int=ANY(pg_blocking_pids(pid))`;
      if (rows.length === 1) return;
      await delay(10);
    }
    throw new Error("Real HTTP operation did not reach the expected row lock");
  }
  async function withTransport<T>(run: (events: Array<{status:number; code?:string}>) => Promise<T>) {
    const actualFetch = globalThis.fetch.bind(globalThis), events: Array<{status:number; code?:string}> = [];
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api"); vi.stubEnv("AUTH_PROVIDER", "supabase");
    vi.stubEnv("TENANT_STRICT", "true"); vi.stubEnv("SUPABASE_URL", "https://minimum-reads-local.invalid");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_minimum_reads_local");
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin !== "https://minimum-reads-local.invalid" || !url.pathname.startsWith("/rest/v1/rpc/")) throw new Error("Unexpected physical destination");
      // Only the destination is rewritten. JWT, request, status and body go
      // unchanged through the actual local PostgREST verifier and transaction.
      const response = await actualFetch(`${lab.baseUrl}${url.pathname.slice("/rest/v1".length)}`, init);
      const body = await response.clone().json(); events.push({ status: response.status, ...(body.code ? { code: body.code } : {}) });
      return response;
    });
    try { return await run(events); } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  }

  it("control: resolves the valid real JWT before either new read is called", async () => {
    expect(await lab.rpc("structr_authenticated_session_v1", await bearer(f.a1))).toMatchObject({
      status: 200, body: { profile: { id: f.a1.id, tenantId: f.tenant } },
    });
  });
  it("leaves the existing approval-review RPC's stronger approve gate intact", async () => {
    const command = { id: f.draft.id, confirmedCurrencyCode: "USD" };
    expect(await lab.rpc("structr_internal_approval_review_v1", await bearer(f.a1), { command }))
      .toMatchObject({ status: 200, body: { version: "structr-authenticated-review-v1", rows: { draft: { id: f.draft.id } } } });
    expect(await lab.rpc("structr_internal_approval_review_v1", await bearer(f.a2), { command }))
      .toMatchObject({ status: 400, body: { code: "P0001", message: "FORBIDDEN" } });
  });
  it("returns the authorized full draft and derived historical link over real HTTP", async () => {
    expect(await lab.rpc("structr_estimate_draft_read_v1", await bearer(f.a1), { command: { id: f.draft.id } }))
      .toMatchObject({ status: 200, body: { version: "structr-authenticated-estimate-read-v1",
        context: { actorId: f.a1.id, tenantId: f.tenant }, draft: { id: f.draft.id, finalTotalPrice: "100.00" }, historicalImportId: null } });
  });
  it("returns absent approval evidence to the authorized viewer over real HTTP", async () => {
    expect(await lab.rpc("structr_internal_approval_record_v1", await bearer(f.a2), { command: { id: f.draft.id } }))
      .toMatchObject({ status: 200, body: { version: "structr-authenticated-approval-record-v1",
        context: { actorId: f.a2.id, tenantId: f.tenant }, rows: { draft: { id: f.draft.id } },
        approvalEvidence: { snapshots: [], approvals: [], revocations: [], authors: [], sourceMatches: null } } });
  });
  it("preserves every full-draft value including all 54 physical columns", async () => {
    const reference = await getEstimateDraftFull(f.draft.id);
    const response = await read(detailRpc);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.draft)).toHaveLength(54);
    expect({ ...response.body.draft, historicalImportId: response.body.historicalImportId }).toEqual(JSON.parse(JSON.stringify(reference)));
  });
  it("detail accepts uppercase UUID input already accepted by the existing route", async () => {
    expect((await getEstimateDraftFull(f.draft.id.toUpperCase()))?.id).toBe(f.draft.id);
    expect(await read(detailRpc, f, f.a1, { id: f.draft.id.toUpperCase() })).toMatchObject({ status: 200, body: { draft: { id: f.draft.id } } });
  });
  it("detail nil UUID remains a valid absent lookup while A1 record retains canonical nonzero input", async () => {
    const command = { id: "00000000-0000-0000-0000-000000000000" };
    expect(await read(detailRpc, f, f.a1, command)).toMatchObject({ status: 400, body: { code: "P0001", message: "NOT_FOUND" } });
    expect(await read(recordRpc, f, f.a1, command)).toMatchObject({ status: 400, body: { code: "P0001", message: "INTERNAL_APPROVAL_INPUT_INVALID" } });
  });
  it("preserves populated general-only metadata, warnings, rejection, money and timestamps", async () => {
    const fixture = await seedAdr002Fixture(lab);
    await lab.sql`UPDATE public.estimate_drafts SET warnings_json='[{"code":"synthetic"}]'::jsonb,metadata='{"synthetic":true}'::jsonb,
      rejected_by=${fixture.owner.id},rejected_at='2026-01-02T03:04:05.123Z',rejection_reason='Synthetic prior rejection',
      updated_at='2026-01-03T03:04:05.456Z',change_order_reason='Synthetic reason',profit_shield_floor_pct=42.125,
      profit_shield_evaluation='{"synthetic":"evaluation"}'::jsonb WHERE id=${fixture.draft.id}`;
    const response = await read(detailRpc, fixture);
    expect(response.status).toBe(200);
    expect({ ...response.body.draft, historicalImportId: response.body.historicalImportId })
      .toEqual(JSON.parse(JSON.stringify(await getEstimateDraftFull(fixture.draft.id))));
    expect(response.body.draft).toMatchObject({ profitShieldFloorPct: "42.125", rejectedAt: "2026-01-02T03:04:05.123Z",
      warningsJson: [{ code: "synthetic" }], metadata: { synthetic: true }, changeOrderReason: "Synthetic reason" });
  });
  it("writes exactly the operational view audit with the DB-resolved actor and four source fields", async () => {
    const before = await lab.sql`SELECT count(*)::int AS n FROM public.audit_logs WHERE action='estimate_viewed' AND record_id=${f.draft.id}`;
    expect((await read(detailRpc, f, f.a2)).status).toBe(200);
    const rows = await lab.sql`SELECT user_id,action,table_name,record_id,old_values,new_values FROM public.audit_logs
      WHERE action='estimate_viewed' AND record_id=${f.draft.id} ORDER BY created_at DESC`;
    expect(rows).toHaveLength(before[0].n + 1);
    expect(rows[0]).toEqual({ user_id: f.a2.id, action: "estimate_viewed", table_name: "estimate_drafts", record_id: f.draft.id,
      old_values: null, new_values: { bundleName: f.draft.bundleName, status: "draft", source: f.draft.source, pricingSchemaVersion: f.draft.pricingSchemaVersion } });
  });
  it("contains only a failing audit INSERT while still returning the authorized draft", async () => {
    await lab.sql.unsafe(`CREATE FUNCTION public.minimum_reads_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='estimate_viewed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
      REVOKE ALL ON FUNCTION public.minimum_reads_audit_failure() FROM PUBLIC;
      CREATE TRIGGER minimum_reads_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.minimum_reads_audit_failure()`);
    try {
      const before = await lab.sql`SELECT count(*)::int AS n FROM public.audit_logs`;
      expect((await read(detailRpc)).status).toBe(200);
      expect(await lab.sql`SELECT count(*)::int AS n FROM public.audit_logs`).toEqual(before);
      expect(await read(detailRpc, f, f.b1)).toMatchObject({ status: 400, body: { code: "P0001", message: "FORBIDDEN" } });
    } finally { await lab.sql.unsafe("DROP TRIGGER minimum_reads_audit_failure ON public.audit_logs; DROP FUNCTION public.minimum_reads_audit_failure()"); }
  });
  it.each([detailRpc, recordRpc])("%s allows an explicit read-only viewer", async name => {
    expect((await read(name, f, f.a2)).status).toBe(200);
  });
  it.each([detailRpc, recordRpc])("%s rejects a same-tenant subject with no project access", async name => {
    const actor = await seedAdr002Identity(lab, f.tenant);
    const result = await read(name, f, actor);
    expect(result).toMatchObject({ status: 400, body: { code: "P0001", message: "FORBIDDEN" } });
    expect(result.body).not.toHaveProperty("draft"); expect(result.body).not.toHaveProperty("rows");
  });
  it.each([[detailRpc, "FORBIDDEN"], [recordRpc, "NOT_FOUND"]])("%s preserves its other-tenant denial", async (name, message) => {
    expect(await read(name, f, f.b1)).toMatchObject({ status: 400, body: { code: "P0001", message } });
  });
  it.each([detailRpc, recordRpc])("%s rejects unknown drafts with domain NOT_FOUND", async name => {
    expect(await read(name, f, f.a1, { id: randomUUID() })).toMatchObject({ status: 400, body: { code: "P0001", message: "NOT_FOUND" } });
  });
  it.each([null, {}, { id: "not-uuid" }, { id: "x", actorId: "forged" }])("rejects malformed command %j at the real SQL boundary", async command => {
    for (const name of [detailRpc, recordRpc]) expect(await read(name, f, f.a1, command)).toMatchObject({
      status: 400, body: { code: "P0001", message: "INTERNAL_APPROVAL_INPUT_INVALID" } });
  });
  it("preserves general project-only tenancy while record enforces its A1 draft identity", async () => {
    const fixture = await seedAdr002Fixture(lab);
    await lab.sql`UPDATE public.estimate_drafts SET tenant_id=NULL WHERE id=${fixture.draft.id}`;
    expect(await read(detailRpc, fixture)).toMatchObject({ status: 200, body: { draft: { tenantId: null } } });
    expect(await read(recordRpc, fixture)).toMatchObject({ status: 400, body: { code: "P0001", message: "NOT_FOUND" } });
  });
  it("preserves general access to a deleted project while A1 record denies it", async () => {
    const fixture = await seedAdr002Fixture(lab);
    await lab.sql`UPDATE public.projects SET deleted_at=now() WHERE id=${fixture.projectId}`;
    expect((await read(detailRpc, fixture)).status).toBe(200);
    expect(await read(recordRpc, fixture)).toMatchObject({ status: 400, body: { code: "P0001", message: "FORBIDDEN" } });
  });
  it("record preserves inactive and deleted client evidence", async () => {
    const fixture = await seedAdr002Fixture(lab);
    await lab.sql`UPDATE public.clients SET is_active=false,deleted_at=now() WHERE id=${fixture.clientId}`;
    expect(await read(recordRpc, fixture)).toMatchObject({ status: 200, body: { rows: { client: { isActive: false } },
      approvalEvidence: { snapshots: [], approvals: [], revocations: [] } } });
  });
  it("retains the real NOT NULL client activity constraint instead of fabricating a null physical fixture", async () => {
    await expect(lab.sql`UPDATE public.clients SET is_active=NULL WHERE id=${f.clientId}`).rejects.toMatchObject({ code: "23502" });
    expect((await read(recordRpc)).status).toBe(200);
  });
  it("returns historical source without approval evidence as none, without applying approve lineage gates", async () => {
    const fixture = await seedAdr002Fixture(lab);
    await lab.sql`UPDATE public.estimate_drafts SET source='historical_import' WHERE id=${fixture.draft.id}`;
    expect(await read(detailRpc, fixture)).toMatchObject({ status: 200, body: { draft: { source: "historical_import" } } });
    const response = await read(recordRpc, fixture); expect(response.status).toBe(200);
    const { buildAuthenticatedInternalApprovalRecord } = await import("./authenticated-internal-approval-record");
    expect(await buildAuthenticatedInternalApprovalRecord(response.body, { id: fixture.draft.id }, { actorId: fixture.a1.id, tenantId: fixture.tenant }))
      .toEqual({ state: "none", approval: null, snapshot: null, revocation: null });
  });
  it("returns the real H1 import relation through its new RLS policy and leaves record state none", async () => {
    const fixture = await seedAdr002Fixture(lab);
    const source = await recordHistoricalSource({ requestId: randomUUID(), projectId: fixture.projectId, clientId: fixture.clientId,
      sourceKind: "manual_transcription", sourceLabel: "Synthetic minimum-read historical source", currencyCode: "USD", sourceFileId: null,
      declaredSubtotal: null, declaredDiscount: null, declaredTax: null, declaredTotal: "146.90", declaredEstimatedCost: null, commercialTermsText: null,
      rawTotals: { version: "historical-raw-totals-v1", subtotal: null, discount: null, tax: null, total: "146.90", estimatedCost: null },
      lines: [{ sourceLineKey: "line-1", ordinal: 0, description: "Synthetic historical line", quantity: "2", unit: "EA", unitPrice: "73.45",
        unitEstimatedCost: null, linePrice: "146.90", lineEstimatedCost: null, externalCodeSystem: null, externalCode: null, taxable: null,
        rawValues: { version: "historical-raw-line-v1", quantity: "2", unitPrice: "73.45", unitEstimatedCost: null, linePrice: "146.90",
          lineEstimatedCost: null, taxable: null, externalCode: null } }] }, fixture.owner.id, fixture.tenant);
    const imported = await importHistoricalEstimate({ requestId: randomUUID(), sourceId: source.sourceId, projectId: fixture.projectId,
      clientId: fixture.clientId, selectedLineIds: [source.lineIds[0].id], declaredSelectedTotal: "146.90", declaredSelectedEstimatedCost: null,
      rawSelectedTotals: { version: "historical-raw-selected-v1", total: "146.90", estimatedCost: null }, reportedApprovalAt: null,
      reportedApprovalNote: null, priorImportId: null, expectedRevision: null }, fixture.owner.id, fixture.tenant);
    const command = { id: imported.draftId };
    expect(await read(detailRpc, fixture, fixture.a2, command)).toMatchObject({ status: 200,
      body: { historicalImportId: imported.importId, draft: { source: "historical_import" } } });
    const response = await read(recordRpc, fixture, fixture.a2, command); expect(response.status).toBe(200);
    const { buildAuthenticatedInternalApprovalRecord } = await import("./authenticated-internal-approval-record");
    expect(await buildAuthenticatedInternalApprovalRecord(response.body, command, { actorId: fixture.a2.id, tenantId: fixture.tenant }))
      .toEqual({ state: "none", approval: null, snapshot: null, revocation: null });
  });
  it.each(["none", "active", "revoked"] as const)("matches existing %s record field-for-field, without auditing the read", async state => {
    const fixture = await seedAdr002Fixture(lab);
    if (state !== "none") {
      const { review, decision } = await approve(fixture);
      if (state === "revoked") await revokeInternalEstimateApproval({ id: fixture.draft.id, approvalId: decision.approvalId,
        requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic minimum-read revocation" }, fixture.a1.id, fixture.tenant);
      await lab.sql`UPDATE public.geo_zones SET tenant_id=${fixture.otherTenant} WHERE id=${fixture.zoneId}`;
    }
    const before = await lab.sql`SELECT count(*)::int AS n FROM public.audit_logs`;
    const reference = await getInternalApproval(fixture.draft.id, fixture.a2.id, fixture.tenant);
    const response = await read(recordRpc, fixture, fixture.a2); expect(response.status).toBe(200);
    const { buildAuthenticatedInternalApprovalRecord } = await import("./authenticated-internal-approval-record");
    expect(await buildAuthenticatedInternalApprovalRecord(response.body, { id: fixture.draft.id }, { actorId: fixture.a2.id, tenantId: fixture.tenant })).toEqual(reference);
    expect(reference.state).toBe(state);
    expect(await lab.sql`SELECT count(*)::int AS n FROM public.audit_logs`).toEqual(before);
  });
  it.each([detailRpc, recordRpc])("%s rejects wrong signatures before SQL and malformed signed claims inside SQL", async name => {
    const wrong = await lab.token({ sub: f.a1.sub, session_id: f.a1.session }, true);
    expect(await lab.rpc(name, wrong, { command: { id: f.draft.id } })).toMatchObject({ status: 401, body: { code: "PGRST301" } });
    const missing = await lab.token({ sub: f.a1.sub, session_id: f.a1.session, exp: undefined });
    expect(await lab.rpc(name, missing, { command: { id: f.draft.id } })).toMatchObject({ status: 403, body: { code: "42501", message: "FORBIDDEN" } });
  });
  it.each([detailRpc, recordRpc])("%s denies a now-inactive mapped profile despite a still-valid bearer", async name => {
    const fixture = await seedAdr002Fixture(lab), token = await bearer(fixture.a1);
    await lab.sql`UPDATE public.profiles SET is_active=false WHERE id=${fixture.a1.id}`;
    expect(await lab.rpc(name, token, { command: { id: fixture.draft.id } })).toMatchObject({ status: 403, body: { code: "42501", message: "FORBIDDEN" } });
  });
  it("keeps the pool membership-tenant behavior distinct from A1's contradiction refusal", async () => {
    const fixture = await seedAdr002Fixture(lab);
    await lab.sql`UPDATE public.project_members SET tenant_id=${fixture.otherTenant} WHERE project_id=${fixture.projectId} AND user_id=${fixture.a2.id}`;
    expect((await read(detailRpc, fixture, fixture.a2)).status).toBe(200);
    expect(await read(recordRpc, fixture, fixture.a2)).toMatchObject({ status: 400, body: { code: "P0001", message: "FORBIDDEN" } });
  });
  it("reuses one real HTTP pool connection without identity leakage", async () => {
    const before = await lab.sql`SELECT pid FROM pg_stat_activity WHERE usename='authenticator'`;
    expect((await read(detailRpc)).body.context.actorId).toBe(f.a1.id);
    expect((await read(recordRpc, f, f.b1)).status).toBe(400);
    expect(await lab.rpc(detailRpc, null, { command: { id: f.draft.id } })).toMatchObject({ status: 401, body: { code: "42501" } });
    expect((await read(recordRpc, f, f.a2)).body.context.actorId).toBe(f.a2.id);
    expect(await lab.sql`SELECT pid FROM pg_stat_activity WHERE usename='authenticator'`).toEqual(before);
    expect(before).toHaveLength(1);
  });
  it("grants only four public RPCs and retains closed raw/private/anonymous surfaces", async () => {
    const rpc = await lab.sql`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND has_function_privilege('authenticated',p.oid,'EXECUTE') ORDER BY p.proname`;
    expect(rpc.map(r => r.proname)).toEqual(["structr_authenticated_session_v1", detailRpc, recordRpc, "structr_internal_approval_review_v1"].sort());
    expect(await lab.request("/estimate_drafts?select=id", await bearer(f.a1), undefined, "GET"))
      .toMatchObject({ status: 403, body: { code: "42501", message: "permission denied for table estimate_drafts" } });
    await expect(lab.sql.begin(async tx => { await tx`SET LOCAL ROLE authenticated`;
      await tx.unsafe("SELECT structr_private.estimate_draft_read_v1('{}'::jsonb)");
    })).rejects.toMatchObject({ code: "42501", message: "permission denied for schema structr_private" });
    for (const role of ["anon", "authenticated", "authenticator"]) expect(await lab.sql`SELECT
      has_schema_privilege(${role},'structr_private','USAGE,CREATE') AS private_access,
      has_schema_privilege(${role},'public','CREATE') AS public_create,
      pg_has_role(${role},${readOwner},'SET') AS can_set`).toEqual([{ private_access: false, public_create: false, can_set: false }]);
  });
  it("matches the four new policies to Drizzle and denies writes despite the lock grants", async () => {
    const dialect = new PgDialect();
    const expected = [s.authenticatedBoundaryConfig, s.historicalEstimateImports].flatMap(table => {
      const c = getTableConfig(table);
      return c.policies.filter(p => (p.to as {name:string}).name === readOwner).map(p => ({ relation: c.name, name: p.name,
        command: p.for === "select" ? "r" : "w", roles: [readOwner], using_expr: dialect.sqlToQuery(p.using!).sql,
        check_expr: p.withCheck ? dialect.sqlToQuery(p.withCheck).sql : null }));
    }).sort((a,b) => a.name.localeCompare(b.name));
    const actual = await lab.sql`SELECT c.relname AS relation,p.polname AS name,p.polcmd::text AS command,
      ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid=ANY(p.polroles) ORDER BY r.rolname) AS roles,
      pg_get_expr(p.polqual,p.polrelid) AS using_expr,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expr
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE p.polname LIKE '%_read_v1' ORDER BY p.polname`;
    expect(expected).toHaveLength(4); expect(actual.map(r => ({ ...r }))).toEqual(expected);
    await lab.sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${readOwner}`);
      expect(await tx`SELECT id FROM structr_private.authenticated_boundary_config FOR SHARE`).toHaveLength(1); });
    await expect(lab.sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${readOwner}`);
      await tx`UPDATE structr_private.authenticated_boundary_config SET id=id WHERE id=true`;
    })).rejects.toMatchObject({ code: "42501" });
    expect(await lab.sql`SELECT has_any_column_privilege(${readOwner},'public.estimate_drafts','UPDATE') AS draft_update,
      has_table_privilege(${readOwner},'auth.users','SELECT') AS auth_users,
      has_table_privilege(${readOwner},'auth.sessions','SELECT') AS auth_sessions,
      has_function_privilege(${readOwner},'structr_private.review_projection_v1(jsonb,text[],text[])','EXECUTE') AS projection,
      has_function_privilege(${readOwner},'structr_private.review_permissions_v1(text)','EXECUTE') AS permissions`)
      .toEqual([{ draft_update: false, auth_users: false, auth_sessions: false, projection: false, permissions: false }]);
  });
  it("grants exactly all 54 draft columns, seven audit INSERT columns and only the two approved shared helpers", async () => {
    const columns = await lab.sql`SELECT column_name,privilege_type FROM information_schema.column_privileges
      WHERE grantee=${readOwner} AND table_schema='public' AND table_name='estimate_drafts' ORDER BY column_name,privilege_type`;
    expect(columns.map(c => c.column_name)).toEqual(getTableConfig(s.estimateDrafts).columns.map(c => c.name).sort());
    expect(new Set(columns.map(c => c.privilege_type))).toEqual(new Set(["SELECT"]));
    const audit = await lab.sql`SELECT column_name,privilege_type FROM information_schema.column_privileges
      WHERE grantee=${readOwner} AND table_schema='public' AND table_name='audit_logs' ORDER BY column_name`;
    expect(audit).toEqual(["action", "created_at", "new_values", "old_values", "record_id", "table_name", "user_id"]
      .map(column_name => ({ column_name, privilege_type: "INSERT" })));
    const helpers = await lab.sql`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='structr_private' AND has_function_privilege(${readOwner},p.oid,'EXECUTE') ORDER BY proname`;
    expect(helpers.map(h => h.proname)).toEqual(["estimate_draft_read_v1", "review_claims_v1", "review_uuid_v1"]);
  });
  it("general read does not acquire the A1 project/draft locks", async () => {
    const writer = await lab.connectSupervisor(), ready = latch(), release = latch();
    const held = writer.begin(async tx => { await tx`SELECT id FROM public.projects WHERE id=${f.projectId} FOR UPDATE`;
      await tx`SELECT id FROM public.estimate_drafts WHERE id=${f.draft.id} FOR UPDATE`; ready.resolve(); await release.promise; });
    try {
      await ready.promise;
      const result = await Promise.race([read(detailRpc), delay(1_500).then(() => { throw new Error("General read waited on A1 row locks"); })]);
      expect(result.status).toBe(200);
    } finally { release.resolve(); await held; await writer.end(); }
  });
  it.each([detailRpc, recordRpc])("%s rechecks expiration after a real row-lock wait", async name => {
    const writer = await lab.connectSupervisor(), ready = latch<number>(), release = latch();
    const held = writer.begin(async tx => {
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      if (name === detailRpc) await tx`SELECT id FROM public.profiles WHERE id=${f.a1.id} FOR UPDATE`;
      else await tx`SELECT id FROM public.projects WHERE id=${f.projectId} FOR UPDATE`;
      ready.resolve(pid); await release.promise;
    });
    try {
      const pid = await ready.promise, now = Math.floor(Date.now()/1000), exp = now + 2;
      const token = await lab.token({ sub: f.a1.sub, session_id: f.a1.session, iat: now, exp });
      const pending = lab.rpc(name, token, { command: { id: f.draft.id } });
      await blocked(pid); await delay(Math.max(0, exp * 1000 - Date.now() + 30)); release.resolve(); await held;
      expect(await pending).toMatchObject({ status: 403, body: { code: "42501", message: "FORBIDDEN" } });
    } finally { release.resolve(); await held; await writer.end(); }
  });
  it.each([detailRpc, recordRpc])("%s retries the complete transaction and rereads a concurrently disabled identity", async name => {
    const fixture = await seedAdr002Fixture(lab), writer = await lab.connectSupervisor(), ready = latch<number>(), release = latch();
    const held = writer.begin(async tx => {
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM public.profiles WHERE id=${fixture.a1.id} FOR UPDATE`;
      ready.resolve(pid); await release.promise;
      await tx`UPDATE public.profiles SET is_active=false WHERE id=${fixture.a1.id}`;
    });
    try {
      const pid = await ready.promise;
      await withTransport(async events => {
        const api = await import("./authenticated-data-api");
        const call = name === detailRpc ? api.callAuthenticatedEstimateDraftRead : api.callAuthenticatedInternalApprovalRecord;
        const pending = call({ headers: { authorization: `Bearer ${await bearer(fixture.a1)}` } }, { id: fixture.draft.id })
          .then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
        await blocked(pid); release.resolve(); await held;
        const result = await pending;
        expect(result.value).toBeUndefined(); expect(result.error).toMatchObject({ kind: "forbidden", sqlState: "42501" });
        expect(events).toEqual([{ status: 500, code: "40001" }, { status: 403, code: "42501" }]);
      });
    } finally { release.resolve(); await held; await writer.end(); }
  });
  it("record retries and denies a concurrently revoked viewer membership", async () => {
    const fixture = await seedAdr002Fixture(lab), writer = await lab.connectSupervisor(), ready = latch<number>(), release = latch();
    const held = writer.begin(async tx => {
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM public.projects WHERE id=${fixture.projectId} FOR UPDATE`;
      ready.resolve(pid); await release.promise;
      await tx`UPDATE public.project_members SET is_active=false WHERE project_id=${fixture.projectId} AND user_id=${fixture.a2.id}`;
    });
    try {
      const pid = await ready.promise;
      await withTransport(async events => {
        const { callAuthenticatedInternalApprovalRecord } = await import("./authenticated-data-api");
        const pending = callAuthenticatedInternalApprovalRecord({ headers: { authorization: `Bearer ${await bearer(fixture.a2)}` } }, { id: fixture.draft.id })
          .then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
        await blocked(pid); release.resolve(); await held;
        const result = await pending;
        expect(result.value).toBeUndefined(); expect(result.error).toMatchObject({ kind: "forbidden", applicationCode: "FORBIDDEN" });
        expect(events).toEqual([{ status: 500, code: "40001" }, { status: 400, code: "P0001" }]);
      });
    } finally { release.resolve(); await held; await writer.end(); }
  });
  it("holds resolved identity until the record read finishes, then denies the next operation after deactivation", async () => {
    const fixture = await seedAdr002Fixture(lab), blocker = await lab.connectSupervisor(), disabler = await lab.connectSupervisor();
    const ready = latch<number>(), release = latch();
    const held = blocker.begin(async tx => {
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      await tx`SELECT id FROM public.projects WHERE id=${fixture.projectId} FOR UPDATE`; ready.resolve(pid); await release.promise;
    });
    let disabling: Promise<unknown> | undefined;
    try {
      const pid = await ready.promise, pending = read(recordRpc, fixture);
      await blocked(pid);
      const [{ pid: apiPid }] = await lab.sql`SELECT pid FROM pg_stat_activity WHERE usename='authenticator'`;
      const writerReady = latch<number>();
      disabling = disabler.begin(async tx => {
        const [{ pid: writerPid }] = await tx`SELECT pg_backend_pid() AS pid`; writerReady.resolve(writerPid);
        await tx`UPDATE public.profiles SET is_active=false WHERE id=${fixture.a1.id}`;
      });
      const writerPid = await writerReady.promise;
      let waitsForIdentity = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [{ blocked: isBlocked }] = await lab.sql`SELECT ${apiPid}::int=ANY(pg_blocking_pids(${writerPid}::int)) AS blocked`;
        if (isBlocked) { waitsForIdentity = true; break; } await delay(10);
      }
      expect(waitsForIdentity).toBe(true);
      release.resolve(); await held;
      expect((await pending).status).toBe(200);
      await disabling;
      expect(await read(recordRpc, fixture)).toMatchObject({ status: 403, body: { code: "42501", message: "FORBIDDEN" } });
    } finally { release.resolve(); await held; await disabling; await blocker.end(); await disabler.end(); }
  });
});
