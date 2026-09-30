/** B1: getMonitoringMetrics' approved count must exclude historical drafts, like the other
 * six nonHistoricalEstimateCondition() consumers, while still counting legacy NULL-source
 * approved estimates. This is a plain relational count, so the driver here evaluates the
 * real generated SQL predicate (via PgDialect) and aggregates it, unlike the row-projection
 * driver in historical-estimate-guards.test.ts which has no COUNT() support.
 *
 * Tenant V2: audit_logs/field_feedback_reports carry no tenant_id of their own, so the
 * fix joins through their owning profile/project. The driver below actually evaluates
 * INNER JOIN conditions across real fixture rows (not a no-op) — a NULL-owner audit log
 * or feedback report is only included in a result set when it survives the join, and the
 * WHERE predicate is checked against the correct joined table's columns, not just the
 * FROM table's. This is what lets the tests below prove the join, not just the count.
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
const USER = "72000000-0000-4000-8000-000000000006";
type Row = Record<string, any>;
let state: Record<string, Row[]>;
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const NOT_EXISTS_HISTORICAL =
  /not exists \(select 1 from "historical_estimate_imports" where "historical_estimate_imports"\."estimate_draft_id" = "estimate_drafts"\."id"\)/i;

/**
 * Evaluate a WHERE predicate against a joined row set (table name → its matched row).
 *
 * This must actually respect AND/OR/IS NULL grouping, not just scan for independent
 * atoms and AND them together: `tenantWhere()`'s transitional predicate is
 * `(tenant_id = $1 OR tenant_id IS NULL) AND <other conditions>`, and a flat atom scan
 * would silently turn that OR into a hard `tenant_id = $1` requirement — which happens
 * to reject a NULL-tenant row for the wrong reason, making a real transitional-mode
 * leak invisible to this driver. Every atomic comparison is reduced to a `true`/`false`
 * literal in place, then the remaining `and`/`or`/`not`/parens are evaluated as real
 * boolean logic.
 */
function predicateMatches(rowSet: Record<string, Row>, fromName: string, predicate?: SQL): boolean {
  if (!predicate) return true;
  const { sql: raw, params } = new PgDialect().sqlToQuery(predicate);
  let statement = raw.replace(/\s+/g, " ");

  statement = statement.replace(NOT_EXISTS_HISTORICAL, () => {
    const draftRow = rowSet[fromName];
    const isLinked = !!draftRow && (state.historical_estimate_imports ?? []).some(v => v.estimateDraftId === draftRow.id);
    return String(!isLinked);
  });

  statement = statement.replace(/"([a-z_]+)"\."([a-z_]+)"\s*=\s*\$(\d+)/g, (_m, name, column, position) => {
    const row = rowSet[name];
    return String(!!row && row[camel(column)] === params[Number(position) - 1]);
  });
  statement = statement.replace(/"([a-z_]+)"\."([a-z_]+)"\s+is distinct from\s+\$(\d+)/gi, (_m, name, column, position) => {
    const row = rowSet[name];
    return String(!!row && row[camel(column)] !== params[Number(position) - 1]);
  });
  statement = statement.replace(/"([a-z_]+)"\."([a-z_]+)"\s+is null/gi, (_m, name, column) => {
    const row = rowSet[name];
    return String(!!row && (row[camel(column)] === null || row[camel(column)] === undefined));
  });
  statement = statement.replace(/"([a-z_]+)"\."([a-z_]+)"\s+like\s+'([^']*)'/gi, (_m, name, column, pattern) => {
    const row = rowSet[name];
    if (!row) return "false";
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
    return String(re.test(String(row[camel(column)] ?? "")));
  });

  if (/"[a-z_]+"\."[a-z_]+"/.test(statement)) {
    throw new Error(`Test driver left an unrecognized predicate fragment: ${statement}`);
  }
  const jsExpr = statement.replace(/\band\b/gi, "&&").replace(/\bor\b/gi, "||").replace(/\bnot\b/gi, "!");
  return Boolean(new Function(`"use strict"; return (${jsExpr});`)());
}

/** Evaluate an `innerJoin(table, on)` condition (column-to-column, not column-to-param). */
function joinMatches(rowSet: Record<string, Row>, on: SQL): boolean {
  const { sql: statement } = new PgDialect().sqlToQuery(on);
  for (const [, lt, lc, rt, rc] of statement.matchAll(/"([a-z_]+)"\."([a-z_]+)"\s*=\s*"([a-z_]+)"\."([a-z_]+)"/g)) {
    const left = rowSet[lt]?.[camel(lc)];
    const right = rowSet[rt]?.[camel(rc)];
    if (left === undefined || left === null || right === undefined || left !== right) return false;
  }
  return true;
}

