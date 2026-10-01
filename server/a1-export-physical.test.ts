/**
 * A1-EXPORT-PHYSICAL-FOUNDATION-CONTRACT.md — real PostgreSQL 17 proof for the
 * jobtread_exports physical extension (migration 0013). Gated by
 * A1_EXPORT_PHYSICAL_CONFIG (set only by the mission runner at
 * missions/.../a1-export-physical-foundation/runner/run-lab.mjs); skipped entirely
 * otherwise, exactly like the other *-physical.test.ts files in this directory.
 *
 * Real, not synthetic: real schema-qualified SQL function
 * (internal_estimate_export_valid_manifest_v1), real triggers, real FKs, a real
 * disposable owned cluster. The REAL `recordInternalEstimateApproval`/
 * `revokeInternalEstimateApproval` writers (already accepted) are called directly
 * to produce genuinely valid approval/snapshot rows for the FK-satisfying cases —
 * never a hand-typed row claiming to already satisfy ck_eias_payload.
 *
 * Scope named explicitly, not hidden: true multi-PROCESS concurrency (separate OS
 * processes racing a lock) is NOT exercised here — two independent `postgres()`
 * connections against the same real cluster are used instead, which still proves
 * real Postgres-level row locking/visibility, just not a second process. See the
 * report's "pendências reais" section.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, sep, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import * as s from "../drizzle/schema";
// getDb is redirected to the verified laboratory, exactly like
// a1-internal-approval-db-physical.test.ts — real approval/snapshot rows for the
// "single legal download transition" and "revoked" fixtures below are produced by
// calling the REAL writers, never by hand-typing a row that merely claims to
// already satisfy ck_eias_payload/ck_eia_*. Earlier in this mission this file
// called those writers WITHOUT this mock, so getDb() returned null and every call
// silently failed — a real bug this rewrite fixes, not just a test-fixture nuance.
const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { createEstimateDraftFromCalculator } from "./estimate-db";
import {
  getInternalApprovalReview,
  recordInternalEstimateApproval,
  revokeInternalEstimateApproval,
} from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;
let verifiedConnectionOptions: { host: string; database: string; username: string; port: number };

const TENANT = "a1900000-0000-4000-8000-000000000001";
const ACTOR = "a1900000-0000-4000-8000-000000000002";
const DOWNLOADER = "a1900000-0000-4000-8000-000000000020";
const OTHER_ACTOR = "a1900000-0000-4000-8000-000000000021";
const CLIENT = "a1900000-0000-4000-8000-000000000003";
const PROJECT = "a1900000-0000-4000-8000-000000000004";
const LEGACY_DRAFT = "a1900000-0000-4000-8000-000000000005";
const LEGACY_EXPORT = "a1900000-0000-4000-8000-000000000006";
// A dedicated project+zone for real-approval fixtures, separate from the legacy-seeded
// PROJECT above (which other tests reference and must not be perturbed by adding
// policy-context columns it never needed before).
const APPROVAL_PROJECT = "a1900000-0000-4000-8000-000000000007";
const GEO_ZONE = "a1900000-0000-4000-8000-000000000008";
const GEOCODED_AT = new Date("2026-10-01T00:00:00.000Z");

function approvalZone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Synthetic export zone", county: "Synthetic County", zipCodes: ["00000"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}

function calculatedPayload(assemblyId: string): EstimateDraftPersistPayload {
  return {
    bundleName: "Synthetic physical export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: [{
      costGroupName: "Cabinetry & Millwork", costItemName: "Synthetic physical shelf", description: "Synthetic component",
      quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
      assemblyId, costCode: "12-100", taxable: true,
    }],
    assemblySelections: [{
      assemblyId, assemblyName: "Synthetic assembly", assemblyCode: "SYN-PHYSICAL", category: "Synthetic",
      quantity: 2, unitCost: 20, unitPrice: 50, extendedCost: 40, extendedPrice: 100,
    }],
    subtotalCost: "40.00", subtotalPrice: "100.00", grossProfit: "60.00", grossProfitPct: "60",
    finalTotalPrice: "100.00", assemblyCount: 1, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Synthetic reviewed original notes", projectId: APPROVAL_PROJECT, clientId: null,
    source: "assembly_calculator", metadata: null,
  };
}

/** Two lines sharing the exact same display name (costGroupName/costItemName) but
 * genuinely distinct data (quantity, hence LineKey/totals) — for proving CSV
 * correspondence is keyed strictly by LineKey, never by matching on display text. */
function calculatedPayloadWithDuplicateLineNames(assemblyId1: string, assemblyId2: string): EstimateDraftPersistPayload {
  return {
    bundleName: "Synthetic physical export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: [
      {
        costGroupName: "Cabinetry & Millwork", costItemName: "Synthetic physical shelf", description: "Synthetic component",
        quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
        assemblyId: assemblyId1, costCode: "12-100", taxable: true,
      },
      {
        costGroupName: "Cabinetry & Millwork", costItemName: "Synthetic physical shelf", description: "Synthetic component",
        quantity: 3, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 60, lineTotalPrice: 150,
        assemblyId: assemblyId2, costCode: "12-100", taxable: true,
      },
    ],
    assemblySelections: [
      { assemblyId: assemblyId1, assemblyName: "Synthetic assembly", assemblyCode: "SYN-PHYSICAL", category: "Synthetic", quantity: 2, unitCost: 20, unitPrice: 50, extendedCost: 40, extendedPrice: 100 },
      { assemblyId: assemblyId2, assemblyName: "Synthetic assembly", assemblyCode: "SYN-PHYSICAL", category: "Synthetic", quantity: 3, unitCost: 20, unitPrice: 50, extendedCost: 60, extendedPrice: 150 },
    ],
    subtotalCost: "100.00", subtotalPrice: "250.00", grossProfit: "150.00", grossProfitPct: "60",
    finalTotalPrice: "250.00", assemblyCount: 2, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Synthetic reviewed original notes", projectId: APPROVAL_PROJECT, clientId: null,
    source: "assembly_calculator", metadata: null,
  };
}

/** The proven recipe (a1-internal-approval-db-physical.test.ts) for a REAL, FK-satisfying
 * approval+snapshot: form a draft through the real writer, review it, approve it — never a
 * hand-typed row claiming to already satisfy ck_eias_payload/ck_eia_*. */
async function formReviewAndApprove() {
  const draft = await createEstimateDraftFromCalculator(calculatedPayload(randomUUID()), ACTOR, TENANT);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  const approved = await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Synthetic physical approval for A1 export foundation" },
    ACTOR, TENANT,
  );
  return { draft, review, approved };
}

function closedCsvManifest(overrides: Record<string, unknown> = {}) {
  const exportId = randomUUID();
  return {
    base: {
      version: "internal-estimate-export-v1", format: "json", attemptKind: "preflight", outcome: "blocked",
      exportId, context: { tenantId: TENANT, projectId: PROJECT, clientId: CLIENT, estimateDraftId: LEGACY_DRAFT, estimateVersion: 1, requestedBy: ACTOR },
      authority: null, checkedAt: "2026-10-01T00:00:00.000Z", lineKeys: [],
      validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      representation: null,
      ...overrides,
    },
    exportId,
  };
}

function readyManifest(args: { draftId: string; draftVersion: number; approvalId: string; snapshotId: string; contentHash: string; approvedMinor: string; estimatedCostMinor: string; checkedAt?: string }) {
  return closedCsvManifest({
    outcome: "ready", lineKeys: ["line:1"],
    context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: args.draftId, estimateVersion: args.draftVersion, requestedBy: ACTOR },
    authority: { approvalId: args.approvalId, snapshotId: args.snapshotId, contentHash: args.contentHash },
    checkedAt: args.checkedAt ?? "2026-10-01T00:00:00.000Z",
    validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: args.approvedMinor, exportedTotalMinor: args.approvedMinor, differenceMinor: "0", estimatedCostMinor: args.estimatedCostMinor } },
    representation: {
      format: "json", rendererVersion: "internal-estimate-json-v1", generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: ACTOR,
      filename: `EST-${args.draftId}-${randomUUID()}.json`, mimeType: "application/json", encoding: "utf8", artifactHash: "c".repeat(64), byteLength: 10,
      details: { documentVersion: "internal-estimate-document-v1", serialization: "canonical-json-utf8-v1" },
    },
  });
}

