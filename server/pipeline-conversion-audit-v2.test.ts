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
  profiles: Row[];
  // Empty by default — enough for requireProjectAccess's membership/RBAC fallthrough to
  // resolve to "no grant found" (not a crash) when a replay test needs a genuine ACL
  // denial rather than an owner match.
  projectMembers: Row[];
  users: Row[];
  // Empty — RBAC's role lookup returning nothing is what makes the fallthrough resolve to
  // "no permission" instead of crashing on an unmocked table.
  roles: Row[];
}

const store: Store = {
  leads: [],
  clients: [],
  projects: [],
  deals: [],
  leadActivities: [],
  auditEvents: [],
  profiles: [],
  projectMembers: [],
  users: [],
  roles: [],
};
let forceEmptyUpdateFor = new Set<string>();
let forceEmptyInsertFor = new Set<string>();
let lastTxHandle: unknown = null;
/** A queue of one-shot hooks: each `FOR UPDATE` lock acquisition shifts and fires the
 * next one — see makeDb's `for()`. Mirrors phase2-flow.test.ts's mechanism, so a test can
 * inject a deterministic mid-flight mutation (e.g. a deal's tenant changing) exactly when
 * a specific lock (the lead's, then requireProjectAccess's own project lock) is taken. */
let onLockAcquireQueue: Array<() => void> = [];

// ── Minimal lock-dispute model (mirrors phase2-flow.test.ts) ────────────────────────
// A re-read alone only shows the code looked at fresh data — it does NOT show the row was
// protected from another writer for the rest of the decision. This tracks, per (table,
// id), which transaction currently holds a `FOR UPDATE` lock on it, defers an "external"
// write attempt against a held row until that lock releases (commit OR rollback — a real
// lock releases on either), and applies it then.
let currentTx: unknown = null;
const heldLocks = new Map<string, unknown>();
const acquiredByTx = new Map<unknown, Set<string>>();
let pendingWrites: Array<{
  key: string;
  table: keyof Store;
  id: string;
  patch: Row;
  result: { applied: boolean };
}> = [];

function externalWrite(table: keyof Store, id: string, patch: Row): { applied: boolean } {
  const key = `${table}:${id}`;
  const result = { applied: false };
  if (heldLocks.has(key)) {
    pendingWrites.push({ key, table, id, patch, result });
  } else {
    const row = store[table].find((r) => (r as Row).id === id);
    if (row) Object.assign(row, patch);
    result.applied = true;
  }
  return result;
}

function releaseLocksFor(tx: unknown): void {
  const keys = acquiredByTx.get(tx);
  if (keys) {
    for (const k of keys) heldLocks.delete(k);
    acquiredByTx.delete(tx);
  }
  pendingWrites = pendingWrites.filter((pw) => {
    if (heldLocks.has(pw.key)) return true;
    const row = store[pw.table].find((r) => (r as Row).id === pw.id);
    if (row) Object.assign(row, pw.patch);
    pw.result.applied = true;
    return false;
  });
}

function resetStore() {
  store.leads = [];
  store.clients = [];
  store.projects = [];
  store.deals = [];
  store.leadActivities = [];
  store.auditEvents = [];
  store.profiles = [];
  store.projectMembers = [];
  store.users = [];
  store.roles = [];
  forceEmptyUpdateFor = new Set();
  forceEmptyInsertFor = new Set();
  lastTxHandle = null;
  onLockAcquireQueue = [];
  currentTx = null;
  heldLocks.clear();
  acquiredByTx.clear();
  pendingWrites = [];
}

