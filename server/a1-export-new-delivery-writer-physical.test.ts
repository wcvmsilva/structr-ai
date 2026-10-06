/**
 * A1-EXPORT-NEW-DELIVERY-WRITER-CONTRACT.md — real multi-connection
 * concurrency proof for `createAndDeliverExportAttempt`. Same disposable
 * lab/env gate and phase-boundary/lock-wait instrumentation technique
 * already accepted for the preflight and download writers' own physical
 * test files: `withInternalApprovalTransaction` (imported, by the writer,
 * as `withExportAttemptTransaction`) is wrapped in THIS test file only so a
 * test-supplied hook can run deterministically after phase 1's transaction
 * has genuinely committed and before phase 2's begins — no bypass hook on
 * the writer itself. The wrapper also counts how many times each phase's
 * underlying transaction callback actually executes.
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
import { createAndDeliverExportAttempt, ExportDeliveryBlockedError } from "./internal-estimate-export-db";
import { hashInternalApprovalCommand } from "../shared/internal-estimate-approval-engine";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let holderConnection: ReturnType<typeof postgres>;
let monitorConnection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

/** Same holder/monitor technique already accepted for the download writer's
 * own physical file: holds the `projects` row — the FIRST lock this writer
 * acquires (`lockExportAttemptBasicContext`) — so a grant change (project_
 * members, a different table) or a decision change (injected via raw SQL,
 * never the real revoke helper, which would itself need this SAME lock) can
 * each be proven to commit WHILE phase 2 is genuinely blocked waiting on it. */
type TxSql = Parameters<Parameters<typeof holderConnection.begin>[0]>[0];
function holdProjectLock(projectId: string, mutate: (sql: TxSql) => Promise<void>) {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let acquired!: () => void;
  const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; });
  const done = holderConnection.begin(async sql => {
    await sql`SELECT * FROM projects WHERE id = ${projectId} FOR UPDATE`;
    acquired();
    await released;
    await mutate(sql);
  });
  return { acquired: acquiredPromise, release, done };
}
async function waitForObservableProjectLockWait(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await monitorConnection`
      SELECT pid FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query ILIKE '%projects%' AND query ILIKE '%for update%'
    `;
    if (rows.length > 0) return;
    await sleep(20);
  }
  throw new Error(`Never observed a backend genuinely waiting on the held projects lock within ${timeoutMs}ms`);
}

const TENANT = "a1900700-0000-4000-8000-000000000001";
const ACTOR = "a1900700-0000-4000-8000-000000000002";
const CLIENT = "a1900700-0000-4000-8000-000000000003";
const GEO_ZONE = "a1900700-0000-4000-8000-000000000004";
const PROJECT = "a1900700-0000-4000-8000-000000000005";
// ACTOR (above) is the project OWNER — ownership is its own access path,
// independent of project_members, so revoking a grant row for ACTOR has NO
// effect and can never prove grant-loss. GRANT_ACTOR's ONLY access to
// PROJECT is a real, active project_members row (never ownership) — the
// same distinction already established in the preflight/download writers'
// own physical test files.
const GRANT_ACTOR = "a1900700-0000-4000-8000-000000000006";
const GEOCODED_AT = new Date("2026-10-06T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "New-delivery concurrency synthetic zone", county: "New-delivery Concurrency County", zipCodes: ["00007"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "New-delivery concurrency synthetic shelf", description: "New-delivery concurrency synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "New-delivery concurrency synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "New-delivery concurrency synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createApprovedDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const draft = await createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  const approved = await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "New-delivery concurrency synthetic approval" },
    ACTOR, TENANT,
  );
  return { draft, approved };
}
function deliveryInput(draftId: string, actorId: string = ACTOR) {
  return { context: { tenantId: TENANT, actorId, projectId: PROJECT, estimateDraftId: draftId }, format: "json" as const, attemptKind: "delivery" as const };
}

