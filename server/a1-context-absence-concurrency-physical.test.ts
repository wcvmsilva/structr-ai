/**
 * Opt-in diagnosis of newly matching policy/history rows on two owned lab sockets.
 * Real A1 context, lineage and adapter are used. A draft note is a synthetic write
 * marker, not an approval: this test does not claim full writer/export coverage.
 * Historical immutable fixtures stay in the disposable cluster until its teardown.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import postgres from "postgres";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../drizzle/schema";
import type { AuthTransaction } from "./auth-transaction";
import { approvalRows } from "./internal-estimate-approval-adapter.fixtures";
import { buildInternalApprovalReviewFromRows } from "./internal-estimate-approval-adapter";

// Public review controls use the same owned lab handle. No environment DB fallback.
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import {
  lockInternalApprovalContext,
  assertInternalApprovalCalculatedLineage,
  getInternalApprovalReview,
} from "./internal-estimate-approval-db";

const configPath = process.env.A1_TRANSACTION_PHYSICAL_CONFIG;
let first: ReturnType<typeof postgres> | undefined;
let second: ReturnType<typeof postgres> | undefined;
let firstDb: PostgresJsDatabase, secondDb: PostgresJsDatabase;
let firstPid: number, secondPid: number;
let f: {
  tenant: string; otherTenant: string; actor: string; client: string; project: string;
  draft: string; zone: string; source: string; sourceLine: string;
};
const waitMs = 4_000;
const marker = "UNSAFE synthetic marker: newly committed context was missed";
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
function outcome<T>(promise: PromiseLike<T>): Promise<Outcome<T>> {
  return Promise.resolve(promise).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(done => { release = done; });
  return { promise, release };
}
function signal<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>(done => { resolveValue = done; });
  return { promise, resolve: resolveValue };
}
async function ready<T>(event: Promise<T>, task: Promise<Outcome<unknown>>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      event,
      task.then(result => { if (!result.ok) throw result.error; throw new Error("Transaction ended before barrier"); }),
      new Promise<never>((_done, reject) => { timer = setTimeout(() => reject(new Error("Context diagnosis barrier timed out")), waitMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
function errorCode(error: unknown): string | undefined {
  for (let i = 0; i < 5 && error && typeof error === "object"; i++) {
    const value = error as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string") return value.code;
    error = value.cause;
  }
  return undefined;
}
async function waitForBlocker(observer: AuthTransaction, waiter = firstPid, blocker = secondPid) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const [row] = await observer.execute<{ blockers: number[] }>(sql`select pg_blocking_pids(${waiter}) as blockers`);
    if (row?.blockers.includes(blocker)) return;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error("Expected actual context INSERT -> A1 project lock edge");
}
function freshReview() {
  return getInternalApprovalReview({ id: f.draft, confirmedCurrencyCode: "USD" }, f.actor, f.tenant);
}
async function insertSettings(tx: AuthTransaction, tenantId = f.tenant) {
  const [row] = await tx.insert(s.tenantSettings).values({ tenantId, profitShieldOverrides: { premium: 80 } }).returning();
  return row;
}
async function appendHistoricalLink(tx: AuthTransaction, draftId: string) {
  const id = randomUUID();
  await tx.insert(s.historicalEstimateImports).values({
    id, tenantId: f.tenant, projectId: f.project, clientId: f.client,
    sourceId: f.source, estimateDraftId: draftId, requestId: randomUUID(), recordedBy: f.actor,
    requestHash: "a".repeat(64), selectionHash: "b".repeat(64), contractVersion: "historical-selection-v1",
    revision: 1, reconciliationState: "unresolved", expectedLineCount: 1,
    reconciliationFindings: { version: "historical-reconciliation-v1", state: "unresolved", sumPriceMinor: null,
      sumCostMinor: null, findings: [{ code: "unknown_currency", field: "currency" }] },
    rawSelectedTotals: { version: "historical-raw-selected-v1", total: null, estimatedCost: null },
  });
  await tx.insert(s.historicalEstimateImportLines).values({
    tenantId: f.tenant, importId: id, sourceId: f.source, sourceLineId: f.sourceLine, position: 0,
  });
  return id;
}
async function evaluateAndMark(tx: AuthTransaction, context: Awaited<ReturnType<typeof lockInternalApprovalContext>>, note = marker) {
  // Identical current-row query to the private buildCurrentReview; only that
  // unexported projection is repeated. Policy/geometry/money evaluation is real.
  const [settings] = await tx.select().from(s.tenantSettings).where(eq(s.tenantSettings.tenantId, f.tenant))
    .orderBy(asc(s.tenantSettings.id)).for("share");
  const [zone] = await tx.select().from(s.geoZones).where(eq(s.geoZones.id, f.zone)).for("share");
  const review = await buildInternalApprovalReviewFromRows({
    draft: context.draft, project: context.project, client: context.client, tenant: context.tenant,
    profile: context.profile, settings: settings ?? null, zone: zone ?? null, scopeDraft: null,
  }, { tenantId: f.tenant, actorId: f.actor, confirmedCurrencyCode: "USD" });
  if (review.evaluation.passed) await tx.update(s.estimateDrafts).set({ notes: note }).where(eq(s.estimateDrafts.id, f.draft));
  return { passed: review.evaluation.passed, settingsVisible: settings?.id ?? null,
    floor: review.evaluation.effectiveFloorPct };
}
async function assertNoUnsafeMarker(result: Outcome<unknown>, detail: Record<string, unknown>) {
  const [draft] = await firstDb.select({ notes: s.estimateDrafts.notes }).from(s.estimateDrafts).where(eq(s.estimateDrafts.id, f.draft));
  const evidence = JSON.stringify({ transaction: result.ok ? result.value : { code: errorCode(result.error) }, ...detail });
  // This assertion is deliberately RED if a restrictive committed context is
  // omitted and the A1 transaction writes. Do not invert it into a bug snapshot.
  expect(draft.notes, `Context absence evidence: ${evidence}`).not.toBe(marker);
  if (!result.ok) expect(["40001", "40P01", "HISTORICAL_AUTHORITY_NOT_AVAILABLE"]).toContain(errorCode(result.error));
}

describe.skipIf(!configPath)("A1 context absence on owned PostgreSQL sockets", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL) throw new Error("Unset DATABASE_URL for context absence diagnosis");
    const config = JSON.parse(await readFile(configPath!, "utf8")) as {
      directory: string; dataDirectory: string; socketDirectory: string; database: string; user: string; port: number;
    };
    const directory = await realpath(config.directory);
    if (!directory.startsWith("/private/tmp/structr-a1-") || directory !== resolve(config.directory)
      || config.database !== "a1_test" || config.user !== "a1_lab"
      || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Not an owned A1 lab");
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory + sep) || !socketDirectory.startsWith(directory + sep)
      || dataDirectory !== resolve(config.dataDirectory) || socketDirectory !== resolve(config.socketDirectory)) throw new Error("Lab paths escape owned directory");
    const options = { host: socketDirectory, database: config.database, username: config.user, port: config.port,
      ssl: false as const, max: 1, prepare: false, connect_timeout: 3 };
    first = postgres(options); second = postgres(options);
    for (const connection of [first, second]) {
      const [identity] = await connection`select current_database() as database,current_user as username,
        current_setting('data_directory') as data_directory,current_setting('unix_socket_directories') as socket_directories,
        current_setting('listen_addresses') as listen_addresses,current_setting('port') as port,inet_server_addr() as server_address`;
      if (identity.database !== config.database || identity.username !== config.user
        || await realpath(identity.data_directory) !== dataDirectory || identity.socket_directories !== socketDirectory
        || identity.listen_addresses !== "" || Number(identity.port) !== config.port || identity.server_address !== null) throw new Error("Physical lab identity mismatch");
      await connection`set statement_timeout='10s'`;
      await connection`set lock_timeout='8s'`;
      await connection`set idle_in_transaction_session_timeout='15s'`;
    }
    // No missing FK / disabled trigger may manufacture this counterexample.
    const fks = await first`select c.conname,c.convalidated,
      exists(select 1 from pg_trigger t where t.tgconstraint=c.oid) as has_triggers,
      not exists(select 1 from pg_trigger t where t.tgconstraint=c.oid and t.tgenabled not in ('O','A')) as enabled
      from pg_constraint c where c.contype='f' and
      ((c.conrelid='public.tenant_settings'::regclass and c.confrelid='public.tenants'::regclass)
       or (c.conrelid='public.historical_estimate_imports'::regclass and c.confrelid in ('public.projects'::regclass,'public.estimate_drafts'::regclass)))`;
    if (fks.length !== 3 || fks.some(row => !row.convalidated || !row.has_triggers || !row.enabled)) throw new Error("Expected all three physical context FKs active");
    const triggers = await first`select tgname,tgenabled,tgdeferrable,tginitdeferred from pg_trigger
      where not tgisinternal and tgname in ('hei_complete_after_insert','heil_complete_after_insert','a1_draft_final')`;
    if (triggers.length !== 3 || triggers.some(row => !["O", "A"].includes(row.tgenabled) || !row.tgdeferrable || !row.tginitdeferred)) throw new Error("Expected historical/A1 deferred checks active");
    if ((await first`show session_replication_role`)[0].session_replication_role !== "origin") throw new Error("Replication trigger bypass forbidden");
    firstPid = Number((await first`select pg_backend_pid() as pid`)[0].pid);
    secondPid = Number((await second`select pg_backend_pid() as pid`)[0].pid);
    if (!firstPid || !secondPid || firstPid === secondPid) throw new Error("Two distinct sessions required");
    firstDb = drizzle(first); secondDb = drizzle(second);
    mocks.getDb.mockImplementation(async () => firstDb);
  }, 20_000);
  afterAll(async () => { await Promise.all([first?.end(), second?.end()]); });
  beforeEach(async () => {
    f = { tenant: randomUUID(), otherTenant: randomUUID(), actor: randomUUID(), client: randomUUID(),
      project: randomUUID(), draft: randomUUID(), zone: randomUUID(), source: randomUUID(), sourceLine: randomUUID() };
    const rows = approvalRows();
    const p = rows.project, z = rows.zone!;
    const snapshot = structuredClone(p.zoneModifierSnapshot) as { zoneId: string; reviewEvidence: { projectId: string; tenantId: string; zoneDetection: { zoneId: string } } };
    snapshot.zoneId = f.zone; snapshot.reviewEvidence.projectId = f.project; snapshot.reviewEvidence.tenantId = f.tenant;
    snapshot.reviewEvidence.zoneDetection.zoneId = f.zone;
    await firstDb.insert(s.tenants).values([
      { id: f.tenant, name: "Synthetic context tenant", slug: "a1-context-" + f.tenant },
      { id: f.otherTenant, name: "Synthetic origin tenant", slug: "a1-context-" + f.otherTenant },
    ]);
    await firstDb.insert(s.profiles).values({ id: f.actor, tenantId: f.tenant, isActive: true, role: "user" });
    await firstDb.insert(s.clients).values({ id: f.client, tenantId: f.tenant, name: "Synthetic context client" });
    await firstDb.insert(s.geoZones).values({ ...z, id: f.zone, tenantId: f.tenant });
    await firstDb.insert(s.projects).values({
      id: f.project, tenantId: f.tenant, clientId: f.client, ownerUserId: f.actor, name: p.name, projectType: "repair",
      channel: p.channel, geoRiskClass: p.geoRiskClass, address: p.address, city: p.city, state: p.state, zip: p.zip,
      county: p.county, latitude: p.latitude, longitude: p.longitude, geocodeConfidence: p.geocodeConfidence,
      geocodeSource: p.geocodeSource, geocodedAddress: p.geocodedAddress, geocodedAt: p.geocodedAt,
      zone: p.zone, zoneModifierSnapshot: snapshot,
    });
    await firstDb.insert(s.estimateDrafts).values({ ...rows.draft, id: f.draft, tenantId: f.tenant,
      projectId: f.project, clientId: f.client, createdBy: f.actor, notes: null });
    await firstDb.transaction(async tx => {
      await tx.insert(s.historicalEstimateSources).values({ id: f.source, tenantId: f.tenant, projectId: f.project,
        clientId: f.client, requestId: randomUUID(), recordedBy: f.actor, requestHash: "c".repeat(64), contentHash: "d".repeat(64),
        contractVersion: "historical-source-v1", sourceKind: "manual_transcription", sourceLabel: "Synthetic context evidence",
        expectedLineCount: 1, rawTotals: { version: "historical-raw-totals-v1", subtotal: null, discount: null, tax: null, total: null, estimatedCost: null } });
      await tx.insert(s.historicalEstimateSourceLines).values({ id: f.sourceLine, tenantId: f.tenant, sourceId: f.source,
        sourceLineKey: "synthetic-row", ordinal: 0, lineHash: "e".repeat(64), rawValues: { version: "historical-raw-line-v1",
          quantity: null, unitPrice: null, unitEstimatedCost: null, linePrice: null, lineEstimatedCost: null, taxable: null, externalCode: null } });
    });
    const review = await freshReview();
    expect(review.evaluation).toMatchObject({ passed: true, effectiveFloorPct: "42", priceMinor: "10000", costMinor: "4000" });
  });

  it("control: a committed strict tenant policy fails the real current review", async () => {
    await firstDb.transaction(tx => insertSettings(tx));
    expect((await freshReview()).evaluation).toMatchObject({ passed: false, effectiveFloorPct: "80" });
  });
  it("control: a committed complete historical link rejects calculated lineage", async () => {
    await firstDb.transaction(tx => appendHistoricalLink(tx, f.draft));
    await expect(freshReview()).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
  });

  it("holds new tenant settings until the current authorized review commits", async () => {
    const release = latch(), locked = signal<AuthTransaction>();
    const decision = outcome(firstDb.transaction(async tx => {
      const context = await lockInternalApprovalContext(tx, f.draft, f.actor, f.tenant, "approve");
      await assertInternalApprovalCalculatedLineage(tx, context);
      const result = await evaluateAndMark(tx, context, "Synthetic review before policy change");
      locked.resolve(tx); await release.promise;
      return result;
    }, { isolationLevel: "serializable" }));
    let writer: Promise<Outcome<unknown>> | undefined;
    try {
      const holder = await ready(locked.promise, decision);
      writer = outcome(secondDb.transaction(tx => insertSettings(tx)));
      await waitForBlocker(holder, secondPid, firstPid);
    } finally { release.release(); await Promise.all([decision, writer]); }
    expect(await decision).toMatchObject({ ok: true, value: { passed: true, floor: "42" } });
    expect(await writer).toMatchObject({ ok: true });
    expect((await freshReview()).evaluation).toMatchObject({ passed: false, effectiveFloorPct: "80" });
  }, 20_000);

  it.each(["INSERT", "rekey"] as const)("policy %s versions the target tenant without changing visible values", async operation => {
    const prior = operation === "rekey" ? await secondDb.transaction(tx => insertSettings(tx, f.otherTenant)) : null;
    const [before] = await first!`select xmin::text as version,to_jsonb(t) as visible from public.tenants t where id=${f.tenant}`;
    await secondDb.transaction(async tx => {
      if (prior) await tx.update(s.tenantSettings).set({ tenantId: f.tenant }).where(eq(s.tenantSettings.id, prior.id));
      else await insertSettings(tx);
    });
    const [after] = await first!`select xmin::text as version,to_jsonb(t) as visible from public.tenants t where id=${f.tenant}`;
    expect(after.visible).toEqual(before.visible);
    expect(after.version).not.toBe(before.version);
  });

  it("rolls back the policy parent version and lets an older valid review continue", async () => {
    const [before] = await first!`select xmin::text as version,to_jsonb(t) as visible from public.tenants t where id=${f.tenant}`;
    const rollback = new Error("Synthetic policy rollback");
    const release = latch(), inserted = signal<void>(), snapshotted = signal<void>(), proceed = latch();
    const writer = outcome(secondDb.transaction(async tx => {
      await insertSettings(tx); inserted.resolve(); await release.promise; throw rollback;
    }));
    let decision: Promise<Outcome<unknown>> | undefined;
    try {
      await ready(inserted.promise, writer);
      decision = outcome(firstDb.transaction(async tx => {
        await tx.select({ id: s.estimateDrafts.id }).from(s.estimateDrafts).where(eq(s.estimateDrafts.id, f.draft));
        snapshotted.resolve(); await proceed.promise;
        const context = await lockInternalApprovalContext(tx, f.draft, f.actor, f.tenant, "approve");
        await assertInternalApprovalCalculatedLineage(tx, context);
        return evaluateAndMark(tx, context, "Synthetic review after policy rollback");
      }, { isolationLevel: "serializable" }));
      await ready(snapshotted.promise, decision); release.release();
      expect(await writer).toEqual({ ok: false, error: rollback });
    } finally { release.release(); proceed.release(); await Promise.all([writer, decision]); }
    expect(await decision).toMatchObject({ ok: true, value: { passed: true, floor: "42" } });
    expect((await first!`select xmin::text as version,to_jsonb(t) as visible from public.tenants t where id=${f.tenant}`)[0]).toEqual(before);
    expect((await first!`select count(*)::int as count from public.tenant_settings where tenant_id=${f.tenant}`)[0].count).toBe(0);
  }, 20_000);

  for (const operation of ["INSERT", "rekey"] as const) {
    it(`does not write from absent settings after restrictive ${operation} commits inside its snapshot`, async () => {
      const previous = operation === "rekey" ? await secondDb.transaction(tx => insertSettings(tx, f.otherTenant)) : null;
      const releaseWriter = latch(), written = signal<void>(), snapshotRead = signal<void>(), proceed = latch();
      const writer = outcome(secondDb.transaction(async tx => {
        if (previous) await tx.update(s.tenantSettings).set({ tenantId: f.tenant }).where(eq(s.tenantSettings.id, previous.id));
        else await insertSettings(tx);
        written.resolve(); await releaseWriter.promise;
      }));
      let decision: Promise<Outcome<unknown>> | undefined;
      try {
        await ready(written.promise, writer);
        decision = outcome(firstDb.transaction(async tx => {
          // Fix the snapshot with the writer's same draft-locator predicate.
          // Releasing the other writer here also supports a future fail-closed
          // parent serialization witness without requiring a timeout to pass.
          await tx.select({ projectId: s.estimateDrafts.projectId }).from(s.estimateDrafts)
            .where(and(eq(s.estimateDrafts.id, f.draft), eq(s.estimateDrafts.tenantId, f.tenant))).limit(1);
          snapshotRead.resolve(); await proceed.promise;
          const context = await lockInternalApprovalContext(tx, f.draft, f.actor, f.tenant, "approve");
          await assertInternalApprovalCalculatedLineage(tx, context);
          return evaluateAndMark(tx, context);
        }, { isolationLevel: "serializable" }));
        await ready(snapshotRead.promise, decision);
        releaseWriter.release();
        expect(await writer).toMatchObject({ ok: true });
      } finally { releaseWriter.release(); proceed.release(); await Promise.all([writer, decision]); }
      if (!decision) throw new Error("A1 transaction never began");
      const fresh = await freshReview();
      expect(fresh.evaluation).toMatchObject({ passed: false, effectiveFloorPct: "80" });
      await assertNoUnsafeMarker(await decision, { operation, freshFloor: fresh.evaluation.effectiveFloorPct });
    }, 20_000);
  }

  for (const target of ["draft", "ancestor"] as const) {
    it(`does not write after waiting behind a complete historical INSERT linked to its ${target}`, async () => {
      let linkedDraft = f.draft;
      if (target === "ancestor") {
        linkedDraft = randomUUID();
        await firstDb.insert(s.estimateDrafts).values({ id: linkedDraft, tenantId: f.tenant, projectId: f.project,
          clientId: f.client, createdBy: f.actor, status: "draft", source: "assembly_calculator", version: 1 });
        await firstDb.update(s.estimateDrafts).set({ source: "version", supersedesId: linkedDraft, version: 2 }).where(eq(s.estimateDrafts.id, f.draft));
      }
      const release = latch(), inserted = signal<AuthTransaction>();
      const writer = outcome(secondDb.transaction(async tx => {
        await appendHistoricalLink(tx, linkedDraft);
        inserted.resolve(tx); await release.promise;
      }));
      let decision: Promise<Outcome<unknown>> | undefined;
      try {
        const inserter = await ready(inserted.promise, writer);
        decision = outcome(firstDb.transaction(async tx => {
          const context = await lockInternalApprovalContext(tx, f.draft, f.actor, f.tenant, "approve");
          await assertInternalApprovalCalculatedLineage(tx, context);
          // Exercise the existing physical A1 lineage function in this same
          // snapshot too. Missing rows must not be assumed caught by 0007.
          await tx.execute(sql`select public.internal_approval_check_lineage_v1(${f.draft}::uuid)`);
          return evaluateAndMark(tx, context);
        }, { isolationLevel: "serializable" }));
        await waitForBlocker(inserter);
      } finally { release.release(); await Promise.all([writer, decision]); }
      expect(await writer).toMatchObject({ ok: true });
      if (!decision) throw new Error("A1 transaction never began");
      await expect(freshReview()).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
      await assertNoUnsafeMarker(await decision, { target });
    }, 20_000);
  }
});
