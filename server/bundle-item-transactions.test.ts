/**
 * R3: real helpers/routers/tenant guards over a stateful driver model.
 * Root writes publish immediately; transaction snapshots publish only after callback
 * success and an explicitly accepted commit. No assertion restores or undoes a write.
 * This tests application composition, not physical PostgreSQL or concurrent isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { bundles, bundleItems, type Bundle, type BundleItem } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import type { AuditLogParams } from "./audit";

const TENANT = "90000000-0000-4000-8000-000000000001";
const FOREIGN = "90000000-0000-4000-8000-000000000002";
const PARENT = "c0000000-0000-4000-8000-000000000001";
const OTHER_PARENT = "c0000000-0000-4000-8000-000000000002";
const ITEM = "d0000000-0000-4000-8000-000000000001";
const OTHER_ITEM = "d0000000-0000-4000-8000-000000000002";
const ASSEMBLY = "e0000000-0000-4000-8000-000000000001";
const NEW_ITEM = "f0000000-0000-4000-8000-000000000001";
const NEW_PARENT = "f0000000-0000-4000-8000-000000000002";
const USER = "a0000000-0000-4000-8000-000000000001";
const date = new Date("2026-09-18T12:00:00.000Z");
const parent: Bundle = {
  id: PARENT, tenantId: TENANT, name: "Kitchen", description: null,
  category: "general", bundleDiscount: "0.08", region: "Charleston, SC",
  isActive: true, isCustomizable: true, minItems: 2, maxItems: 20,
  validFrom: null, validUntil: null, notes: null, createdAt: date, updatedAt: date,
};
const item: BundleItem = {
  id: ITEM, bundleId: PARENT, assemblyId: ASSEMBLY, quantity: "3", isOptional: false,
  overrideQty: null, sortOrder: 4, notes: "preserve", createdAt: date, updatedAt: date,
};
type Store = { bundles: Bundle[]; items: BundleItem[] };
type Table = "bundles" | "bundle_items";
type Operation = "select" | "insert" | "update" | "delete";
type HandleId = { name: string };
type Event = {
  kind: Operation | "begin" | "commit" | "rollback" | "audit";
  handle: HandleId; table?: Table; where?: SQL; observed?: Store;
};
type Data = Partial<Bundle> & Partial<BundleItem>;
const rootId: HandleId = { name: "root" };
const model = {
  confirmed: { bundles: [], items: [] } as Store,
  events: [] as Event[],
  failReadback: false,
  missingReadback: false,
  failAfterWrite: null as Operation | null,
  failCommit: false,
  transactions: 0,
};
function initialStore(): Store {
  return structuredClone({
    bundles: [parent, { ...parent, id: OTHER_PARENT, tenantId: FOREIGN }],
    items: [item, { ...item, id: OTHER_ITEM, bundleId: OTHER_PARENT, quantity: "100", sortOrder: 99 }],
  });
}
function tableName(table: unknown): Table {
  if (table === bundles) return "bundles";
  if (table === bundleItems) return "bundle_items";
  throw new Error("Unexpected table in bounded bundle model");
}
function columnValue(where: SQL | undefined, table: Table, column: string): unknown {
  if (!where) return undefined;
  const query = new PgDialect().sqlToQuery(where);
  const match = query.sql.match(new RegExp(`"${table}"\\."${column}" = \\$(\\d+)`));
  return match ? query.params[Number(match[1]) - 1] : undefined;
}
function itemMatches(row: BundleItem, where: SQL | undefined): boolean {
  const id = columnValue(where, "bundle_items", "id");
  const bundleId = columnValue(where, "bundle_items", "bundle_id");
  return (id === undefined || row.id === id) && (bundleId === undefined || row.bundleId === bundleId);
}
function makeHandle(identity: HandleId, state: () => Store) {
  function query(operation: Operation, initialTable?: Table, projection?: Record<string, unknown>) {
    let table = initialTable;
    let predicate: SQL | undefined;
    let data: Data | Data[] = {};
    const chain = {
      from(value: unknown) { table = tableName(value); return chain; },
      where(value: SQL) { predicate = value; return chain; },
      values(value: Data | Data[]) { data = value; return chain; },
      set(value: Data) { data = value; return chain; },
      limit() { return chain; },
      orderBy() { return chain; },
      returning() { return chain; },
      then<TResult1 = unknown[], TResult2 = never>(
        resolve?: ((rows: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) { return Promise.resolve().then(execute).then(resolve, reject); },
    };
    function execute(): unknown[] {
      if (!table) throw new Error("Missing model table");
      const store = state();
      const hadUpdate = model.events.some(e => e.handle === identity && e.kind === "update" && e.observed);
      const event: Event = { kind: operation, table, handle: identity, where: predicate };
      model.events.push(event);
      if (operation === "select") {
        if (table === "bundles") {
          const id = columnValue(predicate, table, "id");
          // No tenant filtering: production must check the row's actual tenant.
          return structuredClone(store.bundles.filter(row => id === undefined || row.id === id));
        }
        if (hadUpdate && model.failReadback) throw new Error("readback failed after update");
        if (hadUpdate && model.missingReadback) return [];
        const rows = store.items.filter(row => itemMatches(row, predicate));
        if (projection?.maxSort) return [{ maxSort: rows.length ? Math.max(...rows.map(row => row.sortOrder)) : 0 }];
        return structuredClone(rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)));
      }
      let returned: Array<Bundle | BundleItem> = [];
      if (operation === "insert") {
        const values = Array.isArray(data) ? data : [data];
        if (table === "bundles") {
          const inserted = values.map(value => ({ ...parent, ...value, id: NEW_PARENT }));
          store.bundles.push(...inserted);
          returned = inserted;
        } else {
          const inserted = values.map(value => ({ ...item, notes: null, ...value, id: NEW_ITEM }));
          store.items.push(...inserted);
          returned = inserted;
        }
      } else if (operation === "update") {
        if (Array.isArray(data) || table !== "bundle_items") throw new Error("Unexpected update");
        for (const row of store.items.filter(row => itemMatches(row, predicate))) Object.assign(row, data);
      } else {
        if (table !== "bundle_items") throw new Error("Unexpected delete");
        store.items = store.items.filter(row => !itemMatches(row, predicate));
      }
      event.observed = structuredClone(store); // Evidence that the mutation actually ran.
      if (model.failAfterWrite === operation) throw new Error(`${operation} failed after mutation`);
      return structuredClone(returned);
    }
    return chain;
  }
  return {
    select: (projection?: Record<string, unknown>) => query("select", undefined, projection),
    insert: (table: unknown) => query("insert", tableName(table)),
    update: (table: unknown) => query("update", tableName(table)),
    delete: (table: unknown) => query("delete", tableName(table)),
  };
}
const rootDb = {
  ...makeHandle(rootId, () => model.confirmed),
  transaction: async <T>(callback: (tx: ReturnType<typeof makeHandle>) => Promise<T>): Promise<T> => {
    const snapshot = structuredClone(model.confirmed);
    const identity: HandleId = { name: `tx-${++model.transactions}` };
    const tx = makeHandle(identity, () => snapshot);
    model.events.push({ kind: "begin", handle: identity });
    try {
      const result = await callback(tx);
      if (model.failCommit) throw new Error("commit explicitly rejected");
      model.confirmed = snapshot; // Publish only after callback AND commit success.
      model.events.push({ kind: "commit", handle: identity });
      return result;
    } catch (error) {
      model.events.push({ kind: "rollback", handle: identity });
      throw error; // Discard snapshot; never undo writes in confirmed state.
    }
  },
};
const audit = vi.fn<(params: AuditLogParams) => Promise<null>>();
vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn(() => rootDb) }));
vi.mock("./audit", () => ({ logAudit: audit }));
const { addItemToBundle, updateBundleItemQuantity, removeBundleItem, duplicateBundle } = await import("./db");
const { bundleRouter } = await import("./bundle-router");

type Action = "add" | "update" | "remove";
const actions = ["add", "update", "remove"] as const;
const writeFor: Record<Action, Operation> = { add: "insert", update: "update", remove: "delete" };
function invoke(action: Action, tenant = TENANT) {
  if (action === "add") return addItemToBundle(tenant, { bundleId: PARENT, assemblyId: ASSEMBLY });
  if (action === "update") return updateBundleItemQuantity(tenant, ITEM, "9");
  return removeBundleItem(tenant, ITEM);
}
function caller(tenantId: string | null = TENANT) {
  const ctx: TrpcContext = {
    req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"],
    authProvider: "legacy", tenantId,
    user: {
      id: USER, tenantId, externalOpenId: null, email: "operator@example.test", loginMethod: "legacy",
      fullName: "Operator", companyName: null, role: "user", isActive: true,
      lastSignedIn: date, createdAt: date, updatedAt: date,
    },
  };
  return bundleRouter.createCaller(ctx);
}
function invokeCaller(action: Action, tenant: string | null = TENANT) {
  const c = caller(tenant);
  if (action === "add") return c.addItem({ bundleId: PARENT, assemblyId: ASSEMBLY });
  if (action === "update") return c.updateItemQuantity({ bundleItemId: ITEM, quantity: "9" });
  return c.removeItem({ bundleItemId: ITEM });
}
function writes() { return model.events.filter(e => e.observed); }
function assertOneTransaction(expected: string[]) {
  const begins = model.events.filter(e => e.kind === "begin");
  expect(begins).toHaveLength(1);
  expect(model.events.map(e => e.table ? `${e.kind}:${e.table}` : e.kind)).toEqual(expected);
  for (const event of model.events) expect(event.handle).toBe(begins[0].handle);
  expect(begins[0].handle).not.toBe(rootId);
}
function expectSuccessfulResult(action: Action, result: unknown) {
  if (action === "add") {
    expect(result).toEqual({ ...item, id: NEW_ITEM, notes: null, quantity: "1", sortOrder: 5 });
    expect(model.confirmed.items.find(row => row.id === NEW_ITEM)).toEqual(result);
  } else if (action === "update") {
    expect(result).toEqual({ ...item, quantity: "9" });
    expect(model.confirmed.items.find(row => row.id === ITEM)).toEqual(result);
  } else {
    expect(result).toEqual({ bundleId: PARENT });
    expect(model.confirmed.items.some(row => row.id === ITEM)).toBe(false);
  }
  expect(model.confirmed.items.find(row => row.id === OTHER_ITEM)).toEqual(initialStore().items[1]);
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://isolated-driver/bundle-transactions");
  model.confirmed = initialStore();
  model.events = [];
  model.failReadback = false;
  model.missingReadback = false;
  model.failAfterWrite = null;
  model.failCommit = false;
  model.transactions = 0;
  audit.mockReset();
  audit.mockImplementation(async () => { model.events.push({ kind: "audit", handle: rootId }); return null; });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("RED regression: a performed quantity update is not confirmed when readback fails", async () => {
  model.failReadback = true;
  await expect(updateBundleItemQuantity(TENANT, ITEM, "9")).rejects.toThrow("readback failed after update");
  expect(writes()).toHaveLength(1);
  expect(writes()[0].observed?.items.find(row => row.id === ITEM)?.quantity).toBe("9");
  // The ORIGINAL helper fails only here: its root UPDATE has already published "9".
  expect(model.confirmed.items.find(row => row.id === ITEM)?.quantity).toBe("3");
});

describe.each(["false", "true"])("bundle item helpers, TENANT_STRICT=%s", strict => {
  beforeEach(() => { vi.stubEnv("TENANT_STRICT", strict); });
  for (const action of actions) {
    it(`${action} commits its existing result using one handle for all authorization and statements`, async () => {
      const result = await invoke(action);
      expectSuccessfulResult(action, result);
      const steps = action === "add"
        ? ["begin", "select:bundles", "select:bundle_items", "insert:bundle_items", "commit"]
        : ["begin", "select:bundle_items", "select:bundles", `${writeFor[action]}:bundle_items`, ...(action === "update" ? ["select:bundle_items"] : []), "commit"];
      assertOneTransaction(steps);
      const parentRead = model.events.find(e => e.kind === "select" && e.table === "bundles");
      expect(columnValue(parentRead?.where, "bundles", "id")).toBe(PARENT);
      expect(new PgDialect().sqlToQuery(parentRead!.where!).params).toContain(TENANT);
      if (action !== "add") {
        expect(columnValue(writes()[0].where, "bundle_items", "id")).toBe(ITEM);
        expect(columnValue(writes()[0].where, "bundle_items", "bundle_id")).toBe(PARENT);
      }
      expect(audit).not.toHaveBeenCalled(); // Callers own auditing.
    });

    it(`${action} refuses a foreign parent returned by the driver without a write`, async () => {
      model.confirmed.bundles[0].tenantId = FOREIGN;
      const before = structuredClone(model.confirmed);
      await expect(invoke(action)).rejects.toThrow(/not found/);
      expect(writes()).toEqual([]);
      expect(model.confirmed).toEqual(before);
      expect(model.events.at(-1)?.kind).toBe("rollback");
    });

    it(`${action} refuses a missing parent without writing the child`, async () => {
      model.confirmed.bundles = model.confirmed.bundles.filter(row => row.id !== PARENT);
      const before = structuredClone(model.confirmed);
      await expect(invoke(action)).rejects.toThrow(action === "add" ? `Bundle ${PARENT} not found` : `Bundle item ${ITEM} not found`);
      expect(writes()).toEqual([]);
      expect(model.confirmed).toEqual(before);
    });

    it(`${action} refuses an unresolved helper tenant without a write`, async () => {
      const before = structuredClone(model.confirmed);
      await expect(invoke(action, "")).rejects.toThrow(/Tenant scope is unresolved/);
      expect(writes()).toEqual([]);
      expect(model.confirmed).toEqual(before);
    });

    it(`${action} preserves the existing legacy-null decision`, async () => {
      model.confirmed.bundles[0].tenantId = null;
      if (strict === "true") {
        await expect(invoke(action)).rejects.toThrow(/not found/);
        expect(writes()).toEqual([]);
      } else {
        expectSuccessfulResult(action, await invoke(action));
        expect(model.confirmed.bundles[0].tenantId).toBeNull();
      }
    });

    it(`${action} discards its independent snapshot after a performed mutation throws`, async () => {
      const before = structuredClone(model.confirmed);
      model.failAfterWrite = writeFor[action];
      await expect(invoke(action)).rejects.toThrow(`${writeFor[action]} failed after mutation`);
      expect(writes()).toHaveLength(1);
      expect(writes()[0].observed).not.toEqual(before);
      expect(model.confirmed).toEqual(before);
      expect(model.events.at(-1)?.kind).toBe("rollback");
      expect(audit).not.toHaveBeenCalled();
    });
  }
  it.each(["update", "remove"] as const)("%s refuses a missing item before parent lookup", async action => {
    model.confirmed.items = model.confirmed.items.filter(row => row.id !== ITEM);
    const before = structuredClone(model.confirmed);
    await expect(invoke(action)).rejects.toThrow(`Bundle item ${ITEM} not found`);
    expect(model.events.some(e => e.table === "bundles")).toBe(false);
    expect(writes()).toEqual([]);
    expect(model.confirmed).toEqual(before);
  });
});

it.each(actions)("%s leaves confirmed state intact on an explicitly rejected commit", async action => {
  const before = structuredClone(model.confirmed);
  model.failCommit = true;
  await expect(invoke(action)).rejects.toThrow("commit explicitly rejected");
  expect(writes()).toHaveLength(1);
  expect(writes()[0].observed).not.toEqual(before);
  expect(model.confirmed).toEqual(before);
  expect(model.events.filter(e => e.kind === "commit")).toHaveLength(0);
  expect(audit).not.toHaveBeenCalled();
});

it("add preserves explicit zero quantity and optional=true while ordering within its parent", async () => {
  const result = await addItemToBundle(TENANT, { bundleId: PARENT, assemblyId: ASSEMBLY, quantity: "0", isOptional: true });
  expect(result).toMatchObject({ quantity: "0", isOptional: true, sortOrder: 5, bundleId: PARENT });
});
it("add defaults quantity/optional and starts at sortOrder=1 when the parent has no items", async () => {
  model.confirmed.items = model.confirmed.items.filter(row => row.bundleId !== PARENT);
  const result = await addItemToBundle(TENANT, { bundleId: PARENT, assemblyId: ASSEMBLY });
  expect(result).toMatchObject({ quantity: "1", isOptional: false, sortOrder: 1 });
});
it("preserves the existing undefined result when a readback returns no row without throwing", async () => {
  model.missingReadback = true;
  await expect(updateBundleItemQuantity(TENANT, ITEM, "9")).resolves.toBeUndefined();
  expect(model.confirmed.items.find(row => row.id === ITEM)?.quantity).toBe("9");
  expect(model.events.at(-1)?.kind).toBe("commit");
});

for (const action of actions) {
  it(`caller ${action} attempts its existing audit exactly once after helper commit`, async () => {
    const result = await invokeCaller(action);
    expectSuccessfulResult(action, result);
    expect(audit).toHaveBeenCalledTimes(1);
    const event = audit.mock.calls[0][0];
    expect(event).toEqual({
      userId: USER,
      action: `bundle.${action === "add" ? "addItem" : action === "update" ? "updateItemQuantity" : "removeItem"}`,
      tableName: "bundle_items", recordId: action === "add" ? NEW_ITEM : ITEM,
      before: action === "add" ? null : action === "update" ? { quantity: "3" } : { bundleId: PARENT },
      after: action === "remove" ? null : result,
    });
    expect(model.events.slice(-2).map(e => e.kind)).toEqual(["commit", "audit"]);
    const begin = model.events.findIndex(e => e.kind === "begin");
    const commit = model.events.findIndex(e => e.kind === "commit");
    for (const e of model.events.slice(begin, commit + 1)) expect(e.handle).toBe(model.events[begin].handle);
  });
  it(`caller ${action} emits no audit after rollback from a performed mutation`, async () => {
    const before = structuredClone(model.confirmed);
    model.failAfterWrite = writeFor[action];
    await expect(invokeCaller(action)).rejects.toThrow(/failed after mutation/);
    expect(writes()).toHaveLength(1);
    expect(model.confirmed).toEqual(before);
    expect(audit).not.toHaveBeenCalled();
  });
  it(`caller ${action} emits no audit after an explicitly rejected commit`, async () => {
    const before = structuredClone(model.confirmed);
    model.failCommit = true;
    await expect(invokeCaller(action)).rejects.toThrow("commit explicitly rejected");
    expect(model.confirmed).toEqual(before);
    expect(audit).not.toHaveBeenCalled();
  });
  it(`caller ${action} refuses foreign parent before helper transaction and audit`, async () => {
    model.confirmed.bundles[0].tenantId = FOREIGN;
    await expect(invokeCaller(action)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(model.transactions).toBe(0);
    expect(writes()).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
  it(`caller ${action} refuses unresolved tenant before reads, transaction and audit`, async () => {
    await expect(invokeCaller(action, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(model.events).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
}

it("duplicateBundle keeps its existing transaction and copies the source items/defaults", async () => {
  const result = await duplicateBundle(TENANT, PARENT, "Copy");
  expect(result).toMatchObject({ id: NEW_PARENT, tenantId: TENANT, name: "Copy" });
  expect(model.confirmed.items.find(row => row.id === NEW_ITEM)).toEqual({ ...item, id: NEW_ITEM, bundleId: NEW_PARENT });
  expect(model.transactions).toBe(1);
  expect(writes()).toHaveLength(2);
  expect(writes()[0].handle).toBe(writes()[1].handle);
});
it("duplicateBundle still discards both parent and child writes on rejected commit", async () => {
  const before = structuredClone(model.confirmed);
  model.failCommit = true;
  await expect(duplicateBundle(TENANT, PARENT, "Copy")).rejects.toThrow("commit explicitly rejected");
  expect(writes()).toHaveLength(2);
  expect(model.confirmed).toEqual(before);
});