function tableKey(table: unknown): keyof Store {
  const map: Record<string, keyof Store> = {
    leads: "leads",
    clients: "clients",
    projects: "projects",
    deals: "deals",
    lead_activities: "leadActivities",
    profiles: "profiles",
    project_members: "projectMembers",
    roles: "roles",
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
      // A drizzle Column carries its whole parent table (constraint names, defaults, other
      // columns' metadata — booleans and strings that pollute the captured value set and
      // make `matches()` below match rows it has no business matching). Columns are never
      // themselves the comparison VALUE, only the query's Param chunk is — recognize and
      // skip a Column by its `columnType` field rather than recursing into it.
      if ("columnType" in (node as Row) && "table" in (node as Row)) return;
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
      let currentTableKey: keyof Store | undefined;
      const builder: any = {
        from: (table: unknown) => {
          currentTableKey = tableKey(table);
          rows = store[currentTableKey];
          return builder;
        },
        where: (condition: unknown) => {
          conditionValues = captureValues(condition);
          return builder;
        },
        limit: () => builder,
        // Registers, BEFORE the interference hook runs, which exact rows this lock now
        // covers — a real `FOR UPDATE` takes its lock as part of executing the SELECT,
        // atomically with reading the row, so a hook's own `externalWrite` attempt on that
        // same row already sees it held.
        for: (mode?: string) => {
          if (mode === "update") {
            if (currentTableKey) {
              for (const r of rows.filter((row) => matches(row, conditionValues))) {
                const key = `${currentTableKey}:${(r as Row).id}`;
                heldLocks.set(key, currentTx);
                let keys = acquiredByTx.get(currentTx);
                if (!keys) {
                  keys = new Set();
                  acquiredByTx.set(currentTx, keys);
                }
                keys.add(key);
              }
            }
            if (onLockAcquireQueue.length > 0) {
              const fn = onLockAcquireQueue.shift()!;
              fn();
            }
          }
          return builder;
        },
        // Cloned at resolution time — a query's result must be a real snapshot of the row
        // as it stood when this read happened, not a live reference into `store` that a
        // LATER mutation (e.g. a FOR UPDATE hook firing on a subsequent lock) would still
        // be able to reach through and silently change after the fact.
        then: (resolve: (v: Row[]) => unknown) =>
          Promise.resolve(structuredClone(rows.filter((r) => matches(r, conditionValues)))).then(resolve),
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
  const previousTx = currentTx;
  currentTx = tx;
  try {
    return await fn(tx);
  } catch (err) {
    (Object.keys(store) as (keyof Store)[]).forEach((k) => {
      store[k] = snapshot[k] as never;
    });
    throw err;
  } finally {
    // A real lock releases when the transaction ends, on EITHER outcome — commit or
    // rollback — never only on success.
    releaseLocksFor(tx);
    currentTx = previousTx;
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
    ownerUserId: null,
    convertedProjectId: null,
    convertedClientId: null,
    ...overrides,
  };
  store.leads.push(lead);
  return lead;
}

function seedProfile(overrides: Row = {}): Row {
  const profile: Row = {
    id: "user-1",
    tenantId: T,
    isActive: true,
    role: "member",
    ...overrides,
  };
  store.profiles.push(profile);
  return profile;
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  // vi.clearAllMocks() clears logAudit's call history but not its factory implementation,
  // matching the convention already used elsewhere in this card.
  seedProfile(); // the default actor ("user-1") used by every pre-existing test in this file.
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

  // Migrated from sprint26-pipeline-db.test.ts / sprint26-pipeline-integration.test.ts —
  // that file's per-verb-type mock cannot represent the profiles/projects/clients/deals
  // lookups this function now makes. Equivalent coverage, real per-table harness.
  it("9. (migrated) missing lead throws, nothing read further", async () => {
    await expect(pipelineDb.orchestrateLeadConversion("nope", "user-1", T)).rejects.toThrow(
      "Lead not found",
    );
  });

  it("10. (migrated) a lead owned by another tenant is refused and nothing is written", async () => {
    seedLead({ tenantId: "tenant-b" });
    await expect(
      pipelineDb.orchestrateLeadConversion("lead-1", "user-1", "tenant-a"),
    ).rejects.toThrow(/different tenant/i);
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
  });

  it("11. (migrated) a transaction-level failure propagates (deadlock-style)", async () => {
    seedLead();
    const originalTx = (poolDb as any).transaction;
    (poolDb as any).transaction = async () => {
      throw new Error("Deadlock");
    };
    try {
      await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow(
        "Deadlock",
      );
    } finally {
      (poolDb as any).transaction = originalTx;
    }
  });
});

describe("orchestrateLeadConversion — actor identity (V3: identity/replay)", () => {
  it("12. an actor with no matching profile is refused before any write", async () => {
    seedLead();
    store.profiles = []; // no profile for "user-1" at all

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "ACTOR_INVALID",
    });
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
  });

  it("13. an inactive actor is refused before any write", async () => {
    seedLead();
    store.profiles = [{ id: "user-1", tenantId: T, isActive: false, role: "member" }];

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "ACTOR_INVALID",
    });
    expect(store.projects).toHaveLength(0);
  });

  it("14. an actor whose OWN tenant differs from the call's tenant is refused", async () => {
    seedLead();
    store.profiles = [{ id: "user-1", tenantId: "other-tenant", isActive: true, role: "member" }];

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "ACTOR_INVALID",
    });
    expect(store.projects).toHaveLength(0);
  });

  it("15. LEADS_OWNER_SCOPE on: a non-admin actor who does NOT own the lead is refused (FORBIDDEN)", async () => {
    const previous = process.env.LEADS_OWNER_SCOPE;
    process.env.LEADS_OWNER_SCOPE = "true";
    try {
      seedLead({ ownerUserId: "someone-else" });
      await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toThrow();
      expect(store.projects).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.LEADS_OWNER_SCOPE;
      else process.env.LEADS_OWNER_SCOPE = previous;
    }
  });

  it("16. LEADS_OWNER_SCOPE on: the actor who DOES own the lead succeeds", async () => {
    const previous = process.env.LEADS_OWNER_SCOPE;
    process.env.LEADS_OWNER_SCOPE = "true";
    try {
      seedLead({ ownerUserId: "user-1" });
      const result = await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);
      expect(result.projectId).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.LEADS_OWNER_SCOPE;
      else process.env.LEADS_OWNER_SCOPE = previous;
    }
  });

  it("17. LEADS_OWNER_SCOPE on: an admin actor succeeds regardless of lead ownership", async () => {
    const previous = process.env.LEADS_OWNER_SCOPE;
    process.env.LEADS_OWNER_SCOPE = "true";
    try {
      store.profiles = [
        { id: "user-1", tenantId: T, isActive: true, role: "admin" },
        { id: "someone-else", tenantId: T, isActive: true, role: "member" },
      ];
      seedLead({ ownerUserId: "someone-else" });
      const result = await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);
      expect(result.projectId).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.LEADS_OWNER_SCOPE;
      else process.env.LEADS_OWNER_SCOPE = previous;
    }
  });

  it("18. default (shared) mode: any active tenant actor succeeds regardless of lead ownership", async () => {
    seedProfile({ id: "someone-else", tenantId: T, isActive: true, role: "member" });
    seedLead({ ownerUserId: "someone-else" });
    const result = await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);
    expect(result.projectId).toBeTruthy();
  });
});

