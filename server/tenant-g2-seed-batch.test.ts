/**
 * Real seed endpoint + real persistence helpers. Only acquisition, audit and seed
 * data are replaced. The model publishes a transaction snapshot on successful
 * commit only; it is not evidence of PostgreSQL, FK, RLS or catalog behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { geographicOverrides, type GeographicOverride } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn() }));
const seed = vi.hoisted(() => ({
  rules: [1, 2].map(number => ({
    zone: "Charleston Coastal", trade: "electrical", finishLevel: null,
    originalAssemblyId: "e2600000-0000-4000-8000-000000000001",
    replacementAssemblyId: "e2600000-0000-4000-8000-000000000002",
    overrideType: "swap", reasonTemplate: `Synthetic coastal rule ${number}`, active: true,
  })),
  summary: { totalRules: 2, synthetic: true },
}));
vi.mock("./db", () => ({ getDb: boundary.getDb }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));
vi.mock("../shared/geo-override-seed", () => ({
  COASTAL_OVERRIDE_SEED_RULES: seed.rules, getSeedSummary: () => seed.summary,
}));

import { geoOverrideRouter } from "./geo-override-router";
import * as helpers from "./geo-override-db";

const TENANT_A = "a2600000-0000-4000-8000-000000000001";
const TENANT_B = "a2600000-0000-4000-8000-000000000002";
const ACTOR = "b2600000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-18T15:00:00.000Z");
const ruleId = (number: number) => `c2600000-0000-4000-8000-${String(number).padStart(12, "0")}`;
type Row = GeographicOverride;
type Event = { kind: string; handle: string; sql?: string; params?: unknown[] };

function row(number: number, tenantId: string | null = TENANT_A, isActive = true): Row {
  return {
    id: ruleId(number), tenantId, zoneId: null, assemblyId: null, costCodeId: null,
    overrideType: "swap", overrideValue: null, reason: null, zone: "Charleston Coastal",
    trade: "electrical", finishLevel: null, reasonTemplate: `Initial rule ${number}`,
    originalAssemblyId: seed.rules[0].originalAssemblyId,
    replacementAssemblyId: seed.rules[0].replacementAssemblyId,
    isActive, createdAt: NOW, updatedAt: NOW,
  };
}

/** Deliberately small SQL model: equality conjunctions only; no hidden ownership filter. */
function matches(predicate: SQL, candidate: Row): boolean {
  const compiled = new PgDialect().sqlToQuery(predicate);
  if (/\bor\b|\bis null\b/i.test(compiled.sql)) throw new Error("Unsupported model predicate");
  const columns = getTableColumns(geographicOverrides);
  const terms = [...compiled.sql.matchAll(/"geographic_overrides"\."([^\"]+)" = \$(\d+)/g)];
  if (!terms.length || terms.length !== compiled.params.length) throw new Error("Unmodeled predicate");
  return terms.every(([, column, parameter]) => {
    const entry = Object.entries(columns).find(([, value]) => value.name === column);
    if (!entry) throw new Error(`Unknown column ${column}`);
    return candidate[entry[0] as keyof Row] === compiled.params[Number(parameter) - 1];
  });
}