function database(): any {
  return {
    select: (columns?: Record<string, any>) => ({ from: (table: Table) => {
      const fromName = getTableName(table);
      const joins: Array<{ name: string; on: SQL }> = [];
      let predicate: SQL | undefined;
      let groupByColumn: string | undefined;
      let orderCol: { table: string; column: string; dir: string } | undefined;
      let limitN: number | undefined;
      const query: any = {
        where: (value: SQL) => { predicate = value; return query; },
        innerJoin: (joinTable: Table, on: SQL) => { joins.push({ name: getTableName(joinTable), on }); return query; },
        groupBy: (col: any) => { groupByColumn = col?.name; return query; },
        orderBy: (col: any) => {
          const { sql: statement } = new PgDialect().sqlToQuery(col);
          const m = statement.match(/"([a-z_]+)"\."([a-z_]+)"\s*(desc|asc)?/i);
          if (m) orderCol = { table: m[1], column: camel(m[2]), dir: (m[3] ?? "asc").toLowerCase() };
          return query;
        },
        limit: (n: number) => { limitN = n; return query; },
        then: (resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) => {
          let rowSets: Array<Record<string, Row>> = (state[fromName] ?? []).map(row => ({ [fromName]: row }));
          for (const j of joins) {
            const next: typeof rowSets = [];
            for (const rs of rowSets) {
              for (const candidate of state[j.name] ?? []) {
                const merged = { ...rs, [j.name]: candidate };
                if (joinMatches(merged, j.on)) next.push(merged);
              }
            }
            rowSets = next;
          }
          let matched = rowSets.filter(rs => predicateMatches(rs, fromName, predicate));
          if (orderCol) {
            const { table, column, dir } = orderCol;
            matched = [...matched].sort((a, b) => {
              const av = a[table]?.[column], bv = b[table]?.[column];
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              return dir === "desc" ? -cmp : cmp;
            });
          }
          if (typeof limitN === "number") matched = matched.slice(0, limitN);
          const rows = matched.map(rs => rs[fromName]);
          const isCount = !!columns && Object.keys(columns).length === 1 && "count" in columns;
          let result: unknown[];
          if (isCount) {
            result = [{ count: rows.length }];
          } else if (groupByColumn && columns && "count" in columns) {
            const groupKey = Object.keys(columns).find(k => k !== "count")!;
            const counts = new Map<string, number>();
            for (const row of rows) counts.set(row[camel(groupByColumn)], (counts.get(row[camel(groupByColumn)]) ?? 0) + 1);
            result = [...counts.entries()].map(([value, cnt]) => ({ [groupKey]: value, count: cnt }));
          } else if (columns) {
            result = matched.map(rs => {
              const projected: Row = {};
              for (const key of Object.keys(columns)) {
                const col = columns[key];
                const owner = col?.table ? getTableName(col.table) : fromName;
                projected[key] = (rs[owner] ?? rs[fromName])?.[key];
              }
              return projected;
            });
          } else {
            result = rows;
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
function profile(patch: Row = {}): Row {
  return { id: USER, tenantId: TENANT, ...patch };
}
function project(patch: Row = {}): Row {
  return { id: PROJECT, tenantId: TENANT, ...patch };
}
function auditLog(patch: Row = {}): Row {
  return { id: "72000000-0000-4000-8000-000000000010", userId: USER, action: "estimate.pipeline_error", tableName: "estimate_drafts", recordId: null, oldValues: null, newValues: null, ipAddress: null, userAgent: null, createdAt: new Date("2026-01-01T00:00:00Z"), ...patch };
}
function feedbackReport(patch: Row = {}): Row {
  return { id: "72000000-0000-4000-8000-000000000020", projectId: PROJECT, feedbackType: "other", status: "open", ...patch };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { estimate_drafts: [], historical_estimate_imports: [], audit_logs: [], field_feedback_reports: [], profiles: [], projects: [], system_settings: [] };
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

describe("field launch tenant isolation — estimate_drafts", () => {
  it("never mixes counts or distribution between two tenants", async () => {
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

  it("excludes a legacy tenant-NULL draft from every tenant's count, even in transitional mode", async () => {
    state.estimate_drafts = [
      draft({ id: CALCULATED_DRAFT, tenantId: TENANT, status: "approved" }),
      draft({ id: "72000000-0000-4000-8000-0000000000f3", tenantId: null, status: "approved" }),
    ];
    expect((await getMonitoringMetrics(TENANT)).estimatesApproved).toBe(1);
    expect((await getMonitoringMetrics(OTHER_TENANT)).estimatesApproved).toBe(0);
  });

  it.each([undefined, null, ""])("refuses a helper call with no resolved tenant (%s), even bypassing the router", async (bad) => {
    state.estimate_drafts = [draft({ status: "approved" })];
    await expect(getMonitoringMetrics(bad as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    await expect(getEstimateStatusDistribution(bad as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    await expect(getRecentAuditActivity(bad as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
  });

  it("refuses an unresolved tenant before ever calling getDb (no db, no data, still throws)", async () => {
    io.getDb.mockResolvedValue(null);
    await expect(getMonitoringMetrics("" as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    await expect(getEstimateStatusDistribution("" as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    await expect(getRecentAuditActivity("" as unknown as string)).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    expect(io.getDb).not.toHaveBeenCalled();
  });
});

describe("field launch tenant isolation — audit-log and feedback joins", () => {
  const OTHER_USER = "72000000-0000-4000-8000-000000000007";
  const OTHER_PROJECT = "72000000-0000-4000-8000-000000000008";

  beforeEach(() => {
    state.profiles = [profile({ id: USER, tenantId: TENANT }), profile({ id: OTHER_USER, tenantId: OTHER_TENANT })];
    state.projects = [project({ id: PROJECT, tenantId: TENANT }), project({ id: OTHER_PROJECT, tenantId: OTHER_TENANT })];
  });

  it("counts exported/pipeline-error/override/csv audit actions only for the caller's own tenant actor", async () => {
    state.audit_logs = [
      auditLog({ id: "a1", userId: USER, action: "estimate.export_csv" }),
      auditLog({ id: "a2", userId: OTHER_USER, action: "estimate.export_csv" }),
      auditLog({ id: "a3", userId: USER, action: "estimate.pipeline_error" }),
      auditLog({ id: "a4", userId: USER, action: "assembly.override_applied" }),
      auditLog({ id: "a5", userId: USER, action: "estimate.csv_validation_failed" }),
    ];
    const mine = await getMonitoringMetrics(TENANT);
    expect(mine.estimatesExported).toBe(1);
    expect(mine.pipelineErrors).toBe(1);
    expect(mine.overrideFrequency).toBe(1);
    expect(mine.csvValidationFailures).toBe(1);

    const theirs = await getMonitoringMetrics(OTHER_TENANT);
    expect(theirs.estimatesExported).toBe(1);
    expect(theirs.pipelineErrors).toBe(0);
  });

  it("excludes an audit log whose actor profile has no tenant, for every tenant (no leak, no false global visibility)", async () => {
    state.profiles.push(profile({ id: "72000000-0000-4000-8000-0000000000ff", tenantId: null }));
    state.audit_logs = [auditLog({ id: "a-null", userId: "72000000-0000-4000-8000-0000000000ff", action: "estimate.pipeline_error" })];
    expect((await getMonitoringMetrics(TENANT)).pipelineErrors).toBe(0);
    expect((await getMonitoringMetrics(OTHER_TENANT)).pipelineErrors).toBe(0);
  });

  it("excludes an audit log whose actor has no profile row at all (INNER JOIN drops it)", async () => {
    state.audit_logs = [auditLog({ id: "a-orphan", userId: "72000000-0000-4000-8000-00000000dead", action: "estimate.pipeline_error" })];
    expect((await getMonitoringMetrics(TENANT)).pipelineErrors).toBe(0);
  });

  it("counts feedback reports only for the caller's own tenant project, and excludes an unlinked report", async () => {
    state.field_feedback_reports = [
      feedbackReport({ id: "f1", projectId: PROJECT }),
      feedbackReport({ id: "f2", projectId: OTHER_PROJECT }),
      feedbackReport({ id: "f3", projectId: null }),
    ];
    expect((await getMonitoringMetrics(TENANT)).feedbackReports).toBe(1);
    expect((await getMonitoringMetrics(OTHER_TENANT)).feedbackReports).toBe(1);
  });

  it("recentActivity returns only the caller tenant's own audit rows, most recent first, respecting limit", async () => {
    state.audit_logs = [
      auditLog({ id: "old", userId: USER, action: "estimate.pipeline_error", createdAt: new Date("2026-01-01T00:00:00Z") }),
      auditLog({ id: "new", userId: USER, action: "estimate.csv_validation_failed", createdAt: new Date("2026-01-03T00:00:00Z") }),
      auditLog({ id: "mid", userId: USER, action: "assembly.override_applied", createdAt: new Date("2026-01-02T00:00:00Z") }),
      auditLog({ id: "theirs", userId: OTHER_USER, action: "estimate.pipeline_error", createdAt: new Date("2026-01-04T00:00:00Z") }),
    ];
    const activity = await getRecentAuditActivity(TENANT, 2);
    expect(activity.map(a => a.id)).toEqual(["new", "mid"]);
  });
});
