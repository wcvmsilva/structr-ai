/** C2-A holds are unconditional; reading a historical status never grants authority. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const io = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.getDb }));
vi.mock("./audit", () => ({ logAudit: io.audit }));

import { approveEstimateDraft } from "./estimate-db";
import {
  createEstimateVersion, createChangeOrder, getExportableEstimate, getVersionChain,
} from "./estimate-version-db";
import { materializeChangeOrderTasks } from "./field-operations-db";

const PROJECT = "a1200000-0000-4000-8000-000000000001";
const OTHER_PROJECT = "a1200000-0000-4000-8000-000000000002";
const DRAFT = "b1200000-0000-4000-8000-000000000001";
const ACTOR = "c1200000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-20T12:00:00.000Z");
const holdCode = "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE";

const operations = [
  ["approval", () => approveEstimateDraft(DRAFT, ACTOR)],
  ["version", () => createEstimateVersion({ sourceDraftId: DRAFT, userId: ACTOR, reason: "Synthetic reviewed version reason" })],
  ["change_order", () => createChangeOrder({ baseDraftId: DRAFT, userId: ACTOR, reason: "Synthetic change order reason", subtotalCost: "20.00", subtotalPrice: "100.00", lineItems: [] })],
  ["materialize_change_order", () => materializeChangeOrderTasks({ changeOrderId: DRAFT, userId: ACTOR, today: "2026-09-20" })],
] as const;

function expectNoEffects() {
  expect(io.getDb).not.toHaveBeenCalled();
  expect(io.audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  io.getDb.mockImplementation(() => { throw new Error("Synthetic IO must not be reached by a held operation"); });
  io.audit.mockImplementation(() => { throw new Error("Synthetic audit must not receive a successful held operation"); });
});

describe.each(operations)("direct legacy %s hold", (operation, invoke) => {
  it("returns the typed operation hold before opening storage or producing side effects", async () => {
    await expect(invoke()).rejects.toMatchObject({ code: holdCode, operation });
    expectNoEffects();
  });

  it("does not change the hold into a database availability decision", async () => {
    io.getDb.mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ code: holdCode, operation });
    expectNoEffects();
  });

  it("does not inspect stored state even when a database handle is available", async () => {
    const storage = {
      select: vi.fn(() => { throw new Error("Synthetic stored approved state must not be inspected"); }),
      insert: vi.fn(), update: vi.fn(), transaction: vi.fn(),
    };
    io.getDb.mockResolvedValue(storage);
    await expect(invoke()).rejects.toMatchObject({ code: holdCode, operation });
    expectNoEffects();
    expect(storage.select).not.toHaveBeenCalled();
    expect(storage.insert).not.toHaveBeenCalled();
    expect(storage.update).not.toHaveBeenCalled();
    expect(storage.transaction).not.toHaveBeenCalled();
  });

  it("keeps repeated requests held without an audit, retry, duplicate row or field event", async () => {
    await expect(invoke()).rejects.toMatchObject({ code: holdCode, operation });
    await expect(invoke()).rejects.toMatchObject({ code: holdCode, operation });
    expectNoEffects();
  });
});

describe("held inputs are not used as a source of copied content or authority", () => {
  it("does not read version source or name accessors", async () => {
    const read = vi.fn(() => { throw new Error("Synthetic version accessor must not run"); });
    const input = Object.defineProperties({}, {
      sourceDraftId: { get: read }, name: { get: read }, reason: { get: read }, userId: { get: read },
    }) as Parameters<typeof createEstimateVersion>[0];
    await expect(createEstimateVersion(input)).rejects.toMatchObject({ code: holdCode, operation: "version" });
    expect(read).not.toHaveBeenCalled(); expectNoEffects();
  });

  it("does not read or normalize change-order price and line accessors", async () => {
    const read = vi.fn(() => { throw new Error("Synthetic price accessor must not run"); });
    const input = Object.defineProperties({}, {
      baseDraftId: { get: read }, subtotalPrice: { get: read }, lineItems: { get: read },
      reason: { get: read }, userId: { get: read },
    }) as Parameters<typeof createChangeOrder>[0];
    await expect(createChangeOrder(input)).rejects.toMatchObject({ code: holdCode, operation: "change_order" });
    expect(read).not.toHaveBeenCalled(); expectNoEffects();
  });

  it("does not read materialization inputs to derive tasks, dates or budgets", async () => {
    const read = vi.fn(() => { throw new Error("Synthetic field accessor must not run"); });
    const input = Object.defineProperties({}, {
      changeOrderId: { get: read }, userId: { get: read }, today: { get: read },
    }) as Parameters<typeof materializeChangeOrderTasks>[0];
    await expect(materializeChangeOrderTasks(input)).rejects.toMatchObject({ code: holdCode, operation: "materialize_change_order" });
    expect(read).not.toHaveBeenCalled(); expectNoEffects();
  });
});

describe("legacy exportable selection has no positive candidate", () => {
  it("returns null without consulting storage for the highest approved version", async () => {
    await expect(getExportableEstimate(PROJECT)).resolves.toBeNull();
    expectNoEffects();
  });

  it("remains null without a database connection", async () => {
    io.getDb.mockResolvedValue(null);
    await expect(getExportableEstimate(PROJECT)).resolves.toBeNull();
    expectNoEffects();
  });

  it("never falls back to another project or retries a candidate lookup", async () => {
    await expect(getExportableEstimate(PROJECT)).resolves.toBeNull();
    await expect(getExportableEstimate(OTHER_PROJECT)).resolves.toBeNull();
    expectNoEffects();
  });
});

type HistoryRow = ReturnType<typeof historyRow>;
function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT, projectId: PROJECT, source: "assembly_calculator", version: 1, status: "approved",
    finalTotalPrice: "999999999999999999.99", supersedesId: null, supersededBy: null,
    changeOrderOf: null, lockedAt: NOW, approvedAt: NOW, createdAt: NOW, ...overrides,
  };
}

/** Fixed read fake checks the actual contextual/H1 predicate, not an unconditional row list. */
function historyStore(rows: HistoryRow[], linkedHistoricalIds = new Set<string>()) {
  const select = vi.fn(() => ({
    from: (table: Table) => {
      expect(getTableName(table)).toBe("estimate_drafts");
      return { where: (predicate: SQL) => {
        const query = new PgDialect().sqlToQuery(predicate);
        expect(query.params).toEqual([PROJECT, "historical_import"]);
        expect(query.sql).toContain('"estimate_drafts"."project_id" = $1');
        expect(query.sql).toContain('"estimate_drafts"."source" IS DISTINCT FROM $2');
        expect(query.sql).toContain('NOT EXISTS (SELECT 1 FROM "historical_estimate_imports"');
        expect(query.sql).toContain('"historical_estimate_imports"."estimate_draft_id" = "estimate_drafts"."id"');
        return { orderBy: async () => structuredClone(rows.filter(row =>
          row.projectId === PROJECT && row.source !== "historical_import" && !linkedHistoricalIds.has(row.id),
        )) };
      } };
    },
  }));
  const store = { select, insert: vi.fn(), update: vi.fn() };
  io.getDb.mockResolvedValue(store);
  return store;
}

