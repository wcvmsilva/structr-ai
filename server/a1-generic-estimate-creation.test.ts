import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const io = vi.hoisted(() => ({ drizzle: vi.fn(), audit: vi.fn(), access: vi.fn() }));
vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: io.drizzle }));
vi.mock("./audit", () => ({ logAudit: io.audit }));
vi.mock("./project-access", () => ({ requireProjectAccess: io.access }));
import { createEstimateDraft } from "./db";

const P = "a8700000-0000-4000-8000-000000000001";
const T = "a8700000-0000-4000-8000-000000000002";
const U = "a8700000-0000-4000-8000-000000000003";
const C = "a8700000-0000-4000-8000-000000000004";
const D = "a8700000-0000-4000-8000-000000000005";
const REF = "a8700000-0000-4000-8000-000000000006";
const OTHER = "a8700000-0000-4000-8000-000000000007";
type Row = Record<string, any>;
const rows: Record<string, Row[]> = {};
const events: string[] = [];
const committed: Row[] = [];
let staged: Row[] = [];
let emptyInsert = false;
const reads: Array<{ table: string; params: unknown[]; handle: unknown }> = [];
const dialect = new PgDialect();

// This fake models commit/rollback and captures actual query bindings. It is not
// evidence of PostgreSQL locking; the separate physical suites own that proof.
function handle(label: string) {
  const db: any = {
    select: () => ({ from: (table: Table) => {
      const name = getTableName(table);
      let predicate: any;
      const query: any = {
        where: (value: unknown) => { predicate = value; return query; },
        limit: () => query,
        for: (mode: string) => { events.push(`${label}:lock:${name}:${mode}`); return query; },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const params = predicate ? dialect.sqlToQuery(predicate).params : [];
          reads.push({ table: name, params, handle: db });
          events.push(`${label}:read:${name}`);
          const result = (rows[name] ?? []).filter(row => {
            if (name === "historical_estimate_imports") return params.includes(row.estimateDraftId);
            return params.includes(row.id) && (!params.includes(T) || row.tenantId === undefined || row.tenantId === T);
          });
          return Promise.resolve(structuredClone(result)).then(resolve, reject);
        },
      };
      return query;
    } }),
    insert: (table: Table) => ({ values: (values: Row) => ({ returning: async () => {
      events.push(`${label}:insert:${getTableName(table)}`);
      if (emptyInsert) return [];
      const row = structuredClone({ id: D, ...values });
      (label === "tx" ? staged : committed).push(row);
      return [row];
    } }) }),
  };
  return db;
}
const tx = handle("tx");
const pool = Object.assign(handle("pool"), {
  transaction: vi.fn(async (work: (tx: any) => Promise<unknown>) => {
    events.push("begin"); staged = [];
    try {
      const result = await work(tx);
      committed.push(...staged); staged = []; events.push("commit"); return result;
    } catch (error) {
      staged = []; events.push("rollback"); throw error;
    }
  }),
});
const priced = {
  bundleName: "Synthetic priced draft", channel: "direct", region: "charleston", finishLevel: "standard",
  lineItems: [{ costItemName: "Synthetic material", quantity: 1 }],
  assemblySelections: [{ assemblyId: REF, quantity: 1 }], subtotalCost: "600.00", subtotalPrice: "1000.00",
  grossProfit: "400.00", grossProfitPct: "40.00", finalTotalPrice: "1000.00", assemblyCount: 1,
  profitShieldPassed: true, profitShieldMinPct: "35.00", notes: "Synthetic note", clientId: C,
  projectId: P, metadata: { provenance: "synthetic" },
};
const input = (withPrice = false): any => ({
  projectId: P, tenantId: T, createdBy: U, source: withPrice ? "scope_draft" : "bundle_legacy",
  draftData: { synthetic: true }, ...(withPrice ? { priced: structuredClone(priced) } : {}),
});
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://synthetic:synthetic@127.0.0.1:1/unused");
  for (const key of Object.keys(rows)) delete rows[key];
  rows.projects = [{ id: P, tenantId: T, clientId: C, deletedAt: null }];
  rows.tenants = [{ id: T, isActive: true }];
  rows.profiles = [{ id: U, tenantId: T, isActive: true }];
  rows.clients = [{ id: C, tenantId: T, isActive: true, deletedAt: null }];
  rows.estimate_drafts = [{ id: REF, tenantId: T, projectId: P, clientId: C, source: "assembly_calculator" }];
  rows.historical_estimate_imports = [];
  committed.length = 0; staged = []; reads.length = 0; events.length = 0; emptyInsert = false;
  pool.transaction.mockClear(); io.drizzle.mockReturnValue(pool);
  io.audit.mockReset().mockImplementation(async () => { events.push("audit"); return { id: REF }; });
  io.access.mockReset().mockResolvedValue({ projectId: P, tenantId: T, via: "owner" });
});
afterAll(() => vi.unstubAllEnvs());

