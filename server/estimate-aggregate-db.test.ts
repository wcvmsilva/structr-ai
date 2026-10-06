/** Actual exact loaders + pure engine; only the storage boundary is simulated. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./audit", () => ({ logAudit: io.audit, recordAuditAsync: io.audit }));
import { getExactEstimatePipeline, getExactEstimateStats } from "./estimate-aggregate-db";
import { getEstimateDraftStats } from "./estimate-db";
import { analyticsRouter } from "./analytics-router";
import { estimateRouter } from "./estimate-router";

const TENANT = "a6100000-0000-4000-8000-000000000001";
const FOREIGN = "a6100000-0000-4000-8000-000000000002";
const PROJECT = "b6100000-0000-4000-8000-000000000001";
const CLIENT = "b6100000-0000-4000-8000-000000000002";
const ACTOR = "c6100000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-20T12:00:00.000Z");
const id = (n: number) => `d6100000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
type Row = Record<string, unknown>;
type Store = { estimate_drafts: Row[]; leads: Row[]; historical_estimate_imports: Row[] };
let store: Store;
type Read = { table: string; sql: string; params: unknown[]; cursor: string | null; limit: number; ids: string[]; columns: string[] };
let reads: Read[];
let afterRead: ((read: Read) => void) | undefined;
let readError: Error | undefined;
let transactionError: Error | undefined;
const writes: string[] = [];
const camel = (key: string) => key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
const noEffect = (name: string) => () => { writes.push(name); throw new Error(`Unexpected ${name}`); };

function startIndex(rows: Row[], cursor: string | null) {
  if (cursor === null) return 0;
  let left = 0, right = rows.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (String(rows[middle].id) <= cursor) left = middle + 1; else right = middle;
  }
  return left;
}
function transactionSelect(snapshot: Store) {
  const historicalLinks = new Map(snapshot.historical_estimate_imports.map(row => [row.estimateDraftId, row.id]));
  return (columns?: Record<string, unknown>) => ({ from: (table: Table) => {
    const name = getTableName(table);
    let predicate: SQL | undefined, order: SQL[] = [], maximum = Infinity;
    const query = {
      where: (value: SQL) => { predicate = value; return query; },
      orderBy: (...values: SQL[]) => { order = values; return query; },
      limit: (value: number) => { maximum = value; return query; },
      for: () => { throw new Error("Read projections must not request authority locks"); },
      offset: () => { throw new Error("Keyset scan must not use OFFSET"); },
      then: (resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        if (readError) throw readError;
        if (name !== "estimate_drafts" && name !== "leads") throw new Error(`Unexpected scan table ${name}`);
        if (!predicate) throw new Error("Missing tenant predicate");
        const compiled = new PgDialect().sqlToQuery(predicate);
        const tenantTerms = [...compiled.sql.matchAll(new RegExp(`"${name}"\\."tenant_id" = \\$(\\d+)`, "g"))];
        if (!tenantTerms.length) throw new Error("Missing strict tenant identity");
        const tenant = compiled.params[Number(tenantTerms[0][1]) - 1];
        if (/tenant_id" is null/i.test(compiled.sql)) throw new Error("NULL tenant cannot be part of aggregate scope");
        const cursorTerm = compiled.sql.match(new RegExp(`"${name}"\\."id" > \\$(\\d+)`));
        const cursor = cursorTerm ? String(compiled.params[Number(cursorTerm[1]) - 1]) : null;
        expect(order.map(value => new PgDialect().sqlToQuery(value).sql)).toEqual([`"${name}"."id" asc`]);
        expect(Number.isInteger(maximum) && maximum >= 1 && maximum <= 500).toBe(true);
        if (name === "leads") {
          expect(compiled.sql.toLowerCase()).toContain('"leads"."status" not in');
          expect(compiled.sql.toLowerCase()).toContain('"leads"."converted_project_id" is null');
        }
        const selected: Row[] = [];
        const candidates = snapshot[name];
        for (let index = startIndex(candidates, cursor); index < candidates.length && selected.length < maximum; index++) {
          const row = candidates[index];
          if (row.tenantId !== tenant) continue;
          if (name === "leads" && (row.status == null || ["won", "lost", "disqualified", "converted"].includes(String(row.status)) || row.convertedProjectId != null)) continue;
          selected.push(row);
        }
        const read = { table: name, sql: compiled.sql, params: compiled.params, cursor, limit: maximum, ids: selected.map(row => String(row.id)), columns: Object.keys(columns ?? {}) };
        reads.push(read); afterRead?.(read);
        if (!columns) return structuredClone(selected);
        const projection = Object.entries(columns).map(([key, column]) => {
          if (key === "historicalImportId") {
            const expression = new PgDialect().sqlToQuery(column as SQL).sql;
            expect(expression).toContain('"historical_estimate_imports"');
            expect(expression).toContain('"estimate_draft_id"');
            expect(expression).toContain('"estimate_drafts"."id"');
            return [key, null] as const;
          }
          const field = (column as { name?: string }).name;
          if (!field) throw new Error(`Unsupported projection ${key}`);
          return [key, camel(field)] as const;
        });
        return selected.map(row => Object.fromEntries(projection.map(([key, field]) =>
          [key, field === null ? historicalLinks.get(row.id) ?? null : row[field]],
        )));
      }).then(resolve, reject),
    };
    return query;
  } });
}
const driver = {
  select: vi.fn(() => { throw new Error("Global pool read outside aggregate snapshot"); }),
  insert: noEffect("insert"), update: noEffect("update"), delete: noEffect("delete"),
  transaction: vi.fn(async <T>(work: (tx: { select: ReturnType<typeof transactionSelect>; insert: () => never; update: () => never; delete: () => never }) => Promise<T>) => {
    if (transactionError) throw transactionError;
    const snapshot = structuredClone(store);
    snapshot.estimate_drafts.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.leads.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return work({ select: transactionSelect(snapshot), insert: noEffect("insert"), update: noEffect("update"), delete: noEffect("delete") });
  }),
};
function legacy(n: number, override: Row = {}): Row {
  return {
    id: id(n), tenantId: TENANT, projectId: PROJECT, clientId: CLIENT, createdBy: ACTOR,
    source: "assembly_calculator", status: "draft", version: 1, supersededBy: null, changeOrderOf: null,
    a1VersionRequestId: null, a1VersionRequestHash: null, region: "stored-region", commercialChannel: "premium",
    subtotalCost: "40.00", subtotalPrice: "100.00", discountAmount: "0.00", finalTotalPrice: "100.00",
    grossProfitPct: "99.99", discountApplied: false, createdAt: NOW, lineItems: [], assemblySelections: [], ...override,
  };
}
function v2(n: number, override: Row = {}): Row {
  return legacy(n, {
    source: "version", version: 2, supersedesId: id(999_999), a1VersionRequestId: id(888_888), a1VersionRequestHash: "a".repeat(64),
    assemblyCount: 0, zone: null, scopeDraftId: null, pricingSchemaVersion: null,
    pricingSnapshot: { channel: null, finishLevel: null, region: "reviewed-region", zone: null, trade: null, coastalModifier: null, commercialChannel: "premium", geoRiskClass: null },
    lineItems: [{ costGroupName: "Group", costItemName: "Item", description: null, quantity: "1", unit: null, unitCostSnapshot: "40", unitPriceSnapshot: "100", lineTotalCost: "40.00", lineTotalPrice: "100.00", assemblyId: null, costCode: null, taxable: null }],
    ...override,
  });
}
function lead(n: number, override: Row = {}): Row {
  return { id: id(n), tenantId: TENANT, status: "qualified", convertedProjectId: null, commercialChannel: "premium", createdAt: NOW, ...override };
}
function data(result: any) { expect(result.state).toBe("available"); return result.data; }
function context(): TrpcContext {
  return { req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId: TENANT,
    user: { id: ACTOR, tenantId: TENANT, role: "user", isActive: true, externalOpenId: null,
      email: "aggregate@example.invalid", fullName: "Synthetic Operator", companyName: null, loginMethod: "legacy",
      lastSignedIn: NOW, createdAt: NOW, updatedAt: NOW } };
}
function noWrites() { expect(writes).toEqual([]); expect(io.audit).not.toHaveBeenCalled(); expect(driver.select).not.toHaveBeenCalled(); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TENANT_STRICT", "false");
  store = { estimate_drafts: [], leads: [], historical_estimate_imports: [] };
  reads = []; writes.length = 0; afterRead = undefined; readError = undefined; transactionError = undefined;
  io.getDb.mockResolvedValue(driver);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("C2-B exact aggregate read snapshots", () => {
  it.each(["stats", "pipeline"] as const)("refuses an unresolved tenant before IO for %s", async kind => {
    await expect(kind === "stats" ? getExactEstimateStats(null as never) : getExactEstimatePipeline({ tenantId: null as never }))
      .rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    expect(io.getDb).not.toHaveBeenCalled(); noWrites();
  });
  it.each(["stats", "pipeline"] as const)("returns DB_UNAVAILABLE, without empty success, for %s", async kind => {
    io.getDb.mockResolvedValue(null);
    const result = kind === "stats" ? await getExactEstimateStats(TENANT) : await getExactEstimatePipeline({ tenantId: TENANT, now: NOW });
    expect(result).toEqual({ state: "unavailable", reason: "DB_UNAVAILABLE" });
    expect(driver.transaction).not.toHaveBeenCalled(); noWrites();
  });
  it.each(["stats", "pipeline"] as const)("has one read-only repeatable-read transaction and one getDb for %s", async kind => {
    const result = kind === "stats" ? await getExactEstimateStats(TENANT) : await getExactEstimatePipeline({ tenantId: TENANT, now: NOW });
    expect(data(result).total ?? data(result).totalCount).toBe(0);
    expect(io.getDb).toHaveBeenCalledTimes(1);
    expect(driver.transaction).toHaveBeenCalledTimes(1);
    expect(driver.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    noWrites();
  });
  it("delegates the existing stats helper to the exact response without numeric aliases", async () => {
    store.estimate_drafts = [legacy(1)];
    const result = data(await getEstimateDraftStats(TENANT));
    expect(result).toMatchObject({ version: "estimate-draft-stats-exact-v1", total: 1, draftFinancials: { totalFinalPrice: { state: "known", value: "100.00" } } });
    expect(result).not.toHaveProperty("totalValue"); expect(result).not.toHaveProperty("avgGrossProfitPct"); noWrites();
  });
  it.each(["stats", "pipeline"] as const)("excludes foreign and NULL tenants with transitional flags off in %s", async kind => {
    store.estimate_drafts = [legacy(1), legacy(2, { tenantId: FOREIGN }), legacy(3, { tenantId: null })];
    store.leads = [lead(4), lead(5, { tenantId: FOREIGN }), lead(6, { tenantId: null })];
    const result = data(kind === "stats" ? await getExactEstimateStats(TENANT) : await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result.total ?? result.estimateCount).toBe(1);
    if (kind === "pipeline") expect(result.leadCount).toBe(1);
    expect(reads.every(read => read.params.includes(TENANT))).toBe(true); noWrites();
  });
  it("scans beyond 2,000 drafts in ascending UUID pages without duplicates or holes", async () => {
    store.estimate_drafts = Array.from({ length: 2_003 }, (_, i) => legacy(i + 1)).reverse();
    const result = data(await getExactEstimateStats(TENANT));
    expect(result.total).toBe(2_003); expect(result.draftFinancials.totalFinalPrice.value).toBe("200300.00");
    expect(reads.flatMap(read => read.ids)).toEqual(Array.from({ length: 2_003 }, (_, i) => id(i + 1)));
    expect(reads.map(read => read.cursor)).toEqual([null, id(500), id(1000), id(1500), id(2000)]); noWrites();
  });
  it("probes past an exact full page instead of truncating the stats population", async () => {
    store.estimate_drafts = Array.from({ length: 500 }, (_, i) => legacy(i + 1));
    expect(data(await getExactEstimateStats(TENANT)).total).toBe(500);
    expect(reads.map(read => read.ids.length)).toEqual([500, 0]); expect(reads[1].cursor).toBe(id(500));
  });
  it("enumerates more than2,000 leads and estimates in the same transaction", async () => {
    store.estimate_drafts = Array.from({ length: 2_001 }, (_, i) => legacy(i + 1));
    store.leads = Array.from({ length: 2_002 }, (_, i) => lead(i + 10_000));
    const result = data(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result).toMatchObject({ totalCount: 4_003, estimateCount: 2_001, leadCount: 2_002, grossEstimateValue: { value: "200100.00", coverage: { populationCount: 2_001 } } });
    expect(driver.transaction).toHaveBeenCalledTimes(1); noWrites();
  });
  it("keeps both tables at the same snapshot when live rows change between reads", async () => {
    store.estimate_drafts = Array.from({ length: 501 }, (_, i) => legacy(i + 1)); store.leads = [lead(1000)];
    afterRead = () => { store.estimate_drafts = [legacy(1, { finalTotalPrice: "999.00" })]; store.leads = [lead(2000), lead(2001)]; };
    const result = data(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result).toMatchObject({ estimateCount: 501, leadCount: 1, grossEstimateValue: { value: "50100.00" } }); noWrites();
  });
  it("counts every nonhistorical status for stats, but only draft financials", async () => {
    store.estimate_drafts = [legacy(1), legacy(2, { status: "archived" }), legacy(3, { status: "internally_approved" }), legacy(4, { supersededBy: id(5) }), legacy(5, { source: null })];
    const result = data(await getExactEstimateStats(TENANT));
    expect(result).toMatchObject({ total: 5, byStatus: { draft: 3, archived: 1, internally_approved: 1 }, draftFinancials: { count: 3, totalFinalPrice: { value: "300.00" } } });
  });
  it.each(["stats", "pipeline"] as const)("excludes source AND relation historical rows in %s without losing excluded count", async kind => {
    store.estimate_drafts = [legacy(1), legacy(2, { source: "historical_import" }), legacy(3, { source: "forged_source" })];
    store.historical_estimate_imports = [{ id: id(500), estimateDraftId: id(3) }];
    const result = data(kind === "stats" ? await getExactEstimateStats(TENANT) : await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result.excludedHistoricalCount).toBe(2); expect(result.total ?? result.estimateCount).toBe(1);
    expect(reads.every(read => read.table !== "historical_estimate_imports")).toBe(true); noWrites();
  });
  it("preserves opportunity statuses and excludes CO/successors while exposing A1 statuses", async () => {
    store.estimate_drafts = [legacy(1), legacy(2, { status: "sent" }), legacy(3, { status: "under_review" }), legacy(4, { status: "negotiation" }), legacy(5, { status: "internally_approved" }), legacy(6, { status: "internal_approval_revoked" }), legacy(7, { status: "approved" }), legacy(8, { supersededBy: id(9) }), legacy(9, { changeOrderOf: id(1) })];
    const result = data(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result.estimateCount).toBe(4); expect(result.grossEstimateValue.value).toBe("400.00");
    expect(result.outsideEstimatePopulationByStatus).toMatchObject({ internally_approved: 1, internal_approval_revoked: 1, approved: 1 });
    expect(result.byStage.map((row: { key: string }) => row.key).sort()).toEqual(["estimate_draft", "estimate_sent", "negotiation"]);
  });
  it("retains SQL's existing nonterminal unconverted lead population, including NULL status exclusion", async () => {
    store.leads = [lead(1), ...["won", "lost", "disqualified", "converted", null].map((status, i) => lead(i + 2, { status })), lead(8, { convertedProjectId: PROJECT })];
    const result = data(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result).toMatchObject({ totalCount: 1, leadCount: 1, estimateCount: 0, grossEstimateValue: { value: "0.00", coverage: { populationCount: 0 } } });
  });
  it("passes complete v2 projection and uses reviewed region/channel instead of flat conflicts", async () => {
    store.estimate_drafts = [v2(1, { region: "wrong-flat", commercialChannel: "capital" })];
    const stats = data(await getExactEstimateStats(TENANT));
    expect(stats.byRegion).toEqual([{ region: "reviewed-region", count: 1 }]); expect(stats.draftFinancials.totalFinalPrice.value).toBe("100.00");
    const pipeline = data(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(pipeline.byChannel.map((group: { key: string }) => group.key)).toEqual(["premium"]);
    expect(reads[0].columns).toEqual(expect.arrayContaining(["a1VersionRequestId", "a1VersionRequestHash", "lineItems", "assemblySelections", "pricingSnapshot", "assemblyCount", "discountApplied", "scopeDraftId", "supersedesId"]));
  });
  it("never erases partial v2 markers into a legacy financial fallback", async () => {
    store.estimate_drafts = [legacy(1, { a1VersionRequestId: id(90) })];
    const stats = data(await getExactEstimateStats(TENANT));
    expect(stats.total).toBe(1); expect(stats.draftFinancials.totalFinalPrice).toMatchObject({ state: "unavailable", reasons: ["INVALID_VERSION_PROJECTION"], coverage: { populationCount: 1, unknownCount: 1 } });
  });
  it("retains exact large cents and never substitutes missing final with subtotal", async () => {
    store.estimate_drafts = [legacy(1, { finalTotalPrice: "999999999999999999.99" }), legacy(2, { finalTotalPrice: "999999999999999999.99" })];
    expect(data(await getExactEstimateStats(TENANT)).draftFinancials.totalFinalPrice.value).toBe("1999999999999999999.98");
    store.estimate_drafts.push(legacy(3, { finalTotalPrice: null }));
    const result = data(await getExactEstimateStats(TENANT));
    expect(result.draftFinancials.totalFinalPrice).toMatchObject({ state: "unavailable", coverage: { populationCount: 3, knownCount: 2, unknownCount: 1 } });
  });
  it("derives draft GP from current final/cost with two decimals rather than stored GP", async () => {
    store.estimate_drafts = [legacy(1, { finalTotalPrice: "3.00", subtotalCost: "1.00", grossProfitPct: "1.00" })];
    expect(data(await getExactEstimateStats(TENANT)).draftFinancials).toMatchObject({ marginBasis: "mean_displayed_current_gp_2dp", margin: { state: "known", value: "66.67" } });
  });
  it("invalid timestamps are absent ages while one captured now serves both tables", async () => {
    store.estimate_drafts = [legacy(1, { createdAt: "not a date" }), legacy(2, { createdAt: new Date("2026-09-10T12:00:00Z") })];
    store.leads = [lead(3, { createdAt: new Date("2026-09-16T12:00:00Z") })];
    const result = data(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result.medianAgeDays).toBe(7);
  });
  it.each(["stats", "pipeline"] as const)("propagates unexpected driver errors instead of inventing empty/unavailable %s", async kind => {
    readError = Object.assign(new Error("private synthetic driver failure"), { code: "57014" });
    await expect(kind === "stats" ? getExactEstimateStats(TENANT) : getExactEstimatePipeline({ tenantId: TENANT, now: NOW })).rejects.toBe(readError); noWrites();
  });
  it("does not retry or reinterpret a transaction start/commit error", async () => {
    transactionError = Object.assign(new Error("synthetic transaction failure"), { code: "40001" });
    await expect(getExactEstimateStats(TENANT)).rejects.toBe(transactionError);
    expect(driver.transaction).toHaveBeenCalledTimes(1); noWrites();
  });
});

describe("C2-B actual route, loader and engine integration", () => {
  it("returns exact stats beyond2,000 rows through the existing route", async () => {
    store.estimate_drafts = Array.from({ length: 2_001 }, (_, i) => legacy(i + 1, { finalTotalPrice: "999999999999999999.99" }));
    const result = data(await estimateRouter.createCaller(context()).stats());
    expect(result.total).toBe(2_001);
    expect(result.draftFinancials.totalFinalPrice).toMatchObject({ state: "known", value: "2000999999999999999979.99" });
    expect(driver.transaction).toHaveBeenCalledTimes(1); noWrites();
  });
  it("uses the authenticated tenant for actual pipeline pages under transitional mode", async () => {
    store.estimate_drafts = [legacy(1), legacy(2, { tenantId: FOREIGN }), legacy(3, { tenantId: null })];
    store.leads = [lead(4), lead(5, { tenantId: FOREIGN }), lead(6, { tenantId: null })];
    const result = data(await analyticsRouter.createCaller(context()).getPipeline());
    expect(result).toMatchObject({ totalCount: 2, leadCount: 1, estimateCount: 1, grossEstimateValue: { value: "100.00" } });
    expect(reads.every(read => read.params.includes(TENANT))).toBe(true); noWrites();
  });
  it("keeps durable historical links out of routed opportunity money", async () => {
    store.estimate_drafts = [legacy(1), legacy(2, { source: "historical_import" }), legacy(3, { source: "assembly_calculator" })];
    store.historical_estimate_imports = [{ id: id(900), estimateDraftId: id(3) }];
    const result = data(await analyticsRouter.createCaller(context()).getPipeline());
    expect(result).toMatchObject({ excludedHistoricalCount: 2, estimateCount: 1, grossEstimateValue: { value: "100.00" }, basis: "opportunity_only" }); noWrites();
  });
  it("transports DB unavailability without zero-valued route success", async () => {
    io.getDb.mockResolvedValue(null);
    expect(await estimateRouter.createCaller(context()).stats()).toEqual({ state: "unavailable", reason: "DB_UNAVAILABLE" });
    expect(await analyticsRouter.createCaller(context()).getPipeline()).toEqual({ state: "unavailable", reason: "DB_UNAVAILABLE" }); noWrites();
  });
  it("transports incomplete scans without partial counts or monetary fields", async () => {
    store.estimate_drafts = Array.from({ length: 100_001 }, (_, i) => ({ id: id(i + 1), tenantId: TENANT, source: "historical_import", status: "draft" }));
    const result = await analyticsRouter.createCaller(context()).getPipeline();
    expect(result).toEqual({ state: "unavailable", reason: "INCOMPLETE_SCAN" });
    expect(result).not.toHaveProperty("data"); expect(result).not.toHaveProperty("totalCount"); noWrites();
  });
});

describe("C2-B explicit cumulative resource policy", () => {
  function historicalRows(count: number) { return Array.from({ length: count }, (_, i) => ({ id: id(i + 1), tenantId: TENANT, source: "historical_import", status: "draft" })); }
  it("refuses >100,000 records even when every row would be financially excluded", async () => {
    store.estimate_drafts = historicalRows(100_001);
    expect(await getExactEstimateStats(TENANT)).toEqual({ state: "unavailable", reason: "INCOMPLETE_SCAN" });
    expect(reads.at(-1)).toMatchObject({ cursor: id(100_000), limit: 1, ids: [id(100_001)] }); noWrites();
  });
  it("allows exactly100,000 only after an empty completion probe", async () => {
    store.estimate_drafts = historicalRows(100_000);
    const result = data(await getExactEstimateStats(TENANT));
    expect(result.total).toBe(0); expect(result.excludedHistoricalCount).toBe(100_000);
    expect(reads.at(-1)).toMatchObject({ cursor: id(100_000), limit: 1, ids: [] }); noWrites();
  });
  it("shares the same cap across lead and estimate scans rather than giving each100,000", async () => {
    store.estimate_drafts = historicalRows(100_000); store.leads = [lead(200_000)];
    expect(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW })).toEqual({ state: "unavailable", reason: "INCOMPLETE_SCAN" });
    expect(reads.filter(read => read.table === "leads").at(-1)).toMatchObject({ limit: 1, ids: [id(200_000)] }); noWrites();
  });
  it("checks the other empty scan before accepting exactly100,000 pipeline records", async () => {
    store.estimate_drafts = historicalRows(100_000);
    const result = data(await getExactEstimatePipeline({ tenantId: TENANT, now: NOW }));
    expect(result.totalCount).toBe(0); expect(result.excludedHistoricalCount).toBe(100_000);
    expect(reads.filter(read => read.table === "leads")).toHaveLength(1);
    expect(reads.filter(read => read.table === "leads")[0]).toMatchObject({ limit: 1, ids: [] }); noWrites();
  });
});