describe("version history preserves facts without choosing approval authority", () => {
  it("keeps legacy approval facts and exact prices but never promotes the highest approved row", async () => {
    const rows = [historyRow(), historyRow({ id: "b1200000-0000-4000-8000-000000000002", version: 9 })];
    const before = structuredClone(rows);
    const store = historyStore(rows);
    const result = await getVersionChain(PROJECT);
    expect(result.activeApprovedId).toBeNull();
    expect(result.projectId).toBe(PROJECT);
    expect(result.versions).toEqual(rows.map(({ projectId: _project, source: _source, ...history }) => history));
    expect(rows).toEqual(before);
    expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled();
    expect(io.audit).not.toHaveBeenCalled();
  });

  it("keeps active/revoked decision labels and succession as history without assigning authority", async () => {
    const successor = "b1200000-0000-4000-8000-000000000002";
    const rows = [
      historyRow({ status: "internal_approval_revoked", supersededBy: successor }),
      historyRow({ id: successor, source: "version", status: "internally_approved", version: 2, supersedesId: DRAFT }),
    ];
    historyStore(rows);
    await expect(getVersionChain(PROJECT)).resolves.toMatchObject({
      activeApprovedId: null,
      versions: [
        { id: DRAFT, status: "internal_approval_revoked", supersededBy: successor },
        { id: successor, status: "internally_approved", supersedesId: DRAFT },
      ],
    });
    expect(io.audit).not.toHaveBeenCalled();
  });

  it("retains the existing contextual and source-or-link H1 exclusion from this history view", async () => {
    const linkedId = "b1200000-0000-4000-8000-000000000003";
    historyStore([
      historyRow({ status: "draft", approvedAt: null, lockedAt: null }),
      historyRow({ id: "b1200000-0000-4000-8000-000000000002", source: "historical_import" }),
      historyRow({ id: linkedId, source: "assembly_calculator" }),
      historyRow({ id: "b1200000-0000-4000-8000-000000000004", projectId: OTHER_PROJECT }),
    ], new Set([linkedId]));
    const result = await getVersionChain(PROJECT);
    expect(result.versions.map(row => row.id)).toEqual([DRAFT]);
    expect(result.activeApprovedId).toBeNull();
    expect(io.audit).not.toHaveBeenCalled();
  });

  it("preserves an empty history without inventing an active approval", async () => {
    historyStore([]);
    await expect(getVersionChain(PROJECT)).resolves.toEqual({ projectId: PROJECT, versions: [], activeApprovedId: null });
    expect(io.audit).not.toHaveBeenCalled();
  });
});
