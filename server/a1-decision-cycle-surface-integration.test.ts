/**
 * A1-DECISION-CYCLE-SURFACE-INTEGRATION-CONTRACT.md — real PostgreSQL 17 proof
 * for the review -> internal approve -> revoke -> create-new-version cycle
 * mounted on `estimate-router.ts`. Same disposable lab/env gate as
 * a1-export-surface-integration.test.ts and the writers' own physical suites.
 *
 * Scope deliberately excludes what the already-accepted Core writers'
 * (recordInternalEstimateApproval/revokeInternalEstimateApproval/
 * createEstimateVersionV2, in server/internal-estimate-approval-db.test.ts and
 * server/estimate-version-v2-db.test.ts) own transactional-fake suites already
 * cover (replay/conflict/lineage/audit internals against a synthetic driver).
 * This file proves what is genuinely NEW at the surface: the router resolves
 * an authenticated tenantId/actorId/projectId context, the three commands'
 * `.strict()` schemas reject a legacy id-only or forged-extra-field payload at
 * the boundary, cross-tenant access is FORBIDDEN before any decision state is
 * touched, a stale reviewed hash is CONFLICT, a replayed requestId is
 * idempotent, and a decided (active or revoked) draft is never silently
 * re-approved — all through the REAL `caller()`, never a direct helper call
 * standing in for the one positive proof (boundary #5).
 *
 * No mocking of authorization/transaction/audit/the three commands
 * themselves: everything under test runs for real against a real database,
 * through the real router. Only `./db`'s `getDb()` is redirected to the
 * verified disposable lab connection (same technique as the sibling suite).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
// MICHAEL-A1-DECISION-CYCLE-V1-QA-AND-CORRECTION.md: the one positive proof's
// reviewed context (project geocode/zone evidence) must be formed by the real
// product pipeline (createProject -> refreshProjectGeocode ->
// geocodeAndDetectZone -> persistGeocodeResult, which itself calls the real
// createProjectGeocodeReviewEvidence), never fabricated by calling that pure
// function directly or hand-building a project row's zoneModifierSnapshot.
// The ONLY double is Google Maps itself, at the exact edge this module calls
// it — explicitly attributed below — because a live external geocoding
// provider is out of scope for a disposable, offline lab. Everything after
// that edge (zone detection against this tenant's REAL geo_zones row,
// snapshot construction, persistence, audit) is the real product code path.
const geocodingDouble = vi.hoisted(() => ({ geocodeAddress: vi.fn() }));
vi.mock("./geo-geocoding", async importOriginal => {
  const real = await importOriginal<typeof import("./geo-geocoding")>();
  return { ...real, geocodeAddress: geocodingDouble.geocodeAddress };
});
import { estimateRouter } from "./estimate-router";
import type { TrpcContext } from "./_core/context";
import { createEstimateDraftFromCalculator } from "./estimate-db";
import { createProject } from "./project-db";
import { refreshProjectGeocode } from "./geo-integration";
import { ESTIMATE_VERSION_PROTOCOL_V2 as V2 } from "../shared/domain/taxonomy";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900900-0000-4000-8000-000000000001";
const ACTOR = "a1900900-0000-4000-8000-000000000002"; // project owner
const OTHER_TENANT = "a1900900-0000-4000-8000-000000000005";
const OTHER_TENANT_ACTOR = "a1900900-0000-4000-8000-000000000006";
const CLIENT = "a1900900-0000-4000-8000-000000000010";
const GEO_ZONE = "a1900900-0000-4000-8000-000000000020";
// Real createProject() mints its own id — never a fixed synthetic UUID like
// the other identities above (see beforeAll).
let PROJECT: string;

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Decision cycle synthetic zone", county: "Decision County", zipCodes: ["00009"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Decision cycle synthetic shelf", description: "Decision cycle synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Decision cycle synthetic scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Decision cycle synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  return createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
}
function ctxFor(userId: string, tenantId: string | null = TENANT): TrpcContext {
  return { req: {} as any, res: {} as any, authProvider: "legacy", tenantId, user: { id: userId, tenantId, role: "user", isActive: true } as any };
}
const caller = (ctx: TrpcContext) => estimateRouter.createCaller(ctx);

async function reviewVia(ctx: TrpcContext, draftId: string) {
  return caller(ctx).getInternalApprovalReview({ id: draftId, confirmedCurrencyCode: "USD" });
}
async function approveVia(ctx: TrpcContext, draft: { id: string; version: number }, overrides: Record<string, unknown> = {}) {
  const review = await reviewVia(ctx, draft.id);
  return caller(ctx).approveEstimate({
    id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
    expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
    confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic approval",
    ...overrides,
  } as any);
}
async function revokeVia(ctx: TrpcContext, draftId: string, approval: { approvalId: string; contentHash: string }, overrides: Record<string, unknown> = {}) {
  return caller(ctx).revokeInternalApproval({
    id: draftId, approvalId: approval.approvalId, requestId: randomUUID(),
    expectedContentHash: approval.contentHash, reason: "Decision cycle synthetic revocation",
    ...overrides,
  } as any);
}
async function previewVersionVia(ctx: TrpcContext, draftId: string, sourceKind: "current_draft" | "recorded_a1") {
  return caller(ctx).getEstimateVersionPreview({
    version: V2.previewCommand, sourceDraftId: draftId, sourceKind,
    confirmedCurrencyCode: sourceKind === "current_draft" ? "USD" : null,
  } as any);
}
async function createVersionVia(
  ctx: TrpcContext, draftId: string, sourceKind: "current_draft" | "recorded_a1",
  preview: { sourceVersion: number; sourceContentHash: string }, overrides: Record<string, unknown> = {},
) {
  return caller(ctx).createVersion({
    version: V2.command, sourceDraftId: draftId, sourceKind, requestId: randomUUID(),
    expectedSourceVersion: preview.sourceVersion, expectedSourceContentHash: preview.sourceContentHash,
    reason: "Decision cycle synthetic version",
    confirmedCurrencyCode: sourceKind === "current_draft" ? "USD" : null,
    ...overrides,
  } as any);
}

describe.skipIf(!labConfig)("A1 decision cycle surface integration — real PostgreSQL 17", () => {
  beforeAll(async () => {
    const config = JSON.parse(labConfig!);
    const directory = await realpath(config.directory);
    const underOwnPrefix = directory.includes("/a1-export-physical-") &&
      (directory.startsWith("/private/tmp/") || directory.startsWith("/private/var/folders/"));
    if (!underOwnPrefix || config.database !== "a1_export_physical" || config.user !== "a1_lab" || !Number.isInteger(config.port)) {
      throw new Error("Not an owned A1 export physical laboratory configuration");
    }
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory) || !socketDirectory.startsWith(directory)) {
      throw new Error("Laboratory path escaped the owned directory");
    }
    connection = postgres({ host: socketDirectory, database: config.database, username: config.user, port: config.port, ssl: false, max: 5, prepare: false });
    const [identity] = await connection`select current_database() as database, current_user as username, current_setting('listen_addresses') as listen_addresses, inet_server_addr() as server_address`;
    if (identity.database !== config.database || identity.username !== config.user || identity.listen_addresses !== "" || identity.server_address !== null) {
      throw new Error("PostgreSQL identity does not match the owned socket-only laboratory");
    }
    database = drizzle(connection, { schema: s });
    deps.getDb.mockImplementation(async () => database);

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Decision cycle synthetic tenant', 'a1-decision-cycle-tenant'), (${OTHER_TENANT}, 'Decision cycle synthetic other tenant', 'a1-decision-cycle-other-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Decision cycle synthetic actor', 'user'), (${OTHER_TENANT_ACTOR}, ${OTHER_TENANT}, 'Decision cycle synthetic other-tenant actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'Decision cycle synthetic client')`;
    // Real geo bounds (not just the modifier columns the old direct-insert
    // fixture needed) — real zone detection matches by coordinates/radius,
    // which the fabricated-snapshot version never actually exercised.
    const z = zone();
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: z.zoneName, zoneName: z.zoneName, isActive: true,
      county: z.county, zipCodes: z.zipCodes, centerLat: z.centerLat, centerLng: z.centerLng, radiusMiles: String(z.radiusMiles),
      coastalExposureLevel: z.coastalExposureLevel, logisticsComplexity: z.logisticsComplexity,
      costMultiplier: "1.10", laborModifier: "1.10", materialModifier: "1.05", logisticsModifier: "1",
      contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Decision Cycle Lane", city: "Decision City", state: "SC", zip: "00009" };
    const project = await createProject({
      name: "Decision cycle synthetic project", projectType: "repair", channel: "premium", clientId: CLIENT, ...inputAddress,
    }, ACTOR, TENANT);
    PROJECT = project.id;
    // The ONLY doubled call in this whole formation flow — attributed above
    // at the mock declaration. Coordinates land exactly on the zone's own
    // center, so detection is a real radius check, not a coincidence.
    geocodingDouble.geocodeAddress.mockResolvedValue({
      success: true, latitude: z.centerLat, longitude: z.centerLng, formattedAddress: "1 Decision Cycle Lane, Decision City, SC",
      confidence: "high", source: "google_maps", locationType: "ROOFTOP", placeId: null,
      distanceFromCenter: 0, withinServiceRadius: true, warning: null, addressComponents: null,
    });
    const refreshed = await refreshProjectGeocode(TENANT, PROJECT, ACTOR);
    if (!refreshed.success || !refreshed.persisted || !refreshed.zoneSnapshot || refreshed.zoneSnapshot.zoneId !== GEO_ZONE) {
      throw new Error(`Real geocode/zone formation did not land on the owned zone: ${JSON.stringify(refreshed)}`);
    }
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  describe("full positive cycle through the real router — approve, export-gate, revoke, create-version", () => {
    it("approve -> internally_approved; revoke -> internal_approval_revoked, snapshot preserved; recorded_a1 version has no decision", async () => {
      const draft = await createDraft();
      const approved = await approveVia(ctxFor(ACTOR), draft);
      expect(approved.replayed).toBe(false);
      expect(approved.state).toBe("active");

      const afterApprove = await caller(ctxFor(ACTOR)).getInternalApproval({ id: draft.id });
      expect(afterApprove.state).toBe("active");
      expect(afterApprove.approval?.id).toBe(approved.approvalId);
      const [row] = await connection`SELECT status, approved_by, locked_at FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(row.status).toBe("internally_approved");
      expect(row.approved_by).toBe(ACTOR);
      expect(row.locked_at).not.toBeNull();

      const revoked = await revokeVia(ctxFor(ACTOR), draft.id, approved);
      expect(revoked.replayed).toBe(false);
      const afterRevoke = await caller(ctxFor(ACTOR)).getInternalApproval({ id: draft.id });
      expect(afterRevoke.state).toBe("revoked");
      expect(afterRevoke.snapshot?.contentHash).toBe(approved.contentHash); // snapshot preserved, never rewritten
      expect(afterRevoke.revocation?.id).toBe(revoked.revocationId);
      const [rowAfterRevoke] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(rowAfterRevoke.status).toBe("internal_approval_revoked");

      const preview = await previewVersionVia(ctxFor(ACTOR), draft.id, "recorded_a1");
      expect(preview.sourceApprovalState).toBe("revoked");
      const created = await createVersionVia(ctxFor(ACTOR), draft.id, "recorded_a1", preview);
      expect(created.replayed).toBe(false);
      expect(created.supersedesId).toBe(draft.id);
      const [child] = await connection`SELECT status, approved_by, locked_at, source, supersedes_id FROM estimate_drafts WHERE id = ${created.draftId}`;
      expect(child.status).toBe("draft");
      expect(child.approved_by).toBeNull();
      expect(child.locked_at).toBeNull();
      expect(child.source).toBe("version");
      expect(child.supersedes_id).toBe(draft.id);
      const [parent] = await connection`SELECT superseded_by FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(parent.superseded_by).toBe(created.draftId);
    });

    it("createVersion from current_draft (no prior decision) works", async () => {
      const draft = await createDraft();
      const preview = await previewVersionVia(ctxFor(ACTOR), draft.id, "current_draft");
      expect(preview.sourceApprovalState).toBeNull();
      const created = await createVersionVia(ctxFor(ACTOR), draft.id, "current_draft", preview);
      expect(created.replayed).toBe(false);
      const [child] = await connection`SELECT source, supersedes_id FROM estimate_drafts WHERE id = ${created.draftId}`;
      expect(child.source).toBe("version");
      expect(child.supersedes_id).toBe(draft.id);
    });
  });

  describe("closed payload — the real command schemas reject a legacy or forged shape before any write", () => {
    // Zod rejection happens before lockInternalApprovalContext is ever called —
    // "no effects" is checked broadly here (no audit row, no approval row, no
    // status change), not just the audit count, since a schema-boundary
    // rejection like this proves nothing about the domain guards below (H1,
    // policy floor) — those require a payload that is VALID in shape so it
    // actually reaches recordInternalEstimateApproval's own checks.
    it("approveEstimate rejects an id-only legacy payload — BAD_REQUEST, no effects at all", async () => {
      const draft = await createDraft();
      await expect((caller(ctxFor(ACTOR)) as any).approveEstimate({ id: draft.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [audit] = await connection`SELECT count(*)::int AS n FROM audit_logs WHERE record_id = ${draft.id} AND action = 'estimate.internal_approved'`;
      const [approvals] = await connection`SELECT count(*)::int AS n FROM estimate_internal_approvals WHERE estimate_draft_id = ${draft.id}`;
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(audit.n).toBe(0); expect(approvals.n).toBe(0); expect(row.status).toBe("draft");
    });

    it("approveEstimate rejects a forged extra field — BAD_REQUEST, no effects at all", async () => {
      const draft = await createDraft();
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      await expect((caller(ctxFor(ACTOR)) as any).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic approval", approvedBy: ACTOR,
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [audit] = await connection`SELECT count(*)::int AS n FROM audit_logs WHERE record_id = ${draft.id} AND action = 'estimate.internal_approved'`;
      const [approvals] = await connection`SELECT count(*)::int AS n FROM estimate_internal_approvals WHERE estimate_draft_id = ${draft.id}`;
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(audit.n).toBe(0); expect(approvals.n).toBe(0); expect(row.status).toBe("draft");
    });

    it("createVersion rejects the legacy id-keyed payload — BAD_REQUEST, no new draft row", async () => {
      const draft = await createDraft();
      await expect((caller(ctxFor(ACTOR)) as any).createVersion({ id: draft.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [row] = await connection`SELECT superseded_by FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(row.superseded_by).toBeNull();
    });
  });

  // god 2026-10-06T09-15-31-958Z-5abba3: the 8 cases retired from the mocked
  // suites in bfe241cb proved H1 (by source AND by historical-import link)
  // and the profit-shield/channel-floor policy guard reject a draft that a
  // plain "BAD_REQUEST on an id-only payload" never exercises — those old
  // cases used a payload the OLD id-only stub accepted at its own boundary
  // and only then hit the domain guard. The new closed schema makes an
  // id-only payload fail at Zod, before ever reaching these guards — so
  // proving the guards themselves still requires a payload that is VALID IN
  // SHAPE (passes the schema) reaching recordInternalEstimateApproval itself.
  describe("domain guard refusal — H1 (historical capture) and the profit-shield/channel floor", () => {
    it("H1 by source: approveEstimate on a historical_import-sourced draft is PRECONDITION_FAILED, no effects", async () => {
      const draft = await createDraft();
      await connection`UPDATE estimate_drafts SET source = 'historical_import' WHERE id = ${draft.id}`;
      // assertInternalApprovalCalculatedLineage (the H1 guard's new home) runs
      // BEFORE any hash comparison — a well-formed but fabricated hash still
      // proves H1 fires first, not that this payload happens to match a real
      // review (which getInternalApprovalReview itself would also refuse for
      // the same historical-source reason).
      await expect(caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: "a".repeat(64), expectedPolicyHash: "a".repeat(64),
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic H1-by-source attempt",
      })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      const [audit] = await connection`SELECT count(*)::int AS n FROM audit_logs WHERE record_id = ${draft.id} AND action = 'estimate.internal_approved'`;
      const [row] = await connection`SELECT status, source FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(audit.n).toBe(0); expect(row.source).toBe("historical_import"); expect(row.status).toBe("draft");
    });

    it("H1 by historical link: approveEstimate on a draft with a linked historical_estimate_imports row is PRECONDITION_FAILED, no effects", async () => {
      const draft = await createDraft(); // source stays assembly_calculator
      // hei_draft_fk requires an exact (tenant,project,client,draftId) match —
      // the shared createDraft() fixture leaves clientId null, so this one
      // draft is given a real client purely to satisfy that FK.
      await connection`UPDATE estimate_drafts SET client_id = ${CLIENT} WHERE id = ${draft.id}`;
      const rawTotals = { version: "historical-raw-totals-v1", subtotal: null, discount: null, tax: null, total: null, estimatedCost: null };
      const rawLine = { version: "historical-raw-line-v1", quantity: null, unitPrice: null, unitEstimatedCost: null, linePrice: null, lineEstimatedCost: null, taxable: null, externalCode: null };
      const reconciliationFindings = { version: "historical-reconciliation-v1", state: "matched", sumPriceMinor: null, sumCostMinor: null, findings: [] };
      const rawSelectedTotals = { version: "historical-raw-selected-v1", total: null, estimatedCost: null };
      // hes_complete_after_insert/hei_complete_after_insert are DEFERRABLE
      // INITIALLY DEFERRED constraint triggers checking declared vs actual
      // line counts — they fire at COMMIT, so every row below must land in
      // ONE transaction (each separate auto-committed statement would commit
      // a source/import before its lines exist and fail its own trigger).
      await connection.begin(async (sql) => {
        const [source] = await sql`
          INSERT INTO historical_estimate_sources
            (tenant_id, project_id, client_id, request_id, recorded_by, request_hash, content_hash, contract_version, source_kind, source_label, currency_code, raw_totals, expected_line_count)
          VALUES (${TENANT}, ${PROJECT}, ${CLIENT}, ${randomUUID()}, ${ACTOR}, ${"a".repeat(64)}, ${"b".repeat(64)}, 'historical-source-v1', 'manual_transcription', 'Synthetic linked source', 'USD', ${JSON.stringify(rawTotals)}::jsonb, 1)
          RETURNING id`;
        const [sourceLine] = await sql`
          INSERT INTO historical_estimate_source_lines
            (tenant_id, source_id, source_line_key, ordinal, raw_values, line_hash)
          VALUES (${TENANT}, ${source.id}, 'line:1', 0, ${JSON.stringify(rawLine)}::jsonb, ${"e".repeat(64)})
          RETURNING id`;
        const [imported] = await sql`
          INSERT INTO historical_estimate_imports
            (tenant_id, project_id, client_id, source_id, estimate_draft_id, request_id, recorded_by, request_hash, selection_hash, contract_version, revision, reconciliation_state, reconciliation_findings, raw_selected_totals, expected_line_count)
          VALUES (${TENANT}, ${PROJECT}, ${CLIENT}, ${source.id}, ${draft.id}, ${randomUUID()}, ${ACTOR}, ${"c".repeat(64)}, ${"d".repeat(64)}, 'historical-selection-v1', 1, 'matched', ${JSON.stringify(reconciliationFindings)}::jsonb, ${JSON.stringify(rawSelectedTotals)}::jsonb, 1)
          RETURNING id`;
        await sql`
          INSERT INTO historical_estimate_import_lines (tenant_id, import_id, source_id, source_line_id, position)
          VALUES (${TENANT}, ${imported.id}, ${source.id}, ${sourceLine.id}, 0)`;
      });
      await expect(caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: "a".repeat(64), expectedPolicyHash: "a".repeat(64),
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic H1-by-link attempt",
      })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      const [audit] = await connection`SELECT count(*)::int AS n FROM audit_logs WHERE record_id = ${draft.id} AND action = 'estimate.internal_approved'`;
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(audit.n).toBe(0); expect(row.status).toBe("draft"); // the draft's OWN source was never historical_import
    });

    it("profit-shield/channel floor: a compliant-looking payload against a below-floor draft is PRECONDITION_FAILED, never silently approved", async () => {
      // A passing H1/access/hash check is necessary but NOT sufficient — the
      // real policy evaluation must also pass. 20/200 = 10% margin, well
      // under this lab project's coastal floor (42%, per beforeAll's zone).
      const draft = await createDraft([makeLine({ unitCostSnapshot: "90.00", unitPriceSnapshot: "100.00", lineTotalCost: 180, lineTotalPrice: 200 })]);
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      expect(review.evaluation.passed).toBe(false); // the review ITSELF reports the floor failure; approval must honor it, not just display it
      await expect(caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic below-floor approval attempt",
      })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/profit margin/i) });
      const [audit] = await connection`SELECT count(*)::int AS n FROM audit_logs WHERE record_id = ${draft.id} AND action = 'estimate.internal_approved'`;
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(audit.n).toBe(0); expect(row.status).toBe("draft");
    });
  });

  describe("cross-tenant access is FORBIDDEN before any decision state is touched", () => {
    it("approveEstimate for another tenant's draft is FORBIDDEN, zero decision rows", async () => {
      const draft = await createDraft();
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      await expect(caller(ctxFor(OTHER_TENANT_ACTOR, OTHER_TENANT)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic approval",
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(row.status).toBe("draft");
    });

    it("revokeInternalApproval for another tenant's draft is FORBIDDEN, snapshot untouched", async () => {
      const draft = await createDraft();
      const approved = await approveVia(ctxFor(ACTOR), draft);
      await expect(caller(ctxFor(OTHER_TENANT_ACTOR, OTHER_TENANT)).revokeInternalApproval({
        id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(),
        expectedContentHash: approved.contentHash, reason: "Decision cycle synthetic revocation",
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(row.status).toBe("internally_approved");
    });

    it("createVersion for another tenant's draft is FORBIDDEN", async () => {
      const draft = await createDraft();
      const preview = await previewVersionVia(ctxFor(ACTOR), draft.id, "current_draft");
      await expect(caller(ctxFor(OTHER_TENANT_ACTOR, OTHER_TENANT)).createVersion({
        version: V2.command, sourceDraftId: draft.id, sourceKind: "current_draft", requestId: randomUUID(),
        expectedSourceVersion: preview.sourceVersion, expectedSourceContentHash: preview.sourceContentHash,
        reason: "Decision cycle synthetic version", confirmedCurrencyCode: "USD",
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("a stale reviewed hash is CONFLICT, never silently renewed", () => {
    it("approveEstimate with a tampered contentHash is CONFLICT, zero decision rows", async () => {
      const draft = await createDraft();
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      const tampered = review.contentHash.slice(0, -1) + (review.contentHash.endsWith("0") ? "1" : "0");
      await expect(caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: tampered, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic approval",
      })).rejects.toMatchObject({ code: "CONFLICT" });
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(row.status).toBe("draft");
    });

    it("createVersion with a tampered expectedSourceContentHash is CONFLICT, no new draft row", async () => {
      const draft = await createDraft();
      const preview = await previewVersionVia(ctxFor(ACTOR), draft.id, "current_draft");
      const tampered = preview.sourceContentHash.slice(0, -1) + (preview.sourceContentHash.endsWith("0") ? "1" : "0");
      await expect(createVersionVia(ctxFor(ACTOR), draft.id, "current_draft", { ...preview, sourceContentHash: tampered }))
        .rejects.toMatchObject({ code: "CONFLICT" });
      const [row] = await connection`SELECT superseded_by FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(row.superseded_by).toBeNull();
    });
  });

  describe("replay is idempotent — the same requestId never creates a second decision or audit row", () => {
    it("approveEstimate replayed with the identical command returns the same approval, exactly one audit row", async () => {
      const draft = await createDraft();
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      const requestId = randomUUID();
      const command = {
        id: draft.id, requestId, expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD" as const, reason: "Decision cycle synthetic approval",
      };
      const first = await caller(ctxFor(ACTOR)).approveEstimate(command);
      const second = await caller(ctxFor(ACTOR)).approveEstimate(command);
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.approvalId).toBe(first.approvalId);
      const [count] = await connection`SELECT count(*)::int AS n FROM audit_logs WHERE record_id = ${draft.id} AND action = 'estimate.internal_approved'`;
      expect(count.n).toBe(1);
    });
  });

  describe("a decided draft is never silently re-approved — one decision per draft", () => {
    it("approveEstimate on an already-approved draft with a fresh requestId is CONFLICT", async () => {
      // getInternalApprovalReview itself goes stale once a draft is decided (it
      // reviews the CURRENT calculable draft, which a decided draft no longer
      // is), so the hash reused here is the one real review captured while the
      // draft was still "draft" — the same hash the first approval itself used,
      // not a fresh read that would fail for an unrelated reason.
      const draft = await createDraft();
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      await caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic approval",
      });
      await expect(caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic second approval",
      })).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("approveEstimate on a revoked draft with a fresh requestId is CONFLICT — revocation is never reversed by reapproval", async () => {
      const draft = await createDraft();
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      const approved = await caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic approval",
      });
      await revokeVia(ctxFor(ACTOR), draft.id, approved);
      await expect(caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic reapproval attempt",
      })).rejects.toMatchObject({ code: "CONFLICT" });
      const [row] = await connection`SELECT status FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(row.status).toBe("internal_approval_revoked"); // unchanged — reapproval never reverses a revocation
    });
  });

  // MICHAEL-A1-DECISION-CYCLE-V1-QA-AND-CORRECTION.md item 1: tenant/access
  // resolution used to run OUTSIDE the writer's try block in all 3 mutations —
  // an unexpected rejection from that step (e.g. a transient getDb() failure
  // deep inside assertEstimateDraftAccess -> resolveProjectIdFor) propagated
  // with its own message intact onto TRPCError.message, INTERNAL_SERVER_ERROR.
  // This is controlled fault injection on the DB-access boundary, never a real
  // secret or a live network probe.
  describe("the error boundary never leaks a synthetic internal message", () => {
    it("approveEstimate sanitizes an unexpected context-resolution failure", async () => {
      const draft = await createDraft();
      const review = await reviewVia(ctxFor(ACTOR), draft.id);
      deps.getDb.mockImplementationOnce(() => Promise.reject(new Error("synthetic driver failure: password authentication failed for user internal_svc_test")));
      await expect(caller(ctxFor(ACTOR)).approveEstimate({
        id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version,
        expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash,
        confirmedCurrencyCode: "USD", reason: "Decision cycle synthetic approval during injected context failure",
      })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.not.stringContaining("password") });
    });

    it("revokeInternalApproval sanitizes an unexpected context-resolution failure", async () => {
      const draft = await createDraft();
      const approved = await approveVia(ctxFor(ACTOR), draft);
      deps.getDb.mockImplementationOnce(() => Promise.reject(new Error("synthetic driver failure: password authentication failed for user internal_svc_test")));
      await expect(caller(ctxFor(ACTOR)).revokeInternalApproval({
        id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(),
        expectedContentHash: approved.contentHash, reason: "Decision cycle synthetic revocation during injected context failure",
      })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.not.stringContaining("password") });
    });

    it("createVersion sanitizes an unexpected context-resolution failure", async () => {
      const draft = await createDraft();
      const preview = await previewVersionVia(ctxFor(ACTOR), draft.id, "current_draft");
      deps.getDb.mockImplementationOnce(() => Promise.reject(new Error("synthetic driver failure: password authentication failed for user internal_svc_test")));
      await expect(createVersionVia(ctxFor(ACTOR), draft.id, "current_draft", preview))
        .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.not.stringContaining("password") });
    });
  });
});