function database(initial: Row[] = []) {
  let committed = structuredClone(initial);
  const events: Event[] = [];
  const writes: Record<string, unknown>[] = [];
  let transactions = 0;
  let inserts = 0;
  let readbacks = 0;
  const faults = {
    insert: 0, readback: 0, missingReadback: 0, foreignReadback: 0, nullReadback: 0,
    invalidIds: 0, emptyId: 0, missingIds: 0, duplicateIds: 0, wrongReadbackId: 0,
    commit: false, discovery: false,
  };
  function handle(name: string, readRows: () => Row[]) {
    return {
      select: () => ({ from: (table: Table) => ({ where: (predicate: SQL) => {
        if (getTableName(table) !== "geographic_overrides") throw new Error("Unexpected table");
        let limit: number | undefined;
        const execute = async () => {
          const compiled = new PgDialect().sqlToQuery(predicate);
          const isReadback = compiled.sql.includes('"geographic_overrides"."id"');
          events.push({ kind: isReadback ? "readback" : "discovery", handle: name, ...compiled });
          if (!isReadback && faults.discovery) throw new Error("secret discovery SQL");
          if (isReadback) {
            readbacks++;
            if (faults.readback === readbacks) throw new Error("synthetic readback failure");
            if (faults.missingReadback === readbacks) return [];
          }
          const selected = structuredClone(readRows().filter(value => matches(predicate, value)).slice(0, limit));
          if (isReadback && selected[0]) {
            if (faults.foreignReadback === readbacks) selected[0].tenantId = TENANT_B;
            if (faults.nullReadback === readbacks) selected[0].tenantId = null;
            if (faults.wrongReadbackId === readbacks) selected[0].id = ruleId(999);
          }
          return selected;
        };
        const query = {
          limit: (count: number) => { limit = count; return query; },
          orderBy: (..._columns: unknown[]) => query,
          then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject),
        };
        return query;
      } }) }),
      insert: (table: Table) => ({ values: (values: Record<string, unknown>) => ({ returning: async () => {
        if (getTableName(table) !== "geographic_overrides") throw new Error("Unexpected insert table");
        inserts++;
        events.push({ kind: "insert", handle: name });
        writes.push(structuredClone(values));
        if (faults.insert === inserts) throw new Error("synthetic second insertion failure");
        const created = { ...row(100 + inserts), ...values } as Row;
        readRows().push(created);
        if (faults.invalidIds === inserts) return [{ id: null }];
        if (faults.emptyId === inserts) return [{ id: "" }];
        if (faults.missingIds === inserts) return [];
        if (faults.duplicateIds === inserts) return [{ id: created.id }, { id: created.id }];
        return [{ id: created.id }];
      } }) }),
    };
  }
  const db = {
    ...handle("db", () => committed),
    transaction: async <T>(callback: (tx: ReturnType<typeof handle>) => Promise<T>) => {
      const name = `tx:${++transactions}`;
      const snapshot = structuredClone(committed);
      events.push({ kind: "begin", handle: name });
      try {
        const result = await callback(handle(name, () => snapshot));
        if (faults.commit) throw new Error("synthetic commit failure");
        committed = snapshot;
        events.push({ kind: "commit", handle: name });
        return result;
      } catch (error) {
        events.push({ kind: "rollback", handle: name });
        throw error;
      }
    },
  };
  return { db, faults, events, writes, state: () => structuredClone(committed) };
}

function context(role: "admin" | "user" | null = "admin", tenantId: string | null = TENANT_A): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId,
    user: role === null ? null : { id: ACTOR, role, tenantId } as NonNullable<TrpcContext["user"]>,
  };
}
const invoke = (ctx = context()) => geoOverrideRouter.createCaller(ctx).seedCoastalRules();
let model: ReturnType<typeof database>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TENANT_STRICT", "false");
  model = database([row(1, TENANT_B), row(2, null)]);
  boundary.getDb.mockImplementation(async () => model.db);
  boundary.audit.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

const mappedRules = () => seed.rules.map(({ active, ...rule }) => ({ ...rule, isActive: active }));

