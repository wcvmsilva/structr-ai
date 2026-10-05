/**
 * A1-EXPORT-EXISTING-DOWNLOAD-WRITER-CONTRACT.md — real PostgreSQL 17 behavior
 * proof for `downloadExportAttempt` (server/internal-estimate-export-db.ts).
 * Same disposable lab/env gate as server/a1-export-preflight-writer.test.ts.
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
import { createExportAttempt, downloadExportAttempt } from "./internal-estimate-export-db";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900300-0000-4000-8000-000000000001";
const ACTOR = "a1900300-0000-4000-8000-000000000002";
const OTHER_READER = "a1900300-0000-4000-8000-000000000003"; // real project_members grant, never owner
const NO_GRANT_ACTOR = "a1900300-0000-4000-8000-000000000004";
const OTHER_TENANT = "a1900300-0000-4000-8000-000000000005";
const OTHER_TENANT_ACTOR = "a1900300-0000-4000-8000-000000000006";
const CLIENT = "a1900300-0000-4000-8000-000000000010";
const GEO_ZONE = "a1900300-0000-4000-8000-000000000020";
const PROJECT = "a1900300-0000-4000-8000-000000000030";
const GEOCODED_AT = new Date("2026-10-05T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Download synthetic zone", county: "Download County", zipCodes: ["00003"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Download synthetic shelf", description: "Download synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Download synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Download synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createApprovedDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const draft = await createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  const approved = await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Download synthetic approval" },
    ACTOR, TENANT,
  );
  return { draft, approved };
}
function createInput(format: "pdf" | "json" | "printable" | "csv_jobtread", draftId: string) {
  return { context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draftId }, format, attemptKind: "preflight" as const };
}
function downloadInput(exportId: string, actorId: string = ACTOR) {
  return { context: { tenantId: TENANT, actorId }, exportId };
}
async function createReadyAttempt(format: "pdf" | "json" | "printable" | "csv_jobtread" = "json", lines?: Array<Record<string, unknown>>) {
  const { draft, approved } = await createApprovedDraft(lines);
  const summary = await createExportAttempt(createInput(format, draft.id));
  return { draft, approved, summary };
}

describe.skipIf(!labConfig)("A1 export download writer — real PostgreSQL 17", () => {
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

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Download synthetic tenant', 'a1-export-download-writer-tenant'), (${OTHER_TENANT}, 'Download synthetic other tenant', 'a1-export-download-writer-other-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Download synthetic actor', 'user'), (${OTHER_READER}, ${TENANT}, 'Download synthetic other reader', 'user'), (${NO_GRANT_ACTOR}, ${TENANT}, 'Download synthetic no-grant actor', 'user'), (${OTHER_TENANT_ACTOR}, ${OTHER_TENANT}, 'Download synthetic other-tenant actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'Download synthetic client')`;
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Download Lane", city: "Download City", state: "SC", zipCode: "00003", county: "Download County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Download Lane, Download City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "Download synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 Download Lane, Download City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone().zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
    // OTHER_READER's ONLY access to PROJECT is this real, active membership row.
    await connection`
      INSERT INTO project_members (project_id, tenant_id, user_id, project_role, permissions, is_active)
      VALUES (${PROJECT}, ${TENANT}, ${OTHER_READER}, 'viewer', '["read"]'::jsonb, true)
    `;
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  describe("first delivery — one per format", () => {
    for (const format of ["pdf", "json", "printable", "csv_jobtread"] as const) {
      it(`${format}: delivers DeliveredExport with real regenerated bytes, transitions the row, audits delivered+firstDelivery`, async () => {
        const { summary } = await createReadyAttempt(format);
        expect(summary.status).toBe("approved_for_download");
        const delivered = await downloadExportAttempt(downloadInput(summary.exportId));

        expect(delivered.exportId).toBe(summary.exportId);
        expect(delivered.format).toBe(format);
        expect(delivered.artifactHash).toBe(summary.artifact!.artifactHash);
        expect(delivered.byteLength).toBe(summary.artifact!.byteLength);
        expect(delivered.content.length).toBeGreaterThan(0);
        if (format === "pdf") expect(delivered.encoding).toBe("base64"); else expect(delivered.encoding).toBe("utf8");

        const [row] = await connection`SELECT status, downloaded_by, downloaded_at, updated_at FROM jobtread_exports WHERE id = ${summary.exportId}`;
        expect(row.status).toBe("downloaded");
        expect(row.downloaded_by).toBe(ACTOR);
        expect(row.downloaded_at).not.toBeNull();
        expect(new Date(row.updated_at).getTime()).toBe(new Date(row.downloaded_at).getTime());

        const [auditRow] = await connection`SELECT * FROM audit_logs WHERE record_id = ${summary.exportId} AND action = 'estimate.export_download' ORDER BY created_at DESC LIMIT 1`;
        expect(auditRow.new_values.delivered).toBe(true);
        expect(auditRow.new_values.firstDelivery).toBe(true);
        expect(JSON.stringify(auditRow.new_values)).not.toContain("Download synthetic reviewed original notes");
      });
    }
  });

  describe("redownload", () => {
    it("same actor: row's downloadedBy/At never change again, a NEW audit entry is created each time", async () => {
      const { summary } = await createReadyAttempt("json");
      await downloadExportAttempt(downloadInput(summary.exportId));
      const [firstRow] = await connection`SELECT downloaded_by, downloaded_at FROM jobtread_exports WHERE id = ${summary.exportId}`;

      const delivered2 = await downloadExportAttempt(downloadInput(summary.exportId));
      expect(delivered2.artifactHash).toBe(summary.artifact!.artifactHash);
      const [secondRow] = await connection`SELECT downloaded_by, downloaded_at FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(secondRow.downloaded_by).toBe(firstRow.downloaded_by);
      expect(new Date(secondRow.downloaded_at).getTime()).toBe(new Date(firstRow.downloaded_at).getTime());

      const auditRows = await connection`SELECT id FROM audit_logs WHERE record_id = ${summary.exportId} AND action = 'estimate.export_download'`;
      expect(auditRows).toHaveLength(2);
    });

    it("a DIFFERENT authorized reader (real project_members grant, never owner) may redownload: first downloadedBy/At stay the ORIGINAL actor, a new audit records the real current actor", async () => {
      const { summary } = await createReadyAttempt("json");
      await downloadExportAttempt(downloadInput(summary.exportId, ACTOR));
      const delivered = await downloadExportAttempt(downloadInput(summary.exportId, OTHER_READER));
      expect(delivered.artifactHash).toBe(summary.artifact!.artifactHash);

      const [row] = await connection`SELECT downloaded_by FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.downloaded_by).toBe(ACTOR); // never overwritten by the second reader

      const [auditRow] = await connection`SELECT user_id FROM audit_logs WHERE record_id = ${summary.exportId} AND action = 'estimate.export_download' ORDER BY created_at DESC LIMIT 1`;
      expect(auditRow.user_id).toBe(OTHER_READER); // audit records the REAL current actor, not the original requester
    });

    it("generatedBy on the delivered artifact's own manifest stays the ORIGINAL requester, never the current downloading actor", async () => {
      const { summary } = await createReadyAttempt("json");
      await downloadExportAttempt(downloadInput(summary.exportId, OTHER_READER));
      const [row] = await connection`SELECT manifest FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.manifest.context.requestedBy).toBe(ACTOR);
    });
  });

  describe("input validation", () => {
    it("rejects a non-UUID exportId", async () => {
      await expect(downloadExportAttempt({ context: { tenantId: TENANT, actorId: ACTOR }, exportId: "not-a-uuid" })).rejects.toThrow();
    });
    it("rejects an unknown extra field on the input", async () => {
      const { summary } = await createReadyAttempt("json");
      await expect(downloadExportAttempt({ context: { tenantId: TENANT, actorId: ACTOR }, exportId: summary.exportId, format: "json" })).rejects.toThrow();
    });
    it("rejects a format/content/manifest/hash field injected into context", async () => {
      const { summary } = await createReadyAttempt("json");
      await expect(downloadExportAttempt({ context: { tenantId: TENANT, actorId: ACTOR, format: "pdf" }, exportId: summary.exportId })).rejects.toThrow();
    });
  });

  describe("never returns extra fields", () => {
    it("the delivered object carries none of url/fileKey/signedUrl/accepted/executable/data", async () => {
      const { summary } = await createReadyAttempt("json");
      const delivered = await downloadExportAttempt(downloadInput(summary.exportId));
      const record = delivered as unknown as Record<string, unknown>;
      for (const field of ["url", "fileKey", "signedUrl", "accepted", "executable", "data", "canDownload"]) {
        expect(record[field]).toBeUndefined();
      }
    });
  });

  describe("access denials — never eligible as a byte source, no audit", () => {
    it("a fake exportId is refused", async () => {
      await expect(downloadExportAttempt(downloadInput(randomUUID()))).rejects.toThrow();
    });
    it("a real exportId from a DIFFERENT tenant is refused (never reveals it exists)", async () => {
      const { summary } = await createReadyAttempt("json");
      await expect(downloadExportAttempt({ context: { tenantId: OTHER_TENANT, actorId: OTHER_TENANT_ACTOR }, exportId: summary.exportId })).rejects.toThrow();
    });
    it("a fake actorId (no such profile) is refused", async () => {
      const { summary } = await createReadyAttempt("json");
      await expect(downloadExportAttempt(downloadInput(summary.exportId, randomUUID()))).rejects.toThrow();
    });
    it("an actor with no grant on the project is refused", async () => {
      const { summary } = await createReadyAttempt("json");
      await expect(downloadExportAttempt(downloadInput(summary.exportId, NO_GRANT_ACTOR))).rejects.toThrow();
    });
    it("a never-ready (blocked) export row is never an eligible byte source", async () => {
      const draft = await createEstimateDraftFromCalculator(buildPayload(), ACTOR, TENANT); // never approved
      const summary = await createExportAttempt(createInput("json", draft.id));
      expect(summary.status).toBe("blocked_authorization");
      await expect(downloadExportAttempt(downloadInput(summary.exportId))).rejects.toThrow();
    });
  });

  describe("authority no longer current — audited refusal, original row/evidence preserved, no bytes", () => {
    it("revoked after ready: refused, zero bytes, original row/manifest untouched, a refusal audit is written", async () => {
      const { draft, approved, summary } = await createReadyAttempt("json");
      await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: approved.contentHash, reason: "Download synthetic revoke before download" },
        ACTOR, TENANT,
      );
      await expect(downloadExportAttempt(downloadInput(summary.exportId))).rejects.toThrow();

      const [row] = await connection`SELECT status, manifest, artifact_hash FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.status).toBe("approved_for_download"); // the ORIGINAL ready attempt is conserved, never flipped to downloaded
      expect(row.artifact_hash).toBe(summary.artifact!.artifactHash); // evidence never updated to "match" the refusal

      const [auditRow] = await connection`SELECT new_values FROM audit_logs WHERE record_id = ${summary.exportId} AND action = 'estimate.export_download_refused' ORDER BY created_at DESC LIMIT 1`;
      expect(auditRow.new_values.delivered).toBe(false);
      expect(auditRow.new_values.reason).toBe("AUTHORITY_NO_LONGER_CURRENT");
    });

    it("superseded after ready: refused, zero bytes, original row preserved", async () => {
      const { draft, summary } = await createReadyAttempt("json");
      const childId = randomUUID(), requestId = randomUUID();
      await connection.begin(async sql => {
        await sql`
          INSERT INTO estimate_drafts
          SELECT * FROM jsonb_populate_record(null::estimate_drafts,
            (to_jsonb((SELECT t FROM estimate_drafts t WHERE t.id = ${draft.id}))
              || jsonb_build_object(
                   'id', ${childId}::text, 'version', ${draft.version + 1}::int,
                   'source', 'version', 'supersedes_id', ${draft.id}::text,
                   'a1_version_request_id', ${requestId}::text, 'a1_version_request_hash', ${"c".repeat(64)}::text,
                   'created_by', ${ACTOR}::text, 'superseded_by', null,
                   'status', 'draft', 'approved_by', null, 'approved_at', null,
                   'rejected_by', null, 'rejected_at', null, 'rejection_reason', null, 'locked_at', null,
                   'created_at', now(), 'updated_at', now()
                 )
            )
          )`;
        await sql`UPDATE estimate_drafts SET superseded_by = ${childId}, updated_at = now() WHERE id = ${draft.id}`;
      });
      await expect(downloadExportAttempt(downloadInput(summary.exportId))).rejects.toThrow();
      const [row] = await connection`SELECT status FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.status).toBe("approved_for_download");
    });
  });

  describe("bytes only after commit", () => {
    it("a commit-time audit failure never releases content and never changes the row", async () => {
      const { summary } = await createReadyAttempt("json");
      await connection.unsafe(`
        CREATE FUNCTION michael_download_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.table_name = 'jobtread_exports' AND NEW.action = 'estimate.export_download' AND NEW.record_id = '${summary.exportId}' THEN
            RAISE EXCEPTION 'synthetic download audit fault' USING ERRCODE = 'ZZ002';
          END IF; RETURN NEW; END $$;
      `);
      await connection.unsafe(`CREATE TRIGGER michael_download_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION michael_download_audit_fault()`);
      try {
        await expect(downloadExportAttempt(downloadInput(summary.exportId))).rejects.toThrow();
      } finally {
        await connection.unsafe(`DROP TRIGGER IF EXISTS michael_download_audit_fault ON audit_logs`);
        await connection.unsafe(`DROP FUNCTION IF EXISTS michael_download_audit_fault()`);
      }
      const [row] = await connection`SELECT status, downloaded_by, downloaded_at FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(row.status).toBe("approved_for_download"); // the UPDATE rolled back together with the failed audit insert
      expect(row.downloaded_by).toBeNull();
      expect(row.downloaded_at).toBeNull();
    });
  });
});
