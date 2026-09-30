/** B1: getMonitoringMetrics' approved count must exclude historical drafts, like the other
 * six nonHistoricalEstimateCondition() consumers, while still counting legacy NULL-source
 * approved estimates. This is a plain relational count, so the driver here evaluates the
 * real generated SQL predicate (via PgDialect) and aggregates it, unlike the row-projection
 * driver in historical-estimate-guards.test.ts which has no COUNT() support.
 *
 * Tenant V3 (achado 4): audit-derived counts/feed no longer trust the acting profile's
 * CURRENT tenant as proof of the AUDITED RESOURCE's tenant (a profile's tenant_id can be
 * filled in after an event was recorded, and some real writers log userId: null outright).
 * They instead resolve the resource's own tenant via tableName/recordId, for the writers
 * this cut can verify directly: estimate_drafts, geographic_overrides, field_feedback_reports
 * (via projects). The driver below evaluates real LEFT/INNER JOIN conditions across fixture
 * rows and the full AND/OR/IS NULL boolean structure of the WHERE predicate — not a no-op
 * join and not an independent-atom-AND scan (an earlier draft of this driver did exactly
 * that and silently masked a real bug; see the V2 history in the delivery report).
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
 * Evaluate a WHERE predicate against a joined row set (table name → its matched row, or
 * absent when a LEFT JOIN found no match).
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

/** Evaluate a `[left|inner]Join(table, on)` condition (column-to-column, not column-to-param). */
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
      const joins: Array<{ name: string; on: SQL; kind: "inner" | "left" }> = [];
      let predicate: SQL | undefined;
      let groupByColumn: string | undefined;
      let orderCol: { table: string; column: string; dir: string } | undefined;
      let limitN: number | undefined;
      const query: any = {
        where: (value: SQL) => { predicate = value; return query; },
        innerJoin: (joinTable: Table, on: SQL) => { joins.push({ name: getTableName(joinTable), on, kind: "inner" }); return query; },
        leftJoin: (joinTable: Table, on: SQL) => { joins.push({ name: getTableName(joinTable), on, kind: "left" }); return query; },
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
              const matches = (state[j.name] ?? []).filter(candidate => joinMatches({ ...rs, [j.name]: candidate }, j.on));
              if (matches.length > 0) {
                for (const m of matches) next.push({ ...rs, [j.name]: m });
              } else if (j.kind === "left") {
                next.push(rs);
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
function geoOverride(patch: Row = {}): Row {
  return { id: "72000000-0000-4000-8000-000000000030", tenantId: TENANT, overrideType: "swap", isActive: true, ...patch };
}
function auditLog(patch: Row = {}): Row {
  return { id: "72000000-0000-4000-8000-000000000010", userId: USER, action: "estimate.pipeline_error", tableName: "estimate_drafts", recordId: CALCULATED_DRAFT, oldValues: null, newValues: null, ipAddress: null, userAgent: null, createdAt: new Date("2026-01-01T00:00:00Z"), ...patch };
}
function feedbackReport(patch: Row = {}): Row {
  return { id: "72000000-0000-4000-8000-000000000020", projectId: PROJECT, feedbackType: "other", status: "open", ...patch };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { estimate_drafts: [], historical_estimate_imports: [], audit_logs: [], field_feedback_reports: [], geographic_overrides: [], profiles: [], projects: [], system_settings: [] };
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

describe("field launch audit attribution — achado 4: resource tenant, not actor tenant", () => {
  const OTHER_PROJECT = "72000000-0000-4000-8000-000000000008";

  beforeEach(() => {
    state.projects = [project({ id: PROJECT, tenantId: TENANT }), project({ id: OTHER_PROJECT, tenantId: OTHER_TENANT })];
  });

  it("legitimate attribution is preserved: counts exported/pipeline-error/override/csv via the audited resource's own tenant", async () => {
    state.estimate_drafts = [draft({ id: CALCULATED_DRAFT, tenantId: TENANT })];
    state.geographic_overrides = [geoOverride({ id: "ov1", tenantId: TENANT })];
    state.audit_logs = [
      auditLog({ id: "a1", action: "estimate.export_csv", tableName: "estimate_drafts", recordId: CALCULATED_DRAFT }),
      auditLog({ id: "a3", action: "estimate.pipeline_error", tableName: "estimate_drafts", recordId: CALCULATED_DRAFT }),
      auditLog({ id: "a4", action: "geo_override.create", tableName: "geographic_overrides", recordId: "ov1", userId: null }),
      auditLog({ id: "a5", action: "estimate.csv_validation_failed", tableName: "estimate_drafts", recordId: CALCULATED_DRAFT }),
    ];
    const mine = await getMonitoringMetrics(TENANT);
    expect(mine.estimatesExported).toBe(1);
    expect(mine.pipelineErrors).toBe(1);
    expect(mine.overrideFrequency).toBe(1);
    expect(mine.csvValidationFailures).toBe(1);
    expect((await getMonitoringMetrics(OTHER_TENANT)).pipelineErrors).toBe(0);
  });

  it("restores visibility for a geo_override write logged with userId: null (never visible to anyone under the old actor-JOIN)", async () => {
    state.geographic_overrides = [geoOverride({ id: "ov2", tenantId: TENANT })];
    state.audit_logs = [auditLog({ id: "a-anon", action: "geo_override.create", tableName: "geographic_overrides", recordId: "ov2", userId: null })];
    expect((await getMonitoringMetrics(TENANT)).overrideFrequency).toBe(1);
    expect((await getMonitoringMetrics(OTHER_TENANT)).overrideFrequency).toBe(0);
  });

  it("actor A / resource B: an event by a TENANT actor on an OTHER_TENANT resource is excluded from TENANT and attributed to the resource's real owner", async () => {
    const otherDraft = "72000000-0000-4000-8000-0000000000f4";
    state.estimate_drafts = [draft({ id: otherDraft, tenantId: OTHER_TENANT })];
    state.audit_logs = [auditLog({ id: "a-cross", userId: USER, action: "estimate.pipeline_error", tableName: "estimate_drafts", recordId: otherDraft })];
    expect((await getMonitoringMetrics(TENANT)).pipelineErrors).toBe(0);
    expect((await getMonitoringMetrics(OTHER_TENANT)).pipelineErrors).toBe(1);
  });

  it("profile initially NULL later linked: the actor's CURRENT profile tenant has zero influence on attribution", async () => {
    const otherDraft = "72000000-0000-4000-8000-0000000000f5";
    state.profiles = [profile({ id: USER, tenantId: TENANT })]; // simulates a profile that was NULL when the event fired, later COALESCE-linked to TENANT
    state.estimate_drafts = [draft({ id: otherDraft, tenantId: OTHER_TENANT })];
    state.audit_logs = [auditLog({ id: "a-stale-actor", userId: USER, action: "estimate.pipeline_error", tableName: "estimate_drafts", recordId: otherDraft })];
    // Actor's profile now says TENANT; the resource says OTHER_TENANT. Resource wins.
    expect((await getMonitoringMetrics(TENANT)).pipelineErrors).toBe(0);
    expect((await getMonitoringMetrics(OTHER_TENANT)).pipelineErrors).toBe(1);
  });

  it("missing/unknown reference is excluded for everyone: null recordId, dangling recordId, and unrecognized tableName", async () => {
    state.estimate_drafts = [draft({ id: CALCULATED_DRAFT, tenantId: TENANT })];
    state.audit_logs = [
      auditLog({ id: "a-null-record", action: "estimate.pipeline_error", tableName: "estimate_drafts", recordId: null }),
      auditLog({ id: "a-dangling", action: "estimate.pipeline_error", tableName: "estimate_drafts", recordId: "72000000-0000-4000-8000-000000000fff" }),
      // tableName claims an unverifiable table even though recordId coincidentally matches a real, tenant-matching estimate_drafts row.
      auditLog({ id: "a-wrong-table", action: "estimate.pipeline_error", tableName: "scope_override_log", recordId: CALCULATED_DRAFT }),
    ];
    expect((await getMonitoringMetrics(TENANT)).pipelineErrors).toBe(0);
  });

  it("counts feedback reports only for the caller's own tenant project, and excludes an unlinked or tenant-NULL-project report", async () => {
    const NULL_TENANT_PROJECT = "72000000-0000-4000-8000-000000000009";
    state.projects.push(project({ id: NULL_TENANT_PROJECT, tenantId: null }));
    state.field_feedback_reports = [
      feedbackReport({ id: "f1", projectId: PROJECT }),
      feedbackReport({ id: "f2", projectId: OTHER_PROJECT }),
      feedbackReport({ id: "f3", projectId: null }),
      feedbackReport({ id: "f4", projectId: NULL_TENANT_PROJECT }),
    ];
    expect((await getMonitoringMetrics(TENANT)).feedbackReports).toBe(1);
    expect((await getMonitoringMetrics(OTHER_TENANT)).feedbackReports).toBe(1);
  });

  it("field_feedback_reports attribution flows through the linked project's tenant, in recentActivity", async () => {
    state.field_feedback_reports = [feedbackReport({ id: "f1", projectId: PROJECT })];
    state.audit_logs = [auditLog({ id: "fb1", action: "field_feedback_submitted", tableName: "field_feedback_reports", recordId: "f1", createdAt: new Date("2026-01-05T00:00:00Z") })];
    const mine = await getRecentAuditActivity(TENANT, 10);
    expect(mine.map(a => a.id)).toEqual(["fb1"]);
    expect((await getRecentAuditActivity(OTHER_TENANT, 10)).length).toBe(0);
  });

  it("recentActivity respects ordering/limit across verified resource-attributed rows only", async () => {
    state.estimate_drafts = [draft({ id: CALCULATED_DRAFT, tenantId: TENANT })];
    const otherDraft = "72000000-0000-4000-8000-0000000000f6";
    state.estimate_drafts.push(draft({ id: otherDraft, tenantId: OTHER_TENANT }));
    state.audit_logs = [
      auditLog({ id: "old", tableName: "estimate_drafts", recordId: CALCULATED_DRAFT, createdAt: new Date("2026-01-01T00:00:00Z") }),
      auditLog({ id: "new", tableName: "estimate_drafts", recordId: CALCULATED_DRAFT, createdAt: new Date("2026-01-03T00:00:00Z") }),
      auditLog({ id: "mid", tableName: "estimate_drafts", recordId: CALCULATED_DRAFT, createdAt: new Date("2026-01-02T00:00:00Z") }),
      auditLog({ id: "theirs", tableName: "estimate_drafts", recordId: otherDraft, createdAt: new Date("2026-01-04T00:00:00Z") }),
    ];
    const activity = await getRecentAuditActivity(TENANT, 2);
    expect(activity.map(a => a.id)).toEqual(["new", "mid"]);
  });
});
