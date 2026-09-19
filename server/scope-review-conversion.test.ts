/** Real conversion route/guards/audit with a transactional driver model, no live database. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";
const io = vi.hoisted(() => ({ getDb: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./rbac", () => ({ hasPermission: io.permission }));
import { scopeReviewRouter } from "./scope-review-router";

const TENANT = "a3200000-0000-4000-8000-000000000001";
const OTHER = "a3200000-0000-4000-8000-000000000002";
const USER = "b3200000-0000-4000-8000-000000000001";
const PROJECT = "c3200000-0000-4000-8000-000000000001";
const DRAFT = "d3200000-0000-4000-8000-000000000001";
const A = "e3200000-0000-4000-8000-000000000001";
const B = "e3200000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-19T12:00:00Z");
type Row = Record<string, any>;
type State = Record<string, Row[]>;
let state: State;
let failAt: string | undefined;
let sequence = 0;
const events: Array<{ operation: string; transactional: boolean }> = [];
function match(row: Row, table: string, predicate?: SQL) {
  if (!predicate) return true;
  const q = new PgDialect().sqlToQuery(predicate);
  const matches = Array.from(q.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g));
  if (!matches.length) throw new Error(`Unsupported test predicate ${q.sql}`);
  return matches.every(([, tableName, column, index]) => {
    if (tableName !== table) throw new Error("Unexpected table predicate");
    const key = column.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
    return row[key] === q.params[Number(index) - 1];
  });
}
function driverFor(getState: () => State, transactional: boolean) {
  function event(operation: string) {
    events.push({ operation, transactional });
    if (operation === failAt) throw new Error(`Injected ${operation}`);
  }
  return {
    select: () => ({ from: (table: Table) => {
      const name = getTableName(table); let predicate: SQL | undefined; let count = Infinity; let descending = false;
      const query = {
        where: (where: SQL) => { predicate = where; return query; },
        limit: (limit: number) => { count = limit; return query; },
        orderBy: (...columns: unknown[]) => { descending = columns.some(column => column && typeof column === "object" && "queryChunks" in column); return query; },
        for: (mode: string) => { events.push({ operation: `lock:${name}:${mode}`, transactional }); return query; },
        then: (resolve: (value: Row[]) => unknown, reject?: (error: unknown) => unknown) => {
          try {
            event(`read:${name}`);
            const result = (getState()[name] ?? []).filter(row => match(row, name, predicate));
            if (name === "scope_review_deltas") result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || String(b.id).localeCompare(String(a.id)));
            else if (name === "scope_draft_items") result.sort((a, b) => a.sortOrder - b.sortOrder);
            void descending;
            return Promise.resolve(structuredClone(result.slice(0, count))).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    } }),
    insert: (table: Table) => ({ values: (values: Row | Row[]) => ({ returning: async () => {
      const name = getTableName(table);
      const inserted = (Array.isArray(values) ? values : [values]).map(value => ({ id: `f3200000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, createdAt: NOW, updatedAt: NOW, ...structuredClone(value) }));
      (getState()[name] ??= []).push(...inserted);
      // Fail after the mutation, so rollback is observable rather than simulated in assertions.
      event(`insert:${name}`);
      return structuredClone(inserted);
    } }) }),
    update: (table: Table) => ({ set: (patch: Row) => ({ where: (predicate: SQL) => {
      const execute = async () => {
        const name = getTableName(table); const rows = (getState()[name] ?? []).filter(row => match(row, name, predicate));
        rows.forEach(row => Object.assign(row, structuredClone(patch))); event(`update:${name}`);
        return structuredClone(rows);
      };
      return { returning: execute, then: (resolve: (value: Row[]) => unknown, reject?: (error: unknown) => unknown) => execute().then(resolve, reject) };
    } }) }),
  };
}
const driver = {
  ...driverFor(() => state, false),
  transaction: async <T>(callback: (tx: ReturnType<typeof driverFor>) => Promise<T>) => {
    const pending = structuredClone(state);
    const result = await callback(driverFor(() => pending, true));
    events.push({ operation: "commit", transactional: true });
    if (failAt === "commit") throw new Error("Injected commit");
    state = pending;
    return result;
  },
};
function context(): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId: TENANT,
    user: { id: USER, tenantId: TENANT, role: "admin", isActive: true, externalOpenId: null, email: "operator@example.invalid", fullName: "Synthetic Operator", companyName: null, loginMethod: "legacy", lastSignedIn: NOW, createdAt: NOW, updatedAt: NOW },
  };
}
const convert = (ctx = context()) => scopeReviewRouter.createCaller(ctx).convertToBundle({ scopeDraftId: DRAFT, assemblyNameLookup: { [A]: "Untrusted client label" } });
function expectNoConversion() { expect(state.bundles).toEqual([]); expect(state.bundle_items).toEqual([]); expect(state.scope_review_snapshots).toEqual([]); expect(state.scope_drafts[0]?.status).toBe("approved"); expect(state.audit_logs).toEqual([]); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TENANT_STRICT", "true"); sequence = 0; failAt = undefined; events.length = 0;
  state = {
    profiles: [{ id: USER, tenantId: TENANT, role: "admin", isActive: true }],
    projects: [{ id: PROJECT, tenantId: TENANT, ownerUserId: USER, deletedAt: null }],
    scope_drafts: [{ id: DRAFT, tenantId: TENANT, projectId: PROJECT, status: "approved", approvedBy: USER, approvedAt: NOW, confidence: "0.9", warningsJson: [], serviceType: "remodel" }],
    scope_draft_items: [
      { id: "item-a", scopeDraftId: DRAFT, assemblyId: A, quantity: "2.5", unit: "EA", reason: "Synthetic reason A", confidence: "0.9", sortOrder: 0 },
      { id: "item-b", scopeDraftId: DRAFT, assemblyId: B, quantity: "4", unit: "LF", reason: "Synthetic reason B", confidence: "0.8", sortOrder: 1 },
    ],
    scope_review_deltas: [], scope_review_snapshots: [], bundles: [], bundle_items: [], audit_logs: [],
    assemblies: [{ id: A, tenantId: TENANT, name: "Synthetic assembly A", isActive: true }, { id: B, tenantId: TENANT, name: "Synthetic assembly B", isActive: true }],
  };
  io.getDb.mockResolvedValue(driver); io.permission.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe("scope review creates a real bundle atomically", () => {
  it("returns a real bundle and linked snapshot with approved quantities and no invented discount", async () => {
    const result = await convert();
    expect(result).toMatchObject({ id: DRAFT, status: "converted", bundleId: expect.any(String), snapshotId: expect.any(String), approvedItemCount: 2 });
    expect(state.bundles).toHaveLength(1); expect(state.bundles[0]).toMatchObject({ id: Reflect.get(result, "bundleId"), tenantId: TENANT, bundleDiscount: "0" });
    expect(state.bundle_items.map(({ assemblyId, quantity, sortOrder, isOptional }) => ({ assemblyId, quantity, sortOrder, isOptional }))).toEqual([
      { assemblyId: A, quantity: "2.5", sortOrder: 0, isOptional: false }, { assemblyId: B, quantity: "4", sortOrder: 1, isOptional: false },
    ]);
    expect(state.scope_review_snapshots).toHaveLength(1);
    expect(state.scope_review_snapshots[0]).toMatchObject({ id: result.snapshotId, bundleId: state.bundles[0].id, scopeDraftId: DRAFT, approvedBy: USER, approvedAt: NOW, decision: "converted", deltaCount: 0 });
    expect(state.scope_review_snapshots[0].approvedItems).toEqual(expect.arrayContaining([expect.objectContaining({ assemblyId: A, assemblyName: "Synthetic assembly A", quantity: 2.5 })]));
    expect(state.scope_drafts[0]).toMatchObject({ status: "converted", approvedBy: USER, approvedAt: NOW });
    expect(events).toContainEqual({ operation: "lock:scope_drafts:update", transactional: true });
    expect(events.filter(event => /^(insert|update):/.test(event.operation)).every(event => event.transactional)).toBe(true);
    expect(state.audit_logs).toEqual(expect.arrayContaining([expect.objectContaining({ action: "scope_converted_to_bundle", oldValues: { status: "approved" }, newValues: expect.objectContaining({ bundleId: state.bundles[0].id, snapshotId: result.snapshotId }) })]));
  });
  it("uses the latest review quantities and excludes removed assemblies in bundle and snapshot", async () => {
    state.scope_review_deltas = [
      { id: "delta-old", scopeDraftId: DRAFT, assemblyId: A, actionType: "quantity_adjustment", previousQuantity: "2.5", newQuantity: "7", createdAt: new Date(NOW.getTime()-1000), operatorReason: "Old synthetic correction" },
      { id: "delta-new", scopeDraftId: DRAFT, assemblyId: A, actionType: "quantity_adjustment", previousQuantity: "7", newQuantity: "3.75", createdAt: NOW, operatorReason: "Approved synthetic correction" },
      { id: "delta-remove", scopeDraftId: DRAFT, assemblyId: B, actionType: "remove", previousQuantity: "4", newQuantity: null, createdAt: NOW, operatorReason: "Synthetic exclusion" },
    ];
    await convert(); expect(state.bundle_items).toHaveLength(1); expect(state.bundle_items[0]).toMatchObject({ assemblyId: A, quantity: "3.75" });
    expect(state.scope_review_snapshots[0]).toMatchObject({ deltaCount: 3, approvedItems: [expect.objectContaining({ assemblyId: A, quantity: 3.75 })] });
  });
  it.each(["insert:bundles", "insert:bundle_items", "insert:scope_review_snapshots", "update:scope_drafts", "insert:audit_logs", "commit"])("rolls back every business and audit row after %s fails", async failure => {
    failAt = failure; const before = structuredClone(state);
    await expect(convert()).rejects.toThrow(`Injected ${failure}`);
    expect(state).toEqual(before);
  });
  it("refuses a duplicate request after successful conversion without another bundle", async () => {
    await convert(); const before = structuredClone(state);
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state).toEqual(before);
  });
  it.each([null, "", "0", "-1", "NaN", "Infinity", "1junk"])("rejects an unusable quantity %s before creating rows", async quantity => {
    state.scope_draft_items[0].quantity = quantity;
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expectNoConversion();
  });
  it("refuses an empty approved selection", async () => {
    state.scope_draft_items = [];
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expectNoConversion();
  });
  it("refuses a missing assembly identity", async () => {
    state.scope_draft_items[0].assemblyId = null;
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expectNoConversion();
  });
  it("refuses duplicate assemblies rather than silently merging quantities", async () => {
    state.scope_draft_items[1].assemblyId = A;
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expectNoConversion();
  });
  it.each(["missing", "inactive", "foreign"])("refuses a %s catalog assembly", async kind => {
    if (kind === "missing") state.assemblies.shift();
    if (kind === "inactive") state.assemblies[0].isActive = false;
    if (kind === "foreign") state.assemblies[0].tenantId = OTHER;
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expectNoConversion();
  });
  it.each([true, false])("preserves the catalog null-row policy with strict=%s", async strict => {
    vi.stubEnv("TENANT_STRICT", String(strict)); state.assemblies[0].tenantId = null;
    if (strict) { await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expectNoConversion(); }
    else { await convert(); expect(state.bundles[0].tenantId).toBe(TENANT); expect(state.assemblies[0].tenantId).toBeNull(); }
  });
  it.each(["approvedBy", "approvedAt"])("refuses incomplete original approval evidence: %s", async field => {
    state.scope_drafts[0][field] = null;
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expectNoConversion();
  });
  it("rejects an existing snapshot instead of creating an ambiguous second one", async () => {
    state.scope_review_snapshots = [{ id: "existing", scopeDraftId: DRAFT, bundleId: null }];
    const before = structuredClone(state);
    await expect(convert()).rejects.toMatchObject({ code: "CONFLICT" }); expect(state).toEqual(before);
  });
  it("preserves warnings without treating scope confidence as price approval", async () => {
    state.scope_draft_items[0].confidence = "0.4"; state.scope_drafts[0].confidence = "0.5"; state.scope_drafts[0].warningsJson = ["Synthetic source warning"];
    const result = await convert(); expect(result.profitShieldWarnings).toHaveLength(2); expect(result.warnings).toContain("Synthetic source warning");
    expect(state.scope_review_snapshots[0].snapshotData.warnings).toEqual(result.warnings);
  });
  it.each(["draft", "under_review", "rejected"])("cannot convert a %s scope", async status => {
    state.scope_drafts[0].status = status; const before = structuredClone(state);
    await expect(convert()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state).toEqual(before);
  });
  it("denies a non-admin before any reads", async () => {
    const ctx = context(); ctx.user!.role = "user";
    await expect(convert(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(events).toEqual([]);
  });
  it("denies an unresolved caller tenant even if the persisted profile has a tenant", async () => {
    const ctx = context(); ctx.tenantId = null;
    await expect(convert(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" }); expectNoConversion();
  });
  it("denies a cross-tenant project even for admin", async () => {
    state.projects[0].tenantId = OTHER;
    await expect(convert()).rejects.toMatchObject({ code: "FORBIDDEN" }); expectNoConversion();
  });
  it("denies a mismatched scope tenant despite an accessible project", async () => {
    state.scope_drafts[0].tenantId = OTHER;
    await expect(convert()).rejects.toMatchObject({ code: "FORBIDDEN" }); expectNoConversion();
  });
  it("validates the draft UUID before any reads", async () => {
    await expect(scopeReviewRouter.createCaller(context()).convertToBundle({ scopeDraftId: "bad" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(events).toEqual([]);
  });
});
