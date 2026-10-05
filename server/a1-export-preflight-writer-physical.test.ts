/**
 * A1-EXPORT-PREFLIGHT-WRITER-CONTRACT.md + MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V1-
 * QA-AND-CORRECTION.md — real multi-connection concurrency proof for
 * `createExportAttempt`. Same disposable lab/env gate as
 * server/a1-export-preflight-writer.test.ts; this file focuses exclusively on
 * genuine concurrent interleaving and the migration repair's own physical
 * behavior, never pure business-logic coverage (that is the other file's job).
 *
 * V1 → V2 change (QA item 2): V1's revocation/supersession tests took the
 * holder's lock BEFORE calling createExportAttempt — so the writer's OWN first
 * reader already saw the mutated state, never exercising the usable-then-
 * blocked-between-phases transition the contract actually asked for. V2 instead
 * instruments the PHASE BOUNDARY directly: `withInternalApprovalTransaction`
 * (imported, by the writer, as `withExportAttemptTransaction`) is wrapped so a
 * test-supplied hook can run deterministically AFTER phase 1's transaction has
 * genuinely committed and BEFORE phase 2's transaction begins — no bypass hook
 * on the writer itself, only on the already-reused helper this file mocks for
 * its own test harness. The SAME wrapper counts how many times each phase's
 * underlying transaction callback actually executes, so the SQLSTATE 40001
 * retry test (item 4) can state what genuinely happened instead of assuming it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));

// Test-only phase-boundary/attempt-count instrumentation (QA V2 items 2 and 4).
// Wraps the ALREADY-REUSED `withInternalApprovalTransaction` as imported by THIS
// test file's mock of its module — never a hook added to the writer or to any
// product file. Internal same-module calls (e.g. `getInternalApprovalReview`
// calling the function directly, not through this export) are UNAFFECTED by
// this wrapper, so test fixture setup never touches `hooks` at all — only the
// writer's own two top-level calls (phase 1, phase 2) do.
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
// Not the project owner (ownerUserId is always ACTOR below) — access comes
// ONLY from a real, active project_members grant, so revoking THAT grant
// specifically (QA V2 item C) is distinguishable from deactivating a profile.
const GRANT_ACTOR = "a1900200-0000-4000-8000-000000000006";
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
 * transaction already holds, producing a genuine self-deadlock (reproduced
 * once while building the V1 file).
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
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Concurrency synthetic actor', 'user'), (${GRANT_ACTOR}, ${TENANT}, 'Concurrency synthetic grant-only actor', 'user')`;
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
    // GRANT_ACTOR's ONLY access to PROJECT is this real, active membership row
    // (projectRole "viewer", explicit "read" permission) — never ownership.
    await connection`
      INSERT INTO project_members (project_id, tenant_id, user_id, project_role, permissions, is_active)
      VALUES (${PROJECT}, ${TENANT}, ${GRANT_ACTOR}, 'viewer', '["read"]'::jsonb, true)
    `;
  });
  afterAll(async () => {
    deps.getDb.mockReset();
    await connection?.end({ timeout: 1 });
    await holderConnection?.end({ timeout: 1 });
    await monitorConnection?.end({ timeout: 1 });
  });
  beforeEach(() => { hooks.callIndex = 0; hooks.attempts = {}; hooks.afterCall = null; });
  afterEach(() => { hooks.afterCall = null; });

  describe("revocation/supersession committing BETWEEN phase 1 and phase 2 (QA V2 item 2)", () => {
    it("a revocation that commits strictly between phase 1 (usable) and phase 2 is reread fresh: the attempt never promotes to ready, the canonical block is recorded WITH authority/totals, exactly one row/audit results", async () => {
      const { draft, approved } = await createApprovedDraft();
      const requestId = randomUUID();
      const revocationId = randomUUID();
      const reason = "Concurrency synthetic revoke between phases";
      // readInternalApprovalRecord recomputes this hash itself and demands exact
      // equality — a placeholder value would make the row internally
      // inconsistent, not a real revoked decision (reproduced once in V1).
      const requestHash = await hashInternalApprovalCommand({
        operation: "revoke", context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, clientId: CLIENT },
        command: { id: draft.id, approvalId: approved.approvalId, requestId, expectedContentHash: approved.contentHash, reason },
      });
      hooks.afterCall = async idx => {
        if (idx !== 1) return; // fires only after phase 1's transaction has committed
        await connection.begin(async sql => {
          await sql`UPDATE estimate_drafts SET status = 'internal_approval_revoked', updated_at = now() WHERE id = ${draft.id}`;
          await sql`
            INSERT INTO estimate_internal_approval_revocations (id, tenant_id, project_id, client_id, estimate_draft_id, approval_id, request_id, request_hash, revoked_by, reason, contract_version)
            VALUES (${revocationId}, ${TENANT}, ${PROJECT}, ${CLIENT}, ${draft.id}, ${approved.approvalId}, ${requestId}, ${requestHash}, ${ACTOR}, ${reason}, 'internal-approval-revocation-v1')
          `;
        });
      };

      const summary = await createExportAttempt(attemptInput(draft.id));
      expect(hooks.attempts[1]).toBe(1);
      expect(hooks.attempts[2]).toBe(1); // phase 2 never contended on a lock here — no retry needed
      expect(summary.outcome).toBe("blocked");
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_REVOKED", lineKey: null, field: null }]);
      // The canonical block preserves the SAME decision's authority/totals that
      // phase 1 had prepared bytes against — never discarded as a bare conflict.
      expect(summary.authority).toEqual({ approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash });
      expect(summary.validation.reconciliation).toEqual({ state: "not_evaluated", approvedTotalMinor: "10000", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "4000" });
      expect(summary.artifact).toBeNull();

      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(summary.exportId);
      const auditRows = await connection`SELECT id FROM audit_logs WHERE record_id = ${summary.exportId}`;
      expect(auditRows).toHaveLength(1);
    }, 15000);

    it("a supersession that commits strictly between phase 1 (usable) and phase 2 is reread fresh: ESTIMATE_SUPERSEDED, never a promoted ready, canonical block with authority/totals", async () => {
      const { draft, approved } = await createApprovedDraft();
      const childId = randomUUID(), requestId = randomUUID();
      hooks.afterCall = async idx => {
        if (idx !== 1) return;
        // Both statements commit together: internal_approval_check_final_v1 is a
        // DEFERRED constraint trigger that only agrees parent.superseded_by/
        // child.id match once BOTH sides have been written.
        await connection.begin(async sql => {
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
      };

      const summary = await createExportAttempt(attemptInput(draft.id));
      expect(hooks.attempts[1]).toBe(1);
      expect(hooks.attempts[2]).toBe(1);
      expect(summary.outcome).toBe("blocked");
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "ESTIMATE_SUPERSEDED", lineKey: null, field: null }]);
      expect(summary.authority).toEqual({ approvalId: approved.approvalId, snapshotId: approved.snapshotId, contentHash: approved.contentHash });
      expect(summary.validation.reconciliation.state).toBe("not_evaluated");

      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(1);
      const auditRows = await connection`SELECT id FROM audit_logs WHERE record_id = ${summary.exportId}`;
      expect(auditRows).toHaveLength(1);
    }, 20000);

    it("a genuinely DIFFERENT review appearing between phases (draft moved to legacy-reconciliation-required) still refuses as a typed conflict — never persists phase 1's stale usable preparation nor phase 2's diagnosis as if it were the SAME prepared decision", async () => {
      const { draft } = await createApprovedDraft();
      hooks.afterCall = async idx => {
        if (idx !== 1) return;
        // A genuinely different situation: the approval record itself is wiped
        // and legacy approvedBy/At markers are set directly — phase 2 will see
        // "no usable decision, legacy reconciliation required", with NULL
        // authority — never the SAME decision's authority, so this must be a
        // conflict, not a canonical block.
        // Both evidence tables are guarded by an immutability trigger that
        // rejects a plain DELETE outright — the established, narrowly-scoped
        // SET LOCAL session_replication_role = replica bypass (same technique
        // as the main behavior file's snapshot-corruption test) is deliberate
        // here, confined to this one transaction, auto-reset at its commit.
        await connection.begin(async sql => {
          await sql`SET LOCAL session_replication_role = replica`;
          await sql`DELETE FROM estimate_internal_approvals WHERE estimate_draft_id = ${draft.id}`;
          await sql`DELETE FROM estimate_internal_approval_snapshots WHERE estimate_draft_id = ${draft.id}`;
          await sql`UPDATE estimate_drafts SET status = 'draft', approved_by = ${ACTOR}, approved_at = now(), locked_at = null WHERE id = ${draft.id}`;
        });
      };
      await expect(createExportAttempt(attemptInput(draft.id))).rejects.toThrow(/INTERNAL_APPROVAL_REQUEST_CONFLICT/);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    }, 15000);

    it("item B: a decision born AND already revoked between phases — phase 1 sees no decision, a REAL approval is created and revoked (real helpers) before phase 2 reads — still refuses as a typed conflict, never a canonical block of the new authority", async () => {
      // §B physical case: "fase1 sem decisão; depois do commit dessa leitura,
      // criar aprovação REAL e revogá-la com os helpers REAIS; fase2 agora
      // encontra authority nova, embora bloqueada." V2's bug (phase-results.json
      // case 5): because phase 1 was blocked-without-authority, V2 accepted
      // ANY phase-2 blocked diagnosis unconditionally — including one that now
      // carries a brand-new, already-revoked authority phase 1 never saw at
      // all. The unified identity comparison (item B fix) catches this: null
      // (phase 1) vs non-null (phase 2) is a changed identity regardless of
      // phase 2's class.
      const draft = await createEstimateDraftFromCalculator(buildPayload([makeLine()]), ACTOR, TENANT);
      hooks.afterCall = async idx => {
        if (idx !== 1) return; // phase 1 already committed, saw INTERNAL_APPROVAL_REQUIRED, authority null
        // "revogá-la com os helpers REAIS" — the real approve/revoke writers,
        // never hand-rolled raw SQL for the two mirrored-consistency statements
        // a deferred trigger expects to commit together.
        const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
        const approved = await recordInternalEstimateApproval(
          { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Item B synthetic born-then-revoked approval" },
          ACTOR, TENANT,
        );
        await revokeInternalEstimateApproval(
          { id: draft.id, approvalId: approved.approvalId, requestId: randomUUID(), expectedContentHash: approved.contentHash, reason: "Item B synthetic born-then-revoked revoke" },
          ACTOR, TENANT,
        );
      };
      await expect(createExportAttempt(attemptInput(draft.id))).rejects.toThrow(/INTERNAL_APPROVAL_REQUEST_CONFLICT/);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0); // zero export attempt/audit — never a re-render, never a canonical block of a decision phase 1 never saw
      const auditRows = await connection`SELECT id FROM audit_logs WHERE new_values->>'estimateDraftId' = ${draft.id}`;
      expect(auditRows).toHaveLength(0);
    }, 15000);
  });

  describe("concurrent grant/profile change between phases (QA V2 item 6)", () => {
    it("the actor's own profile being deactivated strictly between phase 1 and phase 2 is reread fresh: refused, never a partially-accepted row", async () => {
      const { draft } = await createApprovedDraft();
      hooks.afterCall = async idx => {
        if (idx !== 1) return;
        await connection`UPDATE profiles SET is_active = false WHERE id = ${ACTOR}`;
      };
      try {
        await expect(createExportAttempt(attemptInput(draft.id))).rejects.toThrow();
      } finally {
        await connection`UPDATE profiles SET is_active = true WHERE id = ${ACTOR}`;
      }
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    }, 15000);

    it("a REAL project grant (not profile deactivation) lost between phases — actor is a non-owner whose read access comes ONLY from an active project_members row — is reread fresh: refused by the real policy, never a partially-accepted row", async () => {
      // Distinct from the profile-deactivation test above: GRANT_ACTOR's
      // profile/tenant stay fully active throughout — only the project_members
      // GRANT itself is revoked, through the exact same real `requireProjectAccess`
      // policy path every other caller goes through (project-access.ts decision
      // order step 6, "explicit membership"), never a bypass/shortcut.
      const { draft } = await createApprovedDraft();
      const grantInput = { context: { tenantId: TENANT, actorId: GRANT_ACTOR, projectId: PROJECT, estimateDraftId: draft.id }, format: "json" as const, attemptKind: "preflight" as const };
      hooks.afterCall = async idx => {
        if (idx !== 1) return;
        await connection`UPDATE project_members SET is_active = false WHERE project_id = ${PROJECT} AND user_id = ${GRANT_ACTOR}`;
      };
      try {
        await expect(createExportAttempt(grantInput)).rejects.toThrow();
      } finally {
        await connection`UPDATE project_members SET is_active = true WHERE project_id = ${PROJECT} AND user_id = ${GRANT_ACTOR}`;
      }
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    }, 15000);
  });

  describe("a genuine SQLSTATE 40001 serialization failure during phase 2 (QA V2 items 4 and 6)", () => {
    it("retries through a REAL concurrent-update conflict (observed, not presumed) and still produces exactly one terminal row with a STABLE exportId across the retry", async () => {
      const { draft } = await createApprovedDraft();
      let holder: ReturnType<typeof holdDraftLock> | null = null;
      hooks.afterCall = async idx => {
        if (idx !== 1) return; // phase 1 has committed; take the lock before phase 2 even starts
        holder = holdDraftLock(draft.id, async sql => {
          await sql`UPDATE estimate_drafts SET updated_at = now() WHERE id = ${draft.id}`;
        });
        await holder.acquired;
      };

      const writerPromise = createExportAttempt(attemptInput(draft.id));
      // By the time phase 1's afterCall hook has resolved (awaited inside the
      // mocked withInternalApprovalTransaction before it returns control),
      // the holder DEFINITELY already holds the lock — phase 2's own FOR UPDATE
      // on the same row is guaranteed to block on it, not race it.
      await waitForObservableLockWait();
      holder!.release();
      await holder!.done; // holder's UPDATE commits — this is the "concurrent update"
      const summary = await writerPromise;

      // The genuine, observed mechanism: phase 2's FOR UPDATE unblocks into a
      // real SQLSTATE 40001 (the holder's commit postdates phase 2's own
      // SERIALIZABLE snapshot) and withInternalApprovalTransaction (imported,
      // unchanged) retries the WHOLE callback — attempts[2] > 1 is the direct,
      // observed proof; it is NOT inferred from timing or from "both promises
      // eventually resolved."
      expect(hooks.attempts[2]).toBeGreaterThan(1);
      expect(summary.outcome).toBe("ready");
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(summary.exportId); // identity fixed outside the retryable callback — stable across the retry
      const auditRows = await connection`SELECT id FROM audit_logs WHERE record_id = ${summary.exportId}`;
      expect(auditRows).toHaveLength(1);
    }, 20000);

    it("control for the ORIGINALLY buggy branch: a never-decided draft (persistBlockedAuthority, V1's own randomUUID bug) retries through a REAL 40001 and keeps the SAME exportId fixed outside the callback across the retry", async () => {
      // V1's bug lived specifically in `persistBlockedAuthority` generating its
      // own `randomUUID()` INSIDE the retryable callback — exactly the
      // blocked/no-decision branch, never the ready/persistReady branch the
      // test above already covers. This is the same mechanism (real lock-then-
      // concurrent-update forcing a genuine 40001), aimed at the specific
      // branch the original defect was in, not a second copy of the same proof.
      const draft = await createEstimateDraftFromCalculator(buildPayload([makeLine()]), ACTOR, TENANT);
      let holder: ReturnType<typeof holdDraftLock> | null = null;
      hooks.afterCall = async idx => {
        if (idx !== 1) return;
        holder = holdDraftLock(draft.id, async sql => {
          await sql`UPDATE estimate_drafts SET updated_at = now() WHERE id = ${draft.id}`;
        });
        await holder.acquired;
      };
      const writerPromise = createExportAttempt(attemptInput(draft.id));
      await waitForObservableLockWait();
      holder!.release();
      await holder!.done;
      const summary = await writerPromise;

      expect(hooks.attempts[2]).toBeGreaterThan(1); // genuine retry observed, not presumed
      expect(summary.outcome).toBe("blocked");
      expect(summary.status).toBe("blocked_authorization");
      expect(summary.validation.issues).toEqual([{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }]);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(1); // exactly one row — not one per attempt
      expect(rows[0].id).toBe(summary.exportId); // identity fixed outside the retryable callback, same as the ready-branch test above
      const auditRows = await connection`SELECT id FROM audit_logs WHERE record_id = ${summary.exportId}`;
      expect(auditRows).toHaveLength(1);
    }, 20000);
  });

  // MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V2-QA-AND-CORRECTION.md item C: these
  // three cases are Michael's own independent QA (a1-export-preflight-writer-v2-
  // review-inputs/independent-physical-spec.ts, "Michael independent QA" block),
  // incorporated verbatim into this file's existing fixtures/hooks rather than
  // re-derived or duplicated as a separate suite. Audit/commit paths are
  // CLOSED per that QA — reused here to preserve the regression, not reproven
  // from scratch.
  describe("audit and commit failures roll back completely, with no retry attempted (QA V2 item C, Michael independent QA)", () => {
    for (const failure of ["40001", "empty"] as const) {
      it(`a real audit-insert ${failure} failure is wrapped as InternalApprovalAuditFailure and aborts without retry`, async () => {
        const draft = await createEstimateDraftFromCalculator(buildPayload([makeLine()]), ACTOR, TENANT);
        const fault = failure === "40001"
          ? "RAISE EXCEPTION 'independent audit serialization fault' USING ERRCODE='40001';"
          : "RETURN NULL;";
        await connection.unsafe(`CREATE FUNCTION michael_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.table_name='jobtread_exports' AND NEW.new_values->>'estimateDraftId'='${draft.id}' THEN ${fault} END IF;
          RETURN NEW; END $$`);
        await connection.unsafe(`CREATE TRIGGER michael_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION michael_audit_fault()`);
        let observed: any;
        try { await createExportAttempt(attemptInput(draft.id)); } catch (e) { observed = e; }
        finally {
          await connection.unsafe(`DROP TRIGGER michael_audit_fault ON audit_logs`);
          await connection.unsafe(`DROP FUNCTION michael_audit_fault()`);
        }
        expect(observed).toBeDefined();
        expect(observed.constructor.name).toBe("InternalApprovalAuditFailure");
        if (failure === "40001") {
          // Even a REAL 40001 at the audit insert is never retried — `audit()`
          // wraps it into InternalApprovalAuditFailure BEFORE it can reach
          // withInternalApprovalTransaction's 40001/40P01 catch, unlike the
          // lock-contention 40001 tests above (unwrapped at that point).
          const codes: string[] = []; let e = observed.auditCause;
          for (let n = 0; e && n < 5; n++, e = e.cause) if (e.code) codes.push(e.code);
          expect(codes).toContain("40001");
        } else {
          expect(observed.message).toContain("Audit insert returned no row");
        }
        expect(hooks.attempts[2]).toBe(1);
        expect(await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id=${draft.id}`).toHaveLength(0);
        expect(await connection`SELECT id FROM audit_logs WHERE table_name='jobtread_exports' AND new_values->>'estimateDraftId'=${draft.id}`).toHaveLength(0);
      }, 15000);
    }

    it("a real jte_a1_export_final deferred constraint trigger rejects the writer's own insert at COMMIT — no summary, row, or audit escapes", async () => {
      // jte_a1_export_final (DEFERRABLE INITIALLY DEFERRED AFTER INSERT OR
      // UPDATE ON jobtread_exports, drizzle/0013:1017, running
      // jobtread_export_a1_check_final_v1) only re-checks the mirrored version
      // fields against the draft at COMMIT — the fault below changes BOTH
      // mirrored fields together on INSERT, leaving every real CHECK/FK/guard
      // active; only the real deferred trigger catches the divergence.
      const { draft } = await createApprovedDraft();
      await connection.unsafe(`CREATE FUNCTION michael_export_version_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.estimate_draft_id='${draft.id}' THEN
          NEW.estimate_version := NEW.estimate_version + 1;
          NEW.manifest := jsonb_set(NEW.manifest,'{context,estimateVersion}',to_jsonb(NEW.estimate_version));
        END IF; RETURN NEW; END $$`);
      await connection.unsafe(`CREATE TRIGGER michael_export_version_fault BEFORE INSERT ON jobtread_exports FOR EACH ROW EXECUTE FUNCTION michael_export_version_fault()`);
      let observed: any; let returned = false;
      try { await createExportAttempt(attemptInput(draft.id)); returned = true; } catch (e) { observed = e; }
      finally {
        await connection.unsafe(`DROP TRIGGER michael_export_version_fault ON jobtread_exports`);
        await connection.unsafe(`DROP FUNCTION michael_export_version_fault()`);
      }
      const details: any[] = [];
      for (let e = observed, n = 0; e && n < 5; n++, e = e.cause) details.push({ code: e.code, constraint: e.constraint_name, message: e.message });
      expect(returned).toBe(false);
      expect(details.some(e => e.code === "23514" && typeof e.message === "string" && e.message.includes("A1_EXPORT_DRAFT_VERSION_MISMATCH"))).toBe(true);
      expect(hooks.attempts[2]).toBe(1);
      expect(await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id=${draft.id}`).toHaveLength(0);
      expect(await connection`SELECT id FROM audit_logs WHERE table_name='jobtread_exports' AND new_values->>'estimateDraftId'=${draft.id}`).toHaveLength(0);
    }, 15000);
  });

  describe("two genuinely independent concurrent attempts on the same never-decided draft", () => {
    it("neither duplicates nor corrupts the other's evidence — serializes via real row-lock blocking (reported honestly: observed below, never presumed)", async () => {
      // No idempotency key exists on createExportAttempt by contract — two calls
      // are two brand-new attempts, each persisting its OWN row. What matters
      // here is that real contention on the SAME underlying rows never produces
      // duplicate/corrupted evidence, however it happens to resolve.
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
      // Four real transactions ran (two calls x two phases each); report, don't
      // assume, whether any of them genuinely retried under contention.
      const totalAttempts = Object.values(hooks.attempts).reduce((sum, n) => sum + n, 0);
      expect(totalAttempts).toBeGreaterThanOrEqual(4);
    }, 60000);
  });

  // MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V2-QA-AND-CORRECTION.md item C: V2's
  // test ran the verification DO block in ISOLATION, after already restoring
  // the corrected function separately — it demonstrated detection, never that
  // the WHOLE 0014 file (function replace + verification) commits/rolls back
  // ATOMICALLY as one upgrade unit, the way `psql --single-transaction` (the
  // accepted runner's own flag for every migration file) actually runs it.
  // Postgres's simple-query protocol treats multiple statements in ONE message
  // as a single implicit transaction — `connection.unsafe(rawFileText)` below
  // genuinely reproduces that, not `--single-transaction` merely asserted.
  //
  // Ordering is load-bearing: the INCOMPATIBLE test leaves one permanently
  // incompatible row in this disposable cluster (jobtread_exports rows are
  // immutable — it can never be deleted/fixed), which would poison every
  // later run of 0014's table-wide verification query. The COMPATIBLE test
  // must run FIRST, while the table has no such row; this is the LAST describe
  // block in the file, so nothing after it can be affected.
  describe("migration 0014 full-file atomic upgrade from 0013 (QA V2 item C)", () => {
    const OLD_FUNCTION_0013 = `
      CREATE OR REPLACE FUNCTION public.a1_export_issue_status_class_v1(code text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
        SELECT CASE public.a1_export_issue_class_rank_v1(code)
          WHEN 0 THEN 'blocked_authorization'
          WHEN 1 THEN 'blocked_validation'
          WHEN 2 THEN 'blocked_reconciliation'
          ELSE NULL
        END
      $$;
    `;
    const rawMigrationFile = readFileSync(new URL("../drizzle/0014_a1_export_issue_status_class_fix.sql", import.meta.url), "utf8");
    async function probeStatusClass(code: string): Promise<string> {
      const [row] = await connection`SELECT public.a1_export_issue_status_class_v1(${code}) AS status`;
      return row.status;
    }

    it("compatible population: the WHOLE 0014 file commits atomically, the mapping is corrected, and pre-existing unrelated rows are preserved byte-for-byte", async () => {
      await connection.unsafe(OLD_FUNCTION_0013); // simulate "currently at 0013"
      try {
        // Pre-existing rows whose status is UNAFFECTED by the 0013->0014 change
        // (only the one rank-2 discount code differs) — a real ready export and
        // a real blocked_authorization export, created while "at 0013".
        const readyDraft = await createApprovedDraft();
        const readySummary = await createExportAttempt(attemptInput(readyDraft.draft.id));
        const neverDecidedDraft = await createEstimateDraftFromCalculator(buildPayload([makeLine()]), ACTOR, TENANT);
        const blockedSummary = await createExportAttempt(attemptInput(neverDecidedDraft.id));
        expect(readySummary.status).toBe("approved_for_download");
        expect(blockedSummary.status).toBe("blocked_authorization");

        await expect(connection.unsafe(rawMigrationFile)).resolves.not.toThrow();

        expect(await probeStatusClass("EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED")).toBe("needs_exception_review");
        expect(await probeStatusClass("EXPORT_RECONCILIATION_MISMATCH")).toBe("blocked_reconciliation");
        const [readyRow] = await connection`SELECT status FROM jobtread_exports WHERE id = ${readySummary.exportId}`;
        const [blockedRow] = await connection`SELECT status FROM jobtread_exports WHERE id = ${blockedSummary.exportId}`;
        expect(readyRow.status).toBe("approved_for_download");
        expect(blockedRow.status).toBe("blocked_authorization");
      } finally {
        await connection.unsafe(rawMigrationFile); // idempotent — leaves the function correctly on 0014 even if an assertion above threw
      }
    }, 20000);

    it("incompatible population: the WHOLE 0014 file ROLLS BACK atomically — the function definition itself reverts along with the detection, never a partial commit", async () => {
      const csvAttemptInput = (draftId: string) => ({ ...attemptInput(draftId), format: "csv_jobtread" as const });
      const draft = await createEstimateDraftFromCalculator(buildPayload([makeLine()]), ACTOR, TENANT);
      const discountedDraft = await (await import("./estimate-db")).applyEstimateDraftDiscount(draft.id, 10, ACTOR, TENANT);
      const review = await getInternalApprovalReview({ id: discountedDraft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
      await recordInternalEstimateApproval(
        { id: discountedDraft.id, requestId: randomUUID(), expectedDraftVersion: discountedDraft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Concurrency synthetic migration full-file fixture" },
        ACTOR, TENANT,
      );
      const summary = await createExportAttempt(csvAttemptInput(discountedDraft.id));
      expect(summary.status).toBe("needs_exception_review"); // produced under the current (0014) function

      // Simulate "this row was actually written under 0013's defect": revert
      // the function so the CHECK agrees with the OLD status for this one
      // UPDATE (session_replication_role=replica bypasses only the separate
      // immutability TRIGGER — CHECK constraints are never bypassed by it, so
      // ck_jte_a1_all_or_none genuinely re-validates the new value), then
      // leave the function reverted — the scenario IS "currently at 0013,
      // with this legacy-shaped row already present".
      await connection.unsafe(OLD_FUNCTION_0013);
      await connection.begin(async sql => {
        await sql`SET LOCAL session_replication_role = replica`;
        await sql`UPDATE jobtread_exports SET status = 'blocked_reconciliation' WHERE id = ${summary.exportId}`;
      });
      const [legacyRow] = await connection`SELECT status FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(legacyRow.status).toBe("blocked_reconciliation");

      // The WHOLE file (function replace + verification) in ONE statement
      // batch — the DO block raises on the pre-existing incompatible row, and
      // the CREATE OR REPLACE FUNCTION a few lines earlier in the SAME batch
      // must roll back together with it.
      await expect(connection.unsafe(rawMigrationFile)).rejects.toThrow(/migration 0014:.*incompatible/);

      expect(await probeStatusClass("EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED")).toBe("blocked_reconciliation"); // STILL the OLD (0013) mapping — the function replace rolled back too
      const [unchangedRow] = await connection`SELECT status FROM jobtread_exports WHERE id = ${summary.exportId}`;
      expect(unchangedRow.status).toBe("blocked_reconciliation"); // untouched

      // Cleanup: restore JUST the corrected function (not the whole file —
      // its own verification DO block would find this SAME permanent
      // incompatible row and reject again; the row can never be deleted/fixed
      // since jobtread_exports rows are immutable). Harmless either way since
      // nothing else runs after this describe block.
      const [correctedFunctionSql] = rawMigrationFile.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
      await connection.unsafe(correctedFunctionSql);
    }, 20000);
  });
});
