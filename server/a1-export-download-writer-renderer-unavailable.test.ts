/**
 * A1-EXPORT-EXISTING-DOWNLOAD-WRITER-CONTRACT.md — RENDERER_UNAVAILABLE
 * coverage for `downloadExportAttempt` (QA V2 item 3(f)).
 *
 * HONESTLY LABELED STUB, NOT PHYSICAL PROOF. The real renderer's own
 * EXPORT_RENDERER_UNAVAILABLE path only fires when the CALLER's own
 * rendererVersion input disagrees with the renderer's fixed expected
 * constant — but item 1's new retainedManifestEvidenceValid check now
 * requires the row's stored rendererVersion to match the manifest's
 * representation.rendererVersion, which is itself a Zod literal pinned to
 * the CURRENT constant, structurally closing off any "old/incompatible
 * rendererVersion fixture" as a real, reachable physical route. Per the QA
 * document's own explicit permission ("injeção controlada explicitamente
 * qualificada; não alegar prova física positiva se usou stub"), this file
 * mocks ONLY `renderExportJson`, for ONE specific exportId, to force the
 * REAL, UNCHANGED `ExportRendererError("EXPORT_RENDERER_UNAVAILABLE")` class
 * through the writer's existing, unchanged `mapRendererError`/RENDERER_
 * UNAVAILABLE refusal path — every other code path in this file (and in the
 * separate behavior/physical files) is genuinely unmocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn(), stubExportId: null as string | null }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
vi.mock("../shared/internal-estimate-export-renderer", async importOriginal => {
  const actual = await importOriginal<typeof import("../shared/internal-estimate-export-renderer")>();
  return {
    ...actual,
    renderExportJson: async (input: Parameters<typeof actual.renderExportJson>[0]) => {
      if (input.exportId === deps.stubExportId) throw new actual.ExportRendererError("EXPORT_RENDERER_UNAVAILABLE");
      return actual.renderExportJson(input);
    },
  };
});

import { createEstimateDraftFromCalculator } from "./estimate-db";
import { getInternalApprovalReview, recordInternalEstimateApproval } from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import { createExportAttempt, downloadExportAttempt } from "./internal-estimate-export-db";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900500-0000-4000-8000-000000000001";
const ACTOR = "a1900500-0000-4000-8000-000000000002";
const CLIENT = "a1900500-0000-4000-8000-000000000003";
const GEO_ZONE = "a1900500-0000-4000-8000-000000000004";
const PROJECT = "a1900500-0000-4000-8000-000000000005";
const GEOCODED_AT = new Date("2026-10-05T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Renderer-unavailable synthetic zone", county: "Renderer-unavailable County", zipCodes: ["00005"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Renderer-unavailable synthetic shelf", description: "Renderer-unavailable synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Renderer-unavailable synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Renderer-unavailable synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createApprovedDraft() {
  const draft = await createEstimateDraftFromCalculator(buildPayload(), ACTOR, TENANT);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  const approved = await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Renderer-unavailable synthetic approval" },
    ACTOR, TENANT,
  );
  return { draft, approved };
}
function createInput(draftId: string) {
  return { context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draftId }, format: "json" as const, attemptKind: "preflight" as const };
}
function downloadInput(exportId: string) {
  return { context: { tenantId: TENANT, actorId: ACTOR }, exportId };
}

describe.skipIf(!labConfig)("A1 export download writer — RENDERER_UNAVAILABLE (stub, QA V2 item 3(f))", () => {
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

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Renderer-unavailable synthetic tenant', 'a1-export-download-writer-renderer-unavailable-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Renderer-unavailable synthetic actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'Renderer-unavailable synthetic client')`;
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Renderer-Unavailable Lane", city: "Renderer-Unavailable City", state: "SC", zipCode: "00005", county: "Renderer-unavailable County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Renderer-Unavailable Lane, Renderer-Unavailable City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "Renderer-unavailable synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 Renderer-Unavailable Lane, Renderer-Unavailable City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone().zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  it("STUB (not physical proof): a renderer that throws EXPORT_RENDERER_UNAVAILABLE for this one exportId is refused via the real, unchanged RENDERER_UNAVAILABLE path — zero bytes, an audited refusal, original row preserved", async () => {
    const { draft } = await createApprovedDraft();
    const summary = await createExportAttempt(createInput(draft.id));
    deps.stubExportId = summary.exportId;
    try {
      await expect(downloadExportAttempt(downloadInput(summary.exportId))).rejects.toThrow();
    } finally {
      deps.stubExportId = null;
    }
    const [row] = await connection`SELECT status, downloaded_by FROM jobtread_exports WHERE id = ${summary.exportId}`;
    expect(row.status).toBe("approved_for_download");
    expect(row.downloaded_by).toBeNull();
    const [auditRow] = await connection`SELECT new_values FROM audit_logs WHERE record_id = ${summary.exportId} AND action = 'estimate.export_download_refused' ORDER BY created_at DESC LIMIT 1`;
    expect(auditRow.new_values.reason).toBe("RENDERER_UNAVAILABLE");
    expect(auditRow.new_values.delivered).toBe(false);
  });
});
