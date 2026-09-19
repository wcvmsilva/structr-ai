import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ScopeChecklistPattern } from "../drizzle/schema";

const io = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./audit-trail", () => ({ recordAuditAsync: io.audit }));
vi.mock("./field-operations-db", () => ({ getProjectBudgetEstimate: vi.fn() }));
vi.mock("./actuals-db", () => ({ getProjectBudgetLines: vi.fn() }));
vi.mock("./closeout-db", () => ({ getCloseoutByProject: vi.fn() }));

import { getScopeChecklist, ScopeCompletenessError } from "./scope-completeness-db";

const TENANT_A = "a2000000-0000-4000-8000-000000000001";
const TENANT_B = "a2000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-19T12:00:00Z");
const dialect = new PgDialect();
let rows: ScopeChecklistPattern[];
let predicates: Array<ReturnType<PgDialect["sqlToQuery"]>>;

function pattern(id: string, overrides: Partial<ScopeChecklistPattern> = {}): ScopeChecklistPattern {
  return {
    id, tenantId: TENANT_A, projectType: "bathroom_remodel", costCodeId: null,
    costCode: "23-100", costCodeName: "Ventilation", trade: null,
    occurrenceCount: 3, projectCount: 5, frequency: "0.6",
    avgUnplannedCents: 12500, totalUnplannedCents: 37500,
    confidenceScore: "0.6", confidenceBand: "medium", isRecurring: true,
    suggestion: "Review ventilation scope.", evidence: [], lastSeenAt: NOW,
    acknowledgedBy: null, acknowledgedAt: null, deletedAt: null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

// This driver applies the emitted SQL and its bound parameters. It adds no tenant,
// recurrence or deletion policy of its own; removing a production predicate leaks
// the corresponding fixture. It is query-contract evidence, not a PostgreSQL/RLS test.
function matches(row: ScopeChecklistPattern, predicate?: SQL): boolean {
  if (!predicate) return true;
  const query = dialect.sqlToQuery(predicate);
  const columns = {
    tenant_id: "tenantId", project_type: "projectType", is_recurring: "isRecurring",
  } as const;
  for (const [column, property] of Object.entries(columns)) {
    const match = new RegExp(`"scope_checklist_patterns"\\."${column}" = \\$(\\d+)`).exec(query.sql);
    if (!match) continue;
    if (property === "tenantId" && row.tenantId == null && query.sql.includes('"tenant_id" is null')) continue;
    if (row[property] !== query.params[Number(match[1]) - 1]) return false;
  }
  if (query.sql.includes('"deleted_at" is null') && row.deletedAt !== null) return false;
  return true;
}

const driver = {
  select: vi.fn(() => {
    let table: Table;
    let predicate: SQL | undefined;
    let ordering: SQL | undefined;
    let count: number | undefined;
    const query = {
      from(value: Table) { table = value; return query; },
      where(value: SQL) { predicate = value; predicates.push(dialect.sqlToQuery(value)); return query; },
      orderBy(value: SQL) { ordering = value; return query; },
      limit(value: number) { count = value; return query; },
      then(resolve: (value: ScopeChecklistPattern[]) => unknown) {
        let result = getTableName(table) === "scope_checklist_patterns"
          ? rows.filter(row => matches(row, predicate)) : [];
        if (ordering) {
          const order = dialect.sqlToQuery(ordering).sql;
          if (order === '"scope_checklist_patterns"."total_unplanned_cents" desc') {
            result = [...result].sort((a, b) => b.totalUnplannedCents - a.totalUnplannedCents);
          } else if (order === '"scope_checklist_patterns"."total_unplanned_cents" asc') {
            result = [...result].sort((a, b) => a.totalUnplannedCents - b.totalUnplannedCents);
          } else throw new Error(`Unsupported fixture ordering: ${order}`);
        }
        return resolve(structuredClone(count === undefined ? result : result.slice(0, count)));
      },
    };
    return query;
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TENANT_STRICT", "true");
  rows = [];
  predicates = [];
  io.getDb.mockResolvedValue(driver);
});
afterEach(() => vi.unstubAllEnvs());

describe("historical scope checklist query", () => {
  it("reports database unavailability instead of claiming there is no history", async () => {
    io.getDb.mockResolvedValue(null);
    const result = getScopeChecklist({ tenantId: TENANT_A, projectType: "remodel" });
    await expect(result).rejects.toBeInstanceOf(ScopeCompletenessError);
    await expect(result).rejects.toMatchObject({ code: "DB_UNAVAILABLE" });
  });

  it.each(["", " \t\n ", "x".repeat(101), null, undefined, 42])(
    "rejects invalid direct input %j before requesting a database handle", async projectType => {
      await expect(getScopeChecklist({ tenantId: TENANT_A, projectType: projectType as string })).rejects.toBeInstanceOf(TypeError);
      expect(io.getDb).not.toHaveBeenCalled();
    },
  );

  it("validates the trimmed length and still accepts a 100-character historical key", async () => {
    const type = "x".repeat(100);
    rows = [pattern("max-length", { projectType: type })];
    const result = await getScopeChecklist({ tenantId: TENANT_A, projectType: `  ${type}  ` });
    expect(result.items.map(row => row.id)).toEqual(["max-length"]);
  });

  it("preserves successful empty history as a distinct result", async () => {
    await expect(getScopeChecklist({ tenantId: TENANT_A, projectType: "remodel" })).resolves.toEqual({
      projectType: "remodel", items: [], summary: "No recurring scope gap recorded for remodel jobs yet.",
    });
  });

  it("binds the tenant and all checklist predicates in the actual PostgreSQL WHERE clause", async () => {
    await getScopeChecklist({ tenantId: TENANT_A, projectType: "bathroom_remodel" });
    expect(predicates).toHaveLength(1);
    expect(predicates[0]).toMatchObject({
      sql: '("scope_checklist_patterns"."tenant_id" = $1 and "scope_checklist_patterns"."project_type" = $2 and "scope_checklist_patterns"."is_recurring" = $3 and "scope_checklist_patterns"."deleted_at" is null)',
      params: [TENANT_A, "bathroom_remodel", true],
    });
  });

  it("returns each tenant's own patterns for the same historical project type", async () => {
    rows = [pattern("belongs-to-b", { tenantId: TENANT_B }), pattern("belongs-to-a")];
    expect((await getScopeChecklist({ tenantId: TENANT_A, projectType: "bathroom_remodel" })).items.map(row => row.id)).toEqual(["belongs-to-a"]);
    expect((await getScopeChecklist({ tenantId: TENANT_B, projectType: "bathroom_remodel" })).items.map(row => row.id)).toEqual(["belongs-to-b"]);
  });

  it.each([
    ["not recurring", { isRecurring: false }],
    ["soft deleted", { deletedAt: NOW }],
    ["another type", { projectType: "kitchen_remodel" }],
  ] as const)("excludes a pattern that is %s", async (_name, excluded) => {
    rows = [pattern("excluded", excluded), pattern("included")];
    expect((await getScopeChecklist({ tenantId: TENANT_A, projectType: "bathroom_remodel" })).items.map(row => row.id)).toEqual(["included"]);
  });

  it("rejects an unresolved tenant before a query is executed", async () => {
    await expect(getScopeChecklist({ tenantId: null as unknown as string, projectType: "remodel" })).rejects.toMatchObject({ code: "TENANT_UNRESOLVED" });
    expect(predicates).toEqual([]);
  });

  it("orders by total historical exposure and returns only the first 100 patterns", async () => {
    rows = Array.from({ length: 102 }, (_, index) => pattern(`pattern-${index + 1}`, { totalUnplannedCents: (index + 1) * 100 }));
    const result = await getScopeChecklist({ tenantId: TENANT_A, projectType: "bathroom_remodel" });
    expect(result.items.map(row => row.id)).toEqual(Array.from({ length: 100 }, (_, index) => `pattern-${102 - index}`));
  });

  it("retains acknowledged patterns and the existing successful payload and summary", async () => {
    const acknowledged = pattern("seen", { acknowledgedBy: "b2000000-0000-4000-8000-000000000001", acknowledgedAt: NOW });
    rows = [acknowledged];
    await expect(getScopeChecklist({ tenantId: TENANT_A, projectType: "bathroom_remodel" })).resolves.toEqual({
      projectType: "bathroom_remodel", items: [acknowledged],
      summary: "1 item(s) are routinely missed on bathroom_remodel jobs, worth roughly $125.00 per job if forgotten again.",
    });
    expect(io.audit).not.toHaveBeenCalled();
  });

  it("matches historical keys using trimming and lowercase without remapping aliases", async () => {
    rows = [pattern("bathroom"), pattern("renovation", { projectType: "renovation" }), pattern("remodel", { projectType: "remodel" })];
    const bathroom = await getScopeChecklist({ tenantId: TENANT_A, projectType: "  BATHROOM_REMODEL  " });
    expect(bathroom.items.map(row => row.id)).toEqual(["bathroom"]);
    expect(bathroom.projectType).toBe("  BATHROOM_REMODEL  ");
    expect((await getScopeChecklist({ tenantId: TENANT_A, projectType: " RENOVATION " })).items.map(row => row.id)).toEqual(["renovation"]);
    expect((await getScopeChecklist({ tenantId: TENANT_A, projectType: "remodel" })).items.map(row => row.id)).toEqual(["remodel"]);
  });

  it("propagates a failed query instead of returning an empty successful checklist", async () => {
    const failure = new Error("Synthetic query failure");
    driver.select.mockImplementationOnce(() => { throw failure; });
    await expect(getScopeChecklist({ tenantId: TENANT_A, projectType: "remodel" })).rejects.toBe(failure);
  });
});
