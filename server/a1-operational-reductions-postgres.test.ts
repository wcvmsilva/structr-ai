/** Opt-in physical field, actuals and closeout reductions on the real migration
 * chain in a harness-owned, socket-only disposable PostgreSQL. Only getDb is
 * redirected; ACL, state machine, transaction, event insertion and logAudit are
 * the actual modules. Field, pending-actual and closeout fixtures have null estimate
 * references. The retained paid actual links a synthetic calculated draft only to
 * satisfy the legacy committed-cost constraint. No fixture exercises H1 ancestry
 * rejection or establishes execution authority. The scoped app_runtime checks do
 * not prove production RLS policy completeness or isolation.
 * Enable only with APP_PRINCIPAL_LAB=1 A1_OPERATIONAL_REDUCTIONS_LAB=1. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import { startAppPrincipalPostgres, type AppPrincipalCluster, type AppPrincipalConnection } from "./test-support/app-principal-postgres";
import * as s from "../drizzle/schema";

const io = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
import { updateFieldTask, transitionFieldTask, deleteFieldTask } from "./field-operations-db";
import { transitionActual } from "./actuals-db";
import { updateCloseoutChecklist } from "./closeout-db";

const enabled = process.env.APP_PRINCIPAL_LAB === "1" && process.env.A1_OPERATIONAL_REDUCTIONS_LAB === "1";
const migrations = new URL("../drizzle/", import.meta.url);
const current = new AsyncLocalStorage<PostgresJsDatabase>();

describe.skipIf(!enabled)("A1 retained field reductions — real PostgreSQL and audit", () => {
  let cluster: AppPrincipalCluster;
  let first: AppPrincipalConnection, second: AppPrincipalConnection, blocker: AppPrincipalConnection;
  let tenantId: string, actorId: string, foreignId: string, projectId: string, taskId: string;

  beforeAll(async () => {
    cluster = await startAppPrincipalPostgres(postgres);
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) {
      const chunks = readFileSync(new URL(`${tag}.sql`, migrations), "utf8").split("--> statement-breakpoint").map(chunk => chunk.trim()).filter(Boolean);
      await cluster.observer.sql.begin(async tx => { for (const chunk of chunks) await tx.unsafe(chunk); });
    }
    await cluster.observer.sql.unsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime");
    first = await cluster.connect("operational-first");
    second = await cluster.connect("operational-second");
    blocker = await cluster.connect("operational-blocker");
    io.getDb.mockImplementation(async () => current.getStore() ?? first.db);
  }, 90_000);

  afterAll(async () => {
    if (!cluster) return;
    const directory = cluster.directory;
    await cluster.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("A1_OPERATIONAL_REDUCTIONS_LAB_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 20_000);

  beforeEach(async () => {
    await cluster.observer.sql.unsafe("DROP FUNCTION IF EXISTS a1_field_audit_fault() CASCADE");
    tenantId = randomUUID(); actorId = randomUUID(); foreignId = randomUUID(); projectId = randomUUID(); taskId = randomUUID();
    const foreignTenant = randomUUID();
    await cluster.observer.db.insert(s.tenants).values([
      { id: tenantId, name: "Synthetic field tenant", slug: `field-${tenantId}` },
      { id: foreignTenant, name: "Synthetic other tenant", slug: `other-${foreignTenant}` },
    ]);
    await cluster.observer.db.insert(s.profiles).values([
      { id: actorId, tenantId, role: "user", isActive: true },
      { id: foreignId, tenantId: foreignTenant, role: "admin", isActive: true },
    ]);
    await cluster.observer.db.insert(s.projects).values({ id: projectId, tenantId, ownerUserId: actorId,
      name: "Synthetic existing field project", projectType: "remodel", status: "intake" });
    // Fixture represents existing field records, not an authorized A1 creation path.
    await cluster.observer.db.insert(s.fieldTasks).values({ id: taskId, tenantId, projectId,
      taskType: "other", title: "Synthetic existing task", status: "pending", createdBy: actorId });
  });

  async function task() {
    const [row] = await cluster.observer.db.select().from(s.fieldTasks).where(eq(s.fieldTasks.id, taskId));
    return row;
  }
  async function project() {
    const [row] = await cluster.observer.db.select().from(s.projects).where(eq(s.projects.id, projectId));
    return row;
  }
  const events = () => cluster.observer.db.select().from(s.fieldTaskEvents).where(eq(s.fieldTaskEvents.fieldTaskId, taskId));
  const audits = () => cluster.observer.db.select().from(s.auditLogs).where(eq(s.auditLogs.recordId, taskId));
  const cancel = () => transitionFieldTask({ taskId, userId: actorId, to: "cancelled", blockReason: "Synthetic stop for review" });
  async function snapshot() { return { task: await task(), project: await project(), events: await events(), audits: await audits() }; }

  it("cancels the last task with a real event/audit and leaves project milestones and budget unchanged", async () => {
    const before = await project();
    await cancel();
    expect((await task()).status).toBe("cancelled");
    expect(await events()).toEqual([expect.objectContaining({ fromStatus: "pending", toStatus: "cancelled", tenantId, actorId })]);
    expect(await audits()).toEqual([expect.objectContaining({ action: "field_task.cancelled", userId: actorId,
      oldValues: expect.objectContaining({ status: "pending" }), newValues: expect.objectContaining({ status: "cancelled" }) })]);
    expect(await project()).toEqual(before);
  });

  it("persists a descriptive correction with real before/after audit while preserving operational facts", async () => {
    await updateFieldTask({ taskId, userId: actorId, title: "Corrected task title", notes: "Synthetic site note", photosCount: 2 });
    expect(await task()).toMatchObject({ title: "Corrected task title", notes: "Synthetic site note", photosCount: 2, status: "pending", actualHours: null });
    expect(await audits()).toEqual([expect.objectContaining({ action: "field_task.updated",
      oldValues: expect.objectContaining({ title: "Synthetic existing task" }), newValues: expect.objectContaining({ title: "Corrected task title" }) })]);
    expect(await events()).toEqual([]);
  });

  it("rolls back task and event when a real SQL audit-insert trigger fails", async () => {
    const before = await snapshot();
    await cluster.observer.sql.unsafe(`CREATE FUNCTION a1_field_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic field audit fault' USING ERRCODE='P0001'; END $$`);
    await cluster.observer.sql.unsafe("CREATE TRIGGER a1_field_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION a1_field_audit_fault()");
    await expect(cancel()).rejects.toMatchObject({ cause: { code: "P0001", message: "synthetic field audit fault" } });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a foreign-tenant admin through the real helper before any persisted change", async () => {
    const before = await snapshot();
    await expect(updateFieldTask({ taskId, userId: foreignId, notes: "Must not persist" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses soft delete when real history proves execution despite a pending row", async () => {
    await cluster.observer.db.insert(s.fieldTaskEvents).values({ id: randomUUID(), tenantId, projectId, fieldTaskId: taskId,
      fromStatus: "assigned", toStatus: "in_progress", actorId, reason: "Existing execution record" });
    const before = await snapshot();
    await expect(deleteFieldTask(taskId, actorId)).rejects.toMatchObject({ code: "INVALID_TASK_TRANSITION" });
    expect(await snapshot()).toEqual(before);
  });

  it("soft deletes unstarted work without removing its assignment history, and audits durably", async () => {
    await cluster.observer.db.insert(s.fieldTaskEvents).values({ id: randomUUID(), tenantId, projectId, fieldTaskId: taskId,
      fromStatus: "pending", toStatus: "assigned", actorId, reason: "Existing assignment record" });
    const beforeEvents = await events();
    expect(await deleteFieldTask(taskId, actorId)).toBe(true);
    expect((await task()).deletedAt).toBeInstanceOf(Date);
    expect(await events()).toEqual(beforeEvents);
    expect(await audits()).toEqual([expect.objectContaining({ action: "field_task.deleted", oldValues: expect.objectContaining({ deletedAt: null }) })]);
  });

  it("serializes concurrent cancellations after observed project lock waits and commits one event/audit", async () => {
    await blocker.sql.unsafe("BEGIN");
    await blocker.sql.unsafe("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [projectId]);
    let results: PromiseSettledResult<unknown>[];
    const one = current.run(first.db, cancel);
    const two = current.run(second.db, cancel);
    const finished = Promise.allSettled([one, two]);
    try {
      const deadline = Date.now() + 2500;
      let observedBoth = false;
      type LockObservation = {
        pid: number; state: string; wait_event_type: string | null;
        wait_event: string | null; query: string; blocking_pids: number[];
      };
      let observations: LockObservation[] = [];
      const ownedPids = new Set([first.pid, second.pid, blocker.pid]);
      while (Date.now() < deadline) {
        observations = await cluster.observer.sql<LockObservation[]>`
          SELECT pid, state, wait_event_type, wait_event, query, pg_blocking_pids(pid) AS blocking_pids
          FROM pg_stat_activity WHERE pid IN (${first.pid}, ${second.pid}, ${blocker.pid})`;
        const byPid = new Map(observations.map(row => [row.pid, row]));
        // PostgreSQL can queue the second writer on the first writer's tuple lock.
        // Both active project-lock waits must lead only through our three sessions
        // to the held blocker; unrelated waits, missing sessions and cycles fail.
        const waitsForBlocker = (pid: number, visited = new Set<number>()): boolean => {
          if (pid === blocker.pid) return true;
          if (!ownedPids.has(pid) || visited.has(pid)) return false;
          const row = byPid.get(pid);
          if (!row || row.state !== "active" || row.wait_event_type !== "Lock"
            || !/from\s+"?projects"?\s/i.test(row.query) || !/for\s+update\b/i.test(row.query)
            || row.blocking_pids.length === 0) return false;
          const path = new Set([...visited, pid]);
          return row.blocking_pids.every(waitingOn => ownedPids.has(waitingOn) && waitsForBlocker(waitingOn, path));
        };
        const held = byPid.get(blocker.pid);
        observedBoth = ownedPids.size === 3 && held?.state === "idle in transaction"
          && held.blocking_pids.length === 0 && waitsForBlocker(first.pid) && waitsForBlocker(second.pid);
        if (observedBoth) break;
        await delay(15);
      }
      expect(observedBoth, JSON.stringify({ ownedPids: [...ownedPids], observations })).toBe(true);
      await blocker.sql.unsafe("COMMIT");
      results = await finished;
    } finally {
      await blocker.sql.unsafe("ROLLBACK").catch(() => undefined);
      await finished;
    }
    expect(results!.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results!.filter(result => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    // Drizzle wraps query errors in cause; a commit-time serialization error is direct.
    expect(rejected[0].reason?.cause ?? rejected[0].reason).toMatchObject({ code: "40001" });
    expect((await task()).status).toBe("cancelled");
    expect(await events()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
    expect((await project()).fieldCompletedAt).toBeNull();
  }, 12_000);

  async function ledgerFixture() {
    const actualId = randomUUID(), retainedId = randomUUID(), legacyDraftId = randomUUID();
    // Existing paid ledger facts require a persisted reference under migration 0003.
    // This calculated draft has no approval evidence and supplies no execution authority.
    await cluster.observer.db.insert(s.estimateDrafts).values({ id: legacyDraftId, tenantId, projectId,
      source: "assembly_calculator", status: "draft", createdBy: actorId });
    await cluster.observer.db.insert(s.projectCostActuals).values([
      { id: actualId, tenantId, projectId, status: "pending", amountCents: 12500, dateIncurred: "2026-10-06",
        costCode: "SYNTHETIC-01", vendorName: "Synthetic ledger vendor", budgetEstimateDraftId: null },
      { id: retainedId, tenantId, projectId, status: "paid", amountCents: 30000, dateIncurred: "2026-10-06",
        costCode: "SYNTHETIC-01", vendorName: "Synthetic ledger vendor", budgetEstimateDraftId: legacyDraftId },
    ]);
    const ledger = () => cluster.observer.db.select().from(s.projectCostActuals).where(eq(s.projectCostActuals.projectId, projectId)).orderBy(s.projectCostActuals.id);
    const evidence = () => cluster.observer.db.select().from(s.auditLogs).where(inArray(s.auditLogs.recordId, [actualId, projectId]));
    const reject = () => transitionActual({ actualId, userId: actorId, tenantId, to: "rejected", reason: "Incorrect source entry" });
    return { actualId, retainedId, ledger, evidence, reject };
  }

  async function faultAudit(action: "project.actuals_refreshed" | "closeout.checklist_updated") {
    // The action comes only from this fixed test union; no request/production input.
    await cluster.observer.sql.unsafe(`CREATE FUNCTION a1_field_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'synthetic reduction audit fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`);
    await cluster.observer.sql.unsafe("CREATE TRIGGER a1_field_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION a1_field_audit_fault()");
  }

  it("rejects an existing actual with real ledger refresh and both audits, without manufacturing variance", async () => {
    const f = await ledgerFixture();
    const retained = (await f.ledger()).find(row => row.id === f.retainedId);
    await f.reject();
    expect((await f.ledger()).find(row => row.id === f.actualId)).toMatchObject({ status: "rejected", amountCents: 12500, rejectionReason: "Incorrect source entry" });
    expect((await f.ledger()).find(row => row.id === f.retainedId)).toEqual(retained);
    expect(await project()).toMatchObject({ committedCostCents: 30000, actualTotal: "300.00", variancePct: null });
    const audit = await f.evidence();
    expect(audit).toHaveLength(2);
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "actual.rejected", recordId: f.actualId }),
      expect.objectContaining({ action: "project.actuals_refreshed", recordId: projectId }),
    ]));
  });

  it("rolls back actual, refreshed project and first audit when refresh audit SQL fails", async () => {
    const f = await ledgerFixture();
    const before = { ledger: await f.ledger(), project: await project(), audits: await f.evidence() };
    await faultAudit("project.actuals_refreshed");
    await expect(f.reject()).rejects.toMatchObject({ cause: { code: "P0001", message: "synthetic reduction audit fault" } });
    expect({ ledger: await f.ledger(), project: await project(), audits: await f.evidence() }).toEqual(before);
  });

  async function closeoutFixture() {
    const closeoutId = randomUUID();
    await cluster.observer.db.insert(s.projectCloseouts).values({ id: closeoutId, tenantId, projectId, status: "open", budgetEstimateDraftId: null });
    const read = async () => (await cluster.observer.db.select().from(s.projectCloseouts).where(eq(s.projectCloseouts.id, closeoutId)))[0];
    const evidence = () => cluster.observer.db.select().from(s.auditLogs).where(eq(s.auditLogs.recordId, closeoutId));
    const update = () => updateCloseoutChecklist({ closeoutId, userId: actorId, tenantId, finalInspectionPassed: true, notes: "Factual observation" });
    return { closeoutId, read, evidence, update };
  }

  it("records factual checklist evidence with real audit without promoting closeout or project status", async () => {
    const f = await closeoutFixture();
    const beforeProject = await project();
    await f.update();
    expect(await f.read()).toMatchObject({ status: "open", finalInspectionPassed: true, notes: "Factual observation", readyAt: null, closedAt: null });
    expect(await f.evidence()).toEqual([expect.objectContaining({ action: "closeout.checklist_updated", recordId: f.closeoutId,
      oldValues: expect.objectContaining({ finalInspectionPassed: false }), newValues: expect.objectContaining({ finalInspectionPassed: true }) })]);
    expect(await project()).toEqual(beforeProject);
  });

  it("rolls back factual checklist changes when their real audit insert fails", async () => {
    const f = await closeoutFixture();
    const before = { closeout: await f.read(), project: await project(), audits: await f.evidence() };
    await faultAudit("closeout.checklist_updated");
    await expect(f.update()).rejects.toMatchObject({ cause: { code: "P0001", message: "synthetic reduction audit fault" } });
    expect({ closeout: await f.read(), project: await project(), audits: await f.evidence() }).toEqual(before);
  });

});
