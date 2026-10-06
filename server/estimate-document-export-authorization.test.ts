// C2-A ratification supersedes positive legacy issuance. Identity/ACL/snapshot
// controls remain; a refusal is before admission, so it writes no partial attempt/audit.
/** Actual routes, project access, lifecycle authorization and formatters; isolated IO only. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn(), permission: vi.fn(), put: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./audit", () => ({ logAudit: io.audit }));
vi.mock("./rbac", () => ({ hasPermission: io.permission }));
vi.mock("./storage", () => ({ storagePut: io.put }));
vi.mock("./estimate-export", async importOriginal => {
  const real = await importOriginal<typeof import("./estimate-export")>();
  return { ...real, generatePdfExport: vi.fn(real.generatePdfExport), generateJsonExport: vi.fn(real.generateJsonExport) };
});
import { estimateRouter } from "./estimate-router";
import { generatePdfExport, generateJsonExport } from "./estimate-export";

const TENANT = "a3100000-0000-4000-8000-000000000001";
const OTHER = "a3100000-0000-4000-8000-000000000002";
const USER = "b3100000-0000-4000-8000-000000000001";
const PROJECT = "c3100000-0000-4000-8000-000000000001";
const DRAFT = "d3100000-0000-4000-8000-000000000001";
const NEXT = "d3100000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-19T12:00:00Z");
type Row = Record<string, unknown>;
const rows: Record<string, Row[]> = {};
const reads: string[] = [];
let draftReads = 0;
let beforeRead: ((table: string, count: number) => void) | undefined;
const mutationWrites: string[] = [];
const transactionLocks: string[] = [];
const camel = (value: string) => value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
function select(columns?: Record<string, { name: string }>) {
  return { from: (table: Table) => {
    const name = getTableName(table);
    let predicate: SQL, maximum = Infinity, lock: string | undefined;
    const query = {
      where: (value: SQL) => { predicate = value; return query; },
      limit: (value: number) => { maximum = value; return query; },
      for: (value: string) => { lock = value; return query; },
      then: (resolve: (result: Row[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        reads.push(name);
        if (lock) transactionLocks.push(`${name}:${lock}`);
        if (name === "estimate_drafts") draftReads += 1;
        beforeRead?.(name, draftReads);
        const compiled = new PgDialect().sqlToQuery(predicate);
        let selected: Row[];
        if (name === "historical_estimate_imports") {
          expect(compiled.params).toEqual([DRAFT]);
          selected = (rows[name] ?? []).filter(row => row.estimateDraftId === compiled.params[0]);
        } else if (name === "project_members") {
          expect(compiled.params).toEqual([PROJECT, USER]);
          selected = rows[name] ?? [];
        } else {
          const conditions = [...compiled.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g)];
          if (conditions.length === 0) throw new Error("Expected exact relational identity lookup");
          selected = (rows[name] ?? []).filter(row => conditions.every(([, tableName, column, position]) => {
            if (tableName !== name) throw new Error("Unexpected cross-table predicate");
            return row[camel(column)] === compiled.params[Number(position) - 1];
          }));
        }
        selected = selected.slice(0, maximum);
        if (columns) selected = selected.map(row => Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[camel(column.name)]])));
        return structuredClone(selected);
      }).then(resolve, reject),
    };
    return query;
  } };
}
function unexpectedWrite(table: Table): never {
  mutationWrites.push(getTableName(table));
  throw new Error("Unexpected mutation in document authorization fixture");
}
const transactionDriver = { select, update: unexpectedWrite, insert: unexpectedWrite };
const driver = {
  select,
  transaction: vi.fn(async <T>(work: (tx: typeof transactionDriver) => Promise<T>) => {
    const before = structuredClone(rows);
    try { return await work(transactionDriver); } catch (error) {
      for (const key of Object.keys(rows)) delete rows[key];
      Object.assign(rows, before); throw error;
    }
  }),
};
function context(authenticated = true): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId: TENANT,
    user: authenticated ? {
      id: USER, tenantId: TENANT, role: "user", isActive: true, externalOpenId: null,
      email: "operator@example.invalid", fullName: "Synthetic Operator", companyName: null,
      loginMethod: "legacy", lastSignedIn: NOW, createdAt: NOW, updatedAt: NOW,
    } : null,
  };
}
function expectNoPayload() {
  expect(generatePdfExport).not.toHaveBeenCalled();
  expect(generateJsonExport).not.toHaveBeenCalled();
  expect(io.put).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TENANT_STRICT", "true");
  reads.length = 0; draftReads = 0; beforeRead = undefined;
  mutationWrites.length = 0; transactionLocks.length = 0;
  rows.tenants = [{ id: TENANT, isActive: true }];
  rows.estimate_internal_approval_snapshots = []; rows.estimate_internal_approvals = [];
  rows.historical_estimate_imports = [];
  rows.estimate_drafts = [{
    id: DRAFT, tenantId: TENANT, projectId: PROJECT, clientId: null, supersedesId: null, createdBy: USER, status: "approved", version: 2,
    approvedBy: USER, approvedAt: NOW, lockedAt: NOW, supersededBy: null, changeOrderOf: null,
    subtotalCost: "600.00", subtotalPrice: "1200.00", finalTotalPrice: "1200.00", grossProfit: "600.00", grossProfitPct: "50.00",
    bundleName: "Wholly invented export fixture", source: "scope_draft", channel: "direct", commercialChannel: "premium",
    region: "synthetic", finishLevel: "standard", pricingSchemaVersion: "1.0", createdAt: NOW, updatedAt: NOW,
    lineItems: [], assemblySelections: [], metadata: {}, notes: null, scopeDraftId: null,
    discountApplied: false, discountAmount: "0.00", profitShieldPassed: true, profitShieldMinPct: "28.00",
  }];
  rows.projects = [{ id: PROJECT, tenantId: TENANT, ownerUserId: USER, deletedAt: null }];
  rows.profiles = [{ id: USER, tenantId: TENANT, role: "user", isActive: true }];
  rows.project_members = [];
  io.getDb.mockResolvedValue(driver); io.permission.mockResolvedValue(false);
  io.audit.mockResolvedValue({ id: "synthetic-audit" });
  io.put.mockResolvedValue({ url: "https://storage.example.invalid/synthetic-file" });
});
afterEach(() => { vi.unstubAllEnvs(); });

// A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md retires the unconditional hold
// this whole describe.each was written against: exportPdf/exportJson now call
// the real accepted writer (createAndDeliverExportAttempt), which persists a
// terminal blocked attempt row + audit for every ineligible draft — the
// correct NEW behavior, not an effect-free hold. The OLD unconditional hold
// made nearly every sub-case below pass TRIVIALLY (it threw the identical
// PRECONDITION_FAILED/"unavailable" error no matter which fixture field was
// perturbed, and never reached generatePdfExport/generateJsonExport/storage
// at all) — confirmed by running this file unmodified against base
// `a5e32159` (74/74 passing) with the SAME synthetic driver used here, which
// forbids any INSERT/UPDATE and therefore cannot host the new writer's real
// persisted-blocked-row path. The real ACL/tenant/project/not-found coverage
// this block cared about is proven for real against actual PostgreSQL in
// server/a1-export-surface-integration.test.ts's access-denial cases instead.

// exportPrintable/validateCsvExport are also real writers now (same reasoning
// above) — only profitShield (untouched by this unit) stays on this synthetic
// driver.
describe.each(["profitShield"] as const)("H1 %s direct route", operation => {
  it.each(["source", "link"])("rejects capture-only origin detected by %s before legacy formatting", async kind => {
    if (kind === "source") rows.estimate_drafts[0].source = "historical_import";
    else rows.historical_estimate_imports = [{ id: NEXT, estimateDraftId: DRAFT }];
    rows.estimate_drafts[0].subtotalCost = null;
    await expect(estimateRouter.createCaller(context())[operation]({ id: DRAFT })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: operation === "profitShield" ? expect.stringMatching(/historical/i) : expect.stringMatching(/unavailable/i) });
    expect(io.put).not.toHaveBeenCalled();
    expect(io.audit).not.toHaveBeenCalled();
  });
});

describe.each(["source", "link"] as const)("H1 mutation error mapping by %s", kind => {
  // A1-DECISION-CYCLE-SURFACE-INTEGRATION-CONTRACT.md: `approveEstimate` is no
  // longer id-only — `internalApproveCommandSchema` rejects this file's
  // `{id: DRAFT}` payload at the Zod boundary (BAD_REQUEST) before ever
  // reaching the H1 guard this group proves, and the mocked driver here was
  // never built to answer the real command's approval/snapshot reads anyway
  // (same precedent as the routes retired from estimate-legacy-router-holds.
  // test.ts). Removed from this shared array for that reason; H1 rejection
  // for the real approveEstimate command is proven for real against actual
  // PostgreSQL in server/a1-decision-cycle-surface-integration.test.ts.
  it.each(["updateStatus", "rejectEstimate", "applyDiscount"] as const)("returns a precise unavailable authority error for %s", async operation => {
    rows.estimate_drafts[0].status = "draft";
    if (kind === "source") rows.estimate_drafts[0].source = "historical_import";
    else rows.historical_estimate_imports = [{ id: NEXT, estimateDraftId: DRAFT }];
    const caller = estimateRouter.createCaller(context());
    const result = operation === "updateStatus" ? caller.updateStatus({ id: DRAFT, status: "sent_to_estimate" })
      : operation === "rejectEstimate" ? caller.rejectEstimate({ id: DRAFT, reason: "Synthetic rejection" })
      : caller.applyDiscount({ id: DRAFT, discountPct: 5 });
    await expect(result).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/historical/i) });
    expectNoPayload(); expect(mutationWrites).toEqual([]); expect(io.audit).not.toHaveBeenCalled();
    expect(driver.transaction).toHaveBeenCalledTimes(1);
    expect(driver.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "serializable" });
    expect(transactionLocks).toEqual(expect.arrayContaining(["projects:update", "estimate_drafts:update", "tenants:share", "profiles:share"]));
  });
});
