/** Recorded A1 decisions versus late H1 links, on verified owned sockets only. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { appendFile, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as s from "../drizzle/schema";
import type { AuthTransaction } from "./auth-transaction";
import { approvalRows } from "./internal-estimate-approval-adapter.fixtures";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import {
  getInternalApprovalReview,
  recordInternalEstimateApproval,
  revokeInternalEstimateApproval,
} from "./internal-estimate-approval-db";
import {
  recordHistoricalSource,
  importHistoricalEstimate,
} from "./historical-estimate-db";

const configPath = process.env.A1_TRANSACTION_PHYSICAL_CONFIG;
let first: ReturnType<typeof postgres> | undefined,
  second: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase,
  otherDb: PostgresJsDatabase,
  firstPid: number,
  secondPid: number;
let f: {
  tenant: string;
  actor: string;
  client: string;
  project: string;
  draft: string;
  zone: string;
  source: string;
  sourceLine: string;
};
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const outcome = <T>(promise: PromiseLike<T>): Promise<Outcome<T>> =>
  Promise.resolve(promise).then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error })
  );
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(done => {
    release = done;
  });
  return { promise, release };
}
function signal<T>() {
  let send!: (value: T) => void;
  const promise = new Promise<T>(done => {
    send = done;
  });
  return { promise, send };
}
async function ready<T>(
  event: Promise<T>,
  task: Promise<Outcome<unknown>>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      event,
      task.then(result => {
        if (!result.ok) throw result.error;
        throw new Error("Transaction ended before test barrier");
      }),
      new Promise<never>((_r, reject) => {
        timer = setTimeout(
          () => reject(new Error("Historical ordering barrier timed out")),
          4000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function errorCode(error: unknown): string | undefined {
  for (let i = 0; i < 5 && error && typeof error === "object"; i++) {
    const value = error as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string") return value.code;
    error = value.cause;
  }
  return undefined;
}
async function waitForBlocker(
  observer: AuthTransaction,
  waiter: number,
  blocker: number
) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const [row] = await observer.execute<{ blockers: number[] }>(
      sql`select pg_blocking_pids(${waiter}) as blockers`
    );
    if (row?.blockers.includes(blocker)) return;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error("Expected physical A1/H1 lock edge was not observed");
}
async function projectVersion() {
  return (
    await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`
  )[0];
}
async function appendLink(tx: AuthTransaction, draftId: string) {
  const id = randomUUID();
  await tx
    .insert(s.historicalEstimateImports)
    .values({
      id,
      tenantId: f.tenant,
      projectId: f.project,
      clientId: f.client,
      sourceId: f.source,
      estimateDraftId: draftId,
      requestId: randomUUID(),
      recordedBy: f.actor,
      requestHash: "a".repeat(64),
      selectionHash: "b".repeat(64),
      contractVersion: "historical-selection-v1",
      revision: 1,
      reconciliationState: "unresolved",
      expectedLineCount: 1,
      reconciliationFindings: {
        version: "historical-reconciliation-v1",
        state: "unresolved",
        sumPriceMinor: null,
        sumCostMinor: null,
        findings: [{ code: "unknown_currency", field: "currency" }],
      },
      rawSelectedTotals: {
        version: "historical-raw-selected-v1",
        total: null,
        estimatedCost: null,
      },
    });
  await tx
    .insert(s.historicalEstimateImportLines)
    .values({
      tenantId: f.tenant,
      importId: id,
      sourceId: f.source,
      sourceLineId: f.sourceLine,
      position: 0,
    });
  return id;
}
async function approve() {
  const review = await getInternalApprovalReview(
    { id: f.draft, confirmedCurrencyCode: "USD" },
    f.actor,
    f.tenant
  );
  return recordInternalEstimateApproval(
    {
      id: f.draft,
      requestId: randomUUID(),
      expectedDraftVersion: 1,
      expectedContentHash: review.contentHash,
      expectedPolicyHash: review.policyHash,
      confirmedCurrencyCode: "USD",
      reason: "Synthetic late link decision",
    },
    f.actor,
    f.tenant
  );
}
async function ancestor(edge: "supersedesId" | "changeOrderOf") {
  const id = randomUUID(),
    row = approvalRows().draft;
  await db
    .insert(s.estimateDrafts)
    .values({
      ...row,
      id,
      tenantId: f.tenant,
      projectId: f.project,
      clientId: f.client,
      createdBy: f.actor,
      notes: null,
    });
  await db
    .update(s.estimateDrafts)
    .set({
      source: edge === "supersedesId" ? "version" : "change_order",
      [edge]: id,
    })
    .where(eq(s.estimateDrafts.id, f.draft));
  return id;
}
async function independentImport() {
  return importHistoricalEstimate(
    {
      requestId: randomUUID(),
      sourceId: f.source,
      projectId: f.project,
      clientId: f.client,
      selectedLineIds: [f.sourceLine],
      declaredSelectedTotal: null,
      declaredSelectedEstimatedCost: null,
      rawSelectedTotals: {
        version: "historical-raw-selected-v1",
        total: null,
        estimatedCost: null,
      },
      reportedApprovalAt: null,
      reportedApprovalNote: null,
      priorImportId: null,
      expectedRevision: null,
    },
    f.actor,
    f.tenant
  );
}

describe.skipIf(!configPath)(
  "A1 recorded decisions and historical late linkage",
  () => {
    beforeAll(async () => {
      if (process.env.DATABASE_URL)
        throw new Error("Historical ordering lab refuses DATABASE_URL");
      const config = JSON.parse(await readFile(configPath!, "utf8")) as {
        directory: string;
        dataDirectory: string;
        socketDirectory: string;
        database: string;
        user: string;
        port: number;
      };
      const directory = await realpath(config.directory),
        dataDirectory = await realpath(config.dataDirectory),
        socketDirectory = await realpath(config.socketDirectory);
      if (
        !directory.startsWith("/private/tmp/structr-a1-") ||
        directory !== resolve(config.directory) ||
        config.database !== "a1_test" ||
        config.user !== "a1_lab" ||
        !Number.isInteger(config.port) ||
        config.port < 1 ||
        config.port > 65535 ||
        !dataDirectory.startsWith(directory + sep) ||
        !socketDirectory.startsWith(directory + sep) ||
        dataDirectory !== resolve(config.dataDirectory) ||
        socketDirectory !== resolve(config.socketDirectory)
      )
        throw new Error("Not an owned A1 configuration");
      const options = {
        host: socketDirectory,
        database: config.database,
        username: config.user,
        port: config.port,
        ssl: false as const,
        max: 1,
        prepare: false,
        connect_timeout: 3,
      };
      first = postgres(options);
      second = postgres(options);
      for (const connection of [first, second]) {
        const [identity] =
          await connection`select current_database() as database,current_user as username,current_setting('data_directory') as data_directory,current_setting('unix_socket_directories') as socket_directories,current_setting('listen_addresses') as listen_addresses,current_setting('port') as port,inet_server_addr() as server_address`;
        if (
          identity.database !== config.database ||
          identity.username !== config.user ||
          (await realpath(identity.data_directory)) !== dataDirectory ||
          identity.socket_directories !== socketDirectory ||
          identity.listen_addresses !== "" ||
          Number(identity.port) !== config.port ||
          identity.server_address !== null
        )
          throw new Error("Physical laboratory identity mismatch");
        await connection`set statement_timeout='10s'`;
        await connection`set lock_timeout='8s'`;
        await connection`set idle_in_transaction_session_timeout='15s'`;
      }
      const [fk] =
        await first`select count(*)::int as count from pg_constraint c where c.conrelid='public.historical_estimate_imports'::regclass and c.confrelid in ('public.projects'::regclass,'public.estimate_drafts'::regclass) and c.contype='f' and c.convalidated and exists(select 1 from pg_trigger t where t.tgconstraint=c.oid) and not exists(select 1 from pg_trigger t where t.tgconstraint=c.oid and t.tgenabled not in ('O','A'))`;
      if (
        fk.count !== 2 ||
        (await first`show session_replication_role`)[0]
          .session_replication_role !== "origin"
      )
        throw new Error(
          "Historical project/draft FK protection must remain active"
        );
      const existing =
        await first`select tgname,tgenabled,tgdeferrable,tginitdeferred from pg_trigger where tgname in ('a1_draft_final','a1_snapshot_final','hei_complete_after_insert','heil_complete_after_insert') and not tgisinternal`;
      if (
        existing.length !== 4 ||
        existing.some(
          row =>
            !["O", "A"].includes(row.tgenabled) ||
            !row.tgdeferrable ||
            !row.tginitdeferred
        )
      )
        throw new Error(
          "Existing A1 and H1 deferred guards must remain active"
        );
      firstPid = Number((await first`select pg_backend_pid() as pid`)[0].pid);
      secondPid = Number((await second`select pg_backend_pid() as pid`)[0].pid);
      if (!firstPid || !secondPid || firstPid === secondPid)
        throw new Error("Two separate sessions required");
      db = drizzle(first);
      otherDb = drizzle(second);
      mocks.getDb.mockImplementation(async () => db);
    }, 20000);
    afterAll(async () => {
      vi.restoreAllMocks();
      mocks.getDb.mockReset();
      await Promise.all([first?.end(), second?.end()]);
    });
    beforeEach(async () => {
      f = {
        tenant: randomUUID(),
        actor: randomUUID(),
        client: randomUUID(),
        project: randomUUID(),
        draft: randomUUID(),
        zone: randomUUID(),
        source: "",
        sourceLine: "",
      };
      const rows = approvalRows(),
        p = rows.project,
        z = rows.zone!;
      const snapshot = structuredClone(p.zoneModifierSnapshot) as {
        zoneId: string;
        reviewEvidence: {
          projectId: string;
          tenantId: string;
          zoneDetection: { zoneId: string };
        };
      };
      snapshot.zoneId = f.zone;
      snapshot.reviewEvidence.projectId = f.project;
      snapshot.reviewEvidence.tenantId = f.tenant;
      snapshot.reviewEvidence.zoneDetection.zoneId = f.zone;
      await db
        .insert(s.tenants)
        .values({
          id: f.tenant,
          name: "Synthetic historical ordering",
          slug: "a1-ordering-" + f.tenant,
        });
      await db
        .insert(s.profiles)
        .values({
          id: f.actor,
          tenantId: f.tenant,
          isActive: true,
          role: "user",
        });
      await db
        .insert(s.clients)
        .values({
          id: f.client,
          tenantId: f.tenant,
          name: "Synthetic ordering client",
        });
      await db
        .insert(s.geoZones)
        .values({ ...z, id: f.zone, tenantId: f.tenant });
      await db
        .insert(s.projects)
        .values({
          id: f.project,
          tenantId: f.tenant,
          clientId: f.client,
          ownerUserId: f.actor,
          name: p.name,
          projectType: "repair",
          channel: p.channel,
          geoRiskClass: p.geoRiskClass,
          address: p.address,
          city: p.city,
          state: p.state,
          zip: p.zip,
          county: p.county,
          latitude: p.latitude,
          longitude: p.longitude,
          geocodeConfidence: p.geocodeConfidence,
          geocodeSource: p.geocodeSource,
          geocodedAddress: p.geocodedAddress,
          geocodedAt: p.geocodedAt,
          zone: p.zone,
          zoneModifierSnapshot: snapshot,
        });
      await db
        .insert(s.estimateDrafts)
        .values({
          ...rows.draft,
          id: f.draft,
          tenantId: f.tenant,
          projectId: f.project,
          clientId: f.client,
          createdBy: f.actor,
          notes: null,
        });
      const source = await recordHistoricalSource(
        {
          requestId: randomUUID(),
          projectId: f.project,
          clientId: f.client,
          sourceKind: "manual_transcription",
          sourceLabel: "Synthetic ordering source",
          currencyCode: null,
          sourceFileId: null,
          declaredSubtotal: null,
          declaredDiscount: null,
          declaredTax: null,
          declaredTotal: null,
          declaredEstimatedCost: null,
          commercialTermsText: null,
          rawTotals: {
            version: "historical-raw-totals-v1",
            subtotal: null,
            discount: null,
            tax: null,
            total: null,
            estimatedCost: null,
          },
          lines: [
            {
              sourceLineKey: "row-1",
              ordinal: 0,
              description: "Synthetic unknown original line",
              quantity: null,
              unit: null,
              unitPrice: null,
              unitEstimatedCost: null,
              linePrice: null,
              lineEstimatedCost: null,
              externalCodeSystem: null,
              externalCode: null,
              taxable: null,
              rawValues: {
                version: "historical-raw-line-v1",
                quantity: null,
                unitPrice: null,
                unitEstimatedCost: null,
                linePrice: null,
                lineEstimatedCost: null,
                taxable: null,
                externalCode: null,
              },
            },
          ],
        },
        f.actor,
        f.tenant
      );
      f.source = source.sourceId;
      f.sourceLine = source.lineIds[0].id;
      await appendFile(
        new URL(
          "../tmp/a1-historical-ordering-fixtures.ndjson",
          import.meta.url
        ),
        JSON.stringify(f) + "\n"
      );
    });

    for (const state of ["active", "revoked"] as const)
      for (const targetKind of [
        "draft",
        "supersedesId",
        "changeOrderOf",
      ] as const) {
        it(`rejects an H1 link to the ${targetKind} after a committed ${state} decision`, async () => {
          const target =
            targetKind === "draft" ? f.draft : await ancestor(targetKind);
          const decision = await approve();
          if (state === "revoked")
            await revokeInternalEstimateApproval(
              {
                id: f.draft,
                approvalId: decision.approvalId,
                requestId: randomUUID(),
                expectedContentHash: decision.contentHash,
                reason: "Synthetic revoked decision",
              },
              f.actor,
              f.tenant
            );
          const before = await projectVersion();
          const attempted = await outcome(
            otherDb.transaction(tx => appendLink(tx, target))
          );
          expect(
            attempted.ok,
            `Late historical ${state}/${targetKind} link committed`
          ).toBe(false);
          if (!attempted.ok) expect(errorCode(attempted.error)).toBe("23514");
          expect(
            (
              await first!`select count(*)::int as count from public.historical_estimate_imports where source_id=${f.source}`
            )[0].count
          ).toBe(0);
          expect(
            (
              await first!`select count(*)::int as count from public.historical_estimate_import_lines where source_id=${f.source}`
            )[0].count
          ).toBe(0);
          expect(await projectVersion()).toEqual(before);
        }, 20000);
      }

    it("rejects an older SERIALIZABLE historical transaction waiting behind a newly recorded A1 ancestor decision", async () => {
      const target = await ancestor("supersedesId"),
        oldSnapshot = signal<void>(),
        beginInsert = latch(),
        approvalHeld = signal<AuthTransaction>(),
        releaseApproval = latch();
      const history = outcome(
        otherDb.transaction(
          async tx => {
            await tx.execute(
              sql`select id from public.estimate_drafts where id=${target}`
            );
            oldSnapshot.send();
            await beginInsert.promise;
            return appendLink(tx, target);
          },
          { isolationLevel: "serializable" }
        )
      );
      let decision: Promise<Outcome<unknown>> | undefined;
      const original = db.transaction.bind(db);
      let hooked = false;
      const spy = vi
        .spyOn(db, "transaction")
        .mockImplementation((work, config) =>
          original(async tx => {
            const result = await work(tx);
            // Preview also has a transaction. Hold only the operation that inserted the decision.
            const [row] = await tx
              .select({ id: s.estimateInternalApprovalSnapshots.id })
              .from(s.estimateInternalApprovalSnapshots)
              .where(
                eq(s.estimateInternalApprovalSnapshots.estimateDraftId, f.draft)
              );
            if (row && !hooked) {
              hooked = true;
              approvalHeld.send(tx);
              await releaseApproval.promise;
            }
            return result;
          }, config)
        );
      try {
        await ready(oldSnapshot.promise, history);
        decision = outcome(approve());
        const holder = await ready(approvalHeld.promise, decision);
        beginInsert.release();
        await waitForBlocker(holder, secondPid, firstPid);
      } finally {
        beginInsert.release();
        releaseApproval.release();
        await Promise.all([history, decision]);
        spy.mockRestore();
      }
      expect(await decision).toMatchObject({ ok: true });
      const result = await history;
      expect(
        result.ok,
        "Old H1 snapshot committed a link behind the recorded decision"
      ).toBe(false);
      if (!result.ok) expect(errorCode(result.error)).toBe("40001");
      expect(
        (
          await first!`select count(*)::int as count from public.historical_estimate_imports where source_id=${f.source}`
        )[0].count
      ).toBe(0);
      await expect(
        otherDb.transaction(tx => appendLink(tx, target))
      ).rejects.toBeDefined();
    }, 20000);

    for (const state of ["active", "revoked"] as const)
      it(`allows an independent real H1 import in the same project as a ${state} decision`, async () => {
        const decision = await approve();
        if (state === "revoked")
          await revokeInternalEstimateApproval(
            {
              id: f.draft,
              approvalId: decision.approvalId,
              requestId: randomUUID(),
              expectedContentHash: decision.contentHash,
              reason: "Synthetic decision remains historical",
            },
            f.actor,
            f.tenant
          );
        const before = await projectVersion(),
          imported = await independentImport(),
          after = await projectVersion();
        expect(imported.draftId).not.toBe(f.draft);
        const [historical] = await db
          .select()
          .from(s.estimateDrafts)
          .where(eq(s.estimateDrafts.id, imported.draftId));
        expect(historical).toMatchObject({
          source: "historical_import",
          subtotalCost: null,
          finalTotalPrice: null,
        });
        expect(after.visible).toEqual(before.visible);
        expect(after.version).not.toBe(before.version);
        const [decided] = await db
          .select()
          .from(s.estimateDrafts)
          .where(eq(s.estimateDrafts.id, f.draft));
        expect(decided).toMatchObject({
          subtotalCost: "40.00",
          finalTotalPrice: "100.00",
        });
        expect(
          (
            await first!`select count(*)::int as count from public.audit_logs where record_id=${imported.importId} and action='historical.selection.record'`
          )[0].count
        ).toBe(1);
      }, 20000);

    it("versions the project for a real A1 snapshot without changing any visible project data", async () => {
      const before = await projectVersion();
      await approve();
      const after = await projectVersion();
      expect(after.visible).toEqual(before.visible);
      expect(after.version).not.toBe(before.version);
    });
    it("rolls back the A1 witness with the decision when its enclosing transaction aborts", async () => {
      const before = await projectVersion(),
        abort = new Error("Synthetic enclosing approval rollback"),
        original = db.transaction.bind(db);
      const spy = vi
        .spyOn(db, "transaction")
        .mockImplementation((work, config) =>
          original(async tx => {
            const result = await work(tx);
            const rows = await tx
              .select({ id: s.estimateInternalApprovalSnapshots.id })
              .from(s.estimateInternalApprovalSnapshots)
              .where(
                eq(s.estimateInternalApprovalSnapshots.estimateDraftId, f.draft)
              );
            if (rows.length) throw abort;
            return result;
          }, config)
        );
      try {
        await expect(approve()).rejects.toBe(abort);
      } finally {
        spy.mockRestore();
      }
      expect(await projectVersion()).toEqual(before);
      expect(
        (
          await first!`select count(*)::int as count from public.estimate_internal_approval_snapshots where estimate_draft_id=${f.draft}`
        )[0].count
      ).toBe(0);
      expect(
        (
          await first!`select count(*)::int as count from public.audit_logs where record_id=${f.draft} and action='estimate.internal_approved'`
        )[0].count
      ).toBe(0);
    });
  }
);
