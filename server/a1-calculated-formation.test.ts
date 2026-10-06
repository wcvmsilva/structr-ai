import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { EstimateDraftPersistPayload } from "@shared/estimate-engine";

const deps = vi.hoisted(() => ({ getDb: vi.fn(), access: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
vi.mock("./project-access", () => ({ requireProjectAccess: deps.access }));
vi.mock("./audit", () => ({ logAudit: deps.audit }));
import { createEstimateDraftFromCalculator } from "./estimate-db";

const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const TENANT = id(1), USER = id(2), PROJECT = id(3), CLIENT = id(4), DRAFT = id(5);
type Row = Record<string, unknown>;
let records: Record<string, Row[]>;
let committed: Array<{ table: string; value: Row }>;
let locks: string[];
let txSeen: unknown;
let failAudit: boolean;

function connection(writes: typeof committed) {
  return {
    select() {
      let table = "";
      const result = () => table === "estimate_drafts"
        ? writes.filter(w => w.table === table).map(w => w.value)
        : records[table] ?? [];
      const q = {
        from(t: Parameters<typeof getTableName>[0]) { table = getTableName(t); return q; },
        where() { return q; }, limit() { return q; },
        for(mode: string) { locks.push(`${table}:${mode}`); return q; },
        then(resolve: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return q;
    },
    insert(t: Parameters<typeof getTableName>[0]) {
      return { values(value: Row) {
        const stored = { id: DRAFT, version: 1, ...value };
        writes.push({ table: getTableName(t), value: stored });
        return { returning: async () => [stored] };
      } };
    },
  };
}

const payload = (): EstimateDraftPersistPayload => ({
  bundleName: "Synthetic calculated phase", channel: "direct", region: "charleston_sc",
  finishLevel: "standard", lineItems: [], assemblySelections: [],
  subtotalCost: "1500.00", subtotalPrice: "3600.00", grossProfit: "2100.00",
  grossProfitPct: "58.333333", finalTotalPrice: "3600.00", assemblyCount: 0,
  profitShieldPassed: true, profitShieldMinPct: "35.00", notes: "Original calculated notes",
  projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: { original: true },
});

beforeEach(() => {
  vi.clearAllMocks(); committed = []; locks = []; failAudit = false; txSeen = undefined;
  records = {
    projects: [{ id: PROJECT, tenantId: TENANT, clientId: CLIENT, deletedAt: null }],
    tenants: [{ id: TENANT, isActive: true }],
    profiles: [{ id: USER, tenantId: TENANT, isActive: true }],
    clients: [{ id: CLIENT, tenantId: TENANT, isActive: true, deletedAt: null }],
  };
  const db = { ...connection(committed), async transaction(work: (tx: ReturnType<typeof connection>) => Promise<unknown>) {
    const staged: typeof committed = [];
    const tx = connection(staged); txSeen = tx;
    const result = await work(tx);
    committed.push(...staged);
    return result;
  } };
  deps.getDb.mockResolvedValue(db);
  deps.access.mockResolvedValue({ projectId: PROJECT, tenantId: TENANT, via: "owner" });
  deps.audit.mockImplementation(async (params, tx) => {
    if (failAudit) throw new Error("synthetic audit failure");
    return { id: id(7), ...params, transaction: tx };
  });
});

// The actor and tenant arguments are trusted server context, never calculator payload fields.
const create = (input = payload(), tenant = TENANT, actor = USER) =>
  createEstimateDraftFromCalculator(input, actor, tenant);

describe("A1 existing calculator formation", () => {
  it("persists authenticated tenant and canonical project client", async () => {
    expect(await create()).toMatchObject({ tenantId: TENANT, projectId: PROJECT, clientId: CLIENT });
  });
  it("ignores a forged tenant inside the calculator payload", async () => {
    expect(await create({ ...payload(), tenantId: id(99) } as EstimateDraftPersistPayload)).toMatchObject({ tenantId: TENANT });
  });
  it("accepts an explicitly matching project client", async () => {
    expect(await create({ ...payload(), clientId: CLIENT })).toMatchObject({ clientId: CLIENT });
  });
  it("preserves calculated financials, lines, source and metadata without repricing", async () => {
    const input = payload();
    expect(await create(input)).toMatchObject({ ...input, clientId: CLIENT, source: "assembly_calculator", pricingSchemaVersion: "1.0", status: "draft" });
    expect(input.clientId).toBeNull();
  });
  it("retains a valid project with no client as an incomplete draft", async () => {
    records.projects[0].clientId = null;
    expect(await create()).toMatchObject({ projectId: PROJECT, clientId: null, tenantId: TENANT, status: "draft" });
  });
  it("rechecks project write permission on the transaction handle", async () => {
    await create();
    expect(deps.access).toHaveBeenCalledWith(PROJECT, USER, "write", { mode: "a1", transaction: txSeen, expectedTenantId: TENANT });
    expect(locks[0]).toBe("projects:update");
    expect(locks).toEqual(expect.arrayContaining(["clients:share", "tenants:share", "profiles:share"]));
  });
  it("records a durable audit with preserved identity on that handle", async () => {
    await create();
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, action: "estimate_draft.create", recordId: DRAFT, before: null, after: expect.objectContaining({ tenantId: TENANT, projectId: PROJECT, clientId: CLIENT }) }), txSeen);
  });
  it("rolls creation back when its audit fails", async () => {
    failAudit = true;
    await expect(create()).rejects.toThrow("synthetic audit failure");
    expect(committed).toEqual([]);
  });
  it("refuses a missing durable audit record", async () => {
    deps.audit.mockResolvedValueOnce(null);
    await expect(create()).rejects.toThrow();
    expect(committed).toEqual([]);
  });
  it("does not write after permission withdrawal", async () => {
    deps.access.mockRejectedValue(new Error("access withdrawn"));
    await expect(create()).rejects.toThrow("access withdrawn");
    expect(committed).toEqual([]);
  });
  it.each([
    ["missing project", () => { records.projects = []; }],
    ["deleted project", () => { records.projects[0].deletedAt = new Date(); }],
    ["foreign project", () => { records.projects[0].tenantId = id(99); }],
    ["unowned project", () => { records.projects[0].tenantId = null; }],
    ["missing canonical client", () => { records.clients = []; }],
    ["inactive client", () => { records.clients[0].isActive = false; }],
    ["deleted client", () => { records.clients[0].deletedAt = new Date(); }],
    ["foreign client", () => { records.clients[0].tenantId = id(99); }],
    ["unowned client", () => { records.clients[0].tenantId = null; }],
    ["inactive tenant", () => { records.tenants[0].isActive = false; }],
    ["missing tenant", () => { records.tenants = []; }],
    ["inactive actor", () => { records.profiles[0].isActive = false; }],
    ["foreign actor", () => { records.profiles[0].tenantId = id(99); }],
    ["missing actor", () => { records.profiles = []; }],
  ] as const)("refuses %s before persisting", async (_label, alter) => {
    alter(); await expect(create()).rejects.toThrow(); expect(committed).toEqual([]);
  });
  it.each(["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"])("refuses invalid trusted tenant %s", async tenant => {
    await expect(create(payload(), tenant)).rejects.toThrow(); expect(committed).toEqual([]);
  });
  it("refuses a supplied client other than the canonical project client", async () => {
    await expect(create({ ...payload(), clientId: id(99) })).rejects.toThrow(); expect(committed).toEqual([]);
  });
  it("does not guess a client for an unlinked project", async () => {
    records.projects[0].clientId = null;
    await expect(create({ ...payload(), clientId: CLIENT })).rejects.toThrow(); expect(committed).toEqual([]);
  });
  it("requires the project demanded by the physical draft schema", async () => {
    await expect(create({ ...payload(), projectId: null })).rejects.toThrow(); expect(committed).toEqual([]);
  });
});
