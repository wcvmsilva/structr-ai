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
import { getMonitoringMetrics } from "./field-launch-db";

const TENANT = "72000000-0000-4000-8000-000000000001";
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
      const query: any = {
        where: (value: SQL) => { predicate = value; return query; },
        orderBy: () => query, groupBy: () => query, limit: () => query,
        then: (resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) => {
          const rows = (state[name] ?? []).filter(row => matches(name, row, predicate));
          const isCount = !!columns && Object.keys(columns).length === 1 && "count" in columns;
          const result = isCount ? [{ count: rows.length }] : rows;
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
    expect((await getMonitoringMetrics()).estimatesApproved).toBe(1);
  });
});

describe("field launch approved count, non-historical baselines", () => {
  it("counts a legacy approved draft whose source is NULL", async () => {
    state.estimate_drafts = [draft({ source: null, status: "approved" })];
    expect((await getMonitoringMetrics()).estimatesApproved).toBe(1);
  });
  it("does not count a draft, historical or not, that is merely in draft status", async () => {
    state.estimate_drafts = [draft({ source: "historical_import", status: "draft" }), draft({ source: "assembly_calculator", status: "draft" })];
    expect((await getMonitoringMetrics()).estimatesApproved).toBe(0);
  });
});