describe.skipIf(!labConfig)("A1 export physical foundation — real PostgreSQL 17", () => {
  beforeAll(async () => {
    const config = JSON.parse(labConfig!);
    const directory = await realpath(config.directory);
    const underOwnPrefix = directory.includes("/a1-export-physical-") &&
      (directory.startsWith("/private/tmp/") || directory.startsWith("/private/var/folders/"));
    if (
      !underOwnPrefix ||
      config.database !== "a1_export_physical" || config.user !== "a1_lab" || !Number.isInteger(config.port)
    ) throw new Error("Not an owned A1 export physical laboratory configuration");
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory) || !socketDirectory.startsWith(directory)) {
      throw new Error("Laboratory path escaped the owned directory");
    }
    verifiedConnectionOptions = { host: socketDirectory, database: config.database, username: config.user, port: config.port };
    connection = postgres({ ...verifiedConnectionOptions, ssl: false, max: 5, prepare: false });
    const [identity] = await connection`select current_database() as database, current_user as username, current_setting('listen_addresses') as listen_addresses, inet_server_addr() as server_address`;
    if (identity.database !== config.database || identity.username !== config.user || identity.listen_addresses !== "" || identity.server_address !== null) {
      throw new Error("PostgreSQL identity does not match the owned socket-only laboratory");
    }
    database = drizzle(connection, { schema: s });
    deps.getDb.mockImplementation(async () => database);
    const zone = approvalZone();
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone.zoneName, zoneName: zone.zoneName, isActive: true,
      coastalExposureLevel: zone.coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Synthetic Lane", city: "Synthetic City", state: "SC", zipCode: "00000", county: "Synthetic County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: APPROVAL_PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Synthetic Lane, Synthetic City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone, method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: APPROVAL_PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "Synthetic A1 export approval project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 Synthetic Lane, Synthetic City", geocodedAt: GEOCODED_AT, zone: zone.zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone.zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  describe("legacy preservation", () => {
    it("the pre-existing legacy row survived migration 0013 untouched, with every new column NULL", async () => {
      const [row] = await connection`SELECT * FROM jobtread_exports WHERE id = ${LEGACY_EXPORT}`;
      expect(row.artifact_contract_version).toBeNull();
      expect(row.artifact_format).toBeNull();
      expect(row.a1_estimate_draft_id).toBeNull();
      expect(row.a1_requested_by).toBeNull();
      expect(row.a1_downloaded_by).toBeNull();
      expect(row.estimate_draft_id).toBe(LEGACY_DRAFT);
      expect(row.status).toBe("requested");
    });

    it("rejects a NEW insert with a NULL marker — going forward every new row must be A1", async () => {
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, client_id)
        VALUES (${randomUUID()}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'requested', ${ACTOR}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_insert_marker_invalid" });
    });

    it("rejects a NEW insert with the abbreviated marker 'v1'", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, manifest, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'v1', ${JSON.stringify(base)}::jsonb, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_insert_marker_invalid" });
    });
  });

  describe("a valid blocked_authorization (no decision) row", () => {
    let id: string;
    it("inserts successfully through the real CHECK/trigger stack", async () => {
      const { base } = closedCsvManifest();
      id = base.exportId;
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${id}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `;
      const [row] = await connection`SELECT * FROM jobtread_exports WHERE id = ${id}`;
      expect(row.artifact_contract_version).toBe("internal-estimate-export-v1");
    });

    it("the generated column cannot be forged by a direct value — it always reflects the real row", async () => {
      const [row] = await connection`SELECT a1_estimate_draft_id, a1_requested_by FROM jobtread_exports WHERE id = ${id}`;
      expect(row.a1_estimate_draft_id).toBe(LEGACY_DRAFT);
      expect(row.a1_requested_by).toBe(ACTOR);
      await expect(connection`UPDATE jobtread_exports SET a1_estimate_draft_id = ${randomUUID()} WHERE id = ${id}`).rejects.toBeTruthy();
    });

    it("is immutable — any column change outside the one legal transition is rejected", async () => {
      await expect(connection`UPDATE jobtread_exports SET block_reason = 'forged' WHERE id = ${id}`).rejects.toMatchObject({ constraint_name: "jte_a1_update_forbidden" });
    });

    it("cannot be deleted, including by a cascading parent delete path", async () => {
      await expect(connection`DELETE FROM jobtread_exports WHERE id = ${id}`).rejects.toMatchObject({ constraint_name: "jte_a1_delete_forbidden" });
    });
  });

  describe("real before/after catalog inventory — RLS/owner/grants/PK preserved, index set legitimately grows", () => {
    it("RLS enabled flag and owner are unchanged by migration 0013", async () => {
      const [before] = await connection`SELECT relrowsecurity, relforcerowsecurity FROM a1_physical_inventory_before_rls`;
      const [after] = await connection`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'jobtread_exports'`;
      expect(after).toEqual(before);
      const [ownerBefore] = await connection`SELECT tableowner FROM a1_physical_inventory_before_owner`;
      const [ownerAfter] = await connection`SELECT tableowner FROM pg_tables WHERE tablename = 'jobtread_exports'`;
      expect(ownerAfter).toEqual(ownerBefore);
    });

    it("RLS policies are byte-for-byte unchanged by migration 0013 (no new/removed/altered policy)", async () => {
      const before = await connection`SELECT policyname, cmd, qual, with_check FROM a1_physical_inventory_before_policies ORDER BY policyname`;
      const after = await connection`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'jobtread_exports' ORDER BY policyname`;
      expect(after).toEqual(before);
    });

    it("table-level grants are unchanged by migration 0013", async () => {
      const before = await connection`SELECT grantee, privilege_type FROM a1_physical_inventory_before_grants ORDER BY grantee, privilege_type`;
      const after = await connection`SELECT grantee, privilege_type FROM information_schema.table_privileges WHERE table_name = 'jobtread_exports' ORDER BY grantee, privilege_type`;
      expect(after).toEqual(before);
    });

    it("the primary key is unchanged (still id alone) — migration 0013 never touched it", async () => {
      const before = await connection`SELECT attname FROM a1_physical_inventory_before_pk ORDER BY attname`;
      const after = await connection`
        SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'public.jobtread_exports'::regclass AND i.indisprimary ORDER BY a.attname`;
      expect(after).toEqual(before);
      expect(after.map(r => r.attname)).toEqual(["id"]);
    });

    it("the index set legitimately grew by exactly the 6 new indices migration 0013 documents — nothing pre-existing was dropped", async () => {
      const before = (await connection`SELECT indexname FROM a1_physical_inventory_before_indexes ORDER BY indexname`).map(r => r.indexname as string);
      const after = (await connection`SELECT indexname FROM pg_indexes WHERE tablename = 'jobtread_exports' ORDER BY indexname`).map(r => r.indexname as string);
      const added = after.filter(name => !before.includes(name));
      const removed = before.filter(name => !after.includes(name));
      expect(removed).toEqual([]);
      expect(added.sort()).toEqual([
        "idx_jte_a1_approval", "idx_jte_a1_downloader", "idx_jte_a1_draft", "idx_jte_a1_project_created", "idx_jte_a1_requester", "idx_jte_a1_snapshot",
      ].sort());
    });
  });

  describe("cross-tenant / cross-project rejection (real FK, not application code)", () => {
    it("rejects a draft-context FK pointing at a draft outside the claimed tenant/project", async () => {
      const otherTenant = randomUUID();
      await connection`INSERT INTO tenants (id, name, slug) VALUES (${otherTenant}, 'Other tenant', ${"other-" + otherTenant})`;
      const { base } = closedCsvManifest({ context: { tenantId: otherTenant, projectId: PROJECT, clientId: CLIENT, estimateDraftId: LEGACY_DRAFT, estimateVersion: 1, requestedBy: ACTOR } });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${otherTenant}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_draft_context_fk" });
    });
  });

  describe("the single legal download transition", () => {
    let id: string;
    let draftId: string;
    let draftVersion: number;
    let review: Awaited<ReturnType<typeof formReviewAndApprove>>["review"];
    let approved: Awaited<ReturnType<typeof formReviewAndApprove>>["approved"];
    beforeAll(async () => {
      // Real, FK-satisfying authority: a genuine approved+snapshotted draft via the
      // real writers (formReviewAndApprove), per the resumption decision's requirement
      // that this fixture use canonical, related approval/snapshot rows — never a
      // literal null mirror column sitting next to a non-null manifest.authority.
      const formed = await formReviewAndApprove();
      ({ review, approved } = formed);
      const draft = formed.draft;
      draftId = draft.id;
      draftVersion = draft.version;
      const { base } = closedCsvManifest({
        outcome: "ready", lineKeys: ["line:1"],
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draftId, estimateVersion: draft.version, requestedBy: ACTOR },
        authority: { approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash },
        validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: review.snapshot.financials.finalPriceMinor, exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0", estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
        representation: {
          format: "json", rendererVersion: "internal-estimate-json-v1", generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: ACTOR,
          filename: `EST-${draftId}-${randomUUID()}.json`, mimeType: "application/json", encoding: "utf8", artifactHash: "b".repeat(64), byteLength: 10,
          details: { documentVersion: "internal-estimate-document-v1", serialization: "canonical-json-utf8-v1" },
        },
      });
      (base.representation as any).filename = `EST-${draftId}-${base.exportId}.json`;
      id = base.exportId;
      // Every mirror validated at once: context/client/version, marker, totals, hash,
      // representation — all genuinely coherent with the real approval, not patched one
      // CHECK at a time.
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draftId}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `;
    });

    it("the approved_total_cents column genuinely mirrors the real approved snapshot's final price", async () => {
      const [row] = await connection`SELECT approved_total_cents::text as t FROM jobtread_exports WHERE id = ${id}`;
      expect(row.t).toBe("10000");
    });

    it("stores and returns a 20-digit total as an exact string, never through a float", async () => {
      // A DIFFERENT jobtread_exports row/attempt against the SAME real approval as the
      // download-transition row above — a blocked_reconciliation/mismatch row still needs
      // genuine authority (EXPORT_RECONCILIATION_MISMATCH is not one of the six
      // authority-null-required codes), so this reuses the real chain rather than
      // omitting it. The deferred constraint trigger now cross-checks approvedTotalMinor/
      // estimatedCostMinor against the real snapshot WHENEVER authority exists (moved
      // outside is_ready per the V2 QA finding), so those two fields must be the real
      // snapshot values here — only exportedTotalMinor/differenceMinor (JobTread's own
      // externally-sourced, never internally cross-checked report) carry the deliberate
      // 20-digit mismatch this test is actually proving column precision with.
      // differenceMinor is exportedTotalMinor - approvedTotalMinor (the SQL function's own
      // sign convention, confirmed from its expected_diff computation).
      const approvedTotalMinor = review.snapshot.financials.finalPriceMinor;
      const exportedTotalMinor = "99999999999999999999";
      const differenceMinor = (BigInt(exportedTotalMinor) - BigInt(approvedTotalMinor)).toString();
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draftId, estimateVersion: draftVersion, requestedBy: ACTOR },
        authority: { approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash },
        validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: "currency" }], reconciliation: { state: "mismatch", approvedTotalMinor, exportedTotalMinor, differenceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
      });
      const bigId = base.exportId;
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash)
        VALUES (${bigId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draftId}, 'blocked_reconciliation', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'mismatch', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${approvedTotalMinor}, ${exportedTotalMinor}, ${differenceMinor}, ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash})
      `;
      const [row] = await connection`SELECT approved_total_cents::text as a, exported_total_cents::text as e, difference_cents::text as d FROM jobtread_exports WHERE id = ${bigId}`;
      expect(row.a).toBe(approvedTotalMinor);
      expect(row.e).toBe(exportedTotalMinor);
      expect(row.d).toBe(differenceMinor);
    });

    it("allows exactly approved_for_download -> downloaded, with the actor/time pair set together", async () => {
      const downloadedAt = "2026-10-01T00:00:00.100Z";
      await connection`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${DOWNLOADER}, downloaded_at = ${downloadedAt}, updated_at = ${downloadedAt} WHERE id = ${id}`;
      const [row] = await connection`SELECT status, downloaded_by, downloaded_at FROM jobtread_exports WHERE id = ${id}`;
      expect(row.status).toBe("downloaded");
      expect(row.downloaded_by).toBe(DOWNLOADER);
    });

    it("a later download attempt by a different actor does not overwrite the first actor/time", async () => {
      const laterAt = "2026-10-01T00:00:01.000Z";
      await expect(connection`UPDATE jobtread_exports SET downloaded_by = ${OTHER_ACTOR}, downloaded_at = ${laterAt}, updated_at = ${laterAt} WHERE id = ${id}`)
        .rejects.toMatchObject({ constraint_name: "jte_a1_update_forbidden" });
      const [row] = await connection`SELECT downloaded_by FROM jobtread_exports WHERE id = ${id}`;
      expect(row.downloaded_by).toBe(DOWNLOADER);
    });

    it("blocked never becomes ready/downloaded — the transition is one-way and class-specific", async () => {
      const { base } = closedCsvManifest();
      const blockedId = base.exportId;
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${blockedId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `;
      await expect(connection`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${DOWNLOADER}, downloaded_at = '2026-10-01T00:00:00.000Z' WHERE id = ${blockedId}`)
        .rejects.toMatchObject({ constraint_name: "jte_a1_update_forbidden" });
    });
  });

  describe("real relational mismatches — proving the composite FKs and the deferred constraint trigger fire against REAL rows, not just the structural CHECK", () => {

    it("rejects a real approval/snapshot that genuinely belongs to a DIFFERENT draft (real composite FK, not a null mirror mismatch)", async () => {
      const home = await formReviewAndApprove();
      const elsewhere = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: home.draft.id, draftVersion: home.draft.version,
        approvalId: elsewhere.approved.approvalId, snapshotId: elsewhere.approved.snapshotId, contentHash: elsewhere.approved.contentHash,
        approvedMinor: home.review.snapshot.financials.finalPriceMinor, estimatedCostMinor: home.review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${home.draft.id}-${base.exportId}.json`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${home.draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${home.review.snapshot.financials.finalPriceMinor}, ${home.review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${elsewhere.approved.approvalId}, ${elsewhere.approved.snapshotId}, ${elsewhere.approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).rejects.toMatchObject({ constraint_name: "jte_a1_approval_fk" });
    });

    it("rejects client_id that doesn't match the real draft's client — checked for EVERY applicable row, even authority-NULL (blocked, no-decision)", async () => {
      const otherClient = randomUUID();
      await connection`INSERT INTO clients (id, tenant_id, name) VALUES (${otherClient}, ${TENANT}, 'Other real client, wrong for this draft')`;
      const { draft } = await formReviewAndApprove();
      // Structurally self-consistent (manifest.context.clientId matches the client_id
      // column, satisfying ck_jte_a1_manifest_mirror) but genuinely wrong relationally —
      // draft.id's REAL client is CLIENT, not otherClient. No authority is declared at
      // all, proving this basic-context check runs even for a no-decision blocked row.
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: otherClient, estimateDraftId: draft.id, estimateVersion: draft.version, requestedBy: ACTOR },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${otherClient})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_client_context" });
    });

    it("rejects client_id that matches the draft's client but not the PROJECT's own client (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item: A1-EXPORT-DATA-CONTRACT.md §3.2 requires client_id to equal the client of the draft AND of the project — a project reassigned to a different client after the draft was created is the real, representable case this covers)", async () => {
      // Mutating APPROVAL_PROJECT's own client_id is not representable here: a real
      // FK (fk_eias_project_context, from estimate_internal_approval_snapshots) RESTRICTs
      // that UPDATE the instant any approval snapshot exists against (tenant,project,
      // client) — confirmed empirically (the obvious version of this test, reusing
      // formReviewAndApprove's project/client, failed with exactly that FK violation,
      // not the intended one). A project with NO approval history yet has no such
      // snapshot, so a fresh, isolated project (cloned from APPROVAL_PROJECT's own real
      // row so every other NOT NULL/FK-backed column stays valid) is used instead — this
      // is also the MORE representative real case: the no-decision-yet class this check
      // runs for (A1-EXPORT-DATA-CONTRACT.md line 134) precedes any approval by definition.
      const freshProject = randomUUID();
      await connection`
        INSERT INTO projects
        SELECT (r).* FROM (
          SELECT jsonb_populate_record(null::projects, to_jsonb(p) || jsonb_build_object('id', ${freshProject}::text)) AS r
          FROM projects p WHERE p.id = ${APPROVAL_PROJECT}
        ) t
      `;
      const otherClient = randomUUID();
      await connection`INSERT INTO clients (id, tenant_id, name) VALUES (${otherClient}, ${TENANT}, 'Other real client, now the project''s client')`;
      try {
        const draft = await createEstimateDraftFromCalculator({ ...calculatedPayload(randomUUID()), projectId: freshProject }, ACTOR, TENANT);
        // draft.client_id is fixed at creation time to the project's client AT THAT
        // MOMENT (CLIENT, cloned from APPROVAL_PROJECT) — only the PROJECT's own row is
        // reassigned afterward, so the draft's own client never moves.
        await connection`UPDATE projects SET client_id = ${otherClient} WHERE id = ${freshProject}`;
        const { base } = closedCsvManifest({
          context: { tenantId: TENANT, projectId: freshProject, clientId: CLIENT, estimateDraftId: draft.id, estimateVersion: draft.version, requestedBy: ACTOR },
        });
        await expect(connection`
          INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
          VALUES (${base.exportId}, ${TENANT}, ${freshProject}, ${draft.id}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
        `).rejects.toMatchObject({ constraint_name: "jte_a1_export_client_context" });
      } finally {
        await connection`DELETE FROM estimate_drafts WHERE project_id = ${freshProject}`;
        await connection`DELETE FROM projects WHERE id = ${freshProject}`;
      }
    });

    it("rejects requested_by that is not a real profile in this tenant (jte_a1_requester_fk, via the generated a1_requested_by column)", async () => {
      const { draft } = await formReviewAndApprove();
      const ghostActor = randomUUID();
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draft.id, estimateVersion: draft.version, requestedBy: ghostActor },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'blocked_authorization', ${ghostActor}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_requester_fk" });
    });

    it("rejects downloaded_by that is not a real profile in this tenant on the download transition (jte_a1_downloader_fk, via the generated a1_downloaded_by column)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const id = base.exportId;
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `;
      const ghostDownloader = randomUUID();
      await expect(connection`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${ghostDownloader}, downloaded_at = '2026-10-01T00:00:00.400Z', updated_at = '2026-10-01T00:00:00.400Z' WHERE id = ${id}`)
        .rejects.toMatchObject({ constraint_name: "jte_a1_downloader_fk" });
    });

    it("rejects a real snapshot_id paired with a hash that doesn't match that snapshot's real content_hash (jte_a1_snapshot_hash_fk)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const wrongHash = "f".repeat(64);
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: wrongHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${wrongHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).rejects.toMatchObject({ constraint_name: "jte_a1_snapshot_hash_fk" });
    });

    it("rejects a ready row whose authority references a REAL but already-revoked approval (deferred constraint trigger)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const revoked = await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic revocation to prove the deferred trigger rejects reuse" },
        ACTOR, TENANT,
      );
      // checked_at must be AT OR AFTER the real revocation — "no retroactive invalidation"
      // means a checkedAt BEFORE revokedAt (e.g. a stale fixed default) would legitimately
      // be allowed; this proves the rejection path specifically, not a timing accident.
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
        checkedAt: revoked.revokedAt,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_approval_revoked" });
    });

    it("rejects a ready row whose manifest.context.estimateVersion disagrees with the real draft's current version (deferred constraint trigger, not expressible as a plain FK)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version + 41, // genuinely wrong, but still a structurally valid integer
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_draft_version" });
    });

    function exactTwoDecimals(value: string): string {
      // The snapshot's canonical Decimal6-family strings strip trailing fractional
      // zeros ("20", not "20.00") — the CSV grammar's usdTwoDecimal requires exactly
      // two, so pad without changing the represented value (SQL numeric equality in
      // the deferred trigger doesn't care about this formatting either way).
      const [whole, fraction = ""] = value.split(".");
      return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
    }
    async function realClassifiedCsvRow(snapshotId: string) {
      const [row] = await connection`SELECT snapshot_payload->'lines'->0 as line FROM estimate_internal_approval_snapshots WHERE id = ${snapshotId}`;
      const line = row.line as any;
      return {
        lineKey: line.lineKey, ordinal: 1, costGroupName: line.costGroupName, costItemName: line.costItemName,
        description: line.description ?? "", quantity: line.quantity, unit: line.csvClassification.normalizedUnit,
        unitCost: exactTwoDecimals(line.unitCostSnapshot), unitPrice: exactTwoDecimals(line.unitPriceSnapshot), costType: line.csvClassification.costType,
        taxable: line.taxable, costCode: line.csvClassification.costCode, assemblyId: line.assemblyId,
        lineCostMinor: line.lineTotalCostMinor, linePriceMinor: line.lineTotalPriceMinor,
        costTypeSource: "classifyCostType_v1", unitSource: line.csvClassification.unitSource, costCodeSource: line.csvClassification.costCodeSource,
      };
    }
    function csvReadyManifest(args: { draftId: string; draftVersion: number; approvalId: string; snapshotId: string; contentHash: string; approvedMinor: string; estimatedCostMinor: string; row: Awaited<ReturnType<typeof realClassifiedCsvRow>> }) {
      return closedCsvManifest({
        format: "csv_jobtread", outcome: "ready", lineKeys: [args.row.lineKey],
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: args.draftId, estimateVersion: args.draftVersion, requestedBy: ACTOR },
        authority: { approvalId: args.approvalId, snapshotId: args.snapshotId, contentHash: args.contentHash },
        validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: args.approvedMinor, exportedTotalMinor: args.approvedMinor, differenceMinor: "0", estimatedCostMinor: args.estimatedCostMinor } },
        representation: {
          format: "csv_jobtread", rendererVersion: "internal-estimate-jobtread-csv-v1", generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: ACTOR,
          filename: `EST-${args.draftId}-${randomUUID()}.csv`, mimeType: "text/csv", encoding: "utf8", artifactHash: "d".repeat(64), byteLength: 10,
          details: {
            contractVersion: "jobtread-budget-csv-a1-v1", classificationVersion: "jobtread-s20.1-classification-h1-8550e842-v1",
            headers: ["Cost Group Name", "Cost Item Name", "Description", "Quantity", "Unit", "Unit Cost", "Unit Price", "Cost Type", "Taxable"],
            delimiter: ",", lineEnding: "CRLF", utf8Bom: false, rows: [args.row],
          },
        },
      });
    }

    it("accepts a CSV-ready row whose single row EXACTLY matches the real snapshot's classified line (identity/classification/rate/amounts/sums all coherent at once)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const row = await realClassifiedCsvRow(approved.snapshotId);
      const { base } = csvReadyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor, row,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.csv`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'csv_jobtread', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-jobtread-csv-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).resolves.toBeTruthy();
    });

    it("rejects a CSV-ready row whose ordinal is a JSON STRING instead of a JSON number (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item: `->>` stringifies either JSON type before the ::integer cast, so a string ordinal passed undetected; direct proof against internal_estimate_export_valid_manifest_v1)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const row = await realClassifiedCsvRow(approved.snapshotId);
      (row as any).ordinal = "1"; // same digits, wrong JSON type
      const { base } = csvReadyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor, row,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.csv`;
      const [{ r }] = await connection`SELECT public.internal_estimate_export_valid_manifest_v1(${JSON.stringify(base)}::jsonb) as r`;
      expect(r).not.toBe(true);
    });

    it("rejects a CSV-ready row whose unitCost is a JSON NUMBER instead of a JSON string (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item: jsonb preserves a numeric literal's original digit text, so 5.00 as a JSON number serializes via `->>` to the same \"5.00\" the regex accepts; direct proof against internal_estimate_export_valid_manifest_v1)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const row = await realClassifiedCsvRow(approved.snapshotId);
      (row as any).unitCost = Number(row.unitCost); // same digits, wrong JSON type
      const { base } = csvReadyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor, row,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.csv`;
      const [{ r }] = await connection`SELECT public.internal_estimate_export_valid_manifest_v1(${JSON.stringify(base)}::jsonb) as r`;
      expect(r).not.toBe(true);
    });

    it("rejects a CSV-ready row whose costCode diverges from the real snapshot's classified line (deferred constraint trigger, real classification correspondence)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const row = await realClassifiedCsvRow(approved.snapshotId);
      (row as any).costCode = row.costCode === "99-999" ? "12-100" : "99-999"; // a different, still-structurally-valid cost code
      const { base } = csvReadyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor, row,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.csv`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'csv_jobtread', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-jobtread-csv-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_csv_classification_mismatch" });
    });

    it("rejects a CSV-ready row whose represented amount doesn't reconcile to quantity×rate (exact half-away-from-zero cent rounding, real correspondence not just shape)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const row = await realClassifiedCsvRow(approved.snapshotId);
      (row as any).lineCostMinor = String(BigInt(row.lineCostMinor) + 1n); // off by one cent — structurally still a valid Minor string
      const { base } = csvReadyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor, row,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.csv`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'csv_jobtread', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-jobtread-csv-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).rejects.toBeTruthy(); // the structural CHECK itself already catches this shape (a1_export_exact_amount_minor_v1), proving the same rule is enforced before our row is ever committed
    });

    it("V2 QA (rateExact parity): a1_export_exact_two_decimal_v1 mirrors the pure engine's exactTwoDecimal exactly, including the case a plain numeric comparison gets wrong", async () => {
      // estimate_internal_approval_snapshots is immutable by its own real guard
      // (0007), so a >2-fraction-digit unitCostSnapshot cannot be injected into a
      // real row through this suite — the real pipeline always round2()s before a
      // value ever reaches a snapshot, so this shape essentially never occurs
      // organically either. The snapshot column's own grammar (decimalString, scale
      // up to 6) still permits it, so the pure engine's exactTwoDecimal defends
      // against it unconditionally — proving the SQL mirror matches it exactly (not
      // just "usually agrees") is this test's whole point, done directly against the
      // real function, the only honest way to exercise this one specific shape.
      const [[numericallyEqualButThreeDecimals], [exactlyTwoDecimals], [moreThanTwoFractionDigitsInCandidateToo], [nullSnapshot]] = await Promise.all([
        connection`SELECT public.a1_export_exact_two_decimal_v1('20.000', '20.00') as r`,
        connection`SELECT public.a1_export_exact_two_decimal_v1('20', '20.00') as r`,
        connection`SELECT public.a1_export_exact_two_decimal_v1('20.125', '20.125') as r`,
        connection`SELECT public.a1_export_exact_two_decimal_v1(NULL, '20.00') as r`,
      ]);
      // A plain `'20.000'::numeric <> '20.00'::numeric` is FALSE (numerically equal)
      // — this is exactly the divergence from the pure engine's string-precision
      // rule that a numeric comparison alone would miss.
      expect(numericallyEqualButThreeDecimals.r).toBe(false);
      expect(exactlyTwoDecimals.r).toBe(true);
      expect(moreThanTwoFractionDigitsInCandidateToo.r).toBe(false);
      expect(nullSnapshot.r).toBe(false);
    });

    it("same-name-different-LineKey: a real snapshot with TWO lines sharing identical display text (costGroupName/costItemName) rejects a CSV row whose data belongs to the OTHER same-named line — correspondence is keyed strictly by LineKey, never by matching on name", async () => {
      const draft = await createEstimateDraftFromCalculator(calculatedPayloadWithDuplicateLineNames(randomUUID(), randomUUID()), ACTOR, TENANT);
      const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
      const approved = await recordInternalEstimateApproval(
        { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Synthetic physical approval for the same-name-different-LineKey regression" },
        ACTOR, TENANT,
      );
      const [[line1], [line2]] = await Promise.all([
        connection`SELECT snapshot_payload->'lines'->0 as line FROM estimate_internal_approval_snapshots WHERE id = ${approved.snapshotId}`,
        connection`SELECT snapshot_payload->'lines'->1 as line FROM estimate_internal_approval_snapshots WHERE id = ${approved.snapshotId}`,
      ]);
      expect(line1.line.costGroupName).toBe(line2.line.costGroupName);
      expect(line1.line.costItemName).toBe(line2.line.costItemName);
      expect(line1.line.lineKey).not.toBe(line2.line.lineKey);
      expect(line1.line.quantity).not.toBe(line2.line.quantity); // genuinely different data despite the same name
      // A ready export must represent EVERY line in the snapshot (jte_a1_export_
      // linekeys_mismatch otherwise), so both lines are exported — but row[0]
      // (declaring line1's LineKey) deliberately carries line2's quantity/amounts
      // instead: same display name either way, so a name-based (rather than
      // key-based) correspondence lookup would wrongly accept this.
      const row1 = await realClassifiedCsvRow(approved.snapshotId); // lines->0 = line1
      (row1 as any).quantity = line2.line.quantity;
      (row1 as any).lineCostMinor = line2.line.lineTotalCostMinor;
      (row1 as any).linePriceMinor = line2.line.lineTotalPriceMinor;
      const row2 = {
        lineKey: line2.line.lineKey, ordinal: 2, costGroupName: line2.line.costGroupName, costItemName: line2.line.costItemName,
        description: line2.line.description ?? "", quantity: line2.line.quantity, unit: line2.line.csvClassification.normalizedUnit,
        unitCost: exactTwoDecimals(line2.line.unitCostSnapshot), unitPrice: exactTwoDecimals(line2.line.unitPriceSnapshot), costType: line2.line.csvClassification.costType,
        taxable: line2.line.taxable, costCode: line2.line.csvClassification.costCode, assemblyId: line2.line.assemblyId,
        lineCostMinor: line2.line.lineTotalCostMinor, linePriceMinor: line2.line.lineTotalPriceMinor,
        costTypeSource: "classifyCostType_v1", unitSource: line2.line.csvClassification.unitSource, costCodeSource: line2.line.csvClassification.costCodeSource,
      };
      const { base } = closedCsvManifest({
        format: "csv_jobtread", outcome: "ready", lineKeys: [row1.lineKey, row2.lineKey],
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draft.id, estimateVersion: draft.version, requestedBy: ACTOR },
        authority: { approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash },
        validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: review.snapshot.financials.finalPriceMinor, exportedTotalMinor: review.snapshot.financials.finalPriceMinor, differenceMinor: "0", estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
        representation: {
          format: "csv_jobtread", rendererVersion: "internal-estimate-jobtread-csv-v1", generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: ACTOR,
          filename: `EST-${draft.id}-${randomUUID()}.csv`, mimeType: "text/csv", encoding: "utf8", artifactHash: "d".repeat(64), byteLength: 10,
          details: {
            contractVersion: "jobtread-budget-csv-a1-v1", classificationVersion: "jobtread-s20.1-classification-h1-8550e842-v1",
            headers: ["Cost Group Name", "Cost Item Name", "Description", "Quantity", "Unit", "Unit Cost", "Unit Price", "Cost Type", "Taxable"],
            delimiter: ",", lineEnding: "CRLF", utf8Bom: false, rows: [row1, row2],
          },
        },
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.csv`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'csv_jobtread', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-jobtread-csv-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 2)
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_csv_identity_mismatch" });
    });

    it("V2: rejects a ready INSERT whose approval was ALREADY revoked before this row's own (earlier-claimed) checked_at — a frozen manifest timestamp is not a waiver for current vigency", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic revocation before an attempted ready insert" },
        ACTOR, TENANT,
      );
      // The default checkedAt ("2026-10-01T00:00:00.000Z", midnight) is genuinely
      // EARLIER than the real revocation's revoked_at (a real now() timestamp from the
      // lab's actual wall clock, always later in the same day) — exactly the shape that
      // tripped the old revoked_at<=checked_at logic into wrongly ALLOWING this insert.
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_approval_revoked" });
    });

    it("V2: rejects the FIRST DOWNLOAD transition when the approval was revoked AFTER the original preflight insert succeeded — each first projection re-checks current vigency, not the frozen checked_at", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const id = base.exportId;
      // The preflight insert happens BEFORE any revocation exists — legitimately accepted.
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `;
      // Evidence of the past check remains — this row is untouched, still readable.
      const [preserved] = await connection`SELECT status, internal_approval_id FROM jobtread_exports WHERE id = ${id}`;
      expect(preserved.status).toBe("approved_for_download");
      // NOW the approval is revoked — strictly AFTER the preflight, which the norm says
      // must NOT retroactively invalidate the row that already exists (it doesn't: the
      // SELECT above already proved the row is still there, unchanged). But the NEXT
      // delivery — the actual download action — is a NEW projection and must re-check
      // current vigency for itself.
      await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic revocation between preflight and the first download attempt" },
        ACTOR, TENANT,
      );
      const downloadedAt = "2026-10-01T00:00:00.200Z";
      await expect(connection`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${DOWNLOADER}, downloaded_at = ${downloadedAt}, updated_at = ${downloadedAt} WHERE id = ${id}`)
        .rejects.toMatchObject({ constraint_name: "jte_a1_export_approval_revoked" });
      // The row itself is still exactly as it was before the failed download attempt —
      // the rejected UPDATE did not partially apply or corrupt anything.
      const [after] = await connection`SELECT status, downloaded_by, downloaded_at FROM jobtread_exports WHERE id = ${id}`;
      expect(after.status).toBe("approved_for_download");
      expect(after.downloaded_by).toBeNull();
    });

    it("V2: an identical no-op UPDATE on an ALREADY-downloaded row is still permitted even after a later revocation (no-op is not a new projection)", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const id = base.exportId;
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `;
      const downloadedAt = "2026-10-01T00:00:00.300Z";
      await connection`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${DOWNLOADER}, downloaded_at = ${downloadedAt}, updated_at = ${downloadedAt} WHERE id = ${id}`;
      await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic revocation after a successful first download, before an idempotent retry" },
        ACTOR, TENANT,
      );
      // An exact no-op retry (same actor/time already persisted) must still be a no-op,
      // not a new projection re-decided against the now-revoked approval.
      await expect(connection`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${DOWNLOADER}, downloaded_at = ${downloadedAt}, updated_at = ${downloadedAt} WHERE id = ${id}`)
        .resolves.toBeTruthy();
    });
  });

  describe("the manifest validator rejects structurally/matrix-invalid rows (real CHECK, real function)", () => {
    it("rejects a ready manifest with null authority", async () => {
      // representation is ALSO left null so ck_jte_a1_manifest_mirror (which compares
      // declared columns to the representation sub-object) cannot independently fire
      // on an unrelated mismatch — the one deliberate violation under test here is
      // exercised in isolation: ready still requires representation OR authority
      // either way, and the function's very first ready-branch check already covers
      // both, so this row trips ck_jte_a1_manifest_valid specifically and only that.
      const { base } = closedCsvManifest({
        outcome: "ready", lineKeys: ["line:1"], authority: null, representation: null,
        validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: "100", exportedTotalMinor: "100", differenceMinor: "0", estimatedCostMinor: "40" } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, '100', '100', '0', ${CLIENT}, 1)
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("rejects EXPORT_RECONCILIATION_MISMATCH with a zero difference", async () => {
      const { base } = closedCsvManifest({
        validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: "currency" }], reconciliation: { state: "mismatch", approvedTotalMinor: "100", exportedTotalMinor: "100", differenceMinor: "0", estimatedCostMinor: "40" } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_reconciliation', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'mismatch', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, '100', '100', '0', ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("accepts clientId=NULL paired with ESTIMATE_CLIENT_MISSING (control)", async () => {
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: PROJECT, clientId: null, estimateDraftId: LEGACY_DRAFT, estimateVersion: 1, requestedBy: ACTOR },
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "ESTIMATE_CLIENT_MISSING", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt})
      `).resolves.toBeTruthy();
    });

    it("rejects a non-null clientId column alongside ESTIMATE_CLIENT_MISSING in the manifest mirror check", async () => {
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: PROJECT, clientId: null, estimateDraftId: LEGACY_DRAFT, estimateVersion: 1, requestedBy: ACTOR },
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "ESTIMATE_CLIENT_MISSING", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_mirror" });
    });
  });

  describe("V3 regression: the 15 cases MICHAEL-A1-EXPORT-PHYSICAL-V2-QA-AND-COMPLETION.md found wrongly ACCEPTED in V2 (qa-results.json case names) are now genuinely rejected", () => {
    let authority: { approvalId: string; snapshotId: string; contentHash: string };
    beforeAll(async () => {
      const { approved } = await formReviewAndApprove();
      authority = { approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash };
    });

    it("exportId_mismatch", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${randomUUID()}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_mirror" });
    });

    it("version_json_null", async () => {
      const { base } = closedCsvManifest({ version: null });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("format_json_null", async () => {
      const { base } = closedCsvManifest({ format: null });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("attemptKind_json_null", async () => {
      const { base } = closedCsvManifest({ attemptKind: null });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("outcome_json_null", async () => {
      const { base } = closedCsvManifest({ outcome: null });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("validation_version_json_null", async () => {
      const { base } = closedCsvManifest({
        validation: { version: null, state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("validation_state_json_null", async () => {
      const { base } = closedCsvManifest({
        validation: { version: "internal-estimate-export-validation-v1", state: null, issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("reconciliation_state_json_null", async () => {
      const { base } = closedCsvManifest({
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }], reconciliation: { state: null, approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("column_format_sql_null", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', ${null}, 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("column_attempt_sql_null", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', ${null}, ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("orphan_snapshot_without_authority", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id, internal_snapshot_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT}, ${authority.snapshotId})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_mirror" });
    });

    it("orphan_hash_without_authority", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id, approved_content_hash)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT}, ${authority.contentHash})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_mirror" });
    });

    it("renderer_without_representation", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id, renderer_version)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT}, 'internal-estimate-json-v1')
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_mirror" });
    });

    it("blocked_manifest_with_downloaded_status", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'downloaded', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("blocked_rowcount_nonzero", async () => {
      const { base } = closedCsvManifest();
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id, row_count)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT}, 5)
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("wrong_version_negative_control — still correctly rejected (sanity, not a regression)", async () => {
      const { base } = closedCsvManifest({ version: "internal-estimate-export-v0" });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
        VALUES (${base.exportId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("V2 QA item 2: a BLOCKED row with a known decision (real, non-null authority) whose declared approvedTotalMinor diverges from the real snapshot is rejected — the totals cross-check applies whenever authority exists, not only when is_ready", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const revoked = await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic revocation for the V2 QA item 2 divergent-total regression" },
        ACTOR, TENANT,
      );
      expect(revoked.revocationId).toBeTruthy();
      // INTERNAL_APPROVAL_REVOKED's totals class is "approvedOnly": approvedTotalMinor/
      // estimatedCostMinor present, exportedTotalMinor/differenceMinor null — but the
      // declared approvedTotalMinor below is DELIBERATELY one minor unit off the real
      // snapshot's finalPriceMinor, which the deferred trigger must now catch even
      // though this row's outcome is "blocked", not "ready".
      const wrongApprovedTotalMinor = (BigInt(review.snapshot.financials.finalPriceMinor) + 1n).toString();
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draft.id, estimateVersion: draft.version, requestedBy: ACTOR },
        authority: { approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash },
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REVOKED", lineKey: null, field: "approval" }], reconciliation: { state: "not_evaluated", approvedTotalMinor: wrongApprovedTotalMinor, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${wrongApprovedTotalMinor}, ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_approved_total_mismatch" });
    });
  });

  describe("V4 regression: the 13 cases MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md found wrongly ACCEPTED in V4 (qa-matrix-results.json case names), against a complete blocked control satisfying every required mirror", () => {
    // The V3-round fixture helpers never populated the legacy-reused columns
    // (contract_version/block_reason/skill_id/skill_version/csv_hash/estimate_
    // version/created_at/updated_at) at all, so a mutation on any ONE of them
    // could never be isolated — the row was already missing several OTHER
    // required mirrors. Each test here builds the FULL, correct set (matching
    // qa-matrix.sql's own valid_blocked_control exactly) and corrupts only the
    // one field under test.
    function fullColumnsAndValues(base: ReturnType<typeof closedCsvManifest>["base"], id: string, overrides: Record<string, unknown> = {}) {
      const defaults = {
        estimate_version: base.context.estimateVersion,
        contract_version: "internal-estimate-export-v1",
        block_reason: base.outcome === "blocked" ? (base.validation.issues as any)[0].code : null,
        skill_id: base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export",
        skill_version: "1.0.0",
        csv_hash: null,
        created_at: base.checkedAt,
        updated_at: base.checkedAt,
        downloaded_by: null,
        downloaded_at: null,
      };
      return { ...defaults, ...overrides, id };
    }
    async function insertFull(base: ReturnType<typeof closedCsvManifest>["base"], overrides: Record<string, unknown> = {}) {
      const v = fullColumnsAndValues(base, base.exportId, overrides);
      return connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, downloaded_by, downloaded_at)
        VALUES (${v.id}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT}, ${v.estimate_version}, ${v.contract_version}, ${v.block_reason}, ${v.skill_id}, ${v.skill_version}, ${v.csv_hash}, ${v.created_at}, ${v.updated_at}, ${v.downloaded_by}, ${v.downloaded_at})
      `;
    }

    it("valid_blocked_control — a complete blocked row satisfying every required mirror is accepted", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base)).resolves.toBeTruthy();
    });

    it("estimate_version_sql_null", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { estimate_version: null })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_mirror" });
    });

    it("contract_version_legacy", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { contract_version: "csv-v1.0" })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("block_reason_sql_null", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { block_reason: null })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("block_reason_wrong", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { block_reason: "EXPORT_FORMAT_UNSUPPORTED" })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("blocked_status_wrong", async () => {
      const { base } = closedCsvManifest();
      const v = fullColumnsAndValues(base, base.exportId);
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, downloaded_by, downloaded_at)
        VALUES (${v.id}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_validation', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT}, ${v.estimate_version}, ${v.contract_version}, ${v.block_reason}, ${v.skill_id}, ${v.skill_version}, ${v.csv_hash}, ${v.created_at}, ${v.updated_at}, ${v.downloaded_by}, ${v.downloaded_at})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("blocked_csv_hash_present", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { csv_hash: "a".repeat(64) })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("skill_id_wrong", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { skill_id: "gchi-jobtread-integration-contract" })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("skill_version_wrong", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { skill_version: "9.9.9" })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("blocked_download_fields_present", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { downloaded_by: ACTOR, downloaded_at: base.checkedAt })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("blocked_download_actor_only", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { downloaded_by: ACTOR })).rejects.toMatchObject({ constraint_name: "ck_jte_a1_all_or_none" });
    });

    it("created_updated_microseconds", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { created_at: "2026-10-01T00:00:00.000123Z", updated_at: "2026-10-01T00:00:00.000123Z" }))
        .rejects.toMatchObject({ constraint_name: "ck_jte_a1_time_precision" });
    });

    it("updated_at_not_initial_created_at", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { updated_at: "2026-10-01T00:00:00.001Z" })).rejects.toMatchObject({ constraint_name: "jte_a1_insert_timestamps_not_initial" });
    });

    it("updated_at_microseconds", async () => {
      const { base } = closedCsvManifest();
      await expect(insertFull(base, { updated_at: "2026-10-01T00:00:00.000123Z" })).rejects.toMatchObject({ constraint_name: "jte_a1_insert_timestamps_not_initial" });
    });
  });

  describe("MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review items (not among the 13 wrongly-accepted cases; separately reviewed, confirmed as real grammar gaps, and closed this round)", () => {
    // Direct-function proofs against internal_estimate_export_valid_manifest_v1
    // itself, not a full table INSERT — isolating exactly the grammar gap each
    // fix closed. A full-row insert can mask the SAME bug (e.g. the §6 trigger's
    // lineKeys-vs-snapshot comparison would independently reject a tampered
    // lineKeys array for an UNRELATED reason), which would prove the wrong thing.
    it("rejects a lineKeys array containing a JSON null element (was silently accepted: `->>` turns a JSON null into SQL NULL, and `NULL !~ regex` is UNKNOWN, not TRUE, so the per-element IF never returned false)", async () => {
      const { base } = closedCsvManifest({
        outcome: "ready", lineKeys: [null],
        authority: { approvalId: randomUUID(), snapshotId: randomUUID(), contentHash: "a".repeat(64) },
        validation: { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: "100", exportedTotalMinor: "100", differenceMinor: "0", estimatedCostMinor: "100" } },
        representation: {
          format: "json", rendererVersion: "internal-estimate-json-v1", generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: ACTOR,
          filename: "placeholder", mimeType: "application/json", encoding: "utf8", artifactHash: "d".repeat(64), byteLength: 10,
          details: { documentVersion: "internal-estimate-document-v1", serialization: "canonical-json-utf8-v1" },
        },
      });
      (base.representation as any).filename = `EST-${LEGACY_DRAFT}-${base.exportId}.json`;
      const [{ r }] = await connection`SELECT public.internal_estimate_export_valid_manifest_v1(${JSON.stringify(base)}::jsonb) as r`;
      expect(r).not.toBe(true);
    });

    it("rejects an issues[].lineKey that doesn't match the LineKey format `line:<ordinal>` (was silently accepted: the generic 'code' matcher permits ANY 1..128-char trimmed string, e.g. \"not-a-linekey\")", async () => {
      const { base } = closedCsvManifest({
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: "not-a-linekey", field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      const [{ r }] = await connection`SELECT public.internal_estimate_export_valid_manifest_v1(${JSON.stringify(base)}::jsonb) as r`;
      expect(r).not.toBe(true);
    });
  });

  describe("real recorded A1 decision — revoked, via the REAL accepted writers (not a hand-typed snapshot)", () => {
    it("records a real approval+revocation and inserts a blocked_authorization(known) row referencing it through the real FK", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const revoked = await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: review.contentHash, reason: "Synthetic physical revocation for A1 export foundation" },
        ACTOR, TENANT,
      );
      // INTERNAL_APPROVAL_REVOKED's totals class is "approvedOnly" (every code the
      // function doesn't list under "none"/"full" falls there): approvedTotalMinor and
      // estimatedCostMinor must be present, exportedTotalMinor/differenceMinor stay null.
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draft.id, estimateVersion: draft.version, requestedBy: ACTOR },
        authority: { approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash },
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REVOKED", lineKey: null, field: "approval" }], reconciliation: { state: "not_evaluated", approvedTotalMinor: review.snapshot.financials.finalPriceMinor, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor } },
      });
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash)
        VALUES (${base.exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${review.snapshot.financials.finalPriceMinor}, ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash})
      `;
      const [row] = await connection`SELECT internal_approval_id FROM jobtread_exports WHERE id = ${base.exportId}`;
      expect(row.internal_approval_id).toBe(approved.approvalId);
      expect(revoked.revocationId).toBeTruthy();
    });
  });

  describe("two independent connections — real lock/visibility, not a sleep-based proof", () => {
    it("a second connection cannot see an uncommitted insert from the first until commit", async () => {
      const second = postgres({ ...verifiedConnectionOptions, ssl: false, max: 1, prepare: false });
      try {
        const { base } = closedCsvManifest();
        const id = base.exportId;
        await connection.begin(async tx => {
          await tx`
            INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, client_id)
            VALUES (${id}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${CLIENT})
          `;
          const [visibleInsideTx] = await tx`SELECT count(*)::int as n FROM jobtread_exports WHERE id = ${id}`;
          const [visibleFromSecond] = await second`SELECT count(*)::int as n FROM jobtread_exports WHERE id = ${id}`;
          expect(visibleInsideTx.n).toBe(1);
          expect(visibleFromSecond.n).toBe(0);
        });
        const [visibleAfterCommit] = await second`SELECT count(*)::int as n FROM jobtread_exports WHERE id = ${id}`;
        expect(visibleAfterCommit.n).toBe(1);
      } finally {
        await second.end({ timeout: 1 });
      }
    });
  });

  describe("real multi-process concurrency — separate OS processes, observable lock barriers, never sleeps as proof", () => {
    // V4 redesign (MICHAEL-A1-EXPORT-PHYSICAL-V3-QA-AND-COMPLETION.md §1/§2): no
    // GUC/pg_sleep hook in the product (removed from migration 0013 entirely — see
    // diff), and no pre-lock taken by any worker on behalf of the product. Instead
    // every worker drives psql INTERACTIVELY and, after its real write statement(s),
    // issues `SET CONSTRAINTS ALL IMMEDIATE` — a plain SQL command, not an
    // instrumented trigger — which forces whichever REAL deferred constraint
    // trigger this transaction owes (this migration's jobtread_export_a1_check_
    // final_v1 for insert/first-download; 0007's internal_approval_check_final_v1
    // for revoke/supersede) to run NOW, while the transaction is still open. The
    // worker then announces readiness and WAITS for a literal "RELEASE" line on its
    // own stdin — written by this test only once it has independently confirmed,
    // via pg_locks, that the SECOND process is genuinely blocked on the FIRST
    // process's OWN specific transaction id AND on a tuple lock on estimate_drafts
    // (not "any" lock) — before letting the first COMMIT. This makes both orderings
    // of every pair genuine lock contention, discriminating the real trigger's own
    // lock-taking, for revoke AND supersede alike — no asymmetric "sequential
    // precedence" fallback is needed anymore (V3 needed one only because its GUC
    // hook could widen its own trigger's hold but not 0007's; SET CONSTRAINTS ALL
    // IMMEDIATE needs no such hook on either side).
    // Scope named explicitly: permission-withdrawal×delivery (A1-EXPORT-DATA-
    // CONTRACT.md §10 item 6) remains out of this slice — application-level
    // permission/bytes/audit concerns, not the physical foundation.
    const workerScript = new URL("./a1-export-physical-concurrency-worker.mjs", import.meta.url).pathname;
    async function writeParamsFile(params: Record<string, unknown>) {
      const dir = await mkdtemp(join(tmpdir(), "a1-export-physical-worker-"));
      const file = join(dir, "params.json");
      await writeFile(file, JSON.stringify(params));
      return { file, dir };
    }
    function connConfig() {
      return { socketDirectory: verifiedConnectionOptions.host, database: verifiedConnectionOptions.database, user: verifiedConnectionOptions.username, port: verifiedConnectionOptions.port };
    }

    /** Drives one worker process and lets the test wait for specific lifecycle
     * events by name, or release it past its own wait-for-RELEASE point. Any
     * spawn error or an exit that happens before a still-pending wait resolves
     * rejects that wait explicitly — a worker that dies early must fail the test
     * that was waiting on it, never hang forever (V3 QA §3). */
    function spawnWorker(role: string, paramsFile: string) {
      const child = spawn("node", [workerScript, role, paramsFile], { stdio: ["pipe", "pipe", "pipe"] });
      const events: any[] = [];
      const waiters: Array<{ name: string; resolve: (e: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
      let exited = false;
      let psqlPid: number | null = null;
      const rl = createInterface({ input: child.stdout });
      rl.on("line", line => {
        try {
          const event = JSON.parse(line);
          events.push(event);
          if (event.event === "psql_spawned") psqlPid = event.pid;
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].name === event.event) { clearTimeout(waiters[i].timer); waiters[i].resolve(event); waiters.splice(i, 1); }
          }
        } catch { /* non-JSON output is ignored, never treated as a signal */ }
      });
      let stderr = "";
      child.stderr.on("data", d => { stderr += d; });
      function failAllWaiters(reason: Error) {
        for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.reject(reason); }
      }
      // V5 fix (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §4): `done`
      // previously resolved on the ChildProcess's own "exit" event — which can
      // fire before this readline interface has finished reading and parsing
      // the LAST buffered stdout line (e.g. "committed", written immediately
      // before the worker calls process.exit()), silently dropping it from
      // `events`. Resolving on the READLINE INTERFACE's own "close" event
      // instead guarantees every line that ever arrived was already parsed —
      // that event only fires once the underlying stdout stream itself ends,
      // strictly after all its "line" events have fired. A spawn error (e.g.
      // ENOENT) is not guaranteed to produce that naturally within a bounded
      // time on every platform, so it still gets an explicit bounded fallback.
      let settleDone: (events: any[]) => void = () => {};
      const done = new Promise<any[]>(resolveDone => { settleDone = resolveDone; });
      let doneSettled = false;
      let lastExitCode: number | null = null;
      // V5 fix (regression found while verifying the §4 fix above): resolving
      // `done` on EITHER signal alone is unsafe on its own. The readline's own
      // "close" only proves every stdout line was parsed — it does NOT prove
      // the OS has actually reaped the process, so confirmProcessGone's
      // process.kill(pid, 0) can still observe it briefly alive right after.
      // The child's own "exit" proves the OS reaped it, but can fire before
      // the readline has drained the last buffered line (the original V4 bug).
      // Only the CONJUNCTION of both gives every guarantee this test needs.
      let processExited = false;
      let stdoutClosed = false;
      function settleOnce(label: string) {
        if (doneSettled) return;
        if (label !== "spawn_error_fallback" && !(processExited && stdoutClosed)) return;
        doneSettled = true;
        exited = true;
        events.push({ event: "process_exit", via: label, code: lastExitCode });
        failAllWaiters(new Error(`worker ${role} exited (${label}, code ${lastExitCode}) before this event arrived — stderr: ${stderr.slice(0, 2000)}`));
        settleDone(events);
      }
      child.on("exit", code => { lastExitCode = code; processExited = true; settleOnce("exit_and_stdout_closed"); });
      rl.on("close", () => { stdoutClosed = true; settleOnce("exit_and_stdout_closed"); });
      child.on("error", error => {
        events.push({ event: "spawn_error", error: String(error) });
        failAllWaiters(new Error(`worker ${role} spawn error: ${error}`));
        // Neither "exit" nor the readline's "close" is guaranteed on every
        // platform/failure for a genuine spawn error — a bounded fallback
        // prevents an indefinite hang specifically on that case.
        setTimeout(() => settleOnce("spawn_error_fallback"), 2000);
      });
      function waitFor(name: string, timeoutMs = 15000): Promise<any> {
        const already = events.find(e => e.event === name);
        if (already) return Promise.resolve(already);
        if (exited) return Promise.reject(new Error(`worker ${role} already exited without ever emitting "${name}"`));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            const idx = waiters.findIndex(w => w.resolve === resolve);
            if (idx >= 0) waiters.splice(idx, 1);
            reject(new Error(`worker ${role} (pid lookup via "started") timed out waiting for "${name}" after ${timeoutMs}ms`));
          }, timeoutMs);
          waiters.push({ name, resolve, reject, timer });
        });
      }
      function release() { child.stdin.write("RELEASE\n"); }
      function pids() { return { workerPid: child.pid, psqlPid }; }
      // V5 fix (§4): must cover failure/cancellation, not just the happy path —
      // always attempts to reap a KNOWN psql pid even if the worker process
      // itself already exited (it may have died before reaping its own child),
      // signals the worker gracefully (SIGTERM) before escalating to SIGKILL,
      // and WAITS (bounded) for confirmation rather than firing-and-forgetting.
      async function killIfAlive() {
        if (!exited) {
          try { child.kill("SIGTERM"); } catch { /* best effort */ }
          const exitedAfterTerm = await Promise.race([
            new Promise<boolean>(resolve => { const check = () => { if (exited) resolve(true); else setTimeout(check, 20); }; check(); }),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3000)),
          ]);
          if (!exitedAfterTerm) {
            try { child.kill("SIGKILL"); } catch { /* best effort */ }
            await new Promise<void>(resolve => { const check = () => { if (exited) resolve(); else setTimeout(check, 20); }; setTimeout(check, 0); setTimeout(resolve, 2000); });
          }
        }
        if (psqlPid) {
          let psqlAlive = true;
          try { process.kill(psqlPid, 0); } catch { psqlAlive = false; }
          if (psqlAlive) { try { process.kill(psqlPid, "SIGKILL"); } catch { /* best effort, may already be gone */ } }
        }
      }
      return { events, waitFor, release, done, pids, killIfAlive };
    }

    /** Real signals read directly from Postgres's own lock tables — never a sleep
     * used as proof, and bound to the SPECIFIC expected holder's own transaction
     * id (not "any" granted lock), per V3 QA §2. */
    async function xidOf(pid: number, timeoutMs = 5000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const [row] = await connection`SELECT transactionid::text as xid FROM pg_locks WHERE locktype = 'transactionid' AND pid = ${pid} AND granted = true LIMIT 1`;
        if (row) return row.xid;
        await new Promise(r => setTimeout(r, 20));
      }
      throw new Error(`timed out waiting for pid ${pid} to hold its own transaction id`);
    }
    /** Confirms waiterPid is specifically blocked waiting on holderXid's own
     * transaction — bound to the exact expected blocker's identity, never "any"
     * granted/pending lock (V3 QA §2). Empirically (confirmed via pg_locks while
     * debugging this very check): a plain UPDATE blocking on a row another
     * backend holds via `SELECT ... FOR UPDATE` surfaces ONLY as a `transactionid`
     * wait on the holder's xid — Postgres does not also emit a separate
     * ungranted `tuple`-type row for this specific contention shape (a granted
     * `tuple` row for the WAITER's own just-inserted/just-updated row can appear
     * at the same time and is not itself evidence of a block), so a `tuple`-type
     * wait is not required here. */
    async function confirmBlockedOnDraftLock(waiterPid: number, holderXid: string, timeoutMs = 5000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const [xidWait] = await connection`SELECT 1 as x FROM pg_locks WHERE locktype = 'transactionid' AND pid = ${waiterPid} AND transactionid = ${holderXid}::xid AND granted = false LIMIT 1`;
        if (xidWait) return;
        await new Promise(r => setTimeout(r, 20));
      }
      const diag = await connection`SELECT locktype, mode, granted, transactionid::text, relation::regclass::text as relation_name FROM pg_locks WHERE pid = ${waiterPid}`;
      throw new Error(`timed out waiting for pid ${waiterPid} to be blocked specifically on xid ${holderXid} — actual locks for that pid: ${JSON.stringify(diag)}`);
    }
    function confirmProcessGone(pid: number | null): void {
      if (pid === null) return;
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      expect(alive).toBe(false);
    }

    async function insertReadyRowDirectly(args: { exportRowId: string; draftId: string; approvedMinor: string; approvalId: string; snapshotId: string; contentHash: string; base: any }) {
      const { exportRowId, draftId, approvedMinor, base } = args;
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
        VALUES (${exportRowId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draftId}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${base.context.estimateVersion}, 'internal-estimate-export-v1', ${base.outcome === "blocked" ? base.validation.issues[0].code : null}, ${base.format === "csv_jobtread" ? "gchi-jobtread-integration-contract" : "structr-internal-estimate-export"}, '1.0.0', ${base.outcome === "ready" && base.format === "csv_jobtread" ? base.representation.artifactHash : null}, ${base.checkedAt}, ${base.checkedAt}, ${approvedMinor}, ${approvedMinor}, '0', ${CLIENT}, ${args.approvalId}, ${args.snapshotId}, ${args.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash}, 1)
      `;
    }
    function supersedeParams(parentDraft: { id: string; version: number }) {
      return { ...connConfig(), parentId: parentDraft.id, parentVersion: parentDraft.version, childId: randomUUID(), requestId: randomUUID(), requestHash: "d".repeat(64), actorId: ACTOR };
    }

    /** The export-side role (insert-ready/first-download) holds the real lock
     * first; the contender (revoke/supersede) is observed genuinely blocked on
     * that exact transaction, then released. */
    async function exportWins(exportRole: string, exportParamsFile: string, contenderRole: string, contenderParamsFile: string, dirs: { dir: string }[]) {
      // Spawned in strict temporal order, not both upfront — spawning the
      // contender eagerly before export genuinely holds its lock let both
      // processes' deferred checks race concurrently, which produced a REAL
      // Postgres deadlock (40P01) rather than the intended ordered contention.
      let contenderWorker: ReturnType<typeof spawnWorker> | null = null;
      const exportWorker = spawnWorker(exportRole, exportParamsFile);
      try {
        await exportWorker.waitFor("psql_spawned");
        await exportWorker.waitFor("deferred_checks_done");
        const exportPid = (exportWorker.events.find(e => e.event === "started"))?.pid;
        const exportXid = await xidOf(exportPid);

        contenderWorker = spawnWorker(contenderRole, contenderParamsFile);
        await contenderWorker.waitFor("psql_spawned");
        await contenderWorker.waitFor("write_sent"); // the contender's write touches estimate_drafts directly and blocks right here
        const contenderPid = (contenderWorker.events.find(e => e.event === "started"))?.pid;
        await confirmBlockedOnDraftLock(contenderPid, exportXid);

        exportWorker.release();
        const exportEvents = await exportWorker.done;
        expect(exportEvents.find(e => e.event === "committed")).toBeTruthy();

        await contenderWorker.waitFor("deferred_checks_done");
        contenderWorker.release();
        const contenderEvents = await contenderWorker.done;
        expect(contenderEvents.find(e => e.event === "committed")).toBeTruthy();

        confirmProcessGone(exportWorker.pids().workerPid); confirmProcessGone(exportWorker.pids().psqlPid);
        confirmProcessGone(contenderWorker.pids().workerPid); confirmProcessGone(contenderWorker.pids().psqlPid);
        return { exportEvents, contenderEvents };
      } finally {
        await exportWorker.killIfAlive(); await contenderWorker?.killIfAlive();
        for (const d of dirs) await rm(d.dir, { recursive: true, force: true });
      }
    }

    /** The contender (revoke/supersede) holds the real lock first; the export-side
     * role is observed genuinely blocked on that exact transaction at its own
     * SET CONSTRAINTS ALL IMMEDIATE, then released — and must re-read fresh state
     * and reject, proving it never trusted a stale read. Spawned in strict
     * temporal order for the same reason as exportWins above. */
    async function contenderWins(contenderRole: string, contenderParamsFile: string, exportRole: string, exportParamsFile: string, expectedRejectConstraint: string, dirs: { dir: string }[]) {
      let exportWorker: ReturnType<typeof spawnWorker> | null = null;
      const contenderWorker = spawnWorker(contenderRole, contenderParamsFile);
      try {
        await contenderWorker.waitFor("psql_spawned");
        await contenderWorker.waitFor("deferred_checks_done");
        const contenderPid = (contenderWorker.events.find(e => e.event === "started"))?.pid;
        const contenderXid = await xidOf(contenderPid);

        exportWorker = spawnWorker(exportRole, exportParamsFile);
        await exportWorker.waitFor("psql_spawned");
        // Where export actually blocks depends on the role: insert-ready's own
        // write is a real FK reference to estimate_drafts (jte_a1_draft_context_fk),
        // whose standard immediate FK validation lock can itself block right at
        // the write step; first-download's write never touches estimate_drafts at
        // all, so it only blocks later at SET CONSTRAINTS ALL IMMEDIATE. Waiting on
        // "write_sent" (always the first thing emitted either way) and then
        // polling pg_locks covers both — the poll loop below simply keeps
        // checking until whichever point actually blocks is reached.
        await exportWorker.waitFor("write_sent");
        const exportPid = (exportWorker.events.find(e => e.event === "started"))?.pid;
        await confirmBlockedOnDraftLock(exportPid, contenderXid);

        contenderWorker.release();
        const contenderEvents = await contenderWorker.done;
        expect(contenderEvents.find(e => e.event === "committed")).toBeTruthy();

        const exportEvents = await exportWorker.done; // unblocks on its own once released, re-reads, rejects — no release needed
        const rejected = exportEvents.find(e => e.event === "rejected");
        expect(rejected).toBeTruthy();
        expect(rejected.constraint_name).toBe(expectedRejectConstraint);

        confirmProcessGone(exportWorker.pids().workerPid); confirmProcessGone(exportWorker.pids().psqlPid);
        confirmProcessGone(contenderWorker.pids().workerPid); confirmProcessGone(contenderWorker.pids().psqlPid);
        return { exportEvents, contenderEvents };
      } finally {
        await exportWorker?.killIfAlive(); await contenderWorker.killIfAlive();
        for (const d of dirs) await rm(d.dir, { recursive: true, force: true });
      }
    }

    it("insert wins over revoke: a second, genuinely separate OS process is OBSERVED via pg_locks blocked on the specific transaction holding the draft row lock (identity-bound, not any lock), and the already-committed ready row is never retroactively invalidated by the later revocation", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      const insert = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId, manifest: base });
      const revoke = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, revocationId: randomUUID(), requestId: randomUUID(), requestHash: "a".repeat(64), reason: "Synthetic real multi-process revocation racing a real export insert" });

      await exportWins("insert-ready", insert.file, "revoke", revoke.file, [insert, revoke]);
      const [row] = await connection`SELECT status, internal_approval_id FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.status).toBe("approved_for_download");
      expect(row.internal_approval_id).toBe(approved.approvalId);
    }, 20000);

    it("revoke wins over insert: a second, genuinely separate OS process (the export insert) is OBSERVED via pg_locks blocked on revoke's specific transaction, then re-reads fresh state after release and rejects — no row is left behind", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      const revoke = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, revocationId: randomUUID(), requestId: randomUUID(), requestHash: "b".repeat(64), reason: "Synthetic real multi-process revocation that must win before the export insert" });
      const insert = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId, manifest: base });

      await contenderWins("revoke", revoke.file, "insert-ready", insert.file, "jte_a1_export_approval_revoked", [revoke, insert]);
      const [row] = await connection`SELECT count(*)::int as n FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.n).toBe(0);
    }, 20000);

    it("first download wins over revoke: a second, genuinely separate OS process is OBSERVED via pg_locks blocked on the specific transaction holding the draft row lock, and the already-downloaded row is never retroactively invalidated by the later revocation", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      await insertReadyRowDirectly({ exportRowId, draftId: draft.id, approvedMinor: review.snapshot.financials.finalPriceMinor, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, base });
      const download = await writeParamsFile({ ...connConfig(), exportRowId, downloaderId: DOWNLOADER, downloadedAt: "2026-10-01T00:00:00.400Z" });
      const revoke = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, revocationId: randomUUID(), requestId: randomUUID(), requestHash: "e".repeat(64), reason: "Synthetic real multi-process revocation racing a real first-download projection" });

      await exportWins("first-download", download.file, "revoke", revoke.file, [download, revoke]);
      const [row] = await connection`SELECT status, downloaded_by FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.status).toBe("downloaded");
      expect(row.downloaded_by).toBe(DOWNLOADER);
    }, 20000);

    it("revoke wins over first download: a second, genuinely separate OS process (the first-download projection) is OBSERVED via pg_locks blocked on revoke's specific transaction, then re-reads fresh state after release and rejects — the row is never partially updated", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      await insertReadyRowDirectly({ exportRowId, draftId: draft.id, approvedMinor: review.snapshot.financials.finalPriceMinor, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, base });
      const revoke = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, revocationId: randomUUID(), requestId: randomUUID(), requestHash: "f".repeat(64), reason: "Synthetic real multi-process revocation that must win before the first-download projection" });
      const download = await writeParamsFile({ ...connConfig(), exportRowId, downloaderId: DOWNLOADER, downloadedAt: "2026-10-01T00:00:00.500Z" });

      await contenderWins("revoke", revoke.file, "first-download", download.file, "jte_a1_export_approval_revoked", [revoke, download]);
      const [row] = await connection`SELECT status, downloaded_by FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.status).toBe("approved_for_download");
      expect(row.downloaded_by).toBeNull();
    }, 20000);

    it("insert wins over supersession: a second, genuinely separate OS process (a real version-succession, cloned from a real valid sibling row) is OBSERVED via pg_locks blocked on the specific transaction holding the draft row lock, and the already-committed ready row is never retroactively invalidated by the later supersession", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      const insert = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId, manifest: base });
      const supersede = await writeParamsFile(supersedeParams(draft));

      await exportWins("insert-ready", insert.file, "supersede", supersede.file, [insert, supersede]);
      const [row] = await connection`SELECT status, internal_approval_id FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.status).toBe("approved_for_download");
      expect(row.internal_approval_id).toBe(approved.approvalId);
      const [parent] = await connection`SELECT superseded_by FROM estimate_drafts WHERE id = ${draft.id}`;
      expect(parent.superseded_by).toBeTruthy(); // supersession itself still completed, just after the export
    }, 20000);

    it("supersession wins over insert: a second, genuinely separate OS process (the export insert) is OBSERVED via pg_locks blocked on the supersession's specific transaction, then re-reads fresh state after release and rejects — no row is left behind", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      const supersede = await writeParamsFile(supersedeParams(draft));
      const insert = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId, manifest: base });

      await contenderWins("supersede", supersede.file, "insert-ready", insert.file, "jte_a1_export_draft_superseded", [supersede, insert]);
      const [row] = await connection`SELECT count(*)::int as n FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.n).toBe(0);
    }, 20000);

    it("first download wins over supersession: a second, genuinely separate OS process (a real version-succession) is OBSERVED via pg_locks blocked on the specific transaction holding the draft row lock, and the already-downloaded row is never retroactively invalidated by the later supersession", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      await insertReadyRowDirectly({ exportRowId, draftId: draft.id, approvedMinor: review.snapshot.financials.finalPriceMinor, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, base });
      const download = await writeParamsFile({ ...connConfig(), exportRowId, downloaderId: DOWNLOADER, downloadedAt: "2026-10-01T00:00:00.600Z" });
      const supersede = await writeParamsFile(supersedeParams(draft));

      await exportWins("first-download", download.file, "supersede", supersede.file, [download, supersede]);
      const [row] = await connection`SELECT status, downloaded_by FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.status).toBe("downloaded");
      expect(row.downloaded_by).toBe(DOWNLOADER);
    }, 20000);

    it("supersession wins over first download: a second, genuinely separate OS process (the first-download projection) is OBSERVED via pg_locks blocked on the supersession's specific transaction, then re-reads fresh state after release and rejects — the row is never partially updated", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const exportRowId = base.exportId;
      await insertReadyRowDirectly({ exportRowId, draftId: draft.id, approvedMinor: review.snapshot.financials.finalPriceMinor, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, base });
      const supersede = await writeParamsFile(supersedeParams(draft));
      const download = await writeParamsFile({ ...connConfig(), exportRowId, downloaderId: DOWNLOADER, downloadedAt: "2026-10-01T00:00:00.700Z" });

      await contenderWins("supersede", supersede.file, "first-download", download.file, "jte_a1_export_draft_superseded", [supersede, download]);
      const [row] = await connection`SELECT status, downloaded_by FROM jobtread_exports WHERE id = ${exportRowId}`;
      expect(row.status).toBe("approved_for_download");
      expect(row.downloaded_by).toBeNull();
    }, 20000);

    // MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §4: "Provar falha antes
    // de ready e cancelamento com worker/psql realmente ativos" — neither was
    // proved in V4 (the slow spec in the SIGTERM runner proof never starts a
    // concurrency worker at all). Both proved directly here.
    it("worker lifecycle: a failure BEFORE the started event (an unknown role, no psql ever spawned) rejects every pending wait and resolves done — never hangs", async () => {
      const dir = await mkdtemp(join(tmpdir(), "a1-export-physical-worker-"));
      const file = join(dir, "params.json");
      await writeFile(file, JSON.stringify({ ...connConfig() }));
      try {
        const child = spawn("node", [workerScript, "not-a-real-role", file], { stdio: ["pipe", "pipe", "pipe"] });
        const exitCode = await new Promise<number | null>(resolve => child.on("exit", resolve));
        expect(exitCode).not.toBe(0); // the worker's own catch-block path: process.exit(1) on an unknown role, before psql is ever spawned
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, 10000);

    it("worker lifecycle: cancelling a worker that is genuinely ACTIVE (holding the real deferred-trigger lock, mid-RELEASE-wait) via killIfAlive leaves no process behind AND releases the real Postgres lock for the next transaction", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;
      const insert = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId: base.exportId, manifest: base });
      const worker = spawnWorker("insert-ready", insert.file);
      try {
        await worker.waitFor("deferred_checks_done"); // genuinely active: psql real, transaction open, real FOR UPDATE lock actually held
        const { workerPid, psqlPid } = worker.pids();
        expect(psqlPid).not.toBeNull();
        await worker.killIfAlive(); // cancellation, never a RELEASE — this is what proves the cancellation path, not the happy path
        let workerAlive = true; try { process.kill(workerPid!, 0); } catch { workerAlive = false; }
        let psqlAlive = true; try { process.kill(psqlPid!, 0); } catch { psqlAlive = false; }
        expect(workerAlive).toBe(false);
        expect(psqlAlive).toBe(false);
        // The real lock must be gone too, not just the processes — proved by a
        // brand-new, completely real transaction (via the SAME insert-ready role,
        // a fresh psql process) now succeeding without ever blocking.
        const insert2 = await writeParamsFile({ ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId: base.exportId, manifest: base });
        const retryWorker = spawnWorker("insert-ready", insert2.file);
        try {
          await retryWorker.waitFor("deferred_checks_done");
          retryWorker.release();
          const events = await retryWorker.done;
          expect(events.find(e => e.event === "committed")).toBeTruthy();
        } finally {
          await retryWorker.killIfAlive();
          await rm(insert2.dir, { recursive: true, force: true });
        }
      } finally {
        await worker.killIfAlive();
        await rm(insert.dir, { recursive: true, force: true });
      }
    }, 15000);
  });
});
