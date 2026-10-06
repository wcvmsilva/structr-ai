/**
 * A1-EXPORT-PREFLIGHT-WRITER-CONTRACT.md — real PostgreSQL 17 behavior proof for
 * `createExportAttempt` (server/internal-estimate-export-db.ts). Gated by
 * A1_EXPORT_PHYSICAL_CONFIG, set only by the accepted mission runner
 * (missions/.../a1-export-physical-foundation-v7-supplement/runner/run-lab.mjs);
 * skipped entirely otherwise, exactly like every other *-physical.test.ts file in
 * this directory. The SAME env var/config shape as server/a1-export-physical.test.ts
 * is reused deliberately — this file runs against the same disposable lab cluster
 * machinery, just invoked with this file's path instead of that one's.
 *
 * No mocking of authorization/transaction/audit/renderers: the writer under test
 * runs for real against a real database. Only `./db`'s `getDb()` is redirected to
 * the verified disposable lab connection (same technique every *-physical.test.ts
 * file in this directory already uses).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { createEstimateDraftFromCalculator, applyEstimateDraftDiscount } from "./estimate-db";
import {
  getInternalApprovalReview, recordInternalEstimateApproval, revokeInternalEstimateApproval,
} from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import { createExportAttempt } from "./internal-estimate-export-db";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900100-0000-4000-8000-000000000001";
const ACTOR = "a1900100-0000-4000-8000-000000000002";
const NO_GRANT_ACTOR = "a1900100-0000-4000-8000-000000000003";
const OTHER_TENANT = "a1900100-0000-4000-8000-000000000004";
const CLIENT_A = "a1900100-0000-4000-8000-000000000010";
const CLIENT_B = "a1900100-0000-4000-8000-000000000011";
const GEO_ZONE = "a1900100-0000-4000-8000-000000000020";
const PROJECT = "a1900100-0000-4000-8000-000000000030";
const PROJECT_NO_CLIENT = "a1900100-0000-4000-8000-000000000031";
const PROJECT_MISMATCH = "a1900100-0000-4000-8000-000000000032";
const GEOCODED_AT = new Date("2026-10-02T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Writer synthetic zone", county: "Writer County", zipCodes: ["00001"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}

async function makeProject(id: string, clientId: string | null) {
  const inputAddress = { address: "1 Writer Lane", city: "Writer City", state: "SC", zipCode: "00001", county: "Writer County" };
  const z = zone();
  const reviewEvidence = createProjectGeocodeReviewEvidence({
    projectId: id, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
    geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Writer Lane, Writer City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
    zoneDetection: { zone: z, method: "coordinates", confidence: "high" },
  });
  await database.insert(s.projects).values({
    id, tenantId: TENANT, clientId, ownerUserId: ACTOR,
    name: "Writer synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
    address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
    latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
    geocodedAddress: "1 Writer Lane, Writer City", geocodedAt: GEOCODED_AT, zone: z.zoneName,
    zoneModifierSnapshot: {
      zoneId: GEO_ZONE, zoneName: z.zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
      contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
    },
  });
}

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Writer synthetic shelf", description: "Writer synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
/** Builds a consistent, Profit-Shield-passing calculator payload from arbitrary
 * line items — sums/GP% are derived from the lines themselves so varying a
 * line's classification/rate/cost-code for a specific CSV diagnosis never
 * accidentally also breaks the core's OWN (unrelated) total reconciliation. */
function buildPayload(projectId: string, lines: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Writer synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Writer synthetic reviewed original notes", projectId, clientId: null, source: "assembly_calculator", metadata: null,
    ...overrides,
  } as EstimateDraftPersistPayload;
}

