/** B1: getMonitoringMetrics' approved count must exclude historical drafts, like the other
 * six nonHistoricalEstimateCondition() consumers, while still counting legacy NULL-source
 * approved estimates. This is a plain relational count, so the driver here evaluates the
 * real generated SQL predicate (via PgDialect) and aggregates it, unlike the row-projection
 * driver in historical-estimate-guards.test.ts which has no COUNT() support.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const io = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
import { getMonitoringMetrics, getEstimateStatusDistribution, getRecentAuditActivity } from "./field-launch-db";

const TENANT = "72000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "72000000-0000-4000-8000-00000000000f";
const PROJECT = "72000000-0000-4000-8000-000000000002";
const HISTORICAL_DRAFT = "72000000-0000-4000-8000-000000000003";
const CALCULATED_DRAFT = "72000000-0000-4000-8000-000000000004";
const IMPORT = "72000000-0000-4000-8000-000000000005";
type Row = Record<string, any>;
let state: Record<string, Row[]>;
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function matches(table: string, row: Row, predicate?: SQL): boolean {
  if (!predicate) return true;
  const { sql: statement, params } = new PgDialect().sqlToQuery(predicate);
  if (/not exists/i.test(statement) && statement.includes("historical_estimate_imports")) {
    if ((state.historical_estimate_imports ?? []).some(value => value.estimateDraftId === row.id)) return false;
  }
  for (const [, name, column, position] of statement.matchAll(/"([a-z_]+)"\."([a-z_]+)"\s*=\s*\$(\d+)/g)) {
    if (name === table && row[camel(column)] !== params[Number(position) - 1]) return false;
  }
  for (const [, name, column, position] of statement.matchAll(/"([a-z_]+)"\."([a-z_]+)" is distinct from \$(\d+)/gi)) {
    if (name === table && row[camel(column)] === params[Number(position) - 1]) return false;
  }
  return true;
}
function database(): any {
  return {
    select: (columns?: Record<string, any>) => ({ from: (table: Table) => {
      const name = getTableName(table);
      let predicate: SQL | undefined;
      let groupByColumn: string | undefined;
      const query: any = {
        where: (value: SQL) => { predicate = value; return query; },
        orderBy: () => query, limit: () => query,
        groupBy: (col: any) => { groupByColumn = col?.name; return query; },
        // Joins are irrelevant to the approved-count assertions this file makes (they only
        // touch estimate_drafts); a no-op keeps the driver from throwing when the tenant-scoped
        // audit-log/feedback joins in getMonitoringMetrics run alongside the count under test.
        innerJoin: () => query,
        then: (resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) => {
          const rows = (state[name] ?? []).filter(row => matches(name, row, predicate));
          const isCount = !!columns && Object.keys(columns).length === 1 && "count" in columns;
          let result: unknown[] = rows;
          if (isCount) {
            result = [{ count: rows.length }];
          } else if (groupByColumn && columns && "count" in columns) {
            const groupKey = Object.keys(columns).find(k => k !== "count")!;
            const counts = new Map<string, number>();
            for (const row of rows) counts.set(row[camel(groupByColumn)], (counts.get(row[camel(groupByColumn)]) ?? 0) + 1);
            result = [...counts.entries()].map(([value, cnt]) => ({ [groupKey]: value, count: cnt }));
          }
          return Promise.resolve(structuredClone(result)).then(resolve, reject);
        },
      };
      return query;
    } }),
  };
}
function draft(patch: Row = {}): Row {
  return { id: CALCULATED_DRAFT, tenantId: TENANT, projectId: PROJECT, source: "assembly_calculator", status: "draft", ...patch };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { estimate_drafts: [], historical_estimate_imports: [], audit_logs: [], field_feedback_reports: [], system_settings: [] };
  io.getDb.mockResolvedValue(database());
});

describe.each(["source", "link"] as const)("field launch approved count, historical detected by %s", kind => {
  function seed() {
    state.estimate_drafts = [
      draft({ id: HISTORICAL_DRAFT, source: kind === "source" ? "historical_import" : "assembly_calculator", status: "approved" }),
      draft({ id: CALCULATED_DRAFT, source: "assembly_calculator", status: "approved" }),
    ];
    state.historical_estimate_imports = kind === "link" ? [{ id: IMPORT, tenantId: TENANT, estimateDraftId: HISTORICAL_DRAFT, projectId: PROJECT }] : [];
  }
  it("excludes the historical draft but keeps the ordinary approved draft", async () => {
    seed();
    expect((await getMonitoringMetrics(TENANT)).estimatesApproved).toBe(1);
  });
});

describe("field launch approved count, non-historical baselines", () => {
  it("counts a legacy approved draft whose source is NULL", async () => {
    state.estimate_drafts = [draft({ source: null, status: "approved" })];
    expect((await getMonitoringMetrics(TENANT)).estimatesApproved).toBe(1);
  });
  it("does not count a draft, historical or not, that is merely in draft status", async () => {
    state.estimate_drafts = [draft({ source: "historical_import", status: "draft" }), draft({ source: "assembly_calculator", status: "draft" })];
    expect((await getMonitoringMetrics(TENANT)).estimatesApproved).toBe(0);
  });
});

describe("field launch tenant isolation", () => {
  it("never mixes counts, distribution, or activity between two tenants", async () => {
    state.estimate_drafts = [
      draft({ id: CALCULATED_DRAFT, tenantId: TENANT, status: "approved" }),
      draft({ id: "72000000-0000-4000-8000-0000000000f1", tenantId: OTHER_TENANT, status: "approved" }),
      draft({ id: "72000000-0000-4000-8000-0000000000f2", tenantId: OTHER_TENANT, status: "approved" }),
    ];
    const mine = await getMonitoringMetrics(TENANT);
    const theirs = await getMonitoringMetrics(OTHER_TENANT);
    expect(mine.estimatesApproved).toBe(1);
    expect(theirs.estimatesApproved).toBe(2);

    const mineDist = await getEstimateStatusDistribution(TENANT);
    const theirsDist = await getEstimateStatusDistribution(OTHER_TENANT);
    expect(mineDist).toEqual({ approved: 1 });
    expect(theirsDist).toEqual({ approved: 2 });
  });
  it.each([undefined, null, ""])("refuses a helper call with no resolved tenant (%s), even bypassing the router", async (bad) => {
    state.estimate_drafts = [draft({ status: "approved" })];
    await expect(getMonitoringMetrics(bad as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    await expect(getEstimateStatusDistribution(bad as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    await expect(getRecentAuditActivity(bad as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
  });
});
