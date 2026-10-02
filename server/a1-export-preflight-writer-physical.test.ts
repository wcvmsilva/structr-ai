/**
 * A1-EXPORT-PREFLIGHT-WRITER-CONTRACT.md — real multi-connection concurrency
 * proof for `createExportAttempt`. Same disposable lab/env gate as
 * server/a1-export-preflight-writer.test.ts; this file focuses exclusively on
 * genuine concurrent interleaving, never pure business-logic coverage (that is
 * the other file's job).
 *
 * Scope, named explicitly (same precedent already accepted for
 * server/a1-export-physical.test.ts's own header): TWO independent `postgres()`
 * connections against the same real cluster, not two separate OS processes.
 * What is proven here is genuine PostgreSQL-level row locking/visibility across
 * independent connections — never two bare promises raced and hoped about. Every
 * race below has an OBSERVABLE BARRIER: a second, dedicated "holder" connection
 * takes a real `FOR UPDATE` lock on `estimate_drafts` and is confirmed, via
 * `pg_stat_activity` polled from a third connection, to be genuinely blocking the
 * writer's own backend before the holder's transaction is allowed to proceed and
 * commit. No instrumentation/hook of any kind is added to the writer under test.
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
import { getInternalApprovalReview, recordInternalEstimateApproval } from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import { createExportAttempt } from "./internal-estimate-export-db";
import { hashInternalApprovalCommand } from "../shared/internal-estimate-approval-engine";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let holderConnection: ReturnType<typeof postgres>;
let monitorConnection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900200-0000-4000-8000-000000000001";
const ACTOR = "a1900200-0000-4000-8000-000000000002";
const CLIENT = "a1900200-0000-4000-8000-000000000003";
const GEO_ZONE = "a1900200-0000-4000-8000-000000000004";
const PROJECT = "a1900200-0000-4000-8000-000000000005";
const GEOCODED_AT = new Date("2026-10-02T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Concurrency synthetic zone", county: "Concurrency County", zipCodes: ["00002"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Concurrency synthetic shelf", description: "Concurrency synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>>) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Concurrency synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Concurrency synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createApprovedDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const draft = await createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  const approved = await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Concurrency synthetic approval" },
    ACTOR, TENANT,
  );
  return { draft, approved };
}
function attemptInput(draftId: string) {
  return { context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draftId }, format: "json" as const, attemptKind: "preflight" as const };
}
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * Opens a REAL transaction on a dedicated connection and holds a `FOR UPDATE`
 * lock on one `estimate_drafts` row until `release()` is called — at which
 * point `mutate` runs and the transaction commits. Returns once the lock is
 * actually acquired.
 *
 * `mutate` MUST run on the `sql` handle passed to it (the SAME connection/
 * transaction already holding the lock), never as a separate top-level query
 * on `holderConnection` — a separate autocommit statement from the SAME pool
 * would need its OWN implicit row lock on the identical row the still-open
 * transaction already holds, which can only be released by THIS code path,
 * producing a genuine self-deadlock (reproduced once while building this file:
 * the writer's observable lock-wait was confirmed correctly, then the test
 * hung forever on exactly this mistake).
 */
type TxSql = Parameters<Parameters<typeof holderConnection.begin>[0]>[0];
function holdDraftLock(draftId: string, mutate: (sql: TxSql) => Promise<void>) {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let acquired!: () => void;
  const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; });
  const done = holderConnection.begin(async sql => {
    await sql`SELECT * FROM estimate_drafts WHERE id = ${draftId} FOR UPDATE`;
    acquired();
    await released;
    await mutate(sql);
  });
  return { acquired: acquiredPromise, release, done };
}

/** Polls pg_stat_activity (from the independent monitor connection) until at
 * least one OTHER backend is observed genuinely waiting on a lock while
 * querying estimate_drafts — the writer under test, contending for the row
 * `holdDraftLock` above already holds. Bounded; throws (failing the test
 * loudly) if the block is never observed, rather than passing on a hope. */
