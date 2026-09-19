import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { projects, type Project } from "../drizzle/schema";
import type { ZoneModifierSnapshot } from "../shared/geo-engine";
import type { AuditLogParams } from "./audit";
import type { GeocodeResult } from "./geo-geocoding";
import { gate, instrumentF5bDatabase, observeF5bBlocking, startF5bPostgres, type F5bPostgres } from "./test-support/f5b-postgres";

const boundary = vi.hoisted(() => ({
  getDb: undefined as undefined | (() => unknown),
  audit: undefined as undefined | ((params: unknown) => Promise<unknown>),
}));
// Only the application connection entry point and audit sink are substituted.
// Both production mutation helpers and every Drizzle/SQL operation remain real.
vi.mock("./db", () => ({ getDb: () => boundary.getDb?.() }));
vi.mock("./audit", () => ({ logAudit: (params: unknown) => boundary.audit?.(params) }));
vi.mock("./geo-geocoding", () => ({
  geocodeAddress: () => { throw new Error("F5b persistence tests must never call an external geocoder"); },
}));

import { assignZoneToProject } from "./geo-db";
import { persistGeocodeResult } from "./geo-integration";

const firstUser = "a0000000-0000-4000-8000-000000000001";
const secondUser = "a0000000-0000-4000-8000-000000000002";
const initialSnapshot: ZoneModifierSnapshot = {
  zoneId: "b0000000-0000-4000-8000-000000000001", zoneName: "Initial synthetic zone",
  laborModifier: 1, logisticsModifier: 1, materialModifier: 1,
  contingencyPct: 0.05, minProfitShieldPct: 0.35, coastalExposureLevel: "none",
  capturedAt: "2026-01-01T00:00:00.000Z",
};
const firstSnapshot: ZoneModifierSnapshot = {
  zoneId: "b0000000-0000-4000-8000-000000000002", zoneName: "First synthetic zone",
  laborModifier: 1.1, logisticsModifier: 1.2, materialModifier: 1.3,
  contingencyPct: 0.07, minProfitShieldPct: 0.42, coastalExposureLevel: "moderate",
  capturedAt: "2026-02-01T00:00:00.000Z",
};
const secondSnapshot: ZoneModifierSnapshot = {
  zoneId: "b0000000-0000-4000-8000-000000000003", zoneName: "Second synthetic zone",
  laborModifier: 1.2, logisticsModifier: 1.3, materialModifier: 1.4,
  contingencyPct: 0.09, minProfitShieldPct: 0.5, coastalExposureLevel: "high",
  capturedAt: "2026-03-01T00:00:00.000Z",
};
const geocode: GeocodeResult = {
  success: true, latitude: 32.5, longitude: -80.25,
  formattedAddress: "123 Synthetic Test Avenue, Fixture City, SC",
  confidence: "high", source: "manual", locationType: "ROOFTOP", placeId: null,
  distanceFromCenter: 2, withinServiceRadius: true, warning: null, addressComponents: null,
};

type Mutation = "assign" | "persist";
type Outcome = { ok: true; value: boolean } | { ok: false; error: unknown };
const outcome = (promise: Promise<boolean>): Promise<Outcome> => promise.then(
  value => ({ ok: true, value }), error => ({ ok: false, error }),
);

