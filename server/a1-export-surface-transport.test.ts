/**
 * A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md / MICHAEL-A1-EXPORT-SURFACE-V1-QA-
 * AND-CORRECTION.md item 3 — real PostgreSQL 17 + the ACTUAL tRPC fetch
 * adapter (`fetchRequestHandler`, real `Request`/`Response`, real superjson
 * transform). Deliberately separate from a1-export-surface-integration.test.ts:
 * that file proves router-caller-level behavior (`estimateRouter.createCaller`),
 * which never exercises the HTTP serialization boundary at all — a leak that
 * only shows up once a thrown error actually crosses that boundary (QA #3's
 * reproduced defect: `resolveExportAttemptContext` ran OUTSIDE the mapper's
 * try, so a context-resolution fault's raw driver message reached
 * `error.json.message` on the real wire; `JSON.parse(JSON.stringify(...))` on
 * an in-memory `.message` string, as the V1 file did, never exercises the
 * formatter/adapter that actually produced that shape).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { estimateRouter } from "./estimate-router";
import type { TrpcContext } from "./_core/context";
import { createEstimateDraftFromCalculator } from "./estimate-db";
import { getInternalApprovalReview, recordInternalEstimateApproval } from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import { parseExportDeliveryBlockedMessage } from "@shared/export-delivery-blocked-message";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900900-0000-4000-8000-000000000001";
const ACTOR = "a1900900-0000-4000-8000-000000000002";
const CLIENT = "a1900900-0000-4000-8000-000000000010";
const GEO_ZONE = "a1900900-0000-4000-8000-000000000020";
const PROJECT = "a1900900-0000-4000-8000-000000000030";
const GEOCODED_AT = new Date("2026-10-06T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Transport synthetic zone", county: "Transport County", zipCodes: ["00009"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Transport synthetic shelf", description: "Transport synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Transport synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Transport synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  return createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
}
function ctxFor(userId: string, tenantId: string | null = TENANT): TrpcContext {
  return { req: {} as any, res: {} as any, authProvider: "legacy", tenantId, user: { id: userId, tenantId, role: "user", isActive: true } as any };
}

describe.skipIf(!labConfig)("A1 export surface — actual HTTP adapter (real PostgreSQL 17)", () => {
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

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Transport synthetic tenant', 'a1-export-transport-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Transport synthetic actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'Transport synthetic client')`;
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Transport Lane", city: "Transport City", state: "SC", zipCode: "00009", county: "Transport County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Transport Lane, Transport City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "Transport synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 Transport Lane, Transport City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone().zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  async function requestExport(id: string) {
    return fetchRequestHandler({
      endpoint: "/trpc", router: estimateRouter, createContext: () => ctxFor(ACTOR),
      req: new Request("http://localhost/trpc/exportPdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { id } }) }),
    });
  }

  it("business block crosses actual tRPC HTTP serialization with a committed attempt", async () => {
    const draft = await createDraft();
    const response = await requestExport(draft.id);
    expect(response.status).toBe(412);
    const body = await response.json();
    const error = body.error?.json ?? body.error;
    const decoded = parseExportDeliveryBlockedMessage(error.message);
    expect(decoded?.code).toBe("INTERNAL_APPROVAL_REQUIRED");
    const rows = await connection`SELECT id FROM jobtread_exports WHERE id = ${decoded!.exportId}`;
    expect(rows).toHaveLength(1);
  });

  it("a context-resolution failure is sanitized on the actual HTTP wire", async () => {
    const draft = await createDraft();
    deps.getDb.mockRejectedValueOnce(new Error("SQL_DETAIL_SHOULD_NEVER_REACH_EXPORT_CLIENT"));
    const response = await requestExport(draft.id);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SQL_DETAIL_SHOULD_NEVER_REACH_EXPORT_CLIENT");
  });
});