describe("generic formation cannot assign internal approval authority", () => {
  it.each(["approved", "internally_approved", "internal_approval_revoked"].flatMap(status => [
    { status, withPrice: true }, { status, withPrice: false },
  ]))("refuses $status (priced=$withPrice) before writing", async ({ status, withPrice }) => {
    await expect(createEstimateDraft({ ...input(withPrice), status })).rejects.toMatchObject({
      code: "ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION",
    });
    expect(committed).toEqual([]); expect(events.some(e => e.includes(":insert:"))).toBe(false);
    expect(io.audit).not.toHaveBeenCalled();
  });
  it.each([true, false])("preserves the supplied price/context and forms only a draft (priced=%s)", async withPrice => {
    const payload = input(withPrice); const original = structuredClone(payload);
    const result = await createEstimateDraft(payload);
    expect(payload).toEqual(original);
    expect(result).toMatchObject({ tenantId: T, projectId: P, clientId: C, createdBy: U, status: "draft" });
    if (withPrice) expect(result).toMatchObject(priced);
    expect(result).not.toHaveProperty("approvedAt");
    expect(result).not.toHaveProperty("a1VersionRequestId");
    expect(committed).toHaveLength(1);
  });
});

describe("generic creation uses trusted context and an atomic audit", () => {
  it.each([true, false])("commits insert and durable audit through one transaction (priced=%s)", async withPrice => {
    await createEstimateDraft(input(withPrice));
    expect(pool.transaction).toHaveBeenCalledTimes(1);
    expect(events).toContain("tx:insert:estimate_drafts");
    expect(events).not.toContain("pool:insert:estimate_drafts");
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: U, action: withPrice ? "estimate.create_from_scope" : "estimate_draft.created",
      tableName: "estimate_drafts", recordId: D, before: null,
      after: expect.objectContaining({ tenantId: T, createdBy: U, projectId: P }),
    }), tx);
    expect(events.indexOf("audit")).toBeLessThan(events.indexOf("commit"));
  });
  it.each([true, false].flatMap(withPrice => [
    { withPrice, failure: "throw" }, { withPrice, failure: "empty" },
  ]))("rolls back when audit is $failure (priced=$withPrice)", async ({ withPrice, failure }) => {
    if (failure === "throw") io.audit.mockRejectedValue(new Error("Synthetic audit failure"));
    else io.audit.mockResolvedValue(null);
    await expect(createEstimateDraft(input(withPrice))).rejects.toThrow();
    expect(committed).toEqual([]); expect(staged).toEqual([]);
    expect(events).toContain("rollback"); expect(events).not.toContain("commit");
  });
  it("does not audit a missing inserted row", async () => {
    emptyInsert = true;
    await expect(createEstimateDraft(input())).rejects.toThrow("Estimate creation returned no row");
    expect(io.audit).not.toHaveBeenCalled(); expect(committed).toEqual([]);
  });
  it("revalidates write permission on the transaction that inserts", async () => {
    await createEstimateDraft(input());
    expect(io.access).toHaveBeenCalledWith(P, U, "write", { mode: "a1", transaction: tx, expectedTenantId: T });
    expect(reads.filter(r => ["projects", "profiles", "tenants", "clients"].includes(r.table)).every(r => r.handle === tx)).toBe(true);
    expect(reads.some(r => r.table === "projects" && r.params.includes(P) && r.params.includes(T))).toBe(true);
  });
  it("does not insert after permission is withdrawn", async () => {
    io.access.mockRejectedValue(new Error("Synthetic permission denial"));
    await expect(createEstimateDraft(input())).rejects.toThrow("Synthetic permission denial");
    expect(committed).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });
  it.each(["tenantId", "createdBy"])("refuses missing trusted %s", async key => {
    const payload = input(); delete payload[key];
    await expect(createEstimateDraft(payload)).rejects.toMatchObject({ code: "ESTIMATE_CONTEXT_UNRESOLVED" });
    expect(committed).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });
  it.each([
    ["projects", "deletedAt", new Date("2026-01-01T00:00:00Z")],
    ["projects", "tenantId", OTHER], ["tenants", "isActive", false],
    ["profiles", "isActive", false], ["profiles", "tenantId", OTHER],
    ["clients", "tenantId", OTHER], ["clients", "isActive", false],
    ["clients", "deletedAt", new Date("2026-01-01T00:00:00Z")],
  ])("refuses invalid %s.%s", async (table, field, value) => {
    rows[String(table)][0][String(field)] = value;
    await expect(createEstimateDraft(input(true))).rejects.toMatchObject({ code: "ESTIMATE_CONTEXT_UNRESOLVED" });
    expect(committed).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });
  it("refuses a priced client that differs from the project", async () => {
    const payload = input(true); payload.priced.clientId = OTHER;
    await expect(createEstimateDraft(payload)).rejects.toMatchObject({ code: "ESTIMATE_CONTEXT_UNRESOLVED" });
    expect(committed).toEqual([]);
  });
  it("retains an incomplete project as a draft without inventing its client", async () => {
    rows.projects[0].clientId = null; rows.clients = [];
    const payload = input(true); payload.priced.clientId = null;
    expect(await createEstimateDraft(payload)).toMatchObject({ clientId: null, status: "draft" });
  });
  it.each(["supersedesId", "changeOrderOf"])("checks historical %s on the same transaction before insert", async reference => {
    rows.historical_estimate_imports = [{ id: D, estimateDraftId: REF }];
    await expect(createEstimateDraft({ ...input(), [reference]: REF })).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
    expect(reads.filter(r => ["estimate_drafts", "historical_estimate_imports"].includes(r.table)).every(r => r.handle === tx)).toBe(true);
    expect(reads.some(r => r.table === "historical_estimate_imports")).toBe(true);
    expect(committed).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
  });
});
