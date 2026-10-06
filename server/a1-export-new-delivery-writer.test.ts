/**
 * A1-EXPORT-NEW-DELIVERY-WRITER-CONTRACT.md — real PostgreSQL 17 behavior
 * proof for `createAndDeliverExportAttempt` (server/internal-estimate-export-db.ts).
 * Same disposable lab/env gate as the preflight/download writers.
 *
 * No mocking of authorization/transaction/audit/renderers: the writer under
 * test runs for real against a real database. Only `./db`'s `getDb()` is
 * redirected to the verified disposable lab connection.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { createEstimateDraftFromCalculator } from "./estimate-db";
import { getInternalApprovalReview, recordInternalEstimateApproval, revokeInternalEstimateApproval } from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import { createExportAttempt, createAndDeliverExportAttempt, ExportDeliveryBlockedError } from "./internal-estimate-export-db";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900600-0000-4000-8000-000000000001";
const ACTOR = "a1900600-0000-4000-8000-000000000002";
const NO_GRANT_ACTOR = "a1900600-0000-4000-8000-000000000004";
const OTHER_TENANT = "a1900600-0000-4000-8000-000000000005";
const OTHER_TENANT_ACTOR = "a1900600-0000-4000-8000-000000000006";
const CLIENT = "a1900600-0000-4000-8000-000000000010";
const GEO_ZONE = "a1900600-0000-4000-8000-000000000020";
const PROJECT = "a1900600-0000-4000-8000-000000000030";
const GEOCODED_AT = new Date("2026-10-06T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "New-delivery synthetic zone", county: "New-delivery County", zipCodes: ["00006"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "New-delivery synthetic shelf", description: "New-delivery synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "New-delivery synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "New-delivery synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createApprovedDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const draft = await createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  const approved = await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "New-delivery synthetic approval" },
    ACTOR, TENANT,
  );
  return { draft, approved };
}
function deliveryInput(format: "pdf" | "json" | "printable" | "csv_jobtread", draftId: string, actorId: string = ACTOR) {
  return { context: { tenantId: TENANT, actorId, projectId: PROJECT, estimateDraftId: draftId }, format, attemptKind: "delivery" as const };
}
function preflightInput(format: "pdf" | "json" | "printable" | "csv_jobtread", draftId: string) {
  return { context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draftId }, format, attemptKind: "preflight" as const };
}

describe.skipIf(!labConfig)("A1 new-delivery writer — real PostgreSQL 17", () => {
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

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'New-delivery synthetic tenant', 'a1-export-new-delivery-writer-tenant'), (${OTHER_TENANT}, 'New-delivery synthetic other tenant', 'a1-export-new-delivery-writer-other-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'New-delivery synthetic actor', 'user'), (${NO_GRANT_ACTOR}, ${TENANT}, 'New-delivery synthetic no-grant actor', 'user'), (${OTHER_TENANT_ACTOR}, ${OTHER_TENANT}, 'New-delivery synthetic other-tenant actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'New-delivery synthetic client')`;
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 New-Delivery Lane", city: "New-Delivery City", state: "SC", zipCode: "00006", county: "New-delivery County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 New-Delivery Lane, New-Delivery City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "New-delivery synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 New-Delivery Lane, New-Delivery City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone().zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  describe("first delivery — one per format, single combined operation", () => {
    for (const format of ["pdf", "json", "printable", "csv_jobtread"] as const) {
      it(`${format}: creates+delivers in one operation — row inserted directly as downloaded, DeliveredExport returned, one audit`, async () => {
        const { draft } = await createApprovedDraft();
        const delivered = await createAndDeliverExportAttempt(deliveryInput(format, draft.id));

        expect(delivered.format).toBe(format);
        expect(delivered.content.length).toBeGreaterThan(0);
        if (format === "pdf") expect(delivered.encoding).toBe("base64"); else expect(delivered.encoding).toBe("utf8");

        const [row] = await connection`SELECT * FROM jobtread_exports WHERE id = ${delivered.exportId}`;
        expect(row.status).toBe("downloaded");
        expect(row.attempt_kind).toBe("delivery");
        expect(row.requested_by).toBe(ACTOR);
        expect(row.downloaded_by).toBe(ACTOR); // requestedBy = downloadedBy = the real actor
        // checkedAt = createdAt = updatedAt = downloadedAt, all the SAME final effective instant.
        const checkedAtMs = new Date(row.checked_at).getTime();
        expect(new Date(row.created_at).getTime()).toBe(checkedAtMs);
        expect(new Date(row.updated_at).getTime()).toBe(checkedAtMs);
        expect(new Date(row.downloaded_at).getTime()).toBe(checkedAtMs);
        // generatedAt not later than checkedAt.
        expect(new Date(row.generated_at).getTime()).toBeLessThanOrEqual(checkedAtMs);
        expect(row.manifest.representation.generatedBy).toBe(ACTOR);

        const auditRows = await connection`SELECT * FROM audit_logs WHERE record_id = ${delivered.exportId} AND action = 'estimate.export_delivery'`;
        expect(auditRows).toHaveLength(1); // exactly one creation audit, never a fictional preflight audit too
        expect(auditRows[0].new_values.delivered).toBe(true);
        expect(JSON.stringify(auditRows[0].new_values)).not.toContain("New-delivery synthetic reviewed original notes");
        const preflightAudits = await connection`SELECT id FROM audit_logs WHERE record_id = ${delivered.exportId} AND action = 'estimate.export_preflight'`;
        expect(preflightAudits).toHaveLength(0); // never a fake preflight audit alongside the real one
      });
    }
  });

  describe("two new requests are two attempts, never silent deduplication", () => {
    it("two separate calls for the SAME draft/format produce two distinct exportIds/rows, each with its own audit", async () => {
      const { draft } = await createApprovedDraft();
      const first = await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      const second = await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      expect(first.exportId).not.toBe(second.exportId);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id} ORDER BY created_at`;
      expect(rows.map(r => r.id).sort()).toEqual([first.exportId, second.exportId].sort());
      const audits = await connection`SELECT record_id FROM audit_logs WHERE record_id = ANY(${[first.exportId, second.exportId]}) AND action = 'estimate.export_delivery'`;
      expect(audits).toHaveLength(2);
    });
  });

  describe("existing preflight interface is untouched", () => {
    it("createExportAttemptInputSchema (preflight) still rejects attemptKind:'delivery' and never returns content", async () => {
      const { draft } = await createApprovedDraft();
      await expect(createExportAttempt({ context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draft.id }, format: "json", attemptKind: "delivery" })).rejects.toThrow();
    });
    it("a normal preflight call still works unchanged (regression — this writer shares finalizeExportPreparation with it)", async () => {
      const { draft } = await createApprovedDraft();
      const summary = await createExportAttempt(preflightInput("json", draft.id));
      expect(summary.status).toBe("approved_for_download");
      expect((summary as any).content).toBeUndefined();
      const [row] = await connection`SELECT status, downloaded_by, downloaded_at FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.status).toBe("approved_for_download"); // never auto-downloaded
      expect(row.downloaded_by).toBeNull();
      expect(row.downloaded_at).toBeNull();
    });
  });

  describe("input validation", () => {
    it("rejects an unknown extra field on the input", async () => {
      const { draft } = await createApprovedDraft();
      await expect(createAndDeliverExportAttempt({ ...deliveryInput("json", draft.id), extra: true })).rejects.toThrow();
    });
    it("rejects attemptKind:'preflight' on this entry point (the other schema owns that literal)", async () => {
      const { draft } = await createApprovedDraft();
      await expect(createAndDeliverExportAttempt({ ...deliveryInput("json", draft.id), attemptKind: "preflight" })).rejects.toThrow();
    });
    it("rejects caller-supplied authority/metadata (e.g. an injected artifactHash)", async () => {
      const { draft } = await createApprovedDraft();
      await expect(createAndDeliverExportAttempt({ ...deliveryInput("json", draft.id), artifactHash: "a".repeat(64) })).rejects.toThrow();
    });
    it("rejects a non-UUID estimateDraftId", async () => {
      await expect(createAndDeliverExportAttempt(deliveryInput("json", "not-a-uuid"))).rejects.toThrow();
    });
  });

  describe("never returns extra fields", () => {
    it("the delivered object carries none of url/fileKey/signedUrl/accepted/executable/data", async () => {
      const { draft } = await createApprovedDraft();
      const delivered = await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      const record = delivered as unknown as Record<string, unknown>;
      for (const field of ["url", "fileKey", "signedUrl", "accepted", "executable", "data", "canDownload"]) {
        expect(record[field]).toBeUndefined();
      }
    });
  });

  describe("access denials — never eligible, no commercial attempt persisted", () => {
    it("a real draft from a DIFFERENT tenant is refused (never reveals it exists), no row persisted", async () => {
      const { draft } = await createApprovedDraft();
      await expect(createAndDeliverExportAttempt({ context: { tenantId: OTHER_TENANT, actorId: OTHER_TENANT_ACTOR, projectId: PROJECT, estimateDraftId: draft.id }, format: "json", attemptKind: "delivery" })).rejects.toThrow();
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });
    it("a fake actorId (no such profile) is refused, no row persisted", async () => {
      const { draft } = await createApprovedDraft();
      await expect(createAndDeliverExportAttempt(deliveryInput("json", draft.id, randomUUID()))).rejects.toThrow();
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });
    it("an actor with no grant on the project is refused, no row persisted", async () => {
      const { draft } = await createApprovedDraft();
      await expect(createAndDeliverExportAttempt(deliveryInput("json", draft.id, NO_GRANT_ACTOR))).rejects.toThrow();
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  describe("blocked — never-decided draft persists a terminal blocked delivery row", () => {
    it("a never-approved draft: ExportDeliveryBlockedError carries {exportId,code}, and the row/audit WERE ACTUALLY COMMITTED despite the thrown error", async () => {
      const draft = await createEstimateDraftFromCalculator(buildPayload(), ACTOR, TENANT); // never approved
      let observed: any;
      try {
        await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      } catch (e) {
        observed = e;
      }
      expect(observed).toBeInstanceOf(ExportDeliveryBlockedError);
      expect(observed.code).toBe("INTERNAL_APPROVAL_REQUIRED");
      expect(typeof observed.exportId).toBe("string");

      const [row] = await connection`SELECT status, attempt_kind, downloaded_by, downloaded_at, artifact_hash FROM jobtread_exports WHERE id = ${observed.exportId}`;
      expect(row.status).toBe("blocked_authorization");
      expect(row.attempt_kind).toBe("delivery");
      expect(row.downloaded_by).toBeNull(); // never a download projection on a blocked attempt
      expect(row.downloaded_at).toBeNull();
      expect(row.artifact_hash).toBeNull(); // never bytes/hash on a blocked attempt

      const audits = await connection`SELECT new_values FROM audit_logs WHERE record_id = ${observed.exportId} AND action = 'estimate.export_delivery'`;
      expect(audits).toHaveLength(1);
      expect(audits[0].new_values.delivered).toBe(false);
    });

    it("revoked before the attempt: ExportDeliveryBlockedError with the revoked code, authority preserved", async () => {
      const { draft, approved } = await createApprovedDraft();
      await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: approved.contentHash, reason: "New-delivery synthetic revoke before attempt" },
        ACTOR, TENANT,
      );
      let observed: any;
      try {
        await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      } catch (e) {
        observed = e;
      }
      expect(observed).toBeInstanceOf(ExportDeliveryBlockedError);
      expect(observed.code).toBe("INTERNAL_APPROVAL_REVOKED");
      const [row] = await connection`SELECT status, internal_approval_id FROM jobtread_exports WHERE id = ${observed.exportId}`;
      expect(row.status).toBe("blocked_authorization");
      expect(row.internal_approval_id).toBe(approved.approvalId); // the preserved, known-but-revoked decision
    });
  });

  describe("bytes only after commit", () => {
    it("a commit-time audit failure never releases content and never leaves any row/projection", async () => {
      const { draft } = await createApprovedDraft();
      await connection.unsafe(`
        CREATE FUNCTION michael_new_delivery_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.table_name = 'jobtread_exports' AND NEW.action = 'estimate.export_delivery' AND NEW.new_values->>'estimateDraftId' = '${draft.id}' THEN
            RAISE EXCEPTION 'synthetic new-delivery audit fault' USING ERRCODE = 'ZZ004';
          END IF; RETURN NEW; END $$;
      `);
      await connection.unsafe(`CREATE TRIGGER michael_new_delivery_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION michael_new_delivery_audit_fault()`);
      let observed: any;
      try {
        await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      } catch (e) {
        observed = e;
      } finally {
        await connection.unsafe(`DROP TRIGGER IF EXISTS michael_new_delivery_audit_fault ON audit_logs`);
        await connection.unsafe(`DROP FUNCTION IF EXISTS michael_new_delivery_audit_fault()`);
      }
      expect(observed).toBeDefined();
      expect(observed.constructor.name).toBe("InternalApprovalAuditFailure");
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0); // the INSERT rolled back together with the failed audit insert — zero rows, zero bytes
    });

    it("an audit insert that returns no row is wrapped as a technical failure, never releases content, never leaves any row", async () => {
      const { draft } = await createApprovedDraft();
      await connection.unsafe(`CREATE FUNCTION michael_new_delivery_audit_empty() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.table_name = 'jobtread_exports' AND NEW.action = 'estimate.export_delivery' AND NEW.new_values->>'estimateDraftId' = '${draft.id}' THEN
          RETURN NULL;
        END IF; RETURN NEW; END $$;`);
      await connection.unsafe('CREATE TRIGGER michael_new_delivery_audit_empty BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION michael_new_delivery_audit_empty()');
      let observed: any;
      try {
        await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      } catch (e) {
        observed = e;
      } finally {
        await connection.unsafe('DROP TRIGGER michael_new_delivery_audit_empty ON audit_logs');
        await connection.unsafe('DROP FUNCTION michael_new_delivery_audit_empty()');
      }
      expect(observed).toBeDefined();
      expect(observed.constructor.name).toBe("InternalApprovalAuditFailure");
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });

    it("a genuine COMMIT-time audit failure (DEFERRABLE INITIALLY DEFERRED constraint trigger) also leaves zero rows", async () => {
      const { draft } = await createApprovedDraft();
      await connection.unsafe(`CREATE FUNCTION michael_new_delivery_deferred_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action = 'estimate.export_delivery' AND NEW.new_values->>'estimateDraftId' = '${draft.id}' THEN
          RAISE EXCEPTION 'synthetic new-delivery COMMIT failure' USING ERRCODE = 'ZZ005';
        END IF; RETURN NEW; END $$;`);
      await connection.unsafe('CREATE CONSTRAINT TRIGGER michael_new_delivery_deferred_fault AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION michael_new_delivery_deferred_fault()');
      let observed: any;
      try {
        await createAndDeliverExportAttempt(deliveryInput("json", draft.id));
      } catch (e) {
        observed = e;
      } finally {
        await connection.unsafe('DROP TRIGGER michael_new_delivery_deferred_fault ON audit_logs');
        await connection.unsafe('DROP FUNCTION michael_new_delivery_deferred_fault()');
      }
      expect(observed).toBeDefined();
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0); // the audit INSERT itself rolled back together with the row insert at COMMIT
    });
  });
});
