/**
 * G2 override history — owned PostgreSQL evidence.
 *
 * Real: the tRPC router and its middleware, the project access guard, the parent
 * chain, the override engine, the four history helpers and their SQL, running
 * against a disposable cluster this suite creates and stops.
 *
 * Declared boundaries: database acquisition is bound to an owned connection through
 * AsyncLocalStorage; the audit sink and the tenant-wide RBAC fallback are controlled;
 * effective items and the assembly catalog are named resolution inputs. None of them
 * implements ownership — membership, role and parents are real rows.
 *
 * `same-api` cases use only tRPC routes that already exist on the base, so they can
 * fail on the base for a behavioural reason. `candidate-contract` cases exercise the
 * new helper signatures and are GREEN-only evidence.
 */
import { existsSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import {
  geographicOverrides, profiles, projects, projectMembers,
  scopeDrafts, scopeDraftItems, scopeOverrideLog,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import {
  startG2LogPostgres, localForeignKeys, onLogConnection, pause, waitForLockWait,
  type G2PointConnection, type G2PointPostgres, type Pause,
} from "./test-support/g2-override-log-postgres";

const boundary = vi.hoisted(() => ({
  audit: vi.fn(),
  permission: vi.fn(),
  acquisitions: 0,
  fault: "" as "" | "null" | "throw",
  items: [] as Array<Record<string, unknown>>,
  pauses: [] as Pause[],
}));

vi.mock("./db", async () => {
  const { logConnection } = await import("./test-support/g2-override-log-postgres");
  return {
    getDb: async () => {
      boundary.acquisitions++;
      if (boundary.fault === "throw") throw new Error("PRIVATE_SQL_DETAIL");
      if (boundary.fault === "null") return null;
      const connection = logConnection.getStore();
      if (!connection) throw new Error("No owned test connection bound to this execution");
      return connection.db;
    },
  };
});
vi.mock("./audit", () => ({ logAudit: boundary.audit }));
vi.mock("./rbac", () => ({ hasPermission: boundary.permission }));
vi.mock("./scope-review-db", () => ({
  getEffectiveItems: async () => structuredClone(boundary.items),
}));
vi.mock("./assembly-db", () => ({
  listAssemblies: async () => ({
    items: [7, 8].map(n => ({
      id: `a2400000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      name: `Assembly ${n}`, code: `S${n}`, trade: "electrical", category: "electrical",
    })),
    total: 2,
  }),
}));
// Temporal wrapper only: the real reader runs with the real arguments and its rows are
// returned unchanged. Scheduling is controlled; nothing about the result is.
vi.mock("./geo-override-db", async original => {
  const actual = await original<typeof import("./geo-override-db")>();
  return {
    ...actual,
    getOverrideLogForDraft: async (...args: Parameters<typeof actual.getOverrideLogForDraft>) => {
      const scheduled = boundary.pauses.shift();
      const rows = await actual.getOverrideLogForDraft(...args);
      if (scheduled) { scheduled.captured.resolve(); await scheduled.release.promise; }
      return rows;
    },
  };
});
vi.mock("dotenv", () => ({ default: { config: () => ({ parsed: {} }) } }));
vi.mock("postgres", () => ({ default: () => { throw new Error("Unowned PostgreSQL connection refused"); } }));

const id = (n: number) => `a2400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1), B = id(2), USER = id(3), PROJECT = id(4), DRAFT = id(5), OTHER = id(6);
const ORIGINAL = id(7), REPLACEMENT = id(8), RULE = id(9), LOG = id(10);
const VIEWER = id(11), WRITER = id(12), RULE_B = id(13), ITEM = id(14);
const DENIED_MESSAGE = "Override history is unavailable for this draft";

type Role = "admin" | "user";
function context(user = USER, role: Role = "admin", tenantId: string | null = A): TrpcContext {
  return {
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: {
      id: user, tenantId, role, isActive: true, externalOpenId: null, email: null,
      loginMethod: null, fullName: "Synthetic", companyName: null, lastSignedIn: null,
      createdAt: new Date(0), updatedAt: new Date(0),
    },
    tenantId,
    authProvider: "legacy",
  };
}

describe.skipIf(process.env.G2_LOGS_POSTGRES !== "1")("G2 override history — owned PostgreSQL", () => {
  let cluster: G2PointPostgres, application: G2PointConnection, second: G2PointConnection;
  let geo: typeof import("./geo-override-router")["geoOverrideRouter"];
  let helpers: typeof import("./geo-override-db");

  beforeAll(async () => {
    const real = await vi.importActual<{ default: typeof postgres }>("postgres");
    cluster = await startG2LogPostgres(real.default);
    application = await cluster.connect("logs");
    second = await cluster.connect("logs-second");
    expect(new Set([application.pid, second.pid, cluster.observer.pid]).size).toBe(3);
    geo = (await import("./geo-override-router")).geoOverrideRouter;
    helpers = await import("./geo-override-db");
  }, 60_000);

  afterAll(async () => {
    await cluster?.stop();
    if (cluster) expect(existsSync(cluster.directory)).toBe(false);
  }, 20_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    boundary.fault = ""; boundary.acquisitions = 0; boundary.pauses = [];
    boundary.audit.mockResolvedValue({ id: id(99) });
    boundary.permission.mockResolvedValue(false);
    boundary.items = [{ assemblyId: ORIGINAL, quantity: "2", unit: "EA", reason: "scope", confidence: "0.9", sortOrder: 0 }];
    await cluster.observer.sql.unsafe(
      "TRUNCATE profiles, projects, project_members, scope_drafts, scope_draft_items, scope_override_log, geographic_overrides CASCADE",
    );
    await cluster.observer.db.insert(profiles).values([
      { id: USER, tenantId: A, role: "admin" },
      { id: VIEWER, tenantId: A, role: "user" },
      { id: WRITER, tenantId: A, role: "user" },
    ]);
    await cluster.observer.db.insert(projects).values({
      id: PROJECT, tenantId: A, ownerUserId: USER, name: "Synthetic", projectType: "remodel", zone: "coastal",
    });
    await cluster.observer.db.insert(scopeDrafts).values([
      { id: DRAFT, tenantId: A, projectId: PROJECT, status: "approved" },
      { id: OTHER, tenantId: A, projectId: PROJECT, status: "approved" },
    ]);
    await cluster.observer.db.insert(scopeDraftItems).values({
      id: ITEM, scopeDraftId: DRAFT, assemblyId: ORIGINAL, assemblyName: "Assembly 7", quantity: "2", unit: "EA", sortOrder: 0,
    });
    await cluster.observer.db.insert(geographicOverrides).values({
      id: RULE, tenantId: A, zone: "coastal", trade: "electrical",
      originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT, overrideType: "swap",
      reasonTemplate: "Replace {original} with {replacement}", isActive: true,
    });
    application.queries.length = 0; second.queries.length = 0;
  });

  afterEach(async test => {
    if (cluster) {
      console.info("G2_LOG_PROOF " + JSON.stringify({
        name: test.task.name, logs: await rows(), audits: boundary.audit.mock.calls,
        acquisitions: boundary.acquisitions,
        pids: [application.pid, second.pid, cluster.observer.pid],
      }));
    }
    vi.unstubAllEnvs();
  });

  async function rows() {
    return Array.from(await cluster.observer.sql`SELECT * FROM scope_override_log ORDER BY id`);
  }
  async function addLog(draft = DRAFT, log = LOG, overrides: Record<string, unknown> = {}) {
    await cluster.observer.db.insert(scopeOverrideLog).values({
      id: log, scopeDraftId: draft, overrideId: RULE, originalAssemblyId: ORIGINAL,
      replacementAssemblyId: REPLACEMENT, overrideType: "swap", reason: "Rendered historical reason",
      ...overrides,
    });
  }
  function call(connection = application, ctx = context(), draft = DRAFT) {
    const caller = geo.createCaller(ctx);
    const run = <T>(work: () => Promise<T>) => onLogConnection(connection, work);
    return {
      get: () => run(() => caller.getLog({ scopeDraftId: draft })),
      has: () => run(() => caller.hasOverrides({ scopeDraftId: draft })),
      clear: () => run(() => caller.clearLog({ scopeDraftId: draft })),
      resolve: (persistLog = true) => run(() => caller.resolveForDraft({ scopeDraftId: draft, projectZone: "coastal", persistLog })),
    };
  }
  const outcome = <T>(work: Promise<T>) => work.then(value => ({ value, error: null as any }), error => ({ value: null, error }));

  describe("infrastructure", () => {
    it("declares exactly the three local parent/history foreign keys and no other", async () => {
      const keys = await localForeignKeys(cluster);
      expect(keys.map(key => key.replace(/\s+/g, " "))).toEqual([
        "scope_drafts FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE",
        "scope_override_log FOREIGN KEY (override_id) REFERENCES geographic_overrides(id) ON DELETE SET NULL",
        "scope_override_log FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE CASCADE",
      ]);
    });
  });

  describe("same-api", () => {
    for (const strict of ["false", "true"]) {
      for (const mismatch of ["draft-B", "project-NULL", "project-B"] as const) {
        for (const operation of ["get", "has", "clear", "resolve"] as const) {
          it(`${operation} refuses ${mismatch} with strict=${strict} and leaves the history intact`, async () => {
            vi.stubEnv("TENANT_STRICT", strict);
            if (mismatch === "draft-B") await cluster.observer.sql`UPDATE scope_drafts SET tenant_id = ${B}::uuid WHERE id = ${DRAFT}::uuid`;
            else if (mismatch === "project-NULL") await cluster.observer.sql`UPDATE projects SET tenant_id = NULL WHERE id = ${PROJECT}::uuid`;
            else await cluster.observer.sql`UPDATE projects SET tenant_id = ${B}::uuid WHERE id = ${PROJECT}::uuid`;
            await addLog();
            const before = await rows();
            const result = await outcome(call()[operation]() as Promise<unknown>);
            expect.soft(result.error).toMatchObject({ code: "FORBIDDEN" });
            expect.soft(result.value).toBeNull();
            expect.soft(await rows()).toEqual(before);
            expect(boundary.audit).not.toHaveBeenCalled();
          });
        }
      }
    }

    it("resolve persists the real rule provenance and the rendered reason", async () => {
      const result = await call().resolve();
      const saved = await rows();
      expect(result.overrides).toHaveLength(1);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        scope_draft_id: DRAFT, override_id: RULE, original_assembly_id: ORIGINAL,
        replacement_assembly_id: REPLACEMENT, override_type: "swap",
        reason: result.overrides[0].overrideReason,
      });
      expect(String(saved[0].reason)).toContain("Assembly 8");
    });

    it("resolve preserves duplicate occurrences of the same rule without deduplicating", async () => {
      boundary.items = [
        { assemblyId: ORIGINAL, quantity: "2", unit: "EA", reason: "scope", confidence: "0.9", sortOrder: 0 },
        { assemblyId: ORIGINAL, quantity: "3", unit: "EA", reason: "scope", confidence: "0.9", sortOrder: 1 },
      ];
      const result = await call().resolve();
      const saved = await rows();
      expect(result.overrides.filter(o => !o.skippedBecauseAlreadyApplied)).toHaveLength(2);
      expect(saved).toHaveLength(2);
      expect(saved.map(row => row.override_id)).toEqual([RULE, RULE]);
    });

    for (const tenant of [A, null]) {
      it(`own project permits a draft with tenant ${tenant === null ? "NULL" : "A"} and never rewrites it`, async () => {
        await cluster.observer.sql`UPDATE scope_drafts SET tenant_id = ${tenant}::uuid WHERE id = ${DRAFT}::uuid`;
        await addLog();
        expect(await call().get()).toHaveLength(1);
        expect(await call().has()).toBe(true);
        const [draft] = await cluster.observer.sql`SELECT tenant_id FROM scope_drafts WHERE id = ${DRAFT}::uuid`;
        expect(draft.tenant_id).toBe(tenant);
      });
    }

    it("reads only the target draft even when a sibling draft has history", async () => {
      await addLog(DRAFT, LOG);
      await addLog(OTHER, id(20), { reason: "Sibling draft history" });
      const entries = await call().get();
      expect(entries.map(entry => entry.id)).toEqual([LOG]);
      expect(await rows()).toHaveLength(2);
    });

    it("an authorized draft with no history reads empty, then reads newest first", async () => {
      expect(await call().get()).toEqual([]);
      expect(await call().has()).toBe(false);
      await addLog(DRAFT, id(21), { reason: "older", createdAt: new Date("2026-01-01T00:00:00.000Z") });
      await addLog(DRAFT, id(22), { reason: "newer", createdAt: new Date("2026-02-01T00:00:00.000Z") });
      const entries = await call().get();
      expect(entries.map(entry => entry.reason)).toEqual(["newer", "older"]);
      expect(await call().has()).toBe(true);
    });

    it("a deleted project is refused and an unknown draft is not a successful empty read", async () => {
      await addLog();
      await cluster.observer.sql`UPDATE projects SET deleted_at = now() WHERE id = ${PROJECT}::uuid`;
      const deleted = await outcome(call().get());
      expect.soft(deleted.error).toMatchObject({ code: "FORBIDDEN" });
      expect.soft(deleted.value).toBeNull();
      const unknown = await outcome(call(application, context(), id(77)).get());
      expect(unknown.error).toMatchObject({ code: "NOT_FOUND" });
      expect(unknown.value).toBeNull();
      expect(await rows()).toHaveLength(1);
    });

    for (const situation of ["profile-inactive", "profile-tenant-B", "member-without-permission"] as const) {
      it(`refuses a caller whose ${situation} cannot authorize the parent`, async () => {
        await addLog();
        if (situation === "profile-inactive") await cluster.observer.sql`UPDATE profiles SET is_active = false WHERE id = ${USER}::uuid`;
        if (situation === "profile-tenant-B") await cluster.observer.sql`UPDATE profiles SET tenant_id = ${B}::uuid WHERE id = ${USER}::uuid`;
        const ctx = situation === "member-without-permission" ? context(VIEWER, "user") : context();
        if (situation === "member-without-permission") {
          await cluster.observer.db.insert(projectMembers).values({ id: id(30), projectId: PROJECT, userId: VIEWER, projectRole: "viewer", isActive: true });
        }
        const result = await outcome(call(application, ctx).resolve());
        expect.soft(result.error).toMatchObject({ code: "FORBIDDEN" });
        expect(await rows()).toHaveLength(1);
      });
    }

    it("a viewer reads history but cannot resolve, and clearing still requires the admin role", async () => {
      await cluster.observer.db.insert(projectMembers).values({ id: id(31), projectId: PROJECT, userId: VIEWER, projectRole: "viewer", isActive: true });
      await addLog();
      const viewer = call(application, context(VIEWER, "user"));
      expect(await viewer.get()).toHaveLength(1);
      expect((await outcome(viewer.resolve())).error).toMatchObject({ code: "FORBIDDEN" });
      expect((await outcome(viewer.clear())).error).toMatchObject({ code: "FORBIDDEN" });
      expect(await rows()).toHaveLength(1);
    });

    it("a write-only principal resolves without being granted read", async () => {
      // Tenant-wide RBAC is the controlled boundary here: it answers for "project/write"
      // only. Membership and ownership stay real and grant this caller nothing.
      boundary.permission.mockImplementation(async (_user: string, resource: string, action: string) =>
        resource === "project" && action === "write");
      const writer = call(application, context(WRITER, "user"));
      expect((await outcome(writer.get())).error).toMatchObject({ code: "FORBIDDEN" });
      const resolved = await writer.resolve();
      expect(resolved.overrides).toHaveLength(1);
      expect(await rows()).toHaveLength(1);
    });

    for (const situation of ["rule-null", "rule-inactive", "rule-foreign", "rule-deleted"] as const) {
      it(`keeps authorized history readable when the referencing ${situation}`, async () => {
        if (situation === "rule-null") await addLog(DRAFT, LOG, { overrideId: null });
        else if (situation === "rule-foreign") {
          await cluster.observer.db.insert(geographicOverrides).values({
            id: RULE_B, tenantId: B, zone: "coastal", trade: "electrical", originalAssemblyId: ORIGINAL,
            replacementAssemblyId: REPLACEMENT, overrideType: "swap", reasonTemplate: "Foreign", isActive: true,
          });
          await addLog(DRAFT, LOG, { overrideId: RULE_B });
        } else await addLog();
        if (situation === "rule-inactive") await cluster.observer.sql`UPDATE geographic_overrides SET is_active = false WHERE id = ${RULE}::uuid`;
        if (situation === "rule-deleted") await cluster.observer.sql`DELETE FROM geographic_overrides WHERE id = ${RULE}::uuid`;
        const entries = await call().get();
        expect(entries).toHaveLength(1);
        expect(entries[0].reason).toBe("Rendered historical reason");
        if (situation === "rule-deleted") expect(entries[0].overrideId).toBeNull();
        expect(await call().has()).toBe(true);
      });
    }

    it("clear removes only the target draft's history and reports the real count", async () => {
      await addLog(DRAFT, LOG);
      await addLog(DRAFT, id(23), { reason: "second entry" });
      await addLog(OTHER, id(24), { reason: "sibling" });
      expect(await call().clear()).toBe(2);
      expect((await rows()).map(row => row.id)).toEqual([id(24)]);
      expect(boundary.audit).toHaveBeenCalledTimes(1);
      expect(boundary.audit.mock.calls[0][0]).toMatchObject({ action: "geo_override.clear", after: { entriesCleared: 2 } });
    });

    it("clearing an authorized empty history changes nothing and records no mutation", async () => {
      expect(await call().clear()).toBe(0);
      expect(await rows()).toEqual([]);
      expect(boundary.audit).not.toHaveBeenCalled();
    });

    // ── Concurrency through the real resolver and the real clear ──────────────
    // The only thing controlled is WHEN the real reader returns: its arguments and its
    // rows are delegated untouched. Every competing change is made on another owned
    // connection, so the snapshot the resolver captured is genuinely stale.

    it("resolve conflicts when the history changed after the resolver read it", async () => {
      const gate = pause();
      boundary.pauses = [gate];
      const resolving = outcome(call().resolve());
      await gate.captured.promise;
      await addLog(DRAFT, id(25), { reason: "Concurrent entry" });
      gate.release.resolve();
      const result = await resolving;
      expect.soft(result.error).toMatchObject({ code: "CONFLICT" });
      expect.soft((await rows()).map(row => row.id)).toEqual([id(25)]);
      expect(boundary.audit).not.toHaveBeenCalled();
    });

    it("an already-applied resolution still validates, and a clear in the window conflicts", async () => {
      await addLog();
      const gate = pause();
      boundary.pauses = [gate];
      const resolving = outcome(call().resolve());
      await gate.captured.promise;
      await cluster.observer.sql`DELETE FROM scope_override_log WHERE scope_draft_id = ${DRAFT}::uuid`;
      gate.release.resolve();
      const result = await resolving;
      expect.soft(result.error).toMatchObject({ code: "CONFLICT" });
      expect.soft(await rows()).toEqual([]);
      expect(boundary.audit).not.toHaveBeenCalled();
    });

    it("two resolvers that captured the same history produce one confirmed write and one conflict", async () => {
      const first = pause(), next = pause();
      boundary.pauses = [first, next];
      const resolvingFirst = outcome(call(application).resolve());
      await first.captured.promise;
      const resolvingSecond = outcome(call(second).resolve());
      await next.captured.promise;
      first.release.resolve();
      const confirmed = await resolvingFirst;
      next.release.resolve();
      const conflicted = await resolvingSecond;
      expect.soft(confirmed.error).toBeNull();
      expect.soft(conflicted.error).toMatchObject({ code: "CONFLICT" });
      expect((await rows()).length).toBe(1);
    });

    it("a clear that lands before the writer makes the stale resolution conflict instead of recreating history", async () => {
      await addLog(DRAFT, LOG, { originalAssemblyId: id(40), replacementAssemblyId: id(41) });
      const gate = pause();
      boundary.pauses = [gate];
      const resolving = outcome(call(application).resolve());
      await gate.captured.promise;
      expect(await call(second).clear()).toBe(1);
      gate.release.resolve();
      const result = await resolving;
      expect.soft(result.error).toMatchObject({ code: "CONFLICT" });
      expect(await rows()).toEqual([]);
    });

    it("a rule changed after the resolution refuses the whole batch", async () => {
      const gate = pause();
      boundary.pauses = [gate];
      const resolving = outcome(call().resolve());
      await gate.captured.promise;
      await cluster.observer.sql`UPDATE geographic_overrides SET zone = 'inland' WHERE id = ${RULE}::uuid`;
      gate.release.resolve();
      const result = await resolving;
      expect.soft(result.error).toMatchObject({ code: "CONFLICT" });
      expect.soft(await rows()).toEqual([]);
      expect(boundary.audit).not.toHaveBeenCalled();
    });

    it("a confirmed write followed by a clear reports the real number of removed rows", async () => {
      await call().resolve();
      expect(await rows()).toHaveLength(1);
      expect(await call().clear()).toBe(1);
      expect(await rows()).toEqual([]);
    });

    it("audits the history as it stood before the mutation and the rows it confirmed", async () => {
      // A pre-existing entry that the engine does NOT treat as already applied, so the
      // write really happens on top of a non-empty history.
      await addLog(DRAFT, LOG, { originalAssemblyId: id(40), replacementAssemblyId: id(41) });
      const resolved = await call().resolve();
      const events = () => boundary.audit.mock.calls.map(call => call[0]);

      const written = events().find(event => event.action === "geo_override.resolve");
      expect.soft(written.before.entries.map((entry: { id: string }) => entry.id)).toEqual([LOG]);
      expect.soft(written.after.entriesWritten).toBe(1);
      expect.soft(written.after.entries[0]).toMatchObject({
        scopeDraftId: DRAFT, overrideId: RULE, reason: resolved.overrides[0].overrideReason,
      });
      expect.soft(written.after.operatorId).toBe(USER);

      // Captured BEFORE the clear: afterwards the table is empty, so the removed set can
      // only be compared against what was actually there.
      const persisted = (await rows()).map(row => String(row.id)).sort();
      expect(persisted).toHaveLength(2);

      boundary.audit.mockClear();
      expect(await call().clear()).toBe(2);
      const removed = events().find(event => event.action === "geo_override.clear");
      expect.soft(removed.before.entries.map((entry: { id: string }) => entry.id).sort()).toEqual(persisted);
      expect(removed.after).toMatchObject({ entriesCleared: 2, operatorId: USER });
    });

    // ── Audit limits: recorded as limits, never as durability or atomicity ────

    it("an unconfirmed audit (null) does not undo the committed history", async () => {
      boundary.audit.mockResolvedValue(null);
      await call().resolve();
      // The rows are committed. This suite does NOT assert that the audit was persisted.
      expect((await rows())[0]).toMatchObject({ override_id: RULE });
    });

    it("an audit sink that throws after the commit does not roll the history back", async () => {
      boundary.audit.mockRejectedValue(new Error("Synthetic audit sink failure"));
      const result = await outcome(call().resolve());
      expect.soft(result.error).toBeTruthy();
      // The error escapes AFTER the business change committed; it is not a rollback.
      expect((await rows())[0]).toMatchObject({ override_id: RULE });
    });
  });

  describe("candidate-contract", () => {
    const authority = { tenantId: A, userId: USER };
    const own = <T>(work: () => Promise<T>) => onLogConnection(application, work);
    async function snapshot(rule = RULE) {
      const [row] = await cluster.observer.db.select().from(geographicOverrides).where(eq(geographicOverrides.id, rule));
      return row;
    }
    function entry(overrides: Record<string, unknown> = {}) {
      return {
        overrideId: RULE, originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT,
        overrideType: "swap", reason: "Rendered reason", ...overrides,
      } as any;
    }
    async function batch(overrides: Record<string, unknown> = {}) {
      return {
        expectedProjectId: PROJECT, expectedHistory: [], expectedRules: [await snapshot()],
        entries: [entry()], ...overrides,
      } as any;
    }
    const write = (prepared: any, draft = DRAFT) =>
      outcome(own(() => (helpers as any).writeOverrideLogEntries(authority, draft, prepared)));

    for (const invalid of [undefined, null, {}, { tenantId: A }, { tenantId: "", userId: USER }, { tenantId: A, userId: "   " }, { tenantId: 42, userId: USER }]) {
      it(`refuses authority ${JSON.stringify(invalid) ?? "undefined"} before acquiring a database`, async () => {
        boundary.acquisitions = 0;
        const result = await outcome(own(() => (helpers as any).requireScopeOverrideLogAccess(invalid, DRAFT, "read")));
        expect.soft(result.error).toMatchObject({ code: "FORBIDDEN" });
        expect(boundary.acquisitions).toBe(0);
      });
    }

    for (const fault of ["null", "throw"] as const) {
      it(`turns a ${fault} database acquisition into a safe error, never [] / false / 0`, async () => {
        await addLog();
        boundary.fault = fault;
        const read = await outcome(own(() => helpers.getOverrideLogForDraft(authority as any, DRAFT as any, "read" as any)));
        const applied = await outcome(own(() => helpers.hasOverridesApplied(authority as any, DRAFT as any)));
        const cleared = await outcome(own(() => (helpers as any).clearOverrideLogForDraft(authority, DRAFT)));
        boundary.fault = "";
        for (const result of [read, applied, cleared]) {
          expect.soft(result.value).toBeNull();
          expect.soft(result.error).toBeTruthy();
          expect.soft(String(result.error?.message)).not.toContain("PRIVATE_SQL_DETAIL");
          expect.soft(String(result.error?.message)).not.toMatch(/select|insert|delete/i);
        }
        expect(await rows()).toHaveLength(1);
      });
    }

    it("refuses entries that reference a rule of another tenant, an inactive rule or an absent rule", async () => {
      await cluster.observer.db.insert(geographicOverrides).values({
        id: RULE_B, tenantId: B, zone: "coastal", trade: "electrical", originalAssemblyId: ORIGINAL,
        replacementAssemblyId: REPLACEMENT, overrideType: "swap", reasonTemplate: "Foreign rule", isActive: true,
      });
      const foreign = await write(await batch({
        expectedRules: [await snapshot(RULE_B)], entries: [entry({ overrideId: RULE_B })],
      }));
      expect.soft(foreign.error).toBeTruthy();
      expect.soft(foreign.value).toBeNull();

      await cluster.observer.sql`UPDATE geographic_overrides SET is_active = false WHERE id = ${RULE}::uuid`;
      const inactive = await write(await batch());
      expect.soft(inactive.error).toBeTruthy();
      await cluster.observer.sql`UPDATE geographic_overrides SET is_active = true WHERE id = ${RULE}::uuid`;

      const removed = await batch();
      await cluster.observer.sql`DELETE FROM geographic_overrides WHERE id = ${RULE}::uuid`;
      const absent = await write(removed);
      expect.soft(absent.error).toBeTruthy();

      expect(await rows()).toEqual([]);
      expect(boundary.audit).not.toHaveBeenCalled();
    });

    it("refuses an entry whose tuple diverges from the confirmed rule", async () => {
      const diverging = await write(await batch({ entries: [entry({ replacementAssemblyId: id(44) })] }));
      expect.soft(diverging.error).toMatchObject({ code: "CONFLICT" });
      expect(await rows()).toEqual([]);
    });

    for (const [name, malformed] of [
      ["protected id", { id: id(45) }],
      ["protected scopeDraftId", { scopeDraftId: OTHER }],
      ["protected tenantId", { tenantId: B }],
      ["protected createdAt", { createdAt: new Date(0) }],
      ["missing reason", { reason: undefined }],
      ["non-uuid rule", { overrideId: "not-a-uuid" }],
    ] as const) {
      it(`rejects a batch whose entry carries a ${name}`, async () => {
        const broken = entry(malformed as Record<string, unknown>);
        if ("reason" in (malformed as Record<string, unknown>) && (malformed as any).reason === undefined) delete broken.reason;
        const result = await write(await batch({ entries: [broken] }));
        expect.soft(result.error).toMatchObject({ code: "BAD_REQUEST" });
        expect(await rows()).toEqual([]);
      });
    }

    it("rejects a batch whose history snapshot belongs to another draft", async () => {
      await addLog(OTHER, id(46));
      const [foreignRow] = await cluster.observer.sql`SELECT * FROM scope_override_log WHERE id = ${id(46)}::uuid`;
      const result = await write(await batch({
        expectedHistory: [{
          id: foreignRow.id, scopeDraftId: foreignRow.scope_draft_id, overrideId: foreignRow.override_id,
          originalAssemblyId: foreignRow.original_assembly_id, replacementAssemblyId: foreignRow.replacement_assembly_id,
          overrideType: foreignRow.override_type, reason: foreignRow.reason, createdAt: foreignRow.created_at,
        }],
      }));
      expect.soft(result.error).toMatchObject({ code: "BAD_REQUEST" });
      expect((await rows()).map(row => row.id)).toEqual([id(46)]);
    });

    it("an empty batch validates the parents and the history, writes nothing and audits nothing", async () => {
      const accepted = await write(await batch({ entries: [] }));
      expect.soft(accepted.error).toBeNull();
      expect.soft(accepted.value).toBe(0);
      expect.soft(await rows()).toEqual([]);
      expect.soft(boundary.audit).not.toHaveBeenCalled();
      const wrongParent = await write(await batch({ entries: [], expectedProjectId: id(47) }));
      expect(wrongParent.error).toMatchObject({ code: "CONFLICT" });
    });

    it("rolls the whole batch back when an insert is suppressed or altered before it is read back", async () => {
      // Test-local trigger, created and dropped here. It describes exactly one behaviour:
      // suppress the row whose reason is "suppress", and alter the reason of "alter".
      await cluster.observer.sql.unsafe(`
        CREATE FUNCTION log_interference() RETURNS trigger AS $$
        BEGIN
          IF NEW.reason = 'suppress' THEN RETURN NULL; END IF;
          IF NEW.reason = 'alter' THEN NEW.reason := 'silently rewritten'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER log_interference_trigger BEFORE INSERT ON scope_override_log
          FOR EACH ROW EXECUTE FUNCTION log_interference()`);
      try {
        for (const reason of ["suppress", "alter"]) {
          const result = await write(await batch({
            entries: [entry({ reason: "kept" }), entry({ reason })],
          }));
          expect.soft(result.error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
          expect.soft(await rows()).toEqual([]);
        }
        expect(boundary.audit).not.toHaveBeenCalled();
      } finally {
        await cluster.observer.sql.unsafe("DROP TRIGGER log_interference_trigger ON scope_override_log; DROP FUNCTION log_interference()");
      }
    });

    it("verifies inserted rows as a multiset when the stored order differs from the batch order", async () => {
      // The trigger gives the FIRST entry the HIGHEST id, so a readback ordered by id is
      // the reverse of the batch order. Multiplicity and values must still be confirmed.
      await cluster.observer.sql.unsafe(`
        CREATE FUNCTION log_reverse_ids() RETURNS trigger AS $$
        BEGIN
          NEW.id := CASE WHEN NEW.reason = 'first' THEN '${id(49)}'::uuid ELSE '${id(48)}'::uuid END;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER log_reverse_ids_trigger BEFORE INSERT ON scope_override_log
          FOR EACH ROW EXECUTE FUNCTION log_reverse_ids()`);
      try {
        const result = await write(await batch({ entries: [entry({ reason: "first" }), entry({ reason: "second" })] }));
        expect.soft(result.error).toBeNull();
        expect.soft(result.value).toBe(2);
        expect((await rows()).map(row => [row.id, row.reason])).toEqual([[id(48), "second"], [id(49), "first"]]);
      } finally {
        await cluster.observer.sql.unsafe("DROP TRIGGER log_reverse_ids_trigger ON scope_override_log; DROP FUNCTION log_reverse_ids()");
      }
    });

    it("re-validates the parents under the lock when the binding changes after the preflight", async () => {
      // The competing transaction holds an uncommitted change to the project, so the
      // writer's own parent lock must wait for it and then see the new, foreign parent.
      // If the writer never takes that lock, this reports a synchronization failure
      // explicitly — never a silent pass and never an opaque timeout.
      const prepared = await batch();
      const competing = second.sql.begin(async transaction => {
        const tx = transaction as unknown as typeof second.sql;
        await tx`UPDATE projects SET tenant_id = ${B}::uuid WHERE id = ${PROJECT}::uuid`;
        await waitForLockWait(cluster.observer, application.pid, 80);
      });
      const writing = write(prepared);
      const synchronized = await competing.then(() => null, (error: Error) => error);
      const result = await writing;
      expect.soft(synchronized).toBeNull();
      expect.soft(result.error).toMatchObject({ code: "FORBIDDEN" });
      expect(await rows()).toEqual([]);
    }, 20_000);

    it("restores every row when the delete cannot be read back", async () => {
      await addLog(DRAFT, LOG);
      await addLog(DRAFT, id(50), { reason: "kept by the trigger" });
      await cluster.observer.sql.unsafe(`
        CREATE FUNCTION log_block_delete() RETURNS trigger AS $$
        BEGIN
          IF OLD.reason = 'kept by the trigger' THEN RETURN NULL; END IF;
          RETURN OLD;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER log_block_delete_trigger BEFORE DELETE ON scope_override_log
          FOR EACH ROW EXECUTE FUNCTION log_block_delete()`);
      try {
        const result = await outcome(own(() => (helpers as any).clearOverrideLogForDraft(authority, DRAFT)));
        expect.soft(result.error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
        expect.soft((await rows()).map(row => row.id)).toEqual([LOG, id(50)].sort());
        expect(boundary.audit).not.toHaveBeenCalled();
      } finally {
        await cluster.observer.sql.unsafe("DROP TRIGGER log_block_delete_trigger ON scope_override_log; DROP FUNCTION log_block_delete()");
      }
    });
  });
});