describe.skipIf(process.env.F5B_POSTGRES !== "1")("F5b project geo — disposable real PostgreSQL", () => {
  let cluster: F5bPostgres;
  let projectId: string;
  const context = new AsyncLocalStorage<PostgresJsDatabase>();
  const audits: Array<{ params: AuditLogParams; committed: Project | undefined }> = [];

  beforeAll(async () => {
    // No process, directory, connection, or external configuration is touched unless
    // F5B_POSTGRES=1. Missing binaries/setup are failures in enabled mode, never skips.
    cluster = await startF5bPostgres();
    boundary.getDb = () => {
      const handle = context.getStore();
      if (!handle) throw new Error("F5b helper escaped its explicitly assigned connection");
      return handle;
    };
    boundary.audit = async unknownParams => {
      const params = unknownParams as AuditLogParams;
      const [committed] = await cluster.observer.db.select().from(projects)
        .where(eq(projects.id, params.recordId!)).limit(1);
      audits.push({ params: structuredClone(params), committed });
      return null;
    };
  }, 60_000);

  afterAll(async () => {
    if (cluster) {
      const directory = cluster.directory;
      await cluster.stop();
      expect(existsSync(directory), "owned PostgreSQL directory is removed after shutdown").toBe(false);
      console.info("F5b PostgreSQL cleanup: owned server stopped; data and socket directory removed.");
    }
    boundary.getDb = undefined;
    boundary.audit = undefined;
  }, 20_000);

  beforeEach(async () => {
    audits.length = 0;
    await cluster.observer.sql.unsafe("DROP TRIGGER IF EXISTS f5b_mutate ON projects");
    await cluster.observer.sql.unsafe("DROP FUNCTION IF EXISTS f5b_mutate()");
    await cluster.observer.sql.unsafe("TRUNCATE TABLE projects");
    await cluster.first.sql.unsafe("SET TIME ZONE 'UTC'");
    projectId = randomUUID();
    await cluster.observer.db.insert(projects).values({
      id: projectId, tenantId: "c0000000-0000-4000-8000-000000000001",
      name: "Disposable F5b fixture", projectType: "remodel", status: "estimate",
      zone: "Initial synthetic zone", zoneModifierSnapshot: initialSnapshot,
      latitude: "30.125", longitude: "-79.25", geocodeConfidence: "low",
      geocodeSource: "manual", geocodedAddress: "Old synthetic address",
      geocodedAt: new Date("2026-01-01T01:02:03.456Z"),
      updatedBy: null, createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  const readProject = async () => (await cluster.observer.db.select().from(projects)
    .where(eq(projects.id, projectId)).limit(1))[0];

  function mutate(kind: Mutation, db: PostgresJsDatabase, which: "first" | "second" = "first") {
    const snapshot = which === "first" ? firstSnapshot : secondSnapshot;
    const userId = which === "first" ? firstUser : secondUser;
    return context.run(db, () => kind === "assign"
      ? assignZoneToProject(projectId, snapshot, userId)
      : persistGeocodeResult({
          projectId, geocode: which === "first" ? geocode : { ...geocode, latitude: 33.125, longitude: -81.5 },
          userId, zoneSnapshot: snapshot,
        }));
  }

  const orders: Array<[string, Mutation, Mutation]> = [
    ["P01 assign → assign", "assign", "assign"],
    ["P02 persist → persist", "persist", "persist"],
    ["P03 assign → persist", "assign", "persist"],
    ["P04 persist → assign", "persist", "assign"],
  ];
  it.each(orders)("%s: second writer blocks and audits the first committed before-state", async (_label, firstKind, secondKind) => {
    const firstRead = gate();
    const releaseFirst = gate();
    const secondStarted = gate();
    const releaseSecond = gate();
    let secondRead = false;
    let secondSettled = false;
    const first = instrumentF5bDatabase(cluster.first.db, {
      afterSelect: async (_handle, state) => {
        if (state.selects === 1) { firstRead.open(); await releaseFirst.promise; }
      },
    });
    const second = instrumentF5bDatabase(cluster.second.db, {
      beforeSelect: async (_handle, state) => { if (state.selects === 1) secondStarted.open(); },
      afterSelect: async (_handle, state) => {
        if (state.selects === 1) { secondRead = true; await releaseSecond.promise; }
      },
    });
    const firstResult = outcome(mutate(firstKind, first.db));
    let secondResult: Promise<Outcome> | undefined;
    let blockerPids: number[] = [];
    let firstValue: Outcome | undefined;
    let secondValue: Outcome | undefined;
    try {
      await Promise.race([firstRead.promise, firstResult.then(result => {
        throw new Error(`First helper completed before its before-read: ${JSON.stringify(result)}`);
      })]);
      secondResult = outcome(mutate(secondKind, second.db, "second"));
      void secondResult.then(() => { secondSettled = true; });
      await Promise.race([secondStarted.promise, secondResult.then(result => {
        throw new Error(`Second helper completed before its before-read: ${JSON.stringify(result)}`);
      })]);
      blockerPids = await observeF5bBlocking(cluster.observer, cluster.first.pid, cluster.second.pid,
        () => secondRead || secondSettled);
      releaseFirst.open();
      firstValue = await firstResult;
      // Let the first helper's post-commit audit run before the second write begins.
      releaseSecond.open();
      secondValue = await secondResult;
    } finally {
      releaseFirst.open();
      releaseSecond.open();
      await Promise.allSettled([firstResult, ...(secondResult ? [secondResult] : [])]);
    }

    expect(blockerPids, "pg_blocking_pids must identify the first writer as the second reader's blocker").toContain(cluster.first.pid);
    expect(firstValue).toEqual({ ok: true, value: true });
    expect(secondValue).toEqual({ ok: true, value: true });
    expect(first.state.transactions).toBe(1);
    expect(second.state.transactions).toBe(1);
    const secondAudit = audits.find(entry => entry.params.userId === secondUser &&
      entry.params.action === (secondKind === "assign" ? "project.assign_zone" : "project.geocode_resolved"));
    expect(secondAudit?.params.before).toMatchObject({ zone: "First synthetic zone" });
    if (secondKind === "assign") {
      expect(secondAudit?.params.before).toMatchObject({ zoneModifierSnapshot: firstSnapshot });
    } else {
      expect(secondAudit?.params.before).toMatchObject({
        latitude: firstKind === "persist" ? "32.5" : "30.125",
        longitude: firstKind === "persist" ? "-80.25" : "-79.25",
        geocodeConfidence: firstKind === "persist" ? "high" : "low",
      });
    }
    const firstAudits = audits.filter(entry => entry.params.userId === firstUser);
    expect(firstAudits).toHaveLength(firstKind === "assign" ? 1 : 2);
    expect(firstAudits.every(entry => entry.committed?.zone === "First synthetic zone")).toBe(true);
    if (secondKind === "persist") {
      expect(audits.find(entry => entry.params.userId === secondUser &&
        entry.params.action === "project.zone_changed")?.params.before).toEqual({
        zone: "First synthetic zone", zoneModifierSnapshot: firstSnapshot,
      });
    }
    expect(secondAudit?.committed?.zone).toBe("Second synthetic zone");
    expect(await readProject()).toMatchObject({ zone: "Second synthetic zone", zoneModifierSnapshot: secondSnapshot });
  }, 12_000);

  it.each<[string, Mutation]>([["P05", "assign"], ["P06", "persist"]])(
    "%s %s: real UPDATE followed by a readback SQL error rolls back and emits no audit", async (_label, kind) => {
      const original = await readProject();
      let sawReadback = false;
      const observed = instrumentF5bDatabase(cluster.first.db, {
        beforeSelect: async (handle, state) => {
          if (state.updates > 0) {
            sawReadback = true;
            // Fail on the same real connection after UPDATE, at readback execution.
            await handle.execute(sql`SELECT 1 / 0`);
          }
        },
      });
      const result = await outcome(mutate(kind, observed.db));
      expect(observed.state.updates, "the UPDATE must have executed before the injected read failure").toBe(1);
      expect(sawReadback, "the helper must perform a readback after its UPDATE").toBe(true);
      expect(result.ok).toBe(false);
      expect(await readProject()).toEqual(original);
      expect(audits).toEqual([]);
    },
  );

  it("P07: numeric storage scale differences are accepted as the same persisted coordinates", async () => {
    await cluster.observer.sql.unsafe(`CREATE FUNCTION f5b_mutate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.latitude := NEW.latitude::numeric(12,6); NEW.longitude := NEW.longitude::numeric(12,6); RETURN NEW; END $$`);
    await cluster.observer.sql.unsafe("CREATE TRIGGER f5b_mutate BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION f5b_mutate()");
    expect(await mutate("persist", cluster.first.db)).toBe(true);
    const row = await readProject();
    expect(row.latitude).toBe("32.500000");
    expect(row.longitude).toBe("-80.250000");
    expect(row.zone).toBe("First synthetic zone");
    expect(audits.map(entry => entry.params.action)).toEqual(["project.geocode_resolved", "project.zone_changed"]);
  });

  it("P08: jsonb's reordered snapshot keys pass readback and commit", async () => {
    expect(await mutate("assign", cluster.first.db)).toBe(true);
    const row = await readProject();
    expect(JSON.stringify(row.zoneModifierSnapshot)).not.toBe(JSON.stringify(firstSnapshot));
    expect(row.zoneModifierSnapshot).toEqual(firstSnapshot);
    expect(row.zone).toBe("First synthetic zone");
    expect(audits).toHaveLength(1);
    expect(audits[0].committed?.zoneModifierSnapshot).toEqual(firstSnapshot);
  });

  it("P09: an equivalent timestamp rendered with a different offset passes readback and commits", async () => {
    await cluster.first.sql.unsafe("SET TIME ZONE 'America/New_York'");
    const startedAt = Date.now();
    expect(await mutate("persist", cluster.first.db)).toBe(true);
    const [stored] = await cluster.first.sql<{ rendered: string }[]>`
      SELECT geocoded_at::text AS rendered FROM projects WHERE id = ${projectId}`;
    const row = await readProject();
    expect(stored.rendered).toMatch(/-0[45]$/);
    expect(stored.rendered).not.toBe(row.geocodedAt!.toISOString());
    expect(new Date(stored.rendered).getTime()).toBe(row.geocodedAt!.getTime());
    expect(row.geocodedAt!.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(row.geocodedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(audits.map(entry => entry.params.action)).toEqual(["project.geocode_resolved", "project.zone_changed"]);
  });

  it.each<[string, Mutation, string]>([
    ["P10", "assign", "NEW.zone := 'Divergent trigger zone';"],
    ["P11", "persist", "NEW.longitude := NEW.longitude + 1;"],
  ])("%s %s: a trigger's divergent stored value is rejected and rolled back", async (_label, kind, mutation) => {
    const original = await readProject();
    await cluster.observer.sql.unsafe(`CREATE FUNCTION f5b_mutate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN ${mutation} RETURN NEW; END $$`);
    await cluster.observer.sql.unsafe("CREATE TRIGGER f5b_mutate BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION f5b_mutate()");
    let actualAfterUpdate: Project | undefined;
    const observed = instrumentF5bDatabase(cluster.first.db, {
      afterUpdate: async handle => {
        [actualAfterUpdate] = await handle.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      },
    });
    const result = await outcome(mutate(kind, observed.db));
    expect(observed.state.updates).toBe(1);
    expect(actualAfterUpdate).toMatchObject(kind === "assign"
      ? { zone: "Divergent trigger zone" } : { longitude: "-79.25" });
    expect(result.ok, "the helper must reject a row whose stored values differ from its write intent").toBe(false);
    expect(await readProject()).toEqual(original);
    expect(audits).toEqual([]);
  });
});