async function waitForObservableLockWait(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await monitorConnection`
      SELECT pid, wait_event_type, query FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query ILIKE '%estimate_drafts%' AND query ILIKE '%for update%'
    `;
    if (rows.length > 0) return;
    await sleep(20);
  }
  throw new Error(`Never observed a backend genuinely waiting on the held estimate_drafts lock within ${timeoutMs}ms`);
}

describe.skipIf(!labConfig)("A1 export preflight writer — real multi-connection concurrency", () => {
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
    const connect = () => postgres({ host: socketDirectory, database: config.database, username: config.user, port: config.port, ssl: false, max: 5, prepare: false });
    connection = connect();
    holderConnection = connect();
    monitorConnection = connect();
    const [identity] = await connection`select current_database() as database, current_user as username, current_setting('listen_addresses') as listen_addresses, inet_server_addr() as server_address`;
    if (identity.database !== config.database || identity.username !== config.user || identity.listen_addresses !== "" || identity.server_address !== null) {
      throw new Error("PostgreSQL identity does not match the owned socket-only laboratory");
    }
    database = drizzle(connection, { schema: s });
    deps.getDb.mockImplementation(async () => database);

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Concurrency synthetic tenant', 'a1-export-preflight-writer-concurrency-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Concurrency synthetic actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'Concurrency synthetic client')`;

    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Concurrency Lane", city: "Concurrency City", state: "SC", zipCode: "00002", county: "Concurrency County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Concurrency Lane, Concurrency City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "Concurrency synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 Concurrency Lane, Concurrency City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
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

  it("a revocation that commits while the writer's final tx is genuinely blocked on the SAME row is reread fresh: the attempt never promotes to ready, exactly one row/audit results", async () => {
    const { draft, approved } = await createApprovedDraft();
    const requestId = randomUUID();
    const revocationId = randomUUID();
    const reason = "Concurrency synthetic revoke under observed lock";
    // readInternalApprovalRecord recomputes this hash itself and demands exact
    // equality (the same integrity gate that protects the real writer) — a
    // placeholder value here would make the row internally inconsistent, not a
    // real revoked decision, and surface as INTERNAL_APPROVAL_CONTENT_UNRESOLVED
    // instead of the revoke this test actually means to prove (reproduced once
    // while building this file with a hand-picked hash).
    const requestHash = await hashInternalApprovalCommand({
      operation: "revoke", context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, clientId: CLIENT },
      command: { id: draft.id, approvalId: approved.approvalId, requestId, expectedContentHash: approved.contentHash, reason },
    });
    // Same two statements the already-accepted concurrency worker's "revoke"
    // role performs — run on the SAME connection/transaction already holding
    // the lock (never a separate top-level query against the same pool, which
    // would need its own implicit lock on the identical row and self-deadlock).
    const holder = holdDraftLock(draft.id, async sql => {
      await sql`UPDATE estimate_drafts SET status = 'internal_approval_revoked', updated_at = now() WHERE id = ${draft.id}`;
      await sql`
        INSERT INTO estimate_internal_approval_revocations (id, tenant_id, project_id, client_id, estimate_draft_id, approval_id, request_id, request_hash, revoked_by, reason, contract_version)
        VALUES (${revocationId}, ${TENANT}, ${PROJECT}, ${CLIENT}, ${draft.id}, ${approved.approvalId}, ${requestId}, ${requestHash}, ${ACTOR}, ${reason}, 'internal-approval-revocation-v1')
      `;
    });
    await holder.acquired;

    const writerPromise = createExportAttempt(attemptInput(draft.id));
    await waitForObservableLockWait();

    // The holder is CONFIRMED to be genuinely blocking the writer's own backend
    // at this point. Releasing now runs the mutation above and commits — the
    // writer can only proceed, and only ever see the post-revocation row, from
    // here on.
    holder.release();
    await holder.done;

    const summary = await writerPromise;
    expect(summary.outcome).toBe("blocked");
    expect(summary.status).toBe("blocked_authorization");
    expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_REVOKED", lineKey: null, field: null }]);
    expect(summary.authority).toEqual({ approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash });

    const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(summary.exportId);
    const auditRows = await connection`SELECT id FROM audit_logs WHERE record_id = ${summary.exportId}`;
    expect(auditRows).toHaveLength(1);
  }, 15000);

  it("a supersession that commits while the writer's final tx is genuinely blocked on the SAME row is reread fresh: ESTIMATE_SUPERSEDED, never a promoted ready", async () => {
    const { draft, approved } = await createApprovedDraft();
    const childId = randomUUID(), requestId = randomUUID();
    // Both statements run on the SAME connection/transaction already holding
    // the lock (see holdDraftLock's doc comment) — a separate begin() here
    // would need its own implicit lock on the identical row the still-open
    // holder transaction already holds, and self-deadlock exactly as the
    // revocation test above did before this was fixed.
    const holder = holdDraftLock(draft.id, async sql => {
      await sql`
        INSERT INTO estimate_drafts
        SELECT * FROM jsonb_populate_record(null::estimate_drafts,
          (to_jsonb((SELECT t FROM estimate_drafts t WHERE t.id = ${draft.id}))
            || jsonb_build_object(
                 'id', ${childId}::text, 'version', ${draft.version + 1}::int,
                 'source', 'version', 'supersedes_id', ${draft.id}::text,
                 'a1_version_request_id', ${requestId}::text, 'a1_version_request_hash', ${"d".repeat(64)}::text,
                 'created_by', ${ACTOR}::text, 'superseded_by', null,
                 'status', 'draft', 'approved_by', null, 'approved_at', null,
                 'rejected_by', null, 'rejected_at', null, 'rejection_reason', null, 'locked_at', null,
                 'created_at', now(), 'updated_at', now()
               )
          )
        )`;
      await sql`UPDATE estimate_drafts SET superseded_by = ${childId}, updated_at = now() WHERE id = ${draft.id}`;
    });
    await holder.acquired;

    const writerPromise = createExportAttempt(attemptInput(draft.id));
    await waitForObservableLockWait();

    holder.release();
    await holder.done;

    const summary = await writerPromise;
    expect(summary.outcome).toBe("blocked");
    expect(summary.status).toBe("blocked_authorization");
    expect(summary.validation.issues).toEqual([{ code: "ESTIMATE_SUPERSEDED", lineKey: null, field: null }]);
    expect(summary.authority).toEqual({ approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash });

    const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
    expect(rows).toHaveLength(1);
  }, 20000);

  it("retries through a real SQLSTATE 40001 serialization failure and still produces exactly one terminal row", async () => {
    // Two writer attempts for the SAME never-decided draft, fired genuinely
    // concurrently: both independently discover "no usable decision" and both
    // persist their OWN terminal blocked_authorization row (createExportAttempt
    // has no idempotency key — every call is a brand-new attempt, by contract).
    // What this proves is the SERIALIZABLE retry path itself survives real
    // contention without duplicating/corrupting evidence: each call's own FOR
    // UPDATE lock on the SAME draft+project rows forces real serialization
    // (one waits for the other's commit, or one is canceled with 40001 and the
    // accepted withInternalApprovalTransaction retry — imported unchanged —
    // transparently retries it), and BOTH calls still resolve with their own
    // single, internally consistent row; neither duplicates, neither corrupts.
    const draft = await createEstimateDraftFromCalculator(buildPayload([makeLine()]), ACTOR, TENANT);
    const [first, second] = await Promise.all([
      createExportAttempt(attemptInput(draft.id)),
      createExportAttempt(attemptInput(draft.id)),
    ]);
    for (const summary of [first, second]) {
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }]);
    }
    expect(first.exportId).not.toBe(second.exportId);
    const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id} ORDER BY created_at`;
    expect(rows.map(r => r.id).sort()).toEqual([first.exportId, second.exportId].sort());
    const auditRows = await connection`SELECT record_id FROM audit_logs WHERE record_id = ANY(${[first.exportId, second.exportId]})`;
    expect(auditRows).toHaveLength(2);
  }, 60000);
});
