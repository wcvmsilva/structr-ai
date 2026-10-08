/** Owned PostgreSQL/PostgREST only. Real JWT, RPC, constraints, policies and hashes. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import * as s from "../drizzle/schema";
import { INTERNAL_APPROVAL_PROTOCOL as P } from "../shared/domain/taxonomy";
import { startAdr002Postgrest, type Adr002Postgrest } from "./test-support/adr002-postgrest";
import { seedAdr002Fixture } from "./test-support/adr002-fixtures";
const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { getInternalApprovalReview, recordInternalEstimateApproval, revokeInternalEstimateApproval } from "./internal-estimate-approval-db";
import { recordHistoricalSource } from "./historical-estimate-db";
import { buildAuthenticatedInternalApprovalReview } from "./authenticated-internal-approval-review";

type Fixture = Awaited<ReturnType<typeof seedAdr002Fixture>>;
const tables = [s.authenticatedBoundaryConfig, s.historicalEstimateImports, s.estimateInternalApprovalSnapshots,
  s.estimateInternalApprovals, s.estimateInternalApprovalRevocations];
const dialect = new PgDialect();
const names = tables.map(table => getTableConfig(table).name);

describe.skipIf(process.env.ADR002_PHYSICAL !== "1")("ADR002 real record, policy and composite evidence", () => {
  let lab: Adr002Postgrest;
  beforeAll(async () => {
    if (process.env.ADR002_APPLY_BOUNDARY !== "1") throw new Error("Explicit local migration 0015 application required");
    lab = await startAdr002Postgrest(); deps.getDb.mockImplementation(async () => lab.cluster.observer.db);
  }, 60_000);
  afterAll(async () => { deps.getDb.mockReset(); await lab?.stop(); }, 30_000);
  async function rpc(f: Fixture, id = f.draft.id) {
    const bearer = await lab.token({ sub: f.a1.sub, session_id: f.a1.session });
    return lab.rpc("structr_internal_approval_review_v1", bearer, { command: { id, confirmedCurrencyCode: "USD" } });
  }
  function decoded(raw: unknown, f: Fixture) {
    return buildAuthenticatedInternalApprovalReview(raw, { id: f.draft.id, confirmedCurrencyCode: "USD" },
      { actorId: f.a1.id, tenantId: f.tenant });
  }
  async function approve(f: Fixture) {
    const review = await getInternalApprovalReview({ id: f.draft.id, confirmedCurrencyCode: "USD" }, f.a1.id, f.tenant);
    const decision = await recordInternalEstimateApproval({ id: f.draft.id, requestId: randomUUID(), expectedDraftVersion: 1,
      expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD",
      reason: "Synthetic local record evidence" }, f.a1.id, f.tenant);
    return { review, decision };
  }

  it("matches all ten Drizzle policy definitions to the actual policy catalog", async () => {
    const expected = tables.flatMap(table => {
      const config = getTableConfig(table);
      // This suite intentionally applies only 0015/0016. The new read owner is
      // proven with 0017 in adr002-estimate-reads-physical.test.ts.
      return config.policies.filter(policy => (policy.to as {name: string}).name === "structr_review_owner_v1").map(policy => ({ table_name: config.name, schema_name: config.schema ?? "public",
        policy_name: policy.name, command: policy.for === "select" ? "r" : "w", permissive: (policy.as ?? "permissive") === "permissive",
        roles: [(policy.to as {name: string}).name], using_expr: dialect.sqlToQuery(policy.using!).sql,
        check_expr: policy.withCheck ? dialect.sqlToQuery(policy.withCheck).sql : null }));
    }).sort((a, b) => a.policy_name.localeCompare(b.policy_name));
    const actual = await lab.sql`SELECT c.relname AS table_name,n.nspname AS schema_name,p.polname AS policy_name,
      p.polcmd::text AS command,p.polpermissive AS permissive,
      ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid=ANY(p.polroles) ORDER BY r.rolname) AS roles,
      pg_get_expr(p.polqual,p.polrelid) AS using_expr,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expr
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relname=ANY(${names}) AND n.nspname IN ('public','structr_private') ORDER BY p.polname`;
    expect(expected).toHaveLength(10); expect(actual.map(row => ({ ...row }))).toEqual(expected);
  });
  it.each(tables.map(table => [getTableConfig(table).name, table] as const))("keeps %s RLS-enabled, with no ownership bypass for the RPC owner", async (name, table) => {
    const config = getTableConfig(table);
    const [actual] = await lab.sql`SELECT c.relrowsecurity,c.relforcerowsecurity,r.rolname FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
      WHERE c.relname=${name} AND n.nspname=${config.schema ?? "public"}`;
    expect(config.enableRLS).toBe(true); expect(actual.relrowsecurity).toBe(true);
    expect(actual.relforcerowsecurity).toBe(false); expect(actual.rolname).not.toBe("structr_review_owner_v1");
  });
  it("matches config columns, defaults, nullability and named checks to Drizzle", async () => {
    const config = getTableConfig(s.authenticatedBoundaryConfig);
    const actual = await lab.sql`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,
      pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='structr_private.authenticated_boundary_config'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`;
    const expected = config.columns.map(column => ({ name: column.name, type: column.getSQLType(), required: column.notNull,
      default_expr: column.default === true ? "true" : column.default ? dialect.sqlToQuery(column.default as any).sql : null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(actual.map(row => ({ ...row }))).toEqual(expected);
    const checks = await lab.sql`SELECT conname FROM pg_constraint WHERE conrelid='structr_private.authenticated_boundary_config'::regclass AND contype='c' ORDER BY conname`;
    expect(checks.map(row => row.conname)).toEqual(config.checks.map(check => check.name).sort());
  });
  it.each([
    ["singleton", false, "https://synthetic.invalid/auth/v1", "authenticated"],
    ["issuer", true, "http://synthetic.invalid/auth/v1", "authenticated"],
    ["audience", true, "https://synthetic.invalid/auth/v1", "anon"],
  ] as const)("enforces the config %s check on physical writes", async (constraint, id, issuer, audience) => {
    await expect(lab.sql`INSERT INTO structr_private.authenticated_boundary_config(id,issuer,audience)
      VALUES(${id},${issuer},${audience})`).rejects.toMatchObject({ code: "23514", constraint_name: `authenticated_boundary_${constraint}` });
  });
  it("permits the owner's config SHARE lock but rejects its UPDATE through WITH CHECK false", async () => {
    await lab.sql.begin(async tx => {
      await tx`SET LOCAL ROLE structr_review_owner_v1`;
      expect(await tx`SELECT id FROM structr_private.authenticated_boundary_config WHERE id IS TRUE FOR SHARE`).toHaveLength(1);
    });
    await expect(lab.sql.begin(async tx => { await tx`SET LOCAL ROLE structr_review_owner_v1`;
      await tx`UPDATE structr_private.authenticated_boundary_config SET id=id WHERE id IS TRUE`;
    })).rejects.toMatchObject({ code: "42501" });
    expect(await lab.sql`SELECT id FROM structr_private.authenticated_boundary_config WHERE id IS TRUE`).toHaveLength(1);
  });

  it.each(["active", "revoked"] as const)("validates %s A1 from real writers after current geo/policy changes", async state => {
    const f = await seedAdr002Fixture(lab), { review, decision } = await approve(f);
    if (state === "revoked") await revokeInternalEstimateApproval({ id: f.draft.id, approvalId: decision.approvalId,
      requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic local revocation" }, f.a1.id, f.tenant);
    await lab.sql`UPDATE public.geo_zones SET tenant_id=${f.otherTenant},name='PRIVATE FOREIGN ZONE' WHERE id=${f.zoneId}`;
    await lab.sql`UPDATE public.projects SET geocode_confidence='low',geo_risk_class='barrier_island' WHERE id=${f.projectId}`;
    await lab.cluster.observer.db.insert(s.tenantSettings).values({ tenantId: f.tenant, profitShieldOverrides: { premium: 99 }, geoFloorOverrides: { coastal: 99 } });
    const response = await rpc(f); expect(response.status).toBe(200);
    expect(response.body.rows).toMatchObject({ zone: null, settings: null, scopeDraft: null });
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE FOREIGN ZONE");
    await expect(decoded(response.body, f)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_ALREADY_DECIDED" });
    const audit = await lab.sql`SELECT action FROM public.audit_logs WHERE record_id=${f.draft.id} ORDER BY action`;
    expect(audit.map(row => row.action)).toContain("estimate.internal_approved");
    if (state === "revoked") expect(audit.map(row => row.action)).toContain("estimate.internal_approval_revoked");
  });

  it("rejects a foreign current zone before the RPC returns its raw data", async () => {
    const f = await seedAdr002Fixture(lab);
    await lab.sql`UPDATE public.geo_zones SET tenant_id=${f.otherTenant},name='PRIVATE FOREIGN RAW PAYLOAD' WHERE id=${f.zoneId}`;
    const response = await rpc(f);
    expect(response).toMatchObject({ status: 400, body: { code: "P0001", message: "INTERNAL_APPROVAL_INTEGRITY_ERROR" } });
    expect(response.body).not.toHaveProperty("rows"); expect(JSON.stringify(response.body)).not.toContain("PRIVATE FOREIGN RAW PAYLOAD");
  });

  it("compares all 28 frozen-normalizer inputs in the full and projected physical composite", async () => {
    const f = await seedAdr002Fixture(lab), reference = await getInternalApprovalReview({ id: f.draft.id, confirmedCurrencyCode: "USD" }, f.a1.id, f.tenant);
    const response = await rpc(f); expect(response.status).toBe(200);
    // Snake-case reconstruction uses the actual RPC keys, not a second copy of its SQL SELECT list.
    const projected = Object.fromEntries(Object.entries(response.body.rows.draft).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]));
    const [definition] = await lab.sql`SELECT pg_get_functiondef('public.internal_approval_draft_matches_v1(public.estimate_drafts,jsonb,boolean)'::regprocedure) AS body`;
    const fields = [...new Set(Array.from((definition.body as string).matchAll(/\bd\.([a-z_]+)/g), match => match[1]))].sort();
    expect(fields).toHaveLength(28); expect(fields.filter(key => !(key in projected))).toEqual([]);
    const [matches] = await lab.sql`SELECT public.internal_approval_draft_matches_v1(d,${JSON.stringify(reference.snapshot)}::jsonb,false) AS full,
      public.internal_approval_draft_matches_v1(jsonb_populate_record(NULL::public.estimate_drafts,${JSON.stringify(projected)}::jsonb),${JSON.stringify(reference.snapshot)}::jsonb,false) AS projected
      FROM public.estimate_drafts d WHERE d.id=${f.draft.id}`;
    expect(matches).toEqual({ full: true, projected: true });
    for (const field of ["subtotal_cost", "line_items", "source", "scope_draft_id", "assembly_count"]) {
      const wrong = { ...projected, [field]: field === "line_items" ? [] : field === "source" ? "unknown" : field === "scope_draft_id" ? randomUUID() : "999" };
      const [mismatch] = await lab.sql`SELECT public.internal_approval_draft_matches_v1(jsonb_populate_record(NULL::public.estimate_drafts,${JSON.stringify(wrong)}::jsonb),${JSON.stringify(reference.snapshot)}::jsonb,false) AS matches`;
      expect(mismatch.matches, field).toBe(false);
    }
  });

  it("detects a structurally legal but corrupted approval request digest with real hashing", async () => {
    const f = await seedAdr002Fixture(lab), review = await getInternalApprovalReview({ id: f.draft.id, confirmedCurrencyCode: "USD" }, f.a1.id, f.tenant);
    const at = new Date(), snapshotId = randomUUID(), approvalId = randomUUID();
    // Deliberate corruption fixture: preserve every constraint/trigger and insert
    // the full atomic record, but use a syntactically valid wrong request hash.
    // This does not claim the audited application writer can produce corruption.
    await lab.cluster.observer.db.transaction(async tx => {
      await tx.update(s.estimateDrafts).set({ status: "internally_approved", approvedBy: f.a1.id, approvedAt: at, lockedAt: at,
        profitShieldPassed: true }).where(eq(s.estimateDrafts.id, f.draft.id));
      const identity = { tenantId: f.tenant, projectId: f.projectId, clientId: f.clientId, estimateDraftId: f.draft.id, createdAt: at, updatedAt: at, deletedAt: null };
      await tx.insert(s.estimateInternalApprovalSnapshots).values({ ...identity, id: snapshotId, draftVersion: 1, contractVersion: P.snapshot,
        contentHash: review.contentHash, currencyCode: P.currency, currencyBasis: P.currencyBasis, ...review.snapshot.financials,
        policyVersion: P.evaluator, policyHash: review.policyHash, snapshotPayload: review.snapshot, policyEvaluation: review.evaluation, capturedBy: f.a1.id });
      await tx.insert(s.estimateInternalApprovals).values({ ...identity, id: approvalId, snapshotId, requestId: randomUUID(), requestHash: "0".repeat(64),
        approvedBy: f.a1.id, approvedAt: at, reason: "Synthetic corrupt hash", contractVersion: P.decision });
    });
    const response = await rpc(f); expect(response.status).toBe(200);
    await expect(decoded(response.body, f)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
    await expect(lab.sql.begin(async tx => { await tx`SET LOCAL ROLE structr_review_owner_v1`;
      await tx`UPDATE public.estimate_internal_approvals SET id=id WHERE id=${approvalId}`;
    })).rejects.toMatchObject({ code: "23514" });
    expect((await lab.sql`SELECT request_hash FROM public.estimate_internal_approvals WHERE id=${approvalId}`)[0].request_hash).toBe("0".repeat(64));
  });

  it("rejects foreign H1 links at storage and detects a calculated draft's contradictory H1 evidence under RLS", async () => {
    const a = await seedAdr002Fixture(lab), b = await seedAdr002Fixture(lab);
    const source = await recordHistoricalSource({ requestId: randomUUID(), projectId: b.projectId, clientId: b.clientId,
      sourceKind: "manual_transcription", sourceLabel: "Synthetic contradictory H1", currencyCode: null, sourceFileId: null,
      declaredSubtotal: null, declaredDiscount: null, declaredTax: null, declaredTotal: null, declaredEstimatedCost: null, commercialTermsText: null,
      rawTotals: { version: "historical-raw-totals-v1", subtotal: null, discount: null, tax: null, total: null, estimatedCost: null },
      lines: [{ sourceLineKey: "line-1", ordinal: 0, description: "Synthetic historical evidence", quantity: null, unit: null,
        unitPrice: null, unitEstimatedCost: null, linePrice: null, lineEstimatedCost: null, externalCodeSystem: null, externalCode: null, taxable: null,
        rawValues: { version: "historical-raw-line-v1", quantity: null, unitPrice: null, unitEstimatedCost: null, linePrice: null, lineEstimatedCost: null, taxable: null, externalCode: null } }] }, b.owner.id, b.tenant);
    const importId = randomUUID();
    // Cross-context corruption must fail the actual composite FK. A complete H1
    // set pointing to a calculated draft in its own context remains the reader's
    // contradiction case. All RLS policies and deferred triggers stay enabled.
    const insertLink = (draftId: string) => lab.cluster.observer.db.transaction(async tx => {
      await tx.insert(s.historicalEstimateImports).values({ id: importId, tenantId: b.tenant, projectId: b.projectId, clientId: b.clientId,
        sourceId: source.sourceId, estimateDraftId: draftId, requestId: randomUUID(), recordedBy: b.owner.id,
        requestHash: "a".repeat(64), selectionHash: "b".repeat(64), contractVersion: "historical-selection-v1", revision: 1,
        reconciliationState: "unresolved", expectedLineCount: 1,
        reconciliationFindings: { version: "historical-reconciliation-v1", state: "unresolved", sumPriceMinor: null, sumCostMinor: null, findings: [{ code: "unknown_currency", field: "currency" }] },
        rawSelectedTotals: { version: "historical-raw-selected-v1", total: null, estimatedCost: null } });
      await tx.insert(s.historicalEstimateImportLines).values({ tenantId: b.tenant, importId, sourceId: source.sourceId, sourceLineId: source.lineIds[0].id, position: 0 });
    });
    await expect(insertLink(a.draft.id)).rejects.toMatchObject({ cause: { code: "23503", constraint_name: "hei_draft_fk" } });
    expect(await lab.sql`SELECT id FROM public.historical_estimate_imports WHERE id=${importId}`).toHaveLength(0);
    await insertLink(b.draft.id);
    const evidence = await lab.sql.begin(async tx => { await tx`SET LOCAL ROLE structr_review_owner_v1`;
      return tx`SELECT id,estimate_draft_id FROM public.historical_estimate_imports WHERE estimate_draft_id=${b.draft.id} FOR SHARE`; });
    expect(evidence).toHaveLength(1); expect(evidence[0].id).toBe(importId);
    const response = await rpc(b);
    expect(response).toMatchObject({ status: 400, body: { code: "P0001", message: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" } });
    expect(response.body).not.toHaveProperty("rows"); expect(JSON.stringify(response.body)).not.toContain(b.tenant);
    await expect(getInternalApprovalReview({ id: b.draft.id, confirmedCurrencyCode: "USD" }, b.a1.id, b.tenant)).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
  });
});
