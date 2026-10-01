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
        VALUES (${randomUUID()}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'v1', ${JSON.stringify(base)}::jsonb, ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_insert_marker_invalid" });
    });
  });

  describe("a valid blocked_authorization (no decision) row", () => {
    let id: string;
    it("inserts successfully through the real CHECK/trigger stack", async () => {
      const { base } = closedCsvManifest();
      id = randomUUID();
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id)
        VALUES (${id}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id)
        VALUES (${randomUUID()}, ${otherTenant}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT})
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
      id = randomUUID();
      // Every mirror validated at once: context/client/version, marker, totals, hash,
      // representation — all genuinely coherent with the real approval, not patched one
      // CHECK at a time.
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draftId}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
      // omitting it. Still decoupled from the download-transition proof itself: this is
      // its own row, its own status, its own (20-digit) totals — the structural function
      // does not yet cross-check declared totals against the snapshot's real amounts
      // (that correspondence is the deferred constraint trigger's job, not built yet).
      // differenceMinor is exportedTotalMinor - approvedTotalMinor (the SQL function's own
      // sign convention, confirmed from its expected_diff computation) — exported is the
      // larger value here so the difference is a genuine, non-zero positive.
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draftId, estimateVersion: draftVersion, requestedBy: ACTOR },
        authority: { approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash },
        validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: "currency" }], reconciliation: { state: "mismatch", approvedTotalMinor: "99999999999999999998", exportedTotalMinor: "99999999999999999999", differenceMinor: "1", estimatedCostMinor: "1" } },
      });
      const bigId = randomUUID();
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash)
        VALUES (${bigId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draftId}, 'blocked_reconciliation', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'mismatch', '99999999999999999998', '99999999999999999999', '1', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash})
      `;
      const [row] = await connection`SELECT approved_total_cents::text as a, exported_total_cents::text as e, difference_cents::text as d FROM jobtread_exports WHERE id = ${bigId}`;
      expect(row.a).toBe("99999999999999999998");
      expect(row.e).toBe("99999999999999999999");
      expect(row.d).toBe("1");
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
      const blockedId = randomUUID();
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id)
        VALUES (${blockedId}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${home.draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${home.review.snapshot.financials.finalPriceMinor}, ${home.review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${elsewhere.approved.approvalId}, ${elsewhere.approved.snapshotId}, ${elsewhere.approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${otherClient})
      `).rejects.toMatchObject({ constraint_name: "jte_a1_export_client_context" });
    });

    it("rejects requested_by that is not a real profile in this tenant (jte_a1_requester_fk, via the generated a1_requested_by column)", async () => {
      const { draft } = await formReviewAndApprove();
      const ghostActor = randomUUID();
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, estimateDraftId: draft.id, estimateVersion: draft.version, requestedBy: ghostActor },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'blocked_authorization', ${ghostActor}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT})
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
      const id = randomUUID();
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${wrongHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'csv_jobtread', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-jobtread-csv-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
      `).resolves.toBeTruthy();
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'csv_jobtread', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-jobtread-csv-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'csv_jobtread', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-jobtread-csv-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
      `).rejects.toBeTruthy(); // the structural CHECK itself already catches this shape (a1_export_exact_amount_minor_v1), proving the same rule is enforced before our row is ever committed
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${randomUUID()}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
      const id = randomUUID();
      // The preflight insert happens BEFORE any revocation exists — legitimately accepted.
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
      const id = randomUUID();
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
        VALUES (${id}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', ${review.snapshot.financials.finalPriceMinor}, ${review.snapshot.financials.finalPriceMinor}, '0', ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash}, 'internal-estimate-json-v1', ${base.representation.generatedAt}, 10, ${base.representation.artifactHash})
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
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id)
        VALUES (${randomUUID()}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'approved_for_download', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'matched', '100', '100', '0', ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("rejects EXPORT_RECONCILIATION_MISMATCH with a zero difference", async () => {
      const { base } = closedCsvManifest({
        validation: { version: "internal-estimate-export-validation-v1", state: "invalid", issues: [{ code: "EXPORT_RECONCILIATION_MISMATCH", lineKey: null, field: "currency" }], reconciliation: { state: "mismatch", approvedTotalMinor: "100", exportedTotalMinor: "100", differenceMinor: "0", estimatedCostMinor: "40" } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id)
        VALUES (${randomUUID()}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_reconciliation', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'mismatch', '100', '100', '0', ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_valid" });
    });

    it("accepts clientId=NULL paired with ESTIMATE_CLIENT_MISSING (control)", async () => {
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: PROJECT, clientId: null, estimateDraftId: LEGACY_DRAFT, estimateVersion: 1, requestedBy: ACTOR },
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "ESTIMATE_CLIENT_MISSING", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status)
        VALUES (${randomUUID()}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated')
      `).resolves.toBeTruthy();
    });

    it("rejects a non-null clientId column alongside ESTIMATE_CLIENT_MISSING in the manifest mirror check", async () => {
      const { base } = closedCsvManifest({
        context: { tenantId: TENANT, projectId: PROJECT, clientId: null, estimateDraftId: LEGACY_DRAFT, estimateVersion: 1, requestedBy: ACTOR },
        validation: { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "ESTIMATE_CLIENT_MISSING", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
      });
      await expect(connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id)
        VALUES (${randomUUID()}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT})
      `).rejects.toMatchObject({ constraint_name: "ck_jte_a1_manifest_mirror" });
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
      const exportId = randomUUID();
      await connection`
        INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash)
        VALUES (${exportId}, ${TENANT}, ${APPROVAL_PROJECT}, ${draft.id}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${review.snapshot.financials.finalPriceMinor}, ${CLIENT}, ${approved.approvalId}, ${approved.snapshotId}, ${approved.contentHash})
      `;
      const [row] = await connection`SELECT internal_approval_id FROM jobtread_exports WHERE id = ${exportId}`;
      expect(row.internal_approval_id).toBe(approved.approvalId);
      expect(revoked.revocationId).toBeTruthy();
    });
  });

  describe("two independent connections — real lock/visibility, not a sleep-based proof", () => {
    it("a second connection cannot see an uncommitted insert from the first until commit", async () => {
      const second = postgres({ ...verifiedConnectionOptions, ssl: false, max: 1, prepare: false });
      try {
        const id = randomUUID();
        const { base } = closedCsvManifest();
        await connection.begin(async tx => {
          await tx`
            INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, client_id)
            VALUES (${id}, ${TENANT}, ${PROJECT}, ${LEGACY_DRAFT}, 'blocked_authorization', ${ACTOR}, 'internal-estimate-export-v1', 'json', 'preflight', ${base.checkedAt}, ${JSON.stringify(base)}::jsonb, ${JSON.stringify(base.validation)}::jsonb, 'not_evaluated', ${CLIENT})
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
    // Scope named explicitly: only insert×revoke and revoke×insert are exercised as
    // real separate-process races here. createVersion×export and permission-
    // withdrawal×delivery (also listed in A1-EXPORT-DATA-CONTRACT.md §10 item 6) are
    // NOT exercised in this round — a real, bounded limit, not a silent gap.
    const workerScript = new URL("./a1-export-physical-concurrency-worker.mjs", import.meta.url).pathname;
    async function writeParamsFile(params: Record<string, unknown>) {
      const dir = await mkdtemp(join(tmpdir(), "a1-export-physical-worker-"));
      const file = join(dir, "params.json");
      await writeFile(file, JSON.stringify(params));
      return { file, dir };
    }
    function spawnWorker(role: string, paramsFile: string) {
      const child = spawn("node", [workerScript, role, paramsFile], { stdio: ["ignore", "pipe", "pipe"] });
      const events: any[] = [];
      let resolveReady: () => void;
      const ready = new Promise<void>(r => { resolveReady = r; });
      const rl = createInterface({ input: child.stdout });
      rl.on("line", line => {
        try {
          const event = JSON.parse(line);
          events.push(event);
          if (event.event === "lock_acquired") resolveReady();
        } catch { /* non-JSON output is ignored, never treated as a signal */ }
      });
      let stderr = "";
      child.stderr.on("data", d => { stderr += d; });
      const done = new Promise<any[]>((resolveDone, reject) => {
        child.on("exit", code => {
          rl.close();
          if (code !== 0) reject(new Error(`worker ${role} exited ${code}: ${stderr}`));
          else resolveDone(events);
        });
      });
      return { ready, done };
    }
    function connConfig() {
      return { socketDirectory: verifiedConnectionOptions.host, database: verifiedConnectionOptions.database, user: verifiedConnectionOptions.username, port: verifiedConnectionOptions.port };
    }

    it("insert wins the race: a second, genuinely separate OS process blocks on the real draft row lock, and the already-committed ready row is never retroactively invalidated by the later revocation", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const exportRowId = randomUUID();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;

      const insert = await writeParamsFile({
        ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId, manifest: base,
      });
      const revoke = await writeParamsFile({
        ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR,
        approvalId: approved.approvalId, revocationId: randomUUID(), requestId: randomUUID(), requestHash: "a".repeat(64),
        reason: "Synthetic real multi-process revocation racing a real export insert",
      });
      try {
        // The orchestrator deterministically starts the insert worker FIRST and waits
        // for its own "lock_acquired" signal (a genuine process-to-process barrier, not
        // a sleep) before even spawning the revoke worker — making the insert the
        // guaranteed first holder of the row lock, while the actual blocking the revoke
        // worker then experiences is entirely real Postgres lock contention.
        const insertWorker = spawnWorker("lock-and-insert-ready", insert.file);
        await insertWorker.ready;
        const revokeWorker = spawnWorker("lock-and-revoke", revoke.file);
        const [insertEvents, revokeEvents] = await Promise.all([insertWorker.done, revokeWorker.done]);

        const insertCommitted = insertEvents.find(e => e.event === "committed");
        const revokeLockAcquired = revokeEvents.find(e => e.event === "lock_acquired");
        const revokeCommitted = revokeEvents.find(e => e.event === "committed");
        expect(insertCommitted).toBeTruthy();
        expect(revokeCommitted).toBeTruthy();
        expect(revokeLockAcquired).toBeTruthy();
        // Real serialization, not a coincidence of scheduling: the revoke process could
        // only acquire the lock AFTER the insert process's deliberate 1s hold, so the
        // gap below is the OBSERVED effect of the real lock, not an assumed ordering.
        const gapMs = new Date(revokeLockAcquired.at).getTime() - new Date(insertCommitted.at).getTime();
        expect(gapMs).toBeGreaterThanOrEqual(-50); // revoke's lock_acquired is at/after insert's commit, within clock-skew tolerance

        // Non-retroactive invalidation: the row the insert process committed BEFORE the
        // revoke even existed remains exactly as inserted.
        const [row] = await connection`SELECT status, internal_approval_id FROM jobtread_exports WHERE id = ${exportRowId}`;
        expect(row.status).toBe("approved_for_download");
        expect(row.internal_approval_id).toBe(approved.approvalId);
      } finally {
        await rm(insert.dir, { recursive: true, force: true });
        await rm(revoke.dir, { recursive: true, force: true });
      }
    }, 15000);

    it("revoke wins the race: a second, genuinely separate OS process blocks on the real draft row lock, then its ready INSERT is rejected because the approval was already revoked by the time its own deferred trigger fires", async () => {
      const { draft, review, approved } = await formReviewAndApprove();
      const exportRowId = randomUUID();
      const { base } = readyManifest({
        draftId: draft.id, draftVersion: draft.version, approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash,
        approvedMinor: review.snapshot.financials.finalPriceMinor, estimatedCostMinor: review.snapshot.financials.estimatedCostMinor,
      });
      (base.representation as any).filename = `EST-${draft.id}-${base.exportId}.json`;

      const revoke = await writeParamsFile({
        ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR,
        approvalId: approved.approvalId, revocationId: randomUUID(), requestId: randomUUID(), requestHash: "b".repeat(64),
        reason: "Synthetic real multi-process revocation that must win before the export insert",
      });
      const insert = await writeParamsFile({
        ...connConfig(), draftId: draft.id, tenantId: TENANT, projectId: APPROVAL_PROJECT, clientId: CLIENT, actorId: ACTOR,
        approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash, exportRowId, manifest: base,
      });
      try {
        const revokeWorker = spawnWorker("lock-and-revoke", revoke.file);
        await revokeWorker.ready;
        const insertWorker = spawnWorker("lock-and-insert-ready", insert.file);
        const [revokeEvents, insertEvents] = await Promise.all([revokeWorker.done, insertWorker.done]);

        const revokeCommitted = revokeEvents.find(e => e.event === "committed");
        const insertLockAcquired = insertEvents.find(e => e.event === "lock_acquired");
        const insertRejected = insertEvents.find(e => e.event === "rejected");
        expect(revokeCommitted).toBeTruthy();
        expect(insertLockAcquired).toBeTruthy();
        expect(insertRejected).toBeTruthy();
        expect(insertRejected.constraint_name).toBe("jte_a1_export_approval_revoked");
        const gapMs = new Date(insertLockAcquired.at).getTime() - new Date(revokeCommitted.at).getTime();
        expect(gapMs).toBeGreaterThanOrEqual(-50);

        // The rejected attempt left no row at all — a real transaction rollback, not a
        // partially-applied insert.
        const [row] = await connection`SELECT count(*)::int as n FROM jobtread_exports WHERE id = ${exportRowId}`;
        expect(row.n).toBe(0);
      } finally {
        await rm(revoke.dir, { recursive: true, force: true });
        await rm(insert.dir, { recursive: true, force: true });
      }
    }, 15000);
  });
});
