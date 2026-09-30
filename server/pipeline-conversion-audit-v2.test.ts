/**
 * V2 evidence for orchestrateLeadConversion's audit atomicity (pipeline-db.ts).
 *
 * Distinct from sprint26-pipeline-db.test.ts's generic per-verb-type mock: this file
 * models real per-table storage so "rolled back" is an observable disappearance of rows/
 * audit events, not just "the promise rejected" — and gives the transaction callback a
 * DIFFERENT object identity than the pool, so a bug that accidentally audited on the pool
 * connection instead of the transaction handle would be caught, not indistinguishable from
 * correct usage. This is a MODEL of a transaction (snapshot/restore in JS), not proof of
 * real PostgreSQL rollback, concurrency, or connection behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
interface Store {
  leads: Row[];
  clients: Row[];
  projects: Row[];
  deals: Row[];
  leadActivities: Row[];
  auditEvents: Row[];
}

const store: Store = { leads: [], clients: [], projects: [], deals: [], leadActivities: [], auditEvents: [] };
let forceEmptyUpdateFor = new Set<string>();
let forceEmptyInsertFor = new Set<string>();
let lastTxHandle: unknown = null;

function resetStore() {
  store.leads = [];
  store.clients = [];
  store.projects = [];
  store.deals = [];
  store.leadActivities = [];
  store.auditEvents = [];
  forceEmptyUpdateFor = new Set();
  forceEmptyInsertFor = new Set();
  lastTxHandle = null;
}

function tableKey(table: unknown): keyof Store {
  const map: Record<string, keyof Store> = {
    leads: "leads",
    clients: "clients",
    projects: "projects",
    deals: "deals",
    lead_activities: "leadActivities",
  };
  const anyTable = table as Record<string | symbol, unknown>;
  for (const sym of Object.getOwnPropertySymbols(anyTable)) {
    const value = anyTable[sym];
    if (typeof value === "string" && value in map) return map[value];
  }
  throw new Error("Unknown table in DB stub");
}

function captureValues(condition: unknown): unknown[] {
  const values: unknown[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (node == null || depth > 8) return;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      values.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const child of Object.values(node as Row)) walk(child, depth + 1);
    }
  };
  walk(condition);
  return values;
}

function matches(row: Row, conditionValues: unknown[]): boolean {
  if (conditionValues.length === 0) return true;
  const rowValues = new Set(Object.values(row));
  return conditionValues.some((v) => rowValues.has(v));
}

function makeDb() {
  const db: Record<string, unknown> = {
    select: () => {
      let conditionValues: unknown[] = [];
      let rows: Row[] = [];
      const builder: any = {
        from: (table: unknown) => {
          rows = store[tableKey(table)];
          return builder;
        },
        where: (condition: unknown) => {
          conditionValues = captureValues(condition);
          return builder;
        },
        limit: () => builder,
        then: (resolve: (v: Row[]) => unknown) =>
          Promise.resolve(rows.filter((r) => matches(r, conditionValues))).then(resolve),
      };
      return builder;
    },
    insert: (table: unknown) => ({
      values: (payload: Row) => {
        const key = tableKey(table);
        const row = { id: payload.id ?? `${key}-${store[key].length + 1}`, ...payload };
        const empty = forceEmptyInsertFor.has(key);
        if (!empty) store[key].push(row);
        const resultRows = empty ? [] : [row];
        return {
          returning: (_cols?: unknown) => Promise.resolve(resultRows),
          then: (resolve: (v: Row[]) => unknown) => Promise.resolve(resultRows).then(resolve),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: (condition: unknown) => {
          const key = tableKey(table);
          if (forceEmptyUpdateFor.has(key)) {
            return {
              returning: (_cols?: unknown) => Promise.resolve([]),
              then: (resolve: (v: Row[]) => unknown) => Promise.resolve([]).then(resolve),
            };
          }
          const conditionValues = captureValues(condition);
          const targets = store[key].filter((r) => matches(r, conditionValues));
          for (const row of targets) Object.assign(row, patch);
          const result = structuredClone(targets);
          return {
            returning: (_cols?: unknown) => Promise.resolve(result),
            then: (resolve: (v: Row[]) => unknown) => Promise.resolve(result).then(resolve),
          };
        },
      }),
    }),
    execute: async () => [],
  };
  return db;
}

const poolDb = makeDb();

// A transaction handle is a DIFFERENT object identity than the pool — inherits the same
// query methods via the prototype chain (none of them use `this`), so behavior is
// unchanged, but `tx === poolDb` is false and a caller that audits on the wrong handle is
// distinguishable from one that doesn't.
function makeTxHandle(): unknown {
  const tx = Object.create(poolDb);
  return tx;
}

(poolDb as any).transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = makeTxHandle();
  lastTxHandle = tx;
  const snapshot = structuredClone(store);
  try {
    return await fn(tx);
  } catch (err) {
    (Object.keys(store) as (keyof Store)[]).forEach((k) => {
      store[k] = snapshot[k] as never;
    });
    throw err;
  }
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => poolDb),
  getRawClient: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock("./audit", () => ({
  logAudit: vi.fn(async (params: any, handle: any) => {
    const row = {
      id: `audit-${store.auditEvents.length + 1}`,
      action: params.action,
      tableName: params.tableName,
      recordId: params.recordId,
      before: params.before ?? null,
      after: params.after ?? null,
      __handle: handle,
    };
    store.auditEvents.push(row);
    return row;
  }),
}));

vi.mock("../shared/pipeline-orchestrator", () => ({
  buildLeadConversionPayload: vi.fn(() => ({})),
}));

import * as pipelineDb from "./pipeline-db";
import { logAudit } from "./audit";

const T = "tenant-fixture";

function seedLead(overrides: Row = {}): Row {
  const lead: Row = {
    id: "lead-1",
    tenantId: T,
    name: "Test Lead",
    email: null,
    phone: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    serviceType: null,
    source: null,
    status: "qualified",
    ...overrides,
  };
  store.leads.push(lead);
  return lead;
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  // vi.clearAllMocks() clears logAudit's call history but not its factory implementation,
  // matching the convention already used elsewhere in this card.
});

describe("orchestrateLeadConversion — V2 audit atomicity evidence", () => {
  it("1. success: both audit events land on the SAME tx handle, distinct from the pool", async () => {
    seedLead();
    await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);

    expect(store.auditEvents).toHaveLength(2);
    expect(lastTxHandle).not.toBe(poolDb);
    for (const event of store.auditEvents) {
      expect(event.__handle).toBe(lastTxHandle);
      expect(event.__handle).not.toBe(poolDb);
    }
    const tables = store.auditEvents.map((e) => e.tableName).sort();
    expect(tables).toEqual(["deals", "projects"]);
  });

  it("2. deals audit REJECTED (thrown) aborts the whole conversion — no rows, no orphan events", async () => {
    seedLead();
    (logAudit as any).mockRejectedValueOnce(new Error("audit connection lost"));

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow(
      "audit connection lost",
    );

    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.deals).toHaveLength(0);
    expect(store.leadActivities).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
    expect(store.leads[0].status).toBe("qualified");
  });

  it("3. deals audit returns NULL aborts the whole conversion — same effect via the return-value check, not the try/catch", async () => {
    seedLead();
    (logAudit as any).mockImplementationOnce(async () => null);

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow(
      /audit insert failed.*deals/i,
    );

    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.deals).toHaveLength(0);
    expect(store.leadActivities).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it("4. projects audit REJECTED — the FIRST (deals) audit event is also undone, not just silenced", async () => {
    seedLead();
    const real = (logAudit as any).getMockImplementation();
    (logAudit as any)
      .mockImplementationOnce(real) // deals event: succeeds and is pushed to store.auditEvents
      .mockRejectedValueOnce(new Error("projects audit failed"));

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow(
      "projects audit failed",
    );

    // The deals event was really pushed to the model store before the second call threw —
    // proving the rollback removes an ALREADY-COMMITTED-LOOKING event, not just a value
    // that never made it in.
    expect(store.auditEvents).toHaveLength(0);
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.deals).toHaveLength(0);
    expect(store.leadActivities).toHaveLength(0);
  });

  it("5. projects audit returns NULL — same rollback of rows and the orphaned first event", async () => {
    seedLead();
    const real = (logAudit as any).getMockImplementation();
    (logAudit as any).mockImplementationOnce(real).mockImplementationOnce(async () => null);

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow(
      /audit insert failed.*projects/i,
    );

    expect(store.auditEvents).toHaveLength(0);
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.deals).toHaveLength(0);
  });

  it("6. step4 (lead status update affecting zero rows) aborts before any audit — no partial success", async () => {
    seedLead();
    forceEmptyUpdateFor.add("leads");

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow(
      /lead status update failed/i,
    );

    expect(store.auditEvents).toHaveLength(0);
    expect(store.leadActivities).toHaveLength(0);
    // Steps 1-3 (client/project/deal) had already run before step4 — this proves the
    // TRANSACTION (not step4's own check alone) is what removes them, since step4 itself
    // never touches those tables.
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.deals).toHaveLength(0);
  });

  it("7. step5 (lead activity insert affecting zero rows) aborts before any audit", async () => {
    seedLead();
    forceEmptyInsertFor.add("leadActivities");

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow(
      /lead activity insert failed/i,
    );

    expect(store.auditEvents).toHaveLength(0);
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.deals).toHaveLength(0);
    // The lead WAS marked converted by step4 before step5's failure — this table stays
    // rolled back too, proving the whole transaction unwinds, not just steps 1-3.
    expect(store.leads[0].status).toBe("qualified");
  });

  it("8. success: activity is recorded and returned ids match the persisted rows", async () => {
    seedLead();
    const result = await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);

    expect(store.leadActivities).toHaveLength(1);
    expect(store.clients[0].id).toBe(result.clientId);
    expect(store.projects[0].id).toBe(result.projectId);
    expect(store.deals[0].id).toBe(result.dealId);
    expect(store.leads[0].status).toBe("converted");
  });
});