describe.skipIf(!labConfig)("A1 new-delivery writer — real multi-connection concurrency", () => {
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
    holderConnection = postgres({ host: socketDirectory, database: config.database, username: config.user, port: config.port, ssl: false, max: 5, prepare: false });
    monitorConnection = postgres({ host: socketDirectory, database: config.database, username: config.user, port: config.port, ssl: false, max: 5, prepare: false });
    const [identity] = await connection`select current_database() as database, current_user as username, current_setting('listen_addresses') as listen_addresses, inet_server_addr() as server_address`;
    if (identity.database !== config.database || identity.username !== config.user || identity.listen_addresses !== "" || identity.server_address !== null) {
      throw new Error("PostgreSQL identity does not match the owned socket-only laboratory");
    }
    database = drizzle(connection, { schema: s });
    deps.getDb.mockImplementation(async () => database);

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'New-delivery concurrency synthetic tenant', 'a1-export-new-delivery-writer-concurrency-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'New-delivery concurrency synthetic actor', 'user'), (${GRANT_ACTOR}, ${TENANT}, 'New-delivery concurrency synthetic grant-only actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'New-delivery concurrency synthetic client')`;
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 New-Delivery Concurrency Lane", city: "New-Delivery Concurrency City", state: "SC", zipCode: "00007", county: "New-delivery Concurrency County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 New-Delivery Concurrency Lane, New-Delivery Concurrency City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "New-delivery concurrency synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 New-Delivery Concurrency Lane, New-Delivery Concurrency City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone().zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
  });
  afterAll(async () => {
    deps.getDb.mockReset();
    await connection?.end({ timeout: 1 });
    await holderConnection?.end({ timeout: 1 });
    await monitorConnection?.end({ timeout: 1 });
  });
  beforeEach(() => { hooks.callIndex = 0; hooks.attempts = {}; hooks.afterCall = null; });
  afterEach(() => { hooks.afterCall = null; });

  describe("decision change committing strictly BETWEEN phase 1 and phase 2 (dead time)", () => {
    it("a revocation that commits strictly between phase 1 (usable) and phase 2 is reread fresh: the SAME prepared decision's canonical block is persisted, discarding the stale rendered bytes — never a partial/ready row", async () => {
      const { draft, approved } = await createApprovedDraft();
      hooks.afterCall = async idx => {
        if (idx !== 1) return; // phase 1 already committed as usable — bytes regenerated next, outside any tx
        await revokeInternalEstimateApproval(
          { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: approved.contentHash, reason: "New-delivery concurrency synthetic revoke between phases" },
          ACTOR, TENANT,
        );
      };
      let observed: any;
      try { await createAndDeliverExportAttempt(deliveryInput(draft.id)); } catch (e) { observed = e; }
      expect(observed).toBeInstanceOf(ExportDeliveryBlockedError);
      expect(observed.code).toBe("INTERNAL_APPROVAL_REVOKED");
      expect(hooks.attempts[1]).toBe(1);
      expect(hooks.attempts[2]).toBe(1); // phase 2 never contended on a lock here — it simply disagreed with phase 1

      const [row] = await connection`SELECT status, attempt_kind, downloaded_by, downloaded_at, artifact_hash, internal_approval_id FROM jobtread_exports WHERE id = ${observed.exportId}`;
      expect(row.status).toBe("blocked_authorization"); // the canonical block, never the stale ready/downloaded preparation
      expect(row.attempt_kind).toBe("delivery");
      expect(row.downloaded_by).toBeNull();
      expect(row.downloaded_at).toBeNull();
      expect(row.artifact_hash).toBeNull(); // the regenerated bytes (proven to exist, since phase 1 was usable) were NEVER persisted
      expect(row.internal_approval_id).toBe(approved.approvalId); // same prepared decision's identity preserved in the canonical block
    }, 15000);

    it("item B: a decision born AND already revoked between phases — phase 1 sees no decision, a REAL approval is created and revoked (real helpers) before phase 2 reads — still refuses as a typed conflict, never a canonical block of the new authority, zero rows", async () => {
      const draft = await createEstimateDraftFromCalculator(buildPayload([makeLine()]), ACTOR, TENANT); // never approved
      hooks.afterCall = async idx => {
        if (idx !== 1) return; // phase 1 already committed, saw INTERNAL_APPROVAL_REQUIRED, authority null
        const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
        const approved = await recordInternalEstimateApproval(
          { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "New-delivery item B synthetic born-then-revoked approval" },
          ACTOR, TENANT,
        );
        await revokeInternalEstimateApproval(
          { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: approved.contentHash, reason: "New-delivery item B synthetic born-then-revoked revoke" },
          ACTOR, TENANT,
        );
      };
      await expect(createAndDeliverExportAttempt(deliveryInput(draft.id))).rejects.toThrow(/INTERNAL_APPROVAL_REQUEST_CONFLICT/);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0); // zero rows — never a canonical block of a decision phase 1 never saw
      const audits = await connection`SELECT id FROM audit_logs WHERE new_values->>'estimateDraftId' = ${draft.id}`;
      expect(audits).toHaveLength(0);
    }, 15000);
  });

  describe("grant/decision changes committing WHILE phase 2's final transaction is genuinely blocked on a lock", () => {
    it("a REAL project_members grant lost WHILE phase 2 is blocked waiting on the projects lock is reread fresh once unblocked: FORBIDDEN, zero rows", async () => {
      const { draft } = await createApprovedDraft();
      await connection`INSERT INTO project_members (project_id, tenant_id, user_id, project_role, permissions, is_active) VALUES (${PROJECT}, ${TENANT}, ${GRANT_ACTOR}, 'viewer', '["read"]'::jsonb, true) ON CONFLICT DO NOTHING`;
      let holder: ReturnType<typeof holdProjectLock> | null = null;
      hooks.afterCall = async idx => {
        if (idx !== 1) return;
        holder = holdProjectLock(PROJECT, async sql => { await sql`UPDATE projects SET updated_at = now() WHERE id = ${PROJECT}`; });
        await holder.acquired;
      };
      const writerPromise = createAndDeliverExportAttempt(deliveryInput(draft.id, GRANT_ACTOR));
      await waitForObservableProjectLockWait();
      await connection`UPDATE project_members SET is_active = false WHERE project_id = ${PROJECT} AND user_id = ${GRANT_ACTOR}`;
      holder!.release();
      await holder!.done;
      try {
        await expect(writerPromise).rejects.toThrow(/do not have access to this project/);
        expect(hooks.attempts[2]).toBe(2); // a genuine SQLSTATE 40001 on unblock forces a real second execution
      } finally {
        await connection`DELETE FROM project_members WHERE project_id = ${PROJECT} AND user_id = ${GRANT_ACTOR}`;
      }
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    }, 20000);

    it("a decision revoked WHILE phase 2 is blocked waiting on the projects lock is reread fresh once unblocked: canonical block persisted, zero bytes", async () => {
      const { draft, approved } = await createApprovedDraft();
      let holder: ReturnType<typeof holdProjectLock> | null = null;
      hooks.afterCall = async idx => {
        if (idx !== 1) return;
        holder = holdProjectLock(PROJECT, async sql => { await sql`UPDATE projects SET updated_at = now() WHERE id = ${PROJECT}`; });
        await holder.acquired;
      };
      const writerPromise = createAndDeliverExportAttempt(deliveryInput(draft.id));
      await waitForObservableProjectLockWait();
      // The REAL revokeInternalEstimateApproval helper itself locks `projects`
      // FIRST — calling it here would deadlock against our own held lock.
      // Raw SQL directly against estimate_drafts/estimate_internal_approval_
      // revocations (same technique already accepted for the download writer's
      // own analogous test) never touches `projects`, so it commits freely.
      const requestId = randomUUID();
      const revocationId = randomUUID();
      const reason = "New-delivery lock-wait synthetic revoke";
      const requestHash = await hashInternalApprovalCommand({
        operation: "revoke", context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, clientId: CLIENT },
        command: { id: draft.id, approvalId: approved.approvalId, requestId, expectedContentHash: approved.contentHash, reason },
      });
      await connection.begin(async sql => {
        await sql`UPDATE estimate_drafts SET status = 'internal_approval_revoked', updated_at = now() WHERE id = ${draft.id}`;
        await sql`
          INSERT INTO estimate_internal_approval_revocations (id, tenant_id, project_id, client_id, estimate_draft_id, approval_id, request_id, request_hash, revoked_by, reason, contract_version)
          VALUES (${revocationId}, ${TENANT}, ${PROJECT}, ${CLIENT}, ${draft.id}, ${approved.approvalId}, ${requestId}, ${requestHash}, ${ACTOR}, ${reason}, 'internal-approval-revocation-v1')
        `;
      });
      holder!.release();
      await holder!.done;
      let observed: any;
      try { await writerPromise; } catch (e) { observed = e; }
      expect(observed).toBeInstanceOf(ExportDeliveryBlockedError);
      expect(observed.code).toBe("INTERNAL_APPROVAL_REVOKED");
      expect(hooks.attempts[2]).toBe(2); // a genuine SQLSTATE 40001 on unblock forces a real second execution

      const [row] = await connection`SELECT status, artifact_hash, downloaded_by FROM jobtread_exports WHERE id = ${observed.exportId}`;
      expect(row.status).toBe("blocked_authorization");
      expect(row.artifact_hash).toBeNull();
      expect(row.downloaded_by).toBeNull();
    }, 20000);
  });

  describe("two genuinely concurrent new-delivery calls on the SAME draft", () => {
    it("real lock contention is OBSERVED, and both calls produce their OWN distinct delivered attempt — never silent deduplication", async () => {
      const { draft } = await createApprovedDraft();
      const racePromise = Promise.allSettled([
        createAndDeliverExportAttempt(deliveryInput(draft.id)),
        createAndDeliverExportAttempt(deliveryInput(draft.id)),
      ]);
      await waitForObservableProjectLockWait();
      const [settledFirst, settledSecond] = await racePromise;
      expect(settledFirst.status).toBe("fulfilled");
      expect(settledSecond.status).toBe("fulfilled");
      const first = (settledFirst as PromiseFulfilledResult<Awaited<ReturnType<typeof createAndDeliverExportAttempt>>>).value;
      const second = (settledSecond as PromiseFulfilledResult<Awaited<ReturnType<typeof createAndDeliverExportAttempt>>>).value;
      expect(first.exportId).not.toBe(second.exportId);
      const rows = await connection`SELECT id, status FROM jobtread_exports WHERE estimate_draft_id = ${draft.id} ORDER BY created_at`;
      expect(rows.map(r => r.id).sort()).toEqual([first.exportId, second.exportId].sort());
      for (const row of rows) expect(row.status).toBe("downloaded");
      const audits = await connection`SELECT record_id FROM audit_logs WHERE record_id = ANY(${[first.exportId, second.exportId]}) AND action = 'estimate.export_delivery'`;
      expect(audits).toHaveLength(2);
    }, 30000);
  });
});
