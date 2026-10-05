/**
 * A1-EXPORT-EXISTING-DOWNLOAD-WRITER-CONTRACT.md — real multi-connection
 * concurrency proof for `downloadExportAttempt`. Same disposable lab/env gate
 * and phase-boundary instrumentation technique already accepted for the
 * preflight writer's own physical test file: `withInternalApprovalTransaction`
 * (imported, by the writer, as `withExportAttemptTransaction`) is wrapped in
 * THIS test file only so a test-supplied hook can run deterministically after
 * phase 1's transaction has genuinely committed and before phase 2's begins —
 * no bypass hook on the writer itself. The wrapper also counts how many times
 * each phase's underlying transaction callback actually executes.
 *
 * Bytes-only-after-commit is proven structurally by the behavior file's own
 * audit-failure test (server/a1-export-download-writer.test.ts): regeneration
 * happens between phase 1 and phase 2 by construction
 * (server/internal-estimate-export-db.ts, `downloadExportAttempt` — the
 * `renderForFormat` call sits textually between the two
 * `withExportAttemptTransaction` calls, never inside either callback), and
 * that test shows a failed commit releases zero bytes despite regeneration
 * having already happened. The revoked-between-phases test below adds the
 * SAME proof from a different angle: bytes are regenerated (phase 1 was
 * eligible) yet the caller receives NO DeliveredExport once phase 2's fresh
 * read disagrees.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));

const hooks = vi.hoisted(() => ({
  callIndex: 0,
  attempts: {} as Record<number, number>,
  afterCall: null as ((callIndex: number) => Promise<void> | void) | null,
}));
vi.mock("./internal-estimate-approval-db", async importOriginal => {
  const actual = await importOriginal<typeof import("./internal-estimate-approval-db")>();
  return {
    ...actual,
    withInternalApprovalTransaction: async <T,>(work: (tx: Parameters<typeof actual.withInternalApprovalTransaction>[0]) => Promise<T>) => {
      const idx = ++hooks.callIndex;
      hooks.attempts[idx] = 0;
      const wrappedWork = (tx: Parameters<typeof work>[0]) => { hooks.attempts[idx]++; return work(tx); };
      const result = await actual.withInternalApprovalTransaction(wrappedWork);
      const fn = hooks.afterCall;
      if (fn) { hooks.afterCall = null; await fn(idx); }
      return result;
    },
  };
});

import { createEstimateDraftFromCalculator } from "./estimate-db";
import { getInternalApprovalReview, recordInternalEstimateApproval, revokeInternalEstimateApproval } from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import { createExportAttempt, downloadExportAttempt } from "./internal-estimate-export-db";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900400-0000-4000-8000-000000000001";
const ACTOR = "a1900400-0000-4000-8000-000000000002";
const OTHER_READER = "a1900400-0000-4000-8000-000000000003";
const CLIENT = "a1900400-0000-4000-8000-000000000004";
const GEO_ZONE = "a1900400-0000-4000-8000-000000000005";
const PROJECT = "a1900400-0000-4000-8000-000000000006";
const GEOCODED_AT = new Date("2026-10-05T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Download concurrency synthetic zone", county: "Download Concurrency County", zipCodes: ["00004"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Download concurrency synthetic shelf", description: "Download concurrency synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Download concurrency synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Download concurrency synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createApprovedDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const draft = await createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  const approved = await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Download concurrency synthetic approval" },
    ACTOR, TENANT,
  );
  return { draft, approved };
}
function createInput(draftId: string) {
  return { context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draftId }, format: "json" as const, attemptKind: "preflight" as const };
}
function downloadInput(exportId: string, actorId: string = ACTOR) {
  return { context: { tenantId: TENANT, actorId }, exportId };
}

describe.skipIf(!labConfig)("A1 export download writer — real multi-connection concurrency", () => {
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

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Download concurrency synthetic tenant', 'a1-export-download-writer-concurrency-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Download concurrency synthetic actor', 'user'), (${OTHER_READER}, ${TENANT}, 'Download concurrency synthetic other reader', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'Download concurrency synthetic client')`;
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Download Concurrency Lane", city: "Download Concurrency City", state: "SC", zipCode: "00004", county: "Download Concurrency County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Download Concurrency Lane, Download Concurrency City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "Download concurrency synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 Download Concurrency Lane, Download Concurrency City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone().zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
    await connection`
      INSERT INTO project_members (project_id, tenant_id, user_id, project_role, permissions, is_active)
      VALUES (${PROJECT}, ${TENANT}, ${OTHER_READER}, 'viewer', '["read"]'::jsonb, true)
    `;
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });
  beforeEach(() => { hooks.callIndex = 0; hooks.attempts = {}; hooks.afterCall = null; });
  afterEach(() => { hooks.afterCall = null; });

  it("two genuinely concurrent first downloads of the SAME row: only the first actor/time win, exactly one audit per call", async () => {
    const { draft } = await createApprovedDraft();
    const summary = await createExportAttempt(createInput(draft.id));

    const [first, second] = await Promise.all([
      downloadExportAttempt(downloadInput(summary.exportId, ACTOR)),
      downloadExportAttempt(downloadInput(summary.exportId, OTHER_READER)),
    ]);
    expect(first.artifactHash).toBe(summary.artifact!.artifactHash);
    expect(second.artifactHash).toBe(summary.artifact!.artifactHash);

    const [row] = await connection`SELECT status, downloaded_by, downloaded_at FROM jobtread_exports WHERE id = ${summary.exportId}`;
    expect(row.status).toBe("downloaded");
    expect([ACTOR, OTHER_READER]).toContain(row.downloaded_by); // exactly one of the two genuinely won the race
    const auditRows = await connection`SELECT user_id, new_values FROM audit_logs WHERE record_id = ${summary.exportId} AND action = 'estimate.export_download' ORDER BY created_at`;
    expect(auditRows).toHaveLength(2); // one audit per call — both were legitimately authorized, even though only one performed the row transition
    expect(auditRows.filter(r => r.new_values.firstDelivery === true)).toHaveLength(1); // exactly one of the two actually transitioned the row
  }, 30000);

  it("a real project_members grant lost strictly between phase 1 and phase 2 is reread fresh: refused, row/evidence untouched", async () => {
    const { draft } = await createApprovedDraft();
    const summary = await createExportAttempt(createInput(draft.id));
    // createExportAttempt's OWN phase1/phase2 already ran through this SAME
    // mocked withInternalApprovalTransaction (it's a cross-module import, not
    // an internal same-module call) — reset the counter so downloadExportAttempt's
    // phase 1 becomes idx 1 fresh, not idx 3.
    hooks.callIndex = 0; hooks.attempts = {};
    hooks.afterCall = async idx => {
      if (idx !== 1) return;
      await connection`UPDATE project_members SET is_active = false WHERE project_id = ${PROJECT} AND user_id = ${OTHER_READER}`;
    };
    try {
      await expect(downloadExportAttempt(downloadInput(summary.exportId, OTHER_READER))).rejects.toThrow();
    } finally {
      await connection`UPDATE project_members SET is_active = true WHERE project_id = ${PROJECT} AND user_id = ${OTHER_READER}`;
    }
    const [row] = await connection`SELECT status FROM jobtread_exports WHERE id = ${summary.exportId}`;
    expect(row.status).toBe("approved_for_download");
  }, 15000);

  it("a revocation that commits strictly between phase 1 (eligible, bytes regenerated) and phase 2 is reread fresh: refused, zero bytes, an audited refusal, original row preserved", async () => {
    const { draft, approved } = await createApprovedDraft();
    const summary = await createExportAttempt(createInput(draft.id));
    // Same reset as the grant-loss test above — createExportAttempt's own two
    // calls already consumed idx 1/2 on this shared, mocked counter.
    hooks.callIndex = 0; hooks.attempts = {};
    hooks.afterCall = async idx => {
      if (idx !== 1) return; // phase 1 already committed as ELIGIBLE — regeneration runs next, outside any tx
      await revokeInternalEstimateApproval(
        { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: approved.contentHash, reason: "Download concurrency synthetic revoke between phases" },
        ACTOR, TENANT,
      );
    };
    await expect(downloadExportAttempt(downloadInput(summary.exportId))).rejects.toThrow();

    expect(hooks.attempts[1]).toBe(1);
    expect(hooks.attempts[2]).toBe(1); // phase 2 never contended on a lock here — no retry needed, it simply disagreed with phase 1
    const [row] = await connection`SELECT status, artifact_hash FROM jobtread_exports WHERE id = ${summary.exportId}`;
    expect(row.status).toBe("approved_for_download"); // conserved — the regenerated bytes (proven to exist, since phase 1 was eligible) were NEVER returned
    expect(row.artifact_hash).toBe(summary.artifact!.artifactHash);
    const [auditRow] = await connection`SELECT new_values FROM audit_logs WHERE record_id = ${summary.exportId} AND action = 'estimate.export_download_refused' ORDER BY created_at DESC LIMIT 1`;
    expect(auditRow.new_values.reason).toBe("AUTHORITY_NO_LONGER_CURRENT");
    expect(auditRow.new_values.delivered).toBe(false);
  }, 15000);
});