describe("coastal seed business batch", () => {
  it("rolls back the first rule when the second insertion is reached and fails", async () => {
    const initial = model.state();
    model.faults.insert = 2;
    await expect(invoke()).rejects.toMatchObject({ message: "synthetic second insertion failure" });
    expect(model.writes).toHaveLength(2);
    expect(model.state()).toEqual(initial);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it.each([
    ["readback", "synthetic readback failure"],
    ["missingReadback", "Override rule write could not be verified"],
    ["foreignReadback", "Override rule write could not be verified"],
    ["nullReadback", "Override rule write could not be verified"],
    ["wrongReadbackId", "Override rule write could not be verified"],
    ["invalidIds", "Override rule write could not be verified"],
    ["emptyId", "Override rule write could not be verified"],
    ["missingIds", "Override rule write could not be verified"],
    ["duplicateIds", "Override rule write could not be verified"],
  ] as const)("rolls back all business rows on later %s failure", async (fault, message) => {
    const initial = model.state();
    model.faults[fault] = 2;
    await expect(invoke()).rejects.toMatchObject({ message });
    expect(model.writes).toHaveLength(2);
    expect(model.state()).toEqual(initial);
    expect(model.events.at(-1)?.kind).toBe("rollback");
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("does not audit or confirm rows when commit fails after both verified inserts", async () => {
    const initial = model.state();
    model.faults.commit = true;
    await expect(invoke()).rejects.toMatchObject({ message: "synthetic commit failure" });
    expect(model.events.filter(event => event.kind === "readback")).toHaveLength(2);
    expect(model.state()).toEqual(initial);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it.each(["false", "true"])("uses one handle for tenant-only discovery, inserts and readbacks (strict=%s)", async strict => {
    vi.stubEnv("TENANT_STRICT", strict);
    const initial = model.state();
    await expect(invoke()).resolves.toEqual({
      seeded: true, message: "Successfully seeded 2 coastal override rules.", summary: seed.summary,
    });
    expect(boundary.getDb).toHaveBeenCalledTimes(1);
    expect(model.events.map(event => [event.kind, event.handle])).toEqual([
      ["begin", "tx:1"], ["discovery", "tx:1"], ["insert", "tx:1"],
      ["readback", "tx:1"], ["insert", "tx:1"], ["readback", "tx:1"], ["commit", "tx:1"],
    ]);
    expect(model.events[1]).toMatchObject({
      sql: '"geographic_overrides"."tenant_id" = $1', params: [TENANT_A],
    });
    expect(model.state().slice(0, 2)).toEqual(initial);
    expect(model.state().slice(2).map(value => value.tenantId)).toEqual([TENANT_A, TENANT_A]);
  });

  it.each([
    ["active", [row(3)]], ["inactive", [row(3, TENANT_A, false)]],
    ["manual mixed/partial", [row(3), row(4, TENANT_A, false), row(5)]],
  ] as const)("skips and reports the exact own count for %s rules", async (_label, owned) => {
    const initial = [...model.state(), ...owned];
    model = database(initial);
    await expect(invoke()).resolves.toEqual({
      seeded: false,
      message: `${owned.length} override rules already exist. Clear existing rules before re-seeding.`,
      summary: seed.summary,
    });
    expect(model.state()).toEqual(initial);
    expect(model.writes).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
    expect(model.events.map(event => event.kind)).toEqual(["begin", "discovery", "commit"]);
  });

  it.each(["query", "acquisition throws", "unavailable"])("sanitizes %s discovery failure with no writes or audit", async source => {
    if (source === "query") model.faults.discovery = true;
    if (source === "acquisition throws") boundary.getDb.mockRejectedValue(new Error("secret database address"));
    if (source === "unavailable") boundary.getDb.mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ message: "Geographic override rules are unavailable" });
    expect(model.writes).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it.each([
    [null, TENANT_A, "UNAUTHORIZED"], ["user", TENANT_A, "FORBIDDEN"], ["admin", null, "FORBIDDEN"],
  ] as const)("denies role=%s tenant=%s before effects", async (role, tenantId, code) => {
    await expect(invoke(context(role, tenantId))).rejects.toMatchObject({ code });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(model.events).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("audits each verified row in order after the entire batch commits, then the endpoint summary", async () => {
    const states: Row[][] = [];
    boundary.audit.mockImplementation(async () => { states.push(model.state()); return { id: "audit" }; });
    await invoke();
    const created = model.state().slice(2);
    expect(states).toEqual([model.state(), model.state(), model.state()]);
    expect(boundary.audit.mock.calls.map(([event]) => event)).toEqual([
      ...created.map(value => ({
        userId: null, action: "geo_override.create", tableName: "geographic_overrides",
        recordId: value.id, after: { ...value, operatorId: ACTOR },
      })),
      {
        userId: null, action: "geo_override.seed_coastal_rules", tableName: "geographic_overrides",
        recordId: "0", after: { inserted: 2, operatorId: ACTOR, summary: seed.summary },
      },
    ]);
  });

  it("tolerates null audit results after the whole business batch commits", async () => {
    boundary.audit.mockResolvedValue(null);
    await expect(invoke()).resolves.toMatchObject({ seeded: true });
    expect(model.state()).toHaveLength(4);
    expect(boundary.audit).toHaveBeenCalledTimes(3);
  });

  it.each([1, 2])("keeps the ENTIRE committed batch when per-row audit %s throws, without final success audit", async failAt => {
    let calls = 0;
    boundary.audit.mockImplementation(async () => {
      if (++calls === failAt) throw new Error("synthetic audit failure");
      return null;
    });
    await expect(invoke()).rejects.toMatchObject({ message: "synthetic audit failure" });
    expect(model.state().filter(value => value.tenantId === TENANT_A)).toHaveLength(2);
    expect(model.events.at(-1)?.kind).toBe("commit");
    expect(boundary.audit).toHaveBeenCalledTimes(failAt);
    expect(boundary.audit.mock.calls.every(([event]) => event.action === "geo_override.create")).toBe(true);
  });

  it("returns the helper's discriminated result and strips untrusted authority and generated fields", async () => {
    const poisoned = mappedRules().map(value => ({
      ...value, tenantId: TENANT_B, id: ruleId(999), createdAt: new Date(0), updatedAt: new Date(0),
      operatorId: "spoofed", active: false,
    }));
    const before = structuredClone(poisoned);
    await expect(helpers.seedOverrideRulesForTenant(TENANT_A.toUpperCase(), poisoned, ACTOR))
      .resolves.toEqual({ seeded: true, inserted: 2 });
    expect(model.writes).toEqual(mappedRules().map(value => ({ ...value, tenantId: TENANT_A })));
    expect(poisoned).toEqual(before);
    expect(model.state().slice(2).map(value => value.id)).toEqual([ruleId(101), ruleId(102)]);
    expect(boundary.audit.mock.calls.map(([event]) => event.after.operatorId)).toEqual([ACTOR, ACTOR]);
    await expect(helpers.seedOverrideRulesForTenant(TENANT_A, mappedRules(), ACTOR))
      .resolves.toEqual({ seeded: false, existingCount: 2 });
    expect(boundary.audit).toHaveBeenCalledTimes(2);
  });

  it.each(["", "   ", null, undefined, 12])("rejects unresolved helper tenant %s before DB acquisition", async tenant => {
    await expect(helpers.seedOverrideRulesForTenant(tenant as string, mappedRules(), ACTOR))
      .rejects.toMatchObject({ name: "TenantScopeError" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(boundary.audit).not.toHaveBeenCalled();
  });
});

describe("existing single-rule creation", () => {
  it("preserves the whitelist, strict ownership, single transaction and post-commit row audit", async () => {
    const input = { ...mappedRules()[0], tenantId: TENANT_B, id: ruleId(999), createdAt: new Date(0) };
    boundary.audit.mockImplementation(async () => {
      expect(model.state()).toHaveLength(3);
      expect(model.events.at(-1)?.kind).toBe("commit");
      return null;
    });
    const created = await helpers.createOverrideRule(TENANT_A, input, ACTOR);
    expect(created).toEqual(model.state()[2]);
    expect(model.writes).toEqual([{ ...mappedRules()[0], tenantId: TENANT_A }]);
    expect(model.events.map(event => [event.kind, event.handle])).toEqual([
      ["begin", "tx:1"], ["insert", "tx:1"], ["readback", "tx:1"], ["commit", "tx:1"],
    ]);
    expect(boundary.audit).toHaveBeenCalledWith({
      userId: null, action: "geo_override.create", tableName: "geographic_overrides",
      recordId: created.id, after: { ...created, operatorId: ACTOR },
    });
  });

  it("rolls back a single insert with an unauthorized readback without auditing", async () => {
    const initial = model.state();
    model.faults.foreignReadback = 1;
    await expect(helpers.createOverrideRule(TENANT_A, mappedRules()[0], ACTOR))
      .rejects.toThrow("Override rule write could not be verified");
    expect(model.state()).toEqual(initial);
    expect(boundary.audit).not.toHaveBeenCalled();
  });
});