async function createDraft(projectId: string, lines: Array<Record<string, unknown>> = [makeLine()], overrides: Record<string, unknown> = {}) {
  return createEstimateDraftFromCalculator(buildPayload(projectId, lines, overrides), ACTOR, TENANT);
}
async function approveDraft(draft: Awaited<ReturnType<typeof createDraft>>) {
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  return recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Writer synthetic approval" },
    ACTOR, TENANT,
  );
}
async function createApprovedDraft(projectId: string, lines: Array<Record<string, unknown>> = [makeLine()], overrides: Record<string, unknown> = {}) {
  const draft = await createDraft(projectId, lines, overrides);
  const approved = await approveDraft(draft);
  return { draft, approved };
}
function attemptInput(format: "pdf" | "json" | "printable" | "csv_jobtread", draftId: string, projectId: string = PROJECT) {
  return { context: { tenantId: TENANT, actorId: ACTOR, projectId, estimateDraftId: draftId }, format, attemptKind: "preflight" as const };
}

describe.skipIf(!labConfig)("A1 export preflight writer — real PostgreSQL 17", () => {
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

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Writer synthetic tenant', 'a1-export-preflight-writer-tenant'), (${OTHER_TENANT}, 'Writer synthetic other tenant', 'a1-export-preflight-writer-other-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Writer synthetic actor', 'user'), (${NO_GRANT_ACTOR}, ${TENANT}, 'Writer synthetic no-grant actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT_A}, ${TENANT}, 'Writer synthetic client A'), (${CLIENT_B}, ${TENANT}, 'Writer synthetic client B')`;

    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    await makeProject(PROJECT, CLIENT_A);
    await makeProject(PROJECT_NO_CLIENT, null);
    await makeProject(PROJECT_MISMATCH, CLIENT_A);
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  describe("ready — one per format", () => {
    for (const format of ["pdf", "json", "printable", "csv_jobtread"] as const) {
      it(`${format} ready attempt persists approved_for_download with matching manifest/row`, async () => {
        const { draft, approved } = await createApprovedDraft(PROJECT);
        const summary = await createExportAttempt(attemptInput(format, draft.id));
        expect(summary.outcome).toBe("ready");
        expect(summary.status).toBe("approved_for_download");
        expect(summary.availability).toBe("requires_revalidation");
        expect(summary.authority).toEqual({ approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash });
        expect(summary.validation).toEqual({ state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: "10000", exportedTotalMinor: "10000", differenceMinor: "0", estimatedCostMinor: "4000" } });
        expect(summary.artifact).not.toBeNull();
        expect(summary.artifact!.byteLength).toBeGreaterThan(0);

        const [row] = await connection`SELECT * FROM jobtread_exports WHERE id = ${summary.exportId}`;
        expect(row.status).toBe("approved_for_download");
        expect(row.artifact_format).toBe(format);
        expect(row.attempt_kind).toBe("preflight");
        expect(row.row_count).toBe(1);
        expect(row.client_id).toBe(CLIENT_A);
        expect(row.downloaded_by).toBeNull();
        expect(row.downloaded_at).toBeNull();
        expect(row.csv_hash).toBe(format === "csv_jobtread" ? summary.artifact!.artifactHash : null);
        expect(row.manifest.exportId).toBe(summary.exportId);
        expect(row.validation_report).toEqual(row.manifest.validation);

        const [auditRow] = await connection`SELECT * FROM audit_logs WHERE record_id = ${summary.exportId} ORDER BY created_at DESC LIMIT 1`;
        expect(auditRow.action).toBe("estimate.export_preflight");
        expect(auditRow.new_values.outcome).toBe("ready");
        expect(auditRow.new_values.delivered).toBe(false);
        expect(JSON.stringify(auditRow.new_values)).not.toContain("Writer synthetic reviewed original notes");
      });
    }
  });

  describe("no usable decision", () => {
    it("a never-decided draft blocks with INTERNAL_APPROVAL_REQUIRED, authority null, client known", async () => {
      const draft = await createDraft(PROJECT);
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.outcome).toBe("blocked");
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.availability).toBe("blocked");
      expect(summary.authority).toBeNull();
      expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }]);
      expect(summary.validation.reconciliation).toEqual({ state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null });
      expect(summary.artifact).toBeNull();
      const [row] = await connection`SELECT * FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.client_id).toBe(CLIENT_A);
      expect(row.internal_approval_id).toBeNull();
      expect(row.artifact_hash).toBeNull();
    });

    it("a historical-sourced draft blocks with HISTORICAL_AUTHORITY_NOT_AVAILABLE before any decision is considered", async () => {
      const draft = await createDraft(PROJECT);
      await connection`UPDATE estimate_drafts SET source = 'historical_import' WHERE id = ${draft.id}`;
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE", lineKey: null, field: null }]);
      expect(summary.authority).toBeNull();
    });

    it("a legacy-approved draft (approvedBy/At set, no A1 decision) blocks with INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED", async () => {
      const draft = await createDraft(PROJECT);
      await connection`UPDATE estimate_drafts SET approved_by = ${ACTOR}, approved_at = now() WHERE id = ${draft.id}`;
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED", lineKey: null, field: null }]);
      expect(summary.authority).toBeNull();
    });
  });

  describe("client diagnosis", () => {
    it("a draft on a client-less project blocks with ESTIMATE_CLIENT_MISSING and clientId null, never the discovered contradictory UUID", async () => {
      const draft = await createDraft(PROJECT_NO_CLIENT);
      const summary = await createExportAttempt(attemptInput("json", draft.id, PROJECT_NO_CLIENT));
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "ESTIMATE_CLIENT_MISSING", lineKey: null, field: null }]);
      const [row] = await connection`SELECT client_id FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.client_id).toBeNull();
    });

    it("a draft whose project was reassigned to a different client blocks with ESTIMATE_CLIENT_CONTEXT_MISMATCH, clientId null", async () => {
      const draft = await createDraft(PROJECT_MISMATCH);
      await connection`UPDATE projects SET client_id = ${CLIENT_B} WHERE id = ${PROJECT_MISMATCH}`;
      const summary = await createExportAttempt(attemptInput("json", draft.id, PROJECT_MISMATCH));
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "ESTIMATE_CLIENT_CONTEXT_MISMATCH", lineKey: null, field: null }]);
      const [row] = await connection`SELECT client_id FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.client_id).toBeNull();
      await connection`UPDATE projects SET client_id = ${CLIENT_A} WHERE id = ${PROJECT_MISMATCH}`;
    });
  });

  describe("access denials — tenant/profile/grant/project/draft, real and fake IDs (QA V2 item 6)", () => {
    // A ready-by-owner proof (the "ready" describe block above) demonstrates
    // none of these denial paths — a positive proof of access is not a proof
    // of any specific refusal, and does not exercise grant/profile serialization
    // at all. Each case below is its own independent, directly-observed refusal.
    it("a fake estimateDraftId (no such draft for this tenant) is refused", async () => {
      await expect(createExportAttempt(attemptInput("json", randomUUID()))).rejects.toThrow();
    });
    it("a real draft paired with a projectId that is NOT its real project is refused (confused pairing, never a silent substitution)", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await expect(createExportAttempt(attemptInput("json", draft.id, PROJECT_NO_CLIENT))).rejects.toThrow();
    });
    it("a fake tenantId is refused", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await expect(createExportAttempt({ context: { tenantId: randomUUID(), actorId: ACTOR, projectId: PROJECT, estimateDraftId: draft.id }, format: "json", attemptKind: "preflight" })).rejects.toThrow();
    });
    it("a real but inactive tenant is refused", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await connection`UPDATE tenants SET is_active = false WHERE id = ${TENANT}`;
      try {
        await expect(createExportAttempt(attemptInput("json", draft.id))).rejects.toThrow();
      } finally {
        await connection`UPDATE tenants SET is_active = true WHERE id = ${TENANT}`;
      }
    });
    it("a fake actorId (no such profile) is refused", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await expect(createExportAttempt({ context: { tenantId: TENANT, actorId: randomUUID(), projectId: PROJECT, estimateDraftId: draft.id }, format: "json", attemptKind: "preflight" })).rejects.toThrow();
    });
    it("a real but inactive profile is refused", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await connection`UPDATE profiles SET is_active = false WHERE id = ${ACTOR}`;
      try {
        await expect(createExportAttempt(attemptInput("json", draft.id))).rejects.toThrow();
      } finally {
        await connection`UPDATE profiles SET is_active = true WHERE id = ${ACTOR}`;
      }
    });
    it("a real, active, correct-tenant profile with NO grant on the project is refused by requireProjectAccess itself", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await expect(createExportAttempt({ context: { tenantId: TENANT, actorId: NO_GRANT_ACTOR, projectId: PROJECT, estimateDraftId: draft.id }, format: "json", attemptKind: "preflight" })).rejects.toThrow();
    });
  });

  describe("persisted content integrity — invalid snapshot vs. crypto unavailable (QA V2 item 6)", () => {
    it("a persisted snapshot whose stored content hash no longer matches its own content blocks as INTERNAL_APPROVAL_CONTENT_UNRESOLVED (non-crypto integrity failure absorbed into a business outcome)", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      // estimate_internal_approval_snapshots is guarded by an immutability
      // trigger (A1_EVIDENCE_IMMUTABLE) that rejects a plain UPDATE outright —
      // confirmed by actually hitting it first. SET LOCAL session_replication_role
      // = replica is the established, narrowly-scoped bypass for exactly this kind
      // of deliberate corruption-for-test (never used outside a test), auto-reset
      // at the transaction's own commit — never left active for any other query.
      await connection.begin(async sql => {
        await sql`SET LOCAL session_replication_role = replica`;
        await sql`UPDATE estimate_internal_approval_snapshots SET content_hash = ${"0".repeat(64)} WHERE estimate_draft_id = ${draft.id}`;
      });
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED", lineKey: null, field: null }]);
      expect(summary.authority).toBeNull();
      expect(summary.artifact).toBeNull();
    });
    it("a genuine crypto-unavailable failure propagates as a hard error — never absorbed/silently returned as a blocked business outcome", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(new Error("Writer synthetic crypto outage"));
      try {
        await expect(createExportAttempt(attemptInput("json", draft.id))).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("known decision, no longer current", () => {
    it("a revoked approval blocks with INTERNAL_APPROVAL_REVOKED, authority present, approved-only totals", async () => {
      const { draft, approved } = await createApprovedDraft(PROJECT);
      await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: approved.contentHash, reason: "Writer synthetic revoke" },
        ACTOR, TENANT,
      );
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_REVOKED", lineKey: null, field: null }]);
      expect(summary.authority).toEqual({ approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash });
      expect(summary.validation.reconciliation).toEqual({ state: "not_evaluated", approvedTotalMinor: "10000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "4000" });
      expect(summary.artifact).toBeNull();
    });

    it("a superseded draft (new version created, old draft's own decision never revoked) blocks with ESTIMATE_SUPERSEDED", async () => {
      const { draft, approved } = await createApprovedDraft(PROJECT);
      const childId = randomUUID(), requestId = randomUUID();
      // Both statements must commit together: internal_approval_check_final_v1 is a
      // DEFERRED constraint trigger that only agrees parent.superseded_by/child.id
      // match once BOTH sides have been written — two separate autocommit
      // statements would commit (and check) the INSERT alone first.
      await connection.begin(async sql => {
        await sql`
          INSERT INTO estimate_drafts
          SELECT * FROM jsonb_populate_record(null::estimate_drafts,
            (to_jsonb((SELECT t FROM estimate_drafts t WHERE t.id = ${draft.id}))
              || jsonb_build_object(
                   'id', ${childId}::text, 'version', ${draft.version + 1}::int,
                   'source', 'version', 'supersedes_id', ${draft.id}::text,
                   'a1_version_request_id', ${requestId}::text, 'a1_version_request_hash', ${"b".repeat(64)}::text,
                   'created_by', ${ACTOR}::text, 'superseded_by', null,
                   'status', 'draft', 'approved_by', null, 'approved_at', null,
                   'rejected_by', null, 'rejected_at', null, 'rejection_reason', null, 'locked_at', null,
                   'created_at', now(), 'updated_at', now()
                 )
            )
          )`;
        await sql`UPDATE estimate_drafts SET superseded_by = ${childId}, updated_at = now() WHERE id = ${draft.id}`;
      });
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "ESTIMATE_SUPERSEDED", lineKey: null, field: null }]);
      expect(summary.authority).toEqual({ approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash });
      expect(summary.validation.reconciliation.state).toBe("not_evaluated");
    });
  });

  describe("CSV format-level blocks", () => {
    it("multiple simultaneous CSV issues across two lines both surface, ordered, as blocked_validation", async () => {
      const lines = [
        makeLine({ taxable: undefined, costCode: undefined, costGroupName: "Unmapped Writer Group" }),
        makeLine({ unitCostSnapshot: "20.123", quantity: 1, lineTotalCost: 20, lineTotalPrice: 50 }),
      ];
      const { draft } = await createApprovedDraft(PROJECT, lines);
      const summary = await createExportAttempt(attemptInput("csv_jobtread", draft.id));
      expect(summary.status).toBe("blocked_validation");
      const codes = summary.validation.issues.map(i => `${i.code}:${i.lineKey}:${i.field}`);
      expect(codes).toContain("CSV_TAXABLE_UNKNOWN:line:1:taxable");
      expect(codes).toContain("CSV_COST_CODE_UNKNOWN:line:1:costCode");
      expect(codes).toContain("CSV_RATE_UNREPRESENTABLE:line:2:unitCost");
      expect(summary.validation.reconciliation).toEqual({ state: "unrepresentable", approvedTotalMinor: "15000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "6000" });
      expect(summary.artifact).toBeNull();
      const [row] = await connection`SELECT * FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.block_reason).toBe(summary.validation.issues[0].code);
      expect(row.row_count).toBe(0);
    });

    it("an invalid (cataloged-but-unknown) cost code surfaces CSV_COST_CODE_INVALID", async () => {
      const { draft } = await createApprovedDraft(PROJECT, [makeLine({ costCode: "99-999" })]);
      const summary = await createExportAttempt(attemptInput("csv_jobtread", draft.id));
      expect(summary.validation.issues).toEqual([{ code: "CSV_COST_CODE_INVALID", lineKey: "line:1", field: "costCode" }]);
    });

    it("a real discount blocks CSV with needs_exception_review / EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED and full totals", async () => {
      const draft = await createDraft(PROJECT);
      const discounted = await applyEstimateDraftDiscount(draft.id, 10, ACTOR, TENANT);
      const review = await getInternalApprovalReview({ id: discounted.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
      await recordInternalEstimateApproval(
        { id: discounted.id, requestId: randomUUID(), expectedDraftVersion: discounted.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Writer synthetic discounted approval" },
        ACTOR, TENANT,
      );
      const summary = await createExportAttempt(attemptInput("csv_jobtread", discounted.id));
      // Migration 0014 (QA V2 item 1) repairs the status-class function so this
      // specific rank-2 code maps to "needs_exception_review" — distinct from
      // EXPORT_RECONCILIATION_MISMATCH's "blocked_reconciliation" — matching
      // Export §5.2's prose exactly, closing the V1 defect (see statusForCode).
      expect(summary.status).toBe("needs_exception_review");
      expect(summary.validation.issues).toEqual([{ code: "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED", lineKey: null, field: "discount" }]);
      expect(summary.validation.reconciliation).toEqual({ state: "unrepresentable", approvedTotalMinor: "9000", exportedTotalMinor: "10000", differenceMinor: "1000", estimatedCostMinor: "4000" });
      const [row] = await connection`SELECT exported_total_cents, difference_cents, status FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.exported_total_cents).toBe("10000");
      expect(row.difference_cents).toBe("1000");
      expect(row.status).toBe("needs_exception_review");
    });

    it("a zero-amount discount still blocks (discountApplied alone triggers the code, independent of amount)", async () => {
      const draft = await createDraft(PROJECT);
      const discounted = await applyEstimateDraftDiscount(draft.id, 0, ACTOR, TENANT);
      const review = await getInternalApprovalReview({ id: discounted.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
      await recordInternalEstimateApproval(
        { id: discounted.id, requestId: randomUUID(), expectedDraftVersion: discounted.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Writer synthetic zero-discount approval" },
        ACTOR, TENANT,
      );
      const summary = await createExportAttempt(attemptInput("csv_jobtread", discounted.id));
      expect(summary.status).toBe("needs_exception_review");
      expect(summary.validation.issues).toEqual([{ code: "EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED", lineKey: null, field: "discount" }]);
    });

    it("payload too large escapes through the SAME mapping as the other formats (decision #3): valid CSV content, structural size refusal", async () => {
      const bigDescription = "文".repeat(5000);
      const lines = Array.from({ length: 1000 }, (_, i) => makeLine({
        costGroupName: "Cabinetry & Millwork", costItemName: `Writer bulk CSV line ${i + 1}`,
        description: bigDescription, quantity: 1, unitCostSnapshot: "1.00", unitPriceSnapshot: "2.00",
        lineTotalCost: 1, lineTotalPrice: 2, assemblyId: null, costCode: "12-100", taxable: true,
      }));
      const { draft } = await createApprovedDraft(PROJECT, lines);
      const summary = await createExportAttempt(attemptInput("csv_jobtread", draft.id));
      expect(summary.status).toBe("blocked_validation");
      expect(summary.validation.issues).toEqual([{ code: "EXPORT_PAYLOAD_TOO_LARGE", lineKey: null, field: "bytes" }]);
      expect(summary.artifact).toBeNull();
    }, 180000);

    it("issue precedence: a rank-1 line defect alongside a real discount surfaces ONLY the rank-1 issue (the renderer's own phase ordering short-circuits before the discount check ever runs)", async () => {
      const lines = [makeLine({ costCode: "99-999" })]; // CSV_COST_CODE_INVALID, rank 1
      const draft = await createDraft(PROJECT, lines);
      const discounted = await applyEstimateDraftDiscount(draft.id, 5, ACTOR, TENANT);
      const review = await getInternalApprovalReview({ id: discounted.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
      await recordInternalEstimateApproval(
        { id: discounted.id, requestId: randomUUID(), expectedDraftVersion: discounted.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Writer synthetic precedence approval" },
        ACTOR, TENANT,
      );
      const summary = await createExportAttempt(attemptInput("csv_jobtread", discounted.id));
      // The already-accepted CSV renderer checks lines (phase 1), then rows
      // (phase 2), then the whole-export discount (phase 3) — each phase
      // returns IMMEDIATELY on its own first failure, so a rank-1 line defect
      // and a real discount never co-occur in the same response: rank 1 always
      // wins by construction, never by the writer inventing a second entry.
      expect(summary.validation.issues).toEqual([{ code: "CSV_COST_CODE_INVALID", lineKey: "line:1", field: "costCode" }]);
      expect(summary.status).toBe("blocked_validation");
    });
  });

  describe("PDF format-level blocks", () => {
    it("an unrepresentable character in reviewed notes blocks PDF with EXPORT_FORMAT_UNREPRESENTABLE/format", async () => {
      const { draft } = await createApprovedDraft(PROJECT, [makeLine()], { notes: "Unrepresentable glyph: 日" });
      const summary = await createExportAttempt(attemptInput("pdf", draft.id));
      expect(summary.status).toBe("blocked_validation");
      expect(summary.validation.issues).toEqual([{ code: "EXPORT_FORMAT_UNREPRESENTABLE", lineKey: null, field: "format" }]);
      expect(summary.artifact).toBeNull();
    });
  });

  describe("input validation", () => {
    it("rejects a delivery attemptKind outright (this writer accepts preflight only)", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await expect(createExportAttempt({ context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draft.id }, format: "json", attemptKind: "delivery" })).rejects.toThrow();
    });
    it("rejects an unknown extra field on the input", async () => {
      const { draft } = await createApprovedDraft(PROJECT);
      await expect(createExportAttempt({ context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draft.id }, format: "json", attemptKind: "preflight", bypass: true })).rejects.toThrow();
    });
  });

  describe("never returns bytes", () => {
    it("neither the ready nor the blocked summary ever carries bytes/content/csvString/manifest", async () => {
      const { draft: readyDraft } = await createApprovedDraft(PROJECT);
      const ready = await createExportAttempt(attemptInput("json", readyDraft.id));
      const blockedDraft = await createDraft(PROJECT);
      const blocked = await createExportAttempt(attemptInput("json", blockedDraft.id));
      for (const summary of [ready, blocked]) {
        const record = summary as unknown as Record<string, unknown>;
        expect(record.content).toBeUndefined();
        expect(record.csvString).toBeUndefined();
        expect(record.data).toBeUndefined();
        expect(record.manifest).toBeUndefined();
        expect(record.canDownload).toBeUndefined();
        expect(record.url).toBeUndefined();
      }
    });
  });

  // MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V2-QA-AND-CORRECTION.md item C: the
  // previous "20-digit minor" proof was schema-unit only (direct calls to
  // exportAttemptSummarySchema), never a real writer/driver/SQL/manifest
  // roundtrip. This exercises the REAL pipeline (calculator persist -> approve
  // -> export -> real Postgres row) at the largest value reachable through it,
  // and asserts millisecond-precision timestamps survive the real round trip
  // (summary vs. a fresh, independent DB read), not merely "did not throw".
  describe("money/ms real roundtrip (QA V2 item C)", () => {
    // Concrete, cited limit discovered empirically while building this test
    // (not assumed): `server/internal-estimate-approval-adapter.ts`'s
    // `numericText` (used by `minor`/`decimal` when rebuilding a review from
    // raw DB rows, called on the read path BEFORE export authority is even
    // resolved) explicitly guards against float64 precision loss at the
    // cents scale. Its own comment: "Near the double precision limit two
    // cents can collapse to one value even below MAX_SAFE_INTEGER" — proved
    // true empirically (a standalone probe replicating this exact function
    // against every cents value from Number.MAX_SAFE_INTEGER (9007199254740991)
    // downward found NON-CONTIGUOUS pass/fail: ...986 passes, ...987/988 fail,
    // ...989 passes, ...990/991 fail). usdTwoDecimal's own nominal 14-digit
    // ceiling ($99999999999999.99) is far past this and was the FIRST value
    // tried; it failed the same guard. 9007199254740989 cents
    // ($90,071,992,547,409.89) is the largest value CONFIRMED (not assumed)
    // to pass every check in that function, including its neighbor-collision
    // guards — well below the nominal 20-digit numeric(20,0)/p.minor schema
    // ceiling, which exists for the column/response-schema's OWN bound, not
    // for what this specific adapter's JS-number round trip can carry end to
    // end today.
    const MAX_REACHABLE_PRICE = "90071992547409.89";
    const MAX_REACHABLE_MINOR = "9007199254740989";
    const JUST_OVER_PRICE = "90071992547409.90"; // confirmed-failing neighbor, not merely "+1"
    it(`a line at the real pipeline's own CONFIRMED reachable ceiling ($${MAX_REACHABLE_PRICE}) survives end to end, and checkedAt/generatedAt match the DB row to the millisecond`, async () => {
      const { draft } = await createApprovedDraft(PROJECT, [makeLine({
        unitCostSnapshot: "1.00", unitPriceSnapshot: MAX_REACHABLE_PRICE, quantity: 1,
        lineTotalCost: 1, lineTotalPrice: Number(MAX_REACHABLE_PRICE),
      })]);
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.outcome).toBe("ready");
      expect(summary.validation.reconciliation.approvedTotalMinor).toBe(MAX_REACHABLE_MINOR);
      const [row] = await connection`SELECT approved_total_cents, checked_at, generated_at FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.approved_total_cents).toBe(MAX_REACHABLE_MINOR);
      // Millisecond-precision roundtrip: compare the SUMMARY's own timestamps
      // against an INDEPENDENT fresh read of the real Postgres row — both
      // truncate-to-ms (ck_jte_a1_time_precision), never compared to themselves.
      expect(new Date(row.checked_at).getTime()).toBe(new Date(summary.checkedAt).getTime());
      expect(new Date(row.generated_at).getTime()).toBe(new Date(summary.artifact!.generatedAt).getTime());
    });
    it("a confirmed-failing neighbor just above the ceiling is refused with INTERNAL_APPROVAL_CONTENT_UNRESOLVED — the limit is a real, non-contiguous boundary, not a rounded-up guess", async () => {
      // The same review-building check runs during APPROVAL too (getInternal
      // ApprovalReview/recordInternalEstimateApproval), not only at export —
      // this value fails that much earlier, before any draft is even approved.
      await expect(createApprovedDraft(PROJECT, [makeLine({
        unitCostSnapshot: "1.00", unitPriceSnapshot: JUST_OVER_PRICE, quantity: 1,
        lineTotalCost: 1, lineTotalPrice: Number(JUST_OVER_PRICE),
      })])).rejects.toThrow(/INTERNAL_APPROVAL_CONTENT_UNRESOLVED/);
    });
  });

  // Last in the file deliberately: a slow (~1000-line, ~15MB-description) fixture.
  // A separate autocommit query queuing behind this one's abandoned work after a
  // vitest timeout previously cascaded into unrelated tests failing — placing it
  // last, with its own generous timeout, means nothing else can queue behind it.
  describe("payload size block", () => {
    it("a snapshot whose rendered JSON exceeds 10 MiB blocks with EXPORT_PAYLOAD_TOO_LARGE/bytes", async () => {
      // `description` is Text (0..5000 UNICODE CODE POINTS, no byte limit of its
      // own) — a 3-byte-per-codepoint CJK character repeated 5000 times stays
      // within that bound while costing 15000 UTF-8 bytes; 1000 such lines (the
      // LineKey ordinal ceiling) pushes the canonical JSON past 10 MiB without
      // ever touching the 5000-codepoint Text cap `notes`/`description` share.
      const bigDescription = "文".repeat(5000);
      const lines = Array.from({ length: 1000 }, (_, i) => makeLine({
        costGroupName: "Cabinetry & Millwork", costItemName: `Writer bulk line ${i + 1}`,
        description: bigDescription, quantity: 1, unitCostSnapshot: "1.00", unitPriceSnapshot: "2.00",
        lineTotalCost: 1, lineTotalPrice: 2, assemblyId: null, costCode: "12-100", taxable: true,
      }));
      const { draft } = await createApprovedDraft(PROJECT, lines);
      const summary = await createExportAttempt(attemptInput("json", draft.id));
      expect(summary.status).toBe("blocked_validation");
      expect(summary.validation.issues).toEqual([{ code: "EXPORT_PAYLOAD_TOO_LARGE", lineKey: null, field: "bytes" }]);
      expect(summary.artifact).toBeNull();
    }, 180000);
  });
});