describe("orchestrateLeadConversion — owner resolution", () => {
  it("19. a valid persisted lead owner is preserved on the project (not replaced by the actor)", async () => {
    seedProfile({ id: "owner-1", tenantId: T, isActive: true, role: "member" });
    seedLead({ ownerUserId: "owner-1" });

    await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);

    expect(store.projects[0].ownerUserId).toBe("owner-1");
  });

  it("20. a null lead owner falls back to the validated actor", async () => {
    seedLead({ ownerUserId: null });
    await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);
    expect(store.projects[0].ownerUserId).toBe("user-1");
  });

  it("21. a NON-null but invalid lead owner is refused, never silently replaced by the actor", async () => {
    seedLead({ ownerUserId: "ghost-owner" }); // no matching profile seeded
    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "OWNER_INVALID",
    });
    expect(store.projects).toHaveLength(0);
  });

  it("22. a lead owner from a DIFFERENT tenant is refused, not silently replaced", async () => {
    seedProfile({ id: "owner-1", tenantId: "other-tenant", isActive: true, role: "member" });
    seedLead({ ownerUserId: "owner-1" });
    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "OWNER_INVALID",
    });
    expect(store.projects).toHaveLength(0);
  });
});

describe("orchestrateLeadConversion — verified replay, no cross-route duplication", () => {
  it("23. a lead with a verified existing conversion (own route) returns those ids without creating anything new", async () => {
    store.clients.push({ id: "client-existing", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({ id: "project-existing", tenantId: T, leadId: "lead-1", clientId: "client-existing", deletedAt: null, ownerUserId: "user-1" });
    store.deals.push({ id: "deal-existing", leadId: "lead-1", tenantId: T });
    seedLead({ convertedProjectId: "project-existing", convertedClientId: "client-existing", status: "converted" });

    const result = await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);

    expect(result).toEqual({ clientId: "client-existing", projectId: "project-existing", dealId: "deal-existing", id: "deal-existing" });
    expect(store.projects).toHaveLength(1); // no new project created
    expect(store.auditEvents).toHaveLength(0); // replay is a pure read, no new audit
  });

  it("24. a converted marker with NO matching project (broken link) is refused, not treated as 'none'", async () => {
    seedLead({ convertedProjectId: "ghost-project", status: "converted" });
    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
    expect(store.projects).toHaveLength(0);
  });

  it("25. two projects referencing the same lead (ambiguous) are refused rather than guessed at", async () => {
    store.projects.push(
      { id: "project-a", tenantId: T, leadId: "lead-1", clientId: "client-a", deletedAt: null },
      { id: "project-b", tenantId: T, leadId: "lead-1", clientId: "client-b", deletedAt: null },
    );
    seedLead();
    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_AMBIGUOUS",
    });
  });

  it("26. cross-route: a lead already converted by the MODERN writer (no deal) cannot satisfy the LEGACY shape — refused, no deal invented", async () => {
    // The modern writer always sets both marker fields and never creates a deal.
    store.clients.push({ id: "client-modern", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({ id: "project-modern", tenantId: T, leadId: "lead-1", clientId: "client-modern", deletedAt: null, ownerUserId: "user-1" });
    seedLead({ convertedProjectId: "project-modern", convertedClientId: "client-modern", status: "converted" });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
    expect(store.deals).toHaveLength(0); // never invented one to satisfy the LEGACY shape
  });

  it("27. a project correctly linked to the lead, but with no ACL grant for this actor, is refused as forbidden — not returned, not inconsistent", async () => {
    // Owned by someone else, no membership row, no RBAC grant — the lead-level
    // correlation is real and consistent, but project-level access is a separate
    // authority this actor does not hold.
    store.clients.push({ id: "client-shared", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-shared",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-shared",
      deletedAt: null,
      ownerUserId: "someone-else",
    });
    store.deals.push({ id: "deal-shared", leadId: "lead-1", tenantId: T });
    seedLead({ convertedProjectId: "project-shared", convertedClientId: "client-shared", status: "converted" });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "PROJECT_ACCESS_DENIED",
    });
    expect(store.deals).toHaveLength(1); // untouched — no duplicate, nothing invented
  });

  it("28. a client that exists but belongs to another tenant is treated as unresolvable — the link is inconsistent, not found", async () => {
    store.clients.push({ id: "client-foreign", tenantId: "other-tenant", isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-x",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-foreign",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    seedLead({ convertedProjectId: "project-x", convertedClientId: "client-foreign", status: "converted" });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
  });

  it("29. a deal that exists for this lead but in another tenant is a broken link, not silently ignored", async () => {
    store.clients.push({ id: "client-y", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-y",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-y",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    store.deals.push({ id: "deal-foreign", leadId: "lead-1", tenantId: "other-tenant" });
    seedLead({ convertedProjectId: "project-y", convertedClientId: "client-y", status: "converted" });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
  });

  it("30. rows exist for this lead but are all foreign/deleted, with NO marker at all — treated as a broken link, not 'none'", async () => {
    // No convertedProjectId/convertedClientId on the lead, but a project row already
    // references this lead in a way that cannot be verified — must not be silently
    // treated as "nothing has happened yet" and duplicated over.
    store.projects.push({
      id: "project-deleted",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-z",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    seedLead(); // no markers set at all

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(1); // still just the pre-existing (deleted) one
  });

  it("31. an orphan deal (leadId set, no project at all, no markers) is inconsistent, not 'none' — never lets a fresh conversion or a second deal be created over it", async () => {
    store.deals.push({ id: "deal-orphan", leadId: "lead-1", tenantId: T });
    seedLead(); // no markers, no project — only an orphan deal

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
    expect(store.deals).toHaveLength(1); // no second deal invented
    expect(store.projects).toHaveLength(0);
  });

  it("32. two projects for the same lead — one valid, one foreign-tenant — are ambiguous, never silently narrowed to the valid one", async () => {
    store.clients.push({ id: "client-valid", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push(
      { id: "project-valid", tenantId: T, leadId: "lead-1", clientId: "client-valid", deletedAt: null, ownerUserId: "user-1" },
      { id: "project-foreign", tenantId: "other-tenant", leadId: "lead-1", clientId: "client-other", deletedAt: null },
    );
    seedLead({ convertedProjectId: "project-valid", convertedClientId: "client-valid", status: "converted" });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_AMBIGUOUS",
    });
  });

  it("33. one valid deal plus one foreign-tenant deal for the same lead are ambiguous, never silently narrowed to the valid one", async () => {
    store.clients.push({ id: "client-w", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-w",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-w",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    store.deals.push(
      { id: "deal-valid", leadId: "lead-1", tenantId: T },
      { id: "deal-foreign", leadId: "lead-1", tenantId: "other-tenant" },
    );
    seedLead({ convertedProjectId: "project-w", convertedClientId: "client-w", status: "converted" });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_AMBIGUOUS",
    });
  });

  it("34. a deal correlated to this lead changes to another tenant exactly as requireProjectAccess acquires the project's own lock — re-read fresh AFTER that lock, not derived from the snapshot taken before it (LEGACY requires a real deal)", async () => {
    store.clients.push({ id: "client-q", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-q",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-q",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    store.deals.push({ id: "deal-q", leadId: "lead-1", tenantId: T });
    seedLead({ convertedProjectId: "project-q", convertedClientId: "client-q", status: "converted" });
    // FOR UPDATE #1 is the lead's own lock (no-op); #2 is requireProjectAccess's own lock
    // on the project row — change the deal's tenant there, AFTER the pre-lock snapshot of
    // it was already taken inside findExistingConversionForLead.
    onLockAcquireQueue.push(() => {});
    onLockAcquireQueue.push(() => {
      const d = store.deals.find((x) => x.id === "deal-q");
      if (d) d.tenantId = "other-tenant";
    });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
  });

  it("35. the replay client is deactivated exactly as ITS OWN lock is acquired (the 3rd FOR UPDATE: lead, then project ACL, then this) — protected by its own lock, not just re-read after a DIFFERENT row's lock", async () => {
    store.clients.push({ id: "client-s", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-s",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-s",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    // A real deal so LEGACY's requireDeal:true has nothing else to object to — the ONLY
    // thing this test isolates is the client's own protection.
    store.deals.push({ id: "deal-s", leadId: "lead-1", tenantId: T });
    seedLead({ convertedProjectId: "project-s", convertedClientId: "client-s", status: "converted" });
    onLockAcquireQueue.push(() => {}); // #1 lead
    onLockAcquireQueue.push(() => {}); // #2 project ACL
    onLockAcquireQueue.push(() => {
      const c = store.clients.find((x) => x.id === "client-s");
      if (c) c.isActive = false;
    });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
  });

  it("36. the replay deal changes tenant exactly as ITS OWN lock is acquired (the 4th FOR UPDATE: lead, project ACL, client, then this) — LEGACY requires a real deal", async () => {
    store.clients.push({ id: "client-t", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-t",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-t",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    store.deals.push({ id: "deal-t", leadId: "lead-1", tenantId: T });
    seedLead({ convertedProjectId: "project-t", convertedClientId: "client-t", status: "converted" });
    onLockAcquireQueue.push(() => {}); // #1 lead
    onLockAcquireQueue.push(() => {}); // #2 project ACL
    onLockAcquireQueue.push(() => {}); // #3 client — no-op, stays valid
    onLockAcquireQueue.push(() => {
      const d = store.deals.find((x) => x.id === "deal-t");
      if (d) d.tenantId = "other-tenant";
    });

    await expect(pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T)).rejects.toMatchObject({
      code: "CONVERSION_LINK_INCONSISTENT",
    });
  });

  it("37. an external write against the replay client, attempted while ITS OWN lock is held, is PENDING (not applied, not lost) until this transaction releases — then lands (LEGACY)", async () => {
    store.clients.push({ id: "client-u", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-u",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-u",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    store.deals.push({ id: "deal-u", leadId: "lead-1", tenantId: T });
    seedLead({ convertedProjectId: "project-u", convertedClientId: "client-u", status: "converted" });

    let attempt: { applied: boolean } | null = null;
    onLockAcquireQueue.push(() => {}); // #1 lead
    onLockAcquireQueue.push(() => {}); // #2 project ACL
    onLockAcquireQueue.push(() => {
      // #3: the client's OWN lock is held from this exact instant.
      attempt = externalWrite("clients", "client-u", { isActive: false });
      expect(attempt.applied).toBe(false);
      expect(store.clients.find((c) => c.id === "client-u")!.isActive).toBe(true);
    });

    const result = await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);

    expect(result).toMatchObject({ clientId: "client-u", projectId: "project-u", dealId: "deal-u" });
    expect(attempt!.applied).toBe(true);
    expect(store.clients.find((c) => c.id === "client-u")!.isActive).toBe(false);
  });

  it("38. an external write against the replay deal, attempted while ITS OWN lock is held, is PENDING until this transaction releases — then lands (LEGACY)", async () => {
    store.clients.push({ id: "client-v", tenantId: T, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-v",
      tenantId: T,
      leadId: "lead-1",
      clientId: "client-v",
      deletedAt: null,
      ownerUserId: "user-1",
    });
    store.deals.push({ id: "deal-v", leadId: "lead-1", tenantId: T });
    seedLead({ convertedProjectId: "project-v", convertedClientId: "client-v", status: "converted" });

    let attempt: { applied: boolean } | null = null;
    onLockAcquireQueue.push(() => {}); // #1 lead
    onLockAcquireQueue.push(() => {}); // #2 project ACL
    onLockAcquireQueue.push(() => {}); // #3 client's own lock — no dispute here
    onLockAcquireQueue.push(() => {
      // #4: the deal's own lock.
      attempt = externalWrite("deals", "deal-v", { tenantId: "other-tenant" });
      expect(attempt.applied).toBe(false);
      expect(store.deals.find((d) => d.id === "deal-v")!.tenantId).toBe(T);
    });

    const result = await pipelineDb.orchestrateLeadConversion("lead-1", "user-1", T);

    expect(result).toMatchObject({ clientId: "client-v", projectId: "project-v", dealId: "deal-v" });
    expect(attempt!.applied).toBe(true);
    expect(store.deals.find((d) => d.id === "deal-v")!.tenantId).toBe("other-tenant");
  });

  it("39 (sanity/negative control): externalWrite against a row that is NOT currently locked by anyone applies immediately — the dispute model only defers when a real lock is held, not universally (LEGACY harness)", () => {
    store.clients.push({ id: "client-untouched", tenantId: T, isActive: true, deletedAt: null });
    const attempt = externalWrite("clients", "client-untouched", { isActive: false });
    expect(attempt.applied).toBe(true);
    expect(store.clients.find((c) => c.id === "client-untouched")!.isActive).toBe(false);
  });
});
